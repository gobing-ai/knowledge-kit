---
schema_version: 1
name: The 发播客 note uploads the episode mp3 and cover as one episode
status: done
template: feature-impl
created_at: 2026-10-09T06:24:08.594Z
updated_at: "2026-10-10T03:20:24.104Z"
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
- `plugins/kk/workflows/kk-daily-ai-voice2.yaml:553-568` — the `xhs-publish` node passes the fifth arg
  `"true"`; its description names the same-visit follow-up. `kk-daily-ai-voice.yaml` is untouched
  (`git diff --exit-code` clean) and stays on the 4-arg call.
- `docs/04_DESIGN.md:1006` (xhs-pub visit semantics) and `:1186` (the `daily-publish-xhs [<podcast>]`
  row) — T3 surface for the new arg, the `metadata.followUps` contract and the unmeasured save path.
- `docs/00_ADR.md` — **not** edited: ADR-025 already carries the 2026-10-09 amendment "one visit may
  compose several notes" (`docs/00_ADR.md:1049`).

**Tests (written first, then the implementation)**

- `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2143-2319` — offline `XhsPage` suite: the one
  visit composes both notes and uploads exactly that mp3 and that cover after the 图文 batch; one
  `record('publish')` and one guard-state key per visit (a second call is refused by the cap); the
  deferred modal path fails only the 发播客 entry (non-blocking, 去发布 never clicked); a refused
  follow-up never touches the console; an unplannable entry / malformed `followUps` is handled.
- `apps/cli/tests/kk-workflow-stages.test.ts:1665-1792` — the stage builds the 发播客 Content only when
  the trailing arg is passed (audioFile/coverImage equal the prep fixture's, `operation` 发播客,
  `publishStatus` draft for `xhs_live=false`), and skips it — naming the missing prep — when absent.
- `apps/cli/tests/voice2-dag.test.ts:483-491` — voice2's node passes the arg.

**Rationale**

The 2 h cap bounds console visits, not notes, so the second note has to ride the first visit; each
operation keeps its own artifacts, its own draft rail and its own Result entry, which is what makes the
deferred 发播客 half reportable without blocking the note the visit was opened for.

**Advisory closeout (2026-10-09, operator request "get all of them done").** Review P4s resolved in the working tree:

- Follow-up identity: `plugins/publishings/xhs-pub/src/index.ts:349-359` stamps `metadata.operation` on every follow-up entry (the planned operation, else the `followUps[<i>]` slot; the step's own metadata wins), so a failed or refused note is identifiable. Pinned at `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2266`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2283`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2315`.
- Half-done visit on a cache hit: `plugins/kk/scripts/daily-stages.ts:861-874` logs every recorded follow-up that did not complete (`publish-xhs cached: follow-up <op> did not complete: <error>`) and still does not re-visit, because a re-visit would post a second 图文 draft. Test `apps/cli/tests/kk-workflow-stages.test.ts:1764-1792`.
- Stale-series re-publish: `xhs-render` and `xhs-publish` carry their own `xhs_enabled` gate (`plugins/kk/workflows/kk-daily-ai-voice2.yaml:542-545`, `plugins/kk/workflows/kk-daily-ai-voice2.yaml:560-563`); pinned at `apps/cli/tests/voice2-dag.test.ts:499-508`. `docs/design/kk-collect-and-daily-voice2.md:245` and `docs/04_DESIGN.md:1006`/`:1186` updated in the same change (T3).
- `metadata.audio` alias: declined. The stage adapter (`plugins/kk/scripts/daily-stages.ts:928`) is the single mapping point; `xhs-pub` keeps one declared key.
- Gate hygiene (shared with 0235): `scripts/bundle-plugins.ts:39` excludes `.venv/`, so prepack no longer stages `plugins/generations/omni-voice-gen/.venv`; pinned at `scripts/bundle-plugins.test.ts:35`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R0 | MET | Forced re-verify 2026-10-09 against HEAD `4491347d` plus the 2026-10-09 advisory-closeout working tree; every anchor below re-read this run. One visit, one cap entry: `this.automation.allow('publish')` at `plugins/publishings/xhs-pub/src/index.ts:321` and `this.automation.record('publish')` at `plugins/publishings/xhs-pub/src/index.ts:332` run once per `publish()`, before the single `openPage` at `plugins/publishings/xhs-pub/src/index.ts:336`. Pinned at `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2237` (`recorded` equals `['publish']`) and `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2248` (second call refused with `automation cap`). Decision at `docs/00_ADR.md:1049`; surface at `docs/04_DESIGN.md:1006`. `bun test plugins/publishings/xhs-pub/tests/xhs-pub.test.ts` → 112 pass / 0 fail this run. |
| R1 | MET | `xhsPodcastNote` (`plugins/kk/scripts/daily-stages.ts:916`) spreads the run's own publish-prep Content and adds only `operation: '发播客'` (`plugins/kk/scripts/daily-stages.ts:927`) and `audio: metadata.audioFile` (`plugins/kk/scripts/daily-stages.ts:928`, the key the 发播客 validation reads at `plugins/publishings/xhs-pub/src/modes.ts:282-286`); attached only when the trailing arg is `'true'` (`plugins/kk/scripts/daily-stages.ts:881`, `plugins/kk/scripts/daily-stages.ts:888`), with status from `xhs_live` (`plugins/kk/scripts/daily-stages.ts:857`). Pinned at `apps/cli/tests/kk-workflow-stages.test.ts:1733-1741` (follow-up metadata equals the prep fixture's audioFile/coverImage + 发播客 + draft) and `apps/cli/tests/kk-workflow-stages.test.ts:1715-1719` (voice1 4-arg shape unchanged). `bun test apps/cli/tests/kk-workflow-stages.test.ts -t '0235 |
| R2 | MET | `composePodcast` clicks the 上传音频 control (`plugins/publishings/xhs-pub/src/flow.ts:438`), uploads the audio (`plugins/publishings/xhs-pub/src/flow.ts:447`) and the cover (`plugins/publishings/xhs-pub/src/flow.ts:454`). Pinned at `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2211` (uploads exactly the 图文 batch, then that mp3, then that cover) and `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2215` (no 添加RSS订阅 click). 112 pass / 0 fail this run. |
| R3 | MET | MET on R3's own fallback branch, per the 2026-10-09 operator deferral: `leavePodcastModal` still refuses 去发布 on a draft (`plugins/publishings/xhs-pub/src/flow.ts:61`) and throws naming the unmeasured save path (`plugins/publishings/xhs-pub/src/flow.ts:428`); the follow-up becomes its own `ok:false` without failing the visit, pinned at `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2264` (`never been measured`). The attended walk was NOT performed: `.spur/run/discovery/xhs-podcast-postfile.json` is still absent; nothing claims a console save. |
| R4 | MET | Status maps anything but `'true'` to draft (`plugins/kk/scripts/daily-stages.ts:857`) and xhs-pub re-forces per operation (`plugins/publishings/xhs-pub/src/index.ts:393`); pinned at `apps/cli/tests/kk-workflow-stages.test.ts:1740` and `apps/cli/tests/kk-workflow-stages.test.ts:1743`. `git diff --exit-code plugins/kk/workflows/kk-daily-ai-voice.yaml` → 0 this run, re-asserted in-process by `apps/cli/tests/voice2-dag.test.ts:517-527`; `bun test apps/cli/tests/voice2-dag.test.ts` → 32 pass / 0 fail. The voice2 DAG orders publish-prep first (`plugins/kk/workflows/kk-daily-ai-voice2.yaml:559`, pinned at `apps/cli/tests/voice2-dag.test.ts:496`). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Evidence 1: `bun test plugins/publishings/xhs-pub/tests/xhs-pub.test.ts` → 112 pass / 0 fail this run; exact mp3 + cover uploads at `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2211`, no RSS at `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2215`. Evidence 2: `bun test apps/cli/tests/kk-workflow-stages.test.ts -t '0235 |
| R2 — The 发播客 note uploads the episode mp3 and cover as one episode | MET | test | G12 scenario R2: `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2211` over the production `composePodcast` path (`plugins/publishings/xhs-pub/src/flow.ts:438-454`), no RSS at `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2215`; 112 pass / 0 fail this run. The post-attach console save path remains unmeasured (R3 deferral). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Re-review after the remediation cycle (native subagent, fresh context, read-only): **Verdict PASS** — no outstanding P1/P2/P3; R0–R4 and AC1 evidence 1–3 MET. Full report: `.spur/run/703bf01b-b950-4b5e-a0d3-6834b977a3e0-review-answer.txt`.

| Priority | Finding | Evidence | Disposition |
| --- | --- | --- | --- |
| P1 (blocker) | The voice2 DAG never ordered `publish-prep` before `xhs-publish`, so the 发播客 half was silently dropped (the node logged `no publish-prep Content … skipped` and still exited 0). | Reader `plugins/kk/scripts/daily-stages.ts:917-921`; writer `plugins/kk/workflows/kk-daily-ai-voice2.yaml:449-451`; pre-fix edge at base `a54c1f6d` | FIXED in this run (test-fix attempt 1/2, re-certified): `dependsOn: [xhs-render, publish-prep]` at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:559` with a WHY comment, pinned by the order-sensitive assertion `apps/cli/tests/voice2-dag.test.ts:496`; negative control (edge removed → 1 fail; restored hash-verified) and a full gate re-run at the post-fix digest (`0236-check-receipt.json` `sha256:2a9eb968…`, PASS, 268 s, 2359 pass / 2 skip / 0 fail). |
| P2 (major) | None. | — | — |
| P3 (minor) | None. | — | — |
| P4 (advisory) | Failed/refused follow-up Results lose their identity (no `metadata.operation`). | `plugins/publishings/xhs-pub/src/index.ts:349-359` | FIXED 2026-10-09: every follow-up entry carries `metadata.operation` (planned operation, else its `followUps[<i>]` slot; the step's own metadata wins); pinned at `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2266`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2283`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:2315`. |
| P4 (advisory) | The stage cache hides a half-done visit (primary status only). | `plugins/kk/scripts/daily-stages.ts:861-874`; `plugins/kk/scripts/kk-workflow-stages.ts:1069-1074` | FIXED 2026-10-09 (visibility, not a per-operation key): a cache hit logs each recorded follow-up that did not complete (`publish-xhs cached: follow-up <op> did not complete: <error>`). A per-operation key is rejected on purpose: re-visiting for the 发播客 note would post a second 图文 draft (the console has no idempotency key). Test `apps/cli/tests/kk-workflow-stages.test.ts:1764-1792`. |
| P4 (advisory) | The `metadata.audio` boundary alias is right, but the repo's documented spelling (`metadata.audioFile`) diverges from the 发播客 mode key (`audio`). | `plugins/kk/scripts/daily-stages.ts:928`; `plugins/publishings/xhs-pub/src/modes.ts:144-149` | DECLINED 2026-10-09 with rationale: the stage adapter (`xhsPodcastNote`) is the single mapping point from the repo's `audioFile` to the channel's declared `audio` key; teaching `xhs-pub` a second spelling widens a plugin contract for a caller that does not exist. |
| P4 (advisory) | New side effect of the fix: the stage's guard is a presence check with no run-ownership stamp, so a stale `25-xhs/content.json` from an earlier aborted same-day run could be re-published as a draft by a run with `xhs_enabled=false`. Narrow (needs a prior aborted run), draft-only. | `plugins/kk/scripts/daily-stages.ts:853`, `plugins/kk/scripts/daily-stages.ts:876-879` | FIXED 2026-10-09: `xhs-render` and `xhs-publish` each carry `test "${vars.xhs_enabled}" = "true"` (`plugins/kk/workflows/kk-daily-ai-voice2.yaml:542-545`, `plugins/kk/workflows/kk-daily-ai-voice2.yaml:560-563`), since a skipped `xhs-write` still admits its dependents; pinned at `apps/cli/tests/voice2-dag.test.ts:499-508`. |
| P4 (advisory) | The G12 feature table lags one `spur feature refresh` (0236 listed `todo`). | `docs/features/G12_xhs-notes-for-ai-and-single-episode.md:53` | RESOLVED: the table now lists 0236 `done`. |

**Resolved in this run (history, not an outstanding finding).** The first review returned `Verdict FAIL` with one P1: the voice2 DAG never ordered `publish-prep` before `xhs-publish`, so the 发播客 half was silently dropped. Remediated in the bounded `test-fix` hop (attempt 1 of 2) and re-certified: `dependsOn: [xhs-render, publish-prep]` at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:559` with a WHY comment, pinned by `apps/cli/tests/voice2-dag.test.ts:496` (order-sensitive `toEqual`), with a negative control (edge removed → 1 fail; restored hash-verified) and a full gate re-run at the post-fix digest (`.spur/run/0236-check-receipt.json` `sha256:2a9eb968…`, PASS, 268 s, 2359 pass / 2 skip / 0 fail).

**Residual risk.** The operator-attended walk (R3 / AC1 evidence 4) is deferred, recorded 2026-10-09: the modal's post-attach save path stays unmeasured, so the draft 发播客 entry reports `ok:false` and cannot claim a console save. The 图文 note is unaffected.

**Review limitation.** The reviewer context exposes no shell and no write tool — no command was executed by it; verdicts rest on static reading against the clean base checkout `a54c1f6d` plus the recorded gate artifacts, and this report was persisted by the host verbatim.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-09T18:30:40.268Z backlog → todo (system)
- 2026-10-10T01:30:16.337Z todo → wip (system)
- 2026-10-10T01:54:56.221Z wip → testing (system)
- 2026-10-10T01:55:42.258Z testing → done (system)

