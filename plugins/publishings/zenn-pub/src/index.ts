import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Result, ResultSchema } from '@gobing-ai/kk-core';
import { FakeFileCliTransport, type PublishTransport, type PublishTransportPayload } from '@gobing-ai/publish-harness';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';

/**
 * Pinned `zenn-cli` version. `npx <name>` resolves the npm package *named* `<name>`, and the
 * package `zenn` was unpublished on 2021-04-20 — so `npx zenn` fails (or worse, runs whatever a
 * future republisher ships, with `--yes` suppressing the prompt). `--package` names the real
 * package explicitly.
 */
const ZENN_CLI_VERSION = '0.5.4';

/**
 * Converts a string into a lowercase hyphenated tag (slug) per the publish spec tags convention.
 */
export function slugify(str: string): string {
    return str
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/[\s_]+/g, '-');
}

/**
 * Generates a Zenn article slug from a title.
 *
 * Zenn slugs must be lowercase letters, numbers, hyphens, and underscores,
 * with a minimum length of 12 characters (audited from wt-publish-to-zenn).
 */
export function generateZennSlug(title: string): string {
    let slug = title
        .toLowerCase()
        .replace(/[^\w\s-]/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();
    slug = slug.replace(/^-+|-+$/g, '');
    if (slug.length < 12) {
        // Timestamp suffix keeps generated slugs unique; an all-punctuation title
        // collapses to an empty base, so drop the separator hyphen and pad to the
        // 12-char minimum — generated slugs must always satisfy ZENN_SLUG_PATTERN.
        slug = `${slug}-${Date.now().toString(36)}`.replace(/^-+/, '');
        if (slug.length < 12) {
            slug = slug.padEnd(12, '0');
        }
    }
    if (slug.length > 100) {
        slug = slug.substring(0, 100);
    }
    return slug;
}

const ZENN_SLUG_PATTERN = /^[a-z0-9-_]{12,100}$/;

/** Resolved Zenn article fields derived from a Content payload. */
interface ZennArticleFields {
    title: string;
    slug: string;
    type: 'tech' | 'idea';
    emoji: string;
    topics: string[];
    published: boolean;
}

/**
 * Resolves Content into Zenn article fields, failing loud on invalid Zenn-specific values.
 */
function resolveArticleFields(content: Content): ZennArticleFields {
    let title = content.title;
    if (!title) {
        const match = content.body.match(/^#\s+(.+)$/m);
        title = match?.[1] ? match[1].trim() : 'Untitled Post';
    }

    const metadata = content.metadata;
    const rawType = metadata?.type;
    let type: 'tech' | 'idea' = 'tech';
    if (rawType !== undefined) {
        if (rawType !== 'tech' && rawType !== 'idea') {
            throw new Error(`Invalid Zenn article type: ${String(rawType)}. Must be 'tech' or 'idea'.`);
        }
        type = rawType;
    }

    const emoji = typeof metadata?.emoji === 'string' && metadata.emoji ? metadata.emoji : '📝';

    const rawTags: unknown[] = Array.isArray(metadata?.tags)
        ? metadata.tags
        : Array.isArray(metadata?.keywords)
          ? metadata.keywords
          : [];
    const topics = rawTags
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t: string) => slugify(t));

    const published = typeof metadata?.published === 'boolean' ? metadata.published : true;

    let slug: string;
    if (typeof metadata?.slug === 'string' && metadata.slug.trim()) {
        slug = metadata.slug.trim();
        if (!ZENN_SLUG_PATTERN.test(slug)) {
            throw new Error(
                `Invalid Zenn slug: "${slug}". Must be lowercase letters, numbers, hyphens, underscores only (12-100 chars)`,
            );
        }
    } else {
        slug = generateZennSlug(title);
    }

    return { title, slug, type, emoji, topics, published };
}

/**
 * Renders Zenn markdown (frontmatter + body) from already-resolved article fields.
 * Splitting from `mapContentToZennMarkdown` lets `publish` resolve fields once
 * so the slug stays stable across the CLI invocation and the article file write.
 */
function renderZennMarkdown(content: Content, fields: ZennArticleFields): string {
    const { title, type, emoji, topics, published, slug } = fields;

    const frontmatter: Record<string, unknown> = { title, type, emoji, topics, published, slug };
    const yamlLines = [
        '---',
        ...Object.entries(frontmatter).map(([key, value]) => {
            if (Array.isArray(value)) {
                return `${key}: [${value.map((v) => JSON.stringify(v)).join(', ')}]`;
            }
            if (typeof value === 'boolean') {
                return `${key}: ${value}`;
            }
            return `${key}: ${JSON.stringify(value)}`;
        }),
        '---',
    ];
    return `${yamlLines.join('\n')}\n\n${content.body.trim()}\n`;
}

/**
 * Maps Content object into Zenn markdown with target frontmatter
 * (title, type, emoji, topics, published, slug) per the publish spec.
 */
export function mapContentToZennMarkdown(content: Content): string {
    return renderZennMarkdown(content, resolveArticleFields(content));
}

/**
 * FileCli transport invoking the Zenn CLI through child processes in the
 * configured Zenn/GitHub repository, mirroring the wt-publish-to-zenn flow.
 */
export class ZennCliFileCliTransport implements PublishTransport {
    public readonly kind = 'file-cli';

    public async publish(payload: PublishTransportPayload): Promise<Result> {
        const content = payload.content;
        const fields = resolveArticleFields(content);
        const { title, slug, type, emoji, published } = fields;
        const markdown = renderZennMarkdown(content, fields);

        const repo = process.env.ZENN_REPO;
        if (!repo) {
            return ResultSchema.parse({
                ok: false,
                target: 'zenn',
                error: 'ZENN_REPO environment variable is required: path to the Zenn/GitHub repository',
            });
        }
        const repoPath = repo.startsWith('~') ? join(homedir(), repo.slice(2)) : repo;
        // Zenn article URLs are `https://zenn.dev/<user>/articles/<slug>`; without the username the
        // path is wrong (it 404s), so omit `url` rather than report a broken link.
        const zennUsername = process.env.ZENN_USERNAME?.trim();

        try {
            await createNodeFileSystem().ensureDir(repoPath);

            const cliArgs = [
                '--yes',
                '--package',
                `zenn-cli@${ZENN_CLI_VERSION}`,
                'zenn',
                'new:article',
                '--slug',
                slug,
                '--title',
                title,
                '--type',
                type,
            ];
            if (emoji) {
                cliArgs.push('--emoji', emoji);
            }
            const [createCode, , createStderr] = await this.runCli('npx', cliArgs, repoPath);
            if (createCode !== 0) {
                return ResultSchema.parse({
                    ok: false,
                    target: 'zenn',
                    error: `Zenn CLI failed (exit ${createCode}): ${createStderr.trim() || 'Unknown error'}`,
                });
            }

            const articleDir = join(repoPath, 'articles');
            await createNodeFileSystem().ensureDir(articleDir);
            const articlePath = join(articleDir, `${slug}.md`);
            await createNodeFileSystem().writeFile(articlePath, markdown);

            if (published) {
                const articleRel = `articles/${slug}.md`;
                const gitSteps: string[][] = [
                    ['rev-parse', '--abbrev-ref', 'HEAD'],
                    ['add', '--', articleRel],
                    ['commit', '-m', `Add article: ${title}`, '--', articleRel],
                    ['push', 'origin', 'main'],
                ];
                for (const gitArgs of gitSteps) {
                    const [code, stdout, stderr] = await this.runCli('git', gitArgs, repoPath);
                    if (code !== 0) {
                        return ResultSchema.parse({
                            ok: false,
                            target: 'zenn',
                            error: `git ${gitArgs.join(' ')} failed (exit ${code}): ${stderr.trim() || 'Unknown error'}`,
                        });
                    }
                    if (gitArgs[0] === 'rev-parse' && stdout.trim() !== 'main') {
                        return ResultSchema.parse({
                            ok: false,
                            target: 'zenn',
                            error: `Zenn repo is on branch '${stdout.trim()}', not 'main' — Zenn deploys from main; refusing to commit`,
                        });
                    }
                }
            }

            return ResultSchema.parse({
                ok: true,
                target: 'zenn',
                url: zennUsername ? `https://zenn.dev/${zennUsername}/articles/${slug}` : undefined,
                id: slug,
                message: `${
                    published
                        ? 'Published to Zenn via Zenn CLI (article committed and pushed to GitHub)'
                        : 'Zenn draft article created (published: false; commit and push to deploy)'
                }${zennUsername ? '' : ' (set ZENN_USERNAME to report the article URL)'}`,
            });
        } catch (err: unknown) {
            return ResultSchema.parse({
                ok: false,
                target: 'zenn',
                error: `Zenn transport error: ${err instanceof Error ? err.message : String(err)}`,
            });
        }
    }

    private async runCli(cmd: string, args: string[], cwd: string): Promise<[number, string, string]> {
        const proc = Bun.spawn([cmd, ...args], { cwd, env: process.env, stdout: 'pipe', stderr: 'pipe' });
        const [exitCode, stdout, stderr] = await Promise.all([
            proc.exited,
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
        ]);
        return [exitCode, stdout, stderr];
    }
}

/**
 * Resolves default PublishTransport based on environment configuration.
 */
export function getPublishTransport(): PublishTransport {
    if (process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake') {
        return new FakeFileCliTransport();
    }
    return new ZennCliFileCliTransport();
}

/**
 * Writes a Result JSON to the output path, creating the directory as needed.
 */
async function writePublishResult(outputPath: string, result: Result): Promise<void> {
    const outDir = dirname(outputPath);
    if (outDir && outDir !== '.') {
        await createNodeFileSystem().ensureDir(outDir);
    }
    await createNodeFileSystem().writeFile(outputPath, JSON.stringify(result, null, 2));
}

/**
 * Processes input Content and writes output Result via transport.
 *
 * Validation failure and transport failure both write a fail-loud Result
 * (ok: false + error) to the output path and reject (spec §2.5).
 */
export async function processPublishIO(
    inputPath: string,
    outputPath: string,
    transport: PublishTransport = getPublishTransport(),
): Promise<void> {
    await createNodeFileSystem().deleteFile(outputPath);

    let content: Content;
    try {
        const rawInput = await createNodeFileSystem().readFile(inputPath);
        content = ContentSchema.parse(JSON.parse(rawInput));
    } catch (error: unknown) {
        const message = `Invalid Content input: ${error instanceof Error ? error.message : String(error)}`;
        await writePublishResult(outputPath, ResultSchema.parse({ ok: false, target: 'zenn', error: message }));
        throw new Error(message);
    }

    const result = await transport.publish({ content });
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
        echoError(`zenn-pub failed: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
