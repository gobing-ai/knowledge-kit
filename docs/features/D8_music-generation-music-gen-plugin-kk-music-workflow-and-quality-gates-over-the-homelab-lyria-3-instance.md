---
schema_version: 1
id: "D8"
name: "Music generation: music-gen plugin, kk-music workflow and quality gates over the homelab Lyria 3 instance"
status: backlog
priority: P2
tags: []
created_at: "2026-11-18T22:15:57.189Z"
updated_at: "2026-11-19T00:14:21.729Z"
---

# D8: Music generation: music-gen plugin, kk-music workflow and quality gates over the homelab Lyria 3 instance

## Goal

Add music generation as a first-class kk creation capability: a `music-gen` generator plugin that drives the self-hosted Lyria 3 REST service on the homelab Mac Mini (`xprojects/gitops/homelab/lyria-3-pro`, `POST /api/lyria/generate`), a portable YAML music brief + format×theme preset system, a `music-authoring` skill with a machine-checkable quality rubric, and a `kk-music` workflow that turns an idea into a mastered audio file with spend guards at every paid step.

The homelab service stays as-is (it owns the provider keys, the generation library and the only bill); kk owns steps, presets, quality and orchestration.

## Scope

**In scope**
- A `MusicBrief` YAML contract that renders deterministically to the PROMPT text kk sends, plus the request fields the instance accepts (`model`, `language`, `durationTarget`, `lyrics`, `images`, `title`, `batchCount`). The instance itself appends the Pro duration sentence and the lyrics block.
- A new `plugins/generations/music-gen` generator plugin (`Doc[] | Brief → Content`) with a live HTTP adapter (non-idempotent paid-call policy with library reconciliation) and a deterministic offline adapter.
- Format × theme presets shipped as portable data (no provider, model id or price) with provenance and evidence-pending status.
- Spend safety: pre-spend estimate, explicit confirmation for generate and analyze, a takes cap, run-scoped request-digest dedupe, and a per-take spend record summed in the run report.
- Audio measurement and loudness normalization via the ffmpeg/ffprobe already used by `voice-gen`: pre-master take checks, two-pass loudnorm to a named delivery profile, and a post-master delivery check.
- A `music-authoring` agent skill and a `music-quality` rubric consumed by the existing `content-judge` skill under its unchanged verdict contract.
- `plugins/kk/workflows/kk-music.yaml` plus the `kk music` CLI noun.
- Docs sync for the new surfaces (04 design, 05 feature pointer, plugin README preset index).

**Out of scope**
- Changing the homelab service, its bind address, exposure or key management.
- Lyria RealTime streaming, stems, extend/cover/remix edits. The self-hosted instance is single-turn only, and those belong to a different provider path.
- Creative mastering (EQ, compression, stereo imaging). "Master" here means loudness and true-peak normalization only.
- Channel loudness profiles (小红书 / B站 / 视频号 or others). Deferred until a publish platform for music is chosen; the delivery-profile config mechanism (0394) lets that later feature add one without code changes.
- Publish/distribution channels for music (podcast/RSS/短视频). A later feature consumes the normalized artifact.
- Multi-tenant auth, per-user quotas, or making the unauthenticated instance public.
- Any claim about audio quality that was not produced by a real paid generation through this pipeline.

## Acceptance Criteria

```gherkin
Feature: Music generation over the homelab Lyria 3 instance

  @core
  Scenario: R1 — A brief renders to the exact request the instance receives
    Given a music brief with technical direction, avoid-list, timestamped structure and lyrics
    When the brief is rendered
    Then the kk prompt text follows the documented segment order and contains neither the duration sentence nor the lyrics header the instance appends
    And every Pro request carries an explicit durationTarget and language, so no instance default applies
    And the prompt text and request fields are byte-for-byte reproducible from the brief alone

  @core
  Scenario: R2 — Presets are portable data and resolution is explicit
    Given format and theme presets plus a brief that overrides two fields
    When the job is resolved
    Then brief values win over preset values and preset values win over built-in defaults
    And no preset file names a provider, an API model id or a price
    And an unknown preset name fails loudly instead of silently falling back

  @core
  Scenario: R3 — No paid call without a shown estimate and confirmation
    Given a resolved job and the configured prices
    When generate or analyze is requested without an explicit confirmation flag
    Then the CLI prints the prompt, the model and the estimated cost and exits non-zero without calling the paid endpoint
    And a re-run of the same request into the same run directory is refused as a duplicate unless forced with a reason

  @core
  Scenario: R4 — Failed measurement blocks the artifact from being treated as done
    Given a generated take and, after normalization, its delivered file
    When the take checks and the delivery check run
    Then a duration miss beyond tolerance, excess silence or missing analysis fails before the judge, and a loudness/true-peak miss against the delivery profile fails after normalization, each with measured values recorded
    And the judge is never invoked on a take with a failing or unmeasured check

  @core
  Scenario: R5 — Provider and transport failures are actionable and never re-billed
    Given the instance returns 401, 402, 429, 502, times out, or does not answer
    When a generation or analysis call fails
    Then the failure names the instance's own error text and the remediation
    And entitlement failures are not retried and only connect-phase failures are retried automatically
    And a timeout after the request was sent is reconciled against the instance library instead of re-sent
    And the offline adapter path performs no network call

  @core
  Scenario: R6 — The workflow runs idea to delivery-ready audio with one human gate
    Given a topic or brief and a configured instance
    When the kk-music workflow runs headlessly
    Then explore, select, analyze, check, judge and master execute in order with artifacts per state
    And explore spends only in the format's own model
    And human input is required only at the selection gate (or skipped by an explicit auto flag with a single take)
    And the run report names every artifact, the spend, the delivery profile measurements and the final verdict

  @core
  Scenario: R7 — The instance is configuration, never committed state
    Given a user config root and environment overrides
    When the plugin resolves its endpoint, timeout, prices and delivery profiles
    Then each comes from user config or an environment override with a documented default
    And no secret, tunnel hostname, or machine-specific path is committed in the plugin tree
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0390 | Ship the kk-music workflow with explore, select, judge and master gates | backlog |
| 0391 | Dogfood one music track end to end and sync the owning docs | backlog |
| 0386 | Author music format and theme presets with a deterministic brief renderer | backlog |
| 0387 | Guard paid generation: pre-spend estimate, run-scoped dedupe and takes cap | backlog |
| 0389 | Author the music-authoring skill and the music quality rubric | backlog |
| 0384 | Define the music brief, preset-resolution and lyria instance adapter contract | backlog |
| 0385 | Ship the music-gen generator plugin: lyria instance adapter, job and Content mapping | backlog |
| 0394 | Measure takes and loudness-normalize to a delivery profile | backlog |
| 0388 | Add the kk music CLI noun over the music-gen plugin | backlog |
<!-- END AUTO-GENERATED -->

## Notes

**Boundary.** The homelab service is the only Lyria 3 surface we own. It holds the provider keys, pays the bill, persists every take as `generations/<id>.json|audio`, and exposes 15 unauthenticated REST routes on the LAN (later behind Cloudflare Access). kk therefore treats it as an external provider service and never re-implements the provider call. `kk` owns steps, presets, spend policy, quality and orchestration; `spur workflow` owns orchestration only (invariant from `docs/03_ARCHITECTURE.md`, "kk owns steps").

**The brief is the interface, and prompt assembly is split.** Lyria 3 has one control surface: the prompt text. There is no structure, tempo, vocal or duration *parameter*, and no `negative_prompt`; exclusions are prompt text (`Avoid: …`). kk renders the PROMPT box text (direction, avoid, structure, instrumental directive). The instance's `assembleLyriaPrompt` appends the Pro duration sentence and the `Lyrics (sing in <LANG>):` block server-side, and it defaults a missing `durationTarget` to `'3:00'` and `language` to `EN` (`homelab/lyria-3-pro/app/server/lyria.ts:9-26,1007-1028`). kk therefore never renders those two segments and always sends both fields explicitly.

**Provider-visible reality to encode, not paper over.**
- Duration is a target: the model may miss it either way. The take check measures the delivered file.
- Single-turn: every "edit" is a new full generation and a new charge, and takes are immutable artifacts.
- Cost is real and per request: Pro `$0.08`, Clip `$0.04`, analysis extra (unpriced in the instance docs). `batchCount` is a recorded label; N takes are N requests.
- Paid calls are non-idempotent: a 30–120 s blocking call that times out may already be billed. Reconcile against the instance library; never blind-retry.
- The instance reports the authoritative format from the returned bytes; OpenRouter returns MP3 for Pro and Clip alike.

**Refinement decisions (2026-11-18).**
1. *Clip is not an exploration proxy for Pro.* It is a different model, fixed at about 30 s, and blind to duration and structure. Clip-explore only breaks even at 2 directions ($0.16 both ways) and saves $0.04 per extra direction, while Pro-explore's pick is already the deliverable. `explore` uses the format's model, and the `promote` state is removed (0390).
2. *Dedupe scope = run directory, digest = rendered request.* Scope lives in the lookup location (`<works>/kk-music/<topic-slug>/`), not in the digest. The instance library is global and is not a dedupe source; it is used only for timeout reconciliation (0385, 0387).
3. *Judge stays unforked.* The music rubric is a new rubric file under `content-judge`. The verdict contract is unchanged (the draft `music-verdict.json` dropped `confidence`, so every existing gate would read its PASS as `PASS!`). Measurements live in `checks.json`, produced by code before the judge runs (0389, 0394).
4. *Audio engineering split into 0394, kept in D8.* All ffmpeg code (measure, take checks, two-pass loudnorm, delivery check) has one owner. This also fixes a gate-order bug: the draft checked delivery loudness on the raw take before master, so every take would have failed.
5. *Loudness target = named delivery profile.* `streaming` (−14 LUFS / −1 dBTP) is the only built-in. Channel profiles are **deferred (2026-11-18)** until the publish platform for music is chosen; that feature measures a real re-served upload and adds the profile in config. If the track is background music under a voice-over, the video mix decides final loudness, not this master.
6. *Spend record = take sidecars.* The 0207 `kk ledger` is a post-run markdown token report from `spur workflow trace` and cannot hold per-call spend or answer a dedupe query.

**Composition with the existing platform.** Generator plugin kind (`Doc[] | Brief → Content`, `format: "audio"` like `voice-gen`). Presets as data files resolved by a pure function (mirroring `image-gen`). The judge as an agent skill (`content-judge`) rather than a plugin kind (ADR-007 amendment). ffmpeg behind an injectable runner (`voice-gen/src/mp3.ts`). Fan-out handled by kk sequential subcommands, because the workflow engine executes one node at a time.

**Deferred.** Publish channels and their loudness profiles, Lyria RealTime, any edit beyond re-generation, creative mastering, and a per-format `explore_model` override (re-open only on evidence that Clip predicts Pro).

**Delivery order and blockers**

1. `0384` brief + render/request + preset-resolution + adapter contract — blocks everything.
2. `0385` music-gen plugin (adapter, reconciliation, sidecar, Content) — blocks 0386/0387/0394.
3. `0386` presets, `0387` spend guard and `0394` measure + normalize — run in parallel after 0385.
4. `0388` `kk music` noun — blocked by 0386/0387/0394; blocks 0389 and 0390.
5. `0389` music-authoring skill + music-quality rubric — blocks 0390. The rubric draft can start once 0394's check record shape is frozen.
6. `0390` kk-music workflow — blocks 0391.
7. `0391` dogfood, evidence, docs sync.

## History

- 2026-11-19T00:14:06.546Z moved Q → D8 (system)

