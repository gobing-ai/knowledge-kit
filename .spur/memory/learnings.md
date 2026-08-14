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

## 2026-08-12 — task 0044 (feature E4: harvest Zenn publish channel, `plugins/zenn-pub`)

**Decisions**
- Harvest strategy: absorb the wt-publish-to-zenn skill flow as a kk PublishPlugin mirroring `plugins/surfdash-pub` (E3) — publish-kind manifest, `--in`/`--out` invocation, `ContentSchema` → `ResultSchema`, fail-loud exit semantics per publish-plugin spec §2.5. Rejected wrap-in-place (a skill can't be discovered by `kk plugins`/composed by `kk fanout`) and browser/Playwright transport (audited Zenn CLI/GitHub path is the low-risk FileCli route).
- E2 invariants honored: no new transport kind, core schema, CLI command, or shared mapper; Zenn-specific mapping stays inside the plugin. Secrets env-only (`ZENN_REPO`, inherited git credentials) — never in `plugin.json` or Result metadata (spec §2.4).
- Deliberate deviation from E3: validation failure writes an error Result to `--out` (spec §2.5 literal) where Surfdash throws without writing. Result shape and fail-loud exit semantics unchanged.

**Errors hit and resolved**
- `Bun.spawn` must pass `env: process.env` explicitly — env overrides (e.g. PATH-injected mock bins) silently don't apply otherwise. Root cause found while testing.
- Review P2 (major, PARTIAL verdict): `resolveArticleFields` ran twice per publish — once directly, once inside `mapContentToZennMarkdown`. With a short title and no `metadata.slug`, `generateZennSlug` re-rolls `Date.now()` per call; straddling a millisecond boundary makes `new:article --slug slugA` and `writeFile slugB` diverge, and `git add .` commits both — a stray Zenn template article ships while Result url/id track slugB. Fix: resolve fields once in `publish` and render from the resolved values. Tests missed it because the mocked-CLI title was 24 chars (no timestamp suffix) — fixtures with deterministic slugs can't catch nondeterminism.
- Review P3: `git add .` stages the entire Zenn repo, sweeping unrelated working-tree changes into the publish commit; the wt skill's own reference uses scoped `git add articles/<slug>.md`. Also propagates the P2 stray file.
- Review P4: `ZENN_SLUG_PATTERN` enforces min-12 but not max-100, so an overlong `metadata.slug` fails only later in the CLI; `generateZennSlug` with an all-punctuation title yields a sub-min-12 slug (inherited from wt `generateSlug`) — fails loud but generated slugs should be guaranteed valid.
- Review P4: lazy `require('@gobing-ai/publish-harness')` is a CJS-ism in an ESM package; static top-level import is cleaner.

**Patterns that worked**
- Offline harness: `FakeFileCliTransport` (via `KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake'`, same switch as E3) + a spy transport + mocked npx/git bins injected on PATH. All child-process paths tested with zero external effects; no network in the suite.
- Result contract identical to E3: `{ok, target: 'zenn', url: https://zenn.dev/articles/<slug>, id: slug, message}`; every path goes through `ResultSchema.parse` and test outputs are re-validated with `ResultSchema.parse`.
- Fail-loud probe: `env -u ZENN_REPO bun plugins/zenn-pub/src/index.ts --in … --out …` → exit 1, `ok:false` error Result written to `--out`, diagnostic on stderr — a real probe of the §2.5 contract, not just unit tests.
- `generateZennSlug` audited from the wt skill: lowercase `[a-z0-9-_]`, min 12 chars (timestamp base36 suffix), max 100.

**Gotchas**
- Verify pipeline verdicts don't measure code coverage — coverage numbers come from the test run (`bun test --coverage`), not the verify stage.
- Deterministic-only fixtures hide nondeterministic logic (see P2): when a function uses time as entropy, tests need a fixed-slug or fixed-clock path to pin it.
- Deliberate-deviation notes belong in the task file (E3-throws vs §2.5-writes) or reviewers flag it as drift on the next task.

## 2026-08-12 — task 0045 (feature E4: harvest Qiita publish channel, `plugins/qiita-pub`)

**Decisions**
- Qiita harvested as `QiitaApiTransport`: Bun native `fetch` POST to `https://qiita.com/api/v2/items` with `Authorization: Bearer <token>`, token read env-only (`QIITA_TOKEN`). Transport `kind` stays `'file-cli'` — E2 (task 0002 audit) already classifies the Qiita token API under File/CLI; no `PublishTransport` contract change. No HTTP-client dependency added.
- `renderQiitaMarkdown` split from the mapper so `publish` resolves fields once and the rendered article agrees with the API payload. `private` defaults `false`, honors `metadata.private`, and falls back to `!metadata.published` so the shared E2 `published` flag composes across channels (E3/E4 convention).
- R6 fan-out proof lands as a test-only addition to `apps/cli/tests/fanout.test.ts` — production fan-out code (`apps/cli/src/fanout.ts`) untouched. Also shipped a small `packages/kk-core/src/registry.ts` `.sort()` change for readdir determinism (duplicate-name first-wins, stable list order across filesystems).

**Errors hit and resolved**
- Review P3: `slugify` uses `\w` without the `u` flag (ASCII-only) — a non-ASCII tag (e.g. Japanese, plausible for Qiita) or punctuation-only tag collapses to an empty slug → `tags: [{name: ""}]` → HTTP 400 with an opaque diagnostic. Consider collapsing empty slugs into a clear mapping-time validation error.
- Review P3: `mapContentToQiitaMarkdown` is exported and tested but orphaned — the transport sends `payload.content.body` + resolved fields straight to the API (frontmatter embedded in the API body would render literally). Correct behavior, but unlike E3/E4 transports it doesn't consume its mapper's output; document it as the Qiita-CLI-facing surface or drop the "rendered article and API payload agree" rationale.
- Review P4: duplicate tags after slugification (e.g. `['Web Dev','web-dev']` → two `web-dev`) → API 400, no dedupe — resolved in `resolveQiitaFields` (dedupe + empty-slug validation error).
- Review P4: `parseArgs` sits outside `main`'s try/catch — unknown/duplicate flags throw an unhandled rejection (non-zero exit, stack noise); same convention as E3/E4, consistency noted not a regression.
- Review P3: all 11 Solution line anchors stale by exactly +4 — anchors resolved to adjacent comments/blank lines, not the named symbols. Anti-stale-citation rule: re-anchor on a later pass.
- Review P4: `response.text()` reads the error body unbounded into the error Result; capped at 1000 chars in the non-2xx diagnostic.

**Patterns that worked**
- Mocked `fetch` + `FakeFileCliTransport` + spy transport: success asserts request shape (Bearer header, payload, tag dedupe), HTTP 403 rejection, network rejection, missing-token (no fetch), unmappable tag → error Result without fetch — full failure surface offline.
- R6 pair-composition proof: `runFanout` test dispatches one Content to `--target zenn-pub --target qiita-pub` through the real plugin entries (`spawnPluginEntry`) with `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake`; asserts exit 0, `targets == ['zenn-pub','qiita-pub']`, each `status:'published'`, `summary {total:2, succeeded:2}`. Isolated re-run via `-t "R6"` pins the proof independent of the rest of the suite.
- Tag handling: slugified form is always Qiita-API-acceptable (alphanumeric/hyphen/underscore only); dedupe happens in field resolution, not at render time.
- Unreachable-code honesty: `import.meta.main` bootstrap guard is the sole uncovered function (unreachable under module import) — coverage target still met; noted rather than contorted around.

**Gotchas**
- Error-body capping matters in API transports: unbounded `response.text()` in error Results is a diagnosability/time bomb; cap it in the Result path.
- A mapper can be contract-complete (R1: renders markdown with frontmatter) yet orphaned at runtime when the API takes structured payloads — keep the runtime path's consumption and the R1 surface's purpose explicit or reviewers will flag the mismatch.
- Fan-out tests against real plugin entries need the fake-transport env var threaded through the spawn — the `KNOWLEDGE_KIT_PUBLISH_TRANSPORT` switch is now the cross-plugin offline convention (E3/E4/E5).

## 2026-08-12 — cross-task (E4 wave: 0044 + 0045)

**Conventions discovered**
- Publish plugin skeleton, now ×3: `plugin.json` (`name: <target>-pub`, `kind: publish`, `entry: ./src/index.ts`), `package.json` with only `@gobing-ai/kk-core` + `@gobing-ai/publish-harness` + `@gobing-ai/utils` (`workspace:*`), `tsconfig.json` extends `tooling/typescript/base.json`. Wiring deps via `bun install` bumps the workspace count (23 → 24).
- `getPublishTransport` default vs `FakeFileCliTransport` under `KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake'` — the standard offline test seam.
- Result contract: `{ok, target, url, id, message}` / `{ok:false, target, error}`; every path `ResultSchema.parse`-validated; tests re-validate outputs.
- Exit-code contract: 0 success / 1 failure, stderr diagnostic; `import.meta.main` entry exits with `main()` code.
- Mock child-process bins via PATH injection for FileCli transports; mock global `fetch` for API transports. Both keep every test offline.

**Patterns that worked**
- Audit-first harvest: read the wt skill's scripts (slug generation, API URL/payload builders, github-integration reference) and port decisions into the task's Design section before scaffolding — every ported line traces to an audited source.
- Error Results written to `--out` before throwing (spec §2.5 literal) — fanout reads the aggregate result file even on failure.

**Gotchas**
- Architecture debt is now real, not hypothetical: `slugify` is verbatim ×3 and the IO/CLI skeleton (`processPublishIO`/`writePublishResult`/`main`/`getPublishTransport`, ~90 lines) is near-verbatim ×3. Both were deferred by E2's per-task "no shared mapper" invariant; the top deepening candidates are extracting `slugify` to `@gobing-ai/kk-core` and a `createPublishPlugin({targetName, makeTransport, mapContent})` factory in publish-harness — trigger when the next channel lands.
- `kind: 'file-cli'` on a network token transport is semantically loose but explicitly classified by E2 — informational, don't "fix" it without an ADR.
- Env-dependent paths (real `npx zenn` + `git push`; real `POST /api/v2/items`) are deferred by design; success and every failure path are covered by mocks/fakes, and the deferred gap is stated in the task file rather than silently skipped.
## 2026-08-12 knowledge-kit (D4 STORM generator batch: 0046, 0047)

- **Verdict AC rows must carry exact feature scenario titles.** The L4 scenario-verified check matches verdict-artifact `acceptanceCriteria` row ids against feature scenario titles via `normalizeTitle` (strips `Scenario: ` with colon and `R<N>` prefixes) or the `AC-N` alias. Verify subagents authored rows as `Scenario R1 — <shortened title>` (no colon, dropped words) → every D4 scenario stayed `L4.scenario-unverified` and the feature `verifying → done` gate blocked even with PASS verdicts. Fix: regenerate the answer files with `Scenario: R<N> — <exact feature title>` rows and re-run `spur task verdict --from-answer`.
- **Real-runner tests can litter stray `.spur/` DBs.** A test that actually invokes `spur agent run` with cwd inside a workspace dir creates `plugins/<pkg>/.spur/` (spur.db, logs, token ledger) — untracked 2MB junk that pollutes `git status`. Run spur-invoking tests with cwd pinned to the repo root (or mock the binary), and remove the generated dir after.
- **/sp:dev-unit pre-transitioned the task to `testing`.** The task-pipeline's record step owns `wip → testing`; the test-stage subagent moved the task early via `spur task update <wbs> testing`. Harmless (the later `--transition testing` is a no-op) but a deviation — the unit stage should leave status transitions to record.
- **Inline batch driver worked cleanly**: run-link provenance (`spur task run-link --source inline-full`), per-stage native-subagent dispatch with filesystem validation, and the `record → done` guard all held. Review caught a real P1 (envelope not unwrapped) that unit tests missed — the review→verify→fix loop paid for itself.

## 2026-08-12 — task 0048 (feature F2: harvest WT topic core as kk-topic fat skill)

**Decisions**
- One fat `plugins/kk/skills/kk-topic/SKILL.md` with four operations (`create | init | outline | draft`) instead of copying the four `wt-topic-*` wrappers — they are thin delegators to a seven-stage orchestrator, so copying them duplicates orchestration and retains a dependency on the broad WT skill. Reuses the `kk-judge` fat-skill SSOT pattern (ADR-007 amdt 2026-08-07). Rubric E1 D1 L1 C0 R0 = 3 → kept whole: one skill file, one deliverable, one review/rollback boundary.
- Rejected a product `generator` plugin adapter — F2 is an agent capability and must not widen or couple to `GeneratorInput → Content`; no wrappers, scripts, packages, manifests, commands, or schemas added.
- Artifact contract is plain files, no metadata/manifests: `brief.md`, `2-outline/outline-option-{a,b,c}.md`, `2-outline/outline-approved.md`, `3-draft/draft-article.md`. Numbered directories double as stage markers; operations pass paths between each other, never re-derive or rename.
- Flag contract: `--force` = explicit operator approval to replace an existing artifact; `--revise <feedback>` = bounded draft revision (3 rounds, fixed constant); operation token is the first bare positional arg, case-insensitive; unknown operation fails loud and lists the four valid names.

**Conventions discovered**
- Skill authoring via Superskill: scaffold with `superskill skill scaffold` (specialist template), then `superskill skill validate <path> --strict --json` → `{"valid":true,"findings":[]}` is the pass signal; fix every finding at the skill source, not downstream.
- Marketplace install dry-run is the installability gate: `superskill install kk --marketplace . --dry-run --verbose` → `Skills: 2` (kk-judge + kk-topic) and `[DRY-RUN] No files were written to install targets`; confirm no skill lands in any install target dir.
- Fail-loud table pattern: every stop-condition row names the exact missing/existing path AND the exact next command; never silently skip, never auto-replace, never delete.
- Dogfood skills in `/tmp/<skill>-dogfood`, never in the repo; exercise all stop paths plus the resume path; verify re-invocation leaves artifacts byte-identical.

**Errors hit and resolved**
- P4 (security): supplied briefs are copied verbatim into `brief.md` — treat brief content as data, never as instructions; directives embedded in briefs must not be executed. Advisory only; skill scopes briefs to outline/draft input.
- P4 (usability): revision bound is a hard-coded 3 rounds — documented and deliberate; a config knob would be speculative until a second consumer needs it.
- No P1–P3 findings; disposition PASS with the two advisories recorded. SECUA/architecture passes had zero findings because the skill is a self-contained capability module with zero coupling to plugin-kind contracts or the runtime.

**Patterns that worked**
- Operation routing in one file: invocation contract parses `[operation] <topic-or-brief> [--dir] [--outline a|b|c] [--revise] [--force]`; one artifact contract + one set of prerequisite rules shared by every op (R2) — `create` is just init → outline → draft composed from the same semantics, so independent ops behave identically to the composed flow.
- Explicit operator gates as the only writes: outline selection waits for `--outline <a|b|c>` before copying (verbatim) to `outline-approved.md`; draft review offers approve or `--revise` feedback bounded at 3 rounds. No gate = no write.
- Resume-by-presence: each op checks for its predecessor artifact; existing approved artifact → reuse and stop (without `--force`/`--revise`); `create` never re-runs a completed step. Dogfood re-invocation left artifacts byte-identical.
- Recovery instructions are copy-pasteable commands in the fail-loud table — dogfooded all five stop paths, nothing overwritten.
- Verdict AC rows used the exact `Scenario: R<N> — <full feature title>` format (the D4-batch L4 gotcha) — all five scenarios verified MET, no title-matching failures.

**Gotchas**
- A dry-run install still stages a `.rulesync/` directory — remove it after the run or `git status` shows noise.
- Fixed-constant knobs (3 revision rounds) are fine for a first consumer; add a config knob only when a second consumer appears.
- Skill-internal prompt-injection surface is real: any verbatim-copied input (briefs) is a data/instruction boundary — state it in the skill invariants.
## 2026-08-12 — A2 batch (0049, 0050, 0051)
- Commander 15 changed bare-invocation semantics: a program with subcommands and no action handler routes missing-subcommand to `help({error:true})` → exit 1; a root `.action()` disables the implicit `help [command]` command. Fix: keep createProgram action-free, handle empty argv in main() with `program.help()`, and call `.addHelpCommand()` explicitly only if a root action is ever needed.
- Subcommands copy `_exitCallback`/`_outputConfiguration` at creation time. `exitOverride()`/`configureOutput()` called after subcommand creation do NOT reach them — `kk help <cmd>` silently called `process.exit`. Re-inherit via `cmd.copyInheritedSettings(program)` after configuring, recursing into nested groups (`plugins list`).
- `process.exit` in test mocks (`process.exit = fn`) is brittle with Commander 15 exitOverride; prefer `main()` returning exit codes over mocked process.exit.
- CommanderError exit codes map 1:1 to process exit codes under exitOverride; fail-loud paths should `throw new CommanderError(code, ...)` instead of calling process.exit.
- bun's coverage threshold is enforced per-file (functions >= 90%); default-writer lambdas in main() need a no-options test to stay covered.
- fanout test R6 fails under `bun run --filter` (cwd = package dir) but passes from workspace root — a cwd artifact of `process.cwd()`-based plugins root, not a code bug.
- npm does NOT validate bin existence at pack time; `files: ["dist/"]` + prepack is what guarantees the tarball contains the artifact the bin keys name. Missing-bin installs fail silently (no shim created).

## 2026-08-13 — task 0052 (feature A21: reshape kk into two-layer executor and plugin nouns)

**Decisions**
- Two Commander groups as the only first-layer nouns — `registerExecutorCommand` (`commands/executor.ts`) and `registerPluginCommand` (`commands/plugin.ts`), one file per noun per ADR-010. Actions call the existing engines (`runInvoke` / `runFanin` / `runFanout` / `discoverPlugins`) and throw `CommanderError` — signatures unchanged, zero second implementations. Hyphenated verbs are canonical (`fan-in`, `fan-out`) with camelCase aliases; `add` deleted outright.
- Hidden aliases are `hidden: true` commands (or hidden delegation commands) calling the same action functions — no dual JSON shapes behind `list`/`doctor`, no visible aliases warning on stdout (would pollute `--json`). Approved one-release aliases, not a hard cut.
- `plugin status --json` is one unified contract `{ healthy, plugins, diagnostics }`: `missing_entry` attaches to the owning plugin's `diagnostics` and counts toward its `healthy:false`; tree-level codes (`misplaced`, `kind_mismatch`, `malformed`, `duplicate_name`) stay in top-level `diagnostics` and are never dropped just because they lack a `PluginRecord`. Exit 0 healthy / 1 any diagnostic.
- ADR-first: ADR-011 (nouns) plus ADR-006/ADR-010 amendments landed during planning, so R8 is doc-only and verified present rather than authored mid-commit.

**Errors hit and resolved**
- P2 (PARTIAL verdict, disposition needs-fix): Commander 15 renders group `.alias()` in help — the `plugin` group's `plugins` alias showed up as `plugin|plugins` in `kk --help`, violating the R1/R6 "not visible" sub-condition and contradicting the docs' "hidden aliases not listed" claim. Only `hidden: true` commands are omitted. Test blind spot: the help assertion matched `commandEntry = /^\s+(add|invoke|fanin|fanout|…/` but not the group alias. Resolved by replacing the group alias with a hidden top-level `plugins` delegation command carrying hidden `status`/`list`/`doctor` subcommands; the exact-list assertion `['executor','help','plugin']` now fails against the old defect.
- P4: `plugin status --kind <k> --json` filters `plugins[]` but reports `healthy`/`diagnostics` over the unfiltered tree — `healthy:false` can name plugins absent from `plugins[]`. Matches R5's "exit 1 when any diagnostic exists" wording; documented tree-wide health semantics in `docs/04_DESIGN.md` §1 rather than changing the contract.
- P4: flag declarations duplicated per verb between the executor group and hidden top-level aliases (~30 lines); and `runFaninAction`/`runFanoutAction` re-serialize commander options into an argv slice the engines re-parse (round-trip). Both pre-existing or invariant-preserving — recorded as advisory follow-ups (shared registration builder, typed options entry points), not changed.

**Patterns that worked**
- Thin registration modules: group + subcommand + hidden aliases all forward to the same action functions; no `process.exit` in command modules — sole exit seam is `index.ts`, `main()` maps `CommanderError` codes. `createProgram()` stays a side-effect-free factory.
- Design invariants written into the task and verified mechanically: `git diff HEAD -- apps/cli/src/{invoke,fanin,fanout}.ts` empty proves engines untouched; tree diagnostics verified with a `misplaced` fixture.
- Test suites drive `main()` end-to-end over tmp fixture plugin roots — registration, help names, engine exit codes (failing plugin entry's exit 3 surfaces), hidden-alias routing, and the unified JSON all exercised through the real binary path. Engine unit tests kept unchanged; only command-module tests rewritten.
- Review verification discipline paid off: the reviewer ran `kk --help` and caught the group-alias visibility the test suite missed; every finding (probe `kk not-a-noun` exit 1 names itself, `kk plugin status --kind bogus` exit 1, broken-root JSON placement) was verified by fresh run before being recorded. 5/5 chosen-approach claims DONE with one CHANGED nuance, stated explicitly.

**Gotchas**
- Commander 15 does NOT hide group `.alias()` from help — only `hidden: true` commands are omitted. Never assume `.alias()` is invisible; assert the exact visible command list (`['executor','help','plugin']`), which also catches regressions the regex-based check misses.
- `missing_entry` is per-plugin data (attaches to the owning record, counts toward its health), while discovery codes without a record are tree-level — the split is a contract, not an implementation detail; fixtures must cover both placements.
- Pipeline verify is verdict-based and does not measure code coverage (N/A for this task); manual CLI probes of exit codes and help output are the evidence that matters alongside the suite.
- Reviewer-run CLI probes (help text, alias routing, `--kind bogus`) caught what unit tests missed — on command-tree reshapes, probe the actual binary before approving.

## 2026-08-13 — task 0053 (feature B7: discover built-in and user plugins via a merged registry, ADR-012)

**Decisions**
- Merged multi-root discovery in `@gobing-ai/kk-core`: `discoverAllPlugins` + `resolvePluginRoots` (ADR-012), while `discoverPlugins` stays the per-root scanner with a new `origin` param defaulting to `'path'`. Root priority low → high: package-shipped builtin tree → `~/.kk/plugins` (user) → CWD `./plugins` (project, realpath-deduped against builtin) → `KK_PLUGIN_PATH` entries (path) → repeatable `--plugins-path` (path). A later/higher root shadows an earlier same-name plugin.
- `--plugins-root` remains the exclusive single-root override (isolation/tests, ADR-012 R4); `--plugins-path` is additive and repeatable. Combining them is a usage error → exit 2, enforced in every command module (ADR-012 R6). The merge function itself silently ignores `extraPaths` under an exclusive root (`resolvePluginRoots` returns early) — CLI enforcement is the only user-facing guard, so it must live in each command, not once in the shared resolver.
- New `shadowed` diagnostic code joins the tree-level set (`misplaced`, `kind_mismatch`, `malformed`, `duplicate_name`, `unreadable`). Losing manifest path is the diagnostic `path`; the winning manifest + origin is named in `reason`.
- `PluginOrigin = 'builtin' | 'project' | 'user' | 'path'` stamps every `PluginRecord`; `kk plugin status --json` surfaces it. A `--plugins-path` dir whose folder itself contains `plugin.json` is a single-plugin dir (kind from manifest, no collection constraint — ADR-012 R6 amendment); trees/collections still go through per-root ADR-009 scans.
- Builtin root (`resolveBuiltinRoot`) is found by walking up from the executing module (`import.meta.url` → dirname → up) to the first dir containing a kind collection — bundled CLI at `<pkg>/dist/index.js` → `<pkg>/plugins`; monorepo sources fall back to repo-root `plugins/`. Walk terminates at the fs root → `undefined`.
- R12 keeps two separate channels: B3 workflow template now shells `kk executor run <plugin> … --plugins-path ${vars.plugins_path}` (renamed from `plugins_root`); no `extensions.actions`/`extensions.guards` blocks, no product plugins as workflow extension modules.
- ADR-first: ADR-012 accepted + two amendments (dynamic extra paths, shipped status) recorded during the task; status moved `Accepted (design)` → `Accepted` in the same commit.

**Conventions discovered**
- Every discovery root is injectable (`DiscoverAllOptions`: `cwd`, `env`, `homeDir`, `packagePluginsRoot`, `extraPaths`, `pluginsRoot`) so unit tests never touch a real `$HOME` or CWD. All tests pass explicit roots; the D2 test omits `packagePluginsRoot` to exercise the real walk-up against the repo-root `plugins/` tree (asserts 5 plugins, all origin builtin, no `plugins/kk`).
- One discovery per run: `runFanout` hoists a single `discoverAllPlugins` and passes `DiscoveryResult` down to `validateTargets` + `pluginDispatch` — the 0043 P4 N+1 discovery finding resolved here, not just patched per command.
- All plugin-aware commands (invoke, fanout, plugin status) route through the merged entry point so a single-plugin-dir root behaves identically on every command — the P3-4 carryover from 0043's review (missing `--plugins-root` + per-target discovery) closed.
- Repeatable flag collector: commander is last-wins on repeated options → `collectPath(value, acc)` push-accumulator (same pattern as 0042's `collectIn`).
- Exit-code contract held: 0 healthy / 1 any diagnostic / 2 usage error; exclusivity thrown as `CommanderError(2, 'kk.plugin.root-path-conflict', …)` in command modules, `EXIT_INPUT` in fanout's argv parser.
- Spec-referencing comments (`ADR-012 R3/R4/R6`, `D2`) in code kept the review traceability pass quick and made implementation-vs-design drift explicit.

**Errors hit and resolved**
- Realpath collision (R9): a CWD `plugins/` tree that is the same realpath as the builtin tree (symlink) double-scanned and would emit spurious `duplicate_name`/`shadowed` noise. Fixed with `sameRealpath` + `scannedRealpaths` set; the symlinked project tree is scanned once and keeps `origin: builtin`.
- Single-plugin-dir unreadable manifest: `plugin.json` exists (classification fires) but cannot be read — must surface an `unreadable` diagnostic, not vanish silently. Pinned with a `plugin.json`-as-directory fixture (EISDIR), mirroring the new invoke tests where an input/output path passes `existsSync` but throws `EISDIR` on `readFileSync` → exit 1.
- Missing/broken `--plugins-path` values: empty value, repeated flag, and missing-argument parse paths each got an explicit error and exit-2 test (`--plugins-root requires a directory path`, `may be specified only once`, `--plugins-path requires a directory path`) — the argv parser is exhaustively probed, not just the happy path.
- N+1 discovery and per-command root semantics drift (0043 P3/P4): both fixed by the single hoisted merged discovery, eliminating the divergence where fanout's hardcoded `./plugins` default and invoke's root semantics disagreed.

**Patterns that worked**
- Injected-roots fixture pattern: `writePlugin(root, kind, name)` helper + every test passing `{ packagePluginsRoot, homeDir, cwd, env }` — deterministic, no real home, no real CWD; priority-order assertion `['builtin','user','project','path','path']` pins both root order AND origin stamping in one test.
- Requirement-prefixed test names (`R1 — …`, `R5 — …`) tied each test to an AC row, making the verdict-artifact evidence column mechanical (`registry.test.ts:210` style line anchors verified by the reviewer).
- Symlink fixture for R9 (`symlinkSync(builtin, cwd/plugins, 'dir')`) — the realpath edge pinned mechanically instead of hand-waved.
- CLI tests via `runCaptured` (code + out + err): R6 asserts `origin` fields in status JSON, R10 drives a real plugin-entry spawn through a single-plugin dir (fanout R10), R11 asserts exit 2 + `mutually exclusive` message — through the real binary path, not mocked handlers.
- The merged entry point as the single choke point: `discoverAllPlugins` is the only discovery call in invoke/fanout/plugin status, so R4 (exclusive), R10 (single-dir union), and R11 (flag conflict) behaviors are consistent across all three commands by construction.

**Gotchas**
- `KK_PLUGIN_PATH` splits on `:` and silently skips entries that aren't directories (`isDirectory` check) — a typo'd path yields no diagnostic. Same for non-existent `--plugins-path` dirs.
- Shadowed diagnostic path is the **losing** manifest, not the winner — tests must assert `shadow.path === builtin manifest` and read the winner from `reason`.
- Project origin is invisible when the CWD tree collides with builtin (R9) — a test asserting all four origins must use a cwd whose `plugins/` is a distinct tree.
- `resolveBuiltinRoot` walk-up is path-sensitive: tests running from a package dir vs repo root can resolve different builtin trees — always inject `packagePluginsRoot` except in the D2 test that deliberately exercises the walk.
- Verify pipeline remains verdict-based and does not measure code coverage (N/A here); the 84-test targeted run (registry 32 new + invoke + plugin + fanout) at 0 fail is the evidence, alongside exit-code CLI probes.
- Pipeline verdict PASS with only P4 findings; uncommitted in the working tree (23 files, +1110/−100) at task close — commit still pending.
