---
schema_version: 1
name: "Add the explain-things fat skill and tell-me slash wrapper"
status: done
template: feature-impl
created_at: 2026-08-26T22:43:41.602Z
updated_at: "2026-08-27T02:51:29.136Z"
feature_id: F9
priority: P2
tags: ["kk", "skill", "explain-things", "tell-me"]
---

## 0083. Add the explain-things fat skill and tell-me slash wrapper

### Background

Implements feature F9 scenarios R1–R7.

Feature F9 consolidates the vendor `eli5` and `show-me` prompts into one installable `plugins/kk`
capability. Robin selected the smallest-view approach on 2026-08-26: normal explanations are
TUI-first, the ELI5 register is opt-in, HTML is a last resort, `/tell-me` is the sole wrapper, and
the product CLI/runtime stays unchanged.

Current-tree evidence:

- `vendors/misc/eli5/SKILL.md` and `vendors/misc/show-me/SKILL.md` are provenance; neither is part of
  the `kk` plugin install.
- `.claude-plugin/marketplace.json` already registers `plugins/kk`, whose existing directory scan
  discovers `skills/<name>/SKILL.md` and `commands/<name>.md`; no manifest registry edit is needed.
- `superskill install kk --dry-run --verbose` resolves the repository plugin and reports that no
  install-target files are written; refreshing ignored `.rulesync/` staging is expected.
- `bun apps/cli/src/index.ts --help` currently exposes only `executor` and `plugin`, as required by
  ADR-011.
- `scripts/bundle-plugins.ts` copies root `plugins/` into ignored `apps/cli/plugins/` during package
  bundling. Root `plugins/kk` is the source of truth; the staged package copy is not an edit target.
- `plugins/kk/README.md` owns the capability roster. Because `/tell-me` adds a command surface,
  `docs/99_PROJECT_CONSTITUTION.md` T3 resolves the earlier documentation condition in favor of a
  same-change `docs/04_DESIGN.md` update.

The task has no task-level dependencies and changes one existing capability plugin plus its required
documentation projections.

### Requirements
- [x] R1. Add `plugins/kk/skills/explain-things/SKILL.md` with `name: explain-things` matching its
  parent directory and a trigger-rich description covering “explain”, “tell me”, “ELI5”, “show me”,
  and “how does X work”; explicitly exclude content authoring, research, judging, and publishing.
- [x] R2. Make the default procedure select one smallest useful inline view with brief supporting
  prose; enable the picture-first, few-words ELI5 register only for `--eli5` or an explicit natural-
  language request, and use a focused HTML artifact only when inline text, trees, code, diffs, and
  Mermaid cannot make the point.
- [x] R3. Add exactly one progressive-disclosure file at
  `plugins/kk/skills/explain-things/references/views.md`; map question shapes to pseudocode, call
  tree, component tree, file tree, Mermaid, diff, copyable block, or last-resort HTML without copying
  either vendor skill wholesale or nesting another reference level.
- [x] R4. Add `plugins/kk/commands/tell-me.md` with `name: tell-me`, argument hint
  `[topic] [--eli5]`, `allowed-tools: ["Skill"]`, and the sole delegation
  `Skill(skill="kk:explain-things", args="$ARGUMENTS")`; keep all explanation and view-selection
  logic in the skill.
- [x] R5. Produce `valid: true` from strict JSON validation of the new skill and command, and run
  `superskill install kk --dry-run --verbose`; the dry run must stage `kk-explain-things` and
  `kk-tell-me` while reporting that no install-target files were written.
- [x] R6. Resolve an empty topic from the active conversation; when neither arguments nor an active
  topic exists, stop before artifact creation with the recovery instruction “Provide a topic, for
  example `/tell-me <topic>`, or ask again while a topic is active.”
- [x] R7. Add the capability to `plugins/kk/README.md` and route the F9 scope/surface/status sync
  through `sp-doc-evolve`; add no `/eli5` or `/show-me` command, no explain-things subagent, no
  product plugin manifest, no workflow, and no first-layer `kk` noun.
### Acceptance Criteria

```gherkin
Feature: Explain-things skill and tell-me command

  @core
  Scenario: R1 — Fat skill exists at plugins/kk/skills/explain-things
    Given the repository kk marketplace plugin
    When the explain-things skill directory is listed
    Then SKILL.md exists with frontmatter name explain-things matching the parent directory
    And the skill description routes "explain", "tell me", "eli5", "show me", and "how does X work"

  @core
  Scenario: R2 — Procedure is smallest-view default with ELI5 on request
    Given the explain-things skill body
    When an agent follows the skill for a topic
    Then it skips the preamble and picks the smallest view that makes the point
    And the ELI5 register (picture-first, few words) runs only when the user asks like I'm 5 or passes --eli5
    And HTML artifacts are last-resort, not the default

  @core
  Scenario: R3 — View catalog is distilled one level deep
    Given the repository kk marketplace plugin
    When the explain-things skill is read
    Then SKILL.md points at references/views.md
    And that file exists exactly one level deep
    And the skill body does not vendor the full show-me SKILL.md

  @core
  Scenario: R4 — Thin /tell-me command wraps the skill
    Given plugins/kk/commands/tell-me.md
    When the command is invoked with a topic
    Then it delegates to the explain-things skill
    And it does not restate the view catalog

  @core
  Scenario: R5 — Superskill discovers skill and command without writing installs
    Given the repository kk marketplace plugin
    When Superskill validates the skill and command and performs an install dry-run
    Then explain-things is discovered as an installable skill
    And tell-me is discovered as an installable command
    And no target installation files are written by the dry-run

  @edge
  Scenario: R6 — Empty topic uses conversation or fails loud
    Given an explain-things or /tell-me invocation with no topic argument
    When there is a current conversation topic
    Then the skill uses that topic
    And when there is no current topic it stops with a recovery instruction and writes nothing

  @edge
  Scenario: R7 — No extra aliases, subagent, or kk CLI noun
    Given the repository after this feature lands
    When plugins/kk/commands, plugins/kk/agents, and the kk CLI surface are listed
    Then there is no /eli5 or /show-me command file
    And there is no explain-things subagent
    And no first-layer kk noun was added
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Shape and source files**

- Fat skill: `plugins/kk/skills/explain-things/SKILL.md`.
- One-level reference: `plugins/kk/skills/explain-things/references/views.md`.
- Thin source command: `plugins/kk/commands/tell-me.md`.
- Capability note: `plugins/kk/README.md`.
- Documentation projection: `docs/01_PRD.md`, `docs/04_DESIGN.md`, and `docs/05_FEATURES.md` through
  `sp-doc-evolve` at the corresponding scope/surface/status stage.

Use the existing Superskill authoring surface, then reduce the generated templates to the frozen
contract below:

```bash
superskill skill scaffold explain-things --output plugins/kk/skills --template technique
superskill command scaffold tell-me --output plugins/kk/commands --template simple
```

No new API or runtime seam is introduced. Superskill derives install IDs from the existing plugin:
the skill becomes `kk:explain-things`, and the command receives the normal `kk` plugin namespace on
each target. Source filenames intentionally omit a leading `kk-` per ADR-009.

**Skill procedure**

1. Parse a standalone `--eli5` modifier from `$ARGUMENTS`; the remaining text is the explicit topic.
2. If the explicit topic is empty, use the active conversation topic. If both are absent, emit the
   R6 recovery line and stop without creating an HTML file or any other artifact.
3. Select the ELI5 register when `--eli5` is present or the request explicitly says “ELI5” / “like
   I’m 5”; otherwise use the normal concise register. ELI5 changes vocabulary and presentation, not
   the available view catalog, and never forces HTML.
4. Read `references/views.md`, honor an explicitly requested format when feasible, otherwise choose
   one view from the mapping below. Add a second view only when it answers a distinct missing
   question.
5. Render the view beside only the prose needed to interpret it. For ELI5, lead with a familiar
   picture or analogy, use few words, and define unavoidable jargon.

| Question shape | Smallest default view |
| --- | --- |
| Decision logic or algorithm | Pseudocode |
| In-process call order | Call tree |
| Multiple actors, timing, or data flow | Mermaid sequence/flow diagram |
| UI composition, state, or ownership | Component tree |
| File/module responsibility | Shallow file tree |
| Change to an existing known shape | Focused `diff` block |
| Mostly new, copyable target | Complete code/config block |
| Dense spatial UI, layout, or comparison that the inline forms cannot express | One focused HTML artifact, then open/report its path |

`references/views.md` contains this decision catalog plus compact syntax examples and provenance
links to the two vendor files. It contains no nested references and no general rendering framework.

**Thin command contract**

The hand-edited command keeps only routing metadata, usage, and delegation. Its operative shape is:

```yaml
---
name: tell-me
description: Explain the supplied or current topic with the smallest useful view; use ELI5 only when requested.
argument-hint: "[topic] [--eli5]"
allowed-tools: ["Skill"]
---
```

```text
Skill(skill="kk:explain-things", args="$ARGUMENTS")
```

The wrapper forwards empty arguments unchanged so the skill owns conversation fallback. It does not
copy the view mapping, parse flags independently, or invoke a subagent.

**Discovery and packaging**

- Do not edit `plugins/kk/plugin.json` or `.claude-plugin/marketplace.json`; their existing directory
  discovery is sufficient.
- Do not edit ignored `apps/cli/plugins/`; `scripts/bundle-plugins.ts` regenerates it for package
  builds.
- A dry run may refresh ignored `.rulesync/` staging. Confirm
  `.rulesync/skills/kk-explain-things/SKILL.md` and `.rulesync/skills/kk-tell-me/SKILL.md` exist, while
  the Superskill summary still states that no install-target files were written.

**Documentation handoff**

- Add `explain-things` and `/tell-me` to the install-prefix/capability note in
  `plugins/kk/README.md`.
- Add F9 to the existing F scope row in `docs/01_PRD.md`.
- Append a compact `docs/04_DESIGN.md` agent-surface table containing the source paths, installed
  IDs, `[topic] [--eli5]` signature, and command-to-skill delegation. No satellite design file is
  warranted.
- Add/update the F9 row in `docs/05_FEATURES.md` using the real lifecycle state at doc-sync time.
- `docs/02_ROADMAP.md` needs no new placement because parent F is already Phase 2/3;
  `docs/03_ARCHITECTURE.md` and the category-level `AGENTS.md` layout remain accurate.

**Anti-patterns**

Do not paste either vendor skill, create aliases, add a persona agent, add a product `plugin.json`,
touch the `kk` Commander registration, build a reusable view renderer, or add a test harness for
static prompt files. Superskill validation, dry-run adaptation, content assertions, and the existing
project quality commands are the verification surface.

### Plan

1. **R1/R3 — scaffold the owned sources:** run the two frozen Superskill scaffold commands; trim the
   generic templates rather than retaining unused sections/tools, and create only `SKILL.md` plus
   `references/views.md` under the new skill directory.
2. **R1/R2/R3/R6 — author the fat skill:** write the trigger/negative-trigger description, topic and
   ELI5 parsing, exact empty-topic recovery, smallest-view procedure, HTML ceiling, and the pointer to
   the distilled view catalog.
3. **R4/R6 — author the wrapper:** reduce `tell-me.md` to the frozen frontmatter, concise usage, and
   `Skill(skill="kk:explain-things", args="$ARGUMENTS")`; keep all behavior in the skill.
4. **R7 — synchronize surfaces:** update `plugins/kk/README.md`, then invoke `sp-doc-evolve` for the
   frozen PRD/DESIGN/FEATURES projections; do not create a satellite design or edit generated package
   staging.
5. **R5/R7 — verify capability discovery:** run strict JSON skill and command validation, then
   `superskill install kk --dry-run --verbose`; assert both adapted `.rulesync/skills/kk-*` files,
   the no-install-target-write summary, absent alias/subagent files, and `kk --help` still showing
   only `executor` and `plugin`.
6. **Project checks:** run `bun run autofix`, `bun run spur-check`, and `bun run build`; inspect
   `git status --short` so only the source capability files and intentional documentation changes
   remain.

### Solution

**Change map**

| File | Change | Anchor |
| --- | --- | --- |
| `plugins/kk/skills/explain-things/SKILL.md` | NEW fat skill: trigger/negative-trigger description (`:2-9`), topic resolution + exact R6 recovery line (`:23,:26`), ELI5 opt-in gate (`:19,:31`), smallest-view default table (`§3`), one-level pointer to view catalog (`:37`), HTML last-resort ceiling (`:57`) |
| `plugins/kk/skills/explain-things/references/views.md` | NEW distilled catalog: 8-shape decision table (`:1-20`), syntax sketches for pseudocode/call tree/component tree/file tree/Mermaid/diff/copyable block/HTML (`:21-90`), provenance links to `vendors/misc/eli5` + `vendors/misc/show-me` (`:92-95`) — 95 lines vs vendor show-me 127, not wholesale |
| `plugins/kk/commands/tell-me.md` | REWRITTEN frozen wrapper: frontmatter name/description/`argument-hint "[topic] [--eli5]"`/`allowed-tools: ["Skill"]` (`:1-6`), empty-args forwarding note (`:11`), sole delegation `Skill(skill="kk:explain-things", args="$ARGUMENTS")` (`:15`) |

**Documentation projection (T3/T4 same commit)**

- `plugins/kk/README.md:27` roster lists `explain-things` (via `/tell-me`).
- `docs/01_PRD.md` agent-capabilities F row adds **F9 Explain-things** (`explain-things` smallest-view skill + thin `/tell-me`).
- `docs/04_DESIGN.md:448-456` new §7.3 surface table: source paths, installed IDs (`kk:explain-things`, `/tell-me`), signature `[topic] [--eli5]`, command→skill delegation.
- `docs/05_FEATURES.md` adds the F9 status row for feature F9 Explain-things skill and tell-me command.

**Rationale.** One fat skill carries all explanation behavior (views, register, fallback); the slash wrapper stays delegation-only so views never fork between entry points. Directory discovery makes manifest edits unnecessary (ADR-009); no CLI noun keeps product runtime untouched (ADR-011).

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — Fat skill exists at plugins/kk/skills/explain-things | MET | `plugins/kk/skills/explain-things/SKILL.md:2-9` — frontmatter `name: explain-things` matches parent dir; description routes explain, tell me, ELI5, show me, how does X work; excludes content authoring, research, judging, publishing |
| R2 — Procedure is smallest-view default with ELI5 on request | MET | `plugins/kk/skills/explain-things/SKILL.md:19` standalone `--eli5` parse; `plugins/kk/skills/explain-things/SKILL.md:30-33` ELI5 register only when `--eli5` or like I'm 5; `plugins/kk/skills/explain-things/SKILL.md:40-49` smallest default view table; `plugins/kk/skills/explain-things/SKILL.md:56-58` HTML when Mermaid cannot make the point |
| R3 — View catalog is distilled one level deep | MET | `plugins/kk/skills/explain-things/references/views.md:1-17` one-level catalog mapping question shapes to pseudocode, call tree, component tree, file tree, Mermaid, diff, copyable block, last-resort HTML |
| R4 — Thin /tell-me command wraps the skill | MET | `plugins/kk/commands/tell-me.md:1-6` name tell-me, argument-hint `[topic] [--eli5]`, allowed-tools Skill; `plugins/kk/commands/tell-me.md:14-16` sole Skill(skill="kk:explain-things", args="$ARGUMENTS") |
| R5 — Superskill discovers skill and command without writing installs | MET | command: `superskill skill validate plugins/kk/skills/explain-things --json` valid:true findings:[] exit 0; `superskill command validate plugins/kk/commands/tell-me.md --json` valid:true exit 0; `superskill install kk --dry-run --verbose` Skills: 7 Commands: 2 `[DRY-RUN] No files were written to install targets`; staged `.rulesync/skills/kk-explain-things` and `kk-tell-me` |
| R6 — Empty topic uses conversation or fails loud | MET | `plugins/kk/skills/explain-things/SKILL.md:22-26` current conversation topic fallback and exact recovery “Provide a topic, for example `/tell-me <topic>`, or ask again while a topic is active.”; wrapper empty-args `plugins/kk/commands/tell-me.md:10-12` |
| R7 — No extra aliases, subagent, or kk CLI noun | MET | command this run: `ls plugins/kk/commands/` = tell-me.md workflow-run.md; no eli5.md or show-me.md; no explain-things agent; `bun apps/cli/src/index.ts --help` lists only executor and plugin |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Fat skill exists at plugins/kk/skills/explain-things | MET | command | python name/dir MATCH True; rg counts explain≥1 tell me=1 ELI5≥1 show me=1 how does X work=1 this run |
| R2 — Procedure is smallest-view default with ELI5 on request | MET | command | `rg -n -- '--eli5'` → SKILL.md:19,31 exit 0; `rg -n 'cannot make the point'` → SKILL.md:57 exit 0 this run |
| R3 — View catalog is distilled one level deep | MET | command | `find plugins/kk/skills/explain-things` = SKILL.md + references/views.md; `rg -n 'references/views.md'` → SKILL.md:37 this run |
| R4 — Thin /tell-me command wraps the skill | MET | command | `rg -c 'Skill\(skill=' plugins/kk/commands/tell-me.md` = 1; catalog-term rg count 0 this run |
| R5 — Superskill discovers skill and command without writing installs | MET | command | both validates exit 0 valid:true; dry-run exit 0 no install-target writes + staged kk-explain-things/kk-tell-me this run |
| R6 — Empty topic uses conversation or fails loud | MET | command | recovery string contained True at SKILL.md:26; `rg -n 'current conversation topic'` → SKILL.md:23 this run |
| R7 — No extra aliases, subagent, or kk CLI noun | MET | command | ls commands = tell-me.md + workflow-run.md; no eli5.md/show-me.md; agents dir empty; kk --help executor+plugin this run |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

**Traceability (per scenario)**

| Req | Verdict | Evidence |
| --- | ------- | -------- |
| R1 | MET | `plugins/kk/skills/explain-things/SKILL.md:2` frontmatter `name: explain-things` matches parent dir; description routes all five triggers ("explain", "tell me", "ELI5", "show me", "how does X work") and excludes "content authoring, research, judging, publishing" (`plugins/kk/skills/explain-things/SKILL.md:3-9`) |
| R2 | MET | SKILL.md §2 gates ELI5 on `--eli5` or explicit request ("like I'm 5"); §3 table default = one smallest inline view; HTML restricted to when inline forms cannot make the point (`plugins/kk/skills/explain-things/SKILL.md:57`) |
| R3 | MET | Skill tree = SKILL.md + `references/views.md` exactly one level deep; body points at the catalog once (`plugins/kk/skills/explain-things/SKILL.md:37`); views.md is 95 distilled lines vs vendor show-me's 127 — decision table + syntax sketches + provenance links, not a wholesale copy |
| R4 | MET | `plugins/kk/commands/tell-me.md:1-6` frozen frontmatter (`argument-hint "[topic] [--eli5]"`, `allowed-tools: ["Skill"]`) with the sole operative line at `plugins/kk/commands/tell-me.md:15`; empty-args forwarding stated; no view catalog restated |
| R5 | MET | `superskill skill validate … --json` → `{"valid":true,"findings":[]}` ×2 exit 0; `superskill install kk --dry-run --verbose` reported Skills: 7, Commands: 2 and `[DRY-RUN] No files were written to install targets`; `.rulesync/skills/kk-explain-things/` and `kk-tell-me/` staged |
| R6 | MET | Exact recovery line present once (`plugins/kk/skills/explain-things/SKILL.md:26`); conversation fallback at `SKILL.md:23`; wrapper forwards empty `$ARGUMENTS` unchanged |
| R7 | MET | README roster line updated; `plugins/kk/commands/` holds only tell-me.md + workflow-run.md; `plugins/kk/agents/` has no explain-things entry; `bun apps/cli/src/index.ts --help` still shows only `executor` and `plugin` |

**SECUA:** Security — command surface is delegation-only (`allowed-tools: ["Skill"]`), no shell/subagent escalation, no secrets. Correctness — flag parsing and fallback live solely in the skill; wrapper adds no second parser. Usability — recovery line fails loud before any artifact write. Architecture — capability confined to `plugins/kk`, directory discovery untouched (no plugin.json/marketplace edits), no new runtime seam or CLI noun (ADR-009/ADR-011).

**Findings (P1–P4):**

| Priority | Location | Finding |
| --- | --- | --- |
| P1 | — | None found |
| P2 | — | None found |
| P3 | `plugins/kk/skills/explain-things/references/views.md` | Intentional duplication of the shape→view catalog that also appears in SKILL.md §3 — accepted: the body needs the default map pre-disclosure, while references/views.md must stand alone when loaded JIT |
| P4 | `docs/05_FEATURES.md` | F9 row status must flip to done via feature sync at wrap time (transient by pipeline design) |

**Residual risk:** low — static prompt files only; no executable surface changed.

**Disposition:** approved for verification.

### References

- Feature contract: `docs/features/F9_explain-things-skill-and-tell-me-command.md`.
- Selected approach and provenance analysis: `docs/plans/2026-08-26-explain-things-brainstorm.md`.
- Vendor provenance: `vendors/misc/eli5/SKILL.md`, `vendors/misc/show-me/SKILL.md`.
- Capability/plugin conventions: `plugins/kk/README.md`,
  `plugins/kk/skills/itc-generating/references/skill-authoring.md`.
- Binding placement and naming: `docs/00_ADR.md` ADR-009 and ADR-011.
- Documentation triggers: `docs/99_PROJECT_CONSTITUTION.md` T3/T4 and §§6.2/6.5.
- Generated package-copy ownership: `scripts/bundle-plugins.ts`.

### History

- 2026-08-26T23:29:18.669Z todo → wip (system)
- 2026-08-26T23:41:12.223Z wip → testing (system)
- 2026-08-26T23:41:56.174Z testing → done (system)
