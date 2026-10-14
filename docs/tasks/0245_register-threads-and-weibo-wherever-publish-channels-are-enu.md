---
schema_version: 1
name: Register threads and weibo wherever publish channels are enumerated
status: done
template: feature-impl
created_at: 2026-10-09T23:19:30.103Z
updated_at: "2026-10-14T05:04:12.292Z"
feature_id: E94
priority: P2
tags:
  - publish
  - docs
  - E94
estimate_hours: 2

dependencies: ["0243", "0244"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0245-verdict.json
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

- [x] R1. Add `threads-pub` and `weibo-pub` (alphabetical) to both lists in `packages/kk-core/tests/registry.test.ts` (:241, :608).
- [x] R2. Add `weibo-pub` to `CHANNELS` in `apps/cli/tests/commands/plugin-check.test.ts`; rename "six" → "seven" in the describe/test titles; `threads-pub` stays absent (no `check`).
- [x] R3. `plugins/kk/skills/publish/SKILL.md`: channel-table rows for threads post (file-cli) and weibo post/article (browser/script) near :26; correct the touched x article/Juejin/InfoQ/Substack rows from stale browser/agent routing to their existing script-driver executor entries (ADR-027), so the comparison is accurate; env-table rows `THREADS_ACCESS_TOKEN`, `THREADS_USER_ID` and `WEIBO_PROFILE_DIR` near :101.
- [x] R4. `docs/03_ARCHITECTURE.md`: layout lines near :52, package-table rows near :411, browser-channel list near :438 (weibo-pub only).
- [x] R5. `docs/04_DESIGN.md`: index row `kk-plugin-check.md` "six" → "seven" (:24); satellite index row status → `implemented; live verification pending 0246 (E94)`.
- [x] R6. A fan-out test in `apps/cli/tests/fanout.test.ts` runs `--target threads-pub --target weibo-pub` under `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake` (ok, 2 succeeded), plus one asserting an unknown `options.operation` fails each target with a message naming the value and supported set. Add an `options.driver: 'agent'` input test showing both refuse through the actual plugin subprocess. Fake happy-path Content carries `metadata.publishStatus: 'public'`; no credentials/profile are required. Every aggregate must validate with `AggregateResultSchema`.

**Out of scope:** `plugins/kk/scripts/itc-stages.ts` and daily workflows; per-plugin 04 sections (0243/0244).

- [x] R7. Extend existing packaging verification only where it enumerates channels; verify built/staged discovery of both manifests and the Weibo bundled check through `scripts/bundle-plugins.ts`/existing packaging tests, without hand-editing staged assets. Keep the satellite itself at implementation-complete/live-pending status until 0246.

### Acceptance Criteria

- [x] AC1 — both plugins refuse an unknown operation or driver by name before any transport (req: R6)
- [x] AC2 — both plugins run offline under the fake publish transport (req: R6)
- [x] AC3 — the new channels are listed wherever publish channels are enumerated (req: R1) (req: R2) (req: R3) (req: R4) (req: R5)

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

- [x] 1. `rg -n "x-pub|xhs-pub|six" packages/kk-core/tests apps/cli/tests plugins/kk/skills/publish docs/03_ARCHITECTURE.md docs/04_DESIGN.md` to confirm every site.
- [x] 2. Update registry and plugin-check tests → R1/R2.
- [x] 3. Add the fan-out tests → R6.
- [x] 4. Skill + 03 + 04 edits → R3–R5.
- [x] 5. `bun run gate`.

- [x] 6. Audit current channel count mentions in README/packaging fixtures and `docs/design/kk-plugin-check.md`, verify the built manifests/check and live-pending status → R2/R5/R7. No generated registry or new API.

### Solution

#### Change map

| Path | What changed |
| --- | --- |
| `plugins/kk/skills/publish/SKILL.md:31-32` | Two new channel-table rows: `threads` (`file-cli`, Threads Graph two-step text post, no browser path) and `weibo` (`browser`/`script`, 头条文章 draft by default or the home composer only for `publishStatus: public`). |
| `plugins/kk/skills/publish/SKILL.md:27-30` | Stale routing corrected: the `x article`, `juejin`, `infoq` and `substack` rows said `browser` / `agent` + "workflow `agent.run`", but all four are script-driver channels driven by `kk executor run` (ADR-027). The comparison table is now accurate. |
| `plugins/kk/skills/publish/SKILL.md:104-105` | Env rows: `threads-pub post` needs `THREADS_ACCESS_TOKEN` + `THREADS_USER_ID`; `weibo-pub` needs no env (its session is the browser profile) and `WEIBO_PROFILE_DIR` is documented as the dir override with the full tier. |
| `docs/03_ARCHITECTURE.md:65-66` | Layout block gains `threads-pub/` (file-cli) and `weibo-pub/` (browser/script). |
| `docs/03_ARCHITECTURE.md:433-434` | Package table gains both rows with their dependency sets (threads has no `ts-browser-automation`; weibo does). |
| `docs/03_ARCHITECTURE.md:457` | The channel-plugin list in the E7 section gains `weibo-pub`; the sentence now also names `threads-pub` as a file-cli channel on the tweet-API rails. |
| `docs/04_DESIGN.md:24` | `kk-plugin-check.md` satellite row: "all six channels" → "all seven channels (E93, 0215+0216; E94 adds `weibo-pub`)". |
| `docs/04_DESIGN.md:43` | `weibo-threads-publish-channels.md` satellite row: `proposed (E94)` → `implemented; live verification pending 0246 (E94)` — the honest status while 0246 owns live selector verification. |
| `docs/design/kk-plugin-check.md:3-4,60-61` | The satellite's own count claims: six → seven browser channels with a manifest `check` entry, naming E94/0245 as the change. |
| `docs/design/web-automation-engine.md:111` | "shipped for all six channels" → "all seven" (profile-dir coverage). |
| `scripts/bundle-plugins.test.ts:35` | `CHECK_DECLARING_PLUGINS` gains `weibo-pub` (and `threads-pub` stays absent — it declares no `check`). The existing staging test then proves the bundled `weibo-pub` check is rewritten to a `./dist/*.js` artifact that exists, with no hand-edited staged asset (R7). |
| `apps/cli/tests/fanout.test.ts:1131-1255` | Four cross-plugin tests over the **real** plugin entries under `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake`: both channels fan out in one run (aggregate `ok`, `2 succeeded`, one entry per plugin name), each plugin resolves its own fake transport kind (file-cli vs browser), an unknown `options.operation` fails both targets by name and supported set, and `options.driver: 'agent'` is refused through both subprocesses. Raw `options` travel inside the content file, the same path production dispatch passes (R6, AC1/AC2). |

#### Requirements already satisfied by the prerequisite tasks (verified here, not re-edited)

- **R1** — `packages/kk-core/tests/registry.test.ts` already lists both channels in both inventories (`:238`, `:242`, `:606`, `:611`), landed by 0243/0244 because the suites assert the shipped plugin set exactly.
- **R2** — `apps/cli/tests/commands/plugin-check.test.ts:177-179` already has `weibo-pub` in `CHANNELS` with the "seven" titles, landed by 0244 (its manifest created the seventh probe).

#### Rationale

- **One enumeration, many surfaces.** Every place that counts browser channels now says seven and names `weibo-pub`; `threads-pub` is deliberately absent from probe lists because it declares no `check` — the ADR-032 probe contract is "a browser channel declares a readiness probe", and an API channel has nothing to probe.
- **The cross-plugin claims run through real plugin processes.** Injected fakes would prove the fakes; `kk fanout` spawning the shipped manifests proves the discovery, the `processPublishIO` contract and both refusal sets together — which is exactly what E94 R8/R9 need, since their scenarios are "both plugins".
- **Verification-only edits stay verification-only.** The result of the enumeration sweep is docs, one test list, one fan-out suite and one satellite status row: no source change, no new API, no generated registry (the task's anti-patterns).
- **Status honesty.** The satellite moves to *implemented; live verification pending* rather than *shipped*: 0246 owns the live selector walk, and nothing here claims it happened.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/kk-core/tests/registry.test.ts:238` and `:243` (first inventory), `packages/kk-core/tests/registry.test.ts:608` and `:613` (second) — both channels asserted exactly; verified here, landed by 0243/0244 because the suites pin the shipped set |
| R2 | MET | `apps/cli/tests/commands/plugin-check.test.ts:179` (`weibo-pub` in `CHANNELS`) and `apps/cli/tests/commands/plugin-check.test.ts:181` ("seven browser publish channels, no others"); `threads-pub` deliberately absent (no `check`) |
| R3 | MET | `plugins/kk/skills/publish/SKILL.md:31-32` (threads + weibo channel rows), `plugins/kk/skills/publish/SKILL.md:27-30` (x article / juejin / infoq / substack corrected to their script-driver entries), `plugins/kk/skills/publish/SKILL.md:104-105` (env rows `THREADS_ACCESS_TOKEN`, `THREADS_USER_ID`, `WEIBO_PROFILE_DIR`) |
| R4 | MET | `docs/03_ARCHITECTURE.md:66-67` (layout), `docs/03_ARCHITECTURE.md:434-435` (package table), `docs/03_ARCHITECTURE.md:458` (channel list) |
| R5 | MET | `docs/04_DESIGN.md:25` (satellite index row: all seven channels), `docs/04_DESIGN.md:44` (satellite status `implemented (E94)`, naming the open 0246 live evidence) |
| R6 | MET | `apps/cli/tests/fanout.test.ts:1162-1255` — happy fan-out, per-plugin fake kind, unknown operation, agent driver, all through the real plugin entries under `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake` |
| R7 | MET | `scripts/bundle-plugins.test.ts:35` — `CHECK_DECLARING_PLUGINS` includes `weibo-pub`, and the staged manifests are inspected at `scripts/bundle-plugins.test.ts:331-350` (the declared check is rewritten to an existing `./dist/*.js`); `threads-pub` omitted (no declared check) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R8 — both plugins refuse an unknown operation or driver by name before any transport | MET | test | `apps/cli/tests/fanout.test.ts:1211-1235` — `kk fanout` spawns both real plugins; `unsupported operation 'dm'` names each plugin's supported set. `apps/cli/tests/fanout.test.ts:1236-1255` — `options.driver: 'agent'` refused by both subprocesses |
| R9 — both plugins run offline under the fake publish transport | MET | test | `apps/cli/tests/fanout.test.ts:1162-1180` — aggregate `ok: true`, `summary { total: 2, succeeded: 2, failed: 0, skipped: 0 }`, one entry per plugin name; `apps/cli/tests/fanout.test.ts:1182-1209` — each channel resolves its own fake kind (`fake-file-cli` / `fake-browser`) |
| R10 — the new channels are listed wherever publish channels are enumerated | MET | test | machine-asserted lists: `packages/kk-core/tests/registry.test.ts:238,243,608,613`; `apps/cli/tests/commands/plugin-check.test.ts:179`; `plugins/kk/skills/publish/SKILL.md:31-32`; `docs/03_ARCHITECTURE.md:66-67,434-435,458`; `docs/04_DESIGN.md:25,44`; `docs/design/kk-plugin-check.md:3-4,60-61`; `docs/design/web-automation-engine.md:111`; `scripts/bundle-plugins.test.ts:35` |
| AC1 — both plugins refuse an unknown operation or driver by name before any transport (req: R6) | MET | test | `apps/cli/tests/fanout.test.ts:1211-1255` |
| AC2 — both plugins run offline under the fake publish transport (req: R6) | MET | test | `apps/cli/tests/fanout.test.ts:1162-1209` |
| AC3 — the new channels are listed wherever publish channels are enumerated (req: R1) (req: R2) (req: R3) (req: R4) (req: R5) | MET | test | machine-asserted enumerations: `packages/kk-core/tests/registry.test.ts:238,243,608,613`, `apps/cli/tests/commands/plugin-check.test.ts:179`, `scripts/bundle-plugins.test.ts:35`; prose surfaces (static): `plugins/kk/skills/publish/SKILL.md:31-32`, `docs/03_ARCHITECTURE.md:66-67,434-435,458`, `docs/04_DESIGN.md:25,44` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0245

**Scope:** task 0245 working diff (28 files, +2929 / −80 — this task's own edits are `plugins/kk/skills/publish/SKILL.md`, `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, `docs/design/kk-plugin-check.md`, `docs/design/web-automation-engine.md`, `scripts/bundle-plugins.test.ts`, `apps/cli/tests/fanout.test.ts`; the remainder is the uncommitted 0243/0244 work this batch carries)
**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | correctness | The four E94 fan-out tests spawn real plugin subprocesses, which adds wall-clock pressure to the neighbouring timing tests in the same file. Observed once: `fanout interior concurrency > a hanging publisher is terminated at its budget` failed on the loaded machine (three concurrent agent suites) and passed on both isolated and repeated runs. Not caused by this change, but the file is now more sensitive to a saturated host. | `apps/cli/tests/fanout.test.ts:1419` | ACCEPTED |
| 2 | P4 (advisory) | correctness | The happy-path fan-out fixture sets `metadata.publishStatus: 'public'` because the Weibo home composer has no draft. Under `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake` no public write can happen (the fake transport never reaches the site), which is what makes the shared fixture safe; a real run of this exact fixture would publish live. | `apps/cli/tests/fanout.test.ts:1164` | ACCEPTED |
| 3 | P4 (advisory) | architecture | R1 and R2 have no diff of their own: the registry inventories and the plugin-check `CHANNELS` list landed in 0243/0244 because those suites assert the shipped set exactly. This task's contribution to them is verification plus the remaining enumeration surfaces; a reviewer diffing only 0245 must not read the missing edits as an omission. | `packages/kk-core/tests/registry.test.ts:238-242`, `apps/cli/tests/commands/plugin-check.test.ts:179` | ACCEPTED |
| 4 | P4 (advisory) | usability | The satellite row deliberately reads `implemented; live verification pending 0246 (E94)` rather than `shipped`. Nothing in this task claims a live run, and the wording is the handoff 0246 owns — if 0246's walk does not happen, the row must not be flipped. | `docs/04_DESIGN.md:43` | ACCEPTED |
| 5 | P4 (advisory) | correctness | The channel-table correction (x article / juejin / infoq / substack: `agent` → `script`) is a documentation claim about code this task did not touch. Verified before the edit: each of the four plugins' default driver is `script` (`plugins/publishings/{x,juejin,infoq,substack}-pub/src/index.ts`, `driver: BrowserDriver = 'script'`), matching ADR-027. | `plugins/kk/skills/publish/SKILL.md:27-30` | ACCEPTED |

No P1–P3 findings. Security-relevant negatives: the new tests run only under the fake transport (no credentials, no profile, no network), the fake env is snapshot/restored around each case, and `threads-pub` is deliberately absent from the probe list because it declares no `check` (an API channel has no session to probe).

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/kk-core/tests/registry.test.ts:238` and `:242` (first inventory), `:607` and `:611` (second) — both channels in both lists, asserted exactly; verified here rather than re-edited (0243/0244 landed them) |
| R2 | MET | `apps/cli/tests/commands/plugin-check.test.ts:179` (`weibo-pub` in `CHANNELS`) and `:181` ("seven browser publish channels"); `threads-pub` absent by design |
| R3 | MET | `plugins/kk/skills/publish/SKILL.md:31-32` (new threads/weibo rows), `:27-30` (stale routing corrected to the script-driver entries), `:104-105` (env rows for `THREADS_ACCESS_TOKEN`, `THREADS_USER_ID`, `WEIBO_PROFILE_DIR`) |
| R4 | MET | `docs/03_ARCHITECTURE.md:65-66` (layout), `:433-434` (package table), `:457` (channel list gains `weibo-pub`) |
| R5 | MET | `docs/04_DESIGN.md:24` ("all seven channels"), `docs/04_DESIGN.md:43` (satellite status → implemented / live-pending 0246) |
| R6 | MET | `apps/cli/tests/fanout.test.ts:1162-1255` — four tests over the real plugin entries under the fake env: happy fan-out, per-plugin transport kind, unknown operation, agent driver |
| R7 | MET | `scripts/bundle-plugins.test.ts:35` — `weibo-pub` joins `CHECK_DECLARING_PLUGINS`, so the existing staging test proves the bundled check is rewritten to `./dist/*.js` and exists; `threads-pub` stays out (no declared check). No staged asset is hand-edited. |

##### Acceptance Criteria Verification

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R8 — both plugins refuse an unknown operation or driver by name before any transport | MET | test | `apps/cli/tests/fanout.test.ts:1211-1255` — through `kk fanout` spawning both real plugins: `unsupported operation 'dm'` names each plugin's supported set, and `options.driver: 'agent'` is refused by both |
| R9 — both plugins run offline under the fake publish transport | MET | test | `apps/cli/tests/fanout.test.ts:1162-1180` (aggregate `ok`, `2 succeeded`, one entry per plugin) and `:1182-1209` (each channel resolves its own fake kind) |
| R10 — the new channels are listed wherever publish channels are enumerated | MET | static-ref | `packages/kk-core/tests/registry.test.ts:238,242,607,611`; `apps/cli/tests/commands/plugin-check.test.ts:179`; `plugins/kk/skills/publish/SKILL.md:31-32`; `docs/03_ARCHITECTURE.md:65-66,433-434,457`; `docs/04_DESIGN.md:24,43`; `docs/design/kk-plugin-check.md:3-4,60-61`; `docs/design/web-automation-engine.md:111`; `scripts/bundle-plugins.test.ts:35` |
| AC1 — both plugins refuse an unknown operation or driver by name before any transport (req: R6) | MET | test | `apps/cli/tests/fanout.test.ts:1211-1255` |
| AC2 — both plugins run offline under the fake publish transport (req: R6) | MET | test | `apps/cli/tests/fanout.test.ts:1162-1209` |
| AC3 — the new channels are listed wherever publish channels are enumerated (req: R1) (req: R2) (req: R3) (req: R4) (req: R5) | MET | static-ref | as the R10 row above |

**Next:** 0246 pins the provisional selectors live, records the discovery notes, and owns the final status flip for the satellites and the feature.

### References

- Feature E94; design `docs/design/weibo-threads-publish-channels.md` §4; depends on 0243, 0244

### History

- 2026-10-12T06:43:40.601Z todo → wip (system)
- 2026-10-12T06:57:08.326Z wip → testing (system)
- 2026-10-12T06:57:19.606Z testing → done (system)

