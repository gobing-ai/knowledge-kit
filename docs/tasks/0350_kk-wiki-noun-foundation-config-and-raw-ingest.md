---
schema_version: 1
name: kk wiki noun foundation, config and raw ingest
status: done
template: feature-impl
created_at: 2026-11-10T19:11:03.849Z
updated_at: "2026-11-10T22:55:06.882Z"
feature_id: I1
priority: P1
tags:
  - wiki
  - cli
estimate_hours: 5

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0350-verdict.json
---

## 0350. kk wiki noun foundation, config and raw ingest

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

- [x] R1. `packages/kk-wiki` exists as a Bun workspace (workspace glob `package.json:9`) exporting `writeRawSnapshot` and the page frontmatter schema.
- [x] R2. `kk wiki ingest <source>` writes `raw/<type>/<id>.md` with `title`, `source_type`, `source_uri` and `ingested_at` frontmatter.
- [x] R3. `kk wiki ingest -` reads the body from stdin and records stdin as its origin.
- [x] R4. An unknown extension with no `--type` exits 2 naming the unsupported type and writes nothing.
- [x] R5. `--type html|pdf|url` extracts its body through the markitdown runner pattern; when the binary is absent the command exits 1 naming the missing tool and writes nothing.
- [x] R6. Every wiki verb prints one JSON document carrying `ok` when `--json` is passed, and returns 0 / 1 / 2 for success / handled failure / usage error.
- [x] R7. `apps/cli/src/wiki/config.ts` resolves `kk.config.json` then `KK_WIKI_*` then built-in defaults, wins over `~/.config/kk/config.yaml` for vault paths only, never creates or rewrites the config file, and fails naming an unsupported declared key.
- [x] R8. The project-file versus global-file config split is recorded in an ADR in the same commit that ships the resolver.
- [x] R9. Every new file in `packages/kk-wiki` and `apps/cli/src/wiki` clears the per-file coverage threshold with its own tests.

### Acceptance Criteria

- [x] AC1 — Ingest a local file into a raw snapshot with frontmatter
- [x] AC2 — Ingest a URL or stdin source into the same raw shape
- [x] AC3 — Ingest rejects an unsupported source type
- [x] AC4 — Every wiki verb supports JSON output and a stable exit code
- [x] AC5 — Configuration resolves from kk.config.json and the environment

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

**Handoff to dependents.** 0351 consumes `PageFrontmatterSchema` and `parsePage`; 0352/0353/0354 consume `WikiConfig`. Do not rename those exports without updating those tasks.

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

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/package.json:4` |
| `apps/cli/package.json:51` |
| `apps/cli/src/cli.ts:13` |
| `apps/cli/src/cli.ts:41` |
| `apps/cli/tests/main.test.ts:237` |
| `apps/cli/tests/main.test.ts:84` |
| `docs/00_ADR.md:1696` |
| `docs/00_ADR.md:6` |
| `docs/04_DESIGN.md:6` |
| `docs/04_DESIGN.md:86` |
| `docs/design/kk-wiki.md:10` |
| `docs/design/kk-wiki.md:40` |
| `docs/design/kk-wiki.md:6` |
| `docs/features/I1_kk-wiki-vault-cli.md:245` |
| `docs/features/I1_kk-wiki-vault-cli.md:251` |
| `docs/features/I1_kk-wiki-vault-cli.md:5` |
| `docs/features/I1_kk-wiki-vault-cli.md:9` |
| `docs/features/INDEX.md:98` |
| `scripts/publish-manifest.test.ts:94` |
| `apps/cli/src/commands/wiki.ts:1` |
| `apps/cli/src/wiki/config.ts:1` |
| `apps/cli/src/wiki/ingest.ts:1` |
| `apps/cli/tests/commands/wiki.test.ts:1` |
| `apps/cli/tests/wiki/config.test.ts:1` |
| `apps/cli/tests/wiki/ingest.test.ts:1` |
| `packages/kk-wiki/package.json:1` |
| `packages/kk-wiki/src/index.ts:1` |
| `packages/kk-wiki/src/markitdown.ts:1` |
| `packages/kk-wiki/src/page.ts:1` |
| `packages/kk-wiki/src/raw.ts:1` |
| `packages/kk-wiki/tests/markitdown.test.ts:1` |
| `packages/kk-wiki/tests/page.test.ts:1` |
| `packages/kk-wiki/tests/raw.test.ts:1` |
| `packages/kk-wiki/tsconfig.json:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/kk-wiki/package.json:1`, `packages/kk-wiki/src/index.ts:1`; workspace glob `package.json:9` |
| R2 | MET | `packages/kk-wiki/src/raw.ts:46-79`; `packages/kk-wiki/tests/raw.test.ts` (four source keys) |
| R3 | MET | `apps/cli/src/wiki/ingest.ts:82`; `apps/cli/tests/wiki/ingest.test.ts` (stdin origin) |
| R4 | MET | `apps/cli/src/wiki/ingest.ts:84-88`; `apps/cli/tests/commands/wiki.test.ts` (exit 2, nothing written) |
| R5 | MET | `packages/kk-wiki/src/markitdown.ts:65`, `apps/cli/src/wiki/ingest.ts:116-120`; `packages/kk-wiki/tests/markitdown.test.ts` |
| R6 | MET | `apps/cli/src/commands/wiki.ts:18-30`; `apps/cli/tests/commands/wiki.test.ts` (JSON shape, exit 0/1/2) |
| R7 | MET | `apps/cli/src/wiki/config.ts:83-176`; `apps/cli/tests/wiki/config.test.ts` |
| R8 | MET | `docs/00_ADR.md:1699` (ADR-047) |
| R9 | MET | per-file coverage from the gate run: `page.ts`/`raw.ts`/`markitdown.ts` 100, `config.ts` 97.5, `ingest.ts` 100, `commands/wiki.ts` 100 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Ingest a local file into a raw snapshot with frontmatter | MET | test | `apps/cli/tests/commands/wiki.test.ts` — local file ingest with frontmatter |
| AC2 — Ingest a URL or stdin source into the same raw shape | MET | test | `apps/cli/tests/wiki/ingest.test.ts` — stdin source; `apps/cli/tests/commands/wiki.test.ts` — real stdin stream |
| AC3 — Ingest rejects an unsupported source type | MET | test | `apps/cli/tests/commands/wiki.test.ts` — unsupported type and `--type docx` both exit 2 |
| AC4 — Every wiki verb supports JSON output and a stable exit code | MET | test | `apps/cli/tests/commands/wiki.test.ts`; `apps/cli/tests/main.test.ts` — `wiki ingest` in the leaf inventory |
| AC5 — Configuration resolves from kk.config.json and the environment | MET | test | `apps/cli/tests/wiki/config.test.ts` — file/env/flag precedence; end-to-end override in `apps/cli/tests/commands/wiki.test.ts` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Scope.** Task 0350 — `@gobing-ai/kk-wiki` package skeleton, vault config resolver, `kk wiki ingest`.
Traceability: 9/9 Requirements MET, 5/5 feature ACs MET; per-requirement evidence is in the review
answer artifact and captured as `.spur/run/0350-verdict.json` (verdict PASS). The project gate is PASS
on this tree (`.spur/run/0350-check-receipt.json`).

| Priority | Location | Finding | Disposition |
| --- | --- | --- | --- |
| P4 | `docs/design/kk-wiki.md:41` | The satellite's `ingest` row still described the verb as unbuilt and credited text extraction to the skill | FIXED |

Confidence: HIGH

Verdict: PASS

### References

- Feature: `docs/features/I1_kk-wiki-vault-cli.md` — AC R2, R3, R4, R19, R20.
- Decision: `docs/00_ADR.md:1679` ADR-046 (model-free vault package behind the `kk wiki` noun).
- Shapes: `docs/design/kk-wiki.md:19-31` (package boundary), `docs/design/kk-wiki.md:92-110` (config keys).
- Noun registration site this task extends: `apps/cli/src/cli.ts:29-39`.
- Workspace globs that admit a new package: `package.json:6-13`.
- Contracts the package may import: `packages/kk-core/src/index.ts:1-40`.
- Discovery: `docs/plans/2026-11-10-kk-wiki-brainstorm.md`.

### History

- 2026-11-10T20:50:16.180Z todo → wip (system)
- 2026-11-10T22:55:05.666Z wip → testing (system)
- 2026-11-10T22:55:06.876Z testing → done (system)

