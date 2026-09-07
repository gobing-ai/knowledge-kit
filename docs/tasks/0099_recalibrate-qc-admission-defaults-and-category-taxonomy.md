---
schema_version: 1
name: Recalibrate QC admission defaults and category taxonomy
status: done
template: feature-impl
created_at: 2026-09-07T05:49:50.184Z
updated_at: "2026-09-07T21:31:46.172Z"
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
|-------------|--------|----------|
| R1 | MET | qc_min_quality 3→2 and qc_min_impact 2→1 in lockstep at both sites: workflow YAML `qc_min_quality "2"` :44, `qc_min_impact "1"` :47; plugin DEFAULT_FILTER_CONFIG with rationale comment (episode-plan-gen/src/index.ts#7CFB :59-61); env wins over defaults so both sites must move together — done |
| R2 | MET | Taxonomy repaired: TAG_CATEGORY expanded beyond the 12 MECE v1 entries (OpenAI/AI/coding-agents/major-lab adjacency) #7CFB :63-89; junk keyword group :101-107 excludes low-signal posts from ai-industry |
| R3 | MET | horizon-ingest collect timeout 30m → 45m via `--source-timeout-override "horizon-ingest:2700000"` (YAML:79), knob at the workflow collect state; resolution order fanin.ts#5047 :362-365 (task text :313-317 — line drift, content confirmed) |
| R4 | MET | Regression coverage + docs: r7 replay :948-966 (impact-1/quality-4 now ADMITTED; prior rejections re-scored; junk excluded); fanin 42/0, workflow 5/0, episode-plan-gen 53/0 fresh; docs/04_DESIGN.md QC rows :294-295 updated |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R3 — Every blended candidate is annotated with category and dimension scores | MET | command | bun test plugins/generations/episode-plan-gen → 53 pass / 0 fail (this session, incl. expanded taxonomy :948-966); live: junk/archives excluded with reasons in 0098 r2 |
| R4 — Quality-controller filters candidates by category allowlist and score thresholds | MET | command | Calibration pinned YAML:44/:47 + plugin defaults in lockstep; 53/0 + 42/0 + 5/0 fresh this session; live: same-day horizon item admitted, below-threshold rejected (2<3 importance ×11) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | Owner-approved 2/3/2/1 defaults documented at both config sites (DEFAULT_FILTER_CONFIG comment + docs/04_DESIGN.md:294-295); timeout knob at the workflow fan-in invocation per design |
| P4 | evidence-rule-pass | — | Every row carries a test command run this session or a YAML/source anchor re-read this session |
| P4 | ac-boxes | — | AC rows use exact feature scenario titles `R3 — Every blended candidate is annotated with category and dimension scores` and `R4 — Quality-controller filters candidates by category allowlist and score thresholds` |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- Builder sp-super-coder (run f5a9cb81) implemented calibration for RID 0098-50526: QC defaults 3/3/2/2 → 2/3/2/1 in lockstep (plugin DEFAULT_FILTER_CONFIG + YAML QC_* pins), taxonomy +16 tags with junk keyword guard (empirical A/B: 5 intended flips, 0 unintended), new fan-in knob --source-timeout-override with horizon-ingest:2700000 pin, 6 new/updated tests (634/0), docs synced. PASS verdict recorded (R1–R4 MET; coverage row = feature R4 title).
- 2026-09-07T06:39:36.507Z wip → testing (system)
- 2026-09-07T06:39:36.859Z testing → done (system)
