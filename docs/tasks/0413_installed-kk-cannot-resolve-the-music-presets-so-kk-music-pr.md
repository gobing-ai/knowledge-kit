---
schema_version: 1
name: Installed kk cannot resolve the music presets, so kk music presets/render/gen fail from the package
status: todo
template: issue
created_at: 2026-11-20T17:11:08.255Z
updated_at: "2026-11-20T17:11:17.164Z"
feature_id: D8

---

## 0413. Installed kk cannot resolve the music presets, so kk music presets/render/gen fail from the package

### Background

Captured from the creation title: "Installed kk cannot resolve the music presets, so kk music presets/render/gen fail from the package".

### Requirements

- [ ] R1. An installed `kk` (the bundle at `<pkg>/dist/index.js`) resolves the preset root to the shipped `plugins/generations/music-gen/presets`, so `kk music presets`, `render` and `gen` work from the package without `--root` or `KK_MUSIC_KK_BIN`.
- [ ] R2. A test pins that resolution for the bundled entry point, not only for a source run.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

1. [ ] Reproduce from the installed package: `kk music presets` reports `preset directory is missing` for `<pkg>/presets/formats`, because `MUSIC_PRESET_ROOT` is `join(import.meta.dir, '..', 'presets')` and a bundle puts `import.meta.dir` at `<pkg>/dist`.
2. [ ] Resolve the root from the plugin layout the package actually ships (`<pkg>/plugins/generations/music-gen/presets`) before falling back to the source-relative path.
3. [ ] Pin it with a packaging test that runs the bundled entry point.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
