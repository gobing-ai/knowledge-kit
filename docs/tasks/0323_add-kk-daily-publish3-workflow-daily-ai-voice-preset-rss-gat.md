---
schema_version: 1
name: Add kk-daily-publish3 workflow, daily-ai-voice preset, RSS gate, diagnose node and window schedules
status: todo
template: feature-impl
created_at: 2026-10-22T18:41:31.940Z
updated_at: "2026-10-22T19:09:52.050Z"
feature_id: G15

dependencies: ["0321", "0322", "0325", "0326"]
priority: P1
estimate_hours: 8
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

- [ ] R1. `plugins/kk/workflows/kk-daily-publish3.yaml` (`kind: dag`), vars `work_dir`, `run_date`, `window`, `preset`, `channels`, `live_channels`, `dummy`. The nodes:
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
- [ ] R2. `plugins/kk/publish-presets/daily-ai-voice.json` is shipped with the design §3 rows, each with a `window`:
  - T0 surfdash and podcast, plus the draft-capable wechatmp 文章/播客 and xhs rows: `after-generate`;
  - no-draft domestic rows: `cn-peak`;
  - x, threads and weibo-overseas rows: `overseas-rss`.

  Gap channels (LinkedIn, Facebook, Instagram, 视频号图文, threads images) are listed as `mode: off`. All copy is zh (D3). The config selector is `workflows.kk-daily-ai-voice3.publish_preset` (default `daily-ai-voice`), resolved like itc (`apps/cli/src/itc-config.ts`).
- [ ] R3. `kk stage run publish-matrix-rss-gate <workDir> --date <YYYY-MM-DD> [--feed <url>]` exits 0 on a hit and 3 on a miss, and writes `4-publish/rss-gate.json`. A hit is either the guid recorded in the podcast tier-0 receipt or, failing that, an item title containing `<date>`. A fetch error counts as a miss with reason `fetch-failed`. For the overseas window, `run_date` defaults to yesterday in America/Los_Angeles.
- [ ] R4. Gate miss:
  - the overseas targets are not planned: `plan`/`send` are skipped by condition;
  - a `diagnose` agent.run node reads the voice3 run trace and `bundle.json` presence and writes `4-publish/incident.json` + `incident.md` with `class ∈ no-run | generation-failed@<node> | no-content | t0-failed | rss-lag`;
  - a `repair` node then runs `publish-matrix-send --window after-generate --retry --tier 0`, which resends only `effect: none` failures. It never regenerates content.
- [ ] R5. `wait-until 09:00 Asia/Shanghai` uses `kk stage run publish-matrix-wait-until 09:00 Asia/Shanghai` (Intl-based, DST-safe, no-op if already past). Add launchd and cron templates `kk-daily-publish3-cn-peak` (17:00 local, `live_channels` baked in as the operator's ADR-022 consent) and `kk-daily-publish3-overseas` (07:00 local) to `SCHEDULE_TEMPLATES`. They are rendered by `kk schedule render`, never installed by this task.
- [ ] R6. The `bundle-runs` node appends this run id to `bundle.json` `runs[]`; the append is idempotent.
- [ ] R7. Test: run the publish3 E2E against a fixture bundle with `dummy=true` for all three windows (gate hit and miss via a local feed file). It proves the windows are disjoint, there is no resend on rerun, the miss produces an incident, and nothing is dispatched.
- Out of scope: the approval console; installing schedules; live sends.

### Acceptance Criteria

- [ ] AC1 — Dummy mode exercises the full publish path without spawning plugins (req: R1, R7)
- [ ] AC2 — Windows select disjoint target sets and never resend (req: R1, R2, R6)
- [ ] AC3 — The overseas window is gated on the podcast RSS feed (req: R3, R4)
- [ ] AC4 — Live publishing remains launch-only (req: R1, R5)

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-22T18:59:28.584Z feature_id Q → G15 (system)
- 2026-10-22T19:09:52.050Z backlog → todo (system)

