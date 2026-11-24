---
schema_version: 1
name: "a2ui-intro publish follow-up: wechatmp empty body, medium headed rail, lease release, honest run status"
status: done
template: standard
created_at: 2026-11-22T23:54:40.428Z
updated_at: "2026-11-24T01:02:10.626Z"
feature_id: G61

priority: P1
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 6
done_forced: "false"
done_reason: unforced close
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

- [x] R1. Verify `wechatmp-pub` 文章 body insertion after `pasteHtml`: in `insertBody` (`plugins/publishings/wechatmp-pub/src/flow.ts:695-723`), only return from the `pasteHtml` branch when placeholder-aware `await bodyLength(page, selector) > 0`; otherwise close any paste-triggered dialog (`closeOpenDialogs`) and fall through to `insertHtmlScript` → `insertTextScript` so a saved draft never loses its article text on `appmsg_edit_v2`.
- [x] R2. Fail closed on incomplete or empty WeChat MP drafts: in `saveDraft` (`plugins/publishings/wechatmp-pub/src/flow.ts:1773-1850`), refuse (`ok: false`) before clicking `保存为草稿` when `input.operation === '文章'` and `bodyLength(entry.editor, ...)` is 0, and refuse in the 草稿箱 confirmation loop when the observed `readDraftStamp` contains `图文内容不完整`, so an incomplete draft never produces a `succeeded` / `confirmed` receipt.
- [x] R3. Prevent and dismiss WeChat MP `内容结构检测` `<pre>` overflow modals: update `markdownToWechatHtml` (`plugins/publishings/wechatmp-pub/src/flow.ts:2691-2728`) so fenced code blocks emit `<pre style="overflow-x:auto;max-width:100%;"><code>…</code></pre>`, and extend `DIALOG_CLOSE` / `DIALOG_DISMISS` (`flow.ts:160-196`) with notice-dialog close controls (`button:has-text("我知道了")`, `button:has-text("关闭")`, `.weui-desktop-dialog__wrp button:has-text("确定")`) so `closeOpenDialogs` clears `内容结构检测` before `setCover` opens the cover panel.
- [x] R4. Run `medium-pub` browser rail headed by default and fail closed on Cloudflare challenges: in `plugins/publishings/medium-pub/src/browser-rail.ts`, set `checkHeadedOnly: true` in `channelConfig()`, pass `headedOnly: true` to `checkChannelSession`, default `withProfilePage` to `headless: payload.options?.headless === true` (headed when omitted), detect Cloudflare challenge pages (`Just a moment...` / `Performing security verification`) with a fail-closed `effect: 'none'` result instructing the operator, re-verify editor selectors on the live headed `/new-story` page, and update the `// transcript:` header and `plugins/publishings/medium-pub/plugin.json` description.
- [x] R5. Release browser profile leases on `SIGINT`/`SIGTERM` across `kk bot open|login|replay` and improve dead-pid guidance: apply `parkSigintListenersSince` + `SIGINT`/`SIGTERM` cleanup handlers (from `packages/publish-harness/src/bot-record.ts:364-370,432-488`) to `openBot`, `loginBot` (`packages/publish-harness/src/browser.ts:1186-1255,1381-1462`), and `replayBot` (`packages/publish-harness/src/bot-replay.ts:258-305`), killing any spawned adapter child on signal before releasing the lease; in `busyGuidance` (`packages/publish-harness/src/profile-lease.ts:232-249`), when `!isProcessAlive(owner.pid)`, append that `pid <pid>` is no longer running and print the exact `rm -rf <leaseDir>` recovery command (without auto-removing).
- [x] R6. Surface failed targets honestly in `kk article publish` / `kk-publish`: in `composePlan` (`apps/cli/src/publish-matrix.ts:781-790`), promote `row.required` to `true` for any target explicitly selected via `--channels` or `--live-channels`, and in `settleAction` / `reportAction` (`apps/cli/src/commands/content-publish.ts:389-392,474-481`), also exit 1 when a window has ≥1 planned non-dummy row and 0 succeeded rows (`status === 'none'`), updating `docs/04_DESIGN.md` §1.14 in the same commit while preserving optional-row tolerance in unfiltered partial windows (`apps/cli/tests/content-publish.e2e.test.ts:463-483`).
- [x] R7. Complete and verify the `a2ui-intro` draft publish ledger: build and sync `apps/cli/dist/index.js` + `plugins/publishings/{wechatmp-pub,medium-pub}` to `~/.bun/install/global/node_modules/@gobing-ai/knowledge-kit`, verify `bun run tools:fresh` and `bun run gate` (exit 0), remove the dead-pid Weibo lease, run `kk article publish --slug a2ui-intro --channels wechatmp-pub.文章,weibo-pub.article,medium-pub --retry`, and verify `succeeded` / `confirmed` draft receipts plus non-empty body read-back for `wechatmp-pub.文章`.

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


**R7 follow-up — cover completion (2026-11-23)**
- `composeArticle` now fills 摘要/作者 BEFORE inserting the body: the live console re-rendered the editor from its pre-body state when 摘要 was filled after the paste, wiping both the body and the uploaded image.
- `attachImages` waits for the uploaded asset to become a remote `mmbiz` URL, not merely for an `<img>` element (the data-URI element arrives ~520 ms, the uploaded asset at ~30 s). A 45–60 s bounded wait replaces the 15 s element-presence check that let autosave fail with `图片未上传完成`.
- `setCover` keeps the original visible-control path and adds a bounded DOM-click fallback for the hover-only `从正文选择` / `从图片库选择` links. The picker’s current `.appmsg_content_img_item` exposes no filename, so selection is allowed only for a SOLE anonymous image candidate; near-name matches and multiple anonymous candidates still refuse, and a wrong remote crop source is never accepted. `kk article publish --slug a2ui-intro --channels wechatmp-pub.文章 --retry` now returns `status: done` and a `succeeded` / `confirmed` receipt; read-back has `textLen = 15977`, a committed cover preview, and no `图文内容不完整` stamp.
- `plugins/publishings/medium-pub/src/browser-rail.ts` transcript now records the live 2026-11-23 headed selector verification and the confirmed draft `/p/8b1a335bd4f9/edit`.

**Pre-existing gate blocker — `plugins/kk/scripts/daily-stages.ts`**
- `readKeptRatio` no longer opens every sibling directory of a shared temp parent (556k entries here). Small works roots keep the original newest-ratio walk; oversized roots use Bun’s native `kk-*` / dated-run glob to find `21-plan/*_09_spoken-ratio.json` directly. This fixes the pre-existing `daily-cache-recovery` 90 s timeout (now ~1–2 s) without dropping the 0377 sibling-ratio behavior, and it also removed the 20 s XHS-stage timeouts.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/publishings/wechatmp-pub/src/flow.ts:731-763` re-measures with `bodyLength` after `pasteHtml` and falls through to `insertHtmlScript`/`insertTextScript`; real-Chromium fixtures `plugins/publishings/wechatmp-pub/tests/wechatmp-editor-insert.test.ts:120-146` — 286 tests pass, 0 fail this run |
| R2 | MET | `plugins/publishings/wechatmp-pub/src/flow.ts:1790,1855-1860` (empty-body refusal + `INCOMPLETE_DRAFT_MARKER` stamp refusal); fake-console cases `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts:1481-1505`; live run refused an incomplete draft before the cover fix and the final live run reports a clean stamp `更新于 11:14` |
| R3 | MET | `plugins/publishings/wechatmp-pub/src/flow.ts:2755` (`<pre style="overflow-x:auto;max-width:100%;">`) and `:160-196` (notice-dialog close controls); tests `wechatmp-pub.test.ts:1507-1519` (outine cleared through `我知道了`) and `:3290` |
| R4 | MET | `plugins/publishings/medium-pub/src/browser-rail.ts:62-74,79,86,103,169,180,195`; headed live verification this run: `/new-story` exposes `h3[data-testid="editorTitleParagraph"]`=1 and `p[data-testid="editorParagraphText"]`=1; `kk article publish --slug a2ui-intro --channels medium-pub --retry` returned `succeeded`/`confirmed` at `/p/8b1a335bd4f9/edit`; challenge fail-closed + headed-only + absent-profile tests `plugins/publishings/medium-pub/tests/medium-pub.test.ts:181-231` |
| R5 | MET | `packages/publish-harness/src/browser.ts:1147-1204,1275,1503`, `packages/publish-harness/src/bot-replay.ts:276-282`, `packages/publish-harness/src/profile-lease.ts:246-256,290`; real signals to separate processes: `packages/publish-harness/tests/bot-session.test.ts:1101-1150` (open/login/replay exit 130, SIGTERM 143, lease gone), dead-pid guidance `packages/publish-harness/tests/profile-lease.test.ts:169-193` |
| R6 | MET | `apps/cli/src/publish-matrix.ts:785-795` (`--channels` rows planned required) and `apps/cli/src/commands/content-publish.ts:113-140,409-414,496-501`; `docs/04_DESIGN.md` §1.14; tests `apps/cli/tests/article-publish-dogfood.test.ts:146-155`, `apps/cli/tests/content-publish.e2e.test.ts:463-520`; live `publish-report` exits 1 on a failed required row |
| R7 | MET | `bun run build` + CLI bundle and both plugins synced into `~/.bun/install/global/node_modules/@gobing-ai/knowledge-kit`; `bun run tools:fresh` exit 0; dead Weibo lease removed; live `kk article publish --slug a2ui-intro --channels wechatmp-pub.文章 --retry` → workflow `status: done`, receipt `succeeded`/`confirmed`; read-back of the saved draft: body `textLen = 15977`, cover preview committed (`mmbiz.qpic.cn/...wx_fmt=jpeg`), stamp `更新于 11:14` with no `图文内容不完整` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `plugins/publishings/wechatmp-pub/tests/wechatmp-editor-insert.test.ts:120-146` (paste dropped → insertHTML; insertHTML refused → insertText; both refused → throws) |
| AC2 | MET | test | `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts:1481-1505`; live refusal then clean stamp on the final run |
| AC3 | MET | test | `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts:1507-1519,3290` |
| AC4 | MET | test | `plugins/publishings/medium-pub/tests/medium-pub.test.ts:181-231`; live headed editor selectors verified and a real Medium draft confirmed |
| AC5 | MET | test | `packages/publish-harness/tests/bot-session.test.ts:1101-1150`, `packages/publish-harness/tests/profile-lease.test.ts:169-193` |
| AC6 | MET | test | `apps/cli/tests/article-publish-dogfood.test.ts:146-155`, `apps/cli/tests/content-publish.e2e.test.ts:463-520`; live `publish-report` exit 1 |
| AC7 | MET | command | `bun run gate` exit 0 (6384 pass / 0 fail, pre-check 60/60, post-check 3/3); `bun run tools:fresh` exit 0; live WeChat draft body `textLen = 15977` with a committed cover |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)


**Final PASS re-verification (2026-11-23, after closing R4/R7).**
- `bun run gate` on the final tree: **6385 pass / 0 fail** across 370 files, `recommended-pre-check` 60/60, `recommended-post-check` 3/3, exit 0. Per-file coverage met, including `plugins/publishings/wechatmp-pub/src/flow.ts` at 90.21 % functions / 91.35 % lines and `packages/publish-harness/src/browser.ts` at 90.48 % functions.
- Live WeChat draft: `kk article publish --slug a2ui-intro --channels wechatmp-pub.文章 --retry` → workflow `status: done` (exit 0), receipt `succeeded`/`confirmed`; read-back of the saved draft shows body `textLen = 15977`, a committed cover preview (`mmbiz.qpic.cn/...wx_fmt=jpeg`), and the stamp `更新于 11:14` with **no** `图文内容不完整`.
- Live Medium draft: headed `/new-story` exposes `h3[data-testid="editorTitleParagraph"]` and `p[data-testid="editorParagraphText"]`; `--channels medium-pub --retry` returned `succeeded`/`confirmed` at `https://medium.com/p/8b1a335bd4f9/edit`.
- The pre-existing `daily-cache-recovery` timeout is fixed: that suite now runs in ~1–8 s instead of hitting its 90 s bound, and the 20 s XHS-stage timeouts triggered by the same 556k-entry sibling scan are gone.
- Two harness-level defects surfaced and were fixed while proving the above: a guard registered before the lease leaked its signal handlers when the acquire was refused (the full gate run could exit 143), and `Bun.Glob` throws ENOENT on dangling symlinks in a shared temp parent (now best-effort).

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

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
- 2026-11-23T17:04:26.129Z wip → testing (system)
- 2026-11-23T22:24:02.223Z testing → done (system)

