---
schema_version: 1
name: "kk-daily-ai-voice: publish MP3 by default with ID3 tags"
status: done
template: feature-impl
created_at: 2026-09-25T23:01:10.933Z
updated_at: "2026-09-26T03:10:32.876Z"
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

- [x] R1. `transcode_mp3` defaults to "true" in `plugins/kk/workflows/kk-daily-ai-voice.yaml:34`.
- [x] R2. `daily-publish-prep` fails loud (exit 1) when the resolved audio file is not `.mp3`, with a message naming `transcode_mp3`.
- [x] R3. `daily-publish-prep` stamps ID3v2.3 `title` (article `title`), `artist` (`podcast_artist`), `album` (`podcast_album`), `date` (run date as `YYYY-MM-DD`) onto the MP3 with `-c copy` (no re-encode), writing a temp file then renaming over the original; ffmpeg failure fails the stage.
- [x] R4. New workflow vars `podcast_artist` (default "Robin Min") and `podcast_album` (default "咸话咸说") are passed as positional args 3 and 4 to `kk stage daily-publish-prep`.
- [x] R5. `docs/04_DESIGN.md` and `docs/design/kk-daily-ai-voice.md` document the new vars and the MP3 default (T3).

Out of scope: tagging inside voice-gen/omni-voice-gen/gemini-tts; cover-art (APIC) embedding; other workflows' `transcode_mp3` defaults; republishing past episodes (0172).

### Acceptance Criteria

- [x] AC1 — Daily voice runs publish an MP3 enclosure by default (req: R1, R2, R4)
- [x] AC2 — Published MP3 carries ID3 tags (req: R3)

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

| Change | Evidence |
| --- | --- |
| `transcode_mp3` default flipped to `"true"` (R1) | `plugins/kk/workflows/kk-daily-ai-voice.yaml:36` |
| New vars `podcast_artist` "Robin Min" / `podcast_album` "咸话咸说" (R4) | `plugins/kk/workflows/kk-daily-ai-voice.yaml:39`-`40` |
| `daily-publish-prep` argv gains the two tag vars as positionals 3/4 (R4) | `plugins/kk/workflows/kk-daily-ai-voice.yaml:286` |
| publish-prep state description names the MP3 + ID3 contract | `plugins/kk/workflows/kk-daily-ai-voice.yaml:281` |
| `.mp3` guard: exit 1 naming `transcode_mp3` when the resolved audio is not MP3 (R2) | `plugins/kk/scripts/kk-workflow-stages.ts:1289` |
| ID3 stamp call: article `title` + `runDate` + positional artist/album (R3) | `plugins/kk/scripts/kk-workflow-stages.ts:1292` |
| `stampId3Tags`: ffmpeg `-c copy -id3v2_version 3` title/artist/album/date (`YYYY-MM-DD`) into `<audio>.id3.tmp.mp3`, then rename (R3) | `plugins/kk/scripts/kk-workflow-stages.ts:1238`-`1271` |
| Stamp order: runs after `daily-intro` (`intro-music` state) so its mp3 re-transcode cannot strip the tags | `plugins/kk/workflows/kk-daily-ai-voice.yaml:262`-`286` |
| Fake-`ffmpeg`-on-PATH test helper recording argv and writing the tagged tmp (R3) | `apps/cli/tests/kk-workflow-stages.test.ts:489`-`509` |
| Fixture switched to `.mp3` + argv assertion + temp/rename assertion (R1, R3) | `apps/cli/tests/kk-workflow-stages.test.ts:585` |
| Empty artist/album omits that tag, no failure (R3/R4) | `apps/cli/tests/kk-workflow-stages.test.ts:639` |
| WAV enclosure rejected, message names `transcode_mp3` (R2) | `apps/cli/tests/kk-workflow-stages.test.ts:661` |
| ffmpeg failure fails the stage, audio left untouched, no prep artifact (R3) | `apps/cli/tests/kk-workflow-stages.test.ts:686` |
| Pinned YAML vars + publish-prep command string in the workflow static test (R1, R4) | `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:74`-`79`, `:222` |
| New vars, MP3 default and ID3 contract documented (R5) | `docs/04_DESIGN.md:729`, `docs/04_DESIGN.md:715` |
| Enclosure/ID3 section + artifact notes in the workflow design doc (R5) | `docs/design/kk-daily-ai-voice.md:100` |

Out-of-scope files untouched: no edit to `apps/cli/plugins/` (gitignored bundle copy) and none to 0170's podcast-pub/doc changes.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Re-read this run: `plugins/kk/workflows/kk-daily-ai-voice.yaml:36` reads `transcode_mp3: "true"` (the frozen text cites `:34`; the added rationale comment at `:34-35` shifted it to `:36`). Chain verified end to end: `${vars.transcode_mp3}` is passed by the `generate` state (`plugins/kk/workflows/kk-daily-ai-voice.yaml:262`) as arg 4 of `daily-generate`, destructured at `plugins/kk/scripts/kk-workflow-stages.ts:1079` and forwarded as `env: { VOICE_GEN_MP3: transcodeMp3 }` at `plugins/kk/scripts/kk-workflow-stages.ts:1105`; the driver then records `metadata.mp3Path` (`plugins/generations/voice-gen/src/index.ts:338`, executable proof `plugins/generations/voice-gen/tests/voice-gen.test.ts:1186`). Tests run by me: `NODE_ENV=test bun test apps/cli/tests/kk-workflow-stages.test.ts apps/cli/tests/kk-daily-ai-voice-workflow.test.ts` -> 85 pass / 0 fail, 586 expect() calls, 16.10s, including the static pin `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:76`. |
| R2 | MET | Guard re-read at `plugins/kk/scripts/kk-workflow-stages.ts:1289-1290`: `if (!audioFile.endsWith('.mp3')) { failWith(1, ...) }` inside `timed`, whose StageFailure path writes stderr and exits 1. My own probe with a real WAV (real ffmpeg 8.1.2 on PATH), throwaway dir: `bun plugins/kk/scripts/kk-workflow-stages.ts daily-publish-prep <tmp>/wavprobe 20260924 'Robin Min' '咸话咸说'` -> exit 1, stderr exactly `publish-prep: resolved audio is not an MP3 (transcode_mp3 must be "true"): <tmp>/wavprobe/3-audio/content.wav`, stdout empty, `3-publish/` left empty (no prep artifact), WAV md5 unchanged (`dfd551ad784d54c583955e260e2bc92e`). Test: `apps/cli/tests/kk-workflow-stages.test.ts:661` asserts status 1 plus both substrings and the absent prep artifact. |
| R3 | MET | `stampId3Tags` re-read at `plugins/kk/scripts/kk-workflow-stages.ts:1238-1271`: `-c copy` `:1259-1260`, `-id3v2_version 3` `:1261-1262`, meta pairs `:1244-1251`, tmp `<audio>.id3.tmp.mp3` `:1239`, same-directory `renameSync(tmpFile, audioFile)` `:1270`, ffmpeg non-zero or missing tmp -> unlink + `failWith(1, ...)` `:1266-1269`; called at `:1292` with the article `title`, `runDate` and positionals 3/4. Executable evidence on a real encoder (ffmpeg/ffprobe 8.1.2, libmp3lame source file, throwaway dir, real stage command): `ffprobe -show_entries format_tags` -> `album=咸话咸说`, `title=每日 AI 资讯 — 20260924 a=b "quoted"`, `artist=Robin Min`, `date=2026-09-24` (YYYY-MM-DD derived from digits-only `run_date` 20260924). ID3 header bytes `49 44 33 03 00` = ID3v2.3.0; tag-block frame ids present: `TYER`=`2026`, `TDAT`=`2409`, `TIT2`, `TPE1`, `TALB`. `-c copy` proof: decoded-audio md5 identical before and after (`c21ab76d8e8b36d7625c19ada80ad123`) with `duration=2.000000` unchanged (only tag bytes added: 33062 -> 33217 B); tmp file gone after success. Failure path with real ffmpeg (corrupt mp3 input): exit 1, `publish-prep: ffmpeg ID3 stamp failed: ... Error opening input files: Invalid data found when processing input`, audio md5 unchanged, no tmp, no prep artifact. Empty artist/album probe: exit 0, artist/album tags omitted, title/date still written. Leading-dash title probe (`-vf evil`): stored verbatim (argv-array `spawnSync` at `:1252`, no shell). Tests: `apps/cli/tests/kk-workflow-stages.test.ts:585`, `:639`, `:686`. |
| R4 | MET | Re-read: `plugins/kk/workflows/kk-daily-ai-voice.yaml:39` `podcast_artist: "Robin Min"` and `:40` `podcast_album: "咸话咸说"`; appended as positional args 3 and 4 at `plugins/kk/workflows/kk-daily-ai-voice.yaml:286`; consumed as `artist`/`album` at `plugins/kk/scripts/kk-workflow-stages.ts:1274` and passed to `stampId3Tags` at `:1292`. Executable: my throwaway-dir run passed exactly those two values as args 3/4 and ffprobe showed `artist=Robin Min` / `album=咸话咸说` on the published MP3. Static pins run by me inside the 85-pass targeted run: `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:78`, `:79`, `:222`. |
| R5 | MET | Re-read: `docs/04_DESIGN.md:729` documents the MP3 default, the `daily-publish-prep <work_dir> <run_date> [artist] [album]` signature, both var names with their defaults, the ID3v2.3 title/artist/album/date contract, `-c copy`, the temp-file rename, the ffmpeg-failure behaviour and the intro-music ordering; `docs/design/kk-daily-ai-voice.md:100-115` (§6 "Enclosure format & ID3 (0171)") plus the artifact notes at `docs/design/kk-daily-ai-voice.md:72-73`. Both docs sit in the same uncommitted working-tree delta as the code (T3 same-commit containment holds at commit time; HEAD `5b438a48` = base `.spur/run/0171-base.sha`, nothing staged). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | Executable, produced by me this run in a throwaway dir with real ffmpeg 8.1.2 — the publish-prep half of the default path: `bun plugins/kk/scripts/kk-workflow-stages.ts daily-publish-prep <tmp> 20260924 'Robin Min' '咸话咸说'` against a Content whose `metadata.mp3Path` is a real MP3 exited 0 and wrote `3-publish/20260924_13_publish-prep_content.json` with `metadata.audioFile` = `options.audioFile` = `/tmp/kk0171-verify-ThxyDe/3-audio/content.mp3` (the MP3 is what gets published; 0170's MIME allowlist then sees `audio/mpeg`). The counterpart probe proves no WAV enclosure can leave this workflow: the same command with a real WAV resolved exited 1 naming `transcode_mp3` and wrote no prep artifact. The default itself is `plugins/kk/workflows/kk-daily-ai-voice.yaml:36`, forwarded as `VOICE_GEN_MP3` at `plugins/kk/scripts/kk-workflow-stages.ts:1105`, with the driver link proven by `bun test plugins/generations/voice-gen/tests/voice-gen.test.ts` -> 38 pass / 0 fail, incl. `plugins/generations/voice-gen/tests/voice-gen.test.ts:1186` (`VOICE_GEN_MP3=true` writes the sibling mp3 and `metadata.mp3Path`). Workflow-level pins + stage behaviour: `NODE_ENV=test bun test apps/cli/tests/kk-workflow-stages.test.ts apps/cli/tests/kk-daily-ai-voice-workflow.test.ts` -> 85 pass / 0 fail (586 expect() calls), incl. `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:76` and `:222`. Caveat recorded as residual risk, not as an unmet condition: the existing end-to-end workflow test runs `publish_enabled: 'false'` with a stub driver that emits only `content.wav` (`apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:458-484`), so it never enters `publish-prep`; the workflow-level default is certified by the static pins plus the per-stage command evidence above, not by one workflow run. |
| AC2 | MET | command | Real-encoder proof, produced by me this run: a real 2.0 s libmp3lame MP3 was pushed through the real `daily-publish-prep` command in a throwaway dir, then inspected with `ffprobe -v error -show_entries format_tags` -> `album=咸话咸说`, `title=每日 AI 资讯 — 20260924 a=b "quoted"`, `artist=Robin Min`, `date=2026-09-24`. Header bytes `49 44 33 03 00` prove ID3v2.3 (not v2.4), and the tag block contains `TYER`=`2026` + `TDAT`=`2409` (the v2.3 date split ffprobe renders as `2026-09-24`), plus `TIT2`, `TPE1`, `TALB` — title/artist/album written to the frames the requirement names. `-c copy` (no re-encode) confirmed executably: decoded-audio md5 identical before and after (`c21ab76d8e8b36d7625c19ada80ad123`) and `format duration=2.000000` unchanged, with only tag bytes added (33062 -> 33217 B); the temp file `<audio>.id3.tmp.mp3` was renamed away. Negative paths on real ffmpeg: corrupt MP3 input -> exit 1 with `publish-prep: ffmpeg ID3 stamp failed: ...`, original audio md5 unchanged and no tmp left; empty artist/album -> exit 0 with those two tags absent and title/date present. This closes the fake-shim gap the review recorded at P3: `apps/cli/tests/kk-workflow-stages.test.ts:585`, `:639`, `:686` pin the argv contract and the tmp/rename/failure behaviour, and the encoder-level check above is now supplied. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Reviewed the working-tree diff vs HEAD for 0171's six files (isolated with `git diff -- plugins/kk/workflows/kk-daily-ai-voice.yaml plugins/kk/scripts/kk-workflow-stages.ts apps/cli/tests/kk-workflow-stages.test.ts apps/cli/tests/kk-daily-ai-voice-workflow.test.ts docs/04_DESIGN.md docs/design/kk-daily-ai-voice.md`; 6 files, +222 / −14). 0170's uncommitted files (`plugins/publishings/podcast-pub/*`, `docs/design/podcast-pub.md`) are excluded as already reviewed. Fresh evidence this run: `NODE_ENV=test bun test apps/cli/tests/kk-workflow-stages.test.ts apps/cli/tests/kk-daily-ai-voice-workflow.test.ts` → **85 pass / 0 fail**, 586 `expect()` calls, 19.3s; `biome check` on the three changed TS files clean ("Checked 3 files… No fixes applied"); plus a real-encoder probe with ffmpeg **8.1.2** running the exact stage command on a real MP3 — header bytes `49 44 33 03 00` (real ID3v2.3), frames `TYER=2026` + `TDAT=0101` for `date=2026-01-01` (ffprobe reads `2026-01-01`), `TIT2`/`TPE1`/`TALB` present, decoded-audio MD5 **identical** before/after (`9b867019d197ae12dbea09459a4e543f`, duration 2.000000 s) proving `-c copy`, and a second stamp byte-stable (10590 B both passes). Title-shape probe (`每日 AI 资讯 — 20260925`, the real shape from `plugins/generations/daily-article-gen/src/index.ts:126`): leading `-`, embedded `=`, embedded quotes all round-trip verbatim.

**Functional traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `plugins/kk/workflows/kk-daily-ai-voice.yaml:36` `transcode_mp3: "true"` (rationale `:34-35`); forwarded to the driver by the `generate` state (`:262`) → `plugins/kk/scripts/kk-workflow-stages.ts:1105` `env: { VOICE_GEN_MP3: transcodeMp3 }`; static pin `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:76`. |
| R2 | MET | `plugins/kk/scripts/kk-workflow-stages.ts:1289-1290` — `if (!audioFile.endsWith('.mp3')) failWith(1, 'publish-prep: resolved audio is not an MP3 (transcode_mp3 must be "true"): …')`, inside `timed` whose `StageFailure` path prints to stderr and exits 1 (`:467-484`); test `apps/cli/tests/kk-workflow-stages.test.ts:661-683` (status 1, both substrings, no prep artifact). |
| R3 | MET | `stampId3Tags` `plugins/kk/scripts/kk-workflow-stages.ts:1238-1271`, called at `:1292` with article `title` + `runDate` + positionals 3/4: `-c copy -id3v2_version 3` (`:1257-1263`), tmp path `:1239`, `renameSync(tmp, in)` `:1270`, ffmpeg failure → unlink + `failWith(1, …)` `:1266-1269`, `date` `:1248-1250`, empty-value omission `:1241-1243`; tests `:585-632` (argv + temp/rename), `:635-658` (omission), `:686-712` (failure leaves audio untouched); real-encoder confirmation above. |
| R4 | MET | `plugins/kk/workflows/kk-daily-ai-voice.yaml:39-40` (`podcast_artist: "Robin Min"`, `podcast_album: "咸话咸说"`) appended as positionals 3/4 at `:286`, destructured at `plugins/kk/scripts/kk-workflow-stages.ts:1274`; static pins `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:78-79`, `:222`. |
| R5 | MET | `docs/04_DESIGN.md:729` and `docs/design/kk-daily-ai-voice.md:72-73`, `:100-115` (§6) changed in the same tree as the code (T3); the design doc's own example (`:43`) already sets `transcode_mp3: "true"`. |

AC1 — Daily voice runs publish an MP3 enclosure by default: **MET** (R1+R2+R4 MET). The "WAV never reaches podcast-pub" invariant is structural: with the default, the voice Content carries `metadata.mp3Path`, `publish-prep` resolves `mp3Path ?? audioPath` (`:1282`), rejects a non-`.mp3`, and writes that same path into `metadata.audioFile` and `options.audioFile` (`:1294-1309`) — the channel 0170's mapper guards (`plugins/publishings/podcast-pub/src/map.ts:99-106,170-188`).

AC2 — Published MP3 carries ID3 tags: **MET** (R3 MET, with the encoder-level probe as proof). Durable because of ordering: the `intro-music` state (`kk-daily-ai-voice.yaml:264`) re-encodes the merged WAV to MP3 with `libmp3lame` (`kk-workflow-stages.ts:1181-1196`) and `publish-prep` (`:280`) is reachable only via `intro-music → quality-control → publish-prep` (`:548`, `:563`), so the stamp always lands after the step that would strip earlier tags.

**SECUA**

(a) Ordering holds — the stamp runs strictly after `intro-music`'s `libmp3lame` re-encode, and the constraint is recorded in the `stampId3Tags` comment (`kk-workflow-stages.ts:1231-1237`) so a future reorder is visibly risky. (b) The `.mp3` guard (`:1289-1290`) precedes all tag work (`:1292`); no tagging I/O happens before it. (c) `-c copy` is literal argv (`:1257-1258`), asserted element-by-element (`apps/cli/tests/kk-workflow-stages.test.ts:604-630`) and confirmed on a real encode by identical decoded-audio MD5 and identical duration — the "duration unchanged" invariant holds. (d) A failed ffmpeg leaves the original intact: ffmpeg only writes `${audioFile}.id3.tmp.mp3` (`:1239`, `:1264`), the non-zero/missing-tmp path unlinks it and exits 1 (`:1266-1269`), and the success path is a same-directory `renameSync` (`:1270`) — atomic, so `audioFile` is never partial (asserted `:686-712`); a SIGKILL between ffmpeg and rename can leave a stale tmp, which the next run overwrites (`-y`) and which the enclosure never globs, so at most cosmetic. (e) `date` is `YYYY-MM-DD` from the digits-only `run_date` via `/^\d{8}$/` + three `slice`s (`:1248-1250`), with an already-ISO pass-through; probe shows ffmpeg writes the correct v2.3 `TYER`/`TDAT` split. (f) Empty artist/album really omits the tag — `addTag` pushes nothing for `value.trim() === ''` (`:1241-1243`), so no empty tag is written (asserted `:635-658`); same for an unset positional (defaults `''`, `:1274`). (g) No injection surface: `spawnSync('ffmpeg', string[])` with no shell (`:1252`), the article title is one discrete argv element always rendered as `-metadata title=…`, so a leading `-` cannot become a flag, an embedded `=` splits only at the first separator, and CJK/emoji/quotes survive verbatim (probe-verified).

**Findings**

| P | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P3 (minor) | Evidence depth / coverage | `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:504`, `:458-484`; `apps/cli/tests/kk-workflow-stages.test.ts:495` | R3's encoder contract is asserted against a fake `ffmpeg` (`fakeFfmpeg`) — the tests pin the argument list, not that ffmpeg honors it. The workflow integration test cannot close the gap: it runs `publish_enabled: 'false'`, so it routes `quality-control → done` and never enters `publish-prep`, and its stub voice driver writes only `content.wav` with no `mp3Path` (`:458`, `:474`, `:484`) — flipping that flag would now hard-fail the run on the new guard. The task's `### Testing` section is still the unfilled placeholder (`docs/tasks/0171_…:104`), so the Plan's step-5 real `ffprobe` evidence is unrecorded. This review supplies that evidence by hand and the contract does hold, so AC1/AC2 are not in doubt. | Not a code defect; no remediation stage for 0171. If verify is downstream this closes there; otherwise record the one-line real-encoder probe under `### Testing`. A stub driver that emits an MP3 (so the integration test can assert an mp3-carrying enclosure end-to-end) is new work, not 0171 scope. |
| P4 (advisory) | SECUA correctness | `plugins/kk/scripts/kk-workflow-stages.ts:1289-1290` + `plugins/publishings/podcast-pub/src/map.ts:170`; `apps/cli/tests/kk-workflow-stages.test.ts:661` | Both gates key off the extension-derived path/MIME, never content: uppercase `.MP3` is refused, and a file named `.mp3` holding WAV bytes passes this guard and 0170's allowlist, publishing WAV bytes labelled `audio/mpeg`. Byte-probing is explicitly out of design scope (the plugin must not probe audio) and in practice `intro-music` produced the file with ffmpeg, so the exposure is a mislabelled artifact, not a normal path. | Accepted as designed (the frozen contract says `.mp3`). No change; recorded so E61 closure does not read the two gates as a magic-byte check. |
| P4 (advisory) | Failure visibility | `plugins/kk/scripts/kk-workflow-stages.ts:1292`, `:1241-1243` | `title` — the tag AC2 names first — is treated as optional exactly like artist/album: if the article Content ever lacks a string `title`, the episode publishes with no title tag and no warning. Today's producer always sets one (`plugins/generations/daily-article-gen/src/index.ts:126`) and `dailyShowNotes` depends on the same field (`:1347`). | Accepted. A one-line `console.warn` (or a `failWith`) for an absent title would make the silent case visible; not required for AC2. |
| P4 (advisory) | Test strength | `apps/cli/tests/kk-workflow-stages.test.ts:661-683`, `:495` | The WAV-rejection test asserts the message and the absent prep artifact but not that ffmpeg was never invoked, so SECUA (b) ("guard before any tag work") rests on code reading alone. Untested too: the non-`\d{8}` `runDate` fallback (`:1248-1250`), the absent/non-string `title` branch (`:1292`), and a title containing `=`/a leading `-`. | Advisory: add `expect(existsSync(record)).toBe(false)` to the WAV test plus one title-with-`=`/CJK case; this review's probes verified the behavior correct. |
| P4 (advisory) | Docs hygiene | `docs/design/kk-daily-ai-voice.md:82` | The diff adds a stray blank line after `## 5. Stage ownership (0133, ADR-115)` (double blank before the next paragraph) — the only unrelated hunk in the docs change set. | Advisory cosmetic cleanup on the next doc touch; no functional or link impact. |

**Architecture depth.** `stampId3Tags` sits in the right layer and duplicates nothing. The design's rejection of generator-side tagging is verifiable, not asserted: `intro-music` re-encodes the merged WAV to MP3 (`kk-workflow-stages.ts:1181-1196`) after `generate`, so any tag written by the voice driver is destroyed before publish, and the article `title` (R3's title source, `plugins/generations/daily-article-gen/src/index.ts:126`) is not available inside the driver at all. The stage is the repo's single production writer of episode tags (`rg 'id3v2_version|-metadata'` → only `kk-workflow-stages.ts:1238-1271`), so 0170's "the plugin never probes or transcodes audio" boundary is intact. Data flow is single-sourced: one resolved `audioFile` feeds the stamp, `metadata.audioFile`, and `options.audioFile` (`:1286-1309`), so the tagged bytes are the published bytes by construction (`podcast-pub` reads the path at publish time, `plugins/publishings/podcast-pub/src/map.ts:99-106,186-188`). 0170's declared-vs-actual MIME carry-over is closed from this path: the merged object spreads *article* metadata and no in-repo producer emits `Content.metadata.mimeType`.

**Residual risk.** (1) By design (R2), resuming a run whose cached `3-audio/…_11_generate_content.json` has `qc.passed` but no `mp3Path` (the old `transcode_mp3=false` shape) now stops at `publish-prep` with exit 1 instead of publishing a WAV — a hard stop with no auto-recovery (`transcode_mp3=false` only swaps the failure for 0170's MIME refusal; the real fix is a regenerate), and republishing the live 2026-09-24 item is 0172. (2) Extension-only validation on both gates (P4-1): a mislabelled `.mp3` still ships as `audio/mpeg`. (3) SIGKILL between ffmpeg and `renameSync` can leave `<audio>.id3.tmp.mp3`, overwritten by the next run's `-y` and never globbed as the enclosure. (4) The empty-tag branch is defensive: the two vars are declared non-empty and, per the integration test's own note, a bare `''` override of a declared non-empty default is rejected by spur (`apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:509-513`), so omission is reachable in practice only via a direct `kk stage` call or a whitespace value. (5) The true encoder check (P3) lives in this report, not in CI — a future ffmpeg change to `-id3v2_version 3` handling would not be caught by the suite.

**Disposition: PASS.** R1–R5, AC1 and AC2 are MET with `file:line` evidence, executable tests, and an independent real-encoder probe; the single tag writer sits in the only layer where the tags can survive, with no duplicated logic and no plugin-boundary violation. **No P1 (blocker) and no P2 (major) findings** — the four P4s are advisory records and the lone P3 is an evidence-depth gap whose subject this review verified out-of-band; none of them requires a remediation stage for 0171.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-26T02:54:39.375Z todo → wip (system)
- 2026-09-26T03:10:31.130Z wip → testing (system)
- 2026-09-26T03:10:32.876Z testing → done (system)

