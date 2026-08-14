# STORM Topic-Research Workflow (`kk-storm-research`)

Turn one research topic into a grounded STORM `Content` report by composing the `web-search`
ingestion plugin with the existing `content-gen` generator — no publish step. This is the C3
dry-run prototype (feature C3, tasks 0054 + 0055): the workflow shape is proven end-to-end, but
the ingest side is a **fixture stub** — there is no live Firecrawl client in v1.

```
topic (--vars)  →  web-search (ingest)  →  content-gen (generate)  →  Content (content.json)
        │                │                            │
   work/topic.json   work/docs.json              work/content.json
```

Pieces: workflow `.spur/workflows/kk-storm-research.yaml` · plugin
`plugins/ingestions/web-search/` · ingest contract `docs/tasks/0054_specify-the-firecrawl-topic-to-doc-ingest-contract.md`
(Solution blocks 1–8).

## Prerequisites

- Repo checkout with dependencies installed: `bun install`.
- **`kk` on PATH with the `executor` verb** — the workflow shells `kk executor run`. A stale
  globally-installed `kk` (e.g. a pre-`executor` build) will fail at the `ingest`/`generate`
  states. Build and link the repo CLI:

  ```bash
  bun run build                  # builds apps/cli → dist/index.js (bin: kk)
  cd apps/cli && bun link        # makes `kk` resolve to this build
  ```

  Sanity check — this must list `web-search`:

  ```bash
  kk plugin status --kind ingestion --plugins-path ./plugins --json
  ```

- **Real runs (not dry-run) also need the spur agent** — `content-gen`'s STORM pipeline calls
  `spur agent run` for its generation stages. Check with `spur agent doctor <agent>` (the
  configured default; `omp` in this repo).

## Run it

### 1. Validate the workflow

```bash
spur workflow validate .spur/workflows/kk-storm-research.yaml --json
```

### 2. Dry-run — no network, no LLM, no writes to `work/`

```bash
spur workflow run .spur/workflows/kk-storm-research.yaml --dry-run --run-id dry-1 --json
```

Expect `status: done` with terminal state `done` (3 transitions:
`prepare → ingest → generate`). Success edges use `guard: { kind: always }`, which is what lets
dry-run walk to `done` — do not switch them to `action-ok` (that guard denies in dry-run because
no actions execute).

### 3. Real run

```bash
spur workflow run .spur/workflows/kk-storm-research.yaml \
  --vars '{"topic":"<your research topic>","maxResults":"8"}'
```

What happens per state:

| State | Action | Writes |
|---|---|---|
| `prepare` | materializes the `--vars` into the ingest `--in` JSON (always `"fixture": true`) | `${work_dir}/topic.json` |
| `ingest` | `kk executor run web-search --in topic.json --out docs.json --plugins-path ./plugins` | `${work_dir}/docs.json` (3 canned `Doc[]`) |
| `generate` | `kk executor run content-gen --in docs.json --out content.json --plugins-path ./plugins` | `${work_dir}/content.json` (STORM `Content`) |

Monitor a long run: `spur workflow trace <run-id> --json`.

## Workflow vars (all strings)

| Var | Default | Role |
|---|---|---|
| `topic` | — (required at run) | the research topic; sent verbatim as the ingest query |
| `maxResults` | `"8"` | caps the ingested item count (written into `--in` as an int) |
| `work_dir` | `"./work"` | artifact dir (`topic.json`, `docs.json`, `content.json`) |
| `plugins_path` | `"./plugins"` | `--plugins-path` for `kk executor run` |
| `ingestion_plugin` | `"web-search"` | executor name |
| `generator_plugin` | `"content-gen"` | executor name |

## Using `web-search` directly

```bash
kk executor run web-search --in in.json --out docs.json --plugins-path ./plugins
```

`--in` JSON (0054 contract): `topic` **required** (non-empty string); `maxResults` optional
(positive int, default 8 — caps the emitted list); `fixture` optional (boolean).

v1 stub behavior: `fixture: true` emits canned `Doc[]` (stable `sha256(sourceUri)` 16-hex ids,
markdown bodies — citation-safe for D4). `fixture` absent/false selects the **not-implemented**
live path: exit 1 with `live Firecrawl not implemented in v1 (pass "fixture": true to use the
fixture stub)`, no `--out`. Missing/invalid `topic` → exit 1. No `FIRECRAWL_API_KEY` is used in
v1 (env-only by contract; the live client is future work).

## Limitations (v1 scope)

- **No live Firecrawl** — ingest is the fixture stub; the future live path (`POST
  https://api.firecrawl.dev/v2/search` + `scrapeOptions.formats: ["markdown"]`) is specified in
  the 0054 contract but not implemented.
- **No query expansion** — `topic` is sent verbatim as the single query.
- **Generate requires the spur agent** — `content-gen` runs its STORM stages via `spur agent run`.
- **No publish state** — by design; the workflow terminates at Content-written `done`. Publish,
  judge gate, and a human-readable `content.md` sidecar are out of scope for C3.

## Under the hood (maintainer guide)

Everything the end-user sections above describe is composed of exactly two artifacts: the
workflow state machine and the `web-search` plugin. The third input — *how* ingest must behave —
is not code at all: it is the 0054 contract in the task file's Solution (blocks 1–8). The plugin
and workflow are written *against* that contract; when you change behavior, update the contract
first or note the deliberate departure in the same change.

### File inventory

| File | Role |
|---|---|
| `.spur/workflows/kk-storm-research.yaml` | the orchestration: `prepare → ingest → generate → done/failed` |
| `plugins/ingestions/web-search/plugin.json` | manifest (`name: web-search`, `kind: ingestion`, `entry: ./src/index.ts`) — registry discovery (ADR-009) |
| `plugins/ingestions/web-search/src/index.ts` | the executable: `--in`/`--out` entry, validation, fixture Doc builder |
| `plugins/ingestions/web-search/tests/web-search.test.ts` | 12 tests: contract behavior + fail-loud paths |
| `plugins/ingestions/web-search/package.json` + `tsconfig.json` | workspace member `@gobing-ai/web-search` (copied from `content-gen`) so typecheck/CI cover it |
| `docs/tasks/0054_specify-the-firecrawl-topic-to-doc-ingest-contract.md` | **authoritative ingest contract** (Solution blocks 1–8: `--in` schema, env/auth, call sequence, Doc mapping, fail-loud table, C1-tension note, citations, 0055 handoff) |
| `docs/03_ARCHITECTURE.md` / `docs/04_DESIGN.md` | tree + module rows for `@gobing-ai/web-search` (T3: sync in the same commit as surface changes) |

### How the workflow works

- **State machine.** `prepare` runs two shell actions: `mkdir -p ${vars.work_dir}`, then a `jq`
  that materializes the operator `--vars` into `${work_dir}/topic.json`
  (`{topic, maxResults (tonumber), fixture: true}`). `ingest` and `generate` are single
  `kk executor run` shell actions chaining `web-search` → `content-gen`. `done`/`failed` are
  terminals — there is no publish state.
- **All vars are strings** (`spur workflow --vars` rejects non-string values) — numeric-looking
  vars like `maxResults: "8"` are coerced at materialization time with `($maxResults | tonumber)`.
- **Why success edges use `guard: { kind: always }`** (the one non-obvious decision — do not
  "fix" it): the engine evaluates `action-ok` as `lastActionResult?.ok === true`, and in
  `--dry-run` no actions execute (engine substitutes an empty outcome), so `action-ok` **always
  denies** and the walk falls to `failed` — dry-runs would never reach `done`. Real-run safety is
  unchanged: a failed shell action short-circuits at the state under the default `onError: fail`
  policy, before transitions are evaluated. `always` on the *success* edge is therefore correct
  in both modes. (Same convention as `.spur/workflows/task-pipeline.yaml:232,237,254`.)
- **Quote the `$schema`** value in the YAML or YAML parsing mangles it.

### How the plugin works

`main()` flow: `parseArgs` (`--in`/`--out`) → missing args = stderr + exit 1 → read `--in` →
`parseInput` (throws on invalid JSON / non-object / missing-or-blank `topic` / non-positive
`maxResults`) → **fixture branch**: `fixture !== true` → stderr `live Firecrawl not implemented
in v1…` + exit 1 (the not-implemented live path fails loud rather than fabricating docs) →
`buildFixtureDocs` → `DocListSchema.parse` → `mkdir` + write `--out` → exit 0.

- **Doc mapping** (0054 block 4): `id` = `sha256(sourceUri).hex.slice(0,16)` (`computeId`,
  same id-stability idea as `karakeep-local`), `body` = fixture markdown (required), `title`/
  `sourceUri` SHOULD, `mediaType: text/markdown`, `metadata {query, rank (0-based), position,
  scraped_at (per-run ISO — determinism is required only for `id`)}`. Every emitted Doc survives
  D4's `assertKnownEvidence` citation gate (`content-gen/src/storm.ts`).
- **Invocation contract**: `kindContract('ingestion')` = `{ input: null, output:
  DocListSchema }`; the plugin is spawned by the sanctioned `runInvoke` path
  (`apps/cli/src/invoke.ts`), never a hand-rolled spawn. Tests go through `runInvoke` to prove
  the executor path.
- **No network code exists.** No `fetch`, no Firecrawl SDK, no `FIRECRAWL_API_KEY` read — by
  design in v1.

### Testing & verification

- Plugin: `bun test plugins/ingestions/web-search/tests/web-search.test.ts` — 12 tests covering
  schema-valid output, deterministic ids across runs, `maxResults` cap, the `runInvoke` executor
  path, live-mode fail-loud (stderr asserted), missing-topic fail-loud, `parseInput` edge cases,
  missing-args, and write-failure. Coverage ≈ 100% functions / 99% lines on `src/index.ts`.
  Fail-loud tests capture `console.error` and assert the message — keep that pattern; a
  regression that leaks stderr into the runner output is a test bug.
- Workflow: `spur workflow validate .spur/workflows/kk-storm-research.yaml --json` then
  `--dry-run` (must reach `status: done`) — the dry-run is the executable proof of the machine's
  shape.
- Full gate after any change: `bun run lint && bun run test && bun run build` (the plugin is a
  workspace member, so typecheck/lint already cover it).

### Enhancing it

- **Live Firecrawl path** (the big one): implement the `fixture !== true` branch per 0054
  blocks 2–5 — `POST https://api.firecrawl.dev/v2/search` with
  `scrapeOptions.formats: ["markdown"]`, `Authorization: Bearer ${process.env.FIRECRAWL_API_KEY}`
  (env-only, never in `--in`/`plugin.json`), map `data.web[]` per the Doc-mapping table, honor
  the 8-row fail-loud table (zero hits → `[]` + exit 0; hits-but-zero-bodies → exit 1 — the
  documented C1 departure). Keep `fixture: true` as the offline stub.
- **Query expansion**: currently `topic` is the single verbatim query. Expansion belongs either
  in the plugin (expand before the request) or in a new `prepare` step — decide per 0054's
  "expansion is C3 fog" note and record the decision in the contract.
- **Publish / judge gate / `content.md` sidecar**: out of scope for C3 by design. To add them,
  clone the shape from `.spur/workflows/kk-ingest-generate-publish.yaml` (the workflow this one
  was cut from) — do not bolt publish states onto this prototype without re-opening C3.
- **Contract drift rule**: the 0054 Solution is the contract of record. If a change makes the
  plugin or workflow depart from it (fail-loud row, Doc mapping field, env name), update the
  task's Solution in the same change and re-run the fail-loud tests — the tests encode the
  contract.
