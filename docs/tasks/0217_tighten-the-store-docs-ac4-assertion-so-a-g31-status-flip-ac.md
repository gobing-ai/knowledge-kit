---
schema_version: 1
name: Tighten the store-docs AC4 assertion so a G31 status flip actually fails it
status: todo
template: feature-impl
created_at: 2026-10-07T20:52:26.659Z
updated_at: "2026-10-07T21:18:23.055Z"
feature_id: G

priority: P3
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 0.5
---

## 0217. Tighten the store-docs AC4 assertion so a G31 status flip actually fails it

### Background

Found by task 0213's third review pass (2026-10-07) and carried rather than re-looped, since it is a P3 on a test that already passed — recorded here so it is not lost.

`apps/cli/tests/store-docs.test.ts` is the executable evidence for AC4 ("architecture docs record the store decision", task 0210 R7). Its fourth case asserts that `docs/05_FEATURES.md`'s G31 row does not claim `done` while task 0213 is outstanding:

```ts
const statusCell = (row?.split('|')[3] ?? '').trim().toLowerCase();
expect(statusCell).not.toBe('done');
```

The comparison is against the bare string `done`, but `05_FEATURES.md` spells a completed row `✅ done` (see its other rows). So flipping G31's status cell to `✅ done` would still pass this assertion — the check does not bind on the very condition it exists to catch. The review confirmed it with a mutation probe.

The other three cases bind fully (ADR-030's shipped status, 03's Persistent-store paragraph, 04's verb list), and the same case still asserts the row mentions `0213` and `backlog`, so AC4's substance is covered — this is a weakened assertion, not a false one.

**Provenance:** this is a follow-up to **task 0213 / feature G31**, which are both `done` — the
assertion defect was found by 0213's third review pass and carried rather than re-looped (it is a P3
on a test that already passes). It is filed under the parent `G` because G31 is terminal and a live
task cannot stay linked to a finished feature; reopening a legitimately-completed feature to hold a
test tidy-up would misstate G31's status. No G31 behaviour is reopened by this task.

**Refine corrections (2026-10-07)**

- "The case guards G31 against claiming done *while 0213 is outstanding*" → 0213 is `done` (`spur task show 0213`) and G31 is `done` (`docs/features/G31_*.md` frontmatter `status: done`). The guarded condition has expired, yet `docs/05_FEATURES.md:98` still reads `⏳ active` with "`0213` … is still `backlog`" — the derived doc drifted and was never synced at 0213's close. → The test now **enforces the stale state**: its `toContain('0213')` + `toContain('backlog')` lines fail the moment anyone correctly syncs 05. Resolution: the task is re-scoped from "tighten the not-done check" to "re-bind the check to corpus truth, and sync the drifted row".
- R1 as filed (`expect(statusCell).not.toMatch(/done/)`) → would harden a now-false invariant and turn red on the correct 05 sync. Resolution: replace with a two-way agreement check against the G31 feature file's frontmatter status (Design).
- "the same case still asserts the row mentions `0213` and `backlog`, so AC4's substance is covered" → those two assertions are what pin the stale text; they are removed, not relied on.
- Verified fact kept: the bare-token comparison really is weak — `05_FEATURES.md:39` legend and every completed row spell it `✅ done`; the fix must be a substring match on the cell.

### Requirements

- [ ] R1. Case 4 of `apps/cli/tests/store-docs.test.ts` asserts that 05's G31 **status cell** says `done` (substring, case-insensitive — catches `✅ done`) **if and only if** the G31 feature file's frontmatter `status` is `done`. The stale `toContain('0213')` / `toContain('backlog')` assertions are removed.
- [ ] R2. `docs/05_FEATURES.md`'s G31 row is synced to corpus truth: status cell `✅ done`; notes cell records 0206/0208/0209/0210/0213 all done (no "NOT done", no "still `backlog`"); ADR-030 **shipped** and the satellite design link kept.
- [ ] R3. Mutation probe: temporarily set the G31 status cell back to `⏳ active` → case 4 goes red; restore → green. Probe output recorded in Testing.
- [ ] R4. The test header's failure-first item 4 is rewritten to state the agreement invariant and why it is a substring match bound to the feature file (not a bare-token compare, not a hard-coded task WBS), so the next editor does not relax it.
- [ ] R5. `bun test apps/cli/tests/store-docs.test.ts`, `bun run lint`, and `bun run test-pre-check` pass.

**Out of scope:** a generic 05-vs-corpus drift rule for all rows (file separately if wanted); re-pointing task 0210's AC4 evidence line numbers (`store-docs.test.ts:67-78`) — 0210 is `done` and its record is historical; the parent `G` row's status.

### Acceptance Criteria

```gherkin
Scenario: AC1 — The 05 G31 status cell must agree with the G31 feature status (req: R1, R4)
  Given apps/cli/tests/store-docs.test.ts case 4
  When the G31 row's status cell contains "done" (any spelling, e.g. "✅ done") and docs/features/G31_*.md status is not done, or vice versa
  Then the case fails; when both agree it passes

Scenario: AC2 — The 05 G31 row records G31 as done (req: R2)
  Given docs/05_FEATURES.md
  When the G31 row is read
  Then its status cell is "✅ done" and its notes no longer claim 0213 is backlog or G31 is NOT done

Scenario: AC3 — A mutation of the status cell turns the case red (req: R3)
  Given the G31 status cell is temporarily set to "⏳ active" while the feature file says done
  When bun test apps/cli/tests/store-docs.test.ts runs
  Then case 4 fails, and after restoring the row the file passes

Scenario: AC4 — Gates stay clean (req: R5)
  Given the change
  When bun test apps/cli/tests/store-docs.test.ts, bun run lint and bun run test-pre-check run
  Then all exit 0
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T21:17:01.748Z

- **Q: Keep "not done while 0213 outstanding", generalise it, or delete case 4?** Closed (refine 2026-10-07): generalise to a two-way agreement with the G31 feature file. Deleting would drop AC4 clause-4 evidence for 0210; keeping the 0213 wording enforces a condition that has expired. Agreement with the corpus is the invariant clause 4 was always protecting ("05 must not misstate G31").
- **Q: Read the status via `spur feature show G31 --json` or the file?** Closed: read the frontmatter of `docs/features/G31_*.md` with `readFileSync` — the sibling cases already read docs files directly, it is ~1ms, and spawning `spur` adds a load-sensitive subprocess (see task 0218). Reading the file is not a corpus write.
- **Q: Sync 05 here or in a separate doc task?** Closed: here. The test change and the row sync must land in one commit, or the tree is red in between.

### Design

**WHAT.** Re-bind store-docs case 4 to corpus truth and sync the drifted 05 row. No new API, no new files.

**WHERE.**
- `apps/cli/tests/store-docs.test.ts` — case `05_FEATURES does not record G31 done while 0213 is outstanding` (rename to `05_FEATURES records G31's status as the feature file does`); header failure-first item 4.
- `docs/05_FEATURES.md:98` — the G31 row.

**Algorithm (case 4).**
```ts
const featureFile = readdirSync(join(REPO, 'docs/features')).find((f) => f.startsWith('G31_'));
expect(featureFile).toBeDefined();
const featureStatus = read(`docs/features/${featureFile}`).match(/^status:\s*"?(\w+)"?/m)?.[1];
expect(featureStatus).toBeDefined();
const statusCell = (row?.split('|')[3] ?? '').trim().toLowerCase();
// substring, not equality: 05 spells a completed row `✅ done`
expect(statusCell.includes('done')).toBe(featureStatus === 'done');
```
Keep the existing comment that the notes cell legitimately contains "done" (so only the status cell is read). `readdirSync` joins the existing `node:fs` import.

**05 row text (frozen).** Status `✅ done`; notes: tasks `0206`, `0208`, `0209`, `0210` and `0213` (R14 confidence level) **done**; ADR-030 **shipped**; satellite `docs/design/kk-collect-and-daily-voice2.md`. Keep the existing column layout and the escaped `\|` style.

**Anti-patterns.** Do not hard-code `0213`/`backlog` or any WBS into the assertion. Do not compare the cell with `toBe`/equality. Do not assert on the whole row. Do not mutate the G31 feature file (corpus writes are CLI-gated; it is read-only here). Do not touch the other three cases.

**Concurrency.** No `wip` tasks; single worktree. Unrelated dirty files on `main` (publish-harness, publish plugins, `plugin-check.test.ts`) do not overlap — stage only the two target files.

### Plan

1. Sync `docs/05_FEATURES.md:98` G31 row to the frozen text (R2).
2. Rewrite case 4 per Design; rename the `it`; rewrite header failure-first item 4 (R1, R4).
3. `bun test apps/cli/tests/store-docs.test.ts` → green.
4. Mutation probe: set the cell to `⏳ active`, run the file → expect case 4 red; restore; re-run → green. Paste both outputs into Testing (R3).
5. `bun run lint` and `bun run test-pre-check` (R5).
6. Commit only the two files: `test(store-docs): bind the 05 G31 status check to the feature file; sync G31 row (task 0217)`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent feature `G` (kk workflows); provenance feature `G31` (done), tasks `0210` (AC4 / R7 clause 4), `0213` (done).
- `apps/cli/tests/store-docs.test.ts` case 4; `docs/05_FEATURES.md:39` (status legend), `:98` (G31 row); `docs/features/G31_*.md` frontmatter.
- Sibling: task `0218` (also a test-robustness follow-up; no file overlap).

### History

- 2026-10-07T21:18:23.055Z backlog → todo (system)

