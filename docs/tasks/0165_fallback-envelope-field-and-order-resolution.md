---
schema_version: 1
name: fallback envelope field and order resolution
status: backlog
template: feature-impl
created_at: 2026-09-25T18:06:10.765Z
updated_at: "2026-09-25T18:48:19.050Z"
feature_id: D6

dependencies: ["0164"]
---

## 0165. fallback envelope field and order resolution

### Background

Today `selectProvider(requested?)` (`src/providers/types.ts`) picks exactly one provider. An explicit or `IMAGE_GEN_PROVIDER` request that is unknown or unconfigured throws, and otherwise the first configured provider in `AUTO_ORDER` (minus `NEVER_AUTO`) wins. D6 adds an opt-in `fallback` field and a pure function that turns it into an ordered candidate list. The retry loop (0166) consumes the list. `ImageJobSpecSchema` is a `z.strictObject`, so today an envelope carrying `fallback` fails to parse, and the field must be added to the schema.

### Requirements

- [ ] (supports R1–R3) `ImageJobSpecSchema` gains `fallback?: true | string[]`, where the list is non-empty and holds non-empty strings. Absent means strict. `false`, `[]`, and non-string entries fail parse, so "off" has one spelling (absent).
- [ ] R3. `resolveFallbackOrder(requested, fallback, { skipReason })` returns `{ order, skipped }`:
  - absent → `[requested]`
  - `true` → `requested` then `AUTO_ORDER` minus `NEVER_AUTO` minus `requested`
  - list → `requested` then the list in the given order, deduped, minus `requested`
  - An unknown name in the list throws `Unknown fallback provider '<x>'. Valid: …` before any provider call.
  - An explicitly listed `NEVER_AUTO` provider is allowed, because `NEVER_AUTO` governs automatic choice only.
  - Candidates (never `requested`) for which `skipReason(name)` returns a string are dropped and reported in `skipped`.
- [ ] R6. Selection is unchanged. `requested` is the name of the already-selected provider (explicit, `IMAGE_GEN_PROVIDER`, or auto), so an unknown or unconfigured requested provider still throws in `selectProvider` with today's message, and existing `selectProvider` tests pass unmodified.

### Acceptance Criteria

- [ ] AC1 — Explicit fallback list is honored in order (req: R3)
- [ ] AC2 — Explicit unknown or unconfigured provider still throws at selection (req: R6)

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: `docs/features/D6_image-gen-runtime-fallback.md` (R3, R6; supports R1–R2)
- Code: `plugins/generations/image-gen/src/job.ts` (`ImageJobSpecSchema`), `src/providers/types.ts` (`PROVIDERS`, `AUTO_ORDER`, `NEVER_AUTO`, `selectProvider`, `notConfiguredMessage`)
- Tests: `plugins/generations/image-gen/tests/` (`selectProvider` / job schema tests)
- Consumer: task 0166. Task 0164 is not needed here, so this task can be built in parallel with it.

### History
