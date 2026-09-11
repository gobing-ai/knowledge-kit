import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { ImageProvider, ImageRequest, ImageResult, ProviderFactory, ProviderOptions } from './types';

/**
 * codex-cli adapter (0115 R1) — port of
 * vendors/baoyu-skills/skills/baoyu-image-gen/scripts/providers/codex-cli.ts
 * (MIT © 2026 Jim Liu). Never auto-selected (frozen NEVER_AUTO rule): readiness is
 * the 'codex' CLI login, not an env fact, so isAvailable() stays false.
 */

const DEFAULT_MODEL = 'codex-image-gen';

type WrapperOkResult = {
    status: 'ok';
    path?: string;
};

type WrapperErrorResult = {
    status: 'error';
    error: string;
    error_kind: string;
};

type WrapperResult = WrapperOkResult | WrapperErrorResult;

async function exists(filePath: string): Promise<boolean> {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Wrapper resolution keeps the baoyu env-override channel verbatim, including the
 * inherited variable names (0115 straight port; kk has no bundled codex wrapper,
 * so the override is the only supported location).
 */
export async function resolveWrapperPath(readEnv: (key: string) => string): Promise<string> {
    const override = readEnv('BAOYU_CODEX_IMAGEGEN_BIN');
    if (override.length > 0) {
        if (!(await exists(override))) {
            throw new Error(`Invalid BAOYU_CODEX_IMAGEGEN_BIN: ${override} does not exist.`);
        }
        return override;
    }
    throw new Error(
        'codex-cli wrapper not found. Set BAOYU_CODEX_IMAGEGEN_BIN to a codex-imagegen main.ts (or .sh) path.',
    );
}

type SpawnResult = { stdout: string; stderr: string; code: number };

function spawnWrapper(wrapperPath: string, cliArgs: string[]): Promise<SpawnResult> {
    return new Promise((resolveSpawn, rejectSpawn) => {
        const isTs = wrapperPath.endsWith('.ts');
        const command = isTs ? 'bun' : wrapperPath;
        const args = isTs ? [wrapperPath, ...cliArgs] : cliArgs;
        const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf8');
        });
        child.stderr.on('data', (chunk: Buffer) => {
            const text = chunk.toString('utf8');
            stderr += text;
            process.stderr.write(text);
        });
        child.on('error', (err) => rejectSpawn(err));
        child.on('close', (code) => resolveSpawn({ stdout, stderr, code: code ?? 1 }));
    });
}

function parseWrapperJson(stdout: string): WrapperResult {
    const trimmed = stdout.trim();
    if (trimmed === '') throw new Error('Invalid codex-cli response: empty stdout from wrapper.');
    const lastLine = trimmed.split(/\r?\n/).pop() ?? trimmed;
    try {
        return JSON.parse(lastLine) as WrapperResult;
    } catch (parseErr: unknown) {
        throw new Error(
            `Invalid codex-cli response: could not parse JSON from wrapper stdout (${parseErr instanceof Error ? parseErr.message : String(parseErr)}).`,
        );
    }
}

function parsePositiveInt(value: string): number | null {
    if (value === '') return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export const createCodexCli: ProviderFactory = (options?: ProviderOptions): ImageProvider => {
    const env = options?.env ?? process.env;
    const readEnv = (key: string): string => env[key] ?? '';

    return {
        name: 'codex-cli',
        defaultModel: () => DEFAULT_MODEL,
        isAvailable: () => false,
        supportsReferenceImages: () => true,
        validate(req: ImageRequest): void {
            if ((req.n ?? 1) > 1) {
                throw new Error(
                    'codex-cli provider supports only n=1 (Codex image_gen returns a single image per call).',
                );
            }
        },
        async generate(req: ImageRequest): Promise<ImageResult> {
            const wrapperPath = await resolveWrapperPath(readEnv);

            const sessionDir = resolve(tmpdir(), 'kk-image-gen-codex-cli');
            await mkdir(sessionDir, { recursive: true });
            const token = randomBytes(8).toString('hex');
            const tmpOutput = resolve(sessionDir, `out-${token}.png`);
            const tmpPrompt = resolve(sessionDir, `prompt-${token}.md`);
            await writeFile(tmpPrompt, req.prompt, 'utf8');

            const cliArgs: string[] = [
                '--image',
                tmpOutput,
                '--prompt-file',
                tmpPrompt,
                '--aspect',
                req.aspectRatio ?? '1:1',
            ];
            for (const ref of req.referenceImages ?? []) {
                cliArgs.push('--ref', resolve(ref));
            }

            const cacheDir = readEnv('BAOYU_CODEX_IMAGEGEN_CACHE_DIR');
            if (cacheDir !== '') cliArgs.push('--cache-dir', cacheDir);
            const timeoutMs = parsePositiveInt(readEnv('BAOYU_CODEX_IMAGEGEN_TIMEOUT_MS'));
            if (timeoutMs !== null) cliArgs.push('--timeout', String(timeoutMs));
            const retries = parsePositiveInt(readEnv('BAOYU_CODEX_IMAGEGEN_RETRIES'));
            if (retries !== null) cliArgs.push('--retries', String(retries));
            const logFile = readEnv('BAOYU_CODEX_IMAGEGEN_LOG_FILE');
            if (logFile !== '') cliArgs.push('--log-file', logFile);

            try {
                const spawnResult = await spawnWrapper(wrapperPath, cliArgs);
                const parsed = parseWrapperJson(spawnResult.stdout);
                if (parsed.status === 'error') {
                    throw new Error(`Invalid codex-cli result (${parsed.error_kind}): ${parsed.error}`);
                }
                if (spawnResult.code !== 0) {
                    throw new Error(
                        `Invalid codex-cli result: wrapper exited with code ${spawnResult.code} despite reporting status=ok.`,
                    );
                }
                const bytes = await readFile(parsed.path ?? tmpOutput);
                return { bytes: new Uint8Array(bytes), extension: 'png', provider: 'codex-cli', model: req.model };
            } finally {
                await Promise.allSettled([rm(tmpOutput, { force: true }), rm(tmpPrompt, { force: true })]);
            }
        },
    };
};
