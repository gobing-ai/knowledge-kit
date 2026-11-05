---
schema_version: 1
name: Derive session-preflight probes from the enabled publish targets
status: done
template: feature-impl
created_at: 2026-10-22T18:41:32.723Z
updated_at: "2026-11-05T08:24:08.739Z"
feature_id: G15

dependencies: ["0321"]
priority: P2
estimate_hours: 2
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0325-verdict.json
---

## 0325. Derive session-preflight probes from the enabled publish targets

### Background

voice2 `session-preflight` (`plugins/kk/workflows/kk-daily-ai-voice2.yaml:178`) hard-codes `kk plugin check wechatmp-pub xhs-pub`, so enabling a channel requires a workflow edit (boundary violation, design §6).

**Refine corrections (2026-10-22)**

- The probe derivation itself is implemented by 0321 R3 (`publish-matrix-check`). This task is the voice3/publish3 adoption plus the generate-side preflight: voice3 must warm the same sessions before the long generation, not discover an expired login at publish time.
- voice2 is not edited (operator constraint); its hard-coded list stays.

### Requirements

- [x] R1. The probe set is the distinct plugins of `mode ∈ {draft, live}` rows across every window the preset enables. It is computed from the preset, because at generate time no plan exists yet. An empty set means the node passes and prints `no probes`.
- [x] R2. Add `kk stage run publish-matrix-check <workDir> --preset <slug> --all-windows`, a preset-only mode of the 0321 check that needs no plan file. voice3's `session-preflight` node calls it warn-only. publish3's `check` node calls the plan form.
- [x] R3. Reuse ADR-032 `kk plugin check` (`apps/cli/src/commands/plugin.ts:195`, 60s probe budget); no new probe mechanism.
- Out of scope: editing voice2; auto-login (stays `kk bot login`, operator action).

### Acceptance Criteria

- [x] AC1 — The channel matrix comes from a config-selected publish preset (req: R1, R2)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-22T19:09:01.079Z

- **Q: Probe from the plan or the preset at generate time?** Closed: the preset, because the plan needs the bundle, which does not exist before generation.

### Design

- One extra input mode on `checkPublishMatrix` (0321): `{ preset, allWindows: true }` → rows = resolved preset targets (no bundle) filtered `mode !== 'off' && mode !== 'dummy'`, keyed distinct by plugin.
- The output path is `4-publish/check.preflight.json`; the node is non-blocking (`onError: continue`), matching voice2 session-preflight semantics.
- Anti-patterns: no plugin names in workflow YAML; no second probe runner.
- Handoff: 0324 places the node; 0323 uses the plan form.

### Plan

1. Failure list: an empty preset, all-dummy (zero probes), a probe timeout (warn, not fail), and an unknown plugin in the preset (fail: preset invalid).
2. Add the `--all-windows` preset mode to `checkPublishMatrix` with an injectable probe runner. (R1, R2)
3. Test in `publish-matrix.test.ts`: the daily-ai-voice preset with two `draft` browser rows yields exactly those two probes, and all-dummy yields none. (R1)
4. Run `bun run lint && bun run test`.

### Solution

| Change | What / why |
| --- | --- |
| `apps/cli/src/publish-matrix.ts:374` | `checkPublishMatrix` gains a second input mode: `--preset <slug> --all-windows` reads the preset instead of a plan, because at generate time no bundle (hence no plan) exists yet. One probe loop serves both modes. |
| `apps/cli/src/publish-matrix.ts:396` | Preset mode resolves the probe set as the distinct plugins of every non-`off`, non-`dummy` row — all windows — and refuses a preset naming an uninstalled plugin (invalid preset data, not a runtime refusal). |
| `apps/cli/src/publish-matrix.ts:437` | Output: `4-publish/check.preflight.json` with `window: "preflight"`; an empty set prints `no probes` and passes; probe refusals stay warn-only (exit 0). |
| `apps/cli/tests/publish-matrix.test.ts:557` | Proves the two-window derivation with one dummy and one `off` row excluded, and the `2 probe(s) recorded for preflight` line. |
| `apps/cli/tests/publish-matrix.test.ts:598` | All-dummy/off preset → zero probes, `no probes`, exit 0. |
| `apps/cli/tests/publish-matrix.test.ts:623` | A preset naming `linkedin-pub` fails by name. |
| `docs/04_DESIGN.md:2019` | The check surface now documents both input modes and the one fatal preset case (T3). |

**Verification:** `bun run lint` clean; `bun test apps/cli/tests/publish-matrix.test.ts apps/cli/tests/publish-matrix-stage.test.ts apps/cli/tests/itc-publish.test.ts` → 65 pass, 0 fail. voice2 is untouched (its hard-coded node stays, per the operator constraint), so the adoption itself lands with the voice3 workflow (0324) and publish3's `check` node (0323).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/publish-matrix.ts:466` checkPublishMatrix, `apps/cli/src/publish-matrix.ts:471` --all-windows derives probes from the preset; `apps/cli/src/publish-matrix.ts:550` no probes; `apps/cli/tests/publish-matrix.test.ts:1014`, `apps/cli/tests/publish-matrix.test.ts:1055` |
| R2 | MET | `apps/cli/src/publish-matrix.ts:515-516` preflight label and check.preflight.json; `apps/cli/tests/publish-matrix.test.ts:1014` |
| R3 | MET | `apps/cli/src/itc-publish.ts:340` probePlugin (kk plugin check entry, 60 s budget) reused; `apps/cli/tests/publish-matrix.test.ts:1080` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The channel matrix comes from a config-selected publish preset (req: R1, R2) | MET | test | `apps/cli/tests/publish-matrix.test.ts:1014`, `apps/cli/tests/publish-matrix.test.ts:1055`, `apps/cli/tests/publish-matrix.test.ts:1080`; re-verified 2026-11-05 (bun run lint exit 0; bun run build exit 0; bun run test exit 0, 4613 pass / 3 skip / 0 fail across 236 files) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Confidence: HIGH
Verdict: PASS

**Scope:** the preset-only input mode of `publish-matrix-check` (`apps/cli/src/publish-matrix.ts:374`), its three tests and the `docs/04_DESIGN.md` check-surface entry. One probe loop, two ways to name its rows.

| Priority | Finding | Disposition |
| --- | --- | --- |
| P4 | The plan mode gained a success line (`N probe(s) recorded for <window>`); the previous invocation printed nothing on a green path. | Accepted — the line is information, not control flow: no consumer parses stage stdout, and it makes a silent skip visible. |

**SECUA / architecture**

- **Security** — the probe set comes from preset data and is iterated as plugin names through `probePlugin`, never shelled; the redaction of config-injected values (0311) still applies.
- **Efficiency** — one preset read, one probe per distinct plugin (a plugin with three operations is probed once); no bundle read, which is the whole point of the preset mode.
- **Correctness** — `off` and `dummy` rows are excluded because they never spawn a plugin; an empty set is a pass with `no probes`, matching voice2's node semantics (design §5a: "warn-only"). An uninstalled plugin in a preset is fatal because a preset is registry data, whereas a plan row referencing a vanished plugin stays a recorded `plugin not installed` probe.
- **Usability** — the usage line states both modes; a fatal preset names the offending plugins.
- **Architecture** — no second probe runner; the mode is one branch in the existing stage, so 0324 (generate-side node) and 0323 (publish3 `check` node) call the same stage with different flags. voice2 is untouched, per the operator constraint.

**Residual risk**

- The probe budget is ADR-032's 60 s per plugin; a preset with many browser channels makes the generate-side preflight correspondingly longer, and it is non-blocking by design (`onError: continue` is 0324's placement).
- A preset row whose plugin exists but whose `check` entry is absent records `ok` (unchanged `probePlugin` contract) — the probe cannot prove a session it does not know how to open.

**Verification:** `bun run lint` clean; `bun test` on the matrix, stage and itc suites → 65 pass, 0 fail; `spur task gate 0325` PASS on this tree.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-22T18:59:28.584Z feature_id Q → G15 (system)
- 2026-10-22T19:09:50.452Z backlog → todo (system)
- 2026-10-22T21:43:02.311Z todo → wip (system)
- 2026-10-22T21:57:07.918Z wip → testing (system)
- 2026-10-22T21:57:09.992Z testing → done (system)

