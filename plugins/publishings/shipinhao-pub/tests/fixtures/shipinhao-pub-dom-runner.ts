/**
 * Named real-Chromium fixture runner for the shipinhao short-video flow (task 0296 chunk C1),
 * mirroring the xiaoyuzhou runner (0295 chunk C1): the PRODUCTION `ShipinhaoBrowserTransport`
 * publishes against a real headless Chromium whose only reachable page is a synthetic WeChat
 * Channels creator form fulfilled by route interception ON the real https://channels.weixin.qq.com
 * origin (never a substitute origin). A catch-all route aborts every other request, so the browser
 * stays loopback-only with zero live provider calls. The transport's injected launcher opens a
 * fresh routed context per launch — the read-only headless session preflight first, then the flow
 * pass.
 *
 * The DOM mirrors the PRODUCTION selector shapes of `SHP_VIDEO_SELECTORS` (src/selectors.ts):
 * `input[type="file"][accept*="video"]`, the 短标题 title input, the 添加描述 contenteditable
 * editor, the `div.cover-preview-wrap > div` cover slot, the `div.cover-control-wrap` cover dialog
 * with its own file input and `div.finder-dialog-footer` 确认 button, the 声明原创 entry row plus
 * the `div.declare-body-wrapper` agreement/confirm 弹层, and the exact-visible 保存草稿/发表
 * buttons — all inside ONE form, and both file inputs OUTSIDE the contenteditable editor (a paste
 * must never be able to destroy an input). For wujie scenarios the form lives in a delayed
 * (≈1.2s) OPEN `wujie-app` shadowRoot, which exercises the 30s production root wait without
 * waiting it out; `direct-happy-draft` renders the same form on the document with no wujie-app at
 * all.
 *
 * "Upload processing" is simulated the way the vendor observes it: after the video change event
 * the page surfaces the post-upload editing form (title input + description editor) in the same
 * root ~200ms later, which the flow's processing verification observes — a bare file assignment is
 * never success. The 声明原创 entry checkbox opens the 弹层; its exact 声明原创 confirm removes it
 * and keeps the entry checked. The cover 确认 removes the dialog and commits changed slot evidence
 * (canvas presence alone is never enough). The save/publish click `history.pushState`s to the
 * id-bearing record URL (the first `SHP_RECEIPT_URL_RES` shape) with the filled state intact, so
 * the fresh receipt plus persisted readback passes. The save-time page state reaches the runner
 * through the `__kkFixtureReport` binding, and each page event (preview decoy, save, publish,
 * video/cover/original interactions) through its own immediate binding — so "the save or the
 * upload never happened" is observable even in scenarios that fail before any save click.
 *
 * Traps applied (learned from the earlier channel fixtures): no `href="#"` anchors anywhere (a
 * bare hash resolves against the post-save location and can forge a receipt-shaped URL — every
 * anchor here is a neutral absolute path); the editor paste handler APPENDS the pasted nodes and
 * never replaces the editor's children.
 *
 * `wujie-never-root` models the vendor's late/unstable wujie root deterministically: the session
 * readiness predicate and the flow's `resolveCreatorRoot` read the SAME root snapshot, so a page
 * whose shadow never comes up would be refused by the post-goto session gate (a login-shaped
 * error) before the root policy could speak. Instead the page attaches the root with evidence —
 * the gate's passing read — and drops the shadow on the very next read (a counting getter on the
 * host element), which is exactly the flow-pass window: the root is NEVER ready within the bounded
 * 30s window, the flow refuses typed at `root-resolve` (`shadow_root_not_ready`, no wrong-root
 * document fallback), and the document-level input capture proves no field was ever filled.
 *
 * `chromium.launch` rejects when the browser is missing; the runner surfaces it as an actionable
 * environment failure naming the recovery hint, never a silent skip. Production timeouts in
 * `src/` are untouched: readiness signals appear quickly, so only the deliberately refusal legs
 * wait out their (short, injected) ceilings — the 600s media ceiling stays literal and unwaited.
 *
 * Usage: bun tests/fixtures/shipinhao-pub-dom-runner.ts <scenario>
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import { chromium } from 'playwright';
import { ShipinhaoBrowserTransport } from '../../src/flow';

/** Operator recovery for a missing browser — every fixture failure names it. */
export const RECOVERY_HINT = 'bunx playwright install chromium';

export async function launchChromium(): Promise<Browser> {
    try {
        return await chromium.launch({ headless: true, timeout: 20_000 });
    } catch (error) {
        throw new Error(`shipinhao real-browser fixture could not launch Chromium — run: ${RECOVERY_HINT}`, {
            cause: error,
        });
    }
}

/** Persisted draft receipt (first `SHP_RECEIPT_URL_RES` shape) the 保存草稿 click pushStates to. */
export const REAL_DRAFT_URL = 'https://channels.weixin.qq.com/platform/record/detail/shp26001';

/** Persisted works receipt (`/post/video/<id>` shape) the 发表 click pushStates to in the public leg. */
export const REAL_PUBLISH_URL = 'https://channels.weixin.qq.com/platform/post/video/pub0777';

/** Receipt-shaped URL already on screen before the run in the `wujie-stale-receipt` scenario. */
export const STALE_RECORD_URL = 'https://channels.weixin.qq.com/platform/record/detail/old0001';

/** A real 1x1 PNG for the cover leg — the flow refuses missing/empty/wrong-typed cover paths. */
const COVER_PNG_1PX = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
);

/** Minimal nonempty MP4 bytes (ftyp box header) — the flow gates on extension and readability only. */
const FAKE_MP4_BYTES = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00, 0x6d, 0x70, 0x34,
    0x32, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x08, 0x66, 0x72, 0x65, 0x65,
]);

export type ShipinhaoScenario =
    | 'wujie-happy-draft'
    | 'direct-happy-draft'
    | 'wujie-never-root'
    | 'wujie-cover'
    | 'wujie-original'
    | 'wujie-original-missing'
    | 'wujie-publish-public'
    | 'wujie-stale-receipt';

/**
 * Synthetic logged-in 视频号 creator page carrying the production selectors of
 * `SHP_VIDEO_SELECTORS` (src/selectors.ts). Wujie scenarios build the creator form inside a
 * `wujie-app` shadowRoot attached after ≈1.2s (the vendor's cold-load lateness the 30s root wait
 * exists for); `direct-happy-draft` builds the identical form on the document with no wujie-app.
 * `wujie-never-root` arms the shadow-dropping instrument described in the module header. The save
 * click lands on `REAL_DRAFT_URL` (fresh receipt) except in `wujie-stale-receipt`, where it lands
 * on the pre-rendered, already-visible `STALE_RECORD_URL` anchor (nothing fresh can confirm).
 */
export function composerHtml(scenario: ShipinhaoScenario): string {
    const isWujie = scenario !== 'direct-happy-draft';
    const dropInstrument = scenario === 'wujie-never-root';
    const wantsOriginalDialog = scenario === 'wujie-original';
    const staleAnchor = scenario === 'wujie-stale-receipt' ? `<a href="${STALE_RECORD_URL}">历史记录</a>` : '';
    // The stale save lands on the URL that was ALREADY on screen (the anchor), so the fresh-signal
    // rule correctly finds nothing new; every other save lands on the fresh id-bearing record URL.
    const draftUrl = JSON.stringify(scenario === 'wujie-stale-receipt' ? STALE_RECORD_URL : REAL_DRAFT_URL);
    const publishUrl = JSON.stringify(REAL_PUBLISH_URL);
    return `<!doctype html>
<html><body>
${isWujie ? '<wujie-app></wujie-app>' : ''}
${staleAnchor}
<script>
  (function () {
    var scenario = ${JSON.stringify(scenario)};
    var dropInstrument = ${dropInstrument ? 'true' : 'false'};
    var wantsOriginalDialog = ${wantsOriginalDialog ? 'true' : 'false'};
    var draftUrl = ${draftUrl};
    var publishUrl = ${publishUrl};
    var host = document.querySelector('wujie-app');
    var readyReads = 0;
    // Cover assignment is captured at change time: the 确认 commit removes the dialog (and its
    // file input) from the DOM, so the save-time report cannot re-read the live input.
    var coverAssigned = false;
    var coverName = null;
    if (host !== null) {
      // Passthrough getter; when armed, the read AFTER the session gate's first ready read (i.e.
      // the flow's first root read) sees no shadowRoot and it never returns within the window.
      Object.defineProperty(host, 'shadowRoot', {
        get: function () {
          var shadow = host.__kkShadow || null;
          if (dropInstrument) {
            if (shadow === null) { readyReads = 0; return null; }
            readyReads += 1;
            if (readyReads >= 2) return null;
          }
          return shadow;
        },
      });
    }
    // Document-level capture of every input event (composed events cross the shadow boundary):
    // the never-root refusal must prove NO field anywhere was ever filled.
    document.addEventListener('input', function () { window.__kkDocInput(); }, true);

    function buildForm(mount) {
      var form = document.createElement('form');
      form.id = 'creator-form';
      form.innerHTML =
        '<input id="video-input" type="file" accept="video/mp4,video/quicktime" />'
        + '<div class="cover-preview-wrap"><div class="cover-slot"></div></div>'
        + '<label class="original-row"><input id="original-entry" type="checkbox" class="original-checkbox" />声明原创</label>'
        + '<a href="/preview" class="preview-link">预览</a>'
        + '<button type="button" id="save-draft">保存草稿</button>'
        + '<button type="button" id="publish-go">发表</button>';
      mount.appendChild(form);
      wireForm(mount, form);
    }

    function report(form) {
      var video = form.querySelector('#video-input');
      var files = video.files;
      var entry = form.querySelector('#original-entry');
      var editor = form.querySelector('#description-editor');
      var title = form.querySelector('#title-input');
      window.__kkFixtureReport(JSON.stringify({
        videoAssigned: files !== null && files.length > 0,
        videoName: files !== null && files.length > 0 ? files[0].name : null,
        title: title === null ? '' : title.value,
        descriptionText: editor === null ? '' : editor.innerText,
        coverAssigned: coverAssigned,
        coverName: coverName,
        coverCommitted: form.querySelector('.cover-slot').getAttribute('data-cover-committed') === '1',
        originalEntryChecked: entry !== null && entry.checked,
        originalWrapperPresent: form.querySelector('.declare-body-wrapper') !== null,
        receiptUrl: location.href,
      }));
    }

    function wireEditing(form) {
      var editor = form.querySelector('#description-editor');
      editor.addEventListener('paste', function (event) {
        var data = event.clipboardData;
        var html = data === null || data === undefined ? '' : String(data.getData('text/html'));
        if (html.length > 0) {
          // Append the pasted nodes; replacing children could destroy anything sharing the editor.
          var probe = document.createElement('div');
          probe.innerHTML = html;
          while (probe.firstChild !== null) editor.appendChild(probe.firstChild);
        }
      });
    }

    function wireForm(scope, form) {
      var video = form.querySelector('#video-input');
      var slot = form.querySelector('.cover-slot');
      var entry = form.querySelector('#original-entry');
      video.addEventListener('change', function () {
        window.__kkVideoChange();
        if (video.files !== null && video.files.length > 0 && scope.querySelector('#title-input') === null) {
          // Simulated platform processing: the post-upload editing form surfaces AFTER the change,
          // never with it — the flow's processing verification must observe it in the active root.
          setTimeout(function () {
            if (scope.querySelector('#title-input') !== null) return;
            var editing = document.createElement('div');
            editing.innerHTML =
              '<input id="title-input" type="text" placeholder="请填写短标题" />'
              + '<div id="description-editor" contenteditable="true" data-placeholder="添加描述"></div>';
            while (editing.firstChild !== null) form.appendChild(editing.firstChild);
            wireEditing(form);
          }, 200);
        }
      });
      slot.addEventListener('click', function () {
        window.__kkCoverEntryClick();
        if (form.querySelector('.cover-control-wrap') !== null) return;
        var dialog = document.createElement('div');
        dialog.className = 'cover-control-wrap';
        dialog.innerHTML =
          '<div class="cover-dialog-title">封面设置</div>'
          + '<input type="file" accept="image/*" class="cover-file-input" />'
          + '<div class="finder-dialog-footer"><button type="button" class="cover-confirm">确认</button></div>';
        form.appendChild(dialog);
        dialog.querySelector('.cover-file-input').addEventListener('change', function () {
          window.__kkCoverChange();
          var cf = dialog.querySelector('.cover-file-input').files;
          coverAssigned = cf !== null && cf.length > 0;
          coverName = coverAssigned ? cf[0].name : null;
        });
        dialog.querySelector('.cover-confirm').addEventListener('click', function () {
          window.__kkCoverConfirm();
          dialog.remove();
          slot.textContent = '';
          slot.setAttribute('data-cover-committed', '1');
          var img = document.createElement('img');
          img.src = '/cover/committed.png';
          slot.appendChild(img);
        });
      });
      entry.addEventListener('change', function () {
        window.__kkOriginalEntryClick();
        if (!wantsOriginalDialog || form.querySelector('.declare-body-wrapper') !== null) return;
        var dialog = document.createElement('div');
        dialog.className = 'declare-body-wrapper';
        dialog.innerHTML =
          '<div class="declare-body"><label>我已阅读并同意声明原创协议</label>'
          + '<input type="checkbox" class="ant-checkbox-input" />'
          + '<button type="button" class="declare-confirm">声明原创</button></div>';
        form.appendChild(dialog);
        dialog.querySelector('.declare-confirm').addEventListener('click', function () {
          window.__kkOriginalConfirm();
          dialog.remove();
        });
      });
      form.querySelector('#save-draft').addEventListener('click', function () {
        window.__kkSaveClick();
        history.pushState({}, '', draftUrl);
        report(form);
      });
      form.querySelector('#publish-go').addEventListener('click', function () {
        window.__kkPublishClick();
        history.pushState({}, '', publishUrl);
        report(form);
      });
    }

    if (host === null) {
      buildForm(document.body);
    } else {
      // Cold-load lateness: the shadowRoot attaches ~1.2s after load, inside the production wait.
      setTimeout(function () {
        var shadow = host.attachShadow({ mode: 'open' });
        host.__kkShadow = shadow;
        buildForm(shadow);
      }, 1200);
    }
  })();
</script>
</body></html>`;
}

/** Page-observed state at save time, handed back through the `__kkFixtureReport` binding. */
export interface ShipinhaoDomObserved {
    videoAssigned?: boolean;
    videoName?: string | null;
    title?: string;
    descriptionText?: string;
    coverAssigned?: boolean;
    coverName?: string | null;
    coverCommitted?: boolean;
    originalEntryChecked?: boolean;
    originalWrapperPresent?: boolean;
    receiptUrl?: string;
}

/** One production run's observable outcome; assertions live in `tests/shipinhao-pub-dom.test.ts`. */
export interface ShipinhaoDomFacts {
    scenario: string;
    ok?: boolean;
    url?: string;
    id?: string;
    stage?: string;
    confirmedBy?: string;
    publishStatus?: string;
    original?: boolean;
    error?: string;
    observed?: ShipinhaoDomObserved;
    launches: number;
    /** Page-side preview decoy clicks, reported immediately — the flow must keep this at 0. */
    previewClicks: number;
    /** Page-side 保存草稿 clicks, reported immediately. */
    saveClicks: number;
    /** Page-side 发表 clicks, reported immediately — a draft run must keep this at 0. */
    publishClicks: number;
    /** Page-side change events on the video input — 0 proves no file was ever assigned. */
    videoChangeEvents: number;
    coverEntryClicks: number;
    coverChangeEvents: number;
    coverConfirmClicks: number;
    originalEntryClicks: number;
    originalConfirmClicks: number;
    /** Document-level input events — 0 in `wujie-never-root` proves no wrong-root field was filled. */
    docInputEvents: number;
}

export async function runShipinhaoScenario(browser: Browser, scenario: ShipinhaoScenario): Promise<ShipinhaoDomFacts> {
    const scratch = mkdtempSync(join(tmpdir(), 'kk-shp-fixture-'));
    try {
        // The preflight refuses a missing profile dir; the fixture owns one scratch dir.
        const profileDir = join(scratch, 'profile');
        mkdirSync(profileDir, { recursive: true });
        // A requested cover always names a real local PNG and the video a real nonempty local MP4
        // (never phantom paths) — both pre-browser gates probe readability.
        const wantsCover = scenario === 'wujie-cover';
        const wantsOriginal = scenario === 'wujie-original' || scenario === 'wujie-original-missing';
        const publishPublic = scenario === 'wujie-publish-public';
        const videoPath = join(scratch, 'fixture-video.mp4');
        writeFileSync(videoPath, FAKE_MP4_BYTES);
        const coverPath = join(scratch, 'cover.png');
        if (wantsCover) writeFileSync(coverPath, COVER_PNG_1PX);
        let launches = 0;
        // `__kkFixtureReport` hands the page's save-time state back; the event bindings count the
        // page's own clicks and change events immediately, independent of any save.
        const reports: string[] = [];
        let previewClicks = 0;
        let saveClicks = 0;
        let publishClicks = 0;
        let videoChangeEvents = 0;
        let coverEntryClicks = 0;
        let coverChangeEvents = 0;
        let coverConfirmClicks = 0;
        let originalEntryClicks = 0;
        let originalConfirmClicks = 0;
        let docInputEvents = 0;
        const transport = new ShipinhaoBrowserTransport('shortVideo', 'script', {
            launcher: {
                launch: async () => {
                    launches += 1;
                    const context = await browser.newContext();
                    // Registered first so the origin handler below (later registrations win) shadows it.
                    await context.route('**/*', (route) => route.abort());
                    await context.route('https://channels.weixin.qq.com/**', async (route) => {
                        if (route.request().method() === 'GET') {
                            if (route.request().url().endsWith('.png')) {
                                await route.fulfill({ contentType: 'image/png', body: COVER_PNG_1PX });
                                return;
                            }
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
                    await context.exposeFunction('__kkPublishClick', () => {
                        publishClicks += 1;
                    });
                    await context.exposeFunction('__kkVideoChange', () => {
                        videoChangeEvents += 1;
                    });
                    await context.exposeFunction('__kkCoverEntryClick', () => {
                        coverEntryClicks += 1;
                    });
                    await context.exposeFunction('__kkCoverChange', () => {
                        coverChangeEvents += 1;
                    });
                    await context.exposeFunction('__kkCoverConfirm', () => {
                        coverConfirmClicks += 1;
                    });
                    await context.exposeFunction('__kkOriginalEntryClick', () => {
                        originalEntryClicks += 1;
                    });
                    await context.exposeFunction('__kkOriginalConfirm', () => {
                        originalConfirmClicks += 1;
                    });
                    await context.exposeFunction('__kkDocInput', () => {
                        docInputEvents += 1;
                    });
                    return context;
                },
            },
            stepTimeoutMs: 8_000,
        });
        // Absent publishStatus defaults to draft: only the exact-visible 保存草稿 control activates;
        // 'public' (publish leg) goes through the exact 发表 button and a fresh works receipt.
        const result = await transport.publish({
            content: {
                title: 'Fixture 短标题',
                body: 'Fixture 描述正文，含第二句。',
                format: 'video',
                metadata: {
                    videoPath,
                    tags: ['fixturetag'],
                    ...(wantsCover ? { coverPath } : {}),
                    ...(wantsOriginal ? { original: true } : {}),
                    ...(publishPublic ? { publishStatus: 'public' } : {}),
                },
            },
            options: { profileDir },
        });
        const stage = typeof result.metadata?.stage === 'string' ? result.metadata.stage : undefined;
        const confirmedBy = typeof result.metadata?.confirmedBy === 'string' ? result.metadata.confirmedBy : undefined;
        const publishStatus =
            typeof result.metadata?.publishStatus === 'string' ? result.metadata.publishStatus : undefined;
        const original = result.metadata?.original === true ? true : undefined;
        let observed: ShipinhaoDomObserved;
        try {
            const raw = reports[reports.length - 1];
            observed = raw === undefined ? {} : (JSON.parse(raw) as ShipinhaoDomObserved);
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
            ...(publishStatus === undefined ? {} : { publishStatus }),
            ...(original === undefined ? {} : { original }),
            error: result.ok ? undefined : result.error,
            ...(reports.length === 0 ? {} : { observed }),
            launches,
            previewClicks,
            saveClicks,
            publishClicks,
            videoChangeEvents,
            coverEntryClicks,
            coverChangeEvents,
            coverConfirmClicks,
            originalEntryClicks,
            originalConfirmClicks,
            docInputEvents,
        };
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

if (import.meta.main) {
    // Subprocess entry only (bun tests/fixtures/shipinhao-pub-dom-runner.ts <scenario>): the
    // launch must not fire when the test file imports this module's helpers.
    const scenarios: readonly string[] = [
        'wujie-happy-draft',
        'direct-happy-draft',
        'wujie-never-root',
        'wujie-cover',
        'wujie-original',
        'wujie-original-missing',
        'wujie-publish-public',
        'wujie-stale-receipt',
    ];
    if (process.argv[2] === '--help' || process.argv[2] === '-h') {
        console.log(
            `Usage: bun tests/fixtures/shipinhao-pub-dom-runner.ts [${scenarios.join('|')}]\nMissing browser? ${RECOVERY_HINT}`,
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
                const facts = await runShipinhaoScenario(browser, scenario as ShipinhaoScenario);
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
