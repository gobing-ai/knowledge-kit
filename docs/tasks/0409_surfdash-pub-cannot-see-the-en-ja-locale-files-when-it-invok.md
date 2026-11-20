---
schema_version: 1
name: surfdash-pub cannot see the en/ja locale files when it invokes postsurfing from kk
status: todo
template: issue
created_at: 2026-11-19T22:00:42.226Z
updated_at: "2026-11-20T00:28:50.657Z"

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 8
feature_id: L3
---

## 0409. surfdash-pub cannot see the en/ja locale files when it invokes postsurfing from kk

### Background

Captured from the 2026-11-19 dogfood. The kk row `surfdash-pub.post` failed three times with `Sync Daily digest 20261119-ai-2026-11-19 is missing locale file(s): en, ja`. The same `bun scripts/surfdash.ts publish <abs zh path>` run from a shell against the same checkout published all three locales and exited 0. The post is live in zh/en/ja, but the kk receipt stayed `uncertain` and the after-generate window classified `partial`.

**Refine corrections (2026-11-19)**

- **Renumbered 0396 → 0409.** WBS 0396 was also held by the done task `0396_deliver-traceable-public-corrections…`. Same fix as 0408.
- **Root cause is structural, not only the spawn path.** The old pipeline had a `translate` state (`plugins/kk/workflows/kk-daily-ai-voice.yaml:555-584`: `kk stage daily-translate-localize`, then an agent translating the en/ja drafts, then `daily-translate-sync`). The new `plugins/kk/workflows/kk-news-generate.yaml` (ADR-053) has **no** localize/translate node, and the preset row `surfdash-pub / post / article` (`plugins/kk/publish-presets/daily-ai-voice.json:5-13`, tier 0, required) runs `preparePost` (`src/index.ts:~1280`), which writes **zh only**. On a normal day en/ja never exist, so the site orchestrator (`surfdash/scripts/publish-orchestrator.ts:330` `discoverLocaleFiles`, missing-locale fail ~599) must refuse. 2026-11-19 differed only because the operator hand-authored en/ja.
- **The spawn-path anomaly is unproven, not dismissed.** On 11-19 the en/ja files existed (verified by `ls` after each failed run), yet the kk-spawned run still saw zh only. `spawnCli` (`src/index.ts:345`) strips only `SPUR_WORKFLOW_RUN_ACTIVE` and `SPUR_EXPECTED_DEFINITION_DIGEST`. Spur injects more into shell steps (`SPUR_RUN_ID`, `SPUR_SERVE_URL`, `SPUR_PROJECTS_FILE`, `SPUR_ROLE`, `SPUR_SKIP_GLOBAL_CONFIG`, …), and the nested `spur workflow run .spur/workflows/publishing.yaml` inherits them. A path/cwd mismatch is equally possible. This must be **measured** before anything is scrubbed.
- **Option (a) from 0408 (kk gains a translate step) belongs here.**
- **Evidence paths.** The cited receipts under `.works/kk-news-generate/20261119/4-publish/receipts/` are not on disk. The quotes come from `.spur/context/memory.md:316-317` and the original report.

### Requirements

- [ ] R1. — The news pipeline produces en/ja before freeze. `kk-news-generate.yaml` gains a `localize` agent node and a `localize-check` shell node. They run after `render` and `review` (the reviewed zh article exists) and **before** `variants`. It writes an English and a Japanese translation of the zh article to frozen paths, and a deterministic validator refuses an untranslated or empty locale. The translations then ride inside the `article` variant, so the variants safety review sees them and the freeze digest covers them.
- [ ] R2. — surfdash-pub publishes the full locale set from the payload. When the `article` Content carries `metadata.surfdash.locales.{en,ja}`, `post` writes the en and ja sibling files next to zh, using the same locale-aware rendering as zh, then publishes once. When either locale is missing, `post` refuses **before** spawning postsurfing, with `effect: none` (retry allowed) and an error naming the missing locales. It must never reach the site's opaque `missing locale file(s)` failure.
- [ ] R3. — Measure the spawn-path anomaly, then fix only what is proven. A hermetic repro runs `spawnCli` exactly as `publishPreparedFile` does, against a stub surfdash root (temp dir with `content/posts/articles/{zh,en,ja}/<slug>/index.md`) and a stub `postsurfingBin` that prints its env (`SPUR_*` keys only), cwd and the locale directory listing. It runs once under a plain shell and once from inside a `spur workflow run` shell step. If the listings or the resolved root differ, fix that cause in `spawnCli` (for example, scrub the proven leaking `SPUR_*` keys) and keep the repro as the regression test. If they match, record "not reproducible; root cause was R1" in Root Cause and change nothing in `spawnCli`.
- [ ] R4. — Tests. A fixture-driven test for R2 (locales present → three files written, one publish spawn; locale missing → refusal before spawn) and the R3 repro test. A workflow-structure test asserts `localize-check` is in `variants.dependsOn` and `localize` depends on `render` and `review`.

**Non-goals:** a live CMS publish during implementation or tests; changing the site's orchestrator, retitle or locale discovery; translating anything other than the surfdash article; the 0408 headline gate; fixing the pre-existing site-wide en routing (noted 2026-11-16 in memory as a separate site defect).

### Acceptance Criteria

```gherkin
Scenario: AC1 — A news run freezes en and ja with the article (req: R1)
  Given kk-news-generate runs to freeze on a fixture day
  When the frozen bundle's article variant is read
  Then metadata.surfdash.locales.en and .ja each carry a non-empty title and body in the target language, and the variant digest covers them

Scenario: AC2 — An untranslated locale stops the run before freeze (req: R1)
  Given the localize agent leaves the ja file in Chinese or empty
  When the localize validator runs
  Then localize-check fails with a message naming ja, and no bundle is frozen

Scenario: AC3 — surfdash-pub writes and publishes the whole set (req: R2)
  Given an article Content with zh content and both locales in metadata and a stub postsurfing
  When the post operation runs
  Then zh, en and ja index.md exist under the slug and postsurfing is spawned exactly once with the zh path

Scenario: AC4 — A missing locale is refused before any spawn (req: R2)
  Given an article Content without metadata.surfdash.locales.ja
  When the post operation runs
  Then it returns failure with effect none naming ja, and postsurfing is never spawned

Scenario: AC5 — The spawn-path hypothesis is measured (req: R3)
  Given the stub surfdash root and the env-printing stub orchestrator
  When spawnCli runs from a plain shell and from inside a spur workflow shell step
  Then both observations are recorded in Root Cause, and spawnCli changes only if they differ, with that difference pinned by a test that fails pre-fix

Scenario: AC6 — Structure and suites pass (req: R4)
  Given the new workflow-structure, surfdash-pub fixture and repro tests
  When bun run lint and bun run test run
  Then both exit 0 with per-file coverage at or above 90%
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-11-20T00:23:04.843Z

- **Q: Translate inside surfdash-pub or in the workflow? A (closed 2026-11-19):** in the workflow. Translation needs `agent.run`, and plugins are deterministic steps (kk owns steps, spur workflow owns orchestration). Translating before freeze also keeps ADR-053's "publish only what was frozen and safety-reviewed".
- **Q: Reuse the article `adapt` state or the old translate stages? A (closed):** neither wholesale. `kk-article-generate.yaml:243-270` `adapt` targets per-platform rewrites, and `daily-translate-localize` scaffolds from an already-published surfdash post (post-publish order, the opposite of what freeze needs). Reuse their parts: the old translate agent prompt (glossary at `<surfdash>/.agents/skills/surfdash-translator/glossary.md`, keep code/URLs) and the language checks in `validateTranslatedLocales` (`plugins/kk/scripts/daily-stages.ts:5693`), if they apply to a bare markdown file. If not, write a small validator next to it.
- **Q: Payload shape? A (closed):** `metadata.surfdash.locales: { en: { title: string; body: string }; ja: { title: string; body: string } }`. Frontmatter (description, key_points, series title) is rendered by surfdash-pub per locale and then rewritten by the site's own refine/retitle, as for zh.
- **Q: Scrub all `SPUR_*` in `spawnCli` preemptively? A (closed):** no. Only keys the R3 repro proves leaking. A blanket scrub could hide a legitimate `SPUR_*` the nested surfdash workflow needs.

### Design

**WHAT.** (1) A `localize` + `localize-check` node pair that produces frozen en/ja translations. (2) The article variant carries them. (3) surfdash-pub `post` materializes and publishes all three locales, or refuses early. (4) A measured verdict on the spawn-path anomaly.

**WHY.** The tier-0 required surfdash row cannot succeed on any day without en/ja. The new pipeline lost the old translate step during the ADR-053 migration. Producing locales pre-freeze is the only placement that keeps "publish exactly what was safety-reviewed and frozen".

**WHERE (frozen names).**

| Piece | Location |
| --- | --- |
| Workflow nodes `localize` + `localize-check` | `plugins/kk/workflows/kk-news-generate.yaml` is a `dependsOn` DAG. Add `localize` (`action.kind: agent.run`, role `scribe`, `agent: ${vars.agent}`, same pool-gate `condition`, `dependsOn: [render, review]` so it translates the reviewed article, `expectFile` = the ja file, prompt ≤1000 chars per ADR-115, adapted from `kk-daily-ai-voice.yaml:572-580`). Then add `localize-check` (`kind: shell`, `dependsOn: [localize]`, `kk stage news-localize-validate "${vars.work_dir}" "${vars.run_date}"`, no `onError: continue`). Add `localize-check` to `variants.dependsOn` (~366). Mirrors the `curate`/`curate-check` pair (74-112). |
| Translation files | `${work_dir}/22-article/locales/en.md`, `${work_dir}/22-article/locales/ja.md`. First line `# <title>`, rest body. |
| Validator stage | `news-localize-validate`, registered in `plugins/kk/scripts/kk-workflow-stages.ts` next to `daily-translate-validate` (2082-2101), body in `plugins/kk/scripts/daily-stages.ts`. |
| Variant embedding | The `article` variant builder inside `STEP.bundleVariants()` (`apps/cli/src/commands/content-generate.ts` generate-bundle row ~981) reads the two files when present and sets `metadata.surfdash.locales`. |
| Plugin | `plugins/publishings/surfdash-pub/src/index.ts`: `preparePost` (~1280) parameterized by locale (today read from `SURFDASH_LOCALE`). The `post` path writes en/ja siblings via the same path logic as `scaffold-locale` and `localeSiblings` (~440), then `publishPreparedFile` (~1400). Early refusal goes before `spawnCli`. |
| Repro | `plugins/publishings/surfdash-pub/tests/` fixture + stub bin. Nested-spur leg only if `spur` is on PATH; otherwise the test records a skip reason in the Testing section, never a silent pass. |

**Install note.** `plugins/kk/scripts/` stage edits are invisible to `kk stage` until synced to the installed package (AGENTS.md § Editing `plugins/kk/scripts/`), and `kk news generate` preflight refuses on drift. Rsync after merge, and run `bun run tools:fresh` before the next 04:30 tick.

**Anti-patterns.** No agent call from inside a plugin. No post-freeze translation. No blanket `SPUR_*` scrub. No live CMS publish in tests. Do not add en/ja as separate matrix rows (one site post = one row).

### Plan

1. **R3 first (cheap, de-risks).** Build the stub surfdash root and the env-printing stub bin. Run both legs and record the observations in Root Cause. Branch on the result: fix and pin, or record "not reproducible".
2. **R2 tests, then code.** Add the surfdash-pub fixture tests (AC3, AC4) and watch them fail. Parameterize `preparePost` by locale, write the siblings, add the early refusal.
3. **R1 validator.** Write `news-localize-validate` tests (untranslated, empty, ok), then the stage and its registration.
4. **R1 workflow + variant.** Add the `localize`/`localize-check` nodes and the `variants.dependsOn` edge, embed the locales in the article variant, and add the structure test (AC6) and the variant embedding test (AC1 on a fixture work dir).
5. **Gate.** `bun run lint`, `bun run test`, `bun run build`. `spur workflow` validation of `kk-news-generate.yaml` if the CLI offers it (`spur workflow --help`).
6. **Install sync + freshness.** Rsync `plugins/kk/scripts/` and `plugins/kk/workflows/` to the installed package, then `bun run tools:fresh`. Record in Testing.
7. **Operator-only, post-merge:** `git -C /Users/robin/xprojects/surfdash pull` (11 commits behind on 2026-11-19), then observe the next scheduled run's `surfdash-pub.post` receipt.

### Root Cause

**Verified, structural (2026-11-19, code read).** `kk-news-generate.yaml` has no translate/localize node (the old `kk-daily-ai-voice.yaml:555` `translate` state was not carried over in the ADR-053 migration). The `surfdash-pub post` row writes zh only (`src/index.ts` `preparePost` ~1280), so the site orchestrator's locale discovery (`publish-orchestrator.ts:330`) refuses every normal day.

**Open, to be measured under R3.** Why the kk-spawned run also saw zh only on 2026-11-19, when en/ja existed on disk. Record both repro legs here.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- New pipeline: `plugins/kk/workflows/kk-news-generate.yaml:362-400` (`variants`, `safety-variants`, `freeze`); ADR-053 `docs/00_ADR.md:1933`.
- Old translate: `plugins/kk/workflows/kk-daily-ai-voice.yaml:555-584`; stages `plugins/kk/scripts/kk-workflow-stages.ts:2082-2101`; `validateTranslatedLocales` `plugins/kk/scripts/daily-stages.ts:5693`.
- Plugin: `plugins/publishings/surfdash-pub/src/index.ts` `spawnCli` 345, `digestCheckLocaleSet` 468, `preparePost` ~1280, `publishPreparedFile` ~1400, dispatch ~1596.
- Matrix variant load: `apps/cli/src/publish-matrix.ts:708-793`.
- Site: `/Users/robin/xprojects/surfdash/scripts/publish-orchestrator.ts:330,~599`; `scripts/commands/publish.ts`; `.spur/workflows/publishing.yaml`.
- Sibling: 0408 (land first; shares surfdash-pub tests).
- Concurrency check before starting: `git worktree list`, `spur task list --status wip --json`.

### History
