/**
 * Named real-Chromium fixture runner for the sspai article draft flow (task 0294 chunk C1), modeled
 * on cnblogs' runner (0293): the PRODUCTION `SspaiBrowserTransport` publishes against a real
 * headless Chromium whose only reachable page is a synthetic sspai Matrix editor page fulfilled by
 * route interception ON the real https://sspai.com origin (never a substitute origin). A catch-all
 * route aborts every other request, so the browser stays loopback-only with zero live provider
 * calls. The transport's injected launcher opens a fresh routed context per launch — the read-only
 * headless session preflight first, then the flow pass.
 *
 * The DOM mirrors the ground-truth Matrix editor (`SSPAI_ARTICLE_SELECTORS`, src/selectors.ts):
 * `textarea[placeholder="请输入标题..."]`, the `div[contenteditable="true"]` editor, the cover
 * `input[type=file]` inside the SAME editor form (the frozen editor-scoped shape — the input must
 * survive the body paste, so it is a sibling of the editor, not its child), and the grounded
 * `a.editor-extra-button-preview` control which reports its clicks immediately — the draft flow
 * must never click it. The editor installs the `paste`
 * handler production `pasteHtml` drives: its `text/html` becomes the editor's innerHTML. The
 * exact-visible 保存草稿 click `history.pushState`s to the id-bearing draft URL (the first
 * receipt regex shape) with the title/editor state intact, so the fresh readback passes. The
 * save-time report reaches the runner through the `__kkFixtureReport` binding, preview clicks
 * through their own immediate `__kkPreviewClick` binding — so "the preview was never clicked" is
 * observable even in scenarios that fail before any save click.
 *
 * `chromium.launch` rejects when the browser is missing; the runner surfaces it as an actionable
 * environment failure naming the recovery hint, never a silent skip.
 *
 * Usage: bun tests/fixtures/sspai-pub-dom-runner.ts <scenario>
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import { chromium } from 'playwright';
import { SspaiBrowserTransport } from '../../src/flow';

/** Operator recovery for a missing browser — every fixture failure names it. */
export const RECOVERY_HINT = 'bunx playwright install chromium';

export async function launchChromium(): Promise<Browser> {
    try {
        return await chromium.launch({ headless: true, timeout: 20_000 });
    } catch (error) {
        throw new Error(`sspai real-browser fixture could not launch Chromium — run: ${RECOVERY_HINT}`, {
            cause: error,
        });
    }
}

/** Persisted draft receipt (first `SSPAI_RECEIPT_URL_RES` shape) the 保存草稿 click pushStates to. */
export const REAL_DRAFT_URL = 'https://sspai.com/post/20261015001';

/** A real 1x1 PNG for the cover leg — the flow refuses missing/empty/wrong-typed cover paths. */
const COVER_PNG_1PX = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
);

export type SspaiScenario =
    | 'draft-happy'
    | 'draft-happy-cover'
    | 'cover-missing-input'
    | 'missing-save'
    | 'stale-receipt';

/**
 * Synthetic logged-in sspai Matrix editor page carrying the production selectors of
 * `SSPAI_ARTICLE_SELECTORS` (src/selectors.ts). The paste handler lands production `pasteHtml`'s
 * `text/html` in the contenteditable editor; the save-time report hands the page's own observable
 * state (title value, editor innerText, cover file assignment, preview click count) to the runner
 * through the `__kkFixtureReport` binding. The draft click pushStates to `REAL_DRAFT_URL` (fresh
 * receipt); `stale-receipt` pushStates to the current URL (no change, nothing fresh can confirm);
 * `missing-save` omits the draft control (typed fail-closed, no plain 保存 fallback either);
 * `cover-missing-input` omits the file input so a requested cover refuses typed.
 */
export function composerHtml(scenario: SspaiScenario): string {
    const draftButton = scenario === 'missing-save' ? '' : '<button type="button" id="draft-save">保存草稿</button>';
    const fileInput = scenario === 'cover-missing-input' ? '' : '<input type="file" accept="image/*" />';
    const draftUrl = scenario === 'stale-receipt' ? '' : JSON.stringify(REAL_DRAFT_URL);
    return `<!doctype html>
<html><body>
<form id="editor-form">
  <textarea placeholder="请输入标题..."></textarea>
  <div contenteditable="true" style="min-height:4em"></div>
  ${fileInput}
  <a href="#" class="editor-extra-button-preview">预览</a>
  ${draftButton}
</form>
<script>
  const editor = document.querySelector('div[contenteditable="true"]');
  editor.addEventListener('paste', (event) => {
    const html = event.clipboardData === null ? '' : String(event.clipboardData.getData('text/html'));
    if (html.length > 0) editor.innerHTML = html;
  });
  document.querySelector('a.editor-extra-button-preview').addEventListener('click', (event) => {
    event.preventDefault();
    window.__kkPreviewClick();
  });
  const draft = document.getElementById('draft-save');
  if (draft !== null) {
    draft.addEventListener('click', () => {
      const coverInput = document.querySelector('input[type="file"]');
      const files = coverInput === null ? [] : [...coverInput.files];
      window.__kkFixtureReport(JSON.stringify({
        title: document.querySelector('textarea[placeholder="请输入标题..."]').value,
        editorText: editor.innerText,
        coverCount: files.length,
        coverName: files.length > 0 ? files[0].name : null,
      }));
      history.pushState({}, '', ${draftUrl.length > 0 ? draftUrl : 'location.href'});
    });
  }
</script>
</body></html>`;
}

/** One production run's observable outcome; assertions live in `tests/sspai-pub-dom.test.ts`. */
export interface SspaiDomFacts {
    scenario: string;
    ok?: boolean;
    url?: string;
    id?: string;
    stage?: string;
    confirmedBy?: string;
    error?: string;
    observed?: { title?: string; editorText?: string; coverCount?: number; coverName?: string | null };
    launches: number;
    /** Page-side preview clicks, reported immediately — the flow must keep this at 0. */
    previewClicks: number;
}

export async function runSspaiScenario(browser: Browser, scenario: SspaiScenario): Promise<SspaiDomFacts> {
    const scratch = mkdtempSync(join(tmpdir(), 'kk-sspai-fixture-'));
    try {
        // The preflight refuses a missing profile dir; the fixture owns one scratch dir.
        const profileDir = join(scratch, 'profile');
        mkdirSync(profileDir, { recursive: true });
        // A requested cover always names a real local PNG (never a phantom path).
        const wantsCover = scenario === 'draft-happy-cover' || scenario === 'cover-missing-input';
        const coverPath = join(scratch, 'cover.png');
        if (wantsCover) writeFileSync(coverPath, COVER_PNG_1PX);
        let launches = 0;
        // `__kkFixtureReport` hands the page's save-time state back; `__kkPreviewClick` counts the
        // grounded preview control's clicks immediately, independent of any save.
        const reports: string[] = [];
        let previewClicks = 0;
        const transport = new SspaiBrowserTransport('article', 'script', {
            launcher: {
                launch: async () => {
                    launches += 1;
                    const context = await browser.newContext();
                    // Registered first so the origin handler below (later registrations win) shadows it.
                    await context.route('**/*', (route) => route.abort());
                    await context.route('https://sspai.com/**', async (route) => {
                        if (route.request().method() === 'GET') {
                            await route.fulfill({
                                contentType: 'text/html; charset=utf-8',
                                body: composerHtml(scenario),
                            });
                            return;
                        }
                        await route.abort();
                    });
                    await context.exposeFunction('__kkFixtureReport', (payload: string) => {
                        reports.push(payload);
                    });
                    await context.exposeFunction('__kkPreviewClick', () => {
                        previewClicks += 1;
                    });
                    return context;
                },
            },
            stepTimeoutMs: 8_000,
        });
        const result = await transport.publish({
            content: {
                title: 'Fixture 草稿',
                body: 'Hello from the sspai real-DOM fixture\n\n第二段',
                format: 'markdown',
            },
            // Absent publishStatus defaults to draft: only the exact-visible 保存草稿 control activates.
            options: { profileDir, ...(wantsCover ? { coverPath } : {}) },
        });
        const stage = typeof result.metadata?.stage === 'string' ? result.metadata.stage : undefined;
        const confirmedBy = typeof result.metadata?.confirmedBy === 'string' ? result.metadata.confirmedBy : undefined;
        let observed: SspaiDomFacts['observed'];
        try {
            const raw = reports[reports.length - 1];
            observed = raw === undefined ? undefined : (JSON.parse(raw) as SspaiDomFacts['observed']);
        } catch {
            observed = undefined;
        }
        return {
            scenario,
            ok: result.ok,
            ...(result.url === undefined ? {} : { url: result.url }),
            ...(result.id === undefined ? {} : { id: result.id }),
            ...(stage === undefined ? {} : { stage }),
            ...(confirmedBy === undefined ? {} : { confirmedBy }),
            error: result.ok ? undefined : result.error,
            ...(observed === undefined ? {} : { observed }),
            launches,
            previewClicks,
        };
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

if (import.meta.main) {
    // Subprocess entry only (bun tests/fixtures/sspai-pub-dom-runner.ts <scenario>): the launch
    // must not fire when the test file imports this module's helpers.
    const scenarios: readonly string[] = [
        'draft-happy',
        'draft-happy-cover',
        'cover-missing-input',
        'missing-save',
        'stale-receipt',
    ];
    if (process.argv[2] === '--help' || process.argv[2] === '-h') {
        console.log(
            `Usage: bun tests/fixtures/sspai-pub-dom-runner.ts [${scenarios.join('|')}]\nMissing browser? ${RECOVERY_HINT}`,
        );
        process.exit(0);
    }
    const scenario = process.argv[2] ?? '';
    if (!scenarios.includes(scenario)) {
        console.error(`unknown scenario '${scenario}' — expected one of: ${scenarios.join(', ')}`);
        process.exit(1);
    }
    launchChromium()
        .then(async (browser) => {
            try {
                const facts = await runSspaiScenario(browser, scenario as SspaiScenario);
                // Last line of stdout is the machine contract for the bun:test guard.
                console.log(JSON.stringify(facts));
            } finally {
                await browser.close();
            }
        })
        .catch((error: unknown) => {
            console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
            process.exit(1);
        });
}
