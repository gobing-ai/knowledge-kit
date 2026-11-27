/**
 * G83/0445 — the native module API handler (the routing half of 0447's R2).
 *
 * The Spur server mounts `createBoardHandler().fetch` at `/api/modules/<id>/*` and strips its own
 * prefix, so the handler answers the module-relative paths the loopback reader serves. These are the
 * in-process assertions that the mounted surface exists and is not just a wrapper around a socket; the
 * full route matrix is the loopback reader's own suite.
 *
 * Failure list: a health call must answer without any server, the day routes must resolve through the
 * project the caller passes, an unknown path must stay a 404, and a non-GET must stay refused.
 */

import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBoardHandler } from '../../src/board/reader';

const DAY = '20261125';

/** A project root with one day directory whose evidence the day routes can project. */
function project(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kk-handler-')));
    const dayDir = join(root, '.works', 'kk-news-generate', DAY);
    mkdirSync(join(dayDir, '22-article'), { recursive: true });
    writeFileSync(
        join(dayDir, 'schedule-receipt.json'),
        JSON.stringify({ schemaVersion: 1, runId: 'run-1', status: 'done' }),
    );
    writeFileSync(join(dayDir, '22-article', `${DAY}_06_article-write_body.md`), 'body\n');
    return root;
}

/** A request the native mount would build: same origin, module-relative path. */
function request(path: string, origin = 'http://127.0.0.1:4310', method = 'GET'): Request {
    return new Request(`${origin}${path}`, { method, headers: { host: '127.0.0.1:4310' } });
}

describe('createBoardHandler (native module API)', () => {
    it('answers health without binding a socket', async () => {
        const root = project();
        const handler = createBoardHandler({ projectPath: root });
        const response = await handler.fetch(request('/api/health'));
        expect(response.status).toBe(200);
        expect(((await response.json()) as { projectPath: string }).projectPath).toBe(root);
    });

    it('answers a native LAN request without a loopback or CORS requirement', async () => {
        const root = project();
        const handler = createBoardHandler({ projectPath: root });
        const response = await handler.fetch(new Request('http://192.0.2.1:4310/api/health'));
        expect(response.status).toBe(200);
        expect(response.headers.has('access-control-allow-origin')).toBe(false);
    });

    it('answers the day digest and the editor artifact document', async () => {
        const root = project();
        const handler = createBoardHandler({ projectPath: root });
        const digest = await handler.fetch(request(`/api/days/${DAY}`));
        expect(digest.status).toBe(200);
        expect(((await digest.json()) as { day: string }).day).toBe(DAY);

        const artifact = await handler.fetch(request(`/api/days/${DAY}/artifacts/article`));
        expect(artifact.status).toBe(200);
        expect(((await artifact.json()) as { text: string }).text).toBe('body\n');
    });

    it('keeps the refusals: an unknown path is 404 and a POST there is 405', async () => {
        const root = project();
        const handler = createBoardHandler({ projectPath: root });
        expect((await handler.fetch(request('/api/nope'))).status).toBe(404);
        expect((await handler.fetch(request('/api/days', 'http://127.0.0.1:4310', 'PUT'))).status).toBe(405);
    });

    it('refuses a foreign origin even though the mount is same-origin', async () => {
        const root = project();
        const handler = createBoardHandler({ projectPath: root });
        const response = await handler.fetch(
            new Request('http://127.0.0.1:4310/api/health', {
                headers: { host: '127.0.0.1:4310', origin: 'http://evil.example' },
            }),
        );
        expect(response.status).toBe(403);
        expect(((await response.json()) as { code: string }).code).toBe('board.origin.refused');
    });
});
