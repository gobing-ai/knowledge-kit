---
schema_version: 1
name: Retry a transient image-gen failure instead of losing the whole XHS card series
status: done
template: issue
created_at: 2026-10-12T23:05:01.141Z
updated_at: "2026-10-13T18:26:57.468Z"
feature_id: G11

ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0269-verdict.json
---

## 0269. Retry a transient image-gen failure instead of losing the whole XHS card series

### Background

The XHS card series (E8) renders card-by-card: `dailyXhsRender` (`plugins/kk/scripts/daily-stages.ts:2463`) shells out once per planned card to `kk executor run image-gen` (`daily-stages.ts:2544`), and the packaged manifest/Content are written only after every card has an artifact on disk (`daily-stages.ts:2608-2617`). The stage's only retry is the 0251 composer safe-area overflow rewrite (`daily-stages.ts:2545`); a provider failure carries no overflow sentence, so `xhsOverflowPoints` returns null (`daily-stages.ts:2390`) and the stage fails immediately with the resume line (`daily-stages.ts:2559`).

Inside image-gen there is no same-provider retry at all: strict mode rethrows the provider error as-is (`plugins/generations/image-gen/src/index.ts:428`), and with `fallback` set — the daily workflow pins `xhs_fallback: "true"` (`.spur/workflows/kk-daily-ai-voice.yaml:58`) — the D6 loop advances at once to the next vendor with no wait (`index.ts:450`). Once the candidate chain is spent the card fails loud (`index.ts:447`) and the run's failure cleanup deletes the artifacts written so far (`index.ts:619`). The 0164 classifier already distinguishes transient failures (HTTP 408/5xx, timeout/abort, network wording) in `plugins/generations/image-gen/src/providers/errors.ts` — nothing consumes that class for a retry.

Blast radius: the `xhs-write` node runs `onError: continue` (`.spur/workflows/kk-daily-ai-voice.yaml:469`), so one card failure does not stop the daily run — it skips the whole XHS target: `content.json` is never written, and `daily-publish-xhs` logs `no card series … — skip` (`daily-stages.ts:1593`). The planned series (default 4 cards via `xhs_cards`, up to `XHS_MAX_CARDS` 10) publishes as 0. A partially-rendered series is not usable today — packaging is all-or-nothing — but the stage is resume-safe (already-rendered cards are kept and not re-billed), so the missing card is recoverable by a hand re-run. The title's "loses the whole series" is therefore accurate at the target level: the run continues, the series does not ship.

Root defect: a transient provider blip (5xx, timeout, 429 rate-limit) is never retried on the same provider, so a short-lived failure — or a rate-limit window a brief wait would clear — falls through to other vendors or fails the card outright, forfeiting the entire series for the run.

### Requirements

- [x] R1. A provider failure classified `transient` (HTTP 408/5xx, timeout/abort, network wording) or `quota` (HTTP 429/rate-limit wording) by the 0164 classifier is retried on the same provider before any fallback move; `auth`, `policy`, and `unknown` failures are never retried on the same provider.
- [x] R2. The retry budget is at most 2 same-provider retries (3 attempts total) per provider per image, with a short growing backoff wait (1s, then 2s) between attempts.
- [x] R3. When the retry budget is exhausted the failure surface is unchanged: strict mode rethrows the original provider error, and with `fallback` set the loop advances to the next candidate exactly as today, including the loud all-candidates-failed error naming image, provider, and error class.
- [x] R4. A card that still fails after the full retry budget is reported by the xhs-render resume line naming the card, and the series is never packaged or published with a silently missing card.
- [x] R5. Every failed try, including each retried transient failure, is recorded in `Content.metadata.attempts` (image, provider, errorClass, message), so the retry history is observable in the output.

### Acceptance Criteria

```gherkin
Scenario: AC1 — a transient 5xx is retried on the same provider and the image still ships (req: R1; R2)
  Given an image-gen job with no fallback field whose provider call fails once with `MiniMax API error (500): upstream boom` and succeeds on the next call
  When the job runs through processGeneratorIO
  Then the run completes with the image artifact on disk, Content.metadata.attempts records the one failed transient try, and nothing is cleaned up

Scenario: AC2 — a 429 rate-limit failure gets the same bounded retry (req: R1)
  Given an image-gen job with no fallback field whose provider call fails once with `MiniMax API error (429): too many requests` and succeeds on the next call
  When the job runs through processGeneratorIO
  Then the retry succeeds and the run completes with the image artifact on disk

Scenario: AC3 — the budget is bounded and the backoff grows (req: R2; R5)
  Given an image-gen job with fallback set whose primary provider always fails with `HuggingFace HTTP 503: model loading` and whose fallback candidate succeeds
  When the job runs through processGeneratorIO
  Then the primary provider is called exactly 3 times, backoff waits of 1s and then 2s separate the retries, every failed try is recorded in Content.metadata.attempts, and the image is delivered by the fallback candidate

Scenario: AC4 — auth and policy failures are never retried (req: R1)
  Given an image-gen job with no fallback field whose provider call fails with `MiniMax API error (401): invalid api key`
  When the job runs through processGeneratorIO
  Then the provider is called exactly once, no backoff wait occurs, and the original error propagates as today

Scenario: AC5 — an exhausted budget fails loud and never packages a series with a missing card (req: R3; R4)
  Given a card whose provider keeps failing transiently and no fallback candidate is configured
  When daily-xhs-render runs the card series
  Then image-gen fails loud naming image, provider, and error class, the stage exits nonzero with the resume line naming the card, and no manifest or Content is written with the missing card
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-13T17:52:50.192Z

- D1 (closed) 2026-10-13 — Retry lives inside image-gen's `generateWithFallback`, not in `daily-xhs-render`: the 0164 classifier (`providers/errors.ts`) and attempt accounting already live there, and the stage sees only an exit code plus stderr text it cannot classify without duplicating the classifier outside its owning module.
- D2 (closed) 2026-10-13 — Retry classes are `transient` + `quota`: the 429/rate-limit half of `quota` heals with a short wait, while the balance/billing half burns at most one bounded retry — accepted rather than splitting the frozen 0164 classifier. `policy` is never retried (D6 R4 precedent), `auth` never (credentials do not heal), `unknown` not retried blind (0164 Q&A: unknowns are provider-specific constraints another provider may satisfy — they still advance down the fallback chain as today).
- D3 (closed) 2026-10-13 — Fixed policy, no new knob: at most 2 retries with 1s→2s backoff. The `ImageJobSpec` envelope is deliberately frozen (`job.ts`), and no caller needs to tune attempts today; add a spec field or env var only when a workflow needs to bound the added latency.
- D4 (closed) 2026-10-13 — Blast-radius contract unchanged: a still-failing card fails the stage (resume line) and the workflow keeps `onError: continue` (XHS target skipped, daily run continues). This task does not widen to partial-series publishing.

### Design

Seam: the D6 fallback loop `generateWithFallback` in `plugins/generations/image-gen/src/index.ts:393` (catch block `index.ts:427-451`), plus its leaf classifier `plugins/generations/image-gen/src/providers/errors.ts:91`.

1. `isTransientRetry(cls)` — a new one-liner beside `isFallbackEligible` in `providers/errors.ts` (leaf module, no import cycle): true for `transient` and `quota`.
2. Same-provider retry in the catch: when `isTransientRetry(cls)` and this image has spent fewer than 2 retries on the current provider, push the failed try into `attempts` (as today) and, after `await sleep(backoff)`, `continue` the loop WITHOUT advancing `at`. The retry counter is per provider per image (resets when `at` advances). Budget spent → exactly today's path: strict rethrow (`index.ts:428`), fallback advance (`index.ts:450`), all-candidates-failed error (`index.ts:447`).
3. `sleep?: (ms: number) => Promise<void>` option on `processGeneratorIO` (same seam style as `providerResolver`/`composer`), defaulting to a real wait of 1000ms then 2000ms — tests inject a spy and never actually sleep.

Classification rule (transient vs permanent), reusing the 0164 classifier unchanged: retried = `transient` (HTTP 408/5xx, TimeoutError/AbortError, network wording) and `quota` (HTTP 429/402, rate-limit wording); never retried = `policy` (prompt content will not change), `auth` (credentials will not heal), `unknown` (a blind retry burns spend; still advances down the fallback chain as today).

Out of scope: no `daily-stages.ts` change (the 0251 overflow loop, resume line, and all-or-nothing packaging stay), no workflow yaml change, no new `ImageJobSpec` field or env knob, no partial-series publishing, no second pass over the whole fallback order.

Tradeoffs rejected: retrying in `daily-xhs-render` by parsing image-gen stderr (duplicates 0164 classification outside its module); a whole-chain second pass (burns provider diversity for a single-provider blip); splitting `quota` into rate-limit vs billing (re-opens the frozen classifier to save one retry); an attempts/backoff knob (no caller needs it).

### Plan

1. [x] Regression tests first: create `plugins/generations/image-gen/tests/transient-retry.test.ts` modeled on `tests/fallback.test.ts` (stub provider + `optionsWith` seams, 0164 fixture throw strings, buffer stderr, injected `sleep` spy): AC1 strict 500-then-success, AC2 429-then-success, AC3 always-503 + fallback candidate (primary called 3 times, sleeps [1000, 2000], attempts recorded, image delivered by the candidate), AC4 401 single call / no sleep / original error. Run `bun test plugins/generations/image-gen/tests/transient-retry.test.ts` — expect AC1–AC3 to FAIL before the change (judge by test pass/fail counts, not exit code: a lone file can exit 1 on the per-file coverage threshold, see AGENTS.md).
2. [x] Add `isTransientRetry` beside `isFallbackEligible` in `plugins/generations/image-gen/src/providers/errors.ts`.
3. [x] Add the `sleep` option and the same-provider transient retry inside `generateWithFallback` (`plugins/generations/image-gen/src/index.ts:393-451`); every retried try lands in `attempts` (R5).
4. [x] Evidence: `bun test plugins/generations/image-gen/tests/transient-retry.test.ts` passes, then the full plugin suite `bun test plugins/generations/image-gen` stays green (fallback / provider-errors / image-gen).
5. [x] Stage preservation (AC5): `bun test apps/cli/tests/kk-workflow-stages.test.ts` — the existing `daily-xhs-render names the failed card and exits with image-gen status, keeping earlier cards (0219 AC2)` test (`kk-workflow-stages.test.ts:1614`) must stay green with no stage-code change.
6. [ ] Gate: `bun run lint` and `bun run test` (per-file 90% line/function coverage applies to the new branches in `index.ts` and `errors.ts`).

### Root Cause

No same-provider retry exists for transient provider failures. A transient error (HTTP 5xx/408, timeout/abort, network wording — already classified `transient` by `classifyProviderError`, `plugins/generations/image-gen/src/providers/errors.ts:79`) hits the D6 catch in `generateWithFallback` (`plugins/generations/image-gen/src/index.ts:427-451`): strict mode rethrows immediately (`index.ts:428`), and with `fallback` set the loop advances to the next vendor at once (`index.ts:450`) — never re-asking the provider that blipped, never waiting. When the chain is spent the card fails loud (`index.ts:447`) and cleanup deletes the run's artifacts (`index.ts:619`). The xhs-render stage's only retry is the 0251 composer overflow rewrite (`plugins/kk/scripts/daily-stages.ts:2545`), which a provider failure never matches (`xhsOverflowPoints` → null, `daily-stages.ts:2390`), so the stage fails on the first card failure (`daily-stages.ts:2559`); the workflow node's `onError: continue` (`.spur/workflows/kk-daily-ai-voice.yaml:469`) then skips the whole XHS target — one transient card failure forfeits the entire series for the run.

### Solution

Same-provider transient/quota retry inside image-gen's D6 fallback loop, exactly per the frozen Design — `daily-stages.ts`, the workflow yaml, and `ImageJobSpec` are untouched.

- `plugins/generations/image-gen/src/providers/errors.ts:99` — new leaf one-liner `isTransientRetry(cls)`: true for `transient` and `quota` (task Q&A D2); `auth`, `policy`, `unknown` never.
- `plugins/generations/image-gen/src/providers/types.ts:89` — re-export `isTransientRetry` beside `classifyProviderError`/`isFallbackEligible`, keeping `types.ts` the plugin's public surface.
- `plugins/generations/image-gen/src/index.ts:53` — fixed retry policy `TRANSIENT_RETRY_MAX = 2` with backoff `[1000, 2000]` (R2; no knob, task Q&A D3).
- `plugins/generations/image-gen/src/index.ts:217` — `sleep?: (ms: number) => Promise<void>` option on `processGeneratorIO` (same seam style as `providerResolver`/`composer`); the default `Bun.sleep` waits for real.
- `plugins/generations/image-gen/src/index.ts:448` — in `generateWithFallback`'s catch, a `transient`/`quota` failure with budget left records the failed try in `attempts` (R5), awaits the growing backoff, and continues on the SAME provider without advancing `at`; the per-image retry counter resets when `at` advances, so the budget is per provider per image (R2).
- `plugins/generations/image-gen/src/index.ts:454` — with the retry budget spent the failure surface is unchanged (R3): strict mode still rethrows the original error, and with `fallback` set the loop advances to the next candidate exactly as today, keeping the loud all-candidates-failed error naming image, provider, and error class.
- `plugins/generations/image-gen/tests/transient-retry.test.ts:151` — AC1–AC4 regression tests (0164 fixture throw strings, recording no-wait `sleep`, buffered stderr); AC1–AC3 failed against the pre-change code (strict 500/429 rethrown, primary called once instead of 3) and all four pass after.
- `plugins/generations/image-gen/tests/provider-errors.test.ts:72` — direct leaf test pinning the `isTransientRetry` class partition.
- `plugins/generations/image-gen/tests/fallback.test.ts:206` — the two existing quota-fixture tests updated to the intended retry semantics (the quota candidate now burns its 2 same-provider retries before advancing; the exhausted-order detail lists every retried try); fixtures and test intent unchanged, an injected no-wait sleep keeps them instant.

Plan item 6 is deliberately partial: `bun run lint` passed (biome + all workspace typechecks), but the full `bun run test` gate belongs to the pipeline's test hop and was not run from implement; the touched files' per-file coverage was verified instead via the plugin-suite run (index.ts 95.65% funcs / 93.55% lines, errors.ts 100/100).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/generations/image-gen/src/providers/errors.ts:99` — `isTransientRetry` true for `transient`+`quota` only (auth/policy/unknown false); retry branch gated on it at `plugins/generations/image-gen/src/index.ts:448`; partition pinned by `plugins/generations/image-gen/tests/provider-errors.test.ts:72-79`. AC1 (500→success, 2 calls) `plugins/generations/image-gen/tests/transient-retry.test.ts:151-170`; AC2 (429→success, 2 calls) `plugins/generations/image-gen/tests/transient-retry.test.ts:171-187`; AC4 (401 single call, no sleep) `plugins/generations/image-gen/tests/transient-retry.test.ts:235-249` |
| R2 | MET | Fixed policy `TRANSIENT_RETRY_MAX = 2` + backoff `[1000, 2000]` at `plugins/generations/image-gen/src/index.ts:53-54`; AC3 asserts 3 primary calls and sleeps `[1000, 2000]` (`plugins/generations/image-gen/tests/transient-retry.test.ts:201-202`); fallback AC4 pins the quota candidate's 3 calls (`plugins/generations/image-gen/tests/fallback.test.ts:249`). Per-image reset `let retries = 0` (`plugins/generations/image-gen/src/index.ts:412`) and per-provider reset `retries = 0` on advance (`plugins/generations/image-gen/src/index.ts:475`) — the per-provider reset is line-covered (google→zai advance `plugins/generations/image-gen/tests/fallback.test.ts:209`) but not independently assertion-pinned |
| R3 | MET | Strict rethrow `throw err` (original object, unwrapped) at `plugins/generations/image-gen/src/index.ts:455`, identity pinned by fallback AC1 `toBe(boom)` (`plugins/generations/image-gen/tests/fallback.test.ts:145-161`); fallback advance + loud all-candidates-failed error naming image/provider/class at `plugins/generations/image-gen/src/index.ts:471`, pinned by fallback AC4 (`plugins/generations/image-gen/tests/fallback.test.ts:233-249`). The strict-mode transient-exhaustion rethrow is the same `throw err` line (line-covered) but not separately asserted for a transient error |
| R4 | MET | No stage or workflow change — `git status --porcelain` shows only the image-gen plugin files, its tests, and the task doc (no `daily-stages.ts` / workflow yaml edit). Resume line + nonzero exit + no `cards.json`/`content.json` pinned by `apps/cli/tests/kk-workflow-stages.test.ts:1611-1623` (0219 AC2: status 7, stderr `xhs render: card 01 failed` and `re-run daily-xhs-render to resume`, both files throw on read) |
| R5 | MET | Every failed try recorded in `attempts` (image/provider/model/errorClass/message): retry branch `plugins/generations/image-gen/src/index.ts:449` and advance branch `plugins/generations/image-gen/src/index.ts:463`; AC3 asserts all 3 tries (`plugins/generations/image-gen/tests/transient-retry.test.ts:210-222`); fallback R3/AC4 pin the quota retries in `attempts` (`plugins/generations/image-gen/tests/fallback.test.ts:212-216`) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — a transient 5xx is retried on the same provider and the image still ships (req: R1; R2) | MET | test | `bun test plugins/generations/image-gen/tests/transient-retry.test.ts` → 4 pass / 0 fail. `plugins/generations/image-gen/tests/transient-retry.test.ts:151-170` asserts 2 minimax calls, sleeps [1000], image artifact on disk, and `attempts` = the one transient try |
| AC2 — a 429 rate-limit failure gets the same bounded retry (req: R1) | MET | test | `bun test plugins/generations/image-gen/tests/transient-retry.test.ts` → 4 pass / 0 fail. `plugins/generations/image-gen/tests/transient-retry.test.ts:171-187` asserts 2 minimax calls, sleeps [1000], image on disk, `attempts` = one quota try |
| AC3 — the budget is bounded and the backoff grows (req: R2; R5) | MET | test | `bun test plugins/generations/image-gen/tests/transient-retry.test.ts` → 4 pass / 0 fail. `plugins/generations/image-gen/tests/transient-retry.test.ts:189-222` asserts primary (huggingface) called exactly 3 times, sleeps [1000, 2000], fallback (google) 1 call and delivers the image, all 3 failed tries in `attempts` |
| AC4 — auth and policy failures are never retried (req: R1) | MET | test | `bun test plugins/generations/image-gen/tests/transient-retry.test.ts` → 4 pass / 0 fail. `plugins/generations/image-gen/tests/transient-retry.test.ts:235-259` asserts 401: caught === boom (original object), 1 call, no sleep, no out; policy: 1 call, no sleep, rejects |
| AC5 — an exhausted budget fails loud and never packages a series with a missing card (req: R3; R4) | MET | test | `bun test apps/cli/tests/kk-workflow-stages.test.ts -t 'names the failed card'` → 1 pass / 0 fail: `apps/cli/tests/kk-workflow-stages.test.ts:1611-1623` asserts status 7, stderr `xhs render: card 01 failed` + `re-run daily-xhs-render to resume`, no `cards.json`/`content.json`. Loud error naming image/provider/class pinned by `bun test plugins/generations/image-gen/tests/fallback.test.ts` → 10 pass / 0 fail, `plugins/generations/image-gen/tests/fallback.test.ts:233-249` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0269
**Scope:** plugins/generations/image-gen/src/index.ts, plugins/generations/image-gen/src/providers/errors.ts, plugins/generations/image-gen/src/providers/types.ts, plugins/generations/image-gen/tests/fallback.test.ts, plugins/generations/image-gen/tests/provider-errors.test.ts, plugins/generations/image-gen/tests/transient-retry.test.ts (new), docs/tasks/0269_retry-a-transient-image-gen-failure-instead-of-losing-the-wh.md
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS
**Confidence:** HIGH
##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | correctness | R2's "per provider per image" guarantee is line-covered but not assertion-pinned: deleting `retries = 0` leaves all 37 tests green (verified experimentally in this review, then fully reverted), so a future "per image" refactor would silently drop a second transient-failing candidate's 3 tries. The strict-mode budget-exhaustion rethrow is likewise exercised but not separately asserted for a transient error. Code is correct on inspection. | plugins/generations/image-gen/src/index.ts:475 | DEFER(one-test follow-up: two transient-failing candidates each called 3x; strict-mode exhaustion rethrows the original error object) |
| 2 | P4 (advisory) | usability | Same-provider retries are silent — no per-retry WARN/echo; the retry history is observable only in the final `metadata.attempts` and the eventual fallback WARN. Fine per R5, noted for operators watching a long daily run. | plugins/generations/image-gen/src/index.ts:448 | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `plugins/generations/image-gen/src/providers/errors.ts:99` `isTransientRetry` = transient+quota only; retry branch `src/index.ts:448`; AC1 (500), AC2 (429), AC4 (auth/policy never retried) in `tests/transient-retry.test.ts:151-249`; classifier `errors.ts:69` unchanged from 0164 (diff adds only the new leaf fn) |
| R2 | MET | `TRANSIENT_RETRY_MAX = 2` + backoff `[1000, 2000]` at `src/index.ts:53-54`; AC3 asserts `hf.requests` length 3 and `sleeps === [1000, 2000]` (`tests/transient-retry.test.ts:201-202`) |
| R3 | MET | Strict rethrow `src/index.ts:455` (`throw err`, original object — `tests/fallback.test.ts:145-161` AC1 `toBe(boom)` unchanged); fallback advance + all-candidates-failed message shape re-pinned honestly in `tests/fallback.test.ts:206-247` |
| R4 | MET | No stage/workflow change; `apps/cli/tests/kk-workflow-stages.test.ts:1611` (0219 AC2) still asserts the resume line (`xhs render: card 01 failed` / `re-run daily-xhs-render to resume`) and that no `cards.json`/`content.json` is written |
| R5 | MET | Retry branch records every failed try `src/index.ts:449`; AC3 asserts all 3 attempts (`tests/transient-retry.test.ts:206-220`) and fallback R3/AC4 pin the quota retries (`tests/fallback.test.ts:214-247`) |

**Next:** Close the deferred P3 with a one-test follow-up (two transient-failing candidates each called 3x) at the next touch of this plugin.

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-10-13T18:05:21.732Z todo → wip (system)
- 2026-10-13T18:26:54.600Z wip → testing (system)
- 2026-10-13T18:26:57.462Z testing → done (system)

