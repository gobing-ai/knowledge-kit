# Voice3 migration task handoff — 2026-10-25

Seven self-contained implementation specifications filed under reopened feature G15. All 23 findings and five operating constraints are covered. No production implementation, publication or scheduler activation was performed.

| WBS | Priority | Scope | Depends on | Estimate | Spec check | Execution admission |
| --- | --- | --- | --- | --- | --- | --- |
| [0329](/Users/robin/xprojects/knowledge-kit/docs/tasks/0329_repair-voice3-generation-closure-pool-routing-and-complete-e.md) | P1 | Repair voice3 generation closure, pool routing and complete episode bundles | none | 10h | PASS | PASS now |
| [0330](/Users/robin/xprojects/knowledge-kit/docs/tasks/0330_enforce-operation-specific-draft-and-live-boundaries-for-mat.md) | P1 | Enforce operation-specific draft and live boundaries for matrix publishing | none | 8h | PASS | PASS now |
| [0331](/Users/robin/xprojects/knowledge-kit/docs/tasks/0331_carry-reviewed-variant-safety-and-platform-exclusions-throug.md) | P1 | Carry reviewed variant safety and platform exclusions through the voice3 bundle | 0329, 0330 | 12h | PASS | wait for dependencies |
| [0332](/Users/robin/xprojects/knowledge-kit/docs/tasks/0332_bind-matrix-receipts-links-and-rss-proof-to-the-current-bund.md) | P1 | Bind matrix receipts, links and RSS proof to the current bundle revision | 0331 | 10h | PASS | wait for dependencies |
| [0333](/Users/robin/xprojects/knowledge-kit/docs/tasks/0333_make-publish3-outcomes-retries-and-store-settlement-receipt-.md) | P1 | Make publish3 outcomes, retries and store settlement receipt-aware | 0332 | 8h | PASS | wait for dependencies |
| [0334](/Users/robin/xprojects/knowledge-kit/docs/tasks/0334_prepare-correct-voice3-migration-schedules-and-an-explicit-s.md) | P1 | Prepare correct voice3 migration schedules and an explicit safe channel preset | 0329, 0330, 0332 | 6h | PASS | wait for dependencies |
| [0335](/Users/robin/xprojects/knowledge-kit/docs/tasks/0335_prove-voice3-replacement-with-a-fresh-offline-multi-window-m.md) | P2 | Prove voice3 replacement with a fresh offline multi-window migration rehearsal | 0333, 0334 | 8h | PASS | wait for dependencies |

Order: 0329 and 0330 → 0331 → 0332 → 0333 and 0334 → 0335. Initial tasks can use separate worktrees; inspect shared matrix edits before integrating. Downstream task specifications are complete; their strict todo/precheck admission intentionally rejects unfinished prerequisites. Do not remove dependency edges or fabricate done statuses.

Each task has Requirements, frozen Design, exact source/test ownership, closed Q&A, feature-aligned AC with R-item coverage, failure-first E2E cases, estimates, source premises, dependency handoffs and required checks. Implementation-ready checklist evidence is in readiness.json. The source-local Spur planning-digest implementation is absent; no pipeline-ready digest is fabricated.

Task check passes for all seven (dependent tasks carry only unfinished-prerequisite warnings). G15 feature check passes with only expected unverified-scenario warnings; no implementation verdict is claimed. Strict immediate admission passes for 0329/0330. The final rehearsal produces measured evidence and a recommendation; production cutover remains separately authorized.

Finding coverage:

| Finding | Owning task(s) |
| --- | --- |
| C01 | 0330, 0334, 0335 |
| C02 | 0334, 0335 |
| C03 | 0334, 0335 |
| C04 | 0334, 0335 |
| C05 | 0334, 0335 |
| F01 | 0329 |
| F02 | 0329 |
| F03 | 0330 |
| F04 | 0331 |
| F05 | 0331 |
| F06 | 0329 |
| F07 | 0333 |
| F08 | 0334 |
| F09 | 0334 |
| F10 | 0334 |
| F11 | 0332 |
| F12 | 0332 |
| F13 | 0332 |
| F14 | 0333 |
| F15 | 0329 |
| F16 | 0329 |
| F17 | 0332 |
| F18 | 0333 |
| F19 | 0332 |
| F20 | 0333 |
| F21 | 0329 |
| F22 | 0335 |
| F23 | 0329 |

Next commands: `/sp:dev-run 0329` and `/sp:dev-run 0330` (independent initial work). For dependency-aware batch execution when explicitly requested: `/sp:dev-runall --feature G15 --auto`; the batch resolves the new todo tasks while retaining original completed task history.

Accepted scope: zh-only variants; manual live send-confirm; launch-only publish_live_channels; explicit migration preset real/dummy/off inventory; offline clock/RSS fixtures. No new channels, remote draft-promotion API, real account probes, installed-package synchronization, production config edits or schedule installation.

Final corpus validation: recommended-pre-check ran 58 rules with zero findings (exit 0); git diff --check exit 0. No production source edits were made by this filing; the pre-existing matrix source/test changes were preserved.
