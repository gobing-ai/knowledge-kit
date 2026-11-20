# Music run report — brief 01

- run: `c73a9b02-1958-4fd8-b159-f137ae8c5a99`
- format: `song`
- delivery profile: `streaming`
- final artifact: `/Users/robin/xprojects/knowledge-kit/.works/kk-music/morning-chamber-orchids/3-takes/morning-chamber-dark-guitar-lyria-3-pro-preview-gen-1795196931030-puqx6j.streaming.wav`

## Spend

Total: $0.16 across 2 take(s).

| take | instance id | model | unit price | sidecar |
| --- | --- | --- | --- | --- |
| /Users/robin/xprojects/knowledge-kit/.works/kk-music/morning-chamber-orchids/3-takes/morning-chamber-dark-guitar-lyria-3-pro-preview-gen-1795196931030-puqx6j.mp3 | gen-1795196931030-puqx6j | lyria-3-pro-preview | $0.08 | `morning-chamber-dark-guitar-lyria-3-pro-preview-gen-1795196931030-puqx6j.mp3.take.json` |
| /Users/robin/xprojects/knowledge-kit/.works/kk-music/morning-chamber-orchids/3-takes/morning-chamber-spacious-cut-lyria-3-pro-preview-gen-1795196971433-ib7mnc.mp3 | gen-1795196971433-ib7mnc | lyria-3-pro-preview | $0.08 | `morning-chamber-spacious-cut-lyria-3-pro-preview-gen-1795196971433-ib7mnc.mp3.take.json` |

## Verdict

- verdict: `PASS`
- confidence: `MEDIUM`
- score: `0.825`

Feedback: Tempo is the one measured miss: the take rendered at 90 bpm against the brief's 150 BPM ask (analysis.bpm warn, source lyria instance analysis). A next iterate should state the tempo as the single dominant instruction at the start of `style` and drop the competing "wide choruses" framing from the same sentence, or accept the slower half-time reading deliberately and re-brief the structure timings to match it.

## Delivery

| row | measured | unit | threshold | result | source |
| --- | --- | --- | --- | --- | --- |
| delivery.integrated_loudness | -14.01 | LUFS | -15–-13 | pass | ffmpeg 9.0.1 loudnorm |
| delivery.true_peak | -1 | dBTP | -1 | pass | ffmpeg 9.0.1 loudnorm |
| delivery.sample_rate | 44100 | Hz | 44100 | pass | ffprobe 9.0.1 |

- measured loudness: -14.01 LUFS
- measured true peak: -1 dBTP

## Artifacts

- idea: `idea.md`
- briefs: `1-brief/brief-01.yaml` + `1-brief/brief-01.prompt.txt`
- take: `/Users/robin/xprojects/knowledge-kit/.works/kk-music/morning-chamber-orchids/3-takes/morning-chamber-dark-guitar-lyria-3-pro-preview-gen-1795196931030-puqx6j.mp3` (+ `morning-chamber-dark-guitar-lyria-3-pro-preview-gen-1795196931030-puqx6j.mp3.take.json`)
- checks: `/Users/robin/xprojects/knowledge-kit/.works/kk-music/morning-chamber-orchids/3-takes/morning-chamber-dark-guitar-lyria-3-pro-preview-gen-1795196931030-puqx6j.mp3.checks.json`
- analysis: `3-takes/analysis-gen-1795196931030-puqx6j.json`
- judge input: `4-judge-input.md`
- verdict: `4-verdict-music.json`
- mastered: `/Users/robin/xprojects/knowledge-kit/.works/kk-music/morning-chamber-orchids/3-takes/morning-chamber-dark-guitar-lyria-3-pro-preview-gen-1795196931030-puqx6j.streaming.wav`
