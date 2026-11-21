import { parseArgs } from 'node:util';
import { echoError } from '@gobing-ai/ts-utils';
import { processGeneratorIO } from '@gobing-ai/voice-gen';
import { createVoxCpmClient, VOXCPM_TTS_GENERATOR, type VoxCpmClientOptions } from './voxcpm-client';

export * from './voxcpm-client';

interface BatchManifestEntry {
    in: string;
    out: string;
}

/**
 * `kk` plugin entry: render Doc[] into audio Content through the shared voice-gen pipeline,
 * injecting the invocation-scoped VoxCPM adapter and closing it (worker, signals, scratch) in
 * `finally`. The worker stays lazy until `health()` runs after shared Doc validation, so empty
 * input starts nothing (AC3).
 *
 * When `VOXCPM_BATCH_MANIFEST` (or `--batch <path>`) is set, renders every `{ in, out }` entry
 * sequentially against one shared worker handle so the model loads at most once per episode.
 */
export async function main(argv: string[] = process.argv.slice(2), options: VoxCpmClientOptions = {}): Promise<number> {
    const { values } = parseArgs({
        args: argv,
        options: {
            in: { type: 'string' },
            out: { type: 'string' },
            batch: { type: 'string' },
        },
    });

    const env = options.env ?? (process.env as Record<string, string | undefined>);
    const batchPath = values.batch ?? env.VOXCPM_BATCH_MANIFEST;

    if (batchPath) {
        let entries: BatchManifestEntry[];
        try {
            const parsed = JSON.parse(await Bun.file(batchPath).text()) as unknown;
            if (
                !Array.isArray(parsed) ||
                parsed.some((e) => !e || typeof e !== 'object' || typeof e.in !== 'string' || typeof e.out !== 'string')
            ) {
                throw new Error('batch manifest must be an array of { in, out } string pairs');
            }
            entries = parsed as BatchManifestEntry[];
        } catch (err: unknown) {
            echoError(`voxcpm-tts failed: invalid batch manifest: ${err instanceof Error ? err.message : String(err)}`);
            return 1;
        }
        const handle = createVoxCpmClient(options);
        try {
            for (const entry of entries) {
                await processGeneratorIO(entry.in, entry.out, handle.client, undefined, VOXCPM_TTS_GENERATOR);
            }
            return 0;
        } catch (err: unknown) {
            echoError(`voxcpm-tts failed: ${err instanceof Error ? err.message : String(err)}`);
            return 1;
        } finally {
            await handle.close();
        }
    }

    if (!values.in || !values.out) {
        echoError('voxcpm-tts failed: Missing required arguments: --in and --out');
        return 1;
    }

    const handle = createVoxCpmClient(options);
    try {
        await processGeneratorIO(values.in, values.out, handle.client, undefined, VOXCPM_TTS_GENERATOR);
        return 0;
    } catch (err: unknown) {
        echoError(`voxcpm-tts failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    } finally {
        await handle.close();
    }
}

if (import.meta.main) {
    process.exit(await main());
}
