---
schema_version: 1
name: Add standalone VoxCPM generator using the shared voice pipeline
status: todo
template: feature-impl
created_at: 2026-10-12T00:07:13.357Z
updated_at: "2026-10-12T00:29:53.265Z"
feature_id: G14
priority: P2
estimate_hours: 8

---

## 0256. Add standalone VoxCPM generator using the shared voice pipeline

### Background

G14 needs a selectable local TTS backend without copying VoiceScript/QC/audio handling. Gemini injects a client at plugins/generations/gemini-tts/src/index.ts:29. The interface and required controls are in plugins/generations/voice-gen/src/voicebox-client.ts:1-50; index.ts:25 already exports them. scripts/bundle-plugins.ts copies private non-JS assets and bundles entries. Daily rendering currently uses synchronous executor invocation, so the adapter must own its worker lifecycle.

**Refine corrections (2026-10-11)**
- Reference checkout API parity → published voxcpm 2.0.3 wheel differs and has no generate(seed=...) → freeze that release and use torch.manual_seed before synthesis; installed import/model probe remains step 0.
- Possible missing shared exports → index.ts already exports client types/helpers → reuse exports without editing voice-gen unless a demonstrated shared defect requires it.
- Existing executor cancellation assumed sufficient → daily uses spawnPluginEntry/Bun.spawnSync, not the async process-tree seam → plugin owns deadlines, signal handling and worker cleanup, tested through the synchronous path.
- Generic controls/profile mapping → shared pipeline supplies chunk/crossfade/normalize/seed and applies speed afterward → freeze explicit mapping, advisory warnings and rejection policy in Design.
- Unspecified interpreter/registry/provenance → package source is verified but execution is untested → freeze Python 3.12, package 2.0.3, profile schema and revision reporting; no claims of runtime viability.

### Requirements

- [ ] R1. Add discoverable voxcpm-tts injecting VoiceboxClient into existing processGeneratorIO with identity kk:voxcpm-tts; preserve valid Doc/plain text/VoiceScript, ordered gaps, actual-rate PCM16 WAV, duration, QC and optional MP3 contracts.
- [ ] R2. Ship an independently installed voxcpm==2.0.3 uv project/lock on Python 3.12 plus worker/profiles/assets that resolve from source and bundled installations outside the checkout; prohibit all canonicalized vendor paths.
- [ ] R3. Validate inputs, profiles, controls, NDJSON and finite mono waveforms/positive sample rates; reject unsupported/missing assets and stale-success output. Preserve empty-input behavior and optional-ASR limitations.
- [ ] R4. Keep at most one model per invocation with sequential bounded requests; protocol stdout stays clean; success, exceptions, startup/request/run timeouts and SIGTERM/SIGINT close, terminate and reap owned workers before bounded scratch cleanup.
- [ ] R5. Supply model-free real-framing worker/client/Content/distribution tests and setup/surface documentation. Live inference and audio quality evidence belong to 0258.

### Acceptance Criteria

- [ ] AC1 — VoxCPM produces compatible audio Content (req: R1, R5)
  Given valid plain text and multi-segment VoiceScript fixtures, when the real entry runs with a fake inference worker, then ContentSchema, kk:voxcpm-tts provenance, native-rate WAV, gaps, speed, QC and requested MP3 are verified in voxcpm-tts/tests/voxcpm-tts.test.ts.
- [ ] AC2 — VoxCPM runs without the vendor checkout (req: R2, R5)
  Given staged bundled assets outside the repository, when discovery and entry rendering use a fake model via real worker framing, then package tests resolve the worker/lock/profile correctly and all configured vendor/symlink paths fail. Extend scripts/bundle-plugins.test.ts and apps/cli/tests/package.test.ts rather than only mocking adapter resolution.
- [ ] AC3 — VoxCPM rejects invalid inputs and unsupported profiles (req: R3, R5)
  Given malformed Docs, profiles, paths, protocol or waveforms, when entry/client/worker validation runs, then it fails actionably without successful stale output; existing empty Doc[] behavior starts no worker. Cover in voxcpm-tts/tests/voxcpm-client.test.ts, voxcpm-tts.test.ts and private Python worker tests.
- [ ] AC4 — VoxCPM worker execution is bounded and cleaned up (req: R4, R5)
  Given hung startup/synthesis, worker errors or SIGTERM/SIGINT, when the real plugin entry runs directly and through the existing synchronous executor with a fake worker spawning a child, then owned descendants exit, requests settle and no protocol logs leak. Also assert one model load across multiple requests. SIGKILL of the entire host is outside the cleanup guarantee.

### Q&A

- CLOSED: ADR-036 chooses a private uv worker behind the existing TS client contract; existing shared exports are sufficient.
- CLOSED: Published 2.0.3 is the release target, Python 3.12 the interpreter; installed compatibility is a step-0 precondition, not a verified runtime claim. No vendor fallback.
- CLOSED: Unsupported controls fail explicitly except unavoidable shared chunk/crossfade and auto-language controls, whose advisory semantics are documented. Seed uses PyTorch, speed uses shared postprocessing.
- CLOSED: Plugin owns normal-signal/deadline cleanup because the daily synchronous path lacks the async tree-kill seam; do not expand task 0248 ownership.
- DEFERRED with owner 0258: hardware viability, runtime cost and listener quality. Dependent 0257 owns selector/cache/join integration.

### Design

ADR-036 and docs/design/voxcpm-daily-voice-driver.md freeze this design. No default change, new daemon/service, copied Python audio pipeline, automatic publication, vendor dependency, unrelated refactor or .github/workflows edit. No product import, dependency, subprocess, build input, cache/model/profile/reference path (including symlinks) may access vendors/. Preserve operator metadata and concurrent changes. Implementation must update docs/04_DESIGN.md with the new surface in the same change; refinement does not implement that surface.

Own plugins/generations/voxcpm-tts/{plugin.json,package.json,tsconfig.json,src/index.ts,src/voxcpm-client.ts,python/worker.py,pyproject.toml,uv.lock,profiles.json,tests/,README.md}, workspace lock and packaging tests. Shared voice-gen exports are already sufficient. Entry creates an invocation-scoped adapter and closes it in finally; lazy health starts uv worker only after shared Doc validation. Resolve installation root for both src and dist; spawn argv arrays without shell. Tests inject dependencies privately, never a public fake-model environment switch.

Worker protocol: sequential integer-id NDJSON health/render requests; render carries text/profile/normalize/seed and invocation-owned destination. Responses echo id and either positive duration + WAV path + model/package provenance, or error. Reject malformed, oversized/unexpected/duplicate ids, escaping paths, nonfinite/empty/multichannel output; report actionable stderr. Capture library stdout during imports/model load/generation to stderr. Write PCM16 mono at tts_model.sample_rate; do not relabel data or add a resampler.

Frozen backend: voxcpm==2.0.3; uv Python 3.12; default VOXCPM_MODEL=openbmb/VoxCPM2, VOXCPM_DEVICE=auto (allow auto/cpu/cuda/mps, fail unavailable requested device), VOXCPM_PROFILES_PATH=<plugin-root>/profiles.json. Hub models use normal external cache; local model/cache/profile/reference paths must pass canonical vendor exclusion before use, including configured Hugging Face cache locations. No editable/path dependency or vendor fallback. from_pretrained uses load_denoiser=False,optimize=False; record package version and resolved voxcpm_model_path snapshot revision if available, otherwise explicitly unknown. Installed locked import and tiny inference are not yet proven; do not substitute the downloaded source if release installation fails.

Registry shape: {"profiles":[{"id":"robin-news","name":"robin-news","mode":"instruct","instruct":"清晰、自然、沉稳的中文新闻播报，语速适中。"}]}. Unique nonempty ids/names; mode instruct requires nonempty instruction; mode reference requires reference_wav_path; mode continuation requires prompt_wav_path and prompt_text together. Relative assets resolve against registry directory; reject serialized OmniVoice prompts and mixed mode fields. Shared segment/speaker/script/environment/Doc profile resolution remains authoritative; adapter resolves the selected name/id, never substitutes another voice. Explicit per-request instruct overrides profile instruction for instruct mode, reject it for reference modes. VoxCPM2 instruction becomes a parenthesized text prefix; source spoken transcript remains unchanged for QC.

Control policy: normalize maps directly; explicit seed calls torch.manual_seed(seed) before generate, never generate(seed=...). Null seed leaves backend RNG alone; do not promise bit-identical output across devices. language is automatic multilingual inference with an advisory diagnostic (no language keyword). max_chunk_chars and crossfade_ms are accepted advisory controls with one warning per invocation; shared VoiceScript segmentation remains the request boundary, no new chunk engine. Reject nonempty engine, personality=true and active effects_chain; accept absent/empty/inactive controls. Speed stays in existing shared postprocessing, no worker speed parameter. Keep default cfg_value/inference_timesteps; no new public knobs. Omit transcribe initially and preserve honest missing-ASR QC.

Lifecycle: use existing VOICEBOX_TIMEOUT_MS/default 600000 for startup; generate dispatches and returns an id promptly, with synthesis bounded by waitUntilDone's supplied deadline. If positive VOICE_GEN_MAX_RUN_MS is set, enforce it across the entire invocation including startup; zero/unset disables that extra cap. Reject malformed budgets. Own a worker process group, close stdin and send TERM on finally/signals/deadline; allow at most 2 seconds, then force termination and await/reap. Ensure child cleanup even if uv creates descendants. Do not alter executor ownership or rely on its async-only cancellation path. Preserve failed-output deletion from shared pipeline and remove invocation scratch after worker exit.

Handoff to 0257: stable kk:voxcpm-tts identity, valid Content envelope and native sample rate. Handoff to 0258: installed version/model snapshot and effective settings diagnostics without secrets. Unit tests use real NDJSON + private fake model, not model downloads. Budget: one implementation pass, targeted protocol/cleanup/distribution checks then repository lint/full tests/build/rules; retain failures under .spur/run/<run-id>/voxcpm/.

#### API/library claim sources and confidence

| Claim | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| 2.0.3 API lacks seed/instruct keyword; supports reference/continuation and device | https://pypi.org/project/voxcpm/2.0.3/ ; published wheel voxcpm/core.py | SHA256 24da58a30d094a9e9a7ead450ae9cffda0d31eaeba620b61ad99179dd87e486b; AST inspection saved in audit artifacts | HIGH for source signatures; runtime untested |
| VoxCPM2 instruction uses a text prefix | https://github.com/OpenBMB/VoxCPM/blob/19b6bf7590025418821a86dcb817504e0ad7e5df/README.md | Official release source checked; no vendor runtime import | HIGH for documented syntax; voice quality untested |
| Client controls, exports and sync invocation seam already exist | voice-gen/src/voicebox-client.ts:1; voice-gen/src/index.ts:25; apps/cli/src/invoke.ts:269 | Read current source and callers | HIGH |

### Plan

- [ ] R2/R3: Step 0 create independent uv project, pin Python/package/lock; run locked import and inspect installed signature, recording versions and native sample-rate access. Stop/report incompatible release; never use vendors as fallback.
- [ ] R1/R2: Add plugin manifest/entry and lazy client using existing exports; resolve source/bundled installation assets and owned scratch.
- [ ] R3: Add registry/control/path validation and real NDJSON worker; implement actual-rate waveform conversion, stdout isolation, seed policy and provenance.
- [ ] R4: Add bounded startup/render/run lifecycle and signal/finally process-group teardown; test actual fake-worker descendants through direct and synchronous-executor entry.
- [ ] R1/R3/R5: Test plain text, VoiceScript, gaps, speed, 48kHz output, QC/MP3, retries/errors, invalid controls/paths/protocol, stale output and empty-input laziness without live models.
- [ ] R2/R5: Stage bundled package outside checkout and render through real framing with fake inference; verify lock/worker/profiles ship and vendor paths/symlinks are refused without moving vendors.
- [ ] R5: Update README/docs/04_DESIGN.md; run lint/full tests/build/relevant Spur rules and retain logs. Leave live quality evaluation to 0258.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: docs/features/G14_voxcpm-voice-driver-for-both-daily-ai-voice-workflows.md; ADR-036: docs/00_ADR.md; frozen specification: docs/design/voxcpm-daily-voice-driver.md.
- Audit evidence: .spur/run/refine-g14-20261011/ (published wheel/API inspection, frozen task set, admission and order); durable summary: docs/plans/2026-10-11-g14-ready-refinement.md.
- Concurrency audit 2026-10-11: no wip tasks in main corpus; worktree knowledge-kit-run-0248-eaea19 exists for invocation/publish work. Do not re-own apps/cli/src/invoke.ts or its timeout implementation; refresh overlap before implementation. Unrelated workflow-board docs, task 0157 and rule-authoring changes belong to others. Final concurrency recheck also found uncommitted ensurePublishMp3 changes in daily-stages.ts and daily-generate-sections.test.ts; 0257 explicitly reuses that work. Do not revert it; refresh line anchors and helper state before implementation.
- Related tasks: 0257 consumes generator Content; 0258 records live evidence. No task dependencies for 0256.

### History
