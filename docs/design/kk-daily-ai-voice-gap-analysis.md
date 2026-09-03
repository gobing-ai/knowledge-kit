# kk-daily-ai-voice Gap Analysis vs Ideal End-to-End Daily Pipeline

Companion to **Task 0088** (`docs/tasks/0088_gap-analysis-kk-daily-ai-voice-vs-ideal-end-to-end-daily-pip.md`) on
feature **F61** (`docs/features/F61_daily-ai-news-end-to-end-pipeline-wayfinder-map.md`). Research/evidence only —
**no production code, no YAML edits, no plugin scaffolds.**

## Purpose

Answer the sharp question of Task 0088: what must change in
`plugins/kk/workflows/kk-daily-ai-voice.yaml` (states, vars, guards) and the plugin set to reach the operator's
ideal 3-stage daily flow?

> collect (1.1 last30days, 1.2 Horizon) → blend facts (2.1) → article (2.2) + script (2.3) + cover (2.4) + voice
> (2.5) → publish (3.1 podcast w/ show notes, 3.2 surfdash — sole article platform for v1)

## Disposition semantics

Applied to every row in the table below:

- `exists` — a workflow state now invokes the backing capability (plugin/subcommand); the step is already wired.
- `extend` — the backing capability exists (plugin or shipped `kk` subcommand) but no workflow state invokes it,
  or the wired shape must change (wiring-only / contract-shape gap).
- `missing` — no backing capability exists yet, so a new capability plus a workflow state are needed.

## Disposition table (9 rows, file/line evidence)

| # | Ideal step | Disposition | Evidence (file:line) |
| --- | --- | --- | --- |
| 1.1 | last30days ingest | **missing** | No last30days ingestion plugin. `plugins/ingestions/` holds only `aihot-ingest`, `karakeep-local`, `web-search` (`plugins/ingestions/*/plugin.json`). Workflow `fetch` runs only `kk executor run aihot-ingest` (`plugins/kk/workflows/kk-daily-ai-voice.yaml:46`). Source is a skill, not a plugin: `~/.agents/skills/last30days` (`docs/features/F61_daily-ai-news-end-to-end-pipeline-wayfinder-map.md:57`). |
| 1.2 | Horizon crawl | **missing** | No Horizon ingestion plugin in the same set; source is an external CLI `(cd ~/tools/Horizon && uv run horizon)` (`F61…map.md:57`), not wrapped as a plugin. |
| 2.1 | blend facts | **missing** (stage) — merge subcommand exists | No blend workflow state and no core-facts contract/template in `kk-daily-ai-voice.yaml`. The merge tool ships: `kk executor fan-in` (`docs/design/fan-in-and-fan-out-specification.md:52-55`, shipped under B6/task 0042). The workflow never calls fan-in; the only fanout reference in workflows is `judge-gated-publish-example.yaml:46`. |
| 2.2 | article | **extend** | `content-gen` generator plugin exists (`plugins/generations/content-gen/plugin.json:2`, STORM pipeline → `Doc[]` → `Content`), but `kk-daily-ai-voice.yaml` never invokes it. |
| 2.3 | script | **exists** | `dailynews-gen` is wired: `kk executor run dailynews-gen` (`kk-daily-ai-voice.yaml:56`); plugin `plugins/generations/dailynews-gen/plugin.json:2`. |
| 2.4 | cover | **missing** | No `cover-gen` in `plugins/generations/` (only `content-gen`, `dailynews-gen`, `voice-gen`). Cover path is open in the map: `wt-image-cover` skill vs `cover-gen` plugin (`F61…map.md:64`). |
| 2.5 | voice | **exists** | `voice-gen` is wired: `kk executor run voice-gen` (`kk-daily-ai-voice.yaml:84`); plugin `plugins/generations/voice-gen/plugin.json:2`. |
| 3.1 | podcast publish w/ show notes | **extend** | `podcast-pub` publish plugin exists (`plugins/publishings/podcast-pub/plugin.json:2`), but the workflow terminates at `quality-control → done` (`kk-daily-ai-voice.yaml:154-155`) with no publish state. `podcast-pub` maps `content.body` → episode show notes (`podcast-pub/src/map.ts:86`), so the capability is wired and the gap is workflow publish wiring (`F61…map.md:48-49`). |
| 3.2 | surfdash publish | **extend** | `surfdash-pub` publish plugin exists (`plugins/publishings/surfdash-pub/plugin.json:2`) but is not wired into the workflow; surfdash is the sole article platform for v1 (`F61…map.md:49`). |

Current workflow, for reference: `prepare → fetch(aihot-ingest) → script(dailynews-gen) → review(HITL, skip_review var) →
wrap-docs → generate(voice-gen) → quality-control → done`. No publish step yet (`F61…map.md:55`).

## Gaps + recommended homes

Every home is consistent with `docs/design/fan-in-and-fan-out-specification.md`: fan-in/fan-out are `kk` subcommands
(see §1.1), never engine states. `kk` owns steps; `spur workflow` owns orchestration — never the reverse.

### Missing capabilities (new capability + a workflow state)

- **1.1 last30days ingest** — **ingestion plugin** (new `last30days-ingest`, kind `ingestion`) + new workflow state
  `kk executor run last30days-ingest`. Wrap the skill output as `Doc[]`, registered through multi-root discovery
  (ADR-012), keeping executor-run uniform. Task 0089 wraps it.
- **1.2 Horizon crawl** — **ingestion plugin** (new `horizon-ingest`, kind `ingestion`) + new workflow state
  `kk executor run horizon-ingest`. Task 0089 wraps it.
- **2.1 blend facts** — **`kk executor fan-in` (kk subcommand)** for the N-source `Doc[]` merge, invoked from a new
  workflow state `blend-facts`; the merged `Doc[]` → single core-facts markdown `Content` render is a **generator**
  whose contract + template Task 0090 prototypes. Merge home is the `fan-in` subcommand; the facts render is a
  generator. Not an engine state — the workflow state only wraps the subcommand. **(This is the blend-home
  recommendation Task 0090 consumes.)**
- **2.4 cover image** — **generation plugin** (new `cover-gen`, kind `generation`) + a workflow state
  `kk executor run cover-gen`. Alternative is the `wt-image-cover` skill, but a skill is not a plugin the executor
  invokes, so a `cover-gen` generator keeps the pipeline plugin-uniform. Style/branding template is genuinely
  unspecified (`F61…map.md:64` — map fog, out of scope here).

### Extend gaps (existing capability, needs wiring)

- **2.2 article** — **generator plugin** `content-gen`, wired as a new `article` state consuming the blended /
  core-facts file. Consumed by 0091.
- **3.1 / 3.2 publish** — **`kk executor fan-out` (kk subcommand)** in a new `publish` state, with targets
  `podcast-pub` and `surfdash-pub` (v1 = surfdash; podcast carries the article as episode show-notes). Consumed by
  0091.

## Extension plan sketch (proposals — NOT applied)

For `plugins/kk/workflows/kk-daily-ai-voice.yaml`, the superset shape extends the current linear flow into:
`collect` → `blend` → `generate` (article / cover / script / voice) → `publish`. Proposed **new vars** (add to the
`vars:` block):

```yaml
  last30days_enabled: "true"   # gate source 1.1
  horizon_enabled: "true"      # gate source 1.2
  article_enabled: "true"      # gate article (2.2)
  cover_enabled: "false"       # gate cover (2.4); off until cover-gen exists
  publish_enabled: "false"     # gate publish fan-out (3.x); off until ready
  publish_targets: "surfdash"  # 1..N fan-out target names (v1: surfdash; add podcast)
  article_title: ""            # content-gen input (template-driven)
  article_template: ""         # content-gen input (template-driven)
```

Proposed **new state ids** (linear, single-node; each wraps a `kk` subcommand — no engine-level fan-in/out):

1. `ingest-last30days` → `kk executor run last30days-ingest --in … --out …/1-ingest/last30days.json`
2. `ingest-horizon` → `kk executor run horizon-ingest --in … --out …/1-ingest/horizon.json`
3. `blend-facts` → `kk executor fan-in --in 1-ingest/last30days.json --in 1-ingest/horizon.json --in 1-ingest/docs.json --out 1-ingest/blended.json` (then facts render → core-facts markdown, 0090)
4. `article` → `kk executor run content-gen --in 1-ingest/blended.json --out 2-article/content.json`
5. `cover` → `kk executor run cover-gen --in 1-ingest/blended.json --out 2-cover/content.json`
6. `script` (existing) → change `--in` to `1-ingest/blended.json` (facts file) instead of `docs.json`
7. `generate` (existing `voice-gen`) → unchanged
8. `quality-control` (existing) → unchanged
9. `publish` → `kk executor fan-out --content 2-article/content.json --target <publish_targets> --out result.json`

Proposed **transition sketch**: `prepare → ingest-last30days → ingest-horizon → blend-facts → article → cover →
script → wrap-docs → generate → quality-control → publish → done`; the existing `review` (HITL) state is retained
between `script` and `wrap-docs`, with `skip_review` defaulting to `"true"` for an unattended daily run (proposal
only — HITL persistence in the unattended run is a not-yet-specified map item).

> All new ids/vars above are **proposals** for discussion; nothing here bumps or edits `kk-daily-ai-voice.yaml`.
> No scheduling, no judge gate, no cover style/branding template (all map fog, out of scope).

## Handoff

- **Task 0090 consumes:** the **blend-home recommendation** — blend-facts = `kk executor fan-in` (kk subcommand)
  for the N-source `Doc[]` merge, plus a generator (contract + template) that renders the merged facts into a single
  core-facts markdown `Content`. 0090 prototypes that contract + template; the merge home is the `fan-in` subcommand
  per the fan-in/fan-out spec.
- **Task 0091 consumes:** the **article-generator disposition** (2.2 = `content-gen`, extend — wire as a new
  `article` state consuming the core-facts file) and the **publish dispositions** (3.1 = `podcast-pub` +
  3.2 = `surfdash-pub`, both extend via `kk executor fan-out`, with the article passed as podcast episode show-notes
  content shape; surfdash remains the sole article platform for v1).

## References

- `plugins/kk/workflows/kk-daily-ai-voice.yaml` · `docs/design/kk-daily-ai-voice.md`
- `docs/design/fan-in-and-fan-out-specification.md`
- `docs/features/F61_daily-ai-news-end-to-end-pipeline-wayfinder-map.md`
- `plugins/{ingestions,generations,publishings}/*/plugin.json`
