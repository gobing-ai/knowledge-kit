---
schema_version: 1
name: "Article generation + publish fan-out incl. podcast show notes"
status: done
template: feature-impl
created_at: 2026-09-03T04:21:27.667Z
updated_at: "2026-09-03T07:02:03.305Z"
feature_id: F61
dependencies: ["0088"]
---

## 0091. Article generation + publish fan-out incl. podcast show notes

### Background

**Type:** `wayfinder:research` — evidence reading; no production code. Map: feature F61. Blocked by 0088 (needs the gap plan).

**Sharp question:** which generator produces the templated article from core facts (extend `content-gen` vs new `article-gen`), can `podcast-pub` carry the article as episode show notes (decided on map F61: yes — verify the target platform supports it), and what fan-out shape does `docs/design/fan-in-and-fan-out-specification.md` prescribe for the v1 targets (`podcast-pub` + `surfdash-pub`)?

**Platform scope:** v1 article platform = **surfdash only** (map F61 decision); note how additional `*-pub` plugins would slot in later, but do not design for them.

### Requirements

- [x] R1. Article generator home decided (extend `content-gen` vs new plugin) with the template approach named.
- [x] R2. `podcast-pub` show-notes capability verified against its target platform; the gap named if missing.
- [x] R3. Publish fan-out shape recommended (one kk fan-out subcommand vs sequential states) for v1 targets `podcast-pub` + `surfdash-pub`, with a note on how more `*-pub` plugins slot in later.

### Acceptance Criteria

- [x] R1–R3 answered with file-level evidence in `## Solution`.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-03T04:40:24.496Z

- Closed 2026-09-02 (operator): v1 article platform = surfdash only; podcast carries the article as show notes. Remaining unknown — whether microfeed supports show notes — is R2's investigation, not an open decision.

### Design

**WHAT:** three evidence-backed answers — (a) article generator home: extend `content-gen` vs new `article-gen`; (b) `podcast-pub` show-notes capability against its target (self-hosted microfeed REST API — verified 2026-09-02: `plugins/publishings/podcast-pub/plugin.json`, item ops in `src/map.ts`); (c) fan-out shape for the v1 targets `podcast-pub` + `surfdash-pub` per `docs/design/fan-in-and-fan-out-specification.md`.

**WHY:** locks the publish half of the extended workflow before implement tasks graduate.

**Assumes from deps:** 0088's dispositions for article generation and publish steps. Conflicts surface to map F61; no silent re-ownership.

**WHERE — frozen read set (verified present 2026-09-02):** `plugins/generations/content-gen/plugin.json` + `src/` surface (STORM pipeline: curation, outline, article, polish); `plugins/publishings/podcast-pub/{plugin.json, src/map.ts}` + `docs/design/podcast-pub.md`; `plugins/publishings/surfdash-pub/`; `docs/design/publish-plugin-specification.md`; `docs/design/fan-in-and-fan-out-specification.md`.

**Deliverable contract — `## Solution` carries three named subsections:** `Article generator home` · `Podcast show-notes capability` · `Fan-out shape (v1: podcast-pub + surfdash-pub)`.

**Anti-patterns:** do not design for platforms beyond surfdash (map decision — note only how extra `*-pub` plugins slot in); no code changes; no template authoring (that is 0090's downstream).

**Handoff:** implement tasks graduated after this ticket consume the three answers verbatim.

### Plan
- [x] 1. Claim after 0088 is done; read its Solution dispositions first. (dep)
- [x] 2. Read content-gen surface; decide extend-vs-new with rationale. (R1)
- [x] 3. Read podcast-pub transport + microfeed item ops; verify show-notes/description support; name the gap if missing. (R2)
- [x] 4. Read surfdash-pub + publish spec; recommend the fan-out shape for the two v1 targets. (R3)
- [x] 5. Write `## Solution` per the deliverable contract. (R1–R3)

Verification intent: `spur task check 0091` clean; reviewer confirms all three contracted subsections exist with file-level evidence.

### Solution
#### Article generator home

**Decision: extend the existing `content-gen` generator. Do NOT create a new `article-gen` plugin.**

Evidence (extends 0088, does not re-own it):

- 0088 disposition row **2.2 article = `extend`**: "`content-gen` generator plugin exists … but `kk-daily-ai-voice.yaml` never invokes it" (`docs/tasks/0088_gap-analysis-kk-daily-ai-voice-vs-ideal-end-to-end-daily-pip.md` disposition table). 0088's article home recommendation is `content-gen`, wired as a new `article` state. Task 0091 inherits that; no conflict.
- `content-gen` owns the generator-plugin contract end-to-end: manifest `kind: generator`, `entry ./src/index.ts` (`plugins/generations/content-gen/plugin.json:2`), description = "owned STORM pipeline (curation, outline, article, polish) … `Doc[]` → `Content`". `processGeneratorIO` (`plugins/generations/content-gen/src/index.ts:17`) parses `DocListSchema`, runs `generateWithStormPipeline`, writes validated `ContentSchema` to `--out`.
- The STORM pipeline already produces the grounded article: `generateWithStormPipeline` (`plugins/generations/content-gen/src/storm.ts`) runs curation → outline → article → polish through an injected `spur agent run` stage runner, with allowed-doc-id enforcement (`assertKnownEvidence`), citation-preservation check (polish), and maps to `Content` with `body` (markdown), `format: 'markdown'`, `outline`, `references` (from doc `sourceUri`), and provenance `metadata = { generator: 'kk:storm', stageCount: 4, docIds }`.
- A new `article-gen` would duplicate the grounding, citation validation, and provenance machinery for zero gain.

**Template approach (named, not authored).** `content-gen` is agent-driven synthesis (STORM), not a string-template renderer — there is currently no template parameter (`processGeneratorIO` takes only `--in`/`--out`, `plugins/generations/content-gen/src/index.ts:30-35`). The map's standing preference "article + script are template-based so generation is fine-tunable" (`docs/features/F61_daily-ai-news-end-to-end-pipeline-wayfinder-map.md` Notes → Standing preferences) is satisfied as an **additive, loadable template input to `content-gen`** — a template handle passed on the invoke payload (resolve toward a `--template` flag read by the article/polish stage: content-gen's input model is `--in`/`--out` only, so a `metadata.template` payload channel does not exist today) that shapes the article skeleton (heading order + section framing + frontmatter) into which the STORM-authored sections are rendered. Template authoring stays downstream (task anti-pattern; payload/surface belongs under `docs/04_DESIGN.md` T3 when implemented). Precedent exists in the pipeline: `script`/`voice` flow reads template-driven inputs, and the same fine-tunable intent applies here — but the home is `content-gen`, never a second generator.

**Consequence for the publish half:** the consumer of this answer treats the article as `content-gen`'s `Content` (`format: markdown`, `body`) and feeds it to the fan-out described below.

#### Podcast show-notes capability

**Disposition: the show-notes capability is WIRED. The gap is wiring/configuration, not a plugin-capability gap.** (Confirms 0088's P3 correction; 0088's "not yet satisfied by podcast-pub" wording is superseded.)

Evidence:

- `plugins/publishings/podcast-pub/src/map.ts` — `mapContentToEpisode` returns `contentHtml: content.body`; the `EpisodeMapping` interface comment names it "Episode show notes: `content.body` verbatim (microfeed sanitizes server-side)". So the article body → microfeed item body field `content_html` is already mapped.
- `plugins/publishings/podcast-pub/src/index.ts:105,124,144` pass `content_html: episode.contentHtml` on every `createItem`/`updateItem` call (both the hosted-audio single-call path and the two-phase upload path).
- Target platform supports show notes: microfeed `apiItemInputSchema` = `{ title, content_html, status, attachments }` (`docs/design/podcast-pub.md` §3 Create item `POST /api/v1/items`; decision D6 "`body` (markdown) → `content_html`"). In microfeed, `content_html` is the item body/description → the RSS enclosure description / episode show notes, with `attachments[0]` (`category: 'audio'`) the enclosure (RSS / JSON Feed).

**Gap (named) — wiring/config, four seams, none a capability gap:**

1. No workflow state invokes `podcast-pub`. The workflow currently ends `quality-control → done` (`plugins/kk/workflows/kk-daily-ai-voice.yaml:154-155`); there is no publish state.
2. The article `Content` alone carries no audio reference. `mapContentToEpisode` throws "audio reference is required" unless `metadata.audioUrl` or `metadata.audioFile` is present (`plugins/publishings/podcast-pub/src/map.ts:63-70`); `content-gen` emits `format: 'markdown'` `Content` with no audio metadata.
3. Field-name seam in the audio handoff: the audio producer `voice-gen` emits `metadata.audioPath` / `metadata.mp3Path` (`plugins/generations/voice-gen/src/index.ts:203-223`), while `podcast-pub` reads `metadata.audioFile` / `metadata.audioUrl` (`plugins/publishings/podcast-pub/src/map.ts:63-64`). The publish wiring must map voice-gen's local `mp3Path` → podcast-pub's `audioFile` (plus `metadata.durationSeconds`).
4. microfeed config must be present: `MICROFEED_BASE_URL`, `MICROFEED_API_KEY` (`docs/design/podcast-pub.md` §5 D4); optional `MICROFEED_TIMEOUT_MS`/`KNOWLEDGE_KIT_PUBLISH_TRANSPORT`.

**Residual-risk caveat (verify step, not a blocker).** `podcast-pub` passes `content.body` (markdown) verbatim as `content_html`; the field is named `_html` and the plugin comment says "microfeed sanitizes server-side." Whether microfeed renders markdown → HTML (or expects HTML) is not independently verified within the frozen read set (`vendors/microfeed` source is absent). If microfeed expects HTML, the publish wiring may need a markdown→HTML transform before feed — flag as a deploy-time smoke check, not a capability gap.

#### Fan-out shape (v1: podcast-pub + surfdash-pub)

**Recommendation: ONE `kk executor fan-out` subcommand (a single workflow `publish` state), NOT N sequential per-target states.**

Evidence:

- `docs/design/fan-in-and-fan-out-specification.md` §1.1: `kk executor fan-out --content <content.json> --target <p1> [--target <p2> …] --out <result.json> [--retry-from <prior-result.json>]` — repeatable `--target`, sibling of `executor run`.
- §3.1 `AggregateResult` collects per-target outcomes (`published`/`failed`/`skipped`); §4 exit-code contract: all-success → `0`, partial-success → `1` (fail-loud while per-target outcomes record the partial win), all-failed → `1`; §5 `--retry-from` resumes only the failed/un-attempted targets.
- The workflow engine executes one node at a time, so fan-in/fan-out are `kk` subcommands, never engine states (`docs/design/fan-in-and-fan-out-specification.md` §1.1; `03_ARCHITECTURE.md`; F61 map Architecture constraints).

**v1 shape:** a single workflow `publish` state runs:

```bash
kk executor fan-out \
  --content 2-article/content.json \
  --target surfdash-pub \
  --target podcast-pub \
  --out 3-publish/result.json
```

Partial success → exit `1` → fail-loud signals an incomplete pipeline state to `spur workflow` while the per-target `AggregateResult` records which platform published; `--retry-from 3-publish/result.json` re-runs only the failed target next morning.

**Why sequential per-target states were rejected:** N separate `*-pub` states re-implement the aggregation / partial-success / resume contract in workflow YAML, split the publish contract across N states (each needing its own guard + retry), and lose the `AggregateResult` schema — exactly what the spec exists to avoid. `podcast-pub` (needs audio + `MICROFEED_*`) and `surfdash-pub` (needs `postsurfing` CLI) fail independently, so the partial-success + resume contract is required.

**How more `*-pub` plugins slot in later (note only, no design):** add another repeatable `--target <plugin>` to the same `publish` state (e.g. `--target zenn-pub`). No new state, no workflow YAML structure change, no engine change. 0088's extension-plan `publish_targets` var must expand to repeatable `--target` flags as targets grow (0088 review P6); do not design for platforms beyond surfdash/podcast in v1 (map decision).

**Handoff.** 0092+ implement tasks consume: R1 → article = `content-gen` (+ additive template input); R2 → podcast show-notes is wired (`content.body` → `content_html`), gap is the publish wiring (audio-reference field mapping + microfeed env + a publish state); R3 → one `kk executor fan-out` publish state with repeatable `--target`. No production code, no plugin files, no templates, no workflow YAML touched by this ticket.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `docs/tasks/0091_article-generation-publish-fan-out-incl-podcast-show-notes.md:68-82` — Article generator home: extend `content-gen`, no new `article-gen`; template approach named (additive `--template` flag; metadata-channel variant rejected as nonexistent input surface). Re-read this run: `plugins/generations/content-gen/plugin.json:3-4` (kind generator, entry ./src/index.ts), `plugins/generations/content-gen/src/index.ts:17` (`processGeneratorIO`), `plugins/generations/content-gen/src/storm.ts:319` (`generateWithStormPipeline`), `plugins/generations/content-gen/src/storm.ts:336` (`generator: 'kk:storm'` provenance) |
| R2 | MET | `docs/tasks/0091_article-generation-publish-fan-out-incl-podcast-show-notes.md:83-100` — show-notes capability WIRED, gap is wiring/config (4 seams named). Re-read this run: `plugins/publishings/podcast-pub/src/map.ts:86` (`contentHtml: content.body`), `plugins/publishings/podcast-pub/src/map.ts:7` (show-notes comment), `plugins/publishings/podcast-pub/src/index.ts:105,124,144` (`content_html` on every create/update), `plugins/publishings/podcast-pub/src/map.ts:63-70` (audio-reference guard), `plugins/generations/voice-gen/src/index.ts:205` + `plugins/generations/voice-gen/src/index.ts:221` (audioPath/mp3Path emission — field-name seam confirmed real), `docs/design/podcast-pub.md` (content_html ×2) |
| R3 | MET | `docs/tasks/0091_article-generation-publish-fan-out-incl-podcast-show-notes.md:102-118` — ONE `kk executor fan-out` publish state with repeatable `--target`, sequential states rejected with rationale, extra `*-pub` slot-in note. Re-read this run: `apps/cli/src/commands/executor.ts:135` (`.command('fan-out')`, repeatable `--target`, `--retry-from`), `docs/design/fan-in-and-fan-out-specification.md:51` (fan-out CLI), spec §3.1 AggregateResult / §4 exit codes / §5 retry-from |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1–R3 answered with file-level evidence in `## Solution`. | MET | command | `grep -n '^#### ' docs/tasks/0091_article-generation-publish-fan-out-incl-podcast-show-notes.md` (run this turn) → three contracted subsections present: `:68` Article generator home, `:83` Podcast show-notes capability, `:102` Fan-out shape (v1: podcast-pub + surfdash-pub); each carries repo-relative file:line evidence re-verified above |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

## Review Report — 0091 (wayfinder:research)

**Scope:** `## Solution` of `docs/tasks/0091_article-generation-publish-fan-out-incl-podcast-show-notes.md` + companion `docs/design/article-publish-fanout-brief.md`. No production code (git diff: task doc + companion doc only).
**Dimensions:** functional traceability, SECUA correctness (R1/R2/R3 answers), architecture depth.
**Verdict:** PASS-with-findings — no P1/P2/P3; 2 cosmetic P4 line-drift findings + 1 advisory P4 architectural note.

#### Findings (ranked)

| # | Severity | Dimension | Finding | Location |
| --- | ---------- | ----------- | --------- | ---------- |
| 1 | P4 | correctness | R1 evidence cites `processGeneratorIO` at `content-gen/src/index.ts:29` and the `--in/--out` block at `:33-38`; the function is defined at `:17` (`DocListSchema.parse` at `:24`), the `parseArgs` block at `:30-35`. Substance verifies (STORM pipeline, `DocListSchema`→`ContentSchema`→`--out`); line numbers drift. | `docs/tasks/0091_….md` → Article generator home |
| 2 | P4 | correctness | R2 evidence cites `content_html: episode.contentHtml` at `podcast-pub/src/index.ts:106,121,137`; actual calls at `:105/:124/:144`. Map.ts audio-ref throw cited at `:60-66` (actual `:63-72`) and audio field reads at `:55-58` (actual `:63-64`). Substance verifies — show-note wiring is real; line numbers drift. | `docs/tasks/0091_….md` → Podcast show-notes capability |
| 3 | P4 | architecture | Template input proposed as `metadata.template` (invoke payload) *or* a `--template` flag. Only the `--template` variant matches content-gen's current `executor run <plugin> --in --out` input model (it consumes `Doc[]` from `--in`; there is no payload-metadata channel today); `metadata.template` would need a new input channel. Task defers the surface to `04_DESIGN.md` T3, so non-blocking — resolve toward `--template` to stay consistent with the generator contract. | `docs/tasks/0091_….md` → Article generator home (template) |

#### Functional Traceability

| Req | Status | Evidence |
| ----- | -------- | ---------- |
| R1 | MET | `## Solution → Article generator home` — extend `content-gen`, no new `article-gen`; template approach named (additive template input, not authored). |
| R2 | MET | `## Solution → Podcast show-notes capability` — capability WIRED (`content.body`→`content_html`), gap named as 4 wiring/config seams + residual markdown→HTML caveat. Corrects 0088's earlier P3. |
| R3 | MET | `## Solution → Fan-out shape (v1: podcast-pub + surfdash-pub)` — one `kk executor fan-out` publish state, repeatable `--target`, note on how extra `*-pub` slot in. |
| AC | MET | All three contracted subsections exist with file:line evidence (`Article generator home` · `Podcast show-notes capability` · `Fan-out shape (v1: podcast-pub + surfdash-pub)`). |

#### SECUA verification (fresh reads)

- **Article generator home (extend content-gen):** verified. `content-gen/plugin.json:2-4` `kind: generator`, `entry ./src/index.ts`; STORM pipeline (`storm.ts:319` `generateWithStormPipeline`) → `Content` `format:'markdown'`/`outline`/`references`/`metadata {generator:'kk:storm', stageCount:4}` (`storm.ts:331-337`); 0088 row 2.2 = `extend`. "No `--template` today" confirmed (`index.ts:30-35` only `--in`/`--out`).
- **Podcast show-notes (CRITICAL):** verified WIRED. `map.ts:86` `contentHtml: content.body`; `EpisodeMapping` comment names it show notes (`map.ts:7`); `content_html` passed on every create/update (`index.ts:105/124/144`); `podcast-pub.md` D6 `body (markdown)→content_html`. Audio reference still requires `metadata.audioUrl`/`audioFile` (`map.ts:63-72`); voice-gen emits `audioPath`/`mp3Path` (`voice-gen/index.ts:205/221`) — field-name seam is real and correctly named. Confirms 0088's P3 correction (gap is wiring, not capability).
- **Fan-out shape:** verified consistent. `executor fan-out` subcommand exists with repeatable `--target` + `--retry-from` (`executor.ts:135-144`); spec §1.1 CLI, §3.1 `AggregateResult` (`published`/`failed`/`skipped`), §4 exit codes (0 all-success / 1 partial & all-failed), §5 `--retry-from` resume only-failed. 0088 P6 + `03_ARCHITECTURE.md:86/92` ("one node at a time"; fan-in/out are kk subcommands, not engine states) corroborate.

#### Residual Risk

- Markdown→HTML for `content_html` (microfeed "sanitizes server-side" vs expects HTML) is not independently verified (`vendors/microfeed` absent from the read set). Correctly flagged by the Solution as a deploy-time smoke check, not a capability gap — appropriate, not a review gap.
- Audio handoff must additionally map voice-gen's `duration` (not `durationSeconds`) → podcast-pub's `metadata.durationSeconds`; the Solution names the field seam but the key mismatch is implied rather than stated. Cosmetic; wiring task will surface it.

#### Final Disposition

PASS-with-findings (P4 only). All three requirements and the AC are substantively MET against fresh source reads; the R2 show-notes claim (formerly 0088's P3) is confirmed accurate. Nothing here blocks graduation — the two P4 line-drift items and the architectural note are cosmetic/advisory for the downstream wiring task. No code was or should be changed by this ticket.

### References

- Map: `docs/features/F61_daily-ai-news-end-to-end-pipeline-wayfinder-map.md`
- `docs/design/publish-plugin-specification.md` · `docs/design/podcast-pub.md` · `docs/design/fan-in-and-fan-out-specification.md`
- Depends on: 0088 (dispositions)

### History

- 2026-09-03T05:44:02.870Z todo → wip (system)
- 2026-09-03T05:49:03.758Z wip → testing (system)
- 2026-09-03T05:49:04.091Z testing → done (system)
