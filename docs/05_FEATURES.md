---
name: Features
doc: 05_FEATURES
owns: STATUS — feature decomposition + state
authority: derived
version: 2.34.0
created_at: 2026-07-22
updated_at: 2026-11-18
derived_from: [01_PRD, 02_ROADMAP]
edit_rules: 99 §6.6
sync: [T4]
---

# Features

> Derived from the Spur feature tree (`docs/features/INDEX.md`, letter IDs per DD-14). Edit when a
> feature's status changes. Tier-1 = a letter (`A`); children append one digit (`B1`, `B2`).
>
> **2026-07-29 (A1):** Tree reorganized to kind-aligned parents (Ingestion / Content generation /
> Publish). Roots F/G/H cancelled (E2E → **B5**; multi-channel → E Notes; STORM/harvest → D4/D5).
> Map: `docs/plans/feature-tree-restructure-map.md`.
>
> **2026-08-12 (C/D/E close-out + reopen):** kind parents **C/D/E** closed their verification via roll-up carriers `0039`–`0041` (0028 pattern), then **reopened to `active`** as living kind parents for plugin intake (the `done → active` reopen edge was added to the project's `.spur/workflows/feature-lifecycle.yaml` — the project copy predated spur's design-§7.5 reopen). Intake task `0038` cancelled as redundant with F's AC; intake annotation tasks `0042`–`0044` created then removed — the reopen edge makes FSM anchors unnecessary.
>
> **2026-08-12 (F repurposed):** root **F** repurposed from the cancelled E2E vertical to the **kk plugin collection** — parent for all `plugins/kk` capabilities (skills, commands, subagents); kk-judge migrated **B7 → F1**. F is no longer a cancelled root; **G/H** remain historical cancelled roots. (Slot freed by removing the cancelled F file; `cancelled` is terminal in spur.)
>
> **2026-10-07 (G repurposed):** root **G** re-minted as the **kk workflows** parent (one child per workflow; former Q → G31 + G11 + G71). Cancelled roots are now **H** only. ADR-001 amendment 2026-10-07.
>
> **2026-08-12 (D5 → F2):** the WT agent-skill harvest moved under **F** to honor that collection boundary. F2 is narrowed to one fat `topic` skill for topic-core authoring; remaining WT families require later intake.
>
> **2026-08-07 (0037):** LLM-as-judge repositioned from fourth plugin kind to **agent skills + `agent.run`**
> (ADR-007 amdt 2026-08-07, superseding the 2026-08-02 amendment). **B7** renamed "LLM-as-judge
> agent skills"; plugin taxonomy reverts to three kinds (`ingestion`, `generator`, `publish`).
> Fat skill `content-judge` (renamed from `judge` 2026-08-19) delivers verdict gating with zero engine work. Map:
> `docs/plans/feature-tree-restructure-map-j.md`.

## Status legend

✅ done · 🔶 partial · ⏳ planned/current · ⏳ ready (decomposed, unblocked) · ⏳ blocked (decomposed, dep-gated) · ⏳ backlog (tree: backlog) · ⏳ active (tree: active — open for intake) · ⏳ verifying (tree: verifying — roll-up/close-out in progress) · 💤 deferred · 🌫️ fog (undecided) · ❌ cancelled

## Feature tree

| ID | Feature | Status | Phase | Notes |
| ---- | --------- | -------- | ------- | ------- |
| **A** | Project foundation | ✅ done | 0 | Monorepo substrate + tooling; close-out task `0013` verified (gates PASS) |
| A1 | Feature tree restructure | ✅ done | 0 | tree+docs applied; tasks `0006`–`0009` **done**; map `docs/plans/feature-tree-restructure-map.md` |
| A2 | kk product CLI surface | ✅ done | 2 | tasks `0049`–`0051` done; operator binary `kk` (package `@gobing-ai/knowledge-kit` unchanged); register-per-command tree; `bin.kk` + `knowledge-kit` alias + `prepack`; ADR-010; spec `docs/design/kk-cli-surface.md` |
| A22 | Strict CLI noun/verb operations and named browser bots | ✅ done | 2 | tasks `0275`–`0278` **done** + verified (quality gates PASS); canonical `kk stage run` + top-level `kk lock` with the shipped spellings kept as hidden compat routes; generic `kk bot list\|login\|logout\|open` over staged transactions and shared profile leases; `browserSession` channel binding on the check-script `open \| login --url` protocol; caller-migration review with the kk-collect lock callers moved to `kk lock`; ADR-037/038; [design](design/kk-noun-verb-bots.md), [review](reviews/2026-10-13-A22-cli-browser-caller-migration.md) |
| A21 | Two-layer CLI nouns (executor + plugin) | ✅ done | 2 | task `0052` done; `kk executor run\|fan-in\|fan-out` + `kk plugin status`; hidden aliases; `add` retired; ADR-011; dogfood `docs/dogfood/2026-08-12-A21-two-layer-cli-dogfood.md` |
| A3 | ts-libs logging foundation | ✅ done | 2 | tasks `0065`–`0067` done+verified; shared catalog (`@gobing-ai/ts-*` `^0.4.35`) + ts-utils output seam (`apps/cli/src/output.ts`) + ts-infra diagnostics; `@gobing-ai/utils` retired; output-boundaries rule RED→GREEN; satellite `docs/design/ts-libs-logging-foundation.md` |
| **B** | Plugin platform | ✅ done | 1 | skill-first seam (ADR-006 amdt 2026-07-24); B1–B7 done (B7 = multi-root discovery, task `0053`); task `0028` verified; kk-judge moved under **F** as F1 |
| B1 | Plugin manifest + registry/discovery | ✅ done | 1 | task `0004`: `plugin.json` + `discoverPlugins` / `listByKind` |
| B2 | Typed lifecycle contracts | ✅ done | 1 | task `0003`: Doc/Content/Result + `kindContract` in `@gobing-ai/kk-core` |
| B3 | Spur workflow integration | ✅ done | 1 | task `0005`: `knowledge-kit invoke` + pipeline workflow template; E2E proof → **B5** |
| B4 | CLI surface | ✅ done | 1 | tasks `0020`/`0021` done: `plugins list` + `plugins doctor` (noun group, `--json`); verifyall re-audit PASS + shippable; commit `fed9412` |
| B5 | End-to-end pipeline acceptance | ✅ done | 1 | tasks `0026`/`0027` done; vertical over B3 invoke + C2/D2/E3 proven (fixture → content → `ok:true`); verifyall re-audit PASS + shippable; commits `662ba0b`/`41bf221` |
| B6 | Sequential fan-in/fan-out steps | 🔶 partial | 3 | home for 0033 spec (`kk fanin` / `kk fanout`; `docs/design/fan-in-and-fan-out-specification.md`); tasks `0042`/`0043` done; reopened 2026-10-10 for `0248`: production fan-out concurrency and process deadlines; `0274` covers remaining fan-in test determinism |
| B7 | Multi-root plugin auto-discovery | ✅ done | 2 | task `0053` done; ADR-012 shipped — `discoverAllPlugins` / `resolvePluginRoots` + `origin`-stamped records + `shadowed` diagnostic in `@gobing-ai/kk-core`; repeatable `--plugins-path` on `executor run` / `fan-out` / `plugin status`; `KK_PLUGIN_PATH`; `--plugins-root` exclusive (combined with `--plugins-path` → exit 2); workflow template injects `--plugins-path`. **Not** the historical judge B7 (that work is **F1**). |
| **C** | Ingestion | ⏳ active | 1 | kind parent; AC rolled up from C1+C2 (DD-09); ingestion optional (`Doc[] \| Brief` pipeline, ADR-007); closed via carrier `0039`, then **reopened for plugin intake** |
| C1 | Ingestion plugin design | ✅ done | 1 | tasks `0010`–`0012` done; spec `docs/design/ingestion-plugin-specification.md`; verifyall re-audit PASS + shippable |
| C2 | Karakeep-local | ✅ done | 1 | tasks `0014`/`0015` done; feature transitioned done (check clean); hardening follow-up → task `0029` (edge on parent C) |
| C3 | STORM topic-research workflow | ✅ done | 3 | wayfinder map; tasks `0054`/`0055` done; YAML now at `plugins/kk/workflows/kk-storm-research.yaml` (F4 SSOT move) + fixture `plugins/ingestions/web-search`; live Firecrawl not in this map; dogfood `docs/dogfood/2026-08-14-C3-storm-research-workflow-dogfood.md` |
| C4 | Daily-usable STORM research | ✅ done | 3 | wayfinder map; tasks `0056`–`0060` done; live Firecrawl + md in/out + `~/.config/kk/works/<topic-id>/` + `storm-research` skill + `/workflow-run`; dogfood `docs/dogfood/2026-08-14-C4-daily-usable-storm-research-dogfood.md`; verifyall Shippable PASS |
| C5 | STORM research workflow evidence hardening | ✅ done | 3 | tasks `0062`–`0064` done; ADR-013; per-reference evidence cache `references/<doc-id>.md` (Firecrawl scrape + markitdown, fail-loud) + digest-not-index report mandate + outline-replay removal in both render copies; design `docs/design/storm-evidence-cache.md`; verifyall Shippable PASS |
| **D** | Content generation | ⏳ active | 1 | kind parent; re-cut: `Doc[] \| Brief`, creation co-equal with ingestion (ADR-007 R3); AC rolled up from D3+D2 (DD-09); closed via carrier `0040`, then **reopened for plugin intake** |
| D1 | Study vendors/storm → pick stand-in | ✅ done | 1 | task `0001`: stand-in = `wt:technical-content-creation` |
| D2 | Wire existing generator skill to contract | ✅ done | 1 | tasks `0022`/`0023`; D3 spec done (`0017`) — gate satisfied |
| D3 | Generator plugin design | ✅ done | 1 | tasks `0016`/`0017` done; cites C1 generic contract §1 |
| D4 | Own STORM generator | ✅ done | 3 | tasks `0046` + `0047` done; owned STORM pipeline shipped behind the generator contract |
| D5 | Voice generator (Voicebox) | ✅ done | 3 | task `0070` done; `plugins/generations/voice-gen` REST `/generate` + VoiceScript multi-speaker concat + `format: "audio"`; satellite `docs/design/voice-gen.md`; verify PASS |
| D6 | image-gen runtime fallback | ✅ done | 3 | tasks `0164`–`0166` done; opt-in runtime fallback loop + error classifier + daily-cover wiring; verify PASS + Shippable PASS |
| D7 | image-gen pre-spend illustration anchor validation | ✅ done | 3 | task `0169` done; pre-provider validation of illustration anchors in `image-gen` on paid and dry-run branches |
| D8 | Music generation over the homelab Lyria 3 instance | 📋 backlog | 3 | tasks `0384`–`0391` + `0394` backlog; `music-gen` generator plugin, `kk music` noun, `kk-music` workflow, `music-quality` rubric under content-judge; minted as root `Q`, moved under D 2026-11-18 |
| **E** | Multi-channel publish | ✅ done | 1 | kind parent (renamed from "Publish", 0035); AC rolled up from E2+E3 (DD-09); suite in scope → **E4**; XHS follow-on **E8** done |
| E1 | wt-publish audit | ✅ done | 1 | task `0002` done (transports mapped; Surfdash simplest); wrapall 2026-08-19 — `spur feature sync E1` verifying→done |
| E2 | Publish design and test harness | ✅ done | 1 | tasks `0018`/`0019` done; transport abstraction + `packages/publish-harness`; verifyall re-audit PASS + shippable; commit `2195d14` |
| E3 | Surfdash publisher (tested) | ✅ done | 1 | tasks `0024`/`0025` done; `plugins/publishings/surfdash-pub` + hardened failure modes; verifyall re-audit PASS + shippable; commit `d8b19d0` |
| E4 | Multi-channel suite harvest | ✅ done | 2 | Zenn + Qiita first tranche shipped (`plugins/publishings/zenn-pub`, `plugins/publishings/qiita-pub`; tasks `0044`/`0045`); remaining channels (Surfing/X/Juejin/Medium/Substack/InfoQ/XHS) are follow-on intake under **E** |
| E5 | EmDash CMS publisher | ✅ done | 2 | task `0061` done; `plugins/publishings/emdash-pub` REST PAT transport + markdown→Portable Text mapper; satellite `docs/design/emdash-pub.md`; verify PASS + Shippable PASS (12/12 scenarios MET) |
| E7 | Remaining wt-publish harvest | ✅ done | 3 | tasks `0141`–`0147` done; harness browser drivers + `medium-pub`/`wechatmp-pub`/`x-pub`/`juejin-pub`/`infoq-pub`/`substack-pub`/`xhs-pub` + thin `kk:publish` skill; satellite `docs/design/remaining-wt-publish-harvest.md`; TCC remainder deferred to F41 |
| E8 | Xiaohongshu image-card authoring and publishing | ✅ done | 3 | tasks `0167`, `0168`, `0174` done; content-grounded card series via `image-gen`; ordered XHS draft and explicit live path through `xhs-pub`; ADR-024 and `docs/design/xhs-image-cards.md`; verifyall PASS + Shippable PASS |
| E9 | Reusable browser sessions for publish channels | 🔶 partial | 3 | tasks `0177` (XHS profile reuse on ts-browser-automation), `0328` (`linkedin-pub` on the shared `~/.config/kk/browser-profiles` layout), `0370` (xhs-pub single headed visit, offline `check`, out-of-page capture) and `0371` (wechatmp-pub login/open on the shared profile CLI) done; scenario R4 amended 2026-11-14 to the ADR-025 offline/headed check; feature record still `active`; feature satellite `docs/features/E9_reusable-browser-sessions-for-publish-channels.md` |
| E92 | Publish channel UI fidelity: per-mode discovery and gap fixes | 🔶 partial | 4 | reopened 2026-10-13 for `0260`: WeChat MP article enrichment repair; original discovery/mode tasks `0199`–`0205` done; see `docs/features/E92_publish-channel-ui-fidelity-per-mode-discovery-and-gap-fixes.md` |
| E93 | kk plugin check / login — live channel readiness probe | 🔶 partial | 4 | ADR-032 (amends ADR-011 R3); task `0215` done: manifest `check` field + `PluginRecord.check`, `kk plugin check`/`login` verbs, probe spawn seam `spawnPluginProbe` (only sanctioned spawn point), fixture E2E → `.spur/run/e2e/E93-plugin-check.json`; task `0216` done: all six browser channels (infoq/juejin/substack/x/xhs/wechatmp) on the ADR-032 probe contract with manifest `check` entries, xhs+wechatmp on bespoke contract-conformant CLIs, `checkHeadedOnly` for x, live run → `.spur/run/e2e/E93-plugin-check-live.json`; satellite `docs/design/kk-plugin-check.md`; reopened 2026-10-10 for `0249`: bundle installed readiness probes |
| **F** | kk plugin collection | ⏳ backlog | 2/3 | collection parent for agent capabilities and product workflows; F1–F9 children done; parent stays open for intake |
| F1 | LLM-as-judge agent skills | ✅ done | 2 | home for 0034/0037: fat skill `content-judge` (was `judge`); persona subagents retired 2026-08-19 — rubric is an `agent.run` field; `agent.run` + shell/jq verdict gate; ADR-007 amdt 2026-08-07 / 2026-08-19 |
| F2 | Topic-core authoring skill | ✅ done | 3 | task `0048` done; one fat `topic` skill with `create`, `init`, `outline`, and `draft`; no wrappers or runtime-plugin seam |
| F3 | ITC generating skill | ✅ done | 3 | task `0068` done; fat `itc-generating` skill + four distilled references; orchestrates `topic` / `storm-research` / optional `content-judge`; no slash, no CLI; satellite `docs/design/itc-generating.md`; verify PASS |
| F4 | IT-content workflow and product YAML home | ✅ done | 3 | task `0069` done; `plugins/kk/workflows/` is the only kk YAML SSOT; `kk-itc.yaml` uses existing `hitl.select`/`confirm`/`input`; no new hitl kind; `itc-generating` writer default |
| F5 | Solo-podcast workflow (voice-gen dogfood) | ✅ done | 3 | task `0071` done; `plugins/kk/workflows/kk-solo-podcast.yaml` + `validate-voicescript` helper; Spur HITL select/confirm/input; satellite `docs/design/kk-solo-podcast.md`; verify PASS |
| F6 | Daily AI news workflow and plugins | ✅ done | 3 | tasks `0072`–`0074`; `aihot-ingest` → `dailynews-gen` → `voice-gen`; offline executor-dispatch integration; satellites `docs/design/{aihot-ingest,dailynews-gen,kk-daily-ai-voice}.md`; verifyall PASS |
| F8 | Run-anywhere workflow and script resolution | 🔧 active | 3 | 0080 package-root resolution (command -v kk walk) for YAML + sidecars, in-place run; 0081 VoiceScript template extracted to templates/; 0082 cwd-relative path fixes across storm/itc/template/judge workflows (`7a81b07` + follow-up); reopened 2026-09-14 for extension: 0127 global-install `workflows_dir` fallback + per-workflow workspace defaults, 0128 single-file-step flattening, 0129 docs sync (re-homed from cancelled P) |
| F7 | Audio-authoring skill extraction (wayfinder map) | ✅ done | 3 | 0077 `kk:audio-authoring` skill (solo mode, `434a01a`); 0078 rewrote `kk-solo-podcast` onto the skill (`c4ab400`); 0079 e2e verified dry-path + revise/duration mechanics; feature closed done 2026-08-24 |
| F9 | Explain-things skill and tell-me command | ✅ done | 3 | task `0083` done; fat `explain-things` skill + one-level `references/views.md`, thin `/tell-me`; smallest-view default, ELI5 opt-in, HTML last-resort; no aliases/subagent/CLI noun; verify PASS + Shippable PASS |
| F41 | kk-itc end-to-end (rough idea → multi-platform publish) | ✅ done | 3 | tasks `0149`–`0154` done; var-gated auto/unslop/judge-revise path + publish tail (materialize → plan → gate → fan-out/browser loop → report) + illustrations/adapt in `plugins/kk/workflows/kk-itc.yaml`; `kk stage itc-*` helpers in `itc-stages.ts`; `/workflow-run` kk-itc profile flags; draft-default publish rule (ADR-022); satellites `docs/design/kk-itc-end-to-end.md`; no new workflow file, `kk` noun or slash command (verified 0154) |
| **G** | kk workflows (repurposed 2026-10-07) | ⏳ planned | — | parent: one child per `plugins/kk/workflows/*.yaml`; shipped workflow features keep their IDs (see children Notes) |
| G1 | kk-daily-ai-voice | ⏳ planned | — | home node; historical: F6, F61*, L, L1, N, O |
| G14 | VoxCPM voice driver for both daily AI voice workflows | ⏳ planned | P2 | opt-in adapter, driver-aware cache and render-only quality comparison; ADR-036; `docs/design/voxcpm-daily-voice-driver.md`; no product access to `vendors/` |
| G15 | Daily AI Voice v3: split generation and preset-driven publishing | ✅ done | P2 | Reopened 2026-10-25 after replacement-readiness review; corrective tasks `0329`–`0335` **all done 2026-11-05** (generation, safety, draft enforcement, receipt recovery, schedules, and the acceptance evidence: fresh offline three-window rehearsal, 13/13 E2E + full gate 4613 pass / 0 fail). Feature verification PASS (`run_c222391f`) and `active→done` sync applied 2026-11-05. Voice2 remains production until a separately authorized cutover. See `docs/features/G15_daily-ai-voice-v3-split-generate-and-publish-preset-driven-channel-matrix.md`. |
| G11 | kk-daily-ai-voice2 — DAG daily workflow from the store, cut-over | ⏳ active | — | `0269` (stage-owned bounded XHS card retry) and `0270` (failed safety agents reach the fail-closed gate) done 2026-10-13; `0272` (WeChat console measurement/drift repair, upstream of E92 task `0260`) done 2026-10-13; `0273` cancelled with its valid retry-coverage concern merged into `0269`; `0265`–`0267` and earlier `0211`/`0212` done; ADR-031 shipped; satellite `docs/design/kk-collect-and-daily-voice2.md` |
| G2 | kk-itc | ⏳ planned | — | home node; historical: F4, F41 |
| G21 | kk-itc refactor: collected topics, plugin-owned publishing and reliable recovery | ⏳ planned | — | tasks `0298`–`0303`; 18 scenarios; DAG/child FSM, canonical config/workspaces, SEO handoff; accepted design ADR-040 amended and `docs/design/kk-itc-refactor.md`; no product implementation yet |
| G3 | kk-collect | ⏳ planned | — | home node |
| G31 | kk-collect: SQLite store, 4h collection, decision labels, topic extraction | ✅ done | — | tasks `0206` (store + `migrate`), `0208` (`lock`/`ingest`, `kk-collect`, `schedule render`), `0209` (decision catalog + `label`), `0210` (`extract`/`mark-used`, topic profiles) and `0213` (HIGH\|MEDIUM\|LOW confidence on the kk-collect label verdict, R14) done. ADR-030 **shipped**; satellite `docs/design/kk-collect-and-daily-voice2.md` |
| G32 | kk-collect store v2: backtestable labels, item facts, story dedup, topic-scoped selections | ✅ done | P2 | tasks `0225`–`0230` and residuals `0239`–`0242` done: store v2 (`0003_store_v2`) widens the `labels` observation identity and keeps raw evidence, promotes the typed `items` facts + `story_id` clustering, replaces `episode_usage` with the topic-scoped `selections` (`select`/`mark-published`/`release`), and adds the three judgment decisions with the china-politics prefilter + profile gate; `0230` ran the live cut-over dogfood + doc sync, `0241`/`0242` restored and re-settled the live v2 store; satellite `docs/design/kk-collect-and-daily-voice2.md` |
| G4 | kk-solo-podcast | ⏳ planned | — | home node; historical: F5 |
| G5 | kk-storm-research | ⏳ planned | — | home node; historical: C3–C5 |
| G6 | kk-ingest-generate-publish | ⏳ planned | — | home node; historical: B5 |
| G61 | Content pipeline consolidation: shared publish core, article/news verbs, simplified workflows | 🔶 partial | P1 | `0360`–`0364` shipped: launch safety, shared core, design, content types and named publish steps. Verify both nouns' dummy publish lifecycle; launch/workflow migration remains `0365`–`0369` (ADR-053). |
| G7 | kk workflow run ledger | ⏳ planned | — | cross-workflow capabilities |
| G71 | Per-workflow run ledger from spur action_runs | ⏳ ready | — | task `0207` |
| G8 | Workflow visibility in Spur Board: Collect, Daily AI Voice, IT Content | 🔧 active | 3 | tasks `0252`–`0254` done; `0255` adds the separately-packed-install acceptance (`apps/board/tests/installed-board.test.ts`, `scripts/tests/board-package.test.ts`), four tabs per module, operator setup in `docs/04_DESIGN.md`; 0319 adds the Collect channel-yield aggregate and 0320 the Daily episode funnel + supply-context panel (ADR-035 amendments 2026-10-16/22); [satellite](design/workflow-board-modules.md) |
| G9 | kk-smart-seo: evidence-grounded SEO and GEO audits | ⏳ planned | P2 | tasks `0281`–`0286` implemented: bounded public-site audit stages, typed decision provenance (22 catalog decisions in four catalogs), JSON/Markdown report and validated narrative, one `kk:smart-seo` skill with its references, and the separately-packed installed acceptance (`apps/cli/tests/smart-seo-installed.test.ts`: real fixture workflow offline, `decision status/show` under an offline maker, documented `decisions.paths` append that preserves existing paths and makers); surface and evidence limits in `docs/04_DESIGN.md`; status unchanged pending feature-level verification, and an operator-run live-site audit remains; [design](design/kk-smart-seo.md), ADR-039 |
| **H** | Real STORM + wt generator harvest | ❌ cancelled | — | split into **D4** plus former D5, now **F2** |
| **I** | LLM wiki (umbrella) | ⏳ planned | 3 | Committed 2026-11-10 by the operator specs; implementation lives in child **I1**; the treasury Quartz repository is a follow-on run |
| **I1** | kk wiki vault CLI | ⏳ planned | 1 | `kk wiki` verb family over `@gobing-ai/kk-wiki` (ADR-048): raw snapshots, wikilink graph, link/lint, merge with redirect, index/MAP compile, gc, `user_edited` guard, Quartz publish projection; model-bearing summarize/synthesize/query authoring in a `kk` skill; 24 AC scenarios; [design](design/kk-wiki.md) |
| **J** | Reposition knowledge-kit as an ingest-create-publish platform (wayfinder map) | ✅ done | 2 | ADR-007, PRD v3, contract designs (0032–0034), tree realignment (0035), doc sync (0036) — feature verified done |
| **K** | kk image pipeline — TypeScript image-gen + agent surface | ✅ done | 3 | Completed wayfinder map: provider matrix, format × style presets, image skills and slash command; see the [feature record](features/K_kk-image-pipeline-migrate-wt-image-skills-to-a-typescript-generator-plugin-wayfinder-map.md) |
| K1 | image-gen preset sample gallery README | ✅ done | 3 | Task `0340` done; repeatable real-provider preset gallery and README generator; see the [feature record](features/K1_image-gen-preset-sample-gallery-readme.md) |
| K3 | Evidence-guided image style presets | 🔶 partial | 3 | Task `0380` records provider-neutral runners, per-sample provenance and two blind evaluations; zero of six candidates passed, so no new styles shipped. Feature receipt remains pending on two unrelated `wechatmp-pub` test failures; see the [feature record](features/K3_evidence-guided-image-style-presets.md) |
| K2 | Local H3 image generation for image-gen | ⏳ active | 3 | Task `0379` todo; explicit `h3-local` provider, deterministic adapter tests, then real-render and scheduler gates before daily migration; cover remains pinned pending A/B approval; see the [feature record](features/K2_local-h3-image-generation-for-image-gen.md) |
| **L** | kk-daily-ai-voice — daily AI voice news pipeline (umbrella) | 🔧 active | — | umbrella node for the daily AI voice pipeline use cases; child L1 |
| **L1** | Redesign kk-daily-ai-voice workflow (was K) | 🔧 active | — | idea-pipeline run `idea-1788701858`: eval → design D1–D5 approved → 7 tasks `0092`–`0098` batch-created with deps (0094←0093, 0097←0092+0094+0095+0096, 0098←0097) |
| **L2** | daily-ai-voice quasi-news podcast cover | 🔧 active | P2 | tasks `0347`–`0349` **done 2026-11-10** (`441f3d2`, `6ab49e1`, `b18b4aa`): quasi-news podcast presets + lead-story Hook brief (0347), deterministic CJK headline compositing + podcast logo badge with `daily-cover-normalize` (0348), pin flip to `daily-news-podcast-cover` x `quasi-news-podcast` + standalone `daily-cover-mock.ts` verification runner (0349); each task verdict PASS / review Confidence HIGH / residual blocking=0; see `docs/features/L2_daily-ai-voice-quasi-news-podcast-cover.md` |
| **L3** | 每日AI乱炖节目定位、判断、分发与看板升级 | 🔧 active | P2 | 18 个验收场景、13 个任务；`0384`–`0396` 全部落地（判断台账、节目身份、简洁备注、封面、统一发布触发、看板证据、主题校准、选材连续性、来源引用、视频号公众号绑定、公开纠错）。**0389** 以冻结产物回放编辑→发布链并同步文档（`apps/cli/tests/editorial-publish-replay-0389.test.ts`），关闭前的装机包/离线传输演练只证明行为；真实账号、素材与实机发布确认仍在验收之外。见 [L3 设计与交接](design/daily-ai-news-editorial-delivery.md)。 |

## Open research gates

Both Phase-1 research gates are **resolved**.

| Gate | Task | Blocks | Outcome |
| ------ | ------ | --------- | --------- |
| ✅ D1 — study `vendors/storm` | `0001` (done) | D2 | stand-in = `wt:technical-content-creation`; real STORM → **D4** |
| ✅ E1 — wt-publish audit | `0002` (done) | E2/E3 | Surfdash = no-auth file/CLI; two-transport contract; multi-channel → **E4** |

## Map fog

Suspected but not yet sharp: Karakeep export schema in the synced folder; a `KarakeepLocalRM`
retrieval module for STORM corpus (**D4**); whether pipeline config lives outside `spur workflow`;
audio / stream generation as a generator output; exact B4 CLI command set; boundaries for future
WT image/research/adaptation agent-skill children under **F**; whether `plugins/kk` survives as a
single collection under the ~10 multi-channel targets.
