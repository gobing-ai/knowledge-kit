import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 0348 R5/R6 — dailyCoverNormalize x compositeCover integration. The runner is a spawned stage
 * process (kk-workflow-stages.ts is not an in-process library — see kk-workflow-stages.test.ts).
 * The composite render needs sips (mac-only); the graceful-skip paths run platform-neutrally on
 * png sources, which normalize moves without transcode.
 */
const runner = join(import.meta.dir, '../scripts/kk-workflow-stages.ts');

// A real 1x1 JPEG (same bytes as apps/cli/tests/kk-workflow-stages.test.ts — generated once via
// `sips -s format jpeg` from a 1x1 png) so the jpg transcode test exercises sips with decodable data.
const JPEG_BYTES = Buffer.from(
    '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A+mKKKK/Kz/QA/9k=',
    'base64',
);

const HEADLINE = '量子芯片算力暴涨千倍？\n全球科技巨头底层暗战打响！';

function withTempDir<T>(fn: (dir: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), 'daily-cover-normalize-'));
    try {
        return fn(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

function run(args: string[], env: Record<string, string> = {}): { status: number; stderr: string } {
    const result = spawnSync('bun', [runner, ...args], { encoding: 'utf-8', env: { ...process.env, ...env } });
    return { status: result.status ?? 1, stderr: result.stderr ?? '' };
}

/** A png cover workspace: manifest records the artifact; normalize moves it to the canonical name. */
function pngWorkspace(dir: string, brief: unknown | null): string {
    const cover = join(dir, '23-cover');
    mkdirSync(cover, { recursive: true });
    const artifact = join(cover, 'content-daily-news-cover-01.png');
    writeFileSync(artifact, 'raw-png-bytes');
    writeFileSync(join(cover, 'content.json'), JSON.stringify({ metadata: { images: [{ path: artifact }] } }));
    if (brief !== null) writeFileSync(join(cover, '20260101_07_cover-brief.json'), JSON.stringify(brief));
    return artifact;
}

function pixelWidth(pngPath: string): string {
    const probe = spawnSync('sips', ['-g', 'pixelWidth', pngPath], { encoding: 'utf-8' });
    return /pixelWidth: (\d+)/.exec(probe.stdout)?.[1] ?? '';
}

describe('dailyCoverNormalize x compositeCover', () => {
    it('keeps the raw cover when the brief has no headline', () => {
        withTempDir((dir) => {
            const artifact = pngWorkspace(dir, { subject: '量子实验室场景', headline: '' });
            expect(run(['daily-cover-normalize', dir, '20260101']).status).toBe(0);
            const out = join(dir, '23-cover', '20260101_07_cover_cover.png');
            expect(readFileSync(out, 'utf-8')).toBe('raw-png-bytes');
            expect(existsSync(artifact)).toBe(false);
        });
    });

    it('keeps the raw cover when the brief is missing or malformed', () => {
        withTempDir((dir) => {
            pngWorkspace(dir, null);
            expect(run(['daily-cover-normalize', dir, '20260101']).status).toBe(0);
            expect(existsSync(join(dir, '23-cover', '20260101_07_cover_cover.png'))).toBe(true);
        });
        withTempDir((dir) => {
            pngWorkspace(dir, 'not-json-at-all');
            expect(run(['daily-cover-normalize', dir, '20260101']).status).toBe(0);
            expect(existsSync(join(dir, '23-cover', '20260101_07_cover_cover.png'))).toBe(true);
        });
    });

    it('fails loud when the composite render cannot run (no sips on PATH)', () => {
        withTempDir((dir) => {
            pngWorkspace(dir, { subject: '量子实验室场景', headline: HEADLINE });
            // Keep `bun` resolvable but drop `sips` from PATH: a bin dir holding only a bun symlink.
            const bin = join(dir, 'only-bun');
            mkdirSync(bin, { recursive: true });
            const shim = spawnSync('ln', ['-s', process.execPath, join(bin, 'bun')]);
            expect(shim.status).toBe(0);
            const result = run(['daily-cover-normalize', dir, '20260101'], { PATH: bin });
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('cover composite:');
        });
    });

    const itMacOnly = it.skipIf(process.platform !== 'darwin');
    itMacOnly('composites headline and logo onto the transcoded jpg cover', () => {
        withTempDir((dir) => {
            const cover = join(dir, '23-cover');
            mkdirSync(cover, { recursive: true });
            const artifact = join(cover, 'content-daily-news-cover-01.jpg');
            writeFileSync(artifact, JPEG_BYTES);
            writeFileSync(join(cover, 'content.json'), JSON.stringify({ metadata: { images: [{ path: artifact }] } }));
            writeFileSync(
                join(cover, '20260101_07_cover-brief.json'),
                JSON.stringify({ subject: '量子实验室场景', headline: HEADLINE }),
            );
            const result = run(['daily-cover-normalize', dir, '20260101']);
            expect(result.status).toBe(0);
            expect(result.stderr).toContain('cover composited');
            const out = join(cover, '20260101_07_cover_cover.png');
            const socialOut = join(cover, '20260101_07_cover_social.jpg');
            expect(existsSync(out)).toBe(true);
            expect(pixelWidth(out)).toBe('1344');
            expect(existsSync(socialOut)).toBe(true);
            expect(pixelWidth(socialOut)).toBe('1200');
        });
    });

    itMacOnly('composites onto an already-png cover too', () => {
        withTempDir((dir) => {
            pngWorkspace(dir, { subject: '量子实验室场景', headline: HEADLINE });
            const result = run(['daily-cover-normalize', dir, '20260101']);
            expect(result.status).toBe(0);
            expect(result.stderr).toContain('cover composited');
            expect(pixelWidth(join(dir, '23-cover', '20260101_07_cover_cover.png'))).toBe('1344');
            expect(pixelWidth(join(dir, '23-cover', '20260101_07_cover_social.jpg'))).toBe('1200');
        });
    });
});
