import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import type { Doc } from '@gobing-ai/kk-core';

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
    const entries = await readdir(dir, { recursive: true });
    const files: string[] = [];
    for (const entry of entries) {
        const fullPath = join(dir, entry);
        const st = await stat(fullPath);
        if (st.isFile()) {
            files.push(fullPath);
        }
    }
    return files.sort();
}

export async function processKarakeepFolder(inDir: string): Promise<Doc[]> {
    try {
        const inStat = await stat(inDir);
        if (!inStat.isDirectory()) {
            throw new Error(`Source path is not a directory: ${inDir}`);
        }
    } catch (err: unknown) {
        const msg = `Inaccessible source path: ${inDir}`;
        console.error(`Error: ${msg}`, err);
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
            const mdText = await readFile(contentMd, 'utf-8');
            let metaObj: ParsedMeta = {};
            if (metaJson) {
                processedFiles.add(metaJson);
                try {
                    metaObj = JSON.parse(await readFile(metaJson, 'utf-8')) as ParsedMeta;
                } catch (err: unknown) {
                    console.error(`Warning: corrupt/unparsable meta file at ${metaJson}`, err);
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
                const jsonText = await readFile(f, 'utf-8');
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
                    console.error(`Warning: JSON entry missing string body at ${f}`);
                }
            } catch (err: unknown) {
                console.error(`Warning: corrupt/unparsable JSON file at ${f}`, err);
            }
        } else if (f.endsWith('.md')) {
            const mdText = await readFile(f, 'utf-8');
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
        console.error('Error: Missing required arguments --in or --out');
        process.exit(1);
    }

    try {
        const docs = await processKarakeepFolder(values.in);
        await writeFile(values.out, JSON.stringify(docs, null, 2), 'utf-8');
    } catch (err: unknown) {
        console.error('Fatal error during karakeep-local ingestion:', err);
        process.exit(1);
    }
}

if (import.meta.main) {
    main();
}
