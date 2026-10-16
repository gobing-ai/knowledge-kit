/**
 * Task 0295 chunk C2 — behavior tests for the xiaoyuzhou-pub podcast publisher, layered like the
 * sspai-pub precedent (0294):
 *
 * 1. declared surface/manifest — the selector-table shape, the timeout constants and the
 *    plugin.json kind/entry/check/browserSession fields (profileName `xiaoyuzhou`);
 * 2. refusals — every typed pre-browser refusal observed with ZERO browser launches:
 *    draft-only publishStatus, format/title/body/audio/podcastId/duration/cover/unsupported
 *    fields, driver and operation;
 * 3. sanitizer — `sanitizeXiaoyuzhouHtml(markdownToHtml(body))` strips script/style/iframe/
 *    embed/object, `on*` attributes and quoted `javascript:`/`data:` URLs while preserving
 *    heading/code/list markup, asserted directly and through the HTML the fake page captured at
 *    paste time;
 * 4. payload mapping — FakeBrowserTransport verifies only the Content→Result mapping and the
 *    `--in/--out` CLI routing (real DOM behavior is the dom fixture's job, never duplicated here);
 * 5. session preflight — the headless read-only pass, the login redirect, the missing profile,
 *    the mid-flow expiry, and the unsupported-browser environment failure BEFORE any upload;
 * 6. flow — an offline fake page executing the real `evaluate` scripts (show-verify → audio
 *    attach → title/shownotes readback → cover → exact-visible 保存草稿|保存 → fresh persisted
 *    receipt); stale receipts, toasts and drifted persisted state never confirm;
 * 7. source hygiene — no eval/new Function/node:fs, one sanitized paste site, audio only through
 *    `setInputFiles` (no DataTransfer/base64), every `resolveSelector` call site wrapped in a
 *    typed `stageFail`, and the title filled natively (never a bare `.value` write);
 * 8. environment restoration.
 *
 * Every test is offline: fake pages only. No test ever calls xiaoyuzhoufm.com.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type Content, ResultSchema } from '@gobing-ai/kk-core';
import { FakeBrowserTransport } from '@gobing-ai/publish-harness';
import { markdownToHtml } from '@gobing-ai/publish-harness/browser';
import {
    type BrowserLauncher,
    BrowserProfileMissingError,
    type ProfileLaunchRequest,
} from '@gobing-ai/ts-browser-automation';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import type { BrowserContext, Page } from 'playwright';
import { sanitizeXiaoyuzhouHtml, stageFail, XiaoyuzhouBrowserTransport, XYZF_LOGIN_INSTRUCTION } from '../src/flow';
import { getPublishTransport, main, processPublishIO, resolveOperation, XYZF_OPERATIONS } from '../src/index';
import {
    isXiaoyuzhouAuthenticated,
    XYZF_AUDIO_SELECTORS,
    XYZF_CONFIG,
    XYZF_HOME_URL,
    XYZF_LOGIN_TIMEOUT_MS,
    XYZF_LOGIN_URL_RE,
    XYZF_RECEIPT_URL_RES,
    XYZF_TARGET,
    XYZF_UNSUPPORTED_URL_RE,
    XYZF_UPLOAD_TIMEOUT_MS,
} from '../src/selectors';

const TMP_DIR = join(process.cwd(), '.tmp-test-xiaoyuzhou-pub-main');
const DEFAULT_DIR = join(homedir(), '.config', 'kk', 'browser-profiles', 'xiaoyuzhou');
const PODCAST_ID = 'xyzpod2026';
const AUDIO_PATH = join(TMP_DIR, 'episode.mp3');
const COVER_PATH = join(TMP_DIR, 'cover.png');
/** Fresh episode receipt: the episode-id URL shape the receipt regexes pin (the fresh URL gain). */
const RECEIPT_URL = 'https://podcaster.xiaoyuzhoufm.com/episode/ep20261015001';
const RECEIPT_URL_2 = 'https://podcaster.xiaoyuzhoufm.com/episode/ep20261015002';
const RECEIPT_URL_3 = 'https://podcaster.xiaoyuzhoufm.com/episode/ep20261015003';
/** Receipt-shaped but id-less for the flow's `/episode/` id extractor — an ambiguous fresh signal. */
const PODCAST_RECEIPT_URL = 'https://podcaster.xiaoyuzhoufm.com/podcast/xyzpod2026';
const SIGNIN_URL = 'https://passport.xiaoyuzhoufm.com/signin?return_to=%2F';
const UNSUPPORTED_URL = 'https://podcaster.xiaoyuzhoufm.com/unsupported-browser';
const AUDIO_INPUT = XYZF_AUDIO_SELECTORS.audioInput[0];
const TITLE_INPUT = XYZF_AUDIO_SELECTORS.titleInput[0];
const SHOWNOTES_EDITOR = XYZF_AUDIO_SELECTORS.shownotesEditor[0];
const COVER_INPUT = XYZF_AUDIO_SELECTORS.coverInput[0];
const SAVE_BUTTON = XYZF_AUDIO_SELECTORS.saveButton[0];

const draftContent = (): Content => ({
    title: 'Episode 1',
    body: 'Shownotes text',
    format: 'audio',
    metadata: { audioPath: AUDIO_PATH, podcastId: PODCAST_ID },
});

/**
 * A body whose Markdown output carries every dangerous shape the sanitizer must strip (Bun's
 * markdown passes raw HTML through) plus the markup that must survive (heading/list/code/img).
 */
const dirtyBody = [
    '# Heading',
    '',
    '<script>alert(1)</script>',
    '',
    '- item one',
    '',
    '```js',
    'const x = 1;',
    '```',
    '',
    '<img onerror="alert(3)" src="https://example.com/a.png">',
    '',
    '<iframe src="https://evil.example"></iframe>',
].join('\n');

/** The channel's selector table, dereferenced by role — the compile-time shape under test. */
const SELECTORS: Record<keyof typeof XYZF_AUDIO_SELECTORS, readonly string[]> = XYZF_AUDIO_SELECTORS;

/** Every fake-page dial a xiaoyuzhou podcast flow can observe. */
interface FakePageOptions {
    /** URL the readiness predicate sees after `goto` — a signin URL means the session expired. */
    landedUrl?: string;
    /** The grounded controls never attach (a logged-out page body, 登录 text alone). */
    groundedMissing?: boolean;
    /** The audio `input#upload` never attaches while the rest of the composer renders. */
    missingAudioInput?: boolean;
    /** The `setInputFiles` assignment itself rejects (an upload bridge failure). */
    uploadFileThrows?: boolean;
    /** The page text never carries the requested podcastId (show identity unconfirmed). */
    showIdMissing?: boolean;
    /** The title fill itself throws (a page crash mid-flow). */
    fillThrows?: boolean;
    /** The title input drops the filled value, so the strict readback must fail. */
    titleReadbackDrops?: boolean;
    /** The Draft.js shownotes editor never attaches (partially-rendered composer). */
    missingShownotesEditor?: boolean;
    /** The editor drops the pasted HTML, so the paste/readback must fail. */
    bodyReadbackDrops?: boolean;
    /** The cover file input never attaches (a requested cover with no input). */
    missingCoverInput?: boolean;
    /** The cover assignment lands but the readback never verifies it. */
    coverReadbackDrops?: boolean;
    /** The draft-save control never attaches (the source never saves). */
    saveMissing?: boolean;
    /** The draft-save control attaches but stays hidden. */
    saveInvisible?: boolean;
    /** The save control never becomes clickable. */
    submitNeverEnabled?: boolean;
    /** What clicking the save control emits: a fresh episode receipt, nothing, or ambiguous shapes. */
    onDraftSave?: 'episodeReceipt' | 'none' | 'podcastReceipt' | 'twoEpisodeReceipts';
    /** A receipt-shaped URL already on screen before the save (a stale/ambiguous signal). */
    existingReceiptUrl?: string;
    /** Toasts already on screen (the flow never reads them — they alone never confirm). */
    existingToasts?: string[];
    /** The fresh receipt appears but the persisted title/body state no longer matches. */
    persistedStateDrifts?: boolean;
    /** After the readiness predicate passes, the page turns into the unsupported-browser page. */
    unsupportedAfterReadiness?: boolean;
}

interface LauncherHandle {
    launcher: BrowserLauncher;
    requests: ProfileLaunchRequest[];
    calls: string[];
    closeCount: () => number;
}

const plainText = (html: string): string => html.replace(/<[^>]*>/g, ' ');
const squish = (value: string): string => value.replace(/\s+/g, '');
const receiptShaped = (candidate: string): boolean => XYZF_RECEIPT_URL_RES.some((re) => re.test(candidate));

/**
 * Fake `Page` over the primitives the flow may use (`goto`, `url`, `locator`, `evaluate`,
 * `setInputFiles`). The evaluate branch keyed on the real scripts' `kk-xyzf-*` markers executes
 * their contracts against scripted page state, so dropped readbacks, an unverified cover, a stale
 * receipt and a drifted persisted state are all reachable offline. The readiness-pair counter
 * mirrors `isXiaoyuzhouAuthenticated`'s probe shape (audio then title) so the unsupported-browser
 * page can appear only AFTER a verified readiness pass — the live race the
 * `browser-precondition` stage exists for.
 */
function makeFakePage(options: FakePageOptions, calls: string[]): Page {
    let url = 'about:blank';
    let titleValue = '';
    let editorHtml = '';
    let assignedAudioPath: string | null = null;
    let assignedCoverPath: string | null = null;
    const baselineAnchors: string[] = options.existingReceiptUrl === undefined ? [] : [options.existingReceiptUrl];
    const freshAnchors: string[] = [];
    let lastProbed = '';
    let readinessPairs = 0;

    const pageUrl = (): string =>
        options.unsupportedAfterReadiness === true && readinessPairs >= 1 ? UNSUPPORTED_URL : url;
    const attached = (selector: string): number =>
        options.groundedMissing === true ||
        // The removal is armed only after readiness confirmed (the preflight probe counts the same
        // control), so a late-detached input is still a flow-time upload failure, not a logged-out page.
        (options.missingAudioInput === true && readinessPairs >= 1 && SELECTORS.audioInput.includes(selector)) ||
        (options.missingShownotesEditor === true && SELECTORS.shownotesEditor.includes(selector)) ||
        (options.missingCoverInput === true && SELECTORS.coverInput.includes(selector)) ||
        (options.saveMissing === true && SELECTORS.saveButton.includes(selector))
            ? 0
            : 1;
    const visible = (selector: string): boolean =>
        attached(selector) > 0 && !(options.saveInvisible === true && SELECTORS.saveButton.includes(selector));
    const leaf = (selector: string) => ({
        count: async () => {
            const n = attached(selector);
            if (n > 0) {
                // The readiness predicate is the only prober that reads audio then title in pair.
                if (SELECTORS.audioInput.includes(selector)) lastProbed = 'audio';
                else if (SELECTORS.titleInput.includes(selector) && lastProbed === 'audio') {
                    lastProbed = '';
                    readinessPairs += 1;
                } else lastProbed = '';
            }
            return n;
        },
        isVisible: async () => visible(selector),
        isEnabled: async () => options.submitNeverEnabled !== true,
        fill: async (text: string) => {
            calls.push(`fill:${selector}|${text}`);
            if (options.fillThrows === true) throw new Error('xiaoyuzhou editor page crashed on fill');
            if (SELECTORS.titleInput.includes(selector)) titleValue = text;
        },
        click: async () => {
            calls.push(`click:${selector}`);
            if (SELECTORS.saveButton.includes(selector)) {
                if (options.onDraftSave === 'episodeReceipt') url = RECEIPT_URL;
                if (options.onDraftSave === 'podcastReceipt') url = PODCAST_RECEIPT_URL;
                if (options.onDraftSave === 'twoEpisodeReceipts') {
                    url = RECEIPT_URL_2;
                    freshAnchors.push(RECEIPT_URL_3);
                }
            }
        },
    });

    const jsonArg = (expression: string, anchor: RegExp): string | null => {
        const match = anchor.exec(expression);
        return match?.[1] === undefined ? null : (JSON.parse(match[1]) as string);
    };
    const selectorArg = (expression: string): string =>
        jsonArg(expression, /document\.querySelector\(("(?:[^"\\]|\\.)*")\)/) ?? '';

    return {
        async goto(target: string) {
            calls.push(`goto:${target}`);
            url = options.landedUrl ?? target;
        },
        url: () => pageUrl(),
        locator(selector: string) {
            return { first: () => leaf(selector), count: async () => attached(selector) };
        },
        async setInputFiles(selector: string, files: string | readonly string[]) {
            const path = Array.isArray(files) ? files[0] : files;
            calls.push(`setInputFiles:${selector}|${path}`);
            if (options.uploadFileThrows === true) throw new Error('upload bridge rejected the file');
            if (SELECTORS.audioInput.includes(selector)) assignedAudioPath = path;
            else assignedCoverPath = path;
        },
        async evaluate(expression: string) {
            calls.push(`evaluate:${expression.slice(0, 44)}`);
            if (expression.includes('kk-xyzf-input-value')) {
                return SELECTORS.titleInput.includes(selectorArg(expression))
                    ? options.titleReadbackDrops === true
                        ? ''
                        : titleValue
                    : '';
            }
            if (expression.includes('kk-xyzf-audio-ready')) {
                return JSON.stringify({ ready: assignedAudioPath !== null, by: 'audio-player' });
            }
            if (expression.includes('kk-xyzf-editor-readback')) {
                const html = jsonArg(expression, /probe\.innerHTML = ("(?:[^"\\]|\\.)*");/) ?? '';
                const editorText = options.bodyReadbackDrops === true ? '' : plainText(editorHtml);
                return JSON.stringify({
                    ok: editorText.length > 0 && squish(editorText) === squish(plainText(html)),
                });
            }
            if (expression.includes('kk-xyzf-cover-assigned')) {
                const assigned = assignedCoverPath !== null && options.coverReadbackDrops !== true;
                return JSON.stringify({ assigned, preview: assigned });
            }
            if (expression.includes('kk-xyzf-persisted')) {
                const wantedTitle =
                    jsonArg(expression, /squish\(title\.value\) === squish\(("(?:[^"\\]|\\.)*")\)/) ?? '';
                const wantedHtml = jsonArg(expression, /probe\.innerHTML = ("(?:[^"\\]|\\.)*");/) ?? '';
                const healthy = options.persistedStateDrifts !== true;
                const editorText = options.bodyReadbackDrops === true ? '' : plainText(editorHtml);
                return JSON.stringify({
                    titleOk: healthy && squish(titleValue) === squish(wantedTitle),
                    editorOk: healthy && editorText.length > 0 && squish(editorText) === squish(plainText(wantedHtml)),
                    audioOk: healthy && assignedAudioPath !== null,
                    coverOk: !expression.includes('files[0].name') || (healthy && assignedCoverPath !== null),
                });
            }
            if (expression.includes('kk-xyzf-receipt-urls')) {
                const current = pageUrl();
                const urls: string[] = [];
                if (receiptShaped(current)) urls.push(current);
                for (const anchor of [...baselineAnchors, ...freshAnchors]) {
                    if (receiptShaped(anchor) && !urls.includes(anchor)) urls.push(anchor);
                }
                return JSON.stringify(urls);
            }
            if (expression.includes('kk-xyzf-editor-events')) return undefined;
            if (expression.includes("ClipboardEvent('paste'")) {
                const html = jsonArg(expression, /data\.setData\('text\/html', ("(?:[^"\\]|\\.)*")\)/) ?? '';
                calls.push(`pasteHtml:${selectorArg(expression)}|${html}`);
                editorHtml = html;
                return true;
            }
            if (expression.includes("el.textContent ?? ''")) {
                return (options.bodyReadbackDrops === true ? '' : plainText(editorHtml)).trim();
            }
            if (expression.includes('document.body?.innerText')) {
                return options.showIdMissing === true ? '登录 注册 发现' : `我的节目 ${PODCAST_ID} 单集管理`;
            }
            return '';
        },
    } as unknown as Page;
}

/** Launcher fake returning recording contexts; every preflight/flow launch is logged. */
function makeFakeLauncher(options: FakePageOptions = {}): LauncherHandle {
    const requests: ProfileLaunchRequest[] = [];
    const calls: string[] = [];
    let closes = 0;
    const launcher: BrowserLauncher = {
        async launch(request) {
            requests.push(request);
            const page = makeFakePage(options, calls);
            const context = {
                pages: () => [page],
                newPage: async () => page,
                close: async () => {
                    closes += 1;
                },
            };
            return context as unknown as BrowserContext;
        },
    };
    return { launcher, requests, calls, closeCount: () => closes };
}

function transport(fake: LauncherHandle, stepTimeoutMs = 250): XiaoyuzhouBrowserTransport {
    return new XiaoyuzhouBrowserTransport('podcast', 'script', { launcher: fake.launcher, stepTimeoutMs });
}

const originalChannelDir = process.env.XIAOYUZHOU_PROFILE_DIR;
const originalSharedDir = process.env.KK_BROWSER_PROFILE_DIR;
const originalFake = process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;

beforeEach(async () => {
    delete process.env.XIAOYUZHOU_PROFILE_DIR;
    delete process.env.KK_BROWSER_PROFILE_DIR;
    delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
    await mkdir(TMP_DIR, { recursive: true });
    await writeFile(AUDIO_PATH, 'id3-fake-audio-bytes');
    await writeFile(COVER_PATH, 'png-bytes');
});

afterEach(async () => {
    if (originalChannelDir === undefined) delete process.env.XIAOYUZHOU_PROFILE_DIR;
    else process.env.XIAOYUZHOU_PROFILE_DIR = originalChannelDir;
    if (originalSharedDir === undefined) delete process.env.KK_BROWSER_PROFILE_DIR;
    else process.env.KK_BROWSER_PROFILE_DIR = originalSharedDir;
    if (originalFake === undefined) delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
    else process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = originalFake;
    await rm(TMP_DIR, { recursive: true, force: true });
});

/** Reads the comment block immediately above a declaration and asserts the Provisional label. */
function expectProvisionalLabel(src: string, declaration: string): void {
    const before = src.slice(0, src.indexOf(declaration));
    const close = before.lastIndexOf('*/');
    const open = before.lastIndexOf('/**', close);
    expect(before.slice(open, close + 2)).toContain('Provisional');
}

describe('xiaoyuzhou-pub declared surface and manifest', () => {
    test('the audio selector table covers exactly the five flow roles, grounded candidates pinned', () => {
        expect(Object.keys(SELECTORS).sort()).toEqual(
            ['audioInput', 'coverInput', 'saveButton', 'shownotesEditor', 'titleInput'].sort(),
        );
        // The grounded trio is pinned by the recovered adapter, one exact selector each.
        expect(SELECTORS.audioInput).toEqual(['input#upload']);
        expect(SELECTORS.titleInput).toEqual(['input[name="title"]']);
        expect(SELECTORS.shownotesEditor).toEqual(['div[data-contents="true"]']);
        // The cover input is scoped to the Draft.js form and must never match the audio input.
        expect(SELECTORS.coverInput).toEqual(['form:has(div[data-contents="true"]) input[type="file"]:not(#upload)']);
        // The draft-save leg is exact-text only, most specific wording first, no broad fallback.
        expect([...SELECTORS.saveButton]).toEqual(['button:text-is("保存草稿")', 'button:text-is("保存")']);
    });

    test('home/unsupported/login markers, receipt shapes and timeout constants partition the states', () => {
        expect(XYZF_TARGET).toBe('xiaoyuzhou');
        expect(XYZF_HOME_URL).toBe('https://podcaster.xiaoyuzhoufm.com/');
        expect(XYZF_LOGIN_URL_RE.test(SIGNIN_URL)).toBe(true);
        expect(XYZF_LOGIN_URL_RE.test('https://podcaster.xiaoyuzhoufm.com/login')).toBe(true);
        expect(XYZF_LOGIN_URL_RE.test(XYZF_HOME_URL)).toBe(false);
        expect(XYZF_UNSUPPORTED_URL_RE.test(UNSUPPORTED_URL)).toBe(true);
        expect(XYZF_UNSUPPORTED_URL_RE.test(XYZF_HOME_URL)).toBe(false);
        expect(XYZF_RECEIPT_URL_RES.some((re) => re.test(RECEIPT_URL))).toBe(true);
        expect(XYZF_RECEIPT_URL_RES.some((re) => re.test(PODCAST_RECEIPT_URL))).toBe(true);
        expect(XYZF_RECEIPT_URL_RES.some((re) => re.test(XYZF_HOME_URL))).toBe(false);
        expect(XYZF_UPLOAD_TIMEOUT_MS).toBe(600_000);
        expect(XYZF_LOGIN_TIMEOUT_MS).toBe(180_000);
    });

    test('the site config wires the readiness predicate and the shared login deadline', () => {
        expect(XYZF_CONFIG).toMatchObject({
            channel: 'xiaoyuzhou',
            homeUrl: XYZF_HOME_URL,
            loginTimeoutMs: XYZF_LOGIN_TIMEOUT_MS,
            checkHeadedOnly: false,
        });
        expect(XYZF_CONFIG.isAuthenticated).toBe(isXiaoyuzhouAuthenticated);
    });

    test('only the podcast operation is declared, with metadata fallback and options precedence', () => {
        expect([...XYZF_OPERATIONS]).toEqual(['podcast']);
        expect(resolveOperation(undefined, undefined)).toEqual({ operation: 'podcast' });
        expect(resolveOperation(undefined, { ...draftContent(), metadata: { operation: 'podcast' } })).toEqual({
            operation: 'podcast',
        });
        const unknown = resolveOperation({ operation: 'episode' }, draftContent());
        expect(unknown.error).toContain(`unsupported operation 'episode' for xiaoyuzhou: expected one of podcast`);
        const fallback = resolveOperation(undefined, { ...draftContent(), metadata: { operation: 'note' } });
        expect(fallback.error).toContain('note');
        const precedence = resolveOperation(
            { operation: 'podcast' },
            { ...draftContent(), metadata: { operation: 'note' } },
        );
        expect(precedence).toEqual({ operation: 'podcast' });
    });

    test('plugin.json declares the publish kind, entry, check and the xiaoyuzhou browser session', async () => {
        const manifest = JSON.parse(await readFile(join(import.meta.dir, '..', 'plugin.json'), 'utf-8')) as Record<
            string,
            unknown
        >;
        expect(manifest.name).toBe('xiaoyuzhou-pub');
        expect(manifest.kind).toBe('publish');
        expect(manifest.entry).toBe('./src/index.ts');
        expect(manifest.check).toBe('./src/profile-check.ts');
        expect(manifest.browserSession).toMatchObject({
            profileName: 'xiaoyuzhou',
            homeUrl: 'https://podcaster.xiaoyuzhoufm.com/',
        });
        // The packed entry/check targets resolve on disk (the packaging seam for this plugin).
        await readFile(join(import.meta.dir, '..', 'src', 'index.ts'));
        await readFile(join(import.meta.dir, '..', 'src', 'profile-check.ts'));
    });

    test('KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake selects the offline fake; the default is the real transport', () => {
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        const fake = getPublishTransport('podcast');
        expect(fake).toBeInstanceOf(FakeBrowserTransport);
        expect(fake.driver).toBe('script');
        delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        expect(getPublishTransport('podcast')).toBeInstanceOf(XiaoyuzhouBrowserTransport);
    });

    test('the readiness predicate passes only on the grounded controls — a 登录 body alone is no session', async () => {
        const ready = makeFakePage({}, []);
        await ready.goto(XYZF_HOME_URL);
        expect(await isXiaoyuzhouAuthenticated(ready)).toBe(true);
        // A page showing only the logged-out body (no `input#upload`) refuses even on the home
        // URL — xiaoyuzhou.js:28 reads the missing audio input as maybe-unlogged.
        const loggedOut = makeFakePage({ groundedMissing: true }, []);
        await loggedOut.goto(XYZF_HOME_URL);
        expect(await isXiaoyuzhouAuthenticated(loggedOut)).toBe(false);
        // A login/passport redirect refuses even when the composer is otherwise rendered.
        const signin = makeFakePage({ landedUrl: SIGNIN_URL }, []);
        await signin.goto(XYZF_HOME_URL);
        expect(await isXiaoyuzhouAuthenticated(signin)).toBe(false);
        // The unsupported-browser environment page is also not a ready session.
        const unsupported = makeFakePage({ landedUrl: UNSUPPORTED_URL }, []);
        await unsupported.goto(XYZF_HOME_URL);
        expect(await isXiaoyuzhouAuthenticated(unsupported)).toBe(false);
    });

    test('the operator profile CLI entry wires the site config and never self-runs on import', async () => {
        // Source-text assertions only: importing the module would load it into coverage where the
        // CLI-only `import.meta.main` branch counts as an uncovered function (sspai-pub precedent).
        const src = await readFile(join(import.meta.dir, '..', 'src', 'profile-check.ts'), 'utf-8');
        expect(src).toContain('runProfileCli(XYZF_CONFIG');
        expect(src).toContain('import.meta.main');
    });
});

describe('xiaoyuzhou-pub refusals before any browser', () => {
    test('publishStatus public is REFUSED (draft-only slice) with zero launches', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({
            content: { ...draftContent(), metadata: { ...draftContent().metadata, publishStatus: 'public' } },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('saves drafts only');
        expect(result.error).toContain(`metadata.publishStatus 'public' is refused before any browser opens`);
        expect(result.error).toContain(`omit publishStatus or pass 'draft'`);
        expect(fake.requests).toHaveLength(0);
    });

    test('an unknown publishStatus refuses with the expected set and zero launches', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({
            content: { ...draftContent(), metadata: { ...draftContent().metadata, publishStatus: 'scheduled' } },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain(`unknown publishStatus 'scheduled' for xiaoyuzhou`);
        expect(result.error).toContain(`expected 'draft' or absent`);
        expect(fake.requests).toHaveLength(0);
    });

    test('a non-script driver is refused by name with the supported set, before any launch', async () => {
        const fake = makeFakeLauncher();
        const agent = new XiaoyuzhouBrowserTransport('podcast', 'agent', { launcher: fake.launcher });
        const result = await agent.publish({ content: draftContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain(`unsupported driver 'agent'`);
        expect(result.error).toContain('expected one of script');
        expect(fake.requests).toHaveLength(0);
    });

    test('a non-audio format refuses with the required format named, before any launch', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({ content: { ...draftContent(), format: 'markdown' } });
        expect(result.ok).toBe(false);
        expect(result.error).toContain(`xiaoyuzhou podcast requires Content.format 'audio', got 'markdown'`);
        expect(fake.requests).toHaveLength(0);
    });

    test('an empty title and an empty body are refused by name, before any browser opens', async () => {
        const fake = makeFakeLauncher();
        const noTitle = await transport(fake).publish({ content: { ...draftContent(), title: '   ' } });
        expect(noTitle.ok).toBe(false);
        expect(noTitle.error).toContain('xiaoyuzhou podcast requires a non-empty Content.title');

        const noBody = await transport(fake).publish({ content: { ...draftContent(), body: '   ' } });
        expect(noBody.ok).toBe(false);
        expect(noBody.error).toContain('xiaoyuzhou podcast requires non-empty Content.body Markdown');
        expect(fake.requests).toHaveLength(0);
    });

    test('a missing/blank podcastId refuses: the flow never uploads to a first/default show', async () => {
        const fake = makeFakeLauncher();
        const missing = await transport(fake).publish({
            content: { ...draftContent(), metadata: { audioPath: AUDIO_PATH } },
        });
        expect(missing.ok).toBe(false);
        expect(missing.error).toContain('metadata.podcastId is required for xiaoyuzhou podcast publish');
        expect(missing.error).toContain('never uploads to a first/default show');

        const blank = await transport(fake).publish({
            content: { ...draftContent(), metadata: { audioPath: AUDIO_PATH, podcastId: '   ' } },
        });
        expect(blank.ok).toBe(false);
        expect(blank.error).toContain('metadata.podcastId is required');
        expect(fake.requests).toHaveLength(0);
    });

    test('a missing audioPath (and the mp3Path fallback) refuses as a non-empty local audio file', async () => {
        const fake = makeFakeLauncher();
        const missing = await transport(fake).publish({
            content: { ...draftContent(), metadata: { podcastId: PODCAST_ID } },
        });
        expect(missing.ok).toBe(false);
        expect(missing.error).toContain(
            'metadata.audioPath (or metadata.mp3Path) must be a non-empty local audio file path',
        );

        const badFallback = await transport(fake).publish({
            content: { ...draftContent(), metadata: { mp3Path: join(TMP_DIR, 'gone.mp3'), podcastId: PODCAST_ID } },
        });
        expect(badFallback.ok).toBe(false);
        expect(badFallback.error).toContain('does not resolve to a readable nonempty local audio file');
        expect(fake.requests).toHaveLength(0);
    });

    test('an audio file that is not MP3/M4A/WAV refuses by extension, before any launch', async () => {
        const fake = makeFakeLauncher();
        const ogg = join(TMP_DIR, 'episode.ogg');
        await writeFile(ogg, 'ogg-bytes');
        const result = await transport(fake).publish({
            content: { ...draftContent(), metadata: { audioPath: ogg, podcastId: PODCAST_ID } },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('metadata.audioPath (or metadata.mp3Path) must be a local MP3/M4A/WAV file');
        expect(result.error).toContain('unsupported extension');
        expect(fake.requests).toHaveLength(0);
    });

    test('a nonexistent or empty audio file refuses instead of reaching the browser', async () => {
        const fake = makeFakeLauncher();
        const nonexistent = await transport(fake).publish({
            content: {
                ...draftContent(),
                metadata: { audioPath: join(TMP_DIR, 'missing.mp3'), podcastId: PODCAST_ID },
            },
        });
        expect(nonexistent.ok).toBe(false);
        expect(nonexistent.error).toContain('does not resolve to a readable nonempty local audio file');

        const emptyPath = join(TMP_DIR, 'empty.mp3');
        await writeFile(emptyPath, '');
        const empty = await transport(fake).publish({
            content: { ...draftContent(), metadata: { audioPath: emptyPath, podcastId: PODCAST_ID } },
        });
        expect(empty.ok).toBe(false);
        expect(empty.error).toContain('does not resolve to a readable nonempty local audio file');
        expect(fake.requests).toHaveLength(0);
    });

    test('an oversized audio file exceeds the KK v1 500 MiB cap as a typed pre-browser refusal', async () => {
        // Sparse file: logical 501 MiB for the size probe, ~0 real disk usage, removed by afterEach.
        const bigPath = join(TMP_DIR, 'big.mp3');
        await writeFile(bigPath, 'id3');
        await truncate(bigPath, 501 * 1024 * 1024);
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({
            content: { ...draftContent(), metadata: { audioPath: bigPath, podcastId: PODCAST_ID } },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('exceeds the KK v1 local audio cap of 500 MiB');
        expect(fake.requests).toHaveLength(0);
    });

    test('a requested cover that is not a readable nonempty PNG/JPEG/WebP refuses, never a silent skip', async () => {
        const fake = makeFakeLauncher();
        const badExtension = await transport(fake).publish({
            content: { ...draftContent(), metadata: { ...draftContent().metadata, coverPath: join(TMP_DIR, 'c.gif') } },
        });
        expect(badExtension.ok).toBe(false);
        expect(badExtension.error).toContain('metadata.coverPath must be a local PNG/JPEG/WebP file');
        expect(badExtension.error).toContain('unsupported extension');

        const nonexistent = await transport(fake).publish({
            content: {
                ...draftContent(),
                metadata: { ...draftContent().metadata, coverPath: join(TMP_DIR, 'missing.png') },
            },
        });
        expect(nonexistent.ok).toBe(false);
        expect(nonexistent.error).toContain('metadata.coverPath does not resolve to a readable nonempty local file');
        expect(nonexistent.error).toContain('refusing, never a silent skip');

        const emptyPath = join(TMP_DIR, 'empty.png');
        await writeFile(emptyPath, '');
        const empty = await transport(fake).publish({
            content: { ...draftContent(), metadata: { ...draftContent().metadata, coverPath: emptyPath } },
        });
        expect(empty.ok).toBe(false);
        expect(empty.error).toContain('does not resolve to a readable nonempty local file');

        const notString = await transport(fake).publish({
            content: { ...draftContent(), metadata: { ...draftContent().metadata, coverPath: 42 } },
        });
        expect(notString.ok).toBe(false);
        expect(notString.error).toContain('metadata.coverPath must be a non-empty local file path when present');
        expect(fake.requests).toHaveLength(0);
    });

    test('a non-positive, non-finite or non-numeric metadata.duration refuses as provenance-only', async () => {
        const fake = makeFakeLauncher();
        for (const duration of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, '90']) {
            const result = await transport(fake).publish({
                content: { ...draftContent(), metadata: { ...draftContent().metadata, duration } },
            });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('metadata.duration must be a positive finite number');
        }
        expect(fake.requests).toHaveLength(0);
    });

    test('unsupported images/tags/categories refuse by container+key even when wrongly typed', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({
            content: {
                ...draftContent(),
                metadata: { ...draftContent().metadata, images: ['https://example.com/a.png'], categories: 7 },
            },
            options: { images: 'not-an-array', tags: 'rock' },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain(
            'unsupported field(s) options.images, options.tags, metadata.images, metadata.categories for xiaoyuzhou',
        );
        expect(result.error).toContain('title/shownotes/audio/podcastId/cover only');
        expect(result.error).toContain('implements none of images/tags/categories');
        expect(fake.requests).toHaveLength(0);
    });
});

describe('xiaoyuzhou-pub sanitizer (markdownToHtml then plugin-local strip)', () => {
    test('script/style/iframe/embed/object containers, on* attrs and quoted javascript:/data: URLs are stripped', () => {
        const sanitized = sanitizeXiaoyuzhouHtml(
            [
                '<p onclick="evil()">keep</p>',
                '<script>alert(1)</script>',
                '<style>.x{}</style>',
                '<iframe src="https://evil.example"></iframe>',
                '<embed src="x.swf">',
                '<object data="x.swf"></object>',
                '<a href="javascript:alert(4)">x</a>',
                "<a href='data:text/html,<b>y</b>'>y</a>",
            ].join('\n'),
        );
        expect(sanitized).not.toMatch(/<script|<style|<iframe|<embed|<object/i);
        expect(sanitized).not.toMatch(/\son[a-z]+\s*=|javascript:|data:text\/html/i);
        expect(sanitized).toContain('keep');
    });

    test('heading/code/list markup survives sanitization', () => {
        const sanitized = sanitizeXiaoyuzhouHtml(markdownToHtml('# T\n\n- a\n\n```js\nconst x = 1;\n```'));
        expect(sanitized).toContain('<h1>T</h1>');
        expect(sanitized).toContain('<ul>');
        expect(sanitized).toContain('<li>a</li>');
        expect(sanitized).toContain('<pre><code');
    });

    test('the paste HTML captured by the fake page is exactly the sanitized chain output', async () => {
        const fake = makeFakeLauncher({ onDraftSave: 'episodeReceipt' });
        const result = await transport(fake).publish({ content: { ...draftContent(), body: dirtyBody } });
        expect(result.ok).toBe(true);
        const pasteCalls = fake.calls.filter((call) => call.startsWith(`pasteHtml:${SHOWNOTES_EDITOR}|`));
        expect(pasteCalls).toHaveLength(1);
        const pasted = pasteCalls[0].split('|').slice(1).join('|');
        expect(pasted).toBe(sanitizeXiaoyuzhouHtml(markdownToHtml(dirtyBody)));
        expect(pasted).toContain('<h1>Heading</h1>');
        expect(pasted).toContain('<ul>');
        expect(pasted).toContain('<pre><code');
        expect(pasted).toContain('<img src="https://example.com/a.png">');
        expect(pasted).not.toMatch(/<script|<iframe|onerror/i);
    });
});

describe('xiaoyuzhou-pub payload mapping and --in/--out IO (FakeBrowserTransport)', () => {
    test('processPublishIO publishes offline on the fake transport and writes a schema-valid Result', async () => {
        const inPath = join(TMP_DIR, 'in.json');
        const outPath = join(TMP_DIR, 'nested', 'out.json');
        await writeFile(inPath, JSON.stringify(draftContent()));
        await processPublishIO(inPath, outPath, new FakeBrowserTransport('script'));
        const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
        expect(written.ok).toBe(true);
        expect(written.id).toBe('fake-browser-id-123');
        expect(written.url).toBe('https://example.com/browser-draft');
    });

    test('malformed input reports a single-line failure and never a stack', async () => {
        const inPath = join(TMP_DIR, 'bad-in.json');
        const outPath = join(TMP_DIR, 'bad-out.json');
        await writeFile(inPath, JSON.stringify({ title: 42 }));
        await expect(processPublishIO(inPath, outPath, new FakeBrowserTransport('script'))).rejects.toThrow(
            /Invalid Content input/,
        );
        const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
        expect(written.ok).toBe(false);
        expect(written.error?.split('\n')).toHaveLength(1);
        expect(written.error?.length).toBeLessThanOrEqual(300);
    });

    test('fake mode does not bypass the refusals: public status and unknown operation refuse offline', async () => {
        // No transport injection: the real transport's pre-browser ladder refuses offline even so.
        const inPath = join(TMP_DIR, 'status-in.json');
        const outPath = join(TMP_DIR, 'status-out.json');
        await writeFile(
            inPath,
            JSON.stringify({ ...draftContent(), metadata: { ...draftContent().metadata, publishStatus: 'public' } }),
        );
        await expect(processPublishIO(inPath, outPath)).rejects.toThrow(/saves drafts only/);
        const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
        expect(written.ok).toBe(false);
        expect(written.target).toBe('xiaoyuzhou');
        expect(written.error?.split('\n')).toHaveLength(1);

        const opIn = join(TMP_DIR, 'op-in.json');
        const opOut = join(TMP_DIR, 'op-out.json');
        await writeFile(opIn, JSON.stringify({ ...draftContent(), options: { operation: 'episode' } }));
        await expect(processPublishIO(opIn, opOut, new FakeBrowserTransport('script'))).rejects.toThrow(
            /unsupported operation 'episode' for xiaoyuzhou: expected one of podcast/,
        );
        expect(ResultSchema.parse(JSON.parse(await readFile(opOut, 'utf-8'))).ok).toBe(false);
    });

    test('processPublishIO refuses an agent driver option before any transport exists', async () => {
        const driverIn = join(TMP_DIR, 'driver-in.json');
        const driverOut = join(TMP_DIR, 'driver-out.json');
        await writeFile(driverIn, JSON.stringify({ ...draftContent(), options: { driver: 'agent' } }));
        await expect(processPublishIO(driverIn, driverOut, new FakeBrowserTransport('script'))).rejects.toThrow(
            /unsupported driver 'agent'/,
        );
        expect(ResultSchema.parse(JSON.parse(await readFile(driverOut, 'utf-8'))).ok).toBe(false);
    });

    test('main returns 1 without args, 1 on invalid args, and 0 on the fake transport', async () => {
        const origArgv = process.argv;
        const errTarget = createBufferTarget();
        const restore = setDefaultOutputTargets({ stderr: errTarget });
        process.argv = ['bun', 'index.ts'];
        try {
            expect(await main()).toBe(1);
            expect(errTarget.text()).toContain('Missing required arguments');

            process.argv = ['bun', 'index.ts', '--bogus'];
            expect(await main()).toBe(1);
            expect(errTarget.text()).toContain('Invalid arguments');
        } finally {
            restore();
            process.argv = origArgv;
        }

        const inPath = join(TMP_DIR, 'main-in.json');
        const outPath = join(TMP_DIR, 'main-out.json');
        await writeFile(inPath, JSON.stringify(draftContent()));
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        process.argv = ['bun', 'index.ts', '--in', inPath, '--out', outPath];
        try {
            expect(await main()).toBe(0);
            const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
            expect(written.ok).toBe(true);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            process.argv = origArgv;
        }
    });

    test('a pre-browser refusal exits 1, still writes the ok:false Result, and opens no browser', async () => {
        const inPath = join(TMP_DIR, 'refuse-in.json');
        const outPath = join(TMP_DIR, 'refuse-out.json');
        await writeFile(
            inPath,
            JSON.stringify({ ...draftContent(), metadata: { ...draftContent().metadata, publishStatus: 'unlisted' } }),
        );
        const origArgv = process.argv;
        const errTarget = createBufferTarget();
        const restore = setDefaultOutputTargets({ stderr: errTarget });
        process.argv = ['bun', 'index.ts', '--in', inPath, '--out', outPath];
        try {
            expect(await main()).toBe(1);
            expect(errTarget.text()).toContain('xiaoyuzhou-pub failed:');
        } finally {
            restore();
            process.argv = origArgv;
        }
        const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
        expect(written.ok).toBe(false);
        expect(written.error).toContain("unknown publishStatus 'unlisted'");
    });
});

describe('xiaoyuzhou-pub session preflight and environment precondition', () => {
    test('an unauthenticated session refuses with the login command and one headless pass', async () => {
        const fake = makeFakeLauncher({ landedUrl: SIGNIN_URL });
        const result = await transport(fake).publish({ content: draftContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('xiaoyuzhou session preflight refused');
        expect(result.error).toContain(`run: ${XYZF_LOGIN_INSTRUCTION}`);
        // One read-only headless pass: no headed window ever opens on a refused preflight.
        expect(fake.requests).toEqual([{ profileDir: DEFAULT_DIR, headless: true }]);
        expect(fake.closeCount()).toBe(1);
    });

    test('a missing browser profile is refused with the login command and no second launch', async () => {
        const requests: ProfileLaunchRequest[] = [];
        const launcher: BrowserLauncher = {
            async launch(request) {
                requests.push(request);
                throw new BrowserProfileMissingError(request.profileDir);
            },
        };
        const result = await new XiaoyuzhouBrowserTransport('podcast', 'script', { launcher }).publish({
            content: draftContent(),
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('session preflight refused');
        expect(result.error).toContain(`no xiaoyuzhou browser profile at ${DEFAULT_DIR}`);
        expect(result.error).toContain(XYZF_LOGIN_INSTRUCTION);
        expect(result.error?.split('\n')).toHaveLength(1);
        expect(requests).toEqual([{ profileDir: DEFAULT_DIR, headless: true }]);
    });

    test('a session that expires between the preflight and the flow names the recovery command', async () => {
        const requests: ProfileLaunchRequest[] = [];
        let launches = 0;
        const launcher: BrowserLauncher = {
            async launch(request) {
                requests.push(request);
                launches += 1;
                // First launch (headless preflight) verifies; the headed flow shows a 登录-only body.
                const page = makeFakePage(launches === 1 ? {} : { groundedMissing: true }, []);
                const context = { pages: () => [page], newPage: async () => page, close: async () => {} };
                return context as unknown as BrowserContext;
            },
        };
        const result = await new XiaoyuzhouBrowserTransport('podcast', 'script', {
            launcher,
            stepTimeoutMs: 250,
        }).publish({ content: draftContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('xiaoyuzhou session failed');
        expect(result.error).toContain(XYZF_LOGIN_INSTRUCTION);
        expect(requests.map((request) => request.headless)).toEqual([true, false]);
    });

    test('an unsupported-browser page is a typed environment failure BEFORE any upload', async () => {
        const requests: ProfileLaunchRequest[] = [];
        let launches = 0;
        const calls: string[] = [];
        const launcher: BrowserLauncher = {
            async launch(request) {
                requests.push(request);
                launches += 1;
                // The headed flow page verifies readiness on home, then the studio serves the
                // unsupported-browser page — exactly the precondition the flow re-checks.
                const page = makeFakePage(launches === 1 ? {} : { unsupportedAfterReadiness: true }, calls);
                const context = { pages: () => [page], newPage: async () => page, close: async () => {} };
                return context as unknown as BrowserContext;
            },
        };
        const result = await new XiaoyuzhouBrowserTransport('podcast', 'script', {
            launcher,
            stepTimeoutMs: 250,
        }).publish({ content: draftContent() });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'browser-precondition' });
        expect(result.error).toContain('unsupported-browser page');
        expect(result.error).toContain('KK_BROWSER_CHANNEL=chrome');
        expect(requests.map((request) => request.headless)).toEqual([true, false]);
        // Environment refusal BEFORE any upload or content write.
        expect(calls.some((call) => call.startsWith('setInputFiles:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('fill:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('pasteHtml:'))).toBe(false);
    });
});

describe('xiaoyuzhou-pub podcast flow (offline fake page)', () => {
    test('a fresh receipt with full persisted readback confirms the draft: ok true with the episode id', async () => {
        const fake = makeFakeLauncher({ onDraftSave: 'episodeReceipt' });
        const result = await transport(fake).publish({ content: draftContent() });

        expect(result.ok).toBe(true);
        expect(result.url).toBe(RECEIPT_URL);
        expect(result.id).toBe('ep20261015001');
        expect(result.message).toContain('draft saved');
        expect(result.metadata).toMatchObject({
            operation: 'podcast',
            driver: 'script',
            publishStatus: 'draft',
            podcastId: PODCAST_ID,
            profileDir: DEFAULT_DIR,
            confirmedBy: 'draft-receipt',
        });
        expect(fake.calls).toContain(`fill:${TITLE_INPUT}|Episode 1`);
        expect(fake.calls.some((call) => call.startsWith(`pasteHtml:${SHOWNOTES_EDITOR}|<p>Shownotes text</p>`))).toBe(
            true,
        );
        expect(fake.calls).toContain(`setInputFiles:${AUDIO_INPUT}|${AUDIO_PATH}`);
        expect(fake.calls).toContain(`click:${SAVE_BUTTON}`);
        // Two contexts: the read-only headless preflight, then the headed flow.
        expect(fake.requests.map((request) => request.headless)).toEqual([true, false]);
        expect(fake.closeCount()).toBe(2);
    });

    test('an explicit draft publishStatus saves through the same pinned control', async () => {
        const fake = makeFakeLauncher({ onDraftSave: 'episodeReceipt' });
        const result = await transport(fake).publish({
            content: { ...draftContent(), metadata: { ...draftContent().metadata, publishStatus: 'draft' } },
        });
        expect(result.ok).toBe(true);
        expect(result.url).toBe(RECEIPT_URL);
        expect(result.metadata).toMatchObject({ publishStatus: 'draft' });
        expect(fake.calls).toContain(`click:${SAVE_BUTTON}`);
    });

    test('a requested cover is setInputFiles-assigned, verified, and read back at save time', async () => {
        const fake = makeFakeLauncher({ onDraftSave: 'episodeReceipt' });
        const result = await transport(fake).publish({ content: draftContent(), options: { coverPath: COVER_PATH } });
        expect(result.ok).toBe(true);
        expect(fake.calls).toContain(`setInputFiles:${COVER_INPUT}|${COVER_PATH}`);
        expect(result.metadata).toMatchObject({ confirmedBy: 'draft-receipt' });
    });

    test('an options.profileDir override names that profile in the Result metadata', async () => {
        const fake = makeFakeLauncher({ onDraftSave: 'episodeReceipt' });
        const profileDir = join(TMP_DIR, 'profile-flag');
        const result = await transport(fake).publish({ content: draftContent(), options: { profileDir } });
        expect(result.ok).toBe(true);
        expect(result.metadata?.profileDir).toBe(profileDir);
    });

    test('an unconfirmable show identity refuses at show-verify, before any upload', async () => {
        const fake = makeFakeLauncher({ showIdMissing: true });
        const result = await transport(fake).publish({ content: draftContent() });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'show-verify' });
        expect(result.error).toContain(`the requested podcastId '${PODCAST_ID}' was not observable`);
        expect(result.error).toContain('never uploads to a first/default show');
        expect(fake.calls.some((call) => call.startsWith('setInputFiles:'))).toBe(false);
        expect(fake.calls.some((call) => call.startsWith('fill:'))).toBe(false);
    });

    test('a missing audio file input is a typed upload-timeout refusal carrying the login hint', async () => {
        const fake = makeFakeLauncher({ missingAudioInput: true });
        const result = await transport(fake).publish({ content: draftContent() });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'upload-timeout' });
        expect(result.error).toContain('xiaoyuzhou audio file input never attached');
        expect(result.error).toContain(XYZF_LOGIN_INSTRUCTION);
        expect(fake.calls.some((call) => call.startsWith('pasteHtml:'))).toBe(false);
    });

    test('a rejected file assignment is a typed upload-timeout failure without the login hint', async () => {
        const fake = makeFakeLauncher({ uploadFileThrows: true });
        const result = await transport(fake).publish({ content: draftContent() });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'upload-timeout' });
        expect(result.error).toContain('xiaoyuzhou audio attach failed');
        expect(result.error).toContain('upload bridge rejected the file');
        expect(result.error).not.toContain(XYZF_LOGIN_INSTRUCTION);
    });

    test('the audio-processing deadline stays the typed 600s-ceiling branch — asserted, never waited', async () => {
        const src = await readFile(join(import.meta.dir, '..', 'src', 'flow.ts'), 'utf-8');
        // The processing poll is bounded by the module-level media ceiling, not the step timeout.
        expect(src).toContain('timeoutMs: XYZF_UPLOAD_TIMEOUT_MS');
        expect(src).toContain("'upload-processing'");
        expect(src).toContain('refusing to claim an uploaded episode');
        // The typed constructor the branch returns: single-line, staged, no claimed upload.
        const typed = stageFail(
            XYZF_TARGET,
            `xiaoyuzhou audio processing not confirmed within the ${XYZF_UPLOAD_TIMEOUT_MS}ms ceiling — the file was assigned but no media record (audio player or file name) appeared; refusing to claim an uploaded episode`,
            'upload-processing',
            {
                operation: 'podcast',
                driver: 'script',
                publishStatus: 'draft',
                podcastId: PODCAST_ID,
                profileDir: DEFAULT_DIR,
            },
        );
        expect(typed.ok).toBe(false);
        expect(typed.metadata).toMatchObject({ stage: 'upload-processing' });
        expect(typed.error).toContain('600000ms ceiling');
        expect(typed.error?.split('\n')).toHaveLength(1);
    });

    test('a dropped title is refused at the title-readback stage, never pasted forward or saved', async () => {
        const fake = makeFakeLauncher({ titleReadbackDrops: true });
        const result = await transport(fake).publish({ content: draftContent() });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'title-readback' });
        expect(result.error).toContain('xiaoyuzhou title readback failed');
        expect(fake.calls.some((call) => call.startsWith('pasteHtml:'))).toBe(false);
        expect(fake.calls.some((call) => call.startsWith('click:'))).toBe(false);
    });

    test('a page crash during the title fill is reported without the login hint', async () => {
        const fake = makeFakeLauncher({ fillThrows: true });
        const result = await transport(fake).publish({ content: draftContent() });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'title-readback' });
        expect(result.error).toContain('xiaoyuzhou title fill failed');
        expect(result.error).toContain('xiaoyuzhou editor page crashed on fill');
        expect(result.error).not.toContain(XYZF_LOGIN_INSTRUCTION);
    });

    test('a missing shownotes editor is a typed shownotes-paste failure', async () => {
        const fake = makeFakeLauncher({ missingShownotesEditor: true });
        const result = await transport(fake).publish({ content: draftContent() });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'shownotes-paste-readback' });
        expect(result.error).toContain('xiaoyuzhou shownotes paste failed');
        expect(fake.calls.some((call) => call.startsWith('click:'))).toBe(false);
    });

    test('a dropped paste is refused at the shownotes leg before any save control is clicked', async () => {
        const fake = makeFakeLauncher({ bodyReadbackDrops: true });
        const result = await transport(fake).publish({ content: draftContent() });

        expect(result.ok).toBe(false);
        // The flow detects the empty editor readback inside pasteHtml, so the typed stage is the
        // shownotes-paste family, surfaced before the save control is ever resolved.
        expect(result.metadata).toMatchObject({ stage: 'shownotes-paste-readback' });
        expect(result.error).toContain('xiaoyuzhou shownotes paste failed');
        expect(result.error).toContain('editor text is empty');
        expect(fake.calls.some((call) => call.startsWith('click:'))).toBe(false);
    });

    test('a requested cover with no file input is a typed cover-attach failure, never a silent skip', async () => {
        const fake = makeFakeLauncher({ onDraftSave: 'episodeReceipt', missingCoverInput: true });
        const result = await transport(fake).publish({ content: draftContent(), options: { coverPath: COVER_PATH } });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'cover-attach' });
        expect(result.error).toContain('xiaoyuzhou cover attach failed');
        expect(fake.calls.some((call) => call.startsWith('click:'))).toBe(false);
    });

    test('a cover that lands but never verifies its assignment refuses instead of claiming success', async () => {
        const fake = makeFakeLauncher({ onDraftSave: 'episodeReceipt', coverReadbackDrops: true });
        const result = await transport(fake).publish({ content: draftContent(), options: { coverPath: COVER_PATH } });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'cover-attach' });
        expect(result.error).toContain('xiaoyuzhou cover attach could not be verified');
        expect(result.error).toContain('refusing rather than claiming an unverified cover');
        expect(fake.calls.some((call) => call.startsWith('click:'))).toBe(false);
    });

    test('a missing save control is a typed draft-save failure, never a manufactured draft', async () => {
        const fake = makeFakeLauncher({ saveMissing: true });
        const result = await transport(fake).publish({ content: draftContent() });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'draft-save' });
        expect(result.error).toContain('draft-save control never attached');
        expect(result.error).toContain('not a manufactured draft');
        expect(fake.calls.some((call) => call.startsWith('click:'))).toBe(false);
    });

    test('a hidden or never-clickable save control refuses at its own leg, before any click', async () => {
        const hidden = makeFakeLauncher({ saveInvisible: true });
        const hiddenResult = await transport(hidden).publish({ content: draftContent() });
        expect(hiddenResult.ok).toBe(false);
        expect(hiddenResult.metadata).toMatchObject({ stage: 'draft-save' });
        expect(hiddenResult.error).toContain('attached but not visible');
        expect(hidden.calls.some((call) => call.startsWith('click:'))).toBe(false);

        const disabled = makeFakeLauncher({ submitNeverEnabled: true, onDraftSave: 'episodeReceipt' });
        const disabledResult = await transport(disabled).publish({ content: draftContent() });
        expect(disabledResult.ok).toBe(false);
        expect(disabledResult.metadata).toMatchObject({ stage: 'draft-save' });
        expect(disabledResult.error).toContain('draft-save control never became clickable');
        expect(disabled.calls.some((call) => call.startsWith('click:'))).toBe(false);
    });

    test('an idless state (stale receipt on screen, no fresh gain) is a typed draft-receipt failure', async () => {
        const fake = makeFakeLauncher({ onDraftSave: 'none', existingReceiptUrl: RECEIPT_URL });
        const result = await transport(fake).publish({ content: draftContent() });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'draft-receipt' });
        expect(result.error).toContain('draft-receipt not confirmed');
        expect(result.metadata?.evidence).toContain('1 pre-existing receipt-shaped url(s)');
        expect(fake.calls).toContain(`click:${SAVE_BUTTON}`);
    });

    test('a toast-only signal (which this flow never reads) never confirms the save', async () => {
        const fake = makeFakeLauncher({ onDraftSave: 'none', existingToasts: ['保存成功'] });
        const result = await transport(fake).publish({ content: draftContent() });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'draft-receipt' });
        expect(result.error).toContain('draft-receipt not confirmed');
        expect(result.error).toContain('fill alone is never a saved draft');
    });

    test('a fresh receipt whose persisted state no longer matches refuses instead of claiming success', async () => {
        const fake = makeFakeLauncher({ onDraftSave: 'episodeReceipt', persistedStateDrifts: true });
        const result = await transport(fake).publish({ content: draftContent() });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'draft-receipt' });
        expect(result.error).toContain('no longer matches the requested content');
        expect(result.metadata?.evidence).toContain('stale-state:');
    });

    test('a fresh receipt without a single id-bearing episode URL is an ambiguous typed failure', async () => {
        const podcastShaped = makeFakeLauncher({ onDraftSave: 'podcastReceipt' });
        const podcastResult = await transport(podcastShaped).publish({ content: draftContent() });
        expect(podcastResult.ok).toBe(false);
        expect(podcastResult.metadata).toMatchObject({ stage: 'draft-receipt' });
        expect(podcastResult.error).toContain('ambiguous');
        expect(podcastResult.metadata?.evidence).toContain('ambiguous-receipt:');

        const twoIds = makeFakeLauncher({ onDraftSave: 'twoEpisodeReceipts' });
        const twoIdsResult = await transport(twoIds).publish({ content: draftContent() });
        expect(twoIdsResult.ok).toBe(false);
        expect(twoIdsResult.metadata).toMatchObject({ stage: 'draft-receipt' });
        expect(twoIdsResult.metadata?.evidence).toContain('2 disagreeing fresh episode ids');
    });
});

describe('xiaoyuzhou-pub source hygiene (no eval, one sanitized paste, setInputFiles audio, native fills)', () => {
    test('no eval/new Function, no node:fs imports and no upload-vendor machinery in src', async () => {
        const sources = [
            await readFile(join(import.meta.dir, '..', 'src', 'index.ts'), 'utf-8'),
            await readFile(join(import.meta.dir, '..', 'src', 'flow.ts'), 'utf-8'),
            await readFile(join(import.meta.dir, '..', 'src', 'selectors.ts'), 'utf-8'),
            await readFile(join(import.meta.dir, '..', 'src', 'profile-check.ts'), 'utf-8'),
        ];
        for (const src of sources) {
            expect(src).not.toMatch(/\beval\(|new Function/);
            expect(src).not.toMatch(/from 'node:fs/);
            expect(src).not.toMatch(/fetch\(|XMLHttpRequest/i);
        }
    });

    test('exactly one paste site and it is the sanitize(markdownToHtml) chain', async () => {
        const flow = await readFile(join(import.meta.dir, '..', 'src', 'flow.ts'), 'utf-8');
        // The only pasteHtml call feeds the sanitized chain output, never raw body markdown.
        expect(flow.match(/pasteHtml\(/g)).toHaveLength(1);
        expect(flow).toContain('const html = sanitizeXiaoyuzhouHtml(markdownToHtml(body));');
        expect(flow).toContain('pasteHtml(page, resolvedEditor, html,');
    });

    test('audio travels through setInputFiles only — no in-page DataTransfer/blob/base64 path', async () => {
        const flow = await readFile(join(import.meta.dir, '..', 'src', 'flow.ts'), 'utf-8');
        expect(flow).toContain('uploadFile(page, audioSelector');
        expect(flow).toContain('uploadFile(page, coverSelector');
        expect(flow).not.toMatch(/new DataTransfer\(|atob\(|btoa\(/);
    });

    test('every resolveSelector call site is wrapped in a catch arm returning a typed stageFail', async () => {
        const flow = await readFile(join(import.meta.dir, '..', 'src', 'flow.ts'), 'utf-8');
        const sites = [...flow.matchAll(/await resolveSelector\(page/g)];
        expect(sites).toHaveLength(5); // audio input, title input, shownotes editor, cover input, save button
        for (const site of sites) {
            const tail = flow.slice(site.index ?? 0);
            const catchIdx = tail.indexOf('} catch');
            expect(tail.slice(catchIdx, catchIdx + 500)).toContain('stageFail(');
        }
    });

    test('the title is filled natively (input/change events) — never a bare .value assignment', async () => {
        const flow = await readFile(join(import.meta.dir, '..', 'src', 'flow.ts'), 'utf-8');
        expect(flow).toContain('.fill(title)');
        // Every `.value` occurrence in the flow is a readback read; an assignment would be the
        // source's flagged-suspect bare write (xiaoyuzhou.js:57-58).
        expect(flow).not.toMatch(/\.value\s*=[^=]/);
        // The shownotes paste dispatches real input/change events after the paste.
        expect(flow).toContain("new Event('input', { bubbles: true })");
        expect(flow).toContain("new Event('change', { bubbles: true })");
        // The only click site in the flow is the resolved draft-save control.
        const clickLines = flow.split('\n').filter((line) => /\.click\(/.test(line));
        expect(clickLines.length).toBeGreaterThan(0);
        for (const line of clickLines) expect(line).toContain('saveButton');
    });

    test('the provisional selectors and URLs carry their Provisional labels; grounded ones do not', async () => {
        const selectors = await readFile(join(import.meta.dir, '..', 'src', 'selectors.ts'), 'utf-8');
        expectProvisionalLabel(selectors, 'export const XYZF_LOGIN_URL_RE');
        expectProvisionalLabel(selectors, 'export const XYZF_UNSUPPORTED_URL_RE');
        expectProvisionalLabel(selectors, 'export const XYZF_RECEIPT_URL_RES');
        expectProvisionalLabel(selectors, 'coverInput:');
        expectProvisionalLabel(selectors, 'saveButton:');
        // Grounded controls are labeled Grounded, never Provisional.
        const groundedBlock = selectors.slice(
            selectors.indexOf('/** Audio file input.'),
            selectors.indexOf('Cover file control'),
        );
        expect(groundedBlock).toContain('**Grounded**');
        expect(groundedBlock).not.toContain('Provisional');
    });
});

describe('xiaoyuzhou-pub environment restoration', () => {
    test('unquoted javascript:/data: attribute values are stripped too', () => {
        const sanitized = sanitizeXiaoyuzhouHtml('<a href=javascript:alert(1)>a</a><img src=data:text/html,x>');
        expect(sanitized).not.toMatch(/javascript:|data:text/i);
    });
    test('no xiaoyuzhou profile env leaks between suites', () => {
        expect(process.env.XIAOYUZHOU_PROFILE_DIR).toBe(originalChannelDir);
        expect(process.env.KK_BROWSER_PROFILE_DIR).toBe(originalSharedDir);
        expect(process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT).toBe(originalFake);
    });
});
