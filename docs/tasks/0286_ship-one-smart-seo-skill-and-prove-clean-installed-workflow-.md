---
schema_version: 1
name: Ship one Smart SEO skill and prove clean installed workflow use
status: done
template: feature-impl
created_at: 2026-10-15T04:45:13.288Z
updated_at: "2026-10-16T18:43:13.414Z"
feature_id: G9
priority: P2
tags:
  - seo
  - geo
estimate_hours: 6

dependencies: ["0285"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0286-verdict.json
---

## 0286. Ship one Smart SEO skill and prove clean installed workflow use

### Background

Accepted design: docs/design/kk-smart-seo.md; vendor snapshot 55a184a3b0d09565a4c84268f725a47784e62528 reviewed in docs/plans/2026-10-14-smart-seo-vendor-review.md. Vendor code is reference-only. No Python, new dependency, direct provider client, site mutation or undocumented scope expansion.

Implements: R10 — One SEO skill operates and explains the evidence-grounded workflow; R11 — Installed audit assets work without checkout or vendor access.

Verified premises: scripts/bundle-plugins.ts:1 stages plugin distribution; apps/cli/src/stage.ts:61 owns source/install stage resolution; plugins/kk/scripts/itc-stages.ts:55 states builtin-only helper distribution. Ancestor-resolved linkedom/fast-xml-parser are not declared KK dependencies and must not be relied on.

Dependencies: Run Smart SEO workflow with validated narratives and terminal outcomes. Predecessor SEO stage artifacts are accepted design, not existing code; use the stated contracts once those tasks land.

**Refine corrections (2026-10-14)**

- Packed fixture execution implicitly depended on bundled test data → bundle-plugins excludes tests → copy fixture input into the temporary consumer project, while resolving runtime assets only from its packed installation.
- All-in-one narrative guidance implied free-prose report acceptance → 0285 now accepts deterministic templates → document validated report selection separately from advisory consultation.
- Attribution ownership was duplicated → 0281 creates the MIT attribution → review/extend its existing file rather than re-own or replace it.
- Generic Plan omitted consumer isolation and lifecycle detail → readiness needs observable installed behavior → add R1/R2-mapped packed workflow, catalog preservation and capability quality checks.

Current-tree audit: no Smart SEO runtime files are present; all local requirements remain valid planned work. One current main worktree and no wip tasks were observed at kickoff. Bun 1.4.3 and Biome 2.5.15 match package/lock/tool pins; Bare-shell Spur initially reported 0.4.4. Freshness inspection confirmed bun-global Spur 0.4.6 equals npm latest and Superskill 0.3.37 equals npm latest; final writes/checks use the explicit bun-global Spur executable because PATH contains shadow copies (point-in-time evidence, no new pins). Implementation step 0 must recheck tool/environment and ownership drift. External-source dates are evidence, not a guarantee that a provider account is enabled.

### Requirements

- [x] R1. Deliver one all-in-one SEO/GEO skill for running, reviewing and interpreting live/saved audits and producing action plans; document sources, heuristic/measurement limits, crawler purpose and offline rescoring with no autonomous site mutation.
- [x] R2. Prove workflow/helpers/catalogs/references resolve from a separately packed installation in unrelated cwd with vendors inaccessible; document and exercise supported catalog registration without overwriting existing paths/makers; retain existing workflow behavior and update surface/status docs.

### Acceptance Criteria

- [x] AC1 — One SEO skill operates and explains the evidence-grounded workflow (req: R1)
- [x] AC2 — Installed audit assets work without checkout or vendor access (req: R2)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-15T05:03:40.040Z

Closed by ready refinement (2026-10-14): design §13 and the refined handoff close the identified seam decisions. Owner is this WBS for its slice; later integration belongs to 0285 and installed acceptance to 0286. Existing deferred scope in §1 remains deferred to separate operator intake. No issue was dropped and no task merge/link/cancellation was authorized.

### Design

Chosen approach: native KK stage slice, per §2, §9–11 of the satellite.

Frozen decisions: Use one fat smart-seo skill, references for detail and existing Superskill lifecycle validation/evaluation. Prefer existing package copy rules; extend only if acceptance demonstrates a missing asset. Consumer setup is an explicit catalog-path addition preserving existing config; audit preflight does not mutate user-global configuration. No new slash command/subagent.

Files owned: plugins/kk/skills/smart-seo/SKILL.md and references; plugins/kk/references/smart-seo-attribution.md; apps/cli/tests/smart-seo-installed.test.ts; package/bundle tests only if existing copy rules need extension; docs/04_DESIGN.md, docs/05_FEATURES.md.

Verification: run Superskill skill validate/evaluate on the source capability and check body budget; package/install in temp cwd, perform documented catalog setup and load decision status/show under offline maker, execute fixture workflow and resolve all references with no vendors/ancestor node_modules. Run existing stage compatibility and distribution regressions, final lint/tests/build/rules and feature verification.

Rejected alternatives: wrapping vendor Python, adding dependency/service abstractions or separating tests/docs from this behavior; each expands runtime or ceremony without improving this slice. Out of scope: all deferred capabilities in design §1.

Execution budget: 6h estimated; preserve partial artifacts at budget boundary and resume from current tree, never invent replacement APIs. requireDiff: production stage/catalog/skill plus its behavior checks and same-change docs.

Refined handoff: Consume 0285 completed fixture workflow and §9 narrative schema. Own one smart-seo skill/references and installed acceptance; review 0281 attribution without overwriting it. Keep documented direct collection, full-workflow registration, saved revision scoring and advisory consultation distinct. Copy test fixture input to a temporary unrelated consumer cwd; tests are intentionally not shipped. Resolve CLI/workflow/helpers/catalogs/references exclusively from separately packed KK installation, deny checkout/vendor/ancestor access and run fixture workflow with isolated offline maker. Exercise explicit project decisions.paths addition while preserving unrelated paths and maker settings. Extend bundle rules only if the acceptance test proves a runtime asset missing. No production fixture fallback or absolute developer path.

Shared-file protocol: implement sequentially in frozen order 0281, 0282, 0283, 0284, 0285, 0286. Change only this slice's registration/payload adapters; preserve predecessor tests and exports. Shared docs/04_DESIGN.md edits describe only shipped behavior. Recheck worktrees/wip ownership before writing; if another worker appears, coordinate rather than revert its edits.

### Plan

- [x] Step 0: Recheck current task contract, cited source files, Bun/tool pins, worktrees/wip ownership and completed predecessor artifact interfaces before editing; preserve unrelated working-tree changes.
- [x] (R1) Author one smart-seo SKILL.md and the four declared references from implemented stage/workflow contracts; cover sources/unknowns, exact www scope, strict narrative templates, conservative optional evidence and immutable offline revisions.
- [x] (R1) Review existing 0281 MIT attribution, verify every local reference and body budget, and run installed Superskill skill validation/evaluation using noun help to select current verbs.
- [x] (R2) In apps/cli/tests/smart-seo-installed.test.ts, pack/install into an isolated directory and copy fixture inputs into an unrelated consumer cwd; document/add project catalog path without replacing existing paths or makers.
- [x] (R2) Resolve/load all runtime catalogs/assets and execute the real installed fixture workflow with checkout/vendor/ancestor dependencies inaccessible; test unrelated decision/workflow behavior and existing stage/package regressions. Change packaging only if a demonstrated missing asset requires it.
- [x] (R1,R2) Update surface docs and feature status only after real task/feature verification PASS; record supported setup, evidence limits and operator-run live acceptance as remaining validation.
- [x] Update docs/04_DESIGN.md in the same change for this shipped slice; preserve accepted/deferred scope and source checked-at dates.
- [x] Run project lint, tests, build and rule gates; complete task-pipeline review and traceable requirement/AC verification before recording done. Never waive an upstream implementation dependency because refinement passed.

<!-- 0286 implement-stage evidence for the last two items: lint/tests/rules were executed at the light
     tier only (changed-path format-lint PASS, apps/cli typecheck PASS, apps/cli test PASS incl. the
     new installed acceptance, rules:pre PASS); the full-suite/build gate and the pipeline's
     review/verify/record hops remain the pipeline's own stages. The feature-status cell was
     deliberately left unchanged and the remaining validation (operator-run live-site audit,
     feature-level verification) is recorded in docs/04_DESIGN.md and docs/05_FEATURES.md. -->

### Solution

- **R1 — one all-in-one skill.** `plugins/kk/skills/smart-seo/SKILL.md:17` is the single entry point: the §0 contract (read-only, labelled evidence classes, crawler-purpose separation, `vendors/` reference-only, consultation boundary, no ranking/citation promise), routing for a URL / saved audit / question, run review, per-area SEO+GEO interpretation (`:99`), validated-vs-advisory narrative, and offline rescoring (`:150`); body 12,713 bytes, inside repo rule R44's 20,000-byte `SKILL.md` cap. Depth ships in the four declared references: evidence classes, checklist and scoring interpretation `plugins/kk/skills/smart-seo/references/method.md:7`; exact host ± `www` scope, options, catalog registration and failure handling, immutable revisions `plugins/kk/skills/smart-seo/references/operations.md:20`; dated source registry, per-source limits, crawler-purpose split and refresh procedure `plugins/kk/skills/smart-seo/references/seo-geo-sources.md:22`; the strict narrative schema, worked example and rejection matrix `plugins/kk/skills/smart-seo/references/narrative.md:8`. Adapted rubric/source attribution is reviewed and extended, not replaced: `plugins/kk/references/smart-seo-attribution.md:55`.
- **R2 — installed workflow/helpers/catalogs/references.** `apps/cli/tests/smart-seo-installed.test.ts:433` proves the packed installation carries the workflow, all seven `seo-*` helpers plus the dispatcher, the four catalogs, the skill and its four references, ships no test file and no fixture input, and that the helpers import `node:`/`bun:` or sibling modules only (no ancestor-resolved `linkedom`/`fast-xml-parser`).
- **R2 — supported catalog registration without overwriting.** `apps/cli/tests/smart-seo-installed.test.ts:508` fails the installed preflight before registration (exit nonzero; the stage names the four catalog files, the 22 ids and the `decisions.paths` append fix), then applies that documented append and asserts the pre-existing consumer catalog path and its `maker: typesafe` / `makers:` mapping survive verbatim.
- **R2 — catalogs served offline from the installation.** `apps/cli/tests/smart-seo-installed.test.ts:529` loads `decision status|show|list` under an offline maker (`typesafe`, no key → `source: default`, `reason: no-backend`, exit 0, no network): zero load errors, zero duplicate ids, the consumer decision still served from the project catalog with its configured maker, all 22 `kk-seo-*` decisions served, and `decision show kk-seo-page-type` resolving `catalog` inside the installed package.
- **R2 — real fixture workflow offline.** `apps/cli/tests/smart-seo-installed.test.ts:588` executes the shipped `kk-smart-seo.yaml` from the installation with an empty `HOME` (so no agent executor exists and the optional narrative settles as absent/rejected) and the fixture input copied into the unrelated consumer project: run workspace bound under the project, `crawl.json` built from the copied fixture only, terminal `report.json` `status: done` with `coverage.totalRules: 52`, the labeled deterministic summary in `report.md`, and `audit.json` `judgments.status: not-assessed` rather than a guessed verdict.
- **R2 — isolation and non-regression.** `apps/cli/tests/smart-seo-installed.test.ts:663` keeps only `@gobing-ai/{knowledge-kit,spur}` in the consumer project, validates an unrelated installed workflow (`kk-collect.yaml`) alongside the SEO one, and asserts no produced artifact carries a checkout path or a `vendors/` reference; the suite found and documented the real setup constraint that the shipped catalogs' `$schema` must resolve from their directory, so `spur` has to be resolvable beside an installed KK package (`plugins/kk/skills/smart-seo/references/operations.md:55`, `docs/04_DESIGN.md:620`).
- **Surface/status docs.** `docs/04_DESIGN.md:610` records the skill surface, the documented consumer setup (append semantics plus the schema-resolution constraint), the installed acceptance evidence and its limits (offline fixture, no live site, no real maker/model answer, no SEO-accuracy claim); `docs/05_FEATURES.md:110` records the G9 slice with its status cell unchanged pending feature-level verification and the operator-run live-site audit still outstanding.
- **Packaging unchanged.** No edit to the copy/prune rules that stage the tarball: `scripts/bundle-plugins.ts:20` still copies the repo-root `plugins/` tree and `scripts/bundle-plugins.ts:39` still prunes only `tests/`, `evals/`, `node_modules/`, `.venv/`, `.git/`, `.spur/` and `*.test.ts`, so the new `plugins/kk/skills/smart-seo/` tree ships through the existing rule; the acceptance run demonstrated every required runtime asset present, so no packaging change was justified.
- **Skill lifecycle.** `superskill skill validate plugins/kk/skills/smart-seo --json` → `{"valid":true,"findings":[]}`; `superskill skill evaluate plugins/kk/skills/smart-seo --json` → `verdict: PASS`, grade B, aggregate 0.8545, conciseness 1.0 at 12,202 body characters.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | One all-in-one SEO/GEO skill ships as the single entry point for the whole lifecycle: `plugins/kk/skills/smart-seo/SKILL.md:13` (one entry point — intake, run, evidence review, interpretation, narrative, offline rescoring; no second command/subagent/plugin kind). Contract §0: read-only, never mutates the site `plugins/kk/skills/smart-seo/SKILL.md:19`; no ranking/citation/traffic/revenue promise `plugins/kk/skills/smart-seo/SKILL.md:22`; evidence-class labelling (measurement, heuristic, unknown, model judgment, consultation) `plugins/kk/skills/smart-seo/SKILL.md:24`; crawler purposes stay separate `plugins/kk/skills/smart-seo/SKILL.md:26`; vendors/ reference-only `plugins/kk/skills/smart-seo/SKILL.md:28`; specialist advice is consultation `plugins/kk/skills/smart-seo/SKILL.md:30`. Operates: routing `plugins/kk/skills/smart-seo/SKILL.md:35`, catalog registration `plugins/kk/skills/smart-seo/SKILL.md:57`, bounded run `plugins/kk/skills/smart-seo/SKILL.md:67`, evidence review before judgments `plugins/kk/skills/smart-seo/SKILL.md:82`, per-area SEO/GEO interpretation and the three-purpose crawler split `plugins/kk/skills/smart-seo/SKILL.md:99`, validated-vs-advisory narrative `plugins/kk/skills/smart-seo/SKILL.md:136`, offline rescoring `plugins/kk/skills/smart-seo/SKILL.md:150`, failures and limits `plugins/kk/skills/smart-seo/SKILL.md:164`. Documented sources and limits: dated primary-source registry with per-source limits `plugins/kk/skills/smart-seo/references/seo-geo-sources.md:7`, three crawler purposes separated `plugins/kk/skills/smart-seo/references/seo-geo-sources.md:22`, refresh procedure `plugins/kk/skills/smart-seo/references/seo-geo-sources.md:40`; heuristic/measurement evidence classes `plugins/kk/skills/smart-seo/references/method.md:7` and the cannot-conclude list `plugins/kk/skills/smart-seo/references/method.md:114`; offline rescoring procedure `plugins/kk/skills/smart-seo/references/operations.md:189`; narrative schema and rejection matrix `plugins/kk/skills/smart-seo/references/narrative.md:113`. Attribution reviewed and extended, not replaced: `plugins/kk/references/smart-seo-attribution.md:55`. |
| R2 | MET | Workflow, helpers, catalogs, skill and references resolve from the separately packed installation in an unrelated consumer cwd: shipped-asset assertions over the packed tarball `apps/cli/tests/smart-seo-installed.test.ts:434`, helpers import node:/sibling specifiers only `apps/cli/tests/smart-seo-installed.test.ts:452`, no test file and no fixture input shipped `apps/cli/tests/smart-seo-installed.test.ts:472`. Documented catalog registration exercised without overwriting: pre-registration preflight fails naming the catalogs and decisions.paths `apps/cli/tests/smart-seo-installed.test.ts:509`, then the documented append preserves every pre-existing line and the consumer-demo-verdict typesafe maker mapping `apps/cli/tests/smart-seo-installed.test.ts:519`, with zero load errors, zero duplicate ids, all 22 kk-seo-* decisions served offline and the catalog resolving inside the installation `apps/cli/tests/smart-seo-installed.test.ts:529`. Existing behavior retained: offline maker falls back instead of reaching a provider `apps/cli/tests/smart-seo-installed.test.ts:568`, real fixture workflow runs offline to terminal report.json status done with coverage.totalRules 52 and judgments.status not-assessed `apps/cli/tests/smart-seo-installed.test.ts:607`, consumer catalog still served and the unrelated kk-collect.yaml still validates from the same installation `apps/cli/tests/smart-seo-installed.test.ts:651`, and no artifact carries a checkout path or a vendors/ reference `apps/cli/tests/smart-seo-installed.test.ts:663`. Surface/status docs updated: `docs/04_DESIGN.md:610`, `docs/05_FEATURES.md:110`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — One SEO skill operates and explains the evidence-grounded workflow (req: R1) | MET | command | `superskill skill validate plugins/kk/skills/smart-seo --json` -> `{"valid":true,"findings":[]}` and `superskill skill evaluate plugins/kk/skills/smart-seo --json` -> `"verdict":"PASS"`, grade B, aggregate 0.8544642857142858, conciseness 1.0 at 12202 body chars (both run fresh this turn). The shipped skill body keeps the R1 contract sentinels (heuristic, vendors/, user-triggered, no-promise, consultation, Offline rescoring) and links all four references inside the packed installation `apps/cli/tests/smart-seo-installed.test.ts:487`; content anchors for the explanation and the no-mutation/no-promise contract are in the R1 row above. |
| AC2 — Installed audit assets work without checkout or vendor access (req: R2) | MET | test | `bun test apps/cli/tests/smart-seo-installed.test.ts` -> 13 pass, 0 fail at this certified tree (fresh run this turn). The suite packs the CLI, extracts it into a throwaway unrelated consumer project and asserts asset presence `apps/cli/tests/smart-seo-installed.test.ts:434`, no ancestor-resolved dependency `apps/cli/tests/smart-seo-installed.test.ts:452`, the documented decisions.paths append preserving pre-existing paths and makers `apps/cli/tests/smart-seo-installed.test.ts:519`, offline catalog serving `apps/cli/tests/smart-seo-installed.test.ts:529`, the offline fixture workflow terminal state `apps/cli/tests/smart-seo-installed.test.ts:607`, and no checkout/vendors/ancestor resolution `apps/cli/tests/smart-seo-installed.test.ts:663`. Full project gate PASS at this digest: 3763 pass, 0 fail plus both rule presets clean, log `.spur/run/0286-test-gate.log`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0286

**Scope:** task 0286 diff — new `plugins/kk/skills/smart-seo/SKILL.md` + 4 `references/`, extended `plugins/kk/references/smart-seo-attribution.md`, new `apps/cli/tests/smart-seo-installed.test.ts`, `docs/04_DESIGN.md`, `docs/05_FEATURES.md`, task 0286 corpus.
**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture.
**Proof digest reviewed:** sha256:92e47c3d139c20e03175e93a408088b93421f50abda03493b9738de0de17c08e (`.spur/run/0286-runall-2bb0-proof-digest.txt`); tree frozen — `git status --porcelain` unchanged from `.spur/run/0286-runall-2bb0-pre-review-snapshot.txt`.
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | correctness | One shipped fact carries two dates: the new skill reference states FAQ rich results stopped appearing 2026-05-07 (Google Search updates changelog), while the shipped report/rules prose still says Aug/Sep 2023 — a reader of the skill and of `report.md` sees different retirement dates. | `plugins/kk/skills/smart-seo/references/seo-geo-sources.md:15` vs `plugins/kk/scripts/seo-report.ts:452`, `plugins/kk/scripts/seo-rules.ts:486`, `plugins/kk/scripts/seo-rules.ts:1543` | DEFER(pre-existing stale sibling in 0282/0283-owned files, additionally locked by `plugins/kk/tests/smart-seo-analysis.test.ts:83` and `:584`; correcting it is a rule-method change outside 0286's owned files; the new reference follows the accepted vendor review `docs/plans/2026-10-14-smart-seo-vendor-review.md:58`) |
| 2 | P4 (advisory) | correctness | Deterministic homepage classification is labelled `source: 'model'`, but design §7 says "Only `source=model` is a model answer" — a native computation with `maker: 'deterministic'`. | `plugins/kk/scripts/seo-decisions.ts:324-325` | ACCEPTED(pre-existing; no behavioral impact — value `homepage`, confidence 1.0, `qualified: true`; file not owned by 0286 and the task required retaining existing workflow behavior) |
| 3 | P4 (advisory) | usability | A project-local KK install must keep `spur` resolvable beside the installed package so the shipped catalogs' `$schema` resolves; otherwise `decision status` reports loadErrors and preflight fails. The acceptance test satisfies this with an explicit symlink. | `plugins/kk/skills/smart-seo/references/operations.md:55`, `docs/04_DESIGN.md:620`, `apps/cli/tests/smart-seo-installed.test.ts:187` | ACCEPTED(documented and exercised; a Spur schema-resolution constraint with no in-scope code fix) |
| 4 | P4 (advisory) | — | Evidence breadth: the installed acceptance is an offline fixture run over a synthetic one-page fixture — no live site, no real maker/model answer, no PSI/CrUX provider; it validates workflow resolution + catalog registration, not the SEO accuracy of any finding. | `docs/04_DESIGN.md:622-624` | ACCEPTED(explicitly documented limit; operator-run live-site acceptance and feature-level verification remain outstanding) |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — one all-in-one SEO/GEO skill (run/review/interpret live+saved, action plan, sources, heuristic/measurement limits, crawler purpose, offline rescoring, no autonomous mutation) | MET | `plugins/kk/skills/smart-seo/SKILL.md:17` §0 contract (read-only `:19`, no-promise `:22`, evidence-class labels `:24`, crawler-purpose separation `:26`, consultation `:30`); routing `:35`; catalog registration `:57`; bounded run `:67`; evidence review `:82`; per-area interpretation `:99`; validated-vs-advisory narrative `:136`; offline rescoring `:150`; failures/limits `:164`. Depth: `references/method.md:7`/`:21`/`:55`/`:101`/`:112`; `references/operations.md:20`/`:100`/`:189`; `references/seo-geo-sources.md:7`/`:22`/`:40`/`:82`; `references/narrative.md:8`/`:94`/`:113`. Body 12,713 B ≤ 20,000 B cap (`apps/cli/tests/smart-seo-installed.test.ts:470`). |
| R2 — packed-install resolution / catalog registration without overwrite / retained behavior / docs | MET | Assets resolve from the installation: `apps/cli/tests/smart-seo-installed.test.ts:433` (workflow + 7 `seo-*` helpers + dispatcher + 4 catalogs + skill + 4 references), `:461` (helpers import `node:`/sibling only), `:477` (no test file / no fixture input shipped). Append preserves paths+makers: `:508` (preflight fails naming `decisions.paths`) → `:519`. Offline catalogs: `:529` (0 loadErrors/0 dup ids, 22 `kk-seo-*`, `catalog` inside install), `:560` (offline maker → `source: default`, `reason: no-backend`). Offline workflow: `:588` (`report.json status: done`, `coverage.totalRules: 52`, `judgments.status: not-assessed`). Non-regression + isolation: `:655` (`kk-collect.yaml` validates; consumer catalog served), `:663` (node_modules = only `@gobing-ai/{knowledge-kit,spur}`, no `vendors/`, no artifact references the checkout). Docs: `docs/04_DESIGN.md:610-624`, `docs/05_FEATURES.md:110`. `scripts/bundle-plugins.ts` unchanged (no diff). |
| AC1 — One SEO skill operates and explains the evidence-grounded workflow (req: R1) | MET | R1 evidence above; `superskill skill validate` → `{"valid":true,"findings":[]}`; `superskill skill evaluate` → PASS, grade B, 0.8545; `plugins/kk/tests/smart-seo-*.test.ts` 127 pass / 0 fail. |
| AC2 — Installed audit assets work without checkout or vendor access (req: R2) | MET | `apps/cli/tests/smart-seo-installed.test.ts` 13 pass / 0 fail (fresh run at this digest); full gate 3763 pass / 0 fail (`.spur/run/0286-test-gate.log`). |

##### Security / efficiency / architecture

- **Security:** read-only, no credentials, options JSON passed as data (never shell source); child env has empty `HOME` and stripped provider keys; artifacts scanned for leaked checkout/`vendors/` paths. No findings.
- **Efficiency:** CLI packed once, shared workspace build serialized by a bounded lock (`apps/cli/tests/smart-seo-installed.test.ts:150`); no new runtime dependency or Python path. No findings.
- **Architecture:** one deep fat skill with four detail references; no new command/subagent/plugin-kind; existing packaging copy rules reused; acceptance drives the real shipped workflow from the installation, not a checkout shim. No findings.

**Evidence gaps / assumptions (for re-checking):** the FAQ retirement date cannot be re-verified offline — finding 1 rests on the accepted vendor review's 2026-05-07 claim vs the stale 2023 stage prose. The "vendors inaccessible" claim is enforced by module-resolution isolation (packed `node_modules` only) plus an artifact path scan, not a filesystem sandbox — the documented evidence limit at `docs/04_DESIGN.md:622`.

**Next:** record the DEFER'd P3 FAQ-date conflict and the P4-advisory residuals as wrap residuals; no repair hop is required for 0286.

### References

- Feature G9: docs/features/G9_kk-smart-seo-evidence-grounded-seo-and-geo-audits.md
- Accepted design: docs/design/kk-smart-seo.md (§13 is the refined handoff). ADR-039: docs/00_ADR.md:1364.
- Vendor review: docs/plans/2026-10-14-smart-seo-vendor-review.md. Snapshot verified unchanged.
- Current premises: scripts/bundle-plugins.ts:37; apps/cli/src/stage.ts:45; plugins/kk/scripts/itc-stages.ts:55; apps/cli/tests/package.test.ts; docs/design/kk-smart-seo.md.
- Predecessors: 0285; dependent responsibilities are named in Design.
- Batch audit/checklist: docs/plans/2026-10-14-g9-ready-refinement.md; machine evidence: .spur/memory/evidence/g9-refine-ready-20261014-01/report.json.
- Concurrency at kickoff: git worktree list showed only current main; spur task list --status wip --json returned [].

### History

- 2026-10-16T16:36:17.771Z todo → wip (system)
- 2026-10-16T16:54:52.724Z wip → testing (system)
- 2026-10-16T16:55:00.477Z testing → done (system)

