import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileBytes, writeBytes, writeFileBytes } from '../src/byte-output';

/**
 * Replace `process.stdout.write` for the duration of one case, returning the captured chunks.
 * The fake completes the drain callback synchronously, so it can only prove WHAT is written —
 * the pipe-buffer case needs a real child process (below).
 */
function captureStdout(): { chunks: Array<string | Uint8Array>; restore: () => void } {
    const original = process.stdout.write.bind(process.stdout);
    const chunks: Array<string | Uint8Array> = [];
    process.stdout.write = ((chunk: string | Uint8Array, callback?: (error?: Error | null) => void) => {
        chunks.push(chunk);
        callback?.(null);
        return true;
    }) as typeof process.stdout.write;
    return { chunks, restore: () => (process.stdout.write = original) };
}

describe('writeBytes', () => {
    let restore: (() => void) | undefined;
    afterEach(() => {
        restore?.();
        restore = undefined;
    });

    it('writes text verbatim with no appended newline', async () => {
        const capture = captureStdout();
        restore = capture.restore;
        await writeBytes('{"ok":true}');
        expect(capture.chunks).toEqual(['{"ok":true}']);
    });

    it('passes a binary body through unchanged', async () => {
        const capture = captureStdout();
        restore = capture.restore;
        const body = new Uint8Array([0x00, 0xff, 0x0a, 0x42]);
        await writeBytes(body);
        expect(capture.chunks).toEqual([body]);
    });

    // Finding 1 (P2): a body larger than what a pipe accepts in one go was cut at the pipe
    // capacity with exit 0, because `process.exit` ran while the write was still queued. The
    // synchronous fake above cannot show that, so this case pipes through a REAL child process
    // that exits right after the write, exactly like `index.ts`. 4 MB is well past the ~1.2 MB a
    // piped stdout absorbs here (a 300 KB body survives a Bun pipe but not a shell `| wc -c`).
    it('delivers a large body in full before the process exits', async () => {
        const bytes = 4_000_000;
        const child = Bun.spawn(['bun', join(import.meta.dir, 'fixtures', 'write-bytes-child.ts'), String(bytes)], {
            stdout: 'pipe',
            stderr: 'pipe',
        });
        const [stdout, stderr] = await Promise.all([
            new Response(child.stdout).arrayBuffer(),
            new Response(child.stderr).text(),
        ]);
        expect(stderr).toBe('');
        expect(await child.exited).toBe(0);
        expect(stdout.byteLength).toBe(bytes);
    }, 30_000);
});

describe('byte file IO', () => {
    let dir: string | undefined;
    afterEach(() => {
        if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
        dir = undefined;
    });

    it('round-trips bytes with no encoding loss', () => {
        dir = mkdtempSync(join(tmpdir(), 'kk-bytes-'));
        const path = join(dir, 'body.bin');
        const bytes = new Uint8Array([0x00, 0x01, 0xfe, 0xff, 0x0a]);
        writeFileBytes(path, bytes);
        expect(new Uint8Array(readFileSync(path))).toEqual(bytes);
        expect(new Uint8Array(readFileBytes(path))).toEqual(bytes);
    });

    it('reads a text file as its exact bytes (no newline stripping)', () => {
        dir = mkdtempSync(join(tmpdir(), 'kk-bytes-'));
        const path = join(dir, 'payload.txt');
        writeFileSync(path, 'a\nb\n');
        expect(Buffer.from(readFileBytes(path)).toString()).toBe('a\nb\n');
    });

    it('throws when the file is unreadable', () => {
        expect(() => readFileBytes(join(tmpdir(), 'kk-bytes-missing-file'))).toThrow();
    });
});
