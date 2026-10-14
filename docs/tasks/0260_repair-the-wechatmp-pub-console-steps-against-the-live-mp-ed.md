---
schema_version: 1
name: Repair the wechatmp-pub console steps against the live MP editor
status: todo
template: standard
created_at: 2026-10-12T02:23:38.506Z
updated_at: "2026-10-14T18:14:21.640Z"

ac_altitude: task-local
ac_numbering: task-local
feature_id: E92
dependencies: ["0272"]
priority: P1
estimate_hours: 12
---

## 0260. Repair the wechatmp-pub console steps against the live MP editor

### Background

Current disposition (2026-10-14): **valid and ready for implementation of the residual verification/cleanup fixes** under existing feature E92. Upstream 0272 is done (commit `91478ad7`); keep the dependency as provenance. Its selector repair is present, but its PASS does not prove committed field values, exact media identities, or a complete upload/cover readback map. The earlier requirement to wait for 0272's status to change is superseded. Live verification remains a completion gate, not a reason to defer the independently reproducible offline fixes.

#### Historical investigation (superseded where corrected below)

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

**Refine corrections (2026-10-14)**

- 0272 is `todo` and blocks all implementation → `spur task show 0272` reports `done`, commit `91478ad7` is present, and retained measurement files exist → consume that work now; keep dependency 0272, remove the blanket pending-handoff blocker.
- Audio-before-library-cover still needs implementation → `flow.ts:696-741` already defers a library cover until after the audio attempt → remove the ordering repair. Audio failure does NOT currently suppress the picker, so retain failure gating and exact-image verification.
- 0272 supplies every required live readback/upload fixture → `22-audio-modal-map.json` has `fileInputs: []`; cover item constants remain documented candidates → use the frozen fail-soft probe contract below; an absent/ambiguous identity must warn without selecting arbitrary media. Do not claim those missing captures exist.
- Same-title reuse is exact → `DEDUPE` uses substring matching and toggles the selected checkbox; Chromium accepts `Episode 1 extra` for `Episode 1` → require exact normalized title plus a unique match and idempotent selection.
- Audio verification only needs placement → `VERIFY` accepts any `mpvoice`/audio-class node at the top, and the caller accepts unknown return values → require the selected material's identity AND top placement, with success only on a positive recognized result.
- Settings probes execute valid native DOM selectors → the reward empty-account expression passes Playwright `:visible` to native `querySelector`, which Chromium rejects → use locator-based value reads or native CSS within a resolved modal, never Playwright selectors inside DOM queries.
- Dialog closure/any checked claim verifies the requested value → Chromium reproduces original-unchecked/closed-dialog and wrong-source false success → retain requested-value probes, state-aware retries, and cleanup.
- Existing attachment helpers cannot handle hidden uploads → Chromium shows visibility probe misses a hidden audio input while `findAttachedSelector` resolves it → reuse the attachment helper in the active form.
- Prior environment/work facts are current → audit HEAD is `e07afeb7`, Bun is 1.4.3, installed Playwright is 1.55.0 with Chromium available; no WIP tasks and one worktree were reported. PIDs 91513/91514 still run the 20261013 MP executor (child Bun 1.3.14) → no live profile takeover; recheck before the live completion gate.

Offline audit evidence: `.spur/run/refine-0260/audit-20261014/probe.ts` and `observations.json`. The production DOM expressions were extracted from source and executed in isolated headless Chromium with network blocked; all seven observations are recorded in Testing. This establishes code defects, not current live-console compatibility. These scratch files are gitignored; the defect descriptions and frozen implementation contract are retained in this task.

### Requirements

- [ ] R1. In both existing `coverSource` modes, select only an unambiguously identified requested cover and verify the committed editor cover against the selected asset identity. Failed, missing, ambiguous or unverifiable selection emits `metadata.warnings`; no newest/first-item assumption is success. When audio is requested for a library cover, audio failure prevents that dependent picker attempt. An open picker is closed or explicitly diagnosed.
- [ ] R2. With valid audio metadata, reuse one exact normalized-title material or upload the requested MP3/cover/title through the active form using attached file inputs, acknowledgement and bounded completion polling. Select the uploaded material by unique identity, never first-row order. Verify the inserted material identity and body-start position. Only a positive recognized verification result returns success; missing, ambiguous, unknown or throwing probes emit `metadata.enrichWarnings`.
- [ ] R3. Verify requested original/reward enabled state, exact originalUrl and exact creation-source value against committed editor state. Read before acting and before a single bounded retry; an already-satisfied setting is not toggled off. Known account/capability refusals warn once without retry. Close and verify each step's dialogs on every exit; unknown cleanup state is a named warning, and a residual overlay stops dependent enrichment. Preserve existing author/合集 behavior and the final honest save guard.
- [ ] R4. Preserve the fresh title-keyed 草稿箱 save contract, draft default, and explicit public-publish boundary. Optional enrichment failure may still yield draft success with named warnings. Full live verification requires one fresh attended draft saved once and reopened by identity, with supported cover/title/body/audio/settings readbacks and no cover/title/body completeness notice; unavailable account capabilities remain explicit warnings and never count as a verified value.

Scope: existing 文章 rail, its direct callers, regression fixtures and touched channel documentation. No new CLI flags, public metadata fields, plugin operations, dependencies or exported API. Private helper signatures may carry expected/observed identities. Keep `originalUrl` for supported callers/builds; an absent row is channel-specific unsupported and never maps to `链接`. Do not redo 0272's ordering, layout-absence or entry-selector repair, provision an account, change other operations, or repeat a public publish. A failed enrichment and a blocked/unknown save are distinct outcomes.

### Acceptance Criteria

```gherkin
Feature: WeChat MP committed enrichment residuals

Scenario: AC1 — Requested episode cover is committed in each existing source mode (req: R1)
  Given body and library fixtures with an intended image and unrelated first items
  When the production flow selects and confirms the intended asset
  Then the committed cover matches its observed asset identity
  And absent, ambiguous or mismatched identity produces a cover warning without arbitrary selection
  And a requested library cover is not attempted after failed audio

Scenario: AC2 — Audio upload accepts hidden inputs and inserts the intended material (req: R2)
  Given an active upload form with hidden inputs and unrelated inputs in another modal
  When the production upload runs and its exact material appears after a bounded delay
  Then only the active form receives the requested files, title and acknowledgement
  And the exact material is selected regardless of row order and verified at the body start
  And an unknown or throwing readback cannot return success

Scenario: AC3 — Existing audio material is reused without another upload (req: R2)
  Given one exact normalized-title material, a prefix match and unrelated materials
  When production audio insertion runs
  Then only the exact material is selected without toggling an already selected checkbox off
  And no upload occurs
  And duplicate exact titles are treated as ambiguous unless the same observed material identity disambiguates them
  And a different top audio node is never accepted as the inserted episode

Scenario: AC4 — Settings success requires committed requested values (req: R3)
  Given original, reward, original URL and creation-source fixtures with committed state
  When a dialog closes without changing that state or a readback is missing or throws
  Then the affected requested setting produces a named warning
  And only the exact requested committed state establishes success
  And native DOM queries never contain Playwright-only selector syntax
  And a retry rereads state without toggling an enabled value off
  And an unavailable reward account or URL capability warns once without retrying or changing the link row

Scenario: AC5 — Failed enrichment releases its dialogs before subsequent work (req: R1, R2, R3)
  Given a cover, audio or setting failure during open, upload, confirm or verification
  When the step finishes or retries
  Then its wrapper and inner dialog are proved closed before dependent enrichment proceeds
  And missing or throwing cleanup probes produce an explicit residual-modal diagnostic
  And closable dialogs do not obstruct save while an unclosable or unknown overlay cannot become false save success

Scenario: AC6 — Full daily draft survives save and reopen (req: R4)
  Given an attended fresh article with valid daily metadata and a free authenticated profile
  When the repaired rail saves once and reopens its title-keyed draft
  Then cover, title, body and exact audio identity and top placement are read back
  And each supported requested setting has its committed value
  And unsupported account capabilities are named without a fabricated success claim
  And the draft has no cover/title/body completeness notice
  And no publish control is activated

Scenario: AC7 — Optional enrichment failure preserves the draft contract (req: R4)
  Given unavailable optional audio or settings with otherwise valid article content
  When production composition and draft saving finish
  Then a fresh title-keyed draft stamp can establish draft success with named warnings
  And a stale stamp cannot establish success
  And warnings never imply full episode completeness or authorise a public publish
```

AC1–AC5: existing `tests/wechatmp-pub.test.ts` for caller/order/result behavior plus new
`plugins/publishings/wechatmp-pub/tests/wechatmp-dom.test.ts` driving an isolated Chromium fixture runner
at `tests/fixtures/wechatmp-dom-runner.ts`. Fixtures execute the production flows/evaluate expressions
through `wrapPlaywrightPage`; do not copy the proposed fixed probes into tests. AC7 also uses the
existing draft/public-boundary tests. Each scenario includes a positive and negative assertion.
AC6 is a live completion gate: retain sanitized draft identity, per-field readbacks, warnings and
absence of publish action. Offline success alone cannot pass AC6; account unavailability does not
excuse unsupported cover/audio identity claims.

### Q&A

#### Historical decisions (superseded by the current decisions below where they conflict)

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

#### Closed decisions — 2026-10-14

- E92 remains the owner; no new feature or reparenting is needed. Task-local AC altitude/numbering remain correct for these finer regression scenarios.
- Keep dependency 0272 as completed provenance. Accept its shipped entry points and partial captures as input, not as proof of a complete committed-state map. The old pending-status/all-artifacts blocker is removed.
- Freeze exact normalized-title matching (trim and collapse whitespace; no substring/fuzzy matching), unique-match selection, selected remote asset/material identity propagation, strict positive success, and fail-soft unsupported outcomes. Unobservable identities never cause arbitrary selection or a success claim.
- Live-only missing markup is an execution/verification prerequisite. Implement the known offline defects now; use the retained selectors only where observed. During the final attended run, capture only the missing control/commit representation before enabling a supported success path. No synthetic selector may be presented as a measured live control.
- Preserve signatures of exported `enrichArticle` and `insertAudioMaterial`; internal helpers may carry identities. Keep cover warnings in `warnings`, audio/settings in `enrichWarnings` across both cover call paths.
- No live interaction was performed during refinement. PIDs 91513/91514 still occupy the old daily executor; checking release and obtaining a fresh attended draft are explicit completion preconditions. Do not kill that process, borrow its profile or publish for this task.

### Design

#### Scope and compatibility

Repair `plugins/publishings/wechatmp-pub/src/flow.ts`, `enrich.ts`, and `page.ts` only where shared bounded cleanup/probing requires it. Reuse `findAttachedSelector`, locator input reads, `waitUntil`/existing time budgets, `uploadFile` and `wrapPlaywrightPage`. No new public API or dependency. Exported `enrichArticle(page, meta): Promise<string[]>` and `insertAudioMaterial(page, {title, audioPath, coverPath}): Promise<string>` keep their signatures and warning contracts. Private `setCover`/`enrichArticleDraft` may receive/return expected and observed identities needed by `ComposeReport`. Inspect all callers and update their tests together.

Primary callers are `composeArticle → enrichArticleDraft → enrichArticle/insertAudioMaterial/setCover`; `setCover` also runs directly for a body cover or library request without audio. Direct exported test callers remain compatible. `daily-stages.ts` supplies existing `coverPath`, `coverSource`, `audioTitle`, `audioPath`, `audioCoverPath` and settings; no metadata producer change is required except removing its inaccurate newest-library-item comment. `coverPath(input)` is the requested first validated body image. Keep other publishing operations, title typing/mirror validation, author/合集, and save/public result schemas intact.

#### Frozen algorithm

1. **Probe meaning.** Reads distinguish matched, mismatched, unsupported/unknown and error internally; only matched establishes success. Poll only to existing per-step deadlines. Missing/throwing probes are named warnings, never truthy defaults. Use native CSS and DOM properties inside `evaluate`; resolve Playwright `:visible`/text selectors through locators outside it. In particular replace the reward account empty-value expression that currently passes `:visible` into native `querySelector`.
2. **Settings.** Read requested committed state before opening a row and after confirmation. Use visible editor settings rows, not hidden template clones or dialog controls: original `#js_original` / `.js_ori_setting_checkbox`, reward `#js_reward_setting_area .js_reward_setting_checkbox` or the visible `.js_reward_allow_click_cell .js_reward_setting`, claim `#js_claim_source_area .js_claim_source` plus `.js_claim_source_selected` text. These shapes occur in the retained editor capture; checked state must use the runtime property, not the HTML attribute. Require enabled original/reward, and exact normalized selected claim text. For originalUrl, only a supported URL row with a readable committed URL can verify the requested trimmed URL; absent/unreadable state warns, and `链接` is never used. Locator `inputValue` reads a resolved dialog account field without native-selector interpolation. A known account refusal warns once without retry. Other actions retry at most once after cleanup and a new committed read; matched state skips clicks. Preserve collection's existing behavior while isolating its cleanup.
3. **Audio.** Scope opener/upload/save/insert controls and file inputs to the active modal/form, rejecting ambiguous ownership. Reuse attached-input detection for hidden audio/cover inputs; remove unscoped file fallbacks. Require requested upload controls, title and acknowledgement, then poll until the matching material is available. Match the material title element (`.audio_title` in the retained capture), not the whole row's duration/date text, by trim/collapsed-whitespace equality. A unique match is required; a prefix title or duplicate matches without an established remote identity warn. Check a checkbox only when unchecked. The saved upload uses the same exact matcher, replacing `SELECT_FIRST`. Carry the selected row's exposed stable material id/media source into the insertion readback; compare it to the inserted node's id/media source and verify that node is the body's first meaningful content (ignore only empty whitespace nodes). If the build exposes no comparable identity, return an unverifiable warning. `VERIFY` must return a recognized matched result; `'undefined'`, unknown strings, exceptions, a generic `[class*=audio]` node or another episode at the top never return `''`.
4. **Cover.** Keep the already-shipped audio-before-library ordering. If requested audio returns any warning, skip the dependent library attempt and report a cover dependency warning. Body covers remain independent. Give `setCover` the requested path from `coverPath(input)` and the current upload/selection binding; do not assume `audioCoverPath` equals the article cover or audio success puts a reusable image in the image library. Identify a candidate only by an exposed exact filename uniquely tied to that requested upload, or a captured asset id/source from that upload; absence/ambiguity warns without clicking first/newest. Capture selected asset id/source and compare the committed cover preview under `#js_cover_area .js_cover_preview_new` (observed capture) after confirm. File paths are local inputs, not remote URLs: never compare a local path directly to an asset URL or strip query strings without measured equivalence. If an edited/cropped preview has no proved mapping, warn rather than invent equivalence. Apply this rule to both cover modes. Route deferred cover warnings back into `ComposeReport.warnings`, not audio/settings `enrichWarnings`.
5. **Cleanup and save.** Reuse the existing three-pass modal policy; share a small helper in `page.ts` only if both flow and settings need it. Scope close/cancel controls to the step's modal and verify both `.weui-desktop-dialog__wrp` and inner `.weui-desktop-dialog` on every return, exception and retry. Include the observed `.weui-desktop-dialog__close-btn` variant from 0272's capture. An unreadable modal probe is unknown, not closed (`anyDialogOpen` currently catches to false). Still-open/unknown cleanup produces a named residual diagnostic and halts overlay-dependent enrichment. Keep the final submit guard; it must refuse an unresolved overlay honestly rather than click through it or claim save success. A closable enrichment failure still permits a fresh title-keyed draft stamp to establish draft success. Save success is independent of enrichment completeness.

#### Evidence, fixtures and live boundary

0272 is done, with implementation commit `91478ad7` and retained map under
`.spur/run/wechat-drift-task/measure-20261013/`. `12-original-dialog-map.json` supplies declaration/agreement/close controls; `21-audio-modal.html` supplies `.audio_title` and picker shape;
`22-audio-modal-map.json` explicitly has zero file inputs (it captures the picker, not the upload form).
`00-editor-initial.html`/`99-editor-final.html` expose editor setting and cover-preview shapes.
The map does not prove upload-form internals, cover-item identity, remote media-id equivalence or
post-reopen values. Do not add guesses to a measured-selector table. A supported-path control or identity
missing from these captures must be recorded during the final attended measurement; until then the
implementation returns the frozen unsupported/unverifiable outcome for that path. This is a determined
fallback contract, not an open design decision.

Add real Chromium fixtures executing production flows through `wrapPlaywrightPage`. Launch Chromium in
an isolated Bun child runner from the new test file, keeping browser launch out of the bun:test process
(the existing bunfig documents launch/event-loop trouble). Use `setContent`, blocked network and fresh
contexts, never operator storage state/profile. Synthetic DOM fixtures are explicitly test shapes derived
from observed classes, not proof of live compatibility. Cover hidden inputs, two dialogs, delayed commit,
wrong/prefix/duplicate media, prechecked toggles, wrong setting values, invalid-native-selector regression,
undefined/throwing probes, and unclosable overlays. Retain orchestration tests for warnings, deferred
cover order, fresh/stale draft stamps and explicit public boundaries. Missing Chromium is an actionable
test-environment failure, not a silent skip. Installed Playwright 1.55.0/Chromium are available at audit time.

Before live AC6, recheck executor/profile ownership and rebuild the packaged plugin. With the profile
free, use one attended fresh draft; retain sanitized missing map fragments, selected/committed asset
bindings, title-keyed draft identity, supported field values, unsupported warnings and save/reopen result.
Do not activate 发表, reuse the occupied session, or fabricate a full-completeness claim. If the account
cannot support a requested value, record the capability warning; if cover/audio identity remains
unobservable, AC6 is incomplete and implementation cannot be called fully verified.

Implementation documentation sync uses `sp-doc-evolve`/`docs/99_PROJECT_CONSTITUTION.md`: update
`docs/design/wechatmp-ui-discovery.md` and the WeChat section of `docs/04_DESIGN.md` to match title-keyed
stamp confirmation and pre-save enrichment. Preserve ADR-026/029. No numbered documentation or ADR
change is required for this refinement alone.

Audit environment: HEAD `e07afeb7`, one main worktree, no WIP tasks, Bun 1.4.3; Playwright resolves from
`/Users/robin/node_modules/playwright` at pinned version 1.55.0. The active 20261013 executor is still
PID 91513 with child 91514/Bun 1.3.14; recheck rather than assuming those historical PIDs remain current.
Existing 0280/G11/INDEX edits in this tree are unrelated authorized work and must be preserved.

### Plan

1. [ ] Re-read 0272's shipped map/commit and this residual contract, inspect all direct callers, recheck WIP tasks/worktrees/profile ownership and the installed Chromium. Do not wait for 0272 status or redo its audio-before-cover repair. (R1–R4)
2. [ ] Add isolated real-Chromium fixture regressions executing production flows for wrong/unknown committed settings, exact/prefix/duplicate audio titles, unrelated top audio, hidden scoped inputs and cover identity mismatch. Keep fixtures independent of operator sessions. (R1–R3)
3. [ ] Repair settings requested-value reads, native-selector misuse, state-aware single retry and once-only capability/account warnings; preserve author/合集 and originalUrl contract. (R3)
4. [ ] Repair audio attachment/form scoping, exact unique material matching before/after upload, idempotent selection, inserted-identity/top readback and strict positive success. (R2)
5. [ ] Propagate expected cover/selected asset bindings through private helpers, verify both source modes, gate dependent library selection on successful audio, and keep cover warnings in ComposeReport.warnings. Remove first/newest assumptions without duplicating existing ordering. (R1)
6. [ ] Apply bounded per-step/final modal cleanup with explicit unknown/residual diagnostics, then exercise fake-console caller tests, fresh/stale draft save and explicit-public boundaries. Cover every failure exit and subsequent-step isolation. (R1–R4)
7. [ ] After the active executor releases the profile, rebuild and perform one attended draft-only measurement/save/reopen. Capture only missing upload/identity/readback representations before declaring supported live paths; record exact per-field outcomes. Never activate publish. Leave AC6 incomplete if any required cover/audio identity cannot be established. (R4)
8. [ ] Sync the channel discovery/design docs through sp-doc-evolve, run bun run lint, bun run test, bun run build and applicable Spur rule gates, perform real requirement verification, and inspect final intentional diff/status before completion. (R1–R4)

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

Specification audit on 2026-10-14; no implementation PASS is claimed:

- `NODE_ENV=test bun test plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts`: **73 pass, 0 fail**, 1296 assertions. Exit **1** is from per-file coverage of imported modules in this single-file run, not test failures. Coverage policy was unchanged. These recording-page tests do not prove DOM or live values.
- `bun .spur/run/refine-0260/audit-20261014/probe.ts`: exit **0**. In fresh network-blocked Chromium, current production expressions accept original-unchecked with dialogs closed (`true`), wrong selected claim (`true`), unrelated top audio (`top`), and prefix-only material title (`checked`). Hidden-file visibility probe returns `found:false`; existing attachment helper finds it. Native `querySelector` with the reward expression's `:visible` syntax throws `SyntaxError`.
- Audit source/result: `.spur/run/refine-0260/audit-20261014/{probe.ts,observations.json}` (gitignored). The defect descriptions and implementation contract are retained above so scratch retention is not required to understand the work.
- `spur task show 0272 --json`: done; `.spur/memory/evidence/0272-verdict.json` is present. Its PASS and partial map are not accepted as proof of 0260's committed identity/value behavior.
- Environment probes: Bun 1.4.3; installed Playwright 1.55.0 and Chromium executable present; one worktree, no WIP tasks; active daily MP executor remains occupied. No live browser/profile was opened, no draft was saved and no publish occurred during refinement.
- Full lint/build/test and live AC6 are implementation completion checks, not run for this corpus-only refinement.

Readiness checklist (2026-10-14):

| id | pass | evidence |
| --- | --- | --- |
| requirements | true | R1–R4 define observable cover/audio/value/cleanup/save outcomes with explicit non-goals. |
| design | true | No new public API; exact matching, identity propagation, strict success, unsupported fallback and cleanup algorithms frozen against named seams. |
| plan | true | Eight ordered steps map to R-items, DOM regressions and the final live gate. |
| ac | true | AC1–AC7 bind R1–R4; strict target-todo check has no findings; task-local regression altitude retained. |
| decisions | true | Existing feature E92 retained; 0272 completion accepted without claiming absent map evidence; missing live identities have an explicit warning contract. |
| dependencies | true | Dependency 0272 is done; its remaining live-only capture limits are documented, with no circular dependency or duplicate ordering repair. |
| premises | true | Source/caller audit, current 73-test baseline, isolated Chromium assertions, partial capture inspection and concurrency/environment probes recorded above. |

Scoped finalization: `spur task check 0260 --as todo --strict --json`, `spur task check 0260 --precheck --json` and `spur feature check E92 --json` pass without findings. Status stays `todo`; missing priority/estimate filled as P1 / 12 hours. These checks establish specification readiness, not implementation or live acceptance.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature E92: `docs/features/E92_publish-channel-ui-fidelity-per-mode-discovery-and-gap-fixes.md` (correct existing owner; active).
- Dependency 0272: `docs/tasks/0272_re-measure-the-wechat-mp-enrichment-rail-against-the-drifted.md` (done); implementation commit `91478ad7`.
- Retained upstream input: `.spur/run/wechat-drift-task/bg.md` and `.spur/run/wechat-drift-task/measure-20261013/{00-editor-initial.html,11-original-dialog.html,12-original-dialog-map.json,21-audio-modal.html,22-audio-modal-map.json,99-editor-final.html}`. Partial historical measurement; not a complete upload/identity map. Raw captures stay gitignored and must be sanitized before fixture use.
- `plugins/publishings/wechatmp-pub/src/flow.ts:629` — cover first-item/no committed readback; `:696` — current audio-before-library ordering; `:1140` — audio substring/first-row/weak verification.
- `plugins/publishings/wechatmp-pub/src/enrich.ts:111` — non-state-aware retry; `:128` — dialog closure probe; `:166` — native-selector account read; `:223` — any checked claim accepted.
- `plugins/publishings/wechatmp-pub/src/page.ts:132` — existing attachment helper; `:200` — Playwright wrapper.
- `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts:1052` — queued recording-page seam; new DOM test/runner paths are specified in Acceptance Criteria.
- `plugins/kk/scripts/daily-stages.ts:1520` — existing WeChat metadata producer; retain fields, remove obsolete newest-cover comment during implementation.
- `.spur/run/refine-0260/audit-20261014/{probe.ts,observations.json}` — current isolated Chromium premise check; `.spur/run/refine-0260/live/20261013-audit.md` — historical direct bridge probe only.
- `docs/design/wechatmp-ui-discovery.md`; `docs/04_DESIGN.md:1239` — channel documentation to sync during implementation.
- `docs/00_ADR.md` ADR-026/029; `docs/03_ARCHITECTURE.md` Execution boundary integrity; `docs/99_PROJECT_CONSTITUTION.md`.

### History

- 2026-10-12T21:42:40.483Z backlog → todo (system)

