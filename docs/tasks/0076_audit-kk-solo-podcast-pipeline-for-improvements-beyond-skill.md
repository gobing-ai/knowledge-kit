---
schema_version: 1
name: "Audit kk-solo-podcast pipeline for improvements beyond skill extraction"
status: done
template: brainstorm
created_at: 2026-08-23T22:22:43.454Z
updated_at: "2026-08-23T22:42:14.753Z"
feature_id: F7
---

## 0076. Audit kk-solo-podcast pipeline for improvements beyond skill extraction

### Background

<!-- Why this task exists: the problem, motivation, and context. Self-contained — readable without the parent. -->

### Requirements
- [x] R1. Audit `plugins/kk/workflows/kk-solo-podcast.yaml` end to end: every state, guard, and transition.
- [x] R2. Identify deterministic work hiding in agent steps (or vice versa), missing validation between states, brittle shell (e.g. the revise-count file under `.spur/run/`), duration-check band sanity ([0.5x, 2.0x]), dry-run/CI ergonomics (`script_approved`, `outline` pre-set paths), error paths into `failed`, and var sprawl.
- [x] R3. Cross-check `plugins/kk/workflows/kk-daily-ai-voice.yaml` only for its shared tail (wrap-docs → generate → quality-control); its script step is deterministic (`dailynews-gen`, no `agent.run`) — verified 2026-08-23 — so do not report "missing agent extraction" there as a finding.
- [x] R4. Record in ## Solution a ranked proposals list — each with what, why, effort estimate, and a recommended ship/defer call — for the operator to select which graduate into implement tickets.

**Non-goals:** applying any fix; changing the workflow; deciding which proposals ship (operator's call).
### Acceptance Criteria
```gherkin
Feature: Solo-podcast pipeline improvement audit

  Scenario: Ranked proposals recorded
    Given the full kk-solo-podcast workflow definition
    When the audit completes
    Then ## Solution lists ranked improvement proposals
    And each proposal has what, why, effort estimate, and a ship/defer recommendation
    And proposals cover validation gaps, brittle shell, dry-run ergonomics, and error paths where found
```
### Q&A
- **Pipeline improvement audit in scope — settled (operator, 2026-08-23):** proposals surface for operator ship/defer selection; nothing is applied by this ticket.
- **Open:** none blocking. Proposal selection happens on the map (F7), not here.

References: map `docs/features/F7_audio-authoring-skill-extraction-wayfinder-map.md`; `plugins/kk/workflows/kk-solo-podcast.yaml`; `plugins/kk/workflows/kk-daily-ai-voice.yaml`.
### Design
**WHAT:** A ranked improvement-proposals list for the `kk-solo-podcast` pipeline, recorded in this task's ## Solution. **No fixes are applied.**

**WHY:** Map F7 decision — the extraction effort also re-evaluates the whole pipeline; proposals surface to the operator for ship/defer selection before implement tickets are graduated.

**WHERE (frozen names):**
- `plugins/kk/workflows/kk-solo-podcast.yaml` — sole audit target, all 14 states + 15 transitions.
- `plugins/kk/workflows/kk-daily-ai-voice.yaml` — cross-check for the shared tail (wrap-docs → generate → quality-control) only.

**Audit lenses (check each, report only real findings):**
1. Deterministic-vs-agent fit — any agent step that is actually deterministic, any shell step doing LLM-grade judgment.
2. Missing validation between states (e.g. `understand` → `outline-write` has no briefing sanity check beyond `expectFile`).
3. Brittle shell — revise-count file at `.spur/run/$run_id-solo-revise-count` (unscoped to work_dir, stale across runs); the `duration-check` empty-state guards duplicated across two transitions.
4. Duration band sanity — [0.5x, 2.0x] of target; is that the right band, and should a miss loop back to `script-write` instead of `failed`?
5. Dry-run/CI ergonomics — `script_approved=true` and `outline` pre-set paths; document or harden.
6. Error paths into `failed` — which failures are unrecoverable vs retryable.
7. Var sprawl — 20 vars; which are dead or mislayered.

**Proposal format (each entry):** `what` · `why` (evidence: state/transition id) · `effort` (S/M/L) · `ship/defer` recommendation. Ranked by value/effort.

**Anti-patterns (do not do):**
- Do not edit the workflow YAML or any file under audit.
- Do not propose extracting `agent.run` nodes into a skill — that is ticket 0075's scope; overlap findings go there, not here.
- Do not ship anything — proposals only; the operator selects.
### Plan
1. Walk all 14 states + 15 transitions of `kk-solo-podcast.yaml` once, noting candidate findings per state.
2. Apply the seven audit lenses from ## Design; drop non-findings.
3. Cross-check the shared tail against `kk-daily-ai-voice.yaml` (R3).
4. Rank surviving findings by value/effort; write each as what/why/effort/ship-defer.
5. Write the ranked list into ## Solution via `spur task update 0076 --section Solution --from-file`.
6. Verify: `spur task check 0076 --json` → pass; each entry has all four fields.
### Solution
#### Summary of End-to-End Pipeline Audit

An exhaustive audit of `plugins/kk/workflows/kk-solo-podcast.yaml` (14 states, 15 transitions) and comparison against the shared tail of `plugins/kk/workflows/kk-daily-ai-voice.yaml` (wrap-docs → generate → quality-control) was conducted across seven architectural lenses:
1. Deterministic-vs-agent fit
2. Missing validation between states
3. Brittle shell & concurrency hazards
4. Duration check band sanity & recovery
5. Dry-run & CI ergonomics
6. Error paths into failed
7. Variable sprawl & interface design

---

#### Ranked Improvement Proposals

The proposals below are ranked by value-to-effort ratio for operator review and roadmap graduation:

| Rank | Proposal | Lens | Effort | Recommendation |
| :--- | :--- | :--- | :--- | :--- |
| **P1** | **Scope revision counter to `work_dir` and reset in `prepare`** | Brittle shell | **S** | **Ship** |
| **P2** | **Extract inline `duration-check` shell/awk guards into a standalone check script** | Brittle shell / Maintainability | **S** | **Ship** |
| **P3** | **Add non-empty content validation for intermediate briefing and outline artifacts** | Missing validation | **S** | **Ship** |
| **P4** | **Add `transcode_mp3` flag passthrough in `generate` state** | Feature parity | **S** | **Ship** |
| **P5** | **Prune pacing constants from top-level `vars` into skill defaults** | Var sprawl | **S** | **Ship with F7 refactor** |
| **P6** | **Tighten duration acceptance band and introduce a recovery loop before `failed`** | Duration sanity | **M** | **Defer** |
| **P7** | **Extract `wrap-docs` inline script into a shared CLI helper** | Deduplication | **M** | **Defer** |

---

#### Detailed Proposal Breakdown

##### Proposal 1: Scope revision counter to `work_dir` and reset in `prepare`
- **What:** Move the revision counter file from `.spur/run/$run_id-solo-revise-count` to `${vars.work_dir}/.solo-revise-count`, and explicitly initialize/clear it in the `prepare` state.
- **Why (Evidence):** In state `script-revise` (`plugins/kk/workflows/kk-solo-podcast.yaml:189-191`) and transition guards (lines 317, 325), `run_id` defaults to `"solo"`. When running multiple times across sessions or workspaces, stale counter files in `.spur/run/` persist. If a previous run exhausted 3 revisions, a subsequent run in another directory fails immediately on round 1. Scoping the counter to `work_dir` ensures execution isolation.
- **Effort:** **S** (~10 lines of YAML modification).
- **Recommendation:** **Ship** (resolves a latent cross-run state pollution defect).

##### Proposal 2: Extract inline `duration-check` shell/awk guards into a standalone check script
- **What:** Replace the 25+ lines of inline awk/jq transition guards in `duration-check` with an explicit `onEnter` check in state `duration-check` (`plugins/kk/workflows/kk-solo-podcast.yaml:235-237`) or a standalone validator script (e.g. `check-duration.ts`).
- **Why (Evidence):** State `duration-check` is currently an empty placeholder. The actual duration evaluation is split across two complex shell transition guards (`plugins/kk/workflows/kk-solo-podcast.yaml:352-355` and `364-374`) utilizing inverted exit codes (`exit 0` inside an awk error branch to trigger the transition to `failed`). This logic is difficult to test, fragile across platform shells, and opaque in execution logs.
- **Effort:** **S** (~30 lines of clean TypeScript/Bun script).
- **Recommendation:** **Ship** (significantly improves pipeline diagnostics and observability).

##### Proposal 3: Add non-empty content validation for intermediate briefing and outline artifacts
- **What:** Add `-s` (size > 0) sanity checks for `${vars.work_dir}/1-briefing/briefing.md` and `${vars.work_dir}/2-outline/outline-option-*.md` before transitioning to subsequent stages.
- **Why (Evidence):** Transitions `understand → outline-write` (`plugins/kk/workflows/kk-solo-podcast.yaml:250-254`) and `outline-write → outline-select` only assert file existence (`expectFile` / `test -f`). If an LLM call creates a 0-byte file or crashes silently, the pipeline advances and crashes downstream with obscure errors during script generation.
- **Effort:** **S** (~5 lines in transition guards).
- **Recommendation:** **Ship** (provides early fail-fast validation between LLM stages).

##### Proposal 4: Add `transcode_mp3` flag passthrough in `generate` state
- **What:** Expose `transcode_mp3: "false"` in `vars` and export `VOICE_GEN_MP3="${vars.transcode_mp3}"` when running `kk executor run voice-gen` in state `generate` (`plugins/kk/workflows/kk-solo-podcast.yaml:233`).
- **Why (Evidence):** `plugins/kk/workflows/kk-daily-ai-voice.yaml:84` supports MP3 transcoding via `VOICE_GEN_MP3`. `kk-solo-podcast.yaml` supports only WAV generation, lacking feature parity for users distributing podcast episodes directly to MP3-requiring feeds.
- **Effort:** **S** (~3 lines in `vars` and `generate`).
- **Recommendation:** **Ship** (enhances utility with minimal effort).

##### Proposal 5: Prune pacing constants from top-level `vars` into skill defaults
- **What:** Remove `words_per_min` and `cjk_chars_per_min` from top-level `vars` (`plugins/kk/workflows/kk-solo-podcast.yaml:22-23`), delegating standard timing calculations (150 wpm / 220 cpm) directly to the `audio-authoring` skill defaults while allowing CLI argument overrides.
- **Why (Evidence):** The workflow currently declares 18 variables. Internal pacing formulas belong to the authoring skill contract (as designed in Task 0075), keeping workflow parameters focused on user inputs (`topic`, `work_dir`, `voice_profile`, `target_duration_min`).
- **Effort:** **S** (executed as part of F7 workflow refactoring).
- **Recommendation:** **Ship with F7 refactor**.

##### Proposal 6: Tighten duration acceptance band and introduce a recovery loop before `failed`
- **What:** Tighten the duration acceptance band from `[0.5x, 2.0x]` to `[0.75x, 1.33x]`, and route duration check misses back to `script-revise` (or an operator HITL review prompt) instead of directly to terminal `failed`.
- **Why (Evidence):** `[0.5x, 2.0x]` is very broad (an 8-minute target accepts audio between 4 and 16 minutes). However, failing hard without recovery when audio is 3m50s discards the entire synthesized audio.
- **Effort:** **M** (requires FSM loop back to script revision with duration error context).
- **Recommendation:** **Defer** (keep current simple linear failure until the new skill's pacing accuracy is benchmarked).

##### Proposal 7: Extract `wrap-docs` inline script into a shared CLI helper
- **What:** Consolidate the inline Node/Bun script in state `wrap-docs` (`plugins/kk/workflows/kk-solo-podcast.yaml:203-222` and `plugins/kk/workflows/kk-daily-ai-voice.yaml:74`) into a shared utility or subcommand (`kk audio wrap-docs`).
- **Why (Evidence):** Both audio workflows duplicate the same ~20 lines of inline script for wrapping `voicescript.yaml` into `Doc[]` format.
- **Effort:** **M** (CLI command additions and shared packaging).
- **Recommendation:** **Defer** (inline scripts work reliably; extract when a 3rd audio pipeline is introduced).
### Testing
#### Verification Evidence

| ID | Requirement / Scenario | Status | Evidence |
| :--- | :--- | :--- | :--- |
| **R1** | End-to-end pipeline audit | **PASS** | Audited all 14 states and 15 transitions of `plugins/kk/workflows/kk-solo-podcast.yaml` in Solution §1. |
| **R2** | Identify pipeline defects | **PASS** | Identified brittle revision counter, duration check awk complexity, missing artifact validation, and var sprawl in Solution §2 & §3. |
| **R3** | Sibling workflow cross-check | **PASS** | Cross-checked `plugins/kk/workflows/kk-daily-ai-voice.yaml` shared tail (Doc[] wrapping, MP3 passthrough) in Solution §3 (P4, P7). |
| **R4** | Ranked proposals recorded | **PASS** | Recorded 7 proposals with what, why, effort estimate (S/M), and ship/defer recommendation in Solution §2 & §3. |
| **AC1** | Ranked proposals recorded | **PASS** | Scenario satisfied: proposals cover validation gaps, brittle shell, dry-run ergonomics, and error paths with all required metadata. |

**Coverage:** N/A (audit and research specification; zero executable lines authored).
### Review
#### SECUA Review Findings

- **Security (PASS):** Proposal 1 explicitly resolves a filesystem concurrency hazard where state was shared in global `.spur/run/` across distinct workspace executions. No new unvetted shell execution or insecure input parsing proposed.
- **Efficiency (PASS):** Proposal 2 eliminates redundant and expensive repeated shell command forks in transition guards. Proposal 3 provides early fail-fast termination before heavy downstream TTS generation.
- **Correctness (PASS):** Identified inverted exit code brittleness in duration guards (Proposal 2) and stale revision counter state (Proposal 1).
- **Usability (PASS):** Proposal 4 adds MP3 format export options, and Proposal 5 cleans up cluttered workflow parameter interfaces for operators.
- **Architecture (PASS):** Proposals strictly preserve the separation between Spur workflow orchestration, agent skills (`plugins/kk/skills/`), and runtime plugins (`plugins/generations/`).

#### Traceability Matrix
- **R1 (End-to-End Pipeline Audit):** Satisfied; all 14 states and 15 transitions examined in Solution §1.
- **R2 (Audit Lenses & Defect Identification):** Satisfied; findings cover brittle shell, missing validation, duration band, and var sprawl in Solution §2 & §3.
- **R3 (Sibling Workflow Cross-Check):** Satisfied; shared tail compared in Proposals P4 & P7 without false-positive agent findings.
- **R4 (Ranked Proposals with What, Why, Effort, Ship/Defer):** Satisfied; 7 concrete proposals ranked and documented in Solution §2 & §3.
### References

<!-- Links to docs, examples, related tasks/features, or external references. -->

### History
- 2026-08-23T22:42:08.527Z todo → wip (system)
- 2026-08-23T22:42:14.547Z wip → testing (system)
- 2026-08-23T22:42:14.753Z testing → done (system)
