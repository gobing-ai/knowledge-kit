---
schema_version: 1
name: Centralize daily Xiaohongshu illustration direction
status: done
template: feature-impl
created_at: 2026-11-23T01:20:51.116Z
updated_at: "2026-11-23T06:24:21.485Z"
feature_id: L4
priority: P2
tags:
  - daily-news
  - image-gen
estimate_hours: 4

dependencies: ["0424"]
done_forced: "false"
done_reason: unforced close
---

## 0425. Centralize daily Xiaohongshu illustration direction

### Background

L4 R3 centralizes daily XHS art direction while keeping the deterministic card plan, compositor and attachment order.

**Refine corrections (2026-11-22)**
- `sourcePoint` and `itemId` are normalized daily-plan fields, not inputs supplied on `master.items[].card`. Author each master `subject` from its matching `Doc` and settled card copy. Read `sourcePoint` and optional `itemId` directly in legacy/manual plan mode.
- The scheduled cover and closing cards derive their subject from the existing cover/first-card fallback. Preserve that derivation rather than asking the writer for new episode-level fields.

Current-tree sources: plugins/kk/scripts/daily-stages.ts:5689, plugins/kk/scripts/daily-stages.ts:6543, apps/cli/tests/kk-workflow-stages.test.ts:2448, plugins/kk/workflows/kk-news-generate.yaml:420.

### Requirements

- [x] R1. Install `kk:daily-news-illustrations` card mode and route current author, repair and legacy daily XHS visual directions through it.
- [x] R2. Given a valid ordered plan with an existing composed card, render only the missing artwork through image-gen. Preserve the pinned format/style/provider/model, deterministic card copy, published manifest, fallback and optional episode-cover attachment.

### Acceptance Criteria

- [x] AC1 — Daily cards share illustration direction and preserve their manifest

AC1 exercises R1 in the author/repair prompt fixture and R2 in the cached-card replay.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-23T01:21:30.188Z

**What stays in the card plan?** Keep copy, order, roles and source facts. Delegate the image scene to the daily illustration skill and use the existing card renderer and resume path.

#### Q&A entry — 2026-11-23T02:49:17.370Z

**How are card roles and story evidence handled?** Card art follows the corresponding selected item. The canonical master plan delegates only the subject. The daily renderer retains existing cover and closing scene fallbacks.

### Design

- Create `plugins/kk/skills/daily-news-illustrations/SKILL.md` with `card` mode. Use 0424's `visual_skill_root` and shared reference. The canonical writer skill stays responsible for `items[].card.copy`, `points`, story IDs and `cards.title/body`. Only delegate `items[].card.subject`; preserve repair scope. Source priority is matching approved Doc/lead and its retained fact, then choose a clear object or simple comparison without generated text.
- In the tracked legacy `xhs-write` prompts for voice and voice2, point to card mode and keep each plan's exact existing output, item scope and guards. For manual standalone work, emit the same `{title,body,cards}` plan and use `kk news generate-cards --work-dir` for a news run. Do not introduce a new agent hop, public verb, style preset, or renderer path.
- Preserve `dailyEditorialRender` cover/closing fallback and padding, and `dailyXhsRender` behavior including per-card retry, existing cached artifact checks, order, and episode cover last when the episode mode attaches it. Keep image-gen as the text-free artwork renderer and deterministic Chinese compositor. Leave the generic `kk:xhs-images` skill unchanged. Hand the card skill directory to 0426 for its inline mode.

### Plan

- [ ] Extend the editorial-render and cached-card scenarios in `apps/cli/tests/kk-workflow-stages.test.ts` with a sourced card scene and a pre-existing composed artifact.
- [ ] Add card mode and update only visual ownership and prompt pointers in `news-editorial` and the three daily workflows.
- [ ] Replay through the existing stage harness and assert one missing-card generation, original card ordering, deterministic text, preset/provider settings and the episode cover attachment.

### Solution

**Change map**

- `plugins/kk/skills/daily-news-illustrations/SKILL.md:1` — new skill, mode `card` (the only mode). It owns one sourced scene per card, composes against 0424's shared reference, keeps the derived cover/closing cards on the existing fallback, and copies `copy`/`points`/`role`/`layout`/`sourcePoint`/`itemId`/`title`/`body` through unchanged. It adds no agent hop, verb, preset or renderer path.
- `plugins/kk/skills/news-editorial/SKILL.md:82` — the per-item `card` slot now says its `subject` is composed per the illustrations skill, while `copy`/`points` and the episode `cards.title`/`body` stay editorial; `:210` adds the skill to the reference list.
- `plugins/kk/workflows/kk-news-generate.yaml:174` / `:217` — the canonical `script-write` and `script-fix` prompts now hand both visual fields to their owners in one line (`cover` → `daily-news-cover`, `items[].card.subject` → `daily-news-illustrations`, composition → the shared reference), keeping the `skill_dir` line, the plan paths, `expectFile` and `allowAppend`. Both prompts stay inside the ADR-115 error tier (993 / 901 chars).
- `plugins/kk/workflows/kk-daily-ai-voice.yaml:486` (state `xhs-write`) and `kk-daily-ai-voice2.yaml:774` (node `xhs-write`) — the legacy card-plan prompts point at mode `card` and drop the scene rules they used to restate; each keeps its exact output path, item scope, role/layout/copy contract and the 0392 topic-boundary sentence verbatim (907 / 942 chars).
- Untouched by design: `plugins/kk/scripts/daily-stages.ts:5700-5748` (`dailyEditorialRender` card plan + cover/closing fallback) and `:6543` (`dailyXhsRender` per-card render, cached-artifact reuse, episode-cover attachment), and the generic `kk:xhs-images` skill.

**Tests (written before the code)**

- `plugins/kk/tests/daily-news-illustrations.test.ts:1` — AC1/R1 structural contract: the skill declares mode `card`, owns `subject` only, defers `copy`/`points`/`sourcePoint`/`itemId`/`title`/`body`, keeps the fallback and the 240-char limit; all three daily workflows and `news-editorial` carry the pointer, and both legacy prompts keep `_18_xhs_plan.json` + `allowAppend: false`.
- `apps/cli/tests/kk-workflow-stages.test.ts:5300` — AC1/R2 replay: each content card's plan `subject` is the scene its own item authored, and the `cover`/`closing` cards reuse the existing episode fallback, with card order and deterministic copy unchanged (the cached-artifact case at `:2464` already proves one paid call and the preserved prompt).
- `plugins/kk/tests/runtime-requires.test.ts:166` / `:181` — the frozen entity table grows to 23 entities (19 skills) with the new `[cli:kk, local-fs]` skill.

**Preserved behaviour.** Pins, order, deterministic Chinese copy, the published manifest, the per-card retry, the cached-artifact check and the optional episode-cover attachment are unchanged: this task adds direction, not a render path.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — install `kk:daily-news-illustrations` card mode and route the current author, repair and legacy daily XHS visual directions through it | MET | `plugins/kk/skills/daily-news-illustrations/SKILL.md:1` (mode `card`, sourced-scene rules, derived cover/closing, copied-through fields) · `plugins/kk/skills/news-editorial/SKILL.md:82` (`items[].card.subject` handed to the skill, `copy`/`points`/`cards.title/body` kept) · `plugins/kk/workflows/kk-news-generate.yaml:174`/`:217` (canonical author + repair prompts) · `plugins/kk/workflows/kk-daily-ai-voice.yaml:486` and `kk-daily-ai-voice2.yaml:774` (legacy `xhs-write` prompts) · `plugins/kk/tests/daily-news-illustrations.test.ts:23`/`:37` — 5 pass / 0 fail |
| R2 — given a valid ordered plan with an existing composed card, render only the missing artwork through image-gen; preserve the pinned format/style/provider/model, deterministic card copy, published manifest, fallback and optional episode-cover attachment | MET | `apps/cli/tests/kk-workflow-stages.test.ts:5300` (each content card's plan `subject` is its own item's sourced scene; `cover`/`closing` reuse the episode fallback; order and deterministic copy unchanged) · the cached-artifact replay at `:2464` (exactly one paid call, the kept prompt byte-identical, manifest order preserved) · `plugins/kk/scripts/daily-stages.ts:5710-5748` and `:6543` are byte-identical (pins, fallback, per-card retry, resume, episode-cover attachment) · full suite green: 6361 pass / 0 fail |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Daily cards share illustration direction and preserve their manifest | MET | test | `apps/cli/tests/kk-workflow-stages.test.ts:5300` (sourced scenes + fallback + order) · `:2464` (one missing-card generation, manifest order, preserved prompt) · `plugins/kk/tests/daily-news-illustrations.test.ts:37` (all three workflows + `news-editorial` carry the pointer, legacy prompts keep their output path and `allowAppend: false`) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Review depth: **all** (SECUA + architecture depth + functional traceability) over the task's
uncommitted worktree change set (2 new files + 7 modified).

**Functional traceability** — R1 MET: `kk:daily-news-illustrations` ships mode `card` and every
card-authoring prompt reaches it (canonical `script-write`/`script-fix`, both legacy `xhs-write`
prompts, and `news-editorial`'s `items[].card` slot), while `copy`/`points`/`role`/`layout`/
`sourcePoint`/order stay with their existing owners. R2 MET: the replay asserts each content card's
plan `subject` is its own item's sourced scene and the `cover`/`closing` cards reuse the episode
fallback; the cached-artifact case still proves exactly one paid call with the kept prompt and the
manifest order intact. AC1 MET — evidence tables in
`.spur/run/runall-L4-0ad4-0425-review-cert.md`.

**SECUA** — no new input surface or verb; explicit rejection list; read-only assets; the legacy prompts
got shorter (907/942 chars) while keeping the 0392 topic-boundary sentence verbatim; the canonical
prompts are 993/901, inside the ADR-115 error tier; no UI.

**Architecture** — card direction is data in one skill, not a fourth copy of the scene rules. The two
ownership seams are where they were: editorial owns copy/order/plan shape, the renderer owns pins,
pixels, resume and the manifest.

**Findings** — P4 (advisory): the legacy prompts name the skill instead of restating its rules, so a
different composition family is a reference edit. Accepted by design. No open P1/P2/P3.

**Verification** — focused suites green (247 pass across `kk-workflow-stages`,
`kk-daily-ai-voice-workflow`, `voice2-dag`; 24 pass across the four pointer/snapshot suites) and the
full suite green (6361 pass / 0 fail) with the gate reading a complete coverage corpus.

**Disposition** — PASS.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-23T06:15:59.010Z todo → wip (system)
- 2026-11-23T06:24:20.065Z wip → testing (system)
- 2026-11-23T06:24:21.480Z testing → done (system)

