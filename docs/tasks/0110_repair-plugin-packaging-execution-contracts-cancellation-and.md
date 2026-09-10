---
schema_version: 1
name: Repair plugin packaging, execution contracts, cancellation, and retry integrity
status: todo
template: issue
created_at: 2026-09-10T17:38:09.598Z
updated_at: "2026-09-10T18:06:45.939Z"

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

- [ ] R1 — I1: Make every package-shipped product-plugin entry executable from the installed
  distribution without repository node_modules, private workspace symlinks, dependency
  auto-install, or a network fallback for missing code. Prefer build-time entry bundles and
  manifest entry rewrites in the staged tree; preserve plugin assets and runtime-relative path
  behavior. Source manifests and workspace imports remain correct for development. Verify at
  least one ingestion, generator, and fake publisher through the packaged CLI, including a
  publisher that depends on publish-harness. Validate dependency closure for all shipped entries.
- [ ] R2 — I2: Centralize source timeout termination, bounded escalation, pipe completion, and
  descendant reaping in the existing invoke spawn seam. A timed-out invocation must leave no
  owned child tool running or writing artifacts. Preserve timeout defaults/overrides, captured
  diagnostics, deterministic source ordering, and independent healthy siblings. Never kill
  unrelated processes or use a broad name-based kill. State platform support and limitations.
- [ ] R3 — I3: Restore a declared, validated operation boundary for show-notes while preserving
  the daily pipeline's markdown deliverable. Remove array-shape-based output-validation bypass
  for the entire publish kind. Preferred repair uses a rendering/generation path with schema
  output plus artifact extraction; do not create a new plugin kind or hardcode a plugin name
  into generic contract logic. Plan compatibility before changing the existing podcast array
  invocation; generic publish continues to use Content → Result. Keep direct-entry validation.
- [ ] R4 — I4: Preserve validated TargetOutcome.metadata through aggregate deserialization and
  skipped-target carry-forward, including nested values and Surfdash postPath. Retain url/id and
  existing published/skipped semantics. The locale-scaffolding consumer must receive the same
  postPath after retry as before it. Validate metadata as an optional object, not an arbitrary
  primitive, and leave metadata absent when it was absent.
- [ ] R5 — I5: Make success depend on output produced during the current invocation. A zero-exit
  child that writes nothing must fail even if --out already contains valid Content/Result or
  nonempty markdown. Preserve source input when --in and --out alias; reject unsupported aliasing
  before deletion or spawn. Choose a freshness approach that preserves output-relative sidecar
  semantics and fails with an actionable diagnostic. State how a failed rerun treats old output.
- [ ] R6 — I6: After ResultSchema validation, a publish Result with ok:false must yield a nonzero
  executor result even when the child exits 0. Preserve the failure artifact and error/message
  diagnostic. Keep child nonzero exits authoritative; never convert them to success because an
  output file exists. Apply parity to canonical executor run, hidden invoke alias, and fan-out.
- [ ] R7 — I7: Retry must retain the prior target ledger. Explicit --target selects work to
  attempt; it must not silently discard failed targets excluded from that selection. Preserve
  those targets as failed, recompute totals over the full resulting ledger, and keep exit 1 /
  ok:false while any failure remains. Subsequent retry-from must still find outstanding failures.
  Resolve the existing new-target eligibility documentation conflict before changing eligibility;
  preserve current support for previously unattempted explicit targets and document that behavior
  consistently. Avoid duplicate target outcomes or duplicate publish calls.
- [ ] R8 — Across I1–I7: Add the smallest regression checks that fail on the reviewed baseline,
  run focused consumer checks, then final lint/typecheck, tests/coverage, build and Spur rules.
  Synchronize the ADR amendments, 03 mechanisms, 04 surfaces, and affected design satellites in
  the same repair change. Replace gap statements with verified behavior only after the relevant
  acceptance checks pass. Keep task status pending until actual implementation verification PASS.

### Acceptance Criteria

- [ ] AC1 (R1): Given the staged distribution outside every ancestor of the repository with
  auto-install disabled, when its CLI runs built-in ingestion/generator/fake-publish fixtures,
  then each resolves its dependencies and emits its valid kind output without external calls.
- [ ] AC2 (R1): Given all shipped plugin manifests, when entry closure and relative asset paths
  are checked, then entries/assets exist and no private workspace is required outside the
  distribution; development manifests are unchanged by staging.
- [ ] AC3 (R2): Given a plugin wrapper spawning a delayed marker-writing child, when the source
  timeout elapses, then the wrapper and descendant terminate and the marker remains absent after
  its scheduled deadline; a healthy sibling still contributes documents.
- [ ] AC4 (R2): Given a child that delays termination or inherits output pipes, when cancellation
  occurs, then the call completes within the documented termination budget, no owned process is
  left alive, diagnostics identify timeout, and success paths do not leak listeners/processes.
- [ ] AC5 (R3): Given an unrelated publisher and Doc[] input, when invoked through executor run,
  then the undeclared form is rejected before side effects; arbitrary nonempty output is never
  accepted in place of the declared Result contract.
- [ ] AC6 (R3): Given the current episode-plan fixture, when the migrated show-notes flow runs,
  then it writes the expected markdown deliverable without a publish transport call and validates
  its declared input/output; the daily workflow remains compatible or has an explicit migration.
- [ ] AC7 (R4): Given a prior published Surfdash result with metadata.postPath and a failed sibling,
  when retry succeeds, then the skipped Surfdash result retains metadata/url/id and the actual
  workflow jq selector returns the original postPath after both first and subsequent retries.
- [ ] AC8 (R4): Given absent, nested-object, and malformed primitive metadata, when prior results
  are read, then absent/object cases round-trip correctly and malformed metadata produces a
  named input error before dispatch, without silently dropping valid fields.
- [ ] AC9 (R5): Given a valid pre-existing --out and a zero-exit child that writes nothing, when
  invoked, then executor run fails and cannot claim the old artifact as current output. Repeat
  for ingestion, generation, and publish contracts and any retained compatibility operation.
- [ ] AC10 (R5): Given aliased --in/--out paths and a plugin using output-relative sidecars, when
  freshness handling executes, then input is preserved or rejected before mutation and successful
  sidecar locations remain compatible with voice/image consumers.
- [ ] AC11 (R6): Given a zero-exit publisher emitting valid Result {ok:false,error:'rejected'},
  when run through executor run and its hidden alias, then both exit nonzero, retain the failure
  Result and surface its reason; fan-out records the target as failed. Valid success remains 0.
- [ ] AC12 (R7): Given prior success S and failures A/B, when --retry-from selects only A and A
  succeeds, then S is skipped, A published, B still failed, total remains 3, and exit is 1;
  retrying the new result dispatches only B and can then exit 0.
- [ ] AC13 (R7): Given explicit new and repeated target names in retry input, when the documented
  eligibility policy executes, then behavior matches both CLI docs and the satellite, each target
  appears/calls at most once, and unrelated unresolved prior failures remain visible.
- [ ] AC14 (R8): Given final repair changes, when focused regression/consumer checks, lint,
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

#### Evidence status

Baseline defect reproductions, not repair verification. All I1–I7 remain open. The following
recipes use disposable local fixtures, real executor functions and fake publisher dispatch;
they do not contact external services. Run from the repository root with dependencies installed.
Temporary files are deliberately retained for inspection; no persistent temp path is required
to rerun the recipe. Convert these observations to regression assertions during implementation.

| Issue | Observed baseline | Required repaired observation |
| --- | --- | --- |
| I1 | isolated entry exit 1; cannot find @gobing-ai/kk-core | packaged fixture entry resolves and exits 0 |
| I2 | timeout returned in 254 ms for 250 ms setting; delayed descendant marker exists | no descendant marker/process after termination deadline |
| I3 | unrelated publisher array input + {garbage:true} output returns 0 | undeclared input/output rejected |
| I4 | retry returns 0 but carried target.metadata is absent | original metadata.postPath retained and consumer selector succeeds |
| I5 | no-op generator returns 0 using pre-existing valid Content | nonzero, no claim of fresh output |
| I6 | zero-exit child with valid Result.ok=false returns 0 | nonzero, failure artifact and reason preserved |
| I7 | retry A omits failed B; total=2, failed=0, ok=true, exit=0 | B retained failed; total=3, failed=1, ok=false, exit=1 |

#### Reproducer: all seven boundaries

The I1 portion is a minimal dependency-closure probe mirroring the current raw-copy staging
behavior, not an npm install test. R1's acceptance additionally requires the complete staged
CLI/distribution outside the checkout. The I2 timing is illustrative, not a precise scheduler SLA.

```bash
bun --no-install - <<'BUN'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInvoke, spawnPluginEntryAsync } from './apps/cli/src/invoke.ts';
import { runFanout } from './apps/cli/src/fanout.ts';

const root = mkdtempSync(join(tmpdir(), 'kk-0110-repro-'));
const input = join(root, 'input.json');
const output = join(root, 'output.json');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const emit = (issue, data) => console.log(JSON.stringify({ issue, ...data }));
function plugin(name, kind, code) {
    const collection = kind === 'generator' ? 'generations' : 'publishings';
    const dir = join(root, collection, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify({ name, kind, entry: 'entry.ts' }));
    writeFileSync(join(dir, 'entry.ts'), code);
}
const invoke = name => runInvoke({ plugin: name, pluginsRoot: root, inPath: input, outPath: output });

// I1: the current staging step copies these files without bundling imports.
const isolated = join(root, 'isolated-core-facts');
mkdirSync(join(isolated, 'src'), { recursive: true });
for (const file of ['package.json', 'plugin.json', 'src/index.ts']) {
    copyFileSync(join('plugins/generations/core-facts-gen', file), join(isolated, file));
}
writeFileSync(input, '[]');
const packed = Bun.spawnSync([
    process.execPath, '--no-install', join(isolated, 'src/index.ts'), '--in', input, '--out', output,
], { cwd: isolated, stdout: 'pipe', stderr: 'pipe' });
emit('I1', { exit: packed.exitCode, stderr: packed.stderr.toString().trim() });

// I2: finite child lifetime avoids leaving a permanent fixture process behind.
const marker = join(root, 'descendant-marker');
const ready = join(root, 'descendant-ready');
const child = join(root, 'child.ts');
const parent = join(root, 'parent.ts');
writeFileSync(child, `await Bun.write(${JSON.stringify(ready)}, 'ready'); await Bun.sleep(2500); await Bun.write(${JSON.stringify(marker)}, 'ran');`);
writeFileSync(parent, `Bun.spawnSync([process.execPath, ${JSON.stringify(child)}], {stdout:'pipe',stderr:'pipe'});`);
const start = Date.now();
const timed = await spawnPluginEntryAsync({
    entryPath: parent, cwd: root, inPath: input, outPath: output, timeoutMs: 1500,
});
const elapsedMs = Date.now() - start;
const childStarted = existsSync(ready);
await Bun.sleep(3000);
emit('I2', { elapsedMs, childStarted, timedOut: timed.timedOut, exit: timed.exitCode, markerExists: existsSync(marker) });
if (!childStarted) throw new Error('I2 inconclusive: child did not start before timeout; rerun without concurrent build load');

plugin('unrelated-pub', 'publish',
    `await Bun.write(process.argv[process.argv.indexOf('--out')+1], '{"garbage":true}');`);
emit('I3', { exit: await invoke('unrelated-pub'), output: read(output) });

plugin('noop-gen', 'generator', 'process.exit(0);');
writeFileSync(output, JSON.stringify({ body: 'stale prior article', format: 'markdown' }));
emit('I5', { exit: await invoke('noop-gen'), output: read(output) });

plugin('false-pub', 'publish',
    `await Bun.write(process.argv[process.argv.indexOf('--out')+1], JSON.stringify({ok:false,target:'false-pub',error:'rejected'}));`);
writeFileSync(input, JSON.stringify({ body: 'article', format: 'markdown' }));
emit('I6', { exit: await invoke('false-pub'), output: read(output) });

const prior = join(root, 'prior.json');
const success = { target: 'surfdash-pub', ok: true, status: 'published',
    url: 'https://example.invalid/post', metadata: { postPath: '/fixture/zh/post.md' } };
const failed = target => ({ target, ok: false, status: 'failed', error: 'failed' });
writeFileSync(prior, JSON.stringify({ ok: false,
    summary: { total: 2, succeeded: 1, failed: 1, skipped: 0 }, targets: [success, failed('A')] }));
const calls = [];
const deps = { dispatch: async target => { calls.push(target); return { ok: true, target }; } };
let exit = await runFanout(['--content', input, '--retry-from', prior, '--out', output], deps);
emit('I4', { exit, calls: [...calls], result: read(output) });

calls.length = 0;
writeFileSync(prior, JSON.stringify({ ok: false,
    summary: { total: 3, succeeded: 1, failed: 2, skipped: 0 }, targets: [success, failed('A'), failed('B')] }));
exit = await runFanout(['--content', input, '--retry-from', prior, '--target', 'A', '--out', output], deps);
emit('I7', { exit, calls, result: read(output) });
console.log(JSON.stringify({ fixtureRoot: root }));
BUN
```

#### Existing suite receipts from the originating architecture review

These are dated baseline receipts, not substitutes for final repaired-code checks:

```text
bun run lint                 exit 0; Biome: Checked 184 files. No fixes applied; workspace typechecks exit 0.
bun run test                 exit 0; 740 pass, 0 fail; 2887 expect() calls; 50 files.
Coverage                     functions 99.39%, lines 98.15% aggregate.
bun run build                exit 0; CLI bundled 361 modules.
spur rule run --preset recommended-pre-check --fail-on warning --json
                             exit 0; ruleCount 47, findings [], fixes [].
spur rule run --preset recommended-post-check --fail-on warning --json
                             exit 0; ruleCount 2, findings [], fixes [].
```

An earlier focused invocation (`bun test apps/cli/tests/invoke.test.ts apps/cli/tests/fanin.test.ts
apps/cli/tests/fanout.test.ts apps/cli/tests/package.test.ts packages/kk-core/tests --dots`) printed
137 pass / 0 fail but exited 1. Its capture helper showed 80% function coverage; coverage is a
likely explanation, not a proven assertion failure. Record exit status separately from printed
counts. The full suite above subsequently exited 0 without weakening coverage settings.

#### Final repair verification plan

Run the changed boundary's tests first (package; invoke/fan-in; podcast/workflow; fan-out), plus
affected consumers/types. Tests must fail on the old behavior rather than only assert the new
implementation structure. Use the actual locale selector from kk-daily-ai-voice.yaml for I4.
Run `bun run autofix`, `bun run spur-check`, and `bun run build` on final production changes;
inspect `git status` for unrelated modifications. Record each R/AC outcome through Spur and emit
a fresh implementation verdict only after repairs. Do not treat this planning task's structural
check or a documentation-only lint run as implementation PASS.

#### Task-capture and documentation verification — 2026-09-10

Scope: documentation and issue capture only; no implementation PASS.

- Saved seven-issue reproducer executed from this task: I1/I3/I4/I5/I6/I7 matched
  the failure observations above. I2 used a child-start marker and a 1500 ms timeout:
  elapsed 1505 ms, childStarted=true, timedOut=true, exit=1, markerExists=true.
  An earlier 250 ms rerun under concurrent build load had no completion marker and was
  inconclusive about whether the descendant had started; the saved recipe now explicitly
  rejects that inconclusive condition. The ready-marker run confirms the descendant leak.
- `spur task check 0110 --json`: pass=true, findings=[], missingSections=[].
  Status remains todo, priority P1, feature L, task-local numbering and AC altitude.
- `bun run spur-check`: exit 0; Biome checked 184 files with no fixes; all workspace
  typechecks passed; 47 pre-check rules and 2 post-check rules passed; 740 tests passed,
  0 failed; aggregate function coverage 99.39%, line coverage 98.15%.
- `bun run build`: exit 0; CLI bundled 361 modules.
- Document checks: four numbered-document frontmatters parse with correct ownership,
  authority and updated_at; the task link resolves; historical ADR body is preserved;
  7 issue IDs, 8 requirements and 14 acceptance criteria exist in the persisted task.
  Corrected the pre-existing unquoted colon in 04_DESIGN's owns field so YAML parses.
- `git diff --check`: clean. Intended changes are the new task plus AGENTS, 00, 01,
  03, 04 and the fan-in/fan-out design satellite. No production code/workflows changed.

These checks validate the captured evidence and documentation, not the future repair.

### Review

Architecture review disposition at capture: remediation required; no repair approval or PASS.
I1/I2/I3 are major boundary failures; I4 is a local serialization boundary failure. Follow-up
implementation review adds I5/I6/I7 as P1 correctness issues. All are reproduced, not speculative
refactoring opportunities. The new-target eligibility conflict is recorded separately under I7.

The existing regression suite passes despite the gaps because it does not exercise isolated
distribution dependency resolution, nested tool cancellation, output provenance, failed Result
semantics, metadata persistence or a retry subset with another outstanding failure.

Final reviewer must verify each R/AC independently: a green unit suite is not evidence that all
seven are fixed. Review the package boundary and actual downstream locale selector, not just pure
helpers. Keep docs and task receipts distinct from current implementation. No live services or
production publishing were exercised in this review; those claims remain outside the evidence.

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
