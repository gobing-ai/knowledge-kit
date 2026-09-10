import { basename, dirname, extname, resolve } from 'node:path';

/**
 * Task 0104 R3 — artefacts are siblings of `--out` (the voice-gen rule): the
 * invoker expands `works_dir` before building `--out`, and a plugin's cwd is
 * its own package dir, so every path resolves against `--out`'s directory —
 * never `process.cwd()`.
 */

/** `ImageJobSpec.outputStem` ?? the `--out` basename without extension. */
export function outStemFor(outPath: string, override?: string): string {
    return override ?? basename(outPath, extname(outPath));
}

/**
 * `<outDir>/<stem>-<format>-<NN>.<ext>` — NN zero-padded from 01, so a
 * deterministic re-run against the same `--out` overwrites instead of appending.
 */
export function artifactPath(outPath: string, stem: string, format: string, index: number, extension: string): string {
    const nn = String(index).padStart(2, '0');
    return resolve(dirname(outPath), `${stem}-${format}-${nn}.${extension}`);
}
