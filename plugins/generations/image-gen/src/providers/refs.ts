import { extname } from 'node:path';
import { readBytes } from '../bytes';

/**
 * Shared reference-image plumbing for the ported baoyu adapters (task 0115): local
 * paths ride the wire as `data:` URIs, remote http(s) URLs pass through untouched,
 * and MIME detection follows each provider's own extension table.
 */

export function mimeForPath(path: string): string {
    const ext = extname(path).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.bmp') return 'image/bmp';
    return 'image/png';
}

/** Lift a reference image to a `data:` URI; http(s) URLs ride verbatim. */
export async function refToDataUri(path: string): Promise<string> {
    if (/^https?:\/\//i.test(path)) return path;
    const bytes = await readBytes(path);
    return `data:${mimeForPath(path)};base64,${Buffer.from(bytes).toString('base64')}`;
}
