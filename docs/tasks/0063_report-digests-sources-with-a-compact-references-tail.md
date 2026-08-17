---
template: feature-impl
schema_version: 1
name: "Report digests sources with a compact references tail"
description: ""
status: done
type: task
profile: standard
feature_id: C5
parent_wbs: null
priority: P2
tags: ["storm-research", "report-craft"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-16T03:35:23.269Z"
updated_at: "2026-08-17T03:52:20.884Z"
---

## 0063. Report digests sources with a compact references tail

### Background
Implements: C5 R6 — The generated report digests sources instead of indexing them; R7 — Render resolves the references tail to cached files.

Report-craft half of C5 (design D7, ADR-013): content-gen's STORM article-stage prompt mandates synthesis — the body draws findings from across the supplied documents rather than listing them one per line — and the render tail stops appending the ## Outline replay block (content.outline stays in content.json, dropped only in the markdown tail). The compact ## References list keeps its shape; cite ids are Doc ids (computeId(sourceUri)), so they resolve by construction to the references/<doc-id>.md cache files written by 0062.

Premise correction (refine, depth ready): the two render copies are NOT byte-identical files — plugins/kk/scripts/render-md.ts carries its own imports/header/runner main() because kk-core is private to end users. What is identical is the render logic (same expressions, e.g. the outlineBlock line), kept in sync by the SYNC comment convention. This task edits both copies' render logic identically.

Runs in parallel with the ingest task (0062); the SKILL.md doc task (0064) lands last.
Rubric: E2 D2 L2 C0 R0 = 6 → task (a prompt-only split was rejected: the content-gen edit alone is below the 2h floor, and the brainstorm pairs prompt + render tail as one reshape under D7).
### Requirements
- [x] R1. The article-stage prompt in plugins/generations/content-gen/src/storm.ts (articleStage, the `extra` block at storm.ts:241–246) mandates synthesis: findings drawn from across the supplied documents, conclusions stated — not one line per source, not an index of references.
- [x] R2. renderContentMarkdown stops appending the ## Outline replay block; content.outline remains in content.json (dropped only from the markdown tail).
- [x] R3. The ## References tail keeps its current compact shape (- label (cite) lines); cite ids remain Doc ids, resolving by construction to references/<doc-id>.md.
- [x] R4. The outline removal lands identically in both render copies — packages/kk-core/src/render-md.ts:24 and plugins/kk/scripts/render-md.ts:76 — with template comments updated, SYNC comment preserved; tests updated in packages/kk-core/tests/render-md.test.ts (the "emits an Outline block" case inverts; blank-outline case stays valid) plus a content-gen prompt test asserting the synthesis mandate string.

Non-goals: no change to curation/outline/polish stage prompts (article stage only, per satellite §6); no References-block reshape; content.json schema untouched; no enforcement of "digest quality" beyond prompt text (LLM variance is accepted — satellite D7).
### Acceptance Criteria
```gherkin
Feature: STORM research workflow evidence hardening

  @core
  Scenario: R1 — The generated report digests sources instead of indexing them
    Given a grounded DocList with normalized bodies
    When content-gen writes the draft
    Then the report body synthesizes findings across the sources rather than listing them one per line

  @core
  Scenario: R2 — The report markdown drops the Outline replay block
    Given content.json whose content carries a non-empty outline
    When renderContentMarkdown runs
    Then content.md contains no ## Outline replay block
    And content.json still keeps the outline field

  @core
  Scenario: R3 — Render resolves the references tail to cached files
    Given content.json whose references carry cite ids matching references/<doc-id>.md files
    When render runs
    Then content.md ends with a compact References list whose entries resolve to cached files
    And no outline replay is appended

  @core
  Scenario: R4 — The outline removal lands identically in both render copies
    Given packages/kk-core and plugins/kk both ship render-md
    When the same content renders through both copies
    Then both outputs drop the outline block byte-identically and the SYNC comment is preserved
```

- **Feature AC match?** Closed: feature scenarios R6/R7 are carried verbatim with task-local
  R-prefixes (`ac_numbering: task-local`); `normalizeTitle` strips the prefix, so feature
  traceability is unaffected. R2 and R4 are task-local scenarios with no feature-level counterpart.
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**WHAT/WHY** — Make "digest, don't index" the report contract (ADR-013 D7): the article-stage prompt mandates cross-source synthesis, and the render markdown tail drops the `## Outline` replay so the report ends on the compact references list. Digestion quality must not be prompt luck.

**WHERE** — `plugins/generations/content-gen/src/storm.ts` (articleStage); `packages/kk-core/src/render-md.ts` + `plugins/kk/scripts/render-md.ts` (render pair); tests in `packages/kk-core/tests/render-md.test.ts` and `plugins/generations/content-gen/tests/`.

**Frozen names** (verified against current tree):
- Prompt insertion point: `articleStage`'s `groundedStagePrompt(inputPath, [...allowed], extra)` call at storm.ts:238–247 — the synthesis mandate is a new sentence appended to the `extra` array, e.g. `'Synthesize: the body must draw findings from across the supplied documents, compare them, and state conclusions. Never list sources one per line or produce an index of references — references are evidence, not the deliverable.'` The returned-JSON contract (`{"title","body","citations"}`) and `assertKnownEvidence` checks are unchanged.
- Render seam: the `outlineBlock` const (render-md.ts:24 kk-core / :76 script copy) — delete it and its inclusion in the `Result =` concatenation; update both copies' frozen-template comments (item 3) and keep the SYNC comment. `renderReferences` and `renderReferenceLabel` are untouched (R3).
- Resolution claim: `cite` = Doc id = `computeId(sourceUri)` = the `<doc-id>.md` filename 0062 writes — no render lookup code; "resolve" means the id correspondence holds by construction.

**Anti-patterns (do not implement):** do not touch curation/outline/polish prompts (satellite scopes the mandate to articleStage); do not remove `outline` from `content.json`/schemas (R2 keeps the field); do not add render-time file existence checks against `references/` (render stays pure/IO-free); do not let the two render copies drift — identical edit both sides.

**Handoff:** 0062 ships the cache files this task's references tail resolves against; 0064 records the digest-don't-index practice in storm-research SKILL.md. No `dependencies[]` edges; parallel with 0062.
### Plan
1. storm.ts articleStage: append the synthesis-mandate sentence to the `extra` block (R1). No other stage touched.
2. kk-core render-md.ts: delete `outlineBlock` and its use in the Result concatenation; update the frozen-template comment (drop item 3, renumber) (R2).
3. Script copy plugins/kk/scripts/render-md.ts: apply the identical edit; confirm the SYNC comment stays (R4).
4. Update `packages/kk-core/tests/render-md.test.ts`: invert the "emits an Outline block" case to assert no `## Outline` even with non-empty outline; keep the blank-outline case; assert the References tail shape is unchanged (R2, R3).
5. Add/extend a content-gen test asserting the article-stage prompt contains the synthesis mandate and the citation contract string is preserved (R1).
6. Verify: `bun run lint` clean, `bun run test` green.
### Solution
Digest-don't-index report contract (ADR-013 D7) in three seams, per the frozen design:

- **R1 — synthesis mandate** (`plugins/generations/content-gen/src/storm.ts:243`): appended one sentence to `articleStage`'s `extra` block: "Synthesize: the body must draw findings from across the supplied documents, compare them, and state conclusions. Never list sources one per line or produce an index of references — references are evidence, not the deliverable." Returned-JSON contract and `assertKnownEvidence` untouched; no other stage prompt changed.
- **R2/R4 — outline replay dropped, both render copies identically**: deleted the `outlineBlock` const and its slot in the `Result` concatenation of `renderContentMarkdown` in `packages/kk-core/src/render-md.ts:27` and `plugins/kk/scripts/render-md.ts:79`. kk-core's frozen-template comment renumbered (item 3 now documents the deliberate outline drop; SYNC comment in the script copy untouched). `outline` stays parsed in both copies (content.json schema unchanged — R2); `renderReferences`/`renderReferenceLabel` untouched (R3).
- **R3 — references tail unchanged in shape**: cite ids remain Doc ids (`computeId(sourceUri)`), so tail entries resolve by construction to `references/<doc-id>.md` written by 0062; no render-time lookup code (render stays pure/IO-free, per anti-patterns).

Tests: kk-core render-md inverted the "emits an Outline block" case to assert full output with a non-empty outline present (`# Untitled\n\nbody\n\n## References\n\n- …`), blank-outline case kept; existing R3 characterization (shipped script byte-identical to kk-core, fixture carries outline) now proves both copies dropped the replay together. content-gen pipeline-order test asserts the mandate string + preserved citation contract, and that curation/outline/polish prompts do NOT carry it (article-stage-only, satellite §6).
### Testing
Re-verified 2026-08-16 by verify mode `--auto --force --focus all --fix all` against the current working tree (uncommitted C5 changes; stale PASS overwritten). Verdict: **PASS** — all requirements MET, all AC scenarios MET, no blocker/major SECUA findings; no fixes required. Verdict artifact: `.spur/run/0063-verdict.json` (overwritten this run; no other .spur/run artifacts touched). AC scenarios renumbered task-local 2026-08-16 (feature C5 AC extended R14/R15 to cover the two task-local scenarios; scenario title text unchanged, so normalized-title traceability is preserved).

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `plugins/generations/content-gen/src/storm.ts:245` (synthesis-mandate sentence in articleStage `extra`, verbatim from frozen design; JSON contract line untouched) + `plugins/generations/content-gen/tests/storm.test.ts:346` (mandate + citation contract in prompts[2], absence in curation/outline/polish prompts) |
| R2 | MET | `packages/kk-core/src/render-md.ts:19-24` (`outlineBlock` deleted; `Result = lead + body + refsBlock`) + `packages/kk-core/src/schemas.ts:18` (`outline` still parsed — content.json schema unchanged) + `packages/kk-core/tests/render-md.test.ts:60` (inverted exact-output case with non-empty outline) and `:120-134` (file fixture carries `outline: 'Old replay'`, asserts schema accepts + markdown drops) |
| R3 | MET | `renderReferences`/`renderReferenceLabel` untouched in both copies (zero diff hunks); tail shape exact-asserted `- [Alpha](https://a.example) (A1)` at `packages/kk-core/tests/render-md.test.ts:66`; cite = Doc id = `computeId(sourceUri)` → resolves by construction to 0062's `references/<doc-id>.md` |
| R4 | MET | Identical edit in `plugins/kk/scripts/render-md.ts:72-77` (SYNC comment intact at `:9`); kk-core frozen-template comment renumbered (`packages/kk-core/src/render-md.ts:10-17`); byte-identical pair characterization `packages/kk-core/tests/render-md.test.ts:173` proves both copies dropped the replay together |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R1 — The generated report digests sources instead of indexing them | MET | test | `plugins/generations/content-gen/tests/storm.test.ts:346` — article prompt carries the synthesis mandate + preserved citation contract, other stages clean. Prompt-only enforcement is the task's documented scope (non-goals; satellite D7); body-level digestion is LLM runtime, accepted variance |
| Scenario: R2 — The report markdown drops the Outline replay block | MET | test | `packages/kk-core/tests/render-md.test.ts:60` — inverted exact-output case: no `## Outline` in the rendered markdown; `:120-134` file fixture proves `packages/kk-core/src/schemas.ts:18` keeps the `outline` field while the renderer drops the replay |
| Scenario: R3 — Render resolves the references tail to cached files | MET | test | `packages/kk-core/tests/render-md.test.ts:60-66` — exact rendered output ends with the compact References tail and no `## Outline`; `:120-134` file fixture proves schema keeps `outline` while markdown drops the replay; resolution is by-construction (cite id names the cache file), render stays IO-free per design |
| Scenario: R4 — The outline removal lands identically in both render copies | MET | test | `packages/kk-core/tests/render-md.test.ts:173` — byte-identical pair characterization across `packages/kk-core/src/render-md.ts` and `plugins/kk/scripts/render-md.ts`; SYNC comment intact at `plugins/kk/scripts/render-md.ts:9` |

**Design conformance:** 4/4 claims DONE (mandate wording matches frozen design verbatim; `outlineBlock` deleted in both copies; frozen-template comment updated, SYNC preserved; no render lookup code; no schema change; no other stage prompt touched). Anti-patterns respected. Scope-creep: none — diff is exactly R1–R4.

**SECUA:** no new deps; no secrets; render pure/IO-free; script copy self-contained (published-`kk` constraint — no kk-core import); hermetic tests (tmpdir fixtures, `Bun.spawn` on local script only). Findings: P3 (prompt-only enforcement of digest quality — accepted by design, satellite D7) and P4 (script-side comment step vacuous — script copy carries only the SYNC pointer) carry over from prior review; no new findings this run.

**Fresh evidence (this run, --force):** `bun test packages/kk-core plugins/generations/content-gen` → 100 pass / 0 fail (272 expects, 8 files), exit 0. `bun run lint` → exit 0 (Biome 2.5.5 + typecheck all workspaces). `spur task check 0063 --strict-core --json` → PASS, zero findings after the 2026-08-16 renumber.

**Coverage:** storm.ts 100% lines / 99.17% branches (from test run output). No test skipped or commented out.

**Residual risks:** digest quality itself is unverifiable hermetically (prompt-only mandate — first live STORM run post-merge is the e2e check); cache-file existence is 0062's contract, cross-task correspondence holds by `computeId` construction.
### Review
**Disposition: PASS** — no blockers. Diff: storm.ts +1 (synthesis mandate), kk-core render-md +8/−10 (outline drop), script copy +2/−4 (identical drop), tests +24 (3 cases). Re-validated on current tree: `bun test packages/kk-core plugins/generations/content-gen` → 100 pass / 0 fail (272 expects); `bun run lint` exit 0. Traceability R1–R4 all MET with test evidence.

| Priority | Finding | Disposition |
|----------|---------|-------------|
| P1 | (none) | — |
| P2 | (none) | — |
| P3 | Digest-don't-index is prompt-only enforcement: no automated check can catch regression to source indexing (LLM variance accepted, satellite D7; non-goal states no enforcement beyond prompt text) | Accepted by design — first live STORM run post-merge is the real e2e check |
| P4 | Design step "update both copies' frozen-template comments" satisfied vacuously on the script side — plugins/kk/scripts/render-md.ts carries no template enumeration, only the SYNC pointer (intact at :9); kk-core's enumeration was correctly updated | No action |
| P4 | R1 absence assertions use the substring `references are evidence` for stages 0/1/3 — adequate; presence assertion covers the key clause `references are evidence, not the deliverable` | No action |

Evidence per requirement:
- R1: storm.ts:245 adds the frozen-design mandate sentence verbatim to articleStage `extra` only; storm.test.ts:346–353 asserts the mandate + preserved `{"title","body","citations"}` contract in prompts[2] and absence in curation/outline/polish prompts.
- R2: kk-core render-md.ts `outlineBlock` deleted from const and Result concatenation; `ContentSchema` untouched (schemas.ts:18 `outline` still parsed); file-path test adds `outline: 'Old replay'` to the fixture and asserts schema acceptance + markdown drop.
- R3: `renderReferences`/`renderReferenceLabel` untouched in both copies; cite ids remain Doc ids (storm.ts docs.map untouched).
- R4: script copy edited identically; SYNC comment preserved; byte-identical characterization test (fixture carries `outline: 'A\nB'`) drives the real `bun <script> --in --out` and asserts equality with kk-core output — proves both copies dropped the replay together.

SECUA: no new deps; workspace boundary respected (script copy stays self-contained for published `kk`, no kk-core import); no IO added to render (anti-pattern respected); tests hermetic (tmpdir fixtures, Bun.spawn on local script only).

Architecture: matches ADR-013 D7 exactly. Docs already describe the post-change shape (04_DESIGN.md:267, 03_ARCHITECTURE.md:199, ADR-013, design doc D7 — committed 7983bd9): implementation now matches docs, no T3 drift.

Residual risks: (1) digest quality unverifiable hermetically — prompt-only mandate; (2) ~/.agents/skills/kk-storm-research/SKILL.md practice update is 0064 scope, not this diff.
### References

C5

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-16: verify stage PASS (all R1–R4 MET, core scenarios R6/R7 MET; fresh: 100/100 tests, lint 0, strict-core 0). Testing section rewritten with verdict tables.
- 2026-08-16T17:20:44.186Z wip → testing (system)
- 2026-08-16T17:20:44.444Z testing → done (system)
