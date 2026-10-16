/**
 * xiaoyuzhou-pub real-DOM fixture tests (task 0295 chunk C1).
 *
 * The named runner `tests/fixtures/xiaoyuzhou-pub-dom-runner.ts` drives the PRODUCTION
 * `XiaoyuzhouBrowserTransport` in a subprocess against a real headless Chromium whose only
 * reachable page is the synthetic 小宇宙 podcaster studio form on the real
 * https://podcaster.xiaoyuzhoufm.com origin (route interception; every other request aborted).
 * The runner prints one JSON facts line on stdout; these tests spawn it per scenario and assert
 * the observable outcome:
 *
 * 1. guarded missing-browser spawn — a missing Chromium fails loud with the recovery hint, never
 *    a silent skip;
 * 2. default podcast draft happy path — audio assigned AND processing-confirmed, title filled with
 *    real input events, shownotes pasted and read back, 保存草稿 clicked exactly once, fresh
 *    episode-id receipt with persisted state;
 * 3. cover leg — the requested PNG is assigned to the form-scoped file input and read back at
 *    save time;
 * 4. audio-timeout leg — no assignable file ever exists at the attach step, so nothing is ever
 *    assigned or processed: typed `upload-timeout` refusal;
 * 5. show-verify failure leg — the podcastId identity is not confirmable on the page: typed
 *    refusal BEFORE any audio assignment;
 * 6. missing-save leg — no 保存草稿 control: typed draft-save refusal, no manufactured draft;
 * 7. stale-receipt leg — a receipt-shaped URL is already on screen before the run and the save
 *    click changes nothing: typed draft-receipt refusal;
 * 8. login leg — missing `input#upload` AND editor: typed preflow refusal, one (preflight) launch,
 *    zero writes.
 *
 * EVERY scenario additionally asserts the grounded preview control was never clicked. Every test
 * is offline: the fixture aborts all traffic except the synthetic page it serves itself.
 */
import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { XiaoyuzhouDomFacts } from './fixtures/xiaoyuzhou-pub-dom-runner';
import { REAL_DRAFT_URL, RECOVERY_HINT, STALE_EPISODE_URL } from './fixtures/xiaoyuzhou-pub-dom-runner';

const TMP_DIR = join(process.cwd(), '.tmp-test-xiaoyuzhou-pub');
const RUNNER_PATH = join(import.meta.dir, 'fixtures', 'xiaoyuzhou-pub-dom-runner.ts');

/** Spawns the runner subprocess; its last stdout line is the JSON facts contract. */
function runScenario(scenario: string, env: NodeJS.ProcessEnv = process.env) {
    return Bun.spawnSync([process.execPath, RUNNER_PATH, scenario], { env, stdout: 'pipe', stderr: 'pipe' });
}

function parseFacts(proc: ReturnType<typeof runScenario>): XiaoyuzhouDomFacts {
    expect(proc.exitCode).toBe(0);
    const lines = proc.stdout.toString().trim().split('\n');
    const last = lines[lines.length - 1] ?? '';
    return JSON.parse(last) as XiaoyuzhouDomFacts;
}

describe('xiaoyuzhou-pub real-DOM fixture runner (offline, guarded)', () => {
    test('a missing Chromium fails loud with the recovery hint, never a silent skip', () => {
        const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(TMP_DIR, 'no-browsers-here') };
        const proc = runScenario('draft-happy', env);
        expect(proc.exitCode).toBe(1);
        expect(proc.stderr.toString()).toContain('xiaoyuzhou real-browser fixture could not launch Chromium');
        expect(proc.stderr.toString()).toContain(RECOVERY_HINT);
    }, 60_000);

    test('default draft leg: audio processed, title/shownotes persisted, fresh episode receipt, save clicked once', () => {
        const facts = parseFacts(runScenario('draft-happy'));
        expect(facts.ok).toBe(true);
        expect(facts.url).toBe(REAL_DRAFT_URL);
        expect(facts.id).toBe('xyz26001');
        expect(facts.confirmedBy).toBe('draft-receipt');
        expect(facts.error).toBeUndefined();
        // The read-only headless preflight plus the flow pass.
        expect(facts.launches).toBe(2);
        // The page itself observed the filled studio state at save time: audio assigned AND the
        // processing-verified media record present, title and shownotes persisted, receipt pushed.
        expect(facts.observed?.audioAssigned).toBe(true);
        expect(facts.observed?.audioName).toBe('episode.mp3');
        expect(facts.observed?.title).toBe('Fixture 单集');
        expect(facts.observed?.shownotesText).toContain('Hello from the xiaoyuzhou real-DOM fixture');
        expect(facts.observed?.receiptUrl).toBe(REAL_DRAFT_URL);
        // Real input/change events reached the title (never a bare `.value` write), exactly one
        // audio change fired, and the save happened exactly once.
        expect(facts.titleInputEvents).toBeGreaterThanOrEqual(1);
        expect(facts.audioChangeEvents).toBe(1);
        expect(facts.saveClicks).toBe(1);
        expect(facts.previewClicks).toBe(0);
    }, 120_000);

    test('cover leg: the requested PNG is assigned to the form-scoped input and read back at save time', () => {
        const facts = parseFacts(runScenario('draft-happy-cover'));
        expect(facts.ok).toBe(true);
        expect(facts.url).toBe(REAL_DRAFT_URL);
        expect(facts.confirmedBy).toBe('draft-receipt');
        expect(facts.observed?.coverCount).toBe(1);
        expect(facts.observed?.coverName).toBe('cover.png');
        expect(facts.saveClicks).toBe(1);
        expect(facts.previewClicks).toBe(0);
    }, 120_000);

    test('audio-timeout leg: no assignable file means nothing is ever assigned or processed — typed upload-timeout', () => {
        const facts = parseFacts(runScenario('audio-timeout'));
        expect(facts.ok).toBe(false);
        expect(facts.stage).toBe('upload-timeout');
        expect(facts.error ?? '').toContain('audio attach failed');
        // The session gate passed and the flow launched, but no change event ever fired on
        // input#upload — the file was never assigned, so processing never started.
        expect(facts.launches).toBe(2);
        expect(facts.audioChangeEvents).toBe(0);
        expect(facts.saveClicks).toBe(0);
        expect(facts.url).toBeUndefined();
        expect(facts.previewClicks).toBe(0);
    }, 120_000);

    test('show-verify failure leg: podcastId identity not confirmable fails typed BEFORE audio assignment', () => {
        const facts = parseFacts(runScenario('show-verify-fail'));
        expect(facts.ok).toBe(false);
        expect(facts.stage).toBe('show-verify');
        expect(facts.error ?? '').toContain('show-verify failed');
        // The flow launched but refused before touching the audio input.
        expect(facts.launches).toBe(2);
        expect(facts.audioChangeEvents).toBe(0);
        expect(facts.saveClicks).toBe(0);
        expect(facts.url).toBeUndefined();
        expect(facts.previewClicks).toBe(0);
    }, 120_000);

    test('missing-save leg: no 保存草稿 control fails typed, never a manufactured draft', () => {
        const facts = parseFacts(runScenario('missing-save'));
        expect(facts.ok).toBe(false);
        expect(facts.stage).toBe('draft-save');
        expect(facts.error ?? '').toContain('draft-save control never attached');
        expect(facts.url).toBeUndefined();
        expect(facts.id).toBeUndefined();
        expect(facts.saveClicks).toBe(0);
        expect(facts.previewClicks).toBe(0);
    }, 120_000);

    test('stale-receipt leg: a pre-existing receipt-shaped URL with no fresh change fails typed', () => {
        const facts = parseFacts(runScenario('stale-receipt'));
        expect(facts.ok).toBe(false);
        expect(facts.stage).toBe('draft-receipt');
        expect(facts.error ?? '').toContain('not confirmed');
        expect(facts.url).toBeUndefined();
        expect(facts.id).toBeUndefined();
        // The save click happened (the page recorded it and reported the stale URL it stayed on),
        // but no fresh receipt-shaped URL ever appeared.
        expect(facts.saveClicks).toBe(1);
        expect(facts.observed?.receiptUrl).toBe(STALE_EPISODE_URL);
        expect(facts.previewClicks).toBe(0);
    }, 120_000);

    test('login leg: missing audio input and editor refuse typed at the preflow, launches stay read-only', () => {
        const facts = parseFacts(runScenario('login-missing-controls'));
        expect(facts.ok).toBe(false);
        // The refusal is the session preflight (no stage metadata): the flow never launches.
        expect(facts.error ?? '').toContain('session preflight refused');
        expect(facts.stage).toBeUndefined();
        expect(facts.launches).toBe(1);
        expect(facts.audioChangeEvents).toBe(0);
        expect(facts.titleInputEvents).toBe(0);
        expect(facts.saveClicks).toBe(0);
        expect(facts.url).toBeUndefined();
        expect(facts.previewClicks).toBe(0);
    }, 120_000);

    test('zero network beyond the synthetic studio origin', async () => {
        // The fixture only fulfills the studio origin and aborts everything else (catch-all first).
        const fixtureSource = await readFile(RUNNER_PATH, 'utf-8');
        expect(fixtureSource).toContain('route.abort()');
        expect(fixtureSource).toContain("'https://podcaster.xiaoyuzhoufm.com/**'");
    });
});
