import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, type Store } from '@gobing-ai/kk-store';
import { runItcStage } from '../src/itc-stage';
import { itcSelectionSettle, itcTopicExtract, itcTopicSelect, itcTopicValidate } from '../src/itc-topic';
import { silenceOutputPerTest } from './capture';

// Stage stdout is the workflow protocol and stderr is operator diagnostics; neither is this
// suite's subject, so the seam's default targets are silenced for every test here.
silenceOutputPerTest();

async function withTempDir(fn: (dir: string) => Promise<void> | void): Promise<void> {
    const tempDir = mkdtempSync(join(tmpdir(), 'kk-itc-topic-test-'));
    try {
        await fn(tempDir);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

interface TestStoreData {
    store: Store;
    itemIds: string[];
}

async function seedTestStore(dbPath: string): Promise<TestStoreData> {
    const store = await openStore({ path: dbPath });
    const now = Date.now();
    const upsertRes = await store.items.upsertDocs(
        'seed-run',
        [
            {
                id: 'raw-1',
                title: 'AI Model Breakthrough',
                body: 'Detailed report on recent model architecture improvements.',
                sourceUri: 'https://example.com/item-1',
                mediaType: 'text/html',
                metadata: {},
            },
            {
                id: 'raw-2',
                title: 'Open Source Inference Engine',
                body: 'New runtime enables faster local LLM execution.',
                sourceUri: 'https://example.com/item-2',
                mediaType: 'text/html',
                metadata: {},
            },
            {
                id: 'raw-3',
                title: 'Hardware Acceleration Trends',
                body: 'Comparative benchmarks across edge devices.',
                sourceUri: 'https://example.com/item-3',
                mediaType: 'text/html',
                metadata: {},
            },
        ],
        now,
    );

    const itemIds = upsertRes.newIds;
    for (const id of itemIds) {
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
    return { store, itemIds };
}

function writeSampleProfile(profilePath: string): void {
    const yaml = `topic: test-topic
where:
  kk-item-category: { in: [ai-news] }
  kk-item-quality: { gte: 2 }
  kk-item-importance: { gte: 3 }
  kk-item-china-politics: { lte: 1 }
order: [first_seen_at desc]
`;
    writeFileSync(profilePath, yaml);
}

describe('itcTopicExtract (0299 / G21 R1, R2)', () => {
    it('extracts non-empty pool, writes topic-pool.json and topic-pool-manifest.json with poolDigest', async () => {
        await withTempDir(async (dir) => {
            const dbPath = join(dir, 'store.db');
            const { store } = await seedTestStore(dbPath);
            await store.close();

            const profilePath = join(dir, 'test-topic.yaml');
            writeSampleProfile(profilePath);

            const intakeDir = join(dir, 'intake');
            const res = await itcTopicExtract({
                schemaVersion: 1,
                parentRunId: 'run-001',
                intakeDir,
                topicProfile: 'test-topic',
                profilePath,
                dbPath,
                window: '24h',
                limit: 10,
            });

            expect(res.count).toBe(3);
            expect(res.poolDigest).toBeDefined();

            const poolPath = join(intakeDir, 'topic-pool.json');
            const manifestPath = join(intakeDir, 'topic-pool-manifest.json');
            expect(existsSync(poolPath)).toBe(true);
            expect(existsSync(manifestPath)).toBe(true);

            const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
            expect(manifest.parentRunId).toBe('run-001');
            expect(manifest.topicProfile).toBe('test-topic');
            expect(manifest.poolDigest).toBe(res.poolDigest);

            const pool = JSON.parse(readFileSync(poolPath, 'utf-8'));
            expect(pool).toHaveLength(3);
            expect(pool.map((p: { sourceUri: string }) => p.sourceUri).sort()).toEqual([
                'https://example.com/item-1',
                'https://example.com/item-2',
                'https://example.com/item-3',
            ]);
        });
    });

    it('stops safely on empty pool and reports no usable topic', async () => {
        await withTempDir(async (dir) => {
            const dbPath = join(dir, 'empty.db');
            const store = await openStore({ path: dbPath });
            await store.close();

            const profilePath = join(dir, 'test-topic.yaml');
            writeSampleProfile(profilePath);

            const intakeDir = join(dir, 'intake');
            await expect(
                itcTopicExtract({
                    schemaVersion: 1,
                    parentRunId: 'run-empty',
                    intakeDir,
                    topicProfile: 'test-topic',
                    profilePath,
                    dbPath,
                }),
            ).rejects.toThrow('collection store pool is empty');

            expect(existsSync(join(intakeDir, 'topic-pool.json'))).toBe(false);
        });
    });

    it('reports failure when an explicitly requested refresh failed and store is empty', async () => {
        await withTempDir(async (dir) => {
            const dbPath = join(dir, 'empty.db');
            const store = await openStore({ path: dbPath });
            await store.close();

            const profilePath = join(dir, 'test-topic.yaml');
            writeSampleProfile(profilePath);

            const intakeDir = join(dir, 'intake');
            await expect(
                itcTopicExtract({
                    schemaVersion: 1,
                    parentRunId: 'run-failed-refresh',
                    intakeDir,
                    topicProfile: 'test-topic',
                    profilePath,
                    dbPath,
                    refreshRun: { runId: 'collect-01', status: 'failed' },
                }),
            ).rejects.toThrow('requested collection refresh failed (failed)');
        });
    });
});

describe('itcTopicValidate (0299 / G21 R1)', () => {
    it('validates 1–5 candidate slots (ids a–e) citing valid item IDs and source URLs', async () => {
        await withTempDir(async (dir) => {
            const dbPath = join(dir, 'store.db');
            const { store, itemIds } = await seedTestStore(dbPath);
            await store.close();

            const profilePath = join(dir, 'test-topic.yaml');
            writeSampleProfile(profilePath);

            const intakeDir = join(dir, 'intake');
            const { poolDigest } = await itcTopicExtract({
                schemaVersion: 1,
                parentRunId: 'run-val',
                intakeDir,
                topicProfile: 'test-topic',
                profilePath,
                dbPath,
            });

            // Write valid candidates artifact
            const candidates = [
                {
                    id: 'a',
                    title: 'Model Breakthrough and Inference',
                    reason: 'Cohesive narrative on recent model advances.',
                    itemIds: [itemIds[0], itemIds[1]],
                    sourceUrls: ['https://example.com/item-1', 'https://example.com/item-2'],
                },
                {
                    id: 'b',
                    title: 'Edge Hardware Trends',
                    reason: 'Focus on inference speed and hardware benchmarks.',
                    itemIds: [itemIds[1], itemIds[2]],
                    sourceUrls: ['https://example.com/item-2', 'https://example.com/item-3'],
                },
            ];

            writeFileSync(
                join(intakeDir, 'topic-candidates.json'),
                JSON.stringify({
                    schemaVersion: 1,
                    parentRunId: 'run-val',
                    poolDigest,
                    candidates,
                }),
            );

            const res = await itcTopicValidate({
                schemaVersion: 1,
                intakeDir,
                parentRunId: 'run-val',
            });
            expect(res.valid).toBe(true);
            expect(existsSync(join(intakeDir, '.topic-candidates-valid'))).toBe(true);
        });
    });

    it('accepts five candidate slots a–e and refuses a sixth', async () => {
        await withTempDir(async (dir) => {
            const dbPath = join(dir, 'store.db');
            const { store, itemIds } = await seedTestStore(dbPath);
            await store.close();
            const profilePath = join(dir, 'test-topic.yaml');
            writeSampleProfile(profilePath);
            const intakeDir = join(dir, 'intake');
            const { poolDigest } = await itcTopicExtract({
                schemaVersion: 1,
                parentRunId: 'run-val-five',
                intakeDir,
                topicProfile: 'test-topic',
                profilePath,
                dbPath,
            });
            // One item per slot repeated across ids: enough for five valid candidates.
            const slot = (id: 'a' | 'b' | 'c' | 'd' | 'e', poolIdx: number) => ({
                id,
                title: `Candidate ${id}`,
                reason: `Rationale for slot ${id}.`,
                itemIds: [itemIds[poolIdx]],
                sourceUrls: [`https://example.com/item-${poolIdx + 1}`],
            });
            const five = [
                slot('a', 0),
                slot('b', 1),
                slot('c', 2),
                slot('d', 1),
                slot('e', 2),
            ];
            const write = (candidates: object[]): void =>
                writeFileSync(
                    join(intakeDir, 'topic-candidates.json'),
                    JSON.stringify({ schemaVersion: 1, parentRunId: 'run-val-five', poolDigest, candidates }),
                );
            write(five);
            await expect(
                itcTopicValidate({ schemaVersion: 1, intakeDir, parentRunId: 'run-val-five' }),
            ).resolves.toMatchObject({ valid: true });

            // A sixth slot exceeds the widened cap of five.
            write([
                ...five,
                { id: 'b', title: 'Sixth', reason: 'Over the cap.', itemIds: [itemIds[0]], sourceUrls: ['https://example.com/item-1'] },
            ]);
            await expect(
                itcTopicValidate({ schemaVersion: 1, intakeDir, parentRunId: 'run-val-five' }),
            ).rejects.toThrow('invalid topic candidates artifact');
        });
    });

    it('rejects an out-of-slot candidate id beyond e', async () => {
        await withTempDir(async (dir) => {
            const dbPath = join(dir, 'store.db');
            const { store, itemIds } = await seedTestStore(dbPath);
            await store.close();
            const profilePath = join(dir, 'test-topic.yaml');
            writeSampleProfile(profilePath);
            const intakeDir = join(dir, 'intake');
            const { poolDigest } = await itcTopicExtract({
                schemaVersion: 1,
                parentRunId: 'run-val-f',
                intakeDir,
                topicProfile: 'test-topic',
                profilePath,
                dbPath,
            });
            writeFileSync(
                join(intakeDir, 'topic-candidates.json'),
                JSON.stringify({
                    schemaVersion: 1,
                    parentRunId: 'run-val-f',
                    poolDigest,
                    candidates: [
                        {
                            id: 'f',
                            title: 'Model Breakthrough',
                            reason: 'Slot f does not exist.',
                            itemIds: [itemIds[0]],
                            sourceUrls: ['https://example.com/item-1'],
                        },
                    ],
                }),
            );
            await expect(
                itcTopicValidate({ schemaVersion: 1, intakeDir, parentRunId: 'run-val-f' }),
            ).rejects.toThrow('invalid topic candidates artifact');
        });
    });

    it('rejects candidates citing unknown item IDs not present in topic pool', async () => {
        await withTempDir(async (dir) => {
            const dbPath = join(dir, 'store.db');
            const { store } = await seedTestStore(dbPath);
            await store.close();

            const profilePath = join(dir, 'test-topic.yaml');
            writeSampleProfile(profilePath);

            const intakeDir = join(dir, 'intake');
            const { poolDigest } = await itcTopicExtract({
                schemaVersion: 1,
                parentRunId: 'run-val-bad',
                intakeDir,
                topicProfile: 'test-topic',
                profilePath,
                dbPath,
            });

            writeFileSync(
                join(intakeDir, 'topic-candidates.json'),
                JSON.stringify({
                    schemaVersion: 1,
                    parentRunId: 'run-val-bad',
                    poolDigest,
                    candidates: [
                        {
                            id: 'a',
                            title: 'Unknown Doc',
                            reason: 'Narrative',
                            itemIds: ['nonexistent-id'],
                            sourceUrls: ['https://example.com/nonexistent'],
                        },
                    ],
                }),
            );

            await expect(
                itcTopicValidate({
                    schemaVersion: 1,
                    intakeDir,
                    parentRunId: 'run-val-bad',
                }),
            ).rejects.toThrow("cites unknown item ID 'nonexistent-id'");
        });
    });

    it('rejects candidates with stale poolDigest mismatch', async () => {
        await withTempDir(async (dir) => {
            const dbPath = join(dir, 'store.db');
            const { store, itemIds } = await seedTestStore(dbPath);
            await store.close();

            const profilePath = join(dir, 'test-topic.yaml');
            writeSampleProfile(profilePath);

            const intakeDir = join(dir, 'intake');
            await itcTopicExtract({
                schemaVersion: 1,
                parentRunId: 'run-stale',
                intakeDir,
                topicProfile: 'test-topic',
                profilePath,
                dbPath,
            });

            writeFileSync(
                join(intakeDir, 'topic-candidates.json'),
                JSON.stringify({
                    schemaVersion: 1,
                    parentRunId: 'run-stale',
                    poolDigest: 'stale-digest-12345',
                    candidates: [
                        {
                            id: 'a',
                            title: 'Title',
                            reason: 'Reason',
                            itemIds: [itemIds[0]],
                            sourceUrls: ['https://example.com/item-1'],
                        },
                    ],
                }),
            );

            await expect(
                itcTopicValidate({
                    schemaVersion: 1,
                    intakeDir,
                    parentRunId: 'run-stale',
                }),
            ).rejects.toThrow('stale candidates: poolDigest mismatch');
        });
    });
});

describe('itcTopicSelect & itcSelectionSettle (0299 / G21 R1, R2)', () => {
    it('selects chosen candidate subset, writes chosen-source.json, and settles published outcome', async () => {
        await withTempDir(async (dir) => {
            const dbPath = join(dir, 'store.db');
            const { store, itemIds } = await seedTestStore(dbPath);
            await store.close();

            const profilePath = join(dir, 'test-topic.yaml');
            writeSampleProfile(profilePath);

            const intakeDir = join(dir, 'intake');
            const { poolDigest } = await itcTopicExtract({
                schemaVersion: 1,
                parentRunId: 'run-select',
                intakeDir,
                topicProfile: 'test-topic',
                profilePath,
                dbPath,
            });

            writeFileSync(
                join(intakeDir, 'topic-candidates.json'),
                JSON.stringify({
                    schemaVersion: 1,
                    parentRunId: 'run-select',
                    poolDigest,
                    candidates: [
                        {
                            id: 'b',
                            title: 'Selected Edge Story',
                            reason: 'Hardware narrative',
                            itemIds: [itemIds[1], itemIds[2]],
                            sourceUrls: ['https://example.com/item-2', 'https://example.com/item-3'],
                        },
                    ],
                }),
            );

            const selRes = await itcTopicSelect({
                schemaVersion: 1,
                intakeDir,
                parentRunId: 'run-select',
                selectedCandidateId: 'b',
                dbPath,
            });

            const id1 = itemIds[1] ?? '';
            const id2 = itemIds[2] ?? '';
            expect(selRes.selectedCandidateId).toBe('b');
            expect(selRes.itemIds).toEqual([id1, id2]);

            const chosen = JSON.parse(readFileSync(join(intakeDir, 'chosen-source.json'), 'utf-8'));
            expect(chosen.topicName).toBe('Selected Edge Story');
            expect(chosen.itemIds).toEqual([id1, id2]);
            expect(existsSync(chosen.selectedDocsPath)).toBe(true);

            // Settle as published
            const settleRes = await itcSelectionSettle({
                schemaVersion: 1,
                intakeDir,
                parentRunId: 'run-select',
                topicProfile: 'test-topic',
                outcome: 'published',
                dbPath,
            });

            expect(settleRes.action).toBe('marked_published');
            expect(settleRes.settled).toBe(2);

            // Verify in store
            const checkStore = await openStore({ path: dbPath });
            const selections = await checkStore.selections.listByRun('run-select');
            expect(selections).toHaveLength(2);
            expect(selections.every((s) => s.status === 'published')).toBe(true);
            await checkStore.close();
        });
    });

    it('settles failed or author-only outcome by releasing this run selection back to pool', async () => {
        await withTempDir(async (dir) => {
            const dbPath = join(dir, 'store.db');
            const { store, itemIds } = await seedTestStore(dbPath);
            await store.close();

            const profilePath = join(dir, 'test-topic.yaml');
            writeSampleProfile(profilePath);

            const intakeDir = join(dir, 'intake');
            const { poolDigest } = await itcTopicExtract({
                schemaVersion: 1,
                parentRunId: 'run-fail',
                intakeDir,
                topicProfile: 'test-topic',
                profilePath,
                dbPath,
            });

            writeFileSync(
                join(intakeDir, 'topic-candidates.json'),
                JSON.stringify({
                    schemaVersion: 1,
                    parentRunId: 'run-fail',
                    poolDigest,
                    candidates: [
                        {
                            id: 'a',
                            title: 'Failed Run Story',
                            reason: 'Test',
                            itemIds: [itemIds[0]],
                            sourceUrls: ['https://example.com/item-1'],
                        },
                    ],
                }),
            );

            await itcTopicSelect({
                schemaVersion: 1,
                intakeDir,
                parentRunId: 'run-fail',
                selectedCandidateId: 'a',
                dbPath,
            });

            // Settle as failed
            const settleRes = await itcSelectionSettle({
                schemaVersion: 1,
                intakeDir,
                parentRunId: 'run-fail',
                topicProfile: 'test-topic',
                outcome: 'failed',
                dbPath,
            });

            expect(settleRes.action).toBe('released');
            expect(settleRes.settled).toBe(1);

            const checkStore = await openStore({ path: dbPath });
            const selections = await checkStore.selections.listByRun('run-fail');
            expect(selections[0]?.status).toBe('dropped');
            await checkStore.close();
        });
    });

    it('settles uncertain outcome by retaining selection and writing reconciliation record', async () => {
        await withTempDir(async (dir) => {
            const dbPath = join(dir, 'store.db');
            const { store, itemIds } = await seedTestStore(dbPath);
            await store.close();

            const profilePath = join(dir, 'test-topic.yaml');
            writeSampleProfile(profilePath);

            const intakeDir = join(dir, 'intake');
            const { poolDigest } = await itcTopicExtract({
                schemaVersion: 1,
                parentRunId: 'run-uncertain',
                intakeDir,
                topicProfile: 'test-topic',
                profilePath,
                dbPath,
            });

            writeFileSync(
                join(intakeDir, 'topic-candidates.json'),
                JSON.stringify({
                    schemaVersion: 1,
                    parentRunId: 'run-uncertain',
                    poolDigest,
                    candidates: [
                        {
                            id: 'a',
                            title: 'Uncertain Story',
                            reason: 'Test',
                            itemIds: [itemIds[0]],
                            sourceUrls: ['https://example.com/item-1'],
                        },
                    ],
                }),
            );

            await itcTopicSelect({
                schemaVersion: 1,
                intakeDir,
                parentRunId: 'run-uncertain',
                selectedCandidateId: 'a',
                dbPath,
            });

            // Settle as uncertain
            const settleRes = await itcSelectionSettle({
                schemaVersion: 1,
                intakeDir,
                parentRunId: 'run-uncertain',
                topicProfile: 'test-topic',
                outcome: 'uncertain',
                dbPath,
            });

            expect(settleRes.action).toBe('reconcile_retained');
            expect(existsSync(join(intakeDir, '.selection-reconcile.json'))).toBe(true);

            // Row in store stays selected (not released, not marked published)
            const checkStore = await openStore({ path: dbPath });
            const selections = await checkStore.selections.listByRun('run-uncertain');
            expect(selections[0]?.status).toBe('selected');
            await checkStore.close();
        });
    });
});

describe('stage run itc-topic-* CLI execution (0299 / G21 R1, R2)', () => {
    it('executes itc-topic-extract via CLI request file', async () => {
        await withTempDir(async (dir) => {
            const dbPath = join(dir, 'cli-store.db');
            const { store } = await seedTestStore(dbPath);
            await store.close();

            const profilePath = join(dir, 'test-topic.yaml');
            writeSampleProfile(profilePath);

            const intakeDir = join(dir, 'intake');
            const reqFile = join(dir, 'extract-req.json');
            writeFileSync(
                reqFile,
                JSON.stringify({
                    schemaVersion: 1,
                    parentRunId: 'cli-run',
                    intakeDir,
                    topicProfile: 'test-topic',
                    profilePath,
                    dbPath,
                }),
            );

            const code = await runItcStage(['itc-topic-extract', '--request', reqFile]);
            expect(code).toBe(0);
            expect(existsSync(join(intakeDir, 'topic-pool.json'))).toBe(true);
        });
    });
});

describe('itc-topic-* request boundary and validation guards (0299 R1)', () => {
    async function seedIntake(dir: string, runId: string) {
        const dbPath = join(dir, 'store.db');
        const { store, itemIds } = await seedTestStore(dbPath);
        await store.close();
        const profilePath = join(dir, 'test-topic.yaml');
        writeSampleProfile(profilePath);
        const intakeDir = join(dir, 'intake');
        const { poolDigest } = await itcTopicExtract({
            schemaVersion: 1,
            parentRunId: runId,
            intakeDir,
            topicProfile: 'test-topic',
            profilePath,
            dbPath,
        });
        const candidate = {
            id: 'a',
            title: 'Edge Story',
            reason: 'r',
            itemIds: [itemIds[1] ?? '', itemIds[2] ?? ''],
            sourceUrls: ['https://example.com/item-2', 'https://example.com/item-3'],
        };
        const writeCandidates = (overrides: Record<string, unknown> = {}, candidates: unknown[] = [candidate]) =>
            writeFileSync(
                join(intakeDir, 'topic-candidates.json'),
                JSON.stringify({ schemaVersion: 1, parentRunId: runId, poolDigest, candidates, ...overrides }),
            );
        return { dbPath, profilePath, intakeDir, candidate, writeCandidates };
    }
    const stage = (dir: string, name: string, body: unknown): Promise<number | undefined> => {
        const file = join(dir, `${name}-req.json`);
        writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
        return runItcStage([name, '--request', file]);
    };

    it('drives validate, select and settle through request files', async () => {
        await withTempDir(async (dir) => {
            const { dbPath, intakeDir, writeCandidates } = await seedIntake(dir, 'run-cli');
            writeCandidates();
            const base = { schemaVersion: 1, intakeDir, parentRunId: 'run-cli' };
            expect(await stage(dir, 'itc-topic-validate', base)).toBe(0);
            expect(await stage(dir, 'itc-topic-select', { ...base, selectedCandidateId: 'a', dbPath })).toBe(0);
            // A corrupt chosen source settles by run, not by its (unreadable) item list.
            writeFileSync(join(intakeDir, 'chosen-source.json'), '{corrupt');
            const settle = { ...base, topicProfile: 'test-topic', outcome: 'failed', dbPath };
            expect(await stage(dir, 'itc-selection-settle', settle)).toBe(0);
        });
    });

    it('refuses a missing flag, a missing file, non-JSON and off-schema requests', async () => {
        await withTempDir(async (dir) => {
            for (const name of [
                'itc-topic-extract',
                'itc-topic-validate',
                'itc-topic-select',
                'itc-selection-settle',
            ]) {
                expect(await runItcStage([name]), name).toBe(1);
                expect(await runItcStage([name, '--request', join(dir, 'absent.json')]), name).toBe(1);
                expect(await stage(dir, name, '{nope'), name).toBe(1);
                expect(await stage(dir, name, { schemaVersion: 1 }), name).toBe(1);
            }
        });
    });

    it('rejects a malformed or zero window and a profile found nowhere', async () => {
        await withTempDir(async (dir) => {
            const req = {
                schemaVersion: 1 as const,
                parentRunId: 'r',
                intakeDir: join(dir, 'i'),
                topicProfile: 'test-topic',
            };
            const profilePath = join(dir, 'p.yaml');
            writeSampleProfile(profilePath);
            await expect(itcTopicExtract({ ...req, profilePath, window: 'soon' })).rejects.toThrow('--window must be');
            await expect(itcTopicExtract({ ...req, profilePath, window: '0h' })).rejects.toThrow('greater than zero');
            const priorCwd = process.cwd();
            process.chdir(dir);
            try {
                await expect(
                    itcTopicExtract({ ...req, topicProfile: 'nowhere', profilePath: join(dir, 'absent.yaml') }),
                ).rejects.toThrow("no profile for topic 'nowhere'");
            } finally {
                process.chdir(priorCwd);
            }
        });
    });

    it('validate refuses missing artifacts, an off-schema artifact, a foreign run, duplicates and unmatched URLs', async () => {
        await withTempDir(async (dir) => {
            const { intakeDir, candidate, writeCandidates } = await seedIntake(dir, 'run-g');
            const validate = () => itcTopicValidate({ schemaVersion: 1, intakeDir, parentRunId: 'run-g' });
            await expect(validate()).rejects.toThrow('topic-candidates.json not found');
            await expect(
                itcTopicValidate({ schemaVersion: 1, intakeDir: join(dir, 'none'), parentRunId: 'run-g' }),
            ).rejects.toThrow('topic pool artifacts not found');
            writeCandidates({ candidates: 'nope' });
            await expect(validate()).rejects.toThrow('invalid topic candidates artifact');
            writeCandidates({ parentRunId: 'run-other' });
            await expect(validate()).rejects.toThrow('parentRunId mismatch');
            writeCandidates({}, [candidate, candidate]);
            await expect(validate()).rejects.toThrow("duplicate candidate id 'a'");
            writeCandidates({}, [{ ...candidate, sourceUrls: ['https://elsewhere.test/'] }]);
            await expect(validate()).rejects.toThrow('does not match any referenced item sourceUri');
            writeCandidates();
            await expect(
                itcTopicSelect({ schemaVersion: 1, intakeDir, parentRunId: 'run-g', selectedCandidateId: 'b' }),
            ).rejects.toThrow("selected candidate 'b' not found");
        });
    });
});
