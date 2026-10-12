---
schema_version: 1
name: Register threads and weibo wherever publish channels are enumerated
status: todo
template: feature-impl
created_at: 2026-10-09T23:19:30.103Z
updated_at: "2026-10-12T04:30:35.073Z"
feature_id: E94
priority: P2
tags:
  - publish
  - docs
  - E94
estimate_hours: 2

dependencies: ["0243", "0244"]
---

## 0245. Register threads and weibo wherever publish channels are enumerated

### Background

Both channels must appear wherever publish channels are enumerated. Design: `docs/design/weibo-threads-publish-channels.md` §4.

Implements: R8 — both plugins refuse an unknown operation or driver by name before any transport; R9 — both plugins run offline under the fake publish transport; R10 — the new channels are listed wherever publish channels are enumerated.

**Refine corrections (2026-10-09)**
- `docs/04_DESIGN.md` profile-env table and per-plugin sections were assigned here → T3 puts surface docs with the surface code → moved to 0243/0244; this task keeps only enumerations.
- "Add weibo to the CHANNELS list" → the describe asserts *exactly six* channels (`apps/cli/tests/commands/plugin-check.test.ts:177-184`) → it becomes seven, with title and assertion text updated.
- Registry enumerations → two alphabetical lists (`packages/kk-core/tests/registry.test.ts:241`, `packages/kk-core/tests/registry.test.ts:608`).
- Additional enumeration found: the `kk-plugin-check.md` index row says "all six channels" (`docs/04_DESIGN.md:24`).
- Cross-plugin fake test → existing pattern is `runFanout` with fake env (`apps/cli/tests/fanout.test.ts:1006`).
- Concurrency: no `wip` tasks; worktree `knowledge-kit-runall-0237-0238-53a2` touches only `plugins/kk/scripts/daily-stages.ts` + `plugins/kk/workflows/kk-daily-ai-voice2.yaml` → no overlap.

**Refine corrections (2026-10-11)**
- Driver refusal was limited to a constructor and thus not observable in a real-plugin fan-out → 0244 now freezes `options.driver` input; cover it through real subprocess IO.
- Fake fan-out using default Weibo post would violate its no-draft guard → fixture uses shared `metadata.publishStatus: public` and default post, never real publishing.
- A hardcoded “shipped” row after 0245 overstated pending live verification → report implementation complete with live selectors pending; final shipped status is owned by 0246.
- Current package staging bundles manifest entry and check through `bundleStagedEntry`/`bundleDeclared` → exercise existing packaging/discovery, no new registry or bundler path.
- Historical concurrency inventory → Current-tree audit (2026-10-11): no WIP tasks. Other worktree `knowledge-kit-runall-g8-4173` owns G8 board/workflow work and currently edits root `package.json`, `bun.lock`, and `apps/cli/package.json`; coordinate lockfile integration before implementation, preserve its changes. The main tree has pre-existing edits in daily, store-selections, voice2-dag and wechatmp tests; preserve them.

### Requirements

- [ ] R1. Add `threads-pub` and `weibo-pub` (alphabetical) to both lists in `packages/kk-core/tests/registry.test.ts` (:241, :608).
- [ ] R2. Add `weibo-pub` to `CHANNELS` in `apps/cli/tests/commands/plugin-check.test.ts`; rename "six" → "seven" in the describe/test titles; `threads-pub` stays absent (no `check`).
- [ ] R3. `plugins/kk/skills/publish/SKILL.md`: channel-table rows for threads post (file-cli) and weibo post/article (browser/script) near :26; correct the touched x article/Juejin/InfoQ/Substack rows from stale browser/agent routing to their existing script-driver executor entries (ADR-027), so the comparison is accurate; env-table rows `THREADS_ACCESS_TOKEN`, `THREADS_USER_ID` and `WEIBO_PROFILE_DIR` near :101.
- [ ] R4. `docs/03_ARCHITECTURE.md`: layout lines near :52, package-table rows near :411, browser-channel list near :438 (weibo-pub only).
- [ ] R5. `docs/04_DESIGN.md`: index row `kk-plugin-check.md` "six" → "seven" (:24); satellite index row status → `implemented; live verification pending 0246 (E94)`.
- [ ] R6. A fan-out test in `apps/cli/tests/fanout.test.ts` runs `--target threads-pub --target weibo-pub` under `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake` (ok, 2 succeeded), plus one asserting an unknown `options.operation` fails each target with a message naming the value and supported set. Add an `options.driver: 'agent'` input test showing both refuse through the actual plugin subprocess. Fake happy-path Content carries `metadata.publishStatus: 'public'`; no credentials/profile are required. Every aggregate must validate with `AggregateResultSchema`.

**Out of scope:** `plugins/kk/scripts/itc-stages.ts` and daily workflows; per-plugin 04 sections (0243/0244).

- [ ] R7. Extend existing packaging verification only where it enumerates channels; verify built/staged discovery of both manifests and the Weibo bundled check through `scripts/bundle-plugins.ts`/existing packaging tests, without hand-editing staged assets. Keep the satellite itself at implementation-complete/live-pending status until 0246.

### Acceptance Criteria

- [ ] AC1 — both plugins refuse an unknown operation or driver by name before any transport (req: R6)
- [ ] AC2 — both plugins run offline under the fake publish transport (req: R6)
- [ ] AC3 — the new channels are listed wherever publish channels are enumerated (req: R1) (req: R2) (req: R3) (req: R4) (req: R5)

Test layer: `apps/cli/tests/fanout.test.ts` (real plugin processes, fake transport); registry/plugin-check suites observe discovery and probe declarations. Driver refusal for weibo is unit-proven in 0244 (the driver is not a fan-out option).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T23:48:34.337Z

- **Driver in the fan-out test** — closed: the driver is a constructor seam, so the fan-out test covers operation refusal; the weibo driver refusal is proven in 0244's suite.

#### Q&A entry — 2026-10-12T04:28:52.091Z

- **Real process driver check** — closed: use 0244’s `options.driver` contract; use direct executor tests if fan-out strips raw options, never expand fan-out scope.
- **Status** — closed: 0245 reports implementation/live-pending; 0246 owns final verification and follows this task.

### Design

- **Approach:** edit enumerations in place; one fan-out test owns the cross-plugin R8/R9 claims through the real plugin entries. Reason: both scenarios are about the two plugins together, so one test location proves them.
- **Where:** `packages/kk-core/tests/registry.test.ts`, `apps/cli/tests/commands/plugin-check.test.ts`, `apps/cli/tests/fanout.test.ts`, `plugins/kk/skills/publish/SKILL.md`, `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`.
- **No new API.** No source changes outside tests and docs; existing bundler behavior is exercised, not changed.
- **Anti-patterns:** no generated channel registry; no edit to `itc-stages.ts`; do not add `threads-pub` to the probe list.
- **Dependencies:** assumes 0243/0244 shipped `plugin.json` (weibo with `check`), `processPublishIO` and the fake-env switch; leaves the satellite row flip for 0246 to finalize.

- **Observable cross-plugin validation:** use the existing real-plugin/fake-env `runFanout` pattern (search the actual fake-env cases in `apps/cli/tests/fanout.test.ts`, not the obsolete line 1006 anchor). Put raw `options` alongside Content in the JSON input. Current `runFanout` parses Content for orchestration, but production `pluginDispatch` passes the original `opts.contentPath` to `spawnPluginEntryAsync` (`apps/cli/src/fanout.ts:422` and `:565`); raw `options` therefore reach the real plugin subprocess. Use that exact seam for operation and driver refusal tests; do not add a fan-out option or serialization layer. Snapshot/restore the fake env, run no real browser/network, assert aggregate target names are plugin names while per-plugin Results use `threads`/`weibo`.
- **Registration sweep:** search channel lists in source, tests, packaging fixtures, README, `docs/design/kk-plugin-check.md`, the publish skill and docs 03/04. Update enumeration/count claims in those same areas only; do not wire daily/ITC. Use the docs constitution for frontmatter and same-commit sync. `threads-pub` declares no check; Weibo is the seventh browser check.
- **Handoff:** Downstream task 0246 follows this registration task as well as the browser implementation task, preventing concurrent edits of the satellite status row. No row may claim live verification before 0246's evidence exists.
- Current-tree audit (2026-10-11): no WIP tasks. Other worktree `knowledge-kit-runall-g8-4173` owns G8 board/workflow work and currently edits root `package.json`, `bun.lock`, and `apps/cli/package.json`; coordinate lockfile integration before implementation, preserve its changes. The main tree has pre-existing edits in daily, store-selections, voice2-dag and wechatmp tests; preserve them.

### Plan

- [ ] 1. `rg -n "x-pub|xhs-pub|six" packages/kk-core/tests apps/cli/tests plugins/kk/skills/publish docs/03_ARCHITECTURE.md docs/04_DESIGN.md` to confirm every site.
- [ ] 2. Update registry and plugin-check tests → R1/R2.
- [ ] 3. Add the fan-out tests → R6.
- [ ] 4. Skill + 03 + 04 edits → R3–R5.
- [ ] 5. `bun run gate`.

- [ ] 6. Audit current channel count mentions in README/packaging fixtures and `docs/design/kk-plugin-check.md`, verify the built manifests/check and live-pending status → R2/R5/R7. No generated registry or new API.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature E94; design `docs/design/weibo-threads-publish-channels.md` §4; depends on 0243, 0244

### History
