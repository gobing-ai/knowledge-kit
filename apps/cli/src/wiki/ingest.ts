import { extname, isAbsolute, join } from 'node:path';
import {
    createMarkitdownRunner,
    deriveTitle,
    type MarkitdownRunner,
    MissingNormalizerError,
    RAW_SOURCE_TYPES,
    type RawSourceType,
    writeRawSnapshot,
} from '@gobing-ai/kk-wiki';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { resolveWikiConfig, WikiConfigError } from './config';

/**
 * `kk wiki ingest <source|-> [--type=url|pdf|html|rss] [--out <dir>] [--json]` (task 0350).
 *
 * Exit contract: 0 success, 1 handled failure (JSON `error`), 2 usage error. The module never
 * terminates the process — `commands/wiki.ts` maps the returned code onto a `CommanderError`.
 */

export interface IngestArgs {
    source: string;
    type?: string;
    out?: string;
    json?: boolean;
}

/** Injectable seams for one ingest run (cwd, env, fs, normaliser, stdin reader). */
export interface IngestDeps {
    cwd?: string;
    fileSystem?: FileSystem;
    env?: Record<string, string | undefined>;
    markitdown?: MarkitdownRunner;
    /** Body reader for `-`; defaults to stdin. */
    readStdin?: () => Promise<string>;
}

/** Result of one ingest: the written snapshot, or the error and the exit code it maps to. */
export type IngestOutcome =
    | { ok: true; code: 0; payload: { path: string; id: string; type: RawSourceType; title: string } }
    | { ok: false; code: 1 | 2; payload: { error: string } };

const EXTENSION_TYPES: Record<string, RawSourceType> = {
    '.html': 'html',
    '.htm': 'html',
    '.pdf': 'pdf',
};

/** Extension/scheme detection. `-` and extensions outside the map resolve to `undefined`. */
export function detectSourceType(source: string): RawSourceType | undefined {
    if (/^https?:\/\//i.test(source)) return 'url';
    return EXTENSION_TYPES[extname(source).toLowerCase()];
}

function asSourceType(raw: string): RawSourceType | undefined {
    return (RAW_SOURCE_TYPES as readonly string[]).includes(raw) ? (raw as RawSourceType) : undefined;
}

/**
 * Drain a byte stream into text. Exported with a default so the real stdin path and a test's fake
 * stream share one implementation (`Bun.stdin` cannot be fed from an in-process test).
 */
export async function readStdin(stream: AsyncIterable<Uint8Array> = Bun.stdin.stream()): Promise<string> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
}

/**
 * Run one ingest. `source` is a path, an http(s) URL, or `-` for stdin; `type` overrides detection.
 */
export async function runIngest(args: IngestArgs, deps: IngestDeps = {}): Promise<IngestOutcome> {
    const explicit = args.type === undefined ? undefined : asSourceType(args.type);
    if (args.type !== undefined && explicit === undefined) {
        return {
            ok: false,
            code: 2,
            payload: { error: `unsupported --type '${args.type}' (want ${RAW_SOURCE_TYPES.join('|')})` },
        };
    }

    const fromStdin = args.source === '-';
    const detected = explicit ?? (fromStdin ? undefined : detectSourceType(args.source));
    if (detected === undefined) {
        const what = fromStdin ? 'stdin requires --type' : `unsupported source type for '${args.source}'`;
        return { ok: false, code: 2, payload: { error: `${what} (want ${RAW_SOURCE_TYPES.join('|')})` } };
    }

    let config: Awaited<ReturnType<typeof resolveWikiConfig>>;
    try {
        config = await resolveWikiConfig({ cwd: deps.cwd, env: deps.env, overrides: { raw: args.out } });
    } catch (error) {
        if (error instanceof WikiConfigError) return { ok: false, code: 1, payload: { error: error.message } };
        throw error;
    }

    const fs = deps.fileSystem ?? createNodeFileSystem();
    const readStdinFn = deps.readStdin ?? readStdin;
    const normalise = deps.markitdown ?? createMarkitdownRunner();
    // Relative sources resolve against the invocation cwd, not the process cwd, so an injected
    // cwd behaves the same as a real `kk` run from that directory.
    const sourcePath = isAbsolute(args.source) ? args.source : join(deps.cwd ?? process.cwd(), args.source);

    let sourceText: string;
    try {
        if (fromStdin) {
            sourceText = await readStdinFn();
        } else if (detected === 'rss') {
            sourceText = await fs.readFile(sourcePath);
        } else {
            sourceText = await normalise({
                kind: detected,
                target: sourcePath,
                body: detected === 'html' ? await fs.readFile(sourcePath) : undefined,
            });
        }
    } catch (error) {
        if (error instanceof MissingNormalizerError) return { ok: false, code: 1, payload: { error: error.message } };
        const detail = error instanceof Error ? error.message : String(error);
        return { ok: false, code: 1, payload: { error: `ingest failed for '${args.source}': ${detail}` } };
    }

    const sourceUri = fromStdin ? 'stdin' : args.source;
    const snapshot = await writeRawSnapshot(
        {
            type: detected,
            sourceUri,
            title: deriveTitle(sourceText, sourceUri),
            body: sourceText,
            dir: config.raw,
        },
        fs,
    );
    return {
        ok: true,
        code: 0,
        payload: { path: snapshot.path, id: snapshot.id, type: snapshot.type, title: snapshot.title },
    };
}
