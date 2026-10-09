---
schema_version: 1
name: Synthesize voice2 episode sections and join them for the duration check
status: todo
template: feature-impl
created_at: 2026-10-09T07:35:29.460Z
updated_at: "2026-10-09T18:12:42.098Z"
feature_id: G13
priority: P0
tags:
  - voice2
  - audio
estimate_hours: 8

---

## 0237. Synthesize voice2 episode sections and join them for the duration check

### Background

Implements: R1 — Selected items become an opening, one section each, and a closing; R2 — Each section keeps its own audio file across a retry; R3 — Joined speech plus the intro sting is the episode the duration check reads; R4 — Everyday synthesis converts one section at a time; R5 — An over-long episode re-synthesizes only changed sections; R6 — An account-level provider refusal stops and keeps finished sections.

- Rubric: E2 D1 L1 C1 R1 = 6. Cohesion keeps one task: every scenario lands in `dailyGenerate` plus the existing intro and duration readers. A second task would edit the same function.
- Rejected split: one task per scenario. Rejected split: a separate recovery task. Both would share `plugins/kk/scripts/daily-stages.ts`.
- Pre-batch quiz auto-skipped because profile=auto.
- Deferred: inventory I9, synthesizing more than one section at a time.

### Requirements

- [ ] R1. Six selected items become one opening, six item sections, and one closing. Fact chunks stay inside their item.
- [ ] R2. A section whose audio file exists and whose spoken text is unchanged is not synthesized again. A section with no audio file, or whose spoken text changed, is synthesized to its own file.
- [ ] R3. Section speech is joined in order, the existing intro sting is applied after that speech, and the duration check reads that one file. An episode outside 15 to 20 minutes is refused. The voice1 workflow file stays byte-identical.
- [ ] R4. With the everyday concurrency count of 1, one section is converted at a time. A concurrency count above 1 is refused in this delivery.
- [ ] R5. After the spoken text of the long sections is shortened, only those changed sections are synthesized again. Unchanged sections keep their audio files.
- [ ] R6. An account-level provider refusal stops the run and keeps the finished section files. The run does not switch driver in the middle of the episode.

### Acceptance Criteria

Evidence harness for every AC: a stage test in `apps/cli/tests/kk-workflow-stages.test.ts` (or a sibling `daily-generate-sections.test.ts`) that runs `kk stage daily-generate <work> <date> <plugins> "" <vdriver> 1` with a PATH shim for `kk executor run` which logs each call's input and writes a short ffmpeg-generated mono wav plus a content json with `metadata.duration`. Fixture: a VoiceScript yaml built by `buildNewsVoiceScript` for 6 items (one item long enough to produce ≥2 fact chunks) and a matching `_08_script-write_plan.json`.


- [ ] AC1 — Selected items become an opening, one section each, and a closing
  - Evidence: Given 6 items, when generate runs, then exactly 8 driver calls are made (opening, 6 items, closing), every fact chunk of an item lands in that item's call, and `30-audio/sections/<date>/` holds `00-opening … 07-closing` wav+json; a plan with 5 items fails before any call (req: R1).
- [ ] AC2 — Each section keeps its own audio file across a retry
  - Evidence: Given a completed run, when generate runs again with no change, then 0 driver calls are made and the joined speech is reused; after deleting `03-item.wav`, exactly 1 call is made, for that section (req: R2).
- [ ] AC3 — Joined speech plus the intro sting is the episode the duration check reads
  - Evidence: The joined file's sample count equals the sum of section samples plus each boundary's `gap_ms` silence (±1 frame); `_11_generate_content.json` points `audioPath` at it with `introMerged` cleared; `kk stage daily-intro` then `daily-episode-duration` read it unchanged; `git diff --exit-code plugins/kk/workflows/kk-daily-ai-voice.yaml plugins/generations/dailynews-gen/src/script-builder.ts` is clean; the five-arg command still makes exactly 1 driver call (req: R3).
- [ ] AC4 — Everyday synthesis converts one section at a time
  - Evidence: With concurrency `1` the shim never observes two calls overlapping (calls logged with start/end); with `2` the stage exits nonzero naming `section_concurrency` before any call (req: R4).
- [ ] AC5 — An over-long episode re-synthesizes only changed sections
  - Evidence: After editing one item's insight text in the VoiceScript yaml, exactly 1 driver call is made, for that section; a fixture whose character-rate estimate exceeds 20 min exits nonzero naming the three longest sections and makes 0 driver calls (req: R5).
- [ ] AC6 — An account-level provider refusal stops and keeps finished sections
  - Evidence: When the shim fails the 4th call, the stage exits nonzero, makes no 5th call, does not switch `vdriver`, and sections 00–02 stay on disk; the next run makes exactly the remaining calls (req: R6).

Live check (Testing, not an AC): One live voice2 dry run produces a joined episode inside 15–20 min with the per-section files on disk; run id recorded in Testing (req: R3).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T18:12:20.269Z

- **Validity (refine 2026-10-09):** still valid and unimplemented — `dailyGenerate` (`plugins/kk/scripts/daily-stages.ts:389-453`) makes one `kk executor run <driver> --in <wrap-docs> --out <content>` call; no driver caches by segment (`plugins/generations/{gemini-tts,voice-gen}/src`). Design claims verified: fact chunks `gap_ms` 500 / inter-item 1200 (`plugins/generations/dailynews-gen/src/script-builder.ts:438,446`), `MAX_FACT_SEGMENT_CHARS` 300 (`:224`), rates in `daily-voice-style.zh.md:32`, `safetyDigest` (`kk-workflow-stages.ts:1082`).
- **What counts as an "account-level refusal" (R6)?** Any nonzero exit of a section request stops the stage. No error classification: gemini-tts already retries transient 429/5xx internally and fails loud past its retry cap (`gemini-client.ts:114-123`), so a failure that reaches the stage is not worth retrying on the next section.
- **Probe fails on a resume that has cached Gemini sections?** Fall back to voicebox as today; the driver is in the cache key, so voicebox re-synthesizes every section (local, unmetered). No mixed-voice episode is possible.
- **How is one section sent?** As a one-section VoiceScript yaml Doc (same shape `dailyWrapDocs` writes, `daily-stages.ts:1390-1411`), so drivers need no change.
- **Over-long section that exceeds one driver request?** Not seen at current caps (insight ≤380 chars). Deferred until a driver rejects a section; then split inside the section per design §1.
- **Order vs 0238/0242:** independent code; run `bun run gate` only from a worktree until 0242 R6 lands.

### Design

Approach: optional sixth argument `section_concurrency` on `dailyGenerate`. Voice2 passes `1`. An absent argument keeps today's one-request job, so the voice1 command and its behavior stay.

Why: the paid unit matches the section an operator rewrites.

Rejected:
- One request per 300-character fact chunk. That is finer than the rewrite unit. Use it only inside a section that still exceeds one request.
- A new workflow node, or a spur parallel node. Fan-out stays inside `kk`.
- Editing `script-builder.ts`. That would change voice1 script bytes.

Invariants:
- Sections are opening + one per spoken item + closing.
- Cache key is sha256 of section text, voice profile id, and resolved driver id.
- Resume is missing audio or a hash mismatch.
- Joined speech, then the existing intro sting. Duration stays 15–20 minutes.
- A character-rate estimate over 20 minutes spends nothing and names the longest sections. The stage does not rewrite the script.
- Account-window refusal stops the run. The Gemini probe fallback applies only when no section request has been sent yet.
- Shortening section text changes the VoiceScript yaml, so the safety stamp must be issued again. An unchanged section does not.

Signatures: `dailyGenerate(args: string[]): void` with an optional sixth argument. Satellite: `docs/design/segmented-episode-speech.md`. Decision: ADR-034.

### Plan

1. Tests first (AC1–AC6 evidence harness, see Acceptance Criteria): `kk executor run` PATH shim that logs calls and writes an ffmpeg sine wav + content json; 6-item `buildNewsVoiceScript` fixture. Run — all fail on today's one-shot generate. Work in a worktree until 0242 R6 lands (the suite migrates the live store).
2. `dailyGenerate` (`plugins/kk/scripts/daily-stages.ts:389`): read the sixth arg; absent/empty → today's path untouched; `>1` → `failWith` before any call.
3. Grouper over `24-script/<date>_08_script_voicescript.yaml`: first = opening, last = closing, middle split after each `gap_ms: 1200` segment; check count vs `_08_script-write_plan.json` `items.length`.
4. Character-rate estimate (driver rate + 8 s sting) → refuse >20 min naming the 3 longest sections, before any request.
5. Per section: sha256(text NUL voiceProfile NUL driverId) vs sidecar; on miss write a one-section VoiceScript Doc and `kk executor run`; any nonzero exit → stop (no next section, no driver switch). Keep the Gemini probe before the loop.
6. Join with ffmpeg (`aresample`/s16/mono as `dailyIntro`, trailing `gap_ms` silence); rewrite `_11_generate_content.json` with `audioPath`, `duration`, `introMerged` cleared.
7. `kk-daily-ai-voice2.yaml` generate node passes `"1"` as the sixth arg; update `docs/04_DESIGN.md` stage row (T3) and flip `docs/design/segmented-episode-speech.md` status to implemented.
8. `bun run gate` (worktree); live voice2 dry run → record run id, section files and duration in Testing.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
