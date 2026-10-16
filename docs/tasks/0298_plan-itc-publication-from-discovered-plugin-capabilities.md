---
schema_version: 1
name: Plan ITC publication from discovered plugin capabilities
status: done
template: feature-impl
created_at: 2026-10-15T21:59:21.896Z
updated_at: "2026-10-16T07:02:03.673Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: G21
priority: P2
tags:
  - kk-itc
  - G21
estimate_hours: 8

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0298-verdict.json
---

## 0298. Plan ITC publication from discovered plugin capabilities

### Background

Publish planning currently reads TARGET_PROFILES in plugins/kk/scripts/itc-stages.ts instead of discovered capabilities; current manifest/discovery has no typed publishing field. Replace that duplicated policy at the existing stage boundary.

Implements feature G21 scenarios: R5 — Publish plugins describe operation-specific capabilities.

Current-tree premises: packages/kk-core/src/schemas.ts:17; packages/kk-core/src/manifest.ts:55; packages/kk-core/src/registry.ts:11; apps/cli/src/stage.ts:81; apps/cli/src/commands/stage.ts:47; plugins/kk/scripts/itc-stages.ts:266; plugins/publishings/qiita-pub/src/index.ts:68; plugins/publishings/wechatmp-pub/src/modes.ts:27. These claims were checked against source, not inferred from old status or scratch reports.

Every mapped issue remains valid; no requirement/scenario is dropped or renumbered. Config/workspace code is owned by 0303, child authoring by 0301, root DAG/publication by 0302, capabilities by 0298, topic/store intake by 0299 and presets by 0300.

Concurrency: main-tree wip task query was empty at kickoff. Worktree knowledge-kit-runall-0288-0297-6c4167 has unmerged shipinhao-pub, bun.lock and task0296 changes. No confirmed same-file source overlap is present, but do not enumerate its unpublished plugin or consume its lockfile; recheck source ownership before execution.



**Refine corrections (2026-10-15)**
- Existing Content format enum → ContentSchema.format is a string defaulting to markdown → remove the invented enum restriction; validate nonempty profile formats without narrowing generic Content.
- Unspecified native stage seam → runStage is synchronous and daily.ts calls it synchronously → add an async ITC handler in the stage command action and keep runStage/daily callers synchronous.
- Generic draft metadata is sufficient → Qiita private overrides published and WeChat operations are 文章/贴图/视频/播客 → freeze complete plugin-owned mode bindings from current implementations.
- Configuration snapshot assumed before 0303 → no ITC resolver exists upstream → planner accepts explicit validated request data; 0303 later supplies config-derived values.
- TARGET_PROFILES was treated as a public contract → current tests import it but runtime entry is the stage → replace representation tests while retaining behavioral and legacy stage coverage.

### Requirements

- [x] R1. Publish plugins describe operation-specific capabilities; it uses those declarations without a channel table or channel-specific workflow edits and rejects an incompatible requested operation.

### Acceptance Criteria

```gherkin
Feature: Plan ITC publication from discovered plugin capabilities

  Scenario: AC1 — Publish plugins describe operation-specific capabilities (req: R1)
    Given a discovered publish plugin declaring supported format, locale, draft modes, requirements and metadata bindings
    When the publication planner resolves its operation
    Then it uses those declarations without a channel table or channel-specific workflow edits and rejects an incompatible requested operation
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-15T22:49:19.158Z

- Closed: No Content format enum or generic transport selector is added. Native ITC command dispatch is async; the existing runStage API stays sync. Configuration allocation remains owned by 0303.
- Closed: no live accounts or paid generation are needed for acceptance; provider/model calls use deterministic fixtures.
- Deferred with owner: G9 owns actual SEO draft analysis and public-URL audit execution; G21 exports typed handoffs only.

### Design

WHAT/WHERE: add PublishingProfileSchema and PublishingCapabilitiesSchema with inferred object interfaces in packages/kk-core/src/manifest.ts, carry publishing?: PublishingCapabilities on PluginRecord in registry.ts, and export through index.ts. The publishing subobject is strict, allowed only for kind=publish; defaultProfile must name a nonempty profiles record. A profile has format:string, locale:source or canonical language tag, optional limits:{title?,body?} with each {max:positive integer,unit:ContentCountUnit}, optional requires:{cover?:boolean,orderedImages?:boolean}, and modes:{draft?:{metadata:JSON object},live?:{metadata:JSON object}} with at least one mode. Omit the redundant execution:'executor' constant. Generic Content.format remains an unrestricted string. Plugin-local validation remains authoritative for direct execution.

Freeze apps/cli/src/itc-plan.ts as the native substantive planner with buildItcPublishPlan(request:ItcPlanRequest, plugins:readonly PluginRecord[]):ItcPublishPlan. ItcPlanRequest is {schemaVersion:1,workDir,sourceLocale,live,targets:[{plugin,profile?}],sourceContentDigest,configDigest?}; workDir is explicit at this stage. Native async file IO uses the existing FileSystem seam. apps/cli/src/itc-stage.ts exports runItcStage(args:string[]):Promise<number|undefined>, returning undefined for a non-ITC stage. commands/stage.ts awaits this ITC branch and otherwise calls existing sync runStage. Support the old positional itc-publish-plan signature and add --request <JSON-file> as its validated file-input form; legacy stage normalization remains intact. Existing exported itcPublishPlan(args) in the builtin-only script may forward by argv to kk stage run; native interception prevents recursion. Remove TARGET_PROFILES and migrate its callers/tests, retaining its observable validations.

Mode maps are complete bindings, with the union of a profile's mode keys cleared from source metadata before applying the chosen map. Also remove stale generic operation/published/publishStatus fields. Qiita binds private:true/published:false for drafts and private:false/published:true for live. WeChat article binds operation:文章 and explicit publishStatus:draft|public, matching current browser console modes; never copy the historical operation:draft/API table. Other profiles are transcribed from each current plugin's actual mode resolver. XHS 上传图文 requires ordered metadata.images with real paths; a hero cover alone does not satisfy that requirement. Unsupported operations/media/modes refuse before dispatch. Native planner shares editorial variants only when locale, format, limits and media requirements match, while each target retains its own metadata binding. No channel policy is moved into YAML.

HANDOFF: 0300 extends target/preset selection before calling this planner; 0302 consumes the same versioned plan and separate target mode maps; 0303 creates ItcPlanRequest from config. Do not import 0303's future resolver from 0298. Preserve manifest data in bundle-plugins.ts and installed discovery. Prefer all source-owned existing ITC-compatible publishers; do not add capabilities to audio/video-only channels merely to fill a registry.

TEST OBSERVABILITY: packages/kk-core/tests/manifest.test.ts and registry.test.ts prove actual validation/discovery and backward compatibility. apps/cli/tests/itc-plan.test.ts (new) proves R1 via actual planner plus a manifest-only fake publisher, complete Qiita/WeChat bindings, missing required images and unsupported modes. apps/cli/tests/commands/stage.test.ts, stage.test.ts, itc-stages.test.ts and kk-itc-publish-tail.test.ts preserve both canonical/legacy stage calls and unaffected daily sync callers. Tests must inspect target payload bindings, not only schema text.

Use ADR-040 as amended and docs/design/kk-itc-refactor.md. Native application handlers may import @gobing-ai/*; shipped plugins/kk/scripts remain builtin-only (ADR-018). No new package, dependency, engine, plugin kind, live login, crawler or image spending. Source edits and behavior tests belong to implementation, not this refine. Keep task metadata priority/estimate values unchanged. Test model/network boundaries with fixtures; never mock the parser, dispatcher or receipt validation being asserted. Step 0: verify pinned Bun and selected Spur path, installed assets and frozen upstream interfaces. Do not rely on a sibling worktree's unmerged files.

Execution budget: existing estimate 8h; one task pipeline with bounded repairs. Preserve partial work and task-run diagnostics on failure; meaningful code/test diff required when implementing. G21 dependencies remain the frozen WBS edges; this ready audit does not authorize implementation or merging tasks.

### Plan

1. (R1) Define strict optional capability contracts and exports; validate discovery and staged manifest round-trip.
2. (R1) Implement native planner/request IO and async command-only dispatch; preserve sync runStage and legacy script forwarding.
3. (R1) Declare current mode/operation profiles in publish plugin manifests; remove central table and complete conflicting metadata maps.
4. (R1) Exercise real parser/planner, manifest-only added publisher, native/legacy CLI calls and unchanged daily stage behavior.
5. Run changed-scope checks during iteration; use the implementation pipeline for full lint/test/build/rules, independent review and requirement verification. Preserve diagnostics and update owned surface docs.

### Solution

- `packages/kk-core/src/manifest.ts:68`: defined strict `PublishingProfileLimitsSchema`, `PublishingProfileRequiresSchema`, `PublishingProfileModeBindingSchema`, `PublishingProfileModesSchema`, `PublishingProfileSchema`, `PublishingCapabilitiesSchema`, and extended `PluginManifestSchemaBase` and `PluginManifestSchema` superRefine to ensure publishing capabilities are validated strictly on `kind === 'publish'` plugins.
- `packages/kk-core/src/registry.ts:33`: added `publishing?: PublishingCapabilities` to `PluginRecord` and populated it in `consumeManifest`.
- `packages/kk-core/src/index.ts:1`: exported publishing capability schemas and types.
- `apps/cli/src/itc-plan.ts:88`: implemented substantive native planner `buildItcPublishPlan` with `ItcPlanRequestSchema` and `ItcPublishPlan` types, resolving capabilities from discovered plugins, checking cover/ordered images requirements, and producing variant/fanout/browser groupings and per-target detail bindings.
- `apps/cli/src/itc-stage.ts:10`: exported `runItcStage` to asynchronously handle `itc-publish-plan` via `--request <file>` or positional arguments, writing `4-publish/publish-plan.json` and returning exit codes.
- `apps/cli/src/commands/stage.ts:50`: dispatched ITC stages to `runItcStage` while keeping non-ITC stages on the synchronous `runStage` path.
- `plugins/kk/scripts/itc-stages.ts:325`: removed central profile table and forwarded `itcPublishPlan` to CLI invocation with recursion guard.
- `plugins/publishings/*/plugin.json`: declared publishing capabilities for 12 ITC-compatible channels (medium-pub, substack-pub, emdash-pub, surfdash-pub, zenn-pub, qiita-pub, wechatmp-pub, juejin-pub, infoq-pub, xhs-pub, x-pub, weibo-pub) matching their runtime implementations.
- `apps/cli/tests/itc-plan.test.ts:155`: added comprehensive test suite verifying fake publisher planning, Qiita and WeChat bindings, cover/ordered images requirement checks, and stage invocation.
- `apps/cli/tests/itc-stages.test.ts:427`: tested Discovered publishing capabilities to verify each standard publish target and mode bindings.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Profiles are manifest-declared and validated (`packages/kk-core/src/manifest.ts:125`, `packages/kk-core/src/manifest.ts:174`); `buildItcPublishPlan` (`apps/cli/src/itc-plan.ts:383`) resolves format/locale/draft modes/requirements/bindings from the manifest and rejects incompatible operations. The channel table is gone: transport derives from the manifest's declared `browserSession` (`apps/cli/src/itc-plan.ts:472`, `apps/cli/src/itc-plan.ts:490`), so a new publisher needs no code edit. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R5 — Publish plugins describe operation-specific capabilities | MET | test | `apps/cli/tests/itc-plan.test.ts:124` (manifest-only fake publisher with complete bindings), `apps/cli/tests/itc-plan.test.ts:155` (Qiita/WeChat), requirement and unsupported-mode rejections `apps/cli/tests/itc-plan.test.ts:202`, `apps/cli/tests/itc-plan.test.ts:257`; transport from `browserSession` asserted at `apps/cli/tests/itc-stages.test.ts:339`; off-schema/non-JSON/unknown-target plan requests refused at `apps/cli/tests/itc-stage.test.ts:248`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0298
**Scope:** Plan ITC publication from discovered plugin capabilities
**Dimensions:** functional traceability, correctness, security, efficiency, usability, architecture
**Verdict:** PASS
**Confidence:** HIGH

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (advisory) | architecture | Discovered plugin capabilities replace central TARGET_PROFILES table. Mode bindings verified across Qiita and WeChat MP. | `apps/cli/src/itc-plan.ts:88` | RESOLVED |

### References

- Feature G21 and docs/design/kk-itc-refactor.md (ADR-040 amendment).
- Source premises: packages/kk-core/src/schemas.ts:17; packages/kk-core/src/manifest.ts:55; packages/kk-core/src/registry.ts:11; apps/cli/src/stage.ts:81; apps/cli/src/commands/stage.ts:47; plugins/kk/scripts/itc-stages.ts:266; plugins/publishings/qiita-pub/src/index.ts:68; plugins/publishings/wechatmp-pub/src/modes.ts:27.
- Batch audit: docs/plans/2026-10-15-g21-refineall-ready.md.

### History

- 2026-10-15T23:37:10.406Z todo → wip (system)
- 2026-10-16T00:07:54.172Z wip → testing (system)
- 2026-10-16T00:07:54.711Z testing → done (system)

