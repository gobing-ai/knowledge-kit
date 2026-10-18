/**
 * cnblogs-pub real-DOM fixture tests (task 0293 chunk C1).
 *
 * The named runner `tests/fixtures/cnblogs-pub-dom-runner.ts` drives the PRODUCTION
 * `CnblogsBrowserTransport` in a subprocess against a real headless Chromium whose only reachable
 * page is the synthetic cnblogs Markdown editor on the real https://i.cnblogs.com origin (route
 * interception; every other request aborted). The runner prints one JSON facts line on stdout;
 * these tests spawn it per scenario and assert the observable outcome:
 *
 * 1. guarded missing-browser spawn — a missing Chromium fails loud with the recovery hint, never
 *    a silent skip;
 * 2. default-draft happy path — 保存草稿 produces a fresh postId-bearing edit URL with the
 *    filled title/body/summary and checked category read back by the page itself;
 * 3. explicit public happy path — 发布博文 produces the fresh id-bearing post URL;
 * 4. missing draft control — the draft leg fails closed with a typed refusal;
 * 5. ambiguous receipt (no id change) — no fresh receipt, typed failure;
 * 6. zero network beyond the synthetic editor origin (source assertions).
 *
 * Every test is offline: the fixture aborts all traffic except the synthetic page it serves
 * itself, and no test ever sends credentials or a cover (this flow refuses cover).
 */
import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CnblogsDomFacts } from './fixtures/cnblogs-pub-dom-runner';
import { REAL_DRAFT_URL, REAL_POST_URL, RECOVERY_HINT } from './fixtures/cnblogs-pub-dom-runner';

const TMP_DIR = join(process.cwd(), '.works/tmp/test-cnblogs-pub');
const RUNNER_PATH = join(import.meta.dir, 'fixtures', 'cnblogs-pub-dom-runner.ts');

/** Spawns the runner subprocess; its last stdout line is the JSON facts contract. */
function runScenario(scenario: string, env: NodeJS.ProcessEnv = process.env) {
    return Bun.spawnSync([process.execPath, RUNNER_PATH, scenario], { env, stdout: 'pipe', stderr: 'pipe' });
}

function parseFacts(proc: ReturnType<typeof runScenario>): CnblogsDomFacts {
    expect(proc.exitCode).toBe(0);
    const lines = proc.stdout.toString().trim().split('\n');
    const last = lines[lines.length - 1] ?? '';
    return JSON.parse(last) as CnblogsDomFacts;
}

describe('cnblogs-pub real-DOM fixture runner (offline, guarded)', () => {
    test('a missing Chromium fails loud with the recovery hint, never a silent skip', () => {
        const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(TMP_DIR, 'no-browsers-here') };
        const proc = runScenario('draft-happy', env);
        expect(proc.exitCode).toBe(1);
        expect(proc.stderr.toString()).toContain('cnblogs real-browser fixture could not launch Chromium');
        expect(proc.stderr.toString()).toContain(RECOVERY_HINT);
    }, 60_000);

    test('default draft leg: fresh postId-bearing edit URL with persisted title/body/summary/category', () => {
        const facts = parseFacts(runScenario('draft-happy'));
        expect(facts.ok).toBe(true);
        expect(facts.url).toBe(REAL_DRAFT_URL);
        expect(facts.id).toBe('20261015001');
        expect(facts.confirmedBy).toBe('draft-save');
        expect(facts.error).toBeUndefined();
        // The read-only headless preflight plus the flow pass.
        expect(facts.launches).toBe(2);
        // The page itself observed the filled editor state and the checked category at save time.
        expect(facts.observed?.title).toBe('Fixture 草稿');
        expect(facts.observed?.body).toContain('Hello from the cnblogs real-DOM fixture');
        expect(facts.observed?.summary).toBe('Fixture 摘要');
        expect(facts.observed?.checked).toEqual(['前端']);
    }, 120_000);

    test('explicit public leg: 发布博文 produces the fresh id-bearing post URL', () => {
        const facts = parseFacts(runScenario('public-happy'));
        expect(facts.ok).toBe(true);
        expect(facts.url).toBe(REAL_POST_URL);
        expect(facts.id).toBe('20261015002');
        expect(facts.confirmedBy).toBe('publish-confirmation');
        expect(facts.error).toBeUndefined();
        expect(facts.launches).toBe(2);
        expect(facts.observed?.title).toBe('Fixture 草稿');
        expect(facts.observed?.checked).toEqual(['后端']);
    }, 120_000);

    test('missing draft control fails closed with a typed refusal', () => {
        const facts = parseFacts(runScenario('missing-draft'));
        expect(facts.ok).toBe(false);
        expect(facts.stage).toBe('draft-save');
        expect(facts.error ?? '').toContain('draft-save control');
        expect(facts.error ?? '').toContain('never attached');
        expect(facts.url).toBeUndefined();
        expect(facts.id).toBeUndefined();
    }, 120_000);

    test('ambiguous receipt without an id change fails closed with a typed refusal', () => {
        const facts = parseFacts(runScenario('draft-ambiguous'));
        expect(facts.ok).toBe(false);
        expect(facts.stage).toBe('draft-save');
        expect(facts.error).toContain('not confirmed');
        expect(facts.url).toBeUndefined();
        expect(facts.id).toBeUndefined();
    }, 120_000);

    test('zero network beyond the synthetic editor origin', async () => {
        // The fixture only fulfills the editor origin and aborts everything else (catch-all first).
        const fixtureSource = await readFile(RUNNER_PATH, 'utf-8');
        expect(fixtureSource).toContain('route.abort()');
        expect(fixtureSource).toContain("'https://i.cnblogs.com/**'");
    });
});
