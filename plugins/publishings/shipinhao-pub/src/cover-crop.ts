/**
 * 1:1 audio cover for the 音频 rail (2026-11-26, operator decision).
 *
 * The daily bundle ships one landscape cover (1344×576) and the 音频 form requires a square 封面:
 * it opens its own crop dialog, and that dialog is what refused every backfill with 「请上传封面」
 * (measured 2026-11-26 on 20261121: the upload settled, the dialog confirmed, the form still said
 * the cover was missing). Cropping here removes the dialog from the critical path: the widest square
 * that fits is cut from the CENTER of the existing artwork — never stretched, never upscaled.
 *
 * `sips` is the repo's image tool (see `plugins/kk/scripts/cover-compositor.ts`, ADR-046) and is
 * macOS-only; a host without it returns an error and the caller keeps the old dialog path, so a
 * Linux CI run degrades instead of failing.
 *
 * shortcut: PNG/JPEG only and no content-aware framing — a cover whose headline sits at the edges
 * loses it to the centre cut; authoring a square audio cover in the bundle is the upgrade.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

/** One `sips` invocation, injectable so the crop maths is testable without the binary. */
export type SipsRun = (args: string[]) => { status: number | null; stdout?: string; stderr?: string };

const defaultRun: SipsRun = (args) => {
    const result = spawnSync('sips', args, { encoding: 'utf-8' });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

/** Reads `pixelWidth`/`pixelHeight` out of `sips -g` output; `undefined` when either is missing. */
export function parseSipsDims(output: string): { width: number; height: number } | undefined {
    const width = /pixelWidth:\s*(\d+)/.exec(output)?.[1];
    const height = /pixelHeight:\s*(\d+)/.exec(output)?.[1];
    if (width === undefined || height === undefined) return undefined;
    const parsed = { width: Number(width), height: Number(height) };
    return parsed.width > 0 && parsed.height > 0 ? parsed : undefined;
}

/** Output beside the source (the run directory is disposable): `cover.png` → `cover-1x1.png`. */
export function squareCoverPath(sourcePath: string): string {
    const dot = sourcePath.lastIndexOf('.');
    const stem = dot <= 0 ? sourcePath : sourcePath.slice(0, dot);
    return join(dirname(sourcePath), `${stem.split('/').pop()}-1x1.png`);
}

/**
 * Centred square crop of `sourcePath`. Returns the cropped file, or an `error` the caller treats as
 * "keep the original" (an already-square cover needs no crop and returns the source unchanged).
 */
export function centerSquareCover(sourcePath: string, run: SipsRun = defaultRun): { path: string } | { error: string } {
    const probe = run(['-g', 'pixelWidth', '-g', 'pixelHeight', sourcePath]);
    if (probe.status !== 0) return { error: `sips could not read ${sourcePath}: ${probe.stderr ?? ''}`.trim() };
    const dims = parseSipsDims(probe.stdout ?? '');
    if (dims === undefined) return { error: `sips reported no pixel dimensions for ${sourcePath}` };
    const side = Math.min(dims.width, dims.height);
    if (dims.width === side && dims.height === side) return { path: sourcePath };
    const out = squareCoverPath(sourcePath);
    // `-c <height> <width>` crops to the centre, which is the widest square that fits.
    const crop = run(['-c', String(side), String(side), sourcePath, '--out', out]);
    if (crop.status !== 0) return { error: `sips centre crop failed: ${crop.stderr ?? ''}`.trim() };
    return { path: out };
}
