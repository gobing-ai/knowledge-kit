/**
 * LinkedIn profile-session capability (0328 R2).
 *
 * `login` opens the feed in a headed browser and resolves only once LinkedIn's readiness predicate
 * passes; `check` reopens the profile headlessly and reports `verified` or `refused` without
 * posting. Arg parsing, profile precedence (`--profile` > `LINKEDIN_PROFILE_DIR` >
 * `KK_BROWSER_PROFILE_DIR` > `~/.config/kk/browser-profiles/linkedin`, ADR-042) and the exit codes
 * (0 verified, 1 refused, 2 usage error) all live in the shared `runProfileCli`, so the publish
 * preflight (`kk plugin check linkedin-pub` and the publish-matrix probe) and this CLI apply one
 * gate.
 */
import { runProfileCli } from '@gobing-ai/publish-harness/browser';
import { LINKEDIN_CONFIG } from './index';

if (import.meta.main) {
    process.exit(await runProfileCli(LINKEDIN_CONFIG, Bun.argv.slice(2)));
}
