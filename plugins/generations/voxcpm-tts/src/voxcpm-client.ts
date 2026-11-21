import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { echoError } from '@gobing-ai/ts-utils';
import { type ParsedWav, parseWav, type VoiceboxClient, type VoiceboxGenerateBody } from '@gobing-ai/voice-gen';

/** Generator identity stamped into `metadata.generator` by the shared pipeline. */
export const VOXCPM_TTS_GENERATOR = 'kk:voxcpm-tts';
/** Frozen backend defaults (ADR-036 / voxcpm-daily-voice-driver). */
export const VOXCPM_DEFAULT_MODEL = 'openbmb/VoxCPM2';
export const VOXCPM_DEFAULT_DEVICE = 'auto';
export const VOXCPM_DEVICES = ['auto', 'cpu', 'cuda', 'mps'] as const;
/** Protocol framing bounds (frozen private adapter details). */
const LINE_MAX_BYTES = 1_048_576;
const STDERR_MAX_CHARS = 65_536;
/** Signal grace before SIGKILL of the owned process group. */
const TERM_GRACE_MS = 2000;
/** Bounded wait for the forced kill to land. */
const SIGKILL_GRACE_MS = 1000;
/** Signals that must tear down owned workers before the process ends. */
const SIGNAL_HANDLERS = ['SIGTERM', 'SIGINT'] as const;

export type VoxCpmDevice = (typeof VOXCPM_DEVICES)[number];
export type VoxCpmProfileMode = 'instruct' | 'reference' | 'continuation';

export interface VoxCpmProfile {
    id: string;
    name: string;
    mode: VoxCpmProfileMode;
    instruct?: string;
    reference_wav_path?: string;
    prompt_wav_path?: string;
    prompt_text?: string;
}

export interface VoxCpmClientOptions {
    env?: Record<string, string | undefined>;
    /** Override the worker argv (tests point at a fake NDJSON worker). */
    workerCommand?: string[];
    /** Override the plugin installation root; defaults to the directory above this module. */
    pluginRoot?: string;
    spawn?: VoxCpmSpawn;
}

export interface VoxCpmSpawnOptions {
    cwd: string;
    env: Record<string, string | undefined>;
}

export type VoxCpmSpawn = (command: string[], options: VoxCpmSpawnOptions) => ChildProcess;

export interface VoxCpmClientHandle {
    readonly client: VoiceboxClient;
    readonly scratchDir: string;
    close(): Promise<void>;
}

interface PendingRequest {
    resolve: (value: Record<string, unknown>) => void;
    reject: (error: Error) => void;
}

const BASE_ENV_KEYS = [
    'PATH',
    'HOME',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'PYTHONPATH',
    'PYTHONHOME',
    'VIRTUAL_ENV',
    'UV_PROJECT_ENVIRONMENT',
    'UV_CACHE_DIR',
    'UV_PYTHON',
    'HF_HOME',
    'HF_HUB_CACHE',
    'XDG_CACHE_HOME',
    'HF_HUB_OFFLINE',
    'TRANSFORMERS_CACHE',
    'HF_DATASETS_CACHE',
];

/**
 * Reject any path (including one reached through a symlink) whose canonical form contains a
 * `vendors` segment — `vendors/` is reference-only and must never be a product runtime path
 * (ADR-036). Returns the resolved absolute path for reuse.
 */
export function assertNoVendorPath(candidate: string, label: string): string {
    const resolved = resolve(candidate);
    if (resolved.split(sep).includes('vendors')) {
        throw new Error(`voxcpm-tts: ${label} must not reference vendors/ (reference-only): ${resolved}`);
    }
    if (existsSync(resolved)) {
        const real = realpathSync(resolved);
        if (real.split(sep).includes('vendors')) {
            throw new Error(`voxcpm-tts: ${label} resolves into vendors/ (reference-only): ${real}`);
        }
    }
    return resolved;
}

/** Validate every configured import/cache/environment path before the worker is spawned. */
function assertEnvPathsSafe(env: Record<string, string | undefined>): void {
    for (const key of BASE_ENV_KEYS) {
        const raw = env[key];
        if (!raw) {
            continue;
        }
        for (const part of raw.split(delimiter)) {
            if (part) {
                assertNoVendorPath(part, key);
            }
        }
    }
}

function assertDeviceSafe(env: Record<string, string | undefined>): VoxCpmDevice {
    const raw = env.VOXCPM_DEVICE ?? VOXCPM_DEFAULT_DEVICE;
    if (!(VOXCPM_DEVICES as readonly string[]).includes(raw)) {
        throw new Error(`voxcpm-tts: unsupported VOXCPM_DEVICE "${raw}" (allowed: ${VOXCPM_DEVICES.join(', ')})`);
    }
    return raw as VoxCpmDevice;
}

/**
 * Parse and validate the frozen profile registry: unique nonempty ids/names; `instruct` needs an
 * instruction; `reference` needs a reference WAV; `continuation` needs a paired prompt WAV/text;
 * relative assets resolve against the registry directory; serialized OmniVoice prompts and mixed
 * mode fields are refused (VoxCPM daily voice driver §Backend and controls).
 */
export function parseVoxCpmRegistry(raw: unknown, registryDir: string): VoxCpmProfile[] {
    const container = raw as { profiles?: unknown };
    if (!container || typeof container !== 'object' || !Array.isArray(container.profiles)) {
        throw new Error('voxcpm-tts: profile registry must be an object with a "profiles" array');
    }
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    return container.profiles.map((entry, index) => {
        const profile = entry as Record<string, unknown>;
        if (!profile || typeof profile !== 'object') {
            throw new Error(`voxcpm-tts: profile registry entry ${index} is not an object`);
        }
        const id = typeof profile.id === 'string' ? profile.id.trim() : '';
        const name = typeof profile.name === 'string' ? profile.name.trim() : '';
        if (!id || !name) {
            throw new Error(`voxcpm-tts: profile registry entry ${index} needs nonempty id and name`);
        }
        if (seenIds.has(id) || seenNames.has(name)) {
            throw new Error(`voxcpm-tts: duplicate profile id/name "${id}"`);
        }
        seenIds.add(id);
        seenNames.add(name);
        if ('prompt' in profile || 'serialized_prompt' in profile) {
            throw new Error(`voxcpm-tts: profile "${id}" carries a serialized OmniVoice prompt`);
        }
        const mode = profile.mode;
        if (mode !== 'instruct' && mode !== 'reference' && mode !== 'continuation') {
            throw new Error(`voxcpm-tts: profile "${id}" has unsupported mode "${String(mode)}"`);
        }
        const asset = (key: string): string | undefined => {
            const value = profile[key];
            if (value === undefined) {
                return undefined;
            }
            if (typeof value !== 'string' || !value.trim()) {
                throw new Error(`voxcpm-tts: profile "${id}" field ${key} must be a nonempty string`);
            }
            const path = isAbsolute(value) ? value : resolve(registryDir, value);
            return assertNoVendorPath(path, `profile "${id}" ${key}`);
        };
        const instruct = typeof profile.instruct === 'string' ? profile.instruct.trim() : undefined;
        const reference = asset('reference_wav_path');
        const promptWav = asset('prompt_wav_path');
        const promptText = typeof profile.prompt_text === 'string' ? profile.prompt_text.trim() : undefined;

        const mixed = mode === 'instruct' ? [reference, promptWav] : mode === 'reference' ? [promptWav] : [reference];
        if (mixed.some((value) => value !== undefined)) {
            throw new Error(`voxcpm-tts: profile "${id}" mixes mode "${mode}" with fields from another mode`);
        }
        if (mode === 'instruct' && !instruct) {
            throw new Error(`voxcpm-tts: instruct profile "${id}" needs a nonempty instruct`);
        }
        if (mode === 'reference' && !reference) {
            throw new Error(`voxcpm-tts: reference profile "${id}" needs reference_wav_path`);
        }
        if (mode === 'continuation' && (!promptWav || !promptText)) {
            throw new Error(`voxcpm-tts: continuation profile "${id}" needs prompt_wav_path and prompt_text`);
        }
        return {
            id,
            name,
            mode,
            ...(instruct ? { instruct } : {}),
            ...(reference ? { reference_wav_path: reference } : {}),
            ...(promptWav ? { prompt_wav_path: promptWav } : {}),
            ...(promptText ? { prompt_text: promptText } : {}),
        };
    });
}

const DEFAULT_PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function resolveVoxCpmWorkerCommand(pluginRoot: string): string[] {
    return [
        'uv',
        'run',
        '--project',
        pluginRoot,
        '--locked',
        '--no-dev',
        'python',
        join(pluginRoot, 'python', 'worker.py'),
    ];
}

const defaultSpawn: VoxCpmSpawn = (command, options) =>
    spawn(command[0] as string, command.slice(1), {
        cwd: options.cwd,
        env: options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
    });

function readWavFile(path: string): ParsedWav {
    let wav: ParsedWav;
    try {
        wav = parseWav(new Uint8Array(readFileSync(path)));
    } catch (err: unknown) {
        throw new Error(
            `voxcpm-tts: invalid worker WAV at ${path}: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
    if (wav.audioFormat !== 1 || wav.bitsPerSample !== 16) {
        throw new Error(
            `voxcpm-tts: worker WAV must be 16-bit PCM (got format ${wav.audioFormat}/${wav.bitsPerSample}bit)`,
        );
    }
    if (wav.numChannels !== 1) {
        throw new Error(`voxcpm-tts: worker WAV must be mono (got ${wav.numChannels} channels)`);
    }
    if (!Number.isFinite(wav.sampleRate) || wav.sampleRate <= 0 || wav.byteRate <= 0) {
        throw new Error(`voxcpm-tts: worker WAV needs a positive sample rate (got ${wav.sampleRate})`);
    }
    if (wav.dataBytes.length === 0) {
        throw new Error('voxcpm-tts: worker WAV carries no samples');
    }
    return wav;
}

/**
 * Invocation-scoped VoxCPM adapter over the shared `VoiceboxClient` contract: a private uv Python
 * worker speaking bounded integer-id NDJSON, at most one model load per invocation, one in-flight
 * render, and signal/deadline-scoped process-group teardown. Returns the client plus an async
 * `close()` the entry calls from `finally`.
 */
export function createVoxCpmClient(options: VoxCpmClientOptions = {}): VoxCpmClientHandle {
    const env = options.env ?? (process.env as Record<string, string | undefined>);
    const spawnProcess = options.spawn ?? defaultSpawn;
    const pluginRoot = assertNoVendorPath(options.pluginRoot ?? DEFAULT_PLUGIN_ROOT, 'plugin root');
    const registryPath = assertNoVendorPath(env.VOXCPM_PROFILES_PATH ?? join(pluginRoot, 'profiles.json'), 'profiles');
    const workerCommand = options.workerCommand ?? resolveVoxCpmWorkerCommand(pluginRoot);
    const startupTimeoutMs = positiveTimeout(env.VOICEBOX_TIMEOUT_MS, 600_000);
    const scratchDir = mkdtempSync(join(tmpdir(), 'kk-voxcpm-tts-'));

    let child: ChildProcess | undefined;
    let nextId = 1;
    let fatal: Error | undefined;
    let closed = false;
    let stderrTail = '';
    let stderrDone: Promise<void> = Promise.resolve();
    let exitDetails: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    let stdoutBuffer = '';
    let renderInFlight: { id: number; dest: string } | undefined;
    let warnedChunk = false;
    let warnedLanguage = false;
    let warnedInstruct = false;
    let warnedInstructIgnored = false;
    let instructSegments = 0;
    const pending = new Map<number, PendingRequest>();
    const renderResults = new Map<number, Promise<Record<string, unknown>>>();
    const signalHandlers = new Map<NodeJS.Signals, () => void>();
    const destinations = new Map<number, string>();
    const profileCache = new Map<string, VoxCpmProfile>();

    function fail(error: Error): void {
        if (!fatal) {
            fatal = error;
        }
        for (const [, request] of pending) {
            request.reject(fatal);
        }
        pending.clear();
        renderInFlight = undefined;
        void terminateChild();
    }

    function onLine(line: string): void {
        if (line.length === 0) {
            return;
        }
        if (Buffer.byteLength(line) > LINE_MAX_BYTES) {
            fail(new Error('voxcpm-tts: worker response frame exceeds 1 MiB'));
            return;
        }
        let message: Record<string, unknown>;
        try {
            message = JSON.parse(line) as Record<string, unknown>;
        } catch {
            fail(new Error(`voxcpm-tts: worker emitted invalid JSON: ${line.slice(0, 120)}`));
            return;
        }
        const id = message.id;
        if (typeof id !== 'number' || !Number.isInteger(id)) {
            fail(new Error('voxcpm-tts: worker response is missing an integer id'));
            return;
        }
        const request = pending.get(id);
        if (!request) {
            fail(new Error(`voxcpm-tts: worker response for unknown or duplicate id ${id}`));
            return;
        }
        pending.delete(id);
        request.resolve(message);
    }

    function consumeStdout(text: string): void {
        stdoutBuffer += text;
        let newline = stdoutBuffer.indexOf('\n');
        while (newline !== -1) {
            const line = stdoutBuffer.slice(0, newline).replace(/\r$/, '');
            stdoutBuffer = stdoutBuffer.slice(newline + 1);
            onLine(line);
            newline = stdoutBuffer.indexOf('\n');
        }
        // Bound the in-progress remainder too: a worker streaming bytes without a newline must
        // not grow the buffer without limit before `onLine`'s per-line cap can fire.
        if (Buffer.byteLength(stdoutBuffer, 'utf8') > LINE_MAX_BYTES) {
            fail(new Error('voxcpm-tts: worker response frame exceeds 1 MiB'));
        }
    }

    function startWorker(): void {
        if (child) {
            return;
        }
        assertEnvPathsSafe(env);
        const device = assertDeviceSafe(env);
        assertNoVendorPath(workerCommand[workerCommand.length - 1] ?? pluginRoot, 'worker script');
        let proc: ChildProcess;
        try {
            proc = spawnProcess(workerCommand, {
                cwd: pluginRoot,
                env: {
                    ...pickEnv(env),
                    VOXCPM_MODEL: env.VOXCPM_MODEL ?? VOXCPM_DEFAULT_MODEL,
                    VOXCPM_DEVICE: device,
                    VOXCPM_PROFILES_PATH: registryPath,
                },
            });
        } catch (err: unknown) {
            throw new Error(`voxcpm-tts: failed to spawn worker: ${err instanceof Error ? err.message : String(err)}`);
        }
        child = proc;
        proc.on('error', (err) => fail(new Error(`voxcpm-tts: worker process error: ${err.message}`)));
        proc.on('exit', (code, signal) => {
            exitDetails = { code, signal };
            if (!closed && !fatal) {
                void Promise.race([stderrDone, new Promise((r) => setTimeout(r, 150))]).then(() => {
                    if (!closed && !fatal) {
                        fail(
                            new Error(
                                `voxcpm-tts: worker exited unexpectedly (code ${code ?? 'null'}, signal ${signal ?? 'none'})${stderrTail ? `: ${stderrTail.slice(-400)}` : ''}`,
                            ),
                        );
                    }
                });
            }
        });
        if (proc.stderr) {
            stderrDone = pump(proc.stderr, (text) => {
                stderrTail = (stderrTail + text).slice(-STDERR_MAX_CHARS);
            });
        }
        if (proc.stdout) {
            void pump(proc.stdout, consumeStdout, () => {
                if (!fatal && !closed) {
                    void Promise.race([
                        Promise.all([waitForExit(proc, 250), stderrDone]),
                        new Promise((r) => setTimeout(r, 250)),
                    ]).then(() => {
                        if (!fatal && !closed) {
                            const detail = exitDetails
                                ? ` (code ${exitDetails.code ?? 'null'}, signal ${exitDetails.signal ?? 'none'})`
                                : ' before settling all requests';
                            fail(
                                new Error(
                                    `voxcpm-tts: worker closed stdout${detail}${stderrTail ? `: ${stderrTail.slice(-400)}` : ''}`,
                                ),
                            );
                        }
                    });
                }
            });
        }
        // Normal-signal teardown: SIGTERM/SIGINT close, terminate and reap owned workers.
        for (const signal of SIGNAL_HANDLERS) {
            const handler = () => {
                void close();
            };
            signalHandlers.set(signal, handler);
            process.on(signal, handler);
        }
    }

    function removeSignalHandlers(): void {
        for (const [signal, handler] of signalHandlers) {
            process.off(signal, handler);
        }
        signalHandlers.clear();
    }

    /**
     * Terminate and reap the owned worker group before returning: close stdin, TERM the group,
     * force-kill after the grace window, then wait (bounded) until the whole group is gone. R4
     * requires the invocation to own cleanup, so `close()` must not resolve while a descendant
     * is still alive.
     */
    async function terminateChild(): Promise<void> {
        const proc = child;
        child = undefined;
        if (!proc?.pid) {
            try {
                proc?.stdin?.end();
            } catch {
                // stdin already gone
            }
            return;
        }
        const pgid = proc.pid;
        try {
            proc.stdin?.end();
        } catch {
            // stdin already gone
        }
        killGroup(pgid, 'SIGTERM');
        // Escalation is keyed on the OWNED GROUP surviving, not on the direct `uv` child: a
        // descendant that ignores SIGTERM must still be force-killed, even when `uv` itself
        // already exited. R4 mandates unconditional escalation (TERM, wait 2s, then force).
        let groupGone = await waitForGroupGone(pgid, TERM_GRACE_MS);
        if (!groupGone) {
            killGroup(pgid, 'SIGKILL');
            groupGone = await waitForGroupGone(pgid, SIGKILL_GRACE_MS);
        }
        await waitForExit(proc, SIGKILL_GRACE_MS); // reap the direct child (bounded)
        if (!groupGone) {
            // A group that survives SIGKILL is a cleanup failure, not a silent success.
            echoError(
                `voxcpm-tts: cleanup failure: owned worker group ${pgid} still alive after SIGKILL (${SIGKILL_GRACE_MS}ms)`,
            );
        }
    }

    function sendRequest(op: string, extra: Record<string, unknown>): Promise<Record<string, unknown>> {
        const proc = child;
        if (!proc?.stdin) {
            throw new Error('voxcpm-tts: worker is not running');
        }
        const id = nextId++;
        const request = { id, op, ...extra };
        const promise = new Promise<Record<string, unknown>>((res, rej) => {
            pending.set(id, { resolve: res, reject: rej });
        });
        proc.stdin.write(`${JSON.stringify(request)}\n`);
        return promise;
    }

    async function awaitResponse(promise: Promise<Record<string, unknown>>, timeoutMs: number, label: string) {
        return withDeadline(promise, timeoutMs, `${label} timed out after ${timeoutMs}ms`, (message) =>
            fail(new Error(`voxcpm-tts: ${message}`)),
        );
    }

    function resolveProfileSync(nameOrId: string): VoxCpmProfile {
        const registry = loadRegistry();
        const cached = profileCache.get(nameOrId);
        if (cached) {
            return cached;
        }
        const lower = nameOrId.toLowerCase();
        const match = registry.find((entry) => entry.id === nameOrId || entry.name.toLowerCase() === lower);
        if (!match) {
            throw new Error(`voxcpm-tts: unknown voice profile "${nameOrId}"`);
        }
        profileCache.set(nameOrId, match);
        profileCache.set(match.id, match);
        return match;
    }

    let registry: VoxCpmProfile[] | undefined;
    function loadRegistry(): VoxCpmProfile[] {
        if (registry) {
            return registry;
        }
        if (!existsSync(registryPath)) {
            throw new Error(`voxcpm-tts: profile registry not found: ${registryPath}`);
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(readFileSync(registryPath, 'utf-8'));
        } catch (err: unknown) {
            throw new Error(
                `voxcpm-tts: profile registry is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
        registry = parseVoxCpmRegistry(parsed, dirname(registryPath));
        return registry;
    }

    function policyCheck(
        body: VoiceboxGenerateBody,
        profile: VoxCpmProfile,
    ): { instruct?: string; normalize: boolean } {
        if (body.engine?.trim()) {
            throw new Error(`voxcpm-tts: engine "${body.engine}" is not supported (VoxCPM2 only)`);
        }
        if (body.personality === true) {
            throw new Error('voxcpm-tts: personality=true is not supported');
        }
        if (Array.isArray(body.effects_chain) && body.effects_chain.some((effect) => effect?.enabled !== false)) {
            throw new Error('voxcpm-tts: an active effects_chain is not supported');
        }
        const requestedInstruct = body.instruct?.trim();
        if (profile.mode === 'instruct') {
            // Instruct profiles carry no reference audio, so the model samples a speaker per request:
            // a multi-segment episode then changes voice from segment to segment (20261015: within-item
            // F0 swing up to 103 Hz, 59 speakers). One segment is still legitimate; a second one is the
            // defect, so refuse it instead of shipping a voice change.
            instructSegments += 1;
            if (instructSegments > 1) {
                throw new Error(
                    `voxcpm-tts: profile "${profile.id}" is instruct-mode and pins no speaker — segment ${instructSegments} would sound like a different person; use a reference/continuation profile (VOXCPM_PROFILES_PATH)`,
                );
            }
            if (!warnedInstruct) {
                warnedInstruct = true;
                echoError(
                    `voxcpm-tts: profile "${profile.id}" is instruct-mode and pins no speaker — every request draws a new voice; use a reference/continuation profile for multi-segment episodes`,
                );
            }
            const instruct = requestedInstruct || profile.instruct;
            if (instruct) {
                return { instruct, normalize: body.normalize ?? true };
            }
            return { normalize: body.normalize ?? true };
        }
        if (requestedInstruct) {
            // The shared pipeline turns a segment's `emotion` into a per-request instruct, so this is
            // the normal case for every daily episode. A reference/continuation profile already fixes
            // the voice: ignoring the instruction beats failing the tier (or re-labelling the clip).
            if (!warnedInstructIgnored) {
                warnedInstructIgnored = true;
                echoError(
                    `voxcpm-tts: ignoring the per-request instruct on "${profile.mode}" profile "${profile.id}" — the reference clip defines the voice`,
                );
            }
        }
        return { normalize: body.normalize ?? true };
    }

    function warnAdvisory(body: VoiceboxGenerateBody): void {
        if (!warnedChunk && (body.max_chunk_chars !== undefined || body.crossfade_ms !== undefined)) {
            warnedChunk = true;
            echoError(
                'voxcpm-tts: max_chunk_chars/crossfade_ms are advisory; shared VoiceScript segmentation is the request boundary',
            );
        }
        if (!warnedLanguage) {
            warnedLanguage = true;
            echoError(
                'voxcpm-tts: language is automatic multilingual inference; the requested language keyword is ignored',
            );
        }
    }

    async function close(): Promise<void> {
        if (closed) {
            return;
        }
        closed = true;
        removeSignalHandlers();
        for (const [, request] of pending) {
            request.reject(new Error('voxcpm-tts: client closed'));
        }
        pending.clear();
        await terminateChild();
        try {
            rmSync(scratchDir, { recursive: true, force: true });
        } catch {
            // best-effort scratch cleanup
        }
    }

    const client: VoiceboxClient = {
        url: `uv://${pluginRoot}`,

        async health(): Promise<void> {
            if (fatal) {
                throw fatal;
            }
            if (closed) {
                throw new Error('voxcpm-tts: client is closed');
            }
            if (!child) {
                startWorker();
            }
            const response = await awaitResponse(
                sendRequest('health', {}),
                startupTimeoutMs,
                'voxcpm-tts worker startup',
            );
            if (response.ok !== true) {
                throw new Error(`voxcpm-tts: worker health failed: ${String(response.error ?? 'unknown error')}`);
            }
        },

        async resolveProfile(nameOrId: string) {
            const profile = resolveProfileSync(nameOrId);
            return { id: profile.id, name: profile.name };
        },

        async generate(body: VoiceboxGenerateBody): Promise<{ id: string }> {
            if (fatal) {
                throw fatal;
            }
            if (closed) {
                throw new Error('voxcpm-tts: client is closed');
            }
            if (renderInFlight) {
                throw new Error('voxcpm-tts: a render is already in flight; only one request at a time is allowed');
            }
            const profile = resolveProfileSync(body.profile_id);
            const policy = policyCheck(body, profile);
            warnAdvisory(body);
            if (!child) {
                startWorker();
            }
            const id = nextId;
            const dest = assertNoVendorPath(join(scratchDir, `render-${id}.wav`), 'render destination');
            const promise = sendRequest('render', {
                text: body.text,
                profile: {
                    id: profile.id,
                    name: profile.name,
                    mode: profile.mode,
                    ...(policy.instruct ? { instruct: policy.instruct } : {}),
                    ...(profile.reference_wav_path ? { reference_wav_path: profile.reference_wav_path } : {}),
                    ...(profile.prompt_wav_path ? { prompt_wav_path: profile.prompt_wav_path } : {}),
                    ...(profile.prompt_text ? { prompt_text: profile.prompt_text } : {}),
                },
                normalize: policy.normalize,
                seed: body.seed ?? null,
                dest,
            });
            renderInFlight = { id, dest };
            destinations.set(id, dest);
            const settled = promise.finally(() => {
                if (renderInFlight?.id === id) {
                    renderInFlight = undefined;
                }
            });
            renderResults.set(id, settled);
            // Return promptly; waitUntilDone awaits the stored promise under its deadline.
            void settled.catch(() => {});
            return { id: String(id) };
        },

        async waitUntilDone(id: string, timeoutMs?: number) {
            const numeric = Number.parseInt(id, 10);
            const result = renderResults.get(numeric);
            if (!result) {
                return { status: 'failed' as const, error: `voxcpm-tts: unknown generation id ${id}` };
            }
            let response: Record<string, unknown>;
            try {
                response = await awaitResponse(result, timeoutMs ?? startupTimeoutMs, `voxcpm-tts render ${id}`);
            } catch (err: unknown) {
                if (fatal) {
                    throw fatal;
                }
                return { status: 'failed' as const, error: err instanceof Error ? err.message : String(err) };
            }
            renderResults.delete(numeric);
            if (response.ok !== true) {
                return { status: 'failed' as const, error: String(response.error ?? 'unknown error') };
            }
            const dest = destinations.get(numeric);
            const wavPath = typeof response.wav_path === 'string' ? response.wav_path : '';
            if (!dest || resolve(wavPath) !== dest) {
                fail(new Error(`voxcpm-tts: worker reported an unexpected WAV path "${wavPath}"`));
            }
            const wav = readWavFile(dest as string);
            return { status: 'completed' as const, duration: wav.dataBytes.length / wav.byteRate };
        },

        async downloadAudio(id: string): Promise<Uint8Array> {
            if (fatal) {
                throw fatal;
            }
            const numeric = Number.parseInt(id, 10);
            const dest = destinations.get(numeric);
            if (!dest) {
                throw new Error(`voxcpm-tts: unknown generation id ${id}`);
            }
            readWavFile(dest);
            return new Uint8Array(readFileSync(dest));
        },
    };

    return { client, scratchDir, close };
}

function positiveTimeout(raw: string | undefined, fallback: number): number {
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function pickEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
    const picked: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(env)) {
        if (typeof value === 'string') {
            picked[key] = value;
        }
    }
    return picked;
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
    try {
        process.kill(-pid, signal);
    } catch {
        try {
            process.kill(pid, signal);
        } catch {
            // already gone
        }
    }
}

function waitForGroupGone(pgid: number, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    return new Promise((resolvePromise) => {
        const poll = (): void => {
            try {
                process.kill(-pgid, 0);
            } catch {
                resolvePromise(true);
                return;
            }
            if (Date.now() - start >= timeoutMs) {
                resolvePromise(false);
                return;
            }
            setTimeout(poll, 25);
        };
        poll();
    });
}

function waitForExit(proc: ChildProcess, timeoutMs: number): Promise<boolean> {
    return new Promise((resolvePromise) => {
        if (proc.exitCode !== null || proc.signalCode !== null) {
            resolvePromise(true);
            return;
        }
        const timer = setTimeout(() => resolvePromise(false), timeoutMs);
        proc.once('exit', () => {
            clearTimeout(timer);
            resolvePromise(true);
        });
    });
}

async function pump(stream: NodeJS.ReadableStream, onChunk: (text: string) => void, onEnd?: () => void): Promise<void> {
    const decoder = new TextDecoder();
    try {
        for await (const chunk of stream) {
            onChunk(decoder.decode(chunk as Uint8Array, { stream: true }));
        }
        onChunk(decoder.decode());
    } catch {
        // stream failure is surfaced through the worker exit path
    } finally {
        onEnd?.();
    }
}

function withDeadline<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string,
    onTimeout: (message: string) => void,
): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            onTimeout(timeoutMessage);
            reject(new Error(timeoutMessage));
        }, timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
