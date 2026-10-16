/**
 * shipinhao-pub real-DOM fixture tests (task 0296 chunk C1).
 *
 * The named runner `tests/fixtures/shipinhao-pub-dom-runner.ts` drives the PRODUCTION
 * `ShipinhaoBrowserTransport` in a subprocess against a real headless Chromium whose only
 * reachable page is the synthetic 视频号 creator form on the real
 * https://channels.weixin.qq.com origin (route interception; every other request aborted). The
 * runner prints one JSON facts line on stdout; these tests spawn it per scenario and assert the
 * observable outcome:
 *
 * 1. guarded missing-browser spawn — a missing Chromium fails loud with the recovery hint, never
 *    a silent skip;
 * 2. wujie happy draft leg — the delayed (≈1.2s) open `wujie-app` shadowRoot is waited out within
 *    the production root budget, the video is assigned AND processing-confirmed, the title,
 *    description and topic are filled with readback, originality is never touched, and 保存草稿
 *    clicks exactly once into a fresh record-id receipt with persisted state;
 * 3. no-wujie direct-form leg — no `wujie-app` at all: the unique direct creator form carries the
 *    same happy path;
 * 4. wujie late-root refusal leg — the shadowRoot is ready at the session gate but NEVER returns
 *    during the flow's bounded window: typed `root-resolve` refusal (shadow_root_not_ready, no
 *    wrong-root document fallback, zero document input events);
 * 5. cover leg — the scoped cover dialog opens from the slot, its own file input receives the
 *    PNG, the labeled 确认 commits, and the changed slot evidence is visible before the save;
 * 6. original leg — metadata.original=true walks 声明原创 entry → declare-body-wrapper agreement →
 *    声明原创 confirm; the checked entry persists and the 弹层 closes before the save;
 * 7. original-missing-control leg — original=true but the agreement checkbox never appears: typed
 *    `original-declare` refusal, the draft is never claimed;
 * 8. publish leg — publishStatus='public' uses the scoped 发表 control and a fresh works receipt,
 *    never the draft path;
 * 9. stale-receipt leg — only a pre-existing receipt-shaped URL is on screen and the save click
 *    changes nothing: typed draft-receipt refusal;
 * 10. zero-network — the fixture aborts all traffic except the synthetic channels origin.
 *
 * EVERY scenario additionally asserts the grounded preview decoy was never clicked. Every test is
 * offline: the fixture aborts all traffic except the synthetic page it serves itself.
 */
import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ShipinhaoDomFacts } from './fixtures/shipinhao-pub-dom-runner';
import { REAL_DRAFT_URL, REAL_PUBLISH_URL, RECOVERY_HINT, STALE_RECORD_URL } from './fixtures/shipinhao-pub-dom-runner';

const TMP_DIR = join(process.cwd(), '.tmp-test-shipinhao-pub');
const RUNNER_PATH = join(import.meta.dir, 'fixtures', 'shipinhao-pub-dom-runner.ts');

/** Spawns the runner subprocess; its last stdout line is the JSON facts contract. */
function runScenario(scenario: string, env: NodeJS.ProcessEnv = process.env) {
    return Bun.spawnSync([process.execPath, RUNNER_PATH, scenario], { env, stdout: 'pipe', stderr: 'pipe' });
}

function parseFacts(proc: ReturnType<typeof runScenario>): ShipinhaoDomFacts {
    expect(proc.exitCode).toBe(0);
    const lines = proc.stdout.toString().trim().split('\n');
    const last = lines[lines.length - 1] ?? '';
    return JSON.parse(last) as ShipinhaoDomFacts;
}

describe('shipinhao-pub real-DOM fixture runner (offline, guarded)', () => {
    test('a missing Chromium fails loud with the recovery hint, never a silent skip', () => {
        const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(TMP_DIR, 'no-browsers-here') };
        const proc = runScenario('wujie-happy-draft', env);
        expect(proc.exitCode).toBe(1);
        expect(proc.stderr.toString()).toContain('shipinhao real-browser fixture could not launch Chromium');
        expect(proc.stderr.toString()).toContain(RECOVERY_HINT);
    }, 60_000);

    test('wujie happy draft leg: delayed shadow root waited out, video processed, fields persisted, fresh receipt', () => {
        const facts = parseFacts(runScenario('wujie-happy-draft'));
        expect(facts.ok).toBe(true);
        expect(facts.url).toBe(REAL_DRAFT_URL);
        expect(facts.id).toBe('shp26001');
        expect(facts.confirmedBy).toBe('draft-receipt');
        expect(facts.publishStatus).toBe('draft');
        expect(facts.error).toBeUndefined();
        // The read-only headless preflight plus the flow pass.
        expect(facts.launches).toBe(2);
        // The page itself observed the filled creator state at save time: video assigned AND the
        // processing-verified editing form present, title/description/topic persisted, receipt pushed.
        expect(facts.observed?.videoAssigned).toBe(true);
        expect(facts.observed?.videoName).toBe('fixture-video.mp4');
        expect(facts.observed?.title).toBe('Fixture 短标题');
        expect(facts.observed?.descriptionText).toContain('Fixture 描述正文，含第二句。');
        expect(facts.observed?.descriptionText).toContain('#fixturetag');
        expect(facts.observed?.receiptUrl).toBe(REAL_DRAFT_URL);
        // Originality controls were never touched: absent metadata.original, the entry row stays
        // unchecked and its dialog never opened.
        expect(facts.original).toBeUndefined();
        expect(facts.originalEntryClicks).toBe(0);
        expect(facts.observed?.originalEntryChecked).toBe(false);
        expect(facts.observed?.originalWrapperPresent).toBe(false);
        // Exactly one video change, exactly one save, never a publish, never a preview decoy click.
        expect(facts.videoChangeEvents).toBe(1);
        expect(facts.saveClicks).toBe(1);
        expect(facts.publishClicks).toBe(0);
        expect(facts.previewClicks).toBe(0);
    }, 120_000);

    test('no-wujie direct-form leg: unique direct evidence carries the same happy path', () => {
        const facts = parseFacts(runScenario('direct-happy-draft'));
        expect(facts.ok).toBe(true);
        expect(facts.url).toBe(REAL_DRAFT_URL);
        expect(facts.id).toBe('shp26001');
        expect(facts.confirmedBy).toBe('draft-receipt');
        expect(facts.publishStatus).toBe('draft');
        expect(facts.launches).toBe(2);
        expect(facts.observed?.videoAssigned).toBe(true);
        expect(facts.observed?.title).toBe('Fixture 短标题');
        expect(facts.observed?.descriptionText).toContain('#fixturetag');
        expect(facts.observed?.originalEntryChecked).toBe(false);
        expect(facts.observed?.originalWrapperPresent).toBe(false);
        expect(facts.videoChangeEvents).toBe(1);
        expect(facts.saveClicks).toBe(1);
        expect(facts.publishClicks).toBe(0);
        expect(facts.previewClicks).toBe(0);
    }, 120_000);

    test('wujie late-root refusal leg: shadowRoot never ready in the flow window fails typed at root-resolve', () => {
        const facts = parseFacts(runScenario('wujie-never-root'));
        expect(facts.ok).toBe(false);
        expect(facts.stage).toBe('root-resolve');
        expect(facts.error ?? '').toContain('shadow_root_not_ready');
        expect(facts.error ?? '').toContain('never falls back to document');
        // The session gate passed (launch 1 preflight + launch 2 gate) and the flow launched, but
        // the root policy refused at the bounded window instead of falling back to the document.
        expect(facts.launches).toBe(2);
        expect(facts.videoChangeEvents).toBe(0);
        expect(facts.saveClicks).toBe(0);
        expect(facts.publishClicks).toBe(0);
        // No wrong-root fill: zero input events anywhere in the document.
        expect(facts.docInputEvents).toBe(0);
        expect(facts.url).toBeUndefined();
        expect(facts.previewClicks).toBe(0);
    }, 120_000);

    test('cover leg: scoped dialog file input, labeled confirm, committed slot evidence before the save', () => {
        const facts = parseFacts(runScenario('wujie-cover'));
        expect(facts.ok).toBe(true);
        expect(facts.url).toBe(REAL_DRAFT_URL);
        expect(facts.confirmedBy).toBe('draft-receipt');
        // The slot opened the scoped dialog, the dialog's own input took the PNG, the labeled
        // 确认 committed it, and the committed slot card was visible at save time.
        expect(facts.coverEntryClicks).toBe(1);
        expect(facts.coverChangeEvents).toBe(1);
        expect(facts.coverConfirmClicks).toBe(1);
        expect(facts.observed?.coverAssigned).toBe(true);
        expect(facts.observed?.coverName).toBe('cover.png');
        expect(facts.observed?.coverCommitted).toBe(true);
        expect(facts.saveClicks).toBe(1);
        expect(facts.publishClicks).toBe(0);
        expect(facts.previewClicks).toBe(0);
    }, 120_000);

    test('original leg: entry → agreement → 声明原创 confirm commits checked state with the dialog closed', () => {
        const facts = parseFacts(runScenario('wujie-original'));
        expect(facts.ok).toBe(true);
        expect(facts.original).toBe(true);
        expect(facts.url).toBe(REAL_DRAFT_URL);
        expect(facts.confirmedBy).toBe('draft-receipt');
        // The full declaration sequence ran exactly once and committed: entry checked and persisted,
        // 弹层 closed before the save.
        expect(facts.originalEntryClicks).toBe(1);
        expect(facts.originalConfirmClicks).toBe(1);
        expect(facts.observed?.originalEntryChecked).toBe(true);
        expect(facts.observed?.originalWrapperPresent).toBe(false);
        expect(facts.saveClicks).toBe(1);
        expect(facts.publishClicks).toBe(0);
        expect(facts.previewClicks).toBe(0);
    }, 120_000);

    test('original-missing-control leg: absent agreement checkbox fails typed at original-declare, draft never claimed', () => {
        const facts = parseFacts(runScenario('wujie-original-missing'));
        expect(facts.ok).toBe(false);
        expect(facts.original).toBe(true);
        expect(facts.stage).toBe('original-declare');
        expect(facts.error ?? '').toContain('agreement checkbox');
        // The entry was clicked but the 弹层 agreement control never appeared; nothing was saved.
        expect(facts.originalEntryClicks).toBe(1);
        expect(facts.saveClicks).toBe(0);
        expect(facts.publishClicks).toBe(0);
        expect(facts.url).toBeUndefined();
        expect(facts.previewClicks).toBe(0);
    }, 120_000);

    test('publish leg: explicit public goes through scoped 发表 and a fresh works receipt, never the draft path', () => {
        const facts = parseFacts(runScenario('wujie-publish-public'));
        expect(facts.ok).toBe(true);
        expect(facts.publishStatus).toBe('public');
        expect(facts.url).toBe(REAL_PUBLISH_URL);
        expect(facts.id).toBe('pub0777');
        expect(facts.confirmedBy).toBe('publish-receipt');
        expect(facts.launches).toBe(2);
        expect(facts.observed?.videoAssigned).toBe(true);
        expect(facts.observed?.receiptUrl).toBe(REAL_PUBLISH_URL);
        // The publish rail: exactly one 发表 click, zero 保存草稿 clicks, zero preview decoy clicks.
        expect(facts.publishClicks).toBe(1);
        expect(facts.saveClicks).toBe(0);
        expect(facts.previewClicks).toBe(0);
    }, 120_000);

    test('stale-receipt leg: a pre-existing receipt-shaped URL with no fresh change fails typed', () => {
        const facts = parseFacts(runScenario('wujie-stale-receipt'));
        expect(facts.ok).toBe(false);
        expect(facts.stage).toBe('draft-receipt');
        expect(facts.error ?? '').toContain('not confirmed');
        expect(facts.url).toBeUndefined();
        expect(facts.id).toBeUndefined();
        // The save click happened (the page recorded it and reported the stale URL it stayed on),
        // but no fresh receipt-shaped URL ever appeared.
        expect(facts.saveClicks).toBe(1);
        expect(facts.publishClicks).toBe(0);
        expect(facts.observed?.receiptUrl).toBe(STALE_RECORD_URL);
        expect(facts.previewClicks).toBe(0);
    }, 120_000);

    test('zero network beyond the synthetic channels origin', async () => {
        // The fixture only fulfills the channels origin and aborts everything else (catch-all first).
        const fixtureSource = await readFile(RUNNER_PATH, 'utf-8');
        expect(fixtureSource).toContain('route.abort()');
        expect(fixtureSource).toContain("'https://channels.weixin.qq.com/**'");
    });
});
