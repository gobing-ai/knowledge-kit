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
