---
schema_version: 1
name: Keep a voice2 XHS series when card point text overflows the safe area
status: todo
template: feature-impl
created_at: 2026-10-10T15:28:47.498Z
updated_at: "2026-10-10T15:36:30.369Z"
feature_id: G11

priority: P2
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 3
---

## 0251. Keep a voice2 XHS series when card point text overflows the safe area

### Background

Voice2 run `dfcdba24-30c0-4c66-9525-0574f7050e48` finished the episode and then lost the Xiaohongshu series. `xhs-render` exited 1 in about 1 second. The run log stderr was: `image-gen failed: compose: text overflows the safe area for field(s): points[1], points[2] (safe area: 72px inset)` followed by `xhs render: card 01 failed ... re-run daily-xhs-render to resume from card 01`. The node is `onError: continue`, so the DAG stayed successful and `xhs-publish` logged `publish-xhs: no card series` and skipped. Nothing was posted.

The overflow error is raised at `plugins/generations/image-gen/src/compose/chromium.ts:149`. The stage stops the series in `dailyXhsRender` (`plugins/kk/scripts/daily-stages.ts:2122-2126`).

`kk()` (`plugins/kk/scripts/kk-workflow-stages.ts:553-569`) uses `stdio: 'inherit'` and returns only the exit status. The overflow sentence is visible to the operator and to a test that captures the stage stderr, but `dailyXhsRender` cannot read it from the return value. A retry that branches on stderr needs a capture sibling. The default `kk()` stays inherit.

Session triage already fixed the plan-defer, candidate dedup, block-YAML fitter, duration wording, and show-notes exclusion. Those are out of scope here. This task is only the overflow failure that left 20261010 with no card series. 0250 owns the regression tests for those other contracts.

No other task is `wip`, and `git worktree list` shows only this checkout on `main` (2026-10-10).

### Requirements

- [ ] R1. When a voice2 card's `points[n]` fields overflow the compose safe area, `daily-xhs-render` shortens those point strings, retries that card once, and then packages the card with the rest of the series.
- [ ] R2. A card that fails for a reason other than safe-area overflow of `points[n]` still stops at that card, keeps earlier cards, and prints the existing resume line. It is not retried.
- [ ] R3. `plugins/kk/workflows/kk-daily-ai-voice2.yaml` keeps the current `xhs-render` command and `xhs_live` default `false`. This task does not publish a live Xiaohongshu note.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-10T15:36:30.369Z backlog → todo (system)

