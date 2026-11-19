---
schema_version: 1
name: "Ship the music-gen generator plugin: lyria instance adapter, job and Content mapping"
status: backlog
template: feature-impl
created_at: 2026-11-18T22:16:14.376Z
updated_at: "2026-11-19T03:55:02.031Z"
feature_id: D8

ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 10
dependencies: ["0397"]
---

## 0398. Ship the music-gen generator plugin: lyria instance adapter, job and Content mapping

### Background

Implements: R1 — plugin contract; R2 — live adapter with non-idempotent paid-call policy; R3 — cache-first analyze; R4 — offline adapter; R5 — Content mapping; R6 — artifact + take sidecar; R7 — CI-safe tests.

0397 freezes the brief, render order and adapter contract; this task ships the plugin that implements them. Precedent: `image-gen` (`plugins/generations/image-gen/src/index.ts`) is a `kind: generator` plugin with provider adapters under `src/providers/`, a pure preset composer, and a first-class dry-run path (`KK_IMAGE_DRY_RUN`) that keeps the whole suite offline; `voice-gen` proves audio output is a legal generator result — `Content.format = 'audio'` with the artifact path carried alongside (`plugins/generations/voice-gen/src/index.ts:351`).

The instance is an external service, so the adapter is the only place that knows HTTP. Everything downstream (CLI, workflow, judge) sees a typed job in and a typed artifact out.

### Requirements

- [ ] R1. Ship `plugins/generations/music-gen` as a `kind: generator` plugin: `plugin.json` (`name`, `kind`, `entry: ./src/index.ts`, version, description), `package.json`, `tsconfig.json`, a README stub, and `runtime.requires` annotated per 0342 so `kk plugins check` validates it.
- [ ] R2. Implement the live adapter against the 0397 contract: `POST /api/lyria/generate`, `GET /api/generations`, `POST /api/ai/analyze`; base URL from user config with an environment override; a generation timeout sized for a 30–120 s blocking call; the audio format and instance generation id read from the response. Apply the 0397 non-idempotent policy exactly: retry only on connect-phase failures, treat `401/402/403/404/429` and all-keys-rejected `502` as terminal, and reconcile against `GET /api/generations` after a timeout, socket reset or other `5xx`.
- [ ] R3. Make `analyze` cache-first: read the take's instance manifest (via `GET /api/generations`) and return the cached `analysis` when present. Only call the paid `POST /api/ai/analyze` when no analysis is cached. The instance caches analysis per generation (`app/docs/guide/03-api-integration.md:68`), so a second paid analysis is pure waste.
- [ ] R4. Implement the offline adapter (`KK_MUSIC_DRY_RUN=1`). It returns a deterministic short silent WAV and a synthetic manifest/analysis with zero network calls, and it is the default for the test suite.
- [ ] R5. Map a resolved job onto the generator contract: `Content` with `format: 'audio'`; a body that carries liner notes (kk prompt text, lyrics, duration target, model, instance provider, instance id, analysis summary when present); and `references` pointing at the instance audio URL plus the kk sidecar path. Request echoes (`language`, `durationTarget`, `batchCount`) survive into metadata exactly as the instance recorded them, and are treated as absent (never defaulted) when the manifest lacks them.
- [ ] R6. Persist one artifact per take into the job's run directory with deterministic naming, plus one sidecar per take (request digest from 0397, instance id, model, unit price charged, adopted-by-reconciliation flag). Never mirror the instance's `generations/` library into a kk workspace.
- [ ] R7. Cover the adapter with tests that run offline: success, format detection, manifest mapping, cache-first analyze, each terminal status, connect-refused retry bound, timeout → reconciliation adopt, timeout → reconciliation miss → fail, and malformed JSON. No network, no paid call, runnable in the repo's normal test target.

### Acceptance Criteria

```gherkin
Scenario: AC1 — The plugin is discoverable and checkable (req: R1)
  Given the plugin tree and its manifest
  When kk plugins list and kk plugins check run
  Then music-gen appears under the generator kind with entry ./src/index.ts
  And its declared runtime requirements match what the code imports

Scenario: AC2 — One take round-trips through the adapter (req: R2, R5)
  Given a stubbed instance that answers 200 with an MP3 body and a manifest
  When the plugin executes a confirmed one-take job
  Then exactly one POST /api/lyria/generate is made with the kk prompt text, lyrics and request fields from 0397
  And the returned Content has format audio, an artifact on disk, the instance generation id, and the format detected from the returned bytes
  And language, durationTarget and batchCount are echoed exactly as the manifest records them, absent when absent

Scenario: AC3 — Analysis is paid at most once per take (req: R3)
  Given a take whose instance manifest already carries analysis
  When analyze runs
  Then no POST /api/ai/analyze is made and the cached analysis is returned
  And for a take without cached analysis exactly one POST /api/ai/analyze is made

Scenario: AC4 — The offline adapter performs no network call (req: R4)
  Given KK_MUSIC_DRY_RUN=1
  When any generate, list or analyze operation runs
  Then a deterministic silent WAV, synthetic manifest and synthetic analysis are produced
  And no socket is opened and no HTTP stub is needed for the test to pass

Scenario: AC5 — A paid request is never re-sent on an ambiguous outcome (req: R2, R7)
  Given a stubbed instance that answers 401, 402, 429, all-keys-rejected 502, connection refused then 200, and a timeout
  When each case runs
  Then 401/402/429/502 fail immediately with the instance's own error text and a remediation, with one request sent
  And connection refused retries within the bounded attempt count
  And the timeout sends no second generate and instead queries GET /api/generations
  And a matching library take is adopted and flagged adopted, while no match fails with a diagnostic that names the endpoint, the elapsed time and the --force remediation

Scenario: AC6 — The workspace boundary is respected (req: R6)
  Given a run directory and a two-take job
  When the takes are persisted
  Then exactly two audio files and two sidecars exist, each sidecar carrying digest, instance id, model and unit price
  And the instance library was read only through its API, not copied
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- **One provider, not many.** `image-gen` needs a provider registry because it fronts nine backends. Here there is one backend (`lyria-instance`) plus `offline`, so a registry would be speculative. Model choice is `pro|clip`, resolved by the instance, and stays out of preset data (feature R2).
- **`fetch`, no SDK.** The instance is plain JSON over HTTP, so a client dependency buys nothing. Keep the request/response types in `src/adapter/instance.ts` next to the mapping tests.
- **No second failover layer.** The instance already tries its key list in order and refuses to fail over on request-level errors "so the account is not billed twice" (`app/docs/guide/04-app-integration.md:53`). kk's adapter adds only connect-phase retry and post-send reconciliation.
- **Reconciliation match.** A library take matches when its `prompt` equals kk's sent prompt text byte for byte, its `model` matches, and its `generatedAt` ≥ the request start time. When several takes match, adopt the earliest and record the rest in the sidecar as `unclaimed` so the operator can see the extra spend.
- **Takes are a client loop.** `takes: N` issues N sequential requests, and each persists or fails independently. A failure on take k leaves takes 1..k-1 on disk for resume (0400 dedupe skips them).
- **Artifact naming.** `<slug>-<model>-<instanceId>.<ext>` keeps every take traceable to the instance library by id, and two takes of the same brief cannot collide.
- **Sidecar, not manifest copy.** The instance owns `generations/<id>.json`. kk writes `<artifact>.take.json` with only what the workflow needs. 0400 reads it for dedupe and spend, and 0405 adds measurements to it.
- **Dependency.** Blocked by 0397. Blocks 0399, 0400 and 0405.
- **Estimate.** 10h: adapter + reconciliation + cache-first analyze + job/mapping + offline adapter + tests.

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

- 2026-11-19T00:14:06.546Z feature_id Q → D8 (system)

