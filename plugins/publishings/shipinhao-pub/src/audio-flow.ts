/**
 * shipinhao 音频 (audio) post flow — the dedicated `/platform/post/createAudio` surface.
 *
 * WHY this file exists (2026-11-16, the "shipinhao audio never publishes" failure): the audio
 * operation used to drive the VIDEO create surface (`/platform/post/create`, reached from the
 * dashboard's 发表视频), feeding the .mp3 to the video intake. The platform then transcodes it as a
 * video — the cover sits at 封面预览 生成中 forever — so the post never persisted and the receipt
 * stage could only report `uncertain / effect unknown` (2026-11-15 run:
 * `kk-news-generate-20261115-1794799176832`, receipt status `uncertain`).
 *
 * Live recon 2026-11-16 pinned the real surface: dashboard → `内容管理` → `音频` (`音频管理`,
 * `/platform/post/audioManager`, which also carries the 音频 | 合集 tabs) → `发表音频`
 * (`/platform/post/createAudio`) with, in order: 音频 (上传文件 / 从视频选音频), 文件
 * (drag-drop zone, WAV/MP3, ≥10 s, ≥64 kbps, ≤1 GB), 封面 (1:1, jpg/png, ≤8 MB), 标题 (≤40),
 * 描述 (textarea, ≤3000), 合集 (`选择合集`, per-kind list: 不加合集 / <collections> / 创建新合集),
 * 定时发表, and ONE submit rail — `发表音频`. There is no 保存草稿 on this surface, which is why a
 * `publishStatus: 'draft'` request is refused here instead of being approximated.
 *
 * The receipt is the audio LIST, not a URL shape: the site returns to `/platform/post/audioManager`
 * and the new row (title + 发布时间 + status) is the works record. A submit whose row never appears
 * is `unknown`, never `published`.
 */

import { type Result, ResultSchema } from '@gobing-ai/kk-core';
import type { Page } from 'playwright';
import { SHP_TARGET, type ShipinhaoOperationName } from './selectors';

/** The 音频 manager and create routes (recon-Grounded 2026-11-16). */
export const SHP_AUDIO_MANAGER_PATH = '/platform/post/audioManager';
export const SHP_AUDIO_CREATE_PATH = '/platform/post/createAudio';

/** 标题 hard cap on the audio form (0/40 counter, live recon 2026-11-16). */
export const SHP_AUDIO_TITLE_MAX = 40;
/** 描述 hard cap on the audio form (0/3000 counter, live recon 2026-11-16). */
export const SHP_AUDIO_DESCRIPTION_MAX = 3000;
/** Budget for the fresh-row receipt in 音频管理 after 发表音频 (recon: the list re-renders in seconds). */
export const SHP_AUDIO_RECEIPT_MS = 30_000;

/** Test seam for the receipt clock: the 30 s production value made the suite unrunnable. */
let receiptBudgetMs: number | null = null;
export function setAudioReceiptBudgetForTests(ms: number | null): void {
    receiptBudgetMs = ms;
}

/** Everything the audio flow needs; the caller owns the pre-browser ladder and the session check. */
export interface AudioFlowInput {
    page: Page;
    title: string;
    body: string;
    tags: readonly string[];
    /** One local audio file (the episode mp3). */
    media: readonly string[];
    coverPath?: string;
    collection?: string;
    publishPublic: boolean;
    operation: ShipinhaoOperationName;
    profileDir: string;
    stepTimeoutMs: number;
}

/** A typed failure Result, matching the flow's `stageFail` shape without importing the video flow. */
function stageFail(message: string, stage: string, metadata: Record<string, unknown>, evidence?: string): Result {
    return ResultSchema.parse({
        ok: false,
        target: SHP_TARGET,
        error: message,
        effect: 'unknown',
        metadata: { ...metadata, stage, ...(evidence === undefined ? {} : { evidence }) },
    });
}

/** Poll `probe` until it returns a non-null value, or the budget runs out. */
export async function expectOutcome<T>(
    probe: () => Promise<T | null>,
    timeoutMs: number,
    label: string,
): Promise<{ ok: true; evidence: T } | { ok: false; error: string }> {
    const deadline = Date.now() + timeoutMs;
    let last = `${label} never observed`;
    for (;;) {
        try {
            const value = await probe();
            if (value !== null) return { ok: true, evidence: value };
        } catch (error) {
            last = `${label}: ${error instanceof Error ? error.message : String(error)}`;
        }
        if (Date.now() >= deadline) return { ok: false, error: last };
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
}

/** The 描述 text: the body's trimmed plain text plus the topic tags, clipped to the form's cap. */
export function buildAudioDescription(body: string, tags: readonly string[]): string {
    const topicLine = tags.map((tag) => `#${tag.replace(/^#/, '')}`).join(' ');
    const combined = topicLine.length > 0 ? `${body.trim()}\n\n${topicLine}` : body.trim();
    return combined.slice(0, SHP_AUDIO_DESCRIPTION_MAX);
}

/** The 标题: clipped to 40 by code point so a long title is a clipped title, never a failed fill. */
export function clipAudioTitle(title: string): string {
    return Array.from(title.trim()).slice(0, SHP_AUDIO_TITLE_MAX).join('');
}

/**
 * Navigate dashboard → 内容管理 → 音频 → 发表音频 and confirm the create surface, returning a typed
 * failure instead of throwing when any hop is missing (the SPA's submenu only exists while hovered,
 * so the click is dispatched on the anchor once the menu is open).
 */
async function openAudioCreate(page: Page, stepTimeoutMs: number): Promise<string | null> {
    await page.goto('https://channels.weixin.qq.com/platform', {
        waitUntil: 'domcontentloaded',
        timeout: stepTimeoutMs,
    });
    await page.waitForTimeout(8_000);
    const menu = page.locator('a:has-text("内容管理")').first();
    await menu.hover({ timeout: stepTimeoutMs });
    await page.waitForTimeout(2_000);
    // The submenu exists only while 内容管理 is hovered, and the anchor is an SPA link: click it
    // through the DOM (a Playwright click rejects the item once the hover moves).
    const clicked = await page.evaluate(`(() => {
        const anchor = Array.from(document.querySelectorAll('a')).find((el) => (el.textContent || '').trim() === '音频');
        if (!anchor) return false;
        anchor.click();
        return true;
    })()`);
    if (!clicked) return '音频 submenu entry not found under 内容管理';
    const manager = await expectOutcome(
        async () => (page.url().includes(SHP_AUDIO_MANAGER_PATH) ? page.url() : null),
        stepTimeoutMs,
        '音频管理 page',
    );
    if (!manager.ok) return `音频管理 page never opened: ${manager.error}`;
    const entry = page.locator('button:has-text("发表音频")').first();
    // The URL flips before the manager renders its header button — poll, do not count once.
    const ready = await expectOutcome(
        async () => ((await entry.count()) > 0 ? '发表音频 entry rendered' : null),
        stepTimeoutMs,
        '音频管理 发表音频 entry',
    );
    if (!ready.ok) return `发表音频 entry never rendered on 音频管理: ${ready.error}`;
    await entry.click({ timeout: stepTimeoutMs });
    const create = await expectOutcome(
        async () => (page.url().includes(SHP_AUDIO_CREATE_PATH) ? page.url() : null),
        stepTimeoutMs,
        '发表音频 form',
    );
    if (!create.ok) return `发表音频 form never opened: ${create.error}`;
    return null;
}

/** Upload the mp3 through the drop zone's file chooser and wait for the file chip to render. */
async function attachAudio(page: Page, file: string, stepTimeoutMs: number): Promise<string | null> {
    const zone = page.locator('text=拖拽到此处上传').first();
    if ((await zone.count()) === 0) return 'audio drop zone (拖拽到此处上传) not found';
    const chooserPromise = page.waitForEvent('filechooser', { timeout: stepTimeoutMs }).catch(() => null);
    await zone.click({ timeout: stepTimeoutMs });
    const chooser = await chooserPromise;
    if (chooser === null) return 'clicking the audio drop zone opened no file chooser';
    await chooser.setFiles(file);
    const name = file.split('/').pop() ?? '';
    const attached = await expectOutcome(
        async () => ((await page.locator(`text=${name.slice(0, 12)}`).count()) > 0 ? 'file chip rendered' : null),
        60_000,
        'audio file chip',
    );
    if (!attached.ok) return `the file was handed to the form but no file chip appeared: ${attached.error}`;
    return null;
}

/**
 * Attach the 封面: click the tile above the 封面宽高比 hint, hand the file to the chooser, then
 * confirm the 编辑音频封面 crop dialog (确认). Success = the form's 「请上传封面」 validation text is
 * gone and a preview is rendered — a cover the form rejected must never reach the submit click.
 */
export async function attachAudioCover(page: Page, coverPath: string, stepTimeoutMs: number): Promise<string | null> {
    const hint = page.locator('text=封面宽高比').first();
    if ((await hint.count()) === 0) return '音频 封面 hint (封面宽高比) not found';
    await hint.scrollIntoViewIfNeeded();
    const box = await hint.boundingBox();
    if (box === null) return '音频 封面 tile has no layout box';
    const chooserPromise = page.waitForEvent('filechooser', { timeout: stepTimeoutMs }).catch(() => null);
    // The tile is the dashed “+” square directly above the hint text.
    await page.mouse.click(box.x + 40, box.y - 70);
    const chooser = await chooserPromise;
    if (chooser === null) return 'clicking the 封面 tile opened no file chooser';
    await chooser.setFiles(coverPath);
    const cropped = await expectOutcome(
        async () => {
            const confirm = page.locator('button:text-is("确认")').first();
            if ((await confirm.count()) === 0 || !(await confirm.isVisible().catch(() => false))) return null;
            await confirm.click({ timeout: 4_000 }).catch(() => {});
            return 'crop confirmed';
        },
        stepTimeoutMs,
        '编辑音频封面 crop dialog',
    );
    if (!cropped.ok) return `the 封面 crop dialog never appeared: ${cropped.error}`;
    const cleared = await expectOutcome(
        async () => ((await page.locator('text=请上传封面').count()) === 0 ? 'cover accepted' : null),
        stepTimeoutMs,
        '音频 封面 validation',
    );
    if (!cleared.ok) return `the 封面 was uploaded but the form still reports 「请上传封面」: ${cleared.error}`;
    return null;
}

/** Open the 合集 picker, click the exact collection, and verify the row reads it back. */
export async function selectAudioCollection(
    page: Page,
    collection: string,
    stepTimeoutMs: number,
): Promise<string | null> {
    const picker = page.locator('div.display-text:has-text("选择合集")').first();
    if ((await picker.count()) === 0) return '合集 picker (选择合集) not found on the audio form';
    await picker.scrollIntoViewIfNeeded();
    // The same node keeps the selection — only its text changes to the collection name — so hold it;
    // a text re-query for 选择合集 would resolve to nothing after the click.
    const row = await picker.elementHandle();
    await picker.click({ timeout: stepTimeoutMs });
    await page.waitForTimeout(2_000);
    // Exact text only: the 标题 input carries "每日AI乱炖 · 2026-11-15", so a substring match would
    // click our own title instead of the collection option.
    const option = page.getByText(collection, { exact: true });
    if ((await option.count()) === 0) return `合集 '${collection}' is not among this account's 音频 collections`;
    await option.last().click({ timeout: stepTimeoutMs });
    const readback = await expectOutcome(
        async () => {
            const text = ((await row?.textContent()) ?? '').trim();
            return text.includes(collection) ? text : null;
        },
        stepTimeoutMs,
        '合集 readback',
    );
    if (!readback.ok) return `合集 '${collection}' was clicked but the form does not show it: ${readback.error}`;
    return null;
}

/**
 * How many rows in 音频管理 carry `title`. The list is a div grid (no `<tr>`), so this counts the
 * title text nodes; a re-publish of the same title raises the count, which is what the fresh-row
 * contract needs.
 */
export async function countAudioRows(page: Page, title: string): Promise<number> {
    try {
        return await page.getByText(title, { exact: false }).count();
    } catch {
        return 0;
    }
}

/**
 * Run the audio post. Returns a `Result` — `ok: true` only when the audio list carries the new row.
 */
export async function runAudioPostFlow(input: AudioFlowInput): Promise<Result> {
    const { collection, publishPublic, operation, profileDir } = input;
    const metadata: Record<string, unknown> = {
        operation,
        driver: 'script',
        publishStatus: publishPublic ? 'public' : 'draft',
        profileDir,
        ...(collection !== undefined ? { collection } : {}),
    };
    // 发表音频 is the only submit rail on this surface: a draft request cannot be honoured.
    if (!publishPublic) {
        return stageFail(
            'shipinhao 音频 has no draft rail — the 发表音频 form offers only 发表音频 (no 保存草稿); request publishStatus: public or publish nothing',
            'draft-unsupported',
            metadata,
        );
    }
    // 封面 is MANDATORY on the audio form: submitting without one fails client-side validation with
    // 「请上传封面」 and silently produces no works row (live recon 2026-11-16 — this is what made every
    // audio publish end `uncertain`). The refusal is pre-browser; a supplied cover is attached through
    // the form's own crop dialog inside pendingAudioFlow.
    if (input.coverPath === undefined) {
        return stageFail(
            'shipinhao 音频 requires a cover (封面) — the form refuses to submit without one (「请上传封面」); pass coverPath',
            'audio-cover',
            metadata,
        );
    }
    return pendingAudioFlow(input, metadata);
}

/**
 * The recon-grounded steps: open 音频管理 → 发表音频, upload, 标题/描述, 封面 (crop dialog 确认),
 * 合集 by exact text, submit, then the fresh-row receipt. Exported for the stage tests, which drive
 * the steps against a fake page.
 */
export async function pendingAudioFlow(input: AudioFlowInput, metadata: Record<string, unknown>): Promise<Result> {
    const { page, title, body, tags, media, collection, profileDir, stepTimeoutMs } = input;
    const audio = media[0];
    if (audio === undefined) return stageFail('shipinhao 音频 requires one audio file', 'media', metadata);

    const opened = await openAudioCreate(page, stepTimeoutMs);
    if (opened !== null) return stageFail(opened, 'audio-open', metadata);

    const attached = await attachAudio(page, audio, stepTimeoutMs);
    if (attached !== null) return stageFail(attached, 'audio-upload', metadata);

    const clipped = clipAudioTitle(title);
    const description = buildAudioDescription(body, tags);
    const titleInput = page.locator('input[placeholder="请填写标题"]').first();
    if ((await titleInput.count()) === 0) return stageFail('音频 标题 input not found', 'audio-title', metadata);
    await titleInput.fill(clipped);
    const titleOk = await expectOutcome(
        async () => ((await titleInput.inputValue()) === clipped ? 'title retained' : null),
        stepTimeoutMs,
        '音频 标题 readback',
    );
    if (!titleOk.ok) return stageFail(`音频 标题 readback failed: ${titleOk.error}`, 'audio-title', metadata);

    const descriptionBox = page.locator('textarea[placeholder="请填写描述"]').first();
    if ((await descriptionBox.count()) === 0)
        return stageFail('音频 描述 textarea not found', 'audio-description', metadata);
    await descriptionBox.fill(description);
    const descriptionOk = await expectOutcome(
        async () => ((await descriptionBox.inputValue()).length > 0 ? 'description retained' : null),
        stepTimeoutMs,
        '音频 描述 readback',
    );
    if (!descriptionOk.ok) {
        return stageFail(`音频 描述 readback failed: ${descriptionOk.error}`, 'audio-description', metadata);
    }

    const coverPath = input.coverPath;
    if (coverPath !== undefined) {
        const cover = await attachAudioCover(page, coverPath, stepTimeoutMs);
        if (cover !== null) return stageFail(cover, 'audio-cover', metadata);
    }

    if (collection !== undefined) {
        const selected = await selectAudioCollection(page, collection, stepTimeoutMs);
        if (selected !== null) return stageFail(selected, 'collection-select', metadata);
    } else {
        // Absence is explicit: 不加合集 is the form's default, and a post must never inherit a
        // previously chosen collection silently.
        const readback = await page.locator('div.display-text:has-text("选择合集")').count();
        if (readback === 0) {
            return stageFail('合集 row missing before submit', 'collection-select', metadata);
        }
    }

    // Fresh-row contract: record how many 音频 rows already carry this title, submit, then require
    // the count to INCREASE. A count that only holds steady means the submit restored an existing
    // row, never that it published ours (the video rail's fresh-receipt rule, restated for a list).
    const baseline = await countAudioRows(page, clipped);

    const submit = page.locator('button:has-text("发表音频")').first();
    if ((await submit.count()) === 0) return stageFail('发表音频 submit control not found', 'audio-submit', metadata);
    if (await submit.isDisabled()) return stageFail('发表音频 submit control is disabled', 'audio-submit', metadata);
    await submit.click({ timeout: stepTimeoutMs });

    // Some submissions raise a confirmation; click it once when it appears.
    await page.waitForTimeout(3_000);
    for (const label of ['确认发表', '确定']) {
        const confirm = page.locator(`button:text-is("${label}")`).first();
        if ((await confirm.count()) > 0 && (await confirm.isVisible().catch(() => false))) {
            await confirm.click({ timeout: 5_000 }).catch(() => {});
            break;
        }
    }

    // Receipt: the 音频 list row. The site returns to /platform/post/audioManager and renders the
    // new row there; the table is div-based, so the row is found by its title text, never by `tr`.
    const receipt = await expectOutcome(
        async () => {
            if (!page.url().includes(SHP_AUDIO_MANAGER_PATH)) return null;
            const count = await countAudioRows(page, clipped);
            if (count <= baseline) return null;
            return { url: page.url(), rows: count };
        },
        // The site's own list pagination settles in well under a minute; the submit click already
        // proved the form accepted the post, so a longer wait only delays a truthful `unknown`.
        receiptBudgetMs ?? SHP_AUDIO_RECEIPT_MS,
        '音频 list row',
    );
    if (!receipt.ok) {
        return stageFail(
            'shipinhao 音频 publish-receipt not confirmed — 发表音频 was clicked but no new row carrying the title appeared in 音频管理; a submit without a works row is unknown and is never reported as published',
            'audio-receipt',
            metadata,
            receipt.error,
        );
    }
    return ResultSchema.parse({
        ok: true,
        target: SHP_TARGET,
        url: receipt.evidence.url,
        message: `shipinhao audio published and confirmed in the 音频 list (${profileDir})`,
        metadata: { ...metadata, confirmedBy: 'audio-list-row', rowsWithTitle: receipt.evidence.rows },
    });
}
