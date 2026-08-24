---
schema_version: 1
name: "Audit kk-solo-podcast pipeline for improvements beyond skill extraction"
status: done
template: brainstorm
created_at: 2026-08-23T22:22:43.454Z
updated_at: "2026-08-23T23:47:12.366Z"
feature_id: F7
---

## 0076. Audit kk-solo-podcast pipeline for improvements beyond skill extraction

### Background

<!-- Why this task exists: the problem, motivation, and context. Self-contained — readable without the parent. -->

### Requirements
- [x] R1. Audit `plugins/kk/workflows/kk-solo-podcast.yaml` end to end: every state, guard, and transition.
- [x] R2. Identify deterministic work hiding in agent steps (or vice versa), missing validation between states, brittle shell (e.g. the revise-count file under `.spur/run/`), duration-check band sanity ([0.5x, 2.0x]), dry-run/CI ergonomics (`script_approved`, `outline` pre-set paths), error paths into `failed`, and var sprawl.
- [x] R3. Cross-check `plugins/kk/workflows/kk-daily-ai-voice.yaml` only for its shared tail (wrap-docs → generate → quality-control); its script step is deterministic (`dailynews-gen`, no `agent.run`) — verified 2026-08-23 — so do not report "missing agent extraction" there as a finding.
- [x] R4. Record in ## Solution a ranked proposals list — each with what, why, effort estimate, and a recommended ship/defer call — for the operator to select which graduate into implement tickets.

**Non-goals:** applying any fix; changing the workflow; deciding which proposals ship (operator's call).
### Acceptance Criteria
```gherkin
Feature: Solo-podcast pipeline improvement audit

  Scenario: Ranked proposals recorded
    Given the full kk-solo-podcast workflow definition
    When the audit completes
    Then ## Solution lists ranked improvement proposals
    And each proposal has what, why, effort estimate, and a ship/defer recommendation
    And proposals cover validation gaps, brittle shell, dry-run ergonomics, and error paths where found
```
### Q&A
- **Pipeline improvement audit in scope — settled (operator, 2026-08-23):** proposals surface for operator ship/defer selection; nothing is applied by this ticket.
- **Open:** none blocking. Proposal selection happens on the map (F7), not here.

References: map `docs/features/F7_audio-authoring-skill-extraction-wayfinder-map.md`; `plugins/kk/workflows/kk-solo-podcast.yaml`; `plugins/kk/workflows/kk-daily-ai-voice.yaml`.
### Design
**WHAT:** A ranked improvement-proposals list for the `kk-solo-podcast` pipeline, recorded in this task's ## Solution. **No fixes are applied.**

**WHY:** Map F7 decision — the extraction effort also re-evaluates the whole pipeline; proposals surface to the operator for ship/defer selection before implement tickets are graduated.

**WHERE (frozen names):**
- `plugins/kk/workflows/kk-solo-podcast.yaml` — sole audit target, all 14 states + 15 transitions.
- `plugins/kk/workflows/kk-daily-ai-voice.yaml` — cross-check for the shared tail (wrap-docs → generate → quality-control) only.

**Audit lenses (check each, report only real findings):**
1. Deterministic-vs-agent fit — any agent step that is actually deterministic, any shell step doing LLM-grade judgment.
2. Missing validation between states (e.g. `understand` → `outline-write` has no briefing sanity check beyond `expectFile`).
3. Brittle shell — revise-count file at `.spur/run/$run_id-solo-revise-count` (unscoped to work_dir, stale across runs); the `duration-check` empty-state guards duplicated across two transitions.
4. Duration band sanity — [0.5x, 2.0x] of target; is that the right band, and should a miss loop back to `script-write` instead of `failed`?
5. Dry-run/CI ergonomics — `script_approved=true` and `outline` pre-set paths; document or harden.
6. Error paths into `failed` — which failures are unrecoverable vs retryable.
7. Var sprawl — 20 vars; which are dead or mislayered.

**Proposal format (each entry):** `what` · `why` (evidence: state/transition id) · `effort` (S/M/L) · `ship/defer` recommendation. Ranked by value/effort.

**Anti-patterns (do not do):**
- Do not edit the workflow YAML or any file under audit.
- Do not propose extracting `agent.run` nodes into a skill — that is ticket 0075's scope; overlap findings go there, not here.
- Do not ship anything — proposals only; the operator selects.
### Plan
1. Walk all 14 states + 15 transitions of `kk-solo-podcast.yaml` once, noting candidate findings per state.
2. Apply the seven audit lenses from ## Design; drop non-findings.
3. Cross-check the shared tail against `kk-daily-ai-voice.yaml` (R3).
4. Rank surviving findings by value/effort; write each as what/why/effort/ship-defer.
5. Write the ranked list into ## Solution via `spur task update 0076 --section Solution --from-file`.
6. Verify: `spur task check 0076 --json` → pass; each entry has all four fields.
### Solution
## Resolution — kk-solo-podcast pipeline improvement proposals (2026-08-23)

Ranked by value/effort. `ship` = recommend graduating to an implement ticket under F7; `defer` = record and revisit.


1. **Revise-count file is unscoped and stale across runs** — `.spur/run/$run_id-solo-revise-count` with `__runId` defaulting to `"solo"` (`plugins/kk/workflows/kk-solo-podcast.yaml:189`): one counter shared by every work_dir and every run, never reset, so a prior run's 3 rejections exhaust the next run's budget. *Fix:* scope the counter to `work_dir` (e.g. `${vars.work_dir}/.revise-count`) and reset it in `prepare`. Effort **S**. → **ship**
2. **`wrap-docs` embeds a 20-line inline `bun -e` script in YAML** (`plugins/kk/workflows/kk-solo-podcast.yaml:215-238`) — deterministic logic inlined in the workflow, untestable and unreadable next to the `validate-voicescript.ts` precedent. *Fix:* extract to a sibling helper script (e.g. `wrap-voicescript-doc.ts`) installed with the workflow, resolved the same way as `validate_script`. Effort **S**. → **ship**
3. **`duration-check` has an empty state body; the band check lives in two transition guards with inverted double-negative logic** (`plugins/kk/workflows/kk-solo-podcast.yaml:261-262`, guards at `:320-343`) — the pass/fail guards are duplicated, one asserting success and one asserting failure with mirrored awk. *Fix:* move the band check into `duration-check` `onEnter` (shell), write a marker (e.g. `.duration-ok`), and reduce both guards to a marker test. On miss, route back to `script-write` with feedback (reuse the revise budget) instead of straight to `failed`. Effort **M**. → **ship**


4. **Prompt/validator contract drift in `script-write`** — the inline prompt invents `default_profile` (`plugins/kk/workflows/kk-solo-podcast.yaml:143`) and requires `title`, neither validated by `validate-voicescript.ts`; the prompt omits `speakers`, `crossfade_ms`, `max_chunk_chars` which the contract supports (`plugins/kk/workflows/validate-voicescript.ts:83-86`). *Fix:* covered by ticket 0075's design — the extracted skill embeds the complete contract distilled from `plugins/generations/voice-gen/src/voicescript.ts`. → **ship with 0077**


5. **Duration band [0.5x, 2.0x] is very wide** — a 4–16 min acceptance window on an 8-min target passes obvious misfires. Tighten only after real runs show the natural variance. → **defer** (needs evidence)
6. **No content sanity check between `understand` → `outline-write`** — `expectFile` proves existence only. Defer until a bad briefing is observed in practice. → **defer**
7. **`outline-select` offers option `c` even when only a/b exist** (`plugins/kk/workflows/kk-solo-podcast.yaml:108-116`) — fails loud at `outline-commit`, acceptable UX for now. → **defer**
8. **Dry-run/CI ergonomics are undocumented** — the `script_approved=true` + `outline` pre-set guard paths (`plugins/kk/workflows/kk-solo-podcast.yaml:292-296`) let CI skip both HITL gates, but nothing documents or smoke-tests that path; error paths into `failed` are otherwise fail-loud and acceptable. *Fix:* document the CI invocation in the workflow description or README; optionally add a dry-run smoke test. Effort **S**. → **defer** (documentation, not behavior)
9. **`kk` binary availability not preflighted** — `generate` fails late if `kk` is off PATH. Cheap to add to `prepare`, but the workflow already assumes the kk install. → **defer**


Full walk of all 14 states + 15 transitions of `plugins/kk/workflows/kk-solo-podcast.yaml:1-344`; contract cross-check against `plugins/kk/workflows/validate-voicescript.ts:60-160`; shared-tail cross-check of `plugins/kk/workflows/kk-daily-ai-voice.yaml:68-94` (wrap-docs → generate → quality-control — same pattern, no agent.run nodes, no extraction findings there per scope).


Task status was found externally transitioned to `done` (2026-08-23T22:42Z, by no action of this session) before resolution; this Solution records the actual resolution. Verify verdict is authoritative.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `docs/tasks/0076_audit-kk-solo-podcast-pipeline-for-improvements-beyond-skill.md` Solution Evidence — full walk of 14 states + 15 transitions of `plugins/kk/workflows/kk-solo-podcast.yaml` |
| R2 | MET | Solution proposals 1–3, 5–9 cover the lenses: revise-count brittleness (`plugins/kk/workflows/kk-solo-podcast.yaml:189`), duration-check guard duplication (`:320-343`), band sanity, dry-run ergonomics (`:285-296`), error paths, var sprawl |
| R3 | MET | Solution Evidence — shared tail cross-check of `plugins/kk/workflows/kk-daily-ai-voice.yaml:68-94`; deterministic script step correctly NOT reported as an extraction finding |
| R4 | MET | Solution — 9 ranked proposals each with what/why(evidence)/effort/ship-defer |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: Ranked proposals recorded | MET | command | `rg -c '^[0-9]+\\. \\*\\*' docs/tasks/0076_*.md` → 9 proposals; `rg -c '→ \\*\\*(ship |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Finding | Severity | Disposition |
| --- | --- | --- | --- |
| P1 | None | — | — |
| P2 | Task status was externally transitioned to done before resolution (2026-08-23T22:42Z) | low | Solution + verify verdict recorded post-hoc; content is the gate; disclosed in Solution note |
| P3 | L4 anchor-subject warnings on range citations | info | anchors verified by re-read this session; heuristic wants literal subject text on cited lines |
| P4 | None | — | — |
### References

<!-- Links to docs, examples, related tasks/features, or external references. -->

### History
- 2026-08-23T22:42:08.527Z todo → wip (system)
- 2026-08-23T22:42:14.547Z wip → testing (system)
- 2026-08-23T22:42:14.753Z testing → done (system)
