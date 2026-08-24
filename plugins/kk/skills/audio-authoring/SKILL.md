---
name: audio-authoring
description: >-
  Use the audio-authoring skill to author spoken-audio scripts from a brief —
  "create an audio script", "write a podcast script", "generate a briefing",
  "outline options for audio", "author a VoiceScript", "revise the script".
  Runs briefing → outline → script with explicit operator gates; solo mode
  ships first, dialogue/interview/narration are named extension points.
---

# audio-authoring — spoken-audio authoring (create | briefing | outline | script)

## Purpose

Turn a Markdown brief into an **approved VoiceScript** for spoken audio in a small
file-backed workspace. One fat skill with four operations — `create`, `briefing`,
`outline`, `script` — sharing one artifact contract, one VoiceScript contract, one
spoken-budget rule, resume behavior, and recovery guidance. This is the authoring
layer extracted from `kk-solo-podcast`; synthesis (TTS) and deterministic formats
are deliberately **out of scope**.

## When to use

- A user asks to author spoken-audio content from a brief or topic ("create a podcast
  script about X", "write the briefing for a 10-minute episode").
- A workflow `agent.run` step needs one authoring stage independently (briefing only,
  outline options only, script from an approved outline).
- An operator resumes a half-finished audio workspace and expects existing approved
  artifacts to be reused, not overwritten.

Do **not** use this skill for: deterministic broadcast-news scripting (that is the
`kk:dailynews-gen` generator plugin), text-to-speech synthesis itself (that is
`kk:voice-gen` — this skill's output is its input), or multi-speaker authoring
beyond the extension-point notes below.

## Invocation contract

`$ARGUMENTS` (or the Skill call args) parse as:

```
[operation] [--mode solo] --dir <work_dir> [--duration <min>] [--language <code>] [--profile <voice>] [--outline a|b|c] [--revise <feedback>] [--force]
```

| Token | Meaning | Default |
| --- | --- | --- |
| `operation` | `create` (default) \| `briefing` \| `outline` \| `script` | `create` |
| `--mode <name>` | authoring mode | `solo` (only implemented mode; others fail loud) |
| `--dir <work_dir>` | workspace directory | required — an empty dir fails loud |
| `--duration <min>` | target spoken duration in minutes | `8` |
| `--language <code>` | spoken language code (enum below) | `en` |
| `--profile <voice>` | voice profile for the wrap step — **not** written into the VoiceScript | none |
| `--outline <a\|b\|c>` | explicit outline selection | operator must select when options are shown |
| `--revise <feedback>` | revision feedback for the script review gate | none (approve path) |
| `--force` | explicit operator approval to replace an existing artifact | off — never overwrite without it |

Operations are case-insensitive. An unknown operation fails loud and lists the four
valid operations. Flags may appear in any order (topic convention).

## Artifact contract

All paths are relative to the workspace `--dir`. Every operation uses these exact
paths — the contract is the same whether the operation runs inside `create` or
directly.

| Artifact | Path | Written by |
| --- | --- | --- |
| Brief (input) | `brief.md` | supplied before invocation — topic phrase or Markdown brief |
| Briefing | `1-briefing/briefing.md` | `briefing` — thesis, takeaways, audience, duration, tone |
| Outline options | `2-outline/outline-option-a.md`, `outline-option-b.md`, `outline-option-c.md` | `outline` — always two or three (a and b required; c optional) |
| Approved outline | `2-outline/outline-approved.md` | `outline` — after explicit operator selection |
| VoiceScript | `3-script/voicescript.yaml` | `script` — from the approved outline only |

Each operation creates the directory it writes into (`1-briefing/`, `2-outline/`,
`3-script/`) when absent. No other files are created — no metadata, no JSON
manifests, no templates, no placeholders.

## Modes

- **solo** (default; only implemented mode) — one voice, no `speakers` map, no
  per-segment `profile` (the `--profile` value lands in the Doc[] wrap performed by
  the workflow, never in the VoiceScript).
- **dialogue** (extension point) — two or more named speakers via the `speakers` map
  and per-segment `speaker`; turns alternate, distinct voices.
- **interview** (extension point) — host + guest via `speakers`; host drives
  questions, guest answers at length.
- **narration** (extension point) — single voice over long-form material; like solo
  but paces for continuous narration rather than episode structure.

Requesting an unimplemented mode fails loud naming the mode and stating that only
`solo` is implemented. No multi-speaker authoring guidance beyond these notes.

## Operations

### create (default)

Sequence: `briefing` → `outline` (selection gate) → `script` (review gate), resuming
from any existing approved artifact:

1. **Resolve the brief** — require `brief.md` under `--dir`; run the `briefing`
   semantics.
2. **Outline** — if `2-outline/outline-approved.md` is missing, run the `outline`
   semantics (write options, selection gate). If it exists, reuse it — do not
   regenerate.
3. **Script** — if `3-script/voicescript.yaml` is missing, run the `script` semantics
   (write + review gate). If it exists and is approved, report it as final — do not
   rewrite.
4. **Report** the final artifact paths and stop. Never re-run a completed step; never
   overwrite an existing approved artifact without `--force`.

### briefing

1. **Prerequisite** (fail loud): `brief.md` missing → stop with recovery ("supply a
   brief at `<dir>/brief.md` first"). `1-briefing/briefing.md` exists without
   `--force` → stop before replacing.
2. **Read** `brief.md` and write `1-briefing/briefing.md`: core thesis, key listener
   takeaways, audience profile, target spoken duration (`--duration` minutes), tone,
   and what material from the brief to emphasize or cut.

### outline

1. **Prerequisite** (fail loud): `1-briefing/briefing.md` missing → stop with
   recovery ("run `briefing` or `create` first").
2. **Resume**: `2-outline/outline-approved.md` exists → reuse it; without `--force`,
   stop before replacing.
3. **Write options** — read the briefing and write two or three genuinely distinct
   outline options to `2-outline/outline-option-{a,b,c}.md` (a and b required; c
   optional). Each option targets the total spoken duration from `--duration`.
4. **Selection gate**: present the options with their paths and **wait for explicit
   operator selection** — `--outline <a|b|c>` or an interactive answer. Do not
   proceed without it. Copy the selected option **verbatim** to
   `2-outline/outline-approved.md`.

### script

1. **Prerequisite** (fail loud): `2-outline/outline-approved.md` missing → stop with
   recovery ("run `outline` or `create` first — never script before outline
   approval").
2. **Resume**: `3-script/voicescript.yaml` exists → without `--force` or `--revise`,
   stop before replacing ("script exists at `<path>`; to revise pass `--revise
   <feedback>`, to replace pass `--force`").
3. **Write** `3-script/voicescript.yaml` from the approved outline only, obeying the
   VoiceScript contract and the spoken-budget rule below. Solo mode shape: one
   speaker, **no** `speakers` map, per-segment `profile` omitted. Emit only valid
   YAML — no markdown fences, no repo or docs paths in the file body.
4. **Review gate**: present the script; offer **approve** or **revision**. Bounded
   revision: at most **3 revision rounds**; each round takes `--revise <feedback>`,
   rewrites the script from the approved outline plus the feedback, and re-presents
   it. After 3 rounds, stop and require an explicit operator decision — never loop
   past the bound.
5. **Executable check**: when the `validate-voicescript.ts` checker is discoverable
   (`KK_WORKFLOWS_DIR` or `$HOME/.config/kk/workflows/`), run it against the written
   file; it is the sole executable authority — the embedded contract below is the
   authoring-time distillation of it.

## VoiceScript contract

The authoring template lives at **`templates/voicescript.solo.yaml`** (relative to
this skill file) — read it first when authoring `3-script/voicescript.yaml`; it is a
valid-YAML skeleton with per-field constraint comments. The executable authority is
`plugins/kk/workflows/validate-voicescript.ts` (canonical source
`plugins/generations/voice-gen/src/voicescript.ts`); the template is its
authoring-time distillation. No other fields are valid authoring targets — do not
invent fields (no `default_profile`, no required `title`).

Field summary (the template carries the same information as inline comments):

| Field | Where | Constraint |
| --- | --- | --- |
| `language` | root | 23-language enum (see template) |
| `default_engine` | root | engine enum (7 engines, see template) |
| `speakers` | root | multi-speaker modes only; each entry requires `profile`; omit in solo |
| `segments` | root | required, non-empty |
| `text` | segment | required, 1..50000 chars |
| `instruct` | speaker/segment | <= 500 chars |
| `gap_ms` | segment | >= 0 |
| `max_chunk_chars` | segment | 100..5000 |
| `crossfade_ms` | segment | 0..500 |
| `speaker` | segment | must name a key of the `speakers` map |

## Spoken-budget rule

Target spoken volume derives from `--duration` and `--language`: for `zh`, `ja`, or
`ko`, target **characters = duration × 220**; for every other language, target
**words = duration × 150**. Land within **±20%** of the target. Apply the rule when
outlining (each option) and when scripting (total across segments).
