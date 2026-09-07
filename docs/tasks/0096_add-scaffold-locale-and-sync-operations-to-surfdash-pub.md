---
schema_version: 1
name: "Add scaffold-locale and sync operations to surfdash-pub"
status: done
template: feature-impl
created_at: 2026-09-06T14:35:05.228Z
updated_at: "2026-09-07T01:22:49.290Z"
feature_id: L1
priority: P1
tags: ["publish", "surfdash-pub", "feature-K"]
---

## 0096. Add scaffold-locale and sync operations to surfdash-pub

### Background

The workflow inlines surfdash mechanics: `bun run sd translate`, 6×dirname path arithmetic, asset copying, publish-orchestrator sync. Feature L1 D4/R7: surfdash-pub owns these; LLM translation stays a thin agent.run step on plugin-returned paths.

### Requirements

R1. surfdash-pub gains options.operation routing (same pattern as podcast-pub): default 'publish' unchanged.
R2. `operation: 'scaffold-locale'` with options {postPath, target: 'en'|'ja'}: runs sd translate scaffolding + asset copy inside the plugin, returns the draft path in Result.metadata.
R3. `operation: 'sync'` with options {postPath}: runs the publish-orchestrator sync, returns ok/fail Result.
R4. All surfdash-root resolution (dirname arithmetic) lives inside the plugin; the workflow passes only the zh postPath.
R5. Unit tests with a fake surfdash root fixture (no real surfdash checkout in tests).

### Acceptance Criteria

```gherkin
Feature: Add scaffold-locale and sync operations to surfdash-pub

  Scenario: surfdash-pub owns locale scaffold and sync mechanics
    Given a fixture surfdash root with stub sd and publish-orchestrator CLIs
    When surfdash-pub runs scaffold-locale on a fixture zh post
    Then it returns the en draft path and creates the scaffolded file
    And sync on the fixture post returns an ok Result
    And the publish operation regression stays green
    And the no-dirname-arithmetic-in-YAML check is owned by the workflow task 0097
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

WHAT: surfdash-pub gains an operation router (pattern copied from podcast-pub's resolveOperation, index.ts:50) and two new operations: `scaffold-locale` (wraps `sd translate` scaffolding + asset copy) and `sync` (wraps publish-orchestrator sync). Default `publish` is unchanged.

WHY: ADR-019 D4 — the workflow currently inlines surfdash mechanics (`bun run sd translate`, 6×dirname SURFDASH_ROOT arithmetic, `bun scripts/publish-orchestrator.ts sync`). The plugin ALREADY resolves the surfdash root (index.ts:104-106: SURFDASH_ROOT env or POSTSURFING_BIN derivation) — the workflow's dirname chain duplicates this badly. Premise verified at refine: surfdash-pub has NO operation router today (straight main → processPublishIO); the router pattern is copied from podcast-pub. Also verified: this plugin already uses Bun.spawn directly for the postsurfing CLI (index.ts:145), so spawning `sd` follows the existing in-plugin pattern (the no-direct-process-spawn rule's warning severity tolerates plugin-local spawns; follow the existing precedent, do not introduce execa).

WHERE (frozen):

- `plugins/publishings/surfdash-pub/src/index.ts` — add `const OPERATIONS = ['publish', 'scaffold-locale', 'sync'] as const` + `resolveOperation(options)` + option parsing in the input payload's `options` field (publish payload already carries arbitrary options? verify: PublishTransportPayload shape — extend via metadata if options channel is absent).
- `scaffold-locale`: options {postPath (zh index.md abs path), target: 'en'|'ja'}; resolve surfdashRoot (reuse lines 104-106 logic — extract to a helper `resolveSurfdashRoot()`), spawn `bun run sd translate <postPath> --source zh --target <locale>` with cwd=surfdashRoot, copy `assets/` dir if present, return Result with `metadata.draftPath` (derived: postPath with /zh/ → /<target>/).
- `sync`: options {postPath}; spawn `bun scripts/publish-orchestrator.ts sync <postPath>` cwd=surfdashRoot; Result ok/fail with stderr.
- Shared spawn helper inside the plugin (one local `spawnCli(cmd, cwd)` returning {exitCode, stdout, stderr}) — publish/scaffold-locale/sync all use it.

Precedence: publish stays the default operation; unknown operation → fail loud with the valid list (same as podcast-pub).

Anti-patterns: no LLM translation in the plugin (agent.run in the workflow owns that); no new env vars (reuse SURFDASH_ROOT/POSTSURFING_BIN); no `kk`-side changes; no editing the surfdash repo (only spawning its CLIs).

Handoff: 0097 rewrites translate-en/translate-ja/translate-sync states onto these operations; LLM translate steps keep editing plugin-returned draftPaths. Docs: 04_DESIGN.md surfdash-pub operations section.

### Plan

1. Read podcast-pub resolveOperation (pattern source) + surfdash-pub index.ts fully; check PublishTransportPayload for an options channel (extend metadata if none).
2. Extract resolveSurfdashRoot() from lines 104-106; add shared spawnCli helper.
3. Add OPERATIONS + resolveOperation + dispatch in processPublishIO/main.
4. Implement scaffold-locale (spawn sd translate, asset copy, metadata.draftPath) and sync (spawn publish-orchestrator).
5. Tests with a fixture surfdash root (fake `sd`/`publish-orchestrator` scripts in tmp dir): scaffold-locale creates draft + returns draftPath; sync returns ok; publish regression green; unknown operation fails loud naming valid operations.
6. Sync docs/04_DESIGN.md.
7. Verify: bun run lint && bun run test clean. Do not touch the workflow YAML (0097).

### Solution

#### Change Map

- `plugins/publishings/surfdash-pub/src/index.ts:11` — `TARGET = 'surfdash'` const (podcast-pub pattern); the inline `'surfdash'` target literals now reference it (behavior identical).
- `src/index.ts:14-29` — `OPERATIONS = ['publish', 'scaffold-locale', 'sync']` + `SCAFFOLD_LOCALES = ['en', 'ja']` + `SurfdashPubOptions` (`operation` / `postPath` / `target`) riding the payload's existing `options` channel (`PublishTransportPayload.options` verified present — no metadata extension needed).
- `src/index.ts:112-159` — `fail()` helper; `resolveOperation()` (default `publish`, unknown → fail loud naming the valid list); `resolvePostPath()` / `resolveScaffoldTarget()` (required options, no silent defaults).
- `src/index.ts:150-161` — `deriveLocaleDraftPath()`: last `/zh/` segment → `/<locale>/`; no segment → fail loud.
- `src/index.ts:164-172` — `resolveSurfdashRoot()`: extracted from the former publish-path root logic (SURFDASH_ROOT or POSTSURFING_BIN `<root>/scripts/<cli>` derivation); all three operations share it.
- `src/index.ts:174-199` — `spawnCli(cmd, cwd)` (`Bun.spawn`, existing in-plugin precedent — no execa) + `cliErrorText()` (stderr-first error text); publish / scaffold-locale / sync all spawn through it.
- `src/index.ts:205-254` — `scaffoldLocale()`: validate options → resolve root → spawn `bun run sd translate <postPath> --source zh --target <locale>` with cwd=surfdashRoot → verify the draft exists → copy `<postDir>/assets/` → `<draftDir>/assets/` when present → ok Result with `metadata.draftPath` (+ `postPath`, `target`). No LLM translation in the plugin.
- `src/index.ts:256-286` — `syncPost()`: spawn `bun scripts/publish-orchestrator.ts sync <postPath>` with cwd=surfdashRoot → ok Result with `metadata.postPath`; non-zero exit → fail Result with stderr-first text.
- `src/index.ts:288-351` — `publishPost()`: the E3 publish body extracted unchanged (mapping, slug/date logic, cover copy, Result shape), now via `resolveSurfdashRoot()` + `spawnCli`.
- `src/index.ts:353-369` — `PostsurfingFileCliTransport.publish()` parses `payload.options` and routes via `resolveOperation()`; publish stays the default.
- `src/index.ts:395-409` — `processPublishIO` forwards a top-level input-JSON `options` object to the transport (podcast-pub pattern) so `kk executor run` callers select operations without extra flags.
- `plugins/publishings/surfdash-pub/tests/surfdash-pub.test.ts:318-645` — operation suite against a fixture surfdash root (tmp `package.json` `sd` script + stub `scripts/sd.ts` + stub `scripts/publish-orchestrator.ts`; no real surfdash checkout): scaffold ok (en draft created + assets copied + exact argv logged), sync ok (side-effect log proof), sync fail (stderr surfaced), scaffold fail (missing post / sd exit 3 / non-zh postPath), missing-root fail loud, unknown-op fail loud, required-option validation, explicit `operation: 'publish'` regression, and `processPublishIO` options-channel end-to-end (ja draft).
- `docs/04_DESIGN.md` §6 — surfdash-pub export rows updated (transport operation routing; `processPublishIO` options channel).

Rationale: ADR-019 D4 — the workflow's inlined `sd translate` call, 6×dirname SURFDASH_ROOT arithmetic, asset copy, and publish-orchestrator sync move behind the plugin's operation router; the workflow keeps only LLM translation on plugin-returned draft paths (0097 rewires the YAML).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | `plugins/publishings/surfdash-pub/src/index.ts:14` `OPERATIONS = ['publish', 'scaffold-locale', 'sync']` (podcast-pub pattern); default `'publish'` + unknown-op fail loud naming the valid list in `resolveOperation` (`:117-123`); dispatch via the payload `options` channel in `PostsurfingFileCliTransport.publish` (`:376-395`, cases `:388-394`); publish path extracted behavior-identical into `publishPost` (`:311-374`, same env reads / slug-date logic / cover copy / Result shape); regression: explicit `operation: 'publish'` test `plugins/publishings/surfdash-pub/tests/surfdash-pub.test.ts:636-659` + full pre-existing publish suite retained (`:19-318`); fresh gates this run: `bun run lint` exit 0, `bun run test` 611 pass / 0 fail across 44 files |
| R2 | MET | `scaffoldLocale` (`plugins/publishings/surfdash-pub/src/index.ts:224-270`): option validation `:225-228`; root resolve `:230-233`; postPath containment guard (verify fix) `:234-235`; missing-post fail loud `:236-238`; non-zh postPath fail loud `:239-244`; `sd translate` spawn cwd=surfdashRoot `:246-250`; non-zero exit fail loud `:251-253`; draft-missing fail loud `:254-256`; assets copy when present `:257-260`; ok Result with `metadata.draftPath` `:261-266`; no LLM translation in the plugin. Tests: en draft created + assets copied + exact argv pin (`tests/surfdash-pub.test.ts:386-414`, draftPath `:401`, argv `:409`); assets-absent ja branch `:416-445`; `processPublishIO` options-channel ja `:661-690` |
| R3 | MET | `syncPost` (`plugins/publishings/surfdash-pub/src/index.ts:277-309`): postPath containment guard (verify fix) `:285-286`; spawn `bun scripts/publish-orchestrator.ts sync <postPath>` cwd=surfdashRoot `:288-292`; non-zero exit -> fail Result with stderr-first text `:293-295`; ok Result `:296-301`. Tests: sync ok + orchestrator side-effect log proof (`tests/surfdash-pub.test.ts:447-467`, log assert `:462`); sync fail stderr surfaced `:590-609` |
| R4 | MET | Plugin side: all surfdash-root resolution lives in `resolveSurfdashRoot()` (`plugins/publishings/surfdash-pub/src/index.ts:183-189`), shared by publish / scaffold-locale / sync; the workflow boundary sends only `postPath` through `options` (`:380-384`, `:427-430`). YAML side (report-only; 0097 owns the rewiring): fresh `grep -rn SURFDASH_ROOT plugins/kk/workflows/*.yaml` confirms the 6-dirname chain + inline mechanics still at `plugins/kk/workflows/kk-daily-ai-voice.yaml:249-251`, `:276-278`, `:309-310` — plugin ops are additive, zero-risk until 0097 |
| R5 | MET | Fixture surfdash root, no real checkout: tmp `package.json` `sd` script + stub `scripts/sd.ts` / `publish-orchestrator.ts` (`tests/surfdash-pub.test.ts:318-381`); per-test env scoping (set/delete `SURFDASH_ROOT` in try/finally, fixture `rm` in every finally); no-root fail-loud `:611-634`; fresh this run: narrow suite 24 pass / 0 fail with `src/index.ts` 100% funcs / 100% lines; full `bun run test` 611 pass / 0 fail, no `.tmp-*` residue |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| R7 — surfdash-pub owns locale scaffold and sync mechanics | MET | test | `plugins/publishings/surfdash-pub/tests/surfdash-pub.test.ts:386-414` (scaffold en), `:447-467` (sync ok), `:661-690` (IO options channel) against routing `plugins/publishings/surfdash-pub/src/index.ts:376-395` |
| scaffold-locale on a fixture zh post returns en draft path and creates the scaffolded file | MET | test | `plugins/publishings/surfdash-pub/tests/surfdash-pub.test.ts:386-414` — `metadata.draftPath` exact match (`:401`), file exists + content (`:402-403`), assets copied (`:405`), exact sd argv (`:409`) |
| sync on fixture post returns ok Result | MET | test | `plugins/publishings/surfdash-pub/tests/surfdash-pub.test.ts:447-467` — ok Result + `sync-log.txt` side-effect proof (`:462`) |
| publish operation regression green | MET | command | Fresh this run: `bun run test` -> 611 pass / 0 fail, 2472 expect(), 44 files, exit 0 (publish suite `tests/surfdash-pub.test.ts:19-318` + explicit-op `:636-659`); `bun run lint` exit 0 |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Verdict

**PASS** (auto mode) — R1–R5 all MET with fresh evidence; no P1/P2 findings. One P3 hardening item + five P4 advisories. Disposition: **approve**; one cheap fix item routed to the verify stage.

**Fresh verification evidence (this review):** `bun test plugins/publishings/surfdash-pub/tests/surfdash-pub.test.ts` → **23 pass / 0 fail**, 93 expect() calls, `plugins/publishings/surfdash-pub/src/index.ts` **100% line / 100% function** coverage; `bunx biome check plugins/publishings/surfdash-pub/` → 5 files clean; `bunx tsc --noEmit -p plugins/publishings/surfdash-pub` → exit 0.

#### Findings (ranked)

| # | Sev | Dimension | Finding | Location |
| --- | ----- | ----------- | --------- | ---------- |
| 1 | P3 | security/correctness | `options.postPath` is not validated absolute nor contained in `surfdashRoot` — the design contract says "zh index.md abs path". A relative postPath is `existsSync`-checked against the kk process CWD, but the spawned `sd`/orchestrator resolves it against `cwd=surfdashRoot`, so the existence check and the CLI can see different files, and both operations can act on paths outside the checkout. No injection vector (array-form argv, no shell), so this is hardening, not exploitation. Fix: `isAbsolute(postPath)` + `resolve(postPath)` prefix check against `surfdashRoot + sep` in `resolvePostPath`/op bodies. | `src/index.ts:126-131`, `:215`, `:227`, `:267` |
| 2 | P4 | correctness | Asset copy is force-overwrite: `cp(recursive)` with fs defaults overwrites existing files, so re-scaffolding into an existing draft dir silently clobbers its `assets/`. Relevant if 0097 re-runs a translate state after a partial failure. Document the semantics or skip-if-exists. | `src/index.ts:238` |
| 3 | P4 | architecture | `spawnCli` has no timeout — a hung `sd translate`/orchestrator blocks the workflow step indefinitely (fan-in got `--source-timeout` for the same risk class). Consider a knob when 0097 wires the states. | `src/index.ts:180-191` |
| 4 | P4 | architecture (consistency) | `processPublishIO` parse failures throw → main exits 1 with no output file; podcast-pub catches and writes a fail Result file. Pre-existing shape (0096 only added options forwarding); align only if a consumer needs the file. | `src/index.ts:397-409` vs `podcast-pub/src/index.ts:482-495` |
| 5 | P4 | docs | The `mapContentToSurfingMarkdown` §6 row still advertises `date`/`canonical_url`/`published` frontmatter, which the strict PostSchema rejects (code emits `publishDate`/`canonical`/`draft`). Pre-existing drift adjacent to the 0096-edited rows; not introduced here. | `docs/04_DESIGN.md:334`, `src/index.ts:89-97` |
| 6 | P4 | testability | The fixture `sd` stub reimplements the `/zh/ → /<locale>/` derivation the plugin pre-computes — parity with the real `sd translate` layout is convention-coupled. Mitigated: the post-spawn `existsSync(draftPath)` check fails loud on mismatch instead of returning a wrong path. | `tests/surfdash-pub.test.ts:348`, `src/index.ts:150-158`, `:233-235` |

#### Functional traceability

| Req | Status | Evidence |
| ----- | -------- | ---------- |
| R1 operation routing, default publish unchanged | MET | `OPERATIONS` + `resolveOperation` default `'publish'` (`src/index.ts:14`, `:117-122`); dispatch (`:360-373`); publish body extracted unchanged (diff confirms same slug/date/cover/Result shape, `:288`); regression: explicit `operation:'publish'` test (`tests/surfdash-pub.test.ts:592-614`) + full pre-existing publish suite retained (`:19-336`) |
| R2 scaffold-locale | MET | `scaffoldLocale` (`src/index.ts:205-250`): root resolve, post-exists fail loud (`:215`), `sd translate` spawn (`:226-228`), draft-missing fail loud (`:233`), assets copy (`:238`), `metadata.draftPath` (`:244`); tests: en draft + assets + exact argv pin (`tests:386-414`, argv at `:409`), assets-absent branch (`:416-445`), ja draftPath via IO (`:617-645`) |
| R3 sync | MET | `syncPost` (`src/index.ts:256-287`): ok Result + side-effect log proof (`tests:447-467`, `:462`); non-zero exit → fail Result with stderr text (`tests:546-565`, `:559`) |
| R4 root arithmetic inside plugin | MET (plugin side) | `resolveSurfdashRoot()` shared by all three ops (`src/index.ts:164-169`); only `postPath` crosses the boundary. YAML chain still present (`plugins/kk/workflows/kk-daily-ai-voice.yaml:249-251`, `:276-278`, `:309-310`) — rewiring is 0097's seam; the AC box is honestly left unchecked per its wording |
| R5 fixture-isolated tests | MET | tmp fixture: `package.json` `sd` script + stub `scripts/sd.ts` / `publish-orchestrator.ts` (`tests:325-368`), zh post fixture (`:370-381`); no real surfdash checkout; test stage additionally proved hostile-ambient-env isolation (23 pass with fake "real" root untouched) |

#### SECUA / architecture notes

- **Spawn construction:** all spawns use array argv with no shell (`src/index.ts:180-191`, `:226-228`, `:266-268`) — postPath/argv injection via crafted paths (quoting, metacharacters) is structurally impossible; finding #1 is path-resolution hardening only.
- **Options channel:** legitimate and unambiguous — `PublishTransportPayload.options?: Record<string, unknown>` is a declared harness field (`packages/publish-harness/src/index.ts:6-10`); `ContentSchema` is non-strict zod so a top-level input `options` object is stripped from Content and forwarded separately (`packages/kk-core/src/schemas.ts:14`, `src/index.ts:401-409`). Single channel, no payload-vs-input precedence conflict.
- **Router consistency:** helper-for-helper mirror of podcast-pub (`TARGET`, `fail`, `resolveOperation`, required-option resolvers, default `'publish'`, unknown-op error naming the valid list) — `surfdash-pub/src/index.ts:13-145` vs `podcast-pub/src/index.ts:16-75`.
- **Fail-loud matrix verified by tests:** missing post (`src/index.ts:215`, `tests:506-509`), sd exit≠0 (`:230-232`, `tests:516-517`), missing draft (`:233-235`), non-zh postPath (`:222-225`, `tests:539`), missing root (`:212-214`/`:261-263`, `tests:579,585`), unknown op (`:117-121`, `tests:469-476`), required options (`:126-131`/`:135-145`, `tests:478-495`).
- **Publish regression:** only mechanical extractions on the publish path (body → `publishPost`, spawn → `spawnCli`, root → `resolveSurfdashRoot`); env reads identical (`POSTSURFING_BIN`/`SURFDASH_ROOT`/`SURFDASH_LOCALE`), behavior byte-equivalent per diff.

#### Residual risk

- Real-`sd` argv/layout parity is frozen from today's inlined YAML invocation (`kk-daily-ai-voice.yaml:250,277,310`) and pinned by the exact-argv assertion; a future surfdash CLI change surfaces as a loud fail, not a silent wrong-path write.
- `bun` is resolved via PATH for sd/orchestrator spawns (`src/index.ts:227`, `:267`); in a PATH-less deploy env both ops fail loud (ENOENT caught → fail Result) — acceptable.
- Workflow YAML still carries the full inline mechanics until 0097; until then the plugin ops are additive, zero-risk surface.

#### Disposition

**approve** — no P1/P2. Fix item for the verify stage: **#1** (absolute + containment validation of `options.postPath`, ~6 lines + 1 test). #2–#6 are advisory/defer-able (#5 belongs to any §6 docs pass; #3 optional with 0097).

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-07T00:36:45.003Z todo → wip (system)
- 2026-09-07T00:55:44.000Z test stage (/sp-dev-unit 0096 --auto): 1 gap-fill test added (R2 assets-absent branch), suite 610 pass / 0 fail, lint clean; R4 YAML grep reported for 0097
- 2026-09-07T01:11:46.000Z verify stage (/sp-dev-verify 0096 --auto --fix all): review fix #1 applied — postPath must be absolute (resolvePostPath, src/index.ts:131-134) and resolve-contain inside surfdashRoot (new postPathOutsideRoot, src/index.ts:140-151; wired scaffoldLocale :234-235 / syncPost :285-286 before any existsSync/spawn) + behavioral test (tests/surfdash-pub.test.ts:497-539: relative + ..-escaping postPath fail loud, both ops, no spawn side effects); gates green: lint exit 0, bun run test 611 pass / 0 fail, narrow 24 pass / 0 fail with plugin 100% funcs / 100% lines; verdict PASS persisted (.spur/run/0096-verify-answer.txt, .spur/run/0096-verdict.json, Testing recorded); shippable: FAIL (feature L1 incomplete — 0094/0096/0097/0098 + unverified scenarios; recovery routed to those WBS)
- 2026-09-07T01:13:30.630Z wip → testing (system)
- 2026-09-07T01:20:34.837Z testing → done (system)
