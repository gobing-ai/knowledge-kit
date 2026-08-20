---
title: Solo-podcast workflow (voice-gen dogfood)
date: 2026-08-19
needs_design: true
idea: Author plugins/kk/workflows/solo-podcast.yaml to turn given text plus a target voice length into a generated audio file, as dogfood of plugins/generations/voice-gen
sources:
  - plugins/generations/voice-gen/src/index.ts
  - plugins/generations/voice-gen/src/voicescript.ts
  - docs/design/voice-gen.md
  - docs/features/D5_voice-generator-voicebox.md
  - docs/features/F4_it-content-workflow-and-product-yaml-home.md
  - plugins/kk/workflows/kk-itc.yaml
  - plugins/kk/workflows/kk-storm-research.yaml
  - plugins/kk/commands/workflow-run.md
  - docs/00_ADR.md
  - packages/kk-core/src/schemas.ts
  - docs/plans/2026-08-19-voice-gen-brainstorm.md
---

# Brainstorm: Solo-podcast workflow (voice-gen dogfood)

**Date:** 2026-08-19

## Overview

D5 shipped `plugins/generations/voice-gen`: `Doc[]` → `Content` with `format: "audio"` and a
sibling WAV. D5 Scope explicitly left the podcast workflow out as a follow-on. The operator
now wants that follow-on: a product workflow that reads given text, outlines a solo podcast,
HITL-approves the outline, authors a script in the format `voice-gen` already accepts, and
invokes the plugin.

Three facts from the shipped plugin close the original TBCs (not guesses):

1. **Audio format is WAV.** `processGeneratorIO` writes `<outStem>.wav` beside `--out`
   (`plugins/generations/voice-gen/src/index.ts`). Voicebox `GET /audio/{id}` returns WAV;
   concat is PCM WAV (`docs/design/voice-gen.md` D8 / §6). MP3 is a later transcode, not v1.
2. **Voicebox does not take a target duration.** Length policy: “Output duration | none
   documented | Record only” (`docs/design/voice-gen.md` §7). `metadata.duration` is a
   *result*. Target length is a **script-authoring word/char budget**, not a plugin flag.
3. **The script format already exists.** Plain `Doc.body` (one speaker) or kk VoiceScript
   YAML/JSON (`segments`, optional `speakers`, `default_profile`, `gap_ms`, `instruct`).
   Per-segment cap 50,000 characters; `instruct` ≤ 500. Profile must resolve via
   `VOICEBOX_DEFAULT_PROFILE` / script / `doc.metadata.voiceProfile`.

The work is a **product workflow under `plugins/kk/workflows/`** (F4 / ADR-009 amdt
2026-08-19), not a new generator, not a new HITL kind, not a new `kk` noun (ADR-011).
Feature parent is **F** (kk collection); next free child is **F5**. D5 stays done.

## Approaches

### Approach 1: kk-itc-shaped YAML + agent.run + validate-then-invoke ⭐ Recommended

**Description:** Ship `plugins/kk/workflows/kk-solo-podcast.yaml` (F4 `kk-*.yaml` stem,
not `solo-podcast.yaml`) as a state machine that clones the kk-itc HITL grain and ends
in `kk executor run voice-gen`. Script authoring is `agent.run` (scribe) with the
VoiceScript contract pasted into the prompt. A shell step calls the already-shipped
`validateVoiceScript` before TTS so a malformed script never hits Voicebox.

**Proposed machine** (success path; `always` guards on success edges so `--dry-run` walks):

```
prepare
  → understand          # agent.run: briefing from brief.md
  → outline-write       # agent.run: outline-option-a.md + b.md (+ optional c)
  → outline-select      # hitl.select a|b|c  (skip when vars.outline set)
  → outline-commit
  → script-write        # agent.run: VoiceScript YAML sized to duration budget
  → script-validate     # bun helper: parse YAML + validateVoiceScript
  → script-review       # hitl.confirm  (TTS is slow/expensive)
  → script-revise       # hitl.input, cap 3  (same grain as kk-itc draft-revise)
  → wrap-docs           # jq: Doc[] around the YAML
  → generate            # kk executor run voice-gen --in docs.json --out content.json
  → duration-check      # jq metadata.duration vs target; fail-loud on extreme miss
  → done | failed
```

**Duration policy (workflow-level, not plugin):**

| Language | Budget constant | Use |
| --- | --- | --- |
| `en` (and other space-delimited) | ≈ 150 words / minute | `target_words = target_duration_min * 150` |
| `zh` / `ja` / `ko` | ≈ 220 characters / minute | `target_chars = target_duration_min * 220` |

Script-write is instructed to land inside ±20% of that budget, in spoken prose (not
article prose), one speaker, segments of roughly 30–90 s with `gap_ms` between beats.
After generate, compare `content.json` `metadata.duration` (seconds) to
`target_duration_min * 60`. Fail-loud if `< 0.5×` or `> 2×`; otherwise record and
continue. Do **not** auto-regenerate (Voicebox cost). Do **not** add a duration field
to `voice-gen`.

**HITL:** `hitl.select` for outlines (house pattern, two structural options beat a
single “confirm this blob”). `hitl.confirm` for the VoiceScript **before** generate —
the original proposal only gated the outline; that wastes a GPU run on a bad script.
No new `hitl.*` kind.

**agent.run vs skill:** v1 uses `agent.run` with `role: scribe` and `input:` that
loads `docs/design/voice-gen.md` §3 plus a short spoken-script checklist in the
workflow prompt. A fat `solo-podcast` skill is deferred until dogfood shows the
prompt rotting (F3 extracted a skill when IT-writing craft was real; VoiceScript
authoring is a format + a WPM budget, not a writing method). Safety net is
`validateVoiceScript`, not a second skill.

**`/workflow-run`:** do **not** add a third profile in v1. Dogfood target is
`voice-gen`, not the runner. Invoke with `spur workflow run plugins/kk/workflows/kk-solo-podcast.yaml --vars …`.
A runner profile is a follow-on once the YAML is stable (same split C3 YAML → C4 runner).

**Trade-offs:**
- **Pros:**
  - Reuses F4 HITL + `agent.run` exactly; no new engine kinds.
  - Actually dogfoods VoiceScript (not just the plain-text shortcut).
  - Script HITL + `validateVoiceScript` keeps live Voicebox off the failure path.
  - Smallest surface that still matches the operator’s step list.
- **Cons:**
  - Prompt-in-YAML will drift from VoiceScript if the plugin adds fields later.
  - Duration is approximate (WPM ≠ Voicebox speaking rate).
  - Operators must know `spur workflow run` (no `/workflow-run` name yet).

**Implementation Notes:**
- Filename: `kk-solo-podcast.yaml` (ADR-009 product-YAML stem). Capability files still
  omit `kk-`; YAML is not an installable skill.
- Feature **F5** under **F**. D5 stays done; do not reopen it to “own” the workflow.
- Tests: static YAML invariants (clone `apps/cli/tests/kk-itc-workflow.test.ts`) +
  `spur workflow validate` + `--dry-run`. Live Voicebox is dogfood, not CI.
- Tiny helper `plugins/kk/scripts/validate-voicescript.ts` (sibling of `render-md.ts`)
  that reads a YAML/JSON file and calls `validateVoiceScript`. Optional: also wrap
  `Doc[]`. Prefer one helper over inline `bun -e`.
- Vars (all strings): `topic`, `input_file`, `work_dir`, `force`, `outline`,
  `target_duration_min`, `voice_profile`, `language`, `plugins_path`, `agent`.
- XOR `topic` / `input_file`; refuse overwrite of `brief.md` unless `force=true`.
- `voice_profile` required unless `VOICEBOX_DEFAULT_PROFILE` is set; fail-loud in
  prepare if both empty.

**Confidence:** HIGH on format/HITL/invoke path (read the plugin + kk-itc today).
MEDIUM on WPM constants (workflow convention, not Voicebox).
**Sources:**
- [voice-gen.md](../design/voice-gen.md) | **Verified:** 2026-08-19
- [kk-itc.yaml](../../plugins/kk/workflows/kk-itc.yaml) | **Verified:** 2026-08-19
- [voice-gen/src/index.ts](../../plugins/generations/voice-gen/src/index.ts) | **Verified:** 2026-08-19

---

### Approach 2: Fat `solo-podcast` skill + workflow that only orchestrates

**Description:** Add `plugins/kk/skills/solo-podcast/SKILL.md` (or `voice-script`) that
owns source review, outline options, spoken VoiceScript craft, duration budget, and
validation checklist. The YAML is a thin kk-itc clone whose `agent.run` inputs are
“Load that skill. Run operation X.” Optionally add a `/workflow-run` profile.

**Trade-offs:**
- **Pros:**
  - Craft lives in a file agents already know how to load; YAML stays short.
  - Ready for a second podcast variant (interview, series) without duplicating prompts.
  - Matches storm-research / itc-generating once the method is real.
- **Cons:**
  - F collection + superskill install surface for a one-workflow dogfood.
  - No distilled method exists yet (unlike ITC’s four references). Authoring the
    skill now is speculative.
  - Two artifacts to keep in sync (skill operations ↔ YAML states).

**Implementation Notes:**
- Only pick this if dogfood of Approach 1 shows agents repeatedly missing VoiceScript
  constraints or spoken-prose rules. Extract then; do not pre-build.
- If extracted later, capability name must **not** start with `kk-` (ADR-009 prefix rule).

**Confidence:** HIGH as a *later* extraction; LOW as v1 (no craft corpus yet).
**Sources:** F3 (`itc-generating`) and F2 (`topic`) as the “skill when the method exists”
precedent | **Verified:** 2026-08-19

---

### Approach 3: Outline HITL then plain-text Doc (skip VoiceScript)

**Description:** After outline approval, concatenate the outline (or a single prose
dump) into one `Doc.body` with `metadata.voiceProfile`. `voice-gen` already speaks
plain text. Smallest possible plugin dogfood.

**Trade-offs:**
- **Pros:** Almost no script-format risk; one generate call.
- **Cons:**
  - Does not dogfood VoiceScript — the interesting D5 contract, and the one the
    operator asked to “generate the podcast script file in the format our plugin needed”.
  - No segment `gap_ms`, no `instruct`, no duration-shaped chunks.
  - Reads as an article, not a podcast.
  - 50k cap on the whole dump vs per-segment.

**Confidence:** HIGH that it works; HIGH that we should reject it for this feature.
**Sources:** D5 R2 plain-text path | **Verified:** 2026-08-19

---

## Recommendations

Ship **Approach 1**. D5 already answered format (WAV) and duration (record-only). The
missing piece is orchestration + spoken-script authoring + HITL before the GPU. F4
already proved that pattern for IT drafts; copy it, swap the last mile from
`draft-article.md` to VoiceScript → `kk executor run voice-gen`.

Do **not** ship Approach 2 in v1 — there is no writing method to distill yet; the
safety net is `validateVoiceScript`. Do **not** ship Approach 3 — it under-dogfoods
the plugin the operator asked to eat.

Reshape the original proposal on these locked points:

| Original | Reshape |
| --- | --- |
| `solo-podcast.yaml` | `kk-solo-podcast.yaml` (F4 / ADR-009 stem) |
| mp3 / wav / TBC | **WAV** sibling of `content.json`; no transcode |
| “voice length” as generation input | **word/char budget** at script-write; **duration check** after generate |
| outline HITL only (`confirm` or `select`) | **`hitl.select` outlines** + **`hitl.confirm` script** before TTS |
| maybe a role-based skill | **agent.run v1**; skill only if dogfood proves prompt rot |
| implied `/workflow-run` home | **YAML only** in v1; runner profile is a follow-on |
| parent unclear | **F5** under F; D5 stays done |

## Design Summary

Product workflow `plugins/kk/workflows/kk-solo-podcast.yaml` (`kind: state-machine`)
orchestrates D5. It does not change `voice-gen`, kk-core, or the `kk` CLI noun set.

```
XOR topic | input_file
  → ${work_dir}/brief.md
  → agent.run understand  → 1-briefing/briefing.md
  → agent.run outlines    → 2-outline/outline-option-{a,b,c}.md
  → hitl.select (or vars.outline)
  → agent.run script      → 3-script/voicescript.yaml
       spoken prose, one speaker, word/char budget from target_duration_min
  → bun plugins/kk/scripts/validate-voicescript.ts --in voicescript.yaml
  → hitl.confirm (+ bounded hitl.input revise)
  → wrap Doc[]            → 4-audio/docs.json
  → kk executor run voice-gen --in docs.json --out 4-audio/content.json
       --plugins-path ${plugins_path}
  → sibling 4-audio/content.wav
  → jq duration vs target (fail-loud <0.5× or >2×)
  → done
```

**Works layout**

```
${work_dir}/
  brief.md
  1-briefing/briefing.md
  2-outline/outline-option-a.md
  2-outline/outline-option-b.md
  2-outline/outline-option-c.md    # optional
  2-outline/outline-approved.md
  3-script/voicescript.yaml
  4-audio/docs.json
  4-audio/content.json
  4-audio/content.wav
```

**Doc wrapping (generator input)** — `DocSchema` requires `id` + `body` only:

```json
[{
  "id": "<sha256(file://…voicescript.yaml) hex 16>",
  "title": "<VoiceScript title or briefing H1>",
  "sourceUri": "file://<abs>/3-script/voicescript.yaml",
  "body": "<exact YAML>",
  "mediaType": "application/yaml",
  "metadata": { "voiceProfile": "<vars.voice_profile>" }
}]
```

**VoiceScript v1 (solo)** — one speaker via `default_profile`; `speakers` map allowed
but not required. Segments are the beats of the outline. No multi-host interview in v1.

**Invariants**
- `kk` owns the generate step; the workflow owns orchestration (AGENTS.md).
- Existing HITL kinds only (`select` / `confirm` / `input`).
- No new plugin kind; no voice-gen contract change; no MP3; no publish.
- No `/workflow-run` profile in this feature.
- No fat skill in this feature.
- Success edges: `guard: { kind: always }` (dry-run walkable). Action failure uses
  default `onError: fail`.
- Live Voicebox is dogfood; CI is static invariants + `workflow validate` + `--dry-run`.
- `vendors/voicebox` is not imported.

**Rejected**
- Teaching `voice-gen` a duration parameter (D5 D11 / §7).
- MP3 / ffmpeg transcode in v1.
- Plain-text-only generate (Approach 3).
- Fat skill or `/workflow-run` profile in the same feature (Approach 2 + C4-too-soon).
- Reopening D5 to own the workflow (MECE: F owns `plugins/kk`).
- New `hitl.*` kind; new `kk` first-layer noun.

**Open items for system-design (not blockers to proceed)**
- Exact WPM/CPM constants and whether they live as workflow vars with defaults or
  as comments in the script-write prompt.
- Whether `outline-option-c` is required (kk-itc requires a+b, c optional).
- Tolerance numbers for duration-check (0.5×/2× vs ±20% warn-only).
- Helper: validate-only vs validate+wrap-Doc[] in one script.

## Spec self-review

- No `TODO` / `TBD` / `???` / empty required sections. Original TBCs (format, duration,
  skill vs agent.run, confirm vs select) are resolved in the Design Summary.
- No contradiction with ADR-007 (three kinds), ADR-009 (YAML home + `kk-` stem),
  ADR-011 (no new `kk` noun), D5 (plugin already ships WAV + VoiceScript), F4 (HITL grain).
- Scope is one product workflow + a tiny validate helper + static tests. Not a skill,
  not a runner profile, not a plugin change, not publish.
- Feature parent is **F** (next child **F5**). D5 remains done.

## Next Steps

1. Taste-gate this evaluation (`idea-eval`).
2. On approve: `spur feature create "Solo-podcast workflow (voice-gen dogfood)" --parent F` → F5.
3. Author R-numbered AC; `spur feature check --strict`.
4. System-design satellite `docs/design/kk-solo-podcast.md` (state graph, vars, duration
   policy, Doc wrapping, helper signature).
5. Decompose and batch-create under F5.
6. After refine: `/sp-dev-runall --feature F5` (or `--tasks feature:F5`).

---

**Generated by:** sp-brainstorm (idea-pipeline discovery, inline host session)
**Research delegation:** inline read of D5 plugin, F4 workflow, ADR-009; no subprocess
