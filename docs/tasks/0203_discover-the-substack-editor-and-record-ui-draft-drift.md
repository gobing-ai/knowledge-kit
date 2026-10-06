---
schema_version: 1
name: Discover the Substack editor and record UI draft drift
status: testing
template: feature-impl
created_at: 2026-10-05T17:59:48.787Z
updated_at: "2026-10-06T18:16:48.005Z"
feature_id: E92

---

## 0203. Discover the Substack editor and record UI draft drift

### Background

The `substack` publish plugin was migrated from the `wt` skills, and its entry URL, selectors and step order have never been re-measured against the live console. This task walks the real console draft-only with the operator's authenticated profile and records what the UI actually requires for each of its modes (post draft (publication-scoped)).

Substack's editor URL is publication-scoped; the walk must confirm the URL derivation and the draft signal.

### Requirements

- [ ] R1. An evidence record exists for every mode of this channel: entry URL, ordered step sequence, verified selector candidates per control, the observed success signal, and the draft-vs-publish affordances.
- [ ] R2. The drift list against the plugin's current constants is recorded per item: current value, observed value, impact on the draft path.
- [ ] R3. The walk never activates a publish, submit or send control; it stops at the draft/save affordance and records where the publish control lives without acting on it.

### Acceptance Criteria

- [ ] AC1 — R1 — Every platform mode carries recorded UI evidence with its drift findings (req: R1, R2)
- [ ] AC2 — R4 — Discovery and tests never touch a publish control (req: R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Driver: the channel's own Chromium (the Playwright build the plugins ship against) launched on the channel's profile dir with remote debugging enabled, then driven step by step against the live console, so the session is the same one the plugin will use. Evidence lands under `.spur/run/discovery/substack-<mode>.{json,md,png}` (scratch, gitignored) with the curated summary at `docs/design/substack-ui-discovery.md`.

Rail: draft-only, operator-attended; stop immediately if the platform shows an anti-automation warning; record, never resolve, anything the operator must decide. Findings are the deliverable — no plugin code changes here; they become the fix tasks.

### Plan

- [ ] 0. Resolve the channel profile dir and confirm the session (login is operator-interactive; never automate credentials).
- [ ] 1. Open the console entry: `https://<publication>.substack.com/publish/post/new`.
- [ ] 2. Walk each mode in turn, recording the step sequence and the selector candidates per control.
- [ ] 3. Save a draft per mode and record the signal actually observed (URL change, toast, list entry), without touching the publish control.
- [ ] 4. Write `docs/design/substack-ui-discovery.md` with the mode table and the drift list.
- [ ] 5. Report the drift items as fix candidates for the feature's gap-fix tasks.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:4` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:69` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:7` |
| `docs/design/substack-ui-discovery.md:1` |
| `docs/design/x-article-ui-discovery.md:1` |

### Testing

**Pipeline verify results**

- Verdict: FAIL (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | UNMET | observation |
| R2 | UNMET | observation |
| R3 | MET | observation |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC-1 | UNMET | static-ref | Per-mode evidence blocked on profile creation; blocker + baseline table recorded. |
| AC-4 | PARTIAL | static-ref | No publish activation possible: nothing opened. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: FAIL)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P1 | evidence-rule-failed | — | Executable evidence missing for: AC-4 |
| P4 | proof-input-digest | — |  |
| P4 | confidence | — |  |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-06T18:13:24.794Z backlog → wip (system)
- 2026-10-06T18:16:48.005Z wip → testing (system)

