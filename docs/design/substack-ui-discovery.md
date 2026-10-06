# substack console UI discovery (task 0203) — second pass, measured 2026-10-06

## Status: MEASURED — login + publication resolved + draft-save signal proven

- Profile created at `~/.config/kk/browser-profiles/substack` (SUBSTACK_PROFILE_DIR tier); operator login completed
  2026-10-06 from `https://substack.com/` (account Robin Min / @direwolfgo258267).
- **Publication resolved from the session — `SUBSTACK_PUBLICATION_URL` is no longer an unknown**:
  settings lists `https://robinmin.substack.com/publish/home`, so the publication root is
  **`https://robinmin.substack.com`**.
- Evidence artifacts (`.spur/run/discovery/`): `substack-login.json`, `substack-pub-probe.json`,
  `substack-walk3.json`, `substack-walk4.json`; scripts `login-substack.ts`, `walk-substack4.ts`.

## Login + entry notes (measured)

- Login entry: `https://substack.com/` → Sign in (operator completed it). Google OAuth on substack works under the
  stealth launch that strips automation markers (same flags as x: `--disable-blink-features=AutomationControlled`,
  no `--enable-automation`, `navigator.webdriver` removed) — vanilla automation Chromium risks Google's
  「This browser or app may not be secure」 refusal.
- `substack.com/publish/post` on a logged-in account WITHOUT going through the publication bounces to the public
  Explore page; the editor must be opened on the publication host: `https://robinmin.substack.com/publish/post`.

## Measured editor contract (on `robinmin.substack.com/publish/post`)

| Control | Measured | Recorded candidate → verdict |
| --- | --- | --- |
| Editor URL | `/publish/post` → rewrites to **`/publish/post/<id>`** on first save (id `219172498` measured) | URL derivation from publication root → **valid** |
| Title | `textarea.pencraft.page-title`, `placeholder="Title"` (TEXTAREA) | input/Title candidates → **textarea with exact placeholder "Title"** |
| Subtitle | `textarea.pencraft.subtitle`, `placeholder="Add a subtitle…"` | present (optional) |
| Body | `div.tiptap.ProseMirror`, `data-placeholder="Start writing..."` | ProseMirror body → **valid, tiptap-based** |
| Autosave | **Saved** indicator in the toolbar (within ~20 s of typing) | Saved indicator → **confirmed** |
| Draft signal | URL id rewrite + reload persistence (`substack-walk4.json`: title/body read back identical) | **proven** |
| Live/publish | `Continue` button (pencraft) opens the publish flow; `Preview` beside it — **located, never clicked** (the terminal Publish control lives inside the Continue flow, not measured) | publish affordances → located at the Continue gate |
| Sidebar caveat | the file manager sidebar has its own 「Add a title...」/「Add a description...」 inputs — selector `[placeholder*="Title" i]` matches the WRONG one; anchor on `placeholder="Title"` exactly | trap recorded |

## Draft-save signal (R3) — proven end to end

Typed title + body → Saved → URL id `/publish/post/219172498` → reload read back identical title/body
(`substack-walk4.json`). Test draft (「E92 walk 21:57」) remains in the publication drafts as the artifact.

## Safety

Login, navigation, draft fill/save and reload only. `Continue`/publish flow was located and **never clicked**;
no publish dialog was opened.
