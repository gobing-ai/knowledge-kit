---
schema_version: 1
name: Extract a neutral publish core from itc-publish, itc-plan and publish-matrix
status: backlog
template: feature-impl
created_at: 2026-11-13T17:31:13.967Z
updated_at: "2026-11-13T17:47:41.748Z"
feature_id: G61

ac_altitude: task-local
ac_numbering: task-local
priority: P1
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

- [ ] R1. New file `apps/cli/src/publish-core.ts` holds, moved verbatim (bodies unchanged): from `itc-publish.ts` — `ItcDeliveryMetadataSchema` (L20), `ItcReceiptSchema` (L29), `ItcReceipt` (L60), `PluginProbeResult` (L340), `probePlugin` (L352), `SendRow` (L456), `SendRowsOutcome` (L471), `SendRowsOptions` (L480), `sendRows` (L515-790) and any non-exported helper used only by them; from `itc-plan.ts` — `PublishWindowSchema`/`PublishWindow` (L33), `PublishPresetTargetSchema`/`PublishPresetTarget` (L44-60), `PublishPresetSchema`/`PublishPreset` (L66-75), `resolveDefaultPackageRoot` (L159), `resolvePresetFromRoots` (L212), `readPresetFile` (L238), `loadPublishPreset` (L379).
- [ ] R2. In `publish-core.ts` the receipt symbols are exported under neutral names — `DeliveryMetadataSchema`, `ReceiptSchema`, `Receipt` — and `itc-publish.ts` re-exports them under the old names (`export { ReceiptSchema as ItcReceiptSchema, … }`, `export type { Receipt as ItcReceipt }`). `itc-publish.ts` and `itc-plan.ts` re-export every other moved symbol under its unchanged name, so no file under `apps/cli/tests/` needs an import change.
- [ ] R3. `apps/cli/src/publish-matrix.ts` imports the moved symbols from `./publish-core` and the config path from `resolveKkConfigPath` in `./invoke` (`apps/cli/src/invoke.ts:52`) if it is behaviour-equivalent to `resolveItcConfigPath` (`itc-config.ts:207`) for every `(env, homeDir)` input; if not, `resolveItcConfigPath` moves to `publish-core.ts` as `resolveConfigPath` with a re-export. State which in Solution.
- [ ] R4. `publish-core.ts` imports nothing from any `./itc-*` file. ITC-only functions stay where they are (`itcMaterializePlan`, `itcCheckTargets`, `itcSendTargets`, `itcReconcileReceipts`, `itcExportSeo`, `itcReportSummary`, `itcAuthorVerdict`, `resolveItcTargets`, `buildItcPublishPlan`).
- [ ] R5. Wire formats are byte-stable: the receipt key `metadata.itcDelivery`, every JSON file name, every error code string and every log event name is unchanged.
- [ ] R6. `plugins/kk/config.example.yaml:14` no longer claims "`live` is never in a preset"; it states that a preset target may carry `mode: live` (ADR-022 amendment 2026-11-12). `.spur/context/anatomy.md` gains the one-line entry for `publish-core.ts` through the project's usual refresh.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent feature: G61, scenario "The news publish path imports no ITC-named module".
- Decision: `docs/00_ADR.md` → ADR-053 §1; ADR-022 (2026-11-12 amendment), ADR-043.
- Prior art: task 0321 R6 (extraction of `sendRows`).
- Independent of 0360; blocks the Phase 2 tasks created by 0362.

### History

- 2026-11-13T17:40:54.085Z feature_id Q → G61 (system)

