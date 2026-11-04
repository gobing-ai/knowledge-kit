# VoxCPM daily voice driver

Status: shipped (G14; tasks 0256 → 0257 → 0258). Feature G14; ADR-036; refined 2026-10-11.
Implementation specifications: their Design, Requirements and Plan
sections freeze the detailed contracts; the refinement report is
[2026-10-11-g14-ready-recheck.md](../plans/2026-10-11-g14-ready-recheck.md).

## Outcome and boundaries

Both daily workflows accept `vdriver=voxcpm` through `dailyGenerate`. `kk-daily-ai-voice` keeps
its Gemini default and fallback policy; stage arguments and downstream intro/publish-preparation
contracts are unchanged by the driver choice.

> **2026-10-15 amendment (operator decision, `kk-daily-ai-voice2` only):** voxcpm is the standing
> default there, with a three-tier voice chain `voxcpm → gemini → omni` (nodes `generate`,
> `generate-fallback`, `generate-fallback2`; `onError: continue` on the first two, each gated on the
> pool count *and* on no valid upstream render already existing, `intro` depends on all three). The
> first production run rendered 12/12 sections locally in 47 min (2.2x realtime), joined to
> 21.76 min, and published to every channel with no fallback fired. VoxCPM's spoken rate measured
> 5.19 字/秒 (6,772 chars / 1,297.7 s) and the fit now uses 5.2 instead of the borrowed voicebox 5.6.
> `kk-daily-ai-voice` is untouched.

`vendors/VoxCPM` is reference-only. No product import, subprocess, dependency, PYTHONPATH,
model/cache/profile/reference path, symlink, fallback, copied upstream module, build input or
packaging source may access `vendors/`. Validate configured paths canonically before access,
including external cache settings. Independent installed dependencies/caches live outside that
tree. Test without moving or deleting the user's reference checkout.

## Standalone generator — task 0256

Add `plugins/generations/voxcpm-tts` with manifest, workspace package, TypeScript entry/client,
private Python worker, uv project/lock, profiles, tests and README. Update both complete plugin-name
enumerations in registry tests with the manifest. Follow Gemini's injection
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
loads per invocation; no cross-invocation service. `createVoxCpmClient` exposes the shared client plus
an asynchronous close operation. `generate` promptly returns a decimal request id; `waitUntilDone`
awaits its stored promise and `downloadAudio` copies only the owned result. Allow one in-flight
render, integer protocol ids starting at 1, at most 1 MiB per line and 64 KiB of retained stderr.
Malformed framing, wrong ids, EOF or escaped paths terminate the worker without restart, including
shared retries. Ordinary backend errors may retry the same healthy model.

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
and resolved model snapshot revision, or explicitly unknown provenance. Resolve and retain the
snapshot directory with the installed Hub API before calling `from_pretrained` on that local path;
the published instance does not expose the documented `voxcpm_model_path` attribute. Validate
canonical import, uv, Hub/cache and profile paths before spawning/loading, including symlinks.

Frozen environment: `VOXCPM_MODEL=openbmb/VoxCPM2`, `VOXCPM_DEVICE=auto` (auto/cpu/cuda/mps),
`VOXCPM_PROFILES_PATH=<plugin-root>/profiles.json`. The registry is a `profiles` array with unique
ids/names. Ship `robin-news` as an instruct placeholder — **and treat instruct as a placeholder only**:
it carries no reference audio, so there is no prompt cache and the model samples a speaker per
request, changing voice between segments (2026-10-15: 59 speakers, median within-item pitch swing
77 Hz; a fixed seed does not fix it). Multi-segment synthesis therefore needs a `reference` or
`continuation` profile, normally resolved from an operator-private registry via
`VOXCPM_PROFILES_PATH` in `plugins.generations.voxcpm-tts.env` (`~/.config/kk/voxcpm-profiles/
profiles.json` + a clip under `~/.config/kk/voices/`); the client warns once per invocation when an
instruct profile is used and the render fails on that profile's second segment. Since 2026-10-15 this
is the adopted default for `kk-daily-ai-voice2` (vdriver voxcpm + the operator's anchored clone,
chosen after listening to `.works/voice-ab-20261015/`). Reference mode uses `reference_wav_path`; continuation requires paired
`prompt_wav_path`/`prompt_text`. Relative assets resolve against the registry directory. Reject
mixed/unsupported modes, missing assets and OmniVoice serialized prompts. The shared pipeline
resolves profile precedence; the adapter resolves the resulting name/id. Grade a render with
`scripts/audit-speaker-consistency.py` (per-item F0 spread > 45 Hz = no speaker anchor).

The anchoring also changes the speaking rate, so re-check the fit after adopting a profile: on
identical text (5 segments, 491 chars, 2026-10-15) the reference-anchored clone needed 88.5 s
against the instruct draws' 97.0 s — 5.55 vs 5.06 字/秒, i.e. the clone mirrors its 28 s reference
clip's brisker pace. The 5.2 字/秒 fit rate therefore stays conservative for this profile, and a
full-budget script (7,134 chars) lands near 21.6 min against the 25-min gate.

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

Whole-document speech cache reuse requires matching requested generator, passing QC and a valid WAV.
Repair a missing requested MP3 from that cached speech before returning, without resynthesizing it. Return a matching cache before Gemini probing. On a Gemini cache miss,
preserve its existing probe/fallback policy, then check the resolved Voicebox cache before
rendering. VoxCPM never probes Gemini or silently falls back. Foreign/legacy/invalid metadata
regenerates; never relabel foreign audio.

Keep voice2's text/profile/driver section hashes and completed valid sections after failure.
Check matching section provenance/QC/WAV before reuse. Join only after all sections succeed,
using current ordering/gaps and existing ffmpeg normalization at the first section's actual rate.
Rebuild a complete Content envelope and current generator/audioPath/duration/QC rather than
spreading old final metadata. Preserve the ordered `metadata.segments` timeline. Final reuse also
requires `metadata.sectionHashes` to equal the current ordered section hashes, with matching
identity, valid Content/WAV and passing QC. Missing or stale fingerprints force a rejoin even if
all section caches hit; failed join followed by retry must never reuse an older final. Publish
final metadata only after successful join and requested transcode. Validate Content with its
existing schema and artifacts with the WAV parser/ffprobe.
Aggregate section QC conservatively using `overallScore` and `segmentAudits`: all must pass;
minimum overall score when all sections supply one; reindex audits, total durations and label
critical issues; unavailable ASR stays unavailable.

The committed ensurePublishMp3 supplies missing output repair; reuse that helper and its
MP3 truthiness convention. Clear stale mp3Path before calling it on a fresh join, forcing
regeneration of the requested MP3; otherwise omit old mp3Path.
Reset old introMerged on a fresh join so intro processing updates the correct MP3 exactly once.
Failed join/transcode cannot leave a final Content claiming success. Preserve downstream publish
preparation's MP3 contract. Model/profile/settings comparisons use separate work directories;
no general cache redesign. VoxCPM's spoken rate measured 5.19 字/秒 on the 2026-10-15 production
episode, and the fit uses 5.2; final
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
affected expensive work after one diagnosed environment failure. Direct plugin commands use the
supported `--plugins-root` option. Finish each full render with the same hashed existing intro via
`daily-intro <work> <date> <absolute-intro-file>`, then `daily-episode-duration <work> <date> 15 20`.
Record duration before and after intro; a missing intro yields partial evidence.

Record hashes, commands, package/model revision, effective voice/seed settings, hardware/device,
startup/section throughput, ffprobe duration/sample rate, QC limitations and artifact paths.
Eight scheduled renders are not a backend-request cap: account separately for shared transport
attempts, verification, Gemini HTTP retries, VoxCPM internal retries and quota probes. Seed is
explicitly effective only where supported; the current Gemini request does not forward it.
Record effective controls and sanitize unsupported ambient overrides without silently changing
script fields. Distinguish VoxCPM's hard invocation deadline from the shared/Gemini between-segment
budget; do not add a supervisor or change timeout code for this evidence task.
Allowlisted settings only, no secret/environment dumps. Listen before recording pronunciation,
completeness, timbre, prosody, pauses and artifact judgments; otherwise mark listening pending
and conclusion inconclusive. A report of failed inference is partial evidence, not full task
verification. Persist the dated comparison in `docs/plans/`; generated audio/models remain
untracked. Calibration/default adoption is a recommendation for later authorization, never an
automatic source edit in the evidence task.
#### API/library claim sources and confidence

| Claim | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| `voxcpm==2.0.3` exposes `from_pretrained(..., load_denoiser=, optimize=, device=)`, supports reference/continuation modes, and has no `seed=` keyword | https://pypi.org/project/voxcpm/2.0.3/ | Published wheel SHA256 `24da58a3…e486b` and AST inspection of `voxcpm/core.py` retained in the 0256 audit artifacts; the 2.0.3 constructor never assigns `voxcpm_model_path`, so the design resolves the snapshot explicitly | HIGH for the source signatures; runtime untested |
| VoxCPM2 applies an instruction as a parenthesized text prefix | https://github.com/OpenBMB/VoxCPM/blob/19b6bf7590025418821a86dcb817504e0ad7e5df/README.md | Official release source read at that commit; no vendor runtime import — voice quality unverified | HIGH for documented syntax; listening untested |
| The shared client contract the adapter implements already exists — `VoiceboxClient` plus `processGeneratorIO` and re-exports | plugins/generations/voice-gen/src/voicebox-client.ts:36 | Read the interface at that line and `processGeneratorIO` at plugins/generations/voice-gen/src/index.ts:41; no shared edit is needed | HIGH |
| The uv project is pinned to Python 3.12 and installed locked, never editable or path-installed | plugins/generations/voxcpm-tts/pyproject.toml:5 | The pin now ships: `requires-python = "==3.12.*"` at `:5` and `dependencies = ["voxcpm==2.0.3"]` at plugins/generations/voxcpm-tts/pyproject.toml:6 | HIGH for the pin itself; lock contents beyond the pin are not audited by this document |
| Hub model ids resolve through the installed Hub snapshot API before loading, with the returned directory retained as provenance | plugins/generations/voxcpm-tts/python/worker.py:195 | Call site ships at `:195` (`snapshot_download(repo_id=model_id)`); the upstream Hub response signature is not re-fetched here | MEDIUM — upstream Hub API not re-fetched for this document |
| Render budget semantics: `VOICE_GEN_MAX_RUN_MS` is checked between segments in the shared path, while the adapter's own deadline bounds the whole invocation | plugins/generations/voice-gen/src/index.ts:98 | Read current shared implementation | HIGH |
| Missing-MP3 repair is available from the committed helper rather than a second transcoder | plugins/kk/scripts/daily-stages.ts:539 | Read current source; helper is committed on the base ref | HIGH |
