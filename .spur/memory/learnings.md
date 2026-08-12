## 2026-08-07 — task 0037 (feature B7: LLM-as-judge agent skills)

**Decisions**
- ADR-007 amdt 2026-08-07 supersedes the 2026-08-02 fourth-kind amendment. LLM-as-judge is an agent skill + `agent.run`, not a plugin kind. Taxonomy reverts to three kinds. The runtime never gained a fourth, so this is a doc-only correction.
- `VerdictSchema` referenced in the amendment as a kk-core utility was aspirational and never existed in `packages/kk-core/src/schemas.ts`. The verdict contract lives in the skill's output format (SKILL.md §"Verdict output contract") — consistent with the skill-first model.

**Patterns that worked**
- Fat-skill / thin-wrapper: one `plugins/kk/skills/kk-judge/SKILL.md` owns the evaluation procedure, rubrics, prompt template, and verdict contract; three `plugins/kk/agents/kk-judge-*.md` wrappers fix a rubric and forward. Zero evaluation logic duplicated.
- Workflow gating via `agent.run` + `shell`/`jq` guard on the verdict file — no engine work, no new plugin kind.

**Gotchas**
- `spur task verdict --from-answer` parser: AC evidence must be `command` type (executable) for behavior-bearing scenarios; `static-ref` yields PARTIAL with "Executable evidence missing" even when the prose is correct. The evidence-rule wants commands that can be run.
- Pipeline `review`/`verify`/`record` stages shell out to `omp`, which routes to Bedrock; an expired AWS security token (HTTP 403) fails the whole stage. Recovery: complete remaining stages inline as the host session (which is itself omp), re-deriving the verdict via `spur task verdict --from-answer` and running `spur task record`/`update done` directly.

## 2026-08-12 — task 0042 (feature B6: kk fanin merge command)

**Decisions**
- New command module `apps/cli/src/fanin.ts` as a sibling of `invoke.ts`, registered via Commander in `cli.ts` (ADR-006 boundary). Command modules stay commander-free: `runFanin(argv)` owns the whole CLI contract (flag parsing, exit codes), so it is standalone-testable without the commander layer.
- Dedupe identity is the Doc `id` (kk-core contract); first-seen occurrence wins, later duplicates contribute only their source to `metadata.sources` (spec §2.1/§2.2). Rejected last-wins: first-wins preserves the earliest source's content and matches the spec's identity rule.
- Provenance entries are `{ file, sourceUri? }` objects, appended in `--in` flag order; documents keep first-appearance order (§2.3). Pure function `mergeDocLists(inputs, sources)` keeps merge/dedupe logic separate from CLI I/O so tests drive it directly.
- Exit-code contract: 0 success, 1 file error (missing/unreadable/invalid-JSON/schema-violating input — every error names the offending file), 2 usage error. Inputs validated against kk-core `DocListSchema` at the boundary; never mutated (each merged doc is a fresh copy).
- Deferred (documented, not silent): spec §1.2's `--dedupe id|uri|none` secondary-rule flag — id dedupe (default) is the only requirement; add the flag if a uri-dedupe consumer appears. Review classified this CHANGED vs the spec's CLI surface but PASS-acceptable because the task's `### Design` never committed to the flag and the Solution note asserts goal-equivalent intent.

**Patterns that worked**
- Pure function + `runXxx(argv): Promise<number>` handler + commander registration, with the commander action re-serializing parsed options back into an argv slice so `runFanin` re-parses. Slightly redundant (P4 review finding — `invoke` hands an options object instead), but keeps the handler commander-free and gives it its own exit-code contract.
- Repeatable flags need a collector function: commander is last-wins on repeated options by default — `.option('--in <path>', ..., collectIn, [])` with a push-accumulator is required.
- Non-zero propagation: the commander action calls `process.exit(code)` when `runFanin` returns non-zero so the binary fails loud; `runFanin` alone only returns a code.
- Tests layered three deep: unit tests on `mergeDocLists` (14 tests covering dedupe, provenance order, deterministic ordering, within-file dup, empty inputs, no-mutation invariant, sourceUri carryover), `runFanin` CLI-path tests, and an end-to-end test through commander in `cli.test.ts`.

**Gotchas**
- `parseArgs` consumes any token after `--in` as the path value, so a value beginning with `-` (e.g. `--in --out x.json`) is swallowed as a file path and surfaces as a file error (exit 1) rather than a usage error (exit 2). Pathological input; fails loud either way — accepted.
- kk-core schemas are reused read-only; validation at the CLI boundary means schema changes surface as file errors naming the file, which keeps error messages actionable.

## 2026-08-12 — task 0043 (feature B6: kk fanout dispatch with retry-from)

**Decisions**
- New `apps/cli/src/fanout.ts` registered as `kk fanout` (ADR-006 sibling). Sequential per-target dispatch — engine-level parallelism explicitly rejected (ADR-007 R4, feature scope). Rejected retry-all-on-failure: spec §5 retries only prior failures.
- Kept `--retry-from` in the same CLI file instead of a separate task: it is a flag-level feature with the same review gate; a child rubric would have scored ~4 (below the 5 decompose threshold). Rejected split recorded in the task file.
- DI for transport: `runFanout(argv, deps?)` with `deps.dispatch` lets tests inject fake transports — 21 tests exercise failures, retry, and narrowing without any real publisher. Default dispatch runs each target's publish-plugin entry with the same `--in`/`--out` contract as `kk invoke`.
- Exit codes per spec §4: 0 all succeeded, 1 partial/total failure, 2 CLI/input error (malformed flags, invalid content, unresolvable publish plugin). Dispatch rejections AND `ok:false` results are both recorded as failed with the error — failed-loud.
- Retry semantics (§5.1): prior published/skipped targets are carried as `status: "skipped"` with their prior `url`/`id` preserved; only prior failures (or still-unpublished `--target` names) are re-dispatched; a fresh aggregate is written. `selectRetryTargets(prior)` is a pure function returning exactly the prior failed targets — retry set is always a subset of prior failures.

**Errors hit and resolved**
- P3: `kk fanout` initially exposed no `--plugins-root` option while every sibling plugin-aware command (`invoke`, `plugins list`, `plugins doctor`) has one; the runner hardcoded `./plugins` relative to CWD and the test-only `deps.pluginsRoot` couldn't be set from the CLI (verified: `--plugins-root` → commander "unknown option", exit 1). Resolved by adding the option and threading it into `runFanout`.
- P3: output write failure returned exit 1, conflating a target-failure signal with an output I/O error under spec §4; `spur workflow` reads exit 1 as "some targets failed" when nothing was published and no result was written. The spec's exit-2 (CLI/Input Error) bucket fits a bad `--out` path better — align or extend the exit-code contract.
- P4: temp-file leak — when a plugin writes its result file then exits non-zero, `pluginDispatch` throws before the `rmSync(outTmp)` finally runs (verified empirically: two `kk-fanout-*` files left in the OS tmpdir). Fix: wrap spawn+parse in one try/finally.
- P4: N+1 plugin discovery — `validateTargets` scans once, then `pluginDispatch` re-runs `discoverPlugins` per target. Fix: hoist a single discovery into `runFanout` and pass it down.
- P4: `readAggregateResult` validates shape but not consistency (`summary` counters vs `targets.length`, `ok` vs summary, per-entry `ok` vs `status` are never cross-checked). Self-generated results are always consistent; only hand-edited priors misbehave. Low impact, accepted.
- P4: `content` parameter is dead in `fanout()` (`void content;`) — payload actually flows through the dispatch closure; retained only to match the designed signature. Drop or pass content through dispatch explicitly.
- P4 (architecture, C1 weak locality): plugin-entry execution (resolve entry → spawn with `--in`/`--out` → parse `ResultSchema`) is duplicated between `invoke.ts` and `fanout`'s default dispatch — extract a shared `runPluginEntry` helper used by both if a third consumer appears.

**Patterns that worked**
- Transport injection (fake publish plugins) as the test seam: tests cover success, non-zero exit, and wrong-kind rejection through the real plugin-entry spawn path — the risky spawn/parse code is exercised end-to-end without network side effects.
- Skipped-carry retry semantics: published targets stay published in the new aggregate (with url/id), only failures re-dispatch — mirrors real publish idempotency expectations and makes `--retry-from` safe to run repeatedly.
- Same `--in`/`--out` plugin-entry contract as `kk invoke` reused for default dispatch — one convention across sibling commands, even though the execution code itself is duplicated (see P4 above).
- Review verification discipline: each review finding was empirically verified (`--plugins-root` unknown-option reproduction, tmpdir leak count) rather than asserted; final gate ran `bun test tests/fanout.test.ts tests/cli.test.ts` → 40 pass, `bun run typecheck` clean, plus CLI smoke with fake plugins (all-success exit 0, partial exit 1, retry-from re-dispatches only failures, exit reflects the new aggregate).

**Gotchas**
- Batch verification summary: `bun test` 59 pass / 0 fail (21 new fanout tests; fanout.ts 91.6% lines / 95% funcs coverage). Pipeline verify is verdict-based and does not measure code coverage — coverage numbers come from the test run, not the verify stage.
- Both B6 commands share the same handoff pattern (commander action rebuilds argv slice for the `runXxx` handler) — consistent within the batch, but a deliberate divergence from `invoke`'s options-object handoff; review flagged aligning if a third utility subcommand appears.
- Spec-referencing comments (`spec §2.1` etc.) in code made the review traceability pass quick and kept implementation vs spec drift explicit — used consistently in both modules.

