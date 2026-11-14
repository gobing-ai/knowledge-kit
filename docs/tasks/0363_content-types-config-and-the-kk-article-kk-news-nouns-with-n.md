---
schema_version: 1
name: content_types config and the kk article / kk news nouns with new and status
status: done
template: feature-impl
created_at: 2026-11-13T18:13:39.059Z
updated_at: "2026-11-14T07:17:09.780Z"
feature_id: G61

ac_altitude: task-local
ac_numbering: task-local
priority: P1
dependencies: ["0361"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0363-verdict.json
---

## 0363. content_types config and the kk article / kk news nouns with new and status

### Background

Phase 2 of G61 (ADR-053 §2, §4). The frozen contract is `docs/design/content-pipeline-consolidation.md` §1.1, §1.4, §2 and §4.3 — implement it as written; a disagreement with the design is reported to the operator, not resolved in code. Today there is no `article` or `news` command (`apps/cli/src/commands/` has `daily.ts` and `itc.ts` only), no `content_types` config key, and run directories are computed in four places (`scripts/daily-ai-news.ts`, `plugins/kk/scripts/daily-scheduled-run.ts`, `apps/cli/src/itc-config.ts`, `scripts/publish-article.ts`). This task adds the two nouns with the two verbs that launch nothing — `new` and `status` — plus the config and run resolution every later task builds on.

Out of scope: `generate`, `publish`, every hyphenated step verb, any workflow YAML, any change to `kk daily` / `kk itc` behaviour.

**Refine corrections (2026-11-14)**

The CLI registrations now live in `apps/cli/src/cli.ts`, extracted by 0361; the two registration calls stay in that single owner. Integrated verification includes the five publish steps introduced by 0364, so AC3 checks that new/status are present rather than freezing the pre-0364 leaf count. `itc-prepare` owns workspace preparation; source Markdown is copied and represented as Content afterward because that stage does not implement a source-file import.

### Requirements

- [x] R1. New `apps/cli/src/content-types.ts` exports `ContentTypeSchema`, `ContentTypesSchema` (exactly the zod in design §2), `BUILTIN_CONTENT_TYPES` (`news`, `itc` with the values in design §2: four fields `workflow`, `writer_skill`, `publish_preset`, `channels`; built-in `channels` is `{}`; there is no `works_namespace` field) and `resolveContentType(type, config, flags)` implementing the order flag → `content_types.<type>` → `workflows.<workflow>.publish_preset` → built-in, merging a user entry over the built-in entry field by field (`channels` merged key by key). This task only parses and exposes `channels`; applying it to a plan is 0364.
- [x] R2. Unknown type → `ContentTypeUnknownError`; the CLI exits 2 with `unknown content type '<t>' (known: itc, news); add content_types.<t> to <config path>` (known list sorted, built-in ∪ user).
- [x] R3. `resolveRun({type, slug?, runDate?, workDir?, worksDir, now})` in the same file returns `{workDir, run, workflow}` per design §4.3 (`<works>/<workflow>/<run>` — the directory parent is the resolved workflow name, nothing else): `--work-dir` wins; news run = `--run-date` digits, default today in `America/Los_Angeles`; article run = `--slug` (required, exit 2 when absent), prefixed `<YYYYMMDD>-` when `workflows.<workflow>.workspace.dated` is true.
- [x] R4. New `apps/cli/src/commands/content.ts` exports `registerContentVerbs(program, noun, defaultType)`; `apps/cli/src/index.ts` calls it twice (`article`/`itc`, `news`/`news`). `kk news` does not accept `--type` (Commander unknown-option, exit 2). Later tasks add verbs by extending this one function — no second registration site.
- [x] R5. `new`: flags, stdout and files exactly as design §1.1. Idempotent: an existing `request.json` is left untouched and stdout carries `created: false`. `--from <file.md>` copies the file to `content/<locale>/article.md` and writes `4-publish/content.json` by calling the existing seeding code path used by `itc-prepare` (`apps/cli/src/itc-stage.ts:runItcStage`) — no second implementation; `scripts/publish-article.ts` is not edited.
- [x] R6. `status`: read-only; stdout exactly the object in design §1.1; exit 1 when the run directory does not exist; missing receipt/bundle/outcome files yield `null` members, not errors.
- [x] R7. Every verb prints exactly one JSON object on stdout; diagnostics on stderr via the project `logger`.
- [x] R8. `docs/04_DESIGN.md` §1.14: `new` and `status` and the `content_types` key move from "Planned" to a "Shipped (0363)" list inside the same section; §2 gains the `content_types` row. Same commit as the code.
- [x] R9. `resolveContentType` also returns `skillDir`: `writer_skill` `<plugin>:<skill>` resolved to the absolute `<package root>/plugins/<plugin>/skills/<skill>` of the running kk package (same root the stage runner in `apps/cli/src/stage.ts` resolves — reuse its resolver, no second one), and `skillSha256` over `SKILL.md` plus every file under `references/` in sorted path order. A directory without `SKILL.md` throws `ContentTypeSkillMissingError` naming the path (design §2.2).

### Acceptance Criteria

```gherkin
Scenario: AC1 — A content type resolves through config with a stated order (req: R1, R2, R3, R9)
  Given a config with content_types.itc.publish_preset set to "technical-article" and no content_types.news
  When resolveContentType runs for itc, for news, for itc with flag preset "chinese-article", and for "foo"
  Then the presets are technical-article, daily-ai-voice, chinese-article, and the fourth throws ContentTypeUnknownError naming itc and news
  And resolveRun returns <works>/kk-news-generate/<YYYYMMDD> for news and <works>/kk-article-generate/<slug> for itc
  And the news result carries skillDir ending plugins/kk/skills/news-editorial with a 64-hex skillSha256, and a writer_skill of kk:no-such-skill throws ContentTypeSkillMissingError naming the path
  And content_types.news.channels {"xhs-pub": "off"} parses, {"xhs-pub": "maybe"} is rejected, and an unknown field such as works_namespace is rejected

Scenario: AC2 — Both nouns expose the same new and status verbs (req: R4, R5, R6, R7)
  Given a temp works dir under .works/tmp/test-content-nouns
  When `kk article new --type itc --slug demo --from <fixture.md>` runs twice and then `kk article status --slug demo` and `kk news status --run-date 20260101` run
  Then the first new prints created true, the second created false with request.json byte-identical
  And article status exits 0 with generate null and bundle null, news status exits 1
  And `kk news new --type itc` and `kk article status --type foo` exit 2
  And the test writes .works/tmp/test-content-nouns/summary.json listing each command, exit code and stdout

Scenario: AC3 — The surface doc matches the binary (req: R8)
  Given the change is applied
  When `bun run lint && bun run test && bun run build` run
  Then all exit 0 and `kk article --help` includes new and status (plus the publish-step verbs supplied by 0364 in an integrated batch)
```

### Q&A

- **Why does `new` reuse the `itc-prepare` path instead of the logic in `scripts/publish-article.ts`?** The script is retired in 0369; the stage body is the one that survives. If the two disagree on a field, the stage wins and the difference is noted in Solution.
- **Where do runs live?** `<works>/<workflow>/<run>`, so news is `<works>/kk-news-generate/<YYYYMMDD>` (operator decision 2026-11-13, design §4.3). The old `kk-daily-ai-voice2` tree is not read, moved or aliased by this task; an old run is reachable only through `--work-dir`.
- **Who uses `channels`?** 0364 (`publish-plan`). Here it is schema, defaults and merge only; validating keys against a preset needs the preset and belongs to 0364.
- **Does this task touch `apps/cli/src/itc-config.ts`?** Read-only use of its loader for `workflows.<name>`. The `content_types` block is parsed in `content-types.ts`.
- **Tests first.** Write the AC1 unit file and the AC2 e2e file before the implementation; both must fail on the untouched tree.

### Design

Owned files (nobody else edits them while this task is open):

| File | Change |
| --- | --- |
| `apps/cli/src/content-types.ts` | new |
| `apps/cli/src/commands/content.ts` | new — `registerContentVerbs`, `new`, `status` |
| `apps/cli/src/index.ts` | two registration lines |
| `apps/cli/tests/content-types.test.ts`, `apps/cli/tests/content-nouns.e2e.test.ts` | new |
| `docs/04_DESIGN.md` §1.14, §2 | R8 |

`registerContentVerbs` builds one Commander sub-program per noun from a single verb list; a verb entry is `{name, nouns: 'both' | 'news' | 'article', configure(cmd), run(opts, ctx)}` where `ctx` carries the resolved type. That list is the only extension point for 0364, 0365, 0367 and 0368.

### Plan

1. [x] Write `content-types.test.ts` (AC1) and `content-nouns.e2e.test.ts` (AC2); confirm both fail.
2. [x] Implement `content-types.ts` (R1–R3).
3. [x] Implement `commands/content.ts` and the two lines in `index.ts` (R4–R7).
4. [x] Update `docs/04_DESIGN.md` (R8).
5. [ ] `bun run lint && bun run test && bun run build`; paste outputs and the summary.json path into Testing. (Host pipeline owns the full gate.)

### Solution

Implemented 0363's frozen content-type and noun surface.

- `apps/cli/src/content-types.ts:10-210` adds the strict Zod schemas, `news`/`itc` built-ins, field-by-field precedence and channel merging, writer-skill path/digest verification, unknown/missing-skill errors, and canonical LA-date/slug workspace resolution.
- `apps/cli/src/commands/content.ts:1-414` adds the shared `registerContentVerbs()` implementation for `article` and `news`. `new` validates usage, seeds ITC preparation through `runItcStage`, copies Markdown/content metadata, writes the request once, removes its temporary stage request, and reports `created`; `status` is read-only, supports `--window`, and summarizes receipts, bundles, and outcome windows with null-safe reads.
- `apps/cli/src/cli.ts:4,32-33` registers both nouns from one extension point.
- `apps/cli/src/main.ts:61-66` maps Commander usage errors on these nouns to exit 2.
- `apps/cli/tests/content-types.test.ts:1-79` covers precedence, channels, strict field/mode validation, canonical workspaces, digest shape, and missing skills. `apps/cli/tests/content-nouns.e2e.test.ts:1-208` covers idempotent article seeding, news/status artifacts including `--window`, usage failures, and writes the AC2 summary artifact under the isolated works root.
- `docs/04_DESIGN.md:1409-1460` promotes the `article`/`news` `new`/`status` and `content_types` surfaces to Shipped (0363) and adds the configuration row.

The existing `itc-prepare` path is used for article request preparation; the new command owns only the Markdown/content materialization required by the frozen `new --from` contract because the current prepare stage writes its options snapshot, not publish content.

Review corrections (2026-11-14): CLI registration uses the post-0361 owner `apps/cli/src/cli.ts:33`, with usage-exit handling in `apps/cli/src/main.ts`. The resolver validates scalar/malformed channel overrides instead of discarding them (`apps/cli/src/content-types.ts:100`); a failing-then-passing regression check pins that trust boundary. Shared filesystem I/O uses the existing async seam. Public exported types carry required documentation. Integrated command inventory checks include 0364's publish steps without weakening their exact-list assertions.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | apps/cli/src/content-types.ts:10 |
| R2 | MET | apps/cli/src/content-types.ts:65 |
| R3 | MET | apps/cli/src/content-types.ts:202 |
| R4 | MET | apps/cli/src/cli.ts:33 |
| R5 | MET | apps/cli/src/commands/content.ts:225 |
| R6 | MET | apps/cli/src/commands/content.ts:323 |
| R7 | MET | apps/cli/src/commands/content.ts:290 |
| R8 | MET | docs/04_DESIGN.md:1409 |
| R9 | MET | apps/cli/src/content-types.ts:115 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A content type resolves through config with a stated order (req: R1, R2, R3, R9) | MET | test | apps/cli/tests/content-types.test.ts:14 — precedence, strict schema, skill fingerprint, paths and malformed channel refusal |
| AC2 — Both nouns expose the same new and status verbs (req: R4, R5, R6, R7) | MET | test | apps/cli/tests/content-nouns.e2e.test.ts:19 — idempotency, copied source, JSON output and usage codes; .spur/memory/runs/da3edc13-c57c-46cb-8493-82ad1b410167/artifacts/batch-0362-0364/content-summary.json:1 |
| AC3 — The surface doc matches the binary (req: R8) | MET | test | apps/cli/tests/main.test.ts:71 — exact visible inventory includes both nouns and all shipped steps; docs/04_DESIGN.md:1409 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS

Confidence: HIGH

Scope: integrated batch 0362–0364, retained commit 365011c8 plus the reviewed working tree.

#### Requirement Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | apps/cli/src/content-types.ts:10 |
| R2 | MET | apps/cli/src/content-types.ts:65 |
| R3 | MET | apps/cli/src/content-types.ts:202 |
| R4 | MET | apps/cli/src/cli.ts:33 |
| R5 | MET | apps/cli/src/commands/content.ts:225 |
| R6 | MET | apps/cli/src/commands/content.ts:323 |
| R7 | MET | apps/cli/src/commands/content.ts:290 |
| R8 | MET | docs/04_DESIGN.md:1409 |
| R9 | MET | apps/cli/src/content-types.ts:115 |

#### Acceptance Criteria Verification

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 — A content type resolves through config with a stated order (req: R1, R2, R3, R9) | MET | test | apps/cli/tests/content-types.test.ts:14 — precedence, strict schema, skill fingerprint, paths and malformed channel refusal |
| AC2 — Both nouns expose the same new and status verbs (req: R4, R5, R6, R7) | MET | test | apps/cli/tests/content-nouns.e2e.test.ts:19 — idempotency, copied source, JSON output and usage codes; .spur/memory/runs/da3edc13-c57c-46cb-8493-82ad1b410167/artifacts/batch-0362-0364/content-summary.json:1 |
| AC3 — The surface doc matches the binary (req: R8) | MET | test | apps/cli/tests/main.test.ts:71 — exact visible inventory includes both nouns and all shipped steps; docs/04_DESIGN.md:1409 |

#### SECUA and Architecture Review

No open P1–P4 findings. New command composition reuses the matrix, stage, filesystem and ledger boundaries. Usage errors are checked before writes; typed schemas validate config and payloads. Dummy acceptance never dispatches a live publish. Optional episode typing is sound, malformed channel overrides are refused, legacy bundle serialization is preserved, and dummy rehearsal keeps disabled channels excluded. Existing behavioral assertions remain, with exact inventories expanded for the public commands. Scope remains within the accepted content pipeline design; workflow migration is deferred to the later G61 tasks.

#### Verification

Final integrated gate PASS at git tree 45fa9f14fb47a2ec0ea61183eed3505cc8476316: lint, 5178 tests passed / 0 failed, coverage thresholds, build, 58 pre-check and 2 post-check rules. Evidence: .spur/memory/runs/da3edc13-c57c-46cb-8493-82ad1b410167/artifacts/batch-0362-0364/integrated-gate.log:1 and integrated-check-receipt.json. Prior failed attempts remain historical, not passing evidence.

#### Findings

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P4 | verification | Integration review corrections are verified by the final gate and retained regression evidence. | apps/cli/tests/content-publish.e2e.test.ts:91 | RESOLVED |

### References

- Design: `docs/design/content-pipeline-consolidation.md` §1.1, §1.4, §2, §4.3. Decision: ADR-053 §2, §4; ADR-037 (hidden routes); ADR-042 (works layout).
- Depends on: 0361. Blocks: 0364, 0365.
- Parent feature: G61.

### History

- 2026-11-13T21:59:48.312Z backlog → todo (system)
- 2026-11-13T22:26:00.352Z todo → wip (system)
- 2026-11-14T06:58:43.425Z wip → testing (system)
- 2026-11-14T06:58:43.643Z testing → done (system)

