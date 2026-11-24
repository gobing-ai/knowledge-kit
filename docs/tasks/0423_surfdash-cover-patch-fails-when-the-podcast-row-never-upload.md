---
schema_version: 1
name: surfdash cover patch fails when the podcast row never uploaded a remote cover
status: todo
template: issue
created_at: 2026-11-24T21:55:04.921Z
updated_at: "2026-11-24T21:55:28.497Z"
feature_id: L3

ac_altitude: task-local
ac_numbering: task-local
---

## 0423. surfdash cover patch fails when the podcast row never uploaded a remote cover

### Background

Found in the 2026-11-24 daily dogfood while settling the publish window. The post-publish cover patch
failed even though the surfdash post itself was live:

```
Plugin entry 'surfdash-pub' failed (exit code 1): surfdash-pub failed: patch error: zh post has no
remote https:// cover: coverUrl is empty and frontmatter has no https:// image key
patch-podcast: skipped: requires both podcast-pub and surfdash-pub targets in this window
```

The page is fine for readers — `https://surfing.salty.vip/zh/posts/20261124-261124` returns 200 with
`og:image = https://podcast-media.salty.vip/production/images/item-fb0fec937f33ba8d57c16aeee9dbf522.png`
— but the patch step has no remote cover URL to write into the post frontmatter.

Cause: the only https cover URL the daily run knows about is the one podcast-pub's media host ends up
serving. On this run `podcast-pub.episode` was excluded by the safety verdict
(`bundle.safety.excludedPlatforms`), so no podcast-media upload happened and `coverUrl` stayed empty,
while the surfdash row still dispatched and then settled as "failed" in the patch step.

Consequence: a live, correct page is reported as a failed target in `publish-report`/settlement, which
is how a partial day looks more broken than it is (and invites a needless re-publish).

### Requirements

- [ ] R1. When the podcast row did not run, the surfdash cover patch must source its https cover from the surfdash side (CMS upload or the plugin's own hosted asset) instead of failing.
- [ ] R2. If no https cover exists at all, the patch must be recorded as a warning with the page URL, not as a failed target — the post is already live and the og:image resolves.
- [ ] R3. The settlement/outcome row must distinguish "content published, cover patch skipped" from "content not published".

### Acceptance Criteria

```gherkin
Scenario: AC1 — a held podcast row does not fail the surfdash patch (req: R1, R2, R3)
Given a window where `podcast-pub.episode` is excluded by bundle safety and `surfdash-pub.post` succeeds
When `kk news publish-settle --window after-generate` runs
Then the surfdash row keeps `status: succeeded`, the outcome carries a `coverPatch: skipped` diagnostic with the reason, and no target is reported failed

Scenario: AC2 — the patch still writes a cover when one exists (req: R1)
Given a window where the podcast row succeeded and produced a media URL
Then the patch writes that URL into the frontmatter as today
```

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

- Live page: `https://surfing.salty.vip/zh/posts/20261124-261124` (200, og:image resolves)
- Run artifacts: `.works/kk-news-generate/20261124/4-publish/` (`settlement.after-generate.json`, `dispatch-ledger.json`)
- Patch stage: `kk news publish-settle` → `patch-surfdash` / `patch-podcast`

### History
