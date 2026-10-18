---
schema_version: 1
name: "itc check-targets: probe runs ignore plugin env from config"
status: done
template: issue
created_at: 2026-10-17T07:36:05.505Z
updated_at: "2026-10-18T01:12:58.648Z"
feature_id: G21

ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0311-verdict.json
---

## 0311. itc check-targets: probe runs ignore plugin env from config

### Background

Dogfood run kk-itc-20261016T224508-18167: `itc-check-targets` refused substack-pub with "substack publication URL is required: set SUBSTACK_PUBLICATION_URL" even after the operator set it under `plugins.publishings.substack-pub.env` in `~/.config/kk/config.yaml`. The probe runner in `itcCheckTargets` (`apps/cli/src/itc-publish.ts`) spawns `plugin.check` with `env: process.env` only — the config's plugin env entries, which ARE injected for real plugin exec, never reach the probe. The dogfood had to `export SUBSTACK_PUBLICATION_URL` manually.

## Fix direction

Resolve plugin env the same way the executor invoke path does (flag > env > config > compiled default) and pass it to the probe's `executor.run` env. Do not hand-roll a second config reader — reuse the existing injection seam. Credential handling: probe env must not leak into logs or receipts.

## Evidence

- Probe spawn: `apps/cli/src/itc-publish.ts` (itcCheckTargets, `env: process.env as Record<string, string>`)
- Config convention documented in `~/.config/kk/config.yaml` header: "each entry is injected into that plugin's process environment at exec time"
- Probe: `plugins/publishings/substack-pub/src/profile-check.ts` requires SUBSTACK_PUBLICATION_URL

### Requirements

- [x] R1. `itcCheckTargets` (`apps/cli/src/itc-publish.ts:345`) resolves each target plugin's process env through the existing injection seam (`pluginEnvFromConfig`, `apps/cli/src/invoke.ts:72`, exposed once so the probe and the exec path share it) instead of `env: process.env as Record<string, string>`, so `plugins.publishings.<name>.env` from `$KK_CONFIG` (`~/.config/kk/config.yaml`) reaches the probe's `executor.run` call and `substack-pub`'s `check` finds `SUBSTACK_PUBLICATION_URL` without an operator `export`.
- [x] R2. Precedence matches the executor invoke path exactly and stays implemented once: an explicit flag wins over `process.env` (`--profile`, `--url`/`--publication` remain the probe's argv flags), `process.env` wins over the config entry, the config entry wins over the compiled default (`KNOWLEDGE_KIT_PROJECT_ROOT` anchored at the kk invocation root), and empty-string config placeholders are skipped — no second config reader is introduced.
- [x] R3. Probe env does not leak: no resolved config value appears in `itc-check-targets` stdout/stderr, in `4-publish/publish-plan.json`, in `4-publish/receipts/*.json` or in `5-report/report.{json,md}`; only the probe's verdict (`status`, `detail`, `profileDir`) survives, exactly as today.
- [x] R4. Everything that was already correct stays correct: a passing probe still exits 0, a failing probe still exits 1 with the probe-authored `detail` and the `kk bot open/login <profile|plugin>` hint, a missing or unparseable config still runs the probe (empty overlay, never a refusal), and no probe is spawned for a plan with no targets or for a target declaring no `check` entry.

### Acceptance Criteria

```gherkin
Feature: itc check-targets resolves plugin env through the shared injection seam

  Scenario: AC1 — Config plugin env reaches the readiness probe (req: R1)
    Given $KK_CONFIG declares plugins.publishings.substack-pub.env.SUBSTACK_PUBLICATION_URL and the shell does not export it
    When itc-check-targets probes a planned substack-pub target
    Then the probe process receives SUBSTACK_PUBLICATION_URL from the config entry and the probe is not refused for a missing publication URL

  Scenario: AC2 — Precedence matches the executor invoke path (req: R2)
    Given the same key is set in the shell environment and in the config, and another key only in the config
    When itc-check-targets probes the target
    Then the shell value wins over the config value, the config-only key is injected, an empty config placeholder is not injected, and KNOWLEDGE_KIT_PROJECT_ROOT is anchored exactly as the plugin exec path anchors it

  Scenario: AC3 — The probe env never leaks (req: R3)
    Given a config-injected value and a probe that refuses
    When itc-check-targets writes its message and the run later writes plan, receipts and report
    Then no artifact and no captured stream contains the injected value, and only the probe's status and detail survive

  Scenario: AC4 — Existing probe behaviour is unchanged (req: R4)
    Given a passing probe, a refusing probe, an unreadable config and a plan with no probe-declaring target
    When itc-check-targets runs
    Then it exits 0, exits 1 with the probe detail plus the kk bot hint, still runs the probe on an unreadable config, and spawns no probe when there is nothing to probe
```

### Q&A

<!-- CLOSED decisions from refinement (--auto): what was chosen and why, what was deferred and on
     what condition. Not a parking lot for open questions. -->

#### Q&A entry — 2026-10-17 (refine, --auto --depth ready)

- **Closed — reuse `pluginEnvFromConfig` behind one exported builder, do not add a reader.** The precedence already lives in `pluginEntryEnv` (`apps/cli/src/invoke.ts:122`): config entry first, then `process.env`, then scoped `extraEnv`, then `KNOWLEDGE_KIT_PROJECT_ROOT`. The probe will call that same builder with the target's `plugin.kind`/`plugin.name` (available on `PluginRecord`, `packages/kk-core/src/registry.ts:19`), so the capture's "no second config reader" is honoured at the function level rather than by moving the probe out of its `ProcessExecutor` seam.
- **Closed — `process.env` keeps winning over config.** That preserves today's operator escape hatch (`export SUBSTACK_PUBLICATION_URL`), matches the ordering the send path uses for the same plugin, and keeps the documented config convention ("each entry is injected into that plugin's process environment at exec time") as a *fallback*. Config therefore can never override an explicit CLI flag either — the probe's flag tier (`--profile`, `--url`) stays argv-only.
- **Closed — the probe keeps its injectable `ProcessExecutor` and its 60 s timeout.** Routing probes through `spawnPluginProbe` would gain nothing and would lose the test seam 0302 established (`apps/cli/tests/itc-publish.test.ts` injects a `ProcessExecutor` subclass to assert the refusal path) plus change failure semantics. The env is the only thing that needs to change.
- **Closed — no secret can leak through the new path.** The probe's stdout is parsed only for its final JSON line (a bounded re-implementation of `probeVerdict` on `status`/`detail`), and receipts/report carry digests, statuses and URLs — never env. A regression test asserts the injected value is absent from the captured streams and from the `4-publish`/`5-report` artifacts.
- **Deferred with owner** — probe `cwd` parity with the send path (`resolve(record.dir, record.entry)` + `cwd: record.dir` in `apps/cli/src/fanout.ts:447`) and per-probe timeout policy are out of scope; if a probe ever needs assets relative to its package dir, file a follow-up rather than widening this fix.

### Design

**WHAT/WHERE.** `apps/cli/src/invoke.ts` — export the existing env builder as `pluginProcessEnv(kind, name, extraEnv?)`, carrying the current `pluginEntryEnv` body verbatim (config entry under `process.env`, then scoped `extraEnv`, then the `KNOWLEDGE_KIT_PROJECT_ROOT` anchor); `pluginEntryEnv` becomes a two-line delegation so the precedence is implemented once. `apps/cli/src/itc-publish.ts` — `itcCheckTargets` (`:345`) passes `env: pluginProcessEnv(plugin.kind, plugin.name) as Record<string, string>` to `executor.run` and the inline comment names the seam. Tests: `apps/cli/tests/itc-publish.test.ts` (config→probe injection, precedence, no-leak, unchanged refusal) and the existing `apps/cli/tests/invoke.test.ts` `pluginEnvFromConfig` case stays green as the seam's own contract.

**Decision and tradeoff.** Reach through the existing seam instead of adding one. Tradeoff: `itc-publish.ts` gains an import of `invoke.ts` (both are CLI application modules; `invoke.ts` imports only `@gobing-ai/kk-core`, `@gobing-ai/ts-utils` and `./plugin-output`, so there is no cycle), and `invoke.ts` grows one exported name. The alternative — three duplicated lines computing `{...pluginEnvFromConfig(kind, name), ...process.env, KNOWLEDGE_KIT_PROJECT_ROOT}` inside `itc-publish.ts` — has no import cost but duplicates the precedence and the project-root anchor, which is exactly the drift that produced this bug: the probe and the exec path disagreeing about env.

**Rejected alternatives.** (1) A second YAML reader inside `itc-publish.ts` — the capture forbids it; it would re-implement `KK_CONFIG` resolution, the collection mapping and the empty-placeholder rule. (2) `envMode: 'replace'` with a hand-built full env — the executor already merges by default, and building the full env by hand duplicates `process.env` handling for no gain. (3) Route the probe through `spawnPluginProbe` — loses the injectable `ProcessExecutor` (0302's refusal test) and changes timeout/exit semantics for an env-only bug. (4) Forward `--publication`/`--profile` flags derived from config — flag tiers belong to the operator's explicit CLI; config is the environment tier, not an argv tier. (5) Read the config once at process start and cache globally — a long-lived process could switch `KK_CONFIG` (tests do); `pluginEnvFromConfig` already reads per call and is cheap for a handful of targets.

**Invariants.** (i) One precedence implementation: `pluginProcessEnv` is the only place that composes plugin process env. (ii) Config sits *under* `process.env`, so an explicit export always wins. (iii) `KNOWLEDGE_KIT_PROJECT_ROOT` is anchored identically to the exec path (`process.env.KNOWLEDGE_KIT_PROJECT_ROOT ?? process.cwd()`). (iv) Probe stdout handling is untouched: only the last JSON line is read, and only `status`/`detail` survive into the operator message. (v) Nothing about the probe env is persisted — no receipt, plan or report field may carry it. (vi) An unreadable/absent config remains an empty overlay, never a refusal (the probe decides readiness).

### Plan

1. (R1, R2) Write the failing test first in `apps/cli/tests/itc-publish.test.ts`: point `process.env.KK_CONFIG` at a temp config declaring `plugins.publishings.substack-pub.env.SUBSTACK_PUBLICATION_URL`, plan a `substack-pub` target, and inject a `ProcessExecutor` subclass that records `options.env`; assert the value arrives. In the same test assert precedence — a value set in `process.env` for the same key wins over the config value, a config-only key is injected, an `""` placeholder is not, and `KNOWLEDGE_KIT_PROJECT_ROOT` equals the exec path's anchor. Expect red (`env` is currently bare `process.env`).
2. (R1) Refactor `apps/cli/src/invoke.ts`: export `pluginProcessEnv(kind, name, extraEnv?)` holding the current `pluginEntryEnv` body, and make `pluginEntryEnv` delegate to it. Keep the precedence JSDoc; `bun test apps/cli/tests/invoke.test.ts` must stay green.
3. (R1) In `apps/cli/src/itc-publish.ts`, replace the probe's `env: process.env as Record<string, string>` with `env: pluginProcessEnv(plugin.kind, plugin.name) as Record<string, string>` and update the comment to name the seam. No other line of `itcCheckTargets` changes.
4. (R3) Add the no-leak test to `apps/cli/tests/itc-publish.test.ts`: with a config-injected value and a refusing probe, capture the process streams and assert the value is absent from them and from any `4-publish`/`5-report` artifact written by `itcSendTargets` + `itcReportSummary` on the same work dir.
5. (R4) Keep the existing refusal/pass cases in `apps/cli/tests/itc-publish.test.ts` (`itcCheckTargets & Probes (0302 / G21 R1)`) unchanged and green, and add the unreadable-config case: a config path that does not exist still probes and still reports the probe's own detail.
6. (all) Run `bun test apps/cli/tests/itc-publish.test.ts apps/cli/tests/invoke.test.ts apps/cli/tests/fanout.test.ts`, then `bun run lint` (Biome 2.5.15: 4-space, single quotes, no `any`).
7. (optional dogfood proof) With `SUBSTACK_PUBLICATION_URL` absent from the shell and present under `plugins.publishings.substack-pub.env` in `~/.config/kk/config.yaml`, run `kk stage run itc-check-targets <failed-run work_dir>` and record the command plus result in Testing.

### Root Cause

`itcCheckTargets` builds the probe environment as `env: process.env as Record<string, string>` (`apps/cli/src/itc-publish.ts:345`), while every real plugin execution goes through `pluginEntryEnv` (`apps/cli/src/invoke.ts:122`), which layers `plugins.<collection>.<name>.env` from `$KK_CONFIG` *under* `process.env` and anchors `KNOWLEDGE_KIT_PROJECT_ROOT`. The probe path therefore bypassed the one injection seam, so `plugins.publishings.substack-pub.env.SUBSTACK_PUBLICATION_URL` in `~/.config/kk/config.yaml` never reached `substack-pub`'s `check` and the dogfood had to `export` it by hand.

### Solution

**Change map (one anchor per row; ranges are inside the file).**

| File:line | Change |
| --- | --- |
| `apps/cli/src/invoke.ts:126` | `pluginProcessEnv(kind?, name?, extraEnv?)` exported — the `pluginEntryEnv` body verbatim (config entry under `process.env`, scoped `extraEnv` over it, `KNOWLEDGE_KIT_PROJECT_ROOT` anchored at `process.env ?? process.cwd()`); the one precedence owner. |
| `apps/cli/src/invoke.ts:146-152` | `pluginEntryEnv` reduced to a two-line delegation, so every existing spawn (sync exec, async exec, `check`/`login`/`open` probes) and the itc probe share one precedence implementation. |
| `apps/cli/src/itc-publish.ts:348` | `itcCheckTargets` probe env: `process.env as Record<string, string>` → `pluginProcessEnv(plugin.kind, plugin.name) as Record<string, string>` (typing unchanged, `ProcessExecutor` seam and 60 s timeout untouched). |
| `apps/cli/src/itc-publish.ts:13` | Import of the seam; no cycle (`invoke.ts` imports only `@gobing-ai/kk-core`, `@gobing-ai/ts-utils`, `./plugin-output`). |
| `apps/cli/tests/itc-publish.test.ts:24-64` | `RecordingProbe` (records `options.env`), `withPublishConfig` (temp `$KK_CONFIG` with restore), `planTarget` — the probe-env test fixtures. |
| `apps/cli/tests/itc-publish.test.ts:154-158` | Existing no-probe case now injects `RecordingProbe` and asserts `envs` is empty (R4: nothing to probe → no spawn). |
| `apps/cli/tests/itc-publish.test.ts:192` | R1/R2: config `SUBSTACK_PUBLICATION_URL` + config-only key reach the probe; shell value wins the clash; `''` placeholder skipped; `KNOWLEDGE_KIT_PROJECT_ROOT` equals the exec-path anchor. |
| `apps/cli/tests/itc-publish.test.ts:227` | R4: unreadable `$KK_CONFIG` still probes (probe-authored detail surfaced; generic case keeps the `kk bot open/login <name>` hint). |
| `apps/cli/tests/itc-publish.test.ts:262` | R3: captured stdout/stderr, `publish-plan.json`, `receipts/<plugin>.json`, `5-report/report.{json,md}` contain no injected value; only the probe's `detail` survives. |

**Rationale.** The bug was drift, not a missing feature: `itcCheckTargets` hand-built `env: process.env`
while every real plugin spawn went through `pluginEntryEnv`. Rather than duplicate the three
precedence lines in `itc-publish.ts` (the same drift risk), the existing builder is exported once as
`pluginProcessEnv` and `pluginEntryEnv` delegates to it — one owner, two call shapes. Config stays
*under* `process.env`, so the operator's `export SUBSTACK_PUBLICATION_URL` escape hatch and the
`--profile`/`--publication` argv tier are unchanged; an absent/unparseable config is still an empty
overlay (the probe, not the CLI, judges readiness). Nothing about the probe's stdout handling changed:
only the last JSON line is parsed and only `status`/`detail` reach the message, so no resolved config
value can be persisted into the plan, receipts or report.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/itc-publish.ts:348` hands the probe `pluginProcessEnv(plugin.kind, plugin.name)` instead of bare `process.env`; repro this run with `SUBSTACK_PUBLICATION_URL` absent from the shell and `$KK_CONFIG` declaring `plugins.publishings.substack-pub.env.SUBSTACK_PUBLICATION_URL=http://plain.test` printed `channel probe for 'substack-pub' refused: error: substack publication URL must be https:, got 'http://plain.test'` (the probe reached its URL gate, not the missing-URL refusal), while the same work dir with a nonexistent `$KK_CONFIG` still printed `substack publication URL is required`; pinned by `apps/cli/tests/itc-publish.test.ts:192`. |
| R2 | MET | Single composer `apps/cli/src/invoke.ts:126-143` spreads config env under `process.env`, then scoped `extraEnv`, then anchors `KNOWLEDGE_KIT_PROJECT_ROOT: process.env.KNOWLEDGE_KIT_PROJECT_ROOT ?? process.cwd()`; `pluginEntryEnv` is a pure delegate at `apps/cli/src/invoke.ts:146-152`, and the only `KNOWLEDGE_KIT_PROJECT_ROOT` write in `apps/cli/src` is `apps/cli/src/invoke.ts:141`; empty placeholders are dropped upstream at `apps/cli/src/invoke.ts:104-107`; shell-beats-config reproduced this run (config `http://config.test` + shell `http://shell.test` printed `got 'http://shell.test'`, exit 1) and the placeholder/anchor assertions pass at `apps/cli/tests/itc-publish.test.ts:192`. |
| R3 | MET | Env is never persisted: the receipt is a hand-built literal with a closed field set written at `apps/cli/src/itc-publish.ts:509-526` and validated by the strict schema at `apps/cli/src/itc-publish.ts:29-46`, the report is rendered from receipts only (`apps/cli/src/itc-publish.ts:692-752`), and the CLI authors only the probe's `status`/`detail` at `apps/cli/src/itc-publish.ts:352-370`; `apps/cli/tests/itc-publish.test.ts:262` drives the real `itcSendTargets` + `itcReportSummary` and asserts the injected value is absent from streams, `publish-plan.json`, `receipts/substack-pub.json` and `5-report/report.{json,md}` (3 pass this run), and a grep of the artifacts my own CLI runs wrote found no injected value; caveat: a probe that echoes an env value in its own `detail` does surface it on stderr (substack-pub's URL-gate message), which R4 mandates and R3's `detail` carve-out permits, and no shipped probe echoes a credential value. |
| R4 | MET | `apps/cli/tests/itc-publish.test.ts:142` (passing probe and check-less target exit 0 with zero spawns), `apps/cli/tests/itc-publish.test.ts:162-189` (failing probe exits 1) and `apps/cli/tests/itc-publish.test.ts:227` (missing config still probes, keeping the probe `detail` plus the `kk bot open/login` hint) — all pass this run; the failing-probe exit 1 was reproduced on the real CLI (exit 1 with the probe-authored refusal text). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Config plugin env reaches the readiness probe (req: R1) | MET | test | `apps/cli/tests/itc-publish.test.ts:192` asserts the config-declared `SUBSTACK_PUBLICATION_URL` lands in the probe's `executor.run` env; reproduced this run on the real CLI with the shell variable stripped: the probe saw the config URL and refused on https rather than for a missing URL. |
| AC2 — Precedence matches the executor invoke path (req: R2) | MET | test | `apps/cli/tests/itc-publish.test.ts:192` asserts shell beats config (`KK_CLASH`), a config-only key is injected (`KK_CONFIG_ONLY`), an `''` placeholder is skipped (`KK_EMPTY_PLACEHOLDER` undefined) and `KNOWLEDGE_KIT_PROJECT_ROOT` equals the exec-path anchor; shell-beats-config reproduced end-to-end this run via the CLI, and `apps/cli/src/invoke.ts:146-152` shows the exec path uses the same composer. |
| AC3 — The probe env never leaks (req: R3) | MET | test | `apps/cli/tests/itc-publish.test.ts:262` captures both streams and asserts the injected secret is absent while the probe detail survives, then runs `itcSendTargets` + `itcReportSummary` and asserts no artifact contains it; the receipt/report writers carry no env field (`apps/cli/src/itc-publish.ts:509-526`, `apps/cli/src/itc-publish.ts:692-752`), and my own CLI runs' artifacts grepped clean. |
| AC4 — Existing probe behaviour is unchanged (req: R4) | MET | test | `apps/cli/tests/itc-publish.test.ts:142` (exit 0 for a passing probe and for a target declaring no `check`, with `probe.envs` empty), `apps/cli/tests/itc-publish.test.ts:162-189` (exit 1 on a refusing probe) and `apps/cli/tests/itc-publish.test.ts:227` (unreadable config still probes and keeps the probe detail plus the bot hint); 3 pass / 0 fail on the 0311 filter this run. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0311
**Scope:** `git diff HEAD` for task 0311 — `apps/cli/src/invoke.ts`, `apps/cli/src/itc-publish.ts`, `apps/cli/tests/itc-publish.test.ts` (plus the task file). No other tracked file changed.
**Dimensions:** functional (R1–R4), correctness, security (env / secret surface), architecture (single env seam)
**Verdict:** PASS
**Confidence:** HIGH — earned: R1–R4 were re-checked against fresh evidence, anchored at `apps/cli/src/invoke.ts:126-143` (one precedence owner), `apps/cli/src/itc-publish.ts:348` (probe call site), `apps/cli/tests/itc-publish.test.ts:194-300` (precedence, refusal, no-leak) and two reproduced CLI runs; what stays un-executed is named under "Evidence gaps".

##### Claim | Basis | How to re-check

| Claim | Basis | How to re-check |
| --- | --- | --- |
| R1 — config plugin env reaches the probe | Fresh CLI run: `SUBSTACK_PUBLICATION_URL` absent from the shell, `KK_CONFIG` declaring `plugins.publishings.substack-pub.env.SUBSTACK_PUBLICATION_URL=http://plain.test` → `channel probe for 'substack-pub' refused: error: substack publication URL must be https:, got 'http://plain.test'` (exit 1; the message is the probe's own, `plugins/publishings/substack-pub/src/index.ts:104`): the probe received the config value, so it is no longer refused for a missing URL. The same work dir with a config carrying no `env` still reports `substack publication URL is required`. | `env -u SUBSTACK_PUBLICATION_URL KK_CONFIG=<cfg> bun apps/cli/src/index.ts stage run itc-check-targets <work>`; probe env assertion: `bun test apps/cli/tests/itc-publish.test.ts -t "shared seam"` |
| R2 — one precedence owner, exec-path tiers | `pluginProcessEnv` (`apps/cli/src/invoke.ts:126-143`) spreads config env under `process.env`, then scoped `extraEnv`, then anchors `KNOWLEDGE_KIT_PROJECT_ROOT: process.env.KNOWLEDGE_KIT_PROJECT_ROOT ?? process.cwd()`; `pluginEntryEnv` (`apps/cli/src/invoke.ts:146-152`) is a pure delegate; empty-string placeholders are skipped upstream in `pluginEnvFromConfig` (`apps/cli/src/invoke.ts:106`). Shell-beats-config proven end-to-end (config `http://config.test`, shell `http://shell.test` → `got 'http://shell.test'`); placeholder skip and the anchor equality are asserted by test. | `grep -rn "pluginEntryEnv\|pluginProcessEnv" apps/cli/src`; `bun test apps/cli/tests/itc-publish.test.ts -t "shared seam"` |
| R3 — nothing persisted to artifacts | `ItcReceiptSchema` (`apps/cli/src/itc-publish.ts:29-46`) and the report/plan writers carry no env field; the R3 test drives the real `itcSendTargets` + `itcReportSummary` on a real work dir and asserts the injected value is absent from `publish-plan.json`, `receipts/substack-pub.json`, `report.json`, `report.md` and from the captured `echo`/`echoError` streams. | `bun test apps/cli/tests/itc-publish.test.ts -t "never leaks"` |
| R4 — prior behaviour unchanged | 64 pass / 0 fail over `apps/cli/tests/itc-publish.test.ts` + `apps/cli/tests/invoke.test.ts` (fresh run, 2026-10-17); passing probe → 0, refusing probe → 1 with probe `detail` or the `kk bot open/login <name>` hint, missing config still probes, no probe when the target declares no `check`. Zero-target guard (`apps/cli/src/itc-publish.ts:334`) is untouched by the diff and was read, not test-executed. | `bun test apps/cli/tests/itc-publish.test.ts apps/cli/tests/invoke.test.ts` |
| One seam — no second path to drift | Every plugin spawn site resolves env through the same builder: `apps/cli/src/invoke.ts:202,224,249,328,438` (probe/login/session/exec sync+async), `apps/cli/src/fanout.ts:442` and `apps/cli/src/fanin.ts:309` via `spawnPluginEntryAsync`, `apps/cli/src/bot-adapter.ts:132` via `spawnPluginSession`, `apps/cli/src/commands/plugin.ts:205` via `spawnPluginProbe`, and now `apps/cli/src/itc-publish.ts:348`. No other module composes plugin env. | `grep -rn "KNOWLEDGE_KIT_PROJECT_ROOT" apps/cli/src` → only inside `pluginProcessEnv`; `grep -rn "spawnPluginEntry\|spawnPluginProbe\|spawnPluginSession" apps/cli/src` |

##### Verification — Confidence level

- **Record claim:** `**Confidence:** HIGH` above. HIGH requires evidence and the claim line carries it: one precedence owner at `apps/cli/src/invoke.ts:126-143`, the probe call site at `apps/cli/src/itc-publish.ts:348`, and 64/64 targeted tests green.
- **Level vocabulary the reviewed code accepts:** `apps/cli/src/itc-publish.ts:800` admits all three levels HIGH, MEDIUM and LOW for a PASS verdict (test `apps/cli/tests/itc-publish.test.ts:1024-1028`), and rejects a lowercase level, a missing level and an out-of-enum level (`apps/cli/tests/itc-publish.test.ts:1032-1041`). Fresh: `bun test apps/cli/tests/itc-publish.test.ts -t "confidence"` → 2 pass, 0 fail, 18 assertions.
- **Both confidence gates green after the level was written:** `sh .spur/rules/structure/review-record-confidence-level.sh` → exit 0 (judges this `## Review`); `sh .spur/rules/structure/run-answer-confidence-level.sh` → exit 0 (judges the run-plane answer, window 240 min). Both judge only *claimed* levels, so the earlier level-less record also passed — the level is added as verified evidence, not to satisfy a presence requirement.
- **Why this level and not MEDIUM:** every requirement has executed evidence, not a reading — the CLI repro shows config env reaching the probe and the shell tier winning (`apps/cli/src/itc-publish.ts:352-370`), and the suites executed; the only un-executed items are the headed-browser dogfood case and the zero-target branch, both named under "Evidence gaps".

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | security / contract | R3's literal first clause ("no resolved config value appears in `itc-check-targets` stdout/stderr") is not met when the *probe* echoes the value in its `detail`: with the config value `http://plain.test`, the CLI printed `refused: error: substack publication URL must be https:, got 'http://plain.test'` — reproduced fresh this review. That passthrough is mandated by R4 ("the probe-authored `detail`") and carved out by R3's own parenthetical, and no shipped publish probe echoes a credential value (only key names: `plugins/publishings/qiita-pub/src/index.ts:126`, `plugins/publishings/emdash-pub/src/index.ts:293`), so nothing secret leaves the process; the over-broad clause is the defect, not the code. | `apps/cli/src/itc-publish.ts:352-370` | DEFER(R3 wording is over-broad vs. its own `detail` carve-out and R4; revisit only if a probe ever echoes a credential value) |
| 2 | P4 (advisory) | correctness | The R3 test's `publish-plan.json` assertion is satisfied by the `planTarget` fixture that wrote the file, not by a plan writer under test — vacuous rather than wrong, since the plan schema carries no env field. The `receipts` / `report` / stream assertions do exercise the real writers. | `apps/cli/tests/itc-publish.test.ts:266,292-300` | ACCEPTED |
| 3 | P4 (advisory) | scope | The same test file also hardens `itcAuthorVerdict` confidence cases (HIGH/MEDIUM/LOW loop, lowercase `high`, missing level) — outside R1–R4 of 0311; `apps/cli/src/itc-publish.ts:800` already enforced the mandatory enum before this diff, so it is test-only hardening with no behavioural change. | `apps/cli/tests/itc-publish.test.ts:1024-1039` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `apps/cli/src/itc-publish.ts:348` passes `pluginProcessEnv(plugin.kind, plugin.name)`; fresh CLI run with a config-only `SUBSTACK_PUBLICATION_URL` reached the probe (URL-gate refusal instead of the missing-URL refusal) |
| R2 | MET | single composer `apps/cli/src/invoke.ts:126-143` + delegate `:146-152`; shell-beats-config reproduced end-to-end; placeholder skip at `apps/cli/src/invoke.ts:106`; anchor identical to the exec path (same expression, asserted in test) |
| R3 | MET | no env field in `ItcReceiptSchema` (`apps/cli/src/itc-publish.ts:29-46`) or the plan/report writers; CLI authors only `status`/`detail` (`apps/cli/src/itc-publish.ts:352-370`); caveat: probe-authored `detail` may echo a config value (finding 1) |
| R4 | MET | 64 pass / 0 fail on the two suites; refusing probe still exits 1 with `detail` or the `kk bot open/login` hint; env-less config still probes; `plugin?.check` guard skips non-probe targets |

##### Evidence gaps and assumptions

- The task's Testing section records a headed-browser dogfood run (`Authentication was not confirmed within 30000ms`) and a full-repo leak grep; this review did not re-run a browser launch — it re-ran the two URL-gate cases, which is where the env tiers are observable without a session.
- The "plan with no targets" branch (`apps/cli/src/itc-publish.ts:334`) was read, not executed; the diff does not touch it.
- Probe `cwd` parity with the send path stays deferred per the task's Q&A (out of scope here).
- Full gate evidence is pre-existing and was not re-run: `bun run spur-check` PASS, proof digest `sha256:a3ba20d57bca8913036fed7a0967fef954961e2cc3701aa983ed41e92945ae26` (`.spur/run/0311-test-gate.log`).

**Next:** No blocking work — finding 1 is a requirement-wording residual, findings 2–3 are accepted observations; task may proceed to verify.

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-10-18T00:55:57.853Z todo → wip (system)
- 2026-10-18T01:12:52.156Z wip → testing (system)
- 2026-10-18T01:12:58.640Z testing → done (system)

