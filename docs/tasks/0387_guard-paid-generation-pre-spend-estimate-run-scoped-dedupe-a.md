---
schema_version: 1
name: "Guard paid generation: pre-spend estimate, run-scoped dedupe and takes cap"
status: backlog
template: feature-impl
created_at: 2026-11-18T22:16:15.451Z
updated_at: "2026-11-19T00:14:06.546Z"
feature_id: D8

ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 6
---

## 0387. Guard paid generation: pre-spend estimate, run-scoped dedupe and takes cap

### Background

Implements: R1 — pre-spend estimate; R2 — confirmation gate; R3 — run-scoped request-digest dedupe; R4 — takes cap and spend record; R5 — actionable refusals.

Every generation in this pipeline spends real money on the operator's provider account. Pro costs `$0.08` and Clip `$0.04` per request, N takes are N full-price requests (the instance's `batchCount` is a recorded label, not a multi-sample parameter), and analysis is an extra paid call on top (`app/docs/guide/03-api-integration.md` — Cost & batching; `01-lyria-models.md:18`). The spend rules must live in one place, the plugin's `src/spend.ts`, wired into the `kk music` command layer by 0388. That way the skill and the workflow cannot each invent their own.

The failure this prevents is concrete and silent: an agent that re-runs a workflow after a partial failure re-pays for takes it already owns, and the operator only sees it on the provider invoice.

**Why not the 0207 ledger.** `kk ledger` is a markdown token ledger rendered from `spur workflow trace` after a run finishes (`apps/cli/src/ledger.ts:1-9`; a final-node append exits 1 while the run is still `running`). It cannot be appended per call mid-run and is not machine-queryable for dedupe. The per-take sidecar written by 0385 is therefore the spend source of truth, and the run report (0390) sums it.

### Requirements

- [ ] R1. Print a pre-spend estimate before any paid call: kk prompt text, resolved model, take count, unit price, and total. Unit prices come from a user config block `music.prices.{pro,clip,analyze}` with built-in defaults `pro: 0.08`, `clip: 0.04` (cited to the instance docs) and **no default for `analyze`**, which renders as `unpriced` and still requires confirmation. `--estimate-only` exits 0 after printing and opens no socket.
- [ ] R2. Require an explicit confirmation for any paid call, generate or analyze (`--yes`, or the workflow var the HITL gate sets). Without it, the command prints the estimate and exits non-zero without touching the network.
- [ ] R3. Refuse a duplicate within the **run directory** (`<works>/kk-music/<topic-slug>/`, the ADR-042 topic-cadence layout). Compute the request digest frozen in 0384 per take, and refuse when a take sidecar with that digest already exists in the run directory, printing the existing artifact path. `--force --reason <text>` overrides and records the reason in the new take's sidecar. The instance library is **not** a dedupe source.
- [ ] R4. Cap takes per invocation (default 2, hard cap 4). The cap is configurable via `music.takesCap` but never above 4. Each take's sidecar records `model`, `unitPrice`, `digest`, `instanceId`, `forced`, `reason` and the workflow run id when present, so spend is summable from the run directory alone.
- [ ] R5. Make every refusal actionable: it names the flag that resolves it (`--yes`, `--force --reason`, `--takes`) and never silently downgrades model or take count to fit.

### Acceptance Criteria

```gherkin
Scenario: AC1 — The estimate is complete and free (req: R1)
  Given a resolved job with model, takes and the default price config
  When the estimate-only path runs
  Then it prints prompt, model, takes, unit price and total
  And an analyze estimate with no configured price prints "unpriced"
  And it performs no network request

Scenario: AC2 — Nothing is spent without confirmation (req: R2)
  Given a generate job and an analyze job, each without a confirmation flag
  When each is requested
  Then each command exits non-zero after printing the estimate
  And the instance receives no generate or analyze request

Scenario: AC3 — A duplicate request is refused within the run, not across runs (req: R3)
  Given a run directory that already holds a take for a request digest
  When the same brief is submitted again into that run directory
  Then it is refused with the existing artifact path and the digest
  And the same brief submitted into a different topic's run directory proceeds
  And `--force --reason "re-roll"` proceeds and records forced=true with the reason

Scenario: AC4 — Takes are capped and every take records its spend (req: R4)
  Given take requests of 1, 2, 4 and 8 with the default cap, and a config cap of 9
  When each is submitted
  Then 1 and 2 proceed, 4 is refused naming the configured cap, 8 is refused, and a config cap of 9 is rejected at load
  And each proceeding take writes a sidecar with model, unit price, digest and instance id
  And summing the sidecars in the run directory equals the printed estimate total

Scenario: AC5 — Refusals are actionable (req: R5)
  Given any refusal path
  When its output is read
  Then it names the exact flag that would resolve it
  And no refusal path alters model or takes silently
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- **One enforcement point.** Spend checks are functions in `plugins/generations/music-gen/src/spend.ts`. 0388 wires them into every paid `kk music` verb, and the workflow reaches them only through those verbs. The adapter stays spend-agnostic so tests can drive it without ceremony.
- **Digest = what the provider sees (closed 2026-11-18).** `sha256(canonical-json(request))` over the 0384 canonical request (kk prompt text, lyrics, model, durationTarget, language, image hashes). Hashing the rendered request rather than brief+preset means a cosmetic preset refactor that does not change output does not defeat dedupe, while a changed lyric line does. Take count is excluded because takes of one request share a digest, and the cap governs count.
- **Scope = run directory (closed 2026-11-18).** The failure being prevented is resume re-spend inside one run. Re-generating the same request in another topic or project is a legitimate re-roll, and Lyria output varies per request. So the scope lives in the lookup location (the topic-slug run dir), not in the digest. The digest stays pure content so it remains a valid cross-run provenance key. The instance library was dropped as a dedupe source: it is global across every project and the UI, so it produces exactly the false positives this scope avoids. It is still used for 0385 reconciliation, where a global match by prompt + time window is the right question.
- **Prices in config, not presets.** Provider-specific (Gemini vs OpenRouter) and subject to change. A built-in default with a docs citation beats a hardcoded constant scattered across presets.
- **Dependency.** Blocked by 0385 (sidecar, digest). Not blocked by 0386.
- **Estimate.** 5h: estimate rendering, confirmation gate, digest + run-dir dedupe, takes cap, sidecar spend fields, tests.

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-19T00:14:06.546Z feature_id Q → D8 (system)

