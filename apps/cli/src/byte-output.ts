import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Byte-exact IO seam — the one place `kk` touches bytes instead of text.
 *
 * Two boundaries cannot carry bytes, so this module is the sanctioned exception to both
 * `no-raw-stdout-stderr` and `no-direct-fs-io` (see the `exclude` entries in
 * `.spur/rules/typescript/output-boundaries.yaml` and `.spur/rules/strict/runtime-boundaries.yaml`):
 *
 * - `output.ts` is line-oriented: ts-utils `echo` appends one `\n`, which would corrupt a response
 *   body. `kk bot exec` prints (or saves with `-o`) the body exactly as received.
 * - the ts-runtime `FileSystem` seam is text-only (`readFile`/`writeFile` take a `string`), so a
 *   binary `-d @file` payload or `-o` body needs the byte primitives directly — the same class as
 *   `plugins/generations/image-gen/src/bytes.ts`.
 *
 * Keep this file this narrow: no path maths, no policy, no parsing.
 */

/**
 * Write text or bytes to stdout with no appended newline.
 *
 * Resolves only after the write has drained: `index.ts` ends with `process.exit(await main())`,
 * which discards whatever is still queued on stdout, so a body larger than the pipe buffer
 * (~64-128 KiB) was truncated with exit 0. Awaiting the callback (not a timer or a size guess) is
 * what makes the caller hold the process open long enough.
 */
export function writeBytes(chunk: string | Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
        process.stdout.write(chunk, (error) => (error === null || error === undefined ? resolve() : reject(error)));
    });
}

/** Read a file as raw bytes; throws when unreadable. */
export function readFileBytes(path: string): Buffer {
    return readFileSync(path);
}

/** Write raw bytes to a file, replacing it. */
export function writeFileBytes(path: string, bytes: Uint8Array): void {
    writeFileSync(path, bytes);
}
