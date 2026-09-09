---
schema_version: 1
name: Map image jobs onto the generator-plugin Doc-to-Content IO contract
status: backlog
template: feature-impl
created_at: 2026-09-09T18:28:33.705Z
updated_at: "2026-09-09T20:32:41.703Z"
feature_id: K

ac_altitude: task-local
dependencies: ["0102", "0103"]
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

- [ ] R1. **Per-job IO table** — for each of `free`, `cover`, `illustration`: what the input `Doc[]`/`Brief` carries, what `Content.body` holds, what `Content.metadata` holds (at minimum a typed `images[]` with path, format, style, provider, prompt, seed), and what lands on disk.
- [ ] R2. **The `free` job's input shape** — a bare prompt is not a document. Decide whether it arrives as a single synthetic `Doc` with `body` = prompt, or via plugin options, and confirm the executor's `--in` validation accepts it. Verify against `executor.ts`, not by assumption.
- [ ] R3. **Output file location and naming** — under `works_dir`, deterministic and collision-safe, surviving a multi-node workflow run so a downstream publish node can find the cover.
- [ ] R4. **The illustration round-trip** — how the rewritten article markdown and the captions manifest are returned without losing the original, and whether the rewrite belongs in the plugin or in the calling skill.
- [ ] R5. **Workflow invocation example** — a concrete `spur workflow` node calling `kk exec image-gen`, showing a cover produced in one node and consumed in the next.
- [ ] R6. **The confirmation/budget seam** — the map's open question about non-interactive runs lands here as a plugin option; propose the option and its default, and flag it for the operator rather than deciding it alone.

Deliver a compiling `index.ts` skeleton with the types wired and the three job branches stubbed. It need not generate an image.

### Acceptance Criteria

Task-local acceptance criteria. Feature K is a `wayfinder-map` carrying a prose no-AC disclaimer, so these scenarios are the executable contract for this ticket alone.

#### Scenario: A bare prompt survives the executor's input validation (R2)

- **Given** a file containing `[{"id":"p1","body":"a red bicycle","metadata":{"imageGen":{"job":"free"}}}]`
- **And** `KK_IMAGE_DRY_RUN=1`
- **When** `kk executor run image-gen --in <that file> --out <tmp>/content.json` is run
- **Then** the process exits 0
- **And** stderr contains no `Input schema violation for kind 'generator'`
- **And** `<tmp>/content.json` parses against `ContentSchema`

#### Scenario: A missing job spec fails loud and early (R1)

- **Given** an input array whose first `Doc` has no `metadata.imageGen`
- **When** the plugin runs
- **Then** it exits non-zero
- **And** the error names the expected path `metadata.imageGen` and lists `free`, `cover`, `illustration`
- **And** no image file is written and `--out` does not exist

#### Scenario: Artefacts land beside `--out`, never in the plugin directory (R3)

- **Given** a `cover` job and `--out` set to `<tmp>/5-images/content.json`
- **When** the plugin runs with a stub provider returning 1 PNG
- **Then** exactly `<tmp>/5-images/content-cover-01.png` exists
- **And** no file was created under `plugins/generations/image-gen/`
- **And** `metadata.images[0].path` is that absolute path
- **And** `references[0].url` equals `file://` + that path

#### Scenario: Artefact names are deterministic and zero-padded (R3)

- **Given** an `illustration` job with `count: 3` and `--out` `<tmp>/content.json`
- **When** the plugin runs twice against the same `--out`
- **Then** both runs produce exactly `content-illustration-01.png`, `-02.png`, `-03.png`
- **And** the second run overwrites rather than appending a fourth file

#### Scenario: The illustration round trip preserves the original (R4)

- **Given** an input `Doc` whose `body` is the article from `image-illustrator/examples/article-before.md`
- **And** `metadata.positions` naming two anchors
- **When** the plugin runs with a stub provider
- **Then** `Content.body` contains both image references at those anchors and is otherwise byte-identical to the input body
- **And** the input file on disk is unchanged (compare a hash taken before the run)
- **And** `metadata.captions` has one entry per image, each with `index`, `path`, `caption`, `altText`, `anchor`
- **And** `metadata.sourceDocId` equals the input doc's `id`

#### Scenario: The budget cap refuses before spending (R6)

- **Given** an `illustration` job with `count: 9` and no `maxImages`
- **And** a provider stub that throws if `generate` is called
- **When** the plugin runs
- **Then** it exits non-zero with a message naming `9` and the cap `4`
- **And** the stub was never called
- **And** `--out` does not exist

#### Scenario: `KK_IMAGE_MAX_IMAGES` overrides the compiled default (R6)

- **Given** `KK_IMAGE_MAX_IMAGES=10` and an `illustration` job with `count: 9`
- **When** the plugin runs with a stub provider
- **Then** it exits 0 and `metadata.images` has 9 entries
- **And** with `maxImages: 2` also set in the spec, the same run instead fails naming the cap `2` — the spec value wins over the env

#### Scenario: A dry run composes prompts and spends nothing (R6)

- **Given** `KK_IMAGE_DRY_RUN=1` and a provider stub that throws if `generate` is called
- **When** a `cover` job runs
- **Then** it exits 0, the stub was never called, and no image file exists
- **And** `Content.metadata.dryRun` is `true`, `metadata.images` is empty
- **And** `Content.body` is the fully composed prompt string

#### Scenario: A failure leaves nothing behind (spec §2.5)

- **Given** a provider stub that throws on the **second** of three images
- **When** an `illustration` job runs
- **Then** the process exits non-zero
- **And** neither `--out` nor any `content-illustration-*.png` from that run exists

#### Scenario: Empty input is a notice, not a failure (spec §2.5)

- **Given** an `--in` file containing `[]`
- **When** the plugin runs
- **Then** it exits 0 and `--out` holds the `EMPTY_CONTENT` notice `Content`, matching voice-gen's behaviour

#### Scenario: The workflow example runs end to end (R5)

- **Given** the two-node YAML fragment from the Design, with `KK_IMAGE_DRY_RUN=1` and a fake publish target
- **When** the workflow runs
- **Then** both nodes exit 0
- **And** the publish node's input is the exact `content.json` the image node wrote

#### Scenario: The spec amendment and surface docs land in the same commit (deliverable)

- **Given** the commit implementing this ticket
- **When** `git show --stat` is read
- **Then** it includes `docs/design/generator-plugin-specification.md`, `docs/04_DESIGN.md` and `plugins/kk/config.example.yaml`
- **And** the generator spec's `format` clause names `image-gen` and `format: "image"`
- **And** the `config.example.yaml` block contains no real credential value

#### Scenario: The gate is clean (all)

- **Given** the working tree at this task's HEAD
- **When** `bun run lint`, `bun run test` and `bun run build` run
- **Then** all three exit 0, no test is skipped, and coverage on `plugins/generations/image-gen/` is ≥90% line and ≥90% function

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

**WHAT** — the frozen input envelope, output shape, on-disk layout and budget seam for `plugins/generations/image-gen`, plus a compiling `src/index.ts` skeleton with the three job branches stubbed. **WHY frozen here:** 0106's skill writes the `--in` file and reads the `Content`; if this shape moves later, every skill example and workflow node moves with it.

#### The input envelope (R1, R2) — frozen

There is exactly one job per invocation (one `--out`), and the only channel into the plugin is the `--in` array. So the job spec rides on the **first document's metadata**, and the array itself is the content:

```ts
// plugins/generations/image-gen/src/job.ts
export interface ImageJobSpec {
    job: 'free' | 'cover' | 'illustration';
    format?: string;                    // FormatPreset name (0102); default per job, below
    style?: string;                     // StylePreset name; default = format.defaultStyle
    vars?: Record<string, string>;      // template variables (0102 composePrompt)
    extra?: string;                     // free-text appended as composePrompt's 4th segment
    provider?: string;                  // 0103 selectProvider's `requested`
    model?: string;
    referenceImages?: string[];         // absolute paths (0105 pass-through)
    count?: number;                     // illustration only; images to produce
    maxImages?: number;                 // budget cap, see R6
    seed?: number;
    outputStem?: string;                // overrides the `--out` basename for artefact names
}
export const ImageJobSpecSchema = z.object({ /* mirrors the interface, all optional but `job` */ });
```

Read it from `docs[0].metadata?.imageGen`, parse with zod, and **fail loud** on a missing or malformed spec with a message naming the expected path and the valid `job` values. Per-job defaults for `format`: `free → 'free'`, `cover → 'cover'`, `illustration → 'illustration'` — the three format presets 0102 ships, so a spec of `{ job: 'cover' }` alone is a complete, working job.

Rejected alternatives, with reasons: **an env-carried JSON blob** (`KK_IMAGE_JOB`) — env is for credentials and machine config, and a per-run blob there is invisible in the `--in` artefact a workflow leaves behind; **a synthetic control `Doc` with a magic `id`** — a magic id is a second, undiscoverable schema layered on the first; **new executor flags** — that is an ADR-level change to the spawn contract (`apps/cli/src/invoke.ts:118-122`) for one plugin's convenience.

Per-job input:

| Job | `--in` array | Notes |
| --- | --- | --- |
| `free` | exactly one `Doc`: `{ id, body: <the prompt>, metadata.imageGen }` | A bare prompt **is** a valid `Doc` — `DocSchema` needs only `id` and `body`. R2 resolved: no schema change, no new input form. Verify by running the executor (see the AC scenario), not by reading `kinds.ts`. |
| `cover` | one `Doc` = the article (`body` = markdown, `title` = headline) | The plugin does **not** analyse the article; the caller supplies `vars`/`style`. Content analysis is 0106's (model work). |
| `illustration` | one `Doc` = the article, `metadata.imageGen.count` = N, plus `metadata.positions` = the caller's chosen insertion points | Position detection is model work → 0106. The plugin executes a decided plan. |

#### Output (R1, R4) — frozen

`Content.format = 'image'` for all three jobs. `Content.body` differs by job, deliberately:

| Job | `body` | `title` |
| --- | --- | --- |
| `free`, `cover` | the **composed prompt actually sent**, one per image, joined by `\n\n---\n\n` | the format preset's name |
| `illustration` | the **rewritten article markdown** with image references inserted | the source doc's `title` |

The asymmetry is the honest one: for `illustration` the rewritten article is the deliverable a downstream publish node consumes directly from `body`; for the other two the deliverable is the file, and the prompt is the reproducible record of how it was made.

`Content.metadata` (frozen keys):

```ts
{
  generator: 'kk:image-gen',
  job: 'free' | 'cover' | 'illustration',
  images: ImageArtifact[],
  sourceDocId?: string,        // illustration/cover: the input doc's id
  captions?: CaptionEntry[],   // illustration only — the captions.json payload
  dryRun?: true,               // set only when the run spent nothing (R6)
}

export interface ImageArtifact {
    path: string;      // absolute
    format: string;    // FormatPreset name
    style: string;     // StylePreset name
    provider: string;
    model: string;
    prompt: string;    // the exact string sent
    seed?: number;
    width?: number;
    height?: number;
    bytes: number;
}
export interface CaptionEntry { index: number; path: string; caption: string; altText: string; anchor: string }
```

`Content.references` additionally carries one `{ url: 'file://<abs path>', title: '<format> <NN>' }` per image, so a generic consumer that knows nothing about `metadata.images` still finds the files. **The original article is never mutated** — the input file is read-only and the rewrite exists only in `body`; `metadata.sourceDocId` names what it was derived from (R4).

**R4's second half — where does the rewrite live?** In the **plugin**, not the skill. Inserting a markdown image reference at a caller-supplied anchor is deterministic string work, and doing it in the plugin is what makes `body` a self-contained deliverable. Choosing *where* the images go is model work and stays in 0106. The seam is: **skill decides positions, plugin performs insertion.**

#### On-disk layout (R3) — frozen

Artefacts are **siblings of `--out`**, the voice-gen rule (`plugins/generations/voice-gen/src/index.ts`), because `works_dir` is not readable from inside a plugin (see Background). Naming:

```
<outDir>/<outStem>-<format>-<NN>.<ext>       # NN zero-padded from 01, ext from ImageResult.extension
```

`outStem` = `ImageJobSpec.outputStem ?? basename(--out) without extension`. Deterministic and collision-safe **within a run**; a re-run against the same `--out` overwrites, which is correct — `--out` identifies the run. The invoker gets `works_dir` semantics by pointing `--out` at `$work_dir/<stage>/content.json`, exactly as `plugins/kk/commands/workflow-run.md:146` already does for other stages. Every emitted path is `resolve()`d; **never** resolve against `process.cwd()` — a plugin's cwd is its own package directory.

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

A plugin is a spawned subprocess with no interactive channel, so **it can never prompt**. Confirmation is 0106's; this ticket provides the two mechanisms 0106 needs:

1. **A hard cap.** Images per invocation are capped by `ImageJobSpec.maxImages` → `KK_IMAGE_MAX_IMAGES` → compiled default **4**. Exceeding it throws **before any provider call**, naming the requested count and the cap. Precedence follows the repo rule "flag > env > config > compiled default" (`plugins/kk/config.example.yaml`) with `maxImages` occupying the flag slot, since flags cannot reach here.
2. **A dry run.** `KK_IMAGE_DRY_RUN=1` composes every prompt, selects the provider, writes a normal `Content` with `metadata.dryRun: true` and an empty `images[]`, spends nothing and writes no image files. This is the mechanism a skill uses to show the operator exactly what a run will cost before asking for confirmation.

**Flagged for the operator, not decided here** (map open question, non-interactive spend): the default cap value of 4, and whether a workflow node should be required to set `maxImages` explicitly rather than inherit a default. Both are one-line changes; neither blocks this ticket.

#### Failure and empty-input semantics (spec §2.5)

- **Empty `--in` array** → write the `EMPTY_CONTENT` notice `Content` and exit **0**, mirroring voice-gen.
- **Any failure** → delete `--out` and every artefact written during the run, then rethrow so the executor sees a non-zero exit. A half-written run must leave nothing behind.
- **Invalid spec, unknown preset, unknown provider, cap exceeded** → all fail before the first provider call.

#### Required doc edits (deliverables of this ticket)

1. `docs/design/generator-plugin-specification.md:56-57` — extend the `format` clause with an amendment naming this feature: `image-gen` emits `format: "image"`, artefact paths in `metadata.images[].path`, prompt-or-article in `body`. Same shape as the existing D5 clause for `"audio"`.
2. `plugins/kk/config.example.yaml` — add the `plugins.generations.image-gen.env` block (credential keys come from 0103's inventory; placeholder values only) plus `KK_IMAGE_MAX_IMAGES`.
3. `docs/04_DESIGN.md` — one row for `image-gen` wherever generator plugins are listed, in the **same commit** (repo rule T3).

#### Scope

Deliver a **compiling** `src/index.ts` with `parseArgs({ in, out })`, spec parsing, preset resolution (0102), provider selection (0103), the three job branches **stubbed**, artefact naming, `Content` emission, and the failure cleanup path. It need not generate a real image; the provider call site is a single `await provider.generate(req)` behind an injectable factory, so tests reach 100% of the surrounding logic without a network.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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
