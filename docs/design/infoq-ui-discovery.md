# infoq (xie.infoq.cn) console UI discovery (task 0201) — first pass, blocked at session

## Status: BLOCKED — operator login required

- Profile: `~/.config/kk/browser-profiles/infoq` (INFOQ_PROFILE_DIR / KK_BROWSER_PROFILE_DIR override).
- 2026-06-10 walk: launchPersistentContext succeeded; `https://xie.infoq.cn/` home renders **登录 / 注册** — the saved session is expired.
- `https://xie.infoq.cn/write` with the dead session renders an **empty editor shell** (6 chrome buttons, no title/body/ProseMirror) and does **not redirect to login** (loginRedirect=false) — minor drift candidate vs `LOGIN_URL_RE` assumptions: an unauthenticated write page stays on `/write` with no controls; a readiness check keyed on login redirect would false-pass.
- Re-measurement (selectors 保存草稿/提交, draft signal, mode table) is blocked behind an interactive login: run `bun plugins/publishings/infoq-pub/src/profile-check.ts login`, then rerun `.spur/run/discovery/walk-infoq.ts`.

## Baseline from plugin constants (to verify after login)

| Control | Recorded candidates |
| --- | --- |
| Editor | `https://xie.infoq.cn/write` |
| Title | `input[placeholder*="标题"]`, `textarea[placeholder*="标题"]` |
| Summary | `input[placeholder*="摘要"]`, `textarea[placeholder*="摘要"]`, `input[name=summary]` |
| Body | `.ProseMirror[contenteditable="true"]` |
| Draft | `button:has-text("保存草稿")` (toasts `保存成功`/`已保存`, draft URL id `/(\d{4,})`) |
| Live | `button:has-text("提交")` (editorial review — never activated by automation) |

## Safety

Walk clicked nothing; no publish/submit control was present to act on.
