---
schema_version: 1
name: "Fix podcast-pub delete op vs Astro 7 cross-origin guard (add Content-Type)"
status: todo
template: feature-impl
created_at: 2026-09-03T00:14:51.006Z
updated_at: "2026-09-03T00:15:41.307Z"
feature_id: E6
---

## 0087. Fix podcast-pub delete op vs Astro 7 cross-origin guard (add Content-Type)

### Background

Astro 7 `checkOrigin` (node_modules/astro/dist/core/app/origin-check.js): any non-safe method **without a `content-type` header** is rejected unless `Origin === url.origin`. The plugin's `deleteItem` sends DELETE with no headers; Bun fetch sends no `Origin`, so `!isSameOrigin` → 403. Every other op (POST/PUT with JSON content-type) passes because JSON is not form-like.

Observed live (2026-09-02, instance <https://podcast.salty.vip>, microfeed 1.0.9 / Astro 7.1.6):

- plugin op: `kk executor run podcast-pub` delete → `Result ok:false, HTTP 403 Forbidden /api/v1/items/YMwzVRyodKm: Cross-site DELETE form submissions are forbidden`
- identical request + `Content-Type: application/json` via curl (-L) → `200 {}`, item removed from `/json/` (feed went 1 → 0 items)

### Requirements

- [ ] R1. `plugins/publishings/podcast-pub/src/microfeed-client.ts` `deleteItem` sends `Content-Type: application/json` so Astro 7 checkOrigin passes (same fix pattern as other methods).
- [ ] R2. Offline unit test covers delete headers; live re-verified: delete op removes a published test item from `/json/`.

### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
