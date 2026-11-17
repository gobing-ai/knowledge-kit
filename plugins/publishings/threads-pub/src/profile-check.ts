/**
 * Threads profile-session capability (2026-11-16).
 *
 * threads-pub had no browser session at all (its post operation shipped API-only), so the operator
 * had no way to create a `threads` profile and the channel could not be enabled on the `kk bot`
 * route. `login` opens threads.net in a headed browser and resolves only once the site readiness
 * predicate passes; `check` reopens the profile and reports `verified` or `refused`. Arg parsing,
 * profile precedence (`--profile` > `THREADS_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` >
 * `~/.config/kk/browser-profiles/threads`) and the exit codes all live in the shared
 * `runProfileCli`, so the publish preflight and this CLI apply one gate.
 */
import { runProfileCli } from '@gobing-ai/publish-harness/browser';
import { THREADS_CONFIG } from './post-rail';

if (import.meta.main) {
    process.exit(await runProfileCli(THREADS_CONFIG, Bun.argv.slice(2)));
}
