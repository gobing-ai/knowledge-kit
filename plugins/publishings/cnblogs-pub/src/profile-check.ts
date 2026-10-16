/**
 * cnblogs profile-session capability (task 0293, Chunk A).
 *
 * `login` opens the cnblogs post-edit entry (https://i.cnblogs.com/posts/edit, provisional — see
 * `src/selectors.ts`) in a headed browser and resolves only once the site readiness predicate
 * passes; `check` reopens the profile (headlessly, unless the operator passes `--headed` or the
 * config sets `checkHeadedOnly`) and reports `verified` or `refused`; `open` just brings the
 * window up. Arg parsing, profile precedence (`--profile` > `CNBLOGS_PROFILE_DIR` >
 * `KK_BROWSER_PROFILE_DIR` > `~/.config/kk/browser-profiles/cnblogs`) and the exit codes
 * (0 verified, 1 refused, 2 usage error) all live in the shared `runProfileCli`, so the publish
 * preflight and this CLI apply one gate.
 *
 * The readiness predicate observes the site-owned Markdown editor (the grounded
 * `input#post-title`, cnblogs.js:22/25/36, see `src/selectors.ts`); the login-redirect regex is
 * provisional (see `src/selectors.ts`). A selector that never attaches is a refusal
 * (`bun plugins/publishings/cnblogs-pub/src/profile-check.ts login` is the recovery), never
 * silent success.
 */
import { runProfileCli } from '@gobing-ai/publish-harness/browser';
import { CNBLOGS_CONFIG } from './selectors';

if (import.meta.main) {
    process.exit(await runProfileCli(CNBLOGS_CONFIG, Bun.argv.slice(2)));
}
