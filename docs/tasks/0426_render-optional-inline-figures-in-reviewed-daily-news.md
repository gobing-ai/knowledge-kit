---
schema_version: 1
name: Render optional inline figures in reviewed daily news
status: done
template: feature-impl
created_at: 2026-11-23T01:20:51.117Z
updated_at: "2026-11-24T06:46:29.814Z"
feature_id: L4
priority: P2
tags:
  - daily-news
  - image-gen
estimate_hours: 8

dependencies: ["0425"]
done_forced: "false"
done_reason: unforced close
---

## 0426. Render optional inline figures in reviewed daily news

### Background

L4 R4 and R6 add default-off inline figures to the reviewed Chinese daily article. The publisher's daily audio enrichment routes the WeChat article through the editor. Its ordinary file attachment path does not preserve paragraph placement.

**Refine corrections (2026-11-22)**
- The image-gen illustration job uses anchor text as the concept unless `vars.concept` overrides it, and emits generic captions. Use one existing request per figure after whole-plan prevalidation and retain editorial captions in the derived payload.
- Resolve an enabled WeChat article target before spend. The plain CGI draft path is ineligible for the daily audio payload. Define inline placement through the audio-capable editor and verify it before saving.
- The bundle digest covers serialized variant JSON, not referenced binaries. Pin figure hashes in the variant and verify the same bytes in the adapter before upload.

Current-tree sources: plugins/generations/image-gen/src/index.ts:135, plugins/kk/scripts/daily-stages.ts:2652, plugins/kk/scripts/daily-stages.ts:2706, plugins/publishings/wechatmp-pub/src/flow.ts:695, plugins/publishings/wechatmp-pub/src/flow.ts:2508.

### Requirements

- [x] R1. `kk news generate --inline-illustrations` freezes an opt-in for the run. Validate target eligibility, one or two unique exact reviewed paragraph anchors and their admitted source IDs, visual concepts, captions and alt text before any image provider dispatch.
- [x] R2. Reuse image-gen's illustration job to render or resume figures, and include them only in the zh `article@wechatmp-pub` variant before variants review/freeze. WeChat audio-capable editor execution must verify each figure's position, caption and alt text before save. Reject invalid plans or unsupported routes with a named failure and no paid image dispatch.

### Acceptance Criteria

- [x] AC1 — Inline article figures use unique reviewed anchors
- [x] AC2 — Invalid illustration plans are rejected before spend

AC1 exercises R1 and R2 on the two-figure replay. AC2 exercises R1 and R2 on the duplicate-anchor or unsupported-target replay.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-23T01:21:30.179Z

**What qualifies a target?** Its selected route must carry the image in the requested text position with caption and alt text. The WeChat daily article has an audio block and its CGI/DOM attachments do not prove placement. Exercise that route with fakes and use its current media transport with target-specific placement support if required. Default off and refuse unsupported targets before spend.

#### Q&A entry — 2026-11-23T02:49:20.261Z

**What is the first supported route?** The WeChat Chinese article with audio, gated on an enabled article target and successful offline editor replay. Use existing image-gen and WeChat upload paths. Opt-in stays off by default. 0423’s editor changes are a coordination boundary.

### Design

1. Add the news-only launch flag `--inline-illustrations` in `content-launch.ts`, forwarding `inline_illustrations=true` into `kk-news-generate.yaml` (default false). At launch use the resolved publish preset/channel registry to require an enabled `wechatmp-pub` `文章` article row, respecting explicit channel selection. Fail before launch when opted into an unsupported target. Keep the same gate on direct workflow calls in the render stage. No new config schema or existing article flag changes.
2. Add inline mode to 0425's skill. After draft safety and review, the gated agent writes `22-article/illustrations/plan.json` as `{version:1, figures:[{anchor,sourceId,concept,caption,altText}]}`, then `kk stage run news-inline-illustrations` validates and renders. Read the canonical `22-article/<date>_06_article_content.json` used by `dailyBundleVariants`. Each anchor must be a whole unique prose paragraph in the selected story section, in body order, outside fenced code, headings, quotations and existing images. Validate the approved source IDs against the article/admitted plan. Before invoking image-gen, use the same draft verdict rules as dailyPublishPrep: require the current safety-judge stamp digest to match safetyDigest and reject a WeChat-excluded target. A passed workflow node alone cannot prove the drafts remained unchanged after operator review. Gate both nodes on opt-in and pool PASS. Make variants wait for the render node and pass the same opt-in bit; historical standalone variants calls default off.
3. Keep the generic generator contract. Use one `job:illustration` request per figure with `count:1`, `maxImages:1`, `format:illustration`, `style:technical-diagram`, `positions:[anchor]`, and explicit `vars.concept`. Use the pinned cover provider/model settings for the first rollout and no implicit fallback. Retain the plan's caption and alt text. Per-figure receipt under `22-article/illustrations` binds source/body, normalized figure and render settings to the image path and SHA-256. Reuse only on a match with verified bytes. Commit each successful figure independently. A partial failure blocks generation of that variant and retains completed receipts.
4. Use `dailyBundleVariants` and `buildWechatArticleContent` to apply ordered figure markers after the exact paragraphs (rendered marker `![ALT](kk-inline:figure-1)` and a caption paragraph) only to the target variant. Keep files local until the publish adapter runs. Refuse a stale or missing render receipt before materialization when opted in. Pin `metadata.wechatmp.inlineFigures` to `[{id,path,sha256,altText,caption}]` and validate one-to-one markers and bytes before dispatch. Confirm materialization preserves audio/cover enrichment. Ordinary WeChat attachments, other locales and channels are out of scope.
5. In `wechatmp-pub`, resolve only markers backed by validated local figure metadata. Reuse its existing local-image upload and allowed-CDN validation to prepare the figures before the existing rich HTML insertion. Render escaped alt/caption and require the audio/editor DOM to show the expected URL, text and anchor order before save. A text-only fallback or append-at-end is a failure for an opted-in illustrated payload. Preserve the existing plain article path and never hand the audio article to the CGI draft-create rail.
6. The 0423 worktree currently modifies `flow.ts`, editor/CGI tests and publish matrix code. Re-read its integrated editor/body changes before editing 0426; coordinate that file rather than transplanting this plan's line numbers. No hard dependency on 0423's unrelated publishing changes. 0427 consumes the render receipts and frozen target variant.

### Plan

- [ ] Before source changes, add the two-figure, duplicate anchor, disabled or safety-excluded target, edited-after-review draft and stale-binary cases to the news fixture replay. Extend `plugins/publishings/wechatmp-pub/tests/wechatmp-editor-insert.test.ts` or the current editor replay from 0423 to observe actual ordered HTML/DOM, audio retention and the refusing save path.
- [ ] Freeze the launch/target choice. Add the plan/renderer and pre-spend validation, then bind each receipt to its source, settings and bytes. Prove rerun after a partial provider failure retries only the missing figure.
- [ ] Materialize the WeChat-only variant before the variants safety manifest and freeze. Use the real adapter preparation/insertion path with upload transport fakes. Assert markers, CDN URL/order, alt text, captions, audio metadata and refusal on changed binary or dropped figure.
- [ ] Verify default-off and unsupported cases have zero new image calls. Confirm other variant files have identical hashes. Record the additive CLI/workflow/variant surfaces in `docs/04_DESIGN.md` and `AGENTS.md` as applicable.

### Solution

**Change map**

- `apps/cli/src/commands/content-launch.ts:52` — `--inline-illustrations` on the generate verb (`:661`), news-only (exit 2 on another noun, `:373`); `inlineFigureRefusal()` (`:313`) admits the target from the resolved publish preset — an enabled `wechatmp-pub` `文章`/`article` row that `--channels` must also select when channels are named — and exits 5 **before** the launch (`:384`). The admitted run forwards `inline_illustrations=true`.
- `plugins/kk/scripts/daily-stages.ts:3170` — the pinned figure constants; `articleBlocks` (`:3199`) classifies body blocks (code/heading/quote/list/image ineligible); `validateInlineFigurePlan` (`:3224`) validates the whole plan — 1–2 figures, unique whole-prose anchors in body order, admitted `sourceId`, duplicate/ineligible/out-of-order refusals; `assertInlineFigureDrafts` (`:3301`) reuses publish-prep's verdict rules (stamp, `status`, digest, `wechatmp` exclusion) **before** any provider call; `assertInlineFigureTarget` (`:3322`) is the same admission gate for a direct workflow call; `dailyInlineIllustrations` (`:3354`) renders or resumes one pinned `job: illustration` request per figure and writes a receipt binding the body hash, settings and image SHA-256.
- `plugins/kk/scripts/daily-stages.ts:2305` — `inlineFigureMaterials` proves each figure against its receipt before a marker exists (missing/stale receipt, changed article body, changed binary all refuse); `withInlineFigureMarkers` (`:2357`) places `![alt](kk-inline:figure-N)` + a caption paragraph after the anchored paragraph; `buildWechatArticleContent` pins `metadata.wechatmp.inlineFigures` (`:2420`) and applies markers only on the article path (`:2469`); `dailyBundleVariants` (`:2800`, `:2846`) reads the materials and passes them to the WeChat article variant alone.
- `plugins/kk/scripts/kk-workflow-stages.ts:2113` — the `news-inline-illustrations` stage route.
- `plugins/kk/workflows/kk-news-generate.yaml:42` — `inline_illustrations` (default `false`), `cover_provider`/`cover_model` (pinned figures), `plugins_path`; nodes `illustrations-plan` (`:328`, agent, mode `inline`, `dependsOn: [safety, review]`) and `illustrations-render` (`:353`), both opt-in + pool gated; `variants` waits on the render node (`:510`).
- `plugins/kk/skills/daily-news-illustrations/SKILL.md:63` — mode `inline` (the plan contract the agent writes).
- `plugins/publishings/wechatmp-pub/src/flow.ts:715` — `inlineFiguresOf` validates the pinned metadata against the files on disk; `assertInlineFigureMarkers` (`:765`) requires one marker per figure in order and no stray; `withInlineFigureHtml` (`:793`) renders the escaped `<img>` + caption at each anchor; `waitForInlineFigureSrcs` (`:831`) captures the platform-assigned URLs after upload; `verifyInlineFigureDom` (`:849`) proves URL, alt text, caption and order in the editor DOM before save; `insertHtmlBody` (`:912`) is the shared rail, and `composeArticle` (`:1603-1615`) uploads the figures first, then inserts the body with the figures at their anchors.
- `docs/04_DESIGN.md:2299` — the surface row: flag, var, nodes, stage validation, variant metadata and adapter verification.

**Tests (written before the code)**

- `apps/cli/tests/content-launch.e2e.test.ts` — three cases: opt-in forwarded for news and nothing by default; the flag refused on an article noun (exit 2, no launch); a `--channels` selection that excludes the WeChat article row refused (exit 5, no launch).
- `apps/cli/tests/kk-workflow-stages.test.ts` — `news-inline-illustrations`: pinned envelope per figure + receipts bound to the bytes; verified-byte reuse and a changed binary re-rendered; duplicate/ineligible/unadmitted refusals with **zero** provider calls; stale-draft and WeChat-excluded refusals; unsupported preset refused. Plus `daily-bundle-variants · inline figures`: markers + caption in the article variant only, metadata pinned, stale binary refused with no variants written, and a plan-less run byte-identical.
- `apps/cli/tests/kk-news-generate-dag.test.ts` — the two nodes' opt-in conditions, the `[safety, review]` dependency (why both edges), `variants` waiting on the render node, and the declared `kk stage` exception set.
- `plugins/publishings/wechatmp-pub/tests/wechatmp-editor-insert.test.ts` — the metadata/marker contract (missing field, reordered id, changed binary, stray/duplicate marker), escaped HTML rendering, URL capture in DOM order, and the DOM verification refusing a text-only body, a swapped URL, a changed caption/alt and a reordered id.

**Verification.** `apps/cli` typecheck and `wechatmp-pub` typecheck clean; biome clean; focused suites green (content-launch 20/20, news DAG 13/13, inline stage 5/5, bundle-variants 3/3, editor-insert 16/16); `wechatmp-pub` package coverage `src/flow.ts` 90.36% funcs / 91.53% lines. The full suite and the pipeline gate follow in `.spur/run/0426-full-test.log`.

**Residual risk (recorded for review).** The editor wiring (`composeArticle`'s figure branch, lines 1607–1615) is exercised only through the contract-level helpers; the full upload→insert→verify sequence has not run against the live WeChat console, so the platform's own upload DOM contract is still assumed.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — `kk news generate --inline-illustrations` freezes an opt-in; validate target eligibility, one or two unique exact reviewed paragraph anchors and their admitted source IDs, visual concepts, captions and alt text before any image provider dispatch | MET | `apps/cli/src/commands/content-launch.ts:373` (news-only opt-in, exit 2 otherwise) and `:313` (`inlineFigureRefusal` — enabled `wechatmp-pub 文章/article` row, `--channels` must select it, exit 5 before launch) · `plugins/kk/scripts/daily-stages.ts:3224` (`validateInlineFigurePlan`: 1–2 figures, unique whole-prose anchors, body order, admitted `sourceId`, duplicate/ineligible refusals) · `:3301` (`assertInlineFigureDrafts`) and `:3322` (`assertInlineFigureTarget`) run before the first provider call · `apps/cli/tests/content-launch.e2e.test.ts:81` (three admission cases) and `apps/cli/tests/kk-workflow-stages.test.ts:6046` (five refusals, each asserting **zero** provider calls) |
| R2 — reuse image-gen's illustration job to render or resume figures, include them only in the zh `article@wechatmp-pub` variant before variants review/freeze, and have the WeChat editor verify each figure's position, caption and alt text before save; reject invalid plans or unsupported routes with a named failure and no paid dispatch | MET | `plugins/kk/scripts/daily-stages.ts:3354` (one pinned `job: illustration` request per figure, per-figure receipt binding body hash + settings + image SHA-256, verified-byte reuse) · `:2305` (`inlineFigureMaterials` refuses a missing/stale receipt or changed binary) and `:2357`/`:2469` (markers + caption paragraphs only on the article path) · `:2420` (`metadata.wechatmp.inlineFigures`) · `plugins/publishings/wechatmp-pub/src/flow.ts:715`/`:765`/`:793` (validate, marker contract, escaped HTML), `:831`/`:849` (platform URLs captured after upload, DOM verified before save), `:1603-1615` (`composeArticle` order) · tests: `kk-workflow-stages.test.ts:6140` (bundle variants), `wechatmp-editor-insert.test.ts:246` (17 assertions incl. refusals) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Inline article figures use unique reviewed anchors | MET | test | `apps/cli/tests/kk-workflow-stages.test.ts:6140` — a two-figure plan materializes `![alt](kk-inline:figure-1)` + caption right after its own paragraph, in body order, in `article@wechatmp-pub` only, with the figure metadata pinned; `:6110` refuses a duplicate/reordered/unadmitted anchor before any provider call |
| AC2 — Invalid illustration plans are rejected before spend | MET | test | `kk-workflow-stages.test.ts:6110` (duplicate anchor, ineligible block, unadmitted source → exit 1, no `kk` invocation recorded), `:6130` (stale draft digest / `wechatmp`-excluded target → no dispatch), `:6155` (preset without an enabled article target) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Review depth: **all** (SECUA + architecture depth + functional traceability) over the task's change
set on `sp/runall-L4-5c3f` (rebased onto `d2121a21`), 11 files.

**Functional traceability** — R1 MET: the news-only opt-in, the preset/`--channels` target admission
(exit 2 / exit 5 before launch) and the whole-plan validation (1–2 unique whole-prose anchors in body
order, admitted `sourceId`, concepts/captions/alt text, the drafts verdict and the target re-checked
before any provider call). R2 MET: one pinned `job: illustration` request per figure with a receipt
binding body hash, settings and image SHA-256 (reuse only on verified bytes), markers and
`metadata.wechatmp.inlineFigures` only in `article@wechatmp-pub`, and the adapter verifying URL, alt
text, caption and order in the editor DOM before save. AC1/AC2 MET — evidence tables in
`.spur/run/runall-L4-5c3f-0426-review-cert.md`.

**SECUA** — the adapter re-hashes every figure against the pinned digest and only accepts the
platform's own CDN URL; every refusal is named and fail-closed; a partial provider failure keeps the
completed receipts for a resume; opt-in stays off and a plan-less run is byte-identical; alt text and
captions are escaped and verified.

**Architecture** — plan validated once, receipt as the single source of truth for placement, and the
adapter reuses 0423's upload rail rather than adding a second transport. The two `kk stage` node
exceptions are declared once in the DAG test.

**Findings** — P4 (advisory): `inlineFigureMaterials` refuses instead of repairing when the article
changed after rendering, costing one re-render; accepted, a stale figure is worse. No open P1/P2/P3.

**Residual risk** — the editor figure branch is verified through the contract helpers and the module's
own fakes; the live console's upload DOM contract is assumed. First opt-in run should be a draft.

**Disposition** — PASS.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-23T06:26:01.749Z todo → wip (system)

- 2026-11-23 batch `runall-L4-0ad4` (feature L4): **stopped before any code landed**, no implementation
  attempted. Design step 6 names a coordination boundary with task 0423: 0426 must edit
  `plugins/publishings/wechatmp-pub/src/flow.ts` and `tests/wechatmp-editor-insert.test.ts`, the two
  files 0423 rewrote in `e258d2ed`, which is on `sp/run-0423-63d9` and still `wip` — not on `main`
  (this batch's base `febce48`). Operator decision: do not build against a moving file and do not
  import another session's unmerged commit. The implement stage raised the question through the
  escalation contract (the question was recorded in that batch's report,
  `.spur/run/worktree-runall-L4-0ad4-batch-report.md`, and its run record); the escalate hop then failed on a pipeline
  defect (`file.read.into-var: path is required` — the shared `task-pipeline` v9 `escalate` state
  passes `file:` where the action contract requires `path:`), so the run closed `failed` at
  `escalate` and the status stayed `wip` with an empty `## Solution`. **No work to preserve:**
  re-run `sp-dev-run 0426` after `e258d2ed` merges, from a tree cut on the merged base.

- 2026-11-23 batch `runall-L4-5c3f` (base `5caf5438`, which carries 0423's editor changes): implement
  paused at a **coherent slice**, not abandoned. Landed so far: the news-only `--inline-illustrations`
  launch admission (`inlineFigureRefusal`, exit 2 on a non-news noun, exit 5 when the target or the
  `--channels` selection cannot carry figures); `kk stage news-inline-illustrations`
  (`articleBlocks` / `validateInlineFigurePlan` / `assertInlineFigureDrafts` /
  `assertInlineFigureTarget` / `dailyInlineIllustrations` — one pinned `job: illustration` request per
  figure, per-figure receipts binding body hash, settings and image SHA-256, verified-byte reuse);
  the `illustrations-plan` / `illustrations-render` DAG nodes (opt-in + pool gated) with `variants`

waiting on them; and the skill's mode `inline`. Green at that slice: content-launch 20/20, news DAG
  12/12, inline stage 5/5, typecheck + biome clean.
- 2026-11-23 batch `runall-L4-5c3f` (**completed**): the remaining two slices landed and the task
  closed `done` with verdict PASS. `daily-stages.ts` now proves every figure against its render receipt
  before a marker exists (`inlineFigureMaterials`), materializes `![alt](kk-inline:figure-N)` + a caption
  paragraph only in `article@wechatmp-pub`, and pins `metadata.wechatmp.inlineFigures`;
  `wechatmp-pub/src/flow.ts` validates that metadata, uploads the figures through the editor's own
  image input, inserts the body with each figure at its anchor and verifies URL/alt/caption/order in
  the DOM before save. The gate failed once (`no-direct-fs-io` on a `node:fs` import plus a fixture
  cast), was remediated by hashing through the plugin's `readLocalImageBytes`, and passed on the
  recheck; review passed with one recorded residual (the editor branch is verified against the
  module's fakes, not the live console — first real opt-in run should be a draft). The branch was
  rebased onto `d2121a21` and then onto the current `main`. Progress note:
  `.spur/run/runall-L4-5c3f-0426-progress.md`.

