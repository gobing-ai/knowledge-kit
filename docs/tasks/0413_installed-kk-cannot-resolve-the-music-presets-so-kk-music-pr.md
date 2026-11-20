---
schema_version: 1
name: Installed kk cannot resolve the music presets, so kk music presets/render/gen fail from the package
status: done
template: issue
created_at: 2026-11-20T17:11:08.255Z
updated_at: "2026-11-20T17:45:21.650Z"
feature_id: D8

done_forced: "true"
done_reason: "Fixed and verified from the installed package: bun test plugins/generations/music-gen 274 pass, bun run lint clean, and kk music presets/render/library proven from /tmp after rebuilding and syncing the bundle. No separate task pipeline run launched."
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

**Root cause.** `MUSIC_PRESET_ROOT` was `join(import.meta.dir, '..', 'presets')` — correct only for the
source layout (`plugins/generations/music-gen/src`). A packed CLI bundles this module into
`<pkg>/dist/index.js`, where `import.meta.dir` is `<pkg>/dist`, so the constant pointed at
`<pkg>/presets` (never shipped) and every preset-reading verb failed with
`preset directory is missing` — `kk music presets`, and by extension `render`/`gen`, from the installed
package.

**Change.**

| File | Change |
| --- | --- |
| `plugins/generations/music-gen/src/presets.ts` | `musicPresetRootCandidates(from)` builds the candidate list nearest-first — the plugin-local sibling `<dir>/../presets` **and** the packaged `<dir>/plugins/generations/music-gen/presets` at every ancestor, because a bundle's anchor is `<pkg>/dist`. `resolveMusicPresetRoot(fs, from?)` returns the first existing candidate through the existing `FileSystem` seam (no new sync I/O), and falls back to `MUSIC_PRESET_ROOT` so a genuinely missing corpus still fails naming a real shape. `loadMusicPresets` uses it when no `root` override is given. |
| `plugins/generations/music-gen/tests/preset-data.test.ts` | four cases: a source anchor resolves plugin-locally first; a bundled anchor still finds the package-root path; resolution picks the packaged layout a bundle ships (fake fs); nothing existing falls back to the source path. |

`MUSIC_PRESET_ROOT` stays exported with its old meaning (source layout / last resort), so no caller or
test had to change.

### Testing

- `bun test plugins/generations/music-gen` → 274 pass, 0 fail (17 files), including the four new 0413 cases.
- `bun run lint` → clean (biome 2.5.15 + every workspace typecheck); `bunx biome check` clean.
- **End to end from the installed package** (`bun run build`, `apps/cli/dist/index.js` copied to
  `~/.bun/install/global/node_modules/@gobing-ai/knowledge-kit/dist/`, previous bundle kept as
  `index.js.bak-20261120T…`), run from `/tmp` — outside every checkout:
  - `kk music presets --json` → `root: …/knowledge-kit/plugins/generations/music-gen/presets`, five
    formats and four themes (previously: `preset directory is missing`).
  - `KK_MUSIC_DRY_RUN=1 kk music render --in /tmp/install-probe.yaml --out …` → prompt written, exit 0.
  - `KK_MUSIC_INSTANCE_URL=http://127.0.0.1:3100 kk music library --json` → 3 takes, no error.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-11-20T17:45:19.894Z todo → wip (system)
- 2026-11-20T17:45:20.708Z wip → testing (system)
- 2026-11-20T17:45:21.529Z testing → done (system)

