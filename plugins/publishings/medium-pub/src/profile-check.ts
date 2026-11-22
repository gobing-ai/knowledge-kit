import { type ProfileCliDeps, runProfileCli } from '@gobing-ai/publish-harness/browser';
import { echo } from '@gobing-ai/ts-utils';
import { channelConfig } from './browser-rail';

/**
 * Medium profile-session CLI (`login|check|open`).
 *
 * When `MEDIUM_INTEGRATION_TOKEN` is configured, `check` exits 0 immediately without requiring a
 * browser profile so token-API users are never blocked by the browser fallback.
 */
export async function main(argv: readonly string[] = Bun.argv.slice(2), deps: ProfileCliDeps = {}): Promise<number> {
    const stdout =
        deps.stdout ??
        ((line: string) => {
            echo(line);
        });
    const command = argv[0];
    if (command === 'check' && (process.env.MEDIUM_INTEGRATION_TOKEN?.trim() ?? '').length > 0) {
        stdout(JSON.stringify({ status: 'verified', detail: 'MEDIUM_INTEGRATION_TOKEN configured' }));
        return 0;
    }
    return runProfileCli(channelConfig(), [...argv], { ...deps, stdout });
}

if (import.meta.main) {
    process.exit(await main());
}
