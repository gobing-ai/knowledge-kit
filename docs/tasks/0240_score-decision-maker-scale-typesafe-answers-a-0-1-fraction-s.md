---
schema_version: 1
name: "Score-decision maker scale: typesafe answers a 0-1 fraction, so kk drops every non-integer level (kk-item-sensitivity stores nothing)"
status: done
template: issue
created_at: 2026-10-09T17:29:56.937Z
updated_at: "2026-10-09T18:41:55.158Z"
feature_id: G32

priority: P1
ac_altitude: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0240-verdict.json
---

## 0240. Score-decision maker scale: typesafe answers a 0-1 fraction, so kk drops every non-integer level (kk-item-sensitivity stores nothing)

### Background

> **Premise corrected by the 2026-10-09 refine. The title is misleading.** typesafe does **not** answer on a 0–1 fraction. Its `score` answer is a continuous position on the rubric's level axis `[0, L-1]`. kk drops the answer because the position is not an integer, not because the scale is wrong. Read the title as: "kk refuses non-integer level positions from typesafe, so `kk-item-sensitivity` stores nothing."

**Verified in spur 0.4.0** (`/Users/robin/node_modules/@gobing-ai/spur/spur.js`):

- The typesafe driver validates `bounded(answer.score, question.rubric.length - 1)` (`:551638`), so the score lives in `[0, rubric.length-1]`.
- The decision runner returns `value: answer.score` unchanged (`:560191`).
- The fm backend constrains its answer to an enum of integer level strings (`:559352`). That is why fm-style makers answer integers and typesafe answers positions such as `0.79`.
- Typesafe answers also carry `probabilities`/`legend`, but `spur decision run --json` exposes only `value`, `source`, `reason` and `confidence`.

**Observed evidence (probed 2026-10-09 on the G32 worktree, never the live store):**

- `spur decision run kk-item-sensitivity --maker typesafe` → `value 0.79`, `source model`. Other answers seen: `0.96` and `0.89`. All are positions between level 0 and level 1 of a 4-level rubric, which happen to lie below 1.
- `kk-item-china-politics` → `0`; an earlier answer was `0.01`, which means level 0 as well.
- kk's validator (`apps/cli/src/commands/store.ts:661-669`) keeps only `Number.isInteger(level) && 0 ≤ level < levels`. Any non-integer position is therefore refused.
- `makerRow` (`:717-754`) then falls back to the heuristic row (`'default'`) or to `null`. Nothing reports the refusal.
- The dogfood store held 0 `kk-item-sensitivity` model rows.
- `.spur/config.yaml:155-172` has no `kk-item-sensitivity` override, so the decision uses `decisions.maker: fm-local`, which errors (`source default`, `reason error`). Its comment cites "task 0236", the WBS that collided with this task.
- china-politics and audience already route to typesafe, so a non-integer china-politics answer is silently dropped today. The fail-closed gate then excludes that item from the pool.

**Scope:** accept level positions, make refusals visible, and route sensitivity to typesafe.

### Requirements

- [x] R1. **Accept level positions.** For a `score` decision, `decisionValue` (`apps/cli/src/commands/store.ts:661`) accepts any finite number in `[0, levels-1]` and stores `String(Math.round(score))` as `value`.
  - `raw_value` keeps the exact answer (already the case for model rows).
  - Out-of-range, non-finite and non-numeric answers are still refused.
  - `choice` decisions are unchanged.
  - Low-confidence answers stay non-current through the existing `min_confidence` gate (0.8, `packages/kk-store/src/dao/labels.ts`). No new threshold.
- [x] R2. **Make refusals visible.** Count refused model answers per `decision@maker` during a label pass, and add them to the printed verdict line as `refused: {"<decision>@<maker>": n}`. Print an empty object when there are none, so the shape is stable. The run report captures stdout, so it inherits the counts.
- [x] R3. **Route sensitivity to typesafe.** Add `kk-item-sensitivity: typesafe` under `decisions.makers` in `.spur/config.yaml`, and replace the comment that cites the collided "0236" with one sentence about this task.
- [x] R4. **State the contract** in `docs/04_DESIGN.md`: in the label row (`:99`) and the label surface (`:474`).
  - A `score` answer is a position on the rubric's level axis.
  - kk stores the nearest level in `value` and the exact answer in `raw_value`.
  - Answers outside `[0, levels-1]` are refused and counted under `refused`.

### Acceptance Criteria

- [x] AC1 — A stub maker answering `0.79` on a 4-level `score` decision yields a row with `value '1'` and `raw_value '0.79'`. `2.6` → `'3'`, `3.2` → refused, and the integers `0`–`3` are unchanged (req: R1).
- [x] AC2 — A refused answer increments `refused["<decision>@<maker>"]` in the label verdict line. A pass with no refusals prints `refused: {}` (req: R2).
- [x] AC3 — With `.spur/config.yaml` carrying `kk-item-sensitivity: typesafe`, a label pass on a scratch store copy writes `source='model'` sensitivity rows with integer `value`s (req: R3).
- [x] AC4 — `docs/04_DESIGN.md` states the score-position contract and the `refused` field (req: R4).

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-09T17:29:57.733Z

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-09 refine

- **Q: Is typesafe's score a 0–1 fraction?** No. spur 0.4.0 bounds it to `[0, rubric.length-1]` (`spur.js:551638`), so the old "fraction→level mapping rejected" design rested on a false premise. Redesigned to round-to-nearest-level, with `raw_value` keeping the exact answer.
- **Q: Keep the sensitivity gap documented, or close it?** Close it. With R1 in place typesafe answers are storable, so route sensitivity to typesafe (R3). The old R3 ("record the gap") is dropped.
- **Q: Does R2 depend on 0239?** No. 0239 does not edit `apps/cli/src/commands/store.ts`, so the old dependency note is removed.

### Design

**Round to the nearest level.** spur defines the score as a position on the level axis, so the nearest level is the answer the maker gave, at the resolution kk stores. `raw_value` keeps the exact number for audit and for any later calibration.

`items.ts:422,430` filter with `CAST(value AS INTEGER)`, so `value` must stay an integer string.

**Edit in `decisionValue`:**

```ts
const level = typeof raw === 'number' ? raw : Number(raw);
return Number.isFinite(level) && level >= 0 && level <= decision.levels - 1 ? String(Math.round(level)) : null;
```

**Ties.** `Math.round(0.5)` is 1, toward the more-severe level. That is acceptable: on china-politics, a higher level means "exclude", which fails closed.

**Refusal counter.** `labelItem` already returns per-item stats that the summary aggregates (`:1018-1029`).

- Return the refused `decision@maker` keys from `makerRow`'s caller, i.e. where `decisionValue` returns null for a `source='model'` answer.
- Merge them into a `Record<string, number>`.
- No new channel and no new log line.

**Rejected alternatives:**

- **Argmax over `probabilities`.** `spur decision run --json` does not expose them, and changing spur is out of scope.
- **Store the fractional `value`.** It breaks the `CAST(... AS INTEGER)` gates and the level semantics.
- **Treat the score as a 0–1 fraction (`round(f×(L-1))`).** The premise is false (spur `:551638`).
- **Keep refusing and only report.** typesafe would stay unusable for score decisions, and china-politics would keep dropping silently.

**Touches:**

- `apps/cli/src/commands/store.ts` (`decisionValue`, `labelItem`, the summary print);
- `apps/cli/tests/store-label.test.ts`;
- `.spur/config.yaml`;
- `docs/04_DESIGN.md`.

There is no dependency on 0239: no shared lines, and 0239 does not edit `store.ts`.

### Plan

1. Write the failing tests first in `apps/cli/tests/store-label.test.ts`, using a stub maker that answers `0.79` / `2.6` / `3.2` / `'x'` on a 4-level score decision. Assert the stored `value`/`raw_value`, and assert `refused` in the verdict line.
2. Change `decisionValue` to the round-to-nearest-level form. Thread the refused keys from the model-answer path into the summary.
3. Edit `.spur/config.yaml` (sensitivity → typesafe, fix the stale comment). Probe with `spur decision run kk-item-sensitivity --maker typesafe --json`.
4. Checkpoint-copy `.works/kk.db` to a scratch path, then run the **repo build** against it: `bun apps/cli/dist/index.js store label --db <copy> --run 0240-probe --new-ids <3 ids>`. Never use the live store, and never use the global 0.0.33 `kk`. Confirm the sensitivity model rows by SQL and record them in Testing.
5. Update `docs/04_DESIGN.md:99,474`. Run `bun run gate` and `spur task check 0240`.

### Root Cause

Verified. typesafe's `score` is a position in `[0, L-1]` (spur 0.4.0 `spur.js:551638` validates `bounded(answer.score, rubric.length - 1)`; `:560191` returns it as `value`). kk's `decisionValue` (`apps/cli/src/commands/store.ts:661-669`) accepts only integers in that range, so every non-integer position is refused. `makerRow` (`:717-754`) swallows the refusal into the heuristic or null row, and the label summary has no counter for it.

`kk-item-sensitivity` gets no model rows for two reasons:

- it has no typesafe override, so fm-local errors;
- even if it had one, typesafe answers non-integers.

The earlier "0–1 fraction" reading came from probe values that happened to be below 1.

### Solution

#### Change map

- `apps/cli/src/commands/store.ts:661-669`: `decisionValue` accepts finite numbers in `[0, levels-1]` and rounds to nearest integer string via `Math.round(level)` (R1, AC1).
- `apps/cli/src/commands/store.ts:748,846,1028`: `makerRow` invokes `onRefusal` callback when a model answer is refused; `labelItem` and `labelNewIds` aggregate counts per `decision@maker` into `refused` Record and serialize in verdict line (R2, AC2).
- `.spur/config.yaml:174`: added `kk-item-sensitivity: typesafe` and updated comment (R3, AC3).
- `docs/04_DESIGN.md:99,508`: updated CLI table row and detailed label surface text to document score position contract, rounding, and `refused` map (R4, AC4).
- `apps/cli/tests/store-label.test.ts`: added test suite covering AC1 and AC2.

### Testing

- `bun test apps/cli/tests/store-label.test.ts`: 24 pass, 0 fail (covers AC1 and AC2).
- Live decision probe: `spur decision run kk-item-sensitivity --param title=... --param source=... --json` returns `makerSource: "config-decision"`, `maker: "typesafe"`, `value: 0.79` (covers R3).
- Scratch DB dogfood: `bun apps/cli/dist/index.js store label --db scratch.db --run 0240-probe --new-ids ids.json --mode decision` writes model sensitivity rows with integer values `0`, `2`, `1` matching raw values `0.11`, `2.16`, `0.74` (covers AC3).
- `bun run gate`: clean (format, build, lint, typecheck, pre-check 51 rules, 2343 tests pass, post-check 2 rules).
- `spur task check 0240`: PASS (0 findings).

### Review

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P4 | correctness | typesafe score positions rounded to nearest level and refusals tracked | apps/cli/src/commands/store.ts | RESOLVED |

#### Review Report — 0240 (2026-10-09)

**Scope:** Score-decision maker scale: accept level positions on rubric axis, round to nearest level in value while preserving raw_value, report refused counts in label verdict line, route kk-item-sensitivity to typesafe in config.
**Verdict:** PASS
**Confidence:** HIGH

##### Per-requirement results

| Req | Verdict | Evidence |
|-----|---------|----------|
| R1 | MET | `apps/cli/src/commands/store.ts:667` rounds level positions to nearest integer string; tested in `apps/cli/tests/store-label.test.ts`. |
| R2 | MET | `apps/cli/src/commands/store.ts` tracks `refused: Record<string, number>` and serializes in label verdict line; tested in `apps/cli/tests/store-label.test.ts`. |
| R3 | MET | `.spur/config.yaml:174` sets `kk-item-sensitivity: typesafe`; tested live with probe and scratch DB pass. |
| R4 | MET | `docs/04_DESIGN.md:99,508` records score position contract and `refused` shape. |

##### Per-AC results

| AC | Verdict | Evidence |
|----|---------|----------|
| AC1 | MET | `apps/cli/tests/store-label.test.ts` asserts `0.79` -> `1` (raw `0.79`), `2.6` -> `3`, `3.2` -> refused. |
| AC2 | MET | `apps/cli/tests/store-label.test.ts` asserts `refused: {"kk-item-china-politics@typesafe": 1}` on refusal, `{}` when clean. |
| AC3 | MET | Scratch store dogfood run writes `source='model'` sensitivity rows with integer values `0`, `2`, `1`. |
| AC4 | MET | `docs/04_DESIGN.md:99,508` updated and verified. |

### References

- Found by: task 0230's live dogfood (its `## Review` finding 2 records the same probe with the
  `Number.isInteger` anchor) and the 0229 verification pass.
- Contract: `@gobing-ai/spur/schemas/decision-catalog.schema.json` (`$defs.scoreCriteria`, `$defs.decision`);
  `apps/cli/src/commands/store.ts:661-668` (`decisionValue`), `:717-753` (`makerRow`).
- Related: 0239 (R4 is the sibling failure — a migrated `NULL`-confidence row that can never be current),
  0241 (the incident record), `docs/tasks/0226_*.md` R5 (the enum/threshold split this must not disturb).

### History

- 2026-10-09T18:32:09.826Z todo → wip (system)
- 2026-10-09T18:41:54.691Z wip → testing (system)
- 2026-10-09T18:41:55.151Z testing → done (system)

