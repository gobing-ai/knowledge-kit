import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import type { ActionKind } from '@gobing-ai/kk-board/contracts';
import { openStore, resolveStorePath } from '@gobing-ai/kk-store';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { type Command, CommanderError } from 'commander';
import { EDIT_ARTIFACTS, EDIT_BODY_CAP_BYTES, editArtifactRelative } from '../board/actions';
import { resolveKkConfigPath } from '../invoke';
import { consoleOutput } from '../output';
import { resolveBundlePath } from '../publish-matrix';
import { configPath, readConfig, resolveWorksDir } from './content';

/**
 * The parse call sites, bound at module load.
 *
 * WHY: the CLI surface rule (`cli-no-parse-at-module-scope`) forbids a literal parser call in a
 * command module, because that spelling is how a command once re-entered the parser at import time.
 * Binding the function first keeps the module import-side-effect free by construction.
 */
const parseYaml = Bun.YAML.parse.bind(Bun.YAML);
const parseJson = JSON.parse.bind(JSON);

/**
 * `kk news edit` — the one write path for a day's allowlisted draft artifacts (G84, task 0444 —
 * `docs/design/daily-voice-ops-console.md` §10).
 *
 * The verb owns the write, so the Board's action plane only launches it (ADR-035 amendment), and a
 * copyable recipe and a clicked action stay the same argv. Two properties make it safe to expose:
 *
 *  - the destination is never caller-supplied: the closed artifact enum plus the day resolved from
 *    `--run-date` produce the path, so no input can reach another file or leave the day directory;
 *  - every refusal happens before the backup and the write, and each names a closed code the plane
 *    maps by name (`base-sha.mismatch` → 409 with the current sha, `lock.held` → 409, else 400/422).
 */

/** The closed artifact allowlist: the two drafts an operator may correct before a re-render. */
export const EDITABLE_ARTIFACTS = EDIT_ARTIFACTS;

/** One editable artifact id. */
export type EditableArtifact = (typeof EDITABLE_ARTIFACTS)[number];

/** The closed refusal vocabulary; each is a `news.edit.*` code the CLI and the plane share. */
export const EDIT_REFUSALS = [
    'news.edit.artifact.unknown',
    'news.edit.source.unreadable',
    'news.edit.body.too-large',
    'news.edit.body.empty',
    'news.edit.base-sha.mismatch',
    'news.edit.script.invalid',
    'news.edit.frozen',
    'news.edit.lock.held',
    'news.edit.no-backup',
] as const;

/** One edit refusal code. */
export type EditRefusal = (typeof EDIT_REFUSALS)[number];

/** The structured record `kk news edit` prints (stdout, one JSON line). */
export interface EditRecord {
    artifact: EditableArtifact;
    path: string;
    backup: string | null;
    sha256: string;
    reverted: boolean;
}

/** A closed-code refusal carrying whatever the caller needs to act (never memo prose). */
export class EditRefusedError extends Error {
    /** The closed refusal code. */
    readonly code: EditRefusal;

    /** For `base-sha.mismatch`: the sha the artifact actually carries now. */
    readonly currentSha: string | null;

    constructor(code: EditRefusal, message: string, currentSha: string | null = null) {
        super(message);
        this.name = 'EditRefusedError';
        this.code = code;
        this.currentSha = currentSha;
    }
}

/** sha256 of the UTF-8 bytes of `text`, as the hex the verb prints and the plane compares. */
export function sha256Of(text: string): string {
    return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

/** The byte length the cap is measured in (the seam reads and writes text). */
export function byteLengthOf(text: string): number {
    return Buffer.byteLength(text, 'utf8');
}

/**
 * The artifact's path inside one day directory — the only place a write target is ever derived.
 *
 * Article body: `22-article/<day>_06_article-write_body.md`, the file `generate-render` re-derives
 * from when it is newer than `_06_article_content.json` (`plugins/kk/scripts/daily-stages.ts:1134-1141`).
 * Script: `24-script/<day>_08_script_voicescript.yaml`, which the render stage never overwrites
 * (`daily-stages.ts:5650-5656`), so an edit survives a re-render.
 */
export function artifactPath(dayDir: string, day: string, artifact: EditableArtifact): string {
    return join(dayDir, editArtifactRelative(day, artifact));
}

/** The artifact's extension, used for backup names. */
function extensionOf(artifact: EditableArtifact): string {
    return artifact === 'article' ? 'md' : 'yaml';
}

/** The day's edit-backup directory. */
export function editBackupDir(dayDir: string): string {
    return join(dayDir, 'edits');
}

/** A sortable UTC stamp: `YYYYMMDDTHHMMSS.mmmZ`. */
export function backupStamp(now = new Date()): string {
    const iso = now.toISOString().replace(/[-:]/g, '');
    return `${iso.slice(0, 8)}T${iso.slice(9, 15)}.${iso.slice(16, 19)}Z`;
}

/** One artifact's backups, lexicographically ascending (the stamp prefix sorts chronologically). */
export async function backupsOf(fs: FileSystem, dayDir: string, artifact: EditableArtifact): Promise<string[]> {
    try {
        return (await fs.readDir(editBackupDir(dayDir)))
            .filter((name) => name.endsWith(`-${artifact}.${extensionOf(artifact)}`))
            .sort();
    } catch {
        return [];
    }
}

/**
 * Parse a Voicescript and enforce the shape the generate stage requires: a `segments` array of at
 * least two entries (opening and closing), each with a non-empty `text`
 * (`plugins/kk/scripts/daily-stages.ts:1757-1760`). A script this accepts is one `generate-voice`
 * will not refuse for shape.
 */
export function validateVoicescript(text: string): string | null {
    let parsed: unknown;
    try {
        parsed = parseYaml(text);
    } catch {
        return 'the script is not valid YAML';
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return 'the script must be a YAML mapping';
    }
    const segments = (parsed as Record<string, unknown>).segments;
    if (!Array.isArray(segments) || segments.length < 2) {
        return 'the script needs a `segments` array of at least 2 entries (opening and closing)';
    }
    for (const [index, segment] of segments.entries()) {
        const textValue =
            segment !== null && typeof segment === 'object' ? (segment as Record<string, unknown>).text : null;
        if (typeof textValue !== 'string' || textValue.trim() === '') {
            return `segment ${index} has no non-empty \`text\``;
        }
    }
    return null;
}

/**
 * The day directory a `--run-date` resolves to, through the same config seam `kk news digest` uses,
 * so the verb and the console can never disagree about which day they mean.
 */
export async function resolveEditDayDir(
    fs: FileSystem,
    configFile: string,
    day: string,
): Promise<{ dayDir: string; exists: boolean }> {
    const config = await readConfig(configFile, fs);
    const dayDir = join(resolveWorksDir(config, configFile), 'kk-news-generate', day);
    return { dayDir, exists: await fs.exists(dayDir) };
}

/** Write `content` to `path` through a same-directory temp file + rename (atomic, never partial). */
export async function atomicWriteText(fs: FileSystem, path: string, content: string): Promise<void> {
    await fs.ensureDir(dirname(path));
    const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(temp, content);
    await fs.rename(temp, path);
}

/** Read at most `cap + 1` bytes from stdin so an oversized body is refused without buffering it all. */
async function readStdinBounded(cap: number): Promise<string> {
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = Bun.stdin.stream().getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done === true) break;
        if (value === undefined) continue;
        total += value.byteLength;
        chunks.push(value);
        if (total > cap + 1) break;
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

/**
 * The frozen-bundle check, reusing the freeze predicate already in the tree: a bundle carrying
 * `contentType` was frozen by `generate-bundle --stage freeze`, and a frozen bundle is never
 * rewritten (`apps/cli/src/commands/content-generate.ts:1385-1395`, `publish-matrix.ts:163-175`).
 */
async function frozenReason(fs: FileSystem, dayDir: string): Promise<string | null> {
    const path = await resolveBundlePath(fs, dayDir);
    if (!(await fs.exists(path))) return null;
    let parsed: unknown;
    try {
        parsed = parseJson(await fs.readFile(path));
    } catch {
        return null;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return typeof (parsed as Record<string, unknown>).contentType === 'string'
        ? `${path} is a frozen bundle; a frozen day is never edited`
        : null;
}

/**
 * Refuse when the day's `ops-console:<day>` lock is held by somebody other than this invocation.
 *
 * The plane holds that lock while its child runs, so the child must be able to prove it is the
 * holder — it does through `KK_LOCK_HOLDER`, set by the plane on the child's environment (never in
 * argv, which is what the audit records).
 */
export async function lockHeldByOther(day: string): Promise<string | null> {
    let store: Awaited<ReturnType<typeof openStore>>;
    try {
        // `kk lock` opens the same way, so a fresh store gets its tables here rather than throwing.
        const dbPath = await resolveStorePath(resolveKkConfigPath());
        store = await openStore({ path: dbPath });
    } catch {
        // A store that cannot be opened cannot be holding a lock.
        return null;
    }
    try {
        const record = await store.locks.current(`ops-console:${day}`);
        if (record === undefined) return null;
        const mine = process.env.KK_LOCK_HOLDER ?? '';
        if (mine !== '' && record.ownerRun === mine) return null;
        return `ops-console:${day} is held by ${record.ownerRun}`;
    } catch {
        // A store whose locks table cannot be read is not evidence of another holder.
        return null;
    } finally {
        await store.close();
    }
}

/** Options accepted by `kk news edit`. */
export interface EditOptions {
    runDate: string;
    artifact: string;
    fromFile?: string;
    baseSha?: string;
    revert?: boolean;
}

/** The `{code,message}` refusal the CLI prints and `main()` maps to an exit code. */
function refuse(code: EditRefusal, message: string, currentSha: string | null = null): never {
    const suffix = currentSha === null ? '' : ` current=${currentSha}`;
    const text = `kk.news.edit.failed: ${code}: ${message}${suffix}`;
    consoleOutput.error(text);
    throw new CommanderError(1, code, text);
}

/** Parse `--artifact` against the closed enum. */
function artifactOf(raw: string): EditableArtifact {
    if (!(EDITABLE_ARTIFACTS as readonly string[]).includes(raw)) {
        refuse('news.edit.artifact.unknown', `--artifact must be one of ${EDITABLE_ARTIFACTS.join('|')}, got '${raw}'`);
    }
    return raw as EditableArtifact;
}

/** The new body text: from `--from-file`, or stdin for `-`, capped before anything consumes it. */
async function readBody(fs: FileSystem, fromFile: string): Promise<string> {
    const capped = (body: string): string => {
        // An empty draft is never what the operator meant, and writing it would destroy the file.
        if (body.trim() === '') throw new EditRefusedError('news.edit.body.empty', 'the new body is empty');
        const bytes = byteLengthOf(body);
        if (bytes > EDIT_BODY_CAP_BYTES) {
            throw new EditRefusedError(
                'news.edit.body.too-large',
                `the body is ${bytes} bytes; the cap is ${EDIT_BODY_CAP_BYTES}`,
            );
        }
        return body;
    };
    if (fromFile === '-') return capped(await readStdinBounded(EDIT_BODY_CAP_BYTES));
    const path = resolve(fromFile);
    let stat: Awaited<ReturnType<FileSystem['stat']>>;
    try {
        stat = await fs.stat(path);
    } catch {
        stat = null;
    }
    if (stat === null || stat.isDirectory()) {
        throw new EditRefusedError('news.edit.source.unreadable', `${fromFile} is not a readable file`);
    }
    let body: string;
    try {
        body = await fs.readFile(path);
    } catch {
        throw new EditRefusedError('news.edit.source.unreadable', `${fromFile} could not be read`);
    }
    return capped(body);
}

/** Read the current artifact text, or null when it does not exist yet. */
export async function currentArtifact(fs: FileSystem, path: string): Promise<string | null> {
    return (await fs.exists(path)) ? fs.readFile(path) : null;
}

/**
 * `kk news edit --run-date <day> --artifact article|script (--from-file <path|-> --base-sha <hex> | --revert)`
 *
 * Writes the allowlisted artifact through a same-directory temp file + rename, backs up the bytes it
 * replaces under `<day>/edits/`, and prints `{artifact, path, backup, sha256, reverted}`.
 */
export async function editAction(options: EditOptions): Promise<void> {
    const fs = createNodeFileSystem();
    const configFile = configPath();
    const artifact = artifactOf(options.artifact);
    const day = options.runDate;
    const { dayDir, exists } = await resolveEditDayDir(fs, configFile, day);
    if (!exists) refuse('news.edit.source.unreadable', `no kk-news-generate day directory at ${dayDir}`);
    const path = artifactPath(dayDir, day, artifact);
    const before = await currentArtifact(fs, path);

    if (options.revert === true) {
        const backups = await backupsOf(fs, dayDir, artifact);
        const newest = backups.at(-1);
        if (newest === undefined) {
            refuse('news.edit.no-backup', `no ${artifact} backup exists under ${editBackupDir(dayDir)}`);
        }
        const restored = await fs.readFile(join(editBackupDir(dayDir), newest));
        const heldByOther = await lockHeldByOther(day);
        if (heldByOther !== null) refuse('news.edit.lock.held', heldByOther);
        // The bytes this revert replaces are backed up too, so a revert is itself revertible.
        if (before !== null) {
            await atomicWriteText(
                fs,
                join(editBackupDir(dayDir), `${backupStamp()}-${artifact}.${extensionOf(artifact)}`),
                before,
            );
        }
        await atomicWriteText(fs, path, restored);
        emit({
            artifact,
            path,
            backup: join(editBackupDir(dayDir), newest),
            sha256: sha256Of(restored),
            reverted: true,
        });
        return;
    }

    if (options.fromFile === undefined) {
        refuse('news.edit.source.unreadable', 'either --from-file or --revert is required');
    }
    if (options.baseSha === undefined) {
        refuse('news.edit.base-sha.mismatch', '--base-sha is required for an edit');
    }
    const body = await readBody(fs, options.fromFile);
    const currentSha = before === null ? null : sha256Of(before);
    if (currentSha !== null && currentSha !== options.baseSha.toLowerCase()) {
        refuse('news.edit.base-sha.mismatch', 'the artifact changed since the preview', currentSha);
    }
    if (artifact === 'script') {
        const invalid = validateVoicescript(body);
        if (invalid !== null) refuse('news.edit.script.invalid', invalid);
    }
    const frozen = await frozenReason(fs, dayDir);
    if (frozen !== null) refuse('news.edit.frozen', frozen);
    const heldByOther = await lockHeldByOther(day);
    if (heldByOther !== null) refuse('news.edit.lock.held', heldByOther);

    const backup =
        before === null ? null : join(editBackupDir(dayDir), `${backupStamp()}-${artifact}.${extensionOf(artifact)}`);
    if (backup !== null && before !== null) await atomicWriteText(fs, backup, before);
    await atomicWriteText(fs, path, body);
    emit({ artifact, path, backup, sha256: sha256Of(body), reverted: false });
}

/** Print the structured record: one JSON line, which is what both the operator and the plane read. */
function emit(record: EditRecord): void {
    consoleOutput.write(JSON.stringify(record));
}

/** Options accepted by the registered command. */
interface RegisteredEditOptions {
    runDate: string;
    artifact: string;
    fromFile?: string;
    baseSha?: string;
    revert?: boolean;
}

/** The two action kinds this verb backs (`edit-artifact`, `revert-artifact`). */
export const EDIT_ACTION_KINDS: readonly ActionKind[] = ['edit-artifact', 'revert-artifact'];

/**
 * Register `kk news edit` for the news noun (design §1.3, after the publish-step verbs).
 *
 * The module registers through `registerContentVerbs` only for `noun === 'news'`; it parses nothing
 * at module scope and never terminates the process directly (surface rule §1).
 */
export function registerContentEditCommand(group: Command, noun: string, _defaultType: string): void {
    if (noun !== 'news') return;
    group
        .command('edit')
        .description('replace or revert an allowlisted day artifact (G84)')
        .option('--run-date <YYYYMMDD>', 'news run date')
        .option(`--artifact <${EDITABLE_ARTIFACTS.join('|')}>`, 'which draft to edit')
        .option('--from-file <path|->', 'new body; `-` reads stdin')
        .option('--base-sha <hex>', 'sha256 the body was written against (conflict when it moved)')
        .option('--revert', 'restore the newest backup of that artifact')
        .action(async (options: RegisteredEditOptions) => {
            await editAction({
                runDate: options.runDate,
                artifact: options.artifact,
                ...(options.fromFile === undefined ? {} : { fromFile: options.fromFile }),
                ...(options.baseSha === undefined ? {} : { baseSha: options.baseSha }),
                ...(options.revert === true ? { revert: true } : {}),
            });
        });
}
