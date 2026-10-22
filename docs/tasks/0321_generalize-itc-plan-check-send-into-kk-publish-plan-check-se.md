---
schema_version: 1
name: Generalize itc plan/check/send into kk publish plan|check|send with window, mode and approval rows
status: todo
template: feature-impl
created_at: 2026-10-22T18:41:31.104Z
updated_at: "2026-10-22T19:09:49.375Z"
feature_id: G15

priority: P1
estimate_hours: 8
---

## 0321. Generalize itc plan/check/send into kk publish plan|check|send with window, mode and approval rows

### Background

kk-itc already splits generate/publish (`apps/cli/src/itc-publish.ts` — `itcMaterializePlan` :85, `itcCheckTargets` :320, `itcSendTargets` :386, `itcReconcileReceipts` :557; `apps/cli/src/itc-plan.ts` — `PublishPresetTargetSchema` :32, `resolveItcTargets` :246; stage routing `apps/cli/src/itc-stage.ts`, called first by `apps/cli/src/commands/stage.ts:50`). voice3's publish half (publish3) needs the same plan → check → send machinery driven by a publish preset whose rows carry `operation`, `variant`, `tier`, `window`, `mode`. Design: `docs/design/kk-daily-ai-voice3.md` §3, §5, §5a, §5b.

**Refine corrections (2026-10-22)**

- Surface: `kk publish plan|check|send` → `kk stage run publish-matrix-plan|publish-matrix-check|publish-matrix-send`. No new `publish` noun means no ADR-037 inventory change and no new ADR; it stays consistent with the `kk stage run itc-*` precedent. The `publish-*` stage names are taken by daily-stages (`publish-prep`, `publish-podcast`, `publish-wechat`, …) and board node ids (`apps/cli/src/board/manifest.ts:251,349`), hence the `publish-matrix-` prefix.
- `PublishPresetTargetSchema` is `.strict()` with only `{plugin, profile?}` (`itc-plan.ts:32`), so the voice3 rows need a schema extension. It must be optional-only so the itc presets still validate.
- Receipts: the design §5b field list (`ok`, `dummy`, `error`, …) is not the shipped shape. `ItcReceiptSchema` (`itc-publish.ts:29`, strict) uses `status`/`effect`, so it is extended rather than replaced.
- itc keys payloads and receipts by plugin name only (feature G211, backlog). voice3 has several operations per plugin (xhs ×4, wechatmp ×2), so keys become per-target ids. This overlaps G211; see Q&A.

### Requirements

- [ ] R1. `kk stage run publish-matrix-plan <workDir> --bundle <bundle.json> --preset <slug> --window <after-generate|cn-peak|overseas-rss> [--channels a,b] [--live-channels a,b] [--dummy]` writes `<workDir>/4-publish/plan.<window>.json`. It has one row per preset target in that window with `mode != off`, carrying id, plugin, operation, variant, tier, window, mode (`dummy|draft|live`), required, approval (`none|required`), status (`planned`), payload path and payload sha256.
- [ ] R2. Launch vars only narrow (`--channels`, matched on plugin or id) or promote to live (`--live-channels`). Promoting a target that the preset does not list in this window, or whose mode is `dummy`, fails the plan (exit 1, named target). `--dummy` forces every planned row to `dummy` (rehearsal). The preset file can never yield `live`: the schema rejects `mode: live`.
- [ ] R3. `kk stage run publish-matrix-check <workDir> --window <w>` runs `kk plugin check` for the distinct plugins of the plan's non-dummy rows. It is warn-only (exit 0) and writes `4-publish/check.<window>.json`.
- [ ] R4. `kk stage run publish-matrix-send <workDir> --window <w> [--retry] [--tier <n>]` sends the plan's rows in tier order (tier 0 serial and blocking: a failed required tier-0 row skips the later tiers). It writes `4-publish/receipts/<id>.json` and appends one line per receipt to `4-publish/publish-events.jsonl`. It reuses itc's resend rules: skip `succeeded`, never resend a live `uncertain|unknown` effect, and `--retry` resends only `effect: none` failures.
- [ ] R5. Send resolves `{{article_url}}` / `{{podcast_url}}` placeholders in the payload from the tier-0 receipts' `url` (surfdash → article, podcast → podcast) into `payloads/content.<id>.resolved.json`. An unresolved placeholder fails that row with `effect: none`, error `unresolved-link`.
- [ ] R6. kk-itc is unchanged in behaviour. The preset schema extension is optional-only, itc rows key as before (id = plugin), and the send loop is shared, not forked. `bun run test` keeps the itc suites green.
- [ ] R7. `docs/04_DESIGN.md` gets the new stage surface and schemas in the same commit (T3).
- Out of scope: dummy send (0322), bundle production (0324/0327), the publish3 workflow (0323), the approval console.

### Acceptance Criteria

- [ ] AC1 — The channel matrix comes from a config-selected publish preset (req: R1, R2)
- [ ] AC2 — Windows select disjoint target sets and never resend (req: R1, R4)
- [ ] AC3 — Live publishing remains launch-only (req: R2)
- [ ] AC4 — kk-itc publish behaviour is unchanged by the shared send core (req: R6)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-22T19:08:54.696Z

- **Q: New `kk publish` noun or stages?** Closed: stages (`kk stage run publish-matrix-*`), which mirror `itc-*` and need no ADR. Revisit only if an operator-facing verb is wanted outside workflows.
- **Q: G211 overlap (itc keys by plugin, drops the profile)?** Closed: this task introduces `targetId` and keys matrix artifacts by it, while itc keeps id = plugin. G211 should adopt `targetId` (add profile to the slug) instead of inventing a second key, so order it after 0321.
- **Q: One plan or one per window?** Closed: one per window (`plan.<window>.json`), sharing `receipts/`. Disjoint row sets plus receipt-existence skips give "never resend" without cross-window state.
- **Q: Where are links resolved?** Closed: at send time from tier-0 receipts. No separate resolve-links node.
- Deferred: approval enforcement inside `send` (now recorded as the `approval` field only), until the console task exists.

### Design

**Frozen names**

- Stages (dispatched in `apps/cli/src/itc-stage.ts` beside the itc ones, or a sibling `publish-matrix-stage.ts` called from `commands/stage.ts:50` the same way): `publish-matrix-plan`, `publish-matrix-check`, `publish-matrix-send`.
- New module `apps/cli/src/publish-matrix.ts`: `BundleSchema`, `PublishPlanRowSchema`, `PublishPlanSchema`, `planPublishMatrix`, `checkPublishMatrix`, `sendPublishMatrix`, `targetId`.
- Preset target extension in `itc-plan.ts:32`, all optional: `id`, `operation`, `variant`, `tier` (int 0–3, default 3), `window` (default `after-generate`), `mode` (`off|dummy|draft`, default `draft`), `required` (default false), `options` (record).
- `targetId(row) = row.id ?? (row.operation ? \`${plugin}.${slug(operation)}\` : plugin)`. The slug keeps CJK and maps whitespace and `/` to `-`. itc rows have no operation, so their key stays the plugin name.
- Receipt: extend `ItcReceiptSchema` (`itc-publish.ts:29`) with optional `target`, `window`, `dummy`, `error`, `startedAt`, `finishedAt`. `mode` stays `draft|live`. The design §5b names map as `ok` ↔ `status === 'succeeded'`.

**Bundle contract (consumed here, produced by 0324)**

```
{ schemaVersion: 1, runId, runDate, parentRunId?, runs: string[],
  episode: { title, guid? },
  variants: { [name]: { path, sha256 } } }
```

- `path` is a `Content` JSON (kk-core `ContentSchema`).
- Variant lookup for a row: `${variant}@${plugin}` first, then `${variant}`. This lets generate ship a channel-specific variant without a preset change.
- A missing variant or a sha256 mismatch fails the plan.

**Payload build (plan time)**

- Copy the variant `Content`.
- Set `metadata.operation = row.operation` and `metadata.publishStatus = mode === 'live' ? 'public' : 'draft'`. Plugins already select through `options.operation ?? content.metadata.operation` (xhs-pub `modes.ts:45`, x-pub `index.ts:97`, threads-pub `:82`) and `metadata.publishStatus`.
- Merge `row.options` into `metadata`.
- Write the result to `4-publish/payloads/content.<id>.json`.
- `approval = mode === 'live' ? 'required' : 'none'`. It is recorded only; enforcement is the workflow's pause node (ADR-022), and the console reads it later.

**Send**

- Generalize the `itcSendTargets` loop (`itc-publish.ts:386`) into a shared `sendRows(rows, keyOf, dispatch)`. itc calls it with `keyOf = plugin`, the matrix with `keyOf = targetId`.
- Dispatch stays `runFanout` with `--content <resolved payload> --target <plugin>` and `--serial-target` for browser transports, exactly as itc does.

**Anti-patterns**

- Do not fork the itc send loop.
- Do not add a `kk publish` noun.
- Do not put channel copy or prompts here; payloads are field mapping only.
- Do not read `live` from any file.

**Handoff:** 0322 adds the `mode: dummy` branch inside `sendRows` before dispatch. 0323 calls these stages. 0325 consumes `check`. 0326 classifies the receipts.

### Plan

1. Write the failure list first (AGENTS testing rule): unknown preset, `mode: live` in a file, a live-channel not in this window, a missing or digest-mismatched variant, a duplicate target id, a placeholder with no tier-0 url, and an itc preset that must still parse. (R1, R2, R5, R6)
2. Extend `PublishPresetTargetSchema` and `ItcReceiptSchema` with the optional fields; run the itc tests unchanged. (R6)
3. Add `publish-matrix.ts`: BundleSchema, plan rows, `targetId`, `planPublishMatrix` writing `plan.<window>.json` and payloads. (R1, R2)
4. Extract `sendRows` from `itcSendTargets`, keep itc on it, and add `sendPublishMatrix` with tier ordering, placeholder resolution and `publish-events.jsonl`. (R4, R5, R6)
5. Add `checkPublishMatrix` over the plan's non-dummy plugins via the existing `plugin check` probe path. (R3)
6. Wire the stage names into the stage dispatcher.
7. Add the E2E test `apps/cli/tests/publish-matrix.test.ts`. It uses a fixture bundle and preset in a tmp works dir, runs plan → send with an injected `dispatch`, and asserts the plan rows, receipts keyed by id, events lines, the no-resend rerun and the live-promotion refusal. Artifact: the fixture work dir's `4-publish/` tree is snapshot-free, and the test asserts on the files. (all)
8. Update `docs/04_DESIGN.md` (T3), then `bun run lint && bun run test && bun run build`. (R7)

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-22T18:59:28.584Z feature_id Q → G15 (system)
- 2026-10-22T19:09:49.375Z backlog → todo (system)

