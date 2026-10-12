---
schema_version: 1
name: Add standalone VoxCPM generator using the shared voice pipeline
status: done
template: feature-impl
created_at: 2026-10-12T00:07:13.357Z
updated_at: "2026-10-12T15:00:42.593Z"
feature_id: G14
priority: P2
estimate_hours: 8

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0256-verdict.json
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

**Refine corrections (2026-10-11, current-tree recheck)**
- Model revision assumed accessible through voxcpm_model_path → the hash-verified 2.0.3 core passes that constructor parameter but never assigns self.voxcpm_model_path → resolve the local snapshot explicitly before loading and record that owned path/revision; no reliance on the misleading return docstring.
- Health/render framing and client lifecycle names were underspecified → freeze a private invocation-scoped client factory, single in-flight request, finite framing bounds and terminal failure semantics compatible with shared automatic retries.
- New discoverable generator omitted hardcoded registry-list updates → both current registry test lists enumerate every built-in → add voxcpm-tts in this task with its scaffold, preserving packaging-test scope.
- Historical concurrent worker/MP3 edits were treated as still active → Current-tree recheck (2026-10-11, HEAD 701c598b): no WIP tasks; main has an unrelated task 0252 edit. The only other worktree is knowledge-kit-runall-g8-4173 (G8 board/workflow work), with package.json/bun.lock/CLI packaging edits; coordinate lockfile and packaging-test integration, preserve them. The prior 0248 worktree is gone. ensurePublishMp3 and joined segment metadata are already committed in main, not an uncommitted prerequisite.

### Requirements

- [x] R1. Add discoverable voxcpm-tts injecting VoiceboxClient into existing processGeneratorIO with identity kk:voxcpm-tts; preserve valid Doc/plain text/VoiceScript, ordered gaps, actual-rate PCM16 WAV, duration, QC and optional MP3 contracts.
- [x] R2. Ship an independently installed voxcpm==2.0.3 uv project/lock on Python 3.12 plus worker/profiles/assets that resolve from source and bundled installations outside the checkout; prohibit all canonicalized vendor paths.
- [x] R3. Validate inputs, profiles, controls, NDJSON and finite mono waveforms/positive sample rates; reject unsupported/missing assets and stale-success output. Preserve empty-input behavior and optional-ASR limitations.
- [x] R4. Keep at most one model per invocation with sequential bounded requests; protocol stdout stays clean; success, exceptions, startup/request/run timeouts and SIGTERM/SIGINT close, terminate and reap owned workers before bounded scratch cleanup.
- [x] R5. Supply model-free real-framing worker/client/Content/distribution tests and setup/surface documentation and both built-in registry enumerations with the manifest. Live inference and audio quality evidence belong to 0258.

### Acceptance Criteria

- [x] AC1 — VoxCPM produces compatible audio Content (req: R1, R5)
  Given valid plain text and multi-segment VoiceScript fixtures, when the real entry runs with a fake inference worker, then ContentSchema, kk:voxcpm-tts provenance, native-rate WAV, gaps, speed, QC and requested MP3 are verified in voxcpm-tts/tests/voxcpm-tts.test.ts.
- [x] AC2 — VoxCPM runs without the vendor checkout (req: R2, R5)
  Given staged bundled assets outside the repository, when discovery and entry rendering use a fake model via real worker framing, then package tests resolve the worker/lock/profile correctly and all configured vendor/symlink paths fail. Extend scripts/bundle-plugins.test.ts and apps/cli/tests/package.test.ts rather than only mocking adapter resolution.
- [x] AC3 — VoxCPM rejects invalid inputs and unsupported profiles (req: R3, R5)
  Given malformed Docs, profiles, paths, protocol or waveforms, when entry/client/worker validation runs, then it fails actionably without successful stale output; existing empty Doc[] behavior starts no worker. Cover in voxcpm-tts/tests/voxcpm-client.test.ts, voxcpm-tts.test.ts and private Python worker tests.
- [x] AC4 — VoxCPM worker execution is bounded and cleaned up (req: R4, R5)
  Given hung startup/synthesis, worker errors or SIGTERM/SIGINT, when the real plugin entry runs directly and through the existing synchronous executor with a fake worker spawning a child, then owned descendants exit, requests settle and no protocol logs leak. Also assert one model load across multiple requests. SIGKILL of the entire host is outside the cleanup guarantee.

### Q&A

- CLOSED: ADR-036 chooses a private uv worker behind the existing TS client contract; existing shared exports are sufficient.
- CLOSED: Published 2.0.3 is the release target, Python 3.12 the interpreter; installed compatibility is a step-0 precondition, not a verified runtime claim. No vendor fallback.
- CLOSED: Unsupported controls fail explicitly except unavoidable shared chunk/crossfade and auto-language controls, whose advisory semantics are documented. Seed uses PyTorch, speed uses shared postprocessing.
- CLOSED: Plugin owns normal-signal/deadline cleanup because the daily synchronous path lacks the async tree-kill seam; do not expand task 0248 ownership.
- DEFERRED with owner 0258: hardware viability, runtime cost and listener quality. Dependent 0257 owns selector/cache/join integration.

#### Q&A entry — 2026-10-12T04:46:28.115Z

- CLOSED on recheck: retain an explicitly resolved model snapshot path before loading; never read the nonexistent voxcpm_model_path instance field.
- CLOSED on recheck: private createVoxCpmClient/close lifecycle, integer-id mapping and bounded framing are frozen; fatal worker failures are terminal even under shared retries. No worker restart/new model in the same invocation.
- CLOSED on recheck: registry enumeration belongs with this task’s discoverable manifest.

### Design

ADR-036 and docs/design/voxcpm-daily-voice-driver.md freeze this design. No default change, new daemon/service, copied Python audio pipeline, automatic publication, vendor dependency, unrelated refactor or .github/workflows edit. No product import, dependency, subprocess, build input, cache/model/profile/reference path (including symlinks) may access vendors/. Preserve operator metadata and concurrent changes. Implementation must update docs/04_DESIGN.md with the new surface in the same change; refinement does not implement that surface.

Own plugins/generations/voxcpm-tts/{plugin.json,package.json,tsconfig.json,src/index.ts,src/voxcpm-client.ts,python/worker.py,pyproject.toml,uv.lock,profiles.json,tests/,README.md}, workspace lock, both built-in name lists in packages/kk-core/tests/registry.test.ts, and packaging tests. Shared voice-gen exports are already sufficient. Entry creates an invocation-scoped adapter and closes it in finally; lazy health starts uv worker only after shared Doc validation. Resolve installation root for both src and dist; spawn argv arrays without shell. Tests inject dependencies privately, never a public fake-model environment switch.

Worker protocol: sequential integer-id NDJSON health/render requests; render carries text/profile/normalize/seed and invocation-owned destination. Responses echo id and either positive duration + WAV path + model/package provenance, or error. Reject malformed, oversized/unexpected/duplicate ids, escaping paths, nonfinite/empty/multichannel output; report actionable stderr. Capture library stdout during imports/model load/generation to stderr. Write PCM16 mono at tts_model.sample_rate; do not relabel data or add a resampler.

Frozen backend: voxcpm==2.0.3; uv Python 3.12; default VOXCPM_MODEL=openbmb/VoxCPM2, VOXCPM_DEVICE=auto (allow auto/cpu/cuda/mps, fail unavailable requested device), VOXCPM_PROFILES_PATH=<plugin-root>/profiles.json. Hub models use normal external cache; local model/cache/profile/reference paths must pass canonical vendor exclusion before use, including configured Hugging Face cache locations. No editable/path dependency or vendor fallback. from_pretrained uses load_denoiser=False,optimize=False; record package version and the explicitly resolved local snapshot path/revision, or explicitly unknown for an unversioned local model. The 2.0.3 constructor does not assign a voxcpm_model_path instance attribute; do not infer provenance from that docstring. Installed locked import and tiny inference are not yet proven; do not substitute the downloaded source if release installation fails.

Registry shape: {"profiles":[{"id":"robin-news","name":"robin-news","mode":"instruct","instruct":"清晰、自然、沉稳的中文新闻播报，语速适中。"}]}. Unique nonempty ids/names; mode instruct requires nonempty instruction; mode reference requires reference_wav_path; mode continuation requires prompt_wav_path and prompt_text together. Relative assets resolve against registry directory; reject serialized OmniVoice prompts and mixed mode fields. Shared segment/speaker/script/environment/Doc profile resolution remains authoritative; adapter resolves the selected name/id, never substitutes another voice. Explicit per-request instruct overrides profile instruction for instruct mode, reject it for reference modes. VoxCPM2 instruction becomes a parenthesized text prefix; source spoken transcript remains unchanged for QC.

Control policy: normalize maps directly; explicit seed calls torch.manual_seed(seed) before generate, never generate(seed=...). Null seed leaves backend RNG alone; do not promise bit-identical output across devices. language is automatic multilingual inference with an advisory diagnostic (no language keyword). max_chunk_chars and crossfade_ms are accepted advisory controls with one warning per invocation; shared VoiceScript segmentation remains the request boundary, no new chunk engine. Reject nonempty engine, personality=true and active effects_chain; accept absent/empty/inactive controls. Speed stays in existing shared postprocessing, no worker speed parameter. Keep default cfg_value/inference_timesteps; no new public knobs. Omit transcribe initially and preserve honest missing-ASR QC.

Lifecycle: use existing VOICEBOX_TIMEOUT_MS/default 600000 for startup; generate dispatches and returns an id promptly, with synthesis bounded by waitUntilDone's supplied deadline. If positive VOICE_GEN_MAX_RUN_MS is set, enforce it across the entire invocation including startup; zero/unset disables that extra cap. Reject malformed budgets. Own a worker process group, close stdin and send TERM on finally/signals/deadline; allow at most 2 seconds, then force termination and await/reap. Ensure child cleanup even if uv creates descendants. Do not alter executor ownership or rely on its async-only cancellation path. Preserve failed-output deletion from shared pipeline and remove invocation scratch after worker exit.

Handoff to 0257: stable kk:voxcpm-tts identity, valid Content envelope and native sample rate. Handoff to 0258: installed version/model snapshot and effective settings diagnostics without secrets. Unit tests use real NDJSON + private fake model, not model downloads. Budget: one implementation pass, targeted protocol/cleanup/distribution checks then repository lint/full tests/build/rules; retain failures under .spur/run/<run-id>/voxcpm/.

#### API/library claim sources and confidence

| Claim | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| 2.0.3 API lacks seed/instruct keyword; supports reference/continuation and device | https://pypi.org/project/voxcpm/2.0.3/ ; published wheel voxcpm/core.py | SHA256 24da58a30d094a9e9a7ead450ae9cffda0d31eaeba620b61ad99179dd87e486b; AST inspection saved in audit artifacts | HIGH for source signatures; runtime untested |
| VoxCPM2 instruction uses a text prefix | https://github.com/OpenBMB/VoxCPM/blob/19b6bf7590025418821a86dcb817504e0ad7e5df/README.md | Official release source checked; no vendor runtime import | HIGH for documented syntax; voice quality untested |
| Client controls, exports and sync invocation seam already exist | plugins/generations/voice-gen/src/voicebox-client.ts:1; plugins/generations/voice-gen/src/index.ts:25; apps/cli/src/invoke.ts:269 | Read current source and callers | HIGH |

#### Frozen private adapter details

- `createVoxCpmClient()` in `src/voxcpm-client.ts` returns an invocation-owned `VoiceboxClient` plus `close(): Promise<void>`; no new voice-gen API or public fake-model switch. `generate` sends one render request, returns `{id: String(integerRequestId)}` promptly and stores its response promise; `waitUntilDone` awaits that same promise under its supplied deadline; `downloadAudio` reads only the exact validated invocation-owned destination. `health` loads at most one model and repeated health never reloads. Refuse a second render while one is pending. A crashed/timed-out/closed worker makes the client terminal: all pending/current/subsequent calls fail without restarting a model, including shared pipeline retries. Ordinary backend render errors may be retried on the same healthy model by the existing shared policy.
- NDJSON is UTF-8, one object per newline, integer ids from 1. Bound each request/response line to 1 MiB and retain at most 64 KiB of diagnostic stderr. Unknown/duplicate ids, EOF mid-frame, invalid JSON, oversized frames or mismatched destination paths terminate the worker and reject pending requests. WAV paths must equal the requested path under invocation scratch after canonicalization; successful duration is derived from validated samples/rate, not trusted from unvalidated JSON. Tests cover both healthy reuse and terminal retry without a second model load.
- Resolve Hub ids with the installed `huggingface_hub.snapshot_download`, retain its returned directory, check canonical model directory and symlink targets against vendor exclusion, then call `VoxCPM.from_pretrained` on that validated local directory (`load_denoiser=False,optimize=False,device=...`). Existing local paths undergo the same checks. Record a snapshot directory revision when observable; local unversioned directories are `unknown`. Check configured Python/project/cache/import paths (including PYTHONPATH, UV_PROJECT_ENVIRONMENT, UV_CACHE_DIR and Hugging Face cache tiers) before spawning/loading; no dependency or cache symlink may route into vendors. Do not read model objects or reference assets first and validate afterward. The independent uv project is invoked locked, never editable/path-installed from vendors.
- Add both registry-test names when the manifest lands, not later with workflow wiring. Source/bundled installation-root, NDJSON and process-tree tests remain in this task; tests import no live model and do not mutate vendors.
- Current-tree recheck (2026-10-11, HEAD 701c598b): no WIP tasks; main has an unrelated task 0252 edit. The only other worktree is knowledge-kit-runall-g8-4173 (G8 board/workflow work), with package.json/bun.lock/CLI packaging edits; coordinate lockfile and packaging-test integration, preserve them. The prior 0248 worktree is gone. ensurePublishMp3 and joined segment metadata are already committed in main, not an uncommitted prerequisite.

### Plan

- [x] R2/R3: Step 0 create independent uv project, pin Python/package/lock; run locked import and inspect installed signature, recording versions and native sample-rate access. Stop/report incompatible release; never use vendors as fallback.
- [x] R1/R2: Add plugin manifest/entry and lazy client using existing exports; resolve source/bundled installation assets and owned scratch.
- [x] R3: Add registry/control/path validation and real NDJSON worker; implement actual-rate waveform conversion, stdout isolation, seed policy and provenance.
- [x] R4: Add bounded startup/render/run lifecycle and signal/finally process-group teardown; test actual fake-worker descendants through direct and synchronous-executor entry.
- [x] R1/R3/R5: Test plain text, VoiceScript, gaps, speed, 48kHz output, QC/MP3, retries/errors, invalid controls/paths/protocol, stale output and empty-input laziness without live models.
- [x] R2/R5: Stage bundled package outside checkout and render through real framing with fake inference; verify lock/worker/profiles ship and vendor paths/symlinks are refused without moving vendors.
- [x] R5: Update README/docs/04_DESIGN.md; run lint/full tests/build/relevant Spur rules and retain logs. Leave live quality evaluation to 0258.

- [x] R2/R3/R5: Update both registry enumerations with the manifest; prove explicitly resolved model provenance without the nonexistent instance attribute using a private fake Hub/model seam. Test vendor symlink/cache/import-path refusals and framing size/EOF/id bounds. Test a timed-out/failed worker followed by the shared retry: no restart or second model instance.

### Solution

Standalone `voxcpm-tts` generator (ADR-036): a TypeScript adapter over the shared voice-gen
`VoiceboxClient` contract, backed by a private uv Python worker. Change map (one anchor per row;
each names its requirement's subject):

| Req | Anchor | Change |
| --- | --- | --- |
| R1 | `plugins/generations/voxcpm-tts/plugin.json:1` | Discoverable `kind: generator` manifest (`voxcpm-tts`, entry `./src/index.ts` → bundled `./dist/index.js`) |
| R1 | `plugins/generations/voxcpm-tts/src/index.ts:14` | `main(--in/--out)` injects the invocation-scoped adapter into `processGeneratorIO` as `kk:voxcpm-tts` (`:30`) and closes it in `finally`; lazy — no worker before shared Doc validation |
| R1 | `plugins/generations/voxcpm-tts/src/voxcpm-client.ts:259` | `createVoxCpmClient` implements the shared client (health/resolveProfile/generate/waitUntilDone/downloadAudio); `transcribe` omitted so ASR-dependent QC is honestly unavailable |
| R1/R3 | `plugins/generations/voxcpm-tts/src/index.ts:3` | Reuses voice-gen exports (VoiceScript segmentation, gaps, speed, concat, QC, MP3) — no second pipeline |
| R2 | `plugins/generations/voxcpm-tts/pyproject.toml:1` | Independent uv project pinning `voxcpm==2.0.3` on `requires-python ==3.12.*` |
| R2 | `plugins/generations/voxcpm-tts/uv.lock:1` | Locked resolution (voxcpm 2.0.3 + 172 packages) the worker runs `--locked` against |
| R2 | `plugins/generations/voxcpm-tts/src/voxcpm-client.ts:206` | `resolveVoxCpmWorkerCommand` spawns `uv run --project <root> --locked --no-dev python python/worker.py` (argv array, no shell) |
| R2 | `plugins/generations/voxcpm-tts/src/voxcpm-client.ts:91` | `assertNoVendorPath` canonical vendor exclusion (incl. symlinks) on every configured path |
| R2 | `plugins/generations/voxcpm-tts/python/worker.py:176` | `load_backend` explicitly resolves/retains the snapshot dir before `from_pretrained` (never the nonexistent `voxcpm_model_path`), records package/revision provenance |
| R2 | `plugins/generations/voxcpm-tts/profiles.json:1` | Frozen `profiles` registry with the shipped `robin-news` instruct profile |
| R3 | `plugins/generations/voxcpm-tts/src/voxcpm-client.ts:134` | `parseVoxCpmRegistry` validates unique ids/names, per-mode required fields, relative assets, vendor exclusion, serialized-prompt/mixed-mode rejection |
| R3 | `plugins/generations/voxcpm-tts/src/voxcpm-client.ts:485` | `policyCheck` rejects nonempty engine / `personality=true` / active effects, maps instruct override vs reference modes |
| R3 | `plugins/generations/voxcpm-tts/src/voxcpm-client.ts:512` | `warnAdvisory` emits one chunk/crossfade and one language diagnostic per invocation |
| R3 | `plugins/generations/voxcpm-tts/src/voxcpm-client.ts:227` | `readWavFile` validates finite/positive-rate mono 16-bit nonempty worker WAV; duration derived from validated samples/rate |
| R3 | `plugins/generations/voxcpm-tts/python/worker.py:75` | `parse_registry` worker-side validation mirror; `:148` `write_pcm16_wav` guards mono/positive rate |
| R4 | `plugins/generations/voxcpm-tts/src/voxcpm-client.ts:337` | `startWorker` spawns a detached process group, one in-flight render, bounded 1 MiB frames / 64 KiB stderr |
| R4 | `plugins/generations/voxcpm-tts/src/voxcpm-client.ts:284` | `fail` makes the client terminal (no restart/second model) on malformed framing, bad ids, EOF or deadline |
| R4 | `plugins/generations/voxcpm-tts/src/voxcpm-client.ts:404` | `terminateChild` closes stdin, TERMs the group, SIGKILLs after 2s, then awaits/reaps until the whole owned group is gone; `close()` awaits it on finally/SIGTERM/SIGINT |
| R4 | `plugins/generations/voxcpm-tts/python/worker.py:304` | `main` NDJSON loop; library stdout redirected to stderr, one model load per process |
| R5 | `plugins/generations/voxcpm-tts/tests/fake-worker.ts:1` | Real-framing NDJSON fake inference worker (no downloads) with error/cleanup scenarios |
| R5 | `plugins/generations/voxcpm-tts/tests/voxcpm-client.test.ts:60` | Registry/vendor/control/protocol/lifecycle unit tests |
| R5 | `plugins/generations/voxcpm-tts/tests/voxcpm-tts.test.ts:102` | Entry tests: plain text/VoiceScript/gaps/speed/native-rate WAV/QC/MP3 (AC1), invalid input/empty laziness (AC3), descendant reaping direct + synchronous executor (AC4) |
| R5 | `plugins/generations/voxcpm-tts/tests/test_worker.py:1` | Private pytest worker tests (registry/prefix/WAV/loop, no model) |
| R5 | `plugins/generations/voxcpm-tts/README.md:1` | Setup, env, profile and control-policy runbook |
| R5 | `packages/kk-core/tests/registry.test.ts:239` | First built-in plugin-name enumeration (also `:607` for the second, D2) now lists `voxcpm-tts` |
| R5 | `scripts/bundle-plugins.test.ts:157` | Staging test asserts the worker/project assets are copied and the entry bundles to `dist/index.js` |
| R5 | `apps/cli/tests/package.test.ts:26` | Package test asserts the staged tarball carries the worker/lock/profile outside the checkout |
| R5 | `docs/04_DESIGN.md:1144` | New `@gobing-ai/voxcpm-tts` public-surface section (also `:801` env vars, `:53` design index) |
| — | `bun.lock:180` | Workspace lock registers `plugins/generations/voxcpm-tts` |
| — | `.spur/rules/strict/runtime-boundaries.yaml:89` | Allowlists the adapter's long-lived worker spawn + binary WAV/sync-path IO (same class as `voicebox-server`; also `:161` for `no-direct-fs-io`) |

Rationale: the entry stays a thin dispatcher — all backend-specific behavior lives in
`voxcpm-client.ts` (TS contract/validation/lifecycle) and `python/worker.py` (NDJSON inference),
so VoiceScript parsing, gaps, speed, concat, QC and MP3 remain voice-gen's. Tests inject a fake
worker privately (a `workerCommand` option / a PATH `uv` shim), never a production
fake-model env switch.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/generations/voxcpm-tts/plugin.json:1` declares `kind: generator` entry `./src/index.ts`; `plugins/generations/voxcpm-tts/src/index.ts:30` injects `kk:voxcpm-tts` into `processGeneratorIO` and closes the adapter in `finally`; `plugins/generations/voxcpm-tts/src/index.ts:3` reuses the voice-gen exports (VoiceScript/gaps/speed/concat/QC/MP3); AC1 entry tests `plugins/generations/voxcpm-tts/tests/voxcpm-tts.test.ts:116` pass (ContentSchema audio, ordered gap, speed 1.5, native 48 kHz mono PCM16 WAV, QC passed, MP3 sibling). |
| R2 | MET | `plugins/generations/voxcpm-tts/pyproject.toml:1` pins voxcpm on `==3.12.*`; `plugins/generations/voxcpm-tts/uv.lock:1` resolves 172 packages (`uv lock --check` exit 0 on CPython 3.12.13); `plugins/generations/voxcpm-tts/src/voxcpm-client.ts:205` builds the locked `uv run --locked --no-dev` argv with no shell; `plugins/generations/voxcpm-tts/src/voxcpm-client.ts:90` rejects lexical and symlink vendor paths; staged assets asserted by `scripts/bundle-plugins.test.ts:141` and `apps/cli/tests/package.test.ts:20` (both pass). |
| R3 | MET | `plugins/generations/voxcpm-tts/src/voxcpm-client.ts:133` validates the registry (unique ids/names, per-mode required fields, relative assets, serialized-prompt and mixed-mode rejection); `plugins/generations/voxcpm-tts/src/voxcpm-client.ts:497` rejects engine/personality/effects and maps instruct overrides; `plugins/generations/voxcpm-tts/src/voxcpm-client.ts:226` requires finite/positive-rate mono 16-bit nonempty WAV and derives duration from samples; worker mirror `plugins/generations/voxcpm-tts/python/worker.py:77` and `plugins/generations/voxcpm-tts/python/worker.py:150`; empty-input laziness `plugins/generations/voxcpm-tts/tests/voxcpm-tts.test.ts:158`; client validation suite `plugins/generations/voxcpm-tts/tests/voxcpm-client.test.ts:60` (28 pass). |
| R4 | MET | one model load/invocation, single in-flight render, 1 MiB frame / 64 KiB stderr bounds and group-keyed escalation are in `plugins/generations/voxcpm-tts/src/voxcpm-client.ts:282`, `plugins/generations/voxcpm-tts/src/voxcpm-client.ts:339`, `plugins/generations/voxcpm-tts/src/voxcpm-client.ts:406`; SIGTERM/SIGINT handlers registered at `plugins/generations/voxcpm-tts/src/voxcpm-client.ts:389`; worker NDJSON loop redirects library stdout to stderr at `plugins/generations/voxcpm-tts/python/worker.py:315`; descendant reaping direct and through the synchronous executor `plugins/generations/voxcpm-tts/tests/voxcpm-tts.test.ts:182` and `plugins/generations/voxcpm-tts/tests/voxcpm-tts.test.ts:194`, SIGTERM-ignoring escalation `plugins/generations/voxcpm-tts/tests/voxcpm-client.test.ts:358` all pass; a delivered real SIGTERM reaped the owned descendant (`/tmp` probe: child alive before, dead within 101 ms after SIGTERM). |
| R5 | MET | real-framing fake worker `plugins/generations/voxcpm-tts/tests/fake-worker.ts:1`; private worker pytest `plugins/generations/voxcpm-tts/tests/test_worker.py:1` (9 passed on Python 3.12); both built-in enumerations `packages/kk-core/tests/registry.test.ts:239` and `packages/kk-core/tests/registry.test.ts:607` (both pass); distribution tests `scripts/bundle-plugins.test.ts:141`, `apps/cli/tests/package.test.ts:20`; setup/surface docs `plugins/generations/voxcpm-tts/README.md:1` and `docs/04_DESIGN.md:1144`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — VoxCPM produces compatible audio Content (req: R1, R5) | MET | test | `plugins/generations/voxcpm-tts/tests/voxcpm-tts.test.ts:116` renders plain text to `format:audio` with `metadata.generator: kk:voxcpm-tts`, native 48 kHz mono PCM16 WAV and `qc.passed:true`; `:135` renders a multi-segment VoiceScript with a 500 ms gap and speed 1.5; `:147` publishes the requested MP3 sibling — 3 tests pass, 0 fail. |
| AC2 — VoxCPM runs without the vendor checkout (req: R2, R5) | MET | test | `scripts/bundle-plugins.test.ts:141` asserts the staged tree bundles `dist/index.js` while `python/worker.py`, `pyproject.toml`, `uv.lock` and `profiles.json` ship as copied assets (pass); `apps/cli/tests/package.test.ts:20` asserts the same for the prepack tarball outside the checkout (pass); vendor/symlink refusal `plugins/generations/voxcpm-tts/tests/voxcpm-client.test.ts:112` and `plugins/generations/voxcpm-tts/tests/voxcpm-client.test.ts:245` pass; `uv lock --check` exit 0. |
| AC3 — VoxCPM rejects invalid inputs and unsupported profiles (req: R3, R5) | MET | test | `plugins/generations/voxcpm-tts/tests/voxcpm-client.test.ts:60` covers registry/vendor/device/control/framing/id/oversize/hang rejection; `plugins/generations/voxcpm-tts/tests/voxcpm-tts.test.ts:158` proves empty `Doc[]` starts no worker and `:165` fails actionably on a malformed DocList with no output; `plugins/generations/voxcpm-tts/tests/test_worker.py:1` covers the private worker helpers — all pass (0 fail). |
| AC4 — VoxCPM worker execution is bounded and cleaned up (req: R4, R5) | MET | test | `plugins/generations/voxcpm-tts/tests/voxcpm-tts.test.ts:182` and `:194` prove an owned descendant is reaped through the direct entry and the synchronous executor; `plugins/generations/voxcpm-tts/tests/voxcpm-client.test.ts:358` proves SIGTERM-ignoring escalation (SIGKILL) reaps the owned group; `:190` proves a hung render is bounded by the deadline and goes terminal; a delivered real SIGTERM to a running invocation reaped the owned descendant within 101 ms (throwaway `/tmp` probe, no repo edits). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0256 (re-review after remediation)

**Scope:** 0256 change set — `plugins/generations/voxcpm-tts/**` (worker, client, tests), `bun.lock`, `docs/04_DESIGN.md`, `packages/kk-core/tests/registry.test.ts`, `apps/cli/tests/package.test.ts`, `scripts/bundle-plugins.test.ts`, `.spur/rules/strict/runtime-boundaries.yaml`
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS
**Confidence:** HIGH — each finding re-verified by direct read (not the fix description); finding 1 additionally by an A/B teardown probe against the real fake worker (OLD keyed on direct child → descendant `aliveAfter=true`; NEW keyed on owned group → `escalated=true`, `groupGone=true`, child reaped); finding 4 by a subprocess fd-level probe (native `os.write(1,…)` lands on stderr while the protocol line is the sole stdout bytes). Both new tests fail without their fixes. No P1–P3 remains open.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P2 (major) | correctness | Re-verified CLOSED. Escalation is now keyed on the owned group surviving, not the direct child: `waitForGroupGone(pgid, TERM_GRACE_MS)` gates SIGKILL, and a group that survives SIGKILL emits an explicit cleanup-failure diagnostic instead of silently resolving. A/B probe vs the real `stubborn` worker: old keying left the TERM-ignoring descendant alive; new keying reaps it, so `close()` cannot resolve over a live descendant. | `plugins/generations/voxcpm-tts/src/voxcpm-client.ts:427-437` | RESOLVED |
| 2 | P3 (minor) | efficiency | Re-verified CLOSED. `consumeStdout` now bounds the in-progress newline-less remainder (`Buffer.byteLength(stdoutBuffer,'utf8') > LINE_MAX_BYTES` → fail). No false rejection: the buffer only exceeds 1 MiB when the in-progress line already exceeds the cap, so a legitimate ≤1 MiB line still passes `onLine`. | `plugins/generations/voxcpm-tts/src/voxcpm-client.ts:334-336` | RESOLVED |
| 3 | P4 (advisory) | security | Re-verified CLOSED. `XDG_CACHE_HOME` is present in both env path lists (`BASE_ENV_KEYS` and the worker's `_ENV_PATH_KEYS`, the latter asserted by `tests/test_worker.py::test_env_path_keys_include_xdg_cache_home`), so a vendor-rooted cache is refused pre-spawn and pre-backend-load. | `plugins/generations/voxcpm-tts/src/voxcpm-client.ts:79` | RESOLVED |
| 4 | P4 (advisory) | correctness | Re-verified CLOSED. `isolate_protocol_stdout()` dups fd 1, points fd 1 at stderr via `dup2(2,1)`, and returns the saved fd as the protocol stream; `__main__` passes it to `main()`, which writes only there. A native fd-1 write now lands on stderr; the NDJSON channel stays clean. | `plugins/generations/voxcpm-tts/python/worker.py:306-311` | RESOLVED |
| 5 | P4 (advisory) | usability | Re-verified CLOSED. Both R2 Solution rows now anchor at `plugins/generations/voxcpm-tts/{pyproject.toml,uv.lock}:1`; the prior `omni-voice-gen` anchors are gone. | `docs/tasks/0256_add-standalone-voxcpm-generator-using-the-shared-voice-pipel.md` Solution table (R2 rows) | RESOLVED |

##### Round-1 history

Round 1 returned FAIL on findings 1 (P2, teardown escalation keyed on the direct child) and 2 (P3, unbounded in-progress stdout buffer), with findings 3–5 advisory. All five were closed by the remediation cycle: findings 1–2 by the code changes above plus the new `stubborn` / `oversize-no-newline` tests (both verified to fail without their fixes), finding 3 by adding `XDG_CACHE_HOME` to both env lists, finding 4 by fd-level stdout isolation, finding 5 by repointing the R2 anchors. No new P1–P4 findings.

##### Regression sweep (remediation)

Escalation cannot hang or double-kill (`terminateChild` nulls `child` synchronously; bounded 2 s + 1 s group polls + ≤1 s reap). The framing bound cannot reject a legitimate line (the remainder check and `onLine` share `LINE_MAX_BYTES`; an exactly-1 MiB valid line passes both). `dup2(2,1)` cannot swallow protocol writes (protocol goes to the saved fd; the client spawns `stdio: ['pipe','pipe','pipe']`, so stderr is a distinct pipe).

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `plugin.json:1` (`kind: generator`, entry `./src/index.ts`); `src/index.ts:30` injects `kk:voxcpm-tts` into `processGeneratorIO`; reused voice-gen exports `src/index.ts:3`; `tests/voxcpm-tts.test.ts:102` (ContentSchema audio, gaps/speed, native 48 kHz mono WAV, QC, MP3) |
| R2 | MET | `pyproject.toml:1` (`voxcpm==2.0.3`, `==3.12.*`); `uv.lock:1`; `src/voxcpm-client.ts:206` locked argv (no shell); `:91` `assertNoVendorPath` (lexical + symlink); staging proven at `scripts/bundle-plugins.test.ts:157`, `apps/cli/tests/package.test.ts:26`; R2 Solution anchors repointed |
| R3 | MET | `parseVoxCpmRegistry:134`; `policyCheck:485` (engine/personality/effects/instruct-mode); `readWavFile:227` (mono/positive-rate/nonempty, duration from samples); worker mirror `python/worker.py:75,148`; empty-input laziness `tests/voxcpm-tts.test.ts:144` |
| R4 | MET | one model load per invocation, single in-flight render, bounded 1 MiB/64 KiB, signal handlers; teardown escalation now group-keyed and tested (`tests/voxcpm-client.test.ts:358`) — the round-1 PARTIAL is cleared |
| R5 | MET | real-framing fake worker `tests/fake-worker.ts:1`; client/entry bun tests green on targeted spot-runs; worker pytest suite incl. XDG-key and fd-isolation tests; both registry enumerations `packages/kk-core/tests/registry.test.ts:239,607`; `docs/04_DESIGN.md:1144` |

**Next:** proceed to verify — no open P1–P3; the round-1 FAIL is cleared.

### References

- Feature: docs/features/G14_voxcpm-voice-driver-for-both-daily-ai-voice-workflows.md; ADR-036: docs/00_ADR.md; frozen specification: docs/design/voxcpm-daily-voice-driver.md.
- Audit evidence: .spur/run/refine-g14-20261011/ (published wheel/API inspection, frozen task set, admission and order); durable summary: docs/plans/2026-10-11-g14-ready-refinement.md.
- Concurrency audit 2026-10-11: no wip tasks in main corpus; worktree knowledge-kit-run-0248-eaea19 exists for invocation/publish work. Do not re-own apps/cli/src/invoke.ts or its timeout implementation; refresh overlap before implementation. Unrelated workflow-board docs, task 0157 and rule-authoring changes belong to others. Final concurrency recheck also found uncommitted ensurePublishMp3 changes in daily-stages.ts and daily-generate-sections.test.ts; 0257 explicitly reuses that work. Do not revert it; refresh line anchors and helper state before implementation.
- Related tasks: 0257 consumes generator Content; 0258 records live evidence. No task dependencies for 0256.

- Current-tree recheck (2026-10-11, HEAD 701c598b): no WIP tasks; main has an unrelated task 0252 edit. The only other worktree is knowledge-kit-runall-g8-4173 (G8 board/workflow work), with package.json/bun.lock/CLI packaging edits; coordinate lockfile and packaging-test integration, preserve them. The prior 0248 worktree is gone. ensurePublishMp3 and joined segment metadata are already committed in main, not an uncommitted prerequisite.
- Recheck evidence: .spur/run/g14-refine-ready-20261011-recheck/; saved wheel SHA and core source reverified against the published distribution without executing package code. Current primary release source: https://pypi.org/project/voxcpm/2.0.3/ .

### History

- 2026-10-12T05:18:20.428Z todo → wip (system)
- 2026-10-12T07:51:32.293Z wip → testing (system)
- 2026-10-12T15:00:42.586Z testing → done (system)

