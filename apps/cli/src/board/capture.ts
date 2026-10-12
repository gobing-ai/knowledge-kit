import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type {
    BoardDiagnostic,
    RunCapture,
    RunCaptureInput,
    RunTopology,
    WorkflowName,
} from '@gobing-ai/kk-board/contracts';
import { createNodeFileSystem, type FileSystem, NodeSyncProcessExecutor } from '@gobing-ai/ts-runtime';
import { resolveKkConfigPath } from '../invoke';
import { WORKFLOW_NAMES, WORKFLOW_SETTINGS } from './manifest';

/**
 * The run-capture seam (`captureRun`), invoked by workflow preparation inside the successful
 * lock-holder path (docs/design/workflow-board-modules.md §9).
 *
 * It binds a run id to its canonical workspace and a sanitized settings snapshot, writes the
 * immutable record `.works/.board/runs/<id>.json` and the atomic workspace ownership marker
 * `.kk-board-owner.json`. Revoking a previous owner is mandatory (a failure throws, refusing
 * the following result writes); the optional capture itself only warns.
 */

/** The atomic workspace ownership marker file name. */
export const MARKER_FILE = '.kk-board-owner.json';

/** The project-local directory holding one immutable record per captured run. */
export const BOARD_RUNS_REL = '.works/.board/runs';

/** The project-local works-root directory name a run workspace must descend from (§9). */
export const WORKS_REL = '.works';

/**
 * Directory names that mark a works root. `.works` is the project-local layout collect uses;
 * `works` is the configured external layout the daily pipeline uses
 * (`~/.config/kk/works`, `apps/cli/src/commands/daily.ts`). A run workspace is always a CHILD of one
 * of these, never the works root itself.
 */
const WORKS_ROOT_NAMES = new Set([WORKS_REL, 'works']);

/** Run ids are single safe path segments. */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Stamps accept only alphanumerics, dash, underscore and the UTC `T`/`Z` markers. */
const STAMP = /^[A-Za-z0-9_-]+$/;

/** The only accepted definition-digest spelling. */
const DEFINITION_DIGEST = /^sha256:[0-9a-f]{64}$/;

/** A settings value that must not be captured: no newlines, no control bytes, bounded length. */
const SETTING_VALUE = /^[\x20-\x7e]{0,200}$/;

/** The absolute directory holding one immutable capture record per run. */
export function boardRunsDir(projectPath: string): string {
    return join(projectPath, BOARD_RUNS_REL);
}

/** The absolute record path for one run. */
export function captureRecordPath(projectPath: string, runId: string): string {
    return join(boardRunsDir(projectPath), `${runId}.json`);
}

/** The absolute ownership-marker path inside a run workspace. */
export function markerPath(workDir: string): string {
    return join(workDir, MARKER_FILE);
}

/** True when `runId` is a single safe path segment. */
export function isSafeRunId(runId: string): boolean {
    return RUN_ID.test(runId) && runId !== '.' && runId !== '..';
}

/** True when `stamp` is composed only of the accepted characters. */
export function isSafeStamp(stamp: string): boolean {
    return STAMP.test(stamp);
}

/** True when `digest` is a `sha256:<64 hex>` definition digest. */
export function isDefinitionDigest(digest: string): boolean {
    return DEFINITION_DIGEST.test(digest);
}

/** Parse/validate `--setting key=value` against the workflow's allowlist. */
export function parseSetting(workflow: WorkflowName, raw: string): { key: string; value: string } | null {
    const separator = raw.indexOf('=');
    if (separator < 0) throw new Error(`--setting must be 'key=value', got '${raw}'`);
    if (separator === 0) throw new Error(`--setting '${raw}' has an empty key`);
    const key = raw.slice(0, separator).trim();
    const value = raw.slice(separator + 1);
    if (!SETTING_VALUE.test(value)) throw new Error(`--setting ${key}: value is not a bounded printable string`);
    const rule = WORKFLOW_SETTINGS[workflow][key];
    if (rule === undefined) return null; // unknown keys are uncapturable, never a diagnostic payload
    if (rule.kind === 'integer' && !/^\d+$/.test(value)) {
        throw new Error(`--setting ${key}: expected a nonnegative integer, got '${value}'`);
    }
    if (rule.kind === 'number' && !(Number.isFinite(Number(value)) && Number(value) >= 0)) {
        throw new Error(`--setting ${key}: expected a nonnegative number, got '${value}'`);
    }
    if (rule.kind === 'boolean' && value !== 'true' && value !== 'false') {
        throw new Error(`--setting ${key}: expected 'true' or 'false', got '${value}'`);
    }
    if (rule.kind === 'duration' && !/^\d+[smhd]$/.test(value)) {
        throw new Error(`--setting ${key}: expected a duration '<n>s|m|h|d', got '${value}'`);
    }
    if (rule.kind === 'choice' && !rule.values.includes(value)) {
        throw new Error(`--setting ${key}: expected one of ${rule.values.join(', ')}, got '${value}'`);
    }
    return { key, value };
}

/** The marker payload written into a run workspace. */
interface OwnerMarker {
    schemaVersion: 1;
    projectPath: string;
    workflow: WorkflowName;
    runId: string;
}

/** The capture outcome the CLI prints; `revoked:false` with a thrown error is never returned. */
export interface CaptureOutcome {
    /** True when a previous owner's marker was removed. */
    revoked: boolean;
    /** True when this run's record and marker were written. */
    captured: boolean;
    /** The record that was written, or null when the optional capture failed. */
    record: RunCapture | null;
    diagnostics: BoardDiagnostic[];
}

/** Injectable seams so the capture rules are testable without a real catalog or clock. */
export interface CaptureDeps {
    fs?: FileSystem;
    /** The project root the record is filed under; defaults to the canonical cwd. */
    projectPath?: string;
    now?: () => Date;
    /**
     * The exact configured works root a caller resolved (e.g. `kk daily prepare`'s `works_dir`).
     * When set, the workspace guard accepts only this root's canonical CHILD — never the root, home,
     * the config tree or the project — so a workspace outside the project can be captured (§9).
     */
    trustedWorksRoot?: string;
    /**
     * The kk config directory (`dirname(resolveKkConfigPath())`). A trusted works root must never
     * BE this directory: a run workspace is a narrow canonical child, never the config tree (§9).
     */
    configRoot?: string;
    /** Topology lookup by exact digest agreement; defaults to the `spur workflow list` catalog. */
    lookupTopology?: (
        fs: FileSystem,
        workflow: WorkflowName,
        digest: string,
    ) => RunTopology | null | Promise<RunTopology | null>;
}

/** Write `content` atomically through the fs seam (temp file in the same directory + rename). */
async function atomicWrite(fs: FileSystem, path: string, content: string): Promise<void> {
    await fs.ensureDir(dirname(path));
    const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(temp, content);
    await fs.rename(temp, path);
}

function parseJson(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

async function readJson(fs: FileSystem, path: string): Promise<unknown> {
    if (!(await fs.exists(path))) return null;
    try {
        return parseJson(await fs.readFile(path));
    } catch {
        return null;
    }
}

function stringField(value: unknown, key: string): string | null {
    if (typeof value !== 'object' || value === null) return null;
    const field = (value as Record<string, unknown>)[key];
    return typeof field === 'string' && field !== '' ? field : null;
}

/**
 * Read the workspace ownership marker. A missing, unparseable or schema-mismatched marker is
 * `null` (the marker is never trusted as this run's); a caller that must tell "no marker" from
 * "malformed marker" checks the file's existence separately.
 */
export async function readOwnerMarker(fs: FileSystem, workDir: string): Promise<OwnerMarker | null> {
    const parsed = await readJson(fs, markerPath(workDir));
    const runId = stringField(parsed, 'runId');
    const projectPath = stringField(parsed, 'projectPath');
    const workflow = stringField(parsed, 'workflow');
    if (runId === null || projectPath === null || workflow === null) return null;
    if (!WORKFLOW_NAMES.includes(workflow as WorkflowName)) return null;
    if ((parsed as Record<string, unknown>).schemaVersion !== 1) return null;
    return { schemaVersion: 1, projectPath, workflow: workflow as WorkflowName, runId };
}

/** Read one immutable capture record, or null when the run was never captured or the record is invalid. */
export async function readCaptureRecord(
    fs: FileSystem,
    projectPath: string,
    runId: string,
): Promise<RunCapture | null> {
    const parsed = await readJson(fs, captureRecordPath(projectPath, runId));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const workflow = record.workflow;
    if (typeof workflow !== 'string' || !WORKFLOW_NAMES.includes(workflow as WorkflowName)) return null;
    if (record.schemaVersion !== 1) return null;
    // §9: malformed stored evidence must answer 422, never 500 — a record that PARSES but is
    // structurally incomplete is as invalid as an unparseable one, and the routes dereference these
    // fields (workspacePath, settings) before any guard could catch it. Validating the shape here
    // keeps `authorize`'s `exists() ? 422 : 404` branch the single status decision.
    for (const key of ['projectPath', 'runId', 'workspacePath', 'stamp', 'capturedAt'] as const) {
        const value = record[key];
        if (typeof value !== 'string' || value.length === 0) return null;
    }
    const workspacePath = record.workspacePath as string;
    if (!isAbsolute(workspacePath)) return null;
    if (typeof record.settings !== 'object' || record.settings === null) return null;
    return parsed as RunCapture;
}

/** Parse the public `spur workflow list --json` catalog for topology on exact digest agreement. */
async function catalogTopology(fs: FileSystem, workflow: WorkflowName, digest: string): Promise<RunTopology | null> {
    const command = process.env.KK_SPUR_BIN ?? 'spur';
    const result = new NodeSyncProcessExecutor().runSync({ command, args: ['workflow', 'list', '--json'] });
    if (result.exitCode !== 0) return null;
    const parsed = parseJson(result.stdout);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const entries = (parsed as Record<string, unknown>).entries;
    if (!Array.isArray(entries)) return null;
    const match = entries.find(
        (entry) => stringField(entry, 'name') === workflow && stringField(entry, 'definitionDigest') === digest,
    );
    const path = stringField(match, 'path');
    if (path === null) return null;
    try {
        return topologyFromYaml(await fs.readFile(path));
    } catch {
        return null;
    }
}

/** Extract the reviewed node/edge set from a workflow YAML (state machine or DAG). */
export function topologyFromYaml(source: string): RunTopology | null {
    let parsed: unknown;
    try {
        parsed = Bun.YAML.parse(source);
    } catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    const doc = parsed as Record<string, unknown>;
    const nodes: string[] = [];
    const edges: { from: string; to: string }[] = [];
    if (Array.isArray(doc.states)) {
        for (const state of doc.states) {
            const id = stringField(state, 'id');
            if (id !== null) nodes.push(id);
        }
        for (const transition of Array.isArray(doc.transitions) ? doc.transitions : []) {
            const from = stringField(transition, 'from');
            const to = stringField(transition, 'to');
            if (from !== null && to !== null) edges.push({ from, to });
        }
    }
    if (Array.isArray(doc.nodes)) {
        for (const node of doc.nodes) {
            const id = stringField(node, 'id');
            if (id === null) continue;
            nodes.push(id);
            const dependsOn =
                typeof node === 'object' && node !== null ? (node as Record<string, unknown>).dependsOn : undefined;
            for (const dependency of Array.isArray(dependsOn) ? dependsOn : []) {
                if (typeof dependency === 'string' && dependency !== '') edges.push({ from: dependency, to: id });
            }
        }
    }
    return nodes.length === 0 ? null : { nodes, edges };
}

/**
 * True when `workDir` is a canonical CHILD of an explicitly trusted, configured works root (§9).
 * The root itself, the home/config root and the project tree are refused even when trusted.
 */
function isTrustedChildWorkspace(
    fs: FileSystem,
    root: string,
    workDir: string,
    projectPath: string,
    configRoot: string | null,
): boolean {
    const resolvedRoot = resolve(projectPath, root);
    let canonicalRoot = resolvedRoot;
    try {
        canonicalRoot = fs.realPath?.(resolvedRoot) ?? resolvedRoot;
    } catch {
        canonicalRoot = resolvedRoot;
    }
    if (canonicalRoot === '/' || canonicalRoot === homedir() || canonicalRoot === projectPath) return false;
    if (configRoot !== null && canonicalRoot === configRoot) return false;
    if (projectPath.startsWith(`${canonicalRoot}/`)) return false;
    return workDir !== canonicalRoot && workDir.startsWith(`${canonicalRoot}/`);
}

/**
 * Capture one run: revoke the previous workspace owner, then write this run's immutable record
 * and ownership marker.
 *
 * Validation failures and a refused revocation throw (the caller must not overwrite results);
 * a failure to write the new record after a successful revocation only warns.
 */
export async function captureRun(input: RunCaptureInput, deps: CaptureDeps = {}): Promise<CaptureOutcome> {
    const fs = deps.fs ?? createNodeFileSystem();
    const diagnostics: BoardDiagnostic[] = [];
    if (!WORKFLOW_NAMES.includes(input.workflow)) {
        throw new Error(`unknown workflow '${input.workflow}' (expected ${WORKFLOW_NAMES.join(', ')})`);
    }
    if (!isSafeRunId(input.runId)) {
        throw new Error(`--run '${input.runId}' is not a single safe path segment`);
    }
    if (!isSafeStamp(input.stamp)) {
        throw new Error(`--stamp '${input.stamp}' accepts only alphanumerics, dash and underscore`);
    }
    if (input.definitionDigest !== undefined && !isDefinitionDigest(input.definitionDigest)) {
        throw new Error(`--definition-digest '${input.definitionDigest}' must be sha256:<64 hex>`);
    }
    const projectPath = deps.projectPath ?? fs.realPath?.(process.cwd()) ?? resolve(process.cwd());
    // A relative `--work-dir` resolves against the project the capture is filed under: `kk-collect`
    // composes `.works/kk-collect/<stamp>` relative to ITS project (the `lock` state projects
    // `<work_dir>` into `.spur/runs/kk-collect/work-dir.txt`), and the engine may run the action from
    // any cwd. An `isAbsolute` refusal was tried here and rejected — it refused the workflow's own
    // shape and broke the kk-collect E2E (see the task record); the root-shape checks below are the
    // guarantee that matters, and they apply to the canonicalized path either way.
    // Canonicalize when the path exists; a path that does not exist yet is still judged lexically (a
    // guard must never throw ENOENT — the caller's own write reports a missing directory later).
    const resolvedWorkDir = resolve(projectPath, input.workDir);
    let workDir = resolvedWorkDir;
    try {
        workDir = fs.realPath?.(resolvedWorkDir) ?? resolvedWorkDir;
    } catch {
        workDir = resolvedWorkDir;
    }
    // §9: the workspace must be a canonical CHILD of a works root — never `/`, the home/config tree,
    // the project root or one of its ancestors. The ownership marker is written into this directory
    // and the reader then serves its files, so accepting a root would expose everything under it.
    //
    // The check reads the PATH, never the process cwd: a workflow action may run from anywhere (the
    // engine's shell cwd is not the workspace's tree), while its `--work-dir` is a configured works
    // root child. Keying on cwd rejected the real `kk-collect` call path — the E2E caught it.
    const segments = workDir.split('/').filter((segment) => segment !== '');
    let worksRootIndex = -1;
    for (let i = segments.length - 1; i >= 0; i -= 1) {
        const segment = segments[i];
        if (segment !== undefined && WORKS_ROOT_NAMES.has(segment)) {
            worksRootIndex = i;
            break;
        }
    }
    const insideNamedWorksRoot = worksRootIndex !== -1 && worksRootIndex !== segments.length - 1;
    // §9: a configured works root may sit outside the project and not be named `.works`/`works`.
    // `kk daily prepare` passes its resolved configured root explicitly; accept only that root's
    // canonical CHILD workspace — never the root, home, the config tree or the project itself.
    const configRoot = deps.configRoot ?? dirname(resolveKkConfigPath());
    const insideTrustedWorksRoot =
        deps.trustedWorksRoot !== undefined &&
        isTrustedChildWorkspace(fs, deps.trustedWorksRoot, workDir, projectPath, configRoot);
    if (
        workDir === '/' ||
        workDir === homedir() ||
        workDir === projectPath ||
        projectPath.startsWith(`${workDir}/`) ||
        (!insideNamedWorksRoot && !insideTrustedWorksRoot)
    ) {
        throw new Error(
            '--work-dir must resolve to a run workspace below a works root (.works/ or works/) or the configured works root, never a filesystem, home or project root',
        );
    }

    const conflict = await readCaptureRecord(fs, projectPath, input.runId);
    if (conflict !== null && (conflict.workflow !== input.workflow || conflict.workspacePath !== workDir)) {
        throw new Error(`run '${input.runId}' is already captured with a different workflow or workspace`);
    }

    const marker = await readOwnerMarker(fs, workDir);
    let revoked = false;
    if (
        marker !== null &&
        (marker.runId !== input.runId || marker.projectPath !== projectPath || marker.workflow !== input.workflow)
    ) {
        // A new owner may not claim pre-existing outputs: revocation is mandatory and atomic.
        await fs.deleteFile(markerPath(workDir));
        revoked = true;
    }

    const record: RunCapture = {
        schemaVersion: 1,
        projectPath,
        workflow: input.workflow,
        runId: input.runId,
        workspacePath: workDir,
        stamp: input.stamp,
        capturedAt: (deps.now?.() ?? new Date()).toISOString(),
        settings: input.settings,
        ...(input.definitionDigest === undefined ? {} : { definitionDigest: input.definitionDigest }),
    };
    if (input.definitionDigest !== undefined) {
        const lookup = deps.lookupTopology ?? catalogTopology;
        let topology: RunTopology | null = null;
        try {
            topology = await lookup(fs, input.workflow, input.definitionDigest);
        } catch {
            topology = null;
        }
        if (topology === null) {
            diagnostics.push({
                code: 'board.capture.topology-unavailable',
                message: 'Definition digest did not match the workflow catalog; dependency edges are unknown.',
            });
        } else {
            record.topology = topology;
        }
    }

    try {
        await atomicWrite(fs, captureRecordPath(projectPath, input.runId), `${JSON.stringify(record, null, 2)}\n`);
        const owner: OwnerMarker = { schemaVersion: 1, projectPath, workflow: input.workflow, runId: input.runId };
        await atomicWrite(fs, markerPath(workDir), `${JSON.stringify(owner, null, 2)}\n`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        diagnostics.push({ code: 'board.capture.failed', message: `Capture failed after revocation: ${message}` });
        return { revoked, captured: false, record: null, diagnostics };
    }
    return { revoked, captured: true, record, diagnostics };
}
