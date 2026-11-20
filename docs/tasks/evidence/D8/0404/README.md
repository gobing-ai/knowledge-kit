# 0404 — one music track, end to end (evidence)

**Status at 2026-11-20: accepted.** The `kk-music` workflow ran one real idea against the live homelab
lyria-3-pro instance: two Pro takes from two differentiated briefs, the operator picked one at `select`,
the selected take was analyzed, measured, judged against the `music-quality` rubric and mastered to the
`streaming` delivery profile. `song` (format) and `synthwave` (theme) are promoted to `verified` on the
strength of this take.

- Idea: the operator's, captured from the lyria studio project `proj-1795030763741-2n8j8s`
  (150 BPM / D minor / baritone lead / dark production over a pastoral Chinese theme).
- Theme choice: `synthwave`.
- Frozen vars: `format=song`, `directions=2`, `delivery_profile=streaming`, `auto=false`,
  `accept_revision=false`, `force=false`.
- Instance: `KK_MUSIC_INSTANCE_URL=http://127.0.0.1:3100` — the Mac Mini's native lyria-3-pro, bound to
  loopback (`host.docker.internal:3100` from Caddy; public entry `music.robinmin.net` behind CF Access).
  Probed free with `kk music library --json` before anything paid.
- Run `c73a9b02-1958-4fd8-b159-f137ae8c5a99` → `done`.

## Deliverable

| Fact | Value |
| --- | --- |
| Selected take | brief 01, `Morning Chamber, Dark Guitar` |
| Instance id | `gen-1795196931030-puqx6j` (model `lyria-3-pro-preview`, provider `gemini`) |
| Instance analysis | title "When the Orchids Grow", Alternative Rock / Emotional, energy 75, **90 bpm**, **D minor**, 8 named instruments, 6 sections |
| Duration | 149.13 s measured (`ffprobe 9.0.1`), brief target `2:30`, band 120–180 s |
| Silence | leading 0 s, trailing 0.67 s (`ffmpeg 9.0.1 silencedetect`) |
| Judge | `PASS`, confidence `MEDIUM`, score **0.825** — the one warn is `analysis.bpm` (90 rendered against the 150 BPM ask) |
| Delivery | **−14.01 LUFS** / **−1 dBTP** / 44100 Hz, `streaming` profile (`ffmpeg 9.0.1 loudnorm`, `ffprobe 9.0.1`) — all three rows pass |
| Spend | **$0.16** = 2 Pro takes × `$0.08`; analysis unpriced on this instance (`unitPrice: null`) |
| sha256 (original take, mp3) | `25cde1c736a2a6c024bf915564df5dd9c99f5316c51fdf002525dbebd58a252d` |
| sha256 (mastered, wav) | `3ed38685eb1fdceb0ddfbb763042cbb0f69fc98da0b12444378900a1dd7c6107` |

No audio bytes are committed. The originals live in `.works/kk-music/morning-chamber-orchids/3-takes/`
(`…puqx6j.mp3` and `…puqx6j.streaming.wav`); the digests above are the durable record. AC1's
byte-for-byte clause holds by construction: `master` writes a new file and the provider take is never
rewritten — its digest was taken after the run and matches the one recorded at generation.

## What ran (one workflow, eleven states, one operator pause)

`prepare → brief → explore → select → analyze → check → judge → master → finalize → done`

| State | Artifact / result |
| --- | --- |
| `prepare` | `idea.md`, `1-brief/`, `3-takes/` under `$works/kk-music/morning-chamber-orchids/` |
| `brief` | `brief-01.yaml` (150 BPM guitar-forward) and `brief-02.yaml` (104 BPM chamber-leaning), each rendered to `…prompt.txt` + `…render.txt` |
| `explore` | 2 paid takes, one per brief, in the format's own model (`lyria-3-pro-preview`); `3-takes/explore.json` |
| `select` | **operator gate** — take 01 chosen; `3-takes/selection.json` |
| `analyze` | `3-takes/analysis-gen-1795196931030-puqx6j.json` (paid, unpriced) |
| `check` | `…puqx6j.mp3.checks.json` — 7 rows, one warn (`analysis.bpm`), no fail |
| `judge` | `4-judge-input.md` assembled by the run; `4-verdict-music.json` written by `kk:content-judge` with the `music-quality` rubric |
| `master` | `…puqx6j.streaming.wav` + three delivery rows, all pass |
| `finalize` | `5-run-report.md` / `5-run-report.json` (spend, verdict, delivery, artifact paths) |

## Files here

- `accepted/` — the accepted run: `idea.md`, both briefs with prompt text and render trace, `explore.json`,
  `selection.json`, `content-01.json`, the take sidecars for both takes, the selected take's
  `checks.json`, its instance `analysis-*.json`, `4-judge-input.md`, `4-verdict-music.json`,
  `5-run-report.{md,json}`, both instance generation records (proving `provider: "gemini"` and the
  measured durations), and `sha256.txt`.
- `dryrun/` — the free rehearsal that ran before any money was committed: the `spur workflow trace`
  transcript and its deterministic artifacts. It stopped at `check` on `duration.target` (the offline
  adapter's 1 s silent WAV), which is the adapter's documented behaviour, not a defect.
- `paid/` — the **first** paid attempt, kept as history: it produced two 8 s takes because the instance
  was then running `LYRIA_MOCK=1` (`provider: "mock"`, $0 spent), and it stopped at `select`. Nothing
  from that attempt was analyzed, mastered, judged or promoted.

## Findings recorded, not fixed here

1. **Instance provider was mock.** The first paid attempt hit `LYRIA_MOCK=1`; the run stopped at `select`
   instead of substituting artifacts. Fixed by restarting the instance without it (see 0404's Q&A).
2. **Connect deadline vs synchronous generate.** The adapter counts "connect" until response headers
   arrive (`plugins/generations/music-gen/src/adapter/instance.ts` `attempt()`), and this instance
   answers `POST /api/lyria/generate` only after the take is complete — so the 5 s default reported a
   real ~40 s generation as `unreachable` and never billed. Worked around locally with
   `music.instance.connectTimeoutMs: 120000` in `~/.config/kk/config.yaml` (not committed); filed as a
   residual task.
3. **Tempo.** 90 BPM rendered against the 150 BPM ask (`analysis.bpm` warn, judge feedback). Accepted as
   the take's actual read rather than re-bought; the next brief should make tempo the dominant
   instruction in `style`.
4. **Installed-package preset root.** `kk`'s bundle resolved `MUSIC_PRESET_ROOT` to a directory the
   package does not ship — fixed under 0413 (this run used the checkout via `KK_MUSIC_KK_BIN` until the
   fix landed).
5. **Workflow gates.** The `brief` guard's unpadded file test (0411) and the `hitl.select` gate that
   `spur workflow continue` cannot answer (0412) were fixed before this run.

## Free regression path (R6 — no paid call)

```bash
# 1. The rendered prompt text is byte-identical to what is committed here.
bun apps/cli/src/index.ts music render --in accepted/brief-01.yaml --out /tmp/brief-01.prompt.txt \
  && cmp /tmp/brief-01.prompt.txt accepted/brief-01.prompt.txt

# 2. The committed preset data still resolves and the index still matches.
bun apps/cli/src/index.ts music presets --json | jq -r '.root, (.formats[]|.name), (.themes[]|.name)'
bun plugins/generations/music-gen/scripts/gen-preset-index.ts --check

# 3. The workflow's own dry run reproduces its deterministic artifacts and stop state (no socket, no spend).
export KK_MUSIC_KK_BIN="$PWD/apps/cli/src/index.ts"
spur workflow run plugins/kk/workflows/kk-music.yaml --vars '{"topic":"regression dryrun","format":"song","theme":"synthwave","directions":"2","works":".works/tmp","dry_run":"true","auto":"false","executor":"host"}'
#   expected: pause at `brief` → author two briefs → pause at `select` → answer a take number
#   → fail at `check` with `duration.target` (the offline adapter's 1 s silent WAV).
```

The measured numbers a later change must not regress are in the deliverable table above: 149.13 s,
leading silence 0 s, trailing 0.67 s, D minor, 6 sections, −14.01 LUFS, −1 dBTP, 44100 Hz, judge PASS
at 0.825.
