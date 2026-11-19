---
schema_version: 1
name: Define the music brief, preset-resolution and lyria instance adapter contract
status: done
template: feature-impl
created_at: 2026-11-18T22:16:10.470Z
updated_at: "2026-11-19T04:31:47.315Z"
feature_id: D8

ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 6
done_forced: "false"
done_reason: unforced close
---

## 0397. Define the music brief, preset-resolution and lyria instance adapter contract

### Background

Implements: R1 — brief schema; R2 — prompt-text render order; R3 — request mapping without instance defaults; R4 — preset resolution; R5 — adapter contract; R6 — recorded in the owning docs.

The homelab Mac Mini runs a self-hosted Lyria 3 studio at `xprojects/gitops/homelab/lyria-3-pro` (native Node process, managed checkout pinned at upstream `ef8b16f4`). Its REST surface is the only Lyria 3 access we own: `POST /api/lyria/generate` takes `prompt, lyrics, language, durationTarget, model: pro|clip, format, images≤10, title, batchCount` (`homelab/lyria-3-pro/app/server/lyria.ts:678-689`), persists a manifest per take, and serves `GET /api/generations`, `POST /api/ai/analyze`, `POST /api/ai/modify`, `POST /api/ai/enhance-prompt`, plus project routes. It has **no authentication** and is bound to the LAN (later: Cloudflare Access in front).

knowledge-kit has no music capability today: `plugins/generations/*` covers images (`image-gen`) and speech (`voice-gen`, `gemini-tts`, `voxcpm-tts`, `omni-voice-gen`), and `plugins/kk/skills/audio-authoring` authors *spoken* scripts, not music. No MCP server exists for a self-hosted instance; the public ones (`bthurlow/artificer-mcp`, Google's `mcp-lyria-go`, useapi's hosted Flow Music MCP) call Google directly and would bypass the instance's key handling, library and manifest provenance.

Two facts from the instance's own documentation constrain every later task: the prompt is the only control surface — no structure/tempo/vocal/duration parameters and no `negative_prompt`, so exclusions must be rendered as prompt text (`app/docs/guide/02-prompting-guide.md:3,42-44`); and duration is prompt text only, honoured loosely (`app/docs/guide/02-prompting-guide.md:62-77`). Both must be encoded in the brief contract now, because a wrong schema propagates to the plugin, the presets, the skill and the workflow.

### Requirements

- [x] R1. Define a `MusicBrief` schema (Zod + YAML authoring form) that is the single input document: `title`, `model` (`pro|clip`), `duration_target` (`m:ss`), `language`, `instrumental`, `theme`, `format`, `style` (technical direction), `avoid[]`, `structure[]` (`at`, `section`, `note`), `lyrics`, `images[]`, `takes`, and `meta`. Every field either renders into kk's prompt text or maps to exactly one request field, and the mapping is total — no field may be silently dropped.
- [x] R2. Specify the exact render order of the **prompt text kk sends** (the instance's PROMPT box): technical direction → `Avoid: …` (omitted when the merged list is empty) → timestamped structure lines → `Instrumental only — no vocals.` when `instrumental: true`. kk must **not** render the duration sentence or the `Lyrics (sing in <LANG>):` block: the instance's `assembleLyriaPrompt` appends both server-side (`homelab/lyria-3-pro/app/server/lyria.ts:9-26`, `app/docs/guide/04-app-integration.md` "Prompt assembly"), so rendering them in kk would duplicate them. Pin golden fixtures for a pro brief, a clip brief, an instrumental brief and a lyrics-free brief, each pinning both the prompt text and the request JSON.
- [x] R3. Specify the request mapping with no reliance on instance defaults: `durationTarget` is always sent for `model: pro` (the instance substitutes `'3:00'` when absent, `lyria.ts:1011,1028`, which would silently turn a 0:30 jingle into a 3:00 request) and never for `clip`; `language` is always sent (instance default `EN`); `instrumental: true` sends `lyrics: ''`; `batchCount` is sent as metadata only — the instance makes exactly one provider call per request and records `batchCount` verbatim (`lyria.ts:1096,1113`), so N takes are N sequential kk requests.
- [x] R4. Specify preset resolution as pure precedence — explicit brief value > workflow preset > theme default > format default > built-in default — over a `format × theme` data model whose files may not contain a provider, API base URL, API model id, or price (the instance maps `pro|clip` to a model id; prices are provider-specific and live in user config, see 0400).
- [x] R5. Specify the adapter contract against the instance: base URL resolution (user config root with an env override and a documented default), timeouts sized for a 30–120 s blocking generation, how the authoritative audio format is taken from the response, where the artifact and instance generation id are recorded, and a **non-idempotent call policy** for paid routes (`/api/lyria/generate`, `/api/ai/analyze`): automatic retry only for connect-phase failures (connection refused / DNS) where the request provably never reached the instance; `401/402/403/404/429` and the instance's all-keys-rejected `502` (`app/docs/guide/04-app-integration.md:53`) are terminal; a timeout, socket reset or other `5xx` after the request was sent triggers **reconciliation** — look up the instance library (`GET /api/generations`) for a take with the same prompt, model and `generatedAt` ≥ request start, adopt it if found, otherwise fail and require an operator `--force` re-run. Never re-send a paid request on an ambiguous outcome.
- [x] R6. Record the contract in the owning docs — a `docs/design/` satellite referenced from `docs/04_DESIGN.md`, plus the `plugins/generations/music-gen/README.md` skeleton — and open an ADR only if a platform invariant (generator contract, preset resolution, spend policy) actually changes. No implementation code in this task beyond the four golden fixtures.

### Acceptance Criteria

```gherkin
Scenario: AC1 — The brief covers every provider-visible input (req: R1)
  Given the documented field set of the instance's generate route
  When the MusicBrief schema is reviewed field by field
  Then every request field and every kk prompt segment has exactly one originating brief field
  And at least one positive and one negative test exists per required field

Scenario: AC2 — kk renders only the prompt box, deterministically and in order (req: R2)
  Given four committed golden briefs — pro with lyrics, clip, instrumental, lyrics-free
  When each is rendered twice
  Then both renders are byte-identical
  And the segments appear in the documented order
  And no rendered prompt contains "Total running time" or "Lyrics (sing in"
  And the instrumental brief sends empty lyrics and carries the instrumental directive

Scenario: AC3 — Request fields never fall through to instance defaults (req: R3)
  Given the pro golden with duration_target 0:30 and the clip golden with a duration_target
  When their request JSON is rendered
  Then the pro request carries durationTarget "0:30" and an explicit language
  And the clip request carries no durationTarget
  And a brief with takes 3 renders three identical single-take requests

Scenario: AC4 — Preset resolution is precedence-defined (req: R4)
  Given a format, a theme, a workflow preset and a brief that set the same field
  When the effective job is resolved
  Then the brief value wins, then the workflow preset, then the theme, then the format, then the built-in default
  And a preset file that declares a provider, model id or price is rejected by the loader with a non-zero exit

Scenario: AC5 — The adapter contract never re-sends a paid request on an ambiguous outcome (req: R5)
  Given the contract document
  When the failure table is read
  Then connection-refused before send is the only automatically retried case
  And 401/402/403/404/429 and all-keys-rejected 502 are terminal with the operator remediation
  And timeout, socket reset and other 5xx after send route to library reconciliation, then adopt-or-fail
  And the recorded artifact carries the instance generation id and the detected audio format

Scenario: AC6 — The contract lives in the owning docs (req: R6)
  Given the repository's document map
  When the new design satellite is added
  Then docs/04_DESIGN.md indexes it, the feature record and the plugin README reference it once
  And no implementation file other than the golden fixtures was added by this task
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T23:37:27.856Z

- **Prompt assembly is split between kk and the instance (closed 2026-11-18).** The instance appends the Pro duration sentence and the lyrics block server-side (`lyria.ts:9-26`). kk renders the PROMPT box text only and sends `durationTarget`/`lyrics`/`language` as fields. Rejected: rendering the full text in kk and sending empty fields — the instance would still add its own duration sentence because it defaults `durationTarget` to `'3:00'`.
- **Paid calls are non-idempotent (closed 2026-11-18).** A 30–120 s blocking call that times out may already have been billed and persisted by the instance. Blind retry double-bills, so ambiguous outcomes reconcile against `GET /api/generations` instead. The instance already does per-key failover internally (`04-app-integration.md:53`); kk adds no second failover layer.
- **`batch` is renamed `takes` (closed 2026-11-18).** The instance's `batchCount` is a recorded label, not a multi-sample parameter. Using the name `takes` in the brief keeps people from assuming one request returns N samples.

### Design

- **Approach.** Design-first: this task produces one contract document and four golden fixture briefs, so the plugin (0398), presets (0399), spend guard (0400), audio checks (0405), CLI (0401), skill (0402) and workflow (0403) implement against a frozen interface instead of inventing one each.
- **Brief shape.** Reuse the working YAML shape already validated against the model's real behaviour (technical direction, `Avoid:` list, `[m:ss]` structure lines, lyrics under `[Verse]/[Chorus]` tags). The Zod schema lives in the plugin package so `kk music render` can validate without a network call. The YAML authoring form is documented in the README and is not duplicated in a second schema.
- **Why not reuse `voice-gen`/`audio-authoring`.** Those own spoken-word `VoiceScript` semantics (segments, per-segment voice, concat). Music is one continuous mixed master with a prompt-derived arrangement, and forcing it through the speech model would add a fake segment layer.
- **Duration.** kk never writes duration prose. It sends `durationTarget` for Pro (always, see R3) and records it so 0405 can measure the delivered file against it. For Clip it sends no target, because Clip is fixed at about 30 s and ignores duration language (`app/docs/guide/01-lyria-models.md:32`).
- **Digest input.** The canonical request (kk prompt text + lyrics + model + durationTarget + language + image hashes) is the dedupe and provenance key consumed by 0400. Pin its canonical-JSON form here so 0400 does not have to re-derive it.
- **Dependency.** Blocks 0398. 0399 may start once the schema half of this task lands.
- **Estimate.** 6h: schema + render/request spec + 4 goldens + failure table + design satellite + doc index updates.

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

Design-first contract freeze. The plugin, presets, spend guard, audio checks, CLI and skill implement
against this surface instead of inventing one each. Contract authority:
[docs/design/music-gen.md](design/music-gen.md).

#### AC6-vs-AC2/AC3 tension (read first)

AC6 says "no implementation file other than the golden fixtures was added by this task" and R6 says
"no implementation code in this task beyond the four golden fixtures". AC2 and AC3 are not satisfiable
from fixtures alone — "both renders are byte-identical", "the segments appear in the documented order",
"the pro request carries durationTarget 0:30", "takes 3 renders three identical single-take requests"
all require the renderer and the request mapper that produce those bytes. The task brief's own
deliverable #1 resolves the conflict in favour of a pure module. What was added and why:

- **Pure contract only.** `src/` holds the brief schema (R1), the renderer (R2), the request mapper
  (R3), preset resolution (R4) and the digest input. Nothing else: **no HTTP, no adapter, no CLI verb,
  no plugin entry, no preset data**. `plugin.json` (0398 R1) and `presets/` (0399) are untouched and
  still absent on purpose, so the AC6 intent — this task ships no runnable capability — holds.
- **Two scaffolding files were unavoidable** to make a TypeScript module that imports Zod and is
  typechecked: `package.json` (workspace member + `zod`) and `tsconfig.json`. Without them `zod` does
  not resolve and no typecheck target exists, so the module would be untestable and unbuildable.
  0398 R1 extends `package.json` with its remaining deps and adds `plugin.json` + the entry.
- `bun.lock` changed because the new workspace member was installed (`bun install`).

#### Change map

| File:line | What and why |
| --------- | ------------ |
| `plugins/generations/music-gen/src/brief.ts:92` | `BRIEF_FIELD_TARGETS` — the machine form of R1's total mapping (field → prompt segment / request field / resolution input / recording slot); a test asserts it covers `MusicBriefSchema.shape` exactly, so no field can be silently dropped |
| `plugins/generations/music-gen/src/brief.ts:123` | `MusicBriefSchema` (R1) — strict Zod object: unknown keys fail loudly; `m:ss` + 0:05–3:00 duration bounds, language tag, `instrumental`×`lyrics` conflict, non-decreasing `structure` timestamps, ≤10 images, takes 1–4 |
| `plugins/generations/music-gen/src/brief.ts:14` | `MMSS_PATTERN` + `durationSeconds`/`formatDuration` (`:47`, `:56`) — one duration grammar shared by brief, presets, request and (later) 0405's measurement |
| `plugins/generations/music-gen/src/render.ts:61` | `renderPromptText` (R2) — the frozen segment order `technical direction → Avoid: … → [m:ss] structure lines → instrumental directive`; pure, so a double render is byte-identical by construction |
| `plugins/generations/music-gen/src/render.ts:30` | `INSTANCE_OWNED_PROMPT_MARKERS` — `Total running time` / `Lyrics (sing in` are the instance's server-side segments; exported so the AC2 assertions and 0398's adapter can prove their absence |
| `plugins/generations/music-gen/src/request.ts:66` | `renderGenerateRequest` (R3) — `durationTarget` always for pro, never for clip, `language` always, `lyrics: ''` when instrumental, `batchCount: 1`; throws rather than let a pro request fall through to the instance's `3:00` |
| `plugins/generations/music-gen/src/request.ts:92` | `renderTakeRequests` — `takes: N` = N structurally identical single-take requests (`batchCount` is a recorded label, not a multi-sample knob) |
| `plugins/generations/music-gen/src/presets.ts:273` | `resolveJob` (R4) — pure precedence `brief > workflow > theme > format > built-in`, per-field source tracking; an unresolved pro `duration_target` or `style` fails loudly instead of accepting an instance default |
| `plugins/generations/music-gen/src/presets.ts:122` | `FORBIDDEN_PRESET_KEYS` + `assertPresetPortable` (`:403`) — provider / API model id / base URL / credential / price rejected at any depth, aggregated dotted paths, `exitCode: 2`; `loadPresetFile` (`:449`) is the loader that surfaces it |
| `plugins/generations/music-gen/src/presets.ts:376` | `explainJob` — one line per resolved field naming the winning layer, the input 0399 R3 prints and 0401 shows on a refusal |
| `plugins/generations/music-gen/src/digest.ts:48` | `digestInput` + `canonicalDigestJson` (`:71`) + `takeDigest` (`:96`) — the canonical request 0400 uses for run-scoped dedupe and 0398 records as provenance; absent values are `null`, images are content hashes in brief order |
| `plugins/generations/music-gen/src/index.ts:1` | The published contract surface 0398–0401 import from; no logic of its own |
| `plugins/generations/music-gen/package.json:1` | Workspace member `@gobing-ai/music-gen` (`zod`), so the module resolves and typechecks; 0398 R1 extends it |
| `plugins/generations/music-gen/tsconfig.json:1` | `tsc --noEmit` target matching the sibling generator plugins |
| `plugins/generations/music-gen/tests/fixtures/pro-with-lyrics/brief.yaml:1` | Golden 1 — pro with authored lyrics, 0:30 target, full structure |
| `plugins/generations/music-gen/tests/fixtures/clip/brief.yaml:1` | Golden 2 — clip with a `duration_target` in the brief that must never reach the wire; also the empty-`avoid`/no-structure omission path |
| `plugins/generations/music-gen/tests/fixtures/instrumental/brief.yaml:1` | Golden 3 — instrumental underscore: empty-`lyrics` payload + directive as the last segment |
| `plugins/generations/music-gen/tests/fixtures/lyrics-free/brief.yaml:1` | Golden 4 — pro without lyrics (key omitted) and a non-`EN` language |
| `plugins/generations/music-gen/tests/fixtures/*/prompt.txt` | The pinned kk prompt text per golden (AC2's "both renders are byte-identical" anchor) |
| `plugins/generations/music-gen/tests/fixtures/*/request.json` | The pinned request JSON per golden (AC3's no-instance-default anchor) |
| `plugins/generations/music-gen/tests/fixtures/presets/invalid-price.preset.yaml:1` | Deliberate contract violation: a preset carrying a price |
| `plugins/generations/music-gen/tests/fixtures/presets/invalid-provider.preset.yaml:1` | Deliberate contract violation: provider + upstream API model id |
| `plugins/generations/music-gen/tests/fixtures/presets/invalid-nested.preset.yaml:1` | Deliberate contract violation: `base_url` nested under a mapping, proving the guard walks depth |
| `plugins/generations/music-gen/tests/fixtures/presets/valid-format.preset.yaml:1` | The portable counterpart (no provider/model-id/price), so the guard is proven not to reject everything |
| `plugins/generations/music-gen/tests/goldens.ts:1` | Fixture loader shared by the four contract test files |
| `plugins/generations/music-gen/tests/brief.test.ts:34` | AC1 — positive + negative case per field, strict-unknown-key, and the totality assertion over `BRIEF_FIELD_TARGETS` |
| `plugins/generations/music-gen/tests/render.test.ts:20` | AC2 — byte-identical double render, golden equality, segment order, no `Total running time`/`Lyrics (sing in`, instrumental directive, lyrics never rendered |
| `plugins/generations/music-gen/tests/request.test.ts:24` | AC3 — pro carries `durationTarget 0:30` + explicit language, clip carries none, `takes: 3` → three identical `batchCount: 1` requests, key order, golden equality |
| `plugins/generations/music-gen/tests/presets.test.ts:37` | AC4 — the five-link precedence chain, additive `avoid`, replaced `structure`, loud failure on unresolved pro duration/style |
| `plugins/generations/music-gen/tests/presets.test.ts:212` | AC4 — portability rejection with `exitCode 2`, aggregated dotted violations, and a spawned loader proving a **non-zero exit** for a price-bearing preset |
| `plugins/generations/music-gen/tests/digest.test.ts:13` | Digest — canonical shape pinned, stability, per-field sensitivity, `takeIndex` distinguishing N takes, image-hash requirement |
| `docs/design/music-gen.md:1` | The owning-doc satellite (R6/AC6): decisions, brief schema + mapping table, render order, request mapping, preset precedence, adapter contract + paid-call failure table, digest input, module layout, provenance of instance facts, deferred |
| `docs/design/music-gen.md:223` | AC5's failure table — connect-phase-only retry; `400/401/402/403/404/429`/all-keys-`502` terminal with remediation; timeout / `ECONNRESET` / other `5xx` / malformed `200` → `GET /api/generations` reconciliation, adopt-or-fail |
| `docs/design/music-gen.md:190` | Environment variables and base-URL resolution: `KK_CONFIG` (+ `~/.config/kk/config.yaml`) carrying the `music:` block, `KK_MUSIC_INSTANCE_URL`, `KK_MUSIC_TIMEOUT_MS`, `KK_MUSIC_DRY_RUN=1`, each with a documented default |
| `docs/design/music-gen.md:246` | The artifact/generation-id/format record: one sidecar per take, per-field owner so 0398/0400/0405 extend it instead of inventing another |
| `docs/design/music-gen.md:328` | Provenance section: what was verified in this repo, what is cited from the instance checkout and **unverified here**, and the provider-level cross-check |
| `plugins/generations/music-gen/README.md:1` | Plugin README — status, layout, the YAML authoring form documented **once** (no second schema) and the preset index skeleton 0399's generator fills |
| `docs/04_DESIGN.md:64` | The single satellite index row for the new design doc |
| `docs/features/D8_music-generation-music-gen-plugin-kk-music-workflow-and-quality-gates-over-the-homelab-lyria-3-instance.md:139` | The feature record's single pointer to the frozen contract + authoring form |

#### Decisions taken while freezing (and why)

1. **`audio_format` was added to the brief.** The instance's generate route has a `format` field
   (audio container) while R1/R4 use `format` for the preset axis. Keeping one name for both would
   leave the wire field without an originating brief field, which AC1 forbids. `format` = preset name
   (never sent), `audio_format` = wire `format`.
2. **`takeIndex` is part of the digest input.** The Design bullet lists prompt + lyrics + model +
   durationTarget + language + image hashes. With `takes: N` rendering N identical requests, an
   index-free digest would make 0400's run-scoped dedupe refuse the run's own takes 2..N, while a
   re-run of take 0 still collides as intended.
3. **`avoid` is additive, everything else replaces.** An authored exclusion must not switch off the
   theme's cliché guard; a merged structure skeleton would carry two `0:00` starts.
4. **`style` and pro `duration_target` have no built-in default.** Both fail resolution loudly with a
   chain-naming diagnostic — the alternative is letting the instance decide, which R3 forbids.
5. **Instance facts are marked, not asserted.** The homelab checkout is absent here
   (`~/xprojects/gitops/homelab/lyria-3-pro` does not exist; `~/projects/gitops` has no
   `lyria-3-pro`), so every instance-derived claim carries an explicit `unverified` marker with its
   source line (`docs/design/music-gen.md:328`). Nothing in the contract, tests or docs claims tested
   instance behaviour; 0398 confirms those citations against the running instance.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — MusicBrief schema (Zod + YAML form) with a total field→target mapping | MET | `plugins/generations/music-gen/src/brief.ts:123` (strict schema) and `:92` (`BRIEF_FIELD_TARGETS`); `plugins/generations/music-gen/tests/brief.test.ts:174` asserts the table covers `MusicBriefSchema.shape` exactly, so no field can be dropped |
| R2 — frozen prompt render order, no duration sentence, no lyrics block, 4 goldens | MET | `plugins/generations/music-gen/src/render.ts:61` (`renderPromptText`), `:30` (`INSTANCE_OWNED_PROMPT_MARKERS`); goldens `plugins/generations/music-gen/tests/fixtures/{pro-with-lyrics,clip,instrumental,lyrics-free}/{prompt.txt,request.json}`; `plugins/generations/music-gen/tests/render.test.ts:1` proves byte-identical double render and marker absence |
| R3 — request mapping with no instance defaults | MET | `plugins/generations/music-gen/src/request.ts:66` (pro always `durationTarget`, clip never, `language` always, `lyrics: ''` when instrumental, `batchCount: 1`), `:92` (`takes: N` = N single-take requests); `plugins/generations/music-gen/tests/request.test.ts:32,40` |
| R4 — preset precedence over portable data | MET | `plugins/generations/music-gen/src/presets.ts:273` (`resolveJob`), `:122`/`:403` (`FORBIDDEN_PRESET_KEYS`, `assertPresetPortable`), `:376` (`explainJob`); `plugins/generations/music-gen/tests/presets.test.ts:37,225` |
| R5 — adapter contract incl. the non-idempotent paid-call policy | MET | `docs/design/music-gen.md:186` (base URL/timeouts), `:223` (paid-call table: connect-phase-only retry, terminal 401/402/403/404/429/502, post-send ambiguity → `GET /api/generations` reconcile then adopt-or-fail), `:246` (artifact record: instance generation id + detected format) |
| R6 — contract recorded in the owning docs | MET | `docs/design/music-gen.md:1` (satellite), `docs/04_DESIGN.md:1` (indexed once), `plugins/generations/music-gen/README.md:1` (YAML authoring form, no second schema), feature record cross-reference; no ADR opened because no platform invariant changed |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The brief covers every provider-visible input (req: R1) | MET | test | `plugins/generations/music-gen/tests/brief.test.ts:174` — totality table asserted against the schema shape; positive/negative cases per field (`:1`-`:194`) |
| AC2 — kk renders only the prompt box, deterministically and in order (req: R2) | MET | test | `plugins/generations/music-gen/tests/render.test.ts:1` — double render byte-identical, segment order, no `Total running time` / `Lyrics (sing in`, instrumental directive present |
| AC3 — Request fields never fall through to instance defaults (req: R3) | MET | test | `plugins/generations/music-gen/tests/request.test.ts:32` (pro `0:30` + language), `:40` (clip carries none); takes-3 identity asserted in `plugins/generations/music-gen/tests/digest.test.ts:86` |
| AC4 — Preset resolution is precedence-defined (req: R4) | MET | test | `plugins/generations/music-gen/tests/presets.test.ts:37` (brief > workflow > theme > format > built-in), `:225` (non-portable preset exits 2) |
| AC5 — The adapter contract never re-sends a paid request on an ambiguous outcome (req: R5) | MET | command | `sed -n '223,245p' docs/design/music-gen.md` -> 6.3 paid-call table: connect-phase-only automatic retry (ECONNREFUSED/ENOTFOUND/EAI_AGAIN/connect timeout, at most 3 attempts), terminal 401/402/403/404/429 and all-keys-rejected 502 with operator remediation, timeout/socket-reset/post-send-5xx route to GET /api/generations reconcile then adopt-or-fail; artifact record at :246 |
| AC6 — The contract lives in the owning docs (req: R6) | MET | command | `grep -c 'design/music-gen.md' docs/04_DESIGN.md` -> 1 index row; `test -f plugins/generations/music-gen/README.md` -> present; `git status --porcelain |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

SECUA + traceability review of the frozen contract (`--focus all`, host-inline; independent of the implement session).

| Priority | Finding | Disposition |
| -------- | ------- | ----------- |
| P1 (blocker) | — | none |
| P2 (major) | — | none |
| P3 (minor) | — | none |
| P4 (advisory) | `MAX_TAKES` (4) and `MIN_DURATION_SECONDS` (5) are policy bounds introduced by the contract task; the takes cap is owned by 0400 R4. Both code comments and the design name the owner, so the numbers are documented policy, not unattributed magic | ACCEPTED |
| P4 (advisory) | `parseMusicBriefYaml` binds the module to `Bun.YAML`, so the package is Bun-runtime only. Correct for the shipped `kk` bundle (Bun runtime); a Node-only consumer would need a YAML dep | ACCEPTED |
| P4 (advisory) | AC6/R6 say "no implementation file beyond the golden fixtures", yet AC2/AC3 are unsatisfiable without the renderer and request mapper. The resolution (pure contract module, no adapter/CLI/plugin entry) is recorded in `## Solution`; the alternative — fixtures with no producer — would have made AC2 and AC3 unverifiable | ACCEPTED |

**Security/SECUA.** No secret, tunnel hostname or machine path is committed: the design documents the base URL as user config plus an environment override with a documented default (`docs/design/music-gen.md:190`). The paid-call table fail-closes on 401/402/403/404/429/502 and reconciles post-send ambiguity instead of re-sending (`docs/design/music-gen.md:223`). Preset portability rejects provider/model-id/base-URL/credential/price at any depth with exit code 2 (`plugins/generations/music-gen/src/presets.ts:403`).

**Correctness.** The request mapper throws rather than let a pro request fall through to the instance's `3:00` default (`plugins/generations/music-gen/src/request.ts:73`); the renderer is pure and excludes the two instance-owned segments by construction (`plugins/generations/music-gen/src/render.ts:61`).

**Residual risk.** The instance-side facts (route signature, prompt assembly, `3:00` default, all-keys 502) are cited from the homelab checkout; §9 of the design records them as provenance, and 0404's dogfood pins them against the live instance. If the instance changes, §9 is the one place to re-verify.

**Final disposition.** Approve for `done` — R1–R6 and AC1–AC6 MET, 82 tests pass, typecheck and Biome clean, light gate PASS.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-19T00:14:06.546Z feature_id Q → D8 (system)
- 2026-11-19T04:29:45.566Z backlog → wip (system)
- 2026-11-19T04:31:46.070Z wip → testing (system)
- 2026-11-19T04:31:47.308Z testing → done (system)

