/**
 * CSDN profile-session capability (task 0292, Chunk A).
 *
 * `login` opens the CSDN Markdown editor entry (https://editor.csdn.net/md/, grounded 2026-10-14,
 * task 0292 Design) in a headed browser and resolves only once the site readiness predicate passes;
 * `check` reopens the profile (headlessly, unless the operator passes `--headed` or the config sets
 * `checkHeadedOnly`) and reports `verified` or `refused`. Arg parsing, profile precedence
 * (`--profile` > `CSDN_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` >
 * `~/.config/kk/browser-profiles/csdn`) and the exit codes (0 verified, 1 refused, 2 usage error)
 * all live in the shared `runProfileCli`, so the publish preflight and this CLI apply one gate.
 *
 * The readiness predicate observes the site-owned Markdown editor (the grounded
 * `input.article-bar__title--input`, see `src/index.ts`); the login-redirect regex is provisional
 * (see `src/index.ts`). A selector that never attaches is a refusal
 * (`bun plugins/publishings/csdn-pub/src/profile-check.ts login` is the recovery), never silent
 * success.
 */
import { runProfileCli } from '@gobing-ai/publish-harness/browser';
import { CSDN_CONFIG } from './index';

if (import.meta.main) {
    process.exit(await runProfileCli(CSDN_CONFIG, Bun.argv.slice(2)));
}
