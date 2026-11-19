---
schema_version: 1
name: Define the music brief, preset-resolution and lyria instance adapter contract
status: backlog
template: feature-impl
created_at: 2026-11-18T22:16:10.470Z
updated_at: "2026-11-19T00:14:06.546Z"
feature_id: D8

ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 6
---

## 0397. Define the music brief, preset-resolution and lyria instance adapter contract

### Background

Implements: R1 — brief schema; R2 — prompt-text render order; R3 — request mapping without instance defaults; R4 — preset resolution; R5 — adapter contract; R6 — recorded in the owning docs.

The homelab Mac Mini runs a self-hosted Lyria 3 studio at `xprojects/gitops/homelab/lyria-3-pro` (native Node process, managed checkout pinned at upstream `ef8b16f4`). Its REST surface is the only Lyria 3 access we own: `POST /api/lyria/generate` takes `prompt, lyrics, language, durationTarget, model: pro|clip, format, images≤10, title, batchCount` (`homelab/lyria-3-pro/app/server/lyria.ts:678-689`), persists a manifest per take, and serves `GET /api/generations`, `POST /api/ai/analyze`, `POST /api/ai/modify`, `POST /api/ai/enhance-prompt`, plus project routes. It has **no authentication** and is bound to the LAN (later: Cloudflare Access in front).

knowledge-kit has no music capability today: `plugins/generations/*` covers images (`image-gen`) and speech (`voice-gen`, `gemini-tts`, `voxcpm-tts`, `omni-voice-gen`), and `plugins/kk/skills/audio-authoring` authors *spoken* scripts, not music. No MCP server exists for a self-hosted instance; the public ones (`bthurlow/artificer-mcp`, Google's `mcp-lyria-go`, useapi's hosted Flow Music MCP) call Google directly and would bypass the instance's key handling, library and manifest provenance.

Two facts from the instance's own documentation constrain every later task: the prompt is the only control surface — no structure/tempo/vocal/duration parameters and no `negative_prompt`, so exclusions must be rendered as prompt text (`app/docs/guide/02-prompting-guide.md:3,42-44`); and duration is prompt text only, honoured loosely (`app/docs/guide/02-prompting-guide.md:62-77`). Both must be encoded in the brief contract now, because a wrong schema propagates to the plugin, the presets, the skill and the workflow.

### Requirements

- [ ] R1. Define a `MusicBrief` schema (Zod + YAML authoring form) that is the single input document: `title`, `model` (`pro|clip`), `duration_target` (`m:ss`), `language`, `instrumental`, `theme`, `format`, `style` (technical direction), `avoid[]`, `structure[]` (`at`, `section`, `note`), `lyrics`, `images[]`, `takes`, and `meta`. Every field either renders into kk's prompt text or maps to exactly one request field, and the mapping is total — no field may be silently dropped.
- [ ] R2. Specify the exact render order of the **prompt text kk sends** (the instance's PROMPT box): technical direction → `Avoid: …` (omitted when the merged list is empty) → timestamped structure lines → `Instrumental only — no vocals.` when `instrumental: true`. kk must **not** render the duration sentence or the `Lyrics (sing in <LANG>):` block: the instance's `assembleLyriaPrompt` appends both server-side (`homelab/lyria-3-pro/app/server/lyria.ts:9-26`, `app/docs/guide/04-app-integration.md` "Prompt assembly"), so rendering them in kk would duplicate them. Pin golden fixtures for a pro brief, a clip brief, an instrumental brief and a lyrics-free brief, each pinning both the prompt text and the request JSON.
- [ ] R3. Specify the request mapping with no reliance on instance defaults: `durationTarget` is always sent for `model: pro` (the instance substitutes `'3:00'` when absent, `lyria.ts:1011,1028`, which would silently turn a 0:30 jingle into a 3:00 request) and never for `clip`; `language` is always sent (instance default `EN`); `instrumental: true` sends `lyrics: ''`; `batchCount` is sent as metadata only — the instance makes exactly one provider call per request and records `batchCount` verbatim (`lyria.ts:1096,1113`), so N takes are N sequential kk requests.
- [ ] R4. Specify preset resolution as pure precedence — explicit brief value > workflow preset > theme default > format default > built-in default — over a `format × theme` data model whose files may not contain a provider, API base URL, API model id, or price (the instance maps `pro|clip` to a model id; prices are provider-specific and live in user config, see 0400).
- [ ] R5. Specify the adapter contract against the instance: base URL resolution (user config root with an env override and a documented default), timeouts sized for a 30–120 s blocking generation, how the authoritative audio format is taken from the response, where the artifact and instance generation id are recorded, and a **non-idempotent call policy** for paid routes (`/api/lyria/generate`, `/api/ai/analyze`): automatic retry only for connect-phase failures (connection refused / DNS) where the request provably never reached the instance; `401/402/403/404/429` and the instance's all-keys-rejected `502` (`app/docs/guide/04-app-integration.md:53`) are terminal; a timeout, socket reset or other `5xx` after the request was sent triggers **reconciliation** — look up the instance library (`GET /api/generations`) for a take with the same prompt, model and `generatedAt` ≥ request start, adopt it if found, otherwise fail and require an operator `--force` re-run. Never re-send a paid request on an ambiguous outcome.
- [ ] R6. Record the contract in the owning docs — a `docs/design/` satellite referenced from `docs/04_DESIGN.md`, plus the `plugins/generations/music-gen/README.md` skeleton — and open an ADR only if a platform invariant (generator contract, preset resolution, spend policy) actually changes. No implementation code in this task beyond the four golden fixtures.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-19T00:14:06.546Z feature_id Q → D8 (system)

