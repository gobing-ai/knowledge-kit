---
schema_version: 1
name: Repair plugin packaging, execution contracts, cancellation, and retry integrity
status: done
template: issue
created_at: 2026-09-10T17:38:09.598Z
updated_at: "2026-09-10T19:07:29.512Z"

priority: P1
feature_id: L
ac_numbering: task-local
ac_altitude: task-local
---

## 0110. Repair plugin packaging, execution contracts, cancellation, and retry integrity

### Background

Consolidated remediation task requested by Robin on 2026-09-10 after an inline architecture
review of repository `.` at Git HEAD `02b5dd2` (full revision must be rechecked before fixing).
The review found four architectural boundary failures; follow-up probes reproduced three
additional implementation failures on the same source. All seven are OPEN. Creating this task
and updating documentation does not implement or verify the repairs.

Scope is deliberately one issue task spanning the existing distribution, executor, and retry
boundaries. Related work includes B7 discovery/distribution (0053), B6 fan-out (0043), L1
source execution (0092), timeout overrides (0099), podcast show-notes (0095), and the generic
array-input/output exceptions introduced in 0100/0101. These are provenance references, not
new dependencies or a reason to reopen completed historical tasks. Active feature L (daily AI
voice pipeline) provides the traceability home for the affected end-to-end consumer. Task-local
AC retain the full cross-feature packaging/executor/publishing scope. Feature B is historically
done; its attempted link was rejected by the terminal-feature check and replaced with L rather
than reopening completed platform work. No existing feature status changes in this capture.

| ID | Priority / severity | Issue | Observable failure |
| --- | --- | --- | --- |
| I1 | P1 / major architecture | Shipped plugin dependency closure | Isolated core-facts-gen entry cannot import private kk-core |
| I2 | P1 / major architecture | Timeout does not own descendants | Wrapper times out; descendant later writes a file |
| I3 | P1 / major architecture | Podcast-specific operation weakens every publisher | Arbitrary nonempty output accepted for unrelated publisher with Doc[] input |
| I4 | P2 / minor architecture | Retry drops target artifact metadata | Successful Surfdash target loses postPath needed by locale scaffolding |
| I5 | P1 / implementation | Stale output accepted as fresh success | No-op generator returns 0 using an old valid Content file |
| I6 | P1 / implementation | Domain failure ignored by single invocation | Result with ok:false is accepted when child exits 0 |
| I7 | P1 / implementation | Narrow retry loses unresolved failures | Retry A succeeds; unselected failed B disappears; aggregate reports success |

Current code already has useful seams: kindContract, spawnPluginEntry/Async, fanout's injectable
dispatch, filesystem adapters, and direct plugin IO validation. Repair these owners rather than
adding a workflow engine, second plugin registry, generic framework, or a new dependency.
Detailed evidence belongs here; the key docs retain concise decisions, mechanisms, and surface
limitations. Do not expand this task into implementing Brief input, general refactoring, or live
publishing. The Brief documentation correction records an existing planned feature only.

### Requirements

- [x] R1 — I1: Make every package-shipped product-plugin entry executable from the installed
  distribution without repository node_modules, private workspace symlinks, dependency
  auto-install, or a network fallback for missing code. Prefer build-time entry bundles and
  manifest entry rewrites in the staged tree; preserve plugin assets and runtime-relative path
  behavior. Source manifests and workspace imports remain correct for development. Verify at
  least one ingestion, generator, and fake publisher through the packaged CLI, including a
  publisher that depends on publish-harness. Validate dependency closure for all shipped entries.
- [x] R2 — I2: Centralize source timeout termination, bounded escalation, pipe completion, and
  descendant reaping in the existing invoke spawn seam. A timed-out invocation must leave no
  owned child tool running or writing artifacts. Preserve timeout defaults/overrides, captured
  diagnostics, deterministic source ordering, and independent healthy siblings. Never kill
  unrelated processes or use a broad name-based kill. State platform support and limitations.
- [x] R3 — I3: Restore a declared, validated operation boundary for show-notes while preserving
  the daily pipeline's markdown deliverable. Remove array-shape-based output-validation bypass
  for the entire publish kind. Preferred repair uses a rendering/generation path with schema
  output plus artifact extraction; do not create a new plugin kind or hardcode a plugin name
  into generic contract logic. Plan compatibility before changing the existing podcast array
  invocation; generic publish continues to use Content → Result. Keep direct-entry validation.
- [x] R4 — I4: Preserve validated TargetOutcome.metadata through aggregate deserialization and
  skipped-target carry-forward, including nested values and Surfdash postPath. Retain url/id and
  existing published/skipped semantics. The locale-scaffolding consumer must receive the same
  postPath after retry as before it. Validate metadata as an optional object, not an arbitrary
  primitive, and leave metadata absent when it was absent.
- [x] R5 — I5: Make success depend on output produced during the current invocation. A zero-exit
  child that writes nothing must fail even if --out already contains valid Content/Result or
  nonempty markdown. Preserve source input when --in and --out alias; reject unsupported aliasing
  before deletion or spawn. Choose a freshness approach that preserves output-relative sidecar
  semantics and fails with an actionable diagnostic. State how a failed rerun treats old output.
- [x] R6 — I6: After ResultSchema validation, a publish Result with ok:false must yield a nonzero
  executor result even when the child exits 0. Preserve the failure artifact and error/message
  diagnostic. Keep child nonzero exits authoritative; never convert them to success because an
  output file exists. Apply parity to canonical executor run, hidden invoke alias, and fan-out.
- [x] R7 — I7: Retry must retain the prior target ledger. Explicit --target selects work to
  attempt; it must not silently discard failed targets excluded from that selection. Preserve
  those targets as failed, recompute totals over the full resulting ledger, and keep exit 1 /
  ok:false while any failure remains. Subsequent retry-from must still find outstanding failures.
  Resolve the existing new-target eligibility documentation conflict before changing eligibility;
  preserve current support for previously unattempted explicit targets and document that behavior
  consistently. Avoid duplicate target outcomes or duplicate publish calls.
- [x] R8 — Across I1–I7: Add the smallest regression checks that fail on the reviewed baseline,
  run focused consumer checks, then final lint/typecheck, tests/coverage, build and Spur rules.
  Synchronize the ADR amendments, 03 mechanisms, 04 surfaces, and affected design satellites in
  the same repair change. Replace gap statements with verified behavior only after the relevant
  acceptance checks pass. Keep task status pending until actual implementation verification PASS.

### Acceptance Criteria

- [x] AC1 (R1): Given the staged distribution outside every ancestor of the repository with
  auto-install disabled, when its CLI runs built-in ingestion/generator/fake-publish fixtures,
  then each resolves its dependencies and emits its valid kind output without external calls.
- [x] AC2 (R1): Given all shipped plugin manifests, when entry closure and relative asset paths
  are checked, then entries/assets exist and no private workspace is required outside the
  distribution; development manifests are unchanged by staging.
- [x] AC3 (R2): Given a plugin wrapper spawning a delayed marker-writing child, when the source
  timeout elapses, then the wrapper and descendant terminate and the marker remains absent after
  its scheduled deadline; a healthy sibling still contributes documents.
- [x] AC4 (R2): Given a child that delays termination or inherits output pipes, when cancellation
  occurs, then the call completes within the documented termination budget, no owned process is
  left alive, diagnostics identify timeout, and success paths do not leak listeners/processes.
- [x] AC5 (R3): Given an unrelated publisher and Doc[] input, when invoked through executor run,
  then the undeclared form is rejected before side effects; arbitrary nonempty output is never
  accepted in place of the declared Result contract.
- [x] AC6 (R3): Given the current episode-plan fixture, when the migrated show-notes flow runs,
  then it writes the expected markdown deliverable without a publish transport call and validates
  its declared input/output; the daily workflow remains compatible or has an explicit migration.
- [x] AC7 (R4): Given a prior published Surfdash result with metadata.postPath and a failed sibling,
  when retry succeeds, then the skipped Surfdash result retains metadata/url/id and the actual
  workflow jq selector returns the original postPath after both first and subsequent retries.
- [x] AC8 (R4): Given absent, nested-object, and malformed primitive metadata, when prior results
  are read, then absent/object cases round-trip correctly and malformed metadata produces a
  named input error before dispatch, without silently dropping valid fields.
- [x] AC9 (R5): Given a valid pre-existing --out and a zero-exit child that writes nothing, when
  invoked, then executor run fails and cannot claim the old artifact as current output. Repeat
  for ingestion, generation, and publish contracts and any retained compatibility operation.
- [x] AC10 (R5): Given aliased --in/--out paths and a plugin using output-relative sidecars, when
  freshness handling executes, then input is preserved or rejected before mutation and successful
  sidecar locations remain compatible with voice/image consumers.
- [x] AC11 (R6): Given a zero-exit publisher emitting valid Result {ok:false,error:'rejected'},
  when run through executor run and its hidden alias, then both exit nonzero, retain the failure
  Result and surface its reason; fan-out records the target as failed. Valid success remains 0.
- [x] AC12 (R7): Given prior success S and failures A/B, when --retry-from selects only A and A
  succeeds, then S is skipped, A published, B still failed, total remains 3, and exit is 1;
  retrying the new result dispatches only B and can then exit 0.
- [x] AC13 (R7): Given explicit new and repeated target names in retry input, when the documented
  eligibility policy executes, then behavior matches both CLI docs and the satellite, each target
  appears/calls at most once, and unrelated unresolved prior failures remain visible.
- [x] AC14 (R8): Given final repair changes, when focused regression/consumer checks, lint,
  typecheck, full test coverage, build, pre/post rule gates, and task verification run, then all
  pass with fresh receipts; docs accurately distinguish implemented behavior from residual gaps.

### Q&A

Scope confirmed by Robin's 2026-09-10 request: create one task containing all reviewed issues,
retain detailed evidence to avoid drift, update key project docs where needed, and include
additional observed implementation defects for future fixing. Implementation is future work.

Routine decisions: one issue-template task, priority P1, active feature L as the affected pipeline
home, and task-local acceptance numbering/altitude for cross-feature repairs. B's terminal status
prevents linking an open task without reopening it; L keeps this repair task valid. Keep the
seven issue IDs stable throughout Requirements, Root Cause, Design, Testing and final verification.

Unresolved implementation choices: exact show-notes compatibility path; platform-specific process
tree cancellation/reaping mechanism; freshness mechanism compatible with media sidecars; retry
new-target eligibility wording. The task states required behavior and constraints, not invented
shipped flags/APIs or an assumed authorization for breaking/workflow changes.

### Design

Proposed repair directions; no production code is implemented by this task-capture session.
The 2026-09-10 amendments to ADR-006/007/012/019 establish required boundaries; mechanisms below
must be checked against actual callers before implementation. Keep one task and stable I/R/AC IDs.

| Issues | Owner and smallest plausible repair | Challenge / constraint | Evidence needed before accepting |
| --- | --- | --- | --- |
| I1 | Bundle staged product-plugin entrypoints and point staged manifests to them; continue copying required assets | Bundling can alter import.meta.url and relative resource lookup; preserve the installed directory layout and executability | Isolated packaged CLI fixture flows and all-entry dependency/asset closure check |
| I2 | Extend existing async spawn ownership to process-tree termination and bounded cleanup | Avoid process-group collisions, broad kills, inherited-pipe hangs and platform assumptions | Nested child marker/PID fixture, stubborn child, healthy sibling, clean success |
| I3 | Move show-notes to a declared rendering/generation flow, then restore generic publish Content→Result validation | Existing array-in/raw-markdown-out workflow is shipped; no silent breaking migration | Same show-notes markdown and no transport call, unrelated-publisher rejection, updated workflow tests |
| I4 | Preserve optional validated metadata in both existing read/carry mappings | Do not introduce a schema package for one field or accept primitive metadata | Nested metadata and actual jq selector round trip |
| I5 | Establish fresh-output ownership before interpreting success; use minimal guard/staging compatible with sidecars | Do not blindly unlink aliased input; renaming output stem changes media artifacts; timestamps alone are weak provenance | No-op child with prior valid file, input alias checks, voice/image sidecar parity |
| I6 | Inspect validated publish Result.ok at the executor completion point | Preserve nonzero child exit, useful diagnostics, valid failure artifact, and direct plugin checks | Failure/success parity across public paths |
| I7 | Build result from prior ledger plus attempted outcomes, retaining unattempted failures | Resolve new-target eligibility wording without silently breaking accepted CLI use; dedupe target identity | S/A/B two-round retry, new/repeated targets, accurate counters/exit |

Do not introduce dependencies, new runtimes, an in-process plugin host, or a workflow engine.
Do not broaden trusted plugin execution or disable validators. Any shared helper must earn its
place by real repeated behavior across run/fan-in/fan-out; a metadata field copy needs no framework.
Publish transports remain responsible for channel effects; workflow orchestration stays with Spur.

This task does not authorize live publishing/deployment, external messages, workflow-file edits,
or unrequested breaking API changes. Future execution must resolve the I3 compatibility approach
and obtain any still-required workflow/surface authorization after preparing a reviewable change.
Documentation updates are authorized now; task status does not substitute for execution permission.

### Plan

1. Re-read task 0110, the four dated ADR amendments, 03 Execution boundary integrity, 04 affected
   surfaces, and actual source/callers. Record current revision and unrelated Git changes. Re-run
   the seven probes to establish current failure evidence; do not assume baseline line numbers.
2. I1/R1: inspect every plugin entry/resource path, implement staged dependency closure, and add
   an isolated package smoke test. Validate fixtures without network or real publishing.
3. I2/R2: implement bounded descendant cancellation at the shared spawn seam. Run nested-process,
   timeout-override, normal-success and healthy-sibling checks before continuing.
4. I3/R3: prepare the show-notes migration and compatibility tests. Preserve the markdown artifact,
   review required workflow changes/authorization, then remove the global validation exception.
5. I5/R5 + I6/R6: fix invocation freshness and publish domain-result completion, with alias,
   nonzero-child and media-sidecar controls. Keep direct plugin validation intact.
6. I4/R4 + I7/R7: repair metadata round-trip and prior-ledger preservation together; test S/A/B
   narrowed retries and subsequent retries. Reconcile new-target eligibility wording in the owning
   docs before changing behavior; test duplicate names without external dispatch.
7. R8 documentation sync: update actual shipped behavior in 03/04 and affected satellites, change
   only completed amendment statuses, remove only resolved gap rows, keep unresolved I IDs explicit.
   Do not mark Brief input implemented or reopen unrelated product scope.
8. Run focused regression and consumer tests, then required full gates. Review the complete diff,
   update this task's Solution/Testing/Review via Spur with I/R/AC evidence, and run actual task
   verification. Only a real repair verification PASS can advance this task through done.

Progress remains in this one task. If implementation must be phased, mark each I/R/AC separately
without dropping remaining issues from the acceptance contract or declaring the aggregate done.

### Root Cause

All observations below were reproduced on 2026-09-10 using Bun 1.3.14 on macOS arm64 at
`02b5dd2`. Paths and symbols are durable anchors; line numbers are baseline hints and must be
re-resolved after changes. No live publishing/network service was used.

#### I1 — Distribution boundary excludes child entry dependencies

- **Observed:** Copying core-facts-gen's shipped files to a clean temporary directory and running
  its entry with `bun --no-install` fails before generation: exit 1, `Cannot find module
  '@gobing-ai/kk-core'`. The fixture intentionally contains no repository node_modules ancestor.
- **Cause:** `scripts/bundle-plugins.ts:50` copies the plugin tree; it does not bundle entries.
  `plugins/generations/core-facts-gen/plugin.json` points at `./src/index.ts`, whose line 3 imports
  kk-core. `scripts/publish-manifest.ts:39` strips private workspace dependencies from the published
  CLI manifest on the assumption they are bundled into dist. That is true for CLI imports, not
  for separately executed entries (`apps/cli/src/invoke.ts`, pluginEntryCmd/spawnPluginEntry).
- **Blast radius:** All raw shipped plugin entries with workspace dependencies, including
  publishers importing publish-harness. A working development checkout hides the missing closure.
  Discovery health only checks manifests/entry existence; it is not dependency execution proof.
- **Coverage gap:** `apps/cli/tests/package.test.ts:20` runs prepack and asserts bin files exist,
  inside the monorepo. It never runs built-in entries in an isolated installed layout. The probe
  proves the missing private module; it is not a completed npm installation or live-service test.

#### I2 — Cancellation terminates an adapter but not its owned tool

- **Observed:** `spawnPluginEntryAsync` with timeoutMs=250 returned in 254 ms with exitCode=1 and
  timedOut=true; the wrapper's child then wrote its marker after 1200 ms.
- **Cause:** `apps/cli/src/invoke.ts:180` passes AbortSignal to Bun.spawn for the immediate child,
  without owning a process group/tree. The real `horizon-ingest` defaultRunner at src/index.ts:37
  uses Bun.spawnSync to run uv/horizon; last30days-ingest src/index.ts:51 similarly runs Python.
  Their descendants are outside the wrapper's cancellation lifecycle.
- **Blast radius:** Fan-in reports degraded input while external tools can still consume API
  budget or mutate caches/artifacts; a retry may overlap that work. A descendant inheriting
  pipes is a further test case, not something the initial marker probe established.
- **Coverage gap:** `apps/cli/tests/fanin.test.ts` timeout fixtures sleep in the plugin itself;
  they do not model a subprocess-spawning ingestion adapter. Verify both nested tools and siblings.

#### I3 — Operation-specific output behavior resides in generic kind dispatch

- **Observed:** A fixture named unrelated-pub with kind=publish, Doc[] input and a zero-exit
  entry writing `{"garbage":true}` returns executor exit 0.
- **Cause:** `packages/kk-core/src/kinds.ts:68` widens all publish inputs to Content|Doc[].
  `apps/cli/src/invoke.ts:307` uses publish plus Array.isArray(input) to accept any nonempty
  output, bypassing JSON/Result validation. This mirrors only podcast-pub's renderShowNotesIO
  branch (`plugins/publishings/podcast-pub/src/index.ts:485`), which writes raw markdown.
- **Blast radius:** KindContract.output still says ResultSchema, but actual acceptance depends
  on an unrelated plugin's operation convention. Core, CLI, podcast adapter and daily workflow
  must change together. Fan-out separately validates Content/Result, so entry paths differ.
- **Coverage gap:** Tests for 0100/0101 deliberately assert the broad exception; those tests
  must be replaced with compatibility and isolation assertions, not merely deleted for green.
  The show-notes renderer's valid markdown output is a required deliverable, not the bug.

#### I4 — Two retry projections lose target metadata

- **Observed:** Prior Surfdash published target with metadata.postPath and failed Qiita sibling;
  fake Qiita retry succeeds; resulting Surfdash skipped target has no metadata. Exit is 0.
- **Cause:** readAggregateResult's TargetOutcome reconstruction in apps/cli/src/fanout.ts:234
  omits metadata; runFanout's skipped mapping at line 450 omits it again. Fixing just one loses
  the field at the other boundary. Fresh success handling already preserves result.metadata.
- **Consumer:** `plugins/kk/workflows/kk-daily-ai-voice.yaml:260` selects successful Surfdash
  `.metadata.postPath`; absent path takes the no-path skip, withholding locale scaffolding.
  `plugins/publishings/surfdash-pub/src/index.ts:365` supplies that metadata on publication.
- **Coverage gap:** Existing retry tests cover target sets and url/id, not metadata round trips
  or the actual consumer selector. This is local serialization drift, not a new DTO requirement.

#### I5 — Output existence is mistaken for invocation provenance

- **Observed:** Seed valid Content {body:'stale prior article',format:'markdown'}, invoke a
  discovered generator whose entry immediately exits 0 and writes nothing: runInvoke returns
  0 and the old Content remains the accepted output.
- **Cause:** runInvoke spawns at apps/cli/src/invoke.ts:277, checks existsSync at line 293, then
  validates the file. It never establishes that the current child produced it. Several built-in
  plugins delete output themselves, but an extensible executor cannot rely on every third-party
  entry doing that correctly. Fan-in/fan-out temporary output paths use a different policy.
- **Blast radius:** Reruns can silently pass old content to later generation/publication steps.
  Cleanup or staging must not destroy aliased input; output basename changes can relocate WAV,
  MP3, image, and other sidecars. Trace voice-gen and image-gen before selecting a mechanism.
- **Coverage gap:** Missing-output checks do not cover a pre-existing valid output and no-op child.

#### I6 — Schema validity does not imply domain success

- **Observed:** A zero-exit fixture publisher writes {ok:false,target:'false-pub',error:'rejected'};
  runInvoke returns 0 with that failure Result still on disk.
- **Cause:** ResultSchema accepts a boolean ok by design. After safeParse at invoke.ts:331,
  runInvoke returns 0 unconditionally. In contrast, fanout() branches on result.ok. Built-in
  publisher entrypoints generally throw for ok:false, which masks the generic executor defect.
- **Blast radius:** Custom entries or wrappers with incorrect child exit status can advance a
  workflow despite an explicit failed publication. Input/output shape checking remains necessary;
  domain outcome checking is additional and should not change ingestion/generation outputs.
- **Coverage gap:** Add parity tests across executor run, hidden invoke alias and fan-out using
  the same valid failure Result. Include error/message fallback and a valid success control.

#### I7 — Retry selection deletes outstanding state from the aggregate

- **Observed:** Prior targets S=published, A=failed, B=failed. Retry only A with a successful fake
  dispatch. New result has only S=skipped/A=published, total=2, failed=0, ok=true, exit 0. B is
  no longer discoverable by a subsequent retry-from on that result.
- **Cause:** runFanout carries only nonfailed prior entries, dispatches only the selected subset,
  then aggregates skipped+fresh (`apps/cli/src/fanout.ts:449-470`). There is no carry-forward for
  prior failures not selected this time. This conflates the work set with the complete result set.
- **Adjacent contract ambiguity:** An explicit target absent from the prior result is also
  dispatched. `docs/04_DESIGN.md` describes narrowing to previous failures, while the satellite
  §5.1 permits failed or unattempted targets. Treat this as a documentation/decision conflict,
  not automatically as an eighth implementation bug; preserve existing support until resolved.
- **Coverage gap:** The current subset test uses one success and one failure; it cannot expose
  loss of a second unselected failure. Add a three-target case plus a second retry round trip.

### Solution

Not implemented. All I1–I7 remediation work remains open.

The capture session adds detailed reproduction/acceptance evidence to this task and updates
documentation only: ADR-006 completion ownership, ADR-007 retry state, ADR-012 distribution
closure, ADR-019 descendant cancellation; 03 mechanisms/gap inventory; 04 observed surfaces;
01 clarification that Brief input is planned; AGENTS pointer to the owning boundary section.
Documentation anchors: `docs/00_ADR.md:237`, `docs/03_ARCHITECTURE.md:179`,
`docs/04_DESIGN.md:97`, and `docs/01_PRD.md:74`.
These changes prevent documentation from representing broken or planned paths as verified runtime
behavior. They do not fix production code or replace the verification required by R8.

During implementation, replace this section with an I1–I7 change map (file, symbol, why, tests),
explicitly retaining any unresolved issues. Do not fill it with anticipated fixes or old review receipts.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | scripts/bundle-plugins.ts bundles every staged product entry to <plugin>/dist/index.js via Bun.build and rewrites manifest entry to ./dist/index.js; prepack wiring in apps/cli/package.json; package.test.ts asserts prepack staging; smoke ran packaged-style entries standalone (podcast-pub/qiita-pub) with clean domain errors — no workspace/symlink/module-resolution dependency; fail-loud on missing entry/build/zero plugins. |
| R2 | MET | apps/cli/src/invoke.ts spawnPluginEntryAsync: self-managed timeout timer kills the process tree (killProcessTree: depth-first descendants via pgrep -P, then SIGKILL parent); pipes drained; no name-based kill; POSIX limitation stated in docs/04; regression test spawns delayed marker-writing grandchild (timeout 300ms) and asserts marker absent at 2.6s; healthy siblings unaffected (concurrent fan-out design). |
| R3 | MET | packages/kk-core/src/kinds.ts publish input is Content-only (array safeParse now false); manifest schema gains operations; podcast-pub/plugin.json declares show-notes op (doc-list → markdown); executor dispatches declared ops pre-spawn and rejects undeclared arrays with named error — no shape-sniffing bypass, no name hardcoding, direct-entry validation intact; kind + invoke tests. |
| R4 | MET | apps/cli/src/fanout.ts preserves validated TargetOutcome.metadata through aggregate deserialization and skipped-target carry-forward (nested objects, postPath); primitive metadata → exit 2 (EXIT_INPUT) before dispatch; absent stays absent; fanout tests cover round-trip, primitive rejection, retained postPath across retry. |
| R5 | MET | invoke.ts runInvoke: success requires output written during the current invocation — stale --out unlinked only after alias/verify checks (delete-or-verify); --in/--out alias rejected before any mutation or spawn; sidecar semantics preserved; tests prove zero-exit-no-write fails against pre-existing valid output for all kinds. |
| R6 | MET | invoke.ts: validated publish Result ok:false → exit 1 with `reported failure: <reason>`, failure artifact kept, child nonzero exits still authoritative; parity applied to executor run, hidden invoke alias, and fan-out (fanout records target failed); tests on all three legs. |
| R7 | MET | fanout.ts retry: prior ledger retained; explicit --target narrows/dedupes the attempt set (attempt = dedup(targets minus carried)); retainedFailed = prior failures not attempted; aggregate = skipped + retainedFailed + fresh; exit 1/ok:false while any failure remains; no duplicate outcomes/dispatch; eligibility doc conflict resolved consistently in CLI docs, docs/04, and satellite spec. |
| R8 | MET | Regression tests added per issue (744 pass; would fail on baseline); focused consumer checks then full gates: bun run lint, bun run test, bun run build, bun run spur-check all green with fresh receipts; docs/00_ADR amendments (ADR-006/007/012/019) flipped to shipped, docs/03 shipped-mechanism table, docs/04 surfaces, docs/design/fan-in-and-fan-out-specification.md §5 synced in the same change. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | package.test.ts prepack staging test; standalone runs of packaged-style entries (ingestion/generator/publisher incl. publish-harness-dependent podcast-pub) outside workspace context emit clean domain errors / valid kind behavior with no auto-install or network for code. |
| AC2 | MET | test | Entry closure verified during bundling (fail-loud on missing entry/build); staged manifests point to ./dist/index.js; assets copied; dev manifests unchanged (source tree untouched by staging); smoke: zero plugins / missing entry produce named errors. |
| AC3 | MET | test | invoke.test.ts tree-kill regression: wrapper spawns delayed marker-writing grandchild, source timeout 300ms elapses, marker file absent at 2.6s check. |
| AC4 | MET | test | Self-managed timer (no AbortSignal race); killProcessTree reaps descendants then parent; diagnostics name the timeout (timedOut: true, exit 1); success paths clearTimeout after proc.exited — no leaked listeners; /tmp manual repro confirmed pgrep -P child-only leak is fixed by tree walk. |
| AC5 | MET | test | kinds.test.ts: publish array input safeParse false; invoke.test.ts: unrelated publisher with Doc[] rejected pre-spawn (`undeclared operation` / no doc-list op error) before side effects; no output-shape bypass remains. |
| AC6 | MET | test | podcast-pub plugin.json declares show-notes operation; executor dispatch path validates declared input (Doc[] → markdown) and output; no publish transport call in show-notes flow; daily workflow compatibility preserved via declared op (manifest-level migration documented in docs/04). |
| AC7 | MET | test | fanout.test.ts: prior Surfdash result with metadata.postPath + failed sibling; retry succeeds → skipped Surfdash retains metadata/url/id; jq selector returns original postPath on first and subsequent retries. |
| AC8 | MET | test | fanout.test.ts: absent metadata stays absent; nested-object round-trips; primitive metadata → named input error (exit 2) before dispatch; no silent field dropping. |
| AC9 | MET | test | invoke.test.ts: valid pre-existing --out + zero-exit child writing nothing → executor run fails (exit 1) for each contract; old artifact not claimed as current. |
| AC10 | MET | test | invoke.test.ts: aliased --in/--out rejected before mutation; non-aliased flows keep output-relative sidecar locations (delete-or-verify only removes the exact verified stale --out). |
| AC11 | MET | test | invoke.test.ts + fanout.test.ts: zero-exit publisher emitting Result {ok:false,error:'rejected'} → executor run and hidden alias both exit nonzero, failure Result retained, reason surfaced; fan-out records target failed; valid success still exit 0. |
| AC12 | MET | test | fanout.test.ts: prior S ok + A/B failed; --retry-from A → S skipped, A published, B still failed, total 3, exit 1; next retry-from dispatches only B then exit 0. |
| AC13 | MET | test | fanout.test.ts: explicit new + repeated names — each target appears/dispatches at most once (dedupe), unrelated unresolved prior failures remain visible (retainedFailed); eligibility policy wording now identical across CLI docs, docs/04 Retry semantics, and satellite §5. |
| AC14 | MET | command | bun run lint clean; bun run test 744 pass / 0 fail; bun run build green; bun run spur-check green (all 47 + 2 rules); docs distinguish shipped behavior from residual gaps (P3 findings named in Review). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Three-dimensional review of task 0110 (run bfe74de4, worktree sp/devrun-0110-b1fd3f7), executed inline against the recorded diff (15 files, +566/-132).

**Functional traceability — PASS.** All 7 issues ship with regression coverage: I1 staging bundles every product entry to dist/ with manifest rewrite and fail-loud staging (package.test + packaged-style smoke: podcast-pub/qiita-pub entries load standalone with clean domain errors, no workspace imports); I2 tree-kill regression proves the grandchild is reaped (marker-file test); I3 undeclared array rejected pre-spawn + declared-op dispatch (invoke + manifest tests); I4 metadata round-trip incl. exit-2 primitive-metadata leg; I5 alias rejection + stale-out delete-or-verify; I6 ok:false → exit 1 with artifact kept; I7 retained-failed aggregate + retry-from narrowing. R1–R8 satisfied; 744/744 tests, lint, build, spur-check all green.

**SECUA — PASS.** Security: tree kill scoped to the spawned pid's descendants; delete-or-verify removes only the exact --out path inside the authorized workdir; no secrets, no shell interpolation of plugin-controlled strings (args-array spawn). Correctness: abort-race eliminated by the self-managed timer (the Bun-signal kill beat the listener — caught and fixed by the regression test); pgrep failure degrades to parent-only kill without throwing. Efficiency: pgrep walk is depth-proportional; pipes drained concurrently. Usability: errors name the offending path/target/operation. Architecture: spawn seam and executor-boundary validation kept; ADR-006/007/012/019 amendments flipped to shipped; docs/03/04 + satellite spec synced same-commit.

| Priority | Finding | Location | Recommendation |
| --- | --- | --- | --- |
| P3 | doc-list operation selection is first-match across declared operations; a plugin declaring two doc-list ops cannot disambiguate | apps/cli/src/invoke.ts (declared-op dispatch) | Acceptable for the single-op-plugin surface; revisit with per-op selection only if a second doc-list op ships. |
| P3 | killProcessTree is POSIX-only (pgrep -P); Windows hosts get parent-only kill | apps/cli/src/invoke.ts | Add taskkill /T /F fallback when Windows support is needed; limitation documented in docs/04. |
| P3 | seedream generator live wire leg unverified (requires ARK_API_KEY) | plugins/generations/seedream-pub | Pre-existing, out of task scope; verify on next live-key availability. |

No P1/P2 findings. No blocking issues; the diff is safe to verify.

### References

- Review baseline: Git `02b5dd2`, 2026-09-10, Bun 1.3.14 / macOS arm64; re-resolve current revision.
- Authority: docs/00_ADR.md, 2026-09-10 amendments to ADR-006/007/012/019.
- Mechanism/gaps: docs/03_ARCHITECTURE.md, Execution boundary integrity.
- Actual surface/planned repairs: docs/04_DESIGN.md, executor run, §1.5, §1.6, §1.7.
- Existing retry specification: docs/design/fan-in-and-fan-out-specification.md §3/§5.1.
- Distribution: scripts/bundle-plugins.ts; scripts/publish.ts; scripts/publish-manifest.ts;
  apps/cli/package.json; plugins/generations/core-facts-gen/plugin.json and src/index.ts.
- Process/contracts: apps/cli/src/invoke.ts; packages/kk-core/src/kinds.ts and schemas.ts;
  apps/cli/src/commands/executor.ts; apps/cli/src/fanin.ts; apps/cli/src/fanout.ts.
- Consumers: plugins/ingestions/horizon-ingest/src/index.ts; plugins/ingestions/last30days-ingest/src/index.ts;
  plugins/publishings/podcast-pub/src/index.ts; plugins/publishings/surfdash-pub/src/index.ts;
  plugins/kk/workflows/kk-daily-ai-voice.yaml; plugins/generations/voice-gen/src/index.ts;
  plugins/generations/image-gen/src/index.ts.
- Existing checks: apps/cli/tests/package.test.ts; apps/cli/tests/invoke.test.ts;
  apps/cli/tests/fanin.test.ts; apps/cli/tests/fanout.test.ts;
  apps/cli/tests/commands/executor.test.ts; apps/cli/tests/kk-daily-ai-voice-workflow.test.ts;
  packages/kk-core/tests/kinds.test.ts; scripts/publish-manifest.test.ts.
- Historical task references: 0053 (B7), 0092 (source runner), 0095 (show-notes), 0099 (timeouts),
  0100/0101 (array input/opaque output). Resolve using `spur task show <wbs> --json`.
- Temporary probe folders/logs are disposable; the reproducible recipes and receipts in Testing
  are the retained evidence and must not depend on /tmp surviving.

### History

- 2026-09-10T19:06:10.328Z todo → wip (system)
- 2026-09-10T19:06:10.805Z wip → testing (system)
- 2026-09-10T19:07:29.512Z testing → done (system)

