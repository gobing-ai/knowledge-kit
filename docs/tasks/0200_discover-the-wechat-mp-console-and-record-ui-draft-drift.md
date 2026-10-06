---
schema_version: 1
name: Discover the WeChat MP console and record UI draft drift
status: backlog
template: feature-impl
created_at: 2026-10-05T17:59:45.382Z
updated_at: "2026-10-06T16:50:43.775Z"
feature_id: E92

---

## 0200. Discover the WeChat MP console and record UI draft drift

### Background

The `wechatmp` publish plugin was migrated from the `wt` skills, and its entry URL, selectors and step order have never been re-measured against the live console. This task walks the real console draft-only with the operator's authenticated profile and records what the UI actually requires for each of its modes (图文草稿 (long-form and image-text)).

wechatmp has no automation guard, but its transport re-injects cookies from a saved storageState, so the walk must confirm the session survives a restart.

### Requirements

- [ ] R1. An evidence record exists for each of the four modes we support — 文章 (`createType=0`), 贴图 (`8`), 视频 (`5`), 播客 (`7`) — covering the console entry, the editor route with its session `token`, the ordered step sequence, the verified selector candidates per control, and the observed success signal.
- [ ] R2. The draft-save signal is captured per mode (the `保存为草稿` control and what it produces: toast, 草稿箱 counter, or URL), and the publish control (`发表`) is recorded without ever being activated.
- [ ] R3. Each mode's required artifacts and required fields are recorded (video file; audio plus cover for 播客; image-set rules for 贴图; title required for 文章, optional for 贴图), with the fail-fast point identified for each.
- [ ] R4. The drift list against the current `wechatmp-pub` constants is recorded per item: current value, observed value, impact on the draft path. It must cover the new-tab editor, the session `token`, the main-frame ProseMirror body, and the mode dispatch (`createType`).

### Acceptance Criteria

- [ ] AC1 — R1 — Every platform mode carries recorded UI evidence with its drift findings (req: R1, R4)
- [ ] AC2 — R4 — Discovery and tests never touch a publish control (req: R2)
- [ ] AC3 — R3 — Each mode's required artifacts and fields are recorded with their fail-fast point (req: R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Driver: the plugins' own Chromium on `~/.config/kk/browser-profiles/wechatmp`, headed, driven step by step; evidence under `.spur/run/discovery/wechatmp-*` with the curated summary at `docs/design/wechatmp-ui-discovery.md`.

Console-specific hazards already measured and to be designed around: the session `token` is embedded in every console route; creating a publishing type **opens the editor in a new tab**, so the walk must follow the newest page; the editor body is **`div.ProseMirror` in the main frame** (not the retired iframe UEditor), while the only child frame is an article preview; login is itself iframed and body-text login checks false-negative, so session state must be detected by URL/`token`.

Rail: draft-only, operator-attended, one pass; abort on any platform warning. Findings are the deliverable — plugin changes belong to the fix task 0205.

### Plan

- [ ] 0. Resolve the profile dir and confirm the session by URL/`token` (QR login is operator-interactive; never automate credentials).
- [ ] 1. Open the console home and enumerate the 新的创作 menu items; record the four supported modes and their `createType` ids.
- [ ] 2. For each mode: open the editor (following the new tab), record the route with its token, the title/author/body selectors, the image/video/audio inputs, and the bar controls.
- [ ] 3. Save ONE draft per mode (`保存为草稿`) and record the observed signal; never click `发表`.
- [ ] 4. Record the per-mode artifact/field requirements and their fail-fast points (for example a missing title for 文章, audio without a cover for 播客).
- [ ] 5. Write `docs/design/wechatmp-ui-discovery.md` with the mode table, the signal table and the drift list W1-W10; hand the items to fix task 0205.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
