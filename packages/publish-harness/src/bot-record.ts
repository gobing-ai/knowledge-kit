/**
 * Bot session transcripts — the durable record a channel rail is generated from (task 0382 R1/R2/R6).
 *
 * A transcript is what an operator's measured session actually did: navigations, clicks, keystrokes,
 * file choices and the responses the site answered with. It exists because selector guessing failed
 * in the field: on 2026-11-16 four social rails were hand-measured, two were recorded, and the
 * recorded selectors were right where the guessed ones were wrong. Recording is transport work, so
 * it lives here; the CLI leaf and codegen/replay sit beside this module.
 *
 * Privacy is part of the format, not a flag on a writer: typed text is a length marker unless the
 * operator opts in, secret-shaped response keys are replaced at any depth, and the file is 0600.
 */
import { basename, join } from 'node:path';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import type { BrowserContext, Response } from 'playwright';
import { chmod } from './bot-fs';
import type { NormalizedSelector } from './bot-record-normalize';
import { normalizeTarget } from './bot-record-normalize';

/** Response bodies are capped: a transcript is evidence, not an archive. */
const MAX_RESPONSE_BODY_BYTES = 64 * 1024;

/** Keys whose value is a credential, replaced wherever they appear. */
const SECRET_KEY_PATTERN = /token|secret|password|cookie|session|auth/i;

/** Methods that mutate site state; a read response is never evidence of a publish. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/** One ordered step of a recorded session. */
export type TranscriptStep =
    | { i: number; t: number; kind: 'navigate'; url: string }
    | {
          i: number;
          t: number;
          kind: 'click';
          url: string;
          target: NormalizedSelector;
          text?: string;
          submit?: boolean;
      }
    | { i: number; t: number; kind: 'key'; url: string; target: NormalizedSelector; key: string }
    | {
          i: number;
          t: number;
          kind: 'type';
          url: string;
          target: NormalizedSelector;
          text: string | { redacted: true; length: number };
      }
    | { i: number; t: number; kind: 'file'; url: string; target: NormalizedSelector; fileName: string }
    | {
          i: number;
          t: number;
          kind: 'response';
          method: 'POST' | 'PUT' | 'PATCH';
          url: string;
          status: number;
          body?: unknown;
          truncated?: boolean;
      };

/** A recorded session, versioned so a reader never guesses a shape. */
export interface BotTranscript {
    schemaVersion: 1;
    bot: string;
    /** Origin + pathname of the page the recording started on; the query is dropped. */
    startUrl: string;
    recordedAt: string;
    /** False only when the operator passed `--include-text`. */
    redacted: boolean;
    steps: TranscriptStep[];
}

/** One page-side event, posted to the host through the recorder binding. */
export type RecordedEvent =
    | { kind: 'navigate'; url: string; t: number }
    | {
          kind: 'click';
          url: string;
          t: number;
          snapshot: { nodes: unknown[]; targetIndex: number };
          text?: string;
      }
    | { kind: 'key'; url: string; t: number; snapshot: { nodes: unknown[]; targetIndex: number }; key: string }
    | { kind: 'type'; url: string; t: number; snapshot: { nodes: unknown[]; targetIndex: number }; text: string }
    | {
          kind: 'file';
          url: string;
          t: number;
          snapshot: { nodes: unknown[]; targetIndex: number };
          fileName: string;
      };

/** Strip the query and fragment: a fragment never leaves the client and a query can carry a grant. */
export function redactUrl(url: string): string {
    try {
        const parsed = new URL(url);
        return `${parsed.origin}${parsed.pathname}`;
    } catch {
        return url.split(/[?#]/)[0] ?? url;
    }
}

/** Replace every secret-shaped value at any depth; array order and non-secret values survive. */
export function redactJson(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((entry) => redactJson(entry));
    if (value === null || typeof value !== 'object') return value;
    const redacted: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        redacted[key] = SECRET_KEY_PATTERN.test(key) ? '<redacted>' : redactJson(entry);
    }
    return redacted;
}

/** A transcript with no steps yet. */
export function emptyTranscript(input: { bot: string; startUrl: string; redacted: boolean }): BotTranscript {
    return {
        schemaVersion: 1,
        bot: input.bot,
        startUrl: redactUrl(input.startUrl),
        recordedAt: new Date().toISOString(),
        redacted: input.redacted,
        steps: [],
    };
}

/** `Omit` over a union distributes; a plain `Omit<TranscriptStep,'i'>` collapses the union. */
type WithoutIndex<T> = T extends unknown ? Omit<T, 'i'> : never;

/** Append one step with its contiguous index; returns the step that was appended. */
function append(transcript: BotTranscript, step: WithoutIndex<TranscriptStep>): TranscriptStep {
    const recorded = { ...step, i: transcript.steps.length } as TranscriptStep;
    transcript.steps.push(recorded);
    return recorded;
}

/** Redacted-or-verbatim typed text, the one place the redaction decision is made. */
function recordedText(text: string, includeText: boolean): { text: string | { redacted: true; length: number } } {
    return { text: includeText ? text : { redacted: true, length: text.length } };
}

/** Number of characters a (possibly redacted) type step carries. */
function typeLength(text: string | { redacted: true; length: number }): number {
    return typeof text === 'string' ? text.length : text.length;
}

/**
 * Fold one page-side event into the transcript (R1/R2/R6).
 *
 * Returns the appended step, or `null` when the event must not be recorded: an invisible target
 * (the DOM carries hidden duplicates) or a snapshot the page never resolved. Printable keystrokes on
 * one target coalesce into a single `type` step — that is what keeps redacted text one length marker
 * — and any non-printable key or a click breaks the run.
 */
export function applyRecordedEvent(
    transcript: BotTranscript,
    event: RecordedEvent,
    options: { includeText?: boolean } = {},
): TranscriptStep | null {
    const includeText = options.includeText === true;
    if (event.kind === 'navigate') {
        return append(transcript, { t: event.t, kind: 'navigate', url: redactUrl(event.url) });
    }

    const target = normalizeTarget(event.snapshot as Parameters<typeof normalizeTarget>[0]);
    if (target === null) return null;
    const url = redactUrl(event.url);

    if (event.kind === 'click') {
        return append(transcript, {
            t: event.t,
            kind: 'click',
            url,
            target,
            ...(event.text === undefined || event.text === '' ? {} : { text: event.text }),
        });
    }
    if (event.kind === 'key') {
        return append(transcript, { t: event.t, kind: 'key', url, target, key: event.key });
    }
    if (event.kind === 'file') {
        return append(transcript, { t: event.t, kind: 'file', url, target, fileName: basename(event.fileName) });
    }

    const last = transcript.steps.at(-1);
    if (last !== undefined && last.kind === 'type' && JSON.stringify(last.target) === JSON.stringify(target)) {
        const merged = typeLength(last.text) + event.text.length;
        last.text = includeText
            ? `${typeof last.text === 'string' ? last.text : ''}${event.text}`
            : { redacted: true, length: merged };
        return last;
    }
    return append(transcript, { t: event.t, kind: 'type', url, target, ...recordedText(event.text, includeText) });
}

/** Atomic transcript write: tmp + rename, mode 0600, so a crash loses at most the in-flight step. */
export async function writeTranscript(
    path: string,
    transcript: BotTranscript,
    options: { fileSystem?: FileSystem } = {},
): Promise<void> {
    const fileSystem = options.fileSystem ?? createNodeFileSystem();
    const temp = `${path}.tmp-${process.pid}`;
    await fileSystem.writeFile(temp, `${JSON.stringify(transcript, null, 2)}\n`);
    // Narrow before the rename, never after: a file that appears at the final path is already 0600.
    chmod(temp, 0o600);
    await fileSystem.rename(temp, path);
}

/** Refusal for a transcript whose text was recorded verbatim. */
class UnredactedTranscriptError extends Error {
    constructor(path: string) {
        super(
            `transcript ${path} was recorded unredacted — replay/codegen refuse it unless --allow-unredacted is given`,
        );
        this.name = 'UnredactedTranscriptError';
    }
}

/** Read one transcript, refusing an unredacted or unexpected-schema file instead of guessing. */
export async function readTranscript(
    path: string,
    options: { fileSystem?: FileSystem; allowUnredacted?: boolean } = {},
): Promise<BotTranscript> {
    const fileSystem = options.fileSystem ?? createNodeFileSystem();
    const raw = await fileSystem.readFile(path);
    const parsed = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)) as BotTranscript;
    if (parsed.schemaVersion !== 1) {
        throw new Error(`transcript ${path} has schemaVersion ${String(parsed.schemaVersion)}; this kk reads 1`);
    }
    if (parsed.redacted !== true && options.allowUnredacted !== true) throw new UnredactedTranscriptError(path);
    return parsed;
}

/** Default transcript path for a bot recording: `.spur/run/bot-record-<bot>-<stamp>.json`. */
export function defaultTranscriptPath(bot: string, now: Date = new Date()): string {
    const stamp = now.toISOString().replace(/[:.]/g, '').slice(0, 15);
    return join('.spur', 'run', `bot-record-${bot}-${stamp}.json`);
}

/** Read the response body as JSON, capped; `undefined` when it is not JSON or exceeds the cap. */
async function readResponseBody(response: Response): Promise<{ body?: unknown; truncated?: boolean }> {
    try {
        const length = Number.parseInt((await response.headerValue('content-length')) ?? '', 10);
        const truncated = Number.isFinite(length) && length > MAX_RESPONSE_BODY_BYTES;
        if (truncated) return { truncated: true };
        return { body: redactJson(await response.json()) };
    } catch {
        return {};
    }
}

/** The page-side event tape a transcript is built from, plus the sink that persists each step. */
export interface TranscriptRecorderOptions {
    context: BrowserContext;
    transcript: BotTranscript;
    fileSystem?: FileSystem;
    /** Persist after every step; the default is a no-op when the recorder is in-memory (tests). */
    persist?: () => Promise<void>;
    includeText?: boolean;
}

/**
 * Capture mutating JSON responses into the transcript (R1). Clicks and keystrokes arrive through the
 * `__kkRecord` binding the recorder installs in the page; this half owns the network evidence, which
 * a page-side listener cannot see.
 */
export function attachTranscriptRecorder(options: TranscriptRecorderOptions): void {
    const { context, transcript } = options;
    context.on('response', (response) => {
        const method = response.request().method().toUpperCase();
        if (!MUTATING_METHODS.has(method)) return;
        void (async () => {
            const contentType = (await response.headerValue('content-type')) ?? '';
            if (!contentType.includes('application/json')) return;
            const { body, truncated } = await readResponseBody(response);
            append(transcript, {
                t: Date.now(),
                kind: 'response',
                method: method as 'POST' | 'PUT' | 'PATCH',
                url: redactUrl(response.url()),
                status: response.status(),
                ...(body === undefined ? {} : { body }),
                ...(truncated === true ? { truncated: true } : {}),
            });
            await options.persist?.();
        })().catch(() => {
            // A response that cannot be read is not evidence; the recording keeps going.
        });
    });
}

/** Page-side script: describe every interactive node and post the event target to the host. */
export const RECORDER_INIT_SCRIPT = `(() => {
    if (globalThis.__kkRecorderInstalled) return;
    globalThis.__kkRecorderInstalled = true;
    const INTERACTIVE = 'button, a, input, textarea, select, [role=button], [role=link], [role=textbox], [role=menuitem], [contenteditable=true]';
    const attr = (el, name) => el.getAttribute(name) ?? undefined;
    function pathOf(el) {
        const parts = [];
        for (let node = el; node && node.nodeType === 1 && parts.length < 12; node = node.parentElement) {
            let part = node.tagName.toLowerCase();
            for (const name of ['data-testid', 'name', 'aria-label', 'role']) {
                const value = node.getAttribute(name);
                if (value) part += '[' + name + '="' + value.replace(/"/g, '\\\\"') + '"]';
            }
            const siblings = node.parentElement ? [...node.parentElement.children].filter((s) => s.tagName === node.tagName) : [];
            if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
            parts.unshift(part);
        }
        return parts.join(' > ');
    }
    const describe = (el) => ({
        tag: el.tagName.toLowerCase(),
        ...(attr(el, 'data-testid') ? { testid: attr(el, 'data-testid') } : {}),
        ...(attr(el, 'name') ? { name: attr(el, 'name') } : {}),
        ...(attr(el, 'aria-label') ? { ariaLabel: attr(el, 'aria-label') } : {}),
        ...(attr(el, 'role') ? { role: attr(el, 'role') } : {}),
        text: (el.textContent ?? '').trim().replace(/\\s+/g, ' ').slice(0, 120),
        visible: el.checkVisibility ? el.checkVisibility() : el.offsetParent !== null,
        path: pathOf(el),
    });
    function snapshot(el) {
        const nodes = [...document.querySelectorAll(INTERACTIVE)].map(describe);
        const index = nodes.findIndex((node) => node.path === pathOf(el));
        return { nodes, targetIndex: index };
    }
    const post = (event) => globalThis.__kkRecord?.({ ...event, url: location.href, t: Date.now() });
    document.addEventListener('click', (e) => {
        const el = e.target instanceof Element ? e.target.closest(INTERACTIVE) : null;
        if (el) post({ kind: 'click', snapshot: snapshot(el), text: (el.textContent ?? '').trim().slice(0, 120) });
    }, true);
    document.addEventListener('keydown', (e) => {
        if (e.key.length === 1) return;
        const el = document.activeElement instanceof Element ? document.activeElement.closest(INTERACTIVE) : null;
        if (el) post({ kind: 'key', snapshot: snapshot(el), key: e.key });
    }, true);
    document.addEventListener('input', (e) => {
        const el = e.target instanceof Element ? e.target.closest(INTERACTIVE) : null;
        if (!el) return;
        const inserted = typeof e.data === 'string' ? e.data : '';
        if (inserted !== '') post({ kind: 'type', snapshot: snapshot(el), text: inserted });
    }, true);
    document.addEventListener('change', (e) => {
        const el = e.target;
        if (!(el instanceof HTMLInputElement) || el.type !== 'file') return;
        const name = el.files && el.files[0] ? el.files[0].name : '';
        if (name !== '') post({ kind: 'file', snapshot: snapshot(el), fileName: name });
    }, true);
})();`;

/**
 * Detach the SIGINT listeners added since `before` and return a function that reattaches them.
 *
 * Playwright's launch installs a SIGINT handler that closes the browser and then calls
 * `process.exit(130)`, which beat the async flush-and-release and leaked the lease marker (0382 AC2,
 * measured 2026-11-17). A caller that owns the signal for a headed session parks it for the duration.
 */
export function parkSigintListenersSince(before: ReadonlySet<(signal: 'SIGINT') => void>): () => void {
    const parked = process.listeners('SIGINT').filter((listener) => !before.has(listener));
    for (const listener of parked) process.off('SIGINT', listener);
    return () => {
        for (const listener of parked) process.on('SIGINT', listener);
    };
}

/** Options for {@link recordBotSession}. */
export interface RecordBotOptions {
    /** Transcript path; defaults to {@link defaultTranscriptPath} under the cwd. */
    out?: string;
    /** Keep typed text verbatim instead of a length marker (R6). */
    includeText?: boolean;
    /** Bot profile root; default `~/.config/kk/browser-profiles`. */
    root?: string;
    /** Lease root; default `~/.config/kk/browser-leases`. */
    leaseRoot?: string;
    /** Injected FileSystem for metadata and transcript IO. */
    fileSystem?: FileSystem;
    /** Launcher override; the default borrows this invocation's profile lease. */
    launcher?: import('./browser').BrowserLauncher;
    /** URL to open when the profile carries no saved metadata (legacy fixed-profile bots). */
    defaultUrl?: string;
}

/** Outcome of a finished recording. */
export interface RecordBotResult {
    name: string;
    out: string;
    startUrl: string;
    stepCount: number;
    redacted: boolean;
    /** Set when SIGINT/SIGTERM ended the recording; the CLI maps it to exit 130/143. */
    signal?: 'SIGINT' | 'SIGTERM';
}

/**
 * Record one operator session with a named bot (R1).
 *
 * The bot's saved profile is opened headed under one lease — `openBot`'s non-adapter path, copied
 * rather than delegated, because an adapter-bound bot runs in a plugin child process where nothing
 * can be instrumented. Closing the window ends the recording normally; SIGINT/SIGTERM close the
 * context, flush the transcript and set 130/143, so no lease marker survives any exit path (a leaked
 * marker refused the next channel preflight twice on 2026-11-16).
 */
export async function recordBotSession(name: string, options: RecordBotOptions = {}): Promise<RecordBotResult> {
    const { acquireProfileLease, closeBotContext, createKkBrowserLauncher, missingBotProfile, openBotPage } =
        await import('./browser');
    const { readBotSavedMetadata, resolveBotProfileDir } = await import('./browser');
    const fileSystem = options.fileSystem ?? createNodeFileSystem();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) {
        throw new Error(`bot name '${name}' does not match [A-Za-z0-9][A-Za-z0-9_-]{0,63}`);
    }
    const profileDir = resolveBotProfileDir(name, { root: options.root });
    const saved = await readBotSavedMetadata(name, { root: options.root, fileSystem });
    const startUrl = saved?.defaultUrl ?? options.defaultUrl;
    if (startUrl === undefined) throw missingBotProfile(name, true);

    const out = options.out ?? defaultTranscriptPath(name);
    const transcript = emptyTranscript({ bot: name, startUrl, redacted: options.includeText !== true });
    const persist = () => writeTranscript(out, transcript, { fileSystem });

    const lease = await acquireProfileLease(profileDir, { leaseRoot: options.leaseRoot, fileSystem });
    let context: BrowserContext | undefined;
    // Memoized so the `finally` awaits a signal-started flush instead of returning while it is in flight.
    let flushing: Promise<void> | undefined;
    let interrupted: 'SIGINT' | 'SIGTERM' | undefined;
    const flushAndRelease = (signal?: 'SIGINT' | 'SIGTERM'): Promise<void> => {
        flushing ??= (async () => {
            interrupted = signal;
            if (signal === 'SIGINT') process.exitCode = 130;
            if (signal === 'SIGTERM') process.exitCode = 143;
            await closeBotContext(context);
            await persist();
            await lease.release();
        })();
        return flushing;
    };
    const onSigint = () => void flushAndRelease('SIGINT');
    const onSigterm = () => void flushAndRelease('SIGTERM');
    const sigintBefore = new Set(process.listeners('SIGINT'));
    let unpark: (() => void) | undefined;

    try {
        const launcher =
            options.launcher ??
            createKkBrowserLauncher(
                undefined,
                { lease, physicalProfileDir: profileDir },
                { leaseRoot: options.leaseRoot, fileSystem },
            );
        context = await launcher.launch({ profileDir, headless: false });
        unpark = parkSigintListenersSince(sigintBefore);
        const closed = new Promise<void>((resolve) => context?.once('close', () => resolve()));
        await context.exposeBinding('__kkRecord', (_source, event: RecordedEvent) => {
            const step = applyRecordedEvent(transcript, event, { includeText: options.includeText === true });
            if (step !== null) void persist();
            return step !== null;
        });
        await context.addInitScript(RECORDER_INIT_SCRIPT);
        attachTranscriptRecorder({ context, transcript, fileSystem, persist, includeText: options.includeText });
        process.once('SIGINT', onSigint);
        process.once('SIGTERM', onSigterm);
        const page = await openBotPage(context);
        // The first navigation is step 0 evidence: the recording starts from the saved page.
        applyRecordedEvent(transcript, { kind: 'navigate', url: startUrl, t: Date.now() });
        await persist();
        await page.goto(startUrl);
        applyRecordedEvent(transcript, { kind: 'navigate', url: page.url(), t: Date.now() });
        await persist();
        await closed;
        return {
            name,
            out,
            startUrl: transcript.startUrl,
            stepCount: transcript.steps.length,
            redacted: transcript.redacted,
            ...(interrupted === undefined ? {} : { signal: interrupted }),
        };
    } finally {
        process.off('SIGINT', onSigint);
        process.off('SIGTERM', onSigterm);
        await flushAndRelease();
        unpark?.();
    }
}
