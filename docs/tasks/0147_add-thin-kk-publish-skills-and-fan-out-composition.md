---
schema_version: 1
name: Add thin kk publish skills and fan-out composition
status: todo
template: feature-impl
created_at: 2026-09-17T23:03:26.223Z
updated_at: "2026-09-17T23:05:00.375Z"
feature_id: E7
priority: P2
estimate_hours: 5

dependencies: ["0142", "0143", "0144", "0145", "0146"]
---

## 0147. Add thin kk publish skills and fan-out composition

### Background

Implements: R14 — Harvested channels compose with kk fanout; R15 — Thin kk operator skills invoke executor or fanout without owning transport.

Operator surface after the leftover plugins exist. file-cli/script channels go through kk fanout; agent-default channels sequence as workflow agent.run (satellite D10).

Rubric: E5 D1 L2 C1 R0 = 9 → decompose (kk skills + fan-out, distinct from plugin packages).

### Requirements

- [ ] R1. A plugins/kk publish skill for leftover channels exists and, on operator confirmation of a draft publish, shells kk executor run or kk fanout.
- [ ] R2. The skill does not own transport implementation; the plugin process does.
- [ ] R3. kk fanout over two or more leftover file-cli or script channels contributes one per-target Result entry each.
- [ ] R4. Agent-default channels are documented as workflow agent.run steps, not as LLM spawns inside kk fanout.
- [ ] R5. No new kk first-layer noun is added.

### Acceptance Criteria

- [ ] AC1 — Harvested channels compose with kk fanout
- [ ] AC2 — Thin kk operator skills invoke executor or fanout without owning transport
- [ ] AC3 — Transport failure produces a fail-loud Result

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: thin skill(s) under plugins/kk/skills (K pattern). Skill args select channel + draft vs live. file-cli/script → `kk executor run` / `kk fanout`. agent driver → skill runs the page via harness helpers then the plugin writes Result, or a workflow agent.run step; kk fanout does not spawn an LLM.

Rejected: fat skills that reimplement Playwright; a new `kk publish` noun (ADR-011).

Invariants: no transport logic in the skill beyond invoking the plugin; draft default; operator confirmation before live publish.

Signatures: skill invocation `Skill(skill="publish", args="<channel> --in <content.json>")` — exact skill directory name frozen at implement, one fat skill preferred over seven clones.

### Plan

1. Author the thin kk skill(s) that invoke kk executor run / kk fanout for leftover channels.
2. Add or extend a workflow example that fans out two file-cli channels and sequences one agent-default channel as agent.run.
3. Contract-test fan-out aggregate Result entries with fake transports.
4. Confirm no new first-layer kk noun.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
