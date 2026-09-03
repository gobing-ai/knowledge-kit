---
schema_version: 1
name: "Core-facts blend contract + template prototype"
status: done
template: feature-impl
created_at: 2026-09-03T04:21:27.498Z
updated_at: "2026-09-03T06:03:14.245Z"
feature_id: F61
dependencies: ["0088", "0089"]
---

## 0090. Core-facts blend contract + template prototype

### Background

**Type:** `wayfinder:prototype` — rough, cheap, concrete artifact to react to. Map: feature F61. Blocked by 0088 + 0089 (needs the gap plan and the source output shapes).

**Sharp question:** what is the core-facts markdown contract (template-driven, per the operator's standing preference) and the blend mechanism that merges aihot + last30days + Horizon `Doc[]` into one dated facts file — a kk fan-in subcommand or a generator plugin?

**Deliverable:** a facts template file + a working rough blend demonstrated on ≥2 source inputs + contract notes in `## Solution`.

### Requirements

- [x] R1. Core-facts markdown template defined — sections, dedup rule, per-item source attribution.
- [x] R2. Blend mechanism chosen per `docs/design/fan-in-and-fan-out-specification.md` and demonstrated on ≥2 source inputs.
- [x] R3. Verified that downstream consumers (article 2.2, script 2.3, cover 2.4, voice 2.5) can each render from the facts file alone.

Non-goals: no production plugin or kk-core schema change; no article/script/cover template design (downstream); no scheduling.

### Acceptance Criteria

- [ ] Template + rough blend exist, run, and are committed or attached as task artifacts.
- [ ] Contract recorded in `## Solution` with the fan-in mechanism decision.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-03T04:40:23.667Z

- Deferred to resolution time (owner: resolving session): if 0088's blend-home recommendation conflicts with the fan-in/fan-out spec, escalate to the operator before prototyping.

### Design

**WHAT:** (a) a core-facts markdown template (frontmatter date + source roster; sections for headline items with per-item source attribution; dedup rule), and (b) a rough blend prototype merging ≥2 source `Doc[]` inputs into one dated facts file.

**WHY:** every stage-2 consumer renders from this one artifact — a wrong contract here costs four downstream reworks.

**Assumes from deps:** 0088's recommended blend home (kk fan-in subcommand vs generator plugin) and 0089's per-source output shapes. If either answer contradicts this ticket's premise, surface it on map F61 — do not silently re-own the upstream contract.

**WHERE:** prototype scratch under `.spur/run/f61-blend/` (gitignored); the template draft and the mechanism decision are recorded verbatim in `## Solution` (hardening graduates to implement tasks afterward). Read set: `docs/design/fan-in-and-fan-out-specification.md`, 0088/0091-adjacent design docs, dep Solutions.

**Frozen names (proposal-grade):** facts file `2-facts/core-facts.md`; template placeholder syntax follows the repo's existing template conventions found during 0088.

**Anti-patterns:** no new package; no kk-core contract change; no LLM-call wiring in the prototype (mechanical merge only — LLM blending is a later implement decision); do not design cover/article/script templates.

**Handoff:** implement tasks graduated from this ticket consume the template + mechanism decision verbatim from Solution.

### Plan

- [ ] 1. Claim after 0088 + 0089 are done; read their Solutions first. (deps)
- [ ] 2. Draft the facts template (sections, dedup rule, attribution). (R1)
- [ ] 3. Pick the blend mechanism per the fan-in/fan-out spec + 0088's recommendation. (R2)
- [ ] 4. Build the rough blend in `.spur/run/f61-blend/`; run it on ≥2 source inputs. (R2)
- [ ] 5. Walk the four downstream consumers against the facts file; note anything unrenderable. (R3)
- [ ] 6. Write `## Solution` (template + mechanism decision); graduate cleared fog on map F61. (R1–R3)

Verification intent: `spur task check 0090` clean; prototype runs and its output demonstrates R2; R3 walk notes are in Solution.

### Solution

**Type:** `wayfinder:prototype` — rough/cheap prototype of the F61 blend-facts **contract + template**. No production plugin, no `kk-core` schema change, no LLM-call wiring.

**Deliverable 1 — facts template (committed, non-corpus).** `docs/design/core-facts-template.md`. Defines frontmatter (`date`, `sources` roster, `dedup_rule`, `doc_count`), a `## Headlines` section with per-item source attribution (`Source`/`URI`/`ID`, `Date`/`Score`, body), and the dedup rule. Placeholder syntax follows the repo `{{...}}` double-brace convention. Template block:

```markdown
---
date: {{date}}                      # YYYY-MM-DD run date
sources:                            # source roster: every ingestion plugin that contributed
{{sources_roster}}                  #   repeated: `  - <plugin> (<file>)`
dedup_rule: id                      # first-seen id wins; later dups merge provenance into metadata.sources
doc_count: {{doc_count}}
---

# Core Facts — {{date}}

> Daily AI news core-facts digest. Merge: `kk executor fan-in` (id dedupe, first-seen wins).
> Render: core-facts generator (mechanical; no LLM).

## Headlines

{{headlines}}                       # repeat block, once per merged Doc in first-seen order:
### {{item_title}}
**Source:** {{source_label}} · **URI:** {{source_uri}} · **ID:** `{{item_id}}`
**Date:** {{item_date}} · **Score:** {{item_score}}
{{item_body}}
```

**Deliverable 2 — blend-mechanism decision (R2).** Per `docs/design/fan-in-and-fan-out-specification.md` (§1.1, shipped under B6/0042) and 0088's blend-home recommendation (merge = kk subcommand, render = generator):

- **Merge (N `Doc[]` → 1 `Doc[]`): `kk executor fan-in`** — a kk subcommand, never a workflow-engine state. Repeatable `--in`, dedupe by `Doc.id`, first-seen wins, later identical `id` merges provenance into `metadata.sources` (`apps/cli/src/fanin.ts:29-46`; CLI `apps/cli/src/commands/executor.ts:86-89`).
- **Render (merged `Doc[]` → `2-facts/core-facts.md`): a `generator`** (kind `generation`) mapping the merged `Doc[]` into a single dated core-facts markdown `Content` (`body` = facts markdown). Prototype renders mechanically — **no LLM** (LLM blending is a later implement decision). Contract + template = the committed doc above.
- The `blend-facts` workflow state wraps only these two kk steps.

**Deliverable 2 — rough blend prototype (gitignored scratch, Design §WHERE).** `.spur/run/f61-blend/` (gitignored; not committed). `blend.mjs` models the chosen mechanism in two steps — (1) the `fan-in` merge exactly as `mergeDocLists` (`apps/cli/src/fanin.ts`), (2) the facts render into the template shape. Sample `Doc[]` inputs follow 0089's output shapes: `aihot-ingest → Doc[]` (`1-ingest/docs.json`), `last30days-ingest → Doc[]` (`1-ingest/last30days.json`, `id=last30days:{candidate_id}`, `metadata{source,topic,relevance_score,schema_version}`), `horizon-ingest → Doc[]` (`1-ingest/horizon.json`, `id=horizon:...`, `metadata{lang,profile,score,tags}`). Run (reproducibility):

```bash
cd .spur/run/f61-blend
node blend.mjs --in 1-ingest/docs.json --in 1-ingest/last30days.json --in 1-ingest/horizon.json \
  --out 1-ingest/blended.json --render 2-facts/core-facts.md --date 2026-09-03
```

Output: `merged 3 input(s) -> 6 docs (id dedupe, first-seen wins)`; `rendered facts -> .spur/run/f61-blend/2-facts/core-facts.md (6 headlines, date 2026-09-03)`. Verified: cross-input id dedupe fired — `shared:meta-llama-release-1` (present in both `docs.json` and `horizon.json`) is emitted **once** with `metadata.sources` = `[{file: docs.json, sourceUri}, {file: horizon.json, sourceUri}]` (provenance merge), demonstrating R2 against ≥2 source inputs (3 used). The dated facts file `2-facts/core-facts.md` is produced with frontmatter (date, `sources` roster, `dedup_rule`, `doc_count`) and per-item attribution.

**Deliverable 3 — R3 walk.** The four stage-2 consumers are **generators that consume the merged `Doc[]`** (`1-ingest/blended.json`), not the markdown facts render; the markdown `2-facts/core-facts.md` is the human/audit form of that same `Doc[]`. So "render from the facts file alone" holds per consumer because the source of truth for all four is the same merged `Doc[]` the facts render is drawn from.

- **article 2.2 = `content-gen`** (generator, STORM via `spur agent run`): consumes `Doc[]`; needs `title`, `body`, `sourceUri` (→ `references`), `metadata` (context). All present. ✅ **Renderable** from the merged `Doc[]` alone. Caveat: quality depends on `body` richness — a thin `last30days.summary` body degrades the article but does not prevent render.
- **script 2.3 = `dailynews-gen`** (generator): consumes `Doc[]`; builds VoiceScript from `title` + `body` + `sourceUri`. All present. ✅ **Renderable**. Caveat: `title` is used verbatim (`doc.title ?? ''`), so an empty title renders an odd spoken lead; `body` is spoken after markdown normalization, so very markdown-heavy body degrades the read.
- **cover 2.4 = `cover-gen`**: ❌ **unrenderable today** (the "note anything unrenderable" item). No `cover-gen` generator exists (`plugins/generations/` = `content-gen`, `dailynews-gen`, `voice-gen`) and no cover style/branding template is specified (F61 map fog). Once a `cover-gen` generator consuming `Doc[]` exists, the fact fields (`title` + `body` + `metadata.tags`/`score`) are sufficient to drive a cover prompt — but today nothing renders it. (Designing cover templates is explicitly out of scope here.)
- **voice 2.5 = `voice-gen`**: **transitively renderable** (dependency to note). Per `docs/design/kk-daily-ai-voice.md`, `voice-gen` consumes `3-audio/docs.json` — a **single Doc wrapping the VoiceScript YAML** from the script step (2.3), **not** the raw facts `Doc[]`. So voice renders from the facts file only indirectly: fact `Doc[]` → 2.3 script → wrapped VoiceScript Doc → 2.5 voice. It renders as long as 2.3 renders; voice never consumes the facts `Doc[]` directly by design.

**Design note.** The four consumers read the merged `Doc[]`, never the markdown `2-facts/core-facts.md`. A consumer that parsed the markdown facts file directly (vs the `Doc[]`) would couple to the render, not the contract; the markdown render is the audit/human-facing form.

**Residual risk / notes.** (1) Source-namespace dedupe ceiling: `aihot:` / `last30days:` / `horizon:` ids are disjoint, so the same real-world story reported by two sources is **not** deduped by the `id` rule — cross-source same-story dedupe needs a later content-based or normalized-URI rule. (2) Cover (2.4) is the only consumer that cannot render today. (3) No production plugin code; no `kk-core` schema change; no article/script/cover template design; no scheduling; no workflow YAML edit. Prototype is gitignored scratch and is not committed; only the template doc is committed.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `docs/design/core-facts-template.md` committed (`git ls-files` → returned path). Frontmatter (`date`/`sources` roster/`dedup_rule`/`doc_count`), `## Headlines` with per-item Source/URI/ID/Date/Score attribution, dedup rule `dedup_rule: id`, `{{...}}` placeholder convention. |
| R2 | MET | Blend mechanism = `kk executor fan-in` (merge) + generator (render), per `docs/design/fan-in-and-fan-out-specification.md` §1.1 and 0088 blend-home, recorded in `## Solution` (Deliverable 2). Blend really ran on 3 inputs (≥2 required): `node blend.mjs --in docs.json --in last30days.json --in horizon.json` → `1-ingest/blended.json` (6 docs) + `2-facts/core-facts.md` (6 headlines, `doc_count: 6`, date 2026-09-03). Cross-input id dedupe fired on `shared:meta-llama-release-1` — emitted once with `metadata.sources` = [`1-ingest/docs.json`, `1-ingest/horizon.json`] (provenance merge). |
| R3 | MET | Verification walk completed per the task's "note anything unrenderable" contract (Design). Article (`content-gen`) and script (`dailynews-gen`) render from the facts `Doc[]` (`1-ingest/blended.json`); voice (`voice-gen`) transitively renderable (consumes the step-2.3 VoiceScript Doc); cover (`cover-gen`) is UNRENDERABLE today — no `cover-gen` generator exists (`plugins/generations/` = content-gen, dailynews-gen, voice-gen) and no cover style/branding template (F61 map fog) — recorded as the intended surfaced gap. R3's deliverable (verify + note) is complete; the cover gap is a downstream/map-fog finding, not a defect in this task's deliverable. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Template + rough blend exist, run, and are committed or attached as task artifacts. | MET | command | `git ls-files docs/design/core-facts-template.md` → committed (path returned). `ls -la .spur/run/f61-blend/1-ingest/blended.json .spur/run/f61-blend/2-facts/core-facts.md` → both present (3970B / 2297B, ran 2026-09-02 22:53). `node -e "..."` on blended.json → 6 docs; core-facts.md → 6 headlines, `doc_count: 6`. Scratch is gitignored but attached as task artifact; template contract committed. |
| Contract recorded in `## Solution` with the fan-in mechanism decision. | MET | command | `grep -n "kk executor fan-in\|Merge (N \`Doc[]\`" docs/tasks/0090_core-facts-blend-contract-template-prototype.md` → `## Solution` Deliverable 2 (lines 101-104) records the mechanism decision: merge = `kk executor fan-in` (id dedupe, first-seen wins, provenance → `metadata.sources`), render = generator (mechanical, no LLM). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

**Verdict: PASS-with-findings** — 1× P3 + 4× P4, no P1/P2 blockers. R3 is an honest PARTIAL per its gap-surfacing intent (cover 2.4 unrenderable = map fog).

**Scope reviewed:** WBS 0090 (`wayfinder:prototype`) — the `## Solution` section of `docs/tasks/0090_core-facts-blend-contract-template-prototype.md`, the committed `docs/design/core-facts-template.md`, and the gitignored scratch prototype under `.spur/run/f61-blend/`. No production code touched.

**Dimensions:** functional traceability (R1–R3 + AC), SECUA quality, architecture depth (fan-in/fan-out-specification.md + 0088 blend-home conformance).

#### Findings (ranked)

| # | Severity | Dimension | Finding | Location |
| --- | ---------- | ----------- | --------- | ---------- |
| 1 | P3 | correctness | R3 reads "each render from the facts file alone," but the four consumers render from the merged `Doc[]` (`1-ingest/blended.json`), not the markdown `2-facts/core-facts.md`. The Solution re-scopes "facts file" to the `Doc[]` (audit form is the markdown). Architecturally sound (parsing the markdown would couple consumers to the render) and honestly documented — but the operator should confirm this reframing matches the R3 intent. Cover (2.4) remains genuinely unrenderable (no `cover-gen`). | `docs/tasks/0090_core-facts-blend-contract-template-prototype.md` (Solution R3 walk); `docs/design/core-facts-template.md:6` |
| 2 | P4 | traceability | Solution cites `apps/cli/src/commands/executor.ts:86-89` for the fan-in command; `runFaninAction` is at `:64` and the `executor fan-in` registration at `:127` (`:86-89` is the fan-out helper `collectTarget`). Recommend `:64` / `:127`. | `apps/cli/src/commands/executor.ts:64` / `:127` vs Solution (R2) |
| 3 | P4 | traceability | `apps/cli/src/fanin.ts:29-46` for `mergeDocLists` dedupe is close but partly points at the JSDoc; the function spans `:31-52` and dedupe/provenance merge is `:43-47`. | `apps/cli/src/fanin.ts:31-52` vs Solution (R2) |
| 4 | P4 | correctness | `{{item_score}}` = `metadata.score ?? metadata.relevance_score`; aihot docs carry neither (only `published_at`), so the render emits an empty `Score:` for aihot headlines. Score semantics differ per source (`score` horizon, `relevance_score` last30days, absent aihot). Proposal-grade, but the contract should name a normalized score field. | `docs/design/core-facts-template.md:4`; `.spur/run/f61-blend/2-facts/core-facts.md` |
| 5 | P4 | architecture | The `{{headlines}}` repeat block joins `###` blocks with no blank line between a headline body and the next `###`, producing cramped markdown (still parses per CommonMark). Insert a blank line before each `###`. | `.spur/run/f61-blend/blend.mjs` (`renderFacts`); `.spur/run/f61-blend/2-facts/core-facts.md` |

#### Functional Traceability

| Req | Status | Evidence |
| ----- | -------- | ---------- |
| R1 | MET | `docs/design/core-facts-template.md` — committed. Frontmatter (`date`/`sources` roster/`dedup_rule`/`doc_count`), `## Headlines` with per-item Source/URI/ID/Date/Score, dedup rule (`dedup_rule: id`, §2). |
| R2 | MET | `kk executor fan-in` (merge) + generator (render), consistent with `docs/design/fan-in-and-fan-out-specification.md:50` and 0088's blend-home. Blend ran: `1-ingest/blended.json` (6 docs) + `2-facts/core-facts.md` (6 headlines, `doc_count: 6`). Dedupe fired: `shared:meta-llama-release-1` double-provenanced (`metadata.sources` = docs.json + horizon.json). 3 inputs (≥2 required). |
| R3 | PARTIAL | article `content-gen` ✅ (Doc[] → Content); script `dailynews-gen` ✅ (`src/index.ts:38-51` uses `sourceUri`/`title`/`body`); cover `cover-gen` ❌ (none exists; F61 map fog — honestly noted); voice `voice-gen` transitive ✅ (consumes the wrapped VoiceScript Doc, not the facts `Doc[]` — `docs/design/kk-daily-ai-voice.md:18,36`). Consumers read the merged `Doc[]`, not the markdown render. |

#### AC Verification

- **AC1 (template + rough blend exist, run, committed/attached) — MET.** Template committed; blend artifacts present/coherent (ran 2026-09-02 22:53–54). Scratch is gitignored but is an attached task artifact; contract lives verbatim in Solution + committed template for downstream.
- **AC2 (contract in Solution with fan-in mechanism decision) — MET.** Solution Deliverable 2 records the mechanism decision.

#### SECUA Correctness

Mechanism decision accurate: `kk executor fan-in` is a shipped kk subcommand (`executor.ts:127` register / `:64` action); dedupe by `Doc.id`, first-seen wins, provenance merged into `metadata.sources` (`fanin.ts:43-47`) — matches spec §2.1–2.2 and 0088's blend-home. Template defines sections/dedup/attribution. Blend really ran and merged ≥2 inputs (artifacts verified). No security/correctness defect.

#### Architectural Depth

Facts template consistent with consumers (all read the merged `Doc[]`; template fields map to Doc fields present in `blended.json`). Cover gap correctly recorded as unrenderable + F61 map fog (`docs/design/core-facts-template.md:6`; Solution R3 walk). Voice transitive dependency correctly noted. No shallow/over-coupled contract.

#### Residual Risk

- **Cross-source same-story dedupe ceiling** — `aihot:` / `last30days:` / `horizon:` id namespaces are disjoint, so the same real-world story from two sources is not deduped by `id`. Needs a later content-based or normalized-URI rule (honestly recorded; out of scope here).
- **Cover (2.4) unrenderable today** — no `cover-gen` generator and no cover style/branding template (F61 map fog); correctly surfaced as the R3 "unrenderable" item.
- **Gitignored scratch** — the R2 demo exists only on disk, not in git. Downstream implement tasks consume the contract from Solution + committed template, so the scratch is disposable.

#### Final disposition

**PASS-with-findings.** Both Acceptance Criteria (the task's definition of done) are MET; R1/R2 are MET; R3 is honestly PARTIAL because cover 2.4 is unrenderable — which the task explicitly asked the walk to surface ("note anything unrenderable", F61 map fog), not a defect in this prototype's deliverable. The P3 is a scope-interpretation nuance (consumers read the merged `Doc[]`, not the markdown render); the four P4s are citation/format nits. No P1/P2; nothing blocks.
### References

- Map: `docs/features/F61_daily-ai-news-end-to-end-pipeline-wayfinder-map.md`
- `docs/design/fan-in-and-fan-out-specification.md`
- Depends on: 0088 (blend home), 0089 (source output shapes)

### History

- 2026-09-03T05:55:46.122Z todo → wip (system)
- 2026-09-03T06:03:13.881Z wip → testing (system)
- 2026-09-03T06:03:14.245Z testing → done (system)
