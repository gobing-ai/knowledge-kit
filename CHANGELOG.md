## [0.1.9] - 2026-10-23

### Added

- feat(store): add `kk store stats` for per-day, per-source channel yield so publish outcomes read from the store instead of ad-hoc queries (45394e5)
<!-- src: apps/cli/src/commands/store.ts:1311 -->
- feat(board): render the real channel yield and episode funnel in the Collect and Daily summaries, replacing the stand-in panels (b41d706)
<!-- src: apps/board/src/collect/panels.tsx:94 -->
- feat(podcast-pub): fill microfeed episodes with per-item SEO so each episode ships searchable show text (047945f)
<!-- src: plugins/publishings/podcast-pub/src/seo.ts:18 -->
- feat(cli): add the publish-matrix plan/check/send stages over the itc publish core (0321) (54570c4)
<!-- src: apps/cli/src/publish-matrix.ts:399 -->
- feat(cli): add a dummy publish mode that writes synthetic no-effect receipts, so the matrix runs end-to-end without touching live channels (0322) (7565eb4)
<!-- src: apps/cli/src/publish-matrix.ts:54 -->
- feat(cli): derive session-preflight probes from the publish preset (0325) (0912924)
<!-- src: apps/cli/src/publish-matrix.ts:515 -->
- feat(cli): classify publishes from receipts with a legacy 31-publish bridge, replacing tail-scraped detail (0326) (bf1c45a)
<!-- src: apps/cli/src/publish-matrix.ts:120 -->
- feat(publish): add kk-daily-publish3 windows, the daily-ai-voice preset, an overseas-RSS gate and schedules (0323) (263b746)
<!-- src: apps/cli/src/publish-matrix.ts:411 -->
- feat(publish): add the kk-daily-ai-voice3 generate workflow with a bundle-freeze stage (0324) (c28ef98)
<!-- src: plugins/kk/workflows/kk-daily-ai-voice3.yaml:795 -->

### Fixed

- fix(daily): extend the extract window ladder to ×7, capped at 168h, so a supply-collapsed day fills from a week of store backlog instead of closing as no-content (246dc14)
<!-- src: plugins/kk/scripts/daily-stages.ts:295 -->
- fix(board): close the 0320 review residuals on the daily voice tab (b0cb11f)
<!-- src: apps/cli/src/board/daily-voice.ts:560 -->
- fix(publish): expand ~ in the preset config path, keep the ledger summary on an unplanned window, and enforce X's weighted social cap (a9a789f)
<!-- src: apps/cli/src/publish-matrix.ts:1127 -->
- fix(git): rewrite git's generated merge subject into a Conventional Commit so cog's commit-msg hook no longer rejects merge-based pulls (c25b0ec)
<!-- src: scripts/merge-commit-subject.ts:2 -->
- fix(podcast-pub): route SEO diagnostics and plan IO through the project seams (4a9c5f2)
<!-- src: plugins/publishings/podcast-pub/src/seo.ts:11 -->
- fix(kk): refuse a post path where translate-sync expects the marker file (626e670)
<!-- src: plugins/kk/scripts/daily-stages.ts:3063 -->
- fix(publish): fast-forward the surfdash checkout before writing a post (cd2c849)
<!-- src: plugins/publishings/surfdash-pub/src/index.ts:352 -->
- fix(tooling): keep the hook installer alive when proto refuses the untrusted config (d3f23bf)
<!-- src: scripts/install-hooks.ts:12 -->
- fix(surfdash-pub): stop inventing the canonical URL and assert the site refined the post (f4b29b4)
<!-- src: plugins/publishings/surfdash-pub/src/index.ts:126 -->
- fix(kk): narrow the daily topic boundary to PRC top leadership (87e3917)
<!-- src: plugins/kk/scripts/kk-workflow-stages.ts:851 -->
- fix(kk): skip the surfdash patch when the publish has no postPath (ced5f05)
<!-- src: plugins/kk/scripts/kk-workflow-stages.ts:1198 -->
- fix(kk): refuse an under-length daily episode before the TTS spend (8d981b5)
<!-- src: plugins/kk/scripts/daily-stages.ts:225 -->
- fix(cli): forward a plugin's stderr when it exits 0, so a zero-exit plugin's warnings still surface (82ec130)
<!-- src: apps/cli/src/fanin.ts:320 -->

### Changed

- refactor(daily): extract channel payload builders and add the generate-side variant stage (0327) (a1c0e1d)
<!-- src: plugins/kk/scripts/daily-stages.ts:1784 -->

### Other

- test: diagnose the smart-seo cancellation flake under suite load (a6fdf72)
<!-- src: plugins/kk/tests/smart-seo-workflow.test.ts:812 -->
- docs(tasks): refresh review evidence for publish and daily tasks (05c9594)
- chore: ignore /.omo agent-tool session state (8d42cd3)
- chore(wrap): dev-runall feature:G15 close-out — ADR, architecture, design sync and learnings (3df912a)
- chore(wrap): batch learnings for the G15 run (834db28)
- docs(tasks): mark 0319 check receipt LOST (discarded with agent worktree, ADR-131) (5d03bca)
- docs(tasks): mark 0318's run-scoped evidence LOST after the run-plane cleanup (5f1c012)
- docs(agents): name the CLI bundle in the installed-package sync (8a6d783)
- docs(task): plan the real Summary tabs for Collect and Daily AI Voice (0d89608)
- docs(tasks): Add new tasks (771b55d)
- docs(tasks): Add new tasks (a5605d3)
- chore: merge sp/runall-0319-0320-f9bf (board channel yield and episode funnel) (3172202)
<!-- src: apps/board/src -->
- chore: merge origin/main into main (161b0d5)
- chore: reconcile local main with origin/main (5b9c481)
- Merge pull request #1 from gobing-ai/cursor/podcast-pub-seo-f865 (8cadad4)
<!-- src: plugins/publishings/podcast-pub -->

## [0.1.8] - 2026-10-21

### Added

- feat(board): accept a well-formed http(s) Board origin through `isHttpOrigin` and keep the loopback rule only for a cross-origin reader, so a Board served on a LAN address (`spur serve --host 0.0.0.0`) is usable while a malformed origin still fails loud (a68ce3a)
<!-- src: apps/board/src/shared/api.ts:172 -->

### Fixed

- fix(store): widen the `ai-news` extract allowlist to the whole AI taxonomy (`ai-news, ai-industry, ai-technical, ai-research`), in lockstep with the workflow's `qc_categories`, so the extract profile no longer closes the day as no-content upstream of the widened QC gate (479a257)
<!-- src: plugins/kk/decisions/extract/ai-news.yaml:21 -->
- fix(decisions): record the Apple Foundation Models CLI licence precondition in the migration runbook — until `sudo fm license` is accepted every `fm-local` decision answers `no-backend` and `kk-item-category` falls back to `non-ai`, which starves the `ai-news` pool even though collection worked (c940606)
<!-- src: docs/migration.md:180 -->
- fix(daily): restore the pre-revision VoiceScript structure inside the safety budget when the remediation pass drops a spoken item, so the run converges in the gate instead of dying hours later at the TTS seam with `plan item count (6) does not match script item sections (5)` (1dc218e)
<!-- src: plugins/kk/scripts/daily-stages.ts:2209 -->
- fix(daily): count the episode's included items as plan items minus the article's `metadata.excludedIds`, via the shared `expectedItemSections` that `daily-generate` and `daily-safety-revise` both read, so a recorded exclusion no longer fails the run (8c21fee)
<!-- src: plugins/kk/scripts/daily-stages.ts:2184 -->
- fix(decisions): route the four labelling decisions back to `fm-local` after the operator accepted the FM1 licence, keeping them named explicitly so an unlicensed machine fails visibly instead of silently emptying the pool (2874ee6)
<!-- src: .spur/config.yaml:265 -->
- fix(wechatmp): raise the readiness poll's `PROFILE_OVERHEAD_MS` reserve from 8s to 25s so a cold `KK_BROWSER_CHANNEL=chrome` start fits inside the deadline and reports the real `refused` verdict instead of `malformed probe output` (f27b99b)
<!-- src: plugins/publishings/wechatmp-pub/src/profile-check.ts:35 -->
- fix(plugin): raise the `kk plugin check` default timeout to 60s so the parent deadline outlasts a browser probe's own 30s auth wait, which it previously raced into `probe exit 1 (malformed probe output)` (39a2f4a)
<!-- src: apps/cli/src/commands/plugin.ts:209 -->
- fix(wechatmp): add dialog-scoped audio and cover upload-input fallbacks for this build's bare `input[type=file]` and `image/bmp, image/png, …` accept list, which every accept-qualified candidate missed and left the draft without its player and covers (6868ac0)
<!-- src: plugins/publishings/wechatmp-pub/src/flow.ts:218 -->
- fix(wechatmp): read the 原创 committed probe from the visible `#js_original` row branch instead of an unscoped union that matched the open dialog's hidden template, so a fresh draft no longer reads as uncommitted and re-opens rows it already committed (45ba558)
<!-- src: plugins/publishings/wechatmp-pub/src/enrich.ts:95 -->
- fix(wechatmp): repair the 文章 settings rail to the measured 2026-10-21 editor — 原创 from `#js_original .setting-group__content-info` with its own `确定`, 创作来源 from `.allow_click_opr` with its own `确认`, and 原文链接 through its measured popover with an asynchronous-close wait and row readback — then replaying the production rail on a fresh editor with nothing saved or published (6126369)
<!-- src: plugins/publishings/wechatmp-pub/src/enrich.ts:55 -->

### Changed

- chore(daily): pause the XHS target in the voice2 workflow (`xhs_enabled: "false"`) until the evidence gap is explained — the plugin reported today's draft as saved while the console showed the operator none (953cc32)
<!-- src: plugins/kk/workflows/kk-daily-ai-voice2.yaml:56 -->
- docs(agents): resolve the stage-body sync target from `command -v kk` instead of a hard-coded path, because this machine carries a live bun-global install and a stale `~/node_modules` copy that left two merged daily-run fixes inert (261b3b1)
<!-- src: AGENTS.md:215 -->
- docs(wechatmp): record the sixth measurement pass over the 2026-10-21 draft's warnings — the audio-input miss, the probe-6 settings shapes, and the rail repair that followed (f1543b2)
<!-- src: docs/design/wechatmp-ui-discovery.md:42 -->
- docs(wechatmp): refine 0318's R1–R5 to the measured selectors and the per-dialog confirm labels, so the requirement rows name what the build actually renders (5ff479d)
<!-- src: docs/tasks/0318_wechatmp-settings-rail-measure-and-repair-entries.md:48 -->

## [0.1.7] - 2026-10-20

### Fixed

- fix(daily): name the intro sting under `~/.config/kk/voices/` and expand `~/` / `$HOME/` in `dailyIntro`, because the quoted `"${vars.intro_music}"` argument reaches the stage unexpanded (fe24fed)
<!-- src: plugins/kk/scripts/daily-stages.ts:1324 -->

### Changed

- docs(migration): transport the whole `.works` tree instead of only the store, and record the diverge-then-merge procedure — halt the scheduler, then merge `collect_runs` → `items` → `labels` by explicit id (9cee53d)
<!-- src: docs/migration.md:260 -->
- docs(migration): back the works-tree completeness claim with a file-level diff — 0 source-only paths against 48 target-only ones (be58434)
<!-- src: docs/migration.md:574 -->
- docs(migration): verify the final-state claims and restate the rollback as a two-command sequence, with only the `launchctl enable` half exercised (3f1298b)
<!-- src: docs/migration.md:596 -->
- docs: retarget the intro sting to the config root in migration C7 and the segmented-episode note, dropping the retired `.works` symlink (93a4f54)
<!-- src: docs/migration.md:26 -->

## [0.1.6] - 2026-10-20

### Added

- feat(kk): add the measure-only `kk stage audio-quality` diagnostic — cepstrum echo peak, pause floor, offset decay curve and band balance, registered lazily in the runner (6381a52a)
<!-- src: plugins/kk/scripts/kk-workflow-stages.ts:1655 -->
- feat(rules): gate the closed `HIGH|MEDIUM|LOW` confidence vocabulary with a checker that reads every declared array, jq accept-edge and comparison chain (aab95930)
<!-- src: .spur/rules/surface/confidence-level-enum.yaml:42 -->
- feat: stamp `sub-category:ai-daily` on every daily article this generator emits (481e0960)
<!-- src: plugins/generations/daily-article-gen/src/index.ts:127 -->

### Fixed

- fix(kk): fail a daily run at minute 0 when the installed stage runner lacks a stage its workflow invokes (fb36a65e)
<!-- src: plugins/kk/scripts/daily-stages.ts:1999 -->
- fix(cli): keep the TypeSafe decision response readable under Bun by handing the SDK an already-buffered response (1ee84e1f)
<!-- src: apps/cli/src/decision-hub.ts:286 -->
- fix(rules): treat a confidence comparison chain split across lines as one site, so a dropped level is caught (da2f1438)
<!-- src: .spur/rules/surface/confidence-level-enum.sh:75 -->

### Changed

- chore(spur): retire the `feature-verification` wrapper references — add the `spur-check-feature` action target and drop the two assertions that required the deleted workflow (b5f9ae87)
<!-- src: package.json:35 -->
- docs(voxcpm): record the 40 ms echo lattice and keep voxcpm as primary under monitoring, with gemini as the measured-dry escape hatch (be94c265)
<!-- src: docs/00_ADR.md:1391 -->
- docs(voxcpm): cite the model-API claims in the plugin README and register that file in the citation rule (35dea34f)
<!-- src: plugins/generations/voxcpm-tts/README.md:112 -->
- docs(adr): cite the 2026-10-20 API and version claims — the SDK body drain, the spur 0.4.15→0.4.16 SDK jump, the `voxcpm` `_generate` signature (3223c622)
<!-- src: docs/00_ADR.md:1352 -->
- docs(voxcpm): name the monitored lattice in the generate tier's description (bf7cdc53)
<!-- src: plugins/kk/workflows/kk-daily-ai-voice2.yaml:564 -->
- docs: verify every migration claim in the mac mini runbook and withdraw the low-power-mode inference (92dc2845)
<!-- src: docs/migration.md:63 -->
- docs: correct the migration runbook for the bundle transfer and the laya runtime, removing the retired `feature-verification.yaml` (84666668)
<!-- src: docs/migration.md:125 -->
- docs: add the mac mini migration runbook for the scheduled jobs (6ac935a3)
<!-- src: docs/migration.md:1 -->
- docs: record the mac mini migration evidence, findings and cutover (cef927ed)
- docs: record the first live scheduled tick on the mac mini (c6f7ba24)
- docs(dogfood): index the 2026-10-20 daily-voice findings (868daba2)

## [0.1.5] - 2026-10-19

### Added

- feat(store): label items through an in-process decision hub, resolving the catalog from the checkout then the install (c68c2008)
<!-- src: apps/cli/src/decision-hub.ts:182 -->
- feat(board): rebuild the Collect module as six tabs — Summary, Run Details, Items, Selections, Progress, Config — keeping `?tab=` aliases resolving (9f38a42d)
<!-- src: apps/board/src/collect/index.tsx:79 -->
- feat(store): page collect selections at 25 rows and enrich item label detail (5f5fd977)
<!-- src: packages/kk-store/src/dao/collect-view.ts:17 -->
- feat(store): `kk store label --replay` reports `{replayed, labeled, consults, consultMs, refused, run}` so a refused answer is no longer invisible (1a3ace1c)
<!-- src: apps/cli/src/commands/store.ts:1011 -->
- feat: widen the daily extract window ×2/×3 when the pool misses `episode_min_minutes`, capped at 72h (ca13561b)
<!-- src: plugins/kk/scripts/daily-stages.ts:289 -->

### Fixed

- fix(cli): accept `127.0.0.1` and `localhost` on one port as the same loopback reader origin and echo the request origin (b3d405cb)
<!-- src: apps/cli/src/board/reader.ts:92 -->
- fix(board): clear the run modal's cached store row when the target run changes (c386399f)
<!-- src: apps/board/src/collect/index.tsx:346 -->
- fix: measure card headlines unwrapped against the shared text-panel height so a long headline steps down instead of pushing points past the safe bottom (ec9ad0a2)
<!-- src: plugins/generations/image-gen/src/compose/card.ts:303 -->

### Changed

- chore(project): bump the `@gobing-ai/ts-*` catalog to ^0.5.32 (ac76c50f)
<!-- src: package.json:18 -->
- chore: stop listing the installed package's catalogs under `decisions.paths` — a registered layer outranks shared and shadowed newer bundled copies (584eb6d5)
<!-- src: .spur/config.yaml:254 -->
- chore(config): restore the `laya-local` maker for `kk-item-quality` (467f66ee)
<!-- src: .spur/config.yaml:262 -->
- chore(config): pin feature completion's `check-feature` action to `bun run spur-check` (aeee4f02)
<!-- src: .spur/config.yaml:208 -->
- test: close the 0317 Collect console coverage and TSDoc gaps (cc545772)
<!-- src: apps/board/tests/collect/panels.test.tsx -->
- test(board): accept the six-tab Collect console in the installed suite (cf812efc)
<!-- src: apps/board/tests/installed-board.test.ts:659 -->
- test(cli): gate the stage cancellation cases on the child's ready file (7e65b704)
<!-- src: apps/cli/tests/stage.test.ts:264 -->
- test(cli): split the workflow var reference in the voice2 dag assertion (f436b996)
- test: cover the extract ladder's 72h cap and record that `kk stage` runs the installed scripts copy (3a928421)
<!-- src: AGENTS.md:203 -->
- docs(tasks): re-anchor the 0317 evidence and register G33 (74c029f8)
- docs(context): record the 0317 decision-maker learnings and pitfalls (cf530537)
- docs(context): scope the confidence-field learning to the reply surface (52671204)
- docs(config): record the 2026-10-19 laya re-check in decisions.makers (d4cf0848)
- docs(tasks): add new tasks (e803c6d3)

## [0.1.4] - 2026-10-19

### Added

- feat(board): enable the workflow modules from a plain install (51afdef)
<!-- src: package.json:24 -->

### Fixed

- fix: surface the cause of a plugin bundle failure (450af77)
<!-- src: scripts/bundle-plugins.ts:61 -->

### Changed

- docs(tasks): mark the lost check receipts as historical evidence (4548a0b)
- chore(rules): drop the orphaned verdict-artifact fixtures (e9cc3ca)
<!-- src: .spur/rules/fixtures -->
- docs(memory): update memory (05a243f)

## [0.1.3] - 2026-10-18

### Added

- feat(store): cluster near-duplicate stories by URL identity (0316) (465d6cf9)
<!-- src: packages/kk-store/src/story.ts:161 -->
- feat(itc): record the judge's confidence level in the run report (d79c27b7)
<!-- src: apps/cli/src/itc-publish.ts:705 -->
- feat(kk-itc): publish-tail DAG as the failed-run re-entry seam (60cadb03)
<!-- src: plugins/kk/workflows/kk-itc-publish-tail.yaml -->
- feat(board): collect store views for the Collect module (G81 0307-0309) (3de9ac27)
<!-- src: packages/kk-store/src/dao/collect-view.ts -->
- feat(board): redesign the Collect module with Overview, Run detail and Items tabs (741a7c3b)
<!-- src: apps/board/src/collect/panels.tsx:63 -->
- feat(x-pub): add the article-zh profile (b447f390)
<!-- src: plugins/publishings/x-pub/plugin.json:50 -->
- feat(wechatmp-pub): fall back to metadata.coverImage for the article cover (c4a814d2)
<!-- src: plugins/publishings/wechatmp-pub/src/modes.ts:231 -->
- feat(board): serve read-only Collect store projections from the kk board reader (7179f9da)
<!-- src: apps/cli/src/board/collect-store.ts:158 -->
- feat(rules): gate confidence levels in run-plane review/verify answers (07ba7ec5)
<!-- src: docs/00_ADR.md:1480 · the rule family was retired by ADR-041 -->
- feat(kk): land A23 bot session facts and bot exec (76caf1e2)
<!-- src: packages/publish-harness/src/bot.ts -->
- feat(kk): add kk bot exec with a curl option subset (5f2e575f)
<!-- src: apps/cli/src/byte-output.ts:27 -->
- feat(kk): record bot session facts at login and show them in kk bot list (fd6ff8d6)
<!-- src: packages/publish-harness/src/bot.ts:36 -->

### Fixed

- fix(store): merge summary-class twins via a lone reference URL (0316) (193ff9a6)
<!-- src: packages/kk-store/src/dao/items.ts:184 -->
- fix(workflow-run): drop workflows_dir from the first-run config template (7a38e0f0)
<!-- src: plugins/kk/commands/workflow-run.md:70 -->
- fix(cli): default the works root to <cwd>/.works, never the config root (d283ce71)
<!-- src: apps/cli/src/itc-config.ts:372 -->
- fix(kk): bind the HITL review gates to a decision point (1236 R3) (77c30e9f)
<!-- src: plugins/kk/workflows/kk-itc-author.yaml:79 -->
- fix(itc): redact config-injected values a probe echoes in its refusal detail (c06461bc)
<!-- src: apps/cli/src/itc-publish.ts:361 -->
- fix(kk): stop the ai-news pool profile front-running the thin-day QC backfill (08881724)
<!-- src: plugins/kk/decisions/extract/ai-news.yaml:20 -->
- fix(board): drop a previous run's response when the selection changes (76c7cf72)
<!-- src: apps/board/src/collect/index.tsx:199 -->
- fix(kk-store): stop a read-only open from converting the journal mode (770e3c44)
<!-- src: packages/kk-store/src/db.ts:79 -->
- fix(itc): never resend an unknown-effect live target; close the 0314/0315 residuals (430b9a8c)
<!-- src: apps/cli/src/itc-publish.ts:432 -->
- fix(itc): hand the readiness probe the same plugin env as the exec path (1d929de6)
<!-- src: apps/cli/src/itc-publish.ts:342 -->
- fix(board): reset the item page when the selected run changes (8b2b5df9)
<!-- src: apps/board/src/collect/index.tsx:356 -->
- fix(board): read a WAL checkpoint as a read-only side effect (2269ed30)
<!-- src: apps/board/scripts/store-digest.ts:27 -->
- fix(kk-store): never set journal_mode on a read-only open (63ec8b10)
<!-- src: packages/kk-store/src/db.ts:69 -->
- fix(kk): close the bot exec curl-parity gaps and redact redirect URLs (cfa8dd41)
<!-- src: apps/cli/src/commands/bot.ts:250 -->
- fix(itc-publish): re-dispatch re-attempts and surface probe refusal detail (0b9207c5)
<!-- src: apps/cli/src/itc-publish.ts:353 -->
- fix(itc-publish): hand plugins an absolute cover path (edfc87c1)
<!-- src: apps/cli/src/itc-publish.ts:52 -->
- fix(kk): write the itc author run ledger with jq, not a heredoc (bd1dc162)
<!-- src: plugins/kk/workflows/kk-itc-author.yaml:40 -->
- fix(spur): align feature-verification with the current CLI surface (c0875e47)
<!-- src: plugins/kk/workflows/feature-verification.yaml -->

### Changed

- docs: correct stale 0317 citations to 0311 R3 (fb2b3865)
<!-- src: apps/cli/src/itc-publish.ts:361 -->
- docs(tasks): add 0317 follow-up for horizon-ingest outbound-link stripping (29a7d32a)
- docs(tasks): updat tasks after verification (7fda350c)
- docs: sync 03/04 architecture and design with story clustering by URL identity (0316) (43ce5d74)
<!-- src: docs/03_ARCHITECTURE.md:150 -->
- test: move test scratch dirs from repo root to .works/tmp/ (bcd2a9dc)
<!-- src: AGENTS.md:260 -->
- docs: add ADR-042 splitting the config root from the works root (8da0c6ad)
<!-- src: docs/00_ADR.md:1492 -->
- docs(tasks): updat tasks after refinment (382514bf)
- chore(project): upgrade project dependencies (58489267)
<!-- src: package.json:15 -->
- docs(board): record the read-only store residual as resolved (0309 #6) (e24142e7)
- docs(tasks): re-anchor the Collect-board redesign evidence tables (0308, 0309) (7151b54b)
- chore(rules): drop dangling references to the retired confidence rule (0ece1f9f)
<!-- src: .spur/rules/structure/api-library-claim-citation.yaml:8 -->
- docs(tasks): re-anchor the Collect-board evidence table (0307) (7dfedbc4)
- docs(design): record the DAG mid-run fresh-start harness limitation (0f4c0691)
<!-- src: docs/design/kk-itc-refactor.md:225 -->
- docs(report): add the 2026-10-18 history-anatomy report (b5366333)
<!-- src: docs/report/2026-10-18-history-anatomy.md -->
- docs(tasks): re-anchor the ITC and bot evidence tables to this run (6b454671)
- test(kk): capture bot usage errors through the output seam (c6642038)
<!-- src: apps/cli/tests/commands/bot.test.ts:95 -->
- chore(rules): retire the confidence-level rule family (ADR-041) (a38288a4)
<!-- src: docs/00_ADR.md:1480 -->
- docs(tasks): file the daily-voice residuals as 0316 (bbe91b42)
- test(kk-store): pin the ai-news importance gate at 2 (aeae8e16)
<!-- src: packages/kk-store/tests/profile.test.ts:43 -->
- docs(features): register the G211 and G212 profile-aware publish features (45fc3240)
<!-- src: docs/features/INDEX.md:79 -->
- test(board): extract the store-digest classifier and close the 0312/0313 residuals (3861c3d1)
<!-- src: apps/board/scripts/store-digest.ts:38 -->
- test(board): cover the live-store checkpoint classification (58bcbe26)
<!-- src: apps/board/tests/scripts-live-digest.test.ts -->
- docs(kk): record the A23 bot.json facts in the A22 satellite (04ca5db0)
<!-- src: docs/design/kk-noun-verb-bots.md:67 -->
- docs(context): record the G81 batch lessons and pitfalls (50801997)
- chore(corpus): re-file the G81 batch residual follow-ups as 0312 and 0313 (4b5a9ef0)
- chore(corpus): drop colliding residual follow-ups before landing (938944eb)
- test(board): verify the Collect module on the installed Board and the live store (56c38412)
<!-- src: apps/board/scripts/verify-collect-live.ts -->
- docs(report): add the 2026-10-17 history-anatomy report (834ce08a)
<!-- src: docs/report/2026-10-17-history-anatomy.md -->
- docs(corpus): re-anchor the A23 verification records (794ee2aa)
- docs(kk): document the A23 harness API rows in the surface table (24ef8aa9)
<!-- src: docs/04_DESIGN.md:84 -->
- docs(corpus): file kk-itc dogfood follow-ups (21227670)
- chore(kk): add the itc-main publish preset (f667d41e)
<!-- src: .kk/publish-presets/itc-main.json -->
- docs(features): record A23 done (078177d2)
<!-- src: docs/features/A23_kk-bot-session-facts-and-authenticated-exec.md -->
- docs(kk): plan G81 collect module redesign as three tasks (78b4a0c6)
<!-- src: docs/features/G81_collect-module-redesign-store-backed-run-results-progress-and-yield.md -->
- docs(kk): accept read-only Collect store views over the kk store (ea549852)
<!-- src: docs/design/collect-store-views.md -->
- docs(kk): plan A23 bot session facts and bot exec (0e75b9d5)
<!-- src: docs/features/A23_kk-bot-session-facts-and-authenticated-exec.md -->

<!--
Verification (2026-10-18, sp-dev-changelog): HIGH
- Coverage: 66 bullets = 66 commits in the exact range @gobing-ai/knowledge-kit-v0.1.2..fb2b3865
  (`git rev-list --count @gobing-ai/knowledge-kit-v0.1.2..fb2b3865` -> 66), each short hash exactly once
  (the section's hashes against `git log --format=%h <range> | sort` -> empty diff in both directions,
  0 duplicates). The tip is pinned to fb2b3865, the HEAD at generation time, so the count stays
  checkable after this entry lands (HEAD is deliberately not the range end). `g8-0255-parked` is not an
  ancestor of HEAD, so `git describe --tags --abbrev=0` resolved the range start to
  @gobing-ai/knowledge-kit-v0.1.2.
- Mapping: feat->Added 12, fix->Fixed 18, docs 24 + test 6 + chore 6 -> Changed 36 (12+18+36 = 66). The
  header carries the operator-supplied `--version 0.1.3`; no tag exists for it (`git tag -l "*0.1.3*"` ->
  empty) and apps/cli/package.json:3 still reads 0.1.2, so this section names a planned version, not a
  published artifact.
- Claim annotations: 53 of the 66 bullets assert what code, a workflow, a config, a rule or a checked-in
  artifact does and carry exactly one `src:` comment holding one anchor — 40 `path:line`, 13 whole-file
  path. The other 13 are bookkeeping — task status records, evidence-table re-anchors, corpus filings,
  context entries — and carry none, the same line the 0.1.0 and 0.0.35 entries drew.
- The two merge commits carry a path anchor rather than a line, because the bullet claims what the merge
  landed: 3de9ac27 cites packages/kk-store/src/dao/collect-view.ts, 76caf1e2 cites
  packages/publish-harness/src/bot.ts.
- Anchor derivation: each anchor comes from that commit's own `-U0` added lines
  (`git show -U0 --format= <hash> -- <path>`) matched back into the working tree, then the cited line was
  read in the tree to confirm it carries the claimed behaviour — not copied from a hunk header, which
  drifts. An artifact deleted later in the same range cites its owner instead: 07ba7ec5 (the
  confidence-level run-plane gate) cites docs/00_ADR.md:1480, because ADR-041 deleted its rule files.
- Confidence: HIGH — coverage and mapping reconcile against `git log` for the range, `git show --stat`
  confirms every cited file exists at the cited path, all 40 `path:line` anchors were re-read in the tree
  (e.g. packages/kk-store/src/dao/items.ts:184, apps/cli/src/itc-publish.ts:705,
  plugins/kk/decisions/extract/ai-news.yaml:20), and the level is earned by those citations.
  Deliberately NOT claimed: this entry verifies provenance — range, mapping, anchors, the level — not the
  truth of each commit message beyond the cited line, and no bullet's runtime behaviour was exercised;
  the 13 unannotated bullets rest on the bookkeeping classification above, so a mis-classified one would
  be unannotated rather than wrong. The rule that owns this check was retired by ADR-041, so it was run
  by hand from the pre-retirement revision — `git show a38288a4^:.spur/rules/structure/
  verification-confidence-level.sh` -> /tmp/vcl.sh, then `sh /tmp/vcl.sh CHANGELOG.md` -> exit 0 (this
  block carries exactly one `Confidence:` line and it cites); no gate enforces it now.
-->

## [0.1.2] - 2026-10-16

### Fixed

- fix(xhs-pub): retry a transient creator-console navigation once (1d3e3dc1)
<!-- src: plugins/publishings/xhs-pub/src/page.ts:191 -->
- fix(wechatmp-pub): end the probe inside its --timeout budget (d6ef3476)
<!-- src: plugins/publishings/wechatmp-pub/src/profile-check.ts:122 -->
- fix(kk): report the independent publish channels in the run report (70b70ae8)
<!-- src: plugins/generations/news-report-gen/src/index.ts:431 -->

## [0.1.1] - 2026-10-16

### Fixed

- fix(kk): carry the seo subject url outside the decision parameters (f88e3b05)
<!-- src: plugins/kk/scripts/seo-decisions.ts:109 · HIGH -->

### Changed

- chore(spur): drop the agent-usage-refresh bootstrap job (d574586b)
<!-- src: .spur/config.yaml · HIGH -->

## [0.1.0] - 2026-10-16

### Added

- feat(kk): ship the G9 smart-seo skill and installed acceptance (60f71909)
<!-- src: plugins/kk/skills/smart-seo/SKILL.md · HIGH -->
- feat(kk): run the Smart SEO workflow with validated narratives (task 0285) (4e651020)
<!-- src: apps/cli/src/stage.ts:103 · HIGH -->
- feat(kk): audit the finished episode for speaker consistency (advisory) (d5d7e02c)
<!-- src: plugins/kk/scripts/daily-stages.ts:470 · HIGH -->
- feat(seo): enrich audits with separate lab field and imported query evidence (task 0284) (a6f2f9af)
<!-- src: plugins/kk/scripts/seo-enrich.ts · HIGH -->
- feat(bilibili-pub): add bilibili shortVideo and dynamic publish plugin (0297) (22a0fe1d)
<!-- src: plugins/publishings/bilibili-pub/src/index.ts · HIGH -->
- feat(kk-itc): resolve entry config, workspace and Board child evidence (0303) (66907956)
<!-- src: apps/cli/src/itc-config.ts · HIGH -->
- feat(kk-itc): dispatch targets with isolated payloads and receipts (0302) (f17aedb6)
<!-- src: apps/cli/src/itc-publish.ts · HIGH -->
- feat(seo): assess SEO meaning through typed Spur catalogs with honest fallbacks (task 0283) (0d7b4f51)
<!-- src: plugins/kk/decisions/kk-seo-page.yaml · HIGH -->
- feat(kk-itc): persist bounded semantic decisions and child FSM (0301) (7467a90a)
<!-- src: apps/cli/src/itc-decision.ts · HIGH -->
- feat(voxcpm): add a speaker-consistency audit for rendered episodes (8ea9a159)
<!-- src: plugins/generations/voxcpm-tts/scripts/audit-speaker-consistency.py · HIGH -->
- feat(kk-itc): resolve topic channel presets with explicit target overrides (0300) (fdf6f9ca)
<!-- src: apps/cli/src/itc-plan.ts:9 · HIGH -->
- feat(seo): produce reproducible SEO assessments and stable prioritized reports offline (task 0282) (6a75683e)
<!-- src: plugins/kk/scripts/seo-report.ts · HIGH -->
- feat(kk-itc): select evidence-backed topics from collection store (0299) (b49c5f41)
<!-- src: apps/cli/src/itc-topic.ts · HIGH -->
- feat(kk-itc): plan publication from discovered plugin capabilities (0298) (c11264f8)
<!-- src: apps/cli/src/itc-plan.ts · HIGH -->
- feat(shipinhao-pub): add shipinhao shortVideo publish plugin with wujie shadow traversal (0296) (12cbd7f0)
<!-- src: plugins/publishings/shipinhao-pub/src/index.ts · HIGH -->
- feat(seo): collect bounded public-site SEO facts with robots and network enforcement (task 0281) (fa33c992)
<!-- src: plugins/kk/scripts/seo-fetch.ts · HIGH -->
- feat(kk): add voxcpm-first voice driver fallback chain to daily voice2 (9fe68296)
<!-- src: plugins/kk/workflows/kk-daily-ai-voice2.yaml:28 · HIGH -->
- feat: add filterable run selectors to board module headers (22606b52)
<!-- src: apps/board/src/collect/index.tsx:108 · HIGH -->
- feat(xiaoyuzhou-pub): add xiaoyuzhou podcaster draft-only audio publish plugin (0295) (2dafd7c6)
<!-- src: plugins/publishings/xiaoyuzhou-pub/src/index.ts · HIGH -->
- feat(sspai-pub): add sspai Matrix draft-only Markdown publish plugin (0294) (7e5507af)
<!-- src: plugins/publishings/sspai-pub/src/index.ts · HIGH -->
- feat(cnblogs-pub): add cnblogs Markdown article publish plugin (0293) (5330e3a2)
<!-- src: plugins/publishings/cnblogs-pub/src/index.ts · HIGH -->
- feat(csdn-pub): add CSDN Markdown article publish plugin (0292) (ae79691d)
<!-- src: plugins/publishings/csdn-pub/src/index.ts · HIGH -->
- feat(jike-pub): Jike dynamic-post publish plugin with topic tagging (0291) (914aed20)
<!-- src: plugins/publishings/jike-pub/src/index.ts · HIGH -->
- feat(wechatmp-pub): CGI draft creation and token extraction (0290) (d1ff02b3)
<!-- src: plugins/publishings/wechatmp-pub/src/cgi-draft.ts · HIGH -->
- feat(wechatmp-pub): CGI media pipeline — cover auto-crop and body image CDN migration (0289) (d46b2ca6)
<!-- src: plugins/publishings/wechatmp-pub/src/cgi-media.ts · HIGH -->
- feat(publish-harness): browser anti-detection and file-dialog suppression (0288) (71fe84e9)
<!-- src: packages/publish-harness/src/browser-anti-detection.ts · HIGH -->
- feat(kk-core): add content limit counting and thread segmentation (aaa59973)
<!-- src: packages/kk-core/src/content-limits.ts · HIGH -->

### Fixed

- fix(kk): generate the smart-seo test certificate via files, not /dev/stdout (3c2b829b)
<!-- src: plugins/kk/tests/smart-seo-collect.test.ts:249 · HIGH -->
- fix(smart-seo): fix issues with smart-seo (f4227fb6)
<!-- src: apps/cli/tests/smart-seo-installed.test.ts:108 · HIGH -->
- fix(kk): require the narrative answer file before the report step (1757a896)
<!-- src: plugins/kk/workflows/kk-smart-seo.yaml:133 · HIGH -->
- fix(kk): record seo decision timeouts as fallbacks, not cancellations (368f4714)
<!-- src: plugins/kk/scripts/seo-decisions.ts:149 · HIGH -->
- fix(kk): leave visibility unmeasured when no snapshot is supplied (829e9f5b)
<!-- src: plugins/kk/scripts/seo-enrich.ts:116 · HIGH -->
- fix(kk): emit deferred smart-seo rules as unknown, not not-applicable (64c8761f)
<!-- src: plugins/kk/scripts/seo-rules.ts:1517 · HIGH -->
- fix(kk): exclude informational rules from seo category scores (5ae498af)
<!-- src: plugins/kk/scripts/seo-rules.ts:1782 · HIGH -->
- fix(kk): record deterministic seo judgments with deterministic provenance (3651b8eb)
<!-- src: plugins/kk/scripts/seo-decisions.ts:332 · HIGH -->
- fix(kk): keep seo request timers armed until the body ends (08f78a5a)
<!-- src: plugins/kk/scripts/seo-fetch.ts:299 · HIGH -->
- fix(kk): state one FAQ rich-result retirement date across surfaces (512463f3)
<!-- src: plugins/kk/scripts/seo-rules.ts:487 · HIGH -->
- fix(kk): write the seo-score digest and seo-report markdown atomically (596fd415)
<!-- src: plugins/kk/scripts/seo-stages.ts:845 · HIGH -->
- fix(kk): correct the FAQ rich-result retirement date (5bcc77cf)
<!-- src: plugins/kk/scripts/seo-rules.ts:484 · HIGH -->
- fix(publishings): close the cnblogs-pub and xiaoyuzhou-pub re-verification gaps (296153f2)
<!-- src: plugins/publishings/cnblogs-pub/src/flow.ts:91 · HIGH -->
- fix(kk-core): hard-cut an over-long URL instead of one code point per segment (63981574)
<!-- src: packages/kk-core/src/thread-segmentation.ts:130 · HIGH -->
- fix(kk-itc): strip surrounding quotes from comma-list entries (cd8c8f1c)
<!-- src: apps/cli/src/itc-publish.ts:77 · HIGH -->
- fix(kk-itc): bind the run snapshot to receipts, decisions and outline autopick (ebc9c2d6)
<!-- src: apps/cli/src/itc-publish.ts:382 · HIGH -->
- fix(kk-itc): close the gaps the 0298-0303 verification left open (cfb2e0cf)
<!-- src: apps/cli/src/itc-config.ts:91 · HIGH -->
- fix(kk-itc): require a finish disposition before the workflow advances (ba672145)
<!-- src: plugins/kk/workflows/kk-itc-author.yaml:364 · HIGH -->
- fix(kk-itc): validate the topic pool and the plan inputs (5b2f4da3)
<!-- src: apps/cli/src/itc-topic.ts:107 · HIGH -->
- fix(kk-itc): verify the config keys and date the workspace leaf (1d8f6b4b)
<!-- src: apps/cli/src/itc-config.ts:230 · HIGH -->
- fix(omni-voice-gen): ship an instruct string the model accepts (2faeb3f2)
<!-- src: plugins/generations/omni-voice-gen/profiles.json:3 · HIGH -->
- fix(voxcpm): refuse a second segment on an instruct profile (2b561566)
<!-- src: plugins/generations/voxcpm-tts/src/voxcpm-client.ts:520 · HIGH -->
- fix(kk-itc): keep the packed bundle checkout-free and retarget the verdict tests (cf7343e2)
<!-- src: apps/cli/src/itc-plan.ts:126 · HIGH -->
- fix(publishings): close the unquoted javascript:/data: sanitizer gap and the CGI 摘要 parity gap (45281331)
<!-- src: plugins/publishings/bilibili-pub/src/flow.ts:120 · HIGH -->
- fix(voxcpm): ignore a per-request instruct on reference profiles (5acbe5e9)
<!-- src: plugins/generations/voxcpm-tts/src/voxcpm-client.ts:541 · HIGH -->
- fix(voxcpm): warn when an instruct profile is used (bc063f86)
<!-- src: plugins/generations/voxcpm-tts/src/voxcpm-client.ts:522 · HIGH -->
- fix(kk): calibrate the voxcpm spoken-char rate to its measured 5.19 字/秒 (225bac1c)
<!-- src: plugins/kk/scripts/daily-stages.ts:2031 · HIGH -->
- fix(kk): recalibrate gemini speech rate for the episode fit gate (b06f7b27)
<!-- src: plugins/kk/scripts/daily-stages.ts:2029 · HIGH -->
- fix(kk): harden plan-translate delivery for headless agy (0238 R2) (e49b2c9a)
<!-- src: plugins/kk/workflows/kk-daily-ai-voice2.yaml:264 · HIGH -->

### Changed

- docs(tasks): record G9 re-verification verdicts (0ab79f86)
- test: silence stage output in the itc and smart-seo suites (e5f3c5d7)
<!-- src: apps/cli/tests/capture.ts · HIGH -->
- docs(context): record the 0285/0286 dev-runall learnings and memory (4805e37b)
- test(publishings): replace non-null assertions in the CGI media fixture (71d9bb5d)
<!-- src: plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-media.test.ts · HIGH -->
- chore(merge): land the dev-runall 0285,0286 batch (G9 smart-seo) (8b576dd6)
- docs(design): mark the G9 smart-seo satellite shipped (5c1cdf63)
- docs(tasks): record the G9 batch verdicts for 0285 and 0286 (fb93d05b)
- docs(report): add the 2026-10-16 history-anatomy report (a257452c)
- docs(tasks): record the 0287-0297 verdicts and close E95-E98 (0137fdee)
- chore: ignore .zvec-grep and refresh the verification tooling (cf874ebf)
<!-- src: .gitignore:8 · HIGH -->
- docs(kk-itc): document the decision, plan, publish and topic contracts (7ac3d60b)
<!-- src: apps/cli/src/itc-decision.ts · HIGH -->
- docs(tsdoc): restore missing export docs required by the post-check gate (a945a37f)
<!-- src: packages/kk-core/src/manifest.ts · HIGH -->
- test(kk): add focused smart-seo cancellation, dispatch and narrative suites (4fcd7e9a)
<!-- src: plugins/kk/tests/smart-seo-dispatch.test.ts · HIGH -->
- docs(tasks): record the 0298-0303 verdicts as PASS (996d6284)
- test(kk-itc): cover the stage, request and verdict boundaries (bc2aee9b)
<!-- src: apps/cli/tests/itc-publish.test.ts · HIGH -->
- test(kk): cover the cancellable stage seam and the narrative validator (0c526ced)
<!-- src: apps/cli/tests/stage.test.ts · HIGH -->
- docs(features): home the kk-smart-seo workflow under G9 (c5215f99)
- chore: merge the 0285 Smart SEO workflow batch into main (29cd2030)
- test(kk): verify the confidence level on the auto disposition path (edcf1d93)
<!-- src: plugins/kk/tests/verdict-confidence.test.ts · HIGH -->
- docs(tasks): record the 0298-0303 pipeline verify verdicts (2f57ef38)
- docs(tasks): updat tasks after verification (d641b2db)
- docs: the indexed-context files are tracked, only the ledger is ignored (c9128d7a)
<!-- src: .gitignore:147 · HIGH -->
- chore(rules): retire the asserted-confidence rules and move seo test scratch to tmpdir (f4575741)
<!-- src: plugins/kk/tests/smart-seo-collect.test.ts:512 · MEDIUM -->
- chore: merge main into the G21 kk-itc batch branch (ad285f11)
- style(kk-itc): drop the unused ITC workflow constant (264d9470)
<!-- src: plugins/kk/tests/verdict-confidence.test.ts · MEDIUM -->
- chore: merge the G9 smart-seo batch (tasks 0281-0284) into main (36f20d93)
- chore: merge main into the G21 kk-itc batch branch (329cb3a0)
- refactor(kk-itc): route ITC stages through the FileSystem and output seams (34454e80)
<!-- src: apps/cli/src/itc-stage.ts:4 · HIGH -->
- chore: merge main (G21 kk-itc, voxcpm voice line) into the runall 0288-0297 batch branch (d7a6cfc8)
- docs(voxcpm): note that a per-request instruct is ignored on anchored profiles (980bc2c5)
<!-- src: plugins/generations/voxcpm-tts/README.md:88 · HIGH -->
- docs: record the clone's speaking rate against the instruct draws (fdc038a8)
- docs: record voxcpm speaker anchoring and the operator voice registries (0660d781)
- chore(voice): stop committing the operator voice clip (50bb37b6)
<!-- src: plugins/generations/omni-voice-gen/profiles.json:3 · MEDIUM -->
- docs(context): record the voxcpm driver-switch gates, rate calibration and daily-script cache pitfalls (617aaa33)
- docs: record voxcpm as the standing kk-daily-ai-voice2 default and its tiered voice chain (d5aefcdb)
<!-- src: plugins/kk/workflows/kk-daily-ai-voice2.yaml:28 · HIGH -->
- style(cli): narrow the voice-tier node lookup and assert the driver var without template syntax (bf6d2ece)
<!-- src: apps/cli/tests/voice2-dag.test.ts:1003 · HIGH -->
- docs: refine G21 kk-itc tasks to ready depth (abc34a1c)
- docs: accept ADR-040 and plan the G21 kk-itc refactor (fafc1ed3)
- docs: add 2026-10-15 history-anatomy daily report (e04d1865)
- docs(spur): record agy sandbox and staged-write pitfalls (722aa627)
- test(kk-core): add thread-segmentation coverage and TSDoc for base-red gate (e9b16a05)
<!-- src: packages/kk-core/tests/thread-segmentation.test.ts · HIGH -->
- docs: file the G9 0284 enrichment task (0f234f2d)
- chore: enable spur bootstrap sections (68970248)
<!-- src: .spur/config.yaml:24 · HIGH -->
- docs: accept ADR-039 and plan the G9 smart-seo audit feature (5628c6c8)
- docs: record yijianfa review and derive publisher features and tasks (dfe92ac5)
- refactor: consolidate board module styles into one shared board.css (7150f4dc)
<!-- src: apps/board/src/shared/board.css · HIGH -->

<!--
Verification (2026-10-16, sp-dev-changelog): HIGH
- Coverage: 102 bullets = 102 commits in the exact range @gobing-ai/knowledge-kit-v0.0.37..3c2b829b
  (`git rev-list --count @gobing-ai/knowledge-kit-v0.0.37..3c2b829b` -> 102), each short hash exactly
  once. The tip is pinned to 3c2b829b, the HEAD at generation time, so the count stays checkable after
  this entry lands (HEAD is deliberately not the range end). `g8-0255-parked` and `runall-f41-merged`
  are not ancestors of HEAD, so `git describe --tags --abbrev=0` resolved the range start to
  @gobing-ai/knowledge-kit-v0.0.37.
- Mapping: feat->Added 27, fix->Fixed 29, docs 25 + chore 10 + test 7 + style 2 + refactor 2 ->Changed 46
  (27+29+46 = 102). The header carries the operator-supplied `--version 0.1.0`; no tag and no release
  exist for it (`git tag -l "*0.1.0*"` -> empty) and apps/cli/package.json:2 still reads 0.0.37, so this
  section names a planned version, not a published artifact.
- Claim annotations: 76 of the 102 bullets assert something about code, a workflow, a config or a
  checked-in artifact and carry exactly one `src:` annotation comment holding one anchor and one level
  (73 HIGH, 3 MEDIUM). The other 26 are bookkeeping — task/feature status records, plan and report
  filings, context entries and merge commits — and carry none. Every anchor was re-read in the merged
  tree at 3c2b829b rather than copied from a commit's hunk header, and drifted anchors were corrected at
  read time (e.g. plugins/kk/scripts/seo-decisions.ts:332, apps/cli/src/itc-topic.ts:107,
  plugins/kk/scripts/daily-stages.ts:2029).
- The three MEDIUM bullets name the evidence their anchor does not cover:
  - f4575741 (retire the asserted-confidence rules): `.spur/rules/structure/verdict-confidence-proof.*`
    and `verdict-artifact-confidence-level.*` are deleted from the tree, so the cited test line covers
    only the tmpdir half of the subject.
  - 50bb37b6 (stop committing the operator voice clip): the untracked clip is a git fact (`git ls-files
    plugins/generations/omni-voice-gen/voices` -> empty, and `.gitignore` carries the guard), while the
    cited line is the profile that reads its instruct instead.
  - 264d9470 (drop the unused ITC workflow constant): the deletion exists only in that commit's diff, so
    the anchor names the containing test file.
- Source citations for API/library claims — every bullet asserting what an external system does, checked
  against the primary source rather than the commit that quotes it:
  - 512463f3 and 5bcc77cf carry Google's FAQ rich-result retirement date
    (plugins/kk/scripts/seo-rules.ts:487 and :484). https://developers.google.com/search/updates states
    "The FAQ rich result feature is no longer shown in Google Search results" and the May 7, 2026 removal
    date both lines carry.
  - d5d7e02c, bc063f86, 5acbe5e9, 2b561566 and 980bc2c5 rest on VoxCPM's speaker model.
    https://voxcpm.readthedocs.io/en/latest/usage_guide.html states "If you do not provide a reference
    audio, VoxCPM generates a random voice each time" and "the timbre will not stay consistent across
    calls", "Use `reference_wav_path` in Voice Cloning mode for a stable timbre", and "When Hi-Fi mode is
    enabled, the control instruction is ignored" — the mechanism those commits guard against. The
    within-episode spread that motivated them (2026-10-15, F0 swing) stays this repo's own measurement,
    recorded at plugins/kk/scripts/daily-stages.ts:470 and plugins/generations/voxcpm-tts/README.md:88.
  - Named, not confirmed: e49b2c9a's headless-agy sandbox denial and 2faeb3f2's acceptance of the new
    instruct string have no upstream source; both bullets are graded on the fix they name (a cited
    workflow line and a cited profile line), not on the third-party behaviour a commit comment asserts.
  - Every other annotated bullet asserts what this repo's own code, workflow, config or checked-in
    artifact does, so its path or path:line citation is the source of record and no external one is owed.
- Confidence: HIGH — coverage and mapping reconcile against `git log` for the range, `git show --stat`
  confirms every cited file exists at the cited path, each path:line anchor was re-read in the tree
  (plugins/kk/scripts/seo-rules.ts:487, packages/kk-core/src/content-limits.ts, .spur/config.yaml:24), and
  each externally changeable claim is quoted above from its primary source.
  Deliberately NOT claimed: this entry verifies provenance — range, mapping, citations, the level — not
  the truth of
  each commit message's own description beyond the cited line, and no bullet's runtime behaviour was
  exercised; both rules that own these two checks were run by hand over this file —
  `.spur/rules/structure/verification-confidence-level.sh CHANGELOG.md` -> exit 0 (this block carries
  exactly one level line, and it cites) and `.spur/rules/structure/api-library-claim-citation.sh
  CHANGELOG.md` -> exit 0 (that rule judges `API/library claim sources and confidence` tables, of which
  this file has none, so the citation evidence it would require lives in the per-bullet src comments and
  the URLs above instead); they are the only gates this section is checked against.
-->

## [0.0.36] - 2026-10-14

### Added
- feat(cli): bind named bot sessions to browser channels via browserSession descriptors (0277) (2617915c)
- feat(harness): named bot lifecycle with leases, transactions and CLI surface (0276) (52f7845e)
- feat(cli): canonical stage run and top-level lock acquire/release (0275) (39f03563)
- feat(kk): close a thin day as no-content on both refusal paths (0266) (4ff0587d)
- feat(kk): render the spur-serve keepalive as a schedule artifact (0265) (4b0d633b)
- feat(kk): probe the enabled publish sessions up front (voice2) (26c9c01b)
- feat(kk): ship the installed Board acceptance layer and the degraded-label warning (0255, 0268) (ba3a3600)
- feat(weibo): land the E94/0246 Weibo announcement channel (bd537df5)
- feat(weibo): send the app's own request headers on the page-api submit (0a9ee4b1)
- feat(weibo): submit posts through the mobile composer's own API (d446894e)
- feat(kk): add an opt-in VoxCPM voice driver to both daily workflows (08689ca5)
- feat(weibo-pub): post multi-image announcements through the mobile composer (44ff5421)
- feat(rules): gate the confidence level a Review record claims (9a7f31aa)
- feat(g8): land the Collection, Daily AI Voice and IT Content Board modules (0252-0254) (1ebfd524)
- feat(publish): land the E94 threads-pub and weibo-pub channels (0243-0246) (c0498d12)
- feat(publish): add threads-pub and weibo-pub publish channels (E94) (510d202e)
- feat(g8): inspect IT Content authoring runs and target results in the Board (5f1c647e)
- feat(rules): gate the review answer's confidence level (a4b5d1cf)
- feat(rules): add verdict-artifact confidence rule (8404b4d1)
- feat(g8): inspect daily voice DAG runs and multimedia results in the Board (586eb2a0)
- feat(g8): inspect collection runs through a native Board module and local reader (c5777c7c)
- feat(rules): require the API/library claim block on the declared registry (8bb4ced5)
- feat(rules): gate the verification answer's confidence level (2dc4e4e3)
- feat(rules): gate API/library claim citations and earned confidence (3cd49c5d)

### Fixed
- fix(ci): provision the @gobing-ai sibling tree the Board suite resolves against (ce1edd73)
- fix(wechatmp-pub): verify console steps against committed editor state (0260) (90dc440e)
- fix(ci): run the chromium install from apps/board to match the pinned playwright (b63bdda4)
- fix(ci): put the built kk on PATH and pin the Playwright chromium download (0bf49c54)
- fix(rules): read artifact mtimes GNU-first so the cutoff holds on Linux (f38b34fe)
- fix(workflows): declare terminalReason on every failure transition (ce58758f)
- fix(weibo-pub): keep article covers on the narrow extension set (8a95da66)
- fix: widen history-refresh scheduler cadence and timeouts (d9be04bd)
- fix(kk): make the daily duration refusal idempotent across a kill (a7f01774)
- fix(wechatmp-pub): re-measure the enrichment rail against the drifted console (0272) (91478ad7)
- fix(kk): anchor the daily-publish-partial marker to the run workDir (698d72e9)
- fix(kk): let a failed safety reviewer reach the gate (0270) (5d52ecf3)
- fix(image-gen): retry a transient provider failure before falling back (0269) (088913ef)
- fix(tests): unpin the decisions path list and stop the board fixture inheriting the nested-run guard (e0aec4c9)
- fix(kk): answer successful VoxCPM worker requests and record the matched audio comparison (0fdc5f74)
- fix(kk): close the remaining single points of failure in the daily run (610a53b7)
- fix(kk): harden the daily voice run against the failures of 2026-10-12 (1742d6e7)
- fix(kk): reach the shared decision catalogs and await the settings link (32182b55)
- fix(tasks): re-create the gate-determinism task as 0271 after a WBS collision (aa611214)
- fix(kk): stop serving an empty-pool report as a content run's cache hit (71ddd61e)
- fix(cli): bind the typesafe credential into rendered schedules (8219c737)
- fix(rules): judge a declared confidence level, not a mention or a suffix (d8be2227)
- fix(rules): judge claimed confidence levels, not mentions, and keep the answer suite hermetic (1e52058e)
- fix(kk): refuse a below-floor pool before the TTS spend (1092690c)
- fix(publishings): route the published-post patch through the FileSystem seam (62b67afa)
- fix(cli): 0248 overlap production fan-out and enforce the publisher deadline (f1447c2f)
- fix(kk): drop the trailing card point when no point can shorten (ebcd80db)
- fix(cli): pass the caller's environment to a spawned stage (1447c13c)
- fix(kk): carry the section segments into the joined episode content (4d3193b2)
- fix(cli): 0248 overlap production fan-out and enforce the publisher deadline (5fceda73)
- fix(wechatmp): close enrichment modals before the draft save (8791adc9)
- fix(kk): ensure daily audio has the requested publish MP3 (30aeecb3)

### Changed
- docs(task): record 0260 Solution/Review/Testing and park blocked pending attended run (3f239430)
- chore(project): upgrade project dependencies (a63105f3)
- docs: sync task and feature statuses across G11 and the index (f6a64570)
- docs(0280): cancel the retry-sibling task, fixture fix already shipped (5e432165)
- docs(0260): refine the enrichment contract against the offline audit (54782db3)
- docs(0280): replace the scheduling-race hypothesis with the identified cause (e07afeb7)
- docs(0276): retarget the check-receipt citation at the durable verdict (d68dd08a)
- chore(a22): record batch learnings, pitfalls and the synced feature index (6811a211)
- docs(a22): mark the feature shipped after tasks 0275-0278 verified (56e4ce51)
- docs(review): freeze the A22 caller inventory and migrate the kk-collect lock callers (0278) (b5dccf4e)
- test(cli): use a codex retry stub in the voice2-dag recovery ACs (82512a1a)
- chore: merge sp-dev-runall 0274,0279 into main (ba37034b)
- chore(wrap): sp-dev-runall 0274,0279 close-out writes (65d6b40e)
- docs(tasks): file 0280 for the voice2-dag retry-sibling flake (6536d008)
- docs(tasks): retarget dead run-scoped citations in done tasks (ebd6a5ed)
- test(cli): make the fan-in suite deterministic under load (8c35da26)
- chore(project): upgrade project dependencies (46123a80)
- test: reclaim a stale board build lock below the waiter deadline (d3d6a1e2)
- docs: refresh e94 verify citations and transition features to done (4907804e)
- test: harden load-flaky fanin leash and board tab coverage; refresh verify citations (4eb197b9)
- docs(tasks): refresh verify citations after the voice2 gate re-run (7a808917)
- test(kk): cover the unknown vdriver rejection in daily-generate (dd5d1ef9)
- docs(tasks): refresh verify citations across the voice2 batch (e2f6d3fc)
- test(kk): guard the daily suite against a stray voice2 workdir (bb53b4be)
- chore: merge main (G7 reopen, A22 plan, publish-partial anchor) into the runall batch branch (d1d06ed1)
- docs(features): reopen G7 with task 0279 for its dead citations (ed9ddb38)
- docs: plan A22, a strict noun-verb kk CLI with named browser bots (450f999d)
- docs(tasks): drop a transient temp-path citation from 0264 (c0fdefae)
- chore(wrap): dev-runall 0260,0264,0268 close-out writes (e4dea177)
- docs(features): reopen E92, hold G11 active, close G14 and 0248 (2cc0086c)
- docs(tasks): refine the G11 batch, cancel 0273, and file 0274 (9fbf841d)
- chore: merge main (tool pins) into the G11 batch branch (a5e05542)
- chore(tools): align the tool pins with the 1.4.3 Bun baseline (ca7fe0d0)
- chore: merge main (VoxCPM G14 line) into the G11 batch branch (2060ff91)
- docs(features): G11 back to active with the batch's closed tasks (8b4d2c5a)
- docs(tasks): file 0274 for the load-sensitive full gate and record the pitfall (5594c615)
- docs(features): mark G14 done after the feature-verification pass (051ea8a9)
- test(image-gen): cover the transient retry path (0269) (36ab886c)
- docs(dogfood): attribute the G14 VoxCPM voice-driver dogfood in the index (b45a7789)
- test(cli): pin the works root in the daily prepare tests (0267) (92d72250)
- docs(tasks): record the review confidence level for 0265 (b522bff0)
- test(cli): build the stage fixture in a child process (741a0cb5)
- docs(features): advance G14 to verifying after the 0258/0263 closes (ca1c607c)
- chore(tasks): drop the discharged VoxCPM follow-up task before landing (d1dd11cd)
- chore(wrap): 0258 close-out learnings (quota, fallback, driver-aware cache) (0acb884d)
- docs(tasks): file the VoxCPM worker success-response fix (b950f516)
- chore(wrap): dev-runall 0258,0263 close-out learnings (e6f946ad)
- docs(rules): put the G14 API/library claims under the citation registry (0eb858a8)
- docs(plans): record the 2026-10-12 VoxCPM/Gemini daily-audio comparison evidence (49d7ea2a)
- docs(tasks): record the audio-dialog recipe and the re-run hang in 0272 (11be7bd9)
- docs(tasks): record the 0269 and 0270 implementations (5be97d3b)
- docs(sp): record the worktree evidence-staging parity gap (008792ad)
- docs(tasks): record the 原创 mechanism and the 赞赏 account precondition (844405fc)
- test(kk): accept the installed decision catalog path (25137d53)
- docs(features): reopen G11 for its live tasks (7f107305)
- docs(tasks): file 0272 for the WeChat MP enrichment rail (96ba9fbd)
- docs(tasks): refine 0265 and 0266 against measured evidence (4b540f70)
- test(cli): stop measuring this host's jitter in the fanout concurrency tests (fefd9808)
- chore(wrap): dev-runall 0255,0268 close-out writes (fa1d930e)
- test(kk): scope the report-confidence verification to the voice2 path (6b553305)
- test(kk): verify the report-level confidence level on both sides of the gate (3d9afcf9)
- docs(tasks): file the XHS retry and safety-gate gaps from the 2026-10-12 run (02aca7a3)
- chore(project): upgrade project dependencies (fbe2a5fa)
- chore(project): upgrade project dependencies (a3c41223)
- chore(tasks): refine the follow-ups and file the label-degradation tasks (8a31367f)
- docs(weibo): close 0246 on the announcement channel (ffd90d35)
- docs(weibo): record the live verification of the announcement channel (c7b6ec9f)
- chore(tasks): file the G14 claim-registry and publish-artifact follow-ups (d5249772)
- chore(spur): move the kk-collect cron to :35 past each 6-hour slot (4502e5cf)
- test(cli): guard the fixture's fourth segment instead of asserting it (884960f3)
- docs(weibo): make 0246 runnable — scope it to the remaining work (bdf9f0a5)
- docs(weibo): record the confirmed account diagnosis and the announcement contract (b6d13931)
- docs(context): record the G14 worktree-batch learnings (5c7efc62)
- docs(weibo): make 0246 the episode-announcement channel, ready to re-implement (2f9c748a)
- docs(weibo): diagnose the silent send and make 0246 re-implementable (450ebe8b)
- docs(g8): retarget 0252's gate citation at the persisted receipt (47fcddf4)
- test(weibo): pin the entitlement-gated editor refusal; retire the two placeholder tasks (22bd504c)
- docs(g8): restore the claim blocks the merge resolution dropped (c0593c42)
- docs(tasks): add new tasks (bbcf0440)
- docs(tasks): add new tasks (8520e310)
- docs(context): record the E94 batch learnings (ea4e86ac)
- docs(weibo): keep the discovery note free of dead scratch citations (17ad25c4)
- chore(rules): require the claim block in ADR-035, architecture and design (15a06ffc)
- docs: evidence the API/library claims in ADR-035, architecture and design (f221659f)
- docs(tasks): updat tasks after refinment (99e87b80)
- docs: refine the G14 VoxCPM tasks against the current tree (3562c6c0)
- docs(G8): record the claim discipline and the 0252 handoff in the remaining tasks (5dab4812)
- docs(0252): record API/library claim sources and confidence (565cdfe9)
- docs: correct the E94 weibo/threads plan and add its ready audit (701c598b)
- test(cli): keep the daily stage tests off the repo's real anchor and markers (d555dcb3)
- docs(AGENTS): coverageThreshold is enforced per file, not on the aggregate (c8404540)
- test(wechatmp): cover the modal guard and name the blocking dialog (35ad36b2)
- chore(tasks): cancel 0259 — its subject was fixed by the 0248 wrap (2b5e141a)
- docs(fan-out): record the concurrent dispatch and its timeout in the owning docs (835c9381)
- docs(tasks): file 0260 for the wechatmp-pub console repairs (87f07fbd)
- refactor(surfdash-pub): own the published-post patch and drop the CMS gate (7f3d8c9b)
- docs(context): record the response guard's hedge-word dimension (2e0940e9)
- test(kk): write a real WAV in the daily-generate stub so the MP3 transcode can run (33840e6d)
- docs(G14): refine VoxCPM tasks to implementation readiness (5e7a9bfa)
- docs(G8): correct the Board surface claims after auditing installed Spur 0.4.2 (508e579e)
- docs(G14): decompose the VoxCPM driver plan into tasks 0256-0258 (e6b9a23c)
- docs(G14): add ADR-036 and the VoxCPM daily voice driver design (adf41778)
- docs(tasks): add new tasks (fd3efc0d)
- docs(G8): plan native Board visibility for the three key workflows (ffff1dfc)
- chore(spur): keep one physical home for repository workflows (0d26a73a)

### Other
- revert(image-gen): drop the plugin-side retry superseded by the stage-level retry (0269) (142c4397)

<!--
Verification (2026-10-14, sp-dev-changelog): HIGH
- Coverage: 162 bullets = 162 commits in the exact range @gobing-ai/knowledge-kit-v0.0.35..ce1edd73, each short
  hash exactly once, no bullet without a commit and no commit without a bullet
  (`git rev-list --count @gobing-ai/knowledge-kit-v0.0.35..ce1edd73` -> 162; bidirectional `comm -3` of
  `git log --format=%h` against the section hashes -> empty in both directions, 0 duplicates). The tip is
  pinned to ce1edd73, the HEAD at generation time, so the count stays checkable after the entry lands
  (HEAD is deliberately not the range end). The `g8-0255-parked` tag is not reachable from HEAD, so
  `git describe --tags --abbrev=0` resolved the range start to @gobing-ai/knowledge-kit-v0.0.35.
- Mapping: feat->Added 24, fix->Fixed 32, docs 64 + chore 22 + test 18 + refactor 1 ->Changed 105,
  revert->Other 1 (24+32+105+1 = 162). The header carries the operator-supplied `--version 0.0.36`; no tag
  exists for it (`git tag -l "*v0.0.36*"` -> empty), matching the 0.0.35 precedent of an uncut release.
- Source citations for API and library behavior claims: the section authors none — verified mechanically, not
  asserted: each of the 162 section bullets string-equals its commit subject (`git show -s --format=%s <hash>`
  vs the bullet text between `- ` and the trailing ` (<hash>)`; checked per bullet -> 0 mismatches), so every
  API/library/behavior token originates in a quoted commit subject and its source is that commit's diff, not
  an external doc. The only version strings are `1.4.3` (ca7fe0d0 "…1.4.3 Bun baseline") and `0.4.2`
  (508e579e "…installed Spur 0.4.2"), both inside quoted subjects, checkable via `git show -s ca7fe0d0` /
  `git show -s 508e579e`. Every claim in this verification is a local git fact cited with the
  command that checks it; the audited artifact is the `## [0.0.36]` section of CHANGELOG.md.
- The confidence level itself is earned and checked, not just declared: the contract — exactly one
  whole-word `Confidence: HIGH|MEDIUM|LOW` line per block, HIGH requires at least one evidence citation —
  is enforced by .spur/rules/structure/verification-confidence-level.sh:47,:76-98 (run by hand -> pass),
  and every load-bearing claim in this block reconciles mechanically: coverage 162/162 verbatim subjects
  (per-bullet `git show -s` string-equality), mapping re-derived from the subjects as feat 24, fix 32,
  docs 64 + chore 22 + test 18 + refactor 1 + revert 1 = 162, and the HIGH citation floor is met (the
  `CHANGELOG.md` dotted path above). Deliberately NOT claimed: HIGH covers this entry's provenance —
  coverage, mapping, citation — not the truth of each commit message's own description; the bullets are
  quoted subjects, not independently re-verified behavior claims.
-->

## [0.0.35] - 2026-10-10

### Added

- feat(kk): schedule the daily voice job on the voice2 store workflow at 04:30 (641b40ad)
- feat(wechatmp): fully automate the daily MP draft, and keep bookkeeping out of reader-visible bodies (7030e8d0)
- feat(kk): runall feature:G11 batch writes — 0250 voice2 stage-contract tests, 0251 xhs overflow retry (ac35573b)

### Fixed

- fix(kk): name the judge verdict path in the voice2 safety gate (3a07088d)
- fix(kk): match the voice2 MP 合集 tag to the real 每日AI资讯 collection (12a9ca6d)
- fix(dailynews-gen): derive the canonical date-only episode title (545536ae)
- fix(kk): retry xhs points whose truncation keeps length (5c894c74)
- fix(kk): pass the duration budget to daily-script and pin the safety-judge output path (5b25b0d4)
- fix(voice-gen): make the verify-retry budget configurable (9f80d6c6)
- fix(kk): bundle manifest-declared readiness probes at staging (5c18dd27)
- fix(kk): run the daily voice cron on hosted Gemini TTS and keep unattended safety escalations from halting it (532006c8)
- fix(kk): bundle manifest-declared readiness probes at staging (f1ad1986)
- fix(kk): keep the voice2 script inside the pre-spend budget (3330fd2e)
- fix(review): reject mismatched probe verdicts and triage runtime defects (a6c4f721)

### Changed

- docs(tasks): record 0212 dogfood PASS and 0251 fix evidence (79c698d6)
- docs(tasks): re-anchor evidence tables and clarify voice2 xhs retry comment (38273ba2)
- chore(git): land runall feature:G11 batch — 0250 voice2 stage-contract tests, 0251 xhs overflow retry (f7fb7554)
- docs(tasks): updat tasks after refinment (c6202f12)
- docs(tasks): add 0250 and 0251 voice2 backlog tasks (c0d19166)

<!--
Verification (2026-10-10, sp-dev-changelog): HIGH
- Coverage: 19 bullets = 19 commits in the exact range @gobing-ai/knowledge-kit-v0.0.34..3a07088d, each short
  hash exactly once, no bullet without a commit and no commit without a bullet
  (`git rev-list --count @gobing-ai/knowledge-kit-v0.0.34..3a07088d` -> 19). The tip is pinned to the commit
  BEFORE this changelog entry, so the count stays checkable after the entry lands (HEAD is deliberately not
  the range end). Two commits in the range share one subject — `f1ad1986` and `5c18dd27`, both
  "bundle manifest-declared readiness probes at staging" — and each carries its own bullet, one per commit.
- Mapping: feat->Added 3, fix->Fixed 11, docs+chore->Changed 5 (3+11+5 = 19). The header carries the
  operator-supplied `--version 0.0.35`. No release was cut and no tag exists for it, and
  `apps/cli/package.json:3` still reads 0.0.34, so this section names a planned version, not a published
  artifact.
- Source citations for API and library behavior claims (verified against the merged tree at line level):
  - hosted-TTS verify retries are budgeted by `VOICEBOX_MAX_VERIFY_ATTEMPTS`, default 2:
    plugins/generations/voice-gen/src/index.ts:220
  - the article's canonical episode title is `每日AI乱炖 · YYYY-MM-DD`:
    plugins/generations/daily-article-gen/src/index.ts:111
  - the voicescript default title derives that same date-only string:
    plugins/generations/dailynews-gen/src/script-builder.ts:373
  - the 选题边界 note is stripped from the published body and its ids move to `metadata.excludedIds`
    (regex at plugins/generations/daily-article-gen/src/index.ts:151, stripper at
    plugins/generations/daily-article-gen/src/index.ts:154, id hand-off at
    plugins/generations/daily-article-gen/src/index.ts:190)
  - the show-notes stage filters on `metadata.excludedIds` instead of re-parsing the note:
    plugins/kk/scripts/daily-stages.ts:1842
  - WeChat 文章 settings ride `metadata.wechatmp` — reward at plugins/kk/scripts/daily-stages.ts:1182,
    claimSource at plugins/kk/scripts/daily-stages.ts:1187, coverSource at
    plugins/kk/scripts/daily-stages.ts:1190, originalUrl at plugins/kk/scripts/daily-stages.ts:1191
  - the editor's 作者 field is filled from `metadata.wechatmp.author`:
    plugins/publishings/wechatmp-pub/src/flow.ts:733
  - the cover defaults to 从图片库选择: plugins/publishings/wechatmp-pub/src/flow.ts:557
  - the audio material is uploaded when the 素材库 holds no same-title entry:
    plugins/publishings/wechatmp-pub/src/flow.ts:1002
  - each settings row opens from its own row control (plugins/publishings/wechatmp-pub/src/enrich.ts:26)
    and 创作来源 takes the operator's stance text (plugins/publishings/wechatmp-pub/src/enrich.ts:174)
  - the MP 合集 is 每日AI资讯 in both workflows: plugins/kk/workflows/kk-daily-ai-voice.yaml:85,
    plugins/kk/workflows/kk-daily-ai-voice2.yaml:53
  - the voice2 safety judge names its verdict path prefix:
    plugins/kk/workflows/kk-daily-safety.yaml:76
  - voice1's `daily-script` receives the duration budget:
    plugins/kk/workflows/kk-daily-ai-voice.yaml:313
  - the daily voice job runs voice2 at 04:30: .spur/config.yaml:86, .spur/config.yaml:110
- Regression evidence (checks that fail without the cited behaviour):
  plugins/generations/daily-article-gen/tests/daily-article-gen.test.ts:191,
  plugins/generations/dailynews-gen/tests/dailynews-gen.test.ts:145,
  plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts:1100,
  plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts:1135,
  apps/cli/tests/voice2-dag.test.ts:641
- Confidence: HIGH — coverage and mapping reconcile against `git log` for the range, and every behaviour
  claim above cites the shipped source at line level. Deliberately NOT claimed: no release, tag or version
  bump (`apps/cli/package.json:3` still reads 0.0.34); the WeChat MP selector set for the audio-upload form,
  the 图片库 cover picker and the settings dialogs is fixture-tested but NOT yet verified against the live
  console, so the first live draft run is the outstanding evidence; and bun's per-file `coverageThreshold`
  behaviour (`bunfig.toml:10`) is an observation from one local experiment, not upstream documentation.
-->

## [0.0.34] - 2026-10-09

### Added

- feat(rules): keep the confidence level's proof in the durable verdict (1156) (525b2abd)
- feat(rules): verify the confidence level in task and feature records (cd22731d)
- feat(kk): let the workflow's episode window drive the pre-spend estimate (aae1f994)
- feat(kk): synthesize voice2 episode sections and join them (0237) (0772e7e0)
- feat(rules): fail dead run-scoped evidence citations (0247) (31f62375)
- feat(kk): pair each XHS note image with its text and upload the episode podcast note (0235, 0236) (90e45811)
- feat(store): dev-runall feature:G32 batch writes (0230, 0239, 0240, 0242) (902f78ae)
- feat(store): kk store v2 — schema, labels, facts, selections, decisions (b5984ed3)

### Fixed

- fix(rules): pin the scratch-citation fixture to the pre-repair revision (90d348e0)
- fix(kk): retry voice2 agent producers two tiers above the primary (a3b93c43)
- fix(kk): refuse a non-numeric episode window before synthesis (2705087e)
- fix(kk): guard the voice2 authoring agents on their own output (07897fa8)
- fix(kk): repair the plan envelope and the voice-rate calibration (0237, 0238) (d3fb9941)
- fix(kk): bound voice2 agent.run recovery and add the missing plan edges (0238) (ca4bc94f)
- fix(kk): name and gate every daily XHS note entry (0235, 0236) (4102168d)
- fix(kk-store): declare drizzle-orm as a direct dependency (e95f4244)
- fix(kk-store): stop the test suite and the daily probe migrating the live store (fa3ff1af)
- fix(kk): scaffold locales from the surfdash publish result (2061e964)
- fix(image-gen): stop prompting MiniMax for poster-style text (18af1f53)
- fix(kk): rework the daily voice2 disclosure and content path (011a4254)

### Changed

- test(kk): keep workflow runs' spur rows in the temp workspace (b029ebb6)
- chore(project): upgrade .gitignore (ad8faf80)
- docs(feature): update features after implementation (02da474b)
- docs(design): correct the superseded xhs_enabled clause (0247 wrap) (8ad16f8f)
- docs(tasks): close 0238 with the ac5-live-16 evidence (0237, 0238) (dcc5f15d)
- docs(tasks): correct the auto-appended live-run summaries (0238) (d61caff7)
- docs(tasks): record the voicebox-only rule and the kk-resolution hazard (0238) (92d17d8a)
- docs(tasks): record the live voice2 verification evidence (0237, 0238) (97768efa)
- build(plugins): keep a plugin's local .venv out of the bundle (a320162c)
- chore(project): upgrade project dependencies (f1ed5752)
- docs(tasks): add new tasks (4491347d)
- docs(project): close out G32 and propose the E94 publish channels (a54c1f6d)
- docs(tasks): re-verify G32 batch 0225-0242 and re-point stale anchors (4524f2d0)
- docs(changelog): re-earn the Unreleased block and capture the close-out learnings (09ab41d6)
- docs(tasks): updat tasks after verification (8f861bfa)
- docs(tasks): close 0242 — global kk upgraded, live store repaired, collector green (99623957)
- docs(changelog): close the G32 batch with an earned HIGH confidence level (a55aef75)
- chore(wrap): capture the G32 store-v2 batch learnings (0230, 0239, 0240) (e75232ff)
- docs(adr): ADR-025 amendment, one XHS visit may compose several notes (fcae1614)
- docs(tasks): refine 0235-0238 to implementation-ready and pin 0242's migrator (3034adc4)
- chore(project): add new scheduled job kk-collect (6dcc73fa)
- docs(tasks): refine remaining G32 tasks to implementation-ready (f0f6cb25)
- docs(tasks): bind 0241's ACs with command evidence and close it clean (4a7db505)
- docs(tasks): fill 0240/0241/0242 and close the incident record (c6b6a1cc)
- chore(tasks): promote 0239 (consolidated store-v2 residuals) to todo (40eb3eb3)
- chore(tasks): consolidate the store-v2 residuals and clear the last WBS collisions (27777998)
- chore(tasks): file 0238 for the daily DAG's agent.run artifact failures (b56fd503)
- docs(kk): correct the stale catalog-version prose and the 0230 config anchors (7c35e0dc)
- chore(wrap): capture the G32 batch learnings and the incident resolution (441df601)
- chore(tasks): G32 corpus — 0225–0229 done, 0230 failed, residuals filed (60d87b95)
- docs: record the store v2 cut-over (b8bf4e24)
- docs(kk): file G12 XHS notes and the G13 speech plan (5c6982a1)
- docs(store): plan the kk-collect store v2 cut-over (0f695d7d)

## [Unreleased]

### Added

- feat(store): kk store v2 — schema, labels, facts, selections, decisions (b5984ed3)
- feat(store): dev-runall feature:G32 batch writes — 0230, 0239, 0240, 0242 (902f78ae)

### Fixed

- fix(kk-store): stop the test suite and the daily probe migrating the live store (fa3ff1af)
- fix(kk): scaffold locales from the surfdash publish result (2061e964)
- fix(image-gen): stop prompting MiniMax for poster-style text (18af1f53)
- fix(kk): rework the daily voice2 disclosure and content path (011a4254)

### Changed

- docs(tasks): close 0242 — global kk upgraded, live store repaired, collector green (99623957)
- docs(changelog): close the G32 batch with an earned HIGH confidence level (a55aef75)
- docs: record the store v2 cut-over (b8bf4e24)
- docs(store): plan the kk-collect store v2 cut-over (0f695d7d)
- docs(kk): file G12 XHS notes and the G13 speech plan (5c6982a1)
- chore(tasks): G32 corpus — 0225–0229 done, 0230 failed, residuals filed (60d87b95)
- chore(wrap): capture the G32 batch learnings and the incident resolution (441df601)
- docs(kk): correct the stale catalog-version prose and the 0230 config anchors (7c35e0dc)
- chore(tasks): file 0238 for the daily DAG's agent.run artifact failures (b56fd503)
- chore(tasks): consolidate the store-v2 residuals and clear the last WBS collisions (27777998)
- chore(tasks): promote 0239 (consolidated store-v2 residuals) to todo (40eb3eb3)
- docs(tasks): fill 0240/0241/0242 and close the incident record (c6b6a1cc)
- docs(tasks): bind 0241's ACs with command evidence and close it clean (4a7db505)
- docs(tasks): refine remaining G32 tasks to implementation-ready (f0f6cb25)
- chore(project): add new scheduled job kk-collect (6dcc73fa)
- docs(tasks): refine 0235-0238 to implementation-ready and pin 0242's migrator (3034adc4)
- docs(adr): ADR-025 amendment, one XHS visit may compose several notes (fcae1614)
- chore(wrap): capture the G32 store-v2 batch learnings — 0230, 0239, 0240 (e75232ff)

<!--
Verification (2026-10-09, sp-dev-changelog): HIGH
- Coverage: 24 bullets = 24 commits in the exact range @gobing-ai/knowledge-kit-v0.0.33..99623957, each short
  hash exactly once, no bullet without a commit and no commit without a bullet
  (`git rev-list --count @gobing-ai/knowledge-kit-v0.0.33..99623957` -> 24). The tip is pinned to the commit
  BEFORE this changelog entry: the entry's own commit is excluded by construction, so the count stays
  checkable after it lands (HEAD is deliberately not the range end).
- Mapping: feat->Added 2, fix->Fixed 4, docs+chore->Changed 18 (2+4+18 = 24). The header is `[Unreleased]`: no
  version bump and no tag is claimed, because `apps/cli/package.json:3` still reads 0.0.33 and no release was cut.
- Source citations for API and library behavior claims (verified against the merged tree at line level):
  - store v2 labels observation identity: packages/kk-store/src/migrations.ts:161 (labels_observation_unique)
  - store v2 typed item facts: packages/kk-store/src/schema/items.ts:30, apps/cli/src/commands/store.ts:661
  - `0003_store_v2` episode_usage copy is collision-safe and deterministic (0239 R1):
    packages/kk-store/src/migrations.ts:183
  - schema-skew guard refuses a store newer than the binary (0242 R1): packages/kk-store/src/migrations.ts:312
  - a read-only open never migrates the store it reads (0242 R6): packages/kk-store/src/db.ts:66,
    apps/cli/src/commands/daily.ts:140
  - a score answer is a level position rounded to the nearest level, exact answer kept in raw_value (0240 R1):
    apps/cli/src/commands/store.ts:667-668
  - refused answers are counted per decision@maker in the label verdict (0240 R2):
    apps/cli/src/commands/store.ts:1052
  - mixed-script titles tokenize at the script boundary (0239 R5): packages/kk-store/src/story.ts:51
  - topic-scoped story exclusion rides the profile query (0228): packages/kk-store/src/dao/items.ts:441
  - decision catalog and per-decision maker routing: plugins/kk/decisions/kk-items.yaml:144, .spur/config.yaml:174
- Confidence: HIGH — coverage and mapping reconcile against `git log` for the range, and every behaviour claim
  above cites the shipped source at line level. Three claims are deliberately NOT made: no version, tag or
  release is asserted for this section (`apps/cli/package.json:3` still reads 0.0.33); no release was cut
  after the repair, so the global `kk` is still a `bun link` into this tree rather than a published artifact;
  and the G32 feature-scoped verification receipt is not claimed — it is `RUNNING` from an interrupted pass
  at `.spur/memory/evidence/G32-feature-verification.json`.
-->

## [0.0.33] - 2026-10-08

### Added

- feat(store): configure decision maker via .spur/config.yaml (82daa898)
- feat(store): source_counts in collect_runs and consult usage in label verdict (515b7b39)
- feat(kk): move publish completeness snapshot to terminal stage (0220) (94064ad8)
- feat(kk): opt daily XHS render into image-gen vendor fallback (0219) (0edcabb1)
- feat(kk): collect 6-hourly at fixed 04/10/16/22 local times (ee6ac814)
- feat: voice2 rollout — ledger cutover-check, dogfood fixes, docs sync (0212) (33b22874)
- feat(kk): 0211 R7 — move voice2-touched daily-* stages into plugins/kk/scripts/daily-stages.ts (852f5b0c)
- feat: require HIGH|MEDIUM|LOW report confidence on disposition-contract safety reports (ADR-033 R5) (7bd35596)
- feat(publish-harness): default kk browser launcher and headed channel checks (task 0214) (b6b623aa)
- feat(kk): add plugin check/login readiness probes (ADR-032, task 0215) (84380115)
- feat: narrow daily safety-gate escalate trigger to disposition:"escalate" findings (ce864ed2)
- feat(kk-store): HIGH|MEDIUM|LOW confidence on the kk-collect label surface (task 0213) (7552b050)
- feat(kk-store): topic profiles + `kk store extract|mark-used` (task 0210) (63911a07)
- feat(kk-decisions): decision catalog + `kk store label` heuristic-first labeling (task 0209) (c1a014e5)
- feat(kk-collect): standalone 4-hourly collection workflow (task 0208) (e10302b9)
- feat(ledger): add `kk ledger append|sync` — per-workflow run ledger (task 0207) (75a7c5bb)
- feat(e91): tasks 0191-0192 done — infoq/juejin dogfood with headed-only session gates (df825e45)
- feat(kk-store): add the kk SQLite store and the `kk store migrate` verb (4e3f349d)
- feat(kk): confidence-gated verdicts in web-automation verify gate (6cd63af4)
- feat(kk): web-automation skill + dual-workflow-engine design (a54f35d2)
- feat(e92): close tasks 0200-0205 with PASS verdicts; feature E92 done (8a45760e)
- feat(sp): task 0200 wechatmp attended items resolved — verdict upgraded PARTIAL→PASS (db2baf5f)
- feat(sp): task 0204 x publish console discovery — measured walk, draft-save proven (76ce3f72)
- feat(sp): task 0203 substack publish console discovery — measured walk, draft-save proven (d58046e9)
- feat(sp): task 0202 juejin publish console discovery — measured walk, draft-save proven (c4880e73)
- feat(sp): task 0201 infoq publish console discovery — measured walk, login + draft-save proven (11bcf9ce)
- feat(sp): task 0205 declared mode operations with named pre-browser refusal (635234ba)
- feat(sp): tasks 0203 0204 substack/x discovery blocked on missing profiles, blockers recorded (e5ccf912)
- feat(sp): task 0202 juejin discovery blocked at expired session, blocker recorded (4502a5d7)
- feat(sp): task 0201 infoq discovery blocked at expired session, blocker recorded (a8673a05)
- feat(sp): task 0200 wechatmp console re-measurement, draft signals and drift deltas (259450e4)
- feat(sp): task 0199 xhs publish console per-mode discovery with recorded UI drift (3451f46a)

### Fixed

- fix(image-gen): loopback font serving and deadline for chromium compose (8a76919b)
- fix(kk): add kk-collect collect-prepare stage, pass composition lint (84cd8cd0)
- fix(kk): read ledger sync summaries for the newest missing run only (6cee336f)
- fix(kk): stage output via echo targets, progress to stderr (0218) (ffae1a8b)
- fix: de-flake kk-itc dry-run walk tests with --no-log (0218) (d3c0ebe6)
- fix(e91): x article title mounts via display-div click; cover attaches through crop-dialog Apply (measured 2026-10-07) (f5b2926f)
- fix(e91): substack editorUrl uses bare /publish/post route (draft URL rewrite measured 2026-10-07) (b6417b8e)
- fix(kk): ledger refuses non-stem workflow names (path-traversal guard) (d0252bc0)
- fix(kk-collect): keep the label guard under spur's composition-lint limit (cde44526)
- fix(kk): gate-rule compliance for branch-exposed commands (store, daily) (c8ab8179)
- fix(cli): show a probe's own error detail in kk plugin check (76ce9b5f)
- fix(publishings): end probe exit-2 paths with an ADR-032 error verdict (b8a4ae71)
- fix(kk): keep headed-login cookies through headless channel checks (191937f6)
- fix(kk-daily-ai-voice): voicebox fallback when gemini quota probe fails (7fd290b4)
- fix(kk-daily-ai-voice): version-stamp the kk binary each run (2efeed1d)

### Changed

- docs(tasks): update 0212 re-verify evidence and set 0222 feature id (659feb3a)
- docs(context): record 0219 and 0220 wrapup learnings (0e10f4e7)
- docs(task): record completion for task 0220 (d567aac7)
- test(cli): add daily prepare formatRunDate coverage test (0220) (7ab7aaf7)
- docs(task): record completion for task 0219 (6221d553)
- docs(0212): record post-merge evidence notes (155df7b1)
- chore(context): append 0212 voice2-rollout learnings and pitfalls (7c612fa9)
- chore: merge sp/run-0212-e7d51f81 — voice2 rollout, ledger cutover-check, docs sync (0212) (043f4813)
- docs(tasks): capture stub issues 0222-0224 (unrefined, excluded from runall batch) (906fdd14)
- chore(0212): task record — verdict PASS, review findings table, plan checklist, solution backfill (07559468)
- docs(tasks): updat tasks after refinment (7e5e7351)
- docs: record sync-first ledger contract and re-point collect anchors (73b094ce)
- docs(tasks): updat tasks after verification (6a8ddc90)
- docs(tasks): updat tasks after verification (d9db69d9)
- test: unset SPUR_EXPECTED_DEFINITION_DIGEST in spawned workflow envs (75abc5aa)
- docs(e91): fold measured dogfood flows into design; feature done (053fa02a)
- refactor(e91): xhs reuses the shared harness waitUntil poll (0184) (4df9a442)
- test: make feature G's workflow-tree rules executable (0221) (739a3a4d)
- chore(spur): feature index update for G2 active (0218) (5d9c1410)
- chore(spur): task 0218 lifecycle corpus updates (feature G2 active, task history) (80869398)
- chore(e91): record wrap learnings; feature transition to done (361f1911)
- docs(e91): fold 0194 measured x-article title/cover contract into UI discovery (baa03aeb)
- chore(spur): record 0193 substack-pub dogfood pipeline sections (bf931846)
- docs(tasks): record task 0217 re-verification (PASS after fix pass) (14f9db94)
- test(store-docs): fail cleanly when the G31 feature file is missing (0217) (60dd476a)
- test(store-docs): drop hard-coded 0213 from the G31 status case; document the agreement invariant (0217) (4a520691)
- docs(tasks): record task 0217 verification and completion (e34b4561)
- chore: merge sp/0211-daily-voice2 — task 0211 done (DAG daily workflow, R7 plugin-owned stages) (5a054ea1)
- docs(tasks): updat tasks after verification (63044904)
- chore(kk): 0211 — record R7 solution, verify PASS, close task done (65e61d66)
- docs(G31): re-verify tasks 0206, 0208-0210 and 0213 (b27998dd)
- docs(G31): record the real feature status and a durable confidence inventory (6325c984)
- chore(context): append session memory log entry (bd72ded9)
- docs(E93): re-verify both tasks and close the feature (e17e68ab)
- chore(project): upgrade project dependencies (dfad707a)
- docs(e91): drop pasted task-0192 AC triple (duplicate AC3 scenario name) (2bb6051a)
- docs(tasks): updat tasks after verification (13681b7f)
- docs(E92): re-verify all seven tasks; close stale discovery-doc gaps (73949cc7)
- docs(tasks): updat tasks after refinment (ac22c851)
- chore(0211): park the partial 0211 implementation (UNVERIFIED, R7 incomplete) (9ed42dab)
- docs(tasks): point task 0211 at its parked partial branch (65f875b5)
- docs: record stale kk-install pitfall (bun link apps/cli) (e1c0701d)
- docs(tasks): refine 0217 and 0218 to todo (0b70da01)
- docs(kk): close 0216 — all six channels verified on the probe contract (94b9e527)
- docs(tasks): file 0217 and 0218 from the G31 batch session findings (c95f8cf5)
- chore(integration): merge sp/runall-g31-d3b771 onto main (889e8064)
- docs(memory): update memory (d9b0614e)
- docs: record 2026-10-07 robin-news voice death and renewal in gemini-tts runbook (e9e67c73)
- docs(kk): record task 0214 — launcher channel/steal fix corpus (9d89e661)
- docs(kk): plan the plugin check/login readiness probe (adr-032, e93) (39784a01)
- docs(tasks): updat tasks after refinment (77da04ff)
- chore(0206): record task 0206 done — kk-store verified and certified (90fb9117)
- test(kk-daily-ai-voice): expect quota-probe call in R5 plugin call log (17359a22)
- test(kk-daily-ai-voice): expect the gemini quota-probe render in the plugin call log (82875eab)
- docs(features): require HIGH|MEDIUM|LOW confidence on kk-collect and voice2 verdicts (c86a11c2)
- docs(sp): repurpose root G as the kk workflows parent; plan store + DAG (ad9ae1be)
- docs(sp): memory — E92 final close + L4 scenario-matcher learnings (8be647fe)
- docs(features): re-id feature Q as E92 under E9 (publish-channel UI fidelity) (9943fa4b)
<!--
Verification (2026-10-08, sp-dev-changelog): HIGH
- Coverage: 105 bullets = 105 commits in @gobing-ai/knowledge-kit-v0.0.32..HEAD, each short hash exactly once.
- Mapping: feat->Added 32, fix->Fixed 15, refactor+docs+chore+test->Changed 58. Header [0.0.33] - 2026-10-08
  matches --version 0.0.33 and `date +%F`.
- Source citations for API and library behavior claims (verified against commit source at line level):
  - configure decision maker via .spur/config.yaml: apps/cli/src/commands/store.ts:1017, .spur/config.yaml:162 (82daa898)
  - source_counts in collect_runs and consult usage in label verdict: apps/cli/src/commands/store.ts:245, :890 (515b7b39)
  - collect 6-hourly at fixed 04/10/16/22: plugins/kk/schedules/launchd.plist.tmpl:35, plugins/kk/schedules/cron.tmpl:13 (ee6ac814)
  - publish completeness snapshot moved to terminal stage: plugins/kk/workflows/kk-daily-ai-voice2.yaml:591 (94064ad8)
  - daily XHS render opted into image-gen vendor fallback: plugins/kk/scripts/daily-stages.ts:266 (0edcabb1)
  - daily-* stage handlers moved into plugins/kk/scripts/daily-stages.ts: plugins/kk/scripts/daily-stages.ts:7 (852f5b0c)
  - plugin check/login readiness probes (ADR-032): apps/cli/src/commands/plugin.ts:351, :361 (84380115)
  - HIGH|MEDIUM|LOW confidence on kk-collect label surface: apps/cli/src/commands/store.ts:348 (7552b050)
  - topic profiles + `kk store extract|mark-used`: apps/cli/src/commands/store.ts:914, :936 (63911a07)
  - decision catalog + `kk store label` heuristic-first labeling: apps/cli/src/commands/store.ts:721, plugins/kk/decisions/kk-items.yaml:1 (c1a014e5)
  - standalone collection workflow: plugins/kk/workflows/kk-collect.yaml:1 (e10302b9)
  - `kk ledger append|sync` per-workflow run ledger: apps/cli/src/commands/ledger.ts:215, :225 (75a7c5bb)
  - SQLite store and `kk store migrate`: apps/cli/src/commands/store.ts:47, packages/kk-store/src/migrations.ts:1 (4e3f349d)
  - default kk browser launcher and headed channel checks: packages/publish-harness/src/browser.ts:21 (b6b623aa)
  - loopback font serving and deadline for chromium compose: plugins/generations/image-gen/src/compose/chromium.ts:16, :68 (8a76919b)
  - kk-collect collect-prepare stage: plugins/kk/scripts/kk-workflow-stages.ts:35 (84cd8cd0)
  - ledger sync newest missing run selection: apps/cli/src/commands/ledger.ts:192 (6cee336f)
  - stage output via echo targets, progress to stderr: apps/cli/src/commands/stage.ts:15 (ffae1a8b)
  - ledger non-stem workflow name path-traversal guard: apps/cli/src/commands/ledger.ts:119 (d0252bc0)
  - probe error detail in kk plugin check: apps/cli/src/commands/plugin.ts:201 (76ce9b5f)
  - preserve headed-login cookies through headless channel checks: packages/publish-harness/src/browser.ts:29 (191937f6)
  - voicebox fallback on gemini quota probe failure: plugins/kk/workflows/kk-daily-ai-voice.yaml:24 (7fd290b4)
- Confidence: HIGH — coverage, mapping, and all 22 cited API behaviors verified at line level.
-->
<!-- verification: 22/22 API claims cited; confidence HIGH -->

## [0.0.32] - 2026-10-05

### Added

- feat(publishings): xhs multi-mode publish channel (ADR-029) (2f519fcb)
- feat(publishings): wechatmp multi-mode publish channel (ADR-029) (bb2fdfa3)
- feat(publishings): merge E91 browser publish channels (0183-0188) (f2e53bc9)
- feat(publishings): E91 browser publish channels on ts-browser-automation (16b7d517)
- feat(safety): adjust the drafts and exclude blocked platforms instead of failing the run (3c3923d0)

### Fixed

- fix(publishings): narrow the 草稿箱 scope back and drop the slow probe (3dce56e2)
- fix(publishings): broaden the 草稿箱 row scope and report the page URL on failure (371ea24b)
- fix(publishings): bound the MP draft-box step — navigate its route, never click (2b29cb20)
- fix(publishings): restore the MP session's localStorage half, and read the draft from 草稿箱 (6b999b0a)
- fix(plugin): enhance wechatmp (e4345e60)
- fix(plugin): enhance wechatmp (ca630448)
- fix(publishings): 一键排版 applies the layout directly — it is not an option menu (3f8b2d77)
- fix(kk-daily-ai-voice): heal the article cache pair when content.json is gone (99f492c6)
- fix(safety): never grade an unverifiable rule as a must-pass failure (85306223)
- fix(publishings): fix the E91 residuals directly and cancel their tracking tasks (5d3932de)

### Changed

- build: refresh the packaged plugin tree with the bundler (ff6dd87b)
- refactor(publishings): move the closed-shadow CDP probe into the shared harness (92a00d13)
- docs(adr): ADR-029 — a publish channel is one plugin, its types are operations (209148db)
- docs(corpus): de-obligate a deleted probe citation in task 0186 Review (e34b4dc2)
- docs(planning): feature Q + tasks 0199-0205 for publish-channel UI fidelity (ff3fdfb2)
- chore(project): upgrade project dependencies (c9c8f453)
- chore(project): update .gitignore (addb3eba)

<!--
Verification (2026-10-05, sp-dev-changelog): HIGH
- Coverage: 22 bullets = 22 commits in @gobing-ai/knowledge-kit-v0.0.31..HEAD, each short hash exactly once.
- Mapping: fix->Fixed 10, feat->Added 5, refactor+build+docs+chore->Changed 7. Header [0.0.32] - 2026-10-05
  matches --version 0.0.32 and `date +%F`.
- Confidence: HIGH — coverage and mapping reconcile against `git log` for the range; no behaviour claim beyond
  a commit summary is made in this entry.
- The level itself is earned and checked: the sourced artifacts are CHANGELOG.md:1 (this section) and the range
  `@gobing-ai/knowledge-kit-v0.0.31..HEAD`, and the contract is enforced by
  .spur/rules/structure/verification-confidence-level.sh:1 (run it by hand for file/line findings).
-->

## [0.0.31] - 2026-10-04

### Fixed

- fix(daily): keep plan headings and URL colons out of spoken copy (5a8daa83)

### Changed

- test(safety): verify the judge confidence contract on the producer side (59b9f0b0)

<!--
Verification (2026-10-04, sp-dev-changelog): HIGH
- Coverage: 2 bullets = 2 commits in @gobing-ai/knowledge-kit-v0.0.30..HEAD, each short hash exactly once.
- Mapping: fix->Fixed 1, test->Changed 1, Added/Removed/Other 0. Header [0.0.31] - 2026-10-04 matches
  --version 0.0.31 and `date +%F`.
- Source citations for behaviour claims that go beyond a commit summary (checked against the tree, not memory):
  - the gate that rejected the run: plugins/kk/scripts/validate-voicescript.ts:130 (CONTENT_SCAFFOLD_LABEL_RE),
    thrown at :175-176 for a segment that opens with a scaffold label.
  - heading strip: plugins/generations/episode-plan-gen/src/index.ts:261 (SCAFFOLD_HEADING_RE), applied per line
    in cleanBody at :266-269.
  - URL scheme colon exception: plugins/generations/dailynews-gen/src/script-builder.ts:125.
  - regression coverage: apps/cli/tests/kk-daily-ai-voice-content-quality.test.ts:135 (plan-body heading check)
    and :186 (the real daily-script stage).
  - producer-side confidence checks: plugins/kk/tests/verdict-confidence.test.ts:343 and :385; the enum this
    asserts is declared in plugins/kk/skills/content-judge/SKILL.md:33, and the reference filter compared
    against the guards is plugins/kk/skills/content-judge/references/workflow-integration.md:40.
- Confidence: HIGH — coverage and mapping reconcile against git; every behaviour claim cites a checked-in
  path:line.
-->

## [0.0.30] - 2026-10-04

### Added

- feat(executor): overlap fan-out targets instead of dispatching them in series (eb0c6bd9)
- feat(xhs): shorten the automation window from 24h to 2h (ADR-025 amendment) (69811801)
- feat(safety): require HIGH/MEDIUM/LOW confidence in every judge-verdict gate (c261d781)
- feat(safety): verify HIGH/MEDIUM/LOW confidence level on the safety-judge verdict (31c4cc2e)
- feat(daily): standing 15-20 min episode-duration gate with per-driver voice rates (d4d79f2f)
- feat(article-gen): fixed episode title AI 乱炖 · YYYY-MM-DD (fdb25538)
- feat(qc): episode floor backfills importance-only rejects on thin news days (a690cc58)
- feat(kk): quarantine judge-blocked drafts so a blocked run cannot stale-replay (2fef4adb)
- feat(image-gen): honour declared preset canvas on capable providers and record delivered size (0182) (95138490)

### Fixed

- fix(daily): report publish-tail completeness so a skipped channel cannot hide (59f7df5f)
- fix(safety): fail itc-report when a PASS carries no valid confidence (ef06cfab)
- fix(safety): stamp a confidence level in the publish-prep test fixture (57f80049)
- fix(daily): keep workflow prompts under the ADR-115 cap and repair duration-gate fixtures (92472142)
- fix(daily): match prefixed doc ids in show-note exclusions (73311e6b)
- fix(cli): reap timeout grandchildren via process-group kill, not pgrep alone (7e08ef24)
- fix(daily): ban source-free degree words in article/script prompts (judge claims warn) (4860e9e2)
- fix(daily): filter boundary-excluded docs from article references and show notes (9acd5103)
- fix(daily): propagate boundary-excluded docs from plan to script gate (c250c377)

### Changed

- refactor(plugins): drop vendored sp scripts for the installed pinned verifier (0175) (53c498f7)
- test(safety): cover TS verdict readers in the confidence consumer scan (721ce476)
- test(safety): execute the real judge guards against the confidence contract (1468cab1)
- test(image-gen): verify PresetSource.confidence enum (high/medium/low) (31865d43)
- chore(merge): integrate 0175 vendored-script removal into main (ba3a2c81)
- docs(tasks): updat tasks after refinment (6a51da50)
- docs(wrap): 0182 wrap-up — doc-sync, learnings, metrics, feature status (c81118bf)

<!--
Verification (2026-10-04, sp-dev-changelog): HIGH
- Coverage: 25 bullets = 25 commits in @gobing-ai/knowledge-kit-v0.0.29..HEAD (24 non-merge + the 0175
  integration merge ba3a2c81), each short hash exactly once.
- Mapping: feat->Added 9, fix->Fixed 9, docs/test/refactor/chore(merge)->Changed 7, unrecognized->Other 0.
  Header [0.0.30] - 2026-10-04 matches --version 0.0.30 and `date +%F`.
- Source citations for behaviour claims that go beyond a commit summary (checked against the tree, not memory):
  - engine executes one node at a time (eb0c6bd9): docs/03_ARCHITECTURE.md:105; concurrency lives in
    apps/cli/src/fanout.ts:150 (`fanout()`), the same split ADR-019 made for fan-in.
  - ADR-025 window is 2 h (69811801): plugins/publishings/xhs-pub/src/automation-guard.ts:36
    (`CAP_WINDOW_MS = 2 * 60 * 60 * 1000`).
  - ADR-115 prompt cap (92472142): apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:236-239 asserts the
    1000-char error tier for plan-translate/cover prompts.
  - 0175 installed-verifier migration (53c498f7, ba3a2c81): installed spur 0.3.99
    (/Users/robin/node_modules/@gobing-ai/spur/package.json), staged sp plugin 0.5.13
    (/Users/robin/.agents/scripts/sp/.superskill-stamp.json), repeatable check scripts/verify-sp-install.ts.
  - Remaining bullets cite their own diff as primary source; scopes spot-checked with `git show --stat`.
- Confidence: HIGH — coverage and mapping reconcile against git; every claim that asserts installed
  tool/library behaviour cites an installed path or a checked-in file, none rests on recollection.
-->

## [0.0.29] - 2026-10-02

### Added

- feat(kk): render daily XHS cards via composer with text-free prompts (F616 0181) (efa68094)
- feat(image-gen): deterministic Chromium text-card composer and text-free guard (F616 0180, 0181) (c810df18)
- feat(kk): gate every publishing run on a content-safety verdict (6800198d)
- feat(podcast-pub): add a footerNote option to show notes (0812ec02)
- feat(generations): disclose AI production in article and podcast output (46ae1e2d)
- feat(kk): reposition daily AI content as AI 乱炖 and harden publication review (23fa8950)

### Fixed

- fix(test): silence test console leaks; report image-gen E2E skips honestly (9affbe4e)
- fix(test): stop bun test discovery from matching gitignored vendors; raise per-test timeout (5185e072)
- fix(kk): match boundary keywords at word starts and judge dates by local day (0ce4633f)

### Changed

- chore: gitignore spur context freshness cache (1ea18396)
- chore(spur): ignore .spur/memory/runs; record F616 close-out learnings (f6b84d04)
- docs(tasks): record 0181 dogfood evidence; close feature F616 (dae079b6)
- docs(tasks): updat tasks after verification (2fe18b57)
- docs(tasks): record task 0189 verify verdict PARTIAL with re-anchored evidence (1e6b3c3d)
- docs(content-safety): harden injection stance and verify Apple Podcasts rules (0a13ac24)
- docs(tasks): updat tasks after refinment (3df3fde6)
- docs(tasks): updat tasks after refinment (be1aeda5)
- docs(tasks): updat tasks after refinment (f770e5ae)
- docs: add task 0189 to reposition daily AI content as AI乱炖 (3afb031f)
- docs: add E91 task batch 0183-0188 for browser publish channels (9b63a23a)
- docs: add feature E91 browser publish channels on ts-browser-automation (ef837f05)
- docs: add ADR-027 and browser-publish-channels design satellite (a1442ded)

<!--
Verification (2026-10-02, sp-dev-changelog): HIGH
- Coverage: 22 bullets = 22 commits in v0.0.28..HEAD, each short hash exactly once.
- Mapping: feat→Added 6, fix→Fixed 3, docs/chore→Changed 13, unrecognized→Other 0. Header version/date match --version 0.0.29.
- Source citations for API/library claims (verified against installed bun 1.3.14, not docs-from-memory):
  - `bun test --path-ignore-patterns` / `--timeout`: `bun test --help`, bun 1.3.14 (both flags present, exact wording matches usage in the test script).
  - `test.skipIf(condition): Test<T>`: node_modules/.bun/bun-types@1.3.14/node_modules/bun-types/test.d.ts:538 — installed types match the runtime version.
  - Chromium composer + text-free guard (c810df18): plugins/generations/image-gen/src/compose/card.ts:100 (`assertTextFreePrompt`), :145 (`cardHtml`, fixed-px safe-area typesetting); driver in src/compose/chromium.ts (same commit).
  - Content-safety verdict gate (6800198d): plugins/kk/scripts/kk-workflow-stages.ts:1578 reads `safety-judge_verdict.json`.
  - footerNote (0812ec02): plugins/publishings/podcast-pub/src/show-notes.ts:272,360; env wiring src/index.ts:142 (`PODCAST_PUB_FOOTER_NOTE`).
  - Remaining bullets cite their own diff as primary source; summary scope spot-checked against `git show --stat` (46ae1e2d, 0ce4633f, 23fa8950, efa68094).
- Confidence: HIGH — external-API claims verified against the installed toolchain; local behavioral claims cite file:line in the shipped source; no claim rests on unverified recollection.
-->

## [0.0.26] - 2026-09-29

### Added

- feat(wechatmp): wire WeChat MP draft target into the daily workflow (9958875a)
- feat(kk): best-practice defaults for daily-voice drivers (operator 09-29) (4adcf241)

### Changed

- refactor(wechatmp-pub): drive the WeChat MP console via ts-browser-automation (099110f5)
- refactor(kk): renumber daily-voice workspace stage dirs to unique tens (1b7bfdbd)

### Fixed

- fix(voice-gen): encode MP3 as CBR 64k instead of VBR q2 (855b1a9d)
- fix(kk): anchor the 标签 metadata-tail gate to the segment end (2c5fe9c7)

## [0.0.24] - 2026-09-28

### Added

- feat(kk-daily-ai-voice): add the xhs card target to the daily run (105b3d36)
- feat(xhs-pub): add a session preflight and 24h automation caps (4a13a5aa)
- feat(xhs-pub): migrate launcher to @gobing-ai/ts-browser-automation (0177) (35f045cd)
- feat(e61): apple podcasts compliance — mp3 default, apple-audio mime guard, channel checklist (4d6995bc)
- feat(image-gen): runtime provider fallback for image generation (16d985e3)
- feat(xhs-images): source-grounded XHS card-series skill with xhs-card/xhs-knowledge presets (E8 0168) (babcf9b5)
- feat(xhs-pub): publish ordered XHS card images as real draft or live post (a802b05c)
- feat(image-gen): validate illustration anchor plan pre-provider (974d24ae)
- feat(kk): render daily cover through pinned daily-news presets (0163) (e46a5596)
- feat(kk): wire script-write agent step into kk-daily-ai-voice (0162) (e059173a)
- feat(dailynews-gen): build VoiceScript from validated script plan (0161) (0b848fa7)
- feat(gemini-tts): GEMINI_TTS_STYLE pins one persona style across segments (b49997b1)

### Fixed

- fix(sp): accept failed-check terminal reason in verification gate (497ce4d9)
- fix(cli): resolve kk stage runner by entry identity (0178) (e75d4674)
- fix(xhs-pub): pin fake saved timestamp and add minute-boundary regression test (3535aca5)
- fix(xhs-pub): close browser context when page setup fails (daf913c6)
- fix(kk-workflow-stages): join the daily intro from the raw render, not mp3Path (bf3339fe)
- fix(xhs-pub): confirm a live publish from the console URL marker (0174 R5) (e1b3bdd8)
- fix(xhs-pub): confirm drafts only from a pre-entry baseline delta (0174 review P2) (462cd7b7)
- fix(xhs-pub): follow the live creator console — tab gate, hidden input, TipTap typing, CDP-located shadow submit (0174) (74ae6706)
- fix(rules): exempt type-only imports from shipped-script-isolation (690cd24f)
- fix(sp): keep vendored inline-run-setup node-builtin-only (5b438a48)
- fix(xhs-pub): address review P0/P1 — set-level thumbnail count, named post-open failure Results, T3 doc sync (7c7d51cb)
- fix(gemini-tts): fail loud on multi-hour quota retry-after; deadline network phases (a16fa30b)
- fix(docs): close F613 gherkin fence and link tasks 0161/0162 to the feature (ed1c862d)
- fix: en surfdash URLs drop the /en prefix (localePathPrefix contract) (1fd63a46)
- fix: strip SPUR_EXPECTED_DEFINITION_DIGEST at the nested-spur boundary (2aa2ea82)

### Changed

- test(cli): harden stage resolver fixtures and compiled assertions (d63005cb)
- test(e61): daily-intro regression net + disposition E61 re-verify residuals (a183ab06)
- test(xhs-pub): remove the scratch tree after the run (525d35c5)
- test(xhs-pub): editor appears at upload, and in-viewport selection fails loud without a viewport (0174 review advisories) (6543abe8)
- test(xhs-pub): pin the counter-path draft confirmation (0174 review P2) (7c28a89a)

### Other

- docs(corpus): resync stale feature task tables (d2979e01)
- docs(corpus): file the xhs target and its two follow-ups (a8a0ba57)
- chore(dogfood): track the dogfood report index (269fc639)
- docs(0178): correct the stage boundary and record evidence (8e781092)
- chore(tasks): refine 0178 cli stage resolver spec from backlog to todo (5dc9e8c0)
- docs(0177): record re-audit solution and scenario-keyed traceability (6e32c246)
- docs(tasks): add new tasks (22245f58)
- docs: drop stale launchPersistentBrowser from publish-harness surface (0177) (bfd93b0f)
- chore(project): upgrade dependencies (b1030cd1)
- docs(e9): register reusable browser sessions in the PRD, roadmap, and feature tree (2fb560e1)
- docs: wrap E61 — sync the design surfaces to the shipped state (1221f15f)
- docs(spur): add task 0175 to remove the vendored sp plugin scripts (19ea5a3b)
- docs(e9): plan reusable browser sessions for publish channels (ee23d2ef)
- docs(e8): close E8 after live verification of draft and public paths (180ec864)
- docs(features): E61 done — Apple Podcasts compliance met on the live feed (f9cb3a13)
- docs(podcast-pub): scope the §8.3 submit gate to reality and assert enclosures (632c85a2)
- docs(tasks): 0172 done — the 2026-09-25 episode is live with an MP3 enclosure (65ffd356)
- chore(features): E8 done — live draft and live publish verified against the creator console (ac1d834a)
- docs(xhs-pub): record the measured live publish reliability + richer submit diagnostics (d1eca262)
- chore(tasks): record 0174 done (live draft verified) and refresh 0167 evidence — R4/R6 MET, live publish still pending (8947ac7b)
- docs(features): sync D6 feature status and re-record 0166 testing anchors (7c3d0663)
- chore(tasks): file 0174 (xhs-pub live UI contract) and record 0167 live-attempt evidence (8ae07900)
- chore(merge): integrate E61 batch (0170/0171/0173) into main (a996bc4a)
- chore(tasks): record 0173 done and tick R5/AC2 (26e2e131)
- chore(merge): integrate E61 batch (0170/0171/0173) into main (6478c7a3)
- chore(features): E8 active -> verifying (implementation complete, R4-R6 live-path verification pending) (42248492)
- chore(tasks): durable verdict records — 0168 PASS, 0167 PARTIAL (live XHS path operator-owned) (2be7638c)
- docs(spur): wrap E8 doc-sync — ADR-024 accepted, xhs-pub script driver, E8 verification-state caveat (a818759a)
- docs(tasks): re-key 0165 testing rows to feature D6 scenario titles (8c94d154)
- docs(features): regenerate INDEX.md after the D6 merge (168e89b6)
- chore(merge): integrate main into sp/runall-d6-4440 for D6 landing (5644b58d)
- chore(sp): re-vendor sp pipeline scripts from installed plugin (e8b07e70)
- docs(corpus): rescope E61 task 0172 to the 2026-09-25 episode (f16df541)
- chore(sp): re-vendor wrapup step scripts — add route-reason + drift-probe for wrapup-pipeline v5 (f3d51034)
- chore(wrap): feature D6 done — wrap learnings + metrics (e454e713)
- docs(corpus): plan E61 Apple Podcasts feed compliance (bb1445b5)
- docs(corpus): mark D7 image-gen anchor validation done (70b47577)
- docs(context): runall-e8-5a30 learnings for 0168 (8f3cc438)
- chore(tasks): record 0168 done — paid dogfood evidence, review P3 disposition, verdict PASS (e466049a)
- chore(xhs-images): review P3 hardening — preview consistency disclosure, provider chain, resume glob (0dba7935)
- docs(spur): record 0167 wrap learnings (df65eb51)
- chore(spur): task 0167 done — verify PASS, review OK after fixes (9fed3b70)
- chore(xhs-pub): review P2 hardening — single-query findSelector loop, accurate plugin description (2b6d7553)
- docs(tasks): re-key 0169 testing AC to feature D7 scenario titles (b3b6eb33)
- docs(tasks): record 0169 wrap, D7 sync, and status normalization (08c1ac9e)
- docs: sync authority docs to shipped state (E7, kk stage, plugin tree) (cd8dee19)
- chore(corpus): record status transitions — K wayfinder done, 0164 backlog→todo (485e433c)
- docs(corpus): retune D6 dependency graph — drop 0165→0164, gate 0166 on 0169 (74a94acd)
- docs(corpus): plan feature D7 — image-gen pre-spend anchor validation (task 0169) (d0e80d6d)
- docs(corpus): refine feature D6 — image-gen runtime fallback (tasks 0164-0166) (e7130c3a)
- docs(corpus): plan feature E8 — XHS image-card authoring and publishing (ADR-024) (480eb625)
- docs(corpus): move image-gen runtime fallback under feature D6; remove cancelled duplicate S (0e93b583)
- docs(corpus): plan feature R — image-gen runtime fallback with error classification (tasks 0164-0166) (3ff6529c)
- docs(learnings): image generation routes through kk config, not harness tools (bfd11643)
- docs(wrap): bump 04_DESIGN frontmatter to 2.32.0 after 0163; append wrap learnings (7381fa1a)
- chore(task): record 0163 verification evidence, tick AC/plan boxes, scope dogfood as operator-owned post-merge (9847f2e6)
- docs(tasks): add new tasks (ab9c09ca)
- chore(project): add the generated mjs file into the ignore list (6710c064)
- chore(project): update config template (7ac2ca95)
- chore(sp): install feature-verification workflow, steps, and bundle (11605024)
- docs(memory): update memory (570eb893)
- docs(gemini-tts): record zh consent-pair 500; en-pair is the reliable renewal path (f95ec99c)
- docs(f613): plan daily voice script feature with fixed style contract (d44505ff)
- docs: dogfood report — kk-daily-ai-voice × gemini-tts full live run (2026-09-24) (fdbe0c92)

## [0.0.23] - 2026-09-24

### Added

- feat(gemini-tts): add Gemini TTS voice generator plugin over voice-gen (46ff24f8)
- feat(gemini-tts): add voice-create CLI helper and operator runbook (F612, 0159) (efd21501)
- feat(kk-daily): wire vdriver gemini to gemini-tts and sync docs (F612, 0160) (d7c0165e)

### Changed

- refactor(voice-gen): open pipeline for sibling-plugin reuse (3d05f728)
- test: close task-0158 verification gaps (voice-gen tag override, kk-core shipped-plugin manifest) (f31cb70a)

### Other

- docs(gemini-tts): add ADR-023 and F612 feature/task corpus (1a5bff81)
- docs(tasks): record 0158 pipeline evidence (Solution/Testing/Review, Plan closed, F612 active) (70d8d1bf)
- docs(tasks): updat tasks after verification (5b84e98a)
- docs(tasks): record 0159 R4 external blocker (Google voices.create 500) and AI Studio resolution path (f88cba3e)
- docs(gemini-tts): record 0159 verification results and AI Studio README fallback (344d50bd)
- docs(tasks): record 0159 operator run completion and mark done (F612) (036f8dc2)
- docs: wrapup sync for F612 (0158-0160) — ADR vdriver amendment, derived-doc drift fixes, learnings+metrics capture (85a7e5da)

## [0.0.22] - 2026-09-24

### Fixed

- fix(plugins): harden plugin secrets, XSS, path handling and request timeouts (927d0cc3)
- fix(packages): harden kk-core kind resolution, publish-harness fakes, builtin discovery (0155) (84525673)
- fix(apps): invoke alias identity, fan-out target dedupe, fan-in plugin roots, executor hardening (0157) (29bf6447)

### Other

- docs(tasks): add new tasks (14aa8ee6)
- chore(tasks): mark 0155 done (pipeline 451D27D7-36DD-437F-9130-6A329AEFD4E3) (f6a5d441)
- docs(tasks): updat tasks after verification (5b7fb513)
- chore(tasks): mark 0157 done (pipeline 6fec4165-C6D5-47D3-9AA5-0DE61BF02AF4) (fc6287cb)
- docs: sync surface docs for the 0157 wrap-up (90ec5394)
- docs(tasks): refresh 0156 review-finding verification evidence (d17acfcb)
- docs(tasks): refresh 0157 review-finding verification evidence (1d4cc1fe)

## [0.0.21] - 2026-09-23

### Fixed

- fix(kk): make kk-itc edit-in-place states executor-conformant (write-new then swap) (a77a6f04)
- fix(kk): fail fast on out-of-contract kk-itc judge verdicts (804ea64b)

### Changed

- docs(tasks): refresh F41 verification rows from forced re-audit (93da1528)
- test(cli): silence child output leaking into the test reporter (36374dc5)

## [0.0.20] - 2026-09-19

### Fixed

- fix: strip plan-doc 标签 metadata lines before spoken script assembly (cc219c8e)
- fix(omni-voice-gen): repetition battery is transcription-only with duration corroboration (11c2f8b3)
- fix(voice): reorder daily pipeline transitions; propagate QC dip position; shared QC parity vectors (a9058b82)
- fix(rules): sanction stage executor + voicebox fd-transport sites; add stage tests (ac7e744e)

### Other

- docs(tasks): update task status after refinement (24c2794a)
- docs(tasks): update task status after refinement (6c46e5c3)

## [0.0.19] - 2026-09-18

### Added

- feat(kk): add kk stage verb for the workflow stages runner (1eb6c8d6)
- feat(kk): compose daily work_dir from works_dir + run_date (8f3ab6f1)
- feat(voice-gen): auto-start the local Voicebox server (75e5b2ff)

### Changed

- refactor(kk): rewrite kk-daily-ai-voice workflow onto kk stage (ceba9eba)

### Fixed

- fix(kk): hand ARTICLE_BODY_FILE to plugin entry as an absolute path (2d7b6d92)
- fix(scheduler): resolve work_dir date before it becomes a workflow var (95bdc59f)
- fix(kk): satisfy strict null check on prevArgv1 capture in stage test (c86337e6)

### Other

- docs(kk): sync kk stage verb, work_dir anchor protocol, voicebox auto-start (eeeebdf9)

## [0.0.17] - 2026-09-16

### Added

- feat(kk): gate voicescript content and split long fact segments (5f0b40e3)
- feat(kk): fix daily-ai-voice content quality and QC gating defects (031e6537)
- feat(kk): add kk-daily-ai-voice profile to workflow-run command (3b2174e1)

### Fixed

- fix(kk): reconcile the daily-voice qc.passed gate with the warn-only policy (bdd7bb59)
- fix(omni-voice-gen): drop inverted duration ceiling that false-flagged in-range segments (f650fd9c)

### Other

- docs(tasks): update task status after verification (968ad23c)

## [0.0.18] - 2026-09-18

### Added

- feat: news funnel audit + per-segment speech pacing (kk-daily-ai-voice review 1/2) (fa91c101)
- feat: vdriver switch, intro music, surfdash patch stage (kk-daily-ai-voice review 2/2) (91ef8bc9)
- feat: corpus composition section in run report (blended source/category funnel) (a05a852b)
- feat(publish): merge E7 leftover wt-publish harvest (470ce94c)
- feat(publish): harvest leftover wt channels as E7 plugins (89a08cf3)

### Fixed

- fix: absolutize run-report plugin env paths (plugin cwd breaks relative workDir) (e861f952)
- fix(rules): allowlist voice-gen concat.ts ffmpeg spawn (a5356bc6)
- fix(podcast-pub,stages): canonical episode URLs; fail loud on missing required inputs (7c09b306)
- fix(rules): scope user-layer env-var-hygiene out of knowledge-kit; surfdash-pub stderr via echoError (3d184b6e)
- fix(kk-daily-ai-voice): ship 2026-09-16 prod-feedback fixes (b9dd0b64)
- fix(README): add apps/cli/README.md (e85bcc0b, 0798f509, f77843db)

### Changed

- docs(tasks): update task status after verification (20c9490b)
- docs(planning): add E7 remaining-wt-publish-harvest spec (78aed387)
- chore(project): upgrade dependencies (4de0ace5)
- chore(project): update the project memory (677bb0c3)

## [0.0.16] - 2026-09-16

### Fixed

- target the CLI package in bump-ver and guard version lockstep (816e8c62)

### Other

- chore(release): declare builder.bump-ver.aggregatePackage (cb2b20d8)
- chore(project): refresh the history report snapshot (aa0bd411)

## [0.0.15] - 2026-09-15

### Added

- per-step artifact naming, redo-by-delete, inline agent default (6a4e8705)
- wire robin-news as clone profile extracted from Voicebox (24b36a3a)
- default kk-daily-ai-voice to omni-voice-gen (ADR-020 amendment) (09b9c860)

### Fixed

- resolve show-notes article URL from the surfdash publish result (d727efcd)
- delegate kk-solo-podcast stages to an owned runner so ADR-115 validate exits 0 (c1fa6393)
- repair solo-podcast shell-action schema (0130) and refresh F8 table (446fa71e)
- chunk >30s audio for ASR verification (5b370dad)
- reject free-text emotion instructs, pin profiles to OmniVoice whitelist (23bcc0dd)

### Changed

- port kk-daily-ai-voice stages to the shared ADR-115 runner (53ce3e51)
- share one ADR-115 stage runner across the kk workflows (8a5ead69)
- move voicescript sidecar scripts out of workflows dir (01cb3665)

### Other

- docs(project): capture 0137 wrap learnings (ea83b210)
- docs(kk): sync podcast-pub show-notes surface in wrapup of 0137 (61eb97a1)
- docs(tasks): update task status after refinement (ae451abc)
- docs(kk): specify task 0137 with the show-notes defect evidence and fix design (ef28e070)
- chore(project): refresh the history report snapshot (171868f8)
- docs(tasks): add new tasks (530b5e54)
- chore(project): update memory (49053c90)
- chore(sp): refresh F8 task table after batch completion (ef35f1ae)
- docs(kk): sync F8 workflow-folder surfaces and tighten resolution tests (9167f500)
- docs(sp): reopen F8 for workflow-folder and workspace-default extension (fcf4fdab)
- chore(project): add .work folder as the default output folder (9bc97f3d)
- docs: note HF_HUB_OFFLINE workaround for hub revalidation hang (4fde9eac)
- docs(CHANGELOG.md): add change log (6bfcd09e)
- chore(gate): dedupe typecheck and add build to bun run gate (95cae5ed)
- chore(config): declare empty versionCarriers (built-ins cover marketplace staleness) (f8da5015)
- chore(config): declare builder.bump-ver release knobs (values = defaults) (3d213140)

## [0.0.14] - 2026-09-14

### Added

- add --emit-format/--job for opt-in format drafting from style extraction (afb70b91)
- workflow voice_generator var + docs sync (0126) (e4d6557f)
- pipeline orchestration, verify-retry, coverage gate (0125) (4074c617)
- audio concat, loudness dip, QC audit, MP3 (0124) (87473793)
- profile registry + OmniVoice backend adapter (0123) (bdf74ae1)
- VoiceScript parse/merge/validate port with warn-and-ignore (0122) (c418f3a8)
- kk-core audio Content schema + doc/rule sync (0121) (e0862f22)
- scaffold Python generator plugin with kk contract layer (0121) (f2bb7611)
- per-source breakdown (#news by ingest source + domain counts) in run report (fdcbef7b)
- commit+push post path after publish and verify the live URL (978ea6f7)
- per-segment progress, render budget, actionable health error (01a9fc00)
- timeline show notes and sequenced publish seam (69135e49)
- run-report generator plugin, step timing seam, run-report state (562b8166)
- stamp ai-news tag on generated content (e4e5261f)
- huggingface Inference adapter from wt-image-generate (K/0116) (7e1f186b)
- port all baoyu provider adapters to wire-speaking factories (K/0115) (ebd8c320)
- daily-ai-voice cover state re-cut to kk:image-authoring (N/0113) (68969534)

### Fixed

- raise EXCLUDE test timeout to 30s (default 5s flakes) (51e1f731)
- treat already-committed post as publish success (idempotent retry) (d0d7c605)
- scan both CLI streams so stdout-only 401s trigger the token hint (93d6b55f)
- route fs through bytes seam, echoError warning; gate exemptions for codex-cli/google CLI transports (901d60ea)
- cover contract follows elected provider ext (minimax jpg), sips-normalize to canonical png (8b6549c4)

### Other

- docs: wrapup F611 — ADR-020 Python-plugin decision, arch/design sync, learnings (ebe56fda)
- test: add profile registry tests (0123 followup) (ddbbec1b)
- test: stabilize pipeline-hop test infra (03627d1f)
- chore: rebuild vendored pipeline script bundles (f1744081)
- chore: vendor pipeline gate/precheck scripts from spur-new plugins/sp (3e32e642)
- docs: F611 refinement sync + covers declarations (0121-0126) (2e1b685c)
- chore: drop project executor overrides (native attestation) (69241cc4)
- docs: update task status after refinement (f70b5bc2)
- docs: add F611 plan - design, feature, task batch 0121-0126 (c58af589)
- chore: update history report (3025eed3)
- chore: ignore .spur/runs + voicebox local data; fix stale ARK-outage comment (b2a0a441)
- chore: point voicebox guard at the app data-dir (9a6fb584)
- chore: guard kk-daily-ai-voice job with voicebox health check (69123057)
- chore: update spur config (5d51a6bd)
- chore: update spur config (b00f059e)
- test: de-rot freshness fixture by using a relative publishedAt (74400364)
- docs: record verifyall verdicts, review tables, and feature ship status (7dafb518)
- docs: add feature-level BDD declaration for O acceptance criteria (verifyall shippable gate) (bd243d9c)
- docs: align task ACs with feature O scenarios for DD-09 coverage (b8300e09)
- docs: plan kk-daily-ai-voice run report, show-notes, surfdash publish (4a6d4079)
- chore: point latest history report at 2026-09-12 (d9a6885e)
- chore: split daily history import and analyze, add db maintenance (6997d860)
- docs: update task status after verification (9bd6b03f)
- test: bring all baoyu-wired providers to >=90% per-file line+function coverage (31d5b86e)
- chore: appease biome (literal key + unused param underscore) (0d1c8290)
- docs: record task 0116 verify PASS (huggingface adapter, 854/0) (5380117e)
- chore: record 0114 dogfood PASS + feature N verdict-keyed coverage (N done) (39373f46)
- docs: record task 0115 verify PASS (all baoyu adapters ported, 849/0) (6dfda03f)
- docs: feature K phase 2 — task 0115 port all baoyu adapters, 0116 wt huggingface backend (517110b6)
- docs: refine task 0114 to implement-ready (dogfood cover rerun design/plan/Q&A) (06b2956e)
- docs: idea-pipeline — feature N (daily-ai-voice cover × image-authoring), tasks 0113/0114 (beae269f)
- Revert "feat(omni-voice-gen): scaffold plugin per 0121 (out-of-band implement agent output)" (341f689e)

## [0.0.13] - 2026-09-10

### Added

- implement image-gen adapter hop (0107) (f3bc10c)
- port wt image skills to kk generator plugin (feature K) (40b461e)

### Fixed

- prune node_modules from staged plugin packaging (008272d)
- ship plugin packaging and execution contract repairs (0110) (5503d8c)
- move kk user roots to ~/.config/kk (aa6157c)
- resolve 0105 fidelity verdict to low after pixel-pair loss (a95ef4a)

### Other

- chore: record 0110 wrap learnings and retarget latest report (21f2063)
- chore: drop redundant 0110 I6 inline comment (91b20a0)
- chore: record task 0107 lifecycle and verify evidence (9fbbaf6)
- chore: register task 0107 (adapter-hop carry-forward), cancel stray 0108 duplicate (d703801)
- chore: record feature M (kk-user-config-roots) and task 0109 (cc538bd)
- test: cover seedream url/error/data-uri legs (fe45ec4)
- test: pin renderTemplate edge cases (fb549ce)
- test: deflake kk-fanin suite (e8ead01)
- docs: close out tasks 0111/0112 and make feature L shippable (398fd41)
- docs: tighten publish doc-list operation dispatch semantics (1cf592c)
- docs: close out task 0110 with change map and repo-root evidence (8b5b782)
- docs: register task 0110 and record executor boundary integrity design (b1fd3f7)
- docs: record 0107 re-verify PASS and 0104 deferral discharge (02b5dd2)
- docs: record 0105 regeneration; verdict pending operator eyeball (62073b5)
- docs: update task status after refinement (6da4389)
- docs: chart first task batch for wayfinder map K (0102-0106) (7e04149)
- docs: register kk-image-pipeline wayfinder map K (2a91421)

## [0.0.12] - 2026-09-08

### Added

- swap source to fresh AI-news RSS feed (fa12c12)
- detect and auto-regenerate loudness-dip segments (5534512)
- scaffold-locale and sync operations (55317d2)
- show-notes rendering and episode assembly ops (a6557cc)
- MECE annotate pass and quality-controller filter mode (8247a40)
- concurrent source runner mode for fan-in collection (9de5743)
- redesign workflow with concurrent collect, content-qc seam, plugin-owned publish (47fee69)
- episode plan step — score, dedup, translate, uniform show notes + episode covers (201ac21)
- de-STORM daily article, full-locale publishing, and show-notes fixes in daily-ai-voice (6435785)
- date-stamped caching, last30days gating, and publish fixes in daily-ai-voice (912213a)
- QC fidelity gate, robin-news default voice, Chinese article, QC publish gate (1ca9faf)
- F61 daily-news ingests, core-facts-gen, run resilience (d9adf9c)
- add podcast-pub publish plugin for microfeed (task 0085) (c6c5e8b)
- absorb avoid-ai-writing patterns into taste-unslop (e7f70a9)

### Fixed

- two-form publish IO contract for show-notes invocations (a0216a1)
- harden plan-translate JSON contract and add article plan.json self-heal (723a92b)
- gate episode plan against stale archives, feed floods, and non-news tags (fdf3905)
- plan-translate writes plan.json from content.json instead of impossible in-place edit (55fb37f)
- cover prompt authorizes procedural PIL fallback when no image backend (9f3ab23)
- fail loudly when plan extraction produces no plan.json (421d9ef)
- send Origin header on microfeed API requests (8a89a84)
- send sanitized HTML show notes, not markdown (861b163)
- harden daily-ai-voice publish seam and show-notes quality (80d0ba1)
- per-segment fidelity verification, regeneration, and length-scaled timeouts (b3766c2)
- anchor spawned agent cwd to project root, exclude .spur from bundled plugins (dcedbfd)
- podcast-pub delete sends Content-Type for Astro 7 checkOrigin (task 0087) (f9810be)

### Changed

- use FileSystem seam for fanin probes; document spawnPluginEntry (db82f0a)
- route plugin diagnostics through echoError seam (b91a615)
- compact L1 pipeline R/AC rows + add derived learnings (0092–0101) (3dd6205)
- close feature after strict gate PASS and full task chain (383a191)
- restructure workflow YAML around the new seams (ef56d49)
- update task status after verification (ae38a4f)
- verifyall F61 re-verify with citation and checklist repairs (c702946)
- F61 runall batch writes — tasks 0088-0091 done, design satellites + doc sync (research/prototype; map stays active) (d7a4d2d)
- add core-facts blend template & contract (F61 2.1 prototype) (d0069af)
- refine F61 wayfinder tickets 0088-0091 to implement-ready depth (3196e68)
- re-parent wayfinder map K -> F61, lock surfdash-only article platform (890a9c7)
- chart wayfinder map K for the daily AI news end-to-end pipeline (add62a8)
- E6 verifyall re-audit (0084-0086), close 0087, E6 done (b69777c)
- close 0086 — live smoke green (publish/get/feed verified); delete-op drift filed as 0087 (0a00194)
- close 0084 — microfeed live at podcast.salty.vip, API key wired (d69b772)
- record 0085 verify PASS + review evidence (173d656)
- author 0085 Solution change-map after implementation (6e345f6)
- E6 microfeed podcast publishing — feature, AC, design, tasks 0084-0086 (572a42b)

### Other

- untrack spur history analyze dumps (complete staged deletions) (ff76354)
- untrack spur history analyze dumps and ignore future ones (95a169db)
- sanction vendor-CLI boundary allowlist entries (3e6767b)
- checkpoint history-anatomy report (2026-09-08) (032238e)
- refresh history-anatomy report (2026-09-07) (9903b17)
- checkpoint history-anatomy report (2026-09-07) (0dad5f9)
- add new script entry load-history (7d8d30e)
- update the spur config file (8a1cd45)
- E6 verifyall + 0087 closeout learnings (record Review overwrite, provenance override, Astro 7 checkOrigin) (434facc)
- drop gitignore entry for in-tree schema copy — spur rejects non-rule JSON under .spur/rules (d178aeb)
- E6 0085 pipeline learnings (verdict contract, rule allowlists) (b7f75b9)
- allowlist podcast-pub transport boundary files (3fd41d0)
- clean .spur for spur 1.2 (bundled workflows/templates) (3965224)

---

## [0.0.10] - 2026-08-27

### Added

- add audio-authoring fat skill (solo mode, four operations) (434a01a)
- rewrite kk-solo-podcast onto kk:audio-authoring (c4ab400)
- close F7 map — e2e verify refined solo-podcast workflow (a20be22)
- land F7 audio-authoring wayfinder map with completed tasks 0075-0076 (65ced87)
- run workflows and sidecars from the kk package root — run-anywhere (F8/0080-0081) (7a81b07)
- support emotions, paralinguistic tags, post-processing effects, and multi-speaker discussions (voice-gen) (0b8a7eb)
- add automated audio quality control gate and repetition detection (voice-gen) (9a11f46)
- derive clean spoken host name from profile string (dailynews-gen) (c1f83b3)
- add demonstrative solo podcast talk style with personal understanding and date-partitioned workspace (dailynews-gen) (d10a699)
- add explain-things skill and tell-me command (F9) (d114a1e)
- add taste-unslop natural-voice editing skill (4ac420d)

### Fixed

- run-anywhere paths across all kk workflows (F8/0082) (e951921)
- format block YAML in dailynews-gen and add flow-style fallback in voice-gen (f86611d)

### Other

- close F8 feature as done with executable BDD acceptance scenarios (c7246f4)
- re-audit 0078/0079 verify PASS (--force, independent second pass) (75e35fc, 83474cd)
- refine audio-authoring extraction map and batch-create implement tickets 0077-0079 (e81f381)
- upgrade .spur/config.yaml to schema 1.2 (9a677a0)
- apply biome formatting and warning fixes across kk workflows (2d5a60c, 8094228, f34e16e)
- update task status after verification (c39b748)
- record F9/0083 session learnings (d168b09)

## [0.0.9] - 2026-08-22

### Added

- ship daily AI news voice workflow and plugins (661b101)
- add optional MP3 transcoding via ffmpeg (998fbfd)
- integrate manifest rewriting into publish helper (dab3273)
- rewrite catalog and workspace deps for publishing (4d7ec8f)

### Fixed

- resolve evaluator errors and eliminate global fetch mutation (b75d38e)

### Other

- document published dependencies manifest rewriting (27a075b)
- upgrade ts-libs to 0.4.39 (a4db2f9)

## [0.0.8] - 2026-08-20

### Added

- add kk-solo-podcast runner profile and standalone validator (7fd42b5)
- ship kk-solo-podcast workflow and VoiceScript validator (F5/0071) (9d39028)
- inject plugin config env from KK_CONFIG at spawn (1dc796d)
- implement Voicebox-backed podcast generator plugin (D5/0070) (0258f51)
- relocate product workflow SSOT and author kk-itc workflow (F4/0069) (e2f2c23)
- add itc-generating fat skill with distilled IT-writing references (F3/0068) (2495b4f)
- adopt ts-runtime file system seam and enforce plugin boundaries (a874d92)
- adopt shared logging and output foundation across workspaces (a4a2f09)
- digest-not-index report contract (C5/0063) (562b760)
- cache normalized full content per reference (C5/0062) (49b4956)
- ship EmDash CMS publish plugin (E5) (ee5675c)

### Fixed

- harden idea-pipeline decompose schema path and feature-check guard (d762349)
- normalize footnote-style citation ids (81e8082)

### Other

- document D5 voice-gen feature and sync authority docs (551d02f)
- register voice-gen plugin in lockfile, rules, and discovery tests (ab23385)
- plan ts-libs logging foundation (ADR-014/015, tasks 0065-0067) (1b54c84)
- add Layer-1 roles to idea-pipeline agent.run steps (2175a50)
- wrapup pipeline scribe roles + C5 learnings (e6a77cb)
- flip E5 ship status flags (f1463b8)
- flip C5 ship status across authority docs (62d204c)
- document evidence cache and digest contract in skill (C5/0064) (285929c)
- plan C5 evidence cache + report digest (ADR-013) (7983bd9)

## [0.0.7] - 2026-08-14

### Added

- ship daily-usable STORM research pipeline (C4) (719d659)

### Changed

- drop kk- prefix from plugin capability names (2d400fa)
- update plugin capability references to unprefixed names (c646b8e)
- point judge example and workflow-run tests at new names (9860d15)

### Other

- align capability references with unprefixed plugin names (6624626)
- mark C4 batch done (0056-0060, feature C4) (c625408)
- ignore nested .spur runtime state in plugins (20c9da0)

## [0.0.5] - 2026-08-14

### Added

- ship STORM topic-research workflow dry-run (C3) (046fdca)
- discover plugins across merged multi-root registry (6bbb67b)
- reshape kk into executor and plugin command nouns (f7a6c92)

### Fixed

- wire executor and plugin nouns and sync A21 docs (e670560)

### Other

- enhance docs/99_PROJECT_CONSTITUTION.md (676e85c)
- enhance docs/99_PROJECT_CONSTITUTION.md (009686b)
- plan multi-root plugin auto-discovery (B7, ADR-012) (3690aa3)
- exclude gitignored plugin staging tree from rules (e37dd4c)

## [0.0.1] - 2026-08-12

### Added

- add Doc, Content, and Result schemas and kind contracts (0f925f6)
- add plugin manifest schema and registry discovery by kind (eafd230)
- add knowledge-kit invoke subcommand and spur workflow template (fb4694d)
- complete feature C1 ingestion plugin design tasks (536d0c2)
- karakeep-local plugin + gate wiring (verify 0014 fix pass) (2977f52)
- add publish plugin specification and offline test harness (E2) (2195d14)
- add plugins list and doctor subcommands (B4) (fed9412)
- implement generator stand-in adapter plugin (D2) (dacf691)
- implement publish plugin with hardened failure modes (E3) (d8b19d0)
- harden plugin fail-loud semantics and close feature B verification (f7efcf5)
- add kk-judge LLM-as-judge skill and agent wrappers (f3314b9)
- wire kk-judge agent.run gate into example spur workflow (8e8cb27)
- reopen C/D/E as living kind parents; add done->active edge (4218d87)
- add kk fanin and kk fanout commands (df36762)
- harvest Zenn and Qiita channels under E2 transport (be35309)
- replace wt stand-in with owned STORM pipeline (4421af3)
- add kk-topic topic-core authoring skill (c1253c0)
- add kind-collection layout API and registry scan (98798fd)
- add capability collection manifest and READMEs (7dd8b4d)
- enforce ADR-009 plugin layout with a rule (bd85106)
- ship kk binary surface — program globals, register modules, npm bin (b74a107)

### Fixed

- restore spawn-boundary rule coverage and revert call-site evasion (eb82e36)
- shadow user-global spawn rule with project-scoped allowlist (055f6b8)
- drop schema-invalid description field from presets, sync 05 C1 status (3122d0a)
- harden failure semantics and error logging (d9fe540)
- tolerate prose-wrapped agent output; harden B5 acceptance (0026/0027) (662ba0b)
- sort discovered plugin dirs for deterministic order (ac1ffbd)

### Changed

- move product plugins under kind collections (b8b79de)
- comply with biome lint findings (ef36a5d)

### Other

- plan knowledge-kit plugin platform and feature tree (887b646)
- restructure feature tree to kind-aligned parents under A1 (30f10ab)
- level-2 enrichment for C2, D3, E2, B4 with task decomposition (ae0e130)
- level-2 enrichment for D2, E3, B5 + parent roll-ups C/D/E (52b04ae)
- record 0014 re-audit verdict (PASS) in Testing (d74433e)
- author generator plugin specification; verify 0016 and 0017 (e35938e)
- update line anchors to project-relative paths (0925ecb)
- record --force re-audit verdict (PASS) in Testing (7e992cd)
- restore 0925ecb project-relative anchors in Testing (4c7c6c8)
- refresh feature task table and index after 0017 done (7d761f2)
- sync 05 feature tree statuses (T4) (b7a7945)
- sync 05 feature tree statuses (T4) (6f79bea)
- sync 05 feature tree statuses (T4) (16bee69)
- realign project scope to ingest-create-publish platform under Feature J (270bbe1)
- sync authority and derived docs to three-kind taxonomy (e319c9c)
- resolve conflict-audit findings from find-conflict dogfood (115ea55)
- repurpose feature F as the kk plugin collection root (c2f1b1d)
- sync fan-in/fan-out surface after B6 ship (8ea1d40)
- rehome WT harvest D5 as F2 under kk plugin collection (c8119e8)
- add F2 batch task files (2edfd4e)
- record ADR-009 kind-collection plugin layout (8ac5765)
- add A2 kk product CLI surface design and ADR-010 (d157ece)
- add A2 CLI surface task batch (10ea2b3)
- refresh task tables — D4 0047 and F2 0048 done (3799ce6)
- project intialization (e5160bd)
- project intialization (52291af)
- project intialization (57c8f66)
- disable web-only accessible-button rule for CLI monorepo (3e50469)
- upgrade config to schema 1.1 (ADR-033 executor tiers + planning blocks) (4bcafe3)
- update spur config (4150e89)
- residual sweep — workflow vars, deferred markers, B roll-up, 05 sync, R-format (8326166)
- transition feature to done after acceptance (0026/0027) (41bf221)
- record B5 verifyall learnings (6d38c38)
- transition C2 to done; create B close-out (0028) and karakeep hardening (0029) (28bb9de)
- ignore spur memory checkpoints and wrapup metrics (7b02692)
- add B6 fan-in and fan-out task specs (aa3b4e0)
- add npm publish workflow and CLI publish config (b3446e6)
- record B6 batch learnings (2dc5ab6)
- update workspace globs and entry docs for kind collections (df46559)
- harden CI workflow (6b18b1f)
- skip lifecycle scripts in CI installs (3dcd539)
- silence expected warnings in negative-path tests (8e6a6a9)
