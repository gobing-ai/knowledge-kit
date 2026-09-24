---
schema_version: 1
name: "Fix apps review findings: invoke input-deletion alias, fan-out duplicate publish, fan-in plugin roots + CLI hardening"
status: done
template: issue
created_at: 2026-09-24T00:17:20.579Z
updated_at: "2026-09-24T16:19:23.181Z"

priority: P1
ac_altitude: task-local
estimate_hours: 8
---

## 0157. Fix apps review findings: invoke input-deletion alias, fan-out duplicate publish, fan-in plugin roots + CLI hardening

### Background

The standalone `/sp:dev-review apps --agent inline --focus all` pass ran on 2026-09-23 at `main@d4dd562d`. It reviewed `apps/cli/src` and produced 8 findings plus 3 architecture candidates. The operator asked for **all** of them to be fixed in one task, so this task covers findings #1–#8 (R1–R8) and candidates C1–C3 (R9–R11).

**Scope:**
- The executor verbs `kk executor run | fan-in | fan-out`, which are implemented in `apps/cli/src/{invoke,fanin,fanout}.ts` and wired in `apps/cli/src/commands/executor.ts`.
- The `kk stage` resolver in `apps/cli/src/stage.ts`.
- `kk plugin status` diagnostics in `apps/cli/src/commands/plugin.ts`.
- One additive schema export in `packages/kk-core/src/schemas.ts` (R11).

**Baseline** at task creation (2026-09-23): `bun test apps/cli` gives 346 pass, 0 fail, across 26 files. The full-repo `bun run test` gives 807/807 (from task 0156). Typecheck was not re-run.

| # | Req | Sev | Location (`main@d4dd562d`) | Defect | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | R1 | P2 | `apps/cli/src/invoke.ts:311`, `:387-396` | `--in`/`--out` alias detection compares resolved path **strings**. Two spellings of one file get past it: a case variant on case-insensitive APFS, or a path through a symlinked directory. The stale-output `unlinkSync(absOutPath)` then **deletes the input**, and the run fails with "did not write output file". | Reproduced (data loss), both spellings |
| 2 | R2 | P2 | `apps/cli/src/fanout.ts:291-296`, `:456`, `:500` | A repeated `--target x --target x` without `--retry-from` publishes to `x` **twice**, which is a duplicate external post. The retry path already dedupes (`:485`), and the `fanout()` docstring (`:87`) promises "exactly once per run". | Reproduced: 2 dispatch calls, exit 0 |
| 3 | R3 | P3 | `apps/cli/src/fanin.ts:352`; `commands/executor.ts:150-170`, `:185-224` | `fan-in --source` discovery is hard-wired to `discoverAllPlugins({})`, and fan-in has no `--plugins-root` / `--plugins-path`. That differs from `run` and `fan-out`, and from `docs/04_DESIGN.md:173` (which promises the same multi-root registry as `kk invoke`). Isolated runs cannot pin the plugin set. | Code read |
| 4 | R4 | P3 | `apps/cli/src/stage.ts:23` | `resolveStagesScript` falls back to `resolve('plugins/kk/scripts/kk-workflow-stages.ts')`, which resolves against the **current directory**. When the package copy is missing, `kk stage` runs whatever script sits at that relative path under the current directory. | Code read (exploitability LOW) |
| 5 | R5 | P3 | `apps/cli/src/fanout.ts:392` | `JSON.parse(await fs.readFile(outTmp))` is not in a `try`. Malformed JSON from a publisher surfaces as a bare `SyntaxError` with no target name. Fan-in wraps the same step (`fanin.ts:303-310`). | Code read |
| 6 | R6 | P4 | `apps/cli/src/commands/plugin.ts:84,86` (`printDiagnostics`) | `echoError` already appends `\n` (`@gobing-ai/ts-utils` `dist/output.js:14`). The extra `\n` in the message prints a blank line after every diagnostic. | Reproduced (`cat -e`) |
| 7 | R7 | P4 | `apps/cli/src/invoke.ts:113-124`, `:173-187` | Two JSDoc blocks are attached to the wrong symbol. The `spawnPluginEntry` doc sits on `pluginEntryCmd` (`:125`), and the `killProcessTree` doc sits on `KILL_TREE_SETTLE_MS` (`:188`). IDE hovers are therefore wrong. | Code read |
| 8 | R8 | P4 | `apps/cli/src/invoke.ts:410` | Dead ternary: `proc.exitCode !== 0 ? proc.exitCode : 1` sits inside `if (proc.exitCode !== 0)`. | Code read |
| C1 | R9 | minor | `commands/executor.ts:34-106`, `:140-224` | The flag contract is declared three times: in the canonical verb, the hidden alias, and the hand parser. There are also five identical `collect*` functions. The R3 fix would otherwise add another 2×2 option lines. | Code read |
| C2 | R10 | minor | 7 copies of the zod issue formatter: `invoke.ts:353,361-363,449`, `fanin.ts:142,313`, `fanout.ts:170,394`; plus the duplicated "read plugin temp output → parse → validate" in `fanin.ts:303-316` and `fanout.ts:388-397` | One concern is spread across three files. #5 exists precisely because one copy lost its `try`. | Code read |
| C3 | R11 | advisory | `apps/cli/src/fanout.ts:179-269` (`readAggregateResult`) | About 90 lines of hand-rolled `typeof` validation for a schema that is otherwise only an `interface` (`:23-45`). | Code read |

**Out of scope:**
- An `invoke` / fan-out overall timeout. It was declined in task 0156 Q&A (per-request fetch timeouts are the chosen bound).
- `apps/cli/plugins/`, the gitignored bundle.
- `plugins/sp`, which is vendored.
- `kk-workflow-stages.ts` readers of the aggregate file. They cannot import workspace packages (0156 Q&A).

### Requirements

Every requirement is test-first. Its AC test must fail on `main@d4dd562d` and pass after the change, except refactors R7, R9, R10 and R11, where the existing suite is the regression net. Line anchors are at `main@d4dd562d`; re-anchor with `rg` on the quoted symbol if lines have moved.

- **R1 — Alias detection by file identity, not by path string (#1, P2).**
  - Where: `runInvoke` (`apps/cli/src/invoke.ts:311`).
  - When both `absInPath` and `absOutPath` exist, reject the run if they name the same file. Compare the `dev` and `ino` from `statSync` on both paths; `statSync` follows symlinks.
  - Keep the existing string check (`absInPath === absOutPath`). It remains the reliable guard when `--out` does not exist yet.
  - The check must run **before** the stale-output `unlinkSync` (`:387-396`) and before any spawn.
  - Rejection:
    - exit code 1, with the existing message shape `--in and --out alias the same path (<in>); refusing to overwrite the input`
    - the input file must be byte-identical afterwards
  - Must also cover:
    - (a) a case variant of the input on a case-insensitive file system
    - (b) an `--out` whose parent directory is a symlink to the input's directory
    - (c) an `--out` that is itself a symlink to the input. This is harmless today because `unlink` removes only the link, but the plugin would then write through the link onto the input.
  - Hard links (a second name for the same inode) are also rejected by the identity check. That is acceptable and needs no dedicated test.
- **R2 — Fan-out attempts each target at most once per run (#2, P2).**
  - Where: `runFanout` (`apps/cli/src/fanout.ts:456`).
  - In the non-retry path, dedupe `opts.targets` preserving first-seen order, before `validateTargets` and before dispatch.
  - `--target x --target x --target y` must dispatch exactly `x`, `y` (2 calls). The aggregate must have `summary.total === 2`.
  - The retry path's existing dedupe (`:485`) is unchanged.
  - Dedupe is silent: no warning. This matches the retry-path behavior and spec §5.1 (`docs/design/fan-in-and-fan-out-specification.md:153-170`).
- **R3 — Fan-in honours `--plugins-root` / `--plugins-path` (#3, P3).**
  - Add `--plugins-root <dir>` (single, exclusive) and `--plugins-path <dir>` (repeatable) to:
    - (a) the `runFanin` hand parser (`apps/cli/src/fanin.ts:154-253`); a second `--plugins-root` and missing values are usage errors, exit `EXIT_USAGE` (2), mirroring `fanout.ts:315-330`
    - (b) the canonical `executor fan-in` verb and the hidden `fanin` alias, via R9's shared registrar
    - (c) `runFaninAction`'s argv rebuild (`commands/executor.ts:73-93`)
  - Supplying both flags is rejected with exit 2 and the message `--plugins-root and --plugins-path are mutually exclusive (ADR-012 R6)`. This mirrors `fanout.ts:443-446`, and the check runs before any file is read.
  - `--source` discovery becomes `discoverAllPlugins({ pluginsRoot, extraPaths: pluginsPath })`.
  - Without either flag, behavior stays byte-identical to today, so the `kk-daily-ai-voice.yaml:98` invocation is unaffected.
  - `--in`-only runs accept the flags and ignore them: no discovery happens without `--source`.
- **R4 — `kk stage` never resolves the stages script against the current directory (#4, P3).**
  - Replace the fallback at `apps/cli/src/stage.ts:23` with a checkout-relative candidate derived from the module's own location: `resolve(import.meta.dir, '../../..', STAGES_REL)`.
    - From source, `import.meta.dir` is `apps/cli/src`; from the bundle it is `apps/cli/dist`. Both are three levels below the repo root.
  - Expose it as an injectable parameter: `resolveStagesScript(argv1 = process.argv[1], checkoutRoot = resolve(import.meta.dir, '../../..'))`.
  - Resolution order is unchanged: the package copy first, then the checkout copy, then the existing "install or refresh" error.
  - The current directory must play **no** part: running from a directory that contains a planted `plugins/kk/scripts/kk-workflow-stages.ts` must not select it.
- **R5 — Fan-out names the target when its Result file is invalid JSON (#5, P3).**
  - Where: `pluginDispatch` (`fanout.ts:392`).
  - Malformed JSON in the publisher's temp output must be caught and rethrown as `Plugin '<target>' wrote invalid JSON: <parse message>`.
  - The result is a failed `TargetOutcome` for that target only, with siblings unaffected (existing `fanout()` per-target isolation), and exit 1.
  - Delivered through R10's shared reader. The observable contract above is what the AC tests.
- **R6 — No blank lines in `kk plugin status` diagnostics (#6, P4).**
  - Drop the trailing `\n` from the two `echoError` calls in `printDiagnostics` (`commands/plugin.ts:84,86`).
  - Also drop it from the other two `echoError` calls in `commands/plugin.ts`: `:100` (the mutual-exclusion message, single-quoted string) and `:112` (invalid kind).
  - Afterwards, `rg -n 'echoError\(.*\\n.\);' apps/cli/src` must return no hits. At task creation it returns exactly `plugin.ts:84,86,100,112`.
  - stderr must contain no `\n\n` sequence.
- **R7 — JSDoc on the right symbols (#7, P4).**
  - Move the `spawnPluginEntry` doc block (`invoke.ts:113-124`) so it sits directly above `export function spawnPluginEntry` (`:152`).
  - Move the `killProcessTree` block (`:173-187`) directly above `killProcessTree`.
  - `pluginEntryCmd` and `KILL_TREE_SETTLE_MS` get a one-line doc each, or none; keep whichever of their current short comments exist.
  - No code change.
- **R8 — Remove the dead ternary (#8, P4).** `invoke.ts:410`: return `proc.exitCode` directly inside the `if (proc.exitCode !== 0)` branch. Behavior is unchanged.
- **R9 — One option declaration per executor verb (C1, minor).**
  - In `commands/executor.ts`, add one registrar per verb, e.g. `withRunOptions(cmd)`, `withFaninOptions(cmd)`, `withFanoutOptions(cmd)`. Each returns the `Command` with every `.option` / `.requiredOption` for that verb, and is applied to both the canonical verb (`:140-181`) and its hidden alias (`:185-224`).
  - Replace the five identical `collect*` functions with one `collectRepeatable(value, acc)`.
  - The hand parsers in `fanin.ts` / `fanout.ts` remain the single **validation** owner. About 1,700 test lines call `runFanin(argv)` / `runFanout(argv)` directly, so the commander layer only declares and rebuilds argv.
  - `kk executor <verb> --help` and `kk <alias> --help` option lists must be identical before and after, apart from R3's two new fan-in options.
- **R10 — Shared issue formatter and plugin-output reader (C2, minor).**
  - Add `apps/cli/src/plugin-output.ts` exporting:
    - `formatIssues(error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> }): string`, using the current format `path.join('.') || 'root'` + `: ` + message, joined with `'; '`
    - `readPluginJson<T>(fs, path, schema, label): Promise<T>`: read → `JSON.parse` in a `try` (`<label> wrote invalid JSON: …`) → `schema.safeParse` (`<label> <violation phrase>: <issues>`). It throws `Error`.
  - Replace all 7 issue-formatter copies listed in Background C2 with `formatIssues`.
  - Use `readPluginJson` in `fanin.ts` `collectSourceDocs` (`:302-316`) and `fanout.ts` `pluginDispatch` (`:392-396`).
  - Every existing error string must keep its current wording: callers pass the label/phrase. Existing tests are the net, and none may change.
  - `invoke.ts` keeps its own read path: its messages go to `echoError` with exit codes, not throws. It only adopts `formatIssues`.
- **R11 — Zod aggregate-result schema (C3, advisory).**
  - Add `TargetOutcomeSchema` and `AggregateResultSchema` to `packages/kk-core/src/schemas.ts` and export them from `packages/kk-core/src/index.ts`. This is additive and non-breaking.
  - The fields must match `fanout.ts:23-45` exactly: `status` is an enum `published|failed|skipped`, `metadata` is an optional `record(string, unknown)`, and `summary` has 4 numbers.
  - Replace the hand checks in `readAggregateResult` (`fanout.ts:200-268`) with `AggregateResultSchema.safeParse`, and derive `TargetOutcome` / `AggregateResult` in `fanout.ts` via `z.infer`. Otherwise keep the interfaces and add a type-level assignability check; choose whichever passes typecheck without `any`.
  - Unknown keys are **stripped**, as today (the hand parser copies only known fields). Zod's default `object` strips unknown keys.
  - **Error-message compatibility:** these substrings are asserted today and must still appear for the same inputs:
    - `fanout.test.ts:396`: `target 'medium' metadata must be an object`
    - `:519`: `aggregate result schema`
    - `:694`: `not an aggregate result object`
    - `:762`: `violates the aggregate result schema (target a)`

    Map the first Zod issue to these messages with a small switch on `issue.path`:
    - root not an object → `not an aggregate result object`
    - `targets.<i>.metadata` → `target '<name>' metadata must be an object`
    - `targets.<i>.*` → `(target <name>)`
    - otherwise → `(<path>)`

    Do not edit those assertions.

### Acceptance Criteria

Every AC names its test file. A "new test" must fail on `main@d4dd562d`, and the implementer confirms that by running it before the fix. Use the existing helpers:
- `apps/cli/tests/invoke.test.ts`: `withTempDir`, `pluginDirOf`, and `captureOutput` from `./capture`
- `apps/cli/tests/fanout.test.ts`: `makeDispatch(failures)` → `{ dispatch, called }`, and `CONTENT`
- `apps/cli/tests/fanin.test.ts`: `withTempDir`, `writeFixtureIngestionPlugin`, `withPluginPath`
- `apps/cli/tests/commands/plugin.test.ts`: `runCaptured` → `{ code, out, err }`

- [x] **AC1 (R1)**, in `apps/cli/tests/invoke.test.ts`, next to the existing "0110 I5" alias test (`:379-408`). New tests, each asserting `res === 1`, stderr containing `alias the same path`, the input bytes unchanged, and the entry script never run (the fixture entry writes a marker file; assert that it does not exist):
  - (a) **Case variant.** Input `In.json`, `--out` `in.json` in the same dir. Guard: if `existsSync(<lower-case variant>)` is false, the file system is case-sensitive, so return early with a comment. Do not use `.skip`: the test body is a no-op there, not skipped.
  - (b) **Symlinked parent directory.** `symlinkSync(dir, join(root,'ld'))`; `--in dir/in.json`, `--out ld/in.json`.
  - (c) **`--out` is a symlink to the input file.**
  - The existing same-string test stays green and unedited.
- [x] **AC2 (R2)**, in `apps/cli/tests/fanout.test.ts`. New test: `runFanout(['--content', c, '--target','a','--target','a','--target','b','--out', o], { dispatch })` with `makeDispatch([])` → `called` equals `['a','b']`, the written aggregate has `summary.total === 2` and `targets.map(t=>t.target)` equals `['a','b']`, and the exit is 0. The existing retry-dedupe tests stay green.
- [x] **AC3 (R3)**, in `apps/cli/tests/fanin.test.ts`. New tests:
  - (a) `--plugins-root <root>` with `writeFixtureIngestionPlugin(root, 'src-a')` and `--source src-a:<in>` merges that plugin's docs, **without** `KK_PLUGIN_PATH` set.
  - (b) `--plugins-path <root>` does the same (union path).
  - (c) Both flags → exit 2, stderr contains `mutually exclusive`, and `--out` is not written.
  - (d) A second `--plugins-root` → exit 2.
  - (e) `--plugins-root` with no value → exit 2.
  - Plus commander-level tests in `apps/cli/tests/commands/executor.test.ts`. `executor fan-in --plugins-root <root> --source src-a:<in> --out <o>` succeeds, and the hidden `fanin` alias accepts the same flags. `--plugins-path` is forwarded by `runFaninAction`: assert the output docs.
- [x] **AC4 (R4)**, in `apps/cli/tests/stage.test.ts` and `apps/cli/tests/commands/stage.test.ts`.
  - (a) New test in `apps/cli/tests/stage.test.ts`: create a temp dir that contains a planted `plugins/kk/scripts/kk-workflow-stages.ts`, `process.chdir` into it (restored by the existing `afterEach`), and call `resolveStagesScript('/nonexistent/kk-entry', '/nonexistent-checkout')`. It must **throw** matching `/install or refresh the kk package/`, not return the planted file. This fails today, because the current directory wins.
  - (b) A second new test: `resolveStagesScript('/nonexistent/kk-entry')`, called after `process.chdir(tmpdir())`, returns the repo's `plugins/kk/scripts/kk-workflow-stages.ts`. The default `checkoutRoot` is independent of the current directory.
  - (c) These tests stay green **unedited**, because the default checkout root is the repo root:
    - `stage.test.ts` "falls back to the checkout-relative stages script from the repo root"
    - `stage.test.ts` `runStage` "returns the spawned process exit code"
    - `commands/stage.test.ts` "falls through to the cwd-relative copy …"; its title may be renamed to "checkout-relative"
    - `commands/stage.test.ts` "registers a variadic `stage` command …"
  - (d) **Allowed edits to existing tests.** These two tests relied on changing into an empty directory to make both candidates vanish. They now pass `'/nonexistent-checkout'` as the second argument, and their assertions (the `toThrow` regexes) are unchanged:
    - `stage.test.ts` "throws with install guidance when neither candidate exists"
    - `commands/stage.test.ts` "fails loud naming the attempted path when neither tier has the script"
    - The `chdir` lines may stay or go.
- [x] **AC5 (R5)**, in `apps/cli/tests/fanout.test.ts`. New test using the **real** `pluginDispatch`, not an injected dispatch:
  - Set up a fixture publish plugin under a temp `--plugins-root` whose entry writes `not json` to its `--out`, and pass it as `--target`.
  - Expect exit 1, and the aggregate's target entry to have `status: 'failed'` with `error` containing `Plugin '<name>' wrote invalid JSON`.
  - Reuse the existing helper `writeFakePublishPlugin(pluginsRoot, script)` (`fanout.test.ts:91-92`) with a script that writes `not json` to `--out`, and pass `--plugins-root` as the test at `fanout.test.ts:544` does.
- [x] **AC6 (R6)**, in `apps/cli/tests/commands/plugin.test.ts`. New test: `kk plugin status --plugins-root <root-with-one-broken-manifest>` via `runCaptured` → `err` contains `[` diagnostic lines, and `err.includes('\n\n')` is false.
- [x] **AC7 (R7).** A static check: `rg -n -B1 "^export function spawnPluginEntry\b|^function killProcessTree\b|^export function killProcessTree\b" apps/cli/src/invoke.ts` shows ` */` on the line directly above each. Record the output in Solution.
- [x] **AC8 (R8).** `rg -n "exitCode !== 0 \? proc.exitCode" apps/cli/src` returns no hits, and the existing non-zero-exit invoke tests stay green.
- [x] **AC9 (R9).**
  - (a) `rg -c "function collect" apps/cli/src/commands/executor.ts` = 1.
  - (b) Each `--plugins-root` / `--in <path>` / `--target` / `--source` option string appears once per verb registrar, not per command. Check with `rg -c "'--plugins-root <dir>'" apps/cli/src/commands/executor.ts` = 3 (run, fan-in, fan-out registrars).
  - (c) `--help` parity: for each of `run`/`invoke`, `fan-in`/`fanin`, `fan-out`/`fanout`, the options block of `bun apps/cli/src/index.ts executor <verb> --help` equals that of `bun apps/cli/src/index.ts <alias> --help`. Assert it in a test, or record both outputs in Solution. Before/after, fan-in differs only by the two R3 options.
- [x] **AC10 (R10).**
  - (a) `rg -n "issues\.map\(" apps/cli/src` returns hits only inside `plugin-output.ts`.
  - (b) A new `apps/cli/tests/plugin-output.test.ts` unit-tests `formatIssues`: root path → `root: …`; a nested path is dot-joined; multiple issues are `; `-joined. It also tests `readPluginJson` in three cases:
    - invalid JSON → throws `… wrote invalid JSON`
    - schema violation → throws with the issues
    - valid → returns parsed data
  - (c) No existing error-string assertion in `apps/cli/tests` changed. `git diff apps/cli/tests` shows only added tests, plus the AC4(d) edits.
- [x] **AC11 (R11).**
  - (a) `packages/kk-core/tests/schemas.test.ts` has new cases:
    - `AggregateResultSchema` accepts a valid aggregate with target `metadata`
    - it rejects a bad `status`
    - it rejects primitive `metadata`
    - it strips unknown keys
  - (b) The four asserted substrings in `fanout.test.ts:396,519,694,762` still pass unedited.
  - (c) `readAggregateResult` contains no `typeof … !==` field checks: `rg -n "typeof t\.|typeof sum\[" apps/cli/src/fanout.ts` returns no hits.
- [x] **AC12 (gates + scope).**
  - `bun run gate` passes, with aggregate coverage ≥ 90% lines and ≥ 90% functions (`bunfig.toml`).
  - `spur task check 0157 --json` reports only `L4.missing-feature-id`.
  - `git status --short` lists only:
    - `apps/cli/src/{invoke,fanin,fanout,stage,plugin-output}.ts`
    - `apps/cli/src/commands/{executor,plugin}.ts`
    - `apps/cli/tests/{invoke,fanin,fanout,stage,plugin-output}.test.ts`, `apps/cli/tests/commands/{plugin,executor,stage}.test.ts`
    - `packages/kk-core/src/{schemas,index}.ts`, `packages/kk-core/tests/schemas.test.ts` (plus `packages/kk-core/tests/index.test.ts` only if it enumerates exports)
    - `docs/04_DESIGN.md`, `docs/design/fan-in-and-fan-out-specification.md`
    - `docs/tasks/0157_*.md`
    - plus the untracked 0155/0156 task files, which are left alone
  - Existing-test edits are limited to AC4(d), plus the optional AC4(c) title rename. Any other edit to an existing assertion is a defect.
  - No `.skip`, no new `biome-ignore`, no `--no-verify`.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-24T00:24:19.313Z

Triage decisions were made when the task was created (2026-09-23) and bind the implementer. Re-opening one needs an operator decision.

- **Q: Include C1–C3 (architecture candidates), which are only minor or advisory?** A: **Yes.** The operator asked for "all of them" in one task. They are bounded as R9–R11:
  - no new dependency
  - no CLI-surface change except R3's two fan-in flags
  - no change to any existing error string
  - hand parsers stay the validation owner (R9)
  - If R9–R11 cannot keep every existing test green unedited (except AC4(d)), stop and record the blocker in Solution. Do not rewrite assertions to fit.
- **Q: R1: why `statSync` `dev`/`ino` and not `realpathSync` + string compare?** A: Both work on Bun 1.3.14 / macOS. The session probe showed `realpathSync('caseprobe.json')` returning the on-disk `CaseProbe.json`, and it also resolves symlinked parents. But `dev`+`ino` asks the actual question ("same file?") directly, as defined by Node's `fs.Stats`. It needs no assumption about how a runtime canonicalises case, and it also catches hard links, which realpath does not. Both need the files to exist, and the check runs only when both exist. `statSync` follows symlinks, which is intended.
- **Q: R1: reject a hard link to the input as an alias?** A: **Yes.** Unlinking one name of a hard link is harmless: the probe showed the input survives. But the plugin would then write the output into the input's inode through the second name. Same identity, same rejection. No dedicated test (Requirements R1).
- **Q: R2: should duplicate `--target` fail with exit 2 instead of silently deduping?** A: **No.** Dedupe silently. That matches the retry path (`fanout.ts:485`) and spec §5.1, and a workflow that templates a target twice should not fail. The aggregate lists each target once, so the effect is visible.
- **Q: R3: should fan-in validate `--plugins-root` when only `--in` is used?** A: Parse and apply the mutual-exclusion check always (exit 2). Only use the flags when `--source` triggers discovery. There is no existence check on the dir, which matches fan-out; `discoverAllPlugins` reports a missing root as a diagnostic.
- **Q: R4: remove the checkout fallback entirely?** A: **No.** Dev runs (`bun apps/cli/src/index.ts stage …` in a checkout without `bun link`) rely on it, as do the existing tests. Anchor it to the module's own location instead of the current directory. `bun build --target=bun` keeps `import.meta.dir` pointing at the bundle's directory (session probe: `apps/cli/dist` → the repo root is `../../..`, the same depth as `src`).
- **Q: R10: put `formatIssues` in kk-core?** A: **No.** All 7 call sites are in `apps/cli`, and kk-core is being edited by 0155. A local module (`apps/cli/src/plugin-output.ts`) is the smallest seam. Promote it if a second package needs it.
- **Q: R11: define the aggregate schema in `apps/cli` instead of kk-core?** A: **kk-core.** `apps/cli` has no direct `zod` dependency (`apps/cli/package.json:49-52` lists kk-core and ts-utils only), and adding one needs operator approval (AGENTS.md). `@gobing-ai/kk-core` already owns every other wire schema in `schemas.ts` and depends on zod. The export is additive. `kk-workflow-stages.ts:1325-1341` keeps its ad-hoc reads, because the stages script runs standalone with no workspace resolution (0156 Q&A).
- **Q: Add an overall timeout to `kk executor run` / fan-out?** A: **No.** Declined in task 0156 Q&A: per-request fetch timeouts inside plugins bound the real failure without capping legitimate multi-hour runs.
- **Q: Ordering relative to 0155 / 0156?** A: File-disjoint except:
  - `packages/kk-core/src/index.ts`: 0155 may touch exports. This task adds two names; rebase trivially.
  - `docs/04_DESIGN.md`: 0156 edits env/transport rows, this task edits the fan-in surface `:142-186`.

  Any order works. Leave the untracked 0155/0156 task files alone.
- **Q: Feature linkage?** A: None. This is standalone review debt, so `ac_altitude: task-local`, and `L4.missing-feature-id` is expected.

### Design

These sketches are binding on **behavior and messages** and advisory on exact code shape. Biome style applies: 4-space indent, single quotes, trailing commas, no `any`.

**R1 — `apps/cli/src/invoke.ts`.** Add `statSync` to the existing `node:fs` import, then replace the guard at `:311`:
```ts
// 0110 I5 + 0157 R1: an aliased --in/--out cannot pass freshness handling — the stale-output
// clear below would delete the input before the child reads it. Path strings miss aliases
// (case-insensitive APFS, symlinked dirs, hard links), so compare file identity when both exist.
if (existsSync(absInPath) && (absInPath === absOutPath || isSameFile(absInPath, absOutPath))) {
    echoError(`--in and --out alias the same path (${absInPath}); refusing to overwrite the input`);
    return 1;
}
```
```ts
/** True when both paths exist and name the same file (dev+ino; follows symlinks). */
function isSameFile(a: string, b: string): boolean {
    if (!existsSync(b)) return false;
    const sa = statSync(a);
    const sb = statSync(b);
    return sa.dev === sb.dev && sa.ino === sb.ino;
}
```
- `existsSync` follows symlinks, so a dangling `--out` symlink gives `false`, which is correct: no alias.
- `statSync` errors after `existsSync` is true would be a race. They are left to throw, which is an existing class of error; do not add a try.

**R2 — `apps/cli/src/fanout.ts` `runFanout`.** At `:456`:
```ts
// Each target is attempted at most once per run (fanout() contract; spec §5.1 dedupe).
let targets = [...new Set(opts.targets)];
```
The retry branch keeps its own filter-and-dedupe (`:485`). It reads `opts.targets`, and that stays correct because `Set` dedupe is idempotent.

**R3 — fan-in root flags.**
- `apps/cli/src/fanin.ts`:
  - Extend `FaninOptions` with `pluginsRoot?: string; pluginsPath?: string[]`.
  - In `parseArgs`, add two branches copied from `fanout.ts:315-330`, with the same messages: `--plugins-root requires a directory path`, `--plugins-root may be specified only once`, `--plugins-path requires a directory path`.
  - Return them with the conditional-spread pattern used at `:245-251`.
- In `runFanin`, directly after the `parseArgs` try:
```ts
if (opts.pluginsRoot !== undefined && (opts.pluginsPath?.length ?? 0) > 0) {
    echoError('fanin: --plugins-root and --plugins-path are mutually exclusive (ADR-012 R6)');
    return EXIT_USAGE;
}
```
- At `:352`: `const discovery = discoverAllPlugins({ pluginsRoot: opts.pluginsRoot, extraPaths: opts.pluginsPath });`. Update the comment and the `runFanin` JSDoc `@param` usage line.
- `commands/executor.ts`:
  - Add `pluginsRoot?` / `pluginsPath?` to the fan-in `FaninOptions`.
  - Forward them in `runFaninAction` exactly as `runFanoutAction` does (`:116-121`).
  - Register the options via R9's `withFaninOptions`.

**R4 — `apps/cli/src/stage.ts`:**
```ts
/** Checkout root: `apps/cli/{src,dist}` are both three levels below it (bun build keeps import.meta.dir = bundle dir). */
const CHECKOUT_ROOT = resolve(import.meta.dir, '../../..');

export function resolveStagesScript(argv1 = process.argv[1], checkoutRoot = CHECKOUT_ROOT): string {
    // ... package tier unchanged ...
    const fromCheckout = join(checkoutRoot, STAGES_REL);
    if (existsSync(fromCheckout)) return fromCheckout;
    throw new Error(/* unchanged message */);
}
```
- Update the JSDoc: "then the checkout copy located from this module's own path — never the current directory".
- `runStage` signature is unchanged: its callers never need the override.

**R5 + R10 — new `apps/cli/src/plugin-output.ts`.** No zod import: structural types keep `apps/cli` free of a direct zod dependency.
```ts
import type { FileSystem } from '@gobing-ai/ts-runtime';

interface IssueLike { path: PropertyKey[]; message: string }
interface SafeParser<T> {
    safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: IssueLike[] } };
}

/** Render zod issues as `a.b: msg; root: msg` — the single format every executor error uses. */
export function formatIssues(error: { issues: ReadonlyArray<IssueLike> }): string {
    return error.issues.map((i) => `${i.path.map(String).join('.') || 'root'}: ${i.message}`).join('; ');
}

/**
 * Read a plugin's temp output as JSON and validate it.
 * @param label message prefix naming the producer, e.g. `Plugin 'x'`
 * @param violation phrase for schema failures, e.g. `wrote an invalid Result`
 * @throws Error naming `label` on invalid JSON or schema violation
 */
export async function readPluginJson<T>(
    fs: FileSystem, path: string, schema: SafeParser<T>, label: string, violation: string,
): Promise<T> {
    let json: unknown;
    try {
        json = JSON.parse(await fs.readFile(path));
    } catch (err: unknown) {
        throw new Error(`${label} wrote invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new Error(`${label} ${violation}: ${formatIssues(parsed.error)}`);
    return parsed.data;
}
```
- Call sites:
  - `fanout.ts` `pluginDispatch`: `return readPluginJson(fs, outTmp, ResultSchema, \`Plugin '${target}'\`, 'wrote an invalid Result');`
  - `fanin.ts` `collectSourceDocs`: `return readPluginJson(fs, outTmp, DocListSchema, \`Plugin '${source.plugin}'\`, 'output violates the Doc list schema');`
- Both keep their `try { … } finally { await fs.deleteFile(outTmp) }` and the exists check. Resulting messages are byte-identical to today's, and fan-out gains the R5 JSON message.
- If the `path.join` type differs, zod 4 issue `path` is `PropertyKey[]`, hence `.map(String)`. Check that `formatIssues(zodError)` typechecks. If `ReadonlyArray` vs mutable-array variance complains, use `readonly IssueLike[]`.
- Replace the other 5 formatter copies in place: `invoke.ts:353,361-363,449`, `fanin.ts:142`, `fanout.ts:170`.

**R6 — `commands/plugin.ts:84,86,100,112`:** delete the trailing `\n` inside each message literal. Nothing else changes.

**R7 — `invoke.ts`:** cut the `:113-124` block and paste it directly above `export function spawnPluginEntry` (`:152`). Cut `:173-187` and paste it above `killProcessTree`. Keep or add a one-line `/** … */` on `pluginEntryCmd` and `KILL_TREE_SETTLE_MS`.

**R8 — `invoke.ts:410`:** `return proc.exitCode;`, deleting the `const exitCode` line.

**R9 — `commands/executor.ts`:**
```ts
/** Accumulate a repeatable option into an array (commander keeps only the last value otherwise). */
function collectRepeatable(value: string, acc: string[]): string[] {
    acc.push(value);
    return acc;
}

/** Declare the `run` flag contract once for `executor run` and the hidden `invoke` alias. */
function withRunOptions(cmd: Command): Command {
    return cmd
        .requiredOption('--in <path>', …)
        .requiredOption('--out <path>', …)
        .option('--plugins-root <dir>', 'Exclusive root containing plugins (isolation/tests only)')
        .option('--plugins-path <dir>', 'Extra plugin root to union with defaults (repeatable)', collectRepeatable, []);
}
// withFaninOptions / withFanoutOptions likewise; copy the option strings and descriptions verbatim from :140-224.
```
- Usage: `withRunOptions(executor.command('run').argument('<plugin>', …).description(…)).action(runInvokeAction)`, and the same for aliases, keeping `.hidden` / `{ hidden: true }` exactly as today.
- Keep the declaration order within each registrar identical to the current canonical verb, because `--help` output order follows it.
- The fan-in registrar gains `--plugins-root` / `--plugins-path` (R3).

**R11 — kk-core:**
```ts
// packages/kk-core/src/schemas.ts
/** One per-target outcome in a fan-out aggregate (spec §3.1). */
export const TargetOutcomeSchema = z.object({
    target: z.string(),
    ok: z.boolean(),
    status: z.enum(['published', 'failed', 'skipped']),
    url: z.string().optional(),
    id: z.string().optional(),
    error: z.string().optional(),
    durationMs: z.number().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});
/** Fan-out aggregate partial-success result (spec §3.1). */
export const AggregateResultSchema = z.object({
    ok: z.boolean(),
    summary: z.object({ total: z.number(), succeeded: z.number(), failed: z.number(), skipped: z.number() }),
    targets: z.array(TargetOutcomeSchema),
    metadata: z.record(z.string(), z.unknown()).optional(),
});
```
- Following the existing pattern (`schemas.ts:73-79`: `export type Result = z.infer<typeof ResultSchema>`), add `export type TargetOutcome = z.infer<typeof TargetOutcomeSchema>` and `export type AggregateResult = z.infer<typeof AggregateResultSchema>`.
- Export the two schemas and two types from `packages/kk-core/src/index.ts` (the `./schemas` export block at `:37-47`).
- **Behavior change to note:** today a wrong-typed optional field is **dropped** (for example `url: 5`), while Zod would **reject** it. That is acceptable, because the file is kk-written (`--retry-from` reads fan-out's own output), and it is stricter at a trust boundary. Record it in Solution and in the Design doc update. If any existing fanout test feeds a wrong-typed optional field and expects success, that test is the tie-breaker: use `.catch(undefined)` on that optional field rather than editing the test.
- In `fanout.ts` `readAggregateResult`, after the JSON parse:
```ts
if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    echoError(`Result file ${path} is not an aggregate result object`);
    return null;
}
const parsed = AggregateResultSchema.safeParse(json);
if (!parsed.success) {
    echoError(`Result file ${path} violates the aggregate result schema${describeAggregateIssue(json, parsed.error.issues[0])}`);
    return null;
}
return parsed.data;
```
- `describeAggregateIssue` maps the first issue's `path` to the existing message tails:
  - `['targets', i, 'metadata']` → `: target '<targets[i].target>' metadata must be an object`
  - `['targets', i, …]` → ` (target <targets[i].target>)`
  - `['targets', i]` with a non-object entry → ` (target entry)`
  - `['summary', key]` → ` (summary.<key>)`
  - anything else → ` (ok/summary/targets)`
- Before removing the old code, read the exact current strings at `fanout.ts:200-240` and match them character for character.
- In `fanout.ts`, delete the local `TargetOutcome` / `AggregateResult` interfaces (`:22-45`). Replace them with `import { type AggregateResult, AggregateResultSchema, type TargetOutcome } from '@gobing-ai/kk-core'` plus `export type { AggregateResult, TargetOutcome };`.
  - The only other importer is `apps/cli/tests/fanout.test.ts` (checked at task creation with `rg -l "AggregateResult|TargetOutcome" apps plugins packages`), so its imports keep working unedited.
  - Keep the two interfaces' JSDoc on the kk-core schemas.

**Docs (T3, same commit):**
- `docs/04_DESIGN.md` fan-in surface (`:142-186`): add `[--plugins-root <dir> | --plugins-path <dir> …]` to both usage lines (`:151-152`), and state the mutual exclusion and that `--source` discovery honours them. `:173`'s same-registry-as-invoke sentence becomes true; keep it unchanged.
- In the same doc, note on fan-out that repeated `--target` names are deduped.
- `docs/design/fan-in-and-fan-out-specification.md`: add a fan-in bullet next to the plugins-root notes (`:26-29`), and one line in §5.1 or the fan-out args section saying that duplicate `--target` values are deduped on fresh runs too.

### Plan

Execute the steps in order. Each step is test-first: write the AC test, run it and watch it fail on the current code, implement, then run the focused suite green. Line anchors are at `main@d4dd562d`; if they have moved, re-anchor with `rg` on the quoted symbol, never by line number alone.

0. **Baseline.** Run `bun run lint`, `bun test apps/cli` (task-creation baseline: 346 pass / 0 fail / 26 files) and `bun run test` (807/807), and record the counts in Solution. A pre-existing failure is recorded, not fixed here.
1. **R8 + R7 (`invoke.ts`, no behavior change).** Apply the dead-ternary return and move the JSDoc blocks. Run AC7/AC8 `rg`, then `bun test apps/cli/tests/invoke.test.ts`.
2. **R1 / AC1 (alias identity).** Add the three new tests (case variant with the early-return guard, symlinked dir, symlinked file) and see (a)/(b) fail with input deleted. Add `isSameFile` and the extended guard. Focused run: `bun test apps/cli/tests/invoke.test.ts`.
3. **R2 / AC2 (fan-out dedupe).** Add the test, then the one-line `new Set` at `runFanout`. Focused run: `bun test apps/cli/tests/fanout.test.ts`.
4. **R10 + R5 / AC10, AC5.**
   - Write `apps/cli/tests/plugin-output.test.ts` and the AC5 real-dispatch test (`writeFakePublishPlugin` writing `not json`); AC5 fails today with a bare `SyntaxError` text.
   - Create `apps/cli/src/plugin-output.ts`.
   - Switch `pluginDispatch` and `collectSourceDocs` to `readPluginJson`, and replace the other 5 formatter copies with `formatIssues`.
   - Run AC10(a) `rg`. Focused runs: invoke, fanin and fanout tests, plus `plugin-output.test.ts`. Every existing error-string assertion must stay green unedited.
5. **R11 / AC11 (aggregate schema).**
   - Add the kk-core schema tests, then the schemas, types and index exports. Run `bun test packages/kk-core`.
   - Read the exact current messages in `readAggregateResult`, then swap the body for `safeParse` + `describeAggregateIssue`. Remove the local interfaces and re-export from kk-core.
   - Focused run: `bun test apps/cli/tests/fanout.test.ts`; the `:396,519,694,762` assertions must pass unedited. If a test depended on dropping a wrong-typed optional field, apply the `.catch(undefined)` tie-break from Design, never a test edit.
6. **R9 / AC9 (option registrars).**
   - Before editing, capture `--help` for all six commands: `bun apps/cli/src/index.ts executor run --help`, `… executor fan-in --help`, `… executor fan-out --help`, `… invoke --help`, `… fanin --help`, `… fanout --help` into scratch files.
   - Refactor to `collectRepeatable` + `withRunOptions` / `withFaninOptions` / `withFanoutOptions`. Re-capture and `diff` against the pre-refactor captures: expect zero diff for all six. Record the diff output in Solution.
   - Focused run: `bun test apps/cli/tests/commands/executor.test.ts apps/cli/tests/cli.test.ts`.
7. **R3 / AC3 (fan-in root flags).**
   - Add the AC3 tests in `fanin.test.ts` and `commands/executor.test.ts` and see them fail.
   - Extend `FaninOptions` and `parseArgs`, add the mutual-exclusion check, pass `discoverAllPlugins({ pluginsRoot, extraPaths })`, add the options to `withFaninOptions`, and forward them in `runFaninAction`.
   - Re-capture fan-in `--help`: the only diff from step 6 is the two new options.
   - Focused runs: the fanin and executor tests. Also run `bun test apps/cli/tests/kk-daily-ai-voice-workflow.test.ts`; the workflow's fan-in call has no root flags and must be unaffected.
8. **R4 / AC4 (stage resolver).** Add the AC4(a)/(b) tests and see (a) fail. Change `resolveStagesScript`. Apply the two allowed AC4(d) edits. Focused run: `bun test apps/cli/tests/stage.test.ts apps/cli/tests/commands/stage.test.ts`.
9. **R6 / AC6 (diagnostic newlines).** Add the test, then delete the four trailing `\n`. Run the R6 `rg` (no hits). Focused run: `bun test apps/cli/tests/commands/plugin.test.ts`.
10. **Docs (T3, same commit).** Update the `docs/04_DESIGN.md` fan-in usage lines `:151-152`, add the root-flag semantics and the fan-out duplicate-target note, and update `docs/design/fan-in-and-fan-out-specification.md` (`:26-29` notes and the §5.1 line) per Design. No ADR is needed: ADR-012 R6 already defines these flags; this applies them to one more verb.
11. **Gate.** Run, in order:
    - `bun run format`
    - `bun run gate`, which must pass with coverage ≥ 90% lines and functions
    - the AC7 / AC8 / AC9 / AC10 / AC11 / R6 `rg` checks
    - `spur task check 0157 --json`
    - `git status --short`, compared against the AC12 allow-list

    Fix root causes; never use `--no-verify`, `.skip`, or add new `biome-ignore`.
12. **Solution + commit.** Write `### Solution` via `spur task update 0157 --section Solution --from-file <file> --no-lifecycle`. It must cover:
    - per-R summary with `path:line`
    - the AC4(d) existing-test edits
    - the R11 stricter-validation note (wrong-typed optional fields now reject)
    - the AC9 `--help` diff evidence
    - baseline vs final test counts

    Make one conventional commit, `fix(cli): harden executor alias guard, fan-out dedupe, fan-in plugin roots, stage resolver (0157)`, including this task file. Leave the untracked 0155/0156 task files alone.

**Estimate:** about 8 h (R11 ≈ 2 h; R9 ≈ 1.5 h; R3 ≈ 1.5 h; R10+R5 ≈ 1 h; R1 ≈ 1 h; the rest ≈ 1 h).
**Risk hot spots:**
- R11 message compatibility. Mitigation: the four asserted substrings plus `describeAggregateIssue` built from the exact current strings.
- R9 `--help` drift. Mitigation: before/after capture diff.
- AC1(a) on a case-sensitive CI file system. Mitigation: the early-return guard. Linux CI still runs (b)/(c), which fail on the old code too.

### Root Cause

All anchors are at `main@d4dd562d`. Repros were run during the review or during task creation (2026-09-23) against scratch fixtures; they are not in the repo. The AC tests are the in-repo proofs.

- **R1:** Task 0110 I5 added "fresh-output ownership": `runInvoke` unlinks any pre-existing `--out` before spawning (`invoke.ts:387-396`), so that output existing afterwards proves it was written fresh. The alias guard in front of it (`:311`) compares `resolve()`d strings. `resolve` is purely lexical: it neither folds case nor follows symlinks. macOS APFS is case-insensitive by default, so `…/Content.json` and `…/content.json` are one file but two strings, and the same holds for `ld/in.json` when `ld` is a symlink to `d`. The guard passes, `unlinkSync` deletes the input, the plugin reads nothing, and the run ends with "Plugin entry succeeded but did not write output file".
  - Repros:
    - `kk executor run p1 --in …/Content.json --out …/content.json` → exit 1, input deleted.
    - `--in d/in.json --out ld/in.json` (with `ld` → `d`) → input deleted.
  - A symlinked **file** as `--out`, or a hard link, did not lose data in the probe, because `unlink` removes only that name. It is still an alias for the write step.
- **R2:** `parseArgs` appends every `--target` (`fanout.ts:291-296`), and the non-retry path passes `opts.targets` straight to `fanout()` (`:456` → `:500`). Dedupe was written only inside the retry branch (`:485`, 0110 I4/I7), because §5.1 discusses it in the retry context. The docstring invariant ("exactly once per run", `:87`) was never enforced for fresh runs. Repro: an injected dispatch with `--target x --target x` gave 2 calls, exit 0.
- **R3:** Fan-in's `--source` mode (0033/0042) predates ADR-012's multi-root flags. When `run` and `fan-out` gained `--plugins-root` / `--plugins-path` (ADR-012 R6, feature B7), fan-in's call was left as `discoverAllPlugins({})` (`fanin.ts:352`, whose comment claims "Same discovery entry point as runInvoke"). Tests cover sources only through `KK_PLUGIN_PATH` (`fanin.test.ts:290-302` `withPluginPath`), so the gap never showed.
- **R4:** Task 0144 added `kk stage` with a two-tier lookup. The dev tier used `resolve(STAGES_REL)`, which is the current directory, because the tests `chdir` into the repo root. The package tier is correct. The current-directory tier means that any directory containing `plugins/kk/scripts/kk-workflow-stages.ts` supplies the script `kk stage` runs under `bun` whenever the package copy is absent (for example, a non-bundled `bun link` install). Exploitability is LOW, because it needs a planted file plus a missing package copy. The defect is certain.
- **R5:** `pluginDispatch` was written before fan-in's source runner. When fan-in copied the "read temp → parse → validate" block, it added a `try` around `JSON.parse` (`fanin.ts:303-310`), but fan-out's original (`fanout.ts:392`) was never back-ported. The per-target `try` in `fanout()` still catches the `SyntaxError`, so this is not a crash. But the target's `error` is a bare `Unexpected token …` with no plugin name.
- **R6:** `echoError` from `@gobing-ai/ts-utils` writes `${message}\n` (`node_modules/@gobing-ai/ts-utils/dist/output.js:14`). `commands/plugin.ts` was written as if it were `process.stderr.write`. Repro: `kk plugin status` with a broken manifest, piped through `cat -e`, shows `$` lines between diagnostics.
- **R7:** Helpers were inserted between existing JSDoc blocks and their functions: `pluginEntryCmd` (`invoke.ts:125`) in 0110, and `KILL_TREE_SETTLE_MS` (`:188`) with the tree-kill work. Biome does not check doc placement.
- **R8:** A leftover from an earlier shape, where the exit-code mapping sat outside the `if`.
- **R9 (C1):** ADR-011 R4 added hidden one-release aliases by copying each verb's `.option` chain instead of sharing it, and each repeatable flag got its own identical collector. R3 would add two more duplicated option lines per fan-in command.
- **R10 (C2):** No shared helper existed for zod issue text or for plugin-output reading, so each runner re-implemented them. R5 is the drift this caused.
- **R11 (C3):** The aggregate format (spec §3.1) was modelled as a TS `interface` only. Reading a prior result (`--retry-from`, 0110) needed runtime validation, so it was hand-coded field by field (about 90 lines), while every other wire format uses a kk-core Zod schema.

### Solution

Implemented 2026-09-24 on branch `sp/run-0157-7164` (base `5b7fb513`), task scope R1–R11 + AC12 gates.
Every new test was executed against the pre-fix tree first (red evidence below) and then against the
finished tree (green). No `.skip`, no new `biome-ignore`, no `--no-verify`.

#### Change map (per requirement)

| Req | Change | Location |
| ----- | -------- | ---------- |
| R1 | `isSameFile(a, b)` — dev+ino identity, follows symlinks; alias guard rejects `absInPath === absOutPath \|\| isSameFile(...)` | `apps/cli/src/invoke.ts:282`, guard `:319` |
| R2 | Fresh-run target dedupe `let targets = [...new Set(opts.targets)]` (retry subset already deduped at `:428`) | `apps/cli/src/fanout.ts:399` |
| R3 | `FaninOptions.pluginsRoot/pluginsPath` + parse branches (`--plugins-root requires a directory path` / `may be specified only once` / `--plugins-path requires a directory path`), mutual-exclusion guard, discovery honours both | `apps/cli/src/fanin.ts:42,44,227,354,375` |
| R3 | fan-in `FaninOptions` + `runFaninAction` forwards both flags; registrars declare the options | `apps/cli/src/commands/executor.ts:123,145` |
| R4 | `CHECKOUT_ROOT = resolve(import.meta.dir, '../../..')`; `resolveStagesScript(argv1, checkoutRoot = CHECKOUT_ROOT)` — cwd is never a candidate | `apps/cli/src/stage.ts:9,16,26` |
| R5+R10 | New `plugin-output.ts`: `formatIssues` (single issue formatter) + `readPluginJson` (`wrote invalid JSON` / `<label> <violation>: <issues>`) | `apps/cli/src/plugin-output.ts:13,23` |
| R5 | `pluginDispatch` / `collectSourceDocs` call `readPluginJson`; 5 other formatter copies replaced by `formatIssues` | `fanout.ts`, `fanin.ts`, `invoke.ts:361,366,416,456` |
| R6 | Trailing `\n` removed from the 4 stderr literals (double newline under `writeLine`) | `apps/cli/src/commands/plugin.ts:84,86,100,112` |
| R7 | `spawnPluginEntry` docblock moved above the function; `killProcessTree` docblock moved above `killProcessTree`; one-line comments on `pluginEntryCmd` / `KILL_TREE_SETTLE_MS` | `apps/cli/src/invoke.ts:113,135,149,167,196,214` |
| R8 | `return proc.exitCode;` (dropped the `const exitCode` ternary) | `apps/cli/src/invoke.ts:416` |
| R9 | `collectRepeatable` + `withRunOptions` / `withFaninOptions` / `withFanoutOptions`; each verb and its hidden alias register through the same registrar | `apps/cli/src/commands/executor.ts:36,114,123,145,162` |
| R11 | `TargetOutcomeSchema` / `AggregateResultSchema` + `TargetOutcome` / `AggregateResult` types; `readAggregateResult` validates via the schema and maps the first issue back to the existing message tails | `packages/kk-core/src/schemas.ts:43,56,102,104`; exports `packages/kk-core/src/index.ts:41,52`; `apps/cli/src/fanout.ts:159,179,205` |
| T3 docs | fan-in root flags (usage, option table, discovery/mutual-exclusion), fan-out `--target` dedupe, stricter prior-ledger validation | `docs/04_DESIGN.md`; `docs/design/fan-in-and-fan-out-specification.md` |

#### Test-first red evidence (pre-fix tree)

| AC | Command (source reverted to HEAD) | Result |
| ---- | ---------------------------------- | -------- |
| AC1 | `bun test apps/cli/tests/invoke.test.ts` | 3 fail — case variant, symlinked parent dir, `--out` symlinked to input |
| AC2, AC5 | `bun test apps/cli/tests/fanout.test.ts` | 2 fail — dedupe on fresh runs; invalid-JSON target naming |
| AC3 | `bun test apps/cli/tests/fanin.test.ts apps/cli/tests/commands/executor.test.ts` | 7 fail — 5 fanin (root/path/conflict/repeat/no-value) + 2 executor |
| AC4 | `bun test apps/cli/tests/stage.test.ts apps/cli/tests/commands/stage.test.ts` | 2 fail — planted cwd script; default checkout root |
| AC6 | `bun test apps/cli/tests/commands/plugin.test.ts` | 1 fail — diagnostic lines carried `\n\n` |
| AC11 | `bun test packages/kk-core/tests/schemas.test.ts` | error — `Export named 'AggregateResultSchema' not found` |

Static red (HEAD → after): AC7 docblock above `killProcessTree` absent → present (` */` at `:213` above
`:214`); AC8 `exitCode !== 0 ? proc.exitCode` 1 hit → 0; AC9(a) `function collect` 5 → 1; AC9(b)
`'--plugins-root <dir>'` 4 → 3; AC10(a) `issues.map(` in `invoke.ts` 2 → 0; AC11(c)
`typeof t.|typeof sum[` in `fanout.ts` 8 → 0.

#### Green evidence (finished tree)

```text
bun test apps/cli/tests/invoke.test.ts                         21 pass / 0 fail
  (pass) runInvoke > 0157 R1 — --out differing only by letter case is rejected as an alias (case-insensitive fs)
  (pass) runInvoke > 0157 R1 — --out through a symlinked parent directory is rejected as an alias
  (pass) runInvoke > 0157 R1 — --out symlinked to the input file is rejected as an alias
bun test apps/cli/tests/fanout.test.ts                         39 pass / 0 fail
  (pass) runFanout > 0157 R2 — a repeated --target is deduped on fresh runs (each target attempted once)
  (pass) runFanout > 0157 R5 — names the target when its plugin writes invalid JSON (real dispatch)
bun test apps/cli/tests/fanin.test.ts                          32 pass / 0 fail
  (pass) runFanin source-runner mode (--source) > R3 — --plugins-root selects the discovery root for --source without KK_PLUGIN_PATH
  (pass) runFanin source-runner mode (--source) > R3 — --plugins-path unions the extra root into --source discovery
  (pass) runFanin source-runner mode (--source) > R3 — --plugins-root with --plugins-path is a usage error and writes no output
  (pass) runFanin source-runner mode (--source) > R3 — a second --plugins-root is a usage error
  (pass) runFanin source-runner mode (--source) > R3 — --plugins-root with no value is a usage error
bun test apps/cli/tests/commands/executor.test.ts              18 pass / 0 fail
  (pass) registerExecutorCommand > R3 — executor fan-in --plugins-root discovers the source plugin and merges its docs
  (pass) registerExecutorCommand > R3 — the hidden fanin alias accepts --plugins-root and runFaninAction forwards --plugins-path
  (pass) registerExecutorCommand > R9 — each verb and its hidden alias render an identical options block
bun test apps/cli/tests/stage.test.ts                           6 pass / 0 fail
  (pass) resolveStagesScript > ignores a cwd-relative planted script — the checkout root is never the current directory
  (pass) resolveStagesScript > defaults the checkout root to this module, independent of the current directory
bun test apps/cli/tests/commands/stage.test.ts                  6 pass / 0 fail   (AC4(c)/(d) tests unedited except the 2 allowed second-argument edits + title rename)
bun test apps/cli/tests/commands/plugin.test.ts                14 pass / 0 fail
  (pass) registerPluginCommand > R6 — diagnostic lines carry no trailing blank line (no double newline in stderr)
bun test apps/cli/tests/plugin-output.test.ts                   6 pass / 0 fail
  (pass) formatIssues > 0157 R10 — renders an empty issue path as the `root` prefix
  (pass) readPluginJson > 0157 R10 — throws `<label> wrote invalid JSON: …` when the file is malformed JSON
bun test packages/kk-core/tests/schemas.test.ts                13 pass / 0 fail
  (pass) AggregateResultSchema > 0157 R11 — accepts a valid aggregate including per-target metadata
  (pass) AggregateResultSchema > 0157 R11 — rejects a bad status enum
  (pass) AggregateResultSchema > 0157 R11 — rejects primitive metadata on a target
  (pass) AggregateResultSchema > 0157 R11 — strips unknown keys (hand-parser parity)
```

Static checks after the change (recorded verbatim):

```text
$ rg -n -B1 "^export function spawnPluginEntry\b|^async function killProcessTree\b" apps/cli/src/invoke.ts
148- */
149:export function spawnPluginEntry(opts: PluginEntrySpawnOptions): PluginEntrySpawnResult {
--
213- */
214:async function killProcessTree(pid: number): Promise<void> {
# AC7's literal pattern also lists `^function killProcessTree` / `^export function killProcessTree`; the
# declaration is `async function`, so only spawnPluginEntry matches that alternation. Intent (a ` */`
# docblock directly above each function) is verified by the async-aware form above.

$ rg -n "exitCode !== 0 \? proc.exitCode" apps/cli/src          → no hits (AC8)
$ rg -c "function collect" apps/cli/src/commands/executor.ts    → 1 (AC9a)
$ rg -c "'--plugins-root <dir>'" apps/cli/src/commands/executor.ts → 3 (AC9b)
$ rg -n "issues\.map\(" apps/cli/src                            → only apps/cli/src/plugin-output.ts:14 (AC10a)
$ rg -n "typeof t\.|typeof sum\[" apps/cli/src/fanout.ts        → no hits (AC11c)
```

AC9(c) `--help` parity is asserted in-test (`R9 — each verb and its hidden alias render an identical
options block`), comparing the full `Options:` block of `run`/`invoke`, `fan-in`/`fanin`,
`fan-out`/`fanout`.

#### Gates (AC12)

```text
$ bun run gate            → exit 0
1311 pass / 0 fail, 5087 expect() calls, 83 files
All files 98.67 % funcs / 98.21 % lines   (threshold: ≥90 / ≥90)
apps/cli/src/plugin-output.ts 100.00 / 100.00 | apps/cli/src/stage.ts 100.00 / 100.00
packages/kk-core/src/schemas.ts 100.00 / 100.00 | packages/kk-core/src/index.ts 100.00 / 100.00
$ spur rule run --preset recommended-post-check --fail-on warning
All 2 rules passed — no violations found.
$ spur task check 0157 --json  → pass: true, findings: [L4.missing-feature-id] (only the expected orphan warning)
```

`git status --short` lists only: `apps/cli/src/{invoke,fanin,fanout,stage}.ts`,
`apps/cli/src/plugin-output.ts` (new), `apps/cli/src/commands/{executor,plugin}.ts`,
`apps/cli/tests/{invoke,fanin,fanout,stage}.test.ts`, `apps/cli/tests/plugin-output.test.ts` (new),
`apps/cli/tests/commands/{executor,plugin,stage}.test.ts`,
`packages/kk-core/src/{schemas,index}.ts`, `packages/kk-core/tests/schemas.test.ts`,
`docs/04_DESIGN.md`, `docs/design/fan-in-and-fan-out-specification.md`, this task file.

#### Behavior changes recorded

- **R11 (stricter prior ledger).** `readAggregateResult` now validates with `AggregateResultSchema`, so a
  wrong-typed optional field (e.g. `url: 5`) is a named input error instead of a silently dropped field.
  Accepted: the file is kk-written and stricter is correct at this trust boundary. No existing fanout test
  fed a wrong-typed optional field, so no `.catch(undefined)` was needed. Top-level `metadata` now survives
  the read (previously dropped); no consumer reads it, so this is inert. Documented in `docs/04_DESIGN.md`
  §1.6 and in the spec's fan-in/fan-out notes.
- **R3 (new fan-in surface).** `--plugins-root` / `--plugins-path` are new for `fan-in`; combining them is a
  usage error (exit 2). Documented in `docs/04_DESIGN.md` §1.5 and the spec's dated correction block.
- **R6 (stderr shape).** Diagnostic output loses its trailing blank line: one newline per message, no `\n\n`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/invoke.ts:281-287` `isSameFile` compares `statSync` `dev`+`ino`; guard at `apps/cli/src/invoke.ts:319-321` rejects before `unlinkSync` at `apps/cli/src/invoke.ts:393`. Tests `apps/cli/tests/invoke.test.ts:430`, `:455`, `:480` passed in `bun test` (155 pass / 0 fail across the 9 AC files): exit 1, stderr contains `alias the same path`, input bytes unchanged, entry marker absent. |
| R2 | MET | `apps/cli/src/fanout.ts:397-399` `let targets = [...new Set(opts.targets)]` before `validateTargets` at `apps/cli/src/fanout.ts:439`; retry dedupe remains at `apps/cli/src/fanout.ts:428`. Test `apps/cli/tests/fanout.test.ts:268-285` passed: `called` `['a','b']`, `summary.total === 2`, exit 0. |
| R3 | MET | Hand parser `apps/cli/src/fanin.ts:227-241`; mutual exclusion at `apps/cli/src/fanin.ts:353-356` before any file read (`:363`); `--source` discovery `apps/cli/src/fanin.ts:375`. Registrar `apps/cli/src/commands/executor.ts:140-141`; argv rebuild `apps/cli/src/commands/executor.ts:78-82`. Tests `apps/cli/tests/fanin.test.ts:333`, `:351`, `:369`, `:392`, `:414` and `apps/cli/tests/commands/executor.test.ts:286`, `:315` passed. |
| R4 | MET | `apps/cli/src/stage.ts:8-16` `CHECKOUT_ROOT = resolve(import.meta.dir, '../../..')` and `resolveStagesScript(argv1, checkoutRoot = CHECKOUT_ROOT)`; checkout candidate is `join(checkoutRoot, STAGES_REL)` at `apps/cli/src/stage.ts:26-30`. Planted-cwd test `apps/cli/tests/stage.test.ts:28-36` throws `/install or refresh the kk package/`; default-root test `apps/cli/tests/stage.test.ts:38-42` passed after `chdir`. |
| R5 | MET | `apps/cli/src/fanout.ts:336-338` `readPluginJson(..., ResultSchema, Plugin '<target>', 'wrote an invalid Result')`. Test `apps/cli/tests/fanout.test.ts:837-861` passed: exit 1, `status: 'failed'`, error contains `Plugin 'fake-pub' wrote invalid JSON`. |
| R6 | MET | `apps/cli/src/commands/plugin.ts:84`, `:86`, `:100`, `:112` `echoError` calls have no trailing `\n`. `rg -n 'echoError\(.*\\n.\)' apps/cli/src` exit 1 (no hits). Test `apps/cli/tests/commands/plugin.test.ts:217-233` passed: `err.includes('\n\n')` is false. |
| R7 | MET | `rg -n -B1` shows ` */` at `apps/cli/src/invoke.ts:148` above `export function spawnPluginEntry` at `:149`, and ` */` at `apps/cli/src/invoke.ts:213` above `async function killProcessTree` at `:214`. `pluginEntryCmd` one-line doc at `apps/cli/src/invoke.ts:114`; `KILL_TREE_SETTLE_MS` at `apps/cli/src/invoke.ts:170`. |
| R8 | MET | `apps/cli/src/invoke.ts:413-416` returns `proc.exitCode` inside `if (proc.exitCode !== 0)`. `rg -n 'exitCode !== 0 \? proc.exitCode' apps/cli/src` exit 1 (no hits). Non-zero-exit invoke tests stayed green in the 21-test invoke file. |
| R9 | MET | `apps/cli/src/commands/executor.ts:36` `collectRepeatable`; registrars `withRunOptions` `:114`, `withFaninOptions` `:123`, `withFanoutOptions` `:145`, applied to canonical verbs and hidden aliases at `:167-203`. `rg -c 'function collect'` = 1; `rg -c "'--plugins-root <dir>'"` = 3. Test `apps/cli/tests/commands/executor.test.ts:110` passed. `diff` of `bun apps/cli/src/index.ts executor fan-in --help` vs `fanin --help` (and run/invoke, fan-out/fanout) exited 0. |
| R10 | MET | `apps/cli/src/plugin-output.ts:13` `formatIssues` and `:23` `readPluginJson`. `rg -n 'issues\.map\(' apps/cli/src` hits only `apps/cli/src/plugin-output.ts:14`. `apps/cli/tests/plugin-output.test.ts:21` and the five sibling cases passed (6/0). Call sites `apps/cli/src/fanin.ts:327` and `apps/cli/src/fanout.ts:338`. |
| R11 | MET | `packages/kk-core/src/schemas.ts:43-61` `TargetOutcomeSchema` / `AggregateResultSchema`; types `:102-104`; exports `packages/kk-core/src/index.ts:41-53`. `apps/cli/src/fanout.ts:205` `AggregateResultSchema.safeParse`. `rg` for `typeof t.` and `typeof sum[` in `apps/cli/src/fanout.ts` exit 1 (no hits). Schema tests `packages/kk-core/tests/schemas.test.ts:115`, `:124`, `:130`, `:136` passed (schemas file 13/0). Message tails still asserted at `apps/cli/tests/fanout.test.ts:416`, `:539`, `:714`, `:782`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `bun test apps/cli/tests/invoke.test.ts` (21 pass / 0 fail inside the 155/0 focused run). `apps/cli/tests/invoke.test.ts:430` case variant, `:455` symlinked parent, `:480` symlinked `--out`: each expects exit 1, `alias the same path`, unchanged input bytes, marker absent. Same-string 0110 test unedited and green. |
| AC2 | MET | test | `apps/cli/tests/fanout.test.ts:268-285` passed inside `bun test apps/cli/tests/fanout.test.ts` (39 pass / 0 fail): `called` equals `['a','b']`, `summary.total === 2`, exit 0. Retry-dedupe tests stayed green. |
| AC3 | MET | test | `apps/cli/tests/fanin.test.ts:333`, `:351`, `:369` (exit 2, `mutually exclusive`, no `--out`), `:392`, `:414` passed (fanin file 32/0). Commander tests `apps/cli/tests/commands/executor.test.ts:286` and `:315` passed (executor file 18/0). |
| AC4 | MET | test | `apps/cli/tests/stage.test.ts:28-36` planted cwd throws; `:38-42` default checkout root ignores cwd (stage file 6/0). `apps/cli/tests/commands/stage.test.ts` 6/0, including the checkout-relative title. AC4(d) edits are the `/nonexistent-checkout` second argument only (`apps/cli/tests/stage.test.ts:23`, commands stage test). |
| AC5 | MET | test | `apps/cli/tests/fanout.test.ts:837-861` real `pluginDispatch`: exit 1, target `status: 'failed'`, error contains `Plugin 'fake-pub' wrote invalid JSON`. Fanout file 39 pass / 0 fail. |
| AC6 | MET | test | `apps/cli/tests/commands/plugin.test.ts:217-233` passed (plugin file 14/0): stderr contains `[` and `err.includes('\n\n')` is false. |
| AC7 | MET | command | `rg -n -B1 '^export function spawnPluginEntry\b\|^async function killProcessTree\b' apps/cli/src/invoke.ts` exit 0: `apps/cli/src/invoke.ts:148` ` */` above `:149`, and `:213` ` */` above `:214`. |
| AC8 | MET | command | `rg -n 'exitCode !== 0 \? proc.exitCode' apps/cli/src` exit 1 (no hits). Invoke non-zero-exit tests stayed green (21 pass / 0 fail). |
| AC9 | MET | test | `rg -c 'function collect' apps/cli/src/commands/executor.ts` = 1. `rg -c "'--plugins-root <dir>'" apps/cli/src/commands/executor.ts` = 3. Test `apps/cli/tests/commands/executor.test.ts:110` passed. Help-option `diff` for run/invoke, fan-in/fanin, and fan-out/fanout each exited 0. |
| AC10 | MET | test | `rg -n 'issues\.map\(' apps/cli/src` only `apps/cli/src/plugin-output.ts:14`. `apps/cli/tests/plugin-output.test.ts` 6 pass / 0 fail. `git show 29bf6447 -- apps/cli/tests` existing-assertion edits are only AC4(d) plus the AC4(c) title rename. |
| AC11 | MET | test | `packages/kk-core/tests/schemas.test.ts:115-148` four R11 cases passed (schemas file 13/0). Unedited substrings at `apps/cli/tests/fanout.test.ts:416`, `:539`, `:714`, `:782` passed in the 39/0 fanout run. `rg` for `typeof t.` / `typeof sum[` in `apps/cli/src/fanout.ts` exit 1. |
| AC12 | MET | command | `bun run gate` exit 0 this run: format clean, build exit 0, pre-check 48 rules passed, `1311 pass / 0 fail / 83 files`, coverage funcs 98.67% lines 98.21%, post-check 2 rules passed. `spur task check 0157 --json` pass true, only finding `L4.missing-feature-id`. Implementation commit `29bf6447` is exactly the AC12 allow-list (20 paths). Live `git status --short` dirties only unrelated 0156 files, which the AC says to leave alone; no 0157 path is dirty. No `.skip`, no new `biome-ignore`, no `--no-verify` in `git show 29bf6447`. Re-verify rewrote `.spur/run/0157-verify-answer.txt` and `.spur/run/0157-verdict.json`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

SECUA + functional traceability + architecture-depth review of task 0157's change set. Fresh-session
reviewer on a distinct executor/model (`--auto`), reading only the task spec, the recorded diff, and the
run artifacts.

| Priority | Finding | Disposition |
|----------|---------|-------------|
| P1 (blocker) | None | N/A |
| P2 (major) | `describeAggregateIssue`'s `targetName()` (`apps/cli/src/fanout.ts:167-168`) returns the literal string `undefined` when a Zod issue path indexes outside `targets`, or when an entry lacks `.target`. Unreachable today — Zod paths index real positions and `TargetOutcomeSchema` enforces `target: z.string()` — and no test exercises it | Accepted residual: advisory only, no fix needed for merge; recorded for a later hardening pass (fixing it now would invalidate the captured proof digest) |
| P3 (minor) | None | N/A |
| P4 (nit) | None | N/A |

**Traceability (dimension 1) — PASS.** Every R1–R11 lands at the cited `file:line`, and the AC1–AC12 tests
assert behavior rather than echoing the implementation's wording. Static checks re-confirmed
independently: AC7 docblock adjacency (`invoke.ts:148`→`:149`, `:213`→`:214`); AC8 no
`exitCode !== 0 ? proc.exitCode` anywhere in `apps/cli/src`; AC9(a) exactly one `collectRepeatable`;
AC9(b) three `'--plugins-root <dir>'` registrar occurrences; AC10(a) `issues.map(` only in
`plugin-output.ts:14`; AC11(c) no `typeof t.` / `typeof sum[` in `fanout.ts`; R6 no `echoError(…\n)` in
`commands/plugin.ts`. The four prior-ledger message tails remain reachable through the new
path-mapping in `readAggregateResult`.

**SECUA (dimension 2) — PASS.** *Security:* no new unvalidated input path; `isSameFile` uses `statSync`
(following symlinks is the intent) and is short-circuited behind `existsSync(absInPath)`, so a missing
path is never stat'ed; the guard sits before the stale-output `unlinkSync`. *Efficiency:* the `Set`
dedupe is O(n); plugin discovery stays one call per run. *Correctness:* the fan-in mutual-exclusion
guard runs after argument parsing but before any file I/O; `[...new Set(opts.targets)]` preserves
first-seen order and leaves the retry branch's own dedupe intact. *Usability:* named error messages are
retained and the diagnostic double-newline is gone. *Architecture:* kk-core keeps schema ownership and
`apps/cli` gains no direct `zod` dependency (`plugin-output.ts` uses structural types).

**Architecture depth (dimension 3) — PASS.** `plugin-output.ts` collapses five duplicated formatter
copies into one seam; the `with*Options` registrars remove verb/alias CLI-surface drift; `CHECKOUT_ROOT`
anchors to `import.meta.dir`, so both the dev (`apps/cli/src`) and bundled (`apps/cli/dist`) layouts
resolve without depending on the current directory; docs ship in the same change (T3).

**Scope discipline.** 19 modified + 2 new files, exactly the AC12 allow-list (re-verified with
`git status --short` in this run). No `.skip`, no new `biome-ignore`, no `--no-verify`; existing-test
edits are limited to the two permitted AC4(d) call sites plus the AC4(c) title rename.

**Residual risk:** Low — one advisory P2 with no reachable input; every other behavior is covered by a
test shown red pre-fix and green post-fix.

**Disposition:** Approve — proceed to verification.

### References

- **Origin:** the standalone `/sp:dev-review apps --agent inline --focus all` pass on 2026-09-23 at `main@d4dd562d`. It produced findings #1–#8 (R1–R8) and architecture candidates C1–C3 (R9–R11). All of them are in scope, at the operator's request.
- **Related tasks:**
  - `0110` (plugin packaging/execution contracts): I5 introduced the alias guard and the stale-output unlink (R1); I4/I7 introduced the retry dedupe and the aggregate read (R2, R11).
  - `0033` / `0042`: fan-in / fan-out origin (R3, R5).
  - `0144`: `kk stage` two-tier resolver (R4).
  - `0155` (packages review): shares `packages/kk-core/src/index.ts` (R11 adds exports).
  - `0156` (plugins review): declined the invoke/fan-out overall timeout; shares `docs/04_DESIGN.md` in different rows.
- **Decisions and specs:**
  - `docs/00_ADR.md` ADR-011 R4: hidden one-release aliases (R9).
  - ADR-012 R6: `--plugins-root` / `--plugins-path` mutual exclusion (R3).
  - `docs/design/fan-in-and-fan-out-specification.md`: §3.1 aggregate shape (R11); §5.1 `:153-170` dedupe (R2); `:11,26-29` plugins-root notes (R3).
  - `docs/04_DESIGN.md:142-186`: fan-in surface (R3); `:188-200`: fan-out.
- **Consumers to keep green:** `plugins/kk/workflows/kk-daily-ai-voice.yaml:98` (fan-in `--source`, no root flags).
- **Code anchors:** listed per requirement in Background, Requirements and Design. Re-anchor with `rg` on the named symbol if lines have moved.

#### API / library claim sources and confidence

| Claim | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| `fs.Stats` exposes `dev` and `ino`; equal `dev`+`ino` identifies the same file | https://nodejs.org/api/fs.html#class-fsstats | Session probe (scratch, not in repo): `statSync('CaseProbe.json')` and `statSync('caseprobe.json')` → same `dev`/`ino`; different files → different `ino` | HIGH |
| `statSync` follows symlinks (`lstatSync` does not) | https://nodejs.org/api/fs.html#fsstatsyncpath-options | Session probe: `statSync('ld/in2.json')` (`ld` → `d`) equals `statSync('d/in2.json')` on `dev` and `ino` | HIGH |
| `path.resolve` is lexical: it neither folds case nor resolves symlinks | https://nodejs.org/api/path.html#pathresolvepaths | The R1 repros depend on it | HIGH |
| The default macOS APFS volume is case-insensitive | https://support.apple.com/guide/disk-utility/file-system-formats-dsku19ed921c/mac | Session probe: `existsSync('caseprobe.json')` is true for `CaseProbe.json` | HIGH |
| Bun `realpathSync` returns on-disk case on macOS (context for the Q&A choice) | https://nodejs.org/api/fs.html#fsrealpathsyncpath-options | Session probe, Bun 1.3.14: `realpathSync('caseprobe.json')` → `…/CaseProbe.json` | HIGH (observed); not relied on |
| `bun build --target=bun` leaves `import.meta.dir` as a runtime expression, so it equals the bundle's directory | https://bun.com/docs/api/import-meta · https://bun.com/docs/bundler | Session probe: a bundled `dist/index.js` printed `…/imd/dist`, and the output kept `import.meta.dir` verbatim | HIGH |
| `echoError` appends `\n` | `node_modules/@gobing-ai/ts-utils/dist/output.js:14` (`target.write(\`${message}\n\`)`) | Review repro via `cat -e` | HIGH |
| Commander keeps only the last value of a repeated option unless a collector function is supplied | https://github.com/tj/commander.js#custom-option-processing | The existing `collect*` functions depend on it (`commands/executor.ts:34-106`) | HIGH |
| Zod `z.object` strips unknown keys by default; `.safeParse` returns `{ success, data \| error.issues }` with `issues[].path` | https://zod.dev/api#objects · https://zod.dev/basics#handling-errors | Every existing `safeParse` site in `apps/cli/src` uses this shape | HIGH |
| `apps/cli` has no direct `zod` dependency | `apps/cli/package.json:49-52` | Read at task creation | HIGH |
| `fanout()` promises once-per-target; the fresh path does not dedupe | `apps/cli/src/fanout.ts:87`, `:456` | Review repro: 2 dispatch calls for `--target x --target x` | HIGH |
| Only `apps/cli/tests/fanout.test.ts` imports `AggregateResult` / `TargetOutcome` outside `fanout.ts` | `rg -l "AggregateResult\|TargetOutcome" apps plugins packages` | Run at task creation | HIGH |
| Exploitability of the R4 current-directory fallback | Inferred | Requires a planted file plus a missing package copy | LOW (exploitability); HIGH (defect exists) |

#### Adjustments since the review

- **#1 extended:** the review reproduced the case-variant alias. Task-creation probes added:
  - a symlinked parent directory: also deletes the input, so it is in scope
  - a symlinked `--out` file and a hard link: no deletion, because `unlink` removes only that name, but the plugin still writes through the alias. The identity check covers them.
- **#6 extended:** the review listed `plugin.ts:84,86`. The `rg` sweep also found `:100` (a single-quoted string) and `:112`.
- **#4 test impact:** the review named only `apps/cli/tests/stage.test.ts`. `apps/cli/tests/commands/stage.test.ts` also has a test that relies on the current directory ("fails loud naming the attempted path …"), so there are two allowed test edits (AC4(d)).
- **C3 placement:** decided to use kk-core, because `apps/cli` has no direct zod dependency (Q&A).

### History

- 2026-09-24T06:52:54.724Z todo → wip (system)
- 2026-09-24T08:06:02.873Z wip → testing (system)
- 2026-09-24T08:10:17.407Z testing → done (system)

