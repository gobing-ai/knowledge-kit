---
schema_version: 1
name: Fix daily-ai-voice content quality and QC gating defects
status: done
template: issue
created_at: 2026-09-16T15:11:20.813Z
updated_at: "2026-09-16T19:08:29.789Z"

ac_altitude: task-local
feature_id: O
---

## 0138. Fix daily-ai-voice content quality and QC gating defects

### Background

Defects grounded in the 2026-09-16 kk-daily-ai-voice run (`.works/kk-daily-ai-voice/2026-09-16/`) and verified against the current tree during ready-depth refine (2026-09-16). Four defect classes in scope; D3 (link canonicalization) was dropped on evidence — see Q&A.

**D1 — Run report rejection counts hard-zero (broken audit read).**
episode-plan-gen writes the rejection audit as `{rejected, config, total}` (`plugins/generations/episode-plan-gen/src/index.ts:698`), but news-report-gen's `readRejectedAudit` (`plugins/generations/news-report-gen/src/index.ts:244`) accepts only a bare array and returns `[]` otherwise. The rendered 阈值拒绝计数 (`20260916_19_run-report_report.md`) shows 0 everywhere while `20260916_04_quality-control-content_candidates.rejected.json` holds **13 entries — all 13 carry `category:not-in-allowlist`, 6 also carry `importance:2<3`** (refine-verified; the original Background's "11" was wrong). The published report misstates what QC did.

**D2 — QC admits headline-echo stubs (content quality).**
`scoreDimensions` (`episode-plan-gen/src/index.ts:309`) computes `quality = 1 + min(4, round(bodyLen/1500)) + (sourceUri ? 1 : 0)` (`:311-312`). The three aihot stubs score exactly 2 = `qc_min_quality` → admitted. **Refine-verified correction:** scoring runs pre-translation on blended docs, where the stub bodies are 234/243/255 EN chars (the 92/113/142-char figures in the original Background are the post-translation zh article bodies from `20260916_03_plan_plan.json`); substantive kept items are 348–1082. Any floor must therefore sit between 255 and 348 to fire. 0099 owner-approved the threshold pins, so the fix belongs in scoring, not thresholds.

**D3 — Same story published twice (near-dup dedup gap).**
Gemini 3.8 Live appears as plan items 5 (simonwillison.net) and 7 (blog.google). Dedup is title-only bigram Jaccard at `TITLE_SIMILARITY_THRESHOLD = 0.6` (`episode-plan-gen/src/index.ts:37`, `titleSimilarity:231`, applied in the filter pass at `:417`), pre-translation, over a **mixed-language** blend (Horizon digests arrive in zh; the simonwillison item is en). Refine-measured: pre-translate title-only 0.208, title+body400 0.222 — character-bigram Jaccard cannot detect cross-language near-dups at any usable threshold. Post-translation (`_03_plan_plan.json`, all-zh): **title-only 0.417** vs max distinct-pair 0.1 (4× margin); title+body400 drops to 0.129 (the two bodies genuinely diverge — one covers Simon Willison's analysis, the other the Google announcement), so adding body hurts. Fix: dedup post-translation, title-only.

**D4 — Research meta-chatter leaks into published copy.**
Item 5 renders 「可做角度」** 可做角度： (doubled label); items 5/7 carry self-referential hedging ("读者宜另行核实…", "仍待验证"); 「背景」「潜在影响」 scaffold headings render as reader copy. Two sources: last30days research-style bodies pass numeric QC unexamined, and the plan-translate agent prompt (`plugins/kk/workflows/kk-daily-ai-voice.yaml:124-129`) says "translate" with no copy-discipline contract (verified: prompt covers style/URLs/quotes only).

**Deferred (recorded, not owned here):**
- **Google News tracking redirects as published links** (original D3). Refine verdict: unfixable in-pipeline without network. horizon-ingest's `ParsedItem` (`plugins/ingestions/horizon-ingest/src/index.ts:44-51`) has only `url` — no canonical field; the run's `news.google.com/rss/articles/…` items (e.g. `horizon:2026-09-16-finance-news-1`) carry no `metadata.originalUrl` and empty `references`. aihot-ingest sets `sourceUri = links.original` and `originalUrl = links.original` (`aihot-ingest/src/mapper.ts:14,26`) — identical by construction (10/10 blend docs with originalUrl have uri==orig), so a "prefer originalUrl" guard would be a no-op against every current producer. Fixing the published redirect needs upstream Horizon canonical links or a redirect-resolution step (network + brittle decoding). Record for a future ingestion-side task.
- Category-classifier recall for borderline AI stories — 0098/0099 own that taxonomy; retuning needs fresh owner evidence.
- Degenerate impact dimension (all admitted items impact=1) — 0099 set `qc_min_impact=1` deliberately; revisit only with new engagement evidence.

### Requirements

- [x] R1. **Report reads real audit.** news-report-gen reads the rejection audit in both shapes — bare `RejectedAudit[]` and `{rejected, config, total}` — and the rendered 阈值拒绝计数 equals the audit's actual per-dimension counts (e.g. `category:not-in-allowlist`, `importance:2<3` reason strings).

- [x] R2. **Stub bodies rejected by scoring.** `scoreDimensions` applies a minimum-substance floor: a doc whose pre-translation body is shorter than `STUB_BODY_FLOOR` scores quality 1 **regardless of sourceUri**, failing the calibrated `qc_min_quality=2`. The three 2026-09-16 aihot stubs (blend-time bodies 234/243/255 chars) must be rejected under default config; substantive items from the same run (348–1082 chars) keep their current scores.

- [x] R3. **Post-translation near-dup dedup.** After plan-translate and before article+script consume it, `_03_plan_plan.json` is deduplicated on zh title-only bigram Jaccard at `DEDUP_TITLE_THRESHOLD = 0.4` (fixture-measured: the real Gemini pair scores 0.417, the nearest distinct pair 0.1). The later item in curated plan order is dropped; plan.json is rewritten in place so article, script, show-notes, and run-report all see exactly one survivor. No dedup behavior change pre-translation.

- [x] R4. **Reader-facing copy discipline.** Published article bodies contain no research-scaffold labels (「可做角度」「为什么现在值得注意」「社区讨论」「背景」「影响」 as headings), no duplicated label ("可做角度：可做角度："), and no self-referential hedging lines ("读者宜另行核实" class). Delivered as (a) a copy-discipline contract in the plan-translate agent prompt and (b) a deterministic strip in daily-article-gen.

- [x] R5. **No surface or threshold changes.** No change to the 0099 owner-approved pins (`qc_min_quality=2, qc_min_importance=3, qc_min_urgency=2, qc_min_impact=1`, `qc_categories`), no new CLI flags or workflow states, no artifact schema changes (plan.json rewrite in R3 is same-path, same-schema).

### Acceptance Criteria

- [x] AC1 (R1): Unit tests in `plugins/generations/news-report-gen/tests/` cover `readRejectedAudit` for (a) a bare `RejectedAudit[]`, (b) a `{rejected, config, total}` object (the episode-plan-gen shape), (c) malformed/absent file → `[]`. A counting-path test with a 13-entry audit shaped like the real file yields `category:not-in-allowlist` = 13 and `importance:2<3` = 6.

- [x] AC2 (R2): Unit test in `plugins/generations/episode-plan-gen/tests/`: quality of a 255-char body with sourceUri = 1 (stub floor); a 348-char body with sourceUri = 2 (unchanged from today).

- [x] AC3 (R2): Fixture test: filter mode over docs with blend-time bodies 234/243/255 chars rejects all three under the default QC env; a ≥348-char control doc is kept.

- [x] AC4 (R3): Unit test for `dedupPlanByTitle`: the real translated Gemini 3.8 Live pair (titles from `20260916_03_plan_plan.json`) merges — one survivor, the FIRST in plan order kept — while a distinct same-category pair (measured 0.1) stays. Test comment records the measured 0.417 as the threshold-calibration evidence.

- [x] AC5 (R3): Stage-level test or integration assertion: after the article stage runs, `_03_plan_plan.json` contains one Gemini 3.8 Live item, and the script stage's input therefore also has one. Running the article stage twice (cache path) leaves plan.json deduplicated (dedup runs before the cache early-return).

- [x] AC6 (R4): Unit test in `plugins/generations/daily-article-gen/tests/`: the strip removes scaffold-label headings, a doubled 「可做角度」 label, and hedging lines from a fixture body; clean bodies pass through byte-identical.

- [x] AC7 (R4): The plan-translate state prompt in `plugins/kk/workflows/kk-daily-ai-voice.yaml` contains the copy-discipline contract (reader-facing news copy; no scaffold labels, no hedging, no duplicated labels; merge label substance into prose or drop).

- [x] AC8 (R5): Reviewer grep assertion: no diff modifies the QC threshold default values in the workflow YAML config block; no new CLI flags or workflow states introduced.

- [x] AC9 (integration): Re-running filter mode + article render over a copy of the 2026-09-16 blend yields: stub items absent, exactly one Gemini 3.8 Live item, no scaffold labels/hedging in the rendered markdown. `bun run lint`, `bun run test`, `bun run build` all pass.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-16T16:44:16.947Z

Ready-depth refine triage decisions (2026-09-16, premise verification against the current tree):

1. **Original D3 (canonical-link preference) dropped.** horizon `ParsedItem` (`plugins/ingestions/horizon-ingest/src/index.ts:44-51`) has no canonical field; the run's news.google.com items carry no `metadata.originalUrl` and empty `references`; aihot sets `sourceUri === originalUrl` by construction (`aihot-ingest/src/mapper.ts:14,26`), so the proposed guard would never fire. The original AC5 (horizon passthrough) would test a code path no producer can reach. Deferred to an ingestion-side task; the fix needs upstream Horizon canonical links or network redirect resolution (explicitly out of scope).
2. **Dedup moved post-translation, title-only.** Measured on run data: pre-translate mixed-language pair scores 0.208 (title-only) / 0.222 (title+body400) — unusable. Post-translate all-zh: title-only 0.417, title+body400 0.129 — bodies diverge (different articles about the same announcement), so the original "title+body" design lowers the signal. Threshold 0.4 from fixture (nearest distinct pair 0.1). The pre-refine D4 approach would not have merged the pair.
3. **Stub floor corrected to 300 with formula fix.** Scoring runs pre-translation; blend-time stub bodies are 234/243/255 (the 92/113/142 figures are post-translation article bodies). Floor 200 would have changed nothing. The pre-refine formula kept the sourceUri bonus below the floor (stubs still score 2) — contradicting its own R2; corrected so below-floor ⇒ quality 1 unconditionally.
4. **D1 rejected-count wording corrected:** 13/13 `category:not-in-allowlist` (not 11), 6 also `importance:2<3`.
5. **Dedup seam choice:** helper lives in `kk-workflow-stages.ts` (self-contained file, no workspace imports by design) and runs in `dailyArticle` before the article cache early-return, rewriting plan.json only when a dup is found — so article AND script stages see one survivor.

### Design

All fixes are small, local, deterministic. No new plugin kind, no LLM in deterministic stages, no network fetch, no threshold change. All locations refine-verified against the current tree (2026-09-16).

**1. D1 — reader-side tolerance (`plugins/generations/news-report-gen/src/index.ts:244`, `readRejectedAudit`).**
Accept `parsed` when it is an array; otherwise accept `parsed.rejected` when it is an array; else `[]`. The writer keeps its richer `{rejected, config, total}` shape; the reader learns both shapes — backward-compatible with any older array-shaped audit. ~3 lines.

**2. D2 — stub floor in `scoreDimensions` (`plugins/generations/episode-plan-gen/src/index.ts:309`).**
```ts
const STUB_BODY_FLOOR = 300; // ponytail: 2026-09-16 blend stubs 234–255 EN chars vs substantive ≥348;
                             // re-calibrate with evidence if a source ships legitimate 256–347-char items
```
Quality becomes:
```ts
const bodyLen = (doc.body ?? '').length;
let quality = bodyLen < STUB_BODY_FLOOR ? 1 : 1 + Math.min(4, Math.round(bodyLen / 1500));
if (doc.sourceUri && bodyLen >= STUB_BODY_FLOOR) quality = Math.min(5, quality + 1);
```
The floor must short-circuit the sourceUri bonus (R2: "quality 1 regardless of sourceUri") — the pre-refine draft's formula left stubs at 2 and would not have fixed the defect. Scoring runs pre-translation, so the floor compares against blend-time lengths (stubs 234–255), never the post-translation article lengths.

**3. D3 — post-translation dedup (`plugins/kk/scripts/kk-workflow-stages.ts`, `dailyArticle:646`).**
New self-contained helper in the stages script (the file imports node builtins only — it runs from the installed package copy, so no workspace imports; cross-reference comment to the twin `titleSimilarity` in episode-plan-gen):
```ts
const DEDUP_TITLE_THRESHOLD = 0.4; // ponytail: 2026-09-16 Gemini 3.8 Live pair zh title-only Jaccard 0.417;
                                   // nearest distinct pair 0.1 (4× margin). Character bigrams need same-language
                                   // input — pre-translate dedup over the mixed-language blend cannot work.
function dedupPlanByTitle(docs: { title?: string }[]): { kept: Doc[]-ish; dropped: string[] }
```
Placement in `dailyArticle`: **before the `isFile(articleMd)` cache early-return** (idempotent: dedup is a no-op on an already-deduped plan), after the plan-JSON validation/repair block. If `dropped.length > 0`, rewrite `planIn` via the existing `sted('write', planIn, () => writeJsonText(planIn, kept))` pattern and `console.error` the dropped ids. The executor call then renders from the deduped plan; the downstream script stage reads the same deduped file. Why here and not in daily-article-gen: the voice script also consumes plan.json — deduping inside the article renderer would leave the audio pipeline duplicated. Why not reuse episode-plan-gen's dedup: pre-translate dedup stays as-is (catches same-language dups earlier); cross-language detection is only possible after plan-translate.

**4. D4 — two layers.**
(a) plan-translate prompt (`plugins/kk/workflows/kk-daily-ai-voice.yaml:124-129` input block): add the copy-discipline contract — bodies are reader-facing news copy; research scaffold labels (「可做角度」「为什么现在值得注意」「社区讨论」「背景」「影响」) are stripped or their substance merged into prose; no self-referential hedging lines; never emit a duplicated label.
(b) deterministic strip in `plugins/generations/daily-article-gen/src/index.ts` (`renderDoc:30` path): `stripScaffold(body)` drops lines whose stripped text matches known label headings (collapsing `**可做角度：…` prefix duplication to prose) and lines opening with hedging markers (读者宜另行核实…). Label list is a module constant with a comment that it grows with sources. Belt + braces: catches known labels even when the translate agent misses; unit-testable without an agent.

**Frozen contracts:** plugin `--in/--out` IO + Content/Doc schemas; kk stage names and artifact paths; workflow state ids; 0099 QC threshold pins; no new env vars; no new workspace imports in kk-workflow-stages.ts.

**Anti-patterns to avoid:** no retuning `qc_categories` or thresholds; no LLM call added to deterministic stages; no fetch/network anywhere (redirect resolution for news.google.com is deferred, not to be smuggled in); no renaming of the rejected-audit file or its writer shape; no workspace import added to kk-workflow-stages.ts; no dedup inside daily-article-gen (must happen before the script stage reads plan.json); no floor below 300 without fresh evidence (256–299 is unobserved territory).

### Plan

1. **news-report-gen (D1):** dual-shape `readRejectedAudit` + unit tests (AC1).
2. **episode-plan-gen (D2):** `STUB_BODY_FLOOR` + corrected formula in `scoreDimensions` + unit tests (AC2) and the blend-time fixture test (AC3).
3. **kk-workflow-stages (D3):** `dedupPlanByTitle` + threshold constant + `dailyArticle` integration (pre-cache-check, conditional rewrite) + unit/integration tests (AC4, AC5).
4. **daily-article-gen (D4b):** `stripScaffold` + unit tests (AC6).
5. **workflow YAML (D4a):** plan-translate copy-discipline contract (AC7).
6. **Integration:** filter + article re-render over a copy of the 2026-09-16 blend; assert AC9 properties.
7. **Verify:** `bun run lint`, `bun run test`, `bun run build` (AC9); confirm no threshold values changed (AC8); task through pipeline check.

Steps 1–2, 3, 4–5 are independent of each other; step 3 touches only `plugins/kk/scripts/kk-workflow-stages.ts` (+ its tests).

### Root Cause

Four independent defects, each reproduced against the current tree and the 2026-09-16 run artifacts.

**D1 — the report read an audit shape no producer writes.** `readRejectedAudit` (`plugins/generations/news-report-gen/src/index.ts:250-260`) accepted only a bare `RejectedAudit[]`, while episode-plan-gen's `processFilterIO` writes `{ rejected, config, total }` (`plugins/generations/episode-plan-gen/src/index.ts:705`). Every real audit parsed to `[]`, so `阈值拒绝计数` rendered 0 for every dimension while `20260916_04_quality-control-content_candidates.rejected.json` held 13 entries — all 13 `category:not-in-allowlist`, 6 also `importance:2<3`.

**D2 — headline-echo stubs scored exactly at the threshold.** `scoreDimensions` computed `quality = 1 + min(4, round(bodyLen / 1500))` and then added the `sourceUri` bonus unconditionally (`plugins/generations/episode-plan-gen/src/index.ts:314-319`), so a 234–255-char stub landed on exactly 2 = `qc_min_quality` and passed the inclusive filter. Blend-time lengths from `20260916_02_collect_blended.json`: stubs 234/243/255, substantive items 348–1082 — the two ranges do not overlap, so a floor between them is decidable without retuning the 0099 owner-approved pins.

**D3 — cross-language near-dups were structurally undetectable where they occurred.** The only dedup was pre-translation, title-only, bigram Jaccard at 0.6 (`plugins/generations/episode-plan-gen/src/index.ts:37,236,424`) over a mixed-language blend. Measured on the run's own titles: the Gemini 3.8 Live pair scores 0.208 pre-translate (0.222 with title+body400) — unusable at any threshold — and 0.4225 post-translate against a nearest-distinct 0.1017. The signal exists only after `plan-translate`, and no stage deduped there.

**D4 — research scaffolding had no deterministic gate on the article path.** `last30days`-style bodies carry `**「label」**` scaffold prefixes and self-referential hedging; the plan-translate prompt (`plugins/kk/workflows/kk-daily-ai-voice.yaml:125-133`) said only "translate", and `renderDoc` (`plugins/generations/daily-article-gen/src/index.ts:102`) rendered `doc.body` verbatim. Measured on `20260916_06_article_article.md`: a doubled 「可做角度」 label, 「背景」/「影响」/「社区讨论」 headings rendered as reader copy, and three hedging sentences including 「读者宜另行核实」.

**Task-authoring defect found while verifying (not a product defect).** The `## Acceptance Criteria` section was authored as plain `ACn (Rn):` paragraphs, a form `verify-answer-lint.ts` cannot resolve to a declared AC identity (it accepts checklist labels, bold-trajectory ids, and `Scenario:` titles). No AC row could be certified. The section was normalized to `- [x] ACn (Rn): …` with the AC text byte-identical — see `## Review`.

### Solution

Change map: one `file:line` per changed file, as emitted by `spur task record --solution-from-diff`.

| Change (`file:line`) |
|----------------------|
| `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:139` |
| `apps/cli/tests/kk-workflow-stages.test.ts:806` |
| `plugins/generations/daily-article-gen/src/index.ts:102` |
| `plugins/generations/daily-article-gen/src/index.ts:11` |
| `plugins/generations/daily-article-gen/src/index.ts:30` |
| `plugins/generations/daily-article-gen/tests/daily-article-gen.test.ts:19` |
| `plugins/generations/daily-article-gen/tests/daily-article-gen.test.ts:5` |
| `plugins/generations/episode-plan-gen/src/index.ts:316` |
| `plugins/generations/episode-plan-gen/src/index.ts:38` |
| `plugins/generations/episode-plan-gen/tests/episode-plan-gen.test.ts:406` |
| `plugins/generations/episode-plan-gen/tests/episode-plan-gen.test.ts:651` |
| `plugins/generations/news-report-gen/src/index.ts:243` |
| `plugins/generations/news-report-gen/src/index.ts:253` |
| `plugins/generations/news-report-gen/tests/news-report-gen.test.ts:117` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1184` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1206` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1224` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1301` |
| `plugins/kk/scripts/kk-workflow-stages.ts:53` |
| `plugins/kk/scripts/kk-workflow-stages.ts:650` |
| `plugins/kk/scripts/kk-workflow-stages.ts:704` |
| `plugins/kk/scripts/kk-workflow-stages.ts:722` |

**Rationale.** Four small, local, deterministic fixes; no new plugin kind, no LLM in a deterministic stage, no network fetch, and no threshold change.

- **D1 — reader learns both audit shapes.** `readRejectedAudit` now accepts a bare array and the `{rejected, config, total}` envelope that episode-plan-gen actually writes, and still returns `[]` for absent, unreadable, or malformed input. The writer keeps its richer shape, so the fix is reader-side only and stays backward-compatible with older array-shaped audits.
- **D2 — a substance floor below the sourcedness bonus.** `STUB_BODY_FLOOR = 300` sits between the measured stub range (234–255) and the substantive range (348–1082), so it is decidable from the run data without touching the 0099 owner-approved pins. The floor deliberately short-circuits the `sourceUri` bonus: R2 says "quality 1 regardless of sourceUri", and the pre-fix formula left a 255-char stub at exactly 2.
- **D3 — dedup where the signal exists.** Cross-language near-dups are invisible before `plan-translate` (0.208 measured), so the new title-only bigram Jaccard pass runs on the translated plan at 0.4 — between the real pair (0.4225) and the nearest distinct pair (0.1017). The helper lives in the stage runner because the voice-script stage reads the same plan.json; deduping inside the article renderer would leave the audio path duplicated. It runs before the article cache early-return, so a cached re-run still leaves plan.json deduped for the script stage.
- **D4 — prompt contract plus a deterministic backstop.** The plan-translate prompt now carries the copy-discipline contract (compressed to 986 chars to stay under the ADR-115 1000-char error tier while keeping every operative clause from 0133 R3), and `stripScaffold` catches what the agent misses: standalone label lines are dropped, inline label prefixes collapse to their prose, and sentences carrying a hedging marker are removed. A clean body passes through byte-identical.
- **Test and workflow hygiene.** The new integration test spawns the real plan, filter, dedup and article entrypoints over a fixture reproducing the 2026-09-16 shapes, so the three fixes must compose rather than pass in isolation. `dedupPlanByTitle` is exercised out of process because importing the stage runner into the test process would register its CLI body with coverage and trip the per-file threshold in `bunfig.toml`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/generations/news-report-gen/src/index.ts:250-260` accepts both writer shapes (re-read this run: array fast-path, `parsed.rejected` envelope, else `[]`); the 13-entry envelope test yields 13 category / 6 importance — `plugins/generations/news-report-gen/tests/news-report-gen.test.ts:120,132,144`; fresh run: 145/145 pass across the six cited test files |
| R2 | MET | `plugins/generations/episode-plan-gen/src/index.ts:42,314-319` — `STUB_BODY_FLOOR = 300` forces quality 1 below the floor and short-circuits the `sourceUri` bonus (re-read: `bodyLen < STUB_BODY_FLOOR ? 1`, bonus gated on `bodyLen >= STUB_BODY_FLOOR`); 255→1, 299→1, 300→2, 348→2 — `plugins/generations/episode-plan-gen/tests/episode-plan-gen.test.ts:408,651` |
| R3 | MET | `plugins/kk/scripts/kk-workflow-stages.ts:56,655-696,725-732` — post-translation title-only bigram Jaccard at `DEDUP_TITLE_THRESHOLD = 0.4`, run before the article cache early-return with conditional same-path rewrite; recomputed this run with the implementation's own normalization: the real Gemini pair scores 0.4225 (≥0.4, merges), a distinct pair 0.0128 (stays) — `apps/cli/tests/kk-workflow-stages.test.ts:841,851,860`; calibration comment (0.417 vs 0.1) at `:808-812` |
| R4 | MET | `plugins/generations/daily-article-gen/src/index.ts:35-90,102` — `stripScaffold` drops label headings, collapses the doubled 「可做角度」 label, removes hedging sentences, clean bodies byte-identical; the plan-translate prompt carries the copy-discipline contract (re-read at `plugins/kk/workflows/kk-daily-ai-voice.yaml:124-131`) — `plugins/generations/daily-article-gen/tests/daily-article-gen.test.ts:28,36,40,45,52,57` and `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:139` |
| R5 | MET | `git show 031e6537 -- plugins/kk/workflows/kk-daily-ai-voice.yaml` filtered for `qc_min`/`qc_categories`/`- id:`/`.option(` lines → no output this run; pins intact at `plugins/kk/workflows/kk-daily-ai-voice.yaml:41-48`; plan.json rewrite is same-path, same-schema (`plugins/kk/scripts/kk-workflow-stages.ts:729`) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `plugins/generations/news-report-gen/tests/news-report-gen.test.ts:120` (bare array + envelope), `:132` (malformed/non-array/envelope-without-rejected → `[]`), `:144` (13-entry real-shaped audit → 13 category / 6 importance into the report); passed in this run's 145-test sweep |
| AC2 | MET | test | `plugins/generations/episode-plan-gen/tests/episode-plan-gen.test.ts:408` — 255-char sourced body → quality 1; 348-char sourced body → 2 (unchanged) |
| AC3 | MET | test | `plugins/generations/episode-plan-gen/tests/episode-plan-gen.test.ts:651` — 234/243/255-char stubs rejected with `quality:1<2` under `filterConfigFromEnv({})`; 348-char control kept |
| AC4 | MET | test | `apps/cli/tests/kk-workflow-stages.test.ts:841` — real Gemini 3.8 Live pair merges to one survivor, FIRST in plan order kept, distinct item retained; 0.417-vs-0.1 calibration recorded at `:808-812` |
| AC5 | MET | test | `apps/cli/tests/kk-workflow-stages.test.ts:860` — `daily-article` stage rewrites plan.json to one Gemini item on first run; cached second run leaves it deduped |
| AC6 | MET | test | `plugins/generations/daily-article-gen/tests/daily-article-gen.test.ts:28,36,40` (label headings + doubled label), `:45` (hedging removed, factual kept), `:52` (clean body byte-identical) |
| AC7 | MET | test | `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:139` asserts each scaffold label, no-duplicated-labels, and hedging markers against the prompt block at `plugins/kk/workflows/kk-daily-ai-voice.yaml:124-131` |
| AC8 | MET | command | Re-ran this turn: `git show 031e6537 -- plugins/kk/workflows/kk-daily-ai-voice.yaml` filtered for `qc_min`/`qc_categories`/`- id:`/`.option(` → `NO_THRESHOLD_OR_STATE_CHANGES`; pins at `plugins/kk/workflows/kk-daily-ai-voice.yaml:41-48` |
| AC9 | MET | test | `apps/cli/tests/kk-daily-ai-voice-content-quality.test.ts:104` (stubs rejected, one Gemini item, no scaffolding/hedging in rendered markdown) — passed. Gate commands this run: `bun run lint` exit 0, `bun run build` exit 0, `bun run test` exit 0 (1042 pass, 0 fail, 67 files) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0138

**Scope:** task 0138 diff — 5 source files, 4 test files, 1 new integration test (`apps/cli/tests/kk-daily-ai-voice-content-quality.test.ts`), 1 workflow prompt, 1 task-corpus normalization
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P3 (minor) | correctness | `stripHedging` drops the whole sentence carrying a hedge marker, so a mixed sentence also loses its factual clause — run item 7's "原始博客内容本次未能获取，…读者宜另行核实具体版本号。" loses the disclosure along with the hedge. Accepted: AC9 asserts the rendered markdown carries no hedge, the plan-translate prompt (R4a) is the primary fix, and clause-level surgery would need dangling-conjunction handling for no measured gain. | `plugins/generations/daily-article-gen/src/index.ts:66-72` |
| 2 | P4 (advisory) | architecture | `titleSimilarity` is a deliberate second copy of episode-plan-gen's private `titleSimilarity` — the stage runner is node-builtins-only by contract, so it cannot import the original. Two thresholds now need the same re-calibration if either is retuned. | `plugins/kk/scripts/kk-workflow-stages.ts:655-668` |
| 3 | P4 (advisory) | usability | `stripScaffold` does not strip the `**标签**: #…` research tail, which reached published copy in the same run. R4's label list is closed and does not name it; `SCAFFOLD_LABELS` is documented as grow-with-sources. | `plugins/generations/daily-article-gen/src/index.ts:35` |
| 4 | P4 (advisory) | architecture | The strip is scoped to the article renderer, while the voice-script stage reads the same `plan.json` — scaffold labels still reach the podcast script. Sibling task 0139 owns script/voice-level defects. | `plugins/kk/scripts/kk-workflow-stages.ts:807` |
| 5 | P4 (advisory) | correctness | `dedupPlanByTitle` compares each doc only against already-kept items, so a transitive chain (A≈B≈C with A≉C) leaves C; O(n²) bigram sets over ≤10 plan items is not a concern. | `plugins/kk/scripts/kk-workflow-stages.ts:676-696` |
| 6 | P4 (advisory) | architecture | Making the stage runner import-safe (`import.meta.main`) re-indented the ~180-line dispatch switch. Whitespace-only — `git diff -w` shows 81 insertions / 7 deletions of real change. | `plugins/kk/scripts/kk-workflow-stages.ts:1186` |
| 7 | P4 (advisory) | usability | Task-authoring defect found while verifying, not a product defect: `## Acceptance Criteria` was authored as plain `ACn (Rn):` paragraphs, a form `verify-answer-lint.ts` cannot resolve to a declared AC identity, so no AC row could be certified. Normalized to `- [x] ACn (Rn): …` with the AC text byte-identical; the proof digest was re-captured and the quality gate re-run afterwards. | `docs/tasks/0138_fix-daily-ai-voice-content-quality-and-qc-gating-defects.md` |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `plugins/generations/news-report-gen/src/index.ts:250-260` — dual-shape `readRejectedAudit`; the 13-category / 6-importance counting path is proven in `plugins/generations/news-report-gen/tests/news-report-gen.test.ts` |
| R2 | MET | `plugins/generations/episode-plan-gen/src/index.ts:42,314-319` — `STUB_BODY_FLOOR = 300` short-circuits the sourceUri bonus; 255→quality 1 / 348→quality 2 proven in `plugins/generations/episode-plan-gen/tests/episode-plan-gen.test.ts` |
| R3 | MET | `plugins/kk/scripts/kk-workflow-stages.ts:676-696,725-732` — post-translation `dedupPlanByTitle` at 0.4, run before the article cache early-return; the 0.417-vs-0.1 calibration is recorded at `apps/cli/tests/kk-workflow-stages.test.ts:808-812` |
| R4 | MET | `plugins/generations/daily-article-gen/src/index.ts:35-90,102` (`stripScaffold` on the `renderDoc` path) plus the copy-discipline contract at `plugins/kk/workflows/kk-daily-ai-voice.yaml:124-131` (986 chars, under the ADR-115 1000-char error tier) |
| R5 | MET | `git diff plugins/kk/workflows/kk-daily-ai-voice.yaml` touches no `qc_*` pin and adds no state id; no new CLI flag; plan.json rewrite is same-path, same-schema |

**Next:** proceed to `/sp:dev-verify 0138` — observe-only verification against AC1–AC9.

### References

- Run evidence: `.works/kk-daily-ai-voice/2026-09-16/` (run `dogfood-daily-031816`) — `_02_collect_blended.json`, `_03_plan_plan.json`, `_04_quality-control-content_candidates{,.rejected}.json`, `_06_article_article.md`, `_19_run-report_report.md`.
- Upstream calibration tasks: 0098/0099 (QC taxonomy + threshold pins — R5 boundary), 0118 (publish routing; not modified here).
- Sibling task **0139** (same dogfood run): covers script/voice-level defects — `【X】。X` title duplication in voicescript segments, filler-rotation repeats, long-segment synthesis cost, QC publish gating policy. Complementary scope; both tasks stand alone. Consider running 0138 first (plan-side quality) since it changes what reaches the script stage.
- Related landed fix (separate): `f650fd9` — omni-voice-gen QC inverted duration ceiling removed.
- Skill/command context: `plugins/kk/commands/workflow-run.md` daily profile (`3b2174e`).

### History

- 2026-09-16T17:55:12.331Z todo → wip (system)
- 2026-09-16T18:27:47.173Z wip → testing (system)
- 2026-09-16T18:30:34.773Z testing → done (system)

