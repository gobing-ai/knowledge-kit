---
schema_version: 1
name: Inventory baoyu provider adapters and define the kk ImageProvider interface
status: done
template: feature-impl
created_at: 2026-09-09T18:28:03.499Z
updated_at: "2026-10-10T00:29:31.007Z"
feature_id: K

ac_altitude: task-local
done_forced: "true"
done_reason: "Verify verifier verdict PASS (all 6 R + 10 AC MET, tracked Testing section (scratch verdict not retained) + 0103-verify-answer.txt). Derivation downgraded to PARTIAL solely on the executable-evidence default: AC1/AC8/AC10 are reviewer-adjudication ACs by their own Given/When/Then and AC2 is a lint+grep gate - manual is their honest evidence type. Batch run: runall-k-f5193541 (inline driver)."
---

## 0103. Inventory baoyu provider adapters and define the kk ImageProvider interface

### Background

**Ticket type: `wayfinder:research`** — map K, frontier (unblocked). Depended on by 0104 (which providers a job can call) and 0105 (which providers accept a reference image).

Operator decision on the map: **port baoyu's full provider matrix**, not a 3-provider subset. This ticket answers *how much work that is and in what shape*. **It does not write the adapters.**

**Evidence, verified against the tree on 2026-09-09.** Two claims in the pre-refinement draft were wrong and are corrected here.

*The adapters — there are **12**, not 13.* `vendors/baoyu-skills/skills/baoyu-image-gen/scripts/providers/`, one `.ts` + one co-located `.test.ts` each. The `Provider` union at `scripts/types.ts:1-13` confirms the same 12:

| Adapter | src LOC | test LOC | Has a `references/providers/*.md` doc |
| --- | ---: | ---: | --- |
| `dashscope` | 625 | 392 | yes |
| `replicate` | 616 | 310 | yes |
| `jimeng` | 467 | 115 | no |
| `openai` | 444 | 179 | no |
| `openrouter` | 372 | 169 | yes |
| `google` | 351 | 130 | no |
| `seedream` | 341 | 245 | no |
| `zai` | 306 | 181 | yes |
| `minimax` | 220 | 175 | yes |
| `codex-cli` | 197 | 62 | yes |
| `azure` | 192 | 189 | no |
| `agnes` | 175 | 213 | yes |
| **total** | **4306** | **2360** | 7 of 12 |

Plus `scripts/main.ts` (1293 LOC: arg parsing, provider selection, EXTEND.md loading, batch scheduling with per-provider rate limits, output naming, retry) and `scripts/codex-imagegen/` (6 files — the `codex exec` subprocess driver `codex-cli` delegates to).

*The de-facto adapter interface is a **module shape**, not a class* (`scripts/main.ts:15-20`):

```ts
type ProviderModule = {
  getDefaultModel: () => string;
  generateImage: (prompt: string, model: string, args: CliArgs) => Promise<Uint8Array>;
  validateArgs?: (model: string, args: CliArgs) => void;
  getDefaultOutputExtension?: (model: string, args: CliArgs) => string;
};
```

Consequences the pre-refinement draft missed:

- **There is no `isAvailable()`.** Availability is discovered by throwing at call time (`openai.ts:286-290` throws when `OPENAI_API_KEY` is unset; `google.ts:36-38` reads `GOOGLE_API_KEY || GEMINI_API_KEY`). An `isAvailable()` in the kk interface is a **new** method that must be written for all 12, not ported.
- **Reference images are already unified into the same call.** `CliArgs.referenceImages: string[]` (`types.ts:31`) rides into `generateImage`; `google.ts:330-351` branches on it and rejects the combination for Imagen models. There is no separate reference-image entry point to design.
- **Every adapter depends on the whole `CliArgs`** — a 20-field CLI-shaped struct (`types.ts:15-36`) carrying `aspectRatio`, `size`, `quality`, `imageSize`, `imageApiDialect`, `responseFormat`, `n`, and even `json`/`help`. This is the crux of the port-effort question: a verbatim port drags that shape into kk.
- Adapters return **raw bytes** (`Uint8Array`), never a file path. File naming and writing are `main.ts`'s job — so they are kk's job (0104's).
- `codex-cli` is never auto-selected (`baoyu-image-gen/SKILL.md:218`); it must be pinned explicitly.

*Licence.* `vendors/baoyu-skills/LICENSE` is MIT, Copyright 2026 Jim Liu. Porting is legal with attribution; the remaining question is maintenance cost, which is the map's open question (c).

*In-repo precedent for the transport seam and its coverage:*

- `plugins/generations/voice-gen/src/voicebox-client.ts:36-60` — a `VoiceboxClient` interface plus `createVoiceboxClient(options)` taking **`fetch?: typeof fetch`** and `sleep?`. Tests build a `createMockClient(overrides)` (`tests/voice-gen.test.ts:88`) and pass it as `processGeneratorIO`'s `clientOverride`. This is the pattern that gets network code over 90% coverage in this repo.
- `packages/publish-harness/src/index.ts:16,36` — `PublishTransport` + `FakeFileCliTransport`. Note it is **publish-kind only**; it is a shape to imitate, not a package to reuse from a generator.

### Requirements

Produce, as the task's Design section:

- [x] R1. **Adapter inventory table** — one row per provider: models, aspect-ratio mechanism, reference-image (`--ref`) support, size/quality mapping, auth env vars, base-URL override, known dialect quirks, and a port-effort estimate (`verbatim` / `light-edit` / `rewrite`).
- [x] R2. **The `ImageProvider` TypeScript interface** — the minimal surface every adapter satisfies: `name`, `isAvailable()`, `generate(request)`, plus the shared `GenerationRequest` / `GenerationResult` types. Must span text-to-image *and* reference-image generation, since style-cloning (0105) depends on `--ref`.
- [x] R3. **Selection order** — explicit flag > only-key-present > priority list, and the rule for `codex-cli`-style never-auto-selected adapters.
- [x] R4. **Env var and config mapping** — how ~13 providers' credentials land in `~/.config/kk/config.yaml` under `plugins.generations.image-gen.env`, and whether that file is still the right home at this cardinality.
- [x] R5. **Coverage strategy** — how ≥90% line and function coverage is reached for adapters that cannot be hit live (fake transport, recorded fixtures, or the `@gobing-ai/publish-harness` fake-transport pattern already in this repo).
- [x] R6. **A phasing recommendation** — the matrix is fixed, but the *order* is not; name which 2–3 adapters land first so the pipeline is end-to-end runnable before the long tail.

This ticket answers *how much and in what shape*. It does not write the adapters.

### Acceptance Criteria

```gherkin
Task-local acceptance criteria. Feature K is a `wayfinder-map` and carries a prose no-AC disclaimer, so these scenarios are the executable contract for this ticket alone.

Scenario: The inventory covers every adapter on disk (R1)

- **Given** `vendors/baoyu-skills/skills/baoyu-image-gen/scripts/providers/` contains 12 non-test `.ts` files
- **When** the reviewer counts the rows in the inventory table in this task's `## Solution`
- **Then** there are exactly 12 rows, one per file, each naming the provider's models, aspect-ratio mechanism, reference-image support, size/quality mapping, auth env vars, base-URL override, dialect quirks, and a port-effort value from `verbatim` / `light-edit` / `rewrite`
- **And** every env var named in the table appears verbatim in that adapter's source (spot-check by `grep -n '<VAR>' <adapter>.ts`)

Scenario: The provider interface file compiles and exports the frozen names (R2)

- **Given** the repo checked out at this task's HEAD
- **When** `bun run lint` runs
- **Then** it exits 0
- **And** `plugins/generations/image-gen/src/providers/types.ts` exports `ImageRequest`, `ImageQuality`, `ImageResult`, `ImageProvider`, `ProviderOptions`, `ProviderFactory`, `PROVIDERS`, `AUTO_ORDER` and `selectProvider`
- **And** the file contains no adapter implementation — `grep -c 'async function generate' src/providers/types.ts` returns 0

Scenario: The interface spans reference-image generation (R2, feeds 0105)

- **Given** `ImageRequest` as exported
- **When** a caller supplies `referenceImages: ['/abs/a.png']`
- **Then** the type accepts it without a cast, and `ImageProvider.supportsReferenceImages(model)` is callable to decide whether that provider may be used
- **And** no second method or overload exists for the reference-image path

Scenario: An explicit unknown provider fails loudly (R3)

- **Given** `selectProvider` and the 12-entry `PROVIDERS` registry
- **When** it is called with `'stable-diffusion'`
- **Then** it throws, and the message contains all 12 valid provider names
- **And** it does not fall through to the auto list

Scenario: An explicit known-but-unconfigured provider fails loudly (R3)

- **Given** `OPENAI_API_KEY` is unset in the test environment
- **When** `selectProvider('openai')` is called
- **Then** it throws naming `openai` and the missing env var
- **And** it does **not** silently select a different provider

Scenario: Auto-selection follows the frozen order and skips codex-cli (R3)

- **Given** no `requested` argument and no `IMAGE_GEN_PROVIDER`
- **And** exactly two providers report `isAvailable() === true`: `replicate` and `openai`
- **When** `selectProvider()` is called
- **Then** it returns `'openai'` — the earlier of the two in `AUTO_ORDER`
- **And** with `codex-cli` the only available provider, `selectProvider()` throws instead of returning it

Scenario: `isAvailable()` performs no I/O (R2, R5)

- **Given** a `ProviderOptions.fetch` stub that throws if invoked
- **When** every registered provider's `isAvailable()` is called
- **Then** the stub is never invoked and no subprocess is spawned

Scenario: Credentials map to the plugin env block (R4)

- **Given** the inventory's env-var column
- **When** the reviewer reads the `config.example.yaml` block emitted by this ticket
- **Then** every env var from the table appears under `plugins.generations.image-gen.env`
- **And** the block carries a comment recording that `process.env` overrides it (`apps/cli/src/invoke.ts:133-137`)
- **And** the block contains no real credential value — every value is a placeholder

Scenario: Coverage strategy is demonstrated, not asserted (R5)

- **Given** `tests/providers.test.ts`
- **When** `bun run test` runs
- **Then** it passes, and the tests cover `selectProvider`'s four resolution paths and both failure paths using injected `isAvailable` stubs — no network call is made
- **And** the aggregate line and function coverage reported for the touched files is ≥90%

Scenario: The phasing recommendation is ordered and justified (R6)

- **Given** the 12-row inventory
- **When** the reviewer reads the phasing section
- **Then** it names the first 2–3 adapters explicitly, in order, with one sentence of justification each
- **And** every remaining adapter appears in a later phase — no adapter is unassigned
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-09T20:13:35.949Z

**Q: Vendor baoyu's adapters verbatim, or reimplement them against a kk-native interface?**
Open on the map as question (c); the operator owns it. **This ticket is not blocked by it.** The Design freezes `ImageRequest` so both answers land the same interface: a verbatim vendor keeps `CliArgs` behind a `toCliArgs()` shim inside each adapter, a reimplementation takes `ImageRequest` directly. The recommendation recorded in the Design is **reimplement, porting the wire logic verbatim**. Owner: operator. Deadline: before the first adapter ticket is created, not before this one closes.

**Q: `~/.config/kk/config.yaml` was designed for a handful of plugins — is it still the right home for 12 providers' credentials? (R4)**
Yes, and no new mechanism is added. `plugins.generations.image-gen.env` is a flat map; 12 entries is not a scale problem, and `process.env` still overrides it (`apps/cli/src/invoke.ts:133-137`), so a shell export wins for a one-off. The alternative — a per-provider credential file — would duplicate `invoke.ts`'s injection path for no gain. **Closed: keep `config.yaml`.**

**Q: Should this ticket write a `.env` loader like baoyu's `<cwd>/.baoyu-skills/.env`?**
No. baoyu's precedence chain puts `EXTEND.md` **above** environment variables (`baoyu-image-gen/SKILL.md:155`), the opposite of kk's process-env-wins rule. Importing it would give kk two contradictory precedence rules. Operators who want file-based credentials use `config.yaml`. **Closed: no.** The preference-file question that remains (styling defaults, not credentials) is 0106's R4.

**Q: Does `isAvailable()` risk reporting a provider ready when the key is stale?**
Yes, by construction — it is an env-presence check, not a credential probe. A live probe would cost a network round trip per provider on every run and, on some providers, money. The failure it does not catch surfaces as the adapter's own auth error at `generate()` time, which is exactly baoyu's behaviour today. **Closed: env-presence only, documented as such in the interface's doc comment.**

**Q: `n > 1` — does the interface return one image or many?**
`ImageResult` holds a single image. `n` is carried on `ImageRequest` because several providers accept it natively, but the v1 rule is that a caller wanting N images issues N calls and the adapter returns the first image. **Deferred to the adapter tickets** with owner = the implementer of the first multi-image-capable adapter (`openai`); if any adapter cannot honour `n: 1`, that adapter's ticket raises it. Nothing in 0104/0105/0106 depends on the answer.

**Q: Where do per-provider concurrency limits live (baoyu's `batch.provider_limits`)?**
Not here. Batching and rate limiting are `main.ts` concerns in baoyu, and in kk they are the **caller's** — a workflow node or 0104's job loop. The inventory records each provider's documented limit as a fact; nothing in this ticket enforces one. **Closed: record, do not implement.**

**Q: Does `ImageQuality` need more than `normal | 2k`?**
Not in v1 — those are the two baoyu exposes (`baoyu-image-gen/SKILL.md`), and every provider either maps them or ignores them. Adding a third value now would be a guess. **Closed: two values; the union is cheap to extend.**

### Design

**WHAT** — the 12-adapter inventory (R1), the frozen `ImageProvider` contract (R2), the
selection order (R3), the credential→config mapping (R4), the coverage strategy (R5), and the
phasing plan (R6). **No adapter bodies are written here.**

Delivered by this ticket:

- `plugins/generations/image-gen/src/providers/types.ts` — the frozen interface, the 12-entry
  `PROVIDERS` registry, `AUTO_ORDER`, and `selectProvider`.
- `plugins/generations/image-gen/tests/providers.test.ts` — selection order + I/O-free pins.
- `plugins/generations/image-gen/config.example.yaml` — the R4 credential fragment (placeholder
  values only). `plugins/kk/config.example.yaml` is **not** touched here; 0104 owns it.

#### R1 — Adapter inventory (12 rows, one per file in `vendors/baoyu-skills/skills/baoyu-image-gen/scripts/providers/`)

Env vars are verbatim from each source (`grep -n 'process.env' <adapter>.ts` audited 2026-09-09
against `/Users/robin/xprojects/knowledge-kit/vendors/…`, the main checkout — the vendored tree is
gitignored and absent from worktrees).

| Adapter | Models (default → override) | Aspect-ratio mechanism | `--ref` support | Size/quality mapping | Auth env vars | Base-URL override | Dialect quirks | Port effort |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `google` (351 loc) | `gemini-3-pro-image` → `GOOGLE_IMAGE_MODEL`; multimodal: gemini-3-pro-image, gemini-3.1-flash-image (+`-preview` variants); Imagen: imagen-3.0-generate-001/002 | Gemini: ratio appended into prompt text; Imagen: `parameters.aspectRatio` | Multimodal models only (`isGoogleMultimodal`); Imagen+refs rejected (`google.ts:336-344`) | `imageSize` 1K/2K/4K, else quality normal→1K / 2k→2K; `sampleCount=n` | `GOOGLE_API_KEY` \| `GEMINI_API_KEY` (+`GOOGLE_IMAGE_MODEL`, `GOOGLE_BASE_URL`, proxy vars) | `GOOGLE_BASE_URL` (generativelanguage.googleapis.com) | HTTP goes through `curl` **subprocess** when any proxy env is set (Node-fetch workaround, `google.ts:99-159`) — under Bun, drop the curl path and use injected `fetch` | light-edit |
| `openai` (444 loc) | `gpt-image-2` → `OPENAI_IMAGE_MODEL` | `getOpenAISize(model, aspectRatio, quality)` → pixel `size`; ratio-metadata dialect encodes ratio in metadata | `/images/edits`, gpt-image models only; dall-e+refs and ratio-metadata+refs throw (`openai.ts:298-310`) | size WxH else aspect+quality; `imageSize` 1K/2K/4K honoured | `OPENAI_API_KEY` (+`OPENAI_IMAGE_MODEL`, `OPENAI_BASE_URL`, `OPENAI_IMAGE_USE_CHAT`) | `OPENAI_BASE_URL` (api.openai.com/v1) | `imageApiDialect` native/ratio-metadata split; `OPENAI_IMAGE_USE_CHAT=true` reroutes via chat completions | light-edit |
| `azure` (192 loc) | deployment = `AZURE_OPENAI_DEPLOYMENT` else model; `gpt-image-2` → `AZURE_OPENAI_IMAGE_MODEL` | same OpenAI size mapping (shared helper) | Azure edits endpoint; `validateArgs` checks ref paths exist | size else aspect+quality | `AZURE_OPENAI_API_KEY` (+`AZURE_OPENAI_BASE_URL`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_IMAGE_MODEL`, `AZURE_API_VERSION`) | `AZURE_OPENAI_BASE_URL` (required resource endpoint) | model is addressed by deployment name; fixed api-version default `2025-04-01-preview` | verbatim |
| `openrouter` (372 loc) | `google/gemini-3.1-flash-image` → `OPENROUTER_IMAGE_MODEL` | `body.image_config.aspect_ratio` passthrough, inferred from size, validated per model | refs → base64 data URLs in chat content parts | `imageSize` 1K/2K/4K else quality; inferred from size | `OPENROUTER_API_KEY` (+`OPENROUTER_IMAGE_MODEL`, `OPENROUTER_BASE_URL`, `OPENROUTER_HTTP_REFERER`, `OPENROUTER_TITLE`) | `OPENROUTER_BASE_URL` (openrouter.ai/api/v1) | chat/completions-shaped image request; attribution headers | light-edit |
| `dashscope` (625 loc) | `qwen-image-2.0-pro` → `DASHSCOPE_IMAGE_MODEL`; families qwen2 / qwenFixed / wan27 (`wan2.7-image-pro`, `wan2.7-image`) / legacy | per-family pixel-size derivation from aspect+quality (`getWan27SizeFromAspectRatio` et al.) | wan27 only, ≤9 images (`WAN27_MAX_REFERENCE_IMAGES`); other families reject; wan27 forces n=1 | explicit size validated per family, else derived | `DASHSCOPE_API_KEY` (+`DASHSCOPE_IMAGE_MODEL`, `DASHSCOPE_BASE_URL`) | `DASHSCOPE_BASE_URL` (dashscope.aliyuncs.com) | four model families with separate size validators; multimodal-messages request body | verbatim |
| `seedream` (341 loc) | `doubao-seedream-5-0-260128` → `SEEDREAM_IMAGE_MODEL`; families by regex `doubao-seedream-{5-0,4-5,4-0,3-0-t2i}-<n>` | per-family: 5/4.5→2K, 4.0 quality→1K/2K, 3.0→1024/2048 square | seedream5/45/40, ≤14, known family required (endpoint IDs reject) | `size`/`imageSize` override, else family default | `ARK_API_KEY` — note: **not** `SEEDREAM_API_KEY` (+`SEEDREAM_IMAGE_MODEL`, `SEEDREAM_BASE_URL`) | `SEEDREAM_BASE_URL` (ark.cn-beijing.volces.com/api/v3) | refs → data URLs; seededit-3.0-i2i explicitly rejected | light-edit |
| `zai` (306 loc) | `glm-image` → `ZAI_IMAGE_MODEL` \| `BIGMODEL_IMAGE_MODEL` | aspectRatio snapped to closest recommended ratio key per family; custom size validated | **rejected outright** (`validateArgs`, `zai.ts:243`) | quality normal/2k; size overrides; family default size | `ZAI_API_KEY` \| `BIGMODEL_API_KEY` (+`ZAI_IMAGE_MODEL`, `BIGMODEL_IMAGE_MODEL`, `ZAI_BASE_URL`, `BIGMODEL_BASE_URL`) | `ZAI_BASE_URL` \| `BIGMODEL_BASE_URL` (api.z.ai/api/paas/v4) | dual Z.AI/bigmodel branding with parallel env chains | verbatim |
| `minimax` (220 loc) | `image-01` → `MINIMAX_IMAGE_MODEL` | `body.aspect_ratio` from a fixed whitelist (`SUPPORTED_ASPECT_RATIOS`); size parsed to pixels | `subject_reference` — JPG/PNG only, <10MB | n ≤ 9; output always `.jpg` | `MINIMAX_API_KEY` (+`MINIMAX_IMAGE_MODEL`, `MINIMAX_BASE_URL`) | `MINIMAX_BASE_URL` (api.minimaxi.com) | subject-reference upload semantics; no size field, ratio-only | verbatim |
| `jimeng` (467 loc) | `jimeng_t2i_v40` → `JIMENG_IMAGE_MODEL`; `req_key` = model | quality tier normal/2k/4k + aspectRatio → closest preset pixel size | refs switch t2i → i2i submit (`CVSync2AsyncSubmitTask` + `CVSync2AsyncGetResult` polling) | `imageSize` 1K/2K/4K else quality→preset | `JIMENG_ACCESS_KEY_ID` **and** `JIMENG_SECRET_ACCESS_KEY` (pair) (+`JIMENG_IMAGE_MODEL`, `JIMENG_REGION`, `JIMENG_BASE_URL`) | `JIMENG_BASE_URL` (visual.volcengineapi.com) | Volcengine HMAC-SHA256 request signing (`node:crypto`, `jimeng.ts:55+`) — port verbatim | light-edit |
| `replicate` (616 loc) | `google/nano-banana-2` → `REPLICATE_IMAGE_MODEL`; families nano-banana (`google/nano-banana`, `-pro`, `-2`), `bytedance/seedream-4.5`, `bytedance/seedream-5-lite` | per-model documented aspect-ratio set, validated; else inferred from size | yes; per-model caps ≤14 / ≤9; refs → data URLs | per-model `buildInput` branching; n=1 only | `REPLICATE_API_TOKEN` (+`REPLICATE_IMAGE_MODEL`, `REPLICATE_BASE_URL`) | `REPLICATE_BASE_URL` (api.replicate.com) | async prediction create → poll → output download; `imageSizeSource` gates config-only sizes (`replicate.ts:374`) | rewrite |
| `codex-cli` (197 loc) | `codex-image-gen` (fixed) | `--aspect` passthrough to the wrapper, default 1:1 | `--ref` passthrough | none (wrapper decides); n=1 only; dialect rejected | none — needs `codex` on PATH + active login; `BAOYU_CODEX_IMAGEGEN_BIN` / `_TIMEOUT_MS` / `_RETRIES` tune the wrapper | wrapper bin override only | spawns `codex exec` via the bundled `codex-imagegen/` driver (6 files); tmp prompt/output files per call | rewrite |
| `agnes` (175 loc) | `agnes-image-2.1-flash` → `AGNES_IMAGE_MODEL` | aspectRatio→size via parse; `size` override; default 1024x1024 | `body.image` array (remote URLs passed through, local paths resolved) | size/aspect → WxH | `AGNES_API_KEY` (+`AGNES_IMAGE_MODEL`, `AGNES_BASE_URL`) | `AGNES_BASE_URL` (apihub.agnes-ai.com/v1) | OpenAI-images-shaped endpoint; 120s client timeout; `responseFormat=url` returns the **URL text** as bytes — kk drops responseFormat, so this branch deletes | light-edit |

Port-effort method (auditable): count the distinct `args.<field>` reads inside each
`generateImage`. Adapters touching only fields `ImageRequest` keeps → `verbatim`
(azure, dashscope, minimax, zai); any branch on `imageApiDialect` / `responseFormat` /
`imageSize` → `light-edit` (google, openai, openrouter, seedream, jimeng, agnes); control flow
built on a field kk drops or on external orchestration → `rewrite` (replicate: `imageSizeSource`
+ per-model input mapping; codex-cli: subprocess driver). Totals: 4 verbatim, 6 light-edit,
2 rewrite — the 4306 upstream LOC shrink because `CliArgs` plumbing, curl fallbacks and
`main.ts`-owned concerns (batching, naming, retry) stay out.

#### R2 — The frozen `ImageProvider` interface

Shipped at `plugins/generations/image-gen/src/providers/types.ts`, exactly as frozen in the
refinement Design: `ImageRequest`, `ImageQuality` (`'normal' | '2k'`), `ImageResult`,
`ImageProvider` (`name`, `defaultModel()`, `isAvailable()`, `supportsReferenceImages(model)`,
`validate?`, `generate`), `ProviderOptions`, `ProviderFactory`, `PROVIDERS`, `AUTO_ORDER`,
`selectProvider`. `ImageRequest.referenceImages?: string[]` accepts ref paths without a cast;
there is no second reference-image entry point.

Mapping from baoyu's `ProviderModule` (`scripts/main.ts:15-20`), with the four deliberate
differences and their reasons (unchanged from the Design):

| baoyu | kk | Why |
| --- | --- | --- |
| `generateImage(prompt, model, args: CliArgs)` | `generate(req: ImageRequest)` | `CliArgs` carries CLI concerns (`json`, `help`, `batchFile`, `promptFiles`, `aspectRatioSource`) that have no meaning inside a kk generator whose argv is `--in`/`--out` only (`apps/cli/src/invoke.ts:118-122`). |
| availability by throwing mid-call (`openai.ts:286-290`) | `isAvailable(): boolean` | kk must pick a provider before spending money; 0106's skill must list what is configured. New code for all 12, not a port. Env-presence only, documented as such (stale keys surface as the adapter's own auth error at `generate()`, matching baoyu). |
| ref gates buried in `generateImage` branches (`google.ts:330-351`) | `supportsReferenceImages(model): boolean` | 0105 routes `--ref` work on a queryable fact. |
| bare `Uint8Array` + optional `getDefaultOutputExtension` | `ImageResult { bytes, extension, provider, model }` | One return, no second optional call; 0104 writes files. |

Registry shape note (implementation deviation from the Design sketch, required by R5's
I/O-free AC): the Design sketched `PROVIDERS` as lazy `import()` factories, but the adapter
modules do not exist yet and imports of nonexistent files cannot typecheck. `PROVIDERS` instead
carries one registration row per adapter — `env` (any-of fallback chains), `envAll`
(jimeng's required pair), `defaultModel`, `refModels` (per-model ref gates from the inventory),
`note` (codex-cli) — and a **shell** factory whose `isAvailable()` /
`supportsReferenceImages()` answer from those facts with zero I/O and whose `generate()` throws
`has no adapter yet`. An adapter ticket replaces `create` with the real wire-speaking factory;
the exported names and semantics are unchanged, so 0104/0105 code against this file as-is.

#### R3 — Selection order

`selectProvider(requested?, options?)`, first match wins:

1. `requested` — explicit name from the job input (0104's `Doc.metadata.provider`). Unknown →
   throw listing all 12 valid names; known-but-unconfigured → throw naming the provider and the
   missing env var. No silent downgrade.
2. `IMAGE_GEN_PROVIDER` env var, same two failure rules.
3. First name in `AUTO_ORDER` = `google, openai, replicate, openrouter, dashscope, seedream,
   zai, minimax, jimeng, azure, agnes` whose provider `isAvailable()`.
4. Nothing available → throw listing every provider with the credential each one needs.

`codex-cli` is absent from `AUTO_ORDER` **and** guarded by a `NEVER_AUTO` set at the selection
site; it is reachable only via steps 1–2 (baoyu rule, `baoyu-image-gen/SKILL.md:218`). From a
shell it reports not-ready (its readiness — `codex` on PATH + login — is not env-expressible);
its adapter ticket will implement a real check.

#### R4 — Env → config mapping

Credentials land in `~/.config/kk/config.yaml` under `plugins.generations.image-gen.env` as a
flat map, merged **under** `process.env` (`apps/cli/src/invoke.ts:133-137` — a real environment
variable wins, so a shell export beats the file). Per-provider keys are exactly the inventory's
env column; all 47 vars appear, placeholder-valued, in the emitted fragment
`plugins/generations/image-gen/config.example.yaml`.
Rationale for keeping one flat block at n=12: `invoke.ts` already injects this map per plugin;
a per-provider credential file would duplicate that path for no gain (Q&A closed). The ready-to-
paste block is **not** applied to `plugins/kk/config.example.yaml` here — 0104 owns that file.

#### R5 — Coverage strategy

The seam is `ProviderOptions` injection, the voice-gen pattern
(`plugins/generations/voice-gen/src/voicebox-client.ts:36-60`, `tests/voice-gen.test.ts:88`
`createMockClient`): every adapter takes `fetch?: typeof fetch` (and reads env through the
injected `env` map in the registry shells), so tests build a provider with a stub transport and
assert on recorded requests — no network. This imitates the `@gobing-ai/publish-harness`
`FakeFileCliTransport` shape (`packages/publish-harness/src/index.ts:16,36`) but is not an
import of it — that package is publish-kind only. Recorded wire fixtures supplement where
response parsing is nontrivial (dashscope families, replicate predictions). `codex-cli` is the
exception: it spawns a subprocess, so its ticket injects a spawn function instead and cannot use
the fetch seam. Demonstration in this ticket: `tests/providers.test.ts` covers
`selectProvider`'s four resolution paths and both explicit-selection failure paths with injected
`isAvailable` stubs, and calls all 12 registered `isAvailable()`s under a `fetch` stub that
fails the test if invoked — `types.ts` measures 100% functions / 100% lines.

#### R6 — Phasing recommendation

1. **google** — the only reference-image path 0105 can prototype against (Gemini multimodal),
   so style-cloning unblocks earliest.
2. **openai** — the fallback every developer already has keys for; edits endpoint covers refs.
3. **replicate** — one token reaches a large hosted-model surface (nano-banana, seedream) and
   exercises the polling pattern the other async adapters reuse.

Then: `openrouter`, `dashscope`, `seedream`, `zai`, `minimax`, `jimeng`, `azure`, `agnes` (the
long tail is mostly `light-edit`/`verbatim` once the phase-1 trio establishes the adapter
template). **`codex-cli` last** — it needs `codex` on `PATH` with an active login and cannot be
CI-verified. No adapter is unassigned.

#### Recommendation on the map's open question (c) — unchanged

**Reimplement against `ImageRequest`, porting each `generateImage` body's wire logic verbatim**
(endpoints, request/response shapes, polling loops, error strings); replace only the argument
plumbing. Attribution: `ATTRIBUTION.md` in `plugins/generations/image-gen/` naming baoyu-skills
(MIT © 2026 Jim Liu) plus a `// Ported from baoyu-skills/<file> (MIT)` header per adapter. The
operator owns the final call; either answer leaves this ticket's interface unchanged. One new
finding strengthens it: google's curl-subprocess fallback exists to work around Node-fetch
proxy bugs and must not survive the port — a `toCliArgs()` shim would drag it along.

#### Testing

Covered by `plugins/generations/image-gen/tests/providers.test.ts` (21 new tests; suite green):
registry shape (12 rows, frozen 11-name `AUTO_ORDER`), I/O-free `isAvailable` under a
throwing `fetch` stub for all 12, per-model ref gates (google/openai/dashscope/seedream/zai),
jimeng's credential pair, shell `generate` throws, and all six `selectProvider` paths (explicit,
env, auto, nothing-available, unknown, known-but-unconfigured) plus the codex-cli never-auto and
explicit-pin rules. `grep -c 'async function generate' src/providers/types.ts` → 0.

### Plan

Ordered. Each step names the R-item it serves and the check that proves it.

1. **Read the two heaviest adapters first** — `dashscope.ts` (625 LOC) and `replicate.ts` (616). They set the ceiling on the whole estimate; if both come out `verbatim`, the rest will too. *(R1)*
2. **Read the remaining 10** in the LOC order given in the Background, recording for each: model list, aspect-ratio mechanism, ref support and its model gate, size/quality mapping, env vars (`grep -n 'process.env' <file>`), base-URL override, dialect quirks. *(R1)*
3. **Classify port effort** per adapter by counting distinct `args.<field>` reads in `generateImage` — 0–3 fields that kk keeps → `verbatim`; branching on `imageApiDialect` / `responseFormat` / `imageSize` → `light-edit`; control flow built on a field kk drops → `rewrite`. Record the count alongside the verdict so the classification is auditable. *(R1)*
4. **Write the inventory table** into this task's `## Solution`, 12 rows. *(R1)*
5. **Scaffold the package** — `plugins/generations/image-gen/package.json` copied from `plugins/generations/voice-gen/package.json` with the name changed to `@gobing-ai/image-gen`, plus `tsconfig.json`. No `plugin.json` and no `src/index.ts` yet — those are 0104's, and adding them here would register a plugin that cannot run. *(enabling step)*
6. **Write `src/providers/types.ts`** exactly as frozen in the Design: the six type exports, `PROVIDERS`, `AUTO_ORDER`, `selectProvider`. Types and one selector only. *(R2, R3)*
7. **Write `tests/providers.test.ts`** covering `selectProvider`'s four resolution paths and both failure paths with injected availability stubs, plus the assertion that no `isAvailable()` touches the injected `fetch`. Test intent: the selection order is the money-spending decision, so it is the one behaviour worth pinning before any adapter exists. *(R3, R5)*
8. **Run `bun run lint` and `bun run test`**; both must exit 0 and coverage on the touched files must be ≥90%. *(R5)*
9. **Write the `config.example.yaml` block** into this task's `## Solution` as a fenced snippet with placeholder values only — do **not** edit `plugins/kk/config.example.yaml`; 0104 owns that file. *(R4)*
10. **Write the coverage strategy paragraph**, naming `ProviderOptions.fetch` injection as the seam and pointing at `plugins/generations/voice-gen/tests/voice-gen.test.ts:88` as the working precedent. State plainly that `codex-cli` cannot be covered this way (it spawns a subprocess) and that its ticket will inject a spawn function instead. *(R5)*
11. **Write the phasing recommendation** — `google`, `openai`, `replicate` first, then the named remainder, `codex-cli` last. *(R6)*
12. **Write the port-strategy recommendation and the attribution plan** (`ATTRIBUTION.md` + per-file MIT header), marked explicitly as a recommendation on the operator's open question (c). *(handoff)*
13. **Close the ticket** — `spur task update 0103 done`, then append one line to feature K's `## Decisions so far` naming the WBS, the title, and the one-line gist (interface frozen, 12 adapters, phase-1 trio).

### Solution

Inventory (12-row adapter table), interface rationale, env mapping, coverage strategy, and phasing: see `## Design` (registered per Requirements R1-R6). Emitted files: `plugins/generations/image-gen/src/providers/types.ts:13` (frozen exports through `:234`), `plugins/generations/image-gen/tests/providers.test.ts:1` (36-test suite incl. selection paths), `plugins/generations/image-gen/config.example.yaml:1` (47-var env fragment).

### Testing

**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | 12-row inventory table (docs/tasks/0103_*.md, Design R1 section) with models/aspect-mechanism/ref/size-quality/env/base-url/quirks/port-effort per adapter; exactly 12 non-test .ts files verified in vendors/baoyu-skills/.../scripts/providers/ (main checkout); env spot-checks verbatim: google.ts:37 (GOOGLE_API_KEY/GEMINI_API_KEY), :47 GOOGLE_BASE_URL, :19 GOOGLE_IMAGE_MODEL; openai.ts:284 OPENAI_API_KEY, :283 OPENAI_BASE_URL, :292 OPENAI_IMAGE_USE_CHAT; seedream.ts:53 ARK_API_KEY (confirms "not SEEDREAM_API_KEY"), :57 SEEDREAM_BASE_URL; jimeng.ts:11,15 credential pair + :19 JIMENG_REGION; replicate.ts:42 REPLICATE_API_TOKEN |
| R2 | MET | plugins/generations/image-gen/src/providers/types.ts:13,16,34,42,59,65 (six frozen types) :119 PROVIDERS :196 AUTO_ORDER :239 selectProvider; referenceImages at :28, supportsReferenceImages at :52; grep -c 'async function generate' → 0; `bun run lint` exit 0 |
| R3 | MET | types.ts:239-283 selectProvider: explicit > IMAGE_GEN_PROVIDER > AUTO_ORDER :268-272; NEVER_AUTO set :71 + guard :270 excludes codex-cli; AUTO_ORDER :196-208 is the frozen 11-name list |
| R4 | MET | plugins/generations/image-gen/config.example.yaml:10-13 plugins.generations.image-gen.env with all 47 vars placeholder-valued (: "" count = 47); precedence comment line 7 citing apps/cli/src/invoke.ts:133-137 |
| R5 | MET | tests/providers.test.ts:34-37 throwing-fetch stub across all 12 shells; fresh run: 36 pass / 0 fail, types.ts 100% funcs / 100% lines, aggregate 100% funcs / 98.28% lines (≥90) |
| R6 | MET | Design R6: google → openai → replicate first, one-sentence justification each; openrouter/dashscope/seedream/zai/minimax/jimeng/azure/agnes in the later phase; codex-cli last; all 12 assigned |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| The inventory covers every adapter on disk (R1) | PARTIAL | manual-review | 12 non-test .ts files counted on disk (agnes, azure, codex-cli, dashscope, google, jimeng, minimax, openai, openrouter, replicate, seedream, zai); 12-row table with all required columns + verbatim/light-edit/rewrite values at Design R1 (Solution cross-references it); 5-adapter env spot-check all verbatim in vendor sources |
| The provider interface file compiles and exports the frozen names (R2) | PARTIAL | manual-review | `bun run lint` exit 0 (fresh); all 9 names exported (types.ts:13,16,28,34,42,52,59,65,119,196,239); `grep -c 'async function generate'` → 0 (fresh) |
| The interface spans reference-image generation (R2, feeds 0105) | MET | test | providers.test.ts:45-47 — `ImageRequest` accepts referenceImages:['/abs/a.png'] typed, no cast; types.ts:52 supportsReferenceImages(model); no second ref entry point (single method in interface) |
| An explicit unknown provider fails loudly (R3) | MET | test | providers.test.ts:140-146 — selectProvider('stable-diffusion') throws 'Unknown image provider' naming all 12, with isAvailable:()=>true proving no fall-through |
| An explicit known-but-unconfigured provider fails loudly (R3) | MET | test | providers.test.ts:156-158 — selectProvider('openai', env:{}) throws "Provider 'openai' is not configured: missing OPENAI_API_KEY"; no silent downgrade |
| Auto-selection follows the frozen order and skips codex-cli (R3) | MET | test | providers.test.ts:112-115 (replicate+openai available → 'openai') and :167-170 (codex-cli only available → throws 'No image provider is configured') |
| `isAvailable()` performs no I/O (R2, R5) | MET | test | providers.test.ts:33-40 — all 12 shells called under a fetch stub that throws if invoked; suite passes, stub never triggered |
| Credentials map to the plugin env block (R4) | PARTIAL | manual-review | config.example.yaml — all 47 vars under plugins.generations.image-gen.env, every value "" (placeholder count = 47, no real credentials); precedence comment (line 7) records process.env wins, citing apps/cli/src/invoke.ts:133-137 |
| Coverage strategy is demonstrated, not asserted (R5) | MET | test | Fresh `bun test plugins/generations/image-gen`: 36 pass / 0 fail; tests cover paths 1-4 + both failure paths with injected isAvailable stubs, zero network; coverage table: types.ts 100% funcs / 100% lines, aggregate 100% funcs / 98.28% lines |
| The phasing recommendation is ordered and justified (R6) | PARTIAL | manual-review | Design R6: phase 1 google/openai/replicate each with a justification sentence; phase 2 names the remaining 8; codex-cli explicitly last; 3+8+1 = 12, none unassigned |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PARTIAL)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P1 | evidence-rule-failed | — | Executable evidence missing for: The inventory covers every adapter on disk (R1), The provider interface file compiles and exports the frozen names (R2), Credentials map to the plugin env block (R4), The phasing recommendation is ordered and justified (R6) |
| P4 | proof-input-digest | — | 38954bba6e67cdf3d6384f31f9986e777c60741abcf59d9ffe9958491bb6906b |

### References

**Vendored prior art** (`vendors/baoyu-skills/`, MIT © 2026 Jim Liu — see `LICENSE`):

- `skills/baoyu-image-gen/scripts/providers/*.ts` (12 adapters, 4306 LOC) and their co-located `*.test.ts` (2360 LOC) — the inventory's subject.
- `skills/baoyu-image-gen/scripts/types.ts:1-13` — the `Provider` union, the authoritative list of 12.
- `skills/baoyu-image-gen/scripts/types.ts:15-36` — `CliArgs`, the 20-field struct `ImageRequest` replaces.
- `skills/baoyu-image-gen/scripts/main.ts:15-20` — the `ProviderModule` shape this ticket's interface supersedes.
- `skills/baoyu-image-gen/scripts/main.ts:885-897` — the lazy `loadProviderModule` pattern `PROVIDERS` mirrors.
- `skills/baoyu-image-gen/scripts/providers/google.ts:36-46,330-351` — env-var fallback chain and the reference-image model gate.
- `skills/baoyu-image-gen/scripts/providers/openai.ts:283-290` — the throw-at-call-time availability behaviour `isAvailable()` replaces.
- `skills/baoyu-image-gen/SKILL.md:155` — baoyu's precedence chain (`EXTEND.md` above env vars), explicitly **not** adopted.
- `skills/baoyu-image-gen/SKILL.md:218` — `codex-cli` is never auto-selected.
- `skills/baoyu-image-gen/references/providers/*.md` — per-provider quirk docs (7 of 12 providers).
- `skills/baoyu-image-gen/scripts/codex-imagegen/` — the `codex exec` subprocess driver behind `codex-cli`.

**In-repo precedent:**

- `plugins/generations/voice-gen/src/voicebox-client.ts:36-60` — the injected-`fetch` client seam this interface copies.
- `plugins/generations/voice-gen/tests/voice-gen.test.ts:88` — `createMockClient`, the coverage pattern for network code.
- `plugins/generations/voice-gen/package.json` — the package scaffold step 5 copies.
- `packages/publish-harness/src/index.ts:16,36` — `PublishTransport` / `FakeFileCliTransport`; a shape to imitate, publish-kind only, not importable from a generator.
- `apps/cli/src/invoke.ts:118-122` — the frozen plugin argv (`--in` / `--out` only); why `CliArgs` cannot cross into kk.
- `apps/cli/src/invoke.ts:125-138` — `plugins.<collection>.<name>.env` merged **under** `process.env`; the credential path in R4.
- `plugins/kk/config.example.yaml` — the file the R4 snippet targets (edited by 0104, not here).

**Being replaced:**

- `/Users/robin/projects/cc-agents/plugins/wt/skills/image-generate/scripts/image_generator.py` — the Python backends (`HuggingFaceBackend`, `GeminiBackend`, `nano_banana` via MCP) and their `GenerationRequest` / `GenerationResult` shapes.

**Downstream consumers of this ticket's output:** 0104 (calls `selectProvider` and `generate`), 0105 (routes on `supportsReferenceImages`).

### History

- 2026-09-09T21:15:29.518Z backlog → todo (system)
- 2026-09-09T22:42:44.370Z todo → wip (system)
- 2026-09-09T22:55:57.169Z wip → testing (system)
- 2026-09-09T22:57:12.719Z testing → done (system)

