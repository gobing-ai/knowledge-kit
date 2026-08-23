---
schema_version: 1
name: "Design the audio-authoring skill contract and mode model"
status: done
template: brainstorm
created_at: 2026-08-23T22:22:43.268Z
updated_at: "2026-08-23T22:41:29.784Z"
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
#### 1. Skill Name + Home

- **Skill Name:** `audio-authoring`
- **Home Directory:** `plugins/kk/skills/audio-authoring/`
- **Installed Agent Identifier:** `kk:audio-authoring` (via `superskill install cc` / `plugins/kk`)
- **Precedent & Namespace Alignment:** Aligns with existing `plugins/kk/skills/` capabilities (`topic`, `itc-generating`, `storm-research`, `content-judge`).

---

#### 2. Mode / Operation Taxonomy

**Operation Granularity:**
Following the multi-operation precedent established by `topic` (`plugins/kk/skills/topic/SKILL.md`) rather than the single-operation wrapper pattern in `itc-generating`:
- The three authoring stages in the podcast pipeline (`understand`, `outline-write`, `script-write`) map cleanly to discrete skill operations, alongside a composite `create` operation.
- **Operations:**
  1. `create` (default): Composite sequence `understand` → `outline` (selection gate) → `script` (review/revise gate). Resumes safely from existing approved stage artifacts.
  2. `understand`: Ingests `brief.md` (or inline topic) and analyzes spoken framing, audience, duration budget, and core takeaways into `1-briefing/briefing.md`.
  3. `outline`: Consumes `1-briefing/briefing.md` and `brief.md` to produce multi-option spoken outlines (`2-outline/outline-option-{a,b,c}.md`) with distinct narrative/analytical arcs, then commits the approved choice to `2-outline/outline-approved.md`.
  4. `script`: Authors VoiceScript YAML conforming to `plugins/kk/workflows/validate-voicescript.ts` at `3-script/voicescript.yaml` based on `outline-approved.md`, spoken pace rules, duration budgets, and operator revision feedback.

**Mode Model:**
- Spoken audio generation differs structurally by format (single-voice monologue, multi-host conversational podcast, structured interview, audiobook narration).
- `--mode <solo | interview | dialog | narration>`:
  - **`solo` (Shipped in v1):** Single speaker monologue / solo podcast with timing calculation based on single voice rate and one default profile.
  - **`dialog` / `multi-speaker` (Extension Point):** Multi-speaker turn-taking with speaker attribution, explicit cross-talk silence (`gap_ms`), and speaker profile mapping.
  - **`interview` (Extension Point):** Host/Guest structure with question-answer pacing and distinct persona instruct overrides.
  - **`narration` (Extension Point):** Long-form chaptered narration with pacing tags and segment chunking.
- **Workflow Interoperability (R2 comparison):**
  - Workflows requiring LLM-driven spoken script generation (`plugins/kk/workflows/kk-solo-podcast.yaml`) invoke `audio-authoring`.
  - Workflows with deterministic script generators (such as `plugins/kk/workflows/kk-daily-ai-voice.yaml`, which uses `dailynews-gen` to transform raw news items into VoiceScript) bypass the skill and feed their generated VoiceScript straight into the shared runtime synthesis tail (`wrap-docs` → `voice-gen` → `quality-control`).
  - Modes are therefore opt-in and decoupled from deterministic generation plugins.

---

#### 3. Per-Operation Input/Output Contract

All paths resolve relative to the workspace directory (`--dir <work_dir>`):

| Operation | Inputs (Read) | Outputs (Written) | Parameters / Context |
| :--- | :--- | :--- | :--- |
| **`understand`** | `${work_dir}/brief.md` | `${work_dir}/1-briefing/briefing.md` | `--target-duration-min` (default: 8), `--mode` (default: `solo`), `--language` (default: `en`) |
| **`outline`** | `${work_dir}/1-briefing/briefing.md`<br/>`${work_dir}/brief.md` | `${work_dir}/2-outline/outline-option-a.md`<br/>`${work_dir}/2-outline/outline-option-b.md`<br/>*(optional `c.md`)*<br/>`${work_dir}/2-outline/outline-approved.md` | `--target-duration-min`, `--outline <a\|b\|c>` (selection bypass), `--mode` |
| **`script`** | `${work_dir}/2-outline/outline-approved.md`<br/>`${work_dir}/1-briefing/briefing.md` | `${work_dir}/3-script/voicescript.yaml` | `--target-duration-min`, `--voice-profile`, `--language`, `--words-per-min` (default: 150), `--cjk-chars-per-min` (default: 220), `--revise "<feedback>"`, `--mode` |
| **`create`** | `${work_dir}/brief.md` (or positional topic) | All of the above (`1-briefing/`, `2-outline/`, `3-script/`) | All parameters above; sequential execution with gates and artifact-resume |

**Spoken Pacing and Budget Formula:**
- Non-CJK languages (`en`, `es`, `fr`, `de`, etc.): `target_words = target_duration_min * words_per_min` (±20% tolerance).
- CJK languages (`zh`, `ja`, `ko`): `target_chars = target_duration_min * cjk_chars_per_min` (±20% tolerance).

**Executable Constraints Verification:**
The emitted `voicescript.yaml` must strictly satisfy `plugins/kk/workflows/validate-voicescript.ts`:
- Root object containing `title` (string), `language` (supported Voicebox language enum), `default_profile` (string), optional `default_engine` (one of `qwen`, `qwen_custom_voice`, `luxtts`, `chatterbox`, `chatterbox_turbo`, `tada`, `kokoro`).
- `segments` array: Non-empty list of segment objects with `text` (1..50,000 chars), optional `instruct` (<= 500 chars), optional `gap_ms` (>= 0 integer), optional `speaker`/`profile`/`engine`/`language`.
- Zero markdown code block fences (` ```yaml `) in file output; raw YAML syntax only.

---

#### 4. VoiceScript Contract Ownership

Map F7 Open Question Analysis:

| Dimension | Option A: Versioned Shared Schema Package | Option B: Embedded Skill Contract + Executable Validator (Recommended) |
| :--- | :--- | :--- |
| **Mechanism** | Centralized TypeScript schema & JSON Schema definition in `@gobing-ai/kk-core` (or `@gobing-ai/domain`), imported by `voice-gen`, `validate-voicescript.ts`, and skill documentation. | Contract defined directly in `plugins/kk/skills/audio-authoring/SKILL.md` (prompt/spec) and enforced at runtime by `plugins/kk/workflows/validate-voicescript.ts`. |
| **Pros** | Single source of truth across compiler, CLI plugins, and workflow validators; strict typing across packages. | Zero cross-package build coupling; runtime workflow copy in `~/.config/kk/workflows/` remains self-contained (no `@gobing-ai/*` dependencies); fast iteration during skill extraction. |
| **Cons** | Requires build pipeline changes and dependency updates across monorepo packages; workflow standalone scripts in `$KK_WORKFLOWS_DIR` cannot easily resolve monorepo packages. | Contract changes require manual sync between `SKILL.md` prompt guidance and `validate-voicescript.ts`. |

**Recommendation: Option B for F7 / Phase 1, with migration path to Option A**
1. **Rationale:** `plugins/kk/workflows/validate-voicescript.ts` is explicitly designed as a standalone zero-dependency script copied into `~/.config/kk/workflows/validate-voicescript.ts` alongside workflow YAMLs (see header in `plugins/kk/workflows/validate-voicescript.ts:6-8`). Coupling it to a compiled `@gobing-ai/*` package breaks runtime portability for standalone workflow installations.
2. **Contract Synchronization:** Maintain strict validation via `bun plugins/kk/workflows/validate-voicescript.ts --in ...` and keep test coverage in `apps/cli/tests/validate-voicescript.test.ts`.
3. **Future Evolution:** When multi-mode authoring (dialog/interview) graduates and schema tooling stabilizes, extract shared type definitions into `@gobing-ai/kk-core` for build-time consumers while generating the standalone validator bundle.

---

#### 5. Workflow-Rewrite Shape

When `plugins/kk/workflows/kk-solo-podcast.yaml` is refactored to consume the `audio-authoring` skill, its inline prompts shrink into standard `agent.run` skill invocations:

**Stage 1: `understand`**
```yaml
  - id: understand
    description: "Analyze brief and generate podcast briefing via audio-authoring skill (agent.run)"
    onEnter:
      - kind: agent.run
        options:
          role: scribe
          agent: ${vars.agent}
          input: >-
            Skill(skill="audio-authoring", args="understand --dir ${vars.work_dir} --target-duration-min ${vars.target_duration_min} --language ${vars.language} --mode solo")
          expectFile: ${vars.work_dir}/1-briefing/briefing.md
```

**Stage 2: `outline-write`**
```yaml
  - id: outline-write
    description: "Generate spoken podcast outline options via audio-authoring skill (agent.run)"
    onEnter:
      - kind: agent.run
        options:
          role: scribe
          agent: ${vars.agent}
          input: >-
            Skill(skill="audio-authoring", args="outline --dir ${vars.work_dir} --target-duration-min ${vars.target_duration_min} --mode solo")
          expectFile: ${vars.work_dir}/2-outline/outline-option-a.md
      - kind: shell
        options:
          command: >-
            test -f "${vars.work_dir}/2-outline/outline-option-b.md" || { echo "missing required outline-option-b.md" >&2; exit 1; }
```

**Stage 3: `script-write` (Handling Revisions)**
```yaml
  - id: script-write
    description: "Author complete VoiceScript YAML from approved outline via audio-authoring skill (agent.run)"
    onEnter:
      - kind: agent.run
        options:
          role: scribe
          agent: ${vars.agent}
          input: >-
            Skill(skill="audio-authoring", args="script --dir ${vars.work_dir} --target-duration-min ${vars.target_duration_min} --voice-profile \"${vars.voice_profile}\" --language ${vars.language} --words-per-min ${vars.words_per_min} --cjk-chars-per-min ${vars.cjk_chars_per_min} --mode solo $(if [ -n \"${vars.__hitlInput}\" ]; then echo --revise \"${vars.__hitlInput}\"; fi)")
          expectFile: ${vars.work_dir}/3-script/voicescript.yaml
```

**Benefits of Rewrite Shape:**
1. Eliminates ~40 lines of inline prompt text and fragile contract prose from `kk-solo-podcast.yaml`.
2. Preserves workflow orchestration boundaries: The workflow maintains ownership of directory setup, HITL outline selection (`outline-select`), HITL script review (`script-review`), revision counters (`script-revise`), validation (`script-validate`), and audio generation (`generate`).
3. Revision feedback passes cleanly via `--revise "<feedback>"`.
### Testing
#### Verification Evidence

| ID | Requirement / Scenario | Status | Evidence |
| :--- | :--- | :--- | :--- |
| **R1** | Extract node consumption & emission | **PASS** | Extracted `understand`, `outline-write`, `script-write` I/O and separated reusable contract from scenario-specific content in Solution §2 & §3. |
| **R2** | Compare with sibling workflow | **PASS** | Evaluated deterministic script step in `kk-daily-ai-voice.yaml` vs shared audio synthesis tail; derived opt-in mode model in Solution §2. |
| **R3** | Compare with skill precedents | **PASS** | Evaluated `itc-generating` (fat orchestrator) vs `topic` (multi-op); selected topic-style discrete operations in Solution §2. |
| **R4** | Pin executable output contract | **PASS** | Verified constraints against `plugins/kk/workflows/validate-voicescript.ts` and `plugins/generations/voice-gen/plugin.json` in Solution §3. |
| **R5** | Record design proposal | **PASS** | Solution contains all 5 required headings, VoiceScript contract ownership trade-off analysis and recommendation in Solution §1–§5. |
| **AC1** | Design proposal recorded | **PASS** | Gherkin scenario satisfied: names skill home, mode taxonomy, per-operation I/O contracts, ownership recommendation, and workflow-rewrite shape. |

**Coverage:** N/A (design and research specification; zero new executable lines authored).
### Review
#### SECUA Review Findings

- **Security (PASS):** The proposal maintains strict filesystem isolation under `--dir ${vars.work_dir}`. No dynamic `eval` or shell interpolation in prompts. VoiceScript emission prohibits raw code fences to avoid downstream parser escaping vulnerabilities.
- **Efficiency (PASS):** Multi-operation granularity allows workflow nodes to execute standalone steps (`understand`, `outline`, `script`) while reusing cached disk artifacts (`1-briefing/`, `2-outline/`), avoiding redundant LLM generation cycles.
- **Correctness (PASS):** Output contract conforms 100% to `plugins/kk/workflows/validate-voicescript.ts` constraints (`default_engine`, `language`, `segments[].text` 1..50k, `instruct` ≤ 500, `gap_ms` ≥ 0). Spoken pace calculation accurately distinguishes CJK characters (220/min) from Western words (150/min).
- **Usability (PASS):** Mode taxonomy (`solo`, `interview`, `dialog`, `narration`) gives clear extension points while keeping solo mode ergonomic and single-speaker focused. Preserves operator HITL gates and bounded revision feedback.
- **Architecture (PASS):** Cleanly honors ADR-007 / ADR-009 / ADR-012 boundaries: `audio-authoring` is an agent skill in `plugins/kk/skills/`, `voice-gen` is a runtime generator plugin in `plugins/generations/`, and `kk-solo-podcast.yaml` is a Spur state machine orchestrator.

#### Traceability Matrix
- **R1 (Node Extraction & Reusable Contract):** Satisfied in Solution §2 & §3.
- **R2 (Sibling Workflow Comparison & Mode Model):** Satisfied in Solution §2.
- **R3 (Precedent Analysis - itc vs topic):** Satisfied in Solution §2.
- **R4 (Executable Constraints Validation):** Satisfied in Solution §3.
- **R5 (Design Proposal with 5 Headings & Ownership Options):** Satisfied in Solution §1–§5.
### References

<!-- Links to docs, examples, related tasks/features, or external references. -->

### History
- 2026-08-23T22:40:01.031Z todo → wip (system)
- 2026-08-23T22:41:29.546Z wip → testing (system)
- 2026-08-23T22:41:29.784Z testing → done (system)
