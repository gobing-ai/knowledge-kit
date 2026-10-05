/**
 * X article profile-session capability (R5, AC3).
 *
 * `login` opens the Articles composer in a headed browser and resolves only once X's readiness
 * predicate passes; `check` reopens the profile headlessly and reports `verified` or `refused`.
 * Arg parsing, profile precedence (`--profile` > `X_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` >
 * `~/.config/kk/browser-profiles/x`) and the exit codes (0 verified, 1 refused, 2 usage error) all
 * live in the shared `runProfileCli` (0183), so the publish preflight and this CLI apply the same
 * gate.
 *
 * Operator dogfood (plan step 6, handed to 0194): run `profile-check.ts login`, then `check`, on
 * the same profile, and re-measure the selectors and the edit-URL pattern.
 */
import { runProfileCli } from '@gobing-ai/publish-harness/browser';
import { ARTICLE_CONFIG } from './index';

if (import.meta.main) {
    process.exit(await runProfileCli(ARTICLE_CONFIG, Bun.argv.slice(2)));
}
