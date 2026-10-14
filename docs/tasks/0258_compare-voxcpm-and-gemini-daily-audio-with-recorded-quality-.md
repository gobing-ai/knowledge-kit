---
schema_version: 1
name: Compare VoxCPM and Gemini daily audio with recorded quality evidence
status: done
template: feature-impl
created_at: 2026-10-12T00:07:13.361Z
updated_at: "2026-10-14T02:54:39.422Z"
feature_id: G14
priority: P2
estimate_hours: 3

dependencies: ["0257"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0258-verdict.json
---

## 0258. Compare VoxCPM and Gemini daily audio with recorded quality evidence

### Background

G14 asks whether VoxCPM improves audio, not for an assumed quality gain. Both daily workflows use robin-news; actual profile mechanisms differ. dailyGenerate supports whole-document and sequential-section forms; the current VoxCPM duration estimate has no live calibration. 0256 provides the backend and 0257 trustworthy driver-specific artifacts. Published package source was inspected, but locked import, hardware/model loading and audio quality have not been tested.

**Refine corrections (2026-10-11)**
- Unspecified fixed scripts → cannot reproduce names/numbers/mixed-language observations → freeze two short VoiceScript texts and settings in Design.
- One episode per driver budget → both stage shapes need matched evidence → freeze four isolated full renders (two drivers × two shapes), after four short renders.
- Gemini-labelled output assumed Gemini → daily stage may fall back to Voicebox → verify generator on every artifact and mark fallback unavailable/inconclusive for the Gemini comparison.
- Optional calibration source edits → evidence task would re-own workflow implementation → report recommendations only; any source/default change needs a separate authorized follow-up.
- Generic report completion → absent playback/inference cannot demonstrate quality → retain blockers/partial evidence, listening pending and inconclusive; never claim full verification without completed render evidence.

**Refine corrections (2026-10-11, current-tree recheck)**
- Frozen direct render command used --plugins → current withRunOptions accepts --plugins-root/--plugins-path only → use --plugins-root with the absolute product root now; no deferred flag guessing.
- Final duration comparison omitted the configured intro sting → workflows run daily-intro before daily-episode-duration → include the same hashed sting for all four full renders and report speech versus final duration separately.
- VOICEBOX_MAX_VERIFY_ATTEMPTS=0 was treated as removing retry amplification → it disables verify retries only; shared voice-gen still retries transport failures once and VoxCPM has internal badcase retries → disclose actual retries/probe overhead and avoid promising eight backend requests.
- Identical seed/effective settings and total-budget semantics were overstated → Gemini ignores the seed and shared max-run cap checks between segments, while the VoxCPM adapter owns a hard invocation deadline → record these differences and sanitize ambient unsupported controls before rendering.
- Historical concurrency claims → Current-tree recheck (2026-10-11, HEAD 701c598b): no WIP tasks; main has an unrelated task 0252 edit. The only other worktree is knowledge-kit-runall-g8-4173 (G8 board/workflow work), with package.json/bun.lock/CLI packaging edits; coordinate lockfile and packaging-test integration, preserve them. The prior 0248 worktree is gone. ensurePublishMp3 and joined segment metadata are already committed in main, not an uncommitted prerequisite.

### Requirements

- [x] R1. Render fixed Chinese and mixed Chinese-English VoiceScripts with VoxCPM/Gemini, then the same frozen representative existing daily episode through whole-document and sequential forms in four isolated work directories without collection/publication; apply the same configured intro sting to all full renders and record both speech and final episode duration.
- [x] R2. Record text/script hashes, exact commands, actual generator/package/model revision, profile/seed/effective settings, hardware/device, elapsed time, startup/section throughput, ffprobe duration and artifact/QC evidence including unavailable ASR. Reject fallback output as a Gemini comparison.
- [x] R3. Record pronunciation/completeness/timbre/prosody/pauses/artifacts only after actual listening, otherwise listening pending; conclude better/comparable/worse/inconclusive with limits and preserve defaults.
- [x] R4. Persist fixed fixtures and a dated reproducible report with partial failures/blockers and local artifact pointers; do not fabricate live evidence or edit production source/calibration/defaults during this task.

### Acceptance Criteria

- [x] AC1 — Matched audio comparison records quality and operating cost (req: R1, R2, R3, R4)
  Given identical hashed fixtures and one frozen representative daily script, when both actual drivers render short samples and every in-scope stage shape renders the frozen episode, then docs/plans/2026-10-12-voxcpm-audio-comparison.md records commands/settings/generator identity/artifacts/timing/duration/QC, concrete listener evidence or listening pending, and a supported verdict. Verify by inspecting real Content/section metadata, ffprobe outputs, hashes and report completeness. A fallback artifact is never counted for the driver it was requested as.

  **Scope amendment (operator direction, 2026-10-12):** the Gemini sequential-section cell is **descoped** from this task. It is blocked by the Gemini API's 100 requests/day Tier-1 allowance (reset ~2026-10-13 16:55 UTC); the single attempt's only artifact is a local Voicebox (`kk:voice-gen`) fallback with a failing QC, which is recorded as a blocker in report §5.1 and is not Gemini evidence. The in-scope matrix is therefore: both drivers × both short fixtures, VoxCPM × both stage shapes, Gemini × whole-document — all with verified per-artifact provenance. Descoping follows the operator's 2026-10-12 direction to skip the Gemini arm and close the batch.

### Q&A

- CLOSED: 0256/0257 own all production changes; this task produces fixtures and evidence only. No tuning framework/calibration edits or default changes.
- CLOSED: Four short then four full renders cover both driver and workflow-form dimensions; actual provenance must rule out Gemini fallback.
- CLOSED: Fixed scripts/settings are frozen above; representative episode is selected from existing output at execution and hashed before any render. No vendor sample/reference audio.
- CLOSED: Missing inference/playback yields partial evidence or listening pending and inconclusive, not an invented quality success. Full verification requires completed render evidence.
- DEFERRED to operator after evidence: adopting a different default, calibrated estimates or persistent service. No additional task is created by refinement.

#### Q&A entry — 2026-10-12T04:46:35.422Z

- CLOSED on recheck: use verified --plugins-root argv; full renders include the same hashed configured intro and daily-episode-duration check. Missing intro leaves that final-contract evidence incomplete.
- CLOSED on recheck: zero verification retries does not remove transport/internal retries or probes; actual attempt cost is recorded. Gemini seed and total-budget behavior are explicitly different from VoxCPM, no equivalence is claimed.

#### Q&A entry — 2026-10-13T15:20:03.143Z

- CLOSED: 0256/0257 own all production changes; this task produces fixtures and evidence only. No tuning framework/calibration edits or default changes.
- CLOSED: Four short then four full renders cover both driver and workflow-form dimensions; actual provenance must rule out Gemini fallback.
- CLOSED: Fixed scripts/settings are frozen above; representative episode is selected from existing output at execution and hashed before any render. No vendor sample/reference audio.
- CLOSED: Missing inference/playback yields partial evidence or listening pending and inconclusive, not an invented quality success. Full verification requires completed render evidence.
- DEFERRED to operator after evidence: adopting a different default, calibrated estimates or persistent service. No additional task is created by refinement.

#### Q&A entry — 2026-10-12T04:46:35.422Z

- CLOSED on recheck: use verified --plugins-root argv; full renders include the same hashed configured intro and daily-episode-duration check. Missing intro leaves that final-contract evidence incomplete.
- CLOSED on recheck: zero verification retries does not remove transport/internal retries or probes; actual attempt cost is recorded. Gemini seed and total-budget behavior are explicitly different from VoxCPM, no equivalence is claimed.

#### Q&A entry — 2026-10-12T22:45:00.000Z (operator scope amendment + authorized fix)

- **Scope amendment — Gemini arm descoped.** Operator direction 2026-10-12: "skip the gemini part, we should get all relevant tasks finished as soon as possible." AC1 was rewritten to name the in-scope matrix explicitly: both drivers × both short fixtures, VoxCPM × both daily stage shapes, Gemini × whole-document. The Gemini sequential-section cell stays **out of scope**: the primary key exhausted the 100 requests/day Tier-1 allowance (reset ~2026-10-13 16:55 UTC), the operator-authorized alternate key did not clear it, and the attempt's only artifact is a Voicebox (`kk:voice-gen`) fallback with QC score 50 — recorded as a blocker in report §5.1, never counted as Gemini evidence.
- **Production edit authorized.** The task's Design forbade production changes while 0256/0257 were owned elsewhere; the operator lifted that boundary on 2026-10-12 so this task could deliver the worker protocol fix (`plugins/generations/voxcpm-tts/python/worker.py:338`) and the three new `tests/test_worker.py` cases. No default driver, calibration, retry policy or workflow YAML changed.
- **Gemini arm kept, not deleted.** The Gemini measurements already taken (both short fixtures + the whole-document episode, all `kk:gemini-tts`, QC 100) are retained as context and as the cost baseline; only the further Gemini cell is skipped.

### Design

ADR-036 and docs/design/voxcpm-daily-voice-driver.md freeze this design. No default change, new daemon/service, copied Python audio pipeline, automatic publication, vendor dependency, unrelated refactor or .github/workflows edit. No product import, dependency, subprocess, build input, cache/model/profile/reference path (including symlinks) may access vendors/. Preserve operator metadata and concurrent changes. Implementation must update docs/04_DESIGN.md with the new surface in the same change; refinement does not implement that surface.

Depends on 0257 (and transitively 0256); use their entry/metadata/cache contracts, do not change them. Own plugins/generations/voxcpm-tts/tests/fixtures/comparison-zh.yaml, comparison-mixed.yaml and docs/plans/<execution-date>-voxcpm-audio-comparison.md; audio/models/logs stay under .spur/run/<run-id>/voxcpm-comparison/ or external caches. No benchmark app or production configuration writes. Report recommendation only; future calibration changes need separate authorization/task.

Freeze fixtures as VoiceScript title + default_profile: robin-news, language: zh, segments each speed:1, seed:42, gap_ms:500 (last gap 0). Chinese segments: '今天是十月十一日，欢迎收听每日人工智能简报。' and '这项研究测试了三种模型，准确率达到百分之九十二点五。接下来，我们看看它的实际表现。'. Mixed segments: '今天的关键词是 OpenAI、GitHub 和 VoxCPM。' and '这次 API 更新把响应时间从二百毫秒降低到一百二十毫秒。Please check the release notes before upgrading.'. Use the same text/settings for each driver; disclose backend-specific voice instructions and seed semantics instead of asserting identical timbre or deterministic output. Serialize each fixed VoiceScript into the same valid Doc[] shape as existing voice-gen fixtures and record byte/SHA256 identity.

Commands: short samples use kk executor run voxcpm-tts (and gemini-tts) --in <docs.json> --out <content.json> --plugins-root <absolute-plugins-root>, with VOICE_GEN_MP3=true; direct Gemini entry avoids the daily quota-fallback ambiguity. These flags are verified against apps/cli/src/commands/executor.ts::withRunOptions; keep exact invoked argv in the report and recheck only if the CLI surface changes. Choose one existing daily episode script with opening/items/closing and freeze its YAML plus optional write_plan and wrapped Doc[] byte-identically; record source path/hash/date. Copy to four distinct scratch work roots at 24-script/<date>_08_script_voicescript.yaml and 30-audio/<date>_10_wrap-docs_docs.json, with matching plan sidecar if present. Use the existing complete episode, never pad invented content to manufacture a duration pass.

Full commands for each driver: kk stage daily-generate <work-root> <date> <absolute-plugins-root> true <driver> for whole-document; append 1 20 for sequential form. Run only render-related commands; no collect, judge, publish-prep or publisher execution for live comparisons. Verify metadata.generator on final and each section equals the intended kk:voxcpm-tts or kk:gemini-tts; Gemini fallback is a blocker/inconclusive comparison, never rename it. Existing Gemini probe policy stays intact. Use separate work roots per driver/shape/settings, no cache deletion of production data.

Budget: four short renders (two texts × two drivers), then four full-episode renders (two drivers × two stage shapes), no extra expensive tuning loop. Retain existing bounded startup/render deadlines; set and record a finite VOICE_GEN_MAX_RUN_MS based on hardware preflight before live rendering. Set VOICEBOX_MAX_VERIFY_ATTEMPTS=0 for both to disable the existing verification retry loop. This does not disable the shared two-attempt transport loop, Gemini client HTTP retries, Gemini stage quota probes or VoxCPM 2.0.3 internal retry_badcase defaults. Record actual attempts/settings and additional probe calls; the eight scheduled renders are not a promise of eight backend requests. Do not change shared retry policy or add knobs for this comparison. After one environment diagnosis of import/hardware/quota/model failure, stop affected expensive renders and preserve partial evidence. Task wall time is hardware-dependent, original effort estimate is not a runtime SLA.

Record only allowlisted configuration, never environment/secrets dumps. Record published package version, resolved model snapshot revision (unknown if unavailable), effective profile mode/instruction without private asset contents, seed policy, CPU/GPU/RAM if observable, per-invocation elapsed/model-load time, section totals/throughput, ffprobe native sample rate/duration and final measured episode duration against the existing 15–20 minute contract. Explain precheck refusal/overrun; don't call provisional rate measured. Record missing ASR and QC scores separately from listener findings. Use actual playback for observations; if unavailable mark pending/inconclusive. Full AC verification requires completed render evidence; report-only blockers are useful but not complete. No downstream tasks; handoff is an evidence-backed recommendation for the operator.

- **Full episode render-only completion:** after each full daily-generate, run `kk stage daily-intro <work-root> <date> <absolute-intro-file>` with the same configured intro asset (hash it before any render), then `kk stage daily-episode-duration <work-root> <date> 15 20`. These are audio/read-only validation stages, no publishing. Record speech duration before intro and final duration afterward. If the configured sting is absent, preserve speech evidence and record the missing final-episode check; do not pretend speech-only duration verified the final workflow contract. Do not fetch/create substitute music or tune the text to force a duration pass.
- **Effective controls:** inspect the frozen script and allowlisted environment before spending. Remove ambient Voicebox engine/personality/effects overrides incompatible with the VoxCPM request policy from this comparison process only; explicitly freeze supported profile/instruct/language/speed/seed settings without changing the production config. Do not strip unsupported fields from the script to obtain success silently; report such input incompatibility. VoxCPM uses torch.manual_seed; current Gemini generate does not send seed. Report intended seed separately from effective backend seed behavior.
- **Budget evidence:** the new VoxCPM adapter enforces its invocation timer across startup/render; the current shared Gemini path checks VOICE_GEN_MAX_RUN_MS between segments and has per-request HTTP deadlines. Do not claim equivalent hard whole-run timers or shared retry counts. Choose and record finite values before rendering; retain partial artifacts and stop affected scheduled work after one diagnosed failure. No subprocess supervisor, benchmark service or production timeout change belongs here.
- Current-tree recheck (2026-10-11, HEAD 701c598b): no WIP tasks; main has an unrelated task 0252 edit. The only other worktree is knowledge-kit-runall-g8-4173 (G8 board/workflow work), with package.json/bun.lock/CLI packaging edits; coordinate lockfile and packaging-test integration, preserve them. The prior 0248 worktree is gone. ensurePublishMp3 and joined segment metadata are already committed in main, not an uncommitted prerequisite.

### Plan

- [x] R1/R2: Step 0 confirm 0256/0257 verification, installed backend/hardware and configured Gemini access/profile; freeze finite run budget and exact CLI argv without revealing secrets.
- [x] R1/R4: Create the two fixed fixture scripts/Doc[] and record hashes; select and snapshot one representative existing episode plus matching plan/Doc[] into four scratch roots.
- [x] R1/R2: Perform four short direct-plugin renders; inspect actual provenance, playable output, ffprobe/QC and timestamps. Stop affected live work after one diagnosed environment failure.
- [x] R1/R2: Perform the full renders through both stage forms; verify intended driver on every final/section artifact, apply the same hashed intro, run the duration gate, and record startup/throughput/speech/final duration and genuine failures. Gemini fallback is not Gemini evidence. **Three of four cells are genuine** (VoxCPM whole-document, VoxCPM sequential, Gemini whole-document — all `episode-duration ok` with verified `metadata.generator`); **the Gemini sequential cell is descoped by operator direction 2026-10-12** (Q&A): the Gemini daily allowance was exhausted and that cell's only artifact is a `kk:voice-gen` Voicebox fallback with failing QC, recorded as a blocker in the report §5.1 and never counted as Gemini.
- [x] R3: Listen to actual artifacts if playback is available; record specific observations per sample/driver, otherwise mark listening pending/inconclusive. (No playback path exists in the execution environment — listening is recorded as pending and the comparison as inconclusive.)
- [x] R2/R3/R4: Write dated report with exact commands, hashes, settings, artifacts, blockers and supported recommendation; validate evidence pointers/report completeness and relevant fixture/rule checks. Do not modify calibration/defaults or claim full verification on incomplete live renders.
- [x] R1/R2: Freeze supported effective controls, intro asset and current --plugins-root argv before spending; distinguish scheduled renders from actual requests/retries/probes, and report ineffective Gemini seed and inter-segment versus hard invocation budget semantics.

### Solution

Deliverables: one production fix (operator-authorized scope lift, 2026-10-12), the frozen comparison inputs, and the dated evidence report.

| Change | file:line | Rationale |
| --- | --- | --- |
| Success-path NDJSON response in the worker loop | `plugins/generations/voxcpm-tts/python/worker.py:338` | `main()` answered only on error paths, so every valid `health`/`render` was silent and the adapter's `pending` map never resolved (measured: `worker startup timed out after 60000ms`; a 10-minute hang at the 600 s default). The fix emits `_respond(stdout, request.get("id"), payload)` after `_handle` succeeds and adds `continue` to both error branches so the loop answers exactly once per accepted request. |
| Regression tests for the success path | `plugins/generations/voxcpm-tts/tests/test_worker.py:109` | Three cases: health success shape, render success shape, and one-response-per-request ordering with an error interleaved. `pytest` → 12 passed (9 before); `bun test plugins/generations/voxcpm-tts/tests` → 36 pass / 0 fail. The missing case is what let the silent-success defect ship with 0256. |
| Frozen short-comparison fixtures | `plugins/generations/voxcpm-tts/tests/fixtures/comparison-zh.yaml:1`, `plugins/generations/voxcpm-tts/tests/fixtures/comparison-mixed.yaml:1` | The Design's frozen VoiceScripts as hashable inputs (`354c5c40…` 406 B, `709db465…` 407 B); both pass `plugins/kk/scripts/validate-voicescript.ts`. |
| Dated evidence report | `docs/plans/2026-10-12-voxcpm-audio-comparison.md:1` | Complete 4×2 short matrix, 3 of 4 full-episode cells with verified per-artifact provenance, the quota-blocked fourth cell recorded as a Voicebox fallback (never renamed as Gemini), the QC/duration-gate risk it exposed, and the one-command resume path. |
| Scratch render evidence (untracked) | `.spur/run/0258-voxcpm-comparison/` | Four isolated work roots (script + wrapped Docs + plan sidecar per cell), raw render logs, short-render artifacts, and `logs/key-provenance.txt` for the authorized key probe. |

**Scope note.** The task's `## Design` forbade production edits; the operator lifted the 0256/0257 ownership boundary on 2026-10-12 so 0258 could carry the worker fix and finish the comparison. No default driver, calibration, profile, retry policy or workflow YAML was changed: the fix restores the documented protocol (one response per request) that the adapter already assumed.

**Result.** VoxCPM now renders both stage shapes end to end — whole-document 966.11 s speech / 974.93 s final (16.2 min) and sequential 947.24 s / 956.05 s (15.9 min), both `kk:voxcpm-tts`, QC score 100, 48 kHz mono; Gemini's whole-document cell is 994.60 s / 1003.42 s (16.7 min), `kk:gemini-tts`, QC 100, 24 kHz. The Gemini sequential cell is blocked by the 100 requests/day Tier-1 cap (reset ~2026-10-13 16:55 UTC); its only artifact is a `kk:voice-gen` fallback with failing QC (score 50), recorded as a blocker. Listening is pending, so no quality ranking is claimed — the comparison verdict is **inconclusive**, and the recommendation is to keep the current default and treat VoxCPM as opt-in.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | In-scope matrix complete with verified per-artifact provenance (`docs/plans/2026-10-12-voxcpm-audio-comparison.md:66`). Short: VoxCPM zh 11.86 s / mixed 12.82 s at 48 000 Hz (`kk:voxcpm-tts`), Gemini zh 13.06 s / mixed 15.26 s at 24 000 Hz (`kk:gemini-tts`) — inputs frozen at `plugins/generations/voxcpm-tts/tests/fixtures/comparison-zh.yaml:1` (`354c5c40…`) and `plugins/generations/voxcpm-tts/tests/fixtures/comparison-mixed.yaml:1` (`709db465…`). Full episode (frozen script `712cbf0e…`, 41 segments, wrapped Docs `dee6f197…`, four isolated roots): VoxCPM whole 966.11 s → final 974.93 s, VoxCPM sequential 947.24 s → 956.05 s, Gemini whole 994.60 s → 1003.42 s, each `episode-duration ok` with the same hashed intro sting (`fe46031c…`). The Gemini sequential cell is descoped by operator direction (Q&A entry 2026-10-12) and its Voicebox fallback is recorded as a blocker at `docs/plans/2026-10-12-voxcpm-audio-comparison.md:130`, never counted as Gemini. |
| R2 | MET | Hashes, exact argv, package/model/device, timings, ffprobe and QC recorded (`docs/plans/2026-10-12-voxcpm-audio-comparison.md:95-99` full-episode table, `docs/plans/2026-10-12-voxcpm-audio-comparison.md:133-146` backend table, `docs/plans/2026-10-12-voxcpm-audio-comparison.md:104-131` Gemini arm (§5.1), `docs/plans/2026-10-12-voxcpm-audio-comparison.md:64-86` run ids); the fallback was rejected as a Gemini comparison per the requirement. |
| R3 | MET | `docs/plans/2026-10-12-voxcpm-audio-comparison.md:148-151` records listening as pending, asserts no pronunciation/timbre/prosody claim, concludes **inconclusive** with explicit limits, and the recommendation keeps the current default (no default/calibration change). |
| R4 | MET | Fixtures persisted in-tree; the dated report carries commands, partial failures, blockers and local artifact pointers (`docs/plans/2026-10-12-voxcpm-audio-comparison.md:1`); no evidence was fabricated. The one production edit (`plugins/generations/voxcpm-tts/python/worker.py:346-348`) is the operator-authorized protocol fix (regression `plugins/generations/voxcpm-tts/tests/test_worker.py:121-145`), covered by three new tests. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R8 — Matched audio comparison records quality and operating cost | MET | command | `bun apps/cli/src/index.ts stage daily-generate .spur/run/0258-voxcpm-comparison/work-roots/voxcpm-whole 20261010 "$PWD/plugins" true voxcpm` → exit 0, `ffprobe` 48 000 Hz mono 974.93 s final, `metadata.generator == kk:voxcpm-tts`, QC 100; the same with `1 20` → 956.05 s, `kk:voxcpm-tts`; the Gemini whole-document cell → 1003.42 s, `kk:gemini-tts`, QC 100; both short fixtures per driver → 48/24 kHz, all `metadata.generator` verified on the artifact. Recorded at `docs/plans/2026-10-12-voxcpm-audio-comparison.md:117-119` and the generator column of `docs/plans/2026-10-12-voxcpm-audio-comparison.md:95-99`. The Gemini sequential cell is descoped by operator direction and its fallback blocker is recorded rather than counted. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0258

**Scope:** `plugins/generations/voxcpm-tts/python/worker.py` (success-path response) · `plugins/generations/voxcpm-tts/tests/test_worker.py` (3 new cases) · `plugins/generations/voxcpm-tts/tests/fixtures/comparison-{zh,mixed}.yaml` (new) · `docs/plans/2026-10-12-voxcpm-audio-comparison.md` (new) · `## Solution` on this task file
**Dimensions:** functional, correctness, security, efficiency, usability, architecture
**Verdict:** PASS
**Confidence:** HIGH

The level is HIGH because every claim is a command run in this tree: the worker suite (12 passed), the plugin suite (36 pass / 0 fail), `bun run spur-check` (PASS, `.spur/run/0258-test-gate.log`), and the eight live renders whose per-artifact provenance (report §5) was read from the artifacts themselves, not from a log line.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory, out of scope) | correctness | **A Gemini quota failure silently degrades to the local Voicebox engine.** The blocked cell's final artifact is `kk:voice-gen` with `qc.passed: false` (score 50, transcription-fidelity 0.00 garbage in 3 sections), yet `daily-episode-duration` reported `ok: 16.2 min within 15–20 min` and the workflow wrote an MP3. The gate reads length only — not `qc.passed`, not `metadata.generator` — so a degraded fallback episode can clear the final gate. Pre-existing driver/workflow policy, explicitly outside this task's change set (0257 scope); recorded in the report §5.1 so the owner can decide between a QC/generator assertion in the duration gate and a hard stop for `vdriver=gemini`. | `.spur/.../work-roots/gemini-sequential/30-audio/...content.json`; `plugins/kk/scripts/daily-stages.ts` duration stage | REPORTED — not fixed here (no workflow/driver policy change is authorized in 0258) |
| 2 | P4 (advisory) | correctness | The Gemini seed asymmetry is now empirically visible: the frozen `seed: 42` reaches `torch.manual_seed` on VoxCPM (`worker.py:246`) and nothing on the Gemini path (no `seed` under `gemini-tts/src/`). The report states the asymmetry rather than claiming determinism; a future reader must not read `seed: 42` as a shared control. | `plugins/generations/voxcpm-tts/tests/fixtures/comparison-zh.yaml:6` | ACCEPTED |
| 3 | P4 (advisory) | efficiency | VoxCPM costs ~4.2× Gemini's wall clock per episode (50m51s vs 12m00s for the same 41 segments) and both VoxCPM shapes cost about the same, so section-level parallelism (`1 20`) buys nothing on this hardware. Recorded in the report as an operating-profile observation. | report §5 / §7 | ACCEPTED |
| 4 | P4 (advisory) | usability | The worker protocol had no success-path test for five months because every existing case seeded an error (`op: bogus`). The new ordering case (`test_main_still_reports_failures_and_one_line_per_request`) is the general guard: it fails if any future branch forgets its `continue`. | `plugins/generations/voxcpm-tts/tests/test_worker.py:139` | ACCEPTED |
| 5 | P4 (advisory) | usability | The authorized key probe cost ~3h50m of bounded render attempts before the block was proven external; the report records it so the operator does not repeat it, and the resume path is one command after the quota reset. | report §5.1 / §8 | ACCEPTED |

##### Named risk surfaces — what I checked

1. **Protocol contract** — one response per accepted request, in order, id echoed: asserted for success, error and interleaved sequences; the framing guard still returns exit 1 after its single error line.
2. **No silent protocol change** — `_respond`, the two error branches' text, the 1 MiB cap, the malformed-request branch and `isolate_protocol_stdout` are untouched; the existing 9 cases still pass.
3. **Cache/provenance identity** — every reported cell's `metadata.generator` was read from the artifact (not assumed): VoxCPM cells are `kk:voxcpm-tts`, Gemini whole-document is `kk:gemini-tts`, and the blocked cell's `kk:voice-gen` fallback is named as such rather than counted as Gemini.
4. **No production default/calibration change** — the only production edit is the protocol fix; the one config swap for the authorized probe was restored byte-identically (`logs/kk-config.yaml.before-0258-key-swap`), and no secret value appears in any artifact (key fingerprints only).
5. **Vendor boundary** — no new path crosses `vendors/`; the model resolves through the Hub cache snapshot recorded in §6.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | In-scope matrix complete with verified per-artifact provenance (report §4/§5). AC1's scope was amended by operator direction on 2026-10-12 (Q&A): the Gemini sequential cell is descoped, its Voicebox fallback recorded as a blocker and never counted as Gemini |
| R2 | MET | Hashes, exact argv, package/model revision, device, timings, ffprobe and QC recorded (report §4–§6); the fallback was rejected as Gemini evidence instead of renamed (report §5.1) |
| R3 | MET | Listening recorded as pending, quality not asserted, verdict `inconclusive` with limits and no default change (report §7/§8) |
| R4 | MET | Fixtures in-tree, dated report with blockers and artifact pointers, no fabricated evidence (report §1/§5.1/§10); the single production edit is the operator-authorized protocol fix, tested |

**Next:** no open P1–P3 in this change set; proceeding to verification. R1's one missing cell is an external quota block, not a repair candidate.

### References

- Feature: docs/features/G14_voxcpm-voice-driver-for-both-daily-ai-voice-workflows.md; ADR-036: docs/00_ADR.md; frozen specification: docs/design/voxcpm-daily-voice-driver.md.
- Audit evidence: .spur/run/refine-g14-20261011/ (published wheel/API inspection, frozen task set, admission and order); durable summary: docs/plans/2026-10-11-g14-ready-refinement.md.
- Concurrency audit 2026-10-11: no wip tasks in main corpus; worktree knowledge-kit-run-0248-eaea19 exists for invocation/publish work. Do not re-own apps/cli/src/invoke.ts or its timeout implementation; refresh overlap before implementation. Unrelated workflow-board docs, task 0157 and rule-authoring changes belong to others. Final concurrency recheck also found uncommitted ensurePublishMp3 changes in daily-stages.ts and daily-generate-sections.test.ts; 0257 explicitly reuses that work. Do not revert it; refresh line anchors and helper state before implementation.
- Dependency: 0257, transitively 0256; no downstream task. Existing VoiceScript/Doc contract: plugins/generations/voice-gen/tests and src/voicescript.ts. Stage argv: dailyGenerate in daily-stages.ts (line numbers moved during concurrent MP3 edit). Native join/intro/publish boundary: 0257.

- Current-tree recheck (2026-10-11, HEAD 701c598b): no WIP tasks; main has an unrelated task 0252 edit. The only other worktree is knowledge-kit-runall-g8-4173 (G8 board/workflow work), with package.json/bun.lock/CLI packaging edits; coordinate lockfile and packaging-test integration, preserve them. The prior 0248 worktree is gone. ensurePublishMp3 and joined segment metadata are already committed in main, not an uncommitted prerequisite.
- Exact current CLI contract: apps/cli/src/commands/executor.ts::withRunOptions; render-only dispatch: plugins/kk/scripts/kk-workflow-stages.ts daily-generate/daily-intro/daily-episode-duration; effective Gemini request: plugins/generations/gemini-tts/src/gemini-client.ts::generate. Recheck artifacts: .spur/run/g14-refine-ready-20261011-recheck/.
### API/library claim sources and confidence

| Claim | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| `withRunOptions` accepts `--plugins-root` (mutually exclusive with `--plugins-path`), so the frozen argv uses only `--plugins-root` | apps/cli/src/commands/executor.ts:10 | Read current source; the mutual-exclusion guard is at apps/cli/src/commands/executor.ts:47 | HIGH |
| `VOICEBOX_MAX_VERIFY_ATTEMPTS` bounds only the verification retry loop (default 2); it does not remove transport retries or backend-internal retries | plugins/generations/voice-gen/src/index.ts:220 | Read current source; the shared transport loop and any backend retry policy are separate | HIGH |
| `VOICE_GEN_MAX_RUN_MS` is a between-segment budget in the shared path, not a hard whole-run timer | plugins/generations/voice-gen/src/index.ts:98 | Read current source | HIGH |
| Startup is bounded by `VOICEBOX_TIMEOUT_MS` (default 600000) plus a per-length allowance | plugins/generations/voice-gen/src/index.ts:243 | Read current source | HIGH |
| The daily workflow runs `daily-intro` before `daily-episode-duration`, so a final-duration check follows the intro merge | .spur/workflows/kk-daily-ai-voice.yaml:418 | Read the current workflow steps (`daily-episode-duration` at .spur/workflows/kk-daily-ai-voice.yaml:426) | HIGH |
| VoxCPM 2.0.3 applies internal `retry_badcase` defaults, so eight scheduled renders do not imply eight backend requests | https://pypi.org/project/voxcpm/2.0.3/ | Package behaviour read from the published source during refinement; not re-fetched and not executed in this task's planning | MEDIUM — upstream defaults not re-verified at render time |
| The current Gemini generate request does not forward a seed, while the VoxCPM adapter applies `torch.manual_seed` | plugins/generations/gemini-tts/src/gemini-client.ts:166 | Read the current request construction (no `seed` occurs anywhere under plugins/generations/gemini-tts/src/) and the VoxCPM seed call at plugins/generations/voxcpm-tts/python/worker.py:246 | HIGH for the local request construction; backend seed effect untested |

### History

- 2026-10-12T22:31:08.621Z todo → wip (system)
- 2026-10-13T15:24:57.975Z wip → testing (system)
- 2026-10-13T15:25:38.429Z testing → done (system)

