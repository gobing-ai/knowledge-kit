/**
 * linkedin-pub real-DOM fixture tests (task 0437 R3 / AC3).
 *
 * `tests/fixtures/linkedin-pub-dom-runner.ts` drives the PRODUCTION `LinkedinBrowserTransport` in a
 * subprocess against headless Chromium serving the feed shape measured live on 2026-11-25, on the
 * real https://www.linkedin.com origin with every other request aborted. The fake-page suite cannot
 * observe this: it answers every selector in the list with 1.
 *
 * Failures enumerated before the fix (fail-first, run against HEAD 29a2fc21):
 *  1. a hidden duplicate `<button>Start a post</button>` resolves first (attached, not visible) and
 *     the trigger click hangs 30 s, then fails with no stage — `hidden-duplicate` failed, now posts;
 *  2. a trigger that opens nothing must refuse at `composer`, retryable, with the probe counts;
 *  3. the composer outside any `[role=dialog]` must still resolve, type, read back and post.
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { LinkedinDomFacts } from './fixtures/linkedin-pub-dom-runner';
import { POST_URL } from './fixtures/linkedin-pub-dom-runner';

const RUNNER_PATH = join(import.meta.dir, 'fixtures', 'linkedin-pub-dom-runner.ts');

function run(scenario: string, env: NodeJS.ProcessEnv = process.env) {
    return Bun.spawnSync([process.execPath, RUNNER_PATH, scenario], { env, stdout: 'pipe', stderr: 'pipe' });
}

function facts(scenario: string): LinkedinDomFacts {
    const proc = run(scenario);
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);
    const lines = proc.stdout.toString().trim().split('\n');
    return JSON.parse(lines[lines.length - 1] ?? '') as LinkedinDomFacts;
}

describe('linkedin-pub real-DOM fixture (offline, 0437 R3)', () => {
    test('a missing Chromium fails loud with the recovery hint, never a silent skip', () => {
        const proc = run('recorded', { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '/nonexistent/kk-no-browsers' });
        expect(proc.exitCode).toBe(1);
        expect(proc.stderr.toString()).toContain('bunx playwright install chromium');
    }, 60_000);

    test('AC3 — the recorded feed opens the composer, reads back the text and confirms the fresh post', () => {
        const result = facts('recorded');
        expect(result).toMatchObject({ ok: true, url: POST_URL, id: '7400000000000000001', launches: 2 });
    }, 120_000);

    test('AC3 — a hidden duplicate trigger never swallows the click (H1)', () => {
        expect(facts('hidden-duplicate')).toMatchObject({ ok: true, url: POST_URL });
    }, 120_000);

    test('AC3 — the pre-recon trigger shape fails at stage composer, retryable, with the probe counts', () => {
        const result = facts('pre-recon');
        expect(result).toMatchObject({ ok: false, stage: 'composer', effect: 'none' });
        expect(result.probe?.trigger).toBe('button:has-text("Start a post")');
        expect(result.probe?.triggerMatches).toBe(1);
        expect(Object.values(result.probe?.candidates ?? {}).every((n) => n === 0)).toBe(true);
        expect(result.error).toStartWith('linkedin composer did not open after the share box');
    }, 120_000);
});
