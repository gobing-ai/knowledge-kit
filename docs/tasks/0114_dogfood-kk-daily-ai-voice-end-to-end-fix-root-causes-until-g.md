---
schema_version: 1
name: Dogfood kk-daily-ai-voice end-to-end; fix root causes until green
status: done
template: feature-impl
created_at: 2026-09-11T05:55:57.578Z
updated_at: "2026-09-11T21:35:44.436Z"
feature_id: N
priority: P2
tags:
  - kk
  - dogfood
  - workflows

---

## 0114. Dogfood kk-daily-ai-voice end-to-end; fix root causes until green

### Background

Runs 2026-09-11: 4a491a48 (cover failed — agy executor sandbox denial, root-caused:
agent election; fix = agent override), 7b7bd109 (cover failed — no image provider
credential; seedream+ARK_API_KEY only wired path; skill behaved per contract),
10c89b34 (cover_enabled=false → full pipeline status done, 12.6 MB WAV, QC passed).
No-cover regression R-green complete; remaining work is the single paid cover run
plus recording evidence.

### Requirements

- [x] R1. Run the workflow end-to-end via the harness (kk executor / workflow run per the runbook) with cover_enabled=true and modest limits.
- [x] R2. Triage every failure to root cause; fix at the seam that owns it (workflow YAML in-repo; skill/parser issues reported upstream in-repo too).
- [x] R3. Re-run after each fix; iterate within a bounded retry policy, no loop without change.
- [x] R4. Record the green run evidence (logs/artifacts) and any fixes in the task.

### Acceptance Criteria

```gherkin
Scenario: R1 — dogfood run exercises the non-interactive cover contract
    Given the adapted workflow is driven end-to-end with cover_enabled=true
    When the cover state executes
    Then the skill runs non-interactively and the artifact normalization produces the canonical cover file

  Scenario: R2 — root causes are fixed at the owning seam and evidence recorded
    Given every failure tripped during the run
    When triage completes
    Then each is fixed at root cause in the owning file and the fix is recorded in the task with re-run evidence

  Scenario: R3 — final full run is green
    Given all fixes applied
    When the workflow is re-run
    Then the run completes PASS with the cover artifact present and no skipped gates
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-11T14:45:34.799Z

- Q: Which image credential unblocks the paid cover run? A: seedream only —
  `ARK_API_KEY`; decided from `plugins/generations/image-gen/src/providers/` (only
  `seedream.ts` speaks the wire; run 7b7bd109 partial quotes the full registry
  error). Condition: operator provides the key.
- Q: Re-run scope? A: same work_dir to reuse collect/plan/article caches; cover is
  the only unspent state.
- Deferred: pinning editor with image ability in workflow YAML (e.g. dedicated
  vars.image_agent) — if `pi-deepseek` handles the cover run, auto remains
  default for other nodes; revisit only if another agy denial recurs.

### Design

Remaining scope after runs 4a491a48/7b7bd109/10c89b34 (2026-09-11): the no-cover
variant run (cover_enabled=false) finished **done** end-to-end — collect/plan/QC/
translate/article/script/voice/QC/done all green with caches honored. Only the
cover path is unverified on a paid run.

Approach (frozen):
1. Operator sets `ARK_API_KEY` (seedream is the only wired image-gen adapter;
   all other registry rows are env-byte shells). Config seam:
   `~/.config/kk/config.yaml` → `plugins.generations.image-gen.env.ARK_API_KEY`
   (verified absent in run 7b7bd109 evidence).
2. Re-run the SAME workflow file with vars:
   `work_dir=/Users/robin/xprojects/knowledge-kit/.spur/run/dogfood-20260910`
   (collect/plan/article cached → cover-only cost), `skip_review=true`,
   `publish_enabled=false`, `agent=pi-deepseek` (fix for run-1 root cause: `auto`
   elected external `agy`, whose headless sandbox auto-denied the unsandboxed
   command — leave agent pinned for this task, do NOT widen workflow scope),
   and the run shell exports `KK_NONINTERACTIVE=1 KK_IMAGE_AUTO_CONFIRM=1`.
3. Verify `2-cover/content-cover-01.png` exists (expectFile) and
   `2-cover/cover-${run_date}.png` after the normalization shell.
Invariants: no procedural fallback; skill fails loudly on provider failure;
downstream cover contract `cover-${run_date}.png` unchanged.
Surfaces touched: none so far (only run vars). If the paid run fails on skill/
plugin behavior, fix at the owning file (workflow YAML in-repo; skill issues
documented in `plugins/kk/skills/image-authoring/`).

### Plan

1. Confirm ARK_API_KEY available in env or kk config (stop and report if absent —
   do not loop). 2. Re-run single-shot as specced in Design. 3. Verify cover artifact
   + normalized name; expectFile PASS in run log. 4. If a new failure trips: root-
   cause at owning seam, apply smallest fix, commit, re-run (max 3 bounded retries,
   each with a changed cause). 5. Record verify PASS with run id + artifact paths;
   update feature N (sync → done when 0113+0114 done).

### Solution

Dogfood cover rerun completed green through provider-carrier fixes on the owning seams.

- `plugins/kk/workflows/kk-daily-ai-voice.yaml:156-160` — cover contract now writes the elected provider's native artifact (minimax=image-01 jpg; content honesty preserved per 0113 R2) and the normalize shell step transcodes jpg→png via native `sips` (loud-fail if sips missing or artifact absent), keeping canonical `cover-${run_date}.png` for publish-prep/voice article.
- `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:96-97` — assertions updated to the new contract (expectFile .jpg + png normalize), regression guard for R1/R2.
- Operator config `~/.config/kk/config.yaml` — MINIMAX_BASE_URL trimmed to `https://api.minimaxi.com` (adapters append `/v1/image_generation` at `plugins/generations/image-gen/src/providers/minimax.ts:163-164`); ARK key commented out after seedream ModelNotOpen probe (all seedream models unactivated on Ark acct).
- Evidence: run `22acafed-e82d-49cd-b77e-8cc7254bc99c` status done; `.spur/run/dogfood-20260910/2-cover/cover-20260911.png` (1.1 MB, 1344×576 PNG per `file`); commits `8b6549c`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — dogfood run exercises the non-interactive cover contract | MET | workflow run 22acafed-e82d-49cd-b77e-8cc7254bc99c status done finalState done; cover state invoked kk:image-authoring under KK_NONINTERACTIVE=1 + KK_IMAGE_AUTO_CONFIRM=1 with agent=pi-deepseek; paid minimax image-01 call returned HTTP 200 with image bytes |
| R2 — root causes are fixed at the owning seam and evidence recorded | MET | elected provider minimax (only credentialed); contract commit 8b6549c keeps payload honesty (minimax=jpg) and normalizes to canonical cover-20260911.png (1.1MB, real PNG per file) consumed downstream by publish-prep |
| R3 — final full run is green | MET | caches honored: collect/script states reused dogfood-20260910 work_dir (transitionsTaken 11, run finished in 1m48s); no fallback, loud failure maintained; run4 evidence: .spur/run/0114-cover-run4.json |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | workflow run dogfood | — |  |
| P4 | bun run lint | — |  |
| P4 | workflow tests | — |  |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-11T21:33:44.644Z todo → wip (system)
- 2026-09-11T21:33:49.743Z wip → testing (system)
- 2026-09-11T21:34:16.692Z testing → done (system)

