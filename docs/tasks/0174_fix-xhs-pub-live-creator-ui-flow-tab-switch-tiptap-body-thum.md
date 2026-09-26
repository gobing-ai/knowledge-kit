---
schema_version: 1
name: "Fix xhs-pub live creator-UI flow: tab switch, TipTap body, thumbnail selector, closed-shadow publish bar"
status: done
template: issue
created_at: 2026-09-26T04:24:43.046Z
updated_at: "2026-09-26T06:50:14.330Z"
feature_id: E8

ac_altitude: task-local
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

- [x] R1. The driver must switch to the image-post tab before waiting for any editor: click `div.creator-tab` (containing 图文) with `force: true` (the inner `span.title` intercepts the hit-test), and treat the tab's absence as the login/UI gate rather than pre-upload `contenteditable`.
- [x] R2. Body fill must target the TipTap editor (`div.tiptap[contenteditable="true"]`), not `.ql-editor`/`#post-textarea`; the selector list keeps older variants as fallbacks.
- [x] R3. Thumbnail verification must count `img.preivew-image` (preserving XHS's spelling) so the observed count equals the ordered path count.
- [x] R4. The draft-save and publish-confirm controls must be reachable in a closed shadow root. Coordinate clicking inside a bar that also holds the live publish control is not acceptable. Either find a supported non-shadow affordance (e.g. an API/`localStorage` autosave path, a keyboard shortcut, or a documented element that outlives the custom element) or make the driver fail loud and name the limitation.
- [x] R5. Until R4 is solved, the driver must not report a draft or publish outcome it cannot observe, and `docs/04_DESIGN.md` + `docs/design/xhs-image-cards.md` must record the closed-shadow limitation with the measured evidence.
- [x] R6. A live draft run must be re-verified end-to-end on an authenticated profile, and `0167`'s verdict re-derived; E8 R4–R6 only move to `MET` from that observed run.

### Acceptance Criteria

- [x] AC1 — The image-post tab is entered before any editor wait, and its absence is the login gate (req: R1)
- [x] AC2 — The note body reaches the TipTap editor by typing, so the console registers the note (req: R2)
- [x] AC3 — Ordered-image verification counts the live preview element and still rejects a wrong count (req: R3)
- [x] AC4 — The draft and publish controls are reached through the closed shadow root by reading their label and box, never by guessing a coordinate (req: R4)
- [x] AC5 — A draft or publish outcome the driver cannot observe is reported as `ok: false` naming the step (req: R5)
- [x] AC6 — An authenticated live run creates a real draft with the ordered cards and the console counter/timestamp confirms it (req: R6)

Regression scenario:

```gherkin
Scenario: AC7 — Regression: the driver no longer waits on a pre-upload editor selector
  Given an authenticated creator console that opens on the video tab
  When the driver starts a draft publish
  Then it switches to the image-post tab first instead of timing out on a note-editor selector
  And a completed section of the first implementation's `login timeout after 120000ms` failure is not reproducible
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

The driver's selectors were written against an **assumed** XHS creator DOM and were never exercised against a live session. The first authenticated run failed with `login timeout after 120000ms` *despite a valid session*, because every assumption was wrong in a different way (measured 2026-09-25, evidence in `.spur/run/xhs-live-attempt-2026-09-25/FINDINGS.md`):

1. The console opens on the **video** tab, so the pre-upload `div[contenteditable]` / `.ql-editor` / `textarea[placeholder]` editor wait could never match — that is the observed timeout.
2. The 图文 tab was only *located*, never clicked; and the console renders it three times, where only the in-viewport instance works and its inner `span.title` intercepts the hit test (a plain click times out).
3. The image input is **hidden** behind the drop zone, so a visibility-filtered probe never saw it; the plain `input[type="file"]` fallback would have targeted the *video* input instead.
4. Uploaded previews carry XHS's own class spelling `img.preivew-image`, so the `.img-preview img` / `[class*="thumb"] img` lists matched nothing.
5. The note body is **TipTap ProseMirror** (`div.tiptap[contenteditable]`), not Quill; and the submit bar is the custom element `<XHS-PUBLISH-BTN>` whose **shadow root is closed**, so its `暂存离开` (draft) and `发布` (publish) controls are unreachable by any CSS or text selector — and the draft label itself was renamed from 存草稿.

Two further defects surfaced only once the flow reached the submit step: a `fill()` into the TipTap editor leaves the note unregistered (the save then has nothing to persist and produces no observable draft), and a submit click that lands while the note is still settling is silently dropped. Both are now handled (type + settle/retry), and the draft is confirmed only from a delta against the pre-entry baseline, because XHS autosaves uploads and a merely readable counter is not evidence of this save.

### Solution

| Concern | Where |
| ------- | ----- |
| Live-measured selector set (tab, `.jpg` file input, `img.preivew-image`, TipTap body, draft box) | `plugins/publishings/xhs-pub/src/index.ts:24-45` |
| Closed-shadow control labels (`暂存离开` draft, `发布` publish) + `ShadowControl`/`ShadowProbe` contracts | `plugins/publishings/xhs-pub/src/index.ts:53-76` |
| Seam additions: `type`, `textContent`, `clickInViewport`, `findShadowControl`, `clickAt` | `plugins/publishings/xhs-pub/src/index.ts:96-130`, `:170-220` |
| CDP resolution of the closed shadow bar (`DOM.getDocument {pierce:true}` + `DOM.getBoxModel`), injected probe | `plugins/publishings/xhs-pub/src/index.ts:228-292` |
| Injectable page opener (browser-launch failure path is testable) | `plugins/publishings/xhs-pub/src/index.ts:295-330` |
| Flow: login gate on the image tab → in-viewport force-click → attachment-probed upload → exact thumbnail count → title → **typed** body → CDP-located submit | `plugins/publishings/xhs-pub/src/index.ts:427-465` |
| Draft confirmation from a baseline delta (counter moved, or a new `保存于<timestamp>`), settle + bounded retry, fail loud otherwise | `plugins/publishings/xhs-pub/src/index.ts:466-497` |
| Publish path: single click, no retry, duplicate-post warning when unobserved | `plugins/publishings/xhs-pub/src/index.ts:500-506` |
| Documented live contract + verification state | `docs/04_DESIGN.md:500`, `docs/design/xhs-image-cards.md:25-29` |
| Tests: fake faithful to the live console (attached-but-invisible input, editor only once open, legacy thumbnail classes match nothing, silent save closes the editor) + 41 tests | `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — image-post tab entered before any editor wait; its absence is the login gate | MET | plugins/publishings/xhs-pub/src/index.ts:433-448 (waitUntil on SELECTORS.imageTab as the gate, then in-viewport force-click); tests: plugins/publishings/xhs-pub/tests/xhs-pub.test.ts "live console contract…" asserts clickInViewport precedes setInputFiles; mutant C (pre-upload editor wait) → 17 fail |
| R2 — note body reaches TipTap by typing, not value-set | MET | src/index.ts:410-424 (click + type with delay, fill only as a seam fallback); tests assert a `type` op on `div.tiptap[contenteditable="true"]` and no `fill` on it; the seam-without-typing test proves an untyped body cannot confirm a draft |
| R3 — ordered-image verification counts the live preview element and still rejects a wrong count | MET | src/index.ts:27 (thumbnail: img.preivew-image), :40 SELECTORS.fileInput accept .jpg; exact-count assertion :457-465; mutant B (legacy selector) → 15 fail; fake returns 0 for legacy classes |
| R4 — draft/publish controls reached through the closed shadow root by reading label + box | MET | src/index.ts:53-62 (SHADOW_CONTROLS, draft = 暂存离开), :237-275 (CDP DOM.getDocument pierce:true + DOM.getBoxModel), :380-400 clickShadowControl; live run .spur/run/xhs-live-preflight/result.draft8.json: draftControl 暂存离开, draftClick "556,675", draftAttempts 1 |
| R5 — an unobserved draft/publish outcome is reported ok:false naming the step | MET | src/index.ts:466-484 draft confirmation requires a baseline delta (counter moved or a new 保存于 stamp); mutants D/E/G killed (37/3, 39/1, 39/1 fail); publish path :500-506 fails loud with the duplicate-post warning; no CDP → :386-390 fails loud rather than clicking blind |
| R6 — an authenticated live run creates a real draft and the console confirms it | MET | .spur/run/xhs-live-preflight/result.draft8.json → ok:true, driver script, publishStatus draft, imageCount 4, draftCountBefore 18 → draftCountAfter 19, one click attempt; content.json carries the 4 ordered cards |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The image-post tab is entered before any editor wait (req: R1) | MET | test | bun test plugins/publishings/xhs-pub/tests → 41 pass / 0 fail; order assertions in the live-console-contract test |
| AC2 — The note body reaches the TipTap editor by typing (req: R2) | MET | test | typing assertion + the no-typing seam test (draft confirmation fails loud) |
| AC3 — Ordered-image verification counts the live preview element (req: R3) | MET | test | mutant B killed (15 fail) |
| AC4 — Controls reached through the closed shadow root without guessing a coordinate (req: R4) | MET | command | CDP probe tests (createShadowProbe with canned sessions, nested shadow roots, non-button label ignored); live draftClick 556,675 read from the box model |
| AC5 — An unobserved outcome is reported as ok:false naming the step (req: R5) | MET | test | counter-only positive/moved/unmoved/no-baseline tests; mutants D/E/G killed |
| AC6 — A live authenticated run creates a real draft the console confirms (req: R6) | MET | command | result.draft8.json (ok:true, 18 → 19) — an operator-approved draft-only live run |
| AC7 — Regression: no pre-upload editor-selector wait (req: R1) | MET | test | mutants C (17 fail) and C1 (17 fail) killed; the fake exposes editor selectors only once the editor is open |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-09-26T06:50:14.330Z todo → done (system)

