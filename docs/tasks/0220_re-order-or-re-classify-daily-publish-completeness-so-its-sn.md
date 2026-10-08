---
schema_version: 1
name: Re-order or re-classify daily publish-completeness so its snapshot reflects finished channels
status: done
template: feature-impl
created_at: 2026-10-07T22:09:50.052Z
updated_at: "2026-10-08T20:28:19.771Z"
feature_id: F61

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/run/0220-verdict.json
---

## 0220. Re-order or re-classify daily publish-completeness so its snapshot reflects finished channels

### Background

`<run_date>_17_publish_completeness.json` and its `WARNING: publish completeness — …` line (added 20261003) exist to make skipped independent channels visible: en/ja locales, XHS, WeChat, and the surfdash CMS re-sync. They are computed inside `daily-publish-classify` (`plugins/kk/scripts/kk-workflow-stages.ts:1146-1182`, helper `publishCompleteness` at `:1200`). In `kk-daily-ai-voice.yaml`, the `publish` state runs *before* the channels it judges: `publish → translate → patch-surfdash → run-report → done` (transitions at L895-951). On every successful `full` run, `locales` and `cms-resync` therefore read `not-run` and the warning fires falsely.

Evidence from the 20261007 dogfood (`.works/kk-daily-ai-voice/20261007/31-publish/`, file mtimes): the completeness json was written at 14:18:25. The `20_translate-localize_*` markers followed at 14:18:26-27, `24_translate-sync_sync-result.json` (ok:true) at 14:21:46, and the `23_patch-surfdash_emdash-resync.txt` marker at 14:21:46. The snapshot still says `locales=not-run, cms-resync=not-run` (XHS was legitimately missing at that point because of task 0219).

The same root cause affects the DAG workflow `kk-daily-ai-voice2.yaml`. Its locales do finish before `publish-classify` (dependsOn includes `translate-sync`, L587), but `kk daily publish-classify --fold-tail` (`apps/cli/src/commands/daily.ts:248-295`) writes the completeness json at L264-273 and only then runs the folded `daily-patch-surfdash` at L283-287. That makes `cms-resync` stale there too. `daily.ts:189-230` is also a verbatim copy of `publishCompleteness`, so the two would drift under any fix applied to only one.

A smaller accuracy gap: `locales` is `done` once both en/ja post-path markers are non-empty, which only means *scaffolded*. The run's real finish line for locales is `24_translate-sync_sync-result.json`.

### Requirements

- [x] R1. Contract (decided, see Q&A): completeness is a **terminal snapshot**, taken after every channel the run will attempt has run. It moves out of `daily-publish-classify` into a new stage verb `kk stage daily-publish-completeness <work_dir> <run_date>`. The verb writes the same `31-publish/<run_date>_17_publish_completeness.json` (same shape: `{runDate, rows[{channel,state,detail}], missing[]}`), prints the same `publish-completeness:` line and `WARNING: publish completeness — …` line to **stderr only**, and always exits 0. `daily-publish-classify` stops writing or warning about completeness and keeps its status/result outputs unchanged.
- [x] R2. `kk-daily-ai-voice.yaml`: the `run-report` state's onEnter runs `kk stage daily-publish-completeness "${vars.work_dir}" "${vars.run_date}"` as its first action, before `daily-run-report`. `run-report` is the join point both the `full` (after translate → patch-surfdash) and `partial` paths reach. Update the `publish` and `run-report` state descriptions to match.
- [x] R3. voice2: `kk daily publish-classify` (`apps/cli/src/commands/daily.ts`) deletes its local `publishCompleteness` copy. After the `--fold-tail` block, it calls `runStage(['daily-publish-completeness', workDir, runDate])` and reads `missing` back from the written json for its stdout status object (`{status, published, targets, missing}`, unchanged shape).
- [x] R4. `locales` is `done` only when both en/ja markers are filled **and** `24_translate-sync_sync-result.json` exists with `ok: true`. Markers filled + sync result `ok !== true` → `failed` (detail: the result's `error`, or `ok=false`). Markers filled + no sync result → `not-run` (detail `en/ja scaffolded, never synced`). No markers → `not-run` (today's detail). The xhs/wechat/cms-resync rows are unchanged.
- [x] R5. Docs in the same commit (T3): the completeness clause of the `docs/04_DESIGN.md:1031` row (new verb, terminal placement) and the "Publish completeness" paragraph in `docs/design/kk-daily-ai-voice.md` §4 (~L103-115), including the hand-driven-tail note: end the hand-driven chain with `kk stage daily-publish-completeness`.

### Acceptance Criteria

- [x] **AC1**. `kk stage daily-publish-completeness` on a fixture `31-publish/` with filled en/ja markers, `24_translate-sync_sync-result.json` `{ok:true}` and `23_patch-surfdash_sync-result.json` `{ok:true}` records `locales=done` and `cms-resync=done`. Removing the sync results flips locales to `not-run` ("never synced") and cms-resync to `not-run`, and stderr carries the `WARNING: publish completeness` line naming them. A `{ok:false,error:"x"}` sync result gives `locales=failed` with detail `x`.
- [x] **AC2**. `daily-publish-classify` no longer writes `_17_publish_completeness.json` and prints no completeness line. The existing full/partial/none classification tests stay green unchanged.
- [x] **AC3**. The three existing completeness tests (`apps/cli/tests/kk-workflow-stages.test.ts:585-683`) are retargeted at `daily-publish-completeness` with identical expectations, except that the "nothing missing" fixture also seeds the 24_ sync result (R4). The stage exits 0 in every case, including "everything missing".
- [x] **AC4**. `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts` pins the new call line in its delegated-call list (~L292-318) and asserts that, inside the `run-report` state block, `daily-publish-completeness` precedes `daily-run-report`.
- [x] **AC5**. `apps/cli/tests/voice2-dag.test.ts` "publish-classify classifies partial and folds the tail" (L670) still passes. A new case with a seeded `23_patch-surfdash_sync-result.json` `{ok:true}` shows `cms-resync` absent from the stdout `missing`, proving the snapshot is taken after the fold-tail patch. stdout stays a single JSON line.
- [x] **AC6**. `bun run lint` and `bun run test` pass.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-08T05:38:08.699Z

- **Q: Move the snapshot late, or keep the early one and add a second terminal classification (original R1 options)?** Decided: **move it** (single terminal snapshot). Two snapshots mean two files or one overwritten file, and two warnings, one of them known-false on every full run. The early snapshot has no consumer: nothing reads the json except humans and the voice2 stdout line.
- **Q: Which terminal state hosts it?** Decided: `run-report` (first onEnter action). It is the only state both `full` and `partial` reach, and it runs after `translate` and `patch-surfdash` on the full path. A new dedicated state was rejected: it would add an extra node and two transitions for a single shell call. Folding the logic into `dailyRunReport` was also rejected, because run-report is "output-only, never throws" with its own contract, and a separate verb stays independently runnable by hand-driven tails.
- **Q: What about the `none` path?** No snapshot, by design. `publish → failed` is a failed run, and the channel gaps are moot. Previously classify wrote it on `none` too; this behavior change is intentional and should be noted in the design doc.
- **Q: Partial runs warn about locales/cms-resync — false positive?** No. On `partial`, translate and patch-surfdash genuinely never run (the `publish → translate` guard is full-only), so `not-run` is the truth, and the operator already gets the partial warning. No special-casing.
- **Q: Fix voice2 in this task?** Yes. It is the same root cause (snapshot before the folded patch). Deduping onto the stage verb is a net deletion and prevents the two copies from drifting under R4.
- **Q: Tighten `locales` to require the sync result (R4)?** Yes, because "reflects finished channels" is the task's goal and scaffold-only is not finished. The 20261007 run shows the sync result is reliably written (`ok:true`). `dailyTranslateSync` skips without a result only when the zh post path is empty, in which case locales was never published, so `not-run` is correct.

### Design

- **New verb.** In `kk-workflow-stages.ts`, add `function dailyPublishCompleteness(args)`: `[workDir, runDate]`, wrapped in `timed(workDir, 'publish-completeness', …)`. Move the completeness tail of `dailyPublishClassify` (L1165-1181) into it verbatim, then delete it from classify. Register it with `case 'daily-publish-completeness':` next to `'daily-publish-classify'` (~L1671). It must only use `console.error`, because `runStage` forwards child stdout to the voice2 command's stdout, which must stay one JSON line.
- **`publishCompleteness` (L1200) locales row** per R4. Add `24_translate-sync_sync-result.json`, read with the same `isFile`/`readJson` pattern the result channels use. Keep the row order `locales, xhs, wechat, cms-resync`.
- **v1 YAML** (`plugins/kk/workflows/kk-daily-ai-voice.yaml`): `run-report.onEnter` becomes `[shell: kk stage daily-publish-completeness …, shell: kk stage daily-run-report …]`. Update the `publish` state description (drop completeness) and the `run-report` description (add the terminal completeness snapshot). No transition changes.
- **voice2** (`apps/cli/src/commands/daily.ts`): delete `publishCompleteness` (L182-230) and its now-unused imports. In `publishClassifyAction`, move the `consoleOutput.write(...)` status line and the warning to after the fold-tail block, replacing them with: `runStage(['daily-publish-completeness', workDir, runDate])`, then read `missing` from `_17_publish_completeness.json` (default `[]` if absent), then `consoleOutput.write(JSON.stringify({ status, published, targets, missing }))`. The stage now owns the warning, so the command does not print its own. If fold-tail fails, `failLoud` fires first, as it does today, and no status line is printed. The status file is already written at that point, and the workflow node fails either way.
- **Invariants.** Completeness never changes routing or exit codes (it always exits 0). The json shape is unchanged. Classify's outputs (`_17_publish_result.json`, `_17_publish_publish-status.txt`) are unchanged.
- **Impacted surfaces.** `plugins/kk/scripts/kk-workflow-stages.ts`, `plugins/kk/workflows/kk-daily-ai-voice.yaml`, `apps/cli/src/commands/daily.ts`, `docs/04_DESIGN.md:1031`, `docs/design/kk-daily-ai-voice.md` §4, and the tests in AC. `kk-daily-ai-voice2.yaml` itself needs no edit.

### Plan

1. Tests first: retarget the completeness `describe` (`apps/cli/tests/kk-workflow-stages.test.ts:585`) to `daily-publish-completeness`. Add the R4 sync-result cases (AC1) and the "classify writes no completeness" assertion (AC2). Add the run-report ordering and call-line pins to `kk-daily-ai-voice-workflow.test.ts` (AC4) and the voice2 fold-tail case to `voice2-dag.test.ts` (AC5). Confirm they fail.
2. `kk-workflow-stages.ts`: add `dailyPublishCompleteness` and its dispatch case, strip completeness from `dailyPublishClassify`, and apply R4 in `publishCompleteness`.
3. `kk-daily-ai-voice.yaml`: insert the run-report onEnter action and update the two state descriptions.
4. `apps/cli/src/commands/daily.ts`: delete the local copy, then reorder to fold-tail → `runStage` completeness → status line.
5. Docs: `docs/04_DESIGN.md:1031` completeness clause and design §4 paragraph (terminal snapshot, `none` path, hand-tail instruction).
6. `bun run lint && bun run test`, then `git diff --stat` to confirm only the files listed above changed.

### Solution

- `plugins/kk/scripts/kk-workflow-stages.ts:1146-1260`:
  - Removed completeness writing and warning from `dailyPublishClassify` (0220 R1).
  - Added new `dailyPublishCompleteness` verb and registered `case 'daily-publish-completeness'` (0220 R1).
  - Updated `publishCompleteness` helper: `locales` is `done` only when both en/ja markers are filled AND `24_translate-sync_sync-result.json` exists with `ok: true`; non-ok sync result sets state `failed` with error detail; missing sync result sets `not-run` with detail `en/ja scaffolded, never synced` (0220 R4).
- `apps/cli/src/commands/daily.ts:180-280`:
  - Removed duplicate `publishCompleteness` function (0220 R3).
  - In `publishClassifyAction`, moved completeness snapshot after `foldTail` block, invoking `runStage(['daily-publish-completeness', workDir, runDate])` and reading `missing` from the written JSON (0220 R3).
- `plugins/kk/workflows/kk-daily-ai-voice.yaml:520-535`:
  - Added `kk stage daily-publish-completeness "${vars.work_dir}" "${vars.run_date}"` to `run-report` onEnter before `daily-run-report` (0220 R2).
- `apps/cli/tests/kk-workflow-stages.test.ts:585-690`:
  - Retargeted completeness tests to `daily-publish-completeness`, added sync-result test cases (AC1), and added test asserting `daily-publish-classify` writes no completeness (AC2).
- `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:235-325`:
  - Pinned 31 daily stages, included `daily-publish-completeness`, and verified run-report execution order (AC4).
- `apps/cli/tests/voice2-dag.test.ts:710-745`:
  - Added test asserting fold-tail reflects cms-resync in terminal completeness with single-line stdout (AC5).
- `docs/04_DESIGN.md:1031` & `docs/design/kk-daily-ai-voice.md:103-118`:
  - Updated design docs and hand-driven tail instructions with `daily-publish-completeness` (0220 R5).

### Testing

- Focused tests passed:
  - `bun test apps/cli/tests/kk-workflow-stages.test.ts apps/cli/tests/kk-daily-ai-voice-workflow.test.ts apps/cli/tests/voice2-dag.test.ts apps/cli/tests/commands/daily.test.ts` (142 passed, 0 failed).
- Gate passed:
  - `bun run lint` (Biome 2.5.5 clean, TypeScript typecheck clean across all 30 workspaces).
  - `bun run build` (all workspaces clean).
  - `bun run test` (2191 tests passed, 0 failed, 2 pre-existing skipped; funcs 98.63%, lines 98.26%).

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | correctness | plugins/kk/scripts/kk-workflow-stages.ts:1210 | Locales status now verified against 24_ translate-sync result |
| P4 | architecture | apps/cli/src/commands/daily.ts:240 | Deduped publishCompleteness onto shared stage verb |

### References

- Feature F61; completeness introduced 20261003 (`docs/design/kk-daily-ai-voice.md` §4 "Publish completeness"); ADR-022/025/026 (independent non-blocking channels).
- Code: `plugins/kk/scripts/kk-workflow-stages.ts:1146` (dailyPublishClassify), `:1200` (publishCompleteness); `apps/cli/src/commands/daily.ts:189` (duplicate), `:248` (publishClassifyAction); `apps/cli/src/stage.ts:81` (runStage forwards stdout).
- Evidence: `.works/kk-daily-ai-voice/20261007/31-publish/` mtimes.
- Sibling: task 0219 (same dogfood; the XHS gap in that snapshot was real).

### History

- 2026-10-08T05:38:20.734Z backlog → todo (system)
- 2026-10-08T20:28:19.748Z todo → done (system)

