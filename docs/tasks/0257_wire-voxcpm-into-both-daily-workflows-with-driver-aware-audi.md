---
schema_version: 1
name: Wire VoxCPM into both daily workflows with driver-aware audio reuse
status: done
template: feature-impl
created_at: 2026-10-12T00:07:13.360Z
updated_at: "2026-10-12T17:23:23.608Z"
feature_id: G14
priority: P2
estimate_hours: 4

dependencies: ["0256"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0257-verdict.json
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

- [x] R1. Add voxcpm:voxcpm-tts to the shared selector for whole-document and sequential-section invocations; preserve aliases, argument lists, Gemini defaults/probe/fallback and section_concurrency=1.
- [x] R2. Reuse only QC-passing requested/resolved-generator caches with a valid present WAV and a valid requested MP3 before returning (repair a missing derivative from matching valid speech); invalidate foreign/legacy/corrupt output. Preserve driver/profile/text section hashes and completed valid sections after later failure.
- [x] R3. Build a valid joined Content with actual driver identity, current section QC/duration, playable native-rate WAV and freshly regenerated optional MP3; preserve order/gaps, intro idempotence and downstream publish-preparation input contracts without stale metadata, preserving the current ordered metadata.segments timeline and requiring current metadata.sectionHashes before final joined-cache reuse.
- [x] R4. Cover both workflow forms, aliases/fallback/cache/resume and 48kHz join/intro/MP3 through model-free tests; update both workflow descriptions/operator docs/docs/04_DESIGN.md and label VoxCPM rate provisional.

### Acceptance Criteria

- [x] AC1 — Daily voice1 selects VoxCPM explicitly (req: R1, R4)
  Given whole-document vdriver=voxcpm, when daily-generate runs, then the fake executor observes voxcpm-tts and no Gemini probe; defaults/aliases/unknown-driver and Gemini fallback remain covered in apps/cli/tests/kk-daily-ai-voice-workflow.test.ts.
- [x] AC2 — Daily voice2 selects VoxCPM for sequential sections (req: R1, R3, R4)
  Given a valid opening/items/closing script, when sequential synthesis joins 48kHz fake section WAVs, then order/gaps/measured duration and complete Content/QC/MP3 match current sections; intro plus publish-preparation consume the resulting MP3. Cover apps/cli/tests/daily-generate-sections.test.ts and kk-workflow-stages.test.ts with real ffmpeg fixtures. No publication is invoked.
- [x] AC3 — Audio caches distinguish the selected driver (req: R2, R4)
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

- [x] R1: Confirm 0256 manifest/output contract; add one shared alias and workflow help/comments while preserving argument/default surfaces.
- [x] R2: Implement requested-cache-first and fallback-cache-second algorithm; test malformed/foreign/legacy/QC/missing-WAV/missing-MP3 hits/misses and no unnecessary Gemini probe.
- [x] R2/R3: Preserve section hashes/resume with provenance and artifact validation; reconstruct current joined Content/QC/duration rather than old metadata.
- [x] R3: Generate requested joined MP3, reset intro marker only on regeneration; test 48kHz join/gaps, intro, mp3Path and downstream publish-preparation with approved fixtures without publishing.
- [x] R4: Extend both stage fake fixtures and regressions for opt-in/default/aliases/fallback/resume; document provisional rate and isolated comparison directories.
- [x] R4: Validate both workflows through Spur, update docs/04_DESIGN.md and operator docs, run targeted tests then lint/full tests/build/rules; retain evidence.
- [x] R2/R3/R4: Add ordered metadata.sectionHashes and stale-final/failed-join resume tests; preserve current segments timeline and VoiceQualityReport field names. Test MP3-only repair without backend calls, plus corrupt native WAV refusal.

### Solution

VoxCPM (`vdriver=voxcpm`) now resolves through the one shared selector and every audio cache/reuse path is
generator-aware. No workflow default changed; `voicebox`/`ominivoice`/`gemini`, their argument lists, the
Gemini probe/fallback policy and `section_concurrency=1` are untouched. Every row below is one claim →
one `file:line` anchor.

| Req | Anchor | Subject |
| --- | --- | --- |
| R1 | `plugins/kk/scripts/daily-stages.ts:696` | shared selector gains `voxcpm: 'voxcpm-tts'` (whole-document and sectioned forms) |
| R1/R4 | `plugins/kk/workflows/kk-daily-ai-voice.yaml:25` | voice1 vdriver comment documents opt-in `voxcpm` + its provisional rate |
| R1/R4 | `plugins/kk/workflows/kk-daily-ai-voice.yaml:405` | voice1 `generate` description lists `voxcpm -> voxcpm-tts` |
| R1/R4 | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:26` | voice2 vdriver comment documents opt-in `voxcpm` (default unchanged) |
| R1/R4 | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:497` | voice2 `generate` description lists `voxcpm -> voxcpm-tts` |
| R2 | `plugins/kk/scripts/daily-stages.ts:596` | `validNativeAudio()` rejects absent/zero/truncated WAV via ffprobe rate+duration |
| R2 | `plugins/kk/scripts/daily-stages.ts:609` | `wholeDocCache()` requires `kk:<plugin>` identity + QC pass + valid WAV; repairs a missing MP3 |
| R2 | `plugins/kk/scripts/daily-stages.ts:715` | requested-generator cache is checked before the Gemini quota probe |
| R2 | `plugins/kk/scripts/daily-stages.ts:734` | resolved fallback (voicebox) cache is checked after fallback; VoxCPM never falls back |
| R2 | `plugins/kk/scripts/daily-stages.ts:921` | section reuse requires matching `metadata.generator`/QC and an existing valid WAV |
| R3 | `plugins/kk/scripts/daily-stages.ts:628` | `joinedFinalFresh()` frozen `metadata.sectionHashes` identity + generator/QC/WAV |
| R3 | `plugins/kk/scripts/daily-stages.ts:947` | stale/foreign final rejoins the cached sections with no model calls |
| R3 | `plugins/kk/scripts/daily-stages.ts:1071` | ordered `metadata.segments` rebuilt from the current sidecars, never inherited |
| R3 | `plugins/kk/scripts/daily-stages.ts:1081` | fresh-join Content envelope rebuilt from current script (no stale metadata; `introMerged`/`mp3Path` cleared) |
| R3 | `plugins/kk/scripts/daily-stages.ts:1104` | QC + `sectionHashes` recorded only after the join and requested MP3 succeed |
| R3 | `plugins/kk/scripts/daily-stages.ts:649` | `aggregateSectionQc()` — VoiceQualityReport names, min score, reindexed audits, labelled critical issues |
| R4 | `plugins/kk/scripts/daily-stages.ts:868` | VoxCPM 5.6 字/秒 estimate labelled provisional (0258 measures a real render) |
| R4 | `apps/cli/tests/daily-generate-sections.test.ts:647` | AC1: whole-document `vdriver=voxcpm` renders `voxcpm-tts` with no probe |
| R4 | `apps/cli/tests/daily-generate-sections.test.ts:664` | AC1/R2: matching cache reuses; missing MP3 repaired with zero generator calls |
| R4 | `apps/cli/tests/daily-generate-sections.test.ts:694` | AC3: foreign/legacy/corrupt whole-document caches regenerate |
| R4 | `apps/cli/tests/daily-generate-sections.test.ts:738` | AC2: 48 kHz sections join at 48 kHz with native sample counts and gaps |
| R4 | `apps/cli/tests/daily-generate-sections.test.ts:772` | AC3: stale/foreign joined final is rejoint from cached sections (no calls) |
| R4 | `apps/cli/tests/daily-generate-sections.test.ts:804` | AC3: matching valid sections + missing MP3 → transcode only, zero calls |
| R4 | `apps/cli/tests/daily-generate-sections.test.ts:825` | AC2/AC3: fresh join rebuilds the ordered timeline; no prior-run metadata leaks |
| R4 | `apps/cli/tests/daily-generate-sections.test.ts:866` | AC2: `daily-intro` merges the joined output; the duration gate reads the merged length |
| R4 | `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:627` | R5 stub stamps real generator provenance for the voice drivers |
| R4 | `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:476` | AC1: workflow `voxcpm` row — fake executor sees `voxcpm-tts`, no Gemini probe |
| R4 | `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:127` | static assertion: the shared alias + both workflow docs cover `voxcpm` |
| R4 | `apps/cli/tests/voice2-dag.test.ts:590` | voice1 YAML guard tightened to behaviour-identical (docs-only edits allowed) |
| R4 | `docs/04_DESIGN.md:1119` | design doc documents `vdriver=voxcpm` opt-in and its provisional estimate |
| R4 | `docs/04_DESIGN.md:1215` | workflow table row lists `voxcpm -> voxcpm-tts (opt-in, ADR-036)` |
| R4 | `docs/design/kk-daily-ai-voice.md:5` | operator doc driver list adds `voxcpm -> voxcpm-tts` |
| R4 | `docs/design/workflow-board-modules.md:301` | board module doc lists `voxcpm` among the `vdriver` values |

**R1.** One map entry serves both workflow forms because both reach `dailyGenerate` through the same
`VOICE_DRIVERS` lookup; the executor argv, Gemini probe/fallback and section concurrency are unchanged.

**R2.** `wholeDocCache` returns only when the recorded Content is *this* driver's, QC-passing and backed
by a playable native-rate WAV, and repairs a missing derivative with the committed `ensurePublishMp3`
instead of resynthesising. Foreign/legacy/corrupt metadata is a miss; a VoxCPM run has no probe branch.

**R3.** A fresh join rebuilds the envelope from the current script and sections, so the previous final's
generator/QC/`mp3Path`/`sectionHashes` cannot survive; the requested MP3 is regenerated and only then is
`qc`/`sectionHashes` recorded. Final reuse compares the ordered section hashes, and a stale/legacy final
rejoins the cached sections without any model call.

**R4.** Model-free fixtures carry real generator provenance and full QC fields; the existing 24 kHz test
is retained and a 48 kHz join test added. The voice1 YAML diff is comments/`description` only, so the
voice2 "voice1 untouched" guard now checks behaviour rather than bytes.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `voxcpm: 'voxcpm-tts'` added once to the shared `VOICE_DRIVERS` selector at `plugins/kk/scripts/daily-stages.ts:696`, reached by both the whole-document path and the sectioned path; the Gemini quota probe stays gated on `vdriver === 'gemini'` at `plugins/kk/scripts/daily-stages.ts:724`. Re-ran this turn: `apps/cli/tests/daily-generate-sections.test.ts:647` (8 pass) and `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:476` (17 pass). |
| R2 | MET | Requested-generator cache is checked before the quota probe at `plugins/kk/scripts/daily-stages.ts:715` and the resolved fallback cache after it at `plugins/kk/scripts/daily-stages.ts:734`; `wholeDocCache` gates on generator identity + passing QC + a playable WAV at `plugins/kk/scripts/daily-stages.ts:609`; section reuse requires matching generator/QC/WAV at `plugins/kk/scripts/daily-stages.ts:921`. Re-ran this turn: `apps/cli/tests/daily-generate-sections.test.ts:664` and `apps/cli/tests/daily-generate-sections.test.ts:694` pass. |
| R3 | MET | Frozen join identity `metadata.sectionHashes` at `plugins/kk/scripts/daily-stages.ts:628`; a stale/foreign final rejoins the cached sections with no model calls at `plugins/kk/scripts/daily-stages.ts:947`; the ordered `metadata.segments` timeline is rebuilt from current sidecars at `plugins/kk/scripts/daily-stages.ts:1071`; the Content envelope is rebuilt with the old `mp3Path`/`introMerged` cleared at `plugins/kk/scripts/daily-stages.ts:1081`; `qc`/`sectionHashes` are recorded only after the join and requested MP3 at `plugins/kk/scripts/daily-stages.ts:1104`. Re-ran this turn: `apps/cli/tests/daily-generate-sections.test.ts:738`, `apps/cli/tests/daily-generate-sections.test.ts:772`, `apps/cli/tests/daily-generate-sections.test.ts:825`, `apps/cli/tests/daily-generate-sections.test.ts:866` pass. |
| R4 | MET | Both workflow definitions document the opt-in alias (`plugins/kk/workflows/kk-daily-ai-voice.yaml:25`, `plugins/kk/workflows/kk-daily-ai-voice.yaml:405`, `plugins/kk/workflows/kk-daily-ai-voice2.yaml:26`, `plugins/kk/workflows/kk-daily-ai-voice2.yaml:497`); operator/design docs updated (`docs/design/kk-daily-ai-voice.md:5`, `docs/04_DESIGN.md:1119`, `docs/04_DESIGN.md:1215`, `docs/design/workflow-board-modules.md:301`); the spoken-rate estimate is labelled PROVISIONAL at `plugins/kk/scripts/daily-stages.ts:868`. 48 kHz native-rate join covered by `apps/cli/tests/daily-generate-sections.test.ts:738` (pass this turn). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Daily voice1 selects VoxCPM explicitly (req: R1, R4) | MET | test | Whole-document vdriver=voxcpm renders voxcpm-tts with no Gemini probe: `apps/cli/tests/daily-generate-sections.test.ts:647`; workflow `voxcpm` row over the real engine: `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:476`. Both pass this turn. |
| AC2 — Daily voice2 selects VoxCPM for sequential sections (req: R1, R3, R4) | MET | test | 48 kHz sections join at 48 kHz with native sample counts and gaps: `apps/cli/tests/daily-generate-sections.test.ts:738`; ordered timeline rebuilt: `apps/cli/tests/daily-generate-sections.test.ts:825`; daily-intro merges the joined output and the duration gate reads the merged length: `apps/cli/tests/daily-generate-sections.test.ts:866`. All pass this turn. |
| AC3 — Audio caches distinguish the selected driver (req: R2, R4) | MET | test | Matching cache reuses with zero generator calls: `apps/cli/tests/daily-generate-sections.test.ts:664`; foreign/legacy/corrupt caches regenerate: `apps/cli/tests/daily-generate-sections.test.ts:694`; stale/foreign joined final rejoins cached sections: `apps/cli/tests/daily-generate-sections.test.ts:772`; matching valid sections missing only the MP3 transcode with zero generator calls: `apps/cli/tests/daily-generate-sections.test.ts:804`. All pass this turn. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0257

**Scope:** `plugins/kk/scripts/daily-stages.ts` (production change) · the driver-aware tests (`apps/cli/tests/daily-generate-sections.test.ts`, `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts`, `apps/cli/tests/voice2-dag.test.ts`, `packages/kk-core/tests/registry.test.ts`, `scripts/bundle-plugins.test.ts`, `apps/cli/tests/package.test.ts`) · both workflow YAML comments/`description:` scalars · `docs/04_DESIGN.md` · `docs/design/kk-daily-ai-voice.md` · `docs/design/workflow-board-modules.md` · batch bookkeeping (`bun.lock`, feature/task docs, `.spur/rules`)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS
**Confidence:** HIGH — every claim is a direct read of the changed code plus two bounded spot-runs run here: `bun test apps/cli/tests/voice2-dag.test.ts` (39 pass / 0 fail) and `bun test apps/cli/tests/daily-generate-sections.test.ts -t 0257` (8 pass / 0 fail). The full gate was not re-run (already green at digest `sha256:1efa28ec…`).

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | correctness | Independently judged the relaxed YAML guard. All 8 changed `kk-daily-ai-voice.yaml` lines are comments/`description:` scalars (test filter applied to the real `git diff`), and all 88 `description:` occurrences in that file are node/transition docs — the engine reads behaviour from `id`/`onEnter`/command/edges. I could NOT construct a state-id/command/edge/var-default/condition edit the filter hides. Residual: it is a physical-line heuristic, so it (a) cannot see staged/committed edits (the old byte-identical check had the same `git diff` baseline) and (b) would over-exempt in a future schema where `description` became data. | `apps/cli/tests/voice2-dag.test.ts:590-602` | ACCEPTED |
| 2 | P4 (advisory) | functional | AC1's "unknown-driver … remain covered in `kk-daily-ai-voice-workflow.test.ts`" clause has no test: repo-wide, the `unknown vdriver` fail-loud appears only in the source. The path is unchanged from HEAD and fail-loud by construction, so the risk is nil, but the named coverage does not exist. | `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts`; `plugins/kk/scripts/daily-stages.ts:698-703` | ACCEPTED |
| 3 | P4 (advisory) | functional | AC2 names `kk-workflow-stages.test.ts` for the 48 kHz-join coverage, but neither copy references `daily-generate`; the join/gaps/intro/MP3 assertions live solely in `daily-generate-sections.test.ts` (spot-run green). The required behaviour is covered; only the second file name is unmet. | `apps/cli/tests/daily-generate-sections.test.ts:738-891` | ACCEPTED |
| 4 | P4 (advisory) | correctness | The task Design says to reject malformed metadata via "existing ContentSchema/parseWav"; the code substitutes explicit field checks plus its own `probeAudio` ffprobe seam because `daily-stages.ts`'s header contract forbids `@gobing-ai/*` imports. Every required rejection (foreign/legacy/corrupt/zero-WAV → miss) still holds via generator+qc+rate+duration checks, so this is a design-seam substitution, not a correctness hole. | `plugins/kk/scripts/daily-stages.ts:577-620`; header contract `:37-39` | ACCEPTED |
| 5 | P4 (advisory) | usability | The change-set diff carries one stray untracked artifact, `apps/cli/.spur/run/publish-partial-20261007.txt` (dated 2026-10-07, produced by the pre-existing cwd-relative `.spur/run/` marker in `kk-workflow-stages.ts`, not gitignored). Unrelated to 0257; ensure it is not committed. | `apps/cli/.spur/run/publish-partial-20261007.txt` | ACCEPTED |

##### Named risk surfaces — what I found (or did not)

1. **Relaxed YAML guard** — judged; no hole hides a behavioural edit (finding 1).
2. **Cache identity** — holds. `joinedFinalFresh` requires generator match + exact ordered `sectionHashes` (`:634`, `.every` catches a permuted same-length list) + `qc.passed===true` + `validNativeAudio`; a legacy final (`sectionHashes` absent) or a partially-written final (the pre-transcode write has no `qc`) is a miss. A stale/foreign final rejoins cached sections with zero model calls (test `:772`, green). A section file from another driver misses twice: the hash folds the driver (`:907`) and `sidecarMeta.generator` is checked (`:921`).
3. **Derivative-only repair** — holds. A fresh join builds `baseMeta` without `mp3Path` (`:1081`) so a stale on-disk MP3 cannot short-circuit; `ensurePublishMp3` sets `meta.mp3Path` only after a successful ffmpeg run (`:570`) and `failWith`s otherwise (`:568`); `qc`/`sectionHashes` are recorded only after the transcode (`:1104-1105`), so a failed join/transcode leaves `format:'audio'` with no `qc.passed` → the next run rejoins (no success claim).
4. **Alias & fallback boundary** — holds. `voxcpm: 'voxcpm-tts'` added once (`:696`); the probe is gated on `vdriver === 'gemini'` in both paths (`:724`, `:962`), so VoxCPM never probes Gemini and never falls back; the voicebox cache is checked only after probe failure (`:734`). Existing aliases/arg lists/`section_concurrency=1` untouched.
5. **QC/timeline fidelity** — holds. `metadata.segments` is rebuilt from the current sidecars in section order, never inherited (`:1071-1076`); `aggregateSectionQc` uses VoiceQualityReport names, `overallScore` as the min only when *all* sections supply a finite one (else omitted), reindexed `segmentAudits`, labelled `criticalIssues` (`:649-687`). The poisoned-final test proves no previous-run `generator`/`qc`/`mp3Path`/`introMerged`/`segments` leak (`:825`, green).
6. **Production-cache invalidation** — checked: all four drivers stamp `metadata.generator` (`voice-gen` default since 2026-09-24; `gemini-tts`/`omni-voice-gen`/`voxcpm-tts` explicitly), so the new generator gate does not mass-invalidate live one-shot caches.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `daily-stages.ts:696` shared alias; probe gated on gemini `:724`/`:962`; workflow `voxcpm` row + static alias assertions (`kk-daily-ai-voice-workflow.test.ts:127,476`); AC1 test `daily-generate-sections.test.ts:647` |
| R2 | MET | requested-cache-before-probe `:715`, fallback-cache-after-probe `:734`; `wholeDocCache`/section reuse require generator+qc+valid WAV (`:609`, `:919-921`); completed sections survive a later failure (cached sections skipped `:963`); AC3 tests `:664`, `:694`, `:804` |
| R3 | MET | frozen `sectionHashes` identity `:628-643`; stale/foreign rejoin `:947`; current ordered timeline `:1071-1076`; fresh envelope + cleared `mp3Path`/`introMerged` `:1081-1093`; QC/hashes after join+MP3 `:1098-1106`; tests `:738`, `:772`, `:825`, `:866` |
| R4 | MET | both YAML docs (`kk-daily-ai-voice.yaml:25,405`; `kk-daily-ai-voice2.yaml:26,497`), `docs/04_DESIGN.md`, operator docs; provisional 5.6 字/秒 label `:868`; 48 kHz join test `:738` (spot-run green) |

**Next:** no open P1–P3; proceed to verify. The three P4 advisories are naming/hygiene residuals with no behavioural risk.

### References

- Feature: docs/features/G14_voxcpm-voice-driver-for-both-daily-ai-voice-workflows.md; ADR-036: docs/00_ADR.md; frozen specification: docs/design/voxcpm-daily-voice-driver.md.
- Audit evidence: .spur/run/refine-g14-20261011/ (published wheel/API inspection, frozen task set, admission and order); durable summary: docs/plans/2026-10-11-g14-ready-refinement.md.
- Concurrency audit 2026-10-11: no wip tasks in main corpus; worktree knowledge-kit-run-0248-eaea19 exists for invocation/publish work. Do not re-own apps/cli/src/invoke.ts or its timeout implementation; refresh overlap before implementation. Unrelated workflow-board docs, task 0157 and rule-authoring changes belong to others. Final concurrency recheck also found uncommitted ensurePublishMp3 changes in daily-stages.ts and daily-generate-sections.test.ts; 0257 explicitly reuses that work. Do not revert it; refresh line anchors and helper state before implementation.
- Dependencies: 0256 → this task → 0258. Source seams: voiceExecutorArgs, dailyGenerate, ensurePublishMp3, dailyIntro and dailyPublishPrep in daily-stages.ts (line numbers moved during concurrent MP3 edit).

- Current-tree recheck (2026-10-11, HEAD 701c598b): no WIP tasks; main has an unrelated task 0252 edit. The only other worktree is knowledge-kit-runall-g8-4173 (G8 board/workflow work), with package.json/bun.lock/CLI packaging edits; coordinate lockfile and packaging-test integration, preserve them. The prior 0248 worktree is gone. ensurePublishMp3 and joined segment metadata are already committed in main, not an uncommitted prerequisite.
- Current seams: plugins/kk/scripts/daily-stages.ts (ensurePublishMp3, computePlans, joinedSegments); plugins/generations/voice-gen/src/qc.ts (VoiceQualityReport); plugins/generations/voice-gen/src/concat.ts (parseWav). Recheck artifacts: .spur/run/g14-refine-ready-20261011-recheck/.

### History

- 2026-10-12T16:57:44.649Z todo → wip (system)
- 2026-10-12T17:23:20.466Z wip → testing (system)
- 2026-10-12T17:23:23.600Z testing → done (system)

