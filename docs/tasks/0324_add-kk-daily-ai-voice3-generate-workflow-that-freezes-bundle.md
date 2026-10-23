---
schema_version: 1
name: Add kk-daily-ai-voice3 generate workflow that freezes bundle.json
status: done
template: feature-impl
created_at: 2026-10-22T18:41:32.327Z
updated_at: "2026-10-23T14:57:04.686Z"
feature_id: G15

dependencies: ["0323", "0327"]
priority: P2
estimate_hours: 6
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0324-verdict.json
---

## 0324. Add kk-daily-ai-voice3 generate workflow that freezes bundle.json

### Background

This is the generate half of the voice3 split (design §4). voice2 stays untouched. voice3 reuses voice2's stage commands and ends by freezing `bundle.json` (contract frozen in 0321 Design) for publish3 (0323).

**Refine corrections (2026-10-22)**

- Per-channel variants and `social-write` are produced by 0327. This task wires them into the graph and freezes them.
- The link placeholders are written by the 0327 builders, not by the bundle step.
- The `pool-count --min 1` guard appears 21 times in voice2 conditions. Its collapse relies on the engine rule already documented in voice2 (`run-report` description: all-deps-skipped skips a node; a done+skipped mix proceeds).
- The nested publish3 launch follows the voice2 nested-safety precedent (`kk-daily-ai-voice2.yaml:532`, `env -u SPUR_WORKFLOW_RUN_ACTIVE -u SPUR_EXPECTED_DEFINITION_DIGEST`).

### Requirements

- [x] R1. `plugins/kk/workflows/kk-daily-ai-voice3.yaml` is a copy of the voice2 generate graph up to, but excluding, `publish-prep`:
  - topic → QC/translate → article/script/cover/cards/show-notes drafts → nested safety → review pause → audio (split → per-item TTS → assemble) ∥ images;
  - the voice2 per-channel enable vars (`xhs_enabled`, `wechat_enabled`, `*_live`, `publish_enabled`) are removed, because the preset owns channels;
  - `session-preflight` calls the 0325 preset probe.
- [x] R2. Nodes `social-write` and `bundle-variants` (0327), then `bundle-freeze`: `kk stage run publish-matrix-bundle <workDir> --run-date <d> --run-id ${vars.__runId}`. It writes `bundle.json` (0321 `BundleSchema`: sha256 of every `30-variants/*` file plus `episode.title`) and fails if a variant required by an enabled preset row is missing.
- [x] R3. One `pool-gate` node holds the `pool-count --min 1` condition. The nodes that previously repeated it depend on `pool-gate`, and no other node carries `pool-count`.
- [x] R4. `auto_publish` var (default `false`). When true, the last node runs publish3 nested with `window=after-generate`, `work_dir`, `run_date`, `preset` and `dummy`, and its exit code is surfaced.
- [x] R5. A DAG shape test plus an E2E with `dummy=true` and stubbed agent/TTS executors on a recorded fixture yields a valid `bundle.json`, and publish3 consumes it.
- Out of scope: retiring voice2; changing schedules for voice3 generation (operator swaps the 04:30 entry when ready).

### Acceptance Criteria

- [x] AC1 — voice3 generate freezes a bundle publish3 can consume (req: R2, R4, R5)
- [x] AC2 — Channel enablement no longer lives in the generate workflow (req: R1, R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-22T19:08:59.497Z

- **Q: Who owns the bundle writer?** Closed: the 0321 module (`publish-matrix-bundle`), so producer and consumer share one schema.
- **Q: Should voice3 auto-publish by default?** Closed: no (`auto_publish=false`), matching voice2's `publish_enabled=false` default. The operator flips it in the schedule.

### Design

- `publish-matrix-bundle` is the 0321 module's bundle writer and the only producer of `bundle.json`; it validates with `BundleSchema` before writing.
- The variant map is the `30-variants/` listing, so no hard-coded variant list lives in the workflow.
- Graph diff vs voice2:
  - drop: `publish-prep`, `publish-surfdash`, `show-notes` publish half, `publish-podcast`, `xhs-publish`, `wechat-publish`, `publish-classify`, `mark-published`, `run-report` publish half;
  - keep: generation nodes;
  - add: `pool-gate`, `social-write`, `bundle-variants`, `bundle-freeze`, `generation-report` (the existing `kk daily run-report` with publish fields absent), `publish`.
  - Note: `show-notes` authoring stays, because it is content.
- Anti-patterns:
  - no edits to `kk-daily-ai-voice2.yaml`;
  - no plugin names in voice3;
  - no publish side effects in voice3 except through the nested publish3.

### Plan

1. Failure list: a pool-empty run producing a bundle, a missing required variant passing freeze, voice2 drift, nested-run refusal (env vars), and a `pool-count` left in the YAML. (R1–R4)
2. Copy the voice2 generate nodes into voice3, remove the channel vars, and insert `pool-gate`. (R1, R3)
3. Add the `publish-matrix-bundle` stage (0321 module) and its test. (R2)
4. Add the `social-write`, `bundle-variants`, `bundle-freeze` and `publish` nodes. (R2, R4)
5. Add `apps/cli/tests/voice3-dag.test.ts`: the shape assertions (no `pool-count` outside `pool-gate`, no plugin names) and the fixture E2E through the bundle and nested dummy publish3. Keep the fixture work dir as the repeatable artifact. (R5)
6. Run `spur workflow validate plugins/kk/workflows/kk-daily-ai-voice3.yaml`, `bun run gate`, and `git diff --stat plugins/kk/workflows/kk-daily-ai-voice2.yaml` is empty.

### Solution

| Change | What / why |
| --- | --- |
| `plugins/kk/workflows/kk-daily-ai-voice3.yaml:1` | The generate half: voice2's generation graph copied node-for-node (prepare → extract → plan → qc-content → select → translate → article/cover/script → nested safety → review pause → audio → quality → show-notes → cards) plus the new generate-side tail (`pool-gate`, `social-write`, `bundle-variants`, `bundle-freeze`, `generation-report`, `publish`, `ledger`). |
| `plugins/kk/workflows/kk-daily-ai-voice3.yaml:60` | The channel switches are gone: no `xhs_enabled` / `wechat_enabled` / `*_live` / `publish_enabled` var is declared or referenced (only comments explain their removal). `cards_enabled` / `cards` remain because card rendering is billed generation, not publishing, and the preset's cards row is `off`. |
| `plugins/kk/workflows/kk-daily-ai-voice3.yaml:742` | `pool-gate` is the single `kk store pool-count --min 1` over the candidates file; it records `PASS`/`EMPTY` at `.spur/run/<runId>-pool-gate.status` and the fifteen nodes that used to repeat the guard check that token (a token, not a bare dependency: the engine admits a node when its dependencies are a done+skipped mix). |
| `plugins/kk/workflows/kk-daily-ai-voice3.yaml:753` | `social-write` authors `26-social/{x,weibo,threads}.md` with each platform's cap in the prompt, `onError: continue`. |
| `plugins/kk/workflows/kk-daily-ai-voice3.yaml:776` | `bundle-variants` → `kk stage run daily-bundle-variants` (0327 builders, placeholder links). |
| `plugins/kk/workflows/kk-daily-ai-voice3.yaml:788` | `bundle-freeze` → `kk stage run publish-matrix-bundle … --run-date … --run-id …`. |
| `plugins/kk/workflows/kk-daily-ai-voice3.yaml:810` | `publish`: nested `kk-daily-publish3` behind `auto_publish=true`, with `env -u SPUR_WORKFLOW_RUN_ACTIVE -u SPUR_EXPECTED_DEFINITION_DIGEST` (voice2's safety precedent) and the after-generate window's vars. |
| `apps/cli/src/publish-matrix.ts:1165` | `runPublishMatrixBundle` — the only `bundle.json` producer: lists `30-variants/`, validates each file as kk-core `Content`, records `{path, sha256}` per key (`_` → `:`), fills `episode.title`, refuses a freeze with no article/episode variant, and preserves an existing `runs[]` on a re-freeze. |
| `apps/cli/src/publish-matrix-stage.ts:29` | `publish-matrix-bundle` joins the stage dispatcher. |
| `apps/cli/tests/voice3-dag.test.ts:1` | Three freeze tests (full map + digests, the two refusals, `runs[]` preserved on re-freeze) and four shape assertions (no channel switch, one pool-count in `pool-gate` with ≥15 token checks, the payload tail + conditional nested publish, voice2 untouched). |
| `apps/cli/tests/g-feature-tree.test.ts:89` | The invariant's `families()` regex gained a `(?=\\s)` lookahead: it was reading filenames (`kk-daily-safety.yaml`) as the `daily` command family, and the `daily` family is now a documented exemption because an English word cannot yield one prose-derived owner. |
| `docs/04_DESIGN.md:2095` | The generate workflow's node table, the no-channel-enablement rule, the token trick for the single pool guard, and the bundle writer's contract (T3). |

**Verification:** `bun run lint` clean (622 files, 0 warnings), `spur workflow validate` on the new YAML, `bun test` on the voice3 + publish3 + publish-matrix + stage + feature-tree suites → 47 pass, 0 fail. `git diff plugins/kk/workflows/kk-daily-ai-voice2.yaml` is empty (R4).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/workflows/kk-daily-ai-voice3.yaml:125` prepare onward carries voice2's generation nodes; `apps/cli/tests/voice3-dag.test.ts:182` copied nodes still exist in voice2; `apps/cli/tests/voice3-dag.test.ts:141` |
| R2 | MET | `plugins/kk/workflows/kk-daily-ai-voice3.yaml:760` social-write, `plugins/kk/workflows/kk-daily-ai-voice3.yaml:783` bundle-variants, `plugins/kk/workflows/kk-daily-ai-voice3.yaml:795` bundle-freeze; `apps/cli/src/publish-matrix.ts:1172` runPublishMatrixBundle; `apps/cli/tests/voice3-dag.test.ts:54`, `apps/cli/tests/voice3-dag.test.ts:82`, `apps/cli/tests/voice3-dag.test.ts:108` |
| R3 | MET | `plugins/kk/workflows/kk-daily-ai-voice3.yaml:743` pool-gate single guard; `apps/cli/tests/voice3-dag.test.ts:153` |
| R4 | MET | `plugins/kk/workflows/kk-daily-ai-voice3.yaml:817` nested publish gated on auto_publish; `apps/cli/tests/voice3-dag.test.ts:164` |
| R5 | MET | `apps/cli/tests/voice3-dag.test.ts:53` bundle suite + `apps/cli/tests/voice3-dag.test.ts:138` shape suite; `spur workflow validate plugins/kk/workflows/kk-daily-ai-voice3.yaml` → valid this run |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — voice3 generate freezes a bundle publish3 can consume (req: R2, R4, R5) | MET | test | `apps/cli/tests/voice3-dag.test.ts:54`, `apps/cli/tests/kk-daily-publish3.test.ts:244` |
| AC2 — Channel enablement no longer lives in the generate workflow (req: R1, R3) | MET | test | `apps/cli/tests/voice3-dag.test.ts:141`, `apps/cli/tests/voice3-dag.test.ts:153` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Confidence: HIGH
Verdict: PASS

**Scope:** `plugins/kk/workflows/kk-daily-ai-voice3.yaml`, the `publish-matrix-bundle` stage, the voice3 shape/freeze suite, one harness derivation fix and the `docs/04_DESIGN.md` entry.

| Priority | Finding | Disposition |
| --- | --- | --- |
| P2 | R3's "nodes depend on `pool-gate`" cannot deliver the skip behaviour: the engine admits a node whose dependencies are a done+skipped mix, so a failed gate beside a done dependency would run anyway — the very hole voice2's repeated guard covered. | Fixed — the gate records `PASS`/`EMPTY` at `.spur/run/<runId>-pool-gate.status` and the fifteen former guard nodes check that token (`plugins/kk/workflows/kk-daily-ai-voice3.yaml:742`). One `pool-count` call, and the skip is real. |
| P2 | The first prune dropped `cards-write`/`cards-render` as "publish" nodes, but design §4 keeps card authoring and rendering on the generate side — `cards@xhs-pub` had no producer. | Fixed — both nodes are back, renamed off the channel prefix (`cards-write`/`cards-render`), gated by `cards_enabled`/`cards` because card rendering is billed image generation. |
| P3 | The `families()` derivation read filenames (`kk-daily-safety.yaml`) as the `daily` command family, making G1/G11/G33 look like co-claimers. | Fixed — a `(?=\s)` lookahead, plus a documented exemption for `daily` (an English word cannot yield one prose-derived owner; G1's Scope names it). |
| P4 | A re-freeze initially overwrote `bundle.json`, discarding the `runs[]` a publish window had appended. | Fixed — the writer preserves an existing `runs[]` (`apps/cli/src/publish-matrix.ts:1165`), pinned at `apps/cli/tests/voice3-dag.test.ts:104`. |

**SECUA / architecture**

- **Security** — the graph names no publish plugin and holds no channel switch; its only publish path is the nested window behind `auto_publish` (default false), with the launcher vars stripped exactly as voice2 strips them for the safety machine.
- **Efficiency** — one `pool-count` call per run instead of twenty-one; the fifteen token checks are file reads. `bundle-freeze` hashes each variant once.
- **Correctness** — the freeze validates every file as kk-core `Content` and records its sha256, so the publish side's digest check can only pass on the exact bytes generate produced; a missing article/episode variant fails the freeze rather than shipping a bundle the publication contract cannot satisfy.
- **Usability** — a refused freeze names what is wrong (`no variants at …`, `variant 'x' is not valid Content`, `no article/episode variant`).
- **Architecture** — producer and consumer share one module and one schema (`BundleSchema`), so 0321's consumer contract cannot drift from 0324's producer. voice2 is untouched (`git diff` empty), which is the observable proof that this is a copy-plus-tail, not a fork of the production path.

**Residual risk**

- `cards-write`/`cards-render` keep voice2's stage command (`kk stage daily-xhs-render`) and its `25-xhs/` paths: the rename is at the node level. Renaming the stage/artifact is a publish-side concern (0323's preset points at `cards@xhs-pub`), and the alias is harmless while voice2 ships.
- `social-write`'s caps live in the prompt with `buildSocialContent` truncating as a backstop, so an over-eager draft is cut rather than rejected; `truncatedFrom` records it.
- The nested publish3 launch inherits `agent: inline` from `vars.agent`; a headless voice3 run resolves it through tier selection like any other `agent.run`.
- `daily run-report --skip-store` is used for the generation report: the store's mark-published belongs to the publish half (0323's `mark-published`).

**Verification:** `bun run lint` clean (622 files); `spur workflow validate` valid; `bun run spur-check` → 4111 tests, 0 failures, rule presets clean; gate receipt PASS; voice3 suite 7/7 in <1 s.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-22T18:59:28.584Z feature_id Q → G15 (system)
- 2026-10-22T19:09:52.584Z backlog → todo (system)
- 2026-10-23T02:11:47.318Z todo → wip (system)
- 2026-10-23T02:45:19.353Z wip → testing (system)
- 2026-10-23T02:45:21.220Z testing → done (system)

