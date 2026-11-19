---
schema_version: 1
name: "Guard paid generation: pre-spend estimate, run-scoped dedupe and takes cap"
status: done
template: feature-impl
created_at: 2026-11-18T22:16:15.451Z
updated_at: "2026-11-19T07:18:14.792Z"
feature_id: D8

ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 6
dependencies: ["0398"]
done_forced: "false"
done_reason: unforced close
---

## 0400. Guard paid generation: pre-spend estimate, run-scoped dedupe and takes cap

### Background

Implements: R1 — pre-spend estimate; R2 — confirmation gate; R3 — run-scoped request-digest dedupe; R4 — takes cap and spend record; R5 — actionable refusals.

Every generation in this pipeline spends real money on the operator's provider account. Pro costs `$0.08` and Clip `$0.04` per request, N takes are N full-price requests (the instance's `batchCount` is a recorded label, not a multi-sample parameter), and analysis is an extra paid call on top (`app/docs/guide/03-api-integration.md` — Cost & batching; `01-lyria-models.md:18`). The spend rules must live in one place, the plugin's `src/spend.ts`, wired into the `kk music` command layer by 0401. That way the skill and the workflow cannot each invent their own.

The failure this prevents is concrete and silent: an agent that re-runs a workflow after a partial failure re-pays for takes it already owns, and the operator only sees it on the provider invoice.

**Why not the 0207 ledger.** `kk ledger` is a markdown token ledger rendered from `spur workflow trace` after a run finishes (`apps/cli/src/ledger.ts:1-9`; a final-node append exits 1 while the run is still `running`). It cannot be appended per call mid-run and is not machine-queryable for dedupe. The per-take sidecar written by 0398 is therefore the spend source of truth, and the run report (0403) sums it.

### Requirements

- [x] R1. Print a pre-spend estimate before any paid call: kk prompt text, resolved model, take count, unit price, and total. Unit prices come from a user config block `music.prices.{pro,clip,analyze}` with built-in defaults `pro: 0.08`, `clip: 0.04` (cited to the instance docs) and **no default for `analyze`**, which renders as `unpriced` and still requires confirmation. `--estimate-only` exits 0 after printing and opens no socket.
- [x] R2. Require an explicit confirmation for any paid call, generate or analyze (`--yes`, or the workflow var the HITL gate sets). Without it, the command prints the estimate and exits non-zero without touching the network.
- [x] R3. Refuse a duplicate within the **run directory** (`<works>/kk-music/<topic-slug>/`, the ADR-042 topic-cadence layout). Compute the request digest frozen in 0397 per take, and refuse when a take sidecar with that digest already exists in the run directory, printing the existing artifact path. `--force --reason <text>` overrides and records the reason in the new take's sidecar. The instance library is **not** a dedupe source.
- [x] R4. Cap takes per invocation (default 2, hard cap 4). The cap is configurable via `music.takesCap` but never above 4. Each take's sidecar records `model`, `unitPrice`, `digest`, `instanceId`, `forced`, `reason` and the workflow run id when present, so spend is summable from the run directory alone.
- [x] R5. Make every refusal actionable: it names the flag that resolves it (`--yes`, `--force --reason`, `--takes`) and never silently downgrades model or take count to fit.

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

- **One enforcement point.** Spend checks are functions in `plugins/generations/music-gen/src/spend.ts`. 0401 wires them into every paid `kk music` verb, and the workflow reaches them only through those verbs. The adapter stays spend-agnostic so tests can drive it without ceremony.
- **Digest = what the provider sees (closed 2026-11-18).** `sha256(canonical-json(request))` over the 0397 canonical request (kk prompt text, lyrics, model, durationTarget, language, image hashes). Hashing the rendered request rather than brief+preset means a cosmetic preset refactor that does not change output does not defeat dedupe, while a changed lyric line does. Take count is excluded because takes of one request share a digest, and the cap governs count.
- **Scope = run directory (closed 2026-11-18).** The failure being prevented is resume re-spend inside one run. Re-generating the same request in another topic or project is a legitimate re-roll, and Lyria output varies per request. So the scope lives in the lookup location (the topic-slug run dir), not in the digest. The digest stays pure content so it remains a valid cross-run provenance key. The instance library was dropped as a dedupe source: it is global across every project and the UI, so it produces exactly the false positives this scope avoids. It is still used for 0398 reconciliation, where a global match by prompt + time window is the right question.
- **Prices in config, not presets.** Provider-specific (Gemini vs OpenRouter) and subject to change. A built-in default with a docs citation beats a hardcoded constant scattered across presets.
- **Dependency.** Blocked by 0398 (sidecar, digest). Not blocked by 0399.
- **Estimate.** 5h: estimate rendering, confirmation gate, digest + run-dir dedupe, takes cap, sidecar spend fields, tests.

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

The spend guard is one module — `src/spend.ts` — that owns all four rules (estimate, confirmation,
run-scoped dedupe, takes cap), and the plugin entry calls it **before the adapter is built**, so
generate and analyze refuse without touching the network. `--estimate-only` prints and exits 0 through
a path that has no adapter or fetch seam at all.

**Change map**

| File:line | Change |
| --- | --- |
| `plugins/generations/music-gen/src/spend.ts:50` | `DEFAULT_TAKES_CAP = 2` — the cap when `music.takesCap` is unset (§6.1 "Take cap … 2, never above 4") |
| `plugins/generations/music-gen/src/spend.ts:57` | `HARD_TAKES_CAP = MAX_TAKES` (= 4) — reuses the brief's own bound instead of a second literal, so the two caps cannot drift |
| `plugins/generations/music-gen/src/spend.ts:70` | `SpendRefusal` — the type every refusal uses; carries `flag` (the exact resolving flag/config key) and the message always contains it, so R5 is a property of the type, not of each call site |
| `plugins/generations/music-gen/src/spend.ts:95` | `SpendRequest` — the spend knobs (`confirmed`, `force`, `reason`, `takes`) the entry and 0401's CLI pass |
| `plugins/generations/music-gen/src/spend.ts:110` | `SpendEstimate` — prompt, model, takes, unitPrice, total, `unpriced` |
| `plugins/generations/music-gen/src/spend.ts:164` | `resolveTakesCap` — the single cap rule: default 2, 1..4 accepted, above 4 refused naming `music.takesCap` |
| `plugins/generations/music-gen/src/spend.ts:193` | `resolveTakeCount` — over the configured cap is a refusal (never a clamp, R5) naming the cap and `--takes`; re-validates the cap so an injected config object cannot smuggle 9 past the load check |
| `plugins/generations/music-gen/src/spend.ts:217` | `estimateGenerate` — prompt via `renderBriefPrompt` (the digest's own text), unit price from `music.prices.{pro,clip}`, `total = unitPrice × takes` |
| `plugins/generations/music-gen/src/spend.ts:232` | `estimateAnalyze` — `music.prices.analyze` has no default: `unitPrice`/`total` are `null` and `unpriced` is true |
| `plugins/generations/music-gen/src/spend.ts:247` | `formatUsd` — trailing-zero-trimmed money so 3–4 decimal prices do not read as rounded cents |
| `plugins/generations/music-gen/src/spend.ts:262` | `formatEstimate` — the R1 block: prompt, model, takes, unit price, total (`unpriced` where no price exists) |
| `plugins/generations/music-gen/src/spend.ts:286` | `requireConfirmation` — R2; an unpriced call is refused exactly like a priced one, naming `--yes` and `--estimate-only` |
| `plugins/generations/music-gen/src/spend.ts:304` | `withConfirmation` — confirm-then-run in one call, so a caller cannot confirm and forget to guard (0401's analyze verb uses it) |
| `plugins/generations/music-gen/src/spend.ts:352` | `findRunDirDuplicates` — R3 scan: only `<runDir>/*.take.json`, keyed by the 0397 digest; a malformed sidecar cannot be shown to match so it is skipped, not fatal |
| `plugins/generations/music-gen/src/spend.ts:406` | `enforceRunScopedDedupe` — refuses on a duplicate with the existing `artifactPath` + digest, requires `--reason` whenever `--force` is passed, records `forced`/`reason` |
| `plugins/generations/music-gen/src/spend.ts:472` | `planGeneration` — the generate guard in R1→R4 order (cap → estimate → confirmation → dedupe); emits the estimate before any refusal so R2 can print then fail, and throws instead of returning an unchecked plan |
| `plugins/generations/music-gen/src/config.ts:180` | reads `music.takesCap` (positive integer; wrong type throws naming the key) |
| `plugins/generations/music-gen/src/config.ts:290` | `resolveMusicConfig` resolves the cap through `resolveTakesCap`, so a config cap of 9 is **rejected at load**, before any estimate, dedupe or socket |
| `plugins/generations/music-gen/src/config.ts:279` | `KK_MUSIC_RUN_ID` → `MusicConfig.runId` (R4's "workflow run id when present"; 0403 passes `$__runId`) |
| `plugins/generations/music-gen/src/artifact.ts:96` | `TAKE_SIDECAR_SUFFIX` extracted so the dedupe scan keys off the same naming rule `takeSidecarName` writes |
| `plugins/generations/music-gen/src/artifact.ts:130` | sidecar gains `runId?` (per-key ownership; 0398's record extended, not replaced) |
| `plugins/generations/music-gen/src/plugin.ts:126` | the guard call sits **before** `createMusicInstance`, so generate cannot open a socket until cap + estimate + confirmation + dedupe have all passed; effective `force`/`reason` come from argv (`0401`) or `metadata.musicGen` (0398's authoring form) |
| `plugins/generations/music-gen/src/plugin.ts:145` | the take loop iterates `plan.digests`, so the take count and each digest come from the approved plan, and the sidecar writes `unitPrice` from the estimate (summing sidecars equals the printed total) |
| `plugins/generations/music-gen/src/plugin.ts:279` | `estimateMusicJob` — the `--estimate-only` path: brief + config + cap + price, no adapter parameter at all (it cannot open a socket because it has nothing to open one with) |
| `plugins/generations/music-gen/src/plugin.ts:308` | `analyzeTake` — the paid analyze entry point behind the same gate, so 0401's `kk music analyze` cannot bypass R2 |
| `plugins/generations/music-gen/src/plugin.ts:336` | `main` gains `--yes`, `--estimate-only`, `--force`, `--reason`, `--takes`; exit code comes from `SpendRefusal.exitCode` |
| `plugins/generations/music-gen/src/index.ts:111` | the spend surface is published from the plugin's single contract export |
| `plugins/generations/music-gen/tests/spend.test.ts:126` | AC1–AC5 offline: estimate block, `unpriced` analyze, `--estimate-only` exit 0 with an unreachable endpoint, no confirmation → refusal with zero requests, run-dir dedupe refused but another run dir allowed, forced re-roll recorded, 1/2/4/8 matrix, config cap 9 rejected at load, sidecar sum == printed total, run id recorded, every refusal naming its flag |
| `plugins/generations/music-gen/tests/plugin.test.ts:32` | the 0398 entry cases now pass `spend: { confirmed: true }` and `--yes` (they exercise generation, not the gate) and collect the emitted estimates |
| `plugins/generations/music-gen/README.md:189` | §3.1.1 documents the guard's four steps, their refusals, the `--estimate-only`/`--yes`/`--force --reason` invocations, and the `music.takesCap` / `KK_MUSIC_RUN_ID` rows in the config table |

**Rationale**

- **One owner, no second policy.** Cap, estimate, confirmation and dedupe are functions in `spend.ts`;
  `config.ts` delegates the cap domain to `resolveTakesCap` (a *type-only* import of `MusicPrices` runs
  the other way, so there is no runtime cycle) and the plugin entry has no spend arithmetic of its own.
  0401 wires the same functions; the workflow reaches them only through `kk music`.
- **Guard before the adapter.** `createMusicInstance` moved below `planGeneration`. That is what makes
  "dedupe runs before any socket opens" structural rather than a promise: on a refusal the client does
  not exist yet.
- **Print then fail.** `planGeneration` calls `emit(formatEstimate(...))` before
  `requireConfirmation`, so R2's "prints the estimate and exits non-zero" is the guard's own order, not
  the caller's discipline. `emit` defaults to stdout and is injectable, so 0401 can route it to its own
  output format.
- **The estimate is the spend record's source.** The sidecar's `unitPrice` is read from
  `plan.estimate.unitPrice`, so "summing the sidecars equals the printed total" (AC4) holds by
  construction instead of by two copies of the same arithmetic.
- **Unpriced is not free.** `estimateAnalyze` maps a missing `music.prices.analyze` to `null` →
  `unpriced` → a refusal that names `--yes`; nothing anywhere substitutes `0`.

**AC interpretations**

- **"a config cap of 9 is rejected at load"** — read as *rejected while the configuration is loaded*,
  not merely when a take count is compared against it: `resolveMusicConfig` calls `resolveTakesCap`, so
  the invalid cap fails before the estimate is rendered, before dedupe and before any socket. The
  guard also re-validates (`resolveTakeCount` → `resolveTakesCap`) so an injected config object cannot
  bypass the load check.
- **"take requests of 1, 2, 4 and 8"** — the brief schema caps `takes` at 4 (`MAX_TAKES`), so 8 is not
  expressible as a brief; the matrix drives `--takes` (the override 0401 ships), which is the same code
  path a brief count takes (`requestedTakes ?? job.takes`). 4 and 8 are both refused naming the
  configured cap of 2.
- **"refused within the run, not across runs"** — the scope is the lookup location (the topic-slug run
  directory), as R3 and Design state, so the digest stays pure content and is still a valid cross-run
  provenance key. The test proves the same brief in a second run directory proceeds with the *same*
  digest.
- **Resume.** 0398's module header said the dedupe "skips" takes left on disk by a partial failure.
  R3 says refuse, and AC3 asserts the refusal, so the guard refuses and the operator resumes with
  `--force --reason "resume take 2"`; the re-spend is then recorded in the new sidecar rather than
  happening silently. That is the failure 0400 exists to prevent, and it is now visible in the ledger
  data. The superseded wording is corrected in the plugin README, not in 0398's frozen header.
- **"generate/analyze refuse without confirmation".** The generator entry is generate-only, so
  `processGeneratorIO` enforces generate and a dedicated `analyzeTake` enforces analyze; both call the
  same `requireConfirmation`, and 0401 gets one paid-analyze entry point instead of re-deriving the
  gate. An `--estimate-only` analyze is `estimateAnalyze` + `formatEstimate`, which 0401 renders.
- **Dry run.** `KK_MUSIC_DRY_RUN=1` does not waive the gate: the entry holds no knowledge of the
  provider before the adapter is chosen, and a gate with a mode-shaped hole in it is not a gate.

**Notes for 0401 / 0403**

- `kk music gen` should pass `spend: { confirmed: values.yes, force, reason, takes }` and may pass
  `emit` to route the estimate into its own output; `--estimate-only` maps to `estimateMusicJob` +
  `formatEstimate` (exit 0).
- `kk music analyze` calls `analyzeTake(instanceId, { client, config, confirmed, emit, model })`.
- `0403` should export the workflow run id as `KK_MUSIC_RUN_ID` (or pass `config.runId`) so each
  sidecar records it; the field is optional and absent when unknown, never empty.
- Sidecar `unitPrice` remains a *price record*, not a receipt (0398 P3): spend is derived from it, and
  `forced`/`reason`/`runId` now make a re-spend traceable inside the run directory alone.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — pre-spend estimate (prompt, model, takes, unit price, total; analyze unpriced by default; `--estimate-only` free) | MET | `plugins/generations/music-gen/src/spend.ts:217` (`estimateGenerate`), `:232` (`estimateAnalyze`), `:262` (`formatEstimate`); `plugins/generations/music-gen/src/config.ts` reads `music.prices.{pro,clip,analyze}` with pro 0.08 / clip 0.04 and no analyze default; `plugins/generations/music-gen/src/plugin.ts:279` (`--estimate-only` path, no adapter constructed) |
| R2 — explicit confirmation for every paid call | MET | `plugins/generations/music-gen/src/spend.ts:286` (`requireConfirmation`), `plugins/generations/music-gen/src/plugin.ts:126` (guard runs before `createMusicInstance`, so no socket can open first) |
| R3 — run-scoped dedupe by the 0397 digest, `--force --reason` override, library not a dedupe source | MET | `plugins/generations/music-gen/src/spend.ts` `findRunDirDuplicates` + `enforceRunScopedDedupe` (scans `<runDir>/*.take.json` only, refuses with the existing artifact path and digest, requires a reason with `--force`) |
| R4 — takes cap (default 2, hard 4) and a complete spend record per take | MET | `plugins/generations/music-gen/src/spend.ts:164` (`resolveTakesCap`), `:193` (`resolveTakeCount`, refuses rather than clamps); sidecar gains `runId` and the estimate's `unitPrice` (`src/artifact.ts`, `src/plugin.ts`) |
| R5 — every refusal names the flag that resolves it | MET | `plugins/generations/music-gen/src/spend.ts:70` (`SpendRefusal` carries `flag` and builds `pass <flag>` into the message) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The estimate is complete and free (req: R1) | MET | test | `plugins/generations/music-gen/tests/spend.test.ts:127` (prompt, model, takes, unit price, total), `:141` (default price config), `:150` (analyze with no price prints `unpriced` and still demands confirmation), `:170` (`--estimate-only` exits 0 and performs no network request) |
| AC2 — Nothing is spent without confirmation (req: R2) | MET | test | `plugins/generations/music-gen/tests/spend.test.ts:254` (generate without `--yes` prints the estimate, exits non-zero, sends nothing), `:270` (with `--yes` exactly one request), `:282`, `:298` (analyze both ways), `:310` (`withConfirmation` never runs the paid call unconfirmed) |
| AC3 — A duplicate request is refused within the run, not across runs (req: R3) | MET | test | `plugins/generations/music-gen/tests/spend.test.ts:328` (refused with the existing artifact path and digest), `:349` (different run directory proceeds), `:363` (`--force --reason` proceeds and records forced+reason), `:380` (`--force` without `--reason` refused naming `--reason`) |
| AC4 — Takes are capped and every take records its spend (req: R4) | MET | test | `plugins/generations/music-gen/tests/spend.test.ts:394` (1 and 2 proceed; 4 and 8 refused, nothing trimmed silently), `:421` (a configured cap of 9 is rejected at load naming `music.takesCap`), `:445` (sidecars sum to the printed estimate), `:469` (sidecar records the workflow run id) |
| AC5 — Refusals are actionable (req: R5) | MET | test | `plugins/generations/music-gen/tests/spend.test.ts:380` (`--force` without `--reason` names `--reason`), `:394` (over-cap refusal names `--takes` and the cap), `:228` (unparseable `--takes` is a refusal, not a crash); the `flag` field is asserted on the refusal type at `plugins/generations/music-gen/src/spend.ts:74` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

SECUA + traceability review of the spend guard (`--focus all`, host-inline; independent of the implement session).

| Priority | Finding | Disposition |
| -------- | ------- | ----------- |
| P1 (blocker) | — | none |
| P2 (major) | — | none |
| P3 (minor) | `music.prices.analyze` has no default, so an analyze estimate renders `unpriced` and the total is `null`. Correct per R1, but a caller that sums `total` for a run report must handle `null` rather than treating it as zero, or analysis spend silently disappears from the 0403 total | DEFER(0403 owns the run report and must render `unpriced` for analysis rather than a number) |
| P4 (advisory) | The guard refuses (never clamps) a take count above the cap, including a configured cap above the hard maximum — so a `music.takesCap: 9` is rejected at load rather than silently reduced. That is the letter of R4/R5 and the safer reading; a config typo fails loudly instead of quietly costing 8 requests | ACCEPTED |
| P4 (advisory) | `SpendRefusal` carries `flag` and builds the remediation into its message (`plugins/generations/music-gen/src/spend.ts:70`), so R5 is a type property rather than a convention each call site could forget | ACCEPTED |

**Security.** The confirmation gate runs before the adapter is constructed (`plugins/generations/music-gen/src/plugin.ts:126`), so an unconfirmed request cannot reach a socket even if a later stage throws — the ordering, not a flag check inside the adapter, is the guarantee. `--estimate-only` takes no adapter at all (`:279`), which makes its "no network" claim structural.

**Cost correctness.** Dedupe reads only `<runDir>/*.take.json` by the 0397 per-take digest (`src/spend.ts` `findRunDirDuplicates`/`enforceRunScopedDedupe`), refuses with the existing artifact path and digest, and never consults the instance library — so a re-run inside one topic's run directory cannot re-buy a take, while a different topic proceeds. Forced re-rolls record `forced`/`reason`, and the sidecars sum to the printed estimate (`plugins/generations/music-gen/tests/spend.test.ts:445`), which is what makes 0403's roll-up honest.

**Residual risk.** The prices are configured list prices, not billed amounts (0398 already records that distinction), and an `unpriced` analyze call can only be bounded by the operator's confirmation. The eventual provider invoice remains the only ground truth.

**Final disposition.** Approve for `done` — R1–R5 and AC1–AC5 MET; 203 tests pass; typecheck and Biome clean; light gate DEFERRED (batch full gate owes coverage).

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-19T00:14:06.546Z feature_id Q → D8 (system)
- 2026-11-19T07:02:54.716Z backlog → wip (system)
- 2026-11-19T07:18:13.882Z wip → testing (system)
- 2026-11-19T07:18:14.783Z testing → done (system)

