import { isAbsolute, join, resolve } from 'node:path';
import { RAW_SOURCE_TYPES, type RawSourceType } from '@gobing-ai/kk-wiki';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';

/**
 * `kk.config.json` — the project-level vault config (ADR-047).
 *
 * House rule (mirrors `apps/cli/src/itc-config.ts`): this module owns only the `wiki` block, never
 * creates or rewrites the file, and fails naming an unsupported declared key. The project file wins
 * over `~/.config/kk/config.yaml` for vault paths only; channels, presets and credentials stay with
 * the global config.
 */

export const WIKI_CONFIG_FILE = 'kk.config.json';

/** One configured remote: the command template plus its target. */
export interface WikiRemote {
    command: string;
    remote: string;
}

/** Effective vault configuration for this run (paths absolute after resolution). */
export interface WikiConfig {
    root: string;
    raw: string;
    content: string;
    defaultType: RawSourceType;
    mirrors: string[];
    remotes: Record<string, WikiRemote>;
}

/** A `kk.config.json` defect: unreadable, malformed, or an unsupported declared key. */
export class WikiConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'WikiConfigError';
    }
}

const KEYS = ['root', 'raw', 'content', 'defaultType', 'mirrors', 'remotes'] as const;
type Key = (typeof KEYS)[number];

const DEFAULTS: WikiConfig = {
    root: '.',
    raw: 'raw',
    content: 'content',
    defaultType: 'html',
    mirrors: [],
    remotes: {},
};

/** The three path keys an environment variable can override. */
type PathKey = 'root' | 'raw' | 'content';

const ENV_MAP: Record<string, PathKey | 'defaultType'> = {
    KK_WIKI_ROOT: 'root',
    KK_WIKI_RAW: 'raw',
    KK_WIKI_CONTENT: 'content',
    KK_WIKI_DEFAULT_TYPE: 'defaultType',
};

/** Inputs for {@link resolveWikiConfig}: cwd, environment, injected fs and CLI flags. */
export interface ResolveWikiConfigOptions {
    cwd?: string;
    fileSystem?: FileSystem;
    env?: Record<string, string | undefined>;
    /** Explicit CLI flags win over everything. */
    overrides?: Partial<Pick<WikiConfig, 'root' | 'raw' | 'content' | 'defaultType'>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(block: Record<string, unknown>, key: string, source: string): string | undefined {
    const value = block[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || value.trim() === '') {
        throw new WikiConfigError(`${WIKI_CONFIG_FILE}: wiki.${key} must be a non-empty string (${source})`);
    }
    return value;
}

function parseBlock(raw: unknown): Partial<WikiConfig> {
    if (raw === undefined) return {};
    if (!isRecord(raw)) throw new WikiConfigError(`${WIKI_CONFIG_FILE}: "wiki" must be an object`);
    for (const key of Object.keys(raw)) {
        if (!KEYS.includes(key as Key)) {
            throw new WikiConfigError(`${WIKI_CONFIG_FILE}: unsupported key wiki.${key} (allowed: ${KEYS.join(', ')})`);
        }
    }
    const block: Partial<WikiConfig> = {};
    const root = stringField(raw, 'root', 'wiki.root');
    const rawDir = stringField(raw, 'raw', 'wiki.raw');
    const content = stringField(raw, 'content', 'wiki.content');
    if (root !== undefined) block.root = root;
    if (rawDir !== undefined) block.raw = rawDir;
    if (content !== undefined) block.content = content;

    const defaultType = stringField(raw, 'defaultType', 'wiki.defaultType');
    if (defaultType !== undefined) {
        if (!(RAW_SOURCE_TYPES as readonly string[]).includes(defaultType)) {
            throw new WikiConfigError(
                `${WIKI_CONFIG_FILE}: wiki.defaultType '${defaultType}' is not one of ${RAW_SOURCE_TYPES.join('|')}`,
            );
        }
        block.defaultType = defaultType as RawSourceType;
    }

    const mirrors = raw.mirrors;
    if (mirrors !== undefined) {
        if (!Array.isArray(mirrors) || mirrors.some((entry) => typeof entry !== 'string')) {
            throw new WikiConfigError(`${WIKI_CONFIG_FILE}: wiki.mirrors must be an array of strings`);
        }
        block.mirrors = mirrors as string[];
    }

    const remotes = raw.remotes;
    if (remotes !== undefined) {
        if (!isRecord(remotes)) throw new WikiConfigError(`${WIKI_CONFIG_FILE}: wiki.remotes must be an object`);
        const parsed: Record<string, WikiRemote> = {};
        for (const [name, value] of Object.entries(remotes)) {
            if (!isRecord(value) || typeof value.command !== 'string' || typeof value.remote !== 'string') {
                throw new WikiConfigError(
                    `${WIKI_CONFIG_FILE}: wiki.remotes.${name} must be { command: string, remote: string }`,
                );
            }
            parsed[name] = { command: value.command, remote: value.remote };
        }
        block.remotes = parsed;
    }
    return block;
}

async function readConfigFile(cwd: string, fileSystem: FileSystem): Promise<Partial<WikiConfig>> {
    const path = join(cwd, WIKI_CONFIG_FILE);
    if (!(await fileSystem.exists(path))) return {};
    let text: string;
    try {
        text = await fileSystem.readFile(path);
    } catch (error) {
        const code = (error as { code?: string }).code;
        throw new WikiConfigError(`${WIKI_CONFIG_FILE}: cannot read (${String(code ?? error)})`);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        throw new WikiConfigError(`${WIKI_CONFIG_FILE}: invalid JSON (${(error as Error).message})`);
    }
    if (!isRecord(parsed)) throw new WikiConfigError(`${WIKI_CONFIG_FILE}: top level must be an object`);
    return parseBlock(parsed.wiki);
}

/** Resolve the effective config: flags > `KK_WIKI_*` env > `kk.config.json` > built-in defaults. */
export async function resolveWikiConfig(options: ResolveWikiConfigOptions = {}): Promise<WikiConfig> {
    const cwd = options.cwd ?? process.cwd();
    const env = options.env ?? process.env;
    const fileConfig = await readConfigFile(cwd, options.fileSystem ?? createNodeFileSystem());
    const merged: WikiConfig = { ...DEFAULTS, ...fileConfig };

    for (const [name, key] of Object.entries(ENV_MAP) as [string, PathKey | 'defaultType'][]) {
        const value = env[name];
        if (value === undefined || value.trim() === '') continue;
        if (key === 'defaultType') {
            if (!(RAW_SOURCE_TYPES as readonly string[]).includes(value)) {
                throw new WikiConfigError(`${name} '${value}' is not one of ${RAW_SOURCE_TYPES.join('|')}`);
            }
            merged.defaultType = value as RawSourceType;
            continue;
        }
        merged[key] = value;
    }
    Object.assign(
        merged,
        Object.fromEntries(Object.entries(options.overrides ?? {}).filter(([, v]) => v !== undefined)),
    );

    merged.root = resolve(cwd, merged.root);
    for (const key of ['raw', 'content'] as const) {
        if (!isAbsolute(merged[key])) merged[key] = join(merged.root, merged[key]);
    }
    return merged;
}
