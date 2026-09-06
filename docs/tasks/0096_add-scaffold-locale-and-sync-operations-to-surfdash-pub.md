---
schema_version: 1
name: "Add scaffold-locale and sync operations to surfdash-pub"
status: todo
template: feature-impl
created_at: 2026-09-06T14:35:05.228Z
updated_at: "2026-09-06T18:02:00.998Z"
feature_id: L1
priority: P1
tags: ["publish", "surfdash-pub", "feature-K"]
---

## 0096. Add scaffold-locale and sync operations to surfdash-pub

### Background

The workflow inlines surfdash mechanics: `bun run sd translate`, 6×dirname path arithmetic, asset copying, publish-orchestrator sync. Feature L1 D4/R7: surfdash-pub owns these; LLM translation stays a thin agent.run step on plugin-returned paths.

### Requirements

R1. surfdash-pub gains options.operation routing (same pattern as podcast-pub): default 'publish' unchanged.
R2. `operation: 'scaffold-locale'` with options {postPath, target: 'en'|'ja'}: runs sd translate scaffolding + asset copy inside the plugin, returns the draft path in Result.metadata.
R3. `operation: 'sync'` with options {postPath}: runs the publish-orchestrator sync, returns ok/fail Result.
R4. All surfdash-root resolution (dirname arithmetic) lives inside the plugin; the workflow passes only the zh postPath.
R5. Unit tests with a fake surfdash root fixture (no real surfdash checkout in tests).

### Acceptance Criteria

- [ ] scaffold-locale on a fixture zh post returns en draft path and creates the scaffolded file
- [ ] sync on fixture post returns ok Result
- [ ] publish operation regression green
- [ ] no dirname arithmetic remains in any workflow YAML (verified in YAML task)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
WHAT: surfdash-pub gains an operation router (pattern copied from podcast-pub's resolveOperation, index.ts:50) and two new operations: `scaffold-locale` (wraps `sd translate` scaffolding + asset copy) and `sync` (wraps publish-orchestrator sync). Default `publish` is unchanged.

WHY: ADR-019 D4 — the workflow currently inlines surfdash mechanics (`bun run sd translate`, 6×dirname SURFDASH_ROOT arithmetic, `bun scripts/publish-orchestrator.ts sync`). The plugin ALREADY resolves the surfdash root (index.ts:104-106: SURFDASH_ROOT env or POSTSURFING_BIN derivation) — the workflow's dirname chain duplicates this badly. Premise verified at refine: surfdash-pub has NO operation router today (straight main → processPublishIO); the router pattern is copied from podcast-pub. Also verified: this plugin already uses Bun.spawn directly for the postsurfing CLI (index.ts:145), so spawning `sd` follows the existing in-plugin pattern (the no-direct-process-spawn rule's warning severity tolerates plugin-local spawns; follow the existing precedent, do not introduce execa).

WHERE (frozen):
- `plugins/publishings/surfdash-pub/src/index.ts` — add `const OPERATIONS = ['publish', 'scaffold-locale', 'sync'] as const` + `resolveOperation(options)` + option parsing in the input payload's `options` field (publish payload already carries arbitrary options? verify: PublishTransportPayload shape — extend via metadata if options channel is absent).
- `scaffold-locale`: options {postPath (zh index.md abs path), target: 'en'|'ja'}; resolve surfdashRoot (reuse lines 104-106 logic — extract to a helper `resolveSurfdashRoot()`), spawn `bun run sd translate <postPath> --source zh --target <locale>` with cwd=surfdashRoot, copy `assets/` dir if present, return Result with `metadata.draftPath` (derived: postPath with /zh/ → /<target>/).
- `sync`: options {postPath}; spawn `bun scripts/publish-orchestrator.ts sync <postPath>` cwd=surfdashRoot; Result ok/fail with stderr.
- Shared spawn helper inside the plugin (one local `spawnCli(cmd, cwd)` returning {exitCode, stdout, stderr}) — publish/scaffold-locale/sync all use it.

Precedence: publish stays the default operation; unknown operation → fail loud with the valid list (same as podcast-pub).

Anti-patterns: no LLM translation in the plugin (agent.run in the workflow owns that); no new env vars (reuse SURFDASH_ROOT/POSTSURFING_BIN); no `kk`-side changes; no editing the surfdash repo (only spawning its CLIs).

Handoff: 0097 rewrites translate-en/translate-ja/translate-sync states onto these operations; LLM translate steps keep editing plugin-returned draftPaths. Docs: 04_DESIGN.md surfdash-pub operations section.
### Plan
1. Read podcast-pub resolveOperation (pattern source) + surfdash-pub index.ts fully; check PublishTransportPayload for an options channel (extend metadata if none).
2. Extract resolveSurfdashRoot() from lines 104-106; add shared spawnCli helper.
3. Add OPERATIONS + resolveOperation + dispatch in processPublishIO/main.
4. Implement scaffold-locale (spawn sd translate, asset copy, metadata.draftPath) and sync (spawn publish-orchestrator).
5. Tests with a fixture surfdash root (fake `sd`/`publish-orchestrator` scripts in tmp dir): scaffold-locale creates draft + returns draftPath; sync returns ok; publish regression green; unknown operation fails loud naming valid operations.
6. Sync docs/04_DESIGN.md.
7. Verify: bun run lint && bun run test clean. Do not touch the workflow YAML (0097).
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
