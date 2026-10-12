---
schema_version: 1
name: Repair the wechatmp-pub console steps against the live MP editor
status: backlog
template: standard
created_at: 2026-10-12T02:23:38.506Z
updated_at: "2026-10-12T04:56:00.047Z"

ac_altitude: task-local
ac_numbering: task-local
---

## 0260. Repair the wechatmp-pub console steps against the live MP editor

### Background

The operator reported failures in the daily 文章 draft enrichment on 2026-10-11/12:
cover selection, audio upload, 原创声明, 赞赏, 原文链接 and 创作来源. A leaked audio dialog
blocked 保存为草稿. Commit `8791adc92077bc2ea98dd39848b08f6fece8a5a5` records a subsequent
successful draft save (20261011, 更新于 18:51); that proves a save checkpoint, not successful
enrichment. Its current code closes dialogs before saving and carries compose diagnostics on
submit exceptions. The reported incomplete-draft notice needs a new, title-keyed live observation
before it can be treated as the state of a current draft.

**Refine corrections (2026-10-11)**

- “Four failed runs” → the cited commit describes three runs; no incident run artifact was supplied → retain the failure as an operator report without asserting an independently verified count.
- “Every enrichment remains unapplied” → code and the commit do not prove that universal live state → distinguish reported misses from verified implementation defects; 合集 is not reported broken.
- “The cover image was uploaded before cover selection” → `composeArticle` calls `setCover` before `enrichArticleDraft` uploads audio → make the image-library dependency explicit and repair ordering without assuming the newest library item is this episode's image.
- “Settings are commit-verified” → 原创/赞赏/原文链接 only test dialog closure; 创作来源 tests any checked input, not the requested value → require value-specific committed-state reads, including undefined/error outcomes.
- “Audio upload detects its file inputs” → `trySelectors` defaults to visibility; upload inputs may be hidden, and this module already has `findAttachedSelector` → use attached-input detection within the active upload form.
- “Cover success proves the image is set” → `setCover` returns success after confirm with no committed-cover read → add identity-aware cover verification; preserve the warning contract on a miss.
- “Failures cannot leak dialogs” → audio catch returns without cleanup; settings' dialog-not-closed warning does not sweep before the next setting; submit cleanup is best-effort → cleanup and re-read belong at each step boundary, with explicit residual-modal diagnostics.
- “Completeness includes audio” → discovery §5 documents MP's completeness gate as cover/title/body → independently verify the requested audio identity and top placement; do not use the platform notice to infer audio success.
- “Existing tests verify DOM behavior” → `recordingPage` returns queued evaluate values and reports every selector visible → retain orchestration tests but add real DOM fixture tests executing the production scripts.
- “Existing discovery freezes the live controls” → the 2026-10-10 note explicitly leaves upload inner controls as candidates; §5.2 leaves cover-widget selection unresolved → current selector/state mapping is a readiness blocker, not an implementer guess.
- “Design docs describe the current rail” → `docs/04_DESIGN.md` still mentions toast confirmation and post-save enrichment, whereas code uses the title-keyed 草稿箱 stamp and pre-save enrichment → sync the touched channel documentation during implementation via the documentation process.

Audit basis: current checkout `3562c6c0`; `flow.ts`, `enrich.ts`, `page.ts`, their tests,
`plugins/kk/scripts/daily-stages.ts`, ADR-026/029 and the existing UI discovery document.
No fresh live console measurement or full-episode replay was performed during refinement.

### Requirements

- [ ] R1. On a fresh 文章 draft with an episode cover, both existing `coverSource` modes select the intended image and verify committed cover identity. Failed cover selection emits a `metadata.warnings` entry and closes its picker, or explicitly reports an unclosable picker.
- [ ] R2. With valid audio metadata, reuse the exact episode material or upload its MP3, cover and title, acknowledge the service rules, save the material and insert that material at the body start. Verify identity and placement. Missing controls, unavailable account capabilities, upload failures and unverifiable outcomes emit `metadata.enrichWarnings`; no unrelated first material may be inserted.
- [ ] R3. Requested 原创声明, 赞赏, 原文链接 and 创作来源 settings are verified against committed state and requested values after each step. Dialog closure alone is insufficient. Missing, false, undefined or throwing verification is a named `enrichWarnings` outcome. Retain existing 合集 behavior and isolate each step's cleanup before the next setting runs.
- [ ] R4. A full-episode draft with all capabilities available has the intended cover, title, body and audio after save/reopen, and its title-keyed 草稿箱 entry has no cover/title/body completeness notice. Audio success is checked independently. An unavailable enrichment remains a warning and does not fabricate full-completeness evidence or prevent an otherwise valid draft save.

Scope: repair the existing 文章 rail, its callers, regression fixtures and channel documentation.
No new CLI flags, metadata fields, dependencies, plugin operations or public API. No repair of
一键排版, account entitlement/verification, or unrelated daily pipeline behavior. Preserve draft
defaults, the explicit public-publish boundary, other operation flows and the no-repeat publish rule.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Requested episode cover is committed in each existing source mode (req: R1)
  Given a fresh article and fixtures for library and body cover selection
  When the production cover flow chooses the requested image and confirms
  Then a committed-cover read identifies that image rather than just a closed dialog
  And an absent or mismatched committed cover produces a cover warning

Scenario: AC2 — Audio upload accepts hidden inputs and inserts the intended material (req: R2)
  Given a picker with no matching episode and hidden audio and cover file inputs
  When production upload runs against the active form
  Then the intended files, title and acknowledgement reach that form
  And the saved material is matched by episode identity rather than by first-row order
  And its audio node is verified at the body start

Scenario: AC3 — Existing audio material is reused without another upload (req: R2)
  Given a picker containing the exact episode plus unrelated materials
  When audio insertion runs
  Then only the exact episode is inserted and no file upload occurs

Scenario: AC4 — Settings success requires committed requested values (req: R3)
  Given fixtures for original, reward, original URL and creation source
  When a setting dialog closes without committing or its verification is unavailable
  Then the affected setting produces a named enrichment warning
  And only the requested committed state can produce success
  And an already enabled switch is not toggled off by the bounded retry

Scenario: AC5 — Failed enrichment releases its dialogs before subsequent work (req: R1, R2, R3)
  Given a cover, audio or settings failure at any open, upload, confirm or verify stage
  When that step returns
  Then its dialog is closed before the next step or an explicit residual-modal diagnostic is recorded
  And a closable modal cannot block the draft-save click
  And an unclosable modal cannot become a false save success

Scenario: AC6 — Full daily draft survives save and reopen (req: R4)
  Given one attended fresh article with valid daily metadata and available account capabilities
  When the repaired rail saves once and reopens its title-keyed draft
  Then the intended cover, title, body and audio are present
  And the draft has no cover/title/body completeness notice
  And no publish control was activated

Scenario: AC7 — Optional enrichment failure preserves the draft contract (req: R4)
  Given an unavailable audio or settings capability with otherwise valid article content
  When the article is saved
  Then a fresh title-keyed draft stamp may establish draft success with named warnings
  And the warnings do not imply full episode completeness
```

AC1–AC5 and AC7: `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts` for caller/order/result
behavior plus `plugins/publishings/wechatmp-pub/tests/wechatmp-dom.test.ts` (new) for real Playwright
DOM fixtures executing production evaluate scripts through `wrapPlaywrightPage`.
AC6: attended draft-only replay with sanitized evidence under `.spur/run/refine-0260/live/`;
the implementation Testing section must point to retained evidence. Offline fixtures alone cannot pass AC6.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-12T04:55:58.366Z

- Closed: keep scope to the six reported enrichment steps; layout repair is excluded because it has no original requirement and needs its own measured behavior.
- Closed: keep existing metadata, function signatures and result warning channels; optional enrichment failure still permits a verified draft save.
- Closed: platform completeness covers cover/title/body; audio has its own identity/placement evidence.
- Closed: regression AC are task-local. No automatic feature-link assignment; the existing missing-feature warning remains visible.
- Deferred with owner: this task's next ready-refinement pass must measure and freeze the live control/commit-state mapping before promotion. This is a readiness blocker, not a decision delegated to implementation.

### Design

#### Boundaries and existing seams

No new public API. Keep `enrichArticle(page, meta): Promise<string[]>`,
`insertAudioMaterial(page, {title, audioPath, coverPath}): Promise<string>`, `runMode`,
`metadata.wechatmp` and existing `warnings` versus `enrichWarnings` channels.
Primary code: `plugins/publishings/wechatmp-pub/src/flow.ts`, `enrich.ts`, and `page.ts` only if
shared cleanup needs a common home. Production callers are `enrichArticleDraft` and
`composeArticle`; direct exports also have test callers. The daily producer in
`plugins/kk/scripts/daily-stages.ts` supplies `coverSource: 'library'`, `coverPath`, `audioPath`,
`audioTitle`, `audioCoverPath` and settings. Preserve its input contract.

#### Chosen repair constraints

1. Retain body/title/layout/author setup. Run settings/audio enrichment before library cover
   selection so audio-cover upload can populate the library first. Body-source selection remains
   independent of audio availability. Verify which image the library actually exposes; an audio
   cover becoming a reusable library image is an unverified platform premise, not a guarantee.
   When the intended library image cannot be identified, return a cover warning; do not silently
   change the requested `coverSource` or pick the newest unrelated image.
2. Use the resolved actionable selector returned by the probe, scoped to the active dialog/form.
   For file inputs reuse `findAttachedSelector` and `uploadFile`; do not use visibility as the file
   input's existence test. Wait for upload completion and the material list before selecting the
   exact episode. Remove the first-row-success assumption. Preserve same-episode reuse.
3. For each setting, read current state, perform only the needed transition, and poll the committed
   requested state. Retry once only after cleanup and re-reading, so a partial success cannot be
   toggled off. URL and creation-source verification must compare their actual requested values;
   original and reward must verify the enabled state, with account eligibility failures reported.
4. Reuse the existing modal close mechanisms; share at `page.ts` only if needed by both modules.
   On every success, warning, exception and retry boundary, close the step's modal and verify the
   wrapper and inner dialog are gone. Bound cleanup to the existing three-pass policy. If still
   blocked, record the residual modal and stop overlay-dependent enrichment; retain the final save
   guard and its honest failure. Unknown probe results must never count as success.
5. Cover must read committed image state after confirmation. Audio must read the inserted material
   identity and top position. Keep draft save verification based on the fresh title-keyed 草稿箱
   stamp; a successful save alone does not prove full episode enrichment or platform completeness.
6. Tests must execute production DOM expressions in real Chromium on sanitized `setContent`
   fixtures, including hidden inputs, wrong/absent state, duplicate labels, asynchronous dialogs
   and unrelated first materials. Keep existing fake-console tests for ordering/result plumbing;
   do not replace DOM behavior with queued booleans.

#### Readiness blocker: live control and state mapping

The existing discovery document does not identify the failing build's cover chooser controls,
audio upload action/form internals or committed-state representation for each setting. These
cannot be frozen from the current evidence. Before promotion, capture one attended fresh-draft
walk and record for each step: opener, owning modal, actionable control, file-input attachment,
confirm action, close action, committed value/identity and the corresponding sanitized DOM
fixture. Name the exact selectors and commit probes here from those observations. Also establish
whether an uploaded audio cover appears in the article image library. Do not substitute guessed
selectors, synthetic success or account bypasses for that evidence.

Refine is currently **failed at ready depth**, despite structural completeness; keep `backlog`.
The next refinement owns closing this mapping, rather than handing an unresolved design choice
to an implementer. No production/browser mutation occurred in this refinement.

#### Environment, concurrency and documentation

Bun is 1.3.14. Lockfile and resolved Playwright are 1.55.0; Playwright resolves from
`/Users/robin/node_modules`, not root-local `node_modules/playwright`. Confirm the resolved
Chromium executable exists before browser fixtures; build before any packaged-plugin replay.
No task dependencies are declared or newly required; no dependent task contract is introduced.
At audit time no task was `wip`. Other worktrees: E94-61b8, g14-077c and g8-4173. Their current
dirty files did not include this plugin; older branch differences include the plugin and daily
producer. Recheck before editing, and coordinate concurrent `docs/04_DESIGN.md` changes.
Update `docs/design/wechatmp-ui-discovery.md` and the channel section of `docs/04_DESIGN.md`
through `sp-doc-evolve`/the constitution, preserving ADR-026/029 and draft-only operation.

Avoid global first-match clicks, forced clicks through overlays, direct editor-state mutation,
unscoped upload inputs, fixed sleeps as success evidence, and tests claiming live compatibility
solely because a fake returned true.

### Plan

- [ ] 0. Close the Design readiness blocker in an attended, fresh-draft control/state capture. Retain sanitized evidence and fixtures at `.spur/run/refine-0260/live/`, amend Design with exact control/probe mappings via Spur, then rerun ready refinement before implementation. Stop on login/profile contention or an unavailable required capability; preserve findings without inventing selector evidence. (R1–R4)
- [ ] 1. Recheck current task/worktrees, resolved Bun/Playwright and Chromium availability; build before packaged replay. Read the documentation constitution and channel ADRs. (R1–R4)
- [ ] 2. Add failing production-DOM fixture regressions for the measured cover, settings and upload shapes, plus fake-console tests for enrichment ordering and warnings. (R1–R3)
- [ ] 3. Repair audio form scoping, attached-input detection, identity-based selection, committed insertion and all-exit cleanup; preserve exact-episode reuse. (R2)
- [ ] 4. Repair settings with requested-state reads, state-aware retry and per-step cleanup; preserve author/合集 handling. (R3)
- [ ] 5. Move enrichment before library cover selection, choose/verify the intended cover in both existing modes, and retain submit recovery and named cover warnings. (R1)
- [ ] 6. Test missing controls, hidden inputs, wrong/undefined commit state, throws at each modal stage, unrelated first materials, unclosable overlays and optional-failure draft saving. Exercise other operations and explicit-public boundaries for regressions. (R1–R4)
- [ ] 7. Replay one full episode on a fresh attended draft, save/reopen its title-keyed row, record cover/title/body/audio identity and completeness notice absence; never activate 发表. Retain any unavailable-capability result as incomplete live verification. (R4)
- [ ] 8. Sync the discovery/channel documentation through `sp-doc-evolve`; run `bun run lint`, `bun run test`, `bun run build`, applicable `spur rule run` gates and real requirement verification before implementation is called done. Inspect final git status. (R1–R4)

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `plugins/publishings/wechatmp-pub/src/flow.ts` — cover/audio composition, draft recovery and result diagnostics.
- `plugins/publishings/wechatmp-pub/src/enrich.ts` — setting actions, retry and current weak commit probes.
- `plugins/publishings/wechatmp-pub/src/page.ts` — structural page seam and attached-input helper.
- `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts` — fake-console/queued-evaluation tests, including modal recovery.
- `plugins/kk/scripts/daily-stages.ts` — daily MP metadata producer (around line 1300 at audit).
- `docs/design/wechatmp-ui-discovery.md` — historical measurements; upload internals and cover widget remain candidate shapes.
- `docs/00_ADR.md` — ADR-026/029; `docs/03_ARCHITECTURE.md` — Execution boundary integrity.
- `docs/04_DESIGN.md` — channel rail documentation requiring scoped sync during implementation.
- Commit `8791adc92077bc2ea98dd39848b08f6fece8a5a5` — modal recovery and recorded successful draft checkpoint.
- Audit 2026-10-11: current tree `3562c6c0`, no `wip` tasks; worktrees `sp/runall-E94-61b8`, `sp/runall-g14-077c`, `sp/runall-g8-4173` (see Design concurrency note).

### History
