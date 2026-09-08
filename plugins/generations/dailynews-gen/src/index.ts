import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Doc, DocListSchema } from '@gobing-ai/kk-core';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import { buildNewsVoiceScript, formatVoiceScriptToYaml, type ScriptBuilderOptions } from './script-builder';

export * from './script-builder';

export interface GeneratorOptions extends ScriptBuilderOptions {
    in: string;
    out: string;
}

export async function processGeneratorIO(
    inputPath: string,
    outputPath: string,
    options?: ScriptBuilderOptions,
): Promise<Content> {
    const fs = createNodeFileSystem();

    let docs: Doc[];
    try {
        const rawInput = await fs.readFile(inputPath);
        docs = DocListSchema.parse(JSON.parse(rawInput));
    } catch (err: unknown) {
        throw new Error(`Invalid DocList input: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Optional story cap (daily pipeline: the blend carries 50+ docs; a broadcast needs a bound).
    // Input order is curated-first (fan-in first-seen), so a head-cap keeps the best items.
    const maxItemsEnv = process.env.DAILYNEWS_MAX_ITEMS;
    if (maxItemsEnv) {
        const maxItems = Number.parseInt(maxItemsEnv, 10);
        if (Number.isInteger(maxItems) && maxItems > 0 && docs.length > maxItems) {
            echoError(`dailynews-gen: capping ${docs.length} docs to ${maxItems} (DAILYNEWS_MAX_ITEMS)`);
            docs = docs.slice(0, maxItems);
        }
    }

    const script = buildNewsVoiceScript(docs, options);
    const yamlBody = formatVoiceScriptToYaml(script);

    const content: Content = {
        title: script.title,
        body: yamlBody,
        format: 'markdown',
        references: docs
            .filter((d) => d.sourceUri)
            .map((d) => ({
                title: d.title,
                url: d.sourceUri,
            })),
        metadata: {
            generator: 'kk:dailynews-gen',
            language: script.language,
            voiceProfile: script.default_profile,
            storyCount: docs.length,
            stories: docs.map((d) => ({
                id: d.id,
                title: d.title,
                sourceUri: d.sourceUri,
            })),
        },
    };

    const validatedContent = ContentSchema.parse(content);

    const outDir = dirname(outputPath);
    if (outDir && outDir !== '.') {
        await fs.ensureDir(outDir);
    }
    await fs.writeFile(outputPath, JSON.stringify(validatedContent, null, 2));

    return validatedContent;
}

export async function main(): Promise<number> {
    let values: {
        in?: string;
        out?: string;
        language?: string;
        title?: string;
        'voice-profile'?: string;
    };

    try {
        ({ values } = parseArgs({
            options: {
                in: { type: 'string' },
                out: { type: 'string' },
                language: { type: 'string' },
                title: { type: 'string' },
                'voice-profile': { type: 'string' },
            },
        }));
    } catch (err: unknown) {
        echoError(`dailynews-gen failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }

    if (!values.in || !values.out) {
        echoError('dailynews-gen failed: Missing required arguments: --in and --out');
        return 1;
    }

    try {
        await processGeneratorIO(values.in, values.out, {
            language: values.language || process.env.DAILYNEWS_LANGUAGE,
            title: values.title || process.env.DAILYNEWS_TITLE,
            voiceProfile: values['voice-profile'] || process.env.VOICEBOX_DEFAULT_PROFILE,
        });
        return 0;
    } catch (err: unknown) {
        echoError(`dailynews-gen failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
