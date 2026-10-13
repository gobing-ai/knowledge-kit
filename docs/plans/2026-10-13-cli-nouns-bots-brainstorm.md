---
kind: plan
tags: [brainstorm, cli, browser]
needs_design: true
run_id: idea-20261013-cli-bot-7e94
created_at: 2026-10-13
---

# CLI nouns and named browser sessions

## Overview
The complete source registration audit found 27 canonical executable leaves: 24 already use two command words, stage executes at root, and the two store lock operations use three command words. Hidden legacy commands and Commander help are separate compatibility/framework surfaces. This is planning; no runtime surface is changed by this document.

## Approaches
| Approach | Benefit | Cost | Confidence |
| --- | --- | --- | --- |
| Rename by domain throughout | More specific nouns | Large caller churn, no required benefit | MEDIUM |
| Keep valid nouns; normalize stage and lock; share bot sessions | Meets strict shape with smallest behavioral change | Compatibility routing and session tests | HIGH |
| Add browser service or plugin kind | Separate ownership | Duplicates launcher and conflicts with kind model | HIGH (reject) |

Evidence (2026-10-13): apps/cli/src/cli.ts; apps/cli/src/commands/{stage,store,plugin,executor}.ts; packages/publish-harness/src/browser.ts; plugins/publishings/wechatmp-pub/src/index.ts. The machine audit lives in the run scratch; the durable canonical map lives in the design satellite.

## Design Summary
Every visible executable operation has two command words, followed by data arguments. Use stage run and lock acquire/release, preserve all old spellings as hidden routes to shared handlers, and add bot list/login/logout/open. Keep plugin status/check/login because plugin identities and browser profile names have different contracts. A bot is a local persistent Chromium profile plus non-secret default-page metadata, not an agent or plugin kind. Reuse the shared launcher. Preserve plugin-owned readiness and WeChat state capture/injection. Generic URLs require explicit operator confirmation; opening a page or finding cookies does not prove authentication. Defer caller migration until session behavior has regression evidence.

## Recommendation
Proceed with minimal normalization and one shared lifecycle. --auto accepts the recommendation and design-summary review after a clean self-review.

## Next Steps
Create a feature, measurable AC, a design satellite, implementation tasks and a dependent migration-review task. Stop at task handoff.


## Task handoff

Feature [A22](../features/A22_strict-kk-noun-verb-cli-and-named-browser-bots.md) has nine measurable scenarios and four tasks. The planning pipeline completed; every task passed readiness checks. Implementation verification is pending.

| Task | Deliverable | Dependencies |
| --- | --- | --- |
| [0275](../tasks/0275_normalize-kk-stage-and-lock-commands-with-compatible-aliases.md) | Canonical stage/lock commands and compatible aliases | None |
| [0276](../tasks/0276_implement-named-bot-list-login-logout-and-open-lifecycle.md) | Named bot lifecycle and shared profile ownership | None |
| [0277](../tasks/0277_integrate-bot-sessions-with-existing-browser-channel-routine.md) | Existing channel session integration | 0276 |
| [0278](../tasks/0278_review-and-migrate-compatible-cli-and-browser-session-caller.md) | Caller review and supported migration | 0275, 0276, 0277 |

Design: [full command inventory, aliases and session contract](../design/kk-noun-verb-bots.md).

Next command: `/sp-dev-runall --feature A22 --auto`.


## Planning validation

- Full source command inventory: 27 visible executable operations, three irregular paths; canonical/alias map recorded.
- Feature A22 check with requirement inventory: PASS; nine scenarios linked, implementation-verification warnings expected while tasks are todo.
- Tasks 0275–0278: readiness PASS, planning digests bound and dependencies applied by pipeline handoff.
- Spur recommended-pre-check: no findings; git diff whitespace check: PASS.
- Repository lint: blocked by formatting/import errors in unrelated untracked WeChat probe files .probe-0272.ts and .probe-0272b.ts, left untouched. Typecheck did not run because Biome stopped the lint script.
- Runtime tests, build and live authentication were not run for this planning-only change; implementation tasks carry those verification obligations.


## Ready-depth audit follow-up

The 2026-10-13 refineall pass corrects generic/channel scenario ownership, Substack dynamic publication configuration, missing Xiaoyuzhou connector assumptions, stage-run reservation, package dependency closure, failure recovery and subprocess lease ownership. See the durable report at docs/reviews/2026-10-13-A22-ready-refinement.md. The earlier title-only task check was structural planning evidence; the ready-depth audit freezes the actual implementation contracts and requirement bindings.
