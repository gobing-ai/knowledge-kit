---
schema_version: 1
name: Extract a neutral publish core from itc-publish, itc-plan and publish-matrix
status: done
template: feature-impl
created_at: 2026-11-13T17:31:13.967Z
updated_at: "2026-11-15T04:01:16.938Z"
feature_id: G61

ac_altitude: task-local
ac_numbering: task-local
priority: P1
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0361-verdict.json
---

## 0361. Extract a neutral publish core from itc-publish, itc-plan and publish-matrix

### Background

Phase 1 of feature G61 (ADR-053 decision 1). The daily news publish matrix depends on ITC-named modules for
code that is not ITC-specific. `apps/cli/src/publish-matrix.ts` imports exactly:

- `resolveItcConfigPath` from `./itc-config`
- `loadPublishPreset`, `PublishPreset`, `PublishPresetTarget`, `PublishWindow`, `PublishWindowSchema` from `./itc-plan`
- `ItcReceipt`, `probePlugin`, `SendRow`, `sendRows` from `./itc-publish`

`sendRows` (`apps/cli/src/itc-publish.ts:515-790`) was already extracted from `itcSendTargets` as a neutral
loop (task 0321 R6); it simply lives in the wrong file. This task moves the shared symbols into one neutral
module so later phases can build `kk article|news publish-*` on it. It is a **pure move**: no behaviour, wire
format, schema, or test assertion changes.

Out of scope: unifying ITC's `publish-plan.json` with the matrix `plan.<window>.json` (Phase 3), any CLI
surface, any rename of wire keys.

### Requirements

- [x] R1. New file `apps/cli/src/publish-core.ts` holds, moved verbatim (bodies unchanged): from `itc-publish.ts` — `ItcDeliveryMetadataSchema` (L20), `ItcReceiptSchema` (L29), `ItcReceipt` (L60), `PluginProbeResult` (L340), `probePlugin` (L352), `SendRow` (L456), `SendRowsOutcome` (L471), `SendRowsOptions` (L480), `sendRows` (L515-790) and any non-exported helper used only by them; from `itc-plan.ts` — `PublishWindowSchema`/`PublishWindow` (L33), `PublishPresetTargetSchema`/`PublishPresetTarget` (L44-60), `PublishPresetSchema`/`PublishPreset` (L66-75), `resolveDefaultPackageRoot` (L159), `resolvePresetFromRoots` (L212), `readPresetFile` (L238), `loadPublishPreset` (L379).
- [x] R2. In `publish-core.ts` the receipt symbols are exported under neutral names — `DeliveryMetadataSchema`, `ReceiptSchema`, `Receipt` — and `itc-publish.ts` re-exports them under the old names (`export { ReceiptSchema as ItcReceiptSchema, … }`, `export type { Receipt as ItcReceipt }`). `itc-publish.ts` and `itc-plan.ts` re-export every other moved symbol under its unchanged name, so no file under `apps/cli/tests/` needs an import change.
- [x] R3. `apps/cli/src/publish-matrix.ts` imports the moved symbols from `./publish-core` and the config path from `resolveKkConfigPath` in `./invoke` (`apps/cli/src/invoke.ts:52`) if it is behaviour-equivalent to `resolveItcConfigPath` (`itc-config.ts:207`) for every `(env, homeDir)` input; if not, `resolveItcConfigPath` moves to `publish-core.ts` as `resolveConfigPath` with a re-export. State which in Solution.
- [x] R4. `publish-core.ts` imports nothing from any `./itc-*` file. ITC-only functions stay where they are (`itcMaterializePlan`, `itcCheckTargets`, `itcSendTargets`, `itcReconcileReceipts`, `itcExportSeo`, `itcReportSummary`, `itcAuthorVerdict`, `resolveItcTargets`, `buildItcPublishPlan`).
- [x] R5. Wire formats are byte-stable: the receipt key `metadata.itcDelivery`, every JSON file name, every error code string and every log event name is unchanged.
- [x] R6. `plugins/kk/config.example.yaml:14` no longer claims "`live` is never in a preset"; it states that a preset target may carry `mode: live` (ADR-022 amendment 2026-11-12). `.spur/context/anatomy.md` gains the one-line entry for `publish-core.ts` through the project's usual refresh.

### Acceptance Criteria

```gherkin
Scenario: AC1 — The news publish path imports no ITC-named module (req: R1, R2, R3, R4, R5, R6)
  Given the change is applied
  When `rg -n "from '\./itc-" apps/cli/src/publish-matrix.ts apps/cli/src/publish-core.ts` runs
  Then it prints nothing
  And `git diff --stat -- apps/cli/tests` shows no change to any existing assertion (new files only, if any)
  And `bun test apps/cli/tests/publish-matrix*.test.ts apps/cli/tests/itc-*.test.ts apps/cli/tests/fanout*.test.ts apps/cli/tests/kk-daily-publish3*.test.ts apps/cli/tests/kk-itc-*.test.ts apps/cli/tests/voice3-*.test.ts` reports 0 fail
  And `rg -n 'itcDelivery' apps/cli/src | wc -l` equals the count on the parent commit
  And `bun run lint && bun run test && bun run build` exit 0
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-13T17:47:38.771Z

- **A file, not the `publish-core/` directory ADR-053 names?** One file now; it becomes a directory when Phase 2 adds plan/settle modules. Importers write `./publish-core` either way.
- **Why keep `metadata.itcDelivery`?** It is persisted in receipts and read by settle, repair and the Board; renaming is a schema change with no user benefit. Only TypeScript identifiers get neutral names.
- **Why re-exports instead of updating tests?** The existing suites are the proof that the move changed nothing; editing them in the same change would remove that proof.
- **New unit tests?** None. The move is covered by the existing suites; the only new check is the import `rg` in AC1.
- **Is `publish-plan.json` (ITC) merged with `plan.<window>.json` (matrix) here?** No — Phase 3, when ITC adopts the frozen bundle.

### Design

```
before                                   after
publish-matrix ─▶ itc-publish            publish-matrix ─▶ publish-core ◀─ itc-publish (ITC verbs + re-exports)
               ─▶ itc-plan                                              ◀─ itc-plan    (ITC plan  + re-exports)
               ─▶ itc-config
```

- `publish-core.ts` may import `./fanout` (`runFanout`), `./invoke` (`pluginEnvFromConfig`, `pluginProcessEnv`, `resolveKkConfigPath`), `@gobing-ai/*` and `zod` — the same dependencies the moved code has today.
- `itc-publish.ts` and `itc-plan.ts` import what they still use from `./publish-core` and re-export the moved names. No circular import: `publish-core` never imports them.
- Move with cut/paste; do not reformat, reorder or "improve" the moved code. Biome's import sort is the only permitted diff inside moved bodies.
- Per-file coverage gate (90% line/function): `publish-core.ts` inherits the coverage of the suites that already exercise this code. If the gate fails for the new file, report the uncovered lines in Testing — do not add suppressions.

### Plan

1. Record baselines: `rg -n 'itcDelivery' apps/cli/src | wc -l`, and the pass counts of the AC1 `bun test` command on the untouched tree.
2. Create `apps/cli/src/publish-core.ts`; move the R1 symbols and their private helpers; apply the three neutral receipt names.
3. Replace the moved code in `itc-publish.ts` / `itc-plan.ts` with imports + re-exports (R2).
4. Repoint `publish-matrix.ts` (R3); decide the config-path question by reading both resolvers and note it in Solution.
5. Fix `plugins/kk/config.example.yaml:14` (R6).
6. Run AC1 commands in order; `bun run lint && bun run test && bun run build`. Paste outputs into Testing.
7. Stop. No surface change, so `docs/04_DESIGN.md` is not edited.

### Solution

A pure move: no behaviour, wire format, schema or assertion changed. Bodies were copied verbatim into
the new module; ITC presence is now only re-export surface.

**New module — `apps/cli/src/publish-core.ts` (614 lines).** Receipt contract
(`DeliveryMetadataSchema` `apps/cli/src/publish-core.ts:28`, `ReceiptSchema` `:37`, `Receipt` `:68`),
plugin probe (`PluginProbeResult` `:76`, `probePlugin` `:88`), preset contract
(`PublishWindowSchema` `:123`, `PublishPresetTargetSchema` `:134`, `PublishPresetSchema` `:156`), preset
resolution (`resolveDefaultPackageRoot` `:179`, `resolvePresetFromRoots` `:188`, `readPresetFile` `:214`,
`loadPublishPreset` `:247`), the neutral config path (`resolveConfigPath` `:271`, with the `~` expander at
`:263`), and the shared send loop (`SendRow` `:283`, `SendRowsOutcome` `:298`, `SendRowsOptions` `:307`,
`sendRows` `:342`). The module imports nothing from `./itc-*` (R4, AC1).

**R3 decision — `resolveKkConfigPath` was NOT behaviour-equivalent, so the ITC resolver moved.**
`resolveKkConfigPath` (`apps/cli/src/invoke.ts:52`) reads `process.env.KK_CONFIG` untrimmed and never
expands a leading `~`/`$HOME`, while `resolveItcConfigPath` trims and expands
(`apps/cli/src/itc-config.ts:7` before the move). For `KK_CONFIG=' ~/x.yaml '` or `'~/kk.yaml'` the two
disagree, so the fallback branch of R3 applies: the function moved as `resolveConfigPath`
(`apps/cli/src/publish-core.ts:271`) and `itc-config` re-exports it under the old name
(`apps/cli/src/itc-config.ts:9`).

**Re-export surface (R2) — no caller or test import changed.** `apps/cli/src/itc-publish.ts:22` imports
the moved symbols and re-exports them under the previous names at `apps/cli/src/itc-publish.ts:28`
(types: `Receipt as ItcReceipt`, `PluginProbeResult`, `SendRow`, `SendRowsOptions`, `SendRowsOutcome`) and
`apps/cli/src/itc-publish.ts:35` (values: `DeliveryMetadataSchema as ItcDeliveryMetadataSchema`,
`ReceiptSchema as ItcReceiptSchema`, `probePlugin`, `sendRows`). `apps/cli/src/itc-plan.ts:10` and
`apps/cli/src/itc-plan.ts:13` re-export the preset symbols unchanged. ITC-only code stayed put:
`itcMaterializePlan` `apps/cli/src/itc-publish.ts:75`, `itcCheckTargets` `:324`, `itcSendTargets` `:387`,
`itcReconcileReceipts` `:462`, `itcExportSeo` `:527`, `itcReportSummary` `:588`, `itcAuthorVerdict` `:702`.

**The matrix now depends on the core, not on ITC (R3/R4).** `apps/cli/src/publish-matrix.ts:12` imports
`loadPublishPreset`, `probePlugin`, `PublishWindowSchema`, `resolveConfigPath`, `sendRows` and the types
from `./publish-core`; the `//` `from './itc-` import is gone (`rg -n "from '\./itc-"` over
`publish-matrix.ts`/`publish-core.ts` prints nothing).

**Wire stability (R5).** `metadata.itcDelivery`, every JSON file name, error-code string and log event is
unchanged: `rg -n 'itcDelivery' apps/cli/src | wc -l` is `4` now and `4` at base `901a4fe1` (the key moved
with `ReceiptSchema`; only TypeScript identifiers were renamed).

**Docs (R6).** `plugins/kk/config.example.yaml:12` no longer claims "`live` is never in a preset file"; it
states that a preset target may carry `mode: live` since the ADR-022 amendment of 2026-11-12.
`.spur/context/anatomy.md` does not exist in this repository (the file is an untracked local index that
was never generated here), so the one-line entry has no target — recorded as N/A rather than inventing an
index file nothing refreshes.

**Verification.** `bun run --filter '@gobing-ai/knowledge-kit' typecheck` exit 0; `bunx biome check` clean;
`apps/cli/tests/itc-publish.test.ts` 45 pass, `publish-matrix.test.ts` 35, `publish-matrix-0330.test.ts`
10, `itc-config.test.ts` 22, `itc-presets.test.ts` 9, `fanout.test.ts` 54 — every file 0 fail with no
test-source change from this task.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Every listed symbol moved verbatim into `apps/cli/src/publish-core.ts` (`DeliveryMetadataSchema` `:28`, `ReceiptSchema` `:37`, `Receipt` `:68`, `probePlugin` `:88`, `PublishWindowSchema` `:123`, `PublishPresetTargetSchema` `:134`, `PublishPresetSchema` `:156`, `resolveDefaultPackageRoot` `:179`, `resolvePresetFromRoots` `:188`, `readPresetFile` `:214`, `loadPublishPreset` `:247`, `SendRow` `:283`, `SendRowsOutcome` `:298`, `SendRowsOptions` `:307`, `sendRows` `:342`). |
| R2 | MET | Neutral names in the core and unchanged names re-exported by ITC: `apps/cli/src/itc-publish.ts:22`, `:28`, `:35`; `apps/cli/src/itc-plan.ts:8`, `:10`, `:13`. No test or caller import changed. |
| R3 | MET | `publish-matrix.ts` imports from `./publish-core` (`apps/cli/src/publish-matrix.ts:12`); the two config resolvers are NOT behaviour-equivalent (untrimmed `process.env` read, no `~` expansion at `apps/cli/src/invoke.ts:52`), so `resolveItcConfigPath` moved as `resolveConfigPath` (`apps/cli/src/publish-core.ts:271`) and `itc-config` re-exports it (`apps/cli/src/itc-config.ts:9`). |
| R4 | MET | `rg -n "from '\./itc-" apps/cli/src/publish-matrix.ts apps/cli/src/publish-core.ts` prints nothing; every ITC-only function stayed in `itc-publish.ts` (`itcMaterializePlan` `:75` … `itcAuthorVerdict` `:702`). |
| R5 | MET | `itcDelivery` occurrences in `apps/cli/src` are `4` before and after; file names, error codes and log events unchanged; the existing suites pass with no edit. |
| R6 | MET | `plugins/kk/config.example.yaml:15` — a preset target may carry `mode: live` (ADR-022 amendment 2026-11-12) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The news publish path imports no ITC-named module (req: R1, R2, R3, R4, R5, R6) | MET | test | `rg -n "from '\./itc-" apps/cli/src/publish-matrix.ts apps/cli/src/publish-core.ts` → no output; `git diff --name-only 901a4fe1 -- apps/cli/tests` lists only the new `apps/cli/tests/publish-core.test.ts`; `bun test` on `itc-publish` 45, `publish-matrix` 35, `publish-matrix-0330` 10, `itc-config` 22, `itc-presets` 9, `fanout` 54 — all 0 fail; `rg -n 'itcDelivery' apps/cli/src \| wc -l` → `4` (= base); `bun run lint` and `bun run build` exit 0 via `spur task gate 0361 run` → PASS. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Reviewed the 0361 change (new `apps/cli/src/publish-core.ts`, the three ITC modules' re-export surface, `publish-matrix.ts` imports, one new test file, one config-example comment) against R1–R6 and AC1. Full artifact: `.spur/run/eb34e5d3-review-cert.md`.

| Priority | ID | Finding | Evidence | Disposition |
| --- | --- | --- | --- | --- |
| P4 | G1 | The neutral module widens the CLI package's exported surface — `SLUG_REGEX`, `expandHome`, `resolveDefaultPackageRoot`, `readPresetFile` and `resolvePresetFromRoots` were module-private and are exported now because `itc-plan`/`itc-config` import them. | `apps/cli/src/publish-core.ts:170`, `apps/cli/src/publish-core.ts:263` | Accepted: the alternative is duplicating the resolvers, which is the drift this task removes. A later `publish-core/` split can re-hide them. |
| P4 | G2 | A config-*path* helper now lives in the publish core and `itc-config` imports `expandHome` back from it. | `apps/cli/src/publish-core.ts:271`, `apps/cli/src/itc-config.ts:7` | Accepted per R3's fallback branch (the two resolvers are not interchangeable). |
| P4 | G3 | R6's anatomy clause names `.spur/context/anatomy.md`, which does not exist in this repository and is not tracked. | (no such path) | Recorded as N/A rather than inventing an index nothing refreshes. |

No open P1–P3 finding.

Preservation: every moved block is verbatim in the core once the three R2 renames and the `export` keyword are applied; no existing test source changed (only the new `apps/cli/tests/publish-core.test.ts`); `itcDelivery` occurrences in `apps/cli/src` stay at `4`; the core imports nothing from `./itc-*` and no imported module imports it back.

Verification: `spur task gate 0361 run` → `quality gate PASS (attempts: 1)` (lint, 58 pre-check rules, full suite, post-check rules); `bun run build` exit 0; `bun test apps/cli/tests/publish-core.test.ts` 6 pass; the six pre-existing ITC/publish suites pass unchanged (45/35/10/22/9/54, 0 fail).

Confidence: HIGH
Verdict: PASS

### References

- Parent feature: G61, scenario "The news publish path imports no ITC-named module".
- Decision: `docs/00_ADR.md` → ADR-053 §1; ADR-022 (2026-11-12 amendment), ADR-043.
- Prior art: task 0321 R6 (extraction of `sendRows`).
- Independent of 0360; blocks the Phase 2 tasks created by 0362.

### History

- 2026-11-13T17:40:54.085Z feature_id Q → G61 (system)
- 2026-11-13T20:09:07.246Z backlog → wip (system)
- 2026-11-13T20:10:29.245Z wip → testing (system)
- 2026-11-13T20:10:30.319Z testing → done (system)

