/**
 * Named real-Chromium fixture runner for the xiaoyuzhou podcast draft flow (task 0295 chunk C1),
 * modeled on sspai's runner (0294 chunk C1): the PRODUCTION `XiaoyuzhouBrowserTransport` publishes
 * against a real headless Chromium whose only reachable page is a synthetic 小宇宙 podcaster studio
 * form fulfilled by route interception ON the real https://podcaster.xiaoyuzhoufm.com origin (never
 * a substitute origin). A catch-all route aborts every other request, so the browser stays
 * loopback-only with zero live provider calls. The transport's injected launcher opens a fresh
 * routed context per launch — the read-only headless session preflight first, then the flow pass.
 *
 * The DOM mirrors the PRODUCTION selector shapes of `XYZF_AUDIO_SELECTORS` (src/selectors.ts):
 * the grounded `input#upload` audio control, `input[name="title"]`, the Draft.js
 * `div[data-contents="true"]` shownotes editor inside the SAME form, the form-scoped cover file
 * input (`form:has(div[data-contents="true"]) input[type="file"]:not(#upload)`) and the
 * exact-visible 保存草稿 save control. The editor installs the `paste` handler production
 * `pasteHtml` drives: its `text/html` becomes the editor's innerHTML. Upload "processing" is
 * simulated: after the audio change event the page asynchronously surfaces an `<audio>` media-ready
 * element in the form, which the flow's processing verification observes (a bare file assignment is
 * never success). The exact-visible 保存草稿 click `history.pushState`s to the id-bearing episode
 * draft URL (the first `XYZF_RECEIPT_URL_RES` shape) with the filled state intact, so the fresh
 * receipt plus persisted readback passes. The save-time page state reaches the runner through the
 * `__kkFixtureReport` binding, and save/preview/title/audio events through their own immediate
 * bindings — so "the save or the upload never happened" is observable even in scenarios that fail
 * before any save click.
 *
 * `audio-timeout` removes the local audio file the moment the flow pass launches: the pre-browser
 * gate saw a real MP3 and the session gate passes, but by the attach step no file can ever be
 * assigned (the change event never fires, processing never starts) and the flow refuses typed at
 * `upload-timeout` immediately — the 600s production processing ceiling is never waited out here.
 *
 * `stale-receipt` pre-renders a receipt-shaped history anchor and the 保存草稿 click pushStates to
 * that SAME already-visible URL: the fresh-signal rule finds no receipt that was not on screen
 * before the click and refuses typed at `draft-receipt` — fill alone is never a saved draft.
 *
 * `chromium.launch` rejects when the browser is missing; the runner surfaces it as an actionable
 * environment failure naming the recovery hint, never a silent skip.
 *
 * Usage: bun tests/fixtures/xiaoyuzhou-pub-dom-runner.ts <scenario>
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import { chromium } from 'playwright';
import { XiaoyuzhouBrowserTransport } from '../../src/flow';

/** Operator recovery for a missing browser — every fixture failure names it. */
export const RECOVERY_HINT = 'bunx playwright install chromium';

export async function launchChromium(): Promise<Browser> {
    try {
        return await chromium.launch({ headless: true, timeout: 20_000 });
    } catch (error) {
        throw new Error(`xiaoyuzhou real-browser fixture could not launch Chromium — run: ${RECOVERY_HINT}`, {
            cause: error,
        });
    }
}

/** Persisted episode draft receipt (first `XYZF_RECEIPT_URL_RES` shape) the 保存草稿 click pushStates to. */
export const REAL_DRAFT_URL = 'https://podcaster.xiaoyuzhoufm.com/episode/xyz26001';

/** Receipt-shaped URL already on screen before the run in the `stale-receipt` scenario (never fresh). */
export const STALE_EPISODE_URL = 'https://podcaster.xiaoyuzhoufm.com/episode/old0001';

/** The target show id the flow's show-verify stage must observe on the page (`metadata.podcastId`). */
const REAL_PODCAST_ID = 'pod26001';

/** A real 1x1 PNG for the cover leg — the flow refuses missing/empty/wrong-typed cover paths. */
const COVER_PNG_1PX = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
);

/** Minimal nonempty MP3 bytes (ID3 header) — the flow gates on extension and readability only. */
const FAKE_MP3_BYTES = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

export type XiaoyuzhouScenario =
    | 'draft-happy'
    | 'draft-happy-cover'
    | 'audio-timeout'
    | 'show-verify-fail'
    | 'missing-save'
    | 'stale-receipt'
    | 'login-missing-controls';

/**
 * Synthetic logged-in 小宇宙 podcaster studio page carrying the production selectors of
 * `XYZF_AUDIO_SELECTORS` (src/selectors.ts). The paste handler lands production `pasteHtml`'s
 * `text/html` in the Draft.js editor; the audio change handler surfaces the media-ready `<audio>`
 * element asynchronously (short timing); the cover change handler renders the in-form preview the
 * cover readback requires (the studio preview link carries a neutral absolute path — an `href="#"`
 * link would resolve against the post-save location and forge a receipt-shaped URL). The save-time
 * report hands the page's own observable state to the runner
 * through the `__kkFixtureReport` binding. The draft click pushStates to `REAL_DRAFT_URL` (fresh
 * receipt); `stale-receipt` pushStates to its pre-rendered, already-visible receipt anchor instead
 * (nothing fresh can confirm); `missing-save` omits the draft control (typed fail-closed, no plain
 * 保存 fallback); `show-verify-fail` drops the show id from the page; `login-missing-controls`
 * omits the audio input AND the editor so the read-only session preflight refuses before any flow
 * launch (the audio file's disappearance is handled outside the page, in the launcher).
 */
export function composerHtml(scenario: XiaoyuzhouScenario): string {
    const showBar = scenario === 'show-verify-fail' ? '' : `<nav class="show-bar">当前节目：${REAL_PODCAST_ID}</nav>`;
    const audioInput =
        scenario === 'login-missing-controls' ? '' : '<input id="upload" type="file" accept="audio/*" />';
    const editor =
        scenario === 'login-missing-controls'
            ? ''
            : '<div data-contents="true" contenteditable="true" style="min-height:6em"></div>';
    const draftButton = scenario === 'missing-save' ? '' : '<button type="button" id="draft-save">保存草稿</button>';
    const staleAnchor = scenario === 'stale-receipt' ? `<a href="${STALE_EPISODE_URL}">历史单集</a>` : '';
    // The stale save lands on the URL that was ALREADY on screen (the anchor), so the fresh-signal
    // rule correctly finds nothing new; every other save lands on the fresh id-bearing draft URL.
    const draftUrl = JSON.stringify(scenario === 'stale-receipt' ? STALE_EPISODE_URL : REAL_DRAFT_URL);
    return `<!doctype html>
<html><body>
${showBar}
<form id="episode-form">
  ${audioInput}
  <input name="title" type="text" />
  ${editor}
  <input type="file" accept="image/*" />
  <a href="/preview" class="episode-preview">预览</a>
  ${draftButton}
</form>
${staleAnchor}
<script>
  const form = document.querySelector('form');
  const upload = document.getElementById('upload');
  const coverInput = document.querySelector('input[type="file"]:not(#upload)');
  if (upload !== null) {
    upload.addEventListener('change', () => {
      window.__kkAudioChange();
      if (upload.files !== null && upload.files.length > 0) {
        // Simulated studio processing: the media record surfaces after the change, never with it.
        setTimeout(() => {
          if (document.querySelector('audio') === null) {
            const player = document.createElement('audio');
            player.controls = true;
            form.appendChild(player);
          }
        }, 150);
      }
    });
  }
  if (coverInput !== null) {
    coverInput.addEventListener('change', () => {
      if (coverInput.files !== null && coverInput.files.length > 0 && document.querySelector('form img') === null) {
        const img = document.createElement('img');
        img.alt = '单集封面预览';
        form.appendChild(img);
      }
    });
  }
  const title = document.querySelector('input[name="title"]');
  if (title !== null) {
    title.addEventListener('input', () => {
      window.__kkTitleInput();
    });
  }
  const editor = document.querySelector('div[data-contents="true"]');
  if (editor !== null) {
    editor.addEventListener('paste', (event) => {
      const html = event.clipboardData === null ? '' : String(event.clipboardData.getData('text/html'));
      if (html.length > 0) editor.innerHTML = html;
    });
  }
  document.querySelector('a.episode-preview').addEventListener('click', (event) => {
    event.preventDefault();
    window.__kkPreviewClick();
  });
  const draft = document.getElementById('draft-save');
  if (draft !== null) {
    draft.addEventListener('click', () => {
      window.__kkSaveClick();
      history.pushState({}, '', ${draftUrl});
      const files = upload !== null && upload.files !== null ? [...upload.files] : [];
      const coverFiles = coverInput !== null && coverInput.files !== null ? [...coverInput.files] : [];
      window.__kkFixtureReport(JSON.stringify({
        audioAssigned: files.length > 0,
        audioName: files.length > 0 ? files[0].name : null,
        title: title === null ? '' : title.value,
        shownotesText: editor === null ? '' : editor.innerText,
        coverCount: coverFiles.length,
        coverName: coverFiles.length > 0 ? coverFiles[0].name : null,
        receiptUrl: location.href,
      }));
    });
  }
</script>
</body></html>`;
}

/** Page-observed state at save time, handed back through the `__kkFixtureReport` binding. */
export interface XiaoyuzhouDomObserved {
    audioAssigned?: boolean;
    audioName?: string | null;
    title?: string;
    shownotesText?: string;
    coverCount?: number;
    coverName?: string | null;
    receiptUrl?: string;
}

/** One production run's observable outcome; assertions live in `tests/xiaoyuzhou-pub-dom.test.ts`. */
export interface XiaoyuzhouDomFacts {
    scenario: string;
    ok?: boolean;
    url?: string;
    id?: string;
    stage?: string;
    confirmedBy?: string;
    error?: string;
    observed?: XiaoyuzhouDomObserved;
    launches: number;
    /** Page-side preview clicks, reported immediately — the flow must keep this at 0. */
    previewClicks: number;
    /** Page-side 保存草稿 clicks, reported immediately. */
    saveClicks: number;
    /** Page-side input events on `input[name="title"]`, reported immediately. */
    titleInputEvents: number;
    /** Page-side change events on `input#upload` — 0 proves no file was ever assigned. */
    audioChangeEvents: number;
}

export async function runXiaoyuzhouScenario(
    browser: Browser,
    scenario: XiaoyuzhouScenario,
): Promise<XiaoyuzhouDomFacts> {
    const scratch = mkdtempSync(join(tmpdir(), 'kk-xyzf-fixture-'));
    try {
        // The preflight refuses a missing profile dir; the fixture owns one scratch dir.
        const profileDir = join(scratch, 'profile');
        mkdirSync(profileDir, { recursive: true });
        // A requested cover always names a real local PNG (never a phantom path); the audio is a
        // real nonempty local MP3 (never a phantom path either).
        const wantsCover = scenario === 'draft-happy-cover';
        const audioPath = join(scratch, 'episode.mp3');
        writeFileSync(audioPath, FAKE_MP3_BYTES);
        const coverPath = join(scratch, 'cover.png');
        if (wantsCover) writeFileSync(coverPath, COVER_PNG_1PX);
        let launches = 0;
        // `__kkFixtureReport` hands the page's save-time state back; the event bindings count the
        // page's own clicks and input events immediately, independent of any save.
        const reports: string[] = [];
        let previewClicks = 0;
        let saveClicks = 0;
        let titleInputEvents = 0;
        let audioChangeEvents = 0;
        const transport = new XiaoyuzhouBrowserTransport('podcast', 'script', {
            launcher: {
                launch: async () => {
                    launches += 1;
                    if (scenario === 'audio-timeout' && launches === 2) {
                        // The pre-browser audio gate passed on a real MP3; the flow pass (launch 2)
                        // must find NO assignable file, so nothing is ever assigned or processed.
                        rmSync(audioPath);
                    }
                    const context = await browser.newContext();
                    // Registered first so the origin handler below (later registrations win) shadows it.
                    await context.route('**/*', (route) => route.abort());
                    await context.route('https://podcaster.xiaoyuzhoufm.com/**', async (route) => {
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
                    await context.exposeFunction('__kkSaveClick', () => {
                        saveClicks += 1;
                    });
                    await context.exposeFunction('__kkTitleInput', () => {
                        titleInputEvents += 1;
                    });
                    await context.exposeFunction('__kkAudioChange', () => {
                        audioChangeEvents += 1;
                    });
                    return context;
                },
            },
            stepTimeoutMs: 8_000,
        });
        const result = await transport.publish({
            content: {
                title: 'Fixture 单集',
                body: 'Hello from the xiaoyuzhou real-DOM fixture\n\n第二段 shownotes',
                format: 'audio',
                metadata: { audioPath, podcastId: REAL_PODCAST_ID },
            },
            // Absent publishStatus defaults to draft: only the exact-visible 保存草稿 control activates.
            options: { profileDir, ...(wantsCover ? { coverPath } : {}) },
        });
        const stage = typeof result.metadata?.stage === 'string' ? result.metadata.stage : undefined;
        const confirmedBy = typeof result.metadata?.confirmedBy === 'string' ? result.metadata.confirmedBy : undefined;
        let observed: XiaoyuzhouDomObserved;
        try {
            const raw = reports[reports.length - 1];
            observed = raw === undefined ? {} : (JSON.parse(raw) as XiaoyuzhouDomObserved);
        } catch {
            observed = {};
        }
        return {
            scenario,
            ok: result.ok,
            ...(result.url === undefined ? {} : { url: result.url }),
            ...(result.id === undefined ? {} : { id: result.id }),
            ...(stage === undefined ? {} : { stage }),
            ...(confirmedBy === undefined ? {} : { confirmedBy }),
            error: result.ok ? undefined : result.error,
            ...(reports.length === 0 ? {} : { observed }),
            launches,
            previewClicks,
            saveClicks,
            titleInputEvents,
            audioChangeEvents,
        };
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

if (import.meta.main) {
    // Subprocess entry only (bun tests/fixtures/xiaoyuzhou-pub-dom-runner.ts <scenario>): the
    // launch must not fire when the test file imports this module's helpers.
    const scenarios: readonly string[] = [
        'draft-happy',
        'draft-happy-cover',
        'audio-timeout',
        'show-verify-fail',
        'missing-save',
        'stale-receipt',
        'login-missing-controls',
    ];
    if (process.argv[2] === '--help' || process.argv[2] === '-h') {
        console.log(
            `Usage: bun tests/fixtures/xiaoyuzhou-pub-dom-runner.ts [${scenarios.join('|')}]\nMissing browser? ${RECOVERY_HINT}`,
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
                const facts = await runXiaoyuzhouScenario(browser, scenario as XiaoyuzhouScenario);
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
