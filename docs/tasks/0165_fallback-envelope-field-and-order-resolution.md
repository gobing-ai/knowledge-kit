---
schema_version: 1
name: fallback envelope field and order resolution
status: done
template: feature-impl
created_at: 2026-09-25T18:06:10.765Z
updated_at: "2026-09-25T23:27:02.616Z"
feature_id: D6

dependencies: []
---

## 0165. fallback envelope field and order resolution

### Background

Today `selectProvider(requested?)` (`src/providers/types.ts`) picks exactly one provider. An explicit or `IMAGE_GEN_PROVIDER` request that is unknown or unconfigured throws, and otherwise the first configured provider in `AUTO_ORDER` (minus `NEVER_AUTO`) wins. D6 adds an opt-in `fallback` field and a pure function that turns it into an ordered candidate list. The retry loop (0166) consumes the list. `ImageJobSpecSchema` is a `z.strictObject`, so today an envelope carrying `fallback` fails to parse, and the field must be added to the schema.

### Requirements

- [x] (supports R1–R3) `ImageJobSpecSchema` gains `fallback?: true | string[]`, where the list is non-empty and holds non-empty strings. Absent means strict. `false`, `[]`, and non-string entries fail parse, so "off" has one spelling (absent).
- [x] R3. `resolveFallbackOrder(requested, fallback, { skipReason })` returns `{ order, skipped }`:
  - absent → `[requested]`
  - `true` → `requested` then `AUTO_ORDER` minus `NEVER_AUTO` minus `requested`
  - list → `requested` then the list in the given order, deduped, minus `requested`
  - An unknown name in the list throws `Unknown fallback provider '<x>'. Valid: …` before any provider call.
  - An explicitly listed `NEVER_AUTO` provider is allowed, because `NEVER_AUTO` governs automatic choice only.
  - Candidates (never `requested`) for which `skipReason(name)` returns a string are dropped and reported in `skipped`.
- [x] R6. Selection is unchanged. `requested` is the name of the already-selected provider (explicit, `IMAGE_GEN_PROVIDER`, or auto), so an unknown or unconfigured requested provider still throws in `selectProvider` with today's message, and existing `selectProvider` tests pass unmodified.

### Acceptance Criteria

- [x] AC1 — Explicit fallback list is honored in order (req: R3)
- [x] AC2 — Explicit unknown or unconfigured provider still throws at selection (req: R6)

### Q&A

- **Unconfigured candidates are skipped, not fatal (closed 2026-09-25; operator may override).** A fallback entry without its env key must not fail a healthy primary run before it starts. 0166 WARN-logs the skip once, before the first call. An unknown name is a typo, and it throws.
- **Reference-image jobs (closed).** When `spec.referenceImages` is non-empty, 0166's `skipReason` also drops candidates whose `supportsReferenceImages(defaultModel())` is false. Otherwise the fallback would silently lose the references.
- **Starting point (closed).** The order always starts with the selected provider, which may have been auto-selected. With `fallback: true` and auto-selection, the rest of `AUTO_ORDER` after removing that provider follows.
- **Where validation lives (closed).** Name validation happens in `resolveFallbackOrder`, not in the zod schema: `job.ts` must not import the `PROVIDERS` registry, which pulls in every adapter.

### Design

- `src/job.ts`: in `ImageJobSpecSchema`, add `fallback: z.union([z.literal(true), z.array(z.string().min(1)).min(1)]).optional()` with a doc comment. The `ImageJobSpec` type follows.
- `src/providers/types.ts`, next to `selectProvider`:

```ts
export type FallbackSpec = true | readonly string[] | undefined;
export interface FallbackOrder {
    order: string[];                                  // order[0] === requested
    skipped: { provider: string; reason: string }[];
}
export function resolveFallbackOrder(
    requested: string,
    fallback: FallbackSpec,
    options?: { skipReason?: (name: string) => string | undefined },
): FallbackOrder;
```

The function stays pure: availability and reference support come in through `skipReason`, which 0166 builds from provider instances. Invariant: `order` is non-empty, has no duplicates, and starts with `requested`.

### Plan

1. Schema: add `fallback` to `ImageJobSpecSchema`. Tests: `true`, `['google','zai']`, and absent parse; `false`, `[]`, `[1]`, and `['']` are rejected.
2. Add `resolveFallbackOrder` and a table test. Cases:
   - absent → `[requested]`
   - `true` excludes `codex-cli` and `requested` and keeps `AUTO_ORDER` order
   - a list keeps its order, dedupes, and drops `requested`
   - an unknown list name throws naming it and the valid set
   - an explicit `codex-cli` is kept
   - `skipReason` drops a candidate into `skipped`, never `requested`
3. Leave `selectProvider` and its tests unchanged (R6 evidence: the existing tests stay green).
4. `bun run gate`. The surface doc is written in 0166 (T3: the field ships with the loop that honors it).

### Solution

Fallback envelope field + pure order resolution, exactly the frozen Design; selection untouched (R6 evidence: the 11 existing `selectProvider` tests pass unmodified). 0166 consumes `{ order, skipped }`.

- `plugins/generations/image-gen/src/job.ts:28-34` — `ImageJobSpec` gains `fallback?: true | string[]` with the strict-vs-AUTO_ORDER-vs-explicit-list doc note and the pointer to name validation in `resolveFallbackOrder` (this file must not import the provider registry, per closed Q&A).
- `plugins/generations/image-gen/src/job.ts:55-56` — `ImageJobSpecSchema` gains `fallback: z.union([z.literal(true), z.array(z.string().min(1)).min(1)]).optional()`: shape only. `false`/`[]`/non-string/`''` entries fail parse so "off" has the single spelling (absent).
- `plugins/generations/image-gen/src/providers/types.ts:313-320` — `FallbackSpec` (`true | readonly string[] | undefined`) + `FallbackOrder` (`order` with the non-empty/deduped/`order[0] === requested` invariant; `skipped` as `{ provider, reason }[]`), placed after `selectProvider` per the Design.
- `plugins/generations/image-gen/src/providers/types.ts:321-375` — `resolveFallbackOrder(requested, fallback, { skipReason })`: absent → `[requested]`; `true` → requested then AUTO_ORDER minus NEVER_AUTO minus requested in AUTO_ORDER order; list → requested then the list in order, deduped (first occurrence) and minus requested. Unknown list name throws `Unknown fallback provider '<x>'. Valid providers: …` (mirrors `selectProvider`'s unknown-name convention) on the walk, before any `skipReason` call; explicitly listed NEVER_AUTO names are kept (it governs auto-choice only); `skipReason` is consulted for candidates only — never `requested` — so the order always starts with the already-selected provider and stays non-empty.
- `plugins/generations/image-gen/tests/job.test.ts:77-103` — schema table: `true`, `['google','zai']`, absent parse; `false`, `[]`, `[1]`, `['']` rejected (Plan step 1).
- `plugins/generations/image-gen/tests/providers.test.ts:188-280` — `resolveFallbackOrder` table (Plan step 2): absent → `[requested]`; `true` excludes `codex-cli`/requested and keeps AUTO_ORDER order; explicit list honored in order (AC1) with dedupe + requested-drop; unknown name throws naming it and the valid set; explicit `codex-cli` kept; `skipReason` drops candidates into `skipped` in walk order, never `requested`; all-candidates-skilled still yields `[requested]` (R5 exhaustion input for 0166). Plan step 3 applied as-is: `selectProvider` and its tests are byte-untouched (AC2 evidence).

Rationale: pure function with availability injected via `skipReason` keeps `types.ts` import-cycle-free (0166 builds it from provider instances); the surface doc row is deferred to 0166 per Plan step 4 (T3: field ships with the loop that honors it).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Req1 — `fallback?: true | string[]` on the envelope; non-empty list of non-empty strings; absent = strict; `false`/`[]`/non-string/`''` fail parse | MET | Type: `src/job.ts:34`; zod shape `z.union([z.literal(true), z.array(z.string().min(1)).min(1)]).optional()`: `src/job.ts:55-56`; table `tests/job.test.ts:78-102` — `true` (78), `['google','zai']` (82-84), absent (87-88), `false` (91-92), `[]` (95-96), `[1]`/`['']` (99-101) |
| Req2 (feature R3) — `resolveFallbackOrder` contract | MET | `src/providers/types.ts:336-375`: absent → `[requested]` (341-343; test 189-191); `true` → requested then AUTO_ORDER minus NEVER_AUTO minus requested in AUTO_ORDER order (346-347; expected 12-name list matches AUTO_ORDER at types.ts:218-231, test 193-210); list → requested-first, first-occurrence dedupe via `seen` Set seeded with requested, minus requested (348-361; test 219-222); unknown name throws `Unknown fallback provider '<x>'. Valid providers: …` (353-355; mirrors `selectProvider`'s convention at types.ts:284; test 224-231) before the `skipReason` walk, i.e. before any provider call; explicit NEVER_AUTO kept — the list branch never consults `NEVER_AUTO` (test 233-235); `skipReason` consulted for candidates only, never requested (363-371; tests 237-254, 257-268, 270-279) |
| Req3 (feature R6) — selection unchanged | MET | `git diff` vs base on `types.ts` is two purely-additive hunks (errors re-export 0164 scope; append after line 302) — `selectProvider` body (types.ts:259-304) byte-untouched; both test-file diffs are purely additive (zero removed lines); all existing `selectProvider` tests green in the 61-pass run |
| AC1 — explicit fallback list honored in order (R3) | MET | `tests/providers.test.ts:212-217` — "an explicit list is honored in exactly the given order (AC1)": `['google','zai']` → `['minimax','google','zai']` |
| AC2 — explicit unknown/unconfigured provider still throws at selection (R6) | MET | Unmodified throw tests pass: unknown name lists all 13 valid names (`tests/providers.test.ts:150-157`), known-but-unconfigured names provider + env (`165-168`); source untouched per additive-only diff |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | proof-input-digest | — | sha256:8aec71107ad7a2df4b1c866279e9bdda23cf16295b9285973b3353434a47e693 |

### References

- Feature: `docs/features/D6_image-gen-runtime-fallback.md` (R3, R6; supports R1–R2)
- Code: `plugins/generations/image-gen/src/job.ts` (`ImageJobSpecSchema`), `src/providers/types.ts` (`PROVIDERS`, `AUTO_ORDER`, `NEVER_AUTO`, `selectProvider`, `notConfiguredMessage`)
- Tests: `plugins/generations/image-gen/tests/` (`selectProvider` / job schema tests)
- Consumer: task 0166. Task 0164 is not needed here, so this task can be built in parallel with it.

### History

- 2026-09-25T20:37:40.394Z backlog → todo (system)
- 2026-09-25T23:12:45.416Z todo → wip (system)
- 2026-09-25T23:27:02.071Z wip → testing (system)
- 2026-09-25T23:27:02.616Z testing → done (system)

