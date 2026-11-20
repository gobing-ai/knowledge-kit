# Music judge input — Morning Chamber, Dark Guitar / brief 01

Judged take: /Users/robin/xprojects/knowledge-kit/.works/kk-music/morning-chamber-orchids/3-takes/morning-chamber-dark-guitar-lyria-3-pro-preview-gen-1795196931030-puqx6j.mp3
Rubric: music-quality
Verdict path: 4-verdict-music.json

Every number in this bundle comes from section 5 (`checks.json`) with the `unit` and `source` it was
recorded with. The take’s audio is not attached: nothing here may be graded by ear.

## 1. brief

```yaml
title: Morning Chamber, Dark Guitar
format: song
theme: synthwave
model: pro
duration_target: "2:30"
language: EN
audio_format: mp3
style: |-
  Dark pastoral synthwave at 150 BPM in D minor, 4/4, wide choruses against narrow intimate verses.
  Instrumentation: down-tuned palm-muted rhythm guitars, distorted electronic bass, filtered electronic
  percussion, detuned saw pad, gated snare, arpeggiated lead.
  Vocal: low male baritone, close and dry in the verses, stacked harmony in the chorus, no falsetto.
  Theme: waking among valley orchids and birdsong with a stream below — the pastoral image carried by
  the pad and lead, never by orchestral strings; aggression lives in the guitars and the bass.
  Production: dark, aggressive, wide-stereo choruses, gated reverb on the snare, tape-warm low end.
avoid:
  - falsetto
  - orchestral strings
  - long ambient introduction
  - clean bright pop production
structure:
  - at: "0:00"
    section: Intro
    note: filtered electronic percussion and distant down-tuned guitar noise, no vocal
  - at: "0:10"
    section: Verse 1
    note: low baritone enters, restrained palm-muted guitars, narrow mix
  - at: "0:45"
    section: Chorus
    note: full-width guitars, heavy drums, stacked vocal harmonies, wide stereo
  - at: "1:15"
    section: Verse 2
    note: baritone dry and forward, one counter-melody on the lead, guitars pulled back
  - at: "1:45"
    section: Chorus
    note: repeat the hook wider, distorted electronic bass takes the low end
  - at: "2:10"
    section: Outro
    note: strip back to the harmonic bed and resolve on the final chord without a fade
lyrics: |-
  [Verse]
  Birdsong on a valley floor
  A stream that runs beneath the door
  [Chorus]
  Wake me where the orchids grow
  Dark guitar and the water's low
  [Verse]
  Every window full of rain
  Every dawn the same refrain
  [Outro]
  Where the orchids grow
takes: 1
```

## 2. prompt

```text
Dark pastoral synthwave at 150 BPM in D minor, 4/4, wide choruses against narrow intimate verses.
Instrumentation: down-tuned palm-muted rhythm guitars, distorted electronic bass, filtered electronic
percussion, detuned saw pad, gated snare, arpeggiated lead.
Vocal: low male baritone, close and dry in the verses, stacked harmony in the chorus, no falsetto.
Theme: waking among valley orchids and birdsong with a stream below — the pastoral image carried by
the pad and lead, never by orchestral strings; aggression lives in the guitars and the bass.
Production: dark, aggressive, wide-stereo choruses, gated reverb on the snare, tape-warm low end.
Avoid: falsetto, orchestral strings, long ambient introduction, clean bright pop production, festival supersaws, EDM risers, distorted djent guitars, modern trap percussion
[0:00] Intro — filtered electronic percussion and distant down-tuned guitar noise, no vocal
[0:10] Verse 1 — low baritone enters, restrained palm-muted guitars, narrow mix
[0:45] Chorus — full-width guitars, heavy drums, stacked vocal harmonies, wide stereo
[1:15] Verse 2 — baritone dry and forward, one counter-melody on the lead, guitars pulled back
[1:45] Chorus — repeat the hook wider, distorted electronic bass takes the low end
[2:10] Outro — strip back to the harmonic bed and resolve on the final chord without a fade
```

## 3. lyrics

Language: EN

```text
model-authored lyrics are not in the bundle
```

## 4. analysis

```json
{
    "title": "When the Orchids Grow",
    "genre": "Alternative Rock",
    "mood": "Emotional",
    "energy": 75,
    "bpm": 90,
    "key": "D minor",
    "instrumentation": [
        "Lead male vocals",
        "Backing vocals",
        "Electric guitar",
        "Distorted electric guitar",
        "Bass guitar",
        "Drums",
        "Drum machine",
        "Synth pads"
    ],
    "sections": [
        {
            "name": "Intro",
            "start": "00:00",
            "end": "00:11"
        },
        {
            "name": "Verse 1",
            "start": "00:11",
            "end": "00:47"
        },
        {
            "name": "Chorus 1",
            "start": "00:47",
            "end": "01:14"
        },
        {
            "name": "Verse 2",
            "start": "01:14",
            "end": "01:45"
        },
        {
            "name": "Chorus 2",
            "start": "01:45",
            "end": "02:11"
        },
        {
            "name": "Outro",
            "start": "02:11",
            "end": "02:29"
        }
    ],
    "notes": "The track features a dramatic dynamic shift between understated lo-fi indie verses and powerful, wall-of-sound alternative rock choruses driven by heavy guitars and expressive belt vocals."
}
```

## 5. checks

```json
[
    {
        "id": "duration.target",
        "measured": 149.13,
        "threshold": "120–180",
        "unit": "s",
        "source": "ffprobe 9.0.1",
        "result": "pass",
        "note": "brief target 2:30 ±30 s"
    },
    {
        "id": "silence.leading",
        "measured": 0,
        "threshold": 1,
        "unit": "s",
        "source": "ffmpeg 9.0.1 silencedetect",
        "result": "pass"
    },
    {
        "id": "silence.trailing",
        "measured": 0.67,
        "threshold": 3,
        "unit": "s",
        "source": "ffmpeg 9.0.1 silencedetect",
        "result": "pass"
    },
    {
        "id": "analysis.present",
        "measured": "present",
        "threshold": "present",
        "unit": "state",
        "source": "lyria instance analysis",
        "result": "pass"
    },
    {
        "id": "analysis.bpm",
        "measured": 90,
        "threshold": "135–165",
        "unit": "bpm",
        "source": "lyria instance analysis",
        "result": "warn",
        "note": "the analysis estimate is outside the brief band; a warn, never a fail (R2)"
    },
    {
        "id": "analysis.key",
        "measured": "D minor",
        "threshold": "D minor",
        "unit": "key",
        "source": "lyria instance analysis",
        "result": "pass"
    },
    {
        "id": "analysis.sections",
        "measured": 6,
        "threshold": 6,
        "unit": "sections",
        "source": "lyria instance analysis",
        "result": "pass"
    }
]
```

## 6. provenance

- content_ref: `/Users/robin/xprojects/knowledge-kit/.works/kk-music/morning-chamber-orchids/3-takes/morning-chamber-dark-guitar-lyria-3-pro-preview-gen-1795196931030-puqx6j.mp3`
- checks: `/Users/robin/xprojects/knowledge-kit/.works/kk-music/morning-chamber-orchids/3-takes/morning-chamber-dark-guitar-lyria-3-pro-preview-gen-1795196931030-puqx6j.mp3.checks.json`
- sidecar: `/Users/robin/xprojects/knowledge-kit/.works/kk-music/morning-chamber-orchids/3-takes/morning-chamber-dark-guitar-lyria-3-pro-preview-gen-1795196931030-puqx6j.mp3.take.json`
- digest: `3eb3d96f6d1e30f91a6c5b76c9096e671083c511d07fd0f5731b46c2129c015f`
- instanceId: `gen-1795196931030-puqx6j`
- model: `lyria-3-pro-preview`
- unitPrice: `0.08`
- runId: ``
