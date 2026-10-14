---
schema_version: 1
name: Register the G14 documents in the API/library claim registry and write their claim blocks
status: done
template: feature-impl
created_at: 2026-10-12T20:56:07.264Z
updated_at: "2026-10-14T02:55:26.164Z"
feature_id: G14

priority: P3
ac_altitude: task-local
estimate_hours: 1
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0263-verdict.json
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

- [x] R1. Append the four G14 `--require-block=` lines (design doc, 0256, 0257, 0258) to the `api-library-claim-block-required` arm's `args`, keeping the existing nine entries.
- [x] R2. Write the three missing blocks — `docs/design/voxcpm-daily-voice-driver.md` (`#### API/library claim sources and confidence`), 0257 and 0258 (`### API/library claim sources and confidence`) — from the drafted rows with every anchor taken from the Design's corrected table.
- [x] R3. Every row earns its level: `HIGH` cites an http(s) URL or a `path:line`; `MEDIUM`/`LOW` cite evidence or name the unverified gap. No row claims a level it cannot support, and no block ships empty.
- [x] R4. Re-run the row checker, the falsification controls and the project pre-check gate; record the outputs in `## Testing`.

Out of scope: any change to the rule's checker, its test script, or the first (row-level) arm; editing existing prose in the design doc or task files; re-fetching upstream Hub / PyPI APIs; adding blocks to any non-G14 document.

### Acceptance Criteria

- [x] AC1 — The registry lists all four G14 documents and the checker exits 0 with them declared. (req: R1, R2)
- [x] AC2 — Falsification: with one G14 block removed, or with a `HIGH` row's Source cell emptied, the checker exits 1. (req: R2, R3)
- [x] AC3 — `bun run test-pre-check` is green with the registry lines in place. (req: R4)

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

- [x] Step 0 (precondition): `spur task show 0258 --json` — status is not `wip`/`testing`/`review` and no 0258 workflow run is live; `git status` shows no pending edits to the four target files.
- [x] R2: Re-verify every anchor in the Design table with `sed -n '<n>p' <file>`; patch the drafts accordingly (or re-author from the table if `.spur/run/g14-claim-registry-followup/drafts/` is gone).
- [x] R2/R3: Insert the design-doc `####` block and the 0257/0258 `###` blocks.
- [x] R1: Append the four `--require-block=` lines to the second arm.
- [x] AC1: `sh .spur/rules/structure/api-library-claim-citation.sh` with the yaml's full `--require-block` list → exit 0.
- [x] AC2: falsification on scratch copies under `.spur/run/` — (a) a G14 document with its block removed declared via `--require-block` → exit 1; (b) a `HIGH` row with **both** citation cells emptied → exit 1 (measured: emptying only the Source cell exits 0, because the checker accepts a citation in either citation column — `api-library-claim-citation.sh:150`). Paste both outputs.
- [x] AC3/R4: `bun run test-pre-check` → exit 0; then `sh .spur/rules/structure/api-library-claim-citation.test.sh` stays green. Record all outputs in `## Testing`.
- [x] Commit the four files as one commit: `docs(rules): put the G14 API/library claims under the citation registry`.

### Solution

Two kinds of edit, no new API — G14's claims become binding in the existing citation registry.

| Change | file:line | Rationale |
| --- | --- | --- |
| Four `--require-block=` registry lines appended after the 0255 entry | `.spur/rules/structure/api-library-claim-citation.yaml:83` | Design + 0256 + 0257 + 0258 now declare the presence arm's documents; the eight pre-existing entries are untouched |
| Design-doc claim block (`####`) appended at the end | `docs/design/voxcpm-daily-voice-driver.md` | 7 rows; existing prose byte-unchanged |
| 0257 claim block (`###`) inserted before `### History` | `docs/tasks/0257_wire-voxcpm-into-both-daily-workflows-with-driver-aware-audi.md` | 7 rows |
| 0258 claim block (`###`) inserted before `### History` | `docs/tasks/0258_compare-voxcpm-and-gemini-daily-audio-with-recorded-quality-.md` | 7 rows |
| 0256 registered only | `docs/tasks/0256_add-standalone-voxcpm-generator-using-the-shared-voice-pipel.md` | its block already ships at line 86; nothing written |

**Anchors re-verified against this tree's HEAD before writing** (the Design's corrected table; every
`sed -n '<n>p'` read confirmed the claimed subject): in `plugins/kk/scripts/daily-stages.ts` the
stage entries moved to `:680` (`dailyGenerate`), `:1123` (`dailyIntro`) and `:1307`
(`dailyPublishPrep`); `.spur/workflows/kk-daily-ai-voice.yaml` runs `daily-intro` at `:418` and
`daily-episode-duration` at `:426`; the design clause "VoxCPM never probes Gemini or silently falls
back" sits at `docs/design/voxcpm-daily-voice-driver.md:94`; the two 0256 rows were re-pointed at the
shipped artifacts — the interpreter and package pin at
`plugins/generations/voxcpm-tts/pyproject.toml:5` (HIGH, pin now shipped) and the Hub download call
at `plugins/generations/voxcpm-tts/python/worker.py:195` (MEDIUM, upstream signature not
re-fetched); the seed row points at the Gemini request construction in
`plugins/generations/gemini-tts/src/gemini-client.ts:166` and at the backend seed call in
`plugins/generations/voxcpm-tts/python/worker.py:246`; the shared client contract names
`plugins/generations/voice-gen/src/voicebox-client.ts:36` (`VoiceboxClient`) and
`plugins/generations/voice-gen/src/index.ts:41` (`processGeneratorIO`). Unchanged and re-confirmed:
`plugins/kk/scripts/daily-stages.ts:529`, `plugins/kk/scripts/daily-stages.ts:539`,
`plugins/generations/voice-gen/src/index.ts:98`, `plugins/generations/voice-gen/src/index.ts:220`,
`plugins/generations/voice-gen/src/index.ts:243`, `plugins/generations/voice-gen/src/qc.ts:20`,
`plugins/generations/voice-gen/src/concat.ts:14`, `apps/cli/src/commands/executor.ts:10`,
`apps/cli/src/commands/executor.ts:47`, both upstream URLs.

**Falsification control (b) needs both citation cells emptied, not only the Source cell.** The
checker's earnedness arm reads `cited = is_cite($3) || is_cite($4)` in
`.spur/rules/structure/api-library-claim-citation.sh` (line 150), so a HIGH row whose Source cell is
emptied but whose Local-verification cell still carries a `path:line` is not a finding. Verified:
emptying only the Source cell of the `withRunOptions` row leaves exit 0; emptying both cells exits 1
(`HIGH claim cites no source`). The checker itself is out of scope for this task and was not
changed — the control was run in its effective form and the nuance is recorded in `## Testing`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `sh .spur/rules/structure/api-library-claim-citation.sh` with all 12 `--require-block` args → exit 0; the four new lines sit after the 0255 entry at `.spur/rules/structure/api-library-claim-citation.yaml:83-86` and the eight pre-existing entries are byte-unchanged. |
| R2 | MET | Blocks written at `docs/design/voxcpm-daily-voice-driver.md:154`, `docs/tasks/0257_wire-voxcpm-into-both-daily-workflows-with-driver-aware-audi.md:228` and `docs/tasks/0258_compare-voxcpm-and-gemini-daily-audio-with-recorded-quality-.md:198`; 0256 keeps its pre-existing block at `docs/tasks/0256_add-standalone-voxcpm-generator-using-the-shared-voice-pipel.md:86`. Every `path:line` was re-read with `sed -n '<n>p'` in this tree before the write. |
| R3 | MET | HIGH rows cite a URL or `path:line`; the two MEDIUM rows name their gap (`docs/design/voxcpm-daily-voice-driver.md:161-162` rows "lock contents beyond the pin are not audited" and "upstream Hub API not re-fetched for this document"). No block is empty (checker: no "no data row" finding). |
| R4 | MET | Checker exit 0; control (a) exit 1, control (b) exit 1; `sh .spur/rules/structure/api-library-claim-citation.test.sh` → 18 passed / 0 failed (re-run this session); `bun run test-pre-check` → all 59 rules passed. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | `grep -oE '\-\-require-block=[^"]+' .spur/rules/structure/api-library-claim-citation.yaml \| wc -w` → 12; `sh .spur/rules/structure/api-library-claim-citation.sh <all 12>` → exit 0, no findings. |
| AC2 | MET | command | Control (a): `.spur/run/0263-falsification/design-no-block.md` declared via `--require-block` → exit 1 ("carries no `API/library claim sources and confidence` block"). Control (b): `.spur/run/0263-falsification/0258-no-citation.md`, HIGH row with **both** citation cells emptied → exit 1 ("HIGH claim cites no source"). Measured nuance: emptying only the Source cell while `Local verification` still carries `apps/cli/src/commands/executor.ts:47` exits 0, because the checker reads `cited = is_cite($3) \|\| is_cite($4)` (`.spur/rules/structure/api-library-claim-citation.sh:153`) — the row still cites an openable artifact, which is the arm's contract. The checker is out of this task's scope and was not modified; the rule's own 18 cases cover the same "no citation anywhere" defect and stay green. |
| AC3 | MET | command | `bun run test-pre-check` → exit 0, "All 59 rules passed — no violations found" (re-observed in this session's `bun run gate`) (full log `.spur/run/verify-g11-g14-gate.log`, `exit=0`). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0263

**Scope:** `.spur/rules/structure/api-library-claim-citation.yaml` (4 registry lines) · `docs/design/voxcpm-daily-voice-driver.md` (block only) · `docs/tasks/0257_…md`, `docs/tasks/0258_…md` (blocks only) · `## Solution` on this task file
**Dimensions:** functional, correctness, usability, architecture (documentation/rule-registry change; no runtime code)
**Verdict:** PASS
**Confidence:** HIGH — every anchor was re-read with `sed -n '<n>p'` in this tree before the block was written, and every claim is backed by a command run here: the checker with the full 12-entry registry (exit 0), both falsification controls, the rule's own 18-case suite (18 passed / 0 failed), and `bun run test-pre-check` (59 rules passed).

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | correctness | The rule's stated contract and its implementation differ on ONE point: the yaml comment says "a row claiming HIGH with an empty Source cell" is the defect, but the checker accepts a citation in either citation column (`cited = is_cite($3) || is_cite($4)`), so emptying only the Source cell leaves the row valid when Local verification still carries a `path:line`. AC2's second control was therefore run in its effective form (both citation cells emptied → exit 1) and the single-cell variant was measured too (exit 0). The checker is out of this task's scope and was not changed; the asymmetry is disclosed in `## Testing` and in the `## Solution` write. | `.spur/rules/structure/api-library-claim-citation.sh:150` | ACCEPTED — reported, checker untouched |
| 2 | P4 (advisory) | usability | The pre-validated drafts lived on the scratch plane of the invoking tree (`.spur/run/g14-claim-registry-followup/drafts/`), which the batch worktree does not carry: the run read them from the invoking tree and re-verified every anchor locally before use. A future apply that starts from a fresh worktree must re-author from the Design table (the task's own fallback). | `.spur/run/g14-claim-registry-followup/drafts/` | ACCEPTED |
| 3 | P4 (advisory) | architecture | The registry is a hand-maintained `args` list; appending four lines for one delivery is mechanical but scales with deliveries, not with claims. Out of scope here (the rule, its checker and the arms are frozen) — recorded for the rule's owner. | `.spur/rules/structure/api-library-claim-citation.yaml:75-86` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Four lines appended after the 0255 entry; the eight pre-existing entries are byte-unchanged (`.spur/rules/structure/api-library-claim-citation.yaml:83`) |
| R2 | MET | Three blocks written — design doc `:154` (`####`), 0257 `:228`, 0258 `:162` (`###`); every row cites with a re-verified anchor, 0256 untouched beside its pre-existing block at `:86` |
| R3 | MET | Each row earns its level: HIGH rows carry a URL or `path:line`; the two HMAC-free MEDIUM rows name their gap ("lock contents not audited", "upstream Hub not re-fetched") |
| R4 | MET | Checker with the full registry exit 0; both falsification controls exit 1 (the single-cell variant measured and disclosed); `api-library-claim-citation.test.sh` 18 passed / 0 failed; `bun run test-pre-check` all 59 rules passed |

**Next:** no open P1–P3; proceed to verify. Finding 1 is a documentation-vs-implementation nuance in a frozen checker, not a defect in this change set.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-12T21:56:57.335Z backlog → todo (system)
- 2026-10-12T22:56:06.492Z todo → wip (system)
- 2026-10-12T23:05:37.069Z wip → testing (system)
- 2026-10-12T23:07:15.388Z testing → done (system)

