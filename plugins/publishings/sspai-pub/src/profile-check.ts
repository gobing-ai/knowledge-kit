/**
 * sspai profile-session capability (task 0294, Chunk A).
 *
 * `login` opens the sspai article-editor entry (https://sspai.com/post/write, provisional — see
 * `src/selectors.ts`) in a headed browser and resolves only once the site readiness predicate
 * passes; `check` reopens the profile (headlessly, unless the operator passes `--headed` or the
 * config sets `checkHeadedOnly`) and reports `verified` or `refused`; `open` just brings the
 * window up. Arg parsing, profile precedence (`--profile` > `SSPAI_PROFILE_DIR` >
 * `KK_BROWSER_PROFILE_DIR` > `~/.config/kk/browser-profiles/sspai`) and the exit codes
 * (0 verified, 1 refused, 2 usage error) all live in the shared `runProfileCli`, so the publish
 * preflight and this CLI apply one gate.
 *
 * The readiness predicate observes the site-owned editor controls (the grounded
 * `textarea[placeholder="请输入标题..."]` sspai.js:26 and `div[contenteditable="true"]`
 * sspai.js:59, whose absence sspai.js:60 reads as logged-out — see `src/selectors.ts`); the
 * login-redirect regex is provisional. A selector that never attaches is a refusal
 * (`bun plugins/publishings/sspai-pub/src/profile-check.ts login` is the recovery), never
 * silent success.
 */
import { runProfileCli } from '@gobing-ai/publish-harness/browser';
import { SSPAI_CONFIG } from './selectors';

if (import.meta.main) {
    process.exit(await runProfileCli(SSPAI_CONFIG, Bun.argv.slice(2)));
}
