---
kind: plan
title: kk-itc workflow refactoring discovery
tags: [brainstorm, kk-itc, publishing]
needs_design: true
run_id: idea-itc-ea150d9a-c030-4037-af10-7157fb986cf7
created_at: 2026-10-15
---

# kk-itc review and approaches

## Overview
The user ask is preserved verbatim in the run's idea-input artifact. This review covers kk-itc.yaml, kk-collect.yaml, itc-stages.ts, the workflow-run command, publish/article-adapt skills, manifest/discovery, bot/session binding, store extract/select, executor fan-out, Board ITC readers, and current tests. Planning creates a design and task batch; it executes no publication, login, or paid generation.

## Findings
| Priority | Evidence | Finding and planned response |
| --- | --- | --- |
| High | `plugins/kk/scripts/itc-stages.ts:266`; `plugins/publishings/juejin-pub/plugin.json:7`; `plugins/kk/skills/publish/SKILL.md` | TARGET_PROFILES labels Juejin/InfoQ/Substack/XHS browser-agent routes while current plugins use script drivers. Replace the table and special cursor with discovered capabilities and executor dispatch. |
| High | `plugins/kk/scripts/itc-stages.ts:425` | Variant-level switches combine per-target publication controls. Keep adaptation shared by locale/format/limits, but build isolated target payloads and preserve operation-specific semantics. |
| High | `plugins/kk/scripts/itc-stages.ts:172`; `plugins/kk/workflows/kk-itc.yaml:516` | Report accepts whatever aggregate targets exist; guards accept an absent verdict as dry-run PASS. Require exact expected target reconciliation and valid runtime artifacts; dry-run must be explicit. |
| High | `plugins/kk/scripts/itc-stages.ts:537` | Browser cursor treats file existence as completion; malformed/stale Results need schema and input identity checks. |
| Medium | `apps/cli/src/fanout.ts:196`; `plugins/kk/workflows/kk-itc.yaml` publish-retry | Existing retry selection preserves successful targets, but failed does not establish that a remote effect did not occur. Classify uncertain outcomes and require reconciliation before repeat. |
| Medium | `plugins/kk/workflows/kk-itc.yaml:34`; `plugins/kk/commands/workflow-run.md:48` | Input XOR admits only topic/file. Add explicit collected-topic mode; do not run collection on every authored topic. |
| Medium | `plugins/kk/decisions/extract/ai-news.yaml:15`; `apps/cli/src/commands/store.ts:1277` | Reuse store extraction profiles and topic-scoped selections, rather than duplicate ingestion or parse core-facts markdown. |
| Medium | `apps/cli/src/commands/bot.ts:71`; `packages/kk-core/src/manifest.ts:22` | Bot inventory is cached state. Keep login/open operator-directed and readiness in plugin probes. |
| Medium | `plugins/kk/commands/workflow-run.md:153`; `plugins/kk/workflows/kk-itc.yaml:59` | Audit template-to-shell quoting for operator text, paths, and target names; use argv/file handoffs rather than inserting untrusted strings into shell code. |
| Low | `AGENTS.md`; `docs/00_ADR.md:1210`; `apps/cli/src/commands/stage.ts:40` | Entry doc's sequential-only/planned surface descriptions lag ADR amendments and shipped commands. Fix authority-linked statements in compatibility/docs slice. |

These are source-reviewed findings; no live-site behavior is inferred. The baseline test log is run-scoped and is evaluated separately.

## Approaches
1. **Patch YAML and extend the channel table** — HIGH confidence, 2026-10-15 source: itc-stages.ts. Lowest initial cost, but continued duplication and channel-specific workflow edits; rejected.
2. **Incremental FSM refactor using existing seams** — HIGH confidence, 2026-10-15 sources: manifest.ts, fanout.ts, bot.ts, store.ts. Extend declarative capabilities, keep revision loop and artifact paths, unify dispatch and persist decisions; recommended.
3. **Replace authoring with a DAG and a new router service** — MEDIUM confidence, 2026-10-15 source: ADR-031. Engine supports DAGs, but authoring revisions still need an FSM and a new service adds an unnecessary lifecycle; deferred.

## Design Summary
Keep kk-itc as the state machine. Optional topic discovery consumes kk-collect's stored Doc[] through existing extraction and selection APIs; direct topic/file modes bypass collection. Semantic decisions rank only supplied candidates or suggest a configured preset, write source/default provenance, and never grant live or image spending authority. Publish plugins declare operation-level supported formats/locales/modes/requirements and wire metadata at the plugin boundary. The workflow resolves a deterministic frozen plan, adapts shared variants, and sends per-target Content via kk executor fan-out with existing serial-target controls for shared browsers. Unknown or stale remote outcomes stop automatic recovery. Preserve Board-facing files with additive schema changes and regression tests.

## Self-review and operator disposition
No placeholders, contradictory scope, or speculative new service. All eight inventory items have explicit scope and will receive scenarios. User supplied --auto; proceed recommendation accepted automatically after self-review. Design package required because manifest/config and publishing boundaries change.

## External practice
HIGH confidence, accessed 2026-10-15: AWS Builders’ Library, [Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/). Apply its distinction between repeatable requests and repeated side effects: freeze intent and preserve successful outcomes; do not promise exactly-once browser publication or automatically resend an uncertain operation.

## Next Steps
Create a child of G2 with observable scenarios, design the boundary contracts, and decompose into six cohesive implementation slices. No tasks execute in the idea pipeline.


## Dated correction — 2026-10-15 operator feedback

The initial pure-FSM recommendation above is superseded by the ADR-040 amendment and revised docs/design/kk-itc-refactor.md: top-level DAG plus bounded authoring FSM, canonical KK config/workspace defaults and versioned SEO handoff. The added scope makes independent dependency branches useful. This correction preserves the original review history; it does not assert the new DAG or SEO integration has been implemented. G21 now includes R13–R18 and tasks 0301–0303 carry the added contracts. Date folders remain optional, with undated topic directories as the default pending a different operator preference.


### Revision verification — 2026-10-15

All six revised task checks and feature requirement-inventory coverage pass. The isolated runtime probe used parent `itc-feedback-parent-probe-20261015` and child `itc-feedback-child-probe-20261015`: parent paused, child paused at outline, same child paused at review, child done, parent done. A second parent `itc-feedback-parent-premature-probe-20261015` resumed before its child completed and failed at the completion check. Both children finished in the isolated database. Probe used only notes and marker files, with zero agent calls/publications. Its project root was `/private/tmp/kk-itc-dag-probe.02d3V3`; durable conclusions are recorded here, temporary detailed observations are in the feedback scratch folder. Production draft validation, cancellation and crash recovery remain implementation checks. The first shared-project probe hit SQLite writer contention; it did not establish a successful production continuation.
