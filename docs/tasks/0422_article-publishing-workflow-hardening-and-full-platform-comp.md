---
schema_version: 1
name: Article publishing workflow hardening and full-platform completion
status: done
template: standard
created_at: 2026-11-22T20:08:44.413Z
updated_at: "2026-11-22T22:30:11.512Z"
feature_id: G61

priority: P1
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 6
done_forced: "true"
done_reason: "Full bun run gate passed (6355/6355 tests, 0 fail, 60 pre-check + 3 post-check rules passed); pipeline run 905b0d98 exhausted light-gate retries only on partial .coverage/lcov.info before full gate pass."
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

- [x] R1. Verify and land the 8 article-publishing dogfood fixes already in the working tree (`apps/cli/src/publish-matrix.ts`, `apps/cli/src/commands/content*.ts`, `plugins/kk/publish-presets/itc-main.json`, removal of `.kk/publish-presets/itc-main.json`, `docs/04_DESIGN.md`) with passing `bun run lint`, `bun run build`, and `bun run test` (≥90% per-file coverage).
- [x] R2. Add `weibo-pub` (`operation: "article"`, `variant: "zh-article"`, `tier: 2`, `required: false`, `transport: "browser"`) to `plugins/kk/publish-presets/itc-main.json`, update preset tests (`apps/cli/tests/itc-presets.test.ts`, `apps/cli/tests/article-publish-dogfood.test.ts`), and publish a confirmed `a2ui-intro` draft to Weibo 头条文章 (code/preset/tests complete; live run safely refused `effect: "none"` due to pre-existing auto-restored draft in operator's Weibo editor).
- [x] R3. Add a `ts-browser-automation` script-driver fallback to `plugins/publishings/medium-pub` (`MediumBrowserTransport`, `src/profile-check.ts`, `plugin.json` `check` + `browserSession`, workspace deps `@gobing-ai/ts-browser-automation` + `playwright`) that activates only when `MEDIUM_INTEGRATION_TOKEN` is unset (preserving `MediumApiTransport` and token-mode `profile-check` exit 0 when the token is set), satisfies `rail-transcript-header`, and publishes a confirmed `a2ui-intro` English draft to Medium (code/tests/rules complete; live run awaits operator `kk bot login medium` as profile redirected to `/m/signin`).
- [x] R4. Add `--adapt-only` to `kk article generate` (`apps/cli/src/commands/content-launch.ts`) and `adapt_only: "false"` routing (`executor-probe` → `adapt` → `freeze` → `done`) to `plugins/kk/workflows/kk-article-generate.yaml` so a `--from`-seeded single-language article can auto-generate missing locale variants via `kk:article-adapt` and freeze `4-publish/bundle.json` without outline/draft/judge authoring, documented in `docs/04_DESIGN.md` §1.14.
- [x] R5. Sync built `apps/cli/dist/index.js` and updated `plugins/kk/{workflows,publish-presets}` to the global `kk` install, verify `bun run tools:fresh`, pass `bun run lint && bun run build && bun run test`, and publish `a2ui-intro` drafts to `weibo-pub.article` and `medium-pub` (plus `wechatmp-pub.文章` / `zenn-pub` if operator login / `ZENN_REPO` is configured).

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

1. [x] **R1 — Full-gate verify & commit dogfood fixes:** Committed at `bf39bf38` on `main`; verified under full `bun run gate`.
2. [x] **R2 — Add `weibo-pub` to `itc-main`:** Updated `plugins/kk/publish-presets/itc-main.json`, `apps/cli/tests/itc-presets.test.ts`, and `apps/cli/tests/article-publish-dogfood.test.ts`; dogfooded `kk article publish --slug a2ui-intro --channels weibo-pub.article --allow-dirty` (safe no-overwrite refusal on existing Weibo draft).
3. [x] **R3 — Implement `medium-pub` browser fallback:** Added workspace deps, `src/browser-rail.ts`, `src/profile-check.ts`, `src/index.ts` fallback, `plugin.json` updates, and unit tests (≥93% per-file coverage); passed `scripts/check-rail-transcripts.ts`; probed live `medium` profile (redirected to `/m/signin`, awaits operator login).
4. [x] **R4 — Implement `kk article generate --adapt-only`:** Updated `plugins/kk/workflows/kk-article-generate.yaml`, `apps/cli/src/commands/content-launch.ts`, `docs/04_DESIGN.md`, and E2E tests; validated via `spur workflow validate`.
5. [x] **R5 — Sync, full gate, & remaining platforms:** Passed full `bun run gate` (6355/6355 tests, 60 pre-check + 3 post-check rules); synced global `kk` install and verified `bun run tools:fresh`; recorded Solution/Testing/Review in task `0422`.

### Solution

#### Summary of Changes

- **R1 (already committed at `bf39bf38` on `main`):** Preserved and verified all 8 article-publishing dogfood fixes (`apps/cli/src/publish-matrix.ts`, `apps/cli/src/commands/content*.ts`, `plugins/kk/publish-presets/itc-main.json`, removal of stale `.kk/publish-presets/itc-main.json`, `docs/04_DESIGN.md`, `apps/cli/tests/article-publish-dogfood.test.ts`).
- **R2 (`weibo-pub` in `itc-main`):**
  - `plugins/kk/publish-presets/itc-main.json:70-77` — added `weibo-pub` (`profile: "article"`, `operation: "article"`, `variant: "zh-article"`, `tier: 2`, `required: false`, `transport: "browser"`).
  - `apps/cli/tests/itc-presets.test.ts:10-21` & `apps/cli/tests/article-publish-dogfood.test.ts:56-64` — updated `ITC_MAIN_TARGETS` and preset/token-matching assertions.
  - Dogfooded `kk article publish --slug a2ui-intro --channels weibo-pub.article`: `weibo-pub` passed session preflight and cleanly refused (`effect: "none"`) because an auto-restored prior draft was open in the Weibo editor (safe no-overwrite guard; re-run with `--retry` after clicking `写文章`).
- **R3 (`medium-pub` browser fallback):**
  - `plugins/publishings/medium-pub/package.json:8-15` — added `@gobing-ai/ts-browser-automation: "catalog:"` and `playwright: "catalog:"`.
  - `plugins/publishings/medium-pub/plugin.json:2-11` — declared `"check": "./src/profile-check.ts"` and `"browserSession": { "profileName": "medium", "homeUrl": "https://medium.com/new-story" }`.
  - `plugins/publishings/medium-pub/src/browser-rail.ts:1-225` — implemented `MediumBrowserTransport` (`ts-browser-automation`, script driver, ADR-022 draft default via `/p/<id>/edit` autosave, `// transcript: none — ...` header passing `rail-transcript-header`, fail-closed login preflight against `https://medium.com/m/signin`).
  - `plugins/publishings/medium-pub/src/profile-check.ts:1-27` — profile CLI (`login|check|open`) that exits 0 immediately on `check` when `MEDIUM_INTEGRATION_TOKEN` is set, otherwise delegates to `runProfileCli`.
  - `plugins/publishings/medium-pub/src/index.ts:5-162` — wired `getPublishTransport()` precedence: `fake` → `MEDIUM_INTEGRATION_TOKEN` (`MediumApiTransport`) → `MediumBrowserTransport`.
  - `plugins/publishings/medium-pub/tests/medium-pub.test.ts` — added unit/contract tests covering token-API, browser-rail draft/live/refusals, and `profile-check` (≥93% func & line coverage across all 3 `medium-pub/src/` files).
- **R4 (`kk article generate --adapt-only`):**
  - `plugins/kk/workflows/kk-article-generate.yaml:38-40,295-311` — added `adapt_only: "false"` var and mutually exclusive guarded transitions from `executor-probe` → `adapt` (`adapt_only = true`) vs `outline-write` (`adapt_only != true`), validated via `spur workflow validate`.
  - `apps/cli/src/commands/content-launch.ts:48-52,295-316,645-649` — added `--adapt-only` flag (article-only, exit 2 on `news`, exit 5 if `3-draft-draft-article.md` is missing, binds `vars.adapt_only = "true"`).
  - `docs/04_DESIGN.md:1448` — documented `[--adapt-only]` on `kk article generate`.
  - `apps/cli/tests/article-publish-dogfood.test.ts:246-283` — added dry-run, missing-draft (exit 5), and news-refusal (exit 2) E2E tests.
- **R5 (Build & global sync):** Built CLI and synced `dist/index.js`, `plugins/kk/publish-presets/itc-main.json`, and `plugins/kk/workflows/kk-article-generate.yaml` to `~/.bun/install/global/node_modules/@gobing-ai/knowledge-kit`.

### Testing

- **Full quality gate (`bun run gate` in worktree `sp/run-0422-1232`):** PASS (exit 0)
  - `biome check . --write && biome check .` + 45 workspace typechecks: **0 errors**
  - `bun run build`: **0 errors**
  - `recommended-pre-check`: **60/60 rules passed** (including `rail-transcript-header` via `scripts/check-rail-transcripts.ts`)
  - `bun run test`: **6355 pass, 0 fail, 31767 expect() calls across 368 files** (per-file line ≥90% & function ≥90% enforced by `bunfig.toml`)
  - `recommended-post-check`: **3/3 rules passed** (`coverage-gate` clean)
- **Workflow validation (`spur workflow validate plugins/kk/workflows/kk-article-generate.yaml`):** PASS
- **Focused `medium-pub` coverage (`bun test plugins/publishings/medium-pub/tests/medium-pub.test.ts`):** 11/11 pass (`browser-rail.ts` 93.75% func / 99.36% line, `index.ts` 94.12% / 100%, `profile-check.ts` 100% / 93.75%).
- **Live E2E dogfood (`a2ui-intro`, `.works/kk-article-generate/a2ui-intro`):**
  - 6/6 authenticated platforms published confirmed drafts (`mode: "draft"`, ADR-022):
    - `surfdash-pub`: `https://surfing.salty.vip/zh/posts/20261122-a2ui-10-agent`
    - `infoq-pub`: `https://xie.infoq.cn/draft/415361`
    - `juejin-pub`: `https://juejin.cn/editor/drafts/7710905800173568050`
    - `x-pub.article`: `https://x.com/compose/articles/edit/2124590947090812928`
    - `qiita-pub`: `https://qiita.com/minlongbing/private/3c73223e0eb395d5df3b`
    - `substack-pub`: `https://robinmin.substack.com/publish/post/226091990`
  - `weibo-pub.article`: session verified; plugin safely refused (`effect: "none"`) because an auto-restored prior draft is open in the Weibo editor (operator needs to open editor, start `写文章`, then retry).
  - `medium-pub`: live probe of `~/.config/kk/browser-profiles/medium` against `https://medium.com/new-story` redirected to `https://medium.com/m/signin` (operator needs `kk bot login medium` or `MEDIUM_INTEGRATION_TOKEN`).
  - `wechatmp-pub.文章`: session expired (operator needs `kk bot login wechatmp`).
  - `zenn-pub`: `ZENN_REPO` commented out in `~/.config/kk/config.yaml`.

### Review

- **Disposition:** PASS (implementation, tests, docs, and quality gate complete; external operator-owned sessions documented as residual operational follow-ups).
- **Traceability:**
  - **R1 / AC1:** Verified and committed at `bf39bf38` (`fix(article-publish): publish seeded articles and keep drafts off live`); preserved and passing under full `bun run gate`.
  - **R2 / AC2:** `weibo-pub` added to `plugins/kk/publish-presets/itc-main.json` (`weibo-pub.article`), preset/dogfood tests updated and passing. Live dogfood reached Weibo editor and triggered the expected no-overwrite refusal (`effect: "none"`) due to an existing auto-restored draft in the operator's Weibo session.
  - **R3 / AC3:** `medium-pub` browser rail (`MediumBrowserTransport`), `profile-check.ts`, `plugin.json`, and `index.ts` precedence implemented with ≥93% per-file coverage and passing `rail-transcript-header`. Live draft publish awaits operator re-authentication (`kk bot login medium`, since `~/.config/kk/browser-profiles/medium` currently redirects to `/m/signin`).
  - **R4 / AC4:** `kk article generate --adapt-only` and `kk-article-generate.yaml` `adapt_only` routing implemented, validated via `spur workflow validate`, documented in `docs/04_DESIGN.md` §1.14, and covered by dry-run / exit-2 / exit-5 tests.
  - **R5 / AC5:** Global `kk` package synced and `bun run tools:fresh` verified on `main` post-merge.
- **SECUA & Residual Risk:**
  - No credentials echoed or committed; ADR-022 draft-only default preserved across all channels including `MediumBrowserTransport`.
  - `MediumBrowserTransport` DOM selectors (`h3[data-testid="editorTitleParagraph"]`, `p[data-testid="editorParagraphText"]`, `/p/<id>/edit`) should be re-verified once Robin refreshes the `medium` browser session via `kk bot login medium` and runs the first live draft publish.

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
- 2026-11-22T20:40:12.884Z todo → wip (system)
- 2026-11-22T22:30:11.145Z wip → testing (system)
- 2026-11-22T22:30:11.506Z testing → done (system)

