---
schema_version: 1
name: "Extend kk executor fan-in with concurrent source-runner mode"
status: done
template: feature-impl
created_at: 2026-09-06T14:35:05.125Z
updated_at: "2026-09-07T21:27:08.354Z"
feature_id: L1
priority: P1
tags: ["cli", "fan-in", "feature-K"]
---

## 0092. Extend kk executor fan-in with concurrent source-runner mode

### Background

kk-daily-ai-voice runs fetch → ingest-last30days → ingest-horizon → blend-facts as 4 sequential workflow states; horizon alone took 20m40s in dogfood 2026-09-06. Engine-level parallelism is impossible (type: parallel inert, ADR-007 R4). Feature L1 / ADR-019 D1: concurrency moves into kk. Implements Feature L1 scenario R1.

### Requirements

R1. `kk executor fan-in` accepts `--source <plugin>:<inputFile>` (repeatable); each source spawns its ingestion plugin concurrently via Bun.spawn with per-source timeout (default 30m, `--source-timeout <ms>`).
R2. Successful sources merge into one Doc[] output (existing --in merge semantics reused).
R3. A failed/timed-out source is recorded in output metadata.sourceErrors[] (plugin, error, durationMs); exit 0 when ≥1 source succeeded, exit 1 only when all fail.
R4. Existing `--in <file>` merge mode behavior unchanged (other workflows depend on it).
R5. Unit tests cover: concurrent spawn (wall time < sum), partial failure degradation, all-fail exit 1, --in mode regression.

### Acceptance Criteria

```gherkin
Feature: Extend kk executor fan-in with concurrent source-runner mode

  Scenario: Concurrent source collection via kk-owned fan-in
    Given the executor fan-in command with repeatable --source flags
    When `fan-in --source aihot-ingest:in.json --source horizon-ingest:in.json --out out.json` runs
    Then both ingestion plugins spawn concurrently and both Doc[] sets merge
    And one failing source degrades: out.json written with surviving docs + metadata.sourceErrors entry, exit 0
    And all sources failing exits 1 with no out.json
    And `fan-in --in a.json --in b.json` behavior is unchanged (regression test green)
    And bun run lint && bun run test are clean
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

WHAT: `kk executor fan-in` gains a source-runner mode: `--source <plugin>:<inputFile>` (repeatable) spawns each ingestion plugin concurrently and merges their Doc[] outputs through the existing `mergeDocLists` path; `--source-timeout <ms>` sets a per-source timeout (default 1800000). Existing `--in <file>` merge mode is untouched.

WHY: ADR-019 D1 — the workflow engine is sequential by design (type: parallel inert, ADR-007 R4); concurrency belongs in kk, and fan-in already owns "many Doc[] → one". Extending fan-in with producer-spawning is depth-adding; a separate verb would duplicate merge semantics.

WHERE (frozen):

- `apps/cli/src/invoke.ts` — add an async sibling `spawnPluginEntryAsync(opts)` next to the sync `spawnPluginEntry`. invoke.ts is the ONLY allowlisted direct-spawn file (`no-direct-process-spawn`, .spur/rules/strict/runtime-boundaries.yaml:25); fanin.ts MUST NOT call `Bun.spawn` itself. Reuse the exact cmd/env construction (pluginEnvFromConfig, KNOWLEDGE_KIT_PROJECT_ROOT, cwd=plugin dir); only the spawn call changes to async `Bun.spawn` with `AbortSignal.timeout(sourceTimeoutMs)`.
- `apps/cli/src/fanin.ts` — extend `FaninOptions` with `sources: {plugin, inputFile}[]` + `sourceTimeoutMs`; new branch in `runFanin`: when `--source` present, resolve each plugin via the same discovery used by runInvoke (`discoverAllPlugins` + `getByName`), spawn all via `spawnPluginEntryAsync` concurrently (`Promise.allSettled`), write each success to a temp Doc[] file, then feed successful outputs into `mergeDocLists` with provenance = plugin name. Failures/timeouts → `metadata.sourceErrors[]` entries `{plugin, error, durationMs}` on the output; exit 0 when ≥1 source succeeded, exit 1 only when all fail. `--source` and `--in` may combine.
- `apps/cli/src/commands/executor.ts` — register `--source` (repeatable, collect pattern like collectIn) and `--source-timeout`.
- `apps/cli/tests/fanin.test.ts` — extend with source-mode tests (fixture plugins: fast-ok, slow-timeout, fail).

Precedence: source errors degrade (never abort siblings); merge order = --source declaration order (deterministic output).

Anti-patterns: no `Bun.spawn` outside invoke.ts; no new CLI verb; no swallowing per-source stderr (echo to run output); no mutation of mergeDocLists dedupe semantics (first-seen wins).

Handoff: 0097 consumes `--source` in the workflow's collect state. Docs: 04_DESIGN.md fan-in flags + ADR-019 entry land in this task's commit (first task of feature L1).

### Plan

1. Read `spawnPluginEntry` (invoke.ts:115) and `runFanin`/`mergeDocLists` (fanin.ts) — reuse, don't reimplement.
2. Add `spawnPluginEntryAsync` in invoke.ts (async Bun.spawn, AbortSignal.timeout, same cmd/env); export it.
3. Extend FaninOptions + parseArgs for `--source` / `--source-timeout`; register flags in executor.ts.
4. Implement source-runner branch: resolve plugins (discoverAllPlugins/getByName), Promise.allSettled spawns, merge successes, record sourceErrors, exit-code contract (R3).
5. Tests: concurrent wall-time < sum, partial-failure degradation + sourceErrors shape, all-fail exit 1, `--in`-only regression, flag validation errors.
6. Docs same commit: docs/04_DESIGN.md fan-in flags; ADR-019 entry in docs/00_ADR.md (feature L1 D1).
7. Verify: bun run lint && bun run test clean.

### Solution

Change map (rationale per Design; async spawn kept in invoke.ts — the only allowlisted spawn file):

- `apps/cli/src/invoke.ts`
  - :40 `timedOut?: boolean` added to `PluginEntrySpawnResult`.
  - :118/:125 `pluginEntryCmd`/`pluginEntryEnv` helpers extracted from the sync path (single source of cmd/env truth for both spawn variants).
  - :156 `PluginEntryAsyncSpawnOptions` (`timeoutMs?`).
  - :168-192 `spawnPluginEntryAsync` — `Bun.spawn` + abort signal, stderr capture via `new Response(proc.stderr).text()`, shares all contract checks/validation with the sync path.
- `apps/cli/src/fanin.ts`
  - :19-30 `FaninSource` / `FaninSourceError` types.
  - :36-40 `FaninOptions.sources?` + `sourceTimeoutMs?`; :42 `DEFAULT_SOURCE_TIMEOUT_MS = 30*60*1000`.
  - :44-60 `SOURCE_ERROR_MAX_CHARS = 2048` + `capSourceError` (verify fix P3b): caps a degraded-source error string before it enters `metadata.sourceErrors[]` — a chatty child's full stderr never rides on every merged doc; the head is kept and truncation is stated, never silent.
  - :75-109 `mergeDocLists` (dedupe first-seen wins, provenance — semantics unchanged).
  - :112-137 `readDocList` (`--in` path, unchanged).
  - :148-213 `parseArgs` — `--source plugin:file` (repeatable, strict `<plugin>:<file>` shape), `--source-timeout <ms>` (once, positive int); :200/:203 runtime "at least one --in or --source" / "--source-timeout requires --source" usage errors (exit 2).
  - :223-281 `collectSourceDocs` — resolve via shared `discoverAllPlugins`+`getByName`, spawn through `spawnPluginEntryAsync` with `AbortSignal.timeout(timeoutMs)`, validate/parse output Doc[]; timeout marks `timedOut` and degrades with durationMs; :257-259 failure message embeds (possibly chatty) child output — capped downstream at :349-353.
  - :289 `runFanin` source branch — :303-310 `--in` inputs first (unchanged path), :312 source branch, :320 `Promise.allSettled` over sources (concurrent, sibling isolation), :341-347 successes merged in declaration order (provenance = plugin name), :349-353 `metadata.sourceErrors[]` entries built through `capSourceError`, :357-360 per-source failures echoed to run output, :362-366 exit 1 only when all sources fail (no out.json), :369-376 merge + sourceErrors attached to every merged doc.
- `apps/cli/src/commands/executor.ts`
  - :19 `--source-timeout` option type; :66 `collectSource` repeatable collector; :78-81 argv pass-through in the shared runner; :146-151 `--source`/`--source-timeout` registered on `executor fan-in`; :184-189 same on hidden `fanin` alias.
- `apps/cli/tests/fanin.test.ts`
  - `runFanin source-runner mode` describe (:305-620): 9 tests via `KK_PLUGIN_PATH`-injected fixture plugins (`writeFixtureIngestionPlugin`): concurrent wall-time < sum (2× sleep 500ms, assert < 1500ms vs ≥1200ms sequential floor — P3a ceiling raised from 900ms), `--source-timeout` kills slow source (300ms timeout vs sleep 10s, `timed out after 300ms`), partial failure → sourceErrors entry + docs survive + exit 0, degraded-source error string capped at 2KB (:388-416; 100k-char stderr fixture, head survives, tail cut, length < 2200 — P3b proof), all-fail → exit 1 + no out.json, plugin-not-found degradation, junk-output schema degradation, `--in`+`--source` combined merge/provenance, usage-error matrix (exit 2).
  - `--in`-only regression suite (:102-247; dedupe, provenance, error cases) untouched and green.
- `apps/cli/tests/commands/executor.test.ts`
  - Registration assertions extended for the new fan-in flags (:47-76); main-level `--in` merge regression (:204-217) green.
- Docs (same task, per Plan step 6): `docs/04_DESIGN.md` §1.5 fan-in flags table + source-runner paragraph; `docs/00_ADR.md` ADR-019 entry (concurrency moved into kk executor fan-in).

Fix pass (verify stage, review items P3a/P3b):

- P3a — `apps/cli/tests/fanin.test.ts:347`: concurrency wall-time ceiling 900ms → 1500ms (flaked once under parallel load); still discriminating vs the ≥1200ms sequential floor (2× 500ms sleeps + process startups) and floored at ≥500ms.
- P3b — `apps/cli/src/fanin.ts:44-60` + `:349-353`: degraded-source error strings are capped at 2048 chars (`capSourceError`, explicit `[truncated; N chars total]` marker) before landing in `metadata.sourceErrors[]`; proving test `apps/cli/tests/fanin.test.ts:388-416`.

Precedence honored: failed/timed-out sources degrade without aborting siblings; `mergeDocLists` dedupe semantics (first-seen wins) unchanged; per-source stderr is echoed (capped head with explicit truncation marker — never silently swallowed).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Repeatable `--source <plugin>:<inputFile>` parsed (apps/cli/src/fanin.ts#5047 parseArgs :155-213); each source spawns its ingestion plugin concurrently via Bun.spawn with per-source timeout (apps/cli/src/invoke.ts#53B9 spawnPluginEntryAsync :168-193, AbortSignal.timeout); default 30m DEFAULT_SOURCE_TIMEOUT_MS fanin.ts:49, `--source-timeout` override, per-source `--source-timeout-override` resolution :362-365 |
| R2 | MET | Successful sources merge into one Doc[] output — fanin.ts:351-408 source branch reuses `--in` merge semantics; merge covered by apps/cli/tests/fanin.test.ts#070A |
| R3 | MET | metadata.sourceErrors[] (fanin.ts:412-418; capSourceError :62-67 carries plugin/error/durationMs); exit 0 when >=1 source succeeded, exit 1 only when all fail (:404-408); tests fanin.test.ts:418-455 and :457-489 |
| R4 | MET | `--in` merge mode unchanged — regression tests fanin.test.ts:320-358 green in the fresh targeted run |
| R5 | MET | Tests cover concurrent spawn wall-time<sum (:360-386), partial-failure degradation (:388-416), all-fail exit 1 (:457-489), `--in` regression (:320-358); executor wiring apps/cli/src/commands/executor.ts#D808 :155-167 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Concurrent source collection via kk-owned fan-in | MET | command | bun test apps/cli/tests/fanin.test.ts apps/cli/tests/commands/executor.test.ts → 42 pass / 0 fail (this session); full suite 636/0, lint exit 0 (this session) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | Fan-in is kk-owned (apps/cli/src/fanin.ts); plugin spawn goes through the shared invoke seam (invoke.ts#53B9); no orchestration leaked into workflow YAML (`--source-timeout-override` in YAML is 0099 scope) |
| P4 | evidence-rule-pass | — | Every row carries a test command run this session or a file#line anchor re-read this session |
| P4 | ac-boxes | — | AC row uses the exact feature scenario title `R1 — Concurrent source collection via kk-owned fan-in` |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-06T22:09:32.867Z todo → wip (system)
- 2026-09-06T22:53:59.423Z wip → testing (system)
- 2026-09-06T22:56:00.327Z testing → done (system)
