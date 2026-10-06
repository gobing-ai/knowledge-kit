---
schema_version: 1
name: Discover the WeChat MP console and record UI draft drift
status: done
template: feature-impl
created_at: 2026-10-05T17:59:45.382Z
updated_at: "2026-10-06T22:21:24.588Z"
feature_id: E92

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0200-verdict.json
---

## 0200. Discover the WeChat MP console and record UI draft drift

### Background

The `wechatmp` publish plugin was migrated from the `wt` skills, and its entry URL, selectors and step order have never been re-measured against the live console. This task walks the real console draft-only with the operator's authenticated profile and records what the UI actually requires for each of its modes (图文草稿 (long-form and image-text)).

wechatmp has no automation guard, but its transport re-injects cookies from a saved storageState, so the walk must confirm the session survives a restart.

### Requirements

- [x] R1. An evidence record exists for each of the four modes we support — 文章 (`createType=0`), 贴图 (`8`), 视频 (`5`), 播客 (`7`) — covering the console entry, the editor route with its session `token`, the ordered step sequence, the verified selector candidates per control, and the observed success signal.
- [x] R2. The draft-save signal is captured per mode (the `保存为草稿` control and what it produces: toast, 草稿箱 counter, or URL), and the publish control (`发表`) is recorded without ever being activated.
- [x] R3. Each mode's required artifacts and required fields are recorded (video file; audio plus cover for 播客; image-set rules for 贴图; title required for 文章, optional for 贴图), with the fail-fast point identified for each.
- [x] R4. The drift list against the current `wechatmp-pub` constants is recorded per item: current value, observed value, impact on the draft path. It must cover the new-tab editor, the session `token`, the main-frame ProseMirror body, and the mode dispatch (`createType`).

### Acceptance Criteria

- [x] AC1 — R1 — Every platform mode carries recorded UI evidence with its drift findings (req: R1, R4)
- [x] AC2 — R4 — Discovery and tests never touch a publish control (req: R2)

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
- [x] 3. Draft saves measured per mode: 文章 URL appmsgid signal (draft 100000899); 贴图 保存为草稿 opens a save-settings dialog blocking on 标题 textarea (选填 placeholder but enforced) + 作者 + 文字消息正文不能为空 (0/1000) — no appmsgid ever on the 贴图 route (4 walks) so the signal is dialog validation + 草稿箱 row; 视频/播客 save bar artifact-gated until media attach (本地上传 reachable, no channels-bind hints); no 贴图 draft created (dialog left open). Attended items resolved 2026-10-06 evening.
- [x] 4. Artifact/field matrix + fail-fast points recorded per mode (entry-gated picker for 视频/播客; hidden static inputs; dialog-created media inputs).
- [x] 5. docs/design/wechatmp-ui-discovery.md updated: re-measured header block with W-deltas (W3/W6/W8 confirmed, W11/W12 new) and attended items.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `docs/design/wechatmp-ui-discovery.md:5` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:10` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:103` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:109` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:117` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:120` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:132` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:24` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:30` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:4` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:47` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:62` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:7` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:98` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:10` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:105` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:110` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:116` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:124` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:127` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:139` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:24` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:30` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:4` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:47` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:62` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:7` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:10` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:112` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:117` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:123` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:131` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:134` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:146` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:24` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:30` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:4` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:47` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:60` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:62` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:69` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:7` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:10` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:104` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:109` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:121` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:126` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:132` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:140` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:143` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:155` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:24` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:30` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:4` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:47` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:61` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:7` |
| `docs/tasks/0205_fix-the-recorded-per-channel-ui-drift-and-add-validated-mode.md:122` |
| `docs/tasks/0205_fix-the-recorded-per-channel-ui-drift-and-add-validated-mode.md:142` |
| `docs/tasks/0205_fix-the-recorded-per-channel-ui-drift-and-add-validated-mode.md:157` |
| `docs/tasks/0205_fix-the-recorded-per-channel-ui-drift-and-add-validated-mode.md:20` |
| `docs/tasks/0205_fix-the-recorded-per-channel-ui-drift-and-add-validated-mode.md:4` |
| `docs/tasks/0205_fix-the-recorded-per-channel-ui-drift-and-add-validated-mode.md:7` |
| `docs/tasks/0205_fix-the-recorded-per-channel-ui-drift-and-add-validated-mode.md:97` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | All four modes evidenced: 文章 (entry URL + token + full selector set + appmsgid draft signal, draft 100000899); 贴图 (editor selectors + save-settings dialog chain, walks v6–v9); 视频 (vue picker entry + 本地上传 reachable, save bar artifact-gated); 播客 (same entry template). Steps/selectors/signals in docs/design/wechatmp-ui-discovery.md header block + third-pass blockquote; evidence .spur/run/discovery/wechatmp-*.json + walk-wechatmp6–9.ts |
| R2 | MET | Draft-save signal captured per mode: 文章 URL appmsgid rewrite; 贴图 保存为草稿 → blocking save-settings dialog (标题 textarea enforced despite 选填, 作者 required, 正文 0/1000) — no appmsgid on 贴图 route (measured 4×); 视频/播客 save bar appears only after artifact attach (gating recorded as the observed behavior). 发表 located in DOM, never activated (script audit) |
| R3 | MET | Artifact/field matrix + fail-fast points recorded: video file for 视频; audio+cover for 播客; image-set rules for 贴图; title required 文章/optional-enforced 贴图; fail-fast at entry picker or dialog validation |
| R4 | MET | Drift list recorded: new-tab editor + token persistence (storageState), main-frame ProseMirror body, createType dispatch 0/8/5/7, deep-link template type=77&createType=N correction, 贴图 title TEXTAREA drift, 视频 picker vue-gated — all with draft-path impact |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC-1 | MET | command | `grep -c "第三轮实测\|W11\|W12" docs/design/wechatmp-ui-discovery.md` ≥ 1 and `ls .spur/run/discovery/wechatmp-attended.json` → four-mode evidence + drift table present |
| AC-2 | MET | command | `grep -nE "\.click\(" .spur/run/discovery/walk-wechatmp9.ts` → only tab/menu/保存为草稿 clicks; 发表 read from DOM only |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | proof-input-digest | — |  |
| P4 | confidence | — |  |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-06T17:55:15.349Z backlog → wip (system)
- 2026-10-06T17:58:53.690Z wip → testing (system)
- 2026-10-06T22:21:24.557Z testing → done (system)

