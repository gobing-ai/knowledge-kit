# Publish Plugin Specification & Authoring Contract

## 1. Generic Plugin-Instance Contract Citation

This specification cites Section 1 of `docs/design/ingestion-plugin-specification.md` wholesale for manifest schema (`plugin.json`), invocation CLI contract (`--in` / `--out`), extra-config/secrets channels (env-only), and process exit-code rules. Publish plugins MUST conform to those rules without re-derivation.

---

## 2. Publish-Specific Contract

### 2.1 Kind Definition

- `kind`: `"publish"`
- `input`: `ContentSchema` (`kindContract('publish')` in `packages/kk-core/src/kinds.ts:65`).
  Generic publish is `Content → Result` (ADR-006 amendment 2026-09-10, task 0110 I3). A
  `Doc[]` input is **not** a kind-level form: `runInvoke` accepts it only when the manifest
  declares an `operations` entry with `input: 'doc-list'` (podcast-pub `show-notes`, 0095/0110).
  Undeclared arrays are rejected before spawn.
- `output`:
  - **Content input** → a `ResultSchema` JSON on `--out`
      (`{ ok, target, url?, id?, message?, error?, metadata? }`); the executor JSON-parses,
      `ResultSchema`-validates it, and treats `ok: false` as invocation failure (exit 1, artifact
      kept, 0110 I6).
  - **Declared `operations` with `output: 'markdown'`** (e.g. show-notes) → the raw markdown
      artifact on `--out` (podcast-pub's `3-publish/show-notes.md`); the executor checks existence
      + non-emptiness only. This exemption is per declared operation, not per input shape.

### 2.2 Transport Abstraction Interface

Publish plugins abstract transport mechanisms (`file-cli` vs `browser`) behind a common interface pattern:

```ts
export interface PublishTransportPayload {
    content: Content;
    options?: Record<string, unknown>;
}

export interface PublishTransport {
    kind: 'file-cli' | 'browser';
    /** Required when `kind` is `browser`. Omitted for `file-cli`. */
    driver?: 'script' | 'agent';
    publish(payload: PublishTransportPayload): Promise<Result>;
}
```

- **File/CLI Transports (`file-cli`)**: Executed by the plugin process itself — child-process
  CLIs or file manipulators (Surfdash `postsurfing` CLI, Zenn CLI via `npx zenn`) *or* direct API
  calls made by the plugin (Qiita API v2 via `fetch` with a bearer token). Classification is by
  **execution mechanism, not network usage**: a token-API channel is still `file-cli` as long as
  the plugin runs it without browser automation (ADR-008).
- **Browser Transports (`browser`)**: A real browser session against an authenticated
  profile. Declares `driver: 'script' | 'agent'` (ADR-008 amdt 2026-09-17, E7). `script`
  is Playwright (or equivalent) run inside the plugin process. `agent` is a `plugins/kk`
  skill / workflow `agent.run` driving the same session helpers; the plugin does not
  embed an LLM. Offline tests use `FakeBrowserTransport`. Profile dir defaults to
  `~/.config/kk/browser-profiles/<channel>`.

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
- **Schema Rejection (`exit != 0`)**: If a Content invocation's `--out` violates `ResultSchema`, `runInvoke` rejects execution, logs diagnostic details to `stderr`, and propagates non-zero exit. Declared markdown operations are exempt from JSON/`ResultSchema` parse (existence + non-emptiness only — §2.1, 0110 I3).

---

## 3. Platform Alignment

- **Core Verification**: Tested against `kindContract('publish')` in `@gobing-ai/kk-core` (`packages/kk-core/src/kinds.ts:65`) and `runInvoke` execution in `apps/cli/src/invoke.ts`.
- **Schema Impact**: The kind contract is `Content → Result`. Auxiliary `Doc[]` → markdown (show-notes) is a manifest-declared `operations` entry, not a kind-level union (0100/0101 were superseded by 0110 I3). `ContentSchema` / `ResultSchema` / `DocListSchema` themselves are unchanged.
- **Shipped reference instances**: `plugins/publishings/surfdash-pub` (E3), `plugins/publishings/zenn-pub` and
  `plugins/publishings/qiita-pub` (E4), `plugins/publishings/emdash-pub` (E5), `plugins/publishings/podcast-pub` (E6)
  — each implements `PublishTransport` with `kind: 'file-cli'`, its own target mapper, and env-only secrets;
  all are offline-tested via `FakeFileCliTransport`.
- **Accepted design (E7, not yet built)**: leftover wt channels plus `FakeBrowserTransport` and
  `driver: 'script' | 'agent'` — `docs/design/remaining-wt-publish-harvest.md`.
