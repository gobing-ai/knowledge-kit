---
schema_version: 1
id: "K2"
name: "Local H3 image generation for image-gen"
status: active
priority: P2
tags: []
created_at: "2026-11-15T22:51:56.920Z"
updated_at: "2026-11-15T22:53:47.324Z"
---

# K2: Local H3 image generation for image-gen

## Goal

Make the existing `plugins/generations/image-gen` plugin able to render through Robin's local H3 Image MLX runtime as an explicitly selected provider, reducing external image-generation spend without silently changing provider selection or the established daily cover look. Daily migration proceeds only after deterministic tests, real render comparisons, and scheduler-context evidence prove the local path ready, with cloud fallback and a documented rollback.

## Scope

**In scope**

- An `h3-local` adapter inside the existing image-gen provider registry, invoking `h3gen.sh` through `H3_IMAGE_MLX_BIN`.
- Exact and aspect-derived H3 canvases, reference images, single-image validation, timeouts, actionable failures, and temporary-file cleanup.
- Explicit-only provider selection and preservation of existing automatic selection and fallback behavior.
- Fake-wrapper regression tests plus real XHS and daily-cover rehearsals with artifacts, dimensions, timings, and same-brief comparisons.
- Scheduler-context validation, XHS-first daily opt-in with cloud fallback, and an explicitly approved cover migration path.
- Provider/config/operator documentation, installed-runtime verification, and rollback instructions.

**Out of scope**

- A second image generator plugin or a new shared image-generation package.
- Automatic selection of the local provider or silent replacement of current cloud defaults.
- A warm model server, Python runtime port, seed plumbing, or H3 negative-prompt support.
- Changing the pinned daily cover before operator A/B approval.
- Scheduler installation or permission changes; this feature validates the existing context only.
- XHS publish transport and its automation guard.

## Acceptance Criteria

```gherkin
Feature: Local H3 image generation through image-gen

  @core
  Scenario: R1 — The existing plugin owns the local backend
    Given the existing `plugins/generations/image-gen` plugin
    When the local integration is implemented
    Then an `h3-local` adapter lives under its `src/providers/` directory
    And no second image generator plugin or shared image package is introduced

  @core
  Scenario: R2 — The adapter honours the subprocess provider contract
    Given `H3_IMAGE_MLX_BIN` names a working H3 wrapper
    When image-gen requests one image, with or without reference images
    Then the adapter invokes the wrapper with the prompt, output, and references and returns the written bytes
    And `n > 1` is rejected before spawning
    And temporary outputs are removed after both success and failure

  @core
  Scenario: R3 — Sizes and failures remain explicit
    Given a format with a valid exact H3 canvas or an aspect-only request
    When the adapter builds wrapper arguments
    Then valid exact canvases are forwarded unchanged and aspect-only requests become legal multiple-of-32 dimensions
    And timeout or nonzero exit raises an actionable error containing wrapper diagnostics
    And a fallback-eligible failure can continue to the configured cloud candidate

  @core
  Scenario: R4 — Local generation is never selected silently
    Given the provider registry and `H3_IMAGE_MLX_BIN` either set or unset
    When providers are selected
    Then automatic selection never chooses `h3-local`
    And explicit selection succeeds only when the env setting is present
    And readiness performs no subprocess or filesystem probe
    And existing provider order and fallback semantics are unchanged

  @core
  Scenario: R5 — Regression coverage needs neither weights nor cloud spend
    Given a fake `H3_IMAGE_MLX_BIN` that records arguments and writes controlled image bytes
    When the focused provider and fallback tests run
    Then argument construction, exact/aspect sizing, references, readiness, `n > 1`, timeout/nonzero exit, cleanup, and fallback behavior are asserted
    And no test loads H3 weights or calls a cloud image provider

  @core
  Scenario: R6 — Real renders prove quality before the cover changes
    Given the local H3 runtime and the currently pinned cloud provider are available
    When an XHS illustration and a daily-news cover are rehearsed into a disposable works directory
    Then repeatable artifacts, measured dimensions, wall time, and same-brief comparisons are recorded
    And the XHS illustration passes the existing text-free and card-composition path
    And the daily cover pin remains unchanged until Robin explicitly approves the local A/B result

  @core
  Scenario: R7 — Daily rollout is scheduler-gated and reversible
    Given the actual daily launchd or cron execution context
    When local Metal and removable-volume access are probed there
    Then XHS switches to `h3-local` with cloud fallback only after that probe and a local smoke render pass
    And the installed daily runtime is shown to resolve the updated plugin
    And failure leaves the existing cloud path intact
    And the cover pin and one-command rollback remain documented

  @core
  Scenario: R8 — Documentation and repository gates close the work
    Given the completed adapter and rollout configuration
    When the change is reviewed and verified
    Then the provider/config examples, image-authoring provider reference, image-gen README, and `docs/04_DESIGN.md` describe the shipped behavior and limitations
    And focused tests plus `bun run gate` pass without new suppressions or skipped tests
    And unrelated pre-existing working-tree changes are not modified
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0379 | Add an opt-in h3-image-mlx provider to image-gen | todo |
<!-- END AUTO-GENERATED -->

## Notes

Owning implementation task: **0379** (`Add an opt-in h3-image-mlx provider to image-gen`). This is a single-deliverable child of the completed K image-pipeline map; K2 owns the new local-provider capability while K remains the historical migration record.

Related features remain narrower and unchanged: F614 owns the fixed daily-cover style, F618 owns canvas delivery, and F615/F616 own XHS card behavior. K2 reuses those contracts rather than replacing them.

Local runtime evidence and wrapper contract: `../gitops/apps/h3-image-mlx/README.md` and `../gitops/apps/h3-image-mlx/h3gen.sh`.

## History

- 2026-11-15T22:53:47.324Z backlog → active (system)

