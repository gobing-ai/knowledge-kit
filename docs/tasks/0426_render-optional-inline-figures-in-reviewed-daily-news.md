---
schema_version: 1
name: Render optional inline figures in reviewed daily news
status: wip
template: feature-impl
created_at: 2026-11-23T01:20:51.117Z
updated_at: "2026-11-23T16:31:51.019Z"
feature_id: L4
priority: P2
tags:
  - daily-news
  - image-gen
estimate_hours: 8

dependencies: ["0425"]
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

- [ ] R1. `kk news generate --inline-illustrations` freezes an opt-in for the run. Validate target eligibility, one or two unique exact reviewed paragraph anchors and their admitted source IDs, visual concepts, captions and alt text before any image provider dispatch.
- [ ] R2. Reuse image-gen's illustration job to render or resume figures, and include them only in the zh `article@wechatmp-pub` variant before variants review/freeze. WeChat audio-capable editor execution must verify each figure's position, caption and alt text before save. Reject invalid plans or unsupported routes with a named failure and no paid image dispatch.

### Acceptance Criteria

- [ ] AC1 — Inline article figures use unique reviewed anchors
- [ ] AC2 — Invalid illustration plans are rejected before spend

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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
  escalation contract (`.spur/run/0426-question.md`); the escalate hop then failed on a pipeline
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
  waiting on them; and the skill's mode `inline`. Green: content-launch 20/20, news DAG 12/12, inline
  stage 5/5, typecheck + biome clean. Remaining: variant materialization (markers,
  `metadata.wechatmp.inlineFigures`, staleness refusal) and the `wechatmp-pub` adapter
  insertion/DOM verification. Progress note and resume command:
  `.spur/run/0426-inline-progress.md`.

