# juejin (juejin.cn) console UI discovery (task 0202) — second pass, measured 2026-10-06

## Status: MEASURED — draft-save signal proven after phone binding

- Profile: `~/.config/kk/browser-profiles/juejin` (JUEJIN_PROFILE_DIR / KK_BROWSER_PROFILE_DIR override).
- First-pass "session expired" verdict was **superseded**: the session cookie was alive; the real blocker was
  account-level. Re-measured 2026-10-06 evening with the operator present.

## Blocker resolution (measured)

1. Session check (headed): home renders the operator avatar (冰原奔狼), no 登录 entry — session **alive**.
2. Draft autosave on `editor/drafts/new?v=2` fails with a **"must bind phone" / 出现错误** banner; no URL id rewrite,
   reload loses content. Account-level, not session-level.
3. Settings page (`juejin.cn/user/center/settings`) holds the compliance dialog:
   「根据我国《网络安全法》，您需要绑定手机号后才可在社区内发布内容。」with 获取验证码 / 绑定手机 controls.
4. Operator completed the SMS binding in the headed window (dialog cleared ~2 min). Editor immediately functional.

## Measured editor contract (on `/editor/drafts/new?v=2`)

| Control | Measured | Recorded candidate → verdict |
| --- | --- | --- |
| Editor URL | `https://juejin.cn/editor/drafts/new?v=2` → rewrites to **`/editor/drafts/<id>`** on first autosave | **still valid** |
| Title | `input[placeholder*="标题"]` matched and filled (echo confirmed) | **still valid** |
| Body | markdown host accepts keyboard typing; char/line counters update (`字符数/行数/正文字数`) | CodeMirror candidates plausible; keyboard path measured |
| Autosave | **保存成功** toast within ~3 s of typing; draft id URL rewrite is the durable signal | **proven** |
| Persistence | hard reload reads back title + body from the server draft (`juejin-walk2.json`) | **proven** |
| Live/publish | `button.xitu-btn:发布` (toolbar) + `button.xitu-btn.btn-drafts:草稿箱` — **located, never clicked** | popup flow (category/tags/确定并发布) unverified, live-only |

## Draft-save signal (R3) — proven end to end

Typed title + body → 保存成功 → URL id `7693358476032786442` → reload persistence (`juejin-walk2.json`).
Test draft remains in the draft box as the artifact.

## Safety

Navigation, phone binding (operator-completed), draft fill/save, reload only. 发布 and 草稿箱 controls were located,
**never clicked**. No publish dialog was opened.

## Infra note

The editor page needs ~15 s hydration before the title input is interactive; an 8 s click timeout aborts with a
selector timeout. Phone-bind dialog fields (`请输入手机号`/`请输入验证码`) can persist in the DOM after binding —
readiness checks should key on the title input, not input counts.
