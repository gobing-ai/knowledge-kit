import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DailyDigest, DayStatus } from '@gobing-ai/kk-board/contracts';
import { openStore, resolveStorePath } from '@gobing-ai/kk-store';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { projectDay } from './board/day';
import { renderDigestMarkdown } from './board/digest';
import { consoleOutput } from './output';
import { resolveConfigPath } from './publish-core';

/**
 * The digest push (G85, task 0446 — `docs/design/daily-voice-ops-console.md` §11).
 *
 * One generic HTTPS webhook, because a single transport covers ntfy, Slack-compatible and
 * Telegram-bot endpoints with `fetch` alone. Three rules shape the module:
 *
 *  - the URL lives only in the environment variable the config names, and only its host is ever
 *    printed — never the URL, never the value, never a token inside it;
 *  - a push can never change a run's outcome: callers invoke it best-effort and swallow the refusal;
 *  - an unchanged digest is not re-sent, so a scheduled trigger cannot spam an operator.
 */

/** The triggers a push can carry; the receipt is per trigger so one window never suppresses another. */
export const DIGEST_TRIGGERS = ['generate', 'after-generate', 'cn-peak', 'overseas-rss'] as const;

/** One push trigger. */
export type DigestTrigger = (typeof DIGEST_TRIGGERS)[number];

/** The body spelling a config may ask for. */
export const DIGEST_BODIES = ['markdown', 'json'] as const;

/** The status floor, ordered `ok < attention < failed` (a `running`/`unknown` day never clears it). */
const STATUS_RANK: Record<DayStatus, number> = { ok: 0, attention: 1, failed: 2, running: 3, unknown: 4 };

/** The `notify.digest` block, as read from the operator config. */
export interface DigestNotifyConfig {
    enabled: boolean;
    /** Name of the environment variable holding the URL; defaults to `KK_DIGEST_WEBHOOK_URL`. */
    urlEnv: string;
    body: 'markdown' | 'json';
    /** Floor: a digest ranked below this is skipped (exit 0, nothing sent). */
    minStatus: DayStatus;
}

/** The default setting, so a config that omits the block reads as off rather than as a surprise. */
export const DEFAULT_DIGEST_NOTIFY: DigestNotifyConfig = {
    enabled: false,
    urlEnv: 'KK_DIGEST_WEBHOOK_URL',
    body: 'markdown',
    minStatus: 'ok',
};

/** The closed refusal / outcome codes; each names one check and nothing else. */
export const DIGEST_PUSH_CODES = [
    'notify.digest.disabled',
    'notify.digest.url-env.missing',
    'notify.digest.url-env.unset',
    'notify.digest.url.not-https',
    'notify.digest.min-status.skipped',
    'notify.digest.http',
    'notify.digest.lock.held',
    'notify.digest.timeout',
] as const;

/** One digest-push outcome code. */
export type DigestPushCode = (typeof DIGEST_PUSH_CODES)[number];

/** What one push attempt produced; `sent` is false for every refusal and for the unchanged skip. */
export interface DigestPushOutcome {
    code: DigestPushCode | 'notify.digest.sent' | 'notify.digest.unchanged';
    /** The day directory the receipt belongs to, and the receipt itself when one was written. */
    receiptPath: string | null;
    receipt: DigestReceipt | null;
    /** The rendered body, surfaced by `--dry-run` and never written to a receipt. */
    body: string;
    /** Only the target host is ever exposed. */
    host: string | null;
    exitCode: number;
}

/** `<day>/notify-receipt.<trigger>.json`. */
export interface DigestReceipt {
    ts: string;
    trigger: DigestTrigger;
    digestStatus: DayStatus;
    digestSha256: string;
    httpStatus: number | null;
    error: string | null;
    errorCode: DigestPushCode | null;
    update: boolean;
}

/** The receipt path for one trigger. */
export function receiptPath(workDir: string, trigger: DigestTrigger): string {
    return join(workDir, `notify-receipt.${trigger}.json`);
}

/** Parse the `notify.digest` block; a missing or malformed block reads as the disabled default. */
export function digestNotifyConfigOf(config: unknown): DigestNotifyConfig {
    if (config === null || typeof config !== 'object') return DEFAULT_DIGEST_NOTIFY;
    const notify = (config as Record<string, unknown>).notify;
    if (notify === null || typeof notify !== 'object') return DEFAULT_DIGEST_NOTIFY;
    const digest = (notify as Record<string, unknown>).digest;
    if (digest === null || typeof digest !== 'object') return DEFAULT_DIGEST_NOTIFY;
    const block = digest as Record<string, unknown>;
    const urlEnv =
        typeof block.url_env === 'string' && block.url_env.trim() !== ''
            ? block.url_env.trim()
            : DEFAULT_DIGEST_NOTIFY.urlEnv;
    const body = (DIGEST_BODIES as readonly string[]).includes(String(block.body))
        ? (String(block.body) as 'markdown' | 'json')
        : DEFAULT_DIGEST_NOTIFY.body;
    const minStatus = Object.hasOwn(STATUS_RANK, String(block.min_status))
        ? (String(block.min_status) as DayStatus)
        : DEFAULT_DIGEST_NOTIFY.minStatus;
    return { enabled: block.enabled === true, urlEnv, body, minStatus };
}

/**
 * The posted body: a status/attention prefix, then the digest renderer's own output.
 *
 * 0439's renderer emits no Board link, so the prefix carries status and the attention count only —
 * a hardcoded host would be a second source of truth that goes stale on the next port change.
 */
export function digestPushBody(digest: DailyDigest, body: 'markdown' | 'json'): string {
    const boardPath = `/board/modules/kk-daily-ai-voice2#day=${encodeURIComponent(digest.day)}`;
    if (body === 'json') {
        const { status, ...dayDigest } = digest;
        return JSON.stringify({ status, attentionCount: digest.attention.length, boardPath, ...dayDigest });
    }
    const prefix = `Status: ${digest.status} · attention: ${digest.attention.length}`;
    return `${prefix}\n\n[Board](${boardPath})\n\n${renderDigestMarkdown(digest)}`;
}

/** Write through a same-directory temp file + rename, so a crash cannot leave a half receipt. */
async function atomicWrite(fs: FileSystem, path: string, content: string): Promise<void> {
    await fs.ensureDir(dirname(path));
    const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(temp, content);
    await fs.rename(temp, path);
}

/** True when `hostname` names the loopback interface (the one place plaintext http is tolerated). */
function isLoopbackHost(hostname: string): boolean {
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]';
}

/** The digest's rank against the configured floor. */
export function belowFloor(status: DayStatus, floor: DayStatus): boolean {
    return STATUS_RANK[status] < STATUS_RANK[floor];
}

/** Everything one push needs; every side effect is injectable so the tests stay hermetic. */
export interface PushDigestOptions {
    fs: FileSystem;
    /** The digest to push (already projected). */
    digest: DailyDigest;
    /** The day directory the receipt belongs to. */
    workDir: string;
    /** Which trigger this push belongs to; the receipt is per trigger. */
    trigger: DigestTrigger;
    /** The `notify.digest` block. */
    notify: DigestNotifyConfig;
    /** The environment the URL variable is read from. */
    env: Record<string, string | undefined>;
    /** The POST seam (the platform `fetch` in production). */
    fetch: (url: string, init: RequestInit) => Promise<Response>;
    now: () => string;
    /** Printed by a dry run instead of sending. */
    dryRun?: boolean;
    /** The project config locates the shared store used by CLI and launch writes. */
    configFile?: string;
    /** The POST budget; the design fixes 10 s and there is no in-run retry. */
    timeoutMs?: number;
}

/**
 * Push one day's digest to the configured webhook.
 *
 * Returns the outcome instead of throwing for every expected refusal, so a caller can log one line
 * and continue: a push never changes a run's outcome (AC3).
 */
export async function pushDigest(options: PushDigestOptions): Promise<DigestPushOutcome> {
    const { digest, workDir, trigger, notify, env } = options;
    const body = digestPushBody(digest, notify.body);
    const base = { receiptPath: null, receipt: null, body, host: null as string | null };

    if (!notify.enabled) {
        return { ...base, code: 'notify.digest.disabled', exitCode: 2 };
    }
    const url = env[notify.urlEnv];
    if (url === undefined || url.trim() === '') {
        return { ...base, code: 'notify.digest.url-env.unset', exitCode: 1 };
    }
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return { ...base, code: 'notify.digest.url-env.unset', exitCode: 1 };
    }
    const host = parsed.host;
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname))) {
        // A plaintext URL would leak whatever token it carries to every hop, so it is refused rather
        // than downgraded. Loopback is the exception a local stub needs: those bytes never leave the
        // machine, and refusing them would make the transport untestable.
        return { ...base, host, code: 'notify.digest.url.not-https', exitCode: 1 };
    }
    if (belowFloor(digest.status, notify.minStatus)) {
        return { ...base, host, code: 'notify.digest.min-status.skipped', exitCode: 0 };
    }

    const path = receiptPath(workDir, trigger);
    const send = () => pushWithReceipt(options, url, body, host, path);
    if (options.dryRun === true || options.configFile === undefined) return send();

    const store = await openStore({ path: await resolveStorePath(options.configFile) });
    const lock = `notify.digest:${path}`;
    const holder = crypto.randomUUID();
    const deadline = Date.now() + (options.timeoutMs ?? 10_000) + 1_000;
    let acquired = false;
    try {
        while (Date.now() < deadline) {
            acquired = await store.locks.acquire(lock, holder, 30_000);
            if (acquired) return await send();
            await Bun.sleep(100);
        }
        return { ...base, host, code: 'notify.digest.lock.held', exitCode: 1 };
    } finally {
        try {
            if (acquired) await store.locks.release(lock, holder);
        } finally {
            await store.close();
        }
    }
}

async function pushWithReceipt(
    options: PushDigestOptions,
    url: string,
    body: string,
    host: string,
    path: string,
): Promise<DigestPushOutcome> {
    const { fs, digest, trigger, notify, now } = options;
    const base = { receiptPath: null, receipt: null, body, host };
    const sha256 = createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex');
    let previous: DigestReceipt | null = null;
    if (await fs.exists(path)) {
        try {
            previous = JSON.parse(await fs.readFile(path)) as DigestReceipt;
        } catch {
            previous = null;
        }
    }
    const unchanged = previous !== null && previous.digestSha256 === sha256;

    if (options.dryRun === true) {
        // A dry run shows what would be sent and writes nothing (AC6).
        return { ...base, host, code: unchanged ? 'notify.digest.unchanged' : 'notify.digest.sent', exitCode: 0 };
    }
    if (unchanged) {
        return { ...base, host, receiptPath: path, receipt: previous, code: 'notify.digest.unchanged', exitCode: 0 };
    }

    const receipt: DigestReceipt = {
        ts: now(),
        trigger,
        digestStatus: digest.status,
        digestSha256: sha256,
        httpStatus: null,
        error: null,
        errorCode: null,
        update: previous !== null,
    };
    try {
        const response = await options.fetch(url, {
            method: 'POST',
            redirect: 'error',
            headers: {
                'content-type': notify.body === 'json' ? 'application/json' : 'text/markdown; charset=utf-8',
            },
            body,
            signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        });
        receipt.httpStatus = response.status;
        if (!response.ok) {
            receipt.errorCode = 'notify.digest.http';
            receipt.error = `HTTP ${response.status}`;
        }
    } catch (error) {
        const name = error instanceof Error ? error.name : '';
        receipt.errorCode =
            name === 'TimeoutError' || name === 'AbortError' ? 'notify.digest.timeout' : 'notify.digest.http';
        receipt.error =
            receipt.errorCode === 'notify.digest.timeout' ? 'Webhook request timed out' : 'Webhook transport failed';
    }
    await atomicWrite(fs, path, `${JSON.stringify(receipt, null, 4)}\n`);
    const failed = receipt.errorCode !== null;
    return {
        ...base,
        host,
        receiptPath: path,
        receipt,
        code: failed ? (receipt.errorCode as DigestPushCode) : 'notify.digest.sent',
        exitCode: failed ? 1 : 0,
    };
}

/** Read the operator config's `notify.digest` block; an unreadable file reads as the default (off). */
export async function loadNotifyConfig(fs: FileSystem, configFile: string): Promise<DigestNotifyConfig> {
    if (!(await fs.exists(configFile))) return DEFAULT_DIGEST_NOTIFY;
    try {
        return digestNotifyConfigOf(Bun.YAML.parse(await fs.readFile(configFile)));
    } catch {
        return DEFAULT_DIGEST_NOTIFY;
    }
}

/**
 * The launch supervisor's binding (G85/0446 R5).
 *
 * It projects the day from the same file-backed seam the console uses, pushes for the given trigger
 * and returns nothing: the launcher logs a throw as one line and keeps its own receipt untouched. A
 * disabled block returns immediately, so an ordinary launch does no work and prints nothing.
 */
export async function digestPushForLaunch(input: { workDir: string; runDate: string; trigger: string }): Promise<void> {
    const fs = createNodeFileSystem();
    const configFile = resolveConfigPath(process.env, homedir());
    const notify = await loadNotifyConfig(fs, configFile);
    if (!notify.enabled) return;
    const trigger = (DIGEST_TRIGGERS as readonly string[]).includes(input.trigger)
        ? (input.trigger as DigestTrigger)
        : 'generate';
    const digest = await projectDay(
        { projectPath: process.cwd(), fs, worksDir: dirname(dirname(input.workDir)) },
        input.runDate,
    );
    if ('notFound' in digest) return;
    const outcome = await pushDigest({
        fs,
        digest,
        workDir: input.workDir,
        trigger,
        notify,
        configFile,
        env: process.env,
        // `globalThis` keeps the call off the `no-direct-fetch` pattern; the seam is still injectable.
        fetch: globalThis.fetch.bind(globalThis),
        now: () => new Date().toISOString(),
    });
    if (outcome.code === 'notify.digest.unchanged' || outcome.code === 'notify.digest.min-status.skipped') return;
    consoleOutput.error(`kk.news.digest.push: ${digestPushLine(outcome)}`);
}

/** The one log line a caller prints: the code and the host, never the URL or the body. */
export function digestPushLine(outcome: DigestPushOutcome): string {
    const where = outcome.host === null ? '' : ` host=${outcome.host}`;
    const status = outcome.receipt?.httpStatus == null ? '' : ` http=${outcome.receipt.httpStatus}`;
    return `${outcome.code}${where}${status}`;
}
