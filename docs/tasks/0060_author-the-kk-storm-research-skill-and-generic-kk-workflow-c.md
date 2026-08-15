---
template: feature-impl
schema_version: 1
name: "Author the kk-storm-research skill and generic kk-workflow command"
description: ""
status: done
type: task
profile: standard
feature_id: C4
parent_wbs: null
priority: P1
tags: []
dependencies: ["0056", "0059"]
ac_numbering: task-local
created_at: "2026-08-14T07:25:44.519Z"
updated_at: "2026-08-14T22:52:48.891Z"
---

## 0060. Author the kk-storm-research skill and generic kk-workflow command

### Background
wayfinder:task — C4 Daily-usable STORM research. Blocked on 0056 (install + works + topic-id) and 0059 (vars + states).

**Work.** Author fat skill `kk-storm-research` and generic slash command `/kk-workflow` under `plugins/kk` so daily research is not a raw `spur workflow run --vars`.

**Verified premises (re-checked 2026-08-14 this refine):**
- `plugins/kk/commands/` is empty. Skills: `kk-judge`, `kk-topic`. `kk-topic` excludes research.
- `plugins/kk/plugin.json` has no command list; `.claude-plugin/marketplace.json` points `source: ./plugins/kk`. New files are discovered by directory. `superskill install kk`.
- Slash commands: thin wrappers, frontmatter `description` / `argument-hint` / optional `allowed-tools`; wrap a skill; ~50–150 lines (superskill command conventions).
- ADR-011: no new `kk` CLI noun. This ticket is plugin files only.
- 0056 Design: invoker computes `topicId`, create-on-first-run config, copy YAML if dest missing, XOR args.
- 0059 Design: vars table; four states; `work_dir` is the resolved topic dir.

**Out of this ticket:** TypeScript config loader package; live Firecrawl; ContentSchema; a storm-only `/kk-storm-research` command; new Commander noun.
### Requirements
- [ ] R1. Add `plugins/kk/skills/kk-storm-research/SKILL.md` with: how to run (XOR topic/`--in`, `work_dir`, fixture vs live, `FIRECRAWL_API_KEY`); the 0056 topic-id algorithm; fail-loud when YAML or works cannot be resolved; **and** at least these four better-report practices: (a) prefer a specific question over a noun phrase; (b) do not treat `fixture: true` as research; (c) re-run ingest only when the query or sources must change, else reuse `docs.json`; (d) read `content.md` citations against `docs.json` ids. Do not merge into `kk-topic`.
- [ ] R2. Add `plugins/kk/commands/kk-workflow.md` wrapping that skill. Args: `[name] <topic|--in <file>> [--fixture] [--force]`. Default `name=kk-storm-research`. First-run: create config (0056), copy YAML (0056), compute `topicId`, `mkdir` works, `spur workflow run` against dest YAML with 0059 vars. No new `kk` first-layer noun.
- [ ] R3. `apps/cli/src/cli.ts` / `commands/` still register only `executor` and `plugin` after this ticket.
### Acceptance Criteria
```gherkin
Feature: kk-storm-research skill and generic kk-workflow command

  Scenario: R1 — Skill covers run and craft
    Given plugins/kk/skills/kk-storm-research/SKILL.md
    When an agent reads it
    Then it names invoke, topic-id, works layout, live vs fixture, FIRECRAWL_API_KEY, and the four better-report practices
    And it does not tell the agent to merge this into kk-topic

  Scenario: R2 — Generic command shells to spur
    Given plugins/kk/commands/kk-workflow.md
    When an operator invokes it with a topic and no name
    Then it runs kk-storm-research via spur workflow run using the 0056 dest YAML and resolved work_dir

  Scenario: R3 — CLI nouns unchanged
    Given apps/cli after this ticket
    When createProgram is inspected
    Then first-layer nouns remain executor and plugin only
```
### Q&A
- **Generic vs storm-only command?** Closed (C4 discovery): generic `/kk-workflow`, default name `kk-storm-research`.
- **Who computes topic-id?** Closed (refineall): this command/skill, per 0056 `topicId()`. Pass `work_dir` already resolved.
- **superskill install vs first-run copy?** Closed (0056): first-run is guaranteed. Document optional superskill copy; do not require a superskill change to ship.
- **Command frontmatter?** Closed: `description`, `argument-hint` (and `allowed-tools` if the platform file needs it). `argument-hint`: `[name] <topic|--in file> [--fixture] [--force]`.
- **Circular skill name in the command?** Closed: the command may wrap `kk-storm-research` by describing the run procedure inline (thin) and pointing at the skill as the craft SSOT. Keep the command under 150 lines.
- **Feature AC match?** Closed: C4 wayfinder-map; task-local AC.
### Design
**WHAT.** Two plugin files. No `apps/cli` noun.

**WHY.** Daily use fails if the only invoke is `spur workflow run --vars` from a checkout. Craft belongs in the skill.

**WHERE.**
- `plugins/kk/skills/kk-storm-research/SKILL.md`
- `plugins/kk/commands/kk-workflow.md`
- Do not edit `apps/cli/src/commands/*.ts`. `plugin.json` / marketplace need no extra list (directory discovery).

**Assumes from 0056:** `topicId`, XOR, create-on-first-run, copy-if-missing, env names, dest `$workflows_dir/<name>.yaml`.
**Assumes from 0059:** vars table and four states. If 0059 Solution amends a var name, follow 0059.
**Does not assume 0057 is done:** skill must document `fixture: true` for offline and `FIRECRAWL_API_KEY` for live.

**Frozen command behavior.**
1. Parse `$ARGUMENTS`: optional leading `name` (default `kk-storm-research`) if it matches `^[a-z0-9][a-z0-9-]*$` and is not `--in`; else name defaults and the token is the topic. `--in <file>`, `--fixture`, `--force` flags.
2. XOR: `--in` and a topic sentence cannot both be set.
3. Resolve config (`KK_CONFIG` or `~/.config/kk/config.yaml`); create with compiled defaults if missing.
4. Resolve dest YAML `$workflows_dir/<name>.yaml`; copy from 0056 search list if missing; `--force` overwrites dest from source.
5. `raw` = topic or file H1/basename; `id = topicId(raw)`; `work_dir = $works_dir/$id`; `mkdir -p`.
6. Run: `spur workflow run <destYaml> --vars '{"topic":"...","input_file":"...","maxResults":"...","fixture":"true|false","work_dir":"...","plugins_path":"...","render_script":"..."}'` (all strings). `plugins_path` default `./plugins` in a checkout; when no checkout, the skill says to pass the installed package `plugins/` path or `KK_PLUGIN_PATH`.
7. Print `work_dir`, `content.md`, `content.json`.

**Frozen skill sections.** Purpose; when to use / not (`kk-topic` is authoring); invoke contract (same args); works layout (0056); live vs fixture; fail-loud table (0056 rows the agent must execute); better-report (R1 a–d plus: cap `maxResults` before widening; prefer primary sources in the markdown input file).

**Anti-patterns:** do not merge into `kk-topic`; do not add `kk workflow` to Commander; do not restate 0054 HTTP; do not promise judge or query expansion; do not hash in the YAML.

**Leaves:** none on this map except C4 fog (judge, expansion, resume policy).
### Plan
1. Confirm 0056 and 0059 Solutions exist; if empty, implement against their Design frozen names and note that in Solution (R1/R2).
2. Author `plugins/kk/skills/kk-storm-research/SKILL.md` (R1).
3. Author `plugins/kk/commands/kk-workflow.md` (R2).
4. Grep `apps/cli/src/cli.ts` / `register*Command` to confirm no new noun (R3).
5. `spur task check 0060 --json`.
### Solution
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/kk-core/src/index.ts:36` |
| `plugins/ingestions/web-search/src/index.ts:269` |
| `plugins/ingestions/web-search/src/index.ts:43` |
| `plugins/ingestions/web-search/src/index.ts:49` |
| `plugins/ingestions/web-search/tests/web-search.test.ts:157` |
| `plugins/ingestions/web-search/tests/web-search.test.ts:162` |
| `plugins/ingestions/web-search/tests/web-search.test.ts:377` |
| `plugins/ingestions/web-search/tests/web-search.test.ts:381` |
| `plugins/ingestions/web-search/tests/web-search.test.ts:447` |
| `plugins/ingestions/web-search/tests/web-search.test.ts:6` |
| `plugins/ingestions/web-search/tests/web-search.test.ts:94` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/skills/kk-storm-research/SKILL.md` — names invoke contract (XOR topic/`--in`, `--fixture`, `--force`), 0056 `topicId()` algorithm verbatim (normalize → slug48 → sha256[0:8], empty→`topic`), 0056 works layout (6-file table incl. `local-doc.json`), live vs fixture (`FIRECRAWL_API_KEY` env-only), full fail-loud table (0056 rows each with recovery), and all four better-report practices (a question-over-noun, b fixture≠research, c reuse `docs.json`, d cite-vs-`docs.json` ids) plus cap-`maxResults` + primary-sources extras; explicitly "Do not merge this into `kk-topic`" |
| R2 | MET | `plugins/kk/commands/kk-workflow.md` (129 lines < 150) — thin wrapper with frozen steps 1–6: arg parse (default `name=kk-storm-research`, `^[a-z0-9][a-z0-9-]*$`, not `--in`) + XOR guard; create-on-first-run config (never overwrite); 0056 three-root copy rule (`KK_WORKFLOWS_SOURCE` → `plugins/kk/workflows` → `.spur/workflows`, `--force`, `cmp -s`); invoker-computed `topicId` → resolved `work_dir` + `mkdir -p`; `spur workflow run "$dest" --vars` with exact 7-var set (`topic`,`input_file`,`maxResults`,`fixture`,`work_dir`,`plugins_path`,`render_script`) all strings; reports `work_dir`/`content.md`/`content.json`. Guard: `apps/cli/tests/kk-workflow-command.test.ts` 7/7 pass, 39 expect |
| R3 | MET | `apps/cli/src/cli.ts:13-28` — `createProgram()` registers only `registerExecutorCommand` + `registerPluginCommand`; `apps/cli/src/commands/` holds only `executor.ts`/`plugin.ts`; `grep` for `.command(` shows no new first-layer noun |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R2 — Generic command shells to spur | MET | test | `apps/cli/tests/kk-workflow-command.test.ts` — 7/7 pass, 39 expect (`NODE_ENV=test bun test apps/cli/tests/kk-workflow-command.test.ts`); extracts+executes the real topicId shell block from `kk-workflow.md` §4, equals 0056 Node reference across 9 edge cases; string-invariant checks on XOR guard, config heredoc, 3-root copy rule, 7-var `--vars` set, ADR-011 guard |
| R3 — CLI nouns unchanged | MET | command | `apps/cli/src/cli.ts:20-21` registers only executor/plugin; `apps/cli/src/commands/` = `executor.ts`,`plugin.ts`; `kk executor --help` shows no new first-layer noun |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Finding | Disposition |
|----------|---------|-------------|
| P1 (blocker) | None — markdown-only plugin capability files; no production code changed | N/A |
| P2 (major) | None | N/A |
| P3 (minor) | None | N/A |
| P4 (nit) | `--vars` JSON embeds `$TOPIC` / `$INPUT_FILE` unescaped — a topic containing `"`, `\`, or `$` yields malformed JSON or stray shell expansion. Agent-executed markdown (LLM assembles the quote) so practical risk is low; a programmatic runner would break | Frozen 0060 step-6 shell, faithful to spec; optional `jq -n --arg` hardening if a non-agent runner ever consumes the command |
| P4 (nit) | Config heredoc writes the literal token `$HOME` into `config.yaml` (`works_dir: "$HOME/.config/kk/works"`). Matches 0056's compiled-default notation, so faithful; but a future TS config loader reading the file literally would misresolve the path | Loader is explicitly out of scope (0060); the deferred loader task must expand `$HOME` — record there, not here |
| P4 (nit) | A single hyphenated-token topic (`my-topic`) parses as a workflow-`name` per the frozen step-1 rule → XOR error with non-obvious recovery (`--in` or prefix `kk-storm-research`) | Frozen design decision, implemented faithfully; fails loud with the XOR message |

**Functional traceability.** R1 MET — `kk-storm-research/SKILL.md` names invoke contract (XOR topic/`--in`, `--fixture`, `--force`), the 0056 topicId algorithm verbatim (normalize → slug48 → sha256[0:8]), the 0056 works layout (6-file table incl. `local-doc.json` mapping), live-vs-fixture (`FIRECRAWL_API_KEY` env-only), and all four better-report practices (a question-over-noun, b fixture≠research, c reuse `docs.json`, d cite-vs-`docs.json` ids) plus cap-`maxResults` and primary-sources extras. It explicitly does not merge into `kk-topic`. R2 MET — `kk-workflow.md` is a thin wrapper (129 lines < 150) with the frozen run procedure steps 1–6: arg parse + XOR guard, create-on-first-run config (never overwrite), 0056 three-root copy rule with `--force`/`cmp -s`, invoker-computed `topicId` → resolved `work_dir` + `mkdir`, `spur workflow run "$dest" --vars` with the exact 0060 step-6 7-var set (`ingestion_plugin`/`generator_plugin` correctly left to YAML defaults, which the workflow declares), and report of `work_dir`/`content.md`/`content.json`. R3 MET — `apps/cli/src/cli.ts:13-28` `createProgram` registers only `executor` and `plugin`; `apps/cli/src/commands/` holds only `executor.ts`/`plugin.ts`.

**SECUA.** No secrets in config or vars (`FIRECRAWL_API_KEY` env-only in both files); fail-loud table in the skill covers all 0056 rows (unreadable config, invalid types, unreadable `--in`, XOR both/neither, empty derived topic-id, dest-different-bytes no-overwrite, source-missing) each with recovery; XOR guard precedes all writes. No S/E/C/U finding ≥ P3; two P4 notes above.

**Architecture.** ADR-011 honored (no new `kk` noun — command is shell + workflow). Clean seam: skill owns craft, command owns run procedure; directory discovery means no `plugin.json`/marketplace edit needed. topicId is computed by the invoker and passed as resolved `work_dir`; the workflow YAML never hashes (verified `.spur/workflows/kk-storm-research.yaml` prepare does mkdir + XOR + writes, no topic-id). No new package, no TS loader. No blockers or major candidates.

**Test quality.** `apps/cli/tests/kk-workflow-command.test.ts` is the strongest available guard for a markdown deliverable: it extracts and *executes* the real topicId shell block from `kk-workflow.md` and asserts 9/9 equality against a Node reference of the frozen 0056 algorithm, plus string-invariant checks over the frozen run procedure (XOR, config heredoc, 3-root copy rule, 7-var `--vars` set, ADR-011 guard). Re-verified here: 7 pass / 0 fail / 39 expect; biome clean; `spur task check 0060` PASS. No skipped tests.

**Residual risk:** Low. P4 items are frozen-design-faithful nits deferred to the future loader / runner work; functional behavior (actual workflow run) is intentionally verified in the verify stage via `spur workflow`.

**Disposition:** PASS — no blockers or majors; R1/R2/R3 MET; findings independently re-verified this review stage. No disposition change requested.
### References
- Feature [C4](../features/C4_daily-usable-storm-research.md)
- Assumes [0056](0056_specify-the-kk-config-works-workspace-and-workflow-install-c.md) and [0059](0059_prototype-the-daily-kk-storm-research-workflow.md)
- File shape: `plugins/kk/skills/kk-topic/SKILL.md`, `plugins/kk/skills/kk-judge/SKILL.md` — do not merge
- ADR-011 — no new kk first-layer noun
- Marketplace: `.claude-plugin/marketplace.json` (`source: ./plugins/kk`)
### History
- 2026-08-14T22:43:59.489Z todo → wip (system)
- 2026-08-14T22:52:48.462Z wip → testing (system)
- 2026-08-14T22:52:48.891Z testing → done (system)
