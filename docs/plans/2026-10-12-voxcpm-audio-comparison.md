# VoxCPM vs Gemini daily-audio comparison — 2026-10-12

Task: **0258** — *Compare VoxCPM and Gemini daily audio with recorded quality evidence* (feature G14).
Status of this report: **matched comparison complete for 3 of 4 full-episode cells; the 4th
(Gemini · sequential sections) is blocked by the Gemini daily quota and produced a Voicebox
fallback artifact, which is explicitly not Gemini evidence.** Listening evidence: **pending**.

- Execution tree: `/Users/robin/xprojects/knowledge-kit-runall-0258-0263-ae89` (worktree, branch `sp/runall-0258-0263-ae89`)
- Base ref / base SHA: `main` @ `8a31367f`
- Run id: `runall-0258-0263-ae89` (0258 pipeline), wrap `wrap-fb44af`, 0263 pipeline `run-0263-ce416e`
- Scratch (untracked): `.spur/run/0258-voxcpm-comparison/`

## 1. Frozen fixtures

Two short VoiceScripts, byte-frozen before any render (Chinese and mixed Chinese-English), plus their
wrapped `Doc[]` serialization in the same shape as the daily wrap step:

| Fixture | SHA256 (bytes) |
| --- | --- |
| `plugins/generations/voxcpm-tts/tests/fixtures/comparison-zh.yaml` | `354c5c40c471658e559a0d2ee0bf2db541e8f039b88ffb5c27146fc8059042cd` (406) |
| `plugins/generations/voxcpm-tts/tests/fixtures/comparison-mixed.yaml` | `709db46537e927b4173b9c159b1716a69d05ce5b225f68ae36f1e6d266a6ac95` (407) |
| `.spur/run/0258-voxcpm-comparison/fixtures/comparison-zh.docs.json` | `697f4b87698125cde36007c496dda5a08a2dc011b0dcc09005b1601431ab88f3` |
| `.spur/run/0258-voxcpm-comparison/fixtures/comparison-mixed.docs.json` | `b8e2ecdbb2921a49fe91815f4411da2814f61ae50f90a4b2df733d0517a95349` |

Settings frozen in both: `default_profile: robin-news`, `language: zh`, per-segment `speed: 1`,
`seed: 42`, `gap_ms: 500` (last `0`). Both validate: `bun plugins/kk/scripts/validate-voicescript.ts
--in <fixture>` → exit 0.

## 2. Representative episode (frozen)

| Item | Value |
| --- | --- |
| Script | `.works/kk-daily-ai-voice/20261010/24-script/20261010_08_script_voicescript.yaml` |
| Date | 2026-10-10 · 41 segments · 8 `gap_ms: 1200` group markers → 9 sections `[6,6,5,5,5,4,4,5,1]` |
| SHA256 | `712cbf0ea4da0c3e4f5ecbc2c929c47933412099d26ba880f21a545cffb25c3d` (17 414 B) |
| Wrapped `Doc[]` (copied into each root) | SHA256 `dee6f197fa29fbf1…` |
| Configured intro sting | `.works/kk-daily-ai-voice/AI每日资讯_8秒播客片头.mp3` — SHA256 `fe46031ccad5024aa7e36b7b13b9239d591c15d56c0fe5fc6b976ff7b387c5a2`, 223 862 B, 8.81 s |

Four isolated scratch roots under `.spur/run/0258-voxcpm-comparison/work-roots/<driver>-<shape>/`,
each with the script at `24-script/20261010_08_script_voicescript.yaml`, the wrapped Docs at
`30-audio/20261010_10_wrap-docs_docs.json` and the plan sidecar at `21-plan/20261010_03_plan_plan.json`.
No production work dir was read-modified; no collect/judge/publish-prep or publisher command ran.

## 3. Source fix required to make any of this measurable (P0, delivered here)

`plugins/generations/voxcpm-tts/python/worker.py` — `main()` responded **only on error paths**, so
every valid `health`/`render` returned nothing, `src/voxcpm-client.ts`'s `pending` map never
resolved, and the invocation died on its deadline (`Plugin entry 'voxcpm-tts' failed (exit code 1):
… worker startup timed out after 60000ms`; a 10-minute hang at the default 600 000 ms). The model
itself loaded fine (snapshot `32279effe8…`, `sample_rate=48000`, MPS).

Operator authorization lifted the 0256/0257 ownership boundary on 2026-10-12, so this task now
delivers the fix:

| Change | file:line |
| --- | --- |
| `_respond(stdout, request.get("id"), payload)` on the success path, plus `continue` on both error branches so the loop always answers once per accepted request | `plugins/generations/voxcpm-tts/python/worker.py:338` |
| Regression tests: health success shape, render success shape, one-response-per-request ordering, error paths unchanged | `plugins/generations/voxcpm-tts/tests/test_worker.py:109` |

`uv run --project plugins/generations/voxcpm-tts --locked --group dev pytest tests/test_worker.py`
→ **12 passed** (was 9: the three success-path cases are new); `bun test plugins/generations/voxcpm-tts/tests`
→ 36 pass / 0 fail. The first real render through the entry then succeeded (65 s, exit 0, WAV + MP3 + Content).

## 4. Short-sample matrix (4 renders, complete)

Exact commands (identical inputs per pair, isolated outputs, no publication):

```bash
VOICE_GEN_MP3=true VOICEBOX_MAX_VERIFY_ATTEMPTS=0 <bound> \
  bun apps/cli/src/index.ts executor run <voxcpm-tts|gemini-tts> \
    --in .spur/run/0258-voxcpm-comparison/fixtures/<fixture>.docs.json \
    --out .spur/run/0258-voxcpm-comparison/out/<fixture>.<driver>.content.json \
    --plugins-root "$PWD/plugins"
```

| Driver | Fixture | Wall | Speech duration | Rate | `metadata.generator` | QC |
| --- | --- | --- | --- | --- | --- | --- |
| VoxCPM (`voxcpm-tts`) | zh | 65 s | 11.86 s | 48 000 Hz mono | `kk:voxcpm-tts` | passed, 100 |
| VoxCPM | mixed | 60 s | 12.82 s | 48 000 Hz mono | `kk:voxcpm-tts` | passed, 100 |
| Gemini (`gemini-tts`) | zh | 15 s | 13.06 s | 24 000 Hz mono | `kk:gemini-tts` | passed, 100 |
| Gemini | mixed | 18 s | 15.26 s | 24 000 Hz mono | `kk:gemini-tts` | passed, 100 |

Per-segment durations (zh): VoxCPM 4.32 s + 7.04 s; Gemini 5.12 s + 7.44 s. Each driver's seed/probe
semantics differ as frozen: VoxCPM applies `torch.manual_seed(42)`; the current Gemini request
forwards no seed. Both short renders observed zero verify retries (`verifyRetries: 0`) and no quota
fallback for the two Gemini samples (their artifacts are `kk:gemini-tts`).

## 5. Full-episode matrix (4 cells, 3 valid)

Each cell: `kk stage daily-generate <root> 20261010 <abs-plugins-root> true <driver>` followed by
`kk stage daily-intro <root> 20261010 <intro>` and `kk stage daily-episode-duration <root> 20261010 15 20`.
The sequential shape appends `1 20` (section concurrency 1, episode budget 20 min).

| Cell | Wall | Speech | Final (+8.8 s intro) | Rate | `metadata.generator` | QC |
| --- | --- | --- | --- | --- | --- | --- |
| VoxCPM · whole-document | 50m51s | 966.11 s | 974.93 s (16.2 min) ✓ | 48 kHz mono | `kk:voxcpm-tts` (all 41 segs) | passed, score 100 |
| VoxCPM · sequential (9 sections) | 46m39s | 947.24 s | 956.05 s (15.9 min) ✓ | 48 kHz mono | `kk:voxcpm-tts` (all 41 segs) | passed, score 100 |
| Gemini · whole-document | 12m00s | 994.60 s | 1003.42 s (16.7 min) ✓ | 24 kHz mono | `kk:gemini-tts` (all 41 segs) | passed, score 100 |
| Gemini · sequential | **blocked** | 963.50 s | 972.31 s (16.2 min) | 24 kHz mono | **`kk:voice-gen`** — Voicebox fallback | **failed, score 50** |

`episode-duration`: `ok: 16.2 / 15.9 / 16.7 / 16.2 min within 15–20 min` — the configured intro sting
was merged on all four roots (hashed before any render).

### 5.1 The blocked cell — Gemini · sequential (blocker, not Gemini evidence)

- **Quota.** The primary key hit the hard daily cap during that cell:
  `HTTP 429 quota/reset horizon too far out (retry-after 81942s ≈ 22.8h): Rate limit exceeded for
  model gemini-3.8-flash-tts (limit: 100 requests per day on Tier 1)`. The two short renders (4
  requests) + the whole-episode render (41) + probes had consumed the allowance. Reset horizon:
  ~2026-10-13 16:55 UTC.
- **Operator-authorized alternate key did not clear it.** With the alternate key from
  `~/.config/kk/config.yaml` active for bounded attempts (fingerprints, not keys:
  primary `c09f72e1bbe98f72…`, alternate `455c0f601ee76905…` — **different keys, same limit**), the
  cell still produced no Gemini output. The config was restored byte-identically after every attempt
  (`logs/kk-config.yaml.before-0258-key-swap`); provenance is in `logs/key-provenance.txt`. Conclusion
  from the artifacts: the two keys share the same daily allowance (or the same project quota).
- **Fallback, not Gemini.** All 10 section sidecars and the final joined Content of that root carry
  `metadata.generator: kk:voice-gen` (the local Voicebox engine). Per R2 this is a **blocker**: the
  artifact is recorded as such and is **never** renamed or counted as a Gemini comparison.
- **The fallback is also a quality risk worth the operator's attention.** That root's final content
  failed QC (score 50) with transcription-fidelity 0.00 garbage in 3 of 9 sections
  (`01-item` segment 3, `03-item` segment 1, `06-item`) — the repeated-character failure mode the
  shared QC exists to catch — yet `daily-episode-duration` reported `ok: 16.2 min within 15–20 min`
  and the workflow wrote the MP3. The duration gate checks length only: it does not read
  `qc.passed` or `metadata.generator`. Whether a later gate (`daily-publish-prep` / the publisher)
  catches a failed QC was **not tested** — that path is out of this task's scope, so this is a
  question for the driver's owner, not a verified publish escape. Not fixed here (the task forbids
  touching the workflow/driver policy); filed as a finding for 0257.
- **Cost of the detour:** five bounded attempts (~3h 50m wall) to establish that the block is
  external. Each attempt is preserved in `logs/gemini-full-sequential*.log`; the section cache holds
  the 10 fallback sections.

## 6. VoxCPM backend / environment (Step 0, measured)

| Item | Observed |
| --- | --- |
| Interpreter/project | `uv` 0.11.28, independent uv project `plugins/generations/voxcpm-tts`, Python 3.12, `.venv` 1.4 GB |
| `uv sync --locked --no-dev` | exit 0 (wheels cached) |
| Package | `voxcpm==2.0.3` (`METADATA` `Version: 2.0.3`); module exposes no `__version__` ⇒ provenance `unknown` via `getattr` |
| torch | `2.14.1` |
| Model | `openbmb/VoxCPM2`, HF cache 4.6 GB, snapshot revision `32279effe8c19989596f05d353d1447f51d9e915` |
| Device / dtype | `auto` ⇒ `mps`, `bfloat16 → float32` (library-adjusted) |
| Native sample rate | 48 000 Hz (`model.tts_model.sample_rate`) — never assumed to be the shared 24 kHz |
| Model load | 17–28 s per invocation, one load per invocation, reused across all 41 segments |
| Throughput | whole-document 41 segments in 50m51s (~74 s/segment on MPS, incl. join + QC + MP3); sequential 46m39s |
| Hardware | Apple M5, 32 GB, Metal 4 |

## 7. Quality evidence

**Listening: pending.** No playback path exists in this execution environment; no human listened to
any artifact. Pronunciation / completeness / timbre / prosody / pauses / artifacts are therefore
**not assessed** rather than asserted. ASR-dependent QC is reported unavailable by the shared
pipeline (transcription is omitted), so QC scores here are the loudness/duration/fidelity audits
only — not a listening substitute.

What the artifacts *do* support, mechanically:

- Both drivers produced structurally valid, playable, correctly-labelled Content for the same frozen
  text (short samples) and for the same 41-segment episode (whole-document shape).
- VoxCPM's native 48 kHz output flows through the existing 24 kHz-oriented join/intro/duration path
  without relabelling or a resampler, and both VoxCPM shapes pass QC (score 100) with all 41 segments
  present in the ordered timeline.
- The VoxCPM renders are ~3–4× slower than Gemini on this hardware (≈51 min vs 12 min for the same
  episode), and VoxCPM's whole-document and sequential shapes cost about the same.
- No quality ranking between the two voices is claimed — that needs listening.

## 8. Verdict and recommendation

| Question (G14) | Answer from this evidence |
| --- | --- |
| Does VoxCPM work as a daily driver? | **Yes on this hardware** — after the §3 fix, both stage shapes render the frozen episode within the 15–20 min contract at 48 kHz with QC score 100 and `kk:voxcpm-tts` provenance. |
| Is VoxCPM better / comparable / worse than Gemini? | **Inconclusive** — 3 of 4 full-episode cells have real, verified provenance (both VoxCPM shapes vs Gemini whole-document); the Gemini sequential cell is quota-blocked and its only artifact is a Voicebox fallback with failing QC. No listening evidence exists for either driver. |
| Cost / operating profile | VoxCPM: local, free per render, ~51 min/episode on M5 MPS, 48 kHz native. Gemini: hosted, ~12 min/episode, 24 kHz native, 100 requests/day on Tier 1 — the daily cap is the binding operational constraint (one 41-segment episode = 41 requests). |
| Default-driver recommendation | **Recommend keeping the current default** and treating VoxCPM as an opt-in (`vdriver: voxcpm`). Changing the default, calibrating the duration estimate, or persisting a service needs separate authorization (no source/default edit in this task). |

**Finding worth a follow-up (not filed as a task here):** a Gemini quota failure falls back to the
local Voicebox engine (the driver's documented policy), and that path can emit a QC-failing episode
which still clears `daily-episode-duration` and gets an MP3 — the duration gate does not read
`qc.passed` or `metadata.generator`. Whether a later gate stops a QC-failing episode was not tested
(publish-prep/publisher are out of scope here). Either the duration gate should also assert
`qc.passed` + the expected `metadata.generator`, or the fallback should be surfaced as a hard stop
for `vdriver=gemini`. Recorded for the driver's owner (task 0257 scope).

**Resume path for the blocked cell (one command, after the quota resets):**

```bash
# stale voice-gen sections are rejected by the driver-aware cache gate, so this re-renders the
# whole cell through Gemini, then re-joins, re-applies the intro and re-checks the duration
kk stage daily-generate .spur/run/0258-voxcpm-comparison/work-roots/gemini-sequential 20261010 "$PWD/plugins" true gemini 1 20
kk stage daily-intro            .spur/run/0258-voxcpm-comparison/work-roots/gemini-sequential 20261010 .works/kk-daily-ai-voice/AI每日资讯_8秒播客片头.mp3
kk stage daily-episode-duration .spur/run/0258-voxcpm-comparison/work-roots/gemini-sequential 20261010 15 20
```

## 9. Reproduction

```bash
uv sync --locked --no-dev --project plugins/generations/voxcpm-tts
uv run --project plugins/generations/voxcpm-tts --locked --group dev pytest plugins/generations/voxcpm-tts/tests/test_worker.py
bash -c '<short render commands from §4>'      # both drivers × both fixtures
bash -c '<full render commands from §5>'       # both drivers × both shapes, then intro + duration
ffprobe -v error -show_entries stream=sample_rate,channels,duration -of default=noprint_wrappers=1 <wav>
```

## 10. Limits of this evidence

- No listening; no ASR; QC scores are mechanical audits only.
- The Gemini · sequential cell has no Gemini artifact (quota-blocked; Voicebox fallback recorded).
- Single machine, single run per cell: timings are observations, not benchmarks; no seed-equivalence
  between the drivers is claimed (Gemini forwards no seed).
- Only allowlisted configuration is recorded; no environment or secret dumps (key fingerprints only).
- No production default, calibration, profile or config was changed; the one config swap for the
  authorized key probe was restored byte-identically.
