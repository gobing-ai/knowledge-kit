import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';

/**
 * Layer-1 raw snapshots (ADR-048, docs/design/kk-wiki.md §3).
 *
 * A raw snapshot is NOT a vault page: it carries the four source keys ingest promises and is
 * never edited afterwards. Keeping its frontmatter separate from `PageFrontmatterSchema` is what
 * stops layer 1 and layer 2 from sharing a contract they do not actually share.
 */

export const RAW_SOURCE_TYPES = ['url', 'pdf', 'html', 'rss'] as const;
/** Accepted layer-1 source kinds. */
export type RawSourceType = (typeof RAW_SOURCE_TYPES)[number];

/** Input for one layer-1 snapshot write. */
export interface WriteRawSnapshotInput {
    type: RawSourceType;
    /** Where the body came from: a path, a URL, or `stdin`. */
    sourceUri: string;
    title: string;
    body: string;
    /** Vault raw directory (layer 1). The snapshot lands at `<dir>/<type>/<id>.md`. */
    dir: string;
    /** Injected for deterministic tests; defaults to now (UTC, second precision). */
    ingestedAt?: string;
}

/** A written layer-1 snapshot: its id, path and source facts. */
export interface RawSnapshot {
    id: string;
    path: string;
    type: RawSourceType;
    title: string;
    sourceUri: string;
    ingestedAt: string;
}

/** Content-addressed id: the same source text and origin always yield the same snapshot. */
export function rawSnapshotId(sourceUri: string, body: string): string {
    return createHash('sha256').update(`${sourceUri}\n${body}`).digest('hex').slice(0, 16);
}

function escapeValue(value: string): string {
    return /[:#\n]/.test(value) || value.trim() !== value ? `"${value.replace(/"/g, '\\"')}"` : value;
}

/** Render one snapshot to its on-disk form (frontmatter block plus body). */
export function renderRawSnapshot(snapshot: RawSnapshot, body: string): string {
    const lines = [
        '---',
        `title: ${escapeValue(snapshot.title)}`,
        `source_type: ${snapshot.type}`,
        `source_uri: ${escapeValue(snapshot.sourceUri)}`,
        `ingested_at: ${snapshot.ingestedAt}`,
        '---',
        '',
    ];
    return `${lines.join('\n')}\n${body.replace(/\s+$/, '')}\n`;
}

/** Write one layer-1 snapshot. Idempotent: re-ingesting the same origin + body rewrites identical bytes. */
export async function writeRawSnapshot(
    input: WriteRawSnapshotInput,
    fileSystem: FileSystem = createNodeFileSystem(),
): Promise<RawSnapshot> {
    const ingestedAt = input.ingestedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const id = rawSnapshotId(input.sourceUri, input.body);
    const snapshot: RawSnapshot = {
        id,
        path: join(input.dir, input.type, `${id}.md`),
        type: input.type,
        title: input.title,
        sourceUri: input.sourceUri,
        ingestedAt,
    };
    await fileSystem.ensureDir(dirname(snapshot.path));
    await fileSystem.writeFile(snapshot.path, renderRawSnapshot(snapshot, input.body));
    return snapshot;
}

/** Derive a snapshot title: an explicit one wins, else the first markdown heading, else the source. */
export function deriveTitle(body: string, sourceUri: string): string {
    for (const line of body.split('\n')) {
        const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*$/.exec(line);
        if (heading !== null) return heading[1] ?? sourceUri;
    }
    const tail = sourceUri === 'stdin' ? 'stdin' : (sourceUri.split('/').pop() ?? sourceUri);
    return tail.replace(/\.[a-z0-9]+$/i, '') || 'untitled';
}

/** Read one snapshot back (used by tests and by later layers that re-read layer 1). */
export async function readRawSnapshot(path: string, fileSystem: FileSystem = createNodeFileSystem()): Promise<string> {
    return fileSystem.readFile(path);
}
