---
schema_version: 1
name: Absorb evidence-guided image style presets
status: wip
template: feature-impl
created_at: 2026-11-15T23:58:33.894Z
updated_at: "2026-11-16T00:08:12.307Z"
feature_id: K3

estimate_hours: 8
ac_altitude: task-local
ac_numbering: task-local
---

## 0380. Absorb evidence-guided image style presets

### Background

Implements: R1 — Negative style constraints reach the provider prompt; R2 — Styles without negative constraints keep their composed prompts; R3 — Six candidate presets are portable and traceable; R4 — Image authoring explores before committing to a direction; R5 — Only generation-reviewed candidates join the shipped gallery.

The 2026-11-15 source review found that `StylePreset.negative` is populated but inert: `composePrompt` emits only `style.modifiers` (`plugins/generations/image-gen/src/presets.ts:255-262`) and the request at `plugins/generations/image-gen/src/index.ts:415-421` does not carry it. The stub-provider reproduction returned `negative: null` and no `avoid:` prompt segment. The sample gallery scales as formats × styles (`plugins/generations/image-gen/scripts/gen-samples.ts:124-129`), so unreviewed bulk import is intentionally rejected.

Upstream is `vendors/open-image-prompts` commit `0e8da2c8d317ec517af75f5bbf3a76124cfff5b1` (MIT for Skill instructions; third-party corpus excluded). All 39 cards are generation-pending, seven are experimental, and twelve have empty reference sections; imported cards therefore remain hypotheses until K3's generation comparison. `notion-editorial-line-art` is explicitly treated as authored-unverified rather than inheriting an unsupported corpus-reviewed claim.

Provider probes ran through `KK_IMAGE_DRY_RUN=1 kk executor run image-gen`: MiniMax `image-01` exited 0; google, seedream, openai, dashscope, replicate, openrouter, zai, azure, agnes, jimeng, huggingface, and codex-cli were unavailable. The operator explicitly selected MiniMax-only evaluation. Four pairwise cells per candidate are therefore two formats × two subjects, not two providers.

Rubric: E2 D1 L1 C1 R2 = 7 → decomposition considered; kept one cohesive task under the cohesion-first rule because the composer, preset inventory, evaluation, and gallery tests form one diff and review context. Estimate: 8h, within the target band; no child batch.

### Requirements

- [ ] R1. Add one `avoid: <negative>` segment after style modifiers and before caller extra whenever `StylePreset.negative` is declared, and prove it reaches the provider through the real plugin path.
- [ ] R2. Preserve byte-for-byte prompt output for styles without `negative`, including the existing cover × editorial golden prompt.
- [ ] R3. Convert `limited-ink-risograph-editorial`, `layered-papercraft-diorama`, `minimalist-ink-wash-negative-space`, `notion-editorial-line-art`, `product-exploded-identity`, and `handcrafted-clay-character` into portable, attributed, generation-pending evaluation presets; dry-run all six.
- [ ] R4. Update `image-authoring` so unclear directions produce two or three visibly different choices with tradeoffs, then one primary style with user constraints taking precedence.
- [ ] R5. Run the approved MiniMax-only blind A/B gate (two formats × two subjects), promote only candidates with zero critical violations and at least three wins in four cells, generate six real samples per promoted style, and preserve an evaluation report with rejected candidates and no cross-provider claim.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Negative style constraints reach the provider prompt (req: R1)
  Given a style preset declares `negative: watermark, logo` and caller extra text
  When an image job is composed and executed through the real plugin path
  Then the provider receives one `avoid: watermark, logo` segment after the style modifiers and before the caller extra

Scenario: AC2 — Styles without negative constraints keep their composed prompts (req: R2)
  Given a format and style with no `negative` value and a golden composed prompt
  When the prompt is rendered
  Then its text is byte-for-byte unchanged and contains no `avoid:` segment

Scenario: AC3 — Six candidate presets are portable and traceable (req: R3)
  Given the six selected Open Image Prompts cards
  When their evaluation presets are loaded and dry-run through image-gen
  Then all six are schema-valid subject-neutral styles with no unexpanded card placeholders or aspect-ratio overrides
  And their provenance names the upstream project, revision, license, references, and generation-pending status

Scenario: AC4 — Image authoring explores before committing to a direction (req: R4)
  Given an image request whose visual direction is unclear
  When the image-authoring guidance is followed
  Then it offers two or three visibly different styles with one-sentence tradeoffs and waits for a choice
  And it uses one primary style while preserving explicit user constraints

Scenario: AC5 — Only generation-reviewed candidates join the shipped gallery (req: R5)
  Given the six candidates and their closest existing-style baselines
  When each pair is compared on two formats and two subjects with MiniMax image-01 using randomized blind review
  Then every promoted style has zero critical constraint violations and wins at least three of four pairwise cells
  And the evaluation report records exact prompts, provider, model, images, scores, and rejected candidates
  And every promoted style has one real sample for each of the six shipped formats
  And cross-provider quality remains explicitly unclaimed
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-16T00:00:50.935Z

- Q: Which provider should be used now that only MiniMax is configured? A: The operator selected **Use MiniMax only (Recommended)**. Use two formats × two subjects for four pairwise cells per candidate; defer all cross-provider claims.
- Q: Can upstream `corpus-reviewed` be treated as generation validation? A: No. Every imported candidate starts generation-pending. `notion-editorial-line-art` is additionally marked authored-unverified because its upstream reference section is empty.
- Q: Should native provider negative-prompt capabilities be added? A: No. Implement the existing provider-independent `avoid:` fallback in the shared composer; do not add a capability matrix in this task.

### Design

- Approach: make the smallest shared-composer change: body → format keywords → style modifiers → optional `avoid: …` → caller extra. This implements the existing 0102 fallback contract for every provider without adding a provider-capability abstraction. Native negative-prompt wiring remains untouched.
- Candidate evaluation: author the six YAML files in an isolated preset root under `.works/tmp/k3-style-eval/` and inject them with `KK_IMAGE_PRESET_PATH`; only accepted candidates are copied into `presets/styles/`. Add winner contract tests before the production YAML, then generate the required gallery through MiniMax.
- Provenance: add `plugins/generations/image-gen/presets/SOURCE.md` naming upstream URL/revision/MIT license, per-card reference IDs and evidence status. Keep third-party prompts and images out of the repository.
- Evaluation: reuse the real `kk executor run image-gen` path and fixed envelopes. Compare each candidate with its closest existing style on two formats × two subjects, randomize pair labels, and retain exact prompts, images, scores, and rejections. MiniMax `image-01` is the only approved provider; no portability claim.
- Rejected: bulk-importing all 39 cards; automatically serializing documentary fields into every existing prompt; provider-specific negative-capability plumbing; adding Python/SQLite/React infrastructure; importing third-party corpus content; new formats or schema fields.
- Invariants: styles without `negative` render byte-identically; the cover × editorial golden remains unchanged; format/user variables own subject and aspect ratio; compose-format text-free checks remain intact; no sample is hand-created or sourced from upstream.
- Design satellite: skipped — no new command, schema, module boundary, or transport; this is an internal composer fix plus preset content and evaluation.

### Plan

1. [x] Add a failing negative-prompt regression and golden-prompt preservation check, then implement the shared-composer fix and update `docs/04_DESIGN.md`.
2. [x] Author the six candidate presets and `presets/SOURCE.md`; validate every candidate with a real dry run.
3. [x] Add two-phase direction-selection guidance to `image-authoring`.
4. [ ] Build a repeatable MiniMax evaluation artifact, run the blind A/B comparison, and record accepted and rejected candidates with evidence.
5. [ ] Add winner contract tests before promoting their YAML, then generate the real sample gallery and update the README.
6. [ ] Run focused checks and the full project gate, review the diff, record verification through Spur, and sync the feature status.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: `docs/features/K3_evidence-guided-image-style-presets.md`
- Upstream source: `vendors/open-image-prompts` at `0e8da2c8d317ec517af75f5bbf3a76124cfff5b1`; MIT License, Copyright 2026 NanmiCoder.
- Style cards: `vendors/open-image-prompts/skills/img-gen-taste/references/`.
- Existing preset contract: `plugins/generations/image-gen/src/presets.ts`; task 0102.
- Known negative-prompt finding: task 0181 Review finding 1.
- Gallery contract: `plugins/generations/image-gen/scripts/gen-samples.ts`; feature K1.
- Provider decision: operator approved MiniMax-only evaluation after dry-run probes found no second configured provider.

### History

- 2026-11-16T00:01:02.347Z backlog → todo (system)
- 2026-11-16T00:01:30.113Z todo → wip (system)

