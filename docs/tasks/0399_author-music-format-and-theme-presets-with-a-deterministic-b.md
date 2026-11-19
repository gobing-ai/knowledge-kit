---
schema_version: 1
name: Author music format and theme presets with a deterministic brief renderer
status: done
template: feature-impl
created_at: 2026-11-18T22:16:14.918Z
updated_at: "2026-11-19T06:53:30.541Z"
feature_id: D8

ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 8
dependencies: ["0398"]
done_forced: "false"
done_reason: unforced close
---

## 0399. Author music format and theme presets with a deterministic brief renderer

### Background

Implements: R1 — format presets; R2 — theme presets; R3 — resolution reuses 0397 R4; R4 — evidence discipline; R5 — preset index doc.

`image-gen` established the platform pattern for creative presets: a format (canvas/template/job) composes with a style (visual modifiers), resolution is a pure function, presets are data files with an index README, and imported candidates stay "generation-pending" until a real generation review promotes them (feature K3, `plugins/generations/image-gen/src/presets.ts`). Music needs the same shape — but its axes are different: a **format** fixes the job's intent and structural skeleton (song vs 30-second clip vs jingle), while a **theme** supplies the technical direction prose the model actually reads (genre, BPM range, key, instrumentation, vocal character, production, avoid list).

Nothing here may name a provider, a base URL, or an API model id: the instance maps `pro|clip` to `lyria-3-pro-preview`/`lyria-3-clip-preview`, and presets must survive a future provider swap unchanged (feature R2).

### Requirements

- [x] R1. Ship format presets as data: `song` (pro, 2:30 default target, full section skeleton), `clip` (clip model, no duration target, ~0:30 by model), `jingle` (pro, 0:20 target), `loop` (clip, no vocal), `underscore` (pro, instrumental bed, no hook requirement). Each declares model, default duration target (pro only), structure skeleton with timestamps, and lyrics policy (allowed/forbidden). No price field: prices are provider-specific and live in user config (0400).
- [x] R2. Ship theme presets as data with the technical-direction segment, default `avoid[]`, vocal-character guidance, and an instrumentation palette. The first set is bounded to `cinematic`, `lofi`, `synthwave` and `ambient-tech`. `corporate-tech` and `xhs-pop` are reserved for a later evidence round and are not shipped. No theme may claim a quality result it has not produced.
- [x] R3. Implement resolution as the pure function frozen in 0397 R4 (brief → workflow preset → theme → format → built-in). An unknown name fails with a non-zero exit and no silent fallback, and a printed explanation lists every source that contributed.
- [x] R4. Enforce evidence discipline on preset files: a provenance block (authoring source, date, status `authored | evidence-pending | verified`), no provider/model/price keys, and a schema check that rejects them. The loader test matrix includes one deliberately invalid file per rule.
- [x] R5. Render the preset index: `plugins/generations/music-gen/README.md` lists every format and theme with its intended use and status. A script generates it, so the index cannot drift from the data files.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Format presets fix structure without pinning the provider (req: R1, R4)
  Given the five shipped format presets
  When each is loaded
  Then each declares model, structure skeleton and lyrics policy, and every pro format declares a duration target
  And no file contains a provider, base URL, API model id or price
  And the clip and loop formats resolve to a request with no durationTarget

Scenario: AC2 — Themes carry the technical direction the model reads (req: R2)
  Given a theme preset
  When it is rendered into a brief
  Then its prose covers genre, tempo, key, instrumentation, vocal character and production
  And its default avoid-list is rendered as one `Avoid: …` segment
  And its status is one of authored / evidence-pending / verified

Scenario: AC3 — Precedence is deterministic and explained (req: R3)
  Given a brief, a workflow preset, a theme and a format that each set duration and lyrics policy
  When the job is resolved
  Then the 0397 precedence decides each field and the CLI prints which source won
  And an unknown format or theme name exits non-zero listing the valid names

Scenario: AC4 — Invalid preset files are rejected with a reason (req: R4)
  Given preset files that declare provider, model id, price, unknown status, or a missing provenance block
  When the loader runs
  Then each is rejected with a field-specific error naming the file
  And no partially loaded preset reaches the renderer

Scenario: AC5 — The index matches the data (req: R5)
  Given the shipped presets
  When the index generator runs in check mode
  Then the README table equals the preset inventory and the check fails on drift
  And each row shows use case, status and default duration
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- **Bound the first set.** 5 formats × 4 themes = 20 combinations, but only the pairs a workflow actually uses need a real generated sample. The rest ship as `authored`. K3's lesson: bulk import without generation review produces presets nobody can trust.
- **Structure skeletons belong to formats, not themes.** A theme that dictated arrangement would fork into one theme per genre. The format owns the arc and the theme owns the sound.
- **`avoid[]` is prompt text.** Lyria 3 has no `negative_prompt` parameter, so the renderer emits a single `Avoid: a, b, c` segment. Themes supply defaults, briefs override, and the segment is dropped when the merged list is empty.
- **Clip formats skip structure timestamps past 0:30.** Clip is fixed at about 30 s, so a `clip`/`loop` skeleton longer than that is rejected by the loader instead of being sent as text the model cannot honour.
- **Index generator, not a hand-maintained table.** `image-gen/scripts/gen-samples.ts` showed that hand-maintained preset docs drift. Check mode makes drift a test failure.
- **Prices removed from presets (closed 2026-11-18).** A price is a fact about the provider path (Gemini vs OpenRouter), not about the musical format. Keeping it here would break the "presets survive a provider swap unchanged" rule. Prices live in 0400's config block.
- **Dependency.** Blocked by 0398. Does not block 0400.
- **Estimate.** 8h: 5 formats + 4 themes + resolver + loader validation + index generator + tests.

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

Implements R1–R5 on top of the frozen 0397 surface: the shipped format × theme preset data, a loader that enforces portability + provenance + evidence status uniformly for every data file, name-based resolution that reuses `resolveJob` instead of forking it, and a generated README index. No change to 0397's precedence, goldens, request mapping or prompt order.

#### Change map

| File:line | Change | Why |
| --- | --- | --- |
| `plugins/generations/music-gen/presets/formats/song.yaml:1` | Format: `pro`, `2:30`, six timestamped sections, `lyrics_policy: allowed` | R1 — full song owns the arc; duration target only where the model honours it |
| `plugins/generations/music-gen/presets/formats/clip.yaml:1` | Format: `clip`, no `duration_target`, three sections ending at `0:26`, lyrics allowed | R1 — clip is fixed at ~0:30 and ignores duration, so declaring one would be a lie |
| `plugins/generations/music-gen/presets/formats/jingle.yaml:1` | Format: `pro`, `0:20`, hook/tag/resolve skeleton, lyrics allowed | R1 — ident hook states the name once and resolves fast |
| `plugins/generations/music-gen/presets/formats/loop.yaml:1` | Format: `clip`, no duration target, `lyrics_policy: forbidden`, loop-point skeleton | R1/R2 — a loop bed is instrumental by definition (`forbidden` → `instrumental: true`) |
| `plugins/generations/music-gen/presets/formats/underscore.yaml:1` | Format: `pro`, `0:45`, `lyrics_policy: forbidden`, no hook section | R1 — instrumental bed under narration; the arc withholds a melodic foreground |
| `plugins/generations/music-gen/presets/themes/cinematic.yaml:1` | Theme: genre/tempo/key/instrumentation/vocal/production fields + `style` prose + `avoid[]` + provenance | R2 — orchestral hybrid direction with a real deny-list |
| `plugins/generations/music-gen/presets/themes/lofi.yaml:1` | Theme: dusty sampled lo-fi, 70-85 BPM, A minor | R2 |
| `plugins/generations/music-gen/presets/themes/synthwave.yaml:1` | Theme: analog synth revival, 90-110 BPM, A minor | R2 |
| `plugins/generations/music-gen/presets/themes/ambient-tech.yaml:1` | Theme: glassy ambient techno, 100-115 BPM, C# minor | R2 |
| `plugins/generations/music-gen/presets/SOURCE.md:1` | Provenance + evidence-promotion rules; records why `corporate-tech`/`xhs-pop` are not shipped | R2/R4 — no preset claims a result it has not produced; K3's lesson made explicit |
| `plugins/generations/music-gen/src/presets.ts:470` | `PRESET_STATUSES` + `PresetStatus` | R4 — one closed enum for evidence status |
| `plugins/generations/music-gen/src/presets.ts:484` | `PresetProvenanceSchema` (`authoring_source`, `authored_at` `YYYY-MM-DD`, `status`, optional `evidence`), strict | R4 — a preset without provenance cannot say where it came from; matches the 0397 `valid-format.preset.yaml` fixture shape |
| `plugins/generations/music-gen/src/presets.ts:504` | `MusicFormatPresetSchema`: name/description/intended_use/model/duration_target/lyrics_policy/structure/avoid/provenance, strict + superRefine | R1 — `pro` requires a duration target, `clip` forbids one, structure must not exceed the clip ~0:30 ceiling or the format's own target, timestamps non-decreasing |
| `plugins/generations/music-gen/src/presets.ts:592` | `MusicThemePresetSchema`: the six technical-direction facets, `instrumentation[]`, `style`, non-empty `avoid[]`, provenance, strict | R2 — the theme owns the sound and nothing else (no arrangement, no model) |
| `plugins/generations/music-gen/src/presets.ts:621` | `themeDirectionGaps(theme)` | R2/AC2 — Lyria has no tempo/key/instrumentation parameter, so a facet missing from the prose does not reach the model; the loader rejects the mismatch |
| `plugins/generations/music-gen/src/presets.ts:658` | `PresetDataError` (`exitCode 2`, `problems[]` of `{path, field, message}`) | R4/AC4 — one aggregated, file- and field-specific rejection; nothing partially loaded escapes |
| `plugins/generations/music-gen/src/presets.ts:673` | `MUSIC_PRESET_ROOT` | R5 — the shipped root the loader and the index generator share |
| `plugins/generations/music-gen/src/presets.ts:697` | `readPresetFiles()` — reuses 0397's `parsePresetDocument` (so `assertPresetPortable` runs on every file) and converts violations to `{path, field}` problems | R4 — the forbidden-key check is enforced uniformly for data files, not re-implemented |
| `plugins/generations/music-gen/src/presets.ts:739` | `collectPresets()` — schema parse, name/file-stem identity, duplicate names, per-axis `inspect` hook | R4 — a file whose `name` disagrees with its filename would make the index silently wrong |
| `plugins/generations/music-gen/src/presets.ts:794` | `loadMusicPresets({root?, fileSystem?})` — fail closed, all problems reported at once | R4/AC4; the `root` override is the seam tests and probes use so they never touch the shipped corpus |
| `plugins/generations/music-gen/src/presets.ts:828` | `presetLayerForFormat()` — `model`, `duration_target`, `lyrics_policy`, `structure`, `avoid` | R3 — a format is the lowest preset layer, expressed as the 0397 `PresetLayer` |
| `plugins/generations/music-gen/src/presets.ts:840` | `presetLayerForTheme()` — `style` prose + `avoid` only | R2/R3 — the theme never supplies model, duration or instrumental |
| `plugins/generations/music-gen/src/presets.ts:849` | `UnknownPresetError` (`exitCode 1`, `validNames`, `trace`, `report`) | R3 — an unknown name fails non-zero, lists the valid names and carries the `explainJob` trace |
| `plugins/generations/music-gen/src/presets.ts:891` | `resolveNamedJob(brief, presets, {workflow?})` — looks up the two names, then calls the unmodified `resolveJob` | R3 — resolution stays the frozen 0397 pure function; this only maps names → layers and fails loudly |
| `plugins/generations/music-gen/src/index.ts:64` | Export the new surface (`loadMusicPresets`, both schemas, `resolveNamedJob`, `UnknownPresetError`, `PresetDataError`, `themeDirectionGaps`, …) | 0401's CLI wraps these, so they must be public |
| `plugins/generations/music-gen/scripts/gen-preset-index.ts:57` | `renderPresetIndex()` — the format + theme inventory tables | R5 — one table source, no hand-maintained rows |
| `plugins/generations/music-gen/scripts/gen-preset-index.ts:83` | `splicePresetIndex()` — writes between `<!-- preset-index:start/end -->`; missing markers is a hard error | R5 — no silent append, no duplicated tables |
| `plugins/generations/music-gen/scripts/gen-preset-index.ts:101` | `checkPresetIndex()` + `--check` in `main()` (`:133`) — drift report names the first differing lines, exit 1 | R5/AC5 — drift is a test failure and a CI failure |
| `plugins/generations/music-gen/scripts/resolve-preset.ts:25` | `resolve-preset.ts --in <brief.yaml> [--root] [--json]` — prints the trace, exits 0/1/2 | R3 — the exit-code surface 0401 wraps, and the probe below drives it |
| `plugins/generations/music-gen/package.json:10` | `gen:preset-index`, `check:preset-index`, `resolve-preset` scripts | Repo-idiomatic invocation (image-gen `scripts/*.ts` precedent), no shell scripts |
| `plugins/generations/music-gen/README.md:113` | Generated index block between the markers, replacing the placeholder table | R5 — the README is the preset index |
| `plugins/generations/music-gen/tests/preset-data.test.ts:56` | AC1 — five formats, model/skeleton/lyrics policy, clip+loop → no `durationTarget` on the wire, no provider/model-id/price in any file | AC1 |
| `plugins/generations/music-gen/tests/preset-data.test.ts:114` | AC2 — every facet present in the prose, one `Avoid: …` segment, status enum, no `verified` claim, `corporate-tech`/`xhs-pop` absent | AC2 |
| `plugins/generations/music-gen/tests/preset-data.test.ts:167` | AC3 — 0397 precedence unchanged over the data, unknown format/theme spawns exit 1 with valid names + trace | AC3 |
| `plugins/generations/music-gen/tests/preset-data.test.ts:244` | AC4 — one deliberately invalid file per rule (provider, model id, price, unknown status, missing provenance, clip skeleton past 0:30, prose gap), all aggregated with file + field; valid control files report nothing | AC4 |
| `plugins/generations/music-gen/tests/preset-data.test.ts:322` | AC5 — README equals the inventory, markers present, drift detected in a temp copy, splice idempotent, missing markers throws | AC5 |
| `plugins/generations/music-gen/tests/fixtures/preset-roots/invalid/*` | Fixture roots: one invalid file per rule + one valid control file per axis | AC4 |

#### Rationale

- **Reuse, not fork.** `resolveJob`, `explainJob`, `parsePresetDocument`, `assertPresetPortable`, `PresetLayer` and `PresetContractViolation` are untouched; 0399 adds schemas, a loader and a name→layer adapter on top. The 0397 goldens and the `parseMusicPresetDocument`/portability tests still pass byte-identically.
- **The loader enforces, the schema describes.** Portability is enforced by the existing `assertPresetPortable` walk (so nested `transport.base_url` is still caught), the schema covers shape and the format-local invariants, and `themeDirectionGaps` covers the one cross-field rule the schema cannot see: prose coverage. All three report `{path, field, message}` and the loader throws once with every problem — AC4's "no partially loaded preset reaches the renderer".
- **Clip is a ceiling, not a default.** A `clip` format may not declare `duration_target` (so clip/loop resolve to *no* `durationTarget`, AC1) and its skeleton may not pass 0:30, because the model ignores duration text it cannot honour.
- **Evidence is a closed vocabulary.** `authored | evidence-pending | verified`, with `verified` needing an `evidence` note; every shipped file is `authored`, and `corporate-tech`/`xhs-pop` stay out (`presets/SOURCE.md` records why). No preset claims a quality result it has not produced.
- **The index is generated.** `renderPresetIndex`/`splicePresetIndex` are pure and `--check` compares bytes, so a new data file that is not indexed fails the same test that proves the index matches.
- **The loader takes a `root` override.** Tests and the probe point it at a throwaway tree; a missing root is a problem, not an empty set.

#### AC interpretation

- **AC1** — "each declares model, structure skeleton and lyrics policy, and every pro format declares a duration target": asserted per shipped format, plus `renderGenerateRequest` proves clip/loop carry no `durationTarget` and pro formats carry theirs. "No provider, base URL, API model id or price" is asserted twice: by the loader (fixtures) and by a raw-text scan of every shipped YAML.
- **AC2** — "its prose covers genre, tempo, key, instrumentation, vocal character and production": the structured facets exist *and* must appear verbatim in `style`, which is the segment the model reads. "Its default avoid-list is rendered as one `Avoid: …` segment": asserted on the rendered prompt, including the merge with a brief-level `avoid`.
- **AC3** — "the 0397 precedence decides each field and the CLI prints which source won": `explainJob` lines are asserted for brief > workflow > theme > format over real presets, and a spawned process proves the unknown-name path exits 1, lists valid names and prints the trace.
- **AC4** — "each is rejected with a field-specific error naming the file": seven invalid files assert `{field, message}` per rule and that the valid control files in the same root contribute nothing.
- **AC5** — "the README table equals the preset inventory and the check fails on drift": `checkPresetIndex()` on the shipped tree plus a temp copy with an added format that must drift, and the idempotent splice.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — format presets as data (`song`, `clip`, `jingle`, `loop`, `underscore`) | MET | `plugins/generations/music-gen/presets/formats/{song,clip,jingle,loop,underscore}.yaml` (model, structure skeleton with timestamps, lyrics policy, pro-only duration target); validated by `plugins/generations/music-gen/src/presets.ts:504` |
| R2 — theme presets as data (`cinematic`, `lofi`, `synthwave`, `ambient-tech` only) | MET | `plugins/generations/music-gen/presets/themes/*.yaml` (six technical-direction facets + `style` prose, default `avoid[]`, instrumentation palette, provenance); schema `plugins/generations/music-gen/src/presets.ts:592`, facet enforcement `:621`; `corporate-tech`/`xhs-pop` deliberately absent per `plugins/generations/music-gen/presets/SOURCE.md` |
| R3 — resolution reuses 0397 R4, unknown names fail loudly, sources printed | MET | `plugins/generations/music-gen/src/presets.ts:891` (`resolveNamedJob` -> unmodified `resolveJob` at `:282`), `:849` (`UnknownPresetError` lists valid names), `:385` (`explainJob` trace); CLI-facing wrapper `plugins/generations/music-gen/scripts/resolve-preset.ts` |
| R4 — evidence discipline on preset files | MET | provenance schema `plugins/generations/music-gen/src/presets.ts:484` with the status enum at `:470`; portability check `:412`; aggregated failure type `:658` (`PresetDataError`, exit 2, nothing partially loaded) |
| R5 — generated preset index | MET | `plugins/generations/music-gen/scripts/gen-preset-index.ts:108` (`checkPresetIndex`) writes the table into `plugins/generations/music-gen/README.md:113`, `--check` exits 1 on drift |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Format presets fix structure without pinning the provider (req: R1, R4) | MET | test | `plugins/generations/music-gen/tests/preset-data.test.ts:59` (five formats declare model, skeleton, lyrics policy, pro duration), `:77` (clip and loop resolve with no durationTarget), `:86` (pro duration reaches the wire), `:98` (no provider/model-id/base-URL/price string in any shipped file) |
| AC2 — Themes carry the technical direction the model reads (req: R2) | MET | test | `plugins/generations/music-gen/tests/preset-data.test.ts:117` (all four themes state every facet), `:127` (status vocabulary, none claims verified), `:139` (default avoid-list renders as exactly one `Avoid: …` segment), `:159` (theme layer supplies style prose plus avoid only) |
| AC3 — Precedence is deterministic and explained (req: R3) | MET | test | `plugins/generations/music-gen/tests/preset-data.test.ts:170` (0397 precedence decides over preset data), `:191` (unknown format exits non-zero with the valid names and the trace), `:208` (unknown theme), `:232` (no silent built-in fallback); probe: `bun plugins/generations/music-gen/scripts/gen-preset-index.ts --check` -> "preset-index: README matches the shipped presets" |
| AC4 — Invalid preset files are rejected with a reason (req: R4) | MET | test | `plugins/generations/music-gen/tests/preset-data.test.ts:247` (each rule reports a field-specific problem naming the file: provider, model id, price, unknown status, missing provenance, clip skeleton past 0:30), `:278` (portable controls report nothing), `:285` (no partially loaded set escapes) |
| AC5 — The index matches the data (req: R5) | MET | command | `bun plugins/generations/music-gen/scripts/gen-preset-index.ts --check` -> `preset-index: README matches the shipped presets` (exit 0); `plugins/generations/music-gen/README.md:113` carries the generated `formats/`: 5 · `themes/`: 4 table with use case, status and default duration |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

SECUA + traceability review of the preset data layer (`--focus all`, host-inline; independent of the implement session).

| Priority | Finding | Disposition |
| -------- | ------- | ----------- |
| P1 (blocker) | — | none |
| P2 (major) | — | none |
| P3 (minor) | The light quality gate cannot go green from inside the pipeline. `bunfig.toml` enables coverage on every `bun test`, so the gate's own related-test run rewrites `.coverage/lcov.info` with data only for the files that run loaded; `music-gen` imports `@gobing-ai/kk-core`, whose modules then appear partially covered and trip the per-file 90% `coverage-gate`. Observed on 0398 and 0399; every task in this batch pays a fix-lane cycle for it | DEFER(process: the light tier should probe coverage only against a lcov it owns, or skip `coverage-gate` when the receipt's own run wrote it — batch-level finding, not 0399 code) |
| P4 (advisory) | `MUSIC_PRESET_ROOT` resolves via `import.meta.dir + '/../presets'`, the same shape `image-gen/src/presets.ts:302` uses, so it inherits the shipped-bundle behaviour rather than inventing one. It does depend on `bundle-plugins.ts` copying `presets/` into the staged tree — worth one line in the batch report so a future packaging change does not silently orphan the presets | ACCEPTED |
| P4 (advisory) | `themeDirectionGaps` enforces that every facet appears in the theme prose; a facet listed but not phrased in `style` never reaches the model. The check is prose-substring based, so a reworded facet can pass while saying something different in spirit | ACCEPTED |

**Correctness.** Resolution reuses the frozen 0397 `resolveJob`/`explainJob` unchanged (`plugins/generations/music-gen/src/presets.ts:282`, `:385`) — 0399 adds data plus a validating loader, not a second precedence engine. Unknown names exit non-zero naming the valid set and print the source trace (`:849`, `:891`), so there is no silent fallback.

**Data discipline.** Every shipped file carries a provenance block with an `authored` status (`plugins/generations/music-gen/presets/themes/lofi.yaml:18`); `verified` is never claimed without a real generation, and `corporate-tech`/`xhs-pop` are deliberately absent with the reason recorded in `plugins/generations/music-gen/presets/SOURCE.md`. No file names a provider, base URL, API model id or price — enforced both by schema (`FORBIDDEN_PRESET_KEYS`) and by a raw-text scan in the test matrix.

**Drift control.** The README index is generated (`plugins/generations/music-gen/scripts/gen-preset-index.ts:108`) with a `--check` mode that fails on drift; verified clean after the last edit.

**Final disposition.** Approve for `done` — R1–R5 and AC1–AC5 MET; 181 tests pass; typecheck and Biome clean; light gate DEFERRED (batch full gate owes the coverage proof).

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-19T00:14:06.546Z feature_id Q → D8 (system)
- 2026-11-19T06:02:25.601Z backlog → wip (system)
- 2026-11-19T06:53:28.935Z wip → testing (system)
- 2026-11-19T06:53:30.531Z testing → done (system)

