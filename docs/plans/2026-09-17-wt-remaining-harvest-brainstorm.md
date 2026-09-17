---
title: Remaining wt harvest — plugin vs skill, transport policy, wt retirement
date: 2026-09-17
needs_design: true
idea_run: 3411A725-8574-4E5F-BD73-5B14878DE76E
---

# Brainstorm: Remaining wt skill harvest into knowledge-kit

**Date:** 2026-09-17

## Overview

The operator wants the remaining `wt` skills migrated so plugin `wt` can be retired. The listed set mixes two different product kinds and several already-shipped harvests. Discovery against the current tree (features E/E4/F2/F3/F4/K, ADR-008/009, `publish-harness`, `qiita-pub`/`zenn-pub`/`surfdash-pub`) shows the raw list would recreate wt's two original failures: no shared foundation, and brittle script-only browser automation.

The real requirement is: finish the **E4 leftover publish channels** as tested `kind: publish` plugins on the existing harness, with a **policy that prefers official APIs, uses agent-driven browser when the page will drift, and keeps Playwright as an optional fast path**; then treat leftover `technical-content-creation` as **orchestration over already-harvested kk skills/workflows**, not a new generator plugin.

## Decision tree (resolved from the tree, not from taste)

### Root: plugin vs skill
- **Resolved:** both, with a hard kind rule. Runtime `Content → Result` work is a `plugins/publishings/<name>-pub` plugin (ADR-009). Operator HITL, login, and selector-healing live in `plugins/kk` skills. Generator plugins are only for `Doc[] | Brief → Content`.
- **Rationale:** F2/F3 already rejected turning topic-core / ITC into `plugin.json`. K already proved the split: engine plugin + thin kk skill.

### Branch: where `technical-content-creation` lands
- **Resolved:** not `plugins/generations`. Remaining 7-stage orchestration is a kk workflow (+ optional thin skill) under **F4** as a later child (`F41`), composing `topic` / `itc-generating` / `storm-research` / `image-authoring` / `content-judge` / publish plugins.
- **Rationale:** Stages 1–4 already exist in kk. F3 Scope-out is explicit: "remaining WT 7-stage harvest". F already has 9 children (F1–F9), so a new F10 is illegal (DD-14).

### Branch: remaining publishers
- **Resolved:** new child **E7** under E (E1–E6 occupy 6 of 9 slots). Do not reopen done E4. Do not revive cancelled G.
- **Rationale:** E4 Goal already named the leftover suite as follow-on intake under E. Hierarchy-mece: extend existing capability.

### Branch: X articles vs tweets
- **Resolved:** one plugin `x-pub` with two operations (`post`, `article`), following `podcast-pub`'s `operations` pattern. Not two plugins.
- **Rationale:** same target, same auth, same Result contract. X Automation Rules (updated April 2026) prohibit non-API browser automation for posts; tweets must use official `POST /2/tweets`. Articles (Premium long-form) have no equivalent public API — that operation stays browser/agent.

### Branch: Python rewrite
- **Resolved:** publish skills are already TypeScript/bun (E1 audit). Do not port TCC Python scripts (`outline-generator.py`, `topic-init.py`) — `topic` already replaced them. Harvest `@wt/web-automation` TypeScript into `@gobing-ai/publish-harness` (or a sibling package), not a new Python runtime.

## Approaches

### Approach 1: 1:1 skill clone into collections  — rejected

**Description:** Copy each listed skill into `plugins/generations/technical-content-creation` and `plugins/publishings/publish-to-*`, rewrite any remaining Python to TypeScript, keep Playwright scripts as the publish path.

**Trade-offs:**
- **Pros:**
  - Fastest mechanical migration; matches the operator's first folder mapping.
  - Preserves existing wt CLI flags and muscle memory.
- **Cons:**
  - Puts an orchestrator in the generator collection (kind lie; ADR-009).
  - Re-harvests Qiita (already `qiita-pub`) and ignores Zenn/Surfdash already shipped.
  - Repeats wt's missing shared library; `@wt/web-automation` stays outside kk.
  - Script-only Playwright stays the default, which is the brittleness the operator asked to fix.
  - Two X plugins for one target.

**Implementation Notes:** Would fight F2/F3/E4/K precedents on day one.

**Confidence:** HIGH that this is the wrong kind mapping.
**Sources:**
- ADR-009 plugin collections | **Verified**: 2026-09-17 (repo `docs/00_ADR.md`)
- F2/F3 feature files (topic and itc are skills, not plugins) | **Verified**: 2026-09-17
- E4 Notes: remaining channels are follow-on under E | **Verified**: 2026-09-17

### Approach 2: Transport-first harvest ⭐ Recommended

**Description:** Create feature **E7** as this idea's feature. First ship a shared browser/session layer on `publish-harness` (harvest `@wt/web-automation`, add `FakeBrowserTransport`). Then harvest remaining channels as `*-pub` plugins with a per-channel **transport policy**: official API/CLI (`file-cli`) when it exists; otherwise `browser` with an **agent driver** as the compatible default and an optional Playwright script as a fast path behind the same `Result`. Operator surface is one kk publish skill (or thin per-channel skills) that calls `kk executor run` / fan-out. Split X as operations on `x-pub`, not two plugins. Park TCC remainder as **F41** (follow-on, not this pipeline).

**Trade-offs:**
- **Pros:**
  - Reuses E2 harness, E4 harvest pattern (`qiita-pub`/`zenn-pub`), K's plugin+skill split.
  - Fixes the shared-foundation gap once, then every channel benefits.
  - API-first where 2026 docs exist (WeChat `draft/add`, Medium token API, X `POST /2/tweets`).
  - Agent-driven browser addresses selector drift without throwing away scripts.
  - Legal/ToS-safer for X posts (official API required).
- **Cons:**
  - Larger than a copy-paste; needs an ADR-008 detail amendment (browser *drivers*, not a third kind).
  - Agent-browser is slower and less deterministic than a healthy Playwright script.
  - WeChat API drafts still need AppID/secret + IP allowlist; live publish for uncertified 订阅号 still needs the MP console.
  - This pipeline creates **one** feature (E7). TCC remainder is a second feature after handoff.

**Implementation Notes:**
- Extend `PublishTransport.kind` remains `'file-cli' | 'browser'` (ADR-008). Add a driver field on browser transports: `'script' | 'agent'`. Do **not** invent a third kind.
- Harvest `~/projects/cc-agents/plugins/wt/scripts/web-automation` (`@wt/web-automation`: playwright launch, persistent profile, `trySelectors`, clipboard/paste) into the harness. Drop wt config.jsonc; secrets stay env-only (spec §2.4).
- Channel order (from E1 map, updated 2026-09-17):
  1. Foundation: harness FakeBrowser + session kit.
  2. `medium-pub` (token API, `file-cli`) — lowest risk, already API in wt.
  3. `wechatmp-pub` operations: `draft` via official `draft/add` (`file-cli`); `article`/`newspic` browser/agent for console-only bits.
  4. `x-pub` operations: `post` via official API; `article` browser/agent (Premium).
  5. Browser-only: `juejin-pub`, `substack-pub`, `infoq-pub`, `xhs-pub` — agent driver first, optional script.
- Default publish status is **draft**. Live publish is HITL.
- Per-channel kk skills are thin (login/preview/confirm). Fan-out stays `kk fanout` (ADR-007 R4).

**Confidence:** HIGH on kind split and API-first for Medium/WeChat-draft/X-post. MEDIUM on whether Juejin/XHS/InfoQ unofficial internal APIs are worth a `file-cli` attempt (ToS + breakage). LOW on X Articles API existing (none found).
**Sources:**
- E1 task 0002 rewrite map | **Verified**: 2026-09-17
- ADR-008 publish transports | **Verified**: 2026-09-17
- WeChat `draft/add` official docs | **Verified**: 2026-09-16 https://developers.weixin.qq.com/doc/subscription/api/draftbox/draftmanage/api_draft_add.html
- X API Manage Posts `POST /2/tweets` | **Verified**: 2026-09-02 https://docs.x.com/x-api/posts/manage-tweets/introduction
- X Automation Rules: non-API browser scripting may permanently suspend | **Verified**: 2026-04 (cited 2026-09-14)
- Playwright vs agent browsers: scripts for stable flows, agents for drift | **Verified**: 2026-03/05 https://www.codeandcontext.dev/blog/web-automation-for-ai-agents-playwright-vs-agent-browsers-vs-webmcp
- `@wt/web-automation` package | **Verified**: 2026-09-17 `~/projects/cc-agents/plugins/wt/scripts/web-automation`
- `podcast-pub` operations pattern | **Verified**: 2026-09-17 `plugins/publishings/podcast-pub/plugin.json`

### Approach 3: Super-publisher skill only, no new plugins

**Description:** Port `wt-super-publisher` into `plugins/kk/skills/` and keep per-channel Playwright (or agent-browser) inside the skill. No new `plugins/publishings/*` instances.

**Trade-offs:**
- **Pros:**
  - Smallest plugin-tree growth.
  - Fastest operator UX for "publish this article to N sites".
- **Cons:**
  - Cannot participate in `kk executor run` / `kk fanout` (not a publish kind).
  - Breaks the E Goal and PRD v3 "harvested as PublishPlugin instances".
  - Shared foundation still optional; each skill can drift again.
  - Daily workflows (`kk-daily-ai-voice`) already publish via plugins, not skills.

**Implementation Notes:** Useful as the **operator skill** in Approach 2, not as a substitute for plugins.

**Confidence:** HIGH that this fails the product contract if used alone.
**Sources:**
- ADR-007 / ADR-009 kind model | **Verified**: 2026-09-17
- Feature E Goal: channel instances behind E2 | **Verified**: 2026-09-17

## Recommendations

Take **Approach 2**. The operator's instincts (TypeScript, kk collections, shared foundation, agent/script balance, split X tweets vs articles) are right; the folder mapping and "nine skills = nine plugins" packing are not.

Reshape before feature-create:

| Operator ask | Fine-tune |
| --- | --- |
| Dump all 9 into kk | Drop already-harvested Qiita; Zenn/Surfing already shipped. Remaining publish = E7. |
| TCC → `plugins/generations` | No. Orchestrator skill/workflow under F4 (`F41` follow-on). |
| Python → TypeScript | Publish path is already TS. Do not port TCC Python. Harvest `@wt/web-automation`. |
| Balance agent vs scripts | API first; agent-browser default for CMS; Playwright optional fast path; same Result. |
| Shared foundation | Extend `publish-harness`; do not start a parallel lib. |
| Rename `publish-to-x` + add tweets | One plugin `x-pub` with operations `post` and `article`. |
| Retire wt entirely this feature | No. Leftovers: `lead-research-assistant`, `markitdown-browser`, leftover `/wt:topic-*` and `/wt:info-*` commands, image skills already in K. |

`needs_design: true` — new plugins, browser driver on the harness, ADR-008 detail amendment, operations-on-publish expansion.

## Design Summary

E7 harvests the leftover wt **publish** channels as `kind: publish` plugins on `@gobing-ai/publish-harness`. The harness gains a real `browser` implementation (session/profile, `FakeBrowserTransport`, harvested `@wt/web-automation`) with two **drivers** (`script` | `agent`) under the existing `browser` kind — not a third kind. Each channel picks transport by evidence: official API/CLI (`file-cli`) when documented and ToS-clean; otherwise agent-driven browser with optional Playwright. `x-pub` exposes `post` (official API) and `article` (browser/agent). `wechatmp-pub` exposes `draft` (official `draft/add`) plus console operations as needed. Default result is draft; live publish is HITL. Operator skills in `plugins/kk` are thin. `technical-content-creation` is **out of E7**; it becomes a later F4 child composing existing kk skills/workflows. Qiita/Zenn/Surfdash are not re-harvested.

## Next Steps

1. Operator approves this evaluation (idea-eval taste gate).
2. Create feature E7 with reshaped Goal/Scope/AC.
3. System design: ADR-008 amendment + harness satellite + per-channel policy table.
4. Decompose: foundation task first, then API channels, then browser channels, then x-pub operations.
5. After E7 ships, a separate `/sp-dev-idea` (or plan) for F41 TCC remainder and remaining non-publish wt leftovers.

---

**Generated by:** sp-brainstorm (idea-pipeline discovery, inline)
**Research delegation:** repo features/ADRs/plugins + official WeChat/X docs (2026-09) + Playwright vs agent-browser surveys (2026-03–05)
