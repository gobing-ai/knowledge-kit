---
schema_version: 1
name: Review and migrate compatible CLI and browser session callers
status: done
template: feature-impl
created_at: 2026-10-13T22:24:49.083Z
updated_at: "2026-10-14T08:25:46.821Z"
feature_id: A22
priority: P1
tags:
  - cli
  - browser-session
estimate_hours: 4

dependencies: ["0275", "0276", "0277"]
ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0278-verdict.json
---

## 0278. Review and migrate compatible CLI and browser session callers

### Background

Feature A22. Implements: R8 — Implementation tasks precede evidence-based caller migration; R1 — Canonical operations have exactly two command words; R2 — Existing command routes preserve their contracts; R7 — Shared browser behavior and plugin readiness remain compatible. Design authority: docs/design/kk-noun-verb-bots.md; ADR-037/038. Implement only this deliverable. Use Bun and existing workspace seams; no new runtime or package. Keep docs/04_DESIGN.md and affected authority/derived docs synchronized in the implementation change. Do not edit .github/workflows. Run bun run lint, bun run test, bun run build and affected Spur rules before implementation completion. Preserve partial evidence if the working budget is reached; do not widen scope or manufacture source edits.

**Refine corrections (2026-10-13)**
- Caller review claimed whole CLI and session scenarios → it only consumes verified upstream contracts → assign only feature R8 and define dependency outputs.
- Comprehensive inventory could sweep historical evidence into migration → historical tasks/ADRs/verdicts must retain past truth → distinguish active recipes and forbid mass historical rewrites.
- Bot open was a possible replacement for every browser call → publisher callbacks need in-process contexts → freeze replaceable/shared-helper/retained categories with concrete equivalence tests.
- Browser/podcast support was open-ended → current Xiaoyuzhou connector is absent and microfeed is API → require measured classification and no new transport in this review.

Out of scope: implementing other A22 tasks, changing publishing operations, adding a plugin kind/runtime, credential export, server logout, arbitrary caller rewrites, or changes to .github/workflows. Authority: ADR-037/038 and docs/design/kk-noun-verb-bots.md. All changes use the project Bun/Biome conventions and CLI-gated corpus writes. Shared task checks now use Scenario AC with task requirement bindings; feature titles remain stable. No implementation success is claimed by this refinement.

### Requirements

- [x] R1. After 0275/0276/0277 complete, freeze a file-level inventory of command, profile/session and browser-launch callers across apps, packages, plugins, product workflows, docs, tests and package scripts; record actual supported transports instead of assuming a channel connector exists.
- [x] R2. Write docs/reviews/2026-10-13-A22-cli-browser-caller-migration.md with each candidate classified replaceable CLI entry, shared-helper reuse or retained specialized path, its evidence and associated regression test. Migrate only behavior-equivalent operator recipes and stage/lock invocations.
- [x] R3. Retain publishing contexts, read-only preflights, WeChat restoration, environment overrides, X API posts and microfeed API transport unless equivalent reuse is proven. Xiaoyuzhou generic login does not imply a publisher adapter. A report-only outcome is valid when all remaining candidates need specialized paths.
- [x] R4. For each replaced caller verify argv/output/exit/scope behavior at the layer that executes it, validate affected Spur workflow YAML and capability files using their existing owner tools, and run required repository checks without initiating a real publish.
- [x] R5. Synchronize affected surface/design/workflow docs and canonical examples, keeping historical task/verdict/ADR records intact. Record retained paths, unsupported connectors and live-unverified limitations; update lifecycle/status only through Spur with actual implementation evidence.

### Acceptance Criteria

```gherkin
Feature: Review and migrate compatible CLI and browser session callers

  Scenario: AC1 — R8 — Implementation tasks precede evidence-based caller migration (req: R1; R2; R3; R4; R5)
    Given the canonical surface design and bot lifecycle implementation tasks
    When the dependent caller review executes after the bot tasks
    Then it inventories workflows, scripts, skills, docs, tests and publisher session entry points
    And it records each candidate as replaceable, shared-helper reuse or retained with a concrete reason
    And compatible operator entry points use canonical commands with regression evidence
    And publishing flows keep their existing session, readiness and error semantics
    And all tasks are linked to this feature with explicit dependencies and verification plans

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-13T22:41:27.592Z

The deliverable is a complete inventory plus supported migration, not a compulsory rewrite. Historical evidence and custom external-profile recipes remain unchanged unless explicitly applicable. API transports and long-lived publishing contexts remain specialized. Only R8 is owned here; earlier task contracts are consumed, not reimplemented.

### Design

Depends on 0275's canonical stage/lock + alias routes, 0276's generic lifecycle/lease/metadata, and 0277's channel adapters/state behavior. They must be implemented and verified before this task executes; refinement does not execute them. This task owns only the inventory/report and justified caller changes, never the upstream API or session algorithms. Keep feature R8 as its scenario; remove R1/R2/R7 duplicate whole-implementation claims because this task consumes those contracts rather than implements them.

Freeze candidate roots with rg across apps/cli, apps/board, packages, plugins/kk/workflows, plugins/kk/scripts, plugins/kk/skills, plugins/kk/commands, plugins/publishings, docs/design and active operator docs. Include shipped workflow definitions and any project-local .spur/workflows overrides that actually reference kk; distinguish local ignored operator artifacts from committed product files. Include resolveBrowserProfileDir/resolveChannelProfileDir, kkBrowserLauncher/openPersistentBrowser/loginWithProfile/withProfilePage, profile-check invocation, kk stage, kk store lock and old hidden aliases. Deduplicate by file:line and call site; counts are measured at execution time, never copied from this planning snapshot.

Matrix columns: file:line, current call/transport, category, selected replacement or retained reason, regression evidence, action status. Preserve historical docs/tasks and ADR entries: they are evidence, not stale recipes to mass-rewrite. In-process publish flows keep their callback/context lifetimes; bot open is an interactive operator process, not a publish helper. Use shared-harness helper reuse only when site readiness, errors and ownership semantics remain intact. Do not migrate customized external profile locations to fixed bot paths without explicit equivalence; retain them with a reason. Unsupported/custom-domain adapter cases remain generic or specialized, never silently site-verified.

Regression observations: workflow argv changes in existing workflow/stage tests; operator recipes via docs tests or a local non-publishing example; shared-helper caller changes through their channel/launcher tests. Run capability validation only on changed skill/command files using Superskill noun validation after checking current noun help; do not invoke an agent-generation workflow. Workflow YAML changes use Spur validation. Report-only requireDiff=false; scoped caller migrations requireDiff=true. Save report even if a candidate cannot safely change; no invented source diff to satisfy a tool. Existing four-hour estimate is a bounded sweep; persist unprocessed candidates honestly at its boundary rather than calling an incomplete review comprehensive.

Scope: report plus compatible caller patches/associated tests/docs. No new CLI, browser transport or ownership layer. No real publishing or .github/workflows edits. Leave a completed inventory with explicit retained reasons and implementation evidence for feature closure.

Concurrency: no WIP tasks were returned in the current tree. A separate worktree /Users/robin/xprojects/knowledge-kit-dev-runall-0269-0270-0272-43ce exists for earlier channel work; unrelated WeChat .probe-0272*.ts files are present here. Do not edit/revert their work. Re-read affected channel files and the current task corpus at implementation start; if landed channel fixes change an assumption, retain the public contract and update this task through Spur. Generated apps/cli/dist is not evidence of current source behavior: rebuild before packaged smoke checks. Bun 1.4.3, Playwright 1.55.0 and ts-browser-automation 0.5.24 match the installed packages and bun.lock. Prior repository lint was blocked by unrelated probe formatting/import errors, so do not claim a green baseline; report any remaining outside-scope findings.

Verified source premises: apps/cli/src/stage.ts:13; plugins/kk/workflows/kk-collect.yaml:79; plugins/publishings/wechatmp-pub/src/index.ts:73; plugins/publishings/podcast-pub/src/index.ts:58; AGENTS.md:26.

### Plan

- [x] 1. Read verified upstream implementations/task evidence and current concurrent worktree state; freeze candidate inventory and transport classification before any edit.
- [x] 2. Write the durable migration matrix and decide every candidate from actual semantics; distinguish active recipes from historical evidence and operator-local overrides.
- [x] 3. Migrate compatible stage/lock recipes and operator browser session entry points, or reuse proven shared helpers; retain specialized/API paths with concrete reasons. Never replace an in-process publish context with bot open.
- [x] 4. Update relevant existing workflow/stage/channel/docs tests for changed callers, validate affected workflow/capability artifacts, and run required lint/test/build/constraint checks. Do not trigger live publishing.
- [x] 5. Sync changed docs/status through authority/Spur, finalize every matrix row with regression evidence or retained rationale, and report counts plus real remaining limitations.

### Solution

Task 0278 freezes a measured caller inventory, classifies every active candidate against the canonical surface shipped by 0275/0276/0277, and migrates only the invocations whose behaviour is provably equivalent. Measured at execution time, not copied from the planning snapshot.

**Deliverable A/B — inventory + matrix**

- `docs/reviews/2026-10-13-A22-cli-browser-caller-migration.md` — new review artifact: `## Measured inventory`, `## Supported transports per channel (measured, not assumed)`, `## Migration matrix` with the six columns `file:line | current call/transport | category | selected replacement or retained reason | regression evidence | action status`, then `## Verification` and `## Report-only vs migration decision`.
- Counts measured with `rg` over `apps/cli`, `apps/board`, `packages`, `plugins/kk/{workflows,scripts,skills,commands}`, `plugins/publishings`, `docs/design` and `.spur/workflows`, each row re-auditable from the command recorded in the report: 217 browser/session seam occurrences overall, 148 lines across 38 files in product source (no tests/`dist/`/build-staging), 84 of those lines across 21 files in the publisher plugins, 21 `profile-check` references across 10 doc/recipe files (10 recipe spellings), 65 committed `kk stage <stage>` invocations, and 3 `kk store lock` invocations now migrated. No product pipeline calls the hidden `kk invoke`/`fanin`/`fanout`/`plugin list|doctor`/`plugins *` aliases; the two example workflows do (`plugins/kk/workflows/leftover-publish-fanout-example.yaml:26` executes `kk fanout`), and stay on the retained route by ADR-037. `.spur/workflows` is a symlink onto `plugins/kk/workflows`, so there are no separate ignored operator copies to reconcile; `apps/cli/plugins/` is a gitignored build-staging copy of `plugins/` and is excluded from every count.

**Deliverable C — the one behaviour-equivalent migration**

- `plugins/kk/workflows/kk-collect.yaml:79` — `kk store lock acquire --name collect --run … --ttl …` → `kk lock acquire …`; `:176` and `:187` (the normal and failed-run release paths) → `kk lock release …`. Both spellings reach the same registrar and the same SQLite engine (`apps/cli/src/commands/lock.ts:100`), so argv, stdout contract (`{"acquired":true}` / `{"skipped":"locked","holder":…}`), exit semantics and lock scope are unchanged; the run's `lock.json`, `.skip` marker and `release-failed` routing are untouched.
- `docs/04_DESIGN.md:1518` — T3 sync of the kk-collect workflow row (`kk store lock acquire|release` → `kk lock acquire|release`). The authority lines that document `kk store lock` as the retained hidden route are left standing, so `apps/cli/tests/store-docs.test.ts`'s `'store lock'` assertion still holds.

**Retained, with reasons (no rewrite)**

- 65 `kk stage <stage>` workflow invocations — behaviour-identical through `normalizeStageArgs`, the legacy spelling is a permanent hidden route (ADR-037, no alias sunset) and ~40 workflow-shape assertions pin it; migrating is cosmetic churn with zero behaviour gain.
- The seven publisher `withProfilePage`/`openPersistentBrowser` sites — in-process publish callbacks need their context lifetime; `kk bot open` is an interactive operator process and must never replace them.
- WeChat `storage-state.json` capture/restore plus the `WECHATMP_PROFILE_DIR` override — special state and a customized profile location with no fixed-bot-path equivalence.
- XHS check and publish visit accounting — bot `open` is an uncapped operator session, so it cannot stand in for a publish helper.
- podcast-pub (microfeed API), X `post` (API v2), and the qiita/medium/emdash/surfdash/threads/zenn `file-cli` transports — no browser session exists to migrate.
- `profile-check.ts login|check` recipes and `kk plugin login` — channel readiness/state with plugin-name semantics, not a bot-open alias.
- Historical design docs (`kk-collect-and-daily-voice2.md:66,188,192`, `kk-cli-surface.md`), tasks, verdicts and ADR-037/038 entries — evidence, deliberately not mass-rewritten.

**Evidence**

- `spur workflow validate plugins/kk/workflows/kk-collect.yaml` → `{"ok":true,"valid":true}`; `spur workflow show` renders `kk lock release` in both release paths.
- `bun test apps/cli/tests/commands/lock.test.ts apps/cli/tests/store-docs.test.ts` → 13 pass / 0 fail; `bun test apps/cli/tests/kk-collect.test.ts` → 6 pass / 0 fail (runs the migrated workflow end to end through the real `kk` shim).
- `bun run lint` clean (483 files, all typechecks), `bun run build` exit 0, `spur rule run --preset recommended-pre-check --fail-on warning` → 59 rules pass.
- No real publish, no live browser session and no write to the real `~/.config/kk` profile root was performed; live channel behaviour stays unverified by design.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | The frozen inventory was measured at execution time and is now fully re-auditable: `docs/reviews/2026-10-13-A22-cli-browser-caller-migration.md` (Measured inventory) carries a derivation table giving the exact command and value for every count (217 browser/session seam occurrences overall; 148 lines across 38 files in product source after excluding tests, `dist/` and the gitignored `apps/cli/plugins/` build-staging copy; 84 of those lines across 21 files inside the publisher plugins; 21 `profile-check` references across 10 doc/recipe files, 10 of them recipe spellings; 65 `kk stage <stage>` invocations; 3 lock invocations). The matrix at `:71` classifies every candidate. The reviewer re-ran the sweeps independently, reproduced the per-file `kk stage` split and confirmed `.spur/workflows` is a symlink onto `plugins/kk/workflows`, so no ignored operator copy was left unreviewed. |
| R2 | MET | Every matrix row carries a category, a replacement-or-retained reason, regression evidence and an action status. The only migration — `plugins/kk/workflows/kk-collect.yaml:79` (`kk lock acquire`) and `:176`/`:187` (`kk lock release`, normal and failed-run paths) — is behaviour-equivalent at the engine layer: `apps/cli/src/commands/lock.ts:105` registers the pair once for both the canonical `kk lock` group and the hidden legacy `kk store lock` route (`apps/cli/src/commands/store.ts:33`), so argv mapping, the `{"acquired":true}` / `{"skipped":"locked","holder":…}` stdout contract, exit semantics and lock scope are identical; the workflow's `lock.json` redirect, `.skip` routing and `release-failed` `onError: continue` path are untouched. `spur workflow validate plugins/kk/workflows/kk-collect.yaml` is valid and `spur workflow show` renders `kk lock release` in both release states; no `kk store lock` invocation remains in any product workflow. |
| R3 | MET | Retained paths are justified rather than convenient, and the report states plainly that no further migration was justified. No publisher source file is modified: WeChat keeps its `storage-state.json` capture/restore and the customized profile location (`plugins/publishings/wechatmp-pub/src/index.ts:271`), XHS keeps its check/publish visit accounting, and the API transports (podcast microfeed, X `post` API v2, the file-cli channels) have no browser session to migrate. No in-process publish callback was replaced by interactive `kk bot open`, and no Xiaoyuzhou publisher exists — a report-only outcome would have been legitimate for everything except the three lock invocations, which is exactly what the report concludes. |
| R4 | MET | Verification was re-executed rather than reported: `bun test apps/cli/tests/commands/lock.test.ts apps/cli/tests/store-docs.test.ts apps/cli/tests/kk-collect.test.ts` → 19 pass / 0 fail, and the kk-collect end-to-end case loads the migrated `plugins/kk/workflows/kk-collect.yaml` through a `kk` PATH shim built from this checkout's source, exercising acquire, skipped-locked, re-entrant and release paths plus the TTL. `spur workflow validate` reports the migrated workflow valid (`plugins/kk/workflows/kk-collect.yaml:79`); `bun run lint` exits 0 across all workspaces; `spur rule run --preset recommended-pre-check --fail-on warning` passes 59/59. No real publish, no live browser session and no write to the real `~/.config/kk` occurred — nothing in the diff can trigger one. |
| R5 | MET | Docs are synchronized without erasing history: the only documentation edits are `docs/04_DESIGN.md:1518` (the kk-collect workflow row now names `kk lock acquire`/`kk lock release`) and the new report itself. Historical design pages, tasks, verdicts and ADR-037/038 entries are byte-identical to HEAD — the legacy spelling survives deliberately at `docs/design/kk-collect-and-daily-voice2.md:66,188,192` as evidence the hidden route still exists, which `apps/cli/tests/store-docs.test.ts` depends on. The report records the retained paths, the absent Xiaoyuzhou connector and the live-unverified limitation, and the new file contains no secret: no token, cookie, key or credential-bearing URL appears anywhere in it. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R8 — Implementation tasks precede evidence-based caller migration (req: R1; R2; R3; R4; R5) | MET |  | The review ran after 0275/0276/0277 were implemented, verified and committed at HEAD f9b1dd16, and it inventories the declared roots (workflows, scripts, skills, docs, tests and publisher session entry points) rather than whole-implementation claims. Each candidate is recorded as replaceable, shared-helper reuse or retained with a concrete reason (`docs/reviews/2026-10-13-A22-cli-browser-caller-migration.md` (Migration matrix)); the compatible operator entry points that qualified — the three `kk lock` invocations — were migrated with regression evidence, and every publishing flow kept its existing session, readiness and error semantics. The feature link and dependency chain (0275 → 0276 → 0277 → 0278) are recorded on the task itself. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0278
**Scope:** uncommitted working tree of sp/runall-a22-1c4e (docs/reviews/2026-10-13-A22-cli-browser-caller-migration.md NEW; plugins/kk/workflows/kk-collect.yaml:79,176,187; docs/04_DESIGN.md:1518) against docs/tasks/0278 R1–R5 + AC1; upstream contracts 0275/0276/0277 at HEAD f9b1dd16.
**Dimensions:** functional traceability, correctness, security, efficiency, usability, architecture
**Verdict:** PASS
**Confidence:** MEDIUM

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | correctness | Two headline inventory counts are not reproducible from the commands the report quotes: an independent re-run of the quoted browser/session-seam sweep yields 305 matched lines (≈182 non-comment, non-test), and the "15 profile-check operator recipes" do not match the measured 38 occurrences / 13 files / 2 `profile-check login\|check` recipe matches over the same roots. The derived filters behind "53 non-test call sites" and "15 references" are not recorded, so the numbers cannot be re-audited. The classified inventory itself is complete and correct (verified independently); only the count precision is unverifiable. | `docs/reviews/2026-10-13-A22-cli-browser-caller-migration.md` (Counts section) | deferred (add the per-count derivation command/filter, or drop unverifiable precision) |
| 2 | P4 (advisory) | correctness | `plugins/kk/workflows/leftover-publish-fanout-example.yaml:26` is an executable shell action `kk fanout --in ${vars.contentFile}` in a committed, shipped workflow file — an active caller of a hidden alias, not merely prose. The report acknowledges "example workflows" but does not name this concrete call site in the matrix. Cosmetic (example/reference workflow, hidden alias retained by ADR-037), but the matrix claims "no active product caller uses them". | `plugins/kk/workflows/leftover-publish-fanout-example.yaml:26` | accepted risk (example workflow; hidden alias is a permanent route) |
| 3 | P4 (advisory) | usability | `docs/design/kk-collect-and-daily-voice2.md:66,188,192` still documents `kk store lock acquire\|release` while the shipped workflow now uses `kk lock`. Deliberate (historical evidence retained per R5/hard rule; `store-docs.test.ts` depends on the retained authority text), but an operator reading only the design page sees the legacy spelling with no pointer to the canonical one. | `docs/design/kk-collect-and-daily-voice2.md:188` | accepted risk (historical evidence rule) |

##### Requirement verdicts (with evidence)

- **R1 — MET.** Sweeps re-run independently over all declared roots: `kk store lock acquire|release` now 0 active invocations in product files (remaining hits are `apps/cli/src/commands/lock.ts:9,17` doc comments and historical `docs/design/kk-collect-and-daily-voice2.md:66,188,192`); `.spur/workflows` confirmed a symlink onto `plugins/kk/workflows` (`lrwxr-xr-x .spur/workflows -> ../plugins/kk/workflows`); `kk stage` counts verified per file by occurrence: kk-daily-ai-voice 31, kk-daily-ai-voice2 21 invocations (+1 comment at :100), kk-itc 8, kk-daily-safety 3, kk-collect 2 = 65 ✓; hidden-alias sweep confirms aliases only in compatibility routes, tests, historical docs and the two example workflows; no `xiaoyuzhou` publisher dir exists under `plugins/publishings` (14 dirs, none named xiaoyuzhou). Caveat: the 53/15 sub-counts are not reproducible as stated (Finding 1), but inventory completeness is independently confirmed.
- **R2 — MET.** Matrix present with all six columns; every candidate classified. The three migrations are behaviour-equivalent at the engine layer: `apps/cli/src/commands/lock.ts:106` `registerLockCommand(parent, hidden)` registers both `kk lock` (visible, main.ts) and the hidden legacy `kk store lock` (`apps/cli/src/commands/store.ts:1537-1538` — "share one registrar and the one pair of SQLite engines"), same `lockAcquireAction`/`lockReleaseAction`, same required flags (`--name/--run/--ttl/--db`), so argv→handler mapping, stdout (`{"acquired":true}` / `{"skipped":"locked","holder":…}`), exit semantics and lock scope are identical; the workflow's `lock.json` redirect, `.skip` routing and `release-failed` `onError: continue` path are untouched (`kk-collect.yaml:79,176,187` diff). `spur workflow validate plugins/kk/workflows/kk-collect.yaml --json` → `ok:true, findings:[]`; `spur workflow show` renders `kk lock release` in both `release` and `release-failed` states.
- **R3 — MET.** No publisher source file is modified (`git status`: only the 3 declared paths + task doc). WeChat storage-state verified live: `plugins/publishings/wechatmp-pub/src/index.ts:73` `storageStatePath()`, `:108` `openPersistentBrowser`, `:271` `resolveBrowserProfileDir(TARGET, process.env.WECHATMP_PROFILE_DIR)` — custom env profile location retained. XHS visit accounting verified: `plugins/publishings/xhs-pub/src/index.ts:234` `checkChannelSession`, `:310` `planVisit` cap. API transports verified: `x-pub/src/index.ts:105` `kind = 'file-cli'` (XApiTransport), `threads-pub/src/index.ts:137` `ThreadsPostApiTransport`, `podcast-pub/src/index.ts:10` `MicrofeedClient`. No in-process publish context was replaced by `kk bot open`; no new transport added.
- **R4 — MET.** Re-ran `bun test apps/cli/tests/commands/lock.test.ts apps/cli/tests/store-docs.test.ts apps/cli/tests/kk-collect.test.ts` → 19 pass / 0 fail / 143 expect() calls (= claimed 13 + 6). The kk-collect E2E executes the migrated workflow for real: `apps/cli/tests/kk-collect.test.ts:49` loads `plugins/kk/workflows/kk-collect.yaml` (the migrated working-tree file), `:93` installs a `kk` PATH shim running this checkout's source entry, `:153` runs `spur workflow run` without `--dry-run`, and the lock acquire/skipped/re-entrant/release/TTL scenarios (:184-241) exercise the migrated commands. `bun run lint` → exit 0 (all workspaces typecheck); `spur rule run --preset recommended-pre-check --fail-on warning --no-logo` → "All 59 rules passed". No real publish or live browser run — tests use temp dirs and fake plugins; full gate not run per instructions.
- **R5 — MET.** `git diff` touches only docs/04_DESIGN.md:1518 (`kk store lock acquire`→`kk lock acquire`, `kk store lock release`→`kk lock release` on that row, verified in place) plus the task's own Solution/updated_at fill through Spur; historical `docs/design/kk-collect-and-daily-voice2.md`, tasks, verdicts and ADR-037/038 are unmodified vs HEAD; authority lines retaining `kk store lock` still pass `store-docs.test.ts`; secret scan over the new review doc and changed YAML found no credentials.

##### AC1 verdict — MET. All scenario clauses hold with evidence: inventory spans workflows/scripts/skills/docs/tests/publisher entry points (R1 evidence); every matrix row carries a concrete category + reason (R2/R3 evidence); compatible operator entry points use canonical commands with regression evidence (R2 + R4 tests); publishing flows untouched (R3 evidence); feature linkage and dependencies present in task frontmatter (`dependencies: ["0275","0276","0277"]`) with dependency tasks committed at HEAD.

##### Residual risk
Live channel behaviour was never exercised — no real publish, no real browser session, no write to the real `~/.config/kk` profile root (by design and by task constraint); publisher/browser paths are verified only at the classification/test level, not against live sites. The two unverifiable sub-counts (53/15) leave a small chance an unclassified call site exists outside the quoted filter, though independent sweeps found none in active product code. The example workflow's `kk fanout` call (Finding 2) remains a live hidden-alias caller if that example is ever executed. Inventory counts drift with every future edit — the report is a point-in-time snapshot dated 2026-10-13.

##### Blocking count
`blocking: 0`

[tool metadata] authored by sp-super-reviewer 2026-10-14

### References

Feature A22; ADR-037/038; docs/design/kk-noun-verb-bots.md.

Current-tree premises: apps/cli/src/stage.ts:13; plugins/kk/workflows/kk-collect.yaml:79; plugins/publishings/wechatmp-pub/src/index.ts:73; plugins/publishings/podcast-pub/src/index.ts:58; AGENTS.md:26.

Dependency contracts: 0275, 0276, 0277.

Concurrency: no WIP tasks were returned in the current tree. A separate worktree /Users/robin/xprojects/knowledge-kit-dev-runall-0269-0270-0272-43ce exists for earlier channel work; unrelated WeChat .probe-0272*.ts files are present here. Do not edit/revert their work. Re-read affected channel files and the current task corpus at implementation start; if landed channel fixes change an assumption, retain the public contract and update this task through Spur. Generated apps/cli/dist is not evidence of current source behavior: rebuild before packaged smoke checks. Bun 1.4.3, Playwright 1.55.0 and ts-browser-automation 0.5.24 match the installed packages and bun.lock. Prior repository lint was blocked by unrelated probe formatting/import errors, so do not claim a green baseline; report any remaining outside-scope findings.

### History

- 2026-10-14T08:25:46.083Z todo → wip (system)
- 2026-10-14T08:25:46.449Z wip → testing (system)
- 2026-10-14T08:25:46.815Z testing → done (system)

