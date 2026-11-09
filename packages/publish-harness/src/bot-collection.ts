import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import type { BrowserContext, Page } from 'playwright';
import { assertSafeBotName, BotError, resolveBotProfileDir } from './bot';
import { lstat } from './bot-fs';
import {
    type BotSessionOptions,
    closeBotContext,
    createKkBrowserLauncher,
    execFailureDetail,
    missingBotProfile,
    openBotPage,
    validateExecUrl,
} from './browser';
import { type AcquireProfileLeaseOptions, acquireProfileLease, type ProfileLease } from './profile-lease';

/**
 * Rendered, authenticated data collection with one named bot session (0346, ADR-038 amendment).
 *
 * A plan is JSON data, so an ingestion plugin and the repository probe drive exactly the same
 * runner: one profile lease, one headless launch, an ordered step list, and pre-registered
 * response captures. Site selectors, pagination and politeness stay in the plugin — this module
 * owns execution, capture, classification and cleanup only, and it never reads or exports cookies.
 */

/** Per-step default; overridable per step and clamped to the whole-run budget. */
const DEFAULT_STEP_TIMEOUT_MS = 30_000;
/** Whole-run default; `plan.timeoutMs` may raise it up to {@link MAX_RUN_TIMEOUT_MS}. */
const DEFAULT_RUN_TIMEOUT_MS = 120_000;
/** Whole-run ceiling: one launch must not become an unbounded process. */
const MAX_RUN_TIMEOUT_MS = 600_000;
/** Per-artifact body ceiling, applied after the read (see the `shortcut:` at {@link readBody}). */
const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
/** Aggregate ceiling across every returned artifact body. */
const MAX_AGGREGATE_BYTES = 20 * 1024 * 1024;
/** Artifact-count ceiling across responses and extractions. */
const MAX_ARTIFACTS = 100;
/** One namespace for step and capture ids: safe to print, safe to use as a file name. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** Deterministic auth-wall rule (R4): a final URL whose path carries an auth segment. */
const AUTH_PATH = /(?:^|\/)(?:login|signin|sign-in|auth|sso)(?:\/|$)/i;
const NAVIGATION_WAIT_UNTIL = ['load', 'domcontentloaded', 'networkidle'] as const;

/** One ordered step of a {@link BotCollectionPlan}; every variant is JSON-serializable data. */
export type BotCollectionStep =
    | {
          id: string;
          type: 'request';
          url: string;
          method?: string;
          headers?: Record<string, string>;
          data?: string;
          followRedirects?: boolean;
          timeoutMs?: number;
      }
    | {
          id: string;
          type: 'navigate';
          url: string;
          waitUntil?: (typeof NAVIGATION_WAIT_UNTIL)[number];
          timeoutMs?: number;
      }
    | { id: string; type: 'wait'; selector: string; timeoutMs?: number }
    | { id: string; type: 'click'; selector: string; timeoutMs?: number }
    | { id: string; type: 'scroll'; deltaY: number; timeoutMs?: number }
    | {
          id: string;
          type: 'extract';
          format: 'html' | 'text';
          selector?: string;
          timeoutMs?: number;
      };

/**
 * One required response capture: every matching response body becomes an artifact, and a
 * declaration that matches nothing (or only empty bodies) fails the run as `empty`.
 */
export interface BotResponseCapture {
    id: string;
    /** Exact scheme/host/port; path, query, fragment and credentials are rejected. */
    origin?: string;
    /** Absolute URL pathname prefix; `?` and `#` are rejected. */
    pathPrefix: string;
}

/** One returned body. `url` is origin+pathname only — query and fragment never leave the runner. */
export interface BotCollectionArtifact {
    id: string;
    kind: 'request' | 'response' | 'html' | 'text';
    body: string;
    status?: number;
    url?: string;
    /** Zero-based position in `plan.steps`; absent for a response capture. */
    stepIndex?: number;
}

/** What one step did, in declaration order. `index` is the position in `plan.steps`. */
export interface BotCollectionStepResult {
    index: number;
    id: string;
    type: BotCollectionStep['type'];
    url?: string;
}

/** Successful collection: the executed steps and every artifact they produced. */
export interface BotCollectionResult {
    steps: BotCollectionStepResult[];
    artifacts: BotCollectionArtifact[];
}

/** The frozen, validated plan shape — JSON data, never callbacks. */
export interface BotCollectionPlan {
    steps: BotCollectionStep[];
    responses?: BotResponseCapture[];
    /** Whole invocation; default 120_000, valid 1..600_000. */
    timeoutMs?: number;
}

/** Session options plus the two deterministic seams the fake-launcher tests need. */
export interface BotCollectionOptions extends BotSessionOptions {
    /** Lease seam; default {@link acquireProfileLease}. One acquisition per invocation. */
    acquireLease?: (profileDir: string, options?: AcquireProfileLeaseOptions) => Promise<ProfileLease>;
    /** Clock seam for deadline arithmetic; default `Date.now`. */
    now?: () => number;
}

/** A validated plan plus the normalized whole-run deadline. */
interface NormalizedPlan {
    steps: BotCollectionStep[];
    timeoutMs: number;
}

/** One capture declaration's in-flight state. */
interface CaptureState {
    declaration: BotResponseCapture;
    matches: Array<{ status: number; text: string; url: string }>;
    pending: Promise<void>[];
    /** Matched-but-unreadable bodies; only fatal when the declaration ends with no usable artifact. */
    readFailures: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function usage(path: string): BotError {
    return new BotError('usage', `invalid collection plan: ${path}`);
}

function requireSafeId(value: unknown, path: string, seen: Set<string>): string {
    if (typeof value !== 'string' || !SAFE_ID.test(value))
        throw usage(`${path} must match [A-Za-z0-9][A-Za-z0-9_-]{0,63}`);
    if (seen.has(value)) throw usage(`${path} duplicates an id already declared in this plan`);
    seen.add(value);
    return value;
}

function requireString(value: unknown, path: string): string {
    if (typeof value !== 'string' || value.trim() === '') throw usage(`${path} must be a non-empty string`);
    return value;
}

function optionalString(value: unknown, path: string): string | undefined {
    return value === undefined ? undefined : requireString(value, path);
}

function optionalTimeout(value: unknown, path: string): number | undefined {
    return value === undefined ? undefined : requirePositiveInt(value, path);
}

function requirePositiveInt(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        throw usage(`${path} must be a positive integer`);
    }
    return value;
}

function requireHeaders(value: unknown, path: string): Record<string, string> {
    if (!isRecord(value)) throw usage(`${path} must be an object of string header values`);
    const headers: Record<string, string> = {};
    for (const [name, headerValue] of Object.entries(value)) {
        headers[name] = requireString(headerValue, `${path}.${name}`);
    }
    return headers;
}

function requireUrl(value: unknown, path: string): string {
    try {
        return validateExecUrl(requireString(value, path));
    } catch {
        throw usage(`${path} must be an absolute http(s) URL without credentials`);
    }
}

function normalizeOrigin(value: unknown, path: string): string {
    const raw = requireString(value, path);
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        throw usage(`${path} must be an absolute http(s) origin`);
    }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.origin !== raw) {
        throw usage(`${path} must be an exact http(s) scheme/host/port origin`);
    }
    return parsed.origin;
}

function normalizePathPrefix(value: unknown, path: string): string {
    const prefix = requireString(value, path);
    if (!prefix.startsWith('/') || prefix.includes('?') || prefix.includes('#')) {
        throw usage(`${path} must be an absolute URL path without query or fragment`);
    }
    return prefix;
}

/** Validate one step and rebuild it, so unlisted keys never reach the executor. */
function normalizeStep(raw: unknown, path: string, seen: Set<string>): BotCollectionStep {
    if (!isRecord(raw)) throw usage(path);
    const id = requireSafeId(raw.id, `${path}.id`, seen);
    switch (raw.type) {
        case 'request': {
            if (raw.data !== undefined && typeof raw.data !== 'string') throw usage(`${path}.data must be a string`);
            if (raw.followRedirects !== undefined && typeof raw.followRedirects !== 'boolean') {
                throw usage(`${path}.followRedirects must be a boolean`);
            }
            return {
                id,
                type: 'request',
                url: requireUrl(raw.url, `${path}.url`),
                ...(raw.method === undefined ? {} : { method: requireString(raw.method, `${path}.method`) }),
                ...(raw.headers === undefined ? {} : { headers: requireHeaders(raw.headers, `${path}.headers`) }),
                ...(raw.data === undefined ? {} : { data: raw.data }),
                ...(raw.followRedirects === undefined ? {} : { followRedirects: raw.followRedirects }),
                ...(rawTimeout(raw.timeoutMs, path) ?? {}),
            };
        }
        case 'navigate': {
            const waitUntil = raw.waitUntil;
            if (waitUntil !== undefined && !NAVIGATION_WAIT_UNTIL.includes(waitUntil as never)) {
                throw usage(`${path}.waitUntil must be one of ${NAVIGATION_WAIT_UNTIL.join(', ')}`);
            }
            return {
                id,
                type: 'navigate',
                url: requireUrl(raw.url, `${path}.url`),
                ...(waitUntil === undefined ? {} : { waitUntil: waitUntil as (typeof NAVIGATION_WAIT_UNTIL)[number] }),
                ...(rawTimeout(raw.timeoutMs, path) ?? {}),
            };
        }
        case 'wait':
        case 'click':
            return {
                id,
                type: raw.type,
                selector: requireString(raw.selector, `${path}.selector`),
                ...(rawTimeout(raw.timeoutMs, path) ?? {}),
            };
        case 'scroll': {
            const deltaY = raw.deltaY;
            if (typeof deltaY !== 'number' || !Number.isFinite(deltaY) || deltaY === 0) {
                throw usage(`${path}.deltaY must be a finite non-zero number`);
            }
            return { id, type: 'scroll', deltaY, ...(rawTimeout(raw.timeoutMs, path) ?? {}) };
        }
        case 'extract': {
            if (raw.format !== 'html' && raw.format !== 'text') throw usage(`${path}.format must be "html" or "text"`);
            const selector = optionalString(raw.selector, `${path}.selector`);
            return {
                id,
                type: 'extract',
                format: raw.format,
                ...(selector === undefined ? {} : { selector }),
                ...(rawTimeout(raw.timeoutMs, path) ?? {}),
            };
        }
        default:
            throw usage(`${path}.type must be request, navigate, wait, click, scroll or extract`);
    }
}

function rawTimeout(value: unknown, path: string): { timeoutMs: number } | undefined {
    const timeoutMs = optionalTimeout(value, `${path}.timeoutMs`);
    return timeoutMs === undefined ? undefined : { timeoutMs };
}

/**
 * Validate a plan completely before any profile, lease or browser side effect (R3). Only the
 * field path is named — a supplied value can carry a token in its query.
 */
function normalizePlan(plan: unknown): NormalizedPlan {
    if (!isRecord(plan)) throw usage('plan must be a JSON object');
    if (!Array.isArray(plan.steps)) throw usage('plan.steps must be an array');
    if (plan.responses !== undefined && !Array.isArray(plan.responses)) throw usage('plan.responses must be an array');

    const seen = new Set<string>();
    const steps = plan.steps.map((step, index) => normalizeStep(step, `plan.steps[${index}]`, seen));
    const responses = (plan.responses ?? []).map((raw, index) => {
        const path = `plan.responses[${index}]`;
        if (!isRecord(raw)) throw usage(path);
        return {
            id: requireSafeId(raw.id, `${path}.id`, seen),
            ...(raw.origin === undefined ? {} : { origin: normalizeOrigin(raw.origin, `${path}.origin`) }),
            pathPrefix: normalizePathPrefix(raw.pathPrefix, `${path}.pathPrefix`),
        } satisfies BotResponseCapture;
    });

    const produces = steps.some((step) => step.type === 'request' || step.type === 'extract');
    if (!produces && responses.length === 0) {
        throw usage('plan declares no artifact source: add a request/extract step or a response capture');
    }

    let timeoutMs = DEFAULT_RUN_TIMEOUT_MS;
    if (plan.timeoutMs !== undefined) {
        timeoutMs = requirePositiveInt(plan.timeoutMs, 'plan.timeoutMs');
        if (timeoutMs > MAX_RUN_TIMEOUT_MS) throw usage(`plan.timeoutMs must not exceed ${MAX_RUN_TIMEOUT_MS}`);
    }
    return { steps, timeoutMs };
}

/**
 * Credential-free URL: origin+pathname only, or `undefined` when it is not an http(s) URL — a page
 * that never navigated reports `about:blank`, whose `origin` is the literal `null`.
 */
function safeUrl(input: string): string | undefined {
    try {
        const parsed = new URL(input);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
        return `${parsed.origin}${parsed.pathname}`;
    } catch {
        return undefined;
    }
}

/** True when a final URL's path carries an auth segment (R4's deterministic auth-wall rule). */
function looksLikeAuthWall(url: string | undefined): boolean {
    if (url === undefined) return false;
    try {
        return AUTH_PATH.test(new URL(url).pathname);
    } catch {
        return false;
    }
}

/** Classify an observed status before its body is read; `undefined` means "keep going". */
function classifyStatus(status: number, stepIndex: number, stepId: string): BotError | undefined {
    if (status === 401 || status === 403) {
        return new BotError(
            'authentication',
            `step '${stepId}' hit an authentication wall (status ${status}) — ` +
                'run `kk bot login <url> --save <profileName>` to renew the session',
            { stepIndex, stepId },
        );
    }
    if (status >= 400) {
        return new BotError('browser', `step '${stepId}' returned status ${status}`, { stepIndex, stepId });
    }
    return undefined;
}

function emptyFailure(id: string, what: 'step' | 'capture', stepIndex?: number): BotError {
    return new BotError('empty', `${what} '${id}' produced no content`, {
        ...(stepIndex === undefined ? {} : { stepIndex }),
        stepId: id,
    });
}

/**
 * Read a response body with the harness's Playwright surface.
 * shortcut: Playwright buffers the whole body before the post-read cap, so the cap bounds what we
 * return, not upstream memory — add streaming only for a real large-download consumer.
 */
async function readBody(response: { body(): Promise<Buffer> }): Promise<Buffer> {
    return await response.body();
}

/** Effective per-step timeout: the step's own value (or default) clamped to the run budget. */
function stepTimeout(step: BotCollectionStep, remaining: number, stepIndex: number): number {
    if (remaining <= 0) {
        throw new BotError('browser', `step '${step.id}' exceeded the collection deadline`, {
            stepIndex,
            stepId: step.id,
        });
    }
    return Math.min(step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS, remaining);
}

/** Execute one validated step and return its result row. */
async function runStep(
    step: BotCollectionStep,
    index: number,
    context: BrowserContext,
    page: Page,
    timeoutMs: number,
): Promise<{ result: BotCollectionStepResult; artifact?: BotCollectionArtifact }> {
    const details = { stepIndex: index, stepId: step.id };
    switch (step.type) {
        case 'request': {
            let response: Awaited<ReturnType<BrowserContext['request']['fetch']>>;
            try {
                response = await context.request.fetch(step.url, {
                    method: step.method ?? (step.data === undefined ? 'GET' : 'POST'),
                    ...(step.headers === undefined ? {} : { headers: step.headers }),
                    ...(step.data === undefined ? {} : { data: Buffer.from(step.data, 'utf8') }),
                    failOnStatusCode: false,
                    ...(step.followRedirects === true ? {} : { maxRedirects: 0 }),
                    timeout: timeoutMs,
                });
            } catch (error) {
                throw new BotError(
                    'browser',
                    `step '${step.id}' request failed (${execFailureDetail(error, step.url)})`,
                    details,
                );
            }
            const status = response.status();
            const wall = classifyStatus(status, index, step.id);
            if (wall !== undefined) throw wall;
            let body: Buffer;
            try {
                body = await readBody(response);
            } catch {
                throw new BotError('browser', `step '${step.id}' response body could not be read`, details);
            }
            const text = body.toString('utf8');
            if (text.trim() === '') throw emptyFailure(step.id, 'step', index);
            const requestUrl = safeUrl(step.url);
            return {
                result: {
                    index,
                    id: step.id,
                    type: step.type,
                    ...(requestUrl === undefined ? {} : { url: requestUrl }),
                },
                artifact: {
                    id: step.id,
                    kind: 'request',
                    body: text,
                    status,
                    ...(requestUrl === undefined ? {} : { url: requestUrl }),
                    stepIndex: index,
                },
            };
        }
        case 'navigate': {
            let status: number | undefined;
            try {
                const response = await page.goto(step.url, {
                    waitUntil: step.waitUntil ?? 'load',
                    timeout: timeoutMs,
                });
                status = response?.status();
            } catch (error) {
                throw new BotError(
                    'browser',
                    `step '${step.id}' navigation failed (${execFailureDetail(error, step.url)})`,
                    details,
                );
            }
            const finalUrl = safeUrl(page.url()) ?? safeUrl(step.url);
            if (looksLikeAuthWall(page.url())) {
                throw new BotError(
                    'authentication',
                    `step '${step.id}' landed on an authentication page — ` +
                        'run `kk bot login <url> --save <profileName>` to renew the session',
                    details,
                );
            }
            if (status !== undefined) {
                const wall = classifyStatus(status, index, step.id);
                if (wall !== undefined) throw wall;
            }
            return {
                result: { index, id: step.id, type: step.type, ...(finalUrl === undefined ? {} : { url: finalUrl }) },
            };
        }
        case 'wait': {
            try {
                await page.waitForSelector(step.selector, { timeout: timeoutMs });
            } catch {
                throw new BotError('browser', `step '${step.id}' timed out waiting for its selector`, details);
            }
            return { result: { index, id: step.id, type: step.type } };
        }
        case 'click': {
            try {
                await page.locator(step.selector).first().click({ timeout: timeoutMs });
            } catch {
                throw new BotError('browser', `step '${step.id}' could not click its selector`, details);
            }
            return { result: { index, id: step.id, type: step.type } };
        }
        case 'scroll': {
            try {
                // A string expression keeps the page function out of this module's (DOM-free) lib.
                await page.evaluate(`window.scrollBy(0, ${JSON.stringify(step.deltaY)})`);
            } catch {
                throw new BotError('browser', `step '${step.id}' could not scroll the page`, details);
            }
            return { result: { index, id: step.id, type: step.type } };
        }
        case 'extract': {
            let text: string;
            try {
                const target = step.selector === undefined ? null : page.locator(step.selector).first();
                // `content()` and `evaluate()` take no Playwright timeout, so the step bound is
                // enforced here — otherwise a runaway evaluate would outlive the run budget.
                text = await applyTimeout(
                    step.format === 'html'
                        ? target === null
                            ? page.content()
                            : target.evaluate('(element) => element.outerHTML').then((value) => String(value))
                        : target === null
                          ? page.evaluate('document.body ? document.body.innerText : ""').then((value) => String(value))
                          : target.innerText(),
                    timeoutMs,
                );
            } catch {
                throw new BotError('browser', `step '${step.id}' could not extract its content`, details);
            }
            if (text.trim() === '') throw emptyFailure(step.id, 'step', index);
            const pageUrl = safeUrl(page.url());
            return {
                result: { index, id: step.id, type: step.type, ...(pageUrl === undefined ? {} : { url: pageUrl }) },
                artifact: {
                    id: step.id,
                    kind: step.format,
                    body: text,
                    ...(pageUrl === undefined ? {} : { url: pageUrl }),
                    stepIndex: index,
                },
            };
        }
    }
}

/** Enforce the artifact ceiling and body caps once per artifact, in deterministic order. */
function enforceCaps(artifact: BotCollectionArtifact, artifacts: BotCollectionArtifact[], aggregate: number): number {
    if (artifacts.length >= MAX_ARTIFACTS) {
        throw new BotError('browser', `collection produced more than ${MAX_ARTIFACTS} artifacts`, {
            ...(artifact.stepIndex === undefined ? {} : { stepIndex: artifact.stepIndex }),
            stepId: artifact.id,
        });
    }
    const bytes = Buffer.byteLength(artifact.body, 'utf8');
    if (bytes > MAX_ARTIFACT_BYTES) {
        throw new BotError('browser', `artifact '${artifact.id}' exceeds the per-artifact body cap`, {
            ...(artifact.stepIndex === undefined ? {} : { stepIndex: artifact.stepIndex }),
            stepId: artifact.id,
        });
    }
    const total = aggregate + bytes;
    if (total > MAX_AGGREGATE_BYTES) {
        throw new BotError('browser', `collection exceeded the aggregate body cap`, { stepId: artifact.id });
    }
    return total;
}

/**
 * Bound an operation Playwright exposes without a timeout. The underlying promise is left to the
 * context close on the failure path, which is where a stuck page operation is actually cancelled.
 */
async function applyTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('step timeout')), timeoutMs);
    });
    try {
        return await Promise.race([promise, expiry]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

/** Race a capture read against the remaining whole-run budget. */
async function waitWithin(promise: Promise<void>, budgetMs: number): Promise<boolean> {
    if (budgetMs <= 0) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), budgetMs);
    });
    try {
        return await Promise.race([promise.then(() => true), expiry]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

/**
 * Run one bounded, authenticated collection plan against bot `name`'s saved profile (R1–R4).
 *
 * The plan is validated before any side effect; the profile must already exist (a missing one is
 * `not-found` — this never creates or converts a profile). One lease acquisition and one headless
 * launch cover the whole plan, and the context is closed and the lease released on every path.
 * Failures carry `authentication`, `empty` or `browser` plus the safe step/capture id — never a
 * query, fragment, header value, cookie value or response body.
 */
export async function runBotCollection(
    profileName: string,
    plan: BotCollectionPlan,
    options: BotCollectionOptions = {},
): Promise<BotCollectionResult> {
    const normalized = normalizePlan(plan);
    const name = assertSafeBotName(profileName);
    const fileSystem = options.fileSystem ?? createNodeFileSystem();
    const now = options.now ?? Date.now;
    const deadline = now() + normalized.timeoutMs;

    const profileDir = resolveBotProfileDir(name, { root: options.root });
    if (lstat(profileDir) === null) throw missingBotProfile(name, false);

    const acquire = options.acquireLease ?? acquireProfileLease;
    const lease = await acquire(profileDir, { leaseRoot: options.leaseRoot, fileSystem });

    const captures: CaptureState[] = (plan.responses ?? []).map((declaration) => ({
        declaration,
        matches: [],
        pending: [],
        readFailures: 0,
    }));
    let context: BrowserContext | undefined;
    try {
        const launcher =
            options.launcher ??
            createKkBrowserLauncher(
                undefined,
                { lease, physicalProfileDir: profileDir },
                { leaseRoot: options.leaseRoot, fileSystem },
            );
        context = await launcher.launch({ profileDir, headless: true });
        const activeContext = context;
        // Listeners are installed before the first step so no early XHR can be missed.
        if (captures.length > 0) {
            activeContext.on('response', (response) => {
                const raw = response.url();
                let parsed: URL;
                try {
                    parsed = new URL(raw);
                } catch {
                    return;
                }
                for (const state of captures) {
                    const { origin, pathPrefix } = state.declaration;
                    if (origin !== undefined && parsed.origin !== origin) continue;
                    if (!parsed.pathname.startsWith(pathPrefix)) continue;
                    // Never rejects: an orphaned rejection here would surface as an unhandled fault.
                    state.pending.push(
                        readBody(response).then(
                            (body) => {
                                state.matches.push({
                                    status: response.status(),
                                    text: body.toString('utf8'),
                                    url: `${parsed.origin}${parsed.pathname}`,
                                });
                            },
                            () => {
                                state.readFailures += 1;
                            },
                        ),
                    );
                }
            });
        }
        const page = await openBotPage(activeContext);

        const steps: BotCollectionStepResult[] = [];
        const artifacts: BotCollectionArtifact[] = [];
        let aggregate = 0;
        for (const [index, step] of normalized.steps.entries()) {
            const outcome = await runStep(step, index, activeContext, page, stepTimeout(step, deadline - now(), index));
            steps.push(outcome.result);
            if (outcome.artifact !== undefined) {
                aggregate = enforceCaps(outcome.artifact, artifacts, aggregate);
                artifacts.push(outcome.artifact);
            }
        }

        for (const state of captures) {
            const settled = await waitWithin(
                Promise.all(state.pending).then(() => undefined),
                deadline - now(),
            );
            if (!settled) {
                throw new BotError(
                    'browser',
                    `response capture '${state.declaration.id}' exceeded the collection deadline`,
                    {
                        stepId: state.declaration.id,
                    },
                );
            }
            const found = state.matches.filter((match) => match.text.trim() !== '');
            // A read failure that leaves the declaration empty is reported as such; a sibling match
            // that did produce a body (a navigation can evict an in-flight one) keeps the run green.
            if (found.length === 0 && state.readFailures > 0) {
                throw new BotError('browser', `response capture '${state.declaration.id}' could not be read`, {
                    stepId: state.declaration.id,
                });
            }
            if (found.length === 0) throw emptyFailure(state.declaration.id, 'capture');
            for (const match of found) {
                const artifact: BotCollectionArtifact = {
                    id: state.declaration.id,
                    kind: 'response',
                    body: match.text,
                    status: match.status,
                    url: match.url,
                };
                aggregate = enforceCaps(artifact, artifacts, aggregate);
                artifacts.push(artifact);
            }
        }
        return { steps, artifacts };
    } finally {
        // Close first so in-flight capture reads are cancelled, then drain them, then release.
        await closeBotContext(context);
        await Promise.allSettled(captures.flatMap((state) => state.pending));
        await lease.release();
    }
}
