/**
 * xiaoyuzhou profile-session capability (task 0295, Chunk A).
 *
 * `login` opens the xiaoyuzhou studio home (https://podcaster.xiaoyuzhoufm.com/, see
 * `src/selectors.ts`) in a headed browser and resolves only once the site readiness predicate
 * passes; `check` reopens the profile (headlessly, unless the operator passes `--headed` or the
 * config sets `checkHeadedOnly`) and reports `verified` or `refused`; `open` just brings the
 * window up. Arg parsing, profile precedence (`--profile` > `XYZF_PROFILE_DIR` >
 * `KK_BROWSER_PROFILE_DIR` > `~/.config/kk/browser-profiles/xiaoyuzhou`) and the exit codes
 * (0 verified, 1 refused, 2 usage error) all live in the shared `runProfileCli`, so the publish
 * preflight and this CLI apply one gate.
 *
 * The readiness predicate observes the site-owned grounded controls (the audio `input#upload`
 * xiaoyuzhou.js:27, whose absence the source reads as maybe-unlogged xiaoyuzhou.js:28, and the
 * title `input[name="title"]` xiaoyuzhou.js:55 — see `src/selectors.ts`); an
 * unsupported-browser page is also not-ready, since the studio officially requires desktop
 * Chrome 147+ (rerun with KK_BROWSER_CHANNEL=chrome). The login-redirect regex is provisional. A
 * selector that never attaches is a refusal (`bun plugins/publishings/xiaoyuzhou-pub/src/profile-check.ts login`
 * is the recovery), never silent success.
 */
import { runProfileCli } from '@gobing-ai/publish-harness/browser';
import { XYZF_CONFIG } from './selectors';

if (import.meta.main) {
    process.exit(await runProfileCli(XYZF_CONFIG, Bun.argv.slice(2)));
}
