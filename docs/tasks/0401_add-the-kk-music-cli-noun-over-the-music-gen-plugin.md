---
schema_version: 1
name: Add the kk music CLI noun over the music-gen plugin
status: done
template: feature-impl
created_at: 2026-11-18T22:16:15.981Z
updated_at: "2026-11-19T08:18:43.880Z"
feature_id: D8

ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 8
dependencies: ["0398", "0399", "0400", "0405"]
done_forced: "false"
done_reason: unforced close
---

## 0401. Add the kk music CLI noun over the music-gen plugin

### Background

Implements: R1 — noun/verb surface; R2 — config resolution incl. prices and delivery profiles; R3 — free verbs stay offline; R4 — machine output; R5 — help and plugin-check parity.

The CLI is the platform's step owner ("`kk` owns steps; `spur workflow` owns orchestration") and it has already been reshaped into a two-layer executor + plugin noun surface with typed noun/verb registration (features A21/A22, task 0052). Music needs the same treatment so a workflow state, an agent skill and a human share one command surface instead of three ad-hoc scripts.

Config resolution has an established shape too: user config roots with environment overrides (feature M), so an endpoint belongs in config, never in code — which matters here because the instance address is machine-specific and, once tunnelled, may move behind Cloudflare Access.

### Requirements

- [x] R1. Register a `music` noun with verbs `render`, `gen`, `library`, `analyze`, `check`, `master`, `presets` on the existing two-layer CLI surface. Each verb delegates to the plugin functions that own the behaviour: render/presets → 0397/0399, gen/analyze/library → 0398 behind the 0400 spend guard, check/master → 0405. No logic is duplicated in the CLI or the YAML.
- [x] R2. Resolve plugin configuration from a `music:` block in the user config root with `KK_MUSIC_*` environment overrides and documented defaults: `baseUrl`, `timeoutMs`, `defaultModel`, `takesCap` (≤ 4), `prices.{pro,clip,analyze}`, `delivery.<profile>`. Fail with a one-line remediation naming the config key when the endpoint is unreachable.
- [x] R3. Keep `render`, `presets list`, `check` and `master` free of instance traffic (prompt/preset inspection and local ffmpeg only), so a brief can be reviewed and diffed before any spend and a take can be re-checked or re-mastered without re-paying.
- [x] R4. Emit `--json` for every verb with a stable shape (artifact paths, instance ids, digests, `paid`, spend, measurements, check results) for workflow and skill consumption, and human-readable output otherwise.
- [x] R5. Make `kk music --help` and `kk plugins check` agree: every verb documents its paid/free nature (`gen` and `analyze` paid; the rest free), and the plugin's declared requirements (including `ffmpeg`/`ffprobe` for `check`/`master`) match the imports and binaries it actually uses.

### Acceptance Criteria

```gherkin
Scenario: AC1 — The noun is registered on the shared surface (req: R1)
  Given the CLI registration
  When kk music --help runs
  Then render, gen, library, analyze, check, master and presets are listed with their arguments
  And gen and analyze refuse without --yes through the 0400 guard

Scenario: AC2 — Config comes from the user root with an env override (req: R2)
  Given a user config with a base URL and an environment override for the same key
  When any networked verb resolves its endpoint
  Then the environment value wins and is reported in verbose output
  And with no config and no override the documented default is used
  And an unreachable endpoint yields a one-line remediation naming the config key
  And takesCap above 4 is rejected at load

Scenario: AC3 — Free verbs never reach the instance (req: R3)
  Given render, presets list, check and master on an existing take
  When they run with the instance unreachable
  Then all four succeed
  And none attempts a connection to the instance

Scenario: AC4 — JSON output is stable and complete (req: R4)
  Given completed gen, analyze, check and master runs in dry-run mode
  When each verb is invoked with --json
  Then each payload carries artifact path, instance id, digest, paid and spend, plus measurements and check results where applicable
  And a snapshot test pins each shape

Scenario: AC5 — Help and plugin check agree (req: R5)
  Given the registered verbs and the plugin code
  When kk music --help and kk plugins check run
  Then gen and analyze are marked paid and the rest free
  And declared runtime requirements, including ffmpeg and ffprobe, match actual usage
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- **Register, do not re-implement.** Workflow states call `kk music <verb>`, and the verbs call the plugin's `src/` functions, so a behaviour change lands once.
- **Paid-verb marking.** Help text and the JSON payload both carry `paid: true|false`. Agent skills and humans read it, and the workflow's confirmation gate keys off it.
- **Config keys.** `music.{baseUrl,timeoutMs,defaultModel,takesCap,prices,delivery}` with `KK_MUSIC_*` overrides. Nothing machine-specific is committed, which keeps the plugin portable across the operator's machines. `lufsTarget` from the first draft is replaced by named delivery profiles (0405 R5).
- **Dependency.** Blocked by 0398, 0399, 0400 and 0405 (the verbs wrap their functions).
- **Estimate.** 8h: seven verbs, config block, JSON shapes and snapshots, help text, tests.

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

`kk music` is a thin CLI noun over the music-gen plugin: seven verbs, one config
reader, one output seam. No prompt rendering, spend rule, ffmpeg argv or HTTP moved
into `apps/cli` — every verb calls the plugin function that owns it (0397/0398/0399/
0400/0405). The noun obeys the A22 surface rule (two command words, each with an
action), so `presets` is the listing verb rather than a `presets list` group.

| Change | Where | Why |
| --- | --- | --- |
| `music` noun: `render`, `presets`, `gen`, `library`, `analyze`, `check`, `master` | `apps/cli/src/commands/music/index.ts:68` | R1/R5: one delegate per verb; every help line states paid (`gen`, `analyze`) or free and what the free ones touch |
| Verb bodies (brief → presets → plugin call → payload) | `apps/cli/src/commands/music/verbs.ts:196` (`runRender`), `:242` (`runPresets`), `:271` (`runLibrary`), `:289` (`runGen`), `:385` (`runAnalyze`), `:424` (`runCheck`), `:459` (`runMaster`) | R1/R4: each verb is the plugin call plus the payload. `gen` stages the plugin's `--in` DocList contract (`docs[0].body` + `metadata.musicGen`) beside `--out` and deletes it, so the generator entry is reused, not re-implemented |
| Payload envelope `{verb, paid, dryRun, artifactPath, instanceId, digest, spend, measurements, checks}` | `apps/cli/src/commands/music/verbs.ts:74`, `:87` | R4: the same nine keys on every verb, `null` where the verb has no such value, so a skill or workflow reads one shape; verb-specific keys (`prompt`, `request`, `explain`, `takes`, `analysis`, `profile`, `formats`, `themes`) follow the envelope |
| Free verbs build no client | `apps/cli/src/commands/music/verbs.ts:196,242,424,459` | R3: `render`, `presets`, `check`, `master` contain no call site of `musicSeams.createClient`, so no socket is reachable from them (test asserts the factory is never invoked) |
| Runtime seams `resolveConfig` / `createClient` / `audioRunner` / `configPath` | `apps/cli/src/commands/music/runtime.ts:25`, `:37` | R2/R3 testability: the adapter and the ffmpeg runner are the plugin's own seams, so "no client built" and check/master payloads are provable without a socket or a local ffmpeg |
| Failure mapping + `--verbose` config report | `apps/cli/src/commands/music/runtime.ts:62`, `:86` | AC2: a connect-kind `InstanceError` becomes one line naming `music.baseUrl` (`KK_MUSIC_INSTANCE_URL`) and the config file; `--verbose` prints each key with the layer that won (`env` / `config` / `default`) |
| `music.defaultModel` + `KK_MUSIC_DEFAULT_MODEL` (default `pro`, validated to `pro|clip`) and its `sources` entry | `plugins/generations/music-gen/src/config.ts:40`, `:46`, `:71`, env/parse/resolve at `:315`, `:416`, `:431`, `:448` | R2's `defaultModel`: it rides the one reader (env > `music:` > default) like every other setting, and reports where it came from |
| `defaultModel` used only where nothing else answers — a `workflow` layer built when neither the brief nor the named format preset names a model | `apps/cli/src/commands/music/verbs.ts:126` | R2 without breaking 0397 precedence: an authored `model:` and a shipped format preset's `model` still win, so config cannot silently retarget a paid call |
| Manifest declares the `ffmpeg`/`ffprobe` binaries the 0405 measure/master path spawns | `plugins/generations/music-gen/plugin.json:13` | R5/AC5: declared requirements match actual usage; the plugin's manifest test now separates binaries from import specifiers instead of weakening the equality check |
| CLI tests for AC1–AC5 through `main()` + the output seam | `apps/cli/tests/commands/music.test.ts:1` | AC1–AC5: registration/help/refusals, verbose env-over-config, `takesCap` rejection, one-line unreachable remediation, free verbs never building a client, and payloads pinned key-for-key by explicit expected objects (the repo has no `toMatchSnapshot` convention; the pin is a full-object comparison) |
| Canonical A22 surface updated with the new noun and its seven leaves | `apps/cli/tests/main.test.ts:87`, `:238` | R1: the shipped noun inventory is an explicit list; adding a noun must change it deliberately |
| File IO through the injected `musicSeams.fileSystem` seam — brief read, `<take>.take.json` probe, prompt `--out` write, `gen` staging write + cleanup | `apps/cli/src/commands/music/verbs.ts:114` (`readBrief`), `:173` (`readSidecar`), `:222` (`--out`), `:327`/`:338`/`:392` (`gen` staging); seam declared+built at `apps/cli/src/commands/music/runtime.ts:41`, `:49` | Rule `no-direct-fs-io`: the four sites are ordinary async text IO, so they ride the sanctioned `createNodeFileSystem()` seam rather than an exemption (the exemption list is only for sync-structural sites). Behaviour held exactly: the sidecar probe stays a predicate (`exists` first) so a missing sidecar is still `null`, never an error, and `deleteFile`'s force/recursive semantics keep the `finally` cleanup unconditional |
| Per-file test modules for the two `music/` source files | `apps/cli/tests/commands/music/verbs.test.ts:1`, `apps/cli/tests/commands/music/runtime.test.ts:1` | `require-corresponding-test` maps source → mirrored test path, which the AC suite `apps/cli/tests/commands/music.test.ts` does not satisfy. `verbs.test.ts` pins the verb-body contracts (missing sidecar is `null`, prompt/staging IO through an injected `FileSystem`, envelope key order); `runtime.test.ts` pins the process boundary (`musicFailure` exit codes, error ids, one-line rule; `writeConfigReport` layers; `isVerbose` through nesting; the production seams) |

AC interpretations:

- **AC1 "gen and analyze refuse without --yes"** is the 0400 guard surfacing through
  the CLI: `gen` reaches `planGeneration`/`requireConfirmation`, `analyze` reaches
  `analyzeTake`; both print a refusal naming `--yes` and exit non-zero.
- **AC2 "an unreachable endpoint yields a one-line remediation naming the config
  key"** is mapped once (`runtime.ts:62`). `takesCap > 4` is rejected at load by the
  plugin's `resolveTakesCap`, so the CLI never acts on a 5-take config; the message
  names `music.takesCap`.
- **AC3 "free of instance traffic"** is structural (no `createClient` call site) and
  asserted: the test points `KK_MUSIC_INSTANCE_URL` at a dead port and injects a
  factory that throws, then runs all four free verbs and asserts it was never called.
- **AC4 "completed runs in dry-run mode"** — `gen`/`analyze` run on the offline
  adapter (`KK_MUSIC_DRY_RUN=1`); `check`/`master` are local ffmpeg verbs whose
  "dry run" is the injected `AudioToolRunner` replaying the captured 0405 fixtures,
  so CI needs no ffmpeg. Payloads are asserted as whole objects, never via log text.
- **AC5 "help and plugin check agree"** — paid/free is on each help line and in the
  `paid` flag; the manifest test holds `runtime.requires` to the real imports plus
  the two binaries, which now appear exactly once each in sorted order.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — music noun with render/gen/library/analyze/check/master/presets, each a thin delegate | MET | `apps/cli/src/commands/music/index.ts:70` (noun) and `:78`/`:91`/`:102`/`:132`/`:140`/`:150`/`:168` (verbs); bodies in `apps/cli/src/commands/music/verbs.ts` delegate to the plugin — no prompt rendering, spend rule, ffmpeg argv or HTTP in the CLI |
| R2 — config from the user root with KK_MUSIC_* overrides and documented defaults | MET | `apps/cli/src/commands/music/runtime.ts` (seams, failure mapping, --verbose layer report); `plugins/generations/music-gen/src/config.ts` (music.* block, defaultModel, takesCap rejected above 4 at load) |
| R3 — render/presets/check/master free of instance traffic | MET | free verbs never call `MusicSeams.createClient` (`apps/cli/src/commands/music/verbs.ts`); asserted at `apps/cli/tests/commands/music.test.ts:169` |
| R4 — stable --json per verb | MET | one payload envelope per verb in `apps/cli/src/commands/music/verbs.ts`; asserted at `apps/cli/tests/commands/music.test.ts:204` |
| R5 — help and plugin check agree (paid/free, declared requirements) | MET | PAID/FREE help lines in `apps/cli/src/commands/music/index.ts`; `ffmpeg`/`ffprobe` declared in `plugins/generations/music-gen/plugin.json`; asserted at `apps/cli/tests/commands/music.test.ts:305` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The noun is registered on the shared surface (req: R1) | MET | test | `apps/cli/tests/commands/music.test.ts:73` (all seven verbs with their arguments; gen and analyze refuse without --yes through the 0400 guard); probe: `bun apps/cli/src/index.ts music --help` lists each verb with PAID/FREE |
| AC2 — Config comes from the user root with an env override (req: R2) | MET | test | `apps/cli/tests/commands/music.test.ts:116` (env above config, winning layer per key under --verbose, documented defaults with no config, unreachable endpoint -> one-line remediation naming the config key, takesCap > 4 rejected at load) |
| AC3 — Free verbs never reach the instance (req: R3) | MET | test | `apps/cli/tests/commands/music.test.ts:169` (render, presets, check and master succeed with the instance unreachable and open no connection) |
| AC4 — JSON output is stable and complete (req: R4) | MET | test | `apps/cli/tests/commands/music.test.ts:204` (artifact path, instance id, digest, paid, spend, measurements and check rows per verb) |
| AC5 — Help and plugin check agree (req: R5) | MET | test | `apps/cli/tests/commands/music.test.ts:305` (PAID/FREE markers; declared requirements match the binaries used), plus `bun run test-pre-check` -> 59/59 rules clean |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

SECUA + traceability review of the `kk music` noun (`--focus all`, host-inline; independent of the implement session).

| Priority | Finding | Disposition |
| -------- | ------- | ----------- |
| P1 (blocker) | — | none |
| P2 (major) | — | none |
| P3 (minor) | `gen`'s staging path now goes through the FileSystem seam whose `writeFile` creates parent directories, so a nonexistent `--out` directory is silently created where the previous `node:fs/promises` call would have thrown ENOENT. Strictly more permissive, no documented contract depended on the throw — recorded so it is a decision, not an accident | ACCEPTED |
| P3 (minor) | The noun registers seven verbs but `presets` is a two-level surface (`presets list`), and the AC's "render, gen, library, analyze, check, master and presets are listed with their arguments" reads as seven peers of one shape. The help text is honest about the nesting; a later CLI style pass may want `presets` to take an argument instead of a sub-verb | DEFER(no owner in D8 — 0403 consumes `presets` as-is) |
| P4 (advisory) | Two per-file test modules were added (`apps/cli/tests/commands/music/{verbs,runtime}.test.ts`) because `require-corresponding-test` keys on file existence, not on coverage of the module: the AC-level suite in `music.test.ts` exercises both modules but does not satisfy the rule. The tests are real (missing-sidecar predicate, seam-routed writes, failure mapping), not placeholders | ACCEPTED |

**Boundary discipline.** Every verb is a thin delegate (`apps/cli/src/commands/music/verbs.ts`): no prompt rendering, no spend rule, no ffmpeg argv and no HTTP in the CLI — those stay in the plugin the previous tasks own. Free verbs are free by construction, because `render`/`presets`/`check`/`master` never call `MusicSeams.createClient`, so they cannot open a socket even with the instance down (asserted at `apps/cli/tests/commands/music.test.ts:168`).

**Configuration.** `music:` config plus `KK_MUSIC_*` overrides resolve through the same tree `plugins/generations/music-gen/src/config.ts` uses, with a `--verbose` per-key layer report (so "which layer won" is observable rather than guessed); an unreachable endpoint maps to a one-line remediation naming the config key and file. `takesCap > 4` is rejected at load, which is the 0400 guard's rule enforced at the earliest boundary.

**Money surface.** `gen` and `analyze` state PAID and require `--yes`; the 0400 guard is not bypassed, only reached (`apps/cli/tests/commands/music.test.ts:72` covers the refusal). `library` is a free read-only GET, correctly labelled as such.

**Machine output.** Every verb emits one stable envelope (artifact path, instance id, digest, paid, spend, plus measurements/check rows where applicable) asserted at `apps/cli/tests/commands/music.test.ts:203`, which is what 0403's workflow states and 0402's skill will parse.

**Final disposition.** Approve for `done` — R1–R5 and AC1–AC5 MET; 59 pre-check rules clean, 29 CLI workbench tests + 14 AC tests + 270 plugin tests pass, Biome clean, light gate DEFERRED (batch full gate owes coverage).

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-19T00:14:06.546Z feature_id Q → D8 (system)
- 2026-11-19T08:07:14.067Z backlog → wip (system)
- 2026-11-19T08:18:43.084Z wip → testing (system)
- 2026-11-19T08:18:43.872Z testing → done (system)

