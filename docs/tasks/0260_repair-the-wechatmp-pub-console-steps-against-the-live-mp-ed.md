---
schema_version: 1
name: Repair the wechatmp-pub console steps against the live MP editor
status: backlog
template: standard
created_at: 2026-10-12T02:23:38.506Z
updated_at: "2026-10-12T02:23:49.939Z"

---

## 0260. Repair the wechatmp-pub console steps against the live MP editor

### Background

Live console walk on 2026-10-11/12 (MP 草稿箱 empty after the 04:30 tick; the daily run's MP draft failed
four times with `click: Timeout 30000ms exceeded` on `保存为草稿`). The DOM inventory captured at the
failure — added to the plugin that day (`runMode` diagnostics in `plugins/publishings/wechatmp-pub/src/flow.ts`)
— named the blocking modal and the steps that never landed:

- `one-key layout`: `一键排版` was clicked but no `匹配目标格式` option appeared.
- `cover`: the open cover panel did not offer `从图片库选择` (`a.js_imagedialog` / its label) — the draft kept
  the platform default, and the panel stayed open until `saveDraft` closed every modal it found
  (commit `8791adc9`). The entry may have moved in the console UI; the panel selectors come from the
  2026-10-10 operator walk (`flow.ts:68-96`).
- `原创声明`: `dialog did not close` after the step.
- `赞赏`: the confirm click timed out because the open dialog had no `确认`/`确定` to click.
- `原文链接`: `no URL field in the 原文链接 dialog`.
- `创作来源`: `未生效，请手动设置` (the `#js_claim_source_area input:checked` probe stayed false).
- `音频`: the `插入音频` picker (`weui-desktop-dialog__wrp align_edge audio_dialog js_audio_music_dialog`)
  listed existing materials but its `上传音频` control never accepted a click; that dialog's footer covered
  `保存为草稿` for the full 30 s budget (the actual cause of the missing draft).

Commits `8791adc9` (close every modal before the draft save, dismiss the cover panel on its own failure
path) made the draft save; every enrichment above is still unapplied, and the MP console reports
`图文内容不完整 请补充封面图、标题或者正文` on the saved draft.

### Requirements

- [ ] R1. The `cover` step sets the episode cover on a fresh draft through the control the live v2 editor actually offers, and a panel that cannot complete is closed before the step returns (no leaked modal).
- [ ] R2. The `audio` embed uploads the episode MP3 through the `插入音频` picker's live control and attaches it as the audio material, or records an explicit unavailability instead of leaving the dialog open.
- [ ] R3. `原创声明`, `赞赏`, `原文链接` and `创作来源` each commit their setting on the live editor, proven by a post-step DOM re-read, and a step that cannot commit says so in the result's `enrichWarnings` without leaving a modal open.
- [ ] R4. The MP console's own completeness notice (`图文内容不完整 请补充封面图、标题或者正文`) is clear on a full daily draft — cover, title, body and audio all present.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
