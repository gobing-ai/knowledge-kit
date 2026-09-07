# Publish Plugin Specification & Authoring Contract

## 1. Generic Plugin-Instance Contract Citation

This specification cites Section 1 of `docs/design/ingestion-plugin-specification.md` wholesale for manifest schema (`plugin.json`), invocation CLI contract (`--in` / `--out`), extra-config/secrets channels (env-only), and process exit-code rules. Publish plugins MUST conform to those rules without re-derivation.

---

## 2. Publish-Specific Contract

### 2.1 Kind Definition

- `kind`: `"publish"`
- `input`: `z.union([ContentSchema, DocListSchema])` — two forms (0100):
  - **Content object** (`{ body, title?, format?, outline?, references?, metadata? }`) — the
      publish / management payload.
  - **Bare `Doc[]` array** — the show-notes dispatch form (episode-plan `Doc[]` in → markdown
      written to `--out`; introduced for podcast-pub, 0095). Executor pre-validation
      (`runInvoke`) validates `--in` against this union, so both forms reach the plugin entry.
- `output`: two-form, mirroring the input union (0101):
  - **Content-object input** → a `ResultSchema` JSON on `--out`
      (`{ ok, target, url?, id?, message?, error?, metadata? }`); the executor JSON-parses and
      `ResultSchema`-validates it.
  - **Bare `Doc[]` array input (show-notes)** → the raw markdown artifact itself on `--out`
      (e.g. podcast-pub's `3-publish/show-notes.md`); the executor treats `--out` as opaque —
      existence + non-emptiness only, no JSON or `ResultSchema` parse.

### 2.2 Transport Abstraction Interface

Publish plugins abstract transport mechanisms (`file-cli` vs `browser`) behind a common interface pattern:

```ts
export interface PublishTransportPayload {
    content: Content;
    options?: Record<string, unknown>;
}

export interface PublishTransport {
    kind: 'file-cli' | 'browser';
    publish(payload: PublishTransportPayload): Promise<Result>;
}
```

- **File/CLI Transports (`file-cli`)**: Executed by the plugin process itself — child-process
  CLIs or file manipulators (Surfdash `postsurfing` CLI, Zenn CLI via `npx zenn`) *or* direct API
  calls made by the plugin (Qiita API v2 via `fetch` with a bearer token). Classification is by
  **execution mechanism, not network usage**: a token-API channel is still `file-cli` as long as
  the plugin runs it without browser automation (ADR-008).
- **Browser Transports (`browser`)**: Automated browser automation (Playwright) operating against
  authenticated sessions/profiles. **Deferred — no shipped channel uses it yet.**

### 2.3 Content → Frontmatter Mapping Conventions

For targets expecting frontmatter (e.g. static site generators like Surfing/Astro), the plugin maps `Content` properties to target-specific frontmatter fields:

- `title`: `Content.title` or primary Markdown heading `# Title`.
- `description`: Lead paragraph or `Content.metadata.description`.
- `tags`: Lowercase-hyphenated string array derived from `Content.metadata.tags` or keywords.
- `date`: Current ISO timestamp (`new Date().toISOString()`).
- `canonical_url`: `Content.references[0]?.url` or `Content.metadata.canonicalUrl`.
- `published`: Boolean flag (default `true`).

### 2.4 Auth & Secrets Channel Rules

- Secrets (API tokens, session cookies, auth credentials) MUST be passed exclusively via environment variable inheritance (`process.env`).
- Secrets MUST NEVER be committed to disk, written to `--out` `Result` metadata, or embedded in `plugin.json`.

### 2.5 Failure & Exit Code Semantics

- **Success Path (`exit 0`)**: The plugin writes a `Result` JSON with `ok: true`, `target: "<name>"`, `url: "<canonical-url>"`, `message: "..."`, and exits with code `0`.
- **Validation Failure (`exit 1`)**: Missing required input fields or invalid `Content` JSON causes the plugin to write a `Result` JSON with `ok: false`, `error: "Diagnostic message"`, log to `stderr`, and exit `1`.
- **Transport / CLI Error (`exit 1`)**: Command execution failures or transport errors write `Result` JSON with `ok: false`, `error: "Stderr output"`, log to `stderr`, and exit `1`.
- **Schema Rejection (`exit != 0`)**: If the output written to `--out` violates `ResultSchema`, `runInvoke` rejects execution, logs diagnostic details to `stderr`, and propagates non-zero exit. (Content-object invocations only; the show-notes array form's `--out` is the raw markdown artifact and is exempt — §2.1, 0101.)

---

## 3. Platform Alignment

- **Core Verification**: Tested against `kindContract('publish')` in `@gobing-ai/kk-core` (`packages/kk-core/src/kinds.ts:68`) and `runInvoke` execution in `apps/cli/src/invoke.ts`.
- **Schema Impact**: The publish input contract is the two-form union above (0100) and the output contract is two-form likewise (0101): Content-object invocations return `ResultSchema` JSON on `--out`, show-notes array invocations write the raw markdown artifact, which `runInvoke` treats as opaque (existence + non-emptiness only). `ContentSchema` / `ResultSchema` / `DocListSchema` themselves are unchanged, and no core framework modifications are required.
- **Shipped reference instances**: `plugins/publishings/surfdash-pub` (E3), `plugins/publishings/zenn-pub` and
  `plugins/publishings/qiita-pub` (E4), `plugins/publishings/emdash-pub` (E5) — each implements `PublishTransport`
  with `kind: 'file-cli'`, its own target mapper, and env-only secrets; all are offline-tested via
  `FakeFileCliTransport`.
