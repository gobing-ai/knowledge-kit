---
schema_version: 1
name: "Surf of the digest headline contract: kk demands two title headlines while the site's aligned plan can collapse to one"
status: done
template: issue
created_at: 2026-11-19T22:00:27.891Z
updated_at: "2026-11-20T00:44:25.369Z"

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 2
feature_id: L3
done_forced: "false"
done_reason: unforced close
---

## 0408. Surf of the digest headline contract: kk demands two title headlines while the site's aligned plan can collapse to one

### Background

Captured from the 2026-11-19 dogfood of the scheduled daily run: the kk digest gate refused a surfdash post whose title the site's own `seo retitle` had collapsed to one headline (`zh: digest frontmatter check failed: title: expected exactly two non-empty headlines joined 、, got Will Wright`). The post was live in zh/en/ja (run outside kk), but the kk receipt stayed `uncertain/unknown` and the window classified `partial`.

**Refine corrections (2026-11-19)**

- **Renumbered 0395 → 0408.** WBS 0395 was also held by the done task `0395_bind-wechat-channels-cards…`, so WBS-keyed resolution picked one file of the pair (same defect class as commit 109f8c86). The file was moved and its header edited; `.spur/context/memory.md` references updated.
- **Gate location corrected.** The original said "plugins/kk/scripts (topic-claims gate)". The two-headline rule actually lives in `plugins/publishings/surfdash-pub/src/digest-check.ts:226-229` (`checkDigestFrontmatter`, `seps !== 1`) and `plugins/publishings/surfdash-pub/src/topic-claims.ts:72` (`parseTitleHeadlines`, `heads.length < 2` → undefined). It is pinned by `plugins/publishings/surfdash-pub/tests/digest-check.test.ts:93-123`.
- **Contract owner decided: option (b), mirror the site.** The site gate `surfdash/scripts/commands/check-digest.ts:331-350` allows 1–2 headlines. 3+ always fails, and 1 fails only when `twoHeadlinesThatFit(...)` proves two fit in every locale. kk re-implementing that budget check would duplicate the site's SEO ownership (ADR-008) and drift. kk keeps the structural floor (≥1, ≤2, non-empty) and leaves "were two owed?" to the site gate, which `publishPreparedFile` already runs through the orchestrator's refine step.
- **Option (a), the translate step, moved out.** Producing aligned en/ja is the root of 0409 (the new `kk-news-generate` dropped the old `translate` state). It is tracked there, not here. Even with aligned translations the site may legitimately emit one headline when two do not fit, so this gate fix stands on its own.
- **Evidence paths.** `.works/kk-news-generate/20261119/4-publish/receipts/` does not exist on disk (only `check.preflight.json`). The receipt quote above comes from the 2026-11-19 session log (`.spur/context/memory.md:316-317`) and is not re-readable.

### Requirements

- [x] R1. — Accept the site's headline range. `checkDigestFrontmatter` accepts a daily title carrying **one or two** non-empty headlines joined by the locale list separator (`、` zh/ja, `, ` en). It still rejects zero headlines, any empty headline, and three or more. The error text names the actual count.
- [x] R2. — Claims parsing follows the same range. `parseTitleHeadlines` returns a one-element array for a single-headline title, so `buildLocaleEntry` (`topic-claims.ts:102-138`) keeps working. The rule "title headlines are the leading key_points labels, in order" applies unchanged to one headline.
- [x] R3. — No budget re-implementation. kk does not decide whether two headlines would have fit. That verdict stays with the site's `check-digest` (`twoHeadlinesThatFit`), reached through the existing publish path.
- [x] R4. — Regression coverage. The existing "exactly two" test is rewritten to the new contract. New cases cover single-headline accept (zh, en, ja), 3-headline reject, and empty-headline reject. At least one case must fail on the pre-fix code.

**Non-goals:** producing en/ja (0409); changing the site's retitle/aligned-plan logic; the single-episode `第<YY><MM><DD>期 · <headline>` title (the news editorial contract, `docs/design/daily-ai-news-editorial-delivery.md:27`), which is not the surfdash post title.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A single-headline title passes the kk digest gate (req: R1)
  Given a zh, an en and a ja daily post whose title is "<series> · YYYY-MM-DD<sep><one headline>"
  When checkDigestFrontmatter runs on each
  Then no title problem is reported for any of the three locales

Scenario: AC2 — Out-of-range titles are still refused (req: R1)
  Given titles with zero headlines, an empty headline, or three headlines
  When checkDigestFrontmatter runs
  Then each reports a title problem naming the headline count, and the two-headline title still passes

Scenario: AC3 — Claims derive from a single-headline title (req: R2)
  Given a single-headline title whose headline equals the first key_points label
  When buildLocaleEntry runs
  Then it returns an entry (no "title headlines do not match" error), and a headline that is not the first label is still rejected

Scenario: AC4 — kk does not judge the two-headline budget (req: R3)
  Given the changed sources
  When they are searched for a headline-fit or budget computation
  Then none exists; only the 1..2 structural range is enforced

Scenario: AC5 — The regression is pinned (req: R4)
  Given the updated digest-check and topic-claims tests
  When they run against the pre-fix code
  Then the single-headline cases fail, and all cases pass after the fix
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-11-20T00:23:03.066Z

- **Q: Who owns the "were two headlines owed?" decision? A (closed 2026-11-19):** the site. `check-digest.ts:338-350` already fails a single headline when two fit, and that runs in the publish orchestrator's refine. kk mirrors only the structural range.
- **Q: Should kk enforce exactly two when 0409 lands aligned translations? A (closed):** no. The site generator falls back to one headline whenever two exceed the SEO budget (`check-digest.ts:331-332` comment), independent of translation quality.
- **Q: Does `SURFDASH_DIGEST_CHECK=warn|off` change? A (closed):** no. The env knob stays as is (`index.ts:426-435`).

### Design

**WHAT.** Relax two structural predicates in surfdash-pub from "exactly 2" to "1..2". Nothing else changes.

**WHY.** kk's gate is a pre-flight mirror of the site's `check-digest`. The site accepts 1–2 and owns the budget decision (ADR-008: the site owns SEO metadata). A stricter mirror makes every collapsed-title day unconfirmable even though the site publishes it.

**WHERE (frozen).**

| File | Change |
| --- | --- |
| `plugins/publishings/surfdash-pub/src/digest-check.ts:224-229` | Replace `seps !== 1` with `seps > 1`. Keep the empty-head check. Message becomes `title: expected one or two non-empty headlines joined "<sep>", got <n> in "<rest>"`. |
| `plugins/publishings/surfdash-pub/src/topic-claims.ts:72` | `heads.length < 2` → `heads.length < 1 \|\| heads.length > 2`. |
| `plugins/publishings/surfdash-pub/tests/digest-check.test.ts:93-123` | Rewrite to the 1..2 contract; add the AC1/AC2 cases. |
| surfdash-pub topic-claims tests (same `tests/` dir) | Add the AC3 single-headline case. |

**Anti-patterns.** Do not port `twoHeadlinesThatFit` or any SEO budget math into kk. Do not loosen the leading-labels rule. Do not touch `SURFDASH_DIGEST_CHECK`.

### Plan

1. **Tests first (R4).** Edit `digest-check.test.ts:93-123` and add the single-headline (zh/en/ja), 3-headline and empty-headline cases, plus the topic-claims single-headline case. Run `bun test plugins/publishings/surfdash-pub/tests/` and confirm the new accept cases fail on current code (judge by pass/fail counts; a single-file run exits 1 on coverage).
2. **R1.** Change the separator predicate and message in `digest-check.ts`.
3. **R2.** Change the length guard in `topic-claims.ts:72`.
4. **R3 check.** `rg -n 'fit|budget' plugins/publishings/surfdash-pub/src/{digest-check,topic-claims}.ts` shows no new budget logic.
5. **Gate.** `bun run lint` and `bun run test` (per-file ≥90% coverage) must pass. No live publish.
6. **Install sync (only if a scheduled run must pick it up before release).** Product plugins resolve from the project root, so no rsync is needed for `kk news publish` run from this checkout. Note it in Testing.

### Root Cause

**Verified (2026-11-19, code read).** kk's pre-flight digest gate is stricter than the site gate it mirrors. `plugins/publishings/surfdash-pub/src/digest-check.ts:226-229` requires exactly one list separator (two headlines), and `topic-claims.ts:72` rejects fewer than two. The site's `check-digest.ts:338-350` allows one headline unless two provably fit. When the site's `seo retitle` legitimately collapses to one headline, kk refuses a post the site accepts, and the receipt can never confirm.

### Solution

**Change map.**

| File | Change |
| --- | --- |
| `plugins/publishings/surfdash-pub/src/digest-check.ts:215-232` | Replaced the `seps !== 1` predicate with a headline-count range: split `rest` on the locale list separator and reject `heads.length < 1 \|\| heads.length > 2 \|\| any empty`. The message now names the count: `title: expected one or two non-empty headlines joined "<sep>", got <n> in "<rest>"`. |
| `plugins/publishings/surfdash-pub/src/topic-claims.ts:68-73` | `parseTitleHeadlines` guard widened from `heads.length < 2` to `heads.length < 1 \|\| heads.length > 2`, so `buildLocaleEntry` accepts a one-headline title; the `headlines.length > parts.labels.length \|\| headlines[i] !== labels[i]` leading-label rule is untouched. |
| `plugins/publishings/surfdash-pub/tests/digest-check.test.ts` | Table rows rewritten to the 1..2 contract (`three zh headlines` → `got 3 in`, `empty zh headline` → `got 2 in`, `en … three headlines` → `got 3 in`). Removed the rows that now legitimately pass. Added a `%s: a single-headline title passes` case for zh/en/ja that also re-asserts the two-headline baseline. |
| `plugins/publishings/surfdash-pub/tests/topic-claims.test.ts` | Added `derives an entry from a single-headline title` (all three locales + the mismatched-lead refusal). |

**Why.** kk's digest gate is a pre-flight mirror of the site's `check-digest`. The site accepts 1–2 headlines and owns the "were two owed?" budget verdict (`twoHeadlinesThatFit`), reached through `publishPreparedFile`'s refine step. A stricter kk gate made every day on which `seo retitle` legitimately collapsed the title unconfirmable, even though the site published it.

**TDD order.** Tests were edited first and run against the pre-fix sources: 7 failures (3 rewritten table rows, 3 single-headline accepts, 1 topic-claims case). After the two source edits both files pass (55 pass / 0 fail).

**R3.** No fit/budget computation was added; the only `budget` occurrences in the two sources are the pre-existing `SEO_TITLE_LIMIT` comment (`digest-check.ts:31`, the rendered-title length rule) and the new explanatory comments.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/publishings/surfdash-pub/src/digest-check.ts:223-231` accepts one or two separator-joined headlines and rejects `heads.length > 2` or any empty segment; the message names the count (`digest-check.ts:230`). Single-headline accept per locale pinned by `tests/digest-check.test.ts:123` (zh/en/ja), out-of-range by `tests/digest-check.test.ts:88-104`. |
| R2 | MET | `plugins/publishings/surfdash-pub/src/topic-claims.ts:73` guard widened to `heads.length < 1 \|\| heads.length > 2 \|\| any empty`; `buildLocaleEntry`'s leading-label rule (`topic-claims.ts:129`) untouched. Pinned by `tests/topic-claims.test.ts:88` (one headline derives an entry; a non-leading headline still errors `do not match`). |
| R3 | MET | `rg -n 'fit\|budget\|twoHeadlines' plugins/publishings/surfdash-pub/src/{digest-check,topic-claims}.ts` returns only the pre-existing `SEO_TITLE_LIMIT` comment (`digest-check.ts:31`, rendered-title length) and the two new explanatory comments — no headline-fit computation, no site budget port. |
| R4 | MET | `tests/digest-check.test.ts:88-104,118-130` and `tests/topic-claims.test.ts:86-112` are the rewritten/extended cases; run against the pre-fix sources they failed 7 times (3 rewritten table rows, 3 single-headline accepts, 1 topic-claims case) and pass after the fix. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — a single-headline title passes the kk digest gate (R1) | MET | test | `tests/digest-check.test.ts:118-131` (zh/en/ja single headline → `[]`), green: `bun test plugins/publishings/surfdash-pub/` → 150 pass / 0 fail |
| AC2 — out-of-range titles are still refused (R1) | MET | test | `tests/digest-check.test.ts:88-104` — 3 headlines (`got 3 in`), empty headline (`got 2 in`), date-only/wrong series/wrong date/wrong colon; two-headline baseline still `[]` (`tests/digest-check.test.ts:64-77,131`) |
| AC3 — claims derive from a single-headline title (R2) | MET | test | `tests/topic-claims.test.ts:88-112` — entry built for all three locales with `headlines === ['Claude Code']`, and a non-leading single headline still reports `do not match` |
| AC4 — kk does not judge the two-headline budget (R3) | MET | command | `rg -n 'fit\|budget\|twoHeadlines' plugins/publishings/surfdash-pub/src/digest-check.ts plugins/publishings/surfdash-pub/src/topic-claims.ts` → 4 hits, all comments/preexisting `SEO_TITLE_LIMIT`; no computation added |
| AC5 — the regression is pinned (R4) | MET | test | Pre-fix run of the two test files: 7 failures / 48 pass; post-fix: 55 pass / 0 fail (`tests/digest-check.test.ts`, `tests/topic-claims.test.ts`) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Verdict: PASS** — 4 requirements MET, 5 AC MET (`spur task verdict 0408 --from-answer` → `PASS (4 requirements, 2 checks)`).

| Dimension | Finding |
| --- | --- |
| Functional traceability | R1 `digest-check.ts:223-231` · R2 `topic-claims.ts:73` · R3 grep shows no fit/budget logic · R4 pre-fix 7 failures → post-fix 55 pass / 0 fail. |
| Correctness | The old `seps !== 1` also rejected a separator-free single headline — exactly the shape the site's `seo retitle` emits. Counting segments matches the site's own split. |
| Architecture | No new seam: both predicates stay inside `surfdash-pub`; the SEO budget verdict stays with the site (ADR-008); `digestCheckGate`/`digestCheckLocaleSet` untouched. |
| Security / errors | The rejection message still quotes the offending title tail and now also the headline count; no new path or execution surface. |
| Tests | The reject rows moved to the count-naming message instead of being deleted, so both sides of the range stay pinned. |

- **P4 (advisory).** `heads.length < 1` is unreachable behind the `(.+)` title capture. Kept so the predicate states R1's "rejects zero headlines"; a zero-headline title is rejected on the earlier title-shape branch.
- **Intended widening.** An en title carrying `、` (or a zh title carrying `, `) now parses as one headline. Same structural range; the site's collapse can emit a headline whose text contains either separator.

**Scope checked:** `bun test plugins/publishings/surfdash-pub/` (150 pass / 0 fail), `biome check` on the four changed files (clean). Residual risk: the kk gate is a mirror, so a site-side change to `check-digest.ts`'s headline policy still drifts silently — unchanged by this task and out of its scope.

### References

- kk gate: `plugins/publishings/surfdash-pub/src/digest-check.ts:200-284`, `src/topic-claims.ts:64-73,102-138`, `src/index.ts:426-480` (`digestCheckGate`, `digestCheckLocaleSet`).
- Site gate: `/Users/robin/xprojects/surfdash/scripts/commands/check-digest.ts:325-352`; retitle `scripts/commands/seo/retitle.ts:217` (`alignedKeyPointPlan`), `:330` (`stampHeadlines`).
- Sibling: 0409 (en/ja production). Both edit surfdash-pub tests; land 0408 first to avoid conflicts.
- Environment: the surfdash checkout is 11 commits behind `origin/main` (2026-11-19). Not needed for this kk-only change, but required before any live verification.
- Concurrency check before starting: `git worktree list`, `spur task list --status wip --json`.

### History

- 2026-11-20T00:42:20.715Z todo → wip (system)
- 2026-11-20T00:44:24.131Z wip → testing (system)
- 2026-11-20T00:44:25.362Z testing → done (system)

