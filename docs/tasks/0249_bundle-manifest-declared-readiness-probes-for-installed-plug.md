---
schema_version: 1
name: Bundle manifest-declared readiness probes for installed plugins
status: todo
template: feature-impl
created_at: 2026-10-10T07:14:32.358Z
updated_at: "2026-10-10T07:16:03.621Z"
feature_id: E93

priority: P2
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 4
---

## 0249. Bundle manifest-declared readiness probes for installed plugins

### Background

Review finding F2 (P2, correctness/architecture), confirmed 2026-10-10. scripts/bundle-plugins.ts:85 rewrites only manifest.entry; check remains ./src/profile-check.ts. Staging actual x-pub outside the checkout and launching its declared check exits 1 with Cannot find module @gobing-ai/publish-harness/browser. Evidence .spur/run/review-repro.json in review run dev-review-packages-and-4-a71c. The distribution prunes node_modules and private workspaces are not published. Six browser manifests declare checks; none has a packaged-process regression. No existing non-terminal task owns this defect. The review separately fixed the exit/status parser in apps/cli/src/invoke.ts:241; preserve it. E93 was reopened for its installed readiness/login contract.

### Requirements

- [ ] R1. Stage every declared TypeScript/JavaScript check as its own Bun bundle and rewrite staged manifest.check to that bundle; resolve dependencies from the source plugin. Leave source manifests untouched.
- [ ] R2. Preserve executable non-JS entries/checks and existing entry bundling; a declared missing check or failed check build must fail staging with plugin/path context. Plugins without check remain unchanged.
- [ ] R3. Add scripts/bundle-plugins.test.ts coverage for declared-check bundling and missing/broken checks plus an installed-shape subprocess probe outside repository module resolution. Keep node_modules excluded.
- [ ] R4. Run bun run gate; no real browser/session/publish required.

### Acceptance Criteria

- [ ] AC1. A staged real browser probe with workspace dependencies executes outside the checkout and produces its structured contract without module-resolution errors; the test uses a safe config/usage refusal before browser launch. (req: R1) (req: R3)
- [ ] AC2. Staged manifests point to built check artifacts, source manifests retain their source check paths, and plugins with no check or executable non-JS paths retain their contract. (req: R1) (req: R2)
- [ ] AC3. A missing or unbuildable declared check fails staging with plugin/path context; entry staging tests and the full project gate remain green. (req: R2) (req: R3) (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Extend the existing staging boundary in scripts/bundle-plugins.ts:52. Bundle declared JS/TS checks independently to dist/profile-check.js (distinct from dist/index.js), using the source directory to resolve private workspace imports and retaining the existing playwright external. Rewrite only the staged check field. Validate declared paths before builds and surface contextual failures. Preserve non-JS executable paths as copied assets; do not run them through Bun.build. Reuse the entry build logic locally where it avoids duplication; no second registry or publishing private workspaces. Tests in scripts/bundle-plugins.test.ts:52 should assert each staged declared check exists and execute a real probe safely from a temp directory beyond checkout ancestors (for example substack with SUBSTACK_PUBLICATION_URL unset, expecting error JSON/exit 2). Missing/broken source fixtures cover fail-loud behavior; ensure source manifests are byte-unchanged. Rejected: retaining raw TS and shipping workspace symlinks (broken outside checkout), or replacing browser probes with status-only checks (changes readiness semantics). Affected: scripts/bundle-plugins.ts, scripts/bundle-plugins.test.ts; optional test assertions in apps/cli/tests/commands/plugin-check.test.ts. Out of scope: channel selectors, new commands, publishing private packages, production browser dogfood. Restores ADR-012/032 distribution contracts; no ADR reversal or public manifest schema change.

### Plan

- [ ] 1. Add failing staged-check, safe isolated-process and missing/broken check cases (R3).
- [ ] 2. Bundle declared JS/TS probes at staging and preserve executable/non-check cases (R1/R2).
- [ ] 3. Verify no source manifest mutation, no staged node_modules, and existing entry coverage (R2/R3).
- [ ] 4. Run bun run gate and record the safe subprocess evidence (R4).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- scripts/bundle-plugins.ts:52 — entry-only staging implementation.
- scripts/bundle-plugins.ts:85 — entry rewrite excludes check.
- plugins/publishings/x-pub/plugin.json:5 — declared raw check path.
- plugins/publishings/x-pub/src/profile-check.ts:14 — private workspace import.
- scripts/bundle-plugins.test.ts:52 — installed staging test.
- Review run dev-review-packages-and-4-a71c, .spur/run/review-repro.json.
- Feature E93; ADR-012 and ADR-032.

### History

- 2026-10-10T07:15:49.618Z backlog → todo (system)

