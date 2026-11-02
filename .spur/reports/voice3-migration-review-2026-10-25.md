# Voice3 + publish3 replacement readiness review — 2026-10-25

Verdict: FAIL — do not replace the scheduled voice2 production run yet.

The split into generation, a frozen bundle, and preset-driven publication is a useful direction. The current implementation has defects in fresh generation, safety enforcement, mixed real/dummy publication, receipt identity, and scheduled execution. These are defects in the new path; the recommendation is to fix them there and prove that path, rather than continue expanding voice2.

Scope: `plugins/kk/workflows/kk-daily-ai-voice3.yaml` + `kk-daily-publish3.yaml` replacing `kk-daily-ai-voice2.yaml`; immediate callers, stages, presets, plugin transports, schedules, and tests. This is an advisory path review, with no task/corpus mutation. Existing modifications to `apps/cli/src/publish-matrix.ts` and its tests were included as the current working state and preserved. Findings below remain present with those changes.

Severity: P1 = blocks safe replacement; P2 = major correctness/reliability defect to resolve before unattended operation; P3 = explicit operational limitation or parity decision. All defects below are OPEN. No production source changes, external publications, schedule installations, or provider/model calls were performed.

## P1 — replacement blockers

### F01 — Pool consumers can execute before their guard, silently skipping store selection

Evidence: `plugins/kk/workflows/kk-daily-ai-voice3.yaml:253`, `:278`, `:461`, `:743`.

`select` depends only on `qc-content`, then reads a token produced by the sibling `pool-gate`. Several early content branches have the same undeclared dependency. A condition that runs before the token exists returns false permanently; writing PASS later does not revisit it. A real-engine reduced reproduction ended `done`, wrote PASS and an article marker, but never executed selection. This loses the store's protection against reusing selected items and makes branch execution depend on dispatcher ordering.

Fix: declare the guard before consumers and add explicit dependency edges to every consumer, retaining deliberate no-content routing. Do not substitute file existence for graph dependencies.

### F02 — Fresh generation cannot build the episode required by the default preset

Evidence: `plugins/kk/workflows/kk-daily-ai-voice3.yaml:669`; `plugins/kk/scripts/daily-stages.ts:1801`, `:1837`; `apps/cli/src/publish-matrix.ts:1229`.

Voice3 removes the publish-prep producer, but `dailyBundleVariants` still reads `31-publish/<date>_13_publish-prep_content.json` as its exclusive episode source. Generated audio under `30-audio` is insufficient. A fresh fixture produced four article variants, successfully froze a bundle, then failed even dummy planning with `bundle has no variant 'episode' for target 'podcast-pub.episode'`. Freeze accepts article OR episode although this preset needs both. An old voice2 directory can conceal the defect with a stale prep file.

Fix: restore a generation-owned assembly seam for the final audio, article, cover, ID3/episode metadata and notes; validate the selected preset's required variants before freezing.

### F03 — Draft plans can publish live without entering send confirmation

Evidence: `apps/cli/src/publish-matrix.ts:346`; `plugins/publishings/surfdash-pub/src/index.ts:129`; `plugins/publishings/podcast-pub/src/map.ts:115`; `plugins/publishings/x-pub/src/index.ts:109`; `plugins/publishings/threads-pub/src/index.ts:150`; `docs/00_ADR.md:957`.

The planner sets only `metadata.publishStatus = draft`. Surfdash reads `metadata.published` and defaults to a public post; podcast reads `metadata.status` and defaults to published. X and Threads short-post transports ignore the draft field and call their live APIs. The workflow pauses only for rows planned as live, so these default draft rows bypass that boundary. Offline probes confirmed Surfdash `draft: false`, podcast status `published`, and intercepted X tweet / Threads publish HTTP requests for draft Content. No real request left the process.

Fix: map draft/live to each target's actual contract and reject draft for operations without it. Keep unsupported operations dummy/off until explicitly authorized live. Verify plugin behavior, not just plan.mode.

### F04 — Final safety digest validation and platform exclusions are lost

Evidence: `plugins/kk/scripts/daily-stages.ts:2090`, `:2167`, `:1795`; `apps/cli/src/publish-matrix.ts:254`, `:754`.

Voice2's preparation verifies the safety verdict against the final draft digest, and its WeChat stage explicitly skips excluded platforms. New bundle construction and matrix dispatch do not enforce either check. An `exclude` verdict can still be dispatched to the excluded platform. Editing article bytes after review and freezing their new hashes also has no equivalent safety-stamp check: bundle integrity does not establish safety approval.

Fix: carry verified safety evidence and exclusions across the frozen boundary, enforce exclusions per target, and refuse changed deliverables until reviewed again. Restoring an audio assembly function alone does not enforce article-target exclusions.

### F05 — New channel copy is authored after safety and human review

Evidence: `plugins/kk/workflows/kk-daily-ai-voice3.yaml:522`, `:541`, `:697`, `:760`; `plugins/kk/workflows/kk-daily-safety.yaml:73`, `:107`.

Safety reviews article and VoiceScript, then later LLM calls author social posts and optional card text from the plan. Those new deliverables never pass the same gate. Approved article/script content is not evidence that newly authored channel text is approved, particularly when the broader plan still contains material revised out of the drafts. Some card ordering is inherited, but social authoring expands the uncovered surface in voice3.

Fix: author deliverables before review, or add a final review that covers every real publish variant and its platform exclusions. Dummy rows can remain rehearsals without real dispatch.

### F06 — Minimum-duration refusal no longer closes the publication path

Evidence: `plugins/kk/scripts/daily-stages.ts:660`; `plugins/kk/workflows/kk-daily-ai-voice3.yaml:660`, `:669`, `:760`, `:783`; predecessor guard at `kk-daily-ai-voice2.yaml:705`.

The measured duration stage refuses a subfloor episode by emptying candidates and returning success. Voice3 retains the earlier PASS token; its quality/social/bundle path does not recheck the changed candidate state or refusal artifact. Once episode assembly is repaired, a measured-refused episode or its article can still enter the publish handoff. This is a second gate defect, separate from missing dependency edges.

Fix: make the measured refusal an explicit terminal no-content outcome that prevents bundling and sending and still records a report/store disposition.

### F07 — Mixing real and dummy owned publishers breaks the legacy patch tail

Evidence: `apps/cli/src/publish-matrix.ts:637`; `plugins/kk/workflows/kk-daily-publish3.yaml:151`; `plugins/kk/scripts/kk-workflow-stages.ts:1416`.

The classifier excludes dummy rows from publication counts and does not bridge their legacy aggregate. Real Surfdash success plus dummy podcast therefore classifies `full`, invokes the patch tail, and fails because that tail requires both legacy result files. The reverse mixture has the same missing-counterpart problem. An offline reproduction returned `full` followed by patch exit 1. If `KK_SURFDASH_ROOT` is unset, the patch skips instead, hiding the gap and leaving cover/link/CMS repair undone.

Fix: make the tail consume receipts and handle real/dummy/missing counterparts explicitly. Derive its root from the actual publishing result/config. Do not enable a fake result to satisfy a real patch operation.

### F08 — Generation, shadow runs and scheduled publishers disagree on workspace ownership

Evidence: `plugins/kk/workflows/kk-daily-ai-voice3.yaml:143`, `:161`, `:263`; `apps/cli/src/commands/daily.ts:230`; `plugins/kk/schedules/kk-daily-publish3-cn-peak.cron.tmpl:20`; `kk-daily-publish3-overseas.cron.tmpl:17`.

Voice3 prepares under the voice2 workflow namespace, shares its anchor and store workflow label, while publish schedules read `<repo>/.works/kk-daily-publish3/YYYYMMDD`. Generation never writes its bundle there. Configured works roots are also bypassed by these schedule paths. Meanwhile, the documented side-by-side voice2/voice3 shadow plan shares same-day files and the anchor, so it can overwrite/reuse production artifacts rather than generate independent comparison evidence.

Fix: give generation a canonical voice3 workspace and run-specific discovery; have every publication window resolve that exact bundle. Define isolated store/output handling for shadow verification.

### F09 — Rendered cron commands contain unescaped percent signs

Evidence: `plugins/kk/schedules/kk-daily-publish3-cn-peak.cron.tmpl:20`; `kk-daily-publish3-overseas.cron.tmpl:17`; installed `man 5 crontab`, command-field semantics.

The commands embed `date +%Y%m%d` and `date +%F` without cron escaping. Cron treats an unescaped percent as the end of the command and passes the remainder on stdin, including when shell quotes surround it. Render tests only search for strings and do not validate this execution grammar.

Fix: escape percent signs for cron, preferably move date/JSON construction into a tested launcher, and verify the rendered command through cron-compatible parsing before installation.

### F10 — CN schedule passes channel tokens rejected by its own window

Evidence: `plugins/kk/schedules/kk-daily-publish3-cn-peak.cron.tmpl:20`; `plugins/kk/publish-presets/daily-ai-voice.json:66`; `apps/cli/src/publish-matrix.ts:295`.

The schedule requests WeChat, XHS, Weibo and X live. Only Weibo article and X article belong to cn-peak. The planner rejects WeChat/XHS as having no target in that window. Offline replay of the exact channel list returned exit 1. This remains broken after fixing cron syntax and work_dir.

Fix: derive the live channel list from the chosen window/preset, or pass only its explicit allowed targets.

## P2 — major correctness and reliability findings

### F11 — Receipt reuse ignores mode, run and content identity

Evidence: `apps/cli/src/itc-publish.ts:482`, `:499`; `apps/cli/src/publish-matrix.ts:126`.

A successful receipt is reused by target filename, regardless of parent run, plan/payload digest or draft-to-live promotion. The dummy-to-real exception does not solve draft-to-live. Offline replay seeded a successful draft receipt from an old run and requested a different live payload: zero dispatches, original receipt retained. Classification also trusts target identity alone. Sharing workspaces or regenerating on the same date magnifies this risk.

Fix: explicitly distinguish delivered revision/mode identity from approved promotion, reject mismatches requiring operator reconciliation, and never satisfy a live delivery with an unrelated draft success. Preserve the unknown-live-effect no-resend protection.

### F12 — RSS proof is not bound to a consistent episode identity

Evidence: `apps/cli/src/commands/daily.ts:128`; `apps/cli/src/publish-matrix.ts:933`, `:977`; `apps/cli/src/itc-publish.ts:644`; `apps/cli/tests/kk-daily-publish3.test.ts:314`.

Generation supplies compact dates, but gate title matching does literal substring matching against feed titles containing ISO dates. Regular send receipts do not populate the top-level guid that the gate expects. The gate also accepts an arbitrary caller date without verifying bundle.runDate: the existing hit test unlocks a bundle dated October 22 using October 21's feed item. Thus normal compact dates can miss real episodes, while a wrong ISO date can prove a different episode.

Fix: normalize dates, persist a stable podcast episode identifier, bind gate evidence to the actual bundle and reject caller-date mismatches.

### F13 — Later windows cannot resolve earlier-window owned URLs

Evidence: `apps/cli/src/publish-matrix.ts:729`, `:808`, `:841`.

Link resolution scans only the current window's plan for tier-0 rows. cn-peak and overseas-rss contain none, so a payload containing an owned-link placeholder fails even when after-generate receipts exist. Offline reproduction confirmed `unresolved-link`. Current social builders do not automatically append those links, so this is a broken supported contract rather than a guaranteed failure of every current social row.

Fix: resolve links from the bundle's successful owned receipts across windows, validating the episode and excluding dummy receipts for real targets.

### F14 — Store settlement treats any real success as ownership completion

Evidence: `plugins/kk/workflows/kk-daily-publish3.yaml:176`; `apps/cli/src/publish-matrix.ts:143`.

`mark-published` runs for either full or partial outcomes, but those outcomes count any real successful row. They do not establish that required owned targets both delivered. One owned success with the other failed, or optional real success beside dummy owned rows, can settle the entire generation selection as published. That makes later supply/coverage reflect a stronger success than the receipts establish.

Fix: define the store's settlement contract explicitly and gate on the required real owned receipts; keep unresolved selections visible and recoverable.

### F15 — Legitimate empty/thin days become failed runs without their normal report

Evidence: `plugins/kk/workflows/kk-daily-ai-voice3.yaml:755`, `:808`, `:836`.

`pool-gate` exits 1 when QC empties candidates. It has no tolerated failure/no-content branch, and the report depends on bundle freeze. A safe equivalent engine run returned failed and never wrote its report. This changes the established no-content behavior and makes expected supply shortages look like failures.

Fix: route empty supply to an explicit no-content report and terminal outcome, including the appropriate selection disposition.

### F16 — Bundle construction lacks dependencies on notes, cards and cover producers

Evidence: `plugins/kk/workflows/kk-daily-ai-voice3.yaml:788`; `plugins/kk/scripts/daily-stages.ts:1802`, `:1803`, `:1839`, `:1860`.

The builder reads notes, cards and cover, but waits only for quality and social-write. Notes, cards-render and cover-normalize are outside that dependency closure. Missing files silently produce empty notes or omitted variants; reused directories can contribute stale files. A frozen bundle then makes those incomplete bytes look final.

Fix: add all producer edges, with explicit disabled/failed semantics, and prohibit stale artifacts from satisfying a fresh run.

### F17 — One optional social authoring omission prevents the entire overseas plan

Evidence: `plugins/kk/workflows/kk-daily-ai-voice3.yaml:760`, `:781`; `plugins/kk/scripts/daily-stages.ts:1863`; `apps/cli/src/publish-matrix.ts:329`; `plugins/kk/publish-presets/daily-ai-voice.json:82`.

Social authoring is onError continue and checks only x.md as its expectFile. Missing Weibo/Threads files are skipped by the builder, but the overseas preset still selects every social variant. composePlan throws for any missing variant, including an optional/dummy row, preventing all rows from sending. A partial authoring failure is therefore a whole-window outage.

Fix: make authoring validate every selected required output; give optional missing variants explicit skipped/failed receipts instead of aborting unrelated targets. Dummy rows still require valid fixture content to rehearse.

### F18 — Required tier-0 delivery failures do not fail the workflow or receive the planned retry

Evidence: `apps/cli/src/publish-matrix.ts:864`, `:881`; `plugins/kk/workflows/kk-daily-publish3.yaml:129`, `:230`; `docs/design/kk-daily-ai-voice3.md:131`, `:135`.

The sender stops later tiers after a required owned failure, then returns 0. Classification also returns 0, and the graph does not route `none`/required failure into a failed terminal outcome. There is no ordinary retry node; the only retry is a later RSS-miss tier-0 repair. A run can end done with nothing delivered and no prompt recovery, contrary to the required-tier and bounded retry design.

Fix: route from receipt outcomes to explicit full/partial/failure states, and implement a bounded effect-none retry while retaining the uncertain-live guard. Keep downstream receipt/report generation available after failed delivery.

### F19 — Required run date is checked after dispatch

Evidence: `plugins/kk/workflows/kk-daily-publish3.yaml:11`, `:18`, `:127`, `:138`.

The documented rerun omits run_date, which defaults empty. The first after-generate check requiring it happens at classification, after real drafts or improperly mapped live posts may already have been dispatched. The run then loses its normal classification/settlement/report tail.

Fix: validate work_dir, window, bundle identity and date before planning or sending; derive and validate date from bundle metadata where appropriate.

### F20 — Partial-recovery marker points to nonexistent legacy aggregate and wrong retry route

Evidence: `plugins/kk/workflows/kk-daily-publish3.yaml:174`; `apps/cli/src/publish-matrix.ts:165`; `plugins/kk/scripts/kk-workflow-stages.ts:1373`.

The classifier bridges only the two owned result files, while the reused partial-marker reads `_17_publish_result.json`, which publish3 never creates. It reports `(unparsed)` failed targets and recommends old aggregate `fan-out --retry-from` recovery. This loses the very per-target diagnosis the new matrix is intended to provide.

Fix: generate the partial marker from the window outcome/receipts and name the correct matrix recovery action.

### F21 — Voice3 preflight validates voice2 rather than its own dependencies

Evidence: `plugins/kk/workflows/kk-daily-ai-voice3.yaml:141`.

The installed-stage compatibility preflight is passed voice2 and safety YAML, not voice3 and publish3. New matrix/bundle stages are therefore outside its early compatibility check. An old installed CLI can pass preparation and fail only after expensive generation, the exact class this preflight is meant to prevent.

Fix: validate the actual generation, publish and nested safety definitions against installed capabilities before spending. The installed daily-stages.ts and kk-workflow-stages.ts source hashes matched this checkout during this audit; that does not prove the bundled CLI matches current source.

### F22 — Current green tests do not demonstrate replacement readiness

Evidence: `apps/cli/tests/voice3-dag.test.ts:138`; `apps/cli/tests/kk-daily-publish3.test.ts:55`, `:276`, `:296`, `:411`.

Voice3 tests inspect YAML and freeze preseeded variants; they never execute fresh generation. Publish tests replace waiting, readiness, RSS fetch and legacy tails, and inspect plan membership/exit codes for later windows without proving each receipt succeeded. The repeatable windows.md artifact is a hard-coded summary, not a measured full-flow result. These tests pass alongside the reproduced defects above.

Fix: add a fresh-workspace, real-engine rehearsal with deterministic local generator/transport doubles. Assert current-run store selection, complete assembled variants, safety propagation, every receipt, partial/none failures, dummy-to-real and draft-to-live behavior, reruns, date binding, no-content closure and valid rendered schedules. Produce the artifact from observed outputs.

### F23 — The advertised audio quality gate only logs failures

Evidence: `plugins/kk/workflows/kk-daily-ai-voice3.yaml:669`; `plugins/kk/scripts/daily-stages.ts:2314`.

The quality node describes verification of speech/audio QC, but dailyQualityReport only prints `qc.passed` and critical issues. It does not return failure when passed is false; absent QC is printed as 100/100 and passed true. Thus the quality dependency cannot reject bad or missing QC evidence. This is inherited shared-stage behavior, rather than a regression introduced by the split, but it remains a readiness gap in the new path.

Fix: separate informational reporting from an explicit required QC verdict, including a defined policy for missing metrics; test a failed/absent QC payload through the publish handoff.

## P3 — operating constraints and accepted parity decisions

1. **This is not yet a complete dummy-first channel matrix.** The shipped preset has real draft rows for owned publishers, WeChat audio/article, XHS audio, Weibo/X articles and social posts. Only XHS long article is dummy; XHS cards, 视频号 and Threads images are off, and other deferred channels are absent. Default Weibo short-post drafts are explicitly refused by its plugin (`plugins/publishings/weibo-pub/src/index.ts:299`). Use an explicit migration preset listing exactly which operations are real, dummy or off, with valid dummy variants for every rehearsed operation. Evidence: `plugins/kk/publish-presets/daily-ai-voice.json:1`.
2. **Live scheduling currently requires manual resume.** Any live plan reaches the unconditional live-confirmation pause. The cn-peak schedule's embedded live_channels does not remove it. This is consistent with the accepted send-confirm design, but not an unattended live-publishing guarantee. Decide and test the intended approval/operating model; do not silently bypass the pause. Evidence: `plugins/kk/workflows/kk-daily-publish3.yaml:102`; `docs/design/kk-daily-ai-voice3.md:94`.
3. **Cutover needs explicit launch configuration.** auto_publish defaults false; no generation schedule template for voice3 is supplied by the renderer. A plain workflow filename swap need not enable the nested publish run. Evidence: `plugins/kk/workflows/kk-daily-ai-voice3.yaml:23`, `:817`; `apps/cli/src/commands/schedule.ts:32`.
4. **EN/JA Surfdash output is intentionally dropped.** Voice2's locale scaffold/translate/sync chain has no equivalent. Design D3 explicitly accepts zh everywhere, so this is an intentional parity loss, not an accidental missing feature. Confirm that complete replacement accepts that scope. Evidence: `plugins/kk/workflows/kk-daily-ai-voice2.yaml:887`, `:926`, `:958`; `docs/design/kk-daily-ai-voice3.md:232`.
5. **Global dummy suppresses plugin dispatch, not every external dependency or side effect.** The workflow still waits for cn-peak and fetches real RSS; a miss can invoke diagnosis. It cannot exercise all overseas sending without suitable RSS fixture injection. A reused work directory with old real receipts is also unsuitable evidence of a clean dummy rehearsal. Evidence: `plugins/kk/workflows/kk-daily-publish3.yaml:44`, `:61`, `:212`. Retain production gating, but provide explicit fixture seams for deterministic offline verification.

## Verification performed

- Bun 1.4.3 and installed Spur 0.4.20 observed locally.
- Both workflow YAML definitions validate through `spur workflow validate`; this proves schema validity, not semantic readiness.
- Matrix + publish workflow tests: 40 pass, 0 fail, 306 assertions, approximately 6.9 seconds. Focused command exits 1 under per-file coverage thresholds.
- Generation bundle/shape + stage tests: 8 pass, 0 fail, 89 assertions. Focused command exits 1 under per-file coverage thresholds.
- Offline HTTP and receipt probes: `.spur/reports/publish3-review-probes.ts`, results `.spur/reports/publish3-review-probes.json`.
- Fresh assembly reproduction: `.works/tmp/test-publish3-audit/bundle-repro.ts`, output `.spur/reports/publish3-review-fresh-bundle.log`.
- Real engine ordering fixture: `.works/tmp/test-publish3-audit/pool-gate.yaml`, run `publish3-pool-review-20261025`. A done run lacked selection output.
- Real engine empty-pool fixture: `.works/tmp/test-publish3-audit/empty-pool.yaml`, run `publish3-empty-review-20261025`. Failed, no report.
- Mixed-tail and cross-window-link reproductions were performed with local fixture state and injected dispatch; no network or publication.
- Installed stage-source hashes matched checkout for daily-stages.ts and kk-workflow-stages.ts. Installed bundle/source parity and live authenticated publishing were not verified.
- Full repository lint, build, full coverage suite and rule gate were not run: this was a read-only source review plus targeted reproductions, with concurrent pre-existing source changes. No overall gate PASS is claimed.

## Recommended migration gate

Repair F01–F10 first, including safety and operation-specific draft enforcement. Then resolve the P2 findings affecting the selected migration preset. Prove a fresh, isolated voice3 → bundle → all three publish windows flow, with real owned publishers represented by deterministic local transports and every deferred operation explicitly dummy/off. Exercise failure and resume behavior as well as the happy path. Only after those checks should an explicitly authorized production cutover change the scheduled generation entry and publication windows. Keep voice2 as a rollback option while concentrating implementation effort on the new path.
