# November 3 daily AI news generation failure

Task: 0339 / G11. Status: all three source repairs verified; today's local generation recovered with six stories, 17.3-minute MP3 and QC100. No publication attempted.

The scheduled job fired at 04:30 PST (12:30 UTC), selected eight items and passed the early duration estimate (29.4 minutes). Cover generation returned `image-gen failed: system error` at 04:34:05 PST. The DAG stopped before audio generation or publishing. The supervisor recorded failure at 04:36:01 PST and released all eight reservations after confirming that no channel send had begun. This is a generation failure, not a missed schedule or expired publisher authentication.

The original evidence is `.works/kk-daily-ai-voice2/20261103/schedule-receipt.json`, `.spur/memory/runs/daily-ai-voice-20261103-1793709000161.md` and `.spur/run/20261103-incident-trace.json`. Original partial artifacts and receipt are preserved.

The MiniMax adapter discarded the numeric business code and attempted generation once. A provider error therefore stopped the full episode even though the pin need not change. The exact historic numeric code is unknown; it must not be retroactively asserted as 1033. [MiniMax's official error reference](https://platform.minimax.io/docs/api-reference/errorcode) identifies 1000/1001/1024/1033 as retry-later errors. A deterministic local HTTP fixture returning 1033 reproduced the single-call failure before the fix.

The adapter now retains business codes and makes at most three same-provider/model attempts for explicit transient failures, with 1s/2s backoff under one request deadline. Permanent policy/auth/quota/parameter codes remain terminal, including when the HTTP status is 500 and the message is vague. A successful image response followed by download failure never triggers a new generation call. Transport exceptions remain terminal because completion is ambiguous. Strict vendor selection is unchanged. The initial adapter repair changed no workflow, schedule, environment file or G15 implementation; the subsequently approved workflow corrections are recorded below.

Failure-first checks also caught backoff exceeding a short deadline and policy codes hidden by a generic HTTP 500. Both now have regression scenarios. The subprocess plus programmatic-entry integration uses a real local HTTP server and fake credentials, with no external calls. Repeat command: `bun test plugins/generations/image-gen/tests/minimax-recovery-e2e.test.ts`. Artifact: `.works/tmp/test-minimax-recovery/summary.json`.

The live cover recovery succeeded and produced `.works/tmp/test-daily-recovery-20261103/23-cover/20261103_07_cover_cover.png`. Continuing the saved source/script exposed a second, separate content constraint: four of the eight items were excluded by the editorial boundary, leaving a 4,515-character script estimated at 14.6 minutes. The pre-spend gate correctly refused it below the 15-minute floor. No TTS was paid for that refused script. The early source-character estimate is an upper bound before editorial exclusions, not proof of sufficient final speech. Do not lower the floor or add filler to disguise this outcome.

A readonly SQLite backup was made for supply inspection. The 48h snapshot pool contains 13 eligible items versus the morning's 10-item raw pool; 168h has at least the 20-item cap. These measurements were made later in the day and are not the morning's pool. The existing workflow runs with `window=48h`, `publish_enabled=false`, a separate work directory `.works/tmp/test-daily-expanded-20261103` and run id `daily-ai-voice-recovery-20261103`. No original failed receipt is rewritten. Generation is not yet claimed complete.

Isolation correction: the workflow launcher did not honor the temporary `kk` PATH wrapper. A subsequent readonly check found ten `selected` rows for the rehearsal in the live store and none in the snapshot. The rehearsal's own reservations were explicitly released through `kk store release --topic ai-news --run daily-ai-voice-recovery-20261103 --db .works/kk.db`; they must be verified `dropped`. The no-publication configuration and trace are retained as evidence. The rehearsal uses separate artifacts and disables publishing, but it is not a fully store-isolated workflow run; the earlier intended isolation must not be claimed as achieved. No other run's reservations are released.

The cleanup command returned `{"released":10}`; a readonly SQL check confirmed `dropped|10` and no remaining selected rows for that rehearsal. All publish and mark-published nodes require `publish_enabled=true`; this run has it false. The live store is not claimed byte-for-byte unchanged: the ten dropped history rows remain an accurate audit trail.

G15 is being implemented in `/Users/robin/xprojects/knowledge-kit-runall-g15-6827`; this incident patch stays in the main checkout, outside that worktree. Integration with G15 must preserve these adapter fixes. The installed `kk plugin status --kind generator --json` resolves image-gen as `origin: project`, `dir: /Users/robin/xprojects/knowledge-kit/plugins/generations/image-gen`, `entry: ./src/index.ts`, healthy. Thus this checkout's adapter is already the one selected from the scheduled job's repository cwd; no installed-package copy or scheduler change is required for it. Publication remains a separate action; this incident does not inherit prior-day approval from saved notes.

Verification results and final recovery outcome will be appended after the running checks settle.

## Additional root cause: script/article dependency race

The 48h rehearsal completed article/cover/script authoring and then failed before TTS with `generate: plan item count (8, 3 recorded as excluded) does not match script item sections (8)`. Its script had 7,080 characters (22.8-minute estimate), so this failure was not the duration floor.

`plugins/kk/workflows/kk-daily-ai-voice2.yaml:512` makes script-write depend on translation/style, while its prompt explicitly reads the article's exclusion note. Article-write and script-write therefore run concurrently. The completed article excluded three finance-led stories, but the raced script retained all three and even mentioned funding in its intro. The existing `expectedItemSections` guard correctly stopped generation; removing that check would ship inconsistent content. Voice3 carries the same dependency gap at `plugins/kk/workflows/kk-daily-ai-voice3.yaml:478`.

The minimal proposed fix adds `article` to script-write's dependencies, preserving script-style first and waiting for article authoring, retries and rendering to settle. A prepared voice2 candidate at `.spur/run/0339-voice2-candidate.yaml` passed schema and composition validation. The real-DAG regression `bun test apps/cli/tests/daily-script-ordering-e2e.test.ts` failed before the fix: the script consumer observed no article because its producer was still running. At this checkpoint workflow edits awaited explicit operator approval under AGENTS.md; the later approved application is recorded below.

To continue generation without editing a protected workflow, the raced script plan and compiled outputs were preserved with `.before-article-reconciliation` suffixes. The recovery plan was then reconciled with the already completed article: remove its three excluded items, add those exclusions explicitly, and replace intro/outro references to financing with the included technical topics. The inclusion/exclusion evidence is `.works/tmp/test-daily-expanded-20261103/script-reconciliation.json`. The script was recompiled and generation restarted from that corrected material, without changing the floor or running any publish stage. This is recovery of the local artifacts, not a claim that the ordering defect is permanently fixed.

## Additional root cause: voice fallback error policy is inert

The primary `generate` and first `generate-fallback` actions in voice2 and voice3 put `onError: continue` under `action.options`. The engine reads the action-level field. The 48h rehearsal's generation integrity failure therefore ended the run before the fallback siblings could execute. A real-DAG fixture using the shipped action policy and an `exit 1` primary reproduced terminal failure. Existing static tests assert the incorrect options location; those assertions need correction together with the source workflow edit.

The prepared patches `.spur/run/0339-voice2-repair.patch` and `.spur/run/0339-voice3-repair.patch` contain three minimal hunks each: one article dependency and two action-level continuation placements. Both complete candidates pass workflow schema/composition checks. Real-engine candidate probes passed: delayed article exclusions were copied only after the article producer completed; a failing primary dispatched the fallback and the fixture ended done. Logs: `.spur/run/0339-ordering-candidate.log` and `.spur/run/0339-fallback-candidate.log`. The protected workflow files were held unchanged until the explicit operator answer recorded below.

## Verification checkpoint

- `bun run build`: PASS, `.spur/run/0339-build.log`.
- `bun run spur-check`: PASS for the adapter-fix snapshot, `.spur/run/0339-gate.log`: lint/typecheck, pre-check 58/58, **4,419 pass / 3 pre-existing skips / 0 fail**, 22,697 assertions, 895.49 seconds; post-check 2/2. No skips or suppressions were introduced.
- The two new real-DAG ordering/fallback regressions were added after that full run started. They correctly fail against the currently unchanged workflows, and are not included in the 4,419 count. The current complete diff is therefore not claimed green or ready to ship. After approval, apply the candidate patches, update the old policy-location assertions, rerun focused checks, then run a final gate on the complete change.
- Final formatting and lint/typecheck after adding the regression files: PASS, `.spur/run/0339-format-final.log` and `.spur/run/0339-lint-final.log`.
- First corrected VoxCPM section completed: `00-opening.wav` / `00-opening.json` under `.works/tmp/test-daily-expanded-20261103/30-audio/sections/20261103`, speech duration 31.36 seconds, QC passed / score 100. Complete episode audio is not yet available. Worker sampling showed about 12.5 GB peak footprint and GPU-copy waits on this 16 GB host; generation is progressing slowly, not proven deadlocked. Sample: `.works/tmp/test-daily-recovery-20261103/probes/voxcpm-startup-sample.txt`.
- At this checkpoint the manual generation-only continuation was running in tool session 49319 (launcher PID 73910); its log is `.works/tmp/test-daily-recovery-20261103/probes/reconciled-generate.log`. Do not start a second render against the same directory. The workflow run `daily-ai-voice-recovery-20261103` remains failed historical evidence; the manual continuation must not rewrite that failure into an on-time success.
- G15 worktree remains separate; its ongoing test edits are owned by the other agent. No commit, push, scheduler restart, installed-runtime sync or publication was performed.

## Operator-approved continuation

Robin answered **“go ahead”** to the concrete request to apply both prepared workflow patches. The voice2 and voice3 article-ordering and action-level error-policy repairs are now applied in the main checkout. The obsolete voice2 static assertions were corrected to check the field the engine actually reads. Focused workflow verification passed: **57 tests, 808 assertions, zero failures**, including real DAG execution of both behaviors for voice2 and voice3 (`.spur/run/0339-workflow-focused.log`). Its focused coverage exit is not treated as a full-suite coverage result; the subsequent complete implementation gate passed, as recorded in the final verification below.

The five-story render completed at 13:15 PST with 851.928125 seconds of audio (14.2 minutes) and segment QC passed. It remains below the 15-minute episode minimum; segment QC is not a measured-duration pass. Its audio is preserved and not published. To recover without lowering the floor, the existing importance-only backfill was rerun after editorial exclusions against the five included stories plus a previously rejected technical-research story, “十年机器学习论文主题与基准图谱”. It admitted that story with `metadata.backfilled=true`, preserving the quality/urgency/impact/category thresholds and the configured importance/backfill policy. Evidence: `.works/tmp/test-daily-recovery-20261103/probes/extra-story-qc.json` and the original rejection audit (`importance:2<3`).

The article and authored script were extended with the source-grounded research story. The first added transition contained the style-banned word “最后”; the existing plan validator rejected it and the section-integrity guard stopped that attempt before TTS. The transition was corrected, then `scriptSource == "plan"` was asserted explicitly before rendering again. Prior plans and compiled outputs are retained. Completed section caches are reused; the unchanged closing audio was copied to its new section index with the same text/profile/driver hash and corrected artifact paths. Only the added story needs synthesis. The active continuation log is `.works/tmp/test-daily-recovery-20261103/probes/extra-generate-corrected.log` (tool session 90885). No complete-duration pass is claimed until the rejoined audio is measured.

## Final result

The additional story rendered successfully and the continuation exited0. All six technical stories are present in the authored script (`scriptSource=plan`, no plan errors); the article has the same six source references and excludes the same five out-of-scope items. Previously completed audio was reused. The pinned intro measured8.8seconds. Native duration and actual MP3 ffprobe agree on **1036.537063seconds / 17.3minutes**, within the unchanged15–25minute limits. Native audio QC reports **100/100, passed**, with no critical issues.

| Check | Final evidence |
| --- | --- |
| Complete repository gate | `.spur/run/0339-final-gate.log`: **4,421 pass / 3 pre-existing skips / 0 fail**, 22,685 assertions, 929.83seconds; lint/typecheck, pre58 and post2 rules pass; exit0 |
| Latest bundled build | `.spur/run/0339-latest-build.log`: exit0, refreshed after the final numeric-code classifier correction |
| MiniMax recovery behavior | `.works/tmp/test-minimax-recovery/summary.json`: 12 passing HTTP scenarios, including invalid2013 with timeout wording; latest focused24pass/0fail |
| Workflow behavior | `.spur/run/0339-workflow-focused.log`: 57pass/0fail, 808 assertions; real DAG ordering/fallback for voice2 and voice3 |
| Applied workflow validation | `.spur/run/0339-applied-voice2-validation.json` and `0339-applied-voice3-validation.json`: valid, no composition findings |
| Intro, duration, QC | `final-intro.log`, `final-duration.log`, `final-quality.log`, `final-mp3-probe.json` under `.works/tmp/test-daily-recovery-20261103/probes/` |
| Separate recovery receipt | `.works/tmp/test-daily-expanded-20261103/recovery-receipt.json`: actual timestamp, six stories, duration/QC, artifact SHA256 hashes, original failed-receipt identity/hash and `publicationAttempted=false` |

Generated artifacts:

- MP3: `.works/kk-daily-ai-voice2/20261103/30-audio/20261103_11_generate_content.mp3`.
- Article: `.works/kk-daily-ai-voice2/20261103/22-article/20261103_06_article_article.md`.
- Cover: `.works/kk-daily-ai-voice2/20261103/23-cover/20261103_07_cover_cover.png`.
- VoiceScript: `.works/kk-daily-ai-voice2/20261103/24-script/20261103_08_script_voicescript.yaml`.

The earlier exports remain under `recovery-0339/`, byte-identical to the verified render artifacts. Their SHA256 hashes and the original failed-receipt hash are recorded in `.works/kk-daily-ai-voice2/20261103/recovery-0339/recovery-receipt.json`; the complete recovery source remains in `.works/tmp/test-daily-expanded-20261103`.

### Restored to the dated workspace — 2026-11-03

At the operator's request, 50 runtime files were restored into the normal `10-collect`, `21-plan`, `22-article`, `23-cover`, `24-script` and `30-audio` directories. Content envelopes, plans and section caches accompany the four primary artifacts above. Local references were rebased to the dated workspace; all 21 referenced local files exist, no temporary recovery-root references remain in those stage files, and the plan/QC cache fingerprints still match. The six candidate stories match the authored script, and the canonical MP3 measures 1036.537063 seconds (17.3 minutes), with QC passed. Primary artifact hashes match the verified recovery.

The cover envelope previously referenced a removed generator JPEG. It now references a separate PNG input copied from the verified cover, preserving the normalized cover as a distinct output so normalization cannot delete its own input/output path. No image was regenerated.

Previous stage directories and the old board-owner marker were archived under `.works/kk-daily-ai-voice2/20261103/_archive/pre-0339-promotion-2026-11-03T23-13-26-154Z`. The original root schedule receipt and timing evidence remain unchanged; the failed morning run does not acquire ownership of the recovered artifacts. File hashes, archive location and validation results are recorded in `.works/kk-daily-ai-voice2/20261103/artifact-promotion-receipt.json`.

Continue from content safety review and publish preparation using these restored artifacts. Channel-specific assets/localization and each platform's publishing checks remain to be completed. No safety approval, publication receipt or successful scheduler receipt was fabricated, and no platform was posted to during restoration.

The subsequent platform investigation and execution sequence are documented in [the publishing plan](2026-11-03-daily-ai-news-publishing-plan.md). It records missing publication inputs, local credential/profile presence, and reproduced draft-mode contract gaps in the default publish3 matrix; use it before dispatching the recovered episode.

Later, the operator authorized publication and limited it to established channels. [The publication outcome](2026-11-03-daily-ai-news-publication.md) records the live Surfdash locales and podcast/RSS episode, the WeChat pre-submit refusal, and the intentionally skipped incomplete/dummy paths. The no-publication statements in this generation-recovery report describe the earlier recovery checkpoint, before that authorization and execution.

The morning scheduled receipt still records its original failure. The intermediate wider-window workflow also remains failed historical evidence; successful manual recovery is separate and explicitly late. Ten rehearsal reservations remain dropped, with no other run's reservations altered. No stories were marked published, and no channel send, scheduler restart, installed-package synchronization, commit or push occurred. Both source workflow fixes are ready for the next scheduler launch from this checkout. G15's separate worktree was not edited; its merge must preserve the minimal voice3 repairs.
