---
schema_version: 1
name: Annotate kk plugin entities with runtime requires
status: todo
template: feature-impl
created_at: 2026-11-04T23:00:27.843Z
updated_at: "2026-11-04T23:41:42.059Z"
feature_id: F81

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 3
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

- [ ] R1. Add a `requires:` frontmatter list to all 18 kk entities (14 `plugins/kk/skills/*/SKILL.md`, 4 `plugins/kk/commands/*.md`), with exactly the values in the Background table. Do not change any other frontmatter key or the body.

- [ ] R2. Add `plugins/kk/tests/runtime-requires.test.ts` (imports only `bun:*`/`node:*`; parse frontmatter with `Bun.YAML.parse`). It mirrors spur 1291's guard:
  - `TRACKED_CLIS = ['kk','spur','superskill','gh']`
  - `CLI_INVOCATION_RE`
  - `SKILL_DISPATCH_RE = /Skill\(skill="kk:([a-z0-9-]+)"/g`
  - `REQUIRES_TOKEN_RE = /^(hooks|subagents|local-fs|cli:[a-z0-9][a-z0-9._-]*)$/`
  - `deriveRequires(entity, all)` (direct plus transitive closure, always plus `local-fs`)
  - `checkRequires`

  For every entity, the declared list equals the derived list, is sorted and de-duplicated, and every token matches `REQUIRES_TOKEN_RE`. A failure names the entity and the missing or extra tokens.

- [ ] R3. The test also asserts the group snapshot (8/4/1/5 by value) and that no entity declares `hooks` or `subagents`. New entities must update the snapshot deliberately.

- [ ] R4. Add a "Grok Bot" subsection to `plugins/kk/README.md` with the install line `superskill install kk --targets grok-bot --bot-provides cli:kk --bot-provides local-fs`. Add `--bot-provides cli:spur` when the Bot ran the spur bootstrap. Point to ADR-044 (task 0341) for which kk work may run in the cloud.

- [ ] R5. Gates: `bun run lint`, `bun run spur-check` and `bun test plugins/kk/tests/runtime-requires.test.ts` pass.

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

- [ ] 1. Write the guard test with an in-memory AC2 case, and confirm it fails on the unannotated tree (R2, R3).
- [ ] 2. Add `requires:` to the 18 files per the table (R1).
- [ ] 3. Iterate to green (AC1–AC3).
- [ ] 4. Add the README subsection (R4).
- [ ] 5. Run `bun run lint` and `bun run spur-check`; check `git status --short` (R5).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: `docs/features/F81_grok-bot-cloud-routines-for-knowledge-kit.md` (R1)
- Contract: superskill task 0162 (`requires:` tokens, `--bot-provides`)
- Mirror: spur task 1291 (`plugins/sp/tests/runtime-requires.test.ts`)
- Related: 0341 (ADR-044), 0343

### History

- 2026-11-04T23:03:30.711Z feature_id Q → F81 (system)
- 2026-11-04T23:41:42.059Z backlog → todo (system)

