import { readFile, rm, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Doc, DocListSchema } from '@gobing-ai/kk-core';
import { echoError } from '@gobing-ai/ts-utils';
import { generateWithStormPipeline } from './storm';

type ContentGenerator = (docs: Doc[], inputPath: string) => Promise<Content>;

const EMPTY_CONTENT: Content = {
    title: 'Notice',
    body: '# Notice\nNo documents provided for generation.',
    format: 'markdown',
    references: [],
};

/** Read validated Doc[] input, generate validated Content, and write it atomically from the caller's perspective. */
export async function processGeneratorIO(
    inputPath: string,
    outputPath: string,
    generate: ContentGenerator = generateWithStormPipeline,
): Promise<void> {
    await rm(outputPath, { force: true });
    const docs = DocListSchema.parse(JSON.parse(await readFile(inputPath, 'utf-8')));
    const content = docs.length === 0 ? EMPTY_CONTENT : ContentSchema.parse(await generate(docs, inputPath));
    await writeFile(outputPath, JSON.stringify(content, null, 2), 'utf-8');
}

export async function main(): Promise<number> {
    const { values } = parseArgs({
        options: {
            in: { type: 'string' },
            out: { type: 'string' },
        },
    });
    if (!values.in || !values.out) {
        echoError('Missing required arguments: --in and --out');
        return 1;
    }

    try {
        await processGeneratorIO(values.in, values.out);
        return 0;
    } catch (error: unknown) {
        echoError(`content-gen failed: ${error instanceof Error ? error.message : String(error)}`);
        await rm(values.out, { force: true });
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
