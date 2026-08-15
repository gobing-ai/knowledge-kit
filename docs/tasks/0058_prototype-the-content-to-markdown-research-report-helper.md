---
template: feature-impl
schema_version: 1
name: "Prototype the Content-to-markdown research-report helper"
description: ""
status: done
type: task
profile: standard
feature_id: C4
parent_wbs: null
priority: P1
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-14T07:25:44.225Z"
updated_at: "2026-08-15T02:42:28.045Z"
---

## 0058. Prototype the Content-to-markdown research-report helper

### Background
wayfinder:prototype — C4 Daily-usable STORM research. Independent of 0056/0057.

**Question.** Can we prove a small shared `Content → markdown` helper with one research-report template, so 0059's `render` state writes `content.md` without a template engine?

**Verified premises (re-checked 2026-08-14 this refine):**
- `ContentSchema` (`packages/kk-core/src/schemas.ts`): `body` required; `title`/`outline`/`references` optional; `format` default `markdown`; `references[]` = `{ url?, title?, cite? }`.
- D4 output (`plugins/generations/content-gen/src/storm.ts` `generateWithStormPipeline`): sets `title`, `body`, `format: 'markdown'`, `outline`, `references` from docs, `metadata.generator = 'kk:storm'`.
- Empty docs → `EMPTY_CONTENT` title `Notice` (`content-gen/src/index.ts`).
- `@gobing-ai/kk-core` is private (`packages/kk-core/package.json`). Published `kk` ships `plugins/` via `scripts/bundle-plugins.ts`, not kk-core source. A checkout-only `bun packages/kk-core/src/render-md.ts` is not enough for no-checkout daily use.
- `docs/04_DESIGN.md` §4 public surface lists kk-core schemas; adding `renderContentMarkdown` is a T3 surface change (same commit as the export).
- ADR-011: no new first-layer `kk` noun.

**Out of this ticket:** wiring the helper into YAML (0059); a general template engine; changing ContentSchema; D4 retrieval; a `kk render` CLI noun.
### Requirements
- [x] R1. Add `renderContentMarkdown(content: Content): string` in `@gobing-ai/kk-core` using the frozen template. Export it from `packages/kk-core/src/index.ts`. Unit tests: full Content; missing title → H1 `Untitled`; empty/missing outline and references omit those sections; if `body` already starts with `# <title>` do not prepend a second H1.
- [x] R2. Add `renderContentMarkdownFile(inPath: string, outPath: string): Promise<void>` (read JSON, `ContentSchema.parse`, write markdown). Add `import.meta.main` CLI on the same module: `--in <content.json> --out <content.md>`.
- [x] R3. Ship a no-checkout runner at `plugins/kk/scripts/render-md.ts` that produces **byte-identical** output to `renderContentMarkdown` for the same Content (characterization test). 0059 render state must call this script, not a new `kk` noun. Record the exact argv in Solution.
- [x] R4. Same commit: add the two exports to `docs/04_DESIGN.md` §4 `@gobing-ai/kk-core` table (T3).
### Acceptance Criteria
```gherkin
Feature: Content-to-markdown research-report helper

  Scenario: R1 — Content renders to markdown
    Given a Content object with title, body, outline, and references
    When renderContentMarkdown runs
    Then the string contains those fields and a missing-title fixture uses H1 Untitled
    And a body that already starts with "# <title>" is not given a second H1

  Scenario: R2 — File + CLI exist
    Given content.json on disk
    When renderContentMarkdownFile or the module CLI --in/--out runs
    Then content.md is written and ContentSchema-invalid JSON exits non-zero with no --out

  Scenario: R3 — 0059 can call a shipped script
    Given plugins/kk/scripts/render-md.ts
    When 0059 authors the render state
    Then the argv is `bun <render_script> --in <work_dir>/content.json --out <work_dir>/content.md`
    And no new kk first-layer noun exists

  Scenario: R4 — DESIGN surface lists the exports
    Given docs/04_DESIGN.md §4
    When the ticket lands
    Then renderContentMarkdown and renderContentMarkdownFile appear in the kk-core table
```
### Q&A
- **Package home?** Closed: `@gobing-ai/kk-core` next to `ContentSchema`. Not utils, not a new package.
- **Template engine?** Closed: one hardcoded template. No Handlebars/Mustache.
- **How does a published `kk` run it?** Closed: kk-core is private, so 0059 cannot rely on `bun packages/kk-core/...` after npm install. Ship `plugins/kk/scripts/render-md.ts` (copied by `bundle-plugins.ts`). Script must match kk-core output (test). Prefer the script importing a **copied** function body with a `SYNC:` comment pointing at `packages/kk-core/src/render-md.ts` — do not import `@gobing-ai/kk-core` from the shipped script (not resolvable for end users).
- **Double H1?** Closed: if `body` starts with `# ${title}` (or `# Untitled` when title missing), emit `body` as the leading heading; else prepend `# ${title || 'Untitled'}\n\n` + body.
- **New kk noun?** Closed: no.
- **Feature AC match?** Closed: C4 wayfinder-map; task-local AC.
### Design
**WHAT.** A pure helper + file/CLI wrapper + a shipped script 0059 can shell.

**WHY.** Operators read markdown. `content.json` stays the machine contract (publish plugins consume it).

**WHERE.**
- `packages/kk-core/src/render-md.ts` — `renderContentMarkdown`, `renderContentMarkdownFile`, `import.meta.main`.
- `packages/kk-core/src/index.ts` — re-export both functions.
- `packages/kk-core/tests/render-md.test.ts` — R1/R2 cases + script characterization.
- `plugins/kk/scripts/render-md.ts` — shipped runner (`bundle-plugins.ts` copies `plugins/`).
- `docs/04_DESIGN.md` §4 — T3 row for the two exports.

**Frozen names.**
- `export function renderContentMarkdown(content: Content): string`
- `export async function renderContentMarkdownFile(inPath: string, outPath: string): Promise<void>`
- CLI argv: `--in <path> --out <path>` (same `parseArgs` shape as web-search). Missing args or invalid JSON/schema → stderr + exit 1, no `--out`.
- 0059 var `render_script` default: `plugins/kk/scripts/render-md.ts`
- 0059 render command: `bun ${vars.render_script} --in ${vars.work_dir}/content.json --out ${vars.work_dir}/content.md`

**Frozen template (`renderContentMarkdown`).**
1. `heading = content.title?.trim() || 'Untitled'`
2. `lead` = if `content.body` starts with `# ${heading}` (optional single space already in the heading text) then `''` else `# ${heading}\n\n`
3. `outlineBlock` = if `content.outline` non-empty after trim then `\n\n## Outline\n\n` + trimmed outline else `''`
4. `refsBlock` = if `content.references` is a non-empty array then `\n\n## References\n\n` + one line per item `- ${label}` where `label` is `[title](url)` when both exist, else title, else url, else `` `cite` ``, plus ` (`cite`)` when cite is present and not already the whole label. Skip items with no title/url/cite.
5. Return `lead + content.body + outlineBlock + refsBlock` with a single trailing newline. Do not wrap `body` in a fence. Ignore `metadata` and `format`.

**Invariants.** Pure function does no IO. File helper parses via `ContentSchema`. Script output === function output for the same object.

**Anti-patterns:** no template engine; no ContentSchema change; do not stop writing `content.json`; no `kk render` noun; do not import `@gobing-ai/kk-core` from the shipped script.

**Assumes from deps:** none. **Leaves for 0059:** exact `bun ${render_script} --in/--out` line. **Leaves for 0060:** document `render_script` and that fixture/live both produce `content.md`.
### Plan
1. Read `ContentSchema` + `generateWithStormPipeline` return shape + `EMPTY_CONTENT` (R1).
2. Implement `packages/kk-core/src/render-md.ts` + exports (R1, R2).
3. Implement `plugins/kk/scripts/render-md.ts` with SYNC comment; characterization test for byte-identical output (R3).
4. Update `docs/04_DESIGN.md` §4 kk-core table (R4).
5. `bun test packages/kk-core/tests/render-md.test.ts` then `spur task check 0058 --json`.
### Solution
- `packages/kk-core/src/render-md.ts` — `renderContentMarkdown` (L18), `renderContentMarkdownFile` (L74), `main` CLI with `import.meta.main` (L80/L100). Pure render follows the frozen template (heading/lead, outline block, references block, single trailing newline); file helper parses via `ContentSchema`.
- `packages/kk-core/src/index.ts:36` — re-exports `main`, `renderContentMarkdown`, `renderContentMarkdownFile`.
- `packages/kk-core/tests/render-md.test.ts` — R1 pure-function cases (full Content, `Untitled` H1, H1 de-dup, omitted outline/references), R2 file/CLI cases, R3 byte-identical characterization against the shipped script.
- `plugins/kk/scripts/render-md.ts` — self-contained no-checkout runner (copied render body, `SYNC:` comment to `packages/kk-core/src/render-md.ts`), shipped via `bundle-plugins.ts`. 0059 render state shells it.
- `docs/04_DESIGN.md` §4 — T3 row added for the render exports (R4).

**Exact argv (0059 render state / CLI):** `bun plugins/kk/scripts/render-md.ts --in <work_dir>/content.json --out <work_dir>/content.md`. Missing `--in`/`--out` or invalid JSON/schema → stderr + exit 1, no `--out` written.
### Testing
**Verdict: PASS** (re-verify `--force` 2026-08-14)

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/kk-core/src/render-md.ts:19-27` `renderContentMarkdown`; re-export `packages/kk-core/src/index.ts:36`. Frozen template: H1 from title else Untitled; no second H1 when body starts with `# ${heading}`; outline/refs omitted when empty. Tests: `packages/kk-core/tests/render-md.test.ts` 16 pass this run. |
| R2 | MET | `renderContentMarkdownFile` at `packages/kk-core/src/render-md.ts:75-79`; `main` CLI `:82-100` with `--in`/`--out`; missing args / invalid JSON → exit 1. File/CLI tests in the same suite — PASS this run. |
| R3 | MET | `plugins/kk/scripts/render-md.ts:1-10` SYNC comment; characterization tests spawn `bun <script> --in --out` and assert byte-identical output (2 cases, PASS this run). 0059 render argv at `.spur/workflows/kk-storm-research.yaml:137-139`. |
| R4 | MET | `docs/04_DESIGN.md:265` kk-core table lists `renderContentMarkdown(content)`, `renderContentMarkdownFile(in, out)`, `main()`. Re-read this run. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R1 — Content renders to markdown | MET | test | `NODE_ENV=test bun test packages/kk-core/tests/render-md.test.ts` — Untitled H1 + no-double-H1 cases PASS this run. |
| Scenario: R2 — File + CLI exist | MET | test | Same file — `renderContentMarkdownFile` + `main` happy/missing-args/invalid-JSON PASS this run. |
| Scenario: R3 — 0059 can call a shipped script | MET | test | Characterization tests PASS this run; render state `.spur/workflows/kk-storm-research.yaml:137-139`. |
| Scenario: R4 — DESIGN surface lists the exports [docs-only] | MET | static-ref | `docs/04_DESIGN.md:265` (re-read this run). |

**SECUA Review**

No P1–P3. Pure function, no IO in `renderContentMarkdown`. No new `kk` noun.

**design-conformance:** DONE — frozen export names and template match Design.

Coverage: `packages/kk-core/src/render-md.ts` 100% funcs / 98.59% lines this run.
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
### References
- Feature [C4](../features/C4_daily-usable-storm-research.md)
- `packages/kk-core/src/schemas.ts` (`ContentSchema`)
- D4 mapping: `plugins/generations/content-gen/src/storm.ts` `generateWithStormPipeline`
- Publish surface: `docs/04_DESIGN.md` §4 (T3)
- Ship path: `scripts/bundle-plugins.ts` · ADR-011
- Downstream: [0059](0059_prototype-the-daily-kk-storm-research-workflow.md)
### History
- 2026-08-14T22:07:59.214Z todo → wip (system)
- 2026-08-14T22:16:54.958Z wip → testing (system)
- 2026-08-14T22:16:55.409Z testing → done (system)
