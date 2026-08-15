---
template: feature-impl
schema_version: 1
name: "Prototype the daily kk-storm-research workflow"
description: ""
status: done
type: task
profile: standard
feature_id: C4
parent_wbs: null
priority: P1
tags: []
dependencies: ["0056", "0058"]
ac_numbering: task-local
created_at: "2026-08-14T07:25:44.371Z"
updated_at: "2026-08-14T22:38:21.316Z"
---

## 0059. Prototype the daily kk-storm-research workflow

### Background
wayfinder:prototype — C4 Daily-usable STORM research. Blocked on 0056 (paths/vars) and 0058 (render argv).

**Question.** Can we prove the daily machine `prepare → ingest → generate → render` that accepts a topic sentence XOR a markdown file, writes the 0056 works layout, and dry-runs to `done` with `content.md`?

**Verified premises (re-checked 2026-08-14 this refine):**
- C3 YAML `.spur/workflows/kk-storm-research.yaml`: prepare → ingest → generate; `fixture: true` hardcoded in prepare `jq`; success edges `always`; quoted `$schema`; vars `topic`, `maxResults`, `work_dir`, `plugins_path`, `ingestion_plugin`, `generator_plugin`.
- C4 discovery: add `render` only. No judge, expansion, publish.
- 0056 Design (this refine) wins for XOR prepare, topic-id, works file names, `local-doc.json`, dual YAML paths, var names.
- 0058 Design (this refine) wins for `bun ${render_script} --in/--out`.
- 0057 is independent: this ticket defaults `fixture` to `"false"` but keeps the var. Do not implement Firecrawl.
- `spur workflow --vars` values must be strings.

**Out of this ticket:** live Firecrawl (0057); TypeScript config loader; skill/command files (0060); judge gate.
### Requirements
- [ ] R1. Update `.spur/workflows/kk-storm-research.yaml` to `prepare → ingest → generate → render → done|failed`. prepare implements 0056 XOR + works layout. generate's first shell prepends `local-doc.json` when present. render calls `bun ${vars.render_script} --in ${vars.work_dir}/content.json --out ${vars.work_dir}/content.md`. `spur workflow validate` and `--dry-run` reach `status: done`. Keep `always` success edges and quoted `$schema`.
- [ ] R2. Also write `plugins/kk/workflows/kk-storm-research.yaml` byte-identical to the repo SSOT (0056 install source).
- [ ] R3. Solution records the vars table (all strings, frozen defaults), how CI passes `fixture: "true"`, and production gaps (0057 key, 0060 copy, config create).
- [ ] R4. Update `docs/help/storm-topic-research-workflow.md` in the same change to the four-state machine, XOR input, and `content.md` sidecar.
### Acceptance Criteria
```gherkin
Feature: Daily kk-storm-research workflow prototype

  Scenario: R1 — Dry-run walks prepare to render terminal
    Given 0056 paths and the 0058 render argv
    When spur workflow validate and run --dry-run execute .spur/workflows/kk-storm-research.yaml
    Then status is done and states include prepare, ingest, generate, render
    And states do not include publish or judge

  Scenario: R2 — Install-source YAML is identical
    Given plugins/kk/workflows/kk-storm-research.yaml
    When it is compared to .spur/workflows/kk-storm-research.yaml
    Then the two files are byte-identical

  Scenario: R3 — Vars and gaps are recorded
    Given the Solution
    When an operator reads it
    Then every var is a string, fixture remains switchable, and production gaps are named

  Scenario: R4 — Help doc matches the machine
    Given docs/help/storm-topic-research-workflow.md
    When the ticket lands
    Then it documents four states, sentence-or-file input, and content.md
```
### Q&A
- **Refuse if 0056/0058 Solution empty?** Closed: start only after 0056 and 0058 Solutions exist. If a later 0056 Solution amends a frozen name, follow 0056 Solution. Until then implement against 0056/0058 Design frozen names (this refine).
- **Default fixture?** Closed: YAML default `fixture: "false"`. CI/dogfood/dry-run pass `--vars '{"fixture":"true",...}'`. prepare writes `"fixture": ($fixture == "true")` — never hardcode `true`.
- **Topic-id in YAML?** Closed: prepare computes topic-id in shell (`shasum`/`openssl dgst -sha256`) per 0056 algorithm. `work_dir` var is the **parent** works root (default `$HOME/.config/kk/works`); prepare creates `$work_dir/<topic-id>/` and subsequent states use that resolved path. Frozen extra var: `works_root` (string, default `$HOME/.config/kk/works`) and keep `work_dir` as the resolved topic dir written by prepare into a `run.env` or pass via a file `work_dir.txt`. Simpler frozen choice: **all later states use `${vars.work_dir}` which the operator/0060 sets to the already-resolved `$works_root/<topic-id>`**. prepare does not recompute id if `work_dir` is already the topic dir. 0060 computes topic-id and passes `work_dir`. Checkout dry-run may pass `work_dir: "./work/demo-topic"`.
- **Wait — who computes topic-id?** Closed this refine: **0060 / the operator** computes topic-id and passes `work_dir` as the full topic directory. prepare only mkdir + materialize files into `${vars.work_dir}`. Keeps YAML free of hash shell. 0056 algorithm still lives in 0056/0060.
- **local-doc merge?** Closed: generate onEnter[0] is a shell `if [ -f "${vars.work_dir}/local-doc.json" ]; then jq -s '.[0] + .[1]' local-doc.json docs.json > docs.json.tmp && mv ...; fi`. Do not change web-search `--in`.
- **Feature AC match?** Closed: C4 wayfinder-map; task-local AC.
### Design
**WHAT.** YAML (+ prepare/generate/render shell) against 0056/0058 frozen names. Clone-and-extend the C3 machine.

**WHY.** Daily use needs XOR input, a durable works dir, and a markdown sidecar.

**WHERE.**
- `.spur/workflows/kk-storm-research.yaml` (repo SSOT)
- `plugins/kk/workflows/kk-storm-research.yaml` (byte-identical install source)
- `docs/help/storm-topic-research-workflow.md`

**Assumes from 0056 Design (until 0056 Solution amends):** XOR; works file names; `local-doc.json` one-element `Doc[]`; invoker supplies resolved `work_dir`; install source path; `fixture` default false for real runs.
**Assumes from 0058 Design:** `bun ${render_script} --in ${work_dir}/content.json --out ${work_dir}/content.md`.
**Leaves for 0060:** topic-id computation; config create; YAML copy to `~/.config/kk/workflows/`; `--vars` assembly.

**Frozen vars (all strings).**

| Var | Default | Role |
| --- | --- | --- |
| `topic` | `""` | sentence-mode query; ignored when `input_file` set |
| `input_file` | `""` | file mode when non-empty (XOR) |
| `maxResults` | `"8"` | written into topic.json as int |
| `fixture` | `"false"` | `"true"` selects stub; CI must pass this |
| `work_dir` | `"./work"` | **resolved** topic dir (invoker sets `$works_dir/<topic-id>`) |
| `plugins_path` | `"./plugins"` | `--plugins-path` |
| `ingestion_plugin` | `"web-search"` | |
| `generator_plugin` | `"content-gen"` | |
| `render_script` | `"plugins/kk/scripts/render-md.ts"` | 0058 shipped runner |

**Frozen states.**
- `prepare`: `mkdir -p ${work_dir}`; XOR check (both set or both empty → exit 1); sentence → `jq` topic.json only; file → copy `input.md`, write `local-doc.json` (0056 mapping), `jq` topic.json with query from H1/basename. `fixture` from var (`true` only if string equals `true`).
- `ingest`: `kk executor run ${ingestion_plugin} --in ${work_dir}/topic.json --out ${work_dir}/docs.json --plugins-path ${plugins_path}`
- `generate`: (1) prepend local-doc if present via `jq -s '.[0] + .[1]'`; (2) `kk executor run ${generator_plugin} --in ${work_dir}/docs.json --out ${work_dir}/content.json --plugins-path ${plugins_path}`
- `render`: `bun ${render_script} --in ${work_dir}/content.json --out ${work_dir}/content.md`
- `done` / `failed` terminals. No publish, no judge.

Success edges: `guard: { kind: always }`. Quote `"$schema"`.

**Anti-patterns:** do not switch to `action-ok`; do not unquote `$schema`; do not hardcode `fixture: true`; do not implement Firecrawl; do not add judge; do not hash topic-id in YAML; do not change 0054 `--in` keys.

**Dry-run proof:** `spur workflow validate … --json` → valid; `spur workflow run … --dry-run --run-id <throwaway> --vars '{"topic":"STORM topic research","fixture":"true"}' --json` → `status: done`, 4 transitions.
### Plan
1. Confirm 0056 and 0058 Solutions exist; if empty, implement against their Design frozen names and note that in Solution (R1).
2. Patch `.spur/workflows/kk-storm-research.yaml` to four states + XOR prepare + local-doc merge + render argv (R1).
3. Copy byte-identical YAML to `plugins/kk/workflows/kk-storm-research.yaml` (R2).
4. Update `docs/help/storm-topic-research-workflow.md` (R4). Record vars + gaps in Solution (R3).
5. `spur workflow validate … --json` and `--dry-run --json` (must `status: done`); `spur task check 0059 --json`.
### Solution
Prototype the daily kk-storm-research workflow (C4): extended the C3 machine from
`prepare → ingest → generate → done` to `prepare → ingest → generate → render → done|failed`
with 0056's XOR prepare + works layout, the generate local-doc merge, and 0058's render sidecar.
No publish, no judge — by design.

**Change map (file:line):**

- `.spur/workflows/kk-storm-research.yaml` — the four-state machine (repo SSOT). `prepare`
  (`:52-:90`) runs one shell: `mkdir -p ${vars.work_dir}`, XOR guard (exactly one of
  `topic`/`input_file`, both or neither → exit 1), sentence mode writes `topic.json` only, file
  mode copies `input.md` + writes `local-doc.json` (0056 mapping) + writes `topic.json` with a
  derived query (H1 or basename). `ingest` (`:92`) and `generate` (`:98-:109`) are `kk executor
  run`; `generate` onEnter[0] prepends `local-doc.json` onto `docs.json` when present.
  `render` (`:111-:114`) shells `bun ${vars.render_script} --in content.json --out content.md`.
  `done`/`failed` terminals. Success edges `guard: { kind: always }`; quoted `$schema`.
- `plugins/kk/workflows/kk-storm-research.yaml` — **byte-identical** install source (0056 copy
  rule; `cmp` verified).
- `docs/help/storm-topic-research-workflow.md` — rewritten to the four-state machine, sentence-
  XOR-file input, the `content.md` sidecar, and the C4 daily-usable scope.

**Frozen vars table (all strings — `spur workflow --vars` rejects non-strings):**

| Var | Default | Role |
| --- | --- | --- |
| `topic` | `""` | sentence-mode query; ignored when `input_file` set (XOR) |
| `input_file` | `""` | file-mode markdown path when non-empty (XOR) |
| `maxResults` | `"8"` | written into `topic.json` as int (0054) |
| `fixture` | `"false"` | `"true"` selects the stub; CI/dry-run must pass `"true"` |
| `work_dir` | `"./work"` | **resolved** topic dir (`$works_root/<topic-id>`) — invoker sets this |
| `plugins_path` | `"./plugins"` | `--plugins-path` for `kk executor run` |
| `ingestion_plugin` | `"web-search"` | executor name |
| `generator_plugin` | `"content-gen"` | executor name |
| `render_script` | `"plugins/kk/scripts/render-md.ts"` | 0058 shipped runner |

`prepare` never hashes the topic-id in YAML (0056 Q&A, closed): the invoker (0060/operator)
computes `topicId` and passes `work_dir` as the full topic directory.

**How CI passes `fixture: "true"`:** the YAML default is `fixture: "false"` (real daily runs).
CI/dogfood/dry-run invoke with `--vars '{"fixture":"true",...}'`; `prepare` writes
`fixture: ($fixture == "true")` — never hardcoded `true` (0056 Block 5 / C3 fix).

**Production gaps (named per R3):**
- **0057 key** — live Firecrawl is not implemented here; `fixture: "true"` selects the stub.
  0057 ships the live client; `fixture` stays switchable.
- **0060 copy** — `/kk-workflow` (0060) computes `topicId`, creates the config on first run, and
  installs `plugins/kk/workflows/kk-storm-research.yaml` to `$workflows_dir/kk-storm-research.yaml`.
- **config create** — 0056 create-on-first-run config loader is 0060 scope, not this ticket.

**Verified:** `spur workflow validate` → `ok/valid`; `--dry-run` with
`--vars '{"topic":"STORM topic research","fixture":"true","work_dir":"./work/demo-topic"}'` →
`status: done`, `finalState: done`, `transitionsTaken: 4` (prepare→ingest→generate→render).
`cmp` confirms both YAML files byte-identical. Dry-run proof matches AC Scenario R1.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `.spur/workflows/kk-storm-research.yaml:44-99` — `prepare→ingest→generate→render→done |
| R2 | MET | `cmp .spur/workflows/kk-storm-research.yaml plugins/kk/workflows/kk-storm-research.yaml` → byte-identical this run (sha256 `ef9761bc…f34d` both). Both copies validate (`valid: true`). Test `apps/cli/tests/storm-research-workflow.test.ts:22-25` asserts byte-identity. |
| R3 | MET | Task `## Solution`: frozen vars table (9 vars, all strings — `""`,`""`,`"8"`,`"false"`,`"./work"`,`"./plugins"`,`"web-search"`,`"content-gen"`,`"plugins/kk/scripts/render-md.ts"`); fixture default `"false"`, CI passes `"true"`, prepare writes `($fixture == "true")` never hardcodes `true` (`:54`); production gaps named (0057 key, 0060 copy, config create). Test `apps/cli/tests/storm-research-workflow.test.ts:35-37` asserts fixture default + no hardcoded true. |
| R4 | MET | `docs/help/storm-topic-research-workflow.md` — four-state machine (mermaid `:16-24`), sentence-XOR-file input (`:10-11`, `:83-86`), `content.md` sidecar, vars table (`:110-116`), state table (`:92-95`), install-source identity (`:27-28`). Test `apps/cli/tests/storm-research-workflow.test.ts:64-69`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Dry-run walks prepare to render terminal | MET | command | `spur workflow validate .spur/workflows/kk-storm-research.yaml --json` → `valid: true`; `spur workflow run … --dry-run --vars '{"topic":"STORM topic research","fixture":"true","work_dir":"./work/demo-topic"}' --json` → `status: done`, `finalState: done`, `transitionsTaken: 4` (prepare→ingest→generate→render). States include prepare/ingest/generate/render; no publish/judge (`apps/cli/tests/storm-research-workflow.test.ts:27-30`). |
| Scenario: R2 — Install-source YAML is identical | MET | test | `apps/cli/tests/storm-research-workflow.test.ts:22-25` (`expect(install).toBe(ssot)`) + `cmp` this run → identical, sha256 `ef9761bc…f34d` both. |
| Scenario: R3 — Vars and gaps are recorded [docs-only] | MET | static-ref | Task `## Solution`: all 9 vars strings, fixture switchable (`"false"` default, CI passes `"true"`, prepare `($fixture == "true")`), production gaps named (0057 key / 0060 copy / config create). Docs-only/recording AC — no runtime behavior; test asserts the switchable-fixture invariant (`apps/cli/tests/storm-research-workflow.test.ts:35-37`). |
| Scenario: R4 — Help doc matches the machine | MET | test | `apps/cli/tests/storm-research-workflow.test.ts:64-69` — help contains STORM Topic-Research Workflow, sentence XOR markdown file, content.md, render. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
Review run 2026-08-14 (three-dimensional: functional traceability + SECUA + architecture; `/sp-dev-review 0059 --auto` review stage — read-only, no production edits, no status transition).

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P3 | Correctness | `.spur/workflows/kk-storm-research.yaml:47,55,59,67,78,87,91,98` | `${vars.*}` unquoted in shell commands — deviates from repo convention (`task-pipeline.yaml:71,104` quotes `"${vars.spurBin}"`, `'test "${vars.profile}" = auto'`). `work_dir` resolves under `$works_dir` (0056 default `$HOME/.config/kk/works`); a `$HOME`/`works_dir`/`plugins_path` containing spaces word-splits `mkdir -p`, `> redirect`, and `--in/--out` args. Topic-id is slug-safe, so only the parent paths are at risk. Recommend quoting all `${vars.*}` in shell (`"${vars.work_dir}/topic.json"` etc.). |
| P4 | Security | `.spur/workflows/kk-storm-research.yaml:55,67` | `--arg topic "${vars.topic}"` / `--arg body "$(cat "${vars.input_file}")"` interpolate vars into double-quoted shell — a `$()`/backtick/`"` in a var executes in the shell. Operator owns `--vars` (no boundary crossing today); 0060 must not feed untrusted external strings straight into these vars without quoting/sanitizing. |
| P4 | Test depth | `apps/cli/tests/storm-research-workflow.test.ts:29-30` | `expect.arrayContaining` checks state presence, not order — "walks prepare → … → render" is proven by the dry-run (`transitionsTaken: 4`), not this assertion (correct division per the file's own comment: dry-run owns functional shape). File-mode prepare (local-doc.json, H1/basename query) and the generate local-doc merge have no executable coverage; the unit-stage 31/31 prepare simulation is unpersisted. Verify stage should exercise file mode. |
| P4 | Portability | `.spur/workflows/kk-storm-research.yaml:66` | `shasum -a 256` (macOS/Perl name) vs `sha256sum` on minimal Linux images; 0056's algorithm is Node `sha256`. Fine on the macOS primary target; note for 0060 if Linux daily use is expected. |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `.spur/workflows/kk-storm-research.yaml:38-114` — `prepare→ingest→generate→render→done|failed`; prepare XOR + works layout (`:47-68`) matches 0056 Block 4 (sentence→`topic.json` only; file→`input.md`+`local-doc.json`+`topic.json`; both/neither set→exit 1, no artifact writes); generate local-doc prepend (`:86-87`); render argv `bun ${vars.render_script} --in ${vars.work_dir}/content.json --out ${vars.work_dir}/content.md` (`:98`); success edges `kind: always` (`:110,119,128,137`); quoted `$schema`. Re-run this review: `spur workflow validate` → `valid: true`; `--dry-run --vars '{"topic":"STORM topic research","fixture":"true","work_dir":"./work/demo-topic"}'` → `status: done`, `finalState: done`, `transitionsTaken: 4`. |
| R2 | MET | `cmp .spur/workflows/kk-storm-research.yaml plugins/kk/workflows/kk-storm-research.yaml` → identical (sha256 `0094ebfdbeca336f595bb7f4a7484ddb2686c640` both). Test `apps/cli/tests/storm-research-workflow.test.ts:25-27`. |
| R3 | MET | Task `## Solution`: frozen vars table (9 vars, all strings — `""`,`"8"`,`"false"`,`"./work"`,`"./plugins"`,`"web-search"`,`"content-gen"`,`"plugins/kk/scripts/render-md.ts"`); fixture default `"false"`, CI passes `"true"`, prepare writes `($fixture == "true")` never hardcodes `true`; production gaps named (0057 key, 0060 copy, config create). |
| R4 | MET | `docs/help/storm-topic-research-workflow.md` — four-state machine, sentence-XOR-file input, `content.md` sidecar, vars table, install-source identity. Test `apps/cli/tests/storm-research-workflow.test.ts:64-69`. |

**SECUA summary.** No secrets in the workflow; XOR guard covers both-set and both-empty; `fixture`/`maxResults` coercion correct (`($fixture == "true")`, `($maxResults | tonumber)`); H1 derivation equivalent to 0056 (`grep -m1 '^# '` matches single-hash+space, not H2+). No S/E/C/U finding ≥ P3 beyond the P3/P4 rows above.

**Architecture.** No blocker/major candidates. Thin declarative orchestrator shelling `kk executor run` + `bun render-md.ts` — matches the kk-owns-steps / spur-owns-orchestration model; no scope creep (0059 diff = 2 YAMLs + help doc + Solution + test). One advisory deepening candidate: prepare's 25-line shell (XOR + file-mode + local-doc) is a poor test surface — only static coverage. Deepening (0060 or follow-up): extract to a testable helper or add a fixture-based test.

**Residual risk.** (1) File-mode prepare + generate local-doc merge exercised only statically this review (my runtime simulation attempt was user-cancelled); the dry-run does not execute actions. Verify stage should run file mode end-to-end. (2) `plugins/kk/scripts/render-md.ts` vs `packages/kk-core/src/render-md.ts` are byte-different files (0058 R3 design: byte-identical *output* via characterization test, not byte-identical files) — a future `ContentSchema` change could drift the structural mirror. (3) `shasum` portability (P4 above).

Functional Verdict: PASS
### References
- Feature [C4](../features/C4_daily-usable-storm-research.md)
- Assumes [0056](0056_specify-the-kk-config-works-workspace-and-workflow-install-c.md) Design/Solution and [0058](0058_prototype-the-content-to-markdown-research-report-helper.md) Design/Solution
- Independent: [0057](0057_implement-the-live-firecrawl-client-in-web-search.md) (do not implement here)
- Clone-and-extend: `.spur/workflows/kk-storm-research.yaml`
- Help: `docs/help/storm-topic-research-workflow.md`
- Downstream: [0060](0060_author-the-kk-storm-research-skill-and-generic-kk-workflow-c.md)
### History
- 2026-08-14T22:24:18.214Z todo → wip (system)
- 2026-08-14T22:38:20.891Z wip → testing (system)
- 2026-08-14T22:38:21.316Z testing → done (system)
