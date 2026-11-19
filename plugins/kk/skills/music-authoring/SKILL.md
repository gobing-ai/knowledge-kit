---
name: music-authoring
description: >-
  Use the music-authoring skill to turn one musical idea into an approved MusicBrief and a reviewed
  take over the `kk music` verbs — "write a music brief", "author the lyrics for this song", "iterate
  on this take", "review this track", "why did the take miss its duration". Four operations: brief,
  lyric, iterate, review. Carries the instance's real limits (the prompt is the only control surface,
  duration is a target, Clip is not a Pro preview, no negative prompt, every take is paid and
  immutable) and hands review to kk:content-judge with the `music-quality` rubric.
version: 0.1.0
requires: [cli:kk, cli:spur, local-fs]
---

# music-authoring — brief, lyric, iterate, review

## Purpose

Turn one musical idea into an **approved `MusicBrief`** and one **judged take**, in a file-backed run
directory, over the `kk music` verbs. One fat skill with four operations — `brief`, `lyric`, `iterate`,
`review` — sharing one run-directory contract, one statement of what the model can and cannot do, one
spend rule and one resume rule.

Generation is not this skill. Takes are made by `kk music gen` (0401/0398), measured by
`kk music check` (0405), normalized by `kk music master` (0405) and sequenced by the `kk-music`
workflow (0403). This skill owns the **authoring** of the brief and lyrics, the **iteration loop**, and
the **judge handoff**.

## When to use

- A user asks to author music from an idea ("write a brief for a 30-second synthwave sting", "write
  the lyrics", "make the second half bigger").
- An `agent.run` step in a workflow needs one authoring stage independently (`brief` only, `lyric`
  only, `review` only).
- An operator resumes an interrupted music run directory and expects the existing brief, take and
  checks to be reused, not re-authored and not re-paid.

Do **not** use this skill for: spoken audio (`kk:audio-authoring`), music **generation** policy and
spend enforcement (`kk music gen`, 0400), the deterministic take checks and delivery profile
(`kk music check` / `kk music master`, 0405), the workflow with its select/judge/master gates
(`kk-music`, 0403), or evaluation itself (`kk:content-judge`).

## Invocation contract

```
[operation] --dir <run_dir> [--topic <idea>] [--format <preset>] [--theme <preset>]
            [--model pro|clip] [--duration <m:ss>] [--language <tag>] [--instrumental]
            [--tempo <bpm>] [--key <key>] [--directions <n>] [--revise <feedback>] [--force]
```

| Token | Meaning | Default |
| --- | --- | --- |
| `operation` | `brief` (default) \| `lyric` \| `iterate` \| `review` | `brief` |
| `--dir <run_dir>` | run directory; created when absent, never silently reused as another run | required |
| `--topic <idea>` | the idea in one line, when `idea.md` does not exist | read `idea.md` |
| `--format <preset>` | format preset (`song`, `jingle`, `underscore`, `clip`, `loop`) | `song` |
| `--theme <preset>` | theme preset (`synthwave`, `lofi`, `cinematic`, `ambient-tech`) | required |
| `--model <pro\|clip>` | instance selector; omit to let the format preset decide | preset |
| `--duration <m:ss>` | Pro duration target inside `0:05–3:00` | format preset |
| `--language <tag>` | lyric language tag, always sent | `EN` |
| `--instrumental` | no vocals; the brief may then carry no lyrics | off |
| `--tempo <bpm>` / `--key <key>` | declared musical targets, in the technical direction | from theme |
| `--directions <n>` | differentiated briefs to author for one idea | `2` |
| `--revise <feedback>` | redraft feedback for the `lyric` gate | none (approve path) |
| `--force` | explicit operator approval to replace an existing artifact | off |

Operations are case-insensitive; an unknown operation fails loud and lists the four. Preset names are
`kk music presets`' names — a name not on that list is an error, never a silent fallback.

## Run directory

All paths below are relative to `--dir`. The layout is the music workflow's run directory
(`<works>/kk-music/<topic-slug>/`, 0403), so a state machine and an operator resume the same files.

| Artifact | Path | Written by |
| --- | --- | --- |
| Idea (input) | `idea.md` | supplied before invocation, or `--topic` |
| Brief | `1-brief/brief-<nn>.yaml` | `brief`, `iterate` — the 0397 `MusicBrief` authoring form |
| Prompt text | `1-brief/brief-<nn>.prompt.txt` | `brief`, `iterate` — `kk music render --out` |
| Render trace | `1-brief/brief-<nn>.render.txt` | `brief`, `iterate` — render's stdout (resolved job + request) |
| Lyrics | `2-lyrics.md` | `lyric` — tagged sections; also folded into the brief's `lyrics:` block |
| Generator content | `3-takes/content-<nn>.json` | `kk music gen --out` — takes land beside it |
| Take | `3-takes/<slug>-<model>-<instanceId>.<ext>` | `kk music gen` |
| Take sidecar | `<take>.take.json` | `kk music gen` — digest, instance id, model, unit price, request |
| Take checks | `<take>.checks.json` | `kk music check` |
| Instance analysis | `3-takes/analysis-<instanceId>.json` | `kk music analyze --json` (operator, or 0403) |
| Judge bundle | `4-judge-input.md` | `review` |
| Verdict | `4-verdict-music.json` | `kk:content-judge`, rubric `music-quality` |

`<nn>` is two digits, `01` for the first brief of a run and `+1` per iteration. One brief, one
prompt and one take set per number — an iteration never edits brief `01`, it writes brief `02`.

```
kk music render --in 1-brief/brief-01.yaml --out 1-brief/brief-01.prompt.txt > 1-brief/brief-01.render.txt
kk music gen    --in 1-brief/brief-01.yaml --out 3-takes/content-01.json --takes 1 --yes
kk music check  3-takes/<take> --style "<the brief's style text>" --sections <structure length>
kk music analyze <instanceId> --json > 3-takes/analysis-<instanceId>.json
```

`render`, `presets`, `library`, `check` and `master` are free. `gen` and `analyze` are **paid**: both
print the spend estimate first, both refuse without `--yes`, and a repeat of an already-paid take is
refused unless `--force --reason <text>` is passed (0400's dedupe, scoped to the run directory).

## The instance's real limits

Music is single-turn: one request, one take, no session to steer. The table is the contract — an agent
must not promise any of the left column, and must not write a brief that assumes it.

| Constraint id | Never promise | What is true | Do instead |
| --- | --- | --- | --- |
| `prompt-is-the-only-control-surface` | "set the BPM/key/section to …" as a parameter | There is no tempo, key, structure, vocal or duration parameter. The prompt text is the only control surface; `duration_target`, `lyrics` and `language` travel as request fields the instance owns | Write tempo/key/instrumentation/vocal character into `style`, and sections into `structure` (`[m:ss] Section — note` lines) |
| `duration-is-a-target` | an exact duration ("make it 30.0 s") | `duration_target` is prose to the model. Pro takes are checked at ±20% **or ±10 s, whichever is larger** — a `0:30` target accepts `0:20–0:40` (`plugins/generations/music-gen/src/audio/checks.ts` `PRO_DURATION_TOLERANCE_RATIO`/`_FLOOR_SECONDS`), and a take may still miss either way | State the target, then read `duration.target` in `checks.json` and iterate if it missed |
| `clip-is-not-a-pro-preview` | "render a Clip first to preview the Pro take" | `clip` is a **different model** (`lyria-3-clip-preview` vs `lyria-3-pro-preview`), fixed at about 30 s, and it ignores duration language. Nothing documents that a Clip render predicts a Pro render; it cannot show arrangement, section timing or lyrics past 0:30 | Author each direction in the **format's own model**; exploring with Clip and promoting to Pro is not on offer |
| `no-negative-prompt` | "add `negative_prompt` / exclude X programmatically" | There is no `negative_prompt` field anywhere in the request. Exclusions are prompt text | Put them in `avoid:` — rendered as one `Avoid: a, b` segment, merged with the theme's own list |
| `every-take-is-a-new-paid-request` | "re-roll just the chorus", "it's free to try again" | Each take is a separate **paid, non-idempotent** request (Pro `$0.08`, Clip `$0.04` per `music.prices`); `takes: N` is N sequential requests, never one batch | Say the spend out loud before `--yes`, and count directions × iterations as the budget |
| `no-in-place-edit` | "edit the section in place", "extend it", "swap the second verse" | There is no edit, extend, cover or remix route, and a generated take is **immutable**. A section "edit" is a full re-generation from a new brief | Write the change as a new brief (`iterate`) and take a new take; keep the old artifact as evidence |

Consequences that follow, and that a brief must not contradict: `instrumental: true` plus non-blank
lyrics is a parse error; a `structure` timestamp must be non-decreasing `m:ss`; `duration_target`
outside `0:05–3:00` is rejected before any paid request; an unknown `format`/`theme` is a resolution
error, not a default.

## Operations

### brief

Turn the idea into one brief per direction, resolve it, and stop at the approval gate. **No paid
request happens in this operation.**

1. **Prerequisite** — read `idea.md`, else `--topic`. Both missing → stop asking for one.
2. **Resume** — `1-brief/brief-<nn>.yaml` exists → reuse it verbatim; without `--force` stop before
   replacing it ("brief exists at `<path>`; pass `--force` to replace, or `iterate` for a new one").
3. **Author** `--directions` differentiated briefs (`brief-01`, `brief-02`, …) in the 0397 authoring
   form: `title`, `format`, `theme`, optional `model`, `duration_target`, `language`, `instrumental`,
   `audio_format`, `style` (the technical direction — genre, BPM, key, instrumentation, vocal
   character, production), `avoid` (exclusions that the theme does not already carry), `structure`
   (timestamped sections), optional `lyrics`, `takes: 1`. Unknown keys are rejected at parse time, so
   never invent a field.
4. **Resolve and prove it** —
   `kk music render --in 1-brief/brief-<nn>.yaml --out 1-brief/brief-<nn>.prompt.txt` with stdout into
   `…render.txt`. Render is the schema gate: a brief that does not parse, or names an unknown
   preset, fails here and costs nothing. Read the prompt back — it is the whole of what the model will
   see.
5. **Gate** — present each direction with its prompt text, model, `duration_target` and the
   per-direction spend, and **wait for explicit operator approval**. Nothing about a direction may
   change after approval without a new brief number.
6. **Report** the brief paths, the prompt paths and the spend shape (`directions × unit price`) and
   stop. Never start a paid take from this operation.

### lyric

Author the lyric text as tagged sections and fold it into the brief. **No paid request here either.**

1. **Prerequisite** (fail loud) — an approved brief must exist; a `--instrumental` brief may not carry
   lyrics → stop and say so.
2. **Resume** — `2-lyrics.md` exists → reuse it; `--revise <feedback>` redrafts it, `--force`
   replaces it. Without either, stop before overwriting.
3. **Write** `2-lyrics.md`: `[Intro]` / `[Verse]` / `[Chorus]` / `[Bridge]` / `[Outro]` tags that
   match the brief's `structure` sections, one section at a time, in `--language`. Keep syllable
   shapes consistent inside a section and put the hook line where the structure says the hook lives.
   Add a short `Prosody:` line per section (line count, stress pattern, any deliberate rhyme scheme)
   so an iterate can name what to change.
4. **Fold in** — set the brief's `lyrics: |-` block to the same section text and re-run
   `kk music render` for that brief. Lyrics are a **request field, not prompt text**, so the prompt
   file does not change; the take digest does, which is what makes a lyric change a new legitimate
   take rather than a dedupe hit.
5. **Gate** — present the lyric text with its tags, language and prosody notes; **wait for approval or
   a bounded revision** (at most 3 `--revise` rounds; after the bound, stop and require an explicit
   operator decision — never loop past it).
6. **Report** the lyric path and which brief number it was folded into.

### iterate

Turn what the last take got wrong into the **next brief**, and take exactly one new take of it. This
is the paid loop, and it is bounded.

1. **Prerequisite** (fail loud) — an approved brief, a take on disk and the take's `checks.json` must
   exist. Iterating on an unmeasured take is guessing; run `kk music check` first.
2. **Read the evidence, not the vibe** — cite the row you are reacting to: `duration.target`
   (measured vs the band), `silence.leading`/`trailing`, and the warn-only `analysis.bpm`,
   `analysis.key`, `analysis.sections` agreement rows. A section "edit" is a **full re-generation**:
   there is nothing to patch in the artifact, so the directive must change the brief that produces
   the next whole take.
3. **Write the next brief** — copy brief `<nn>` to `brief-<nn+1>.yaml` and change only what the
   directive names: `structure` timestamps and section notes for arrangement, `style` prose for
   tempo/key/instrumentation/vocal character, `avoid` for a production artefact, `duration_target` for
   a length miss, `lyrics` for a line. Never reuse a brief number, never overwrite an approved brief.
4. **Re-render and confirm the change is visible** —
   `kk music render --in 1-brief/brief-<nn+1>.yaml --out 1-brief/brief-<nn+1>.prompt.txt`; diff the
   prompt against the previous one. An iterate whose prompt is byte-identical changes nothing and
   will be refused as a duplicate request.
5. **Gate** — present the directive, the prompt diff and the spend for one take, and **wait for
   approval**. Then one take:
   `kk music gen --in 1-brief/brief-<nn+1>.yaml --out 3-takes/content-<nn+1>.json --takes 1 --yes`,
   then `kk music check` on the new take.
6. **Resume** — a take whose sidecar exists is adopted, not re-paid: re-running `gen` for that brief
   is refused by 0400's dedupe (digest + take index, scoped to the run directory). Re-pay only with
   `--force --reason "<why>"`, which the sidecar records; never repeat a paid take silently. At most
   **3 iterate rounds** per run; after that stop and report the residue.

### review

Assemble **one** judge bundle and hand it to `kk:content-judge` with the `music-quality` rubric. The
judge reads measurements; it never re-derives them.

1. **Prerequisite** (fail loud) — brief `<nn>`, its prompt text, the take, its `.take.json` sidecar,
   the instance analysis and the take's `checks.json` must all exist. A missing input is a stop with
   the exact missing path, never a bundle with a hole in it. If `checks.json` carries a `fail`,
   **stop before judging**: the take is not judgeable (a missing `analysis.present` row means the
   analyze step has not reached the check yet — run `kk music analyze` for that instance id and
   re-run `kk music check`).
2. **Assemble** `4-judge-input.md` — the bundle contract in `references/judge-input.md`: the brief
   YAML, the kk prompt text, the lyrics, the instance analysis and `checks.json` **verbatim**, in that
   order, plus a provenance block (take path, `content_ref`, digest, instance id, model, spend).
   Verbatim means pasted, not summarised, and never re-typed: measurements are only trustworthy if
   they are the file the tool wrote.
3. **Dispatch the judge** — `Skill(skill="kk:content-judge")` with `rubric: music-quality`,
   `content_path: 4-judge-input.md`, `content_ref: <take path>`, `verdict_path:
   4-verdict-music.json`. The rubric lives at
   `plugins/kk/skills/content-judge/references/music-quality-rubric.md`; the verdict is the existing
   contract — `verdict`, `confidence`, `rubric: "music-quality"`, `findings[].criterion`, `content_ref`
   — with no new field, no second verdict file.
4. **Gate** — route on the verdict, and say the routing out loud: `PASS` (with a `HIGH`/`MEDIUM`/
   `LOW` confidence — the gate refuses a `PASS` without one) → the take may go to `kk music master`;
   `NEEDS_REVISION` → exactly one more `iterate` round if the budget allows, quoting the verdict's
   `feedback`; `FAIL` → stop, surface the finding, and re-brief. The verdict is the deliverable even
   when it blocks.
5. **Resume** — `4-judge-input.md` whose inputs are unchanged (same digest, same checks file) is
   reused as-is; if any input changed, rebuild it in full. Never hand-edit a bundle or a verdict to
   change an outcome — a `fail` row is a measurement, not an opinion.

## The judge bundle

Five verbatim inputs, one provenance block, one path passed to the judge — see
`references/judge-input.md` for the template, the section ids and the assembly commands.

| Section id | Content | Source |
| --- | --- | --- |
| `brief` | the `MusicBrief` YAML of the judged take | `1-brief/brief-<nn>.yaml` |
| `prompt` | the kk-rendered prompt text the model receives | `1-brief/brief-<nn>.prompt.txt` |
| `lyrics` | the lyric text and language, or "instrumental / model-authored, not in the bundle" | `2-lyrics.md`, brief `language` |
| `analysis` | the instance analysis object for that instance id | `3-takes/analysis-<instanceId>.json` |
| `checks` | `checks.json` verbatim — the measured facts, each row with `unit` and `source` | `<take>.checks.json` |
| `provenance` | take path, digest, instance id, model, unit price spent, run id | `<take>.take.json` |

## Spend

| Verb | Paid | Guard |
| --- | --- | --- |
| `render` / `presets` / `library` / `check` / `master` | no | never opens a socket (`check`/`master` spawn local ffmpeg only) |
| `gen` | yes — per take | estimate printed, `--yes` required, `music.takesCap` (default 2, max 4), digest dedupe, `--force --reason` to re-pay |
| `analyze` | yes — per instance id | estimate printed, `--yes` required, cache-first on the instance (a cached analysis is free) |

Budget a run as `directions × unit price + iterations × unit price`. Say the number before asking
for `--yes`; `KK_MUSIC_DRY_RUN=1` is the free rehearsal path (offline adapter, zero network, a silent
1-second WAV that will fail `duration.*` — that is the adapter, not a real take).

## Resume an existing run directory

- **Never re-pay** — a take with a sidecar is adopted. The dedupe is scoped to the run directory, so
  the same brief in another run directory is a legitimate re-roll.
- **Never overwrite** an approved brief, lyric sheet or verdict without `--force` (verdicts: never).
- **Never re-author** a step whose artifact exists and is approved; report it as final instead.
- Resume point by operation: `brief` → the highest existing `brief-<nn>.yaml`; `lyric` → `2-lyrics.md`;
  `iterate` → the highest brief **and** a `checks.json` for its take; `review` → rebuild
  `4-judge-input.md` if any input is newer than it, else reuse it.

## References

- **`references/judge-input.md`** — the `4-judge-input.md` bundle contract, section ids and the exact
  assembly commands.
- `plugins/kk/skills/content-judge/references/music-quality-rubric.md` — the `music-quality` rubric
  this skill's `review` operation hands over.
- `plugins/generations/music-gen/README.md` — the `MusicBrief` authoring form and the preset index
  (the only schema is `plugins/generations/music-gen/src/brief.ts`).
- `docs/design/music-gen.md` — the wire contract, render order, resolution precedence and the
  provenance of every instance fact quoted in "The instance's real limits".
