---
schema_version: 1
name: "Live smoke: publish a fixture episode to the deployed instance"
status: done
template: feature-impl
created_at: 2026-09-02T19:04:38.675Z
updated_at: "2026-09-03T00:17:56.405Z"
feature_id: E6
priority: P2
tags: ["verification", "live", "microfeed"]
dependencies: ["0084", "0085"]
done_forced: "true"
done_reason: "PARTIAL is the designed terminal state for this drift-check task: R1/R3 MET, R2 PARTIAL (plugin delete-op vs Astro 7 checkOrigin) — task Q&A decided drift = record + follow-up, and 0087 carries the fix with full request/response evidence. Verification work complete: validate/get live-ok, fixture published + removed, feed present-then-absent verified."
---

## 0086. Live smoke: publish a fixture episode to the deployed instance

### Background

Feature E6 live verification, after deployment (credentials in config) and plugin build. Run podcast-pub once against the real instance: validate a draft item, publish a small fixture audio episode, confirm the item appears in the public JSON Feed, then delete the fixture via the management op. This is the drift check between the vendored API contract and the deployed version.

### Requirements

- [x] R1. (feature R3, live) A fixture episode publishes end-to-end against the deployed instance via podcast-pub's `publish` operation and appears in `<MICROFEED_BASE_URL>/json/`.
- [ ] R2. (feature R4, live) Management ops verified live: `validate` a draft item before publish, `get` the created item, `delete` it afterward, and confirm removal from the feed.
- [x] R3. Any contract drift between `vendors/microfeed` and the deployed version surfaced during the run is recorded as a follow-up fix task (with the observed request/response evidence); the run does not silently work around drift.

**Non-goals (explicit out-of-scope):** no new plugin code (fixes belong to follow-up tasks); no CI wiring of live checks; no custom-domain verification (not bound yet).

### Acceptance Criteria

```gherkin
Scenario: R3 — podcast-pub publishes a podcast episode with audio to microfeed
  Given 0084's credentials in ~/.config/kk/config.yaml and the 0085-built plugin
  When the publish operation runs with fixture Content carrying a local audio file
  Then the Result JSON has ok true with the item id and URL
  And the episode appears in the instance's public JSON Feed with an audio enclosure

Scenario: R4 — podcast-pub provides simple management operations over the REST API
  Given the published fixture item from the publish step
  When get and delete operations run against the live instance
  Then get returns the item's fields and delete removes it from the public JSON Feed
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-02T21:04:37.475Z

- **Fixture generated, not committed** — chosen: a throwaway `/tmp` WAV keeps the repo clean and the smoke self-contained. Deferred: a shared test-fixture asset library, if more live-smoke tasks appear.
- **Drift handling = record + follow-up task** — chosen over inline patching: a fix inside a verification task would mix two tasks' evidence into one diff.

### Design

WHAT: one gated live verification run of podcast-pub against the deployed microfeed instance — validate → publish fixture → confirm in JSON Feed → get → delete.

WHY: CI must never depend on the operator's instance (design D7); this task is the single deliberate live check, and its failure output is a drift report, not a silent skip.

WHERE: runs from the repo root using the built `plugins/publishings/podcast-pub/` (0085) and credentials from `~/.config/kk/config.yaml` (0084); writes evidence into this task's `## Solution`/`## Testing` only.

**Frozen names:**

- Invocation: `kk executor run podcast-pub --in <content.json> --out <result.json>` (house plugin-invoke surface; see `docs/design/kk-cli-surface.md`) with `options.operation` ∈ `validate` → `publish` → `get` → `delete`.
- Fixture audio: any small local WAV/MP3. Suggested generation (macOS, no repo pollution): `afconvert -f WAVE -d LEI16 /System/Library/Sounds/Ping.aiff /tmp/kk-fixture.wav`.
- Fixture Content: `{ "title": "kk smoke fixture", "body": "Smoke test episode — safe to delete.", "metadata": { "audioFile": "/tmp/kk-fixture.wav", "mimeType": "audio/wav", "status": "published" } }` written to a temp file, never committed.
- Evidence captured: each step's `Result` JSON (`ok`, `url`, `id`) + `curl -s <base>/json/ | jq` excerpt showing the fixture item present (and absent after delete).

**Anti-patterns (do not):**

- Do not "fix" the plugin inline when drift appears — record evidence, file a follow-up task (drift fix is new scope).
- Do not leave the fixture item published; the delete step is mandatory.
- Do not paste `MICROFEED_API_KEY` into the task file, logs, or evidence.

**Cross-task contract:** assumes 0084 left working `MICROFEED_BASE_URL` + write-scope `MICROFEED_API_KEY` in user config, and 0085 shipped the plugin with `publish`/`validate`/`get`/`delete`. Leaves the future news→podcast workflow a verified publish target; owns nothing further.

### Plan

- [ ] 1. Generate fixture audio (`afconvert … /tmp/kk-fixture.wav`) and fixture Content JSON in a temp dir.
- [ ] 2. `validate` op against the live instance → expect `ok: true`.
- [ ] 3. `publish` op with the fixture Content → capture `Result` (`ok: true`, `url`, `id`).
- [ ] 4. Confirm the item appears in `<MICROFEED_BASE_URL>/json/` with the audio enclosure URL.
- [ ] 5. `get` the item by id → confirm fields; `delete` it → confirm removal from `/json/`. (verification intent: presence AND clean removal, not just publish)
- [ ] 6. On any contract mismatch: record request/response evidence and file a follow-up task instead of patching.
- [ ] 7. Write evidence (Result JSONs, curl excerpts) into `## Testing`; note instance version/URL in `## Solution`.

### Solution

Live verification only — no repo code changed (non-goal). All steps ran from the repo root via the house invoke surface `kk executor run podcast-pub --in <content.json> --out <result.json>` with `options.operation` ∈ validate → publish → get → delete; credentials from `~/.config/kk/config.yaml:36-39` injected by the executor; fixture WAV (`afconvert`, 292,388 bytes) and Content JSON kept in `/tmp`, never committed.

Instance under test: microfeed 1.0.9 at <https://podcast.salty.vip> (custom domain; worker `feed-gobing-ai`; media on podcast-media.salty.vip). Plugin: `plugins/publishings/podcast-pub/` as built by 0085 (dist bundle). Drift surfaced: one — plugin `delete` op vs Astro 7 checkOrigin; evidence recorded below, follow-up task 0087 filed (`docs/tasks/0087_fix-podcast-pub-delete-op-vs-astro-7-cross-origin-guard-add-.md`). Root cause chain: `plugins/publishings/podcast-pub/src/microfeed-client.ts:135-140` sends DELETE with no headers → Astro 7 `checkOrigin` (`node_modules/astro/dist/core/app/origin-check.js:12-23`) rejects header-less non-safe methods unless same-origin → 403.

### Testing

**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 — fixture publishes end-to-end via podcast-pub `publish` and appears in `<MICROFEED_BASE_URL>/json/` | MET | command |
| R2 — management ops verified live: validate, get, delete + removal from feed | PARTIAL | command |
| R3 — drift recorded as follow-up with request/response evidence, no silent workaround | MET | command |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R3 — podcast-pub publishes a podcast episode with audio to microfeed | MET | command | publish ok:true id YMwzVRyodKm url <https://podcast.salty.vip/items/YMwzVRyodKm>; /json/ showed item + attachment <https://podcast-media.salty.vip/production/media/audio-abcf1> |
| R4 — podcast-pub provides simple management operations over the REST API | PARTIAL | command | get op returned item fields (ok:true); delete op 403 (Astro 7 origin-check; microfeed-client.ts:135-140); DELETE + Content-Type: application/json → 200 {}, /json/ 0 items; client fix = task 0087 |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PARTIAL)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

- Feature: E6 (`docs/features/E6_microfeed-podcast-publisher.md`)
- Design satellite: `docs/design/podcast-pub.md` (§6 verification)
- Depends on: 0084 (credentials in config), 0085 (plugin built)
- Plugin invoke surface: `docs/design/kk-cli-surface.md`

### History

- 2026-09-03T00:09:22.107Z todo → wip (system)
- 2026-09-03T00:17:01.804Z wip → testing (system)
- 2026-09-03T00:17:56.351Z testing → done (system)
