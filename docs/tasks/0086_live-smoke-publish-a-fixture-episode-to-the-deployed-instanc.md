---
schema_version: 1
name: "Live smoke: publish a fixture episode to the deployed instance"
status: todo
template: feature-impl
created_at: 2026-09-02T19:04:38.675Z
updated_at: "2026-09-02T21:04:37.642Z"
feature_id: E6
priority: P2
tags: ["verification", "live", "microfeed"]
dependencies: ["0084", "0085"]
---

## 0086. Live smoke: publish a fixture episode to the deployed instance

### Background

Feature E6 live verification, after deployment (credentials in config) and plugin build. Run podcast-pub once against the real instance: validate a draft item, publish a small fixture audio episode, confirm the item appears in the public JSON Feed, then delete the fixture via the management op. This is the drift check between the vendored API contract and the deployed version.

### Requirements

- [ ] R1. (feature R3, live) A fixture episode publishes end-to-end against the deployed instance via podcast-pub's `publish` operation and appears in `<MICROFEED_BASE_URL>/json/`.
- [ ] R2. (feature R4, live) Management ops verified live: `validate` a draft item before publish, `get` the created item, `delete` it afterward, and confirm removal from the feed.
- [ ] R3. Any contract drift between `vendors/microfeed` and the deployed version surfaced during the run is recorded as a follow-up fix task (with the observed request/response evidence); the run does not silently work around drift.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: E6 (`docs/features/E6_microfeed-podcast-publisher.md`)
- Design satellite: `docs/design/podcast-pub.md` (§6 verification)
- Depends on: 0084 (credentials in config), 0085 (plugin built)
- Plugin invoke surface: `docs/design/kk-cli-surface.md`

### History
