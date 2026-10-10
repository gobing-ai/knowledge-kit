---
schema_version: 1
name: Harden daily XHS render against transient provider timeouts (vendor fallback opt-in)
status: done
template: feature-impl
created_at: 2026-10-07T22:09:47.119Z
updated_at: "2026-10-10T00:29:33.617Z"
feature_id: F61

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0219-verdict.json
---

## 0219. Harden daily XHS render against transient provider timeouts (vendor fallback opt-in)

### Background

During the 20261007 dogfood of `kk-daily-ai-voice`, the unattended `daily-xhs-render` stage failed on card-02 with a single transient provider error — `image-gen failed: The operation timed out.` (MiniMax image-01; `PROVIDER_REQUEST_TIMEOUT_MS` = 300s, `plugins/generations/image-gen/src/providers/timeouts.ts:14`) — and exited 1. `xhs-write` is `onError: continue`, so the run survived, but the XHS channel was lost until the operator hand-re-ran the render + publish stages (all four cards are now on disk under `.works/kk-daily-ai-voice/20261007/25-xhs/cards/`).

Root cause (verified 2026-10-07):
- `dailyXhsRender` (`plugins/kk/scripts/daily-stages.ts:1411`) takes no fallback argument, so its envelope never carries `imageGen.fallback`.
- In image-gen, `spec.fallback === undefined` re-throws the first provider error unwrapped (`plugins/generations/image-gen/src/index.ts:426-428`, D6 R1 strict fail-fast). The fallback loop `generateWithFallback` (`index.ts:393`) never moves past the primary. A timeout is already classified `transient` and is fallback-eligible (`providers/errors.ts:69-93`, covered by `tests/provider-errors.test.ts:19`, `tests/fallback.test.ts`).
- The cover stage already has the opt-in: `dailyCover` takes a trailing `fallback` arg (`daily-stages.ts:275-306`, D6 0166 R7). `''` means strict, `'true'` means AUTO_ORDER, anything else is a comma list. Both workflows thread it through `cover_fallback`.
- Each `kk executor run image-gen` call goes through `kk()` (`kk-workflow-stages.ts:551-568`), which exits with the child's status and adds no message. The stage's own output therefore never names the failed card or says how to resume.

Corrections to the original draft: the stage lives in `daily-stages.ts`, not `kk-workflow-stages.ts:1276`. The render call also exists in `kk-daily-ai-voice2.yaml:513`, which needs the same var. The stage tests live in `apps/cli/tests/kk-workflow-stages.test.ts` (fake `kk` on PATH), not `plugins/kk/tests/`.

### Requirements

- [x] R1. `kk stage daily-xhs-render` accepts an optional 8th arg `fallback` with the cover stage's exact semantics: `''`/absent → no `fallback` key in the envelope (strict); `'true'` → `fallback: true`; otherwise a comma-split, trimmed, empty-dropped provider list. The parsing is shared with `dailyCover` through one helper, not duplicated.
- [x] R2. Keep the sequential, stop-on-first-failure render loop. Rendered cards are resume-safe and never re-billed. When a card's `image-gen` call fails, the stage fails with a named message: `xhs render: card <NN> failed (image-gen exit <S>); cards before it are kept — re-run daily-xhs-render to resume from card <NN>`, and exits with the child's status.
- [x] R3. Both `kk-daily-ai-voice.yaml` and `kk-daily-ai-voice2.yaml` get an `xhs_fallback` var, shipped as `"true"`, with a comment that `""` restores strict fail-fast. Both pass `"${vars.xhs_fallback}"` as the last arg of the `daily-xhs-render` call.
- [x] R4. Docs in the same commit (T3): update the `docs/04_DESIGN.md` "Daily XHS card stages" row (signature gains `<fallback>`, plus semantics and default) and the `docs/design/kk-daily-ai-voice.md` §7 `xhs-write` bullet (the `xhs_fallback` var and the named-card resume failure).

### Acceptance Criteria

- [x] **AC1**. In the `apps/cli/tests/kk-workflow-stages.test.ts` `fakeXhsKk` harness, `daily-xhs-render … minimax image-01 true` writes every `card-NN.in.json` with `metadata.imageGen.fallback === true`. With `'google, openai'` it writes `["google","openai"]`. With `''`, or no 8th arg, it writes no `fallback` key, and the existing two xhs-render tests stay green unchanged.
- [x] **AC2**. With `fakeXhsKk(..., exitCode = 7)`, the stage exits 7, stderr contains `xhs render: card 01 failed` and `re-run daily-xhs-render to resume`, and no `cards.json`/`content.json` is written.
- [x] **AC3**. `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts` pins `xhs_fallback: "true"` and the 8-arg render call line (updates the assertion at :174). `apps/cli/tests/voice2-dag.test.ts` gains an assertion (it already loads the YAML as `WORKFLOW`, :48) that voice2 pins `xhs_fallback: "true"` and the same 8-arg render line.
- [x] **AC4**. `dailyCover` behavior is unchanged after the helper extraction: the existing cover tests stay green unchanged.
- [x] **AC5**. `bun run lint` and `bun run test` pass. The image-gen fallback suite (`plugins/generations/image-gen/tests/fallback.test.ts`) stays green and is the evidence that a timed-out primary falls back.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-08T05:38:02.355Z

- **Q: Should the stage continue past a failed card to attempt the rest (original R2)?** Decided **no**: keep stop-on-first-failure. (1) It is the documented design: "the first failure stops the spend — later cards stay unrendered for a resume run" (`daily-stages.ts:1453-1456`). (2) Resume is free, because a card whose artifact is on disk is never re-rendered or re-billed. (3) With fallback on, a card that still fails has exhausted every available vendor, which means a systemic outage. Pushing on would burn up to 300s × vendors on every remaining card. (4) A partial series cannot be packaged: `xhs-pub` would publish a broken cover→content→closing sequence. The real gap was diagnosability, and new R2 fixes it with a named card and a resume hint.
- **Q: What should `xhs_fallback` ship as, given `cover_fallback` ships `""`?** Decided **`"true"`**. XHS is a draft-only (`xhs_live: "false"`), non-blocking channel whose unattended failure is exactly what this task fixes. Card copy is typeset by image-gen's composer, so the dominant visual layer does not depend on the vendor; only the text-free illustration layer drifts. The cover is the episode's single branded image (F614 pinned look), so it stays strict. Operators who want strict XHS set `xhs_fallback=""`.
- **Q: Mixed-vendor series?** Accepted. The fallback index is sticky only within one image-gen call, and each card is its own call, so one card can fall to vendor B while the others stay on MiniMax. The result is a draft the operator reviews before any live post (ADR-022). Making the fallback sticky across cards is deferred until a live post shows the mismatch matters.
- **Q: Retry the same provider once instead of falling back to another vendor?** Deferred. `resolveFallbackOrder` dedupes the requested provider, so the fallback list cannot express it, and adding retry-in-place inside image-gen changes every image-gen caller. Revisit if MiniMax timeouts turn out to be frequent and vendor drift becomes a complaint.
- **Q: Where does fallback-chain behavior get tested?** In image-gen (`tests/fallback.test.ts`, `tests/provider-errors.test.ts`), which owns it. The stage tests prove only the envelope contract and the failure message, because a fake `kk` cannot exercise a provider chain.

### Design

- **Shared parser.** Lift the inline ternary in `dailyCover` (`daily-stages.ts:296-304`) into a module-local `function imageGenFallback(arg: string): true | string[] | undefined` in `daily-stages.ts`: `''` → `undefined`, `'true'` → `true`, otherwise split, trim and filter. Keep the D6 0166 R7 comment on the helper. Both stages write `if (fb !== undefined) imageGen.fallback = fb;`. Unknown provider names are still rejected by image-gen (`resolveFallbackOrder`), not here.
- **Arg position.** Append `fallback` as the 8th positional arg, after `model`. Existing 7-arg callers (tests, hand-tail runbooks) keep strict behavior, because `''` is the default.
- **Named failure.** In the render loop, call `kk([...], { soft: true })`. When the status is non-zero, `failWith(status, \`xhs render: card ${card.index} failed (image-gen exit ${status}); cards before it are kept — re-run daily-xhs-render to resume from card ${card.index}\`)`. A launch failure (127) still fails inside `kk()` through `failWith(127)`. Update the "Sequential on purpose" comment to point at the resume message.
- **Invariants.** Format, style, provider and model stay stage-pinned. Cards on disk are never re-rendered. No packaging happens unless every card rendered. The strict path is byte-identical when `fallback` is `''`.
- **Impacted surfaces.** `plugins/kk/scripts/daily-stages.ts`; `plugins/kk/workflows/kk-daily-ai-voice.yaml` (vars ~L68-71, render call L474); `plugins/kk/workflows/kk-daily-ai-voice2.yaml` (vars ~L40-42, render call L513); `docs/04_DESIGN.md:1037`; `docs/design/kk-daily-ai-voice.md` §7 (~L165-169); the tests named in AC. The stage dispatcher (`kk-workflow-stages.ts:1587`) already forwards `rest`, so no change is needed there.

### Plan

1. Tests first (they fail before the change): in `apps/cli/tests/kk-workflow-stages.test.ts`, add one table test over the 8th arg (`true` / `'google, openai'` / `''` / absent) that reads each `card-NN.in.json`, plus one test with `exitCode` 7 asserting the named message and that nothing was packaged (AC1, AC2). Update the YAML assertions in `kk-daily-ai-voice-workflow.test.ts:174` and voice2's equivalent (AC3).
2. `daily-stages.ts`: extract `imageGenFallback`, switch `dailyCover` to it, and add the `fallback` destructure plus envelope key and the soft `kk` call with the named failure to `dailyXhsRender`.
3. Both YAMLs: add the `xhs_fallback: "true"` var with a one-line comment, and append `"${vars.xhs_fallback}"` to the render call.
4. Docs: `docs/04_DESIGN.md:1037` row and design §7 bullet.
5. `bun run lint && bun run test`, then `git diff --stat` to confirm only the files listed above changed.

### Solution

- `plugins/kk/scripts/daily-stages.ts:267,1418`:
  - Extracted a module-local `imageFallback(fallback: string): true | string[]` helper (0219 R1); re-verify 2026-10-08 moved it above the dailyCover doc block (it had split JSDoc from dailyCover) and dropped the unused export.
  - Added 8th `fallback = ''` arg to `dailyXhsRender`, setting `imageGen.fallback = imageFallback(fallback)` when non-empty.
  - Wrapped `kk(..., { soft: true })` in card render loop; on non-zero exit, invokes `failWith(status, \`xhs render: card ${card.index} failed (image-gen exit ${status}); cards before it are kept — re-run daily-xhs-render to resume from card ${card.index}\`)` (0219 R2).
- `plugins/kk/workflows/kk-daily-ai-voice.yaml` & `kk-daily-ai-voice2.yaml`:
  - Added `xhs_fallback: "true"` var with explanatory comment.
  - Passed `"${vars.xhs_fallback}"` as 8th argument to `daily-xhs-render` (0219 R3).
- `apps/cli/tests/kk-workflow-stages.test.ts`:
  - Added unit test asserting 8th arg fallback envelope values (`true`, string array, undefined on `''`/absent) (0219 AC1).
  - Added unit test asserting named failure message on exit code 7 with resume hint (0219 AC2).
- `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts` & `apps/cli/tests/voice2-dag.test.ts`:
  - Added assertions for `xhs_fallback: "true"` and 8-arg render invocation (0219 AC3).
- `docs/04_DESIGN.md` & `docs/design/kk-daily-ai-voice.md`:
  - Updated design specs and tables with `<fallback>` argument and resume semantics (0219 R4).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/scripts/daily-stages.ts:267` shared `imageFallback` parse; used by the cover stage at `plugins/kk/scripts/daily-stages.ts:312` and the XHS render at `plugins/kk/scripts/daily-stages.ts:1465` ('' leaves no key). Tested by `apps/cli/tests/kk-workflow-stages.test.ts:1230-1252`. |
| R2 | MET | `plugins/kk/scripts/daily-stages.ts:1475-1485` soft kk call, then failWith(status) names the card and the resume hint; the sequential stop-on-first-failure loop is kept. Tested by `apps/cli/tests/kk-workflow-stages.test.ts:1254-1266` (exit 7, named message, nothing packaged). |
| R3 | MET | `plugins/kk/workflows/kk-daily-ai-voice.yaml:56` and `plugins/kk/workflows/kk-daily-ai-voice2.yaml:39` ship xhs_fallback "true" with the strict-restore comment; 8-arg render calls at `plugins/kk/workflows/kk-daily-ai-voice.yaml:476` and `plugins/kk/workflows/kk-daily-ai-voice2.yaml:520`. |
| R4 | MET | `docs/04_DESIGN.md:1042` row gains `<fallback>` with semantics and default; `docs/design/kk-daily-ai-voice.md:170-175` §7 bullet names xhs_fallback and the named-card resume failure; both landed in commit 0edcabb1 with the code (T3). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `apps/cli/tests/kk-workflow-stages.test.ts:1230-1252` asserts true, ['google','openai'], and no key for '' and absent; the pre-existing xhs-render tests in the same file pass unchanged (focused run 169 pass / 0 fail). |
| AC2 | MET | test | `apps/cli/tests/kk-workflow-stages.test.ts:1254-1266` asserts exit 7, stderr `xhs render: card 01 failed` and `re-run daily-xhs-render to resume`, and no cards.json/content.json. |
| AC3 | MET | test | `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:174-177` pins the 8-arg line and xhs_fallback "true"; `apps/cli/tests/voice2-dag.test.ts:433-438` pins the same for voice2. |
| AC4 | MET | test | `apps/cli/tests/kk-workflow-stages.test.ts:1816-1835` daily-cover fallback test (absent / true / comma list) passes unchanged after the helper extraction and this run's helper relocation. |
| AC5 | MET | command | `bun run gate` exit 0 this run: format + build + lint + rules + tests, 2210 pass / 2 skip (pre-existing Chromium E2E self-skip) / 0 fail, lines 98.63%; `plugins/generations/image-gen/tests/fallback.test.ts:168-193` (fallback true retries down AUTO_ORDER) green, timeout classed transient per `plugins/generations/image-gen/tests/provider-errors.test.ts:19`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Feature F61 (daily AI voice destination); E8 / F615 (XHS card target); D6 tasks 0164-0166 (image-gen runtime fallback); F614 (cover pin).
- Code: `plugins/kk/scripts/daily-stages.ts:287` (dailyCover), `:1418` (dailyXhsRender); `plugins/generations/image-gen/src/index.ts:393-450`; `providers/types.ts:347` (resolveFallbackOrder); `providers/errors.ts`.
- Evidence: `.works/kk-daily-ai-voice/20261007/25-xhs/`.
- Sibling: task 0220 (same dogfood, publish-completeness ordering).

### History

- 2026-10-08T05:38:17.632Z backlog → todo (system)
- 2026-10-08T20:06:32.325Z todo → done (system)

