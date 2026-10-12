---
schema_version: 1
name: Register the G14 documents in the API/library claim registry and write their claim blocks
status: todo
template: feature-impl
created_at: 2026-10-12T20:56:07.264Z
updated_at: "2026-10-12T21:56:57.335Z"
feature_id: G14

priority: P3
ac_altitude: task-local
estimate_hours: 1
---

## 0263. Register the G14 documents in the API/library claim registry and write their claim blocks

### Background

The `api-library-claim-citation` rule has two arms: a row-level arm (every claim row cites a source and earns its `HIGH|MEDIUM|LOW`) and a presence arm over a declared registry of documents whose API/library claims are load-bearing (`.spur/rules/structure/api-library-claim-citation.yaml`, one `--require-block=<path>` per document). The registry lists the board/G8 delivery plus the numbered docs it touched (`docs/design/workflow-board-modules.md`, `docs/00_ADR.md`, `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, tasks 0252–0255), so G14 is ungated: of its four documents only 0256 carries an `API/library claim sources and confidence` block (`docs/tasks/0256_…md:86`), while `docs/design/voxcpm-daily-voice-driver.md`, 0257 and 0258 assert voxcpm 2.0.3 / Hub / `torch.manual_seed` behaviour with nothing cited.

Prepared and dry-run validated, never applied: `.spur/run/g14-claim-registry-followup/PLAN.md` holds the four registry lines, the three draft blocks (`drafts/voxcpm-daily-voice-driver.block.md`, `drafts/0257.block.md`, `drafts/0258.block.md`) and the apply checklist. The drafts were validated against staged copies at HEAD 3562c6c0 (checker exit 0 with the three blocks present; three falsification controls each exit 1 — an emptied `HIGH` Source cell, a level outside the enum, a declared document with no block). `.spur/run/` is gitignored scratch: if the drafts are gone at apply time, re-author the rows from the Design's anchor table.

It was deferred, not skipped: a task file's content is inside the proof digest, so 0256 could not be written while its run was live, and `.spur/rules/` is tracked, so an in-flight edit there would have broken the batch's fast-forward landing. The landing blocker is gone (08689ca5 is an ancestor of `main`); the digest hazard is not fully gone — see the 2026-10-12 corrections.

**Refine corrections (2026-10-12)**
- "The registry lists only the board/G8 delivery (design doc + 0252–0255)" → it also lists `docs/00_ADR.md`, `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md` (9 entries) → restated above; the four G14 lines are appended after the existing nine, none removed.
- "Both blockers are now gone" → 0256 and 0257 are `done`, but 0258 is still `todo`; writing 0258's file while a 0258 run is live would invalidate that run's proof digest → Plan step 0 checks 0258 has no live run (status `backlog`/`todo`, or `done`) before writing its block; if a run is live, wait for it to land.
- Drafted anchors drifted after the G14 landing (verified at bd537df5): `daily-stages.ts:576` is now an ffprobe comment (`dailyGenerate` is at `:680`), `:976` → `dailyIntro` at `:1123`, `:1160` → `dailyPublishPrep` at `:1307`; `kk-daily-ai-voice.yaml:416/:424` are `options:` lines (the `daily-intro` / `daily-episode-duration` commands are at `:418` / `:426`); `voxcpm-daily-voice-driver.md:44` is an executor-path sentence (the "VoxCPM never probes Gemini" clause is at `:94`) → corrected anchor table in Design.
- Two draft rows cite `0256_…md:92` for the uv pin and the Hub snapshot call; that line is the client-controls row, and both artifacts have since shipped → re-pointed to `plugins/generations/voxcpm-tts/pyproject.toml:5-6` and `plugins/generations/voxcpm-tts/python/worker.py:195`.
- Still-valid anchors confirmed unchanged: `daily-stages.ts:529` (`MP3_TRUTHY`), `:539` (`ensurePublishMp3`), `voice-gen/src/index.ts:98/:220/:243`, `qc.ts:20`, `concat.ts:14`, `executor.ts:10/:47`, `voicebox-client.ts:1`; `gemini-tts/src` contains no `seed`. The row checker exits 0 on the current tree.

### Requirements

- [ ] R1. Append the four G14 `--require-block=` lines (design doc, 0256, 0257, 0258) to the `api-library-claim-block-required` arm's `args`, keeping the existing nine entries.
- [ ] R2. Write the three missing blocks — `docs/design/voxcpm-daily-voice-driver.md` (`#### API/library claim sources and confidence`), 0257 and 0258 (`### API/library claim sources and confidence`) — from the drafted rows with every anchor taken from the Design's corrected table.
- [ ] R3. Every row earns its level: `HIGH` cites an http(s) URL or a `path:line`; `MEDIUM`/`LOW` cite evidence or name the unverified gap. No row claims a level it cannot support, and no block ships empty.
- [ ] R4. Re-run the row checker, the falsification controls and the project pre-check gate; record the outputs in `## Testing`.

Out of scope: any change to the rule's checker, its test script, or the first (row-level) arm; editing existing prose in the design doc or task files; re-fetching upstream Hub / PyPI APIs; adding blocks to any non-G14 document.

### Acceptance Criteria

- [ ] AC1 — The registry lists all four G14 documents and the checker exits 0 with them declared. (req: R1, R2)
- [ ] AC2 — Falsification: with one G14 block removed, or with a `HIGH` row's Source cell emptied, the checker exits 1. (req: R2, R3)
- [ ] AC3 — `bun run test-pre-check` is green with the registry lines in place. (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-12T21:56:51.187Z

- **Is 0258 safe to write while it is `todo`?** Closed: yes, before its run starts or after it lands; never during a live run (proof digest). Encoded as Plan step 0.
- **Uv pin row level.** Closed: `HIGH` for the pin (`pyproject.toml:5-6` now ships); lock contents beyond the pin are not audited by this task and the cell says so.
- **Hub row level.** Closed: stays `MEDIUM` — the call site is local evidence, the upstream signature is not re-fetched here.

### Design

**WHAT.** Two kinds of edit, no new API: four registry lines in `.spur/rules/structure/api-library-claim-citation.yaml` (rule id `api-library-claim-block-required`) and three claim blocks. The rule, `api-library-claim-citation.sh` and its `.test.sh` already exist and pass — this task makes them binding for G14.

**WHY.** G14's claims about voxcpm 2.0.3, the Hub snapshot call, `torch.manual_seed`, CLI flags and env budgets are load-bearing and externally changeable; today nothing gates them.

**WHERE (frozen file targets).**
- `.spur/rules/structure/api-library-claim-citation.yaml` — append, after the 0255 line:
  `--require-block=docs/design/voxcpm-daily-voice-driver.md`,
  `--require-block=docs/tasks/0256_add-standalone-voxcpm-generator-using-the-shared-voice-pipel.md`,
  `--require-block=docs/tasks/0257_wire-voxcpm-into-both-daily-workflows-with-driver-aware-audi.md`,
  `--require-block=docs/tasks/0258_compare-voxcpm-and-gemini-daily-audio-with-recorded-quality-.md`.
- `docs/design/voxcpm-daily-voice-driver.md` — append the `####` block at the end; existing prose untouched.
- 0257 / 0258 task files — add the `###` block as its own section after `### References`. 0256 is registered only (its block exists at `:86`).

**Corrected anchor table (verified at bd537df5; re-run `sed -n '<n>p'` on each before writing, since unrelated commits may move them again).**

| Draft anchor | Use instead | What is there |
| --- | --- | --- |
| `plugins/kk/scripts/daily-stages.ts:576` | `:680` | `export function dailyGenerate` (the `metadata.segments` join rebuild is inside it, `:799-852`) |
| `daily-stages.ts:976` | `:1123` | `export function dailyIntro` |
| `daily-stages.ts:1160` | `:1307` | `export function dailyPublishPrep` |
| `.spur/workflows/kk-daily-ai-voice.yaml:416` / `:424` | `:418` / `:426` | `kk stage daily-intro …` / `kk stage daily-episode-duration …` |
| `docs/design/voxcpm-daily-voice-driver.md:44` | `:94` | "VoxCPM never probes Gemini or silently falls back" |
| `0256_…md:92` (uv pin row) | `plugins/generations/voxcpm-tts/pyproject.toml:5` | `requires-python = "==3.12.*"`, `voxcpm==2.0.3` at `:6` — the pin is now `HIGH`; lock contents beyond the pin stay unverified, say so in the cell |
| `0256_…md:92` (Hub row) | `plugins/generations/voxcpm-tts/python/worker.py:195` | `snapshot_download(repo_id=model_id)` — call site `HIGH`; upstream Hub signature not re-fetched ⇒ row stays `MEDIUM` with that gap named |
| `gemini-tts/src/index.ts:1` (seed row) | keep, and add `voxcpm-tts/python/worker.py:246` | `torch.manual_seed(int(seed))`; gemini-tts has no `seed` |

Unchanged and valid: `daily-stages.ts:529/:539`, `voice-gen/src/index.ts:98/:220/:243`, `qc.ts:20`, `concat.ts:14`, `apps/cli/src/commands/executor.ts:10/:47`, `voicebox-client.ts:1`, both upstream URLs.

**Anti-patterns.** Do not raise a row to `HIGH` without a `path:line`/URL that shows the claim; do not cite a reproducible command as the source (the rule rejects it by design); do not remove or reorder existing registry lines; do not touch the checker to make a row pass; do not write 0258's file while a 0258 run is live (proof digest).

**Dependencies / handoffs.** Assumes 0256/0257 `done` (true). 0258 is `todo`: its block describes code that already exists, so it may be written before 0258 runs, but never during. No dependent tasks.

**Budget.** ~1 h, `mutationPolicy: edit` on the four files above only.

### Plan

- [ ] Step 0 (precondition): `spur task show 0258 --json` — status is not `wip`/`testing`/`review` and no 0258 workflow run is live; `git status` shows no pending edits to the four target files.
- [ ] R2: Re-verify every anchor in the Design table with `sed -n '<n>p' <file>`; patch the drafts accordingly (or re-author from the table if `.spur/run/g14-claim-registry-followup/drafts/` is gone).
- [ ] R2/R3: Insert the design-doc `####` block and the 0257/0258 `###` blocks.
- [ ] R1: Append the four `--require-block=` lines to the second arm.
- [ ] AC1: `sh .spur/rules/structure/api-library-claim-citation.sh` with the yaml's full `--require-block` list → exit 0.
- [ ] AC2: falsification on scratch copies under `.spur/run/` — (a) a G14 document with its block removed declared via `--require-block` → exit 1; (b) a `HIGH` row with an emptied Source cell → exit 1. Paste both outputs.
- [ ] AC3/R4: `bun run test-pre-check` → exit 0; then `sh .spur/rules/structure/api-library-claim-citation.test.sh` stays green. Record all outputs in `## Testing`.
- [ ] Commit the four files as one commit: `docs(rules): put the G14 API/library claims under the citation registry`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-12T21:56:57.335Z backlog → todo (system)

