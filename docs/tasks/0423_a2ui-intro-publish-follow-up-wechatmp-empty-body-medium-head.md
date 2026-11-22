---
schema_version: 1
name: "a2ui-intro publish follow-up: wechatmp empty body, medium headed rail, lease release, honest run status"
status: backlog
template: standard
created_at: 2026-11-22T23:54:40.428Z
updated_at: "2026-11-22T23:54:46.212Z"
feature_id: G61

---

## 0423. a2ui-intro publish follow-up: wechatmp empty body, medium headed rail, lease release, honest run status

### Background

Follow-up to task `0422` (committed `5c91399c` + `f1813dfd` on `main`). The `a2ui-intro` dogfood article (`/Users/robin/Downloads/a2ui-intro.md`, workspace `.works/kk-article-generate/a2ui-intro`) has confirmed drafts on 6 channels (`surfdash-pub`, `infoq-pub`, `juejin-pub`, `x-pub.article`, `qiita-pub`, `substack-pub`). The operator then ran `kk bot login … --save medium|wechatmp`, `kk bot open weibo` (Ctrl-C), and two `kk article publish --slug a2ui-intro --channels … --retry` runs. Observed on 2026-11-22:

**1. `wechatmp-pub.文章` — false "succeeded" receipt; saved draft has only the cover image**
- Receipt `4-publish/receipts/wechatmp-pub.文章.json`: `status: succeeded`, `effect: confirmed`, `mode: draft`.
- Read-back of saved draft `appmsgid=100001591` (headless, operator profile): title mirror = `A2UI 1.0：让 agent 用界面来回答` (OK); body `div.ProseMirror` **textLen 0**, 2 `<img>` (one `mmbiz.qpic.cn` upload = `cover.jpg`, one empty src), 0 `<pre>`; cover preview `background-image: none`.
- The console itself flagged it: `draftSignal` = `草稿箱:更新于 14:51 图文内容不完整 请补充封面图、标题或者正文` — yet `saveDraft` (`plugins/publishings/wechatmp-pub/src/flow.ts:1773-1850`) accepts any fresh `更新于` stamp as success.
- Warning in `4-publish/fanout-result.wechatmp-pub.文章.json`: `cover: 从正文选择 was not offered by the open cover panel` while a `内容结构检测` dialog (pre tag overflow at paragraphs 7 and 41) was still open.
- Root-cause hypotheses (verify before fixing):
  - (a) `insertBody` (`flow.ts:695-723`) returns as soon as the shared `pasteHtml` (`packages/publish-harness/src/browser.ts:780-797`) resolves. `pasteHtml` checks `editorTextScript(selector)` length > 0, and `flow.ts:725-731` already documents that the ProseMirror placeholder widget (`从这里开始写正文`) makes a plain text read report a filled editor → paste on `appmsg_edit_v2` never lands but is reported as success, so the `insertHTML`/`insertText` fallback never runs. Fix: after `pasteHtml`, require `bodyLength(page, selector) > 0` (placeholder-aware) before returning; otherwise fall through.
  - (b) `attachImages` (`flow.ts:645-648`) runs after the body and puts `input.images` (here `artifactPaths` = `4-illustrations/cover.jpg`) into the body, so the cover becomes the only body content when (a) fires.
  - (c) `markdownToWechatHtml` (`flow.ts:2691+`) emits bare `<pre><code>`, which triggers the `内容结构检测` overflow modal; `closeOpenDialogs` (`flow.ts:207-224`, selectors `flow.ts:190-196`) does not close it, so the cover panel is blocked.
  - (d) `saveDraft` must treat `图文内容不完整` in the stamp/row text as failure (`ok: false`, effect `unknown`) instead of success.

**2. `weibo-pub.article` — retry refused, but `kk article publish` reported `status: done`, `exitCode: 0`**
- Receipt `4-publish/receipts/weibo-pub.article.json` (attempt `retry-1`, run `kk-publish-a2ui-intro-1795390250991`): `status: failed`, `effect: none`, `browser lease ~/.config/kk/browser-leases/b1a915e5…/owner.json is held by pid 58982`.
- pid 58982 is dead (it was the Ctrl-C'd `kk bot open weibo`, lease created `2026-11-22T22:48:52Z`). `packages/publish-harness/src/profile-lease.ts:248` says stale ownership is never auto-removed (by design), so the operator has to remove the lease by hand.
- Defects: (a) `kk bot open` leaves its lease behind on SIGINT, so a normal Ctrl-C blocks every later publish to that profile; (b) the publish run's JSON summary says `status: done`, `exitCode: 0` even though the only selected target failed. A failed-target run should not look like success to the operator or to cron.

**3. `medium-pub` — integration tokens are no longer issued; headless is blocked by Cloudflare**
- Receipt `4-publish/receipts/medium-pub.json`: `status: failed`, `effect: none`, headless readiness refused.
- Probe (headless Chromium, profile `~/.config/kk/browser-profiles/medium`, after `kk bot login https://medium.com/new-story --save medium`): page title `Just a moment...`, body `Performing security verification … Cloudflare`. The session cookies are fine. Headless gets the anti-bot interstitial.
- Medium no longer issues integration tokens (operator, 2026-11-22), so `MediumBrowserTransport` (`plugins/publishings/medium-pub/src/browser-rail.ts`) is now the primary path. It currently uses `checkChannelSession(..., headedFallback: false)` (headless preflight) and `withProfilePage(..., headless: payload.options?.headless === true)`.
- Fix direction: copy the existing headed-only channels (`juejin-pub/src/index.ts:95,252`, `x-pub/src/post-rail.ts:84,155`, `infoq-pub/src/index.ts:141,286`): `checkHeadedOnly: true` in `channelConfig()` and `headedOnly: true` in the publish preflight, so a visible browser drives the editor. If a Cloudflare challenge still shows up in the headed window, the rail must fail closed (`effect: none`) and tell the operator to complete it in the window. The rail must never try to solve or bypass the challenge.
- Editor selectors (`SELECTORS.title/body`, `DRAFT_URL_RE`) and the `// transcript: none — …` header are provisional. Measure them on the live headed `/new-story` page (or record with `kk bot record medium` + `kk bot codegen`) and update the header.

**4. `zenn-pub`** — only a dummy receipt exists (`dummy://zenn-pub`). `ZENN_REPO` is commented out in `~/.config/kk/config.yaml`. This is operator config and must not be fabricated.

**5. Operator question: what "promote reviewed drafts live" means** — `kk article publish --slug <slug> --live-channels <ids>` re-plans the named rows with `mode: live` (`apps/cli/src/publish-matrix.ts:684-697`), so those channels actually publish publicly (Qiita `private:false`, Zenn `published:true`, WeChat 发表, etc.) instead of saving drafts. It is the ADR-022 explicit per-channel consent step. It should only be run after reviewing each draft, and channels not listed stay draft or disabled.

### Requirements

- [ ] R1. `wechatmp-pub` 文章 body insertion is verified, not assumed: `insertBody` (`plugins/publishings/wechatmp-pub/src/flow.ts`) only accepts the `pasteHtml` path when the placeholder-aware `bodyLength` is > 0, and otherwise falls through to `insertHTML` → `insertText`. A saved draft keeps the full article text (headings, paragraphs, code blocks, links).
- [ ] R2. `wechatmp-pub` draft confirmation fails closed on incomplete drafts: `saveDraft` returns `ok: false` (effect `unknown`) when the 草稿箱 row or stamp reports `图文内容不完整` (or the editor body reads empty before save), so a title-only or cover-only draft can never produce a `succeeded`/`confirmed` receipt.
- [ ] R3. `wechatmp-pub` code blocks stop triggering the `内容结构检测` overflow modal: `markdownToWechatHtml` emits `<pre>` with horizontal scrolling enabled (for example inline `overflow-x:auto` plus a pre-wrap-safe style accepted by the MP editor). `closeOpenDialogs` also learns the `内容结构检测` dialog's close/confirm control so the cover panel (`从正文选择`) is reachable. The cover is set from `metadata.coverImage` and does not also land as the only body image.
- [ ] R4. `medium-pub` browser rail runs headed: `channelConfig()` sets `checkHeadedOnly: true`, the publish preflight uses `headedOnly: true`, and `withProfilePage` opens headed by default. A Cloudflare interstitial (`Just a moment...` / `Performing security verification`) is detected and fails closed with `effect: none` and an operator instruction. It is never automated around. Selectors and `DRAFT_URL_RE` are re-measured on the live editor, and the `// transcript:` header names the evidence. The `MEDIUM_INTEGRATION_TOKEN` path stays only as a legacy branch, and docs and the plugin description state that the browser rail is primary.
- [ ] R5. Browser leases survive operator interrupts: `kk bot open` (and `record`/`replay`/`login`) releases its profile lease on SIGINT/SIGTERM. A stale lease whose owner pid is confirmed dead is reported with the exact removal command (or an explicit operator verb), without changing the `profile-lease.ts` "never auto-removed" policy unless an ADR amendment says so.
- [ ] R6. `kk article publish` / `kk-publish` reports target failures honestly: when any selected target ends `failed` (or every selected target is effect `none`), the run summary `status` is not `done`/`exitCode: 0` (for example `partial` with a nonzero exit, per existing CLI exit-code conventions in `docs/04_DESIGN.md`). Existing E2E/fixture tests keep passing or are updated in the same commit, and `docs/04_DESIGN.md` §1.14 is updated.
- [ ] R7. Finish the `a2ui-intro` draft ledger: after R1–R6 are synced to the installed `kk` package, `wechatmp-pub.文章`, `weibo-pub.article`, and `medium-pub` each have a `succeeded`/`confirmed`/`mode: draft` receipt whose saved draft has been read back (title + non-empty body + cover where applicable). `zenn-pub` is published only if the operator configures `ZENN_REPO`. No channel is promoted with `--live-channels` without explicit per-channel operator approval (ADR-022).

**Out of Scope / Non-Goals**
- Solving, clicking through, or bypassing Cloudflare or any CAPTCHA / anti-bot challenge (operator completes it in the visible window, or the rail fails closed).
- Automating WeChat QR login or fabricating `ZENN_REPO`.
- Promoting any channel to live without explicit operator approval.
- Auto-removing stale browser leases without an ADR amendment.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

1. [ ] **Unblock Weibo now (operator, 1 min):** confirm pid 58982 is dead (`ps -p 58982`), then `rm -rf ~/.config/kk/browser-leases/b1a915e5a970f3965283f91330592c6fd971c1cc4b8ea80f6533dd8b007553ea` and `kk article publish --slug a2ui-intro --channels weibo-pub.article --retry`. If it refuses because an auto-restored draft is open, open the editor (`kk bot open weibo`), start a blank `写文章`, close the browser **normally** (not Ctrl-C), then retry.
2. [ ] **R1–R3 wechatmp (write failing tests first):** add unit tests in `plugins/publishings/wechatmp-pub/tests/` for (a) `insertBody` falling through when `pasteHtml` resolves but `bodyLength` is 0, (b) `saveDraft` rejecting a `图文内容不完整` stamp, (c) `markdownToWechatHtml` `<pre>` carrying overflow styling. Then fix `flow.ts`, keep ≥90% per-file coverage, and probe the `内容结构检测` dialog close control on the live editor (headed `kk bot open wechatmp`).
3. [ ] **Read-back helper:** add or reuse a small read-back (as in the 2026-11-22 probe: open `appmsg_edit&action=edit&appmsgid=<id>`, read `textarea#title`, the body `div.ProseMirror:not([data-placeholder])` text length, `<img>`/`<pre>` counts, and the cover preview) as evidence for R7.
4. [ ] **R4 medium headed rail:** flip `channelConfig()`/preflight/`withProfilePage` to headed, add Cloudflare-interstitial detection → fail closed, re-measure selectors on the live headed editor, update `browser-rail.ts` header, `plugin.json` description, and tests in `plugins/publishings/medium-pub/tests/medium-pub.test.ts`.
5. [ ] **R5 lease release:** trace `kk bot open` (`apps/cli/src/commands/bot*.ts` → `packages/publish-harness/src/profile-lease.ts`) and make sure SIGINT/SIGTERM release the lease. Improve the stale-lease refusal message with the exact removal command. Add tests.
6. [ ] **R6 honest run status:** trace how `kk-publish.yaml` + `apps/cli/src/commands/content-publish.ts` / `content-launch.ts` derive the final `status`/`exitCode` (the run that ended `done`/0 with the only target failed: `kk-publish-a2ui-intro-1795390250991`). Make failed targets surface as partial/nonzero, update `docs/04_DESIGN.md` §1.14 in the same commit, and update the affected E2E tests (`apps/cli/tests/kk-publish.e2e.test.ts`, `article-publish-dogfood.test.ts`).
7. [ ] **Gate + sync:** `bun run gate` (exit 0). Then sync to the installed package: `cp apps/cli/dist/index.js` and `rsync -a plugins/publishings/` + `plugins/kk/` into `~/.bun/install/global/node_modules/@gobing-ai/knowledge-kit/`, and run `bun run tools:fresh` (see AGENTS.md "Editing plugins/kk/scripts" and "Editing apps/cli").
8. [ ] **R7 live drafts:** `kk article publish --slug a2ui-intro --channels wechatmp-pub.文章,weibo-pub.article,medium-pub --retry` (headed Medium window: operator completes any Cloudflare check by hand). Read back each saved draft, record receipts + read-back evidence in Testing, and close the task through `spur task update`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
