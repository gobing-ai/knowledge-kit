import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runItcStage } from '../src/itc-stage';

/**
 * 0303 — the ITC stage dispatcher boundary.
 *
 * It owns ONE decision: which stage names the native handler claims. Every non-ITC name must fall
 * through with `undefined` so the legacy `runStage` subprocess path still serves it, and every
 * claimed name must reach its handler and report an actionable failure instead of throwing.
 */

async function withTempDir(fn: (dir: string) => Promise<void> | void): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), 'kk-itc-stage-'));
    try {
        await fn(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

describe('runItcStage dispatch boundary', () => {
    it('returns undefined for every non-ITC stage so the legacy runner takes over', async () => {
        expect(await runItcStage([])).toBeUndefined();
        expect(await runItcStage(['daily-publish-partial', '/tmp/w'])).toBeUndefined();
        expect(await runItcStage(['prepare-itc', '/tmp/w'])).toBeUndefined();
        expect(await runItcStage(['itc-materialize', '/tmp/w'])).toBeUndefined();
        expect(await runItcStage(['itc-outline-pick', '/tmp/w'])).toBeUndefined();
    });

    it('claims every native ITC stage and reports a missing request file instead of throwing', async () => {
        for (const stage of [
            'itc-publish-plan',
            'itc-topic-extract',
            'itc-topic-validate',
            'itc-topic-select',
            'itc-selection-settle',
            'itc-decision',
            'itc-author-complete',
            'itc-author-verdict',
            'itc-materialize-plan',
            'itc-check-targets',
            'itc-send-targets',
            'itc-reconcile-receipts',
            'itc-export-seo',
            'itc-report-summary',
            'itc-prepare',
        ]) {
            const result = await runItcStage([stage, '/tmp/definitely-absent-workspace']);
            expect(result, stage).not.toBeUndefined();
        }
    });

    it('fails loud on a non-JSON request body rather than crashing', async () => {
        await withTempDir(async (dir) => {
            const request = join(dir, 'launch.json');
            writeFileSync(request, 'not json at all');
            const result = await runItcStage(['itc-prepare', '--request', request]);
            expect(result).toBe(1);
        });
    });

    it('a valid launch resolves and writes ONLY under the pinned HOME', async () => {
        await withTempDir(async (dir) => {
            const home = join(dir, 'home');
            const request = join(dir, 'launch.json');
            writeFileSync(request, JSON.stringify({ topic: 'reliable-workflows', parentRunId: 'run-x' }));

            // The stage reads the ambient env, so pin HOME for the duration — never the operator's.
            const priorHome = process.env.HOME;
            const priorConfig = process.env.KK_CONFIG;
            const priorWorks = process.env.KK_WORKS_DIR;
            process.env.HOME = home;
            delete process.env.KK_CONFIG;
            delete process.env.KK_WORKS_DIR;
            let result: number | undefined;
            try {
                result = await runItcStage(['itc-prepare', '--request', request]);
            } finally {
                if (priorHome === undefined) delete process.env.HOME;
                else process.env.HOME = priorHome;
                if (priorConfig !== undefined) process.env.KK_CONFIG = priorConfig;
                if (priorWorks !== undefined) process.env.KK_WORKS_DIR = priorWorks;
            }
            expect(result).toBe(0);
            expect(existsSync(join(home, '.config/kk/works/kk-itc/reliable-workflows/itc-options.json'))).toBe(true);
        });
    });
});
