import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';

// 0361 R3: the config-path convention (with its `~` expansion) is neutral — it lives in the publish
// core and is re-exported here under the ITC name the existing callers use.
import { expandHome, resolveConfigPath as resolveItcConfigPath } from './publish-core';

export { resolveItcConfigPath };

/**
 * ITC configuration, workspace composition and the frozen effective-options snapshot (0303 / G21).
 *
 * This module owns ONLY the `kk-itc` entry: it composes the 0298–0302 helpers from explicit input
 * and never changes the daily/storm/podcast resolvers. A missing config file uses compiled
 * defaults and ITC never creates or rewrites one; a present-but-unsupported declared field fails
 * before any workspace mutation, naming the key without echoing values.
 */

/** The workflows.kk-itc block this task owns. Anything else in the config is left untouched. */
export interface ItcConfigBlock {
    writer?: 'itc-generating' | 'topic';
    playbook?: 'generic' | 'english' | 'wechat';
    source_locale?: 'en' | 'zh' | 'ja';
    research?: boolean;
    judge?: boolean;
    unslosh?: never;
    unslop?: boolean;
    auto?: boolean;
    max_revisions?: number;
    topic_profile?: string;
    publish_preset?: string;
    workspace?: { dated?: boolean };
    seo?: { mode?: 'off' | 'handoff' };
}

/** One launch input as the CLI/argv layer hands it over. `undefined` means ABSENT (distinct from an explicit empty/false). */
export interface ItcLaunchInput {
    topic?: string;
    inputFile?: string;
    fromCollect?: string;
    refreshCollect?: boolean;
    topicProfile?: string;
    publishPreset?: string;
    writer?: string;
    playbook?: string;
    sourceLocale?: string;
    research?: boolean;
    judge?: boolean;
    unslop?: boolean;
    auto?: boolean;
    maxRevisions?: number;
    coverEnabled?: boolean;
    inlineImages?: boolean;
    publishTargets?: string;
    publishLive?: boolean;
    seo?: 'off' | 'handoff';
    runDate?: string;
    dir?: string;
    force?: boolean;
    workDir?: string;
    projectRoot?: string;
    parentRunId?: string;
}

/** Filesystem + clock seams so the whole resolver is testable without touching a real $HOME. */
export interface ItcContext {
    env?: Record<string, string | undefined>;
    homeDir?: string;
    cwd?: string;
    now?: () => Date;
}

/** The frozen, versioned, non-secret effective options for one ITC run. */
export interface ItcEffectiveOptions {
    schemaVersion: 1;
    status: 'intake' | 'prepared';
    parentRunId: string;
    launchProjectRoot: string;
    worksRoot: string;
    workDir: string | null;
    topicName: string | null;
    displayTitle: string | null;
    writer: 'itc-generating' | 'topic';
    playbook: 'generic' | 'english' | 'wechat';
    sourceLocale: 'en' | 'zh' | 'ja';
    research: boolean;
    judge: boolean;
    unslop: boolean;
    auto: boolean;
    maxRevisions: number;
    coverEnabled: boolean;
    inlineImages: boolean;
    publishTargets: string;
    publishLive: boolean;
    publishPreset: string | null;
    /** Whether the preset came from the launch flag or `workflows.kk-itc` (target precedence, 0300). */
    publishPresetSource: 'launch' | 'config' | null;
    topicProfile: string | null;
    seo: 'off' | 'handoff';
    sourceKind: 'topic' | 'input_file' | 'from_collect';
    sourceValue: string;
    refreshCollect: boolean;
    dated: boolean;
    force: boolean;
    frozenAt: string;
    timezone: string;
    runDate: string | null;
    optionsDigest: string;
}

/** A config the operator wrote that ITC cannot honour: it names the key/file and never the value. */
export class ItcConfigInvalidError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ItcConfigInvalidError';
    }
}

/** A launch input ITC cannot honour (missing/conflicting source, bad slug, unparseable date). */
export class ItcLaunchInvalidError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ItcLaunchInvalidError';
    }
}

const COMPILED_DEFAULTS = {
    writer: 'itc-generating',
    playbook: 'generic',
    sourceLocale: 'en',
    research: false,
    judge: false,
    unslop: false,
    auto: false,
    maxRevisions: 2,
    coverEnabled: false,
    inlineImages: false,
    publishTargets: '',
    publishLive: false,
    seo: 'off',
    dated: false,
} as const;

const WRITERS = new Set(['itc-generating', 'topic']);
const PLAYBOOKS = new Set(['generic', 'english', 'wechat']);
const LOCALES = new Set(['en', 'zh', 'ja']);
const SEO_MODES = new Set(['off', 'handoff']);
const ITC_KEYS = new Set([
    'writer',
    'playbook',
    'source_locale',
    'research',
    'judge',
    'unslop',
    'auto',
    'max_revisions',
    'topic_profile',
    'publish_preset',
    'workspace',
    'seo',
]);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A safe ASCII slug: lowercase alphanumerics with single hyphens. */
export function isSafeSlug(value: string): boolean {
    return SLUG.test(value);
}

/**
 * The ITC workspace leaf for a Unicode topic name: NFC, lowercased, every run of non-letter/number
 * separators collapsed to one hyphen. Returns null for names that would escape the root or carry
 * path/control characters — the caller must then require an explicit slug.
 */
export function slugifyTopicName(name: string): string | null {
    if (name.includes('\0')) return null;
    const normalized = name.normalize('NFC').toLowerCase();
    // A path separator or a control character would let a name escape the composed leaf.
    const unsafe = new RegExp(`[/\\\\${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`);
    if (unsafe.test(normalized)) return null;
    const slug = normalized.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
    if (slug === '' || slug === '.' || slug === '..') return null;
    return slug;
}

/** Canonical JSON with recursively sorted keys, so the digest never depends on insertion order. */
function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** The frozen snapshot digest: canonical JSON of the options, excluding volatile/self fields. */
export function digestItcOptions(options: Omit<ItcEffectiveOptions, 'optionsDigest' | 'frozenAt'>): string {
    return createHash('sha256').update(canonicalJson(options)).digest('hex');
}

/**
 * Parse and strictly validate the `workflows.kk-itc` block.
 *
 * A missing file is an empty block (compiled defaults). A malformed file, an unknown declared key,
 * or a wrong-typed value throws {@link ItcConfigInvalidError} naming the key — never the value.
 */
export async function readItcConfigBlock(
    configPath: string,
    fs: FileSystem = createNodeFileSystem(),
): Promise<ItcConfigBlock> {
    if (!(await fs.exists(configPath))) return {};
    let text: string;
    try {
        text = await fs.readFile(configPath);
    } catch {
        throw new ItcConfigInvalidError(`config file is unreadable: ${configPath}`);
    }
    let parsed: unknown;
    try {
        parsed = Bun.YAML.parse(text);
    } catch {
        throw new ItcConfigInvalidError(`config file is not valid YAML: ${configPath}`);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new ItcConfigInvalidError(`config file has no top-level mapping: ${configPath}`);
    }
    const root = parsed as Record<string, unknown>;
    for (const key of ['works_dir', 'workflows_dir']) {
        if (root[key] !== undefined && (typeof root[key] !== 'string' || root[key].trim() === '')) {
            throw new ItcConfigInvalidError(`config key '${key}' must be a nonempty path string`);
        }
    }
    const workflows = root.workflows;
    if (workflows === undefined) return {};
    if (workflows === null || typeof workflows !== 'object' || Array.isArray(workflows)) {
        throw new ItcConfigInvalidError("config key 'workflows' must be a mapping");
    }
    const block = (workflows as Record<string, unknown>)['kk-itc'];
    if (block === undefined) return {};
    if (block === null || typeof block !== 'object' || Array.isArray(block)) {
        throw new ItcConfigInvalidError("config key 'workflows.kk-itc' must be a mapping");
    }
    return validateItcBlock(block as Record<string, unknown>);
}

function validateItcBlock(raw: Record<string, unknown>): ItcConfigBlock {
    for (const key of Object.keys(raw)) {
        if (!ITC_KEYS.has(key)) {
            throw new ItcConfigInvalidError(
                `config key 'workflows.kk-itc.${key}' is not a declared ITC setting (allowed: ${[...ITC_KEYS].join(', ')})`,
            );
        }
    }
    const out: ItcConfigBlock = {};
    const enumAt = <T extends string>(key: string, allowed: Set<string>): T | undefined => {
        const value = raw[key];
        if (value === undefined) return undefined;
        if (typeof value !== 'string' || !allowed.has(value)) {
            throw new ItcConfigInvalidError(
                `config key 'workflows.kk-itc.${key}' must be one of ${[...allowed].join('|')}`,
            );
        }
        return value as T;
    };
    const boolAt = (key: string): boolean | undefined => {
        const value = raw[key];
        if (value === undefined) return undefined;
        if (typeof value !== 'boolean') {
            throw new ItcConfigInvalidError(`config key 'workflows.kk-itc.${key}' must be a boolean`);
        }
        return value;
    };
    const slugAt = (key: string): string | undefined => {
        const value = raw[key];
        if (value === undefined) return undefined;
        if (typeof value !== 'string' || !isSafeSlug(value)) {
            throw new ItcConfigInvalidError(`config key 'workflows.kk-itc.${key}' must be a lowercase hyphenated slug`);
        }
        return value;
    };

    const writer = enumAt<'itc-generating' | 'topic'>('writer', WRITERS);
    if (writer !== undefined) out.writer = writer;
    const playbook = enumAt<'generic' | 'english' | 'wechat'>('playbook', PLAYBOOKS);
    if (playbook !== undefined) out.playbook = playbook;
    const sourceLocale = enumAt<'en' | 'zh' | 'ja'>('source_locale', LOCALES);
    if (sourceLocale !== undefined) out.source_locale = sourceLocale;
    for (const key of ['research', 'judge', 'unslop', 'auto'] as const) {
        const value = boolAt(key);
        if (value !== undefined) out[key] = value;
    }
    const maxRevisions = raw.max_revisions;
    if (maxRevisions !== undefined) {
        if (
            typeof maxRevisions !== 'number' ||
            !Number.isInteger(maxRevisions) ||
            maxRevisions < 0 ||
            maxRevisions > 10
        ) {
            throw new ItcConfigInvalidError(
                "config key 'workflows.kk-itc.max_revisions' must be an integer from 0 to 10",
            );
        }
        out.max_revisions = maxRevisions;
    }
    const topicProfile = slugAt('topic_profile');
    if (topicProfile !== undefined) out.topic_profile = topicProfile;
    const publishPreset = slugAt('publish_preset');
    if (publishPreset !== undefined) out.publish_preset = publishPreset;

    const workspace = raw.workspace;
    if (workspace !== undefined) {
        if (workspace === null || typeof workspace !== 'object' || Array.isArray(workspace)) {
            throw new ItcConfigInvalidError("config key 'workflows.kk-itc.workspace' must be a mapping");
        }
        const ws = workspace as Record<string, unknown>;
        for (const key of Object.keys(ws)) {
            if (key !== 'dated') {
                throw new ItcConfigInvalidError(`config key 'workflows.kk-itc.workspace.${key}' is not declared`);
            }
        }
        if (ws.dated !== undefined && typeof ws.dated !== 'boolean') {
            throw new ItcConfigInvalidError("config key 'workflows.kk-itc.workspace.dated' must be a boolean");
        }
        out.workspace = ws.dated === undefined ? {} : { dated: ws.dated };
    }

    const seo = raw.seo;
    if (seo !== undefined) {
        if (seo === null || typeof seo !== 'object' || Array.isArray(seo)) {
            throw new ItcConfigInvalidError("config key 'workflows.kk-itc.seo' must be a mapping");
        }
        const seoRecord = seo as Record<string, unknown>;
        for (const key of Object.keys(seoRecord)) {
            if (key !== 'mode') {
                throw new ItcConfigInvalidError(`config key 'workflows.kk-itc.seo.${key}' is not declared`);
            }
        }
        const mode = seoRecord.mode;
        if (mode !== undefined) {
            if (typeof mode !== 'string' || !SEO_MODES.has(mode)) {
                throw new ItcConfigInvalidError("config key 'workflows.kk-itc.seo.mode' must be one of off|handoff");
            }
            out.seo = { mode: mode as 'off' | 'handoff' };
        } else {
            out.seo = {};
        }
    }
    return out;
}

/** `works_dir` / `workspaces.dir` from the top-level config, resolved against the config's directory. */
async function readWorksRoot(
    configPath: string,
    env: Record<string, string | undefined>,
    homeDir: string,
    fs: FileSystem,
): Promise<string> {
    const fromEnv = env.KK_WORKS_DIR;
    if (fromEnv !== undefined && fromEnv.trim() !== '') {
        const expanded = expandHome(fromEnv.trim(), homeDir);
        return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
    }
    if (!(await fs.exists(configPath))) return resolve(process.cwd(), '.works');
    try {
        const parsed = Bun.YAML.parse(await fs.readFile(configPath)) as Record<string, unknown> | null;
        const raw = parsed?.works_dir;
        if (typeof raw === 'string' && raw.trim() !== '') {
            const expanded = expandHome(raw.trim(), homeDir);
            // A relative works_dir resolves against the CONFIG's directory, never the cwd.
            return isAbsolute(expanded) ? expanded : resolve(dirname(configPath), expanded);
        }
    } catch {
        // A malformed config already fails in readItcConfigBlock; an unreadable works_dir falls back.
    }
    // Compiled default: <cwd>/.works — the config root holds no disposable data (ADR).
    return resolve(process.cwd(), '.works');
}

/** A real calendar date `YYYYMMDD`, or null when the token is not one. */
export function parseRunDate(raw: string): string | null {
    if (!/^\d{8}$/.test(raw)) return null;
    const year = Number(raw.slice(0, 4));
    const month = Number(raw.slice(4, 6));
    const day = Number(raw.slice(6, 8));
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return raw;
}

/** Pick the single source: exactly one of topic | input_file | from_collect. */
function resolveSource(input: ItcLaunchInput): {
    sourceKind: 'topic' | 'input_file' | 'from_collect';
    sourceValue: string;
} {
    const topic = input.topic !== undefined && input.topic !== '' ? input.topic : undefined;
    const inputFile = input.inputFile !== undefined && input.inputFile !== '' ? input.inputFile : undefined;
    const fromCollect = input.fromCollect !== undefined && input.fromCollect !== '' ? input.fromCollect : undefined;
    const set = [topic, inputFile, fromCollect].filter((v): v is string => v !== undefined);
    if (set.length === 0) {
        throw new ItcLaunchInvalidError('exactly one of --topic, --input-file or --from-collect is required');
    }
    if (set.length > 1) {
        throw new ItcLaunchInvalidError(
            'exactly one of --topic, --input-file or --from-collect is required (two given)',
        );
    }
    if (topic !== undefined) return { sourceKind: 'topic', sourceValue: topic };
    // An input file is data, not a slug: metacharacters and spaces are preserved verbatim.
    if (inputFile !== undefined) return { sourceKind: 'input_file', sourceValue: inputFile };
    return { sourceKind: 'from_collect', sourceValue: fromCollect as string };
}

/** First defined value wins; `undefined` (absent) is skipped, an explicit `false`/`0` is not. */
function pick<T>(...values: (T | undefined)[]): T | undefined {
    for (const value of values) if (value !== undefined) return value;
    return undefined;
}

/**
 * Resolve and FREEZE the effective ITC options.
 *
 * Precedence for every option: explicit launch flag > `--auto` implied default (research/judge/
 * unslop only, and only when not explicitly supplied) > existing declared environment override >
 * `workflows.kk-itc` > global `defaults` > compiled default. `status` is `intake` when the source is
 * a collected topic profile (the selected topic is not known yet) and `prepared` otherwise.
 */
export async function resolveItcOptions(
    input: ItcLaunchInput,
    context: ItcContext = {},
    fs: FileSystem = createNodeFileSystem(),
): Promise<ItcEffectiveOptions> {
    const env = context.env ?? process.env;
    const homeDir = context.homeDir ?? env.HOME ?? '~';
    const cwd = context.cwd ?? process.cwd();
    const now = context.now ?? ((): Date => new Date());

    const configPath = resolveItcConfigPath(env, homeDir);
    const block = await readItcConfigBlock(configPath, fs);
    const worksRoot = await readWorksRoot(configPath, env, homeDir, fs);

    const source = resolveSource(input);

    // `--auto` may come from the flag or from config; an EXPLICIT per-option value always wins over
    // the auto-implied value, and a config-supplied auto never overrides a configured per-option.
    const autoFromFlag = input.auto;
    const autoFromConfig = block.auto;
    const autoEffective = pick(autoFromFlag, autoFromConfig) ?? COMPILED_DEFAULTS.auto;
    const autoIsExplicitLaunch = autoFromFlag !== undefined;

    const impliedWhenAuto = (value: boolean | undefined, configured: boolean | undefined): boolean | undefined => {
        if (value !== undefined) return value;
        if (autoIsExplicitLaunch && autoEffective) return true;
        if (configured !== undefined) return configured;
        if (autoEffective) return true;
        return undefined;
    };

    const playbook = (pick(input.playbook, block.playbook) ?? COMPILED_DEFAULTS.playbook) as
        | 'generic'
        | 'english'
        | 'wechat';
    if (!PLAYBOOKS.has(playbook)) {
        throw new ItcLaunchInvalidError(`--playbook must be one of ${[...PLAYBOOKS].join('|')}`);
    }

    const writer = (pick(input.writer, block.writer) ?? COMPILED_DEFAULTS.writer) as 'itc-generating' | 'topic';
    if (!WRITERS.has(writer)) {
        throw new ItcLaunchInvalidError(`--writer must be one of ${[...WRITERS].join('|')}`);
    }

    // `--playbook wechat` implies zh ONLY when no explicit source locale was supplied.
    const explicitLocale = pick(input.sourceLocale, block.source_locale);
    const sourceLocale = (explicitLocale ?? (playbook === 'wechat' ? 'zh' : COMPILED_DEFAULTS.sourceLocale)) as
        | 'en'
        | 'zh'
        | 'ja';
    if (!LOCALES.has(sourceLocale)) {
        throw new ItcLaunchInvalidError(`--source-locale must be one of ${[...LOCALES].join('|')}`);
    }

    const maxRevisions = pick(input.maxRevisions, block.max_revisions) ?? COMPILED_DEFAULTS.maxRevisions;
    if (!Number.isInteger(maxRevisions) || maxRevisions < 0 || maxRevisions > 10) {
        throw new ItcLaunchInvalidError('--max-revisions must be an integer from 0 to 10');
    }

    const seo = (pick(input.seo, block.seo?.mode) ?? COMPILED_DEFAULTS.seo) as 'off' | 'handoff';
    if (!SEO_MODES.has(seo)) {
        throw new ItcLaunchInvalidError('--seo must be one of off|handoff');
    }

    const publishPreset = pick(input.publishPreset, block.publish_preset);
    if (publishPreset !== undefined && !isSafeSlug(publishPreset)) {
        throw new ItcLaunchInvalidError('--publish-preset must be a lowercase hyphenated slug');
    }
    const topicProfile = pick(input.topicProfile, block.topic_profile);
    if (topicProfile !== undefined && !isSafeSlug(topicProfile)) {
        throw new ItcLaunchInvalidError('--topic-profile must be a lowercase hyphenated slug');
    }

    const runDateInput = input.runDate;
    let runDate: string | null = null;
    if (runDateInput !== undefined && runDateInput !== '') {
        runDate = parseRunDate(runDateInput);
        if (runDate === null) {
            throw new ItcLaunchInvalidError('--run-date must be a real calendar date as YYYYMMDD');
        }
    }

    const force = input.force ?? false;
    const frozen = now();
    if (runDate === null && block.workspace?.dated) {
        runDate = `${frozen.getFullYear()}${String(frozen.getMonth() + 1).padStart(2, '0')}${String(frozen.getDate()).padStart(2, '0')}`;
    }
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const intake = source.sourceKind === 'from_collect';
    const draft: Omit<ItcEffectiveOptions, 'optionsDigest' | 'frozenAt'> = {
        schemaVersion: 1,
        status: intake ? 'intake' : 'prepared',
        parentRunId: input.parentRunId ?? '',
        launchProjectRoot: resolve(input.projectRoot ?? cwd),
        worksRoot,
        workDir: null,
        topicName: intake ? null : source.sourceValue,
        displayTitle: null,
        writer,
        playbook,
        sourceLocale,
        research: impliedWhenAuto(input.research, block.research) ?? COMPILED_DEFAULTS.research,
        judge: impliedWhenAuto(input.judge, block.judge) ?? COMPILED_DEFAULTS.judge,
        unslop: impliedWhenAuto(input.unslop, block.unslop) ?? COMPILED_DEFAULTS.unslop,
        auto: autoEffective,
        maxRevisions,
        coverEnabled: input.coverEnabled ?? COMPILED_DEFAULTS.coverEnabled,
        inlineImages: input.inlineImages ?? COMPILED_DEFAULTS.inlineImages,
        publishTargets: input.publishTargets ?? COMPILED_DEFAULTS.publishTargets,
        publishLive: input.publishLive ?? COMPILED_DEFAULTS.publishLive,
        publishPreset: publishPreset ?? null,
        publishPresetSource:
            input.publishPreset !== undefined ? 'launch' : publishPreset !== undefined ? 'config' : null,
        topicProfile: topicProfile ?? null,
        seo,
        sourceKind: source.sourceKind,
        sourceValue: source.sourceValue,
        refreshCollect: input.refreshCollect ?? false,
        dated: runDate !== null,
        force,
        timezone,
        runDate,
    };

    // A direct topic/input already knows its workspace; a collected source finalizes it after ideation.
    const expandedInput = {
        ...input,
        ...(input.dir !== undefined ? { dir: expandHome(input.dir, homeDir) } : {}),
        ...(input.workDir !== undefined ? { workDir: expandHome(input.workDir, homeDir) } : {}),
    };
    const withWorkspace = intake ? draft : applyWorkspace(draft, expandedInput);

    return {
        ...withWorkspace,
        frozenAt: frozen.toISOString(),
        optionsDigest: digestItcOptions(withWorkspace),
    };
}

/**
 * The workspace leaf name for a source. A topic is used verbatim; an input FILE contributes its
 * basename without extension (the brief names the run), falling back to `itc-run`.
 */
function workspaceNameFor(sourceKind: ItcEffectiveOptions['sourceKind'], value: string): string {
    if (sourceKind === 'topic') return value;
    const base = value.split(/[/\\]/).pop() ?? '';
    const stem = base.replace(/\.[^.]*$/, '');
    return stem === '' ? 'itc-run' : stem;
}

/** Apply the workspace rule to a prepared (non-intake) options draft. */
function applyWorkspace(
    draft: Omit<ItcEffectiveOptions, 'optionsDigest' | 'frozenAt'>,
    input: ItcLaunchInput,
): Omit<ItcEffectiveOptions, 'optionsDigest' | 'frozenAt'> {
    const workspace = resolveItcWorkspace(draft, workspaceNameFor(draft.sourceKind, draft.sourceValue), input);
    return { ...draft, status: 'prepared', workDir: workspace.workDir, topicName: workspace.topicName };
}

/**
 * Finalize a collected-topic intake snapshot once ideation chose the topic: the chosen title names
 * the workspace and becomes the display title; every other frozen option stays as resolved at intake.
 */
export function finalizeItcCollectedOptions(
    options: ItcEffectiveOptions,
    chosen: Pick<ChosenTopic, 'topicName' | 'displayTitle' | 'topicProfile'>,
    input: Pick<ItcLaunchInput, 'dir' | 'workDir' | 'runDate'> = {},
): ItcEffectiveOptions {
    const { optionsDigest: _intakeDigest, frozenAt, ...draft } = options;
    const workspace = resolveItcWorkspace(draft, chosen.topicName, input);
    const prepared = {
        ...draft,
        status: 'prepared' as const,
        workDir: workspace.workDir,
        topicName: workspace.topicName,
        displayTitle: chosen.displayTitle,
        topicProfile: draft.topicProfile ?? chosen.topicProfile,
    };
    return { ...prepared, frozenAt, optionsDigest: digestItcOptions(prepared) };
}

/** The subset of `chosen-source.json` that finalizes a collected workspace. */
export interface ChosenTopic {
    topicName: string;
    displayTitle: string;
    topicProfile: string;
}

/** The composed workspace for a finalized topic. */
export interface ItcWorkspace {
    workDir: string;
    topicName: string;
    dated: boolean;
}

/**
 * Compose the ITC workspace for a finalized topic.
 *
 * A full `--dir`/`workDir` override wins. Otherwise `<worksRoot>/kk-itc/<topicName>` with
 * `YYYYMMDD` appended when the workspace is dated. A relative explicit dir resolves against the
 * launch cwd; a relative works root was already resolved against the config directory.
 */
export function resolveItcWorkspace(
    options: Pick<ItcEffectiveOptions, 'worksRoot' | 'runDate' | 'dated' | 'launchProjectRoot'>,
    topic: string,
    input: Pick<ItcLaunchInput, 'dir' | 'workDir' | 'runDate'> = {},
): ItcWorkspace {
    const slug = slugifyTopicName(topic);
    if (slug === null) {
        throw new ItcLaunchInvalidError(
            `topic name '${topic}' cannot form a safe workspace path; pass an explicit --dir or a lowercase slug topic`,
        );
    }
    const override = input.dir ?? input.workDir;
    if (override !== undefined && override.trim() !== '') {
        const expanded = override.trim().replace(/^~(?=\/|$)/, '');
        const base = expanded === override.trim() ? override.trim() : expanded;
        return {
            workDir: isAbsolute(base) ? base : resolve(options.launchProjectRoot, base),
            topicName: slug,
            dated: input.runDate !== undefined,
        };
    }
    const leaf = options.runDate !== null ? join(slug, options.runDate) : slug;
    return { workDir: join(options.worksRoot, 'kk-itc', leaf), topicName: slug, dated: options.runDate !== null };
}

/** Write the frozen options snapshot; the caller owns the directory. */
export async function writeItcOptionsSnapshot(
    workDir: string,
    options: ItcEffectiveOptions,
    fs: FileSystem = createNodeFileSystem(),
): Promise<string> {
    const path = join(workDir, 'itc-options.json');
    await fs.ensureDir(workDir);
    await fs.writeFile(path, `${JSON.stringify(options, null, 2)}\n`);
    return path;
}

/**
 * Read a pre-existing snapshot and verify it still matches `options` on every frozen field.
 * A mismatch is a refusal (R5), never a silent re-resolution against changed ambient config.
 */
export async function verifyItcOptionsSnapshot(
    workDir: string,
    options: ItcEffectiveOptions,
    fs: FileSystem = createNodeFileSystem(),
): Promise<{ ok: true } | { ok: false; reason: string }> {
    const path = join(workDir, 'itc-options.json');
    if (!(await fs.exists(path))) return { ok: true };
    let saved: ItcEffectiveOptions;
    try {
        saved = JSON.parse(await fs.readFile(path)) as ItcEffectiveOptions;
    } catch {
        return { ok: false, reason: `existing snapshot is unreadable or invalid JSON: ${path}` };
    }
    const frozenKeys: (keyof ItcEffectiveOptions)[] = [
        'schemaVersion',
        'worksRoot',
        'workDir',
        'topicName',
        'sourceLocale',
        'publishPreset',
        'publishTargets',
        'publishLive',
        'seo',
        'maxRevisions',
        'optionsDigest',
    ];
    for (const key of frozenKeys) {
        if (saved[key] !== options[key]) {
            return {
                ok: false,
                reason: `resume refused: frozen option '${key}' changed (${String(saved[key])} -> ${String(options[key])})`,
            };
        }
    }
    return { ok: true };
}
