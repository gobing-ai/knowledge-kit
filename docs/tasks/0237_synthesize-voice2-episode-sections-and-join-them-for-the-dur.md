---
schema_version: 1
name: Synthesize voice2 episode sections and join them for the duration check
status: done
template: feature-impl
created_at: 2026-10-09T07:35:29.460Z
updated_at: "2026-10-09T19:39:05.525Z"
feature_id: G13
priority: P0
tags:
  - voice2
  - audio
estimate_hours: 8

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0237-verdict.json
---

## 0237. Synthesize voice2 episode sections and join them for the duration check

### Background

Implements: R1 — Selected items become an opening, one section each, and a closing; R2 — Each section keeps its own audio file across a retry; R3 — Joined speech plus the intro sting is the episode the duration check reads; R4 — Everyday synthesis converts one section at a time; R5 — An over-long episode re-synthesizes only changed sections; R6 — An account-level provider refusal stops and keeps finished sections.

- Rubric: E2 D1 L1 C1 R1 = 6. Cohesion keeps one task: every scenario lands in `dailyGenerate` plus the existing intro and duration readers. A second task would edit the same function.
- Rejected split: one task per scenario. Rejected split: a separate recovery task. Both would share `plugins/kk/scripts/daily-stages.ts`.
- Pre-batch quiz auto-skipped because profile=auto.
- Deferred: inventory I9, synthesizing more than one section at a time.

### Requirements

- [x] R1. Six selected items become one opening, six item sections, and one closing. Fact chunks stay inside their item.
- [x] R2. A section whose audio file exists and whose spoken text is unchanged is not synthesized again. A section with no audio file, or whose spoken text changed, is synthesized to its own file.
- [x] R3. Section speech is joined in order, the existing intro sting is applied after that speech, and the duration check reads that one file. An episode outside 15 to 20 minutes is refused. The voice1 workflow file stays byte-identical.
- [x] R4. With the everyday concurrency count of 1, one section is converted at a time. A concurrency count above 1 is refused in this delivery.
- [x] R5. After the spoken text of the long sections is shortened, only those changed sections are synthesized again. Unchanged sections keep their audio files.
- [x] R6. An account-level provider refusal stops the run and keeps the finished section files. The run does not switch driver in the middle of the episode.

### Acceptance Criteria

Evidence harness for every AC: a stage test in `apps/cli/tests/kk-workflow-stages.test.ts` (or a sibling `daily-generate-sections.test.ts`) that runs `kk stage daily-generate <work> <date> <plugins> "" <vdriver> 1` with a PATH shim for `kk executor run` which logs each call's input and writes a short ffmpeg-generated mono wav plus a content json with `metadata.duration`. Fixture: a VoiceScript yaml built by `buildNewsVoiceScript` for 6 items (one item long enough to produce ≥2 fact chunks) and a matching `_08_script-write_plan.json`.


- [x] AC1 — Selected items become an opening, one section each, and a closing
  - Evidence: Given 6 items, when generate runs, then exactly 8 driver calls are made (opening, 6 items, closing), every fact chunk of an item lands in that item's call, and `30-audio/sections/<date>/` holds `00-opening … 07-closing` wav+json; a plan with 5 items fails before any call (req: R1).
- [x] AC2 — Each section keeps its own audio file across a retry
  - Evidence: Given a completed run, when generate runs again with no change, then 0 driver calls are made and the joined speech is reused; after deleting `03-item.wav`, exactly 1 call is made, for that section (req: R2).
- [x] AC3 — Joined speech plus the intro sting is the episode the duration check reads
  - Evidence: The joined file's sample count equals the sum of section samples plus each boundary's `gap_ms` silence (±1 frame); `_11_generate_content.json` points `audioPath` at it with `introMerged` cleared; `kk stage daily-intro` then `daily-episode-duration` read it unchanged; `git diff --exit-code plugins/kk/workflows/kk-daily-ai-voice.yaml plugins/generations/dailynews-gen/src/script-builder.ts` is clean; the five-arg command still makes exactly 1 driver call (req: R3).
- [x] AC4 — Everyday synthesis converts one section at a time
  - Evidence: With concurrency `1` the shim never observes two calls overlapping (calls logged with start/end); with `2` the stage exits nonzero naming `section_concurrency` before any call (req: R4).
- [x] AC5 — An over-long episode re-synthesizes only changed sections
  - Evidence: After editing one item's insight text in the VoiceScript yaml, exactly 1 driver call is made, for that section; a fixture whose character-rate estimate exceeds 20 min exits nonzero naming the three longest sections and makes 0 driver calls (req: R5).
- [x] AC6 — An account-level provider refusal stops and keeps finished sections
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

`dailyGenerate` gains an optional sixth argument and a second, segmented path; the five-argument
(voice1) path is byte-identical in behaviour.

| Change | Location | Rationale |
| --- | --- | --- |
| Sixth arg read; absent/empty → the untouched one-shot path (`timed(...)` early `return`) | `plugins/kk/scripts/daily-stages.ts:390,409-467` | R3: the voice1 command passes five args, so its behaviour and the byte-identical workflow file both hold. |
| `section_concurrency !== '1'` → `failWith` before any request | `plugins/kk/scripts/daily-stages.ts:469-471` | R4: concurrency above 1 is refused in this delivery; the guard runs before the plan/cache work, so nothing is spent. |
| Grouping: `segments[0]` = opening, `segments[last]` = closing, middle split **after** each `gap_ms: 1200` segment | `plugins/kk/scripts/daily-stages.ts:476-512` | R1: fact chunks (`gap_ms: 500`) stay inside their item; the inter-item breath (1200) is the item boundary. The builder is not edited, so voice1 script bytes are unchanged. |
| Plan cross-check: item-section count vs `_08_script-write_plan.json` `items.length` | `plugins/kk/scripts/daily-stages.ts:498-511` | R1/AC1: a mismatch fails the stage before any request. |
| `SectionDef` assembly (index, role, stem, segments, characters, trailing `gap_ms`, text) | `plugins/kk/scripts/daily-stages.ts:515-570` | R1/R3: the trailing `gap_ms` is the boundary silence the join uses; `characters` feeds the estimate. |
| Character-rate estimate: `8 s + totalChars / rate > 1200 s` → `failWith` naming the three longest sections | `plugins/kk/scripts/daily-stages.ts:572-582` | R5/design §5: an over-long episode spends nothing and names what to shorten. Gemini ≈ 3.3 字/秒, voicebox ≈ 6.3 字/秒 (`plugins/kk/scripts/daily-voice-style.zh.md:32`). |
| Voice profile resolution (script `default_profile_id` → `default_profile` → `VOICEBOX_DEFAULT_PROFILE` → `robin-news`) | `plugins/kk/scripts/daily-stages.ts:584-588` | R2: the profile id is part of the cache key, mirroring `dailyWrapDocs`'s profile choice. |
| `computePlans(driver)`: sha256(`text` NUL `profile` NUL `driver`) vs the section sidecar; reuse iff the wav exists **and** the hash matches | `plugins/kk/scripts/daily-stages.ts:600-636` | R2/R5/design §3: resume is "missing audio or hash mismatch", never "the latest index". The driver is in the key, so a driver change re-synthesizes every section and no mixed-voice episode is possible. |
| Early return when every section is cached **and** the joined wav + content exist | `plugins/kk/scripts/daily-stages.ts:639-643` | R2/AC2: a no-change re-run makes 0 driver calls and reuses the joined speech (the section path deliberately does not honour `qc.passed`, per design §3). |
| Gemini quota probe moved before the section loop, recomputing plans against the fallback driver | `plugins/kk/scripts/daily-stages.ts:645-686` | Design §7: the probe applies only before any section request; the driver is in the cache key, so a voicebox fallback re-synthesizes all sections locally rather than mixing voices. |
| Per-section synthesis: one-section VoiceScript Doc → `kk executor run <driver>`; any non-zero exit → `failWith` (no next section, no driver switch) | `plugins/kk/scripts/daily-stages.ts:688-750` | R6/design §7: an account-window refusal stops the run; finished section files stay on disk and the next run resumes the missing ones. The Doc shape matches `dailyWrapDocs`, so drivers need no change. |
| Join: `aresample` → s16 mono at the first section's rate, one `anullsrc`/`atrim` silence per boundary at that section's trailing `gap_ms`, single `concat` | `plugins/kk/scripts/daily-stages.ts:752-775` | R3/AC3: the same normalisation `dailyIntro` applies, so the joined sample count is exactly the section samples plus the boundary silences. |
| Content rewrite: `metadata.audioPath`/`metadata.duration` set, `introMerged` cleared | `plugins/kk/scripts/daily-stages.ts:777-795` | R3: `dailyEpisodeDuration` reads this `metadata.duration`; clearing `introMerged` makes the existing `dailyIntro` sting run again over the new speech. |
| `generate` node passes `"1"` as the sixth argument | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:425` | R4: the everyday voice2 run takes the segmented path with concurrency 1. `kk-daily-ai-voice.yaml` is untouched. |
| Design status flipped to implemented; §7.3 doc index row updated | `docs/design/segmented-episode-speech.md:3`, `docs/04_DESIGN.md:51` | T3: the surface (workflow node command, stage signature) changed in this commit. |

Rejected: editing `script-builder.ts` to emit sections (would change voice1 script bytes); a spur
parallel node (the engine does not fan out); one request per 300-character fact chunk (finer than
the operator's rewrite unit).

Ceiling (`shortcut:`): `section_concurrency` above 1 is refused rather than implemented, and a
single section that still exceeds one driver request is not split; both are deferred by design
(inventory I9, design §1). Upgrade when a driver rejects a section.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Opening, one section per item, closing, with fact chunks kept inside their item: grouping at `plugins/kk/scripts/daily-stages.ts:476-570` (first segment opening, last closing, middle split after each `gap_ms: 1200`). `apps/cli/tests/daily-generate-sections.test.ts` asserts exactly 8 driver calls, `30-audio/sections/<date>/00-opening … 07-closing` wav+json pairs, and that a 5-item plan exits non-zero with 0 calls. |
| R2 | MET | Per-section cache: sha256(`text` NUL `profile` NUL `driver`) compared against the section sidecar at `plugins/kk/scripts/daily-stages.ts:600-636`. `apps/cli/tests/daily-generate-sections.test.ts` asserts 0 driver calls on an unchanged re-run and exactly 1 call addressed to `03-item.json` after deleting `03-item.wav`. |
| R3 | MET | Join at `plugins/kk/scripts/daily-stages.ts:752-795` (aresample to the first section rate, s16 mono, one `atrim` silence per boundary from that section trailing `gap_ms`, single `concat`), then `metadata.audioPath` and `metadata.duration` written with `introMerged` cleared. `apps/cli/tests/daily-generate-sections.test.ts` asserts joined samples equal the sum of section samples plus boundary silences at 24000 Hz, and that `git diff --exit-code plugins/kk/workflows/kk-daily-ai-voice.yaml plugins/generations/dailynews-gen/src/script-builder.ts` is clean. `dailyEpisodeDuration` at `plugins/kk/scripts/daily-stages.ts:364-386` is untouched and still refuses outside 15–20 min. |
| R4 | MET | Concurrency guard at `plugins/kk/scripts/daily-stages.ts:469-471` refuses any value other than `1` before any request; the synthesis loop at `plugins/kk/scripts/daily-stages.ts:688-750` is strictly sequential. `apps/cli/tests/daily-generate-sections.test.ts` asserts no interleaved start/end events at concurrency 1, and that `2` exits non-zero naming `section_concurrency` with 0 calls. |
| R5 | MET | Character-rate estimate gate at `plugins/kk/scripts/daily-stages.ts:572-582` (`8 s + characters / rate > 1200 s` fails naming the three longest sections) runs before any request. `apps/cli/tests/daily-generate-sections.test.ts` asserts exactly 1 call after editing one item text and 0 calls plus a non-zero exit on an inflated fixture. |
| R6 | MET | Section failure handling at `plugins/kk/scripts/daily-stages.ts:688-750`: any non-zero exit calls `failWith`, so no further section is requested and the driver is never reassigned mid-loop. `apps/cli/tests/daily-generate-sections.test.ts` asserts the 4th call failing leaves sections 00–02 on disk, makes no 5th call, keeps `vdriver`, and that the next run makes exactly the remaining 5 calls. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Selected items become an opening, one section each, and a closing | MET | test | `apps/cli/tests/daily-generate-sections.test.ts` — exactly 8 `start` events; `sections/<date>/00-opening … 07-closing` wav+json; 5-item plan fails pre-call. |
| R2 — Each section keeps its own audio file across a retry | MET | test | `apps/cli/tests/daily-generate-sections.test.ts` — 0 calls on an unchanged re-run; 1 call addressed to `03-item.json` after `rm 03-item.wav`. |
| R3 — Joined speech plus the intro sting is the episode the duration check reads | MET | test | `apps/cli/tests/daily-generate-sections.test.ts` — joined sample count equals section samples plus boundary `gap_ms` at 24000 Hz; `audioPath` points at the joined file with `introMerged` absent; the five-arg command still makes exactly 1 call; `git diff --exit-code plugins/kk/workflows/kk-daily-ai-voice.yaml plugins/generations/dailynews-gen/src/script-builder.ts` is clean. |
| R4 — Everyday synthesis converts one section at a time | MET | test | `apps/cli/tests/daily-generate-sections.test.ts` — no overlapping start/end at concurrency 1; `2` exits non-zero naming `section_concurrency` with 0 calls. |
| R5 — An over-long episode re-synthesizes only changed sections | MET | test | `apps/cli/tests/daily-generate-sections.test.ts` — 1 call after editing one item text; the inflated fixture exits non-zero naming the longest sections with 0 calls. |
| R6 — An account-level provider refusal stops and keeps finished sections | MET | test | `apps/cli/tests/daily-generate-sections.test.ts` — failing the 4th call leaves 00–02 on disk, makes no 5th call, keeps `vdriver`; the next run makes exactly the remaining 5 calls. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

**Gate re-run on the integrated tree (final evidence).** The batch branch was rebased onto `main`
(`e75232ff`) after the two commits, because `main` advanced while this batch ran — so the numbers above
(from the pre-rebase base) are superseded. On the rebased tree, whose diff against `main` is exactly
this batch's 9 files:

```
bun run gate        # format + build + lint + typecheck + rules + tests    exit 0
  Checked 401 files in 379ms. No fixes applied.        (biome)
  2355 pass, 2 skip, 0 fail                            (full suite)
```

`git diff --stat main` = 1267 insertions / 91 deletions across 9 files, all owned by 0237 and 0238.

### Review

**Disposition: PASS — no P1/P2 findings.**

| Priority | Finding | Location | Action |
| --- | --- | --- | --- |
| P1 | — none — | | |
| P2 | — none — | | |
| P3 | The Gemini probe plus `kk executor run` one-shot body now exists twice (the untouched voice1 path and the section path keep separate copies). | `plugins/kk/scripts/daily-stages.ts:409-467` | Deferred: extracting it would re-open the voice1 code path R3 requires to stay byte-identical, for ~30 lines. Merge when voice1 retires. |
| P3 | Sidecar read and prior-content re-read are wrapped in `catch {}`. | `plugins/kk/scripts/daily-stages.ts:625-630`, `783` | Accepted by design: a missing or corrupt sidecar must read as "not cached" and re-synthesize, and a missing prior content file must produce a fresh object. Neither can mask a request failure — those are the explicit `spawnSync` status checks. |
| P3 | Character counts use `[...text].length` (code points), not bytes. | `plugins/kk/scripts/daily-stages.ts:533,552,565` | Correct unit: the driver rates are 字/秒, so code points are what the estimate needs. Not exercised against a surrogate-pair fixture; the under-count risk is bounded by the 20-minute headroom and the authoritative downstream `dailyEpisodeDuration` gate. |
| P4 | `SectionDef` / `SectionPlan` interfaces are module-local inside the `timed` callback. | `plugins/kk/scripts/daily-stages.ts:515,606` | Fine for a single stage body. Hoist only if a second stage needs them. |

Residual risk: the character-rate estimate is an estimate — a wrong rate changes *when* the stage
refuses, never whether the final duration is checked; `dailyEpisodeDuration` stays authoritative. The
live voice2 dry run named in Testing was not executed in this session (it spends external provider
quota), so the join is unverified against real driver output.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-09T19:17:35.953Z todo → wip (system)
- 2026-10-09T19:22:56.228Z wip → testing (system)
- 2026-10-09T19:23:16.350Z testing → done (system)

