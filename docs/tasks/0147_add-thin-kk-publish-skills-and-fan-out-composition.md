---
schema_version: 1
name: Add thin kk publish skills and fan-out composition
status: done
template: feature-impl
created_at: 2026-09-17T23:03:26.223Z
updated_at: "2026-09-17T23:49:48.370Z"
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

- [x] R1. A plugins/kk publish skill for leftover channels exists and, on operator confirmation of a draft publish, shells kk executor run or kk fanout.
- [x] R2. The skill does not own transport implementation; the plugin process does.
- [x] R3. kk fanout over two or more leftover file-cli or script channels contributes one per-target Result entry each.
- [x] R4. Agent-default channels are documented as workflow agent.run steps, not as LLM spawns inside kk fanout.
- [x] R5. No new kk first-layer noun is added.

### Acceptance Criteria

- [x] AC1 — Harvested channels compose with kk fanout
- [x] AC2 — Thin kk operator skills invoke executor or fanout without owning transport
- [x] AC3 — Transport failure produces a fail-loud Result

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

| File | What | Why |
| --- | --- | --- |
| `plugins/kk/skills/publish/SKILL.md:1` | Thin operator skill shells executor/fanout | R1 R2 |
| `plugins/kk/workflows/leftover-publish-fanout-example.yaml:1` | file-cli fanout then agent.run for juejin | R4 |
| `apps/cli/tests/fanout.test.ts` | leftover file-cli two-target aggregate | R3 |
| `apps/cli/tests/leftover-publish-harvest.test.ts:7` | no `kk publish` noun | R5 |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/skills/publish/SKILL.md:1` thin skill shells kk executor run / kk fanout |
| R2 | MET | `plugins/kk/skills/publish/SKILL.md` Do not embed Playwright; plugin owns transport |
| R3 | MET | `apps/cli/tests/fanout.test.ts` leftover file-cli channels each contribute one entry |
| R4 | MET | `plugins/kk/workflows/leftover-publish-fanout-example.yaml:1` agent.run for juejin |
| R5 | MET | `apps/cli/tests/leftover-publish-harvest.test.ts:7` no first-layer publish noun |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Harvested channels compose with kk fanout | MET | test | `apps/cli/tests/fanout.test.ts` leftover file-cli two-target aggregate |
| AC2 — Thin kk operator skills invoke executor or fanout without owning transport | MET | test | `apps/cli/tests/leftover-publish-harvest.test.ts` skill exists; no kk publish noun |
| AC3 — Transport failure produces a fail-loud Result | MET | test | `plugins/publishings/medium-pub/tests/medium-pub.test.ts` missing token Result.ok false |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1–P3 findings; functional verdict PASS |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | plugins/kk/skills/publish/SKILL.md |
| R2 | MET | skill shells kk; transport stays in plugins |
| R3 | MET | fanout test two leftover file-cli targets |
| R4 | MET | leftover-publish-fanout-example.yaml agent.run |
| R5 | MET | createProgram has no publish noun |

Disposition: approve.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-17T23:49:46.687Z todo → wip (system)
- 2026-09-17T23:49:48.077Z wip → testing (system)
- 2026-09-17T23:49:48.370Z testing → done (system)

