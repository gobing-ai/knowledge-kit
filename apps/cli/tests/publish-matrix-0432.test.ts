/**
 * Task 0432 regression (written before the fix): a live surfdash page whose cover the patch cannot
 * source must not fail the target, and the settlement record must say which of the two it is.
 *
 *  S1  held podcast row: the patch payload sources the cover from the surfdash receipt's own hosted
 *      URL, carries the run's local cover as the upload fallback and names the page URL (R1/R2)
 *  S2  a patch result that only skipped the cover is a WARNING — the stage exits 0, and the reason
 *      plus page URL are on stderr (R2/R3)
 *  S3  a genuine patch failure still fails the stage (failure semantics preserved)
 *  T1  settlement records `coverPatch: { status: skipped, pageUrl }` next to `unresolved: []` — the
 *      "content published, cover patch skipped" shape (R3)
 *  T2  a window whose surfdash row never published stays `unresolved` with no coverPatch diagnostic
 *      — the "content not published" shape (R3)
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runPublishMatrixSettle } from '../src/publish-matrix';
import { silenceOutputPerTest } from './capture';

const REPO = resolve(import.meta.dir, '../../..');
const STAGES = join(REPO, 'plugins/kk/scripts/kk-workflow-stages.ts');
const RUN_DATE = '2026-11-24';
const COMPACT = '20261124';
const PAGE_URL = 'https://surfing.salty.vip/zh/posts/20261124-261124';
const HOSTED_COVER = 'https://podcast-media.salty.vip/production/images/prepared-cover.png';

// The stage and the settle verb echo their decisions; the suite asserts persisted state.
silenceOutputPerTest();

const created: string[] = [];
function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    created.push(dir);
    return dir;
}
afterAll(() => {
    for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

function readJson(path: string): Record<string, unknown> {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
}

interface Fixture {
    root: string;
    workDir: string;
    publishDir: string;
    postPath: string;
}

/**
 * One day dir in the shape `publish-classify` + `publish-send` leave behind: a plan with the
 * surfdash row only (the podcast row is EXCLUDED by bundle safety, so it has no receipt at all),
 * its live receipt and aggregate, the outcome, and the run's rendered cover.
 */
function makeFixture(receiptStatus: 'succeeded' | 'failed' = 'succeeded'): Fixture {
    const root = tempDir('kk-publish-matrix-0432-');
    const workDir = join(root, COMPACT);
    const publishDir = join(workDir, '4-publish');
    const postPath = join(root, 'surfdash', 'content', 'posts', 'articles', 'zh', `${COMPACT}-261124`, 'index.md');
    mkdirSync(join(publishDir, 'receipts'), { recursive: true });
    mkdirSync(join(publishDir, 'payloads'), { recursive: true });
    mkdirSync(join(workDir, '23-cover'), { recursive: true });
    writeFileSync(join(workDir, '23-cover', `${COMPACT}_07_cover_cover.png`), 'png-bytes');

    const aggregatePath = join(publishDir, 'aggregate.surfdash.json');
    writeFileSync(
        aggregatePath,
        `${JSON.stringify(
            {
                ok: true,
                targets: [
                    {
                        target: 'surfdash-pub',
                        ok: true,
                        status: 'published',
                        url: PAGE_URL,
                        metadata: { postPath, coverUrl: HOSTED_COVER },
                    },
                ],
            },
            null,
            2,
        )}\n`,
    );

    const payloadPath = '4-publish/payloads/surfdash-pub.post.json';
    writeFileSync(
        join(workDir, payloadPath),
        `${JSON.stringify({ title: '每日AI资讯', format: 'markdown', body: '正文', metadata: {} }, null, 2)}\n`,
    );
    writeFileSync(
        join(publishDir, 'plan.after-generate.json'),
        `${JSON.stringify(
            {
                schemaVersion: 1,
                window: 'after-generate',
                bundleRunId: 'voice3-run-1',
                parentRunId: 'voice3-run-1',
                presetName: 'daily-ai-voice',
                presetDigest: 'seeded',
                runDate: RUN_DATE,
                excluded: [{ id: 'podcast-pub.episode', plugin: 'podcast-pub', reason: 'excluded by bundle safety' }],
                rows: [
                    {
                        id: 'surfdash-pub.post',
                        plugin: 'surfdash-pub',
                        operation: 'post',
                        variant: 'article',
                        tier: 0,
                        window: 'after-generate',
                        mode: 'live',
                        required: true,
                        approval: 'required',
                        status: 'planned',
                        payloadPath,
                        payloadDigest: 'seeded',
                    },
                ],
            },
            null,
            2,
        )}\n`,
    );
    const rowStatus = receiptStatus === 'succeeded' ? 'succeeded' : 'failed';
    writeFileSync(
        join(publishDir, 'outcome.after-generate.json'),
        `${JSON.stringify(
            {
                schemaVersion: 1,
                window: 'after-generate',
                runDate: RUN_DATE,
                status: receiptStatus === 'succeeded' ? 'full' : 'none',
                published: receiptStatus === 'succeeded' ? 1 : 0,
                targets: 1,
                excluded: [{ id: 'podcast-pub.episode', plugin: 'podcast-pub', reason: 'excluded by bundle safety' }],
                rows: [
                    {
                        id: 'surfdash-pub.post',
                        tier: 0,
                        required: true,
                        status: rowStatus,
                        effect: receiptStatus === 'succeeded' ? 'confirmed' : 'none',
                        dummy: false,
                    },
                ],
            },
            null,
            2,
        )}\n`,
    );
    writeFileSync(
        join(publishDir, 'publish-status.after-generate.txt'),
        receiptStatus === 'succeeded' ? 'full\n' : 'none\n',
    );
    writeFileSync(
        join(publishDir, 'receipts', 'surfdash-pub.post.json'),
        `${JSON.stringify(
            {
                schemaVersion: 1,
                parentRunId: 'voice3-run-1',
                planDigest: 'seeded',
                payloadDigest: 'seeded',
                plugin: 'surfdash-pub',
                profile: 'article',
                mode: 'live',
                attemptId: 'attempt-1',
                status: receiptStatus,
                effect: receiptStatus === 'succeeded' ? 'confirmed' : 'none',
                url: PAGE_URL,
                aggregatePath,
            },
            null,
            2,
        )}\n`,
    );
    return { root, workDir, publishDir, postPath };
}

/** A `kk` on PATH that records the patch result instead of running the plugin. */
function fakeKk(dir: string, result: Record<string, unknown>, exitCode: number): Record<string, string> {
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    const path = join(bin, 'kk');
    writeFileSync(
        path,
        `#!/usr/bin/env bun
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const out = args[args.indexOf('--out') + 1];
if (out) writeFileSync(out, process.env.FAKE_KK_RESULT ?? '{}');
process.exit(Number(process.env.FAKE_KK_EXIT ?? '1'));
`,
    );
    chmodSync(path, 0o755);
    return {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        FAKE_KK_RESULT: JSON.stringify(result),
        FAKE_KK_EXIT: String(exitCode),
    };
}

/** Run the shipped stage body in a child `bun`, returning its exit code and stderr. */
function runStage(args: string[], env: Record<string, string> = {}): { code: number; stderr: string } {
    const result = Bun.spawnSync(['bun', STAGES, 'publish-matrix-patch-surfdash', ...args], {
        cwd: REPO,
        env: { ...process.env, ...env },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    return { code: result.exitCode ?? 1, stderr: result.stderr?.toString() ?? '' };
}

describe('publish-matrix-patch-surfdash cover sourcing (0432 R1/R2)', () => {
    it('S1: a held podcast row sources the cover from the surfdash receipt and passes the local fallback', () => {
        const fx = makeFixture();
        const env = fakeKk(fx.root, { ok: true, target: 'surfdash-pub', message: 'patched 1 post(s)' }, 0);
        const { code } = runStage([fx.workDir, '--window', 'after-generate'], env);
        expect(code).toBe(0);
        const payload = readJson(join(fx.publishDir, 'patch-surfdash.payload.json')) as {
            options: Record<string, unknown>;
        };
        // No podcast row ran, so the surfdash side's own hosted cover is the source (R1) …
        expect(payload.options.coverUrl).toBe(HOSTED_COVER);
        // … and the run's rendered cover rides along as the plugin-side upload fallback (R1).
        expect(payload.options.localCover).toBe(join(fx.workDir, '23-cover', `${COMPACT}_07_cover_cover.png`));
        // The page URL is what the skip warning names (R2).
        expect(payload.options.pageUrl).toBe(PAGE_URL);
        // Nothing is fabricated from the missing podcast row.
        expect(payload.options.showNotesUrl).toBe('');
        rmSync(fx.root, { recursive: true, force: true });
    });

    it('S2: a cover skip is a warning — the stage exits 0 and names the reason and page URL', () => {
        const fx = makeFixture();
        const env = fakeKk(
            fx.root,
            {
                ok: false,
                target: 'surfdash-pub',
                error: 'patch error: zh post has no remote https:// cover',
                metadata: {
                    coverPatch: {
                        status: 'skipped',
                        applied: [],
                        skipped: ['zh', 'en'],
                        reason: 'zh/en post has no remote https:// cover',
                        pageUrl: PAGE_URL,
                    },
                },
            },
            1,
        );
        const { code, stderr } = runStage([fx.workDir, '--window', 'after-generate'], env);
        expect(code).toBe(0);
        expect(stderr).toContain('cover patch skipped');
        expect(stderr).toContain(PAGE_URL);
        expect(stderr).toContain('already live');
        rmSync(fx.root, { recursive: true, force: true });
    });

    it('S4: a skipped cover does not mask a failed CMS re-sync (review P2)', () => {
        // Both signals can arrive together: the posts are patched + committed (cover skipped) while the
        // CMS re-sync failed. The re-sync failure must still be reported, or the day looks clean.
        const fx = makeFixture();
        const env = fakeKk(
            fx.root,
            {
                ok: false,
                target: 'surfdash-pub',
                error: 'cms resync exited 1',
                metadata: {
                    cmsResync: 'failed',
                    coverPatch: {
                        status: 'skipped',
                        applied: [],
                        skipped: ['zh', 'en'],
                        reason: 'zh/en post has no remote https:// cover',
                        pageUrl: PAGE_URL,
                    },
                },
            },
            1,
        );
        const { code, stderr } = runStage([fx.workDir, '--window', 'after-generate'], env);
        expect(code).toBe(0);
        expect(stderr).toContain('cms re-sync failed');
        rmSync(fx.root, { recursive: true, force: true });
    });

    it('S3: a real patch failure still fails the stage', () => {
        const fx = makeFixture();
        const env = fakeKk(
            fx.root,
            { ok: false, target: 'surfdash-pub', error: 'patch: surfdash git push failed: rejected' },
            1,
        );
        const { code, stderr } = runStage([fx.workDir, '--window', 'after-generate'], env);
        expect(code).toBe(1);
        expect(stderr).toContain('git push failed');
        rmSync(fx.root, { recursive: true, force: true });
    });
});

describe('publish-matrix-settle cover-patch outcome (0432 R3)', () => {
    const settleExecutor = {
        run: async (options: { command: string; args: string[] }) => ({
            command: options.command,
            args: options.args,
            exitCode: 0,
            stdout: '',
            stderr: '',
            durationMs: 1,
        }),
        runStreaming: () => {
            throw new Error('not used');
        },
    } as never;

    it('T1: a published page with a skipped cover patch settles marked, with the diagnostic attached', async () => {
        const fx = makeFixture();
        writeFileSync(
            join(fx.publishDir, 'patch-surfdash.result.json'),
            `${JSON.stringify(
                {
                    ok: true,
                    target: 'surfdash-pub',
                    message: 'patched 0 post(s)',
                    metadata: {
                        cmsResync: 'ok',
                        coverPatch: {
                            status: 'skipped',
                            applied: [],
                            skipped: ['zh', 'en'],
                            reason: 'zh/en post has no remote https:// cover',
                            pageUrl: PAGE_URL,
                        },
                    },
                },
                null,
                2,
            )}\n`,
        );
        const code = await runPublishMatrixSettle([fx.workDir, '--window', 'after-generate', '--topic', 'ai-news'], {
            executor: settleExecutor,
        });
        expect(code).toBe(0);
        const settlement = readJson(join(fx.publishDir, 'settlement.after-generate.json'));
        expect(settlement.marked).toBe(true);
        expect(settlement.unresolved).toEqual([]);
        expect(settlement.coverPatch).toEqual({
            status: 'skipped',
            reason: 'zh/en post has no remote https:// cover',
            pageUrl: PAGE_URL,
        });
        // The row itself keeps its receipt-proven success: nothing is reported failed.
        const outcome = readJson(join(fx.publishDir, 'outcome.after-generate.json')) as {
            rows: Array<{ id: string; status: string }>;
        };
        expect(outcome.rows.find((row) => row.id === 'surfdash-pub.post')?.status).toBe('succeeded');
        rmSync(fx.root, { recursive: true, force: true });
    });

    it('T2: a page that never published stays unresolved and carries no coverPatch diagnostic', async () => {
        const fx = makeFixture('failed');
        const code = await runPublishMatrixSettle([fx.workDir, '--window', 'after-generate', '--topic', 'ai-news'], {
            executor: settleExecutor,
        });
        expect(code).toBe(0);
        const settlement = readJson(join(fx.publishDir, 'settlement.after-generate.json'));
        expect(settlement.marked).toBe(false);
        expect(JSON.stringify(settlement.unresolved)).toContain('surfdash-pub.post');
        expect(settlement.coverPatch).toBeUndefined();
        rmSync(fx.root, { recursive: true, force: true });
    });
});
