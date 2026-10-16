/**
 * Named real-Chromium fixture runner for the Bilibili video and dynamic flows (task 0297 chunk C1),
 * mirroring the shipinhao (0296) and xiaoyuzhou (0295) runners: the PRODUCTION `BilibiliBrowserTransport`
 * publishes against a real headless Chromium whose reachable pages are synthetic Bilibili creator forms
 * fulfilled by route interception ON real origins (https://member.bilibili.com for shortVideo,
 * https://t.bilibili.com for dynamic; never substitute origins). A catch-all route aborts every other
 * request, guaranteeing an offline, loopback-only environment with zero live platform writes.
 *
 * The DOM mirrors the PRODUCTION selector shapes of `BILI_VIDEO_SELECTORS` and `BILI_DYNAMIC_SELECTORS`:
 * - For shortVideo (member.bilibili.com):
 *   `input[type="file"][accept*="video"]`, title input (`input[maxlength="80"][type="text"]`),
 *   rich-text description editor (`div.ql-editor[contenteditable="true"]`), partition selection
 *   (`div.category-item`), tag input (`input[placeholder="按回车键Enter创建标签"]`) and tag container
 *   (`div.tag-pre-wrp > div.label-item-v2-container`), original "自制" radio (`span.check-radio-v2-name`),
 *   cover main (`div.cover-main` with slot, img, and '更换封面' entry), cover upload modal
 *   (`div.bcc-upload-wrapper > input[type='file']` and `div.submit` '完成'), save draft button
 *   (`button.submit-draft` / '保存草稿') and public submit button (`span.submit-add` / '投稿').
 * - For dynamic (t.bilibili.com):
 *   composer container (`.bili-dyn-publishing`), text editor (`div[placeholder="有什么想和大家分享的？"]`),
 *   image upload input (`div.bili-dyn-publishing__image-upload input[type="file"]`), image previews
 *   (`.bili-pics-uploader__item`), and launch button (`button.bili-dyn-publishing__action__launch`).
 *
 * Traps guarded:
 * - NO `href="#"` anchors anywhere: a bare hash resolves against the current location and can forge
 *   receipt-shaped URLs or false card matches.
 * - Poll loops short-circuited: readiness signals appear quickly (<200ms) in fixture DOM.
 * - Subprocess module entry behind `if (import.meta.main)`.
 *
 * Usage: bun tests/fixtures/bilibili-pub-dom-runner.ts <scenario>
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import { chromium } from 'playwright';
import { BilibiliBrowserTransport } from '../../src/flow';

/** Operator recovery hint named on missing browser prerequisites. */
export const RECOVERY_HINT = 'bunx playwright install chromium';

export async function launchChromium(): Promise<Browser> {
    try {
        return await chromium.launch({ headless: true, timeout: 20_000 });
    } catch (error) {
        throw new Error(`bilibili real-browser fixture could not launch Chromium — run: ${RECOVERY_HINT}`, {
            cause: error,
        });
    }
}

/** Real shortVideo works receipt URL pushStated on public submission. */
export const REAL_VIDEO_PUBLIC_URL = 'https://member.bilibili.com/video/BV1xx411c7mD';
/** Draft receipt URL — the persisted draft the save control must produce (0297 review P2-a). */
export const REAL_DRAFT_RECEIPT_URL = 'https://member.bilibili.com/platform/upload-manager/article?aid=123456';

/** Real dynamic opus receipt URL pushStated on dynamic launch. */
export const REAL_DYNAMIC_PUBLIC_URL = 'https://t.bilibili.com/opus/987654321';

/** Pre-existing stale receipt URL in stale-receipt scenario. */
export const STALE_RECEIPT_URL = 'https://member.bilibili.com/video/BVold000000';

/** A real 1x1 PNG for image/cover upload. */
const PNG_1PX = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
);

/** Minimal nonempty MP4 bytes (ftyp box header). */
const FAKE_MP4_BYTES = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00, 0x6d, 0x70, 0x34,
    0x32, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x08, 0x66, 0x72, 0x65, 0x65,
]);

export type BilibiliScenario =
    | 'video-happy-draft'
    | 'video-happy-public'
    | 'video-cover-fail'
    | 'video-missing-partition'
    | 'dynamic-happy-public'
    | 'dynamic-missing-content'
    | 'dynamic-draft-refusal'
    | 'stale-receipt';

/**
 * Synthetic logged-in member.bilibili.com creator page for shortVideo operations.
 */
export function memberComposerHtml(scenario: BilibiliScenario): string {
    const isStale = scenario === 'stale-receipt';
    const isPartitionMissing = scenario === 'video-missing-partition';
    const isCoverFail = scenario === 'video-cover-fail';
    const staleAnchor = isStale ? `<a href="${STALE_RECEIPT_URL}">历史稿件</a>` : '';
    const partitionText = isPartitionMissing ? '生活' : '知识';

    return `<!doctype html>
<html>
<head><meta charset="utf-8" /></head>
<body>
  <div class="nav-user-info"><span class="header-entry-avatar">User</span></div>
  ${staleAnchor}
  <form id="video-upload-form">
    <input id="video-input" type="file" accept="video/mp4,video/quicktime" />
    <div id="editing-container" style="display:none;">
      <input id="title-input" type="text" maxlength="80" placeholder="请输入视频标题" />
      <div id="desc-editor" class="ql-editor" contenteditable="true" style="min-height:50px;"></div>
      <div id="partitions-wrap" class="partition-wrp">
        <div class="category-item">${partitionText}</div>
      </div>
      <div class="tag-pre-wrp"></div>
      <input id="tag-input" type="text" placeholder="按回车键Enter创建标签" />
      <div class="original-wrap">
        <span class="check-radio-v2-name">自制</span>
      </div>
      <div class="cover-main">
        <div class="cover-slot">
          <div class="cover-img"></div>
        </div>
        <span class="cover-entry-btn">更换封面</span>
      </div>
      <div class="submit-actions">
        <button type="button" class="submit-draft">保存草稿</button>
        <span class="submit-add">投稿</span>
      </div>
    </div>
    <div id="modal-container"></div>
    <div id="toast-container"></div>
  </form>
<script>
  (function() {
    var scenario = ${JSON.stringify(scenario)};
    var isCoverFail = ${isCoverFail ? 'true' : 'false'};
    var isStale = ${isStale ? 'true' : 'false'};
    var realPublicUrl = ${JSON.stringify(REAL_VIDEO_PUBLIC_URL)};

    var videoInput = document.getElementById('video-input');
    var editingContainer = document.getElementById('editing-container');
    var titleInput = document.getElementById('title-input');
    var descEditor = document.getElementById('desc-editor');
    var categoryItem = document.querySelector('.category-item');
    var tagInput = document.getElementById('tag-input');
    var tagWrap = document.querySelector('.tag-pre-wrp');
    var coverEntryBtn = document.querySelector('.cover-entry-btn');
    var modalContainer = document.getElementById('modal-container');
    var toastContainer = document.getElementById('toast-container');
    var submitDraftBtn = document.querySelector('.submit-draft');
    var submitAddBtn = document.querySelector('.submit-add');

    var coverAssigned = false;

    function report() {
      var files = videoInput ? videoInput.files : null;
      var tags = Array.from(tagWrap.querySelectorAll('.label-item-v2-container')).map(function(el) {
        return el.textContent ? el.textContent.trim() : '';
      });
      var selectedCat = document.querySelector('.category-item.active, .category-item.selected');
      var slot = document.querySelector('.cover-slot .cover-img');

      window.__kkFixtureReport(JSON.stringify({
        videoAssigned: files !== null && files.length > 0,
        videoName: files !== null && files.length > 0 ? files[0].name : null,
        title: titleInput ? titleInput.value : '',
        descriptionText: descEditor ? descEditor.innerText : '',
        partition: selectedCat ? selectedCat.textContent.trim() : '',
        tags: tags,
        coverAssigned: coverAssigned || Boolean(slot && slot.style.backgroundImage),
        receiptUrl: location.href,
      }));
    }

    // Video change -> processing readiness
    videoInput.addEventListener('change', function() {
      window.__kkVideoChange();
      setTimeout(function() {
        editingContainer.style.display = 'block';
      }, 50);
    });

    // Description paste
    descEditor.addEventListener('paste', function(e) {
      var data = e.clipboardData;
      var text = data ? data.getData('text/plain') : '';
      if (text) {
        descEditor.innerText = text;
      }
    });

    // Partition click
    if (categoryItem) {
      categoryItem.addEventListener('click', function() {
        categoryItem.classList.add('active');
        categoryItem.classList.add('selected');
      });
    }

    // Tag input Enter
    tagInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var val = tagInput.value.trim();
        if (val) {
          var item = document.createElement('div');
          item.className = 'label-item-v2-container';
          item.innerHTML = '<span>' + val + '</span>';
          item.addEventListener('click', function() { item.remove(); });
          tagWrap.appendChild(item);
          tagInput.value = '';
        }
      }
    });

    // Cover modal flow
    coverEntryBtn.addEventListener('click', function() {
      window.__kkCoverEntryClick();
      if (isCoverFail) {
        // Crop failure: modal missing '完成' button
        modalContainer.innerHTML = '<div class="bcc-upload-wrapper"><input id="cover-file-input" type="file" accept="image/png, image/jpeg" /><div class="submit">取消</div></div>';
        return;
      }
      modalContainer.innerHTML = '<div class="bcc-upload-wrapper"><input id="cover-file-input" type="file" accept="image/png, image/jpeg" /><div class="submit">完成</div></div>';
      var coverFileInput = document.getElementById('cover-file-input');
      var doneBtn = modalContainer.querySelector('.submit');
      coverFileInput.addEventListener('change', function() {
        window.__kkCoverChange();
        coverAssigned = true;
      });
      doneBtn.addEventListener('click', function() {
        window.__kkCoverConfirm();
        var slotImg = document.querySelector('.cover-slot .cover-img');
        if (slotImg) {
          slotImg.style.backgroundImage = 'url("/cover-committed.png")';
        }
        modalContainer.innerHTML = '';
      });
    });

    // Draft save: a persisted draft must be observable (fresh id-bearing URL), never a toast alone
    // (0297 review P2-a: the toast is supplementary; the URL change is the receipt).
    submitDraftBtn.addEventListener('click', function() {
      window.__kkSaveClick();
      var toast = document.createElement('div');
      toast.className = 'bcc-toast';
      toast.textContent = '草稿已保存';
      toastContainer.appendChild(toast);
      history.pushState({}, '', ${JSON.stringify(REAL_DRAFT_RECEIPT_URL)});
      report();
    });

    // Public submit
    submitAddBtn.addEventListener('click', function() {
      window.__kkPublishClick();
      if (!isStale) {
        history.pushState({}, '', realPublicUrl);
      }
      report();
    });
  })();
</script>
</body>
</html>`;
}

/**
 * Synthetic logged-in t.bilibili.com dynamic feed page for dynamic operations.
 */
export function dynamicComposerHtml(_scenario: BilibiliScenario): string {
    return `<!doctype html>
<html>
<head><meta charset="utf-8" /></head>
<body>
  <div class="nav-user-info"><span class="header-entry-avatar">User</span></div>
  <div class="bili-dyn-publishing">
    <div id="dynamic-editor" placeholder="有什么想和大家分享的？" contenteditable="true" style="min-height:50px;"></div>
    <div class="bili-dyn-publishing__image-upload" style="display:none;">
      <input id="image-file-input" type="file" name="upload" multiple accept="image/*" />
    </div>
    <div class="bili-pics-uploader"></div>
    <button type="button" class="bili-dyn-publishing__action__launch">发布</button>
  </div>
<script>
  (function() {
    var realDynamicUrl = ${JSON.stringify(REAL_DYNAMIC_PUBLIC_URL)};

    var editor = document.getElementById('dynamic-editor');
    var imageInput = document.getElementById('image-file-input');
    var uploaderContainer = document.querySelector('.bili-pics-uploader');
    var launchBtn = document.querySelector('.bili-dyn-publishing__action__launch');

    function report() {
      var previews = document.querySelectorAll('.bili-pics-uploader__item, .bili-dyn-publishing__image-item');
      window.__kkFixtureReport(JSON.stringify({
        text: editor ? editor.innerText : '',
        imagesCount: previews.length,
        receiptUrl: location.href,
      }));
    }

    editor.addEventListener('paste', function(e) {
      var data = e.clipboardData;
      var text = data ? data.getData('text/plain') : '';
      if (text) {
        editor.innerText = text;
      }
    });

    imageInput.addEventListener('change', function() {
      window.__kkImageChange();
      var files = imageInput.files;
      if (files) {
        for (var i = 0; i < files.length; i++) {
          var item = document.createElement('div');
          item.className = 'bili-pics-uploader__item';
          item.innerHTML = '<div class="bili-pics-uploader__item__remove"></div>';
          (function(el) {
            el.querySelector('.bili-pics-uploader__item__remove').addEventListener('click', function() {
              el.remove();
            });
          })(item);
          uploaderContainer.appendChild(item);
        }
      }
    });

    launchBtn.addEventListener('click', function() {
      window.__kkPublishClick();
      history.pushState({}, '', realDynamicUrl);
      report();
    });
  })();
</script>
</body>
</html>`;
}

/** Page-observed state handed back through the `__kkFixtureReport` binding. */
export interface BilibiliDomObserved {
    videoAssigned?: boolean;
    videoName?: string | null;
    title?: string;
    descriptionText?: string;
    partition?: string;
    tags?: string[];
    coverAssigned?: boolean;
    receiptUrl?: string;
    text?: string;
    imagesCount?: number;
}

/** One production run's observable outcome; assertions live in `tests/bilibili-pub-dom.test.ts`. */
export interface BilibiliDomFacts {
    scenario: string;
    ok?: boolean;
    url?: string;
    bvid?: string;
    status?: string;
    stage?: string;
    receipt?: string;
    publishStatus?: string;
    error?: string;
    observed?: BilibiliDomObserved;
    launches: number;
    saveClicks: number;
    publishClicks: number;
    videoChangeEvents: number;
    coverEntryClicks: number;
    coverChangeEvents: number;
    coverConfirmClicks: number;
    imageChangeEvents: number;
}

export async function runBilibiliScenario(browser: Browser, scenario: BilibiliScenario): Promise<BilibiliDomFacts> {
    // Pre-browser refusals: dynamic-missing-content and dynamic-draft-refusal
    if (scenario === 'dynamic-missing-content') {
        const transport = new BilibiliBrowserTransport('dynamic', 'script');
        const result = await transport.publish({
            content: {
                title: '动态',
                body: '',
                format: 'article',
                metadata: {
                    publishStatus: 'public',
                },
            },
        });
        return {
            scenario,
            ok: result.ok,
            error: result.error,
            launches: 0,
            saveClicks: 0,
            publishClicks: 0,
            videoChangeEvents: 0,
            coverEntryClicks: 0,
            coverChangeEvents: 0,
            coverConfirmClicks: 0,
            imageChangeEvents: 0,
        };
    }

    if (scenario === 'dynamic-draft-refusal') {
        const transport = new BilibiliBrowserTransport('dynamic', 'script');
        const result = await transport.publish({
            content: {
                title: '动态',
                body: '想和大家分享一段内容',
                format: 'article',
                metadata: {
                    publishStatus: 'draft',
                },
            },
        });
        return {
            scenario,
            ok: result.ok,
            error: result.error,
            launches: 0,
            saveClicks: 0,
            publishClicks: 0,
            videoChangeEvents: 0,
            coverEntryClicks: 0,
            coverChangeEvents: 0,
            coverConfirmClicks: 0,
            imageChangeEvents: 0,
        };
    }

    const scratch = mkdtempSync(join(tmpdir(), 'kk-bili-fixture-'));
    try {
        const profileDir = join(scratch, 'profile');
        mkdirSync(profileDir, { recursive: true });

        const videoPath = join(scratch, 'fixture-video.mp4');
        writeFileSync(videoPath, FAKE_MP4_BYTES);
        const coverPath = join(scratch, 'cover.png');
        writeFileSync(coverPath, PNG_1PX);
        const imagePath = join(scratch, 'image.png');
        writeFileSync(imagePath, PNG_1PX);

        let launches = 0;
        const reports: string[] = [];
        let saveClicks = 0;
        let publishClicks = 0;
        let videoChangeEvents = 0;
        let coverEntryClicks = 0;
        let coverChangeEvents = 0;
        let coverConfirmClicks = 0;
        let imageChangeEvents = 0;

        const isDynamic = scenario === 'dynamic-happy-public';
        const isPublic = scenario === 'video-happy-public' || scenario === 'stale-receipt';
        const stepTimeoutMs =
            scenario === 'stale-receipt' || scenario === 'video-missing-partition' || scenario === 'video-cover-fail'
                ? 2_000
                : 8_000;

        const launcher = {
            launch: async () => {
                launches += 1;
                const context = await browser.newContext();
                // Registered first: catch-all route aborts every request
                await context.route('**/*', (route) => route.abort());

                // Route member origin for member.bilibili.com
                await context.route('https://member.bilibili.com/**', async (route) => {
                    if (route.request().method() === 'GET') {
                        if (route.request().url().endsWith('.png') || route.request().url().endsWith('.jpg')) {
                            await route.fulfill({ contentType: 'image/png', body: PNG_1PX });
                            return;
                        }
                        await route.fulfill({
                            contentType: 'text/html; charset=utf-8',
                            body: memberComposerHtml(scenario),
                        });
                        return;
                    }
                    await route.abort();
                });

                // Route dynamic origin for t.bilibili.com
                await context.route('https://t.bilibili.com/**', async (route) => {
                    if (route.request().method() === 'GET') {
                        if (route.request().url().endsWith('.png') || route.request().url().endsWith('.jpg')) {
                            await route.fulfill({ contentType: 'image/png', body: PNG_1PX });
                            return;
                        }
                        await route.fulfill({
                            contentType: 'text/html; charset=utf-8',
                            body: dynamicComposerHtml(scenario),
                        });
                        return;
                    }
                    await route.abort();
                });

                // Bindings
                await context.exposeFunction('__kkFixtureReport', (payload: string) => {
                    reports.push(payload);
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
                await context.exposeFunction('__kkImageChange', () => {
                    imageChangeEvents += 1;
                });

                return context;
            },
        };

        const transport = new BilibiliBrowserTransport(isDynamic ? 'dynamic' : 'shortVideo', 'script', {
            launcher,
            stepTimeoutMs,
            uploadTimeoutMs: stepTimeoutMs,
        });

        const payload = isDynamic
            ? {
                  content: {
                      title: '动态',
                      body: '想和大家分享今天的新进展。',
                      format: 'article' as const,
                      metadata: {
                          publishStatus: 'public' as const,
                          images: [imagePath],
                      },
                  },
                  options: { profileDir },
              }
            : {
                  content: {
                      title: 'Fixture Bilibili 视频标题',
                      body: 'Fixture Bilibili 视频描述正文。',
                      format: 'video' as const,
                      metadata: {
                          videoPath,
                          partition: '知识',
                          tags: ['科技', '数码'],
                          coverPath,
                          ...(isPublic ? { publishStatus: 'public' as const } : {}),
                      },
                  },
                  options: { profileDir },
              };

        const result = await transport.publish(payload);

        const stage = typeof result.metadata?.stage === 'string' ? result.metadata.stage : undefined;
        const status = typeof result.metadata?.status === 'string' ? result.metadata.status : undefined;
        const bvid = typeof result.metadata?.bvid === 'string' ? result.metadata.bvid : undefined;
        const receipt = typeof result.metadata?.receipt === 'string' ? result.metadata.receipt : undefined;
        const publishStatus =
            typeof result.metadata?.publishStatus === 'string' ? result.metadata.publishStatus : undefined;

        let observed: BilibiliDomObserved;
        try {
            const raw = reports[reports.length - 1];
            observed = raw === undefined ? {} : (JSON.parse(raw) as BilibiliDomObserved);
        } catch {
            observed = {};
        }

        return {
            scenario,
            ok: result.ok,
            ...(result.url === undefined ? {} : { url: result.url }),
            ...(bvid === undefined ? {} : { bvid }),
            ...(status === undefined ? {} : { status }),
            ...(stage === undefined ? {} : { stage }),
            ...(receipt === undefined ? {} : { receipt }),
            ...(publishStatus === undefined ? {} : { publishStatus }),
            error: result.ok ? undefined : result.error,
            ...(reports.length === 0 ? {} : { observed }),
            launches,
            saveClicks,
            publishClicks,
            videoChangeEvents,
            coverEntryClicks,
            coverChangeEvents,
            coverConfirmClicks,
            imageChangeEvents,
        };
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

if (import.meta.main) {
    const scenarios: readonly string[] = [
        'video-happy-draft',
        'video-happy-public',
        'video-cover-fail',
        'video-missing-partition',
        'dynamic-happy-public',
        'dynamic-missing-content',
        'dynamic-draft-refusal',
        'stale-receipt',
    ];

    if (process.argv[2] === '--help' || process.argv[2] === '-h') {
        console.log(
            `Usage: bun tests/fixtures/bilibili-pub-dom-runner.ts [${scenarios.join('|')}]\nMissing browser? ${RECOVERY_HINT}`,
        );
        process.exit(0);
    }

    const scenario = process.argv[2] ?? '';
    if (!scenarios.includes(scenario)) {
        console.error(`unknown scenario '${scenario}' — expected one of: ${scenarios.join(', ')}`);
        process.exit(1);
    }

    if (scenario === 'dynamic-missing-content' || scenario === 'dynamic-draft-refusal') {
        runBilibiliScenario(null as unknown as Browser, scenario as BilibiliScenario)
            .then((facts) => {
                console.log(JSON.stringify(facts));
            })
            .catch((error: unknown) => {
                console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
                process.exit(1);
            });
    } else {
        launchChromium()
            .then(async (browser) => {
                try {
                    const facts = await runBilibiliScenario(browser, scenario as BilibiliScenario);
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
}
