The scheduled daily AI news pipeline stopped delivering while Robin was away. Scope authorized on 2026-11-01: investigate failures since 2026-10-26, fix causes and verify tomorrow's unattended run; do not regenerate or publish historical editions. Preserve the starting dirty tree, especially publish-matrix changes and the existing digest-check fix. Workflow edits and runtime activation have been requested separately under AGENTS.md.

Observed evidence:
- Scheduler is live under launchd ai.gobing.spur-serve; each 04:30 local tick ran. Production remains voice2, not the unreleased voice3 migration.
- October 26 run 561af6d9-f2cc-485a-a478-ea8062116bd0 closed no-content: 2 candidates estimated 11 minutes below the configured 15-minute floor.
- October 27–29 parent and nested safety runs retain running records after the scheduled process stopped; no publish receipts exist.
- October 30–November 1 failed at safety. November 1 nested trace 323f6ab8-41fc-4ab3-92d9-aa9e4259cf6e and its saved agent sessions prove the primary wrote valid reports. Unconditional retry agent.run actions delete the primary's expectFile before dispatch; the Claude retry exits 3 with expired OAuth, leaving the gate no report/verdict. The gate correctly blocks and quarantines drafts.
- Primary Pi stages took tens of minutes and lack per-action timeout bounds. A configured codex-sol artifact-write probe passed in 10.6 seconds.
- WeChat readiness is refused (expired authentication). XHS is intentionally disabled and its cached browser lease is stale. Do not turn disabled channels on implicitly or change draft/live permissions.
- Publication settlement marks selections published without checking primary success. Classification discards a single available receipt and can falsely count duplicate/unexpected targets as complete.
- Plan/QC caches use existence alone, making a floor refusal sticky when input supply or runtime settings change.

Evidence remains in existing run artifacts and .works/tmp/test-daily-recovery. Do not copy credentials into reports.
