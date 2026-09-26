---
schema_version: 1
name: runJob fallback retry loop with daily-cover opt-in
status: done
template: feature-impl
created_at: 2026-09-25T18:06:11.062Z
updated_at: "2026-09-26T00:15:47.721Z"
feature_id: D6

dependencies: ["0164", "0165", "0169"]
---

## 0166. runJob fallback retry loop with daily-cover opt-in

### Background

The task title says `runJob`, but no such function exists. The paid loop is `processGeneratorIO` in `plugins/generations/image-gen/src/index.ts`. It selects one provider through the `ProviderResolver` seam, then for each prompt calls `provider.validate?.(request)` and `provider.generate(request)`, writes the bytes, and records an `ImageArtifact`. Any throw deletes `--out` and every artifact written in the run.

This task wraps only the `validate` + `generate` calls in the D6 fallback loop, using the 0164 classifier and the 0165 order. It also wires the `daily-cover` opt-in. The `daily-cover` stage (`plugins/kk/scripts/kk-workflow-stages.ts` `dailyCover`) pins provider `minimax` and model `image-01` (F614), and the look depends on both, so the opt-in defaults to absent.

### Requirements

- [x] R1. When `spec.fallback` is absent, behavior is byte-identical to today: one provider, and the original error propagates unwrapped. Existing adapter/image-gen tests pass unmodified.
- [x] R2. When `validate` or `generate` fails with a fallback-eligible class and a next candidate exists, write `WARN image-gen: <provider> failed (<class>): <message>; falling back to <next>` to stderr (`echoError`) **before** calling the next provider. The next attempt uses `candidate.defaultModel()`, because `spec.model` applies only to the requested provider. The winning provider/model land in `images[i].provider` / `.model` (existing fields). Every failed attempt is appended to the new `ImageGenMetadata.attempts?: ProviderAttempt[]` (`{ image, provider, model, errorClass, message }`), which is present only when non-empty.
- [x] R4. A `policy` failure throws `image-gen: <provider> rejected the prompt (policy): <message>; fallback does not apply`, and no further provider is called.
- [x] R5. An exhausted order throws `image-gen: all providers failed for image <n>: <p1> (<class>), <p2> (<class>), …` followed by the last message.
- [x] R7. `kk stage daily-cover` takes a 6th positional `<fallback>`: `''` means no field, `true` means `fallback: true`, and anything else is a comma-split, trimmed list. `kk-daily-ai-voice.yaml` adds `cover_fallback: ""` and passes `"${vars.cover_fallback}"`.
- [x] (supports R2–R5) The order is resolved once, before the dry-run branch, with `skipReason` = not `isAvailable()` → `not configured`, or reference images present and not `supportsReferenceImages(defaultModel())` → `no reference-image support`. Each skip is WARN-logged once, and config errors (unknown names) fail with no spend. Multi-image jobs advance stickily: when image k fails on provider i, image k retries on i+1 and later images stay on i+1. Images already written are kept. Anchor, write, and cap errors are never classified or retried. Failed attempts do not count against `maxImages`, which caps produced images.
- [x] (T3) Same commit: add a `docs/04_DESIGN.md` §6 row for the image-gen `fallback` field and `metadata.attempts`, update the daily-cover row (line ~650) to 6 args, and add `cover_fallback` to `docs/design/kk-daily-ai-voice.md`.

### Acceptance Criteria

- [x] AC1 — No fallback field keeps today's strict failure (req: R1)
- [x] AC2 — fallback true retries down AUTO_ORDER after a loud log (req: R2)
- [x] AC3 — Content-policy rejections never fall back (req: R4)
- [x] AC4 — Exhausted fallback order fails loudly (req: R5)
- [x] AC5 — Daily cover opts into fallback through a workflow var (req: R7)

### Q&A

- **Seam (closed 2026-09-25).** `ProviderResolver` stays `(spec) => ImageProvider` and still picks the primary, so all existing `() => stub` tests keep working. Add `options.createProvider?: (name: string) => ImageProvider` (default `PROVIDERS[name].create()`) to build fallback candidates. `requested` = `primary.name`. Tests inject both, and the stubs' `isAvailable` / `supportsReferenceImages` drive `skipReason`. Candidates are created once and cached in a `Map`.
- **Model per attempt (closed).** Only the requested provider receives `spec.model`. Sending minimax's `image-01` to google would fail as `unknown` and burn the order.
- **Multi-image policy (closed).** Advance is sticky, with no return to a failed provider and no restart of earlier images. A cover/free job is one image, so this matters only for illustration jobs. Mixed providers in one illustration set are visible per image in `images[].provider`.
- **Dry run (closed).** It resolves and validates the order, so typos fail with no spend. It does not report the order in metadata (YAGNI). Add it when an operator needs to preview it.
- **Naming (note).** `dailyCover` already logs `cover brief: fallback (…)` for the subject fallback. The new WARN lines start with `WARN image-gen:`, so the two are distinguishable in logs.
- **Cost (note).** A failed paid call may still be billed by some vendors. This is why R2 logs before the hop and why the default is absent.

### Design

In `processGeneratorIO`, after the cap check:

```ts
const primary = resolveProvider(spec);
const create = cached(options.createProvider ?? ((n) => PROVIDERS[n]!.create()));  // Map-backed
const { order, skipped } = resolveFallbackOrder(primary.name, spec.fallback, { skipReason });
for (const s of skipped) echoError(`WARN image-gen: skipping fallback ${s.provider} (${s.reason})`);
// dry-run branch unchanged
let at = 0;                       // sticky index into order
for (const [index, prompt] of prompts.entries()) {
    const result = await generateWithFallback(index);   // loops order from `at`; see rules below
    ... existing anchor/write/artifact code unchanged ...
}
```

`generateWithFallback` rules:
- provider = `at === 0 ? primary : create(order[at])`
- model = `at === 0 ? (spec.model ?? p.defaultModel()) : p.defaultModel()`
- On a throw with `spec.fallback === undefined`, rethrow the original error (R1).
- If the class is `policy`, throw the R4 message.
- Otherwise push an attempt. If `at + 1 < order.length`, WARN and set `at++`; else throw the R5 message.

Metadata adds `...(attempts.length > 0 ? { attempts } : {})`. `ProviderAttempt` and the `attempts?` field go in `src/job.ts` beside `ImageGenMetadata`.

`dailyCover` gets `const [..., model = '', fallback = ''] = args;` and `if (fallback !== '') imageGen.fallback = fallback === 'true' ? true : fallback.split(',').map((s) => s.trim()).filter(Boolean);`. Unknown names are rejected by image-gen, not by the stage.

Rejected: changing `ProviderResolver` to name-based (it breaks every existing test's primary injection), and a same-provider retry/backoff (out of D6 scope).

### Plan

1. `job.ts`: add `ProviderAttempt` and `ImageGenMetadata.attempts?`.
2. `index.ts`: add the `createProvider` option, resolve the order before the dry run, WARN on skips, and add the `generateWithFallback` loop as designed.
3. Tests in `tests/adapter.test.ts` (or a new `tests/fallback.test.ts`), using stubs keyed by name that throw real 0164 fixture strings. Capture stderr with `setDefaultOutputTargets`. Cases:
   - (R1) absent + auth error → the same Error instance is rethrown and the second stub is never called
   - (R2) `true` → the WARN line is written before stub 2 is called, stub 2 receives its own default model, and `attempts[0]` is recorded
   - (R3) list order → exact call sequence
   - (R4) policy → one call, and the message contains `(policy)`
   - (R5) all fail → the message lists every provider and class, and `--out` is removed
   - skip → an unconfigured candidate is WARNed and never called
   - references → a no-ref candidate is skipped
   - illustration, 2 images, image 2 fails → image 1 is kept and image 2 is on the fallback provider
   - dry run with an unknown fallback name → throws with no stub call
4. `daily-cover`: extend `apps/cli/tests/kk-workflow-stages.test.ts` (the ~l.946 helper) for `''` / `true` / `google, zai` → the envelope field. Update the exact command strings in `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts` (l.138, l.209) and assert `cover_fallback: ""`.
5. Docs (T3), same commit: a 04_DESIGN §6 row, the daily-cover row, and `docs/design/kk-daily-ai-voice.md`.
6. `bun run gate`. Record the output of one dry-run `kk executor run image-gen` with `fallback: ["google"]` in Testing. A paid dogfood with a deliberately invalid primary key needs operator approval.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:140` |
| `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:211` |
| `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:81` |
| `apps/cli/tests/kk-workflow-stages.test.ts:941` |
| `apps/cli/tests/kk-workflow-stages.test.ts:947` |
| `apps/cli/tests/kk-workflow-stages.test.ts:993` |
| `plugins/generations/image-gen/src/index.ts:12` |
| `plugins/generations/image-gen/src/index.ts:18` |
| `plugins/generations/image-gen/src/index.ts:191` |
| `plugins/generations/image-gen/src/index.ts:234` |
| `plugins/generations/image-gen/src/index.ts:294` |
| `plugins/generations/image-gen/src/index.ts:302` |
| `plugins/generations/image-gen/src/index.ts:355` |
| `plugins/generations/image-gen/src/index.ts:407` |
| `plugins/generations/image-gen/src/index.ts:57` |
| `plugins/generations/image-gen/src/job.ts:120` |
| `plugins/generations/image-gen/src/job.ts:29` |
| `plugins/generations/image-gen/src/job.ts:3` |
| `plugins/generations/image-gen/src/job.ts:56` |
| `plugins/generations/image-gen/src/job.ts:93` |
| `plugins/generations/image-gen/src/providers/types.ts:305` |
| `plugins/generations/image-gen/src/providers/types.ts:72` |
| `plugins/generations/image-gen/tests/job.test.ts:77` |
| `plugins/generations/image-gen/tests/providers.test.ts:10` |
| `plugins/generations/image-gen/tests/providers.test.ts:188` |
| `plugins/generations/image-gen/tests/providers.test.ts:4` |
| `plugins/kk/scripts/kk-workflow-stages.ts:910` |
| `plugins/kk/scripts/kk-workflow-stages.ts:931` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Strict rethrow of the original error: `plugins/generations/image-gen/src/index.ts:327-328`; absent `fallback` → single-entry order: `plugins/generations/image-gen/src/providers/types.ts:341-343`; test proves same Error instance, zero second-provider calls, silent stderr, `--out` removed: `plugins/generations/image-gen/tests/fallback.test.ts:142-163`; `adapter.test.ts`/`image-gen.test.ts` unmodified (not in `git status`) and all 356 image-gen tests pass unmodified |
| R2 | MET | WARN emitted before the hop: `plugins/generations/image-gen/src/index.ts:348`; candidate uses its own `defaultModel()` (`index.ts:312-314`); failed attempt pushed as `{image, provider, model, errorClass, message}` (`index.ts:338`, type `plugins/generations/image-gen/src/job.ts:98-112`), `attempts?` present only when non-empty (`job.ts:121`, `index.ts:407`); winner lands in `images[i].provider/.model` via `result.provider/model` (`index.ts:369-377`); test asserts WARN text precedes stub 2's call (onCall probe), candidate's own model, and `attempts[0]`: `plugins/generations/image-gen/tests/fallback.test.ts:165-190`; winning-provider assertion also at `fallback.test.ts:243-262`; AUTO_ORDER walk (`true`): `plugins/generations/image-gen/src/providers/types.ts:218-231,347` |
| R4 | MET | Non-eligible class (policy) throws the exact R4 message and no further provider is called: `plugins/generations/image-gen/src/index.ts:333-336`; classifier checks policy first (`plugins/generations/image-gen/src/providers/errors.ts:88-96`, `isFallbackEligible` at `errors.ts:101-103`); test: one stub call, zero google calls, exact message, `--out` removed: `plugins/generations/image-gen/tests/fallback.test.ts:215-226` |
| R5 | MET | Exhausted order throws `image-gen: all providers failed for image <n>: <p> (<class>), …; <last message>` built from this image's attempt slice: `plugins/generations/image-gen/src/index.ts:339-347`; test pre-seeds a stale `--out` and asserts the exact message plus deletion: `plugins/generations/image-gen/tests/fallback.test.ts:228-241` |
| R7 | MET | 6th positional `<fallback>`: `plugins/kk/scripts/kk-workflow-stages.ts:910`; `''`→no field / `true`→`fallback: true` / else comma-split, trimmed list: `kk-workflow-stages.ts:931-941`; workflow var `cover_fallback: ""` and pass-through arg: `plugins/kk/workflows/kk-daily-ai-voice.yaml:44,196`; stage test asserts envelopes `undefined`/`true`/`['google','zai']`: `apps/cli/tests/kk-workflow-stages.test.ts:993-1014`; exact command strings + `cover_fallback: ""`: `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:82,140,211` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — No fallback field keeps today's strict failure (req: R1) | MET | test | `plugins/generations/image-gen/tests/fallback.test.ts:142` — original Error instance rethrown (`expect(caught).toBe(boom)`), second stub never called, empty stderr, `--out` deleted; 9/9 pass this run |
| AC2 — fallback true retries down AUTO_ORDER after a loud log (req: R2) | MET | test | `plugins/generations/image-gen/tests/fallback.test.ts:165` — WARN `falling back to google` captured before stub 2's `onCall`, candidate sends own default model, `metadata.attempts[0]` recorded; AUTO_ORDER minus NEVER_AUTO filter at `plugins/generations/image-gen/src/providers/types.ts:347` |
| AC3 — Content-policy rejections never fall back (req: R4) | MET | test | `plugins/generations/image-gen/tests/fallback.test.ts:215` — rejects with `(policy)` message; `google.requests` length 0; `--out` removed |
| AC4 — Exhausted fallback order fails loudly (req: R5) | MET | test | `plugins/generations/image-gen/tests/fallback.test.ts:228` — exact `all providers failed for image 1: minimax (auth), google (quota); <msg>`; both stubs called once; `--out` removed |
| AC5 — Daily cover opts into fallback through a workflow var (req: R7) | MET | test | `apps/cli/tests/kk-workflow-stages.test.ts:993` — `''`/`true`/`'google, zai'` map to `undefined`/`true`/`['google','zai']` on the built envelope; `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:82,140,211` — var ships `""` and reaches the stage command |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:c8597aa0cea650bc2dfd9eb89f7b508ef6d080cc3d14a4435c36efa43395f30d |

### References

- Feature: `docs/features/D6_image-gen-runtime-fallback.md` (R1, R2, R4, R5, R7)
- Depends on: 0164 (`classifyProviderError`, `isFallbackEligible`), 0165 (`fallback` schema, `resolveFallbackOrder`)
- Code: `plugins/generations/image-gen/src/index.ts` (`processGeneratorIO`, `ProviderResolver`, `defaultProviderResolver`), `src/job.ts` (`ImageGenMetadata`), `src/providers/types.ts`
- Stage: `plugins/kk/scripts/kk-workflow-stages.ts` (`dailyCover`), `plugins/kk/workflows/kk-daily-ai-voice.yaml` (vars `cover_provider` / `cover_model`, cover state)
- Tests: `plugins/generations/image-gen/tests/adapter.test.ts`, `tests/image-gen.test.ts`, `apps/cli/tests/kk-workflow-stages.test.ts`, `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts`
- Docs: `docs/04_DESIGN.md` §6 (daily-cover row), `docs/design/kk-daily-ai-voice.md`; F614 (pinned-look rationale)

### History

- 2026-09-25T20:37:42.148Z backlog → todo (system)
- 2026-09-25T23:49:13.650Z todo → wip (system)
- 2026-09-26T00:15:42.304Z wip → testing (system)
- 2026-09-26T00:15:47.721Z testing → done (system)

