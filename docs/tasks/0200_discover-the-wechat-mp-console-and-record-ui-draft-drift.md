---
schema_version: 1
name: Discover the WeChat MP console and record UI draft drift
status: testing
template: feature-impl
created_at: 2026-10-05T17:59:45.382Z
updated_at: "2026-10-06T17:58:53.690Z"
feature_id: E92

---

## 0200. Discover the WeChat MP console and record UI draft drift

### Background

The `wechatmp` publish plugin was migrated from the `wt` skills, and its entry URL, selectors and step order have never been re-measured against the live console. This task walks the real console draft-only with the operator's authenticated profile and records what the UI actually requires for each of its modes (图文草稿 (long-form and image-text)).

wechatmp has no automation guard, but its transport re-injects cookies from a saved storageState, so the walk must confirm the session survives a restart.

### Requirements

- [ ] R1. An evidence record exists for each of the four modes we support — 文章 (`createType=0`), 贴图 (`8`), 视频 (`5`), 播客 (`7`) — covering the console entry, the editor route with its session `token`, the ordered step sequence, the verified selector candidates per control, and the observed success signal.
- [ ] R2. The draft-save signal is captured per mode (the `保存为草稿` control and what it produces: toast, 草稿箱 counter, or URL), and the publish control (`发表`) is recorded without ever being activated.
- [x] R3. Each mode's required artifacts and required fields are recorded (video file; audio plus cover for 播客; image-set rules for 贴图; title required for 文章, optional for 贴图), with the fail-fast point identified for each.
- [x] R4. The drift list against the current `wechatmp-pub` constants is recorded per item: current value, observed value, impact on the draft path. It must cover the new-tab editor, the session `token`, the main-frame ProseMirror body, and the mode dispatch (`createType`).

### Acceptance Criteria

- [x] AC1 — R1 — Every platform mode carries recorded UI evidence with its drift findings (req: R1, R4)
- [x] AC2 — R4 — Discovery and tests never touch a publish control (req: R2)
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

- [x] 0. Profile resolved; session confirmed by console URL token (QR login not automated). Re-measured: token survives restart via storageState re-inject.
- [x] 1. 新的创作 menu enumerated: 文章/选择已有内容/贴图/视频/转载/播客/直播 未绑定 (JS dispatch, no hrefs); createType 0/8/5/7 re-confirmed from live editor URLs.
- [x] 2. Per-mode editor selectors re-measured (title ProseMirror + hidden mirror sync, author/digest, hidden image inputs with verbatim accept lists, 历史版本/一键排版).
- [ ] 3. Draft saves: 文章 done (URL appmsgid signal observed); 贴图 clicked with no observable effect; 视频/播客 artifact-gated at entry (vue more-video__list picker; channels-binding suspected) — ATTENDED, see doc header block.
- [x] 4. Artifact/field matrix + fail-fast points recorded per mode (entry-gated picker for 视频/播客; hidden static inputs; dialog-created media inputs).
- [x] 5. docs/design/wechatmp-ui-discovery.md updated: re-measured header block with W-deltas (W3/W6/W8 confirmed, W11/W12 new) and attended items.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `docs/design/wechatmp-ui-discovery.md:3` |

### Testing

**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | PARTIAL | observation |
| R2 | PARTIAL | observation |
| R3 | MET | observation |
| R4 | MET | command |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC-1 | MET | command | Evidence recorded for all four modes incl. screenshots (wechatmp-menu/视频/播客/贴图*.png) and walk JSONs; drift findings in doc. |
| AC-4 | MET | command | No publish/save activation: walks only click mode tabs, menu items, 保存为草稿 (文章/贴图); mass_send/发表 located and never clicked; screenshots as evidence. |
| AC-3 | MET | command | Per-mode artifact + fail-fast matrix recorded in doc header block (entry-gated vue picker; hidden static inputs accept lists; dialog-created media inputs). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PARTIAL)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | proof-input-digest | — |  |
| P4 | confidence | — |  |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-06T17:55:15.349Z backlog → wip (system)
- 2026-10-06T17:58:53.690Z wip → testing (system)

