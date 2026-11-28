# video-gen

The 9:16 vertical teaser for a daily AI news episode, as a `kind: generator` plugin: it cuts a
45–60s hook out of the episode audio, word-times it through a locked `faster-whisper` worker,
composites the run's stills (or GPU-generated clips) under a Remotion shell, and emits
`videoGenContentSchema` Content that `shipinhao-pub`, `xhs-pub` and `youtube-pub` publish unchanged.

Contract authority: [`docs/design/short-form-video-promotion.md`](../../../docs/design/short-form-video-promotion.md)
(ADR-060, feature D9) owns the milestone scoping, the provider semantics and the Colab runner rules.
The Content schema lives in [`packages/kk-core/src/schemas.ts:104`](../../../packages/kk-core/src/schemas.ts).
This README owns how to drive, provision and inspect the plugin.

```text
plugins/generations/video-gen/
  plugin.json                   # kind: generator, entry ./src/index.ts
  package.json                  # @gobing-ai/video-gen (remotion, @remotion/bundler|renderer, kk-core)
  pyproject.toml / uv.lock      # private uv project: faster-whisper caption aligner only
  src/
    index.ts                    # --in/--out entry: fail-closed order, mode dispatch, Content emit
    request.ts                  # the `--in` request schema (strict) + mode/provider agreement
    inputs.ts                   # resolve audio, cover, script plan, cards from a daily run
    hook-slicer.ts              # ffprobe duration + one ffmpeg cut with fades → teaser WAV
    captions.ts                 # uv worker invocation + word-track validation
    layout.ts                   # pure math: hook window, caption bursts, waveform, safe zones, PiP box
    props.ts                    # composition props (the shell's contract, asserted in the fast tier)
    render.ts                   # asset staging + render call + artifact verification
    visual-provider.ts          # VisualProvider seam: local-kb, wan21-i2v, musetalk, echomimic-v2
    colab-runner.ts             # colab new/upload/exec/download/stop + budget guard + ledger line
    ccu-ledger.ts               # rolling 30-day CCU estimate and monthly cap
    process.ts / fs.ts          # ts-runtime seams (every spawn and every file op goes through them)
    remotion/                   # Root registry + EditorialReel, AvatarReel, HybridPipReel, captions,
                                # waveform, safe-zone frame, AI生成 label; engine.ts owns Remotion itself
  python/
    align_captions.py           # faster-whisper word timestamps (+ waveform peaks), local CPU
    colab_wan21_i2v.py          # image → 3–5s motion loop worker
    colab_musetalk.py           # portrait + audio → lip-sync clip worker
    colab_echomimic_v2.py       # portrait + audio → half-body clip worker
  tests/                        # bun:test; the three render suites are heavy-tier
```

Nothing outside `src/remotion/engine.ts` (Chromium) and `src/process.ts` call sites (ffmpeg, ffprobe,
uv, colab) touches a native side; the fast tier injects both.

## 1. The request

`--in` is normally a `Doc[]` whose first entry carries the request in `metadata` — `kk executor run`
validates a generator's input against the kind contract, so the plugin's own request rides there. A
bare request object is still accepted for a direct `bun src/index.ts --in request.json` run.

```json
[
    {
        "id": "video-gen-request",
        "body": "",
        "metadata": {
            "workDir": "/abs/works/kk-news/20261127",
            "runDate": "20261127",
            "visualMode": "editorial",
            "provider": "wan21-i2v"
        }
    }
]
```

The schema is strict — an unknown key is an error, never dropped:

| Field | Rule |
| --- | --- |
| `workDir` | Absolute path of the daily run. |
| `runDate` | `YYYYMMDD`; names every artifact. |
| `visualMode` | `editorial` \| `avatar` \| `hybrid-pip`. |
| `hook` | Optional `{ startSec, endSec }`; the length must be 45–60s and inside the audio. |
| `provider` | `local-ken-burns` \| `wan21-i2v` (editorial), `musetalk` \| `echomimic-v2` (avatar modes). Absent means `local-ken-burns`, or `musetalk` for an avatar mode. |
| `colab` | Optional `{ gpu, timeoutMs, maxMonthlyCcu, cacheDir }`; only read by the Colab providers. |
| `hostPortraitPath` | Required for `avatar` and `hybrid-pip`; must be absolute and `.png`/`.jpg`/`.jpeg`/`.webp`. Never discovered — the operator supplies it. |

Mode/provider agreement is checked before anything is spawned:

| Request | Result |
| --- | --- |
| `editorial` + `local-ken-burns` (or no provider) | Local Ken-Burns reel, no GPU, no network. |
| `editorial` + `wan21-i2v` | One Colab job → motion clips; **any** failure falls back to Ken-Burns with a warning. |
| `editorial` + an avatar provider | Refused — a presenter provider is not an editorial renderer. |
| `avatar` / `hybrid-pip` without a readable portrait | Refused. |
| `hybrid-pip` + `echomimic-v2` | Refused — the PiP bubble is a MuseTalk overlay only. |
| `avatar`/`hybrid-pip` where synthesis fails | Exits nonzero, writes no Content. Avatar modes have **no** fallback: a missing presenter is a broken video, and the workflow node's `onError: continue` keeps the episode alive. |

## 2. Inputs read from the daily run

The plugin reads what earlier stages already wrote — no second source of truth, no re-encode:

| Input | Path | Missing |
| --- | --- | --- |
| Episode audio | `31-publish/<date>_13_publish-prep_content.json` → `metadata.audioFile`, else `30-audio/<date>_11_generate_content.json` → `metadata.mp3Path` / `audioPath` | Fails closed |
| Cover artwork | `23-cover/<date>_07_cover_cover.png` | Fails closed |
| Curated script plan | `24-script/<date>_08_script-write_plan.json` (`items[].id` + `lead`) | Fails closed |
| XHS cards | `25-xhs/content.json` → `metadata.images[].path` | Optional; a missing/absent list just renders the cover alone |

The headline is `plan.cover.headline`, else `plan.cards.title`, else the first item's `lead`, else
`runDate`. The emitted Content body is the items' `lead` sentences, blank-line separated.

## 3. Pipeline order (fail-closed)

Request → portrait check → inputs → `ffprobe` duration → hook window → artifact dir → `ffmpeg` slice
→ caption worker → provider → Remotion render → Content. Nothing is spawned and Chromium is never
imported until every input that can be checked without a render has been checked; the Remotion engine
is a lazy import after those checks.

Artifacts land in `<workDir>/32-video/`:

```text
request.json                  # kk stage daily-video-request
<date>_hook.wav               # the 45–60s slice, 44.1kHz stereo PCM, 0.4s fade-in / 0.5s fade-out
<date>_words.json             # { model, language, words: [{word,startSec,endSec}], waveform }
<date>_video.mp4              # H.264 + AAC, 1080×1920, 30fps
<date>_clip-N.mp4             # wan21-i2v loops (editorial + Colab)
<date>_presenter.mp4          # avatar modes
public/                       # stills as still-N.<ext>, teaser as teaser.wav — render inputs only
<date>_video_content.json     # --out
```

The hook window defaults to the episode's cold open: start at 0, end at `min(60s, duration)`. An
episode shorter than the 45s teaser minimum is an error, not a shorter video.

## 4. Captions and the 9:16 shell

Captions come from `faster-whisper` on CPU (`small` by default) run through the plugin's own locked uv
project, so the model stack never enters the Bun dependency graph. Words are grouped into bursts: a
new burst starts at a sentence end, after a silence longer than 0.6s, or when the next word would
exceed 16 characters. The worker's waveform peaks (48 buckets) drive the audio bar.

The shell is one geometry for every channel — `1080×1920` @ `30fps`, bottom 480px and right 162px
reserved for platform UI, so nothing readable renders there:

| Composition | Visuals |
| --- | --- |
| `EditorialReel` | Ken-Burns stills (or `wan21-i2v` clips) in equal slices, headline card, kinetic word-highlighted captions, waveform strip, 3.5s podcast CTA tail. |
| `AvatarReel` | The synthesized presenter clip fills the frame, with the same captions, waveform and CTA, plus the always-on `AI生成` label. |
| `HybridPipReel` | `EditorialReel` canvas plus a 320px circular MuseTalk bubble at bottom-left, clear of the overlay margins by construction. |

## 5. Colab GPU runner

One attempt is `colab new --gpu <T4|L4|A100>` → optional `drivemount` → `upload` each input →
`exec --file <worker>` → `download` each output → `stop`. The session name carries the date, the job
type and a fresh UUID, so a retry's teardown can only target that attempt.

| Job | Default GPU | Default deadline | Refused |
| --- | --- | --- | --- |
| `wan21-i2v` | `A100` | 600s | `T4` (14B checkpoints do not fit 16GB) |
| `musetalk` | `T4` | 600s | — |
| `echomimic-v2` | `A100` | 900s | `T4` |

Weights cache to `KK_COLAB_CACHE_DIR` (default `/content/drive/MyDrive/kk-video-cache`); when Drive is
not mounted the worker keeps a VM-local cache and reports `cache: "local"` so the cold download is
visible. Workers expect prepared upstream checkouts at `KK_MUSETALK_REPO` / `KK_ECHOMIMIC_REPO`, and
`KK_WAN21_MODEL` / `KK_WAN21_STEPS` tune the Wan2.1 worker.

Every job appends `{timestamp, gpu, durationSec, estimatedCcu, jobType, status}` to
`colab-ccu-ledger.jsonl` **at the works root** — `<workDir>/..`, or `KK_WORKS_DIR` when set, because a
per-run ledger would reset the rolling window every day. Before launching, the runner sums the last
30 days against `maxMonthlyCcu` (default `180`) using conservative burn factors (T4 ≈ 2, L4 ≈ 3,
A100 ≈ 7 CCU/hour). A refusal launches nothing and costs nothing, and for `wan21-i2v` it becomes the
fallback warning; the estimate is intentionally approximate — Google exposes no per-job CCU query.

## 6. Output Content

```json
{
    "title": "今日 AI 要闻",
    "body": "…plan items' leads…",
    "format": "video",
    "metadata": {
        "generator": "kk:video-gen",
        "videoPath": "/abs/works/kk-news/20261127/32-video/20261127_video.mp4",
        "coverPath": "/abs/works/…/23-cover/20261127_07_cover_cover.png",
        "width": 1080,
        "height": 1920,
        "fps": 30,
        "durationSec": 52.4,
        "visualMode": "editorial",
        "renderProvider": "local-ken-burns",
        "captionsPath": "/abs/works/…/32-video/20261127_words.json",
        "tags": ["AI", "日报"]
    }
}
```

`fallbackUsed` and `warnings[]` appear only when a Colab run failed and the local reel took over;
`syntheticPresenter: true` marks the avatar modes. `ccuEstimated` is reserved in the schema but this
build reports spend through the ledger, not the Content.

## 7. Provisioning and running

The local runtime is provisioned once per machine (or after a model/browser cache wipe):

```sh
cd plugins/generations/video-gen
uv sync --locked --no-dev
uv run --locked --no-dev python -c "from faster_whisper.utils import download_model; download_model('small')"
bun -e 'import { ensureBrowser } from "@remotion/renderer"; await ensureBrowser();'
```

The renderer refuses to download Chromium mid-run (`onBrowserDownload` throws), so a missing cache is a
named provisioning failure rather than a silent network fetch inside a cron tick.

Direct run:

```bash
bun plugins/generations/video-gen/src/index.ts --in request.json --out content.json
```

In the daily pipeline the `video` node runs `kk stage daily-video-request <workDir> <runDate> <videoVar>`
then `kk executor run video-gen …`. The stage maps `editorial-wan` to `visualMode: editorial` +
`provider: wan21-i2v` and forwards any other value as the visual mode, so the plugin's own ladder is
the only validator. The node is gated on the `video` workflow var (`off` by default) and is
`onError: continue` — a lost video never costs the episode.

| Env | Used by | Meaning |
| --- | --- | --- |
| `KK_COLAB_BIN` | runner | `colab` binary (default `colab`). |
| `KK_COLAB_CACHE_DIR` | runner / workers | Weight cache dir; defaults to the Drive path. |
| `KK_WORKS_DIR` | ledger | Places `colab-ccu-ledger.jsonl` explicitly. |
| `KK_CAPTION_MODEL` / `KK_CAPTION_LANGUAGE` | caption worker | Model size (default `small`) and forced language (default autodetect). |
| `HF_HUB_OFFLINE=1` | caption worker | Set by the plugin; the model must already be downloaded. |

## 8. Tests

```bash
bun test plugins/generations/video-gen/tests/video-gen.test.ts   # fast, no spawn, no browser
bun run test                                                     # whole fast tier
bun run test:heavy                                               # the three render suites
```

The fast tier asserts the fail-closed ladder (zero spawn on a bad request), the hook-window bounds,
caption chunking, safe-zone/PiP geometry, prop building, the provider fallback table and the whole
Colab runner against a fake CLI — including teardown-per-attempt, timeout, budget refusal and ledger
append. `tests/render-e2e.test.ts`, `render-wan-e2e.test.ts` and `render-avatar-e2e.test.ts` are
registered in `scripts/test-suites.ts` as heavy-tier: they render real Chromium output and verify the
MP4 with `ffprobe`. No test spends Colab compute or network.
