---
schema_version: 1
name: "Ship the music-gen generator plugin: lyria instance adapter, job and Content mapping"
status: done
template: feature-impl
created_at: 2026-11-18T22:16:14.376Z
updated_at: "2026-11-19T19:44:13.905Z"
feature_id: D8

ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 10
dependencies: ["0397"]
done_forced: "false"
done_reason: unforced close
---

## 0398. Ship the music-gen generator plugin: lyria instance adapter, job and Content mapping

### Background

Implements: R1 — plugin contract; R2 — live adapter with non-idempotent paid-call policy; R3 — cache-first analyze; R4 — offline adapter; R5 — Content mapping; R6 — artifact + take sidecar; R7 — CI-safe tests.

0397 freezes the brief, render order and adapter contract; this task ships the plugin that implements them. Precedent: `image-gen` (`plugins/generations/image-gen/src/index.ts`) is a `kind: generator` plugin with provider adapters under `src/providers/`, a pure preset composer, and a first-class dry-run path (`KK_IMAGE_DRY_RUN`) that keeps the whole suite offline; `voice-gen` proves audio output is a legal generator result — `Content.format = 'audio'` with the artifact path carried alongside (`plugins/generations/voice-gen/src/index.ts:351`).

The instance is an external service, so the adapter is the only place that knows HTTP. Everything downstream (CLI, workflow, judge) sees a typed job in and a typed artifact out.

### Requirements

- [x] R1. Ship `plugins/generations/music-gen` as a `kind: generator` plugin: `plugin.json` (`name`, `kind`, `entry: ./src/index.ts`, version, description), `package.json`, `tsconfig.json`, a README stub, and `runtime.requires` annotated per 0342 so `kk plugins check` validates it.
- [x] R2. Implement the live adapter against the 0397 contract: `POST /api/lyria/generate`, `GET /api/generations`, `POST /api/ai/analyze`; base URL from user config with an environment override; a generation timeout sized for a 30–120 s blocking call; the audio format and instance generation id read from the response. Apply the 0397 non-idempotent policy exactly: retry only on connect-phase failures, treat `401/402/403/404/429` and all-keys-rejected `502` as terminal, and reconcile against `GET /api/generations` after a timeout, socket reset or other `5xx`.
- [x] R3. Make `analyze` cache-first: read the take's instance manifest (via `GET /api/generations`) and return the cached `analysis` when present. Only call the paid `POST /api/ai/analyze` when no analysis is cached. The instance caches analysis per generation (`app/docs/guide/03-api-integration.md:68`), so a second paid analysis is pure waste.
- [x] R4. Implement the offline adapter (`KK_MUSIC_DRY_RUN=1`). It returns a deterministic short silent WAV and a synthetic manifest/analysis with zero network calls, and it is the default for the test suite.
- [x] R5. Map a resolved job onto the generator contract: `Content` with `format: 'audio'`; a body that carries liner notes (kk prompt text, lyrics, duration target, model, instance provider, instance id, analysis summary when present); and `references` pointing at the instance audio URL plus the kk sidecar path. Request echoes (`language`, `durationTarget`, `batchCount`) survive into metadata exactly as the instance recorded them, and are treated as absent (never defaulted) when the manifest lacks them.
- [x] R6. Persist one artifact per take into the job's run directory with deterministic naming, plus one sidecar per take (request digest from 0397, instance id, model, unit price charged, adopted-by-reconciliation flag). Never mirror the instance's `generations/` library into a kk workspace.
- [x] R7. Cover the adapter with tests that run offline: success, format detection, manifest mapping, cache-first analyze, each terminal status, connect-refused retry bound, timeout → reconciliation adopt, timeout → reconciliation miss → fail, and malformed JSON. No network, no paid call, runnable in the repo's normal test target.

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

The plugin is the thin typed edge around exactly one backend. `src/adapter/instance.ts` is the only
module in the tree that knows HTTP, so everything downstream — the take loop, the artifact writer, the
`Content` mapping — sees a typed `GeneratedTake` in and a typed `Content` out, which is what the
Design's "the adapter is the only place that knows HTTP" buys. The paid-call policy is the reason the
adapter exists, so it lives in one place (`send` → `classify` → `reconcile`) instead of being
re-decided per route: connect-phase failures retry inside a fixed bound, terminal statuses send
exactly one request and surface the instance's own text plus a remediation, and every ambiguous
outcome (post-send timeout, reset, other `5xx`, unparseable or audio-less `200`) reconciles against
the free `GET /api/generations` instead of ever re-sending a paid POST. Presets remain unresolved
data (0399), spend remains a recorded number (0400), and the offline adapter is the default surface
for the suite, so no test and no dry run can open a socket or pay for a take. One deliberate rule
change was needed and only one (row on `runtime-boundaries.yaml` below).

**AC interpretations**

- **R5 echoes vs. the sidecar's `language`.** `Content` — both `metadata.takes[]` and the liner notes —
  carries `language`, `durationTarget` and `batchCount` only when the instance manifest recorded them,
  never defaulted, exactly as R5 says. The sidecar describes the *request that was sent*, so its
  `language` falls back to the resolved request language when the manifest said nothing
  (`src/plugin.ts:120`). The two records answer different questions; only `Content` is bound by the
  "never defaulted" rule.
- **"unit price charged" (R6).** The instance manifest carries no billed amount, so the sidecar records
  the configured per-model unit price (`music.prices.pro|clip`) and `null` for an unpriced model
  (`null` = unpriced, never "free"). Reconciliation-adopted takes are recorded as adopted and any extra
  matching library takes as `unclaimed`, so 0400 can compute real spend from kk's own data rather than
  from a guess.
- **"the audio format read from the response" (R2).** The delivered bytes are authoritative: the
  container is sniffed from the bytes (`detectAudioFormat`) and the response content type / manifest
  `format` are only fallbacks. A `200` whose bytes are not recognisable audio is treated as ambiguous
  (reconcile, never re-send) rather than delivered as a take — an unreadable container must not be
  recorded as a paid success.
- **AC1's "declared runtime requirements match what the code imports"** cannot be a `kk plugins check`
  rule because kk-core's manifest schema preserves `runtime` as a loose key. It is therefore asserted
  where it can fail the build: `tests/manifest.test.ts` reads `plugin.json` and compares
  `runtime.requires` against the imports of every `src/**/*.ts` file, through the registry's own
  `parsePluginManifest`.
- **`analyze` is an adapter surface, not an entry surface.** `processGeneratorIO` never calls
  `analyze()`: the generate response already carries the instance's cached analysis, and R5 asks for
  "analysis summary when present". `analyze()` (cache-first, at most one paid POST per take) is what
  0401/0403/0405 call; this task had to prove it can never pay twice, not to wire it into the entry.
- **`takes: N` failure semantics.** A failure on take k aborts the job and writes **no** `Content` file,
  but takes 1..k-1 stay on disk with their sidecars (Design: "each persists or fails independently"),
  so 0400's run-scoped dedupe can skip what was already paid for.

**Change map**

| File:line | What and why |
| --------- | ------------ |
| `plugins/generations/music-gen/plugin.json:1` | R1 manifest — `name`/`kind: generator`/`entry: ./src/index.ts`/version/description plus `runtime.requires` so `kk plugins check` validates it and `tests/manifest.test.ts` can hold it to the real imports |
| `plugins/generations/music-gen/package.json:1` | Workspace member `@gobing-ai/music-gen` with the plugin's own deps (`kk-core`, `ts-runtime`, `ts-utils`, `zod`), so the entry resolves and typechecks like its sibling generators |
| `plugins/generations/music-gen/src/index.ts:89` | The `import.meta.main` guard — the manifest's entry point runs `main()` only when the file is executed, never when a test or another plugin imports the contract surface |
| `plugins/generations/music-gen/src/job.ts:127` | `parseMusicJob` — one place that turns the `DocList` envelope into `{brief, spec, job}`: brief YAML from `docs[0].body`, `metadata.musicGen` knobs (strict object, unknown key fails loud), then 0397's `resolveJob` |
| `plugins/generations/music-gen/src/config.ts:251` | `resolveMusicConfig` — `music.instance.*` / `music.prices.*` from the kk config file with `KK_MUSIC_INSTANCE_URL` / `KK_MUSIC_TIMEOUT_MS` / `KK_MUSIC_DRY_RUN` overrides (R2's env override); a wrong-typed value throws instead of silently defaulting a paid endpoint |
| `plugins/generations/music-gen/src/adapter/instance.ts:457` | `classify` — the §6.3 failure table in one switch: `401/402/403/404/429` and the all-keys-rejected `502` are terminal, other `5xx`/`408` ambiguous, any other 4xx terminal (nothing was produced) |
| `plugins/generations/music-gen/src/adapter/instance.ts:485` | `send` — connect-phase-only retry bound (3 attempts, doubling backoff) for POSTs and none for GETs; an ambiguous outcome is returned immediately, never re-sent: the whole non-idempotent policy in one function |
| `plugins/generations/music-gen/src/adapter/instance.ts:643` | `reconcile` — free `GET /api/generations`, match on byte-equal prompt + model + `generatedAt` ≥ request start, adopt the earliest and record the rest as `unclaimed`; a miss fails with endpoint, elapsed ms and a `--force` remediation, and never sends a second paid POST |
| `plugins/generations/music-gen/src/adapter/instance.ts:721` | `generate` — the one paid POST, then both legal response shapes (JSON manifest + audio URL, or audio body with an `x-generation-id` header); formats the take through `detectAudioFormat` and routes every unreadable shape to `reconcile` |
| `plugins/generations/music-gen/src/adapter/instance.ts:840` | `analyze` — cache-first (R3): read the manifest analysis and return it with `paid: false`; only a take with no cached analysis pays for `POST /api/ai/analyze`, and an ambiguous analyze adopts the cached analysis instead of paying again |
| `plugins/generations/music-gen/src/adapter/index.ts:22` | `createMusicInstance` — adapter selection in one function: `dryRun` returns the offline adapter (which holds no fetch seam), everything else the live client; no provider registry, per the Design's "one provider, not many" |
| `plugins/generations/music-gen/src/adapter/offline.ts:57` | `OfflineInstance` (R4) — deterministic silent WAV, synthetic manifest (`offline-take-<n>`) and synthetic analysis (`offline:`-prefixed summary), an in-memory library and **no fetch seam at all**, so a dry run cannot open a socket even if one were injected |
| `plugins/generations/music-gen/src/audio.ts:49` | `detectAudioFormat` — magic-number sniffing (ID3/MPEG sync, RIFF/WAVE) with the content type only as a fallback, so "the format detected from the returned bytes" is literal |
| `plugins/generations/music-gen/src/audio.ts:91` | `silentWav` — the byte-stable 1 s mono WAV the offline adapter returns; two dry runs produce identical files and identical sidecars |
| `plugins/generations/music-gen/src/artifact.ts:86` | `takeArtifactName` — `<slug>-<model>-<safeInstanceId>.<ext>` (Design's "artifact naming"): every file traces back to the instance library by name and two takes of one brief cannot collide; `safeInstanceId` (`:74`) strips separators and `..` before an instance-supplied id becomes a path |
| `plugins/generations/music-gen/src/artifact.ts:161` | `buildTakeSidecar` — `<artifact>.take.json` with the 0397 digest + digest input, instance id, model, detected format, the exact request, unit price, adopted flag, unclaimed extras, force/reason, artifact path and `dryRun`; per-key ownership so 0400 (dedupe/spend) and 0405 (measurements) extend it, and the instance's `generations/` library is never copied |
| `plugins/generations/music-gen/src/artifact.ts:197` | `writeAudioBytes` — the plugin's single binary writer (with `readImageBytes` at `:202` for the digest's image hashes): the ts-runtime `FileSystem` seam is text-only, so binary IO is isolated to this one file |
| `plugins/generations/music-gen/src/content.ts:172` | `buildMusicContent` (R5) — `format: 'audio'` (the `voice-gen` precedent), liner-notes body, `references` = instance audio URL + kk sidecar path per take, and `metadata.takes[]` with the echo fields present only when the manifest recorded them |
| `plugins/generations/music-gen/src/content.ts:107` | `renderLinerNotes` — the body a human reads: per take the instance id, model, delivered format, echoes, adoption/unclaimed provenance, the kk prompt byte for byte, the lyrics state and the analysis summary; deterministic, so the same take always renders the same lines |
| `plugins/generations/music-gen/src/plugin.ts:51` | `processGeneratorIO` — the take loop: resolve config once, hash/encode reference images once, then generate → persist audio → write sidecar per take (`takes: N` sequential, each persisting independently), map the records to `Content` last so a mid-job failure leaves the paid takes on disk but no contract file |
| `plugins/generations/music-gen/src/plugin.ts:208` | `main` — the `--in <DocList> --out <content.json>` entry the plugin contract expects: usage error without both flags, exit 1 with the diagnostic on stderr, exit 0 on success |
| `.spur/rules/strict/runtime-boundaries.yaml:148` | Rule exemption: adds `plugins/generations/music-gen/src/artifact.ts` to the binary-IO allowlist because the ts-runtime `FileSystem` seam is text-only and this file is the plugin's whole binary surface (writing the instance's delivered audio bytes and reading reference-image bytes to SHA-256 them for the 0397 digest). It mirrors the existing `image-gen` exemption (`image-gen/src/bytes.ts`, and `image-gen/src/providers/h3-local.ts` for the vendor-CLI transport) and sits in the same allowlist block; **nothing else was relaxed** — no other path added, no rule disabled, no severity changed |
| `packages/kk-core/tests/registry.test.ts:271` | Discovery expectations gained `'music-gen'` (`:650` is the `discoverAllPlugins`/`resolvePluginRoots` list): a new plugin directory must appear in both, otherwise AC1 fails at the registry level |
| `plugins/generations/music-gen/tests/adapter.test.ts:24` | R7/AC2/AC3/AC5 — the paid-call policy against an injected fetch stub: one POST with the 0397 fields, format detection, manifest mapping, cache-first analyze, each terminal status, connect-refused bounded retry, timeout → adopt, timeout → miss → fail, malformed JSON; every call logged, so "exactly one request" is asserted, not assumed |
| `plugins/generations/music-gen/tests/offline.test.ts:16` | AC4 — the offline adapter against a fetch that throws if touched: silent WAV, synthetic manifest/analysis, determinism, and `createMusicInstance` selecting it from `KK_MUSIC_DRY_RUN=1` |
| `plugins/generations/music-gen/tests/plugin.test.ts:17` | AC6/R5/R6 — the entry under the offline adapter: exactly two audio files + two sidecars for a two-take job, the digest equal to 0397's `takeDigest`, the exact request recorded, the echo fields present/absent, adoption flagged, references, the resume-friendly failure path and the end-to-end `KK_MUSIC_DRY_RUN=1` run in a temp dir |
| `plugins/generations/music-gen/tests/manifest.test.ts:7` | AC1 — discovery through kk-core's registry plus the `runtime.requires` ↔ `src/**` imports equality the AC asks for |
| `plugins/generations/music-gen/tests/audio.test.ts:10` | R2/R4 — format detection from bytes with content type only as fallback, and the byte-stable silent WAV |
| `plugins/generations/music-gen/tests/config.test.ts:17` | R2 — env > config > default precedence and the loud failure on a wrong-typed config key |
| `plugins/generations/music-gen/tests/stub-instance.ts:1` | The offline fixtures: an injected `MusicFetch` stub with a call log and a stub `MusicInstance` for the entry tests — an injected seam, never a mutated global, which is what keeps the suite socket-free |
| `plugins/generations/music-gen/README.md:6` | Status flips from "contract frozen" to "the plugin ships", the tree listing gains the 0398 files, and section 3 documents how to run the plugin (input envelope, dry run) so the next task's author has the entry documented |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — plugin contract (`plugin.json`, `package.json`, entry, README, `runtime.requires`) | MET | `plugins/generations/music-gen/plugin.json:1` (name/kind/entry/version/description + `runtime.requires` naming `fetch`, `node:crypto`, `node:fs/promises`, `node:os`, `node:path`, `node:util`, `zod`, workspace packages — the same set the sources import); `plugins/generations/music-gen/src/index.ts:89` (entry export); discoverability asserted at `packages/kk-core/tests/registry.test.ts:271,650` |
| R2 — live adapter with the non-idempotent paid-call policy | MET | `plugins/generations/music-gen/src/adapter/instance.ts:457` (ambiguous-by-default classifier), `:485` (connect-only bounded retry, POST only), `:643` (reconcile: byte-equal prompt + model + `generatedAt >= request start`, later matches `unclaimed`), `:721` (generate reads format from bytes and the instance id from the response) |
| R3 — cache-first analyze | MET | `plugins/generations/music-gen/src/adapter/instance.ts:840` (`analyze`: manifest analysis first, one paid POST only when absent, ambiguous POST adopts the cached analysis) |
| R4 — offline adapter, zero network, default for the suite | MET | `plugins/generations/music-gen/src/adapter/offline.ts:57` (deterministic silent WAV + synthetic manifest/analysis); `plugins/generations/music-gen/src/adapter/index.ts:22` (dry-run selects offline, live otherwise) |
| R5 — Content mapping | MET | `plugins/generations/music-gen/src/content.ts:172` (`format: 'audio'`, liner-notes body) and `:107` (references to the instance audio URL + kk sidecar); echoes carried exactly or absent, never defaulted |
| R6 — per-take artifact + sidecar, no library mirroring | MET | `plugins/generations/music-gen/src/artifact.ts:86` (deterministic `<slug>-<model>-<instanceId>.<ext>`), `:161` (sidecar with 0397 digest, instance id, model, unit price, adopted flag, unclaimed extras), `:197` (binary bytes through the one allowlisted module) |
| R7 — offline test coverage of the adapter | MET | `plugins/generations/music-gen/tests/adapter.test.ts:59`–`:392` (success, byte-wins format, manifest echoes, cache-first, each terminal status, connect bound, timeout/socket-reset/5xx reconciliation, adopt, miss-fail, malformed JSON, unreachable library); 152 tests, 0 network |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The plugin is discoverable and checkable (req: R1) | MET | command | `bun apps/cli/src/index.ts plugin status --json` -> `{"name":"music-gen","kind":"generator","entry":"./src/index.ts","healthy":true,"diagnostics":[]}`; `KK_MUSIC_DRY_RUN=1 bun apps/cli/src/index.ts plugin check music-gen` -> `music-gen [generator]: unsupported` (exit 0: no readiness probe is declared, which R1 does not require); `plugin.json` `runtime.requires` matches the modules the sources import |
| AC2 — One take round-trips through the adapter (req: R2, R5) | MET | test | `plugins/generations/music-gen/tests/adapter.test.ts:59` (exactly one POST with the kk prompt and 0397 request fields, format from bytes), `:92` (delivered bytes win over the manifest claim), `:119` (echoes from the manifest); `plugins/generations/music-gen/tests/plugin.test.ts:192` (format audio, liner notes, references), `:224`, `:243` (echoes exact / absent, never defaulted) |
| AC3 — Analysis is paid at most once per take (req: R3) | MET | test | `plugins/generations/music-gen/tests/adapter.test.ts:133` (cached analysis -> no paid POST), `:145` (no cache -> exactly one paid POST), `:161` (ambiguous analyse adopts, never pays twice) |
| AC4 — The offline adapter performs no network call (req: R4) | MET | test | `plugins/generations/music-gen/tests/offline.test.ts:37` (deterministic silent WAV + synthetic manifest), `:62` (synthetic analysis, no paid call), `:74` (KK_MUSIC_DRY_RUN=1 selects offline and never touches the injected fetch) |
| AC5 — A paid request is never re-sent on an ambiguous outcome (req: R2, R7) | MET | test | `plugins/generations/music-gen/tests/adapter.test.ts:210` (401/402/403/404/429: one request, the instance text, a remediation), `:227` (all-keys 502 terminal), `:239` (unrelated 502 ambiguous -> reconcile), `:254` (connect refused retried within the bound), `:290` (post-send timeout reconciles, adopts the earliest match, records extras unclaimed), `:313` (miss -> fail naming endpoint, elapsed time, --force), `:361`, `:377` (socket reset and 5xx reconcile, never retried) |
| AC6 — The workspace boundary is respected (req: R6) | MET | test | `plugins/generations/music-gen/tests/plugin.test.ts:103` (two-take job -> exactly two audio files and two sidecars), `:134` (sidecar digest equals 0397 `takeDigest` for that take), `:148` (sidecar records the exact request body sent), `:161` (a later failing take keeps the paid take on disk) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

SECUA + traceability review of the music-gen generator plugin (`--focus all`, host-inline; independent of the implement session).

| Priority | Finding | Disposition |
| -------- | ------- | ----------- |
| P1 (blocker) | — | none |
| P2 (major) | — | none |
| P3 (minor) | The streaming-`200` branch requires an `x-generation-id` (or `x-generation`) header, which `docs/design/music-gen.md` §6.2 does not describe. If the live instance answers with an audio body only, every generation ends in reconciliation — safe (no double spend, no re-send) but it pays the library round-trip and records `adoptedByReconciliation` on ordinary successes | DEFER(0404 dogfood pins the real response shape and then §6.2 is corrected) |
| P3 (minor) | `analyze()` implements cache-first paid-once semantics, but the plugin entry never calls it: a take whose manifest lacks analysis ships the `(no analysis cached on the instance)` marker, so the "pay once when absent" path is reachable only through a later task | DEFER(0401/0403 wire `kk music analyze` and the workflow's analyze state) |
| P3 (minor) | The sidecar's `unitPrice` is the configured per-model list price, not a billed amount. 0400 must treat it as a price record and derive spend from it, never as a receipt | DEFER(0400 owns spend semantics and documents the distinction) |
| P4 (advisory) | `.spur/rules/strict/runtime-boundaries.yaml:148` adds `plugins/generations/music-gen/src/artifact.ts` to the binary-IO allowlist. The `FileSystem` seam is text-only and the file holds the plugin's whole binary surface (delivered audio bytes in, reference-image bytes hashed); it mirrors the existing `image-gen` entries in the same block, and no other path, rule or severity was relaxed | ACCEPTED |
| P4 (advisory) | `plugin.ts:63` removes the `--out` contract file before the take loop, so a failed re-run leaves the new takes without a previous `content.json` | ACCEPTED |

**Security.** No credential is read, logged or echoed: the adapter reads the base URL from user config with a `KK_MUSIC_*` override and never sends an auth header (`plugins/generations/music-gen/src/config.ts:251`); terminal failures surface the instance's own error text only. Paid endpoints are protected by an ambiguous-by-default classifier — an unrecognised transport error is treated as "may have been billed" and reconciles rather than re-sends (`plugins/generations/music-gen/src/adapter/instance.ts:457`). Preset portability still rejects provider/model-id/price at any depth.

**Reliability.** Connect-phase retry is bounded and exponential, POST-only (`plugins/generations/music-gen/src/adapter/instance.ts:485`); reconciliation matches on byte-equal prompt + model + `generatedAt ≥ request start` and records later matches as `unclaimed` (`:643`); a failed take leaves earlier takes on disk for resume (`plugins/generations/music-gen/tests/plugin.test.ts:161`).

**Residual risk.** The instance-side response shape (audio body vs. URL manifest) and the real `GET /api/generations` payload are stubbed here; 0404's dogfood is the only place they become fact. Until then the adapter's conservative default is reconciliation, which cannot double-charge.

**Final disposition.** Approve for `done` — R1–R7 and AC1–AC6 MET; 152 tests pass; package typecheck and Biome clean; light gate DEFERRED (the batch full gate is owed); `bun run test-post-check` green after the fix lane regenerated a complete lcov.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-19T00:14:06.546Z feature_id Q → D8 (system)
- 2026-11-19T05:20:30.964Z backlog → wip (system)
- 2026-11-19T05:53:16.373Z wip → testing (system)
- 2026-11-19T05:53:17.189Z testing → done (system)

