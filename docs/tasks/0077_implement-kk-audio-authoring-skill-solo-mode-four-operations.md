---
schema_version: 1
name: "Implement kk:audio-authoring skill (solo mode, four operations)"
status: todo
template: feature-impl
created_at: 2026-08-23T23:37:50.578Z
updated_at: "2026-08-24T00:19:02.259Z"
feature_id: F7
---

## 0077. Implement kk:audio-authoring skill (solo mode, four operations)

### Background

<!-- Why this task exists: the problem, motivation, and context. Self-contained — readable without the parent. -->

### Requirements
- [ ] R1. Create `plugins/kk/skills/audio-authoring/SKILL.md` following the `plugins/kk/skills/topic/SKILL.md` fat-skill pattern: YAML frontmatter (`name: audio-authoring`, trigger-phrase `description`), then Purpose / When to use / Invocation contract / Artifact contract / Operations / Modes sections.
- [ ] R2. Invocation contract freezes as: `[operation] [--mode solo] --dir <work_dir> [--duration <min>] [--language <code>] [--profile <voice>] [--outline a|b|c] [--revise <feedback>] [--force]` — operations `create` (default) | `briefing` | `outline` | `script`; unknown operation fails loud listing the four valid ones; flags order-independent (topic convention).
- [ ] R3. Artifact contract identical whether an op runs standalone or inside `create`, all relative to `--dir`: `brief.md` (input), `1-briefing/briefing.md` (briefing), `2-outline/outline-option-a.md` + `-b.md` required / `-c.md` optional + `outline-approved.md` after `--outline` selection (outline), `3-script/voicescript.yaml` (script).
- [ ] R4. The `script` operation embeds the **complete** VoiceScript contract distilled from `plugins/generations/voice-gen/src/voicescript.ts` (via `plugins/kk/workflows/validate-voicescript.ts`): `default_engine?`, `language?`, `speakers?` (name → `{profile, engine?, language?, instruct?}`), `segments[]` (`speaker?`, `profile?`, `text` 1..50000, `instruct?` ≤500, `engine?`, `language?`, `gap_ms?` ≥0, `max_chunk_chars?` 100..5000, `crossfade_ms?` 0..500), engine enum `qwen|qwen_custom_voice|luxtts|chatterbox|chatterbox_turbo|tada|kokoro`, 23-language enum. **No invented fields** — fixes the current prompt drift (`default_profile`, unvalidated `title`).
- [ ] R5. Spoken-budget rule lives in the skill: zh/ja/ko → `duration * 220` chars, else `duration * 150` words, land within ±20%; parameters from `--duration`/`--language`.
- [ ] R6. Modes section: `solo` is the only implemented mode; `dialogue` / `interview` / `narration` documented as named extension points (contract already supports them via `speakers`), each with a one-line behavioral note (speaker count, VoiceScript shape, pacing). No multi-speaker authoring guidance beyond that.
- [ ] R7. `--revise <feedback>` on `script` consumes operator revision feedback (mirrors `topic --revise`); `create` chains briefing → outline → script with explicit operator gates.
- [ ] R8. `bun run lint` and `bun run test` stay green; no production TypeScript added.

**Non-goals:** editing `kk-solo-podcast.yaml` (0078); implementing non-solo modes; changing `voice-gen`; creating a product plugin (`plugin.json`) — this is an agent skill only.
### Acceptance Criteria
```gherkin
Feature: kk:audio-authoring skill (solo mode)

  Scenario: Skill exists with the frozen invocation contract
    Given the kk plugin skill collection
    When plugins/kk/skills/audio-authoring/SKILL.md is read
    Then it documents operations create, briefing, outline, script
    And the flags --mode, --dir, --duration, --language, --profile, --outline, --revise, --force
    And an unknown operation fails loud listing the four valid operations

  Scenario: VoiceScript contract is complete and drift-free
    Given the canonical contract in plugins/generations/voice-gen/src/voicescript.ts
    When the skill's embedded contract is compared field-for-field
    Then speakers, crossfade_ms, max_chunk_chars, gap_ms, instruct, engine and language enums are present
    And no field absent from the canonical contract (default_profile, title) is asserted

  Scenario: Solo mode is the only implemented mode
    When the Modes section is read
    Then solo is documented as the default and only implemented mode
    And dialogue, interview, narration appear as named extension points only
```
### Q&A
- **VoiceScript contract ownership — proceeding per 0075 recommendation (b)**: validator stays sole executable check; skill embeds the full distilled contract. Operator sign-off was pending on map F7; this task freezes against (b) — if the operator rules (a), the delta is a schema file reference, not a rewrite.
- **Skill naming — settled by convention:** directory `plugins/kk/skills/audio-authoring/` (no `kk-` prefix in-tree; superskill install adds the `kk:` prefix).
- **No unit tests for the skill itself** — skills are markdown; executable coverage comes from 0078's workflow static tests and 0079's e2e run.

References: `docs/tasks/0075_design-the-audio-authoring-skill-contract-and-mode-model.md` (design proposal); map `docs/features/F7_audio-authoring-skill-extraction-wayfinder-map.md`; `plugins/kk/skills/topic/SKILL.md`; `plugins/kk/skills/itc-generating/SKILL.md`; `plugins/generations/voice-gen/src/voicescript.ts`; `plugins/kk/workflows/validate-voicescript.ts`; ADR-007 (LLM gating as skills); ADR-009/012 (plugin discovery).
### Design
**WHAT:** One new file — `plugins/kk/skills/audio-authoring/SKILL.md` — the generic, mode-based audio-authoring skill that 0078's workflow rewrite will invoke.

**WHY:** F7 map decision + 0075 design (Solution §1–§5, frozen). The three `agent.run` prompts in `kk-solo-podcast.yaml` move into this skill so the contract, budget math, and authoring craft live in one reusable place.

**WHERE (frozen names):**
- New: `plugins/kk/skills/audio-authoring/SKILL.md` (only file created; no `references/` subdir in v1 — the skill is short enough; split later if it grows past ~300 lines).
- Model to copy: `plugins/kk/skills/topic/SKILL.md` (frontmatter, invocation-contract table, artifact-contract table, per-operation subsections).
- Contract source of truth: `plugins/generations/voice-gen/src/voicescript.ts`; executable check: `plugins/kk/workflows/validate-voicescript.ts` (SYNC copy — do not edit either).
- Installs as `kk:audio-authoring` via `superskill install` (capability names omit the `kk-` prefix in-tree — so the directory is `audio-authoring`, NOT `kk-audio-authoring`).

**Section order (frozen):** frontmatter → `# audio-authoring — …(create | briefing | outline | script)` → Purpose → When to use (incl. explicit NOT list: deterministic broadcast scripting = `dailynews-gen`; TTS itself = `voice-gen`) → Invocation contract → Artifact contract → Modes → Operations (`create`, `briefing`, `outline`, `script` — each with reads/writes/gates) → VoiceScript contract (the R4 field set, fenced) → Spoken-budget rule.

**Precedence/behavior notes:** solo mode script = one speaker, no `speakers` map, per-segment `profile` omitted (workflow's voice profile passes via `--profile` and lands in the Doc[] wrap, not the VoiceScript — matching current behavior); `--outline` selection writes `outline-approved.md`; without `--force`, never overwrite an existing artifact.

**Anti-patterns (do not implement):**
- No `default_profile` / `title` fields in the embedded contract (validator doesn't know them).
- No multi-speaker prompt templates (extension-point notes only).
- No TypeScript, no tests dir, no `plugin.json` — skills are markdown; static invariant coverage belongs to 0078's workflow tests.
- Do not modify `topic`/`itc-generating` or any workflow YAML.

**Assumes from deps:** none (first implement ticket). **Leaves for dependents:** 0078 invokes exactly the R2/R3 contract — flag names and artifact paths here are the interface 0078 codes against.
### Plan
1. Read `plugins/kk/skills/topic/SKILL.md` in full (structure model) and `plugins/generations/voice-gen/src/voicescript.ts` (contract source). (R1, R4)
2. Write `plugins/kk/skills/audio-authoring/SKILL.md` per ## Design's frozen section order. (R1–R7)
3. Self-check the invocation table parses exactly as R2 lists it, and the VoiceScript field set matches R4 field-for-field — no extras, none missing. (R2, R4)
4. Run `bun run lint` and `bun run test` — both green, no new failures. (R8)
5. Verify: `spur task check 0077 --json` pass; Solution change-map records the one created file.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
