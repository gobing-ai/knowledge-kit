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
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';

/** The locales a daily post carries; zh is the primary whose directory anchors the other two. */
export const PATCH_LOCALES = ['zh', 'en', 'ja'] as const;
export type PatchLocale = (typeof PATCH_LOCALES)[number];

/** Everything {@link patchPostFiles} needs; all paths absolute. */
export interface PatchPostRequest {
    /** Absolute `<root>/content/posts/articles/zh/<slug>/index.md` — the primary post. */
    postPath: string;
    /** Podcast-hosted cover URL; empty → the local cover is copied into `assets/` instead. */
    coverUrl: string;
    /** Podcast episode URL for the cross-link line; empty → no cross-link. */
    showNotesUrl: string;
    /** This run's rendered cover, the fallback when `coverUrl` is empty. */
    localCover: string;
    /** `YYYY-MM-DD` episode date used in the cross-link text. */
    dateIso: string;
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
 * retired news-bulletin name).
 */
export function crossLinkFor(locale: PatchLocale, dateIso: string, showNotesUrl: string): string {
    const links: Record<PatchLocale, string> = {
        zh: `🎧 本期已同步制作为播客节目，[点击收听《每日AI乱炖 · ${dateIso}》](${showNotesUrl})。`,
        en: `🎧 This episode is also available as a podcast: [listen to 每日AI乱炖 · ${dateIso}](${showNotesUrl}).`,
        ja: `🎧 本エピソードはポッドキャストでも配信中：[每日AI乱炖 · ${dateIso} を聴く](${showNotesUrl})。`,
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
export function patchPostFiles(request: PatchPostRequest): PatchPostOutcome {
    const written: string[] = [];
    const absent: PatchLocale[] = [];
    const images: Record<string, string> = {};
    let changed = 0;
    for (const locale of PATCH_LOCALES) {
        const indexMd = localeIndexPath(request.postPath, locale);
        if (indexMd === undefined || !existsSync(indexMd)) {
            absent.push(locale);
            continue;
        }
        const dir = dirname(indexMd);
        const before = readFileSync(indexMd, 'utf-8');
        let md = before;
        const end = frontmatterEnd(md);
        const fm = end < 0 ? md : md.slice(0, end);
        if (request.coverUrl !== '') {
            md = upsertFrontmatterKey(md, 'image', request.coverUrl);
            md = upsertFrontmatterKey(md, 'og_image', request.coverUrl);
            images[locale] = request.coverUrl;
        } else if (!/^image:/m.test(fm) && existsSync(request.localCover)) {
            // Fallback for a run without a podcast cover: ship the rendered cover with the post.
            const asset = join(dir, 'assets', 'cover.png');
            mkdirSync(dirname(asset), { recursive: true });
            copyFileSync(request.localCover, asset);
            written.push(asset);
            md = upsertFrontmatterKey(md, 'image', './assets/cover.png');
            md = upsertFrontmatterKey(md, 'og_image', './assets/cover.png');
            images[locale] = './assets/cover.png';
        }
        if (request.showNotesUrl !== '' && !md.includes(request.showNotesUrl)) {
            md = `${md.replace(/\s*$/, '')}\n\n${crossLinkFor(locale, request.dateIso, request.showNotesUrl)}\n`;
        }
        if (md !== before) {
            writeFileSync(indexMd, md);
            written.push(indexMd);
            changed += 1;
        }
    }
    return { written, changed, absent, images, slug: basename(dirname(request.postPath)) };
}
