/**
 * Juejin profile-session capability (R5, AC3).
 *
 * `login` opens the editor in a headed browser and resolves only once Juejin's readiness predicate
 * passes; `check` reopens the profile headlessly and reports `verified` or `refused`. Arg parsing,
 * profile precedence (`--profile` > `JUEJIN_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` >
 * `~/.config/kk/browser-profiles/juejin`) and the exit codes (0 verified, 1 refused, 2 usage error)
 * all live in the shared `runProfileCli` (0183), so the publish preflight and this CLI apply the
 * same gate.
 *
 * Operator dogfood (plan step 6, handed to 0192): run `profile-check.ts login`, then `check`, on
 * the same profile, and re-measure the editor URL, the selectors and the draft signal.
 */
import { runProfileCli } from '@gobing-ai/publish-harness/browser';
import { CONFIG } from './index';

if (import.meta.main) {
    process.exit(await runProfileCli(CONFIG, Bun.argv.slice(2)));
}
