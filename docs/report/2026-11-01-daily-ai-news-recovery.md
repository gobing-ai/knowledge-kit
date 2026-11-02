# Daily AI news outage: October 26–November 1, 2026

Task: 0338. Robin explicitly approved activation in this conversation on November 1. The fixed
workflows, installed CLI/stages/publisher bundles and supervised 04:30 schedule are now activated.
Historical editions were not regenerated or published. WeChat authentication remains unavailable;
the first login window expired without a QR scan and a longer login window is now open.
Final active-suite verification passed: 4,319 tests, 0 failures, exit 0 (3 existing skips).
This report distinguishes observed activation from end-to-end delivery proof.

## Findings before repair

| Severity | Finding | Evidence and consequence |
| --- | --- | --- |
| P0 | Successful safety artifacts are deleted by an unconditional fallback | November 1 nested run `323f6ab8-41fc-4ab3-92d9-aa9e4259cf6e`: primary reviewer wrote/validated the report and judge wrote a PASS. Each following Claude retry deleted its `expectFile` before failing with expired OAuth. Gate correctly blocked the now-missing evidence and quarantined drafts. Saved agent sessions and partial handoffs remain under `.spur/run/<id>/` and `.spur/memory/runs/<id>/artifacts/`. |
| P1 | Unbounded model steps exhaust the whole scheduled run | November 1 safety review consumed 50 minutes and judge 20 minutes; earlier authoring stages also took tens of minutes. The queue ledger confirms October 27–29 were killed at the four-hour deadline, while parent and nested workflow records still claim running. |
| P1 | Failed runs reserve future news supply | Store read on November 1 found 46 `selected` rows across October 27–November 1: 9, 8, 7, 8, 8, 6 respectively. No run reached publication. These reservations exclude stories from subsequent pools until explicitly released. |
| P1 | Publication settlement does not require successful delivery | Production voice2's mark-published node checks publishing enabled and a nonempty pool, but not the classification result. Partial or failed primary delivery can therefore promote selections. |
| P1 | Classification hides missing receipts | The old classifier discarded all outcomes if either primary receipt file was missing, and counted arbitrary successful rows rather than requiring both named primary targets. |
| P1 | WeChat authentication expired | Plugin readiness refused the saved session. Code cannot create authenticated browser state; an authenticated session is required before its draft channel can operate unattended. |
| P2 | A no-content refusal remains cached after input changes | October 26: two items estimated 11 minutes below the 15-minute floor. Existing plan/QC cache checks test only file existence. Changing supply or floor does not restore filtered candidates. |
| P2 | Disabled/unscheduled targets can be mistaken for delivery failures | Voice2 is the active scheduled workflow; voice3's broader matrix and windows have not been activated. XHS is intentionally disabled. Surfdash+podcast full status does not mean WeChat/XHS/locales all completed. |
| P2 | Existing folded YAML list fix needs sibling-boundary validation | The checkout carries an uncommitted digest parser repair from October 26. It must preserve individual folded key points instead of swallowing following list items. |
| P1 | Interrupted sends lack durable identity | Podcast create used a fresh random idempotency key per attempt; Surfdash can push before its receipt is persisted. Repairs add stable podcast request identity and conservative Surfdash send-intent/uncertainty evidence. Uncertain remote effects must not be blindly resent. |

## Dated run history

| Local date | Scheduled run | Observed outcome |
| --- | --- | --- |
| October 26 | `561af6d9-f2cc-485a-a478-ea8062116bd0` | Done/no-content in 51 seconds; no publication. |
| October 27 | `7590be07-ad88-49f4-a46b-52fda60087af` | Stale running parent at nested safety; no publish artifacts. |
| October 28 | `d9f20914-a9c7-4131-8d6f-dc2cb3a3d820` | Stale running parent at nested safety; no publish artifacts. |
| October 29 | `369e6060-bb0c-4f92-9680-0b570922b4a4` | Stale running parent at nested safety; no publish artifacts. |
| October 30 | `ac119855-43ef-407a-919f-60f6ab91d64e` | Failed at safety after 3h10m. |
| October 31 | `1a77de8e-16da-4d28-b53c-bdcf42662450` | Failed at safety after 3h19m. |
| November 1 | `34764674-4c7d-430a-bc0c-7cf0acefcb78` | Failed at safety after 2h25m. |

The scheduler fired every day. launchd supervises `ai.gobing.spur-serve`, which hosts the project
Spur scheduler. The crontab's lack of a news entry is expected. The daily job remains 04:30 in
America/Los_Angeles; November 2's expected start is 12:30 UTC (PST).
The queue's measured failures and timeout reasons are saved in
`.works/tmp/test-daily-recovery/probes/scheduler-history.json`.

## Repairs and verification evidence

- Planning/QC cache fingerprints and refusal recovery: `apps/cli/tests/daily-cache-recovery.test.ts`;
  measured artifact `.works/tmp/test-daily-recovery/cache/summary.json`.
- Receipt classification: `apps/cli/tests/commands/daily.test.ts`; missing, malformed, duplicate,
  unrelated and one-sided primary receipts are exercised without live sends.
- Surfdash replay guard: `plugins/kk/tests/daily-surfdash-recovery.test.ts`; missing receipts,
  changed payloads, different dates and generic transport failures retain uncertainty. Only a
  publisher-marked `deliveryState: not-sent` failure can retry. Recovery plus publisher tests:
  70 pass, 0 fail. The focused invocation's nonzero coverage exit is distinct from assertions.
- Podcast create identity: `plugins/publishings/podcast-pub/tests/podcast-pub.test.ts` simulates a
  lost response after remote create, identical payload replay and changed content/media. Package
  tests: 76 pass, 0 fail; the focused coverage threshold remains separate.
- Supervised launcher: `plugins/kk/tests/daily-scheduled-run.test.ts`; real child-process fixtures
  exercise success, no-content, partial/missing delivery, nonzero exit, deadline and TERM-resistant
  children. Receipt/action evidence: `.works/tmp/test-daily-recovery/scheduler/summary.json`.
- Guarded safety retry and settlement: staged copies and reproduction instructions under
  `.spur/reports/daily-recovery-prepared/`. Active workflows are not yet changed.
- Actual configured `codex-sol` artifact-write probe passed in 10.6 seconds:
  `.works/tmp/test-daily-recovery/probes/codex.json` and `codex.log`.
  A separate probe also passed with API-key environment variables removed (only PATH, HOME,
  user, locale and temporary-directory variables retained): `codex-minimal-env.json` and its log.
  This checks persisted Codex authentication rather than assuming interactive-shell credentials
  will exist in the scheduler environment.
- Actual synthetic model safety rehearsal `daily-recovery-model-safety-20261101` reached `clean`
  with the configured `codex-sol` executor and all three requested platform reports. Evidence:
  `.works/tmp/test-daily-recovery/model-safety/run.json` and its `24-script/` artifacts. This was
  synthetic content only, with no publishing step.
  The measured run took 180 seconds: 78 seconds for review and 86 seconds for the independent judge.
  Its artifacts also pass the subsequently tightened full-contract predicates.
  A second real-model rehearsal using the final deployment-ready safety copy and
  `unattended=true` also reached `clean`, in 166 seconds (`daily-recovery-final-safety-20261101`).
  Evidence: `model-safety/final-run.json` and `final-trace.json` under the same evidence root.
- Actual local `voxcpm-tts` smoke generated 3.68 seconds of synthetic speech; input, output, render
  log and audio path are recorded in `.works/tmp/test-daily-recovery/probes/voice-*`.
- Authenticated podcast feed GET returned HTTP 200 with 20 items:
  `.works/tmp/test-daily-recovery/probes/podcast-readiness.json`. No episode was created.
- Surfdash checkout was on main and even with its locally recorded origin/main; unrelated dirty
  files were preserved. This is a local observation, not a fresh remote or deployment proof.
  A subsequent read-only `git ls-remote` found remote main `d4a1688b4848d451f73aa2eabf6847f2241e37a1`
  versus local HEAD `d52047b001349ce562109b510174c32edc181cc6`. The remote object is not present
  locally, so ancestry is unverified; the plugin's existing fetch/fast-forward preflight must settle
  this before publishing. During approved activation, a fresh fetch confirmed local main was
  116 commits behind with zero divergence and no untracked-file collisions. A local fast-forward
  aligned it with origin/main; existing untracked files were preserved. No remote write was made.
  The configured Surfdash CLI starts and an authenticated existing-post GET returned HTTP 200
  (`probes/surfdash-api-readiness.json`).
- A SQLite backup was used for a release simulation through the actual store CLI. At the measured
  168-hour window and explicit limit 1,000, eligible supply increased from 22 to 67 stories after
  releasing the six failed pre-publication runs. The subsequently approved production cleanup
  released the same 46 reservations; the live extract also reports 67 eligible stories. Evidence:
  `.works/tmp/test-daily-recovery/probes/supply-summary.json`.

Build and workspace typecheck passed. The pre-check rule preset passed all 58 rules and the final
post-check passed both rules. Repository
lint currently fails on pre-existing `.spur/reports` JSON formatting; changed-source formatting is
checked separately without rewriting those files. The initial full suite completed with 4,303 pass,
3 pre-existing skips and 2 failures: the new regressions reproduce the still-active safety defect.
The second full candidate suite used `KK_SAFETY_WORKFLOW` set to the prepared safety copy and
completed in 678 seconds: **4,319 pass, 3 existing skips, 0 failed assertions**, 21,938 assertions.
Its exit was 1 solely because digest-check function coverage was 88.89% (line coverage 95.45%).
The malformed-input fallback's two callback closures were simplified to an equivalent explicit
loop. The existing 45 digest regression tests remain green; digest-check now measures 100%
function and 94.97% line coverage in the focused check. A full gate on the promoted active workflow
remains required before task closure. This candidate run preceded the approved activation described
below. Both rule presets pass with full-suite coverage; no final task verification PASS is claimed.

Final schema/semantic validation passes for both deployment-ready workflows. During this gate,
Spur correctly rejected remediation steps without an observable completion declaration. They now
write a separate `09_safety-revise_attempt.json` completion receipt; the draft files themselves
are never declared as disposable outputs. Digest/structural validation still controls retry and
bounded admission-only exclusion. The focused safety suite remains 25 pass, 0 fail afterward.

## Activation outcome

- Approval source: Robin's explicit `approved` message following the concrete activation request.
- Backups: `~/.config/kk/backups/daily-recovery-20261101-1955/` contains the prior installed runtime,
  affected checkout workflows/config, and consistent `kk.db`/`spur.db` snapshots.
- Fixed workflows promoted to `plugins/kk/workflows/`. Deadlines and guarded store settlement are
  active. The existing voice2 channel set and draft/live settings remain.
- Installed CLI: built with the pre-existing unrelated `publish-matrix.ts` changes excluded through
  a build-only HEAD-source overlay; the working source was not overwritten or reverted. Manifest:
  `probes/deployment-build.json`. The installed classifier smoke preserves a one-sided success.
- Installed stage/workflow/publisher files: seven hash checks match the activated source/build
  artifacts (`probes/runtime-verified.json`). Full build and workspace typecheck pass.
- Historical cleanup: exactly six known orphan parent/safety records closed; exactly 46 selections
  released from six runs whose saved traces prove no channel-send node started. No aired or
  uncertain delivery was released (`probes/orphan-cleanup.json`, `production-releases.json`).
- Scheduler restarted at `2026-11-02T04:00:44Z` with no processing jobs. New PID 21269, local Board
  HTTP 200, and five registered scheduler entries observed. The next tick remains **November 2,
  04:30 America/Los_Angeles (12:30 UTC)**, using `codex-sol` and the supervisor with pinned works root.
- WeChat login attempt: headed login waited 180 seconds and exited 1 because no QR scan completed.
  WeChat remains a required enabled draft channel; it was not silently disabled. XHS stays disabled.
- Final full `bun run test` against the active workflows, without a candidate override, passed
  with exit 0: **4,319 pass, 3 existing skips, 0 failures, 21,949 assertions**, 676 seconds. The
  script-only no-content release delta also passed its focused 141-assertion process regression.
  Focused active DAG/safety/settlement checks pass 70 tests / 708 assertions. All 58 pre-check and
  both post-check rules pass. Build, workspace typecheck, changed-source Biome and diff checks pass.
  Repository-wide lint still fails on pre-existing unrelated report formatting; those artifacts
  were preserved. No final all-channel delivery or task verification PASS is claimed.
- A fresh synthetic real-model run through the activated safety workflow and installed stage body
  reached `clean` in 161 seconds (`daily-recovery-activated-safety-20261101`). Evidence:
  `activated-model-safety/run.json` and `trace.json`. No publication step was included.
- Final supervisor edge check: a terminal no-content run can already own reservations if it was
  refused after selection. That path now releases only after the same invocation-bound stable
  trace proves no channel send began; a no-content run with an attempted send stays reserved.
  Failure-first regression passes 141 assertions. This script-only delta was synced to the runtime.

## Remaining verification / operation

1. Restore WeChat authentication through its existing login surface. Keep XHS disabled unless Robin
   explicitly enables it; the broader voice3 migration requires its separate corrective work.
2. Inspect tomorrow's supervisor and channel receipts. Missing enabled channels now produce an
   incomplete scheduled result instead of silent green. No historical generation or live test posts.
