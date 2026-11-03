---
schema_version: 1
name: Recover daily cover generation from transient MiniMax failures without changing providers
status: done
template: issue
created_at: 2026-11-03T18:57:58.066Z
updated_at: "2026-11-03T22:25:51.308Z"
feature_id: G11

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 4
done_forced: "false"
done_reason: unforced close
---

## 0339. Recover daily cover generation from transient MiniMax failures without changing providers

### Background

The 2026-11-03 scheduled daily run daily-ai-voice-20261103-1793709000161 began 04:30 PST and failed before audio/publication. Eight candidates passed QC (29.4-minute estimate). Cover generation failed at 12:34:05Z with image-gen failed: system error. The supervisor closed failed at 12:36Z and released eight selections after verifying no channel send. The raw MiniMax status code was discarded by plugins/generations/image-gen/src/providers/minimax.ts:128, so the original numeric code cannot be recovered from the trace. A subprocess reproduction against a local HTTP server returns base_resp.status_code=1033; current plugin makes one call instead of recovering. Failure-first command: bun test plugins/generations/image-gen/tests/minimax-recovery-e2e.test.ts; observed 0 pass / 1 fail, expected calls 2, actual 1. G15 is active in a separate worktree; do not edit or merge its feature work. MiniMax official error reference https://platform.minimax.io/docs/api-reference/errorcode identifies 1000/1001/1024/1033 as retry-later failures. Preserve original receipt and partial artifacts as incident evidence.

### Requirements

- [x] R1. Recover explicit transient MiniMax image-generation error responses with at most three same-provider POST attempts and bounded backoff within one existing request timeout budget; do not regenerate after a successful response's image download fails.
- [x] R2. Preserve MiniMax business error codes and classify policy/auth/quota codes even when messages are vague. Never retry policy, authentication, balance or invalid-parameter failures; keep vendor fallback opt-in unchanged.
- [x] R3. Verify the real image-gen entry through a local HTTP server before changing production source, with recovery, exhaustion and permanent-error cases, and preserve a repeatable artifact. Complete repository quality checks and record findings.
- [x] R4. Prepare today's generation recovery from existing source material without publishing, overwriting the original failure receipt, changing active schedules or activating installed runtime without explicit approval. Document any remaining blockers and the concrete activation candidate.
- [x] R5. Make voice2 and voice3 script-write wait for the completed article and place voice retry continuation at action.onError so the configured fallback actually executes. Prove both behaviors through real DAG runs and preserve the concurrent G15 worktree.

### Acceptance Criteria

```gherkin
Scenario: AC1 — transient cover generation recovers without switching vendors (req: R1)
 Given MiniMax returns an explicit system/internal error followed by image bytes
 When the actual image-gen entry runs
 Then it retries the same provider and model and produces valid Content
 And repeated explicit transient failures stop after three attempts within the request budget

Scenario: AC2 — permanent errors remain terminal and diagnostic (req: R2)
 Given vague messages with policy, auth, balance or invalid-parameter business codes
 When image-gen runs
 Then it calls once and fails with the numeric code
 And no vendor fallback or policy bypass is introduced

Scenario: AC3 — recovery evidence is repeatable (req: R3)
 Given the local HTTP subprocess regression
 When targeted checks and the final repository gate run
 Then test evidence records results and a machine-readable artifact
 And source review preserves cancellation, output validation and G15 changes

Scenario: AC4 — today's recovery is prepared without publication (req: R4)
 Given the original failed run and its partial artifacts
 When recovery is prepared and rehearsed
 Then original failure evidence is preserved and publishing is disabled
 And any remaining operational blocker or approval is reported explicitly

Scenario: AC5 — article ordering and voice fallback are enforced by the engine (req: R5)
 Given delayed article authoring and a primary voice failure in separate real DAG fixtures
 When the shipped workflow dependencies and error policies are exercised
 Then script authoring observes the finished article exclusions
 And the primary failure dispatches its configured fallback
 And both voice2 and voice3 pass those checks without touching the G15 worktree
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-11-03T18:59:51.648Z

Closed: preserve MiniMax/model pin and strict cross-provider fallback. Today's goal authorizes local fixes and generation preparation; it does not authorize new publication or production activation. Do not assume November 2 authorizations apply to this new incident. No G15 edits or external messages. Original provider numeric status remains unknown because the adapter discarded it; 1033 is a deterministic representative regression, not an invented historical observation.

#### Q&A entry — 2026-11-03T21:53:59.615Z

Robin replied “go ahead” to the concrete final request to apply both prepared workflow patches. This explicitly authorizes the voice2 and voice3 article-ordering and voice fallback error-policy repairs in this checkout. Both patches have now been applied, with failure-first real-DAG coverage passing for both definitions. The separate G15 worktree remains owned by its other coding agent. No new approval is needed for these same fixes or their tests; this answer does not authorize publication, a scheduler change or deployment.

### Design

Fix the three reproduced failure seams without changing content policy or provider/model pins:

1. MiniMax adapter: preserve explicit business codes, classify them through `minimaxErrorClass`, and retry only explicit transient generation failures at most three times with 1s/2s abortable backoff under one existing request deadline. Numeric permanent/unknown business codes do not inherit transient meaning from loose wording; content-policy rejection remains terminal. Transport ambiguity and successful-generation download failures do not regenerate. Cross-provider fallback stays opt-in.
2. Voice2/voice3 authoring: `script-write.dependsOn` includes `article` so it sees completed exclusion notes. Preserve `script-style` first to retain the disabled-authoring branch behavior. Keep `expectedItemSections` and all other validation intact.
3. Voice2/voice3 voice chain: non-final attempts use action-level `onError: continue`, the field the engine reads; the last tier stays loud. Real DAG fixtures must observe the article's delayed output and dispatch fallback after a failed primary.

Owners: image-gen adapter/classifier and new MiniMax E2E check; two approved workflow definitions; existing voice2 static expectations and new real-DAG regression; owning docs/report. No API, dependency, schema, scheduler, .env or installed-runtime change. G15's separate worktree stays untouched; its eventual merge must retain the three minimal voice3 hunks.

Robin explicitly authorized both prepared workflow repairs with “go ahead”. Existing source plugin discovery selects image-gen from this checkout, and the scheduler reads the checkout workflow; no installed copy/restart is needed. No publication is authorized or attempted.

Generation recovery preserves original failed receipts and uses separate local artifacts. After editorial exclusions and a short first render, admit an additional saved technical-research story through the unchanged importance-only backfill. Preserve existing audio caches, synthesize the additional story, then require intro merge, measured duration15–25min, actual MP3 ffprobe and QC. This is a separate manual recovery; it never rewrites the morning run into an on-time success. Ten unintended rehearsal reservations were released and verified dropped.

### Plan

- [x] Reproduce the scheduled failure and write failing subprocess checks before production code (R3).
- [x] Implement bounded same-provider retries and numeric error classification without policy bypass (R1/R2).
- [x] Exercise exhaustion, permanent errors, deadline interruption and download behavior; run focused checks (R1–R3).
- [x] Apply the explicitly approved voice2/voice3 ordering and fallback repairs; prove both through real DAG execution (R5).
- [x] Prepare and complete today's generation-only recovery from saved material, preserve failed history, verify intro/MP3/15–25minute duration/QC and write a separate receipt (R4).
- [x] Run final lint/typecheck, build, full tests and pre-/post-check rules; review diff and record verify PASS through Spur (R3).

### Root Cause

1. The morning cover provider returned system error; the MiniMax adapter discarded its business code and made no recovery attempt before failing the required cover node. Confirmed original trace: .spur/run/20261103-incident-trace.json, cover action at12:34:05.795Z. Original numeric code is unknown. Baseline source `git show HEAD:plugins/generations/image-gen/src/providers/minimax.ts` has the lossy response extractor and single POST. Current fix is at plugins/generations/image-gen/src/providers/minimax.ts:47.
2. `script-write` reads article exclusion notes but lacked an article dependency, allowing the two authors to race. Recovery retained three article-excluded finance items and the existing section-integrity guard correctly refused it. Dependency sites: plugins/kk/workflows/kk-daily-ai-voice2.yaml:512 and plugins/kk/workflows/kk-daily-ai-voice3.yaml:478. Fixed with explicit article dependency, not a weaker integrity check.
3. The two non-final voice attempts declared continuation inside shell options instead of action.onError; the engine ignored it and stopped before fallback. Real DAG failure fixtures prove the misplaced field is ineffective and the corrected policy dispatches fallback. Both workflows now place it at action level.

Separately, the saved-source script estimated14.6minutes and the five-story actual render measured14.2minutes. Those legitimate duration refusals are not bypassed. An additional saved technical-research story was admitted through the existing importance-only backfill after editorial exclusions; the final six-story episode measured17.3minutes and passed QC. Original failed history is preserved; this is later manual generation recovery, not an on-time completion claim.

### Solution

| File | Change and reason |
| --- | --- |
| plugins/generations/image-gen/src/providers/minimax.ts:47 | Retain numeric API codes; retry only explicit transient generation responses, at most three attempts, with abortable backoff under a single request deadline. Download and ambiguous transport failures do not regenerate. |
| plugins/generations/image-gen/src/providers/errors.ts:28 | Classify business codes before generic transient wording, retaining content-policy priority; permanent2013 cannot be retried merely because its message says timeout. |
| plugins/kk/workflows/kk-daily-ai-voice2.yaml:512 | Wait for completed article admission before script authoring; action-level continuation activates both non-final voice fallback paths. |
| plugins/kk/workflows/kk-daily-ai-voice3.yaml:478 | Apply the same minimal ordering/fallback repairs to the shared voice3 generation graph. |
| apps/cli/tests/voice2-dag.test.ts:1193 | Correct the obsolete assertions that pinned ignored options.onError metadata. |
| apps/cli/tests/daily-script-ordering-e2e.test.ts:8 | Failure-first real DAG execution proves article ordering and fallback dispatch for both workflows. |
| plugins/generations/image-gen/tests/minimax-recovery-e2e.test.ts:11 | Actual CLI/programmatic entry HTTP regressions: 12 scenarios, shared deadline, policy precedence and no download-triggered regeneration. |
| docs/04_DESIGN.md:1273 | Document adapter retry behavior and the two workflow contracts. |
| docs/design/kk-daily-ai-voice.md:81 | Clarify provider pinning versus bounded same-provider recovery. |
| docs/report/2026-11-03-daily-ai-news-recovery.md:1 | Preserve incident/approval/isolation-cleanup history and final measured recovery evidence. |

Generation recovery is separate from the original failed scheduled run. Six source-grounded technical stories, pinned intro, measured1036.537063s MP3 and QC100 pass. Artifacts and hashes are in .works/tmp/test-daily-expanded-20261103/recovery-receipt.json. The earlier short render is archived; source gates and floor remain unchanged. No publication, scheduler change, installed copy, dependency or G15 worktree edit.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Actual image-gen entry and programmatic-entry HTTP fixtures verify same-provider recovery, three-attempt exhaustion, deadline interruption and no regeneration after download failure; full gate exits0. |
| R2 | MET | Twelve HTTP scenarios include policy/auth/balance/parameter failures with vague descriptions, HTTP500 policy precedence and permanent2013 with timeout wording; numeric codes retained. |
| R3 | MET | Failure-first red logs retained; final full gate4421pass/3existing skips/0fail, lint/typecheck, pre58/post2 rules, latest build and focused24 image/57 workflow checks. Artifacts under .works/tmp/test-minimax-recovery and test-script-ordering. |
| R4 | MET | .works/tmp/test-daily-expanded-20261103/recovery-receipt.json records article/cover/script/MP3 hashes, six stories, measured1036.537063s, QC100, original failed receipt identity and publicationAttempted=false. Ten unintended reservations released/dropped; no other run altered. |
| R5 | MET | Both applied workflow definitions pass schema/composition validation. Real DAG fixtures prove completed article admission and functioning primary-failure fallback for voice2 and voice3; the other agent's G15 worktree is untouched. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — transient cover generation recovers without switching vendors (req: R1) | MET | test | plugins/generations/image-gen/tests/minimax-recovery-e2e.test.ts; 12-case .works/tmp/test-minimax-recovery/summary.json; final gate. |
| AC2 — permanent errors remain terminal and diagnostic (req: R2) | MET | test | Numeric business-code, HTTP500 policy and invalid-params timeout-word cases; one-call permanent failures; no opt-in fallback expansion. |
| AC3 — recovery evidence is repeatable (req: R3) | MET | test | .spur/run/0339-final-gate.log, 0339-latest-build.log, native fixture summaries and retained red/candidate/green logs. |
| AC4 — today's recovery is prepared without publication (req: R4) | MET | command | Final recovery receipt and actual MP3 ffprobe; final-intro/duration/quality logs; original morning receipt still failed. |
| AC5 — article ordering and voice fallback are enforced by the engine (req: R5) | MET | test | apps/cli/tests/daily-script-ordering-e2e.test.ts executes both shipped definitions' dependencies and error policy in real DAGs; focused workflow57pass/808assertions and final full gate. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Verdict: PASS**

| Finding | Priority | Evidence | Disposition |
| --- | --- | --- | --- |
| MiniMax failure was terminal and lost its business code | P1 | Failure-first actual-entry HTTP fixtures; 12-case repeatable artifact; final gate | FIXED: bounded same-provider retry, numeric-code classification, abortable deadline and no rebilling on download/transport ambiguity. |
| Script author raced the article exclusion notes | P1 | Real DAG red before patch and green for both voice2/voice3 | FIXED: article dependency; section-integrity guard retained. |
| Voice fallback error policy was inside ignored shell options | P1 | Real DAG primary-failure fixture; 57 focused workflow checks | FIXED: action.onError governs both non-final attempts; final tier stays loud; old static assertions corrected. |
| Ten rehearsal reservations reached the live store despite intended wrapper isolation | P2 | Explicit release returned10; final readonly query dropped10 | RESOLVED and disclosed; accurate history retained, no other run touched. |
| Five-story render missed the duration floor | P2 | First render851.928125s; unchanged native importance-only backfill; final MP3 measured1036.537063s | RECOVERED with six technical stories, no lowered floor or filler. |

Final validation: 4421pass, three pre-existing skips, zero failures; full coverage gate exits0; lint/typecheck/build and pre58/post2 rules pass. Latest classifier wording case and actual applied workflow schema/composition checks pass. Native intro/duration/QC checks pass; final MP3 QC100 and17.3minutes. Original morning failure preserved, no publication. Slow local VoxCPM performance is documented; no unrequested driver/model change.

Scope review preserves all cancellation/output/safety boundaries, G15 concurrent work and the original failed-run evidence. No suppressions, new skips or new dependencies. No remaining implementation defect in this task's reproduced set.

### References

- Owning feature: G11. G15's separate worktree remains owned by the concurrent agent; retain the minimal voice3 repairs when its work is integrated.
- Prior completed recovery: 0338; no reopening or duplicate implementation of its cache/supervisor fixes.
- Detailed report: docs/report/2026-11-03-daily-ai-news-recovery.md.
- Original run: daily-ai-voice-20261103-1793709000161; original .works/kk-daily-ai-voice2/20261103/schedule-receipt.json remains failed.
- Final separate receipt: .works/tmp/test-daily-expanded-20261103/recovery-receipt.json; six stories, 1036.537063seconds, QC100, publicationAttempted=false.
- Final full gate: .spur/run/0339-final-gate.log; latest build: .spur/run/0339-latest-build.log; latest focused image test: .spur/run/0339-latest-image-focused.log; workflow checks: .spur/run/0339-workflow-focused.log.
- Repeatable fixtures: .works/tmp/test-minimax-recovery/summary.json and .works/tmp/test-script-ordering/summary.json.
- Numeric-code authority: https://platform.minimax.io/docs/api-reference/errorcode (read during investigation).

### History

- 2026-11-03T18:59:52.815Z todo → wip (system)
- 2026-11-03T22:22:46.229Z wip → testing (system)
- 2026-11-03T22:22:46.975Z testing → done (system)

### Notes

Checkpoint 2026-11-03 ~11:29 PST. User asked to diagnose and fix today's generation failure while another agent implements G15. Scope authorizes local fixes and generation recovery; supplied AGENTS.md explicitly requires workflow-edit permission. Async question asking for voice2/voice3 workflow edits is unanswered. No authority from prior-day memory is reused.

MiniMax source repair is implemented; build and full adapter snapshot spur-check PASS (4,419 pass, 3 existing skips, zero fail, pre58/post2). New real-engine regression file apps/cli/tests/daily-script-ordering-e2e.test.ts was added after that suite started and correctly reproduces two open defects. Current full diff is NOT green. Protected workflows remain unchanged. Exact candidate patches: .spur/run/0339-voice2-repair.patch and .spur/run/0339-voice3-repair.patch; both add article dependency to script-write and move onError out of options for generate/generate-fallback. Both candidates schema/composition valid; real-engine candidate probes pass. After operator answers yes: apply only the approved main-checkout workflow patches; correct the stale action.options.onError assertions in main voice2/voice3 tests; run new E2E checks then final gate. Do not touch /Users/robin/xprojects/knowledge-kit-runall-g15-6827, whose test edits belong to the other agent.

Original morning failed run daily-ai-voice-20261103-1793709000161 and its receipt are preserved. Cover failed system error; original numeric status unknown. Live cover recovery succeeded. Saved morning script then legitimately refused 14.6-minute floor. Expanded 48h workflow daily-ai-voice-recovery-20261103 failed on script/article exclusion mismatch, exposing the race. Intended PATH wrapper did NOT isolate store writes: ten rehearsal selections landed in live DB, were explicitly released, and all ten verified dropped. No publication occurred; do not claim store unchanged.

Manual recovery in .works/tmp/test-daily-expanded-20261103 reconciles script with completed article; preserves original plan/compiled output with .before-article-reconciliation suffixes and script-reconciliation.json. Generation still ACTIVE in tool session 49319, launcher PID 73910; no duplicate render. Log .works/tmp/test-daily-recovery-20261103/probes/reconciled-generate.log is buffered until stage completion. Only 00-opening.wav/json/mp3 exist so far, QC passed100, speech31.36s. Local VoxCPM is slow (~12.5GB peak on16GB RAM, GPU copy waits); first worker finished after~8min, next section still running. Wait/poll this existing process and then run standard intro/duration/QC checks. Do not claim full audio or publishability before measured gates. Full original workflow recovery stays failed historical evidence; manual recovery must have a separate receipt.

Official 0339 verdict is FAIL (unmet R5), confidence LOW; task remains wip. Testing written through spur task verdict/record; do not mark done while approval/audio are incomplete. Review and report record the open defects. Latest formatter/lint PASS, git diff --check PASS. Main source/doc/test/task changes are this task's only tracked edits; no commit/push/deploy/scheduler or installed-package sync. Native kk plugin status resolves image-gen to project ./src/index.ts, so no installed copy required for this adapter.

Checkpoint 2026-11-03 ~14:05 PST supersedes the earlier approval-pending checkpoint. Operator's actual chat answer “go ahead” explicitly authorized both prepared workflow repairs. Both main-checkout YAMLs are patched and schema/composition valid. New real-DAG ordering/fallback plus voice2/voice3 focused checks: 57 pass / 0 fail / 808 assertions. The other agent's G15 worktree is untouched.

One final error-code case reproduced invalid params2013 being retried when its description said request timeout; fixed by keeping explicit business-code classification ahead of generic transient wording. Latest image-focused tests: 24 pass / 0 fail / 146 assertions. Latest formatter and lint/typecheck pass. Full final gate still running in tool session2386, log .spur/run/0339-final-gate.log. Build at .spur/run/0339-final-build.log passed before the last one-line classifier correction; run final build again AFTER the suite to refresh bundled artifacts. Do not start a duplicate full suite while this one runs. Any failure must be inspected, not suppressed.

First five-story audio completed but measured851.928125s (<15min); archived as 20261103_11_generate_content.before-extra-story.{json,wav,mp3}. Existing importance-only backfill admitted one extra research-map story after editorial exclusions; no hard threshold or floor changed. .works/tmp/test-daily-recovery-20261103/probes/extra-story-qc.json records six valid candidates and extra.backfilled=true. Article/script extended from saved source. A banned 最后 transition was corrected; current scriptSource=plan and scriptPlanErrors=[] are explicitly checked before TTS. Current script5746spokenchars. Existing seven section caches retained; unchanged closing copied to index07 with matching text/profile/driver hash and corrected paths.

Only new06-item is rendering in tool session90885, Python workerPID33056 (at last check), source log .works/tmp/test-daily-recovery-20261103/probes/extra-generate-corrected.log. Opening hash verified unchanged. Do NOT duplicate or kill this render. After completion: run daily-intro with the pinned ~/.config/kk/voices/AI每日资讯_8秒播客片头.mp3; run daily-episode-duration with 15/25/voxcpm; run daily-quality-report; assert real MP3 ffprobe duration and metadata/QC. Write a separate generation recovery receipt; original morning receipt/run stay failed history. No publishing, scheduler changes or installed sync is authorized/needed. image-gen resolves project source.

Task0339 stayswip until both checks and complete generation pass. Old official FAIL is historical, not a conclusion about approved fixes. Then update Plan/Review/Solution/Testing from actual final evidence, derive PASS via spur task verdict and task record, and transition wip→testing→done with normal guards (no force/no bypass). Refresh G11 roster. Preserve G15 concurrent edits and leave a reviewable diff; no commit/push requested.

Checkpoint 2026-11-03 14:11 PST: SOURCE WORK AND FINAL CHECKS COMPLETE; do not repeat broad testing. Final full gate session2386 exited0: 4421pass / 3existing skips / 0fail, 22685assertions, 929.83s, pre58/post2 rules PASS (.spur/run/0339-final-gate.log). Latest post-classifier-correction build session71773 exited0 (.spur/run/0339-latest-build.log). Latest image tests24pass/0fail and latest lint/typecheck PASS. Native summary has12 HTTP cases including invalid-params-timeout-word-no-retry. Both actual workflow definitions schema/composition PASS. New DAG tests cover both voice2 and voice3; source dependencies contain article and action-level continuation.

ONLY REMAINING: live extra research-story synthesis, session90885/Python33056, .06-item_in.json. Do not start duplicate synthesis. All prior audio sections reused; 07closing copied with correct paths/hash. Current authored scriptSource=plan, errors=[], storyCount6; article references6 and excludedIds5 aligned. Candidate extra story passed unchanged native QC via importance-only backfill. Wait for .works/tmp/test-daily-expanded-20261103/30-audio/sections/20261103/06-item.{json,wav,mp3}; stage rejoins final audio itself. Then pinned intro → measured15/25 duration gate → audio quality report; ffprobe MP3; separate recovery-receipt.json; final report + unforced task verdict/record/testing/done. Prior 851.928125s audio is archived as .before-extra-story.{json,wav,mp3}. No publish requested or performed.

User's go-ahead already authorizes both workflow fixes. No more permission questions. Do not touch G15 worktree or merge its changes. Original morning failure stays preserved. Ten rehearsal reservations already released/dropped. Task remainswip only because final audio gate/outcome is pending; current official FAIL artifact is stale and must be replaced with honest final PASS only after all evidence exists.

FINAL — 2026-11-03, task0339 is DONE with official PASS and unforced normal wip→testing→done transitions; final task check has zero findings. All three code defects are fixed and approved workflow repairs applied. Final full gate4421pass/3existing skips/0fail, pre58/post2, latest lint/typecheck/build pass. No more testing or generation is needed for this task.

Local edition recovered: six technical stories, measured1036.537063seconds (17.3min), pinned8.8s intro, QC100. Canonical exported artifacts and hash-bound receipt: .works/kk-daily-ai-voice2/20261103/recovery-0339/{episode.mp3,article.md,cover.png,voicescript.yaml,recovery-receipt.json}. Complete section caches/metadata remain .works/tmp/test-daily-expanded-20261103. All owned renders and verification commands have finished. Do not regenerate or duplicate this completed audio.

Original morning receipt and intermediate failed workflow remain failed historical evidence; this is explicitly later manual recovery. Ten rehearsal reservations are dropped. Nothing published, no scheduler restart or installed sync, no commit/push. G15 worktree untouched; eventual integration must preserve minimal main voice3 ordering/error-policy repairs. Main has this task's intentional staged/unstaged changes; preserve concurrent staging rather than resetting it. Report: docs/report/2026-11-03-daily-ai-news-recovery.md.

