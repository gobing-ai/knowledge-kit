import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { ActionKind, DailyActionLine } from '@gobing-ai/kk-board/contracts';
import { openStore, resolveStorePath } from '@gobing-ai/kk-store';
import { type FileSystem, NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import { resolveKkConfigPath } from '../invoke';
import {
    ACTION_KINDS,
    ActionParamError,
    DAY_PATTERN,
    EDIT_ARTIFACTS,
    EDIT_BODY_CAP_BYTES,
    editArtifactRelative,
    type ResolvedAction,
    resolveArgv,
} from './actions';
import { unifiedDiff } from './text-diff';

/**
 * The guarded action plane (G83, task 0442 — docs/design/daily-voice-ops-console.md §6).
 *
 * The reader is the only local process that can turn a console recipe into the same verb, so it
 * gains ONE write route: `POST /api/actions/<kind>`. Every guard lives here, in order, and every
 * refusal launches nothing and writes an audit line:
 *
 * 1. the plane is off unless `board.actions.enabled` is true;
 * 2. the kind must be in the closed allowlist;
 * 3. the request must carry the exact Board `Origin` (never `null`), a loopback `Host` and
 *    `X-KK-Action: 1`, so a cross-site simple request cannot reach it;
 * 4. argv comes from `resolveArgv` — the same function the digest renders — so params are validated
 *    once and no free text exists;
 * 5. a preview mints a single-use 5-minute token bound to `sha256(kind + argv)`; an unknown, reused
 *    or expired token is refused;
 * 6. a live kind additionally needs `typedConfirm === day`;
 * 7. single-flight per day through the store-backed lock `ops-console:<day>`;
 * 8. the launch is audited BEFORE the child exists, and the child is spawned as an argv array with
 *    no shell and no request data in its environment.
 */

/** The token lifetime: long enough to read a preview, short enough to be a confirmation. */
export const ACTION_TOKEN_TTL_MS = 5 * 60_000;

/** The single-flight lock lifetime; a crashed reader's claim is stolen after it. */
export const ACTION_LOCK_TTL_MS = 2 * 3_600_000;

/** The closed refusal vocabulary; each maps to one status and one audit word. */
export const ACTION_REFUSALS = {
    'actions.disabled': 403,
    'actions.kind.unknown': 404,
    'actions.origin.refused': 403,
    'actions.host.refused': 403,
    'actions.header.missing': 403,
    'actions.params.invalid': 400,
    'actions.token.invalid': 409,
    'actions.confirm.missing': 400,
    'actions.lock.held': 409,
    'actions.artifact.stale': 409,
} as const;

/** One refusal code from the closed set. */
export type ActionRefusal = keyof typeof ACTION_REFUSALS;

/** The child process a kind launches, reduced to what the plane needs from it. */
export interface ActionChild {
    /** Resolves with the exit code once the child is done. */
    exit: Promise<number>;
    /** The child's stdout, available after `exit`. */
    stdout(): string;
}

/**
 * What the plane needs to reason about an edit artifact without owning the write (G84).
 *
 * The verb still owns the bytes: the plane only reads them to render the preview diff and to refuse
 * a stale confirmation before a child exists.
 */
export interface ArtifactSeam {
    /** The artifact's current text, or null when it does not exist yet. */
    read: (kind: ActionKind, params: Record<string, string>) => Promise<{ path: string; text: string | null }>;
    /** The newest backup text for `revert-artifact`, or null when there is none. */
    newestBackup: (params: Record<string, string>) => Promise<string | null>;
}

/** The environment a launched child receives: the holder identity, never request data. */
export interface ActionChildEnv {
    /** The `ops-console:<day>` holder this process owns, so the verb can prove it is the holder. */
    KK_LOCK_HOLDER?: string;
}

/** Everything the plane touches outside its own state; injected so the matrix is unit-testable. */
export interface ActionPlaneDeps {
    /** Spawn one argv array — never a shell string, no request data in the environment. */
    spawn: (argv: string[], env: ActionChildEnv, stdin: string | null) => ActionChild;
    /** The edit-artifact seam; omitted by callers that never offer the two edit kinds. */
    artifacts?: ArtifactSeam;
    /** The clock (injectable so token expiry is testable). */
    now: () => number;
    /** 16 random bytes as hex, for the token. */
    randomHex: () => string;
    /** Take the single-flight lock; `null` when another holder owns it. */
    acquireLock: (name: string) => Promise<{ release: () => Promise<void> } | null>;
    /** Append one line to the day's `actions.jsonl`. */
    audit: (line: DailyActionLine) => Promise<void>;
    /** Run a preview command and return its bounded output. */
    preview: (argv: string[]) => Promise<string>;
    /** Resolved per request so a reader that starts before its config is read still answers. */
    enabled: () => boolean;
    /** The `ops-console:<day>` holder this process owns, handed to an edit child as proof. */
    lockHolder?: () => string;
    /** The exact Board origin this reader serves. */
    boardOrigin: string;
}

/** The request-shaped input the reader adapts from an HTTP POST. */
export interface ActionInput {
    kind: string;
    /** The request's `Origin` header (null when absent — refused on POST). */
    origin: string | null;
    /** The request's `Host` header. */
    host: string | null;
    /** The request's `X-KK-Action` header. */
    actionHeader: string | null;
    /** The request's JSON body, already parsed. */
    body: unknown;
}

/** A plane answer: the reader turns this into the HTTP response. */
export interface ActionAnswer {
    status: number;
    body: Record<string, unknown>;
}

/** One minted token and what it authorizes. */
interface TokenRecord {
    argvHash: string;
    expiresAt: number;
}

/** The argv hash a token binds to: `sha256(kind + '\0' + argv.join('\0'))`. */
export function argvHashOf(kind: ActionKind, argv: readonly string[]): string {
    return createHash('sha256')
        .update([kind, ...argv].join('\0'))
        .digest('hex');
}

/**
 * The hash a body-bound kind's token binds (G84): the argv hash plus the body digest, so a
 * confirmation authorizes exactly the bytes that were previewed. The body itself never leaves this
 * function — only its hash reaches a token record or an audit line.
 */
export function bodyBoundHashOf(kind: ActionKind, argv: readonly string[], body: string): string {
    const bodyHash = createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex');
    return createHash('sha256')
        .update(`${argvHashOf(kind, argv)}\0${bodyHash}`)
        .digest('hex');
}

/** True when `host` names a loopback address (the reader's DNS-rebinding guard). */
function isLoopbackHost(host: string | null): boolean {
    if (host === null) return false;
    const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : (host.split(':')[0] ?? '');
    return name === '127.0.0.1' || name === 'localhost' || name === '[::1]';
}

/** The validated params bag from a request body (only string values survive). */
function paramsOf(body: unknown): Record<string, string> | null {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
    const raw = (body as Record<string, unknown>).params;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value !== 'string') return null;
        params[key] = value;
    }
    return params;
}

/** The request's draft body for a body-bound kind (absent reads as ''), capped before hashing. */
function bodyTextOf(body: unknown): { text: string; tooLarge: boolean } {
    if (typeof body !== 'object' || body === null) return { text: '', tooLarge: false };
    const raw = (body as Record<string, unknown>).body;
    if (typeof raw !== 'string') return { text: '', tooLarge: false };
    return { text: raw, tooLarge: Buffer.byteLength(raw, 'utf8') > EDIT_BODY_CAP_BYTES };
}

/** The optional token and typed confirmation a request may carry. */
function tokenAndConfirm(body: unknown): { token: string | null; typedConfirm: string | null } {
    if (typeof body !== 'object' || body === null) return { token: null, typedConfirm: null };
    const record = body as Record<string, unknown>;
    return {
        token: typeof record.token === 'string' && record.token !== '' ? record.token : null,
        typedConfirm: typeof record.typedConfirm === 'string' ? record.typedConfirm : null,
    };
}

/**
 * The day a kind belongs to, for the audit path and the lock name.
 *
 * A day-bound kind names it directly. A run-scoped kind gets it from the run id when the id carries
 * the day (`kk-news-generate-<day>-…`); otherwise the lock keys on the run and the audit line lands
 * in the shared parent file, which is an explicit, documented split rather than a guess.
 */
export function scopeOf(kind: ActionKind, params: Record<string, string>): { day: string | null; lock: string } {
    const day = params.day ?? /kk-news-generate-(\d{8})-/.exec(params.runId ?? '')?.[1] ?? null;
    if (day !== null && DAY_PATTERN.test(day)) return { day, lock: `ops-console:${day}` };
    return { day: null, lock: `ops-console:run-${params.runId ?? kind}` };
}

/** Parse the launched run id out of a child's JSON stdout, or null when it named none. */
export function runIdOf(stdout: string): string | null {
    for (const line of stdout.split('\n').reverse()) {
        const text = line.trim();
        if (!text.startsWith('{')) continue;
        try {
            const parsed = JSON.parse(text) as Record<string, unknown>;
            const runId = parsed.runId ?? parsed.run_id;
            if (typeof runId === 'string' && runId !== '') return runId;
        } catch {
            // A non-JSON line is not the run id; keep scanning upward.
        }
    }
    return null;
}

/** One plane instance: the token map plus the handler. */
export interface ActionPlane {
    handle: (input: ActionInput) => Promise<ActionAnswer>;
}

/** A refusal answer, with the audit line already written by the caller. */
function refusal(code: ActionRefusal): ActionAnswer {
    return { status: ACTION_REFUSALS[code], body: { code, message: REFUSAL_MESSAGES[code] } };
}

/** The operator-facing sentence for each refusal code (bounded, no request echo). */
const REFUSAL_MESSAGES: Record<ActionRefusal, string> = {
    'actions.disabled': 'The action plane is disabled; set board.actions.enabled to true to allow launches.',
    'actions.kind.unknown': 'That action kind is not in the allowlist.',
    'actions.origin.refused': 'A POST must carry exactly the configured Board Origin.',
    'actions.host.refused': 'Host must be loopback.',
    'actions.header.missing': 'A POST must carry X-KK-Action: 1.',
    'actions.params.invalid': 'The action parameters are not valid for that kind.',
    'actions.token.invalid': 'The confirmation token is unknown, already used or expired. Request a new preview.',
    'actions.confirm.missing': 'A live action needs typedConfirm set to the day.',
    'actions.lock.held': 'Another action is running for this day; wait for it or cancel it.',
    'actions.artifact.stale':
        'The artifact changed since the preview; its current sha256 is in `currentSha` and nothing was launched.',
};

/**
 * Create the action plane.
 *
 * Tokens live only in this process's memory and are consumed on first use; nothing about a token is
 * persisted, and the audit line carries only its hash.
 */
export function createActionPlane(deps: ActionPlaneDeps): ActionPlane {
    const tokens = new Map<string, TokenRecord>();

    async function audit(line: DailyActionLine): Promise<void> {
        try {
            await deps.audit(line);
        } catch {
            // The audit is evidence, not a gate: a failed append must not leave a launch unreported
            // silently, so it also lands on the reader's diagnostics path via the caller's log.
        }
    }

    async function handle(input: ActionInput): Promise<ActionAnswer> {
        const base = { ts: new Date(deps.now()).toISOString(), kind: input.kind, origin: input.origin };

        if (!deps.enabled()) {
            await audit({ ...base, argv: [], tokenHash: null, runId: null, exit: null, refusal: 'actions.disabled' });
            return refusal('actions.disabled');
        }
        if (!(ACTION_KINDS as readonly string[]).includes(input.kind)) {
            await audit({
                ...base,
                argv: [],
                tokenHash: null,
                runId: null,
                exit: null,
                refusal: 'actions.kind.unknown',
            });
            return refusal('actions.kind.unknown');
        }
        const kind = input.kind as ActionKind;
        if (input.origin === null || input.origin !== deps.boardOrigin) {
            await audit({
                ...base,
                argv: [],
                tokenHash: null,
                runId: null,
                exit: null,
                refusal: 'actions.origin.refused',
            });
            return refusal('actions.origin.refused');
        }
        if (!isLoopbackHost(input.host)) {
            await audit({
                ...base,
                argv: [],
                tokenHash: null,
                runId: null,
                exit: null,
                refusal: 'actions.host.refused',
            });
            return refusal('actions.host.refused');
        }
        if (input.actionHeader !== '1') {
            await audit({
                ...base,
                argv: [],
                tokenHash: null,
                runId: null,
                exit: null,
                refusal: 'actions.header.missing',
            });
            return refusal('actions.header.missing');
        }
        const params = paramsOf(input.body);
        if (params === null) {
            await audit({
                ...base,
                argv: [],
                tokenHash: null,
                runId: null,
                exit: null,
                refusal: 'actions.params.invalid',
            });
            return refusal('actions.params.invalid');
        }
        const bodyText = bodyTextOf(input.body);
        if (bodyText.tooLarge) {
            await audit({
                ...base,
                argv: [],
                tokenHash: null,
                runId: null,
                exit: null,
                refusal: 'actions.params.invalid',
            });
            return refusal('actions.params.invalid');
        }
        let resolved: ResolvedAction;
        try {
            resolved = resolveArgv(kind, params);
        } catch (error) {
            if (!(error instanceof ActionParamError)) throw error;
            await audit({
                ...base,
                argv: [],
                tokenHash: null,
                runId: null,
                exit: null,
                refusal: 'actions.params.invalid',
            });
            return refusal('actions.params.invalid');
        }
        const { token, typedConfirm } = tokenAndConfirm(input.body);
        const hash =
            resolved.bodyBound === true
                ? bodyBoundHashOf(kind, resolved.argv, bodyText.text)
                : argvHashOf(kind, resolved.argv);
        const scope = scopeOf(kind, params);

        if (token === null) {
            // Preview: the dry-run output (when the kind has one), or the diff an edit would make,
            // then mint the confirmation bound to exactly what was shown.
            let dryRun: string | null = null;
            if (resolved.bodyBound === true) {
                dryRun =
                    deps.artifacts === undefined
                        ? null
                        : await diffPreviewOf(deps.artifacts, kind, params, bodyText.text);
            } else if (resolved.dryRunArgv !== undefined) {
                dryRun = await deps.preview(resolved.dryRunArgv);
            }
            const minted = deps.randomHex();
            tokens.set(minted, { argvHash: hash, expiresAt: deps.now() + ACTION_TOKEN_TTL_MS });
            await audit({
                ...base,
                day: scope.day,
                argv: resolved.argv,
                tokenHash: hash,
                runId: null,
                exit: null,
                result: 'preview',
            });
            return {
                status: 200,
                body: {
                    argv: resolved.argv,
                    ...(resolved.dryRunArgv === undefined ? {} : { dryRunArgv: resolved.dryRunArgv }),
                    dryRun,
                    live: resolved.live,
                    token: minted,
                    expiresAt: new Date(deps.now() + ACTION_TOKEN_TTL_MS).toISOString(),
                },
            };
        }

        if (resolved.live && typedConfirm !== scope.day) {
            await audit({
                ...base,
                day: scope.day,
                argv: resolved.argv,
                tokenHash: hash,
                runId: null,
                exit: null,
                refusal: 'actions.confirm.missing',
            });
            return refusal('actions.confirm.missing');
        }
        const record = tokens.get(token);
        if (record === undefined || record.argvHash !== hash || record.expiresAt <= deps.now()) {
            if (record !== undefined && record.expiresAt <= deps.now()) tokens.delete(token);
            await audit({
                ...base,
                day: scope.day,
                argv: resolved.argv,
                tokenHash: hash,
                runId: null,
                exit: null,
                refusal: 'actions.token.invalid',
            });
            return refusal('actions.token.invalid');
        }
        tokens.delete(token);
        // A confirmed edit whose artifact moved is a conflict, not a launch: the current sha comes
        // back so the operator can re-preview without guessing (R6, AC6).
        if (resolved.bodyBound === true && deps.artifacts !== undefined) {
            const stale = await staleEditSha(deps.artifacts, kind, params);
            if (stale !== null) {
                await audit({
                    ...base,
                    day: scope.day,
                    argv: resolved.argv,
                    tokenHash: hash,
                    runId: null,
                    exit: null,
                    refusal: 'actions.artifact.stale',
                });
                return {
                    status: 409,
                    body: {
                        code: 'actions.artifact.stale',
                        message: REFUSAL_MESSAGES['actions.artifact.stale'],
                        currentSha: stale,
                    },
                };
            }
        }
        const lock = await deps.acquireLock(scope.lock);
        if (lock === null) {
            await audit({
                ...base,
                day: scope.day,
                argv: resolved.argv,
                tokenHash: hash,
                runId: null,
                exit: null,
                refusal: 'actions.lock.held',
            });
            return refusal('actions.lock.held');
        }

        // The launch is audited BEFORE the child exists: a crash between these two lines leaves an
        // unclosed `launched` row, never a phantom run with no evidence.
        await audit({
            ...base,
            day: scope.day,
            argv: resolved.argv,
            tokenHash: hash,
            runId: null,
            exit: null,
            result: 'launched',
        });
        const child = deps.spawn(
            resolved.argv,
            deps.lockHolder === undefined ? {} : { KK_LOCK_HOLDER: deps.lockHolder() },
            resolved.stdinBody === true ? bodyText.text : null,
        );
        const settle = async (code: number): Promise<void> => {
            const runId = runIdOf(child.stdout());
            await audit({
                ts: new Date(deps.now()).toISOString(),
                kind,
                day: scope.day,
                argv: resolved.argv,
                origin: input.origin,
                tokenHash: hash,
                runId,
                exit: code,
                result: 'exited',
            });
            await lock.release();
        };

        // An edit is a sub-second verb whose outcome the operator must see: it is awaited and its
        // own refusal code is relayed, because a 202 would hide `news.edit.frozen`,
        // `news.edit.script.invalid` and a base-sha race that only the verb can detect. A launch
        // that starts a workflow keeps the fire-and-forget 202 below.
        if (resolved.bodyBound === true) {
            const code = await child.exit;
            await settle(code);
            if (code === 0) return { status: 200, body: { saved: true, argv: resolved.argv, exit: code } };
            const refusal = editRefusalOf(child.stdout());
            return {
                status: refusal === 'news.edit.base-sha.mismatch' ? 409 : 422,
                body: {
                    code: refusal ?? 'news.edit.failed',
                    message: `kk news edit exited ${code}${refusal === null ? '' : ` (${refusal})`}.`,
                },
            };
        }

        void child.exit.then(settle);
        return { status: 202, body: { launched: true, argv: resolved.argv, live: resolved.live } };
    }

    return { handle };
}

/** Read `board.actions.enabled` from the operator config; absent or malformed reads as off. */
export async function actionsEnabledFromConfig(fs: FileSystem): Promise<boolean> {
    const path = resolveKkConfigPath();
    try {
        if (!(await fs.exists(path))) return false;
        const parsed = Bun.YAML.parse(await fs.readFile(path)) as unknown;
        if (typeof parsed !== 'object' || parsed === null) return false;
        const board = (parsed as Record<string, unknown>).board;
        if (typeof board !== 'object' || board === null) return false;
        const actions = (board as Record<string, unknown>).actions;
        if (typeof actions !== 'object' || actions === null) return false;
        return (actions as Record<string, unknown>).enabled === true;
    } catch {
        return false;
    }
}

/**
 * One argv array as a child the plane can follow: no shell, no request data in the environment.
 *
 * The only environment entry is the lock-holder identity (a UUID this process minted), and the only
 * stdin is an edit body the operator previewed — never a command line.
 */
export function spawnArgv(
    executor: NodeProcessExecutor,
    argv: string[],
    cwd: string,
    env: ActionChildEnv = {},
    stdin: string | null = null,
): ActionChild {
    const [command, ...args] = argv;
    if (command === undefined) throw new Error('an action argv cannot be empty');
    let captured = '';
    if (stdin !== null) {
        // A body rides the child's stdin: the executor's buffered run has no stdin, so the streaming
        // handle is the one that can carry it (and it is still an argv spawn, never a shell string).
        const pipe = executor.runStreaming({ command, args, cwd, env: { ...env } });
        pipe.writeStdin(stdin);
        pipe.endStdin();
        const exit = pipe.exited.then(async (code) => {
            const [out, err] = await Promise.all([
                pipe.stdout === null ? Promise.resolve('') : new Response(pipe.stdout).text(),
                pipe.stderr === null ? Promise.resolve('') : new Response(pipe.stderr).text(),
            ]);
            captured = `${out}${err}`;
            return code ?? 1;
        });
        return { exit, stdout: () => captured };
    }
    const run = executor.run({ command, args, cwd, timeout: null, env: { ...env } }).then((result) => {
        captured = `${result.stdout}${result.stderr}`;
        return result.exitCode ?? 1;
    });
    return { exit: run, stdout: () => captured };
}

/** The day directory the plane edits inside — the same `.works` root its audit lines use. */
export function planeDayDir(projectPath: string, day: string): string {
    return join(projectPath, '.works', 'kk-news-generate', day);
}

/**
 * The production artifact seam: read the allowlisted draft and its newest backup.
 *
 * Only the two closed artifacts resolve, and only inside the day directory the audit path uses.
 */
export function planeArtifacts(projectPath: string, fs: FileSystem): ArtifactSeam {
    const artifactOf = (params: Record<string, string>): { day: string; relative: string; path: string } | null => {
        const day = params.day ?? '';
        const artifact = params.artifact ?? '';
        if (!DAY_PATTERN.test(day)) return null;
        if (!(EDIT_ARTIFACTS as readonly string[]).includes(artifact)) return null;
        const dayDir = planeDayDir(projectPath, day);
        return {
            day,
            relative: editArtifactRelative(day, artifact),
            path: join(dayDir, editArtifactRelative(day, artifact)),
        };
    };
    return {
        read: async (_kind, params) => {
            const target = artifactOf(params);
            if (target === null) return { path: '', text: null };
            const text = (await fs.exists(target.path)) ? await fs.readFile(target.path) : null;
            return { path: target.relative, text };
        },
        newestBackup: async (params) => {
            const target = artifactOf(params);
            if (target === null) return null;
            const dir = join(planeDayDir(projectPath, target.day), 'edits');
            let names: string[];
            try {
                names = await fs.readDir(dir);
            } catch {
                return null;
            }
            const suffix = target.relative.endsWith('.md') ? '-article.md' : '-script.yaml';
            const newest = names
                .filter((name) => name.endsWith(suffix))
                .sort()
                .at(-1);
            if (newest === undefined) return null;
            return fs.readFile(join(dir, newest));
        },
    };
}

/** The unified diff an edit (or a revert) would make, for the preview answer. */
async function diffPreviewOf(
    seam: ArtifactSeam,
    kind: ActionKind,
    params: Record<string, string>,
    body: string,
): Promise<string | null> {
    const current = await seam.read(kind, params);
    const after = kind === 'revert-artifact' ? await seam.newestBackup(params) : body;
    if (after === null) return null;
    const label = current.path === '' ? (params.artifact ?? 'artifact') : current.path;
    return unifiedDiff(current.text ?? '', after, label, label);
}

/**
 * The verb's own closed refusal code, read from its output.
 *
 * The verb prints `kk.news.edit.failed: <code>: <message>` on stderr; the plane relays the code so a
 * caller can act on it (a base-sha race is a conflict, a frozen day is not).
 */
export function editRefusalOf(output: string): string | null {
    return /news\.edit\.[a-z.-]+/.exec(output)?.[0] ?? null;
}

/** The artifact's current sha when a confirmed edit's `baseSha` no longer matches; null otherwise. */
async function staleEditSha(
    seam: ArtifactSeam,
    kind: ActionKind,
    params: Record<string, string>,
): Promise<string | null> {
    if (kind !== 'edit-artifact') return null;
    const expected = params.baseSha ?? '';
    const current = await seam.read(kind, params);
    if (current.text === null) return null;
    const sha = createHash('sha256').update(Buffer.from(current.text, 'utf8')).digest('hex');
    return sha === expected.toLowerCase() ? null : sha;
}

/**
 * The production action plane: config switch, real argv spawn, store-backed single-flight lock and
 * the day's `actions.jsonl`.
 */
export function defaultActionPlane(
    deps: {
        projectPath: string;
        fs: FileSystem;
        boardOrigin: string;
    },
    /** Test seam: a stub executor/store covers the preview and lock wiring without a real child. */
    overrides: {
        executor?: NodeProcessExecutor;
        store?: { locks: { acquire: ActionLockAcquire; release: ActionLockRelease } };
    } = {},
): Promise<ActionPlane> {
    return productionPlane({
        projectPath: deps.projectPath,
        fs: deps.fs,
        boardOrigin: deps.boardOrigin,
        executor: overrides.executor ?? new NodeProcessExecutor(),
        store: overrides.store,
    });
}

/** The store lock surface the plane uses (the one `kk lock` wraps). */
export type ActionLockAcquire = (name: string, holder: string, ttlMs: number) => Promise<boolean>;

/** The matching release surface. */
export type ActionLockRelease = (name: string, holder: string) => Promise<boolean>;

/** Build the production plane: config switch, argv spawn, store lock, day audit file. */
async function productionPlane(input: {
    projectPath: string;
    fs: FileSystem;
    boardOrigin: string;
    executor: NodeProcessExecutor;
    store?: { locks: { acquire: ActionLockAcquire; release: ActionLockRelease } };
}): Promise<ActionPlane> {
    const enabled = await actionsEnabledFromConfig(input.fs);
    const store = input.store ?? (await openStore({ path: await resolveStorePath(resolveKkConfigPath()) }));
    const runsRoot = join(input.projectPath, '.works', 'kk-news-generate');
    const holder = `ops-console:${crypto.randomUUID()}`;
    const artifacts = planeArtifacts(input.projectPath, input.fs);
    return createActionPlane({
        enabled: () => enabled,
        now: () => Date.now(),
        randomHex: () => Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex'),
        boardOrigin: input.boardOrigin,
        spawn: (argv, env, stdin) => spawnArgv(input.executor, argv, input.projectPath, env, stdin),
        artifacts,
        lockHolder: () => holder,
        preview: async (argv) => {
            const [command, ...args] = argv;
            if (command === undefined) return '';
            const result = await input.executor.run({
                command,
                args,
                cwd: input.projectPath,
                timeout: 120_000,
            });
            const text = `${result.stdout}${result.stderr}`.trim();
            return text.length > 4_000 ? `${text.slice(0, 4_000)}\n… truncated` : text;
        },
        acquireLock: async (name) => {
            const acquired = await store.locks.acquire(name, holder, ACTION_LOCK_TTL_MS);
            if (!acquired) return null;
            return { release: async () => void (await store.locks.release(name, holder)) };
        },
        audit: async (line) => {
            const dir = line.day == null ? runsRoot : join(runsRoot, line.day);
            await input.fs.ensureDir(dir);
            await appendActionLog(input.fs, actionLogPath(dir), line);
        },
    });
}

/** The audit file a day's action lines land in (`<day>/actions.jsonl`). */
export function actionLogPath(dayDir: string): string {
    return join(dayDir, 'actions.jsonl');
}

/** Parse one audit file into bounded rows, newest last; a malformed line is skipped, never fatal. */
export function parseActionLog(text: string | undefined, cap = 50): DailyActionLine[] {
    if (text === undefined) return [];
    const lines: DailyActionLine[] = [];
    for (const raw of text.split('\n')) {
        if (raw.trim() === '') continue;
        try {
            const parsed = JSON.parse(raw) as DailyActionLine;
            if (typeof parsed === 'object' && parsed !== null && typeof parsed.ts === 'string') lines.push(parsed);
        } catch {
            // A torn trailing line (a write in progress) is skipped.
        }
    }
    return lines.slice(-cap);
}

/** Append one audit line, creating the file when needed. */
export async function appendActionLog(fs: FileSystem, path: string, line: DailyActionLine): Promise<void> {
    await fs.appendFile(path, `${JSON.stringify(line)}\n`);
}
