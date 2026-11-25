/**
 * Named real-Chromium fixture runner for the LinkedIn feed post (task 0437 R3), modeled on the
 * cnblogs/bilibili runners: the PRODUCTION `LinkedinBrowserTransport` posts against a headless
 * Chromium whose only reachable page is a synthetic feed fulfilled by route interception ON the real
 * https://www.linkedin.com origin. A catch-all route aborts every other request — zero live calls.
 *
 * The feed reproduces the shape measured live on 2026-11-25 (`.spur/run/dogfood/2026-11-25-linkedin/`,
 * sanitized: tags, roles and aria only — no text, cookie or token): the share trigger is
 * `div[role=button][aria-label="Start a post"]` wrapping a `<p>` label, and its click mounts a tiptap
 * `div[role=textbox][contenteditable=true].tiptap.ProseMirror` that is NOT inside a `[role=dialog]`.
 *
 * Scenarios:
 * - `recorded` — the measured shape; the Post click inserts a fresh activity card + success toast.
 * - `hidden-duplicate` — H1: a hidden `<button>Start a post</button>` precedes the real trigger.
 * - `pre-recon` — the trigger swapped for a `<button>Start a post</button>` that opens nothing.
 *
 * Usage: bun tests/fixtures/linkedin-pub-dom-runner.ts <scenario>
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import { chromium } from 'playwright';
import { LinkedinBrowserTransport } from '../../src/index';

export const RECOVERY_HINT = 'bunx playwright install chromium';
export const POST_URL = 'https://www.linkedin.com/feed/update/urn:li:activity:7400000000000000001/';
export const POST_TEXT = 'Hello from the linkedin real-DOM fixture';
export type LinkedinScenario = 'recorded' | 'hidden-duplicate' | 'pre-recon';
export const SCENARIOS: readonly LinkedinScenario[] = ['recorded', 'hidden-duplicate', 'pre-recon'];

export async function launchChromium(): Promise<Browser> {
    try {
        return await chromium.launch({ headless: true, timeout: 20_000 });
    } catch (error) {
        throw new Error(`linkedin real-browser fixture could not launch Chromium — run: ${RECOVERY_HINT}`, {
            cause: error,
        });
    }
}

const RECORDED_TRIGGER =
    '<div role="button" aria-label="Start a post" tabindex="0" class="ekfjic" id="trigger"><div><div><p>Start a post</p></div></div></div>';

export function feedHtml(scenario: LinkedinScenario): string {
    const trigger =
        scenario === 'pre-recon'
            ? // The pre-recon shape: a plain button carrying the text, wired to nothing.
              '<button type="button" id="dead">Start a post</button>'
            : scenario === 'hidden-duplicate'
              ? `<button type="button" style="display:none">Start a post</button>${RECORDED_TRIGGER}`
              : RECORDED_TRIGGER;
    return `<!doctype html>
<html><body>
<main><div class="share-box">${trigger}</div><section id="feed"></section></main>
<div id="surface"></div>
<script>
  const trigger = document.getElementById('trigger');
  if (trigger !== null) trigger.addEventListener('click', () => {
    if (document.querySelector('.tiptap') !== null) return;
    document.getElementById('surface').innerHTML =
      '<div><div role="status"></div><div role="textbox" contenteditable="true" tabindex="0" class="tiptap ProseMirror" style="min-height:3em"><p><br></p></div>' +
      '<button type="button" id="post" disabled>Post</button></div>';
    const editor = document.querySelector('.tiptap');
    const post = document.getElementById('post');
    editor.addEventListener('input', () => { post.disabled = editor.textContent.trim().length === 0; });
    post.addEventListener('click', () => {
      const card = document.createElement('article');
      card.innerHTML = '<p></p><a href=${JSON.stringify(POST_URL)}>1m</a>';
      card.querySelector('p').textContent = editor.textContent;
      document.getElementById('feed').prepend(card);
      document.getElementById('surface').innerHTML = '<div role="alert">Post successful. View post</div>';
    });
  });
</script>
</body></html>`;
}

/** One production run's observable outcome; assertions live in `tests/linkedin-pub-dom.test.ts`. */
export interface LinkedinDomFacts {
    scenario: string;
    ok: boolean;
    url?: string;
    id?: string;
    stage?: string;
    effect?: string;
    error?: string;
    probe?: { trigger?: string; triggerMatches?: number; candidates?: Record<string, number> };
    launches: number;
}

export async function runLinkedinScenario(browser: Browser, scenario: LinkedinScenario): Promise<LinkedinDomFacts> {
    const scratch = mkdtempSync(join(tmpdir(), 'kk-linkedin-fixture-'));
    try {
        const profileDir = join(scratch, 'profile');
        mkdirSync(profileDir, { recursive: true });
        let launches = 0;
        const transport = new LinkedinBrowserTransport('post', 'script', {
            launcher: {
                launch: async () => {
                    launches += 1;
                    const context = await browser.newContext();
                    // Registered first so the origin handler below (later registrations win) shadows it.
                    await context.route('**/*', (route) => route.abort());
                    await context.route('https://www.linkedin.com/**', async (route) => {
                        if (route.request().method() !== 'GET') return route.abort();
                        await route.fulfill({ contentType: 'text/html; charset=utf-8', body: feedHtml(scenario) });
                    });
                    return context;
                },
            },
            stepTimeoutMs: 3_000,
        });
        const result = await transport.publish({
            content: { title: 'fixture', body: POST_TEXT, format: 'markdown', metadata: { publishStatus: 'public' } },
            options: { profileDir },
        });
        const metadata = (result.metadata ?? {}) as Record<string, unknown>;
        const effect = (metadata.itcDelivery as { effect?: string } | undefined)?.effect;
        return {
            scenario,
            ok: result.ok,
            ...(result.url === undefined ? {} : { url: result.url }),
            ...(result.id === undefined ? {} : { id: result.id }),
            ...(typeof metadata.stage === 'string' ? { stage: metadata.stage } : {}),
            ...(effect === undefined ? {} : { effect }),
            ...(result.ok ? {} : { error: result.error }),
            ...(metadata.composerProbe === undefined
                ? {}
                : { probe: metadata.composerProbe as LinkedinDomFacts['probe'] }),
            launches,
        };
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

if (import.meta.main) {
    const scenario = process.argv[2] ?? '';
    if (!(SCENARIOS as readonly string[]).includes(scenario)) {
        console.error(`unknown scenario '${scenario}' — expected one of: ${SCENARIOS.join(', ')}`);
        process.exit(1);
    }
    launchChromium()
        .then(async (browser) => {
            try {
                // Last line of stdout is the machine contract for the bun:test guard.
                console.log(JSON.stringify(await runLinkedinScenario(browser, scenario as LinkedinScenario)));
            } finally {
                await browser.close();
            }
        })
        .catch((error: unknown) => {
            console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
            process.exit(1);
        });
}
