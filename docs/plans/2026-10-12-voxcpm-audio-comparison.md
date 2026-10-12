# VoxCPM vs Gemini daily-audio comparison — 2026-10-12 (partial evidence)

Task: **0258** — *Compare VoxCPM and Gemini daily audio with recorded quality evidence* (feature G14).
Status of this report: **inconclusive for the matched comparison**. The VoxCPM arm could not render
anything; the Gemini arm rendered both frozen fixtures successfully. Listening evidence: **pending**.

- Execution tree: `/Users/robin/xprojects/knowledge-kit-runall-0258-0263-ae89` (worktree, branch `sp/runall-0258-0263-ae89`)
- Base ref / base SHA: `main` @ `8a31367f`
- Run id: `runall-0258-0263-ae89`
- Scratch (untracked): `.spur/run/0258-voxcpm-comparison/`

## 1. Frozen fixtures

Two short VoiceScripts, byte-frozen before any render (Chinese and mixed Chinese-English), plus their
wrapped `Doc[]` serialization in the same shape as the daily wrap step
(`{id, title, sourceUri, body, mediaType, metadata.voiceProfile}`):

| Fixture | SHA256 (bytes) |
| --- | --- |
| `plugins/generations/voxcpm-tts/tests/fixtures/comparison-zh.yaml` | `354c5c40c471658e559a0d2ee0bf2db541e8f039b88ffb5c27146fc8059042cd` (406) |
| `plugins/generations/voxcpm-tts/tests/fixtures/comparison-mixed.yaml` | `709db46537e927b4173b9c159b1716a69d05ce5b225f68ae36f1e6d266a6ac95` (407) |
| `.spur/run/0258-voxcpm-comparison/fixtures/comparison-zh.docs.json` | `697f4b87698125cde36007c496dda5a08a2dc011b0dcc09005b1601431ab88f3` |
| `.spur/run/0258-voxcpm-comparison/fixtures/comparison-mixed.docs.json` | `b8e2ecdbb2921a49fe91815f4411da2814f61ae50f90a4b2df733d0517a95349` |

Settings frozen in both fixtures: `default_profile: robin-news`, `language: zh`, per-segment
`speed: 1`, `seed: 42`, `gap_ms: 500` (last segment `0`). Validated with the project validator:

```bash
bun plugins/kk/scripts/validate-voicescript.ts --in plugins/generations/voxcpm-tts/tests/fixtures/comparison-zh.yaml     # exit 0
bun plugins/kk/scripts/validate-voicescript.ts --in plugins/generations/voxcpm-tts/tests/fixtures/comparison-mixed.yaml  # exit 0
```

## 2. Representative existing daily episode (frozen, not rendered)

| Item | Value |
| --- | --- |
| Script | `/Users/robin/xprojects/knowledge-kit/.works/kk-daily-ai-voice/20261010/24-script/20261010_08_script_voicescript.yaml` |
| Date | 2026-10-10 |
| SHA256 | `712cbf0ea4da0c3e4f5ecbc2c929c47933412099d26ba880f21a545cffb25c3d` (17 414 B) |
| Shape | 41 segments, 8 `gap_ms: 1200` group markers (opening / items / closing) |
| Existing audio | `.works/kk-daily-ai-voice/20261010/30-audio/20261010_10_wrap-docs_docs.json`, `…_11_generate_content.wav`/`.mp3`/`.intro.wav` |
| Configured intro sting | `.works/kk-daily-ai-voice/AI每日资讯_8秒播客片头.mp3`, SHA256 `fe46031ccad5024aa7e36b7b13b9239d591c15d56c0fe5fc6b976ff7b387c5a2`, 223 862 B, 8.81 s |

The four isolated full-episode render work roots (`24-script/`+`30-audio/` copies, one per
driver × stage shape) and the `daily-intro` / `daily-episode-duration` gates were **not** created or
run: the matched comparison is unachievable while the VoxCPM arm produces no audio (see §3), and
task 0258's contract is to stop affected expensive renders after one diagnosed failure rather than
burn the render budget on a one-sided measurement. No episode text was invented or padded.

## 3. Blocker — VoxCPM worker never answers a successful request (P0, product defect in 0256/0257)

`plugins/generations/voxcpm-tts/python/worker.py:322-344` — `main()` calls `_respond()` **only on
the error paths** (oversized frame, malformed request, `WorkerError`, generic exception). There is no
success-path response, so a valid `health` or `render` request produces **no line on the NDJSON
channel**. `src/voxcpm-client.ts` resolves responses by id from `pending`, so every request
dead-ends on its deadline.

Direct evidence (traced run of the real worker, `main` instrumented by wrapping `_respond`/`_handle`
without modifying the file):

```
$ VOXCPM_PROFILES_PATH=<plugin>/profiles.json ./.venv/bin/python <tracer>.py <<< '{"id":1,"op":"health"}'
HANDLE op=health
HANDLE returned ['ok', 'sample_rate', 'model']      # _handle succeeded
main returned 0                                      # loop ended; _respond NEVER called
out_bytes=0                                          # 0 bytes on the protocol channel
```

The same worker loads the model correctly (`stderr`):

```
voxcpm_model_path: /Users/robin/.cache/huggingface/hub/models--openbmb--VoxCPM2/snapshots/32279effe8c19989596f05d353d1447f51d9e915
[voxcpm2] adjusted dtype bfloat16 -> float32 for device mps
Running on device: mps, dtype: float32
Loaded VoxCPM2Model
```

Production-visible consequence — the real entry through the CLI, bounded startup:

```bash
# cwd = execution tree
VOICE_GEN_MP3=true VOICEBOX_MAX_VERIFY_ATTEMPTS=0 VOICEBOX_TIMEOUT_MS=60000 VOICE_GEN_MAX_RUN_MS=180000 \
  bun apps/cli/src/index.ts executor run voxcpm-tts \
    --in .spur/run/0258-voxcpm-comparison/fixtures/comparison-zh.docs.json \
    --out .spur/run/0258-voxcpm-comparison/out/comparison-zh.voxcpm.content.json \
    --plugins-root "$PWD/plugins"
# exit 1 after 61 s
# Plugin entry 'voxcpm-tts' failed (exit code 1): voxcpm-tts failed: voxcpm-tts: voxcpm-tts worker startup timed out after 60000ms
```

An earlier run with the default startup bound (`VOICEBOX_TIMEOUT_MS` unset ⇒ 600 000 ms) hung for the
full 10 minutes and was killed by the outer bound, producing no output file — i.e. the failure mode in
production is a 10-minute hang, not an error.

**Why the defect escaped:** `tests/test_worker.py` covers only the error paths
(`test_main_handles_malformed_and_unsupported_requests` sends `op: bogus`); no test asserts a
successful `health`/`render` response from `main`, and the TypeScript tests use fake workers.
The defect is present at HEAD (`08689ca5`, the G14 landing commit), not introduced here.

**Logs/artifacts:** `.spur/run/0258-voxcpm-comparison/logs/voxcpm-zh-short.log`
(129 B: the startup-timeout error) and the 10-minute attempt
(`…/logs/voxcpm-zh-short.log`, empty, killed at the 600 s outer bound). Worker-tracer and probe
scripts: `/tmp/kk-0258/` (scratch, not retained as evidence).

Secondary observation: with `VOICE_GEN_MAX_RUN_MS=180000` set, the invocation was **not** cut at 3
minutes — the wait that hung was startup (`health`), which is bounded by `VOICEBOX_TIMEOUT_MS`
(default 600 s) rather than by the whole-run cap. Recorded as an observation, not a claimed defect:
the primary defect already explains the hang.

## 4. VoxCPM backend diagnosis (Step 0, obtained)

| Item | Observed |
| --- | --- |
| Interpreter/project | `uv` 0.11.28, independent uv project `plugins/generations/voxcpm-tts`, Python 3.12, `.venv` 1.4 GB |
| `uv sync --locked --no-dev` | exit 0 (1.2 s, wheels already cached) |
| Package | `voxcpm==2.0.3` (`dist-info/METADATA` `Version: 2.0.3`); module exposes **no** `__version__` ⇒ provenance `unknown` via `getattr` |
| torch | `2.14.1` |
| Model | `openbmb/VoxCPM2` (HF cache `~/.cache/huggingface`, 4.6 GB), snapshot revision `32279effe8c19989596f05d353d1447f51d9e915` |
| Device / dtype | `auto` ⇒ `mps`, `bfloat16 -> float32` (library-adjusted) |
| Native sample rate | 48 000 Hz (`model.tts_model.sample_rate`) |
| Model load time | 17–28 s per process (one load per invocation; `health` then reuse) |
| Hardware | Apple M5, 32 GB, Metal 4 |
| Inference | **not reached** — the protocol response is missing (§3) |

## 5. Gemini arm (measured)

Exact commands (same frozen `Doc[]` inputs, isolated output paths, no collection/publication):

```bash
VOICE_GEN_MP3=true VOICEBOX_MAX_VERIFY_ATTEMPTS=0 bun apps/cli/src/index.ts executor run gemini-tts \
  --in  .spur/run/0258-voxcpm-comparison/fixtures/comparison-zh.docs.json \
  --out .spur/run/0258-voxcpm-comparison/out/comparison-zh.gemini.content.json \
  --plugins-root "$PWD/plugins"        # exit 0, 15 s

VOICE_GEN_MP3=true VOICEBOX_MAX_VERIFY_ATTEMPTS=0 bun apps/cli/src/index.ts executor run gemini-tts \
  --in  .spur/run/0258-voxcpm-comparison/fixtures/comparison-mixed.docs.json \
  --out .spur/run/0258-voxcpm-comparison/out/comparison-mixed.gemini.content.json \
  --plugins-root "$PWD/plugins"        # exit 0, 18 s
```

| Artifact | ffprobe |
| --- | --- |
| `out/comparison-zh.gemini.content.wav` | `pcm_s16le`, 24 000 Hz, mono, 13.06 s, 626 924 B (+ `.mp3` 105 261 B) |
| `out/comparison-mixed.gemini.content.wav` | `pcm_s16le`, 24 000 Hz, mono, 15.26 s, 732 524 B |

- Provenance verified on the artifact: `metadata.generator == "kk:gemini-tts"` (no Voicebox fallback,
  no silent substitution). Per-segment metadata: `comparison-zh` → 5.12 s + 7.44 s with
  `profile: robin-news`; speech is 12.56 s, episode duration 13.06 s includes the frozen 500 ms gap.
- Model/profile: `GEMINI_TTS_MODEL=gemini-3.8-flash-tts`, profile `robin-news` (from the operator's
  `~/.config/kk/gemini-tts-profiles.json`). Seed: the current Gemini generate path sends none —
  the frozen `seed: 42` is **intended** input, and no deterministic-output equivalence with VoxCPM
  (`torch.manual_seed`) is claimed.
- Retry/probe cost actually observed: two renders, two segments each, no retry or quota-probe lines
  on either invocation. Both renders were green on the first attempt.

## 6. Quality evidence

**Listening: pending.** This execution environment has no playback path; no human listened to either
artifact. Per task contract, pronunciation / completeness / timbre / prosody / pauses / artifacts are
therefore recorded as **not assessed** rather than asserted, and the comparison verdict is
**inconclusive**.

QC/ASR: the shared pipeline omits transcription, so ASR-dependent QC is reported unavailable (not a
passing result). No QC scores were produced for the Gemini artifacts beyond the pipeline's own
loudness/normalization audit; nothing here should be read as a quality score.

## 7. Verdict and recommendation

| Question (G14) | Answer from this evidence |
| --- | --- |
| Does VoxCPM work as a daily driver? | **Not demonstrated** — the plugin cannot complete a request (§3); no audio was produced. |
| Is VoxCPM better / comparable / worse than Gemini? | **Inconclusive** — a matched comparison requires both drivers; only the Gemini side rendered. |
| Cost/operating profile | VoxCPM: not measurable (blocked). Gemini: 15 s / 18 s wall for ~13–15 s of audio, 48 kHz→24 kHz mono WAV 16-bit, on the same machine. |

**Recommended follow-up (not done here — out of 0258's scope; production edits are forbidden in this
task):** add the missing success-path `_respond(stdout, request.get("id"), payload)` in
`plugins/generations/voxcpm-tts/python/worker.py` and a `test_worker.py` case that asserts the
successful `health` (and `render`) response shape, then re-run this comparison's full budget
(4 short + 4 full renders, both stage shapes, same intro sting + `daily-episode-duration` gate).
Filing owner: task 0256/0257 (G14); see the follow-up task filed by this batch.

## 8. Reproduction

```bash
# 1. environment
uv sync --locked --no-dev --project plugins/generations/voxcpm-tts        # exit 0
# 2. VoxCPM arm (expected to fail while §3 is unfixed)
VOICE_GEN_MP3=true VOICEBOX_MAX_VERIFY_ATTEMPTS=0 VOICEBOX_TIMEOUT_MS=60000 \
  bun apps/cli/src/index.ts executor run voxcpm-tts --in <zh docs.json> --out <voxcpm content.json> --plugins-root "$PWD/plugins"
# 3. Gemini arm (expected green)
VOICE_GEN_MP3=true VOICEBOX_MAX_VERIFY_ATTEMPTS=0 \
  bun apps/cli/src/index.ts executor run gemini-tts --in <zh docs.json> --out <gemini content.json> --plugins-root "$PWD/plugins"
# 4. measure
ffprobe -v error -show_entries stream=sample_rate,channels,duration,codec_name -of default=noprint_wrappers=1 <wav>
```

## 9. Limits of this evidence

- No VoxCPM audio, no matched render, no full-episode render, no `daily-intro` /
  `daily-episode-duration` gate, no listening, no ASR.
- Timings are single-sample wall clocks on one machine, not a benchmark.
- Only allowlisted configuration is recorded; no environment or secret dumps.
- No production source, default, calibration, profile or config was modified by this task.
