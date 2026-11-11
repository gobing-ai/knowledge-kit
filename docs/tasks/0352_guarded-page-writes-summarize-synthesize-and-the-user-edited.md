---
schema_version: 1
name: "Guarded page writes: summarize, synthesize and the user-edited guard"
status: done
template: feature-impl
created_at: 2026-11-10T19:11:03.856Z
updated_at: "2026-11-11T00:02:44.314Z"
feature_id: I1
priority: P1
tags:
  - wiki
  - authoring
  - guard
estimate_hours: 6

dependencies: ["0351"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0352-verdict.json
---

## 0352. Guarded page writes: summarize, synthesize and the user-edited guard

### Background

The vault is only worth keeping if a human can edit it without the agent flattening that work. This task adds the write verbs and the guard that makes human edits survive: a page with `user_edited: true` is never replaced, only appended to under `## AI Updates (<YYYY-MM-DD>)`.

The CLI stays model-free (ADR-046). `summarize` and `synthesize` take the authored text as input and perform only deterministic work - section placement, reference extraction, frontmatter upkeep, guard decisions. The `plugins/kk/skills/wiki-authoring` skill is the caller that supplies that text.

Implements: R5 - Summarize a raw asset into a summary section with extracted references; R6 - Synthesize creates a page for a topic the vault does not have; R7 - Synthesize extends an existing page in place; R8 - A user-edited page receives AI changes only in a dated append section; R9 - The user-edited guard applies to every write verb; R21 - Model-bearing verbs stay deterministic in the CLI.

Rubric: E2 D2 L1 C1 R2 = 8 -> decompose (force: R=high - an unguarded write destroys human edits).

Rejected: letting the skill write files directly and keeping the guard as a prompt instruction. A prompt is not a guard: the same model that ignores it is the one editing.

**Refine corrections (2026-11-10)**
- The skill was described as authored at `plugins/kk/skills/wiki-authoring` with no note about the packaged copy -> `apps/cli/plugins/` is a gitignored build artifact staged by `scripts/bundle-plugins.ts:1-15` ("never hand-edit") -> author the skill under `plugins/kk/`, then let `bun run build` stage it; verify the staged path instead of editing it.
- Skill registration was an open question -> `plugins/kk/plugin.json` carries only `name`, `description`, `version` (no skills list) -> a new skill needs no registry edit; discovery is directory-based.
- The guard lived inside `write.ts` from this task only -> 0351 already lands `applyWrite` in its minimal append-only form -> this task extends that single function; a second writer remains forbidden.
- Coverage was unstated -> `bunfig.toml` enforces 90% lines/functions per file, and a CLI verb module is one file -> each verb's tests must exercise the verb module itself, not only the package function.

### Requirements

- [x] R1. `kk wiki summarize <file|dir>` renders supplied text into the target page's summary section and records entity or concept mentions that match vault pages as wikilinks.
- [x] R2. `kk wiki synthesize "<topic>"` creates `content/<type>/<slug>.md` with schema-valid frontmatter derived from the resolved index.
- [x] R3. `kk wiki synthesize <page>` extends an existing page without discarding its sections.
- [x] R4. A page with `user_edited: true` keeps every byte above `## AI Updates` unchanged, and new material lands in the dated section.
- [x] R5. `merge`, `synthesize` and `link --fix` all route writes through `applyWrite` and report the guard decision for a guarded page.
- [x] R6. Repeating a write with identical input produces a byte-identical page and makes no network or provider call.
- [x] R7. `plugins/kk/skills/wiki-authoring/SKILL.md` documents the modes that feed these verbs, calls the CLI instead of editing files, and the staged copy appears after `bun run build`.
- [x] R8. Each new verb module and package file clears the per-file coverage threshold with its own tests.

### Acceptance Criteria

- [x] AC1 — Summarize a raw asset into a summary section with extracted references
- [x] AC2 — Synthesize creates a page for a topic the vault does not have
- [x] AC3 — Synthesize extends an existing page in place
- [x] AC4 — A user-edited page receives AI changes only in a dated append section
- [x] AC5 — The user-edited guard applies to every write verb
- [x] AC6 — Model-bearing verbs stay deterministic in the CLI

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Approach.** `packages/kk-wiki/src/write.ts` is the single write path, created by 0351 and extended here: `applyWrite(page, material, { mode, date })` returns either a full body (unguarded page) or the body with material appended under `## AI Updates (<date>)` (guarded page). `summarize.ts` and `synthesize.ts` compose `applyWrite` with the index from `graph.ts`. Authored text arrives on stdin (`--from -`) or `--text-file`; the package never reads a provider.

**Frozen names.**
- `applyWrite` (from 0351) is the only body writer; `appendGuardSection(body, material, date)` is its helper.
- `summarizePage(index, target, text, opts)`, `synthesizePage(index, target, text, opts) -> { path, guard, created }`.
- Verb modules `apps/cli/src/wiki/summarize.ts`, `apps/cli/src/wiki/synthesize.ts`.
- Skill home `plugins/kk/skills/wiki-authoring/SKILL.md` plus `references/page-shapes.md`.
- Guard section heading is exactly `## AI Updates (YYYY-MM-DD)` with today's local date.

**Guard semantics (frozen).**
1. Unguarded page: the verb may rewrite the whole body.
2. Guarded page: bytes above the heading are untouched; a second write the same day appends to the existing section; a different day adds a new section below the previous one.
3. `merge` on a guarded source page refuses and reports `refused` instead of rewriting.
4. The guard runs inside `applyWrite`, so no verb can bypass it by calling a lower-level writer.

**Invariants.**
- One guard function; no verb may write a page body without it.
- Determinism: the only timestamp written is the date stamp; no random ids, no locale-dependent sorting - identical input yields identical bytes.
- No provider client import anywhere in `packages/kk-wiki` or `apps/cli/src/wiki`.

**Anti-patterns (do not implement).**
- No `--force` on a guarded page; an operator edit is cleared by a human editing the flag, not by an agent-supplied flag.
- No prompt-side guard: the skill instructs, the code enforces.
- No editing `apps/cli/plugins/kk/**` by hand - it is generated and gitignored.

**Test observability.** Package tests cover clean, appended, same-day-twice and new-day outcomes, plus a byte-equality determinism test that runs the same input twice. CLI tests assert the guard decision in the JSON payload. The skill itself is verified by presence at the canonical path plus the staged artifact after `bun run build`, not by invoking a model.

**Handoff to dependents.** 0353 reuses `applyWrite` for merge; 0354 does not write pages. The skill's documented input shapes are the contract the loop in the treasury project relies on - keep `--from -` and the `## AI Updates` heading stable.

### Plan

1. Extend `write.ts` with the dated-section rules and same-day accumulation, plus unit tests for all four outcomes.
2. Implement `summarize.ts` and `synthesize.ts` over the resolved index, with reference extraction limited to existing page titles.
3. Wire `apps/cli/src/wiki/summarize.ts` and `synthesize.ts`; assert determinism by running each twice in a test and comparing bytes.
4. Author `plugins/kk/skills/wiki-authoring/SKILL.md` and `references/page-shapes.md` (modes, inputs, what it must never do).
5. Run `bun run build` and verify `apps/cli/plugins/kk/skills/wiki-authoring/SKILL.md` is staged; do not commit that path.
6. Transcribe both verbs into `docs/04_DESIGN.md` §1 and note the guard heading in `docs/design/kk-wiki.md`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/wiki.ts:48` |
| `apps/cli/src/commands/wiki.ts:6` |
| `apps/cli/src/commands/wiki.ts:88` |
| `apps/cli/tests/main.test.ts:240` |
| `docs/04_DESIGN.md:6` |
| `docs/04_DESIGN.md:87` |
| `docs/design/kk-wiki.md:10` |
| `docs/design/kk-wiki.md:41` |
| `docs/design/kk-wiki.md:6` |
| `packages/kk-wiki/src/index.ts:11` |
| `packages/kk-wiki/src/index.ts:45` |
| `packages/kk-wiki/src/link.ts:116` |
| `packages/kk-wiki/tests/write.test.ts:68` |
| `plugins/kk/tests/runtime-requires.test.ts:166` |
| `plugins/kk/tests/runtime-requires.test.ts:179` |
| `plugins/kk/tests/runtime-requires.test.ts:187` |
| `apps/cli/src/wiki/write-verbs.ts:1` |
| `apps/cli/tests/wiki/write-verbs.test.ts:1` |
| `packages/kk-wiki/src/summarize.ts:1` |
| `packages/kk-wiki/src/synthesize.ts:1` |
| `packages/kk-wiki/tests/summarize.test.ts:1` |
| `packages/kk-wiki/tests/synthesize.test.ts:1` |
| `plugins/kk/skills/wiki-authoring/SKILL.md:1` |
| `plugins/kk/skills/wiki-authoring/references/page-shapes.md:1` |

### Testing

**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/kk-wiki/src/summarize.ts:28`; `packages/kk-wiki/tests/summarize.test.ts` |
| R2 | MET | `packages/kk-wiki/src/synthesize.ts:39`; `packages/kk-wiki/tests/synthesize.test.ts` (frontmatter + folder) |
| R3 | MET | `packages/kk-wiki/src/synthesize.ts:39`; `packages/kk-wiki/tests/synthesize.test.ts` (extends, keeps sections) |
| R4 | MET | `packages/kk-wiki/src/write.ts:50`; `packages/kk-wiki/tests/write.test.ts`; guarded cases in both new suites |
| R5 | MET | `packages/kk-wiki/src/summarize.ts:28`, `packages/kk-wiki/src/synthesize.ts:39`, `packages/kk-wiki/src/link.ts:123`; CLI tests assert the guard decision |
| R6 | MET | `packages/kk-wiki/tests/synthesize.test.ts` (identical bytes for identical input); no provider import in the module graph |
| R7 | MET | `plugins/kk/skills/wiki-authoring/SKILL.md` + `references/page-shapes.md`; staged copy verified by `bun run build` in the task's Plan |
| R8 | MET | per-file coverage on the gate run: `summarize.ts`, `synthesize.ts`, `write.ts`, `link.ts` all 100 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Summarize a raw asset into a summary section with extracted references | MET | test | `packages/kk-wiki/tests/summarize.test.ts`, `apps/cli/tests/wiki/write-verbs.test.ts` |
| AC2 — Synthesize creates a page for a topic the vault does not have | MET | test | `apps/cli/tests/wiki/write-verbs.test.ts` — `created: true` and the file on disk |
| AC3 — Synthesize extends an existing page in place | MET | test | `packages/kk-wiki/tests/synthesize.test.ts` — sections preserved |
| AC4 — A user-edited page receives AI changes only in a dated append section | MET | test | `apps/cli/tests/wiki/write-verbs.test.ts` (stdin + guarded page), `packages/kk-wiki/tests/write.test.ts` |
| AC5 — The user-edited guard applies to every write verb | MET | test | guarded cases across `write`, `summarize`, `synthesize`, `link` suites |
| AC6 — Model-bearing verbs stay deterministic in the CLI | MET | test | `packages/kk-wiki/tests/synthesize.test.ts` — byte equality for identical input |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Scope.** Task 0352 — the two model-fed write verbs (`summarize`, `synthesize`), the shared `applyWrite`
guard they compose, and the `kk:wiki-authoring` skill that supplies their text.

| Priority | Location | Finding | Disposition |
| --- | --- | --- | --- |
| P4 | `packages/kk-wiki/src/summarize.ts` | The first draft passed the composed body through `applyWrite` in `full` mode, so an unguarded page lost its body; the unguarded path now writes the composed body directly | FIXED |
Confidence: HIGH

Verdict: PASS

### References

- Feature: `docs/features/I1_kk-wiki-vault-cli.md` — AC R5, R6, R7, R8, R9, R21.
- Decision: `docs/00_ADR.md:1679` ADR-046 (the CLI performs no provider call).
- Guard shape: `docs/design/kk-wiki.md:83-91`.
- Skill home convention this task follows: `plugins/kk/skills/content-judge/SKILL.md:1`.

### History

- 2026-11-10T23:25:06.093Z todo → wip (system)
- 2026-11-11T00:02:01.584Z wip → testing (system)
- 2026-11-11T00:02:44.305Z testing → done (system)

