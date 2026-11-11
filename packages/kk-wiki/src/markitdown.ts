import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import {
    createNodeFileSystem,
    type FileSystem,
    NodeProcessExecutor,
    type ProcessExecutor,
} from '@gobing-ai/ts-runtime';

/**
 * MarkItDown normaliser seam (ADR-013 D3 pattern, reused by `kk wiki ingest`).
 *
 * The repository already picked this converter for the web-search ingestion plugin; this module
 * mirrors it behind an injectable runner so tests never depend on the binary being installed.
 * Process and file access go through the ts-runtime seams — direct `Bun.spawn` / `node:fs` use is
 * forbidden by the project's constraint rules.
 */

export type NormalizerKind = 'html' | 'pdf' | 'url';

/** One conversion request: the kind, its target path/URL, and the html body when relevant. */
export interface NormalizerInput {
    kind: NormalizerKind;
    /** File path or URL of the source; the HTML body travels separately. */
    target: string;
    /** Source text for `kind: 'html'` (written to a temp file: markitdown takes a path, not stdin here). */
    body?: string;
}

/** Converts one source into markdown. Throws `MissingNormalizerError` when the tool is absent. */
export type MarkitdownRunner = (input: NormalizerInput) => Promise<string>;

/** The normaliser binary is not on PATH — a handled failure (exit 1), never a silent empty body. */
export class MissingNormalizerError extends Error {
    constructor(readonly binary: string) {
        super(`missing normaliser '${binary}': install it (\`uv tool install markitdown\`) or pass markdown on stdin`);
        this.name = 'MissingNormalizerError';
    }
}

/** Runner wiring: binary override, process executor, file-system seam and per-call timeout. */
export interface MarkitdownRunnerOptions {
    binary?: string;
    executor?: ProcessExecutor;
    fileSystem?: FileSystem;
    /** Timeout for one conversion; a hung converter must not hang a batch. */
    timeoutMs?: number;
}

/** Resolve the executable: an explicit path wins, otherwise an explicit-PATH lookup. */
function resolveBinary(binary: string): string {
    if (isAbsolute(binary) || binary.includes('/')) return binary;
    const found = Bun.which(binary, { PATH: process.env.PATH });
    if (found === null) throw new MissingNormalizerError(binary);
    return found;
}

/**
 * Real runner: `markitdown <file>`, markdown on stdout.
 *
 * An HTML body is written to a temp file first — that is what makes `-x`-style hinting
 * unnecessary and keeps the call a plain file conversion. The temp file is always removed.
 */
export function createMarkitdownRunner(options: MarkitdownRunnerOptions = {}): MarkitdownRunner {
    const binary = options.binary ?? 'markitdown';
    const executor = options.executor ?? new NodeProcessExecutor();
    const fs = options.fileSystem ?? createNodeFileSystem();
    const timeoutMs = options.timeoutMs ?? 120_000;

    return async (input) => {
        const executable = resolveBinary(binary);
        let tempPath: string | undefined;
        let target = input.target;
        if (input.kind === 'html') {
            const id = createHash('sha256')
                .update(input.body ?? '')
                .digest('hex')
                .slice(0, 12);
            tempPath = join(tmpdir(), `kk-wiki-${id}.html`);
            await fs.writeFile(tempPath, input.body ?? '');
            target = tempPath;
        }
        try {
            const result = await executor.run({ command: executable, args: [target], timeout: timeoutMs });
            if (result.exitCode !== 0) {
                const last = result.stderr.trim().split('\n').slice(-1)[0] ?? 'unknown error';
                throw new Error(`${binary} exited ${result.exitCode}: ${last}`);
            }
            if (result.stdout.trim() === '') {
                throw new Error(`${binary} produced an empty body for ${input.target}`);
            }
            return result.stdout;
        } finally {
            if (tempPath !== undefined && (await fs.exists(tempPath))) await fs.deleteFile(tempPath);
        }
    };
}
