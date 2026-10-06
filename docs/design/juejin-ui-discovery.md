# juejin (juejin.cn) console UI discovery (task 0202) — first pass, blocked at session

## Status: BLOCKED — operator login required

- Profile: `~/.config/kk/browser-profiles/juejin` (JUEJIN_PROFILE_DIR / KK_BROWSER_PROFILE_DIR override).
- 2026-10-06 walk: `https://juejin.cn/editor/drafts/new?v=2` redirects to login (passport.juejin.cn) — saved session expired; walk aborted at the login check, nothing filled, nothing clicked.
- Re-measurement (CodeMirror fill path, autosave→URL draft-id signal, manual Cmd+S, publish popup affordance) is blocked behind an interactive login: run `bun plugins/publishings/juejin-pub/src/profile-check.ts login`, then rerun `.spur/run/discovery/walk-juejin.ts`.

## Baseline from plugin constants (to verify after login)

| Control | Recorded candidates |
| --- | --- |
| Editor | `https://juejin.cn/editor/drafts/new?v=2` |
| Title | `input.title-input`, `input[placeholder*="标题"]` |
| Body | `.bytemd-editor .CodeMirror`, `.CodeMirror`, `.cm-editor` (markdown) |
| Autosave | draft id appears in URL (`/drafts/<id>`), ≤5s window; manual `Meta+s`/`Control+s` |
| Live | `button:has-text("发布")` popup → category `.category-list .item`, tags `.tag-input input`, confirm `button:has-text("确定并发布")` — **live-only, never automated** |

## Safety

Walk aborted before any interaction; no publish control touched.
