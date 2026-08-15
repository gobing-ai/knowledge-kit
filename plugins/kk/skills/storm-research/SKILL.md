---
name: storm-research
description: >-
  Use the storm-research skill to run daily STORM research — turn a research topic
  sentence or a markdown source file into a grounded STORM Content report with a content.md
  sidecar ("research X", "produce a research report on X", "run today's STORM research",
  "turn this brief into a researched report"). The machine is the 0059 workflow
  (prepare → ingest → generate → render) over the 0056 works layout. Research is separate from
  authoring: topic owns init→outline→draft and this skill never merges into topic.
version: 0.1.0
---

# storm-research — STORM daily research (topic sentence XOR markdown file → content.md)

## Purpose

Turn one research topic (a sentence) or one markdown source file into a **grounded STORM
`Content` report** plus a `content.md` sidecar by composing the `web-search` ingestion plugin,
the `content-gen` generator, and the `render-md` helper. The machine is the 0059 workflow
(`prepare → ingest → generate → render → done|failed`); this skill owns the **craft** — framing
the query, deciding when to re-run ingest, and verifying the report against the evidence.

Research is **not** authoring. `topic` owns `init → outline → draft` from an approved
outline; this skill owns evidence gathering. **Do not merge this into `topic`.**

## When to use / not to use

Use when:

- A user asks to research a topic: "research X", "produce a research report on X", "run today's
  STORM research", "what does the evidence say about X".
- A user supplies a markdown source (brief, notes, outline) that should ground the report —
  pass it with `--in <file>`.

Do **not** use for:

- Authoring an article from a topic with no research need — that is `topic`.
- Quality gating / judging generated content — that is `judge`.
- Publishing, platform adaptation, or illustration — out of C4 scope.
- Anything requiring a raw `kk executor run` chain when the workflow already composes it.

## Invocation contract

Same arguments as `/workflow-run` (the thin command delegates here for craft):

```
[workflow-name] <topic | --in <file>> [--fixture] [--force]
```

| Token | Meaning | Default |
| --- | --- | --- |
| `workflow-name` | installed workflow YAML name; must match `^[a-z0-9][a-z0-9-]*$` and not be `--in` | `kk-storm-research` |
| `<topic>` | a **specific research question** (better-report a — prefer a question over a noun phrase) | required unless `--in` |
| `--in <file>` | markdown file mode (XOR with `<topic>`) | — |
| `--fixture` | force `fixture: "true"` (offline stub ingest) | config default (`false` for real runs) |
| `--force` | overwrite an existing dest workflow YAML | off |

**XOR rule:** exactly one of `<topic>` / `--in <file>` must be set. Both set or both empty →
fail loud, no writes. `--in` and a bare topic token are mutually exclusive.

The operator invocation in practice is `/workflow-run <topic>` or `/workflow-run --in <file>`; the
skill is also callable directly as `Skill(skill="storm-research", args="<topic|--in file> ...")`.

## How to run

1. **Frame the query** (better-report a): prefer a specific question over a noun phrase.
   "What are the known failure modes of vector databases at 1B rows?" beats "vector databases".
   A question constrains the search and the report; a noun phrase invites scope creep.
2. **Choose input**: topic sentence, or a markdown file via `--in` (XOR). File mode derives the
   query from the first ATX H1 (`/^#\s+(.+)$/m`), else the basename without extension.
3. **`work_dir` is the resolved topic directory** `$works_dir/<topic-id>`, computed by the
   invoker (the command or the operator) via the 0056 `topicId()` algorithm — never by the
   workflow. `prepare` only `mkdir` + materializes files into `${vars.work_dir}`.
4. **Pick fixture vs live** (see below). Default is live (`fixture: "false"`); pass
   `fixture: "true"` for offline/dry-run/CI.
5. **Run** the workflow and collect the outputs: `content.md` (report sidecar), `content.json`
   (machine contract), `docs.json` (evidence). Read the report against the evidence before
   presenting it (better-report d).

## topicId algorithm (0056, frozen)

`topicId(raw: string)` — computed by the **invoker**, never by the workflow YAML:

1. `normalized` = trim, collapse whitespace, lowercase.
2. `slug` = replace `[^a-z0-9]+` with `-`, squeeze dashes, trim dashes, slice to **48 chars**,
   trim dashes again. If empty → `topic`.
3. `hash` = `sha256(normalized).digest('hex').slice(0, 8)`.
4. Return `slug + '-' + hash`.

- Sentence mode: `raw` = the topic string. File mode: `raw` = first ATX H1 else basename
  without extension.
- Same `raw` → same id → same workspace. **Last write wins**; do not fail on an existing
  works dir (re-running a topic is legal — no `--force` needed).
- If `raw` derives empty (no H1 and an empty basename, e.g. a file named `.md`) → fail loud.

## Works layout (0056, frozen)

Per-topic workspace at `$works_dir/<topic-id>/`:

| File | Written by | Contents |
| --- | --- | --- |
| `topic.json` | prepare | ingest `--in` (`topic`, `maxResults`, `fixture`) |
| `input.md` | prepare (file mode only) | verbatim copy of the operator file |
| `local-doc.json` | prepare (file mode only) | one-element `Doc[]` (id = `sha256('file://'+absPath).hex.slice(0,16)`, rank `-1`, position `0`) |
| `docs.json` | ingest | `web-search` output `Doc[]` |
| `content.json` | generate | STORM `Content` (machine contract) |
| `content.md` | render | markdown sidecar report |

Contrast: `topic`'s authoring workspace is `./<kebab-case(topic)>` with `brief.md` /
`2-outline/` / `3-draft/` and explicitly excludes research. C4 works live under `$works_dir`,
outside any repo.

## Live vs fixture

| Mode | `fixture` | Behavior | Requires |
| --- | --- | --- | --- |
| Live | `"false"` (default) | `web-search` calls the Firecrawl search API (`POST https://api.firecrawl.dev/v2/search`, `scrapeOptions.formats: ["markdown"]`), maps `data.web[]` to `Doc[]` | `FIRECRAWL_API_KEY` env var; unset → the ingest exits 1 ("FIRECRAWL_API_KEY is unset") |
| Fixture | `"true"` | `web-search` emits canned `Doc[]` (stable `sha256(sourceUri)` ids); no network, no key | none — offline/dry-run/CI |

- `FIRECRAWL_API_KEY` is **env-only** — never a config key, never a workflow var, never in the
  report.
- Real daily research defaults to live. **`fixture: true` is not research** (better-report b) —
  the canned docs are for machine checks, not for evidence a reader should trust.

## Fail-loud table (0056 rows the agent must execute)

| Condition | Behavior | Recovery |
| --- | --- | --- |
| Both `<topic>` and `--in` set, or neither | exit 1, stderr states the XOR rule; no writes | pass exactly one of `topic` / `--in` |
| `--in` file unreadable (missing / I/O) | exit 1, stderr names the path | fix the path / permissions |
| Derived query / topic-id empty (no H1 and empty basename) | exit 1, stderr shows the derived value | add an H1 or give the file a real name |
| Dest `$workflows_dir/<name>.yaml` exists with different bytes | warning, **no overwrite**; run proceeds with the user's copy | re-run with `--force` to replace from the install source |
| Workflow YAML cannot be resolved from any install source | exit 1, stderr lists the roots searched | reinstall the package / set `KK_WORKFLOWS_SOURCE` |
| `KK_CONFIG` set but unreadable, or config unparseable / invalid types | exit 1, stderr names the key + expected vs actual type | fix the file, or delete it (recreated with defaults next run) |
| Missing config at `KK_CONFIG` | **not a failure** — create-on-first-run with compiled defaults; an existing file is never overwritten | — |

Every failure names the exact path and the exact next command. Never silently skip, never
auto-replace, never hash topic-id in the YAML.

## Better-report practices (R1)

1. **(a) Prefer a specific question over a noun phrase.** A question ("How does X behave under
   Y?") pins the search and the report's thesis; a noun ("X") leaves scope open.
2. **(b) Do not treat `fixture: true` as research.** Fixture output is canned — fine for
   pipeline checks, never a source of claims to present to a reader.
3. **(c) Re-run ingest only when the query or sources must change.** If the question is
   unchanged and the sources are the same, **reuse `docs.json`** — do not re-fetch. Only a new
   query, new sources, or stale evidence justifies a fresh ingest.
4. **(d) Read `content.md` citations against `docs.json` ids.** Every citation in the report
   must resolve to a Doc id present in `docs.json`; verify the claim against that Doc's body
   before trusting it. A citation to a missing id is a defect — fix the report, not the id list.
5. **Cap `maxResults` before widening.** Start at the default (`8`); only widen when the first
   pass demonstrably misses coverage. More results is not better grounding — it is more noise.
6. **Prefer primary sources in the markdown input file.** When a source file is supplied via
   `--in`, favor the primary material in it (first-party specs, owned notes, authoritative
   extracts) as the spine of the report; web results fill gaps, not the reverse.

## Invariants

- The invoker computes `topicId` and passes `work_dir` resolved; the workflow never hashes.
- XOR input always — exactly one of `topic` / `input_file`.
- Never promise a judge gate or query expansion in this skill (C4 scope: neither exists).
- No new `kk` first-layer noun (ADR-011) — this skill runs through the workflow, not through a
  `kk` CLI verb.
- `FIRECRAWL_API_KEY` stays env-only.
- Works layout file names are frozen (0056) — do not rename or add sidecars in this skill.
