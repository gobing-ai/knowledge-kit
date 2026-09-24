import { parseArgs } from 'node:util';
import { echoError } from '@gobing-ai/ts-utils';
import { processGeneratorIO } from '@gobing-ai/voice-gen';
import { createGeminiVoiceClient } from './gemini-client';

export * from './gemini-client';

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
    const { values } = parseArgs({
        args: argv,
        options: {
            in: { type: 'string' },
            out: { type: 'string' },
        },
    });

    if (!values.in || !values.out) {
        echoError('gemini-tts failed: Missing required arguments: --in and --out');
        return 1;
    }

    try {
        await processGeneratorIO(values.in, values.out, createGeminiVoiceClient(), undefined, 'kk:gemini-tts');
        return 0;
    } catch (err: unknown) {
        echoError(`gemini-tts failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
