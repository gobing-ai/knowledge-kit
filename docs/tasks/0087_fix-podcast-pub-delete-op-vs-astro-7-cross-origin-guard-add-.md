---
schema_version: 1
name: "Fix podcast-pub delete op vs Astro 7 cross-origin guard (add Content-Type)"
status: done
template: feature-impl
created_at: 2026-09-03T00:14:51.006Z
updated_at: "2026-09-03T02:08:18.553Z"
feature_id: E6
---

## 0087. Fix podcast-pub delete op vs Astro 7 cross-origin guard (add Content-Type)

### Background

Astro 7 `checkOrigin` (node_modules/astro/dist/core/app/origin-check.js): any non-safe method **without a `content-type` header** is rejected unless `Origin === url.origin`. The plugin's `deleteItem` sends DELETE with no headers; Bun fetch sends no `Origin`, so `!isSameOrigin` → 403. Every other op (POST/PUT with JSON content-type) passes because JSON is not form-like.

Observed live (2026-09-02, instance <https://podcast.salty.vip>, microfeed 1.0.9 / Astro 7.1.6):

- plugin op: `kk executor run podcast-pub` delete → `Result ok:false, HTTP 403 Forbidden /api/v1/items/YMwzVRyodKm: Cross-site DELETE form submissions are forbidden`
- identical request + `Content-Type: application/json` via curl (-L) → `200 {}`, item removed from `/json/` (feed went 1 → 0 items)

### Requirements
- [x] R1. `plugins/publishings/podcast-pub/src/microfeed-client.ts` `deleteItem` sends `Content-Type: application/json` so Astro 7 checkOrigin passes (same fix pattern as other methods).
- [x] R2. Offline unit test covers delete headers; live re-verified: delete op removes a published test item from `/json/`.
### Acceptance Criteria
```gherkin
Scenario: R4 — podcast-pub provides simple management operations over the REST API
  Given the 0087-fixed plugin and 0084's live instance
  When a published test item is deleted via the delete operation
  Then the operation reports ok true and the item disappears from the public JSON Feed

Scenario: R1 — delete requests carry Content-Type: application/json
  Given the podcast-pub offline test suite
  When the delete operation runs against the fake transport
  Then the captured DELETE request carries Content-Type: application/json
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
WHAT: one-line fix — `deleteItem` sends `Content-Type: application/json`, the same pattern as createItem/validateItem/updateItem; plus one header assertion in the existing delete test.

WHY: Astro 7 `checkOrigin` rejects non-safe methods without a Content-Type unless Origin matches; Bun fetch sends no Origin, so the headerless DELETE got 403. A JSON Content-Type makes the request non-form-like and passes the guard (confirmed live in 0086: identical request + header via curl → 200, item removed).

WHERE: `plugins/publishings/podcast-pub/src/microfeed-client.ts` (`deleteItem`) and `plugins/publishings/podcast-pub/tests/podcast-pub.test.ts` (the delete test). Nothing else.

**Invariants:** DELETE stays bodyless — only the header is added; the live 0086 curl evidence proves the header alone passes checkOrigin. No other ops touched.

**Anti-patterns (do not):** do not spoof an Origin header (wrong layer); do not special-case delete in the transport layer; do not patch the vendored microfeed server.
### Plan
- [x] 1. `microfeed-client.ts` `deleteItem`: add `headers: { 'Content-Type': 'application/json' }`.
- [x] 2. Delete test: assert the captured DELETE carries `Content-Type: application/json` (offline).
- [x] 3. `bun test plugins/publishings/podcast-pub` + `bun run lint` green.
- [x] 4. Live: publish a fixture episode → present in `/json/` → delete via plugin → absent from `/json/`. (verification intent: full lifecycle, not just a 200)
### Solution
- `plugins/publishings/podcast-pub/src/microfeed-client.ts:139-144` — `deleteItem` now sends `Content-Type: application/json` on the bodyless DELETE (header alone passes Astro 7 checkOrigin, per the 0086 live curl evidence); doc comment cites the guard.
- `plugins/publishings/podcast-pub/tests/podcast-pub.test.ts:381-402` — delete test retitled and now asserts the captured request carries `Content-Type: application/json` (offline, via the `installFakeApi` header capture).

Live proof (2026-09-02, instance https://podcast.salty.vip): fixture `ttOqXVDwskR` published (ok:true) → present in `/json/` → deleted via the plugin's delete op (ok:true, exit 0) → absent from `/json/` (`items=[]`). Fixture never committed; `/tmp` files removed.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/publishings/podcast-pub/src/microfeed-client.ts:139-144` — deleteItem sends `Content-Type: application/json` on the bodyless DELETE (re-read after edit); live 2026-09-02: `kk executor run podcast-pub` delete op on published item ttOqXVDwskR → {"ok":true,"message":"Deleted microfeed item ttOqXVDwskR"}, exit 0 (was HTTP 403 pre-fix) |
| R2 | MET | Offline: `plugins/publishings/podcast-pub/tests/podcast-pub.test.ts:381-402` asserts the captured DELETE carries `Content-Type: application/json` (:397); `bun test plugins/publishings/podcast-pub` → 24 pass / 0 fail / 105 expects (2026-09-02). Live: publish ttOqXVDwskR ok:true → `/json/` items=[ttOqXVDwskR] → plugin delete ok:true → `/json/` items=[] (2026-09-02) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R4 — podcast-pub provides simple management operations over the REST API | MET | command | Live 2026-09-02: `kk executor run podcast-pub` publish → ok:true id ttOqXVDwskR, present in /json/; delete op → ok:true exit 0; /json/ → items=[] after delete |
| R1 — delete requests carry Content-Type: application/json | MET | test | `plugins/publishings/podcast-pub/tests/podcast-pub.test.ts:397` header assertion green in the 24/24 suite run (2026-09-02) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
<!-- spur:record-review -->

**SECU findings** (verify 2026-09-02 — verdict: PASS; full live lifecycle green: publish → present → delete → absent)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check PASS (one accepted DD-09 subset WARN for the task-local R1 scenario); `bun run lint` (biome + typecheck) exit 0 repo-wide (2026-09-02) |
| P4 | evidence-rule-pass | — | Both AC rows carry fresh executable evidence: live publish→delete→absent cycle on the real instance + offline Content-Type header assertion |
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-09-03T02:03:35.966Z todo → wip (system)
- 2026-09-03T02:06:39.252Z wip → testing (system)
- 2026-09-03T02:08:18.553Z testing → done (system)
