---
schema_version: 1
name: "Score-decision maker scale: typesafe answers a 0-1 fraction, so kk drops every non-integer level (kk-item-sensitivity stores nothing)"
status: todo
template: issue
created_at: 2026-10-09T17:29:56.937Z
updated_at: "2026-10-09T17:39:58.771Z"
feature_id: G32

priority: P1
ac_altitude: task-local
---

## 0240. Score-decision maker scale: typesafe answers a 0-1 fraction, so kk drops every non-integer level (kk-item-sensitivity stores nothing)

### Background

A `score` decision's answer is a level index into its rubric, but the maker configured for the judgment
decisions answers on a 0–1 fraction, and `kk` rejects those answers silently — the observation is never
written, so the decision looks unlabelled rather than mis-answered.

**Verified evidence** (probed 2026-10-09, during the G32 batch's dogfood; the batch worktree, never the
operator's live store):

- `spur decision run kk-item-sensitivity --param title=… --param source=aihot --maker typesafe --json` →
  `{"value":0.79,"source":"model","reason":"accepted"}` — the maker answers, `spur` accepts, and the value is
  a fraction.
- The same probe for `kk-item-china-politics` → `{"value":0,"source":"model","reason":"accepted"}` (an
  integer, which is why the china-politics pool works), and for `kk-item-audience` → `{"value":"general"…}`.
- `kk`'s validator (`apps/cli/src/commands/store.ts:661-668`) keeps a `score` answer only when
  `Number.isInteger(level) && level >= 0 && level < levels`, so `0.79` is rejected; `makerRow` then falls
  through to `null` when the decision has no heuristic annotation (`apps/cli/src/commands/store.ts:717-753`),
  so the raw answer is dropped as well.
- Measured consequence in the dogfood store: **0** `kk-item-sensitivity` rows from `typesafe` versus 13
  `source='default'`/`reason='error'` rows from `fm-local` — i.e. the sensitivity surface is effectively
  unlabelled, and nothing in the label pass's output or the run report names the decision or the maker.
- The maker matrix for the three judgment decisions (one live consult each, same day): `fm-local` →
  `source='default'`, `reason='error'`; `laya-local` → `no-backend`; `typesafe` → `source='model'`, integers
  for china-politics/audience and fractions for sensitivity. `.spur/config.yaml:166-167` therefore points
  china-politics and audience at `typesafe`.

**Why this is a contract defect and not a `kk` bug.** spur's catalog schema defines a `score` decision's
`criteria` as an ordered rubric (`$defs.scoreCriteria`: an array of ≥2 Jev entries — the level descriptions),
so the answer is an index into that rubric, exactly what `kk` requires. `kk`'s refuse-never-coerce behaviour
is 0226's documented intent. What is missing is a stated contract, a check when a maker is wired to a `score`
decision, and any visible signal when an answer is refused.

**Out of scope here:** changing `kk`'s integer rule, and any fraction→level mapping (see the Design section
for why it is rejected). The sensitivity gap itself is recorded by R3, not closed.

### Requirements

- [ ] R1. State and enforce the `score` contract: a `score` decision's answer is an integer level index into
  its rubric. Record it where the catalog and the maker configuration are read (`plugins/kk/decisions/kk-items.yaml`,
  the `store.labels.decisions.*.priority` documentation in `docs/04_DESIGN.md`), and make a maker that cannot
  answer integer levels for a `score` decision detectable before it is wired in — either by a check over a
  recorded probe or by a runtime signal that names the maker and the decision on the first refusal.
- [ ] R2. Make a refused answer loud. When `decisionValue` rejects a `score` answer
  (`apps/cli/src/commands/store.ts:661-668`) the label pass's printed report and the run report must name the
  decision id, the maker and the count of rejected answers, so an unlabelled decision is visible instead of
  looking like a decision nobody asked about.
- [ ] R3. Record the sensitivity gap explicitly: no configured maker answers integer levels for
  `kk-item-sensitivity` (fm-local errors, laya-local has no backend, typesafe answers a 0–1 fraction), so its
  observations stay absent. State that in the catalog's `kk-item-sensitivity` entry or in
  `docs/04_DESIGN.md`'s label-decision section, and keep `.spur/config.yaml` free of an override that implies
  otherwise (it currently has none — preserve that).

### Acceptance Criteria

- [ ] AC1 — A maker that answers `score` decisions fractionally is detected before it is wired to one, or its first refusal is reported with the decision id and the maker named (req: R1).
- [ ] AC2 — A refused `score` answer appears in the label pass's output and in the run report with its decision, maker and count (req: R2).
- [ ] AC3 — The `kk-item-sensitivity` gap is recorded in the catalog or the design doc, so an empty sensitivity surface is documented rather than silent (req: R3).

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-09T17:29:57.733Z

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

**Chosen approach — make the contract explicit and the failure visible; do not reinterpret the answer.**

1. **Contract (R1).** The rubric is ordered, so the answer is a level index. Write that down next to the
   catalog entries and in the design doc's label-decision section, then add the cheapest possible detector:
   a named probe (the same one this task used) recorded per maker per `score` decision, so a
   fraction-answering maker is found when it is configured rather than when a pool comes back empty. A
   runtime-first-refusal signal is the fallback if a probe cannot be automated — either satisfies AC1.
2. **Visibility (R2).** Extend the existing report rather than adding a channel: the label pass already
   prints `{labeled, model, fallback, consults, consultMs}`; add the refused-answer count keyed by
   `(decision, maker)` and emit the same line into `.spur/run/<wbs>-report.txt` so the run report carries it.
   This closes the observability half of the finding the 0230 review also raised.
3. **Record the gap (R3).** One sentence on the `kk-item-sensitivity` entry (or the design doc's table) that
   names the three makers and their failure modes. Do not add a `.spur/config.yaml` override for it: no
   override is the honest state, and the comment already explains why none exists.

**Rejected — map a 0–1 fraction onto the rubric's levels** (e.g. `round(fraction × (levels - 1))`). It would
make `typesafe` usable everywhere by inventing semantics the rubric never defines: on a four-level
china-politics rubric `0.79` would become level 2, i.e. "commentary or analysis of the political system" —
a moderation-relevant claim the maker never made. It would also change stored levels for existing rows and
put the mapping in the wrong layer (the maker's scale is a maker property, not a `kk` one). Rejected unless
a product decision defines what the fraction means and a rubric-independent mapping is required.

**Rejected — relax `Number.isInteger`.** Same objection plus it would let a genuine out-of-range answer
through, which is the guard 0226 deliberately added.

**Dependency note.** R2's report change touches the same file as 0239's R3 (the exclusion vocabulary) and
0229's `LABEL_DECISIONS` table; land it after those or rebase onto them.

### Plan

1. Add the refused-answer counter to the label pass and print it with the existing counters; assert it in
   `apps/cli/tests/store-label.test.ts` with a stub that answers a fraction (the AC1/AC2 fixtures already
   exist for the raw-capture cases).
2. Write the `score` contract into the catalog header and the design doc's label-decision section, and record
   the `kk-item-sensitivity` gap (R3).
3. Add the maker-scale detector — a recorded per-maker probe for the three judgment decisions, or the
   first-refusal signal from step 1 if a probe is not automatable; whichever is chosen, name it in the task's
   Testing section.
4. Run `bun run gate`; confirm `.spur/config.yaml` still has no sensitivity override.

### Root Cause

Verified, not inferred: `kk` requires an integer level for a `score` decision
(`apps/cli/src/commands/store.ts:661-668`), matching spur's ordered-rubric contract
(`@gobing-ai/spur/schemas/decision-catalog.schema.json`, `$defs.scoreCriteria`); the maker configured for the
judgment decisions answers `kk-item-sensitivity` on a 0–1 fraction
(`spur decision run kk-item-sensitivity --maker typesafe` → `value 0.79`, `source model`, `reason accepted`);
and the refused answer leaves no row at all because `makerRow` returns `null` for a decision with no
heuristic annotation (`apps/cli/src/commands/store.ts:717-753`). The 0-versus-13 row counts in the dogfood
store confirm the end state: the decision is unlabelled, not mislabelled.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Found by: task 0230's live dogfood (its `## Review` finding 2 records the same probe with the
  `Number.isInteger` anchor) and the 0229 verification pass.
- Contract: `@gobing-ai/spur/schemas/decision-catalog.schema.json` (`$defs.scoreCriteria`, `$defs.decision`);
  `apps/cli/src/commands/store.ts:661-668` (`decisionValue`), `:717-753` (`makerRow`).
- Related: 0239 (R4 is the sibling failure — a migrated `NULL`-confidence row that can never be current),
  0241 (the incident record), `docs/tasks/0226_*.md` R5 (the enum/threshold split this must not disturb).

### History
