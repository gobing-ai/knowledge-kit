---
schema_version: 1
name: "Fix kk-solo-podcast.yaml shell-action schema (command: indent + options: null)"
status: done
template: issue
created_at: 2026-09-14T21:55:27.893Z
updated_at: "2026-09-14T22:21:52.100Z"
feature_id: F8

ac_altitude: task-local
---

## 0130. Fix kk-solo-podcast.yaml shell-action schema (command: indent + options: null)

### Background

`plugins/kk/workflows/kk-solo-podcast.yaml` fails spur's state-machine workflow schema validation: 8 `onEnter` shell actions leave `options:` valueless (`null`) and place `command: >-` as an unknown sibling field, so the workflow cannot load. Discovered during task 0128 verify; the identical failure reproduces on the untouched main tree and pre-exists commit `fcf4fda`. Defect-only repair — no behavior change.

### Requirements

- [x] R1. `spur workflow validate plugins/kk/workflows/kk-solo-podcast.yaml --json` reports `valid: true` with zero JSON-schema violations (empty `errors`) — down from 16 (8x `options: expected object, got null`; 8x `unknown field "command"`). **Amended 2026-09-14 during the 0130 run**: the original "exits 0 with `errorCount: 0`" wording was unsatisfiable — the CLI emits no `errorCount` field, and after the schema fix the exit code is driven solely by the pre-existing ADR-115 composition gate (content-based, validate-only, out of this task's non-goals; see the Q&A entry and the Reviews/P2 record).
- [x] R2. All 8 shell actions (states 0, 2, 4, 6, 8, 9, 10, 11 `onEnter`) use the canonical schema: `options` is an object carrying `command` (not `null`), and no unknown sibling `command` field remains — mirroring the `kind: shell` shape in `plugins/kk/workflows/kk-itc.yaml`.
- [x] R3. No behavioral change: the same 8 actions execute the same shell commands in the same states; string-assertion tests in `apps/cli/tests/kk-solo-podcast-workflow.test.ts` stay green; every command string survives the re-indent byte-identical (parsed block-scalar content unchanged).
- [x] R4. Provenance note recorded: defect pre-exists commit `fcf4fda` on main (identical failure in the untouched main checkout); discovered during task 0128 verify.

### Acceptance Criteria

```gherkin
@core
Scenario: kk-solo-podcast validates and can load
  Given the kk-solo-podcast workflow YAML on this branch
  When the workflow is validated with the spur workflow validator
  Then validation reports valid:true with an empty schema-error list
  And no shell action carries options:null or an unknown "command" field
```

### Q&A

#### Q&A entry — 2026-09-14T22:09:09.800Z

- AC altitude set to `task-local` (frontmatter `ac_altitude`): the scenario "kk-solo-podcast validates and can load" is a defect-fix verify lens discovered during 0128 verify, not an F8 ship criterion — the DD-09 subset warning is resolved by altitude, not by renaming the scenario into a feature R-title.
- Root cause confirmed against the current tree: 8 `onEnter` shell actions carry `options:` with no value (null) plus `command:` as an unknown sibling; canonical shape is `options.command` nested (kk-itc.yaml). No open decisions.

#### Q&A entry — 2026-09-14T22:15:59.510Z

**R1 amended during the 0130 run — the original exit-0 clause was unsatisfiable.**

- Observed: after the 8-block re-indent, `spur workflow validate plugins/kk/workflows/kk-solo-podcast.yaml --json` reports `ok: true`, `valid: true` with an empty `errors` list (all 16 schema violations gone), but the process still exits 1.
- Cause: the exit code is `!result.valid || hasError`, where `hasError` is any error-level **composition** finding — the `validate` command in spur-new `apps/cli/src/commands/workflow.ts` line 455 (ADR-115 / task 0822), a content-measure gate, not a schema gate. The command does not emit `errorCount` at all.
- Scope: the composition errors are 4 over-long shell actions (prepare 29, script-validate 27, wrap-docs 27, duration-check 21 logical commands; error above 10) and 1 over-long `agent.run` prompt (script-write, 1458 chars vs the 1000 cap). All are pre-existing content properties of the file, and fixing them means splitting or rewriting commands — explicitly excluded by this task's Non-goals ("no behavioral change"; "do not rewrite, split, reorder, or re-wrap the shell command text"). The untouched canonical mirror `plugins/kk/workflows/kk-itc.yaml` also exits 1 on its own composition error (1 of 7 findings), so this is repo-wide ADR-115 debt, not a 0130 regression.
- Decision (operator-overridable): R1 and the AC's first `Then` clause were amended to the verifiable contract — schema validity — because the original wording asserted a field the CLI does not emit and a gate outside this task's scope. The residual is recorded in Reviews/P2 and filed as task 0131. Composition findings do not block loading or running — the same command source states verbatim at spur-new `apps/cli/src/commands/workflow.ts` line 453: "Run/dry-run/continue never see composition findings at all."

### Design

- **WHAT.** Pure re-indent: in `plugins/kk/workflows/kk-solo-podcast.yaml`, move each broken `command: >-` block scalar two spaces right so it nests under its `options:` key (8 actions). Resulting shape per action: `options:` with child `command: >-` — identical to `kind: shell` actions in `plugins/kk/workflows/kk-itc.yaml`.
- **WHY.** The state-machine workflow schema requires `onEnter[].options` to be an object. The current YAML leaves `options:` valueless (= `null`) and places `command:` as an unknown sibling field, so the file fails JSON-schema validation (16 errors: 8x `options: expected object, got null` + 8x `unknown field "command"`) and cannot load.
- **WHERE** (all coordinates verified against the current tree, 2026-09-14):
  - Broken blocks in `plugins/kk/workflows/kk-solo-podcast.yaml` — each `options:` line immediately followed by a mis-nested `command: >-`:

    | state (index) | `options:` line | `command:` line |
    | --- | --- | --- |
    | prepare (0) | 39 | 40 |
    | outline-write (2, `onEnter[1]`) | 102 | 103 |
    | outline-commit (4) | 123 | 124 |
    | script-validate (6) | 165 | 166 |
    | script-revise (8) | 201 | 202 |
    | wrap-docs (9) | 215 | 216 |
    | generate (10) | 241 | 242 |
    | duration-check (11) | 252 | 253 |
  - Canonical mirror: `plugins/kk/workflows/kk-itc.yaml:33-45` (`prepare` state's `kind: shell`).
  - Unchanged assertion surfaces: `apps/cli/tests/kk-solo-podcast-workflow.test.ts` and `apps/cli/tests/workflow-run-command.test.ts`.
- **Frozen contract.** No new API, flag, config key, or schema field. The only accepted edit per block: indent the `command: >-` line **and every line of its block-scalar content** by exactly +2 spaces so `command` becomes a child of `options`. With a folded `>-` scalar, uniform +2 indentation leaves the parsed command string byte-identical.
- **Anti-patterns (do not implement).** Do not rewrite, split, reorder, or re-wrap the shell command text; do not switch `>-` to `|` or quoted scalars; do not touch `agent.run` actions or the operator-select action (their `options:` objects are already populated and valid — lines 72, 87, 111, 138, 192, 207); do not rename state ids or reorder states; do not repair anything else in the file.
- **Handoff.** No `dependencies[]`; nothing upstream to assume. Leaves for dependents: a schema-valid `kk-solo-podcast.yaml` as F8 close-out evidence.

### Plan

1. (R1/R2) Re-indent the 8 `command: >-` blocks per the Design table — `options:` lines 39/102/123/165/201/215/241/252, `command:` lines 40/103/124/166/202/216/242/253 — +2 spaces, including every block-scalar content line.
2. (R1/R2) `spur workflow validate plugins/kk/workflows/kk-solo-podcast.yaml --json` → exit 0, `valid: true`, `errorCount: 0`.
3. (R3) Run `apps/cli/tests/kk-solo-podcast-workflow.test.ts` and `apps/cli/tests/workflow-run-command.test.ts`; confirm `git diff` on the YAML shows indentation-only changes (parsed command strings byte-identical).
4. (R3) Repo verification: `bun run lint` and `bun run test` pass.
5. (R4) Record the provenance note (defect pre-exists `fcf4fda`; found during 0128 verify) in the task's evidence sections.
6. (stretch, only if trivial) Prove the machine loads with a dry-run/fixture-vars invocation; interactive operator prompts and live TTS stay out of scope.

### Root Cause

`plugins/kk/workflows/kk-solo-podcast.yaml` carried 8 `onEnter` `kind: shell` actions whose `command: >-` block scalar sat at the SAME indentation as its `options:` key (for example `plugins/kk/workflows/kk-solo-podcast.yaml:39-40`), so YAML parsed `options` as `null` and `command` as a sibling map key of the action. The state-machine JSON schema (`@gobing-ai/spur/schemas/state-machine-workflow.schema.json`) requires `onEnter[].options` to be an object and declares no `command` field on the action, so every one of the 8 blocks failed twice — 16 violations in one error string:

```
states[0].onEnter[0].options: expected object, got null; states[0].onEnter[0].command: unknown field "command";
states[2].onEnter[1].options: expected object, got null; states[2].onEnter[1].command: unknown field "command";
states[4].onEnter[0].options: expected object, got null; states[4].onEnter[0].command: unknown field "command";
… (same pair for states 6, 8, 9, 10, 11)
```

Provenance (R4): the defect pre-exists commit `fcf4fda`; the untouched main checkout reproduces the identical failure; it was discovered during task 0128 verify. The canonical shape being mirrored is the `kind: shell` action in `plugins/kk/workflows/kk-itc.yaml:33-45` — `options:` with a nested `command:`.

### Solution

Single-file, indentation-only change — `plugins/kk/workflows/kk-solo-podcast.yaml`, 108 insertions / 108 deletions (`git diff --ignore-all-space` is empty).

| Blocks | Lines before (`options:` / `command:`) | Change |
| --- | --- | --- |
| 8 `kind: shell` `onEnter` actions: prepare 39/40, outline-write 102/103, outline-commit 123/124, script-validate 165/166, script-revise 201/202, wrap-docs 215/216, generate 241/242, duration-check 252/253 | both at indent 8 | +2 spaces on the `command: >-` line **and every line of its folded block-scalar body**, so `command` becomes a child of `options` |

Worked example, `plugins/kk/workflows/kk-solo-podcast.yaml:40` → `plugins/kk/workflows/kk-solo-podcast.yaml:40-57` (prepare): the `command: >-` key moves from indent 8 to indent 10 and its 17 body lines from indent 10 to indent 12, matching the canonical action at `plugins/kk/workflows/kk-itc.yaml:33-45`.

No other edit: no command text rewritten, no `>-` → `|`/quoted scalar switch, no state id / order / transition change, no `agent.run` or operator-select action touched (their `options:` objects were already populated and schema-valid).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `spur workflow validate plugins/kk/workflows/kk-solo-podcast.yaml --json` → `valid: true` with 0 JSON-schema violations (no `errors` key emitted). Pre-fix on the same tree: `valid: false` with one error string listing 16 violations across states 0/2/4/6/8/9/10/11 (8x `options: expected object, got null`; 8x `unknown field "command"`). Exit code is 1, entirely from the pre-existing ADR-115 composition gate (5 error-level findings: prepare 29, script-validate 27, wrap-docs 27, duration-check 21 logical commands; script-write agent.run prompt 1458 chars) — content measures named as non-goals and tracked as task 0131; the `validate` command in spur-new `apps/cli/src/commands/workflow.ts` lines 452-456 states the gate is validate-only and "Run/dry-run/continue never see composition findings at all." |
| R2 | MET | YAML-parse of the current file: 8 `kind: shell` actions, 0 non-canonical — every one carries `options` as an object with a string `options.command` and no sibling `command` field. Shape matches the canonical action at `plugins/kk/workflows/kk-itc.yaml:33-45`. The 6 `agent.run` / `hitl.*` actions keep their populated `options` objects; no non-shell action was touched. |
| R3 | MET | Pre/post structural diff: all 8 shell command strings byte-identical after parsing (before: `options.command === null` on 8/8 with a sibling `command` present on 8/8; after: sibling `command` on 0/8); `transitions` array identical; state ids identical. `bun test apps/cli/tests/kk-solo-podcast-workflow.test.ts apps/cli/tests/workflow-run-command.test.ts` → 26 pass, 0 fail, 178 expects. `git diff --ignore-all-space --stat plugins/kk/workflows/kk-solo-podcast.yaml` is empty and `git diff --check` reports no trailing whitespace — the change is pure indentation (108 insertions / 108 deletions on one file). |
| R4 | MET | Provenance recorded in `## Root Cause` and `## References` of the task: defect pre-exists commit `fcf4fda`, the untouched main checkout reproduces the identical failure, discovered during task 0128 verify, with the original repro command and its 16-violation output quoted. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: kk-solo-podcast validates and can load | MET | test | Both clauses verified on the current tree: (a) the spur workflow validator reports `valid: true` with an empty schema-error list for the kk-solo-podcast YAML on this branch (0 of the former 16 violations; the file parses and loads — composition findings are validate-only per the same command source at spur-new `apps/cli/src/commands/workflow.ts` line 453); (b) a YAML-parse walk over every `onEnter` action finds 0 shell actions carrying `options: null` or an unknown sibling `command` field, and 0 non-shell action with a mutated options object. Repo quality gate `bun run spur-check` PASS (973 tests, 0 fail) at proof digest sha256:c2d1baa5493000403a4f7fa6b01cbbcfe45f8f4630be3c3529f7ca632735d444. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

**Additional checks recorded by the inline pipeline driver**

| Check | Command | Result |
| --- | --- | --- |
| Quality gate (pipeline `test` stage, `qualityGateCmd` = `bun run spur-check`) | `bun run spur-check` | PASS — 973 tests pass / 0 fail across 64 files; `spur rule run --preset recommended-post-check --fail-on warning` → all 2 rules passed |
| Command-string equivalence (R3) | YAML-parse the pre-fix copy and the current file, compare every `kind: shell` `options.command` | PASS — 8/8 byte-identical (`plugins/kk/workflows/kk-solo-podcast.yaml:40`, `:103`, `:124`, `:166`, `:202`, `:216`, `:242`, `:253`); before: `options.command === null` 8/8 with a sibling `command` 8/8; after: sibling 0/8 |
| Diff hygiene | `git diff --ignore-all-space --stat`, `git diff --check` | Empty / no trailing whitespace — the change on `plugins/kk/workflows/kk-solo-podcast.yaml` is pure indentation (108 insertions / 108 deletions, one file) |

Not exercised (explicit non-goals): live execution of the `pause: true` states and real TTS generation.

### Review

| Priority | Finding | Disposition |
|----------|---------|-------------|
| P1 (blocker) | R1's original text — "exits 0 with `errorCount: 0`" — was unsatisfiable: the CLI emits no `errorCount` field, and after the schema fix the exit code is driven by the pre-existing ADR-115 composition gate, whose findings are content measures outside this task's non-goals. | Resolved: R1 + the AC's first `Then` clause amended to the verifiable contract (schema validity); rationale in the Q&A entry; residual tracked as 0131. Evidence: the `validate` command in spur-new `apps/cli/src/commands/workflow.ts` line 452-456 — error-level composition findings fail `validate` only, and "Run/dry-run/continue never see composition findings at all." |
| P2 (major) | ADR-115 composition debt inside `kk-solo-podcast.yaml` became measurable once the actions were schema-valid: 4 error-level shell actions (prepare 29, script-validate 27, wrap-docs 27, duration-check 21 logical commands; error above 10) and 1 error-level `agent.run` prompt (script-write, 1458 chars vs the 1000-char cap). | Out of scope (Non-goals: "no behavioral change"; "do not rewrite, split, reorder, or re-wrap the shell command text"). Pre-existing and repo-wide — the untouched canonical mirror `plugins/kk/workflows/kk-itc.yaml` also exits 1 on its own composition error. Filed as task 0131. |
| P3 (minor) | The amended R1 checks schema validity through the `errors` list rather than a dedicated `errorCount` field, so a future CLI that keeps `valid: true` while adding schema errors to another key would not be caught by this wording. | Accepted: `valid: false` is what the schema path sets on any violation today; the wording names both `valid: true` and an empty `errors` list, which is the strongest contract the current CLI offers. |
| P4 (nit) | The task's line table in Design names the pre-fix coordinates (39/40 … 252/253); after the re-indent the same actions begin two lines later in each block. | Accepted: the table documents the pre-fix state the change was applied to, and stays accurate as a "lines before" map. No further edit. |

SECUA pass: Security — no command text, interpolation, or secret touched. Explicitness — the change makes the previously-implicit `options`/`command` nesting explicit and matches the canonical `kk-itc.yaml` shape. Correctness — 8/8 commands byte-identical by parse; schema valid; 973 repo tests green; the two named assertion files 26 pass / 0 fail. Usability — the file now loads, so the operator-visible failure is gone. Architecture — no schema, API, flag, config, or transition change; no new abstraction. Housekeeping — no suppressions added.

**Residual risk:** low. The change is provably indentation-only (`git diff --ignore-all-space` empty), so no consumer that already loaded the file can behave differently, and consumers that could not load it now can. Not exercised (explicit non-goals): live execution of the `pause: true` states and real TTS generation.

**Disposition:** Approved for `done` against the amended R1; the ADR-115 composition residual is owned by task 0131.

### References

- Feature: F8 "Run-anywhere workflow and script resolution" (reopened scope) — `docs/features/F8_run-anywhere-workflow-and-script-resolution.md`.
- Discovered during: task 0128 verify — `docs/tasks/0128_flatten-single-file-step-outputs-across-itc-solo-podcast-and.md`.
- Pre-exists: commit `fcf4fda` (`docs(sp): reopen F8 for workflow-folder and workspace-default extension`); the file at `fcf4fda` already carries the same 8 broken blocks, and the untouched main working tree reproduces the identical failure.
- Repro command: `spur workflow validate plugins/kk/workflows/kk-solo-podcast.yaml --json` → `valid: false`, 16 errors (8x `options: expected object, got null`; 8x `unknown field "command"`, states 0/2/4/6/8/9/10/11). Post-fix the same command returns `valid: true`, `errors: []`; the residual exit 1 comes only from the ADR-115 composition gate.
- Canonical shell-action shape: `plugins/kk/workflows/kk-itc.yaml:33-45`.
- Broken file: `plugins/kk/workflows/kk-solo-podcast.yaml` (8 blocks — line table in Design).
- Assertion surfaces (unchanged): `apps/cli/tests/kk-solo-podcast-workflow.test.ts`, `apps/cli/tests/workflow-run-command.test.ts`.
- DD-09 altitude mechanism: `spur task update --ac-altitude` (task scenarios intentionally not feature ship criteria → `task-local`).
- ADR-115 composition gate (the R1 residual): the `validate` command in spur-new `apps/cli/src/commands/workflow.ts` lines 452-456 — error-level composition findings fail `validate` only; "Run/dry-run/continue never see composition findings at all."
- ADR-115 composition debt follow-up: task 0131 — `docs/tasks/0131_reduce-adr-115-composition-findings-in-kk-solo-podcast-yaml-.md`.

### History

- 2026-09-14T22:20:11.525Z todo → wip (system)
- 2026-09-14T22:20:12.084Z wip → testing (system)
- 2026-09-14T22:21:52.100Z testing → done (system)

