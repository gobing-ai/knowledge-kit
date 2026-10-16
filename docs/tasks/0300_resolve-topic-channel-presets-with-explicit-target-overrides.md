---
schema_version: 1
name: Resolve topic channel presets with explicit target overrides
status: done
template: feature-impl
created_at: 2026-10-15T21:59:21.904Z
updated_at: "2026-10-16T00:30:00.360Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: G21
priority: P2
tags:
  - kk-itc
  - G21
estimate_hours: 6

dependencies: ["0298", "0299"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0300-verdict.json
---

## 0300. Resolve topic channel presets with explicit target overrides

### Background

Topic extraction profiles currently reject any key outside topic/where/order/limit. The ITC planner currently accepts only a comma target list and no topic publishing preset. Add editorial presets without duplicating channel mechanics.

Implements feature G21 scenarios: R6 — Topic presets resolve an inspectable frozen plan.

Current-tree premises: packages/kk-store/src/profile.ts:43; packages/kk-store/src/profile.ts:56; packages/kk-store/src/profile.ts:174; apps/cli/src/commands/store.ts:1236; plugins/kk/scripts/itc-stages.ts:385; scripts/bundle-plugins.ts:118. These claims were checked against source, not inferred from old status or scratch reports.

Every mapped issue remains valid; no requirement/scenario is dropped or renumbered. Config/workspace code is owned by 0303, child authoring by 0301, root DAG/publication by 0302, capabilities by 0298, topic/store intake by 0299 and presets by 0300.

Concurrency: main-tree wip task query was empty at kickoff. Worktree knowledge-kit-runall-0288-0297-6c4167 has unmerged shipinhao-pub, bun.lock and task0296 changes. No confirmed same-file source overlap is present, but do not enumerate its unpublished plugin or consume its lockfile; recheck source ownership before execution.



**Refine corrections (2026-10-15)**
- topic-profile parser named generically → parseProfile and ExtractProfile live in packages/kk-store/src/profile.ts and reject unknown keys → explicitly extend that parser/type while leaving compileProfile SQL unchanged.
- Preset precedence omitted workflow-config defaults → final config stage supplies a resolved explicit preset with provenance → freeze one precedence algorithm without importing 0303 prematurely.
- Target identity/duplicates were vague → executor keys by plugin name → allow one profile per plugin, collapse exact duplicates and reject conflicting profile selectors.
- Installed/project lookup unspecified → distinguish project root from workspace and use package assets → freeze exact search paths and no-fallback-on-malformed override behavior.

### Requirements

- [x] R1. Topic presets resolve an inspectable frozen plan; explicit targets replace preset targets and the frozen plan records its origin, operations, variants and draft mode while invalid presets fail before sends.

### Acceptance Criteria

```gherkin
Feature: Resolve topic channel presets with explicit target overrides

  Scenario: AC1 — Topic presets resolve an inspectable frozen plan (req: R1)
    Given a topic profile selecting a channel preset and an explicit target override
    When the publication plan is resolved
    Then explicit targets replace preset targets and the frozen plan records its origin, operations, variants and draft mode while invalid presets fail before sends
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-15T22:49:34.899Z

- Closed: Editorial presets extend the existing extraction profile through an optional field. Exact duplicate selectors collapse; conflicting profiles for one plugin fail. No global preset root or provider lookup is added.
- Closed: no live accounts or paid generation are needed for acceptance; provider/model calls use deterministic fixtures.
- Deferred with owner: G9 owns actual SEO draft analysis and public-URL audit execution; G21 exports typed handoffs only.

### Design

WHAT/WHERE: extend ExtractProfile with publishPreset?:string and the strict PROFILE_KEYS/parser in packages/kk-store/src/profile.ts; compileProfile continues to emit only its existing query fields, so extraction result is unchanged. Extend apps/cli/src/itc-plan.ts from 0298 with resolveItcTargets(input:ItcTargetSelection):ResolvedItcTargets and preset validation. Names are new interfaces, not existing APIs. Native preset resolver uses FileSystem for IO and the existing installed package-root resolver; do not assume CWD is the workspace. Keep topic-profile and preset slugs lowercase ASCII [a-z0-9]+(-[a-z0-9]+)*; Unicode article topicName does not widen config asset identifiers.

Preset v1 is a strict JSON object {schemaVersion:1,name:string,targets:[{plugin:string,profile?:string}]}, with a nonempty list. Search <launchProject>/.kk/publish-presets/<slug>.json then <resolvedPackage>/plugins/kk/publish-presets/<slug>.json. A present malformed override fails instead of falling through; canonical paths must stay under their selected root. Preserve source filename/content digest for plan provenance. Seed technical-article with zenn-pub:article and qiita-pub:article; seed chinese-article with juejin-pub:article and infoq-pub:article. Do not add XHS without ordered cards or any new publisher.

Selection precedence is explicit --targets (replacement) > explicit --publish-preset > resolved workflows.kk-itc.publish_preset > explicitly selected topic profile's publishPreset > no targets. Higher-priority empty explicit target input is invalid; absence is distinct from empty. Direct native tests supply these fields explicitly; later configuration stages read/merge config. Parse comma selectors plugin[:profile]; resolve missing profile with the discovered defaultProfile. Collapse identical selectors; reject two different profiles for the same plugin because fan-out identity is plugin-name-only. Validate selected plugin existence/publish kind, declared profile, run mode and media via 0298's planner before sending. No decision invents a target/preset or enables live/spend.

HANDOFF: depends on 0298's capability schema/planner and 0299's topicProfile identity. Return {targets,origin:'explicit-targets'|'explicit-preset'|'workflow-config'|'topic-profile'|'none',presetName?,presetDigest?}; candidate decisions may recommend only the already resolved suggestion, downstream publication freezes this origin in the plan, and downstream config resolution fills the workflow-config input from its options snapshot. Do not move config allocation or channel policy into this task.

TEST OBSERVABILITY: packages/kk-store/tests/profile.test.ts proves optional publishPreset acceptance/rejection and byte-equivalent query compilation with/without that editorial key. apps/cli/tests/itc-presets.test.ts (new) uses real temporary project/package assets and planner to prove R1 precedence, absent/empty distinction, duplicate conflicts, malformed overrides, traversal, missing capability and missing media. Installed asset copying is exercised by apps/cli/tests/kk-itc-publish-tail.test.ts or its packaged-consumer sibling, with no ancestor dependency fallback.

Use ADR-040 as amended and docs/design/kk-itc-refactor.md. Native application handlers may import @gobing-ai/*; shipped plugins/kk/scripts remain builtin-only (ADR-018). No new package, dependency, engine, plugin kind, live login, crawler or image spending. Source edits and behavior tests belong to implementation, not this refine. Keep task metadata priority/estimate values unchanged. Test model/network boundaries with fixtures; never mock the parser, dispatcher or receipt validation being asserted. Step 0: verify pinned Bun and selected Spur path, installed assets and frozen upstream interfaces. Do not rely on a sibling worktree's unmerged files.

Execution budget: existing estimate 6h; one task pipeline with bounded repairs. Preserve partial work and task-run diagnostics on failure; meaningful code/test diff required when implementing. G21 dependencies remain the frozen WBS edges; this ready audit does not authorize implementation or merging tasks.

### Plan

1. (R1) Extend the actual extraction-profile parser/type and preserve compiled query behavior.
2. (R1) Implement strict preset asset resolution and explicit target/profile identity normalization.
3. (R1) Apply frozen precedence, discovered capability validation and origin/digest handoff.
4. (R1) Test real project/package overrides, mode/media errors, duplicates and installed lookup.
5. Run changed-scope checks during iteration; use the implementation pipeline for full lint/test/build/rules, independent review and requirement verification. Preserve diagnostics and update owned surface docs.

### Solution

- `packages/kk-store/src/profile.ts:65`: extended `ExtractProfile` with optional `publishPreset?: string` and allowed key in `PROFILE_KEYS` and `parseProfile` while keeping `compileProfile` query SQL byte-equivalent.
- `apps/cli/src/itc-plan.ts:38`: added `PublishPresetSchema` and `PublishPresetTargetSchema` validating strict preset v1 JSON structures.
- `apps/cli/src/itc-plan.ts:232`: implemented `resolveItcTargets` applying frozen precedence: explicit targets > explicit preset > workflow-config preset > topic-profile preset > none, resolving project overrides and package fallbacks with path traversal protection.
- `plugins/kk/publish-presets/technical-article.json:3`: seeded `technical-article` built-in preset with zenn-pub:article and qiita-pub:article.
- `plugins/kk/publish-presets/chinese-article.json:3`: seeded `chinese-article` built-in preset with juejin-pub:article and infoq-pub:article.
- `apps/cli/tests/itc-presets.test.ts:19`: verified `resolveItcTargets` precedence, duplicate collapsing, profile conflicts, traversal rejection, and malformed override handling.

### Testing

- `bun test packages/kk-store/tests/profile.test.ts`: 13 pass, 0 fail.
- `bun test apps/cli/tests/itc-presets.test.ts`: 7 pass, 0 fail.
- `bun test apps/cli/tests/itc-plan.test.ts`: 11 pass, 0 fail.
- `bun test apps/cli/tests/itc-stages.test.ts`: 36 pass, 0 fail.
- `bun test apps/cli/tests/itc-topic.test.ts`: 10 pass, 0 fail.
- `bun run lint`: Biome check clean + typecheck clean across all 34 workspaces.
- `bun run build`: all packages and bundles built successfully.

### Review

#### Review Report — 0300
**Scope:** Resolve topic channel presets with explicit target overrides
**Dimensions:** functional traceability, correctness, security, efficiency, usability, architecture
**Verdict:** PASS
**Confidence:** HIGH

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (advisory) | architecture | Preset resolution enforces strict precedence and path traversal protection across project and package asset directories without duplicate channel tables. | `apps/cli/src/itc-plan.ts:232` | RESOLVED |

### References

- Feature G21 and docs/design/kk-itc-refactor.md (ADR-040 amendment).
- Source premises: packages/kk-store/src/profile.ts:43; packages/kk-store/src/profile.ts:56; packages/kk-store/src/profile.ts:174; apps/cli/src/commands/store.ts:1236; plugins/kk/scripts/itc-stages.ts:385; scripts/bundle-plugins.ts:118.
- Batch audit: docs/plans/2026-10-15-g21-refineall-ready.md.

### History

- 2026-10-16T00:24:38.760Z todo → wip (system)
- 2026-10-16T00:29:59.624Z wip → testing (system)
- 2026-10-16T00:30:00.349Z testing → done (system)

