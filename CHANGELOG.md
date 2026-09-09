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
