---
kind: plan
title: G8 implement-ready refinement report
status: accepted
created_at: 2026-10-11
updated_at: 2026-10-11
related: [G8, ADR-035]
---

# G8 ready refinement

Operation: `/sp-dev-refineall --feature G8 --auto --depth ready`. Execution surface: inline.
Frozen order: 0252 → 0253 → 0254 → 0255. No exclusions. No workflow or model subprocess launched.
All four were already todo; priority and estimates are preserved (12 + 8 + 6 + 4 hours).

| Task | Outcome | Corrections | Status | Failed checklist IDs |
|---|---|---:|---|---|
| 0252 | refined | 8 | todo → todo | none |
| 0253 | refined | 7 | todo → todo | none |
| 0254 | refined | 5 | todo → todo | none |
| 0255 | refined | 6 | todo → todo | none |

## Checklist evidence

### 0252

| ID | Pass | Evidence |
|---|---|---|
| requirements | yes | Observable R1-R5 outcomes and explicit non-goals; no execution/edit/definition duplication. |
| design | yes | Task Design plus design section 9 freezes files, types, commands, responses, ownership algorithm and package build. |
| plan | yes | Ordered steps explicitly map to local R-items and end with named behavioral and repository checks. |
| ac | yes | Executable feature-title scenarios bind every local R-item with (req: ...); ac_numbering task-local, graduating feature titles retained. Test lens: capture/reader/collect real-file+HTTP tests and Collect/package browser checks. |
| decisions | yes | Q&A closes Settings reuse, artifacts-only reads, capture revocation, unknown legacy data and optional future audio. |
| dependencies | yes | no predecessor; contracts/capture/build handed to 0253/0254 and then 0255. Persisted frontmatter edges match the frozen topological order. |
| premises | yes | Current preparation/artifact/package symbols, installed Spur 0.4.2 ABI and live list/detail/progress shapes inspected; one main worktree and no wip tasks; dated claim corrections in Background. |

Corrections (also appended to task Background):

- Unverified file-line premises → inspected collectPrepare, lock state, store stdout and CLI registration → replace speculative anchors with current symbol references.
- Current/store projections left open → store-result.json is inserted/updated/unchanged and label-result.txt is aggregate evidence → artifacts-only reader; absent per-label detail stays unavailable.
- New workspace owner treated as sufficient → old files remain until producers finish → revoke old owner and require exact successful producer evidence before serving content.
- Browser identity check alone → reader also needs execution authority → validate project/run via supported Board HTTP APIs in the reader.
- Capture CLI/type names unspecified → frozen section 9 contract → use captureRun and declared run/digest vars without inventing APIs.
- Browser packaging assumed existing staging → CLI prepack only builds CLI/plugins → invoke the shared Bun browser build explicitly from root build and prepack.
- Foundation AC claimed all three modules → daily/ITC implementations depend on this task → final three-module proof belongs solely to 0255; keep Collect foundation observable here.
- Workflow relocation described as future work → symlink and catalog/browser proof already exist → preserve that topology and verify it, do not repeat the move.

### 0253

| ID | Pass | Evidence |
|---|---|---|
| requirements | yes | Observable R1-R5 outcomes and explicit non-goals; no execution/edit/definition duplication. |
| design | yes | Task Design plus design section 9 freezes files, types, commands, responses, ownership algorithm and package build. |
| plan | yes | Ordered steps explicitly map to local R-items and end with named behavioral and repository checks. |
| ac | yes | Executable feature-title scenarios bind every local R-item with (req: ...); ac_numbering task-local, graduating feature titles retained. Test lens: daily projection/browser fixtures plus commands/daily and voice2 DAG regressions. |
| decisions | yes | Q&A closes Settings reuse, artifacts-only reads, capture revocation, unknown legacy data and optional future audio. |
| dependencies | yes | 0252 foundation consumed intact; daily entry/projection handed to 0255. Persisted frontmatter edges match the frozen topological order. |
| premises | yes | Current preparation/artifact/package symbols, installed Spur 0.4.2 ABI and live list/detail/progress shapes inspected; one main worktree and no wip tasks; dated claim corrections in Background. |

Corrections (also appended to task Background):

- DAG fallback left as an implementation-time choice → live installed 0.4.2 progress emits state-oriented rows and orphan-action-row diagnostics → freeze public run-detail node/attempt fallback.
- Daily preparation location/default workspace only loosely identified → prepareAction resolves configured works root which may be outside the checkout → capture that exact child directory at the existing prepare seam.
- Run capture settings and definition unspecified → engine injects __definitionDigest and existing __runId → forward the frozen typed capture inputs and digest-check topology.
- Same-day supersession only checked by owner marker → current producer can still see earlier cached files → require selected-run producer success before displaying artifacts.
- Section audio treated as existing → ADR-034 is accepted design, not required shipped output → show recorded final audio now and sections only if actually described by outputs.
- Acceptance checkbox titles lacked requirement/test binding → executable feature-title scenarios are available → bind every local R item and name its observing test file.
- Dependency referenced a volatile sidecar → frontmatter already depends on 0252 → freeze the exact shared contracts consumed and daily projection handed to 0255.

### 0254

| ID | Pass | Evidence |
|---|---|---|
| requirements | yes | Observable R1-R5 outcomes and explicit non-goals; no execution/edit/definition duplication. |
| design | yes | Task Design plus design section 9 freezes files, types, commands, responses, ownership algorithm and package build. |
| plan | yes | Ordered steps explicitly map to local R-items and end with named behavioral and repository checks. |
| ac | yes | Executable feature-title scenarios bind every local R-item with (req: ...); ac_numbering task-local, graduating feature titles retained. Test lens: ITC projection/browser fixtures plus real ITC/shared prepare regressions. |
| decisions | yes | Q&A closes Settings reuse, artifacts-only reads, capture revocation, unknown legacy data and optional future audio. |
| dependencies | yes | 0252 foundation consumed intact; ITC entry/projection handed to 0255. Persisted frontmatter edges match the frozen topological order. |
| premises | yes | Current preparation/artifact/package symbols, installed Spur 0.4.2 ABI and live list/detail/progress shapes inspected; one main worktree and no wip tasks; dated claim corrections in Background. |

Corrections (also appended to task Background):

- Add __runId only if needed → kk-itc currently declares no run identity → explicitly declare __runId and __definitionDigest for capture.
- Preparation safety not tied to shared callers → prepareWorkspace is shared with solo and has early revise-count behavior → capture only successful ITC preparation and preserve solo/XOR/force semantics.
- External roots described broadly → common reader accepts only an explicitly captured canonical child workspace → reuse 0252 containment and producer proof without an ITC bypass.
- Acceptance checkbox titles lacked requirement/test binding → freeze executable feature-title scenarios and real prep/reader test paths.
- Implicit foundation contract → frontmatter depends on 0252 → consume its types/capture/reader intact and hand only ITC entry/projection fixtures to 0255.

### 0255

| ID | Pass | Evidence |
|---|---|---|
| requirements | yes | Observable R1-R5 outcomes and explicit non-goals; no execution/edit/definition duplication. |
| design | yes | Task Design plus design section 9 freezes files, types, commands, responses, ownership algorithm and package build. |
| plan | yes | Ordered steps explicitly map to local R-items and end with named behavioral and repository checks. |
| ac | yes | Executable feature-title scenarios bind every local R-item with (req: ...); ac_numbering task-local, graduating feature titles retained. Test lens: installed-board Playwright test and separate package test. |
| decisions | yes | Q&A closes Settings reuse, artifacts-only reads, capture revocation, unknown legacy data and optional future audio. |
| dependencies | yes | 0253 and 0254 completed first; transitive 0252 contracts preserved. Persisted frontmatter edges match the frozen topological order. |
| premises | yes | Current preparation/artifact/package symbols, installed Spur 0.4.2 ABI and live list/detail/progress shapes inspected; one main worktree and no wip tasks; dated claim corrections in Background. |

Corrections (also appended to task Background):

- Browser harness deferred to available tooling → Playwright is installed and previous Settings browser proof passed → use Playwright with real installed Board and reader.
- New production diff required even for hardening → acceptance work may correctly need only tests/docs → require durable executable integration evidence; fix source only for demonstrated defects.
- Pack/stage assumed to include UI → existing prepack does not build UI → verify the explicit 0252 build hook from a separate packed install.
- Workflow relocation seemed pending → relative symlink and unchanged file are already present → assert discovery/compatibility without copying or moving again.
- Acceptance checkbox titles lacked requirement/test binding → bind all five local requirements to executable scenarios and package/browser test layers.
- Generic prerequisites and source-import risk → consume completed 0253/0254 and transitive 0252 artifacts only → isolated install proof must run without either checkout or sibling Spur sources.

## Verified source evidence

- `apps/cli/src/cli.ts:createProgram`: existing registration seam.
- `plugins/kk/scripts/kk-workflow-stages.ts:collectPrepare`, `prepareItc`, `prepareWorkspace`: actual workspace/validation callers; collector locking is in the workflow lock state.
- `apps/cli/src/commands/daily.ts:prepareAction`, `runReportAction`: configured external works root and actual report output.
- `apps/cli/src/commands/store.ts:ingestAction`, `sourceCountsOf`: actual stdout counts and metadata.sources attribution.
- Workflow vars inspected: ITC lacks __runId; none of the three declares __definitionDigest yet. Spur injects both in its workflow service.
- Installed @gobing-ai/spur 0.4.2 `board/index.d.ts`, `web/board-runtime.json`: type-only contribution ABI and host React 19.2.1.
- Live project Board /api/runs list/detail/progress shapes match the frozen contract. DAG progress is state-oriented and returns orphan-action-row diagnostics, so run-detail fallback is required.
- `apps/cli/package.json` build:bundle/prepack builds CLI and stages plugins; the browser build must be added explicitly.
- Existing Settings Workflows dropdown, YAML/static graph and relative workflow alias were verified in the preceding change; keep them as the baseline.
- Git has only the main checkout; no wip tasks at admission. Prior authorized uncommitted changes are retained.

## Final gates

Each task passes `spur task check <wbs> --as todo --json`. Dependent-task warnings reflect unfinished prerequisites, not missing specifications. G8 remains backlog and its implementation scenarios remain unverified until actual execution/verification.

The accepted design section 9 is the durable cross-task contract. Raw CLI checks, API shape-only probes, quickReadiness and timestamped event records are under `.spur/run/G8-refine-ready/`; earlier timestamp/latency measurements are unknown rather than reconstructed. The quickReadiness helper was imported read-only from the sibling Spur checkout because it is not an installed public export; no implementation/runtime path depends on that checkout.

No production implementation, generation, publishing or workflow execution was performed. This refinement changes task/document text only; lint/build/full tests passed immediately before it and are not repeated.
