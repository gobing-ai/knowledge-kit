---
schema_version: 1
name: Extend publish-harness with browser drivers and FakeBrowserTransport
status: todo
template: feature-impl
created_at: 2026-09-17T23:03:26.217Z
updated_at: "2026-09-17T23:03:26.224Z"
feature_id: E7
priority: P2
estimate_hours: 6

---

## 0141. Extend publish-harness with browser drivers and FakeBrowserTransport

### Background

Implements: R1 — Publish harness exposes an offline FakeBrowserTransport; R2 — Browser transports declare a script or agent driver without a third kind; R3 — ADR-008 records browser drivers as a detail amendment.

Harvest session/profile/selector helpers from `~/projects/cc-agents/plugins/wt/scripts/web-automation` into `@gobing-ai/publish-harness`. Quiz auto-skipped under `--auto`.

Rubric: E6 D1 L1 C0 R1 = 8 → decompose (parent E>16h; this child is the prefactoring seam).

### Requirements

- [ ] R1. PublishTransport remains kind file-cli or browser and adds optional driver script or agent, required when kind is browser.
- [ ] R2. FakeBrowserTransport records publish calls offline, supports setNextResult, and returns a ResultSchema-valid Result.
- [ ] R3. Session helpers resolve ~/.config/kk/browser-profiles/<channel>, launch a persistent profile, and export trySelectors.
- [ ] R4. Unit tests cover FakeBrowserTransport with no live browser or network.
- [ ] R5. Shipped FakeFileCliTransport and existing publish plugins keep compiling.

### Acceptance Criteria

- [ ] AC1 — Publish harness exposes an offline FakeBrowserTransport
- [ ] AC2 — Browser transports declare a script or agent driver without a third kind
- [ ] AC3 — ADR-008 records browser drivers as a detail amendment

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: extend packages/publish-harness in place (feature satellite D1). Add `driver?: 'script' | 'agent'` on PublishTransport; implement FakeBrowserTransport beside FakeFileCliTransport; copy the wt web-automation launch/profile/selector helpers without importing wt or config.jsonc.

Rejected: a new packages/publish-browser (deletion-test fail); a third transport kind (ADR-008).

Invariants: no LLM in the harness; secrets stay env-only; kinds stay file-cli | browser.

Signatures:
- `export type BrowserDriver = 'script' | 'agent'`
- `export class FakeBrowserTransport implements PublishTransport`

### Plan

1. Add driver field and FakeBrowserTransport with tests matching FakeFileCliTransport grain.
2. Port persistent-profile launch and trySelectors from @wt/web-automation; drop wt config.jsonc.
3. Re-export from src/index.ts; keep FakeFileCliTransport API stable.
4. Run harness tests and a typecheck of existing publish plugins.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
