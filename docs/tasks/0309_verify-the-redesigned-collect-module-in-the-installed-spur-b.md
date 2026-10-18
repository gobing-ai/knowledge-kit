---
schema_version: 1
name: Verify the redesigned Collect module in the installed Spur Board against the real store
status: done
template: feature-impl
created_at: 2026-10-17T05:04:06.960Z
updated_at: "2026-10-18T21:07:09.853Z"
feature_id: G81
priority: P2
tags:
  - board
  - e2e
  - verification
estimate_hours: 3

dependencies: ["0308"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0309-verdict.json
---

## 0309. Verify the redesigned Collect module in the installed Spur Board against the real store

### Background

Implements: R11 — Installed Board verification against the real store.

Operator ask (run 5f03d609-ece9-4f6f-9555-dba2a7b0cb2b): the redesigned Collect module must help the end user understand kk-collect results and progress; this proves it end to end on real data. Design: docs/design/collect-store-views.md §5.

**Refine corrections (2026-10-16)**
- "start the reader over a temp copy of `.works/kk.db`" → the reader opens `<projectPath>/.works/kk.db` of the throwaway project the harness builds (`apps/board/tests/installed-board.test.ts:102`), whose Spur runs are fixtures `r-a`, `r-b`, … (`:405-417`); a copy of the live store holds none of those run ids, so every row would be `null` → split the check: (a) repeatable test — seed the throwaway project's `.works/kk.db` through the real kk-store DAOs (`CollectRunsDao.start/finish`, items, labels, `SelectionsDao.insertMany`) with a row for `r-a` and none for `r-b`; (b) live check — the installed Board over this checkout's own project and real store, read-only.
- "never the live file" → (b) must read the live store to prove real data; safety comes from 0307's read-only open, proven by `sqlite_master` + row-count digests before/after in the artifact, not from copying.
- "record that none exists" → live `.spur/spur.db` already holds a failed kk-collect run (59 done / 1 failed / 3 running vs 47 `collect_runs`), so a no-store-row run exists; the artifact records which run id was checked.

### Requirements

- [x] R1 — `apps/board/tests/installed-board.test.ts` gains a Collect store scenario: the throwaway project's `.works/kk.db` is seeded through the real kk-store DAOs with a `collect_runs` row, items, label rows and a selection for fixture run `r-a` and nothing for `r-b`; Chromium on the installed Board asserts Overview (banner state, `r-a` counts, `r-b` = `no store row`), Run detail funnel and label quality for `r-a`, Items paging + one filter, `?tab=results` → Run detail, and zero console errors.
- [x] R2 — Same scenario with the store file removed shows the `board.store.missing` diagnostic in the store panels while Execution progress still renders; the file is not created by the request.
- [x] R3 — `apps/board/scripts/verify-collect-live.ts` (run with `bun`) opens the installed Board over this checkout's real project, visits Overview, Run detail and Items for one run with a store row and one without, and writes `.works/.board/verify/<stamp>/` containing `report.json` (checked run ids, per-tab pass/fail, console errors) and per-tab screenshots, plus `sqlite_master` and per-table row-count digests of `.works/kk.db` taken before and after; it exits non-zero if the digests differ or any tab fails.

**Out of scope:** reader or UI changes (0307/0308) beyond fixes the check exposes; CI wiring for the live script (operator-run, needs the real store).

### Acceptance Criteria

- [x] AC1 — Installed Board verification against the real store

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-17T05:19:40.632Z

- Q: Copy the live store or read it in place? → A: fixture-seeded store for the repeatable test; live store read in place for the operator check, guarded by before/after digests. Closed 2026-10-16 (refine).

### Design

- WHAT/WHY: prove end to end that the redesigned module shows real Collect results and progress without touching the store. WHERE: `apps/board/tests/installed-board.test.ts` (repeatable, fixture store), `apps/board/scripts/verify-collect-live.ts` (operator-run, real store), artifact `.works/.board/verify/<stamp>/`.
- Reuse: the installed-Board harness helpers (throwaway project, `capture`, Chromium launch) and the Playwright already in `apps/board` devDependencies; seeding uses kk-store's public DAOs, never raw SQL.
- Digest = sha256 over `SELECT type,name,sql FROM sqlite_master ORDER BY name` plus `count(*)` of `collect_runs`, `items`, `labels`, `selections`, read with a read-only connection (`sqlite3 -readonly` semantics). A collect tick landing mid-check changes counts → rerun; the script names that cause in its failure message.
- Rejected: copying the live store into the throwaway project (run ids never match fixtures); mocking the store (the point is real data).

### Plan

1. Add the failing Collect store scenario to `installed-board.test.ts` (seed helper via DAOs; missing-store case). (R1, R2)
2. Fix anything in 0307/0308 output the scenario exposes; make it pass.
3. Write `verify-collect-live.ts`; run it against this checkout; keep the artifact path. (R3)
4. Record test result and artifact path in Testing evidence; `bun run lint`, `bun run test`, `bun run build`.

### Solution

Reusable coverage for the redesigned Collect module on a real store, plus the operator-run live check.
The store plane is written only through the real kk-store DAOs — no raw SQL, no mocking — and the
Board is always the *installed* package (the packed CLI tarball), never the source checkout.

**Change map**

| Anchor | What it adds |
| --- | --- |
| `apps/board/package.json:20` | `@gobing-ai/kk-store` devDep: the test seeds the store through the real DAOs, so the class must resolve from `apps/board`. |
| `bun.lock:17` | Lock entry for that workspace dep (`bun install`; it also refreshed the stale `apps/cli` version stamp). |
| `apps/board/tests/installed-board.test.ts:35` | Imports `openStore` and Playwright's `ConsoleMessage`/`Locator` types. |
| `apps/board/tests/installed-board.test.ts:371` | `storeDbPath()` — the throwaway project's `.works/kk.db`, the file the reader opens. |
| `apps/board/tests/installed-board.test.ts:384` | `seedCollectStore()` — R1/R2 fixture: `CollectRunsDao.start/finish`, 27 `ItemsDao.upsertDocs` items over two sources, four `LabelsDao.recordObservation` rows — HIGH and MEDIUM model answers, one heuristic row with no level and one `default` LOW row, each carrying the item's `content_hash` because `labels_current` joins on it — and three `SelectionsDao.insertMany` rows (selected/published/dropped) for `r-a`; nothing for `r-b`. |
| `apps/board/tests/installed-board.test.ts:475` | `consoleErrorsDuring()` — collects console + uncaught page errors; each R1 test keeps it attached for the WHOLE scenario (load, paging, filter, quality toggle). |
| `apps/board/tests/installed-board.test.ts:496` | `overviewRow()` — the Overview table row for one run id (exact run-link text). |
| `apps/board/tests/installed-board.test.ts:559` | Setup step 4b: seed the store after the captures, so every later assertion sees one store plane. |
| `apps/board/tests/installed-board.test.ts:949` | R1 suite: Overview banner (`on schedule`, `0 failed · 4 done without a store row`), `r-a` counts (`27` inserted, `4` label rows, `25%` fallback, `1 selected · 1 published · 1 dropped`), `r-b` = `no store row`; Run detail funnel (4 stages, `27 inserted · 0 updated · 0 unchanged`, `4 label rows: 1 heuristic · 2 model · 1 default`), label quality (the full `Value · HIGH · MEDIUM · LOW · none` histogram: `ai-news` = `1 / 1 / 0 / 1`, `other` = `0 / 0 / 1 / 0`, + effective toggle), `?tab=results` alias, Items paging (`Page 1 of 2 · 27 items` → page 2) and one source filter through the reader route; zero console errors over each whole sequence. |
| `apps/board/tests/installed-board.test.ts:1073` | R2 suite: with `.works/kk.db` renamed away, Overview and Run detail state `no kk store at .works/kk.db`, cadence falls to `unknown`, Execution progress still renders its recorded states, and the request never re-creates the file. |
| `apps/board/scripts/verify-collect-live.ts:39` | R3 script root (`REPO`) and the four digested tables (`:44`) plus `CONFIDENCE_LEVELS` (`:46`). |
| `apps/board/scripts/verify-collect-live.ts:91` | `CAPTURE_ROUTE` + `expectedReaderMiss()` (`:99`): the only forgivable console error is a **404** on `…/runs/<id>/(results|config)` — no capture record exists in either checkout, so those two shipped endpoints miss in place too; any other status or route fails. |
| `apps/board/scripts/verify-collect-live.ts:142` | `storeFiles()` / `digest()` (`:150`): sha256 of the store `db` **and** `wal`, and `sqlite_master` sha256 + per-table row counts, over read-only connections. |
| `apps/board/scripts/verify-collect-live.ts:168` | `spurRuns()` / `boardRunPage()` (`:189`) / `pickRunIds()` (`:219`): the checked stored run comes from the Board's own first page; the no-row run may be older (deep-linked), both real ids. |
| `apps/board/scripts/verify-collect-live.ts:267` | `boardProject()`: links the live store (and its `-wal`) instead of copying it, copies the Spur plane (a `spur serve` writes to its database), and hosts the CLI tarball packed from this worktree. |
| `apps/board/scripts/verify-collect-live.ts:401` | `checkTabs()`: Chromium over Overview / Run detail / Items for both runs, per-tab pass/fail + screenshot, label-quality histogram required to name HIGH/MEDIUM/LOW, console errors classified by their HTTP status. |
| `apps/board/scripts/verify-collect-live.ts:527` | `operatorCommand()`: the exact invocation, flags included, so the report's command re-runs clean. |
| `apps/board/scripts/verify-collect-live.ts:533` | `main()`: fingerprints the store before, runs the Board over the live store, fingerprints it after, requires both pairs identical, writes `report.json`, exits non-zero on digest drift or a failed tab. |

**Rationale**

- The repeatable test cannot use the live store: its `collect_runs` run ids never match the throwaway
  project's Spur fixtures (design §5), so the fixture store is seeded instead — through the same DAOs
  `kk store ingest/label` uses, which is what makes `labels_current`, yield precedence and the
  no-store-row path real rather than hand-written SQL.
- The live check opens the live store **in place** (design refine 2026-10-16): the reader is handed a
  symlink to the real `.works/kk.db` (+ its `-wal`, where the newest committed tick lives) and never a
  copy; content sha256 (db + wal) and `sqlite_master`/row counts are compared before and after.
- Serving `spur serve --cwd <checkout>` directly is impossible here and was verified both ways: the
  operator's Board owns that project ("Project already has a server owner (pid …)"), and a reader
  pointed at the checkout while a different Board serves another project answers 403
  `board.project.mismatch` (`apps/cli/src/board/reader.ts:267`). So the Board and reader share one
  project root; only the Spur plane is copied, because a board writes to its own database.
- No reader or UI change was needed: R1/R2 passed on the 0307/0308 output unchanged.

**Evidence**

```
$ NODE_ENV=test bun test apps/board/tests/installed-board.test.ts
(pass) Collect store views over a seeded store (G81/0309 R1) > joins the store onto the run page: banner, r-a counts, r-b has no store row
(pass) Collect store views over a seeded store (G81/0309 R1) > renders the Run detail funnel and label quality for r-a, including the ?tab=results alias
(pass) Collect store views over a seeded store (G81/0309 R1) > pages the Items tab and filters it through the reader route
(pass) Collect store views with the store file removed (G81/0309 R2) > states board.store.missing, keeps Execution progress, and never creates the store
 18 pass, 0 fail

$ bun /Users/robin/xprojects/knowledge-kit-runall-g81-870f/apps/board/scripts/verify-collect-live.ts --project /Users/robin/xprojects/knowledge-kit
runs: f163d4f9… (store row) · 3d2cc27b… (no store row)
PASS (page) overview: 25 run rows (0 not stored); f163d4f9… inserted 4; banner: on schedule 4.0 h since the last stored collection (schedule 6 h)
PASS f163d4f9… summary: 4 funnel stages; label quality: 20 histogram row(s) with HIGH/MEDIUM/LOW columns
PASS f163d4f9… items: 25 item rows; Previous Page 1 of 3 · 53 items Next
PASS 3d2cc27b… summary: states "This run wrote no store row."
PASS 3d2cc27b… items: 0 item rows (no store row for this run)
note: 8 console error(s) are the reader's 404 for results/config of a run with no capture record
artifacts: .works/.board/verify/2026-10-17T16-58-35-694Z      (exit 0)
store db  sha256 215d5f28…c41c9a  before == after
store wal sha256 c9db98c6…f869900 before == after
sqlite_master sha256 5f3b8e3b…536900 source == after
row counts 51 collect_runs · 341 items · 5490 labels · 145 selections before == after

$ bun … rule run --preset recommended-pre-check --fail-on warning
All 56 rules passed — no violations found.

$ bun … task gate 0309 light
FAIL — only `rules:post` = `coverage-gate` (partial lcov for packages/kk-store, measured from one
browser-test file). format-lint / rules:pre / typecheck / test:apps/board all PASS (18 pass / 0 fail).
```

Operator command for their own checkout: `bun <repo>/apps/board/scripts/verify-collect-live.ts --project
/path/to/checkout` (the report prints the exact string it was started with). Artifacts land in
`<project>/.works/.board/verify/<stamp>/`.

**Residual risk**

- The live Spur plane is copied (a `spur serve` writes to its database, and the operator's server owns
  the checkout), and that copy is a point-in-time snapshot: the `cp` of `.db` + `-wal` is not atomic
  against a concurrent writer.
- The store is linked, not moved: an operator who runs the check while a collector is mid-tick can see
  a digest mismatch — the script names that cause and asks for a rerun.
- `bun install` also refreshed the stale `apps/cli` version stamp in `bun.lock` (0.0.37 → 0.1.2).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Seeded-store Collect scenario on the installed Board — `apps/board/tests/installed-board.test.ts` 19 pass / 0 fail (bun test, this run; real Chromium). |
| R2 | MET | Store-removed scenario shows `board.store.missing` in the store panels while Execution progress renders; the request does not create the file — same installed suite. |
| R3 | MET | Live script re-run this session: all five tab/run checks PASS (overview banner on-schedule, funnel + 16 label-quality histogram rows, items paging "Page 1 of 3 · 51 items", no-store-row run states); store db/wal sha256 and `sqlite_master` byte-identical before/after; row counts {collect_runs:60, items:368, labels:6052, selections:151}; artifact `.works/.board/verify/2026-10-18T21-04-55-862Z/report.json` + screenshots. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R11 — Installed Board verification against the real store | MET | command | `bun apps/board/scripts/verify-collect-live.ts --project <checkout>` exit 0 this run — all five checks PASS, before/after digests identical (`apps/board/scripts/verify-collect-live.ts:599`); installed suite `apps/board/tests/installed-board.test.ts` 19 pass / 0 fail this run. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS

#### Review Report — 0309 (pass 2, after remediation)
**Scope:** 0309 diff (`apps/board/tests/installed-board.test.ts` +306, `apps/board/package.json`, `bun.lock`, task doc) + new `apps/board/scripts/verify-collect-live.ts` (695 lines) + live artifacts `.works/.board/verify/2026-10-17T16-58-35-694Z/` (worker run) and `…T17-12-18-542Z` / `…T17-13-40-155Z` (this review's two runs)
**Dimensions:** R1–R3 + AC1 traceability, correctness, security (does anything write to the operator tree?), efficiency, usability, architecture/depth
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P2 (major) | architecture / R3 scope | **Pass-1 P2 is fixed.** The store plane is no longer a copy: the temp Board project carries a **symlink** to the project's real `.works/kk.db` (and its `-wal`) at `verify-collect-live.ts:272-273`, so the reader opens the real file and the before/after pair now fingerprints the file the Board actually reads. Independently reproduced: my two runs drove *different* live runs than the worker's artifact (mine `1bda7cfd…`, worker `f163d4f9…`) and reported live item counts (`Page 1 of 3 · 53 items`) matching my direct `sqlite3` reads at that moment (52 `collect_runs`), i.e. real, moving data — not a snapshot | `apps/board/scripts/verify-collect-live.ts:267-288`; artifact `sources.store.copied:false`, `openedInPlaceVia …T/kk-verify-collect-board-2CON1B/.works/kk.db`; my `.works/.board/verify/2026-10-17T17-13-40-155Z/report.json` | RESOLVED (fixed at `:272-273`) |
| 2 | P3 (minor) | correctness / evidence | **Pass-1 P3.1 is fixed.** `operatorCommand()` records the resolved argv (`:527-533`); I ran the recorded string verbatim from `/tmp` — once when a collector tick landed mid-run (exit 1) and once on an idle store (**exit 0**, all digests identical). The artifact now names the worktree script path; that is accurate (it is what was executed) and the `<repo>` form is documented, so an operator copying it from the same machine works. A moved/deleted worktree invalidates the string — expected for a path, not a defect | `apps/board/scripts/verify-collect-live.ts:527-533`; `report.json.operatorCommand` | RESOLVED (fixed at `:527`) |
| 3 | P3 (minor) | security / evidence | **Pass-1 P3.2 is fixed.** `storeFiles()` (`:142-146`) hashes the `db` **and** the `-wal` content; both are taken before and after, and both pairs plus the schema/count digest are required (`:602-607` `ok = contentIdentical && digestIdentical && tabsPassed && unexpected.length === 0`). Verified in the artifact and in my run 2: `fileSha256.identical: true`, `schemaAndCounts.identical: true`, `ok: true`, exit 0 | `apps/board/scripts/verify-collect-live.ts:142-146`, `:602-607` | RESOLVED |
| 4 | P3 (minor) | correctness / 8a | **Pass-1 P3.3 is fixed.** `expectedReaderMiss()` now requires `status === 404` **and** one of exactly two routes (`:99-104`), the status coming from a real response map (`:415-421`), so a 500/403 on those routes is `unexpected` and exits 1. Artifact: 8 console errors, all `status: 404`, all matching `…/runs/<id>/(results\|config)`, with the true cause stated ("no capture record in either checkout", `.works/.board/captures` absent — re-checked). Fail-on-500 is a code-path claim: I did not force a 500 | `apps/board/scripts/verify-collect-live.ts:91-104`, `:415-421`; `report.json.consoleErrors[*].status` | RESOLVED |
| 5 | P3 (minor) | test strength / R1 | **Pass-1 P3.4 is fixed.** Each of the three R1 tests wraps its **whole** scenario in `consoleErrorsDuring` (`:955`, `:983`, `:1036`), so page 2, the `source` filter and the effective-labels toggle all run inside the collected window; `expect(errors).toEqual([])` follows each block (`:972`, `:1019`, `:1067`) | `apps/board/tests/installed-board.test.ts:475-495`, `:955`, `:983`, `:1036` | RESOLVED |
| 6 | P3 (minor) | security / evidence | The reader's "read-only" store open is a **read-write** SQLite connection: `openStore({migrate:false})` (`apps/cli/src/board/collect-store.ts:99`) opens the file read-write and issues `PRAGMA journal_mode = WAL` (`packages/kk-store/src/db.ts:65`); closing it as the last connection **checkpoints the WAL into the main file**. Reproduced on a copy of the live store: db 4,231,168 → 4,247,552 bytes, `-wal` 696,312 → 0 bytes — through the harness's symlink layout as well. So AC1's "without touching the store" is true for rows/DDL, not for file bytes, and if a checkpoint fires during a run the guard reports it as "a collect tick may have landed" (`:639-644`) — a misleading FAIL. Latent today: 3 of 3 live runs left db and `-wal` byte-identical (SQLite only checkpoints when the reader is the last connection; run 2 left both untouched) | `apps/cli/src/board/collect-store.ts:99`, `packages/kk-store/src/db.ts:61-77` (`:65` the PRAGMA), `apps/board/scripts/verify-collect-live.ts:639-644` | RESOLVED — 2026-10-18: journal-mode conversion fixed (`journalModePragma(false)` → null, `packages/kk-store/src/db.ts:67-69`; 770e3c44); the misleading FAIL fixed by the checkpoint classifier (2269ed30, `apps/board/scripts/verify-collect-live.ts:643-645`); the "close may checkpoint" caveat is now explicit in `docs/design/collect-store-views.md` §5; today's live run left db/wal byte-identical. |
| 7 | P4 (advisory) | evidence / 8a | With a temp project root, the 8 capture 404s are now *structurally* guaranteed, not a statement about the data: a capture record names the absolute project it was taken in, and the Board's project is `…/T/kk-verify-collect-board-*`, so those two routes can never answer 200 in this shape (they also 404 in place — no capture record exists in the checkout). The allowance is honest for what R3 checks (Overview / Run detail / Items), and R1 covers those routes on the seeded project where captures exist | `apps/board/scripts/verify-collect-live.ts:91-104`, `:272-273`; `.works/.board/captures` absent in both checkouts | ACCEPTED |
| 8 | P4 (advisory) | architecture / depth | 695 lines, one job (drive the installed Board over a project, fingerprint, report) with a clear pipeline (`boardProject` → `packAndInstall` → servers → `checkTabs` → digests → `report.json`); not a god-script, but ~120 lines of harness are reimplemented from the installed-Board suite (`freePort`, `spawnServer`, `waitFor`, `packAndInstall`, `overviewRow`) and the script stays outside `tsc` (`apps/board/tsconfig.json:3` includes only `src`/`tests`; precedent `packages/publish-harness/scripts`). Per-run cost: a 9.4 GB copy of the real `.spur/spur.db` (required — a Board writes to it) removed in `finally`; ~18 s end to end on this machine | `apps/board/scripts/verify-collect-live.ts:317-352` vs `apps/board/tests/installed-board.test.ts:144-215`; `apps/board/tsconfig.json:3` | ACCEPTED |
| 9 | P4 (advisory) | gate | `bun … task gate 0309 light` still records FAIL on `rules:post: coverage-gate` (partial lcov rows for `packages/kk-store`, measured from the board browser test via the new devDep), while the repo gate `bun run spur-check` is **PASS** with proof-digest `sha256:06cde97e…` (receipt 2026-10-17T17:10:43Z, 3908 pass / 2 skip / 0 fail). The rule needs an explicit disposition (accept, or lcov-ignore the test-only import), not a code change | `.spur/run/0309-check-receipt.json`, `.spur/run/0309-test-gate.log`; task Solution `Evidence` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Store seeded through the real DAOs (`installed-board.test.ts:384-472`: `CollectRunsDao.start/finish`, 27 `ItemsDao.upsertDocs`, four `LabelsDao.recordObservation` carrying the item `content_hash`, three `SelectionsDao.insertMany`; nothing for `r-b`), then Overview banner + `r-a` counts + `r-b` `no store row` (`:949-978`), Run detail funnel/label quality + `?tab=results` (`:980-1031`), Items paging + one source filter (`:1033-1071`), each block with `expect(errors).toEqual([])` over the whole scenario (`:955-972`, `:983-1019`, `:1036-1067`). Fresh: `NODE_ENV=test bun test apps/board/tests/installed-board.test.ts` → **18 pass / 0 fail / 148 expect()** (this review, 17:11Z) |
| R2 | MET | `.works/kk.db` renamed away (`:1082-1113`): Overview and Run detail state `no kk store at .works/kk.db`, cadence falls to `unknown`, Execution progress still renders (`/api/runs/r-a/progress`), and `existsSync(storePath)` is `false` afterwards — the read never materializes the file (`sessionFor` stats before opening, `apps/cli/src/board/collect-store.ts:93-99`) |
| R3 | MET | All deliverables exist and were exercised twice by this review: `<stamp>/report.json` (checked run ids, five per-tab pass/fail rows, console errors with statuses, `failedRequests`, both digest pairs), 5 screenshots (65–166 KB), non-zero exit on drift and 0 on a clean store. Subject: the **real store file in place** through the harness link (`:272-273`), the real run history via a documented Spur-plane copy, the installed module from this worktree's tarball. The project *root* is a temp dir — a deviation justified by two walls I verified independently: pid 91860 is a live `spur serve --cwd /Users/robin/xprojects/knowledge-kit` (`ps`), and the reader refuses a Board whose canonical project differs (`apps/cli/src/board/reader.ts:259-276`, 403 `board.project.mismatch`) |
| AC1 | MET | Real-data proof reproduced by this review: live store read in place (`sha256 215d5f28…` at the worker's run; `d2230ae7…` after a checkpoint that followed a collector tick), live run ids and counts changing between runs, tabs green, digests identical on an idle store → exit 0. Caveat carried as row 6: "without touching the store" holds for rows/DDL, not for file bytes |

##### What I verified myself (not taken from the task record)

- `NODE_ENV=test bun test apps/board/tests/installed-board.test.ts` → **18 pass, 0 fail, 148 expect()**, 17.76 s.
- Ran the recorded operator command verbatim from `/tmp`, twice: run 1 → exit **1** on genuine drift (a collector tick landed: `labels` 5490 → 5569; all five tabs PASS), run 2 → exit **0**, `fileSha256`/`schemaAndCounts` both identical, run id `1bda7cfd…` (newer than the worker's `f163d4f9…`).
- `shasum -a 256 .works/kk.db` before and after run 2 → unchanged (`d2230ae7…`), `-wal` size and mtime unchanged (10:12) → the check's own reads did not write to the operator's store *in these runs*.
- Reproduced the checkpoint mechanism on **copies** in `/tmp` (real path and symlinked path): `openStore({migrate:false})` + read + `close()` → db 4,231,168 → 4,247,552 bytes, `-wal` 696,312 → 0, `-shm` created (Bun resolves the symlink, so the real file is the one rewritten).
- `ps` → pid 91860 alive on `/Users/robin/xprojects/knowledge-kit` port 3003; `apps/cli/src/board/reader.ts:259-276` confirms the 403 project-mismatch gate.
- `.works/.board/captures` absent in the operator checkout; `find .works .spur -newer <marker>` after my runs → only the live collector's files (`kk.db`, `kk.db-wal`), the live server's logs/`spur.db`, and my two authorized `.works/.board/verify/<stamp>/` dirs; no stray chromium/spur processes left by me.
- `git diff HEAD` on the test file → one removed line (a playwright import), no `.skip`/`.only`, no weakened assertion.

##### Calls on the flagged questions

- **Symlink-as-in-place — faithful, not a loophole, for the store plane; a documented deviation for the project root.** The link makes the reader open the real file, and any write the reader attempted would land on the real file — the harness isolates nothing, so the before/after pair observes exactly what the Board reads. It is *not* "in place" for the project identity: the Board serves a temp root and a copied Spur plane. Given the operator's explicit in-place authorization and the two shipped walls (server owner; project-mismatch 403, both re-verified above), a stricter shape would require stopping the operator's own server, which the check may not do. The residual is row 7, not row 1.
- **`operatorCommand` naming the worktree script — acceptable.** It is the truth of the invocation, it is copy-pasteable on this machine (proved twice), and the artifact carries the resolved paths it used. An operator on another machine composes the `<repo>` form the task already documents.
- **The 8 console errors — correctly allowed now.** All 8 are status-404 `board.capture.missing` on exactly the two routes; the cause is stated and reproducible; a 500 would fail (code path). The allowance is structurally guaranteed by the temp root (row 7), and R1 covers those routes with captures present.
- **Writes to the operator tree — none from the check's own file handling, one latent path (row 6).** The check only reads `.spur/spur.db` (streamed sha256 + `copyFileSync` into `/tmp`), reads the store read-only at the digest level, and writes only `.works/.board/verify/<stamp>/` (authorized, gitignored). The latent path is the reader's read-write open, which can checkpoint the store on a last-connection close.

##### Claim | Basis | How to re-check

| Claim | Basis | How to re-check |
|-------|-------|-----------------|
| The Board's store reads hit the live file | `symlinkSync(paths.store, link)` + live run ids/counts matching a direct `sqlite3` read | `bun <repo>/apps/board/scripts/verify-collect-live.ts --project /Users/robin/xprojects/knowledge-kit`, then diff `report.json.checkedRuns` against `sqlite3 -readonly .works/kk.db "select run_id from collect_runs"` |
| The check does not rewrite the store | Two runs, db `-wal` bytes and mtimes unchanged; `fileSha256.identical:true` | Re-run on an idle store and compare `shasum -a 256 .works/kk.db .works/kk.db-wal` before/after |
| The reader's open can checkpoint the store | Reproduced on copies: db grew 16 KB, `-wal` → 0 bytes after `close()` | `openStore({path, migrate:false})` then `close()` on a copied `.db`+`-wal`, compare sizes |
| R1's zero-console-error claim covers interactions | Collector wraps each whole scenario | `installed-board.test.ts:955`, `:983`, `:1036` |
| 404-only allowance | `expectedReaderMiss` requires status 404 + route | `verify-collect-live.ts:99-104`, `:415-421`; `report.json.consoleErrors[*].status` |
| Repo gate green on this tree | `.spur/run/0309-check-receipt.json` + log tail (3908 pass / 0 fail) | `bun run spur-check` (≈10 min) |

**Next:** accept row 6 as a reader-task follow-up (readonly open, or state "close may checkpoint" in the AC1 wording) and disposition the light-gate `coverage-gate` rule (row 9); nothing in the delivered work blocks.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-17T16:31:37.796Z todo → wip (system)
- 2026-10-17T17:20:27.822Z wip → testing (system)
- 2026-10-17T17:20:35.018Z testing → done (system)

