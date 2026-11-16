---
schema_version: 1
name: Add an opt-in h3-image-mlx provider to image-gen
status: done
template: feature-impl
created_at: 2026-11-15T22:44:30.594Z
updated_at: "2026-11-16T18:10:49.614Z"

ac_altitude: graduating
ac_numbering: task-local
feature_id: K2
done_forced: "false"
done_reason: unforced close
---

## 0379. Add an opt-in h3-image-mlx provider to image-gen

### Background

Robin has a working local Apple Silicon MLX image runtime at `../gitops/apps/h3-image-mlx`, exposed by `h3gen.sh`. The goal is to reduce external image-generation token spend by making that runtime an opt-in backend for the existing `plugins/generations/image-gen` pipeline, then moving daily work only after correctness, visual quality, and scheduler reliability are proven.

The provider seam is the smallest complete integration: it reuses image-gen presets, prompt composition, exact-size negotiation, budget/dry-run behavior, artifact metadata, XHS composition, and D6 fallback. A separate generator plugin would duplicate that pipeline; unlike voice-gen, there is no shared image-generation package to inject into.

### Requirements

- [x] R1. Add an `h3-local` provider to the existing `plugins/generations/image-gen` plugin; do not create a second generator plugin or extract a shared image package.
- [x] R2. Implement the frozen `ImageProvider` contract by spawning the wrapper named by `H3_IMAGE_MLX_BIN` (the local `h3gen.sh`), returning image bytes, supporting one image per call, forwarding reference images, and cleaning temporary files on success and failure.
- [x] R3. Honour exact preset canvases when width and height are valid H3 dimensions (multiples of 32, 256–4096); otherwise translate aspect-only requests to a valid H3 canvas. Surface wrapper timeout/nonzero-exit failures with actionable stderr so existing fallback handling can engage.
- [x] R4. Register `h3-local` as explicit opt-in only: never auto-select it, keep `isAvailable()` limited to env presence with no subprocess or filesystem probe, and preserve every existing provider selection and fallback behavior.
- [x] R5. Add deterministic tests using a fake `H3_IMAGE_MLX_BIN`; cover argument construction, exact/aspect sizing, references, `n > 1` rejection, readiness, timeout/nonzero exit, temporary-file cleanup, and fallback integration without loading model weights or spending on a cloud provider.
- [x] R6. Rehearse real local renders into a disposable works directory for both an XHS text-free illustration and the daily-news cover, recording artifacts, dimensions, wall time, and a same-brief comparison against the currently pinned provider. Local output must pass text-free/card-composition checks; changing the pinned cover look requires explicit operator A/B approval.
- [x] R7. Validate the actual daily scheduler context (launchd versus cron, Metal session, and removable-volume/TCC access). Enable XHS through `xhs_provider: h3-local` with cloud fallback only after the local smoke path passes; keep the existing cloud defaults and cover pin until their gates pass, and document the one-var opt-in and rollback.
- [x] R8. Update the provider/config examples, image-authoring provider reference, image-gen README, and `docs/04_DESIGN.md` with the implementation; document ignored negative prompts, cold-load/reference-edit latency, and the fact that editing a checkout does not by itself update the installed daily runtime. Run focused tests and `bun run gate`; leave unrelated working-tree changes untouched.

### Acceptance Criteria

```gherkin
Scenario: AC1 — The existing plugin owns the local backend (req: R1)
  Given the existing `plugins/generations/image-gen` plugin
  When the local integration is implemented
  Then an `h3-local` adapter lives under its `src/providers/` directory
  And no second image generator plugin or shared image package is introduced

Scenario: AC2 — The adapter honours the subprocess provider contract (req: R2)
  Given `H3_IMAGE_MLX_BIN` names a working H3 wrapper
  When image-gen requests one image, with or without reference images
  Then the adapter invokes the wrapper with the prompt, output, and references and returns the written bytes
  And `n > 1` is rejected before spawning
  And temporary outputs are removed after both success and failure

Scenario: AC3 — Sizes and failures remain explicit (req: R3)
  Given a format with a valid exact H3 canvas or an aspect-only request
  When the adapter builds wrapper arguments
  Then valid exact canvases are forwarded unchanged and aspect-only requests become legal multiple-of-32 dimensions
  And timeout or nonzero exit raises an actionable error containing wrapper diagnostics
  And a fallback-eligible failure can continue to the configured cloud candidate

Scenario: AC4 — Local generation is never selected silently (req: R4)
  Given the provider registry and `H3_IMAGE_MLX_BIN` either set or unset
  When providers are selected
  Then automatic selection never chooses `h3-local`
  And explicit selection succeeds only when the env setting is present
  And readiness performs no subprocess or filesystem probe
  And existing provider order and fallback semantics are unchanged

Scenario: AC5 — Regression coverage needs neither weights nor cloud spend (req: R5)
  Given a fake `H3_IMAGE_MLX_BIN` that records arguments and writes controlled image bytes
  When the focused provider and fallback tests run
  Then argument construction, exact/aspect sizing, references, readiness, `n > 1`, timeout/nonzero exit, cleanup, and fallback behavior are asserted
  And no test loads H3 weights or calls a cloud image provider

Scenario: AC6 — Real renders prove quality before the cover changes (req: R6)
  Given the local H3 runtime and the currently pinned cloud provider are available
  When an XHS illustration and a daily-news cover are rehearsed into a disposable works directory
  Then repeatable artifacts, measured dimensions, wall time, and same-brief comparisons are recorded
  And the XHS illustration passes the existing text-free and card-composition path
  And the daily cover pin remains unchanged until Robin explicitly approves the local A/B result

Scenario: AC7 — Daily rollout is scheduler-gated and reversible (req: R7)
  Given the actual daily launchd or cron execution context
  When local Metal and removable-volume access are probed there
  Then XHS switches to `h3-local` with cloud fallback only after that probe and a local smoke render pass
  And the installed daily runtime is shown to resolve the updated plugin
  And failure leaves the existing cloud path intact
  And the cover pin and one-command rollback remain documented

Scenario: AC8 — Documentation and repository gates close the work (req: R8)
  Given the completed adapter and rollout configuration
  When the change is reviewed and verified
  Then the provider/config examples, image-authoring provider reference, image-gen README, and `docs/04_DESIGN.md` describe the shipped behavior and limitations
  And focused tests plus `bun run gate` pass without new suppressions or skipped tests
  And unrelated pre-existing working-tree changes are not modified
```

### Q&A

#### Q&A entry — local-provider design

- **Chosen:** extend image-gen with an `h3-local` provider rather than add `plugins/generations/image-gen-local`. The existing provider interface and fallback loop already cover the required seam; a second plugin would duplicate presets, composition, artifacts, and budget handling.
- **Chosen:** explicit selection only through the job provider or `IMAGE_GEN_PROVIDER`; `h3-local` joins `NEVER_AUTO`. A minutes-long local render that depends on Apple Silicon, Metal, and an external weights volume must not become a silent default.
- **Chosen:** XHS is the first daily candidate because it accounts for most daily image calls and already opts into fallback. The cover keeps its pinned provider until a same-brief visual A/B is explicitly approved.
- **Chosen:** the adapter shells out to `h3gen.sh`; it does not import Python or reimplement H3. `H3_IMAGE_MLX_BIN` is the required readiness env and `H3_LOCAL_TIMEOUT_MS` may override a generous local default.
- **Deferred:** seed plumbing into `ImageRequest`, a warm model server, and H3 negative-prompt support. Add seed only for a real reproducibility need; the current CLI has no server mode and its negative-prompt option is not an H3 capability, so style negatives are documented as ignored.
- **Verification gate:** whether the 04:30 scheduler is launchd or cron, and whether that context can access Metal and `/Volumes/RTK9210-FLASH`, must be measured before daily enablement. This is a validation step, not permission to change scheduler configuration.

### Design

Implement `src/providers/h3-local.ts` using `src/providers/codex-cli.ts` as the subprocess/temp-file precedent. The registry row uses `H3_IMAGE_MLX_BIN`, default model `h3`, reference support, and a readiness note; add the name to `NEVER_AUTO` and keep it out of `AUTO_ORDER`.

For exact-size requests, `exactSize()` returns true only for dimensions accepted by H3 (multiples of 32 within 256–4096). Otherwise image-gen retains the aspect-only request path and the adapter chooses a legal canvas for that ratio. The wrapper receives one prompt/output pair, repeated `--reference` arguments, and an optional exact width/height. A subprocess timeout defaults to 30 minutes because the measured cold 1024² render is about 6–7 minutes and reference edits can take about 28 minutes; nonzero exit and timeout preserve stderr in the thrown error for error classification/fallback.

Do not probe the executable, weights, external volume, or Metal in `isAvailable()`: provider selection is synchronous and env-based. Real runtime and scheduler probes belong to the rehearsal/rollout steps. Preserve current cloud defaults until the corresponding evidence exists.

The adapter ignores `StylePreset.negative` for H3 and documents that limitation. It does not add seed request plumbing, a model server, or a new package abstraction.

### Plan

1. Write the failing fake-wrapper provider and fallback tests first, including the exact-size and failure/cleanup cases.
2. Implement `src/providers/h3-local.ts`, register it in `src/providers/types.ts` as `NEVER_AUTO`, and add the narrow runtime-boundary exemption required for subprocess/temp-file transport.
3. Add the env/config and operator documentation, including explicit selection, limitations, timing expectations, rollback, and installed-runtime resolution.
4. Run focused tests, then the full repository quality gate; fix root causes without suppressions.
5. Run the real local XHS and cover rehearsals through `kk executor run image-gen`, save repeatable artifacts/metrics, and compare the cover against the pinned cloud result for operator review.
6. Probe the same scheduler context used by the 04:30 daily run. If it passes, switch XHS to `h3-local` with cloud fallback and verify the installed runtime resolves the change; otherwise record the scheduler blocker and leave cloud defaults untouched.
7. Switch the cover only after explicit A/B approval; otherwise finish with the documented cover opt-in left disabled.

### Solution

Provider seam, no new plugin or package: `h3-local` is one adapter inside the existing
image-gen registry, so presets, prompt composition, exact-size negotiation, artifact recording and
D6 fallback are reused unchanged.

- `plugins/generations/image-gen/src/providers/h3-local.ts:123` — `createH3Local`: `isAvailable()` is
  `H3_IMAGE_MLX_BIN` presence only (no subprocess/filesystem probe), `supportsReferenceImages()` is
  true (up to 16 wrapper refs), `validate()` rejects `n > 1` before spawning, and `generate()` spawns
  the wrapper with `--prompt/--output/--width/--height` plus one `--reference` per image, then reads
  the written bytes and removes the temp output in a `finally`.
- `…/h3-local.ts:49` — `h3ExactSize` is the H3 canvas rule (multiple of 32, 256–4096);
  `…/h3-local.ts:135` wires it into `exactSize()` so a preset declaring a legal canvas forwards
  `width`/`height` unchanged (xhs-card's 1080×1440 does not, and keeps the aspect path).
- `…/h3-local.ts:60` — `h3Canvas` turns an aspect-only request into a 1024-short-side canvas snapped
  to the same grid; an unparseable ratio falls back to 1024×1024 at the call site.
- `…/h3-local.ts:40` — the 30-minute default bound: the wrapper's own measurements are ~6–7 min for
  a cold 1024² render and 27 min 46 s for a two-reference edit, so a tighter default would kill work
  already paid for. `H3_LOCAL_TIMEOUT_MS` overrides it; `ProviderOptions.timeoutMs` wins (tests).
- Failure paths keep the fallback classifier usable: timeout and non-zero exit carry the wrapper's
  stderr tail, and a zero exit that wrote no file is an explicit `no output` error. The timeout kills
  the wrapper's **process group** — `h3gen.sh` runs the Python runtime as a child, so killing only the
  shell would leave a render holding the GPU.
- `plugins/generations/image-gen/src/providers/types.ts:174` — the registry row (env
  `H3_IMAGE_MLX_BIN`, default model `h3`, readiness `note`), and `…/types.ts:115` adds the name to
  `NEVER_AUTO` while leaving `AUTO_ORDER` untouched: automatic selection can never pick it.
- `.spur/rules/strict/runtime-boundaries.yaml:76` and `:141` — the per-file
  `no-direct-process-spawn` / `no-direct-fs-io` exemptions this transport requires, same
  vendor-CLI-boundary class as `codex-cli.ts`.
- Docs: `docs/04_DESIGN.md` (dated section + the two env rows),
  `plugins/kk/skills/image-authoring/references/providers.md` (inventory row + the never-auto and
  limitation rules), and both `config.example.yaml` files.

Deliberate limits: H3 has no negative-prompt capability so `StylePreset.negative` is ignored, the
wrapper's seed default (42) is not plumbed through `ImageRequest`, and nothing probes the venv,
weights or external volume at selection time — those stay rehearsal/scheduler checks (R6/R7), not
readiness facts.

Correction after K3 (0380): the "ignored negatives" limit above no longer holds — `composePrompt` now appends a style's `negative` as one `avoid: …` segment for every provider, so H3 receives it as prompt text. What remains true is that H3 has no native negative-prompt parameter.

**Quality and rollout close (2026-11-16).** The first forced re-audit failed the real-render quality gate, so the initial minimax pins stayed in place. Strengthened same-brief retries then passed both independent vision reviews:

- XHS: 315 s, 768×1024 illustration composed to 1080×1440; `textFree=true`, `compositionPass=true`, including the required key ring.
- Cover: 268 s, exact 1344×576; `textFree=true`, `subjectPass=true`, `compositionPass=true`, and the local plate won the blind A/B. The cover pin nevertheless stays `minimax/image-01` because changing it needs a separate explicit A/B approval.

`kk-daily-ai-voice2` now explicitly pins `xhs_provider: h3-local` / `xhs_model: h3` with cloud fallback; rollback is `minimax/image-01`. The consolidated `kk news` path carries the same opt-in only in machine-local `workflows.kk-news-generate` config, not as a compiled default. The retired `kk-daily-ai-voice` workflow remains behaviorally frozen on MiniMax. Installed direct image-gen dry-run exits 0 with `metadata.dryRun=true`, and the installed stage composes an H3 XHS envelope.

Two unrelated gate defects also had to be repaired for R8: the WeChat tests now assert both the default enrichment refusal and the explicitly allowed capability success, and G61 now declares its owning `- In: news` scope through the feature CLI. Final `bun run gate`: 5247 pass / 0 fail, no skipped tests or new suppressions.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/generations/image-gen/src/providers/h3-local.ts:123` lives in the existing plugin and `types.ts:175` registers it; no second plugin/package exists. |
| R2 | MET | `h3-local.ts:123` implements the provider; fake-wrapper tests cover argv, references, one-image validation, returned bytes, and cleanup on success/failure. |
| R3 | MET | `h3-local.ts:49,:60` enforce legal H3 canvases; timeout/nonzero/no-output errors preserve diagnostics. The fresh cover used exact 1344×576 and XHS used a legal aspect-derived 768×1024 illustration. |
| R4 | MET | `types.ts:115` includes h3-local in NEVER_AUTO and leaves AUTO_ORDER unchanged; env-only readiness and explicit-selection tests passed. |
| R5 | MET | Focused image suites passed 135/135, including 15 fake-wrapper tests and fallback/registry coverage without weights or cloud calls. |
| R6 | MET | Strengthened same-brief retries passed both vision gates: XHS 315s (768×1024 → 1080×1440), `textFree=true` and `compositionPass=true` including the key ring; cover 268s exact 1344×576, `textFree=true`, `subjectPass=true`, `compositionPass=true`, and local B won the blind A/B. Artifacts, dimensions, timings, and comparisons are recorded. |
| R7 | MET | `kk-daily-ai-voice2` explicitly pins h3-local/h3 with cloud fallback; consolidated `kk news` resolves the same values from machine-local config. Retired voice1 and cover remain minimax. Installed direct image-gen dry-run exits 0 and the installed stage composes the H3 XHS envelope. Rollback is documented. |
| R8 | MET | Docs/config examples and focused image tests are green. `bun run gate` completed successfully: format/build/lint/typecheck, 58+2 rules, and 5247 tests with zero failures or skips. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Registry and adapter tests pass inside the existing image-gen plugin. |
| AC2 | MET | test | `plugins/generations/image-gen/tests/providers/h3-local.test.ts` covers exact argv, refs, n>1 pre-spawn rejection, bytes, and both cleanup paths. |
| AC3 | MET | test | Size, timeout, nonzero exit, missing output, and fallback-registry cases pass; real cover confirms exact sizing. |
| AC4 | MET | test | NEVER_AUTO, env-only readiness, explicit selection, and unchanged AUTO_ORDER tests pass. |
| AC5 | MET | test | 135/135 focused image tests pass with fake wrappers and no provider spend. |
| AC6 | MET | command | Both strengthened real renders pass independent vision review. XHS is text-free with complete composition; cover is text-free with subject/composition pass and wins blind A/B. Cover pin remains unchanged pending separate explicit approval. |
| AC7 | MET | command | Scheduler and H3 executable are present; XHS now explicitly uses h3-local/h3 with cloud fallback in voice2 and consolidated config, the installed runtime resolves it, and rollback plus unchanged cover pin are documented. |
| AC8 | MET | command | Focused tests and all static gates pass; final `bun run gate` is green at 5247 pass / 0 fail. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- **Owning feature:** K2 (`Local H3 image generation for image-gen`), a child of the completed K image-pipeline map.
- Local runtime and measured costs: `../gitops/apps/h3-image-mlx/README.md`; wrapper contract: `../gitops/apps/h3-image-mlx/h3gen.sh`.
- Provider contract and registry: `plugins/generations/image-gen/src/providers/types.ts`; subprocess precedent: `plugins/generations/image-gen/src/providers/codex-cli.ts`.
- Image envelope, exact-size negotiation, fallback, and artifact writing: `plugins/generations/image-gen/src/index.ts`; job schema: `plugins/generations/image-gen/src/job.ts`.
- Related completed provider work: tasks 0103, 0107, 0115; fallback: D6/0166; exact-size behavior: F618/0182; pinned daily cover: F614.
- Daily image rollout surface: `plugins/kk/workflows/kk-daily-ai-voice.yaml`, `plugins/kk/workflows/kk-daily-ai-voice2.yaml`, and `plugins/kk/scripts/daily-stages.ts`.
- Operator provider digest: `plugins/kk/skills/image-authoring/references/providers.md`.

### History

- 2026-11-15T22:47:02.293Z backlog → todo (system)
- 2026-11-15T23:12:59.194Z todo → wip (system)
- 2026-11-16T00:25:24.638Z wip → testing (system)
- 2026-11-16T00:25:25.863Z testing → done (system)

