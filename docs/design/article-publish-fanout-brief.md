# Article generation + publish fan-out brief

Task 0091 (`wayfinder:research`) companion — the frozen three-part brief consumed by the
implement tasks that graduate after this ticket. Non-production; no plugin code, no templates, no
workflow YAML changes. This file carries the full brief; the SSOT copy lives in the `## Solution`
section of `docs/tasks/0091_article-generation-publish-fan-out-incl-podcast-show-notes.md`.

Platform scope (map F61, locked): v1 article platform = **surfdash only**; podcast carries the
article as episode show notes. Extra `*-pub` plugins are noted only for how they slot in later;
they are not designed for here.

---

## 1. Article generator home

**Decision: extend the existing `content-gen` generator. Do NOT create a new `article-gen` plugin.**

Evidence (extends 0088, does not re-own it):

- 0088 disposition row **2.2 article = `extend`**: "`content-gen` generator plugin exists … but
  `kk-daily-ai-voice.yaml` never invokes it" (`docs/tasks/0088_gap-analysis-…-pip.md` disposition
  table). 0088's article home recommendation is `content-gen`, wired as a new `article` state.
  Task 0091 inherits that; no conflict.
- `content-gen` owns the generator-plugin contract end-to-end: manifest `kind: generator`,
  `entry ./src/index.ts` (`plugins/generations/content-gen/plugin.json:2`), description = "owned
  STORM pipeline (curation, outline, article, polish) … `Doc[]` → `Content`".
  `processGeneratorIO` (`plugins/generations/content-gen/src/index.ts:29`) parses `DocListSchema`,
  runs `generateWithStormPipeline`, writes validated `ContentSchema` to `--out`.
- The STORM pipeline already produces the grounded article: `generateWithStormPipeline`
  (`plugins/generations/content-gen/src/storm.ts`) runs curation → outline → article → polish
  through an injected `spur agent run` stage runner, with allowed-doc-id enforcement
  (`assertKnownEvidence`), citation-preservation check (polish), and maps to `Content` with `body`
  (markdown), `format: 'markdown'`, `outline`, `references` (from doc `sourceUri`), and provenance
  `metadata = { generator: 'kk:storm', stageCount: 4, docIds }`.
- A new `article-gen` would duplicate the grounding, citation validation, and provenance machinery
  for zero gain.

**Template approach (named, not authored).** `content-gen` is agent-driven synthesis (STORM), not a
string-template renderer — there is currently no template parameter (`processGeneratorIO` takes only
`--in`/`--out`, `plugins/generations/content-gen/src/index.ts:33-38`). The map's standing preference "article + script are
template-based so generation is fine-tunable" (`docs/features/F61_….md` Notes → Standing
preferences) is satisfied as an **additive, loadable template input to `content-gen`** — a template
handle passed on the invoke payload (e.g. `metadata.template` or a `--template` flag read by the
article/polish stage) that shapes the article skeleton (heading order + section framing + frontmatter)
into which the STORM-authored sections are rendered. Template authoring stays downstream (task
anti-pattern; payload/surface belongs under `docs/04_DESIGN.md` T3 when implemented). Precedent
exists in the pipeline: `script`/`voice` flow reads template-driven inputs, and the same
fine-tunable intent applies here — but the home is `content-gen`, never a second generator.

**Consequence for the publish half:** the consumer treats the article as `content-gen`'s `Content`
(`format: markdown`, `body`) and feeds it to the fan-out below.

---

## 2. Podcast show-notes capability

**Disposition: the show-notes capability is WIRED. The gap is wiring/configuration, not a
plugin-capability gap.** (Confirms 0088's P3 correction; 0088's "not yet satisfied by podcast-pub"
wording is superseded.)

Evidence:

- `plugins/publishings/podcast-pub/src/map.ts` — `mapContentToEpisode` returns
  `contentHtml: content.body`; the `EpisodeMapping` interface comment names it "Episode show notes:
  `content.body` verbatim (microfeed sanitizes server-side)". So the article body → microfeed item
  body field `content_html` is already mapped.
- `plugins/publishings/podcast-pub/src/index.ts:106,121,137` pass `content_html: episode.contentHtml`
  on every `createItem`/`updateItem` call (both the hosted-audio single-call path and the two-phase
  upload path).
- Target platform supports show notes: microfeed `apiItemInputSchema` =
  `{ title, content_html, status, attachments }` (`docs/design/podcast-pub.md` §3 Create item
  `POST /api/v1/items`; decision D6 "`body` (markdown) → `content_html`"). In microfeed,
  `content_html` is the item body/description → the RSS enclosure description / episode show notes,
  with `attachments[0]` (`category: 'audio'`) the enclosure (RSS / JSON Feed).

**Gap (named) — wiring/config, four seams, none a capability gap:**

1. No workflow state invokes `podcast-pub`. The workflow currently ends `quality-control → done`
   (`plugins/kk/workflows/kk-daily-ai-voice.yaml:86-94`, transition `:154-155`); there is no publish
   state.
2. The article `Content` alone carries no audio reference. `mapContentToEpisode` throws "audio
   reference is required" unless `metadata.audioUrl` or `metadata.audioFile` is present
   (`plugins/publishings/podcast-pub/src/map.ts:60-66`); `content-gen` emits `format: 'markdown'`
   `Content` with no audio metadata.
3. Field-name seam in the audio handoff: the audio producer `voice-gen` emits `metadata.audioPath` /
   `metadata.mp3Path` (`plugins/generations/voice-gen/src/index.ts:203-223`), while `podcast-pub`
   reads `metadata.audioFile` / `metadata.audioUrl` (`plugins/publishings/podcast-pub/src/map.ts:55-58`).
   The publish wiring must map
   voice-gen's local `mp3Path` → podcast-pub's `audioFile` (plus `metadata.durationSeconds`).
4. microfeed config must be present: `MICROFEED_BASE_URL`, `MICROFEED_API_KEY`
   (`docs/design/podcast-pub.md` §5 D4); optional `MICROFEED_TIMEOUT_MS` /
   `KNOWLEDGE_KIT_PUBLISH_TRANSPORT`.

**Residual-risk caveat (verify step, not a blocker).** `podcast-pub` passes `content.body` (markdown)
verbatim as `content_html`; the field is named `_html` and the plugin comment says "microfeed
sanitizes server-side." Whether microfeed renders markdown → HTML (or expects HTML) is not
independently verified within the frozen read set (`vendors/microfeed` source is absent). If
microfeed expects HTML, the publish wiring may need a markdown→HTML transform before feed — flag as a
deploy-time smoke check, not a capability gap.

---

## 3. Fan-out shape (v1: podcast-pub + surfdash-pub)

**Recommendation: ONE `kk executor fan-out` subcommand (a single workflow `publish` state), NOT N
sequential per-target states.**

Evidence:

- `docs/design/fan-in-and-fan-out-specification.md` §1.1:
  `kk executor fan-out --content <content.json> --target <p1> [--target <p2> …] --out <result.json>
  [--retry-from <prior-result.json>]` — repeatable `--target`, sibling of `executor run`.
- §3.1 `AggregateResult` collects per-target outcomes (`published`/`failed`/`skipped`); §4 exit-code
  contract: all-success → `0`, partial-success → `1` (fail-loud while per-target outcomes record the
  partial win), all-failed → `1`; §5 `--retry-from` resumes only the failed/un-attempted targets.
- The workflow engine executes one node at a time, so fan-in/fan-out are `kk` subcommands, never
  engine states (`docs/design/fan-in-and-fan-out-specification.md` §1.1; `03_ARCHITECTURE.md`; F61
  map Architecture constraints).

**v1 shape:** a single workflow `publish` state runs:

```bash
kk executor fan-out \
  --content 22-article/content.json \
  --target surfdash-pub \
  --target podcast-pub \
  --out 31-publish/result.json
```

Partial success → exit `1` → fail-loud signals an incomplete pipeline state to `spur workflow` while
the per-target `AggregateResult` records which platform published; `--retry-from 31-publish/result.json`
re-runs only the failed target next morning.

**Why sequential per-target states were rejected:** N separate `*-pub` states re-implement the
aggregation / partial-success / resume contract in workflow YAML, split the publish contract across N
states (each needing its own guard + retry), and lose the `AggregateResult` schema — exactly what the
spec exists to avoid. `podcast-pub` (needs audio + `MICROFEED_*`) and `surfdash-pub` (needs
`postsurfing` CLI) fail independently, so the partial-success + resume contract is required.

**How more `*-pub` plugins slot in later (note only, no design):** add another repeatable
`--target <plugin>` to the same `publish` state (e.g. `--target zenn-pub`). No new state, no workflow
YAML structure change, no engine change. 0088's extension-plan `publish_targets` var must expand to
repeatable `--target` flags as targets grow (0088 review P6); do not design for platforms beyond
surfdash/podcast in v1 (map decision).

---

## Handoff

0092+ implement tasks consume: R1 → article = `content-gen` (+ additive template input); R2 →
podcast show-notes is wired (`content.body` → `content_html`), gap is the publish wiring
(audio-reference field mapping + microfeed env + a publish state); R3 → one `kk executor fan-out`
publish state with repeatable `--target`. No production code, no plugin files, no templates, no
workflow YAML touched by this ticket.
