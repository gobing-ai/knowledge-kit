---
schema_version: 1
name: kk wiki noun foundation, config and raw ingest
status: todo
template: feature-impl
created_at: 2026-11-10T19:11:03.849Z
updated_at: "2026-11-10T19:36:34.226Z"
feature_id: I1
priority: P1
tags:
  - wiki
  - cli
estimate_hours: 5

---

## 9350. kk wiki noun foundation, config and raw ingest

### Background

`kk` has eleven nouns (`apps/cli/src/cli.ts:29-39`) and none of them touches a Markdown vault. This task creates `packages/kk-wiki` (`@gobing-ai/kk-wiki`, ADR-046) with only the pieces ingest needs - the raw-snapshot writer and the page/frontmatter schema - and registers the `kk wiki` noun with its first verb, so the remaining verbs land on an existing seam instead of inventing one each.

The noun also fixes the conventions every later verb copies: the config resolver, the `--json` document shape, and the exit-code contract (0 success / 1 handled failure / 2 usage). Getting those in one place now is what keeps twelve verbs from growing twelve conventions.

Implements: R2 - Ingest a local file into a raw snapshot with frontmatter; R3 - Ingest a URL or stdin source into the same raw shape; R4 - Ingest rejects an unsupported source type; R19 - Every wiki verb supports JSON output and a stable exit code; R20 - Configuration resolves from kk.config.json and the environment.

Rubric: E2 D2 L2 C1 R1 = 8 -> decompose (new package + new noun + config seam).

Rejected: putting the vault helpers inside `apps/cli` - it violates the module-boundaries invariant that shared logic lives in `packages/*`.

**Refine corrections (2026-11-10)**
- `packages/kk-core/src/index.ts:1-40` -> the entry is 86 lines and the `Doc` contract is exported at `packages/kk-core/src/index.ts:71` -> import `Doc` from the package entry, not a deep path.
- HTML/PDF/URL text extraction was delegated to the skill -> the repository already carries the markitdown normaliser seam: a runner interface at `plugins/ingestions/web-search/src/index.ts:59` and the real runner (`markitdown -x .html`, HTML on stdin, markdown on stdout) at `plugins/ingestions/web-search/src/index.ts:74`, per ADR-013 D3 -> `ingest` reuses that pattern and fails loud when the binary is absent.
- Config resolution cited no precedent -> `apps/cli/src/itc-config.ts:1-11` states the house rule (a module owns only its own block, never creates the config file, fails on an unsupported declared key) -> `apps/cli/src/wiki/config.ts` follows it.
- The project-level `kk.config.json` had no stated relationship to the existing global `~/.config/kk/config.yaml` -> two overlapping config truths is the drift risk -> the split is frozen below and recorded as an ADR before the verb ships.
- No YAML dependency exists (root, `apps/cli` and `packages/kk-core` declare `zod` but no YAML library) -> the page frontmatter is flat scalars plus string arrays parsed line by line -> no new dependency enters the repo for this task.
- Coverage was unstated -> `bunfig.toml` enforces 90% lines/functions per file -> every new file needs its own tests, not aggregate coverage from a sibling.

### Requirements

- [ ] R1. `packages/kk-wiki` exists as a Bun workspace (workspace glob `package.json:9`) exporting `writeRawSnapshot` and the page frontmatter schema.
- [ ] R2. `kk wiki ingest <source>` writes `raw/<type>/<id>.md` with `title`, `source_type`, `source_uri` and `ingested_at` frontmatter.
- [ ] R3. `kk wiki ingest -` reads the body from stdin and records stdin as its origin.
- [ ] R4. An unknown extension with no `--type` exits 2 naming the unsupported type and writes nothing.
- [ ] R5. `--type html|pdf|url` extracts its body through the markitdown runner pattern; when the binary is absent the command exits 1 naming the missing tool and writes nothing.
- [ ] R6. Every wiki verb prints one JSON document carrying `ok` when `--json` is passed, and returns 0 / 1 / 2 for success / handled failure / usage error.
- [ ] R7. `apps/cli/src/wiki/config.ts` resolves `kk.config.json` then `KK_WIKI_*` then built-in defaults, wins over `~/.config/kk/config.yaml` for vault paths only, never creates or rewrites the config file, and fails naming an unsupported declared key.
- [ ] R8. The project-file versus global-file config split is recorded in an ADR in the same commit that ships the resolver.
- [ ] R9. Every new file in `packages/kk-wiki` and `apps/cli/src/wiki` clears the per-file coverage threshold with its own tests.

### Acceptance Criteria

- [ ] AC1 — Ingest a local file into a raw snapshot with frontmatter
- [ ] AC2 — Ingest a URL or stdin source into the same raw shape
- [ ] AC3 — Ingest rejects an unsupported source type
- [ ] AC4 — Every wiki verb supports JSON output and a stable exit code
- [ ] AC5 — Configuration resolves from kk.config.json and the environment

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Approach.** `packages/kk-wiki/src/page.ts` owns the frontmatter schema and a line-based splitter (`parseFrontmatter`, `renderPage`); `packages/kk-wiki/src/raw.ts` owns `writeRawSnapshot({type, source, body, dir}) -> {path}`; `apps/cli/src/commands/wiki.ts` registers the noun and one subcommand module per verb under `apps/cli/src/wiki/`; `apps/cli/src/wiki/config.ts` resolves config and is the only place a path is computed.

**Frozen names.**
- Package: `packages/kk-wiki`, name `@gobing-ai/kk-wiki`.
- Exports: `writeRawSnapshot`, `parsePage`, `renderPage`, `PageFrontmatterSchema`, `WikiConfigError`.
- Config type: `WikiConfig = { root, raw, content, defaultType, mirrors: string[], remotes: Record<string, { command: string, remote: string }> }`.
- Env prefix: `KK_WIKI_` (`KK_WIKI_ROOT`, `KK_WIKI_RAW`, `KK_WIKI_CONTENT`).
- CLI module: `apps/cli/src/commands/wiki.ts`; verb modules `apps/cli/src/wiki/{ingest,config}.ts`.
- File frontmatter keys: `title`, `type`, `tags`, `sources`, `updated_at`, `user_edited`.

**Frontmatter contract (no YAML dependency).** Frontmatter is `---`-delimited, one flat `key: value` per line, with string arrays written as `- item` lines under the key. Nested maps are a lint error, never silently parsed. Scalars are read literally (no type coercion beyond booleans for `user_edited`).

**Config split (frozen).** `kk.config.json` at the project root owns vault paths, defaults, mirrors and remote definitions. `~/.config/kk/config.yaml` keeps owning channels, presets and credentials. Precedence inside the project file's own keys: flag -> `KK_WIKI_*` -> `kk.config.json` -> built-in default. The resolver never writes either file and fails naming an unsupported key instead of ignoring it.

**Invariants.**
- `kk-wiki` imports `@gobing-ai/kk-core`, `zod`, `node:fs`, `node:path` only; no provider client, no executor seam, no browser automation, no store.
- Every verb module exports `run<Verb>(args, deps) -> result` returning plain data; `apps/cli` renders JSON or text, so tests never parse console output.
- Exit codes: 0 success, 1 handled failure (reported in the JSON `error` field), 2 usage error.

**Anti-patterns (do not implement).**
- No `--force` that overwrites a page; the guard lands in the next task and this task must not create a bypass path.
- No config caching across invocations; resolution is per run so an edited file takes effect immediately.
- No shelling out to `python`/`pandoc` as a second extractor; markitdown is the only normaliser.

**Test observability.** Fixtures under `packages/kk-wiki/tests/fixtures/`; CLI assertions go through the `main(argv)` seam with captured writers (`apps/cli/src/main.ts:6-14`), so a JSON-shape change fails a test rather than a log grep.

**Handoff to dependents.** 9351 consumes `PageFrontmatterSchema` and `parsePage`; 9352/9353/9354 consume `WikiConfig`. Do not rename those exports without updating those tasks.

**Rejected.** Reusing the ingestion-plugin `Doc[]` path for file ingest: plugins need a `plugin.json` and a runner per source, while `ingest` must accept one arbitrary file or stdin; the plugin path stays the projection route for karakeep/R2 folders. Rejected a YAML parser dependency: it would add a runtime dependency for a format this project writes itself.

### Plan

1. Create `packages/kk-wiki` (package.json, tsconfig extending `tooling/typescript`, `src/page.ts`, `src/raw.ts`) and add it to the workspace build.
2. Write the markitdown-backed extractor used by `--type html|pdf|url`, mirroring `plugins/ingestions/web-search/src/index.ts:59,74` (PATH probe, fail loud, no silent empty body).
3. Add `apps/cli/src/wiki/config.ts` (project file -> env -> defaults, fail on unknown key) and register the `wiki` noun in `apps/cli/src/cli.ts`.
4. Implement `apps/cli/src/wiki/ingest.ts` for file, stdin and `--type` handling, including the exit-code table.
5. Record the config split as an ADR entry (amendment to ADR-046 or ADR-047) in the same commit.
6. Write package unit tests (html/rss/stdin/markitdown-absent fixtures) and CLI tests for `--json`, exit codes and config precedence; confirm per-file coverage.
7. Transcribe the shipped verb flags into `docs/04_DESIGN.md` §1 and mark `docs/design/kk-wiki.md` status as partially implemented.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: `docs/features/I1_kk-wiki-vault-cli.md` — AC R2, R3, R4, R19, R20.
- Decision: `docs/00_ADR.md:1679` ADR-046 (model-free vault package behind the `kk wiki` noun).
- Shapes: `docs/design/kk-wiki.md:19-31` (package boundary), `docs/design/kk-wiki.md:92-110` (config keys).
- Noun registration site this task extends: `apps/cli/src/cli.ts:29-39`.
- Workspace globs that admit a new package: `package.json:6-13`.
- Contracts the package may import: `packages/kk-core/src/index.ts:1-40`.
- Discovery: `docs/plans/2026-11-10-kk-wiki-brainstorm.md`.

### History
