---
schema_version: 1
name: "Extend kk executor fan-in with concurrent source-runner mode"
status: todo
template: feature-impl
created_at: 2026-09-06T14:35:05.125Z
updated_at: "2026-09-06T17:55:24.536Z"
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

- [ ] `fan-in --source aihot-ingest:in.json --source horizon-ingest:in.json --out out.json` spawns both concurrently and merges both Doc[]
- [ ] one failing source → out.json written with surviving docs + metadata.sourceErrors entry, exit 0
- [ ] all sources fail → exit 1, no out.json
- [ ] `fan-in --in a.json --in b.json` unchanged (regression test green)
- [ ] bun run lint && bun run test clean

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
