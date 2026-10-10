---
schema_version: 1
name: The 发播客 note uploads the episode mp3 and cover as one episode
status: done
template: feature-impl
created_at: 2026-10-09T06:24:08.594Z
updated_at: "2026-10-10T01:56:17.925Z"
feature_id: G12

priority: P2
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0236-verdict.json
---

## 0236. The 发播客 note uploads the episode mp3 and cover as one episode

### Background

Feature G12 scenario R2. 每日AI乱炖 should also leave a 发播客 note for the same episode: that episode's mp3 and that episode's cover, uploaded as one episode. The creator console does not offer a usable RSS import, so this is not a feed. Important, not urgent.

The 发播客 control is 上传音频. It opens a modal with an audio picker and a cover picker (`plugins/publishings/xhs-pub/src/flow.ts`). A draft run must not click 去发布. Creator drafts stay in `~/.config/kk/browser-profiles/xhs`, not in the phone app.

**Verified against code (refine 2026-10-09).**

- **The plugin side mostly exists.**
  - `composePodcast` (`plugins/publishings/xhs-pub/src/flow.ts:427-450`) clicks 上传音频, attaches the audio and the cover.
  - `leavePodcastModal` (`:404-425`) refuses to click 去发布 unless `publishStatus: 'public'`; a draft run fails loud when the modal stays open.
  - `validateModeInput` 发播客 (`modes.ts:282-297`) accepts `metadata.audioFile` + `metadata.coverImage`. HIGH.
- **The Content already exists.** voice2's publish-prep Content (`31-publish/<date>_13_publish-prep_content.json`) carries `metadata.audioFile` (the final mp3, which includes the intro sting: 1002.11 s, the same as `.intro.wav`, against 993.30 s raw) and `metadata.coverImage` (`23-cover/<date>_07_cover_cover.png`). A 发播客 Content is that file plus `metadata.operation: '发播客'` and `publishStatus`. HIGH.
- **Not measured: what happens after both files are attached.** `docs/design/xhs-ui-discovery.md:67-69` records that the 发播客 post-file flow was excluded from unattended capture. Only the modal open is on file (`.spur/run/discovery/xhs-podcast-dialog.json`). Whether the modal offers a save path other than 去发布 is unknown. HIGH that it is unknown.
- **Blocker: the ADR-025 frequency cap.** `createAutomationGuard` allows one headed `publish` per `CAP_WINDOW_MS` = 2 h (`plugins/publishings/xhs-pub/src/automation-guard.ts:36,99-118`), and xhs-pub checks it before any browser opens (`index.ts:247-250`). voice2's `xhs-publish` node already spends that cycle on 上传图文, so a second `xhs-pub` call in the same run is refused with `automation cap: …`. HIGH. Adding a 发播客 step beside 图文, as the original design does, cannot work as written.

### Requirements

- [x] R0. **Cap decision — resolved 2026-10-09: option (A).** One xhs-pub visit composes the 上传图文 note and the 发播客 note in the same session under one `allow`/`record('publish')` (ADR-025 amendment 2026-10-09). Do not bypass the guard; do not use a second `KK_XHS_AUTOMATION_STATE` file.
- [x] R1. voice2 builds a 发播客 Content from the publish-prep Content: the same `audioFile` (final mp3 with the intro) and `coverImage`, plus `metadata.operation: '发播客'` and `publishStatus` from `xhs_live`. No new artifacts.
- [x] R2. The flow clicks 上传音频, attaches that mp3 and that cover, and fills any required modal field the attended measurement finds. It does not import an RSS feed.
- [x] R3. **Attended measurement first.** Before any flow change, one operator-attended walk records what the modal offers after both files attach, saved as `.spur/run/discovery/xhs-podcast-postfile.json` plus a screenshot.
  - If a save path other than 去发布 exists, wire it as the draft action, with the draft claimed only from the console signal, as 图文 is.
  - If none exists, the draft run stops before 去发布, as `leavePodcastModal` does today. The result is `ok: false` with `error` naming the gap, and it is non-blocking for the run.
- [x] R4. With `xhs_live` unset or false, no result claims `publishStatus: public`. `kk-daily-ai-voice.yaml` stays byte-identical. The 上传图文 note (0235) is unchanged by this task.

### Acceptance Criteria

- [x] AC1 — The 发播客 note uploads the episode mp3 and cover as one episode
  - Evidence (xhs-pub offline test with the scripted `XhsPage`, `plugins/publishings/xhs-pub/tests/`): given a 发播客 Content built from a publish-prep fixture, the page receives `setInputFiles` for exactly that mp3 and that cover, and 去发布 is never clicked when `publishStatus` is draft (R1, R2, R4).
  - Evidence: the stage test for the new voice2 step shows the built Content's `audioFile`/`coverImage` equal the publish-prep fixture's, `operation` = `发播客`, and `publishStatus` = `draft` when `xhs_live` is unset (R1).
  - Evidence (cap, under the R0 decision): one voice2 run's xhs step makes exactly one `automation.record('publish')`. The guard state file shows one `publish` timestamp per run (R0).
  - Evidence (attended, live): `.spur/run/discovery/xhs-podcast-postfile.json` exists. One dry run's result json is either a `draft` claim backed by a console signal or `ok: false` naming the missing save path. In both cases 草稿箱 → 播客笔记 in `~/.config/kk/browser-profiles/xhs` is checked and recorded in Testing (R3).

### Q&A

#### Q&A entry — 2026-10-09

- **RSS.** Not supported for this account, and out of scope. One episode per run, uploaded through 上传音频.
- **去发布.** Publish-adjacent. A draft run does not click it. Measured 2026-10-06 as the modal's only advance control; re-measure before inventing a new one.
- **Live post.** Out of scope. `xhs_live` stays false.
- **Where the draft appears.** Only in the XHS browser profile. The phone app will stay empty until a note is actually published.

#### Q&A entry — 2026-10-09 (refine)

- **Does the plugin flow exist?** Yes, the upload half does: `composePodcast` and the no-去发布 rail. Missing pieces: a voice2 caller, a measured post-attach save path, and room under the cap.
- **Why not "beside 图文"?** ADR-025's guard allows one headed publish per 2 h (`automation-guard.ts:36`). A second call in the same run is refused before the browser opens.
- **Status?** Stays **backlog** until R0 (operator decision) is answered. R3 is an attended step and cannot run headless or unattended (ADR-025).
- **Which cover?** The same `23-cover` PNG that publish-prep already sets as `coverImage`. The modal's accepted aspect ratio is part of the R3 measurement.

#### Q&A entry — 2026-10-09 (operator decision)

- **R0 answered: option (A).** One xhs-pub visit composes both notes; the cap counts visits, not notes. Recorded as the ADR-025 amendment of 2026-10-09. Task moves to todo; R3 stays an operator-attended step inside implementation.

#### Q&A entry — 2026-10-09 (operator decision: attended walk deferred)

- **R3 (the operator-attended walk that measures what the 发播客 modal offers after both files attach) is operator-deferred**, together with AC1's attended live bullet. It requires a headed session under ADR-025 and cannot be produced headlessly.
- **Consequence, implemented as R3's own fallback branch:** no post-attach save path is invented; `leavePodcastModal` keeps the refusal to click 去发布 and now names the unmeasured gap, and the 发播客 entry is `ok: false` with that error on every visit — non-blocking for the run, and the 上传图文 note is unaffected. The unmeasured save path is the open residual.
- **Follow-up:** run the attended walk, save `.spur/run/discovery/xhs-podcast-postfile.json` plus a screenshot; if a save path exists, wire it as the draft action and claim the draft only from the console signal.

### Design

**Superseded:** "add the 发播客 step beside the 图文 step." The 2 h cap refuses a second `xhs-pub` call in the same run (Background).

**Chosen (A), operator decision 2026-10-09 — one visit, two notes.** `dailyPublishXhs` (`plugins/kk/scripts/daily-stages.ts:846`) sends one Content to `xhs-pub` whose `metadata.followUps` holds the 发播客 Content.
- xhs-pub runs the primary 上传图文 compose → draft, returns to the creator landing, then runs `composePodcast` in the **same** browser session.
- Each operation gets its own Result entry; the aggregate is non-blocking.
- One `allow('publish')` check and one `record('publish')` cover the visit.

Changes:
- `xhs-pub/src/index.ts` (loop over `[primary, ...followUps]` after the one cap check);
- `dailyPublishXhs` (attach the follow-up only when a new trailing arg `podcast=true` is passed by voice2; voice1 passes nothing);
- the voice2 `xhs-publish` node (pass the arg);
- ADR-025 amendment (written 2026-10-09, `docs/00_ADR.md` ADR-025);
- `04_DESIGN.md` (T3).

Rejected alternatives:
- **(B)** A separate 发播客 run ≥2 h later, from a launchd job. No guard change, but it is a second scheduled job and a second console visit per day.
- **(C)** 发播客 only on days 图文 is off. No change, but the episode loses one channel per day.

Draft action after the files attach comes from R3's attended measurement. Do not invent a selector.

### Plan

1. **R0:** done — option (A), ADR-025 amendment 2026-10-09.
2. **R3:** run the attended walk with the operator present. Save `xhs-podcast-postfile.json` and a screenshot, and update `docs/design/xhs-ui-discovery.md`.
3. Write tests first (AC1 evidence 1–3): an xhs-pub offline test for the follow-up loop and the no-去发布 rail; a stage test for building the 发播客 Content; a guard-state assertion.
4. Implement option (A), or the chosen option. If R3 found a draft save path, wire it into `leavePodcastModal`; otherwise keep the refusal and give the result an explicit `error`.
5. Pass the voice2 `xhs-publish` arg. Update `04_DESIGN.md` (T3).
6. Run `bun run gate` from a worktree until 0242 R6 lands. Then do one attended dry run, check the 草稿箱 → 播客笔记 in the kk profile, and record the run id.

### Solution

Option (A) — one `xhs-pub` visit composes the 上传图文 note and the episode's 发播客 note under one
`allow`/`record('publish')`. R3 (the attended measurement of the modal's post-attach save path) is
DEFERRED per the operator decision of 2026-10-09: no save-path selector is invented, the draft 发播客
entry is `ok: false` naming the unmeasured gap, and it never fails the visit.

**Change map**

- `plugins/publishings/xhs-pub/src/index.ts`
  - `:77-104` — `VisitOperation` / `VisitFollowUp` / `VisitPlan`: one visit is a primary operation plus
    the follow-ups the primary Content's `metadata.followUps` declares; a follow-up is either planned
    (`Content` + validated `ModeInput`) or refused with its reason.
  - `:106-140` — `planVisit`: resolves and validates the primary exactly as before, then plans each
    follow-up (`ContentSchema` → `resolveXhsOperation` → `validateModeInput`) BEFORE any browser work.
    An unplannable follow-up becomes its own refused entry; a `metadata.followUps` that is not an array
    is a caller error and fails loud (`fail`) before the cap is touched.
  - `:305-368` — `publish`: one `allow('publish')`, one preflight, one `record('publish')`, one
    `openPage` for the whole visit (`:318-341` unchanged otherwise). The visit's Result IS the primary
    operation's Result; a failed primary ends the visit as before. A standing primary runs each
    follow-up in the same page and the aggregate is that primary Result plus
    `metadata.followUps: Result[]` (one entry per operation, refused and failed entries alike) — so a
    failed follow-up is never a failure of the visit.
  - `:371-410` — `runStep`: one operation in the visit's page. Each step re-enters the console landing
    (`goto` + login gate + fresh pre-entry draft baseline) so the follow-up's draft signal is measured
    against its own baseline, then runs `runMode` with that operation's own Content/`publishStatus`. A
    step never throws: its failure is that operation's `ok:false` Result.
- `plugins/publishings/xhs-pub/src/flow.ts:403-431` — `leavePodcastModal` keeps the 去发布 refusal
  semantics (a draft run never clicks the publish-adjacent control) and now names the gap explicitly:
  the modal's post-attach save path "has never been measured (task 0236 R3 — the attended walk is
  still pending)". No new selector.
- `plugins/kk/scripts/daily-stages.ts`
  - `:846-899` — `dailyPublishXhs` takes the trailing `podcast` arg; when it is `'true'` the packaged
    图文 `Content` carries the 发播客 note as `metadata.followUps` (R0 one visit). A bare 4-arg call
    (voice1) packages exactly what it did before.
  - `:901-921` — `xhsPodcastNote`: the run's own `31-publish/<date>_13_publish-prep_content.json`
    (R1: the final mp3 + the `23-cover` PNG, no new artifact) plus `metadata.operation: '发播客'`,
    `metadata.audio` (the key `xhs-pub`'s 发播客 validation reads, carrying the prep's
    `metadata.audioFile`) and the run's `publishStatus` from `xhs_live`. A run with no prep output
    logs `publish-xhs: no publish-prep Content at <path> — the 发播客 note is skipped` and carries the
    图文 note alone.
- `plugins/kk/workflows/kk-daily-ai-voice2.yaml:547-554` — the `xhs-publish` node passes the fifth arg
  `"true"`; its description names the same-visit follow-up. `kk-daily-ai-voice.yaml` is untouched
  (`git diff --exit-code` clean) and stays on the 4-arg call.
- `docs/04_DESIGN.md:1006` (xhs-pub visit semantics) and `:1186` (the `daily-publish-xhs [<podcast>]`
  row) — T3 surface for the new arg, the `metadata.followUps` contract and the unmeasured save path.
- `docs/00_ADR.md` — **not** edited: ADR-025 already carries the 2026-10-09 amendment "one visit may
  compose several notes" (`docs/00_ADR.md:1049`).

**Tests (written first, then the implementation)**

- `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2143-2310` — offline `XhsPage` suite: the one
  visit composes both notes and uploads exactly that mp3 and that cover after the 图文 batch; one
  `record('publish')` and one guard-state key per visit (a second call is refused by the cap); the
  deferred modal path fails only the 发播客 entry (non-blocking, 去发布 never clicked); a refused
  follow-up never touches the console; an unplannable entry / malformed `followUps` is handled.
- `apps/cli/tests/kk-workflow-stages.test.ts:1603-1700` — the stage builds the 发播客 Content only when
  the trailing arg is passed (audioFile/coverImage equal the prep fixture's, `operation` 发播客,
  `publishStatus` draft for `xhs_live=false`), and skips it — naming the missing prep — when absent.
- `apps/cli/tests/voice2-dag.test.ts:483-491` — voice2's node passes the arg.

**Rationale**

The 2 h cap bounds console visits, not notes, so the second note has to ride the first visit; each
operation keeps its own artifacts, its own draft rail and its own Result entry, which is what makes the
deferred 发播客 half reportable without blocking the note the visit was opened for.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R0 | MET | Option (A) is the shipped shape: one console visit, one cap entry. `plugins/publishings/xhs-pub/src/index.ts:321` `this.automation.allow('publish')` and `:332` `this.automation.record('publish')` each execute once per `publish()`, before the single `:336` `this.openPage(profileDir)`, and the `:346-355` follow-up loop only appends per-operation Result entries to `metadata.followUps`. Executable pin: `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2237` `expect(recorded).toEqual(['publish'])` and `:2239` `expect(Object.keys(state)).toEqual(['publish'])` against a real `createAutomationGuard` state file, followed at `:2248` by `expect(second.error).toContain('automation cap')` for the second call, which never reaches `openPage`. No guard bypass and no second `KK_XHS_AUTOMATION_STATE` file anywhere in the diff. Decision recorded at `docs/00_ADR.md:1049` (ADR-025 amendment 2026-10-09); surface at `docs/04_DESIGN.md:1006`. Single-file suite: 112 pass / 0 fail. |
| R1 | MET | `plugins/kk/scripts/daily-stages.ts:905-921` `xhsPodcastNote` reads the run's own `31-publish/<date>_13_publish-prep_content.json`, spreads it unchanged and adds only `metadata.operation: '发播客'` (`:916`), `metadata.audio: metadata.audioFile` (`:917`, the key `plugins/publishings/xhs-pub/src/modes.ts:282-291` reads) and the run's `publishStatus`; no artifact is produced. It is attached only when the trailing arg is `'true'`: `:870` `const followUp = podcast === 'true' ? xhsPodcastNote(prep, want) : undefined;` plus `:877` `...(followUp === undefined ? {} : { followUps: [followUp] })`, where `:857` `const want = live === 'true' ? 'public' : 'draft'` derives the status from `xhs_live`. Executable pin: `apps/cli/tests/kk-workflow-stages.test.ts:1671-1679` asserts the follow-up metadata `toEqual` the prep fixture's `audioFile`/`coverImage` plus `operation: '发播客'` and `publishStatus: 'draft'` for `xhs_live=false`, and `:1657-1662` asserts the 4-arg voice1 call still packages the pre-0236 图文 Content `toEqual` its old shape. Targeted run: 2 pass / 0 fail (98 filtered). |
| R2 | MET | The flow uploads exactly that episode's mp3 and that cover, as one episode, without an RSS import. `plugins/publishings/xhs-pub/src/flow.ts:433-455` `composePodcast` enters 发播客, clicks the 上传音频 control (`:438`), finds the modal (`:440`), uploads `input.audio` into `PODCAST_AUDIO_INPUT` (`:447`) and `input.cover` into `PODCAST_COVER_INPUT` (`:454`). Executable pin: `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2211` `expect(uploads(visitedPage(calls))).toEqual([[img(0), img(1)], [episodeMp3], [episodeCover]])` — exact equality, so the 图文 batch then that mp3 then that cover, nothing else; `:2215` asserts no click on `添加RSS订阅`. The audio/cover values reaching the flow are the prep's own paths, validated pre-browser by `plugins/publishings/xhs-pub/src/modes.ts:282-297`. |
| R3 | MET | MET on the implemented fallback branch only. `plugins/publishings/xhs-pub/src/flow.ts:415-431` `leavePodcastModal` still refuses the publish-adjacent advance on a draft (`PODCAST_MODAL_ADVANCE = ['去发布']`, `plugins/publishings/xhs-pub/src/flow.ts:61`) and throws at `:428-430` with `its post-attach save path has never been measured (task 0236 R3 — the attended walk is still pending)`; the diff of `flow.ts` changes only that doc comment and that error string — no draft-save selector was invented. The throw is that operation's own `ok:false`: `plugins/publishings/xhs-pub/src/index.ts:371-410` `runStep` converts every failure into a failed Result, and `plugins/publishings/xhs-pub/src/index.ts:346-355` merges follow-ups into the primary's metadata, so it never fails the visit. Executable pin: `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2259` `expect(result.metadata?.draftSignal).toBe('draft-row')` (primary stands), `:2261` `expect(followUps[0]?.ok).toBe(false)`, `:2263` `expect(followUps[0]?.error).toContain('去发布')`, `:2264` `expect(followUps[0]?.error).toContain('never been measured')`, `:2266` no 去发布 click. PLAINLY: the operator-attended walk was NOT performed — `.spur/run/discovery/xhs-podcast-postfile.json` does not exist in the project tree (only `xhs-podcast-dialog.json` from the earlier modal-open capture), so the modal's post-attach save path is unmeasured and nothing claims a console save. Judged against the operator's recorded decision (R3 met on the fallback branch, not failed for the deferred walk). |
| R4 | MET | (i) No `public` claim without `xhs_live`: `plugins/kk/scripts/daily-stages.ts:857` maps anything but `'true'` to `draft` for both notes, and `plugins/publishings/xhs-pub/src/index.ts:389` re-forces `content.metadata?.publishStatus === 'public' ? 'public' : 'draft'` per operation; pinned by `apps/cli/tests/kk-workflow-stages.test.ts:1678` (`publishStatus: 'draft'` on the follow-up) and `:1681` (`packaged.metadata.publishStatus` draft) and by `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2214` (no 去发布 click on a draft visit). (ii) `kk-daily-ai-voice.yaml` byte-identical: `apps/cli/tests/voice2-dag.test.ts:499-509` re-runs `git diff --exit-code -- plugins/kk/workflows/kk-daily-ai-voice.yaml` in-process and expects exit 0; the same command run directly returned exit 0. (iii) The 上传图文 note (0235) is untouched by this task: `flow.ts` changed only the two comment/error lines above, and the full `xhs-pub` file stays 112 pass / 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Evidence 1 (offline scripted `XhsPage`) — `bun test plugins/publishings/xhs-pub/tests/xhs-pub.test.ts` → 112 pass / 0 fail, 449 expect() calls. The 0236 block proves the visit uploads exactly that mp3 and that cover as one episode (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2211`, `toEqual([[img(0), img(1)], [episodeMp3], [episodeCover]])`), that 去发布 is never clicked on a draft (`:2214`, `:2266`) and that the RSS path is never touched (`:2215`). Evidence 2 (stage test) — `bun test apps/cli/tests/kk-workflow-stages.test.ts -t '0236'` → 2 pass / 0 fail (98 filtered); `apps/cli/tests/kk-workflow-stages.test.ts:1671-1679` shows the built 发播客 Content's `audioFile`/`coverImage` equal the publish-prep fixture's, `operation` = `发播客`, `publishStatus` = `draft` for `xhs_live=false`, and `:1657` keeps the voice1 shape. Evidence 3 (cap, R0) — `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2237/:2239` show exactly one `automation.record('publish')` and one `publish` key in the guard state file for the two-note visit. Evidence 4 (attended live) is DEFERRED by the operator decision of 2026-10-09 and is NOT claimed: `.spur/run/discovery/xhs-podcast-postfile.json` does not exist and the 草稿箱→播客笔记 check was not performed, because the modal's post-attach save path is unmeasured. This AC is certified on evidence 1-3 plus the fallback branch of R3 (refused 去发布, entry `ok:false` naming the gap, non-blocking). |
| R2 — The 发播客 note uploads the episode mp3 and cover as one episode | MET | test | G12 scenario R2 (verbatim title, `docs/features/G12_xhs-notes-for-ai-and-single-episode.md:38`). Given a voice2 episode with its mp3 and cover / When the 发播客 draft is prepared / Then the flow opens 上传音频 and uploads that mp3 and that cover — `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2211` `expect(uploads(visitedPage(calls))).toEqual([[img(0), img(1)], [episodeMp3], [episodeCover]])` over the production `composePodcast` path (`plugins/publishings/xhs-pub/src/flow.ts:438-454`). And it does not import an RSS feed — `:2215` `expect(clicked(visitedPage(calls)).some((selector) => selector.includes('添加RSS订阅'))).toBe(false)`. And a draft run does not click 去发布 — `:2214`. And xhs-pub records operation 发播客 — `:2208` `expect(followUps[0]?.metadata?.operation).toBe('发播客')` with the draft status at `:2209`. Ran `bun test plugins/publishings/xhs-pub/tests/xhs-pub.test.ts`: 112 pass / 0 fail. Not verified by this scenario: the 发播客 modal's post-attach save path (R3's deferred attended walk, see above); nothing here claims a saved console draft. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Re-review after the remediation cycle (native subagent, fresh context, read-only): **Verdict PASS** — no outstanding P1/P2/P3; R0–R4 and AC1 evidence 1–3 MET. Full report: `.spur/run/703bf01b-b950-4b5e-a0d3-6834b977a3e0-review-answer.txt`.

| Priority | Finding | Evidence | Disposition |
| --- | --- | --- | --- |
| P1 (blocker) | The voice2 DAG never ordered `publish-prep` before `xhs-publish`, so the 发播客 half was silently dropped (the node logged `no publish-prep Content … skipped` and still exited 0). | Reader `plugins/kk/scripts/daily-stages.ts:906-910`; writer `plugins/kk/workflows/kk-daily-ai-voice2.yaml:449-451`; pre-fix edge `:547-549` | FIXED in this run (test-fix attempt 1/2, re-certified): `dependsOn: [xhs-render, publish-prep]` at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:553` with a WHY comment, pinned by the order-sensitive assertion `apps/cli/tests/voice2-dag.test.ts:496`; negative control (edge removed → 1 fail; restored hash-verified) and a full gate re-run at the post-fix digest (`0236-check-receipt.json` `sha256:2a9eb968…`, PASS, 268 s, 2359 pass / 2 skip / 0 fail). |
| P2 (major) | None. | — | — |
| P3 (minor) | None. | — | — |
| P4 (advisory) | Failed/refused follow-up Results lose their identity (no `metadata.operation`). | `plugins/publishings/xhs-pub/src/index.ts:348-355` | Recorded; stamp the operation on the entry. |
| P4 (advisory) | The stage cache hides a half-done visit (primary status only). | `plugins/kk/scripts/daily-stages.ts:861-864`; `plugins/kk/scripts/kk-workflow-stages.ts:1066-1071` | Recorded; needs a per-operation cache key. |
| P4 (advisory) | The `metadata.audio` boundary alias is right, but the repo's documented spelling (`metadata.audioFile`) diverges from the 发播客 mode key (`audio`). | `plugins/kk/scripts/daily-stages.ts:914`; `plugins/publishings/xhs-pub/src/modes.ts:144-149` | Recorded; optional hardening — accept both keys. |
| P4 (advisory) | New side effect of the fix: the stage's guard is a presence check with no run-ownership stamp, so a stale `25-xhs/content.json` from an earlier aborted same-day run could be re-published as a draft by a run with `xhs_enabled=false`. Narrow (needs a prior aborted run), draft-only. | `plugins/kk/scripts/daily-stages.ts:853`, `:865-868` | Recorded, report-only; optional hardening: one DAG case with `publish_enabled=true, xhs_enabled=false`. |
| P4 (advisory) | The G12 feature table lags one `spur feature refresh` (0236 listed `todo`). | `docs/features/G12_xhs-notes-for-ai-and-single-episode.md:53` | Recorded; do not hand-edit (auto-generated). |

**Resolved in this run (history, not an outstanding finding).** The first review returned `Verdict FAIL` with one P1: the voice2 DAG never ordered `publish-prep` before `xhs-publish`, so the 发播客 half was silently dropped. Remediated in the bounded `test-fix` hop (attempt 1 of 2) and re-certified: `dependsOn: [xhs-render, publish-prep]` at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:553` with a WHY comment, pinned by `apps/cli/tests/voice2-dag.test.ts:496` (order-sensitive `toEqual`), with a negative control (edge removed → 1 fail; restored hash-verified) and a full gate re-run at the post-fix digest (`.spur/run/0236-check-receipt.json` `sha256:2a9eb968…`, PASS, 268 s, 2359 pass / 2 skip / 0 fail).

**Residual risk.** The operator-attended walk (R3 / AC1 evidence 4) is deferred, recorded 2026-10-09: the modal's post-attach save path stays unmeasured, so the draft 发播客 entry reports `ok:false` and cannot claim a console save. The 图文 note is unaffected.

**Review limitation.** The reviewer context exposes no shell and no write tool — no command was executed by it; verdicts rest on static reading against the clean base checkout `a54c1f6d` plus the recorded gate artifacts, and this report was persisted by the host verbatim.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-09T18:30:40.268Z backlog → todo (system)
- 2026-10-10T01:30:16.337Z todo → wip (system)
- 2026-10-10T01:54:56.221Z wip → testing (system)
- 2026-10-10T01:55:42.258Z testing → done (system)

