import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Result, ResultSchema } from '@gobing-ai/kk-core';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import { YouTubeClient, type YouTubeClientOptions } from './youtube-client';

export * from './credentials';
export * from './youtube-client';

/** Where the Result JSON is written next to `--out`. */
async function writeResult(outputPath: string, result: Result): Promise<void> {
    await createNodeFileSystem().writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
}

/**
 * The plugin's `--in/--out` contract: parse the Content, then let the client's refusal ladder decide
 * (a refusal is written as `ok:false` AND thrown, so `kk publish` exits nonzero without a second
 * message shape).
 */
export async function processPublishIO(
    inputPath: string,
    outputPath: string,
    options: YouTubeClientOptions = {},
): Promise<void> {
    const fs = createNodeFileSystem();
    await fs.deleteFile(outputPath);
    let content: Content;
    let publishOptions: Record<string, unknown> | undefined;
    try {
        const raw = JSON.parse(await fs.readFile(inputPath)) as Record<string, unknown>;
        content = ContentSchema.parse(raw);
        if (typeof raw.options === 'object' && raw.options !== null) {
            publishOptions = raw.options as Record<string, unknown>;
        }
    } catch (error: unknown) {
        const message = `Invalid Content input: ${error instanceof Error ? error.message : String(error)}`;
        await writeResult(outputPath, ResultSchema.parse({ ok: false, target: 'youtube-pub', error: message }));
        throw new Error(message);
    }

    const result = ResultSchema.parse(await new YouTubeClient(options).publish(content, publishOptions));
    await writeResult(outputPath, result);
    if (!result.ok) throw new Error(result.error ?? 'Publish failed');
}

/**
 * CLI entry point: `--in <content.json> --out <result.json>`.
 * @param argv - Arguments after the plugin name (`--in`, `--out`).
 * @param options - Client seam for tests; production passes nothing and resolves the real edges.
 * @returns Process exit code (0 uploaded, 1 refused or invalid arguments).
 */
export async function main(
    argv: string[] = process.argv.slice(2),
    options: YouTubeClientOptions = {},
): Promise<number> {
    let values: { in?: string; out?: string };
    try {
        ({ values } = parseArgs({ args: argv, options: { in: { type: 'string' }, out: { type: 'string' } } }));
    } catch (error: unknown) {
        echoError(`Invalid arguments: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
    if (!values.in || !values.out) {
        echoError('Missing required arguments: --in and --out');
        return 1;
    }
    try {
        await processPublishIO(values.in, values.out, options);
        return 0;
    } catch (error: unknown) {
        echoError(error instanceof Error ? error.message : String(error));
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
