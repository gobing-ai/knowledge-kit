---
schema_version: 1
name: Discover the InfoQ write console and record UI draft drift
status: backlog
template: feature-impl
created_at: 2026-10-05T17:59:46.523Z
updated_at: "2026-10-05T18:00:08.598Z"
feature_id: Q

---

## 0201. Discover the InfoQ write console and record UI draft drift

### Background

The `infoq` publish plugin was migrated from the `wt` skills, and its entry URL, selectors and step order have never been re-measured against the live console. This task walks the real console draft-only with the operator's authenticated profile and records what the UI actually requires for each of its modes (write → draft (提交 for editorial review)).

InfoQ has no self-publish: the live control submits for editorial review, so the draft walk must stop before 提交.

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

Driver: the channel's own Chromium (the Playwright build the plugins ship against) launched on the channel's profile dir with remote debugging enabled, then driven step by step against the live console, so the session is the same one the plugin will use. Evidence lands under `.spur/run/discovery/infoq-<mode>.{json,md,png}` (scratch, gitignored) with the curated summary at `docs/design/infoq-ui-discovery.md`.

Rail: draft-only, operator-attended; stop immediately if the platform shows an anti-automation warning; record, never resolve, anything the operator must decide. Findings are the deliverable — no plugin code changes here; they become the fix tasks.

### Plan

- [ ] 0. Resolve the channel profile dir and confirm the session (login is operator-interactive; never automate credentials).
- [ ] 1. Open the console entry: `https://xie.infoq.cn/write`.
- [ ] 2. Walk each mode in turn, recording the step sequence and the selector candidates per control.
- [ ] 3. Save a draft per mode and record the signal actually observed (URL change, toast, list entry), without touching the publish control.
- [ ] 4. Write `docs/design/infoq-ui-discovery.md` with the mode table and the drift list.
- [ ] 5. Report the drift items as fix candidates for the feature's gap-fix tasks.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
