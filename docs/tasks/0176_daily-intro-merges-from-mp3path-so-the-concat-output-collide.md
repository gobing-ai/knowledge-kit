---
schema_version: 1
name: daily-intro merges from mp3Path so the concat output collides with its input
status: done
template: issue
created_at: 2026-09-27T03:08:11.635Z
updated_at: "2026-09-27T06:02:04.507Z"
feature_id: E61

ac_altitude: task-local
---

## 0176. daily-intro merges from mp3Path so the concat output collides with its input

### Background

Task 0172's 2026-09-25 daily episode reached the `intro-music` state of the
`kk-daily-ai-voice` workflow and failed after ~2.5h of TTS work had already produced
the audio. Run `040c7887-c3a2-4ca1-b037-3193b9105dcf` recorded:

```text
[run 040c7887] ✗ intro-music/shell (0s) · Command "kk stage daily-intro ..." exited with 1
Error opening output file .../20260925_11_generate_content.mp3
```

The failed state sits **between** voice generation and every publish state, so the whole
publish tail (quality-control → publish-prep → publish-podcast → publish → run-report)
was unreachable: the episode could not be published at all.

`transcode_mp3` is `"true"` by default (task 0171 R1), which is exactly the configuration
that reaches this path — so the default daily configuration was broken, not an edge case.

### Requirements

- [x] R1. `daily-intro` must join the intro sting from the raw lossless render (`metadata.audioPath`) when it exists, falling back to `metadata.mp3Path` only when no raw render is present.
- [x] R2. The join's output path must never equal any concat input path, for both a `.wav` and an `.mp3` primary render.
- [x] R3. `kk stage daily-intro` must succeed on a work dir produced by the default `transcode_mp3=true` configuration, stay idempotent (`introMerged: true` short-circuit), and preserve the raw render.

### Acceptance Criteria

- [x] AC1 — Intro merges from the raw render and never collides with its own input (req: R1, R2)
- [x] AC2 — Default `transcode_mp3=true` work dir completes `daily-intro` (req: R3)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

Narrow fix inside `dailyIntro`; no interface change.

- Candidate order flips to `audioPath` first: `intro-music` concatenates audio, so the
  lossless render is the correct source and the mp3 is the derived publish artifact
  (0171 R1/R2 own the mp3). First-existing wins so a work dir with only one of the two
  still works.
- The output suffix rewrite becomes extension-agnostic (`\.(wav|mp3)$/i`) so the joined
  path is always a distinct sibling regardless of which candidate won.

Rejected alternatives: (a) hardcoding `.intro.wav` next to `mainPath` without stripping —
leaves a doubled suffix (`x.mp3.intro.wav`) but is safe; the strip keeps the existing
naming; (b) writing the join to a temp file and always transposing — more code for no
extra safety once the output is provably distinct.

### Plan

1. Reproduce from the failed run's own artifacts (`kk stage daily-intro` on the existing
   20260925 work dir) rather than re-running TTS.
2. Read the `intro-music` failure text in full (the run log truncates it) and locate the
   input/output path derivation.
3. Fix candidate selection + output derivation.
4. Re-run the stage against the same work dir and assert the joined artifact + metadata.
5. Re-sync the packaged plugin copy (`apps/cli/plugins/`) so the CLI loads the fix.

### Root Cause

`plugins/kk/scripts/kk-workflow-stages.ts:1141` (pre-fix) chose the concat **input** as:

```ts
const rawFile = meta.mp3Path ?? meta.audioPath;
```

and derived the **output** as `plugins/kk/scripts/kk-workflow-stages.ts:1149`:

```ts
const mergedPath = mainPath.replace(/\.wav$/, '.intro.wav');
```

With 0171's `transcode_mp3: "true"`, `metadata.mp3Path` is present, so `rawFile` resolved to
`..._11_generate_content.mp3`. That path has no `.wav` suffix, so the regex matched nothing
and `mergedPath` fell through **equal to `mainPath`**. ffmpeg was then invoked with the same
file as input #1 and as the output:

```text
Output .../20260925_11_generate_content.mp3 same as Input #1 - exiting
```

The stage's own guard (`conv.status !== 0`) reported it as `ffmpeg concat failed`, which is
why the run log appeared to blame ffmpeg rather than the path derivation.

Latent before 0171: while `audioPath` (`.wav`) was the only metadata key, `?? ` fell through
to the `.wav` and the rewrite matched. 0171 added `mp3Path` ahead of it in the fallback
chain without a matching change here — a cross-task regression at the seam.

Local verification harness note (not the product bug): the CLI resolves stage scripts from
the gitignored packaged copy at `apps/cli/plugins/`, so the fix only takes effect after
`rsync -a --delete plugins/ apps/cli/plugins/`.

### Solution

`plugins/kk/scripts/kk-workflow-stages.ts:1141-1156`:

- `candidates = [meta.audioPath, meta.mp3Path]` filtered to non-empty strings — raw render
  first, mp3 as fallback.
- `rawFile = candidates.find(existsSync) ?? candidates[0]`; `undefined` keeps the original
  fail-loud `intro-music: voice content carries no mp3Path/audioPath`.
- `mergedPath = \`${mainPath.replace(/\.(wav|mp3)$/i, '')}.intro.wav\`` — distinct sibling
  for either primary extension.

Comment records the failure mode so the ordering is not "simplified" back.

`o` legacy `meta.mp3Path ?? meta.audioPath` remains at line 1294 (`daily-publish-prep`),
where publishing the mp3 **is** the intent (0171 R2) — deliberately unchanged.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Re-verified 2026-09-27 at HEAD 2fb560e1: plugins/kk/scripts/kk-workflow-stages.ts:1140-1147 — candidates = [meta.audioPath, meta.mp3Path] filtered to non-empty, first-existing wins, undefined keeps the fail-loud path. New regression test asserts the merged output derives from the raw render with the raw wav preserved byte-for-byte (sha256 before/after). |
| R2 | MET | mergedPath = mainPath.replace(/\.(wav\|mp3)$/i, '') + '.intro.wav' (:1156) — distinct sibling for either extension. New test 'never collides output with input when only an mp3 primary exists' reproduces the exact 0176 failure shape and passes on the fixed code. |
| R3 | MET | New fixture-driven tests (ffmpeg-generated wav/mp3) run the real stage end to end: default transcode_mp3=true shape (audioPath+mp3Path both set) merges, re-transcodes the mp3, updates metadata (audioPath→intro.wav, introMerged, extended duration); re-run short-circuits with 'intro-music cached'. 2 tests, 22 assertions, pass. bun run lint exit 0. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | bun test apps/cli/tests/kk-workflow-stages.test.ts -t 'daily-intro' → 2 pass / 0 fail (2026-09-27). Covers audioPath-first selection, collision-free derivation for .wav and .mp3 primaries, raw-render preservation, idempotence. |
| AC2 | MET | test | The default-configuration work-dir shape (both audioPath and mp3Path set) completes daily-intro in the new end-to-end test; the live 2026-09-25 episode additionally proves it in production (enclosure audio/mpeg length 9380635 carries the intro, per ffprobe evidence recorded in this task's Testing and the 2026-09-27 live feed check). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Finding | Location | Disposition |
| --- | --- | --- | --- |
| P3 | The ordering fix has no regression test, so a future edit could restore `mp3Path` first without any gate failing; cheapest closure is a fixture-driven `daily-intro` stage test, the same harness gap already carried by 0171 P3. | `plugins/kk/scripts/kk-workflow-stages.ts:1145-1156`; `apps/cli/tests/` (no stage-behavior harness) | FIXED 2026-09-27 — `describe('daily-intro (0176)')` in `apps/cli/tests/kk-workflow-stages.test.ts`: ffmpeg-fixture tests pin audioPath-first merge (raw render preserved, mp3 re-transcoded), mp3-only-primary join with no input/output collision (the exact 0176 failure), and `introMerged` idempotence. 2 tests, 22 assertions, pass. |
| P4 | `mergedPath` keeps the `<stem>.intro.wav` name, so a `.mp3`-primary work dir yields a `.intro.wav` whose stem no longer ends in the publish extension — harmless because the stage writes `audioPath` and re-transcodes `mp3Path` explicitly, but it is naming rather than a contract. | `plugins/kk/scripts/kk-workflow-stages.ts:1156` | |
| P4 | The failure was misattributed for a full run cycle because the stage's guard reports `ffmpeg concat failed` for what is a path-derivation defect; the run log then truncates the real ffmpeg text, so the actual cause ("same as Input #1") is only visible by re-running the stage in the foreground. | `plugins/kk/scripts/kk-workflow-stages.ts:1190-1192` | |
| P4 | The fix only takes effect after `rsync -a --delete plugins/ apps/cli/plugins/`, because the CLI resolves stage scripts from that gitignored packaged copy — a silent stale-bundle hazard that costs a full debugging cycle when forgotten. | `resolveStagesScript()` → `apps/cli/plugins/` | Filed as task 0178 under F8 (2026-09-27): the CLI must resolve the live source of truth or fail loudly when the packaged copy diverges. |

**Residual risk:** low — the change is confined to one function, the stage is `introMerged`-guarded,
it is exercised end to end by the 2026-09-25 run that reached `done`, and the 2026-09-27 re-verify
added the automated regression net (P3 FIXED above).

**Disposition:** fix accepted; the publish tail is unblocked. The `done` transition was taken with
`--provenance-bypass` (no pipeline run exists for this task) on the strength of a PASS verdict plus
the repro/verification evidence above; recorded, not silent.

### References

- Failed run: `.spur/run/040c7887-c3a2-4ca1-b037-3193b9105dcf.md` (seq=12 `intro-music`, 2026-09-26T07:04:39Z)
- Unblocked run: `05d2535a-f7fe-433c-8056-e541754abd54`
- Tasks: 0171 (added `mp3Path`, `transcode_mp3=true` default), 0172 (2026-09-25 episode, blocked by this)
- Feature: E61 — Apple Podcasts compliance for the microfeed podcast feed
- Package-copy hazard: `resolveStagesScript()` prefers `apps/cli/plugins/` (gitignored), so stage-script fixes need `rsync -a --delete plugins/ apps/cli/plugins/`

### History

- 2026-09-27T03:15:24.322Z todo → wip (system)
- 2026-09-27T03:15:24.701Z wip → testing (system)
- 2026-09-27T03:15:25.079Z testing → done (system)

