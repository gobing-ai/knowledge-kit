---
schema_version: 1
name: Daily promos cannot ship when the podcast row is held by the safety verdict
status: done
template: issue
created_at: 2026-11-24T21:55:01.377Z
updated_at: "2026-11-25T06:50:27.460Z"
feature_id: L3

ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close
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

- [x] R1. When the podcast row has no succeeded receipt, a promo row whose copy carries `{{podcast_url}}` must not fail with `unresolved-link`: it either falls back to the tier-0 article URL or is skipped with a named reason that says the podcast link is missing.
- [x] R2. The fallback is visible in the receipt/event so an operator can see which link a post carried.
- [x] R3. A same-day re-point of one channel's copy must not require deleting a frozen `bundle.json`.

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

Root cause fixed in the SHARED resolver, not per channel: `LINK_SOURCES` now declares an optional
`fallback`, and `{{podcast_url}}` falls back to the tier-0 article URL when the podcast row has no
succeeded receipt (safety exclusion or a failed publish). The substitution is returned to the caller
and recorded as a `link-fallback` event, so the operator can see which link a post carried. When
neither link exists the row is skipped with the named reason `podcast-link-missing`; a slot that
declares no fallback (`{{article_url}}`) keeps the existing `unresolved-link` semantics.

No writer change and no freeze change. The promo copies already carry the placeholder, so the
same-day re-point that used to require deleting a frozen `bundle.json` is no longer needed: the
fallback rides the frozen bytes and the bundle/variant digests stay valid (regression-asserted).

| File | Lines | What / why |
| --- | --- | --- |
| `apps/cli/src/publish-matrix.ts` | 483-498 | New `LinkSource` interface naming the optional `fallback` owned surface, with the 0431 R1/R3 rationale: the podcast row can be excluded by safety, and the old `unresolved-link` failure was only repairable by re-authoring frozen copy. |
| `apps/cli/src/publish-matrix.ts` | 500-509 | `LINK_SOURCES` keeps its shape and gains `fallback: 'article'` on `{{podcast_url}}` only — one declarative table row, so the resolver stays channel-agnostic and `{{article_url}}` keeps its no-substitute contract. |
| `apps/cli/src/publish-matrix.ts` | 514-545 | New `LinkFallback` + `substituteLinkPlaceholders(payloadText, links)`: own-receipt URL wins, declared fallback fills in otherwise, and each fallback substitution is RETURNED (placeholder, source, url) so it can be recorded (R1/R2). Same JSON-string-fragment escaping as before. |
| `apps/cli/src/publish-matrix.ts` | 1930-1947 | `preparePayload` (tier ≥ 1) now calls the helper and appends one `link-fallback` event per substituted slot (`id`, `placeholder`, `source: 'article'`, `url`, `mode`) plus an operator echo — the receipt/event trail R2 asks for, next to the existing `channels-card-bound` events. |
| `apps/cli/src/publish-matrix.ts` | 1959-1987 | The unresolved-placeholder tail is now one list: the draft `originalUrl` drop only clears when the replacement actually happened (a body placeholder can never publish literally), and a slot that declares a fallback yet is still empty returns the named reason `podcast-link-missing` instead of `unresolved-link`. |
| `apps/cli/src/publish-matrix.ts` | 1628-1640 | `sendPublishMatrix` doc comment states the new contract: podcast → article fallback recorded as an event, named-reason skip when both are missing, `unresolved-link` only for a fallback-less slot. |
| `apps/cli/tests/publish-matrix-0431.test.ts` | 1-284 | Regression matrix on a 2026-11-24-shaped fixture (safety `excludedPlatforms: [xiaoyuzhou]`, three live social promos carrying `🎧 完整节目：{{podcast_url}}`): (1) the promo sends with the surfdash receipt URL + `link-fallback`/`source: article` event + frozen bundle and variant digests untouched (R1/R2/R3); (2) with the article row failed too, every promo is skipped `effect: none` with `error: podcast-link-missing` and never dispatched, while a `{{article_url}}` row keeps `unresolved-link` (R1 second arm, AC3). Both tests fail on the pre-fix source (verified by stashing the fix: `expected [ 'surfdash-pub', 'wechatmp-pub' ] to contain 'x-pub'`, `expected 'unresolved-link' to be 'podcast-link-missing'`). |

#### Review remediation (review visit 1, P2)

The review found that the draft lane cleared the unresolved list after dropping the optional
`metadata.originalUrl` slot, so a draft payload whose **body** also carried `{{article_url}}` would
have published the literal placeholder — contradicting the invariant the branch's own comment
states. The rework re-scans the payload after the drop instead of clearing the list, which restores
the pre-fix behaviour exactly.

| File | Lines | What / why |
| --- | --- | --- |
| `apps/cli/src/publish-matrix.ts` | 1974-1980 | Draft `originalUrl` drop re-filters `stillUnresolved` over the rewritten payload instead of setting it to `[]`, so a body-carried `{{article_url}}` still yields `unresolved-link` (`effect: none`, never dispatched). |
| `apps/cli/tests/publish-matrix-0431.test.ts` | 287-330 | New case: a wechatmp draft variant carrying `{{article_url}}` in both `metadata.originalUrl` and the body stays `effect: none` / `unresolved-link` and is never dispatched. Fails on the cleared-list version (`expected undefined to be 'unresolved-link'`), passes on the fix. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — when the podcast row has no succeeded receipt, a promo carrying `{{podcast_url}}` must not fail `unresolved-link`: it either falls back to the tier-0 article URL or is skipped with a named reason saying the podcast link is missing | MET | Fallback arm: `apps/cli/src/publish-matrix.ts:530-545` (declared `fallback: 'article'` at `:506-509`, own receipt wins) resolved for every promo in `apps/cli/tests/publish-matrix-0431.test.ts:160-238`; skip arm returns the named reason at `apps/cli/src/publish-matrix.ts:1984-1990`, asserted for all three promos at `apps/cli/tests/publish-matrix-0431.test.ts:240-283` (`error: 'podcast-link-missing'`, `effect: 'none'`, not dispatched). Ran: 3 pass / 0 fail. |
| R2 — the fallback is visible in the receipt/event so an operator can see which link a post carried | MET | One `link-fallback` event per substituted slot with `id`/`placeholder`/`source: 'article'`/`url`/`mode` (`apps/cli/src/publish-matrix.ts:1930-1947`), asserted for `x-pub.post`, `threads-pub.post`, `jike-pub.post` at `apps/cli/tests/publish-matrix-0431.test.ts:211-223`; the row's receipt is `succeeded` (`:222`). |
| R3 — a same-day re-point of one channel's copy must not require deleting a frozen `bundle.json` | MET | Met by obviation, the Solution's declared design: no writer or freeze file is in the diff (`git diff --stat` = one source file), and the fallback rides the frozen bytes — `apps/cli/tests/publish-matrix-0431.test.ts:225-233` asserts `social:x`'s frozen digest still matches the variant bytes after the send and that the resolved URL never enters `bundle.json`. Caveat recorded, not scored against the requirement: the freeze refusal itself is untouched, so an actual copy edit would still need a fresh freeze — the requirement is satisfied because the edit is no longer needed. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — a promo supplies the article link when the podcast link is missing | MET | test | `apps/cli/tests/publish-matrix-0431.test.ts:195-209`: the plan has no `podcast-pub.episode` row (`:187-190`, safety-excluded), `x-pub` is dispatched, the resolved payload carries `https://example.test/surfdash-pub` and no `{{podcast_url}}`, and the event is `sent` with no `unresolved-link` failure. Ran: 3 pass / 0 fail. Gap named: the test drives `sendPublishMatrix` over the whole plan rather than the CLI's `--tier 3`; that flag is pre-existing, untouched by this diff, and separately covered at `apps/cli/tests/publish-matrix.test.ts:607-611`. |
| AC2 — the fallback is recorded | MET | test | `apps/cli/tests/publish-matrix-0431.test.ts:211-223`: a `link-fallback` entry with `source: 'article'`, `placeholder: '{{podcast_url}}'` and the substituted `url` is present in `4-publish/publish-events.jsonl` for all three promo ids. |
| AC3 — the chosen behaviour on a missing tier-0 URL is covered by a test, and it fails when the substitution is removed | MET | test | Both arms asserted at `apps/cli/tests/publish-matrix-0431.test.ts:160-283` (article substitution; `effect: none` skip carrying `podcast-link-missing`). Fails-when-removed reproduced this visit: with `apps/cli/src/publish-matrix.ts` at `HEAD` the suite gives 1 pass / 2 fail (`expected [ 'surfdash-pub', 'wechatmp-pub' ] to contain 'x-pub'`, `expected 'unresolved-link' to be 'podcast-link-missing'`); source restored byte-identical. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0431

**Scope:** working-tree diff vs `HEAD` (`9b45f160`) — `apps/cli/src/publish-matrix.ts` (+96/−25) and new `apps/cli/tests/publish-matrix-0431.test.ts` (333 lines). Second review visit, after remediation of visit 1's P2.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | functional | The fallback is declared per SLOT, not per channel, so it also covers live tier≥1 rows carrying `{{podcast_url}}` outside the social promos (`xhs-pub` 写播客, `shipinhao-pub` audio — both use the shared `episode` variant): their "listen" link becomes the article URL instead of failing. R1 sanctions this and every substitution is event-recorded. Re-verified by inspection only — no test asserts the tier-1 channel set (evidence gap, named here so a reader can re-check). | `apps/cli/src/publish-matrix.ts:506-509` | ACCEPTED |
| 2 | P4 (advisory) | usability | A promo that ships on the fallback is `succeeded`, so its link can never be re-resolved: pre-fix the row was `effect: none` and `--retry` would resend it with the real episode URL once the podcast published. Correct for a safety exclusion (that row never publishes); a one-way door for a transient podcast failure, and no flag prefers the podcast link. | `apps/cli/src/publish-matrix.ts:1930-1947` | ACCEPTED |
| 3 | P4 (advisory) | usability | The published copy still reads `🎧 完整节目：<article url>` — only the event trail names the substitution; the visible text does not. R2 scopes the visibility requirement to the receipt/event, so this is out of scope, not an oversight. | `apps/cli/src/publish-matrix.ts:1933-1943` | ACCEPTED |
| 4 | P4 (advisory) | architecture | The draft-lane carve-out is still an undeclared magic-string policy inside the dispatcher: `source.placeholder === '{{article_url}}'` plus a regex over serialized JSON (`/"originalUrl"\s*:\s*"\{\{article_url\}\}"/`), duplicating what `LINK_SOURCES` already knows and sitting exactly where visit 1's P2 lived. Correct now and test-covered, but declaring the property on the table row (`optionalInDraft: true`) would make the invariant structural instead of a second re-scan. Advisory only — the diff deliberately leaves 0383's carve-out in place. | `apps/cli/src/publish-matrix.ts:1966-1982` | ACCEPTED |

No P1/P2/P3 findings.

##### Remediation of review visit 1 (P2) — independently verified

Visit 1 found that the draft lane set the unresolved list to `[]` after dropping the optional `metadata.originalUrl` slot, so a draft whose BODY also carried `{{article_url}}` would have dispatched with the literal placeholder. The current diff re-filters the payload instead (`apps/cli/src/publish-matrix.ts:1973-1982`), and the new case at `apps/cli/tests/publish-matrix-0431.test.ts:285-332` covers it. Verified, not trusted:

- **The regression case is a genuine falsifier.** Re-installing the cleared-list form of that block (`stillUnresolved = []`) makes exactly that case fail: `Expected: "unresolved-link" / Received: undefined` at `apps/cli/tests/publish-matrix-0431.test.ts:325` — the draft really did dispatch, so the test fails without the fix.
- **The fix restores pre-fix semantics exactly.** With `apps/cli/src/publish-matrix.ts` reverted to `HEAD`, the third case passes while the two 0431 cases fail (`expected [ 'surfdash-pub', 'wechatmp-pub' ] to contain 'x-pub'`; `expected 'unresolved-link' to be 'podcast-link-missing'`) — so the re-scan is behaviour-preserving for the 0383 lane and load-bearing for R1/AC3.
- **The positive 0383 path did not regress.** A throwaway probe (deleted afterwards) with a draft row whose only `{{article_url}}` is the optional `originalUrl` slot still dispatches: receipt `status: succeeded`, resolved payload carries no literal placeholder. The re-scan does not over-refuse.
- **Class sweep.** The drop-class has one site: the only other post-substitution payload mutation, `carryOfficialAccountLink` (`apps/cli/src/publish-matrix.ts:1948-1957`), runs BEFORE the unresolved check, so its output is re-scanned by construction. The resolution-class also has one surface: `grep "{{podcast_url}}\|{{article_url}}"` over `apps/ packages/ plugins/ scripts/` shows `substituteLinkPlaceholders` as the only substituter outside the writer's placeholder constants (`apps/cli/plugins/kk/scripts/daily-stages.ts:2231-2232`).
- **Working tree restored.** `apps/cli/src/publish-matrix.ts` is byte-identical to its pre-review state (sha256 `0e006cf508ab5db88039aad0a3a9b3d4d4a9c0b33340e86431f2aa41362fd21d`, checked with `shasum -c`); the probe file was removed and `git status` matches the pre-review state.

##### Verification runs (fresh, this visit)

| Check | Result |
|-------|--------|
| `cd apps/cli && bun test tests/publish-matrix-0431.test.ts` | 3 pass / 0 fail, 40 expect() calls |
| 12 publish suites incl. the new one (`publish-matrix`, `-0330/-0331/-0332/-0333`, `-send-repair`, `-stage`, `-tier0-cover`, `-0431`, `publish-core`, `publish-dispatch`, `publish-channels-link`) | 146 pass / 0 fail |
| `bun test tests/kk-publish.e2e.test.ts` | 3 pass / 0 fail |
| `bunx tsc --noEmit` (apps/cli) | clean, no output |
| `bunx biome check apps/cli/src/publish-matrix.ts apps/cli/tests/publish-matrix-0431.test.ts` | clean, "Checked 2 files … No fixes applied" |
| Falsification A: `publish-matrix.ts` at `HEAD` | 1 pass / 2 fail (the two 0431 cases) |
| Falsification B: cleared-list `stillUnresolved = []` | 2 pass / 1 fail (the new 0383 case) |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — when the podcast row has no succeeded receipt, a promo carrying `{{podcast_url}}` must not fail `unresolved-link`: it either falls back to the tier-0 article URL or is skipped with a named reason saying the podcast link is missing | MET | Fallback arm: `apps/cli/src/publish-matrix.ts:530-545` (declared `fallback: 'article'` at `:506-509`, own receipt wins) resolved for every promo in `apps/cli/tests/publish-matrix-0431.test.ts:160-238`; skip arm returns the named reason at `apps/cli/src/publish-matrix.ts:1984-1990`, asserted for all three promos at `apps/cli/tests/publish-matrix-0431.test.ts:240-283` (`error: 'podcast-link-missing'`, `effect: 'none'`, not dispatched). Ran: 3 pass / 0 fail. |
| R2 — the fallback is visible in the receipt/event so an operator can see which link a post carried | MET | One `link-fallback` event per substituted slot with `id`/`placeholder`/`source: 'article'`/`url`/`mode` (`apps/cli/src/publish-matrix.ts:1930-1947`), asserted for `x-pub.post`, `threads-pub.post`, `jike-pub.post` at `apps/cli/tests/publish-matrix-0431.test.ts:211-223`; the row's receipt is `succeeded` (`:222`). |
| R3 — a same-day re-point of one channel's copy must not require deleting a frozen `bundle.json` | MET | Met by obviation, the Solution's declared design: no writer or freeze file is in the diff (`git diff --stat` = one source file), and the fallback rides the frozen bytes — `apps/cli/tests/publish-matrix-0431.test.ts:225-233` asserts `social:x`'s frozen digest still matches the variant bytes after the send and that the resolved URL never enters `bundle.json`. Caveat recorded, not scored against the requirement: the freeze refusal itself is untouched, so an actual copy edit would still need a fresh freeze — the requirement is satisfied because the edit is no longer needed. |

##### Acceptance Criteria

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| AC1 — a promo supplies the article link when the podcast link is missing | MET | test | `apps/cli/tests/publish-matrix-0431.test.ts:195-209`: the plan has no `podcast-pub.episode` row (`:187-190`, safety-excluded), `x-pub` is dispatched, the resolved payload carries `https://example.test/surfdash-pub` and no `{{podcast_url}}`, and the event is `sent` with no `unresolved-link` failure. Ran: 3 pass / 0 fail. Gap named: the test drives `sendPublishMatrix` over the whole plan rather than the CLI's `--tier 3`; that flag is pre-existing, untouched by this diff, and separately covered at `apps/cli/tests/publish-matrix.test.ts:607-611`. |
| AC2 — the fallback is recorded | MET | test | `apps/cli/tests/publish-matrix-0431.test.ts:211-223`: a `link-fallback` entry with `source: 'article'`, `placeholder: '{{podcast_url}}'` and the substituted `url` is present in `4-publish/publish-events.jsonl` for all three promo ids. |
| AC3 — the chosen behaviour on a missing tier-0 URL is covered by a test, and it fails when the substitution is removed | MET | test | Both arms asserted at `apps/cli/tests/publish-matrix-0431.test.ts:160-283` (article substitution; `effect: none` skip carrying `podcast-link-missing`). Fails-when-removed reproduced this visit: with `apps/cli/src/publish-matrix.ts` at `HEAD` the suite gives 1 pass / 2 fail (`expected [ 'surfdash-pub', 'wechatmp-pub' ] to contain 'x-pub'`, `expected 'unresolved-link' to be 'podcast-link-missing'`); source restored byte-identical. |

**Next:** none — fix and evidence hold; the four P4 observations are accepted and recorded above.

Verdict: PASS

### References

- Run: `.works/kk-news-generate/20261124/4-publish/publish-events.jsonl` (four `unresolved-link` entries, 2026-11-24T21:09Z)
- Safety verdict: `.works/kk-news-generate/20261124/4-safety-variants/safety.json` (`excludedPlatforms: [xiaoyuzhou, wechatmp]`)
- Writer: `plugins/kk/scripts/daily-stages.ts` → `buildSocialContent` (`listenUrl`), `PLACEHOLDER_LINKS`
- Resolver: `apps/cli/src/publish-matrix.ts` → `LINK_SOURCES`
- Freeze refusal: `apps/cli/src/commands/content-generate.ts` (`a frozen bundle is never rewritten`)

### History

- 2026-11-25T06:37:24.478Z todo → wip (system)
- 2026-11-25T06:43:52.730Z wip → testing (system)
- 2026-11-25T06:43:54.670Z testing → done (system)
- 2026-11-25T06:44:11.755Z done → wip (system)
- 2026-11-25T06:50:25.541Z wip → testing (system)
- 2026-11-25T06:50:27.453Z testing → done (system)

