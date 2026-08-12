# Publish Plugin Specification & Authoring Contract

## 1. Generic Plugin-Instance Contract Citation

This specification cites Section 1 of `docs/design/ingestion-plugin-specification.md` wholesale for manifest schema (`plugin.json`), invocation CLI contract (`--in` / `--out`), extra-config/secrets channels (env-only), and process exit-code rules. Publish plugins MUST conform to those rules without re-derivation.

---

## 2. Publish-Specific Contract

### 2.1 Kind Definition
- `kind`: `"publish"`
- `input`: `ContentSchema` (`{ body, title?, format?, outline?, references?, metadata? }`)
- `output`: `ResultSchema` (`{ ok, target, url?, id?, message?, error?, metadata? }`)

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
- **Schema Rejection (`exit != 0`)**: If the output written to `--out` violates `ResultSchema`, `runInvoke` rejects execution, logs diagnostic details to `stderr`, and propagates non-zero exit.

---

## 3. Platform Alignment

- **Core Verification**: Tested against `kindContract('publish')` in `@gobing-ai/kk-core` (`packages/kk-core/src/kinds.ts:24`) and `runInvoke` execution in `apps/cli/src/invoke.ts`.
- **Schema Impact**: Zero Zod schema changes or core framework modifications required.
- **Shipped reference instances**: `plugins/publishings/surfdash-pub` (E3), `plugins/publishings/zenn-pub` and
  `plugins/publishings/qiita-pub` (E4) — each implements `PublishTransport` with `kind: 'file-cli'`, its own
  target mapper, and env-only secrets; all three are offline-tested via `FakeFileCliTransport`.
