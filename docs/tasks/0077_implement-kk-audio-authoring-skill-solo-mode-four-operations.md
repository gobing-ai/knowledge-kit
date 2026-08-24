---
schema_version: 1
name: "Implement kk:audio-authoring skill (solo mode, four operations)"
status: done
template: feature-impl
created_at: 2026-08-23T23:37:50.578Z
updated_at: "2026-08-24T00:50:06.510Z"
feature_id: F7
---

## 0077. Implement kk:audio-authoring skill (solo mode, four operations)

### Background

<!-- Why this task exists: the problem, motivation, and context. Self-contained — readable without the parent. -->

### Requirements
- [x] R1. Create `plugins/kk/skills/audio-authoring/SKILL.md` following the `plugins/kk/skills/topic/SKILL.md` fat-skill pattern: YAML frontmatter (`name: audio-authoring`, trigger-phrase `description`), then Purpose / When to use / Invocation contract / Artifact contract / Operations / Modes sections.
- [x] R2. Invocation contract freezes as: `[operation] [--mode solo] --dir <work_dir> [--duration <min>] [--language <code>] [--profile <voice>] [--outline a|b|c] [--revise <feedback>] [--force]` — operations `create` (default) | `briefing` | `outline` | `script`; unknown operation fails loud listing the four valid ones; flags order-independent (topic convention).
- [x] R3. Artifact contract identical whether an op runs standalone or inside `create`, all relative to `--dir`: `brief.md` (input), `1-briefing/briefing.md` (briefing), `2-outline/outline-option-a.md` + `-b.md` required / `-c.md` optional + `outline-approved.md` after `--outline` selection (outline), `3-script/voicescript.yaml` (script).
- [x] R4. The `script` operation embeds the **complete** VoiceScript contract distilled from `plugins/generations/voice-gen/src/voicescript.ts` (via `plugins/kk/workflows/validate-voicescript.ts`): `default_engine?`, `language?`, `speakers?` (name → `{profile, engine?, language?, instruct?}`), `segments[]` (`speaker?`, `profile?`, `text` 1..50000, `instruct?` ≤500, `engine?`, `language?`, `gap_ms?` ≥0, `max_chunk_chars?` 100..5000, `crossfade_ms?` 0..500), engine enum `qwen|qwen_custom_voice|luxtts|chatterbox|chatterbox_turbo|tada|kokoro`, 23-language enum. **No invented fields** — fixes the current prompt drift (`default_profile`, unvalidated `title`).
- [x] R5. Spoken-budget rule lives in the skill: zh/ja/ko → `duration * 220` chars, else `duration * 150` words, land within ±20%; parameters from `--duration`/`--language`.
- [x] R6. Modes section: `solo` is the only implemented mode; `dialogue` / `interview` / `narration` documented as named extension points (contract already supports them via `speakers`), each with a one-line behavioral note (speaker count, VoiceScript shape, pacing). No multi-speaker authoring guidance beyond that.
- [x] R7. `--revise <feedback>` on `script` consumes operator revision feedback (mirrors `topic --revise`); `create` chains briefing → outline → script with explicit operator gates.
- [x] R8. `bun run lint` and `bun run test` stay green; no production TypeScript added.
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
One file created: the audio-authoring fat skill (188 lines), embedding the R4 VoiceScript contract distilled from voicescript.ts.

| Change (`file:line`) |
|----------------------|
| plugins/kk/skills/audio-authoring/SKILL.md:1 |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/skills/audio-authoring/SKILL.md` exists with YAML frontmatter `name: audio-authoring` + trigger-phrase `description` (SKILL.md:1-9); section order matches the frozen design: Purpose (:13), When to use incl. explicit NOT list for `dailynews-gen`/`voice-gen` (:22-34), Invocation contract (:36), Artifact contract (:59), Modes (:77), Operations create/briefing/outline/script (:92-153), VoiceScript contract (:155), Spoken-budget rule (:183). Fat-skill pattern mirrors `plugins/kk/skills/topic/SKILL.md` (frontmatter → Purpose → When to use → Invocation contract table → Artifact contract table → per-operation subsections; verified side-by-side this pass). |
| R2 | MET | Invocation string frozen verbatim at SKILL.md:41: `[operation] [--mode solo] --dir <work_dir> [--duration <min>] [--language <code>] [--profile <voice>] [--outline a |
| R3 | MET | Artifact contract table SKILL.md:61-75: `brief.md` (input, :67), `1-briefing/briefing.md` (:68), `2-outline/outline-option-a.md`/`-b.md` required with `-c.md` optional (:69), `2-outline/outline-approved.md` after explicit `--outline` selection (:70), `3-script/voicescript.yaml` (:71) — all paths relative to `--dir`, contract identical standalone or inside `create` (:61-63 "the contract is the same whether the operation runs inside `create` or directly"). Verbatim copy on selection at :130-131. |
| R4 | MET | Embedded contract SKILL.md:161-180 checked field-for-field against `plugins/generations/voice-gen/src/voicescript.ts` by script this pass: `default_engine?`, `language?`, `speakers?` (name → profile required + engine?/language?/instruct? ≤500), `segments[]` with `speaker?` (must key speakers map, :171), `profile?`, `text` 1..50000 (:173), `instruct?` ≤500, `engine?`, `language?`, `gap_ms?` ≥0, `max_chunk_chars?` 100..5000, `crossfade_ms?` 0..500 — matches voicescript.ts:146-177 interfaces and validateVoiceScript bounds (:373-502, constants :4-11). Engine enum 7/7 exact (`qwen\|qwen_custom_voice\|luxtts\|chatterbox\|chatterbox_turbo\|tada\|kokoro` = VOICEBOX_ENGINES voicescript.ts:13-21); language enum 23/23 exact (= VOICEBOX_LANGUAGES :23-47). Zero missing fields, zero extras ("no invented fields" guard at :158-159); `default_profile` and `title` NOT asserted anywhere in the contract (drift fixed). Provenance cited at :156-158 (distilled from voicescript.ts, enforced by `plugins/kk/workflows/validate-voicescript.ts`). |
| R5 | MET | Spoken-budget rule SKILL.md:183-187: zh/ja/ko → `duration × 220` characters, every other language → `duration × 150` words, land within ±20%, parameters from `--duration`/`--language`; applied both at outlining (each option) and scripting (total across segments). |
| R6 | MET | Modes section SKILL.md:77-90: `solo` = "default; only implemented mode" (:79); `dialogue` (:82-83), `interview` (:84-85), `narration` (:86-87) each documented as "(extension point)" with a one-line behavioral note (speaker count via speakers map, host+guest shape, continuous-narration pacing). Unimplemented mode fails loud naming the mode (:89-90); "No multi-speaker authoring guidance beyond these notes" (:90). |
| R7 | MET | `--revise <feedback>` consumed by the script review gate (SKILL.md:53, :138-149): bounded at 3 revision rounds, each round rewrites from the approved outline plus feedback, hard stop after 3. `create` chains briefing → outline → script with explicit operator gates: outline selection gate "wait for explicit operator selection — do not proceed without it" (:128-130), script review gate approve-or-revision (:145-149), resume-without-overwrite (:101-108). Mirrors `topic --revise` convention. |
| R8 | MET | Re-run this pass (deliverable is markdown; no production TypeScript added — the only new file is SKILL.md, dir listing confirms no other files): `bun run lint` → biome "Checked 129 files... No fixes applied", typecheck exit 0 across 13 workspaces; `bun run test` → 469 pass / 0 fail, 1758 expect() calls, 38 files, 7.15s. Both green. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Skill exists with the frozen invocation contract | MET | command | grep over SKILL.md this pass: 4 operation subsections (`### create |
| VoiceScript contract is complete and drift-free | MET | command | Node field-for-field comparison script run this pass: extracted contract fields {default_engine, language, speakers, name, profile, engine, instruct, segments, speaker, text, gap_ms, max_chunk_chars, crossfade_ms} → missing vs canonical = none, extra = none, every field present in voicescript.ts interfaces; speakers (:164-169), crossfade_ms (:179), max_chunk_chars (:178), gap_ms (:177), instruct (:169,174), engine + language enums (:162-163) all present; regex-asserted `default_profile` and `title` NOT in the contract block. |
| Solo mode is the only implemented mode | MET | command | grep over Modes section this pass: `**solo** (default; only implemented mode)` :79; `**dialogue** (extension point)` :82; `**interview** (extension point)` :84; `**narration** (extension point)` :86; unimplemented mode fails loud :89-90; `--mode` default cell reads "solo (only implemented mode; others fail loud)" :47. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | spur task check 0077 | — | "0077 (wip): PASS" (run this pass). |
| P4 | bun run lint | — | biome checked 129 files, no fixes; typecheck exit 0 across 13 workspaces (4.13s). |
| P4 | bun run test | — | 469 pass, 0 fail, 1758 expect() calls, 38 files (7.15s). |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-24T00:39:56.937Z todo → wip (system)
- 2026-08-24T00:49:48.067Z wip → testing (system)
- 2026-08-24T00:50:06.510Z testing → done (system)
