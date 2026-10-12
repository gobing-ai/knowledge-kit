# VoxCPM daily voice driver

Status: accepted design, not implemented. Feature G14; ADR-036; refined 2026-10-11.
Implementation specifications: tasks 0256 → 0257 → 0258. Their Design, Requirements and Plan
sections freeze the detailed contracts; the refinement report is
[2026-10-11-g14-ready-refinement.md](../plans/2026-10-11-g14-ready-refinement.md).

## Outcome and boundaries

Both daily workflows accept `vdriver=voxcpm` through `dailyGenerate`. Keep Gemini defaults,
existing fallback policy, stage arguments and downstream intro/publish-preparation contracts.
Audio quality remains an empirical question. No automatic publication, training, daemon, HTTP
service, new benchmark framework or default change belongs to this feature.

`vendors/VoxCPM` is reference-only. No product import, subprocess, dependency, PYTHONPATH,
model/cache/profile/reference path, symlink, fallback, copied upstream module, build input or
packaging source may access `vendors/`. Validate configured paths canonically before access,
including external cache settings. Independent installed dependencies/caches live outside that
tree. Test without moving or deleting the user's reference checkout.

## Standalone generator — task 0256

Add `plugins/generations/voxcpm-tts` with manifest, workspace package, TypeScript entry/client,
private Python worker, uv project/lock, profiles, tests and README. Follow Gemini's injection
into `processGeneratorIO` with identity `kk:voxcpm-tts`. Import existing
`@gobing-ai/voice-gen` exports; client types/helpers are already exported. Reuse shared
VoiceScript segmentation, gaps, speed, retry, WAV concatenation, MP3 and QC handling.

The entry owns a lazy invocation-scoped client and closes it in `finally`. Start the worker
only after shared input validation; preserve empty-input behavior. Resolve worker/project/assets
from the plugin installation root for both source and bundled `dist` entries. Spawn argv arrays
without a shell. A sequential integer-id NDJSON protocol carries health/render requests and
validated response ids, owned WAV paths, duration/provenance or errors. Validate framing, paths,
finite nonempty mono waveform and positive actual `tts_model.sample_rate`. Write PCM16 at that
rate; do not label 48kHz data as 24kHz. Redirect all library stdout to stderr. At most one model
loads per invocation; no cross-invocation service.

Daily commands currently use the synchronous executor path; its async process-tree cleanup is
not a guarantee for these callers. The plugin owns startup/request/run deadlines, SIGTERM/SIGINT
handling, process-group teardown and reaping. Use existing `VOICEBOX_TIMEOUT_MS` (default 600000)
for startup and `waitUntilDone`'s supplied render deadline; a positive `VOICE_GEN_MAX_RUN_MS`
also bounds the whole invocation. Close stdin, TERM owned children, wait at most two seconds,
then force termination/reap before removing scratch. Do not change the executor seam owned by
other work. SIGKILL of the entire host is outside the cleanup guarantee.

## Backend and controls

Pin independently published `voxcpm==2.0.3` in uv with Python 3.12. Step 0 of implementation
must verify the locked installation/import/API; source inspection does not prove hardware/model
viability. Use `from_pretrained` with `load_denoiser=False,optimize=False`. Record package version
and resolved model snapshot revision, or explicitly unknown provenance.

Frozen environment: `VOXCPM_MODEL=openbmb/VoxCPM2`, `VOXCPM_DEVICE=auto` (auto/cpu/cuda/mps),
`VOXCPM_PROFILES_PATH=<plugin-root>/profiles.json`. The registry is a `profiles` array with unique
ids/names. Ship `robin-news` as an instruct profile. Reference mode uses `reference_wav_path`;
continuation requires paired `prompt_wav_path`/`prompt_text`. Relative assets resolve against the
registry directory. Reject mixed/unsupported modes, missing assets and OmniVoice serialized prompts.
The shared pipeline resolves profile precedence; the adapter resolves the resulting name/id.

For instruct profiles, map per-request instruction or the profile instruction to VoxCPM2's
parenthesized text prefix, preserving the spoken transcript used for QC. The published 2.0.3
API has neither a native `instruct` nor `seed` keyword: explicit seed calls
`torch.manual_seed` before generation. Null seed leaves backend RNG unchanged; no cross-device
bit-identical promise. Normalize maps directly; language uses automatic multilingual inference
with a diagnostic. Shared max-chunk/crossfade controls are advisory with one warning per
invocation; do not add a chunk engine. Reject nonempty engine, personality=true and active
effects. Speed remains shared postprocessing. Omit optional transcription initially and report
ASR-dependent QC unavailable; QC passing is not listener-quality evidence.

The published wheel was read without installing or executing it. Release source:
[PyPI 2.0.3](https://pypi.org/project/voxcpm/2.0.3/),
[official release README](https://github.com/OpenBMB/VoxCPM/blob/19b6bf7590025418821a86dcb817504e0ad7e5df/README.md).
Wheel SHA256: `24da58a30d094a9e9a7ead450ae9cffda0d31eaeba620b61ad99179dd87e486b`.
The downloaded reference checkout differs from this release; never use it as a runtime fallback.

## Workflow and artifacts — task 0257

Add `voxcpm: 'voxcpm-tts'` once to the shared alias map. Document opt-in usage in both workflow
YAMLs/operator docs without new workflow-only options. Exercise voice1 whole-document rendering
and voice2 sequential opening/items/closing rendering.

Whole-document cache reuse requires matching requested generator, passing QC, present WAV and
present requested MP3. Return a matching cache before Gemini probing. On a Gemini cache miss,
preserve its existing probe/fallback policy, then check the resolved Voicebox cache before
rendering. VoxCPM never probes Gemini or silently falls back. Foreign/legacy/invalid metadata
regenerates; never relabel foreign audio.

Keep voice2's text/profile/driver section hashes and completed valid sections after failure.
Check matching section provenance/QC/WAV before reuse. Join only after all sections succeed,
using current ordering/gaps and existing ffmpeg normalization at the first section's actual rate.
Rebuild a complete Content envelope and current generator/audioPath/duration/QC rather than
spreading old final metadata. Aggregate section QC conservatively: all must pass; minimum score
when all sections supply one; labelled critical issues; unavailable ASR stays unavailable.

A concurrent change supplies ensurePublishMp3 for missing output; reuse that helper and its
MP3 truthiness convention. Clear stale mp3Path before calling it on a fresh join, forcing
regeneration of the requested MP3; otherwise omit old mp3Path.
Reset old introMerged on a fresh join so intro processing updates the correct MP3 exactly once.
Failed join/transcode cannot leave a final Content claiming success. Preserve downstream publish
preparation's MP3 contract. Model/profile/settings comparisons use separate work directories;
no general cache redesign. VoxCPM's 5.6 characters/second estimate remains provisional; final
measured duration is authoritative and refusals/overruns remain visible.

## Verification and evidence — tasks 0256–0258

Model-free tests exercise actual NDJSON framing with private fake inference, Content/WAV/MP3/QC,
invalid controls/paths/waveforms, stale output and owned worker descendants through the direct
entry and synchronous executor. Distribution smoke stages bundled assets outside the checkout;
mocking the adapter alone cannot verify installation-root resolution. No unit model downloads.
Stage shims verify routing/cache/resume; real ffmpeg fixtures verify 48kHz join/gaps/intro/MP3.
Implementation runs lint, full tests, build and Spur rules, and updates `docs/04_DESIGN.md` with
the surface in the same change.

Task 0258 freezes Chinese/mixed-language fixture texts and settings. Four short direct-plugin
renders precede four full-episode renders: two drivers × two stage forms, each in isolated scratch
roots using the same hashed existing script/plan/Doc inputs. Render-related commands only; no
collection or publication. Verify actual generator identity on final and section artifacts:
Gemini fallback is incomplete Gemini evidence. Set finite run budgets before rendering and stop
affected expensive work after one diagnosed environment failure.

Record hashes, commands, package/model revision, effective voice/seed settings, hardware/device,
startup/section throughput, ffprobe duration/sample rate, QC limitations and artifact paths.
Allowlisted settings only, no secret/environment dumps. Listen before recording pronunciation,
completeness, timbre, prosody, pauses and artifact judgments; otherwise mark listening pending
and conclusion inconclusive. A report of failed inference is partial evidence, not full task
verification. Persist the dated comparison in `docs/plans/`; generated audio/models remain
untracked. Calibration/default adoption is a recommendation for later authorization, never an
automatic source edit in the evidence task.
