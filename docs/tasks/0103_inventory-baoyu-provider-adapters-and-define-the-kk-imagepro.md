---
schema_version: 1
name: Inventory baoyu provider adapters and define the kk ImageProvider interface
status: todo
template: feature-impl
created_at: 2026-09-09T18:28:03.499Z
updated_at: "2026-09-09T21:15:29.518Z"
feature_id: K

ac_altitude: task-local
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

- [ ] R1. **Adapter inventory table** — one row per provider: models, aspect-ratio mechanism, reference-image (`--ref`) support, size/quality mapping, auth env vars, base-URL override, known dialect quirks, and a port-effort estimate (`verbatim` / `light-edit` / `rewrite`).
- [ ] R2. **The `ImageProvider` TypeScript interface** — the minimal surface every adapter satisfies: `name`, `isAvailable()`, `generate(request)`, plus the shared `GenerationRequest` / `GenerationResult` types. Must span text-to-image *and* reference-image generation, since style-cloning (0105) depends on `--ref`.
- [ ] R3. **Selection order** — explicit flag > only-key-present > priority list, and the rule for `codex-cli`-style never-auto-selected adapters.
- [ ] R4. **Env var and config mapping** — how ~13 providers' credentials land in `~/.config/kk/config.yaml` under `plugins.generations.image-gen.env`, and whether that file is still the right home at this cardinality.
- [ ] R5. **Coverage strategy** — how ≥90% line and function coverage is reached for adapters that cannot be hit live (fake transport, recorded fixtures, or the `@gobing-ai/publish-harness` fake-transport pattern already in this repo).
- [ ] R6. **A phasing recommendation** — the matrix is fixed, but the *order* is not; name which 2–3 adapters land first so the pipeline is end-to-end runnable before the long tail.

This ticket answers *how much and in what shape*. It does not write the adapters.

### Acceptance Criteria

Task-local acceptance criteria. Feature K is a `wayfinder-map` and carries a prose no-AC disclaimer, so these scenarios are the executable contract for this ticket alone.

#### Scenario: The inventory covers every adapter on disk (R1)

- **Given** `vendors/baoyu-skills/skills/baoyu-image-gen/scripts/providers/` contains 12 non-test `.ts` files
- **When** the reviewer counts the rows in the inventory table in this task's `## Solution`
- **Then** there are exactly 12 rows, one per file, each naming the provider's models, aspect-ratio mechanism, reference-image support, size/quality mapping, auth env vars, base-URL override, dialect quirks, and a port-effort value from `verbatim` / `light-edit` / `rewrite`
- **And** every env var named in the table appears verbatim in that adapter's source (spot-check by `grep -n '<VAR>' <adapter>.ts`)

#### Scenario: The provider interface file compiles and exports the frozen names (R2)

- **Given** the repo checked out at this task's HEAD
- **When** `bun run lint` runs
- **Then** it exits 0
- **And** `plugins/generations/image-gen/src/providers/types.ts` exports `ImageRequest`, `ImageQuality`, `ImageResult`, `ImageProvider`, `ProviderOptions`, `ProviderFactory`, `PROVIDERS`, `AUTO_ORDER` and `selectProvider`
- **And** the file contains no adapter implementation — `grep -c 'async function generate' src/providers/types.ts` returns 0

#### Scenario: The interface spans reference-image generation (R2, feeds 0105)

- **Given** `ImageRequest` as exported
- **When** a caller supplies `referenceImages: ['/abs/a.png']`
- **Then** the type accepts it without a cast, and `ImageProvider.supportsReferenceImages(model)` is callable to decide whether that provider may be used
- **And** no second method or overload exists for the reference-image path

#### Scenario: An explicit unknown provider fails loudly (R3)

- **Given** `selectProvider` and the 12-entry `PROVIDERS` registry
- **When** it is called with `'stable-diffusion'`
- **Then** it throws, and the message contains all 12 valid provider names
- **And** it does not fall through to the auto list

#### Scenario: An explicit known-but-unconfigured provider fails loudly (R3)

- **Given** `OPENAI_API_KEY` is unset in the test environment
- **When** `selectProvider('openai')` is called
- **Then** it throws naming `openai` and the missing env var
- **And** it does **not** silently select a different provider

#### Scenario: Auto-selection follows the frozen order and skips codex-cli (R3)

- **Given** no `requested` argument and no `IMAGE_GEN_PROVIDER`
- **And** exactly two providers report `isAvailable() === true`: `replicate` and `openai`
- **When** `selectProvider()` is called
- **Then** it returns `'openai'` — the earlier of the two in `AUTO_ORDER`
- **And** with `codex-cli` the only available provider, `selectProvider()` throws instead of returning it

#### Scenario: `isAvailable()` performs no I/O (R2, R5)

- **Given** a `ProviderOptions.fetch` stub that throws if invoked
- **When** every registered provider's `isAvailable()` is called
- **Then** the stub is never invoked and no subprocess is spawned

#### Scenario: Credentials map to the plugin env block (R4)

- **Given** the inventory's env-var column
- **When** the reviewer reads the `config.example.yaml` block emitted by this ticket
- **Then** every env var from the table appears under `plugins.generations.image-gen.env`
- **And** the block carries a comment recording that `process.env` overrides it (`apps/cli/src/invoke.ts:133-137`)
- **And** the block contains no real credential value — every value is a placeholder

#### Scenario: Coverage strategy is demonstrated, not asserted (R5)

- **Given** `tests/providers.test.ts`
- **When** `bun run test` runs
- **Then** it passes, and the tests cover `selectProvider`'s four resolution paths and both failure paths using injected `isAvailable` stubs — no network call is made
- **And** the aggregate line and function coverage reported for the touched files is ≥90%

#### Scenario: The phasing recommendation is ordered and justified (R6)

- **Given** the 12-row inventory
- **When** the reviewer reads the phasing section
- **Then** it names the first 2–3 adapters explicitly, in order, with one sentence of justification each
- **And** every remaining adapter appears in a later phase — no adapter is unassigned

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

**WHAT** — a written inventory plus the **frozen `ImageProvider` interface** that 0104 codes against and the 12 adapters are later written to. **WHY the interface is frozen in a research ticket:** 0104 must call providers before any adapter exists; without a fixed interface it invents one and the adapter work then has to bend to it.

#### Deliverables (all inside this task's `## Solution`, plus one code file)

1. The inventory table with a port-effort column (below).
2. `plugins/generations/image-gen/src/providers/types.ts` — the interface, the registry type, and the selection function. **Type declarations, one registry map and one selector — no adapter bodies.**
3. A phasing recommendation.

#### The frozen interface

```ts
// plugins/generations/image-gen/src/providers/types.ts
export interface ImageRequest {
    prompt: string;
    model: string;
    aspectRatio?: string;            // '21:9' — from FormatPreset (0102)
    width?: number;                  // optional exact pixels
    height?: number;
    quality?: ImageQuality;
    negative?: string;               // from StylePreset.negative (0102)
    referenceImages?: string[];      // absolute paths; empty/undefined = text-to-image
    n?: number;                      // default 1
}

export type ImageQuality = 'normal' | '2k';

export interface ImageResult {
    bytes: Uint8Array;               // adapters return bytes, never paths (0104 writes files)
    extension: string;               // 'png' | 'jpg' | 'webp' — provider decides
    provider: string;
    model: string;
}

export interface ImageProvider {
    readonly name: string;
    defaultModel(): string;
    /** Env-only readiness. MUST NOT perform network or subprocess calls. */
    isAvailable(): boolean;
    supportsReferenceImages(model: string): boolean;
    /** Throw on an impossible combination (e.g. Imagen + referenceImages) before spending money. */
    validate?(req: ImageRequest): void;
    generate(req: ImageRequest): Promise<ImageResult>;
}

export interface ProviderOptions {
    fetch?: typeof fetch;            // injected in tests — the voice-gen pattern
}

export type ProviderFactory = (options?: ProviderOptions) => ImageProvider;
```

Four deliberate differences from baoyu's `ProviderModule`, each with its reason:

| Change | Why |
| --- | --- |
| `ImageRequest` replaces `CliArgs` | `CliArgs` carries `json`, `help`, `batchFile`, `promptFiles`, `aspectRatioSource` — CLI concerns that have no meaning inside a kk generator, whose only argv is `--in`/`--out` (`apps/cli/src/invoke.ts:118-122`). Importing it would pin kk's core type to a foreign CLI's shape forever. |
| `isAvailable()` added | baoyu discovers missing credentials by throwing mid-`generateImage`. kk needs to pick a provider **before** spending anything, and 0106's skill needs to tell the operator which providers are configured. This is **new code for all 12**, not a port. |
| `supportsReferenceImages(model)` added | The knowledge exists in baoyu but is buried in `generateImage` branches (`google.ts:330-351`). 0105 needs it as a queryable fact to route `--ref` work. |
| `ImageResult` wraps the bytes | baoyu returns a bare `Uint8Array` and recovers the extension through the optional `getDefaultOutputExtension`. Returning both together removes an optional method and a second call. |

`ProviderOptions.fetch` mirrors `VoiceboxClientOptions.fetch` (`plugins/generations/voice-gen/src/voicebox-client.ts:50-54`) — the only pattern in this repo that gets network code past the 90% coverage floor.

#### The registry and selection order (frozen)

```ts
export const PROVIDERS: Record<string, () => Promise<ProviderFactory>> = {
    google: async () => (await import('./google')).create,
    // …11 more, lazily imported — mirrors baoyu's loadProviderModule (main.ts:885-897)
};

export const AUTO_ORDER = ['google', 'openai', 'replicate', 'openrouter', 'dashscope',
                           'seedream', 'zai', 'minimax', 'jimeng', 'azure', 'agnes'] as const;
```

`selectProvider(requested?: string): string` resolves, first match wins:

1. `requested` — an explicit name from the job input (0104's `Doc.metadata.provider`). An unknown name **throws**, listing the 12 valid names. A known-but-unavailable name **throws** naming the missing env var — it does **not** silently fall through, because a silent downgrade changes what the operator paid for.
2. `IMAGE_GEN_PROVIDER` env, same two failure rules.
3. The first `name` in `AUTO_ORDER` whose provider `isAvailable()`.
4. Nothing available → throw, listing every provider with the env var each one needs.

`codex-cli` is **absent from `AUTO_ORDER` on purpose** and can only be reached by step 1 or 2 — it spawns `codex exec` against the operator's own subscription, matching baoyu's rule (`baoyu-image-gen/SKILL.md:218`).

#### Env mapping

Credentials reach the plugin through `plugins.generations.image-gen.env` in `~/.config/kk/config.yaml`, merged **under** `process.env` (`apps/cli/src/invoke.ts:133-137` — a real environment variable wins). The inventory table must record each adapter's env keys verbatim from its source; the ones already read during refinement are `GOOGLE_API_KEY` / `GEMINI_API_KEY` / `GOOGLE_IMAGE_MODEL` / `GOOGLE_BASE_URL` (`google.ts:36-46`) and `OPENAI_API_KEY` / `OPENAI_BASE_URL` (`openai.ts:283-284`). The ticket's output includes a ready-to-paste `config.example.yaml` block; **`plugins/kk/config.example.yaml` is edited by 0104**, not here, so the two tickets do not both touch that file.

#### Port-effort classification (the inventory's key column)

Rate each adapter `verbatim` / `light-edit` / `rewrite` against one test: **how much of the file survives replacing `args: CliArgs` with `req: ImageRequest` and adding `isAvailable` + `supportsReferenceImages`?** Read each adapter's `generateImage` and count the distinct `args.` field reads — an adapter touching only `aspectRatio`/`referenceImages`/`n` is `verbatim`; one branching on `imageApiDialect`/`responseFormat`/`imageSize` is `light-edit`; one whose control flow is built around a field kk drops is `rewrite`. `dashscope` (625 LOC) and `replicate` (616) are the likely `rewrite` candidates and should be read first, because they set the ceiling on the whole estimate.

#### Recommendation on the map's open question (c)

**Reimplement against `ImageRequest`, porting each `generateImage` body's wire logic verbatim** — keep the endpoint URLs, request/response shapes, polling loops and error strings; replace only the argument plumbing. Rationale: the wire-format knowledge is the expensive, hard-to-rediscover part; `CliArgs` is not, and a `toCliArgs()` shim would make every future kk option change a translation-layer edit. Attribution: an `ATTRIBUTION.md` in `plugins/generations/image-gen/` naming baoyu-skills, the MIT licence text and the upstream commit, plus a one-line `// Ported from baoyu-skills/<file> (MIT)` header per adapter. **This is a recommendation; the operator owns the final call** (map open question (c)). Either answer leaves the interface above unchanged — that is why this ticket is executable while the question stays open.

#### Phasing recommendation

Land **`google`, `openai`, `replicate`** first: Gemini multimodal is the only reference-image path 0105 can prototype against, OpenAI is the fallback every developer already has keys for, and Replicate reaches a large hosted-model surface with one key. Then `openrouter`, `dashscope`, `seedream`, `zai`, `minimax`, `jimeng`, `azure`, `agnes`, and `codex-cli` last (it needs `codex` on `PATH` with an active login, so it cannot be CI-verified).

#### What this ticket assumes and leaves

- **Assumes from 0102:** `FormatPreset.aspectRatio` / `width` / `height` and `StylePreset.negative` are the fields that feed `ImageRequest`. It does **not** import `presets.ts`; it only agrees on the field names.
- **Leaves to 0104:** writing bytes to disk, output naming, retries, concurrency, and the confirmation/budget gate. Adapters make exactly one call and return bytes.
- **Leaves to 0105:** `supportsReferenceImages` is the routing fact; 0105 decides what to do when it is `false`.
- **Leaves to the adapter tickets (not yet created):** the 12 bodies, their tests, and the `config.example.yaml` credential block.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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

