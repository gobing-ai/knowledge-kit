/**
 * Post-publish patching for a published daily episode (2026-10-12).
 *
 * Moved here from the kk stage `daily-patch-surfdash`, which owned the publisher's work: the
 * podcast-hosted cover URL in `image`/`og_image`, the per-locale podcast cross-link, the local
 * cover's `assets/` fallback, and the EmDash re-sync that makes CMS cards carry a servable image
 * (the pre-patch `./assets/cover.png` returns 404 from the deployed worker — prod feedback
 * 2026-09-29 / 2026-10-02 / 2026-10-11). Living in the publisher means every path that publishes a
 * post can heal it: the voice1 workflow, the voice2 DAG and a hand run call one operation.
 *
 * This module owns only the file work (deterministic, no network); the caller (`./index`) owns the
 * branch guard, the CMS re-sync and the git commit, in that order.
 */
import { basename, dirname, sep } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';

/** The locales a daily post carries; zh is the primary whose directory anchors the other two. */
export const PATCH_LOCALES = ['zh', 'en', 'ja'] as const;
export type PatchLocale = (typeof PATCH_LOCALES)[number];

/** Everything {@link patchPostFiles} needs; all paths absolute. */
export interface PatchPostRequest {
    /** Absolute `<root>/content/posts/articles/zh/<slug>/index.md` — the primary post. */
    postPath: string;
    /** Podcast-hosted cover URL (`https://...`); empty preserves an existing `https://` `image:` or uses {@link uploadLocalCover}. */
    coverUrl: string;
    /** Podcast episode URL for the cross-link line; empty → no cross-link. */
    showNotesUrl: string;
    /** Optional local cover path uploaded via {@link uploadLocalCover} when no `https://` cover exists yet. */
    localCover: string;
    /** `YYYY-MM-DD` episode date used in the cross-link text. */
    dateIso: string;
    /**
     * The episode's frozen identity title (0385 R4), e.g. `第261120期 · Anthropic 上市，估值口径成为焦点`.
     * Written to the zh post's `episode_title` frontmatter and used for the zh cross-link text, so the
     * article states the same episode identity the podcast ships. Empty → the older series · date
     * wording, which is what pre-0385 bundles carry.
     */
    episodeTitle?: string;
    /** Optional uploader converting a local cover into an `https://` remote URL (e.g. Microfeed R2). */
    uploadLocalCover?: (filePath: string) => Promise<string>;
    /**
     * The live page these posts serve (0432), named in the cover-skip diagnostic so an operator can
     * check the page instead of hunting the slug. Optional: a caller that does not know it (a
     * fixture, an offline replay) records an empty one rather than inventing a URL.
     */
    pageUrl?: string;
}

/**
 * The remote-cover verdict of one patch pass (0432).
 *
 * A post whose cover cannot be sourced is NOT a failure: the page is already live and its og:image
 * resolves from the CMS row, so the patch only lacks a URL to write into `image`/`og_image`. It
 * records `skipped` with the reason and the page URL instead of throwing — a live, correct page was
 * being reported as a failed target (2026-11-24 dogfood) because the only https cover the run knew
 * about was the one `podcast-pub` hosts, and that row was held by the safety verdict.
 */
export interface CoverPatchOutcome {
    /** `applied` when every locale that has a post carries a remote cover; `skipped` otherwise. */
    status: 'applied' | 'skipped';
    /** Locales whose post carries a remote https cover after this pass (written or kept). */
    applied: PatchLocale[];
    /** Locales left on their local/relative image because no https source existed. */
    skipped: PatchLocale[];
    /** Operator-facing reason naming the skipped locales; '' when nothing was skipped. */
    reason: string;
    /** The published page the skip concerns (`request.pageUrl`); '' when the caller supplied none. */
    pageUrl: string;
    /** Why the local-cover upload produced no URL (env/presign/network), absent when it was never tried. */
    uploadError?: string;
}

/** What the file pass changed; the caller commits exactly {@link PatchPostOutcome.written}. */
export interface PatchPostOutcome {
    /** Absolute paths written (posts plus any copied cover). */
    written: string[];
    /** Files whose bytes changed (not the copied cover). */
    changed: number;
    /** Locales with no published post on disk, in request order. */
    absent: PatchLocale[];
    /** Locale → the frontmatter image value the patch settled on. */
    images: Record<string, string>;
    /** The primary post's directory name, for the commit message. */
    slug: string;
    /** What happened to the remote cover this pass (0432); never a fatal outcome by itself. */
    coverPatch: CoverPatchOutcome;
}

/**
 * `…/articles/zh/<slug>/index.md` → the sibling locale's `index.md`, with the LAST `/zh/` segment
 * swapped. Undefined when the path carries no `/zh/` segment, which the caller reports as absent.
 */
export function localeIndexPath(postPath: string, locale: PatchLocale): string | undefined {
    if (locale === 'zh') return postPath;
    const marker = `${sep}zh${sep}`;
    const idx = postPath.lastIndexOf(marker);
    if (idx < 0) return undefined;
    return `${postPath.slice(0, idx)}${sep}${locale}${sep}${postPath.slice(idx + marker.length)}`;
}

/**
 * The podcast cross-link line per locale (task 0189 R4: the column's episode-title pattern, not the
 * retired news-bulletin name). The series names are fixed per-locale product identity (2026-10-23:
 * the translate agent had been inventing them) and must agree with the pipeline's single table in
 * plugins/kk/scripts/series-names.ts — the two packages cannot import each other, so tests assert
 * the agreement. digest-check.ts imports this table as the title-contract series names.
 */
export const SERIES_NAMES: Record<PatchLocale, string> = {
    zh: '每日AI乱炖',
    en: 'Daily AI Stew',
    ja: 'デイリーAIシチュー',
};

export function crossLinkFor(locale: PatchLocale, dateIso: string, showNotesUrl: string, episodeTitle = ''): string {
    const series = SERIES_NAMES[locale];
    // The zh episode's frozen identity (0385) rides after the link, never inside the anchor: the site's
    // `listen-link-series-name` gate requires the anchor text to name the canonical series and nothing
    // else series-like. en/ja have no localized identity, so they keep the series · date wording.
    const links: Record<PatchLocale, string> = {
        zh:
            episodeTitle !== ''
                ? `🎧 本期已同步制作为播客节目，[点击收听《${series} · ${dateIso}》](${showNotesUrl})：${episodeTitle}。`
                : `🎧 本期已同步制作为播客节目，[点击收听《${series} · ${dateIso}》](${showNotesUrl})。`,
        en: `🎧 This episode is also available as a podcast: [listen to ${series} · ${dateIso}](${showNotesUrl}).`,
        ja: `🎧 本エピソードはポッドキャストでも配信中：[${series} · ${dateIso} を聴く](${showNotesUrl})。`,
    };
    return links[locale];
}

/** The closing `---` of a document's frontmatter, or -1 when there is none. */
function frontmatterEnd(markdown: string): number {
    return markdown.indexOf('\n---', 3);
}

/**
 * Upsert one single-line `key: 'value'` in a document's frontmatter.
 *
 * The regex consumes folded-scalar continuation lines (`og_image: >-\n  https://…`) so multi-line
 * publish output is replaced whole, and the replacement is a function so `$&`/`$1` in the value are
 * never expanded. Scoped to the frontmatter, so a body line starting with `image:` is never
 * rewritten. A key that is absent is inserted after `publishDate`.
 */
export function upsertFrontmatterKey(markdown: string, key: string, value: string): string {
    const end = frontmatterEnd(markdown);
    if (end < 0) return markdown;
    const fm = markdown.slice(0, end);
    const body = markdown.slice(end);
    const line = `${key}: '${value.replaceAll("'", "''")}'`;
    const re = new RegExp(`^${key}:.*(?:\\n[ \\t]+.*)*`, 'm');
    const next = re.test(fm) ? fm.replace(re, () => line) : fm.replace(/^publishDate: .*$/m, (m0) => `${m0}\n${line}`);
    return next + body;
}

/**
 * Patch the published posts of one episode: cover URL (or the local cover's `assets/` fallback),
 * then the podcast cross-link. Idempotent per file — a post that already carries the values keeps
 * its bytes and is not committed.
 */
export async function patchPostFiles(request: PatchPostRequest): Promise<PatchPostOutcome> {
    const fs = createNodeFileSystem();
    const written: string[] = [];
    const absent: PatchLocale[] = [];
    const images: Record<string, string> = {};
    const coverSkipped: PatchLocale[] = [];
    let changed = 0;
    let uploadedFallbackCover: string | undefined;
    // 0432 R2/P3: the local upload is an environment step (base URL, key, presign, network). Its
    // failure leaves no sourceable cover, which is the recorded warning below — never a failed
    // target on a page that is already live.
    let uploadError: string | undefined;
    for (const locale of PATCH_LOCALES) {
        const indexMd = localeIndexPath(request.postPath, locale);
        if (indexMd === undefined || !(await fs.exists(indexMd))) {
            absent.push(locale);
            continue;
        }
        const before = await fs.readFile(indexMd);
        let md = before;
        const end = frontmatterEnd(md);
        const fm = end < 0 ? md : md.slice(0, end);
        const existingImage = /^image:\s*['"]?([^'"\n]+)['"]?/m.exec(fm)?.[1]?.trim() ?? '';
        if (request.coverUrl !== '') {
            // A relative or http:// cover would ship an unservable OG card — the deployed worker
            // only serves absolute https URLs (prod feedback 2026-09-29).
            if (!/^https:\/\//.test(request.coverUrl)) {
                throw new Error(`coverUrl must be an absolute https:// URL, got: ${request.coverUrl}`);
            }
            md = upsertFrontmatterKey(md, 'image', request.coverUrl);
            md = upsertFrontmatterKey(md, 'og_image', request.coverUrl);
            images[locale] = request.coverUrl;
        } else if (/^https:\/\//.test(existingImage)) {
            md = upsertFrontmatterKey(md, 'og_image', existingImage);
            images[locale] = existingImage;
        } else if (
            request.uploadLocalCover !== undefined &&
            request.localCover !== '' &&
            (await fs.exists(request.localCover))
        ) {
            if (uploadedFallbackCover === undefined && uploadError === undefined) {
                let uploaded: string | undefined;
                try {
                    uploaded = await request.uploadLocalCover(request.localCover);
                } catch (error) {
                    uploadError = error instanceof Error ? error.message : String(error);
                }
                if (uploaded !== undefined) {
                    // A non-https RESULT is an argument defect, not an environment failure: it stays loud.
                    if (!/^https:\/\//.test(uploaded)) {
                        throw new Error(`uploaded cover must be an absolute https:// URL, got: ${uploaded}`);
                    }
                    uploadedFallbackCover = uploaded;
                }
            }
            if (uploadedFallbackCover === undefined) {
                coverSkipped.push(locale);
            } else {
                md = upsertFrontmatterKey(md, 'image', uploadedFallbackCover);
                md = upsertFrontmatterKey(md, 'og_image', uploadedFallbackCover);
                images[locale] = uploadedFallbackCover;
            }
        } else {
            // 0432 R2: no https cover anywhere (the podcast row never uploaded one, the frontmatter
            // has none and no local cover is uploadable). The page is live and its og:image resolves,
            // so this is a recorded warning on an otherwise successful patch — never a failed target.
            // The episode identity and the cross-link below are still written.
            coverSkipped.push(locale);
        }
        if (locale === 'zh' && (request.episodeTitle ?? '') !== '') {
            // The article states the episode identity the podcast ships (0385). The site renders it
            // under the H1; its SEO title stays the digest shape, so this is additive, not a rename.
            md = upsertFrontmatterKey(md, 'episode_title', request.episodeTitle as string);
        }
        if (request.showNotesUrl !== '') {
            // 2026-10-23: a previous run may have left a 🎧 cross-link line carrying a retired
            // series name — refresh that line in place instead of keeping it forever (the URL it
            // carries made a fresh append a no-op). A non-cross-link line mentioning the URL is
            // left alone; the fresh link is only appended when no line carries the URL at all.
            const link = crossLinkFor(locale, request.dateIso, request.showNotesUrl, request.episodeTitle ?? '');
            const lines = md.split('\n');
            const carriesUrl = lines.some((line) => line.includes(request.showNotesUrl));
            if (!carriesUrl) {
                md = `${md.replace(/\s*$/, '')}\n\n${link}\n`;
            } else {
                md = lines
                    .map((line) =>
                        line.includes(request.showNotesUrl) && line.trimStart().startsWith('🎧') ? link : line,
                    )
                    .join('\n');
            }
        }
        if (md !== before) {
            await fs.writeFile(indexMd, md);
            written.push(indexMd);
            changed += 1;
        }
    }
    const applied = PATCH_LOCALES.filter((locale) => images[locale] !== undefined);
    return {
        written,
        changed,
        absent,
        images,
        slug: basename(dirname(request.postPath)),
        coverPatch: {
            status: coverSkipped.length === 0 ? 'applied' : 'skipped',
            applied,
            skipped: coverSkipped,
            reason:
                coverSkipped.length === 0
                    ? ''
                    : `${coverSkipped.join('/')} post has no remote https:// cover: coverUrl is empty, the frontmatter has no https:// image key and no local cover was uploadable${uploadError === undefined ? '' : ` (local cover upload failed: ${uploadError})`}`,
            ...(uploadError === undefined ? {} : { uploadError }),
            pageUrl: request.pageUrl ?? '',
        },
    };
}
