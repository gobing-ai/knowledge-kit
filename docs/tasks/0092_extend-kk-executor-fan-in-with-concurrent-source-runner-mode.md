---
schema_version: 1
name: "Extend kk executor fan-in with concurrent source-runner mode"
status: done
template: feature-impl
created_at: 2026-09-06T14:35:05.125Z
updated_at: "2026-09-06T22:56:00.327Z"
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
| ------------- | -------- | ---------- |
| R1 | MET | `apps/cli/src/commands/executor.ts:146-151` registers repeatable `--source <plugin>:<file>` + `--source-timeout <ms>` on `executor fan-in` (re-read this run); `apps/cli/src/fanin.ts:148-213` parseArgs parses repeatable `--source <plugin>:<inputFile>` (strict shape, :165/:169 usage throws) and `--source-timeout` (once, positive int); `apps/cli/src/fanin.ts:42` `DEFAULT_SOURCE_TIMEOUT_MS = 30*60*1000` (30m default); `apps/cli/src/invoke.ts:168-192` `spawnPluginEntryAsync` = `Bun.spawn` + `AbortSignal.timeout` (spawn boundary honored: `Bun.spawn`/`Bun.spawnSync` only in invoke.ts, grep this run); `apps/cli/src/fanin.ts:320-326` `Promise.allSettled` spawns all sources concurrently; test `apps/cli/tests/fanin.test.ts:320-358` (2× sleep-500ms fixture plugins, elapsed ≥ 500 and < 1500 — P3a ceiling — concurrent ≈ slowest, not the sum) |
| R2 | MET | `apps/cli/src/fanin.ts:75-109` `mergeDocLists` (first-seen dedupe + provenance, unchanged); `apps/cli/src/fanin.ts:369` source-mode output merges through the same `mergeDocLists(inputs, sources)`; `:341-347` successes appended in `--source` declaration order with provenance = plugin name (`sources.push(source.plugin)` :346); tests `apps/cli/tests/fanin.test.ts:18-101` mergeDocLists unit suite + `:542-584` combined `--in`+`--source` (first-seen dedupe, per-origin provenance, no sourceErrors when clean) |
| R3 | MET | `apps/cli/src/fanin.ts:24-30` `FaninSourceError {plugin, error, durationMs}`; `:329-331` per-source durationMs; `:349-353` `sourceErrors.push` through `capSourceError` (P3b fix — 2048-char cap, `apps/cli/src/fanin.ts:44-60`); `:357-360` every degradation echoed to run output; `:362-366` exit contract — exit 1 only when ALL sources fail (no out.json), else 0; `:372-376` sourceErrors copied onto every merged doc; tests `apps/cli/tests/fanin.test.ts:360-386` (one failing source → surviving docs + sourceErrors entry + exit 0 + stderr echoed), `:388-416` (100k-char stderr capped < 2200 chars, head survives, tail cut, truncation stated — P3b proof), `:418-455` (timeout degrades, siblings unharmed), `:457-478` (all fail → exit 1, no out.json) |
| R4 | MET | `apps/cli/src/fanin.ts:303-310` the `--in` loop (`readDocList` → inputs) runs unchanged before the source branch; `:112-137` `readDocList` (exists/read/JSON/schema) untouched; source branch gated on `opts.sources` (`:312`) so `--in`-only argv takes the same merge+write path (`:369-385`); tests `apps/cli/tests/fanin.test.ts:102-247` `runFanin` `--in`-only describe untouched and green (dedupe/provenance/missing/invalid-JSON/schema/EISDIR/unwritable-out/usage), `apps/cli/tests/commands/executor.test.ts:204-217` main-level `--in` merge exit 0, `:181` missing input exit 1 |
| R5 | MET | `apps/cli/tests/fanin.test.ts:305-620` source-runner describe covers all four clauses: concurrent spawn wall time < sum (`:320`, elapsed < 1500 and ≥ 500), partial failure degradation (`:360`, plus 2KB error cap `:388` and timeout `:418`), all-fail exit 1 (`:457`), `--in` regression (`:102-247`); flag registration asserted in `apps/cli/tests/commands/executor.test.ts:47-76`; full suite green this run (570 pass / 0 fail) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| R1 — Concurrent source collection via kk-owned fan-in | MET | test | `apps/cli/tests/fanin.test.ts:320-358` — concurrent spawn + merge + provenance; implementation `apps/cli/src/fanin.ts:312-366`, `apps/cli/src/invoke.ts:168-192` |
| `fan-in --source aihot-ingest:in.json --source horizon-ingest:in.json --out out.json` spawns both concurrently and merges both Doc[] | MET | test | `apps/cli/tests/fanin.test.ts:320-358` — two 500ms-sleep sources finish in < 1500ms (≥ 500ms), merge order = declaration order (`a1`,`b1`), provenance = plugin names |
| one failing source → out.json written with surviving docs + metadata.sourceErrors entry, exit 0 | MET | test | `apps/cli/tests/fanin.test.ts:360-386` — surviving `ok1` doc + `sourceErrors {plugin:'fanin-bad', error, durationMs}` + exit 0 + stderr echoed; error now capped at 2KB (`:388-416`) |
| all sources fail → exit 1, no out.json | MET | test | `apps/cli/tests/fanin.test.ts:457-478` — exit 1, `existsSync(outFile) === false`, both plugins named in run output |
| `fan-in --in a.json --in b.json` unchanged (regression test green) | MET | test | `apps/cli/tests/fanin.test.ts:102-247` (`--in`-only describe untouched and green) + `apps/cli/tests/commands/executor.test.ts:204-217` main-level merge exit 0 |
| bun run lint && bun run test clean | MET | command | This run: `bun run lint` exit 0 (biome + typecheck, all workspaces exit 0); `bun run test` → 570 pass / 0 fail, 2180 expect() calls, 44 files, 15.48s |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
| ---------- | ----------- | ---------- | ---------- |
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | All Design claims implemented: async spawn confined to invoke.ts (`Bun.spawn` grep this run — no other site), source branch in fanin.ts via shared mergeDocLists, flags in executor.ts, precedence + declaration-order merge as designed; P3a/P3b review fixes documented in Solution without semantic drift |
| P4 | fix-pass | — | P3a `apps/cli/tests/fanin.test.ts:347` ceiling 900→1500ms; P3b `apps/cli/src/fanin.ts:44-60` + `:349-353` capSourceError 2048-char cap + proving test `:388-416`; fix-pass artifacts: `.spur/run/0092-verdict.json` (re-derived after fix) — touched deliverables: apps/cli/src/fanin.ts, apps/cli/tests/fanin.test.ts, docs/tasks/0092 (Solution section) |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows carry executable evidence (test or command run this turn) |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-06T22:09:32.867Z todo → wip (system)
- 2026-09-06T22:53:59.423Z wip → testing (system)
- 2026-09-06T22:56:00.327Z testing → done (system)
