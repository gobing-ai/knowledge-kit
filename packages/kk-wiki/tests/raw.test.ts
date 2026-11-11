import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    deriveTitle,
    type RawSnapshot,
    rawSnapshotId,
    readRawSnapshot,
    renderRawSnapshot,
    writeRawSnapshot,
} from '../src/raw';

const dirs: string[] = [];
function tempDir(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-wiki-raw-')));
    dirs.push(dir);
    return dir;
}
afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('rawSnapshotId', () => {
    it('is content-addressed and stable', () => {
        const a = rawSnapshotId('raw/html/a1', '# body');
        expect(a).toBe(rawSnapshotId('raw/html/a1', '# body'));
        expect(a).not.toBe(rawSnapshotId('raw/html/a2', '# body'));
        expect(a).toHaveLength(16);
    });
});

describe('writeRawSnapshot', () => {
    it('writes <dir>/<type>/<id>.md with the four source keys', async () => {
        const dir = tempDir();
        const snapshot = await writeRawSnapshot({
            type: 'rss',
            sourceUri: 'feed.xml',
            title: 'Feed item',
            body: '# Headline\n\nBody.',
            dir,
            ingestedAt: '2026-11-10T00:00:00Z',
        });
        expect(snapshot.path).toBe(join(dir, 'rss', `${snapshot.id}.md`));
        const text = readFileSync(snapshot.path, 'utf8');
        expect(text).toContain('title: Feed item');
        expect(text).toContain('source_type: rss');
        expect(text).toContain('source_uri: feed.xml');
        expect(text).toContain('ingested_at: 2026-11-10T00:00:00Z');
        expect(text).toContain('# Headline');
    });

    it('is idempotent for identical input', async () => {
        const dir = tempDir();
        const input = {
            type: 'html' as const,
            sourceUri: 'a.html',
            title: 'A',
            body: '# A',
            dir,
            ingestedAt: '2026-11-10T00:00:00Z',
        };
        const first = await writeRawSnapshot(input);
        const before = readFileSync(first.path, 'utf8');
        const second = await writeRawSnapshot(input);
        expect(second.path).toBe(first.path);
        expect(readFileSync(second.path, 'utf8')).toBe(before);
    });

    it('stamps the ingest time when the caller supplies none', async () => {
        const dir = tempDir();
        const snapshot = await writeRawSnapshot({ type: 'rss', sourceUri: 'x', title: 'x', body: 'x', dir });
        expect(snapshot.ingestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
        expect(await readRawSnapshot(snapshot.path)).toContain(`ingested_at: ${snapshot.ingestedAt}`);
    });
});

describe('renderRawSnapshot', () => {
    it('quotes a value that would break the flat block', () => {
        const snapshot: RawSnapshot = {
            id: 'x',
            path: 'x.md',
            type: 'url',
            title: 'a: b',
            sourceUri: 'https://example.com/a: b',
            ingestedAt: '2026-11-10T00:00:00Z',
        };
        const text = renderRawSnapshot(snapshot, 'body');
        expect(text).toContain('title: "a: b"');
        expect(text).toContain('source_uri: "https://example.com/a: b"');
    });
});

describe('deriveTitle', () => {
    it('prefers the first heading', () => {
        expect(deriveTitle('intro\n## Real title\nmore', 'raw/a1.md')).toBe('Real title');
    });

    it('falls back to the source basename without its extension', () => {
        expect(deriveTitle('no heading here', 'raw/html/article.html')).toBe('article');
    });

    it('names stdin when nothing else is available', () => {
        expect(deriveTitle('', 'stdin')).toBe('stdin');
    });

    it('falls back to untitled when the source has no usable basename', () => {
        writeFileSync(join(tempDir(), 'x'), '');
        expect(deriveTitle('', '')).toBe('untitled');
    });
});
