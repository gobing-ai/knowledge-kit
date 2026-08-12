import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Doc, DocListSchema } from '@gobing-ai/kk-core';
import { logger } from '@gobing-ai/utils';

/** One provenance entry per originating source file (spec §2.2). */
export interface SourceEntry {
    file: string;
    sourceUri?: string;
}

/** Parsed `kk fanin` CLI arguments. */
export interface FaninOptions {
    inPaths: string[];
    outPath: string;
}

/** Exit code for CLI usage errors (missing/unknown flags). */
const EXIT_USAGE = 2;
/** Exit code for input/output file errors (missing, unreadable, invalid). */
const EXIT_INPUT = 1;

/**
 * Merge N Doc lists into one deduplicated Doc list (spec §2).
 *
 * Dedupe identity is the Doc `id`; the first-seen document wins and later
 * duplicates contribute only their provenance source. `metadata.sources` is
 * built in input order, and documents keep first-appearance order. Inputs
 * are never mutated; each merged doc is a fresh copy.
 */
export function mergeDocLists(inputs: Doc[][], sources: string[]): Doc[] {
    const merged: Doc[] = [];
    const byId = new Map<string, Doc>();

    for (const [i, docList] of inputs.entries()) {
        const file = sources[i] ?? `input[${i}]`;
        for (const doc of docList) {
            const entry: SourceEntry = { file };
            if (doc.sourceUri !== undefined) {
                entry.sourceUri = doc.sourceUri;
            }

            const existing = byId.get(doc.id);
            if (existing) {
                const list = existing.metadata?.sources;
                if (Array.isArray(list)) {
                    list.push(entry);
                }
                continue;
            }

            const mergedDoc: Doc = {
                ...doc,
                metadata: { ...(doc.metadata ?? {}), sources: [entry] },
            };
            byId.set(doc.id, mergedDoc);
            merged.push(mergedDoc);
        }
    }

    return merged;
}

/**
 * Read one `--in` file as a `Doc[]`.
 * @returns the parsed doc list, or null (with a file-naming error logged) on failure
 */
function readDocList(path: string): Doc[] | null {
    if (!existsSync(path)) {
        logger.error(`Input file does not exist: ${path}`);
        return null;
    }

    let content: string;
    try {
        content = readFileSync(path, 'utf-8');
    } catch (err: unknown) {
        logger.error(`Failed to read input file ${path}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }

    let json: unknown;
    try {
        json = JSON.parse(content);
    } catch (err: unknown) {
        logger.error(`Input file ${path} is invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }

    const result = DocListSchema.safeParse(json);
    if (!result.success) {
        const issues = result.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ');
        logger.error(`Input file ${path} violates the Doc list schema: ${issues}`);
        return null;
    }

    return result.data;
}

/** Parse `--in <path>` (repeatable) and `--out <path>` from an argv slice. */
function parseArgs(argv: string[]): FaninOptions {
    const inPaths: string[] = [];
    let outPath: string | undefined;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--in') {
            const value = argv[++i];
            if (value === undefined) {
                throw new Error('--in requires a file path');
            }
            inPaths.push(value);
        } else if (arg === '--out') {
            const value = argv[++i];
            if (value === undefined) {
                throw new Error('--out requires a file path');
            }
            if (outPath !== undefined) {
                throw new Error('--out may be specified only once');
            }
            outPath = value;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (inPaths.length === 0) {
        throw new Error('at least one --in file is required');
    }
    if (outPath === undefined) {
        throw new Error('--out file is required');
    }

    return { inPaths, outPath };
}

/**
 * Run the `kk fanin` CLI handler.
 * @param argv `--in <path> [--in <path> ...] --out <path>` (no subcommand name)
 * @returns exit code: 0 success, 1 file error, 2 usage error
 */
export async function runFanin(argv: string[]): Promise<number> {
    let opts: FaninOptions;
    try {
        opts = parseArgs(argv);
    } catch (err: unknown) {
        logger.error(`fanin: ${err instanceof Error ? err.message : String(err)}`);
        return EXIT_USAGE;
    }

    const inputs: Doc[][] = [];
    const sources: string[] = [];
    for (const inPath of opts.inPaths) {
        const docList = readDocList(inPath);
        if (docList === null) {
            return EXIT_INPUT;
        }
        inputs.push(docList);
        sources.push(inPath);
    }

    const merged = mergeDocLists(inputs, sources);
    try {
        writeFileSync(resolve(opts.outPath), `${JSON.stringify(merged, null, 2)}\n`);
    } catch (err: unknown) {
        logger.error(
            `Failed to write output file ${resolve(opts.outPath)}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return EXIT_INPUT;
    }

    return 0;
}
