---
schema_version: 1
name: surfdash-pub cannot see the en/ja locale files when it invokes postsurfing from kk
status: todo
template: issue
created_at: 2026-11-19T22:00:42.226Z
updated_at: "2026-11-19T22:00:42.348Z"

---

## 0396. surfdash-pub cannot see the en/ja locale files when it invokes postsurfing from kk

### Background

Captured from the creation title: "surfdash-pub cannot see the en/ja locale files when it invokes postsurfing from kk".

### Requirements

Observed 2026-11-19 dogfood: the kk row surfdash-pub.post failed three times with "Sync Daily digest 20261119-ai-2026-11-19 is missing locale file(s): en, ja", while the identical command run from a shell against the same checkout and the same absolute post path published the three locales and exited 0:

  EMDASH_API_TOKEN=... SURFDASH_URL=... bun scripts/surfdash.ts publish /Users/robin/xprojects/surfdash/content/posts/articles/zh/20261119-ai-2026-11-19/index.md
  -> refine OK, sync_cms OK (22s), distribute OK, workflow done

The plugin spawn path is spawnCli([postsurfingBin, "publish", filePath], surfdashRoot) in plugins/publishings/surfdash-pub/src/index.ts, which strips SPUR_WORKFLOW_RUN_ACTIVE and SPUR_EXPECTED_DEFINITION_DIGEST and inherits the rest of the environment. The nested postsurfing runs the surfdash spur workflow .spur/workflows/publishing.yaml (refine -> sync_cms -> distribute); sync_cms calls scripts/publish-orchestrator.ts sync <filePath> [entryId], whose discoverLocaleFiles() enumerates content/posts/articles/<locale>/<slug>/index.md.

So inside the plugin path the locale enumeration sees only zh although the files exist on disk (verified: plain "ls" shows en/ja index.md immediately after each failed run). Candidate causes to measure, in order: the cwd/env the nested spur workflow hands its shell steps, POSTSURFING_BIN vs the resolved surfdash root, or a spur project-root override leaking from the kk run into the nested run.

Impact: every scheduled surfdash row is unconfirmable even when the site publishes, which is what marked the 2026-11-19 after-generate window partial while the post was live in zh/en/ja.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

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
