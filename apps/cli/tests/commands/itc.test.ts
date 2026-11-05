import { describe, expect, it } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '@gobing-ai/kk-store';
import { main } from '../../src/main';
import { captureOutput, silenceOutputPerTest } from '../capture';

// The shortlist print is the verb's stdout protocol; silence it for the dots reporter and
// capture explicitly inside the tests that assert it.
silenceOutputPerTest();

/** Pin env keys for one call so the decision spawn sees a stub spur, never the operator's catalog. */
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
    const prior = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    for (const [k, v] of Object.entries(vars)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    try {
        return await fn();
    } finally {
        for (const [k, v] of Object.entries(prior)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
}

async function withTempDir(fn: (dir: string) => Promise<void> | void): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), 'kk-itc-cand-'));
    try {
        await fn(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

/** A stub `spur decision run` answering with a fixed value, like itc-stage.test's stub. */
function stubSpur(dir: string, value: string): string {
    const bin = join(dir, 'spur-stub');
    writeFileSync(bin, `#!/bin/sh\nprintf '{"value":"${value}","reason":"stub","maker":"stub"}'\n`);
    chmodSync(bin, 0o755);
    return bin;
}

/** Seed three labelled items into a temp store — enough for three citable candidates. */
async function seedStore(dbPath: string): Promise<void> {
    const store = await openStore({ path: dbPath });
    const now = Date.now();
    const res = await store.items.upsertDocs(
        'seed-run',
        [
            {
                id: 'it-1',
                title: 'Kubernetes 2.0 announcement',
                body: 'Detailed report on the new scheduler architecture and migration path.',
                sourceUri: 'https://example.com/it-1',
                mediaType: 'text/html',
                metadata: {},
            },
            {
                id: 'it-2',
                title: 'Open source inference engine',
                body: 'New runtime enables faster local LLM execution on commodity hardware.',
                sourceUri: 'https://example.com/it-2',
                mediaType: 'text/html',
                metadata: {},
            },
            {
                id: 'it-3',
                title: 'Edge acceleration trends',
                body: 'Comparative benchmarks across edge devices and build costs.',
                sourceUri: 'https://example.com/it-3',
                mediaType: 'text/html',
                metadata: {},
            },
        ],
        now,
    );
    for (const id of res.newIds) {
        const item = await store.items.findById(id);
        for (const [decisionId, value] of [
            ['kk-item-category', 'ai-news'],
            ['kk-item-quality', '2'],
            ['kk-item-importance', '3'],
            ['kk-item-china-politics', '0'],
        ] as const) {
            await store.labels.recordObservation(
                {
                    itemId: id,
                    decisionId,
                    value,
                    source: 'heuristic',
                    maker: 'test-maker',
                    runId: 'seed-run',
                    contentHash: item?.contentHash,
                },
                now,
            );
        }
    }
    await store.close();
}

describe('kk itc candidates CLI surface (item 2)', () => {
    it('runs the sweep through main() and reports the artifacts', async () => {
        await withTempDir(async (dir) => {
            const dbPath = join(dir, 'store.db');
            await seedStore(dbPath);
            const intakeDir = join(dir, 'intake');
            const cap = captureOutput();
            try {
                const code = await withEnv({ SPUR_BIN: stubSpur(dir, 'a') }, () =>
                    main([
                        'node',
                        'kk',
                        'itc',
                        'candidates',
                        '--profile',
                        'it-topics',
                        '--parent-run',
                        'cand-cli',
                        '--intake-dir',
                        intakeDir,
                        '--db',
                        dbPath,
                    ]),
                );
                expect(code).toBe(0);
                const printed = cap.read();
                expect(printed).toContain('"poolCount"');
                expect(printed).toContain('a — Kubernetes 2.0 announcement');
                expect(printed).toContain('decision: a (model)');
                expect(existsSync(join(intakeDir, 'topic-decision.json'))).toBe(true);
            } finally {
                cap.restore();
            }
        });
    });

    it('exits 1 with the kk.itc.candidates.failed contract on a bad --limit', async () => {
        await withTempDir(async (dir) => {
            const cap = captureOutput();
            try {
                const badLimit = await main([
                    'node',
                    'kk',
                    'itc',
                    'candidates',
                    '--profile',
                    'it-topics',
                    '--parent-run',
                    'r',
                    '--intake-dir',
                    join(dir, 'i'),
                    '--limit',
                    'zero',
                ]);
                expect(badLimit).toBe(1);
                expect(cap.readErr()).toContain('kk.itc.candidates.failed');
            } finally {
                cap.restore();
            }
        });
    });

    it('exits 1 with the kk.itc.candidates.failed contract on an empty pool', async () => {
        await withTempDir(async (dir) => {
            const dbPath = join(dir, 'empty.db');
            const store = await openStore({ path: dbPath });
            await store.close();
            const cap = captureOutput();
            try {
                const emptyPool = await main([
                    'node',
                    'kk',
                    'itc',
                    'candidates',
                    '--profile',
                    'it-topics',
                    '--parent-run',
                    'r',
                    '--intake-dir',
                    join(dir, 'i2'),
                    '--db',
                    dbPath,
                ]);
                expect(emptyPool).toBe(1);
                expect(cap.readErr()).toContain('kk.itc.candidates.failed');
            } finally {
                cap.restore();
            }
        });
    });

    it('defaults the parent run id when the operator does not pin one', async () => {
        await withTempDir(async (dir) => {
            const dbPath = join(dir, 'store.db');
            await seedStore(dbPath);
            const intakeDir = join(dir, 'intake');
            const cap = captureOutput();
            try {
                const code = await withEnv({ SPUR_BIN: stubSpur(dir, 'a') }, () =>
                    main([
                        'node',
                        'kk',
                        'itc',
                        'candidates',
                        '--profile',
                        'it-topics',
                        '--intake-dir',
                        intakeDir,
                        '--db',
                        dbPath,
                    ]),
                );
                expect(code).toBe(0);
                const manifest = JSON.parse(readFileSync(join(intakeDir, 'topic-pool-manifest.json'), 'utf-8'));
                expect(manifest.parentRunId).toMatch(/^kk-itc-cand-\d{8}T\d{6}$/);
            } finally {
                cap.restore();
            }
        });
    });
});
