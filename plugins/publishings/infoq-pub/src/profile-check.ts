/**
 * InfoQ profile-session capability (R5, AC3).
 *
 * `login` opens the editor in a headed browser and resolves only once InfoQ's readiness
 * predicate passes; `check` reopens the profile headlessly and reports `verified` or `refused`.
 * Arg parsing, profile precedence (`--profile` > `INFOQ_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` >
 * `~/.config/kk/browser-profiles/infoq`) and the exit codes (0 verified, 1 refused, 2 usage
 * error) all live in the shared `runProfileCli` (0183), so the publish preflight and this CLI
 * apply the same gate.
 *
 * Manual dogfood (plan step 6): `bun plugins/publishings/infoq-pub/src/profile-check.ts login`
 * then `… check` on the same profile.
 */
import { runProfileCli } from '@gobing-ai/publish-harness/browser';
import { CONFIG } from './index';

if (import.meta.main) {
    process.exit(await runProfileCli(CONFIG, Bun.argv.slice(2)));
}
