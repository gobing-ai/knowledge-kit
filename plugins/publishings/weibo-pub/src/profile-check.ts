/**
 * Weibo profile-session capability (R7, AC4).
 *
 * `login` opens the Weibo home composer in a headed browser and resolves only once the site
 * readiness predicate passes; `check` reopens the profile (headlessly, unless the operator passes
 * `--headed` or the config sets `checkHeadedOnly`) and reports `verified` or `refused`. Arg parsing,
 * profile precedence (`--profile` > `WEIBO_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` >
 * `~/.config/kk/browser-profiles/weibo`) and the exit codes (0 verified, 1 refused, 2 usage error)
 * all live in the shared `runProfileCli`, so the publish preflight and this CLI apply the same gate.
 *
 * The selectors this probe relies on are provisional until task 0246 pins them against the live DOM;
 * a selector that never attaches is a refusal (`Bun plugins/publishings/weibo-pub/src/profile-check.ts
 * login` is the recovery), never silent success.
 */
import { kkBrowserLauncher, runProfileCli, stateRestoringLauncher } from '@gobing-ai/publish-harness/browser';
import { WEIBO_CONFIG } from './index';

if (import.meta.main) {
    process.exit(
        await runProfileCli(WEIBO_CONFIG, Bun.argv.slice(2), { launcher: stateRestoringLauncher(kkBrowserLauncher) }),
    );
}
