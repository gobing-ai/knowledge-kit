/**
 * 0386 R1 — the brief, sourced, measured-timeline, card-bearing show notes rendered from the
 * frozen episode artifacts (final spoken items, 0394 citation provenance, measured audio offsets,
 * the published card order). Design D6.1 / L3 §单一标题、备注与封面:
 *
 *  - the article link appears **only** with a real publish receipt ({@link applyArticleReceipt});
 *    {@link renderBriefShowNotes} never derives a URL from the title, it renders a text-only
 *    placeholder instead, so the notes can be reviewed before the article exists;
 *  - a missing card asset (or a failed card upload) never blocks or abbreviates the render — the
 *    card degrades to its plain text and the failure is reported through the separate
 *    {@link CardDiagnostic} channel;
 *  - the notes stay a distinct reading surface: bullets + sources + timeline + cards, never the
 *    article body (the pre-0386 fallback repeated the body).
 *
 * Output dialect matches {@link renderShowNotesHtml}: markdown paragraphs plus two validated
 * marker blocks (`<!--kk:timeline-->`, `<!--kk:cards-->`) whose HTML is built here from escaped
 * values only.
 */

import type { Doc } from '@gobing-ai/kk-core';
import { computeAudioOffsets, escapeHtml, formatOffset, itemBrief, sourceLabelFor, TIMELINE_STYLE } from './show-notes';

/** Placeholder paragraph {@link applyArticleReceipt} rewrites once the article receipt exists. */
export const ARTICLE_PLACEHOLDER = '<p class="kk-tl-more">完整图文版：待文章发布回执</p>';

/** The exact `<style>` block {@link renderCardsRegion} emits (reused by the marker validator). */
export const CARDS_STYLE = `<style>
.kk-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin:1.25em 0 0}
.kk-card{margin:0;border:1px solid var(--mf-border,rgba(128,128,128,.25));border-radius:10px;overflow:hidden;background:var(--mf-surface,transparent)}
.kk-card img{display:block;width:100%;height:auto}
.kk-card figcaption{padding:8px 10px;font-size:.9em;color:var(--mf-muted,#444)}
.kk-card-n{font-weight:700;color:var(--mf-accent,#0969da);margin-right:6px}
@media (max-width:420px){.kk-cards{grid-template-columns:1fr}}
</style>`;

/** One rendered card, already reduced to host-safe values. */
export interface PlannedCard {
    /** Position in the published card order (1-based). */
    index: number;
    /** Always non-empty (a card without readable alt gets a positional description). */
    alt: string;
    /** Hosted image URL from the upload receipt, or `''` when no asset is available. */
    imageUrl: string;
    /** Optional rendered local PNG/image path for upload during episode publish. */
    imagePath?: string;
    /** Plain-text degradation: the card's copy (or its source point). */
    text: string;
}

/** A card problem, recorded separately from the render (never thrown, never fatal). */
export interface CardDiagnostic {
    index: number;
    reason: 'asset-missing' | 'upload-failed' | 'malformed';
    detail: string;
}

const isHttpUrl = (value: unknown): value is string => typeof value === 'string' && /^https?:\/\//i.test(value.trim());

function textOf(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * Reads the published card order (`25-xhs/cards.json`: `{cards:[{index, copy, sourcePoint, status,
 * imagePath, …}]}`, or the bare array) into render-safe cards plus the diagnostics for the ones
 * whose asset is missing or whose upload failed. Order is the manifest's; nothing is invented — a
 * card without a hosted URL renders text-only.
 */
export function planCards(raw: unknown): { cards: PlannedCard[]; diagnostics: CardDiagnostic[] } {
    const entries = Array.isArray(raw)
        ? raw
        : raw !== null && typeof raw === 'object' && Array.isArray((raw as { cards?: unknown }).cards)
          ? ((raw as { cards: unknown[] }).cards as unknown[])
          : [];
    const cards: PlannedCard[] = [];
    const diagnostics: CardDiagnostic[] = [];
    entries.forEach((entry, position) => {
        if (entry === null || typeof entry !== 'object') {
            diagnostics.push({ index: position + 1, reason: 'malformed', detail: 'card entry is not an object' });
            return;
        }
        const card = entry as Record<string, unknown>;
        const index =
            typeof card.index === 'number' && Number.isFinite(card.index) && card.index > 0
                ? Math.trunc(card.index)
                : position + 1;
        const uploadStatus = textOf(card.uploadStatus);
        const uploadError = textOf(card.uploadError);
        const url = isHttpUrl(card.url)
            ? (card.url as string).trim()
            : isHttpUrl(card.imageUrl)
              ? (card.imageUrl as string).trim()
              : '';
        if (uploadStatus === 'failed' || uploadError !== '') {
            diagnostics.push({ index, reason: 'upload-failed', detail: uploadError || 'upload reported failed' });
        } else if (textOf(card.status) !== 'rendered') {
            diagnostics.push({
                index,
                reason: 'asset-missing',
                detail: `card status is "${textOf(card.status) || 'unknown'}"`,
            });
        }
        const copy = textOf(card.copy);
        const sourcePoint = textOf(card.sourcePoint);
        const alt = textOf(card.alt) || copy || sourcePoint || `本期卡片 ${index}`;
        const rawImagePath = textOf(card.imagePath);
        const imagePath = textOf(card.status) === 'rendered' && rawImagePath !== '' ? rawImagePath : undefined;
        cards.push({
            index,
            alt,
            imageUrl: uploadStatus === 'failed' ? '' : url,
            ...(imagePath !== undefined ? { imagePath } : {}),
            text: copy || sourcePoint || alt,
        });
    });
    return { cards, diagnostics };
}

/**
 * The responsive card region: preserved order, readable alt on every `<img>`, plain-text caption
 * always. No card at all (or no manifest) ⇒ `''`, so the notes carry no empty block.
 */
export function renderCardsRegion(cards: PlannedCard[]): string {
    if (cards.length === 0) return '';
    const figures = cards
        .map((card) => {
            const img =
                card.imageUrl === ''
                    ? ''
                    : `<img src="${escapeHtml(card.imageUrl)}" alt="${escapeHtml(card.alt)}" loading="lazy">`;
            return `
    <figure class="kk-card">${img}<figcaption><span class="kk-card-n">${card.index}</span>${escapeHtml(card.text)}</figcaption></figure>`;
        })
        .join('');
    return `<!--kk:cards-->
${CARDS_STYLE}
<div class="kk-cards">${figures}
</div>
<!--/kk:cards-->`;
}

/** Inputs for {@link renderBriefShowNotes}: the frozen artifacts, nothing inferred. */
export interface BriefShowNotesInput {
    /** Episode heading (the 0385 frozen title); the page theme also renders it, so it is not repeated. */
    title?: string;
    /** Final spoken items in spoken order (plan ∩ script plan, exclusions already dropped). */
    docs: Doc[];
    /** Verified article URL **only** — pass `''` (or omit) until a real receipt exists. */
    articleUrl?: string;
    /** Measured segment metadata (`metadata.segments[]`): the source of real timeline offsets. */
    audioSegments?: Array<{ duration?: number; transcription?: string }>;
    /** `25-xhs/cards.json` contents; absent ⇒ no card region at all. */
    cards?: unknown;
}

/**
 * Renders the brief notes markdown: per-item bullets with the 0394 source citation, the measured
 * timeline (real offsets, `--:--` when a measurement is genuinely absent — never a fabricated
 * timestamp), the article entry (linked only when `articleUrl` is verified), the card region and
 * the footer. Card problems come back as {@link CardDiagnostic}s beside the markdown.
 */
export function renderBriefShowNotes(input: BriefShowNotesInput): { markdown: string; diagnostics: CardDiagnostic[] } {
    const { cards, diagnostics } = planCards(input.cards);
    const offsets = computeAudioOffsets(input.docs, input.audioSegments);
    const rows = input.docs
        .map((doc, i) => {
            const title = escapeHtml(doc.title ?? `条目 ${i + 1}`);
            const brief = escapeHtml(itemBrief(doc));
            const at = formatOffset(offsets[i] ?? Number.NaN);
            const label = escapeHtml(sourceLabelFor(doc));
            const link = isHttpUrl(doc.sourceUri)
                ? ` <a href="${escapeHtml(doc.sourceUri)}" target="_blank" rel="noopener">来源：${label}</a>`
                : ` <span class="kk-tl-src">来源：${label}</span>`;
            return `
    <div class="kk-tl-row"><div class="kk-tl-t">${at}</div><div class="kk-tl-body"><div class="kk-tl-title">${i + 1}. ${title}${link}</div><p class="kk-tl-brief">${brief}</p></div></div>`;
        })
        .join('');
    const articleEntry =
        input.articleUrl !== undefined && isHttpUrl(input.articleUrl)
            ? `<p class="kk-tl-more">完整图文版：<a href="${escapeHtml(input.articleUrl.trim())}" target="_blank" rel="noopener">本期完整文章</a></p>`
            : ARTICLE_PLACEHOLDER;
    const lines: string[] = [];
    if (input.title !== undefined && input.title !== '') lines.push(`# ${input.title}`, '');
    if (input.docs.length > 0) {
        lines.push(
            `<!--kk:timeline-->
<div class="kk-tl">${rows}
</div>
${TIMELINE_STYLE}
${articleEntry}
<!--/kk:timeline-->`,
            '',
        );
    }
    const cardRegion = renderCardsRegion(cards);
    if (cardRegion !== '') lines.push(cardRegion, '');
    return { markdown: lines.join('\n'), diagnostics };
}

/** Formats `<base>/<locale>/posts/<slug>` from a published surfdash `postPath`. Returns `''` if invalid. */
export function articleUrlFromPostPath(postPath: string, articleBaseUrl = 'https://surfing.salty.vip'): string {
    const trimmed = postPath.trim();
    if (trimmed === '') return '';
    const segments = trimmed.split(/[\\/]/).filter((s) => s.length > 0);
    // `<…>/posts/<locale>/<slug>/index.md` — the slug is the path segment before the file.
    const slug = segments.length >= 2 ? (segments[segments.length - 2] ?? '') : '';
    if (slug === '' || slug === 'posts') return '';
    const locale = segments.find((s) => ['zh', 'en', 'ja'].includes(s)) ?? 'zh';
    // surfdash serves `en` at the root; zh/ja carry the locale prefix (surfdash/src/lib/seo.ts).
    const prefix = locale === 'en' ? '' : `/${locale}`;
    return `${articleBaseUrl.replace(/\/+$/, '')}${prefix}/posts/${slug}`;
}

/** The hosted article slug a publish receipt proves, or `''` when the receipt proves nothing. */
function receiptArticleUrl(receipt: unknown, articleBaseUrl = 'https://surfing.salty.vip'): string {
    const entries = Array.isArray(receipt)
        ? receipt
        : receipt !== null && typeof receipt === 'object' && Array.isArray((receipt as { targets?: unknown }).targets)
          ? ((receipt as { targets: unknown[] }).targets as unknown[])
          : receipt !== null && typeof receipt === 'object'
            ? [receipt]
            : [];
    for (const entry of entries) {
        if (entry === null || typeof entry !== 'object') continue;
        const record = entry as Record<string, unknown>;
        if (record.ok === false) continue;
        const metadata =
            record.metadata !== null && typeof record.metadata === 'object'
                ? (record.metadata as Record<string, unknown>)
                : record;
        const postPath = textOf(metadata.postPath);
        if (postPath === '') continue;
        const url = articleUrlFromPostPath(postPath, articleBaseUrl);
        if (url !== '') return url;
    }
    return '';
}

/** Renders the `<p class="kk-tl-more">` paragraph linking to the full illustrated article. */
export function renderArticleLinkParagraph(articleUrl: string): string {
    return `<p class="kk-tl-more">完整图文版：<a href="${escapeHtml(articleUrl.trim())}" target="_blank" rel="noopener">本期完整文章</a></p>`;
}

/**
 * Strips unresolved {@link ARTICLE_PLACEHOLDER} before public microfeed publish so listeners do
 * not see an internal placeholder string when article publish hasn't landed yet.
 */
export function stripArticlePlaceholderHtml(html: string): string {
    if (!html.includes(ARTICLE_PLACEHOLDER)) return html;
    return html
        .replace(ARTICLE_PLACEHOLDER, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Inserts or replaces the `完整图文版` link inside published microfeed `content_html`, placing it
 * before the `.kk-cards` block (or at the end when there are no cards). Idempotent once linked.
 */
export function upsertArticleLinkHtml(html: string, articleUrl: string): { html: string; changed: boolean } {
    if (!isHttpUrl(articleUrl)) return { html, changed: false };
    const cleanUrl = articleUrl.trim();
    const linkParagraph = renderArticleLinkParagraph(cleanUrl);
    if (html.includes(escapeHtml(cleanUrl)) && /完整图文版/.test(html)) {
        return { html, changed: false };
    }
    if (html.includes(ARTICLE_PLACEHOLDER)) {
        return { html: html.replace(ARTICLE_PLACEHOLDER, linkParagraph), changed: true };
    }
    const existingPattern = /<p class="kk-tl-more">完整图文版：[\s\S]*?<\/p>/;
    if (existingPattern.test(html)) {
        return { html: html.replace(existingPattern, linkParagraph), changed: true };
    }
    // Insert right before the card block `<style>` (when present) or `<div class="kk-cards">` so
    // it appears right under the timeline, matching renderBriefShowNotes.
    const cardsStyleIdx = html.indexOf(CARDS_STYLE);
    const cardsDivIdx = html.indexOf('<div class="kk-cards">');
    const anchor = cardsStyleIdx >= 0 ? cardsStyleIdx : cardsDivIdx;
    if (anchor >= 0) {
        const before = html.slice(0, anchor).replace(/\s*$/, '');
        const after = html.slice(anchor).replace(/^\s*/, '');
        return {
            html: before === '' ? `${linkParagraph}\n${after}` : `${before}\n${linkParagraph}\n${after}`,
            changed: true,
        };
    }
    const trimmed = html.trim();
    return {
        html: trimmed === '' ? linkParagraph : `${trimmed}\n${linkParagraph}`,
        changed: true,
    };
}

/**
 * Enriches already-rendered notes with the article link **once a real receipt exists**: the
 * placeholder paragraph is replaced by the linked one derived from the receipt's `postPath`
 * (never from the title/date). A receipt that proves no post leaves the markdown byte-identical.
 */
export function applyArticleReceipt(
    markdown: string,
    receipt: unknown,
    articleBaseUrl = 'https://surfing.salty.vip',
): { markdown: string; enriched: boolean } {
    const url = receiptArticleUrl(receipt, articleBaseUrl);
    if (url === '' || !markdown.includes(ARTICLE_PLACEHOLDER)) return { markdown, enriched: false };
    return {
        markdown: markdown.replace(ARTICLE_PLACEHOLDER, renderArticleLinkParagraph(url)),
        enriched: true,
    };
}
