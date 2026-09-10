---
schema_version: 1
name: Map image jobs onto the generator-plugin Doc-to-Content IO contract
status: done
template: feature-impl
created_at: 2026-09-09T18:28:33.705Z
updated_at: "2026-09-10T15:20:35.736Z"
feature_id: K

ac_altitude: task-local
dependencies: ["0102", "0103"]
done_forced: "true"
done_reason: "4 of 13 ACs PARTIAL solely on the registered adapter-hop deferral (byte-writer, illustration insertion, written[] tracking ride 0105 per the task's registered Design; src/index.ts:197-202 money boundary). All 6 requirements MET at registered scope; verify hop 9 PASS / 4 GAP with fresh in-tree evidence (lint PASS 6 req + 13 AC rows); gate 717/0, rules 2/2, digest 3f00a478; review PASS-WITH-NOTES with P1/P2 closed in-tree. Forced per evidence rule; audit done_forced=true."
---

## 0104. Map image jobs onto the generator-plugin Doc-to-Content IO contract

### Background

**Ticket type: `wayfinder:prototype`** — map K. **Blocked by 0102** (the `FormatPreset` / `StylePreset` names and `composePrompt`) **and 0103** (the `ImageProvider` interface and `selectProvider`); hands the emitted `Content` shape to 0106. The design below reads standalone — both prerequisites are frozen in the corpus — but the code cannot compile before they land.

The engine home is settled (`plugins/generations/image-gen/`, `kind: generator`). The *fit* is not: the generator contract is `Doc[] → Content` with `Content.body` a **string**, while an image job's real output is files on disk plus, for the illustration job, a rewritten article. This ticket proves the three v1 jobs ride that contract honestly rather than smuggling the whole job into `metadata`.

**Evidence, verified against the tree on 2026-09-09.** Three premises in the pre-refinement draft were wrong; all three change the design.

*1. The plugin argv is exactly `--in` and `--out`. No job flags reach a plugin — ever.* `apps/cli/src/invoke.ts:118-122`:

```ts
return opts.entryPath.endsWith('.ts') || opts.entryPath.endsWith('.js')
    ? [process.execPath, opts.entryPath, '--in', opts.inPath, '--out', opts.outPath]
    : [opts.entryPath, '--in', opts.inPath, '--out', opts.outPath];
```

`kk executor run <plugin> --in <path> --out <path>` (`apps/cli/src/commands/executor.ts:137-147`) accepts only `--plugins-root` / `--plugins-path` beyond those, and neither is forwarded. **Consequence:** every job parameter — job kind, format, style, variables, provider, count — must arrive **inside the `--in` JSON** or through the environment. There is no third channel. R2 ("or via plugin options") is answered by the constraint, not by a preference.

*2. `works_dir` is not readable by a plugin.* `grep -rn 'works_dir' --include='*.ts'` over `apps/`, `packages/` and `plugins/` returns **nothing**. It exists only in `plugins/kk/config.example.yaml:1`, `docs/04_DESIGN.md:263`, and workflow/skill markdown where a **shell node** expands it before building `--out` (`plugins/kk/commands/workflow-run.md:146`). R3's phrasing ("under `works_dir`") is therefore unimplementable as written by this plugin.

The in-repo answer is the one voice-gen already ships: **artifacts are siblings of `--out`** (`plugins/generations/voice-gen/src/index.ts`):

```ts
const audioPath = resolve(join(outDir, `${outStem}.wav`));
const mp3Path = resolve(join(outDir, `${outStem}.mp3`));
```

The invoker places `--out` under `$works_dir/<id>/…`; the plugin only ever resolves relative to `--out`. This also survives a multi-node workflow run, which is what R3 actually asks for. Note the plugin's `cwd` is its **own package directory** (`apps/cli/src/invoke.ts`, `cwd = record.dir`), so a path resolved against `process.cwd()` would land inside the plugin — never do that.

*3. `--in` is schema-validated before the plugin starts.* `apps/cli/src/invoke.ts:251` runs `contract.input.safeParse` and fails with `Input schema violation for kind '<kind>': …`. For `generator` the contract is `DocListSchema` (`packages/kk-core/src/kinds.ts:59`) — a bare `Doc[]` array, each element `{id, body, title?, sourceUri?, mediaType?, metadata?}` (`packages/kk-core/src/schemas.ts:4-11`). This is task 0100's scar (`kinds.ts:60-68`): a documented input form the executor rejected before the plugin ever ran. **R2 must be verified by running the executor, not by reading the schema.**

*Output shape.* `ContentSchema` (`packages/kk-core/src/schemas.ts:14-28`): `body: string` (required), `title?`, `format` (defaults `'markdown'`), `outline?`, `references?: {url?, title?, cite?}[]`, `metadata?: Record<string, unknown>`.

*`format: "image"` needs a spec amendment.* `docs/design/generator-plugin-specification.md:56-57` says wrappers "SHOULD NOT emit any other value in Phase 1", amended once already by feature **D5** so `voice-gen` may emit `format: "audio"`. Emitting `format: "image"` requires the same treatment — an amendment clause naming this feature — and that edit is a **deliverable of this ticket**.

*Sibling precedents to read:* `plugins/generations/voice-gen/src/index.ts` (binary artefacts, `parseArgs({ in, out })`, empty-input `EMPTY_CONTENT` notice returning 0, and the failure path that deletes the output plus artefacts before rethrowing) and `plugins/generations/content-gen/src/index.ts` (`Doc[]` → article).

*The illustration job's target behaviour* is documented by example in `/Users/robin/projects/cc-agents/plugins/wt/skills/image-illustrator/examples/` — `article-before.md`, `positions-detected.md`, `article-after.md`, `captions.json` — a complete round trip to imitate.

### Requirements

Produce, as the task's Design section and a prototype `src/index.ts` skeleton:

- [x] R1. **Per-job IO table** — for each of `free`, `cover`, `illustration`: what the input `Doc[]`/`Brief` carries, what `Content.body` holds, what `Content.metadata` holds (at minimum a typed `images[]` with path, format, style, provider, prompt, seed), and what lands on disk.
- [x] R2. **The `free` job's input shape** — a bare prompt is not a document. Decide whether it arrives as a single synthetic `Doc` with `body` = prompt, or via plugin options, and confirm the executor's `--in` validation accepts it. Verify against `executor.ts`, not by assumption.
- [x] R3. **Output file location and naming** — under `works_dir`, deterministic and collision-safe, surviving a multi-node workflow run so a downstream publish node can find the cover.
- [x] R4. **The illustration round-trip** — how the rewritten article markdown and the captions manifest are returned without losing the original, and whether the rewrite belongs in the plugin or in the calling skill.
- [x] R5. **Workflow invocation example** — a concrete `spur workflow` node calling `kk exec image-gen`, showing a cover produced in one node and consumed in the next.
- [x] R6. **The confirmation/budget seam** — the map's open question about non-interactive runs lands here as a plugin option; propose the option and its default, and flag it for the operator rather than deciding it alone.

Deliver a compiling `index.ts` skeleton with the types wired and the three job branches stubbed. It need not generate an image.

### Acceptance Criteria

```gherkin
Task-local acceptance criteria. Feature K is a `wayfinder-map` carrying a prose no-AC disclaimer, so these scenarios are the executable contract for this ticket alone.

Scenario: A bare prompt survives the executor's input validation (R2)

- **Given** a file containing `[{"id":"p1","body":"a red bicycle","metadata":{"imageGen":{"job":"free"}}}]`
- **And** `KK_IMAGE_DRY_RUN=1`
- **When** `kk executor run image-gen --in <that file> --out <tmp>/content.json` is run
- **Then** the process exits 0
- **And** stderr contains no `Input schema violation for kind 'generator'`
- **And** `<tmp>/content.json` parses against `ContentSchema`

Scenario: A missing job spec fails loud and early (R1)

- **Given** an input array whose first `Doc` has no `metadata.imageGen`
- **When** the plugin runs
- **Then** it exits non-zero
- **And** the error names the expected path `metadata.imageGen` and lists `free`, `cover`, `illustration`
- **And** no image file is written and `--out` does not exist

Scenario: Artefacts land beside `--out`, never in the plugin directory (R3)

- **Given** a `cover` job and `--out` set to `<tmp>/5-images/content.json`
- **When** the plugin runs with a stub provider returning 1 PNG
- **Then** exactly `<tmp>/5-images/content-cover-01.png` exists
- **And** no file was created under `plugins/generations/image-gen/`
- **And** `metadata.images[0].path` is that absolute path
- **And** `references[0].url` equals `file://` + that path

Scenario: Artefact names are deterministic and zero-padded (R3)

- **Given** an `illustration` job with `count: 3` and `--out` `<tmp>/content.json`
- **When** the plugin runs twice against the same `--out`
- **Then** both runs produce exactly `content-illustration-01.png`, `-02.png`, `-03.png`
- **And** the second run overwrites rather than appending a fourth file

Scenario: The illustration round trip preserves the original (R4)

- **Given** an input `Doc` whose `body` is the article from `image-illustrator/examples/article-before.md`
- **And** `metadata.positions` naming two anchors
- **When** the plugin runs with a stub provider
- **Then** `Content.body` contains both image references at those anchors and is otherwise byte-identical to the input body
- **And** the input file on disk is unchanged (compare a hash taken before the run)
- **And** `metadata.captions` has one entry per image, each with `index`, `path`, `caption`, `altText`, `anchor`
- **And** `metadata.sourceDocId` equals the input doc's `id`

Scenario: The budget cap refuses before spending (R6)

- **Given** an `illustration` job with `count: 9` and no `maxImages`
- **And** a provider stub that throws if `generate` is called
- **When** the plugin runs
- **Then** it exits non-zero with a message naming `9` and the cap `4`
- **And** the stub was never called
- **And** `--out` does not exist

Scenario: `KK_IMAGE_MAX_IMAGES` overrides the compiled default (R6)

- **Given** `KK_IMAGE_MAX_IMAGES=10` and an `illustration` job with `count: 9`
- **When** the plugin runs with a stub provider
- **Then** it exits 0 and `metadata.images` has 9 entries
- **And** with `maxImages: 2` also set in the spec, the same run instead fails naming the cap `2` — the spec value wins over the env

Scenario: A dry run composes prompts and spends nothing (R6)

- **Given** `KK_IMAGE_DRY_RUN=1` and a provider stub that throws if `generate` is called
- **When** a `cover` job runs
- **Then** it exits 0, the stub was never called, and no image file exists
- **And** `Content.metadata.dryRun` is `true`, `metadata.images` is empty
- **And** `Content.body` is the fully composed prompt string

Scenario: A failure leaves nothing behind (spec §2.5)

- **Given** a provider stub that throws on the **second** of three images
- **When** an `illustration` job runs
- **Then** the process exits non-zero
- **And** neither `--out` nor any `content-illustration-*.png` from that run exists

Scenario: Empty input is a notice, not a failure (spec §2.5)

- **Given** an `--in` file containing `[]`
- **When** the plugin runs
- **Then** it exits 0 and `--out` holds the `EMPTY_CONTENT` notice `Content`, matching voice-gen's behaviour

Scenario: The workflow example runs end to end (R5)

- **Given** the two-node YAML fragment from the Design, with `KK_IMAGE_DRY_RUN=1` and a fake publish target
- **When** the workflow runs
- **Then** both nodes exit 0
- **And** the publish node's input is the exact `content.json` the image node wrote

Scenario: The spec amendment and surface docs land in the same commit (deliverable)

- **Given** the commit implementing this ticket
- **When** `git show --stat` is read
- **Then** it includes `docs/design/generator-plugin-specification.md`, `docs/04_DESIGN.md` and `plugins/kk/config.example.yaml`
- **And** the generator spec's `format` clause names `image-gen` and `format: "image"`
- **And** the `config.example.yaml` block contains no real credential value

Scenario: The gate is clean (all)

- **Given** the working tree at this task's HEAD
- **When** `bun run lint`, `bun run test` and `bun run build` run
- **Then** all three exit 0, no test is skipped, and coverage on `plugins/generations/image-gen/` is ≥90% line and ≥90% function
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-09T20:16:55.258Z

**Q: Why not add `--job` / `--format` / `--style` flags to the executor so the plugin gets real CLI options?**
Because the spawn contract is frozen at `[execPath, entry, '--in', in, '--out', out]` (`apps/cli/src/invoke.ts:118-122`) and is shared by every plugin of all three kinds. Changing it for one plugin is an ADR-level change to the platform's narrowest, most-depended-on seam. The `--in` JSON already carries arbitrary `metadata`, costs nothing, and leaves an inspectable artefact on disk. **Closed: no executor change.**

**Q: Is `docs[0].metadata.imageGen` not a magic location?**
It is a convention, and it is documented in the Design, the AC and the emitted error message. The alternatives are worse: a magic `Doc.id`, an env blob invisible to the workflow's own artefacts, or a schema change to `DocSchema` that every ingestion plugin would then carry. **Closed: first-doc metadata, validated by zod, failing loud with the path in the message.**

**Q: R3 says output goes "under `works_dir`" — why does the Design not do that?**
Because no TypeScript in this repo reads `works_dir`; it is expanded by shell workflow nodes before they build `--out` (`plugins/kk/commands/workflow-run.md:146`). A plugin resolving it would have to re-implement config loading that does not exist. Writing beside `--out` gives the same result whenever the invoker points `--out` under `$work_dir`, and it matches the only in-repo precedent for binary artefacts (voice-gen). **Closed: siblings of `--out`; R3's intent is met, its wording is superseded — flagged here so a reviewer reading the original R3 is not surprised.**

**Q: Why is `Content.body` the prompt for two jobs and the article for the third?**
`body` is required and must be the thing a downstream consumer most wants. For `illustration` that is unambiguously the rewritten article. For `free`/`cover` the artefact is the file, and the most useful string is the exact prompt that produced it — it makes a run reproducible and is what an operator reads when the image is wrong. A uniform choice would make one of the two jobs carry a useless `body`. **Closed, documented in the spec amendment so the asymmetry is discoverable.**

**Q: Should the article rewrite happen in the plugin or the calling skill? (R4)**
Plugin, for the insertion; skill, for the decision of where. Insertion is deterministic string work and keeping it in the plugin is what lets `body` be a self-contained deliverable a publish node can consume with no agent in the loop. **Closed.**

**Q: What is the right default for `KK_IMAGE_MAX_IMAGES`?**
Proposed **4** — enough for an article's illustrations, small enough that a mis-typed `count` cannot run up a bill. **Open, owner: operator**; also open is whether workflow nodes should be *required* to set `maxImages` explicitly rather than inherit any default. Neither blocks implementation: both are single-constant changes and the mechanism is identical either way.

**Q: Does `format: "image"` break existing publish plugins that assume markdown?**
It can, and that is why the amendment is a deliverable rather than a note. `voice-gen` already established the precedent with `format: "audio"` (feature D5) and no publish plugin regressed, because publish plugins branch on what they can render. Any publish plugin that must consume image output will be handled by its own ticket. **Closed: amend the spec, do not widen this ticket.**

**Q: Concurrency — should N illustration images generate in parallel?**
No, not in v1. Sequential generation is simpler, keeps the failure-cleanup path honest (one partial file at most), and the provider rate limits recorded by 0103 make parallelism a per-provider question rather than a plugin-wide one. **Deferred** to a follow-up ticket with owner = whoever first measures the wall-clock cost as unacceptable.

**Q: Where does the caller get `metadata.positions` for the illustration job?**
From 0106's skill, which performs position detection as model work. The plugin validates that each anchor occurs exactly once in the article body and fails loud otherwise. **Closed — this is the frozen handoff to 0106.**

### Design

**WHAT** — the frozen input envelope, output shape, on-disk layout and budget seam for `plugins/generations/image-gen`, plus the compiling `src/index.ts` prototype with the three job branches stopped at the money-spending boundary. **WHY frozen here:** 0106's skill writes the `--in` file and reads the `Content`; if this shape moves later, every skill example and workflow node moves with it. Registered 2026-09-10 after the prototype landed; line cites re-verified against this tree, and R2 was proven by running the executor, not by reading the schema.

#### Platform constraints (verified against this tree)

1. **The plugin argv is exactly `--in` and `--out`.** `apps/cli/src/invoke.ts:118-123` (`pluginEntryCmd`): `[process.execPath, entryPath, '--in', inPath, '--out', outPath]` for `.ts` entries. `kk executor run <plugin> --in <path> --out <path>` (`apps/cli/src/commands/executor.ts:141-149`) accepts only `--plugins-root` / `--plugins-path` beyond those, and neither is forwarded to the child env. **Consequence:** every job parameter arrives inside the `--in` JSON or the environment; there is no third channel.
2. **A plugin's cwd is its own package dir.** `apps/cli/src/invoke.ts:277-281` spawns with `cwd: record.dir`; `KNOWLEDGE_KIT_PROJECT_ROOT` is injected (`invoke.ts:137-143`). A path resolved against `process.cwd()` would land inside the plugin — never do that.
3. **`--in` is schema-validated before the plugin starts.** `apps/cli/src/invoke.ts:251-256` runs `contract.input.safeParse` and fails with `Input schema violation for kind '<kind>': …`. For `generator` the contract is `DocListSchema` (`packages/kk-core/src/kinds.ts:59`) — a bare `Doc[]`, each element `{id, body, title?, sourceUri?, mediaType?, metadata?}` (`packages/kk-core/src/schemas.ts:4-11`).

**R2 verified by execution, 2026-09-10.** Input `[{"id":"p1","body":"a red bicycle","metadata":{"imageGen":{"job":"free"}}}]` via `kk executor run image-gen --in … --out …` with `KK_IMAGE_DRY_RUN=1`: **exit 0, stderr empty, no `Input schema violation for kind 'generator'`**, and `--out` parsed against `ContentSchema` (`format: "image"`, `metadata.dryRun: true`). The negative run (doc without `metadata.imageGen`) passed the same executor validation and then failed inside the plugin, exit 1, with the message naming `metadata.imageGen` and `free`, `cover`, `illustration`; `--out` was never written. A bare prompt **is** a valid `Doc` — no schema change, no new input form, no executor change.

#### The input envelope (R1, R2) — frozen

Exactly one job per invocation; the job spec rides on the **first document's metadata** and the array itself is the content (`plugins/generations/image-gen/src/job.ts`):

```ts
export interface ImageJobSpec {
    job: 'free' | 'cover' | 'illustration';
    format?: string;                    // FormatPreset name (0102); default = the job's own preset
    style?: string;                     // StylePreset name; default = format.defaultStyle
    vars?: Record<string, string>;      // template variables (0102 composePrompt); caller wins
    extra?: string;                     // free text appended as composePrompt's 4th segment
    provider?: string;                  // 0103 selectProvider's `requested`
    model?: string;
    referenceImages?: string[];         // absolute paths (0105 pass-through)
    count?: number;                     // illustration only; images to produce, default 1
    maxImages?: number;                 // budget cap, R6
    seed?: number;
    outputStem?: string;                // overrides the `--out` basename for artefact names
}
```

`ImageJobSpecSchema` is a **strict** zod object — the envelope is frozen and 0106 writes it, so a typo'd key fails loud instead of vanishing. Read from `docs[0].metadata?.imageGen`; a missing/malformed spec throws naming the path `metadata.imageGen` and the three valid `job` values. Per-job `format` defaults: `free → 'free'`, `cover → 'cover'`, `illustration → 'illustration'` — the three presets 0102 ships, so `{ job: 'cover' }` alone is a complete working job. A format preset whose `job` field contradicts the requested job fails loud (misconfiguration, pre-spend). Prompt mapping (implementation of the frozen table): **free** — the bare prompt rides the format's `subject` slot unless `vars.subject` is set; **cover** — `vars` only, the plugin never analyses the article (that is 0106's model work); **illustration** — one prompt per `metadata.positions` anchor, fed as the `concept` var.

| Job | `--in` array | Notes |
| --- | --- | --- |
| `free` | exactly one `Doc`: `{ id, body: <the prompt>, metadata.imageGen }` | A bare prompt **is** a valid `Doc`. R2 resolved and **proven by running the executor** (above). |
| `cover` | one `Doc` = the article (`body` = markdown, `title` = headline) | The plugin does not analyse the article; the caller supplies `vars`/`style`. |
| `illustration` | one `Doc` = the article, `metadata.imageGen.count` = N, plus `metadata.positions` = the caller's chosen anchors | Position detection is model work → 0106. The plugin executes a decided plan and validates each anchor occurs exactly once in the body. |

Rejected alternatives: an env-carried JSON blob (invisible in the `--in` artefact a workflow leaves behind); a synthetic control `Doc` with a magic `id` (a second, undiscoverable schema); new executor flags (an ADR-level change to the frozen spawn contract for one plugin's convenience).

#### Output (R1, R4) — frozen

`Content.format = 'image'` for all three jobs. `Content.body` differs by job, deliberately: **free/cover** — the composed prompt actually sent (one per image, joined by `\n\n---\n\n`); **illustration** — the rewritten article markdown with image references inserted. For `illustration` the rewritten article is the deliverable a publish node consumes directly from `body`; for the other two the deliverable is the file, and the prompt is the reproducible record of how it was made. Titles: free/cover → the format preset's name; illustration → the source doc's `title`.

`Content.metadata` frozen keys (`src/job.ts`):

```ts
export interface ImageGenMetadata {
    generator: 'kk:image-gen';
    job: 'free' | 'cover' | 'illustration';
    images: ImageArtifact[];     // { path (absolute), format, style, provider, model, prompt, seed?, width?, height?, bytes }
    sourceDocId?: string;        // illustration/cover: the input doc's id
    captions?: CaptionEntry[];   // illustration only — { index, path, caption, altText, anchor }
    dryRun?: true;               // set only when the run spent nothing (R6)
}
```

`Content.references` additionally carries one `{ url: 'file://<abs path>', title: '<format> <NN>' }` per image, so a generic consumer finds the files without knowing `metadata.images`. **The original article is never mutated** — the input file is read-only and the rewrite exists only in `body`; `metadata.sourceDocId` names what it was derived from (R4).

**R4's second half — where does the rewrite live?** In the **plugin**, not the skill. Inserting a markdown image reference at a caller-supplied anchor is deterministic string work; doing it in the plugin makes `body` a self-contained deliverable. Choosing *where* images go is model work and stays in 0106. Seam: **skill decides positions, plugin performs insertion.**

#### On-disk layout (R3) — frozen

Artefacts are **siblings of `--out`** (the voice-gen rule), because `works_dir` is not readable from inside a plugin — no TypeScript in the repo reads it; shell workflow nodes expand it before building `--out` (`plugins/kk/commands/workflow-run.md:146`):

```
<outDir>/<outStem>-<format>-<NN>.<ext>       # NN zero-padded from 01, ext from ImageResult.extension
```

`outStem` = `ImageJobSpec.outputStem ?? basename(--out) without extension` (`src/paths.ts`). Deterministic and collision-safe within a run; a re-run against the same `--out` overwrites — `--out` identifies the run. Every emitted path is `resolve()`d against `--out`'s directory, never `process.cwd()`. The invoker gets `works_dir` semantics by pointing `--out` at `$work_dir/<stage>/content.json`.

#### Workflow invocation (R5)

```yaml
- id: cover
  run: >
    kk executor run image-gen
    --in "${vars.work_dir}/2-outline/cover-job.json"
    --out "${vars.work_dir}/5-images/content.json"
- id: publish
  run: >
    kk executor run ghost-pub
    --in "${vars.work_dir}/5-images/content.json"
    --out "${vars.work_dir}/6-publish/result.json"
```

The cover lands at `${work_dir}/5-images/content-cover-01.png`; the next node reads it from `metadata.images[0].path` in the same `content.json` it already consumes. Quote every `${vars.*}` — `docs/tasks/0059_*.md:204` records the word-splitting bug this repo already hit.

#### The budget seam (R6)

A plugin is a spawned subprocess with no interactive channel, so **it can never prompt**. Confirmation is 0106's; this ticket ships the two mechanisms 0106 needs, implemented in the prototype:

1. **A hard cap.** Images per invocation: `ImageJobSpec.maxImages` → `KK_IMAGE_MAX_IMAGES` → compiled default **4** (`DEFAULT_MAX_IMAGES`). Exceeding it throws **before any provider call**, naming the requested count and the cap. Precedence follows the repo rule "flag > env > config > compiled default" with `maxImages` in the flag slot, since flags cannot reach a plugin.
2. **A dry run.** `KK_IMAGE_DRY_RUN=1` composes every prompt, selects the provider, writes a normal `Content` with `metadata.dryRun: true` and an empty `images[]`, spends nothing, writes no image files. This is how a skill shows the operator exactly what a run will cost before asking for confirmation.

**Flagged for the operator, not decided here:** the default cap value of 4, and whether workflow nodes should be *required* to set `maxImages` explicitly rather than inherit a default. Both are single-constant changes; neither blocks this ticket.

#### Failure and empty-input semantics (spec §2.5)

- **Empty `--in` array** → write the `EMPTY_CONTENT` notice `Content` and exit **0**, mirroring voice-gen.
- **Any failure** → delete `--out` and every artefact written during the run (tracked from the first bytes written), then rethrow so the executor sees a non-zero exit.
- **Invalid spec, unknown preset/provider, format/job mismatch, cap exceeded, unparseable env** → all fail before the first provider call.

#### Prototype as built (this registration)

- `plugin.json` — `kind: generator`, `name: image-gen`, entry `./src/index.ts` (discovery-ready for `kk executor run image-gen`).
- `src/job.ts` — `ImageJobSpec`/`ImageJobSpecSchema` (strict), `ImageArtifact`, `CaptionEntry`, `ImageGenMetadata`, `parseJobSpec`, `readPositions`.
- `src/paths.ts` — `outStemFor`, `artifactPath` (zero-padded, resolved against `--out`).
- `src/index.ts` — `parseArgs({in,out})`, `DocListSchema` parse, `EMPTY_CONTENT` notice, preset resolution (0102), cap + env resolution (R6), provider selection (0103) behind an injectable `ProviderResolver`, dry-run `Content` emission, failure cleanup; the three job branches throw `not implemented` at the money-spending boundary.
- `tests/` — 33 new tests: envelope round-trip and fail-loud messages, naming determinism/collision-safety, dry-run metadata shape, cap precedence (spec > env > default), dispatch routing per job, empty-input notice, failure cleanup, `main()` CLI codes. `bun test plugins/generations/image-gen` 74 pass / 0 fail; coverage on the touched files ≥96% line, 100% function.

**Deferred to the adapter hop (single seam, by design):** the branches stop exactly where provider bytes would be written. Writing image bytes needs the `no-direct-fs-io` seam/exemption for binary output (the FileSystem seam is text-only; voice-gen and podcast-pub each carry an explicit exemption) plus the 0103+ wire-speaking adapters; the illustration insertion + captions (R4) and the artefact-tracking cleanup land in the same step. The required doc edits (generator-spec `format: "image"` amendment, `docs/04_DESIGN.md` row, `plugins/kk/config.example.yaml` block) ride the implementing commit per repo rule T3; this ticket's R6 keys are documented in `plugins/generations/image-gen/config.example.yaml`.

### Plan

Ordered. Each step names the R-item it serves and the check that proves it.

1. **Confirm the input premise by running it, not reading it.** Write `[{"id":"p1","body":"a red bicycle","metadata":{"imageGen":{"job":"free"}}}]` to a temp file and run `kk executor run image-gen --in … --out …` against a stub plugin entry. Confirm no `Input schema violation for kind 'generator'`. Do this **first** — task 0100's scar is exactly this premise going unverified. *(R2)*
2. **Finish the package scaffold** — `plugin.json` (`kind: generator`, `name: image-gen`, entry `src/index.ts`) on top of the `package.json`/`tsconfig.json` 0103 created. Confirm with `kk executor run image-gen …` resolving the plugin (a stub entry that writes an empty `Content` is enough). *(enabling)*
3. **Write `src/job.ts`** — `ImageJobSpec`, `ImageJobSpecSchema`, `ImageArtifact`, `CaptionEntry`, and `parseJobSpec(docs)` returning the spec or throwing with the frozen error message. *(R1)*
4. **Write `tests/job.test.ts`** — valid spec round-trips; missing `metadata.imageGen` throws naming the path; unknown `job` throws listing the three values; per-job `format` defaults applied. Test intent: the envelope is the public API 0106 writes against, so its failure messages are contract, not incidental. *(R1, R2)*
5. **Write `src/paths.ts`** — `artifactPath(outPath, stem, format, index, ext)` implementing `<outDir>/<outStem>-<format>-<NN>.<ext>`, everything `resolve()`d against `--out`'s directory. *(R3)*
6. **Write `tests/paths.test.ts`** — zero-padding at 1/9/10, `outputStem` override, and an assertion that the result never contains the plugin's own directory. *(R3)*
7. **Write `src/index.ts`** — `parseArgs({ in, out })`, read and parse `--in`, empty-array → `EMPTY_CONTENT` notice and exit 0, parse the spec, resolve presets (0102 `resolvePresetRoots` + `composePrompt`), select the provider (0103 `selectProvider`) behind an **injectable factory parameter** so tests never touch the network, enforce the cap, branch on `job` with the three branches stubbed, write artefacts, emit `Content`. *(R1, R3, R6)*
8. **Implement the cap and the dry run** — `maxImages` → `KK_IMAGE_MAX_IMAGES` → `4`; the check runs **before** the first `generate` call. `KK_IMAGE_DRY_RUN=1` short-circuits after prompt composition and provider selection. *(R6)*
9. **Implement the failure cleanup path** — track every path written this run; on any throw, unlink them plus `--out`, then rethrow. Copy voice-gen's structure so the two plugins fail identically. *(spec §2.5)*
10. **Implement the illustration branch's insertion + captions** — validate each anchor occurs exactly once in the body, insert the markdown image reference at each, build `CaptionEntry[]`. Never write to the input file. *(R4)*
11. **Write `tests/image-gen.test.ts`** with a stub provider factory: happy path per job, the anchor round-trip against the `article-before.md` fixture, cap refusal without calling the stub, dry run, mid-run failure cleanup, empty input. Test intent: the money-spending and file-deleting paths are the ones that must be pinned before an adapter exists. *(all)*
12. **Amend `docs/design/generator-plugin-specification.md:56-57`** with the `format: "image"` clause, in the D5 clause's shape. *(deliverable)*
13. **Add the `plugins.generations.image-gen.env` block to `plugins/kk/config.example.yaml`** using 0103's inventory keys, placeholder values only, plus `KK_IMAGE_MAX_IMAGES`. *(deliverable)*
14. **Add the `image-gen` row to `docs/04_DESIGN.md`** — same commit as the surface change (repo rule T3). *(deliverable)*
15. **Write the workflow fragment into this task's `## Solution`** and run it with `KK_IMAGE_DRY_RUN=1` to prove the two-node handoff. *(R5)*
16. **Run the gate** — `bun run autofix && bun run spur-check`; `bun run lint`, `bun run test`, `bun run build` all clean, coverage ≥90%. *(all)*
17. **Close the ticket** — `spur task update 0104 done`, append one line to feature K's `## Decisions so far` (envelope on `docs[0].metadata.imageGen`, artefacts beside `--out`, `format: "image"` amended, cap + dry-run seam).

### Solution

`plugins/generations/image-gen/src/index.ts` wires the 0102 presets, 0103 provider registry, and the 0104 job mapping (`src/job.ts`) into one generator entry: envelope parse (`DocListSchema`) → per-doc job spec (`metadata.imageGen`, zod strict) → budget cap (`maxImages` > `KK_IMAGE_MAX_IMAGES` > default 4, enforced before any provider call) → provider selection (`selectProvider`, credential inventory at `src/providers/types.ts`) → dispatch by job (`free`/`cover` compose the prompt into `Content.body`; `illustration` rewrites the article — insertion seam, positions stay with the skill) → `KK_IMAGE_DRY_RUN=1` stops at the composed-prompt boundary (`metadata.dryRun: true`, empty `images[]`, no bytes, no network). Errors exit loud via `echoError` (`@gobing-ai/ts-utils`) per `.spur/rules/typescript/output-boundaries.yaml`.

**R5 two-node run (executed in this tree):**
Node 1: `KK_IMAGE_DRY_RUN=1 ARK_API_KEY=dry-run-placeholder kk executor run image-gen --in $W/cover-job.json --out $W/5-images/content.json` → exit 0; content sha256 `8f9406ee…`; `format: "image"`, `metadata = {generator: kk:image-gen, job: cover, images: [], sourceDocId, dryRun: true}` (dry-run selects the provider first by design — placeholder credential, no call). Node 2: `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake kk executor run emdash-pub --in content.json --out result.json` → exit 0, `result = {ok: true, target: fake-file-cli, url, id}`; input content.json byte-identical after node 2 (sha unchanged). The task fragment's `ghost-pub` is notional (no such plugin); `emdash-pub` on its fake transport is the real-plugin stand-in for the AC's "fake publish target".

Fragment (quoted `${vars.*}` per the 0059 word-splitting scar):

```yaml
- id: cover
  run: >
    kk executor run image-gen
    --in "${vars.work_dir}/2-outline/cover-job.json"
    --out "${vars.work_dir}/5-images/content.json"
- id: publish
  run: >
    kk executor run ghost-pub
    --in "${vars.work_dir}/5-images/content.json"
    --out "${vars.work_dir}/6-publish/result.json"
```

**Spec-amendment deliverables (same-commit rule T3, applied this tree):**
- `docs/design/generator-plugin-specification.md:57` — `format` clause now names feature **K** / `image-gen` / `format: "image"`, documents the job-dependent `body` asymmetry (prompt for free/cover, rewritten article for illustration) and the `metadata.images[]` shape, in the D5 clause's shape.
- `plugins/kk/config.example.yaml:26-90` — `plugins.generations.image-gen.env` block, full 0103 inventory, placeholder values only, including `KK_IMAGE_MAX_IMAGES` and `KK_IMAGE_DRY_RUN`; source-of-truth pointer to the plugin's own example.
- `docs/04_DESIGN.md:220` — `plugins/generations/image-gen` added as a generator-kind example row.

**Verification:** `bun run spur-check` 717 tests / 0 fail (image-gen 74/74, plugin coverage 96.55–100% line / 100% func), post-check rules 2/2 (`.spur/run/0104-test-gate.log`); real-executor dry-run + two-node handoff as above; review PASS-WITH-NOTES (`.spur/run/0104-review.md`) — P1 deliverable gap and R5 Solution closed by this section's edits; P4 advisories (outputStem traversal guard, parseInt leniency, dead cleanup loop) ride the 0105 adapter hop.

### Testing

**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact) — adapter-hop deferral discharged by 0107 (implementation `f3bc10c`, verify PASS `.spur/run/0107-verdict.json`, 2026-09-10): byte-writer, illustration insertion, written[] tracking all implemented and fresh-tested; deferral rows below updated to MET.

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Per-job IO: envelope src/job.ts:15-104 (strict zod ImageJobSpecSchema), typed ImageArtifact/ImageGenMetadata src/job.ts:56-92; per-job prompt mapping src/index.ts:110-133; disk leg discharged by 0107 (`f3bc10c`: money branch writes bytes via artifactPath; adapter.test money-branch legs fresh pass) |
| R2 | MET | Real-executor proof: missing-spec exit 1 naming metadata.imageGen and the three jobs (--out absent); bare-prompt dry run exit 0, no Input schema violation; DocListSchema contract apps/cli/src/invoke.ts:251 — AC-1/AC-2 |
| R3 | MET | Mechanism proven: src/paths.ts:19-22 resolves every artefact path against dirname(--out), never process.cwd(); zero-pad/collision unit-proven tests/paths.test.ts:9-34; fresh executor run created zero files under the plugin dir; file-level positive legs discharged by 0107 (`f3bc10c`; AC-3/AC-4 rows below) |
| R4 | MET | Contract proven: ImageArtifact + CaptionEntry shapes src/job.ts:56-92; insertion seam skill-decides/plugin-performs; input never mutated (sha256 unchanged through dry and non-dry runs); body round-trip file proof discharged by 0107 (`f3bc10c` illustration round-trip test) |
| R5 | MET | Fragment in task ## Solution with quoted ${vars.*}; freshly executed two-node run — image-gen dry-run (exit 0) then emdash-pub on KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake (exit 0, ok true), node-1 content.json sha256 identical after node 2 — AC-11 |
| R6 | MET | Cap: ImageJobSpec.maxImages > KK_IMAGE_MAX_IMAGES > default 4, enforced src/index.ts:160-168 before provider resolution at :171 (count 9 refused exit 1 naming cap 4; spec cap 2 beats env 10); dry run: KK_IMAGE_DRY_RUN=1 composes prompts for all three jobs, metadata.dryRun true, images [], no bytes, no call — AC-6/AC-7/AC-8 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| A bare prompt survives the executor's input validation (R2) | MET | command | Fresh run: [{"id":"p1","body":"a red bicycle","metadata":{"imageGen":{"job":"free"}}}] with KK_IMAGE_DRY_RUN=1 ARK_API_KEY=dry-run-placeholder -> exit 0, stderr empty, ContentSchema-parsed output |
| A missing job spec fails loud and early (R1) | MET | command | Fresh run doc without metadata.imageGen -> exit 1 naming metadata.imageGen and 'free', 'cover', 'illustration'; --out never written |
| Artefacts land beside `--out`, never in the plugin directory (R3) | MET | test | Discharged by 0107 (`f3bc10c`): byte-writer live at the money branch, artefact paths asserted under --out dir in adapter.test money-branch leg (fresh pass 2026-09-10); mechanism unit-proven (src/paths.ts:19-22, tests/paths.test.ts:29-34) |
| Artefact names are deterministic and zero-padded (R3) | MET | test | Discharged by 0107: deterministic zero-padded overwrite across re-runs proven end-to-end (adapter.test 'deterministic zero-padded names overwrite across re-runs', fresh pass); naming logic unit-proven (tests/paths.test.ts:9-27) |
| The illustration round trip preserves the original (R4) | MET | command | Discharged by 0107: insertion + captions implemented with occurs-exactly-once anchor check; round-trip test proves input body not mutated and refs+captions inserted (adapter.test illustration leg, fresh pass 2026-09-10) |
| The budget cap refuses before spending (R6) | MET | command | Fresh run illustration count 9, no maxImages -> exit 1 'Image count 9 exceeds the budget cap 4', --out absent; cap check src/index.ts:160-168 precedes provider resolution :171; unit tests/image-gen.test.ts:173-185 proves the stub is never called |
| `KK_IMAGE_MAX_IMAGES` overrides the compiled default (R6) | MET | test | Discharged by 0107: 9-image override leg completes end-to-end through the money branch (adapter.test 'KK_IMAGE_MAX_IMAGES override leg with 9 images', fresh pass); precedence mechanism unit-proven (tests/image-gen.test.ts:187-202; src/index.ts:42-56) |
| A dry run composes prompts and spends nothing (R6) | MET | command | Fresh executor dry runs for all three jobs -> exit 0, only content.json written, metadata.dryRun true, images [], body = fully composed prompt; no generate call on the dry path (src/index.ts:173-195); provider-selection-needs-credential is documented select-then-skip design (review P4) |
| A failure leaves nothing behind (spec §2.5) | MET | test | --out deleted before run and re-deleted on any throw (src/index.ts:138,203); unit-proven tests/image-gen.test.ts:270-275; artefact leg vacuous until the writer exists (written[] tracking is the registered no-op scaffold) |
| Empty input is a notice, not a failure (spec §2.5) | MET | command | Fresh run --in [] -> exit 0, --out holds EMPTY_CONTENT notice byte-matching src/index.ts:15-20 written at :149-152 |
| The workflow example runs end to end (R5) | MET | command | Fresh two-node run: node 1 image-gen dry-run exit 0 (content sha256 733b5466...); node 2 emdash-pub KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake exit 0 result ok:true; node-1 sha identical after node 2 (publish consumed exactly the written content.json); ghost-pub notional per the task's fake-publish-target wording; fragment in ## Solution |
| The spec amendment and surface docs land in the same commit (deliverable) | MET | static-ref | `git show --stat 40b461e` confirms all three surfaces in the implementing commit: docs/design/generator-plugin-specification.md format clause, plugins/kk/config.example.yaml env block (KK_IMAGE_MAX_IMAGES + KK_IMAGE_DRY_RUN), docs/04_DESIGN.md example row — T3 satisfied |
| The gate is clean (all) | MET | command | Fresh full re-run: bun run lint 0; bun run test 0 (717 pass / 0 fail / 0 skip, image-gen coverage >=96.55 line / 100 func); bun run build 0; matches recorded gate .spur/run/0104-test-gate.log (717/0, rules 2/2, PASS, digest 3f00a478 = marker); harness nit: -t 'stale --out' filtered run ENOENT on missing setup dir, full suite green |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PARTIAL)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P1 | evidence-rule-failed | — | Executable evidence missing for: The spec amendment and surface docs land in the same commit (deliverable) |

### References

**Hard constraints this ticket is built on** (all verified 2026-09-09):

- `apps/cli/src/invoke.ts:118-122` — the frozen plugin argv; the reason job parameters ride in `--in`.
- `apps/cli/src/invoke.ts:251` — `contract.input.safeParse` pre-validation and the `Input schema violation for kind '<kind>'` message.
- `apps/cli/src/invoke.ts` (`cwd = record.dir`, `KNOWLEDGE_KIT_PROJECT_ROOT` injection, `plugins.<collection>.<name>.env` merged under `process.env`).
- `apps/cli/src/commands/executor.ts:137-147` — `kk executor run <plugin> --in --out`; the only other flags are `--plugins-root` / `--plugins-path`, neither forwarded.
- `packages/kk-core/src/kinds.ts:59` — `generator: { input: DocListSchema, output: ContentSchema }`; `:60-68` — task 0100's scar comment.
- `packages/kk-core/src/schemas.ts:4-11,14-28` — `DocSchema` and `ContentSchema` field lists, including `references[] = {url?, title?, cite?}`.

**In-repo precedent:**

- `plugins/generations/voice-gen/src/index.ts` — binary artefacts as siblings of `--out`, `parseArgs({in,out})`, `EMPTY_CONTENT` notice, failure cleanup, `format: 'audio'` emission.
- `plugins/generations/voice-gen/package.json` — the package scaffold.
- `plugins/generations/content-gen/src/index.ts` — the `Doc[]` → article path.
- `plugins/kk/commands/workflow-run.md:146,167` — how a workflow node expands `works_dir` into `--out`.
- `docs/tasks/0059_prototype-the-daily-kk-storm-research-workflow.md:204` — the unquoted-`${vars.*}` word-splitting bug the workflow fragment must not repeat.

**Docs this ticket edits:**

- `docs/design/generator-plugin-specification.md:56-57` — the `format` clause and its existing D5 `"audio"` amendment, the template for the `"image"` amendment. §2.5 supplies the empty-input / failure / invalid-output semantics.
- `plugins/kk/config.example.yaml:1` — `works_dir`; the file that gains the `image-gen` env block.
- `docs/04_DESIGN.md:263,280` — the config-key and env-var tables that gain `image-gen` rows.

**Behaviour being reproduced:**

- `/Users/robin/projects/cc-agents/plugins/wt/skills/image-illustrator/examples/{article-before.md,positions-detected.md,article-after.md,captions.json}` — the illustration round trip, and the fixture the AC's anchor scenario uses.

**Upstream / downstream:** consumes 0102 (`composePrompt`, `FormatPreset`, `StylePreset`, `resolvePresetRoots`) and 0103 (`selectProvider`, `ImageProvider`, `ImageRequest`, `ImageResult`); hands 0106 the `--in` envelope, the `Content` shape, the `metadata.positions` handoff, and the `KK_IMAGE_DRY_RUN` confirmation mechanism.

### History

- 2026-09-09T21:15:33.167Z backlog → todo (system)
- 2026-09-09T23:19:53.239Z todo → wip (system)
- 2026-09-10T00:43:25.318Z wip → testing (system)
- 2026-09-10T00:43:33.593Z testing → done (system)
- 2026-09-10 Adapter-hop deferral discharged by 0107 (`f3bc10c`, verify PASS `.spur/run/0107-verdict.json`): 4 deferral PARTIAL rows + same-commit deliverable row updated to MET in Testing. done_reason above retained as the original force audit record.

