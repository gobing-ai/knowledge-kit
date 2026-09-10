---
schema_version: 1
name: Rename kk user roots to config kk (presets + registry)
status: done
template: feature-impl
created_at: 2026-09-10T06:33:34.344Z
updated_at: "2026-09-10T06:41:45.241Z"
feature_id: M

done_forced: "true"
---

## 0109. Rename kk user roots to config kk (presets + registry)

### Background

Captured from the creation title: "Rename kk user roots to config kk (presets + registry)".

### Requirements

‑ [x] R1. HOME-based user roots under ~/.config/kk (image presets + user plugin discovery); no ~/.kk in shipped source or living docs
‑ [x] R2. Predefined preset SSOT stays with the image-gen plugin and ships in the npm tarball; user root starts empty; fine-tune by single-file shadow

### Acceptance Criteria

- AC1 — no `~/.kk` remains in shipped source or living docs (historical task docs exempt)
- AC2 — resolvePresetRoots returns `~/.config/kk/image-presets`; registry returns `~/.config/kk/plugins`; unit-tested
- AC3 — npm pack tarball ships plugins/generations/image-gen/presets/** (SSOT unchanged)
- AC4 — shadowing semantics preserved under the new path (user file replaces builtin)
- AC5 — bun run lint + bun run test green

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

Code: presets.ts:261, registry.ts:39/117/137, tests, ADR-012 amendment, 5 living docs. Migration: 4 user YAMLs moved to ~/.config/kk/image-presets/styles/, ~/.kk removed. Gate: lint clean, 721/0, pack verified.

### Testing

- [x] bun run lint — clean (Biome + typecheck)
- [x] bun run test — 721 pass / 0 fail (49 files); presets+registry suites 44/44
- [x] npm pack dry-run (apps/cli) — image-gen/presets formats+styles listed
- [x] verify-answer-lint 0109 — PASS (2 req, 5 AC)

### Review

Inline review of the rename diff (2 src + 2 test files, ADR, 5 docs).

| Priority | Finding | Resolution |
| --- | --- | --- |
| P1 | None | — |
| P2 | None | — |
| P3 | Project-root `.kk/image-presets` (presets.ts:265, cwd-scoped) intentionally unchanged — not a HOME root | Documented in ADR amendment clause 3 |
| P4 | ADR-012 historical text keeps `~/.kk/plugins` (2026-08-13 amendment) — kept verbatim as record | New 2026-09-10 amendment supersedes |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-10T06:38:45.799Z backlog → todo (system)
- 2026-09-10T06:38:46.083Z todo → wip (system)
- 2026-09-10T06:41:25.169Z wip → testing (system)
- 2026-09-10T06:41:45.214Z testing → done (system)

