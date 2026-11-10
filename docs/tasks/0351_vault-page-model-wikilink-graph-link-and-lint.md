---
schema_version: 1
name: Vault page model, wikilink graph, link and lint
status: done
template: feature-impl
created_at: 2026-11-10T19:11:03.854Z
updated_at: "2026-11-10T23:21:21.646Z"
feature_id: I1
priority: P1
tags:
  - wiki
  - graph
estimate_hours: 6

dependencies: ["0350"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0351-verdict.json
---

## 0351. Vault page model, wikilink graph, link and lint

### Background

Every other wiki verb needs two things this task builds: a vault index (every page parsed, its frontmatter validated, its `[[wikilinks]]` resolved) and a defect report over that index. `kk wiki link` and `kk wiki lint` are also the first verbs whose output operators act on directly, so their findings shape what later verbs report.

Link fixing rewrites page text, so it is the first write path that must respect `user_edited: true` - the guard function lands here in its minimal form (append-only) and is extended by the write verbs that follow.

Implements: R12 - Link reports unlinked entity mentions without editing; R22 - Link fix injects the wikilinks it reported; R13 - Lint reports broken links, orphan pages and missing frontmatter; R23 - Lint exits zero once no finding remains.

Rubric: E2 D1 L1 C1 R1 = 6 -> decompose (graph + two verbs + guard seam).

Rejected: parsing links with a regex over the whole file including code fences - fenced code in a technical vault contains `[[...]]` examples; the parser skips fenced blocks and inline code spans.

**Refine corrections (2026-11-10)**
- The Design implied a third-party markdown or frontmatter parser -> a grep over `packages/*/src` and `apps/cli/src` finds no frontmatter parser (`packages/publish-harness/src/index.ts:9` only mentions the word in a doc comment), and no YAML library is declared -> this task owns a minimal line-based splitter, and nested frontmatter is a finding rather than a parsed value.
- Link-fixing wrote through "the shared guard-aware writer" -> that writer ships in 0352, not here -> this task lands the minimal append-only guard and 0352 extends it; the seam is named below so neither task invents a second one.
- The lint finding shape was declared but not frozen -> the exact `code` values are fixed below so 0353/0354 and the CLI renderer share them.
- Coverage was unstated -> `bunfig.toml` enforces 90% lines/functions per file -> the fixtures and tests below are this task's own.

### Requirements

- [x] R1. `buildVaultIndex(contentDir)` returns every page with parsed frontmatter, outbound links and inbound counts, built fresh from disk on each call.
- [x] R2. Wikilink parsing skips fenced code blocks and inline code spans, and resolves both `[[slug]]` and `[[slug|Surface]]` forms.
- [x] R3. `kk wiki link` reports unlinked mentions of existing page titles and leaves files unchanged.
- [x] R4. `kk wiki link --fix` rewrites reported mentions to `[[slug|Surface]]` and lists the changed files.
- [x] R5. `kk wiki lint` reports broken links, orphan pages and missing or invalid frontmatter, one finding per defect with its file path and line.
- [x] R6. `kk wiki lint` exits 1 when findings exist and 0 when the findings list is empty.
- [x] R7. A page with `user_edited: true` is never rewritten by `link --fix`; the change lands under `## AI Updates (YYYY-MM-DD)` through the single guard function.
- [x] R8. Every new file in `packages/kk-wiki/src` clears the per-file coverage threshold with its own tests.

### Acceptance Criteria

- [x] AC1 — Link reports unlinked entity mentions without editing
- [x] AC2 — Link fix injects the wikilinks it reported
- [x] AC3 — Lint reports broken links, orphan pages and missing frontmatter
- [x] AC4 — Lint exits zero once no finding remains

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Approach.** `packages/kk-wiki/src/graph.ts` builds the index once per command: `parsePage` (frontmatter via the zod schema from 0350), `extractLinks(body)` (fenced blocks and inline code spans excluded), `resolveSlug`, `buildVaultIndex(dir)`. `packages/kk-wiki/src/lint.ts` is pure: `lintPages(index) -> Finding[]`. `packages/kk-wiki/src/link.ts` returns `Mention[]` and, in fix mode, rewrites through `applyWrite` from `write.ts` - created here in its minimal append-only form and extended by 0352.

**Frozen names.**
- `buildVaultIndex(contentDir) -> VaultIndex`, `parsePage(text, path) -> VaultPage`, `extractLinks(body) -> LinkRef[]`, `resolveSlug(title) -> string`, `lintPages(index) -> Finding[]`, `fixLinks(index, opts) -> { changed: string[], mentions: Mention[] }`.
- `VaultIndex = { pages: VaultPage[], bySlug: Map<string, VaultPage>, findings: Finding[] }`.
- `Finding = { code, path, line, message }` with `code` exactly one of `broken-link`, `orphan`, `missing-frontmatter`, `invalid-frontmatter`, `duplicate-slug`.
- `applyWrite(page, material, { mode: 'full' | 'append', date }) -> { body, guard: 'clean' | 'appended' | 'refused' }` (guard seam shared with 0352).
- Verb modules: `apps/cli/src/wiki/link.ts`, `apps/cli/src/wiki/lint.ts`.

**Slug rule (frozen).** Lowercase the title, replace every run of non-alphanumerics with `-`, trim leading and trailing `-`. Two pages resolving to the same slug across `concepts/` and `entities/` produce one `duplicate-slug` finding and both pages stay indexed.

**Invariants.**
- Findings are data; the CLI renders them. No formatting inside the package.
- The index is rebuilt from disk per call; no cache file, so a stale index cannot report a false clean lint.
- `lint` exits nonzero on any finding; an empty vault is a clean lint, not an error.
- `link` without `--fix` is read-only and must not touch `updated_at`.

**Anti-patterns (do not implement).**
- No full-text markdown parser or AST dependency; links are found by a scanner that respects fences.
- No heuristic mention matcher over arbitrary prose beyond existing page titles; a vocabulary of common words floods a growing vault.
- No `--fix` that writes without the guard, and no direct `writeFile` outside `write.ts`.

**Test observability.** Fixtures in `packages/kk-wiki/tests/fixtures/` cover: a broken link, an orphan page, a page without frontmatter, a nested-map frontmatter (invalid), a duplicate slug, a fenced block containing `[[example]]`, and an idempotent `link --fix` run. CLI exit codes are asserted through `main(argv)` with captured writers.

**Handoff to dependents.** 0352 imports `applyWrite` and the index; 0353 imports `buildVaultIndex` and `lintPages`; 0354 imports `buildVaultIndex` and `resolveSlug`. Renaming any frozen exportrequires updating those tasks in the same commit.

### Plan

1. Implement `graph.ts` (frontmatter splitter reuse from 0350, link scanner, slug rule, index) with fixtures for fences and both link forms.
2. Implement `write.ts` in its minimal append-only form plus unit tests for clean, appended and refused outcomes.
3. Implement `lint.ts` with one test per finding code, the clean-vault case and the duplicate-slug case.
4. Implement `link.ts` report and fix modes through `write.ts`; assert `updated_at` is untouched by the read-only mode.
5. Wire `apps/cli/src/wiki/link.ts` and `lint.ts`; assert JSON shapes and exit codes through `main(argv)`.
6. Transcribe both verbs into `docs/04_DESIGN.md` §1 and record the finding codes in `docs/design/kk-wiki.md`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/wiki.ts:33` |
| `apps/cli/src/commands/wiki.ts:4` |
| `apps/cli/src/commands/wiki.ts:58` |
| `apps/cli/tests/main.test.ts:238` |
| `docs/04_DESIGN.md:6` |
| `docs/04_DESIGN.md:87` |
| `docs/design/kk-wiki.md:10` |
| `docs/design/kk-wiki.md:45` |
| `docs/design/kk-wiki.md:6` |
| `packages/kk-wiki/src/index.ts:1` |
| `packages/kk-wiki/src/index.ts:45` |
| `packages/kk-wiki/src/page.ts:117` |
| `packages/kk-wiki/src/page.ts:121` |
| `packages/kk-wiki/src/page.ts:123` |
| `packages/kk-wiki/src/page.ts:40` |
| `packages/kk-wiki/src/page.ts:82` |
| `packages/kk-wiki/src/page.ts:86` |
| `apps/cli/src/wiki/link.ts:1` |
| `apps/cli/src/wiki/lint.ts:1` |
| `apps/cli/tests/wiki/link.test.ts:1` |
| `apps/cli/tests/wiki/lint.test.ts:1` |
| `packages/kk-wiki/src/findings.ts:1` |
| `packages/kk-wiki/src/graph.ts:1` |
| `packages/kk-wiki/src/link.ts:1` |
| `packages/kk-wiki/src/lint.ts:1` |
| `packages/kk-wiki/src/write.ts:1` |
| `packages/kk-wiki/tests/findings.test.ts:1` |
| `packages/kk-wiki/tests/graph.test.ts:1` |
| `packages/kk-wiki/tests/link.test.ts:1` |
| `packages/kk-wiki/tests/lint.test.ts:1` |
| `packages/kk-wiki/tests/write.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/kk-wiki/src/graph.ts:118`; `packages/kk-wiki/tests/graph.test.ts` |
| R2 | MET | `packages/kk-wiki/src/graph.ts:69`; `packages/kk-wiki/tests/graph.test.ts` (fences, inline code, both link forms) |
| R3 | MET | `apps/cli/src/wiki/link.ts:25`; `apps/cli/tests/wiki/link.test.ts` (report leaves the file unchanged) |
| R4 | MET | `packages/kk-wiki/src/link.ts:83`; `apps/cli/tests/wiki/link.test.ts` (`--fix` writes the wikilink) |
| R5 | MET | `packages/kk-wiki/src/lint.ts:14`; `packages/kk-wiki/tests/lint.test.ts` |
| R6 | MET | `packages/kk-wiki/src/lint.ts:40`; `apps/cli/tests/wiki/lint.test.ts` (exit 0 clean, exit 1 with findings) |
| R7 | MET | `packages/kk-wiki/src/write.ts:50`; `packages/kk-wiki/tests/write.test.ts`; guarded case in `apps/cli/tests/wiki/link.test.ts` |
| R8 | MET | per-file coverage on the gate run: `graph.ts`, `lint.ts`, `write.ts`, `link.ts` all 100 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Link reports unlinked entity mentions without editing | MET | test | `apps/cli/tests/wiki/link.test.ts` — report mode leaves the file byte-identical |
| AC2 — Link fix injects the wikilinks it reported | MET | test | `apps/cli/tests/wiki/link.test.ts` — `--fix` writes `[[karakeep |
| AC3 — Lint reports broken links, orphan pages and missing frontmatter | MET | test | `packages/kk-wiki/tests/lint.test.ts`, `apps/cli/tests/wiki/lint.test.ts` |
| AC4 — Lint exits zero once no finding remains | MET | test | `apps/cli/tests/wiki/lint.test.ts` — clean vault exits 0 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Scope.** Task 0351 — vault index and wikilink graph, lint, the single-page write guard, mention
detection, `kk wiki link` and `kk wiki lint`. Traceability: 8/8 Requirements MET, 4/4 feature ACs MET;
evidence per row in `.spur/run/b1485866-4836-43f5-ac03-af6fccd8b10d-review-answer.txt`, captured as
`.spur/run/0351-verdict.json` (PASS). Project gate PASS on this tree (`.spur/run/0351-check-receipt.json`).

| Priority | Location | Finding | Disposition |
| --- | --- | --- | --- |
| P4 | `packages/kk-wiki/src/graph.ts:118` | The first graph draft reported body-relative line numbers, so a lint finding pointed inside the body instead of at the file | FIXED |

Confidence: HIGH

Verdict: PASS

### References

- Feature: `docs/features/I1_kk-wiki-vault-cli.md` — AC R12, R22, R13, R23.
- Decision: `docs/00_ADR.md:1679` ADR-046.
- Shapes: `docs/design/kk-wiki.md:33-54` (verb surface), `docs/design/kk-wiki.md:56-82` (vault layout and frontmatter keys).

### History

- 2026-11-10T23:00:12.803Z todo → wip (system)
- 2026-11-10T23:20:18.231Z wip → testing (system)
- 2026-11-10T23:21:21.635Z testing → done (system)

