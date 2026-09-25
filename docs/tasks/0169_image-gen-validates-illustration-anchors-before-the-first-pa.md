---
schema_version: 1
name: image-gen validates illustration anchors before the first paid call
status: done
template: issue
created_at: 2026-09-25T18:52:58.637Z
updated_at: "2026-09-25T22:32:59.411Z"

feature_id: D7
ac_altitude: graduating
---

## 0169. image-gen validates illustration anchors before the first paid call

### Background

Found during the D6 refinement (2026-09-25). This task implements feature **D7** (image-gen pre-spend illustration anchor validation, a child of D). It fixes a defect in the illustration branch that task 0107 shipped under the done K wayfinder map. 0107's Solution states that the illustration branch "validates anchor occurs exactly once BEFORE spending image bytes". The code does not do that: in `processGeneratorIO` (`plugins/generations/image-gen/src/index.ts`), the anchor checks run after `provider.generate()` returns (`index.ts:222` → `:223-236`). The comment at `:223` ("before we spend image 1") contradicts the code order.

Impact:
- **Paid-and-discarded image.** A missing, absent, duplicated, or overlapping anchor lets image 1 (or image k) be generated and billed. The job then throws, and the failure cleanup (`index.ts:~285`) deletes the paid bytes.
- **Doomed confirmation.** `kk:image-authoring` runs preview (`KK_IMAGE_DRY_RUN=1`) → operator confirmation → paid run (`plugins/kk/skills/image-authoring/SKILL.md:58,214`). The dry run never checks anchors, so the operator confirms spend for a run that must fail.
- **Overlap corrupts after spend.** Insertion replaces anchor k with `anchor\n\n![Illustration k](path)` (`index.ts:256`). If two anchors' occurrences overlap (e.g. `foo` inside `foo bar`, or a suffix/prefix overlap like `a b` / `b c`), inserting after the first breaks the second. Its in-loop check then fails after image 1 was already paid for, and the insertion may already have split a heading.

The fix is deterministic string validation. It adds no provider behavior and no surface change.

### Requirements

- [x] R1. For `job: 'illustration'`, validate the anchor plan in the "fail before any provider work" block (`index.ts:168`), after `composePrompts` and the cap check and before `resolveProvider` (`:179`), so it runs on both the dry-run and the paid branch. Every prompt index must have a supplied anchor; otherwise throw the existing `Illustration anchor missing from metadata.positions`. A count/positions mismatch is already rejected by `composePrompts` (`index.ts:113`). Each anchor must occur exactly once in the original `doc.body`; otherwise throw the existing `Illustration anchor must occur exactly once in the source body, found <n>: '<anchor[0..50]>'`. An empty-string anchor counts as found 0.
- [x] R2. Anchor occurrence ranges `[indexOf, indexOf + length)` in the original body must be pairwise disjoint. This covers duplicate entries in `positions`, containment (`foo` / `foo bar`), and partial overlap (`a b` / `b c`). Otherwise throw `Illustration anchors overlap in the source body: '<a[0..50]>' and '<b[0..50]>'`.
- [x] R3. Valid plans behave byte-identically: prompts, bodies, captions, and metadata are unchanged, and all existing image-gen tests pass except the one fixture whose body lacks its anchors (Plan step 3). Keep the in-loop check (`index.ts:224-236`) as a defensive guard for the spliced body, and correct its comment. See Q&A for the alt-text/path residual.

### Acceptance Criteria

- [x] AC1 — Bad anchors fail before any provider call (req: R1)
- [x] AC2 — Overlapping anchors fail before any provider call (req: R2)
- [x] AC3 — Valid anchor plans are unchanged (req: R3)

### Q&A

- **Feature link = D7 (closed 2026-09-25).** D7 is a new child of D, the generator-plugin family that already holds image-gen's D6. K was rejected because it is a done wayfinder map with no BDD AC, and reopening it for a single defect distorts its status. D6 was rejected because its scope is runtime provider fallback, not input validation. Sequencing: land 0169 before D6's 0166, since both edit `processGeneratorIO` and 0166 assumes anchor errors are pre-spend.
- **Dry run validates too (closed).** The only dry-run fixture with anchors absent from the body is `tests/image-gen.test.ts:137-152` (body `'article'`, anchors `anchor one` / `anchor two`). That is test data, not a supported use: `kk:image-authoring` picks anchors from the body before previewing. Validating in the dry run makes the preview catch the error before the operator confirms spend.
- **Why keep the in-loop check (closed).** Insertion adds `\n\n![Illustration k](<path>)`. A later anchor that is a substring of that text (e.g. an anchor `Illustration 2`, or a path fragment) would be matched twice after splicing. The path is only known after `generate` (the extension comes from the result), so this cannot be fully pre-checked. The residual is a pathological anchor and stays guarded, loudly, by the existing check. Upgrade path, if it ever occurs: pre-reject anchors that match `/Illustration \d+/` or contain `](`.
- **Ordering (closed).** Images are inserted in `positions` order, not body order. Disjointness makes this safe, and the order is unchanged.
- **Error text (closed).** R1 reuses the current messages verbatim, so callers and skills that match on them keep working. Only R2's overlap message is new.
- **Out of scope.** Moving insertion to a single pass over the original body (which would remove the residual entirely), and caption/alt-text changes.

### Design

One private helper in `plugins/generations/image-gen/src/index.ts`, next to `composePrompts`, and one call site. No new module, no export, no surface change.

```ts
/** Task 0169: validate the illustration anchor plan against the original body before any provider work. */
function assertAnchorPlan(body: string, positions: string[] | undefined, count: number): void {
    const ranges: { anchor: string; start: number; end: number }[] = [];
    for (let index = 0; index < count; index++) {
        const anchor = positions?.[index];
        if (anchor === undefined) {
            throw new Error('Illustration anchor missing from metadata.positions');
        }
        const found = anchor === '' ? 0 : body.split(anchor).length - 1;
        if (found !== 1) {
            throw new Error(
                `Illustration anchor must occur exactly once in the source body, found ${found}: '${anchor.slice(0, 50)}'`,
            );
        }
        const start = body.indexOf(anchor);
        ranges.push({ anchor, start, end: start + anchor.length });
    }
    // ponytail: O(n²) pair scan; n ≤ maxImages (default 4), so sorting is not worth it.
    for (const [i, a] of ranges.entries()) {
        for (const b of ranges.slice(i + 1)) {
            if (a.start < b.end && b.start < a.end) {
                throw new Error(
                    `Illustration anchors overlap in the source body: '${a.anchor.slice(0, 50)}' and '${b.anchor.slice(0, 50)}'`,
                );
            }
        }
    }
}
```

Call site, inside the pre-provider block after the cap check (`index.ts:~177`), before `resolveProvider` (`:179`):

```ts
if (spec.job === 'illustration') assertAnchorPlan(doc?.body ?? '', positions, prompts.length);
```

The in-loop block (`:223-236`) stays. Only its comment changes, to: `// Re-check against the spliced body; the pre-spend plan check is assertAnchorPlan (0169).`

Rejected:
- Validating only on the paid branch. The preview would then pass a doomed plan to operator confirmation.
- Single-pass insertion over the original body. It is the better long-term shape, but it is a larger rewrite of 0107 insertion with its own regression surface. Noted in Q&A.
- Pre-checking at `readPositions` in `job.ts`. It has no body and no prompt count.

### Plan

1. **Red first** (`plugins/generations/image-gen/tests/image-gen.test.ts`, in the `describe('the three job branches cross the money-spending boundary (0107)')` block, which uses `generatingResolver` and `genCalls`). Add a table test, run once without and once with `KK_IMAGE_DRY_RUN=1`. The resolver increments a `resolveCalls` counter, so "never selected" is observable. Cases:
   - `absent`: body `text`, positions `['missing']` → `/exactly once.*found 0/`
   - `duplicated in body`: body `twin twin`, positions `['twin']` → `/found 2/`
   - `not supplied`: body `text`, positions `undefined` → `/anchor missing/`
   - `empty anchor`: positions `['']` → `/found 0/`
   - `contained`: body `foo bar`, positions `['foo bar', 'foo']`, `maxImages: 2` → `/overlap.*foo bar.*foo/`
   - `partial overlap`: body `a b c`, positions `['a b', 'b c']` → `/overlap/`
   - `duplicate entry`: body `x`, positions `['x', 'x']` → `/overlap/`

   Assert: rejects; `genCalls === 0`; `resolveCalls === 0`; `existsSync(OUT) === false`; no file under `join(TMP, 'out')`. Confirm the new tests fail before step 2.
2. Add `assertAnchorPlan` and its call as in Design, and change the in-loop comment.
3. **Fixture update**: `tests/image-gen.test.ts:137-152`, the illustration dry run. Change `body: 'article'` → `body: 'intro anchor one middle anchor two end'`. The assertions are unchanged.
4. Run `bun test plugins/generations/image-gen/tests`. Every existing illustration test must pass unmodified apart from step 3: `tests/adapter.test.ts` ~l.101 (`A`/`B`), ~l.117 (`PILOT`), ~l.141 (nine `ANCHOR<i>`), and `tests/image-gen.test.ts:275-283`.
5. `bun run gate` (format + build + lint + rules + tests).
6. Docs: none required, because there is no surface change. Optionally append a one-line correction note to 0107's Solution through `spur task record`/`update --section Solution` only if the operator wants the history amended; leave 0107 alone by default.
7. Record Testing (red/green counts and gate output) via `spur task record 0169`, then verify via `/sp:dev-verify 0169`.

Estimate: about 1h. Blast radius: the illustration branch of `image-gen` only.

### Root Cause

- The anchor check is coupled to the insertion step. It reuses the `body.split(anchor)` that splices the image in, so it was placed after the image bytes exist (`index.ts:223-236`, `:250-262`). The "fail before any provider work" block (`index.ts:168-177`) validates spec, presets, and budget, but never anchors.
- Nothing checks that anchors are disjoint. "Exactly once" is checked per anchor against the progressively spliced body, never across anchors against the original body.
- No test covers bad anchors on the paid branch. The 0107 tests only exercise valid anchors (`tests/adapter.test.ts:~101-150`, `tests/image-gen.test.ts:255-283`).

### Solution

- **Gate helper** `assertAnchorPlan` next to `composePrompts` (`plugins/generations/image-gen/src/index.ts:130`): per-prompt anchor presence (existing `Illustration anchor missing from metadata.positions` verbatim), exactly-once in the original body (empty anchor = found 0; existing `must occur exactly once` message verbatim), and pairwise-disjoint `[indexOf, indexOf+length)` ranges (new `Illustration anchors overlap in the source body: 'a' and 'b'`).
- **Call site** in the pre-provider block after the cap check, before `resolveProvider` (`index.ts:206`) — the gate runs on the paid branch AND the dry run, so a bad plan can never reach `provider.validate`/`generate` nor a doomed operator confirmation.
- **In-loop check kept** as the spliced-body backstop; comment now names the pre-spend gate (`index.ts:253`).
- **Tests** (`plugins/generations/image-gen/tests/image-gen.test.ts`): red-first 14-case table (7 bad plans × paid/dry-run) in the 0107 describe asserting reject + `genCalls===0` + `resolveCalls===0` + empty out dir; `generatingResolver` counts `resolveCalls`. Fixture updates where the new gate exposed anchor-less illustration test data (Q&A: test data, not a supported use): the R6 dry-run illustration body → `intro anchor one middle anchor two end`, and the budget-cap count-9 doc → a valid 9-anchor plan (cap check still fires before the gate, `/cap 2/` intact). The table clears out-dir files but keeps the dir so the later stale-`--out` cleanup test keeps its precondition.
- **Verified:** red first (14 fail / 20 pass in the file), then green — 310 pass / 0 fail across the plugin's 18 test files, adapter suite included; `bun run format` applied.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | plugins/generations/image-gen/src/index.ts:130-148 — assertAnchorPlan throws 'Illustration anchor missing from metadata.positions' (:136-137) for unsupplied anchors, and 'Illustration anchor must occur exactly once in the source body, found <n>' (:139-141) when occurrences != 1; empty-string anchor counts as found 0 (:138). Called at index.ts:206 inside the pre-provider block — after composePrompts and the cap check (:202-205), before resolveProvider (:208) — so it runs on both the dry-run (:209) and paid (:248) branches. count/positions mismatch already rejected by composePrompts (index.ts:113). Tests: absent/duplicated/not-supplied/empty anchors rejected pre-provider, tests/image-gen.test.ts:299-351. |
| R2 | MET | plugins/generations/image-gen/src/index.ts:149-155 — occurrence ranges [indexOf, indexOf+length) must be pairwise disjoint (a.start < b.end && b.start < a.end, :152-153); throws 'Illustration anchors overlap in the source body: <a> and <b>' naming both anchors. Covers duplicate entries, containment, and partial overlap. Tests: 'contained anchor' (foo bar/foo, maxImages 2), 'partial overlap' (a b/b c), 'duplicate entry' (x/x) all reject with /overlap/, tests/image-gen.test.ts:307-315, 316. |
| R3 | MET | Valid plans unchanged: assertAnchorPlan is a pure guard that throws on bad plans only; prompts/bodies/captions/metadata paths untouched (index.ts:206 is a single guard line; the spliced-body re-check kept as defensive guard at index.ts:253-267 with corrected comment :253). Dry-run fixtures updated only to carry valid anchors (tests/image-gen.test.ts:144, :191-195); all paid-path job tests pass unchanged (3/3 at :288-291 region). Full suite green: 310 pass (plugin) / 1393 pass (repo-wide), 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Bad anchors fail before any provider call | MET | test | 7 bad plans × {paid, dry-run} = 14 tests pass (69ms): absent anchor (/exactly once.*found 0/), duplicated (/found 2/), not supplied (/anchor missing/), empty (/found 0/) each assert rejects.toThrow + genCalls===0 + resolveCalls===0 + no --out + empty artifact dir (tests/image-gen.test.ts:299-351); guard placed before resolveProvider on both branches (src/index.ts:206, :209, :248). |
| Scenario: R2 — Overlapping anchors fail before any provider call | MET | test | Overlap rows of the same 14-test matrix pass: contained anchor errors /overlap.*foo bar.*foo/ (both anchors named), partial overlap /overlap/, duplicate entry /overlap/ (tests/image-gen.test.ts:307-316); pairwise-disjoint throw at src/index.ts:149-155. |
| Scenario: R3 — Valid anchor plans are unchanged | MET | test | Repo-wide bun run test: 1393 pass, 0 fail (matches stamped proof digest sha256:c68df18e… in .spur/run/0169-test-gate.log:150); plugin suite 310 pass, 0 fail including all pre-existing R6/budget/boundary tests and the paid-path illustration provider test asserting output written beside --out (tests/image-gen.test.ts:288-291). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0169 (remediation re-run, run 8edcf6cf)

**Scope:** `git diff 485e433c` — `plugins/generations/image-gen/src/index.ts`, `plugins/generations/image-gen/tests/image-gen.test.ts` (+ doc-only status ticks in 0165/0166/0169 task files)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

**Remediation delta:** none in code or tests. The only change since the prior PASS review is that the task spec's R1–R3 and AC1–AC3 checkboxes are now ticked (all certified MET by verification). The proof digest re-stamped accordingly: fingerprint `sha256:c68df18eaf14d660b49e068efe143158c67022653277085d78d52b7d28efd076` recomputed this run over the current task+feature files and matches the `.spur/run/0169-test-gate.log` trailer (the run's older `…d3bc21a9…` capture predates the ticks; the fingerprint hashes task/feature content, so ticking boxes changes it — no code implication).

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P4 (advisory) | correctness | No P1–P3 findings: diff re-reviewed this run across all six dimensions; R1–R3 and AC1–AC3 traceable with fresh test evidence. Known accepted ceilings stand: O(n²) anchor pair scan (bounded by maxImages cap, `ponytail:`-noted) and the deliberate two-pass insertion residual (out of scope per D7). | `plugins/generations/image-gen/src/index.ts:130-155,206` |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `index.ts:130-143` — `assertAnchorPlan` throws the missing-anchor error (`:135`) and the exactly-once error (`:138-143`, empty anchor → found 0); invoked at `:206` before provider resolution (`:209`) and before the dry-run branch (`:212`), so it guards both branches pre-spend. Tests: 7 bad-plan cases × paid/dry-run assert rejection, `genCalls===0`, `resolveCalls===0`, no OUT artefact. |
| R2 | MET | `index.ts:146-155` — half-open-range pairwise overlap scan names both anchors in the error; covers duplicates, containment (`foo`/`foo bar`), partial overlap (`a b`/`b c`). Tests: contained-anchor, partial-overlap, duplicate-entry cases. |
| R3 | MET | Valid-plan path untouched: only the assert call was added; the in-loop spliced-body check is kept as a defensive guard with a corrected comment (`:253`). R6 dry-run fixture now carries a valid anchor plan (Plan step 3). Fresh full-suite run: 1393 pass / 0 fail. |
| AC1–AC3 | MET | Ticked in task spec this remediation; each backed by R1/R2/R3 evidence above and the regression tests in `tests/image-gen.test.ts:296-351`. |

##### Fresh verification evidence (this run, not inherited)

- `bun test` (plugins/generations/image-gen): 310 pass / 0 fail.
- `bun run test` (repo): 1393 pass / 0 fail, 5502 expect() calls — identical to the stamped gate log.
- Proof fingerprint recomputed: `sha256:c68df18eaf14d660b49e068efe143158c67022653277085d78d52b7d28efd076` — matches `.spur/run/0169-test-gate.log` trailer.

**Next:** none — gate may approve; no remediation required.

### References

- Feature: D7 (`docs/features/D7_image-gen-pre-spend-illustration-anchor-validation.md`, parent D). Origin task: 0107 (Solution claims pre-spend anchor validation), contract task: 0104 (anchor "exactly once" handoff, the `positions` envelope).
- Code: `plugins/generations/image-gen/src/index.ts`
  - `:105-125` `composePrompts` (count/positions mismatch)
  - `:168-177` pre-provider block
  - `:179` `resolveProvider`
  - `:182` dry-run branch
  - `:222` `generate`
  - `:223-236` in-loop anchor check
  - `:250-262` insertion
- `src/job.ts:~130-142` `readPositions`
- Tests: `plugins/generations/image-gen/tests/image-gen.test.ts:137-152`, `:255-283`; `tests/adapter.test.ts:~95-150`
- Consumer: `plugins/kk/skills/image-authoring/SKILL.md` (preview → confirm → paid run; `references/illustration-positions.md`)
- Related: D6 / 0166 (the fallback loop wraps only `validate`/`generate`; land 0169 first, which makes anchor errors pre-spend). K: the done wayfinder map where 0107 shipped.

### History

- 2026-09-25T20:36:56.428Z todo → wip (system)
- 2026-09-25T21:08:55.945Z wip → testing (system)
- 2026-09-25T21:09:45.140Z testing → done (system)

