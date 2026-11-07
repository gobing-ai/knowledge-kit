---
schema_version: 1
name: Annotate kk plugin entities with runtime requires
status: done
template: feature-impl
created_at: 2026-11-04T23:00:27.843Z
updated_at: "2026-11-07T05:19:50.183Z"
feature_id: F81

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 3
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0342-verdict.json
---

## 0342. Annotate kk plugin entities with runtime requires

### Background

Task 0342 delivers feature F81 scenario R1. kk skills and commands declare `requires:` per the superskill contract (superskill task 0162), so that `superskill install kk --targets grok-bot` ships only entries the Bot can run.

Contract (superskill 0162, frozen):
- Tokens are `hooks`, `subagents`, `local-fs` and `cli:<name>`, where name matches `^[a-z0-9][a-z0-9._-]*$`.
- The list is sorted and de-duplicated.
- Missing `requires` means an unknown requirement, which is excluded by default on grok-bot.

Spur's sibling task 1291 uses the same classification rules, so this repo mirrors them.

Inventory (verified 2026-11-04): `plugins/kk/skills/` has 14 skills, `plugins/kk/commands/` has 4 commands, and there are no agents. `plugins/kk/hooks/` holds only a README, so no hooks exist.

Each entity's derivation is (a) its direct CLI invocations, matched by `(^|[^a-z0-9_/.-])(kk|spur|superskill|gh) [a-z]`, plus (b) the closure over `Skill(skill="kk:<id>")` dispatch:

| requires | entities |
| --- | --- |
| `[cli:kk, cli:spur, local-fs]` (8) | article-adapt, content-judge, image-authoring, smart-seo, topic, commands/workflow-run, commands/image-extract and commands/image-generate (the last two via image-authoring) |
| `[cli:kk, local-fs]` (4) | itc-generating, publish, storm-research, xhs-images |
| `[cli:spur, local-fs]` (1) | web-automation |
| `[local-fs]` (5) | audio-authoring, content-safety, explain-things, taste-unslop, commands/tell-me (via explain-things) |

**Refine corrections (2026-11-04)**

- The feature's R1 says entities needing "local store or hooks" declare it. kk has no hooks, and "local store" (`kk.db`) is reached only through `kk store …`, so `cli:kk` covers it. There is no store token in the 0162 contract, and adding one is out of scope. Every entity gets `local-fs`, as in 1291.
- The regex over-declares on prose such as "kk package" (`storm-research/SKILL.md:134`). That never changes a result here because a real `kk executor` call is already present. Over-declaring only hides an entry on a Bot that lacks the CLI, so it fails safe.

### Requirements

- [x] R1. Add a `requires:` frontmatter list to all 18 kk entities (14 `plugins/kk/skills/*/SKILL.md`, 4 `plugins/kk/commands/*.md`), with exactly the values in the Background table. Do not change any other frontmatter key or the body.

- [x] R2. Add `plugins/kk/tests/runtime-requires.test.ts` (imports only `bun:*`/`node:*`; parse frontmatter with `Bun.YAML.parse`). It mirrors spur 1291's guard:
  - `TRACKED_CLIS = ['kk','spur','superskill','gh']`
  - `CLI_INVOCATION_RE`
  - `SKILL_DISPATCH_RE = /Skill\(skill="kk:([a-z0-9-]+)"/g`
  - `REQUIRES_TOKEN_RE = /^(hooks|subagents|local-fs|cli:[a-z0-9][a-z0-9._-]*)$/`
  - `deriveRequires(entity, all)` (direct plus transitive closure, always plus `local-fs`)
  - `checkRequires`

  For every entity, the declared list equals the derived list, is sorted and de-duplicated, and every token matches `REQUIRES_TOKEN_RE`. A failure names the entity and the missing or extra tokens.

- [x] R3. The test also asserts the group snapshot (8/4/1/5 by value) and that no entity declares `hooks` or `subagents`. New entities must update the snapshot deliberately.

- [x] R4. Add a "Grok Bot" subsection to `plugins/kk/README.md` with the install line `superskill install kk --targets grok-bot --bot-provides cli:kk --bot-provides local-fs`. Add `--bot-provides cli:spur` when the Bot ran the spur bootstrap. Point to ADR-044 (task 0341) for which kk work may run in the cloud.

- [x] R5. Gates: `bun run lint`, `bun run spur-check` and `bun test plugins/kk/tests/runtime-requires.test.ts` pass.

Out of scope:
- the superskill parser and filter (0162);
- a store or browser requirement token;
- changing skill bodies;
- cc or sp annotations (superskill 0163, spur 1291).

### Acceptance Criteria

```gherkin
Scenario: AC1 — Every kk entity declares the derived requires (req: R1, R2)
  Given the 14 skills and 4 commands under plugins/kk
  When runtime-requires.test.ts runs
  Then each declared list equals deriveRequires(direct CLI calls ∪ Skill dispatch closure ∪ local-fs), sorted and de-duplicated

Scenario: AC2 — Undeclared use fails with a named diff (req: R2)
  Given an entity body that gains a `spur workflow run` call without `cli:spur`
  When the guard runs
  Then it fails naming the entity and the missing `cli:spur` token

Scenario: AC3 — Snapshot and forbidden tokens hold (req: R3)
  Given the annotated tree
  When the guard runs
  Then the groups are 8/4/1/5 as frozen and no entity declares hooks or subagents

Scenario: AC4 — README documents the Bot install and gates pass (req: R4, R5)
  Given plugins/kk/README.md
  When it is read and the gates run
  Then the Grok Bot subsection carries the install line and ADR-044 pointer, and lint, spur-check and the guard test pass

Scenario: R1 — kk entities declare runtime requirements (R1)
  Given the annotated kk skills and commands with their derived `requires:` lists
  When `superskill install kk --targets grok-bot` runs
  Then it installs only entities the Grok Bot can actually run, skipping command-only or Mac-fs-only entries per the frozen `requires` groups
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-04T23:41:39.665Z

- **CLOSED — mirror spur 1291 rules.** Using the same regexes and closure keeps the two plugins' Bot catalogs consistent, and the superskill filter treats both identically.
- **CLOSED — `cli:kk` covers store access.** The store is reached only via `kk store …`. The 0162 contract has no store token.
- **CLOSED — test lives in `plugins/kk/tests/`.** This is where the existing plugin tests sit (e.g. `decision-catalog.test.ts`). ADR-018 restricts shipped scripts, not tests.
- **CLOSED — AC2 is proven by a unit case.** It runs `checkRequires` on an in-memory entity. Nothing is mutated on disk.

### Design

**WHAT.**
- Frontmatter additions on 18 files.
- One guard test.
- One README subsection.

**WHERE.**
- `plugins/kk/skills/*/SKILL.md`
- `plugins/kk/commands/*.md`
- `plugins/kk/tests/runtime-requires.test.ts` (new)
- `plugins/kk/README.md`

**Frozen names.** These match spur 1291 exactly:
- Exported constants: `TRACKED_CLIS`, `CLI_INVOCATION_RE`, `SKILL_DISPATCH_RE`, `REQUIRES_TOKEN_RE`.
- Helper functions: `deriveRequires`, `checkRequires`.

**Frontmatter form.**
- Use flow style, for example `requires: [cli:kk, cli:spur, local-fs]`.
- Place it after `description:`, or at the end if the file's key order differs.
- Bun 1.4.3 `Bun.YAML.parse` reads `cli:kk` unquoted as a string (verified in 1291).

**Derivation.**
- Entity id is the skill directory name, or `commands/<file>` for commands.
- Direct set: matches of `CLI_INVOCATION_RE` in the body.
- Closure: a fixed-point over `SKILL_DISPATCH_RE` targets. The kk graph has depth 1.
- Result: the direct set unioned with each dispatch target's result, plus `local-fs`, sorted.

**Invariants.**
- The declared list equals the derived list.
- The snapshot changes only deliberately.

**Anti-patterns.**
- Hand-curated lists without the guard.
- Importing `@gobing-ai/*` in the test.
- Editing skill bodies to dodge the regex.

**Handoff.** 0343's grok-bot render reads nothing from these annotations. They gate install-time filtering only.

### Plan

- [x] 1. Write the guard test with an in-memory AC2 case, and confirm it fails on the unannotated tree (R2, R3).
- [x] 2. Add `requires:` to the 18 files per the table (R1).
- [x] 3. Iterate to green (AC1–AC3).
- [x] 4. Add the README subsection (R4).
- [x] 5. Run `bun run lint` and `bun run spur-check`; check `git status --short` (R5).

### Solution

<!-- Solution change map (host driver, auto mode) -->

<!-- Change-map: where each requirement landed, with file:line refs. -->

- **R1** — `requires:` frontmatter added to all 18 kk entities (14 skills, 4 commands), flow style,end of the frontmatter block: group A `[cli:kk, cli:spur, local-fs]` ×8 (article-adapt, content-judge, image-authoring, smart-seo, topic, commands/image-extract, commands/image-generate, commands/workflow-run), group B `[cli:kk, local-fs]` ×4 (itc-generating, publish, storm-research, xhs-images), group C `[cli:spur, local-fs]` ×1 (web-automation), group D `[local-fs]` ×5 (audio-authoring, content-safety, explain-things, taste-unslop, commands/tell-me). No other frontmatter key or body changed.
R2 landed at `plugins/kk/tests/runtime-requires.test.ts:31-32` (regexes), `:96` (deriveRequires), `:130` (checkRequires) — `plugins/kk/tests/runtime-requires.test.ts:31-32` (`SKILL_DISPATCH_RE`, `REQUIRES_TOKEN_RE`; `TRACKED_CLIS`:26, `CLI_INVOCATION_RE`:29), `:96` (`deriveRequires`), `:130` (`checkRequires`) mirrors spur 1291; closure is memoized and cycle-safe over `Skill(skill="kk:<id>")` dispatches (the kk graph is depth-1: commands/image-extract, commands/image-generate, commands/tell-me).
- **R3** — same test asserts the frozen snapshot 8/4/1/5 by derived value and rejects any declared `hooks`/`subagents` token.
R4 — `plugins/kk/README.md:31-39`; the install line (`--bot-provides cli:kk --bot-provides local-fs`, plus `--bot-provides cli:spur` after bootstrap), the guard-test pointer, and the ADR-044 store-free/browser-free pointer.

Ordering: guard test written and confirmed RED on the unannotated tree (41 missing-annotation violations at 0342:170) before the annotations; then green.

- Referenced design/section documents: docs/tasks/0342_*.md Design.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | 18 entities carry `requires:` (`grep -rl '^requires:' plugins/kk/skills plugins/kk/commands` counts 18), e.g. `plugins/kk/skills/topic/SKILL.md:10` and `plugins/kk/commands/image-extract.md:6`; declared equals derived closure per the AC1 test at `plugins/kk/tests/runtime-requires.test.ts:171` |
| R2 | MET | `plugins/kk/tests/runtime-requires.test.ts:26-32` declares TRACKED_CLIS, CLI_INVOCATION_RE, SKILL_DISPATCH_RE, REQUIRES_TOKEN_RE; deriveRequires at `plugins/kk/tests/runtime-requires.test.ts:96`; checkRequires closure scope at `plugins/kk/tests/runtime-requires.test.ts:128-132`; named-diff failure asserted at `plugins/kk/tests/runtime-requires.test.ts:221-222` |
| R3 | MET | `plugins/kk/tests/runtime-requires.test.ts:179-196` asserts the 8/4/1/5 group snapshot and rejects declared hooks or subagents tokens |
| R4 | MET | `plugins/kk/README.md:31-39` Grok Bot subsection: install line with `--bot-provides cli:kk --bot-provides local-fs`, the `cli:spur` bootstrap addendum, and the ADR-044 pointer |
| R5 | MET | 2026-11-06: focused run including `plugins/kk/tests/runtime-requires.test.ts` 248 pass / 0 fail / 292 expects; `bun run lint` exit 0; `bun run build` exit 0 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Every kk entity declares the derived requires (req: R1, R2) | MET | test | AC1 test at `plugins/kk/tests/runtime-requires.test.ts:171` passes 2026-11-06 (20 pass / 0 fail with the schedule suite) |
| AC2 — Undeclared use fails with a named diff (req: R2) | MET | test | AC2 test at `plugins/kk/tests/runtime-requires.test.ts:199` builds in-memory fixtures (direct spur use plus inherited dispatch, fixture at `plugins/kk/tests/runtime-requires.test.ts:214-218`) and asserts `missing cli:spur` diffs at `plugins/kk/tests/runtime-requires.test.ts:221-222`; passes 2026-11-06 |
| AC3 — Snapshot and forbidden tokens hold (req: R3) | MET | test | AC3 test at `plugins/kk/tests/runtime-requires.test.ts:179-196` passes 2026-11-06 |
| AC4 — README documents the Bot install and gates pass (req: R4, R5) | MET | command | `plugins/kk/README.md:31-39` re-read this run; 2026-11-06 post-fix gate: `bun run lint` exit 0, `bun run build` exit 0, `bun run test` exit 0 (4666 pass / 0 fail / 3 pre-existing skips, 4669 tests across 240 files) |
| R1 — kk entities declare runtime requirements (R1) | MET | test | `bun test plugins/kk/tests/runtime-requires.test.ts` passes: every entity using the kk or spur CLI declares it, derived closure equals annotation across 18 entities (`plugins/kk/tests/runtime-requires.test.ts:171`); no hooks or subagents declared (`plugins/kk/tests/runtime-requires.test.ts:191-195`) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- Review of run d66d35df (host driver, review lane): full diff review + `spur task verdict 0342 --from-answer` (PASS, 5 requirements). -->

Confidence: HIGH

| Priority | Finding | Disposition |
| -------- | ------- | ----------- |
| P4 | TRACKED_CLIS is declarative while deriveRequires consumes CLI_INVOCATION_RE's alternation — a 0162 token-set change could drift the two; AC1's test asserts every TRACKED_CLIS name appears in the regex source as the sync check | accepted: documented in-test sync assertion; 0162 freezes the token set |

No open P1–P3 findings (.spur/run/0342-auto-repairs.json has no entries; gate passed attempts=1). Residual risk: the group snapshot locks install-time membership only; skill runtime behavior is unchanged. Feature scenario R1 (F81) covered by the annotations themselves.

Verdict: PASS

### References

- Feature: `docs/features/F81_grok-bot-cloud-routines-for-knowledge-kit.md` (R1)
- Contract: superskill task 0162 (`requires:` tokens, `--bot-provides`)
- Mirror: spur task 1291 (`plugins/sp/tests/runtime-requires.test.ts`)
- Related: 0341 (ADR-044), 0343

### History

- 2026-11-04T23:03:30.711Z feature_id Q → F81 (system)
- 2026-11-04T23:41:42.059Z backlog → todo (system)
- 2026-11-05T04:06:07.863Z todo → wip (system)
- 2026-11-05T04:10:06.011Z wip → testing (system)
- 2026-11-05T04:13:13.693Z testing → done (system)

