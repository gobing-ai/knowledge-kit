# 0404 — one music track, end to end (evidence)

**Status at 2026-11-20: not accepted.** The free rehearsal ran end to end; the paid round reached the
two-take `select` gate against a live instance, but the instance is running its **mock provider**
(`LYRIA_MOCK=1`), so both takes are 8-second $0 synthesized placeholders, not Lyria renders. Per this
task's closed Q&A ("never substitute dry-run artifacts for paid evidence", "instance unreachable →
stop and report") the run stops at `select`: no `analyze` was paid for, no take was accepted, nothing
was `master`ed, no preset was promoted, and no doc claims a capability that was not exercised.

- Idea: the operator's, captured from the lyria studio project `proj-1795030763741-2n8j8s`
  (150 BPM / D minor / baritone lead / dark production over a pastoral Chinese theme).
- Theme choice: `synthwave` (operator pick; it becomes the candidate `verified` theme once a real take
  is accepted).
- Frozen vars: `format=song`, `directions=2`, `delivery_profile=streaming`, `auto=false`,
  `accept_revision=false`, `force=false`.
- Instance: `KK_MUSIC_INSTANCE_URL=http://127.0.0.1:3100` (the Mac Mini's native lyria-3-pro on
  `host.docker.internal:3100`, behind the `music.robinmin.net` CF tunnel → Caddy). Probed free with
  `kk music library --json` before anything paid.
- CLI used for every nested verb: the checkout (`KK_MUSIC_KK_BIN=<repo>/apps/cli/src/index.ts`). The
  **installed** `kk` cannot load the shipped presets at all — running `dist/index.js` resolves
  `MUSIC_PRESET_ROOT` to `<pkg>/presets` (absent) instead of `plugins/generations/music-gen/presets`,
  so `kk music presets` fails with `preset directory is missing`. That is a packaging defect for 0404
  R5 to file, worked around here only via the documented `KK_MUSIC_KK_BIN` stage escape.

## What ran

| Step | Command | Result |
| --- | --- | --- |
| Free rehearsal | `spur workflow run plugins/kk/workflows/kk-music.yaml --vars '{"dry_run":"true",…}'` (run `b964b82b-4b36-4d34-94dc-45d9e2b6a845`) | stopped at **`check`** on `duration.target` (1 s silent offline WAV vs the `2:30` target) |
| Paid explore | same workflow, `dry_run=false` (run `be6fc51f-90c8-4ba5-8c6c-ca19c1004b17`) | 2 takes generated, run **paused at `select`** — stopped there |
| Selection / analyze / check / judge / master | — | **not run** (see Status) |

The refine note predicted the dry run would stop on `silence.*`; the measured stop is
`duration.target`. Recorded as a finding, not a reason to edit code: the offline adapter emits a 1 s
silent WAV, which fails the duration band first.

## Dry-run evidence (`dryrun/`)

`transcript.json` / `transcript.txt` (the `spur workflow trace` of the rehearsal), both `brief-<nn>.prompt.txt`
(the exact prompt text), `brief-<nn>.render.txt` (render's resolved job + request), `explore.json`,
`analysis-offline-take-1.json`, and `morning-chamber-dark-guitar-pro-offline-take-1.wav.checks.json`
— the measured 1 s duration fail, with `source` on every row.

## Paid-attempt evidence (`paid/`)

`idea.md`, both authored briefs and their prompt text, `explore.json` (two `status: generated` briefs,
`unitPrice: 0.08` each), both `.take.json` sidecars, and the **instance's own record** of each
generation (`instance-record-01.json`, `instance-record-02.json`).

| Fact | Take 01 | Take 02 |
| --- | --- | --- |
| Instance id | `gen-1795194526460-lsg320` | `gen-1795194528188-chlt4q` |
| Instance provider | **`mock`** | **`mock`** |
| Measured duration (ffprobe) | 8.000 s (target 2:30) | 8.000 s (target 2:30) |
| Mean / max volume (ffmpeg) | −12.5 dB / −6.0 dB | −12.5 dB / −6.0 dB |
| sha256 of the original take | `ce15401262371de9ba93d083958350cee39997637a8c78d17563ad0955698612` | `d691f8f03ff692444e6ec3fcaec78c9de891c87617976efe2b667dba003c449c` |
| Local artifact (not committed) | `.works/kk-music/morning-chamber-pastoral-dark-electronic/3-takes/morning-chamber-dark-guitar-lyria-3-pro-preview-gen-1795194526460-lsg320.wav` | `.works/kk-music/…-gen-1795194528188-chlt4q.wav` |

**Spend.** The CLI's local price table recorded 2 × `$0.08` = `$0.16`; the instance reports
`provider: mock`, which "uses no key at all and reports neither" (its own README: `LYRIA_MOCK=1` is
"$0, no keys needed"), so the actual provider spend is **$0.00**. No audio bytes are committed.

## Resume conditions

1. Restart the instance without `LYRIA_MOCK=1` and with a funded `GEMINI_API_KEY` (billing enabled —
   Google's free tier allows zero Lyria requests/day), per `homelab/lyria-3-pro/README.md`.
2. Re-probe `kk music library --json` and confirm a **new** generation comes back with
   `provider: "gemini"` and a duration near the target — not `mock`, not 8 s.
3. Re-run the paid explore into a **fresh** run directory (the two mock takes in
   `.works/kk-music/morning-chamber-pastoral-dark-electronic/` are adopted by their sidecars and must
   not be mistaken for the accepted take), then `select` → `analyze` → `check` → `judge` → `master`.

## Regression path (R6, free)

```bash
# 1. The rendered prompt text is byte-identical to what is committed here.
bun apps/cli/src/index.ts music render --in paid/brief-01.yaml --out /tmp/brief-01.prompt.txt && \
  cmp /tmp/brief-01.prompt.txt paid/brief-01.prompt.txt

# 2. The workflow's own dry run reproduces its deterministic artifacts and stop state.
export KK_MUSIC_KK_BIN="$PWD/apps/cli/src/index.ts"
spur workflow run plugins/kk/workflows/kk-music.yaml --vars '{"topic":"regression dryrun","format":"song","theme":"synthwave","directions":"2","works":".works/tmp","dry_run":"true","auto":"false","executor":"host"}'
#   expected: paused at `brief` → author two briefs → paused at `select` → answer a take number
#   → failed at `check` with `duration.target` (1 s offline WAV). No socket, no spend.
```

## Defects found (filed, not fixed inside 0404)

| Defect | Task |
| --- | --- |
| `brief` guard tested an unpadded `brief-<n>.yaml`, so any 2-direction run died at `brief` | filed + fixed under 0411 |
| `select` was a `hitl.select` gate that `spur workflow continue --answer` cannot answer (yes/no/cancel only) | filed + fixed under 0412 |
| Installed `kk` cannot resolve `plugins/generations/music-gen/presets` from the bundle | filed as a residual (below) |
| The lyria instance runs `LYRIA_MOCK=1` | operator incident, recorded in 0404's Q&A (no code) |
