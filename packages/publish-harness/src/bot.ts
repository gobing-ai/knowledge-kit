import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { lstat, realpath } from './bot-fs';
import { DEFAULT_BOT_TRANSACTION_ROOT, findLeftoverTransaction } from './bot-transaction';
import { acquireProfileLease } from './profile-lease';

/**
 * Browser-free half of the `kk bot` lifecycle (task 0276): the fixed profile root, the
 * name/URL/metadata validators and the error contract. No browser, no Playwright import,
 * so `bot list`/`--help` work without installed browser binaries (design §Bot command
 * contract). Transaction copy/promotion and the CLI live in later slices.
 */

/** `bot.json` schema version written by this implementation. */
export const BOT_SCHEMA_VERSION = 1;
/** Metadata file name inside a bot profile directory. */
export const BOT_METADATA_FILE = 'bot.json';
/** Fixed default profile root; ambient `KK_BROWSER_PROFILE_DIR` never redirects bot commands. */
export const DEFAULT_BOT_PROFILE_ROOT = join(homedir(), '.config', 'kk', 'browser-profiles');

/** Names are path-segment-safe: one optional `-`/`_` interior alphabet, 1–64 chars. */
const SAFE_BOT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Historical authentication evidence; never a claim about current session readiness. */
export type AuthenticationEvidence = 'operator-confirmed' | 'site-verified';

/** Minimal `bot.json`. */
export interface BotMetadata {
    schemaVersion: typeof BOT_SCHEMA_VERSION;
    /** Origin+pathname of the page to reopen; query/fragment are never persisted. */
    defaultUrl: string;
    /** Adapter that saved this bot; absent for generic operator-confirmed sessions. */
    pluginName?: string;
    authenticationEvidence: AuthenticationEvidence;
}

/** Failure classification the CLI maps to exit codes (usage→2, the rest→1). */
export type BotErrorCode = 'usage' | 'not-found' | 'busy' | 'unconfirmed' | 'persistence' | 'browser';

/** Typed bot failure. Messages must never carry state values, tokens or grant-bearing URLs. */
export class BotError extends Error {
    public readonly code: BotErrorCode;

    constructor(code: BotErrorCode, message: string) {
        super(message);
        this.name = 'BotError';
        this.code = code;
    }
}

/** `true` when `name` matches `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`. */
export function isSafeBotName(name: string): boolean {
    return SAFE_BOT_NAME.test(name);
}

/** Returns `name` or throws {@link BotError} `usage` — a bad name is a usage failure. */
export function assertSafeBotName(name: string): string {
    if (!isSafeBotName(name)) {
        throw new BotError('usage', 'bot name must match [A-Za-z0-9][A-Za-z0-9_-]{0,63}');
    }
    return name;
}

/**
 * Accepts an absolute http(s) URL and returns origin+pathname only. Query and fragment are
 * dropped (they can carry OAuth grants/tokens) and userinfo is refused. The raw input is
 * never echoed back, so a grant-bearing URL cannot leak through an error message.
 */
export function normalizeBotDefaultUrl(input: string): string {
    let url: URL;
    try {
        url = new URL(input.trim());
    } catch {
        throw new BotError('usage', 'invalid URL: expected an absolute http(s) URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new BotError('usage', `unsupported URL scheme '${url.protocol}' — http(s) only`);
    }
    if (url.username !== '' || url.password !== '') {
        throw new BotError('usage', 'URL must not embed credentials');
    }
    return `${url.origin}${url.pathname}`;
}

/**
 * `true` when `value` is an http(s) URL the metadata contract may store: origin+pathname always;
 * a query is allowed only for adapter-owned metadata, where it is a plugin-fixed non-secret
 * navigation parameter (Juejin's canonical `?v=2`), never operator input. Fragments/userinfo never.
 */
function isStoredDefaultUrl(value: string, allowQuery: boolean): boolean {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username !== '' || url.password !== '') return false;
    if (url.hash !== '') return false;
    if (!allowQuery && url.search !== '') return false;
    const stored = `${url.origin}${url.pathname}${allowQuery ? url.search : ''}`;
    return stored === value;
}

/**
 * Validate a parsed JSON value against {@link BotMetadata} — manual checks, no new validation
 * dependency. Corrupt/unknown metadata is a `persistence` failure naming only the source.
 */
export function parseBotMetadata(raw: unknown, source = 'bot metadata'): BotMetadata {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new BotError('persistence', `${source}: expected a JSON object`);
    }
    const record = raw as Record<string, unknown>;
    if (record.schemaVersion !== BOT_SCHEMA_VERSION) {
        throw new BotError(
            'persistence',
            `${source}: unsupported schemaVersion ${JSON.stringify(record.schemaVersion)}`,
        );
    }
    const evidence = record.authenticationEvidence;
    if (evidence !== 'operator-confirmed' && evidence !== 'site-verified') {
        throw new BotError('persistence', `${source}: authenticationEvidence must be operator-confirmed|site-verified`);
    }
    let pluginName: string | undefined;
    if (record.pluginName !== undefined) {
        if (typeof record.pluginName !== 'string' || record.pluginName.length === 0) {
            throw new BotError('persistence', `${source}: pluginName must be a non-empty string`);
        }
        pluginName = record.pluginName;
    }
    // Adapter-owned metadata may carry the plugin's fixed navigation query; generic stays strict.
    const allowQuery = pluginName !== undefined;
    if (typeof record.defaultUrl !== 'string' || !isStoredDefaultUrl(record.defaultUrl, allowQuery)) {
        throw new BotError(
            'persistence',
            `${source}: defaultUrl must be an http(s) origin+pathname` +
                (allowQuery ? ' with at most a plugin-fixed query' : ''),
        );
    }
    const metadata: BotMetadata = {
        schemaVersion: BOT_SCHEMA_VERSION,
        defaultUrl: record.defaultUrl,
        authenticationEvidence: evidence,
    };
    if (pluginName !== undefined) {
        metadata.pluginName = pluginName;
    }
    return metadata;
}

/**
 * Read and validate `bot.json` through the FileSystem seam. `null` when absent — a legacy
 * profile without metadata is listed, not an error. Corrupt metadata fails actionable and
 * the profile is left untouched.
 */
export async function readBotMetadata(fileSystem: FileSystem, metadataPath: string): Promise<BotMetadata | null> {
    if (!(await fileSystem.exists(metadataPath))) return null;
    let text: string;
    try {
        text = await fileSystem.readFile(metadataPath);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new BotError('persistence', `${metadataPath}: cannot read bot metadata: ${detail}`);
    }
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        throw new BotError('persistence', `${metadataPath}: corrupt bot metadata (not valid JSON)`);
    }
    return parseBotMetadata(raw, metadataPath);
}

/** Options for {@link resolveBotProfileDir}. */
export interface ResolveBotProfileOptions {
    /** Profile root; defaults to {@link DEFAULT_BOT_PROFILE_ROOT}. Injected in tests. */
    root?: string;
}

/**
 * Resolve `name` to a contained profile directory under the fixed root, refusing a
 * non-directory/symlinked entry and any resolved escape (containment before effects). An
 * absent root is not an error — list/open surface their own "no profile" guidance.
 */
export function resolveBotProfileDir(name: string, options: ResolveBotProfileOptions = {}): string {
    assertSafeBotName(name);
    const root = resolve(options.root ?? DEFAULT_BOT_PROFILE_ROOT);
    const profileDir = join(root, name);
    assertContained(root, profileDir);
    const rootStat = lstat(root);
    if (rootStat?.isSymbolicLink()) {
        throw new BotError('usage', `refusing symlinked bot profile root: ${root}`);
    }
    const entry = lstat(profileDir);
    if (entry?.isSymbolicLink()) {
        throw new BotError('usage', `refusing symlinked bot profile: ${profileDir}`);
    }
    if (entry !== null && !entry.isDirectory()) {
        throw new BotError('usage', `bot profile path is not a directory: ${profileDir}`);
    }
    if (entry?.isDirectory()) {
        const realRoot = realpath(root);
        const realEntry = realpath(profileDir);
        if (realEntry !== join(realRoot, name)) {
            throw new BotError('usage', `bot profile escapes its root: ${realEntry}`);
        }
    }
    return profileDir;
}

/** Structural containment: `candidate` must be exactly one segment below `root`. */
function assertContained(root: string, candidate: string): void {
    const rel = relative(root, candidate);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.includes(sep)) {
        throw new BotError('usage', 'bot profile escapes its root');
    }
}

/** One `kk bot list` row: a local cached profile, never a claim of a live/current login. */
export interface BotInventoryEntry {
    /** Directory name under the fixed root. */
    name: string;
    /** Always `cached` — a profile is a local artifact, not proof of a current session. */
    state: 'cached';
    /** Saved origin+pathname, or `null` when absent (legacy) or unreadable (corrupt) metadata. */
    defaultUrl: string | null;
    /** Validated metadata, or `null` for a legacy profile with no `bot.json`. */
    metadata: BotMetadata | null;
    /** Set when `bot.json` existed but was invalid; the profile is still listed, never mutated. */
    metadataError?: string;
}

/** Options for {@link listBots}. */
export interface ListBotsOptions {
    /** Profile root; default {@link DEFAULT_BOT_PROFILE_ROOT}. Injected in tests. */
    root?: string;
    /** Injected FileSystem for directory listing and metadata reads. */
    fileSystem?: FileSystem;
}

/**
 * Enumerate the fixed root's direct non-symlink directories as cached bots. No browser is
 * launched, no cookie database is read, and no row claims a current login: legacy profiles
 * without metadata list with an unknown (`null`) default URL, and corrupt metadata is surfaced
 * per-entry (`metadataError`) rather than aborting the whole listing. An absent root is an
 * empty inventory. Reads go through the FileSystem seam, but the fixed root wins — ambient
 * environment variables never redirect the listing.
 */
export async function listBots(options: ListBotsOptions = {}): Promise<BotInventoryEntry[]> {
    const fileSystem = options.fileSystem ?? createNodeFileSystem();
    const root = resolve(options.root ?? DEFAULT_BOT_PROFILE_ROOT);
    const rootStat = lstat(root);
    if (rootStat?.isSymbolicLink()) {
        throw new BotError('usage', `refusing symlinked bot profile root: ${root}`);
    }
    if (rootStat === null) return [];
    if (!rootStat.isDirectory()) {
        throw new BotError('usage', `bot profile root is not a directory: ${root}`);
    }
    let names: string[];
    try {
        names = await fileSystem.readDir(root);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw new BotError('persistence', `cannot list bot profiles in ${root}: ${describeError(error)}`);
    }
    const entries: BotInventoryEntry[] = [];
    for (const name of names.sort()) {
        const profileDir = join(root, name);
        const entry = lstat(profileDir);
        if (entry === null || entry.isSymbolicLink() || !entry.isDirectory()) continue;
        let metadata: BotMetadata | null = null;
        let metadataError: string | undefined;
        try {
            metadata = await readBotMetadata(fileSystem, join(profileDir, BOT_METADATA_FILE));
        } catch (error) {
            metadataError = describeError(error);
        }
        entries.push({
            name,
            state: 'cached',
            defaultUrl: metadata?.defaultUrl ?? null,
            metadata,
            ...(metadataError === undefined ? {} : { metadataError }),
        });
    }
    return entries;
}

/** Outcome of a local `kk bot logout`; describes LOCAL credential removal only. */
export interface LogoutBotResult {
    name: string;
    /** `false` when the profile was already absent (idempotent success). */
    removed: boolean;
    /** Operator line: local removal only, with no server-side revocation claim. */
    message: string;
}

/** Options for {@link logoutBot}. */
export interface LogoutBotOptions {
    /** Profile root; default {@link DEFAULT_BOT_PROFILE_ROOT}. Injected in tests/probes. */
    root?: string;
    /** Lease root; default {@link import('./profile-lease').DEFAULT_BOT_LEASE_ROOT}. */
    leaseRoot?: string;
    /** Transaction root; default {@link DEFAULT_BOT_TRANSACTION_ROOT}. Injected in tests/probes. */
    transactionRoot?: string;
    /** Injected FileSystem for deletion. */
    fileSystem?: FileSystem;
}

/**
 * Remove the selected, inactive, contained bot's local artifacts (metadata + browser profile +
 * auxiliary authentication state, all inside the profile directory). The name is validated and
 * the directory resolver refuses traversal, symlink escapes and out-of-root targets before any
 * effect; the fixed root wins, so ambient `KK_BROWSER_PROFILE_DIR` never redirects a deletion.
 * Holding the profile lease (active ownership) or a native Chromium lock refuses with `busy`.
 * An absent bot is an idempotent success that creates nothing.
 */
export async function logoutBot(name: string, options: LogoutBotOptions = {}): Promise<LogoutBotResult> {
    const fileSystem = options.fileSystem ?? createNodeFileSystem();
    const profileDir = resolveBotProfileDir(name, { root: options.root });
    if (lstat(profileDir) === null) {
        // A leftover transaction `backup/` may still hold this bot's previous credentials; reporting
        // an honest idempotent absence requires that state to be resolved first (transaction
        // contract: inspect and remove manually, delete nothing here).
        const leftover = await findLeftoverTransaction(
            fileSystem,
            name,
            options.transactionRoot ?? DEFAULT_BOT_TRANSACTION_ROOT,
        );
        if (leftover !== null) {
            throw new BotError(
                'persistence',
                `bot '${name}' has no profile at ${profileDir}, but an incomplete transaction still holds its previous state at ${leftover} — inspect that directory and remove it manually before logging out; nothing was deleted`,
            );
        }
        return { name, removed: false, message: `bot '${name}' has no local profile — nothing to remove` };
    }
    const lease = await acquireProfileLease(profileDir, { leaseRoot: options.leaseRoot, fileSystem });
    let deletionError: unknown;
    try {
        await fileSystem.deleteFile(profileDir);
    } catch (error) {
        deletionError = error;
    }
    await lease.release();
    if (deletionError !== undefined) {
        throw new BotError('persistence', `failed to remove bot profile '${name}': ${describeError(deletionError)}`);
    }
    return {
        name,
        removed: true,
        message: `removed local credentials for bot '${name}' — no server-side session was revoked`,
    };
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
