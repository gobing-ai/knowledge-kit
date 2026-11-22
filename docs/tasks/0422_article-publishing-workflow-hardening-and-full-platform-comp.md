---
schema_version: 1
name: Article publishing workflow hardening and full-platform completion
status: todo
template: standard
created_at: 2026-11-22T20:08:44.413Z
updated_at: "2026-11-22T20:20:51.653Z"
feature_id: G61

priority: P1
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 6
---

## 0422. Article publishing workflow hardening and full-platform completion

### Background

During the 2026-11-22 comprehensive review and dogfood test of the consolidated article publishing workflow (`kk article new` → `kk article publish` → `plugins/kk/workflows/kk-publish.yaml`) using `/Users/robin/Downloads/a2ui-intro.md`, 8 defects were found and fixed in the working tree (P0 ADR-022 safety bug where `qiita-pub` and `zenn-pub` defaulted to live publish in draft mode, stale `.kk/publish-presets/itc-main.json` shadow, missing `--from` bundle freezing/variant/cover wiring, silent stale-plan execution on `plan` error, missing `x-pub` `operation: article`, non-news live safety block, computed `targetId` matching, and missing `--allow-dirty` on `publish`).

With those fixes applied, 6/9 `itc-main` platforms (`surfdash-pub`, `infoq-pub`, `juejin-pub`, `x-pub.article`, `qiita-pub`, `substack-pub`) published confirmed drafts for `a2ui-intro`.

This task tracks:
1. Full-gate verification and atomic commit of the 8 dogfood fixes already in the working tree.
2. Implementing the 3 approved enhancements (`weibo-pub` article target in `itc-main`, `medium-pub` browser-transport fallback using the logged-in Medium browser profile, and `kk article generate --adapt-only` for `--from`-seeded single-language articles).
3. Completing the remaining `a2ui-intro` platform publishes (`weibo-pub`, `medium-pub`, plus `wechatmp-pub` / `zenn-pub` once operator login/repo config is in place).

**Refine corrections (2026-11-22)**
- R4 verb surface: proposed `kk article adapt` plain verb → ADR-053 §2–§3 (`docs/00_ADR.md:1944-1952`) closes plain verbs to `new|generate|publish|status` and forbids plain verbs from sequencing steps outside a workflow → replaced with `kk article generate --adapt-only` passing `adapt_only: "true"` to `plugins/kk/workflows/kk-article-generate.yaml` (`executor-probe` → `adapt` → `freeze` → `done`).
- R3 `medium-pub` dependencies & rules: original Design omitted package deps, token-API probe compat, and `rail-transcript-header` → `plugins/publishings/medium-pub/package.json` lacks `@gobing-ai/ts-browser-automation` and `playwright`, `.spur/rules/structure/rail-transcript-header.yaml` requires a `// transcript:` header in `*rail*.ts`/`*flow*.ts`, and `profile-check.ts` must exit 0 immediately when `MEDIUM_INTEGRATION_TOKEN` is set → added all three to Design and Plan.
- Concurrency & estimate: verified `git worktree list` (single `main` worktree) and `spur task list --status wip --json` (empty); set `estimate_hours: 6`.

### Requirements

- [ ] R1. Verify and land the 8 article-publishing dogfood fixes already in the working tree (`apps/cli/src/publish-matrix.ts`, `apps/cli/src/commands/content*.ts`, `plugins/kk/publish-presets/itc-main.json`, removal of `.kk/publish-presets/itc-main.json`, `docs/04_DESIGN.md`) with passing `bun run lint`, `bun run build`, and `bun run test` (≥90% per-file coverage).
- [ ] R2. Add `weibo-pub` (`operation: "article"`, `variant: "zh-article"`, `tier: 2`, `required: false`, `transport: "browser"`) to `plugins/kk/publish-presets/itc-main.json`, update preset tests (`apps/cli/tests/itc-presets.test.ts`, `apps/cli/tests/article-publish-dogfood.test.ts`), and publish a confirmed `a2ui-intro` draft to Weibo 头条文章.
- [ ] R3. Add a `ts-browser-automation` script-driver fallback to `plugins/publishings/medium-pub` (`MediumBrowserTransport`, `src/profile-check.ts`, `plugin.json` `check` + `browserSession`, workspace deps `@gobing-ai/ts-browser-automation` + `playwright`) that activates only when `MEDIUM_INTEGRATION_TOKEN` is unset (preserving `MediumApiTransport` and token-mode `profile-check` exit 0 when the token is set), satisfies `rail-transcript-header`, and publishes a confirmed `a2ui-intro` English draft to Medium.
- [ ] R4. Add `--adapt-only` to `kk article generate` (`apps/cli/src/commands/content-launch.ts`) and `adapt_only: "false"` routing (`executor-probe` → `adapt` → `freeze` → `done`) to `plugins/kk/workflows/kk-article-generate.yaml` so a `--from`-seeded single-language article can auto-generate missing locale variants via `kk:article-adapt` and freeze `4-publish/bundle.json` without outline/draft/judge authoring, documented in `docs/04_DESIGN.md` §1.14.
- [ ] R5. Sync built `apps/cli/dist/index.js` and updated `plugins/kk/{workflows,publish-presets}` to the global `kk` install, verify `bun run tools:fresh`, pass `bun run lint && bun run build && bun run test`, and publish `a2ui-intro` drafts to `weibo-pub.article` and `medium-pub` (plus `wechatmp-pub.文章` / `zenn-pub` if operator login / `ZENN_REPO` is configured).

**Out of Scope / Non-Goals**
- Do not add a new `kk article adapt` or `kk publish` plain verb (ADR-053 §2).
- Do not promote any `a2ui-intro` channel to `--live-channels` without explicit per-channel operator approval (ADR-022).
- Do not automate WeChat QR login (`kk bot login wechatmp`) or fabricate a `ZENN_REPO` configuration.
- Do not add `csdn-pub`, `cnblogs-pub`, or `sspai-pub` to `itc-main.json` in this task.

### Acceptance Criteria

#### Scenario: AC1 — Dogfood fixes pass full quality gate (req: R1)
- **Given** the 8 dogfood fixes in `apps/cli/src/`, `plugins/kk/publish-presets/itc-main.json`, and `docs/04_DESIGN.md`
- **When** `bun run lint`, `bun run build`, and `bun run test` run (including `apps/cli/tests/article-publish-dogfood.test.ts` and `apps/cli/tests/kk-publish.e2e.test.ts`)
- **Then** all checks exit 0 with zero skipped tests and per-file coverage >= 90%

#### Scenario: AC2 — Weibo article target publishes draft via `itc-main` (req: R2)
- **Given** `weibo-pub` (`operation: "article"`, `variant: "zh-article"`, `transport: "browser"`) is declared in `plugins/kk/publish-presets/itc-main.json` and the `weibo` browser profile is authenticated
- **When** `bun test apps/cli/tests/itc-presets.test.ts apps/cli/tests/article-publish-dogfood.test.ts` passes and `kk article publish --slug a2ui-intro --channels weibo-pub.article` runs
- **Then** `.works/kk-article-generate/a2ui-intro/4-publish/receipts/weibo-pub.article.json` records `status: "succeeded"`, `effect: "confirmed"`, `mode: "draft"`

#### Scenario: AC3 — Medium publishes draft via browser rail when token is unset (req: R3)
- **Given** `MEDIUM_INTEGRATION_TOKEN` is unset and `~/.config/kk/browser-profiles/medium` holds a valid session
- **When** `plugins/publishings/medium-pub/tests/` unit/contract tests pass, `bun scripts/check-rail-transcripts.ts` exits 0, and `kk article publish --slug a2ui-intro --channels medium-pub` runs
- **Then** `medium-pub` selects `MediumBrowserTransport`, saves the English `en-article` draft on Medium (`publishStatus: "draft"`), and writes a `succeeded` / `confirmed` receipt with the draft URL; when `MEDIUM_INTEGRATION_TOKEN` IS set, `MediumApiTransport` remains selected and `profile-check.ts check` exits 0 without opening a browser

#### Scenario: AC4 — `kk article generate --adapt-only` translates and freezes a `--from`-seeded article (req: R4)
- **Given** a single-language article created via `kk article new --slug <slug> --from <file.md> --locale zh` without manual `--variant` files
- **When** `kk article generate --slug <slug> --adapt-only --dry-run` and the E2E test in `apps/cli/tests/kk-article.e2e.test.ts` (with stubbed executor) run, plus `spur workflow validate plugins/kk/workflows/kk-article-generate.yaml`
- **Then** the workflow validates cleanly, `--adapt-only` binds `vars.adapt_only = "true"`, transitions `executor-probe` → `adapt` → `freeze` → `done` (skipping outline/draft/judge), and freezes `4-publish/bundle.json` with the adapted variants; passing `--adapt-only` on `news` exits 2

#### Scenario: AC5 — Full `a2ui-intro` publish ledger and installed-package sync (req: R5)
- **Given** all code, preset, workflow, and doc changes are built and synced to `~/.bun/install/global/node_modules/@gobing-ai/knowledge-kit`
- **When** `bun run tools:fresh`, `bun run lint && bun run build && bun run test`, and `kk article status --slug a2ui-intro` run
- **Then** zero checkout-vs-install drift is reported, all tests pass with >= 90% per-file coverage, and every configured/authenticated `itc-main` platform has a confirmed draft receipt for `a2ui-intro`

### Q&A

- **Q1 (R4 surface — closed 2026-11-22):** Should single-language article adaptation be a new `kk article adapt` verb or a flag on `kk article generate`?
  - **Decision:** `kk article generate --adapt-only` (`vars.adapt_only: "true"` in `plugins/kk/workflows/kk-article-generate.yaml`). ADR-053 §2–§3 closes plain verbs to `new|generate|publish|status` and forbids plain verbs from sequencing steps outside a workflow.
- **Q2 (R3 transport precedence — closed 2026-11-22):** How does `medium-pub` choose between token API and browser rail?
  - **Decision:** `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake` → fake transport; else if `MEDIUM_INTEGRATION_TOKEN` is non-empty → `MediumApiTransport` (and `profile-check.ts check` exits 0 without touching the browser); else → `MediumBrowserTransport` using `~/.config/kk/browser-profiles/medium`.
- **Q3 (R5 live vs draft — closed 2026-11-22):** Should `a2ui-intro` publish live or draft?
  - **Decision:** Draft by default (ADR-022). Any `--live-channels` promotion requires explicit per-channel operator approval after reviewing drafts.

### Design

#### Frozen Names, Precedence & Impacted Surfaces

1. **Weibo in `itc-main` (R2)**
   - **Target file:** `plugins/kk/publish-presets/itc-main.json`
   - **Row shape:** `{ "plugin": "weibo-pub", "profile": "article", "operation": "article", "variant": "zh-article", "tier": 2, "required": false, "transport": "browser" }` (target ID resolves to `weibo-pub.article`).
   - **Test updates:** `apps/cli/tests/itc-presets.test.ts` (`ITC_MAIN_TARGETS`), `apps/cli/tests/article-publish-dogfood.test.ts`.

2. **Medium browser fallback (R3)**
   - **Target files:**
     - `plugins/publishings/medium-pub/package.json` — add `@gobing-ai/ts-browser-automation: "catalog:"` and `playwright: "catalog:"` (matching `plugins/publishings/substack-pub/package.json`).
     - `plugins/publishings/medium-pub/plugin.json` — add `"check": "./src/profile-check.ts"` and `"browserSession": { "profileName": "medium", "homeUrl": "https://medium.com/new-story" }`.
     - `plugins/publishings/medium-pub/src/browser-rail.ts` (or `src/flow.ts`) — carries `// transcript: <path>` or `// transcript: none — <reason>` within lines 1–20 (`rail-transcript-header` rule), exports `MediumBrowserTransport`, `CHANNEL = 'medium'`, `HOME_URL = 'https://medium.com/new-story'`, `DRAFT_URL_RE = /\/p\/([a-f0-9]+)\/edit/i`, `isAuthenticated`, `channelConfig()`.
     - `plugins/publishings/medium-pub/src/profile-check.ts` — CLI `login|check|open`; on `check`, if `process.env.MEDIUM_INTEGRATION_TOKEN?.trim()` is non-empty, prints `{ status: 'verified', detail: 'MEDIUM_INTEGRATION_TOKEN configured' }` and exits 0 without launching a browser; otherwise runs `runProfileCli` against `~/.config/kk/browser-profiles/medium`.
     - `plugins/publishings/medium-pub/src/index.ts` — `getPublishTransport()` precedence: `KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake'` → `FakeFileCliTransport` → `MEDIUM_INTEGRATION_TOKEN` non-empty → `MediumApiTransport` → `MediumBrowserTransport`.
   - **Selector discipline:** Measure live Medium `/new-story` DOM (`title`, `body`, autosave draft URL rewrite, `Publish` control) via the authenticated `medium` browser profile before writing selectors. Draft mode (`publishStatus: 'draft'`, default) NEVER clicks Publish; observed `/p/<id>/edit` URL rewrite + title/body presence is the confirmed draft receipt.

3. **`kk article generate --adapt-only` (R4)**
   - **Target files:**
     - `plugins/kk/workflows/kk-article-generate.yaml` — declare var `adapt_only: "false"`; replace the unconditional `executor-probe → outline-write` edge with two mutually exclusive guarded edges: `test "${vars.adapt_only}" = "true"` → `adapt` and `test "${vars.adapt_only}" != "true"` → `outline-write`.
     - `apps/cli/src/commands/content-launch.ts` — add `.option('--adapt-only', 'skip authoring and run adapt + freeze over an existing draft (article only)')` on `generate`; reject on `type !== 'itc'` (exit 2, matching `--auto`); verify `3-draft-draft-article.md` exists (exit 5 if missing); pass `vars.adapt_only = 'true'`.
     - `docs/04_DESIGN.md` §1.14 — document `[--adapt-only]` on `kk article generate`.

#### Anti-Patterns (Do NOT Implement)
- Do NOT add a `kk article adapt` plain verb or sequence workflow stages in TypeScript (violates ADR-053 §2–§3).
- Do NOT guess Medium DOM selectors without probing the live authenticated `/new-story` page or omit the `// transcript:` header (fails `rail-transcript-header`).
- Do NOT break token-API `medium-pub` users: `profile-check.ts check` must exit 0 when `MEDIUM_INTEGRATION_TOKEN` is set even with no browser profile.
- Do NOT bypass `bun run test` 90% per-file coverage threshold or skip syncing `dist/index.js` + `plugins/kk/{workflows,publish-presets}` to the global `kk` package.

### Plan

1. [ ] **R1 — Full-gate verify & commit dogfood fixes:** Run `bun run lint && bun run build && bun run test` on the current working tree; fix any coverage/test gap; commit the 8 dogfood fixes as an atomic conventional commit.
2. [ ] **R2 — Add `weibo-pub` to `itc-main`:** Update `plugins/kk/publish-presets/itc-main.json`, `apps/cli/tests/itc-presets.test.ts`, and `apps/cli/tests/article-publish-dogfood.test.ts`; sync preset to installed `kk`; run `kk article publish --slug a2ui-intro --channels weibo-pub.article --allow-dirty` and verify confirmed draft receipt.
3. [ ] **R3 — Implement `medium-pub` browser fallback:** Add workspace deps (`@gobing-ai/ts-browser-automation`, `playwright`) to `plugins/publishings/medium-pub/package.json` and run `bun install`; probe live Medium `/new-story` selectors against `~/.config/kk/browser-profiles/medium`; write `src/browser-rail.ts` (with `// transcript:` header), `src/profile-check.ts`, `src/index.ts` fallback, `plugin.json` updates, and unit tests covering both token-API and browser-rail paths + error/refusal paths (≥90% per-file coverage); verify `bun scripts/check-rail-transcripts.ts`; dogfood `kk article publish --slug a2ui-intro --channels medium-pub --allow-dirty`.
4. [ ] **R4 — Implement `kk article generate --adapt-only`:** Update `plugins/kk/workflows/kk-article-generate.yaml`, `apps/cli/src/commands/content-launch.ts`, and `docs/04_DESIGN.md`; validate with `spur workflow validate plugins/kk/workflows/kk-article-generate.yaml`; add E2E tests in `apps/cli/tests/kk-article.e2e.test.ts` (stubbed executor + `--adapt-only` refusal on `news` and missing draft).
5. [ ] **R5 — Sync, full gate, & remaining platforms:** Run `bun run format && bun run lint && bun run build && bun run test`; sync `apps/cli/dist/index.js`, `plugins/kk/publish-presets/itc-main.json`, and `plugins/kk/workflows/kk-article-generate.yaml` to `~/.bun/install/global/node_modules/@gobing-ai/knowledge-kit`; verify `bun run tools:fresh`; run any operator-enabled remaining channels (`wechatmp-pub.文章`, `zenn-pub`) for `a2ui-intro`; record Solution/Testing/Review in task `0422`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: `G61` (`docs/design/content-pipeline-consolidation.md`), ADR-053 (`docs/00_ADR.md:1933-2010`), ADR-022
- Rules: `.spur/rules/structure/rail-transcript-header.yaml` (`scripts/check-rail-transcripts.ts`)
- Workflows: `plugins/kk/workflows/kk-publish.yaml`, `plugins/kk/workflows/kk-article-generate.yaml`
- Preset: `plugins/kk/publish-presets/itc-main.json`
- CLI surfaces: `apps/cli/src/commands/content.ts`, `apps/cli/src/commands/content-launch.ts`, `apps/cli/src/commands/content-publish.ts`, `apps/cli/src/commands/content-generate-article.ts`, `apps/cli/src/publish-matrix.ts`
- Plugins: `plugins/publishings/medium-pub/`, `plugins/publishings/weibo-pub/`, `plugins/publishings/substack-pub/package.json` (browser dep reference)
- Design doc: `docs/04_DESIGN.md` §1.14
- Dogfood workspace: `.works/kk-article-generate/a2ui-intro` (source `/Users/robin/Downloads/a2ui-intro.md`)
- Concurrency audit (2026-11-22): 1 worktree (`main` at `ee8b78e3`), 0 `wip` tasks.

### History

- 2026-11-22T20:09:59.037Z backlog → todo (system)

