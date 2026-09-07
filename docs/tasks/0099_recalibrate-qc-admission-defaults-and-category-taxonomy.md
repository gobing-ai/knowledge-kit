---
schema_version: 1
name: Recalibrate QC admission defaults and category taxonomy
status: done
template: feature-impl
created_at: 2026-09-07T05:49:50.184Z
updated_at: "2026-09-07T06:39:36.859Z"
feature_id: L1

---

## 0099. Recalibrate QC admission defaults and category taxonomy

### Background

0098's dogfood (honest FAIL, `.spur/run/0098-verdict.json`) proved every pipeline mechanism but exposed a shipped-defaults calibration defect: the post-0097 pipeline cannot emit an episode on a live corpus. Evidence: 20/20 real candidates rejected at qcc (r7, healthy 62-doc corpus); the two strongest ai-news items (quality 4, urgency 5) died solely on `impact:1<2`; a genuine OpenAI item was categorized `non-ai` by the 12-entry tag map; a YouTube error-log post classified INTO ai-industry. Secondary: horizon-ingest latency growth (r4 20m40s → 28m39s solo) straddles the 30m per-source timeout, making empty episodes stochastic. Owner approved evidence-derived recalibration (2026-09-07); R9 re-dogfood depends on this task.

### Requirements

R1. QC admission defaults recalibrated to owner-approved values: `qc_min_impact` 2→1 and `qc_min_quality` 3→2 (discussion-tier last30days content may pass solo). Plugin shipped defaults (0094 DEFAULT_FILTER_CONFIG) AND the workflow YAML `QC_*` pins (0097 kk-daily-ai-voice.yaml — env wins over defaults, so both sites must move together) updated in lockstep, with the rationale documented at both sites.
R2. Category taxonomy repaired: tag map expanded beyond the 12 MECE v1 entries (OpenAI, AI/coding-agents, and adjacent major-lab tags) so genuine AI items stop defaulting to `non-ai`; keyword/classification audit so low-signal junk (e.g. a YouTube error-log post) is excluded from ai-industry rather than absorbed.
R3. horizon-ingest headroom: the collect fan-in source timeout for horizon raised from the 30m default to ≥45m (measured 28m39s solo, growing), knob located at the workflow/plugin timeout site for 0097's collect state.
R4. Regression coverage + docs: unit tests locking the new defaults (an impact-1/quality-4/urgency-5 item now ADMITTED; the previously-rejected r7 items re-scored against new config), taxonomy cases (OpenAI item → ai-news/ai-industry; junk → excluded/non-ai), and `docs/04_DESIGN.md` + relevant design docs updated for the new defaults, taxonomy entries, and horizon timeout.

### Acceptance Criteria

```gherkin
Feature: Recalibrate QC admission defaults and category taxonomy

  Scenario: Quality-controller filters candidates by category allowlist and score thresholds
    Given the owner-approved calibration values (qc_min_impact 1, qc_min_quality 2, expanded tag map, horizon source timeout ≥45m) shipped in both the plugin defaults and the workflow QC_* pins
    When a healthy live-style corpus is filtered — including the strongest r7 dogfood item (quality 4, urgency 5, impact 1), a genuine OpenAI announcement, discussion-tier last30days content, and a low-signal junk post
    Then the strong AI-news items are admitted on the new thresholds, the OpenAI item categorizes into an AI category instead of non-ai, the junk post does not classify into ai-industry, and the horizon source timeout no longer straddles measured ingest latency
    And unit tests lock each behavior, the r7 rejected.json items re-score against the new config, and docs/04_DESIGN.md records the shipped values
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-07T05:50:51.266Z

- CLOSED (owner, 2026-09-07): adopt evidence-derived values as proposed — qc_min_impact 2→1; qc_min_quality 3→2 (discussion-tier solo content may pass); tag map expansion + keyword audit; horizon timeout ≥45m. Chosen from 0098 dogfood evidence (20/20 rejections, impact-1 best items, OpenAI→non-ai, junk→ai-industry, 28m39s latency).
- CLOSED (scope): pipeline mechanics are NOT reopened — this is parameter + taxonomy + timeout calibration only; state machine, fan-in, and publish seams stay as landed by 0092–0097.
- CLOSED (verification split): 0099 proves calibration at unit level (R4 scenario); R9's end-to-end re-verification belongs to the 0098 re-dogfood, not this task.

### Design

WHAT: Parameter/taxonomy/timeout calibration across the QC admission path — no state-machine or pipeline-structure changes.

WHERE:

- Plugin defaults: 0094's DEFAULT_FILTER_CONFIG (episode-plan-gen QC filter defaults — qc_min_quality 3→2, qc_min_impact 2→1) and its category tag map / keyword classification tables (0093 MECE v1: expand tags, tighten junk admission into ai-industry).
- Workflow pins: plugins/kk/workflows/kk-daily-ai-voice.yaml QC_* env vars on the quality-control-content state (0097) — same value moves, single-line diffs, keep explicit-in-YAML pattern.
- Timeout: the per-source timeout knob for horizon in the collect fan-in (0097 YAML source args or plugin source config — locate the exact site the 30m default comes from) → ≥45m for horizon only.
- Tests: workspace tests next to the changed modules; reuse r7 rejected.json excerpts as fixtures (scores 4/3/5/1 impact-rejected item; OpenAI item; junk YouTube post).
- Docs: docs/04_DESIGN.md QC defaults + taxonomy + timeout rows; docs/design/episode-plan-gen.md if it restates defaults.

WHY: 0098 P1 — shipped defaults reject 100% of live candidates; pipeline cannot emit an episode until calibrated. Values are owner-approved editorial policy, not derivable.

CONSTRAINTS: surgical diffs at the named sites only; no restructure of 0097's YAML; no new dependencies; keep both default sites in lockstep (env-wins precedence means a half-move is silent and wrong).

### Plan

1. Locate and move the QC default values at both sites (plugin + YAML pins). 2. Expand taxonomy tag map + audit keyword/junk classification. 3. Raise horizon source timeout. 4. Add/extend unit tests incl. r7 fixture re-scoring. 5. Docs sync. 6. Full gates + verify + verdict.

### Solution

Calibration-only change across the QC admission path; no state-machine or pipeline-structure changes.

**R1 — QC defaults 3/3/2/2 → 2/3/2/1 in lockstep at both sites (env-wins precedence makes lockstep load-bearing):**

- `plugins/generations/episode-plan-gen/src/index.ts:543-554` — `DEFAULT_FILTER_CONFIG`: `minQuality: 2` (`:550`), `minImpact: 1` (`:553`), 0098-dogfood rationale `:545-549`; docstring "defaults 2/3/2/1 — 0099 recalibration" `:21`. importance 3 / urgency 2 unchanged.
- `plugins/kk/workflows/kk-daily-ai-voice.yaml:41-47` — pins `qc_min_quality: "2"` (`:44`), `qc_min_impact: "1"` (`:47`) + rationale `:41-43`; consumed by qcc at `:113`.

**R2 — taxonomy repair, data edits only (no classification machinery change):**

- `plugins/generations/episode-plan-gen/src/index.ts:63-84` — `TAG_CATEGORY` +16 entries: `ai`, `artificial-intelligence`, `generative-ai`, `genai`, `llm`, `llms`, `openai`, `anthropic`, `deepmind`, `google-deepmind`, `meta-ai`, `mistral`, `xai`, `coding-agents`, `'coding agent'` → ai-news; `alignment` → ai-research.
- `plugins/generations/episode-plan-gen/src/index.ts:100-107` — ingest-junk keyword group at the head of `CATEGORY_KEYWORDS` (`non-ai` ← `'error:'` / `'http error'` / `'unable to download'`) so error-log posts cannot classify INTO ai-industry.
- Empirical old-vs-new A/B audit (reverted-module diff over the r6 15-doc fixture corpus + r7 20-doc dogfood audit): exactly 5 flips, all intended (4 genuine AI items non-ai→ai-news via lab/LLM tags; yt-dlp junk ai-industry→non-ai), 0 unintended.

**R3 — per-source fan-in timeout knob (pre-authorized scope), pinned for horizon only:**

- `apps/cli/src/fanin.ts` — `FaninOptions.sourceTimeoutOverrides` (`:39-40`); parseArgs branch `:193-213` (strict `<plugin>:<positive-int>`, once per plugin); validation `:233-240` (must name a `--source`; violations exit 2); per-source resolution `:313-317` (override > `--source-timeout` > 30m default `:49`).
- `apps/cli/src/commands/executor.ts` — registered on `fan-in` (`:163-166`) and the hidden `fanin` alias (`:207-210`); collector `collectOverride` `:101-104`; argv passthrough `:84-86`; option field `:20`.
- `plugins/kk/workflows/kk-daily-ai-voice.yaml:74-79` — `--source-timeout-override "horizon-ingest:2700000"` (45m; horizon solo measured 28m39s in 0098 r7 and straddled the 30m default). aihot/last30days keep the default.

**R4 — regression coverage + docs:**

- Fixture `plugins/generations/episode-plan-gen/tests/fixtures/r7-rejected-excerpt.json` — 3 verbatim docs from `.spur/run/daily-dogfood-20260906-r3/2-plan/candidates.rejected.json`.
- `plugins/generations/episode-plan-gen/tests/episode-plan-gen.test.ts` — r7 replay describe `:937-972` (flagship 4/3/5/1 ADMITTED; OpenAI item → ai-news; junk → non-ai); defaults locked `:575`, `:578-584`, `:614`; reasons-accumulate `:664-682`; r6 partition rewritten to the exact new outcome `:899-935`.
- `apps/cli/tests/fanin.test.ts` — override extends past global leash `:457`, tightens without global flag `:491`, usage errors `:726-743`.
- `apps/cli/tests/commands/executor.test.ts` — both registrations `:47-70`; end-to-end flag parse through `main()` → exit 2 `:188-210`.
- `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts` — calibrated pins `:70-76`; horizon override pin `:93`.
- `docs/04_DESIGN.md` — fan-in synopsis `:139`, `--source-timeout-override` option row `:147` (28m39s rationale), QC defaults row `:295`; `docs/design/episode-plan-gen.md` — defaults `:40`, tag map `:57-63`, junk group `:64-77`, calibrated mins `:98-103`, r6/r7 replay invariant `:103-111`.

**Deviations (both within the approved calibration scope):** knob named `--source-timeout-override` (explicit override semantics vs a scoped global); junk tightening implemented as data rows mapping to `non-ai` rather than new machinery. Bare `coding` / `frontier` / `ai-ethics` / Chinese tag variants deliberately not added (unambiguous-sibling-only taxonomy policy; residual gap noted in Testing).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | QC admission defaults moved 3/3/2/2 → 2/3/2/1 in lockstep at both sites with the 0098-dogfood rationale documented at each: plugin shipped defaults `DEFAULT_FILTER_CONFIG` (`plugins/generations/episode-plan-gen/src/index.ts:543-554` — `minQuality: 2` `:550`, `minImpact: 1` `:553`, rationale `:545-549`; docstring "defaults 2/3/2/1 — 0099 recalibration" `:21`) and workflow pins (`plugins/kk/workflows/kk-daily-ai-voice.yaml:44` `qc_min_quality: "2"`, `:47` `qc_min_impact: "1"`, rationale `:41-43`), consumed by qcc at `:113` (`EPISODE_PLAN_MODE=filter QC_MIN_QUALITY=… QC_MIN_IMPORTANCE=… QC_MIN_URGENCY=… QC_MIN_IMPACT=…` — env wins over defaults, so the lockstep is load-bearing); importance 3 / urgency 2 unchanged at both sites; env parsing unchanged (non-integer/out-of-range exits 1, never clamps) |
| R2 | MET | Taxonomy repaired, data edits only: `TAG_CATEGORY` expanded from the v1 map with 16 new entries (`plugins/generations/episode-plan-gen/src/index.ts:63-84` — `ai`, `artificial-intelligence`, `generative-ai`, `genai`, `llm`, `llms`, `openai`, `anthropic`, `deepmind`, `google-deepmind`, `meta-ai`, `mistral`, `xai`, `coding-agents`, `'coding agent'` → ai-news; `alignment` → ai-research) and an ingest-junk keyword group placed at the head of `CATEGORY_KEYWORDS` (`:100-107` — `non-ai` ← `['error:', 'http error', 'unable to download']`, before technical/news/industry groups) so error-log posts can no longer classify INTO ai-industry; empirical old-vs-new audit across the r6 fixture corpus (15 docs) and the r7 dogfood audit corpus (20 docs) using a reverted-module A/B diff: exactly 5 flips, all intended (4 genuine AI items non-ai→ai-news via lab/LLM tags; the yt-dlp error-log junk ai-industry→non-ai), 0 unintended flips; keyword groups still deliberately exclude lab names (tags carry lab identity, MECE v1 invariant preserved) |
| R3 | MET | Per-source fan-in timeout knob added at the located timeout site and pinned for horizon only: `--source-timeout-override <plugin>:<ms>` (`apps/cli/src/fanin.ts` — option `:39-40`, strict parse `:193-213` (`<plugin>:<positive int>`, once per plugin), validation `:233-240` (requires a matching `--source`; violations throw → exit 2), per-source resolution `:313-317` override > global `--source-timeout` > 30m default `:49`); registered on both commands (`apps/cli/src/commands/executor.ts:163-166` fan-in, `:207-210` hidden `fanin` alias; collector `:101-104`, argv passthrough `:84-86`); workflow pin `plugins/kk/workflows/kk-daily-ai-voice.yaml:79` `--source-timeout-override "horizon-ingest:2700000"` (45m; horizon solo ran 28m39s in 0098 r7 and straddled the 30m default) with rationale `:74-76` — aihot/last30days keep the 30m default |
| R4 | MET | Regression coverage + docs: fixture `plugins/generations/episode-plan-gen/tests/fixtures/r7-rejected-excerpt.json` (3 verbatim docs from `.spur/run/daily-dogfood-20260906-r3/2-plan/candidates.rejected.json`); r7 replay suite `plugins/generations/episode-plan-gen/tests/episode-plan-gen.test.ts:937-972` (3 tests — flagship impact-1/quality-4/urgency-5 item ADMITTED with re-derived scores; OpenAI coding-agents item → ai-news; yt-dlp junk → non-ai with `category:not-in-allowlist`); defaults locked at `:575` (`atMins {2,3,2,1}`), `:578-584` (shape), `:614` (test name), `:664-682` (all five reasons under new mins); r6 replay updated to the exact new partition `:899-935`; fan-in override tests `apps/cli/tests/fanin.test.ts:457` (extends past global leash), `:491` (tightens below default), `:726-743` (usage errors); executor contract `apps/cli/tests/commands/executor.test.ts:47-70` (both registrations) + `:188` (end-to-end parse → exit 2); workflow contract `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:70-76` (pins 2/3/2/1) + `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:93` (horizon 45m pin); docs record shipped values (`docs/04_DESIGN.md:139,147,295`; `docs/design/episode-plan-gen.md:40,57-77,98-111`) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| R4 — Quality-controller filters candidates by category allowlist and score thresholds | MET | command | Full gate `NODE_ENV=test bun run test` → exit 0, 634 pass / 0 fail, 2607 expect(), 44 files (baseline 628 + 6 new/updated tests); the qcc path (allowlist + inclusive mins) is exercised through the plugin filter seam with the workflow pins asserted by the workflow contract test |
| Strongest r7 item (quality 4, urgency 5, impact 1) admitted on the new thresholds | MET | command | `NODE_ENV=test bun test plugins/generations/episode-plan-gen/tests/episode-plan-gen.test.ts` → 53 pass / 0 fail; "r7 replay: flagship impact-1 item is admitted under the recalibrated defaults (0099)" passes — item kept with re-derived scores 4/3/5/1 at mins {2,3,2,1}; live-data replay (planDate 2026-09-06 through planEpisode + filterAnnotated) keeps it plus "An Alien Mind" |
| Genuine OpenAI item categorizes into an AI category (not non-ai) | MET | command | Same suite: "r7 replay: OpenAI-tagged announcement classifies into ai-news (0099)" passes; old-vs-new A/B audit shows the four r7 OpenAI/LLM-tagged items flip non-ai → ai-news via the new tag map |
| Low-signal junk post does not classify into ai-industry | MET | command | Same suite: "r7 replay: ingest junk (yt-dlp error log) does not classify into ai-industry (0099)" passes — rejected `non-ai` with reasons `['category:not-in-allowlist','importance:2<3']`; A/B audit confirms the junk flip ai-industry → non-ai is the only junk-side change (0 unintended flips across 35 audited docs) |
| Horizon source timeout ≥45m; no longer straddles measured ingest latency | MET | command | `grep -n 'source-timeout-override "horizon-ingest:2700000"' plugins/kk/workflows/kk-daily-ai-voice.yaml` → match at `:79` (45m ≥ 45m floor; horizon measured 28m39s solo in 0098 r7); resolution order override > global > 30m default anchored at `apps/cli/src/fanin.ts:313-317` (`:49` default); behavioral coverage: `bun test apps/cli/tests/fanin.test.ts` 27/0 (override extends/tightens one source) + workflow contract pins the exact string (`apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:93`) |
| Owner-approved values shipped in BOTH the plugin defaults and the workflow QC_* pins (lockstep) | MET | command | `grep -n 'minQuality: 2' plugins/generations/episode-plan-gen/src/index.ts` → `:550` and `grep -n 'minImpact: 1' …` → `:553` (shipped defaults); `grep -n 'qc_min_quality: "2"' plugins/kk/workflows/kk-daily-ai-voice.yaml` → `:44` and `grep -n 'qc_min_impact: "1"' …` → `:47` (workflow pins) — all four match, both sites lockstep; qcc consumes the pins at `:113` (env wins over defaults) |
| Unit tests lock each behavior; r7 rejected.json items re-scored against the new config | MET | command | Fan-in override suite `NODE_ENV=test bun test apps/cli/tests/fanin.test.ts` → 27 pass / 0 fail (override extends/tightens one source; usage errors exit 2); executor contract `bun test apps/cli/tests/commands/executor.test.ts` → 15 pass / 0 fail; workflow contract `bun test apps/cli/tests/kk-daily-ai-voice-workflow.test.ts` → 5 pass / 0 fail; r6 replay partition re-scored exactly (`plugins/generations/episode-plan-gen/tests/episode-plan-gen.test.ts:899-935`) and r7 excerpt re-scored (`:937-972`) |
| docs/04_DESIGN.md records the shipped values | MET | command | `grep -n 'defaults`2`/`3`/`2`/`1`' docs/04_DESIGN.md` → `:295` and `grep -n 'defaults 2/3/2/1' docs/design/episode-plan-gen.md` → `:40` — shipped QC values recorded in both docs; `grep -n '--source-timeout-override' docs/04_DESIGN.md` → `:139,147` (option row incl. the 28m39s rationale); design doc also carries tag-map expansion + ingest-junk group `:57-77` and r7 replay invariant `:98-111` |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- Builder sp-super-coder (run f5a9cb81) implemented calibration for RID 0098-50526: QC defaults 3/3/2/2 → 2/3/2/1 in lockstep (plugin DEFAULT_FILTER_CONFIG + YAML QC_* pins), taxonomy +16 tags with junk keyword guard (empirical A/B: 5 intended flips, 0 unintended), new fan-in knob --source-timeout-override with horizon-ingest:2700000 pin, 6 new/updated tests (634/0), docs synced. PASS verdict recorded (R1–R4 MET; coverage row = feature R4 title).
- 2026-09-07T06:39:36.507Z wip → testing (system)
- 2026-09-07T06:39:36.859Z testing → done (system)
