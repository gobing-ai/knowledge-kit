# Provider facts for image generation

The operator-facing digest of 0103's provider inventory. Source of truth:
`plugins/generations/image-gen/src/providers/types.ts` (the frozen registry) —
if this file and the registry ever disagree, the registry wins and this file
gets fixed. Credential *values* live only in
`plugins.generations.image-gen.env` (`plugins/kk/config.example.yaml`); they
are read by `invoke.ts` at spawn, never by this skill.

## The rules

- **Readiness is env presence.** A provider is available when its env var(s)
  are non-empty. A stale key still passes readiness and surfaces as the
  adapter's own auth error at generate time.
- **Auto-selection** walks `AUTO_ORDER` — google, openai, replicate,
  openrouter, dashscope, seedream, zai, minimax, jimeng, azure, agnes — and
  takes the first available. `IMAGE_GEN_PROVIDER` names a provider explicitly;
  `--provider` outranks it.
- **`codex-cli` is never auto-selected.** Its readiness (the `codex` CLI on
  PATH with an active login) is not env-expressible; pin it explicitly.
- **`h3-local` is never auto-selected either.** It drives Robin's local Apple
  Silicon MLX runtime through `h3gen.sh`, and one render costs minutes of wall
  time (3 min floor, ~7 min for 1024², up to ~28 min for a two-reference edit).
  Pin it with `--provider h3-local`; the cloud defaults stay until the K2
  rollout gates pass. H3 has no native negative-prompt parameter, so a style's
  `negative` travels as the composed `avoid: …` segment like every other
  provider; seeds cannot be set (the wrapper's default 42 applies); and only
  multiples of 32 in 256–4096 are accepted per edge — every other preset falls
  back to an aspect-only canvas (0379).
- **Running or verifying it locally.** `H3_IMAGE_MLX_BIN` can live in
  `plugins.generations.image-gen.env` in `~/.config/kk/config.yaml`, so no shell
  export is needed. `KK_IMAGE_DRY_RUN=1` proves prompt composition and provider
  selection in about a second; one real `free` render is ~6 min because model
  load dominates (a smaller canvas saves nothing). `scripts/gen-samples.ts` and
  `scripts/eval-style-presets.ts` both accept `--provider h3-local` (the model
  defaults to `h3`) and need `--concurrency 1` — three concurrent model loads
  thrash a 16 GB machine. A reference edit costs ~28 min: never use one as a
  smoke test.
- **H3 paints prompt tags as text unless the style declares a `negative`.** Same
  subject, canvas and format at 1024²: with `editorial` (no `negative`) the model
  rendered "8K, high-quality, masterpiece…" as gibberish lettering in the frame;
  with `daily-news` (whose `avoid: text, letters, words, …` segment K3 now
  appends) the identical request came back clean. When rendering locally, use a
  style that declares `negative` (`daily-news`, `quasi-news-podcast`,
  `xhs-knowledge`, `clean-webapp-ui`) or add one — never compare a local sample
  against a cloud one from a style that leaves text unconstrained.
- **Reference images** ride `--ref` only when `supportsReferenceImages(model)`
  is true for the resolved model — a substring test over the registry's
  `refModels` fragments (no `refModels` = every model; empty list = none).
  When it is false, say so and offer `extract-style`; never drop the
  reference silently.

## The inventory

| Provider | Env var(s) that enable it | Default model | Reference images |
| --- | --- | --- | --- |
| agnes | `AGNES_API_KEY` | `agnes-image-2.1-flash` | yes |
| azure | `AZURE_OPENAI_API_KEY` (+ `AZURE_OPENAI_BASE_URL`, `AZURE_OPENAI_DEPLOYMENT` to run) | `gpt-image-2` | yes (no `refModels` declared → every model passes `supportsReferenceImages`) |
| codex-cli | not env-expressible — `codex` CLI + login | `codex-image-gen` | never auto-selected |
| dashscope | `DASHSCOPE_API_KEY` | `qwen-image-2.0-pro` | only `wan2.7` models |
| google | `GOOGLE_API_KEY` or `GEMINI_API_KEY` | `gemini-3-pro-image` | the gemini image models (`gemini-3-pro-image`, `*-flash-image`, previews) |
| h3-local | `H3_IMAGE_MLX_BIN` (path to the local `h3gen.sh`) | `h3` | yes (up to 16, `<Picture N>` in prompt order) — never auto-selected |
| jimeng | `JIMENG_ACCESS_KEY_ID` **and** `JIMENG_SECRET_ACCESS_KEY` (both halves) | `jimeng_t2i_v40` | yes |
| minimax | `MINIMAX_API_KEY` | `image-01` | yes (jpg/png <10MB, subject reference) |
| openai | `OPENAI_API_KEY` | `gpt-image-2` | `gpt-image` models |
| openrouter | `OPENROUTER_API_KEY` | `google/gemini-3.1-flash-image` | yes (no `refModels` declared → treated as supporting; real capability depends on the routed model) |
| replicate | `REPLICATE_API_TOKEN` | `google/nano-banana-2` | yes |
| seedream | `ARK_API_KEY` (not `SEEDREAM_*`) | `doubao-seedream-5-0-260128` | `doubao-seedream-5-0` / `4-5-` / `4-0-` models |
| zai | `ZAI_API_KEY` or `BIGMODEL_API_KEY` | `glm-image` | **none** |

## Deciding with references in hand

1. Resolve the provider per Preference chain (argument → `IMAGE_GEN_PROVIDER`
   → config → `AUTO_ORDER`).
2. Check `supportsReferenceImages` for the resolved model. False → the
   pass-through path is unavailable: state it and offer style extraction
   (0105), which works with every provider.
3. Name the chosen provider and model in the spend preview — the operator
   approves the pair, not just the prompt.
