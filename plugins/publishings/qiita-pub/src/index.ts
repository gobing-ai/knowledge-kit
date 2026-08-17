import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Result, ResultSchema } from '@gobing-ai/kk-core';
import { FakeFileCliTransport, type PublishTransport, type PublishTransportPayload } from '@gobing-ai/publish-harness';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';

/** Qiita API v2 article-create endpoint (audited from wt-publish-to-qiita). */
const QIITA_ITEMS_URL = 'https://qiita.com/api/v2/items';

/**
 * Converts a string into a lowercase hyphenated tag (slug) per the publish spec tags convention.
 * Qiita tag names allow only alphanumeric, hyphen, and underscore, so the slugified form is
 * always API-acceptable.
 */
export function slugify(str: string): string {
    return str
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/[\s_]+/g, '-');
}

/** Resolved Qiita article fields derived from a Content payload. */
interface QiitaArticleFields {
    title: string;
    tags: string[];
    private: boolean;
}

/**
 * Resolves Content into Qiita article fields (title, slugified tags, private flag).
 * Splitting from `mapContentToQiitaMarkdown` lets `publish` resolve fields once so the
 * rendered article and the API payload agree. Throws when a tag cannot be slugified:
 * the Qiita API accepts only alphanumeric, hyphen, and underscore tag names.
 */
function resolveQiitaFields(content: Content): QiitaArticleFields {
    let title = content.title;
    if (!title) {
        const match = content.body.match(/^#\s+(.+)$/m);
        title = match?.[1] ? match[1].trim() : 'Untitled Post';
    }

    const rawTags: unknown[] = Array.isArray(content.metadata?.tags)
        ? content.metadata.tags
        : Array.isArray(content.metadata?.keywords)
          ? content.metadata.keywords
          : [];
    const tagStrings = rawTags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
    const sluggedTags = tagStrings.map((t: string) => slugify(t));

    // A tag that slugifies to empty (non-ASCII or punctuation-only) cannot be sent to the
    // Qiita API; fail loud at mapping time instead of emitting `tags: [{name: ""}]` (HTTP 400).
    const emptySlugIndex = sluggedTags.findIndex((slug) => slug.length === 0);
    if (emptySlugIndex >= 0) {
        const invalidTag = tagStrings[emptySlugIndex] ?? '';
        throw new Error(
            `Invalid tag "${invalidTag}": cannot map to a Qiita tag slug (alphanumeric, hyphen, underscore only)`,
        );
    }

    // Dedupe after slugification — the Qiita API rejects duplicate tag names in one payload.
    const tags = [...new Set(sluggedTags)];

    // Qiita `private: true` means limited-sharing (the inverse of the shared `published` flag).
    const metadata = content.metadata;
    const isPrivate =
        typeof metadata?.private === 'boolean'
            ? metadata.private
            : typeof metadata?.published === 'boolean'
              ? !metadata.published
              : false;

    return { title, tags, private: isPrivate };
}

/**
 * Renders Qiita markdown (Qiita CLI frontmatter + body) from already-resolved article fields.
 * The frontmatter carries title, tags, and the private flag; the article body follows
 * verbatim per the publish spec.
 */
function renderQiitaMarkdown(content: Content, fields: QiitaArticleFields): string {
    const { title, tags, private: isPrivate } = fields;
    const tagYaml = tags.length > 0 ? tags.map((tag) => `  - "${tag}"`).join('\n') : '  []';
    const yamlLines = ['---', `title: ${JSON.stringify(title)}`, 'tags:', tagYaml, `private: ${isPrivate}`, '---'];
    return `${yamlLines.join('\n')}\n\n${content.body.trim()}\n`;
}

/**
 * Maps Content object into Qiita markdown with target frontmatter
 * (title, tags, private flag) and the article body per the publish spec.
 */
export function mapContentToQiitaMarkdown(content: Content): string {
    return renderQiitaMarkdown(content, resolveQiitaFields(content));
}

/**
 * Token-API transport publishing articles to Qiita via the Qiita API v2
 * (`POST /api/v2/items`), mirroring the wt-publish-to-qiita API flow. The access
 * token is read exclusively from the QIITA_TOKEN environment variable (spec §2.4);
 * the transport stays classified `file-cli` per the E2 File/CLI audit (task 0002).
 */
export class QiitaApiTransport implements PublishTransport {
    public readonly kind = 'file-cli';

    public async publish(payload: PublishTransportPayload): Promise<Result> {
        let fields: QiitaArticleFields;
        try {
            fields = resolveQiitaFields(payload.content);
        } catch (error: unknown) {
            return ResultSchema.parse({
                ok: false,
                target: 'qiita',
                error: `Invalid Content: ${error instanceof Error ? error.message : String(error)}`,
            });
        }

        const token = process.env.QIITA_TOKEN;
        if (!token) {
            return ResultSchema.parse({
                ok: false,
                target: 'qiita',
                error: 'QIITA_TOKEN environment variable is required: Qiita API access token (read_qiita/write_qiita scopes)',
            });
        }

        try {
            const response = await fetch(QIITA_ITEMS_URL, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: fields.title,
                    body: payload.content.body,
                    tags: fields.tags.map((name) => ({ name })),
                    private: fields.private,
                }),
            });

            if (!response.ok) {
                const errorText = (await response.text()).slice(0, 1000);
                return ResultSchema.parse({
                    ok: false,
                    target: 'qiita',
                    error: `Qiita API request failed (HTTP ${response.status} ${response.statusText}): ${
                        errorText.trim() || 'Unknown error'
                    }`,
                });
            }

            const data = (await response.json()) as { id?: unknown; url?: unknown };
            if (typeof data.id !== 'string' || typeof data.url !== 'string') {
                return ResultSchema.parse({
                    ok: false,
                    target: 'qiita',
                    error: 'Qiita API response missing required fields (id, url)',
                });
            }

            return ResultSchema.parse({
                ok: true,
                target: 'qiita',
                url: data.url,
                id: data.id,
                message: 'Published successfully to Qiita via the API v2 token transport',
            });
        } catch (err: unknown) {
            return ResultSchema.parse({
                ok: false,
                target: 'qiita',
                error: `Qiita transport error: ${err instanceof Error ? err.message : String(err)}`,
            });
        }
    }
}

/**
 * Resolves default PublishTransport based on environment configuration.
 */
export function getPublishTransport(): PublishTransport {
    if (process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake') {
        return new FakeFileCliTransport();
    }
    return new QiitaApiTransport();
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
        await writePublishResult(outputPath, ResultSchema.parse({ ok: false, target: 'qiita', error: message }));
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
    let values: { in?: string; out?: string };
    try {
        ({ values } = parseArgs({
            options: {
                in: { type: 'string' },
                out: { type: 'string' },
            },
        }));
    } catch (error: unknown) {
        echoError(`Invalid arguments: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }

    if (!values.in || !values.out) {
        echoError('Missing required arguments: --in and --out');
        return 1;
    }

    try {
        await processPublishIO(values.in, values.out);
        return 0;
    } catch (error: unknown) {
        echoError(`qiita-pub failed: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
