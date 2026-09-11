---
schema_version: 1
name: Add huggingface backend from wt-image-generate to image-gen
status: done
template: feature-impl
created_at: 2026-09-11T16:54:52.908Z
updated_at: "2026-09-11T21:39:35.151Z"
feature_id: K

---

## 0116. Add huggingface backend from wt-image-generate to image-gen

### Background

wt-image-generate (cc-agents, Python `scripts/image_generator.py`) has a HuggingFace Inference backend; union coverage wants it in kk image-gen.

### Requirements

- R1. Add a `huggingface` registry row (`HUGGINGFACE_API_TOKEN`, default model + `AUTO_ORDER` placement per baoyu/baoyu-frozen order rules) and an adapter ported from wt's `HuggingFaceBackend.generate()`.
- R2. Mocked-fetch tests mirroring wt's request/response shape.
- R3. wt plugin keeps its own runtime (Python skill untouched) — no behavioral coupling beyond the shared backend contract.

#### Acceptance Criteria
```gherkin
Scenario: R1 — huggingface is first-class
  Given HUGGINGFACE_API_TOKEN is set and other provider keys absent
  When a generation runs
  Then huggingface is selected and emits bytes via the wt-derived wire call
```

### Acceptance Criteria

```gherkin
Scenario: R1 — huggingface is first-class
  Given HUGGINGFACE_API_TOKEN is set and other provider keys absent
  When a generation runs
  Then huggingface is selected and emits bytes via the wt-derived wire call
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

HuggingFace Inference backend ported from wt-image-generate.

- `plugins/generations/image-gen/src/providers/huggingface.ts` — new adapter: POST {inputs, parameters:{width,height,num_inference_steps}} to https://api-inference.huggingface.co/models/<model> (wt scripts/image_generator.py:142 wire shape); 200 → raw bytes + content-type-derived extension (png default), 503 → loud model-loading error, others loud; `hf:` model prefix supported; text-to-image only (`supportsReferenceImages=false`, wt parity).
- `plugins/generations/image-gen/src/providers/types.ts` — registry row `huggingface` (env HUGGINGFACE_API_TOKEN, default stabilityai/stable-diffusion-xl-base-1.0) + AUTO_ORDER prepend `huggingface` (before google, mirroring wt primary/fallback order).
- `plugins/generations/image-gen/tests/providers/huggingface.test.ts` — payload/wire-shape, token gate, 200/503/401 behaviors, auto-selection (13 total tests incl. providers.test.ts registry growth to 13).
- Evidence: 854 pass / 0 fail across 63 files; `bun run lint` exit 0; commit `7e1f186`.

### Plan

HuggingFace Inference backend ported from wt-image-generate.

- `plugins/generations/image-gen/src/providers/huggingface.ts` — new adapter: POST {inputs, parameters:{width,height,num_inference_steps}} to https://api-inference.huggingface.co/models/<model> (wt scripts/image_generator.py:142 wire shape); 200 → raw bytes + content-type-derived extension (png default), 503 → loud model-loading error, others loud; `hf:` model prefix supported; text-to-image only (`supportsReferenceImages=false`, wt parity).
- `plugins/generations/image-gen/src/providers/types.ts` — registry row `huggingface` (env HUGGINGFACE_API_TOKEN, default stabilityai/stable-diffusion-xl-base-1.0) + AUTO_ORDER prepend `huggingface` (before google, mirroring wt primary/fallback order).
- `plugins/generations/image-gen/tests/providers/huggingface.test.ts` — payload/wire-shape, token gate, 200/503/401 behaviors, auto-selection (13 total tests incl. providers.test.ts registry growth to 13).
- Evidence: 854 pass / 0 fail across 63 files; `bun run lint` exit 0; commit `7e1f186`.

### Solution

HuggingFace Inference backend ported from wt-image-generate.

- `plugins/generations/image-gen/src/providers/huggingface.ts` — new adapter: POST {inputs, parameters:{width,height,num_inference_steps}} to https://api-inference.huggingface.co/models/<model> (wt scripts/image_generator.py:142 wire shape); 200 → raw bytes + content-type-derived extension (png default), 503 → loud model-loading error, others loud; `hf:` model prefix supported; text-to-image only (`supportsReferenceImages=false`, wt parity).
- `plugins/generations/image-gen/src/providers/types.ts` — registry row `huggingface` (env HUGGINGFACE_API_TOKEN, default stabilityai/stable-diffusion-xl-base-1.0) + AUTO_ORDER prepend `huggingface` (before google, mirroring wt primary/fallback order).
- `plugins/generations/image-gen/tests/providers/huggingface.test.ts` — payload/wire-shape, token gate, 200/503/401 behaviors, auto-selection (13 total tests incl. providers.test.ts registry growth to 13).
- Evidence: 854 pass / 0 fail across 63 files; `bun run lint` exit 0; commit `7e1f186`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — huggingface is first-class | MET | registry row + AUTO_ORDER prepend in plugins/generations/image-gen/src/providers/types.ts; adapter ported from wt HuggingFaceBackend (huggingface.ts); selectProvider picks huggingface when only its token present (huggingface.test.ts) |
| R2 — mocked-fetch tests mirror wt wire shape | MET | plugins/generations/image-gen/tests/providers/huggingface.test.ts — payload {inputs, parameters:{width,height,num_inference_steps}}, bearer header, 200 bytes / 503 model-loading / 401 loud errors via injected fetch |
| R3 — wt runtime untouched | MET | no edits under /Users/robin/.agents/skills/wt-image-generate; only git-tracked knowledge-kit files changed (commit 7e1f186) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | bun test apps packages plugins scripts | — |  |
| P4 | bun run lint | — |  |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-11T16:55:17.924Z backlog → todo (system)
- 2026-09-11T21:36:06.367Z todo → wip (system)
- 2026-09-11T21:39:30.547Z wip → testing (system)
- 2026-09-11T21:39:35.151Z testing → done (system)

