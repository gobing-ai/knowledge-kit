/**
 * shipinhao profile-session capability (task 0296, Chunk A).
 *
 * `login` opens the Channels dashboard (https://channels.weixin.qq.com/platform,
 * see `src/selectors.ts`) in a headed browser and resolves only once the site readiness predicate
 * passes; `check` reopens the profile (headlessly, unless the operator passes `--headed` or the
 * config sets `checkHeadedOnly`) and reports `verified` or `refused`; `open` just brings the
 * window up. Arg parsing, profile precedence (`--profile` > `SHP_PROFILE_DIR` >
 * `KK_BROWSER_PROFILE_DIR` > `~/.config/kk/browser-profiles/shipinhao`) and the exit codes
 * (0 verified, 1 refused, 2 usage error) all live in the shared `runProfileCli`, so the publish
 * preflight and this CLI apply one gate.
 *
 * The readiness predicate observes the vendor-grounded creator-form evidence (the unique video
 * `input[type=file]`, shipinhao.js:580-583, and the 添加描述/标题 placeholders, shipinhao.js:516-518,
 * 669-674 — see `src/selectors.ts`); an unsupported-browser page is also not-ready. The
 * login-redirect regex is provisional. A selector that never attaches is a refusal
 * (`bun plugins/publishings/shipinhao-pub/src/profile-check.ts login` is the recovery), never
 * silent success.
 */
import { runProfileCli } from '@gobing-ai/publish-harness/browser';
import { SHP_CONFIG } from './selectors';

if (import.meta.main) {
    process.exit(await runProfileCli(SHP_CONFIG, Bun.argv.slice(2)));
}
