/**
 * sspai-pub real-DOM fixture tests (task 0294 chunk C1).
 *
 * The named runner `tests/fixtures/sspai-pub-dom-runner.ts` drives the PRODUCTION
 * `SspaiBrowserTransport` in a subprocess against a real headless Chromium whose only reachable
 * page is the synthetic sspai Matrix editor on the real https://sspai.com origin (route
 * interception; every other request aborted). The runner prints one JSON facts line on stdout;
 * these tests spawn it per scenario and assert the observable outcome:
 *
 * 1. guarded missing-browser spawn — a missing Chromium fails loud with the recovery hint, never
 *    a silent skip;
 * 2. default draft happy path — 保存草稿 produces a fresh draft-id URL (`/post/<digits>`, the
 *    first receipt regex shape) with the filled title/body read back by the page itself;
 * 3. cover happy path — a real local PNG is `setInputFiles`-assigned to the page's file input
 *    and read back at save time;
 * 4. requested cover with no file input — the cover leg fails closed with a typed refusal;
 * 5. missing draft control — the 保存草稿 leg fails closed with a typed refusal;
 * 6. stale receipt (the save click changes no URL) — no fresh receipt, typed failure.
 *
 * Every scenario additionally asserts the grounded preview control was NEVER clicked. Every test
 * is offline: the fixture aborts all traffic except the synthetic page it serves itself.
 */
import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SspaiDomFacts } from './fixtures/sspai-pub-dom-runner';
import { REAL_DRAFT_URL, RECOVERY_HINT } from './fixtures/sspai-pub-dom-runner';

const TMP_DIR = join(process.cwd(), '.tmp-test-sspai-pub');
const RUNNER_PATH = join(import.meta.dir, 'fixtures', 'sspai-pub-dom-runner.ts');

/** Spawns the runner subprocess; its last stdout line is the JSON facts contract. */
function runScenario(scenario: string, env: NodeJS.ProcessEnv = process.env) {
    return Bun.spawnSync([process.execPath, RUNNER_PATH, scenario], { env, stdout: 'pipe', stderr: 'pipe' });
}

function parseFacts(proc: ReturnType<typeof runScenario>): SspaiDomFacts {
    expect(proc.exitCode).toBe(0);
    const lines = proc.stdout.toString().trim().split('\n');
    const last = lines[lines.length - 1] ?? '';
    return JSON.parse(last) as SspaiDomFacts;
}

describe('sspai-pub real-DOM fixture runner (offline, guarded)', () => {
    test('a missing Chromium fails loud with the recovery hint, never a silent skip', () => {
        const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(TMP_DIR, 'no-browsers-here') };
        const proc = runScenario('draft-happy', env);
        expect(proc.exitCode).toBe(1);
        expect(proc.stderr.toString()).toContain('sspai real-browser fixture could not launch Chromium');
        expect(proc.stderr.toString()).toContain(RECOVERY_HINT);
    }, 60_000);

    test('default draft leg: fresh draft-id URL with persisted title/body and the preview never clicked', () => {
        const facts = parseFacts(runScenario('draft-happy'));
        expect(facts.ok).toBe(true);
        expect(facts.url).toBe(REAL_DRAFT_URL);
        expect(facts.id).toBe('20261015001');
        expect(facts.confirmedBy).toBe('draft-receipt');
        expect(facts.error).toBeUndefined();
        // The read-only headless preflight plus the flow pass.
        expect(facts.launches).toBe(2);
        // The page itself observed the filled editor state at save time.
        expect(facts.observed?.title).toBe('Fixture 草稿');
        expect(facts.observed?.editorText).toContain('Hello from the sspai real-DOM fixture');
        expect(facts.previewClicks).toBe(0);
    }, 120_000);

    test('cover leg: the requested PNG is assigned to the file input and read back at save time', () => {
        const facts = parseFacts(runScenario('draft-happy-cover'));
        expect(facts.ok).toBe(true);
        expect(facts.url).toBe(REAL_DRAFT_URL);
        expect(facts.confirmedBy).toBe('draft-receipt');
        expect(facts.observed?.coverCount).toBe(1);
        expect(facts.observed?.coverName).toBe('cover.png');
        expect(facts.previewClicks).toBe(0);
    }, 120_000);

    test('requested cover with no file input fails closed with a typed cover refusal', () => {
        const facts = parseFacts(runScenario('cover-missing-input'));
        expect(facts.ok).toBe(false);
        expect(facts.stage).toBe('cover-attach');
        expect(facts.error ?? '').toContain('cover attach failed');
        expect(facts.url).toBeUndefined();
        expect(facts.previewClicks).toBe(0);
    }, 120_000);

    test('missing draft control fails closed with a typed refusal', () => {
        const facts = parseFacts(runScenario('missing-save'));
        expect(facts.ok).toBe(false);
        expect(facts.stage).toBe('draft-save');
        expect(facts.error ?? '').toContain('draft-save control never attached');
        expect(facts.url).toBeUndefined();
        expect(facts.id).toBeUndefined();
        expect(facts.previewClicks).toBe(0);
    }, 120_000);

    test('stale receipt without a URL change fails closed with a typed refusal', () => {
        const facts = parseFacts(runScenario('stale-receipt'));
        expect(facts.ok).toBe(false);
        expect(facts.stage).toBe('draft-receipt');
        expect(facts.error ?? '').toContain('not confirmed');
        expect(facts.url).toBeUndefined();
        expect(facts.id).toBeUndefined();
        expect(facts.previewClicks).toBe(0);
    }, 120_000);

    test('zero network beyond the synthetic editor origin', async () => {
        // The fixture only fulfills the editor origin and aborts everything else (catch-all first).
        const fixtureSource = await readFile(RUNNER_PATH, 'utf-8');
        expect(fixtureSource).toContain('route.abort()');
        expect(fixtureSource).toContain("'https://sspai.com/**'");
    });
});
