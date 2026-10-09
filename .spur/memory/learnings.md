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

- **Verdict AC rows must carry exact feature scenario titles.** The L4 scenario-verified check matches verdict-artifact `acceptanceCriteria` row ids against feature scenario titles via `normalizeTitle` (strips `Scenario:` with colon and `R<N>` prefixes) or the `AC-N` alias. Verify subagents authored rows as `Scenario R1 — <shortened title>` (no colon, dropped words) → every D4 scenario stayed `L4.scenario-unverified` and the feature `verifying → done` gate blocked even with PASS verdicts. Fix: regenerate the answer files with `Scenario: R<N> — <exact feature title>` rows and re-run `spur task verdict --from-answer`.
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

## 2026-08-14 — tasks 0054 + 0055 (feature C3: STORM topic-research workflow)

**Decisions**

- 0054 is a research-artifact ticket (wayfinder:research): the deliverable is a cited contract, not code. Solution holds 8 labeled blocks — `--in` JSON schema, env/auth, call sequence, Doc mapping, fail-loud table, C1 tension note, dated citations, handoff to 0055 — so `plugins/ingestions/web-search` can be scaffolded without an operator round-trip. wayfinder one-ticket rule: no implement tickets graduated from the research session.
- Ingest contract locked to one HTTP call: `POST https://api.firecrawl.dev/v2/search` with `query` = topic (verbatim, no v1 query expansion), `limit` = maxResults, `scrapeOptions.formats: ["markdown"]` — two-step search-then-scrape rejected because no blocker exists (markdown returns per result in one response, fetched 2026-08-14).
- Doc mapping: `id` = `sha256(url).hex.slice(0,16)` (same id-stability idea as karakeep-local's path hash, applied to resource URI), `body` = scraped markdown (required), `title`/`sourceUri` SHOULD (D4 `assertKnownEvidence` citation gate needs `id`, and `storm.ts:326` maps `sourceUri`/`title` onto `Content.references`), `mediaType: text/markdown`, `metadata {query, rank, position, scraped_at}`. No dedup pass in v1 — identical URLs → identical ids.
- C1 §2.4 vs D4 tension resolved row-by-row: zero search hits → `[]` + exit 0 (follows C1; D4 writes Notice Content — accepted v1 behavior); hits > 0 but zero usable bodies → **deliberate narrow departure**: exit 1, no `--out` (hides a scrape outage and feeds D4 a useless Notice indistinguishable from a legitimately empty topic); partial failures → skip + warn + exit 0 (follows C1).
- 0055 clones the B3 state-machine shape minus publish: `.spur/workflows/kk-storm-research.yaml` with `prepare → ingest → generate → done/failed`; `prepare` materializes `${vars.topic}`/`${vars.maxResults}`/`fixture: true` into `${vars.work_dir}/topic.json` via `jq` (no new invoke flag). Success edges use `guard: { kind: always }` — deliberate deviation from the Design's "action-ok" wording (see Errors).
- Fixture stub is the v1 `web-search` entry: no network, no Firecrawl SDK; `fixture: true` always set by the workflow so the stub never bills. After verify's P3 fix, a non-fixture run exits 1 with "live Firecrawl not implemented in v1" rather than silently emitting fabricated docs.

**Conventions discovered**

- Secrets are `process.env`-only for API sources (C1 §1.3): `FIRECRAWL_API_KEY` confirmed from Firecrawl's own curl sample, never in `--in` or `plugin.json`, never in workflow YAML vars.
- `kindContract('ingestion')` = `{ input: null, output: DocListSchema }` — ingest plugins take no kind input and must emit schema-valid `Doc[]` through the `--out` file (C1 invoke shape `kk executor run <plugin> --in <json> --out <docs.json>`).
- New workspace plugin member: copy `plugins/generations/content-gen/package.json` + `tsconfig.json` (workspace glob `plugins/ingestions/*` already covers it — no root `package.json` edit needed). Do NOT copy karakeep-local's missing-package.json layout or C2's test gap.
- The repo CLI is `bun apps/cli/src/index.ts`; plugin spawns go through the sanctioned `apps/cli/src/invoke.ts` path (`runInvoke` in tests), never a hand-rolled spawn.
- Workflow vars are all strings (`spur workflow --vars` requirement); numeric-looking vars (`maxResults: "8"`) get coerced at materialization time (`($maxResults | tonumber)` in jq).
- Dated citations everywhere: every external claim carries a fetch date (2026-08-14) and file:line for local refs; review re-fetched the live Firecrawl docs during review to re-verify — no drift found.
- Task AC is `ac_numbering: task-local` (C3 is a wayfinder-map without BDD AC) — expected L4 subset warnings vs the feature AC are not defects.

**Errors hit and resolved**

- `action-ok` guard denies in `--dry-run` (the batch's headline finding): the spur engine (@gobing-ai/spur@0.3.47) replaces every onEnter/onExit action with `EMPTY_OUTCOME` in dry-run mode, so `lastActionResult` stays `undefined` and the builtin `action-ok` guard (`lastActionResult?.ok === true`) always denies — the walk falls to the unguarded `failed` edge and dry-runs to `failed`. Proven empirically: B3's own template (`kk-ingest-generate-publish.yaml`, which uses action-ok) dry-runs to `failed`. Fix: linear success edges use `guard: { kind: always }` (repo convention — `task-pipeline.yaml:232,237,254`); real-run safety unchanged because a failed shell action short-circuits at the state under the default `onError: fail` policy. Review verified this against engine source before approving.
- P3 at review (0055): live-mode fail-soft — `fixture` absent/false still emitted fixture Docs + exit 0, a surprising recovery that could feed fake citations into content-gen. Fixed at verify: exit 1 + stderr when `fixture !== true`, no `--out`; tests updated and a regression test added (12 pass).
- P4 nits at review (0054, research ticket): `limit` clamp-vs-reject contradiction (Block 1 "API clamps" vs Block 3 "400 on out-of-range" — OpenAPI constrains but doesn't document runtime behavior; fixed by one line: plugin validates positive int, out-of-range lands on the HTTP-error row); degenerate 200 body (`success:true` with `data` absent would throw on `data.web` — clause added mapping `data` absent → malformed-response row); line-number drift in Block 6 (`:23` vs `:24`). None blocked 0055.
- Stale global `kk` bin on PATH lacks the `executor` verb (reports 0.0.3 today; 0055's session noted 0.0.4 — either way a pre-executor build with `add`/`invoke`/`fanin`/`fanout`/`plugins` only). Resolved: run the repo CLI (`bun apps/cli/src/index.ts`); verify stage must use the repo CLI too.
- `spur task verdict --from-answer` parses ONLY markdown tables (`| Req | Status | Evidence |` and `| AC | Status | Evidence Type | Evidence |`); prose answers degrade to UNKNOWN. Both tasks' verify answers are table-shaped (see `.spur/run/0054-verify-answer.txt`, `0055-verify-answer.txt`) — keep that shape.
- Native-subagent dispatch for pipeline `agent.run` stages: rd3 specialist agents (super-coder etc.) re-spawn a pi/omp subprocess that fails with "No model selected" — use generic `task` agents for inline stage dispatch instead.

**Patterns that worked**

- Contract-first ticket chain: 0054 writes the 8-block contract with frozen premises ("confirm or correct, do not silently replace"), 0055 implements against it; the Block 8 handoff listed exactly the `--in` keys the workflow must write, and the Solution's keys matched the Design's starting keys exactly — zero drift, no re-derivation.
- Verify remediates review findings in the same stage (`--fix all`): P3 fixed in code with a regression test, P4s explicitly dispositioned (fixed / recorded-with-comment / kept-with-verification) — the verdict artifact then carries each disposition as evidence.
- Fixture-with-citation-survival: canned `Doc[]` built to the 0054 Doc mapping (stable 16-hex ids, sourceUri/title/markdown) so every fixture Doc survives D4's `assertKnownEvidence` gate — the stub is a faithful downstream stand-in, not fake-shaped data.
- Determinism test asserts ids only (`scraped_at` is per-run by design — informational P4, no rework); `maxResults` caps the list so `maxResults: 1` yields one Doc (conformant with cap semantics, only the Design's "≥2" wording affected).
- Smoke before pipeline verify: chain test with the repo CLI — `executor run web-search --in topic.json --out docs.json --plugins-path ./plugins` → 3 schema-valid Docs; the jq materialization command verified verbatim; `content-gen` generate intentionally not run to completion (it makes live STORM model calls).
- Review re-verification discipline: reviewer re-fetched Firecrawl live, re-ran the dry-run, and verified the guard deviation against engine source before recording findings — every finding pinned to evidence.

**Gotchas**

- Success edges in dry-run workflows: never rely on `action-ok` for the *success* path — in `--dry-run` no actions execute, so action-ok always denies. Use `guard: { kind: always }` on linear success edges; real-run failure is handled by the default onError=fail policy, not the guard.
- In workflow YAML, quote the `$schema` value (`"@gobing-ai/spur/schemas/state-machine-workflow.schema.json"`) or YAML may mangle it.
- Zero-hit vs zero-body are different failure classes: only the true empty result may exit 0; "hits but no usable bodies" must fail loud or it is indistinguishable from an empty topic downstream.
- A spur command run with a subdir cwd creates a nested `.spur/` state dir (evidence: `docs/.spur/` with `spur.db` + `context/token-ledger.jsonl` exists in the tree) — always run spur commands from the repo root and clean up nested state dirs before commit.
- Both tasks' working-tree changes are uncommitted at batch close (staged/added files incl. the workflow YAML, web-search plugin, and task files) — commit pending.
- Verify pipeline is verdict-based and measures no code coverage; the evidence that matters is `spur workflow validate`/`run --dry-run --json`, the plugin test run (12 pass), and CLI exit-code probes via the repo binary.

# 2026-08-14 — Feature C4 batch (0056–0060)

## 0056 — Specify the kk config, works workspace, and workflow-install contract

- **Convention (frozen names):** Design frozen names (config keys `works_dir`/`workflows_dir`/`defaults.maxResults`/`defaults.fixture`, topicId algorithm, 6-file works layout) are copied verbatim into the `## Solution` contract — no renames; dated citations must all resolve (16/16 verified).
- **Convention (topic-id ownership):** the *invoker* (0060 command or the operator) computes `topicId` (normalize → slug48 → sha256[0:8]) and passes an already-resolved `work_dir`; workflow `prepare` only `mkdir` + materializes files into `${vars.work_dir}`. Decided in the refineall cross-task pass — keeps workflow YAML free of hash shell.
- **Convention (never overwrite user files):** config.yaml is create-on-first-run with compiled defaults; dest workflow copy uses byte-compare — identical = no-op, different = warn + leave, only operator `--force` replaces. Fail-loud rows each record condition → exit → files written → recovery.
- **Pattern that worked:** spec-authoring tasks deliver as 8 labeled Solution blocks with a fail-loud table and pinned handoff keys for downstream tasks (0059 vars, 0060 steps), so implementers never re-derive contract decisions.
- **Gotcha:** C4 is a `wayfinder-map` feature (no Gherkin) with task-local AC numbering — DD-09 "AC subset" warnings vs the feature AC are expected, not defects (same as 0054/0055 vs C3).
- **Gotcha:** input is strictly XOR (`topic` vs `input_file`); both-set and both-empty are separate fail-loud rows, not one "invalid input" bucket.

## 0057 — Implement the live Firecrawl client in web-search

- **Pattern that worked:** `SearchDeps` seam (inject `fetch`/`env`/`now`) keeps tests fully offline while `main` passes `globalThis.fetch` — 29 tests, 100% funcs / 99.50% lines on `index.ts`. Do not monkey-patch global fetch in tests.
- **Convention (fail loud):** missing `FIRECRAWL_API_KEY` → exit 1, stderr exactly `web-search failed: FIRECRAWL_API_KEY is unset`, no `--out` written; the fixture branch never reads the key. Single `POST /v2/search` with Bearer auth; no npm SDK, no silent retry in v1.
- **Convention (stable ids):** `computeId` stays `sha256(url).hex[0:16]` and is now exported; a test pins format, stability, and differentiation so id stability survives refactors.
- **Error hit / deferred:** non-JSON 4xx/5xx bodies render an empty diagnostic (`Firecrawl HTTP 502:` trailing space) — `extractError` needs a truncated-body fallback; P4, deferred. Also 401 vs 402 share one generic message (acceptable v1).
- **Gotcha (verdict parser):** AC-table rows whose status is a Dimension word ("Usability", "Architecture") are silently dropped from the verdict JSON (`ac-row-dropped: fail` check). Keep SECUA dimension words out of AC status cells; statuses must be MET/PARTIAL/UNMET/N/A.
- **Residual:** live behavior verified only against fake fetch responses — do one manual smoke run with a real key before calling the live path production-proven.

## 0058 — Prototype the Content-to-markdown research-report helper

- **Convention (private kk-core ≠ shippable import):** `@gobing-ai/kk-core` is `private: true`, so end-user scripts cannot import it. Ship `plugins/kk/scripts/render-md.ts` as a self-contained copy carrying a `SYNC:` comment pointing back at `packages/kk-core/src/render-md.ts`; prove byte-identical *output* via a characterization test that spawns `bun <script> --in --out`.
- **Pattern that worked:** one hardcoded markdown template — no Handlebars/Mustache. Double-H1 rule: if `body` already starts with `# <title>` (or `# Untitled`), emit body as the leading heading; missing/blank outline and empty references omit those sections.
- **Pattern that worked:** `main()` + `import.meta.main` CLI shape with `--in`/`--out`; missing args or invalid JSON → stderr + exit 1 + no `--out` (matches repo fail-loud convention).
- **Convention (T3):** kk-core surface additions (`renderContentMarkdown`, `renderContentMarkdownFile`, `main`) go into `docs/04_DESIGN.md` §4 in the same commit.
- **Gotcha:** the script/kk-core mirror is byte-identical *output*, not byte-identical files — a future `ContentSchema` change can drift the structural copy; the characterization test is the only tripwire.

## 0059 — Prototype the daily kk-storm-research workflow

- **Pattern that worked:** dual workflow YAML (SSOT `.spur/workflows/kk-storm-research.yaml` + install source `plugins/kk/workflows/kk-storm-research.yaml`) kept byte-identical — asserted by a test (`expect(install).toBe(ssot)`) and `cmp`; both validate. Edit the SSOT, copy, never edit the install copy.
- **Convention (vars):** all workflow vars are strings; `fixture` defaults `"false"` in YAML, CI/dry-run passes `"true"`, and prepare writes `($fixture == "true")` — never hardcode `true` in a state.
- **Error hit and resolved:** review flagged unquoted `${vars.*}` in workflow shell commands as P3 (paths with spaces word-split `mkdir`/redirects/`--in`). Fixed by quoting all shell interpolations (17 quoted refs; remaining bare ones are comments only) and re-syncing both copies byte-identical.
- **Pattern that worked:** `kk` owns steps, `spur workflow` owns orchestration — states shell to `kk executor run` and `bun render_script`; the local-doc merge is generate's `onEnter[0]` jq prepend onto `docs.json` instead of changing the web-search `--in` schema.
- **Gotcha (portability):** `shasum -a 256` is the macOS/Perl name; minimal Linux images have `sha256sum`. The 0056 canonical algorithm is Node sha256 — matter for 0060/Linux daily use.
- **Gotcha (dry-run semantics):** `--dry-run` proves machine shape (`transitionsTaken: 4`, `finalState: done`) but executes no actions — file-mode prepare and the local-doc merge had only static coverage until the verify stage exercised them; plan an executed file-mode run, not just dry-run.
- **Gotcha (verdict parser):** 5 AC rows dropped from the verdict for dimension-word statuses ("Correctness", "Security", "Test depth", "Portability") — same parser constraint as 0057.

## 0060 — Author the kk-storm-research skill and generic kk-workflow command

- **Pattern that worked (testing markdown deliverables):** `apps/cli/tests/kk-workflow-command.test.ts` extracts and *executes* the real topicId shell block from `kk-workflow.md` §4 and asserts 9/9 equality against a Node reference of the frozen 0056 algorithm, plus string-invariant checks (XOR guard, config heredoc, 3-root copy rule, 7-var `--vars` set, ADR-011 guard). 7/7 pass. This is the template for guarding future markdown/shell capability files.
- **Convention (separation):** skill owns craft (`plugins/kk/skills/kk-storm-research/SKILL.md`), command owns the thin run procedure (`plugins/kk/commands/kk-workflow.md`, 129 lines < 150 cap) — and never merge a research skill into `kk-topic`.
- **Convention (ADR-011 honored):** no new `kk` first-layer noun — the command shells to `spur workflow run "$dest" --vars`; `apps/cli/src/cli.ts` still registers only executor + plugin.
- **Convention (discovery):** skills/commands/workflows under `plugins/kk/` are directory-discovered — no `plugin.json` or marketplace edit needed to add a capability.
- **Gotcha (quoting):** `--vars` JSON embeds `$TOPIC`/`$INPUT_FILE` unescaped — a topic containing `"`/`\`/`$` yields malformed JSON or stray expansion. Acceptable for agent-executed markdown (LLM assembles the quote); harden with `jq -n --arg` if a programmatic runner ever consumes the command.
- **Gotcha (config literal):** the config heredoc writes literal `$HOME` into `config.yaml` (`works_dir: "$HOME/.config/kk/works"`) — the future TS config loader must expand `$HOME`; recorded as deferred-loader scope.
- **Gotcha (arg parsing):** a single hyphenated-token topic (`my-topic`) parses as the workflow *name* and trips the XOR error with non-obvious recovery — recovery is `--in` or an explicit `kk-storm-research` name prefix; the skill states this.
Extracted from the three C5 task files (designs, solution maps, verify/review sections) and the working-tree diffs (uncommitted on `main`: 18 files +854/−104). All three tasks landed 2026-08-16.

## 2026-08-16 — task 0062 (feature C5: live ingest caches normalized full content per reference)

**Conventions discovered**

- Fail-loud ordering: probe `markitdown` on PATH (`Bun.which` with explicit `PATH` option) **before any network call**; missing → exit 1, stderr names markitdown, no `--out` written. Key check (`FIRECRAWL_API_KEY`) stays inside `searchFirecrawl` as the first gate — it fires earlier when the key is unset, so the two fail-loud paths don't overlap.
- Per-URL failure is non-fatal by contract: warn `web-search: scrape failed (url=…)` on `console.warn`, keep the search-snippet body, exit 0, still write `docs.json`. Never let one URL's failure reject the whole pass; never write `docs.json` on a fail-loud path.
- Cache reuse is file-existence only — no TTL, no query-keying. Cache dir = `join(dirname(outPath), 'references')` (sibling of `--out`, D6), filename = `computeId(sourceUri)` (sha256 hex 16). A whitespace-only cache file counts as a miss (`cached.trim().length > 0` guard).
- Cache-read errors (EACCES/EISDIR) are treated as miss → poisoned cache re-scrapes and warn-falls-back rather than surfacing the fs error. Accepted by design (D5 self-healing, non-fatal), P3.
- Normalization precedence: `data.html` present → markitdown; else `data.markdown` as-is (already markdown); else unusable → snippet fallback.
- Scrape pass is sequential per Doc — deliberate, no parallel fan-out (rate-limit friendly, deterministic).

**Errors hit and resolved**

- markitdown's `-x .html` extension hint is **required**: bare stdin passes HTML through unconverted (verified against markitdown 0.1.4). The runner spawns `markitdown -x .html` with HTML on stdin, markdown on stdout; non-zero exit or empty output ⇒ throw (treated as unusable content).
- `Bun.which` needs an explicit `{ PATH: process.env.PATH }` option (observed on Bun 1.3.14): plain argv[0]/default lookup can resolve against a startup PATH snapshot and miss runtime PATH edits. Same fix applied in both `realMarkitdown` and the `main()` probe.
- `res.ok` alone is not enough for /v2/scrape — also assert `res.status === 200` and `parsed.success === true` with non-null `data`; malformed or unsuccessful responses go down the per-URL warn path, never the fatal path.

**Patterns that worked**

- `SearchDeps` seam extended with `scrape?: FetchLike` (defaults to `deps.fetch` so tests route both Firecrawl calls separately) and `markitdown?: MarkitdownRunner` — unit tests stay fully hermetic: 158 expects, zero network, no real binary, 44 pass / 100% lines / 99.64% branches on `src/index.ts`. Never monkey-patch global fetch.
- Stub-markitdown PATH shim + URL-routed `/v2/search` vs `/v2/scrape` fetch mocks in tests; call-list assertion proves cache-hit re-runs issue zero scrape calls.
- Export the seam (`scrapeAndCacheDocs`) while keeping the Doc[] shape untouched — handoff to 0063 is body-provenance-only.

**Gotchas**

- Task R-numbering (R1–R9) offsets from AC numbering (R1–R11); test labels match neither list. Corpus prose only, coverage correct — don't "fix" it.
- `tests/{tmp,tmp-stub-bin,tmp-md-stub}` not gitignored; a SIGKILLed run leaves untracked dirs. Add an ignore line if it bites.
- Stale-cache reuse across queries sharing a URL is the documented ceiling — delete the file to refresh.
- Real markitdown conversion quality is unverifiable hermetically; the first live STORM run post-merge is the true e2e.

## 2026-08-16 — task 0063 (feature C5: report digests sources with a compact references tail)

**Conventions discovered**

- **Premise correction:** the two render copies are NOT byte-identical files — `plugins/kk/scripts/render-md.ts` carries its own imports/header/runner `main()` because `@gobing-ai/kk-core` is `private: true` and unimportable by end users. What's identical is the render *logic*, kept in sync by the SYNC comment convention. A render-logic change lands in BOTH copies, and the SYNC pointer (script side) stays intact.
- References tail resolves by construction: `cite` = Doc id = `computeId(sourceUri)` = the `<doc-id>.md` filename 0062 writes. No render-time file-existence lookup — render stays pure/IO-free.
- `content.outline` stays in `content.json` and schemas; only the markdown tail drops the `## Outline` replay. Schema untouched, field dropped from one projection.
- Synthesis mandate is article-stage-only: appended to `articleStage`'s `extra` array, never to curation/outline/polish prompts.

**Errors hit and resolved**

- Design step "update both copies' frozen-template comments" satisfied vacuously on the script side — `plugins/kk/scripts/render-md.ts` carries no template enumeration, only the SYNC pointer (intact at :9). kk-core's enumeration was correctly updated/renumbered. P4, no action.
- Inverting an existing test is the clean way to drop behavior: the "emits an Outline block" case became "asserts no `## Outline` even with non-empty outline" with an exact-output assertion; the blank-outline case stayed valid.

**Patterns that worked**

- Test the drop with a file fixture carrying `outline: 'Old replay'` — one assertion proves schema keeps the field AND markdown drops the replay.
- Pipeline-order test asserts the mandate string in the article prompt (`prompts[2]`) AND its absence in stages 0/1/3 — scoped enforcement without prompt-luck checks. Presence assertion covers the key clause (`references are evidence, not the deliverable`); absence assertions use the shorter substring `references are evidence` (adequate, weaker).
- Byte-identical characterization test (fixture with `outline: 'A\nB'`) spawns the real `bun <script> --in --out` and asserts equality with kk-core output — proves both copies dropped the replay together, the only tripwire against copy drift.
- Prompt-only enforcement of "digest, don't index" is the accepted ceiling (non-goal, satellite D7) — no automated check can catch regression to source indexing.

**Gotchas**

- AC numbering offset (Requirements R1–R4 vs AC scenarios R6/R7) — same known P3 class as 0062; `spur task check --strict-core` WARNs but passes.
- "Never lists sources one per line" reads ambiguously against the references tail (which renders one `- <label>` per item) — the sentence scopes to the report body; the same paragraph names the tail as the audit trail.
- Digest quality itself is unverifiable hermetically — first live STORM run post-merge is the e2e check.
- The `~/.agents/skills/kk-storm-research/SKILL.md` practice update is 0064's scope, not this diff.

## 2026-08-16 — task 0064 (feature C5: document the references cache and digest contract in storm-research SKILL.md)

**Conventions discovered**

- A meta/doc task in a batch lands LAST and documents shipped behavior — verify against the shipped code (`scrapeAndCacheDocs` web-search src/index.ts:246, PATH probe :385, mandate storm.ts:245), not the design-doc prose.
- Docs tasks still run the affected regression suites (`bun test packages/kk-core plugins/generations/content-gen plugins/ingestions/web-search` → 144 pass / 0 fail) to prove no code path was touched — docs-only doesn't mean no verification.
- Keep doc diffs to frozen edit points only: four existing tables/sections, no new sections. Single file surface, clean code diff.

**Errors hit and resolved**

- Adding a `references/` layout row contradicted the skill's own invariant ("do not rename or add sidecars", SKILL.md:166) — resolved by carving the ADR-013 exception into the invariant line, so the new row and the invariant agree. Adding a row to a "frozen" table also requires amending the frozen marker in the heading (`(0056, frozen; ADR-013 adds references/)`).
- Safe to amend the heading: no exact-string cross-references to the old heading exist outside the task file.

**Patterns that worked**

- Prose-to-code traceability in the verify table: every factual claim in the doc diff is anchored to the exact shipped line (fail-loud row's `markitdown is not on PATH` exit-1 wording matches the code's throw message verbatim). Writing docs that quote the real error strings keeps SKILL.md and runtime diagnostics consistent.
- Practice bullets pair the what with the audit-trail how: references tail + cache files are the audit trail behind each cite id; render drops the `## Outline` replay (ADR-013 D7).

**Gotchas**

- The fail-loud row's "probed before any network call" is accurate for fetch (counter-asserted in 0062 tests) but the `searchFirecrawl` key check fires earlier when `FIRECRAWL_API_KEY` is unset — the row names markitdown mode precisely, so no action.
- Practice 7's "never lists sources one per line" needs the body-scoping sentence next to it or it misreads against the one-`- <label>`-per-item tail.

Cross-task: C5 ran as a 3-task batch — 0062 ∥ 0063 parallel, 0064 last; no `dependencies[]` edges, ordering enforced by decomposition. Shared identity rule (computeId = sha256 hex 16) is what makes the 0062 cache filename, the 0063 cite id, and the 0064 "resolves by construction" claim all the same string.
## 2026-08-19 — wrapall E1 (task 0002)

**Decisions**

- E1 (wt-publish audit) is wrap-complete: task `0002` done; feature hops `verifying → done` via `spur feature sync` (wrapup-pipeline feature-transition).
- Wrap body was inlined. `wrapup-pipeline.yaml` `doc-sync` is `agent.run` against `agent.default` (omp). Project learning 2026-08-02 E3: that step hangs in this env. Do not re-try omp for wrap.

**Patterns that worked**

- Audit output became the E2/E3 contract: two transports (File/CLI vs Playwright), Surfdash = no-auth file/CLI, fail-loud (drop `publish.sh` always-exit-0).
- Feature-AC placeholder (`Scenario: Basic acceptance`) never enriched; `0002` carries the real scenarios. `spur feature sync` still hops to done (L4 warning, not error).

**Gotchas**

- `docs/05_FEATURES.md` still said E1 `backlog` while the corpus was `verifying` and sync proposed `done`. T4 wrap must refresh 05 in the same change as `feature sync`.
- Task `0002` has no `.spur/run/0002-verdict.json` (pre-verdict-artifact era). Metrics row records `verdict: none`.


- `spur feature sync --dry-run` can report L4 passed while live verifying→done elevates uncovered/unverified scenarios to ERR. Fix: align feature AC titles to the covering task, then backfill a PASS verdict with MET rows for pre-verdict-era tasks.

## 2026-08-19 — housekeeping (content-judge + hitl + F4)

**Decisions**

- Persona subagents `judge-tech` / `judge-tone` / `judge-compliance` deleted. Fat skill renamed `plugins/kk/skills/judge` → `plugins/kk/skills/content-judge` (install id `kk:content-judge`). Rubric is an `agent.run` prompt field. ADR-007 / ADR-009 dated amendments 2026-08-19.
- Spur already has `hitl.confirm`, `hitl.input`, `hitl.select`. That covers topic-core gates (outline a|b|c, draft approve, revision text). No new `hitl.*` kind. `topic` stays the writer; HITL ownership moves to `kk-itc.yaml` (task 0069 / F4).
- `plugins/kk/workflows/` becomes the only kk product YAML SSOT. `.spur/workflows/` is Spur-lifecycle only. Not a one-file delete: 0056 three-root copy rule + tests + `/workflow-run` must move together (0069).

**Patterns that worked**

- Simple deletes/renames + live-path updates in the same turn; one `feature-impl` task for the contract-level remainder.
- `hitl.select` options are a static YAML `string[]` — good enough for `a|b|c`. Copy-the-winner is `shell`, not a new HITL kind.

**Gotchas**

- Do not delete `.spur/workflows/kk-storm-research.yaml` without retargeting `apps/cli/tests/storm-research-workflow.test.ts` (`ssotPath`) and the three-root assertion in `workflow-run-command.test.ts`.
- F1 historical AC still names the wrappers; do not rewrite a done feature's AC. Record the retirement in Notes + ADR amendment.

## 2026-08-27 — Task 0083 (feature F9: explain-things + /tell-me)

**Decisions**

- One fat skill `plugins/kk/skills/explain-things` plus one thin slash `plugins/kk/commands/tell-me.md`. ELI5 is an on-request register, not the default; HTML is last-resort. Vendor `eli5`/`show-me` stay provenance.
- No extra `/eli5`/`/show-me` aliases, no subagent, no first-layer `kk` noun (ADR-011). Directory discovery ships the capability (ADR-009).

**Patterns that worked**

- Distill a view catalog into one-level `references/views.md`; keep SKILL.md lean (procedure + default table + pointer).
- Thin command: frontmatter + `Skill(skill="kk:explain-things", args="$ARGUMENTS")` only. Empty args forward unchanged so the skill owns conversation fallback.

**Gotchas**

- `spur task check` L4.anchor-subject-mismatch fires when one Testing cell cites several `path:line` anchors whose contents do not share the same subject tokens. One primary range (or command evidence without mixed file:line) per row.
- A `done` task with unchecked `- [ ]` Requirements boxes is `L3.unchecked-checklist`. Flip to `[x]` in the verify `--fix` pass before wrap.
- Unrelated in-progress skills in the same tree (`taste-unslop`) must stay unstaged; mixing them into the F9 commit would smuggle a second capability.

### Doc Drift Audit & Repairs (Tasks 0088–0091 / F61 Wayfinder)

1. [docs/00_ADR.md](file:///Users/robin/xprojects/knowledge-kit-runall-F61-1E76/docs/00_ADR.md#L6-L10):
   - Flipped [ADR-014](file:///Users/robin/xprojects/knowledge-kit-runall-F61-1E76/docs/00_ADR.md#L565-L578) and [ADR-015](file:///Users/robin/xprojects/knowledge-kit-runall-F61-1E76/docs/00_ADR.md#L580-L595) status from `Accepted (design)` to `Accepted` (`shipped — A3; tasks 0065–0067`).
   - Bumped frontmatter `version: 1.21.0` and `updated_at: 2026-09-03`.

2. [docs/03_ARCHITECTURE.md](file:///Users/robin/xprojects/knowledge-kit-runall-F61-1E76/docs/03_ARCHITECTURE.md#L6-L10):
   - Added [`podcast-pub/`](file:///Users/robin/xprojects/knowledge-kit-runall-F61-1E76/docs/03_ARCHITECTURE.md#L39) to System shape under `plugins/publishings/`.
   - Synchronized Section [§Output and diagnostics foundation](file:///Users/robin/xprojects/knowledge-kit-runall-F61-1E76/docs/03_ARCHITECTURE.md#L178) title to strip obsolete `(accepted design — not yet built)` phrasing.
   - Added [`@gobing-ai/podcast-pub`](file:///Users/robin/xprojects/knowledge-kit-runall-F61-1E76/docs/03_ARCHITECTURE.md#L270) to Module boundaries table.
   - Bumped frontmatter `version: 2.20.0` and `updated_at: 2026-09-03`.

3. [docs/04_DESIGN.md](file:///Users/robin/xprojects/knowledge-kit-runall-F61-1E76/docs/04_DESIGN.md#L6-L10):
   - Updated [§0 Design satellites](file:///Users/robin/xprojects/knowledge-kit-runall-F61-1E76/docs/04_DESIGN.md#L20-L42): updated `podcast-pub.md` to `shipped (E6)` and added the 4 F61 satellites ([`kk-daily-ai-voice-gap-analysis.md`](file:///Users/robin/xprojects/knowledge-kit-runall-F61-1E76/docs/design/kk-daily-ai-voice-gap-analysis.md), [`ingestion-source-adapters.md`](file:///Users/robin/xprojects/knowledge-kit-runall-F61-1E76/docs/design/ingestion-source-adapters.md), [`core-facts-template.md`](file:///Users/robin/xprojects/knowledge-kit-runall-F61-1E76/docs/design/core-facts-template.md), [`article-publish-fanout-brief.md`](file:///Users/robin/xprojects/knowledge-kit-runall-F61-1E76/docs/design/article-publish-fanout-brief.md)).
   - Updated [§3 Environment variables](file:///Users/robin/xprojects/knowledge-kit-runall-F61-1E76/docs/04_DESIGN.md#L274-L276): added `MICROFEED_BASE_URL`, `MICROFEED_API_KEY`, `MICROFEED_TIMEOUT_MS`.
   - Updated [§4 Public package surface](file:///Users/robin/xprojects/knowledge-kit-runall-F61-1E76/docs/04_DESIGN.md#L381-L391): documented `@gobing-ai/podcast-pub` exports.
   - Updated [§6 Design specifications](file:///Users/robin/xprojects/knowledge-kit-runall-F61-1E76/docs/04_DESIGN.md#L427-L431): added `podcast-pub.md` and all 4 F61 wayfinder specifications.
   - Bumped frontmatter `version: 2.26.0` and `updated_at: 2026-09-03`.

4. [docs/design/podcast-pub.md](file:///Users/robin/xprojects/knowledge-kit-runall-F61-1E76/docs/design/podcast-pub.md#L3) & [docs/design/kk-daily-ai-voice-gap-analysis.md](file:///Users/robin/xprojects/knowledge-kit-runall-F61-1E76/docs/design/kk-daily-ai-voice-gap-analysis.md#L36):
   - Flipped `podcast-pub.md` status to `Feature **E6** (shipped)`.
   - Refined row 3.1 evidence in `kk-daily-ai-voice-gap-analysis.md` per task 0088 review and 0091 verification.

5. [docs/99_PROJECT_CONSTITUTION.md](file:///Users/robin/xprojects/knowledge-kit-runall-F61-1E76/docs/99_PROJECT_CONSTITUTION.md#L6-L10):
   - Appended 2 dated lessons in §8 under `03_ARCHITECTURE` and `04_DESIGN`.
   - Bumped frontmatter `version: 1.5.0` and `updated_at: 2026-09-03`.

6. Written [`.spur/run/wrapup-learnings.md`](file:///Users/robin/xprojects/knowledge-kit-runall-F61-1E76/.spur/run/wrapup-learnings.md).

# Working Learnings: Tasks 0088–0091 (F61 Wayfinder Map)

## 2026-09-03

### Task 0088 — Gap analysis: kk-daily-ai-voice vs ideal end-to-end daily pipeline

- **Conventions:**
  - Standardized disposition taxonomy across research audits: `exists` (capability wired in workflow), `extend` (capability exists in code/CLI, needs workflow wiring), and `missing` (new capability + workflow state required).
  - Architectural boundary: `kk` owns step execution (`executor run`, `executor fan-in`, `executor fan-out`), while `spur workflow` owns DAG orchestration. Fan-in/fan-out must never be modeled as custom engine states.
- **Errors Fixed & Findings:**
  - Corrected show-notes disposition claim: `podcast-pub` already maps `content.body` → `contentHtml` (`content_html` in microfeed item API) in `src/map.ts:86`. The gap was purely workflow wiring (no publish state invoked) rather than a plugin capability deficiency.
  - Verified `kk executor fan-out` CLI options: `--target` is a repeatable option (`--target <p1> --target <p2>`), requiring list expansion rather than single space-separated string passing.
- **Patterns:**
  - Linear single-node workflow transition sketch: `prepare → ingest-last30days → ingest-horizon → blend-facts → article → cover → script → wrap-docs → generate → quality-control → publish → done`.
  - Handoff contracts: 0090 consumes blend-home recommendation (merge via `kk executor fan-in`, facts render via generator); 0091 consumes article generator (`content-gen`) and publish dispositions (`podcast-pub` + `surfdash-pub` via `fan-out`).
- **Gotchas:**
  - SQLite database locking (`SQLITE_BUSY_RECOVERY`) when running `spur task check` concurrently with active parent pipeline executions.

---

### Task 0089 — Wrap last30days + Horizon as Doc[] ingestion sources

- **Conventions:**
  - Both external sources terminate in `Doc[]` (`input: null`, `output: DocListSchema`) conforming to `docs/design/ingestion-plugin-specification.md`.
  - Ingestion plugins (`last30days-ingest`, `horizon-ingest`) wrap external CLI execution (`last30days.py`, `uv run horizon`) and isolate environment/credentials/secrets.
- **Errors Fixed & Findings:**
  - Rejected workflow shell-step alternative: mapping external JSON in workflow YAML bypasses `DocSchema` validation, reduces testability, and scatters schema knowledge across workflow states.
  - Pinned exact machine-readable CLI modes: `last30days` requires `--emit=json --json-profile=agent` (flat, versioned `results[]` schema v1.2) rather than default compact text.
  - Horizon item-level mapping: parsing localized enrichment blocks and 0-10 score anchors from generated `horizon-<date>-<lang>.md` summaries.
- **Patterns:**
  - Deterministic ID stability: `id = last30days:{candidate_id}` (or `sha256(url)`) and `id = horizon:{url-slug}` ensure stable identity across runs.
  - Failure semantics: empty crawl output writes `[]` with exit code `0`; unrecoverable execution failure exits `1` with no output file written.
- **Gotchas:**
  - `last30days` setup dependency: `SETUP_COMPLETE=true` in `~/.config/last30days/.env` is required to avoid silent fallback to websearch-only degradation.
  - Law 7 query planning: `--plan "$QUERY_PLAN_FILE"` is required by the last30days engine for named-entity queries.

---

### Task 0090 — Core-facts blend contract + template prototype

- **Conventions:**
  - Markdown template frontmatter: `date`, `sources` roster list, `dedup_rule: id`, `doc_count`.
  - Section syntax: `## Headlines` repeat block using double-brace `{{...}}` placeholders with per-item attribution (`Source`, `URI`, `ID`, `Date`, `Score`, body).
- **Errors Fixed & Findings:**
  - Pipeline consumer decoupling: clarified that downstream generator steps (article, script, voice) consume the structured intermediate `Doc[]` artifact (`1-ingest/blended.json`), not the rendered markdown (`2-facts/core-facts.md`), preventing brittle markdown scraping.
  - Score normalization gap: identified that score field names vary across sources (`metadata.score` in Horizon, `metadata.relevance_score` in last30days, absent in Aihot) and require normalization in downstream synthesis.
- **Patterns:**
  - Mechanical merge & render: `kk executor fan-in` merges N `Doc[]` streams with primary `Doc.id` deduplication and provenance merging (`metadata.sources`), followed by generator rendering into human/audit markdown.
  - Transitive consumption: `voice-gen` transitively consumes the facts `Doc[]` through `dailynews-gen`'s intermediate `VoiceScript` Doc.
- **Gotchas:**
  - Disjoint ID namespaces: `aihot:`, `last30days:`, and `horizon:` use distinct prefixes, meaning identical real-world news stories from different feeds are not deduped by ID matching alone (requires future semantic/URL-normalized deduplication).
  - Cover generation unrenderable: no `cover-gen` plugin exists today in `plugins/generations/`, identified as an open map fog item for F61.

---

### Task 0091 — Article generation + publish fan-out incl. podcast show notes

- **Conventions:**
  - Generator reuse: extend existing `content-gen` (owned STORM pipeline) via additive template input rather than creating redundant `article-gen` plugin.
  - Single publish state: publish fan-out is executed via one `kk executor fan-out` step with repeatable `--target` flags (`surfdash-pub` and `podcast-pub`), avoiding sequential state explosion in workflow YAML.
- **Errors Fixed & Findings:**
  - Confirmed microfeed show-notes support: `mapContentToEpisode` maps `content.body` directly to `contentHtml` (`content_html` in microfeed API), matching RSS enclosure description standards.
  - Identified 4 publish wiring seams: (1) missing publish state in workflow, (2) article `Content` lacks audio references, (3) field name mismatch between `voice-gen` (`metadata.audioPath`/`mp3Path`) and `podcast-pub` (`metadata.audioFile`/`audioUrl`), (4) environment configuration (`MICROFEED_BASE_URL`, `MICROFEED_API_KEY`).
- **Patterns:**
  - Aggregate publish outcome: `kk executor fan-out` produces `AggregateResult` with per-target statuses (`published`, `failed`, `skipped`); exits `1` on partial failure to fail loud while preserving successful publishes for resume via `--retry-from`.
  - Extensibility: adding future publish channels (Zenn, Qiita, EmDash, Surfing) requires only adding repeatable `--target <plugin>` flags without altering workflow state machine structure.
- **Gotchas:**
  - Microfeed HTML sanitization: `podcast-pub` passes markdown body as `content_html` relying on server-side sanitization; verify rendering compatibility during live deployment.
Drift repaired and learnings written. Summary:

**Drift findings → repairs (all §7 repair protocol, authority-first):**

| Doc | Drift | Repair |
|---|---|---|
| `docs/00_ADR.md` | No ADR for the first non-TypeScript (Python) plugin entering the tree — a T1 architectural choice | Added **ADR-020** (decision, why, cost, consequence incl. the `bundle-plugins.ts` Python packaging gap); version 1.22.0→1.23.0, `updated_at` 2026-09-13 |
| `docs/03_ARCHITECTURE.md` | omni-voice-gen absent from §1 module tree, §1 module table, runtime-model bullet, and quality-boundary gate table | Added tree line, table row (Python/uv, PyPI `omnivoice`), ADR-020 exception bullet, `make … coverage` gate row; version 2.21.2→2.22.0 |
| `docs/04_DESIGN.md` | §3 env table missing `VOICE_GEN_MAX_RUN_MS` entirely and all five `OMNIVOICE_*` vars; shared vars tagged voice-gen-only | Added 6 rows; re-scoped `VOICEBOX_DEFAULT_PROFILE`/`VOICE_GEN_FAIL_ON_QC`/`VOICE_GEN_MP3`; version 2.27.1→2.28.0 |
| `docs/design/*` | `omni-voice-gen.md` already shipped-status and synced by 0126; no drift in `voice-gen.md` / generator spec / kk-daily-ai-voice | No change needed (verified by grep, not reading alone) |

One out-of-scope note (not committed): `scripts/bundle-plugins.ts` Bun-bundles every staged entry — a Python entry isn't handled; recorded as a consequence in ADR-020, deferred until npm distribution must carry omni-voice-gen.

Learnings artifact written to `.spur/run/082d582d-4846-4bca-abf5-8de1196cdc1a-wrapup-learnings.md`. Raw markdown follows:

# Wrapup learnings — F611 omni-voice-gen (tasks 0121–0126)

## 2026-09-13

### 0121 — plugin scaffold + kk contract layer

- Convention: the executor spawns non-`.ts`/`.js` plugin entries as plain executables (verified
  `invoke.ts`) — so a Python plugin's spawn seam is a bash wrapper
  (`bin/omni-voice-gen` → `exec uv run --project <plugin> python -m omni_voice_gen`). Keeps venv
  resolution inside uv; no console_script, no executor change.
- Error fixed (pre-ship, draft): assumed `Doc` requires `title`/`sourceUri` — only `id` + `body`
  are mandatory (verified `packages/kk-core/src/schemas.ts`). Check the schema, not the examples.
- Pattern: "function coverage ≥ 90%" in Python = `scripts/coverage_gate.py` combining coverage.py
  data with ast def-line analysis — a Bun-style metric has no native pytest equivalent.
- Pattern: empty `Doc[]` input → notice Content with no model load. Cheap-path before heavyweight
  resource acquisition.
- Gotcha: an out-of-band implement-agent scaffold commit was made and reverted the same day —
  keep implementation inside the pipeline, not side channels.

### 0122 — VoiceScript parse/merge/validate port (warn-and-ignore)

- Pattern: warn-and-ignore for fields the new backend can't honor (`engine`, `personality`,
  `effects_chain`) — parse into dataclasses so unknown YAML never fails, report via a WarnSink,
  never forward to the backend.
- Error fixed (pre-ship, draft): don't port voice-gen's 23-code language allowlist — OmniVoice's
  own `_resolve_language` validates a superset; porting the list would reject valid languages.
  Validate at the layer that actually owns the constraint.
- Gotcha: `yaml.safe_load` covers both JSON and YAML (JSON ⊂ YAML), but keep voice-gen's
  JSON-then-YAML branch order so error messages and the `[laugh]` fast path match exactly.

### 0123 — profile registry + OmniVoice backend adapter

- Error fixed (pre-ship, draft): don't build a custom transformers Whisper pipeline for the
  fidelity check — the model ships public `load_asr_model()`/`transcribe` (verified 2026-09-12).
  `OMNIVOICE_ASR_MODEL` env added as the override knob.
- Convention: no implicit cross-run voice cache — saved clone prompts are operator-managed `.pt`
  registry entries only (deterministic over implicit).
- Convention: profile registry is a committed `profiles.json` with documented placeholders only —
  no secrets, no operator-private audio paths in git.
- D4 profile fallback chain (segment → speaker → script default → `VOICEBOX_DEFAULT_PROFILE` →
  doc `metadata.voiceProfile`); unknown name fails loud with the name in the error.

### 0124 — audio concat, loudness dip, QC audit, MP3

- Pattern: QC parity over innovation — repetition detection, transcription-fidelity floor (0.15),
  and loudness-dip detection ported with voice-gen's thresholds so both backends are gated by the
  same bar.
- Pattern: `VOICE_GEN_MP3` truthy parse and ffmpeg `libmp3lame` transcode ported 1:1; missing
  ffmpeg or transcode failure → fail loud, no `--out` (never write a partial success artifact).

### 0125 — pipeline orchestration, verify-retry, coverage gate

- Error fixed (pre-ship, port): voice-gen's two nested retry loops collapse to one verify loop in
  omni-voice-gen — the inner loop was HTTP transport retry, and in-process generation has no
  transport. One inline exception retry preserves the transient-failure semantics. Port semantics,
  not structure.
- Gotcha: OmniVoice `generate()` has no seed kwarg — seed semantics become
  `torch.manual_seed(explicit)` before attempt 0 only; retries resample (diffusion decoding is
  stochastic by default). Verify API surface before porting flags.
- Gotcha: no server history id in-process → `generationId` = `uuid4().hex[:16]` per accepted
  render; keeps the metadata field shape stable for downstream consumers.
- Pattern: `VOICE_GEN_MAX_RUN_MS` budget is checked between segments, not per-chunk — a
  segment-granularity check can't leave a half-rendered segment.
- Pattern: seed pins attempt 0 only, so verify retries can escape a bad draw.

### 0126 — workflow `voice_generator` var + docs sync

- Convention: backend swap = one workflow var (`voice_generator`, default `voice-gen`); the
  generate state is otherwise plugin-name-agnostic (cache guard on `metadata.qc.passed`,
  `VOICE_GEN_MP3` env, error semantics). Defaults preserve production behavior; swap is per-run
  opt-in via `-v voice_generator=omni-voice-gen`.
- Scope discipline: `kk-solo-podcast.yaml` deliberately not touched — noted as a follow-up
  pattern, not drive-by scope.
- Convention (T3): the workflow var, the `docs/04_DESIGN.md` surface entry, and the design-satellite
  status flip (proposed → shipped) land in the same commit.

### Cross-cutting (wrapup 2026-09-13)

- Convention: first non-TypeScript plugin in the tree is an architectural decision — ADR-020
  records it; 03 gains the tree/module-table/stack/gate entries; the Python plugin owns its own
  quality gate (`make coverage`, per-file line AND function ≥ 90%) outside the Bun gates.
- Gotcha (deferred, recorded in ADR-020): `scripts/bundle-plugins.ts` Bun-bundles every staged
  entry to `dist/index.js` for a Node-only tree — a Python entry (bash wrapper + `src/*.py` +
  `profiles.json` + `uv.lock`) is not yet handled. Fix before the npm distribution must carry
  omni-voice-gen.
- Gotcha (doc drift found at wrapup): 04 §3's env table had no `VOICE_GEN_MAX_RUN_MS` row at all
  (voice-gen read it since D14) and no `OMNIVOICE_*` rows; shared vars
  (`VOICEBOX_DEFAULT_PROFILE`, `VOICE_GEN_FAIL_ON_QC`, `VOICE_GEN_MP3`) carried voice-gen-only
  scoping tags. When a second consumer ships, re-tag the shared env rows in the same commit.
- Pattern across the batch: drop-in replacement works because the contract, not the
  implementation, is the swap point — identical `--in`/`--out`, identical `metadata` shape
  (modulo `generator: "kk:omni-voice-gen"`), identical env knobs where semantics allow.
Wrapup complete: drift audit ran with detection evidence (clean across all four doc areas — the YAML was the drift, 0130 already repaired it to the documented spec); artifact written to `.spur/run/090c7494-ac85-49a1-a588-dd01f9a48e5b-wrapup-learnings.md`.

# Working learnings — wrapup run 090c7494 (batch: F8 kk-solo-podcast schema fix)

## 2026-09-14

### 0130 — Fix kk-solo-podcast.yaml shell-action schema (command: indent + options: null)

**Conventions**

- Spur state-machine shell actions are `{ kind: shell, options: { command: >- … } }` — `command` nests **inside** `options`, never as a sibling of `kind`. Canonical mirror: `plugins/kk/workflows/kk-itc.yaml:33-45`.
- The authoritative doc for this shape already existed at `docs/design/multi-root-plugin-discovery.md:19-31`; the fix was repairing YAML drift *to* the docs, so 00/03/04/design/* needed no edits. Check the spec before assuming doc repairs — the docs are often already right.
- Defect-only repairs (no new command/flag/config/schema/DTO) are T3-exempt: no ADR entry, no 04 sync obligation.

**Errors fixed**

- 8 `onEnter` shell actions carried `options:` valueless (→ `null`) plus `command: >-` as an unknown sibling field → 16 JSON-schema violations (8x `options: expected object, got null`, 8x `unknown field "command"`); workflow could not load. Fix: uniform +2-space re-indent of the `command:` line and every block-scalar content line, per action.
- Pre-existing defect: confirmed reproducing on the untouched main checkout, pre-dating commit `fcf4fda` — not caused by current F8 work. Provenance recorded in R4.

**Patterns**

- YAML re-indent safety: with a folded block scalar (`>-`), a uniform +2-space re-indent leaves the parsed string byte-identical. Safe nesting repairs keep `git diff` purely whitespace; verify via `git diff` line-count symmetry (108/108) plus the string-assertion tests (`kk-solo-podcast-workflow.test.ts`, `workflow-run-command.test.ts`).
- AC amendment protocol: when an AC asserts an unobservable (here: an `errorCount` field the CLI never emits) or an out-of-scope gate, amend it during the run to the verifiable contract — dated Q&A entry, rationale, and the residual filed as a follow-up task (0131) instead of leaving an unsatisfiable gate red.
- Task Design "Anti-patterns (do not implement)" block: enumerating forbidden edits (no rewrite/split/reorder/re-wrap, no `>-`→`|` switch, don't touch valid `agent.run`/operator-select actions) keeps a whitespace-only repair surgical through implementation and review.

**Gotchas**

- `spur workflow validate --json` emits `ok` / `valid` / `errors` — it has **no `errorCount` field**, ever. Parse the JSON fields, don't assert fields from memory.
- Validate's exit code is **not** schema validity: it is `!valid || hasError`, where `hasError` includes ADR-115 *composition* findings (content-measure gate, validate-only; spur-new `apps/cli/src/commands/workflow.ts:455`). "Schema-valid but exits 1" is a legitimate state when only composition debt remains — run/dry-run/continue never see composition findings (`workflow.ts:453`).
- Composition debt is repo-wide, not file-local: the untouched canonical mirror `kk-itc.yaml` also exits 1 on its own finding. Over-length shell actions (error >10 logical commands; warn >3) and prompts (>1000 chars) are tracked as task 0131, not fixed inside a no-behavior-change repair.
Wrapup complete. Drift report: two findings repaired in `docs/04_DESIGN.md` (§7 podcast-pub rows missing 0118's `PODCAST_PUB_BRIEF_MODE`/`PODCAST_PUB_ARTICLE_POST_PATH` env knobs and the briefMode timeline render) and `docs/design/podcast-pub.md` (§4.1 options bullet extended, postPath source pinned to `_14_publish-surfdash_result.json` per 0137) — committed as `61eb97a`. `docs/00_ADR.md` and `docs/03_ARCHITECTURE.md` audited clean (00 claims nothing about the show-notes flow; 03:205's deliverable claim still holds); `docs/design/kk-daily-ai-voice.md` was already synced in the fix commit. No task/feature corpus writes. Artifact written to `.spur/run/fc8fd3d4-3138-4444-8b10-9efd010acd6a-wrapup-learnings.md`.

## 2026-09-15 — task 0137 (fix the dead surfdash link in kk-daily-ai-voice show-notes)

**Gotcha — workflow states may only read artifacts from *preceding* states (time-travel bug).**
`dailyShowNotes` read `_17_publish_result.json`, but that artifact is written by the later
`publish` state (`plugins/kk/scripts/kk-workflow-stages.ts:877`, post-fix). At show-notes time it
never exists, so `PODCAST_PUB_ARTICLE_POST_PATH` was permanently empty. Fix: read the immediately
preceding `publish-surfdash` state's own artifact `_14_publish-surfdash_result.json` via
`firstPostPath(parsed, 'surfdash-pub')` (`kk-workflow-stages.ts:895`). Conventions: per-target
fan-out results land as `<runDate>_<seq>_<state>_result.json`; the merged result is `<seq 17>`
and is only for the publish/locales transition guards (`docs/design/kk-daily-ai-voice.md:70`).

**Error fixed — silent degradation masked the defect.** An empty `PODCAST_PUB_ARTICLE_POST_PATH`
degrades to the legacy title-slug footer by design (`show-notes.ts:128`, 0118's fallback), so the
pipeline stayed green while every episode carried a dead article link. Lesson: when a feature has
an engage-path/fallback pair, a regression test must pin the *engaged* path, not just the
fallback — green CI proves nothing about which layout ran.

**Pattern — regression tests assert the artifact source, not just the output.** Three runner-suite
tests in `apps/cli/tests/kk-workflow-stages.test.ts` (+82): (1) published surfdash target ⇒
timeline layout engages (`briefMode && postSlug` at `show-notes.ts:129`); (2) absent-or-failed
target ⇒ empty-string legacy fallback, never throws; (3) negative assertion — `show-notes` never
reads `_17_`. The "never reads X" test guards against re-introducing the time-travel on refactor.

**Convention — T3 same-commit docs and budget discipline held.** The fix commit updated
`docs/design/kk-daily-ai-voice.md` §5 in the same commit (two wording nits at :80, :89-92) and
kept the delegated `show-notes` action within the ADR-115 composition budget; the env-forwarding
shape (`PODCAST_PUB_TITLE/RUN_DATE/BRIEF_MODE/ARTICLE_POST_PATH`) was unchanged, so no ADR entry —
bugfixes restoring an existing contract don't justify one (T1).

## 2026-09-15 — wrapup doc-evolve repair (drift audit over 00/03/04/design)

**Drift found and repaired — SURFACE doc lagged the 0118 env surface.** `docs/04_DESIGN.md` §7
podcast-pub rows listed only `PODCAST_PUB_TITLE / RUN_DATE / ARTICLE_BASE_URL` and described the
legacy render only; the consumer has five env knobs
(`plugins/publishings/podcast-pub/src/index.ts:113-115`). Repaired both rows (+ `updated_at`) and
extended `docs/design/podcast-pub.md` §4.1 options bullet with
`PODCAST_PUB_BRIEF_MODE`/`PODCAST_PUB_ARTICLE_POST_PATH` and the `_14_` (not `_17_`) postPath
source. Committed as `docs(kk)` `61eb97a`.

**Clean — no drift elsewhere.** `docs/00_ADR.md` makes no claim about the show-notes artifact
flow (`rg` for show-notes/_17_/PODCAST_PUB → zero hits); `docs/03_ARCHITECTURE.md:205`'s "the
daily workflow artifact is unchanged" refers to the markdown deliverable through the declared
`operations["show-notes"]` path (0110 I3), which 0137 did not touch. `docs/design/kk-daily-ai-voice.md`
§4/§5 were already synced by the 0137 fix commit.

**Pattern — project convention: 04 content edits bump `updated_at` but not `version`** (matches
`53ce3e51`); satellite `docs/design/*.md` specs carry no frontmatter but are T3 surface — the
audit sweep must grep them, not just `04` (constitution lesson 2026-08-12).
Doc-evolve `wrapup` complete for task **0157**. Repairs are surgical, constitution-cited, and limited to the four named docs; no task/feature corpus written.

## Drift report (0157 blast radius)

| # | Doc | Code/shipped says | Doc said | Authority | Repair |
|---|-----|-------------------|----------|-----------|--------|
| 1 | `docs/04_DESIGN.md:56` | `fan-in` accepts `--plugins-root`/`--plugins-path` (0157 R3) | §1 summary line had no root flags (only §1.5 did) | §6.5 T3 | added `[--plugins-root <dir> \| --plugins-path <dir> …]` |
| 2 | `docs/04_DESIGN.md:99,307` | alias rejected by file identity, `dev`+`ino` (R1) | "aliasing the same path" (string) | §6.5 | reworded to "same file — identity, not path string" |
| 3 | `docs/04_DESIGN.md:393` | `TargetOutcomeSchema`/`AggregateResultSchema` + types are public kk-core exports (R11) | §4 export table omitted them | §6.5 T3 | added Zod-schema + type rows |
| 4 | `docs/04_DESIGN.md:640` | `kk stage` checkout fallback = module path, never cwd (R4) | "explicit checkout fallback `plugins/kk/...`" (cwd) | §6.5 | corrected to module-derived checkout root |
| 5 | `docs/04_DESIGN.md` frontmatter | edited 2026-09-24 by 0157 | `updated_at: 2026-09-17`, `version: 2.29.0` | §4.3 r3 | `2.30.0` / `2026-09-24` |
| 6 | `docs/03_ARCHITECTURE.md:144` | fan-in CLI shape | fan-in line had no root flags | §6.4 | added flags; added `--source` discovery clause (R3) |
| 7 | `docs/03_ARCHITECTURE.md:197` | identity-based alias guard (R1) | "aliasing rejected pre-mutation" | §6.4 r4 | named file identity |
| 8 | `docs/03_ARCHITECTURE.md:196` | kk-core `AggregateResultSchema` validation (R11) | "primitive metadata … exit 2" only | §6.4 r4 | named schema validation |
| 9 | `docs/03_ARCHITECTURE.md:303` | kk-core owns fan-out aggregate schemas | module row omitted them | §6.4 r4 | added to responsibility |
| 10 | `docs/03_ARCHITECTURE.md:389` | fan-in resolves plugins too | "shells `run\|fan-out`" | §6.4 | `run\|fan-in\|fan-out` |
| 11 | `docs/00_ADR.md` ADR-012 | fan-in honours the flags | B7 list named only run/fan-out/plugin | §6.1 r3 | dated `**Amendment — 2026-09-24**` |
| 12 | `docs/design/kk-cli-surface.md:84` | current surface | fan-in line had no root flags | §6.5 T3 | added flags |

**Checks run (deterministic):** `rg "kk executor fan-in"` across `00/03/04/design/*/AGENTS.md`; `rg "TargetOutcomeSchema|AggregateResultSchema"`; `rg "aliasing the same path"` → 0; `rg "explicit checkout fallback"` → 0; `git show 29bf6447` diff vs doc edits. **No residual drift found.**

**Deliberately not edited:** `docs/design/fan-in-and-fan-out-specification.md` §1.1/§1.2 — it uses the satellite convention (original text + dated correction block); 0157's dated correction already carries the flags. `AGENTS.md` — it names no `kk` flags, so T3's surface-block clause has nothing to sync.

**Reported, not repaired (pre-existing, needs operator call):** `kk stage` is a shipped top-level verb (0144) missing from `04` §1's command index, while ADR-011 R1 states first-layer nouns are "exactly `executor` and `plugin`". Deciding whether `stage` is a machine-facing orchestration seam (amend ADR-011, dated) or should be hidden is a governance call outside 0157.

**Verification:** `bun run lint` → exit 0 (biome + typecheck). `git status`: only the 4 doc files changed by me; the pre-existing `0156` task-file edit and untracked `.spur/context/answers/0156.yaml` were preserved untouched. Artifact written: `.spur/run/91c853eb-1aa1-4a49-8c54-7a5037176835-wrapup-learnings.md` (7734 bytes).

# Wrapup learnings — run 91c853eb-1aa1-4a49-8c54-7a5037176835

Task set (normalized capture `.spur/run/91c853eb-1aa1-4a49-8c54-7a5037176835-wrapup-tasks.json`): 0157.
Doc-drift repairs applied this wrapup: `docs/00_ADR.md` (ADR-012 dated amendment), `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, `docs/design/kk-cli-surface.md`.

## 2026-09-24 — 0157 · invoke input-deletion alias, fan-out duplicate publish, fan-in plugin roots + CLI hardening

### Conventions

- Same-commit doc sync (constitution T3 / §6.5) covers **every** surface index, not just the section the change touches. 0157 updated `04` §1.5/§1.6 + the fan-in/fan-out spec, but left four indexes stale: the `04` §1 summary CLI block, the `04` §4 `kk-core` public-export table, ADR-012's committed-surface verb list, and `docs/design/kk-cli-surface.md`. A new flag or schema must be grepped across `04`, `03`, `00`'s committed-surface lists, and `docs/design/*` in the same commit.
- Numbered-doc frontmatter is a contract (§4.3 rule 3): bump `version` (minor) and refresh `updated_at` on any substantive edit. 0157 edited `04` on 2026-09-24 but left `updated_at: 2026-09-17` — stale-frontmatter drift the audit catches.
- Design satellites (`docs/design/*`) keep original text and layer **dated correction blocks** at the top; do not rewrite historical §1.x tables in place. 0157's spec edit correctly added a dated correction instead of editing §1.2.
- ADRs are append-only (§6.1 rule 3). Extending an existing decision to a sibling verb is a dated `**Amendment (YYYY-MM-DD)**` block inside the entry, not a new ADR. 0157's fan-in root flags re-use ADR-012 R4/R6 → no new ADR, but ADR-012's shipped verb list needed the dated note.
- Keep one option registrar per executor verb, shared by the hidden aliases (R9) — prevents `--help` drift between `fan-out` and `fanout`.
- Wire formats belong in `@gobing-ai/kk-core` Zod schemas, not hand-written interfaces (R11).
- Shared code with a cross-package consumer goes to `kk-core`; `apps/cli` has no direct `zod` dependency, so a local schema there would force a new dependency (C3 placement decision).

### Errors fixed (root causes)

- **R1 — silent input deletion.** `path.resolve` is lexical: no case folding, no symlink resolution. On case-insensitive APFS or with a symlinked parent or `--out`, `--in` and `--out` differ as strings but are the same file, so the stale-output `unlinkSync` deleted the input before the child read it. Fix: compare file identity (`statSync().dev` + `.ino`, follows symlinks) behind an `existsSync` guard, before the clear. Root-cause class: a destructive-boundary "same path" guard must use file identity, never string equality.
- **R2 — duplicate dispatch.** Dedupe existed only in the `--retry-from` branch; the fresh path passed `opts.targets` straight through, so repeated `--target x` published twice, contradicting the function's own docstring ("exactly once per run"). Fix: `[...new Set(opts.targets)]` on the fresh path. A documented invariant needs a test on **every** branch that can violate it.
- **R3 — sibling-verb parity gap.** When `run`/`fan-out` gained the ADR-012 root flags (B7), `fan-in`'s `--source` discovery was left calling `discoverAllPlugins({})` even though a comment claimed it used "the same discovery entry point as runInvoke". Tests only exercised `KK_PLUGIN_PATH`, so the gap never failed. A comment asserting parity is not parity — grep every sibling verb that resolves plugins when adding a cross-cutting flag.
- **R4 — cwd-anchored trusted script.** `kk stage`'s dev-tier fallback used `resolve(STAGES_REL)` = current directory; tests `chdir`'d into the repo root, hiding it, and a planted `plugins/kk/scripts/kk-workflow-stages.ts` in cwd would be executed. Fix: anchor to `resolve(import.meta.dir, '../../..')` (CHECKOUT_ROOT). Never resolve a trusted script relative to cwd. Note: `bun build` keeps `import.meta.dir` a runtime expression equal to the bundle dir, so one anchor serves both `src` and `dist`.
- **R5 — copy drifted from its twin.** fan-in's source runner had a JSON-parse `try`; fan-out's original read never got it back-ported, so a plugin writing invalid JSON threw a `SyntaxError` that was caught per-target but named no plugin. Fix: one shared `readPluginJson`. When a read/parse block is copied between runners, back-port the hardening.
- **R6 — double newline.** `echoError` already appends `\n`; `commands/plugin.ts` added another, yielding blank lines between diagnostics. Know the writer's framing before adding newlines.
- **R10 — five duplicated zod-issue formatters** drifted apart (and caused R5's inconsistency). Fix: a single `formatIssues` in `apps/cli/src/plugin-output.ts`.
- **R11 — hand-rolled wire validation.** The aggregate wire format (spec §3.1) existed only as a TS interface; `readAggregateResult` hand-validated ~90 lines field by field while every other wire format used a kk-core Zod schema. Fix: `TargetOutcomeSchema`/`AggregateResultSchema` in kk-core; map the first Zod issue back to the legacy message tails so asserted substrings stay byte-identical.

### Patterns

- **Test-first red evidence per AC** on the pre-fix tree (`main@d4dd562d`), recorded as an AC → command → result table, then green after the fix.
- **Message-tail preservation across a schema migration:** `describeAggregateIssue` maps the first Zod `issue.path` (`root`, `targets.<i>.metadata`, `targets.<i>.*`, other) back to the exact legacy strings, so four existing assertions stayed green unedited. Migrate the validator, not the tests.
- **Surface-neutral refactor proof:** capture `--help` before/after and diff (R9 registrar refactor).
- **Static red/green counts via `rg`** for pure refactors (e.g. `function collect` 5→1, `'--plugins-root <dir>'` 4→3) — cheap deterministic evidence without a runtime test.
- **Trust-boundary strictness accepted:** a wrong-typed optional field (`url: 5`) in a prior ledger now rejects (exit 2) instead of being silently dropped, because the ledger is kk-written. No existing test relied on dropping, so no `.catch(undefined)` escape hatch was needed.

### Gotchas

- `path.resolve` ≠ file identity. `statSync` follows symlinks (`lstatSync` does not). `unlink` removes one name only, so a symlinked or hard-linked `--out` does not lose data but still aliases the write.
- A case-variant alias test is non-deterministic on case-sensitive Linux CI; the early-return `existsSync` guard keeps it green there while the symlink cases still fail on the old code.
- `rg -l "AggregateResult|TargetOutcome"` before moving the interfaces to kk-core — find every importer first.
- Coverage gate is ≥90/90 line/function aggregate; R11 reached 100% on the touched files.
- `spur task check` on a task with no `feature_id` emits an expected `L4.missing-feature-id` warning, not a failure.
- Project gate order: `bun run format` then `bun run gate` (format + build + lint + rules + tests).

### Wrapup-level lesson (doc drift)

The drift audit must diff the whole surface-index set, not just the section the implementing task edited: the `04` §1 summary block, `04` §4 public-export tables, `00` ADR committed-surface lists, and `docs/design/*` satellites. 0157 passed its own T3 check for §1.5/§1.6 and still left four stale indexes — "I updated the docs" is not the same as "every index that names the changed surface is current".

Open/pre-existing (reported, not repaired): `kk stage` is a shipped top-level verb (0144) absent from `04` §1's command index, while ADR-011 R1 says first-layer nouns are "exactly `executor` and `plugin`". Needs an operator call — treat `stage` as a machine-facing orchestration verb (amend ADR-011 with a dated note) or hide it. Not 0157-introduced, so left untouched.
**Verification & confidence**

| Claim | Confidence | Basis |
| --- | --- | --- |
| `voice_generator` is a dead var; `vdriver` is the live one, default `voicebox` | **HIGH** | `rg "voice_generator"` returns zero hits in `plugins/kk/workflows/*.yaml` and `plugins/kk/scripts/*.ts`; `kk-daily-ai-voice.yaml:25` reads `vdriver: "voicebox"`; `kk-workflow-stages.ts:968-972` holds the `VOICE_DRIVERS` map (read today) |
| Rename landed in commit `91ef8bc9`, 2026-09-17; default flipped 2026-09-20 | **MEDIUM** | Commit identified by `git log -S vdriver` (HIGH); the two dates come from the yaml's own `# 20260917` / `# 20260920` comments, not from commit timestamps |
| `gemini-tts` absent from `03` tree + module table and `04` §4 before this pass | **HIGH** | `rg "gemini"` over both files returned only the `04` env/design-index rows; `ls plugins/generations` confirms the dir exists |
| `processGeneratorIO` takes 5 params | **HIGH** | Signature transcribed from `voice-gen/src/index.ts:46` per §6.5 r4 |
| gemini-tts exports, deps, CLI flags in the new `04` section | **HIGH** | Transcribed from `package.json`, `plugin.json`, and `rg '^export'` over `src/*.ts`; `voice-create.ts:126-176` read directly |
| Cross-lingual consent failure, HTTP 500 semantics, model-agnostic stored voice | **MEDIUM** | Operator-run evidence recorded in task 0159 + `gemini-tts/README.md:66-70`; I did not re-run the live API, so this is sourced, not independently reproduced |
| ADR-023 already `Accepted` (no status drift) | **HIGH** | `docs/00_ADR.md:902` read directly |
| `03` module table missing 6 generations + 2 ingestions | **HIGH** | Set difference of `ls plugins/generations plugins/ingestions` against the table rows at `03:305-311` |
| Docs-only diff does not affect `bun run gate` | **MEDIUM** | Biome/tsc target TS sources and no doc file is in the lint/test path; I did not run the gate this pass |

## 2026-09-24

### 0158 — gemini-tts plugin: Gemini VoiceboxClient adapter over the voice-gen pipeline

- **Adapter, not port (ADR-023).** A second TTS backend costs one `VoiceboxClient` implementation
  when the pipeline already injects its client. The whole VoiceScript/verify-retry/loudness/speed/
  concat/QC/MP3 chain stayed voice-gen's; only three seam edits were needed: `exports { ".": "./src/index.ts" }`
  in `package.json`, `transcribe?` made optional on the interface, and a trailing `generator = 'kk:voice-gen'`
  param on `processGeneratorIO` stamped into `metadata.generator`. Contrast omni-voice-gen (F611),
  which had to port the pipeline to Python.
- **Optional interface methods need guarded call sites, not a null object.** `transcribe?` works
  because both call sites already used `typeof client.transcribe === 'function'`
  (`voice-gen/src/index.ts:261`, `qc.ts:228`). Check the guards exist *before* loosening the type.
- **Verify the live wire shape before designing around a fallback.** A live probe closed the
  transcription-response question (`steps[]` → `model_output` step → `content[{type:"audio"|"text"}]`),
  which deleted a planned "fall back to soft-skip" branch from the design. One probe removed a branch.
- **Error identity is bounded by what the caller can see.** The client is called per segment with no
  index, so the actionable error is a ≤30-char text excerpt plus HTTP status plus API message —
  not a segment number it cannot know. The feature AC was reworded to match reality rather than the
  other way round.
- **Don't duplicate a test that belongs to the shared layer.** MP3 transcode lives in voice-gen's
  `processGeneratorIO`; gemini-tts passes the default transcoder and adds no MP3 test.
- **Test-only imports belong in `devDependencies`.** `@gobing-ai/kk-core` is a devDep of gemini-tts
  (tests import `ContentSchema`/`Doc`); runtime code never imports it.
- **Gotcha — flaky gate vs. real failure.** The first `bun run gate` exited 1 on two unrelated 5 s
  timeouts in `apps/cli/tests/kk-itc-workflow.test.ts` (0149, 0152); both passed in isolation
  (1542 ms, 1969 ms). Re-run in isolation before treating a timeout as a regression of your diff.
- **Gotcha — bundled-layout path resolution.** `DEFAULT_PROFILES_PATH` resolves `../profiles.json`
  from `import.meta.url`, which is valid from both `src/` and the bundled `dist/` layout — but that
  must be verified in `apps/cli/plugins/generations/gemini-tts/` after `bun run build`, not assumed.
- **Pitfall — "R#" label namespace collision.** Test titles cited F612 *feature-scenario* IDs while
  the task file used its own R1–R7 (task R4 = feature R6), and `voice-gen.test.ts` now carries two
  different "R1" meanings. Pick one ID namespace per test file or add a mapping comment block.
- **Deferred with a named trigger.** A second retry/backoff implementation now coexists with
  voicebox-client's (Retry-After handling is Gemini-specific). Accepted under ADR-023; the upgrade
  trigger is a *third* backend → extract the pipeline into `packages/`. Likewise
  `processGeneratorIO` now has 3 trailing optional positionals — a 4th means switch to an options object.

### 0159 — gemini-tts replicated-voice creation helper and operator runbook

- **Cross-lingual consent pairing fails voice replication.** Google's verification model penalizes
  cross-lingual acoustic drift: the zh-CN source clip + en-US consent clip returns
  `Voice mismatch detected`. What replicates cleanly is one clean 10–30 s **en-US** recording of the
  consent statement passed as **both** `--source` and `--consent`; the resulting voice still
  synthesizes Chinese and English. The original zh-CN-only runbook was wrong on the shipped path.
- **Upstream returns 500 for what is a 400.** `POST /v1beta/voices` answers HTTP **500** when
  server-side validation rejects an argument or the consent pairing — so a 5xx from this endpoint is
  not automatically retryable-transient. Re-record both clips in one session and retry; Google AI
  Studio's replication UI is the manual fallback. This blocked R4 until the en-US pairing was found.
- **A stored replicated voice is not model-bound.** The same `voice_…` id rendered on both
  `gemini-3.8-flash-tts` and `gemini-3.8-flash-lite-tts` (verified live), closing a MEDIUM-confidence
  open question in the design — no second voice per model variant is needed.
- **Operator-bound identifiers are not repo data.** The created voice id is tied to the operator's
  Google project and a 1-year TTL, so it lives in `~/.config/kk/gemini-tts-profiles.json` with
  `GEMINI_TTS_PROFILES` pointing at it from `~/.config/kk/config.yaml`; the committed `profiles.json`
  keeps `voice_REPLACE_ME`, which fails closed with a remediation pointer.
- **Reuse the existing parser instead of writing a validator.** WAV validation reuses voice-gen's
  exported `parseWav` (`ParsedWav`: `audioFormat`, `numChannels`, `sampleRate`, `bitsPerSample`,
  `byteRate`, `dataBytes`; duration = `dataBytes.length / byteRate`) — no new audio code, no new dep.
- **A validation error must name the actual values.** `validateVoiceWav` reports the observed
  rate/channels/bits/duration, not just "invalid WAV" — the operator fixes it with one ffmpeg call.
- **Gotcha — Voicebox discovery path.** The consent clip is a cloned-voice *profile*, not a history
  entry, and `GET /history` returns 500 on the current build. Use
  `GET /profiles` → match by name → `GET /profiles/{id}/samples` → `GET /samples/{sample_id}`.
- **Secret hygiene in an operator runbook.** Key read from env (or piped out of `config.yaml` into a
  shell var without echoing); never printed, never written to a file, never in task evidence; error
  paths redact it. Biometric source/consent clips go to a scratch dir outside the repo.

### 0160 — Wire vdriver gemini into kk-daily-ai-voice and sync docs

- **A well-placed map turns a backend into a one-line change.** Adding `gemini: 'gemini-tts'` to
  `dailyGenerate`'s `VOICE_DRIVERS` is the entire wiring: the same
  `kk executor run <plugin> --in <docs> --out <content>` call serves all three drivers, and
  downstream stages already read `metadata.audioPath` / `mp3Path` / `qc`. Unknown aliases still fail
  loud, now listing `gemini`.
- **Ship the selector, defer the default.** The default `vdriver` stays `voicebox`; flipping it needs
  an operator listening A/B (deferred I7). New capability behind an opt-in alias, no behavior change.
- **Integration tests can front-run the real plugin.** The matrix test uses a fake `kk` shim, so 0160
  only needed 0158's `metadata.generator` tag to exist — the shim emits `kk:gemini-tts`, mirroring
  the ominivoice branch. Test-shim parity is what decoupled the two tasks.
- **Generalize the lookup, not the assertion.** Adding a driver to the `[vdriver, qcPassed]` matrix
  meant replacing two hardcoded expectations with the same `{voicebox, ominivoice, gemini}` lookup
  the shim uses — otherwise every new driver edits three places.
- **Feature status is tool-owned.** The F61x voice-driver family has no `docs/05_FEATURES.md` rows;
  status lives in the spur-generated `docs/features/INDEX.md`. Update it with
  `spur feature update F612 <status>`, never by hand-editing `05` or `INDEX.md`.

### Wrap-up doc sync (00 / 03 / 04 / docs/design)

- **Recurrence — a new shipped plugin package is T3 surface (3rd time: zenn-pub/qiita-pub 2026-08-12,
  web-search 2026-08-13, gemini-tts now).** `plugins/generations/gemini-tts` shipped with env rows
  and a design-index status in `04`, but no `03` tree entry, no `03` module-boundary row, and no
  `04` §4 package/export section. The env table is the part people remember; the package section and
  the architecture tree are the part that rots. Sync all four in the shipping commit.
- **A shared-function signature change is T3 surface too.** `processGeneratorIO` gained a 5th
  parameter in 0158 while `04`'s export row still documented four — a signature is transcribed from
  the registration (§6.5 rule 4), and adding a param counts.
- **Renaming a workflow var leaves a long tail.** `voice_generator` → `vdriver` (commit `91ef8bc9`,
  2026-09-17) plus the 2026-09-20 default flip back to `voicebox` never reached the docs: the dead
  name survived in `00` (ADR-020's 2026-09-13 amendment), `03:311`, `04:569-570`, `04`'s design-index
  workflow row, `docs/design/kk-daily-ai-voice.md` ×2, and `docs/design/omni-voice-gen.md`. Repaired
  by a new dated ADR-020 amendment (append-only — history is never rewritten) then the derived docs.
  When a var is renamed, grep the *old* name repo-wide in the same commit; an alias-valued var is a
  second break (values changed from plugin names to aliases, not just the key).
- **A design doc's operator runbook is a claim, not a fact, until someone runs it.** `gemini-tts.md`
  §4 prescribed a zh-CN consent clip; the operator run proved that path fails. Research/design
  satellites need the same post-run sync as code surfaces — updated §4 with the same-language
  constraint, the HTTP 500 behavior, the AI Studio fallback, and the model-agnostic stored voice.
- **Open, out-of-scope drift (noted, not repaired here):** `docs/03_ARCHITECTURE.md`'s module-boundary
  table is missing 6 shipped generations (`core-facts-gen`, `daily-article-gen`, `episode-plan-gen`,
  `image-gen`, `news-report-gen` — `gemini-tts` added this pass) and 2 ingestions (`horizon-ingest`,
  `last30days-ingest`); the dead `voice_generator` name also survives in
  `plugins/generations/omni-voice-gen/README.md` and in the tool-owned `docs/features/F611_*` corpus.
  Both need their own task — the README is outside this pass's doc scope and feature corpus is
  CLI-gated.
Wrapup done. One drift repaired, three named docs verified clean, artifact written.

**Repair:** `docs/04_DESIGN.md` — `version: 2.31.0 → 2.32.0`, `updated_at: 2026-09-24 → 2026-09-25`. Root cause: `e46a5596` (0163) edited the body (new `kk stage daily-cover` row, delegated-action count 20→23) but left the frontmatter untouched — §4.3 rule 3 violation.

**Clean (no delta):** `00_ADR.md` (0163 is a feature impl, not a decision — no ADR entry owed), `03_ARCHITECTURE.md` (new code lives inside existing modules), `docs/design/kk-daily-ai-voice.md` (already synced in-commit), preset inventory (no doc enumerates presets).

**Deliberately untouched:** the gap-analysis snapshot (§4.2 — records, don't govern) and `docs/features/F61_*.md` (tool-owned) both still say `wt-image-cover`; that is correct history, not drift. Reported out-of-scope: `docs/05_FEATURES.md:90-91` L/L1 rows are stale (last edited 2026-09-22) — T4 sync owed by `spur feature sync`.

**Verification:** `bun run lint` exit 0; `bun run test` 1379 pass / 0 fail, exit 0. `git status`: only `docs/04_DESIGN.md`.

Artifact: `/Users/robin/xprojects/knowledge-kit/.spur/run/e57eb897-d9a2-436d-977e-92de57474039-wrapup-learnings.md` (9590 bytes).

Doc-evolve `wrapup` complete for task **0163** (F614). Repairs are surgical, constitution-cited, and limited to the named docs; no task/feature corpus written.

## Drift report (0163 blast radius)

| # | Doc | Code/shipped says | Doc said | Authority | Repair |
|---|-----|-------------------|----------|-----------|--------|
| 1 | `docs/04_DESIGN.md` frontmatter | body edited 2026-09-25 by `e46a5596` (0163) | `version: 2.31.0`, `updated_at: 2026-09-24` | §4.3 r3 | `2.32.0` / `2026-09-25` |
| 2 | `docs/04_DESIGN.md:649` | `kk stage daily-cover <work_dir> <run_date> <plugins_path> <provider> <model>` shipped, pinned `daily-news-cover` × `daily-news` | row present (added in `e46a5596`) | §6.5 T3 | no delta |
| 3 | `docs/04_DESIGN.md:679` | kk-daily-ai-voice delegates **23** stage actions | "twenty-three" present | §6.5 T3 | no delta |
| 4 | `docs/03_ARCHITECTURE.md` | new code lives inside existing modules (`plugins/kk/scripts/kk-workflow-stages.ts`, `plugins/generations/image-gen/presets/`) | no cover/image-gen/preset claims to contradict | §6.4 r4 | no delta |
| 5 | `docs/00_ADR.md` | 0163 is a feature implementation, not a cross-cutting decision or a reversal | no cover/image-gen claims | §6.1 T1 | no delta — no ADR entry owed |
| 6 | `docs/design/kk-daily-ai-voice.md` | cover row, diagram node, artifacts section, `wt-image-cover` removal all match the YAML + stage | updated in `e46a5596` | §4.2 | no delta |
| 7 | preset inventory | 4 formats (`cover`, `daily-news-cover`, `free`, `illustration`), 11 styles (incl. `daily-news`) | no doc enumerates presets | — | no delta |

**Checks run (deterministic):** `git log -1 --format='%ci' -- docs/04_DESIGN.md` → 2026-09-25 vs frontmatter `2026-09-24`; `git show e46a5596 -- docs/04_DESIGN.md` → body-only hunk, frontmatter untouched (root cause); `rg "daily-cover" docs/ --glob '!docs/tasks/**' --glob '!docs/features/**'`; `rg "cover|image-gen" docs/03_ARCHITECTURE.md`; `rg "cover|image-gen|daily-news" docs/00_ADR.md`; `ls plugins/generations/image-gen/presets/{formats,styles}/`; `rg -ln "daily-news|presets/styles|presets/formats" docs/`; `rg -n "case '(daily-cover|daily-cover-normalize)'" plugins/kk/scripts/kk-workflow-stages.ts`; `git log -1 --format='%ci' -- docs/00_ADR.md docs/03_ARCHITECTURE.md` → 2026-09-24, matching their frontmatter; `git show 85a7e5da -- docs/04_DESIGN.md` → prior wrapup bumped `2.30.0 → 2.31.0` and set `updated_at`, confirming the convention. **No residual drift.**

**Deliberately not edited:** `docs/design/kk-daily-ai-voice-gap-analysis.md:34,60` — dated Task-0088 research companion; §4.2 makes working-layer docs records that do not govern, immutable once concluded except dated corrections. Its `wt-image-cover` / "cover **missing**" lines were true at authoring time; rewriting them would falsify the snapshot. `docs/features/F61_daily-ai-news-end-to-end-pipeline-wayfinder-map.md:54,63` — tool-owned corpus (§4.2/§3), never raw-edited; its `wt-image-cover` references are historical recon notes. `AGENTS.md` — it names no `kk` command surface, so T3's surface-block clause has nothing to sync. `docs/design/kk-itc-end-to-end.md` — carries frontmatter but was not touched by 0163.

**Reported, not repaired (outside the requested write scope):** `docs/05_FEATURES.md:90-91` — the `L` / `L1` rows still read "7 tasks `0092`–`0098`" and 🔧 active, predating the F612/F613/F614 children; `05` was last edited 2026-09-22 (`4be68cfe`) with `updated_at: 2026-09-17`. The T4 status sync is owed by the harness (`spur feature sync`) or a `05`-scoped pass, not by this doc-evolve run.

**Verification:** `bun run lint` → exit 0 (Biome 2.5.5 + typecheck, every workspace `code 0`). `bun run test` → **1379 pass / 0 fail** across 86 files, exit 0. `git status`: only `docs/04_DESIGN.md` modified.

---

# Wrapup learnings — run e57eb897-d9a2-436d-977e-92de57474039

Task set (normalized capture `.spur/run/e57eb897-d9a2-436d-977e-92de57474039-wrapup-tasks.json`): **0163**.
Doc-drift repairs applied this wrapup: `docs/04_DESIGN.md` (frontmatter `version` / `updated_at`, §4.3 rule 3).

## 2026-09-25 — 0163 · Daily cover: lead-item subject brief rendered through pinned daily-news presets

### Conventions

- **Agent supplies words; checked-in files own the look.** The F613 → F614 family pattern: the model writes exactly one short string (`subject`), while format, style, palette, composition, provider and model are file-pinned (`presets/formats/daily-news-cover.yaml` × `presets/styles/daily-news.yaml`, `cover_provider` / `cover_model` vars). New work on this pipeline keeps the model's surface at one field.
- **A new image style is two preset files, not a plugin or a module.** `presets/formats/<name>.yaml` + `presets/styles/<name>.yaml` under the existing `image-gen` generator — no new package, no new plugin, no `04` module row. Reuse before create.
- **New stage verbs get a `04` §6 table row pointing at the owning design spec** — not a new design doc. 0163's `kk stage daily-cover` row cites `docs/design/kk-daily-ai-voice.md`, which stayed the single owner and was extended in place (purpose line, diagram node, artifacts section).
- **ADR-115 error tier caps workflow agent prompts at ≤1000 chars**, and a test asserts it (`['cover', 1000]`). The brief prompt measured 598 chars. Terse prompts are the enforcement mechanism, not a style preference.
- **Provider/model enter the envelope only when non-empty** — omit rather than send `''`, so image-gen's own default resolves; both paths are tested.

### Errors fixed (root causes)

- **Artifact lookup was coupled to a filename, not the manifest.** `coverNormalizeBody` looked for `content-cover-01.{png,jpg}`; image-gen actually names artifacts after the format preset (`content-daily-news-cover-01.<ext>`). Any format change silently broke normalize. Root-cause fix: read `metadata.images[0].path` from `2-cover/content.json` and fail loud (`cover normalize: no image artifact in 2-cover/content.json`) when the manifest or path is missing. A hard-coded artifact name is a latent break waiting for the next preset rename — read the contract's manifest instead.
- **Frontmatter bookkeeping skipped while the body was synced.** `e46a5596` edited `docs/04_DESIGN.md`'s body (new stage row, delegated-action count 20 → 23) but left `version: 2.31.0` / `updated_at: 2026-09-24` — a §4.3 rule 3 violation, repaired here to `2.32.0` / `2026-09-25`. The T3 same-commit rule gets remembered for the body and forgotten for the frontmatter; check both.
- **`docs/design/kk-daily-ai-voice.md` still described the retired `wt-image-cover` skill path.** The cover state had moved to `agent.run` brief → `kk stage daily-cover`; the spec's cover row, diagram node and artifacts line were corrected in the same commit. A retired surface must be swept out of every spec that named it.

### Patterns

- **Fallback-with-reason, never a failed run, for model output.** `coverBrief` validates in a fixed order — missing-brief → invalid-json → no-subject → subject-cap — logs `cover brief: fallback (<reason>)` to stderr, and emits `vars: {}` so the format's `default` subject renders. `onError: continue` on the `agent.run` mirrors that at the workflow layer.
- **Degraded model input ≠ degraded transport.** A bad or missing brief falls back and the cover still generates; a *provider* failure still fails the stage (exit 3, covered by a test). Keep the two failure classes distinct.
- **The preset's `default` is the fallback payload.** Pinning `subject.default` in the format file is what makes the empty-`vars` path produce a usable image in the same style — the fallback lives in the preset, not in a code branch that picks a scene.
- **Shipped-preset inventory is test-pinned.** `image-gen/tests/presets.test.ts` asserts the shipped format/style set and that `daily-news-cover` × `daily-news` composes with a single `subject` var plus the negatives. Adding a preset means extending that list; inventory drift fails the suite instead of shipping silently.
- **Prompt bans double as look stability.** Banning style/color/lighting/composition words and text/letters/logos/real people in the brief prompt keeps the prompt short *and* stops the model from fighting the preset.

### Gotchas

- **Prose counts rot.** `04` §7.1's "kk-daily-ai-voice's twenty delegated actions" became "twenty-three" by hand when the cover state gained steps. Every stage addition is a T3 obligation on that sentence — prefer a pointer over a number, or accept the maintenance.
- **A dated research doc is not drift.** `docs/design/kk-daily-ai-voice-gap-analysis.md` still reads "cover **missing**" / "`wt-image-cover` skill", and that is correct history: §4.2 makes working-layer docs records, immutable once concluded except dated corrections. Do not "fix" a snapshot.
- **`docs/features/*` is tool-owned** — the F61 map's stale `wt-image-cover` recon notes must not be raw-edited; they age out with the feature file's own lifecycle.
- **Nothing enforces doc frontmatter.** `.spur/rules/` covers structure/surface/quality/boundary but no rule checks `updated_at` / `version`, so the §4.3 contract is memory-enforced — which is why it drifted twice (0157, 0163). A frontmatter-check rule is the systemic fix if this recurs a third time.
- **Live visual dogfood is operator-owned.** 0163 shipped the deterministic path; the look needs a real image backend and human judgment, so step 7 (dogfood) was scoped post-merge and the two preset YAML files are the only knob.

### Operator directives

- **2026-09-25 — image generation goes through kk config.** When generating images (esp. daily-news-cover × daily-news), use the kk path (`kk executor run image-gen`), which resolves provider/env from `~/.config/kk/config.yaml` (currently Minimax `image-01`). Harness image tools (image_gen/generate_image = Grok/Antigravity) bypass that config — do not use them for kk pipeline artifacts. Multi-engine + runtime fallback is the acknowledged next step (0103 AUTO_ORDER covers selection-time only).
## Drift repaired (5 files, all in the authorized scope)

Ran `sp:doc-evolve` drift-audit (§7) on `00`, `03`, `04`, `docs/design/*` for batch WBS **0169**. Task corpus (`docs/tasks/*`, `docs/features/*`) untouched — the modified files there are the harness's own writes.

| # | Doc | Code/reality | Doc said | Repair |
|---|---|---|---|---|
| 1 | `docs/design/generator-plugin-specification.md:57` | 0169 validates the **whole** anchor plan pre-provider, on paid **and** dry-run | 0107 wording (per-image, paid only) | Dated 0169 amendment; fixed stray `..` |
| 2 | `docs/design/remaining-wt-publish-harvest.md:3` | E7 ✅ done (0141–0147) | "accepted design — not yet built" | → shipped |
| 3 | `docs/00_ADR.md:368` | Browser drivers shipped (E7) | `Accepted (design)` | → `Accepted (shipped — E7)` |
| 4 | `docs/00_ADR.md` (ADR-011) | `kk stage` is a registered top-level noun (`1eb6c8d6`, 2026-09-18) | "exactly `executor` and `plugin`" | New dated amendment (R1 amended, not superseded) |
| 5 | `docs/03_ARCHITECTURE.md` tree | 27 real plugins | 14 absent from tree | Added, sourced from `plugin.json` |
| 6 | `docs/03_ARCHITECTURE.md` module table | 27 real plugins | 7 absent | Added with deps from manifests |
| 7 | `docs/03_ARCHITECTURE.md:224` | `kk stage` noun | not mentioned | Added note |
| 8 | `docs/03_ARCHITECTURE.md:359` | F41 ✅ done | "accepted design — F41" | → shipped |
| 9 | `docs/04_DESIGN.md:40` | E7 ✅ done | "accepted design (E7)" | → shipped |
| 10 | `docs/04_DESIGN.md` §3 | image-gen seam vars + shared browser-profile var | absent | 4 rows added |
| 11 | `docs/04_DESIGN.md` §1 | `kk stage` shipped | no §1 entry | New §1.8 (signature from `stage.ts`) |

Frontmatter versions bumped per §4.3 r3: `00` 1.27.0→1.28.0, `03` 2.26.0→2.27.0, `04` 2.33.0→2.34.0.

**Deliberately not flipped** (verified still true): `03`'s "generator input dispatch (accepted design — not yet built)" — `GeneratorInputSchema`/`BriefSchema`/`accepts` are genuinely unimplemented. `ADR-115` in `docs/design/*` is Spur's ADR, not a missing local one.

**Verification:** `bun run lint` (Biome 2.5.5 + typecheck) all workspaces exit 0 · `bun run test` **1393 pass / 0 fail** (86 files) · coverage lines 97.98% / functions 97.91% (threshold 90%) · post-repair drift re-run: 0 missing plugins in tree/table, 0 code `KK_*` vars missing from `04` §3.

Artifact written: `/Users/robin/xprojects/knowledge-kit/.spur/run/3e8e18d4-4c9f-4b5d-97f5-21eb0f9c90ad-wrapup-learnings.md`

# Wrap-up learnings — knowledge-kit, 2026-09-25 (batch WBS 0169)

## 2026-09-25 · 0169 — image-gen validates illustration anchors before the first paid call

### Conventions

- Pre-spend validation belongs in the "fail before any provider work" block: after
  `composePrompts` + the budget-cap check and before `resolveProvider`
  (`plugins/generations/image-gen/src/index.ts:203-206`). One call site there covers the paid
  branch **and** the `KK_IMAGE_DRY_RUN=1` preview branch, instead of only the branch that spends.
- Validate the whole plan, not the item about to be spent. `assertAnchorPlan` checks every
  `metadata.positions` anchor up front — present, occurring exactly once in the source body, and
  resolving to non-overlapping ranges — rather than per-image inside the loop.
- Reuse existing error strings verbatim when strengthening a check; add new text only for genuinely
  new conditions. Callers and skills match on those strings.

### Errors fixed

- The anchor check was coupled to the insertion step, so it ran **after** `provider.generate` had
  already spent for the preceding images — a malformed plan cost money before failing. Root cause:
  reusing the same `body.split(anchor)` inside the loop, so the check could only exist where bytes
  already existed.
- A dry run skipped the anchor check entirely, so a doomed plan could survive operator spend
  confirmation.
- Task 0107's Solution recorded "validates the anchor occurs exactly once before spending provider
  work" while the code checked after `generate`. The stale claim in a `done` task shipped the
  defect: a done task's prose is not evidence — read the code.

### Patterns

- Keep the in-loop check as a documented backstop for the **spliced** body (the inserted reference
  text is only known after `generate`), and name the pre-spend plan check as the real gate:
  `// Re-check against the spliced body; the pre-spend plan check is assertAnchorPlan (0169)`.
- Prove the money boundary by counting resolver calls (`resolveCalls`), not just by asserting no
  output file — `resolveCalls === 0` is what "never selected the provider" actually means.
- Red-first table test: 7 malformed plans × `{ paid, dry-run }` = 14 cases in one table; confirm the
  table fails before the fix and passes after.
- Mark a deliberate complexity ceiling with a `ponytail:` note and its bound
  (`// ponytail: O(n²) pair scan; n ≤ maxImages (default 4), so sorting is not worth it`).

### Gotchas

- A new pre-provider gate invalidates fixtures whose data was never valid input: two existing
  fixtures used `body: 'article'` / `body: 'x'` with the anchors absent. Fix the fixture data; never
  weaken the gate to keep a fixture green.
- Verification fingerprints hash task+feature content, so ticking AC checkboxes changes the
  fingerprint and the receipt must be re-stamped.

## 2026-09-25 · 0169 (wrapup doc-sync) — key-doc drift repaired

### Conventions

- A shipped first-layer CLI noun is a T1 surface for `00`, not just `04`: `kk stage` shipped
  2026-09-18 (`1eb6c8d6`) and its docs-sync commit touched only `04_DESIGN.md`, leaving ADR-011's
  "exactly two first-layer nouns" and `03`'s CLI-nouns section false until this audit.
- `docs/design/*` satellites and their status labels are T3 surface: `remaining-wt-publish-harvest.md`
  still read "accepted design — not yet built" while E7 was `done`, and ADR-008's 2026-09-17 browser
  amendment stayed `Accepted (design)` after the drivers shipped.
- A substantive edit to `00`/`03`/`04` bumps `version` (minor) and refreshes `updated_at` in the same
  edit (constitution §4.3 rule 3).

### Errors fixed

- `03`'s System-shape tree was missing 14 real plugins and its module table 7; `04` §3 omitted
  image-gen's runtime seam env vars (`KK_IMAGE_MAX_IMAGES`, `KK_IMAGE_DRY_RUN`,
  `KK_IMAGE_PRESET_PATH`) and the shared `KK_BROWSER_PROFILE_DIR`; `04` §1's CLI inventory had no
  `stage` entry. Every repair was transcribed from `plugin.json`, manifests, and command
  registrations — never from memory.

### Patterns

- Detect tree/table completeness mechanically: diff the real `plugins/<kind>/*` directory listing
  against the doc text in a script, then repair. A doc that claims a complete inventory is
  drift-checkable that way, and the re-run afterwards is the zero-finding evidence.
- A one-sentence contract amendment belongs in the owning satellite spec
  (`generator-plugin-specification.md`), dated and task-cited, rather than a new design doc.

### Gotchas

- `03`'s "generator input dispatch (accepted design — not yet built)" is **correct** —
  `GeneratorInputSchema` / `BriefSchema` / manifest `accepts` are still unimplemented. Never flip a
  "not yet built" label without checking the code.
- `ADR-115` references inside `docs/design/*.md` are **Spur's** ADR, not knowledge-kit's. They are
  not broken links to a missing local ADR.

## Verification (2026-09-25, batch 0169)

- `bun run lint` — Biome 2.5.5 check + typecheck, all workspaces exit 0.
- `bun run test` — 1393 pass / 0 fail across 86 files; coverage lines 97.98%, functions 97.91%
  (threshold 90%).
- Post-repair drift checks re-run: 0 plugins missing from `03`'s tree, 0 missing from its module
  table, 0 code `KK_*` vars missing from `04` §3.
# Working learnings — batch runall-d6-4440 (feature D6, tasks 0164–0166, 2026-09-25)

## Inline-host proof bracket (the expensive lesson)

- **`proof.fingerprint` has no CLI surface.** The pipeline action resolves to
  `computeProofInputFingerprint` / `readProofInputContents` in the engine
  (`packages/app/src/workflow/proof-input-fingerprint.ts`, spur checkout). The project's
  `plugins/sp/scripts/inline-run-setup.ts` does **not** implement `--fingerprint` (it only takes
  `--run-id/--file`). An inline host must call the engine module directly — a ~10-line bun runner
  (`computeProofInputFingerprint({cwd, taskContent, featureContent})`, both filesystem/executor
  params defaulting to `createNodeFileSystem()`) reproduces the action exactly.
- **Record-stage writes split into two classes (0166, measured):** backfilling `### Solution` and
  `### Testing` at record time does **not** move the digest (R6 scopes the fingerprint to
  Background/Requirements/AC/Design/Plan) — verified: same `sha256:c8597aa0…` before and after.
  Ticking Requirements/AC **checkboxes does** move it (0164/0165 measured a new digest after the
  flip). So an inline host either ticks boxes *before* the quality-gate capture, or re-captures and
  rebinds the verdict proof block afterwards (R4 re-capture pattern).
- `spur task record` has no checkbox flag: ticking boxes is `spur task update <wbs> --section
  Requirements|"Acceptance Criteria" --from-file <file>`; the record→done guard is
  `spur task check <wbs> --as done`, which fails on open boxes.

## CLI failure modes worth keeping

- **Task section headings are `### …` (h3).** An `awk '/^## Solution$/'` extractor yields an empty
  file and `spur task update --section Solution` fails closed with `[invalid-solution] Solution must
  contain at least one file:line citation` — a good guard, but the symptom reads as "my section was
  rejected" rather than "my extractor was wrong".
- **`spur task check <wbs> --as done` is the honest completion gate**: it projects Plan/AC
  checkboxes onto the done target, so open boxes fail *before* the transition.

## Delegation

- **A rate-limited subagent can still have landed its artifact.** The 0166 verify dispatch returned
  `failed (rate_limit_error 1308)` yet `.spur/run/0166-verify-answer.txt` was complete (42 lines,
  `Verdict: PASS`, full traceability). Check the declared `answerFile` before re-dispatching — the
  failure was in the summary reply, not the work.

## Batch isolation

- **`git merge --ff-only` is the tripwire that catches a moving base.** While the D6 worktree ran,
  the invoking tree advanced 9 commits from parallel sessions (E8 xhs-images, E61 podcast,
  0167/0168) and held another writer's 8 staged paths. The ff-only merge failed by construction —
  correct outcome is **retain** (worktree + branch + marker `retained`), never force or rebase onto
  another writer's dirty tree.
- Per-task commits were **not** separable here: 0164/0165/0166 hunks interleave in
  `plugins/generations/image-gen/src/providers/types.ts`, so the batch landed as one commit
  (`16d985e3`) naming all three tasks. Worth flagging against the project's "commit per task"
  convention when a later wrap reads the history.

## Feature D6 shape (useful for the next fallback-ish feature)

- 0164/0165 are pure code+test (no CLI/config surface → no `docs/04_DESIGN.md` row owed);
  0166 owns the surface (`metadata.imageGen.fallback`, `metadata.attempts`, `cover_fallback` var)
  and carried the T3 doc rows in the same change set (`docs/04_DESIGN.md:663-664`,
  `docs/design/kk-daily-ai-voice.md:67`).
- `resolveFallbackOrder` keeps the requested provider first and consults `skipReason` for
  candidates only, so the order is never empty — that is the invariant 0166's exhaustion error
  (`all providers failed for image <n>: …`) depends on.

Repaired documentation drift across `docs/00_ADR.md`, `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, and `docs/design/remaining-wt-publish-harvest.md` per project constitution rules (§6.0, §6.1, §6.4, §6.5, §7), without touching the task or feature corpus. Extracted working learnings for tasks 0167 and 0168 and written the artifact to `.spur/run/7bcd766d-c3ae-4023-9394-81e855fb44ae-wrapup-learnings.md`.

### Drift Repairs Summary

1. [docs/00_ADR.md:947](file:///Users/robin/xprojects/knowledge-kit/docs/00_ADR.md#L947):
   - Flipped ADR-024 status from `Accepted (design)` to `Accepted` following completion and delivery of Feature E8 (tasks 0167 and 0168). Bumped frontmatter version `1.28.0` → `1.29.0` ([docs/00_ADR.md:6](file:///Users/robin/xprojects/knowledge-kit/docs/00_ADR.md#L6)).
2. [docs/03_ARCHITECTURE.md:56](file:///Users/robin/xprojects/knowledge-kit/docs/03_ARCHITECTURE.md#L56), [114](file:///Users/robin/xprojects/knowledge-kit/docs/03_ARCHITECTURE.md#L114), [354](file:///Users/robin/xprojects/knowledge-kit/docs/03_ARCHITECTURE.md#L354):
   - Updated system shape tree and module boundary table to reflect `xhs-pub`'s driver as `browser/script (Xiaohongshu) (E7/E8)` instead of `browser/agent`.
   - Updated section heading `### XHS image-card path (ADR-024)` dropping the unbuilt design tag, and updated the narrative to record that task 0167 replaced the `sessionReady` stub with the Playwright script driver. Bumped frontmatter version `2.27.0` → `2.28.0` ([docs/03_ARCHITECTURE.md:6](file:///Users/robin/xprojects/knowledge-kit/docs/03_ARCHITECTURE.md#L6)).
3. [docs/04_DESIGN.md:672](file:///Users/robin/xprojects/knowledge-kit/docs/04_DESIGN.md#L672):
   - Added `docs/design/xhs-image-cards.md` specification row to §6 Design specifications table covering the shipped card skill, presets, Content image array, and script-driver publish flow. Bumped frontmatter version `2.34.0` → `2.35.0` ([docs/04_DESIGN.md:6](file:///Users/robin/xprojects/knowledge-kit/docs/04_DESIGN.md#L6)).
4. [docs/design/remaining-wt-publish-harvest.md:49](file:///Users/robin/xprojects/knowledge-kit/docs/design/remaining-wt-publish-harvest.md#L49):
   - Recorded the E8 / ADR-024 script driver override for `xhs-pub` in the per-channel policy table.

---

# Working Learnings: 0167, 0168

## 2026-09-25 — Task 0167: Publish ordered XHS card images as a real draft or explicit live post

### Conventions
- **Driver policy for deterministic CMS**: Default to `driver: 'script'` for channels where automated file uploads and UI confirmations provide deterministic evidence. Reserve `agent` driver only for flows where an LLM agent interacts with rich text editors that lack a reliable script surface.
- **Fail-loud step naming**: Wrap all post-open browser operations in an `act()` wrapper with step names so that failure paths emit structured `ok: false` Results naming the exact failed step instead of unhandled exceptions or generic errors.

### Errors Fixed
- **Playwright locator set count vs single locator**: Calling `locator(sel).first().count()` returns 0 or 1, not the full matching set count. Fixed thumbnail count check to use set-level `locator(sel).count()` to accurately verify that all N uploaded card images are rendered.
- **Browser leak on failure**: Raw exceptions before context teardown risked orphaned browser instances. Fixed by ensuring `close()` runs in a guaranteed `finally` block on every code path.

### Patterns
- **Structural page seam for browser testing**: Decouple browser transport logic from Playwright by defining a minimal structural `XhsPage` interface (methods: `goto`, `locator`, `setInputFiles`, `url`, `close`). This allows 100% offline fake-page testing with mockable UI events and injected step/login timeouts without relying on real browser spin-up in unit tests.
- **Pre-browser validation barrier**: Run pure validation (`validatePublishInput`) on image file paths (must exist, must be absolute, extensions in `.png`/`.jpg`/`.jpeg`/`.webp`), non-empty image lists, and valid `publishStatus` before acquiring or launching a browser context.

### Gotchas
- **Ambiguous live publish duplicate risk**: If the publish button is clicked but the network or navigation state times out before an unequivocal success confirmation, return `ok: false` with an explicit duplicate-risk warning so the operator does not trigger accidental double-posts.
- **Dynamic browser loading & bundling**: Playwright must remain an external dependency in plugin bundles (`scripts/bundle-plugins.ts`). If Playwright or Chromium is absent at runtime, return `ok: false` with clear remediation commands (`bunx playwright install chromium`).

## 2026-09-25 — Task 0168: Create source-grounded XHS card series with image-gen and publishable Content

### Conventions
- **Series budget cap before execution**: Enforce `KK_IMAGE_MAX_IMAGES` / `image.max_images` against the total series card count `N` before generating any prompts or calling providers, preventing multiple single-image calls from bypassing per-invocation limits.
- **Dry-run prompt freeze**: Obtain the exact composed prompt via `KK_IMAGE_DRY_RUN=1` and write it to `<out>/cards/NN.prompt.txt` before executing paid generation, ensuring prompt reproducibility and parity with `ImageArtifact.prompt`.

### Errors Fixed
- **Double-spend on retry from assumed file extensions**: Image providers choose their own output extension (e.g. Minimax generates `.jpg` while default templates specify `.png`). Checking only for `.png` on resume caused re-rendering of existing cards. Fixed by checking the recorded artifact path or `cards/card-NN-*` glob before invoking generation.
- **Config resolution mismatch in direct plugin execution**: Direct execution via `bun plugins/generations/image-gen/src/index.ts` bypasses CLI config loading (`~/.config/kk/config.yaml`). Fixed by ensuring required provider environment variables (`MINIMAX_API_KEY`) are exported into the shell environment during development dogfooding.

### Patterns
- **Per-card artifact isolation**: Assign each card an independent input and output stem (`cards/NN.in.json`, `cards/NN.json`, stem `card-NN`). This cleanly scopes `image-gen` failure cleanup to only the failed card, allowing safe resume without re-rendering previously generated cards or re-planning.
- **Two-phase spend preview & confirmation**: Present one consolidated spend preview (provider, model, style preset, card count N, cover prompt, per-card copy) and require a single confirmation before initiating any paid API calls. Disclose consistency trade-offs if the selected provider lacks reference image capabilities.

### Gotchas
- **DocList input envelope format**: `image-gen` expects a DocList array (`[{ metadata.imageGen: {...} }]`), not a bare Doc object. Passing a bare Doc causes envelope validation failure.
- **Single-point publish handoff**: Authoring skills should package `Content` and hand off to `kk:publish` rather than directly invoking transport plugins like `xhs-pub`. This ensures central enforcement of publish confirmation and draft-by-default policies.
`sp:doc-evolve wrapup` is complete. I repaired the stale live-state claims in [podcast-pub.md](/Users/robin/xprojects/knowledge-kit/docs/design/podcast-pub.md), documented the 0176 audio-path fix in [kk-daily-ai-voice.md](/Users/robin/xprojects/knowledge-kit/docs/design/kk-daily-ai-voice.md), and synced [04_DESIGN.md](/Users/robin/xprojects/knowledge-kit/docs/04_DESIGN.md). The audit found no ADR or architecture drift, so `00_ADR.md` and `03_ARCHITECTURE.md` remain unchanged. No task or feature corpus files were written. `git diff --check` passed; I did not run tests for these documentation-only changes.

Learnings artifact: [.spur/run/badc0f49-dabc-4587-85ba-93ee194798a7-wrapup-learnings.md](/Users/robin/xprojects/knowledge-kit/.spur/run/badc0f49-dabc-4587-85ba-93ee194798a7-wrapup-learnings.md)

# Working learnings — wrapup run badc0f49

## 2026-09-25

### 0170 — podcast-pub rejects non-Apple audio MIME

- Put cross-operation policy at the shared Content-to-episode mapper after resolving extension and metadata overrides; one guard there covers publish and Content-mapped validate before network activity.
- Keep MIME detection separate from publish policy: the extension map describes the file, while the allowlist describes what Apple accepts. Raw `options.item` update/validate paths deliberately bypass the mapper and must remain documented as caller-owned passthrough.
- A field override is part of the trust path: validate the final resolved MIME after applying `metadata.mimeType`, so the override cannot bypass the guard.
- Changing a previously accepted fixture format requires updating all fixture callers and assertions; isolate cover-validation fixtures on valid audio so each test still checks its intended behavior.

### 0171 — daily AI voice publishes MP3 with ID3 tags

- Enforce the publish format at the workflow publish-prep seam and keep the plugin MIME guard as a backstop. A WAV fallback should fail with the controlling workflow var named in the error.
- Stamp metadata after every audio stage that can re-encode the MP3; intro-music runs later and would strip earlier ID3 tags. Use the existing `ffmpeg -c copy` path and temp-file rename to avoid a new dependency and leave the original untouched on failure.
- Extending generated audio metadata with `mp3Path` changes assumptions in downstream stages. Search every consumer when adding a sibling artifact, especially stages that derive output names from the old extension.
- Existing fake-binary-on-PATH tests provide a small deterministic seam for external `ffmpeg` behavior; update command-string assertions when workflow stage arguments change.

## 2026-09-27

### 0172 — live MP3 episode verification

- For a publish-path task, verify the emitted live enclosure (MIME, URL extension, and RSS item) after the workflow completes; a successful local stage alone does not prove the feed contract.
- Keep an explicit residual when the task intentionally publishes a new compliant item instead of repairing old live data. The older WAV item still blocks submission because the criterion applies to every item.
- A late workflow-stage failure can strand expensive upstream artifacts. Use the existing run artifacts to reproduce and repair the failing stage, then launch a fresh cached run when the orchestration engine cannot resume at a failed node.

### 0173 — Apple-compliant channel artwork and feed checklist

- Separate implementation limits from live state. The microfeed API can update channel description/author/owner/icon, while categories remain admin-only; verify each field against the actual schema and mapper before describing it as unsupported.
- Image extension and served MIME are independent: microfeed stores the supplied upload `type` as object content type, while the path supplies the key extension. Verify both after upload; the admin cropper re-encodes to PNG and does not enforce the target size cap.
- Treat operator-applied settings as external state that invalidates old snapshots. After a successful live apply, refresh descriptions of missing fields and artwork, but retain the exact remaining feed blocker.
- Keep live identifiers and credentials out of repo docs. Record only the evidence needed to establish compliance (description length, owner presence, extension, MIME, and byte size).
- Pin vendor-source line anchors to the vendored revision and call out deployed-version skew; source anchors can drift even when the documented behavior is correct.

### 0176 — daily-intro MP3 input/output collision

- Fix path collisions where the path is derived, not at the caller: select the existing raw render first, use MP3 only as fallback, and always write to a distinct extension-normalized sibling.
- When a pipeline adds a derived artifact, audit downstream ordering and filename transformations. The 0171 `mp3Path` addition exposed a latent `.wav`-only rewrite that previously happened to work.
- Check both WAV-only and MP3-present workspaces, plus the idempotent short-circuit and preservation of the source render. Real failed-run artifacts can reproduce the bug without paying the upstream generation cost again.
- The CLI may execute a gitignored packaged plugin copy instead of the source tree. Sync that runtime copy before validating a script fix, or the test run may execute stale code.
### Doc-Evolve Wrapup Drift Audit & Repairs

Repairs completed per [docs/99_PROJECT_CONSTITUTION.md](file:///Users/robin/xprojects/knowledge-kit-dev-run-0182-89dc6/docs/99_PROJECT_CONSTITUTION.md) (§4.1, §4.3, §5, §6.1, §6.4, §6.5, §7):

- [docs/00_ADR.md](file:///Users/robin/xprojects/knowledge-kit-dev-run-0182-89dc6/docs/00_ADR.md): Bumped frontmatter `version: 1.30.0` and refreshed `updated_at: 2026-10-02` (resolving stale `2026-09-25` date following ADR-027 and ADR-028 additions). Synchronized ADR-028 Detail to cross-reference tasks `0180` and `0182`.
- [docs/03_ARCHITECTURE.md](file:///Users/robin/xprojects/knowledge-kit-dev-run-0182-89dc6/docs/03_ARCHITECTURE.md): Bumped frontmatter `version: 2.29.0` and `updated_at: 2026-10-02`. Added task 0182 mechanism to the XHS image-card / generator path: `ImageProvider.exactSize?(model, width, height)` capability seam, per-candidate aspect-only fallback invariant, header-only `imageDimensions` byte parsing, and the money-boundary post-spend warn-never-fail invariant for delivery dimension mismatches. Synchronized System shape and plugin tables to reflect `browser/script` drivers for WeChat MP (ADR-026) and browser publish channels (ADR-027).
- [docs/04_DESIGN.md](file:///Users/robin/xprojects/knowledge-kit-dev-run-0182-89dc6/docs/04_DESIGN.md): Bumped frontmatter `version: 2.39.0` and refreshed `updated_at: 2026-10-02`. Synchronized line 790 to include `width?` and `height?` in `.illustration = { path, bytes, width?, height? }`.
- [docs/design/xhs-image-cards.md](file:///Users/robin/xprojects/knowledge-kit-dev-run-0182-89dc6/docs/design/xhs-image-cards.md): Synchronized the Artifact contract (R5) to document `sizeRequest: 'exact' | 'aspect'` and raw provider delivery dimensions in `.illustration = { path, width?, height?, bytes }`.
- [docs/design/generator-plugin-specification.md](file:///Users/robin/xprojects/knowledge-kit-dev-run-0182-89dc6/docs/design/generator-plugin-specification.md): Updated `metadata.images[]` schema documentation to include `sizeRequest?` and `illustration?`, and appended amendments for task 0180 (typeset card copy) and task 0182 (preset canvas forwarding and delivery measurement).
- Task/feature corpus files under `docs/tasks/` and `docs/features/` were untouched.
- Quality gates: `bun run lint` checked 328 files with Biome 2.5.5 and typechecked all 29 workspaces/plugins cleanly (exit 0).
- Learning artifact written to [.spur/run/8e877b39-6321-4736-adf3-f0e0aa469e55-wrapup-learnings.md](file:///Users/robin/xprojects/knowledge-kit-dev-run-0182-89dc6/.spur/run/8e877b39-6321-4736-adf3-f0e0aa469e55-wrapup-learnings.md).

---

## 2026-10-02 — Task 0182: Deliver the preset canvas: forward declared width/height or record the delivered size

### Conventions

- **Opt-in capability seam over blind parameter forwarding**: Providers treat `width`/`height` inconsistently (some reject <1024, some map to fixed strings, others require specific aspect ratios). Canvas forwarding must be gated per-adapter and per-model via an optional method `ImageProvider.exactSize?(model: string, width: number, height: number): boolean` (`plugins/generations/image-gen/src/providers/types.ts`). An absent method strictly defaults to aspect-only (`exactSize === undefined`).
- **Aspect ratio mutual exclusion on exact requests**: Providers supporting exact pixel sizes (like MiniMax) prioritize or only inspect `width`/`height` when `aspect_ratio` is omitted. When `exactSize` evaluates to `true`, omit `aspectRatio` completely from the request; when `false`, send `{ aspectRatio }` and omit `width`/`height`.
- **Per-candidate fallback evaluation (D6 model isolation)**: `exactSize` must be evaluated dynamically for each candidate in a fallback chain using that candidate's own model (`candidate.defaultModel()`), never leaking the primary's `spec.model`. When an exact-capable primary falls back to an aspect-only candidate, the artifact truthfully records `sizeRequest: 'aspect'`.
- **Money boundary invariant (Warn-never-fail on post-spend mismatches)**: Once bytes are returned from a provider API, the cost has already been incurred. Delivery dimension mismatches (`WARN image-gen: <provider>/<model> delivered <W>x<H>; format '<name>' declares <W>x<H>`) or unparseable image bytes must emit a warning on stderr rather than throwing, which would trigger cleanup and delete paid output.
- **Truthful artifact dimensions and compose separation**: `ImageArtifact` records the actual delivered `width`/`height` parsed from bytes, plus `sizeRequest: 'exact' | 'aspect'`. On compose formats (task 0180 / ADR-028), the parent artifact retains the composed card canvas while raw provider delivery dimensions are recorded in `illustration.width`/`illustration.height`.

### Errors fixed

- **Dead preset canvas dimensions resulting in MiniMax 864x1152 deliveries**: Generator requests previously only mapped `aspectRatio: format.aspectRatio`, leaving preset `width`/`height` (e.g., 1080x1440 for `xhs-card`) dead. MiniMax `image-01` defaulted 3:4 aspect requests to 864x1152. Wiring `exactSize` to MiniMax `image-01` ensures wire requests carry `width: 1080, height: 1440` without `aspect_ratio`.
- **Throwing parser contract in `imageDimensions`**: `imageDimensions` in `src/bytes.ts` previously threw errors on non-PNG or corrupted buffers. It was refactored to return `null` across PNG, JPEG, and WebP, allowing callers to handle unparseable bytes gracefully without post-spend failures. The composer (`src/index.ts`) explicitly asserts card parseability and throws loud if the composed card itself is invalid.

### Patterns

- **Zero-dependency binary header parsers**: Implemented binary header inspection in `src/bytes.ts` without external dependencies:
  - PNG: IHDR chunk offset (16-24 bytes) big-endian uint32.
  - JPEG: Frame marker walk (SOF0–SOF15 except DHT/DAC/JPG), enforcing `length >= 2` to prevent infinite loops on truncated or malformed streams.
  - WebP: RIFF chunk walk handling VP8 (lossy 14-bit dimensions), VP8L (lossless 14-bit dimensions with 0x2f signature), and VP8X (extended 24-bit canvas dimensions) with even-byte padding stride.
- **Frozen error preservation through predicate refactoring**: Refactored existing throwing validators (MiniMax `validatePixelSize`) to derive from a shared boolean predicate `isAcceptablePixelSize(w, h)`, keeping existing error messages frozen byte-for-byte for legacy callers and tests while enabling reuse in `exactSize`.

### Gotchas

- **Documentation verification behind client-rendered SPAs**: Official MiniMax API documentation at `platform.minimaxi.com` returns 404/cookie-challenge responses to anonymous HTTP fetches (`curl`, headless proxies). The 512..2048 per-edge and %8 constraints were verified via existing pinned tests and documented as an evidence gap rather than asserting an unverified live URL.
- **Git worktree path confinement**: Git worktrees store `.git` as a file referencing `/path/to/main/.git/worktrees/<name>`, which contains `commondir: ../..`. Sandboxed shells restricted strictly to the worktree directory will fail Git operations with `Operation not permitted` unless proper directory permissions are established.
- **Throw vs. Null contract migrations across test suites**: Migrating a helper from a throwing contract to a `null`-returning contract requires updating or relocating existing negative-path characterization tests (e.g. moving tests from `compose-cmap.test.ts` to `bytes.test.ts`) while ensuring higher-level invariant checks (such as compose-card validation) retain fail-loud behavior where required.
Verification added: `Confidence: HIGH` recorded in the run-scoped learnings artifact and validated with the repo rule.

```
sh .spur/rules/structure/verification-confidence-level.sh   → exit 0
awk check on the artifact                                  → block seen=1, conf=1
```

File: `.spur/run/8df3d58c-4e61-4dac-a534-1e7be61f7077-wrapup-learnings.md` (verification block appended; no other content changed).

# Working learnings — E91 browser publish channels (0183–0188)

Source: the normalized batch capture `.spur/run/8df3d58c-4e61-4dac-a534-1e7be61f7077-wrapup-tasks.json`
(WBS 0183–0188). Grouped by date, then by task WBS. Each entry is a convention to keep, an error
that was fixed, a reusable pattern, or a gotcha.

## 2026-09-29 — refinement corrections (all six tasks)

- **0183/0185–0188 — "root catalog entry" is not an installed dependency.** `package.json`
  `workspaces.catalog` only declares a version; Bun's isolated store links declared deps only, so
  `packages/publish-harness/node_modules/@gobing-ai/` held just `kk-core` and each channel plugin
  declared neither `@gobing-ai/ts-browser-automation` nor `playwright`. Every consumer must add
  `"@gobing-ai/ts-browser-automation": "catalog:"` (+ `"playwright": "catalog:"`) and run
  `bun install`; the lockfile gains a workspace edge, not a new package. Do not assume a catalog
  entry means "already available".
- **0185–0188 — the live switch is `content.metadata.publishStatus === 'public'`.** No plugin uses
  `options.publish`; `xhs-pub/src/index.ts:618` and `wechatmp-pub/src/index.ts:319-321` are the
  precedent (ADR-022 / ADR-026). Any other value fails `ok: false` before a browser opens. A
  half-invented third convention (`options.publish`) is exactly what refinement rejected.
- **0183/0185–0188 — the stub tests are the old contract and get replaced, not preserved.**
  `infoq-pub` / `juejin-pub` / `substack-pub` / `x-pub` tests asserted the `agent` default,
  `sessionReady`, and agent/script parity — all removed by E91-D1. Replace those cases and update
  `plugin.json` descriptions in the same change; keep the suite as the regression net only for
  behavior that survives.
- **0185–0188 — `checkChannelSession` is `{status, profileDir, detail}` with an optional headed
  retry.** The publish preflight passes `headedFallback: false`; `withProfilePage` defaults to
  headed, so flows pass `headless` explicitly (`options.headless === true` opt-in). One shared
  result shape, not a boolean `{ok}`.
- **0185/0186 — success needs an observed, positive signal, not a click.** The wt seeds returned
  the URL after a sleep (infoq), waited 5 s for autosave (juejin), or clicked guessed draft
  buttons (substack). Freeze an explicit signal per channel: moved URL carrying an id, a visible
  toast, or a URL rewrite. E91-D6 is the rail — never report unseen success.
- **0186 — know the editor before choosing a fill helper.** Juejin's bytemd is CodeMirror over
  **markdown** (`fillCodeMirror`, no HTML); infoq/substack/x are ProseMirror/Draft.js rich text
  (`pasteHtml(markdownToHtml(body))`). Inspect the seed's editor, do not infer from the site.
- **0186 — the live popup has hard requirements.** Juejin's `确定并发布` cannot confirm without a
  category and ≥1 tag; a live run missing `content.metadata.category` or `content.metadata.tags`
  must fail `ok: false` naming the field **before** any browser opens.
- **0187 — no default publication for Substack.** `SUBSTACK_PUBLICATION_URL` is required; the
  seed's `https://substack.com/new` fallback lands on an arbitrary publication. Unset/blank/
  non-`https:` → `ok: false` naming the variable before a browser opens. Live path emails
  subscribers, so it stays behind `publishStatus: 'public'` and out of the operator dogfood.
- **0188 — article cover is not a Content field.** `ContentSchema` has no cover; use
  `options.coverPath ?? content.metadata.coverImage` (podcast-pub naming), optional, absolute path
  to an existing `.png|.jpg|.jpeg|.webp`, validated before the browser. The article path must not
  load Playwright for the `post` API path — `XPostApiTransport` stays importable without touching
  Playwright.
- **0183 — the 04 row for the design index is deliberately deferred.** The satellite row stays
  `planned (E91, ADR-027)` until the last channel task ships; flip it (and the satellite's own
  framing) at the shipping batch's doc-sync exit, not earlier.
- **0184 — verify a migration candidate against its actual behavior before widening the shared
  API.** xhs needs the ADR-025 guard around login/check; wechatmp captures `storageState` and
  re-injects cookies across a Chromium restart, and has no `KK_BROWSER_PROFILE_DIR` tier. Neither
  fits `runProfileCli` / `resolveChannelProfileDir` without a behavior change, so scope was
  narrowed: the shared module stays single-purpose; single-caller options are the signal to stop.

## 2026-10-05 — implementation and wrapup

- **0183 — shared library shape (the pattern the other five build on).** `packages/publish-harness/src/browser.ts`
  exports `resolveChannelProfileDir`, `checkChannelSession`, `runProfileCli`, `waitUntil`,
  `resolveSelector`, `pasteHtml`, `fillCodeMirror`, `uploadFile`, `expectOutcome`, `markdownToHtml`,
  re-exported through `"./browser": "./src/browser.ts"`. `src/index.ts` imports neither `./browser`
  nor `@gobing-ai/ts-browser-automation` (R5), so API-only plugins never load browser code. Proven
  by `bun build packages/publish-harness/src/index.ts --bundle` with 0 hits for the browser package
  or `ClipboardEvent`.
- **0183 — profile precedence, one rule.** `override` > `<CHANNEL>_PROFILE_DIR` >
  `KK_BROWSER_PROFILE_DIR` > `resolveBrowserProfileDir(channel)`; **blank counts as unset**, and no
  directory is ever created. Every channel implements exactly this.
- **0183 — error text is the contract.** Every helper failure throws an `Error` naming the selector
  (or outcome label) and the timeout; transports convert it to `{ ok: false, error }`. The main
  harness entry stays free of `console.*` / raw stdout (`no-raw-stdout-stderr` rule); `runProfileCli`
  writes through the injected `stdout` (ts-utils `echo` seam).
- **0183 — `expectOutcome` treats an empty-string probe as no signal.** `null` and `''` both mean
  "the browser showed nothing"; only a non-empty observed string is success. Timeout yields
  `{ ok: false, error: '<label>: no outcome observed within <ms>ms' }`.
- **0183 gotcha (carried into 0190) — `fillCodeMirror`'s keyboard branch has no post-condition.**
  `keyboard.insertText` is awaited and the function returns without confirming the editor received
  the text, unlike `pasteHtml`. A stolen-focus no-op can be reported as success; the juejin flow
  (0186) must assert the body after the fill. Deferred, not fixed, because the frozen surface did
  not require it.
- **0183 gotcha (carried into 0190) — `expectOutcome` propagates probe exceptions.** A probe that
  rejects (`page.evaluate` during navigation) rejects `expectOutcome` instead of yielding
  `{ ok: false }`; channel flows must wrap the probe or the "never report unseen success" rail
  becomes an unhandled rejection.
- **0183 advisory — `bun.lock` picked up an unrelated `apps/cli` version re-sync** (`0.0.28 →
  0.0.31`); correct against HEAD's release commit, but the change map under-disclosed it. Read lock
  hunks before writing "workspace edge only".
- **0183 advisory — bundling externals are not verified.** `scripts/bundle-plugins.ts` keeps only
  `playwright` external, so channel plugins inlining `publish-harness/browser` +
  `@gobing-ai/ts-utils` rely on `playwright` resolving at run time. Same shape as `xhs-pub` today;
  accepted, but unverified.
- **0184 — behavior-preserving extraction is proved by an unchanged suite and an equivalence probe.**
  Both plugin suites ran 97 pass / 0 fail **before and after**, and `git diff` over both test dirs
  was empty. A 100-combination probe (override × channel env × shared env, values
  `undefined / "" / "   " / path`) showed 0 differences in the 18 blank-free combinations; every
  difference contained a blank tier.
- **0184 — blank-as-unset is a real, disclosed semantic change.** xhs used `??`, so a blank
  `XHS_PROFILE_DIR=""` shadowed `KK_BROWSER_PROFILE_DIR`; the shared resolver treats blank as unset.
  No test covered it; closed in Q&A as accepted. Every migration that swaps an inline `??` chain for
  a shared resolver should expect this class of divergence.
- **0184 — helper-owned user-visible text drifts even when assertions hold.** The xhs `detail`
  string changed (`authenticated xhs session observed …` vs `… creator console observed …`;
  `headed … refused` vs `headless and headed … refused`), and a missing profile is now refused after
  one headless probe instead of two. Asserted substrings (`authenticated`, `readiness refused`)
  survived; repo-wide grep found no machine consumer of the full sentence. Disclose such deltas in
  the change map rather than hiding them.
- **0184 advisory — duplicated poll cadence.** The four xhs `waitUntil` call sites rely on the
  shared `pollMs = 500` default rather than passing `POLL_MS`, leaving two sources of "500"; a
  change to the shared default would silently change xhs cadence with no failing test.
- **0185/0186 — toast probes matched the article body the flow itself wrote (0195/0196).** Both
  `readToast` implementations search the whole document with `page.locator(':text("…")')`; a body
  containing `保存成功` / `提交成功` / `发布成功` satisfies the probe with no site signal — a false
  `ok: true` on the E91-D6 rail, reproduced for juejin (draft reported on the editor URL, no id, no
  toast, autosave window skipped). Fix shape: scope the read to the notification/toast container or
  exclude the editor subtree. **Probe scope is implementation's own choice even when the candidate
  strings are design-frozen** — a localized change needing the live DOM.
- **0185 — InfoQ's "public" is not a self-publish.** `提交` is submit for editorial review; the
  Result message must read `submitted for InfoQ editorial review` rather than claiming a publish.
  `保存草稿` is clicked on every run; `提交` only when `publishStatus === 'public'`.
- **0186/0187/0188 — draft success is always an observed URL/shape.** juejin:
  `/editor/drafts/<id>` or `保存成功`; substack: autosave rewrites to `/publish/post/<id>` with no
  click; x article: `/compose/articles/edit/<id>`. No signal within 30 s → `ok: false` naming the
  label and deadline; a draft run never clicks a live control.
- **0187 gotcha (0197/0198) — validation and derivation must not disagree.** `resolvePublicationUrl`
  validated with `new URL` but returned the raw string, while `editorUrl` re-derived the base with
  string surgery; `https://robin.substack.com/publish/posts` (the posts dashboard — a plausible
  paste) was accepted and became `…/publish/posts/publish/post/new`, surfacing as a session-refusal
  that sent the operator to re-login. Fix shape: keep the parsed `URL` and derive from
  `url.origin` + pathname.
- **0188 — adopting a documented tier fixes code drift, not behavior drift.** The stub resolved
  `options.profileDir ?? X_PROFILE_DIR` while `docs/04_DESIGN.md` already listed x-pub article under
  `KK_BROWSER_PROFILE_DIR`; `resolveChannelProfileDir('x', …)` made code match the documented
  surface, and the default profile dir stayed `…/browser-profiles/x`.
- **0188 — dropping the seed's `tweetButton`/`Tweet` candidates is deliberate.** They are
  post-composer controls; using them from the article flow would risk a tweet. Trim seed selector
  lists to the operation they belong to.
- **Batch doc-sync (0183–0188) — verify the satellite status, not just the section.** The working
  tree had already added the 04 §`publish-harness/browser` export table, the verdict table, the env
  row, and the harvest superseded notes, yet three T3/T1 surfaces were still stale: the 04 §0 design
  row still read `planned (E91, ADR-027)` after the last channel shipped; the satellite
  `docs/design/browser-publish-channels.md` still said the four channels "ship today as stubs";
  `docs/design/publish-plugin-specification.md` still framed the browser channels as
  "Accepted design (E7, not yet built)"; and `docs/03_ARCHITECTURE.md`'s `packages/publish-harness`
  module row listed only the pre-E91 helpers. Repaired in this wrapup: 04 row → `shipped (E91,
  ADR-027; 0183–0188)` with version 2.39.0 → 2.40.0; 03 module row and tree comment updated with the
  `./browser` command library and its real dependency set (`kk-core`,
  `ts-browser-automation`, `ts-utils`), version 2.29.0 → 2.30.0; satellite intro reframed to past
  tense with a `shipped (0183–0188)` marker and its interface block corrected to the code
  (`resolveSelector`, `runProfileCli` exit 2, `uploadFile`/`expectOutcome` opts); ADR-027 already
  read `Accepted` and needed no amendment. Lesson: a batch whose tasks each name "the 04 surfaces"
  can still leave 03's module descriptions and the design satellites' status framing stale — run
  the §7 audit over every key doc at batch exit, and grep `not yet built` / `planned (E<n>` across
  `docs/design/`.

<!--
Verification (2026-10-05, sp-doc-evolve wrapup): HIGH
- Coverage: 6 batch tasks (0183–0188) read from `.spur/run/8df3d58c-4e61-4dac-a534-1e7be61f7077-wrapup-tasks.json`
  plus each task body via `spur task show <wbs> --json`; every learning carries its task WBS and a
  date group.
- Doc-drift repair detected mechanically, not from reading: `rg` stale-framing sweep over
  `docs/00_ADR.md docs/03_ARCHITECTURE.md docs/04_DESIGN.md docs/design/*.md` plus a code/table diff —
  `resolveSelector`/`runProfileCli`/`uploadFile`/`expectOutcome` signatures transcribed from
  `packages/publish-harness/src/browser.ts:158,308,323,366` and `packages/publish-harness/package.json`
  `exports`/`dependencies`; both repairs re-checked and the sweep now returns `NONE`.
- Contract evidence: `docs/03_ARCHITECTURE.md` 2.29.0→2.30.0 and `docs/04_DESIGN.md` 2.39.0→2.40.0, both
  `updated_at: 2026-10-05`, `owns`/`authority`/`edit_rules` matching §4.1 (§4.3); ADR-027 already
  `Status: Accepted` at `docs/00_ADR.md:1066` (no amendment needed).
- Scope bound: doc-evolve only — no task/feature corpus written; learnings were not re-parsed from raw
  input, only the normalized batch JSON.
- Confidence: HIGH — every repair is anchored to a `file:line` or a command whose output was read; the
  one unverified area (live browser editor/toast behavior per channel) is explicitly out of this
  doc-evolve scope and recorded as the residual tasks 0190/0195–0198.
-->

## 2026-10-07 — E91 0193/0194 dogfood learnings

1. **Probe-first beats secondhand Q&A.** Both substack (editorUrl) and x-article (title mount, cover
   Apply) drifts were localized by differential DOM probes against the live composer, not by guessing.
   Keep `.spur/run/probe-*.ts` scratch out of lint scope (gitignored dir) and import publish-harness
   relatively in scratch probes (workspace names don't resolve under `bun <file>`).
2. **X article title is two-step**: `twitter-article-title` is a collapsed display div; the real
   textarea mounts only after clicking it. `fill()` refuses the div — always resolve-or-click first.
3. **X add-photos picker swallows setInputFiles**; set `fileInput` directly, then click the "Edit
   media" crop dialog's Apply, and assert a rendered non-avatar twimg image. A transport that reports
   ok without an observed postcondition will silently drop covers.
4. **Verdict artifacts validate strictly**: requirement/AC row statuses must be `MET` (not `pass`),
   and every check row needs `status`; Solution anchors must be repo-relative full paths — plugin-
   relative shorthand (`src/index.ts:181`) fails `L4.stale-line-anchor` even when correct.
5. **wrapup-pipeline workflow is unreliable in this env** (shimmed shells fail at task-resolve; agent
   steps hung historically) — inline the wrap: doc drift edit, learnings/metrics appends, then
   `spur feature advance <id> --json`.

## 2026-10-09 — G32 batch 0225–0229 (store v2 cut-over; 0230 failed, 0241 incident)

1. **Gotcha — the incident (0241).** `bun link`ing the batch worktree build as the global `kk` while a
   **scheduled job runs against the live tree** let the 04:00 collector migrate the operator's live store:
   its first `kk store lock acquire` opened the store and `openStore` applied `0003_store_v2`. The link was
   authorized for the dogfood; the scheduled consumer was not considered. Reverting a link is not enough on
   its own — `bun unlink` **removes** the global package (restore with `bun install -g <pkg>@<version>`).
2. **Gotcha — a `.db` sha256 is blind to a WAL-resident migration.** The live store's `kk.db` stayed
   byte-identical (`3d21b641…`) while `0003_store_v2` + a whole collect's writes sat in `kk.db-wal`. Any
   "the live store was never touched" claim must be read through SQLite (`select id from
   __kk_store_migrations`), never from a file hash. The same blindness made a "sidecars untouched" claim false.
3. **Error hit and resolved — a task spec can mandate the impossible.** 0226 R1 required the catalog
   `version: 1 → 2`; the installed `@gobing-ai/spur@0.4.0` schema pins `version` to the literal `1`, so the
   whole catalog refused to load and every `spur decision run` consult — the label pass's core path — was
   dead. Check the installed schema before following a version-bump instruction; a spec is not a source of truth.
4. **Convention discovered — the residual scanner reads the review's disposition column.** A bare `OPEN`
   is classed **blocking**, closes the `record → done` guard and folds the verdict to PARTIAL. Give every
   non-requirement finding an owner (`DEFER (<wbs>)` / `ACCEPTED (<wbs>)` / `RESOLVED`).
5. **Convention discovered — verdict AC rows must lead with the task's own AC id.** `spur task record` flips
   AC checkboxes by the row's leading id; a feature-scenario id (`R8 — …`) leaves every `AC*` box unchecked,
   which then blocks as `unchecked-box` after a PASS verify.
6. **Evidence: what moves the proof digest.** The verify stage's `## Testing` write and the review's
   `## Review` write do **not** move it, but probe temp SQLite stores left in the worktree **root** do — and
   that fails the record-stage `run.artifact` binding. Keep every probe artifact in `/tmp` or a gitignored dir.
7. **Pattern that worked — one proof digest per task, with independent probes.** Gate → triage (the lane is
   pinned to `safety` by diff size in an accumulated batch) → fresh-session review → observe-only verify, all
   bound to one digest. The reviewers' own probes (throwaway DAGs for the engine's skip semantics, live-store
   copies for label eligibility, a maker×decision matrix) found what the suites could not.
8. **Gotcha — a fail-closed gate plus a fallback outside it equals an empty pool.** `kk-item-china-politics:
   { lte: 1 }` with `fallback: 3` and a maker that cannot answer (`fm-local` → `reason: error`) excluded every
   item: the daily pool went to 0 without a single test failing. Fail-closed gates need a live-maker
   precondition and an observability signal naming the decision and the maker.
9. **Gotcha — a `score` decision needs an integer level.** `typesafe` answers a 0–1 fraction, which `kk`'s
   validator refuses, so those observations are dropped silently (0236). Match a maker's answer scale to the
   rubric's discrete levels before wiring it into a profile gate.
10. **Structural note — the batch's uncommitted-diff model invalidates earlier certificates.** Each task's
    proof digest covers the whole tree, so every later task's writes make the earlier proofs stale. Commit
    per task (or accept that only the last task's certificate is current) — the batch-once commit is a
    provenance compromise, not a neutral choice.

## 2026-10-09 — batch `dev-runall --feature G32` (tasks 0230, 0239, 0240; 0242 blocked)

**Decisions**

- **Binary/schema skew is an operational failure mode, not a code defect (0242).** The scheduled collector failed
  with `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint` because a 0.0.33 binary (which
  upserts `labels` on the pre-v2 `(item_id, decision_id)` index) wrote a store already migrated to v2 by another
  process. `main` had no defect. The fix is a **guard**, not a collector patch: `applyKkMigrations` now reads the
  journal and throws `kk.store.schema-newer: <db> has migrations [<ids>] this kk does not know — upgrade kk`
  before any DDL. Every `kk` binary from 0.0.34 on is protected; 0.0.33 cannot be patched.
- **A `score` decision answers a position on the level axis, not a fraction (0240).** spur bounds the score to
  `[0, rubric.length-1]`. `kk` now stores `String(Math.round(score))` in `value` and keeps the exact answer in
  `raw_value`; out-of-range and non-numeric answers are refused and reported as
  `refused: {"<decision>@<maker>": n}` in the label verdict line. The earlier "0–1 fraction" reading was an
  artifact of probe values that happened to lie below 1.
- **`0242` stops as `blocked` at its operator gate.** R1 (guard) and R5 (persistent-store docs) shipped; R2
  (global binary upgrade via `bun link` or a 0.0.34 release), R3 (locked live-data repair) and R4 (green
  collector) need explicit operator authorization and were not performed.

**Patterns that worked**

- **Test-first with a mutation check for a parity oracle (0239 R2).** Widening `declaredColumns`/`liveColumns`
  to compare `notnull`, `dflt_value` **and** DDL order made the builder↔DDL test sensitive; flipping a single
  `.notNull()` on `labels.labeled_at` was verified to fail the test, then reverted. An oracle you have not seen
  fail is not an oracle.
- **Deleting a dead accessor before consolidating (0239 R3).** `SelectionsDao.excludedStories` had no production
  caller; the only live exclusion predicate is `ItemsDao`. Deleting it left one predicate site, so no shared SQL
  fragment was needed. Extracting a helper first would have been an abstraction with one caller.
- **Re-deriving every anchor against the file (0230 R7/R8).** The refine had shifted `.spur/config.yaml` line
  numbers by four; `spur task check` surfaced `L4.anchor-subject-mismatch` until each citation was re-read from
  the file rather than carried forward.

**Gotchas**

- **A wrap hop that writes an excluded plane is silently destroyed by `git worktree remove`.** The batch-once
  wrap was invoked inside the `--worktree` tree; its `metrics`/`learnings` output landed in `.spur/memory/`
  (excluded via `.git/info/exclude`, so `git status` reports clean and the FF merge carries nothing). Because
  `git worktree remove` treats ignored files as clean, the tree was removed and the artifacts were lost without
  an error. **The wrap (and any post-commit hop) must run in the invoking tree, or WT-3b must be re-committed
  after it.** Recovery is a re-run on the main tree — deterministic for metrics, manual for learnings.
- **`vars.tasks` is a JSON-encoded *string*, not a JSON array.** `spur workflow run --vars` rejects non-string
  values, so the correct form is `--vars '{"tasks":"[\"0230\",\"0239\"]"}'`; passing a bare array fails with
  `--vars values must be strings; "tasks" is object`.
- **A `\p{L}` word class silently swallows CJK (0239 R5).** `storyTokens("OpenAI发布新模型")` produced one token,
  `"openai发布新模型"`, so mixed-script titles could never cluster. The fix is a `v`-flag set subtraction,
  `[[\p{L}\p{N}]--[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]]+` — CJK bigrams on one side, Latin
  words on the other.
- **SQLite needs `WHERE true` before `ORDER BY … ON CONFLICT` in `INSERT … SELECT`.** The clause is mandatory to
  resolve the upsert parse ambiguity (sqlite.org/lang_upsert.html § "Parsing Ambiguity"); without it the
  statement is a syntax error, with it the migration is deterministic (earliest `used_at`, ties by `workflow`).
- **`PRAGMA table_info` ordering is the DDL order, and `bun:sqlite` returns snake_case keys.** A test helper that
  maps `dflt_value` → `dfltValue` and sorts by name cannot detect a column-order regression; read the pragma
  directly and keep its order.
- **`spur task update <wbs> done` needs a recorded pipeline run.** Without one the lifecycle gate denies the
  transition; `spur task run-link <wbs>` records the link (per-tree provenance DB) and unblocks it. The `wip`
  → `done` edge is illegal — route through `testing`.

## 2026-10-09 — G32 close-out: 0242 R2–R6 (global upgrade, live repair, green collector)

**Decisions**

- **A stale global binary is a production failure mode; the schema is not the only contract.** The collector
  failed with `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint` because `~/.bun/bin/kk`
  was 0.0.33 while the store was already v2. `main` had no defect. The fix shipped as a guard, not a patch:
  `applyKkMigrations` (`packages/kk-store/src/migrations.ts:312`) now throws `kk.store.schema-newer` before any
  DDL. From 0.0.34 on, skew fails at open with a named cause instead of half-writing a run.
- **"Read-only" must be enforced, not asserted.** `warnUnreleasedRuns` was documented "best-effort and
  read-only" but called `openStore`, which migrates on open — so the probe upgraded the store it was reading.
  `openStore` now takes `migrate?: boolean` (`packages/kk-store/src/db.ts:66`), and the probe passes `false`
  (`apps/cli/src/commands/daily.ts:140`). A read may not write; if a doc comment claims a property, the
  signature must carry it.
- **Operator chose the `bun link` stop-gap over a 0.0.34 release** for the global upgrade. Recorded and
  accepted: while the global is a link, production tracks the working tree, so a release must precede the next
  schema-bumping change.

**Patterns that worked**

- **Write the falsification control INTO the regression test.** The R6 test opens a real v1 store with
  `migrate: false` (journal stays `0001+0002`) and then opens the *same* store with the default (journal
  advances to `0003`). Without that control the test passes vacuously — my first attempt used a synthetic
  journal-only database where migration failed anyway, and it passed with the fix removed. Deleting the
  `migrate === false` branch now fails with `Expected: 0, Received: 1`.
- **Prove a whole-suite claim with bytes, not prose.** `sha256` of the operator's `.works/kk.db` before and
  after `bun run gate` from the repo root (unchanged: `834885246c731ff8`), plus "no `-wal`/`-shm` created", turns
  "the suite is isolated now" into one checkable line.
- **Pin a coverage claim to a commit, not to HEAD.** The `[Unreleased]` block first read
  `..HEAD -> 21 commits`, which became 22 the instant the changelog commit landed — a self-falsifying claim.
  Pinning the tip to the commit *before* the entry (`..99623957 -> 24`) keeps the arithmetic checkable forever.
- **Re-derive anchors instead of carrying them forward.** `spur task check`'s `L4.anchor-subject-mismatch` caught
  two citations that had drifted (a `package.json:3` version line cited for a bin claim, and a config block
  cited for per-decision keys). Re-reading the file is cheaper than a wrong anchor.

**Gotchas**

- **An interrupted workflow leaves a `RUNNING` receipt that blocks the feature lifecycle.** Aborting
  `feature-verification.yaml` left `.spur/memory/evidence/G32-feature-verification.json` at
  `status: "RUNNING"`, `completedAt: null`; `spur feature sync G32` then reported
  `feature-verification receipt missing or invalid; stopped at verifying`. The receipt is written at start and
  completed at the end, so a kill mid-pass is indistinguishable from "never ran" to the gate. Re-run the pass;
  do not hand-edit the receipt.
- **A `--worktree` batch's post-commit hops write an excluded plane that `git worktree remove` destroys.**
  `.spur/memory/` is excluded (`.git/info/exclude`), so `git status` reads clean, the FF merge carries nothing,
  and `git worktree remove` treats ignored files as clean — the wrap's metrics and learnings vanished without an
  error. Run the wrap in the invoking tree, or re-commit after it.
- **`spur workflow run --vars` takes JSON-encoded STRINGS**, so a task list is
  `--vars '{"tasks":"[\"0230\",\"0242\"]"}'`; a bare array fails with `--vars values must be strings`.
- **A readonly `bun:sqlite` open of a WAL database fails with `SQLITE_CANTOPEN` when no `-shm` exists.** Copy the
  file aside and open the copy read-write (without any kk code) to inspect a journal; never open the original
  read-write just to read it.
- **The feature lifecycle needs a receipt, not just green tasks.** All 10 G32 tasks reached `done` and
  `spur feature check G32 --strict` passed, yet the feature sat at `verifying` until the ADR-119
  feature-scoped verification pass recorded `.spur/memory/evidence/G32-feature-verification.json`. Task-level
  done does not advance a feature.
- **Do not `env | grep` on this host to probe configuration.** It printed live API keys into the session
  transcript; they are now compromised and need rotation. Read a specific variable (`echo "$PI_SESSION_ID"`)
  instead.
