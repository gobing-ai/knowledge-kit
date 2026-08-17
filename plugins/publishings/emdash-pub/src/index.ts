import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Result, ResultSchema } from '@gobing-ai/kk-core';
import { FakeFileCliTransport, type PublishTransport, type PublishTransportPayload } from '@gobing-ai/publish-harness';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';

/** EmDash create envelope per docs/design/emdash-pub.md §3 (REST create). */
export interface EmDashCreateEnvelope {
    data: {
        title: string;
        content: PortableTextBlock[];
        excerpt?: string;
    };
    slug: string;
    status: 'draft' | 'published';
}

/** One inline run of Portable Text; `marks` may carry `strong`/`em`/`link-N`. */
export interface PortableTextSpan {
    _type: 'span';
    text: string;
    marks?: string[];
}

/** Portable Text block; `_type: 'code'` blocks carry `language` + `code` instead of children. */
export interface PortableTextBlock {
    _type: 'block' | 'code';
    style?: 'normal' | 'h2' | 'h3' | 'h4' | 'blockquote';
    children?: PortableTextSpan[];
    markDefs?: Array<{ _type: 'link'; href: string; _key: string }>;
    listItem?: 'bullet' | 'number';
    language?: string;
    code?: string;
}

/**
 * Converts a string into a lowercase hyphenated slug per the publish spec tags convention.
 */
export function slugify(str: string): string {
    return str
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/[\s_]+/g, '-');
}

/** Unsupported markdown line detectors (fail loud — never silently drop a construct). */
const H1_RE = /^#\s/;
const TABLE_RE = /\|/;
const HTML_RE = /<[a-zA-Z/!]/;
const IMAGE_RE = /!\[/;

/** Shared mutable state threaded through inline parsing (per-block link key counter). */
interface InlineState {
    linkIndex: number;
}

/**
 * Parses inline markdown (`**strong**`, `*em*`/`_em_`, `[text](url)`) into Portable Text
 * spans and link markDefs. v1 scope per docs/design/emdash-pub.md §5; nesting is not supported.
 */
function parseInline(
    text: string,
    children: PortableTextSpan[],
    markDefs: EmDashCreateEnvelope['data']['content'][number]['markDefs'],
    state: InlineState,
): void {
    const INLINE = /\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|\[([^\]]+)\]\(([^)\s]+)\)/;
    let rest = text;
    const push = (value: string, marks?: string[]): void => {
        if (value.length === 0) return;
        children.push(
            marks && marks.length > 0 ? { _type: 'span', text: value, marks } : { _type: 'span', text: value },
        );
    };

    while (rest.length > 0) {
        const match = rest.match(INLINE);
        if (!match) {
            push(rest);
            return;
        }
        const index = match.index ?? 0;
        push(rest.slice(0, index));
        if (match[1] !== undefined) {
            push(match[1], ['strong']);
        } else if (match[2] !== undefined || match[3] !== undefined) {
            push(match[2] ?? match[3] ?? '', ['em']);
        } else if (match[4] !== undefined && match[5] !== undefined) {
            const key = `link-${state.linkIndex}`;
            state.linkIndex += 1;
            push(match[4], [key]);
            if (markDefs) markDefs.push({ _type: 'link', href: match[5], _key: key });
        }
        rest = rest.slice(index + match[0].length);
    }
}

/** Builds a text block, parsing inline marks into children/markDefs. */
function textBlock(style: NonNullable<PortableTextBlock['style']>, text: string): PortableTextBlock {
    const children: PortableTextSpan[] = [];
    const markDefs: PortableTextBlock['markDefs'] = [];
    parseInline(text, children, markDefs, { linkIndex: 0 });
    const block: PortableTextBlock = { _type: 'block', style, children };
    if (markDefs && markDefs.length > 0) block.markDefs = markDefs;
    return block;
}

/**
 * Maps markdown into Portable Text blocks (v1 construct set per docs/design/emdash-pub.md §5):
 * paragraphs, ATX `##`–`####` headings, blockquotes, `- ` / `* ` bullets, `1. ` numbered
 * lists, and fenced ` ```lang ` code. Unsupported constructs — leftover `# ` h1, pipe tables,
 * raw HTML, and `![` images — throw instead of being dropped.
 */
export function markdownToPortableText(markdown: string): PortableTextBlock[] {
    const blocks: PortableTextBlock[] = [];
    const lines = markdown.split('\n');
    let paragraph: string[] = [];
    let codeLanguage: string | undefined;
    let codeLines: string[] = [];

    const flushParagraph = (): void => {
        const text = paragraph.join('\n').trim();
        paragraph = [];
        if (text.length > 0) blocks.push(textBlock('normal', text));
    };

    for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        const trimmed = line.trimStart();

        // Inside a fenced code block: consume verbatim until the closing fence.
        if (codeLanguage !== undefined) {
            if (/^```/.test(trimmed)) {
                const block: PortableTextBlock = { _type: 'code', code: codeLines.join('\n') };
                if (codeLanguage) block.language = codeLanguage;
                blocks.push(block);
                codeLanguage = undefined;
                codeLines = [];
            } else {
                codeLines.push(line);
            }
            continue;
        }

        if (/^```/.test(trimmed)) {
            flushParagraph();
            codeLanguage = trimmed.slice(3).trim();
            codeLines = [];
            continue;
        }

        // Unsupported constructs fail loud (code-block content is exempt — it is verbatim).
        if (H1_RE.test(trimmed)) throw new Error('Unsupported markdown construct: h1');
        if (IMAGE_RE.test(trimmed)) throw new Error('Unsupported markdown construct: image');
        if (TABLE_RE.test(trimmed)) throw new Error('Unsupported markdown construct: table');
        if (HTML_RE.test(trimmed)) throw new Error('Unsupported markdown construct: html');

        if (trimmed.length === 0) {
            flushParagraph();
            continue;
        }
        if (/^#{2,4}\s/.test(trimmed)) {
            flushParagraph();
            const level = trimmed.match(/^#+/)?.[0].length ?? 2;
            const style = (level === 2 ? 'h2' : level === 3 ? 'h3' : 'h4') as 'h2' | 'h3' | 'h4';
            blocks.push(textBlock(style, trimmed.replace(/^#+\s+/, '').trim()));
            continue;
        }
        if (/^>/.test(trimmed)) {
            flushParagraph();
            blocks.push(textBlock('blockquote', trimmed.replace(/^>\s?/, '').trim()));
            continue;
        }
        if (/^[-*]\s/.test(trimmed)) {
            flushParagraph();
            const block = textBlock('normal', trimmed.replace(/^[-*]\s+/, '').trim());
            block.listItem = 'bullet';
            blocks.push(block);
            continue;
        }
        if (/^\d+\.\s/.test(trimmed)) {
            flushParagraph();
            const block = textBlock('normal', trimmed.replace(/^\d+\.\s+/, '').trim());
            block.listItem = 'number';
            blocks.push(block);
            continue;
        }
        paragraph.push(trimmed);
    }
    flushParagraph();
    return blocks;
}

/** Strips trailing slashes from a site origin so URL joins do not double up. */
function stripTrailingSlashes(url: string): string {
    return url.replace(/\/+$/, '');
}

/** First non-empty paragraph of a markdown body, skipping heading lines (for the excerpt). */
function firstParagraph(markdown: string): string | undefined {
    const lines = markdown.split('\n');
    const parts: string[] = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
            if (parts.length > 0) return parts.join(' ').trim();
            continue;
        }
        if (/^#{1,6}\s/.test(trimmed)) continue;
        parts.push(trimmed);
    }
    const result = parts.join(' ').trim();
    return result.length > 0 ? result : undefined;
}

/**
 * Maps Content into the EmDash create envelope per docs/design/emdash-pub.md §5:
 * title from `content.title` or the first ATX `# ` heading (else throw), slug from
 * `metadata.slug` or `slugify(title)` (empty → throw), excerpt from `metadata.description`
 * or the first paragraph (omitted when empty), status published only when
 * `metadata.published === true`. When the title is consumed from the body, that `# ` line
 * is dropped before the body is mapped.
 */
export function mapContentToEmDashCreate(content: Content): EmDashCreateEnvelope {
    const metadata = content.metadata ?? {};
    let title = typeof content.title === 'string' ? content.title.trim() : '';
    let body = content.body;

    if (!title) {
        const match = body.match(/^#\s+(.+)$/m);
        if (!match?.[1]?.trim()) {
            throw new Error('Cannot resolve title: set Content.title or start the body with an ATX # heading');
        }
        title = match[1].trim();
        body = body.replace(/^#\s+.*$/m, '');
    }

    const metaSlug = typeof metadata.slug === 'string' ? metadata.slug.trim() : '';
    const slug = metaSlug || slugify(title);
    if (!slug) {
        throw new Error('Cannot derive slug from title');
    }

    let excerpt: string | undefined;
    const description = typeof metadata.description === 'string' ? metadata.description.trim() : '';
    if (description) {
        excerpt = description;
    } else {
        excerpt = firstParagraph(body);
    }

    const status = metadata.published === true ? 'published' : 'draft';

    const envelope: EmDashCreateEnvelope = {
        data: { title, content: markdownToPortableText(body.trim()) },
        slug,
        status,
    };
    if (excerpt) envelope.data.excerpt = excerpt;
    return envelope;
}

/**
 * Token-API transport creating an EmDash post via `POST {origin}/_emdash/api/content/{collection}`
 * with `Authorization: Bearer {token}`. Reads `EMDASH_URL` / `EMDASH_TOKEN` / `EMDASH_COLLECTION`
 * (default `posts`) from the environment (spec §2.4, D3/D4); classified `file-cli` per E2
 * (ADR-008). Fail-loud Result on missing env, mapping failure, network error, non-2xx,
 * `success: false`, or missing `data.item.id` — never leaking the token.
 */
export class EmDashApiTransport implements PublishTransport {
    public readonly kind = 'file-cli';

    public async publish(payload: PublishTransportPayload): Promise<Result> {
        const baseUrl = process.env.EMDASH_URL?.trim();
        if (!baseUrl) {
            return ResultSchema.parse({
                ok: false,
                target: 'emdash',
                error: 'EMDASH_URL environment variable is required',
            });
        }

        const token = process.env.EMDASH_TOKEN?.trim();
        if (!token) {
            return ResultSchema.parse({
                ok: false,
                target: 'emdash',
                error: 'EMDASH_TOKEN environment variable is required',
            });
        }

        let envelope: EmDashCreateEnvelope;
        try {
            envelope = mapContentToEmDashCreate(payload.content);
        } catch (error: unknown) {
            return ResultSchema.parse({
                ok: false,
                target: 'emdash',
                error: `Invalid Content: ${error instanceof Error ? error.message : String(error)}`,
            });
        }

        const collection = process.env.EMDASH_COLLECTION?.trim() || 'posts';
        const endpoint = `${stripTrailingSlashes(baseUrl)}/_emdash/api/content/${encodeURIComponent(collection)}`;

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(envelope),
            });

            let body: { success?: unknown; error?: { code?: unknown }; data?: { item?: { id?: unknown } } } | undefined;
            try {
                body = (await response.json()) as typeof body;
            } catch {
                body = undefined;
            }

            if (!response.ok || body?.success !== true || typeof body?.data?.item?.id !== 'string') {
                const statusPart = `HTTP ${response.status}`;
                const codePart = body?.error && typeof body.error.code === 'string' ? `, code ${body.error.code}` : '';
                const detail = body ? JSON.stringify(body).slice(0, 1000) : 'Unknown error';
                return ResultSchema.parse({
                    ok: false,
                    target: 'emdash',
                    error: `EmDash API request failed (${statusPart}${codePart}): ${detail}`,
                });
            }

            const id = body.data.item.id;
            const result: Result = {
                ok: true,
                target: 'emdash',
                id,
                message: 'Published successfully to EmDash via the REST token transport',
            };

            const publicPath = process.env.EMDASH_PUBLIC_POST_PATH;
            if (publicPath !== undefined) {
                if (!publicPath.includes('{slug}')) {
                    return ResultSchema.parse({
                        ok: false,
                        target: 'emdash',
                        error: 'EMDASH_PUBLIC_POST_PATH environment variable must contain {slug}',
                    });
                }
                result.url = `${stripTrailingSlashes(baseUrl)}${publicPath.replaceAll('{slug}', envelope.slug)}`;
            }

            return ResultSchema.parse(result);
        } catch (err: unknown) {
            return ResultSchema.parse({
                ok: false,
                target: 'emdash',
                error: `EmDash transport error: ${err instanceof Error ? err.message : String(err)}`,
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
    return new EmDashApiTransport();
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
        await writePublishResult(outputPath, ResultSchema.parse({ ok: false, target: 'emdash', error: message }));
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
        echoError(`emdash-pub failed: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
