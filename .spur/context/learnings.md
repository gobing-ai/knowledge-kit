# Learnings

Conventions / decisions discovered the hard way. Newest first.

## 2026-08-12 — sp-dev-find-conflict dogfood (run 20260812-010531)

1. **Dogfood runs ≥ 3 min must dual-write ledger rows per-step, not at finalize.**
   monitor-ledger.md's fast-run exemption (< 3 min) does not apply once a run crosses
   that wall; a run that batch-writes rows for a ≥ 3-min run must self-report a P3
   (protocol violation). Plan for per-step dual-writes when the testee is a multi-step
   audit like find-conflict.
2. **DD-09 roll-up close-out needs a carrier task (0028 pattern).** A parent at
   `verifying` whose AC carries composition scenarios ("X kind composes into the
   platform") can't reach `done` until a linked task's AC carries those titles verbatim
   and its verdict has PASS + MET rows keyed to them. Re-linking child impl tasks to the
   parent (feature_id) is the sanctioned first step; the parent-level scenarios then need
   a dedicated carrier. Feature-check `--strict` elevates L4 warnings to errors at the
   verifying→done guard — "PASS with warnings" at `spur feature check` does not mean
   the sync guard will let the feature through.

## 2026-08-02 — B5 verifyall (tasks 0026/0027)

1. **Pipe masking hides real exit codes.** `spur workflow run … | tail -3; echo $?`
   reports tail's status (0), not the workflow's. Measure unpiped (`> file 2>&1; echo $?`)
   or use `$pipestatus[1]` (zsh). A "failed" workflow run looked like exit 0 until re-measured.
2. **content-gen agent-output extraction must tolerate prose.** Agents rarely return a bare
   whole-stdout fence; they wrap it in narration. Anchored `/^```…```$/` extraction fails
   with `JSON Parse error: Unexpected identifier`. Fixed in `662ba0b` (first-fence-anywhere,
   then outermost `{…}` fallback) — keep that tolerance when touching the stand-in.
3. **`--agent auto` pool has quota-flaky members.** `oh-pi` returned HTTP 429 code 1310
   (limit resets 2026-08-07) and failed every nested call at ~27s. For acceptance runs,
   pin a healthy agent via `KNOWLEDGE_KIT_SPUR_BIN` wrapper rewriting `--agent auto` → a
   named agent; disclose the pin in Testing.
4. **Biome honors only the repo `.gitignore`** (`vcs.useIgnoreFile: true`). Paths ignored
   solely via the user's global gitignore (e.g. `scratch/`) still get linted — and generated
   artifacts fail the format check. Keep `scratch/` in the repo file.
5. **Nested `spur agent run --cwd <plugin-dir>` creates an accidental `plugins/<x>/.spur/`
   runtime** (spur.db + logs). Delete it; never commit (same class as the `/docs/.spur/`
   gitignore warning).
6. **karakeep-local skips non-conformant fixtures silently** (missing string `body` →
   warning + `docs.json: []`, and the chain then "succeeds" on a Notice placeholder).
   An acceptance run is only real if you inspect the intermediate artifacts, not just
   the terminal `ok: true`.

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
