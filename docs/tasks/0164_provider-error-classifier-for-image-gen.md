---
schema_version: 1
name: provider error classifier for image-gen
status: done
template: feature-impl
created_at: 2026-09-25T18:06:10.483Z
updated_at: "2026-09-25T23:05:49.567Z"
feature_id: D6

---

## 0164. provider error classifier for image-gen

### Background

D6 fallback needs a per-failure decision: fall back, or stop. The 13 image-gen providers throw plain `Error`s whose messages are inconsistent. Some carry a status (`seedream HTTP 401: …`, `MiniMax API error (429): …`, `Google API error (403): …`, `HuggingFace model loading (HTTP 503): …`). Some carry no status (`OpenAI API error: <body>`, `Azure OpenAI API error: <body>`). Missing keys throw `… requires ARK_API_KEY` / `MINIMAX_API_KEY is required`. Timeouts abort through `AbortSignal` (`PROVIDER_REQUEST_TIMEOUT_MS`, `src/providers/timeouts.ts`).

This task adds one pure classifier over those shapes. It changes no provider and no runtime behavior. Task 0166 consumes it.

### Requirements

- [x] R4. `classifyProviderError(err: unknown): ProviderErrorClass` returns `policy` for content-policy, safety, or moderation rejections. `isFallbackEligible(cls)` is `false` for `policy` only. Policy is checked first because such rejections often arrive as HTTP 400/403.
- [x] (supports R2, R5) The other classes follow the Design rule table in the order auth → quota → transient, and anything unmatched is `unknown`. Non-`Error` values classify as `unknown`, and the function never throws.
- [x] The classifier is pure (no I/O, no env, no provider imports) and lives in a leaf module, so any provider can import it later without a registry cycle.

### Acceptance Criteria

- [x] AC1 — Content-policy rejections never fall back (req: R4)

### Q&A

- **Message-based, not typed errors (closed 2026-09-25).** Retyping 13 adapters to throw a `ProviderError` is a larger diff and adds no decision value. The classifier reads `err.name` (`TimeoutError` / `AbortError`) and the message. The status is parsed from the shapes in use: `(NNN)`, `HTTP NNN`, and a trailing `: NNN`. Test fixtures copy the real adapter throw strings, so wording drift in an adapter shows up as a test to update.
- **403 → auth unless policy keywords match (closed).** Policy has precedence.
- **`unknown` is fallback-eligible (closed; operator may override).** Most unknowns are provider-specific request constraints, such as `validate()` size/ratio rules or "no image data", which another provider may satisfy. Fallback is opt-in, and every hop is WARN-logged. Risk: a policy rejection with unrecognized wording would fall back. The keyword list plus the WARN line are the mitigation.
- **Transient ≠ same-provider retry (closed).** D6 moves to the next provider. A same-provider retry/backoff is out of scope.

### Design

New leaf module `plugins/generations/image-gen/src/providers/errors.ts` (no imports, like `timeouts.ts`). Re-export it from `providers/types.ts`.

```ts
export type ProviderErrorClass = 'auth' | 'quota' | 'transient' | 'policy' | 'unknown';
export function classifyProviderError(err: unknown): ProviderErrorClass;
export function isFallbackEligible(cls: ProviderErrorClass): boolean; // cls !== 'policy'
```

The first matching row wins (`status` is parsed from the message):

| Class | Match |
| --- | --- |
| `policy` | `/content[_ -]?policy\|moderation\|safety\|sensitive\|inappropriate\|violat\|blocked/i` |
| `auth` | status 401/403, or `/api[_ -]?key\|unauthori[sz]ed\|authenticat\|forbidden\|requires [A-Z_]+\|is required/i` |
| `quota` | status 402/429, or `/quota\|rate[_ -]?limit\|insufficient\|balance\|billing\|exceeded\|too many requests/i` |
| `transient` | `err.name` is `TimeoutError`/`AbortError`; status 408 or 5xx; or `/timed? ?out\|ECONNRESET\|ETIMEDOUT\|ECONNREFUSED\|fetch failed\|socket\|model loading/i` |
| `unknown` | everything else, including non-`Error` values |

Rejected: typed `ProviderError` across adapters (see Q&A), and a per-provider classifier map (13 small tables for one regex set).

### Plan

1. Add `src/providers/errors.ts` and re-export it from `providers/types.ts`.
2. Add `tests/provider-errors.test.ts` with a table of real adapter strings mapped to classes:
   - `seedream HTTP 401: …` → auth
   - `Provider 'seedream' requires ARK_API_KEY` → auth
   - `MiniMax API error (429): …` → quota
   - MiniMax `insufficient balance` → quota
   - `HuggingFace model loading (HTTP 503): …` → transient
   - a `DOMException` named `TimeoutError` → transient
   - `OpenAI API error: {"error":{"code":"content_policy_violation"…}}` → policy
   - `Google API error (400): … SAFETY …` → policy
   - `Google API error (403): permission denied` → auth
   - `No image data in MiniMax response` → unknown
   - the string `'boom'` → unknown
   - `isFallbackEligible` per class
3. `bun run gate` green. No surface change, so no 04_DESIGN edit.

### Solution

Pure leaf classifier, exactly the frozen Design; no provider or runtime behavior touched (0166 consumes it).

- `plugins/generations/image-gen/src/providers/errors.ts:25` — `ProviderErrorClass` union (`auth | quota | transient | policy | unknown`), no imports (leaf, like `timeouts.ts`).
- `plugins/generations/image-gen/src/providers/errors.ts:69` — `classifyProviderError(err: unknown)`: parses statuses from the three adapter shapes (`(NNN)`, `HTTP NNN`, trailing `: NNN`), reads `err.name`/`message` duck-typed (never throws; non-objects → `unknown`), first matching row wins in the load-bearing order policy → auth → quota → transient → unknown, regexes verbatim from the Design table.
- `plugins/generations/image-gen/src/providers/errors.ts:89` — `isFallbackEligible(cls)` = `cls !== 'policy'` (D6 R4/AC1).
- `plugins/generations/image-gen/src/providers/types.ts:73-78` — re-exports `ProviderErrorClass` + both functions so `types.ts` stays the public surface; placed alphabetically before the existing `./timeouts` re-export per Biome's export sort (no other types.ts change).
- `plugins/generations/image-gen/tests/provider-errors.test.ts:9-31` — fixture table copying real adapter throw strings (seedream 401 / missing ARK key, MiniMax 429 / insufficient balance / no-image-data, HuggingFace 503 model-loading, Google 400 SAFETY / 403 permission denied, OpenAI content_policy_violation body, DOMException `TimeoutError`, trailing-status download 401, plain-string `'boom'`); precedence rows (policy>auth, auth>quota, quota>transient, abort-name and 408 transient), never-throws junk sweep, and `isFallbackEligible` per class incl. AC1.

Rationale: message+name matching over a typed `ProviderError` retyping of 13 adapters, per closed Q&A; `unknown` stays fallback-eligible (Q&A, operator may override via 0166 config).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R4 — classifyProviderError returns policy for content-policy/safety/moderation; isFallbackEligible false for policy only; policy checked first | MET | `plugins/generations/image-gen/src/providers/errors.ts:28` (POLICY_RE matches Design regex verbatim), `:72` (policy row first), `:90` (`cls !== 'policy'`); precedence test `plugins/generations/image-gen/tests/provider-errors.test.ts:49` (safety rejection on 403 → policy, never falls back) — all pass this run |
| (supports R2, R5) — other classes follow Design table order auth → quota → transient; unmatched → unknown; non-Error → unknown; never throws | MET | `plugins/generations/image-gen/src/providers/errors.ts:73-74` (auth → quota rows), `:75-82` (transient: name set / 408+5xx / TRANSIENT_RE, then unknown); junk sweep test `tests/provider-errors.test.ts:38` (null/undefined/42/true/Symbol/{}/[]/Date → unknown); precedence tests `tests/provider-errors.test.ts:55,59,63,67` — all pass this run |
| Classifier is pure (no I/O, no env, no provider imports) and lives in a leaf module | MET | `plugins/generations/image-gen/src/providers/errors.ts` has zero import/require statements (grep count 0 this run); leaf placement mirrors `src/providers/timeouts.ts:1-13` registry-cycle rationale; re-exported via `plugins/generations/image-gen/src/providers/types.ts:77-78` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Content-policy rejections never fall back (req: R4) | MET | test | `plugins/generations/image-gen/tests/provider-errors.test.ts:80` ("classified policy rejections are never fallback-eligible (AC1)") + `:77`; `bun test tests/provider-errors.test.ts` → 22 pass, 0 fail this run |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:12dcfb9f60f7d53670b45eaac90db629c8438dc03cfe6ddb71c889992bc083ce |

### References

- Feature: `docs/features/D6_image-gen-runtime-fallback.md` (R4; supports R2 and R5)
- Throw sites: `plugins/generations/image-gen/src/providers/*.ts` (`rg -n "throw new Error" src/providers`)
- Leaf-module precedent: `src/providers/timeouts.ts` (registry cycle note), `docs/04_DESIGN.md` § Request timeouts
- Consumer: task 0166

### History

- 2026-09-25T20:02:21.255Z backlog → todo (system)
- 2026-09-25T22:48:54.143Z todo → wip (system)
- 2026-09-25T23:05:34.459Z wip → testing (system)
- 2026-09-25T23:05:49.567Z testing → done (system)

