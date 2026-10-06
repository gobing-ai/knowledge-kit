# infoq (xie.infoq.cn) console UI discovery (task 0201) — second pass, measured 2026-10-06

## Status: MEASURED — authenticated walk complete (login + draft-save signal)

- Profile: `~/.config/kk/browser-profiles/infoq` (INFOQ_PROFILE_DIR / KK_BROWSER_PROFILE_DIR override).
- Operator login completed 2026-10-06 via the home 登录 entry: `account.geekbang.org/infoq/login` → WeChat QR scan
  (account pre-registered and WeChat-linked; SMS path exists at `/infoq/login/sms`).
- Evidence artifacts (`.spur/run/discovery/`): `infoq-login3.json`, `infoq-editor-entry.json`, `infoq-editor2.json`,
  `infoq-walk2.json`, `infoq-walk3.json`; scripts `login-infoq3.ts`, `probe-infoq-editor2.ts`, `walk-infoq3.ts`.

## Infra drift (first-pass hypotheses → confirmed)

1. **Headless Chromium is WAF-blocked**: every headless launch receives HTTP **451 with an empty body** on
   `xie.infoq.cn` (clean context and UA-spoofed both 451); curl and **headed** Chromium receive 200. All infoq
   automation must run `headless: false`. The first-pass "empty shell" observation was this block, not site markup.
2. **`/write` is dead even authenticated**: renders an empty shell (no title/body/ProseMirror, no buttons) with no
   login redirect — the first-pass `loginRedirect=false` false-pass risk is confirmed and now moot (the URL itself is gone).
3. **Editor entry moved**: home 立即创作 (`div.write-btn.Button_button_3onsJ`) SPA-routes to **`/draft/<id>`** and the
   draft is **created server-side on entry** — the URL id signal exists before any content is typed
   (`/draft/405943` measured). `EDITOR_URL`-style constants pointing at `/write` are stale.
4. **`LOGIN_URL_RE` drift**: the SSO domain is `account.geekbang.org`, not `account.infoq.cn`; the `\/login` arm still
   matches the geekbang path by luck. Home hydration takes ~10 s (a short-wait readiness check false-reads "logged out"
   and non-hydrated pages false-read "logged in" — require hydration + positive avatar signal).

## Measured editor contract (on `/draft/<id>`, authenticated)

| Control | Measured | Recorded candidate → verdict |
| --- | --- | --- |
| Editor URL | `https://xie.infoq.cn/draft/<id>` (entry via home `.write-btn`) | `/write` → **dead** |
| Title | `input[placeholder="请输入标题"]` | `[placeholder*="标题"]` → **still matches** |
| Summary | none in the flow | summary candidates → **dead** (no summary field) |
| Body | `.ProseMirror[contenteditable="true"]` | → **still matches** |
| Draft save | **autosave**, indicator text **已保存**; no save button | `button:has-text("保存草稿")` → **dead** |
| Draft signal | URL id at entry + reload persistence + `草稿箱 (N)` counter (4→5 observed) | draft URL id regex → **still works** |
| Live/publish | `div.submit-btn.Button_button_3onsJ` 发布 + `div.preview-btn` 预览 (DIVs, not `<button>`) | `button:has-text("提交")` → **dead** (control is 发布, element is a div) |
| Quota | `当日您还可以编辑发布 30 篇文章` (30/day) | not recorded before → new fact |
| Input caveat | a 知道了 feature-notice modal overlays the editor and swallows click/fill events — dismiss first; CDP `fill()` did not register, real keyboard input did | new fact |

## Draft-save signal (R3) — proven end to end

Keyboard-typed title + body on `/draft/405943` → 已保存 indicator within ~6 s → hard reload read back identical
title/body (`infoq-walk3.json`). A test draft (`E92 walk3 …`) remains in the account's 草稿箱 as the artifact.

## Safety

Login, navigation, draft fill/save and reload only. The publish control was **located, never clicked** (`.submit-btn`
发布). No 发布/提交 action was activated by automation.
