# xhs console UI discovery (task 0199) — COMPLETE for all four modes

Method: the plugins' own Chromium (Playwright 1.55 build) on the real profile dir
`~/.config/kk/browser-profiles/xhs`, headed, driven by `.spur/run/discovery/xhs-walk.ts` and
`.spur/run/discovery/xhs-probe-shadow.ts`. Operator attended; login was completed in-window (the
stored session had expired). **Draft-only:** no publish control was clicked; exactly **one** draft
was saved (to observe the signal) and it is named `kk-discovery-draft-2 请忽略` for deletion.
Raw evidence: `.spur/run/discovery/xhs-*.{json,png}`.

## 1. Console shape

| Element | Verified value |
| --- | --- |
| Console entry | `https://creator.xiaohongshu.com/publish/publish` |
| Default mode on load | **上传视频** (`.creator-tab.active`) |
| Mode tabs | `div.creator-tab > span.title`; labels 上传视频 / 上传图文 / 写长文 / 发播客 |
| Mode switch | in-page state; the URL only gains `?from=tab_switch` — **modes are not deep-linkable** |
| Second entry point | top-left `div.btn-wrapper` → `发布笔记` (`publish-video`), a mode dropdown |
| Tab readiness | the tab set mounts **late and varies**; clicking on a timer produced `no real node` for 写长文, succeeding only after waiting for ≥4 on-screen non-hidden `.creator-tab` |

**Selector trap.** Every tab renders duplicate nodes: an `aria-hidden="true"` clone carrying
`data-hp-kind="creator-tab-<label>"` / `button-hp-installed="1"`, plus at least one clone laid out
far off-viewport (`x=-9726, y=-9918`). Measured consequences:
`.creator-tab:has-text("上传图文").first()` → 30 s hang (binds to the off-screen clone);
`.creator-tab:not([aria-hidden="true"])` alone is still insufficient (first match can be off-screen).
**Working strategy:** wait for tab readiness → iterate candidates → take the first box with
`x >= 0 && y >= 0` → real mouse click at its centre. Verified for 上传图文, 上传视频, 写长文, 发播客.

## 2. Per-mode flows (all four verified)

| Mode | Landing / entry | Controls (verified) | Save vs publish |
| --- | --- | --- | --- |
| 上传视频 | video dropzone; `input[type=file].upload-input` `accept=".mp4,.mov,.flv,.f4v,.mkv,.rm,.rmvb,.m4v,.mpg,.mpeg,.ts"`, `multiple=false` | after upload: **ProseMirror** note editor (`div.tiptap.ProseMirror`) with `重新生成` / `应用` / `话题` / `用户` / `表情` / `更多` / `关联` | action bar not in the light DOM (closed shadow, as §3) |
| 上传图文 | image grid **≤18**, `input[type=file].upload-input` `accept=".jpg,.jpeg,.png,.webp"`, `multiple=true`; `获取封面建议` | title `input.d-text[placeholder="填写标题会有更多赞哦"]` (two more `input.d-text.--color-text-title` exist); body `div.tiptap.ProseMirror[role=textbox]` with **CSS-only placeholder** (`data-placeholder: null`) and a **0/1000** counter; `# 话题` / `@ 用户` / `表情` / `智能标题`; `内容设置`; `定时发布` (`div.custom-switch-card`); `笔记预览` / `封面预览` | **`暂存离开`** = `BUTTON.ce-btn.white` (closed shadow) · **`发布`** = `BUTTON.ce-btn.bg-red` |
| 写长文 | landing offers `新的创作` and **`导入链接`** (import-from-link) | `新的创作` opens an **in-page ProseMirror editor** (`div.tiptap.ProseMirror.ProseMirror-focused`) with `暂存离开` and `一键排版` — here `暂存离开` **is in the light DOM** | same labels, different DOM context than 图文 |

**写长文 decided (operator, 2026-10-05): author in place from the raw markdown — `导入链接` is excluded.** The link-import path is fed from a 公众号/wechatmp source, so using it would put another platform's publishing and censorship step in the critical path before xhs ever sees the content. The plugin inserts the Content body directly into the ProseMirror editor (the `一键排版` affordance is what then formats pasted markdown).
| 发播客 | landing: `上传音频` / `添加RSS订阅` / `查看` / `管理`; no file input until the modal | `上传音频` opens a **modal** (`d-modal d-modal-centered … creator-modal-sty`) with `input[type=file]` for **audio** (`accept=".mp3,.wav,.aac,.flac,.m4a"`) **and cover image** (`.jpg,.jpeg,.png,.webp`); buttons `取消` / `去发布` | modal-driven; **RSS path excluded by the operator (2026-10-05)** — audio upload is the mode |

## 3. The action bar is in a CLOSED shadow root (mode-dependent)

| Probe on the 图文 action bar | Result |
| --- | --- |
| Playwright locators (`button:has-text("暂存离开")`, same for 发布) | **count 0** |
| Walk of every **open** shadow root (document → `el.shadowRoot` recursion) | `rootCount: 1`, **0 matches** |
| **CDP `DOM.getDocument({depth:-1, pierce:true})`** | **finds both**: `BUTTON.ce-btn.white` = 暂存离开, `BUTTON.ce-btn.bg-red` = 发布 |

This confirms the plugin's own comment (`plugins/publishings/xhs-pub/src/index.ts:59-62`: the submit
bar is `<XHS-PUBLISH-BTN>` with `shadowRoot === null`), and adds the mode-dependence: in **写长文**
the same `暂存离开` label is reachable in the light DOM. So a channel implementation must resolve
labels through CDP (or try both), never through CSS/text alone.

**Cross-channel consequence:** `packages/publish-harness/src/browser.ts` has **no** shadow/CDP
support (`grep -E "shadow|pierce"` → empty). The capability is plugin-local to `xhs-pub`; the four
new channels (0185–0188) have none, and whether they need it is what their walks must answer.

## 4. The draft-save signal (verified end to end)

CDP-pierced click on `BUTTON.ce-btn.white` (`nodeId 1399`) via `DOM.getBoxModel` +
`Input.dispatchMouseEvent` at the box centre (557, 662):

| Observed | Value |
| --- | --- |
| Toast | **`保存成功`** |
| Sidebar | **`草稿箱(30)`** — the drafts counter |
| URL | **unchanged** (`…/publish/publish?from=tab_switch`) |

**Therefore the draft signal is the toast + the 草稿箱 counter, NOT a URL change.** Any flow that
probes for a URL change on draft save reports a false failure.

## 5. Drift list vs the current `xhs-pub` constants (fix candidates for task 0205)

| # | Drift item | Evidence | Impact |
| --- | --- | --- | --- |
| D1 | Mode assumed to be 图文 at one publish URL; the console loads **上传视频** and modes are tab/dropdown state, not URL | §1 | every other mode unreachable; 图文 needs an explicit switch |
| D2 | Draft affordance mis-named (expects a 存草稿-style control; the real label is **暂存离开**) | §2 | no draft save; wrong control targeted |
| D3 | Body placeholder is not an attribute (`data-placeholder: null`) | §2 | placeholder-based readiness checks can never match |
| D4 | Title located by class alone is ambiguous (`input.d-text` ×3) | §2 | mis-targeted fill |
| D5 | Tab clicks bind to `aria-hidden`/off-screen clones; the tab set mounts late | §1 | 30 s hangs, flaky mode switches |
| D6 | The 图文 action bar is in a **closed** shadow root; the shared harness has no CDP/shadow capability | §3 | a shared-lib channel cannot reach its save/publish controls |
| D7 | No documented per-mode constraints (18-image cap; 1000-char 图文 body; audio+cover for 播客; single video file) | §2 | Content cannot fail fast before a browser opens |
| D8 | Draft signal is a toast + 草稿箱 counter, **not** a URL change | §4 | mis-implemented signal ⇒ false failures |
| D9 | Mode-dependent DOM context for the same label (`暂存离开` light DOM in 写长文, closed shadow in 图文) | §2, §3 | a single lookup strategy cannot serve all modes |
| D10 | 写长文 offers **`导入链接`** (link-import authoring) alongside in-place authoring | §2 | **DECIDED 2026-10-05: in-place only.** Link-import depends on first publishing to a 公众号, which adds another platform + its censorship wait; the plugin inserts the raw markdown body directly |
| D11 | 发播客's RSS-subscription path exists but is **excluded** by decision | §2 | record the exclusion, don't implement |

## 6. Budget / safety

- ADR-025 caps `check` and `publish` at 1 per 2 h; the walk is not guard-counted, so it was held to
  **one attended pass**, draft-only, aborting on any anti-automation warning (**none appeared**).
  `check` was consumed at 2026-10-05T17:52Z; the `publish` budget is untouched.
- One draft was created for signal capture: `kk-discovery-draft-2 请忽略` (2 images) — delete from
  草稿箱.
- The session now persists in the real profile dir, so the plugin can use it directly.

## 7. Status

Discovery for **0199 is complete** (all four modes + the draft signal). Remaining work is the
reconciliation of D1–D11 into fix task **0205**, and the same walk for 0200–0204.
