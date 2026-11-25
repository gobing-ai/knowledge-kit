---
schema_version: 1
name: surfdash cover patch fails when the podcast row never uploaded a remote cover
status: done
template: issue
created_at: 2026-11-24T21:55:04.921Z
updated_at: "2026-11-25T07:17:44.838Z"
feature_id: L3

ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close
---

## 0432. surfdash cover patch fails when the podcast row never uploaded a remote cover

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

- [x] R1. When the podcast row did not run, the surfdash cover patch must source its https cover from the surfdash side (CMS upload or the plugin's own hosted asset) instead of failing.
- [x] R2. If no https cover exists at all, the patch must be recorded as a warning with the page URL, not as a failed target — the post is already live and the og:image resolves.
- [x] R3. The settlement/outcome row must distinguish "content published, cover patch skipped" from "content not published".

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

Root cause (two links in one chain): (a) `surfdash-pub`'s `patch` treated "no remote https cover" as a
fatal error (`patch.ts` threw), and (b) the only https cover the run could hand it was
`podcast-pub`'s `metadata.imageUrl` — the matrix stage passed nothing else, and `surfdash-pub`'s own
`publish` already uploaded the rendered cover to podcast-media but never reported the URL. With the
podcast row held by `bundle.safety.excludedPlatforms`, `coverUrl` was empty, no `localCover` was
passed, and a live page settled as a failed target.

Fix: source the cover from the surfdash side first, and make a cover the patch genuinely cannot
source a recorded warning with the page URL rather than a failure. Genuine patch failures (branch
guard, git/push, site gate, CMS re-sync) keep their existing semantics.

| file:line | what / why |
| --- | --- |
| `plugins/publishings/surfdash-pub/src/patch.ts:42-70` | `PatchPostRequest.pageUrl` plus the new `CoverPatchOutcome` type (`status/applied/skipped/reason/pageUrl`) — the per-pass cover verdict that replaces the throw (R1/R2). |
| `plugins/publishings/surfdash-pub/src/patch.ts:200-215` | The "no https cover anywhere" branch records the locale as `coverSkipped` instead of throwing; the episode identity and cross-link below still get written (R2). |
| `plugins/publishings/surfdash-pub/src/patch.ts:79-86,240-258` | `PatchPostOutcome.coverPatch` carries the verdict out of the file pass; the reason keeps the searchable "no remote https:// cover" wording and names the page URL (R2/R3). |
| `plugins/publishings/surfdash-pub/src/index.ts:85-90,1012-1020,1052-1058` | `options.pageUrl` threaded into `patchPostFiles`, so the plugin's own diagnostic names the live page. |
| `plugins/publishings/surfdash-pub/src/index.ts:1062-1110` | `patch` echoes `patch: cover patch skipped … (page …)` and returns `ok: true` with `metadata.coverPatch`; the message names the skip (R2). |
| `plugins/publishings/surfdash-pub/src/index.ts:1125-1135,1500-1530,1536-1545,1595-1632` | `publish`/`prepare` report the https cover they uploaded as `metadata.coverUrl` — the surfdash-side cover source a later patch uses when no podcast row ran (R1). |
| `plugins/kk/scripts/kk-workflow-stages.ts:1540-1562` | `coverPatchWarning()` turns a `metadata.coverPatch.status === 'skipped'` result into one operator warning naming the reason and page URL; shared by both patch stages. |
| `plugins/kk/scripts/kk-workflow-stages.ts:1653-1690` | `publish-matrix-patch-surfdash` cover precedence: podcast receipt `imageUrl` → surfdash receipt `coverUrl` → this run's `23-cover` PNG as the plugin-side upload fallback; the payload now also carries `localCover` and `pageUrl` (R1/R2). |
| `plugins/kk/scripts/kk-workflow-stages.ts:1700-1721` | Result gate: a skipped cover logs the warning and exits 0 (the page is live); a real patch failure still `failWith(1, …)` (R2/R3). |
| `plugins/kk/scripts/kk-workflow-stages.ts:1969-1981` | The voice2 `daily-patch-surfdash` path prints the same warning, so both publish paths report the skip identically. |
| `apps/cli/src/publish-matrix.ts:1607-1642` | `CoverPatchDiagnostic` + `readCoverPatchDiagnostic()` read the patch stage's verdict from `4-publish/patch-surfdash.result.json` (absent/malformed → no diagnostic, never invented). |
| `apps/cli/src/publish-matrix.ts:1323-1336` | `publish-matrix-settle` records `coverPatch` in `settlement.<window>.json` and never puts it in `unresolved` — "content published, cover patch skipped" now reads differently from "content not published" (R3). |
| `plugins/publishings/surfdash-pub/tests/cover-patch-0432.test.ts:1-151` | New regression (P1–P4): skip-vs-throw, hosted-cover patch, preserved argument validation, and `publish` reporting `metadata.coverUrl`. |
| `apps/cli/tests/publish-matrix-0432.test.ts:1-349` | New regression (S1–S3, T1–T2): stage cover sourcing + warning gate + unchanged failure semantics, and the settlement published-with-skip vs never-published distinction. |
| `plugins/publishings/surfdash-pub/tests/surfdash-pub.test.ts:1898-1925` | The old `patchPostFiles throws …` test now asserts the recorded skip (and still asserts the non-https uploader throws). |

#### Review remediation (review visit 1, P2 + P3)

The review found two real defects in the first pass; both are fixed and each carries a
fail-first regression test (`S4` in `apps/cli/tests/publish-matrix-0432.test.ts`, `P5` in
`plugins/publishings/surfdash-pub/tests/cover-patch-0432.test.ts`).

| File | Lines | What / why |
| --- | --- | --- |
| `plugins/kk/scripts/kk-workflow-stages.ts` | 1710-1732 | The failed-CMS-re-sync branch is now checked BEFORE the cover-skip return, so a skipped cover can no longer mask a `cmsResync: 'failed'` soft-channel failure (P2: the first pass returned the cover warning first, making a real re-sync failure invisible). |
| `plugins/publishings/surfdash-pub/src/patch.ts` | 165-175, 198-222 | `uploadLocalCover` is wrapped: an environment failure (missing base URL/key, presign rejection, network) no longer fails the target — it lands in `coverPatch.uploadError` and the R2 skip warning instead. A non-https upload RESULT still throws, so argument validation is unchanged (P3). |
| `plugins/publishings/surfdash-pub/src/patch.ts` | 59-70, 262-272 | `CoverPatchOutcome.uploadError` names the upload cause; `reason` appends `(local cover upload failed: …)` so the operator sees why no cover was sourced. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — when the podcast row did not run, the patch sources its https cover from the surfdash side (CMS upload / the plugin's own hosted asset) instead of failing | MET | Precedence `podcast receipt imageUrl → surfdash receipt coverUrl → this run's 23-cover PNG` at `plugins/kk/scripts/kk-workflow-stages.ts:1661-1668`; the surfdash receipt's cover is reported by `publish` itself after the podcast-media upload (`plugins/publishings/surfdash-pub/src/index.ts:1400-1432` upload, `:1539` `coverMetadata`, `:1599`/`:1630` publish metadata), and `TargetOutcomeSchema.metadata` passthrough carries it into the aggregate the stage reads (`packages/kk-core/src/schemas.ts:52`, `apps/cli/src/fanout.ts:104-118`); the plugin uploads the local fallback itself and rejects a non-https result (`plugins/publishings/surfdash-pub/src/patch.ts:183-217`). Executed: `apps/cli/tests/publish-matrix-0432.test.ts:217` (`coverUrl` = hosted cover, `localCover` = this run's PNG, `pageUrl` = live page), `plugins/publishings/surfdash-pub/tests/cover-patch-0432.test.ts:144` (publish metadata carries the hosted URL) — pass |
| R2 — if no https cover exists at all, record a warning with the page URL, not a failed target | MET | No throw on the no-cover branch: `coverSkipped.push(locale)` at `plugins/publishings/surfdash-pub/src/patch.ts:222-228`; verdict built at `:262-275` (`status/applied/skipped/reason/pageUrl/uploadError`); a throwing upload degrades to the same skip at `:198-217`; the plugin echoes the skip and still returns `ok: true` (`plugins/publishings/surfdash-pub/src/index.ts:1062-1067`, `:1096-1110`); the stage warns and exits 0 (`plugins/kk/scripts/kk-workflow-stages.ts:1549-1557`, `:1709`, `:1723-1726`) with the CMS-failure ordering fix in front of it (`:1716`). Executed: `plugins/publishings/surfdash-pub/tests/cover-patch-0432.test.ts:47` (skip + page URL, cross-link still written), `:117` (upload failure → skip + `uploadError`), `apps/cli/tests/publish-matrix-0432.test.ts:236` (exit 0, reason + page URL on stderr), `:264` (skipped cover no longer masks a failed CMS re-sync), `:293` (a real failure still exits 1) — plus a fresh out-of-tree probe of the plugin's real `ok:true` + `coverPatch: skipped` shape → exit 0 and `patch-surfdash: WARNING: cover patch skipped — … (page https://surfing.salty.vip/zh/posts/20261124-261124)`. Caveat: the legacy `dailyPatchSurfdash` path names no page URL (finding 3) |
| R3 — the settlement/outcome row distinguishes "content published, cover patch skipped" from "content not published" | MET | `coverPatch` is read from the patch stage's verdict and recorded on the settlement record, never pushed onto `unresolved` (`apps/cli/src/publish-matrix.ts:1325` read, `:1333` record, reader `:1626-1643`; absent/malformed → no diagnostic rather than an invented one). Executed: `apps/cli/tests/publish-matrix-0432.test.ts:322` (`marked: true`, `unresolved: []`, `coverPatch: {status: skipped, reason, pageUrl}`, row still `succeeded`) and `:366` (never-published window → `marked: false`, row in `unresolved`, no `coverPatch`) — pass |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — a held podcast row does not fail the surfdash patch: surfdash row stays `succeeded`, the outcome carries a `coverPatch: skipped` diagnostic with the reason, no target reported failed | MET | test | `apps/cli/tests/publish-matrix-0432.test.ts:217` (excluded podcast row → surfdash-side cover + local fallback + page URL in the payload), `:236` (cover skip is a warning, stage exit 0, reason + page URL on stderr), `:322` (settlement `coverPatch: {status: 'skipped', reason, pageUrl}`, `unresolved: []`, row `status: 'succeeded'`), `plugins/publishings/surfdash-pub/tests/cover-patch-0432.test.ts:47` (skip, not throw, with page URL); 11/11 new tests pass |
| AC2 — the patch still writes a cover when one exists | MET | test | `plugins/publishings/surfdash-pub/tests/cover-patch-0432.test.ts:67` (hosted URL written to zh and en, `coverPatch: applied`, `applied: ['zh','en']`), `:144` (publish reports the cover it hosted), `apps/cli/tests/publish-matrix-0432.test.ts:217` (podcast-succeeded precedence preserved); pre-existing patch suites unchanged and green: `plugins/publishings/surfdash-pub/tests/` 170 pass |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0432 (review visit 2, after remediation)
**Scope:** task 0432 diff — 8 modified files + the 2 new test files (`apps/cli/tests/publish-matrix-0432.test.ts`, `plugins/publishings/surfdash-pub/tests/cover-patch-0432.test.ts`); task 0431's in-flight `link-fallback` work in `apps/cli/src/publish-matrix.ts` was read for interaction only (0432's change there is additive: settlement diagnostic + reader, no send/substitution path touched)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Remediation verification (visit 1 P2 / P3) — fail-first confirmed

Both fixes are present, and each new regression genuinely **fails** with its fix reverted (files restored afterwards; `sha256sum -c` OK on both):

| Visit-1 finding | Reversion applied | Observed result |
| --- | --- | --- |
| P2 — a skipped cover masked a failed CMS re-sync | moved the cover-skip return back ahead of the `meta.cmsResync === 'failed'` branch in `plugins/kk/scripts/kk-workflow-stages.ts:1714-1723` | `S4` FAILS as designed: `error: expect(received).toContain(expected)` / `Expected to contain: "cms re-sync failed"` / `Received: "patch-surfdash: WARNING: cover patch skipped — zh/en post has no remote https:// cover (page https://surfing.salty.vip/zh/posts/20261124-261124); …"` — 0 pass / 1 fail |
| P3 — a throwing local-cover upload failed a live page | restored the unguarded `await request.uploadLocalCover(...)` in `plugins/publishings/surfdash-pub/src/patch.ts:197-203` | `P5` FAILS as designed: `error: MICROFEED_BASE_URL is not set` propagates out of `patchPostFiles` — 0 pass / 1 fail |

Post-restore state (fresh today): `apps/cli/tests/publish-matrix-0432.test.ts` + `plugins/publishings/surfdash-pub/tests/cover-patch-0432.test.ts` → **11 pass / 0 fail**; regression neighbours `plugins/publishings/surfdash-pub/tests/` → **170 pass / 0 fail**; `publish-matrix-0333` + `publish-matrix-tier0-cover` + `publish-matrix-stage` + `kk-workflow-stages` + `publish-matrix-0431` → **205 pass / 0 fail**; `biome check` on the six touched files clean; `tsc --noEmit` clean in both `apps/cli` and `plugins/publishings/surfdash-pub`. R1–R3 / AC1–AC2 were re-judged from scratch, not inherited.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P2 (major) | correctness | Visit-1 P2 — cover-skip return ran before the CMS-re-sync branch. Now `meta.cmsResync === 'failed'` is evaluated first, so a soft-channel failure is never swallowed by a cover warning; `S4` exercises exactly that combined result. | `plugins/kk/scripts/kk-workflow-stages.ts:1714-1724` | RESOLVED (verified by reversion: S4 fails without the ordering fix) |
| 2 | P3 (minor) | correctness | Visit-1 P3 — unguarded `uploadLocalCover` turned an environment failure into a failed target. The upload is now wrapped: a throw lands in `uploadError`, the locale records as skipped, and the reason appends `(local cover upload failed: …)`; a non-https upload RESULT still throws, so argument validation is unchanged (`P3`). | `plugins/publishings/surfdash-pub/src/patch.ts:198-217`, `:262-273` | RESOLVED (verified by reversion: P5 fails without the guard) |
| 3 | P4 (advisory) | usability | R2's "warning **with the page URL**" holds on the matrix path only: `dailyPatchSurfdash` builds its payload without `pageUrl` and calls `coverPatchWarning(meta)` with no fallback, so a cover skip there reads `(page unknown)` while the surfdash receipt's `url` sits unread. AC1/AC2 exercise the matrix path. | `plugins/kk/scripts/kk-workflow-stages.ts:1966` (payload), `:1975` (no fallback) | ACCEPTED — unchanged from visit 1; secondary path, one-line follow-up |
| 4 | P4 (advisory) | correctness | The stage branch that actually fires on a real dogfood run (`result.ok === true` + `coverPatch: skipped`) has no committed regression: `S2` models an `ok:false` + `coverPatch` result that today's plugin cannot emit (a skip-only patch returns `ok:true`, `plugins/publishings/surfdash-pub/src/index.ts:1104-1110`). Verified by a fresh out-of-tree probe instead: exit 0 and `patch-surfdash: WARNING: cover patch skipped — … (page https://surfing.salty.vip/zh/posts/20261124-261124); the post is already live and its og:image resolves`. | `plugins/kk/scripts/kk-workflow-stages.ts:1703-1711` | ACCEPTED — behaviour verified by execution; a unit test of the `ok:true` shape would close it |
| 5 | P4 (advisory) | correctness | Mirror image of visit-1 P2 on the legacy surface: `dailyPatchSurfdash` has no cover-skip branch before `failWith`, so an `ok:false` + skip-only result would still fail the stage there. Unreachable with today's plugin (that shape is not emitted); recorded so the two surfaces stay visibly asymmetric. | `plugins/kk/scripts/kk-workflow-stages.ts:1986-1991` | ACCEPTED — unreachable today; the matrix stage is the one that owns the shape |
| 6 | P4 (advisory) | correctness | `readCoverPatchDiagnostic` carries no window/run identity check and `patch-surfdash.result.json` is not window-suffixed, so a second window in the same day dir can inherit the first window's cover verdict when its own patch stage did not run. It never touches `marked`/`unresolved`, and absent/malformed → no diagnostic rather than an invented one. | `apps/cli/src/publish-matrix.ts:1626-1643` | ACCEPTED — unchanged from visit 1; recorded as a residual risk |
| 7 | P4 (advisory) | correctness | `coverPatch.status` is derived from "was anything skipped", so a pass in which no locale post exists reports `applied` with `applied: []` — a vacuous success indistinguishable from a real apply. Unreachable in the shipped flow (the under-sourced path is not used) and settlement still lists such a row in `unresolved`. | `plugins/publishings/surfdash-pub/src/patch.ts:265-273` | ACCEPTED — unchanged from visit 1 |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — when the podcast row did not run, the patch sources its https cover from the surfdash side (CMS upload / the plugin's own hosted asset) instead of failing | MET | Precedence `podcast receipt imageUrl → surfdash receipt coverUrl → this run's 23-cover PNG` at `plugins/kk/scripts/kk-workflow-stages.ts:1661-1668`; the surfdash receipt's cover is reported by `publish` itself after the podcast-media upload (`plugins/publishings/surfdash-pub/src/index.ts:1400-1432` upload, `:1539` `coverMetadata`, `:1599`/`:1630` publish metadata), and `TargetOutcomeSchema.metadata` passthrough carries it into the aggregate the stage reads (`packages/kk-core/src/schemas.ts:52`, `apps/cli/src/fanout.ts:104-118`); the plugin uploads the local fallback itself and rejects a non-https result (`plugins/publishings/surfdash-pub/src/patch.ts:183-217`). Executed: `apps/cli/tests/publish-matrix-0432.test.ts:217` (`coverUrl` = hosted cover, `localCover` = this run's PNG, `pageUrl` = live page), `plugins/publishings/surfdash-pub/tests/cover-patch-0432.test.ts:144` (publish metadata carries the hosted URL) — pass |
| R2 — if no https cover exists at all, record a warning with the page URL, not a failed target | MET | No throw on the no-cover branch: `coverSkipped.push(locale)` at `plugins/publishings/surfdash-pub/src/patch.ts:222-228`; verdict built at `:262-275` (`status/applied/skipped/reason/pageUrl/uploadError`); a throwing upload degrades to the same skip at `:198-217`; the plugin echoes the skip and still returns `ok: true` (`plugins/publishings/surfdash-pub/src/index.ts:1062-1067`, `:1096-1110`); the stage warns and exits 0 (`plugins/kk/scripts/kk-workflow-stages.ts:1549-1557`, `:1709`, `:1723-1726`) with the CMS-failure ordering fix in front of it (`:1716`). Executed: `plugins/publishings/surfdash-pub/tests/cover-patch-0432.test.ts:47` (skip + page URL, cross-link still written), `:117` (upload failure → skip + `uploadError`), `apps/cli/tests/publish-matrix-0432.test.ts:236` (exit 0, reason + page URL on stderr), `:264` (skipped cover no longer masks a failed CMS re-sync), `:293` (a real failure still exits 1) — plus a fresh out-of-tree probe of the plugin's real `ok:true` + `coverPatch: skipped` shape → exit 0 and `patch-surfdash: WARNING: cover patch skipped — … (page https://surfing.salty.vip/zh/posts/20261124-261124)`. Caveat: the legacy `dailyPatchSurfdash` path names no page URL (finding 3) |
| R3 — the settlement/outcome row distinguishes "content published, cover patch skipped" from "content not published" | MET | `coverPatch` is read from the patch stage's verdict and recorded on the settlement record, never pushed onto `unresolved` (`apps/cli/src/publish-matrix.ts:1325` read, `:1333` record, reader `:1626-1643`; absent/malformed → no diagnostic rather than an invented one). Executed: `apps/cli/tests/publish-matrix-0432.test.ts:322` (`marked: true`, `unresolved: []`, `coverPatch: {status: skipped, reason, pageUrl}`, row still `succeeded`) and `:366` (never-published window → `marked: false`, row in `unresolved`, no `coverPatch`) — pass |

##### Acceptance Criteria

| AC | Status | Evidence Type | Evidence |
|-----|--------|---------------|----------|
| AC1 — a held podcast row does not fail the surfdash patch: surfdash row stays `succeeded`, the outcome carries a `coverPatch: skipped` diagnostic with the reason, no target reported failed | MET | test | `apps/cli/tests/publish-matrix-0432.test.ts:217` (excluded podcast row → surfdash-side cover + local fallback + page URL in the payload), `:236` (cover skip is a warning, stage exit 0, reason + page URL on stderr), `:322` (settlement `coverPatch: {status: 'skipped', reason, pageUrl}`, `unresolved: []`, row `status: 'succeeded'`), `plugins/publishings/surfdash-pub/tests/cover-patch-0432.test.ts:47` (skip, not throw, with page URL); 11/11 new tests pass |
| AC2 — the patch still writes a cover when one exists | MET | test | `plugins/publishings/surfdash-pub/tests/cover-patch-0432.test.ts:67` (hosted URL written to zh and en, `coverPatch: applied`, `applied: ['zh','en']`), `:144` (publish reports the cover it hosted), `apps/cli/tests/publish-matrix-0432.test.ts:217` (podcast-succeeded precedence preserved); pre-existing patch suites unchanged and green: `plugins/publishings/surfdash-pub/tests/` 170 pass |

##### Residual risks

- `readCoverPatchDiagnostic` is not window-scoped (finding 6): the settlement diagnostic describes *a* patch pass in the day dir, not provably this window's.
- The legacy `dailyPatchSurfdash` surface is asymmetric with the matrix stage (findings 3 and 5); if a future plugin change can emit `ok:false` with a skip-only `coverPatch`, that path fails a live page again.
- `apps/cli/plugins/` is gitignored bundled output and `isStagedPluginsStale` compares only `kk/{workflows,scripts}` (`scripts/bundle-plugins.ts:220-221`), so a stale local staged tree still carries the pre-fix throw (`apps/cli/plugins/publishings/surfdash-pub/src/patch.ts:175`). This change set is unaffected — `plugins/kk/scripts/kk-workflow-stages.ts` is in a compared tree, so the next `bun run prepare` does a full restage — but any future surfdash-pub-only change must be bundled with a full `bun run build`, not `--if-stale`. Pre-existing packaging behaviour (0430), outside 0432's scope.

**Next:** none — R1–R3 and AC1–AC2 are MET with fresh execution evidence; the two visit-1 defects are closed and fail-first verified. The remaining rows are P4 observations accepted above.

Verdict: PASS

### References

- Live page: `https://surfing.salty.vip/zh/posts/20261124-261124` (200, og:image resolves)
- Run artifacts: `.works/kk-news-generate/20261124/4-publish/` (`settlement.after-generate.json`, `dispatch-ledger.json`)
- Patch stage: `kk news publish-settle` → `patch-surfdash` / `patch-podcast`

### History

- 2026-11-25T07:03:02.299Z todo → wip (system)
- 2026-11-25T07:10:00.340Z wip → testing (system)
- 2026-11-25T07:10:02.247Z testing → done (system)
- 2026-11-25T07:11:30.132Z done → wip (system)
- 2026-11-25T07:17:42.911Z wip → testing (system)
- 2026-11-25T07:17:44.829Z testing → done (system)

