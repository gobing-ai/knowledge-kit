/**
 * shipinhao profile-session capability (task 0296, Chunk A).
 *
 * `login` opens the Channels dashboard (https://channels.weixin.qq.com/platform,
 * see `src/selectors.ts`) in a headed browser and resolves only once the site readiness predicate
 * passes; `check` reopens the profile (headedly, via `checkHeadedOnly`) and reports `verified` or
 * `refused`; `open` just brings the window up. Arg parsing, profile precedence
 * (`--profile` > `SHP_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` > `~/.config/kk/browser-profiles/shipinhao`)
 * and the exit codes (0 verified, 1 refused, 2 usage error) all live in the shared `runProfileCli`,
 * so the publish preflight and this CLI apply one gate.
 *
 * 2026-11-26: every launch goes through `stateRestoringLauncher`, which replays the session snapshot
 * captured at login (`storage-state.json`, same rail as wechatmp-pub 0371). Without it `check`
 * refused the session the login had just verified — the cookie store does not survive a restart, so
 * the console session has to ride the snapshot.
 *
 * The readiness predicate observes the vendor-grounded creator-form evidence (the unique video
 * `input[type=file]`, shipinhao.js:580-583, and the 添加描述/标题 placeholders, shipinhao.js:516-518,
 * 669-674 — see `src/selectors.ts`); an unsupported-browser page is also not-ready.
 */
import { kkBrowserLauncher, runProfileCli } from '@gobing-ai/publish-harness/browser';
import { SHP_CONFIG } from './selectors';
import { stateRestoringLauncher } from './session-state';

if (import.meta.main) {
    process.exit(
        await runProfileCli(SHP_CONFIG, Bun.argv.slice(2), { launcher: stateRestoringLauncher(kkBrowserLauncher) }),
    );
}
