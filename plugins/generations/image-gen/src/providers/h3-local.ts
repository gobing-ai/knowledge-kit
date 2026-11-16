import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { readBytes } from '../bytes';
import type { ImageProvider, ImageRequest, ImageResult, ProviderFactory, ProviderOptions } from './types';

/**
 * no-direct-fs-io / no-direct-process-spawn exemption is recorded as per-file
 * exclusions in .spur/rules/strict/runtime-boundaries.yaml: this provider's transport
 * IS spawning the local `h3gen.sh` wrapper and staging one temp output file for it
 * (same vendor-CLI-boundary class as codex-cli).
 */

/**
 * h3-local adapter (task 0379, feature K2) — Robin's local Apple Silicon MLX image runtime,
 * reached through its `h3gen.sh` wrapper. Never auto-selected: a 6-minute-per-image local
 * render must be an explicit operator choice, and the wrapper's readiness (venv, 49 GB of
 * weights, a mounted external volume) cannot be expressed as env presence.
 *
 * Why a subprocess and not an import: the runtime is a Python venv (`../gitops/apps/h3-image-mlx`),
 * so shelling out to its documented wrapper is the whole integration. `h3gen.sh` forwards every
 * unknown flag to `h3-image-mlx generate`, resolves a relative `--output` against the caller's
 * cwd, and echoes the written path.
 */

const DEFAULT_MODEL = 'h3';

/** H3 accepts multiples of 32 within 256–4096 (h3-image-mlx README). */
const H3_DIM_MIN = 256;
const H3_DIM_MAX = 4096;
const H3_DIM_STEP = 32;

/**
 * Default timeout is the measured worst case, not a guess: a cold 1024² text-to-image render is
 * ~6–7 min and a two-reference edit measured 27 min 46 s (h3gen.sh README table). Anything
 * tighter would kill paid-for work; `H3_LOCAL_TIMEOUT_MS` overrides per machine.
 */
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

/** The canvas an aspect-only request lands on: 1024 on the short side, snapped and clamped. */
function snapDim(value: number): number {
    const snapped = Math.round(value / H3_DIM_STEP) * H3_DIM_STEP;
    return Math.min(H3_DIM_MAX, Math.max(H3_DIM_MIN, snapped));
}

/** True when both dimensions are canvases H3 can actually render. */
export function h3ExactSize(width: number, height: number): boolean {
    if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
    const legal = (value: number): boolean =>
        Number.isInteger(value) && value % H3_DIM_STEP === 0 && value >= H3_DIM_MIN && value <= H3_DIM_MAX;
    return legal(width) && legal(height);
}

/**
 * Translate an aspect-only request ("3:4", "21:9") into a legal H3 canvas. Returns null when the
 * ratio is missing or unparseable, so the caller can fall back to a square instead of guessing.
 */
export function h3Canvas(aspectRatio: string | undefined): { width: number; height: number } | null {
    const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspectRatio?.trim() ?? '');
    if (match === null) return null;
    const ratioWidth = Number(match[1]);
    const ratioHeight = Number(match[2]);
    if (!(ratioWidth > 0) || !(ratioHeight > 0)) return null;
    const height = snapDim(1024);
    return { width: snapDim((1024 * ratioWidth) / ratioHeight), height };
}

interface SpawnResult {
    stdout: string;
    stderr: string;
    code: number;
    timedOut: boolean;
}

function spawnWrapper(command: string, args: string[], timeoutMs: number): Promise<SpawnResult> {
    return new Promise((resolveSpawn, rejectSpawn) => {
        // Detached: a timeout must kill the wrapper AND the python runtime it spawned, or a
        // timed-out render keeps burning the GPU after the caller has moved on.
        const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            try {
                if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
            } catch {
                // The group is already gone (ESRCH) — nothing left to kill.
            }
        }, timeoutMs);
        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf8');
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf8');
        });
        child.on('error', (err) => {
            clearTimeout(timer);
            rejectSpawn(err);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            resolveSpawn({ stdout, stderr, code: code ?? 1, timedOut });
        });
    });
}

/** Keep thrown messages short but diagnostic: the tail is what a fallback reader needs. */
function stderrTail(text: string): string {
    const trimmed = text.trim();
    if (trimmed === '') return '';
    return `; ${trimmed.slice(-800)}`;
}

function positiveInt(value: string): number | null {
    if (value === '') return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export const createH3Local: ProviderFactory = (options?: ProviderOptions): ImageProvider => {
    const env = options?.env ?? process.env;
    const readEnv = (key: string): string => env[key] ?? '';
    const timeoutMs = options?.timeoutMs ?? positiveInt(readEnv('H3_LOCAL_TIMEOUT_MS')) ?? DEFAULT_TIMEOUT_MS;

    return {
        name: 'h3-local',
        defaultModel: () => DEFAULT_MODEL,
        // Env presence only: probing the venv, the weights or the external volume here would turn
        // a synchronous selection into a multi-second filesystem stall on every run.
        isAvailable: () => readEnv('H3_IMAGE_MLX_BIN') !== '',
        supportsReferenceImages: () => true,
        exactSize: (_model: string, width: number, height: number): boolean => h3ExactSize(width, height),
        validate(req: ImageRequest): void {
            if ((req.n ?? 1) > 1) {
                throw new Error('h3-local provider supports only n=1 (the wrapper renders one image per call).');
            }
        },
        async generate(req: ImageRequest): Promise<ImageResult> {
            const wrapper = readEnv('H3_IMAGE_MLX_BIN');
            if (wrapper === '') {
                throw new Error(
                    'h3-local provider requires H3_IMAGE_MLX_BIN pointing at an executable h3gen.sh (or set the provider explicitly with IMAGE_GEN_PROVIDER).',
                );
            }

            const canvas =
                req.width !== undefined && req.height !== undefined && h3ExactSize(req.width, req.height)
                    ? { width: req.width, height: req.height }
                    : (h3Canvas(req.aspectRatio) ?? { width: 1024, height: 1024 });

            const sessionDir = resolve(tmpdir(), 'kk-image-gen-h3-local');
            await mkdir(sessionDir, { recursive: true });
            const tmpOutput = resolve(sessionDir, `out-${randomBytes(8).toString('hex')}.png`);

            const args: string[] = [
                '--prompt',
                req.prompt,
                '--output',
                tmpOutput,
                '--width',
                String(canvas.width),
                '--height',
                String(canvas.height),
            ];
            for (const ref of req.referenceImages ?? []) {
                args.push('--reference', resolve(ref));
            }

            try {
                const spawnResult = await spawnWrapper(wrapper, args, timeoutMs);
                if (spawnResult.timedOut) {
                    throw new Error(
                        `h3-local wrapper timed out after ${timeoutMs}ms (${canvas.width}x${canvas.height})${stderrTail(spawnResult.stderr)}`,
                    );
                }
                if (spawnResult.code !== 0) {
                    throw new Error(
                        `h3-local wrapper exited with code ${spawnResult.code}${stderrTail(spawnResult.stderr)}`,
                    );
                }
                const bytes = await readBytes(tmpOutput).catch(() => null);
                if (bytes === null) {
                    throw new Error(
                        `h3-local wrapper wrote no output at ${tmpOutput}${stderrTail(spawnResult.stderr)}`,
                    );
                }
                return { bytes, extension: 'png', provider: 'h3-local', model: req.model };
            } finally {
                await rm(tmpOutput, { force: true }).catch(() => undefined);
            }
        },
    };
};
