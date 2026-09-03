---
schema_version: 1
name: "Gap analysis: kk-daily-ai-voice vs ideal end-to-end daily pipeline"
status: done
template: feature-impl
created_at: 2026-09-03T04:21:27.164Z
updated_at: "2026-09-03T06:39:06.217Z"
feature_id: F61
---

## 0088. Gap analysis: kk-daily-ai-voice vs ideal end-to-end daily pipeline

### Background

**Type:** `wayfinder:research` — resolve with evidence reading, no production code. Map: feature F61.

**Sharp question:** what exactly must change in `plugins/kk/workflows/kk-daily-ai-voice.yaml` (states, vars, guards) and in the plugin set to reach the operator's ideal 3-stage daily flow — collect (1.1 last30days, 1.2 Horizon) → blend facts (2.1) → article (2.2) + script (2.3) + cover (2.4) + voice (2.5) → publish (3.1 podcast w/ show notes, 3.2 surfdash (sole article platform for v1))?

**Evidence:** the workflow YAML; plugin manifests under `plugins/{ingestions,generations,publishings}/`; `docs/design/kk-daily-ai-voice.md`; `docs/design/fan-in-and-fan-out-specification.md`; feature F61 Notes (existing-pieces recon).

**Deliverable:** gap list + extension plan in `## Solution` — per ideal step a disposition (exists / extend / missing) and a recommended home for each missing capability.

### Requirements

- [x] R1. Inventory current workflow states/vars/transitions against all 9 ideal steps (1.1–3.2) with a per-step disposition: exists / extend / missing.
- [x] R2. Map existing plugins to each needed capability (ingest ×3 sources, facts-blend, article, script, cover, voice, publish targets), naming the plugin or `missing`.
- [x] R3. For every `missing`, recommend its home — kk subcommand vs plugin vs workflow state — consistent with `docs/design/fan-in-and-fan-out-specification.md` (fan-in/out are kk subcommands, not engine states).

Non-goals: no code or YAML changes; no plugin scaffolds; no scheduling design (map fog); no second workflow file (decided on map F61).

### Acceptance Criteria
- [x] All 9 ideal steps carry a disposition with file-level evidence.
- [x] Every `missing` capability has a recommended home per R3.
- [x] Answer recorded in `## Solution`; no production code written.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-03T04:40:21.502Z

- None open. Platform scope (surfdash-only) and workflow shape (extend, not fork) are locked on map F61.

### Design

**WHAT:** a disposition table over the ideal 9-step flow (1.1 last30days, 1.2 Horizon, 2.1 blend, 2.2 article, 2.3 script, 2.4 cover, 2.5 voice, 3.1 podcast publish, 3.2 surfdash publish), then a gap list with recommended homes, then an extension-plan sketch for `kk-daily-ai-voice.yaml`.

**WHY:** freezes the extension plan so 0090/0091 and later implement tasks never re-derive it.

**WHERE — frozen read set (verified present 2026-09-02):** `plugins/kk/workflows/kk-daily-ai-voice.yaml`; `docs/design/kk-daily-ai-voice.md`; `docs/design/fan-in-and-fan-out-specification.md`; every `plugins/{ingestions,generations,publishings}/*/plugin.json` (aihot-ingest, karakeep-local, web-search, content-gen, dailynews-gen, voice-gen, emdash-pub, podcast-pub, qiita-pub, surfdash-pub, zenn-pub); `docs/features/F61_daily-ai-news-end-to-end-pipeline-wayfinder-map.md`.

**Deliverable contract — `## Solution` carries three named subsections:** `Disposition table` (9 rows) · `Gaps + recommended homes` · `Extension plan sketch` (proposed new state ids / vars for the YAML, marked as proposals).

**Anti-patterns:** no production code; no `kk` CLI changes; do not redesign the workflow engine; do not spec scheduling or the judge gate (map fog); no new plugin `kind`.

**Handoff:** 0090 consumes the blend-home recommendation; 0091 consumes the article-generator and publish dispositions. State both explicitly at the end of Solution.

### Plan
- [x] 1. Read the frozen read set (Design §WHERE) — workflow YAML + design doc first. (R1)
- [x] 2. Build the 9-row disposition table with file-level evidence per row. (R1)
- [x] 3. Walk all 11 plugin manifests; fill the capability map, marking gaps `missing`. (R2)
- [x] 4. Assign each gap a home per the fan-in/fan-out spec; draft the extension-plan sketch. (R3)
- [x] 5. Write `## Solution` with the three contracted subsections + handoff lines. (R1–R3)

Verification intent: `spur task check 0088` clean; reviewer confirms each R has matching evidence in Solution and both handoff lines exist.

### Solution

#### Disposition table

| # | Ideal step | Disposition | Evidence (file:line) |
| --- | --- | --- | --- |
| 1.1 | last30days ingest | **missing** | No last30days ingestion plugin. `plugins/ingestions/` holds only `aihot-ingest`, `karakeep-local`, `web-search` (`plugins/ingestions/*/plugin.json`). Workflow `fetch` runs only `kk executor run aihot-ingest` (`plugins/kk/workflows/kk-daily-ai-voice.yaml:46`). Source is a skill, not a plugin: `~/.agents/skills/last30days` (`docs/features/F61_daily-ai-news-end-to-end-pipeline-wayfinder-map.md:57`). |
| 1.2 | Horizon crawl | **missing** | No Horizon ingestion plugin in the same set; source is an external CLI `(cd ~/tools/Horizon && uv run horizon)` (`docs/features/F61_daily-ai-news-end-to-end-pipeline-wayfinder-map.md:57`), not wrapped as a plugin. |
| 2.1 | blend facts | **missing** (stage) — merge subcommand exists | No blend workflow state and no core-facts contract/template in `kk-daily-ai-voice.yaml`. The merge tool ships: `kk executor fan-in` (`docs/design/fan-in-and-fan-out-specification.md:50`, shipped under B6/task 0042). The workflow never calls fan-in; the only fanout reference in workflows is `plugins/kk/workflows/judge-gated-publish-example.yaml:46`. |
| 2.2 | article | **extend** | `content-gen` generator plugin exists (`plugins/generations/content-gen/plugin.json:2`, STORM pipeline → `Doc[]` → `Content`), but `kk-daily-ai-voice.yaml` never invokes it. |
| 2.3 | script | **exists** | `dailynews-gen` is wired: `kk executor run dailynews-gen` (`plugins/kk/workflows/kk-daily-ai-voice.yaml:56`); plugin `plugins/generations/dailynews-gen/plugin.json:2`. |
| 2.4 | cover | **missing** | No `cover-gen` in `plugins/generations/` (only `content-gen`, `dailynews-gen`, `voice-gen`). Cover path is open in the map: `wt-image-cover` skill vs `cover-gen` plugin (`docs/features/F61_daily-ai-news-end-to-end-pipeline-wayfinder-map.md:64`). |
| 2.5 | voice | **exists** | `voice-gen` is wired: `kk executor run voice-gen` (`plugins/kk/workflows/kk-daily-ai-voice.yaml:84`); plugin `plugins/generations/voice-gen/plugin.json:2`. |
| 3.1 | podcast publish w/ show notes | **extend** | `podcast-pub` publish plugin exists (`plugins/publishings/podcast-pub/plugin.json:2`), but the workflow terminates at `quality-control → done` (`plugins/kk/workflows/kk-daily-ai-voice.yaml:154-155`) with no publish state. No publish state invokes `podcast-pub`; when wired by 0091, `podcast-pub` maps the article `Content.body` verbatim to episode show notes (`plugins/publishings/podcast-pub/src/map.ts:7`; show-notes decision `docs/features/F61_daily-ai-news-end-to-end-pipeline-wayfinder-map.md:48`). |
| 3.2 | surfdash publish | **extend** | `surfdash-pub` publish plugin exists (`plugins/publishings/surfdash-pub/plugin.json:2`) but is not wired into the workflow; surfdash is the sole article platform for v1 (`docs/features/F61_daily-ai-news-end-to-end-pipeline-wayfinder-map.md:49`). |

#### Gaps + recommended homes

Every gap carries a home consistent with `docs/design/fan-in-and-fan-out-specification.md`: fan-in/fan-out are `kk` subcommands (see §1.1), never engine states.

- **1.1 last30days ingest** — **ingestion plugin** (new `last30days-ingest`, kind `ingestion`) + a new workflow state `kk executor run last30days-ingest`. Reason: wrap the skill output as `Doc[]`, registered through multi-root discovery (ADR-012), keeping executor-run uniform. Task 0089 wraps it. _(missing-capability home.)_
- **1.2 Horizon crawl** — **ingestion plugin** (new `horizon-ingest`, kind `ingestion`) + a new workflow state `kk executor run horizon-ingest`. Task 0089 wraps it. _(missing-capability home.)_
- **2.1 blend facts** — **`kk executor fan-in` (kk subcommand)** for the N-source `Doc[]` merge, invoked from a new workflow state `blend-facts`; the merged `Doc[]` → single core-facts markdown `Content` render is a **generator** whose contract + template 0090 prototypes. This is the **blend-home recommendation 0090 consumes**: merge = `fan-in` subcommand, facts render = generator (contract/template in 0090). Not an engine state — the workflow state only wraps the subcommand. _(missing-stage home; the subcommand itself already exists per the spec.)_
- **2.4 cover image** — **generation plugin** (new `cover-gen`, kind `generation`) + a workflow state `kk executor run cover-gen`. Alternative is the `wt-image-cover` skill, but a skill is not a plugin the executor invokes, so a `cover-gen` generator keeps the pipeline plugin-uniform. Style/branding template is genuinely unspecified (`docs/features/F61_daily-ai-news-end-to-end-pipeline-wayfinder-map.md:64` — map fog, out of scope here). _(missing-capability home.)_

Also homes for the two **extend** gaps (they need wiring, not new capability):

- **2.2 article** (extend) — **generator plugin** `content-gen`, wired as a new `article` state consuming the blended/core-facts file. Consumed by 0091.
- **3.1 / 3.2 publish** (extend) — **`kk executor fan-out` (kk subcommand)** in a new `publish` state, with targets `podcast-pub` and `surfdash-pub` (v1 = surfdash; podcast carries the article as episode show-notes). Consumed by 0091.

#### Extension plan sketch (proposals — NOT applied)

For `plugins/kk/workflows/kk-daily-ai-voice.yaml`, the superset shape extends the current linear flow into: `collect` → `blend` → `generate` (article / cover / script / voice) → `publish`. Proposed **new vars** (add to the `vars:` block):

```yaml
  last30days_enabled: "true"   # gate source 1.1
  horizon_enabled: "true"      # gate source 1.2
  article_enabled: "true"      # gate article (2.2)
  cover_enabled: "false"       # gate cover (2.4); off until cover-gen exists
  publish_enabled: "false"     # gate publish fan-out (3.x); off until ready
  publish_targets: "surfdash"  # 1..N fan-out target names (v1: surfdash; add podcast)
  article_title: ""            # content-gen input (template-driven)
  article_template: ""         # content-gen input (template-driven)
```

Proposed **new state ids** (linear, single-node; each wraps a `kk` subcommand — no engine-level fan-in/out):

1. `ingest-last30days` → `kk executor run last30days-ingest --in … --out …/1-ingest/last30days.json`
2. `ingest-horizon` → `kk executor run horizon-ingest --in … --out …/1-ingest/horizon.json`
3. `blend-facts` → `kk executor fan-in --in 1-ingest/last30days.json --in 1-ingest/horizon.json --in 1-ingest/docs.json --out 1-ingest/blended.json` (then facts render → core-facts markdown, 0090)
4. `article` → `kk executor run content-gen --in 1-ingest/blended.json --out 2-article/content.json`
5. `cover` → `kk executor run cover-gen --in 1-ingest/blended.json --out 2-cover/content.json`
6. `script` (existing) → change `--in` to `1-ingest/blended.json` (facts file) instead of `docs.json`
7. `generate` (existing `voice-gen`) → unchanged
8. `quality-control` (existing) → unchanged
9. `publish` → `kk executor fan-out --content 2-article/content.json --target <publish_targets> --out result.json`

Proposed **transition sketch**: `prepare → ingest-last30days → ingest-horizon → blend-facts → article → cover → script → wrap-docs → generate → quality-control → publish → done`; the existing `review` (HITL) state is retained between `script` and `wrap-docs`, with `skip_review` defaulting to `"true"` for an unattended daily run (marked as a proposal only — HITL persistence in the unattended run is a not-yet-specified map item).

> All new ids/vars above are **proposals** for discussion; nothing here bumps or edits `kk-daily-ai-voice.yaml`. No scheduling, no judge gate, no cover style/branding template (all map fog, out of scope).

#### Handoff

- **0090 consumes:** the **blend-home recommendation** — blend-facts = `kk executor fan-in` (kk subcommand) for the N-source `Doc[]` merge, plus a generator (contract + template) that renders the merged facts into a single core-facts markdown `Content`. 0090 prototypes that contract + template; the merge home is the `fan-in` subcommand per the fan-in/fan-out spec.
- **0091 consumes:** the **article-generator disposition** (2.2 = `content-gen`, extend — wire as a new `article` state consuming the core-facts file) and the **publish dispositions** (3.1 = `podcast-pub` + 3.2 = `surfdash-pub`, both extend via `kk executor fan-out`, with the article passed as podcast episode show-notes content shape; surfdash remains the sole article platform for v1).

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `docs/tasks/0088_gap-analysis-kk-daily-ai-voice-vs-ideal-end-to-end-daily-pip.md:72-84` — Disposition table inventories all 9 ideal steps (1.1–3.2) with per-step disposition (missing/extend/exists); anchors re-read this run: `plugins/kk/workflows/kk-daily-ai-voice.yaml:46` (aihot-ingest), `plugins/kk/workflows/kk-daily-ai-voice.yaml:56` (dailynews-gen), `plugins/kk/workflows/kk-daily-ai-voice.yaml:84` (voice-gen), `plugins/kk/workflows/kk-daily-ai-voice.yaml:154-155` (quality-control → done) |
| R2 | MET | `docs/tasks/0088_gap-analysis-kk-daily-ai-voice-vs-ideal-end-to-end-daily-pip.md:76-84` — every capability mapped to a named plugin or `missing`; manifests re-verified: `plugins/generations/content-gen/plugin.json:2`, `plugins/generations/dailynews-gen/plugin.json:2`, `plugins/generations/voice-gen/plugin.json:2`, `plugins/publishings/podcast-pub/plugin.json:2`, `plugins/publishings/surfdash-pub/plugin.json:2`; `plugins/ingestions/` holds exactly aihot-ingest, karakeep-local, web-search |
| R3 | MET | `docs/tasks/0088_gap-analysis-kk-daily-ai-voice-vs-ideal-end-to-end-daily-pip.md:88-97` — every missing capability has a home (1.1/1.2 → ingestion plugins; 2.1 → `kk executor fan-in` + facts-render generator; 2.4 → `cover-gen` generator), consistent with `docs/design/fan-in-and-fan-out-specification.md:50` and shipped CLI `apps/cli/src/commands/executor.ts:127` (fan-in, repeatable `--in`), `apps/cli/src/commands/executor.ts:135` (fan-out, repeatable `--target`) — all re-read this run |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| All 9 ideal steps carry a disposition with file-level evidence. | MET | command | `grep -cE '^\| [123]\.[0-9] ' docs/tasks/0088_gap-analysis-kk-daily-ai-voice-vs-ideal-end-to-end-daily-pip.md` → 9 (run this turn); each row carries repo-relative file:line evidence |
| Every `missing` capability has a recommended home per R3. | MET | command | `grep -c 'missing-capability home\|missing-stage home' docs/tasks/0088_gap-analysis-kk-daily-ai-voice-vs-ideal-end-to-end-daily-pip.md` → 4 (1.1, 1.2, 2.1, 2.4), each with a plugin/subcommand home (run this turn) |
| Answer recorded in `## Solution`; no production code written. | MET | command | `git diff --name-only d7a4d2dd~1..d7a4d2dd` → docs/ + .spur/memory only, 0 source files (run this turn); Solution spans `docs/tasks/0088_gap-analysis-kk-daily-ai-voice-vs-ideal-end-to-end-daily-pip.md:69-134` with all three contracted subsections (Disposition table :72, Gaps + recommended homes :86, Extension plan sketch :100) plus Handoff :131-133 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

**Verdict: PASS-with-findings** — 1× P3 + 5× P4, no blockers/majors.

**Scope reviewed:** WBS 0088 (`wayfinder:research`) — the `## Solution` section of `docs/tasks/0088_gap-analysis-kk-daily-ai-voice-vs-ideal-end-to-end-daily-pip.md` and the companion non-corpus doc `docs/design/kk-daily-ai-voice-gap-analysis.md`. No production code touched (git status: only the task doc modified + the companion doc added).

**Dimensions:** functional traceability (R1–R3 + AC), SECUA quality, architecture depth (fan-in/fan-out-specification.md conformance).

#### Findings (ranked)

| # | Severity | Dimension | Finding | Location |
| --- | ---------- | ----------- | --------- | ---------- |
| 1 | P3 | correctness | Row 3.1 parenthetical claims the show-notes content shape "is not yet satisfied by `podcast-pub`." That is inaccurate: `podcast-pub` already maps `content.body` → episode show notes verbatim. The 3.1 gap is wiring-only (no publish state, and no article `Content` fed to the plugin), not a plugin-capability gap. Disposition `extend` is correct; reword the evidence to "no publish state invokes `podcast-pub`; when wired by 0091, `podcast-pub` maps the article `Content.body` to episode show notes." | `plugins/publishings/podcast-pub/src/map.ts:7` vs `…0088…daily-pip.md` row 3.1 |
| 2 | P4 | traceability | Row 3.1 cites `F61…map.md:49` for the article-as-show-notes decision; that decision is on line 48. Line 49 is the surfdash-only-platform decision. | `docs/features/F61_….md:48-49` |
| 3 | P4 | traceability | Row 2.1 cites `fan-in-and-fan-out-specification.md:52-55` for the `kk executor fan-in` command; the canonical CLI line is at §1.1 `line 50` (sibling-command block lines 43–52). `:52-55` points into the 1.2 flag table instead. | `docs/design/fan-in-and-fan-out-specification.md:50` |
| 4 | P4 | traceability | Row 3.1 cites `kk-daily-ai-voice.yaml:86-94` for "the workflow terminates at `quality-control → done`"; the `quality-control` state block is 86–93 and the actual `quality-control → done` transition is lines 154–155. | `plugins/kk/workflows/kk-daily-ai-voice.yaml:154-155` |
| 5 | P4 | housekeeping | Requirement boxes R1/R2/R3 and the three AC items remain `[ ]` unticked. Evidence is present and matched; tick them before `spur task check` passes. (Note: `spur task check 0088` currently can't run — `SQLITE_BUSY_RECOVERY: database is locked`, `.spur/spur.db` held by the parent pipeline.) | task frontmatter + `### Review` |
| 6 | P4 | architecture | Extension-plan sketch passes fan-out targets as a single var `--target <publish_targets>`; `kk executor fan-out` takes **repeatable** `--target` flags. Fine for v1 single-target; when 0091 adds podcast the var must expand to repeated `--target` flags. Proposal-only, so non-blocking. | `apps/cli/src/commands/executor.ts:135-143` vs `Extension plan sketch` |

#### Residual risk

- Merge/publish homes are grounded: `kk executor fan-in` and `kk executor fan-out` are verified shipped as subcommands (`apps/cli/src/commands/executor.ts:127,135`), so the blend-facts (2.1) and publish (3.1/3.2) recommendations rest on real CLI surface, not the spec alone.
- Deferred by design to dependents and explicit map fog: blend-facts generator contract + template (0090), article/publish wiring (0091), cover style/branding template (map fog), scheduling and judge gate (map fog). Nothing here is a review gap.
- The 9-row disposition table, all 9 per-step homes, both handoff lines (0090 + 0091), the no-code constraint, the no-new-plugin-kind constraint, and the extend-not-fork decision (map line 46) all check out against the frozen read set.

#### Final disposition

**PASS-with-findings.** Every requirement (R1/R2/R3) and every Acceptance Criteria item has matching, evidence-backed content in `## Solution`; all 9 ideal steps carry a disposition with file-level evidence; every `missing` capability has a home consistent with the fan-in/fan-out spec (fan-in/out are kk subcommands, not engine states — verified in the CLI); both handoff lines to 0090 and 0091 are present; no production code was written. The one P3 is a wording/evidence-accuracy nit in the 3.1 justification (disposition unaffected); the five P4s are citation-line and housekeeping nits. No P1/P2; nothing blocks.

**Verified evidence (fresh, pasted):**

- `plugins/ingestions/` = `aihot-ingest, karakeep-local, web-search`; `plugins/generations/` = `content-gen, dailynews-gen, voice-gen`; `plugins/publishings/` = `emdash-pub, podcast-pub, qiita-pub, surfdash-pub, zenn-pub` — matches matrix claims.
- `kk-daily-ai-voice.yaml:46` aihot-ingest, `:56` dailynews-gen, `:84` voice-gen — matches exists/extend wiring claims; no publish transition (workflow ends `quality-control → done`).
- `content-gen/plugin.json:2`, `dailynews-gen/plugin.json:2`, `voice-gen/plugin.json:2`, `podcast-pub/plugin.json:2`, `surfdash-pub/plugin.json:2` — plugin manifests present as cited.
- `apps/cli/src/commands/executor.ts:127` (`fan-in`, repeatable `--in`), `:135` (`fan-out`, repeatable `--target`) — confirms fan-in/out are shipped kk subcommands, consistent with architecture constraint and R3.

### References

- Map: `docs/features/F61_daily-ai-news-end-to-end-pipeline-wayfinder-map.md`
- `plugins/kk/workflows/kk-daily-ai-voice.yaml` · `docs/design/kk-daily-ai-voice.md` · `docs/design/fan-in-and-fan-out-specification.md`
- Dependents: 0090 (blend home), 0091 (generator + publish dispositions)

### History

- 2026-09-03T05:16:27.989Z todo → wip (system)
- 2026-09-03T05:26:54.033Z wip → testing (system)
- 2026-09-03T05:27:11.320Z testing → done (system)
