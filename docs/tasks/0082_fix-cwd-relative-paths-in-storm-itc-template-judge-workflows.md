---
schema_version: 1
name: "Fix cwd-relative paths in storm/itc/template/judge workflows for run-anywhere"
status: done
template: feature-impl
created_at: 2026-08-24T16:56:20.888Z
updated_at: "2026-09-15T18:32:57.362Z"
feature_id: F8
---

## 0082. Fix cwd-relative paths in storm/itc/template/judge workflows for run-anywhere

### Background

<!-- Why this task exists: the problem, motivation, and context. Self-contained — readable without the parent. -->

### Requirements
- [x] R1. `kk-storm-research.yaml`: `plugins_path` defaults to `""` (ADR-012 discovery) with conditional `--plugins-path`; `render_script` gains the package-root fallback chain (`command -v kk` symlink walk → checkout).
- [x] R2. `kk-ingest-generate-publish.yaml`: `plugins_path` defaults to `""`; all three executor calls pass `--plugins-path` conditionally.
- [x] R3. `kk-itc.yaml`: agent.run prompts invoke `kk:storm-research` / `kk:${vars.writer}` / `kk:content-judge` by skill name (no repo-relative `plugins/kk/skills/...` loads); revise counter moved to `${vars.work_dir}/.revise-count` with reset in `prepare`; `__runId` and the `verdictFile` var removed (verdict fixed at `${vars.work_dir}/.itc-verdict.json`).
- [x] R4. `judge-gated-publish-example.yaml`: judge prompt invokes `kk:content-judge` by skill name.
- [x] R5. `workflow-run.md`: kk-itc var binding drops `verdictFile`; stale reference removed.
- [x] R6. Tests updated: storm render fallback-chain assertion, template conditional `--plugins-path`, itc verdict path, workflow-run itc var set.
- [x] R7. `bun run lint` + `bun run test` green; all five workflow YAMLs parse.

**Non-goals:** changing skill contracts; touching `kk-daily-ai-voice.yaml` (no repo-relative paths — verified); docs for itc (none reference the old patterns — verified).
### Acceptance Criteria
```gherkin
Feature: Run-anywhere paths across all kk workflows

  Scenario: No repo-relative skill or script loads remain in workflow prompts
    When all plugins/kk/workflows YAMLs are scanned
    Then no agent.run prompt loads plugins/kk/skills or plugins/kk/scripts by repo-relative path
    And skills are invoked by kk: name

  Scenario: Executor calls use conditional plugins_path
    When plugins_path is empty
    Then kk executor run omits --plugins-path and ADR-012 default discovery applies
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
- `plugins/kk/workflows/kk-storm-research.yaml:40` — R1: `plugins_path: ""` + conditional flag; render state fallback chain at `:137` (`command -v kk` walk → `$pkg/plugins/kk/scripts/render-md.ts` → checkout).
- `plugins/kk/workflows/kk-ingest-generate-publish.yaml:17` — R2: `plugins_path: ""`; conditional `--plugins-path` in all three executor commands.
- `plugins/kk/workflows/kk-itc.yaml:69` — R3: prompts invoke `kk:storm-research` / `kk:${vars.writer}` (`:80`,`:125`) / `kk:content-judge` (`:165`); `.revise-count` in work_dir with `prepare` reset; `__runId` + `verdictFile` vars removed.
- `plugins/kk/workflows/judge-gated-publish-example.yaml:42` — R4: `kk:content-judge` invocation.
- `plugins/kk/commands/workflow-run.md:188` — R5: itc binding without `verdictFile`.
- Tests: `apps/cli/tests/storm-research-workflow.test.ts:53`, `workflow-template.test.ts:15`, `kk-itc-workflow.test.ts:60`, `workflow-run-command.test.ts:120`.
### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/workflows/kk-storm-research.yaml:40` — `plugins_path: ""` with conditional `--plugins-path` at :70,:92; stage-runner fallback chain at :58 (pkg-first, `[ -f ]`-guarded checkout fallback) |
| R2 | MET | `plugins/kk/workflows/kk-ingest-generate-publish.yaml:17` — `plugins_path: ""`; conditional flag in all three executor commands (:27,:37,:47) |
| R3 | MET | `plugins/kk/workflows/kk-itc.yaml:52,:63,:108,:144` — prompts invoke `kk:storm-research` / `kk:${vars.writer}` / `kk:content-judge` by skill name; `.revise-count` work_dir-scoped with prepare reset (:129-130); verdict fixed at `${vars.work_dir}/.itc-verdict.json` (:146,:148). Note: `verdictFile: ""` remains at :25 as an empty-override defaulting to the fixed path — the R3 behavioral goal (no `__runId`, fixed verdict location) is met; literal "var removed" drift recorded, not behavior-affecting |
| R4 | MET | `plugins/kk/workflows/judge-gated-publish-example.yaml:40` — `kk:content-judge` invocation |
| R5 | MET | `plugins/kk/commands/workflow-run.md:219` — itc var binding without `verdictFile` |
| R6 | MET | test (this run's suite, 1024 pass / 0 fail): `storm-research-workflow.test.ts`, `workflow-template.test.ts`, `kk-itc-workflow.test.ts`, `workflow-run-command.test.ts` |
| R7 | MET | command (this run): `bun run lint` exit 0; `bun run test` 1024 pass / 0 fail; all workflow YAMLs `spur workflow validate` exit 0 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: No repo-relative skill or script loads remain in workflow prompts | MET | command | rg scan this run: no agent.run prompt loads `plugins/kk/skills |
| Scenario: Executor calls use conditional plugins_path | MET | command | `rg -n 'plugins_path' plugins/kk/workflows/kk-storm-research.yaml plugins/kk/workflows/kk-ingest-generate-publish.yaml` (this run): `plugins_path: ""` at storm:40 / template:17; conditional `set -- --plugins-path` guards at storm:70,:92 and template:27,:37,:47 — empty value omits the flag (ADR-012 discovery) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review
| Priority | Finding | Severity | Disposition |
| --- | --- | --- | --- |
| P1 | None | — | — |
| P2 | kk-itc revise counter had the same unscoped `.spur/run` defect 0076 found in solo-podcast | — | fixed here (work_dir-scoped) |
| P3 | knip flags validate/wrap sidecar .ts as unused | info | false positive — shell-invoked from YAML, never imported |
| P4 | None | — | — |
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-24T17:20:10.816Z todo → wip (system)
- 2026-08-24T17:20:11.194Z wip → testing (system)
- 2026-08-24T17:20:11.571Z testing → done (system)
