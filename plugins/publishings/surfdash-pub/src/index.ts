/**
 * surfdash-pub plugin — publishing transport for the Surfdash site.
 *
 * Listen-link backfill:
 * Runs `bun run sd seo listen-link --backfill --write` before the site gate and commit
 * in both the main publish path (when auto-push is on) and the patch path. Any modified
 * files under `content/posts` are included in the scoped commit pathspec.
 *
 * Site gate:
 * Before committing and pushing post content to surfdash `main` (both in the main publish
 * path and the patch path), `runSiteGate` executes `bun run sd check digest` and
 * `bun run check:content` in the surfdash checkout. The surfdash site gate is the authoritative
 * validation suite before deployment.
 *
 * Daily-topics sync:
 * Before the site gate and commit, digest posts with all three locale files are mapped into
 * the surfdash site's `scripts/seo/daily-topics.json` (from the posts' own refined frontmatter,
 * no new prose), then `bun run sd seo retitle --write --stamp-claims` runs in the checkout.
 * A build/retitle failure fails the run before anything is committed or pushed. See
 * `./topic-claims` for the file work.
 *
 * Environment variables:
 * - `SURFDASH_LISTEN_BACKFILL`:
 *   - `off`: skips the listen-link backfill command.
 * - `SURFDASH_DIGEST_CHECK`:
 *   - unset / default: fail-loud on gate failure; commit and push are blocked.
 *   - `warn`: echoes gate failures via `echoError` prefixed with `site gate (warn):` and continues.
 *   - `off`: bypasses the gate check.
 *   - Both escape hatches are IGNORED while this run pushes to surfdash `main`
 *     (`SURFDASH_AUTO_PUSH !== '0'` and the checkout is on `main`): a failing gate always
 *     blocks there, and `off` still runs the gate.
 * - `SURFDASH_AUTO_PUSH`:
 *   - '0': disables auto-commit and push (used in tests and offline runs).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, cp, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Result, ResultSchema } from '@gobing-ai/kk-core';
import type { PublishTransport, PublishTransportPayload } from '@gobing-ai/publish-harness';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
// The plugin's public digest-contract surface (2026-10-24).
import { checkDigestFrontmatter, DIGEST_TAG, type DigestLocale } from './digest-check';
import { localeIndexPath, PATCH_LOCALES, type PatchPostOutcome, patchPostFiles } from './patch';
import { buildDailyTopicsEntry, isDigestMarkdown, slugFromPostPath, upsertDailyTopicsEntry } from './topic-claims';

export { checkDigestFrontmatter, DIGEST_TAG, type DigestLocale } from './digest-check';
export { buildDailyTopicsEntry, isDigestMarkdown, slugFromPostPath, upsertDailyTopicsEntry } from './topic-claims';

/** Result target name for this plugin. */
const TARGET = 'surfdash';

/** Management operations routed via `options.operation` (L1 R7; pattern from podcast-pub). */
const OPERATIONS = [
    'publish',
    'prepare',
    'refine-prepared',
    'publish-prepared',
    'scaffold-locale',
    'sync',
    'patch',
] as const;
type Operation = (typeof OPERATIONS)[number];

/** Locales `scaffold-locale` can scaffold; LLM translation stays in the workflow's agent step. */
const SCAFFOLD_LOCALES = ['en', 'ja'] as const;
type ScaffoldLocale = (typeof SCAFFOLD_LOCALES)[number];
type SupportedLocale = 'zh' | 'en' | 'ja';

/** Cover-image extensions accepted from `metadata.coverImage` (R4): anything else is rejected, not copied. */
const COVER_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

/** Target-specific options carried on the invoke payload's `options` channel. */
interface SurfdashPubOptions {
    operation?: unknown;
    /** zh `index.md` absolute path inside the surfdash tree; required for `scaffold-locale`, `sync` and `patch`. */
    postPath?: unknown;
    /** Draft locale to scaffold; required for `scaffold-locale`. */
    target?: unknown;
    /** Rebuild an existing locale draft after the zh source fingerprint changes. */
    force?: unknown;
    /** `publish-prepared`: YYYYMMDD run identity bound to the validated locale files. */
    runDate?: unknown;
    /** `refine-prepared`: ask the site-owned orchestrator to refine all three local locale files. */
    // The plugin never writes `refined: true` itself; the site command owns all managed fields.
    /** `publish-prepared`: SHA-256 of the prepared zh post, checked before postsurfing runs. */
    expectedPostSha256?: unknown;
    /** `publish-prepared`: fingerprint of the prepared zh/en/ja files, checked before postsurfing runs. */
    expectedLocaleFingerprint?: unknown;
    /** `patch`: podcast-hosted cover URL for `image`/`og_image` (empty → the local cover fallback). */
    coverUrl?: unknown;
    /** `patch`: podcast episode URL appended as the cross-link (empty → none). */
    showNotesUrl?: unknown;
    /** `patch`: this run's rendered cover, used when `coverUrl` is empty. */
    localCover?: unknown;
    /** `patch`: `YYYY-MM-DD` episode date for the cross-link text. */
    dateIso?: unknown;
    /** `patch`: the episode's frozen identity title (0385 R4); the zh post's `episode_title`. */
    episodeTitle?: unknown;
}

/**
 * Options for mapping Content into Surfing Markdown with frontmatter.
 */
export interface MapContentOptions {
    /** Target publishing site name or base URL. Defaults to 'surfdash'. */
    targetName?: string;
    /** Frontmatter image value (e.g. `./assets/cover.png`); written to `image` and `og_image`. */
    image?: string;
    /** ISO date for publishDate; defaults to today. */
    publishDate?: string;
}

/**
 * Converts a string into a lowercase hyphenated tag (slug).
 */
export function slugify(str: string): string {
    return str
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/[\s_]+/g, '-');
}

/**
 * Normalizes a raw tag string for frontmatter: preserves `sub-category:<slug>` prefixes
 * while slugifying the value portion (or ordinary tags).
 */
export function normalizeTag(raw: string): string {
    const match = raw.match(/^\s*sub-category\s*:(.*)$/i);
    if (match) {
        const subSlug = slugify(match[1] ?? '');
        return subSlug ? `sub-category:${subSlug}` : '';
    }
    return slugify(raw);
}

/**
 * The content's tag sources (metadata.tags, keywords, subCategory) as normalized frontmatter tags.
 *
 * `slugify` drops non-ASCII, so a Chinese tag (`硬件发布`) collapsed to '' and shipped as an empty
 * YAML tag — the site renders it as a blank chip (seen on 20261011-ai-2026-10-11). Case variants
 * also collapsed to the same slug twice (`AI` + `ai`), so the set dedupes. `normalizeTag` preserves
 * `sub-category:<slug>` colon prefixes so sub-category series tags survive into frontmatter.
 */
export function contentTags(content: Content): string[] {
    const rawTags: unknown[] = Array.isArray(content.metadata?.tags)
        ? [...content.metadata.tags]
        : Array.isArray(content.metadata?.keywords)
          ? [...content.metadata.keywords]
          : [];
    if (typeof content.metadata?.subCategory === 'string' && content.metadata.subCategory.trim().length > 0) {
        const subRaw = content.metadata.subCategory.trim();
        rawTags.push(/^sub-category\s*:/i.test(subRaw) ? subRaw : `sub-category:${subRaw}`);
    }
    return [
        ...new Set(
            rawTags
                .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
                .map((t: string) => normalizeTag(t)),
        ),
    ].filter((tag) => tag.length > 0);
}

/**
 * Maps Content object into Surfing frontmatter and body per the publish spec.
 */
export function mapContentToSurfingMarkdown(content: Content, options: MapContentOptions = {}): string {
    let title = content.title;
    if (!title) {
        const match = content.body.match(/^#\s+(.+)$/m);
        title = match?.[1] ? match[1].trim() : 'Untitled Post';
    }

    // ADR-008: the site's refine step owns the digest/SEO description; the generator's
    // first-paragraph fallback shipped the raw lede as SEO metadata before refine existed.
    const description =
        typeof content.metadata?.description === 'string' && content.metadata.description.length > 0
            ? content.metadata.description
            : '';

    const tags = contentTags(content);

    const isoDate = options.publishDate ?? new Date().toISOString().slice(0, 10);
    const draft = typeof content.metadata?.published === 'boolean' ? !content.metadata.published : false;

    // Strict surfdash PostSchema (surfdash/src/content/schema.ts): publishDate (ISO date) is
    // required; unknown keys (`date`, `canonical_url`, `published`) are rejected.
    //
    // `canonical` is deliberately NOT written here. The canonical URL is the site's own route
    // for this slug, which only the site can compute (locale prefix + collection segment); the
    // previous `references[0].url` fallback pointed the canonical at an unrelated *external*
    // source and would have dropped the post out of the sitemap if surfdash's refine step had
    // not overwritten it. See docs/00_ADR.md ADR-008: the generator supplies content, the site
    // supplies identity.
    const frontmatterObj: Record<string, unknown> = {
        title,
        description,
        tags,
        publishDate: isoDate,
        draft,
        ...(options.image ? { image: options.image, og_image: options.image } : {}),
    };

    const yamlLines = ['---', ...Object.entries(frontmatterObj).map(([k, v]) => `${k}: ${JSON.stringify(v)}`), '---'];
    return `${yamlLines.join('\n')}\n\n${content.body.trim()}\n`;
}

/** True when the content's tag sources (contentTags) mark it as a daily digest post. */
function isDigestContent(content: Content): boolean {
    return contentTags(content).some((tag) => tag.includes(DIGEST_TAG));
}

/** `Result` failure helper: ok false + error (podcast-pub pattern). */
function fail(error: string): Result {
    return ResultSchema.parse({ ok: false, target: TARGET, error });
}

type DeliveryState = 'not-sent' | 'uncertain';

/**
 * A failed publish is replay-safe only when it was rejected before postsurfing was invoked.
 *
 * Both keys are emitted on purpose: the voice2 daily stages read `deliveryState`, while the publish
 * matrix receipts only accept the reserved `metadata.itcDelivery` evidence (task 0302, docs/04 §itc).
 * Without the second key a pre-dispatch refusal was recorded as `effect: unknown`, so the row could
 * never be retried even after the operator fixed the cause (2026-11-12 daily publish dogfood).
 */
function failWithDeliveryState(error: string, deliveryState: DeliveryState): Result {
    return ResultSchema.parse({
        ok: false,
        target: TARGET,
        error,
        metadata: {
            deliveryState,
            itcDelivery: { schemaVersion: 1, effect: deliveryState === 'not-sent' ? 'none' : 'unknown' },
        },
    });
}

function failNotSent(error: string): Result {
    return failWithDeliveryState(error, 'not-sent');
}

function failUncertain(error: string): Result {
    return failWithDeliveryState(error, 'uncertain');
}

/**
 * Writes a Result JSON to `outputPath`, creating the directory as needed. Shared by the success
 * path and the invalid-input path so a malformed payload still produces the spec §2.5 `ok:false`
 * Result artifact (R7).
 */
async function writePublishResult(outputPath: string, result: Result): Promise<void> {
    const outDir = dirname(outputPath);
    if (outDir && outDir !== '.') {
        await createNodeFileSystem().ensureDir(outDir);
    }
    await createNodeFileSystem().writeFile(outputPath, JSON.stringify(result, null, 2));
}

/** Parses and routes `options.operation`; unknown or misplaced values fail loud. */
function resolveOperation(options: SurfdashPubOptions): { operation: Operation } | { error: string } {
    const raw = options.operation ?? 'publish';
    if (typeof raw !== 'string' || !OPERATIONS.includes(raw as Operation)) {
        return { error: `invalid options.operation "${String(raw)}": expected one of ${OPERATIONS.join(', ')}` };
    }
    return { operation: raw as Operation };
}

/** `options.postPath` (zh index.md abs path inside the surfdash checkout) is required for the path-scoped operations. */
function resolvePostPath(options: SurfdashPubOptions): { postPath: string } | { error: string } {
    const raw = options.postPath;
    if (typeof raw !== 'string' || raw.trim().length === 0) {
        return { error: `options.postPath is required for the "${String(options.operation)}" operation` };
    }
    const postPath = raw.trim();
    if (!isAbsolute(postPath)) {
        return { error: `options.postPath must be an absolute path inside the surfdash checkout: ${postPath}` };
    }
    return { postPath };
}

/**
 * Containment guard (review fix #1): `resolve(postPath)` must land inside the resolved surfdash
 * checkout — both CLI-backed operations spawn with cwd=surfdashRoot, so a relative or
 * `..`-escaping path would otherwise be existence-checked against one base and executed against
 * another (or act outside the checkout entirely). Array argv + no shell already rule out argv
 * injection; this closes path traversal. Returns the fail-loud error text, or undefined when inside.
 */
function postPathOutsideRoot(postPath: string, surfdashRoot: string): string | undefined {
    const root = resolve(surfdashRoot);
    if (!resolve(postPath).startsWith(root + sep)) {
        return `options.postPath must resolve inside the surfdash checkout (${root}): ${postPath}`;
    }
    return undefined;
}

/** `options.target` must be one of the scaffoldable locales — no default, fail loud. */
function resolveScaffoldTarget(options: SurfdashPubOptions): { locale: ScaffoldLocale } | { error: string } {
    const raw = options.target;
    if (typeof raw !== 'string' || !SCAFFOLD_LOCALES.includes(raw as ScaffoldLocale)) {
        return {
            error: `options.target is required for the "scaffold-locale" operation: expected one of ${SCAFFOLD_LOCALES.join(', ')}`,
        };
    }
    return { locale: raw as ScaffoldLocale };
}

/**
 * Derives the locale draft path from the zh post path: the last `/zh/` segment becomes
 * `/<locale>/` (`content/posts/articles/zh/<slug>/index.md` → `.../<locale>/<slug>/index.md`).
 * Returns undefined when the path carries no `/zh/` segment (caller fails loud).
 */
function deriveLocaleDraftPath(postPath: string, locale: ScaffoldLocale): string | undefined {
    const marker = `${sep}zh${sep}`;
    const idx = postPath.lastIndexOf(marker);
    if (idx < 0) {
        return undefined;
    }
    return `${postPath.slice(0, idx)}${sep}${locale}${sep}${postPath.slice(idx + marker.length)}`;
}

/**
 * Resolves the surfdash checkout root: `SURFDASH_ROOT` explicitly, or derived from a
 * `POSTSURFING_BIN` path inside the checkout (`<root>/scripts/<cli>`). Returns undefined
 * when neither channel yields a root — every operation fails loud on undefined.
 */
function resolveSurfdashRoot(): string | undefined {
    const postsurfingBin = process.env.POSTSURFING_BIN ?? 'postsurfing';
    return (
        process.env.SURFDASH_ROOT ??
        (postsurfingBin.includes('/') ? resolve(dirname(dirname(postsurfingBin))) : undefined)
    );
}

/** Spawn result shared by the CLI-backed operations. */
interface CliSpawnResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

/** One spawn helper for every CLI-backed operation (postsurfing publish / sd translate / orchestrator sync). */
async function spawnCli(cmd: string[], cwd: string): Promise<CliSpawnResult> {
    // postsurfing runs a nested spur workflow in the surfdash repo; a kk publish3 step shell carries
    // the engine's single-flight guard vars, and the guard would refuse that nested run. Same
    // escape the kk-daily-ai-voice3 safety node uses for its intentional nesting.
    const env = { ...process.env };
    for (const key of ['SPUR_WORKFLOW_RUN_ACTIVE', 'SPUR_EXPECTED_DEFINITION_DIGEST']) delete env[key];
    const proc = Bun.spawn(cmd, {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
        env,
    });
    const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    return { exitCode, stdout, stderr };
}

/** Error text for a failed CLI spawn — both streams concatenated: postsurfing streams the
 * failing stage's API error (e.g. 401 INVALID_TOKEN) on stdout while bun stacks land on stderr. */
function cliErrorText(spawned: CliSpawnResult): string {
    return [spawned.stderr.trim(), spawned.stdout.trim()].filter((part) => part !== '').join('\n') || 'Unknown error';
}

/** The EmDash CMS token in kk config expires periodically; map the API's 401 to the fix. */
export function withEmdashTokenHint(errText: string): string {
    return /INVALID_TOKEN|API error 401/.test(errText)
        ? `${errText} — hint: regenerate the EmDash token (surfing.salty.vip admin console) and update EMDASH_API_TOKEN in ~/.config/kk/config.yaml`
        : errText;
}

/**
 * Post-conditions the site guarantees after its publishing pipeline ran.
 *
 * The publisher does not derive SEO metadata any more (ADR-008): surfdash's refine step owns
 * `refined`, `seo_title`, `canonical` and the digest title/description. Verifying the marker
 * here turns a silently-regressed site pipeline into a loud publisher failure instead of a post
 * that ships with a date-only title — which is exactly how the 2026-10-21 regression went
 * unnoticed.
 */
export interface RefinedSnapshot {
    title?: string;
    seoTitle?: string;
    description?: string;
    canonical?: string;
}

/** Reads the frontmatter scalar fields the site owns; undefined when refine never ran. */
export function readRefinedSnapshot(filePath: string): RefinedSnapshot | undefined {
    if (!existsSync(filePath)) return undefined;
    const raw = readFileSync(filePath, 'utf-8');
    const block = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const fm = block?.[1] ?? '';
    if (!fm || !/^refined:\s*true$/m.test(fm)) return undefined;
    const read = (key: string): string | undefined => {
        const m = fm.match(new RegExp(`^${key}:\\s*(?:>-?\n((?:[ \\t]+.*\n?)+)|(.*))$`, 'm'));
        if (!m) return undefined;
        const value = (m[1] ?? m[2] ?? '').replace(/\n[ \t]+/g, ' ').trim();
        return value.replace(/^["']|["']$/g, '') || undefined;
    };
    return {
        title: read('title'),
        seoTitle: read('seo_title'),
        description: read('description'),
        canonical: read('canonical'),
    };
}

/** Error text when the site pipeline did not mark the post refined, else undefined. */
export function requireRefined(filePath: string): string | undefined {
    if (readRefinedSnapshot(filePath)) return undefined;
    return `surfdash refine step did not run for ${filePath} (no \`refined: true\`): the publishing pipeline is broken — the post would ship with generator-supplied SEO metadata`;
}

/**
 * Post-refine digest contract gate (2026-10-24): `requireRefined` proves refine ran; this proves
 * the refined values still satisfy the digest contract. Returns the fail-loud error text, or
 * undefined when ok / downgraded. `SURFDASH_DIGEST_CHECK=warn` echoes each problem and continues.
 */
export function digestCheckGate(filePath: string, locale: DigestLocale): string | undefined {
    if (process.env.SURFDASH_DIGEST_CHECK === 'off') return undefined;
    const problems = checkDigestFrontmatter(readFileSync(filePath, 'utf-8'), locale);
    if (problems.length === 0) return undefined;
    if (process.env.SURFDASH_DIGEST_CHECK === 'warn') {
        for (const problem of problems) echoError(`digest check (warn): ${problem}`);
        return undefined;
    }
    return `digest frontmatter check failed: ${problems.join('; ')}`;
}

/**
 * Every locale file of one post that exists on disk, in `PATCH_LOCALES` order.
 * The locale is the last `zh`/`en`/`ja` directory in the path; no such segment → []
 * (a path outside the locale tree has no set to check).
 */
function localeSiblings(postPath: string): Array<{ filePath: string; locale: DigestLocale }> {
    const segments = postPath.split(sep);
    let index = -1;
    for (let i = segments.length - 1; i >= 0; i--) {
        if (segments[i] === 'zh' || segments[i] === 'en' || segments[i] === 'ja') {
            index = i;
            break;
        }
    }
    if (index < 0) return [];
    return PATCH_LOCALES.map((locale) => ({
        filePath: [...segments.slice(0, index), locale, ...segments.slice(index + 1)].join(sep),
        locale,
    }));
}

/**
 * Digest gate over the whole locale set instead of the primary file alone (2026-11-16, GH #191).
 *
 * An untranslated sibling — the zh title, description and key points sitting under `/en/` or `/ja/`
 * — passes a zh-only check here and then fails the site's check-digest three ways: the locale's own
 * series name, the body language, and the regenerated-frontmatter drift. `sync` hands all three
 * locales to the CMS and a prepared publish commits all three, so every existing file is checked.
 * Missing files stay skipped (the pre-translation `prepare` path has no siblings yet), and
 * `SURFDASH_DIGEST_CHECK` keeps governing the gate itself.
 */
export function digestCheckLocaleSet(postPath: string): string | undefined {
    for (const { filePath, locale } of localeSiblings(postPath)) {
        if (!existsSync(filePath)) continue;
        const problem = digestCheckGate(filePath, locale);
        if (problem) return `${locale}: ${problem}`;
    }
    return undefined;
}

/**
 * Helper to parse file paths from `git status --porcelain` output.
 */
function parsePorcelainPaths(stdout: string): string[] {
    return stdout
        .split('\n')
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 3)
        .map((line) => {
            const raw = line.slice(3).trim();
            const arrowIdx = raw.indexOf(' -> ');
            const target = arrowIdx >= 0 ? raw.slice(arrowIdx + 4).trim() : raw;
            if (target.startsWith('"') && target.endsWith('"')) {
                return target.slice(1, -1);
            }
            return target;
        })
        .filter((p) => p.length > 0);
}

/**
 * Runs the surfdash listen-link backfill command (`bun run sd seo listen-link --backfill --write`)
 * with cwd = `surfdashRoot` via `spawnCli`.
 *
 * Scans recent non-draft digest posts and links the podcast episode URL when live.
 * Best-effort: non-zero exit is reported via `echoError` prefixed with `listen-link backfill:`
 * and never throws or fails publish/patch.
 *
 * Returns relative paths under `content/posts` modified by the backfill, by diffing
 * `git status --porcelain -- content/posts` before and after the run.
 * Skipped when `SURFDASH_LISTEN_BACKFILL=off`.
 */
export async function runListenLinkBackfill(surfdashRoot: string): Promise<string[]> {
    if (process.env.SURFDASH_LISTEN_BACKFILL === 'off') {
        return [];
    }

    const before = await spawnCli(['git', 'status', '--porcelain', '--', 'content/posts'], surfdashRoot);
    const beforePaths = new Set(parsePorcelainPaths(before.stdout));

    const spawned = await spawnCli(['bun', 'run', 'sd', 'seo', 'listen-link', '--backfill', '--write'], surfdashRoot);
    if (spawned.exitCode !== 0) {
        echoError(`listen-link backfill: ${cliErrorText(spawned)}`);
    }

    const after = await spawnCli(['git', 'status', '--porcelain', '--', 'content/posts'], surfdashRoot);
    const afterPaths = parsePorcelainPaths(after.stdout);

    return [...new Set(afterPaths.filter((p) => !beforePaths.has(p)))];
}

/** Outcome of {@link runDailyTopicsSync} — `paths` are checkout-relative for the commit pathspec. */
export type DailyTopicsSyncOutcome = { ok: true; paths: string[] } | { ok: false; error: string };

/** Paths the sync's git diff watches: the map file plus everything the retitle may rewrite. */
const DAILY_TOPICS_GIT_PATHS = ['scripts/seo/daily-topics.json', 'content/posts'] as const;

/**
 * Maps a digest post's three refined locale posts into the site's daily-topics map and runs
 * the site's retitle over them (`bun run sd seo retitle --write --stamp-claims`).
 *
 * Skips (ok, no paths, logged) when the post is not a digest or not all of zh/en/ja `index.md`
 * exist — the site gate still validates whatever the posts already carry. A failing entry build
 * or retitle run returns `{ ok: false }` so the caller never commits or pushes. Returns the map
 * file plus every path the retitle changed, for the commit pathspec.
 */
export async function runDailyTopicsSync(surfdashRoot: string, zhPostPath: string): Promise<DailyTopicsSyncOutcome> {
    const enPath = localeIndexPath(zhPostPath, 'en');
    const jaPath = localeIndexPath(zhPostPath, 'ja');
    if (enPath === undefined || jaPath === undefined) {
        echoError(`daily-topics sync: skipped — ${zhPostPath} is not a zh locale post path`);
        return { ok: true, paths: [] };
    }
    if (!existsSync(zhPostPath)) {
        echoError(`daily-topics sync: skipped — zh post is missing: ${zhPostPath}`);
        return { ok: true, paths: [] };
    }
    const zhPost = readFileSync(zhPostPath, 'utf-8');
    if (!isDigestMarkdown(zhPost)) {
        echoError(`daily-topics sync: skipped — not a digest post (no ${DIGEST_TAG} tag): ${zhPostPath}`);
        return { ok: true, paths: [] };
    }
    if (!existsSync(enPath) || !existsSync(jaPath)) {
        echoError(
            `daily-topics sync: skipped — locale index.md missing (en=${existsSync(enPath)} ja=${existsSync(jaPath)}): ${zhPostPath}`,
        );
        return { ok: true, paths: [] };
    }
    const slug = slugFromPostPath(zhPostPath);
    if (slug === undefined) {
        return { ok: false, error: `daily-topics sync failed: cannot derive slug from ${zhPostPath}` };
    }
    const built = buildDailyTopicsEntry({
        zh: zhPost,
        en: readFileSync(enPath, 'utf-8'),
        ja: readFileSync(jaPath, 'utf-8'),
    });
    if (!built.ok) {
        return { ok: false, error: `daily-topics sync failed: ${built.error}` };
    }
    const mapPath = join(surfdashRoot, 'scripts', 'seo', 'daily-topics.json');
    const before = await spawnCli(['git', 'status', '--porcelain', '--', ...DAILY_TOPICS_GIT_PATHS], surfdashRoot);
    const beforePaths = new Set(parsePorcelainPaths(before.stdout));
    try {
        await upsertDailyTopicsEntry(mapPath, slug, built.entry);
    } catch (error: unknown) {
        return {
            ok: false,
            error: `daily-topics sync failed: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
    const retitle = await spawnCli(['bun', 'run', 'sd', 'seo', 'retitle', '--write', '--stamp-claims'], surfdashRoot);
    if (retitle.exitCode !== 0) {
        return {
            ok: false,
            error: `daily-topics sync failed: bun run sd seo retitle --write --stamp-claims (exit ${retitle.exitCode}): ${cliErrorText(retitle)}`,
        };
    }
    const after = await spawnCli(['git', 'status', '--porcelain', '--', ...DAILY_TOPICS_GIT_PATHS], surfdashRoot);
    const changed = parsePorcelainPaths(after.stdout).filter((p) => !beforePaths.has(p));
    return { ok: true, paths: [...new Set([relative(surfdashRoot, mapPath), ...changed])] };
}

/** Outcome of {@link runSiteGate}. */
export type SiteGateOutcome = { ok: true } | { ok: false; error: string };

/**
 * Commands executed by the surfdash site gate before commit and push to main.
 *
 * This list must stay equal to the content suite surfdash's own deploy gate runs
 * (`bun run check:all` = check:content + check:body + check:seo) plus the digest reporter.
 * It used to stop at `check:content`, so a body-rule violation or a localized cover asset that
 * `check:seo` reports as `image-asset-missing` passed here and failed the site's CI right after
 * the push (GH #191, `docs(articles): add more articles`, 2026-11-15).
 */
const SITE_GATE_COMMANDS: readonly (readonly string[])[] = [
    ['bun', 'run', 'sd', 'check', 'digest'],
    ['bun', 'run', 'check:content'],
    ['bun', 'run', 'check:body'],
    ['bun', 'run', 'check:seo'],
];

/**
 * Extracts a failing post hint (path or identifier) from CLI error output if detectable.
 */
export function extractFailingPostHint(text: string): string | undefined {
    const match = text.match(/(?:content[\\/])?posts[\\/][^\s:)]+/);
    if (!match) return undefined;
    return match[0].replace(/[.,;]+$/, '');
}

function extractPostDates(paths: readonly string[]): Set<string> {
    const dates = new Set<string>();
    for (const p of paths) {
        const m = p.replaceAll('\\', '/').match(/(?:^|\/)posts\/articles\/(?:zh|en|ja)\/(\d{8})-/);
        if (m?.[1]) dates.add(m[1]);
    }
    return dates;
}

function isUnrelatedDatePostFailure(output: string, ownedPaths: readonly string[]): boolean {
    const ownedDates = extractPostDates(ownedPaths);
    if (ownedDates.size === 0) return false;
    const failingHints = [...output.matchAll(/(?:content[\\/])?posts[\\/][^\s:)]+/g)].map((m) =>
        m[0].replace(/[.,;]+$/, ''),
    );
    if (failingHints.length === 0) return false;
    for (const hint of failingHints) {
        const m = hint.replaceAll('\\', '/').match(/(?:^|\/)posts\/articles\/(?:zh|en|ja)\/(\d{8})-/);
        if (!m?.[1] || ownedDates.has(m[1])) return false;
    }
    return true;
}

/** The checkout's current branch name, or '' when git fails (the caller keeps its existing behavior). */
async function checkoutBranch(surfdashRoot: string): Promise<string> {
    const branch = await spawnCli(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], surfdashRoot);
    return branch.exitCode === 0 ? branch.stdout.trim() : '';
}

/**
 * Runs the surfdash site gates (`bun run sd check digest` then `bun run check:content`)
 * with cwd = `surfdashRoot` via `spawnCli`.
 *
 * Fail-closed on main pushes: when the checkout is on `main` and this run will push
 * (`SURFDASH_AUTO_PUSH !== '0'`), a failing gate ALWAYS returns `{ ok: false }` — the
 * `warn` / unrelated-date escape hatch logs that it was ignored (this is a push to main)
 * plus the gate output and failing-post hint, and `off` still runs the gate instead of
 * skipping it.
 *
 * Otherwise:
 * - With `SURFDASH_DIGEST_CHECK=warn` (or when every failing post belongs to an unrelated date
 *   outside `ownedPaths`): echoes each line of the failure via `echoError` prefixed with
 *   `site gate (warn):` and continues.
 * - With `SURFDASH_DIGEST_CHECK=off`: skips the gate completely.
 * - Default (unset or any other value): fails loud with command, trimmed output, and post hint.
 */
export async function runSiteGate(surfdashRoot: string, ownedPaths: readonly string[] = []): Promise<SiteGateOutcome> {
    const pushingToMain = process.env.SURFDASH_AUTO_PUSH !== '0' && (await checkoutBranch(surfdashRoot)) === 'main';
    if (process.env.SURFDASH_DIGEST_CHECK === 'off') {
        if (pushingToMain) {
            echoError(
                'site gate: SURFDASH_DIGEST_CHECK=off ignored — this run pushes to surfdash main, so the gate runs fail-closed',
            );
        } else {
            return { ok: true };
        }
    }

    for (const cmd of SITE_GATE_COMMANDS) {
        const spawned = await spawnCli([...cmd], surfdashRoot);
        if (spawned.exitCode !== 0) {
            const output = cliErrorText(spawned);
            const postHint = extractFailingPostHint(output);
            const hint = postHint ? ` [failing post: ${postHint}]` : '';
            const error = `site gate failed: ${cmd.join(' ')} (exit ${spawned.exitCode})${hint}: ${output}`;
            const escapable =
                process.env.SURFDASH_DIGEST_CHECK === 'warn' || isUnrelatedDatePostFailure(output, ownedPaths);
            if (escapable && pushingToMain) {
                echoError(
                    'site gate: warn/unrelated-date escape hatch ignored because this run pushes to surfdash main — failing closed (set SURFDASH_AUTO_PUSH=0 to skip the push entirely)',
                );
                for (const line of error.split('\n')) {
                    echoError(`site gate (blocked): ${line}`);
                }
                return { ok: false, error };
            }
            if (escapable) {
                for (const line of error.split('\n')) {
                    echoError(`site gate (warn): ${line}`);
                }
                continue;
            }
            return { ok: false, error };
        }
    }
    return { ok: true };
}

/** Outcome of {@link pushPostGit} — the union keeps fail-loud errors typed at the call site. */
export type GitPushOutcome = { ok: true; hash: string } | { ok: false; error: string };

/**
 * Commits the published post path and pushes to the remote. Production deploys run
 * from surfdash's `deploy.yml` on every push to `main` — the publishing FSM itself
 * never touches git, so without this step the article 404s until a manual commit.
 * Committing with a pathspec (`git commit -- <path>`) keeps unrelated staged files
 * out of the publish commit. Fails loud on branch/commit/push errors.
 */
export async function pushPostGit(
    surfdashRoot: string,
    relPostDir: string | string[],
    message: string,
    extraPaths: string[] = [],
): Promise<GitPushOutcome> {
    const rawPaths = Array.isArray(relPostDir) ? [...relPostDir, ...extraPaths] : [relPostDir, ...extraPaths];
    const paths = [...new Set(rawPaths)];
    return commitPostPaths(surfdashRoot, paths, message);
}
/** Refuse a checkout that cannot deploy before anything is written (`deploy.yml` builds `main` only). */
async function assertMainBranch(surfdashRoot: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const branch = await spawnCli(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], surfdashRoot);
    if (branch.exitCode !== 0) return { ok: false, error: `surfdash git branch check failed: ${cliErrorText(branch)}` };
    const branchName = branch.stdout.trim();
    if (branchName !== 'main') {
        return {
            ok: false,
            error: `surfdash checkout is on '${branchName}', not 'main' — deploy.yml only builds main; refusing to push from a feature branch`,
        };
    }
    return { ok: true };
}

/**
 * Fast-forward the checkout onto `origin/main` before anything is written (2026-10-22).
 *
 * Three consecutive publish days failed with `! [rejected] main -> main (fetch first)`: this
 * checkout sat behind a remote another machine had pushed to, so the publish commit landed on a
 * stale base and the push was rejected — after the article had already been written and committed,
 * and after the podcast episode had already published, so the run closed `partial`/`failed` while a
 * real episode was live. A fast-forward is lossless (HEAD moves only when local carries no commit of
 * its own), which is exactly the case here; a DIVERGED checkout is the operator's call and fails
 * loud with both counts. An unreachable remote is not fatal: the fetch error is swallowed so the
 * push below reports the real reason.
 */
export async function fastForwardToOrigin(surfdashRoot: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const fetched = await spawnCli(['git', 'fetch', '--quiet', 'origin', 'main'], surfdashRoot);
    if (fetched.exitCode !== 0) return { ok: true };
    const counts = await spawnCli(['git', 'rev-list', '--left-right', '--count', 'origin/main...HEAD'], surfdashRoot);
    if (counts.exitCode !== 0) return { ok: true };
    const [behindRaw = '0', aheadRaw = '0'] = counts.stdout.trim().split(/\s+/);
    const behind = Number(behindRaw);
    const ahead = Number(aheadRaw);
    if (!Number.isFinite(behind) || !Number.isFinite(ahead) || behind === 0) return { ok: true };
    if (ahead > 0) {
        return {
            ok: false,
            error: `surfdash checkout diverged from origin/main (${ahead} local, ${behind} remote commit(s)): reconcile it by hand before publishing`,
        };
    }
    const merged = await spawnCli(['git', 'merge', '--ff-only', '--quiet', 'origin/main'], surfdashRoot);
    if (merged.exitCode !== 0) {
        return { ok: false, error: `surfdash fast-forward to origin/main failed: ${cliErrorText(merged)}` };
    }
    echoError(`surfdash: fast-forwarded ${behind} commit(s) to origin/main before writing`);
    return { ok: true };
}

/**
 * Commits several paths of the surfdash checkout and pushes them to `main` — the plural form of
 * {@link pushPostGit} the post-patch needs (it writes the posts and any copied cover). Same
 * pathspec-scoped commit, so unrelated staged work is never swept in, and the same idempotent retry:
 * content identical to HEAD stages nothing and only pushes when `origin/main` lacks the paths.
 */
export async function commitPostPaths(
    surfdashRoot: string,
    relPaths: string[],
    message: string,
    push = true,
): Promise<GitPushOutcome> {
    if (relPaths.length === 0) return { ok: true, hash: 'unchanged' };
    const branch = await assertMainBranch(surfdashRoot);
    if (!branch.ok) return branch;
    const base = await fastForwardToOrigin(surfdashRoot);
    if (!base.ok) return base;
    const add = await spawnCli(['git', 'add', '--', ...relPaths], surfdashRoot);
    if (add.exitCode !== 0) return { ok: false, error: `surfdash git add failed: ${cliErrorText(add)}` };
    const staged = await spawnCli(['git', 'diff', '--cached', '--quiet', '--', ...relPaths], surfdashRoot);
    if (staged.exitCode === 0) {
        if (!push) {
            const hash = await spawnCli(['git', 'rev-parse', '--short', 'HEAD'], surfdashRoot);
            return { ok: true, hash: hash.stdout.trim() || 'unknown' };
        }
        const unpushed = await spawnCli(
            ['git', 'diff', '--quiet', 'origin/main..HEAD', '--', ...relPaths],
            surfdashRoot,
        );
        if (unpushed.exitCode === 0) {
            const hash = await spawnCli(['git', 'rev-parse', '--short', 'HEAD'], surfdashRoot);
            return { ok: true, hash: hash.stdout.trim() || 'unknown' };
        }
    } else {
        const commit = await spawnCli(['git', 'commit', '-m', message, '--', ...relPaths], surfdashRoot);
        if (commit.exitCode !== 0) return { ok: false, error: `surfdash git commit failed: ${cliErrorText(commit)}` };
    }
    if (!push) {
        const hash = await spawnCli(['git', 'rev-parse', '--short', 'HEAD'], surfdashRoot);
        return { ok: true, hash: hash.stdout.trim() || 'unknown' };
    }
    const pushed = await spawnCli(['git', 'push', 'origin', 'main'], surfdashRoot);
    if (pushed.exitCode !== 0) {
        return {
            ok: false,
            error: `surfdash git push failed (deploy.yml deploys on push to main): ${cliErrorText(pushed)}`,
        };
    }
    const hash = await spawnCli(['git', 'rev-parse', '--short', 'HEAD'], surfdashRoot);
    return { ok: true, hash: hash.stdout.trim() || 'unknown' };
}

/**
 * Polls the article URL until the CDN serves it (deploy.yml build latency). Push
 * acceptance is the authoritative publish signal, so an unverified URL is reported
 * in the result message rather than failing the publish.
 */
export async function awaitArticleLive(url: string, timeoutMs = 180_000, intervalMs = 10_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const resp = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(5_000) });
            if (resp.ok) return true;
        } catch {
            // network blips during CI deploy — keep polling until the deadline
        }
        await Bun.sleep(intervalMs);
    }
    return false;
}

/**
 * Scaffolds a locale draft for an existing zh post (L1 R7 / 0096): runs the surfdash
 * `sd translate` scaffold CLI inside the surfdash checkout, copies the post's `assets/`
 * dir into the draft dir when present, and returns the draft path in `metadata.draftPath`.
 * No LLM translation happens here — the workflow's agent step edits the returned draft.
 */
async function scaffoldLocale(options: SurfdashPubOptions): Promise<Result> {
    const postPath = resolvePostPath(options);
    if ('error' in postPath) return fail(postPath.error);
    const target = resolveScaffoldTarget(options);
    if ('error' in target) return fail(target.error);

    const surfdashRoot = resolveSurfdashRoot();
    if (!surfdashRoot) {
        return fail('SURFDASH_ROOT is required when POSTSURFING_BIN is not a path inside the surfdash checkout');
    }
    const outsideRoot = postPathOutsideRoot(postPath.postPath, surfdashRoot);
    if (outsideRoot) return fail(outsideRoot);
    if (!existsSync(postPath.postPath)) {
        return fail(`options.postPath does not exist: ${postPath.postPath}`);
    }
    const draftPath = deriveLocaleDraftPath(postPath.postPath, target.locale);
    if (!draftPath) {
        return fail(
            `options.postPath must be a zh post path containing a "${sep}zh${sep}" segment: ${postPath.postPath}`,
        );
    }

    try {
        const force = options.force === true;
        const spawned = await spawnCli(
            [
                'bun',
                'run',
                'sd',
                'translate',
                postPath.postPath,
                '--source',
                'zh',
                '--target',
                target.locale,
                ...(force ? ['--force'] : []),
            ],
            surfdashRoot,
        );
        if (spawned.exitCode !== 0) {
            return fail(`sd translate failed (exit ${spawned.exitCode}): ${cliErrorText(spawned)}`);
        }
        if (!existsSync(draftPath)) {
            return fail(`sd translate reported success but the draft is missing: ${draftPath}`);
        }
        const assetsDir = join(dirname(postPath.postPath), 'assets');
        if (existsSync(assetsDir)) {
            await cp(assetsDir, join(dirname(draftPath), 'assets'), { recursive: true });
        }
        return ResultSchema.parse({
            ok: true,
            target: TARGET,
            message: `Scaffolded ${target.locale} draft at ${draftPath}`,
            metadata: { draftPath, postPath: postPath.postPath, target: target.locale },
        });
    } catch (error: unknown) {
        return fail(`scaffold-locale transport error: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Runs the surfdash publish-orchestrator sync for a post (L1 R7 / 0096): spawns
 * `bun scripts/publish-orchestrator.ts sync <postPath>` inside the surfdash checkout
 * and returns ok/fail with stderr on failure.
 */
/**
 * Deterministic frontmatter normalization for locale siblings before CMS sync
 * (2026-09-16 hreflang feedback): the site's alternates builder reads published
 * disk siblings, so each non-primary locale must end `draft: false` and must not
 * carry a stale cross-locale `canonical` (the translation agent sometimes copies
 * zh frontmatter verbatim). Line-based — no YAML lib in this plugin. Backstop
 * for the agent prompt; safe because sync always runs after the agent's edit.
 */
export function normalizeLocaleFrontmatter(markdown: string): string {
    // Frontmatter-only rewrite (R3). The previous implementation filtered empty lines across the
    // WHOLE document, deleting every blank line in the body — that is the sync corruption. Only
    // the head between the opening and closing `---` is rewritten here; `split`/`join` on '\n'
    // round-trips the rest of the document byte-for-byte.
    const lines = markdown.split('\n');
    if (lines[0]?.trim() !== '---') return markdown;
    const close = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
    if (close < 0) return markdown;
    const head = lines
        .slice(1, close)
        // Only the zh scaffold's canonical is stale; a sibling's own (refined) canonical must survive,
        // or the orchestrator re-dumps the frontmatter and the byte-exact drift gate fails.
        .filter((l) => !/^canonical\s*:.*\/zh\//.test(l))
        .map((l) => (/^draft\s*:/.test(l) ? 'draft: false' : l));
    return [lines[0], ...head, ...lines.slice(close)].join('\n');
}

async function syncPost(options: SurfdashPubOptions): Promise<Result> {
    const postPath = resolvePostPath(options);
    if ('error' in postPath) return fail(postPath.error);

    const surfdashRoot = resolveSurfdashRoot();
    if (!surfdashRoot) {
        return fail('SURFDASH_ROOT is required when POSTSURFING_BIN is not a path inside the surfdash checkout');
    }
    const outsideRoot = postPathOutsideRoot(postPath.postPath, surfdashRoot);
    if (outsideRoot) return fail(outsideRoot);

    // Normalize en/ja siblings (draft flag + stale canonical) before the orchestrator syncs them.
    for (const locale of ['en', 'ja'] as const) {
        const sibling = deriveLocaleDraftPath(postPath.postPath, locale);
        if (!sibling || !existsSync(sibling)) continue;
        const normalized = normalizeLocaleFrontmatter(readFileSync(sibling, 'utf-8'));
        if (normalized !== readFileSync(sibling, 'utf-8')) {
            await writeFile(sibling, normalized);
            echoError(`sync: normalized frontmatter for ${locale} sibling: ${sibling}`);
        }
    }

    try {
        const spawned = await spawnCli(
            ['bun', 'scripts/publish-orchestrator.ts', 'sync', postPath.postPath],
            surfdashRoot,
        );
        if (spawned.exitCode !== 0) {
            return fail(
                `publish-orchestrator sync failed (exit ${spawned.exitCode}): ${withEmdashTokenHint(cliErrorText(spawned))}`,
            );
        }
        // Digest contract (2026-10-24; locale set 2026-11-16): the orchestrator syncs all three
        // locale files to the CMS, so verify the synced post AND its siblings. Paths outside
        // content/posts/articles/<zh|en|ja>/ carry no digest series to check.
        if (/[\\/]content[\\/]posts[\\/]articles[\\/](?:zh|en|ja)[\\/]/.test(postPath.postPath)) {
            const digestProblem = digestCheckLocaleSet(postPath.postPath);
            if (digestProblem) return fail(digestProblem);
        }
        return ResultSchema.parse({
            ok: true,
            target: TARGET,
            message: 'publish-orchestrator sync completed',
            metadata: { postPath: postPath.postPath },
        });
    } catch (error: unknown) {
        return fail(`sync transport error: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/** `options.<key>` when it is a string, trimmed; else ''. `patch`'s four optional fields read this way. */
function strOption(
    options: SurfdashPubOptions,
    key: 'coverUrl' | 'showNotesUrl' | 'localCover' | 'dateIso' | 'episodeTitle',
): string {
    const raw = options[key];
    return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * `patch` — post-publish healing for one published episode (2026-10-12; moved here from the kk stage
 * `daily-patch-surfdash`, which owned the publisher's work): the podcast-hosted cover URL in
 * `image`/`og_image`, the per-locale podcast cross-link, the local cover's `assets/` fallback, the
 * EmDash re-sync that makes CMS cards carry a servable image, then a pathspec commit + push.
 *
 * Ordering is load-bearing: the branch guard runs before anything is written (a checkout that cannot
 * deploy must not be patched, and the failure leaves the tree untouched), and the re-sync runs even
 * when no file changed, so a re-run heals rows an earlier run left stale.
 */
async function patchPost(options: SurfdashPubOptions): Promise<Result> {
    const postPath = resolvePostPath(options);
    if ('error' in postPath) return fail(postPath.error);
    const surfdashRoot = resolveSurfdashRoot();
    if (!surfdashRoot) {
        return fail('SURFDASH_ROOT is required when POSTSURFING_BIN is not a path inside the surfdash checkout');
    }
    const outsideRoot = postPathOutsideRoot(postPath.postPath, surfdashRoot);
    if (outsideRoot) return fail(outsideRoot);
    const branch = await assertMainBranch(surfdashRoot);
    if (!branch.ok) return fail(branch.error);

    let outcome: PatchPostOutcome;
    try {
        outcome = await patchPostFiles({
            postPath: postPath.postPath,
            coverUrl: strOption(options, 'coverUrl'),
            showNotesUrl: strOption(options, 'showNotesUrl'),
            localCover: strOption(options, 'localCover'),
            dateIso: strOption(options, 'dateIso'),
            episodeTitle: strOption(options, 'episodeTitle'),
        });
    } catch (error: unknown) {
        return fail(`patch error: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (outcome.changed === 0) echoError(`patch: no post bytes changed for ${outcome.slug}`);
    // Daily-topics map + retitle run before the CMS sync so the synced rows carry the retitled
    // frontmatter; a failure here must not commit or push a half-synced post.
    const topics = await runDailyTopicsSync(surfdashRoot, postPath.postPath);
    if (!topics.ok) return fail(topics.error);
    const synced = await syncPost({ postPath: postPath.postPath });
    const commitPaths = new Set(outcome.written.map((path) => relative(surfdashRoot, path)));
    for (const p of topics.paths) commitPaths.add(p);
    for (const locale of PATCH_LOCALES) {
        const indexMd = localeIndexPath(postPath.postPath, locale);
        if (!indexMd) continue;
        const assetsDir = join(dirname(indexMd), 'assets');
        if (existsSync(assetsDir)) {
            commitPaths.add(relative(surfdashRoot, assetsDir));
        }
    }
    if (process.env.SURFDASH_AUTO_PUSH !== '0') {
        const backfilled = await runListenLinkBackfill(surfdashRoot);
        for (const p of backfilled) commitPaths.add(p);
        const gate = await runSiteGate(surfdashRoot, [...commitPaths, relative(surfdashRoot, postPath.postPath)]);
        if (!gate.ok) return fail(gate.error);
    }
    const commit = await commitPostPaths(
        surfdashRoot,
        [...commitPaths],
        `feat: cover + podcast cross-link for ${outcome.slug} (kk daily patch)`,
        process.env.SURFDASH_AUTO_PUSH !== '0',
    );
    if (!commit.ok) return fail(`patch: ${commit.error}`);
    const metadata = {
        postPath: postPath.postPath,
        changed: outcome.changed,
        locales: Object.keys(outcome.images),
        absentLocales: outcome.absent,
        cmsResync: synced.ok ? 'ok' : 'failed',
        gitCommit: commit.hash,
    };
    if (!synced.ok) {
        // The posts are patched and committed; only the CMS rows keep the unservable cover. Reported
        // as a failure so the completeness report says `cms-resync=failed`, with `metadata.cmsResync`
        // letting the caller treat it as the soft channel it is.
        return ResultSchema.parse({
            ok: false,
            target: TARGET,
            error: `cms re-sync failed: ${synced.error ?? 'ok=false'}`,
            metadata,
        });
    }
    return ResultSchema.parse({
        ok: true,
        target: TARGET,
        message: `patched ${outcome.changed} post(s) for ${outcome.slug}`,
        metadata,
    });
}

interface PreparedPost {
    surfdashRoot: string;
    locale: SupportedLocale;
    dateStamp: string;
    slug: string;
    filePath: string;
    relPostDir: string;
    /** Prepared daily publishes carry all translated sibling directories into the deploy commit. */
    relPostDirs?: string[];
    articleUrl: string;
}

interface PreparedLocaleIdentity {
    runDate: string;
    postPath: string;
    localePaths: Record<SupportedLocale, string>;
    localeDigests: Record<SupportedLocale, string>;
    fingerprint: string;
}

function fileSha256(filePath: string): string {
    return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/**
 * Computes the exact identity used by the daily locale gate. This is intentionally derived from
 * bytes on disk immediately before the remote publishing FSM starts; a cached result must never
 * satisfy a different slug, payload, or translated-locale set.
 */
function preparedLocaleIdentity(
    postPath: string,
    runDate: string,
): { ok: true; value: PreparedLocaleIdentity } | { ok: false; error: string } {
    const enPath = deriveLocaleDraftPath(postPath, 'en');
    const jaPath = deriveLocaleDraftPath(postPath, 'ja');
    if (enPath === undefined || jaPath === undefined) {
        return { ok: false, error: `prepared zh post path must contain a "/zh/" locale segment: ${postPath}` };
    }
    const localePaths: Record<SupportedLocale, string> = { zh: postPath, en: enPath, ja: jaPath };
    const localeDigests = {} as Record<SupportedLocale, string>;
    for (const locale of ['zh', 'en', 'ja'] as const) {
        const path = localePaths[locale];
        if (!existsSync(path)) return { ok: false, error: `${locale} locale file is missing: ${path}` };
        try {
            localeDigests[locale] = fileSha256(path);
        } catch (error: unknown) {
            return {
                ok: false,
                error: `${locale} locale file cannot be fingerprinted: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }
    const identity = { runDate, postPath, localePaths, localeDigests };
    return {
        ok: true,
        value: { ...identity, fingerprint: createHash('sha256').update(JSON.stringify(identity)).digest('hex') },
    };
}

interface PreparedLocaleSet {
    surfdashRoot: string;
    runDate: string;
    postPath: string;
    slug: string;
    localePaths: Record<SupportedLocale, string>;
}

/**
 * Resolves the exact three-file daily post set without writing anything. Both the local refine
 * phase and the final prepared publish use this guard so they cannot drift to different slugs or
 * locale siblings between validation and dispatch.
 */
function resolvePreparedLocaleSet(
    options: SurfdashPubOptions,
): { ok: true; value: PreparedLocaleSet } | { ok: false; result: Result } {
    const postPath = resolvePostPath(options);
    if ('error' in postPath) return { ok: false, result: failNotSent(postPath.error) };
    const surfdashRoot = resolveSurfdashRoot();
    if (!surfdashRoot) {
        return {
            ok: false,
            result: failNotSent(
                'SURFDASH_ROOT is required when POSTSURFING_BIN is not a path inside the surfdash checkout',
            ),
        };
    }
    const outsideRoot = postPathOutsideRoot(postPath.postPath, surfdashRoot);
    if (outsideRoot) return { ok: false, result: failNotSent(outsideRoot) };
    if (!existsSync(postPath.postPath))
        return { ok: false, result: failNotSent(`prepared post does not exist: ${postPath.postPath}`) };
    const runDate = options.runDate;
    if (typeof runDate !== 'string' || !/^\d{8}$/.test(runDate)) {
        return { ok: false, result: failNotSent(`options.runDate must be YYYYMMDD, got '${String(runDate)}'`) };
    }
    const articlesRoot = resolve(surfdashRoot, 'content', 'posts', 'articles');
    const relativePost = relative(articlesRoot, postPath.postPath);
    const parts = relativePost.split(sep);
    const slug = parts[1];
    if (parts.length !== 3 || parts[0] !== 'zh' || parts[2] !== 'index.md' || slug === undefined || slug === '') {
        return {
            ok: false,
            result: failNotSent(
                `options.postPath must be content/posts/articles/zh/<slug>/index.md: ${postPath.postPath}`,
            ),
        };
    }
    const enPath = deriveLocaleDraftPath(postPath.postPath, 'en');
    const jaPath = deriveLocaleDraftPath(postPath.postPath, 'ja');
    if (enPath === undefined || jaPath === undefined) {
        return {
            ok: false,
            result: failNotSent(`prepared zh post path must contain a "/zh/" locale segment: ${postPath.postPath}`),
        };
    }
    const localePaths: Record<SupportedLocale, string> = { zh: postPath.postPath, en: enPath, ja: jaPath };
    for (const locale of ['zh', 'en', 'ja'] as const) {
        if (!existsSync(localePaths[locale])) {
            return { ok: false, result: failNotSent(`${locale} locale file is missing: ${localePaths[locale]}`) };
        }
    }
    return { ok: true, value: { surfdashRoot, runDate, postPath: postPath.postPath, slug, localePaths } };
}

function resolvePreparedPost(
    options: SurfdashPubOptions,
): { ok: true; prepared: PreparedPost; identity: PreparedLocaleIdentity } | { ok: false; result: Result } {
    const resolved = resolvePreparedLocaleSet(options);
    if (!resolved.ok) return resolved;
    const { surfdashRoot, runDate, postPath: preparedPath, slug } = resolved.value;
    const expectedPostSha256 = options.expectedPostSha256;
    if (typeof expectedPostSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(expectedPostSha256)) {
        return { ok: false, result: failNotSent('options.expectedPostSha256 must be a lowercase SHA-256 digest') };
    }
    const expectedLocaleFingerprint = options.expectedLocaleFingerprint;
    if (typeof expectedLocaleFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(expectedLocaleFingerprint)) {
        return {
            ok: false,
            result: failNotSent('options.expectedLocaleFingerprint must be a lowercase SHA-256 digest'),
        };
    }
    const identity = preparedLocaleIdentity(preparedPath, runDate);
    if (!identity.ok) return { ok: false, result: failNotSent(identity.error) };
    if (identity.value.localeDigests.zh !== expectedPostSha256) {
        return {
            ok: false,
            result: failNotSent(`prepared zh post bytes changed after validation: ${preparedPath}`),
        };
    }
    if (identity.value.fingerprint !== expectedLocaleFingerprint) {
        return {
            ok: false,
            result: failNotSent(
                'prepared locale files changed after validation; refresh the locale gate before publishing',
            ),
        };
    }
    const baseUrl = (process.env.SURFDASH_URL ?? 'https://surfing.salty.vip').replace(/\/$/, '');
    return {
        ok: true,
        prepared: {
            surfdashRoot,
            locale: 'zh',
            dateStamp: runDate,
            slug,
            filePath: preparedPath,
            relPostDir: join('content', 'posts', 'articles', 'zh', slug),
            relPostDirs: ['zh', 'en', 'ja'].map((locale) => join('content', 'posts', 'articles', locale, slug)),
            articleUrl: `${baseUrl}/zh/posts/${slug}`,
        },
        identity: identity.value,
    };
}

type PrepareOutcome = { ok: true; prepared: PreparedPost } | { ok: false; result: Result };

/** The non-primary locales a digest post carries (`metadata.surfdash.locales`); zh is the primary. */
const LOCAL_DRAFTS = ['en', 'ja'] as const;

/** One localized sibling's authored text, as the workflow's `localize` step delivers it. */
interface LocaleDraft {
    title: string;
    body: string;
}

/**
 * Reads `metadata.surfdash.locales.{en,ja}` off the article Content (0409 Q&A: the payload shape the
 * localize step and the article variant agree on). A blank title or body is not a locale: an
 * untranslated file must read as missing, so the digest refusal fires instead of publishing zh
 * text under `/en/` or `/ja/`.
 */
function readLocaleDrafts(content: Content): Partial<Record<(typeof LOCAL_DRAFTS)[number], LocaleDraft>> {
    const drafts: Partial<Record<(typeof LOCAL_DRAFTS)[number], LocaleDraft>> = {};
    const surfdash = content.metadata?.surfdash;
    if (typeof surfdash !== 'object' || surfdash === null) return drafts;
    const locales = (surfdash as Record<string, unknown>).locales;
    if (typeof locales !== 'object' || locales === null) return drafts;
    for (const locale of LOCAL_DRAFTS) {
        const entry = (locales as Record<string, unknown>)[locale];
        if (typeof entry !== 'object' || entry === null) continue;
        const { title, body } = entry as Record<string, unknown>;
        if (typeof title !== 'string' || title.trim() === '') continue;
        if (typeof body !== 'string' || body.trim() === '') continue;
        drafts[locale] = { title, body };
    }
    return drafts;
}

/**
 * Mints one locale's `index.md` (frontmatter + body) and copies the cover into its `assets/`.
 *
 * A file the site's own refine step already marked is not ours to clobber: re-minting replaces the
 * refined frontmatter (`refined`, `seo_title`, …) with generator defaults and flips a published day
 * back to a draft — so a refined file is kept and reused (2026-11-05 tier-0 rerun).
 */
async function mintLocalePost(options: {
    postDir: string;
    content: Content;
    coverPath?: string;
    publishDate?: string;
}): Promise<void> {
    const filePath = join(options.postDir, 'index.md');
    if (readRefinedSnapshot(filePath) !== undefined) {
        echoError(`surfdash-pub: keeping existing refined post at ${filePath} (not re-minting)`);
        return;
    }
    await createNodeFileSystem().ensureDir(options.postDir);
    let imageFrontmatter: string | undefined;
    if (options.coverPath !== undefined) {
        const assetsDir = join(options.postDir, 'assets');
        await createNodeFileSystem().ensureDir(assetsDir);
        const coverName = `cover${extname(options.coverPath).toLowerCase()}`;
        await copyFile(options.coverPath, join(assetsDir, coverName));
        imageFrontmatter = `./assets/${coverName}`;
    }
    const markdown = mapContentToSurfingMarkdown(options.content, {
        image: imageFrontmatter,
        publishDate: options.publishDate,
    });
    await createNodeFileSystem().writeFile(filePath, markdown);
}

/**
 * Materializes the local post without invoking the external publishing FSM.
 *
 * Locale scaffolding and translation must happen before Surfdash's strict sync gate runs. The
 * normal `publish` operation uses the same preparation path before refine, CMS sync and deploy.
 */
async function preparePost(payload: PublishTransportPayload): Promise<PrepareOutcome> {
    const surfdashRoot = resolveSurfdashRoot();
    if (!surfdashRoot) {
        return {
            ok: false,
            result: failNotSent(
                'SURFDASH_ROOT is required when POSTSURFING_BIN is not a path inside the surfdash checkout',
            ),
        };
    }

    const rawLocale = process.env.SURFDASH_LOCALE ?? 'zh';
    if (!['zh', 'en', 'ja'].includes(rawLocale)) {
        return { ok: false, result: failNotSent(`SURFDASH_LOCALE must be one of zh/en/ja, got '${rawLocale}'`) };
    }
    const locale = rawLocale as SupportedLocale;
    // dateStamp source: explicit metadata.runDate, else the payload's own metadata.date —
    // never the wall clock, which around midnight local time mints `tomorrow` slugs.
    const runDate =
        typeof payload.content.metadata?.runDate === 'string' && payload.content.metadata.runDate !== ''
            ? payload.content.metadata.runDate
            : typeof payload.content.metadata?.date === 'string'
              ? payload.content.metadata.date.replaceAll('-', '')
              : '';
    const dateStamp = runDate || new Date().toISOString().slice(0, 10).replaceAll('-', '');
    const titleSlug = slugify(payload.content.title ?? '');
    const slug = titleSlug ? `${dateStamp}-${titleSlug}` : `${dateStamp}-post`;
    if (runDate !== '' && !/^\d{8}$/.test(runDate)) {
        return { ok: false, result: failNotSent(`metadata.runDate must be YYYYMMDD, got '${runDate}'`) };
    }
    const articlesRoot = resolve(surfdashRoot, 'content', 'posts', 'articles');
    const localeRoot = resolve(articlesRoot, locale);
    const postDir = resolve(localeRoot, slug);
    if (dirname(localeRoot) !== articlesRoot || dirname(postDir) !== localeRoot) {
        return { ok: false, result: failNotSent(`post path escapes ${articlesRoot}`) };
    }

    const coverPath = payload.content.metadata?.coverImage;
    if (typeof coverPath === 'string' && !existsSync(coverPath)) {
        return { ok: false, result: failNotSent(`metadata.coverImage not found: ${coverPath}`) };
    }
    if (typeof coverPath === 'string' && !COVER_EXTS.has(extname(coverPath).toLowerCase())) {
        return {
            ok: false,
            result: failNotSent(`metadata.coverImage must be one of ${[...COVER_EXTS].join(', ')}`),
        };
    }
    if (isDigestContent(payload.content) && typeof coverPath !== 'string') {
        return { ok: false, result: failNotSent('digest post has no cover image (metadata.coverImage)') };
    }

    // 0409 R2: the site requires the full locale set for a digest before it will sync
    // (`publish-orchestrator.ts` `discoverLocaleFiles` + the `sub-category:ai-daily` guard), so a
    // missing translation is refused here with effect none — never as the site's opaque
    // "missing locale file(s)" failure after the spawn.
    const drafts = readLocaleDrafts(payload.content);
    if (isDigestContent(payload.content)) {
        const missing = LOCAL_DRAFTS.filter((locale) => drafts[locale] === undefined);
        if (missing.length > 0) {
            return {
                ok: false,
                result: failNotSent(
                    `digest post is missing metadata.surfdash.locales for ${missing.join(', ')} — the site refuses a digest with a missing locale file; re-run the localize step before publishing`,
                ),
            };
        }
    }

    const filePath = join(postDir, 'index.md');
    const publishDate = runDate ? `${runDate.slice(0, 4)}-${runDate.slice(4, 6)}-${runDate.slice(6, 8)}` : undefined;
    const cover = typeof coverPath === 'string' ? coverPath : undefined;
    try {
        // A post the site's own refine step already marked is not ours to clobber: re-minting it
        // replaces the refined canonical frontmatter (refine owns `refined`, `seo_title`, …) with
        // generator defaults and flips an already-published day back to a draft. Keep the file and
        // reuse it; only genuinely fresh days (no marker) get minted (2026-11-05 tier-0 rerun).
        await mintLocalePost({ postDir, content: payload.content, coverPath: cover, publishDate });
        for (const locale of LOCAL_DRAFTS) {
            const draft = drafts[locale];
            if (draft === undefined) continue;
            const siblingDir = resolve(articlesRoot, locale, slug);
            if (dirname(resolve(siblingDir)) !== resolve(articlesRoot, locale)) {
                return { ok: false, result: failNotSent(`post path escapes ${articlesRoot}`) };
            }
            // The zh Body and title are replaced by the translation; the frontmatter fields the
            // site owns (refined, seo_title, …) are rewritten by its own refine/retitle, exactly as
            // for zh — so a locale file is the same Content shape with a localized title/body.
            await mintLocalePost({
                postDir: siblingDir,
                content: { ...payload.content, title: draft.title, body: draft.body },
                coverPath: cover,
                publishDate,
            });
        }
    } catch (err: unknown) {
        return {
            ok: false,
            result: failNotSent(
                `Surfdash post preparation failed: ${err instanceof Error ? err.message : String(err)}`,
            ),
        };
    }

    const baseUrl = (process.env.SURFDASH_URL ?? 'https://surfing.salty.vip').replace(/\/$/, '');
    const articleUrl = `${baseUrl}${locale === 'en' ? '' : `/${locale}`}/posts/${slug}`;
    return {
        ok: true,
        prepared: {
            surfdashRoot,
            locale,
            dateStamp,
            slug,
            filePath,
            relPostDir: join('content', 'posts', 'articles', locale, slug),
            articleUrl,
        },
    };
}

/** `prepare` operation: write the local post and return its path for locale scaffolding. */
async function preparePostResult(payload: PublishTransportPayload): Promise<Result> {
    const outcome = await preparePost(payload);
    if (!outcome.ok) return outcome.result;
    return ResultSchema.parse({
        ok: true,
        target: TARGET,
        message: `Prepared ${outcome.prepared.locale} post at ${outcome.prepared.filePath}`,
        metadata: {
            postPath: outcome.prepared.filePath,
            articleUrl: outcome.prepared.articleUrl,
            dateStamp: outcome.prepared.dateStamp,
            slug: outcome.prepared.slug,
        },
    });
}

/** Invokes the remote publishing FSM for an already-materialized post path. */
async function publishPreparedFile(
    prepared: PreparedPost,
    identity?: Pick<PreparedLocaleIdentity, 'runDate' | 'fingerprint'> & { postSha256?: string },
): Promise<Result> {
    const postsurfingBin = process.env.POSTSURFING_BIN ?? 'postsurfing';
    const { surfdashRoot, locale, dateStamp, filePath, relPostDir, relPostDirs, articleUrl } = prepared;
    const identityMetadata = identity
        ? {
              runDate: identity.runDate,
              localeFingerprint: identity.fingerprint,
              ...(identity.postSha256 ? { postSha256: identity.postSha256 } : {}),
          }
        : {};

    try {
        const spawned = await spawnCli([postsurfingBin, 'publish', filePath], surfdashRoot);

        if (spawned.exitCode !== 0) {
            return failUncertain(
                `postsurfing CLI failed (exit ${spawned.exitCode}): ${withEmdashTokenHint(cliErrorText(spawned))}`,
            );
        }

        // The real Surfdash FSM runs its own refine step before CMS sync. The daily workflow runs
        // site-owned refine locally first, so this must be idempotent; otherwise the remote phase
        // would silently mutate the bytes whose fingerprint admitted this publish. Treat any
        // mutation as uncertain because CMS/git may already have side effects.
        if (identity !== undefined) {
            const afterRemote = preparedLocaleIdentity(filePath, identity.runDate);
            if (!afterRemote.ok)
                return failUncertain(`prepared locale files changed after remote publish: ${afterRemote.error}`);
            if (
                afterRemote.value.fingerprint !== identity.fingerprint ||
                (identity.postSha256 !== undefined && afterRemote.value.localeDigests.zh !== identity.postSha256)
            ) {
                return failUncertain('prepared locale files changed after remote publish; reconcile before retrying');
            }
        }

        // Contract check (ADR-008): the site, not this plugin, owns SEO metadata.
        const notRefined = requireRefined(filePath);
        if (notRefined) return failUncertain(notRefined);
        // Digest contract (2026-10-24; locale set 2026-11-16): the refined values themselves must
        // hold for every locale this publish commits, before any push.
        const digestProblem = digestCheckLocaleSet(filePath);
        if (digestProblem) return failUncertain(digestProblem);
        const refined = readRefinedSnapshot(filePath);

        // Deploy seam: commit + push the post so deploy.yml builds it, then wait for
        // the live URL — downstream show-notes advertise a real page, not a 404.
        // Tests (and offline runs) opt out via SURFDASH_AUTO_PUSH=0.
        // URL shape mirrors surfdash's localePathPrefix (surfdash/src/lib/seo.ts):
        // en is served at the site root, zh/ja carry a /<locale> prefix. Composing
        // /<locale>/posts/<slug> unconditionally 404s en posts.
        if (process.env.SURFDASH_AUTO_PUSH === '0') {
            return ResultSchema.parse({
                ok: true,
                target: TARGET,
                url: articleUrl,
                message: 'Published via postsurfing CLI (auto-push disabled)',
                // Absolute post path lets downstream steps (locale translation + CMS sync)
                // derive the surfdash checkout root without extra configuration.
                metadata: {
                    postPath: filePath,
                    ...identityMetadata,
                    refinedTitle: refined?.title,
                    refinedCanonical: refined?.canonical,
                },
            });
        }
        const topics = await runDailyTopicsSync(surfdashRoot, filePath);
        if (!topics.ok) return failUncertain(topics.error);
        const backfilled = await runListenLinkBackfill(surfdashRoot);
        const commitPaths = relPostDirs ?? [relPostDir];
        const gate = await runSiteGate(surfdashRoot, [...commitPaths, ...backfilled, ...topics.paths]);
        if (!gate.ok) return failUncertain(gate.error);
        const commitLocales: SupportedLocale[] = relPostDirs === undefined ? [locale] : ['zh', 'en', 'ja'];
        const pushed = await pushPostGit(
            surfdashRoot,
            commitPaths,
            `content: daily AI news ${dateStamp} (${commitLocales.join(', ')})`,
            [...backfilled, ...topics.paths],
        );
        if (!pushed.ok) return failUncertain(pushed.error);
        const live = await awaitArticleLive(articleUrl);

        return ResultSchema.parse({
            ok: true,
            target: TARGET,
            url: articleUrl,
            message: live
                ? 'Published, committed, pushed, and live on the site'
                : 'Published and pushed; URL not live within the verify window — check the surfdash deploy workflow',
            metadata: {
                postPath: filePath,
                ...identityMetadata,
                gitCommit: pushed.hash,
                live,
                refinedTitle: refined?.title,
            },
        });
    } catch (err: unknown) {
        return failUncertain(`Postsurfing transport error: ${err instanceof Error ? err.message : String(err)}`);
    }
}

/**
 * Publish path (behavior unchanged since E3): maps Content into surfdash markdown under
 * `content/posts/<collection>/<locale>/<slug>/index.md` and invokes the postsurfing CLI.
 */
async function publishPost(payload: PublishTransportPayload): Promise<Result> {
    const outcome = await preparePost(payload);
    if (!outcome.ok) return outcome.result;
    return publishPreparedFile(outcome.prepared);
}

/**
 * Runs the site-owned refine command over zh/en/ja without CMS, git, or remote effects. The daily
 * workflow fingerprints only after this operation; the real publish FSM can then revisit refine
 * idempotently instead of rewriting a validated locale set during its remote phase.
 */
async function refinePreparedPost(options: SurfdashPubOptions): Promise<Result> {
    const resolved = resolvePreparedLocaleSet(options);
    if (!resolved.ok) return resolved.result;
    const orchestrator = join(resolved.value.surfdashRoot, 'scripts', 'publish-orchestrator.ts');
    if (!existsSync(orchestrator)) return failNotSent(`Surfdash refine orchestrator is missing: ${orchestrator}`);
    try {
        for (const locale of ['zh', 'en', 'ja'] as const) {
            const filePath = resolved.value.localePaths[locale];
            const spawned = await spawnCli(
                [process.execPath, orchestrator, 'refine', filePath],
                resolved.value.surfdashRoot,
            );
            if (spawned.exitCode !== 0) {
                return failNotSent(
                    `Surfdash refine failed for ${locale} (exit ${spawned.exitCode}): ${cliErrorText(spawned)}`,
                );
            }
            const notRefined = requireRefined(filePath);
            if (notRefined) return failNotSent(notRefined);
            const digestProblem = digestCheckGate(filePath, locale);
            if (digestProblem) return failNotSent(digestProblem);
        }
    } catch (error: unknown) {
        return failNotSent(
            `Surfdash refine transport error: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    const identity = preparedLocaleIdentity(resolved.value.postPath, resolved.value.runDate);
    if (!identity.ok) return failNotSent(identity.error);
    return ResultSchema.parse({
        ok: true,
        target: TARGET,
        message: 'Refined zh/en/ja via the Surfdash-owned orchestrator',
        metadata: {
            postPath: resolved.value.postPath,
            runDate: resolved.value.runDate,
            localePaths: identity.value.localePaths,
            localeDigests: identity.value.localeDigests,
            localeFingerprint: identity.value.fingerprint,
        },
    });
}

/**
 * Final daily voice2 operation. Unlike `publish`, this never maps Content or rewrites the prepared
 * zh post. It verifies the exact validated bytes and locale fingerprint immediately before invoking
 * postsurfing, so a regenerated same-day payload cannot silently replace the validated material.
 */
async function publishPreparedPost(options: SurfdashPubOptions): Promise<Result> {
    const outcome = resolvePreparedPost(options);
    if (!outcome.ok) return outcome.result;
    return publishPreparedFile(outcome.prepared, {
        runDate: outcome.identity.runDate,
        fingerprint: outcome.identity.fingerprint,
        postSha256: outcome.identity.localeDigests.zh,
    });
}

/**
 * FileCli transport invoking postsurfing CLI for `publish` (default) and the
 * prepared-path / `scaffold-locale` / `sync` surfdash mechanics via `options.operation` (L1 R7).
 */
export class PostsurfingFileCliTransport implements PublishTransport {
    public readonly kind = 'file-cli';

    public async publish(payload: PublishTransportPayload): Promise<Result> {
        const options: SurfdashPubOptions =
            payload.options !== undefined && typeof payload.options === 'object' && payload.options !== null
                ? (payload.options as SurfdashPubOptions)
                : {};

        const routed = resolveOperation(options);
        if ('error' in routed) return fail(routed.error);

        switch (routed.operation) {
            case 'prepare':
                return preparePostResult(payload);
            case 'refine-prepared':
                return refinePreparedPost(options);
            case 'publish-prepared':
                return publishPreparedPost(options);
            case 'scaffold-locale':
                return scaffoldLocale(options);
            case 'sync':
                return syncPost(options);
            case 'patch':
                return patchPost(options);
            case 'publish':
                return publishPost(payload);
        }
    }
}

/**
 * Resolves default PublishTransport based on environment configuration.
 */
export function getPublishTransport(): PublishTransport {
    if (process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake') {
        const { FakeFileCliTransport } = require('@gobing-ai/publish-harness');
        return new FakeFileCliTransport();
    }
    return new PostsurfingFileCliTransport();
}

/**
 * Processes input Content and writes output Result via transport.
 *
 * The input JSON may carry a top-level `options` object (`operation`, `postPath`, `target`, and
 * prepared-path identity fields) alongside the Content fields; it is forwarded to the transport so
 * `kk executor run` callers can select locale/publish mechanics without extra flags (0096).
 */
export async function processPublishIO(
    inputPath: string,
    outputPath: string,
    transport: PublishTransport = getPublishTransport(),
): Promise<void> {
    await createNodeFileSystem().deleteFile(outputPath);
    const rawInput = await createNodeFileSystem().readFile(inputPath);
    // A malformed payload must yield the spec §2.5 `ok:false` Result and a non-zero exit, not an
    // uncaught SyntaxError (R7 — the other publishers were built from a template with this catch).
    let raw: Record<string, unknown>;
    let content: Content;
    try {
        raw = JSON.parse(rawInput) as Record<string, unknown>;
        content = ContentSchema.parse(raw);
    } catch (error: unknown) {
        const message = `Invalid Content input: ${error instanceof Error ? error.message : String(error)}`;
        await writePublishResult(outputPath, fail(message));
        throw new Error(message);
    }
    const options =
        raw.options !== undefined && typeof raw.options === 'object' && raw.options !== null
            ? (raw.options as Record<string, unknown>)
            : undefined;

    const result = await transport.publish({ content, options });
    const validatedResult = ResultSchema.parse(result);

    await writePublishResult(outputPath, validatedResult);

    if (!validatedResult.ok) {
        throw new Error(validatedResult.error ?? 'Publish failed');
    }
}

export async function main(): Promise<number> {
    const { values } = parseArgs({
        options: {
            in: { type: 'string' },
            out: { type: 'string' },
        },
    });

    if (!values.in || !values.out) {
        echoError('Missing required arguments: --in and --out');
        return 1;
    }

    try {
        await processPublishIO(values.in, values.out);
        return 0;
    } catch (error: unknown) {
        echoError(`surfdash-pub failed: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
