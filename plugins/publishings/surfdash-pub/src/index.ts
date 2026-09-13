import { existsSync } from 'node:fs';
import { copyFile, cp } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Result, ResultSchema } from '@gobing-ai/kk-core';
import type { PublishTransport, PublishTransportPayload } from '@gobing-ai/publish-harness';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';

/** Result target name for this plugin. */
const TARGET = 'surfdash';

/** Management operations routed via `options.operation` (L1 R7; pattern from podcast-pub). */
const OPERATIONS = ['publish', 'scaffold-locale', 'sync'] as const;
type Operation = (typeof OPERATIONS)[number];

/** Locales `scaffold-locale` can scaffold; LLM translation stays in the workflow's agent step. */
const SCAFFOLD_LOCALES = ['en', 'ja'] as const;
type ScaffoldLocale = (typeof SCAFFOLD_LOCALES)[number];

/** Target-specific options carried on the invoke payload's `options` channel. */
interface SurfdashPubOptions {
    operation?: unknown;
    /** zh `index.md` absolute path inside the surfdash tree; required for `scaffold-locale` and `sync`. */
    postPath?: unknown;
    /** Draft locale to scaffold; required for `scaffold-locale`. */
    target?: unknown;
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
 * Maps Content object into Surfing frontmatter and body per the publish spec.
 */
export function mapContentToSurfingMarkdown(content: Content, options: MapContentOptions = {}): string {
    let title = content.title;
    if (!title) {
        const match = content.body.match(/^#\s+(.+)$/m);
        title = match?.[1] ? match[1].trim() : 'Untitled Post';
    }

    let description: string | undefined;
    if (typeof content.metadata?.description === 'string') {
        description = content.metadata.description;
    } else {
        const paragraphs = content.body
            .split(/\n\s*\n/)
            .map((p) => p.replace(/^#+\s+.*$/, '').trim())
            .filter((p) => p.length > 0);
        if (paragraphs.length > 0) {
            description = paragraphs[0];
        }
    }

    const rawTags: unknown[] = Array.isArray(content.metadata?.tags)
        ? content.metadata.tags
        : Array.isArray(content.metadata?.keywords)
          ? content.metadata.keywords
          : [];
    const tags = rawTags
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t: string) => slugify(t));

    const isoDate = options.publishDate ?? new Date().toISOString().slice(0, 10);
    const firstRefUrl = content.references?.[0]?.url;
    const canonical =
        typeof firstRefUrl === 'string'
            ? firstRefUrl
            : typeof content.metadata?.canonicalUrl === 'string'
              ? content.metadata.canonicalUrl
              : undefined;
    const draft = typeof content.metadata?.published === 'boolean' ? !content.metadata.published : false;

    // Strict surfdash PostSchema (surfdash/src/content/schema.ts): publishDate (ISO date) is
    // required; unknown keys (`date`, `canonical_url`, `published`) are rejected.
    const frontmatterObj: Record<string, unknown> = {
        title,
        description: description ?? '',
        tags,
        publishDate: isoDate,
        ...(canonical ? { canonical } : {}),
        draft,
        ...(options.image ? { image: options.image, og_image: options.image } : {}),
    };

    const yamlLines = ['---', ...Object.entries(frontmatterObj).map(([k, v]) => `${k}: ${JSON.stringify(v)}`), '---'];
    return `${yamlLines.join('\n')}\n\n${content.body.trim()}\n`;
}

/** `Result` failure helper: ok false + error (podcast-pub pattern). */
function fail(error: string): Result {
    return ResultSchema.parse({ ok: false, target: TARGET, error });
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
    const branch = await spawnCli(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], surfdashRoot);
    if (branch.exitCode !== 0) return { ok: false, error: `surfdash git branch check failed: ${cliErrorText(branch)}` };
    const branchName = branch.stdout.trim();
    if (branchName !== 'main') {
        return {
            ok: false,
            error: `surfdash checkout is on '${branchName}', not 'main' — deploy.yml only builds main; refusing to push from a feature branch`,
        };
    }
    const add = await spawnCli(['git', 'add', '--', relPostDir], surfdashRoot);
    if (add.exitCode !== 0) return { ok: false, error: `surfdash git add failed: ${cliErrorText(add)}` };
    const commit = await spawnCli(['git', 'commit', '-m', message, '--', relPostDir], surfdashRoot);
    if (commit.exitCode !== 0) return { ok: false, error: `surfdash git commit failed: ${cliErrorText(commit)}` };
    const push = await spawnCli(['git', 'push', 'origin', 'main'], surfdashRoot);
    if (push.exitCode !== 0) {
        return {
            ok: false,
            error: `surfdash git push failed (deploy.yml deploys on push to main): ${cliErrorText(push)}`,
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
async function syncPost(options: SurfdashPubOptions): Promise<Result> {
    const postPath = resolvePostPath(options);
    if ('error' in postPath) return fail(postPath.error);

    const surfdashRoot = resolveSurfdashRoot();
    if (!surfdashRoot) {
        return fail('SURFDASH_ROOT is required when POSTSURFING_BIN is not a path inside the surfdash checkout');
    }
    const outsideRoot = postPathOutsideRoot(postPath.postPath, surfdashRoot);
    if (outsideRoot) return fail(outsideRoot);

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
    // Date-stamped slug (metadata.runDate, e.g. 20260904) keeps same-title daily posts
    // from colliding; Chinese titles slugify to '' and fall back to the bare date.
    const runDate = typeof payload.content.metadata?.runDate === 'string' ? payload.content.metadata.runDate : '';
    const today = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    const dateStamp = runDate || today;
    const titleSlug = slugify(payload.content.title ?? '');
    const slug = titleSlug ? `${dateStamp}-${titleSlug}` : `${dateStamp}-post`;
    const postDir = join(surfdashRoot, 'content', 'posts', 'articles', locale, slug);
    await createNodeFileSystem().ensureDir(postDir);

    // Cover image: metadata.coverImage (absolute local path) is copied into the post's
    // assets dir and referenced relatively — the surfdash PostSchema accepts ./assets/<file>.
    let imageFrontmatter: string | undefined;
    const coverPath = payload.content.metadata?.coverImage;
    if (typeof coverPath === 'string' && existsSync(coverPath)) {
        const assetsDir = join(postDir, 'assets');
        await createNodeFileSystem().ensureDir(assetsDir);
        const coverName = `cover${coverPath.slice(coverPath.lastIndexOf('.'))}`;
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

        // Deploy seam: commit + push the post so deploy.yml builds it, then wait for
        // the live URL — downstream show-notes advertise a real page, not a 404.
        // Tests (and offline runs) opt out via SURFDASH_AUTO_PUSH=0.
        const articleUrl = `${(process.env.SURFDASH_URL ?? 'https://surfing.salty.vip').replace(/\/$/, '')}/${locale}/posts/${slug}`;
        if (process.env.SURFDASH_AUTO_PUSH === '0') {
            return ResultSchema.parse({
                ok: true,
                target: TARGET,
                url: articleUrl,
                message: 'Published via postsurfing CLI (auto-push disabled)',
                // Absolute post path lets downstream steps (locale translation + CMS sync)
                // derive the surfdash checkout root without extra configuration.
                metadata: { postPath: filePath },
            });
        }
        const relPostDir = join('content', 'posts', 'articles', locale, slug);
        const pushed = await pushPostGit(surfdashRoot, relPostDir, `content: daily AI news ${dateStamp} (zh)`);
        if (!pushed.ok) return fail(pushed.error);
        const live = await awaitArticleLive(articleUrl);

        return ResultSchema.parse({
            ok: true,
            target: TARGET,
            url: articleUrl,
            message: live
                ? 'Published, committed, pushed, and live on the site'
                : 'Published and pushed; URL not live within the verify window — check the surfdash deploy workflow',
            metadata: { postPath: filePath, gitCommit: pushed.hash, live },
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
    const raw = JSON.parse(rawInput) as Record<string, unknown>;
    const content = ContentSchema.parse(raw);
    const options =
        raw.options !== undefined && typeof raw.options === 'object' && raw.options !== null
            ? (raw.options as Record<string, unknown>)
            : undefined;

    const result = await transport.publish({ content, options });
    const validatedResult = ResultSchema.parse(result);

    const outDir = dirname(outputPath);
    if (outDir && outDir !== '.') {
        await createNodeFileSystem().ensureDir(outDir);
    }

    await createNodeFileSystem().writeFile(outputPath, JSON.stringify(validatedResult, null, 2));

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
