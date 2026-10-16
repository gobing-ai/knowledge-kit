/**
 * bilibili profile-session capability (task 0297, Chunk A).
 *
 * `login` opens the Bilibili member creator home (https://member.bilibili.com/,
 * see `src/selectors.ts`) in a headed browser and resolves only once the site readiness predicate
 * passes; `check` reopens the profile (headlessly, unless the operator passes `--headed` or the
 * config sets `checkHeadedOnly`) and reports `verified` or `refused`; `open` just brings the
 * window up. Arg parsing, profile precedence (`--profile` > `BILIBILI_PROFILE_DIR` >
 * `KK_BROWSER_PROFILE_DIR` > `~/.config/kk/browser-profiles/bilibili`) and exit codes
 * (0 verified, 1 refused, 2 usage error) all live in the shared `runProfileCli`, so the publish
 * preflight and this CLI apply one gate.
 */

import { runProfileCli } from '@gobing-ai/publish-harness/browser';
import { BILI_CONFIG } from './selectors';

if (import.meta.main) {
    process.exit(await runProfileCli(BILI_CONFIG, Bun.argv.slice(2)));
}
