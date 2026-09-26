---
schema_version: 1
name: "Fix xhs-pub live creator-UI flow: tab switch, TipTap body, thumbnail selector, closed-shadow publish bar"
status: todo
template: issue
created_at: 2026-09-26T04:24:43.046Z
updated_at: "2026-09-26T04:24:58.101Z"
feature_id: E8

---

## 0174. Fix xhs-pub live creator-UI flow: tab switch, TipTap body, thumbnail selector, closed-shadow publish bar

### Background

A live, authenticated run of the shipped `xhs-pub` script driver against the real Xiaohongshu creator console (2026-09-25, account 冰原奔狼) failed with `login timeout after 120000ms` **despite a valid session**. The session was confirmed good (creator console loaded, `草稿箱(0)` visible, 18 `creator.xiaohongshu.com` cookies). The failure is therefore a UI-contract mismatch, not an auth problem: every selector the driver depends on was written against an assumed DOM that the live console does not match.

This is the last blocker for E8 scenarios R4/R5 (`0167` is `PARTIAL`; the done gate errors on R4–R6). Full evidence: `.spur/run/xhs-live-attempt-2026-09-25/FINDINGS.md`, `.spur/run/xhs-live-preflight/` (`result.draft.json` = the failing run, `draft.log`, `content.json`).

Measured live DOM vs the driver's assumptions:

| # | Driver assumes | Live console (measured) | Impact |
| --- | --- | --- | --- |
| 1 | the editor exists right after `goto` | the page opens on the **video** tab; `div[contenteditable]`, `.ql-editor`, `textarea[placeholder]` all match **0** | this is the observed `login timeout` |
| 2 | `SELECTORS.imageTab` is only *located*, never clicked | the 图文 tab is `div.creator-tab`; its `span.title` child intercepts the hit-test, so a plain click never lands — `click({force:true})` works and yields `?from=tab_switch` | the image tab is never entered |
| 3 | note body is `div[contenteditable].ql-editor` / `#post-textarea` | body is **TipTap ProseMirror**: `DIV.tiptap[contenteditable="true"]` (single match) | body fill cannot work |
| 4 | thumbnails via `.img-preview img` / `[class*="preview"] img` | uploaded cards render as `img.preivew-image` (XHS's own typo) inside `.content-center-image-container`, exactly N=4 | thumbnail count check cannot work |
| 5 | draft/publish are `button:has-text("存草稿")` / `text=发布` | the action bar is the custom element **`<XHS-PUBLISH-BTN>`** (sticky, 680×90 at y=810) whose **shadow root is closed** (`shadowRoot === null`); no such label exists in the light DOM | draft save and publish confirmation are **unreachable by any selector** |

`input[placeholder*="标题"]` is the only selector that matched correctly.

A manual sequence was verified working up to the submit step: force-click the 图文 tab → `input[type="file"][accept*=".jpg"]` + `setInputFiles` → 4 `img.preivew-image` present → fill title → type body in `div.tiptap`. The submit step was deliberately **not** attempted: the only remaining route is coordinate clicking inside a bar that also contains the live 发布 control, and a mis-aimed click would publish publicly outside the accepted draft-only scope.

### Requirements

- [ ] R1. The driver must switch to the image-post tab before waiting for any editor: click `div.creator-tab` (containing 图文) with `force: true` (the inner `span.title` intercepts the hit-test), and treat the tab's absence as the login/UI gate rather than pre-upload `contenteditable`.
- [ ] R2. Body fill must target the TipTap editor (`div.tiptap[contenteditable="true"]`), not `.ql-editor`/`#post-textarea`; the selector list keeps older variants as fallbacks.
- [ ] R3. Thumbnail verification must count `img.preivew-image` (preserving XHS's spelling) so the observed count equals the ordered path count.
- [ ] R4. The draft-save and publish-confirm controls must be reachable in a closed shadow root. Coordinate clicking inside a bar that also holds the live publish control is not acceptable. Either find a supported non-shadow affordance (e.g. an API/`localStorage` autosave path, a keyboard shortcut, or a documented element that outlives the custom element) or make the driver fail loud and name the limitation.
- [ ] R5. Until R4 is solved, the driver must not report a draft or publish outcome it cannot observe, and `docs/04_DESIGN.md` + `docs/design/xhs-image-cards.md` must record the closed-shadow limitation with the measured evidence.
- [ ] R6. A live draft run must be re-verified end-to-end on an authenticated profile, and `0167`'s verdict re-derived; E8 R4–R6 only move to `MET` from that observed run.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace): `- [ ] AC1 — <feature scenario title without its R-number>` bullets or `Scenario: AC1 — <title>` blocks; add `(req: R<n>)` to bind a task requirement; task-only checks go in prose below, or set `ac_altitude: task-local`. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
