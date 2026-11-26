import { basename } from 'node:path';
import type { ActionKind, Recipe } from '@gobing-ai/kk-board/contracts';
import { PublishWindowSchema } from '../publish-core';

/**
 * The action-argv resolver (G83, task 0439 — docs/design/daily-voice-ops-console.md §5–§6).
 *
 * One mapping serves both surfaces: the digest renders a recipe's argv, and the action plane
 * executes exactly the same argv. Params are validated here and nowhere else — a kind's key set is
 * closed, every value is checked against its own domain, and no free text is ever accepted.
 */

/** The day key every parameter binds to: the `kk-news-generate` work-dir basename. */
export const DAY_PATTERN = /^\d{8}$/;

/** A run id is one safe path segment. */
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** A workflow node id, as the topology records it. */
const NODE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A publish channel id (`<plugin>.<operation>`), as a publish plan row records it. */
const CHANNEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** The engines `kk news generate-voice --engine` accepts (its `--help` enum, frozen here). */
export const VOICE_ENGINES = ['voxcpm', 'gemini', 'omnivoice', 'voicebox', 'vibe-voice'] as const;

/** The steps `rerender-step` can re-render, each with its own verb. */
export const RERENDER_STEPS = ['voice', 'cards', 'render'] as const;

/** The publish windows the matrix plans (the frozen `PublishWindowSchema` vocabulary). */
const PUBLISH_WINDOWS: readonly string[] = PublishWindowSchema.options;

/** The closed action-kind allowlist, in the order the console offers them. */
export const ACTION_KINDS: readonly ActionKind[] = [
    'publish-retry',
    'publish-window',
    'generate-from-node',
    'rerender-step',
    'cancel-run',
    'store-release',
];

/** The keys each kind accepts; anything else is refused rather than ignored. */
const ALLOWED_KEYS: Record<ActionKind, readonly string[]> = {
    'generate-from-node': ['node', 'runId'],
    'publish-retry': ['day', 'window', 'channels'],
    'publish-window': ['day', 'window', 'dummy'],
    'rerender-step': ['day', 'dayDir', 'step', 'engine'],
    'cancel-run': ['runId'],
    'store-release': ['runId'],
};

/** A refused action parameter: the offending key, named, with nothing of its value echoed. */
export class ActionParamError extends Error {
    /** The parameter that failed validation. */
    readonly param: string;

    constructor(param: string, message: string) {
        super(message);
        this.name = 'ActionParamError';
        this.param = param;
    }
}

/** One resolved action: the argv, its optional dry-run preview and whether it can send live. */
export interface ResolvedAction {
    argv: string[];
    dryRunArgv?: string[];
    live: boolean;
}

function allow(kind: ActionKind, params: Record<string, string>): void {
    const allowed = ALLOWED_KEYS[kind];
    if (allowed === undefined) throw new ActionParamError('kind', `Unknown action kind '${kind}'.`);
    for (const key of Object.keys(params)) {
        if (!allowed.includes(key)) throw new ActionParamError(key, `'${key}' is not a parameter of '${kind}'.`);
    }
}

function required(params: Record<string, string>, key: string): string {
    const value = params[key];
    if (value === undefined || value === '') throw new ActionParamError(key, `'${key}' is required.`);
    return value;
}

function match(params: Record<string, string>, key: string, pattern: RegExp, expected: string): string {
    const value = required(params, key);
    if (!pattern.test(value)) throw new ActionParamError(key, `'${key}' must be ${expected}.`);
    return value;
}

function oneOf(params: Record<string, string>, key: string, values: readonly string[]): string {
    const value = required(params, key);
    if (!values.includes(value)) throw new ActionParamError(key, `'${key}' must be one of ${values.join(', ')}.`);
    return value;
}

/** A day-bound directory: absolute, and named exactly for the day it belongs to. */
function dayDir(params: Record<string, string>, day: string): string {
    const value = required(params, 'dayDir');
    if (!value.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(value)) {
        throw new ActionParamError('dayDir', "'dayDir' must be an absolute path.");
    }
    if (basename(value) !== day) throw new ActionParamError('dayDir', "'dayDir' must end with the day it names.");
    return value;
}

/** The channels of a retry, as the plan's `--channels` csv: safe tokens, bounded count. */
function channels(params: Record<string, string>): string[] {
    const raw = required(params, 'channels');
    const list = raw.split(',').map((entry) => entry.trim());
    if (list.length > 16) throw new ActionParamError('channels', 'At most 16 channels are accepted.');
    for (const channel of list) {
        if (!CHANNEL_PATTERN.test(channel)) throw new ActionParamError('channels', "'channels' must be channel ids.");
    }
    return list;
}

/**
 * Resolve one action kind's argv from validated params.
 *
 * Throws {@link ActionParamError} naming the offending key; nothing is spawned here, and a caller
 * that cannot satisfy the parameter domain must not emit the recipe.
 */
export function resolveArgv(kind: ActionKind, params: Record<string, string>): ResolvedAction {
    allow(kind, params);
    switch (kind) {
        case 'generate-from-node': {
            const node = match(params, 'node', NODE_PATTERN, 'a workflow node id');
            const runId = match(params, 'runId', RUN_ID_PATTERN, 'a run id');
            return {
                argv: [
                    'spur',
                    'workflow',
                    'run',
                    'plugins/kk/workflows/kk-news-generate.yaml',
                    '--from',
                    node,
                    '--from-run',
                    runId,
                    '--async',
                    '--json',
                ],
                live: false,
            };
        }
        case 'publish-retry': {
            const day = match(params, 'day', DAY_PATTERN, 'a YYYYMMDD day');
            const window = oneOf(params, 'window', PUBLISH_WINDOWS);
            const retry = ['kk', 'news', 'publish', '--run-date', day, '--window', window, '--retry'];
            const list = params.channels === undefined ? [] : ['--channels', channels(params).join(',')];
            return { argv: [...retry, ...list], dryRunArgv: [...retry, ...list, '--dry-run'], live: true };
        }
        case 'publish-window': {
            const day = match(params, 'day', DAY_PATTERN, 'a YYYYMMDD day');
            const window = oneOf(params, 'window', PUBLISH_WINDOWS);
            const dummy = params.dummy === 'true';
            if (params.dummy !== undefined && params.dummy !== 'true' && params.dummy !== 'false') {
                throw new ActionParamError('dummy', "'dummy' must be 'true' or 'false'.");
            }
            return {
                argv: ['kk', 'news', 'publish', '--run-date', day, '--window', window, ...(dummy ? ['--dummy'] : [])],
                live: !dummy,
            };
        }
        case 'rerender-step': {
            const day = match(params, 'day', DAY_PATTERN, 'a YYYYMMDD day');
            const dir = dayDir(params, day);
            const step = oneOf(params, 'step', RERENDER_STEPS);
            const engine = params.engine === undefined ? [] : ['--engine', oneOf(params, 'engine', VOICE_ENGINES)];
            if (engine.length > 0 && step !== 'voice') {
                throw new ActionParamError('engine', "'engine' applies to the voice step only.");
            }
            return { argv: ['kk', 'news', `generate-${step}`, '--work-dir', dir, ...engine], live: false };
        }
        case 'cancel-run': {
            const runId = match(params, 'runId', RUN_ID_PATTERN, 'a run id');
            return { argv: ['spur', 'workflow', 'cancel', runId, '--json'], live: false };
        }
        case 'store-release': {
            const runId = match(params, 'runId', RUN_ID_PATTERN, 'a run id');
            return { argv: ['kk', 'store', 'release', '--run', runId], live: false };
        }
    }
}

/**
 * Build one recipe, or null when the params cannot satisfy its kind.
 *
 * A recipe that cannot resolve is never emitted half-valid: an item without a recipe says so in its
 * message instead of offering a command that would be refused.
 */
export function recipeOf(kind: ActionKind, label: string, params: Record<string, string>): Recipe | null {
    let resolved: ResolvedAction;
    try {
        resolved = resolveArgv(kind, params);
    } catch (error) {
        if (error instanceof ActionParamError) return null;
        throw error;
    }
    return {
        kind,
        label,
        params,
        argv: resolved.argv,
        ...(resolved.dryRunArgv === undefined ? {} : { dryRunArgv: resolved.dryRunArgv }),
        live: resolved.live,
    };
}
