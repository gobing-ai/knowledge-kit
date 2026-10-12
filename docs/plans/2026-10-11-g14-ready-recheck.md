# G14 ready-depth recheck — 2026-10-11

Invocation: `$sp-dev-refineall --feature G14 --auto --depth ready`.

All three frozen tasks are refined, with **14 factual/contract corrections and 21 readiness items passing**.
This is a fresh audit of the current tree following the earlier same-day refinement. Status, priority,
estimates and declared dependencies are unchanged. Only 0256 can start execution now.

| Task | Result | Corrections | Status | Failed checklist IDs |
| --- | --- | --- | --- | --- |
| 0256 | refined | 4 | todo → todo | none |
| 0257 | refined | 5 | todo → todo | none |
| 0258 | refined | 5 | todo → todo | none |

Membership was frozen once in dependency order 0256 → 0257 → 0258; no exclusions or failures.
Every task section was written through Spur after its section-edit gate. Dated Background corrections
and appended closed Q&A preserve prior decisions. The accepted design satellite is synchronized;
no product code or dependency changed.

## Material corrections

- 0256 retains its own resolved model snapshot path: the published instance lacks the documented path
  attribute. Freeze asynchronous shared-client ownership, bounded framing, one in-flight render and
  terminal protocol failures without worker restart. Include both registry-name fixtures with scaffolding.
- 0257 repairs missing requested MP3 from valid cached speech. Final cache reuse requires the current
  ordered section hashes; after failed joining, valid section caches must rejoin instead of returning
  a stale final. Preserve the ordered segment timeline and use actual QC fields. Reuse the committed helper.
- 0258 uses `--plugins-root` and finishes all matched full episodes with the same hashed intro and
  duration stage. Eight scheduled renders do not bound transport/backend retries or quota probes.
  Record backend-effective seed/settings and distinguish hard deadlines from between-segment budgets.

The vendor checkout remains reference-only. Published source inspection does not establish installed
runtime compatibility, model availability, hardware suitability or listener quality.

## Readiness evidence

### 0256

| ID | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | R1–R5 cover generator assets, validation, lifecycle and registry fixtures. |
| design | PASS | Private client lifecycle, bounded NDJSON, retained snapshot, controls and cleanup are frozen. |
| plan | PASS | Ordered API preflight, scaffold, adapter, tests, packaging and gates have concrete owners. |
| ac | PASS | Observable direct-entry, synchronous-executor and distribution tests bind requirements. |
| decisions | PASS | Closed Q&A resolves framing, fatal-worker retries and model provenance. |
| dependencies | PASS | No prerequisite; Content identity/native rate handoff to 0257 is explicit. |
| premises | PASS | Published wheel hash/API, current shared exports and both registry enumerations verified. |

### 0257

| ID | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | R1–R4 cover routing, cache identity, MP3 repair, join and downstream behavior. |
| design | PASS | Ordered sectionHashes, reconstructed QC/timeline and committed MP3 helper are explicit. |
| plan | PASS | Alias/cache/join/intro changes include failed-join retry and derivative-repair regressions. |
| ac | PASS | Stage shims and real ffmpeg fixtures observe routing, artifacts and stale-final recovery. |
| decisions | PASS | Closed Q&A resolves final fingerprint, section reuse and derivative repair. |
| dependencies | PASS | 0256 remains declared; 0258 consumes the completed render contracts. |
| premises | PASS | Current stage branches, QC field names, intro handling and helper implementation inspected. |

### 0258

| ID | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | R1–R4 require matched rendering, the same intro, measurement, listening and honest reporting. |
| design | PASS | Supported CLI flag, actual retry costs, effective seed controls and budget limits frozen. |
| plan | PASS | Short/full renders, intro/duration completion, listener review and report steps are bounded. |
| ac | PASS | Real artifact hashes, ffprobe and listener evidence observe the comparison outcome. |
| decisions | PASS | Closed Q&A resolves intro, cost accounting and differing backend controls/deadlines. |
| dependencies | PASS | 0257 remains declared, transitively including 0256; no production implementation owned here. |
| premises | PASS | Executor flags, stage argv, Gemini payload and shared retry/budget behavior verified. |

## Verification and handoff

- All three `spur task check <wbs> --as todo --json` gates pass. Expected prerequisite warnings remain
  for 0257/0258 until their predecessors complete.
- `spur feature check G14 --json` passes with eight expected unverified-scenario warnings; feature
  status remains backlog. Initial fix/strict preflight made no repairs.
- `spur rule run --preset recommended-pre-check --fail-on warning --json`: 57 rules, no findings
  or fixes. `git diff --check`: clean.
- The unrelated initial task-0252 edit disappeared during this session; it was not changed by this
  refinement. Other sessions/worktrees remain independent; do not overwrite their changes.

Machine-readable membership, section writes, checks, correction counts and checklist evidence live in
`.spur/run/g14-refine-ready-20261011-recheck/`. The prior report remains historical;
this recheck supersedes its current-tree premises. No old digest or attestation was invented.

Next operation: `$sp-dev-runall --feature G14 --auto`, respecting 0256 → 0257 → 0258.
No execution was chained from refinement.

Not run: application lint/build/tests, installation, model inference, listening or publication.
Runtime/hardware compatibility and audio quality remain execution risks.
