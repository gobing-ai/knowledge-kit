---
schema_version: 1
name: threads-pub — Threads text post via the official two-step publishing API
status: todo
template: feature-impl
created_at: 2026-10-09T23:19:30.092Z
updated_at: "2026-10-09T23:48:28.599Z"
feature_id: E94
priority: P2
tags:
  - publish
  - threads
  - E94
estimate_hours: 4

---

## 0243. threads-pub — Threads text post via the official two-step publishing API

### Background

New `kind: publish` plugin `plugins/publishings/threads-pub`, modelled on x-pub's `XPostApiTransport` (`plugins/publishings/x-pub/src/index.ts:104`). Design: `docs/design/weibo-threads-publish-channels.md` §2.

Implements: R1 — threads-pub posts text through the official Threads publishing API; R2 — threads-pub refuses without credentials or text and never opens a browser; R3 — threads-pub reports Threads API failures without leaking the token; R8 (threads half) — unknown operation/driver refused by name; R9 (threads half) — fake transport offline; R11 — deferred Threads media and browser paths are refused explicitly.

**Refine corrections (2026-10-09)**
- Satellite §2 "text from `content.text`" → `ContentSchema` has no `text` field (`packages/kk-core/src/schemas.ts:14`) → text is `content.body.trim() || content.title?.trim()`, exactly as x-pub (`plugins/publishings/x-pub/src/index.ts:117`).
- Fake transport unnamed → x-pub's API op uses `FakeFileCliTransport` (`plugins/publishings/x-pub/src/index.ts:453`) → threads-pub uses the same.
- "Token sent in the body" for every call → the permalink lookup is a GET (no body) → POSTs send `access_token` form-encoded in the body; the GET passes it as Meta's documented query param, and the invariant is restated as "token never in a log line, error string or Result".
- 04_DESIGN surface ownership was left to 0245 → constitution T3 keeps surface docs in the same commit as surface code → this task adds its own `docs/04_DESIGN.md` entries (package section, `REQUEST_TIMEOUT_MS` row at `docs/04_DESIGN.md:816`, transport-verdict row beside `docs/04_DESIGN.md:922`).
- New workspace package → picked up by the `plugins/publishings/*` glob (`package.json:12`) but `bun.lock` must be regenerated → Plan step 0.
- Concurrency: no `wip` tasks; worktree `knowledge-kit-runall-0237-0238-53a2` touches only `plugins/kk/scripts/daily-stages.ts` + `plugins/kk/workflows/kk-daily-ai-voice2.yaml` → no overlap.

### Requirements

- [ ] R1. Scaffold `plugins/publishings/threads-pub` (`plugin.json` `kind: publish` with no `check` field, `package.json` `@gobing-ai/threads-pub`, `tsconfig.json`, `src/index.ts`, `tests/threads-pub.test.ts`) copying x-pub's shape.
- [ ] R2. `ThreadsPostApiTransport.publish` POSTs `{THREADS_API_BASE}/{THREADS_USER_ID}/threads` (`media_type=TEXT`, `text`) then `{THREADS_API_BASE}/{THREADS_USER_ID}/threads_publish` (`creation_id`) and returns `Result {ok: true, target: 'threads', id: <media id>, url?: <permalink>, metadata: {operation: 'post'}}`; the permalink GET is best-effort and its failure never flips `ok`.
- [ ] R3. Before any network call, returns `ok: false` when `THREADS_ACCESS_TOKEN` or `THREADS_USER_ID` is missing/blank (naming the env), when text (`body.trim() || title.trim()`) is empty, or when text exceeds 500 characters (counted as code points; no truncation).
- [ ] R4. Non-2xx, malformed JSON (missing `id`), and timeout (`REQUEST_TIMEOUT_MS = 120_000`) each map to `ok: false` naming the step (`threads` container vs `threads_publish`), HTTP status and Graph `error.message`; a publish-step failure names the created container id. The token value never appears in any error string, log line or Result.
- [ ] R5. `resolveOperation` accepts only `post` (from `options.operation ?? metadata.operation ?? 'post'`); an unknown operation, any `options.driver`, `options.images` or `metadata.images` returns `ok: false` naming the value and stating threads-pub posts text only — before any transport is built.
- [ ] R6. `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake` makes `getPublishTransport()` return `FakeFileCliTransport`.
- [ ] R7. `docs/04_DESIGN.md` gains the `@gobing-ai/threads-pub` package section, the `REQUEST_TIMEOUT_MS` row entry and a transport-verdict row, in the same commit.

**Out of scope:** media/carousel/reply posts, token refresh, any browser path, retries, channel enumerations (0245).

### Acceptance Criteria

- [ ] AC1 — threads-pub posts text through the official Threads publishing API (req: R2)
- [ ] AC2 — threads-pub refuses without credentials or text and never opens a browser (req: R3)
- [ ] AC3 — threads-pub reports Threads API failures without leaking the token (req: R4)
- [ ] AC4 — deferred Threads media and browser paths are refused explicitly (req: R5)

Test layer: `plugins/publishings/threads-pub/tests/threads-pub.test.ts` stubs `globalThis.fetch` (the collaborator is the network, so the transport's own logic is observed). R6 is asserted there too; the cross-plugin R8/R9 scenarios are claimed by 0245.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T23:48:27.754Z

- **Character counting** — closed: code points (`[...text].length`), the closest match to Meta's "500 characters"; a live 4xx from Meta's own count still surfaces via R4.
- **Token transport** — closed: form body on POSTs, documented query param on the permalink GET; protection is redaction, not URL hygiene.
- **Container status poll** — deferred: added only if a live run reports a not-ready container (owner: whoever runs the first live post).
- **Driver option** — closed: threads-pub has no browser, so any `options.driver` is refused rather than ignored.

### Design

- **Approach:** one `src/index.ts` mirroring x-pub's post path — `resolveOperation` → `getPublishTransport` → `processPublishIO(--in, --out)` → `main()`; `fetch` with `AbortSignal.timeout(REQUEST_TIMEOUT_MS)`. Reason: identical rails to x-pub keep review, registry and fan-out uniform.
- **Where:** `plugins/publishings/threads-pub/{plugin.json,package.json,tsconfig.json,src/index.ts,tests/threads-pub.test.ts}`; `docs/04_DESIGN.md`. No other package changes.
- **Frozen names:** `TARGET = 'threads'`; `THREADS_API_BASE = 'https://graph.threads.net/v1.0'`; `TOKEN_ENVS = ['THREADS_ACCESS_TOKEN', 'THREADS_USER_ID']`; `MAX_TEXT_CHARS = 500`; `REQUEST_TIMEOUT_MS = 120_000`; `export const THREADS_OPERATIONS = ['post'] as const`; `export function resolveOperation(options?, content?)`; `export class ThreadsPostApiTransport implements PublishTransport` (`kind = 'file-cli'`); `export function getPublishTransport(): PublishTransport`; `export async function processPublishIO(inputPath, outputPath, transport?)`; `export async function main(): Promise<number>`.
- **Algorithm:** (1) env + text + option refusals; (2) POST container, form body `media_type=TEXT&text=…&access_token=…` → `{id}`; (3) POST publish, form body `creation_id=…&access_token=…` → `{id}`; (4) GET `/{id}?fields=permalink&access_token=…`, swallow failure. Every error string passes through `redact(msg)` that replaces the token value with `***`.
- **Anti-patterns:** no truncation (x-pub's `slice(0, 280)` is not copied); no browser import; no retry/poll loop on the container (TEXT containers publish immediately — add a status poll only if a live run shows `not ready`); no shared Graph client package (one consumer).
- **Handoff:** 0245 adds `threads-pub` to channel enumerations and a fan-out test; it relies on `getPublishTransport()` honouring the fake env and on `processPublishIO`'s `--in/--out` contract.

### Plan

- [ ] 0. `bun install` after scaffolding so `bun.lock` records `@gobing-ai/threads-pub`.
- [ ] 1. Write the failure list as failing tests first (missing env each, blank env, empty text, 501 code points, container 4xx, publish 5xx naming container id, malformed JSON, timeout, token absent from every error, unknown op, `options.driver`, images) → R3/R4/R5.
- [ ] 2. Happy-path test: two POSTs in order with form bodies, permalink present and permalink-failure-still-ok → R2.
- [ ] 3. Fake-env test → R6.
- [ ] 4. Implement `src/index.ts` until green → R1–R6.
- [ ] 5. `docs/04_DESIGN.md` entries → R7.
- [ ] 6. `bun run lint` and `bun run test` green.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature E94; design `docs/design/weibo-threads-publish-channels.md` §2
- Template: `plugins/publishings/x-pub/src/index.ts:90-162`
- Meta Threads posting: https://developers.facebook.com/docs/threads/posts/ · publishing reference: https://developers.facebook.com/documentation/threads/reference/publishing

### History
