import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Result, ResultSchema } from '@gobing-ai/kk-core';
import type { PublishTransport, PublishTransportPayload } from '@gobing-ai/publish-harness';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';

/**
 * Options for mapping Content into Surfing Markdown with frontmatter.
 */
export interface MapContentOptions {
    /** Target publishing site name or base URL. Defaults to 'surfdash'. */
    targetName?: string;
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
export function mapContentToSurfingMarkdown(content: Content): string {
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

    const isoDate = new Date().toISOString().slice(0, 10);
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
    };

    const yamlLines = ['---', ...Object.entries(frontmatterObj).map(([k, v]) => `${k}: ${JSON.stringify(v)}`), '---'];
    return `${yamlLines.join('\n')}\n\n${content.body.trim()}\n`;
}

/**
 * FileCli transport invoking postsurfing CLI.
 */
export class PostsurfingFileCliTransport implements PublishTransport {
    public readonly kind = 'file-cli';

    public async publish(payload: PublishTransportPayload): Promise<Result> {
        const markdown = mapContentToSurfingMarkdown(payload.content);
        const postsurfingBin = process.env.POSTSURFING_BIN ?? 'postsurfing';

        // The publishing FSM requires the markdown at
        // content/posts/<collection>/<locale>/<slug>/index.md inside the surfdash site tree
        // (its refine step rejects other layouts). Derive the site root from the bin path
        // (<root>/scripts/<cli>) or take SURFDASH_ROOT explicitly.
        const surfdashRoot =
            process.env.SURFDASH_ROOT ??
            (postsurfingBin.includes('/') ? resolve(dirname(dirname(postsurfingBin))) : undefined);
        if (!surfdashRoot) {
            return ResultSchema.parse({
                ok: false,
                target: 'surfdash',
                error: 'SURFDASH_ROOT is required when POSTSURFING_BIN is not a path inside the surfdash checkout',
            });
        }

        const locale = process.env.SURFDASH_LOCALE ?? 'zh';
        const titleSlug = slugify(payload.content.title ?? '');
        const slug = titleSlug || `post-${new Date().toISOString().slice(0, 10)}`;
        const postDir = join(surfdashRoot, 'content', 'posts', 'articles', locale, slug);
        await createNodeFileSystem().ensureDir(postDir);
        const filePath = join(postDir, 'index.md');

        try {
            await createNodeFileSystem().writeFile(filePath, markdown);

            const proc = Bun.spawn([postsurfingBin, 'publish', filePath], {
                stdout: 'pipe',
                stderr: 'pipe',
            });

            const [exitCode, stdout, stderr] = await Promise.all([
                proc.exited,
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
            ]);

            if (exitCode !== 0) {
                return ResultSchema.parse({
                    ok: false,
                    target: 'surfdash',
                    error: `postsurfing CLI failed (exit ${exitCode}): ${stderr.trim() || stdout.trim() || 'Unknown error'}`,
                });
            }

            return ResultSchema.parse({
                ok: true,
                target: 'surfdash',
                url: `https://surfdash.local/${locale}/posts/${slug}`,
                message: 'Published successfully to Surfdash via postsurfing CLI',
            });
        } catch (err: unknown) {
            return ResultSchema.parse({
                ok: false,
                target: 'surfdash',
                error: `Postsurfing transport error: ${err instanceof Error ? err.message : String(err)}`,
            });
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
 */
export async function processPublishIO(
    inputPath: string,
    outputPath: string,
    transport: PublishTransport = getPublishTransport(),
): Promise<void> {
    await createNodeFileSystem().deleteFile(outputPath);
    const rawInput = await createNodeFileSystem().readFile(inputPath);
    const content = ContentSchema.parse(JSON.parse(rawInput));

    const result = await transport.publish({ content });
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
