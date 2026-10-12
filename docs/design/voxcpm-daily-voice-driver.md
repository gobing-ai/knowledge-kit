# VoxCPM daily voice driver

Status: accepted design, not implemented. Feature G14; ADR-036; 2026-10-11.

## Outcome and boundaries

Both daily workflows accept `vdriver=voxcpm` through `dailyGenerate`. Keep Gemini defaults,
current fallback behavior, output paths, intro and publish preparation. No automatic publication
or default change is part of this experiment. Better quality is a question answered by evidence.

`vendors/VoxCPM` was inspected only to understand the upstream API. No product code may access
any part of `vendors/`: imports, subprocess paths, editable/path dependencies, PYTHONPATH,
model/reference defaults, symlinks, fallback lookup, build inputs and copied upstream modules are
excluded. Resolve configured filesystem paths canonically and refuse paths within that tree before
opening model or reference assets. Installed inference dependencies and model caches live outside
the repository's vendor tree. Do not move or delete the user's reference checkout for testing.

## Chosen seam

Add `plugins/generations/voxcpm-tts` with a generator manifest, workspace package, TypeScript entry,
client adapter, profiles, private Python worker, uv project/lock, tests and setup README. Follow
gemini-tts's `processGeneratorIO(..., client, ..., 'kk:voxcpm-tts')` use; do not fork the audio pipeline
or import Python code from omni-voice-gen. TypeScript imports use `@gobing-ai/voice-gen`.

The adapter implements `VoiceboxClient` locally: health starts and checks the worker; profile
resolution reads its own registry; generate requests synthesis; wait/download return the worker's
render result. Keep generated buffers/files scoped to the invocation and release them after use.
The worker loads at most one model and handles sequential requests over newline-delimited JSON
on stdin/stdout. Use an integer request id, render text/profile settings, and a response containing
the same id, WAV location/duration or an error. Validate protocol messages and returned paths;
all model/library logs go to stderr, never the protocol stream. Temporary WAV paths must stay in
the invocation-owned scratch directory. Reuse the existing WAV decoder/concatenation contract;
write PCM16 mono at the model's actual reported sample rate, never label 48 kHz data as 24 kHz.

Invoke the worker with argument arrays through Bun, no shell interpolation. Resolve worker and
uv project from the plugin installation root, supporting both source entry and bundled `dist`
entry. Bound startup and request waits using the existing voice generation deadline conventions;
on success, exception, timeout or cancellation close stdin, terminate and reap owned children,
then remove invocation-owned temporary files. The existing executor remains cancellation owner;
test descendant cleanup through its established process-tree seam.

An isolated private Python worker is preferred to a copied Python audio pipeline (duplicate QC)
or an HTTP service (deployment and service lifecycle). Per-invocation startup remains deliberate;
measure voice2 overhead before proposing a cross-invocation daemon.

## Backend and profiles

Use a pinned published VoxCPM distribution and uv lock; never install from the vendor checkout.
The downloaded reference exposes `VoxCPM.from_pretrained(..., device=..., load_denoiser=False)`
and `generate`, with sample rate on `tts_model.sample_rate`. Intended initial model is
`openbmb/VoxCPM2`; implementation first verifies that the pinned installed package supports it.
Do not claim package-release parity from the downloaded source. Record the actual version and
model revision in generated provenance/comparison evidence. No extra Python runtime is needed
outside the existing uv toolchain; choose a supported interpreter for the pinned package.

Use an explicit `VOXCPM_MODEL`, `VOXCPM_DEVICE`, `VOXCPM_PROFILES_PATH` interface; document defaults
and validate values in the implementation's same-commit `docs/04_DESIGN.md` update. Use the existing
VoiceScript profile precedence. Supply a `robin-news` instruct profile matching the daily workflow's
profile name; support reference WAV plus transcript for continuation/cloning only when the installed
API supports that mode. The inspected VoxCPM2 API has no `instruct` keyword: its README specifies
a parenthesized description prefix in `text` for voice design/style. Map the profile instruction
to that supported form after verifying the pinned release, leaving the source transcript used
for comparison/QC unchanged. Continuation uses paired `prompt_wav_path`/`prompt_text`; reference
cloning uses `reference_wav_path`. Do not reuse OmniVoice serialized prompt files. Reject unknown profiles,
unsupported modes and absent reference assets. Use explicit seed where supported; do not silently
discard unsupported generation controls. Existing shared MP3, retry and run-budget settings keep
their meaning. Do not add a new configuration surface for every upstream inference parameter.

Transcription is optional on `VoiceboxClient`; initially omit it and report ASR-dependent QC as
unavailable, preserving existing non-ASR QC. Do not fabricate transcription or declare listener
quality from `qc.passed` alone. Verify malformed/nonfinite/empty waveforms before accepting output.

## Workflow and cache integration

Add `voxcpm: 'voxcpm-tts'` once in `dailyGenerate`'s existing alias map. Update both workflow
descriptions/comments and operator documentation, preserving defaults and stage argument lists.
Exercise voice1's whole-document path and voice2's sequential opening/items/closing path.

Voice1 currently reuses any QC-passing audio Content. Require a compatible generator identity and
existing audio artifacts before reusing it; unknown provenance triggers regeneration. Account for
the existing Gemini fallback: decide/cache against the actual resolved driver and never relabel
fallback speech as VoxCPM. Preserve the Gemini probe's existing policy. Voice2 already hashes text,
profile and resolved driver; extend tests for the new alias, changed driver, resume after a failed
section and matching reuse. Different model/settings comparisons use isolated work directories;
general cache redesign is outside this delivery.

Character-rate estimates for existing drivers are measured, whereas VoxCPM has no calibration.
Do not present the shared 5.6 characters/second heuristic as measured VoxCPM performance. Until
the comparison provides evidence, preserve the final measured duration check, document the estimate
as provisional, and record any refusal/overrun without manufacturing a passing 15–20 minute episode.

## Verification and comparison

Model-free Bun tests cover adapter protocol, actual-rate WAVs, profile validation, generator
Content/MP3/QC contracts, errors, timeouts, cleanup and both workflow paths. Python assertions/tests
use an injected fake model for the worker; live inference is separate. Distribution smoke runs the
staged package outside the checkout with the vendor tree unavailable, checking discovery, entry,
worker, lock and assets. Scan imports/manifests/config/build paths for vendor references, allowing
only reference documentation and the guard refusing vendor paths. Do not download models in unit
tests. Run repository lint, tests, build and relevant Spur rules in implementation.

Use the same fixed Chinese and mixed Chinese-English VoiceScript, punctuation and segment
boundaries for VoxCPM and Gemini in separate work directories; record differing voice mechanisms
honestly rather than claiming identical timbre. Render a representative existing daily episode
through both stage invocation shapes without collection or publication. Capture text hash, source
script path, package/model revision, profile, seed/settings, hardware/device, elapsed time, duration,
file locations and QC including missing ASR. Compare pronunciation (names/numbers/English), omitted
or repeated words, timbre consistency, prosody, pauses, clipping and noise. Record listener findings
only after listening; otherwise mark listening pending and the result inconclusive. Report better,
comparable, worse or inconclusive plus startup/throughput and the real duration measurement. If the
environment cannot run inference, preserve the exact blocker and command; this is incomplete live
evidence, never a passing quality claim. No comparison result automatically changes the default.

## Reach of implementation

- New plugin, workspace manifest/lock and backend lock; existing voice-gen exports only if a required type is not already exported.
- Shared `plugins/kk/scripts/daily-stages.ts`, both daily workflow YAMLs, workflow/stage tests and fake fixtures.
- Installed-plugin/bundle smoke tests and invocation cleanup tests at their existing seams.
- `docs/04_DESIGN.md`, plugin README, workflow operator docs and this design's calibration/evidence links.
- No edits to `vendors/`, scheduled production configuration, secrets or `.github/workflows/`.
