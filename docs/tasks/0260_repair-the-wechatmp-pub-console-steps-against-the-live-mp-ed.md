---
schema_version: 1
name: Repair the wechatmp-pub console steps against the live MP editor
status: todo
template: standard
created_at: 2026-10-12T02:23:38.506Z
updated_at: "2026-10-13T21:01:13.404Z"

ac_altitude: task-local
ac_numbering: task-local
feature_id: E92
dependencies: ["0272"]
---

## 0260. Repair the wechatmp-pub console steps against the live MP editor

### Background

The operator reported failures in the daily 文章 draft enrichment on 2026-10-11/12:
cover selection, audio upload, 原创声明, 赞赏, 原文链接 and 创作来源. A leaked audio dialog
blocked 保存为草稿. Commit `8791adc92077bc2ea98dd39848b08f6fece8a5a5` records a subsequent
successful draft save (20261011, 更新于 18:51); that proves a save checkpoint, not successful
enrichment. The current code closes dialogs at the submit boundary and carries compose diagnostics
on submit exceptions, but it still has unverified cover/audio/settings state. The reported
incomplete-draft notice needs a new, title-keyed live observation before it can be treated as the
state of a current draft.

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

**Refine corrections (2026-10-13)**

- “The current checkout is `3562c6c0` and has no active work” → the current checkout is `a5e05542222d900c9e7c223bd4e6202fec311a01`; task 0268 is `wip`, the only registered worktree is this main tree, and a 20261013 `kk executor run wechatmp-pub` is still active → use these facts for concurrency and do not take the live profile.
- “Bun is 1.3.14” → the current shell is Bun 1.4.3 and the lockfile resolves Playwright 1.55.0; the active executor still runs proto Bun 1.3.14 → record both versions and require a clean packaged replay after the active run is gone.
- “The current cover/audio/settings paths already prove their requested state” → `flow.ts:628-660` closes a cover picker without reading committed identity, `flow.ts:1180-1249` uses visibility-based file probes and selects the first post-upload row, and `enrich.ts:110-189` mostly verifies modal closure or any checked source checkbox → retain these as implementation defects requiring identity/value probes.
- “A real DOM regression fixture already exists” → `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts:1026-1300` is a recording-page seam with queued return values; `wechatmp-dom.test.ts` does not exist → add a real Chromium `setContent` fixture only during implementation.
- “A fresh live mapping can be inferred from the discovery artifacts” → the existing `.spur/run/discovery/wechatmp-*` captures are dated 2026-10-05/06 and leave the cover widget and upload internals open → keep the live mapping prerequisite explicit until the upstream handoff is accepted.
- “Kimi WebBridge can provide the current measurement” → the daemon was reachable but `list_tabs` for session `kk-task-audit` returned `no extension connected`; no fresh page was observed or mutated → retain this as evidence about the direct probe, while 0272 owns the attended mapping.
- “The task can link directly to E92 while E92 is done” → Spur rejected that edge with `parent-feature-status`; E92 was reopened to `active` through `spur feature update`, then 0260 was linked with `spur task update --feature E92 --no-reopen` → E92 is the proper owner and its active status is intentional while this residual task is live.

**Partition correction (2026-10-13)**

Task 0272 owns the current live-console measurement, selector and entry-point drift, account
prerequisite and layout outcome, and the channel adapter repair. Its candidate measured evidence is
recorded in `.spur/run/wechat-drift-task/bg.md`. This evidence is a handoff candidate, not proof that
0272 is implemented: 0272 remains `todo` and its final accepted artifacts are still required.

Task 0260 owns the downstream residuals: committed cover and audio identity/placement, requested
setting-value verification (including `originalUrl` whenever the channel exposes that requested
value), per-step dialog cleanup and residual-modal diagnostics, and real Chromium fixtures that
exercise those probes after 0272's map is accepted. The public `originalUrl` input/contract remains
intact; any absent WeChat-specific row must be handled as a channel-scoped unsupported outcome and
must not be retired globally or confused with the unrelated `链接` setting.

The dependency edge `0260 → 0272` is now recorded through Spur. This makes 0260 dependency-ready:
its upstream handoff is explicit, but it is not implementation-runnable or live-capable until 0272
supplies and closes that handoff. The 0260 audit did not perform a second browser walk, save a draft,
or publish anything. Its direct WebBridge/profile evidence remains at
`.spur/run/refine-0260/live/20261013-audit.md`.

### Requirements

- [ ] R1. On a fresh 文章 draft with an episode cover, both existing `coverSource` modes select the intended image and verify committed cover identity. Failed cover selection emits a `metadata.warnings` entry and closes its picker, or explicitly reports an unclosable picker.
- [ ] R2. With valid audio metadata, reuse the exact episode material or upload its MP3, cover and title, acknowledge the service rules, save the material and insert that material at the body start. Verify identity and placement. Missing controls, unavailable account capabilities, upload failures and unverifiable outcomes emit `metadata.enrichWarnings`; no unrelated first material may be inserted.
- [ ] R3. Requested 原创声明, 赞赏, 原文链接 and 创作来源 settings are verified against committed state and requested values after each step. Dialog closure alone is insufficient. Missing, false, undefined or throwing verification is a named `enrichWarnings` outcome. Retain existing 合集 behavior and isolate each step's cleanup before the next setting runs.
- [ ] R4. A full-episode draft with all capabilities available has the intended cover, title, body and audio after save/reopen, and its title-keyed 草稿箱 entry has no cover/title/body completeness notice. Audio success is checked independently. An unavailable enrichment remains a warning and does not fabricate full-completeness evidence or prevent an otherwise valid draft save.

Scope: repair the existing 文章 rail, its callers, regression fixtures and channel documentation.
No new product CLI flags, runtime metadata fields, plugin operations or public API are introduced.
The single Spur dependency on 0272 is intentional corpus ordering, not a product dependency. Keep
the public `originalUrl` input/contract intact; a channel-specific absent row is an explicit
unsupported outcome or a separately measured adapter decision, never a global field deletion or a
substitution with the unrelated `链接` setting. 0272 owns 一键排版, account entitlement/verification,
selector remeasurement and the daily adapter repair. Preserve draft defaults, the explicit
public-publish boundary, other operation flows and the no-repeat publish rule.

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

- Closed: keep scope to the six reported enrichment steps; layout repair is excluded from 0260 and belongs to the separately measured 0272 contract.
- Closed: keep existing metadata, function signatures and result warning channels; optional enrichment failure still permits a verified draft save.
- Closed: platform completeness covers cover/title/body; audio has its own identity/placement evidence.
- Closed: regression AC are task-local and still bind every R-item. The later E92 link supersedes the old missing-feature warning.
- Superseded: the direct browser walk is no longer a 0260 ownership question; 0272 supplies the measured control/state map before 0260 implementation.

#### Q&A entry — 2026-10-13T20:55:07.861Z

- Closed: link 0260 to E92 because the task repairs the WeChat MP UI-fidelity rail. E92 was `done`, so Spur required `spur feature update E92 active` before `spur task update --feature E92 --no-reopen`; the feature remains active while this residual work is live.
- Closed: retain `ac_altitude: task-local` and `ac_numbering: task-local`. AC1–AC7 are regression and failure-path criteria for this repair, finer than E92's feature ship scenarios; they still bind every R-item locally.
- Closed: freeze the fail-soft algorithm: an unknown, missing, throwing or unverifiable probe yields a named warning and cannot become success; exact selectors and commit probes are consumed from 0272's accepted evidence.
- Superseded: the prior direct live blocker is now an upstream dependency. The Kimi WebBridge direct probe returned `no extension connected`; 0272's measured candidate evidence is at `.spur/run/wechat-drift-task/bg.md`, but 0272 remains `todo`.

#### Q&A entry — 2026-10-13T21:10:00.000Z

- Closed: `spur task deps 0260 add 0272` records that 0260 must follow 0272's mapping and adapter work. 0260 is dependency-ready only when the handoff is accepted; it is not runnable while 0272 is unresolved.
- Required upstream handoff: (1) a sanitized current DOM/control map naming opener, owning modal, actionable control, attached file input, confirm and close controls; (2) committed readback representations for cover, audio, original/reward/source values and any unsupported states; (3) account-prerequisite and layout presence/absence outcomes; (4) channel-scoped originalUrl handling that preserves the public field and leaves `链接` untouched; (5) real-DOM fixture snippets or selectors with their evidence source; and (6) draft-only evidence with draft id, per-field readback and named warnings.
- Closed ownership: after that handoff, 0260 adds the identity/value probes, state-aware retries, per-step cleanup, residual-modal diagnostics and real Chromium fixture coverage. It does not remeasure selectors or repair 0272's daily adapter.
- Closed boundary: preserve the public `originalUrl` contract. If this console build lacks 原文链接, report the channel-specific unsupported state or consume 0272's scoped adapter decision; never remove the public field globally or use `链接` as a replacement.
- Deferred with condition: a full attended draft-only replay, save/reopen check and live-capability claim wait for 0272's accepted artifacts and a free profile. No public publish or unnecessary save is authorized by this refinement.

### Design

#### Boundaries and existing seams

No new public API. Keep `enrichArticle(page, meta): Promise<string[]>`,
`insertAudioMaterial(page, {title, audioPath, coverPath}): Promise<string>`, `runMode`,
`metadata.wechatmp` and existing `warnings` versus `enrichWarnings` channels.
Primary code: `plugins/publishings/wechatmp-pub/src/flow.ts`, `enrich.ts`, and `page.ts` only if
shared cleanup needs a common home. Production callers are `enrichArticleDraft` and `composeArticle`;
direct exports also have test callers. The daily producer in `plugins/kk/scripts/daily-stages.ts`
supplies `coverSource: 'library'`, `coverPath`, `audioPath`, `audioTitle`, `audioCoverPath` and
settings. Preserve its public input contract, including `originalUrl` outside any channel-scoped
adapter omission accepted by 0272.

#### Ownership boundary and upstream handoff

0260 depends on 0272 for the measured current-console facts. 0272 owns selector and entry-point
remeasurement, the account prerequisite and layout presence/absence behavior, and the daily WeChat
adapter decision. 0260 must not rediscover those controls or duplicate the adapter repair.

The 0272 handoff is accepted only when it supplies all of the following, with a source path and a
current status for each item:

1. A sanitized DOM/control map for each retained setting, audio and cover path: opener, owning
   modal or form, actionable control, attached file input, confirm/save/insert control and close
   control. The map must distinguish a missing control from an account prerequisite.
2. Committed-state readback evidence for cover identity, audio material identity and body position,
   original/reward/source requested values, and explicit undefined/unsupported outcomes. Dialog
   closure alone is not a commit probe.
3. The account prerequisite text and bounded dependent ordering, the layout control's
   present/absent behavior, and the channel-scoped handling of an absent 原文链接 row. The public
   `originalUrl` contract must remain intact, and the unrelated `链接` setting must remain untouched.
4. Sanitized DOM snippets or fixture inputs that can be used by 0260's real Chromium tests, plus
   the evidence date and console/build context. Candidate evidence currently lives in
   `.spur/run/wechat-drift-task/bg.md`; this source report does not by
   itself prove that 0272's implementation is complete.
5. A draft-only live record naming the draft id, each account-supported field's post-save readback,
   the exact account warning where entitlement is absent, and the absence of any publish action.

The dependency edge is recorded as `0260 → 0272` in Spur. This makes the downstream specification
dependency-ready: an implementer can proceed once the handoff is accepted. It is not runnable yet
while 0272 is `todo`, its changes are unverified, or any handoff item is missing.

#### Chosen repair constraints

1. Once 0272's map is accepted, run settings and audio before library cover selection so the
   audio-cover upload can populate the library. Body-source selection remains independent of audio
   availability. Verify the image identity exposed by the measured library path; an audio cover
   becoming a reusable article image is not a guarantee. When the intended image cannot be
   identified, return a cover warning; do not silently change `coverSource` or pick an unrelated
   image.
2. Use the resolved actionable selector from the accepted upstream map, scoped to the active
   dialog/form. For file inputs reuse `findAttachedSelector` and `uploadFile`; do not use visibility
   as the file input's existence test. Wait for upload completion and the material list before
   selecting the exact episode. Remove the first-row-success assumption. Preserve same-episode reuse.
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
6. After 0272's handoff, tests must execute production DOM expressions in real Chromium on sanitized
   `setContent` fixtures, including hidden inputs, wrong/absent state, duplicate labels,
   asynchronous dialogs and unrelated first materials. Keep fake-console tests for ordering/result
   plumbing; do not replace DOM behavior with queued booleans.

The fail-soft algorithm is frozen: every missing, throwing or unverifiable probe returns a named
warning and stops only the dependent enrichment; unknown state never becomes success. Exact live
selectors and commit probes come from 0272's accepted evidence rather than an implementer guess.

#### Conditional readiness and environment

The historical discovery captures remain dated 2026-10-05/06, while 0272 records a newer candidate
measurement. The direct Kimi WebBridge probe for session `kk-task-audit` still returned
`no extension connected`, so 0260 did not take over the active browser profile. This does not require
a duplicate walk if 0272's handoff is accepted. It does require a fresh draft-only replay after the
handoff and after the profile is free; 0260 must not claim full live capability from fixtures alone.

The current shell uses Bun 1.4.3. The lockfile and resolved Playwright are 1.55.0; the package
import resolves from `/Users/robin/node_modules`, not root-local `node_modules/playwright`. The
currently running daily executor still uses proto Bun 1.3.14, so do not mix its profile/session
with a fresh replay. There is one registered worktree (this main tree); task 0268 is `wip` but does
not touch this plugin. Recheck the active executor and browser-profile lock before the full replay,
and confirm the resolved Chromium executable before browser fixtures or a packaged run.

Update `docs/design/wechatmp-ui-discovery.md` and the channel section of `docs/04_DESIGN.md`
through `sp-doc-evolve`/the constitution during implementation, preserving ADR-026/029 and
draft-only operation.

Avoid global first-match clicks, forced clicks through overlays, direct editor-state mutation,
unscoped upload inputs, fixed sleeps as success evidence, and tests claiming live compatibility
solely because a fake returned true.

### Plan

- [ ] 0. Verify the 0272 dependency and its handoff artifacts before implementation. Confirm the measured DOM/control map, committed readbacks, account/layout outcomes, channel-scoped originalUrl decision, sanitized fixture inputs and draft-only evidence. If 0272 is still unresolved or an artifact is missing, keep 0260 conditional and do not claim it is runnable; do not repeat 0272's browser walk. (R1–R4)
- [ ] 1. Recheck current task/worktrees, the active executor/profile lock, Bun 1.4.3, resolved Playwright 1.55.0 and Chromium availability; build before the packaged replay. Read the documentation constitution and channel ADRs. (R1–R4)
- [ ] 2. After the accepted upstream map, add real Chromium production-DOM fixture regressions for the measured cover, settings and upload shapes, plus fake-console tests for enrichment ordering and warnings. (R1–R3)
- [ ] 3. Repair audio form scoping, attached-input detection, identity-based selection, committed insertion and all-exit cleanup; preserve exact-episode reuse. (R2)
- [ ] 4. Repair settings with requested-state reads, state-aware retry and per-step cleanup; preserve author/合集 handling and the public `originalUrl` contract. (R3)
- [ ] 5. Move enrichment before library cover selection, choose/verify the intended cover in both existing modes, and retain submit recovery and named cover warnings. (R1)
- [ ] 6. Test missing controls, hidden inputs, wrong/undefined commit state, throws at each modal stage, unrelated first materials, unclosable overlays and optional-failure draft saving. Exercise other operations and explicit-public boundaries for regressions. (R1–R4)
- [ ] 7. After 0272's accepted implementation and with the profile free, replay one full episode on a fresh attended draft, save/reopen its title-keyed row, record cover/title/body/audio identity and completeness notice absence; never activate 发表. Retain any unavailable-capability result as incomplete live verification. (R4)
- [ ] 8. Sync the discovery/channel documentation through `sp-doc-evolve`; run `bun run lint`, `bun run test`, `bun run build`, applicable `spur rule run` gates and real requirement verification before implementation is called done. Inspect final git status. (R1–R4)

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `docs/tasks/0272_re-measure-the-wechat-mp-enrichment-rail-against-the-drifted.md` — upstream live measurement, account/layout findings and channel adapter ownership.
- `.spur/run/wechat-drift-task/bg.md` — candidate 2026-10-12/13 live selector and state evidence; acceptance still depends on 0272 completion.
- `plugins/publishings/wechatmp-pub/src/flow.ts` — cover/audio composition, draft recovery and result diagnostics.
- `plugins/publishings/wechatmp-pub/src/enrich.ts` — setting actions, retry and current weak commit probes.
- `plugins/publishings/wechatmp-pub/src/page.ts` — structural page seam and attached-input helper.
- `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts` — fake-console/queued-evaluation tests, including modal recovery.
- `plugins/publishings/wechatmp-pub/tests/wechatmp-dom.test.ts` — real DOM fixture file to add during implementation.
- `plugins/kk/scripts/daily-stages.ts` — daily MP metadata producer and public `originalUrl` contract.
- `docs/design/wechatmp-ui-discovery.md` — historical measurements; superseded current map must come from 0272.
- `docs/00_ADR.md` — ADR-026/029; `docs/03_ARCHITECTURE.md` — Execution boundary integrity.
- `docs/04_DESIGN.md` — channel rail documentation requiring scoped sync during implementation.
- Commit `8791adc92077bc2ea98dd39848b08f6fece8a5a5` — modal recovery and recorded successful draft checkpoint.
- `.spur/run/refine-0260/live/20261013-audit.md` — direct WebBridge/profile/environment probe; no live mutation.
- Spur dependency: `0260 → 0272`; feature link: `0260 → E92` (E92 reopened to `active` through CLI).

### History

- 2026-10-12T21:42:40.483Z backlog → todo (system)

