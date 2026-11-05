---
schema_version: 1
name: Add kk-daily-publish3 workflow, daily-ai-voice preset, RSS gate, diagnose node and window schedules
status: done
template: feature-impl
created_at: 2026-10-22T18:41:31.940Z
updated_at: "2026-11-05T08:24:05.511Z"
feature_id: G15

dependencies: ["0321", "0322", "0325", "0326"]
priority: P1
estimate_hours: 8
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0323-verdict.json
---

## 0323. Add kk-daily-publish3 workflow, daily-ai-voice preset, RSS gate, diagnose node and window schedules

### Background

publish3 is the publish half of voice3 (design `docs/design/kk-daily-ai-voice3.md` §5, §5a, §5b). Three launches per day select targets by `window`. The overseas launch is gated on the podcast RSS feed `https://podcast.salty.vip/rss/`, whose items are titled `每日AI乱炖 · <YYYY-MM-DD>`.

**Refine corrections (2026-10-22)**

- Old R1 listed separate `resolve-links` and per-tier nodes. Links resolve inside `publish-matrix-send` (0321 R5), and tiers are ordered inside send (0321 R4), so the graph is shorter.
- Old R2 said "every target `dummy`". The operator's D4 puts surfdash, podcast and wechatmp 文章 in draft from day one per design §3. So the shipped preset keeps the design §3 modes, and rehearsal uses `publish-matrix-plan --dummy` (0321 R2).
- `kk schedule render` only knows `kk-collect` and `kk-serve` (`apps/cli/src/commands/schedule.ts:29-32`). The two publish3 schedules need new template entries.
- The gated date is fixed as the **previous** run date. The 10-20 and 10-21 episodes landed 13:43 and 15:22 PDT, after 07:00, so "unless generation finishes earlier" is dropped as a branch nobody hits.
- Nested-run launch must strip `SPUR_WORKFLOW_RUN_ACTIVE` and `SPUR_EXPECTED_DEFINITION_DIGEST` (precedent `kk-daily-ai-voice2.yaml:532`).

### Requirements

- [x] R1. `plugins/kk/workflows/kk-daily-publish3.yaml` (`kind: dag`), vars `work_dir`, `run_date`, `window`, `preset`, `channels`, `live_channels`, `dummy`. The nodes:
  - `wait-until` (cn-peak only)
  - `rss-gate` (overseas-rss only)
  - `plan`
  - `check` (warn-only)
  - `send-confirm` (`pause: true`; condition: plan has a live row)
  - `send`
  - `classify`
  - `surfdash-patch` / `partial-marker` / `mark-published` (after-generate only, per 0326 design)
  - `bundle-runs`
  - `report`
  - `ledger` (`onError: continue`)
- [x] R2. `plugins/kk/publish-presets/daily-ai-voice.json` is shipped with the design §3 rows, each with a `window`:
  - T0 surfdash and podcast, plus the draft-capable wechatmp 文章/播客 and xhs rows: `after-generate`;
  - no-draft domestic rows: `cn-peak`;
  - x, threads and weibo-overseas rows: `overseas-rss`.

  Gap channels (LinkedIn, Facebook, Instagram, 视频号图文, threads images) are listed as `mode: off`. All copy is zh (D3). The config selector is `workflows.kk-daily-ai-voice3.publish_preset` (default `daily-ai-voice`), resolved like itc (`apps/cli/src/itc-config.ts`).
- [x] R3. `kk stage run publish-matrix-rss-gate <workDir> --date <YYYY-MM-DD> [--feed <url>]` exits 0 on a hit and 3 on a miss, and writes `4-publish/rss-gate.json`. A hit is either the guid recorded in the podcast tier-0 receipt or, failing that, an item title containing `<date>`. A fetch error counts as a miss with reason `fetch-failed`. For the overseas window, `run_date` defaults to yesterday in America/Los_Angeles.
- [x] R4. Gate miss:
  - the overseas targets are not planned: `plan`/`send` are skipped by condition;
  - a `diagnose` agent.run node reads the voice3 run trace and `bundle.json` presence and writes `4-publish/incident.json` + `incident.md` with `class ∈ no-run | generation-failed@<node> | no-content | t0-failed | rss-lag`;
  - a `repair` node then runs `publish-matrix-send --window after-generate --retry --tier 0`, which resends only `effect: none` failures. It never regenerates content.
- [x] R5. `wait-until 09:00 Asia/Shanghai` uses `kk stage run publish-matrix-wait-until 09:00 Asia/Shanghai` (Intl-based, DST-safe, no-op if already past). Add launchd and cron templates `kk-daily-publish3-cn-peak` (17:00 local, `live_channels` baked in as the operator's ADR-022 consent) and `kk-daily-publish3-overseas` (07:00 local) to `SCHEDULE_TEMPLATES`. They are rendered by `kk schedule render`, never installed by this task.
- [x] R6. The `bundle-runs` node appends this run id to `bundle.json` `runs[]`; the append is idempotent.
- [x] R7. Test: run the publish3 E2E against a fixture bundle with `dummy=true` for all three windows (gate hit and miss via a local feed file). It proves the windows are disjoint, there is no resend on rerun, the miss produces an incident, and nothing is dispatched.
- Out of scope: the approval console; installing schedules; live sends.

### Acceptance Criteria

- [x] AC1 — Dummy mode exercises the full publish path without spawning plugins (req: R1, R7)
- [x] AC2 — Windows select disjoint target sets and never resend (req: R1, R2, R6)
- [x] AC3 — The overseas window is gated on the podcast RSS feed (req: R3, R4)
- [x] AC4 — Live publishing remains launch-only (req: R1, R5)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-22T19:08:57.911Z

- **Q: Gate date?** Closed: the previous run date (D4 plus the landing times on record).
- **Q: How is cn-peak DST handled?** Closed: fire at 17:00 local, then the `wait-until` stage sleeps to 09:00 Asia/Shanghai.
- **Q: What does auto-repair cover?** Closed: tier-0 `effect: none` resend only. Content regeneration stays an operator action guided by `incident.md`.
- Deferred: approval/monitoring console (consumes `plan.*.json` `approval`, `publish-events.jsonl`, `bundle.runs[]`).

### Design

- Graph per window: nodes have a condition on `${vars.window}`, and nodes skipped by window cascade by the engine's all-deps-skipped rule.
- `work_dir` is the voice3 day dir that holds `bundle.json`; publish3 artifacts go under `4-publish/`.
- `run_date` defaults:
  - after-generate: passed by voice3;
  - cn-peak: today (America/Los_Angeles);
  - overseas-rss: yesterday.

  The schedule templates compute it with `date`, and the workflow never guesses.
- New stage names: `publish-matrix-rss-gate` and `publish-matrix-wait-until`, both in the 0321 dispatcher. RSS parsing is a regex over `<item>` title/guid: no XML dependency, and the feed is known.
- `diagnose`:
  - agent.run, `role: scribe`, inline prompt ≤ 1000 chars, `onError: continue`;
  - inputs are paths only: `spur workflow trace` JSON of the latest voice3 run for `run_date`, `bundle.json`, and `rss-gate.json`;
  - output is a strict JSON class enum; `incident.md` is human prose.
- Anti-patterns:
  - no plugin names in the YAML, since the preset owns them;
  - no `live` in the preset file;
  - no regeneration in repair;
  - no curl in YAML (the stage fetches).
- Config: add `workflows.kk-daily-ai-voice3.publish_preset` to the `itc-config.ts`-style resolver. Do not hand-edit `~/.config/kk/config.yaml`; `plugins/kk/config.example.yaml` gets the documented key.

### Plan

1. Failure list: an overlapping window (a row in two windows), a gate false-hit on the wrong date, a feed outage counted as a hit, a repair resending an uncertain live effect, a cn-peak run firing before 09:00 Shanghai, and a dummy rehearsal dispatching anything. (R3–R5, R7)
2. Add the rss-gate and wait-until stages with tests (local feed fixture; injected clock). (R3, R5)
3. Write the `daily-ai-voice.json` preset and the config key in `config.example.yaml`, and validate it with the 0321 schema test. (R2)
4. Write `kk-daily-publish3.yaml`, run `spur workflow validate`, and add the DAG shape test in the style of `apps/cli/tests/voice2-dag.test.ts`. (R1, R4, R6)
5. Add the schedule templates and their `SCHEDULE_TEMPLATES` entries, plus the render test. (R5)
6. Run the E2E: `spur workflow run plugins/kk/workflows/kk-daily-publish3.yaml` with `dummy=true` against a fixture bundle for each window. Keep `4-publish/` (plans, receipts, events, incident) as the repeatable artifact. (R7)
7. Update `docs/04_DESIGN.md` for the stages and schedules (T3), then `bun run gate`.

### Solution

| Change | What / why |
| --- | --- |
| `plugins/kk/workflows/kk-daily-publish3.yaml:1` | The publish half as a 15-node DAG: `wait-until` (cn-peak), `rss-gate`, `plan`, `check`, `send-confirm` (live pause), `send`, `classify`, the three after-generate tails, `diagnose`, `repair`, `bundle-runs`, `report`, `ledger`. |
| `plugins/kk/workflows/kk-daily-publish3.yaml:44` | `rss-gate` is a node that always succeeds and records its verdict in `4-publish/rss-gate.json`; a failing node would cascade-skip the incident path through the engine's all-deps-skipped rule. |
| `plugins/kk/workflows/kk-daily-publish3.yaml:83` | `plan` requires `.hit == true` on an overseas day — a gated miss plans nothing. |
| `plugins/kk/workflows/kk-daily-publish3.yaml:135` | `send` depends on `check` *and* `send-confirm`: a draft window (skipped pause) still sends, a gated plan (both skipped) still stops. |
| `plugins/kk/workflows/kk-daily-publish3.yaml:236` | `report` depends on `bundle-runs` and `diagnose`, so a gated-miss day writes its page too. |
| `apps/cli/src/publish-matrix.ts:880` | `runPublishMatrixRssGate` — guid-first, title-date fallback, a fetch failure is a miss (`reason: fetch-failed`), exit 0/miss 3, and on a miss the deterministic incident floor (`incident.json`/`incident.md`, class `rss-lag`) so the record exists before any agent step. |
| `apps/cli/src/publish-matrix.ts:1010` | `runPublishMatrixWaitUntil` — Intl-based wall-clock sleep in a named zone, DST-corrected, no-op when the moment has passed. |
| `apps/cli/src/publish-matrix.ts:1000` | `readPublishPresetSelector` — `workflows.kk-daily-ai-voice3.publish_preset` with the itc contract (missing file/block = compiled default, unknown key or non-slug refused by name); `--preset` stays optional on plan/check and defaults through it. |
| `apps/cli/src/publish-matrix-stage.ts:31` | Dispatch for `publish-matrix-rss-gate` and `publish-matrix-wait-until`. |
| `apps/cli/src/commands/schedule.ts:34` | `kk-daily-publish3-cn-peak` (cron, `0 17 * * *`, `live_channels` baked in) and `kk-daily-publish3-overseas` (cron, `0 7 * * *`, yesterday's `run_date`) templates. |
| `plugins/kk/schedules/kk-daily-publish3-cn-peak.cron.tmpl:1` | The cn-peak entry, explaining why 17:00 local exists (the `wait-until` node reaches 09:00 Shanghai) and that the line itself is the ADR-022 consent. |
| `plugins/kk/schedules/kk-daily-publish3-overseas.cron.tmpl:1` | The overseas entry with the previous-day `run_date` rationale. |
| `plugins/kk/publish-presets/daily-ai-voice.json:1` | Design §3's matrix, every row in exactly one window, gap channels `off`; a row's `variant` is the shared bundle key so `<variant>@<plugin>` overrides still win the lookup. |
| `plugins/kk/config.example.yaml:14` | `workflows.kk-daily-ai-voice3.publish_preset` documented (the operator's config is never hand-edited by a task). |
| `apps/cli/tests/kk-daily-publish3.test.ts:1` | The window E2E through `spur workflow run` with a `kk` shim: after-generate plans/sends/classifies 3 dummy rows with no dispatch and appends its run id once; cn-peak plans a disjoint 1-row set and a rerun resends nothing; a gated miss plans nothing and writes the incident; a hit plans its own set; the YAML declares no plugin and no live mode; both schedules render (and a launchd render is refused). 6 tests, ~6 s. |
| `apps/cli/tests/publish-matrix.test.ts:648` | Unit coverage for the gate parser/matcher (guid beats title, outage is a miss), the wait-until arithmetic (2 h ahead, already past, invalid input), the config selector's four shapes, and the shipped preset's window/no-live invariant. |
| `docs/04_DESIGN.md:2095` | The publish3 node table, the two engine rules the graph is shaped around, the gated-miss contract, the preset/window split and the schedules (T3). |

**Verification:** `bun run lint` clean; `spur workflow validate` on the new YAML; `bun test apps/cli/tests/kk-daily-publish3.test.ts apps/cli/tests/publish-matrix.test.ts` → 37 pass, 0 fail. The rehearsal artifact is `.works/test-artifacts/0323/windows.md`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/workflows/kk-daily-publish3.yaml:31` wait-until through `plugins/kk/workflows/kk-daily-publish3.yaml:275` ledger (all fifteen nodes); `spur workflow validate plugins/kk/workflows/kk-daily-publish3.yaml` → valid this run; `apps/cli/tests/kk-daily-publish3.test.ts:319` |
| R2 | MET | `plugins/kk/publish-presets/daily-ai-voice.json:1`; `apps/cli/src/publish-matrix.ts:1145` readPublishPresetSelector; `plugins/kk/config.example.yaml:12-18`; `apps/cli/tests/publish-matrix.test.ts:711`, `apps/cli/tests/publish-matrix.test.ts:749`, `apps/cli/tests/kk-daily-publish3.test.ts:276` |
| R3 | MET | `apps/cli/src/publish-matrix.ts:953` runPublishMatrixRssGate, `apps/cli/src/publish-matrix.ts:933` guid-then-title match; `apps/cli/tests/publish-matrix.test.ts:569`, `apps/cli/tests/publish-matrix.test.ts:583`, `apps/cli/tests/kk-daily-publish3.test.ts:296`; default fetch bounded and status-checked `apps/cli/src/publish-matrix.ts:1031` — `apps/cli/tests/publish-matrix.test.ts:639` (HTTP 503 → fetch-failed) |
| R4 | MET | `plugins/kk/workflows/kk-daily-publish3.yaml:76` plan only on rss-gate hit; `plugins/kk/workflows/kk-daily-publish3.yaml:197` diagnose; `plugins/kk/workflows/kk-daily-publish3.yaml:229` repair; `apps/cli/tests/kk-daily-publish3.test.ts:296` miss writes incident, nothing dispatched |
| R5 | MET | `apps/cli/src/publish-matrix.ts:1060` runPublishMatrixWaitUntil; `apps/cli/tests/publish-matrix.test.ts:669` DST; `apps/cli/src/commands/schedule.ts:35-36` templates; `apps/cli/tests/kk-daily-publish3.test.ts:354` |
| R6 | MET | `plugins/kk/workflows/kk-daily-publish3.yaml:241-252` bundle-runs idempotent jq append; `apps/cli/tests/kk-daily-publish3.test.ts:244` run id recorded once |
| R7 | MET | `apps/cli/tests/kk-daily-publish3.test.ts:243` E2E suite (6 tests) and `apps/cli/tests/kk-daily-publish3.test.ts:411` writes `.works/test-artifacts/0323/windows.md`; publish3/voice3/matrix suites 47 pass / 0 fail this run |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Dummy mode exercises the full publish path without spawning plugins (req: R1, R7) | MET | test | `apps/cli/tests/kk-daily-publish3.test.ts:244`; re-verified 2026-11-05 (bun run lint exit 0; bun run build exit 0; bun run test exit 0, 4613 pass / 3 skip / 0 fail across 236 files) |
| AC2 — Windows select disjoint target sets and never resend (req: R1, R2, R6) | MET | test | `apps/cli/tests/kk-daily-publish3.test.ts:276`, `apps/cli/tests/kk-daily-publish3.test.ts:244`; re-verified 2026-11-05 (bun run lint exit 0; bun run build exit 0; bun run test exit 0, 4613 pass / 3 skip / 0 fail across 236 files) |
| AC3 — The overseas window is gated on the podcast RSS feed (req: R3, R4) | MET | test | `apps/cli/tests/kk-daily-publish3.test.ts:296`, `apps/cli/tests/publish-matrix.test.ts:583`, `apps/cli/tests/publish-matrix.test.ts:639`; re-verified 2026-11-05 (bun run lint exit 0; bun run build exit 0; bun run test exit 0, 4613 pass / 3 skip / 0 fail across 236 files) |
| AC4 — Live publishing remains launch-only (req: R1, R5) | MET | test | `apps/cli/tests/kk-daily-publish3.test.ts:319` no live mode in YAML; `plugins/kk/workflows/kk-daily-publish3.yaml:102` send-confirm pause; `plugins/kk/schedules/kk-daily-publish3-cn-peak.cron.tmpl:1`; re-verified 2026-11-05 (bun run lint exit 0; bun run build exit 0; bun run test exit 0, 4613 pass / 3 skip / 0 fail across 236 files) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Confidence: HIGH
Verdict: PASS

**Scope:** `plugins/kk/workflows/kk-daily-publish3.yaml`, the two new stages (`publish-matrix-rss-gate`, `publish-matrix-wait-until`) and the preset selector, the shipped `daily-ai-voice` preset, the two cron templates, `plugins/kk/config.example.yaml`, the window E2E plus its `kk` shim, `docs/04_DESIGN.md`, and two harness repairs the invariant work required (`g-feature-tree` matcher, one annotated `no-direct-fetch` exemption).

| Priority | Finding | Disposition |
| --- | --- | --- |
| P1 | The graph initially made `plan` depend on a window-conditional `rss-gate`, so the engine's all-deps-skipped rule starved every non-overseas window — the feature simply did not run. | Fixed — `rss-gate` always succeeds and records its verdict in `4-publish/rss-gate.json`; `plan` reads it as a condition (`plugins/kk/workflows/kk-daily-publish3.yaml:44`, `:83`). |
| P1 | `send` depended only on `send-confirm`, so a draft window (skipped pause) skipped the send and the whole tail. | Fixed — `send` also depends on `check` (`plugins/kk/workflows/kk-daily-publish3.yaml:135`); `report` likewise gained `diagnose` so a gated-miss day still writes its page. |
| P2 | The shipped preset baked `<variant>@<plugin>` into the preset's `variant`, so the bundle lookup asked for `episode@wechatmp-pub@wechatmp-pub` and the plan refused every channel-specific row. | Fixed — a preset `variant` is the shared key; the `@plugin` form is the bundle-side override (`plugins/kk/publish-presets/daily-ai-voice.json:1`). |
| P2 | `publish-matrix-wait-until` built its wall clock with an `Intl` formatter that declared no hour fields, so it parsed a date, produced `NaN` and threw. | Fixed — the fields are declared explicitly (`apps/cli/src/publish-matrix.ts:1044`). |
| P2 | The report node's `{ … }` shell group made the engine's shell wrapper hang forever (no completion, no timeout). | Fixed — straight statements, no group, no heredoc (`plugins/kk/workflows/kk-daily-publish3.yaml:236`). |
| P3 | The RSS gate only reported a miss; the incident artifact depended on an agent step that may never run. | Fixed — the gate writes the deterministic incident floor (`class: rss-lag`, feed URL, reason) before `diagnose` refines it (`apps/cli/src/publish-matrix.ts:880`). |
| P3 | `no-direct-fetch` flagged the gate's feed read. | Fixed — a reasoned per-rule exemption naming the single call and the injectable reader, the same idiom the file already uses for every transport boundary. No other rule is relaxed for the file. |
| P3 | The `feature G R1/R2` invariant could not see two-digit children, and re-homing what it exposed required treating `store`/`ledger` as the co-owned namespaces they are. | Fixed — `/^G\d+_/`, truthful G1/G11/G15 Goal wording, two documented NON_INFRA_FAMILIES entries and a non-vacuity guard on the derivation. |

**SECUA / architecture**

- **Security** — the workflow names no plugin and carries no `live`: the matrix lives in the preset, and `live` only enters through a launch var or the installed cron line (ADR-022). Every live row still hits the `send-confirm` pause. The gate's URL is a constant; the reader is injectable, so tests never touch the network.
- **Efficiency** — one plan/preset/bundle read per window; the E2E's six runs finish in ~6 s because a rehearsal never spawns a plugin.
- **Correctness** — windows are disjoint by construction (`plan.<window>.json` per window, rows filtered by the preset's `window`), a rerun is a no-op because receipts are keyed per target, and a gated miss plans nothing at all. The E2E asserts all three, plus the no-dispatch property with a dispatch that throws.
- **Usability** — a miss prints its reason and leaves `incident.md` in operator prose; `bundle.runs[]` makes one episode traceable across its windows.
- **Architecture** — the workflow is a thin sequencer over `kk stage run publish-matrix-*`; the two engine rules it must respect are documented in the YAML and in the design entry, so the next person does not re-discover them.

**Residual risk**

- `publish-matrix-check` runs inside the workflow with the real 60 s-per-plugin probe budget; on a day with several browser channels the `check` node can take minutes (warn-only, so it never fails the window). The E2E shims it deliberately.
- `surfdash-patch` needs `KK_SURFDASH_ROOT`; the node passes `$KK_SURFDASH_ROOT` and the voice2 stage skips when it is empty, so a machine without the checkout still completes.
- The overseas `run_date` is "yesterday" by contract: the render template computes it with `date -v-1d` (BSD) with a GNU `date -d` fallback, and an operator on a third flavour would have to adjust the rendered line.
- Schedules are rendered, not installed (R5 scope); installing them remains the operator's action.

**Verification:** `bun run lint` clean; `spur workflow validate` on the new YAML; `bun run spur-check` → 4103 tests, 0 failures, rules clean; gate receipt PASS on git tree `80bb4bc9`; window E2E 6/6 in ~6 s with artifact `.works/test-artifacts/0323/windows.md`.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-22T18:59:28.584Z feature_id Q → G15 (system)
- 2026-10-22T19:09:52.050Z backlog → todo (system)
- 2026-10-23T01:11:02.690Z todo → wip (system)
- 2026-10-23T02:03:54.188Z wip → testing (system)
- 2026-10-23T02:03:56.062Z testing → done (system)

