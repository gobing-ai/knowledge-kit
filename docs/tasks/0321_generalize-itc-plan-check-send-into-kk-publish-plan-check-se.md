---
schema_version: 1
name: Generalize itc plan/check/send into kk publish plan|check|send with window, mode and approval rows
status: done
template: feature-impl
created_at: 2026-10-22T18:41:31.104Z
updated_at: "2026-11-05T08:24:02.252Z"
feature_id: G15

priority: P1
estimate_hours: 8
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0321-verdict.json
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

- [x] R1. `kk stage run publish-matrix-plan <workDir> --bundle <bundle.json> --preset <slug> --window <after-generate|cn-peak|overseas-rss> [--channels a,b] [--live-channels a,b] [--dummy]` writes `<workDir>/4-publish/plan.<window>.json`. It has one row per preset target in that window with `mode != off`, carrying id, plugin, operation, variant, tier, window, mode (`dummy|draft|live`), required, approval (`none|required`), status (`planned`), payload path and payload sha256.
- [x] R2. Launch vars only narrow (`--channels`, matched on plugin or id) or promote to live (`--live-channels`). Promoting a target that the preset does not list in this window, or whose mode is `dummy`, fails the plan (exit 1, named target). `--dummy` forces every planned row to `dummy` (rehearsal). The preset file can never yield `live`: the schema rejects `mode: live`.
- [x] R3. `kk stage run publish-matrix-check <workDir> --window <w>` runs `kk plugin check` for the distinct plugins of the plan's non-dummy rows. It is warn-only (exit 0) and writes `4-publish/check.<window>.json`.
- [x] R4. `kk stage run publish-matrix-send <workDir> --window <w> [--retry] [--tier <n>]` sends the plan's rows in tier order (tier 0 serial and blocking: a failed required tier-0 row skips the later tiers). It writes `4-publish/receipts/<id>.json` and appends one line per receipt to `4-publish/publish-events.jsonl`. It reuses itc's resend rules: skip `succeeded`, never resend a live `uncertain|unknown` effect, and `--retry` resends only `effect: none` failures.
- [x] R5. Send resolves `{{article_url}}` / `{{podcast_url}}` placeholders in the payload from the tier-0 receipts' `url` (surfdash → article, podcast → podcast) into `payloads/content.<id>.resolved.json`. An unresolved placeholder fails that row with `effect: none`, error `unresolved-link`.
- [x] R6. kk-itc is unchanged in behaviour. The preset schema extension is optional-only, itc rows key as before (id = plugin), and the send loop is shared, not forked. `bun run test` keeps the itc suites green.
- [x] R7. `docs/04_DESIGN.md` gets the new stage surface and schemas in the same commit (T3).
- Out of scope: dummy send (0322), bundle production (0324/0327), the publish3 workflow (0323), the approval console.

### Acceptance Criteria

- [x] AC1 — The channel matrix comes from a config-selected publish preset (req: R1, R2)
- [x] AC2 — Windows select disjoint target sets and never resend (req: R1, R4)
- [x] AC3 — Live publishing remains launch-only (req: R2)
- [x] AC4 — kk-itc publish behaviour is unchanged by the shared send core (req: R6)

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

| Change | What / why |
| --- | --- |
| `apps/cli/src/itc-plan.ts:32` | `PublishWindowSchema` plus the optional matrix fields on `PublishPresetTargetSchema` (`id`, `operation`, `variant`, `tier`, `window`, `mode`, `required`, `options`). Optional-only and `mode` closed over `off|dummy|draft`, so every itc preset still validates and a preset file can never yield a live send (ADR-022). |
| `apps/cli/src/itc-plan.ts:375` | `loadPublishPreset` exposes the existing project→package preset resolver with every row field intact (`resolveItcTargets` narrows to plugin+profile for itc). |
| `apps/cli/src/itc-publish.ts:29` | `ItcReceiptSchema` gains optional `target`, `window`, `dummy`, `error`, `startedAt`, `finishedAt` — additive, so itc receipts are unchanged (R6). |
| `apps/cli/src/itc-publish.ts:322` | `probePlugin` extracts the channel-probe run/parse/redact logic out of `itcCheckTargets` so the matrix probes warn-only on the same seam and env (R3, R6). |
| `apps/cli/src/itc-publish.ts:405` | `SendRow` / `SendRowsOptions` / `sendRows`: the itc send loop generalized (`key` = receipt key). Resend rules, aggregate parsing, effect classification and receipt writing live here once; `--retry` and the never-resend-uncertain-live rule stay byte-for-byte itc's (R4, R6). |
| `apps/cli/src/itc-publish.ts:644` | `itcSendTargets` reduced to row building plus one `sendRows` call with `key = plugin`, so itc artefacts keep their names (R6). |
| `apps/cli/src/publish-matrix.ts:16` | `BundleSchema`, `PublishPlanRowSchema`, `PublishPlanSchema`, `PublishMatrixDeps`, `targetId` (keeps CJK; `${plugin}.${slug(operation)}`), and the link-source contract for placeholders. |
| `apps/cli/src/publish-matrix.ts:140` | `composePlan`: window selection, `--channels` narrowing, `--live-channels` promotion with its refusals, variant lookup `${variant}@${plugin}` → `${variant}`, sha256 verification, payload build (`operation`, `publishStatus`, `options`), approval flag, duplicate-id guard. |
| `apps/cli/src/publish-matrix.ts:315` | `planPublishMatrix` — the `publish-matrix-plan` stage: writes `4-publish/plan.<window>.json`, payloads and `planned` events; exit 1 naming the failing target. |
| `apps/cli/src/publish-matrix.ts:379` | `checkPublishMatrix` — the `publish-matrix-check` stage: probes the plan's non-dummy plugins and writes `check.<window>.json`; warn-only. |
| `apps/cli/src/publish-matrix.ts:434` | `sendPublishMatrix` — the `publish-matrix-send` stage: tier order, serial blocking tier 0, later-tier skip on a failed required tier-0 row, `{{article_url}}`/`{{podcast_url}}` resolution from tier-0 receipts, `publish-events.jsonl`, `--retry`, `--tier`. |
| `apps/cli/src/publish-matrix-stage.ts:10` | Stage-name dispatcher for `publish-matrix-plan|check|send`, mirroring `itc-stage.ts`. |
| `apps/cli/src/commands/stage.ts:47` | `commands/stage.ts` routes `publish-matrix-*` to the new dispatcher beside `itc-*` (no new noun, so no ADR-037 inventory change). |
| `apps/cli/tests/publish-matrix.test.ts:1` | E2E over a fixture works dir (bundle + project preset): the nine failure modes listed at the top, then plan → check → send with an injected `dispatch`, asserting plan rows, receipts keyed by id, `publish-events.jsonl`, the no-resend rerun, tier-0 blocking, link resolution and live-promotion refusal. |
| `apps/cli/tests/publish-matrix-stage.test.ts:1` | Stage-name routing test: each `publish-matrix-*` name reaches its implementation (plan → check → send over a dummy-only plan, so no plugin spawns) and every other name returns `undefined` for the generic runner. |
| `docs/04_DESIGN.md:1966` | New stage surface, preset extension, plan-row/receipt shapes, bundle contract and the dummy-mode handoff to 0322 (T3). |

**Verification:** `bun run lint` clean; `bun test` on the matrix suite plus every itc suite → 4089 tests: 4074 pass, 3 pre-existing skips, 0 fail. A `mode: dummy` row records `error: dummy-mode-not-implemented` instead of spawning a plugin — the explicit seam task 0322 replaces.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/publish-matrix.ts:399` planPublishMatrix → composePlan (`apps/cli/src/publish-matrix.ts:254`) writes plan.<window>.json rows with payload path and digest; `apps/cli/tests/publish-matrix.test.ts:162` asserts every field |
| R2 | MET | `apps/cli/src/publish-matrix.ts:292` unlisted channel refused; `apps/cli/src/itc-plan.ts:50` preset mode is off/dummy/draft only; `apps/cli/tests/publish-matrix.test.ts:244`, `apps/cli/tests/publish-matrix.test.ts:287`, `apps/cli/tests/publish-matrix.test.ts:315` |
| R3 | MET | `apps/cli/src/publish-matrix.ts:466` checkPublishMatrix probes distinct non-dummy plugins, warn-only at `apps/cli/src/publish-matrix.ts:540`; `apps/cli/tests/publish-matrix.test.ts:1293` |
| R4 | MET | `apps/cli/src/publish-matrix.ts:754` sendPublishMatrix through shared `apps/cli/src/itc-publish.ts:472` sendRows; `apps/cli/tests/publish-matrix.test.ts:396`, `apps/cli/tests/publish-matrix.test.ts:441`, `apps/cli/tests/publish-matrix.test.ts:485`, `apps/cli/tests/publish-matrix.test.ts:502`, `apps/cli/tests/publish-matrix.test.ts:530` |
| R5 | MET | `apps/cli/src/publish-matrix.ts:232` LINK_SOURCES placeholders; `apps/cli/src/publish-matrix.ts:845` unresolved-link fails the row without dispatch; `apps/cli/tests/publish-matrix.test.ts:396`, `apps/cli/tests/publish-matrix.test.ts:463`; re-audit fixes: `apps/cli/src/publish-matrix.ts:738` dummy receipts excluded from real-row links, `apps/cli/src/publish-matrix.ts:842` url JSON-escaped on insertion — `apps/cli/tests/publish-matrix.test.ts:1164`, `apps/cli/tests/publish-matrix.test.ts:1191` (both fail on HEAD, pass now) |
| R6 | MET | `apps/cli/src/itc-publish.ts:29` ItcReceiptSchema optional-only extension; `apps/cli/src/itc-publish.ts:705` itcSendTargets keys by plugin; `apps/cli/tests/publish-matrix.test.ts:1357`; itc suites 113 pass / 0 fail this run |
| R7 | MET | `docs/04_DESIGN.md:2016` plan surface, `docs/04_DESIGN.md:2064` send surface; `docs/04_DESIGN.md:2068` JSON-escaped link insertion |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The channel matrix comes from a config-selected publish preset (req: R1, R2) | MET | test | `apps/cli/tests/publish-matrix.test.ts:162`, `apps/cli/tests/publish-matrix.test.ts:244`, `apps/cli/tests/publish-matrix.test.ts:287`; re-verified 2026-11-05 (bun run lint exit 0; bun run build exit 0; bun run test exit 0, 4613 pass / 3 skip / 0 fail across 236 files) |
| AC2 — Windows select disjoint target sets and never resend (req: R1, R4) | MET | test | `apps/cli/tests/publish-matrix.test.ts:222`, `apps/cli/tests/publish-matrix.test.ts:441`, `apps/cli/tests/publish-matrix.test.ts:502`; re-verified 2026-11-05 (bun run lint exit 0; bun run build exit 0; bun run test exit 0, 4613 pass / 3 skip / 0 fail across 236 files) |
| AC3 — Live publishing remains launch-only (req: R2) | MET | test | `apps/cli/tests/publish-matrix.test.ts:315` preset live rejected; `apps/cli/tests/publish-matrix.test.ts:265`, `apps/cli/tests/publish-matrix.test.ts:287` promotion only via launch var; re-verified 2026-11-05 (bun run lint exit 0; bun run build exit 0; bun run test exit 0, 4613 pass / 3 skip / 0 fail across 236 files) |
| AC4 — kk-itc publish behaviour is unchanged by the shared send core (req: R6) | MET | command | `bun test apps/cli/tests/itc-publish.test.ts apps/cli/tests/itc-plan.test.ts apps/cli/tests/itc-presets.test.ts apps/cli/tests/itc-stages.test.ts apps/cli/tests/itc-stage.test.ts` → 113 pass, 0 fail this run; re-verified 2026-11-05 (bun run lint exit 0; bun run build exit 0; bun run test exit 0, 4613 pass / 3 skip / 0 fail across 236 files) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Confidence: HIGH
Verdict: PASS

**Scope:** the working tree for 0321 — `apps/cli/src/publish-matrix.ts`, its stage dispatcher, the `itc-plan.ts`/`itc-publish.ts` extension and extractions, the stage wiring, two test files and `docs/04_DESIGN.md`.

| Priority | Finding | Disposition |
| --- | --- | --- |
| P2 | Tier-0 blocking read only the current pass's receipts (`result.receipts`), so re-entering a window whose required tier-0 rows already succeeded marked the contract broken and skipped every later tier — "never resend" would silently have become "never deliver". | Fixed — `apps/cli/src/publish-matrix.ts:427` reads the on-disk receipt too; regression at `apps/cli/tests/publish-matrix.test.ts:483`. |
| P3 | A `--live-channels` token belonging to another window was validated only inside the row loop, so a plan with no rows in that window accepted a promotion it could never apply. | Fixed — window membership is checked once for both launch-var lists in `composePlan` (`apps/cli/src/publish-matrix.ts:165`). |

**SECUA / architecture**

- **Security** — preset slugs, channel tokens and plugin names are matched, never concatenated into a shell command; payload rewriting happens in-process. `--live-channels` is the only path to a live send and it can only promote a target the preset already lists, preserving the ADR-022 launch-only rule (`apps/cli/src/publish-matrix.ts:165`).
- **Efficiency** — one preset read, one bundle read, one payload write per row; `readLinkMap` reads at most the tier-0 receipts. No per-row directory scans.
- **Correctness** — the plan is a pure function of (bundle, preset, window, launch vars), so identical inputs give byte-identical plans; the send's resend rules are the itc ones inherited through `sendRows` (`apps/cli/src/itc-publish.ts:463`), not a second implementation.
- **Usability** — every refusal names the offending target or channel and exits 1; a green stage prints one summary line.
- **Architecture** — no new noun (stage names only), no new dependency, no `kk publish` verb; the matrix adds one module and one dispatcher beside `itc-stage.ts`. itc keeps `key = plugin`, which is what makes R6 checkable rather than asserted.

**Residual risk**

- A `mode: dummy` row records `error: dummy-mode-not-implemented` instead of a synthetic receipt — an in-scope handoff, not a defect: task 0322 owns that branch, and the placeholder can never spawn a plugin, so a rehearsal cannot reach a channel.

- `LINK_SOURCES` (`apps/cli/src/publish-matrix.ts:143`) names `surfdash-pub`/`podcast-pub` as the owned tier-0 link sources — design §5's publication contract, not a channel table; 0327 owns generate-side payload shaping.
- `checkPublishMatrix` records `ok` for a plugin that declares no `check` entry — `probePlugin`'s existing contract, unchanged from itc.
- The plan does not validate `plugin` + `operation` against each plugin's declared operations (design §5 aspiration); an unknown plugin is only refused at `check`/`send`, where the plugin list is resolved. Filed as a follow-up rather than taken here, to keep 0321's blast radius to the surface its ACs describe.

**Verification:** `bun run spur-check` and a fresh `spur task gate 0321 run` both PASS on the final tree — 4078 tests, 0 failures, pre/post rule presets clean; `docs/04_DESIGN.md:1966` carries the T3 surface note.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-22T18:59:28.584Z feature_id Q → G15 (system)
- 2026-10-22T19:09:49.375Z backlog → todo (system)
- 2026-10-22T19:33:50.503Z todo → wip (system)
- 2026-10-22T20:36:25.769Z wip → testing (system)
- 2026-10-22T20:36:27.974Z testing → done (system)

