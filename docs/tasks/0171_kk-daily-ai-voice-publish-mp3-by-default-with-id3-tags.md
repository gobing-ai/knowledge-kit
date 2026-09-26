---
schema_version: 1
name: "kk-daily-ai-voice: publish MP3 by default with ID3 tags"
status: todo
template: feature-impl
created_at: 2026-09-25T23:01:10.933Z
updated_at: "2026-09-25T23:10:40.101Z"
feature_id: E61
priority: P0
tags:
  - kk-daily-ai-voice
  - apple-podcasts
estimate_hours: 3

dependencies: ["0170"]
---

## 0171. kk-daily-ai-voice: publish MP3 by default with ID3 tags

### Background

Implements: R1 — Daily voice runs publish an MP3 enclosure by default; R3 — Published MP3 carries ID3 tags.

Root cause of the WAV enclosure: `plugins/kk/workflows/kk-daily-ai-voice.yaml` defaults `transcode_mp3: "false"`, so `publish-prep` in `plugins/kk/scripts/kk-workflow-stages.ts` falls back from `mp3Path` to the WAV `audioPath`. The MP3 transcode already exists (voice-gen `src/mp3.ts`, omni-voice-gen `mp3.py`); castfeedvalidator also reported no ID3 tags.

**Refine corrections (2026-09-25)**

- "`kk stage publish-prep`" → the stage is `kk stage daily-publish-prep` (`plugins/kk/workflows/kk-daily-ai-voice.yaml:280`), implemented by `dailyPublishPrep` (`plugins/kk/scripts/kk-workflow-stages.ts:1231`) → names corrected.
- "stub spawn in tests" → the existing stage tests use a fake-bin-on-PATH pattern (`apps/cli/tests/kk-workflow-stages.test.ts:487`) → Plan uses a fake `ffmpeg` shim; the existing publish-prep test `:560` feeds `audio.wav` and must switch to `.mp3`.
- Workflow test pins the exact publish-prep command string (`apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:217`) → must be updated with the new args.
- `run_date` is digits-only (e.g. `20260924`, workspace `.works/kk-daily-ai-voice/20260924`) → ID3 date is formatted `YYYY-MM-DD` from it.
- `transcode_mp3` is also documented in `docs/design/kk-daily-ai-voice.md` → docs update covers that file too. `apps/cli/plugins/` is a gitignored bundle copy (`.gitignore:161`) — not edited.

### Requirements

- [ ] R1. `transcode_mp3` defaults to "true" in `plugins/kk/workflows/kk-daily-ai-voice.yaml:34`.
- [ ] R2. `daily-publish-prep` fails loud (exit 1) when the resolved audio file is not `.mp3`, with a message naming `transcode_mp3`.
- [ ] R3. `daily-publish-prep` stamps ID3v2.3 `title` (article `title`), `artist` (`podcast_artist`), `album` (`podcast_album`), `date` (run date as `YYYY-MM-DD`) onto the MP3 with `-c copy` (no re-encode), writing a temp file then renaming over the original; ffmpeg failure fails the stage.
- [ ] R4. New workflow vars `podcast_artist` (default "Robin Min") and `podcast_album` (default "咸话咸说") are passed as positional args 3 and 4 to `kk stage daily-publish-prep`.
- [ ] R5. `docs/04_DESIGN.md` and `docs/design/kk-daily-ai-voice.md` document the new vars and the MP3 default (T3).

Out of scope: tagging inside voice-gen/omni-voice-gen/gemini-tts; cover-art (APIC) embedding; other workflows' `transcode_mp3` defaults; republishing past episodes (0172).

### Acceptance Criteria

- [ ] AC1 — Daily voice runs publish an MP3 enclosure by default (req: R1, R2, R4)
- [ ] AC2 — Published MP3 carries ID3 tags (req: R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-25T23:03:57.711Z

- Q: Where are ID3 tags stamped? A: In publish-prep, after intro-music (which re-transcodes and would strip earlier tags).
- Q: Artist/album defaults? A: `podcast_artist`="Robin Min", `podcast_album`="咸话咸说" (matches live channel itunes:author/title).

#### Q&A entry — 2026-09-25T23:10:30.746Z

- Q: ID3 date format given digits-only run_date? A: `YYYY-MM-DD` derived from it (closed).
- Q: Missing artist/album var? A: Omit that tag; not an error (closed).

### Design

Chosen: flip the var default and add the ID3 stamp inside `dailyPublishPrep` (`plugins/kk/scripts/kk-workflow-stages.ts:1231`): after resolving `audioFile`, reject non-`.mp3`, then `spawnSync('ffmpeg', ['-y','-i',in,'-c','copy','-id3v2_version','3','-metadata',`title=…`,'-metadata',`artist=…`,'-metadata',`album=…`,'-metadata',`date=…`,tmp])` and `renameSync(tmp, in)` — same fail-loud style as intro-music (`:1161`–`:1179`). Running after intro-music (`:1181` re-transcodes the MP3) guarantees the tags survive.
Frozen names: vars `podcast_artist`, `podcast_album`; stage signature `daily-publish-prep <workDir> <runDate> [artist] [album]`; tmp file `<audio>.id3.tmp.mp3`. Empty artist/album → that tag is omitted (no failure).
Rejected: tagging in generators (stripped by intro re-transcode; no article title there); a new ID3 npm dependency (ffmpeg already required).
Invariants: `-c copy`, no re-encode; WAV never reaches podcast-pub from this workflow.
Dependencies: assumes 0170's guard in podcast-pub as the backstop; does not change podcast-pub. Leaves for 0172: a `daily-publish-prep` that accepts an MP3 `mp3Path` and tags it.

### Plan

1. YAML: `transcode_mp3: "true"`; add `podcast_artist` / `podcast_album` vars; append them to the `daily-publish-prep` command (R1, R4).
2. `dailyPublishPrep`: `.mp3` guard (R2); ID3 stamp via ffmpeg `-c copy` → tmp → rename (R3).
3. Tests: `kk-workflow-stages.test.ts` — switch `:560` fixture to `.mp3` with a fake `ffmpeg` shim on PATH (pattern `:487`) that records argv and writes the tmp file; add "wav rejected naming transcode_mp3" and "ffmpeg failure fails the stage"; `kk-daily-ai-voice-workflow.test.ts:217` — update the pinned command string.
4. Docs: `docs/04_DESIGN.md` + `docs/design/kk-daily-ai-voice.md` (R5).
5. Verify: `bun run lint` + `bun run test`; manual `ffprobe -show_format` on one real MP3 → evidence in Testing.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
