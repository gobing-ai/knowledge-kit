---
schema_version: 1
name: "Design the audio-authoring skill contract and mode model"
status: done
template: brainstorm
created_at: 2026-08-23T22:22:43.268Z
updated_at: "2026-08-23T23:47:13.025Z"
feature_id: F7
---

## 0075. Design the audio-authoring skill contract and mode model

### Background

<!-- Why this task exists: the problem, motivation, and context. Self-contained — readable without the parent. -->

### Requirements
- [x] R1. Extract what each `agent.run` node in `plugins/kk/workflows/kk-solo-podcast.yaml` (`understand`, `outline-write`, `script-write`) consumes and emits; separate scenario-specific content from reusable contract.
- [x] R2. Compare with `plugins/kk/workflows/kk-daily-ai-voice.yaml`, whose script step is **deterministic** (`kk executor run dailynews-gen`, no `agent.run` nodes — verified 2026-08-23): the shared surface is the VoiceScript → wrap-docs → generate → QC tail, not LLM authoring steps. Record what this implies for the mode model (modes are opt-in per workflow, not assumed).
- [x] R3. Take `plugins/kk/skills/itc-generating/SKILL.md` as precedent — note it is a **fat orchestrator with a single `create` operation**, not a multi-mode skill (verified 2026-08-23); the mode/operation taxonomy for audio-authoring is therefore new design, not a copy.
- [x] R4. Pin the executable output contract against `plugins/kk/workflows/validate-voicescript.ts` and the `voice-gen` plugin input (`plugins/generations/voice-gen/`).
- [x] R5. Record in ## Solution a design proposal: skill name + home, operations with input/output contracts, VoiceScript contract ownership options with a recommendation (map F7 Open questions), and the workflow-rewrite shape (how `agent.run` nodes invoke the skill).

**Non-goals:** implementing the skill; editing any workflow YAML; creating follow-on tasks (fog graduation happens in the resolving session per wayfinder protocol, not inside the proposal).
### Acceptance Criteria
```gherkin
Feature: Audio-authoring skill contract and mode model

  Scenario: Design proposal recorded
    Given the solo-podcast workflow, sibling voice workflow, skill precedent, and validator evidence
    When the investigation completes
    Then ## Solution names the skill home and mode/operation taxonomy
    And every operation has an input/output contract checked against validate-voicescript.ts
    And VoiceScript contract ownership options carry a recommendation
    And the workflow-rewrite invocation shape is specified
```
### Q&A
- **Skill scope — settled (operator, 2026-08-23):** generic + mode-based; solo ships first, future modes are extension points.
- **Destination — settled (operator, 2026-08-23):** shipped refactor; map F7 closes on verifyall Shippable: PASS.
- **VoiceScript contract ownership — DEFERRED, owner: operator.** This ticket's proposal must bring options + a recommendation (## Design item 4); the operator settles it from map F7's ## Open questions before the implement ticket graduates.

References: map `docs/features/F7_audio-authoring-skill-extraction-wayfinder-map.md`; `plugins/kk/workflows/kk-solo-podcast.yaml`; `plugins/kk/workflows/kk-daily-ai-voice.yaml`; `plugins/kk/workflows/validate-voicescript.ts`; `plugins/generations/voice-gen/plugin.json`; `plugins/kk/skills/itc-generating/SKILL.md`; `plugins/kk/skills/topic/SKILL.md`; `docs/03_ARCHITECTURE.md` (workflow engine semantics).
### Design
**WHAT:** A design proposal for the generic audio-authoring agent skill, recorded in this task's ## Solution. **No code is written.**

**WHY:** Map F7 decision — extract the three `agent.run` authoring nodes of `kk-solo-podcast.yaml` into one generic, mode-based skill (solo shipped, contract ready for more modes). The proposal is the contract the implement tickets will freeze against.

**WHERE (frozen names — read these, nothing else needed):**
- `plugins/kk/workflows/kk-solo-podcast.yaml` — nodes `understand` (reads `brief.md` → writes `1-briefing/briefing.md`), `outline-write` (→ `2-outline/outline-option-{a,b,c}.md`), `script-write` (→ `3-script/voicescript.yaml`; embeds the VoiceScript contract inline).
- `plugins/kk/workflows/validate-voicescript.ts` — executable VoiceScript constraints (title/language/default_profile/segments; segment text 1..50000 chars, gap_ms ≥ 0, instruct ≤ 500).
- `plugins/generations/voice-gen/plugin.json` — generator input contract.
- `plugins/kk/skills/itc-generating/SKILL.md` — fat-orchestrator precedent (single `create` op; orchestrates `topic`, `storm-research`, `content-judge`).
- `plugins/kk/skills/topic/SKILL.md` — multi-operation precedent (`init` / `outline` / `draft` operations with operator gates) — the closer model for a mode-based skill.
- `plugins/kk/workflows/kk-daily-ai-voice.yaml` — deterministic-script sibling; shared tail only.

**Proposal structure (required headings in ## Solution):**
1. Skill name + home (recommend `plugins/kk/skills/audio-authoring/`; installs as `kk:audio-authoring`).
2. Mode/operation taxonomy — map `understand`/`outline-write`/`script-write` to operations; state whether 1:1 or collapsed, with the solo mode as the only shipped mode and future modes (multi-speaker, interview, narration) as named extension points.
3. Per-operation input/output contract — files read/written under `work_dir`, keyed to the existing stage dirs (`1-briefing/`, `2-outline/`, `3-script/`).
4. VoiceScript contract ownership — options (a) versioned shared schema artifact consumed by skill + `validate-voicescript.ts`, (b) embedded in skill prompt with validator as sole executable check; recommendation + rationale. This is map F7's Open question — the proposal recommends, the operator decides.
5. Workflow-rewrite shape — how each `agent.run` node's `input:` prompt shrinks to a skill invocation (args, expectFile), and how revision feedback (`${vars.__hitlInput}`) passes through.

**Anti-patterns (do not do):**
- Do not author SKILL.md content — the proposal is a spec, not the artifact.
- Do not design multi-speaker modes beyond naming extension points (out of scope per map).
- Do not decide the VoiceScript ownership question outright — options + recommendation only.
- Do not invent new workflow engine features (`type: parallel` is inert — see `docs/03_ARCHITECTURE.md`).

**Handoff:** resolving session graduates implement tickets into F7 fog per wayfinder protocol and appends one line to the map's ## Decisions so far.
### Plan
1. Read the six frozen sources in ## Design (WHERE list) — nothing else required.
2. Fill the node-by-node consumption/emission table for `understand` / `outline-write` / `script-write` (R1).
3. Record the kk-daily-ai-voice implication for the mode model (R2).
4. Draft the mode/operation taxonomy using `topic` (multi-op) and `itc-generating` (fat orchestrator) as the two precedents; pick and justify (R3).
5. Pin per-operation contracts against `validate-voicescript.ts` and `voice-gen` plugin.json (R4).
6. Write the VoiceScript ownership options + recommendation (R5, feeds map F7 Open question).
7. Write the five required headings into ## Solution via `spur task update 0075 --section Solution --from-file`.
8. Verify: `spur task check 0075 --json` → pass; every proposal heading present.
### Solution
## Resolution — audio-authoring skill design proposal (2026-08-23)


**`audio-authoring`** at `plugins/kk/skills/audio-authoring/` (installs as `kk:audio-authoring` via superskill, matching the existing `plugins/kk/skills/` collection). One fat skill, following the `topic` precedent (multi-operation, one artifact contract, operator gates, safe resume) — not the `itc-generating` precedent (single-op orchestrator), because the workflow needs to invoke individual steps from separate `agent.run` nodes.


Two orthogonal axes:

- **Operations** (map 1:1 onto the existing workflow nodes): `create | briefing | outline | script`
  - `briefing` ← `understand` node (brief.md → `1-briefing/briefing.md`)
  - `outline` ← `outline-write` node (→ `2-outline/outline-option-{a,b,c}.md`, `outline-approved.md`)
  - `script` ← `script-write` node (→ `3-script/voicescript.yaml`, `--revise` feedback)
  - `create` — end-to-end default that chains the three with operator gates (mirrors `topic create`)
- **Modes** (scenario profile, default `solo`): only `solo` ships in v1. Future modes named as extension points: `dialogue` (multi-speaker discussion), `interview`, `narration`. A mode changes per-operation behavior (speaker count, VoiceScript shape, pacing budget), never the artifact layout.

Rationale for 1:1 mapping: the workflow's HITL gates sit *between* these steps (outline-select, script-review), so each step must stay individually invocable from an `agent.run` node; collapsing them would force the workflow to call `create` and lose the gates.

**Key enabler found during research:** the executable VoiceScript contract (`plugins/generations/voice-gen/src/voicescript.ts`, runtime copy `plugins/kk/workflows/validate-voicescript.ts`) **already supports multi-speaker** — `speakers: Record<string, {profile, engine?, language?, instruct?}>` + per-segment `speaker` refs. So `dialogue` mode is an authoring-prompt concern, not a contract blocker. The solo workflow's inline prompt has **drifted** from the contract: it invents `default_profile` (not a validated field) and omits `speakers` entirely.


All paths relative to `--dir <work_dir>`; identical whether invoked standalone or from a workflow node (the `topic` R2 contract pattern).

| Operation | Reads | Writes | Key params |
| --- | --- | --- | --- |
| `briefing` | `brief.md` | `1-briefing/briefing.md` | `--duration <min>`, `--mode solo` |
| `outline` | `brief.md`, `1-briefing/briefing.md` | `2-outline/outline-option-a.md`, `-b.md` (required), `-c.md` (optional); `outline-approved.md` after `--select a\|b\|c` | `--duration <min>` |
| `script` | `2-outline/outline-approved.md`, `1-briefing/briefing.md` | `3-script/voicescript.yaml` | `--duration <min>`, `--language <code>`, `--profile <voice>` (or per-speaker map in future modes), `--revise <feedback>` |

Spoken-budget rule (zh/ja/ko → chars/min, else words/min) moves into the skill as shared logic, parameterized by `--duration`/`--language` — currently inlined in the `script-write` prompt.


- **(a) Versioned shared schema artifact** (e.g. JSON Schema in `kk-core`, consumed by skill + validator): single source, but adds a sync/build step and a third copy of the contract for marginal gain — the contract changes rarely and has one producer (voice-gen).
- **(b) Validator as sole executable check; skill embeds the full contract distilled from the canonical source** (`voice-gen/src/voicescript.ts`, with the existing SYNC-copy discipline): no new machinery, drift caught by `validate-voicescript.ts` at `script-validate` time.

**Recommendation: (b), with one correction — the skill embeds the *complete* current contract (including `speakers`, `crossfade_ms`, `max_chunk_chars`), fixing the drift the inline prompt introduced (`default_profile`, unvalidated `title`, missing `speakers`).** If a third consumer ever appears, revisit (a) with an ADR. This answers map F7's open question — operator sign-off requested.


Each `agent.run` node shrinks to a skill invocation; orchestration, HITL, validation, and TTS stay in the workflow (`kk` owns steps, `spur workflow` owns orchestration — unchanged):

```yaml
- kind: agent.run
  options:
    role: scribe
    agent: ${vars.agent}
    input: |
      Invoke the kk:audio-authoring skill: operation `script`, mode `solo`.
      --dir ${vars.work_dir} --duration ${vars.target_duration_min}
      --language ${vars.language} --profile ${vars.voice_profile}
      --revise "${vars.__hitlInput}"
    expectFile: ${vars.work_dir}/3-script/voicescript.yaml
```

Revision feedback passes as the skill's `--revise` argument (mirrors `topic --revise`); the bounded 3-round loop and HITL prompts stay in the workflow YAML unchanged. `understand`/`outline-write` rewrite identically (`briefing` / `outline` operations). Everything after `script-write` (validate, wrap-docs, generate, duration-check) is untouched.


R1–R5 verified against:
- `plugins/kk/workflows/kk-solo-podcast.yaml:66` (`understand`), `:79` (`outline-write`), `:128` (`script-write`) — all 3 agent.run nodes read in full
- `plugins/kk/workflows/kk-daily-ai-voice.yaml:56` — deterministic `dailynews-gen` script step; no agent authoring to extract, shared tail only
- `plugins/kk/skills/topic/SKILL.md:12` — 4-op fat-skill model (`create | init | outline | draft`)
- `plugins/kk/skills/itc-generating/SKILL.md:18` — single-op orchestrator, rejected as the model
- `plugins/kk/workflows/validate-voicescript.ts:85` — `speakers?: Record<string, VoiceSpeaker>` already in the contract; `:138` per-speaker profile requirement; canonical source `plugins/generations/voice-gen/src/voicescript.ts` confirmed present
- Drift: solo prompt invents `default_profile` (`plugins/kk/workflows/kk-solo-podcast.yaml:143`), absent from the validator schema
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `docs/tasks/0075_design-the-audio-authoring-skill-contract-and-mode-model.md` Solution §2/§3 — per-node consumption/emission extracted for `understand`/`outline-write`/`script-write` (`plugins/kk/workflows/kk-solo-podcast.yaml:66`,`:79`,`:128`), reusable contract separated from scenario content |
| R2 | MET | Solution §2 enabler note + Evidence — `plugins/kk/workflows/kk-daily-ai-voice.yaml:56` deterministic dailynews-gen step; implication recorded (modes opt-in, shared tail only) |
| R3 | MET | Solution §1 — itc-generating identified as single-op orchestrator (`plugins/kk/skills/itc-generating/SKILL.md:18`), rejected as model; topic multi-op precedent chosen; taxonomy is new design |
| R4 | MET | Solution §3/§4 — contract pinned against `plugins/kk/workflows/validate-voicescript.ts:85` (`speakers`) and `plugins/generations/voice-gen/src/voicescript.ts` canonical source |
| R5 | MET | Solution §1–§5 — name+home, per-op I/O contracts, ownership options + recommendation (b), workflow-rewrite invocation shape with YAML sketch |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: Design proposal recorded | MET | command | `rg -cF 'audio-authoring' docs/tasks/0075_*.md` → 10; `rg -cF 'create |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Finding | Severity | Disposition |
| --- | --- | --- | --- |
| P1 | None | — | — |
| P2 | VoiceScript contract ownership settled as recommendation (b), not operator-signed | low | map F7 Open question pending operator sign-off before 0077 |
| P3 | Section writer strips inner `### N.` headings inside Solution | info | cosmetic; content intact |
| P4 | None | — | — |
### References

<!-- Links to docs, examples, related tasks/features, or external references. -->

### History
- 2026-08-23T22:40:01.031Z todo → wip (system)
- 2026-08-23T22:41:29.546Z wip → testing (system)
- 2026-08-23T22:41:29.784Z testing → done (system)
- 2026-08-23T23:33:20.067Z done → wip (system)
- 2026-08-23T23:47:12.703Z wip → testing (system)
- 2026-08-23T23:47:13.025Z testing → done (system)
