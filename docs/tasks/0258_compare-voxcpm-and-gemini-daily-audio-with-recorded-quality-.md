---
schema_version: 1
name: Compare VoxCPM and Gemini daily audio with recorded quality evidence
status: todo
template: feature-impl
created_at: 2026-10-12T00:07:13.361Z
updated_at: "2026-10-12T04:46:37.062Z"
feature_id: G14
priority: P2
estimate_hours: 3

dependencies: ["0257"]
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

- [ ] R1. Render fixed Chinese and mixed Chinese-English VoiceScripts with VoxCPM/Gemini, then the same frozen representative existing daily episode through whole-document and sequential forms in four isolated work directories without collection/publication; apply the same configured intro sting to all full renders and record both speech and final episode duration.
- [ ] R2. Record text/script hashes, exact commands, actual generator/package/model revision, profile/seed/effective settings, hardware/device, elapsed time, startup/section throughput, ffprobe duration and artifact/QC evidence including unavailable ASR. Reject fallback output as a Gemini comparison.
- [ ] R3. Record pronunciation/completeness/timbre/prosody/pauses/artifacts only after actual listening, otherwise listening pending; conclude better/comparable/worse/inconclusive with limits and preserve defaults.
- [ ] R4. Persist fixed fixtures and a dated reproducible report with partial failures/blockers and local artifact pointers; do not fabricate live evidence or edit production source/calibration/defaults during this task.

### Acceptance Criteria

- [ ] AC1 — Matched audio comparison records quality and operating cost (req: R1, R2, R3, R4)
  Given identical hashed fixtures and one frozen representative daily script, when both actual drivers render short samples and both daily stage shapes, then docs/plans/<execution-date>-voxcpm-audio-comparison.md records commands/settings/generator identity/artifacts/timing/duration/QC, concrete listener evidence or listening pending, and a supported verdict. Verify by inspecting real Content/section metadata, ffprobe outputs, hashes and report completeness. Fake model tests cannot verify quality; failed inference/fallback is partial evidence, not full verification PASS.

### Q&A

- CLOSED: 0256/0257 own all production changes; this task produces fixtures and evidence only. No tuning framework/calibration edits or default changes.
- CLOSED: Four short then four full renders cover both driver and workflow-form dimensions; actual provenance must rule out Gemini fallback.
- CLOSED: Fixed scripts/settings are frozen above; representative episode is selected from existing output at execution and hashed before any render. No vendor sample/reference audio.
- CLOSED: Missing inference/playback yields partial evidence or listening pending and inconclusive, not an invented quality success. Full verification requires completed render evidence.
- DEFERRED to operator after evidence: adopting a different default, calibrated estimates or persistent service. No additional task is created by refinement.

#### Q&A entry — 2026-10-12T04:46:35.422Z

- CLOSED on recheck: use verified --plugins-root argv; full renders include the same hashed configured intro and daily-episode-duration check. Missing intro leaves that final-contract evidence incomplete.
- CLOSED on recheck: zero verification retries does not remove transport/internal retries or probes; actual attempt cost is recorded. Gemini seed and total-budget behavior are explicitly different from VoxCPM, no equivalence is claimed.

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

- [ ] R1/R2: Step 0 confirm 0256/0257 verification, installed backend/hardware and configured Gemini access/profile; freeze finite run budget and exact CLI argv without revealing secrets.
- [ ] R1/R4: Create the two fixed fixture scripts/Doc[] and record hashes; select and snapshot one representative existing episode plus matching plan/Doc[] into four scratch roots.
- [ ] R1/R2: Perform four short direct-plugin renders; inspect actual provenance, playable output, ffprobe/QC and timestamps. Stop affected live work after one diagnosed environment failure.
- [ ] R1/R2: Perform four full renders through both stage forms; verify intended driver on every final/section artifact, apply the same hashed intro, run the duration gate, and record startup/throughput/speech/final duration and genuine failures. Gemini fallback is not Gemini evidence.
- [ ] R3: Listen to actual artifacts if playback is available; record specific observations per sample/driver, otherwise mark listening pending/inconclusive.
- [ ] R2/R3/R4: Write dated report with exact commands, hashes, settings, artifacts, blockers and supported recommendation; validate evidence pointers/report completeness and relevant fixture/rule checks. Do not modify calibration/defaults or claim full verification on incomplete live renders.

- [ ] R1/R2: Freeze supported effective controls, intro asset and current --plugins-root argv before spending; distinguish scheduled renders from actual requests/retries/probes, and report ineffective Gemini seed and inter-segment versus hard invocation budget semantics.

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
- Dependency: 0257, transitively 0256; no downstream task. Existing VoiceScript/Doc contract: plugins/generations/voice-gen/tests and src/voicescript.ts. Stage argv: dailyGenerate in daily-stages.ts (line numbers moved during concurrent MP3 edit). Native join/intro/publish boundary: 0257.

- Current-tree recheck (2026-10-11, HEAD 701c598b): no WIP tasks; main has an unrelated task 0252 edit. The only other worktree is knowledge-kit-runall-g8-4173 (G8 board/workflow work), with package.json/bun.lock/CLI packaging edits; coordinate lockfile and packaging-test integration, preserve them. The prior 0248 worktree is gone. ensurePublishMp3 and joined segment metadata are already committed in main, not an uncommitted prerequisite.
- Exact current CLI contract: apps/cli/src/commands/executor.ts::withRunOptions; render-only dispatch: plugins/kk/scripts/kk-workflow-stages.ts daily-generate/daily-intro/daily-episode-duration; effective Gemini request: plugins/generations/gemini-tts/src/gemini-client.ts::generate. Recheck artifacts: .spur/run/g14-refine-ready-20261011-recheck/.

### History
