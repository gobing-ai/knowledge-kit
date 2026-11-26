---
kind: plan
title: Daily AI Voice Ops Console — brainstorm
tags: [brainstorm, board, daily-ai-voice, ops]
needs_design: true
run_id: 585355ef-b2a2-419b-aacc-19ac0204603f
date: 2026-11-25
---

# Daily AI Voice Ops Console — brainstorm

Ask of record: `.spur/run/585355ef-b2a2-419b-aacc-19ac0204603f-idea-input.md` (replace the Daily AI
Voice Board module with one built for the operator's daily job: a daily summary of generation +
publishing, detail tabs for debugging, and tools to refine/redo particular steps; backend
enhancement allowed with strong reason).

## Overview

### What exists (evidence)

| Area | Today | Evidence |
| --- | --- | --- |
| Board module | Run-centric: one run selection, three views (Summary / Generation / Publishing), plus retired voice2 fallback layout | `apps/board/src/daily-voice/index.tsx:67-78`, `view.ts:457,488-491` |
| Generation workflow | `kk-news-generate` DAG, 20 nodes, re-enterable over a `work_dir` with cached/idempotent stages | `plugins/kk/workflows/kk-news-generate.yaml:1-15` |
| Publishing | `kk-publish` DAG, 9 nodes, one Spur run per window (`after-generate`, `cn-peak`, `overseas-rss`), receipts make reruns no-ops; `--retry` resends only `effect: none` failures | `plugins/kk/workflows/kk-publish.yaml:1-15`, `kk news publish --help` |
| Per-day evidence on disk | `<works>/kk-news-generate/<YYYYMMDD>/`: `step-timing.json`, `5-report/generation.md`, `5-report/publish-<window>.md`, `4-publish/{plan,check,outcome,settlement}.<window>.json`, `publish-events.jsonl`, `dispatch-ledger.json`, safety verdicts, `ledger.md`, `conclusion.md` | `.works/kk-news-generate/20261125/` listing |
| Reader | Loopback, **GET/HEAD/OPTIONS only**; run-bound `results|config|evidence|artifacts`; news evidence DTO already projects generation engines + publish windows/targets | `apps/cli/src/board/reader.ts:719-722,808-836`; `apps/board/src/contracts.ts:160-280` |
| Spur Board HTTP | Run reads only (`/api/runs`, `/:runId`, `/progress`); no rerun/cancel route | `spur.js` route grep (spur 0.4.47) |
| Redo primitives (CLI) | `spur workflow run <def> --from <node> --from-run <runId>` (fresh run from a node, inheriting vars); `spur workflow cancel`; `spur workflow profile <wf>` (per-node profile over last N runs); `kk news publish --window --retry --channels --dry-run`; `kk news generate --dry-run`; per-step verbs `kk news generate-{render,voice,cards,bundle}`, `publish-{plan,check,send,settle,report}`; `kk store release` | `spur workflow --help`, `spur workflow run --help`, `kk news --help` |
| Governance | ADR-035: Spur owns execution; the KK reader is read-only | `docs/00_ADR.md:1337-1345` |

### The gap

The operator's unit of work is **the day** (one episode: one generation run + up to three publish
windows + safety loop), not a single Spur run. Today's module forces picking runs one at a time,
never answers "is today OK and what needs me?", and offers no way to act: every redo means
reconstructing a `spur workflow run --from … --from-run …` or `kk news publish --window … --retry`
command by hand from evidence files.

## Approaches

### A. Day-centric read-only console + command recipes

Rebuild the module around a **day** selector. A new reader route `GET /api/days/<YYYYMMDD>` joins the
day's generation run, its publish-window runs and safety outcome into one `DailyDigest` DTO (one
shared `projectDay()` used by the reader and by a `kk news digest` CLI). Tabs: **Today** (digest +
attention list), **Generation** (node timeline, attempts, fallbacks, artifacts, logs), **Publishing**
(window × target matrix with receipts, errors, effect), **History** (N-day health strip, per-node
duration trend from `spur workflow profile`). Every attention item carries a **recipe**: the exact,
pre-filled command (e.g. `kk news publish --run-date 20261125 --window after-generate --retry
--channels shipinhao-pub`) with a copy button and a `--dry-run` variant.

- Trade-offs: zero new write surface, no ADR-035 reversal, smallest blast radius; but the operator
  still switches to a terminal to act, and long-running reruns are not observed from the action
  point.
- Sources: local evidence above; "runbook link per alert" is the standard SRE alerting pattern
  (Google SRE book, ch. "Monitoring Distributed Systems" — UNVERIFIED URL, cited from knowledge).

### B. A + guarded action plane (recommended, phased)

Everything in A, plus a **KK-owned action endpoint** on the same loopback reader:
`POST /api/actions/<kind>` over a closed allowlist of action kinds that map 1:1 to existing verbs
(no new execution logic):

| Action | Maps to |
| --- | --- |
| Rerun generation from node X | `spur workflow run kk-news-generate.yaml --from <node> --from-run <runId>` |
| Retry failed publish targets in a window | `kk news publish --run-date D --window W --retry [--channels …]` |
| Re-run a publish window (dummy/live per launch consent) | `kk news publish --window W [--dummy]` |
| Re-render a step with an allowlisted override (fine-tune) | `kk news generate-voice` / `generate-cards` / `generate-render` with allowlisted flags |
| Cancel a live run | `spur workflow cancel <runId>` |
| Release a day's store selections | `kk store release --run …` |

Safety envelope (industry pattern: Dagster "re-execute from failure", Airflow "clear task +
downstream", Argo "retry", Rundeck-style runbook automation — UNVERIFIED URLs, cited from
knowledge): every action is **preview-then-confirm** (the endpoint first returns the resolved argv +
`--dry-run` output, then executes only with a single-use confirm token bound to that preview);
**single-flight** per day via the existing `kk lock`; **live sends stay launch-only** (ADR-022 — a
live publish action requires an explicit typed confirmation, never a default); **append-only audit
log** `<works>/kk-news-generate/<day>/actions.jsonl`; actions **disabled by default** behind a
config switch; origin/host checks unchanged; spawned runs are tracked by run id so the console
follows them live.

- Trade-offs: answers the full ask (act where you look); needs an ADR-035 amendment (reader stops
  being GET-only, but Spur still owns execution — the endpoint only launches existing verbs); new
  security surface (CSRF from a malicious local page is mitigated by exact-origin check + confirm
  token + loopback host).
- Phasing: phase 1 ships A (digest + tabs + recipes); phase 2 adds the action plane reusing the
  same recipe objects as the action payload — so phase 1 is not throwaway.

### C. CLI-first digest, thin board

Make `kk news digest --run-date D` the product (markdown/JSON daily report, push notification
later); the board only renders that report and links artifacts.

- Trade-offs: cheapest; works headless/cron; but no interactive debugging, no drill-down, no
  tools — fails I3/I4/I5.
- Sources: existing `kk news report` / `5-report/*.md` already produce per-run reports.

## Recommendations

**B, phased.** A alone leaves the "tools" ask as copy-paste; C fails the detail-tab and tools asks.
B's phase 1 is A, and its recipes become phase 2's action payloads, so value lands early and the
riskier write path lands behind a switch with its own ADR amendment.

## Design Summary

- **Unit of view = day.** Day key `YYYYMMDD` = the generation `work_dir`; the day joins one
  `kk-news-generate` run (latest attempt, earlier attempts listed), `kk-publish` runs for that
  `work_dir` grouped by window, and the safety verdict.
- **One projection, two consumers.** `projectDay()` in `apps/cli/src/board/` builds `DailyDigest`
  (status, outcome, attention items with severity + recipe, generation summary, publishing matrix,
  step timings, cost/tokens where recorded, links to artifacts). Served by `GET /api/days/<day>` and
  `GET /api/days?from&until` (list for History); also rendered by `kk news digest` (markdown/JSON).
- **Truthfulness rules stay.** Unknown is explicit (`Availability`, null ≠ 0), producer-success
  gating of artifacts stays, bounded diagnostics only.
- **New module, old one retired.** Replace `apps/board/src/daily-voice/` with a new module (same
  route id so bookmarks survive); drop the voice2 fallback layout and retired `WorkflowName`
  members' Daily-only code.
- **Tabs:** Today · Generation · Publishing · History · Actions log. Detail tabs reuse the existing
  news evidence DTO for per-run drill-down.
- **Action plane (phase 2):** closed allowlist, preview → confirm token → spawn existing verb,
  single-flight, audit jsonl, default-off switch, live sends need typed confirmation. Requires an
  ADR-035 amendment before code.
- **Out of scope:** in-browser editing of script/article text, push notification of the digest,
  multi-user auth.

## Next Steps

1. Feature + AC from this report (idea-pipeline feature-create / ac-generate).
2. System design: ADR-035 amendment (action plane) + `docs/design/daily-voice-ops-console.md`.
3. Decompose: digest projection → reader routes → CLI digest → module shell + tabs → action plane →
   E2E.
