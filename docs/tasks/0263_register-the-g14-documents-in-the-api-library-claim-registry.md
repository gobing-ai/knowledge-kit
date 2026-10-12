---
schema_version: 1
name: Register the G14 documents in the API/library claim registry and write their claim blocks
status: backlog
template: feature-impl
created_at: 2026-10-12T20:56:07.264Z
updated_at: "2026-10-12T20:56:33.412Z"
feature_id: G14

---

## 0263. Register the G14 documents in the API/library claim registry and write their claim blocks

### Background

The `api-library-claim-citation` rule has two arms: a row-level arm (every claim row cites a source and earns its `HIGH|MEDIUM|LOW`) and a presence arm over a declared registry of documents whose API/library claims are load-bearing (`.spur/rules/structure/api-library-claim-citation.yaml`, one `--require-block=<path>` per document). The registry lists only the board/G8 delivery (`docs/design/workflow-board-modules.md`, tasks 0252–0255), so G14 is ungated: of its four documents only 0256 carries an `API/library claim sources and confidence` block, while `docs/design/voxcpm-daily-voice-driver.md`, 0257 and 0258 assert voxcpm 2.0.3 / Hub / `torch.manual_seed` behaviour with nothing cited.

Prepared and dry-run validated, never applied: `.spur/run/g14-claim-registry-followup/PLAN.md` holds the four registry lines, the three draft blocks (`drafts/voxcpm-daily-voice-driver.block.md`, `drafts/0257.block.md`, `drafts/0258.block.md`) and the apply checklist with the anchor list. The drafts were validated against staged copies at HEAD 3562c6c0 (checker exit 0 with the three blocks present; three falsification controls each exit 1 — an emptied `HIGH` Source cell, a level outside the enum, a declared document with no block).

It was deferred, not skipped: a task file's content is inside the proof digest, so 0256 could not be written while its run was live, and `.spur/rules/` is tracked, so an in-flight edit there would have broken the batch's fast-forward landing. Both blockers are now gone (the G14 batch is merged into `main` at 08689ca5).

### Requirements

- [ ] R1. Add the four G14 `--require-block=` registry lines (design doc, 0256, 0257, 0258) to the presence arm.
- [ ] R2. Write the missing blocks — the design doc (`#### API/library claim sources and confidence`), 0257 and 0258 (`###`) — reusing the drafted rows and re-grounding every cited anchor at apply time.
- [ ] R3. Every row earns its level: `HIGH` cites an http(s) URL or a `path:line`; `MEDIUM`/`LOW` cite evidence or name the unverified gap. No row claims a level it cannot support, and no block ships empty.
- [ ] R4. Re-run the row checker, the falsification controls and the project gate; record the outputs in `## Testing`.

### Acceptance Criteria

- [ ] AC1 — The registry lists all four G14 documents and the checker exits 0 with them declared. (req: R1)
- [ ] AC2 — Falsification: with one G14 block removed, or with a `HIGH` row's Source cell emptied, the checker exits 1. (req: R2, R3)
- [ ] AC3 — `bun run test-pre-check` (or `spur rule run --preset recommended-pre-check`) is green with the registry lines in place. (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Scope is two edits plus three block insertions, exactly as the prepared plan lays out. No new rule and no new checker: the rule and `api-library-claim-citation.sh` already exist and already pass — this task makes them binding for G14.

Apply order (anchors drift, so the block text is re-grounded before it is written):

1. Re-verify every `path:line` the drafts cite. 0257/0258 landed in the G14 batch and their implement/record stages moved lines: `plugins/kk/scripts/daily-stages.ts:529/539/576/976/1160`, `plugins/generations/voice-gen/src/index.ts:98/220/243`, `apps/cli/src/commands/executor.ts:10/47`, `plugins/generations/voice-gen/src/qc.ts:20`, `plugins/generations/voice-gen/src/concat.ts:14`, `.spur/workflows/kk-daily-ai-voice.yaml:416/424`.
2. Insert the three blocks and add the four registry lines to the presence arm's `args` in `.spur/rules/structure/api-library-claim-citation.yaml`.
3. Run `sh .spur/rules/structure/api-library-claim-citation.sh` plus the falsification controls, then the gate.
4. One commit: `docs(rules): put the G14 API/library claims under the citation registry`.

Leave the design doc's existing prose unchanged; only the block is added. A claim the session could not ground stays `MEDIUM`/`LOW` with its gap named — for example the Hub snapshot signature and the uv lock contents are not re-fetched by this task.

### Plan

- [ ] R1/R2: Re-ground the drafted anchors, insert the three blocks, add the four registry lines.
- [ ] R2/R3: Run the row checker with the three blocks present plus the three falsification controls; paste the outputs.
- [ ] R4: Run the project gate and record it; commit the whole change as one `docs(rules)` commit.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
