---
schema_version: 1
name: kk plugin check reports a refused publish probe as malformed output instead of the refusal detail
status: done
template: standard
created_at: 2026-11-16T01:39:53.909Z
updated_at: "2026-11-16T09:07:04.682Z"

ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close
---

## 0381. kk plugin check reports a refused publish probe as malformed output instead of the refusal detail

### Background

Observed on the production host 2026-11-15 while diagnosing the `shipinhao-pub` daily-run refusal.

With shipinhao's cached session expired:

```
$ kk plugin check shipinhao-pub
  • shipinhao-pub [publish]: error — probe exit 1 (malformed probe output)

$ bun plugins/publishings/shipinhao-pub/src/profile-check.ts check
{"status":"refused","profileDir":"...","detail":"headed shipinhao readiness refused:
 Authentication was not confirmed within 30000ms. The profile's site session has likely expired ..."}
```

The probe DOES print a well-formed `{"status":"refused", ...}` and exits 1, which
`apps/cli/src/invoke.ts:307` is explicitly written to accept (`status === 'refused' && exitCode === 1`).
Yet the parent reports `status === undefined` and falls through to `invoke.ts:315`
(`probe exit ${exitCode} (malformed probe output)`).

Impact: the daily run's session-preflight told the operator "malformed output" for a problem whose
real cause — an expired login — has a one-command fix. That mislabel cost a diagnosis detour here and
is the reason it read as a code defect rather than a session expiry.

`apps/cli/src/commands/plugin.ts:200-210` already carries a note about this exact string appearing when
the parent's deadline raced the probe's own 30 s auth wait, and the parent timeout was raised to 60 s
for it; this occurrence is not that race (the parent waited the full probe duration and the probe
printed its verdict), so the remaining cause is in how `spawnPluginProbe` captures or classifies the
child's stdout.

### Requirements

- [x] R1. `kk plugin check` reports the probe's own verdict (`verified`/`refused`/`error`) whenever the probe printed a parseable verdict line, even when non-verdict lines follow it on stdout — an expired site session must read `refused` with its detail, never `probe exit 1 (malformed probe output)`.
- [x] R2. Classification uses the last *parseable* verdict line: unparseable trailing output and human progress lines are skipped rather than mistaken for the verdict.
- [x] R3. No raw unparsed line text enters the verdict detail; when no parseable verdict exists at all, the detail keeps the `probe exit <code> (malformed probe output)` shape.
- [x] R4. A regression test pins the incident's stdout shape (a human line, a `refused` verdict, a trailing line) and fails against the last-line-only classification it replaces.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A refused probe reads as refused (req: R1)
  Given a readiness probe that prints its {status: refused, profileDir, detail} verdict and exits 1
  And a non-verdict line follows that verdict on stdout
  When kk plugin check classifies the probe output
  Then the row reads refused with the probe's own detail
  And it never reads "malformed probe output"

Scenario: AC2 — The last parseable verdict wins (req: R2)
  Given probe stdout with human progress lines, then a verdict line, then unparseable trailing output
  When kk plugin check classifies the probe output
  Then the verdict line decides the status

Scenario: AC3 — Malformed output stays malformed and leaks nothing (req: R3)
  Given probe stdout whose every line fails to parse as a verdict
  When kk plugin check classifies the probe output
  Then the status is error with detail "probe exit <code> (malformed probe output)"
  And no raw line text appears in the detail

Scenario: AC4 — The incident is pinned (req: R4)
  Given the 2026-11-15 shipinhao stdout shape from task 0381
  When the invoke regression suite runs
  Then the classification test fails if only the final line is considered
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

**Root cause:** `probeVerdict` classified only the **last** stdout line. A channel probe prints human progress
lines before its verdict and can append a line after it, so a probe that had already printed
`{"status":"refused", …}` was read as `status === undefined` and the row became
`probe exit 1 (malformed probe output)` — hiding the one fact the operator needed (the site session expired).

- `apps/cli/src/invoke.ts:290` — `probeVerdict` now scans the last `VERDICT_SCAN_LINES` (20) non-empty lines
  backwards and takes the last line that **parses** to an object with a string `status`. Human lines, unparseable
  trailing output and JSON without a `status` are skipped instead of being mistaken for the verdict.
- `apps/cli/src/invoke.ts:283` — the bound, so stale output from an earlier phase can never decide a verdict.
- The exit-code/status agreement rule is untouched (`refused` still requires exit 1, `verified` exit 0, anything
  else is `error`), and no unparsed line text can reach `detail` — that property is re-pinned by the malformed case.

**Tests:** `apps/cli/tests/invoke.test.ts` — the incident's exact stdout shape (progress line, `refused` verdict,
trailing `browser closed`) now yields `refused` with its detail; a two-verdict case proves the *last parseable*
line wins; the old last-line-only expectation became the malformed-when-nothing-parses case, so the safety property
is asserted rather than relaxed.

**Not fixed here:** why a channel appends a line after its verdict. The classifier no longer depends on it, and
shipinhao's session is currently `verified` (re-authenticated since the incident), so the trailing writer could not
be reproduced live today.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/invoke.ts:296` scans backward for a parseable verdict; `apps/cli/tests/invoke.test.ts:929` proves refused + detail survives trailing output. |
| R2 | MET | `apps/cli/tests/invoke.test.ts:943` proves the last parseable verdict wins across multiple verdict lines. |
| R3 | MET | `apps/cli/src/invoke.ts:328-335` preserves the malformed-output shape without raw line text; `apps/cli/tests/invoke.test.ts:948` passed. |
| R4 | MET | Pre-fix archive run → incident and last-parseable cases both failed (1 pass / 2 fail); current focused CLI suite → 50/50 pass, including all invoke and plugin-check tests. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `apps/cli/tests/invoke.test.ts:929` returns status refused with the original detail, never malformed. |
| AC2 | MET | test | `apps/cli/tests/invoke.test.ts:943` proves last parseable verdict selection. |
| AC3 | MET | test | `apps/cli/tests/invoke.test.ts:948` returns `probe exit 2 (malformed probe output)` and leaks no raw line text. |
| AC4 | MET | command | Pre-fix focused tests → 1 pass / 2 fail; current `invoke.test.ts` and `plugin-check.test.ts` are green in the 50-test focused suite. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-11-16T03:25:28.248Z backlog → todo (system)
- 2026-11-16T03:36:15.145Z todo → wip (system)
- 2026-11-16T04:04:20.514Z wip → testing (system)
- 2026-11-16T04:04:21.303Z testing → done (system)

