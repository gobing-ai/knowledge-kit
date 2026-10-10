---
schema_version: 1
name: Keep a voice2 XHS series when card point text overflows the safe area
status: done
template: feature-impl
created_at: 2026-10-10T15:28:47.498Z
updated_at: "2026-10-10T17:37:58.333Z"
feature_id: G11

priority: P2
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 3
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0251-verdict.json
---

## 0251. Keep a voice2 XHS series when card point text overflows the safe area

### Background

Voice2 run `dfcdba24-30c0-4c66-9525-0574f7050e48` finished the episode and then lost the Xiaohongshu series. `xhs-render` exited 1 in about 1 second. The run log stderr was: `image-gen failed: compose: text overflows the safe area for field(s): points[1], points[2] (safe area: 72px inset)` followed by `xhs render: card 01 failed ... re-run daily-xhs-render to resume from card 01`. The node is `onError: continue`, so the DAG stayed successful and `xhs-publish` logged `publish-xhs: no card series` and skipped. Nothing was posted.

The overflow error is raised at `plugins/generations/image-gen/src/compose/chromium.ts:149`. The stage stops the series in `dailyXhsRender` (`plugins/kk/scripts/daily-stages.ts:2122-2126`).

`kk()` (`plugins/kk/scripts/kk-workflow-stages.ts:553-569`) uses `stdio: 'inherit'` and returns only the exit status. The overflow sentence is visible to the operator and to a test that captures the stage stderr, but `dailyXhsRender` cannot read it from the return value. A retry that branches on stderr needs a capture sibling. The default `kk()` stays inherit.

Session triage already fixed the plan-defer, candidate dedup, block-YAML fitter, duration wording, and show-notes exclusion. Those are out of scope here. This task is only the overflow failure that left 20261010 with no card series. 0250 owns the regression tests for those other contracts.

No other task is `wip`, and `git worktree list` shows only this checkout on `main` (2026-10-10).

### Requirements

- [x] R1. When a voice2 card's `points[n]` fields overflow the compose safe area, `daily-xhs-render` shortens those point strings, retries that card once, and then packages the card with the rest of the series.
- [x] R2. A card that fails for a reason other than safe-area overflow of `points[n]` still stops at that card, keeps earlier cards, and prints the existing resume line. It is not retried.
- [x] R3. `plugins/kk/workflows/kk-daily-ai-voice2.yaml` keeps the current `xhs-render` command and `xhs_live` default `false`. This task does not publish a live Xiaohongshu note.

**Out of scope:** changing the compose overflow error, clipping inside `chromium.ts`, retrying a `headline` or other non-`points[n]` field, a third image-gen call, and any live Xiaohongshu post.

### Acceptance Criteria

```gherkin
Scenario: AC1 — an overflowing card is shortened and retried once (req: R1)
- Given a card plan whose image-gen fake fails the first call with stderr `text overflows the safe area for field(s): points[1], points[2] (safe area: 72px inset)` and succeeds the second, when `daily-xhs-render` runs, then image-gen is called twice, the second `--in` envelope has shorter `points[1]` and `points[2]` than the first, and `25-xhs/content.json` exists.

Scenario: AC2 — a non-overflow card failure does not retry (req: R2)
- Given a card plan whose image-gen fake fails with stderr `provider timeout`, when `daily-xhs-render` runs, then image-gen is called once, the stage exits non-zero, and stderr contains `re-run daily-xhs-render`.
- Given the existing image-gen exit-7 fake with no overflow sentence, when `daily-xhs-render` runs, then image-gen is called once and the stage exits 7.

Scenario: AC3 — the voice2 XHS command and live default stay put (req: R3)
- Given the voice2 workflow file, when the task's diff is reviewed, then the `xhs-render` shell command is unchanged and `xhs_live` is still `"false"`.
```

### Q&A

#### Closed — capture stderr beside kk(), do not change kk()
`kk()` inherits stdio and returns a number (`kk-workflow-stages.ts:557-569`). The retry reads stderr from a new `kkCaptured` helper. The inherit default stays, so other stages keep their current output.

#### Closed — one sentence cut, one retry, points only
Pixel fitting stays in the composer. The stage drops the last sentence of each named `points[n]`, or keeps 36 code points plus `…` when the point is one sentence, then calls image-gen once more. A `headline` overflow, an empty stderr, or a second failure uses today's resume line.

#### Closed — no live publish
`xhs_live` stays `"false"`. This task does not open the creator UI.

### Design

Handle the retry in `dailyXhsRender` (`plugins/kk/scripts/daily-stages.ts:2084-2126`), not in the composer. No new workflow flag.

`kk()` stays `stdio: 'inherit'` and still returns a number (`kk-workflow-stages.ts:557-569`). Add `kkCaptured` beside it. It spawns the same `kk` binary with `stdio: 'pipe'`, reprints stdout and stderr to the parent, and returns `{ status, stderr }`. `dailyXhsRender` uses `kkCaptured` only for the image-gen call in that loop. Every other `kk()` call is unchanged.

On a non-zero image-gen status, retry once only when stderr contains `text overflows the safe area for field(s):` and every named field matches `points[<n>]` with `<n>` in range of `card.points`. Otherwise fail with the existing resume line (`:2125`) and do not call image-gen again.

Shorten each named point: if the string has a `。`, `！`, or `？` that is not its last character, cut at the last such mark, inclusive. Otherwise, if it is longer than 36 code points, keep the first 36 and append `…`. If nothing got shorter, do not retry; fail with the resume line. Write the shortened strings back onto `card.points`, rewrite `25-xhs/cards/card-<index>.in.json` with the same envelope shape (`points` joined by `\n`, `:2090-2111`), and call image-gen once more. A second non-zero status fails with the same resume line. Do not try a third time.

Tests live in `apps/cli/tests/kk-workflow-stages.test.ts`, beside `daily-xhs-render names the failed card and exits with image-gen status` (`:1520`). `fakeXhsKk` (`:1136`) exits before it can print the overflow sentence, so the new cases use their own fake. The existing `:1520` case must stay one call and status 7.

Rejected: only tightening the `xhs-write` prompt. The 2026-10-10 agent already wrote points the composer rejected.
Rejected: silent clipping inside `chromium.ts`. `plugins/generations/image-gen/tests/compose.test.ts:316` asserts the overflow error string, and other callers want that hard failure.
Rejected: reading stderr from `kk()`. It inherits stdio and returns a number.
Rejected: failing the voice2 run. `xhs-render` is `onError: continue`; the defect is the missing series.

Do not set `xhs_live` true and do not drive the creator UI. No other `wip` task and no second worktree touch these files (2026-10-10).

### Plan

1. Add a stage test in `apps/cli/tests/kk-workflow-stages.test.ts` whose fake image-gen fails the first call with stderr `compose: text overflows the safe area for field(s): points[1], points[2] (safe area: 72px inset)` and succeeds the second. Assert two calls, shorter `points[1]` and `points[2]` on the second `--in` file, and a packaged `25-xhs/content.json`.
2. Add a second case whose stderr is `provider timeout`. Assert one call, a non-zero exit, and stderr containing `re-run daily-xhs-render`. The existing `:1520` case stays one call and status 7.
3. Add `kkCaptured` next to `kk` and the single retry in `dailyXhsRender` only, using the shorten rule in Design.
4. Run `bun test apps/cli/tests/kk-workflow-stages.test.ts` and `bun test plugins/generations/image-gen/tests/compose.test.ts`. Judge pass/fail counts. A single-file exit 1 with `0 fail` is the coverage threshold, not a failure. The compose overflow error string stays unchanged.

### Solution

Change map (one anchor per row, repo-root-relative):

| Change | Anchor |
| --- | --- |
| New `kkCaptured(args, options)` beside `kk()`: spawns `kk` with `stdio: 'pipe'`, reprints captured stdout+stderr to the parent (operator log unchanged), returns `{ status, stderr }`; same 127-on-launch-error and `soft` semantics as `kk()`. `kk()` itself is untouched. | plugins/kk/scripts/kk-workflow-stages.ts:578 |
| New `xhsOverflowPoints(stderr, card)`: parses the composer sentence `text overflows the safe area for field(s):` into `points[n]` indexes; returns `null` when the marker is absent, any named field is not `points[<n>]`, or an index is out of range of `card.points` — null means no retry. | plugins/kk/scripts/daily-stages.ts:2046 |
| New `shortenOverflowedPoint(point)`: cuts at the last `。`/`！`/`？` that is not the final character (inclusive); a one-sentence point longer than 36 code points keeps the first 36 plus `…`; returns the input unchanged when neither rule shortens it. | plugins/kk/scripts/daily-stages.ts:2067 |
| `dailyXhsRender` image-gen call switched to `kkCaptured` (the only captured call); on non-zero status, retry once only when `xhsOverflowPoints` names fields and at least one named point actually got shorter — the envelope `card-<index>.in.json` is rewritten in the same shape (`points` re-joined by `\n`) and image-gen is called once more. Any other failure, a nothing-got-shorter overflow, or a second failure exits with the existing resume line. No third attempt. | plugins/kk/scripts/daily-stages.ts:2169 |
| Import `kkCaptured` + `type XhsCard` into daily-stages. | plugins/kk/scripts/daily-stages.ts:82 |
| New fake `fakeXhsKkFailFirst`: fails each `--in` path's first call with a caller-supplied stderr (fakeXhsKk exits before it can print one) and snapshots every call's envelope to `<record>.<n>.json` because the retry rewrites `card-01.in.json` in place. | apps/cli/tests/kk-workflow-stages.test.ts:1543 |
| AC1 test: overflow on `points[1], points[2]`, fake succeeds on retry — asserts 2 calls, shorter `points[1]`/`points[2]` on the second envelope (last-sentence cut verified verbatim), `25-xhs/content.json` packaged. | apps/cli/tests/kk-workflow-stages.test.ts:1567 |
| AC2 test: stderr `provider timeout` — asserts 1 call, exit 3, stderr contains `re-run daily-xhs-render`. | apps/cli/tests/kk-workflow-stages.test.ts:1619 |
| AC2 second given: the existing exit-7 case now also asserts the fake was called exactly once (no retry without the overflow sentence). | apps/cli/tests/kk-workflow-stages.test.ts:1529 |

Rationale: the retry branches on stderr the inherit-stdio `kk()` cannot return, so a capture sibling is the minimal seam; `kk()` and every other call site stay byte-identical. The retry lives in the stage (not the composer) because pixel fitting is image-gen's contract — `compose.test.ts` asserts the overflow error string, and other callers want that hard failure. One retry with a guaranteed-shorter envelope bounds the extra spend at one provider call per card. R3 held by omission: `plugins/kk/workflows/kk-daily-ai-voice2.yaml` is not in this diff, so the `xhs-render` command and `xhs_live: "false"` default are unchanged.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | test — `bun test apps/cli/tests/kk-workflow-stages.test.ts` = 111 pass / 0 fail; case "daily-xhs-render shortens overflowing points and retries the card once (0251 AC1)" (apps/cli/tests/kk-workflow-stages.test.ts:1567) asserts 2 image-gen calls, verbatim last-sentence cuts on points[1]/points[2] in the second envelope, and packaged 25-xhs/content.json. Code: xhsOverflowPoints (plugins/kk/scripts/daily-stages.ts:2046) parses the composer marker matching plugins/generations/image-gen/src/compose/chromium.ts:149 verbatim; shortenOverflowedPoint (plugins/kk/scripts/daily-stages.ts:2067) implements the sentence-cut / 36-code-point rule; retry-once block at plugins/kk/scripts/daily-stages.ts:2169-2191. |
| R2 | MET | test — case "daily-xhs-render does not retry a card whose failure is not a points overflow (0251 AC2)" (apps/cli/tests/kk-workflow-stages.test.ts:1619) asserts 1 call, exit 3, stderr contains `re-run daily-xhs-render`; the pre-existing exit-7 case (apps/cli/tests/kk-workflow-stages.test.ts:1520) now asserts exactly one call. xhsOverflowPoints returns null for missing marker, non-points fields, and out-of-range indexes (plugins/kk/scripts/daily-stages.ts:2046-2058); non-retry failures exit via the pre-existing resume line with status passthrough (plugins/kk/scripts/daily-stages.ts:2191). |
| R3 | MET | command — `git diff --name-only HEAD -- plugins/kk/workflows/` prints nothing (workflow untouched); `grep -n 'xhs_live\|daily-xhs-render' plugins/kk/workflows/kk-daily-ai-voice2.yaml` shows `47:  xhs_live: "false"` and the unchanged `kk stage daily-xhs-render … "episode"` command at line 629. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — an overflowing card is shortened and retried once (req: R1) | MET | test | `bun test apps/cli/tests/kk-workflow-stages.test.ts -t '0251'` = 2 pass / 0 fail. fakeXhsKkFailFirst (apps/cli/tests/kk-workflow-stages.test.ts:1543) fails the first call with stderr `compose: text overflows the safe area for field(s): points[1], points[2] (safe area: 72px inset)` and succeeds on retry; the AC1 case (:1567) asserts exactly 2 calls, second envelope points[1] === '第一句很长很长的内容用来填充安全区。' and points[2] === '短。' (last-sentence cut), both strictly shorter than the first envelope, and existsSync(25-xhs/content.json). |
| AC2 — a non-overflow card failure does not retry (req: R2) | MET | test | AC2 case (apps/cli/tests/kk-workflow-stages.test.ts:1619): stderr `provider timeout` → exit 3, exactly 1 image-gen call, stderr contains `xhs render: card 01 failed` and `re-run daily-xhs-render`. Second given: the 0219 AC2 exit-7 case (:1520) asserts `toHaveLength(1)` on the call record, proving no retry without the overflow sentence. Full file run: 111 pass / 0 fail. |
| AC3 — the voice2 XHS command and live default stay put (req: R3) | MET | command | `git diff --name-only HEAD -- plugins/kk/workflows/` output is empty — plugins/kk/workflows/kk-daily-ai-voice2.yaml is not in this task's diff. `grep -n 'xhs_live\|daily-xhs-render' plugins/kk/workflows/kk-daily-ai-voice2.yaml` prints `47:  xhs_live: "false"` and `629:          kk stage daily-xhs-render "${vars.work_dir}" "${vars.run_date}" "${vars.plugins_path}" "${vars.xhs_cards}" "${vars.xhs_style}" "${vars.xhs_provider}" "${vars.xhs_model}" "${vars.xhs_fallback}" "episode"` — the xhs-render shell command and the live default are unchanged. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Independent re-review (attempt 2) of task 0251's uncommitted diff in this tree: `plugins/kk/scripts/kk-workflow-stages.ts` (kkCaptured), `plugins/kk/scripts/daily-stages.ts` (xhsOverflowPoints, shortenOverflowedPoint, dailyXhsRender retry), the 0251 hunks of `apps/cli/tests/kk-workflow-stages.test.ts` (fakeXhsKkFailFirst + AC1/AC2 near :1543), and this task file. The `plugins/kk/tests/kk-workflow-stages.test.ts` hunk and the 0250 hunks of `apps/cli/tests/kk-workflow-stages.test.ts` were excluded as certified 0250 scope.

**Traceability**

- R1 — `dailyXhsRender` captures image-gen stderr via `kkCaptured` (`daily-stages.ts:2169`), parses the composer sentence with `xhsOverflowPoints` (`:2046`), shortens via `shortenOverflowedPoint` (`:2067`), rewrites `card-<index>.in.json` in the identical envelope shape (`:2183-2188`, same `imageGen` object, `points` re-joined by `\n`), and retries exactly once (`:2190`). The parsed marker `text overflows the safe area for field(s):` matches `plugins/generations/image-gen/src/compose/chromium.ts:149` verbatim. The shorten rule matches the Design: cut at the last `。`/`！`/`？` that is not the final character, inclusive (scan from `chars.length - 2` down, `slice(0, i + 1)`); else first 36 code points + `…` when longer than 36; unchanged input ⇒ caller reads nothing-shortened ⇒ no retry.
- R2 — any other failure (no marker, a non-`points[<n>]` field like `headline`, or an out-of-range index ⇒ `xhsOverflowPoints` → null), a nothing-shortened overflow, or a second non-zero status all exit with the pre-existing resume line (`:2163`, `:2191`); no third attempt; earlier cards and exit-status passthrough are unchanged (`failWith(result.status, ...)` preserves e.g. exit 7/3).
- R3 — `plugins/kk/workflows/kk-daily-ai-voice2.yaml` is absent from this diff; `xhs-render` command (`kk-daily-ai-voice2.yaml:629`) and `xhs_live: "false"` (`:47`) verified unchanged in the working tree.
- `kk()` is byte-identical (`kk-workflow-stages.ts:553-569`, same env-merge/unset order, 127-on-launch-error, soft semantics); `kkCaptured` (`:578`) differs only in `stdio: 'pipe'` + reprint + `{ status, stderr }` return. It is used by exactly one stage — the two `kkCaptured(` occurrences in `daily-stages.ts` are the first call and its single retry inside the same block; all 15 remaining `kk(` call sites are untouched. No new workflow flag, no new public API beyond the two exported stage helpers.

**Findings**

| Sev | Finding | Evidence |
| --- | --- | --- |
| P4 (advisory) | Inline comment overstates the retry gate: "whose named fields all shorten" — the code retries when at least one named point shortens, which is what the Design ("If nothing got shorter, do not retry") and Solution table specify. Comment-only; suggest "at least one named point got shorter". | plugins/kk/scripts/daily-stages.ts:2173 |
| P4 (advisory) | `kkCaptured` relies on `spawnSync` default `maxBuffer` (1 MB under Node semantics); a pathological child would surface as a 127 launch error. Image-gen output is far below this; note only. | plugins/kk/scripts/kk-workflow-stages.ts:584 |
| P4 (advisory) | The retry mutates `card.points` after the note-body `lines` were pre-computed from `card.points[0]` (`:2126`), so if `points[0]` is the shortened field the packaged note body keeps the original text while the card shows the shortened one. Cosmetic divergence; the body cap was deliberately settled before billing (0235 R2), and `cards.json` carries no `points`. | plugins/kk/scripts/daily-stages.ts:2126, 2178-2181 |
| P4 (advisory) | A one-sentence point of exactly 37 BMP code points rewrites to 36 + `…` = equal UTF-16 length, so the `next.length < point.length` gate treats it as nothing-shortened and declines the retry. Consistent with the Design's "nothing got shorter" wording and avoids a doomed extra provider call; noted for completeness of the nothing-got-shorter edge. | plugins/kk/scripts/daily-stages.ts:2174-2179 |

**SECUA** — argv-only `spawnSync` with no shell string; env merge/unset mirrors `kk()` including the nested-spur unset path; launch error keeps the 127 + `console.error` contract; captured stdout and stderr are both reprinted to the parent (batched at child exit rather than streamed — accepted by the Design). No swallowed errors: a failed retry reprints the second stderr and fails with the resume line carrying the second exit status. Empty `card.points` ⇒ every parsed index out of range ⇒ null ⇒ no retry. Tests are deterministic: sequential `spawnSync`, per-`--in` first-call failure counting, per-call envelope snapshots (`<record>.<n>.json`) neutralizing the in-place envelope rewrite, and `withTempDir` isolation.

**Verification (this attempt, re-run)** — `bun test apps/cli/tests/kk-workflow-stages.test.ts`: 111 pass, 0 fail. `bun test plugins/generations/image-gen/tests/compose.test.ts`: 15 pass, 0 fail (compose overflow error string unchanged). AC1 asserts two calls, verbatim last-sentence cuts on `points[1]`/`points[2]`, and packaged `25-xhs/content.json`; AC2 asserts one call, exit 3, and the resume line; the pre-existing exit-7 case now also asserts exactly one call. AC3 holds by omission.

**Residual risk** — the retry spends at most one extra provider call per card, only with a strictly shorter envelope; a hand re-run after a second failure regenerates the envelope from the unmodified plan, so it overflows-and-retries once more (bounded, same as today's behavior). `kkCaptured` output appears after the child exits rather than live — acceptable for a stage log.

**Disposition: PASS** — zero open P1/P2/P3; four P4 advisories only.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-10T15:36:30.369Z backlog → todo (system)
- 2026-10-10T16:39:12.403Z todo → wip (system)
- 2026-10-10T17:37:31.856Z wip → testing (system)
- 2026-10-10T17:37:58.328Z testing → done (system)

