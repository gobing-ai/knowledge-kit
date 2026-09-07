---
schema_version: 1
name: Exempt the show-notes markdown output from the executor Result validation
status: done
template: feature-impl
created_at: 2026-09-07T19:42:10.295Z
updated_at: "2026-09-07T19:55:14.994Z"
feature_id: L1

---

## 0101. Exempt the show-notes markdown output from the executor Result validation

### Background

Follow-on to 0100 (input-side contract union, PASS 2026-09-07): the show-notes seam has two cuts. With the input gate fixed, a real end-to-end `kk executor run podcast-pub --in plan.json --out show-notes.md` now reaches the podcast-pub entry, whose array path writes raw markdown to `--out` (`plugins/publishings/podcast-pub/src/index.ts:472-481`, documented op IO). But the executor output stage (`apps/cli/src/invoke.ts:279-296`) unconditionally JSON-parses and ResultSchema-validates `--out`, so the invocation dies at `Output file ... is invalid JSON` — the second cut, found by 0100's builder via code inspection (P3 residual) and confirmed by orchestrator read. The YAML consumes `3-publish/show-notes.md` as a terminal markdown artifact (no downstream JSON reader; fan-out states use `3-publish/content.json`), so the markdown file itself is the deliverable — a Result-wrap inside podcast-pub would corrupt the documented artifact. The exemption belongs at the same seam layer as 0100, keyed on the input form.

### Requirements

R1. Output-stage exemption: when the invocation's input is the bare Doc[] array (show-notes) form, `--out` is validated only for existence and non-emptiness — no JSON.parse, no ResultSchema parse; Content-object invocations keep the exact existing output validation and errors.
R2. Seam regression tests that FAIL without the fix: array-in + markdown-out invocation exits 0 with markdown intact; object-in + invalid-JSON-out still exits 1 with `Output file ... is invalid JSON`; object-in + valid Result out unchanged.
R3. Docs sync (same commit): two-form output contract (markdown --out for the array form) in `docs/design/publish-plugin-specification.md`; cross-check `docs/design/podcast-pub.md` §4.1 and `docs/design/kk-cli-surface.md` executor run rows.
R4. Unit tests lock each behavior in the workspace test layout.

### Acceptance Criteria

```gherkin
Feature: Exempt the show-notes markdown output from the executor Result validation

  Scenario: podcast-pub owns show-notes rendering and episode assembly
    Given the executor output stage treats --out as an opaque artifact (exists and non-empty, no JSON or Result schema parse) exactly when the invocation input is the bare Doc[] show-notes form, while Content-object invocations keep full Result validation
    When kk executor run podcast-pub is invoked with --in pointing at an episode plan Doc[] array and --out pointing at a markdown path
    Then the entry's raw markdown output survives the output stage and the invocation exits 0 with the markdown file intact at --out
    And a Content-object invocation whose --out is invalid JSON still exits 1 with the existing output-stage error, and the publish spec documents the two-form output contract
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-07T19:42:10.926Z

#### Q&A entry — 2026-09-07T12:55:00.000Z

- CLOSED (fix shape, orchestrator 2026-09-07): invoke-side output exemption keyed on the array input form (the parsed input is already in scope in runInvoke); NOT a podcast-pub Result-wrap (would corrupt the documented markdown artifact) and not a blanket skip (object invocations must keep Result validation).
- CLOSED (scope): surgical — one output-stage branch + seam regression tests + docs sync; no podcast-pub runtime changes, no YAML changes.

### Design

WHAT: Teach the executor output stage the two-form contract symmetric to 0100's input union — the array (show-notes) form's `--out` is an opaque artifact.

WHERE:

- `apps/cli/src/invoke.ts:279-296` — output stage: skip JSON.parse + ResultSchema parse when the invocation input was the array form (the input JSON is already parsed in runInvoke; plumb `Array.isArray`); keep exists + non-empty checks for both forms.
- `apps/cli/tests/invoke.test.ts` — extend the existing 0100 harness: array-in + markdown-out exit 0; object-in + invalid-JSON-out still exit 1; object-in + valid Result unchanged.
- Docs: `docs/design/publish-plugin-specification.md` (two-form output contract), cross-check `docs/design/podcast-pub.md` §4.1 and `docs/design/kk-cli-surface.md`.

WHY: 0100 unblocked input pre-validation and entry reach; the output stage is the remaining cut between the executor and the documented show-notes markdown artifact.

CONSTRAINTS: no podcast-pub runtime changes; no YAML changes; no new dependencies; Content-object publish behavior byte-identical (errors included).

### Plan

1. Output-stage exemption keyed on array input. 2. Seam regression tests (RED without fix). 3. Docs sync. 4. Full gates + verify + verdict.

### Solution

Output-stage exemption mirrored on 0100's input-side union, keyed on the input form the executor already parsed:

- `apps/cli/src/invoke.ts:1` — add `statSync` to the `node:fs` import (non-empty gate).
- `apps/cli/src/invoke.ts:220-223` — `showNotesArrayInput` flag declared before the input stage.
- `apps/cli/src/invoke.ts:255-258` — flag set after the existing input validation passes: `record.kind === 'publish' && Array.isArray(json)` — the bare Doc[] show-notes leg of publish's two-form input union (0100). Scoped to publish on purpose: a generator's Doc[] input is the ordinary form, so its `--out` stays a validated Content JSON (a blanket `Array.isArray` key fails the seam test's object leg and the existing generator coverage — RED-proven).
- `apps/cli/src/invoke.ts:293-308` — the exemption: the shared output-exists check (`:293-300`) is kept for both forms; the array show-notes form then only gates non-emptiness (`statSync().size === 0` → exit 1, `:303-306`) and returns 0 — no `JSON.parse`, no `contract.output.safeParse`. Rationale comment cites the 0095 show-notes markdown artifact (`plugins/publishings/podcast-pub/src/index.ts:472-481`) and 0100's P3 residual. Content-object invocations fall through to the untouched JSON/Result validation (`:310-330`) — error messages byte-identical, empty `--out` still fails there as invalid JSON.
- `apps/cli/tests/invoke.test.ts:236-335` — seam regression in the 0100 harness (temp dir + manifest + mode-switching fake entry), five legs: (a) array-in + raw markdown `--out` → exit 0, bytes intact; (a-exists)/(a-nonempty) array form still fails missing/empty `--out`; (b) object-in + invalid JSON → exit 1 with the exact `Output file ... is invalid JSON` message (captured via `captureOutput()`); (c) object-in + valid Result → exit 0.
- `docs/design/publish-plugin-specification.md:20-26` (§2.1 two-form output contract), `:73` (§2.5 Schema Rejection scoped to Content-object invocations), `:80` (§3 Schema Impact) — docs sync; cross-checked `docs/design/podcast-pub.md` §4.1 (`:106` already documents markdown `--out`), `docs/design/kk-cli-surface.md:83-86` (usage rows only), `docs/04_DESIGN.md:434` (plugin-side IO) — none restate the old single-form contract, no edits needed.

Not touched: podcast-pub runtime, kk-core contracts (0100's union stands), workflow YAML, surfdash-pub/microfeed, no new dependencies.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | Output-stage exemption at `apps/cli/src/invoke.ts:302-308`: when the invocation input was the bare Doc[] show-notes form, `--out` is validated only for existence (`:293-300` shared exists check, unchanged) and non-emptiness (`:303-306`, `statSync().size === 0` → exit 1), then `return 0` — no JSON.parse, no `contract.output.safeParse`; the flag is keyed exactly on the show-notes form at `apps/cli/src/invoke.ts:258` (`record.kind === 'publish' && Array.isArray(json)` — the parsed input JSON already in scope in runInvoke, set after the existing input validation passes) with the two-form rationale comment at `:293-301` citing the 0095 show-notes markdown artifact (`plugins/publishings/podcast-pub/src/index.ts:472-481`) and 0100's P3 residual; Content-object invocations keep the exact existing JSON/Result validation and error messages byte-identical (`apps/cli/src/invoke.ts:310-330` untouched code below the early return); generator/ingestion kinds untouched (a generator's Doc[] input is the ordinary form — pinned by the existing `apps/cli/tests/invoke.test.ts` generator invalid-JSON-out test, still green) |
| R2 | MET | Seam regression `apps/cli/tests/invoke.test.ts:236-335` extending the 0100 temp-dir/manifest/fake-entry harness: (a) array-in + entry writes raw markdown to `--out` → exit 0 and the markdown file survives byte-identical (`:274-284`, asserted `toBe('# Show notes\n\n- Segment 1: intro\n- Segment 2: deep dive\n')` — not parsed as JSON); (a-exists)/(a-nonempty) legs lock the existence and non-emptiness gates for the array form (`:286-305`); (b) object-in + invalid-JSON-out → exit 1 with the exact `Output file ... is invalid JSON` message captured via `captureOutput()` (`:307-322`); (c) object-in + valid Result out → exit 0 unchanged (`:324-334`); RED proof run this session — with the exemption branch removed: `(fail) runInvoke > 0101 — show-notes array-form publish invocations treat --out as an opaque markdown artifact`, `error: expect(received).toBe(expected) / Expected: 0 / Received: 1` (leg (a) dies at the output stage), 14 pass / 1 fail; branch restored → 15 pass / 0 fail; second RED proof under the wrong fix (blanket skip): leg (b) and the existing generator legs fail `Expected: 1 / Received: 0`, proving the publish-scoped key is load-bearing |
| R3 | MET | Docs synced in `docs/design/publish-plugin-specification.md`: §2.1 `:20-26` (output bullet now documents the two-form output contract — Content-object input → `ResultSchema` JSON on `--out` executor-parsed and -validated; bare Doc[] show-notes input → raw markdown artifact on `--out`, executor treats it as opaque: existence + non-emptiness only), §2.5 `:73` (Schema Rejection bullet scoped to Content-object invocations with the 0101 exemption pointer), §3 Schema Impact `:80` (output contract two-form likewise, leaf schemas unchanged); cross-checks requiring no edit: `docs/design/podcast-pub.md:106` (§4.1 already documents `--out`: the rendered markdown file itself, not a Result JSON — no old single-form restatement), `docs/design/kk-cli-surface.md:83-86` (executor run rows are usage lines only, no output-contract restatement), `docs/04_DESIGN.md:434` (describes plugin-side `processPublishIO` IO, not the executor output stage) |
| R4 | MET | Unit tests lock each behavior in the workspace test layout: `apps/cli/tests/invoke.test.ts:236-335` (one test, five legs — markdown survival, exists gate, non-empty gate, object-form invalid-JSON message, object-form valid-Result pass-through), suite green 15 pass / 0 fail; no kk-core test changes needed — the 0100 union contract tests (`packages/kk-core/tests/kinds.test.ts`) are untouched and green in the full suite |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R6 — podcast-pub owns show-notes rendering and episode assembly | MET | command | Given/When/Then verified by fresh runs this session: (1) `bun test apps/cli/tests/invoke.test.ts` → 15 pass / 0 fail, incl. the 0101 seam test proving an array-form publish invocation with markdown `--out` exits 0 with the raw markdown intact while a Content-object invocation with invalid-JSON `--out` still exits 1 with `Output file ... is invalid JSON`; (2) RED proof: exemption branch removed → same test fails `Expected: 0 / Received: 1`, restored → 15/0; (3) `NODE_ENV=test bun run test` → 636 pass / 0 fail across 44 files (baseline 635 + 1 new seam test), locking that generator/ingestion output validation, podcast-pub runtime, and the 0100 input union are unchanged; (4) `bun run lint` exit 0 and `spur workflow validate plugins/kk/workflows/kk-daily-ai-voice.yaml` exit 0 — the executor output stage now treats show-notes `--out` as opaque exactly for the Doc[] publish form (docs: `docs/design/publish-plugin-specification.md:20-26,73,80`), podcast-pub remains the owner of show-notes rendering (no plugin runtime changes: `plugins/publishings/podcast-pub/src/index.ts` untouched this task) |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
| ---------- | ----------- | ---------- | ---------- |
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | Frozen WHERE implemented exactly: output-stage exemption at `apps/cli/src/invoke.ts:302-308` keyed on the input form already parsed in runInvoke (`:258`), exists check retained (`:293-300`) + non-empty added (`:303-306`), JSON.parse + ResultSchema parse skipped only for the show-notes form; Content-object invocations byte-identical (untouched code below the early return); no podcast-pub runtime changes, no kk-core contract changes (0100 union stands untouched), no workflow YAML changes, no surfdash-pub/microfeed behavior changes, no new dependencies |
| P4 | fix-pass | — | All three mandated gates green on the final tree: `bun run lint` exit 0; `NODE_ENV=test bun run test` 636/0 (baseline 635/0 + 1 new seam test); `spur workflow validate plugins/kk/workflows/kk-daily-ai-voice.yaml` exit 0/0 errors (19 pre-existing-class advisories) |
| P4 | evidence-rule-pass | — | Every behavior-bearing row carries evidence run this session (15/0 targeted suite, 636/0 full suite, lint 0, validate 0, both RED-proof pre-fix runs quoted with exact expect failures) |
| P4 | ac-boxes | — | AC coverage row uses the exact frozen title `R6 — podcast-pub owns show-notes rendering and episode assembly`; AC gherkin verified against fresh evidence (array-in + markdown-out exit 0 with file intact; object-in + invalid-JSON-out exit 1 with the existing error; publish spec documents the two-form output contract); no shippable row emitted |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-07T19:42:26.457Z backlog → todo (system)
- 2026-09-07T19:42:26.626Z todo → wip (system)
- 2026-09-07T19:55:14.655Z wip → testing (system)
- 2026-09-07T19:55:14.994Z testing → done (system)
