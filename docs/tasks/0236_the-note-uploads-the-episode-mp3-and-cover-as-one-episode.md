---
schema_version: 1
name: The 发播客 note uploads the episode mp3 and cover as one episode
status: backlog
template: feature-impl
created_at: 2026-10-09T06:24:08.594Z
updated_at: "2026-10-09T18:15:51.863Z"
feature_id: G12

priority: P2
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

- [ ] R0. **Operator decision on the cap (gate before todo).** Choose how 发播客 fits inside ADR-025's one-publish-per-2h guard. Do not bypass the guard. Do not use a second `XHS_AUTOMATION_STATE` file to dodge it; that variable is reserved for a deliberate second profile. Recommended: **(A)** one xhs-pub visit composes both notes. Record the decision as an ADR-025 amendment.
- [ ] R1. voice2 builds a 发播客 Content from the publish-prep Content: the same `audioFile` (final mp3 with the intro) and `coverImage`, plus `metadata.operation: '发播客'` and `publishStatus` from `xhs_live`. No new artifacts.
- [ ] R2. The flow clicks 上传音频, attaches that mp3 and that cover, and fills any required modal field the attended measurement finds. It does not import an RSS feed.
- [ ] R3. **Attended measurement first.** Before any flow change, one operator-attended walk records what the modal offers after both files attach, saved as `.spur/run/discovery/xhs-podcast-postfile.json` plus a screenshot.
  - If a save path other than 去发布 exists, wire it as the draft action, with the draft claimed only from the console signal, as 图文 is.
  - If none exists, the draft run stops before 去发布, as `leavePodcastModal` does today. The result is `ok: false` with `error` naming the gap, and it is non-blocking for the run.
- [ ] R4. With `xhs_live` unset or false, no result claims `publishStatus: public`. `kk-daily-ai-voice.yaml` stays byte-identical. The 上传图文 note (0235) is unchanged by this task.

### Acceptance Criteria

- [ ] AC1 — The 发播客 note uploads the episode mp3 and cover as one episode
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

### Design

**Superseded:** "add the 发播客 step beside the 图文 step." The 2 h cap refuses a second `xhs-pub` call in the same run (Background).

**Recommended (A): one visit, two notes.** `dailyPublishXhs` (`plugins/kk/scripts/daily-stages.ts:846`) sends one Content to `xhs-pub` whose `metadata.followUps` holds the 发播客 Content.
- xhs-pub runs the primary 上传图文 compose → draft, returns to the creator landing, then runs `composePodcast` in the **same** browser session.
- Each operation gets its own Result entry; the aggregate is non-blocking.
- One `allow('publish')` check and one `record('publish')` cover the visit.

Changes:
- `xhs-pub/src/index.ts` (loop over `[primary, ...followUps]` after the one cap check);
- `dailyPublishXhs` (attach the follow-up only when a new trailing arg `podcast=true` is passed by voice2; voice1 passes nothing);
- the voice2 `xhs-publish` node (pass the arg);
- ADR-025 amendment;
- `04_DESIGN.md` (T3).

Alternatives:
- **(B)** A separate 发播客 run ≥2 h later, from a launchd job. No guard change, but it is a second scheduled job and a second console visit per day.
- **(C)** 发播客 only on days 图文 is off. No change, but the episode loses one channel per day.

Draft action after the files attach comes from R3's attended measurement. Do not invent a selector.

### Plan

1. **R0:** get the operator's choice (A/B/C) and write the ADR-025 amendment. Until then, stay in backlog.
2. **R3:** run the attended walk with the operator present. Save `xhs-podcast-postfile.json` and a screenshot, and update `docs/design/xhs-ui-discovery.md`.
3. Write tests first (AC1 evidence 1–3): an xhs-pub offline test for the follow-up loop and the no-去发布 rail; a stage test for building the 发播客 Content; a guard-state assertion.
4. Implement option (A), or the chosen option. If R3 found a draft save path, wire it into `leavePodcastModal`; otherwise keep the refusal and give the result an explicit `error`.
5. Pass the voice2 `xhs-publish` arg. Update `04_DESIGN.md` (T3).
6. Run `bun run gate` from a worktree until 0242 R6 lands. Then do one attended dry run, check the 草稿箱 → 播客笔记 in the kk profile, and record the run id.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
