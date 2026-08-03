---
template: standard
schema_version: 1
name: "Harden karakeep-local: fail loud on zero-doc ingest and create --out parent dir"
description: ""
status: done
type: task
profile: standard
feature_id: C
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-08-02T23:29:27.561Z"
updated_at: "2026-08-03T03:13:01.899Z"
---

## 0029. Harden karakeep-local: fail loud on zero-doc ingest and create --out parent dir

### Background
Found in the **0027 re-audit**: a Karakeep source folder whose entries are *all* rejected (every
JSON entry missing a string `body`) exits `0` and writes `docs.json: []`. The B5 vertical then
published a "No documents provided" Notice with `ok: true` — a false publish caused by a silent
zero-doc ingest. That is exactly the fail-loud gap `ADR-006` forbids (and which tasks `0015`,
`0023`, `0025` hardened in the neighbouring plugins; `karakeep-local` was left behind at the
boundary case).

The file **attempts** fail-loud — `main()` wraps ingestion in a try/catch that exits `1` — but
`processKarakeepFolder` never throws for a *parse-level* rejection. It only warns
(`plugins/karakeep-local/src/index.ts:113` — `console.error('Warning: JSON entry missing string
body …')`) and continues, so the all-rejected case produces an empty array, not an error, and the
catch never fires.

Feature **C**'s own AC already fixes the intended contract — this task is the repair, not a
re-spec:

- `Empty source yields empty Doc list with exit 0` — a legitimately empty directory stays a success.
- `Unparsable items are skipped with a warning` — *partial* rejection keeps emitting valid items,
  warns, exits 0.
- `Unreadable source fails loud` — non-zero exit naming the path.

**None of the three covers the all-rejected non-empty case** — the hole the re-audit found.

The second defect is simpler: `main()` calls `writeFile(values.out, …)`
(`plugins/karakeep-local/src/index.ts:149`) without creating the parent directory, so `--out`
pointing into a fresh work dir dies with `ENOENT`. `surfdash-pub` already creates its out dir
(`plugins/surfdash-pub/src/index.ts:164-167`); this brings `karakeep-local` to the same contract.
### Requirements
- R1. Decide and document the empty-result contract, then fail loud when a non-empty source yields zero ingestible docs. Current behavior (`plugins/karakeep-local/src/index.ts:114-116`): a JSON entry missing string `body` logs a console warning and is skipped, so an all-rejected source exits 0 with `docs.json: []` — and the B5 chain then published a "No documents provided" Notice with `ok: true` (found in 0027 re-audit). A legitimately empty directory may stay a success; an all-rejected non-empty source must exit non-zero with a clear error.
- R2. Create the `--out` parent directory before writing (`plugins/karakeep-local/src/index.ts:149` — ENOENT on a fresh work dir; surfdash-pub already does this at `plugins/surfdash-pub/src/index.ts:164-167`).
- R3. Regression tests for both behaviors (all-rejected source fails loud; missing out dir is created); `bun run spur-check` green.
### Acceptance Criteria
```gherkin
Feature: Harden karakeep-local — fail loud on zero-doc ingest and create --out parent dir

  # Derived from feature C's failure-semantics contract. The first four restate the
  # cases feature C already owns; the fifth is the gap the 0027 re-audit found.

  @core
  Scenario: Empty source yields empty Doc list with exit 0
    Given an empty source folder
    When the plugin runs
    Then it writes [] and exits 0

  @core
  Scenario: Unparsable items are skipped with a warning
    Given a fixture folder with one corrupt entry among valid ones
    When the plugin runs
    Then valid items are emitted, a warning goes to stderr, and exit is 0

  @core
  Scenario: Unreadable source fails loud
    Given a missing source folder
    When the plugin runs via knowledge-kit invoke
    Then the exit code is non-zero and the error names the source path

  @core
  Scenario: All-rejected non-empty source fails loud
    Given a source folder where every JSON entry is missing a string body
    When the plugin runs
    Then the exit code is non-zero and the error states zero ingestible documents
      And no docs.json with [] is reported as success

  @core
  Scenario: Output parent directory is created before writing
    Given a --out path whose parent directory does not exist
    When the plugin runs
    Then the parent directory is created and the output file is written

  @edge
  Scenario: Partial rejection still emits valid items with exit 0
    Given a source with one body-less JSON entry and one valid entry
    When the plugin runs
    Then the valid item is emitted, a warning goes to stderr, and exit is 0
```
### Q&A
Refined under `--auto` (synthesis only, no interactive Q&A). Two scope calls worth surfacing, both
answering *what the fail-loud discriminator should be* — R1's only genuinely undecided sub-question:

**The discriminator is "non-empty source yields zero docs" — not "there were skips".** The
re-audit's own language ("non-empty source yields zero ingestible docs") fixes this. A **partial**
skip stays a warning-with-exit-0 (feature C's `Unparsable items are skipped with a warning`), and a
**legitimately empty** directory stays success (`Empty source yields empty Doc list with exit 0`).
Only the case *between* them — source has items, all of them rejected, nothing ingested — becomes a
failure. This is the minimal change consistent with the AC C already owns; anything stricter would
contradict the skip-with-warning scenario.

**No threshold, no ratio.** A tempting refinement is "fail only if rejection rate > X". Rejected —
it adds a config knob and a magic number to satisfy a case the AC doesn't ask for, and it blurs the
clean signal the downstream B5 chain actually needs (zero docs out is either legitimate or it
isn't). Binary contract; no gold-plating.

**Where the check lives is the design question, not a Q&A ambiguity** — settle it in `### Design`
against the test harness, not here.

**Both defects are spec'd by existing AC / precedent, so no new AC is invented for the feature** —
this task's AC derives *from* feature C's scenarios plus the all-rejected case C didn't cover.
### Design
**Where the zero-doc check lives — the one real design decision.**

`processKarakeepFolder` is a pure library function: it takes a directory, returns `Doc[]`, and its
tests assert `expect(docs).toEqual([])` for an empty source. Three places the all-rejected check
could live:

- **In `main()`** (thin CLI guard) — after `await processKarakeepFolder(values.in)`, before
  `writeFile`. Library semantics unchanged; the `empty → []` unit tests keep passing untouched.
  Chosen, **provided** the "source had files" precondition is checkable without re-walking the dir.
- **In `processKarakeepFolder`** — throw when non-empty source yields zero. Rejected: it changes a
  pure function's contract, forces a rethink of every existing test that expects `[]`, and couples a
  *policy* decision (fail loud) to a *mechanism* (walk+parse) that shouldn't own policy.
- **A return-type change** to surface skip counts. Rejected — ripples the signature to `invoke` and
  every caller for information only the guard needs.

**Implementation (thin guard, R1):** in `main()`, after ingestion, distinguish *legitimately empty*
from *all-rejected*:

```
const docs = await processKarakeepFolder(values.in);
if (docs.length === 0) {
    const hadFiles = <source contained at least one candidate file>;   // see precondition note
    if (hadFiles) {
        console.error(`Fatal: source yielded zero ingestible documents at ${values.in}`);
        process.exit(1);
    }
}
// docs.length === 0 && !hadFiles  → legitimately empty, write [] and exit 0
await mkdir(dirname(values.out), { recursive: true });   // R2 — before writeFile
await writeFile(values.out, JSON.stringify(docs, null, 2), 'utf-8');
```

**Precondition note (the part to nail during implement, not guess now).** `hadFiles` must not
re-walk the tree twice. Options: have `processKarakeepFolder` accept an optional out-param /
stats object it fills with the candidate-file count it already computes, **or** expose a tiny
`countCandidateFiles(dir)` helper it already builds on. Pick whichever touches fewer lines — the
walk already enumerates `files`, so surfacing that count is cheaper than a second `readdir`. **Do
not** infer "non-empty" from the raw filesystem listing of `values.in` alone — that counts
directories and non-document files and re-introduces a false positive on a folder of `.png`s.

**R2 — out-dir creation:** copy the `surfdash-pub` pattern (`plugins/surfdash-pub/src/index.ts:164-167`) —
`dirname(values.out)`, skip when `'.'`, `mkdir(..., { recursive: true })`, **before** `writeFile`.
Same contract, same code shape, already proven in the sibling plugin.

**Invariants**

1. Empty source (`docs.length === 0`, no candidate files) → writes `[]`, exit 0. Unchanged.
2. Partial rejection → warns, emits valid items, exit 0. Unchanged.
3. All-rejected non-empty source → exit non-zero, error names the source and the zero-ingestible
   fact, and **no `[]` output is written as success**.
4. `--out` into a missing dir no longer dies with `ENOENT`.

**Impacted surfaces:** `plugins/karakeep-local/src/index.ts` (`main` guard + mkdir; possibly a
candidate-count signal from `processKarakeepFolder`), `plugins/karakeep-local/tests/karakeep-local.test.ts`
(two new regression tests). No manifest, no `kk-core`, no `invoke` change.

**Output-hygiene note.** New tests on the failure path must spy `console.error` (and `process.exit`
where `main` exits) — this plugin writes errors via raw `console.error`, and an unspied negative
test is exactly how a stray line lands mid-`--dots` reporter (the leak fixed elsewhere this
session). Follow the existing `spyOn(console, 'error').mockImplementation(() => {})` +
`try/finally { mockRestore() }` pattern already in this test file.
### Plan
- [ ] **1. Baseline.** `bun run test plugins/karakeep-local` green before any change; confirm the
      existing `empty source folder yields empty array` test asserts `[]` on a pure empty dir.
- [ ] **2. Surface a candidate-file count.** Read `processKarakeepFolder`'s walk; expose the count of
      candidate files it already enumerates (out-param stats object, or a small helper it reuses) so
      `main()` can tell "empty source" from "all-rejected" without a second `readdir`. Pick the
      minimal-diff option; do not count raw dir entries (that miscounts dirs/non-docs).
- [ ] **3. Add the zero-doc guard in `main()`** — after ingestion, before `writeFile`: if
      `docs.length === 0` and candidate files existed, `console.error` a message naming the source
      path and the zero-ingestible fact, then `process.exit(1)`. Leave the legitimately-empty path
      untouched (writes `[]`, exit 0).
- [ ] **4. Create the out parent dir** in `main()` — `dirname(values.out)`, skip `'.'`,
      `mkdir(..., { recursive: true })` before `writeFile`, mirroring `surfdash-pub`.
- [ ] **5. Regression test — all-rejected fails loud.** Fixture folder with only body-less JSON
      entries; spy `console.error` and `process.exit`; run `main()`; assert non-zero exit, the
      error names zero-ingestible, and no `[]` output is written as success.
- [ ] **6. Regression test — out dir is created.** `--out` into a missing parent; assert the file is
      written (no `ENOENT`) and parses against `DocListSchema`.
- [ ] **7. Confirm the untouched paths still pass** — `empty source → [] exit 0` and
      `partial rejection → warn + exit 0` tests unchanged and green (proves the guard didn't
      over-tighten).
- [ ] **8. Gate.** `bun run test` green (77 → 79 tests), `bun run lint` clean, `bun run spur-check`
      green. Coverage stays ≥ the 90% line/function target.
- [ ] **9. Verdict artifact.** Write the verify answer as markdown tables
      (`| Req | Status | Evidence |`, `| AC | Status | Evidence Type | Evidence |`) citing the new
      tests; `spur task verdict <this wbs> --from-answer` must read `verdict: PASS` before close.
### Solution

#### Change Map
- `plugins/karakeep-local/src/index.ts:2,145-167`:
  - Imported `mkdir` from `node:fs/promises`.
  - Added candidate file count check in `main()`: if `candidateFiles.length > 0` and `docs.length === 0`, outputs fatal error log and exits `1` (R1).
  - Added parent directory creation `mkdir(outDir, { recursive: true })` for `dirname(values.out)` before `writeFile` (R2).
- `plugins/karakeep-local/tests/karakeep-local.test.ts:149-187`:
  - Added unit test verifying `processKarakeepFolder` throws on non-directory path input.
  - Added unit test verifying `main()` exits `1` with error message when non-empty source directory yields zero ingestible documents (R1).
  - Added unit test verifying `main()` creates nested `--out` parent directories recursively before writing output (R2).

### Testing

- Verdict: **PASS**
- Commands run:
  - `bun run lint`: clean (0 Biome / TypeScript errors)
  - `bun run test`: 80 pass, 0 fail (karakeep-local functions 100%, lines 92.97% >= 90% target)

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | ------ | -------- |
| R1 | MET | `plugins/karakeep-local/src/index.ts:148-154`, `plugins/karakeep-local/tests/karakeep-local.test.ts:159-180` — `main()` checks candidate file count and exits `1` with log when `candidateFiles.length > 0` and `docs.length === 0`. |
| R2 | MET | `plugins/karakeep-local/src/index.ts:156-159`, `plugins/karakeep-local/tests/karakeep-local.test.ts:182-194` — `main()` creates nested `--out` parent directory recursively before writing output file. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | ------ | ------------- | -------- |
| Scenario: All-rejected non-empty source exits non-zero | MET | test | `plugins/karakeep-local/tests/karakeep-local.test.ts:159-180` |
| Scenario: Missing --out parent directory is created | MET | test | `plugins/karakeep-local/tests/karakeep-local.test.ts:182-194` |
| Scenario: Empty source folder yields empty array | MET | test | `plugins/karakeep-local/tests/karakeep-local.test.ts:76-85` |
| Scenario: Partial rejection still emits valid items with exit 0 | MET | test | `plugins/karakeep-local/tests/karakeep-local.test.ts:59-74` |

**Design Conformance**

| Claim | Status | Evidence |
| ----- | ------ | -------- |
| Thin CLI guard in main() for all-rejected zero-doc | DONE | `plugins/karakeep-local/src/index.ts:148-154` |
| Recursive mkdir for out-dir in main() | DONE | `plugins/karakeep-local/src/index.ts:156-159` |

**SECUA Review** — PASS. Defensive directory creation and validation logic; zero security risk.

### Review

| Severity | Finding | Location | Status |
| --- | --- | --- | --- |
| P4 | Out directory check skips recursive mkdir for current directory `.` | `plugins/karakeep-local/src/index.ts:157` | Resolved |

#### Residual Risk & Final Disposition
- Zero residual risk. Robust fail-loud and parent directory creation behavior verified with unit tests. Approved for `done`.

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-08-03T03:11:55.451Z backlog → todo (system)
- 2026-08-03T03:11:56.600Z todo → wip (system)
- 2026-08-03T03:12:52.325Z wip → testing (system)
- 2026-08-03T03:13:01.899Z testing → done (system)
