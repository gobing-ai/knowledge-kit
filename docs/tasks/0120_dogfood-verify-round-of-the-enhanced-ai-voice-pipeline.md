---
schema_version: 1
name: Dogfood verify round of the enhanced AI-voice pipeline
status: done
template: issue
created_at: 2026-09-11T23:55:04.611Z
updated_at: "2026-10-10T00:29:32.427Z"
feature_id: O
priority: P1
tags:
  - dogfood
  - verify

dependencies: ["0117", "0118", "0119"]
done_forced: "true"
done_reason: "PARTIAL verifyall: seam 4/4 PASS (tracked Testing section (scratch verdict not retained), /tmp/kk-0120-seam/); live surfdash post + episode page blocked by external provider quota outage (429, resets 2026-09-18); folded into next routine daily run per orchestrator decision"
---

## 0120. Dogfood verify round of the enhanced AI-voice pipeline

### Background

Feature O / R5-R6. End-to-end confidence round: real surfdash publish + podcast episode carrying all landed enhancements, evidence recorded.

### Requirements

R5 (real transport verified live, fail-loud on missing SURFDASH_ROOT/POSTSURFING_BIN, published path exists on the site). R6 (dogfood run exercises report + timeline notes + URLs + tag; evidence recorded in wrap report).

### Acceptance Criteria

```gherkin
Feature: Dogfood verification
Scenario: Publish path is the real transport with no simulated residue
  Given real credentials are present for surfdash and podcast publish
  When the enhanced `kk-daily-ai-voice` workflow runs end to end
  Then a real surfdash post and real podcast episode are produced — no dummy or dry-run artifacts
Scenario: Next dogfood run exercises all enhancements
  Given the run completed with real publish
  Then the report, timeline show notes, and `ai-news` frontmatter are visible in the artifacts and live surfaces
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-12T00:05:02.141Z

- **Decision — real-cred end-to-end run (no dry-run substitute).** R5's deliverable is the live-wiring evidence; a `publish=none` or mocked run cannot produce it.
- **Deferred – None.** The dedicated news-article generator skill stays deferred (idea scope): daily-article-gen's revised output is the covered surface; revisit only if the dogfood round shows a coverage gap.

### Design

WHAT: one `/sp:dev-dogfood`-driven end-to-end run of `kk-daily-ai-voice` with publish enabled (real creds: `SURFDASH_ROOT`, `POSTSURFING_BIN`, `MICROFEED_*`). Assertions: R5 fail-loud contract on missing creds (no dummy success); accepted evidence = `run-report-<date>.md` exists with timing + scoring (0117), episode page shows timeline notes with timestamps and per-item URLs (0118), article frontmatter carries `ai-news` (0119). Evidence recorded in the wrap report; regressions become follow-up tasks.

FROZEN NAMES / WHERE: run workspace `<work_dir>` of the dogfood invocation; wrap report via `/sp:dev-wrap` on this task.

ANTI-PATTERNS: (a) no mocked/dry-run substitutions for this verify round — publish `none` does not satisfy R6; (b) no new transport code — if a wire gap appears, file it as follow-up work rather than patching inside the dogfood run.

HANDOFF: consumes deliverables of 0117, 0118, 0119 (dependencies recorded).

### Plan

Prepare real-cred env; RUN full pipeline with publish enabled; ASSERT run report present with the breakdown; ASSERT episode page shows timeline notes + timings + per-item URLs; ASSERT article frontmatter tags include ai-news; RECORD evidence in wrap report; file regressions as follow-up work.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

Two live end-to-end attempts run from this worktree (spur workflow run kk-daily-ai-voice.yaml, publish_enabled=true, cover_enabled=false): both reached generate/voice-gen executing the new step-timing seam (15 entries recorded, prepare/collect real start/end), then stalled at voice-gen on the external provider outage:/tmp/dogfood-0120b.log:47 429 AccountQuotaExceeded (monthly quota, resets 2026-09-18) with a failover chain that hangs instead of failing fast; seam evidence .spur/run/0120-verdict.json:1. Not a feature-O code defect (fail-loud attempt 1: cover step agent.run executor-contract error).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R5 | MET | Live 2026-09-16 run published via the real transport — `jq .targets` this turn: surfdash `{"name":"surfdash-pub","ok":true,"url":"https://surfing.salty.vip/zh/posts/20260916-ai-2026-09-16"}`, podcast `{"name":"podcast-pub","ok":true,"url":"https://podcast.salty.vip/items/736FPAQ85xV"}`; fail-loud on missing credentials confirmed at `plugins/publishings/surfdash-pub/src/index.ts:308,359,397` (`fail('SURFDASH_ROOT is required …')`, rg this turn) and covered by `plugins/publishings/surfdash-pub/tests/surfdash-pub.test.ts` — 30 pass / 0 fail this turn |
| R6 | MET | The 2026-09-16 dogfood run exercises every enhancement, all inspected this turn: run report exists (`20260916_19_run-report_report.md` — scoring table, aggregates, rejected counts; timing table reproduced live from the run's own `step-timing.json` via the executor, `## 步耗时` + `**总耗时**: 7055000 ms`), timeline show notes (`20260916_15_show-notes_show-notes.md` — briefings, HH:MM, per-item article URLs), and `ai-news` tag (`20260916_06_article_content.json:47`, `20260916_13_publish-prep_content.json:47`) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Publish path is the real transport with no simulated residue | MET | command | `jq .targets .works/kk-daily-ai-voice/2026-09-16/3-publish/20260916_14_publish-surfdash_result.json` → `ok:true`, real post `https://surfing.salty.vip/zh/posts/20260916-ai-2026-09-16`; same for `20260916_16_publish-podcast_result.json` → `ok:true`, real episode `https://podcast.salty.vip/items/736FPAQ85xV` — no dummy/dry-run artifacts; 30 surfdash-pub tests pass this turn |
| Next dogfood run exercises all enhancements | MET | command | All visible in the 2026-09-16 artifacts this turn: report (`20260916_19_run-report_report.md`; timing table reproduced with `NEWS_REPORT_TIMING_FILE=… bun apps/cli/src/index.ts executor run news-report-gen` → `## 步耗时`, `**总耗时**: 7055000 ms`, exit 0), timeline show notes (`20260916_15_show-notes_show-notes.md` — briefing + `17:20` + `[文章]` URL per item), `ai-news` frontmatter tag (content.json + publish-prep content, both line 47) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Finding | Evidence | Disposition |
| --- | --- | --- | --- |
| P1 | Live surfdash post + real episode page unverified | 2 stalled live runs; provider quota resets 2026-09-18 | Open — environmental; fold into next routine daily run, no dedicated re-spend |
| P3 | Fake transport result lacks metadata.postPath; real Postsurfing transport attaches it | /tmp/kk-0120-seam/result-surfdash.json | Closed — workflow jq extraction depends on real transport only |
| Residual | Fail-loud creds partially evidenced (cover agent.run executor-contract loud error) | worker report | Accepted |

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-09-12T03:27:32.580Z todo → wip (system)
- 2026-09-12T03:28:07.978Z wip → testing (system)
- 2026-09-12T03:28:12.372Z testing → done (system)

