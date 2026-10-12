---
schema_version: 1
name: Wire VoxCPM into both daily workflows with driver-aware audio reuse
status: todo
template: feature-impl
created_at: 2026-10-12T00:07:13.360Z
updated_at: "2026-10-12T00:07:41.504Z"
feature_id: G14
priority: P2
estimate_hours: 4

dependencies: ["0256"]
---

## 0257. Wire VoxCPM into both daily workflows with driver-aware audio reuse

### Background

Both workflows already pass vdriver into dailyGenerate at plugins/kk/scripts/daily-stages.ts:464. Voice1 returns early for any QC-passing audio at line 497, ignoring selected generator; voice2 already includes driver in section hashes at line 680. Both workflow defaults and robin-news profile names are explicit near the top of their YAML files. G14 needs genuine opt-in renders rather than reused Gemini audio.

### Requirements

- [ ] R1. Add the voxcpm alias to the shared selector and support voice1 whole-document and voice2 sequential sections without changing stage arguments, Gemini defaults, existing aliases or fallback policy.
- [ ] R2. Use driver-compatible provenance and existing artifact checks before voice1 cache reuse, regenerating legacy/foreign audio; ensure voice2 changed-driver invalidation and same-driver reuse remain correct.
- [ ] R3. Preserve voice2 resume after section failure, order, gaps, intro, measured duration and downstream audio/MP3 metadata. Do not silently treat the existing 5.6 character-rate estimate as measured VoxCPM calibration.
- [ ] R4. Extend stage/workflow fake fixtures and regression tests for both workflows, changed-driver and matching reuse, invalid alias and failed-section resume; update workflow/operator docs and docs/04_DESIGN.md.

### Acceptance Criteria

- [ ] AC1 — Daily voice1 selects VoxCPM explicitly
- [ ] AC2 — Daily voice2 selects VoxCPM for sequential sections
- [ ] AC3 — Audio caches distinguish the selected driver

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

ADR-036 and docs/design/voxcpm-daily-voice-driver.md are the decided design. vendors/ is reference-only: no product imports, path dependencies, subprocess paths, model/reference defaults, symlinks, copied modules or build inputs may resolve there. No default driver change, publishing, daemon, training or speculative abstraction. Use existing Bun/TypeScript/Biome and private uv worker; no .github/workflows changes.

Depends on the standalone generator task. Own plugins/kk/scripts/daily-stages.ts, both named workflow YAMLs and their tests. Add one alias, preserve shared routing. Evaluate cache identity against the resolved generator including current Gemini fallback, and require the corresponding artifact files. Prefer the existing Content generator identity; do not add a registry or general cache subsystem. Preserve voice2 driver-keyed hashes and failure retention. Update descriptions/comments to document voxcpm and inherited environment; no new workflow-only backend parameters. Model/settings A/B comparisons use isolated work directories. VoxCPM estimate is provisional until task 3 records real durations; final measured duration remains authoritative.

Execution budget: one focused implementation run, targeted fake stage tests, one final gate. Artifacts: .spur/run/<run-id>/voxcpm-workflow/ test logs. requireDiff: shared selector/cache + two workflow descriptions + tests/docs only. No live production schedule/run or publication.

### Plan

- [ ] Read standalone plugin output provenance and current Gemini fallback/cache behavior; add voxcpm to the shared map.
- [ ] Correct one-shot cache identity and file-existence validation; exercise existing aliases and fallback without changing policy.
- [ ] Add voice1/voice2 fake render, changed-driver/same-driver cache and failed-section resume tests; preserve final artifact and duration contracts.
- [ ] Update both workflow descriptions, operator examples and docs/04_DESIGN.md; document provisional rate estimate.
- [ ] Validate both workflows through Spur, run targeted tests, then lint/full tests/build/rules.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
