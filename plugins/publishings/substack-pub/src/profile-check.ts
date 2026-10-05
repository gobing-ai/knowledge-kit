/**
 * Substack profile-session capability (R5, AC3).
 *
 * `login` opens the publication's editor in a headed browser and resolves only once Substack's
 * readiness predicate passes; `check` reopens the profile headlessly and reports `verified` or
 * `refused`. Arg parsing, profile precedence (`--profile` > `SUBSTACK_PROFILE_DIR` >
 * `KK_BROWSER_PROFILE_DIR` > `~/.config/kk/browser-profiles/substack`) and the exit codes
 * (0 verified, 1 refused, 2 usage error) all live in the shared `runProfileCli` (0183), so the
 * publish preflight and this CLI apply the same gate.
 *
 * The publication is publication-scoped, so it comes from `--publication <url>` or
 * `SUBSTACK_PUBLICATION_URL`; `--publication` is stripped before `runProfileCli` parses the rest
 * (the shared CLI rejects a flag it does not know), and a missing or non-https value is a usage
 * error that opens no browser.
 *
 * Operator dogfood (plan step 6, handed to 0193): run `profile-check.ts login`, then `check`, on
 * the same profile, and re-measure the editor URL, the selectors and the draft signal.
 */
import { type ChannelBrowserConfig, type ProfileCliDeps, runProfileCli } from '@gobing-ai/publish-harness/browser';
import { echo } from '@gobing-ai/ts-utils';
import { channelConfig, resolvePublicationUrl } from './index';

const PUBLICATION_FLAG = '--publication';
const USAGE = 'usage: substack profile-check [login|check] [--publication <url>] [--profile <dir>] [--timeout <ms>]';

/**
 * Splits `--publication <url>` / `--publication=<url>` out of the operator argv; `rest` keeps the
 * `login|check` positional and the `--profile` / `--timeout` flags `runProfileCli` owns. A flag
 * with no value stays an empty string, so it is refused as a blank publication URL instead of
 * silently falling through to the environment.
 */
export function splitPublicationFlag(argv: readonly string[]): { publicationUrl?: string; rest: string[] } {
    const rest: string[] = [];
    let publicationUrl: string | undefined;
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index] ?? '';
        if (arg === PUBLICATION_FLAG) {
            publicationUrl = argv[index + 1] ?? '';
            index += 1;
            continue;
        }
        if (arg.startsWith(`${PUBLICATION_FLAG}=`)) {
            publicationUrl = arg.slice(PUBLICATION_FLAG.length + 1);
            continue;
        }
        rest.push(arg);
    }
    return { publicationUrl, rest };
}

/**
 * `login|check` for one publication: the shared CLI over `channelConfig(publicationUrl)`.
 * Exit codes: 0 verified (or logged in), 1 refused, 2 usage error — the publication URL is
 * resolved (and refused) before anything launches.
 */
export async function main(argv: readonly string[] = Bun.argv.slice(2), deps: ProfileCliDeps = {}): Promise<number> {
    const stdout =
        deps.stdout ??
        ((line: string) => {
            echo(line);
        });
    const { publicationUrl, rest } = splitPublicationFlag(argv);
    const publication = resolvePublicationUrl(publicationUrl);
    if ('error' in publication) {
        stdout(`substack profile-check: ${publication.error} — ${USAGE}`);
        return 2;
    }
    const config: ChannelBrowserConfig = channelConfig(publication.url);
    return runProfileCli(config, [...rest], { ...deps, stdout });
}

if (import.meta.main) {
    process.exit(await main());
}
