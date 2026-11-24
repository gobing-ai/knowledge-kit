---
schema_version: 1
name: Register kk_* CLI and workflow MCP tools via plugins/kk/mcp-tools.yaml and metadata.mcp
status: todo
template: feature-impl
created_at: 2026-11-24T05:37:29.878Z
updated_at: "2026-11-24T05:45:00.326Z"

feature_id: B8
ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 3
---

## 0428. Register kk_* CLI and workflow MCP tools via plugins/kk/mcp-tools.yaml and metadata.mcp

### Background

Expose `knowledge-kit` (`kk`) workflows and direct CLI capabilities as `kk_*` MCP tools through Spur's embedded MCP server (`spur-new` Task `1447` / Feature `B91`), so coding agents and the Spur gateway root `/mcp` can invoke `kk` tools without shelling out or duplicating server infrastructure.

**Cross-repo dependency (blocking):** `spur-new` Task `1447` (declarative `plugins/<ns>/mcp-tools.yaml` loader + typed `metadata.mcp.params`) is still `todo` and itself waits on `1445`/`1446` (both `todo`). The installed `spur` is `0.4.46` and ships no manifest loader. `spur task deps` cannot express a cross-repo edge, so the dependency lives in Plan step 0 as a hard precondition. 1447's Q&A names this task's scope as the `kk` follow-up ("`kk_store_*`, `kk_wiki_*`, plus `metadata.mcp` on selected workflows").

**Refine corrections (2026-11-23)**

1. Manifest shape (old R1: `inputSchema`, `shell: false`, `output: json`) → the frozen 1447 R1 contract is `schema_version: 1`, `tools[]` with `name` (`^[a-z][a-z0-9_]{0,47}$`, exposed as `kk_<name>`), `description`, all three `annotations` booleans, optional `params` (`{type, description?, enum?, default?, required?}`), fixed `command` argv, per-param `args` fragments (`{value}` = one whole element), `output: json|text`, `timeoutMs`; strict, no `inputSchema`/`shell` keys (they would be rejected as unknown) → R1 rewritten to that contract.
2. Workflow annotations (old R2: `readOnlyHint`/`idempotentHint` per workflow) → 1447 correction 3 / 1421 R2 freeze workflow tools as write + non-idempotent; no override exists → removed; R2 now uses `metadata.mcp.params` (typed allowlist) only.
3. Old R1 surfaces `kk content` and `kk schedule list/status/validate/show` → `kk content` is not a CLI noun (`apps/cli/src/index.ts` registers board/bot/article/news/executor/ledger/lock/music/plugin/schedule/stage/store/wiki); `kk schedule` has only `render` (`apps/cli/src/commands/schedule.ts:302`) → dropped.
4. "read-only and guarded write" CLI tools → every non-read verb in scope mutates the store/vault (`store migrate|ingest|label|select|mark-published|release`, `wiki ingest|synthesize|merge|gc|publish|sync`); `kk plugin check` may launch browsers (`plugin.ts:354` comment) → manifest is read-only only: `plugin status`, `store stats`, `wiki query`, `wiki context`. `wiki lint` dropped: it exits 1 on findings (`commands/wiki.ts:43-47`), and 1447 R3 turns any non-zero exit into a tool error carrying only the stderr tail, so the JSON findings would be lost.
5. Command `bun run apps/cli/src/index.ts …` → kept as checkout source (installed `kk` drifts from the checkout, AGENTS.md "Editing apps/cli"), but spelled `["bun", "apps/cli/src/index.ts", …]`; 1447 R3 runs it with `cwd = ctx.cwd` (the project root).
6. Workflow set (old R2: 6 workflows) → `kk-publish` performs external multi-channel publishing (`live_channels`, `live_confirm`) — exposing it to any MCP client bypasses the operator-authorization rule for publishing; `kk-solo-podcast` (`pause: true` at `:94,:196`) and `kk-article-generate` (`:93,:115,:186`) pause on HITL gates that an MCP `tools/call` cannot answer → all three removed. Kept: `kk-storm-research`, `kk-smart-seo`, `kk-collect`.
7. Tool names → `workflowToolName` (`spur-new packages/app/src/services/mcp-workflow-tools.ts:33-38`) yields `kk_kk_storm_research`, `kk_kk_smart_seo`, `kk_kk_collect` (stutter accepted; renaming workflows is out of scope).
8. Old R3 "`spur workflow validate` exposes `kk_*` tools" → 1447 correction 8: validate filters exposure issues to the workflow file and is not a manifest surface; issues surface via `tools/list` / `catalog().exposureIssues` / Integrations → R3 rewritten.
9. Feature B8 has only a placeholder scenario → ACs are `task-local`.

### Requirements

- [ ] R1. Add `plugins/kk/mcp-tools.yaml` (`schema_version: 1`, strict 1447 R1 contract) declaring exactly four read-only tools, each with `annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true}`, `output: json`, and `command` starting `["bun", "apps/cli/src/index.ts", …, "--json"]`: `plugin_status` (param `kind` enum `ingestion|generator|publish`), `store_stats` (param `days` number), `wiki_query` (param `prompt` string required, `limit` number), `wiki_context` (param `topic` string required, `depth` number).
- [ ] R2. Opt `plugins/kk/workflows/{kk-storm-research,kk-smart-seo,kk-collect}.yaml` into MCP with `metadata.mcp.expose: true` plus a typed `metadata.mcp.params` allowlist: storm-research → `topic` (string, required), `maxResults` (number), `fixture` (boolean); smart-seo → `options_file` (string, required); collect → `limit` (number), `last30days_topic` (string), `horizon_hours` (number). Path, executable, plugin-selection and engine vars (`work_dir`, `input_file`, `plugins_path`, `render_script`, `ingestion_plugin`, `generator_plugin`, `stamp`, `__*`) are never declared. No workflow annotations.
- [ ] R3. With a Spur build containing 1447, `tools/list` on the knowledge-kit serve and on the gateway root `/mcp` lists the 4 manifest tools and 3 workflow tools with zero `catalog().exposureIssues` (no `no-namespace`, `builtin-collision`, `duplicate`, `invalid-manifest`, `invalid-params`), and `tools/call kk_store_stats` returns parsed JSON.

**Out of scope:** write/mutating `kk` verbs as manifest tools; `kk-publish`, `kk-solo-podcast`, `kk-article-generate`, daily/music/example workflows; renaming workflows to drop the `kk_kk_` stutter; any edit in `spur-new`; a kk-side copy of the manifest JSON Schema.

### Acceptance Criteria

```gherkin
Scenario: AC1 — every manifest tool runs its argv to exit 0 and parseable JSON (req: R1)
  Given `plugins/kk/mcp-tools.yaml` parsed with Bun.YAML and an isolated temp project (empty `.works/kk.db` via `kk store migrate`, a two-page vault under `KK_WIKI_ROOT`, HOME pointed at the temp dir)
  When each tool's argv is built as `command` + its `args` fragments filled with test values (argv[1] resolved to the repo's `apps/cli/src/index.ts`) and spawned with cwd = the temp project
  Then each exits 0, stdout parses as JSON, the four names are exactly `plugin_status, store_stats, wiki_query, wiki_context`, every tool has `readOnlyHint: true` and `output: json`, and no fragment embeds `{value}` inside a larger element
  # apps/cli/tests/mcp-tools-manifest.e2e.test.ts

Scenario: AC2 — exposed workflows declare only safe, existing vars (req: R2)
  Given the three opted-in workflow YAMLs
  When their `metadata.mcp` blocks are read
  Then each has `expose: true`, every `params` key exists in `vars`, no `params` key is in the forbidden set (work_dir, input_file, plugins_path, render_script, ingestion_plugin, generator_plugin, stamp, any `__` var), no `annotations` key is present
  And no other workflow under `plugins/kk/workflows/` declares `metadata.mcp.expose: true`
  # apps/cli/tests/mcp-tools-manifest.e2e.test.ts

Scenario: AC3 — the live Spur MCP surface lists all kk tools cleanly (req: R3)
  Given a Spur build containing spur-new 1447 serving this checkout
  When `tools/list` runs on the project `/mcp` and on the gateway root `/mcp`, and `tools/call kk_store_stats {days: 1}` runs
  Then the 7 names `kk_plugin_status, kk_store_stats, kk_wiki_query, kk_wiki_context, kk_kk_storm_research, kk_kk_smart_seo, kk_kk_collect` are listed, exposure issues are empty, and the call returns `{days, byDay, bySource}`
  # manual E2E; JSON-RPC transcript saved to .spur/run/0428-mcp-e2e.json and cited in Testing
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-24T05:44:50.509Z

- **Q: Which CLI verbs become manifest tools?** Decided: read-only, side-effect-free verbs only (`plugin status`, `store stats`, `wiki query`, `wiki context`). Mutating verbs need a guard story Spur does not provide (no per-tool confirmation); `plugin check` can open browsers; `wiki lint` exits 1 on findings and would surface as an error. Deferred: write tools, when Spur adds a confirmation/approval hook for manifest tools.
- **Q: Which workflows are exposed?** Decided: `kk-storm-research`, `kk-smart-seo`, `kk-collect`. `kk-publish` is excluded (external publishing needs explicit operator authorization); `kk-solo-podcast`/`kk-article-generate` are excluded (HITL pauses unanswerable over MCP). Deferred: HITL workflows, when Spur's MCP surface documents paused-run continuation.
- **Q: `kk` on PATH or checkout source?** Decided: `bun apps/cli/src/index.ts` — the checkout is what the serve's project root is; the installed `kk` is known to drift.
- **Q: Rename workflows to avoid `kk_kk_*`?** Decided: no; workflow names are referenced by schedules, ledgers and the Board.
- **Q: Ship kk work before 1447 lands?** Decided: no. Plan step 0 blocks; the strict upstream schema would refuse a manifest written against a guessed contract. Owner of the unblock: spur-new 1447.

### Design

**WHAT:** two declarative artifacts consumed by Spur 1447 — a strict `plugins/kk/mcp-tools.yaml` and `metadata.mcp` blocks on three workflows — plus one bun:test file. **No new API**: no TS source change in `apps/cli` or `packages`, no new `kk` verb, no `docs/04_DESIGN.md` surface change (MCP names derive from existing verbs/workflows; add one line under the plugin layout in `docs/03_ARCHITECTURE.md` only if it already documents `plugins/kk/` files).

**WHY:** namespace `kk` already resolves from `plugins/kk/plugin.json` (`name: "kk"`); 1447 makes the manifest and params the only registration seam, with the spawn path limited to operator-authored project manifests (1447 ADR-152 amendment).

**Frozen manifest (`plugins/kk/mcp-tools.yaml`):**

```yaml
schema_version: 1
tools:
  - name: plugin_status
    description: List discovered kk plugins grouped by kind with health marks.
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    params:
      kind: { type: string, enum: [ingestion, generator, publish], description: Filter by plugin kind }
    command: [bun, apps/cli/src/index.ts, plugin, status, --json]
    args: { kind: ["--kind", "{value}"] }
    output: json
  - name: store_stats
    description: New-item yield per local day per source channel (read-only).
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    params:
      days: { type: number, description: Trailing window in days }
    command: [bun, apps/cli/src/index.ts, store, stats, --json]
    args: { days: ["--days", "{value}"] }
    output: json
  - name: wiki_query
    description: Rank wiki vault pages against a prompt.
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    params:
      prompt: { type: string, required: true, description: Search prompt }
      limit: { type: number, description: Maximum hits (default 10) }
    command: [bun, apps/cli/src/index.ts, wiki, query, --json]
    args: { prompt: ["{value}"], limit: ["--limit", "{value}"] }
    output: json
  - name: wiki_context
    description: Pack a wiki topic page and its graph neighbours into one Markdown block.
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    params:
      topic: { type: string, required: true, description: Topic title or slug }
      depth: { type: number, description: Neighbour depth (default 1) }
    command: [bun, apps/cli/src/index.ts, wiki, context, --json]
    args: { topic: ["{value}"], depth: ["--depth", "{value}"] }
    output: json
```

Verified flags: `plugin.ts:329-333`, `store.ts:1670-1675` (default db = kk config `store.db_path`, else `.works/kk.db` under cwd), `commands/wiki.ts:193-205` (vault from `resolveWikiConfig`, `KK_WIKI_ROOT` override at `wiki/config.ts:56`). Positional `{value}` after `--json` is accepted by Commander. Free-form strings starting with `-` are refused upstream (1447 R3) — acceptable for prompts/topics.

**Frozen workflow opt-ins** (append a top-level `metadata:` block; keep existing keys untouched):

```yaml
# kk-storm-research.yaml
metadata:
  mcp:
    expose: true
    params:
      topic: { type: string, required: true, description: Research question (sentence mode) }
      maxResults: { type: number, description: Search results per query (default 8) }
      fixture: { type: boolean, description: Use the stub ingestion (dry run) }
# kk-smart-seo.yaml
metadata:
  mcp:
    expose: true
    params:
      options_file: { type: string, required: true, description: Path to the UTF-8 JSON options file (max 64 KiB) }
# kk-collect.yaml
metadata:
  mcp:
    expose: true
    params:
      limit: { type: number, description: Items per source (default 10) }
      last30days_topic: { type: string, description: last30days source topic }
      horizon_hours: { type: number, description: Lookback window in hours (default 6) }
```

Upstream stringifies typed values (`true` → `"true"`, `8` → `"8"`), matching the YAML string defaults. Undeclared vars keep their YAML defaults (allowlist, 1447 R4). `kk-collect` is lock-guarded single-flight, so an MCP call racing the 6 h tick fails cleanly rather than double-collecting.

**Test file `apps/cli/tests/mcp-tools-manifest.e2e.test.ts`:** parse with `Bun.YAML.parse`; for AC1 build argv in-test (command + fragments, `{value}` substituted, declaration order — mirror of 1447 R3, ~10 lines, no import from spur), replace argv[1] with the absolute repo path, spawn with `Bun.spawn`, cwd/HOME/`KK_WIKI_ROOT` on a `tmp/test-mcp-tools` scratch dir; seed via `kk store migrate` and two vault Markdown pages. AC2 is a pure YAML assertion over `plugins/kk/workflows/*.yaml`.

**Anti-patterns:** no `inputSchema`/`shell` keys (strict schema rejects them); no `{value}` inside a larger element (`--days={value}`); no `kk` (PATH) in `command`; no workflow `annotations`; no mutating verb in the manifest; do not import Spur internals into tests; do not edit `spur-new`.

**Concurrency:** worktree `knowledge-kit-runall-L4-5c3f` and wip task `0426` exist; neither touches `plugins/kk/mcp-tools.yaml` or the three workflow `metadata` blocks — re-check `git diff main -- plugins/kk/workflows` before editing.

### Plan

0. **Precondition (blocking):** confirm spur-new `1447` is `done` and a Spur build with the manifest loader is available (released `spur` or source-local `spur serve` from spur-new). Re-read 1447's final Zod schema/`mcp-tools.schema.json`; if any frozen key here differs, update Design via refine before coding. Without it, stop — do not write against a guessed schema.
1. (R1, R2) Write `apps/cli/tests/mcp-tools-manifest.e2e.test.ts` covering AC1 + AC2; confirm it fails (files absent).
2. (R1) Add `plugins/kk/mcp-tools.yaml` exactly as frozen; validate it against spur's `apps/cli/schemas/mcp-tools.schema.json` once (ad hoc, not committed).
3. (R2) Append the three `metadata.mcp` blocks; run `spur workflow validate` on each (workflow-level issues incl. `invalid-params`).
4. Run the new test, then `bun run gate` (format, build, lint, rules, tests; per-file coverage unaffected — no TS source added).
5. (R3) Manual E2E: serve knowledge-kit with the 1447 Spur build; JSON-RPC `tools/list` on project `/mcp` and gateway root `/mcp`, `tools/call kk_store_stats {"days":1}`; save the transcript to `.spur/run/0428-mcp-e2e.json` and cite it in Testing (AC3).
6. If the published plugin bundle must carry the manifest (`scripts/bundle-plugins`), confirm `mcp-tools.yaml` is copied with `plugins/kk/`; otherwise note it as checkout-only in Solution.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Upstream contract & loader: spur-new task `1447` (`/Users/robin/xprojects/spur-new/docs/tasks5/1447_downstream-mcp-tool-registration-manifest-mcp-tools-yaml-and.md`), deps `1445`, `1446`
- Workflow tool naming: spur-new `packages/app/src/services/mcp-workflow-tools.ts:33-38`
- Plugin manifest: `plugins/kk/plugin.json` (`name: "kk"`)
- CLI verbs: `apps/cli/src/commands/plugin.ts:325-361`, `store.ts:1670-1675`, `wiki.ts:43-47,193-210`, `schedule.ts:299-312`
- Workflows: `plugins/kk/workflows/` (symlinked at `.spur/workflows`)
- Concurrency at refine time: worktree `knowledge-kit-runall-L4-5c3f`, wip `0426`

### History

- 2026-11-24T05:45:00.326Z backlog → todo (system)

