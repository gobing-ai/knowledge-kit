---
schema_version: 1
name: Place daily-publish-partial's warning artifact by run identity, not by process cwd
status: todo
template: feature-impl
created_at: 2026-10-12T20:56:07.634Z
updated_at: "2026-10-12T21:56:57.654Z"
feature_id: G1

priority: P2
ac_altitude: task-local
estimate_hours: 1
---

## 0264. Place daily-publish-partial's warning artifact by run identity, not by process cwd

### Background

`dailyPublishPartial` (`plugins/kk/scripts/kk-workflow-stages.ts:1326`) writes its advisory warning artifact to a **cwd-relative** path — `.spur/run/publish-partial-<runDate>.txt` at `:1337-1342` — while its sibling result path at `:1328` resolves under the stage's `workDir`. The artifact therefore lands wherever the process happened to run. Observed during the G14 batch (2026-10-12): `apps/cli/tests/kk-workflow-stages.test.ts:2282-2302` spawns the stage runner with no `cwd` (the `run` helper at `:46-54` inherits the test process cwd, `apps/cli` under the workspace runner) and reads/deletes `.spur/run/publish-partial-20260101.txt` relative to that cwd — so the existing test both encodes the bug and is what littered `apps/cli/.spur/run/`.

Nothing parses the file — the writer, the workflow state (`.spur/workflows/kk-daily-ai-voice.yaml:532-538` and its packaged copy `plugins/kk/workflows/kk-daily-ai-voice.yaml:532-538`) and `kk daily publish-classify --fold-tail` (`apps/cli/src/commands/daily.ts:329`) only invoke the stage — so the artifact is a human-facing note pointing at `kk executor fan-out --retry-from`; but an artifact whose location depends on the caller's cwd is not a usable run record, and it litters whatever tree the caller stood in.

**Refine corrections (2026-10-12)**
- Line refs `:1327` / `:1329` / `:1337-1341` → verified `:1326` (function) / `:1328` (result path) / `:1337-1342` (mkdir + write) at bd537df5.
- "A test invoking the stage with cwd=`apps/cli`" (unnamed) → it is `kk-workflow-stages.test.ts:2282` ("daily-publish-partial names the failed targets and preserves the retry file"), which asserts the cwd-relative location → that test must be rewritten, not merely joined by a new one.
- "Prefer reusing the existing `timed` / `sted` helpers" → the stage already wraps both writes in `sted` inside `timed` (`:1330`, `:1337-1338`) → keep those wrappers; only the paths change.
- Unlisted second asserting test: `apps/cli/tests/commands/daily.test.ts:338` expects `join(dir, '.spur/run/publish-partial-20261007.txt')` with cwd = `dir` = `--work-dir` → it keeps passing under the workDir convention unchanged; its `inCwd` comment (`:47-51`) names this stage's cwd write and gets a one-line update.
- Sibling scan: no other `plugins/kk/scripts` or `apps/cli/src` code writes a cwd-relative `.spur/run/` path (`rg "['\"\`]\.spur/run"`), so the fix is local to this stage.

### Requirements

- [ ] R1. Write the artifact at `join(workDir, '.spur', 'run', `publish-partial-${runDate}.txt`)` (mkdir its directory the same way), with a one-line comment stating that the marker lives with the run's `workDir`, not the process cwd. No cwd-relative write remains in the stage.
- [ ] R2. Preserve the artifact's name, body and advisory semantics: the stage still warns on stderr with `WARNING: partial publish — failed targets: <list>`, still exits 0, and the body is byte-identical (still names `kk executor fan-out --retry-from`).
- [ ] R3. Rewrite the existing stage test so it runs the stage with a cwd outside the repository and the `workDir`, and asserts the artifact at `<workDir>/.spur/run/` and no `.spur/` in the process cwd.

Out of scope: adding a new stage argument or execution-root resolver; changing the workflow YAMLs (both copies) or `daily.ts`; the behaviour for an empty `workDir` (`join('', …)` stays cwd-relative exactly like the result path at `:1328`; the workflow and `daily.ts` always pass a `work_dir`); the `.spur/runs/<workflow>/work-dir.txt` anchor in `daily.ts`.

### Acceptance Criteria

- [ ] AC1 — Invoking the stage with cwd set to a non-repository directory creates no `.spur/` in that cwd and writes the artifact at `<workDir>/.spur/run/publish-partial-<runDate>.txt`. (req: R1, R3)
- [ ] AC2 — The warning body is unchanged, including the `--retry-from` pointer, and the stage still exits 0. (req: R2)
- [ ] AC3 — The rewritten test fails against the pre-change stage and passes after it (falsification, no `.skip`, no relaxed assertion). (req: R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-12T21:56:52.678Z

- **workDir vs an explicit execution root?** Closed: `workDir`. The stage receives only `<workDir> <runDate>`; an execution root would add a new argv contract across two workflow copies and `daily.ts` for an advisory note. Evidence stays with the episode. Revisit only if an operator tool needs one repo-wide index of partial-publish markers.
- **Empty `workDir`?** Closed: out of scope — the path degrades to cwd-relative exactly like the existing result path; every caller passes a `work_dir`.
- **New test or rewrite?** Closed: rewrite the existing test in place — it is the one that encodes and causes the bug; a parallel test would leave the littering assertion behind.

### Design

**Decision (frozen): the marker lives under the run's `workDir`** — `join(workDir, '.spur', 'run', `publish-partial-${runDate}.txt`)`.

**WHY.** The stage's argv is `<workDir> <runDate>` only (`kk-daily-ai-voice.yaml:538`, `daily.ts:329`). An "explicit execution root" would need a new argument threaded through both workflow copies, `daily.ts` and their tests — a wider, cross-file contract change for an advisory note. Under `workDir` the evidence stays with the episode it describes (beside `31-publish/…`) and is collected with the rest of the run's artifacts. `daily.test.ts:338` already expects exactly this path because it sets cwd = workDir.

**WHERE.**
- `plugins/kk/scripts/kk-workflow-stages.ts` `dailyPublishPartial` (`:1326-1345`): compute `const marker = join(workDir, '.spur', 'run', `publish-partial-${runDate}.txt`);` once; `sted('mkdir', dirname(marker), () => mkdirSync(dirname(marker), { recursive: true }))`; `sted('write', marker, () => writeFileSync(marker, <unchanged body>))`. Add the one-line WHY comment. `join` and `dirname` are already imported (`:58`). No new API, no new helper.
- `apps/cli/tests/kk-workflow-stages.test.ts:2282-2302`: rewrite in place — create a second temp dir as the process cwd, spawn the runner with `cwd` set to it (extend `run` with an optional `cwd` option, or call `spawnSync` directly in this test; prefer the smaller diff), assert `readFileSync(join(dir, '.spur/run', …))` contains `failed targets: podcast-pub` and `--retry-from`, and `existsSync(join(cwdDir, '.spur'))` is false. Drop the `rmSync` of the cwd-relative path (the temp dirs own cleanup).
- `apps/cli/tests/commands/daily.test.ts:47-51`: update the comment — the stage no longer writes cwd-relative; `inCwd` is still needed for the `.spur/runs/<workflow>/work-dir.txt` anchor.

**Anti-patterns.** Do not resolve the root via `process.cwd()`, `git rev-parse` or `import.meta.dir`; do not add an env var or CLI flag; do not change the body text or exit code; do not edit the workflow YAMLs (their "write a .spur/run marker" description stays accurate); do not keep the old test's cwd-relative read alongside the new one.

**Dependencies / handoffs.** None. Concurrency: the working tree currently has unrelated uncommitted edits (`apps/cli/src/commands/schedule.ts`, `plugins/kk/schedules/*`, `docs/04_DESIGN.md`, …) — none touch these three files; stage only the files above.

**Budget.** ~1 h.

### Plan

- [ ] R3 (red first): rewrite `kk-workflow-stages.test.ts:2282` per Design; run `bun test apps/cli/tests/kk-workflow-stages.test.ts -t 'daily-publish-partial'` against the unchanged stage and record the failure (artifact absent under workDir / `.spur` created in the cwd dir). Judge by pass/fail counts — a single-file run exits 1 on coverage.
- [ ] R1: change the marker path in `dailyPublishPartial` to `<workDir>/.spur/run/…`, with the one-line comment.
- [ ] R2: confirm the body string is byte-identical (diff shows only path lines changed); rerun the targeted test → pass.
- [ ] Run `bun test apps/cli/tests/commands/daily.test.ts` (the fold-tail partial case at `:315` must still pass) and update its `inCwd` comment.
- [ ] Verify no litter: `git status --short apps/cli` shows no `.spur/run/`.
- [ ] Gate: `bun run lint` and `bun run test`; record outputs in `## Testing`. Commit as `fix(kk): place the publish-partial marker under the run's work dir`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-12T21:56:57.654Z backlog → todo (system)

