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

export { checkDigestFrontmatter, DIGEST_TAG, type DigestLocale } from './digest-check';

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

/** A failed publish is replay-safe only when it was rejected before postsurfing was invoked. */
function failWithDeliveryState(error: string, deliveryState: DeliveryState): Result {
    return ResultSchema.parse({ ok: false, target: TARGET, error, metadata: { deliveryState } });
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
    const proc = Bun.spawn(cmd, {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
        env: process.env,
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
    const problems = checkDigestFrontmatter(readFileSync(filePath, 'utf-8'), locale);
    if (problems.length === 0) return undefined;
    if (process.env.SURFDASH_DIGEST_CHECK === 'warn') {
        for (const problem of problems) echoError(`digest check (warn): ${problem}`);
        return undefined;
    }
    return `digest frontmatter check failed: ${problems.join('; ')}`;
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
export async function pushPostGit(surfdashRoot: string, relPostDir: string, message: string): Promise<GitPushOutcome> {
    return commitPostPaths(surfdashRoot, [relPostDir], message);
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
        .filter((l) => !/^canonical\s*:/.test(l))
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
        // Digest contract (2026-10-24): verify the synced post's frontmatter for its own locale;
        // paths outside content/posts/articles/<zh|en|ja>/ carry no digest series to check.
        const localeInPath = postPath.postPath.match(/[\\/]content[\\/]posts[\\/]articles[\\/](zh|en|ja)[\\/]/);
        if (localeInPath) {
            const digestProblem = digestCheckGate(postPath.postPath, localeInPath[1] as DigestLocale);
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
function strOption(options: SurfdashPubOptions, key: 'coverUrl' | 'showNotesUrl' | 'localCover' | 'dateIso'): string {
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
        });
    } catch (error: unknown) {
        return fail(`patch error: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (outcome.changed === 0) echoError(`patch: no post bytes changed for ${outcome.slug}`);
    const synced = await syncPost({ postPath: postPath.postPath });
    const commitPaths = new Set(outcome.written.map((path) => relative(surfdashRoot, path)));
    for (const locale of PATCH_LOCALES) {
        const indexMd = localeIndexPath(postPath.postPath, locale);
        if (!indexMd) continue;
        const assetsDir = join(dirname(indexMd), 'assets');
        if (existsSync(assetsDir)) {
            commitPaths.add(relative(surfdashRoot, assetsDir));
        }
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
    const runDate = typeof payload.content.metadata?.runDate === 'string' ? payload.content.metadata.runDate : '';
    const today = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    const dateStamp = runDate || today;
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

    const filePath = join(postDir, 'index.md');
    try {
        await createNodeFileSystem().ensureDir(postDir);
        let imageFrontmatter: string | undefined;
        if (typeof coverPath === 'string') {
            const assetsDir = join(postDir, 'assets');
            await createNodeFileSystem().ensureDir(assetsDir);
            const coverName = `cover${extname(coverPath).toLowerCase()}`;
            await copyFile(coverPath, join(assetsDir, coverName));
            imageFrontmatter = `./assets/${coverName}`;
        }
        const markdown = mapContentToSurfingMarkdown(payload.content, {
            image: imageFrontmatter,
            publishDate: runDate ? `${runDate.slice(0, 4)}-${runDate.slice(4, 6)}-${runDate.slice(6, 8)}` : undefined,
        });
        await createNodeFileSystem().writeFile(filePath, markdown);
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
        // Digest contract (2026-10-24): the refined values themselves must hold, before any push.
        const digestProblem = digestCheckGate(filePath, locale);
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
        const commitPaths = relPostDirs ?? [relPostDir];
        const commitLocales: SupportedLocale[] = relPostDirs === undefined ? [locale] : ['zh', 'en', 'ja'];
        const pushed = await commitPostPaths(
            surfdashRoot,
            commitPaths,
            `content: daily AI news ${dateStamp} (${commitLocales.join(', ')})`,
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
