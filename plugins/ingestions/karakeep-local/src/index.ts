import { createHash } from 'node:crypto';
import { dirname, relative } from 'node:path';
import { parseArgs } from 'node:util';
import type { Doc } from '@gobing-ai/kk-core';
import { getLogger, initializeLogger } from '@gobing-ai/ts-infra';
import { createNodeFileSystem, walkDir } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';

const log = getLogger('kk.ingestion.karakeep-local');

interface ParsedMeta {
    title?: string;
    sourceUri?: string;
    mediaType?: string;
    body?: string;
    [key: string]: unknown;
}

function computeHash(str: string): string {
    return createHash('sha256').update(str).digest('hex').slice(0, 16);
}

async function collectFiles(dir: string): Promise<string[]> {
    // walkDir is cycle-safe and root-confined: a directory symlink pointing back at
    // an ancestor is walked at most once, and one escaping `dir` is skipped.
    return (await walkDir(dir, createNodeFileSystem())).sort();
}

export async function processKarakeepFolder(inDir: string): Promise<Doc[]> {
    const fs = createNodeFileSystem();
    try {
        // The FileSystem seam returns null for a missing path where node's stat throws;
        // both cases must still surface as "Inaccessible source path" below.
        const inStat = await fs.stat(inDir);
        if (inStat === null) {
            throw new Error(`Source path does not exist: ${inDir}`);
        }
        if (!inStat.isDirectory()) {
            throw new Error(`Source path is not a directory: ${inDir}`);
        }
    } catch (err: unknown) {
        const msg = `Inaccessible source path: ${inDir}`;
        echoError(`Error: ${msg}`);
        throw new Error(msg, { cause: err });
    }

    const files = await collectFiles(inDir);
    const docs: Doc[] = [];

    // Group files by parent directory to handle paired content.md + meta.json
    const dirMap = new Map<string, string[]>();
    for (const f of files) {
        const rel = relative(inDir, f);
        const parent = dirname(rel);
        const existing = dirMap.get(parent) ?? [];
        existing.push(f);
        dirMap.set(parent, existing);
    }

    const processedFiles = new Set<string>();

    for (const [parentDir, groupFiles] of dirMap.entries()) {
        const contentMd = groupFiles.find((f) => f.endsWith('/content.md') || f.endsWith('content.md'));
        const metaJson = groupFiles.find((f) => f.endsWith('/meta.json') || f.endsWith('meta.json'));

        if (contentMd) {
            processedFiles.add(contentMd);
            const mdText = await fs.readFile(contentMd);
            let metaObj: ParsedMeta = {};
            if (metaJson) {
                processedFiles.add(metaJson);
                try {
                    metaObj = JSON.parse(await fs.readFile(metaJson)) as ParsedMeta;
                } catch (err: unknown) {
                    log.warn(`Warning: corrupt/unparsable meta file at ${metaJson}`, { error: err });
                }
            }

            const relPath = relative(inDir, contentMd);
            const id = computeHash(relPath);
            const { title, sourceUri, mediaType, body: metaBody, ...extraMeta } = metaObj;

            docs.push({
                id,
                body: mdText,
                title: title ?? (parentDir !== '.' ? parentDir : 'Untitled Doc'),
                sourceUri: sourceUri ?? undefined,
                mediaType: mediaType ?? 'text/markdown',
                metadata: Object.keys(extraMeta).length > 0 ? extraMeta : undefined,
            });
        }
    }

    // Process remaining JSON or Markdown files not part of a folder pair
    for (const f of files) {
        if (processedFiles.has(f)) {
            continue;
        }

        const relPath = relative(inDir, f);
        const id = computeHash(relPath);

        if (f.endsWith('.json')) {
            try {
                const jsonText = await fs.readFile(f);
                const jsonObj = JSON.parse(jsonText) as ParsedMeta;
                const { title, sourceUri, mediaType, body, ...extraMeta } = jsonObj;
                if (typeof body === 'string') {
                    docs.push({
                        id,
                        body,
                        title: title ?? relPath,
                        sourceUri: sourceUri ?? undefined,
                        mediaType: mediaType ?? 'application/json',
                        metadata: Object.keys(extraMeta).length > 0 ? extraMeta : undefined,
                    });
                } else {
                    log.warn(`Warning: JSON entry missing string body at ${f}`);
                }
            } catch (err: unknown) {
                log.warn(`Warning: corrupt/unparsable JSON file at ${f}`, { error: err });
            }
        } else if (f.endsWith('.md')) {
            const mdText = await fs.readFile(f);
            docs.push({
                id,
                body: mdText,
                title: relPath,
                mediaType: 'text/markdown',
            });
        }
    }

    return docs;
}

export async function main() {
    const { values } = parseArgs({
        options: {
            in: { type: 'string' },
            out: { type: 'string' },
        },
    });

    if (!values.in || !values.out) {
        echoError('Error: Missing required arguments --in or --out');
        process.exit(1);
    }

    const fs = createNodeFileSystem();
    try {
        const candidateFiles = await collectFiles(values.in);
        const docs = await processKarakeepFolder(values.in);

        if (docs.length === 0 && candidateFiles.length > 0) {
            echoError(`Fatal: source yielded zero ingestible documents at ${values.in}`);
            process.exit(1);
        }

        const outDir = dirname(values.out);
        if (outDir && outDir !== '.') {
            await fs.ensureDir(outDir);
        }

        await fs.writeFile(values.out, JSON.stringify(docs, null, 2));
    } catch (err: unknown) {
        echoError(`Fatal error during karakeep-local ingestion: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
}

if (import.meta.main) {
    await initializeLogger({ console: process.env.NODE_ENV !== 'test', json: true, level: 'warn' });
    main();
}
