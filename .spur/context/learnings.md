# Learnings

Conventions / decisions discovered the hard way. Newest first.

## Learning: workflow YAML names kinds; rule YAML loads modules

- **Convention/quirk:** A workflow `guard`/`action` is only `{ kind, options }` looked up on `WorkflowEngineHost` (`evaluateGuard` / `runAction`). Implementations are registered in-process (`createDefaultWorkflowEngineHost` + `registerSpurBuiltins`). `loadWorkflowExtensionsIntoHost` is library-only — `spur workflow run` never calls it. `type: gate` is unread. The YAML that *does* list module paths is the **rule** engine: `extensions.evaluators: [./file.ts]` relative to the YAML (`collectExtensions` + `loadExtensionsIntoHost`).
- **Why it matters:** B7 copies kind-lookup (plugin name → kk registry) + YAML-injected extra folders (`--plugins-path`). It must not add `kind: kk.publish` to Spur's host or dynamic-import plugin TS as workflow extensions.

## Learning: plugins/ is four fixed collections (ADR-009)

- **Convention/quirk:** Product plugins live at `plugins/ingestions|generations|publishings/<name>/`. Agent skills, commands, agents, hooks, and rules live only under `plugins/kk`. Workspaces are the three kind globs, never `plugins/*`. `discoverPlugins` skips `kk` and reports `misplaced` / `kind_mismatch`.
- **Why it matters:** A plugin dropped at `plugins/<name>` is invisible (or doctor-unhealthy) and the old one-level scan cannot tell `kk` from a product plugin. tsconfig `extends` and `apps/cli` test imports need one extra `../` after the extra collection folder.

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

## 2026-09-02 — E6 0085 pipeline learnings

- **Verify answer-file machine contract**: `spur task verdict` parses markdown tables only — requirements table `| Requirement | Status | Evidence |`, AC table `| AC | Status | Evidence-Type | Evidence |` (evidence-type col 3: test/command/static-ref/manual-review/llm-judge/n-a). Prose "### R1 — : MET" headings yield 0 rows → UNKNOWN verdict. Emit both tables in verify answers.
- **New direct-fetch publish transport admission**: add the boundary file to `.spur/rules/strict/http-boundaries.yaml` no-direct-fetch exclude (comment + precedent style, qiita-pub/emdash-pub). Binary local-file IO the FileSystem seam can't express (text-only) gets a no-direct-fs-io exclude with rationale (voice-gen WAV precedent).
- **`spur task record` reads `.spur/run/<wbs>-verdict.json` (canonical artifact from `spur task verdict`)**, not ad-hoc JSON shapes — wrong shape silently writes "verdict UNKNOWN" sections.

## 2026-09-02 — E6 verifyall re-audit + 0087 closeout

- **`spur task record` overwrites authored `## Review`** despite the documented `sectionIsBare` guard: `spur task verdict --from-answer` does not parse the answer file's `### SECUA Review` table into `checks[]`, so record backfills Review from two generic checks and clobbers prior findings. Repair path: rewrite Review via `spur task update <wbs> --section Review --from-file` (keep the `<!-- spur:record-review -->` marker). Upstream-bug candidate for the spur CLI repo.
- **Done-gate provenance layer**: manual (non-pipeline) execution hits `GuardDeniedError: No pipeline run recorded` on `testing → done`; sanctioned bypass `SPUR_PROVENANCE_OVERRIDE=1 spur task update <wbs> done` (recorded). Legitimate only with a fresh PASS verdict artifact.
- **Shell HTTP probes are hook-blocked in agent sessions** — route live checks through ctx_execute; keep fixtures in /tmp and leave the instance clean (publish → present → delete → absent in one run).
- **Astro 7 checkOrigin**: non-safe methods without Content-Type are 403'd when no Origin header — a bodyless DELETE with `Content-Type: application/json` passes (0087 fix pattern).

## 2026-09-07 — L1 pipeline redesign closed (0092–0101)

- Executor publish seam is two-form: Content object → ResultSchema JSON on --out; bare Doc[] (show-notes) → raw markdown artifact, opaque to the executor (kinds.ts union + invoke.ts publish-scoped output exemption). A single-form contract silently kills any plugin op whose --out is not JSON — audit BOTH IO stages when a plugin op fails at the executor.
- Scope an executor-side key narrowly (kind === 'publish' && Array.isArray(input)): generators' Doc[] input is the ordinary form; a blanket array-key exemption breaks their output validation.
- Honest-dogfood protocol works: FAIL attempts (0098 r1 calibration, r2 show-notes seam) each converted into exactly one follow-up task (0099, 0100, 0101); never fix production defects inside a dogfood task.
- Live seam probe before a long verification window: a 1-minute real `kk executor run podcast-pub --in prior-plan.json --out /tmp/probe.md` proved both fixes end-to-end before burning the 3h dogfood. Reuse a prior run's plan.json only as a probe fixture, never as pipeline cache.
- max-not-sum collect re-confirmed on 4th live run (13m34s vs 20m42s serial). qcc pins 2/3/2/1 admit real items count-agnostically (1/19 and 2/20 across runs).
- P4 cosmetic carry-over: empty digest-section headers ("## Financial News") flow through to article/script and get spoken (~212s segment). Candidate follow-up: strip empty markdown sections at annotate.
- 0110 (5503d8c): staged plugin entries must be self-contained bundles — Bun.build per entry + manifest entry rewrite to ./dist/index.js; prepack chains it. Never invoke scripts/bundle-plugins.ts via `bun -e import` — the module main block double-runs and races its own staging.
- 0110: Bun abort-kill on Bun.spawn beats late abort listeners (pgrep -P sees a dead pid) — use a self-managed setTimeout + killProcessTree for spawn timeouts.
- 0110: task done gate (L3) requires a P1–P4 priority findings table in the task's Review section; prose-only findings block `task update done`.
- 0110: verify answer-file lint wants MET/PARTIAL/UNMET statuses and evidence types from {test, command, static-ref, manual-review, llm-judge} — not PASS.
- 0110 close-out: `scripts/bundle-plugins.ts` still copies plugin `node_modules` into `apps/cli/plugins`. An isolated AC1 smoke must copy only `plugin.json` + `dist/index.js` (plus CLI `dist/index.js` and `package.json` — `apps/cli/src/config.ts` reads `../package.json` from the bundle). Copying the staged tree wholesale reintroduces workspace symlinks and hides missing closure.
- 0110 close-out: Testing evidence in backticks must be repo-root paths (`apps/cli/tests/invoke.test.ts:183`). A later shorthand `invoke.test.ts:183` in the same table is still `L4.stale-line-anchor` and fails `spur task check --strict`.
- 0110 close-out: the capture-session `### Solution` ("Not implemented") survived `task update done`. Replace it with an I/R change map before calling the task shippable — status `done` is not a change-map.
- 0110 close-out: I3 removed the kind-wide publish `Doc[]` / opaque-output exemption. A shipped Execution-boundary table can still leave the earlier kind-contract row claiming the old gap (`docs/03_ARCHITECTURE.md` plugin-kinds table); grep both.
- 0111: pruning `node_modules` from the staged copy means `Bun.build` must use the **source** plugin entry (`plugins/<collection>/<name>/…`), not the staged `src/`. Bundling staged src after the prune fails with a bare `Bundle failed` (workspace packages unresolvable).
