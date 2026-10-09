import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { DEFAULT_STORY_THRESHOLD, DEFAULT_STORY_WINDOW_HOURS, type StoryPolicy } from './story';

/** Store path when `store.db_path` is unset: cwd-relative, next to today's `.works/` run dirs. */
export const DEFAULT_STORE_DB_PATH = '.works/kk.db';

/**
 * Default `store.labels.priority`: every maker is eligible, and the keyword heuristic leads, so a
 * model row outranks the heuristic one it was compared against (R4). `'*'` matches any maker.
 */
export const DEFAULT_LABEL_PRIORITY: readonly string[] = ['*', 'heuristic'];

/**
 * Default `store.labels.min_confidence` — ADR-125's advisory threshold, in lockstep with the
 * decision catalog's own `minConfidence`. A `source 'model'` row below it is not a current label
 * (R4/R5); it never changes the enum level the row carries.
 */
export const DEFAULT_MIN_CONFIDENCE = 0.8;

/** The `kk-item-china-politics` decision id (task 0229 R1): the keyword prefilter stamps it. */
export const CHINA_POLITICS_DECISION_ID = 'kk-item-china-politics';

/**
 * Default `store.labels.china_politics_terms` (task 0229 R4): top-leader and central-institution
 * terms ONLY. A generic term (`中国`, `China`, `Beijing`) would exclude China-related content and
 * violate the decision's own scope; the prefilter only ever ADDS exclusions, so a false positive
 * here costs a legitimate item its eligibility.
 */
export const DEFAULT_CHINA_POLITICS_TERMS: readonly string[] = [
    '习近平',
    '总书记',
    '中共中央',
    '政治局',
    '中南海',
    '党中央',
    'Xi Jinping',
    'Politburo',
    'Zhongnanhai',
];

/**
 * Default `store.labels.decisions.kk-item-china-politics.priority` (task 0229 R4): a `keyword`
 * hit outranks every maker answer, so a hit is a hard floor while a non-hit (no `keyword` row)
 * falls through to the model.
 */
export const DEFAULT_CHINA_POLITICS_DECISION_PRIORITY: readonly string[] = ['keyword', '*', 'heuristic'];

/** The `store.labels` block: which maker's answer is current, and the model-answer threshold. */
export interface StoreLabelConfig {
    /** Maker names, best first; `'*'` matches any maker at its own position. */
    priority: string[];
    /** Decision id → priority that replaces `priority` for that decision id. */
    decisionPriority: Record<string, string[]>;
    /** A `source 'model'` row below this raw confidence is not current. */
    minConfidence: number;
    /**
     * `store.labels.china_politics_terms` (task 0229 R4): the case-insensitive substrings the
     * `kk-item-china-politics` prefilter matches the title and body head against.
     */
    chinaPoliticsTerms: string[];
}

/** The typed `store.*` view of the kk operator config (`readStoreConfig`). */
export interface StoreConfig {
    /** `store.db_path`, when it is a usable string. */
    dbPath?: string;
    labels: StoreLabelConfig;
    /** `store.story.*` — the title-similarity threshold and the candidate window (0227 R3). */
    story: StoryPolicy;
}

/**
 * A `store.*` key is present but unusable: wrong type, or a value outside its domain. Thrown rather
 * than defaulted — a silently defaulted priority or threshold changes which labels are current, and
 * therefore which items a topic pool contains (R3).
 */
export class StoreConfigInvalidError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'StoreConfigInvalidError';
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Expand a leading `~` to the user home dir (`~user` is not expanded — no operator writes it). */
function expandHome(target: string): string {
    if (target === '~') return homedir();
    if (target.startsWith('~/')) return join(homedir(), target.slice(2));
    return target;
}

/** The zero-config label block: the defaults above, freshly allocated (callers may mutate). */
function defaultLabelConfig(): StoreLabelConfig {
    return {
        priority: [...DEFAULT_LABEL_PRIORITY],
        decisionPriority: { [CHINA_POLITICS_DECISION_ID]: [...DEFAULT_CHINA_POLITICS_DECISION_PRIORITY] },
        minConfidence: DEFAULT_MIN_CONFIDENCE,
        chinaPoliticsTerms: [...DEFAULT_CHINA_POLITICS_TERMS],
    };
}

/** The zero-config story block: the defaults above, freshly allocated. */
function defaultStoryConfig(): StoryPolicy {
    return { threshold: DEFAULT_STORY_THRESHOLD, windowHours: DEFAULT_STORY_WINDOW_HOURS };
}

/** The zero-config `store.*` view: no db path override, default labels and story policy. */
function defaultStoreConfig(): StoreConfig {
    return { labels: defaultLabelConfig(), story: defaultStoryConfig() };
}

/** One present string-list key: a non-empty array of non-blank strings, or the failure naming it. */
function readStringList(raw: unknown, key: string, what: string): string[] {
    if (
        !Array.isArray(raw) ||
        raw.length === 0 ||
        raw.some((entry) => typeof entry !== 'string' || entry.trim() === '')
    ) {
        throw new StoreConfigInvalidError(`${key}: expected a non-empty array of ${what}`);
    }
    return raw as string[];
}

/** One present priority key: a non-empty array of maker names, or the failure naming it. */
function readPriority(raw: unknown, key: string): string[] {
    return readStringList(raw, key, 'maker names');
}

/** `store.labels.min_confidence`: a finite number in [0, 1], or the failure naming it. */
function readMinConfidence(raw: unknown): number {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 1) {
        throw new StoreConfigInvalidError(
            `store.labels.min_confidence: expected a number in [0, 1], got ${JSON.stringify(raw)}`,
        );
    }
    return raw;
}

/** The `store.labels` block; an absent sub-key takes its default, a present bad one throws. */
function readLabelConfig(raw: unknown): StoreLabelConfig {
    if (!isPlainObject(raw)) {
        throw new StoreConfigInvalidError('store.labels: expected a mapping');
    }
    const priority =
        raw.priority === undefined ? [...DEFAULT_LABEL_PRIORITY] : readPriority(raw.priority, 'store.labels.priority');
    const minConfidence =
        raw.min_confidence === undefined ? DEFAULT_MIN_CONFIDENCE : readMinConfidence(raw.min_confidence);
    const chinaPoliticsTerms =
        raw.china_politics_terms === undefined
            ? [...DEFAULT_CHINA_POLITICS_TERMS]
            : readStringList(raw.china_politics_terms, 'store.labels.china_politics_terms', 'terms');
    const decisionPriority: Record<string, string[]> = {};
    if (raw.decisions !== undefined) {
        if (!isPlainObject(raw.decisions)) {
            throw new StoreConfigInvalidError(
                'store.labels.decisions: expected a mapping of decision id to a priority',
            );
        }
        for (const [decisionId, spec] of Object.entries(raw.decisions)) {
            const key = `store.labels.decisions.${decisionId}.priority`;
            decisionPriority[decisionId] = readPriority(isPlainObject(spec) ? spec.priority : undefined, key);
        }
    }
    // 0229 R4: the china-politics floor only holds when `keyword` outranks a maker answer, so its
    // priority defaults here when the operator sets none. An explicit per-decision override wins.
    if (decisionPriority[CHINA_POLITICS_DECISION_ID] === undefined) {
        decisionPriority[CHINA_POLITICS_DECISION_ID] = [...DEFAULT_CHINA_POLITICS_DECISION_PRIORITY];
    }
    return { priority, decisionPriority, minConfidence, chinaPoliticsTerms };
}

/** `store.story.threshold`: a finite number in `(0, 1]`, or the failure naming it. */
function readStoryThreshold(raw: unknown): number {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0 || raw > 1) {
        throw new StoreConfigInvalidError(
            `store.story.threshold: expected a number in (0, 1], got ${JSON.stringify(raw)}`,
        );
    }
    return raw;
}

/** `store.story.window_hours`: a positive integer, or the failure naming it. */
function readStoryWindowHours(raw: unknown): number {
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) {
        throw new StoreConfigInvalidError(
            `store.story.window_hours: expected a positive integer, got ${JSON.stringify(raw)}`,
        );
    }
    return raw;
}

/** The `store.story` block; an absent sub-key takes its default, a present bad one throws. */
function readStoryConfig(raw: unknown): StoryPolicy {
    if (!isPlainObject(raw)) {
        throw new StoreConfigInvalidError('store.story: expected a mapping');
    }
    return {
        threshold: raw.threshold === undefined ? DEFAULT_STORY_THRESHOLD : readStoryThreshold(raw.threshold),
        windowHours:
            raw.window_hours === undefined ? DEFAULT_STORY_WINDOW_HOURS : readStoryWindowHours(raw.window_hours),
    };
}

/** The parsed `store.*` view of one config document. */
function parseStoreConfig(parsed: unknown): StoreConfig {
    if (!isPlainObject(parsed) || !isPlainObject(parsed.store)) return defaultStoreConfig();
    const store = parsed.store;
    const dbPath =
        typeof store.db_path === 'string' && store.db_path.trim() !== '' ? (store.db_path as string) : undefined;
    return {
        ...(dbPath === undefined ? {} : { dbPath }),
        labels: store.labels === undefined ? defaultLabelConfig() : readLabelConfig(store.labels),
        story: store.story === undefined ? defaultStoryConfig() : readStoryConfig(store.story),
    };
}

/**
 * Read the config document once: a missing, unreadable or unparseable file is the zero-config case
 * (the store must open on a zero-config machine), never an error.
 */
async function loadStoreConfig(fileSystem: FileSystem, configFile: string | undefined): Promise<StoreConfig> {
    if (configFile === undefined || !(await fileSystem.exists(configFile))) return defaultStoreConfig();
    let raw: string;
    try {
        raw = await fileSystem.readFile(configFile);
    } catch {
        return defaultStoreConfig();
    }
    let parsed: unknown;
    try {
        parsed = Bun.YAML.parse(raw);
    } catch {
        return defaultStoreConfig();
    }
    return parseStoreConfig(parsed);
}

/**
 * Read the typed `store.*` config for `configFile` (`KK_CONFIG` / `~/.config/kk/config.yaml` via
 * `resolveKkConfigPath()` in apps/cli). This is the ONE kk config reader: `readStoreDbPath` below,
 * and 0227's story keys and 0229's profile gate, all extend it rather than adding a second reader.
 *
 * A missing, unreadable or unparseable file yields the defaults. A key that is PRESENT but of the
 * wrong type or outside its domain throws {@link StoreConfigInvalidError} naming it — a silently
 * defaulted priority or threshold would change which labels are current.
 */
export async function readStoreConfig(configFile?: string): Promise<StoreConfig> {
    return loadStoreConfig(createNodeFileSystem(), configFile);
}

/** `store.db_path` from the kk config — a thin read over {@link readStoreConfig}. */
async function readStoreDbPath(fileSystem: FileSystem, configFile: string | undefined): Promise<string | undefined> {
    return (await loadStoreConfig(fileSystem, configFile)).dbPath;
}

/**
 * Resolve the store database path: an explicit path wins, then `store.db_path`
 * from the kk config, then {@link DEFAULT_STORE_DB_PATH}. A leading `~` expands,
 * a relative path resolves against the process cwd, and the parent directory is
 * created.
 *
 * Async because file IO goes through ts-runtime's `FileSystem` seam (the repo's
 * `no-direct-fs-io` rule forbids `node:fs` in product source). kk-store cannot
 * import `apps/cli` (apps/cli depends on kk-store), so this takes the config path
 * as an argument and `kk` passes `resolveKkConfigPath()`.
 */
export async function resolveStorePath(configFile?: string, explicitPath?: string): Promise<string> {
    const fileSystem = createNodeFileSystem();
    const configured = explicitPath ?? (await readStoreDbPath(fileSystem, configFile));
    const expanded = expandHome(configured ?? DEFAULT_STORE_DB_PATH);
    const absolute = isAbsolute(expanded) ? expanded : resolve(expanded);
    await fileSystem.ensureDir(dirname(absolute));
    return absolute;
}
