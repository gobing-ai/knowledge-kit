---
schema_version: 1
name: Dogfood kk-daily-ai-voice end-to-end; fix root causes until green
status: todo
template: feature-impl
created_at: 2026-09-11T05:55:57.578Z
updated_at: "2026-09-11T14:45:44.320Z"
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

- R1. Run the workflow end-to-end via the harness (kk executor / workflow run per the runbook) with cover_enabled=true and modest limits.
- R2. Triage every failure to root cause; fix at the seam that owns it (workflow YAML in-repo; skill/parser issues reported upstream in-repo too).
- R3. Re-run after each fix; iterate within a bounded retry policy, no loop without change.
- R4. Record the green run evidence (logs/artifacts) and any fixes in the task.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

Pending — filled by task record during verification (step 5 of Plan).

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
