/**
 * WeChat MP same-origin CGI draft creation (task 0290): eligible plain 文章 drafts dispatch through
 * the authenticated console page's own `/cgi-bin/operate_appmsg` subpath (ADR-026 amendment,
 * 2026-10-15) on top of the 0289 media pipeline (`./cgi`, `./cgi-media`). Plain metadata only —
 * advanced article metadata, other modes and public operations stay on the DOM flow (`./flow`).
 *
 * The create is ONE request validated against its receipt plus an id+title readback before it
 * counts; once dispatched, any unverifiable outcome is an ambiguous submission that never retries
 * and never falls back to DOM re-creation. Request shapes are frozen from the recovered v0.1.55
 * extension weixin.js createArticleDraft (task 0290 Design) — versioned compatibility behavior,
 * not an official WeChat API guarantee. Session values are secrets: error messages and metadata
 * never carry token/ticket/uin, and the page snapshot used for extraction is never returned.
 */
import type { Content } from '@gobing-ai/kk-core';
import type { WechatCgiSession } from './cgi';
import type { WechatArticleMedia } from './cgi-media';
import { deriveDigest } from './modes';
import type { WechatPage } from './page';

const MP_ORIGIN = 'https://mp.weixin.qq.com';
const CREATE_URL = `${MP_ORIGIN}/cgi-bin/operate_appmsg`;
const APPMSG_URL = `${MP_ORIGIN}/cgi-bin/appmsg`;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
/** The inline-script scan reads at most this many chars of the page (≈2 MiB; token sits in the head). */
const MAX_SNAPSHOT_CHARS = 2 * 1024 * 1024;
const DEFAULT_OPERATION = '文章';

/** Bounded failure vocabulary for every CGI draft refusal (task 0290 Design). */
export class WechatCgiDraftError extends Error {
    constructor(
        readonly code:
            | 'session-missing'
            | 'ineligible'
            | 'request-failed'
            | 'receipt-invalid'
            | 'readback-failed'
            | 'duplicate-draft'
            | 'ambiguous-submission',
        readonly stage: string,
        message: string,
        readonly metadata: Record<string, unknown> = {},
    ) {
        super(message);
        this.name = 'WechatCgiDraftError';
    }
}

/** The plain metadata the frozen operate_appmsg baseline consumes; anything richer stays on DOM. */
export interface CgiDraftEligibility {
    operation: '文章';
    publishStatus: 'draft';
    title: string;
    body: string;
    digest: string;
    author: string;
}

/**
 * Explicit allowed metadata set (task 0290 Design): plain article fields plus generic
 * routing/provenance keys. Any other key — advanced layout/settings/original/reward/collection
 * detail such as `metadata.wechatmp.*` — makes the content ineligible so the DOM flow keeps it.
 */
const ALLOWED_METADATA_KEYS: ReadonlySet<string> = new Set([
    'operation',
    'publishStatus',
    'title',
    'body',
    'digest',
    'author',
    'contentId',
    'source',
    'sourceUrl',
    'tags',
    'categories',
    'coverPath',
    'images',
    // Repo-wide single-cover convention (`itc-materialize-plan` writes it; surfdash and xhs read the
    // same key) and the excerpt a brief carries. Without these two a plain pipeline article was
    // ineligible, fell to the DOM flow, and lost its cover: the DOM flow's default `coverSource:
    // 'library'` only resolves a material that the daily audio rail already seeded (2026-11-12).
    'coverImage',
    'description',
]);

function isNonemptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/** Deterministic certification of the plain-article shape; never mutates content. */
export function certifyCgiDraft(content: Content): CgiDraftEligibility {
    const metadata = content.metadata ?? {};
    function refuse(detail: string): never {
        throw new WechatCgiDraftError(
            'ineligible',
            'eligibility',
            `content is not eligible for the CGI draft path: ${detail}`,
        );
    }
    const operation = metadata.operation ?? DEFAULT_OPERATION;
    if (operation !== DEFAULT_OPERATION) {
        refuse(`operation is not ${DEFAULT_OPERATION}`);
    }
    if (metadata.publishStatus !== undefined && metadata.publishStatus !== 'draft') {
        refuse('publishStatus is not draft');
    }
    if (!isNonemptyString(content.title)) {
        refuse('title is missing or empty');
    }
    if (!isNonemptyString(content.body)) {
        refuse('body is missing or empty');
    }
    for (const key of ['digest', 'author'] as const) {
        if (metadata[key] !== undefined && typeof metadata[key] !== 'string') {
            refuse(`${key} is present but not a string`);
        }
    }
    for (const key of Object.keys(metadata)) {
        if (!ALLOWED_METADATA_KEYS.has(key)) {
            refuse(`metadata key '${key}' is outside the plain-article set`);
        }
    }
    return {
        operation: DEFAULT_OPERATION,
        publishStatus: 'draft',
        title: content.title,
        body: content.body,
        // 摘要 is 选填; a brief's `description` is the same role, so it fills an absent digest.
        digest:
            typeof metadata.digest === 'string' && metadata.digest.length > 0
                ? metadata.digest
                : typeof metadata.description === 'string'
                  ? metadata.description
                  : '',
        author: typeof metadata.author === 'string' ? metadata.author : '',
    };
}

/**
 * Deterministic eligibility gate, checked BEFORE any upload/create mutation: operation=文章,
 * publishStatus draft (absent defaults to draft), nonempty title/body, string-only digest/author
 * and no metadata outside the plain set. Anything else must stay on the DOM flow.
 */
export function assertEligibleCgiDraft(content: Content): void {
    certifyCgiDraft(content);
}

/** Query strings carry ticket/token — strip them before any failure detail is surfaced. */
function stripQuery(detail: string): string {
    return detail.replace(/\?[^'"\\\s]*/g, '?…');
}

/** The page must already BE the authenticated console origin before anything is evaluated. */
function assertMpOrigin(page: WechatPage): void {
    let origin: string;
    try {
        origin = new URL(page.url()).origin;
    } catch {
        throw new WechatCgiDraftError(
            'request-failed',
            'assert-origin',
            `page URL is not usable for CGI dispatch: ${page.url()}`,
        );
    }
    if (origin !== MP_ORIGIN) {
        throw new WechatCgiDraftError(
            'request-failed',
            'assert-origin',
            `CGI dispatch requires page origin ${MP_ORIGIN}, got ${origin}`,
        );
    }
}

/**
 * Self-contained page script: the URL token wins when numeric-valid, otherwise KNOWN inline field
 * assignments are read from a bounded head-truncated snapshot via bounded regexes only — no eval,
 * no Function constructor, and the snapshot itself never crosses back, only the extracted fields.
 * `ticket_id` is read because the vendor's filetransfer contract sends it AS the user_name.
 */
function extractSessionExpression(): string {
    return `(function () {
    const fields = {};
    const urlToken = new URLSearchParams(location.search).get('token');
    if (urlToken !== null && /^\\d{4,32}$/.test(urlToken)) fields.token = urlToken;
    const snapshot = document.documentElement.outerHTML.slice(0, ${MAX_SNAPSHOT_CHARS});
    const first = (regex) => {
        const match = regex.exec(snapshot);
        return match === null ? undefined : match[1];
    };
    // URL token wins, but ticket/user_name/uin are scan-only: a URL-token page still needs them,
    // so only the token lookup is skipped when the URL already supplied it (task 0290 chunk C bugfix).
    if (!fields.token) {
        const token = first(/\\btoken\\s*=\\s*['"](\\d{4,32})['"]/);
        if (token !== undefined) fields.token = token;
    }
    const ticketId = first(/\\bticket_id\\s*=\\s*['"]([A-Za-z0-9]{8,128})['"]/);
    if (ticketId !== undefined) fields.ticketId = ticketId;
    const ticket = first(/\\bticket\\s*=\\s*['"]([A-Za-z0-9]{8,128})['"]/);
    if (ticket !== undefined) fields.ticket = ticket;
    const userName = first(/\\buser_name\\s*=\\s*['"](@[A-Za-z0-9_-]{1,63}|gh_[A-Za-z0-9_-]{1,61})['"]/);
    if (userName !== undefined) fields.userName = userName;
    const uin = first(/\\buin\\s*=\\s*['"](\\d{1,32})['"]/);
    if (uin !== undefined) fields.uin = uin;
    return JSON.stringify({ kind: 'ok', ...fields });
})()`;
}

interface SessionFields {
    token?: string;
    ticket?: string;
    ticketId?: string;
    userName?: string;
    uin?: string;
}

function readSessionFields(raw: unknown): SessionFields {
    if (typeof raw !== 'string') return {};
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return {};
    }
    if (!isRecord(parsed)) return {};
    const field = (key: string): string | undefined => {
        const value = parsed[key];
        return typeof value === 'string' && value !== '' ? value : undefined;
    };
    return {
        token: field('token'),
        ticket: field('ticket'),
        ticketId: field('ticketId'),
        userName: field('userName'),
        uin: field('uin'),
    };
}

/**
 * Extracts the transient console session in-page (task 0290 R1): URL token first, then the known
 * inline fields. token/ticket/user_name are all required (media preparation always needs
 * ticket+user_name); uin is optional. Missing fields refuse by NAME only — never by value.
 */
export async function extractWechatCgiSession(page: WechatPage): Promise<WechatCgiSession> {
    assertMpOrigin(page);
    let raw: unknown;
    try {
        raw = await page.evaluate(extractSessionExpression());
    } catch (error) {
        throw new WechatCgiDraftError(
            'session-missing',
            'extract-session',
            `session extraction failed inside the console page: ${stripQuery(String(error))}`,
        );
    }
    const fields = readSessionFields(raw);
    const userName = fields.userName ?? fields.ticketId;
    const { token, ticket } = fields;
    if (token === undefined || ticket === undefined || userName === undefined) {
        const missing = [
            ...(token === undefined ? ['token'] : []),
            ...(ticket === undefined ? ['ticket'] : []),
            ...(userName === undefined ? ['user_name'] : []),
        ];
        throw new WechatCgiDraftError(
            'session-missing',
            'extract-session',
            `authenticated session field(s) missing on the console page: ${missing.join(', ')}`,
        );
    }
    return { token, ticket, userName, uin: fields.uin };
}

function buildUrl(base: string, params: Record<string, string>): string {
    return `${base}?${new URLSearchParams(params).toString()}`;
}

function randomHex16(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    let hex = '';
    for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
    return hex;
}

/** The frozen operate_appmsg create payload: url plus the exact baseline multipart fields. */
export interface CgiCreateArticlePayload {
    url: string;
    fields: Record<string, string>;
}

/**
 * Frozen baseline fields (task 0290 Design, from recovered createArticleDraft lines 385–447) in
 * frozen key order — no invented vendor scalars. Cover URLs/crops come from the 0289
 * uploadAndCropCover receipt with its ACTUAL coordinates (CoverPair.crops), never vendor pixels.
 * Digest/author default to '' when absent; limits stay owned by modes.ts validation, no clamping.
 */
export function buildCreateArticlePayload(
    session: WechatCgiSession,
    content: Content,
    media: WechatArticleMedia,
    opts?: { random?: string },
): CgiCreateArticlePayload {
    const metadata = content.metadata ?? {};
    const plain = (key: string): string => {
        const value = metadata[key];
        return typeof value === 'string' ? value : '';
    };
    const fields: Record<string, string> = {
        token: session.token,
        lang: 'zh_CN',
        f: 'json',
        ajax: '1',
        random: opts?.random ?? randomHex16(),
        AppMsgId: '',
        count: '1',
        data_seq: '0',
        operate_from: 'Chrome',
        isnew: '0',
        type: '77',
        title0: content.title ?? '',
        author0: plain('author'),
        // Parity with the DOM path: an absent metadata.digest still sends the body-derived 摘要
        // (`deriveDigest`, capped at DERIVED_DIGEST_MAX) instead of dropping it to an empty digest0.
        digest0: deriveDigest(content) ?? '',
        auto_gen_digest0: '0',
        content0: media.html,
        sourceurl0: '',
        cdn_url0: media.cover.wide.url,
        cdn_235_1_url0: media.cover.wide.url,
        cdn_1_1_url0: media.cover.square.url,
        cdn_url_back0: media.cover.wide.url,
        crop_list0: JSON.stringify(media.cover.crops),
        share_page_type0: '0',
        share_imageinfo0: JSON.stringify({ list: [] }),
        categories_list0: '[]',
        compose_info0: JSON.stringify({ list: '' }),
    };
    return {
        url: buildUrl(CREATE_URL, {
            t: 'ajax-response',
            sub: 'create',
            type: '77',
            token: session.token,
            lang: 'zh_CN',
        }),
        fields,
    };
}

interface CgiFetchSpec {
    url: string;
    method: 'POST' | 'GET';
    fields: Record<string, string>;
    maxBytes: number;
    timeoutMs: number;
}

/**
 * Self-contained page script (same closed shape as the 0289 CGI dispatch): the page's
 * authenticated cookies, redirect refusal, streamed against the byte bound, only a bounded JSON
 * verdict crosses back.
 */
function cgiFetchExpression(spec: CgiFetchSpec): string {
    return `(async () => {
    const spec = ${JSON.stringify(spec)};
    try {
        const init = {
            method: spec.method,
            credentials: 'include',
            redirect: 'error',
            signal: AbortSignal.timeout(spec.timeoutMs),
        };
        if (spec.method === 'POST') {
            const form = new FormData();
            for (const key of Object.keys(spec.fields)) form.append(key, spec.fields[key]);
            init.body = form;
        }
        const response = await fetch(spec.url, init);
        if (!response.ok) return JSON.stringify({ kind: 'http-status', status: response.status });
        if (!response.body) return JSON.stringify({ kind: 'error', detail: 'response has no body stream' });
        const reader = response.body.getReader();
        let total = 0;
        const chunks = [];
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > spec.maxBytes) return JSON.stringify({ kind: 'too-large' });
            chunks.push(value);
        }
        const text = await new Blob(chunks).text();
        return JSON.stringify({ kind: 'ok', status: response.status, text });
    } catch (error) {
        return JSON.stringify({ kind: 'error', detail: String(error) });
    }
})()`;
}

type CgiVerdict =
    | { kind: 'ok'; status: number; text: string }
    | { kind: 'http-status'; status: number }
    | { kind: 'too-large' }
    | { kind: 'error'; detail: string };

/** Undefined when the page gave back nothing usable; the caller owns the failure semantics. */
async function evaluateCgiVerdict(page: WechatPage, expression: string): Promise<CgiVerdict | undefined> {
    const raw: unknown = await page.evaluate(expression);
    if (typeof raw !== 'string') return undefined;
    try {
        return JSON.parse(raw) as CgiVerdict;
    } catch {
        return undefined;
    }
}

/** Dispatched but unverifiable — the create may exist server-side, so it must never be retried. */
function ambiguousSubmission(stage: string, detail: string): WechatCgiDraftError {
    return new WechatCgiDraftError('ambiguous-submission', stage, detail, { ambiguousSubmission: true });
}

/**
 * The console's own `list_ex` draft list, read on the authenticated page (task 0406 R4). One reader
 * for both callers — the pre-create duplicate guard and the post-create readback — so the guard can
 * never disagree with the confirmation about what the console holds. `stage` names the caller's
 * step: a read failure is reported where it happened (nothing was created before the create).
 */
async function readDraftList(
    page: WechatPage,
    session: WechatCgiSession,
    stage: string,
): Promise<Record<string, unknown>[]> {
    const listUrl = buildUrl(APPMSG_URL, {
        action: 'list_ex',
        begin: '0',
        count: '5',
        token: session.token,
        lang: 'zh_CN',
        f: 'json',
    });
    let listVerdict: CgiVerdict | undefined;
    try {
        listVerdict = await evaluateCgiVerdict(
            page,
            cgiFetchExpression({
                url: listUrl,
                method: 'GET',
                fields: {},
                maxBytes: MAX_RESPONSE_BYTES,
                timeoutMs: REQUEST_TIMEOUT_MS,
            }),
        );
    } catch (error) {
        throw new WechatCgiDraftError(
            'readback-failed',
            stage,
            `draft list readback ended before a receipt returned: ${stripQuery(String(error))}`,
        );
    }
    if (listVerdict?.kind !== 'ok') {
        const detail =
            listVerdict?.kind === 'http-status'
                ? `HTTP ${listVerdict.status}`
                : listVerdict?.kind === 'too-large'
                  ? `${MAX_RESPONSE_BYTES}-byte bound exceeded`
                  : listVerdict?.kind === 'error'
                    ? stripQuery(listVerdict.detail)
                    : 'page returned no usable verdict';
        throw new WechatCgiDraftError('readback-failed', stage, `draft list readback failed: ${detail}`);
    }
    let list: unknown;
    try {
        list = JSON.parse(listVerdict.text);
    } catch {
        throw new WechatCgiDraftError('readback-failed', stage, 'draft list receipt is not JSON');
    }
    return isRecord(list) && Array.isArray(list.app_msg_list)
        ? list.app_msg_list.filter((item): item is Record<string, unknown> => isRecord(item))
        : [];
}

/**
 * R4: the console already holds a draft with this exact title, so creating would only add a
 * duplicate (3 drafts in one night, 2026-11-19). Refuse with the id that holds it and no side
 * effect — a failed `effect: none` row is retryable once the operator clears the console draft.
 */
function duplicateDraft(existing: Record<string, unknown>, title: string): WechatCgiDraftError {
    const id = existing.app_id !== undefined ? existing.app_id : existing.appmsgid;
    return new WechatCgiDraftError(
        'duplicate-draft',
        'pre-create-lookup',
        `duplicate-draft: appmsgid ${String(id)} already holds "${title}" — delete it or finish it in the console`,
    );
}

/**
 * The R2 create: eligibility re-asserted at the mutation boundary, a duplicate-title lookup
 * (0406 R4) before anything is dispatched, ONE same-origin POST, receipt gated (HTTP ok, ret
 * absent|0, safe numeric appMsgId), then the id+title readback. Any unverifiable create outcome
 * throws ambiguous with metadata.ambiguousSubmission=true; readback failures throw readback-failed
 * (the create receipt itself already verified). Never retries.
 */
export async function createWechatArticleDraft(
    page: WechatPage,
    session: WechatCgiSession,
    content: Content,
    media: WechatArticleMedia,
): Promise<{ appMsgId: string; editPath: string }> {
    const certified = certifyCgiDraft(content);
    assertMpOrigin(page);
    const existing = (await readDraftList(page, session, 'pre-create-lookup')).find(
        (item) => item.title === certified.title,
    );
    if (existing !== undefined) throw duplicateDraft(existing, certified.title);
    const payload = buildCreateArticlePayload(session, content, media);
    let createVerdict: CgiVerdict | undefined;
    try {
        createVerdict = await evaluateCgiVerdict(
            page,
            cgiFetchExpression({
                url: payload.url,
                method: 'POST',
                fields: payload.fields,
                maxBytes: MAX_RESPONSE_BYTES,
                timeoutMs: REQUEST_TIMEOUT_MS,
            }),
        );
    } catch (error) {
        throw ambiguousSubmission(
            'create-dispatch',
            `operate_appmsg create ended before a receipt returned: ${stripQuery(String(error))}`,
        );
    }
    if (createVerdict?.kind === 'http-status') {
        throw ambiguousSubmission('create-dispatch', `operate_appmsg create returned HTTP ${createVerdict.status}`);
    }
    if (createVerdict?.kind === 'too-large') {
        throw ambiguousSubmission('create-dispatch', `create response exceeded the ${MAX_RESPONSE_BYTES}-byte bound`);
    }
    if (createVerdict?.kind !== 'ok') {
        const detail =
            createVerdict?.kind === 'error' ? stripQuery(createVerdict.detail) : 'page returned no usable verdict';
        throw ambiguousSubmission('create-dispatch', `create failed before a usable response: ${detail}`);
    }
    let body: unknown;
    try {
        body = JSON.parse(createVerdict.text);
    } catch {
        throw ambiguousSubmission('create-receipt', 'create receipt is not JSON');
    }
    if (!isRecord(body)) {
        throw ambiguousSubmission('create-receipt', 'create receipt is not a JSON object');
    }
    if (body.ret !== undefined && body.ret !== 0) {
        // The server answered with an explicit refusal — definitive, not ambiguous.
        throw new WechatCgiDraftError(
            'receipt-invalid',
            'create-receipt',
            `operate_appmsg create refused: ret=${String(body.ret)}`,
        );
    }
    const receipt = isRecord(body.appMsgInfo) ? body.appMsgInfo : body;
    const rawId = receipt.appMsgId;
    const appMsgId = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : undefined;
    if (appMsgId === undefined || !/^-?\d{1,12}$/.test(appMsgId)) {
        throw ambiguousSubmission('create-receipt', 'create receipt did not return a safe numeric appMsgId');
    }
    const items = await readDraftList(page, session, 'readback');
    const confirmed = items.some(
        (item) =>
            item.title === content.title && (String(item.app_id) === appMsgId || String(item.appmsgid) === appMsgId),
    );
    if (!confirmed) {
        throw new WechatCgiDraftError(
            'readback-failed',
            'readback',
            'draft list did not confirm an item matching the created appMsgId and title',
        );
    }
    return {
        appMsgId,
        editPath: `/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&isNew=0&type=77&appmsgid=${appMsgId}`,
    };
}
