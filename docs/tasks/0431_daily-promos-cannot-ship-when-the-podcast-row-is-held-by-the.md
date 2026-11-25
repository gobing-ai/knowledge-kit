---
schema_version: 1
name: Daily promos cannot ship when the podcast row is held by the safety verdict
status: todo
template: issue
created_at: 2026-11-24T21:55:01.377Z
updated_at: "2026-11-24T21:55:20.077Z"
feature_id: L3

ac_altitude: task-local
ac_numbering: task-local
---

## 0431. Daily promos cannot ship when the podcast row is held by the safety verdict

### Background

Found in the 2026-11-24 daily dogfood. The variants safety gate excluded podcast-pub
(`xiaoyuzhou`/`wechatmp` in `bundle.safety.excludedPlatforms`). The four social rows then all
failed with `error: "unresolved-link", effect: none`:

```
{"event":"failed","id":"x-pub.post","error":"unresolved-link"}
{"event":"failed","id":"threads-pub.post","error":"unresolved-link"}
{"event":"failed","id":"linkedin-pub.post","error":"unresolved-link"}
{"event":"failed","id":"jike-pub.post","error":"unresolved-link"}
```

Cause: `buildSocialContent` (plugins/kk/scripts/daily-stages.ts, `listenUrl: links.podcastUrl`)
appends `🎧 完整节目：{{podcast_url}}` to every promo, and `LINK_SOURCES` in
`apps/cli/src/publish-matrix.ts` can only fill `{{podcast_url}}` from a *succeeded* `podcast-pub`
receipt. With the podcast row excluded there is no receipt, so the placeholder stays literal and
`sendRows` refuses the row.

The only same-day repair is a cosmetic re-author of `30-variants/social_*.content.json`, which the
immutable freeze then blocks: `kk news generate-bundle --stage freeze` refuses ("a frozen bundle is
never rewritten", apps/cli/src/commands/content-generate.ts) and `publish-matrix-bundle` rejects a
variant whose digest differs from `bundle.safety.variants`. Measured 2026-11-24: clearing that
required deleting `bundle.json` and re-freezing after a fresh variants safety pass (the run's
pre-repoint bundle is preserved at `.spur/run/dogfood/2026-11-24-news/bundle.json.pre-promo-repoint`).

Repro: any run where `podcast-pub.episode` is excluded by safety (or fails) while the tier-3
social rows are `live`.

### Requirements

- [ ] R1. When the podcast row has no succeeded receipt, a promo row whose copy carries `{{podcast_url}}` must not fail with `unresolved-link`: it either falls back to the tier-0 article URL or is skipped with a named reason that says the podcast link is missing.
- [ ] R2. The fallback is visible in the receipt/event so an operator can see which link a post carried.
- [ ] R3. A same-day re-point of one channel's copy must not require deleting a frozen `bundle.json`.

### Acceptance Criteria

```gherkin
Scenario: AC1 — a promo supplies the article link when the podcast link is missing (req: R1)
Given a publish plan whose `podcast-pub.episode` row has no succeeded receipt and whose `surfdash-pub.post` row did
When `kk news publish-send --window after-generate --tier 3` dispatches the promo rows
Then the payload's `{{podcast_url}}` is replaced with the surfdash receipt URL and the row's event is `sent`

Scenario: AC2 — the fallback is recorded (req: R2)
Given the fallback above
Then the row's receipt or `publish-events.jsonl` entry names the substituted link source (`article`)

Scenario: AC3 — the chosen behaviour on a missing tier-0 URL is covered by a test (req: R1, R3)
Given a matrix fixture with the podcast row failed and a social row planned
When the send runs
Then the test asserts either the article-link substitution or an `effect: none` skip carrying the reason, and it fails when the substitution is removed
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

- Run: `.works/kk-news-generate/20261124/4-publish/publish-events.jsonl` (four `unresolved-link` entries, 2026-11-24T21:09Z)
- Safety verdict: `.works/kk-news-generate/20261124/4-safety-variants/safety.json` (`excludedPlatforms: [xiaoyuzhou, wechatmp]`)
- Writer: `plugins/kk/scripts/daily-stages.ts` → `buildSocialContent` (`listenUrl`), `PLACEHOLDER_LINKS`
- Resolver: `apps/cli/src/publish-matrix.ts` → `LINK_SOURCES`
- Freeze refusal: `apps/cli/src/commands/content-generate.ts` (`a frozen bundle is never rewritten`)

### History
