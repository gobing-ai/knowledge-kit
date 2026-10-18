/**
 * bilibili-pub real-DOM fixture tests (task 0297 chunk C1).
 *
 * The named runner `tests/fixtures/bilibili-pub-dom-runner.ts` drives the PRODUCTION
 * `BilibiliBrowserTransport` in a subprocess against real headless Chromium whose reachable pages
 * are synthetic Bilibili creator forms on real origins (https://member.bilibili.com for shortVideo,
 * https://t.bilibili.com for dynamic; route interception with catch-all abort for zero live writes).
 *
 * SCENARIO LEGS:
 * 1. missing-browser guard: simulated missing executable fails loud with recovery hint, never a skip;
 * 2. happy shortVideo default draft: video assigned + processing signal, title fill (≤80), partition,
 *    tags (≤10), cover modal crop confirm (" 完成 ") + preview update, 保存草稿 + fresh draft receipt;
 * 3. happy shortVideo explicit public: publishStatus='public', same field sequence, span.submit-add 投稿 click,
 *    fresh works receipt (status=pending-review, bvid);
 * 4. video cover failure: cover crop fails -> typed cover-attach failure;
 * 5. video missing partition failure: unconfirmed partition -> typed partition-select failure;
 * 6. happy dynamic explicit public: publishStatus='public', Content.body in contenteditable editor +
 *    image upload via setInputFiles, button.bili-dyn-publishing__action__launch click + fresh post receipt;
 * 7. dynamic missing content failure: empty body and empty images -> typed refusal;
 * 8. dynamic draft refusal: publishStatus absent or 'draft' -> refused pre-browser;
 * 9. stale-receipt leg: only pre-existing receipt on screen -> typed publish-receipt failure;
 * 10. zero-network: catch-all route.abort asserted on runner source.
 */
import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BilibiliDomFacts } from './fixtures/bilibili-pub-dom-runner';
import {
    REAL_DRAFT_RECEIPT_URL,
    REAL_DYNAMIC_PUBLIC_URL,
    REAL_VIDEO_PUBLIC_URL,
    RECOVERY_HINT,
} from './fixtures/bilibili-pub-dom-runner';

const TMP_DIR = join(process.cwd(), '.works/tmp/test-bilibili-pub');
const RUNNER_PATH = join(import.meta.dir, 'fixtures', 'bilibili-pub-dom-runner.ts');

/** Spawns the runner subprocess; its last stdout line is the JSON facts contract. */
function runScenario(scenario: string, env: NodeJS.ProcessEnv = process.env) {
    return Bun.spawnSync([process.execPath, RUNNER_PATH, scenario], { env, stdout: 'pipe', stderr: 'pipe' });
}

function parseFacts(proc: ReturnType<typeof runScenario>): BilibiliDomFacts {
    expect(proc.exitCode).toBe(0);
    const lines = proc.stdout.toString().trim().split('\n');
    const last = lines[lines.length - 1] ?? '';
    return JSON.parse(last) as BilibiliDomFacts;
}

describe('bilibili-pub real-DOM fixture runner (offline, guarded)', () => {
    test('1. missing-browser guard: simulated missing executable fails loud with recovery hint', () => {
        const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(TMP_DIR, 'no-browsers-here') };
        const proc = runScenario('video-happy-draft', env);
        expect(proc.exitCode).toBe(1);
        expect(proc.stderr.toString()).toContain('bilibili real-browser fixture could not launch Chromium');
        expect(proc.stderr.toString()).toContain(RECOVERY_HINT);
    }, 60_000);

    test('2. happy shortVideo default draft: video assigned, fields filled, cover attached, draft saved', () => {
        const facts = parseFacts(runScenario('video-happy-draft'));
        expect(facts.ok).toBe(true);
        expect(facts.publishStatus).toBe('draft');
        expect(facts.stage).toBe('draft-receipt');
        expect(facts.receipt).toBe(REAL_DRAFT_RECEIPT_URL);
        expect(facts.error).toBeUndefined();
        expect(facts.launches).toBe(2);
        expect(facts.saveClicks).toBe(1);
        expect(facts.publishClicks).toBe(0);
        expect(facts.videoChangeEvents).toBe(1);
        expect(facts.coverEntryClicks).toBe(1);
        expect(facts.coverConfirmClicks).toBe(1);
        expect(facts.observed?.videoAssigned).toBe(true);
        expect(facts.observed?.videoName).toBe('fixture-video.mp4');
        expect(facts.observed?.title).toBe('Fixture Bilibili 视频标题');
        expect(facts.observed?.partition).toBe('知识');
        expect(facts.observed?.tags).toEqual(['科技', '数码']);
        expect(facts.observed?.coverAssigned).toBe(true);
    }, 60_000);

    test('3. happy shortVideo explicit public: publishStatus=public, span.submit-add 投稿 click, works receipt', () => {
        const facts = parseFacts(runScenario('video-happy-public'));
        expect(facts.ok).toBe(true);
        expect(facts.publishStatus).toBe('public');
        expect(facts.status).toBe('pending-review');
        expect(facts.stage).toBe('publish-receipt');
        expect(facts.url).toBe(REAL_VIDEO_PUBLIC_URL);
        expect(facts.bvid).toBe('BV1xx411c7mD');
        expect(facts.error).toBeUndefined();
        expect(facts.launches).toBe(2);
        expect(facts.saveClicks).toBe(0);
        expect(facts.publishClicks).toBe(1);
        expect(facts.observed?.title).toBe('Fixture Bilibili 视频标题');
        expect(facts.observed?.coverAssigned).toBe(true);
    }, 60_000);

    test('4. video cover failure: cover crop fails -> typed cover-attach failure', () => {
        const facts = parseFacts(runScenario('video-cover-fail'));
        expect(facts.ok).toBe(false);
        expect(facts.stage).toBe('cover-attach');
        expect(facts.error ?? '').toContain('cover modal done button not found');
        expect(facts.saveClicks).toBe(0);
        expect(facts.publishClicks).toBe(0);
    }, 60_000);

    test('5. video missing partition failure: unconfirmed partition -> typed partition-select failure', () => {
        const facts = parseFacts(runScenario('video-missing-partition'));
        expect(facts.ok).toBe(false);
        expect(facts.stage).toBe('partition-select');
        expect(facts.error ?? '').toContain('bilibili partition selection failed');
        expect(facts.saveClicks).toBe(0);
        expect(facts.publishClicks).toBe(0);
    }, 60_000);

    test('6. happy dynamic explicit public: publishStatus=public, body and image, fresh opus receipt', () => {
        const facts = parseFacts(runScenario('dynamic-happy-public'));
        expect(facts.ok).toBe(true);
        expect(facts.publishStatus).toBe('public');
        expect(facts.stage).toBe('publish-receipt');
        expect(facts.url).toBe(REAL_DYNAMIC_PUBLIC_URL);
        expect(facts.error).toBeUndefined();
        expect(facts.launches).toBe(2);
        expect(facts.saveClicks).toBe(0);
        expect(facts.publishClicks).toBe(1);
        expect(facts.imageChangeEvents).toBe(1);
        expect(facts.observed?.text).toContain('想和大家分享今天的新进展。');
        expect(facts.observed?.imagesCount).toBe(1);
    }, 60_000);

    test('7. dynamic missing content failure: empty body and empty images -> typed refusal', () => {
        const facts = parseFacts(runScenario('dynamic-missing-content'));
        expect(facts.ok).toBe(false);
        expect(facts.error ?? '').toContain('bilibili dynamic requires non-empty Content.body or at least one image');
        expect(facts.launches).toBe(0);
    }, 30_000);

    test('8. dynamic draft refusal: publishStatus absent or draft -> refused pre-browser', () => {
        const facts = parseFacts(runScenario('dynamic-draft-refusal'));
        expect(facts.ok).toBe(false);
        expect(facts.error ?? '').toContain('bilibili dynamic posts require explicit metadata.publishStatus: public');
        expect(facts.launches).toBe(0);
    }, 30_000);

    test('9. stale-receipt leg: only pre-existing receipt on screen -> typed publish-receipt failure', () => {
        const facts = parseFacts(runScenario('stale-receipt'));
        expect(facts.ok).toBe(false);
        expect(facts.stage).toBe('publish-receipt');
        expect(facts.error ?? '').toContain('unconfirmed');
        expect(facts.publishClicks).toBe(1);
        expect(facts.saveClicks).toBe(0);
        expect(facts.url).toBeUndefined();
    }, 60_000);

    test('10. zero-network: catch-all route.abort asserted on runner source', async () => {
        const runnerSource = await readFile(RUNNER_PATH, 'utf-8');
        expect(runnerSource).toContain("context.route('**/*'");
        expect(runnerSource).toContain('route.abort()');
        expect(runnerSource).toContain("context.route('https://member.bilibili.com/**'");
        expect(runnerSource).toContain("context.route('https://t.bilibili.com/**'");
    });
});
