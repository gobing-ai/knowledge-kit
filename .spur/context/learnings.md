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

## 2026-09-14 — F8 batch (0127/0128/0129) runall learnings
- Proof-window discipline: verify subagents with `--fix none` still need the proof digest re-captured whenever ANY tracked file changes post-capture — even docs. Corpus files (docs/tasks, docs/features) are digest-excluded, so post-verify corpus writes (P tombstone) did NOT invalidate `sha256:c00442ca…`.
- `task verdict --from-answer` parses ONLY `Verdict: <PASS|PARTIAL|FAIL>` + pipe-table rows `| Rn | MET | … |` with a `| Req | Status | Evidence |` header. Bullet-style answers yield UNKNOWN; reformat mechanically (content verbatim) rather than re-dispatching.
- Feature tombstones: `feature check --strict` fails `L4.orphan-scenarios` when a cancelled feature keeps gherkin AC while its tasks moved away. Empty the AC section (Notes section accepts the pointer prose; AC section must be empty or valid BDD — blockquotes trip L3.ac-bdd-*).
- kk-solo-podcast.yaml has a PRE-EXISTING schema defect (8 shell actions, `command:` at 8-space indent, `options: null`) — identical on main; tracked as task 0130. No CI test executes that YAML, which is why it went unnoticed.

## 2026-09-19 — kk-daily-ai-voice live dogfood (091825 → done) + two fixes

- Shipped fixes: `cc219c8e` (标签 metadata lines stripped at script-builder seam; cache-unpoison unlink in dailyScript) and `11c2f8b3` (omni qc.py repetition battery is transcription-only + duration corroboration — canonical qc.ts parity; bare `"repetition_detected"` issue token, R5a gate does exact list membership).
- qc port divergence was live for weeks: the Python port flagged source-text patterns unconditionally while canonical qc.ts checks transcription only, corroborated by duration anomaly. Consider a parity test for any ported QC logic.
- (a) `spur workflow run --run-id <terminal-id>` silently no-ops; failed runs are not continue-able — always fresh run-id per retry.
- (b) Killing a foreground `workflow continue` orphans the run as `running`; repair = restore exact pre-continue row (`status='paused', pid=NULL`).
- (c) Bare `workflow continue` (no `--answer`) on non-TTY marks a paused run failed.
- (d) Agent stages (plan/article/QC) re-run eagerly on fresh run-id even when shell stages cache-hit → generation mixing on resume.
- (e) `workflow continue` lacks `--async`; must nohup-detach (no `--async` flag exists).
- (f) Shell action stdout/stderr not persisted — 70-min generate fails with opaque exit 1 and zero evidence. Biggest observability gap in the workflow engine.
- (g) `workflow continue` can sit alive 10+ min with no output before the resumed states appear in trace (run log file itself is not updated by the continued session — use `workflow trace --json` as the liveness source).
- Date-rollover effect: a run launched before midnight local builds the NEW day's episode (collect re-runs live, ~19 min; prior-day caches don't apply). Launched 00:39 → Sep 19 episode end-to-end.
- QC outcome on 25-seg Sep 19 episode: 0 repetition, 0 duration anomalies; 10 non-failing `loudness_dip:unknown` recorded (known cosmetic, survives verify regen). Audio 1219.68s; surfdash zh + podcast published live; patch + en/ja locales committed/pushed (surfdash 51f14ce → 1fc968a → be102f0).
- translate-sync is file-sync only (surfdash publish-orchestrator, no git) — committing en/ja posts is a manual wrap-up step (prior-day convention message: `content: translate daily AI news <date> (en, ja)`).

## 2026-09-22 — F41 batch (0149–0154) runall learnings
- 30-min implement budget kills are recoverable by design: 0150 and 0151 each died at budget with work left uncommitted in the tree; a single continuation brief stating exactly what attempt 1 left ("work IS IN THE TREE, COMPLETE don't restart") plus a target-bound restatement of the gate bar (aggregate >=90% line+function only) finished both in one more attempt. No task ever needed a third implement attempt.
- Proof-digest re-stamp protocol: any post-capture write to proof-input files — including the driver's own `task record` (Solution/History) running before the done guard — invalidates the digest. Remedy is mechanical: re-derive the canonical projection, re-stamp, and append old/new digests to the correction log (0151 corrections 4/5). Cheaper: run `task record` before capture whenever the pipeline allows.
- Evidence-rule AC citation constraint: verify answers need a `| AC | Status | Evidence Type | Evidence |` table with types from the closed set {test, command, static-ref, manual-review, llm-judge}. Verifier under-citation (0151 AC1/AC7: tests existed and were fresh green but rows lacked proper types) fails the evidence rule even when substantively true — fix by mechanical completion via `spur task update --section` + re-stamp, not re-dispatch.
- Load-flake gate re-runs: full-suite `bun test` under parallel load produced 1-3 fanin.test.ts wall-time/timeout failures (0152) in a file untouched by the diff that passes 27/27 in isolation — classify as load flake, confirm with an isolated re-run before treating as regression.
- Review→testfix→review2 loop works as specified: 0151 review returned NEEDS_FIXES with 3 majors (incl. a locale dead-end where default `source_locale=en` + ja/zh targets hit `variant file not found`); testfix round 1 root-caused all 3; fresh review session APPROVED. Budget one fix round per task and re-review from a fresh session.

## 2026-09-25 — runall F613 (worktree 2741)

- Feature `verifying → done` L4 gate matches verdict rows by **normalized feature-scenario title** (or `AC-<ordinal>` dashed alias), never bare `R#`/`AC#` ids. Key verify-answer Req row ids to the feature scenario titles (evidence unchanged) or the scenario is "linked but unverified" forever. Matcher: `feature-check.ts` `rowMatchesScenario`.
- `feature sync`'s verifying onEnter shells `plugins/sp/scripts/feature-verification-steps.ts` → needs upstream files (`feature-verification-steps.ts`, `lib/env.ts`, `lib/inline-run.generated.mjs`) **and** a project `.spur/workflows/feature-verification.yaml` (resolver is project-layer only; set `verificationCmd` to a script the repo actually has, e.g. `bun run spur-check`). Never copy the `.mjs` twin — Biome errors on it.
- jq verdict enrichment (proof/checks) must run AFTER every `task verdict --from-answer` re-derive + fold — re-deriving wipes it.

## 2026-09-25 runall-e8-5a30 — task 0167
- Playwright `locator(sel).first().count()` is 0/1, never the set size — thumbnail-count checks need set-level `locator(sel).count()`. Fakes must mirror this or tests pass while live breaks.
- Post-open browser flows: wrap every action in a step-named `act()` helper + outer catch → guaranteed named `ok:false` Result; raw throws leak "no Result written" states.
- Structural page seams for browser plugins: keep the seam minimal (goto/locator/setInputFiles/url/close); inject timeouts (`stepTimeoutMs`/`loginTimeoutMs`) so failure-path tests don't sleep.
