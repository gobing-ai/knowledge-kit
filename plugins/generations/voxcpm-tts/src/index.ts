import { parseArgs } from 'node:util';
import { echoError } from '@gobing-ai/ts-utils';
import { processGeneratorIO } from '@gobing-ai/voice-gen';
import { createVoxCpmClient, VOXCPM_TTS_GENERATOR, type VoxCpmClientOptions } from './voxcpm-client';

export * from './voxcpm-client';

/**
 * `kk` plugin entry: render Doc[] into audio Content through the shared voice-gen pipeline,
 * injecting the invocation-scoped VoxCPM adapter and closing it (worker, signals, scratch) in
 * `finally`. The worker stays lazy until `health()` runs after shared Doc validation, so empty
 * input starts nothing (AC3).
 */
export async function main(argv: string[] = process.argv.slice(2), options: VoxCpmClientOptions = {}): Promise<number> {
    const { values } = parseArgs({
        args: argv,
        options: {
            in: { type: 'string' },
            out: { type: 'string' },
        },
    });

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
