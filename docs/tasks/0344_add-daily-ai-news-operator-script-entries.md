---
schema_version: 1
name: Add daily AI news operator script entries
status: done
template: feature-impl
created_at: 2026-11-07T17:51:32.116Z
updated_at: "2026-11-07T20:07:04.312Z"

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 6
done_forced: "false"
done_reason: unforced close
---

## 0344. Add daily AI news operator script entries

### Background

Daily AI news currently requires remembering the supervised voice3 launch, the dated bundle contract, the publish-window launcher, the read-only supply report, and the offline migration rehearsal. Robin requested three package-script entries to save time: generate, post, and validate. On 2026-11-07 the scheduled run left article/audio artifacts but no bundle, so incomplete-generation detection must not treat intermediate files as ready to publish.

The active scheduler and installed package stay unchanged. Validation and tests must not perform real generation, paid provider calls, or publication. Existing configured channel modes and live-confirmation gates remain authoritative.

### Requirements

- [x] R1. Add a `daily-news:generate` package entry that supervises the existing voice3 generation DAG with `auto_publish=false`, the current 72h/agent settings, and an honest terminal receipt for done, no-content, incomplete, or failed generation without publishing.
- [x] R2. Add a `daily-news:publish` package entry defaulting to `after-generate`; require a valid current-day frozen bundle, interactively offer generation when it is missing/incomplete, refuse unattended implicit generation, and delegate posting to the existing window launcher without weakening RSS, receipt, safety, or live-confirmation gates.
- [x] R3. Add a `daily-news:validate` package entry that diagnoses tools, required files, installed stage compatibility, read-only store supply, scheduler wiring, dated generation/safety/publication state, and runs the existing offline voice3 dogfood rehearsal by default; write a durable JSON/log evidence bundle and exit nonzero on failed required checks without real generation or posting.
- [x] R4. Add failure-first subprocess/E2E coverage and same-change operator documentation; preserve existing schedules, installed runtime files, channel defaults, and unrelated work.

### Acceptance Criteria

```gherkin
Scenario: AC1 — generation never posts and reports bundle readiness (req: R1)
Given the voice3 workflow is launched through the generate entry with test doubles
When generation finishes with or without a frozen bundle
Then auto_publish is false and the receipt distinguishes done from incomplete or no-content
And no publish-window launcher is invoked

Scenario: AC2 — posting repairs only with operator consent (req: R2)
Given today's bundle is missing or incomplete
When an interactive operator accepts generation
Then the generate entry runs before after-generate posting
And a non-interactive invocation instead refuses with the exact generate command

Scenario: AC3 — posting refuses stale or invalid generation (req: R2)
Given a wrong-day, malformed, hash-mismatched, or unsafe bundle
When posting is requested
Then no publishing process starts and the diagnostic names the generation problem

Scenario: AC4 — validation separates live health from offline dogfood (req: R3)
Given a fixture with a failed dated run and working offline rehearsal doubles
When validation runs
Then its durable report records the dated failure independently of dogfood results
And no real generation, provider, network publication, scheduler mutation, or store write occurs

Scenario: AC5 — the three entries are documented and regression checked (req: R4)
Given the package scripts and focused failure-first tests
When the public surfaces and project checks run
Then all three entries behave as documented and only intentional files changed
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-07T17:53:45.215Z

Robin chose prompt-then-generate when the bundle is incomplete: interactive runs ask first, while non-interactive runs stop with the exact generate command. The posting entry defaults to `after-generate`; the existing `cn-peak` and `overseas-rss` schedules remain separate. Validation must be read-only against live state and use the offline voice3 rehearsal for dogfood, never a real generation or posting run.

#### Q&A entry — 2026-11-07T19:43:22.280Z

Independent review found six readiness/admission/validation gaps. Dispositions implemented and regression-checked: generation now shares the operator CLI's fail-closed inspector; empty variants and dummy mode never bypass safety; any nonzero dogfood exit fails; scheduler validation parses enabled jobs and active template lines; done receipts require exitCode 0 and outcomes bind their internal window; PTY acceptance and failed-live/enabled-dogfood combinations are covered. A transient supervisor receipt now reads `inspecting` only during its terminal admission probe, preventing self-confirmation while preserving running-run refusal for operators.

### Design

Add three root package scripts named `daily-news:generate`, `daily-news:publish`, and `daily-news:validate`.

Generation reuses `plugins/kk/scripts/daily-scheduled-run.ts`; its voice3-only `--generate-only` switch sets `auto_publish=false`. After the child reaches a terminal state, the supervisor calls the same `scripts/daily-ai-news.ts inspect` bundle-admission owner used by publishing and validation; a terminal run is done only for a complete bundle, no-content follows the existing summary, and malformed/missing/unsafe bundles are incomplete. The package entry supplies the current voice3, 72h, codex-sol/claude settings. No scheduler command changes.

The repo operator CLI `scripts/daily-ai-news.ts` owns inspect/publish/validate. Publish resolves the works root with KK_WORKS_DIR > config works_dir > repo .works, and validates canonical bundle schema/date, non-empty contained variants, variant hashes and final-variant safety. Empty variants and `--dummy` never bypass admission. It prompts only on a TTY (with explicit `--yes`), invokes the package generate entry when accepted, then delegates to `voice3-publish-window.ts`. Default window is after-generate; explicit alternate windows and publisher flags pass through. Overseas/yesterday or historical missing bundles never trigger today's generation; invalid existing bundles are never auto-regenerated.

Validate reuses `kk stage daily-preflight`, `ai-news-supply-report.ts`, canonical bundle/outcome schemas, parsed scheduler jobs/templates, and `apps/cli/tests/voice3-migration.e2e.test.ts`. It checks done receipts only with exitCode 0 and binds each outcome's internal window/date. It writes timestamped JSON plus captured logs below `.works/tmp/test-daily-ai-news/` and isolates dogfood coverage from the project artifact. Dogfood requires exit 0 plus observed passes and zero failures from combined stdout/stderr; any nonzero exit fails even with green-looking counts. `--skip-dogfood` provides the fast read-only diagnostic. No live provider, publisher, scheduler mutation, or installed-package sync is part of this task.

Failure-first tests use temporary roots, a real PTY, and recording doubles for `spur`, `kk`, and generate/publish commands. Surface docs are `docs/04_DESIGN.md` and the daily voice3 design runbook. Repository-wide lint/typecheck/pre-check run in an isolated task-only worktree so unrelated concurrent Weibo work remains untouched.

### Plan

- [x] Record the three-entry requirements, operator decisions, and failure matrix through Spur.
- [x] Write failing subprocess/E2E tests for generate-only receipts, bundle admission, prompt/non-TTY behavior, publish delegation, and validation evidence.
- [x] Implement the smallest supervisor and operator-CLI changes and add the three package scripts.
- [x] Run focused public-surface probes and offline dogfood; fix root causes without real generation or publication.
- [x] Update the design/operator documentation, run required project gates, review the diff, and record verification through Spur.

### Solution

Implemented the three daily AI-news operator entries without changing the active schedule, channel matrix, installed package, or workflow graphs.

- `package.json:48-50` adds `daily-news:generate`, `daily-news:publish`, and `daily-news:validate` over one repo-local operator CLI.
- `plugins/kk/scripts/daily-scheduled-run.ts:20` and `plugins/kk/scripts/daily-scheduled-run.ts:40-47` add voice3-only `--generate-only` and force `auto_publish=false`. `plugins/kk/scripts/daily-scheduled-run.ts:322-373` invokes the shared terminal bundle inspector, records its verdict, and distinguishes done/no-content/incomplete without requiring publish receipts.
- `scripts/daily-ai-news.ts:64-79` matches the existing works-root precedence. `scripts/daily-ai-news.ts:116-176` is the single fail-closed bundle-admission owner: canonical schema/date, non-empty contained variants, SHA-256 and mandatory final-variant safety (including dummy launches).
- `scripts/daily-ai-news.ts:203-225` wraps supervised voice3 72h generation and help. `scripts/daily-ai-news.ts:239-248` exposes the supervisor's shared inspection seam. `scripts/daily-ai-news.ts:250-326` implements real-TTY consent, explicit `--yes`, non-TTY refusal, no-content/running/historical/invalid guards, generation-then-post ordering, and default after-generate delegation.
- `scripts/daily-ai-news.ts:336-605` implements tool/file/installed-stage/read-only-supply diagnostics, parsed enabled scheduler jobs/templates, receipt exit-code and outcome window/date identity checks, durable evidence, and offline dogfood. `scripts/daily-ai-news.ts:572` requires dogfood exit 0 plus observed passes and zero failures; its coverage is isolated from the project artifact.
- `scripts/tests/daily-ai-news.test.ts:204-567` adds 14 failure-first public-surface tests (105 assertions) with temporary stores/workspaces, recording doubles and a real PTY; `scripts/tests/daily-ai-news.test.ts:35-42` derives dates dynamically in America/Los_Angeles. Coverage includes malformed generation, empty/dummy safety bypasses, nonzero dogfood, receipt/window mismatches, and failed-live/passing-dogfood.
- `docs/04_DESIGN.md:1089-1118` and `docs/design/kk-daily-ai-voice3.md:316-342` document commands, consent, safety rails, evidence and read-only limits.

The real validator against 2026-11-07 intentionally reports FAIL for the missing bundle, failed receipt, refused draft safety and stale installed runner; its offline dogfood exits 0 with 13 pass / 0 fail. No real generation, provider call, publication, scheduler mutation, or installed-package sync occurred.

Unrelated concurrent work at `plugins/publishings/weibo-pub/src/probe-publish-dom.ts` is preserved. Final lint/typecheck and 58 pre-rules pass in an isolated task-only worktree; full build, 4,682 tests and both post-rules pass in the main checkout.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/scripts/daily-scheduled-run.ts:322-373` shares fail-closed terminal bundle inspection and records `generationInspection`; `scripts/tests/daily-ai-news.test.ts:254-341` proves valid done, malformed/missing incomplete, no-content, and `auto_publish=false` with no publish3 invocation. `package.json:48` exposes the entry. |
| R2 | MET | `scripts/daily-ai-news.ts:116-176` rejects wrong-date/malformed/empty/hash/unsafe bundles before any spawn; `scripts/daily-ai-news.ts:250-326` implements TTY/`--yes`/non-TTY consent and generation-before-after-generate delegation. `scripts/tests/daily-ai-news.test.ts:346-457` covers the real launcher, real PTY acceptance, dummy/empty safety refusal, and no-content/running/historical guards. |
| R3 | MET | `scripts/daily-ai-news.ts:336-605` checks tools/files/installed stages/read-only supply/parsed scheduler wiring/receipt and outcome identities, writes durable evidence, and isolates dogfood coverage. `scripts/tests/daily-ai-news.test.ts:460-567` covers failed-live plus passing and failing dogfood, nonzero green-looking output, inconsistent identities, and input hashes. Real validation evidence: `.works/tmp/test-daily-ai-news/2026-11-07T194017-094Z-20477/validation.json` has live FAILs and dogfood 13/0. |
| R4 | MET | `scripts/tests/daily-ai-news.test.ts:204-567` has 14 tests / 105 assertions; `docs/04_DESIGN.md:1089-1118` and `docs/design/kk-daily-ai-voice3.md:316-342` document all three entries. Final `KK_BROWSER_CHANNEL=chrome bun run test`: 4,682 pass / 0 fail / 24,354 assertions, all coverage thresholds; `bun run build`: PASS; isolated task-only `bun run lint`: PASS; 58 pre-rules and 2 post-rules: PASS. No real generation/publication, scheduler mutation, or installed sync occurred. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — generation never posts and reports bundle readiness (req: R1) | MET | test | `scripts/tests/daily-ai-news.test.ts:254-341` uses schema/hash/safety-valid success fixtures and proves malformed bundles cannot return done or invoke publish3. |
| AC2 — posting repairs only with operator consent (req: R2) | MET | test | `scripts/tests/daily-ai-news.test.ts:364-423` proves non-TTY refusal, explicit consent ordering, and real PTY acceptance before after-generate posting. |
| AC3 — posting refuses stale or invalid generation (req: R2) | MET | test | `scripts/tests/daily-ai-news.test.ts:425-442` rejects wrong-day, malformed, bad hash, missing safety, empty variants and unsafe dummy bundles before any spawn. |
| AC4 — validation separates live health from offline dogfood (req: R3) | MET | test | `scripts/tests/daily-ai-news.test.ts:538-567` keeps live FAIL visible with dogfood PASS and rejects nonzero dogfood with green-looking counts. Real `.works/tmp/test-daily-ai-news/2026-11-07T194017-094Z-20477/dogfood.log`: 13 pass / 0 fail while the validation report remains FAIL for live state. |
| AC5 — the three entries are documented and regression checked (req: R4) | MET | command | `package.json:48-50`; final full suite 4,682/0, build PASS, isolated lint/typecheck PASS, 58 pre-rules + 2 post-rules PASS; `docs/04_DESIGN.md:1089-1118`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0344

**Scope:** package entries, supervisor, operator CLI, failure-first tests, and same-change operator docs; unrelated Weibo probe excluded.
**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture.
**Verdict:** PASS
**Confidence:** HIGH

Independent reviewer close-out: all six findings FIXED; no concrete blocker remains. Final evidence: focused 14 pass / 0 fail / 105 assertions; existing supervisor/launcher 16 / 0; full suite 4,682 / 0 / 24,354 assertions; build PASS; isolated lint/typecheck PASS; 58 pre-rules and 2 post-rules PASS; real offline dogfood 13 / 0.

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P2 (major) | correctness / architecture | Generate-only originally equated bundle existence with readiness | `plugins/kk/scripts/daily-scheduled-run.ts:322-373` | FIXED — shared fail-closed inspector and valid/malformed regressions |
| 2 | P2 (major) | security / correctness | Empty variants and dummy mode could bypass safety admission | `scripts/daily-ai-news.ts:157-175` | FIXED — non-empty variants and mandatory safety for every launch |
| 3 | P2 (major) | correctness | Dogfood exit classification could false-PASS or false-FAIL | `scripts/daily-ai-news.ts:563-578` | FIXED — exit 0 plus observed green counts; real 13/0 receipt |
| 4 | P3 (minor) | correctness / usability | Scheduler check matched raw text rather than active wiring | `scripts/daily-ai-news.ts:446-496` | FIXED — parsed enabled jobs, cron/commands and active template lines |
| 5 | P3 (minor) | correctness | Receipt and outcome identities were under-checked | `scripts/daily-ai-news.ts:509-552` | FIXED — done requires exit 0; outcome window/date must match |
| 6 | P3 (minor) | test coverage | Real PTY consent and failed-live/passing-dogfood cases were absent | `scripts/tests/daily-ai-news.test.ts:387-423`, `scripts/tests/daily-ai-news.test.ts:538-552` | FIXED — both public-surface scenarios pass |

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Supervised publish-inert generation and shared terminal admission at `plugins/kk/scripts/daily-scheduled-run.ts:322-373` |
| R2 | MET | Consent, safety and launcher delegation at `scripts/daily-ai-news.ts:250-326` |
| R3 | MET | Read-only diagnostics, durable evidence and offline dogfood at `scripts/daily-ai-news.ts:336-605` |
| R4 | MET | Fourteen focused regressions plus full gates and docs at `scripts/tests/daily-ai-news.test.ts:204-567`, `docs/04_DESIGN.md:1089-1118` |

The real validation report's overall FAIL is intentional live-health evidence for 2026-11-07, not an implementation defect. No real generation/publication or runtime/scheduler mutation occurred.

### References

- `docs/design/kk-daily-ai-voice3.md` — voice3 generation/publication split and windows.
- `docs/design/kk-collect-and-daily-voice2.md` — store-backed daily generation and scheduler.
- `docs/tasks/0334_prepare-correct-voice3-migration-schedules-and-an-explicit-s.md` — bundle launcher and live-launch safety.
- `docs/tasks/0335_prove-voice3-replacement-with-a-fresh-offline-multi-window-m.md` — offline dogfood contract.
- `docs/tasks/0337_lift-ai-news-supply-model-qc-labeling-or-full-text-ingest-fo.md` — supply diagnosis and read-only report context.

### History

- 2026-11-07T17:53:47.164Z backlog → todo (system)
- 2026-11-07T17:53:47.553Z todo → wip (system)
- 2026-11-07T20:07:03.767Z wip → testing (system)
- 2026-11-07T20:07:04.213Z testing → done (system)

