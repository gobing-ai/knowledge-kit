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

## runall-e8-5a30 / 0168 (2026-09-25)

- Direct `bun plugins/generations/image-gen/src/index.ts` does NOT read `~/.config/kk/config.yaml` `plugins.*.env` — export the provider key (`MINIMAX_API_KEY`) for worktree-preset paid runs; `kk executor run` reads config but resolves its own (possibly stale) plugin set. Attribution: paid dogfood needed both worktree presets AND user config key.
- image-gen `--in` envelope is a **DocList array** (`[{ metadata.imageGen: {...} }]`), not a bare Doc — script `env[0]`, not `env`.
- minimax emits `.jpg` (provider-decided extension); the resume-glob hardening (`cards/card-NN-*` or recorded path) is validated by the paid run.
- Verdict PARTIAL from an operator-gated spend carve-out can be closed in-session by asking once (ask_user_question) — paid 4-card dogfood ~85s wall, trivial cost, upgrades R2/R3/R7 to MET with mechanical evidence (prompt==body, ContentSchema pass).

## 0174 — xhs-pub live creator-UI flow (2026-09-25)

- **Bun enforces `coverageThreshold` per FILE, not just aggregate** (bunfig `coverageThreshold = {lines, functions}`, 0.9). A file whose funcs/lines dip below 90% makes `bun test` exit 1 while still printing `0 fail` — the gate then fails with no failing test and no threshold message. Symptom to remember: "N pass / 0 fail" + exit 1. Bisect with an aggregate-high target set (apps+packages+scripts+one plugin) instead of a single file (a lone file fails on the threshold for an unrelated reason).
- Live XHS creator console (measured 2026-09-25): opens on the **video** tab; 图文 tab is `div.creator-tab` and its inner `span.title` intercepts the hit test → `click({force:true})` on the **in-viewport** duplicate (the tabs render 3×). The image input is **hidden** → probe **attachment**, never visibility (`trySelectors` defaults to visible, so a hidden input needs a separate probe). Previews are `img.preivew-image` (XHS's own typo). Body is **TipTap** (`div.tiptap[contenteditable]`) and must be **typed**: `fill()` leaves the note unregistered, the save then has nothing to persist, and no draft becomes observable. The submit bar is `<XHS-PUBLISH-BTN>` with a **closed** shadow root — reachable only via CDP (`DOM.getDocument {pierce:true}` + `DOM.getBoxModel`), never by CSS/text selectors; the draft control is labelled **`暂存离开`** (not 存草稿) and its live box moved between runs (606,855 → 556,675), so never hardcode a coordinate.
- The draft counter (`草稿箱(N)`) exists **only on the landing view** — the editor replaces the header — so read it *before* entering the tab; after a save the console shows a fresh `保存于<timestamp>` entry (and the counter returns). Confirm a draft from those two signals only; XHS autosaves uploads, so "counter moved" alone can be autosave noise.
- A submit click that lands while the note is still settling is silently dropped → settle, click, then wait, bounded to a few attempts.

## 2026-10-01 F616 runall close-out
- **spur platform bug (blocks ALL feature closes):** `active→verifying` hop runs `feature-verification` workflow; its receipt step registers a run artifact mid-run but the workflow commits its run row only at completion → `artifacts.run_id → runs.id` FK fails every time (`SQLiteError: FOREIGN KEY constraint failed` in `plugins/sp/scripts/feature-verification-steps.ts` artifact registration). `spur-check` inside is NOT the problem (passes in ~90 s — give hops 10+ min timeouts, not 60 s). Fix belongs in spur-new (register post-commit or openInlineRunProjectDb visibility).
- **Operator-authorized bypass used:** direct frontmatter edit F616 active→done with History note (Robin, 2026-10-01). Stale runs row (`status:'running'` orphan from killed hop) cleaned by direct sqlite update — killed spur processes leave orphaned `running` rows.
- **Main-tree `bun run gate`/`test` sweeps gitignored `vendors/AiToEarn`** (nestjs/tsx errors, ~235 fail) — pre-existing pollution; verify via a checkout without vendors (worktree) instead. Merged-tree spur-check: 1642 pass / 1 fail = flaky `invoke.test.ts` I2b grandchild-reaping test (2/3 pass in isolation), not ours.
  - Fixed 2026-10-02 (root cause found): `bun test` positional filters are substring matches — `vendors/AiToEarn/.../apps/...` matched `apps`. Fix: `--path-ignore-patterns 'vendors/**'` (must stay quoted — unquoted `**` glob-expands in the script shell) + `--timeout 20000` (spawn-cold-start headroom for `spawnSync('bun', ...)` test chains) in the `test` script; main-tree gate green, 1643/0.

## 2026-10-02 — 0175 supersedes the old sp vendoring recipe

- The 2026-09-25 recipe to copy Spur scripts/libraries is superseded by released 0960 isolation and task 0175's frozen Design. Use supported Superskill installation and actual runtime preflight; never restore `plugins/sp/` or create `config/plugin-scripts.json` in this consumer.
- This project's feature-verification override must remain because its command is `bun run spur-check`, while the released shared definition configures an absent `spur-check-feature`. Its failed-check reason already exists. The replacement actions must pin the installed run root and invoke the Bun-backed verifier with Bun, even though its extension is `.mjs`.
- Superskill 0.3.35's green `script verify sp` and 0.3.97 stamp do not prove the sibling generated library is current: the staged inline fingerprint currently fails on a missing `runInlineRunFingerprint`, while the packaged runtime succeeds. Upstream staging owns this defect; stop 0175 workflow/deletion mutations until a supported installation passes the real fingerprint.
- The historical "all feature closes fail with receipt FK" note was not reproduced by the packaged 0.3.97 verifier in an isolated Bun workflow with a real bound PASS receipt. Keep that observation scoped to its historical environment; do not invent a bypass or mark the broken staged installation verified.
- For fixture receipt probes, give the fixture its own Git root and ignore `.spur/` before proof capture. Otherwise its git snapshot can fail against the parent project's ignored path or include changing fixture database/log files.
- Handoff: Robin authorized this release re-audit/specification refinement; implementation is the next step. Task 0175 is todo/P1/4h with frozen Design and a hard R2 preflight barrier. Evidence/checklist: `.spur/run/refine-0175-20261002/readiness.json`. Lint, build, both rule presets and task/workflow checks pass; tests report 1663 pass / 2 skip / 0 fail. Only this tracked context correction and the task were changed by this session; no operational workflow, vendor deletion or install-target mutation occurred. Spur's task writer emits one trailing blank line flagged by `git diff --check`; no direct corpus edit was used to hide it.
- **2026-10-03 update — unblocked and migrated.** The upstream staging defect was fixed at the named owner: superskill now stages a plugin's sibling `lib/` into the shared scripts root (mapper + `stagePluginScripts`, superskill commit b42961b). After restaging, the installed fingerprint passes and 0175 completed: workflow migrated to the installed pinned Bun verifier, vendored tree deleted, E2E `scripts/verify-sp-install.ts` PASS (final). The stale-stamp caveat above remains valid: a green `script verify` alone still does not prove transitive runtime assets — run the real fingerprint.

## 2026-10-03 kk-daily-ai-voice 20261002 ship-out
- 15–20 min episode duration is a STANDING requirement (Robin); now enforced by `kk stage daily-episode-duration <work> <date> 15 20` (fails on metadata.duration). One-day 11–12 min exception recorded for 20261002 (Voicebox 4-item pool ceiling).
- TTS rates are driver-dependent — duration math must use the driver's rate: gemini ≈3.31 zh chars/s, Voicebox robin-news ≈6.3 zh chars/s. Style doc "正文约 4300–5800 字" was calibrated for gemini; Voicebox needs ~5650–7540 chars for 15–20 min (or more items).
- **Template-fallback trap**: `daily-script-style` is idempotent — a stale `_08_script-write_style.md` (old caps 120/120/60/160 + old banned list) silently persists; dailynews-gen then rejects the plan (whole-plan all-or-nothing) and falls back to TEMPLATES with exit 0. Symptom: generic insights + excluded items re-enter. Fix: quarantine the style md, re-run daily-script-style, validate plan with validateScriptPlan (bun -e), verify voicescript content. Always keep stderr visible on daily-script.
- Safe plan edit pattern: bun -e edits → Bun.write → validate; a throw before write discards ALL edits. Insight/lead must also avoid banned phrases (e.g. "最后" banned — use "第四个话题" in leads).
- Voicebox render ≈1h22m for ~4.1k chars; no per-segment cache (in-memory) → full re-render on rebuild. Gemini quota: 100 req/day; a gemini render ≈40–60 requests.
- Full 20261002 chain that worked: quarantine stale artifacts → daily-script-style (fresh style md) → plan conform (validateScriptPlan) → daily-script (stderr visible) → daily-wrap-docs → daily-generate (transcode+voicebox; quarantine 30-audio outputs to force re-render) → daily-intro → daily-episode-duration (evidence) → daily-safety-prep → report/verdict/stamp → gate (escalate→HITL) → daily-publish-prep → daily-publish-surfdash → daily-show-notes → daily-publish-podcast → daily-publish-classify → daily-patch-surfdash → daily-run-report. Status=full.
- ADR-115 cap trap: workflow prompts have a hard 1000-char cap asserted by `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts` (R2/R3). Adding prose to a prompt near the cap (plan-translate was 999/1000) breaks the suite; put rate/duration/caps guidance in the style-contract sidecar (`daily-voice-style.zh.md`) and keep the prompt to a pointer.
- Safety verdict contract (20261003): `daily-safety-gate` requires `confidence: HIGH|MEDIUM|LOW` on the verdict JSON; missing or unrecognized values block the stamp. The level does not change routing (escalation stays with RISK decisions / the escalate flag).
- Judge-verdict confidence contract is project-wide (20261003, later same day): every consumer enforces the enum, not just the daily gate — `kk stage itc-report` included, which reports `outcome: failed` for a `PASS` without it instead of relying on the state machine never routing one there (a later guard edit cannot silently reopen that path). Workflow guards read the verdict through one confidence-aware `jq` filter — `if (.verdict // "") == "PASS" then (.verdict + (if ((.confidence // "") | test("^(HIGH|MEDIUM|LOW)$")) then "" else "!" end)) else (.verdict // "") end` — which renders an out-of-contract `PASS` as `PASS!`; no accept guard matches it and the judge state's catch-all routes it to `failed` (so the two itc `-o "$v" = PASS` accepts and the example's never let it through). Copy the filter verbatim into any new judge gate: `plugins/kk/tests/verdict-confidence.test.ts` executes the real guard strings from the YAML and fails (a) when a PASS-accepting verdict guard lacks the check and (b) when the copies drift apart; it emits `.spur/run/verdict-confidence/summary.json`. Guard strings are templated `${vars.x}` **and** exported as env vars — `$attempt`-style reads only resolve in the child env (spur `childProcessEnv`), so a test harness that only substitutes templates silently evaluates those guards as always-false.
- **Daily 20261002 publish-tail forensics (20261003): three channels were silently missing because the tail was driven by hand, not by the engine.** Five distinct causes, all now guarded:
  1. The run launched with `publish_enabled=false` and legitimately ended at `quality-control → done`; publishing was then done stage by stage from the runbook in this file — a chain that omits `translate` (en/ja), `xhs-write`/`xhs-publish`, and `wechat-publish`. The engine has no mid-graph start (`spur workflow run` offers no `--from`/`--start-state`), so a resumed publish is always hand-driven: `daily-publish-classify` now writes `31-publish/<run_date>_17_publish_completeness.json` (per channel: `done|failed|skipped|not-run` + reason) and prints `WARNING: publish completeness — …`, without touching `publish_status`.
  2. The surfdash card lost its cover because the manual `kk stage daily-patch-surfdash <work_dir> <run_date> <surfdash_root>` call omitted `<plugins_path>`, which silently skips the EmDash re-sync: CMS rows keep `featured_image: ./assets/cover.png`, a path the deployed worker never serves (`surfdash/src/lib/disk-content.ts` documents the 404). The stage now leaves `..._23_patch-surfdash_emdash-resync.txt`. Re-running it with the plugins path re-synced the rows and restored the card.
  3. That repo's push deploys had failed since 2026-09-30 (`63a9e9a` left an unformatted import in `disk-content.ts` **and** the tests of the `contentPostsPublicPathToFs` helper it deleted), so nothing after `aa1656f` reached production: the cover/og_image fix was in `main` but undeployed. Check `gh run list -R robinmin/surfdash` before blaming content.
  4. `surfdash-pub`'s `scaffold-locale` copies `assets/cover.png` into each locale dir and leaves the translated posts **untracked** until `daily-patch-surfdash` rewrites them — a translation that already carries the podcast cross-link and the CDN cover is not rewritten, so it is never committed. Commit `content/posts/articles/{en,ja}/<slug>/` explicitly in that case.
  5. WeChat's saved console session had expired: the preflight fails in ~30 s naming the fix (`bun src/profile-check.ts login`); a draft run needs the operator's sign-in — never automate it. XHS's headed publish works but takes minutes and consumes the ADR-025 24 h publish budget (`~/.config/kk/xhs-automation.json`, consumed at the headed launch, not at the attempt).
- **Fan-out interior concurrency (2026-10-03).** `kk executor fan-out` now starts its non-serial targets together (ADR-007 R4 amendment in `docs/00_ADR.md`), because the engine runs one node at a time and the fan-out step is the only place N publishers overlap — `kk executor fan-in` has done the same for `--source` since ADR-019. Knobs: `--serial` (pre-amendment loop), `--jobs <n>` (start bound), `--serial-target <plugin>` (runs alone *after* the batch — headed browser channels, publishers sharing a checkout), `--target-timeout <ms>` (overrun recorded `failed`, siblings continue). The aggregate stays `--target`-ordered regardless of completion order and the partial-success contract is unchanged. `kk-itc`'s fan-out groups are non-browser by construction (`itc-publish-plan` splits browser targets out of the groups), so its concurrent default is safe; the ADR-025 XHS budget still serializes that one channel at the plugin level. Engine-level `parallel` nodes remain a declared-but-unread schema field — filed upstream (ts-libs).
- **Verification close-outs are gated (2026-10-03).** Rule `verification-block-carries-confidence-level` (`.spur/rules/structure/verification-confidence-level.yaml` + sidecar `verification-confidence-level.sh`, in `recommended-pre-check` via `extends: structure`) requires every `Verification (` block in a repo markdown document (CHANGELOG.md today; `docs/tasks`/`docs/features` evidence records excluded) to carry exactly one `Confidence: HIGH|MEDIUM|LOW` line inside that block, and refuses any `Confidence:` line outside the enum. Two mechanics worth remembering: the `exit-code` evaluator reports only the exit status (its `message` template is the actionable text, `{code}` only), so the file/line detail lives in the sidecar script the message points at; and a rule file dropped into a category directory joins that preset automatically (`extends: structure`) — no preset edit needed. Negative-tested both ways: deleting the line yields the block finding, `Confidence: SURE` yields the enum finding.

## 2026-10-04 — kk-daily-ai-voice 20261004 scheduler failure (root cause + fix)
- **Root cause: the ingest note's section headings survived `cleanBody`.** horizon/last30days bodies label sections as `**「背景」**`, `**「社区讨论」**`, `**「方案」**`, `**「背景：GCN 架构…」**`. `episode-plan-gen.cleanBody` stripped `### [title](url)` copies and `⭐️ x/10` ratings but not these, so the plan body kept them; `dailynews-gen` speaks the body as fact text, `splitFactText` chunked so a heading landed at a *segment start*, and the content gate (`validate-voicescript.ts` / `voice-gen` `CONTENT_SCENARIO…SCAFFOLD_LABEL_RE`) rejected the whole unattended run at the `script` state — 2026-10-03 (segment 14) and 2026-10-04 (segment 19). Fixed in `plugins/generations/episode-plan-gen/src/index.ts` (`SCAFFOLD_HEADING_RE`, line-leading `**「…」**` only, prose after the heading is kept). The article path was already covered by `daily-article-gen`'s `stripScaffold` (0138 D4) — the script path was the gap.
- **Second latent trap on the same path:** `dailynews-gen`'s `normalizeBroadcastText` ran `[:：] → '，'` over zh text, so any body URL became `https，//` / `wss，//` — precisely what `CONTENT_URL_MANGLE_RE` rejects, which would have failed another run. Now `/[:：](?!\/\/)/`. Both fixes red/green-verified by extending `apps/cli/tests/kk-daily-ai-voice-content-quality.test.ts` through the `daily-script` stage.
- **Which copy runs matters:** the scheduler shells `spur workflow run plugins/kk/workflows/kk-daily-ai-voice.yaml` with cwd = the checkout. `kk stage` executes the stage runner from the **installed** package (`~/.bun/bin/kk` → `/Users/robin/node_modules/@gobing-ai/knowledge-kit`, `apps/cli/src/stage.ts` checkout detection does not match an installed entry), but the stage's `kk executor run <plugin>` children inherit the checkout cwd, and the project `./plugins` root shadows the builtin tree (ADR-012) — so plugin fixes in the checkout take effect with **no reinstall**, while stage-runner (`kk-workflow-stages.ts`) edits do not. Verified with `kk executor run episode-plan-gen` from the checkout.
- **Recovery of a stalled same-day run needs the plan artifacts quarantined**, not just a re-run: `daily-plan` caches on `_03_plan_plan.json`, `daily-qc-content` on `_04_…_candidates.json`, and both were written from the pre-fix body — move `21-plan/*_03_plan_*.json` + `21-plan/*_04_quality-control-content_*.json` aside, then re-run the workflow (article/cover caches stay valid; the agent prose article never carried the headings).
- **20261004 recovery attempts stopped at the safety gate (3 runs, 15:55–16:08).** After the `script` fix landed, three consecutive runs (unchanged drafts twice, then judge-prescribed edits: internal-ID footer note removed, Google News aggregation citation dropped from body+references, audio-only over-claim 「不可动摇的铁律…必然会水涨船高」 restored to the source's 「几乎没有例外……必然会上涨」) all ended `failed` at `safety-judge` with `block`: verdict NEEDS_REVISION, scores 0.50 → 0.575 → 0.775 (pass_threshold 0.85), **no must-pass fail** in any round. So the fixes were credited but the gate cannot clear while three gaps stay open: (1) Apple §1.11 metadata-level AI disclosure (episode description + show metadata) is unverifiable **at gate time** — the publish metadata does not exist yet, a structural ordering friction for every unattended run; (2) xiaoyuzhou's 5-item「【标题】+摘要」news-brief form needs an official-text answer or an explicit 栏目自述; (3) WeChat AI-declaration entry must be checked at publish time. Two judge-side defects worth fixing: the verdict reports `request_digest_verified=false` because the request carries only the composite digest without its recipe (gate = sha256 over `article_content.json` + NUL + `voicescript.yaml` + NUL; the judge recomputed per-file sha256 and declared a mismatch, which drags `confidence` to LOW), and the safety gate runs **before** the metadata it demands exists. Also: the article-write prompt itself instructs the agent to append the reader-visible「注：N 条条目因选题边界未写入：<hash>」note (and script-write reads that note to build `excluded`) — the judge flags it as CN-platform admission risk plus internal-ID leakage; the exclusion record belongs in the run artifacts, not the published copy.
- Consequence: a non-PASS verdict blocks **regardless** of the report's `escalate: true`, so there is no engine path to publish that day's episode once the judge withholds PASS — the only routes are editing the drafts and re-reviewing, or publishing outside the gate by hand (the 20261002 hand-tail caveat applies: locale/XHS/WeChat get skipped).
- **20261004 hand-driven publish tail (operator-authorized, 17:00–17:16).** After the gate blocked, the episode shipped by replicating the engine's own commands: `daily-wrap-docs → daily-generate (gemini-tts, 17.1 min, QC 100/100) → daily-intro → daily-episode-duration → daily-quality-report` ran *through the engine* with `publish_enabled=false` (a non-publishing run skips the gate by design — the `script → wrap-docs` edge wins when `skip_review=true`), then the tail was hand-driven: a sign-off-recording replacement for `daily-publish-prep` (it refuses without a gate stamp; the replacement reproduces its payload and stamps ID3, writing `…_13_publish-operator-signoff.json` instead of fabricating a stamp) → `daily-publish-surfdash` → show notes via `kk executor run podcast-pub` on a plan filtered by the script-write plan's `excluded` ids (the article's reader-facing 未写入 note is what used to drive that filter — removing the note for the judge finding broke the filter, so pass a filtered plan) → `daily-publish-podcast` → `daily-translate-localize` → hand translation of the en/ja drafts → `daily-translate-sync` → `daily-patch-surfdash` **with a plugins-path** (without it the EmDash CMS re-sync is skipped and the CMS card keeps the unstyled `./assets/cover.png` — the workflow's default `plugins_path: ""` means the *daily job never runs that re-sync*; it also needs a second invocation to heal since the plugin writes the skip marker first) → `daily-publish-xhs` (refused: creator-console session expired — login is operator-only) → `daily-publish-wechat` (draft saved) → `daily-publish-classify` → `daily-run-report`. Published: zh/en/ja posts (the site serves English at the root, `/zh/…` and `/ja/…` for the others), podcast episode, WeChat draft; XHS cards rendered but unpublished. `daily-publish-classify`'s completeness report names every independent channel, which is what made the remaining gap (xhs) visible instead of silent.

## 2026-10-06 — the anti-hallucination response guard (why "Add verification for: confidence level")
`Add verification for: confidence level (HIGH/MEDIUM/LOW)` is NOT a repo rule failure: it is the
reason string from the response guard, `verifyAntiHallucinationProtocol` at
/Users/robin/.agents/scripts/cc/anti-hallucination/validate_response.mjs:131 (installed as the Pi
stop hook at /Users/robin/.agents/scripts/cc/anti-hallucination/pi-stop.ts, fired on
`agent_before_settle`). It blocks a response that makes external claims but carries no
`Confidence: HIGH|MEDIUM|LOW` marker (CONFIDENCE_PATTERNS, validate_response.mjs:23-25) and/or no
source citation (SOURCE_PATTERNS, validate_response.mjs:12-22).

What triggers "external claims" (validate_response.mjs:88-98): a version shape (`v1.3.14`,
"version 1.2", any bare `1.2.3`), an `https://` URL, "recent change/release", "according to",
"documentation says"; or the weak path — an `api|library|framework|sdk|package|endpoint|documentation`
word in a sentence with `returns|supports|requires|defaults to|was added…` (lines 99-101).

Compliance, verified both ways with the guard itself:
  RESPONSE_TEXT="<text>" bun /Users/robin/.agents/scripts/cc/anti-hallucination/validate_response.mjs
  - claim + `path.ext:line` citation + `Confidence: HIGH` -> {"ok":true,"reason":"Task is complete"}
  - same text with the Confidence line removed -> {"ok":false,"reason":"Add verification for:
    confidence level (HIGH/MEDIUM/LOW)","issues":["confidence level (HIGH/MEDIUM/LOW)"]}
  - same text with the citations removed -> {"ok":false,"reason":"Add verification for: source
    citations for API/library claims"}

Rule of thumb: any reply that names a version, URL, or library/API behaviour ends with a
`Confidence: HIGH|MEDIUM|LOW` line plus at least one `path:line` / URL citation. This is the
response-side twin of the repo's own `.spur/rules/structure/verification-confidence-level.sh`, which
enforces the same enum on every `Verification (` block in documents (commit c2e9c960).

## 2026-10-07 runall-e93-481b (task 0215, E93 ADR-032)
- kk-core `PluginKindSchema` values: `ingestion` / `generator` / `publish` — collection dirs are `ingestions|generations|publishings`, but manifest `kind` for generators is `"generator"` (not `"generation"`). A wrong value = discovery `malformed` diagnostic = "unknown plugin" usage errors downstream.
- Spur rule `cli-no-parse-at-module-scope` bans `.parse(` (incl. JSON.parse) in `apps/cli/src/cli.ts` + `src/commands/*.ts` → parse JSON in `src/invoke.ts` (sanctioned seam) and export the helper; don't suppress.
- Bun `spawnSync` result `stdout`/`stderr` are typed nullable → `(proc.stdout ?? Buffer.alloc(0)).toString()`.
- `spur task record --transition testing` from `todo` is denied: walk `wip` first. Done gate blocks on any unchecked checklist box AND DD-09 subset rule — never author task AC rows like "`bun run gate` passes." that aren't feature scenarios; gate checks belong in pipeline checks, not AC.
- ADR-117 trace outage pattern: stale lib `inline-run.generated.mjs` vs task-pipeline v5 → run row never registered → terminal `--close` returns `RUN_NOT_FOUND` (sibling of `NO_ACTION_ROWS`). Document, never backfill.
- ADR-032 probe contract: probe prints ONE final JSON line `{status, profileDir?, detail}`; kk prints only that + exit mapping (0 verified / 1 refused / else error); raw probe stdio never echoed. 30s default probe timeout in `checkOne`.
- 0218: test-spawned `spur workflow run --dry-run` walks pass `--no-log` — the two-file run-record write contends under concurrent spur use (refine 5-8x); assertions unaffected (stdout JSON summary is the evidence).
- 0218: `spur task verdict --from-answer` answer schema: Req/AC statuses are MET|PARTIAL|UNMET (not PASS); AC ids must match full scenario titles; evidence types constrained (static-ref is NOT executable evidence — cite a command/test run instead).
- 0218: proof-input digest (`inline-run-setup --fingerprint`) scopes spec sections only — Review/Solution/Testing/status writes don't invalidate it; re-capture before record anyway.
