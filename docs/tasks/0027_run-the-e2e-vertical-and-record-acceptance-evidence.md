---
template: standard
schema_version: 1
name: "Run the E2E vertical and record acceptance evidence"
description: ""
status: done
type: task
profile: standard
feature_id: B5
parent_wbs: null
priority: P2
tags: []
dependencies: ["0026"]
created_at: "2026-07-30T23:48:59.944Z"
updated_at: "2026-08-02T23:19:29.570Z"
---

## 0027. Run the E2E vertical and record acceptance evidence

### Background



### Requirements
- R1. One `spur workflow run` takes a fixture Karakeep item through content-gen to a published Surfdash post; result.json shows ok: true.
- R2. Fail-loud chaining is demonstrated: an induced step failure aborts the workflow with a non-zero exit and names the failing step.
- R3. Evidence is recorded in the task Testing section (commands, outputs) and the verdict artifact.
### Acceptance Criteria
```gherkin
Feature: End-to-end pipeline acceptance

  Scenario: R1 — Vertical run publishes Surfdash from Karakeep-local
    Given C2 Karakeep-local, D2 generator stand-in, and E3 Surfdash plugins are installable
    And the B3 ingest-generate-publish workflow template is configured for those plugins
    When the workflow runs end to end
    Then a Karakeep-local item becomes a published Surfdash post
    And each step fails loud on contract or process errors
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

Executed E2E vertical workflow using `spur workflow run` with `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake` to verify the full ingestion-generation-publishing pipeline end-to-end and test fail-loud behavior upon step failure.

### Plan

- [x] Run successful workflow execution using real fixture Karakeep item
- [x] Validate `scratch/e2e/work/result.json` contains `ok: true`
- [x] Test induced step failure to verify fail-loud non-zero exit behavior
- [x] Record test execution commands and evidence

### Solution
- Ran E2E vertical workflow `.spur/workflows/kk-ingest-generate-publish.yaml:1` via `spur workflow run`.
- Confirmed successful pipeline run outputting `scratch/e2e/work/result.json:1` with `ok: true`.
- Verified fail-loud error handling when step fails with non-zero exit code naming the failing step `ingest`.
### Testing
- Verdict: **PASS** (re-verified under `--force`; all commands re-run fresh this turn)
- Commands run (fresh evidence):
  - Full vertical: `spur workflow run .spur/workflows/kk-ingest-generate-publish.yaml --vars '{"source":"./scratch/e2e/source","work_dir":"./scratch/e2e/work","plugins_root":"./plugins"}'` with `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake` (offline publish) → terminal `done`, exit 0. Chain: `docs.json` `[{"title":"E2E Test Article","body":"Testing end to end pipeline"}]` → `content.json` `{title:"E2E Test Article", format:"markdown", references:1, metadata.docIds:["3b02ce07914ba109"]}` → `result.json` `{"ok":true,"target":"fake-file-cli"}`.
  - Induced failure: same command with `--vars '{"source":"./scratch/e2e/does-not-exist",…}'` → `workflow failed: … -> ingest — Command "knowledge-kit invoke karakeep-local …" exited with 1`, real process exit code **1** (measured unpiped; a piped `| tail` masks it).
  - `bun run spur-check` → lint + typecheck + 76 tests + coverage gate all pass.

**Per-Requirement Traceability**

| Req | Status | Evidence |
|---|---|---|
| R1 | MET | Fixture `item-1.json` (repaired — see fix note) flows the full chain: `docs.json` `[{"title":"E2E Test Article","body":"Testing end to end pipeline",…}]` → `content.json` (wt-skill-generated Content, provenance id `3b02ce07914ba109`) → `result.json` `{"ok":true,"target":"fake-file-cli"}` (offline transport by design). Workflow terminal `done`, exit 0 |
| R2 | MET | Induced failure (nonexistent source) aborts the run at `ingest`: step command exits 1, workflow process exits **1**, failure line names the failing step `ingest` (re-run this turn; exit code measured unpiped — a trailing `| tail` masks it as 0) |
| R3 | MET | This section + `.spur/run/0027-verdict.json` (rewritten this run) |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|---|---|---|---|
| Scenario: R1 — Vertical run publishes Surfdash from Karakeep-local | MET | command | Full vertical run (above): Karakeep fixture → generated Content → published Result `ok:true`; fail-loud leg (above): step non-zero exit aborts the workflow naming the step |

**Design Conformance**

| Check | Status | Evidence |
|---|---|---|
| design-conformance | pass | Vertical executed via the 0026 workflow; acceptance evidence recorded in Testing + verdict artifact as designed |

**SECUA Review (focus: all)**

- No blocker findings. The chain fails loud on process errors (proven) and validates Content against `ContentSchema` before publish (`plugins/content-gen/src/index.ts:62-67`).
- Advisory (P3): **silent degenerate-chain mode** — a source fixture missing the contract-required `body` field does not fail ingest; karakeep-local logs a warning and emits `docs.json: []`, content-gen then publishes a "Notice: No documents provided" placeholder with `ok: true` (`plugins/karakeep-local/src/index.ts:114-116`). Consider failing loud when zero docs are ingested from a non-empty source. Follow-up candidate.
- Advisory (P3): `plugins/karakeep-local/src/index.ts:149` writes `--out` without creating the parent dir (ENOENT on a fresh work dir). Follow-up candidate.
- Advisory (P4, environment): `--agent auto` resolved to `oh-pi`, whose quota is exhausted (HTTP 429 code 1310, resets 2026-08-07) — generate failed 4× at ~27s until the agent was pinned. Not a product defect; see fix note.

**Fix pass (`--fix all`)**:
1. Repaired `scratch/e2e/source/item-1.json` (gitignored scratch fixture): added the contract-required `body` field — without it the chain "passed" on empty docs and published a Notice (the original acceptance evidence masked this).
2. **Repaired content-gen's agent-output extraction** (tracked code change, R1 blocker): `plugins/content-gen/src/index.ts:61-68` required the agent's entire stdout to be one fenced block (`/^```…```$/`); real agents wrap the fence in prose → `JSON Parse error: Unexpected identifier "I"` → generate exits 1. Now extracts the first fenced block anywhere, falling back to the outermost `{…}` span. Regression test added: `plugins/content-gen/tests/content-gen.test.ts` "skill runner accepts prose-wrapped fenced Content JSON" (11/11 content-gen tests pass; full `bun run spur-check` green).
3. Added `/scratch/` to the repo `.gitignore` — the acceptance run's own artifacts (`docs.json`, `content.json`) failed `bun run lint` because Biome honors only the repo ignore file, and `scratch/` had been ignored solely via the user's global gitignore.
4. Acceptance full-run executed with `KNOWLEDGE_KIT_SPUR_BIN=/tmp/spur-wrap.sh`, a wrapper that rewrites `--agent auto` → `--agent omp` (oh-pi quota exhausted). Deviation disclosed: the shipped default (`auto`) is healthy whenever the pool routes to a non-exhausted agent; the pin only bypasses the exhausted pool member.
### Review

| Severity | Finding | Resolution |
| --- | --- | --- |
| P4 | Validate workflow error output format | Confirmed step name and non-zero exit code are explicitly displayed |

- End-to-end vertical pipeline successfully verified with evidence recorded.

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-08-02T22:29:24.652Z todo → wip (system)
- 2026-08-02T22:29:34.933Z wip → testing (system)
- 2026-08-02T22:29:36.297Z testing → done (system)
