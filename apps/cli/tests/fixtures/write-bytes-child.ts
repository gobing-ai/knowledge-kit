/**
 * Child-process fixture for the stdout-drain regression test (finding 1): write N bytes through
 * the byte seam, then exit exactly as `apps/cli/src/index.ts` does. A write that is still queued
 * on stdout when `process.exit` runs is discarded, so this process truncates unless `writeBytes`
 * resolves only after the drain.
 */
import { writeBytes } from '../../src/byte-output';

await writeBytes(Buffer.alloc(Number(process.argv[2]), 0x61));
process.exit(0);
