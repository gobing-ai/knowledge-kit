# Learnings

Conventions / decisions discovered the hard way. Newest first.

## 2026-08-02 — E3 wrap (tasks 0024/0025)

1. **Verdict artifacts need `acceptanceCriteria[]`, not `checks[]`.** `spur feature check`
   marks a linked scenario verified only from `.spur/run/<wbs>-verdict.json` top-level
   `requirements[]` / `acceptanceCriteria[]` rows whose `id` matches the scenario title
   (normalized) with `status: "MET"`. Scenario rows placed in `checks[]` are ignored →
   `L4.scenario-unverified` even with verdict PASS.
   (spur-new `packages/app/src/services/feature-check.ts` — `isScenarioVerified`.)
2. **Testing-section citations must be repo-root-relative.** `spur task check` resolves
   `file:line` anchors from project root; plugin-relative shorthand (`src/index.ts:30-80`)
   fires `L4.stale-line-anchor` even when the anchor is correct within the plugin.
3. **wrapup-pipeline `doc-sync` agent (omp) hangs in this env.** Two runs died at the
   step timeout (5m external kill, then the pipeline's own 10m cap, exit 3) though
   `spur agent doctor` reports omp usable. Wrap steps are inlineable: feature transition
   via `spur feature update <id> <status>` per legal edge, docs per constitution,
   learnings here. Don't burn 10 min re-trying omp before inlining.
4. **Feature lifecycle edges are positional:** `spur feature update E3 done` — there is
   no `--status` flag.
