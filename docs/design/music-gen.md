# music-gen — brief, preset resolution and Lyria instance adapter contract

Feature **D8**. Generator plugin `plugins/generations/music-gen` that turns a `MusicBrief` into
music through the self-hosted Lyria 3 instance on the homelab Mac Mini
(`POST /api/lyria/generate`). Frozen by task **0397**; implemented by 0398 (plugin + adapter), 0399
(presets), 0400 (spend guard), 0401 (`kk music`), 0402 (skill/rubric), 0403 (workflow), 0405
(measure/normalize).

> Chosen approach: one authored YAML brief, one deterministic prompt renderer, one request mapping
> with no instance defaults, pure preset precedence over portable data, and a non-idempotent paid-call
> policy that reconciles instead of retrying. No new plugin kind, no new core schema, no ADR — the
> generic `kind: generator` seam and the `doc/01_PRD` music capability already cover it. Authority for
> the generic contract: [generator-plugin-specification.md](generator-plugin-specification.md).

Authority split: **this document** owns the wire contract (schema, render order, request mapping,
precedence, adapter contract, failure table, environment variables, artifact record).
**`plugins/generations/music-gen/README.md`** owns the YAML authoring form and the preset index — it
is not a second schema.

Implementation of record: `plugins/generations/music-gen/src/` (pure: no HTTP, no adapter, no CLI).
The four golden fixtures under `tests/fixtures/` pin the prompt text and the request JSON.

---

## 1. Decisions

| ID | Choice | Rejected | Why |
| ---- | -------- | ---------- | ----- |
| C1 | kk renders the **PROMPT box text only**; `durationTarget`, `lyrics` and `language` travel as fields | Render the full prompt in kk and send empty fields | The instance's `assembleLyriaPrompt` appends the duration sentence and the `Lyrics (sing in <LANG>):` block server-side, and defaults a missing `durationTarget` to `3:00`; kk-rendered duplicates would be sung/read as lyrics |
| C2 | Deterministic renderer, fixed segment order, one segment per line | Let an author free-write one prompt blob | Byte-identical re-renders are the precondition for the digest (C6) and for a reviewable diff between takes |
| C3 | `durationTarget` always for `pro`, never for `clip`; `language` always | Let the instance default them | A silent `3:00` turns a 0:30 jingle into a three-minute paid request; `EN` is a silent language decision |
| C4 | `takes: N` = N sequential single-take requests, `batchCount: 1` on each | One request with `batchCount: N` | The instance makes exactly one provider call per request and records `batchCount` verbatim — it is a label, not a multi-sample knob |
| C5 | Preset resolution is pure precedence over portable data | Presets that name a provider/model id/price; provider registry | One instance, one key holder; prices are provider-specific and live in user config (0400). A registry would be speculative (0398 D1) |
| C6 | Digest input is the canonical request **plus the take index** | Digest of the brief alone; digest without a take index | The digest must be the same for a re-run of the same request and different for the N takes of one run — `takes: N` renders N identical requests (C4), so an index-free digest would make run-scoped dedupe refuse take 2..N |
| C7 | Paid calls: connect-phase retry only, post-send ambiguity reconciles against `GET /api/generations` | Blind retry with backoff | A 30–120 s blocking call that times out may already be billed and persisted; a retry double-bills |
| C8 | `avoid` is the one **additive** field; every other field replaces | Merge everything, or replace everything | An authored exclusion must not switch off the theme's cliché guard; a merged structure skeleton with two `0:00` starts cannot be rendered |
| C9 | No ADR | ADR for "music as generator output" | A `kind: generator` plugin with `format: 'audio'` extends the existing seam (`voice-gen` precedent); two-way door |

---

## 2. Brief schema

`MusicBriefSchema` in `plugins/generations/music-gen/src/brief.ts` is the single schema (Zod, strict —
an unknown key is a parse error, never a silent drop). The authoring form is in the plugin README.

Every field has exactly one target: a prompt segment, a request field, a preset-resolution input, or a
recording slot. `BRIEF_FIELD_TARGETS` is the machine form of this table and a test asserts it covers
`MusicBriefSchema.shape` exactly.

| Field | Type | Required | Prompt segment | Request field | Resolution input | Recorded in |
| ----- | ---- | -------- | -------------- | ------------- | ---------------- | ----------- |
| `title` | string | yes | — | `title` | — | sidecar |
| `model` | `pro \| clip` | no | — | `model` | yes | sidecar |
| `format` | preset name | yes | — | — (see `audio_format`) | yes | resolved job (`explain`) |
| `theme` | preset name | yes | — | — | yes | resolved job (`explain`) |
| `duration_target` | `m:ss` | Pro: from some layer | — | `durationTarget` (pro only) | yes | sidecar; 0405 measures the file against it |
| `language` | short tag | no (default `EN`) | — | `language` | yes | sidecar |
| `instrumental` | boolean | no (default `false`) | `Instrumental only — no vocals.` | `lyrics: ""` | yes | sidecar |
| `audio_format` | `mp3 \| wav` | no (default `mp3`) | — | `format` | yes | sidecar |
| `style` | text | from some layer | segment 1 — technical direction | — | yes | sidecar (via rendered prompt) |
| `avoid` | string[] | no | segment 2 — `Avoid: …` (omitted when empty) | — | yes (additive) | sidecar (via rendered prompt) |
| `structure` | `{at, section, note?}[]` | no | segment 3 — `[m:ss] Section — note` lines | — | yes (replaced) | sidecar (via rendered prompt) |
| `lyrics` | text | no | — | `lyrics` | — | sidecar |
| `images` | path[] (≤10) | no | — | `images` | — | sidecar |
| `takes` | int 1..4 | no (default 1) | — | `batchCount: 1` per request | — | N requests + sidecar |
| `meta` | mapping | no | — | never sent | — | sidecar only |

Schema-level rules that exist because a wrong brief would otherwise reach a paid call:

- `duration_target` is `m:ss` and inside `0:05–3:00` (the Pro ceiling). A target the model cannot
  honour is an authoring error, not a request to send anyway.
- `structure` timestamps must be non-decreasing; `at` must be `m:ss` (`0:8` is rejected, `00:08` is
  accepted).
- `instrumental: true` plus non-blank `lyrics` is rejected: the lyrics would be dropped silently,
  which is exactly the failure mode the total mapping forbids.
- `takes` ≤ 4 (the 0400 hard cap) and `images` ≤ 10 (the instance's per-request limit).

**Naming collision, resolved deliberately.** The instance's generate route takes a field called
`format` that selects the **audio container**; the brief's `format` names the **format preset**
(`song`, `jingle`, `underscore`, …). The brief therefore carries both: `format` (preset axis, never
sent) and `audio_format` (sent as the wire `format`). R1's field list named only `format`; without
`audio_format` the wire field would have no originating brief field and AC1 would be unsatisfiable.

---

## 3. Render order (R2)

`renderPromptText` emits the kk-owned PROMPT text as consecutive lines — one segment per line, no
blank line inserted between segments (interior blank lines of `style` are preserved):

1. **Technical direction** — the resolved `style` block, trailing spaces trimmed per line, leading and
   trailing blank lines dropped.
2. **`Avoid: <a, b, c>`** — the merged, de-duplicated deny-list; the whole segment is omitted when the
   list is empty.
3. **Timestamped structure** — one `[m:ss] Section` or `[m:ss] Section — note` line per entry, in
   authored order.
4. **`Instrumental only — no vocals.`** — only when `instrumental` is true.

kk must never emit:

| Marker | Owner | Why |
| ------ | ----- | --- |
| `Total running time` | instance (`assembleLyriaPrompt`) | The instance appends the duration sentence from `durationTarget`; a kk copy would be a second, possibly conflicting instruction |
| `Lyrics (sing in <LANG>):` | instance (`assembleLyriaPrompt`) | The instance wraps the `lyrics` field in that header; a kk copy would duplicate the whole lyric block |

Both markers are exported as `INSTANCE_OWNED_PROMPT_MARKERS` and asserted absent in every golden. They
are assertions, not a render-time rejection: the words may legitimately appear inside an author's
technical direction.

Why this shape: the prompt text is the model's **only** control surface. There is no structure, tempo,
vocal, duration or `negative_prompt` parameter, so exclusions and section boundaries have to be prompt
text. `durationTarget` nevertheless travels as a field because the instance turns it into its own
sentence — the same value, one writer [[unverified: `app/docs/guide/02-prompting-guide.md:3,42-44`,
`app/server/lyria.ts:9-26`]](#9-provenance-of-the-instance-facts).

---

## 4. Request mapping (R3)

`renderGenerateRequest` produces exactly the body 0398 posts to `POST /api/lyria/generate`. Key order
is pinned by the goldens:

```json
{
    "prompt": "<kk prompt text>",
    "lyrics": "<authored lyrics>",
    "language": "EN",
    "model": "pro",
    "durationTarget": "0:30",
    "format": "mp3",
    "title": "Midnight Cable Car",
    "batchCount": 1
}
```

| Rule | Behaviour |
| ---- | --------- |
| `prompt` | Always the rendered prompt text; never empty (an unresolved `style` fails resolution first) |
| `lyrics` | Authored text verbatim; `""` when `instrumental: true`; **omitted** when the brief has no lyrics (let the model write its own) |
| `language` | Always present. kk's built-in default is `EN`, so the value is explicit even when the instance would have defaulted to the same tag |
| `model` | `pro` or `clip`, resolved by precedence |
| `durationTarget` | **Pro: always.** Clip: **never**, even when the brief carries one — clip ignores duration |
| `format` | The requested audio container (`mp3`/`wav`). The **response** is authoritative for the delivered format (0398 detects it from the bytes) |
| `title` | The brief title; the instance uses it as the library title |
| `batchCount` | Always `1`. It is a recorded label, not a multi-sample parameter — `takes: N` issues N sequential requests |
| `images` | Reference image paths in brief order; omitted when empty. 0398 encodes them for the wire |

A clip job is fixed at about 30 s and ignores duration language, so a clip brief whose
`duration_target` is outside 25–35 s fails resolution instead of pretending the target will be honoured
[[unverified: `app/docs/guide/01-lyria-models.md:32`]](#9-provenance-of-the-instance-facts).

---

## 5. Preset resolution (R4)

`resolveJob(brief, {workflow, theme, format})` is a pure function over four layers plus built-ins:

```text
brief value > workflow preset > theme preset > format preset > built-in default
```

- Each resolved field carries `{value, source, origin}` and `explainJob` prints one line per field
  naming the layer that won (`duration_target: 0:45 (format preset "underscore")`). 0399 R3 prints
  those lines; 0401 shows them on a refusal. An unknown preset name is a resolution error — never a
  silent fallback.
- Built-in defaults: `model: pro`, `language: EN`, `instrumental: false`, `audio_format: mp3`.
  **`style` and `duration_target` have no built-in default on purpose**: an unresolved `style` means
  the prompt would carry no direction, and an unresolved Pro `duration_target` would let the instance
  substitute `3:00`. Both fail loudly with a diagnostic naming the whole chain.
- `instrumental` also resolves from a format preset's `lyrics_policy` (`forbidden` → true,
  `allowed` → false), which is how 0399's per-format lyrics policy reaches the brief. Forcing `instrumental` while the brief carries lyrics is a resolution error, never a silent drop.
- `avoid` is additive: brief entries, then workflow, theme and format entries, de-duplicated
  case-insensitively, first spelling kept. `structure` is replaced, never merged.
- Preset files are **portable data**. `assertPresetPortable` walks the whole document and rejects any
  of `FORBIDDEN_PRESET_KEYS` — `provider`, `model_id`/`apiModelId`/`api_model_id`, `base_url`/
  `apiBaseUrl`/`endpoint`, `price`/`prices`/`unit_price`/`cost`, and credential keys (`api_key`,
  `secret`, `token`) — at any depth, aggregating every dotted violation path.
  `PresetContractViolation.exitCode` is `2`, and the loader must surface it as a non-zero exit (a test
  spawns the loader to prove it). `model: pro|clip` is the instance's own selector and stays legal.

Why the whole `format × theme` model is data: the operator can improve a preset without touching code,
and a preset cannot smuggle in a provider identity or a price that the spend guard (0400) must own.

---

## 6. Adapter contract (R5)

Implemented by 0398; frozen here.

### 6.1 Base URL and configuration

| Setting | Env override | Config key (kk user config) | Default |
| ------- | ------------ | --------------------------- | ------- |
| Instance base URL | `KK_MUSIC_INSTANCE_URL` | `music.instance.url` | `http://127.0.0.1:3000` |
| Generate timeout (ms) | `KK_MUSIC_TIMEOUT_MS` | `music.instance.timeoutMs` | `180000` |
| Connect-phase timeout (ms) | — | `music.instance.connectTimeoutMs` | `5000` |
| Offline adapter | `KK_MUSIC_DRY_RUN=1` | — | unset (live) |
| Unit prices | — (0400) | `music.prices.{pro,clip,analyze}` | `pro 0.08`, `clip 0.04`, `analyze` **unpriced** |
| Take cap | — (0400) | `music.takesCap` | `2`, never above `4` |

- The user config file is the existing kk config: `KK_CONFIG` or `~/.config/kk/config.yaml`, one reader
  (`packages/kk-store/src/config.ts:244`), with the music block under `music:`. There is no second
  config file and no committed secret, hostname or machine path (feature R7).
- Precedence per setting: env override > config value > documented default. A missing file yields the
  defaults; a present key of the wrong type throws (the `store.*` reader's rule).
- The default base URL is **provisional**: it assumes the instance listens on loopback port 3000. The
  deploy config lives in the homelab checkout, which was not available while freezing this contract
  (§9); 0404's dogfood pins the real value. The env override is the supported path in the meantime.
- Timeouts are sized for a **30–120 s blocking generation**: 180 s end-to-end so a slow-but-successful
  request is not cut off, 5 s connect so an unreachable host fails fast enough to retry (C7).

### 6.2 Response handling

- The authoritative **audio format** is detected from the returned bytes (magic bytes / content type),
  never assumed from the request's `format` field. `Content.format` is `'audio'`; the container lands
  in the artifact record.
- The **instance generation id** from the response manifest is the provenance key; with the SHA-256
  request digest it makes every take traceable to the instance library without copying that library
  into a kk workspace.
- A response that parses but carries no audio is treated as an **ambiguous post-send outcome** and
  goes to reconciliation (6.3), not to a retry.

### 6.3 Paid-call policy (AC5)

Paid routes: `POST /api/lyria/generate` and `POST /api/ai/analyze`. They are **non-idempotent**: the
instance may have billed and persisted a take even when kk never saw the response. The instance already
fails over across its own key list and refuses to fail over on request-level errors "so the account is
not billed twice" [[unverified: `app/docs/guide/04-app-integration.md:53`]](#9-provenance-of-the-instance-facts);
kk adds **no second failover layer** — only the two edges below.

| Condition | Phase | Automatic action | Operator remediation |
| --------- | ----- | ---------------- | -------------------- |
| `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, connect timeout | connect — the request provably never reached the instance | Retry with backoff, bounded to 3 attempts total | Instance down or wrong base URL: start the instance or fix `music.instance.url` / `KK_MUSIC_INSTANCE_URL` |
| `400` | post-send, request rejected | None — terminal | Fix the brief/request; the instance's own error text is surfaced verbatim |
| `401` | post-send | None — terminal | Rotate/fix the provider key on the instance (never print it) |
| `402` | post-send | None — terminal | Provider credits/entitlement exhausted; top up or switch the instance's key |
| `403` | post-send | None — terminal | Key/project restriction on the instance |
| `404` | post-send | None — terminal | Route/model mismatch: check the base URL and `model` |
| `429` | post-send | None — terminal | Rate limited: wait, then re-run. kk never retries a `429` |
| `502` with the instance's all-keys-rejected body | post-send | None — terminal | Fix the instance's key list; every provider key it holds was rejected |
| Timeout after send, `ECONNRESET`, any other `5xx`, malformed `200` | post-send — **ambiguous** | **Reconcile**: `GET /api/generations`, match a take whose `prompt` equals the sent prompt byte for byte, whose `model` matches, and whose `generatedAt` ≥ request start. Adopt the earliest match and flag `adoptedByReconciliation`; record extra matches as `unclaimed` so the operator sees the spend | No match: fail with a diagnostic naming the endpoint, the elapsed time and the `--force` remediation. A re-run is paid again, so `--force` records its reason |

Terminal means: one request sent, no retry, the instance's own error text plus the remediation in the
message. Ambiguous means: never re-send; reconcile, adopt or fail.

### 6.4 Artifact record

One artifact per take plus one sidecar, in the job's run directory (never a mirror of the instance's
`generations/` library):

```jsonc
// <artifact>.take.json
{
    "digest": "<sha256 of canonicalDigestJson>",   // 0397
    "digestInput": { /* MusicDigestInput */ },      // 0397
    "instanceId": "<instance generation id>",       // 0398
    "model": "pro",                                 // 0397/0398
    "format": "mp3",                                // 0398 — detected, not requested
    "request": { /* the exact request body */ },    // 0397
    "requestedFormat": "mp3",                       // 0397 (audio_format)
    "language": "EN",                               // 0397
    "durationTarget": "0:30",                       // 0397 (absent for clip)
    "batchCount": 1,                                // 0398 — echoed as the instance recorded it, absent when absent
    "takeIndex": 0,                                 // 0397
    "unitPrice": 0.08,                              // 0400
    "adoptedByReconciliation": false,               // 0398
    "unclaimed": [],                                // 0398 — extra library matches
    "forced": false,                                // 0400
    "reason": null,                                 // 0400
    "createdAt": "<iso>",                           // 0398
    "generatedAt": "<instance iso>",                // 0398
    "checks": { /* measurements */ }                // 0405
}
```

Ownership is per field so 0398/0400/0405 extend the record instead of inventing a second one.

---

## 7. Digest input (C6)

`digestInput(job, {imageHashes, takeIndex})` → `canonicalDigestJson` → SHA-256 hex. Frozen so 0400
never re-derives it.

```json
{
    "model": "pro",
    "prompt": "<kk prompt text>",
    "lyrics": "<text or null>",
    "durationTarget": "0:30",   // null for clip
    "language": "EN",
    "images": ["<sha256 hex>", "…"],
    "takeIndex": 0
}
```

- Absent values are `null`, never omitted, so a missing field cannot alias a present empty one.
- `images` holds **content hashes** in brief order (the model sees image order; the adapter hashes the
  bytes). Supplying no hashes for a brief that carries images is an error — a digest is never computed
  from a guess.
- `takeIndex` makes the N takes of one run distinct while a re-run of the same request collides, which
  is what run-scoped dedupe needs. This extends the Design bullet ("prompt + lyrics + model +
  durationTarget + language + image hashes") by one field for the reason in C6.

---

## 8. Module layout

```text
plugins/generations/music-gen/
  package.json                # @gobing-ai/music-gen (zod); 0398 adds plugin.json + entry wiring
  tsconfig.json               # tsc --noEmit typecheck target
  README.md                   # YAML authoring form + preset index (no second schema)
  src/brief.ts                # MusicBriefSchema, m:ss helpers, BRIEF_FIELD_TARGETS
  src/render.ts               # renderPromptText / renderBriefPrompt, frozen segment order
  src/request.ts              # renderGenerateRequest / renderTakeRequests, no instance defaults
  src/presets.ts              # resolveJob / explainJob / assertPresetPortable / loadPresetFile
  src/digest.ts               # digestInput / canonicalDigestJson / takeDigest
  src/index.ts                # the published contract surface
  tests/                      # bun:test + fixtures/<name>/{brief.yaml,prompt.txt,request.json}
```

Nothing in `src/` opens a socket: the HTTP adapter is 0398's `src/adapter/`. `loadPresetFile` reads a
YAML file through `Bun.file` and is the only IO in the module.

---

## 9. Provenance of the instance facts

This contract was frozen without the instance checkout. `homelab/lyria-3-pro` was expected at
`~/xprojects/gitops/homelab/lyria-3-pro`; that path does not exist in the build environment, and the
operator's `gitops` checkout (`~/projects/gitops`) contains no `lyria-3-pro` tree. Every claim below is
therefore marked, and nothing in this document pretends otherwise.

**Verified in this repository** (repo-relative, checked while writing this doc):

- `packages/kk-store/src/config.ts:244` — `KK_CONFIG` / `~/.config/kk/config.yaml` is the one kk user
  config reader; the `music:` block rides it.
- `plugins/generations/image-gen/src/presets.ts:301,313` and `src/index.ts:358` — the preset-root env
  override and dry-run env-var precedents this contract follows.
- `plugins/generations/music-gen/src/` — the schema, renderer, request mapping, resolution and digest
  behaviour described above, pinned by `tests/fixtures/`.

**Cited from the instance checkout, unverified here** (paths are relative to
`homelab/lyria-3-pro`, upstream `ef8b16f4`; 0398 confirms them against the running instance before
declaring the adapter done):

| Claim | Citation |
| ----- | -------- |
| Prompt is the only control surface; no structure/tempo/vocal/duration parameter, no `negative_prompt` | `app/docs/guide/02-prompting-guide.md:3,42-44` |
| Duration is prompt text only and honoured loosely | `app/docs/guide/02-prompting-guide.md:62-77` |
| `assembleLyriaPrompt` appends the Pro duration sentence and the `Lyrics (sing in <LANG>):` block | `app/server/lyria.ts:9-26`; `app/docs/guide/04-app-integration.md` "Prompt assembly" |
| Generate route body: `prompt, lyrics, language, durationTarget, model, format, images≤10, title, batchCount` | `app/server/lyria.ts:678-689` |
| `durationTarget` defaults to `'3:00'` when absent; `language` defaults to `EN` | `app/server/lyria.ts:1007-1028` |
| `batchCount` is recorded verbatim; one provider call per request | `app/server/lyria.ts:1096,1113` |
| All-keys-rejected `502`; no failover on request-level errors | `app/docs/guide/04-app-integration.md:53` |
| Clip is fixed at about 30 s and ignores duration | `app/docs/guide/01-lyria-models.md:32` |
| Per-generation analysis is cached | `app/docs/guide/03-api-integration.md:68` |

**Provider-level cross-check** (public Lyria 3 docs, read from the operator's vendored reference
`vendors/OpenMontage/.agents/skills/lyria/references/api-and-prompting.md`, gitignored in this tree):
Pro `lyria-3-pro-preview` `$0.08`, Clip `lyria-3-clip-preview` `$0.04`, Clip always 30 s, Pro up to
roughly three minutes, MP3 by default with WAV requestable, single-turn. These corroborate the brief's
price and duration assumptions; they are not evidence about the instance's own routes.

Consequence: **no unverified instance behaviour may be claimed as tested.** The 0404 dogfood is the
first place a live call is evidence.

---

## 10. Deferred

- Lyria RealTime streaming, stems, extend/cover/remix — the instance is single-turn.
- A per-format explore-model override — re-open only on evidence that Clip predicts Pro.
- Channel delivery loudness profiles — deferred until a publish platform for music is chosen (0405 owns
  the mechanism).
- Any creative mastering (EQ, compression, stereo imaging) — "master" here is loudness/true-peak
  normalization only.
