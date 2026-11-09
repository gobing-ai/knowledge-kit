# podcast-pub transcript (`podcast:transcript`) — blocker, inert design, follow-up

Date: 2026-02-14 · Branch: `pi/podcast-transcript` · Upstream: microfeed **1.0.13** (matches the
live site version). Implemented as **inert today**: the payload never carries
`_microfeed.podcast.transcripts` until measured offsets exist upstream (§4/§6).

## 1. Upstream field contract (microfeed 1.0.13)

- Item API field `_microfeed.podcast.transcripts` is an **array (max 10)** of
  `{ url: HTTPS, type: "text/vtt" | "application/x-subrip", language? }`. `text/plain` is **not**
  accepted — so untimed transcript text **cannot even be referenced as a plain document**; only
  timed WebVTT / SubRip files hosted elsewhere qualify.
- The feed renders `podcast:transcript` per item from that list.
- On an API **update**, a supplied list **replaces** the stored list — the plugin therefore omits
  the `podcast` key entirely when no transcript was produced, so a later update can never erase a
  stored list.
- Transcript files must be hosted at an HTTPS URL. Microfeed itself does not host arbitrary
  transcript files: upstream `src/client/PodcastUploads.ts` presigns only the `attachments`
  (audio) and `image` categories; reasoning up the file, the storage key derives from
  `item_id` + category and there is no transcript/VTT category. **No new remote upload code path
  is activated** — hosting is an operator concern and the plugin accepts only an already-hosted
  HTTPS URL.

## 2. Where the spoken script and segment data live

- dailynews-gen builds the VoiceScript with template/plan spoken text
  (`plugins/generations/dailynews-gen/src/script-builder.ts:333-481`; task
  `docs/tasks/0161_dailynews-gen-builds-the-voicescript-from-a-validated-script.md`).
- The episode Content carries the full script as body (VoiceScript YAML,
  `plugins/generations/voice-gen/src/index.ts:349`); each segment was synthesized from exactly
  `segment.text` (`voice-gen/src/index.ts:207`).
- The pipeline builds `metadata.segments[]` per segment
  (`voice-gen/src/index.ts:301-320`): `generationId, profile, emotion, duration, verifyRetries,
  transcription, loudnessDip, speed?`. **No script text, no absolute offsets.** The only text is
  `transcription` — ASR output (`voice-gen/src/index.ts:268-277`), fidelity-checked with a low
  floor (`voice-gen/src/qc.ts:57` — `TRANSCRIPTION_FIDELITY_FLOOR = 0.15`), i.e. real but **not
  the exact VoiceScript text**.
- The kk-daily-ai-voice sectioned join rebuilds `metadata.segments[]` in section order
  (`plugins/kk/scripts/daily-stages.ts:1428-1449`) and `dailyIntro` prepends the intro sting to
  the exported file (`daily-stages.ts:1475-1477`).
- podcast-pub already reads this list for timeline offsets
  (`plugins/publishings/podcast-pub/src/index.ts:171-186` → `show-notes.ts:69-110`).

## 3. Blocker: no measured absolute timing exists anywhere in the chain

Question asked: are `metadata.segments[].duration` trustworthy cue boundaries of the *final mixed
episode*? **No** — measured or not, they are **per-clip** values only:

| Driver | Per-clip `duration` source | Evidence |
| --- | --- | --- |
| voicebox | TTS server's `history.duration` | `voice-gen/src/voicebox-client.ts:208` |
| gemini-tts | measured from the per-clip WAV bytes | `gemini-tts/src/gemini-client.ts:191` |
| both, after `speed` | `segDuration / speed` (post-`atempo` estimate) | `voice-gen/src/index.ts:301,310` |

And the mixed episode differs from the sum of per-clip durations by real, unrecorded content:

1. **Silence gaps** — `concatWavs` inserts `gap_ms` silence before each clip
   (`voice-gen/src/concat.ts:171-186`) and the sectioned join inserts `anullsrc` silences between
   section WAVs (`daily-stages.ts:1400-1419`); gaps are counted in `metadata.duration`
   (`voice-gen/src/index.ts:304`) but in no segment entry.
2. **Intro sting** — `dailyIntro` prepends the show intro music (~8 s) and repoints
   `audioPath` (`daily-stages.ts:1475`); every offset would be short by the sting length.
3. **Speed rounding** — server-reported durations divided by speed are estimates, not
   measurements of the export.

Therefore summed per-clip durations **cannot** produce honest cue starts. The contract enforced
in `src/transcript.ts` is: every segment must carry a **measured absolute `startSeconds`
recorded against the final mixed episode** (strictly increasing), and the last segment a measured
absolute `endSeconds` — cue starts are the segments' own recorded offsets, never sums of
durations; earlier cue ends are the next measured start. Because the audio chain records none of
these fields today, **`buildTranscriptSegments` always returns `undefined` for current data**:
the flag `PODCAST_PUB_TRANSCRIPT` stays **default false**, the payload omits `podcast`, and a
warning explains the missing offsets.

## 4. Text blocker: transcription is ASR, not the exact script

`metadata.segments[].transcription` is machine ASR (§2), gated by a 0.15 bigram floor — good
enough for QC sanity, not guaranteed verbatim. The exact VoiceScript text exists only in the
content body and is not carried per segment after generation. A verbatim transcript would need
the concat step to record `text` (or an exact-text sidecar) together with the offsets. Until
then, transcripts built from ASR text are the accepted source of truth for this feature.

## 5. Implemented surface (inert today)

- `src/transcript.ts` — pure functions:
  - `buildTranscriptSegments(segments)` — requires, per segment: measured absolute
    `startSeconds` (≥ 0, strictly increasing), non-empty `transcription`; plus a measured
    absolute `endSeconds` on the LAST segment. Cue `start` = the segment's own measured offset
    (gaps and sting are inside each span), `end` = next measured start (last: own `endSeconds`),
    one cue per segment, **no invented sub-timings, no summed durations**. Otherwise `undefined`.
  - `renderWebVtt(cues)` / `renderSrt(cues)` — spec escaping (`&` first, `<`, `>`; CR dropped),
    `HH:MM:SS` stamps with `.` (VTT) / `,` (SRT) decimal.
  - `resolveTranscriptConfig(metadata, env)` — `PODCAST_PUB_TRANSCRIPT` /
    `metadata.podcast.transcriptEnabled` (default **false**) and the already-hosted HTTPS URL
    (`metadata.podcast.transcriptUrl` / `PODCAST_PUB_TRANSCRIPT_URL`); non-HTTPS fails the
    publish loud; flag on without URL warns and stays off.
- `src/index.ts` `prepareTranscript` (publish op only) — when enabled and real cues exist:
  writes the WebVTT next to the episode's local audio source (`mp3Path` → `audioPath` →
  `audioFile`), then sets `_microfeed.podcast.transcripts = [{ url, type: "text/vtt",
  language: "zh-cn" }]` (§1). No network upload, no `validate`-op involvement.

## 6. Proposed follow-up (to make the feature usable)

1. **Record measured offsets at mix time** (the only honest source): in `voice-gen`'s
   `concatWavs` flow, the sectioned daily join (`daily-stages.ts` ffmpeg concat), and
   `dailyIntro`, compute each segment's absolute start/end in the final file — from the known
   byte layout (`sampleRate·blockAlign`) of the WAV pieces it already builds, plus the sting —
   and stamp `metadata.segments[].startSeconds`/`endSeconds` on the final Content. Re-probe the
   exported MP3/WAV with `ffprobe` to assert the recorded offsets still match the derivatives.
2. **Optionally stronger text**: ASR word-level timestamps (voicebox `transcribe` /
   Gemini ASR already return text; word timing would subdivide segments honestly), or concat-time
   recording of the exact VoiceScript text per segment so cues are verbatim.
3. podcast-pub needs no further change after 1: the builder consumes
   `metadata.segments[].startSeconds/endSeconds` and flips the feature alive; until then the
   payload omits the field by design.
