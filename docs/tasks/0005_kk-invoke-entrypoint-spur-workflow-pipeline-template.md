---
template: feature-impl
schema_version: 1
name: "kk invoke entrypoint + spur workflow pipeline template"
description: ""
status: todo
type: task
profile: standard
feature_id: B3
parent_wbs: null
priority: P2
tags: ["kk", "platform", "invoke", "workflow"]
dependencies: ["0003", "0004"]
created_at: "2026-07-24T17:36:27.415Z"
updated_at: "2026-07-24T22:05:36.865Z"
---

## 0005. kk invoke entrypoint + spur workflow pipeline template

### Background
Integration layer for feature B: the uniform entrypoint spur steps call, plus the pipeline template. Depends on B1 / task `0004` (resolve plugin) and B2 / task `0003` (validate IO); build THIRD (last). `invoke` is a subcommand of the knowledge-kit binary per ADR-002; a single-plugin invoker, NOT a DAG runtime (ADR-006 YAGNI). R4 encodes the Surfdash publish anti-pattern (shell wrappers that always exit 0) to avoid — fail loud instead. Covers B3 scenarios R1-R4. Rubric: E2 D1 L2 C1 R1 = 7 -> task.
### Requirements
- [ ] R1. `knowledge-kit invoke <plugin> --in <input> --out <output>` resolves the manifest entry, runs it, and writes the output file.
- [ ] R2. Validate input/output against the kind's contract (B2); on an input-schema violation, fail before running the entry and name the violation.
- [ ] R3. Provide a spur workflow template chaining one ingestion → generator → publish plugin, each step invoking via `knowledge-kit invoke`, each step's output file feeding the next step's input.
- [ ] R4. Fail loud: when a plugin entry exits non-zero, invoke exits non-zero and surfaces the entry's error (no swallowed errors).
### Acceptance Criteria
```gherkin
Feature: Spur workflow integration

  @core
  Scenario: R1 — kk invoke runs a discovered plugin with file IO
    Given a discovered plugin and an input file
    When "kk invoke <plugin> --in <input> --out <output>" runs
    Then the plugin's declared entry is executed
    And the output file is written

  @core
  Scenario: R2 — kk invoke validates IO against the kind's contract
    Given a discovered plugin of a given kind
    When kk invoke runs with an input file that violates the kind's input schema
    Then invocation fails before the entry runs
    And the error names the schema violation

  @core
  Scenario: R3 — A spur workflow chains ingestion, generator, and publish
    Given a spur workflow template referencing one plugin of each kind
    When the workflow runs
    Then each step invokes its plugin via kk invoke
    And each step's output file feeds the next step's input

  @core
  Scenario: R4 — kk invoke fails loud when a plugin entry errors
    Given a discovered plugin whose entry exits non-zero
    When kk invoke runs it
    Then kk invoke exits non-zero and surfaces the entry's error
```
### Q&A
**Mode:** `--auto` (no interactive Q&A). Synthesized from task Background/Requirements, feature B3 AC, ADR-002/006, refined `0003`/`0004` designs, and Surfdash audit fail-loud lesson.

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Dependencies | `0003`, `0004` | Resolve + validate IO; build order third |
| Binary / argv | `knowledge-kit invoke` (docs may say `kk invoke`) | ADR-002 bin; no second binary |
| Entry execution | Subprocess path relative to plugin dir + `--in`/`--out` | Testable; skill-first via script wrapper |
| Ingestion `--in` | Opaque source path (no Doc schema) | Matches B2 `input: null` |
| Output validation | Always after successful spawn | Catch bad plugins before next workflow step |
| Fail loud | Propagate non-zero; never swallow | R4; avoid Surfdash always-exit-0 pattern |
| Workflow | Linear state-machine template under `.spur/workflows/` | Orchestration in spur, not kk runtime |
| AC source | Feature B3 scenarios R1–R4, stable titles | Traceability; do not rename |
| Soft ref | Surfdash audit anti-pattern in prose only (not a hard dep) | Research already done; not a build blocker |
### Design
**Approach.** Add Commander subcommand `invoke` on the existing `@gobing-ai/knowledge-kit` binary (`apps/cli`, ADR-002), wired to B1 discovery + B2 kind contracts. Product shorthand in docs/AC is `kk invoke`; the real argv is `knowledge-kit invoke` (bin name unchanged — no second binary). Ship a spur workflow **template** that chains three shell steps (ingest → generate → publish), each calling invoke with file IO. Single-plugin invoker only — not a DAG runtime (ADR-006 YAGNI).

**CLI surface**

```text
knowledge-kit invoke <plugin> --in <path> --out <path> [--plugins-root <dir>]
```

| Flag / arg | Role |
|------------|------|
| `<plugin>` | Manifest `name` resolved via `discoverPlugins` → `getByName` (B1 / `0004`) |
| `--in` | Input path. For kinds with an input schema (generator/publish): JSON file validated **before** spawn. For ingestion (`input: null` per B2): opaque **source** path passed through to the entry (not Doc-schema validated). |
| `--out` | Output path. After a successful entry run, read and validate against the kind's **output** schema; fail if missing/invalid. |
| `--plugins-root` | Optional discovery root (default `./plugins` relative to cwd). |

Exit codes: `0` success; non-zero on unknown plugin, schema violation, entry spawn failure, entry non-zero exit, or invalid/missing output. **Never** map entry failure to `0` (R4 / Surfdash audit lesson).

**Invoke pipeline (ordered)**

1. Discover plugins under `--plugins-root`; resolve `<plugin>` by name. Missing → error + non-zero (mention discovery diagnostics if useful).
2. Load kind contract via `kindContract(record.kind)` (B2 / `0003`).
3. **Input gate:** if contract.input is non-null, read `--in` as JSON and `safeParse`; on failure → `logger.error` with field path + message, exit non-zero, **do not spawn**. If input is null (ingestion), require `--in` exists as a path string only (source dir/file for the entry).
4. **Spawn entry:** resolve `entry` relative to the plugin directory when not absolute. Pass `--in` and `--out` as argv to the child (same flag names for entry authors). Use a spawn that captures stdout/stderr and exit code (Bun `spawn` / `spawnSync`). Working directory = plugin dir.
5. If entry exit code ≠ 0 → forward stderr/stdout to logger, exit with the same code (or `1` if `0` would result — never coerce to success).
6. **Output gate:** read `--out` as JSON; validate against contract.output; on failure → error naming the field, non-zero. (Entry must write the file; invoke does not invent output.)

**Entry contract (v1 for plugin authors)**

- `plugin.json.entry` is an **executable path** relative to the plugin directory (e.g. `scripts/run.ts`, `bin/invoke.sh`), run with Bun/shell as appropriate for the file type.
- Child argv: `<entry> --in <abs-in> --out <abs-out>`.
- Child must write `--out` as JSON matching the kind's output schema (`Doc[]` | `Content` | `Result`).
- Skill-name-only entries (no path) are **out of scope for v1** — document as future; tests use real scripts. (Skill-first product model still holds: a skill can ship a thin `scripts/run.ts` entry.)

**Spur workflow template**

- Path: `.spur/workflows/kk-ingest-generate-publish.yaml` (name may adjust; one template file).
- Kind: `state-machine` (match existing `.spur/workflows/*` schema).
- Vars (example): `ingestion_plugin`, `generator_plugin`, `publish_plugin`, `source`, `work_dir`, `plugins_root`.
- States (linear): `ingest` → `generate` → `publish` → `done` (+ `failed`).
- Each work state `onEnter` shell action:

```text
knowledge-kit invoke ${ingestion_plugin} --in ${source} --out ${work_dir}/docs.json --plugins-root ${plugins_root}
knowledge-kit invoke ${generator_plugin} --in ${work_dir}/docs.json --out ${work_dir}/content.json --plugins-root ${plugins_root}
knowledge-kit invoke ${publish_plugin} --in ${work_dir}/content.json --out ${work_dir}/result.json --plugins-root ${plugins_root}
```

- Guards: `action-ok` between steps (same pattern as `basic.yaml`). No nested DAG engine inside knowledge-kit.
- Template is validated with `spur workflow validate`; dry-run optional. Full E2E with real C/D/E plugins is later vertical work (feature F) — this task ships the **template + invoke** with unit/fixture plugins.

**Code layout**

| Area | Location |
|------|----------|
| Commander registration | `apps/cli/src/cli.ts` (`invoke` command) |
| Invoke orchestration (testable) | `apps/cli/src/invoke.ts` (or `apps/cli/src/commands/invoke.ts`) — pure-ish functions: resolve, validateIn, spawnEntry, validateOut |
| Deps | `@gobing-ai/kk-core` (workspace), existing `@gobing-ai/utils` logger |
| Workflow template | `.spur/workflows/kk-ingest-generate-publish.yaml` |
| Tests | `apps/cli/tests/invoke.test.ts` — temp plugin trees + stub entries (success, schema fail, non-zero entry) |
| Design surface sync | Update `docs/04_DESIGN.md` in the **same commit** as the new command (constitution T3) |

**Invariants**

1. Orchestration stays in spur workflow — invoke never chains kinds itself.
2. Fail loud: schema, resolve, and entry errors all non-zero; no silent swallow.
3. Input validation happens **before** spawn; output validation **after** successful spawn.
4. Factory `createProgram()` stays side-effect-free at construction (ADR-002).
5. Cross-package imports only via `@gobing-ai/*`.

**Tradeoffs**

- **Entry = executable path (v1)** vs skill-runtime integration: path spawn is unit-testable without embedding a skill host. Skills wrap a script entry. Rejected for v1: in-process dynamic import of TS classes (contradicts data-contract model).
- **`--in` dual meaning for ingestion** (source path) vs separate `--source`: keep one flag for spur-template uniformity; document kind-specific semantics in help text.
- **Validate output after every run** vs trust the entry: always validate — catches bad plugins early for workflow steps.
- **Template placeholders for plugin names** vs hard-coded fixtures: vars keep the template reusable for feature F without rewriting YAML.

**Out of scope**

- Implementing real ingestion/generator/publish plugins (C/D/E)
- `kk run` multi-plugin DAG, scheduling, parallel steps
- Remote discovery, skill-host execution of bare skill IDs
- Changing the binary name to `kk` (docs may say `kk invoke`; bin remains `knowledge-kit`)

**Depends on**

- `0003` — Doc/Content/Result schemas + `kindContract`
- `0004` — `discoverPlugins` / `getByName` / manifest `entry`
### Plan
- [ ] Land or confirm `0003` + `0004` APIs (`kindContract`, `discoverPlugins` / `getByName`, `PluginRecord.entry`)
- [ ] Add `@gobing-ai/kk-core` workspace dependency on `apps/cli`
- [ ] Implement testable invoke orchestration module (resolve → validate in → spawn → validate out → exit codes)
- [ ] Register `invoke` subcommand on `createProgram()` with `--in`, `--out`, optional `--plugins-root`
- [ ] Unit tests with temp plugin fixtures: happy path writes valid out; bad input fails before spawn; entry non-zero fails loud with message; unknown plugin fails
- [ ] Author `.spur/workflows/kk-ingest-generate-publish.yaml` chaining three invoke steps; `spur workflow validate` clean
- [ ] Update `docs/04_DESIGN.md` (command surface) in the same commit as the CLI change (T3)
- [ ] Run `bun run lint` and `bun run test`
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

B3

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
