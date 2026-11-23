---
schema_version: 1
name: "a2ui-intro publish follow-up: wechatmp empty body, medium headed rail, lease release, honest run status"
status: wip
template: standard
created_at: 2026-11-22T23:54:40.428Z
updated_at: "2026-11-23T05:22:23.090Z"
feature_id: G61

priority: P1
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 6
---

## 0423. a2ui-intro publish follow-up: wechatmp empty body, medium headed rail, lease release, honest run status

### Background

Follow-up to task `0422` (committed `5c91399c` + `f1813dfd` on `main`). The `a2ui-intro` dogfood article (`/Users/robin/Downloads/a2ui-intro.md`, workspace `.works/kk-article-generate/a2ui-intro`) has confirmed drafts on 6 channels (`surfdash-pub`, `infoq-pub`, `juejin-pub`, `x-pub.article`, `qiita-pub`, `substack-pub`). The operator then ran `kk bot login … --save medium|wechatmp`, `kk bot open weibo` (Ctrl-C), and two `kk article publish --slug a2ui-intro --channels … --retry` runs. Observed on 2026-11-22:

**1. `wechatmp-pub.文章` — false "succeeded" receipt; saved draft has only the cover image**
- Receipt `4-publish/receipts/wechatmp-pub.文章.json`: `status: succeeded`, `effect: confirmed`, `mode: draft`.
- Read-back of saved draft `appmsgid=100001591` (headless, operator profile): title mirror = `A2UI 1.0：让 agent 用界面来回答` (OK); body `div.ProseMirror` **textLen 0**, 2 `<img>` (one `mmbiz.qpic.cn` upload = `cover.jpg`, one empty src), 0 `<pre>`; cover preview `background-image: none`.
- The console itself flagged it: `draftSignal` = `草稿箱:更新于 14:51 图文内容不完整 请补充封面图、标题或者正文` — yet `saveDraft` (`plugins/publishings/wechatmp-pub/src/flow.ts:1773-1850`) accepts any fresh `更新于` stamp as success.
- Warning in `4-publish/fanout-result.wechatmp-pub.文章.json`: `cover: 从正文选择 was not offered by the open cover panel` while a `内容结构检测` dialog (pre tag overflow at paragraphs 7 and 41) was still open.

**2. `weibo-pub.article` — retry refused, but `kk article publish` reported `status: done`, `exitCode: 0`**
- Receipt `4-publish/receipts/weibo-pub.article.json` (attempt `retry-1`, run `kk-publish-a2ui-intro-1795390250991`): `status: failed`, `effect: none`, `browser lease ~/.config/kk/browser-leases/b1a915e5…/owner.json is held by pid 58982`.
- pid 58982 is dead (it was the Ctrl-C'd `kk bot open weibo`, lease created `2026-11-22T22:48:52Z`). `packages/publish-harness/src/profile-lease.ts:248` says stale ownership is never auto-removed (by design), so the operator has to remove the lease by hand.
- Defects: (a) `kk bot open` leaves its lease behind on SIGINT, so a normal Ctrl-C blocks every later publish to that profile; (b) the publish run's JSON summary says `status: done`, `exitCode: 0` even though the only selected target failed.

**3. `medium-pub` — integration tokens are no longer issued; headless is blocked by Cloudflare**
- Receipt `4-publish/receipts/medium-pub.json`: `status: failed`, `effect: none`, headless readiness refused.
- Probe (headless Chromium, profile `~/.config/kk/browser-profiles/medium`, after `kk bot login https://medium.com/new-story --save medium`): page title `Just a moment...`, body `Performing security verification … Cloudflare`. The session cookies are fine. Headless gets the anti-bot interstitial.
- Medium no longer issues integration tokens (operator, 2026-11-22), so `MediumBrowserTransport` (`plugins/publishings/medium-pub/src/browser-rail.ts`) is now the primary path.

**4. `zenn-pub`** — only a dummy receipt exists (`dummy://zenn-pub`). `ZENN_REPO` is commented out in `~/.config/kk/config.yaml`. This is operator config and must not be fabricated.

**5. Operator question: what "promote reviewed drafts live" means** — `kk article publish --slug <slug> --live-channels <ids>` re-plans the named rows with `mode: live` (`apps/cli/src/publish-matrix.ts:684-697`), so those channels actually publish publicly (Qiita `private:false`, Zenn `published:true`, WeChat 发表, etc.) instead of saving drafts. It is the ADR-022 explicit per-channel consent step.

**Refine corrections (2026-11-22)**
- R1 `insertBody` root cause confirmed in code: hypothesis (a) in original Background → verified at `plugins/publishings/wechatmp-pub/src/flow.ts:704-723` and `packages/publish-harness/src/browser.ts:780-797,1741-1746`. `bodyLength` (`flow.ts:732-743`) was added on 2026-11-12 specifically to strip `.editor_content_placeholder` (`从这里开始写正文`), which makes `pasteHtml`'s plain `textContent` read return length 8 > 0 even when `appmsg_edit_v2` ignores the synthetic `ClipboardEvent('paste')`. However, `insertBody` (`flow.ts:705-706`) returned immediately after `await pasteHtml(...)` without checking `(await bodyLength(page, selector)) > 0`, making the `closeOpenDialogs` + `insertHtmlScript` + `insertTextScript` fallback (`flow.ts:713-722`) unreachable whenever `pasteHtml` did not throw.
- R3 CGI-vs-DOM route & `内容结构检测` dialog controls: `content.wechatmp-pub.文章.json` passes `certifyCgiDraft` (`plugins/publishings/wechatmp-pub/src/cgi-draft.ts:95-141`), so `runCgiDraft` (`flow.ts:2514-2559`) only fell back to the DOM flow (`composeArticle`) because `extractWechatCgiSession(deps.entry)` (`cgi-draft.ts:247-260`) missed inline `ticket`/`user_name` on the console home page (`flow.ts:2557`). In the DOM flow, `markdownToWechatHtml` (`flow.ts:2720`) emits bare `<pre><code>` without `overflow-x:auto`, raising the `内容结构检测` dialog whose dismiss buttons (`我知道了` / `关闭` / `确定`) are absent from `DIALOG_CLOSE` (`flow.ts:190-196`) and `DIALOG_DISMISS` (`flow.ts:160-164`).
- R4 `medium-pub` headed preflight: verified at `plugins/publishings/medium-pub/src/browser-rail.ts:59-66,126-148`. `withProfilePage` at line 143 already defaults to headed (`headless: payload.options?.headless === true` → `false`); only `checkChannelSession` at line 126-131 ran headless (`headedFallback: false`). Setting `checkHeadedOnly: true` in `channelConfig()` and `headedOnly: true` in `checkChannelSession` matches `infoq-pub/src/index.ts:141,286`, `juejin-pub/src/index.ts:95,252`, and `x-pub/src/post-rail.ts:84,155`.
- R5 `SIGINT`/`SIGTERM` lease cleanup & dead-pid message: verified at `packages/publish-harness/src/bot-record.ts:364-370,432-488`, `packages/publish-harness/src/browser.ts:505-550,1192-1255,1403-1462`, `packages/publish-harness/src/bot-replay.ts:273-305`, and `packages/publish-harness/src/profile-lease.ts:248,283`. `recordBotSession` already solved Playwright's `SIGINT` `process.exit(130)` race via `parkSigintListenersSince` and signal handlers that await `lease.release()`, whereas `openBot`, `loginBot`, and `replayBot` lacked it; and `profile-lease.ts:283` already defines `isProcessAlive(pid)`, which `busyGuidance` (`profile-lease.ts:248`) can use to append the exact `rm -rf <leaseDir>` recovery command when `owner.pid` is dead.
- R6 target-failure exit semantics narrowed to preserve existing contract test: original R6 proposed failing the run whenever *any* selected target fails → `apps/cli/tests/content-publish.e2e.test.ts:463-483` explicitly requires `publish-report` to exit 0 when an optional (`required: false`) row fails alongside a non-failing window. The bug is specifically that (1) `composePlan` (`apps/cli/src/publish-matrix.ts:789`) leaves `required: false` even when the operator explicitly targeted that channel via `--channels` or `--live-channels`, and (2) `settleAction`/`reportAction` (`apps/cli/src/commands/content-publish.ts:389,474`) exit 0 even when every planned non-dummy row in the window failed (`rows.some(r => !r.dummy) && rows.every(r => r.dummy || r.status !== 'succeeded')`). Promoting `--channels` / `--live-channels`-matched rows to `required: true` in `composePlan` and failing `settleAction`/`reportAction` on total non-dummy window failure fixes R6 while keeping `content-publish.e2e.test.ts:463-483` green.
- Concurrency & estimate: verified `git worktree list` (1 worktree on `main` at `d0be4a37`) and `spur task list --status wip --json` (empty); set `priority: P1`, `estimate_hours: 6`.

### Requirements

- [ ] R1. Verify `wechatmp-pub` 文章 body insertion after `pasteHtml`: in `insertBody` (`plugins/publishings/wechatmp-pub/src/flow.ts:695-723`), only return from the `pasteHtml` branch when placeholder-aware `await bodyLength(page, selector) > 0`; otherwise close any paste-triggered dialog (`closeOpenDialogs`) and fall through to `insertHtmlScript` → `insertTextScript` so a saved draft never loses its article text on `appmsg_edit_v2`.
- [ ] R2. Fail closed on incomplete or empty WeChat MP drafts: in `saveDraft` (`plugins/publishings/wechatmp-pub/src/flow.ts:1773-1850`), refuse (`ok: false`) before clicking `保存为草稿` when `input.operation === '文章'` and `bodyLength(entry.editor, ...)` is 0, and refuse in the 草稿箱 confirmation loop when the observed `readDraftStamp` contains `图文内容不完整`, so an incomplete draft never produces a `succeeded` / `confirmed` receipt.
- [ ] R3. Prevent and dismiss WeChat MP `内容结构检测` `<pre>` overflow modals: update `markdownToWechatHtml` (`plugins/publishings/wechatmp-pub/src/flow.ts:2691-2728`) so fenced code blocks emit `<pre style="overflow-x:auto;max-width:100%;"><code>…</code></pre>`, and extend `DIALOG_CLOSE` / `DIALOG_DISMISS` (`flow.ts:160-196`) with notice-dialog close controls (`button:has-text("我知道了")`, `button:has-text("关闭")`, `.weui-desktop-dialog__wrp button:has-text("确定")`) so `closeOpenDialogs` clears `内容结构检测` before `setCover` opens the cover panel.
- [ ] R4. Run `medium-pub` browser rail headed by default and fail closed on Cloudflare challenges: in `plugins/publishings/medium-pub/src/browser-rail.ts`, set `checkHeadedOnly: true` in `channelConfig()`, pass `headedOnly: true` to `checkChannelSession`, default `withProfilePage` to `headless: payload.options?.headless === true` (headed when omitted), detect Cloudflare challenge pages (`Just a moment...` / `Performing security verification`) with a fail-closed `effect: 'none'` result instructing the operator, re-verify editor selectors on the live headed `/new-story` page, and update the `// transcript:` header and `plugins/publishings/medium-pub/plugin.json` description.
- [ ] R5. Release browser profile leases on `SIGINT`/`SIGTERM` across `kk bot open|login|replay` and improve dead-pid guidance: apply `parkSigintListenersSince` + `SIGINT`/`SIGTERM` cleanup handlers (from `packages/publish-harness/src/bot-record.ts:364-370,432-488`) to `openBot`, `loginBot` (`packages/publish-harness/src/browser.ts:1186-1255,1381-1462`), and `replayBot` (`packages/publish-harness/src/bot-replay.ts:258-305`), killing any spawned adapter child on signal before releasing the lease; in `busyGuidance` (`packages/publish-harness/src/profile-lease.ts:232-249`), when `!isProcessAlive(owner.pid)`, append that `pid <pid>` is no longer running and print the exact `rm -rf <leaseDir>` recovery command (without auto-removing).
- [ ] R6. Surface failed targets honestly in `kk article publish` / `kk-publish`: in `composePlan` (`apps/cli/src/publish-matrix.ts:781-790`), promote `row.required` to `true` for any target explicitly selected via `--channels` or `--live-channels`, and in `settleAction` / `reportAction` (`apps/cli/src/commands/content-publish.ts:389-392,474-481`), also exit 1 when a window has ≥1 planned non-dummy row and 0 succeeded rows (`status === 'none'`), updating `docs/04_DESIGN.md` §1.14 in the same commit while preserving optional-row tolerance in unfiltered partial windows (`apps/cli/tests/content-publish.e2e.test.ts:463-483`).
- [ ] R7. Complete and verify the `a2ui-intro` draft publish ledger: build and sync `apps/cli/dist/index.js` + `plugins/publishings/{wechatmp-pub,medium-pub}` to `~/.bun/install/global/node_modules/@gobing-ai/knowledge-kit`, verify `bun run tools:fresh` and `bun run gate` (exit 0), remove the dead-pid Weibo lease, run `kk article publish --slug a2ui-intro --channels wechatmp-pub.文章,weibo-pub.article,medium-pub --retry`, and verify `succeeded` / `confirmed` draft receipts plus non-empty body read-back for `wechatmp-pub.文章`.

**Out of Scope / Non-Goals**
- Do not solve, click through, wait out, or bypass any Cloudflare / CAPTCHA / anti-bot challenge in code or automation (fail closed with `effect: 'none'` if a challenge is present).
- Do not auto-delete stale browser leases in `acquireProfileLease` (violates task 0276 frozen lease invariant in `packages/publish-harness/src/profile-lease.ts:12-13`).
- Do not promote any `a2ui-intro` channel to `--live-channels` without explicit per-channel operator approval (ADR-022).
- Do not fabricate `ZENN_REPO` in `~/.config/kk/config.yaml`.

### Acceptance Criteria

#### Scenario: AC1 — `wechatmp-pub` `insertBody` falls through when `pasteHtml` leaves only the placeholder widget (req: R1)
- **Given** an `appmsg_edit_v2` ProseMirror body whose `.editor_content_placeholder` widget makes `pasteHtml` resolve without inserting article text (`bodyLength === 0` after `pasteHtml`)
- **When** `insertBody` runs in `plugins/publishings/wechatmp-pub/src/flow.ts` (covered by unit tests in `plugins/publishings/wechatmp-pub/tests/wechatmp-editor-insert.test.ts`)
- **Then** `insertBody` does not return early after `pasteHtml`; it calls `closeOpenDialogs`, executes `insertHtmlScript` (and `insertTextScript` if still 0), and verifies `bodyLength > 0` before returning

#### Scenario: AC2 — `wechatmp-pub` `saveDraft` refuses empty bodies and `图文内容不完整` draft stamps (req: R2)
- **Given** an `文章` compose step whose editor body is empty or whose 草稿箱 row stamp contains `图文内容不完整`
- **When** `saveDraft` runs in `plugins/publishings/wechatmp-pub/src/flow.ts` (covered by unit tests in `plugins/publishings/wechatmp-pub/tests/`)
- **Then** `saveDraft` returns `ok: false` naming the incomplete draft reason instead of returning `ok: true` / `effect: "confirmed"`

#### Scenario: AC3 — `markdownToWechatHtml` adds `<pre>` horizontal scroll and `closeOpenDialogs` clears `内容结构检测` (req: R3)
- **Given** markdown containing fenced code blocks (` ``` `) and an open `内容结构检测` modal dialog with `我知道了` / `关闭` / `确定` controls
- **When** `markdownToWechatHtml` and `closeOpenDialogs` run (covered by unit tests in `plugins/publishings/wechatmp-pub/tests/`)
- **Then** every emitted `<pre>` tag carries `style="overflow-x:auto;max-width:100%;"` and `closeOpenDialogs` clicks the notice dialog's close control so `setCover` is not overlay-blocked

#### Scenario: AC4 — `medium-pub` runs headed preflight/editor flow and fails closed on Cloudflare challenges (req: R4)
- **Given** `MEDIUM_INTEGRATION_TOKEN` is unset and `MediumBrowserTransport` runs against `~/.config/kk/browser-profiles/medium`
- **When** `plugins/publishings/medium-pub/tests/medium-pub.test.ts` and `bun scripts/check-rail-transcripts.ts` run
- **Then** `channelConfig().checkHeadedOnly` is `true`, `checkChannelSession` is called with `headedOnly: true`, `withProfilePage` runs with `headless: false` by default, a Cloudflare interstitial (`Just a moment...` / `Performing security verification`) returns `ok: false` with `effect: "none"`, and `check-rail-transcripts.ts` exits 0

#### Scenario: AC5 — `kk bot open|login|replay` releases profile lease on `SIGINT`/`SIGTERM` and names dead-pid recovery (req: R5)
- **Given** an active `openBot`, `loginBot`, or `replayBot` invocation holding a profile lease, or an existing lease directory whose `owner.pid` is no longer alive
- **When** `SIGINT` or `SIGTERM` is delivered during the session (tested in `packages/publish-harness/tests/`) or `acquireProfileLease` hits a dead-pid lease
- **Then** the signal handler closes the browser / terminates the adapter child and releases the lease directory before exiting (130/143), and `busyGuidance` on a dead `owner.pid` explicitly states that the pid is no longer running and prints `rm -rf <leaseDir>`

#### Scenario: AC6 — Explicitly targeted `--channels` / `--live-channels` failures and all-failed windows exit nonzero (req: R6)
- **Given** a `kk article publish --channels <list>` (or `--live-channels <list>`) run where a selected target fails, or a window where every planned non-dummy row fails (`status === "none"`)
- **When** `publish-plan`, `publish-settle`, and `publish-report` run (tested in `apps/cli/tests/content-publish.e2e.test.ts` and `apps/cli/tests/article-publish-dogfood.test.ts`)
- **Then** `--channels` / `--live-channels`-selected rows are planned with `required: true`, `publish-settle` and `publish-report` exit 1 (`required targets failed`), and `kk article publish` exits nonzero with `status: "failed"`, while an unfiltered window where required tier-0 succeeds and an optional (`required: false`) row fails still exits 0

#### Scenario: AC7 — Full gate, global sync, and `a2ui-intro` draft completion (req: R7)
- **Given** all R1–R6 changes are built and synced to `~/.bun/install/global/node_modules/@gobing-ai/knowledge-kit` and the dead pid-58982 Weibo lease is removed
- **When** `bun run gate`, `bun run tools:fresh`, and `kk article publish --slug a2ui-intro --channels wechatmp-pub.文章,weibo-pub.article,medium-pub --retry` run
- **Then** `bun run gate` and `bun run tools:fresh` exit 0 (≥90% per-file coverage), `wechatmp-pub.文章` saves a draft whose read-back confirms non-empty article body text (`textLen > 1000`), and `weibo-pub.article` / `medium-pub` either record confirmed draft receipts or honest operator-action receipts if gated by an external UI state

### Q&A

- **Q1 (R6 optional vs explicit `--channels` failure exit code — closed 2026-11-22):** Should `publish-settle` / `publish-report` fail when *any* optional (`required: false`) target fails, or only when an explicitly requested `--channels` / `--live-channels` target (or the entire non-dummy window) fails?
  - **Decision:** Keep optional (`required: false`) syndication failures non-fatal in unfiltered full-window runs (`apps/cli/tests/content-publish.e2e.test.ts:463-483` contract), but (1) in `composePlan` (`apps/cli/src/publish-matrix.ts:789`), promote `row.required = true` whenever the operator explicitly selected that target via `--channels` or `--live-channels`, and (2) in `settleAction` / `reportAction` (`apps/cli/src/commands/content-publish.ts:389,474`), also fail when a window has ≥1 planned non-dummy row and 0 succeeded rows.
- **Q2 (R1–R3 WeChat MP empty body & `内容结构检测` — closed 2026-11-22):** Why did `wechatmp-pub.文章` save a draft with `textLen: 0` and only `cover.jpg` in the body?
  - **Decision:** `insertBody` (`plugins/publishings/wechatmp-pub/src/flow.ts:704-706`) returned immediately after `pasteHtml` without checking `await bodyLength(page, selector) > 0`; because ProseMirror's placeholder widget (`从这里开始写正文`) satisfies `pasteHtml`'s raw `textContent.length > 0` check, `insertBody` never ran the `insertHtmlScript` fallback (`flow.ts:718`). Fix `insertBody` to check `await bodyLength(page, selector) > 0` after `pasteHtml`, add `style="overflow-x:auto;max-width:100%;"` to `<pre>` in `markdownToWechatHtml`, add `我知道了`/`关闭`/`确定` to `DIALOG_CLOSE` / `DIALOG_DISMISS`, and reject `图文内容不完整` in `saveDraft`.
- **Q3 (R4 Medium Cloudflare interstitial in headless mode — closed 2026-11-22):** How should `medium-pub` handle Cloudflare blocking headless Chromium on `https://medium.com/new-story` now that Medium no longer issues integration tokens?
  - **Decision:** Set `checkHeadedOnly: true` in `channelConfig()` and pass `headedOnly: true` to `checkChannelSession` in `plugins/publishings/medium-pub/src/browser-rail.ts` (matching `infoq-pub`, `juejin-pub`, `x-pub`). If the headed page still displays a Cloudflare challenge (`Just a moment...` / `Performing security verification`), fail closed (`ok: false`, `effect: 'none'`) with an operator instruction — never attempt to solve or bypass the challenge.

### Design

#### Frozen Names, Precedence & Impacted Surfaces

1. **`wechatmp-pub` body verification, `<pre>` styling, dialog cleanup & draft completeness guard (R1, R2, R3)**
   - **Primary file:** `plugins/publishings/wechatmp-pub/src/flow.ts`
   - **`insertBody` (`flow.ts:695-723`):**
     - After `await pasteHtml(asPlaywrightPage(page), selector, html, { timeoutMs: Math.min(deps.stepTimeoutMs, 10_000) })`, check `if ((await bodyLength(page, selector)) > 0) return;` instead of an unconditional `return;`.
     - If `bodyLength(page, selector) === 0`, log/continue into `await closeOpenDialogs(page)` → `clickSelector(page, selector, deps.stepTimeoutMs)` → `insertHtmlScript(selector, html)` → `insertTextScript(selector, body)`.
   - **`markdownToWechatHtml` (`flow.ts:2691-2728`):**
     - Change line 2720 from `out.push(\`<pre><code>\${escapeHtml(code.join('\\n'))}</code></pre>\`);` to `out.push(\`<pre style="overflow-x:auto;max-width:100%;"><code>\${escapeHtml(code.join('\\n'))}</code></pre>\`);`.
   - **`DIALOG_CLOSE` & `DIALOG_DISMISS` (`flow.ts:160-196`):**
     - Add `.weui-desktop-dialog__wrp button:has-text("我知道了")`, `button:has-text("我知道了")`, `.weui-desktop-dialog__wrp button:has-text("关闭")`, and `.weui-desktop-dialog__wrp button:has-text("确定")` to `DIALOG_CLOSE` and `DIALOG_DISMISS` (after `.weui-desktop-dialog__close-btn` / `取消` so cancel/close buttons still win over confirm buttons on settings dialogs).
   - **`saveDraft` (`flow.ts:1773-1850`):**
     - Pre-save guard: when `input.operation === '文章'` and `bodyOf(deps.content).trim().length > 0`, verify `await bodyLength(entry.editor, BODY_BLOCK[1]) > 0` before clicking `保存为草稿`; if `0`, return `fail('draft confirmation: article body is empty before 保存为草稿 — refusing to save an incomplete draft')`.
     - Post-save stamp guard: define `export const INCOMPLETE_DRAFT_MARKER = '图文内容不完整';`. Inside `saveDraft`, if `signal.includes(INCOMPLETE_DRAFT_MARKER)`, return `fail(\`draft confirmation: 草稿箱 row for '\${title}' reported '\${signal.replace(/\\s+/g, ' ').trim()}' — refusing to certify an incomplete draft\`)`.
   - **Tests:** `plugins/publishings/wechatmp-pub/tests/wechatmp-editor-insert.test.ts` and `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts`.

2. **`medium-pub` headed browser rail & fail-closed Cloudflare challenge check (R4)**
   - **Primary files:** `plugins/publishings/medium-pub/src/browser-rail.ts`, `plugins/publishings/medium-pub/plugin.json`, `plugins/publishings/medium-pub/tests/medium-pub.test.ts`
   - **`channelConfig()` (`browser-rail.ts:59-66`):**
     - Add `checkHeadedOnly: true` to the returned `ChannelBrowserConfig`.
   - **Preflight & page launch (`browser-rail.ts:126-148`):**
     - In `checkChannelSession(channelConfig(), ...)`, replace `headedFallback: false` with `headedOnly: true`.
     - In `withProfilePage(...)`, keep `headless: payload.options?.headless === true` (which defaults to `false`, i.e., headed).
   - **Fail-closed Cloudflare challenge guard (`browser-rail.ts`):**
     - Export `export const CHALLENGE_RE = /(Just a moment\.\.\.|Performing security verification|Attention Required! \| Cloudflare)/i;`.
     - Add `export async function isChallengePage(page: Page): Promise<boolean>` checking `CHALLENGE_RE.test(await page.title().catch(() => ''))`.
     - In `isAuthenticated`, return `false` when `await isChallengePage(page)` is true.
     - Update the line-1 `// transcript:` header to record the 2026-11-22 headed verification and Cloudflare headless finding.

3. **Signal-safe lease release (`kk bot open|login|replay`) & dead-pid lease guidance (R5)**
   - **Primary files:** `packages/publish-harness/src/browser.ts`, `packages/publish-harness/src/bot-replay.ts`, `packages/publish-harness/src/profile-lease.ts`, `apps/cli/src/invoke.ts`
   - **Signal cleanup in `openBot` (`browser.ts:1381-1462`), `loginBot` (`browser.ts:1186-1255`), and `replayBot` (`bot-replay.ts:258-305`):**
     - Reuse `parkSigintListenersSince` (export from `./bot-record` or move to `./profile-lease` / `./browser`).
     - While `lease` is held, register `process.once('SIGINT', onSigint)` and `process.once('SIGTERM', onSigterm)` that close `context` (or allow the adapter child to exit on signal), await `lease.release()` idempotently (memoized `releasing ??= ...` so `finally` awaits the in-flight release instead of racing), and set `process.exitCode = 130` (`SIGINT`) / `143` (`SIGTERM`).
   - **Dead-pid message in `busyGuidance` (`profile-lease.ts:232-249`):**
     - Export `isProcessAlive` (`profile-lease.ts:283`). When `!isProcessAlive(owner.pid)`, append: ` (pid ${owner.pid} is no longer running — confirm no browser for this profile is open, then remove the stale lease with: rm -rf ${leaseDir})`. Never auto-delete the lease directory.
   - **Tests:** `packages/publish-harness/tests/profile-lease.test.ts` and `packages/publish-harness/tests/bot-session.test.ts` (or `browser.test.ts`).

4. **Honest run failure when `--channels` / `--live-channels` targets fail (R6)**
   - **Primary files:** `apps/cli/src/publish-matrix.ts`, `apps/cli/src/commands/content-publish.ts`, `docs/04_DESIGN.md`
   - **`composePlan` (`apps/cli/src/publish-matrix.ts:781-790`):**
     - Compute `const explicitlySelected = input.channels.some((token) => matches(target, token)) || liveToken !== undefined;`.
     - Set `required: (target.required ?? false) || explicitlySelected` on the `PublishPlanRow`.
   - **`settleAction` & `reportAction` (`apps/cli/src/commands/content-publish.ts:389-392,474-481`):**
     - In addition to `failedRequired`, check `const nonDummy = rows.filter((row) => row.dummy !== true); const allFailed = nonDummy.length > 0 && nonDummy.every((row) => row.status !== 'succeeded');`.
     - If `failedRequired || allFailed`, throw/return exit code 1 (`publish-settle: required targets failed` / `publish-report: required targets failed — see outcome.<window>.json and the page`).
   - **Surface doc sync (T3):** Update `docs/04_DESIGN.md` §1.14 to note that targets explicitly selected via `--channels` or `--live-channels` are treated as required for that invocation's exit code.
   - **Tests:** `apps/cli/tests/article-publish-dogfood.test.ts` and `apps/cli/tests/content-publish.e2e.test.ts`.

#### Anti-Patterns (Do NOT Implement)
- Do NOT attempt to click, solve, wait out, or bypass Cloudflare Turnstile / anti-bot challenges in `medium-pub` or anywhere else.
- Do NOT auto-remove stale lease directories inside `acquireProfileLease` (`profile-lease.ts` invariant: stale ownership is never auto-removed).
- Do NOT fail `publish-report` when an optional (`required: false`) row fails in an unfiltered window where at least one non-dummy row succeeded (`apps/cli/tests/content-publish.e2e.test.ts:463-483` must remain green).
- Do NOT skip syncing built `apps/cli/dist/index.js` and updated `plugins/publishings/{wechatmp-pub,medium-pub}` to `~/.bun/install/global/node_modules/@gobing-ai/knowledge-kit` before running `kk article publish`.

### Plan

1. [ ] **R1–R3 — TDD & fix `wechatmp-pub` body fallback, `<pre>` overflow, dialog close, and `saveDraft` completeness guard:** First write failing unit tests in `plugins/publishings/wechatmp-pub/tests/wechatmp-editor-insert.test.ts` and `wechatmp-pub.test.ts` for (a) `insertBody` falling through to `insertHtmlScript` when `pasteHtml` resolves with `bodyLength === 0`, (b) `markdownToWechatHtml` emitting `<pre style="overflow-x:auto;max-width:100%;">`, (c) `closeOpenDialogs` dismissing a `内容结构检测` dialog via `我知道了`, and (d) `saveDraft` rejecting an empty body or a `图文内容不完整` stamp; then implement in `plugins/publishings/wechatmp-pub/src/flow.ts` and verify tests pass with ≥90% per-file coverage.
2. [ ] **R4 — TDD & switch `medium-pub` to headed browser rail with fail-closed Cloudflare check:** First update unit tests in `plugins/publishings/medium-pub/tests/medium-pub.test.ts` asserting `channelConfig().checkHeadedOnly === true`, `headedOnly: true` on `checkChannelSession`, `headless: false` default on `withProfilePage`, and fail-closed `effect: 'none'` when `page.title()` matches `CHALLENGE_RE`; then implement in `plugins/publishings/medium-pub/src/browser-rail.ts` + `plugin.json`, and verify `bun scripts/check-rail-transcripts.ts` exits 0.
3. [ ] **R5 — TDD & add `SIGINT`/`SIGTERM` lease cleanup to `openBot`/`loginBot`/`replayBot` + dead-pid guidance:** First write failing tests in `packages/publish-harness/tests/` for dead-pid `busyGuidance` (`rm -rf <leaseDir>`) and signal-triggered lease release; then implement in `packages/publish-harness/src/profile-lease.ts`, `packages/publish-harness/src/browser.ts`, and `packages/publish-harness/src/bot-replay.ts`.
4. [ ] **R6 — TDD & make `--channels` / `--live-channels` targets required for run exit code:** First add failing tests in `apps/cli/tests/article-publish-dogfood.test.ts` and `apps/cli/tests/content-publish.e2e.test.ts` verifying that `--channels`-selected rows get `required: true` in `composePlan` and that `publish-settle`/`publish-report` exit 1 when all planned non-dummy rows fail while keeping partial optional-row tolerance (`content-publish.e2e.test.ts:463-483`) green; then update `apps/cli/src/publish-matrix.ts`, `apps/cli/src/commands/content-publish.ts`, and `docs/04_DESIGN.md` §1.14.
5. [ ] **Full quality gate & global package sync:** Run `bun run gate` (format + build + lint + 60 pre-check rules + full test suite + 3 post-check rules) and verify exit 0; sync `apps/cli/dist/index.js` and `plugins/publishings/{wechatmp-pub,medium-pub}` into `~/.bun/install/global/node_modules/@gobing-ai/knowledge-kit/` and verify `bun run tools:fresh`.
6. [ ] **R7 — Dogfood `a2ui-intro` remaining channels & read-back verification:** Confirm pid `58982` is dead and remove `~/.config/kk/browser-leases/b1a915e5a970f3965283f91330592c6fd971c1cc4b8ea80f6533dd8b007553ea`; run `kk article publish --slug a2ui-intro --channels wechatmp-pub.文章,weibo-pub.article,medium-pub --retry`; read back the saved WeChat MP draft (`textarea#title`, `div.ProseMirror` `textLen > 1000`, `<pre>` count, cover state) and inspect `4-publish/receipts/*.json`; record Solution, Testing, and Review in task `0423`.

### Solution

**R1–R3 — `plugins/publishings/wechatmp-pub/src/flow.ts`**
- `insertBody` (`flow.ts:707-741`, exported at 707 for the fixtures): the `pasteHtml` branch no longer returns unconditionally. It re-measures with the placeholder-aware `bodyLength` (`flow.ts:722`) and only returns when the body really holds text; otherwise it closes the console modal and falls through to `insertHTML` → `insertText`, throwing only when all three left the editor empty. That unguarded return is what saved the a2ui-intro draft with `textLen 0` and only the cover image.
- `saveDraft` (`flow.ts:1786-1812`, `flow.ts:1855-1860`): refuses before clicking `保存为草稿` when a `文章` body reads empty (`flow.ts:1807`), and refuses to certify a 草稿箱 stamp containing `INCOMPLETE_DRAFT_MARKER` (`图文内容不完整`, `flow.ts:1790`). The stamp guard is the one the live console exercised today (see Testing).
- `markdownToWechatHtml` (`flow.ts:2755`): fenced code now emits `<pre style="overflow-x:auto;max-width:100%;">`, so the console no longer raises its `内容结构检测` pre-overflow notice (paragraphs 7 and 41 in the a2ui-intro body).
- `DIALOG_CLOSE` / `DIALOG_DISMISS` (`flow.ts:160-196`): notice-dialog controls (`我知道了`, `关闭`, `确定`) added AFTER the close/cancel entries, so a settings dialog still exits through its cancel and the notice can no longer cover the cover-panel opener.

**R4 — `plugins/publishings/medium-pub`**
- `src/browser-rail.ts`: `CHALLENGE_RE` + `isChallengePage` (`:62-74`); `isAuthenticated` refuses a challenge page (`:79`); `ChallengeBlockedError` (`:86`) is thrown from the editor flow's readiness predicate (`:195`) so the refusal names Cloudflare and the operator action with `effect: 'none'`; `channelConfig().checkHeadedOnly = true` (`:103`); the preflight runs `headedOnly: true` (`:180`); an absent profile is refused through `ensureProfileDir(profileDir, true)` before any headed launch (`:169`) — a headed launch would create the directory and hold its lease; the `// transcript:` header and `plugin.json` description record the 2026-11-22 measurement.
- `packages/publish-harness/src/browser.ts` re-exports `ensureProfileDir` for that guard.

**R5 — `packages/publish-harness` + `apps/cli`**
- `browser.ts`: `signalSafeRelease` (`:1161`, interface `:1147`) registers SIGINT/SIGTERM handlers before the launch, parks Playwright's own launch listener by identity after it (never its own), and closes+releases exactly once before exiting 130/143. `openBot` (`:1503`), `loginBot` (`:1275`) and `replayBot` (`bot-replay.ts:276`) use it, so a Ctrl-C releases the profile lease instead of leaving `owner.json` naming a dead pid.
- `BotAdapterRunRequest.signal` (`:1116`) + `spawnPluginSession`'s `signal` (`apps/cli/src/invoke.ts:198,278`) kill an adapter child on interrupt; `apps/cli/src/bot-adapter.ts:141` forwards it.
- `profile-lease.ts`: `isProcessAlive` exported (`:290`); `busyGuidance` (`:246-256`) names a dead owner pid and prints the exact `rm -rf <leaseDir>` recovery, still never removing the lease itself.

**R6 — `apps/cli` + `docs/04_DESIGN.md`**
- `publish-matrix.ts:785-795`: a row selected by `--channels` / `--live-channels` is planned `required: true` (a `--dummy` rehearsal stays optional, because it asserts nothing about the channel).
- `commands/content-publish.ts`: `everyPlannedRealRowFailed` (`:121-140`) reads the PLAN's per-row mode (the outcome's `dummy` flag is receipt-derived, so a dummy row that never sent reads `dummy: false`) and `publish-settle` (`:413`) / `publish-report` (`:500`) exit 1 when every planned real row failed. `docs/04_DESIGN.md` §1.14 documents both the promotion and the tolerances.

### Testing

**Full gate (R7).** `bun run gate` in the worktree `spur run-0423-63d9`: `biome check` + typecheck clean; build clean; `recommended-pre-check` 60/60 rules pass; full suite **6369 pass / 0 fail** across 368 files with the per-file coverage threshold met (`browser.ts` 91.67 % funcs, `bot-replay.ts` 94.74 %, `profile-lease.ts` 100 %, `content-publish.ts` 91.14 %, `browser-rail.ts` 95.24 %); `recommended-post-check` 3/3 after the `signalSafeRelease` TSDoc. Exit 0 on the final run of every stage; the gate was re-run three times because the post-check rules caught a raw `process.stderr.write` and a missing export TSDoc, both fixed rather than suppressed.

**Targeted suites (TDD: tests written first, seen red, then green).**
- `plugins/publishings/wechatmp-pub/tests/wechatmp-editor-insert.test.ts` — new real-Chromium fixtures drive the PRODUCTION `insertBody`: a page whose paste is dropped but whose placeholder keeps `textContent` non-empty now falls through to `insertHTML` and lands the body; a page that also refuses `insertHTML` lands it through `insertText`; a page that refuses both throws `stayed empty after paste`. 9 pass.
- `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts` — fake-console cases: an empty editor body is refused BEFORE `保存为草稿` (no save click recorded); a `图文内容不完整` stamp is refused; a `内容结构检测` notice exposing only `我知道了`/`关闭` is cleared through its own control (the fake models Escape and the settings-dialog controls as unable to reach it). 141 pass.
- `plugins/publishings/wechatmp-pub/tests/wechatmp-cgi-draft.test.ts` — its DOM fake learned the 0423 R1 body probe; 42 pass (three of these were red in the first full gate run).
- `plugins/publishings/medium-pub/tests/medium-pub.test.ts` — challenge fail-closed with `effect: 'none'` and every launch headed; absent profile refused with no directory created and no launch; the draft/live flow launches headed. 13 pass.
- `packages/publish-harness/tests/bot-session.test.ts` — REAL signals delivered to separate `bun` processes (fixture `tests/fixtures/session-sigint-probe.ts`): SIGINT during `bot open`, `bot login` and `bot replay` exits 130 with the lease directory gone, SIGTERM exits 143, plus an in-process ordering/idempotence case. 33 pass.
- `packages/publish-harness/tests/profile-lease.test.ts` — a lease whose owner pid is dead names the death and prints `rm -rf <leaseDir>` while leaving the directory in place. 12 pass.
- `apps/cli/tests/article-publish-dogfood.test.ts` + `content-publish.e2e.test.ts` — `--channels`-selected rows plan `required: true`; an all-failed non-dummy window exits 1; the partial-window optional-row tolerance stays green. 13 pass. Also re-ran `publish-matrix{,-0330,-0332}`, `kk-publish.e2e`, `publish-channels-link`, `content-nouns.e2e` (87 pass) after the R6 change.

**Live dogfood (R7, 2026-11-22 20:06-20:21 PT).** `bun run build` + the CLI bundle and `plugins/publishings/{wechatmp-pub,medium-pub}` synced into `~/.bun/install/global/node_modules/@gobing-ai/knowledge-kit` (installed copy verified: `INCOMPLETE_DRAFT_MARKER`, `overflow-x:auto`, `我知道了` all present; `everyPlannedRealRowFailed`/`signalSafeRelease` present in the bundle), `bun run tools:fresh` exit 0, and the three dead-pid leases removed (`weibo` pid 58982 plus two `.works/tmp` test residues).
- `kk article publish --slug a2ui-intro --channels wechatmp-pub.文章,weibo-pub.article,medium-pub --retry`: plan rows all `required: true` (R6); `publish-report` exited 1 with `required targets failed` — the honest nonzero exit the task asked for, instead of the old `status: done`/`exitCode: 0`.
- `weibo-pub.article`: honest `effect: none` receipt — "weibo article editor never reset to a blank draft".
- `medium-pub`: honest fail-closed refusal — the headed session preflight did not confirm auth within 18 s (`effect: none`); no Cloudflare interstitial appeared, so the challenge guard itself was not exercised live.
- `wechatmp-pub.文章`: the first attempt credited a STALE 14:51 `succeeded` receipt (the poisoned artifact of the pre-fix run) and dispatched nothing. After quarantining that receipt and its fanout result (`.stale-20261122-1451.bak`) and clearing the target's `dispatch-ledger.json` entry (backup at `/tmp/kk-0423-ledger-backup.json`), the re-run dispatched for real and **R2's stamp guard refused to certify it**: `status: uncertain`, `effect: unknown`, error `draft confirmation: 草稿箱 row for 'A2UI 1.0：让 agent 用界面来回答' reported '更新于 20:19 图文内容不完整 请补充封面图、标题或者正文' — refusing to certify an incomplete draft`. The console no longer raised `内容结构检测` (the `<pre>` fix held); it still reports the draft incomplete because the cover step did not commit (`cover: 从正文选择 未标出与请求文件同名的素材`).

**AC7 residual (not met).** A `wechatmp-pub.文章` draft whose read-back shows `textLen > 1000` was NOT achieved: the console keeps reporting `图文内容不完整` because the cover is unset. That is the next task's material, not a 0423 requirement — 0423's contract is that the run can no longer claim success on it, and it no longer can.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: `G61` (`docs/design/content-pipeline-consolidation.md`), ADR-053 (`docs/00_ADR.md:1933-2010`), ADR-022, ADR-026, ADR-029
- Predecessor task: `0422` (`docs/tasks/0422_article-publishing-workflow-hardening-and-full-platform-comp.md`)
- WeChat MP plugin: `plugins/publishings/wechatmp-pub/src/flow.ts`, `plugins/publishings/wechatmp-pub/src/modes.ts`, `plugins/publishings/wechatmp-pub/src/cgi-draft.ts`, `plugins/publishings/wechatmp-pub/tests/wechatmp-editor-insert.test.ts`
- Medium plugin: `plugins/publishings/medium-pub/src/browser-rail.ts`, `plugins/publishings/medium-pub/plugin.json`, `plugins/publishings/medium-pub/tests/medium-pub.test.ts`
- Headed-only channel references: `plugins/publishings/infoq-pub/src/index.ts:141,286`, `plugins/publishings/juejin-pub/src/index.ts:95,252`, `plugins/publishings/x-pub/src/post-rail.ts:84,155`
- Browser lease & signal handling: `packages/publish-harness/src/profile-lease.ts:232-249,283-290`, `packages/publish-harness/src/browser.ts:505-550,1186-1255,1381-1462`, `packages/publish-harness/src/bot-record.ts:364-370,432-488`, `packages/publish-harness/src/bot-replay.ts:258-305`
- Publish matrix & settle/report exit semantics: `apps/cli/src/publish-matrix.ts:781-790`, `apps/cli/src/commands/content-publish.ts:389-392,474-481`, `apps/cli/tests/content-publish.e2e.test.ts:438-484`, `docs/04_DESIGN.md` §1.14
- Dogfood workspace: `.works/kk-article-generate/a2ui-intro` (`4-publish/receipts/wechatmp-pub.文章.json`, `4-publish/fanout-result.wechatmp-pub.文章.json`, `4-publish/receipts/weibo-pub.article.json`, `4-publish/receipts/medium-pub.json`)
- Concurrency audit (2026-11-22): 1 worktree (`main` at `d0be4a37`), 0 `wip` tasks.

### History

- 2026-11-23T00:56:55.117Z backlog → todo (system)
- 2026-11-23T04:23:12.834Z todo → wip (system)

