/**
 * Task 0180 (F616 R4) — pure sfnt cmap reader, no IO.
 *
 * Parses the OpenType/TrueType table directory and the cmap table to build a
 * code-point → boolean coverage function. Format 12 (full Unicode BMP + SMP,
 * preferred for CJK) is selected when present; format 4 (BMP only) is the
 * fallback. A truncated font or a missing cmap throws so callers cannot silently
 * get a false-negative from a partial read.
 */

function u16(view: DataView, offset: number): number {
    return view.getUint16(offset, false);
}

function u32(view: DataView, offset: number): number {
    return view.getUint32(offset, false);
}

function tag(view: DataView, offset: number): string {
    return String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3),
    );
}

function assertBytes(view: DataView, offset: number, needed: number, context: string): void {
    if (offset + needed > view.byteLength) {
        throw new Error(`compose: truncated font — expected ${needed} bytes at offset ${offset} (${context})`);
    }
}

/** Locate the cmap table in the sfnt directory and return its absolute offset + length. */
function findCmapTable(view: DataView): { offset: number; length: number } {
    assertBytes(view, 0, 12, 'sfnt header');
    // sfnt magic: 0x00010000 (TrueType), 0x4F54544F ('OTTO' — CFF/OTF), or 0x74727565 ('true').
    const magic = u32(view, 0);
    if (magic !== 0x00010000 && magic !== 0x4f54544f && magic !== 0x74727565) {
        throw new Error(`compose: not a valid sfnt font (magic 0x${magic.toString(16).padStart(8, '0')})`);
    }
    const numTables = u16(view, 4);
    assertBytes(view, 12, numTables * 16, 'sfnt table directory');
    for (let i = 0; i < numTables; i++) {
        const base = 12 + i * 16;
        if (tag(view, base) === 'cmap') {
            const offset = u32(view, base + 8);
            const length = u32(view, base + 12);
            return { offset, length };
        }
    }
    throw new Error('compose: truncated font — cmap table not found in sfnt directory');
}

/** Build a coverage function from cmap format 4 (BMP segmented). */
function coverageFormat4(view: DataView, subtableOffset: number): (cp: number) => boolean {
    assertBytes(view, subtableOffset, 14, 'cmap format 4 header');
    const length = u16(view, subtableOffset + 2);
    assertBytes(view, subtableOffset, length, 'cmap format 4 body');
    const segCount = u16(view, subtableOffset + 6) / 2;
    const endCodesBase = subtableOffset + 14;
    assertBytes(
        view,
        endCodesBase,
        segCount * 2 + 2 + segCount * 2 + segCount * 2 + segCount * 2,
        'cmap format 4 segments',
    );
    const startCodesBase = endCodesBase + segCount * 2 + 2; // skip reservedPad
    const idDeltaBase = startCodesBase + segCount * 2;
    const idRangeOffsetBase = idDeltaBase + segCount * 2;

    return (cp: number): boolean => {
        if (cp > 0xffff) return false;
        // Binary search over endCode array.
        let lo = 0;
        let hi = segCount - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            const endCode = u16(view, endCodesBase + mid * 2);
            if (endCode < cp) {
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        if (lo >= segCount) return false;
        const startCode = u16(view, startCodesBase + lo * 2);
        if (cp < startCode) return false;
        const idRangeOffset = u16(view, idRangeOffsetBase + lo * 2);
        if (idRangeOffset === 0) {
            const idDelta = u16(view, idDeltaBase + lo * 2);
            return ((cp + idDelta) & 0xffff) !== 0;
        }
        // Use the idRangeOffset to index into glyphIdArray.
        const glyphIdAddr = idRangeOffsetBase + lo * 2 + idRangeOffset + (cp - startCode) * 2;
        if (glyphIdAddr + 2 > view.byteLength) return false;
        const glyphId = u16(view, glyphIdAddr);
        return glyphId !== 0;
    };
}

/** Build a coverage function from cmap format 12 (full Unicode, sequential groups). */
function coverageFormat12(view: DataView, subtableOffset: number): (cp: number) => boolean {
    assertBytes(view, subtableOffset, 16, 'cmap format 12 header');
    const numGroups = u32(view, subtableOffset + 12);
    assertBytes(view, subtableOffset + 16, numGroups * 12, 'cmap format 12 groups');
    const groupsBase = subtableOffset + 16;

    return (cp: number): boolean => {
        // Binary search over startCharCode.
        let lo = 0;
        let hi = numGroups - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            const base = groupsBase + mid * 12;
            const startChar = u32(view, base);
            const endChar = u32(view, base + 4);
            if (endChar < cp) {
                lo = mid + 1;
            } else if (startChar > cp) {
                hi = mid - 1;
            } else {
                // cp is in [startChar, endChar]; glyph is startGlyph + (cp - startChar).
                const startGlyph = u32(view, base + 8);
                return startGlyph + (cp - startChar) !== 0;
            }
        }
        return false;
    };
}

/**
 * Parse the cmap table and return a `(cp: number) => boolean` coverage
 * predicate. Format 12 is preferred (covers all Unicode); format 4 is the
 * fallback (BMP only). A truncated font or a missing usable subtable throws.
 */
export function glyphCoverage(fontBytes: Uint8Array): (cp: number) => boolean {
    if (fontBytes.byteLength < 12) {
        throw new Error('compose: truncated font — too small for sfnt header');
    }
    const view = new DataView(fontBytes.buffer, fontBytes.byteOffset, fontBytes.byteLength);
    const { offset: cmapOffset } = findCmapTable(view);

    assertBytes(view, cmapOffset, 4, 'cmap table header');
    const numSubtables = u16(view, cmapOffset + 2);
    assertBytes(view, cmapOffset + 4, numSubtables * 8, 'cmap encoding records');

    let fmt4Offset: number | undefined;
    let fmt12Offset: number | undefined;

    for (let i = 0; i < numSubtables; i++) {
        const recBase = cmapOffset + 4 + i * 8;
        const platformId = u16(view, recBase);
        const encodingId = u16(view, recBase + 2);
        const subtableOffset = cmapOffset + u32(view, recBase + 4);

        if (subtableOffset + 2 > view.byteLength) continue;
        const fmt = u16(view, subtableOffset);

        // Prefer platform 3 (Windows) or platform 0 (Unicode) for format 12.
        // Accept any platform for format 4 as BMP fallback.
        if (fmt === 12 && (platformId === 3 || platformId === 0)) {
            fmt12Offset = subtableOffset;
        }
        if (fmt === 4 && (platformId === 3 || platformId === 0) && encodingId !== 10) {
            if (fmt4Offset === undefined) fmt4Offset = subtableOffset;
        }
    }

    if (fmt12Offset !== undefined) {
        return coverageFormat12(view, fmt12Offset);
    }
    if (fmt4Offset !== undefined) {
        return coverageFormat4(view, fmt4Offset);
    }
    throw new Error('compose: truncated font — no usable cmap subtable (format 4 or 12) found');
}
