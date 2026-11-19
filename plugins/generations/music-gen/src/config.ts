import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { resolveTakesCap } from './spend';

/**
 * Music plugin configuration (task 0398 R2; contract frozen by
 * `docs/design/music-gen.md` §6.1).
 *
 * One reader, three layers, no second config file: `environment override >
 * music config key > documented default`. The config file is the existing kk
 * user config (`KK_CONFIG`, else `~/.config/kk/config.yaml`) — the same
 * document `packages/kk-store/src/config.ts` reads — with the plugin's settings
 * under `music:`. Nothing machine-specific is committed.
 *
 * Key spellings: the frozen 0397 table names `music.instance.url` /
 * `music.instance.timeoutMs` / `music.instance.connectTimeoutMs`, while 0401 R2
 * names the flat `music.baseUrl` / `music.timeoutMs` / `music.takesCap`. Both
 * spellings are read (flat wins when both appear) so the CLI that 0401 ships and
 * the contract 0397 froze cannot disagree — the one behaviour this file adds
 * beyond the table.
 */

/** Documented default instance base URL (§6.1): loopback port 3000, provisional until 0404's dogfood. */
export const DEFAULT_INSTANCE_URL = 'http://127.0.0.1:3000';

/** End-to-end generate deadline: sized for a 30–120 s blocking call so a slow success is not cut off. */
export const DEFAULT_GENERATE_TIMEOUT_MS = 180_000;

/** Connect-phase deadline: an unreachable host fails fast enough for the bounded retry to matter. */
export const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

/** Environment overrides (§6.1). There is deliberately no env override for the connect timeout. */
export const MUSIC_ENV_KEYS = {
    instanceUrl: 'KK_MUSIC_INSTANCE_URL',
    timeoutMs: 'KK_MUSIC_TIMEOUT_MS',
    dryRun: 'KK_MUSIC_DRY_RUN',
    configPath: 'KK_CONFIG',
    runId: 'KK_MUSIC_RUN_ID',
} as const;

/** Per-model and per-analyze unit prices. `analyze` is unpriced (`null`) until the instance bills it. */
export interface MusicPrices {
    pro: number;
    clip: number;
    /** `null` = unpriced, never "free". The sidecar records `null` verbatim. */
    analyze: number | null;
}

/** Unit prices default (§6.1): provider list prices; 0400 owns the spend cap, not these. */
export const DEFAULT_MUSIC_PRICES: MusicPrices = { pro: 0.08, clip: 0.04, analyze: null };

/** Which layer supplied a resolved setting (`0401`'s verbose output prints these). */
export type MusicConfigSource = 'env' | 'config' | 'default';

/** The effective plugin configuration. */
export interface MusicConfig {
    baseUrl: string;
    timeoutMs: number;
    connectTimeoutMs: number;
    prices: MusicPrices;
    /** Takes per invocation, resolved by the spend guard's single rule (0400 R4): default 2, never above 4. */
    takesCap: number;
    dryRun: boolean;
    /** `KK_MUSIC_RUN_ID`: the workflow run a take belongs to, recorded in its sidecar (0400 R4). */
    runId?: string;
}

/** A resolved configuration plus the provenance of each setting. */
export interface ResolvedMusicConfig extends MusicConfig {
    sources: {
        baseUrl: MusicConfigSource;
        timeoutMs: MusicConfigSource;
        connectTimeoutMs: MusicConfigSource;
        prices: MusicConfigSource;
        takesCap: MusicConfigSource;
        dryRun: MusicConfigSource;
    };
}

/** Raised when a config key is present but of the wrong type or outside its domain. */
export class MusicConfigError extends Error {
    /** Dotted key that failed, so the one-line remediation can name it. */
    readonly key: string;

    constructor(key: string, message: string) {
        super(`${key}: ${message}`);
        this.name = 'MusicConfigError';
        this.key = key;
    }
}

/** The `music:` block, as read from the config document (every field optional). */
export interface MusicConfigDocument {
    baseUrl?: string;
    timeoutMs?: number;
    connectTimeoutMs?: number;
    prices?: Partial<MusicPrices>;
    /** `music.takesCap`: the 0400 take cap (default 2, never above 4). */
    takesCap?: number;
}

/** Resolve the kk config path: `KK_CONFIG`, else `<home>/.config/kk/config.yaml`. */
export function resolveMusicConfigPath(env: Record<string, string | undefined> = process.env): string {
    const configured = env[MUSIC_ENV_KEYS.configPath];
    const raw =
        configured !== undefined && configured.trim() !== '' ? configured : join('.config', 'kk', 'config.yaml');
    const expanded = raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : raw;
    return isAbsolute(expanded) ? expanded : resolve(homedir(), expanded);
}

/** True when the value is a JSON-style object (not `null`, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read one non-empty string, or `undefined` when absent. A present non-string throws. */
function readString(document: Record<string, unknown>, field: string, label: string): string | undefined {
    const value = document[field];
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'string' || value.trim() === '') {
        throw new MusicConfigError(label, 'expected a non-empty string');
    }
    return value.trim();
}

/** Read one positive integer, or `undefined` when absent. A present non-positive value throws. */
function readPositiveInt(document: Record<string, unknown>, field: string, label: string): number | undefined {
    const value = document[field];
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        throw new MusicConfigError(label, 'expected a positive integer');
    }
    return value;
}

/** Read one non-negative finite price; `null` is allowed only for `analyze` (unpriced). */
function readPrice(
    document: Record<string, unknown>,
    field: string,
    label: string,
    allowNull: boolean,
): number | null | undefined {
    const value = document[field];
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        if (allowNull) {
            return null;
        }
        throw new MusicConfigError(label, 'expected a non-negative number');
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new MusicConfigError(label, 'expected a non-negative number');
    }
    return value;
}

/**
 * Parse the `music:` block. A missing block is the zero-config case; a present
 * key of the wrong type throws (the `store.*` reader's rule) — a silently
 * defaulted base URL or timeout would send a paid request somewhere unexpected.
 */
export function parseMusicConfigDocument(parsed: unknown): MusicConfigDocument {
    if (!isRecord(parsed) || !isRecord(parsed.music)) {
        return {};
    }
    const music = parsed.music;
    const instance = isRecord(music.instance) ? music.instance : {};
    const baseUrl = readString(music, 'baseUrl', 'music.baseUrl') ?? readString(instance, 'url', 'music.instance.url');
    const timeoutMs =
        readPositiveInt(music, 'timeoutMs', 'music.timeoutMs') ??
        readPositiveInt(instance, 'timeoutMs', 'music.instance.timeoutMs');
    const connectTimeoutMs = readPositiveInt(instance, 'connectTimeoutMs', 'music.instance.connectTimeoutMs');
    const takesCap = readPositiveInt(music, 'takesCap', 'music.takesCap');
    const result: MusicConfigDocument = {};
    if (baseUrl !== undefined) {
        result.baseUrl = baseUrl;
    }
    if (timeoutMs !== undefined) {
        result.timeoutMs = timeoutMs;
    }
    if (connectTimeoutMs !== undefined) {
        result.connectTimeoutMs = connectTimeoutMs;
    }
    if (takesCap !== undefined) {
        result.takesCap = takesCap;
    }
    if (isRecord(music.prices)) {
        const prices = music.prices;
        const pro = readPrice(prices, 'pro', 'music.prices.pro', false);
        const clip = readPrice(prices, 'clip', 'music.prices.clip', false);
        const analyze = readPrice(prices, 'analyze', 'music.prices.analyze', true);
        const partial: Partial<MusicPrices> = {};
        if (typeof pro === 'number') {
            partial.pro = pro;
        }
        if (typeof clip === 'number') {
            partial.clip = clip;
        }
        if (analyze !== undefined) {
            partial.analyze = analyze;
        }
        if (Object.keys(partial).length > 0) {
            result.prices = partial;
        }
    }
    return result;
}

/** Read one positive integer env override, or `undefined` when unset. A malformed value throws. */
function readEnvPositiveInt(env: Record<string, string | undefined>, key: string): number | undefined {
    const raw = env[key];
    if (raw === undefined || raw.trim() === '') {
        return undefined;
    }
    if (!/^\d+$/.test(raw.trim())) {
        throw new MusicConfigError(key, `expected a positive integer, received '${raw}'`);
    }
    const parsed = Number(raw.trim());
    if (parsed <= 0) {
        throw new MusicConfigError(key, `expected a positive integer, received '${raw}'`);
    }
    return parsed;
}

/** Read the config document; a missing or unparseable file is the zero-config case. */
async function readConfigDocument(
    fileSystem: FileSystem,
    configPath: string,
): Promise<{ document: MusicConfigDocument; readable: boolean }> {
    if (!(await fileSystem.exists(configPath))) {
        return { document: {}, readable: false };
    }
    let text: string;
    try {
        text = await fileSystem.readFile(configPath);
    } catch {
        return { document: {}, readable: false };
    }
    let parsed: unknown;
    try {
        parsed = Bun.YAML.parse(text);
    } catch {
        // An unparseable file yields the defaults, exactly like a missing one; a *present*
        // key of the wrong type still throws in parseMusicConfigDocument.
        return { document: {}, readable: false };
    }
    return { document: parseMusicConfigDocument(parsed), readable: true };
}

/**
 * Resolve the effective music configuration (§6.1 precedence: env > config > default).
 *
 * @param options.env       environment map (defaults to `process.env`)
 * @param options.fileSystem ts-runtime seam (defaults to the node/bun backend)
 * @param options.configPath explicit config file, overriding `KK_CONFIG`
 */
export async function resolveMusicConfig(
    options: { env?: Record<string, string | undefined>; fileSystem?: FileSystem; configPath?: string } = {},
): Promise<ResolvedMusicConfig> {
    const env = options.env ?? process.env;
    const fileSystem = options.fileSystem ?? createNodeFileSystem();
    const configPath = options.configPath ?? resolveMusicConfigPath(env);
    const { document, readable } = await readConfigDocument(fileSystem, configPath);

    const envBaseUrl = env[MUSIC_ENV_KEYS.instanceUrl]?.trim();
    const envTimeout = readEnvPositiveInt(env, MUSIC_ENV_KEYS.timeoutMs);

    const baseUrl = envBaseUrl !== undefined && envBaseUrl !== '' ? envBaseUrl : document.baseUrl;
    const timeoutMs = envTimeout ?? document.timeoutMs;
    const connectTimeoutMs = document.connectTimeoutMs;
    const dryRun = env[MUSIC_ENV_KEYS.dryRun] === '1';
    const runId = env[MUSIC_ENV_KEYS.runId]?.trim();

    const priceSource: MusicConfigSource = document.prices === undefined ? 'default' : readable ? 'config' : 'default';

    return {
        baseUrl: baseUrl ?? DEFAULT_INSTANCE_URL,
        timeoutMs: timeoutMs ?? DEFAULT_GENERATE_TIMEOUT_MS,
        connectTimeoutMs: connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
        prices: { ...DEFAULT_MUSIC_PRICES, ...(document.prices ?? {}) },
        // `music.takesCap` is validated by the spend guard's own rule, so a cap above 4 is
        // rejected here — at load, before any estimate, dedupe or socket (0400 AC4).
        takesCap: resolveTakesCap(document.takesCap),
        dryRun,
        ...(runId === undefined || runId === '' ? {} : { runId }),
        sources: {
            baseUrl:
                envBaseUrl !== undefined && envBaseUrl !== ''
                    ? 'env'
                    : document.baseUrl === undefined
                      ? 'default'
                      : 'config',
            timeoutMs: envTimeout !== undefined ? 'env' : document.timeoutMs === undefined ? 'default' : 'config',
            connectTimeoutMs: connectTimeoutMs === undefined ? 'default' : 'config',
            prices: priceSource,
            takesCap: document.takesCap === undefined ? 'default' : 'config',
            dryRun: 'env',
        },
    };
}
