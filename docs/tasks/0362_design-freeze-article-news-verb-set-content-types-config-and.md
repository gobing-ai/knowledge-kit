---
schema_version: 1
name: "Design freeze: article/news verb set, content_types config, and the simplified workflow node maps"
status: wip
template: feature-impl
created_at: 2026-11-13T17:31:14.228Z
updated_at: "2026-11-13T21:44:28.012Z"
feature_id: G61

ac_altitude: task-local
ac_numbering: task-local
priority: P1
---

## 0362. Design freeze: article/news verb set, content_types config, and the simplified workflow node maps

### Background

Design freeze for Phases 2–4 of feature G61 (ADR-053 decisions 2, 3, 4, 6, 7). Phases 0 and 1 (tasks 0360,
0361) are mechanical; the remaining phases change the CLI surface, the config schema and five workflows, and
will be implemented by several agents. This task produces the single document they all build from, plus the
task files themselves. **It writes no product code and edits no workflow.**

Inputs that are already decided and must not be reopened: ADR-053 in full; no `kk publish|run|itc|daily`
noun; three CLI layers only (`kk <noun> <verb>`); `kk stage`, `kk itc`, `kk daily` survive only as hidden
compatibility routes (ADR-037); authoring stays in skills; Spur Board work is out of scope.

#### Refine correction — 2026-11-13

- Re-audited the frozen design against the current workflow YAMLs. The inventory counted `executor-probe` in both `kk-daily-ai-voice3` and `kk-itc`; the document previously stated 42/14 and omitted those current nodes from the fate rows. The design now records 43/15 and maps both probes to the shared probe node.
- Reconciled R3 with the accepted ADR-053 amendment and task 0363 contract: `channels` is the fourth `content_types.<type>` field and `works_namespace` is intentionally excluded. The prior requirement wording was stale and is corrected here; no run-directory namespace is reintroduced.

### Requirements

- [ ] R1. New file `docs/design/content-pipeline-consolidation.md` with exactly these sections: 1 Verb table, 2 `content_types` config, 3 Launch contract, 4 Bundle and plan contract, 5 Workflow node maps, 6 Stage migration table, 7 Retirement list, 8 Phase 2–4 task list.
- [ ] R2. §1 lists every verb of `kk article` (`new`, `generate`, `publish`, `status`, `publish-plan`, `publish-check`, `publish-send`, `publish-settle`, `publish-report`) and `kk news` (those plus `prepare`, `report`) with: flags and types, exit codes, stdout JSON shape, files read/written, and the existing function it wraps (`path:symbol`). Step verbs take named flags only (`--work-dir`, `--window`, …), never positionals.
- [ ] R3. §2 specifies the `content_types.<type>` block for `~/.config/kk/config.yaml` as a zod-ready schema with `workflow`, `writer_skill`, `publish_preset`, and `channels` fields, the built-in defaults for `news` and `itc`, the resolution order (flag → config → built-in), and the error for an unknown `--type`. It states how `--channels a,b` narrows a plan and where the override is recorded in the plan file. The accepted 2026-11-13 amendment makes `channels` the fourth field; `works_namespace` is deliberately not part of this schema.
- [ ] R4. §3 specifies what `generate` / `publish` do around the one `spur workflow run` they start — lock name, probe, timeout, cancel, reservation release, receipt path and schema — mapped line-by-line from `plugins/kk/scripts/daily-scheduled-run.ts` and `scripts/daily-ai-news.ts` so nothing is lost (each existing behaviour is marked keep / drop with a reason).
- [ ] R5. §4 specifies the one frozen `bundle.json` and one `plan.<window>.json` both content types use, as a field-by-field diff against today's matrix bundle and ITC's `publish-plan.json`, and the work-dir layout `<works>/<workflow-name>/<run>` for `kk-news-generate`, `kk-article-generate` and `kk-publish` (ADR-042), including how publish finds the bundle of a generate run.
- [ ] R6. §5 gives, for `kk-news-generate.yaml`, `kk-article-generate.yaml` (+ author child) and `kk-publish.yaml`, the full node list (id, kind, the `kk` verb or skill it calls, dependsOn, onError) and, for every node of today's `kk-daily-ai-voice3` (43), `kk-daily-publish3` (18), `kk-itc` (15), `kk-itc-author`, `kk-itc-publish-tail`, its fate: kept, or folded into which verb. A node is kept only as an agent call, a human pause, or a retry boundary worth minutes (ADR-053 §7); each kept non-agent node states the minutes it saves.
- [ ] R7. §6 lists every `kk stage run <name>` referenced by the five in-scope workflows with its target verb or "deleted"; §7 lists the files retired in Phase 4 (`scripts/daily-ai-news.ts`, `scripts/publish-article.ts`, retired workflows, stage bodies) and the `.spur/config.yaml` job lines that replace the current three.
- [ ] R8. `docs/04_DESIGN.md` gains a section marked **Planned (G61)** with the §1 verb table and the `content_types` block; nothing existing is removed.
- [ ] R9. §8's tasks are created with `spur task create --feature G61` — one task per independently mergeable change, each ≤ ~1 day, each naming owned files so no two tasks edit the same file concurrently, with dependencies stated — and each is filled to the same standard as 0360/0361 (Background, Requirements, Acceptance Criteria, Q&A, Design, Plan, References). Together their ACs cover feature scenarios 5–7 so `spur feature check G61` shows no DD-09 warning.

### Acceptance Criteria

```gherkin
Scenario: AC1 — The design document is complete and checkable (req: R1, R2, R3, R4, R5, R6, R7)
  Given `docs/design/content-pipeline-consolidation.md`
  When it is read against R1–R7
  Then all eight sections exist, every current node of the five in-scope workflows appears exactly once in §5 with a fate, and every `kk stage run` name found by `rg -o 'kk stage run [a-z0-9-]+' plugins/kk/workflows/kk-daily-ai-voice3.yaml plugins/kk/workflows/kk-daily-publish3.yaml plugins/kk/workflows/kk-itc*.yaml | sort -u` appears in §6
  And every "wraps" reference in §1 resolves to an existing `path:symbol`

Scenario: AC2 — The planned surface is recorded (req: R8)
  Given `docs/04_DESIGN.md`
  When the "Planned (G61)" section is read
  Then it lists the same verbs and flags as §1 and no existing section was changed (`git diff` shows additions only)

Scenario: AC3 — Phase 2–4 tasks are ready for delegation (req: R9)
  Given the tasks created under G61
  When `spur task check <wbs>` runs for each and `spur feature check G61` runs
  Then every check passes, G61 reports no DD-09 warning, and no two tasks list the same owned file without a dependency edge between them
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-13T17:47:40.500Z

- **Why a design task instead of going straight to code?** Phases 2–4 touch the CLI surface, config schema and five workflows from several agents at once; one frozen document is the anti-drift device.
- **May the design change ADR-053?** No. A conflict found while designing is reported to the operator as a proposed ADR amendment; the task stops on that point.
- **Is a `content_types` entry allowed to name an arbitrary workflow?** Yes — that is the extension point for new article types; validation is "the workflow file resolves", nothing more.
- **Does the design cover Spur Board?** Only by fixing one bundle/receipt schema the Board will read. No Board module is designed.
- **Who implements?** Not this task. Its last step is creating the tasks.

### Design

Method (the document is the deliverable):

1. Inventory by command, not from memory: `rg -n '^  - id:' <workflow>` for node lists; `rg -o 'kk [a-z-]+ [a-z-]+[^"]*' <workflow>` for the commands each node runs; `apps/cli/src/commands/` for the functions those commands reach.
2. Group nodes by the retry boundary they share; a group with no agent call, no human pause and under a few minutes of rework becomes one verb.
3. Expected shape (to be confirmed or corrected by the inventory, not assumed): `kk-news-generate` ≈ 15 nodes, `kk-publish` ≈ 8, `kk-article-generate` = short parent + author child.
4. Naming is fixed by ADR-053: workflows `kk-news-generate`, `kk-article-generate`, `kk-publish`; verbs as listed in R2; shared step verbs registered by one function on both nouns.

Constraints the design must respect: `kk` owns steps, the workflow owns sequencing; the engine runs one node at a time and has no `finally`, so cleanup lives in the launching verb; `works_dir` layout per ADR-042; ADR-052's rule that a publish window delivers every planned row; presets may carry `mode: live` (ADR-022 amendment).

### Plan

1. Run the inventories in Design step 1 for the five workflows and both scripts; keep the raw output as appendix tables.
2. Write §1–§7 of `docs/design/content-pipeline-consolidation.md`.
3. Add the "Planned (G61)" section to `docs/04_DESIGN.md`.
4. Write §8, then create and fill the tasks via `spur task create --feature G61` / `spur task update --section … --from-file …`.
5. Run `spur task check` on each new task and `spur feature check G61`; run AC1's `rg` cross-check.
6. Stop and hand the document to the operator for review before any Phase 2 task moves to `todo`.

### Solution

- `docs/design/content-pipeline-consolidation.md` (new): §1 verb table, §2 `content_types`, §3 launch contract with line maps, §4 bundle/plan diff and work dirs, §5 node maps (voice3 43 → 20, publish3 18 + tail 7 → 9, kk-itc 15 + author 16 → 13 states), §6 stage migration (53 names), §7 retirement + scheduler lines, §8 task list, open points.
- `docs/04_DESIGN.md` §1.14 "`article` / `news` — Planned (G61, ADR-053)": 29 added lines, 0 removed.
- Tasks created under G61: 0363, 0364, 0365 (Phase 2); 0366, 0367, 0368 (Phase 3); 0369 (Phase 4), with `dependencies[]` set as a linear chain.
- The accepted ADR-053 amendment adds generation step verbs and the `content_types.<type>.channels` switchboard; the proposed `works_namespace` extension was rejected, and new runs use workflow-named directories.
- Corrections checked against code: ITC default preset is `itc-main`; the `--channels` exclusion reason is `not in --channels list` (`apps/cli/src/publish-matrix.ts:491`); the executor probe is an `agent.run` node, not a `kk` verb.

### Testing

- Design section and inventory check: PASS. Required sections 1–8 are present; all 34 `kk stage run` names extracted from the five in-scope workflow files occur in §6.
- Current YAML inventory: `kk-daily-ai-voice3` 43 nodes, `kk-daily-publish3` 18, `kk-itc` 15, `kk-itc-author` 16, `kk-itc-publish-tail` 7. The design’s fate tables now include the two executor-probe nodes and corrected counts.
- `spur task check 0362 --precheck --json`: PASS.
- `spur task check 0362 --json`: PASS with no findings.
- No product code or workflow YAML changed; repository-wide lint/test/build belong to the batch gate.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent feature: G61, scenarios 5–7 (covered by the tasks this one creates).
- Decision: `docs/00_ADR.md` → ADR-053; also ADR-037, ADR-042, ADR-043, ADR-045, ADR-052.
- Existing designs to reconcile: `docs/design/kk-daily-ai-voice3.md`, `docs/design/kk-itc-refactor.md`, `docs/design/kk-noun-verb-bots.md`, `docs/design/article-publish-fanout-brief.md`.
- Depends on nothing; its Phase 2 tasks depend on 0361.

### History

- 2026-11-13T17:40:54.085Z feature_id Q → G61 (system)
- 2026-11-13T18:01:19.372Z backlog → todo (system)
- 2026-11-13T18:01:19.983Z todo → wip (system)

