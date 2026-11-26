/**
 * G83/0439 — the reader's day routes (feature R4/AC1, task R4).
 *
 * Failure list written before the code (each is a refusal with nothing invented):
 * 1. `GET /api/days/<day>` answers the same digest the CLI renders, with no Board call;
 * 2. a day that has no directory is 404 naming the path, never an empty 200;
 * 3. a malformed day key is 400 before any filesystem read;
 * 4. the day route refuses query parameters, exactly like every shipped non-store route;
 * 5. `GET /api/days?from&until` answers the bounded list newest-first;
 * 6. a missing, inverted, malformed or oversized range is 400, and an unknown key is 400.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DailyDigest, DaySummary } from '@gobing-ai/kk-board/contracts';
import { type BoardReader, createBoardReader } from '../../src/board/reader';

const servers: BoardReader[] = [];

afterAll(() => {
    for (const server of servers) server.stop();
});

function tempDir(prefix: string): string {
    return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

/** A project root with one settled day (receipt + one publish window). */
function seededDay(day: string): string {
    const root = tempDir('kk-reader-days-');
    const dir = join(root, '.works', 'kk-news-generate', day);
    mkdirSync(join(dir, '4-publish'), { recursive: true });
    writeFileSync(
        join(dir, 'schedule-receipt.json'),
        JSON.stringify({ schemaVersion: 1, runId: `kk-news-generate-${day}-1`, status: 'done' }),
    );
    writeFileSync(
        join(dir, '4-publish', 'schedule-receipt.after-generate.json'),
        JSON.stringify({
            schemaVersion: 1,
            window: 'after-generate',
            runId: `kk-publish-${day}-1`,
            status: 'done',
        }),
    );
    return root;
}

function startReader(projectPath: string): string {
    // The reader requires a loopback Board origin; the day projection never calls the Board.
    const reader = createBoardReader({ boardOrigin: 'http://127.0.0.1:4340', port: 0, projectPath });
    servers.push(reader);
    return reader.url;
}

describe('GET /api/days/<day> (task R4)', () => {
    it('answers the day digest', async () => {
        const root = seededDay('29991212');
        const url = startReader(root);
        const response = await fetch(`${url}/api/days/29991212`);
        expect(response.status).toBe(200);
        const digest = (await response.json()) as DailyDigest;
        expect(digest.day).toBe('29991212');
        expect(digest.generation.runId).toBe('kk-news-generate-29991212-1');
        expect(digest.windows.find((window) => window.window === 'after-generate')?.launchStatus).toBe('done');
    });

    it('answers 404 with the looked-up path for a day that does not exist', async () => {
        const root = seededDay('29991211');
        const url = startReader(root);
        const response = await fetch(`${url}/api/days/29990101`);
        expect(response.status).toBe(404);
        const body = (await response.json()) as { code: string; message: string };
        expect(body.code).toBe('board.day.not-found');
        expect(body.message).toContain(join('kk-news-generate', '29990101'));
    });

    it('refuses a malformed day key and any query parameter', async () => {
        const url = startReader(seededDay('29991210'));
        expect((await fetch(`${url}/api/days/2026-11-10`)).status).toBe(400);
        expect((await fetch(`${url}/api/days/29991210?from=29991201`)).status).toBe(400);
        const refused = (await fetch(`${url}/api/days/29991210?window=cn-peak`)).json() as Promise<{ code: string }>;
        expect((await refused).code).toBe('board.query.invalid');
    });
});

describe('GET /api/days?from&until (task R4)', () => {
    it('answers the bounded day list newest-first', async () => {
        const root = seededDay('29991209');
        const second = join(root, '.works', 'kk-news-generate', '29991208');
        mkdirSync(second, { recursive: true });
        writeFileSync(
            join(second, 'schedule-receipt.json'),
            JSON.stringify({ schemaVersion: 1, runId: 'kk-news-generate-29991208-1', status: 'done' }),
        );
        const url = startReader(root);
        const response = await fetch(`${url}/api/days?from=29991201&until=29991231`);
        expect(response.status).toBe(200);
        const days = (await response.json()) as DaySummary[];
        expect(days.map((day) => day.day)).toEqual(['29991209', '29991208']);
    });

    it('refuses a missing, inverted, malformed, oversized or unknown range', async () => {
        const url = startReader(seededDay('29991207'));
        expect((await fetch(`${url}/api/days`)).status).toBe(400);
        expect((await fetch(`${url}/api/days?from=29991209&until=29991201`)).status).toBe(400);
        expect((await fetch(`${url}/api/days?from=2020-01-01&until=29991201`)).status).toBe(400);
        expect((await fetch(`${url}/api/days?from=20200101&until=20201231`)).status).toBe(400);
        expect((await fetch(`${url}/api/days?from=29991201&until=29991231&page=2`)).status).toBe(400);
    });
});
