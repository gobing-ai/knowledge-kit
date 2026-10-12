---
schema_version: 1
name: Wire VoxCPM into both daily workflows with driver-aware audio reuse
status: todo
template: feature-impl
created_at: 2026-10-12T00:07:13.360Z
updated_at: "2026-10-12T04:46:33.355Z"
feature_id: G14
priority: P2
estimate_hours: 4

dependencies: ["0256"]
---

## 0257. Wire VoxCPM into both daily workflows with driver-aware audio reuse

### Background

Both workflows reach dailyGenerate in plugins/kk/scripts/daily-stages.ts. Its alias map lacks voxcpm; the whole-document cache accepts any qc.passed audio. Section hashes include driver, but final joining preserves old metadata or an incomplete envelope. dailyPublishPrep requires an MP3. ensurePublishMp3 is now committed and called after render/cache/join; it skips transcoding when a recorded mp3Path already exists. Current joins also rebuild metadata.segments from section sidecars. Both YAML defaults and robin-news names remain unchanged.

**Refine corrections (2026-10-11)**
- Cache identity described only after fallback → current early return precedes Gemini probe → check requested-generator cache first, probe only on Gemini miss, then check actual fallback cache.
- Preserve joined metadata → old generator/QC/MP3 can survive join and clean joins lack a complete Content → rebuild envelope/provenance/QC and generate requested joined MP3.
- Intro assumed to create missing MP3 → it only updates an existing mp3Path → join must establish the correct MP3 path first and reset intro idempotence on regeneration.
- Generic fake render coverage → stage shims cannot observe backend packaging/lifecycle → this task verifies stage/cache/native-rate join contracts; 0256 owns actual worker and distribution checks.
- Estimate treated as possible calibration → no VoxCPM measurement exists → document 5.6 chars/sec as provisional; 0258 reports evidence without source/default edits.
- Concurrent MP3 repair appeared during audit → ensurePublishMp3 now supplies missing MP3 output but accepts existing recorded MP3 → reuse that helper after clearing stale derived fields on fresh joins; preserve and extend the concurrent tests rather than duplicate this fix.

**Refine corrections (2026-10-11, current-tree recheck)**
- ensurePublishMp3 was described as uncommitted at line 475 → it is committed and currently near line 540 → reuse the named helper in current HEAD, no dependency on an old concurrent diff.
- Reconstructing final metadata omitted the already-shipped metadata.segments timeline repair → current join concatenates current section segment metadata → retain that behavior when rebuilding Content, never copy previous final segments.
- Section cache validity alone was treated as sufficient for final reuse → a failed join after successful changed sections can leave an older joined WAV → freeze metadata.sectionHashes and require it to match current ordered section hashes before final reuse.
- QC aggregation used an unnamed score and missing MP3 always implied speech regeneration → shared VoiceQualityReport uses overallScore/segmentAudits, and ensurePublishMp3 can repair valid speech → freeze matching fields and repair only the missing derivative before allowing a cache return.
- Historical concurrency claims → Current-tree recheck (2026-10-11, HEAD 701c598b): no WIP tasks; main has an unrelated task 0252 edit. The only other worktree is knowledge-kit-runall-g8-4173 (G8 board/workflow work), with package.json/bun.lock/CLI packaging edits; coordinate lockfile and packaging-test integration, preserve them. The prior 0248 worktree is gone. ensurePublishMp3 and joined segment metadata are already committed in main, not an uncommitted prerequisite.

### Requirements

- [ ] R1. Add voxcpm:voxcpm-tts to the shared selector for whole-document and sequential-section invocations; preserve aliases, argument lists, Gemini defaults/probe/fallback and section_concurrency=1.
- [ ] R2. Reuse only QC-passing requested/resolved-generator caches with a valid present WAV and a valid requested MP3 before returning (repair a missing derivative from matching valid speech); invalidate foreign/legacy/corrupt output. Preserve driver/profile/text section hashes and completed valid sections after later failure.
- [ ] R3. Build a valid joined Content with actual driver identity, current section QC/duration, playable native-rate WAV and freshly regenerated optional MP3; preserve order/gaps, intro idempotence and downstream publish-preparation input contracts without stale metadata, preserving the current ordered metadata.segments timeline and requiring current metadata.sectionHashes before final joined-cache reuse.
- [ ] R4. Cover both workflow forms, aliases/fallback/cache/resume and 48kHz join/intro/MP3 through model-free tests; update both workflow descriptions/operator docs/docs/04_DESIGN.md and label VoxCPM rate provisional.

### Acceptance Criteria

- [ ] AC1 — Daily voice1 selects VoxCPM explicitly (req: R1, R4)
  Given whole-document vdriver=voxcpm, when daily-generate runs, then the fake executor observes voxcpm-tts and no Gemini probe; defaults/aliases/unknown-driver and Gemini fallback remain covered in apps/cli/tests/kk-daily-ai-voice-workflow.test.ts.
- [ ] AC2 — Daily voice2 selects VoxCPM for sequential sections (req: R1, R3, R4)
  Given a valid opening/items/closing script, when sequential synthesis joins 48kHz fake section WAVs, then order/gaps/measured duration and complete Content/QC/MP3 match current sections; intro plus publish-preparation consume the resulting MP3. Cover apps/cli/tests/daily-generate-sections.test.ts and kk-workflow-stages.test.ts with real ffmpeg fixtures. No publication is invoked.
- [ ] AC3 — Audio caches distinguish the selected driver (req: R2, R4)
  Given foreign/legacy/failed-QC/missing-file caches or a failed later section, when rendering changes/repeats a driver, then incompatible output regenerates, valid matching output reuses, completed sections survive and stale joined MP3/QC/provenance cannot establish success. Assert executor calls and artifacts in both stage test files.

AC2/AC3 regression lens: an old joined artifact cannot satisfy newly valid section hashes after a failed join; resume rejoins cached sections without model calls. Current section metadata.segments remains in order for show-notes, and a matching valid speech cache missing only MP3 uses the committed repair helper without resynthesis.

### Q&A

- CLOSED: 0256 owns backend and worker contract; this task owns alias/cache and joined-artifact correctness only. No executor timeout changes.
- CLOSED: Cache hits precede Gemini probing for the requested generator; actual fallback cache can be reused only after fallback resolution. VoxCPM has no fallback.
- CLOSED: Native-rate joins reuse existing ffmpeg logic; final Content/QC/MP3 must be rebuilt so publish preparation cannot consume stale foreign audio.
- DEFERRED with owner 0258: live duration/quality evidence. Calibration is a report recommendation, no automatic source/default change. Model/profile A/B caches remain separate directories.
- CLOSED after concurrency recheck: ensurePublishMp3 already implements basic missing-MP3 repair in uncommitted daily-stages.ts/test edits. Reuse it, but require fresh-join stale-path invalidation and current Content/QC reconstruction; no duplicate repair helper.

#### Q&A entry — 2026-10-12T04:46:31.858Z

- CLOSED on recheck: metadata.sectionHashes records successful ordered join identity; stale/legacy finals rejoin valid cached sections without model calls.
- CLOSED on recheck: preserve current metadata.segments and shared QC field names when rebuilding the envelope.
- CLOSED on recheck: missing MP3 on valid matching speech is derivative repair using ensurePublishMp3, not an expensive voice render.

### Design

ADR-036 and docs/design/voxcpm-daily-voice-driver.md freeze this design. No default change, new daemon/service, copied Python audio pipeline, automatic publication, vendor dependency, unrelated refactor or .github/workflows edit. No product import, dependency, subprocess, build input, cache/model/profile/reference path (including symlinks) may access vendors/. Preserve operator metadata and concurrent changes. Implementation must update docs/04_DESIGN.md with the new surface in the same change; refinement does not implement that surface.

Depends on 0256's discoverable kk:voxcpm-tts Content/native-rate WAV contract. Own daily-stages.ts, both named workflow YAML descriptions/comments, apps/cli/tests/kk-daily-ai-voice-workflow.test.ts, daily-generate-sections.test.ts, kk-workflow-stages.test.ts and existing operator/surface docs. Do not reimplement worker/profiles or edit async invocation owned by 0248. Handoff to 0258 is opt-in working render-only stage commands and trustworthy artifacts.

Whole-document algorithm: map requested driver; speech cache requires metadata.generator === 'kk:'+mappedPlugin, qc.passed===true and a valid existing audioPath. When only requested MP3 is missing, repair it with ensurePublishMp3 and validate its output before returning; do not resynthesize valid matching speech merely to recreate a derivative. Invalid/malformed/legacy metadata is a miss. Return matching cache before quota probe. On miss, only requested Gemini executes its existing probe; on failure resolve Voicebox and check that generator's cache before rendering. VoxCPM never probes Gemini or falls back to another voice. Never relabel foreign metadata. Same-directory model/settings cache expansion is out of scope; use separate work directories for A/B.

Sections retain text/profile/driver hashes and require matching generator/QC and existing WAV before reuse; missing/invalid outputs rerender. Preserve completed sections on failure, never replace final success Content with a partial join. Join after all valid sections, preserving existing ordering/gap behavior and first section's real sample rate; reuse current ffmpeg normalization to mono PCM16, no new resampler. Rebuild Content's title/body/format:'audio'/references and metadata from current script/sections instead of spreading previous final Content. metadata.generator is 'kk:'+resolvedPlugin; audioPath/duration are the new joined artifact. QC aggregates current sections conservatively: passed iff all passed, overallScore minimum when every section reports a finite overallScore, criticalIssues flattened with section labels; concatenate current segmentAudits with globally ordered segmentIndex and current totalDuration; missing evidence is explicitly unavailable, no invented ASR.

The committed ensurePublishMp3 helper repairs missing MP3s after render/cache/join. Reuse it and its existing MP3_TRUTHY convention (1/true/yes/on), do not add another transcoder. On a fresh join clear the old mp3Path before invoking the helper so a present stale file cannot skip regeneration; preserve requested MP3 only when Content and its audio are a valid cache hit. Set metadata.mp3Path only after successful conversion; omit old mp3Path when transcode is off. Clear old introMerged on fresh join so dailyIntro runs once and updates the correct MP3. Ensure failed join/transcode cannot leave a final Content claiming success. Model-free fixtures must carry real generator provenance and valid Content/QC fields; use 48kHz waveform/sample-count assertions plus existing 24kHz regression and MP3 metadata/intro tests. Keep existing duration precheck; 5.6 chars/sec is a provisional Vox estimate, final measured duration authoritative. No calibration/default change here or automatic publish in tests.

Budget: one focused implementation pass, targeted stage/cache/ffmpeg tests, workflow validation and final lint/full tests/build/rules. Logs: .spur/run/<run-id>/voxcpm-workflow/. Real backend behavior is observed by 0256 tests, not stage shims.

- **Final joined-cache identity:** freeze `metadata.sectionHashes: string[]` as the ordered `plans.map(plan => plan.hash)` used for the successful join. Final reuse requires exact ordered-array equality, matching generator, valid Content/QC and present valid WAV/required MP3. A legacy final without this field is a miss. If all sections are valid but final identity is stale, rejoin those sections without model calls. Record hashes only after successful join/MP3 and Content validation. A failed later section or join must not make an old final eligible for the changed plan.
- **Keep current timeline:** concatenate `metadata.segments` from the current ordered section sidecars, preserving profile, duration and optional transcription for podcast show-notes. Never inherit the previous final list or drop this committed repair while replacing the old envelope. Rebuild QC using existing VoiceQualityReport names (`passed`, `overallScore`, `totalDuration`, `segmentAudits`, `criticalIssues`); absent evidence stays unavailable, not an invented numeric zero or ASR pass.
- **Cache artifact validity:** use existing ContentSchema/parseWav and ffprobe seams to reject malformed metadata, zero/truncated WAV or nonpositive native rate/duration; use the existing MP3/probe path for a required derivative. Do not add a general cache library. A valid speech cache with missing MP3 uses the existing repair helper; corrupted/foreign speech is a miss. A missing/failed derivative cannot return successful Content.
- **Regression cases:** changed sections saved before failed join, then resume with all sections cached and stale final hash; rejoin without synthesis. Foreign or legacy joined Content with matching section files must not early-return. Assert ordered segments/transcription survive a fresh join and no previous-run segments/QC/MP3/intro flag leak. Matching valid speech plus missing MP3 transcodes only, with zero generator calls.
- Current-tree recheck (2026-10-11, HEAD 701c598b): no WIP tasks; main has an unrelated task 0252 edit. The only other worktree is knowledge-kit-runall-g8-4173 (G8 board/workflow work), with package.json/bun.lock/CLI packaging edits; coordinate lockfile and packaging-test integration, preserve them. The prior 0248 worktree is gone. ensurePublishMp3 and joined segment metadata are already committed in main, not an uncommitted prerequisite.

### Plan

- [ ] R1: Confirm 0256 manifest/output contract; add one shared alias and workflow help/comments while preserving argument/default surfaces.
- [ ] R2: Implement requested-cache-first and fallback-cache-second algorithm; test malformed/foreign/legacy/QC/missing-WAV/missing-MP3 hits/misses and no unnecessary Gemini probe.
- [ ] R2/R3: Preserve section hashes/resume with provenance and artifact validation; reconstruct current joined Content/QC/duration rather than old metadata.
- [ ] R3: Generate requested joined MP3, reset intro marker only on regeneration; test 48kHz join/gaps, intro, mp3Path and downstream publish-preparation with approved fixtures without publishing.
- [ ] R4: Extend both stage fake fixtures and regressions for opt-in/default/aliases/fallback/resume; document provisional rate and isolated comparison directories.
- [ ] R4: Validate both workflows through Spur, update docs/04_DESIGN.md and operator docs, run targeted tests then lint/full tests/build/rules; retain evidence.

- [ ] R2/R3/R4: Add ordered metadata.sectionHashes and stale-final/failed-join resume tests; preserve current segments timeline and VoiceQualityReport field names. Test MP3-only repair without backend calls, plus corrupt native WAV refusal.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: docs/features/G14_voxcpm-voice-driver-for-both-daily-ai-voice-workflows.md; ADR-036: docs/00_ADR.md; frozen specification: docs/design/voxcpm-daily-voice-driver.md.
- Audit evidence: .spur/run/refine-g14-20261011/ (published wheel/API inspection, frozen task set, admission and order); durable summary: docs/plans/2026-10-11-g14-ready-refinement.md.
- Concurrency audit 2026-10-11: no wip tasks in main corpus; worktree knowledge-kit-run-0248-eaea19 exists for invocation/publish work. Do not re-own apps/cli/src/invoke.ts or its timeout implementation; refresh overlap before implementation. Unrelated workflow-board docs, task 0157 and rule-authoring changes belong to others. Final concurrency recheck also found uncommitted ensurePublishMp3 changes in daily-stages.ts and daily-generate-sections.test.ts; 0257 explicitly reuses that work. Do not revert it; refresh line anchors and helper state before implementation.
- Dependencies: 0256 → this task → 0258. Source seams: voiceExecutorArgs, dailyGenerate, ensurePublishMp3, dailyIntro and dailyPublishPrep in daily-stages.ts (line numbers moved during concurrent MP3 edit).

- Current-tree recheck (2026-10-11, HEAD 701c598b): no WIP tasks; main has an unrelated task 0252 edit. The only other worktree is knowledge-kit-runall-g8-4173 (G8 board/workflow work), with package.json/bun.lock/CLI packaging edits; coordinate lockfile and packaging-test integration, preserve them. The prior 0248 worktree is gone. ensurePublishMp3 and joined segment metadata are already committed in main, not an uncommitted prerequisite.
- Current seams: plugins/kk/scripts/daily-stages.ts (ensurePublishMp3, computePlans, joinedSegments); plugins/generations/voice-gen/src/qc.ts (VoiceQualityReport); plugins/generations/voice-gen/src/concat.ts (parseWav). Recheck artifacts: .spur/run/g14-refine-ready-20261011-recheck/.

### History
