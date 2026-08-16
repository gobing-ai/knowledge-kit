---
name: Features
doc: 05_FEATURES
owns: STATUS — feature decomposition + state
authority: derived
version: 2.13.0
created_at: 2026-07-22
updated_at: 2026-08-15
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
> **2026-08-12 (D5 → F2):** the WT agent-skill harvest moved under **F** to honor that collection boundary. F2 is narrowed to one fat `topic` skill for topic-core authoring; remaining WT families require later intake.
>
> **2026-08-07 (0037):** LLM-as-judge repositioned from fourth plugin kind to **agent skills + `agent.run`**
> (ADR-007 amdt 2026-08-07, superseding the 2026-08-02 amendment). **B7** renamed "LLM-as-judge
> agent skills"; plugin taxonomy reverts to three kinds (`ingestion`, `generator`, `publish`).
> Fat skill `judge` + thin wrappers deliver verdict gating with zero engine work. Map:
> `docs/plans/feature-tree-restructure-map-j.md`.

## Status legend

✅ done · 🔶 partial · ⏳ planned/current · ⏳ ready (decomposed, unblocked) · ⏳ blocked (decomposed, dep-gated) · ⏳ backlog (tree: backlog) · ⏳ active (tree: active — open for intake) · ⏳ verifying (tree: verifying — roll-up/close-out in progress) · 💤 deferred · 🌫️ fog (undecided) · ❌ cancelled

## Feature tree

| ID | Feature | Status | Phase | Notes |
|----|---------|--------|-------|-------|
| **A** | Project foundation | ✅ done | 0 | Monorepo substrate + tooling; close-out task `0013` verified (gates PASS) |
| A1 | Feature tree restructure | ✅ done | 0 | tree+docs applied; tasks `0006`–`0009` **done**; map `docs/plans/feature-tree-restructure-map.md` |
| A2 | kk product CLI surface | ✅ done | 2 | tasks `0049`–`0051` done; operator binary `kk` (package `@gobing-ai/knowledge-kit` unchanged); register-per-command tree; `bin.kk` + `knowledge-kit` alias + `prepack`; ADR-010; spec `docs/design/kk-cli-surface.md` |
| A21 | Two-layer CLI nouns (executor + plugin) | ✅ done | 2 | task `0052` done; `kk executor run\|fan-in\|fan-out` + `kk plugin status`; hidden aliases; `add` retired; ADR-011; dogfood `docs/dogfood/2026-08-12-A21-two-layer-cli-dogfood.md` |
| **B** | Plugin platform | ✅ done | 1 | skill-first seam (ADR-006 amdt 2026-07-24); B1–B7 done (B7 = multi-root discovery, task `0053`); task `0028` verified; kk-judge moved under **F** as F1 |
| B1 | Plugin manifest + registry/discovery | ✅ done | 1 | task `0004`: `plugin.json` + `discoverPlugins` / `listByKind` |
| B2 | Typed lifecycle contracts | ✅ done | 1 | task `0003`: Doc/Content/Result + `kindContract` in `@gobing-ai/kk-core` |
| B3 | Spur workflow integration | ✅ done | 1 | task `0005`: `knowledge-kit invoke` + pipeline workflow template; E2E proof → **B5** |
| B4 | CLI surface | ✅ done | 1 | tasks `0020`/`0021` done: `plugins list` + `plugins doctor` (noun group, `--json`); verifyall re-audit PASS + shippable; commit `fed9412` |
| B5 | End-to-end pipeline acceptance | ✅ done | 1 | tasks `0026`/`0027` done; vertical over B3 invoke + C2/D2/E3 proven (fixture → content → `ok:true`); verifyall re-audit PASS + shippable; commits `662ba0b`/`41bf221` |
| B6 | Sequential fan-in/fan-out steps | ✅ done | 2 | home for 0033 spec (`kk fanin` / `kk fanout`; `docs/design/fan-in-and-fan-out-specification.md`); tasks `0042`/`0043` done (fanin merge + fanout retry-from); docs synced 2026-08-12 |
| B7 | Multi-root plugin auto-discovery | ✅ done | 2 | task `0053` done; ADR-012 shipped — `discoverAllPlugins` / `resolvePluginRoots` + `origin`-stamped records + `shadowed` diagnostic in `@gobing-ai/kk-core`; repeatable `--plugins-path` on `executor run` / `fan-out` / `plugin status`; `KK_PLUGIN_PATH`; `--plugins-root` exclusive (combined with `--plugins-path` → exit 2); workflow template injects `--plugins-path`. **Not** the historical judge B7 (that work is **F1**). |
| **C** | Ingestion | ⏳ active | 1 | kind parent; AC rolled up from C1+C2 (DD-09); ingestion optional (`Doc[] \| Brief` pipeline, ADR-007); closed via carrier `0039`, then **reopened for plugin intake** |
| C1 | Ingestion plugin design | ✅ done | 1 | tasks `0010`–`0012` done; spec `docs/design/ingestion-plugin-specification.md`; verifyall re-audit PASS + shippable |
| C2 | Karakeep-local | ✅ done | 1 | tasks `0014`/`0015` done; feature transitioned done (check clean); hardening follow-up → task `0029` (edge on parent C) |
| C3 | STORM topic-research workflow | ✅ done | 3 | wayfinder map; tasks `0054`/`0055` done; `.spur/workflows/kk-storm-research.yaml` + fixture `plugins/ingestions/web-search`; live Firecrawl not in this map; dogfood `docs/dogfood/2026-08-14-C3-storm-research-workflow-dogfood.md` |
| C4 | Daily-usable STORM research | ✅ done | 3 | wayfinder map; tasks `0056`–`0060` done; live Firecrawl + md in/out + `~/.config/kk/works/<topic-id>/` + `storm-research` skill + `/workflow-run`; dogfood `docs/dogfood/2026-08-14-C4-daily-usable-storm-research-dogfood.md`; verifyall Shippable PASS |
| **D** | Content generation | ⏳ active | 1 | kind parent; re-cut: `Doc[] \| Brief`, creation co-equal with ingestion (ADR-007 R3); AC rolled up from D3+D2 (DD-09); closed via carrier `0040`, then **reopened for plugin intake** |
| D1 | Study vendors/storm → pick stand-in | ✅ done | 1 | task `0001`: stand-in = `wt:technical-content-creation` |
| D2 | Wire existing generator skill to contract | ✅ done | 1 | tasks `0022`/`0023`; D3 spec done (`0017`) — gate satisfied |
| D3 | Generator plugin design | ✅ done | 1 | tasks `0016`/`0017` done; cites C1 generic contract §1 |
| D4 | Own STORM generator | ✅ done | 3 | tasks `0046` + `0047` done; owned STORM pipeline shipped behind the generator contract |
| **E** | Multi-channel publish | ⏳ active | 1 | kind parent (renamed from "Publish", 0035); AC rolled up from E2+E3 (DD-09); suite in scope → **E4**; closed via carrier `0041`, then **reopened for plugin intake** |
| E1 | wt-publish audit | ⏳ backlog | 1 | task `0002` done (transports mapped; Surfdash simplest); feature close-out (verifyall) pending |
| E2 | Publish design and test harness | ✅ done | 1 | tasks `0018`/`0019` done; transport abstraction + `packages/publish-harness`; verifyall re-audit PASS + shippable; commit `2195d14` |
| E3 | Surfdash publisher (tested) | ✅ done | 1 | tasks `0024`/`0025` done; `plugins/publishings/surfdash-pub` + hardened failure modes; verifyall re-audit PASS + shippable; commit `d8b19d0` |
| E4 | Multi-channel suite harvest | ✅ done | 2 | Zenn + Qiita first tranche shipped (`plugins/publishings/zenn-pub`, `plugins/publishings/qiita-pub`; tasks `0044`/`0045`); remaining channels (Surfing/X/Juejin/Medium/Substack/InfoQ/XHS) are follow-on intake under **E** |
| E5 | EmDash CMS publisher | ✅ done | 2 | task `0061` done; `plugins/publishings/emdash-pub` REST PAT transport + markdown→Portable Text mapper; satellite `docs/design/emdash-pub.md`; verify PASS + Shippable PASS (12/12 scenarios MET) |
| **F** | kk plugin collection | ⏳ backlog | 2/3 | collection parent for `plugins/kk` capabilities (skills, commands, subagents, hooks, rules); F1 = judge; F2 = topic-core authoring |
| F1 | LLM-as-judge agent skills | ⏳ verifying | 2 | home for 0034/0037: fat skill `judge` + thin wrappers (tech-accuracy, brand-tone, compliance); `agent.run` + shell/jq verdict gate; ADR-007 amdt 2026-08-07 supersedes the 2026-08-02 fourth-kind amendment |
| F2 | Topic-core authoring skill | ⏳ ready | 3 | task `0048`: one fat `topic` skill with `create`, `init`, `outline`, and `draft`; no wrappers or runtime-plugin seam |
| **G** | PublishPlugin rewrite epic | ❌ cancelled | — | absorbed into **E** (now **E4** suite harvest) |
| **H** | Real STORM + wt generator harvest | ❌ cancelled | — | split into **D4** plus former D5, now **F2** |
| **I** | LLM wiki | 🌫️ fog | 3 | undecided; go/no-go spike first |
| **J** | Reposition knowledge-kit as an ingest-create-publish platform (wayfinder map) | ✅ done | 2 | ADR-007, PRD v3, contract designs (0032–0034), tree realignment (0035), doc sync (0036) — feature verified done |


## Open research gates

Both Phase-1 research gates are **resolved**.

| Gate | Task | Blocks | Outcome |
|------|------|---------|---------|
| ✅ D1 — study `vendors/storm` | `0001` (done) | D2 | stand-in = `wt:technical-content-creation`; real STORM → **D4** |
| ✅ E1 — wt-publish audit | `0002` (done) | E2/E3 | Surfdash = no-auth file/CLI; two-transport contract; multi-channel → **E4** |

## Map fog

Suspected but not yet sharp: Karakeep export schema in the synced folder; a `KarakeepLocalRM`
retrieval module for STORM corpus (**D4**); whether pipeline config lives outside `spur workflow`;
audio / stream generation as a generator output; exact B4 CLI command set; boundaries for future
WT image/research/adaptation agent-skill children under **F**; whether `plugins/kk` survives as a
single collection under the ~10 multi-channel targets.
