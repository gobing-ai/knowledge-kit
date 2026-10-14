---
schema_version: 1
name: Normalize kk stage and lock commands with compatible aliases
status: done
template: feature-impl
created_at: 2026-10-13T22:24:49.070Z
updated_at: "2026-10-14T00:01:51.153Z"
feature_id: A22
priority: P1
tags:
  - cli
  - browser-session
estimate_hours: 4

ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0275-verdict.json
---

## 0275. Normalize kk stage and lock commands with compatible aliases

### Background

Feature A22. Implements: R1 — Canonical operations have exactly two command words; R2 — Existing command routes preserve their contracts. Design authority: docs/design/kk-noun-verb-bots.md; ADR-037/038. Implement only this deliverable. Use Bun and existing workspace seams; no new runtime or package. Keep docs/04_DESIGN.md and affected authority/derived docs synchronized in the implementation change. Do not edit .github/workflows. Run bun run lint, bun run test, bun run build and affected Spur rules before implementation completion. Preserve partial evidence if the working budget is reached; do not widen scope or manufacture source edits.

**Refine corrections (2026-10-13)**
- Future stage named run was treated as an existing compatibility obligation → the current dispatcher has no run stage → reserve run for canonical syntax and preserve valid current legacy identifiers.
- Stage alias registration had no dispatch entry specified → main() alone owns product argv parsing → freeze pre-parse normalizeStageArgs and keep the visible noun action-free.
- Root/default group behavior and missing run data were ambiguous → current main and Commander seams own help/error behavior → state explicit group/help and canonical usage handling.
- Lock aliases could duplicate actions → current store handlers already own SQLite side effects → share one registrar and verify with a real temporary DB.
- Checkbox AC had no task requirement coverage → the ready checklist requires bound scenarios → use executable Scenario AC with explicit requirement bindings.
- Canonical docs and bulk callers overlapped 0278 → 0275 owns surface docs/tests; 0278 owns bulk recipes → freeze handoff and out-of-scope boundaries.

Out of scope: implementing other A22 tasks, changing publishing operations, adding a plugin kind/runtime, credential export, server logout, arbitrary caller rewrites, or changes to .github/workflows. Authority: ADR-037/038 and docs/design/kk-noun-verb-bots.md. All changes use the project Bun/Biome conventions and CLI-gated corpus writes. Shared task checks now use Scenario AC with task requirement bindings; feature titles remain stable. No implementation success is claimed by this refinement.

### Requirements

- [x] R1. Expose only canonical two-command-word product actions; keep valid nouns/verbs, add stage run and top-level lock acquire/release, and leave all root/noun groups without default product actions.
- [x] R2. Normalize valid legacy stage invocations at main() before Commander parses them; preserve full process argv prefixes, root -v/--verbose, -- separators, ordered data/unknown options and runStage stdout/stderr/child status. Reserve run as the new verb because no current stage identifier is run.
- [x] R3. Use one lock registrar and the existing SQLite action engines for canonical lock and hidden store lock routes; retain all existing invoke/fanin/fanout/plugin/plugins aliases and option/default/output semantics without alias diagnostics.
- [x] R4. Test the real main parsing path and real temporary SQLite lock effects, plus recursive command-tree shape and hidden alias visibility; keep current valid legacy callers working.
- [x] R5. Update canonical surface documentation and package help tests in this implementation change; defer bulk workflow/skill recipe migration to 0278.

### Acceptance Criteria

```gherkin
Feature: Normalize kk stage and lock commands with compatible aliases

  Scenario: AC1 — R1 — Canonical operations have exactly two command words (req: R1; R4; R5)
    Given the complete visible command tree including all store and workflow operations
    When an operator inspects root and noun help
    Then each executable operation uses kk followed by one noun and one verb
    And stage run and lock acquire and lock release replace the irregular canonical paths
    And existing valid board, daily, executor, ledger, plugin, schedule and store operations retain their names
    And a command-tree test detects a direct noun action or a nested third command word

  Scenario: AC2 — R2 — Existing command routes preserve their contracts (req: R2; R3; R4; R5)
    Given scripts using stage positional arguments, store lock acquire or release, and existing hidden aliases
    When they execute with their original arguments and options
    Then they reach the same action engines with equivalent stdout, stderr, exit codes and side effects
    And aliases are hidden from canonical help without emitting warnings into machine output
    And legacy stage names and canonical stage run dispatch without losing unknown options or positional arguments

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-13T22:40:49.139Z

Stage run is newly reserved syntax; preserve existing valid stage identifiers rather than hypothetical future identifiers. Canonical routing lives in main pre-parse normalization, and locks share current SQLite engines. Bulk recipe replacement belongs to 0278.

### Design

Chosen shape: export normalizeStageArgs(argv: readonly string[]): string[] from apps/cli/src/commands/stage.ts; main.ts calls it before parseAsync. It preserves argv[0:2], recognizes the root stage token after supported root globals, and inserts run only for legacy stage-data tokens. help stage and root help/version are unchanged; stage run --help targets canonical verb help; stage run with no stage is a canonical usage error. No existing stage has identifier run, so do not invent a compatibility branch for a hypothetical future run stage. Root/noun absence shows Commander help/usage without executing data work. The normalization contract applies to main(), the product entry; direct registrar unit tests exercise canonical registration.

registerStageCommand registers stage as a group and run <args...> as its only visible operation; the handler delegates to runStage. Keep unknown-option handling and argument order through the existing output/error seam. Lift lock registration into apps/cli/src/commands/lock.ts as registerLockCommands(parent, hidden=false) or an equally small shared registrar; canonical lock uses it once, hidden store lock uses it once. SQLite actions stay shared; no child kk invocation and no copied action bodies.

Ownership: apps/cli/src/main.ts, cli.ts, commands/stage.ts, commands/store.ts, new commands/lock.ts, affected CLI tests, and surface docs. No dependency on 0276; leave 0278 canonical routes/alias tests to consume. No bot code. Production requireDiff=true. Budget: existing four-hour estimate; save partial task evidence rather than broadening.

Concurrency: no WIP tasks were returned in the current tree. A separate worktree /Users/robin/xprojects/knowledge-kit-dev-runall-0269-0270-0272-43ce exists for earlier channel work; unrelated WeChat .probe-0272*.ts files are present here. Do not edit/revert their work. Re-read affected channel files and the current task corpus at implementation start; if landed channel fixes change an assumption, retain the public contract and update this task through Spur. Generated apps/cli/dist is not evidence of current source behavior: rebuild before packaged smoke checks. Bun 1.4.3, Playwright 1.55.0 and ts-browser-automation 0.5.24 match the installed packages and bun.lock. Prior repository lint was blocked by unrelated probe formatting/import errors, so do not claim a green baseline; report any remaining outside-scope findings.

Verified source premises: apps/cli/src/main.ts:28; apps/cli/src/commands/stage.ts:9; apps/cli/src/commands/store.ts:1605; apps/cli/src/cli.ts:19; apps/cli/tests/main.test.ts:52; apps/cli/tests/commands/store.test.ts:38.

### Plan

- [x] 1. Baseline: read all stage identifiers in kk-workflow-stages.ts and all createProgram/main callers; capture current supported legacy argv and lock outputs. Record concurrent work/baseline findings.
- [x] 2. Implement main-stage argv normalization and canonical stage registration; factor lock registration around the existing handlers. Retain current aliases.
- [x] 3. Extend apps/cli/tests/main.test.ts and commands/stage.test.ts for globals, --, unknown options, help, unknown stages, missing data and child exit failures. Extend commands/store.test.ts plus new commands/lock.test.ts to acquire/re-enter/contend/release a real temporary DB through canonical and legacy routes.
- [x] 4. Update recursive command-tree assertions in apps/cli/tests/main.test.ts or a focused cli-surface.test.ts; sweep pinned visible noun/verb lists and help expectations before running tests.
- [x] 5. Sync docs/04_DESIGN.md, docs/design/kk-cli-surface.md, the A22 satellite and AGENTS surface notes; run targeted tests, rebuild/package smoke, bun run lint/test/build and affected Spur constraints. Report pre-existing outside-scope failures.

### Solution

Canonical `kk stage run` + top-level `kk lock acquire|release` (ADR-037 / A22 R1–R3), with every
shipped spelling kept as a hidden compatibility route on the same engines.

**Change map**

- `apps/cli/src/commands/stage.ts:19` — `normalizeStageArgs(argv)`, the pre-parse rewrite the Design
  freezes in `main()`. It preserves `argv[0:2]`, steps over the only root globals (`-v`/`--verbose`)
  and inserts `run` after a bare `stage` token; `kk stage`, `kk stage run …`, `kk stage --help/-h`
  and every non-stage invocation return unchanged, so an unknown root option still reaches
  Commander's own error path. Only the token is inserted — the remainder of argv is copied verbatim,
  which is what preserves `--` separators, unknown options and positional order.
- `apps/cli/src/commands/stage.ts:38` — `stage` becomes an action-free group whose single visible verb
  is `run <args...>`; the handler still delegates to `runStage` and still maps a non-zero child status
  to `CommanderError('kk.stage.failed')`. No stage identifier in
  `plugins/kk/scripts/kk-workflow-stages.ts` is `run`, so the verb is reserved, not overloaded.
- `apps/cli/src/main.ts:56` — the product entry parses `normalizeStageArgs(argv)`; `main()` alone owns
  product argv parsing, so direct registrar tests still exercise canonical registration.
- `apps/cli/src/main.ts:40` — Commander settings re-inheritance is now recursive instead of two levels
  deep. The registered tree is three levels in one place (`store lock acquire`); without this, a
  Commander-level error on that route (e.g. a missing required option) called `process.exit` instead
  of returning the exit code through the `exitOverride` seam. Same verdict, one exit path.
- `apps/cli/src/commands/lock.ts:105` — one registrar `registerLockCommand(parent, hidden)` used twice:
  visible as `kk lock` and hidden as the legacy `kk store lock` group.
- `apps/cli/src/commands/lock.ts:56,84` — the lock acquire/release action engines, lifted out of
  `store.ts` unchanged (`LocksDao` via `openStore`, `--ttl` parse, `{acquired}` / `{skipped, holder}` /
  `{released}` JSON, `kk.store.lock.failed` contract line). The actions now live in exactly one module,
  with the per-module `failLoud` helper this repo already repeats in `board.ts` / `daily.ts` / `ledger.ts`;
  no child `kk` invocation and no copied action body.
- `apps/cli/src/commands/store.ts:1539` — the store noun registers the same registrar with `hidden`
  true, so `kk store lock …` keeps its flag/default/JSON/exit/DB contract but leaves `kk store --help`.
- `apps/cli/src/cli.ts:31` — `registerLockCommand(program)` gives the third canonical route (`lock`) a
  visible first-layer group; the group carries no default action.
- `apps/cli/tests/main.test.ts:172` — recursive command-tree test: every visible command is either a
  first-layer group with no action handler or a two-word leaf, the visible leaf inventory is pinned
  exactly (27 leaves: the 24 conforming shipped verbs ADR-037 counted + `stage run` + `lock acquire` +
  `lock release`; the `bot` verbs of 0276/0277 take it to the design's final 31), and the hidden
  routes are pinned as an explicit allowlist so a new hidden shape is a deliberate test edit.
- `apps/cli/tests/main.test.ts:264` — legacy-vs-canonical dispatch through the real `main()` with the
  ts-utils output seam captured: identical stdout/stderr/exit for `kk stage <stage>` and
  `kk stage run <stage>` (unknown option + `--` separator included), globals preserved, group help /
  verb help / missing-stage usage error canonical.
- `apps/cli/tests/commands/stage.test.ts:169` — `normalizeStageArgs` unit table (prefix, globals,
  separators, canonical and non-stage pass-through); `:32` registrar test updated to the `run` verb and
  asserts the group has no action handler and one visible verb.
- `apps/cli/tests/commands/lock.test.ts:48` — new: core tree shape and hidden legacy registration, plus
  every lock scenario (acquire, re-enter, contend, foreign release, own release, reclaim) run through
  BOTH routes against a real temporary SQLite DB, one cross-route case proving both spellings hit the
  same row, and shared `kk.store.lock.failed` parity for a malformed `--ttl`.
- `apps/cli/tests/commands/store.test.ts:57` — asserts `kk store --help` no longer lists `lock` while the
  verbs stay registered.
- `docs/04_DESIGN.md:74,104,117,570,609,620` — surface listing, shipped table row, surface-status note,
  §1.8 `stage` and §1.9 `store`/`lock` sections now name the canonical spellings, record the legacy
  routes as hidden/no-diagnostics, and state the single-registrar/single-engine ownership.
- `docs/design/kk-cli-surface.md:87,97` — canonical surface block gains `stage run` and `lock
  acquire|release`; the hidden-alias list gains the two legacy routes; an ADR-037 canonicalization note
  records what shipped.
- `docs/design/kk-noun-verb-bots.md:13` — the A22 satellite records the shipped 0275 slice instead of
  reading as wholly unshipped.

**Scope decisions.** `AGENTS.md` has no kk command-surface section (its only CLI section is the *Spur*
CLI surface), so there was nothing to sync there. `docs/04_DESIGN.md:1484` and the
`plugins/kk/workflows/kk-collect.yaml` recipes still spell `kk stage …` / `kk store lock …` — that bulk
caller/recipe migration is 0278's deliverable, and both spellings are exercised working routes.
No `.github/workflows`, no bot/noun/plugin-kind code, no new runtime or package.

**Out-of-scope finding (pre-existing, not repaired here).** `spur rule run --preset recommended-pre-check`
reports one error outside this diff: `no-dead-run-scoped-citation` names dead `.spur/run` /
`.spur/memory` pointers in the done tasks 0243, 0247, 0252 and 0255 (`sh
.spur/rules/structure/scratch-citation-existence.sh` lists the five file:line pairs). `bun run lint`
(biome 469 files + every workspace typecheck) exits 0.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/commands/stage.ts:39-52` registers `stage` as an action-free group whose only product verb is `run <args...>`; `apps/cli/src/commands/lock.ts:105` registers the visible `lock` group; `apps/cli/src/cli.ts:31` mounts it at the root; `apps/cli/src/commands/store.ts:1539` keeps the legacy route. Re-executed probes: `bun apps/cli/src/index.ts stage --help` lists only `run`; bare `bun apps/cli/src/index.ts stage` exits 1 with usage (no data action); `bun apps/cli/src/index.ts lock --help` lists `acquire`/`release`. Recursive tree test `apps/cli/tests/main.test.ts:172` fails a noun action or a third command word. Existing aliases untouched: `apps/cli/src/commands/executor.ts:222,228,232`, `apps/cli/src/commands/plugin.ts:374`. |
| R2 | MET | `apps/cli/src/commands/stage.ts:19-31` (`normalizeStageArgs`) inserts only `run` and copies the prefix/tail verbatim; wired pre-parse at `apps/cli/src/main.ts:54`; unit table `apps/cli/tests/commands/stage.test.ts:169` covers prefix, root globals, `--` separators and ordered unknown options. Re-executed probe `kk stage <legacy>` vs `kk stage run <legacy>` produced identical stdout, identical stderr and exit 1 on both (`diff` clean); `kk --verbose stage <legacy>` normalized and reached `runStage`. No stage identifier is `run`, so the verb is reserved. |
| R3 | MET | `apps/cli/src/commands/lock.ts:105` is one registrar (`registerLockCommand(parent, hidden)`) used at `apps/cli/src/cli.ts:31` (visible) and `apps/cli/src/commands/store.ts:1539` (hidden); the acquire/release action engines live once in `apps/cli/src/commands/lock.ts:56,84`. Re-executed probe against a throwaway DB: `kk lock acquire --db … --name collect --run runA` -> `{"acquired":true}`; contend via `kk store lock acquire --run runB` -> `{"skipped":"locked","holder":"runA"}` proving one shared DB row; `kk lock release --run runA` -> `{"released":true}`; no deprecation text on stdout/stderr. `apps/cli/tests/commands/lock.test.ts:144` asserts the shared-row invariant. |
| R4 | MET | Real `main()` path and a real temporary SQLite DB: `apps/cli/tests/commands/lock.test.ts:19,32,49` (`mkdtempSync`+`realpathSync` DB, `main(['node','kk',…])`). Tree shape / hidden visibility: `apps/cli/tests/main.test.ts:172,191,227`. Re-executed `bun test apps/cli/tests/main.test.ts apps/cli/tests/commands/stage.test.ts apps/cli/tests/commands/store.test.ts apps/cli/tests/commands/lock.test.ts` -> 46 pass / 0 fail; `bun test apps/cli/tests/kk-collect.test.ts` -> 6 pass / 0 fail (legacy `kk store lock` caller intact at `apps/cli/tests/kk-collect.test.ts:184`). |
| R5 | MET | Canonical surface docs updated in this diff: `docs/04_DESIGN.md:74,104,117,572,606`; `docs/design/kk-cli-surface.md:87,94,97`; `docs/design/kk-noun-verb-bots.md:13`. Help tests updated: `apps/cli/tests/main.test.ts:75` pins `lock` in the first-layer noun list; `apps/cli/tests/commands/store.test.ts:57` asserts `kk store --help` hides `lock`. Bulk recipe migration left to 0278 (design note `docs/design/kk-cli-surface.md:87`); the legacy route is exercised and working. Re-run `bun apps/cli/src/index.ts store --help` no longer lists `lock`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R1 — Canonical operations have exactly two command words (req: R1; R4; R5) | MET | test | `apps/cli/tests/main.test.ts:172` (no noun action / no third word), `:191` (visible leaf inventory incl. `lock acquire |
| AC2 — R2 — Existing command routes preserve their contracts (req: R2; R3; R4; R5) | MET | test | `apps/cli/tests/main.test.ts:265` (legacy vs canonical identical out/err/exit), `apps/cli/tests/commands/lock.test.ts:144` (both routes hit one DB row), `apps/cli/tests/kk-collect.test.ts:184` (legacy route intact); corroborated by re-executed `kk stage <legacy>` vs `kk stage run` diff and `kk lock`/`kk store lock` shared-row DB probes. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0275
**Scope:** working-tree diff vs HEAD — 13 files: `apps/cli/src/{main.ts,cli.ts,commands/stage.ts,commands/store.ts}` + new `apps/cli/src/commands/lock.ts`; `apps/cli/tests/{main.test.ts,commands/stage.test.ts,commands/store.test.ts}` + new `apps/cli/tests/commands/lock.test.ts`; `docs/04_DESIGN.md`; `docs/design/kk-cli-surface.md`; `docs/design/kk-noun-verb-bots.md`; the task file. Generated `apps/cli/dist` excluded.
**Dimensions:** functional traceability, correctness, security, efficiency, usability, architecture
**Verdict:** PASS
**Confidence:** HIGH

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | architecture | Authority notes `docs/03_ARCHITECTURE.md:322` and `docs/00_ADR.md:568` still describe the shipped stage surface as `kk stage <stage>` in the present tense. ADR-037 explicitly declares such historical noun inventories "describe their shipping dates, not an eternal two-noun limit", and R5 scopes doc sync to the three surface docs (bulk caller/recipe migration is 0278). Stale-reading, not a false claim. | `docs/03_ARCHITECTURE.md:322` | ACCEPTED (historical; ADR-037/0278 own it) |
| 2 | P4 (advisory) | usability | Legacy `kk stage <stage> --help`/`-h` rendered the group help; after normalization it renders the `run` verb help (`Usage: kk stage run …`). Both exit 0 and are non-data — Commander intercepted `--help` in the legacy path too (verified against a legacy-shaped command), so no machine or exit-code contract is lost; help text only. | `apps/cli/src/commands/stage.ts:25` | ACCEPTED |
| 3 | P4 (advisory) | correctness | The task's `## Requirements` boxes (`- [ ] R1…R5`) are still unticked while `## Plan` is complete. R1–R5 are all MET (traceability below), so this is `done`-stage housekeeping (zero-unchecked-boxes), not a source defect. | `docs/tasks/0275_normalize-kk-stage-and-lock-commands-with-compatible-aliases.md:37` | ACCEPTED (done-stage) |
| 4 | P4 (advisory) | — | Wrap summary — no P1–P3 findings. Reviewed the shared dispatch path (P1 priority) end-to-end: `normalizeStageArgs` preserves every claimed argv shape (root `-v`/`--verbose` before/after, `--` separators, unknown options, `kk stage`/`--help`/`run`, non-stage, wrapper prefix); the recursive Commander re-inherit is correct at all depths (depth-3 `store lock acquire` now returns through the `exitOverride` seam instead of `process.exit`); the dual-route lock registrar shares one engine and one DB row with byte-pure stdout/stderr and identical error codes. 46/46 affected tests green. | `apps/cli/tests/main.test.ts:172` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — only canonical two-command-word actions; groups action-free | MET | `apps/cli/src/commands/stage.ts:40-42` (action-free `stage` group + `run <args...>`); `apps/cli/src/commands/lock.ts:106` (visible `lock` group); `apps/cli/src/cli.ts:31` registers it at the root; `apps/cli/src/commands/store.ts:1539` registers the hidden legacy route; `apps/cli/tests/main.test.ts:172` recursive tree test (no noun action, no third word; leaf inventory pinned at `:191`). |
| R2 — legacy stage argv preserved at main() pre-parse | MET | `apps/cli/src/commands/stage.ts:19-31` `normalizeStageArgs` inserts only `run` and copies `argv[0:i+1]`+tail verbatim; wired at `apps/cli/src/main.ts:56`; `apps/cli/tests/commands/stage.test.ts:169` unit table (prefix, globals, `--`, unknown opts, non-stage pass-through); `apps/cli/tests/main.test.ts:265` real-`main()` out/err/exit equivalence of `kk stage <x>` vs `kk stage run <x>`. |
| R3 — one lock registrar; existing aliases retained, no alias diagnostics | MET | `apps/cli/src/commands/lock.ts:105` single `registerLockCommand(parent, hidden)` used at `apps/cli/src/cli.ts:31` and `apps/cli/src/commands/store.ts:1539`; `invoke`/`fanin`/`fanout`/`plugin|plugins` untouched by the diff; `apps/cli/tests/commands/lock.test.ts:144` proves both routes hit ONE DB row; `:97` asserts `err === ''` (no deprecation text). |
| R4 — real main path + real temp SQLite + tree-shape/hidden-alias tests | MET | `apps/cli/tests/commands/lock.test.ts:19,32` (`main()` in-process, `realpathSync(mkdtempSync(...))` DB), `:49` core tree/hidden registration; `apps/cli/tests/main.test.ts:172,191,227` tree shape + explicit hidden allowlist; legacy caller `apps/cli/tests/kk-collect.test.ts:184` still exercises `kk store lock`. |
| R5 — surface docs + help tests updated; bulk recipe migration deferred | MET | `docs/04_DESIGN.md:74,104,105,572,606-621`; `docs/design/kk-cli-surface.md:87,94,97`; `docs/design/kk-noun-verb-bots.md:13-15`; help tests `apps/cli/tests/main.test.ts:54` (first-layer nouns incl. `lock`) and `apps/cli/tests/commands/store.test.ts:57-65`. Bulk callers still on the working legacy route: `plugins/kk/workflows/kk-collect.yaml:79,176` → 0278. |

##### Acceptance Criteria Verification

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| AC1 — R1 — Canonical operations have exactly two command words (req: R1; R4; R5) | MET | test | `apps/cli/tests/main.test.ts:172` (no noun action / no third word), `:191` (visible leaf inventory), `:227` (hidden allowlist); registrar assertions `apps/cli/tests/commands/stage.test.ts:110` and `apps/cli/tests/commands/lock.test.ts:49`. |
| AC2 — R2 — Existing command routes preserve their contracts (req: R2; R3; R4; R5) | MET | test | `apps/cli/tests/main.test.ts:265` (legacy vs canonical identical out/err/exit), `apps/cli/tests/commands/lock.test.ts:144` (shared row), `:97,:121` (malformed `--ttl` parity, `err === ''`), `apps/cli/tests/kk-collect.test.ts:184` (legacy route intact). |

**Next:** none — no P1–P3 findings; P4 advisories are accepted (item 1 owned by ADR-037/0278, item 3 resolved at the `done` housekeeping step).

### References

Feature A22; ADR-037/038; docs/design/kk-noun-verb-bots.md.

Current-tree premises: apps/cli/src/main.ts:28; apps/cli/src/commands/stage.ts:9; apps/cli/src/commands/store.ts:1605; apps/cli/src/cli.ts:19; apps/cli/tests/main.test.ts:52; apps/cli/tests/commands/store.test.ts:38.

Dependency contracts: none.

Concurrency: no WIP tasks were returned in the current tree. A separate worktree /Users/robin/xprojects/knowledge-kit-dev-runall-0269-0270-0272-43ce exists for earlier channel work; unrelated WeChat .probe-0272*.ts files are present here. Do not edit/revert their work. Re-read affected channel files and the current task corpus at implementation start; if landed channel fixes change an assumption, retain the public contract and update this task through Spur. Generated apps/cli/dist is not evidence of current source behavior: rebuild before packaged smoke checks. Bun 1.4.3, Playwright 1.55.0 and ts-browser-automation 0.5.24 match the installed packages and bun.lock. Prior repository lint was blocked by unrelated probe formatting/import errors, so do not claim a green baseline; report any remaining outside-scope findings.

### History

- 2026-10-13T23:16:59.700Z todo → wip (system)
- 2026-10-14T00:01:18.409Z wip → testing (system)
- 2026-10-14T00:01:51.118Z testing → done (system)

