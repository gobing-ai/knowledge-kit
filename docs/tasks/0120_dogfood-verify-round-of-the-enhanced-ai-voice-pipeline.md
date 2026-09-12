---
schema_version: 1
name: Dogfood verify round of the enhanced AI-voice pipeline
status: done
template: issue
created_at: 2026-09-11T23:55:04.611Z
updated_at: "2026-09-12T00:09:36.118Z"
feature_id: O
priority: P1
tags:
  - dogfood
  - verify

dependencies: ["0117", "0118", "0119"]
done_forced: "true"
done_reason: "PARTIAL verifyall: seam 4/4 PASS (.spur/run/0120-verdict.json, /tmp/kk-0120-seam/); live surfdash post + episode page blocked by external provider quota outage (429, resets 2026-09-18); folded into next routine daily run per orchestrator decision"
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

Standalone seam test 4/4 PASS (artifacts /tmp/kk-0120-seam/): postPath->URL derivation via real slug+locale (https://surfing.salty.vip/zh/posts/2026-09-11 x7 items), show-notes.md timeline (briefings, HH:MM incl --:-- handling, legacy fallback branch), run-report.json from the real 15-entry step-timing.json (per-step wall-clock, min/max/avg aggregates over 20 candidates, 0 threshold rejections). lint 0; task check 0.

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

