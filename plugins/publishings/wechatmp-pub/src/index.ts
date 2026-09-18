import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Result, ResultSchema } from '@gobing-ai/kk-core';
import { FakeFileCliTransport, type PublishTransport, type PublishTransportPayload } from '@gobing-ai/publish-harness';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';

const TARGET = 'wechatmp';
const TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/token';
const DRAFT_ADD_URL = 'https://api.weixin.qq.com/cgi-bin/draft/add';
const APP_ID_ENV = 'WECHAT_APP_ID';
const APP_SECRET_ENV = 'WECHAT_APP_SECRET';

export interface WechatDraftArticle {
    article_type: 'news';
    title: string;
    author?: string;
    digest?: string;
    content: string;
    content_source_url?: string;
    thumb_media_id: string;
    need_open_comment?: number;
    only_fans_can_comment?: number;
}

export interface WechatDraftArticles {
    articles: WechatDraftArticle[];
}

function fail(error: string): Result {
    return ResultSchema.parse({ ok: false, target: TARGET, error });
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Harvested subset of wt md-to-wechat: headings, paragraphs, fenced code, lists, inline.
 * TypeScript only — no Python, no theme CLI.
 */
export function markdownToWechatHtml(markdown: string): string {
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const out: string[] = [];
    let inCode = false;
    let code: string[] = [];
    let listType: 'ul' | 'ol' | null = null;

    const closeList = (): void => {
        if (listType) {
            out.push(`</${listType}>`);
            listType = null;
        }
    };

    const inline = (text: string): string =>
        escapeHtml(text)
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\*([^*]+)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    for (const line of lines) {
        if (line.startsWith('```')) {
            if (inCode) {
                out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
                code = [];
                inCode = false;
            } else {
                closeList();
                inCode = true;
            }
            continue;
        }
        if (inCode) {
            code.push(line);
            continue;
        }
        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        if (heading?.[1] && heading[2]) {
            closeList();
            const level = Math.min(heading[1].length, 3);
            out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
            continue;
        }
        const ul = line.match(/^[-*]\s+(.+)$/);
        if (ul?.[1]) {
            if (listType !== 'ul') {
                closeList();
                listType = 'ul';
                out.push('<ul>');
            }
            out.push(`<li>${inline(ul[1])}</li>`);
            continue;
        }
        const ol = line.match(/^\d+\.\s+(.+)$/);
        if (ol?.[1]) {
            if (listType !== 'ol') {
                closeList();
                listType = 'ol';
                out.push('<ol>');
            }
            out.push(`<li>${inline(ol[1])}</li>`);
            continue;
        }
        closeList();
        if (line.trim().length === 0) continue;
        out.push(`<p>${inline(line.trim())}</p>`);
    }
    closeList();
    if (inCode) out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
    return out.join('');
}

function resolveTitle(content: Content): string {
    if (content.title && content.title.trim().length > 0) return content.title.trim();
    const match = content.body.match(/^#\s+(.+)$/m);
    return match?.[1] ? match[1].trim() : 'Untitled';
}

function resolveDigest(content: Content): string {
    if (typeof content.metadata?.description === 'string' && content.metadata.description.trim().length > 0) {
        return content.metadata.description.trim().slice(0, 120);
    }
    const para = content.body
        .replace(/^#.+$/m, '')
        .split(/\n\n+/)
        .map((p) => p.trim())
        .find((p) => p.length > 0);
    return (para ?? '').slice(0, 120);
}

export function mapContentToWechatDraft(content: Content): WechatDraftArticles {
    const thumb = content.metadata?.thumbMediaId;
    if (typeof thumb !== 'string' || thumb.trim().length === 0) {
        throw new Error(
            'metadata.thumbMediaId is required for WeChat news drafts (cover media_id from material/add_material)',
        );
    }
    const title = resolveTitle(content).slice(0, 32);
    const author = typeof content.metadata?.author === 'string' ? content.metadata.author.slice(0, 16) : undefined;
    const source =
        typeof content.metadata?.canonicalUrl === 'string'
            ? content.metadata.canonicalUrl
            : content.references?.[0]?.url;
    return {
        articles: [
            {
                article_type: 'news',
                title,
                ...(author ? { author } : {}),
                digest: resolveDigest(content),
                content: markdownToWechatHtml(content.body),
                ...(source ? { content_source_url: source } : {}),
                thumb_media_id: thumb.trim(),
            },
        ],
    };
}

function resolveOperation(options?: Record<string, unknown>, content?: Content): string {
    const raw = options?.operation ?? content?.metadata?.operation ?? 'draft';
    return typeof raw === 'string' ? raw : 'draft';
}

export class WechatDraftApiTransport implements PublishTransport {
    public readonly kind = 'file-cli';

    public async publish(payload: PublishTransportPayload): Promise<Result> {
        const operation = resolveOperation(payload.options, payload.content);
        if (operation === 'live' || operation === 'publish' || operation === 'freepublish') {
            return fail(
                'WeChat live publish via freepublish/submit is certification-gated; default operation is draft. Confirm with the operator before a live/console path.',
            );
        }
        if (operation !== 'draft') {
            return fail(`invalid options.operation "${operation}": expected draft (default) or live`);
        }

        const appId = process.env[APP_ID_ENV];
        const appSecret = process.env[APP_SECRET_ENV];
        const missing: string[] = [];
        if (!appId || appId.trim().length === 0) missing.push(APP_ID_ENV);
        if (!appSecret || appSecret.trim().length === 0) missing.push(APP_SECRET_ENV);
        if (missing.length > 0) {
            return fail(
                `${missing.join(' and ')} environment variable${missing.length > 1 ? 's are' : ' is'} required: WeChat Official Account AppID/AppSecret`,
            );
        }

        let articles: WechatDraftArticles;
        try {
            articles = mapContentToWechatDraft(payload.content);
        } catch (error: unknown) {
            return fail(error instanceof Error ? error.message : String(error));
        }

        try {
            const tokenUrl = `${TOKEN_URL}?grant_type=client_credential&appid=${encodeURIComponent(appId ?? '')}&secret=${encodeURIComponent(appSecret ?? '')}`;
            const tokenResponse = await fetch(tokenUrl);
            const tokenJson = (await tokenResponse.json()) as {
                access_token?: unknown;
                errmsg?: unknown;
                errcode?: unknown;
            };
            if (typeof tokenJson.access_token !== 'string') {
                return fail(
                    `WeChat token request failed: ${typeof tokenJson.errmsg === 'string' ? tokenJson.errmsg : 'missing access_token'}`,
                );
            }
            const draftResponse = await fetch(
                `${DRAFT_ADD_URL}?access_token=${encodeURIComponent(tokenJson.access_token)}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(articles),
                },
            );
            const draftJson = (await draftResponse.json()) as {
                media_id?: unknown;
                errmsg?: unknown;
                errcode?: unknown;
            };
            if (typeof draftJson.media_id !== 'string') {
                return fail(
                    `WeChat draft/add failed: ${typeof draftJson.errmsg === 'string' ? draftJson.errmsg : 'missing media_id'}`,
                );
            }
            return ResultSchema.parse({
                ok: true,
                target: TARGET,
                id: draftJson.media_id,
                message: 'WeChat draft created via draft/add',
                metadata: { operation: 'draft', publishStatus: 'draft' },
            });
        } catch (err: unknown) {
            return fail(`WeChat transport error: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}

export function getPublishTransport(): PublishTransport {
    if (process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake') {
        return new FakeFileCliTransport();
    }
    return new WechatDraftApiTransport();
}

async function writePublishResult(outputPath: string, result: Result): Promise<void> {
    const outDir = dirname(outputPath);
    if (outDir && outDir !== '.') {
        await createNodeFileSystem().ensureDir(outDir);
    }
    await createNodeFileSystem().writeFile(outputPath, JSON.stringify(result, null, 2));
}

export async function processPublishIO(
    inputPath: string,
    outputPath: string,
    transport: PublishTransport = getPublishTransport(),
): Promise<void> {
    await createNodeFileSystem().deleteFile(outputPath);
    let content: Content;
    let options: Record<string, unknown> | undefined;
    try {
        const raw = JSON.parse(await createNodeFileSystem().readFile(inputPath)) as Record<string, unknown>;
        content = ContentSchema.parse(raw);
        if (raw.options !== undefined && typeof raw.options === 'object' && raw.options !== null) {
            options = raw.options as Record<string, unknown>;
        }
    } catch (error: unknown) {
        const message = `Invalid Content input: ${error instanceof Error ? error.message : String(error)}`;
        await writePublishResult(outputPath, fail(message));
        throw new Error(message);
    }
    const result = ResultSchema.parse(await transport.publish({ content, options }));
    await writePublishResult(outputPath, result);
    if (!result.ok) throw new Error(result.error ?? 'Publish failed');
}

export async function main(): Promise<number> {
    let values: { in?: string; out?: string };
    try {
        ({ values } = parseArgs({ options: { in: { type: 'string' }, out: { type: 'string' } } }));
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
        echoError(`wechatmp-pub failed: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
