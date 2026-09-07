---
schema_version: 1
name: "Dogfood the redesigned pipeline end-to-end"
status: done
template: feature-impl
created_at: 2026-09-06T14:35:05.255Z
updated_at: "2026-09-07T20:51:05.319Z"
feature_id: L1
priority: P2
tags: ["dogfood", "feature-K"]
dependencies: ["0097"]
---

## 0098. Dogfood the redesigned pipeline end-to-end

### Background

Feature L1 R9 (edge): the redesign is proven only by replaying the dogfood scenario that motivated it — the 2026-09-06 corpus with archive pollution must still yield a clean 4-item episode, now through the new seams.

### Requirements

R1. Full pipeline run on fresh daily corpus with publish enabled.
R2. Assert: plan contains only fresh AI-news candidates; rejected.json audit exists; zh article + podcast episode publish; en/ja locales sync.
R3. Assert failure routes: fixture run with all-below-threshold corpus terminates done-no-content.
R4. Report appended to .spur/run/dogfood/ with wall-time comparison vs r6 (expect collect ≈ max(source times), not sum).

### Acceptance Criteria

```gherkin
Feature: Dogfood the redesigned pipeline end-to-end

  Scenario: Redesigned pipeline reproduces the r6 dogfood outcome end-to-end
    Given the redesigned post-0097 kk-daily-ai-voice pipeline and real services only (no mocks for aihot, horizon, microfeed, or surfdash)
    When the pipeline runs end-to-end from a fresh work dir with publish enabled, and a fixture run with an all-below-threshold corpus starts from a separate fresh work dir
    Then the main run's published episode contains only fresh AI news — no aihot archives and no geopolitics items
    And the fixture run terminates at done-no-content with zero 2-article, 2-script, and 3-audio artifacts
    And the dogfood report in .spur/run/dogfood/ records a pass/fail line per assertion
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

WHAT: End-to-end dogfood of the redesigned kk-daily-ai-voice pipeline (post-0097). No production code — this is an operator-run verification task.

WHY: Feature L1 R9 — the redesign is only proven by replaying the scenario that motivated it (2026-09-06 pollution incident) through the new seams.

WHERE (frozen):

- Run dir: `.spur/run/daily-dogfood-<YYYYMMDD>/` (fresh date dir; do NOT reuse daily-dogfood-20260906 — its caches would mask regressions).
- Command: `spur workflow run plugins/kk/workflows/kk-daily-ai-voice.yaml --vars '{"work_dir":"…","skip_review":"true","transcode_mp3":"true","publish_enabled":"true","cover_enabled":"true","plan_translate_enabled":"true","agent":"auto"}' --run-id dogfood-<date>-r1 --json`
- Report: append to `.spur/run/dogfood/daily-ai-news-<date>.md` (same file family as daily-ai-news-20260905-r2.md).

Verification assertions (each with evidence):

1. collect state wall time ≈ max(source times), not sum (compare against r6's sequential timings: aihot ~2s, horizon ~20m).
2. quality-control-content emits candidates.json + candidates.rejected.json; rejected entries carry reasons.
3. Plan contains only fresh AI-news candidates (no aihot archives, no geopolitics).
4. show-notes.md produced by podcast-pub op (no inline bun -e); publish via new seams.
5. Empty-corpus fixture run (craft all-below-threshold input) terminates at done-no-content with zero 2-article/2-script/3-audio artifacts.
6. Publish: surfdash zh post live; podcast episode requires microfeed API up (note: D1 free-tier daily row-read quota was exhausted 2026-09-05 → if it recurs, record as external, not a pipeline failure).

Anti-patterns: no mocks for aihot/horizon/microfeed/surfdash (dogfood = real services); no cache reuse from prior run dirs; no skipping the empty-corpus leg.

Depends on: 0097 (the redesigned YAML must exist and validate).

### Plan

1. Run redesigned workflow with publish_enabled=true. 2. Verify artifacts + published surfaces. 3. Run empty-candidate fixture. 4. Append dogfood report.

### Solution

Operator-run verification task — **no production code changed** (frozen scope honored; HEAD 47fee69 with the uncommitted 0092–0097 redesign exercised as-is).

Change map (verification artifacts only):

- Runs executed with the frozen command + vars verbatim (`skip_review/transcode_mp3/publish_enabled/cover_enabled/plan_translate_enabled/agent=auto`; qc_* left at shipped defaults):
  - Main r1: run-id `dogfood-20260906-r1`, work dir `.spur/run/daily-dogfood-20260906-r2/` (fresh), log `.spur/run/dogfood-20260906-r1.log` — terminal `done-no-content` (horizon-ingest 30m source timeout; 18 last30days candidates all rejected by qcc).
  - Retry r7: run-id `dogfood-20260906-r7`, work dir `.spur/run/daily-dogfood-20260906-r3/` (fresh), logs `.spur/run/dogfood-20260906-r7.log` + `.spur/run/0098-r7-stdout.log` — terminal `done-no-content` (healthy 62-doc corpus; qcc rejected 20/20 under shipped defaults — P1 calibration finding).
  - Fixture: run-id `dogfood-20260906-empty-r2`, work dir `.spur/run/daily-dogfood-20260906-empty-r2/` — terminal `done-no-content` (designed empty-episode route; P3-burnt first attempt `dogfood-20260906-empty` documented the zero-doc plan hard-fail).
  - Solo horizon probe: real 28m39.078s / 22 docs (P2 latency evidence).
- Evidence artifacts: `1-ingest/blended.json`, `2-plan/plan.json`, `2-plan/candidates.json`, `2-plan/candidates.rejected.json` in both run work dirs; `--json` run summaries captured in stdout logs.
- Report: `.spur/run/dogfood/daily-ai-news-20260906.md` (assertion table a–f with pass/fail, 3-column wall-time table vs r6-era, P1/P2/P3 findings).
- Verify answer + verdict: `.spur/run/0098-verify-answer.txt` → `spur task verdict 0098 --from-answer` → `.spur/run/0098-verdict.json` → recorded via `spur task record 0098`.

Pipelines exercised (file:line, unchanged): `plugins/kk/workflows/kk-daily-ai-voice.yaml:73` (fan-in concurrent collect — the max-not-sum mechanism under test), `plugins/kk/workflows/kk-daily-ai-voice.yaml:98` (qcc filter → done-no-content routing — the state that fired in all three runs), `plugins/kk/workflows/kk-daily-ai-voice.yaml:209` (show-notes via podcast-pub op — live-unreached), `plugins/kk/workflows/kk-daily-ai-voice.yaml:366` (qcc→done-no-content transition guard). Primary deliverable: `.spur/run/dogfood/daily-ai-news-20260906.md:1`.

Rationale: the task's deliverable is the dogfood evidence itself; the honest terminal is FAIL (R9's clean-episode outcome not reproduced on live corpora — shipped QC admission defaults reject 100% of real candidates; horizon latency straddles the 30m source cap). Fixing those is production work for a follow-up task, deliberately not done here.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | Full pipeline run on a fresh daily corpus with publish enabled, frozen command + vars verbatim (`skip_review/transcode_mp3/publish_enabled/cover_enabled/plan_translate_enabled/agent=auto`; qc_* at shipped 2/3/2/1 defaults): run `dogfood-20260907-r2`, work dir `.spur/run/daily-dogfood-20260907-r2` (verified absent pre-launch; no cache reuse), log `.spur/run/dogfood-20260907-r2.log`, window 2026-09-07T19:59:40.410Z→20:30:48.244Z (31m08s), MAIN_EXIT=0, `--json`: `"status": "done", "finalState": "done", "transitionsTaken": 19` — the redesigned pipeline's first post-redesign terminal-`done` episode (attempts 1–2 died at qcc / show-notes) |
| R2 | MET | Plan purity: `2-plan/plan.json` = exactly 1 candidate `horizon:2026-09-07-tech-news-1` (category ai-news, scores 3/3/5/1, same-day); aihot UP this run (vs attempt-2 HTTP 500) and its 10 docs are 2020-05→2025-09-30 archives — 10/10 dropped at plan-select (0 aihot ids in annotated/plan/candidates; blended 55 → annotated 19); geopolitics: `horizon:2026-09-07-finance-news-1/3/4` rejected at qcc `category:not-in-allowlist`. Audit: `2-plan/candidates.rejected.json` 18 entries, reasons on 18/18 (`category:not-in-allowlist` ×16, `importance:2<3` ×11) + config echo (pins 2/3/2/1). Publish: `3-publish/result.json` 2/2 targets ok/published — surfdash zh post `…/articles/zh/20260907-ai-2026-09-07/index.md` + podcast-pub episode `06wiZN5N3WN`; en/ja locales written and `translate-sync` ok (`en-post-path.txt`/`ja-post-path.txt` → `20260907-ai-2026-09-07/index.md`, "Daily AI News"/"毎日 AI ニュース"). Podcast episode live: authed `GET https://podcast.salty.vip/api/v1/feed/` (Bearer from `~/.config/kk/config.yaml`) → JSON Feed item `06wiZN5N3WN` "每日 AI 资讯 — 2026-09-07" published 2026-09-07T20:29:55.091Z with 2,521,509-byte mp3 attachment on podcast-media.salty.vip; D1 free-tier quota did NOT recur (write + authed read both succeed) |
| R3 | MET | Fixture run `dogfood-20260907-empty-r2` (separate fresh work dir `.spur/run/daily-dogfood-20260907-empty-r2`, seeded crafted all-below-threshold `1-ingest/blended.json` per the empty-r1 shape; collect cache predicate picks it up at YAML:78): `--json` `"finalState": "done-no-content"`, transitionsTaken 4, `quality-control-content → done-no-content`; 0 kept / 2 rejected with explicit reasons (`category:not-in-allowlist` — ai-technical ∉ {ai-news, ai-industry}; crafted scores 2/3/3/1 pass the numeric pins, so the category gate is the demonstrated route, same as attempt-2's empty-r1); zero files in 2-article/ 2-script/ 3-audio/ 2-cover/ 3-publish/ |
| R4 | MET | Report appended: `.spur/run/dogfood/daily-ai-news-20260907.md` attempt-3 section — pass/fail line per assertion a–f (6/6 PASS) + wall-time table across r6-era / 0906-r1 / 0906-r7 / 0907-r1 (attempt 2) / 0907-r2 (attempt 3). collect ≈ max(source times), not sum: 13m34s single fan-in action with all three sources OK vs r6-era serial sum ≈20m42s (aihot ~2s + horizon 20m40s) and every prior horizon-alone observation (20m40s / 21m07s / 21m57s / 28m39s solo); totals: r6-era 46m05s (failed) / 0906-r1 30m01s / 0906-r7 21m09s (done-no-content) / attempt-2 35m38s (failed at show-notes) / attempt-3 31m08s (done) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| R9 — Redesigned pipeline reproduces the r6 dogfood outcome end-to-end | MET | command | Main run `dogfood-20260907-r2` terminal `done` with a published episode containing ONLY fresh AI news — 1 item (vLLM adds speculative decoding support for AMD GPUs, category ai-news, same-day horizon source): zero aihot archives (10/10 2020–2025 archive docs dropped at plan-select on a live polluted corpus — aihot service UP this run), zero geopolitics (finance-news-1/3/4 rejected at qcc `category:not-in-allowlist`), zero junk items (16 category rejections + 11 importance rejections all non-episode content). Episode published: surfdash zh post written (`result.json` target ok/published) + microfeed episode `06wiZN5N3WN` live in the authed feed API with playable 2.5MB mp3; show-notes seam (`kk executor run podcast-pub --in 2-plan/plan.json --out 3-publish/show-notes.md`, YAML:215) traversed clean in-run — the defect that killed attempt 2 is fixed and live-proven (0100 input-contract alignment + 0101 markdown-output exemption). Real services only: aihot/horizon/last30days live ingests (55-doc blended corpus), no mocks; surfdash + microfeed live writes |
| done-no-content fixture run clean | MET | command | `dogfood-20260907-empty-r2` → `finalState done-no-content`, 0 kept / 2 rejected with explicit reasons, zero 2-article/2-script/3-audio/2-cover/3-publish artifacts (full evidence under R3) |
| dogfood report records pass/fail per assertion | MET | command | `grep -cE "^\| [a-f] \|" .spur/run/dogfood/daily-ai-news-20260907.md` → 12 assertion rows (6 per attempt section; attempt-3 section 6/6 PASS — `grep -cE '^\| [a-f] \| .*PASS'` on the attempt-3 range → 6), each row carrying a pass/fail verdict + evidence path; wall-time comparison table spanning r6-era, 0906-r1, 0906-r7, 0907-r1 (attempt 2), 0907-r2 (attempt 3); findings (P4 cosmetic empty-header carry-through) + external contingencies (aihot UP, D1 quota not hit, 401-auth feed, SPA 404 item page) |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
| ---------- | ----------- | ---------- | ---------- |
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | Frozen WHERE honored: fresh work dirs `.spur/run/daily-dogfood-20260907-r2` / `-empty-r2` (verified absent pre-launch; no reuse of daily-dogfood-20260906/-20260907-r1 caches — probe artifact not reused), frozen command + vars verbatim (qc_* at shipped defaults), real services only (aihot/horizon/last30days live; surfdash + microfeed live writes; no mocks), empty-corpus leg executed from a separate fresh dir, report in the daily-ai-news family; fixture seeded per the established empty-r1 shape (documented in the report) |
| P4 | evidence-rule-pass | — | Every row carries executable/artifact evidence run this session: run logs + `--json` summaries, blended/annotated/plan/candidates/rejected artifacts, show-notes.md, result.json/publish-status.txt, authed feed read, surfdash post files, gates (validate 0/0, lint 0, suite 636/0) |
| P4 | ac-boxes | — | Feature-coverage row uses the exact frozen title `R9 — Redesigned pipeline reproduces the r6 dogfood outcome end-to-end`; AC gherkin re-read, intact; no `shippable` row emitted |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-07 re-dogfood attempt 2 (dogfood-20260907-r1, run 6f43758a): 0099 calibration verified live — qcc admitted 2/2, cover/script/generate(11m46s)/audio emitted, voice QC 100/100 — then terminal failure at show-notes: executor pre-validation (invoke.ts:239) rejects the documented podcast-pub show-notes Doc[] array form (kindContract publish = ContentSchema only, kinds.ts:60). Fixture leg done-no-content PASS. Verdict chain intentionally not run; fix task 0100 created under L1. Evidence: .spur/run/0098-redogfood-report.md, .spur/run/dogfood-20260907-r1.log.
- 2026-09-07T20:51:05.019Z wip → testing (system)
- 2026-09-07T20:51:05.319Z testing → done (system)
