---
schema_version: 1
name: Exempt the show-notes markdown output from the executor Result validation
status: done
template: feature-impl
created_at: 2026-09-07T19:42:10.295Z
updated_at: "2026-09-07T21:33:46.559Z"
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
|-------------|--------|----------|
| R1 | MET | Array-form output exemption: `showNotesArrayInput` flag (apps/cli/src/invoke.ts#53B9 :220-223), scoped to kind==='publish' && Array.isArray(json) (:255-258); --out validated for existence + non-emptiness only (:293-308, statSync().size===0 gate, return 0); object-form validation untouched (:310-331) |
| R2 | MET | Fail-without-fix regressions: apps/cli/tests/invoke.test.ts#37A0 :236-334 — array-in + markdown-out exits 0 with markdown intact; object-in + invalid-JSON-out exits 1 with `Output file ... is invalid JSON`; exists/nonempty failure legs; pre-fix failure proven live in 0098 attempt-2 |
| R3 | MET | Docs synced same-commit (per recorded Solution): docs/design/publish-plugin-specification.md (markdown --out for array form); docs/design/podcast-pub.md §4.1 :106; docs/design/kk-cli-surface.md:83-86 |
| R4 | MET | Tests in workspace layout: bun test packages/kk-core/tests/kinds.test.ts apps/cli/tests/invoke.test.ts → 22 pass / 0 fail (this session) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R6 — podcast-pub owns show-notes rendering and episode assembly | MET | command | 22/0 fresh; live: 0098 r2 show-notes state wrote rendered markdown via the array form, pipeline terminal done (episode 06wiZN5N3WN, publish-status full) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | Exemption narrowly scoped to publish-kind array input; object-form Result validation byte-identical; two-form output contract documented |
| P4 | evidence-rule-pass | — | Every row carries a test command run this session or a file#line anchor re-read this session |
| P4 | ac-boxes | — | AC row uses the exact feature scenario title `R6 — podcast-pub owns show-notes rendering and episode assembly` |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-07T19:42:26.457Z backlog → todo (system)
- 2026-09-07T19:42:26.626Z todo → wip (system)
- 2026-09-07T19:55:14.655Z wip → testing (system)
- 2026-09-07T19:55:14.994Z testing → done (system)
