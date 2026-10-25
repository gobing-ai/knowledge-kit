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
 * Environment variables:
 * - `SURFDASH_LISTEN_BACKFILL`:
 *   - `off`: skips the listen-link backfill command.
 * - `SURFDASH_DIGEST_CHECK`:
 *   - unset / default: fail-loud on gate failure; commit and push are blocked.
 *   - `warn`: echoes gate failures via `echoError` prefixed with `site gate (warn):` and continues to push.
 *   - `off`: bypasses the gate check.
 * - `SURFDASH_AUTO_PUSH`:
 *   - '0': disables auto-commit and push (used in tests and offline runs).
 */
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
const OPERATIONS = ['publish', 'scaffold-locale', 'sync', 'patch'] as const;
type Operation = (typeof OPERATIONS)[number];

/** Locales `scaffold-locale` can scaffold; LLM translation stays in the workflow's agent step. */
const SCAFFOLD_LOCALES = ['en', 'ja'] as const;
type ScaffoldLocale = (typeof SCAFFOLD_LOCALES)[number];

/** Cover-image extensions accepted from `metadata.coverImage` (R4): anything else is rejected, not copied. */
const COVER_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

/** Target-specific options carried on the invoke payload's `options` channel. */
interface SurfdashPubOptions {
    operation?: unknown;
    /** zh `index.md` absolute path inside the surfdash tree; required for `scaffold-locale`, `sync` and `patch`. */
    postPath?: unknown;
    /** Draft locale to scaffold; required for `scaffold-locale`. */
    target?: unknown;
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

/** Outcome of {@link runSiteGate}. */
export type SiteGateOutcome = { ok: true } | { ok: false; error: string };

/** Commands executed by the surfdash site gate before commit and push to main. */
const SITE_GATE_COMMANDS: readonly (readonly string[])[] = [
    ['bun', 'run', 'sd', 'check', 'digest'],
    ['bun', 'run', 'check:content'],
];

/**
 * Extracts a failing post hint (path or identifier) from CLI error output if detectable.
 */
export function extractFailingPostHint(text: string): string | undefined {
    const match = text.match(/(?:content[\\/])?posts[\\/][^\s:)]+/);
    if (!match) return undefined;
    return match[0].replace(/[.,;]+$/, '');
}

/**
 * Runs the surfdash site gates (`bun run sd check digest` then `bun run check:content`)
 * with cwd = `surfdashRoot` via `spawnCli`.
 *
 * If either command exits non-zero:
 * - With `SURFDASH_DIGEST_CHECK=warn`: echoes each line of the failure via `echoError`
 *   prefixed with `site gate (warn):` and continues.
 * - With `SURFDASH_DIGEST_CHECK=off`: skips the gate completely.
 * - Default (unset or any other value): fails loud with command, trimmed output, and post hint.
 */
export async function runSiteGate(surfdashRoot: string): Promise<SiteGateOutcome> {
    if (process.env.SURFDASH_DIGEST_CHECK === 'off') {
        return { ok: true };
    }

    for (const cmd of SITE_GATE_COMMANDS) {
        const spawned = await spawnCli([...cmd], surfdashRoot);
        if (spawned.exitCode !== 0) {
            const output = cliErrorText(spawned);
            const postHint = extractFailingPostHint(output);
            const hint = postHint ? ` [failing post: ${postHint}]` : '';
            const error = `site gate failed: ${cmd.join(' ')} (exit ${spawned.exitCode})${hint}: ${output}`;
            if (process.env.SURFDASH_DIGEST_CHECK === 'warn') {
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
        const spawned = await spawnCli(
            ['bun', 'run', 'sd', 'translate', postPath.postPath, '--source', 'zh', '--target', target.locale],
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
    if (process.env.SURFDASH_AUTO_PUSH !== '0') {
        const backfilled = await runListenLinkBackfill(surfdashRoot);
        for (const p of backfilled) commitPaths.add(p);
        const gate = await runSiteGate(surfdashRoot);
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

/**
 * Publish path (behavior unchanged since E3): maps Content into surfdash markdown under
 * `content/posts/<collection>/<locale>/<slug>/index.md` and invokes the postsurfing CLI.
 */
async function publishPost(payload: PublishTransportPayload): Promise<Result> {
    const postsurfingBin = process.env.POSTSURFING_BIN ?? 'postsurfing';

    // The publishing FSM requires the markdown at
    // content/posts/<collection>/<locale>/<slug>/index.md inside the surfdash site tree
    // (its refine step rejects other layouts); the root resolution lives in resolveSurfdashRoot().
    const surfdashRoot = resolveSurfdashRoot();
    if (!surfdashRoot) {
        return fail('SURFDASH_ROOT is required when POSTSURFING_BIN is not a path inside the surfdash checkout');
    }

    const locale = process.env.SURFDASH_LOCALE ?? 'zh';
    // Fail loud on legacy locale codes ('cn' is the pre-migration name for zh) —
    // they'd write a content dir no route serves.
    if (!['zh', 'en', 'ja'].includes(locale)) {
        return fail(`SURFDASH_LOCALE must be one of zh/en/ja, got '${locale}'`);
    }
    // Date-stamped slug (metadata.runDate, e.g. 20260904) keeps same-title daily posts
    // from colliding; Chinese titles slugify to '' and fall back to the bare date.
    const runDate = typeof payload.content.metadata?.runDate === 'string' ? payload.content.metadata.runDate : '';
    const today = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    const dateStamp = runDate || today;
    const titleSlug = slugify(payload.content.title ?? '');
    const slug = titleSlug ? `${dateStamp}-${titleSlug}` : `${dateStamp}-post`;
    // Validate before touching disk (R4): a `metadata.runDate` or slug that escapes the articles
    // tree would write a post outside it, and a non-image `coverImage` would be copied into a post
    // that pushPostGit then publishes to a public repo.
    if (runDate !== '' && !/^\d{8}$/.test(runDate)) {
        return fail(`metadata.runDate must be YYYYMMDD, got '${runDate}'`);
    }
    const articlesRoot = resolve(surfdashRoot, 'content', 'posts', 'articles');
    const localeRoot = resolve(articlesRoot, locale);
    const postDir = resolve(localeRoot, slug);
    if (dirname(localeRoot) !== articlesRoot || dirname(postDir) !== localeRoot) {
        return fail(`post path escapes ${articlesRoot}`);
    }
    const coverPath = payload.content.metadata?.coverImage;
    // R4 + 2026-10-24: a coverImage that does not exist must fail before anything is written —
    // the old silent skip published a coverless post while the run believed it had one.
    if (typeof coverPath === 'string' && !existsSync(coverPath)) {
        return fail(`metadata.coverImage not found: ${coverPath}`);
    }
    if (typeof coverPath === 'string' && !COVER_EXTS.has(extname(coverPath).toLowerCase())) {
        return fail(`metadata.coverImage must be one of ${[...COVER_EXTS].join(', ')}`);
    }
    // Daily digest posts are the series' public face: a missing cover ships a blank OG card.
    // The check uses the same tag sources as mapContentToSurfingMarkdown (contentTags).
    if (isDigestContent(payload.content) && typeof coverPath !== 'string') {
        return fail('digest post has no cover image (metadata.coverImage)');
    }

    await createNodeFileSystem().ensureDir(postDir);

    // Cover image: metadata.coverImage (absolute local path) is copied into the post's
    // assets dir and referenced relatively — the surfdash PostSchema accepts ./assets/<file>.
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
    const filePath = join(postDir, 'index.md');

    try {
        await createNodeFileSystem().writeFile(filePath, markdown);
        const spawned = await spawnCli([postsurfingBin, 'publish', filePath], surfdashRoot);

        if (spawned.exitCode !== 0) {
            return fail(
                `postsurfing CLI failed (exit ${spawned.exitCode}): ${withEmdashTokenHint(cliErrorText(spawned))}`,
            );
        }

        // Contract check (ADR-008): the site, not this plugin, owns SEO metadata.
        const notRefined = requireRefined(filePath);
        if (notRefined) return fail(notRefined);
        // Digest contract (2026-10-24): the refined values themselves must hold, before any push.
        const digestProblem = digestCheckGate(filePath, locale as DigestLocale);
        if (digestProblem) return fail(digestProblem);
        const refined = readRefinedSnapshot(filePath);

        // Deploy seam: commit + push the post so deploy.yml builds it, then wait for
        // the live URL — downstream show-notes advertise a real page, not a 404.
        // Tests (and offline runs) opt out via SURFDASH_AUTO_PUSH=0.
        // URL shape mirrors surfdash's localePathPrefix (surfdash/src/lib/seo.ts):
        // en is served at the site root, zh/ja carry a /<locale> prefix. Composing
        // /<locale>/posts/<slug> unconditionally 404s en posts.
        const baseUrl = (process.env.SURFDASH_URL ?? 'https://surfing.salty.vip').replace(/\/$/, '');
        const articleUrl = `${baseUrl}${locale === 'en' ? '' : `/${locale}`}/posts/${slug}`;
        if (process.env.SURFDASH_AUTO_PUSH === '0') {
            return ResultSchema.parse({
                ok: true,
                target: TARGET,
                url: articleUrl,
                message: 'Published via postsurfing CLI (auto-push disabled)',
                // Absolute post path lets downstream steps (locale translation + CMS sync)
                // derive the surfdash checkout root without extra configuration.
                metadata: { postPath: filePath, refinedTitle: refined?.title, refinedCanonical: refined?.canonical },
            });
        }
        const backfilled = await runListenLinkBackfill(surfdashRoot);
        const gate = await runSiteGate(surfdashRoot);
        if (!gate.ok) return fail(gate.error);
        const relPostDir = join('content', 'posts', 'articles', locale, slug);
        const pushed = await pushPostGit(
            surfdashRoot,
            relPostDir,
            `content: daily AI news ${dateStamp} (zh)`,
            backfilled,
        );
        if (!pushed.ok) return fail(pushed.error);
        const live = await awaitArticleLive(articleUrl);

        return ResultSchema.parse({
            ok: true,
            target: TARGET,
            url: articleUrl,
            message: live
                ? 'Published, committed, pushed, and live on the site'
                : 'Published and pushed; URL not live within the verify window — check the surfdash deploy workflow',
            metadata: { postPath: filePath, gitCommit: pushed.hash, live, refinedTitle: refined?.title },
        });
    } catch (err: unknown) {
        return fail(`Postsurfing transport error: ${err instanceof Error ? err.message : String(err)}`);
    }
}

/**
 * FileCli transport invoking postsurfing CLI for `publish` (default) and the
 * `scaffold-locale` / `sync` surfdash mechanics via `options.operation` (L1 R7).
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
 * The input JSON may carry a top-level `options` object (`operation`, `postPath`,
 * `target`) alongside the Content fields; it is forwarded to the transport so
 * `kk executor run` callers can select scaffold-locale/sync without extra flags
 * (podcast-pub pattern, 0096).
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
