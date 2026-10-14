---
schema_version: 1
name: threads-pub — Threads text post via the official two-step publishing API
status: done
template: feature-impl
created_at: 2026-10-09T23:19:30.092Z
updated_at: "2026-10-14T05:53:02.621Z"
feature_id: E94
priority: P2
tags:
  - publish
  - threads
  - E94
estimate_hours: 4

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0243-verdict.json
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

**Refine corrections (2026-10-11)**
- Feature R1 promised truncation and a mandatory permalink, while the task and satellite reject overlong text and use best-effort lookup → preserve the already closed no-truncation design and align feature R1 (scenario title unchanged).
- “TEXT containers publish immediately” → Meta’s official collection documents separate create/publish and container status; it does not establish that timing guarantee → remove the guarantee, keep a single attempt and explicit failure without automatic retry.
- All failures promised HTTP status → a timeout has no response → include status only when a response exists; name the failing step in every case.
- Old peer file line anchors and worktree inventory are historical → current peer symbols and Current-tree audit (2026-10-11): no WIP tasks. Other worktree `knowledge-kit-runall-g8-4173` owns G8 board/workflow work and currently edits root `package.json`, `bun.lock`, and `apps/cli/package.json`; coordinate lockfile integration before implementation, preserve its changes. The main tree has pre-existing edits in daily, store-selections, voice2-dag and wechatmp tests; preserve them.

### Requirements

- [x] R1. Scaffold `plugins/publishings/threads-pub` (`plugin.json` `kind: publish` with no `check` field, `package.json` `@gobing-ai/threads-pub`, `tsconfig.json`, `src/index.ts`, `tests/threads-pub.test.ts`) copying x-pub's shape.
- [x] R2. `ThreadsPostApiTransport.publish` POSTs `{THREADS_API_BASE}/{THREADS_USER_ID}/threads` (`media_type=TEXT`, `text`) then `{THREADS_API_BASE}/{THREADS_USER_ID}/threads_publish` (`creation_id`) and returns `Result {ok: true, target: 'threads', id: <media id>, url?: <permalink>, metadata: {operation: 'post'}}`; the permalink GET is best-effort and its failure never flips `ok`.
- [x] R3. Before any network call, returns `ok: false` when `THREADS_ACCESS_TOKEN` or `THREADS_USER_ID` is missing/blank (naming the env), when text (`body.trim() || title.trim()`) is empty, or when text exceeds 500 characters (counted as code points; no truncation).
- [x] R4. Non-2xx, malformed JSON or missing/empty/non-numeric string `id`, and timeout (`REQUEST_TIMEOUT_MS = 120_000`) each map to `ok: false` naming the step (`threads` container vs `threads_publish`), HTTP status when a response exists (otherwise explicitly no HTTP response) and a bounded, redacted Graph `error.message` when present; a publish-step failure names the created container id. The token value (including URL-encoded forms) never appears in any error string, stderr, Result or output file, including malformed-input failures and API echoes. Do not return raw response bodies, request URLs, headers or stack traces.
- [x] R5. `resolveOperation` accepts only `post` (from `options.operation ?? metadata.operation ?? 'post'`); an unknown operation, any `options.driver`, `options.images` or `metadata.images` returns `ok: false` naming the value and stating threads-pub posts text only — before any transport is built.
- [x] R6. `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake` makes `getPublishTransport()` return `FakeFileCliTransport`.
- [x] R7. `docs/04_DESIGN.md` gains the `@gobing-ai/threads-pub` package section, the `REQUEST_TIMEOUT_MS` row entry and a transport-verdict row, in the same commit.

**Out of scope:** media/carousel/reply posts, token refresh, any browser path, retries, channel enumerations (0245).

### Acceptance Criteria

- [x] AC1 — threads-pub posts text through the official Threads publishing API (req: R2)
- [x] AC2 — threads-pub refuses without credentials or text and never opens a browser (req: R3)
- [x] AC3 — threads-pub reports Threads API failures without leaking the token (req: R4)
- [x] AC4 — deferred Threads media and browser paths are refused explicitly (req: R5)

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

#### Q&A entry — 2026-10-12T04:28:43.701Z

- **Feature alignment** — closed: retain the 2026-10-09 no-truncation decision and best-effort permalink; E94 R1 body is corrected without renaming its identity.
- **Timing** — closed: no readiness guarantee or retry in this delivery; a not-ready publish fails with container context.

### Design

- **Approach:** one `src/index.ts` mirroring x-pub's post path — `resolveOperation` → `getPublishTransport` → `processPublishIO(--in, --out)` → `main()`; `fetch` with `AbortSignal.timeout(REQUEST_TIMEOUT_MS)`. Reason: identical rails to x-pub keep review, registry and fan-out uniform.
- **Where:** `plugins/publishings/threads-pub/{plugin.json,package.json,tsconfig.json,src/index.ts,tests/threads-pub.test.ts}`; `docs/04_DESIGN.md`. Also regenerate the existing `bun.lock` workspace entry; no new shared package or dependency. Use only the API-path dependencies from x-pub; omit browser-only dependencies.
- **Frozen names:** `TARGET = 'threads'`; `THREADS_API_BASE = 'https://graph.threads.net/v1.0'`; `TOKEN_ENVS = ['THREADS_ACCESS_TOKEN', 'THREADS_USER_ID']`; `MAX_TEXT_CHARS = 500`; `REQUEST_TIMEOUT_MS = 120_000`; `export const THREADS_OPERATIONS = ['post'] as const`; `export function resolveOperation(options?, content?)`; `export class ThreadsPostApiTransport implements PublishTransport` (`kind = 'file-cli'`); `export function getPublishTransport(): PublishTransport`; `export async function processPublishIO(inputPath, outputPath, transport?)`; `export async function main(): Promise<number>`.
- **Algorithm:** (1) env + text + option refusals; (2) POST container, form body `media_type=TEXT&text=…&access_token=…` → `{id}`; (3) POST publish, form body `creation_id=…&access_token=…` → `{id}`; (4) GET `/{id}?fields=permalink&access_token=…`, swallow failure. Every error string passes through `redact(msg)` that replaces the token value with `***`.
- **Anti-patterns:** no truncation (x-pub's `slice(0, 280)` is not copied); no browser import; no retry/poll loop on the container in this scope; a not-ready response is an explicit failed publish naming the container id, never evidence that no later manual retry could duplicate a post; no shared Graph client package (one consumer).
- **Handoff:** 0245 adds `threads-pub` to channel enumerations and a fan-out test; it relies on `getPublishTransport()` honouring the fake env and on `processPublishIO`'s `--in/--out` contract.

- **Validation and fake mode:** `processPublishIO` validates input shape and operation/driver/images before resolving even an injected or fake transport. Missing options defaults to post; only `undefined`/`null` operation follows the existing nullish precedence. A present driver or images option is unsupported (including wrong types); refuse with a bounded, redacted value. Real transport independently validates credentials, trimmed text and the 500-code-point bound before its first fetch. Fake mode needs no real credentials, network or browser; it does not bypass operation/driver/media refusals.
- **Failure details:** retain step and created container id on second-step HTTP, JSON and thrown timeout errors. Require decimal-string ids before interpolation into URLs or Results. Best-effort permalink accepts only an HTTPS Threads permalink without token material; omit invalid/missing/failed lookup rather than returning arbitrary Graph strings. Redact raw and percent-encoded token values at the failure/output boundary, including input-validation errors.
- **Timeout/test seam:** every fetch gets `AbortSignal.timeout(REQUEST_TIMEOUT_MS)`; tests simulate thrown `TimeoutError` and inspect the signal rather than sleeping 120 seconds. Restore `globalThis.fetch` and modified env after each case. No promise of immediate container readiness or guaranteed permalink.
- Current-tree audit (2026-10-11): no WIP tasks. Other worktree `knowledge-kit-runall-g8-4173` owns G8 board/workflow work and currently edits root `package.json`, `bun.lock`, and `apps/cli/package.json`; coordinate lockfile integration before implementation, preserve its changes. The main tree has pre-existing edits in daily, store-selections, voice2-dag and wechatmp tests; preserve them.

### Plan

- [x] 0. `bun install` after scaffolding so `bun.lock` records `@gobing-ai/threads-pub`.
- [x] 1. Write the failure list as failing tests first (missing env each, blank env, empty text, 501 code points, container 4xx, publish 5xx naming container id, malformed JSON, timeout, token absent from every error, unknown op, `options.driver`, images) → R3/R4/R5.
- [x] 2. Happy-path test: two POSTs in order with form bodies, permalink present and permalink-failure-still-ok → R2.
- [x] 3. Fake-env test → R6.
- [x] 4. Implement `src/index.ts` until green → R1–R6.
- [x] 5. `docs/04_DESIGN.md` entries → R7.
- [x] 6. `bun run lint`, `bun run test`, `bun run build` and applicable Spur rule gates pass; inspect only intentional Git changes.

- [x] 7. Verify malformed input and Graph error echoes (raw/encoded token) through `processPublishIO` and the CLI stderr/output file; test empty/non-string ids, missing permalink, 500/501 Unicode code points, operation option precedence, and fake-mode operation/media/driver refusal → R2–R6.

### Solution

#### Change map

| Path | What changed |
| --- | --- |
| `plugins/publishings/threads-pub/plugin.json` | New plugin manifest: `kind: publish`, `entry: ./src/index.ts`, deliberately **no** `check` (an API channel has no session to probe). |
| `plugins/publishings/threads-pub/package.json` | `@gobing-ai/threads-pub`: `kk-core`, `publish-harness`, `ts-runtime`, `ts-utils` only — the browser/playwright dependencies of the x-pub peer are omitted because this channel has no browser path. |
| `plugins/publishings/threads-pub/tsconfig.json` | Repo preset, `src` + `tests`. |
| `plugins/publishings/threads-pub/src/index.ts:27-49` | `redact()` — removes every configured credential in raw **and** percent-encoded form; `fail()` runs every refusal through it, so no Result can carry a token. |
| `plugins/publishings/threads-pub/src/index.ts:59-76` | `refuseUnsupportedOptions()` — the deferred surfaces: any `options.driver`, any `options.images`/`metadata.images` (R5, R11). |
| `plugins/publishings/threads-pub/src/index.ts:78-92` | `resolveOperation()` — `options.operation ?? metadata.operation ?? 'post'`, unknown by name, then the deferred-option refusal, so both gates run **before** a transport is resolved. |
| `plugins/publishings/threads-pub/src/index.ts:114-129` | `acceptPermalink()` — HTTPS + `threads.net`/`threads.com` host + no token material, else `url` is omitted. |
| `plugins/publishings/threads-pub/src/index.ts:137-197` | `ThreadsPostApiTransport.publish()` — option refusals → env refusals → trimmed text + 500-code-point cap (no truncation) → container POST → publish POST → best-effort permalink. |
| `plugins/publishings/threads-pub/src/index.ts:199-240` | `postForm()` — one form-encoded Graph POST with `AbortSignal.timeout(REQUEST_TIMEOUT_MS)`; failures name the step (`threads container` / `threads_publish`), the HTTP status when a response exists, else "no HTTP response was received", plus a bounded Graph `error.message`; ids are validated as decimal strings before any URL interpolation. |
| `plugins/publishings/threads-pub/src/index.ts:242-260` | `fetchPermalink()` — best-effort GET whose every failure returns `undefined`; it can only shorten the Result. |
| `plugins/publishings/threads-pub/src/index.ts:262-268` | `getPublishTransport()` — `FakeFileCliTransport` under `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake`, else the real Graph transport. |
| `plugins/publishings/threads-pub/src/index.ts:281-340` | `processPublishIO()` / `main()` — the x-pub `--in/--out` contract, with the invalid-input message bounded to one line and redacted. |
| `plugins/publishings/threads-pub/tests/threads-pub.test.ts` | 27 offline tests: refusals (env/blank env/empty text/501 vs 500 code points), happy path with call-order and form-body assertions, abort signal on every request, permalink acceptance matrix, 4xx/5xx/malformed-JSON/id/timeout/redaction cases, operation/driver/images refusals through the transport and `processPublishIO`, fake transport, `main()` exit codes, `runInvoke`. |
| `.spur/rules/strict/http-boundaries.yaml:46-48` | Adds `plugins/publishings/threads-pub/src/index.ts` to the `no-direct-fetch` exemption list. The rule's own description exempts transport implementations ("they ARE the HTTP boundary") and lists seven sibling channels; a new channel needs its own entry. |
| `packages/kk-core/tests/registry.test.ts:236,604` | Both hardcoded plugin inventories gain `threads-pub`, so the shipped kind-collection discovery stays asserted exactly. |
| `docs/04_DESIGN.md` | `@gobing-ai/threads-pub` package section, `REQUEST_TIMEOUT_MS` row, transport-verdict row (R7). |

#### Rationale

- **No browser fallback, not even a refusal path** (R11): the plugin carries no browser dependency and no `check` script — a driver option is a contradiction of the channel, so it is refused by name rather than ignored.
- **Refusals before anything runs**: `processPublishIO` resolves the operation and the deferred options *before* `getPublishTransport()`, so even the injected/fake transport cannot be reached with an unsupported request (R5, R9).
- **No truncation** (R3): x-pub's `slice(0, 280)` is deliberately not copied. Text over 500 code points is refused with the measured count, so a silent prefix can never be published.
- **Errors are data, not prose** (R4): the step name, an HTTP status only when a response exists, and a bounded Graph message are the whole error surface — no response bodies, URLs, headers or stack traces, and the token is stripped in both encodings.
- **Permalink is best-effort by construction** (R2): the lookup happens after a successful publish and its result is filtered, so it can only shorten the Result, never flip `ok`.

#### Notes on the remediation hops

- The registry expectation was updated here (not in 0245) because the suite asserts the shipped plugin inventory exactly; 0245 still owns the channel/enumeration surfaces (plugin-check list, `kk:publish` tables, `docs/03`).
- A second remediation fixed a leak in this task's own test file: `spyOn(globalThis, 'fetch')` was never restored, and `bun test` runs every file in one process, so the next suite's `fetch` threw (surfdash-pub's 2 s `awaitArticleLive` budget expired). The file now keeps one live spy and restores it in `afterEach`; the paired run is 76 pass / 0 fail. Evidence: `plugins/publishings/threads-pub/tests/threads-pub.test.ts` (the single live spy restored in `afterEach`); the original run record was per-tree scratch, lost by design (ADR-131).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/publishings/threads-pub/plugin.json:1-7` (`kind: publish`, no `check`), `plugins/publishings/threads-pub/package.json:1-17`, `plugins/publishings/threads-pub/tsconfig.json:1-4`, `plugins/publishings/threads-pub/src/index.ts:1-340`, `plugins/publishings/threads-pub/tests/threads-pub.test.ts:1-500`; the shipped-tree inventory asserts the plugin (`packages/kk-core/tests/registry.test.ts:238`) |
| R2 | MET | `plugins/publishings/threads-pub/src/index.ts:167-197` — container POST, publish POST with `creation_id`, best-effort permalink, `Result{ok:true,target:'threads',id,url?}`; `plugins/publishings/threads-pub/tests/threads-pub.test.ts:183-244` asserts call order, both form bodies, and the permalink matrix |
| R3 | MET | `plugins/publishings/threads-pub/src/index.ts:137-169` — `TOKEN_ENVS` blanks, empty trimmed text, and the 500-code-point cap with no truncation; `plugins/publishings/threads-pub/tests/threads-pub.test.ts:105-180` covers every branch and asserts zero fetch calls on each refusal |
| R4 | MET | `plugins/publishings/threads-pub/src/index.ts:199-240` — step name, HTTP status only with a response, explicit "no HTTP response was received" otherwise, bounded Graph `error.message`, created container id on publish-step failure, decimal-id validation; `plugins/publishings/threads-pub/tests/threads-pub.test.ts:247-316` (4xx, 5xx, non-JSON, missing/non-string/non-decimal id, timeout, redaction of both token encodings) |
| R5 | MET | `plugins/publishings/threads-pub/src/index.ts:59-92` — `options.driver`, `options.images` and `metadata.images` refused by name before a transport resolves; `plugins/publishings/threads-pub/tests/threads-pub.test.ts:319-408` (transport, `processPublishIO`, fake-mode non-bypass) |
| R6 | MET | `plugins/publishings/threads-pub/src/index.ts:262-268` — `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake` returns `FakeFileCliTransport`; `plugins/publishings/threads-pub/tests/threads-pub.test.ts:411-499` plus the `kk executor run` probe below |
| R7 | MET | `docs/04_DESIGN.md:1014` (`REQUEST_TIMEOUT_MS` row), `docs/04_DESIGN.md:1121` (transport-verdict row), `docs/04_DESIGN.md:1196-1205` (`@gobing-ai/threads-pub` package section) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — threads-pub posts text through the official Threads publishing API | MET | test | `plugins/publishings/threads-pub/tests/threads-pub.test.ts:184-209` — two POSTs in order to `{THREADS_API_BASE}/{user}/threads` then `/threads_publish`, `media_type=TEXT`, `text`, `creation_id`, result id = published media id; production `plugins/publishings/threads-pub/src/index.ts:167-197` |
| R2 — threads-pub refuses without credentials or text and never opens a browser | MET | test | `plugins/publishings/threads-pub/tests/threads-pub.test.ts:105-152` — each missing/blank env named with zero fetch calls, empty body+title refused; the package declares no browser dependency (`plugins/publishings/threads-pub/package.json:8-12`) and `plugins/publishings/threads-pub/src/index.ts:1-12` imports no browser module |
| R3 — threads-pub reports Threads API failures without leaking the token | MET | test | `plugins/publishings/threads-pub/tests/threads-pub.test.ts:247-316` — step naming (`threads container` / `threads_publish`), HTTP status, no-HTTP-response timeout, container id on publish failure, and both raw and percent-encoded token forms absent from the error; production `plugins/publishings/threads-pub/src/index.ts:27-49` and `plugins/publishings/threads-pub/src/index.ts:199-240` |
| R4 — deferred Threads media and browser paths are refused explicitly | MET | test | `plugins/publishings/threads-pub/tests/threads-pub.test.ts:337-369` — any `options.driver` and `options.images`/`metadata.images` refused with the value and "threads-pub posts text only", zero fetch calls, before any transport |
| AC1 — threads-pub posts text through the official Threads publishing API (req: R2) | MET | test | `plugins/publishings/threads-pub/tests/threads-pub.test.ts:184-209` |
| AC2 — threads-pub refuses without credentials or text and never opens a browser (req: R3) | MET | test | `plugins/publishings/threads-pub/tests/threads-pub.test.ts:105-180` |
| AC3 — threads-pub reports Threads API failures without leaking the token (req: R4) | MET | test | `plugins/publishings/threads-pub/tests/threads-pub.test.ts:247-316` |
| AC4 — deferred Threads media and browser paths are refused explicitly (req: R5) | MET | test | `plugins/publishings/threads-pub/tests/threads-pub.test.ts:337-369` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0243

**Scope:** task 0243 working diff (10 files, +906 / −4; `plugins/publishings/threads-pub/**`, `docs/04_DESIGN.md`, `packages/kk-core/tests/registry.test.ts`, `.spur/rules/strict/http-boundaries.yaml`, `bun.lock`)
**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | security | `redact()` iterates `TOKEN_ENVS`, so it also masks the `THREADS_USER_ID` value — a container id that shares a numeric run with the user id can be partially masked in a failure message. Over-redaction is the fail-safe direction (no leak), at a small legibility cost. | `plugins/publishings/threads-pub/src/index.ts:27-49` | ACCEPTED |
| 2 | P4 (advisory) | usability | The images refusal names an array as a count ("2 entries") rather than the values, because the rendering is bounded to one short line. An operator sees how many, not which. | `plugins/publishings/threads-pub/src/index.ts:59-76` | ACCEPTED |
| 3 | P4 (advisory) | security | The permalink GET carries `access_token` as Meta's documented query parameter. Redaction keeps it out of the Result, stderr and `--out` file, but an intermediary (proxy/CDN) log on the operator's network could still observe it. Removing it would require a header form Meta does not document for this call; recorded in the task's closed Q&A. | `plugins/publishings/threads-pub/src/index.ts:242-260` | ACCEPTED |
| 4 | P4 (advisory) | correctness | A **direct** `new ThreadsPostApiTransport().publish(...)` caller bypasses `resolveOperation`: `publish()` validates controller/driver/images/credentials/text but never inspects `options.operation`, so an injected transport would post regardless of the operation field. The supported entry (`processPublishIO`) resolves the operation before any transport exists, so this is a direct-caller hazard only — and matches the x-pub peer's shape. | `plugins/publishings/threads-pub/src/index.ts:137-166` | ACCEPTED |
| 5 | P4 (advisory) | correctness | `payload.content.body.trim()` is unguarded, so a direct caller passing a body-less object (bypassing `ContentSchema`) gets a thrown `TypeError` escaping `publish()` instead of an `ok: false` Result. The IO path always parses `ContentSchema` first, so no supported path can reach it; the x-pub peer has the same shape. | `plugins/publishings/threads-pub/src/index.ts:160-166` | ACCEPTED |
| 6 | P4 (advisory) | architecture | The `no-direct-fetch` exemption list is per-file: every new publish transport must add its own line. Documented by the rule's own description ("transport implementations … ARE the HTTP boundary") and consistent with the seven existing channel entries, but it is a list, not a pattern. | `.spur/rules/strict/http-boundaries.yaml:34-37` | ACCEPTED |

No P1–P3 findings. Security-relevant negatives verified by tests rather than asserted in prose: the token is absent from every failure Result in both raw and percent-encoded form (`tests/threads-pub.test.ts`, "the token never appears in an error, raw or percent-encoded"); no browser dependency or `check` script exists to open a window; error strings are single-line and carry no stack, body or request URL.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `plugins/publishings/threads-pub/{plugin.json,package.json,tsconfig.json,src/index.ts,tests/threads-pub.test.ts}` — `kind: publish`, no `check`; registry inventory asserts the shipped tree (`packages/kk-core/tests/registry.test.ts:236`) |
| R2 | MET | `src/index.ts:167-197` (container POST → publish POST → best-effort permalink) + tests "creates a TEXT container then publishes it with the returned creation_id", "a failed permalink lookup still reports success without a url" |
| R3 | MET | `src/index.ts:150-166` (env, blank env, empty trimmed text, 500-code-point cap, no truncation) + tests for each branch, including 501 vs 500 code points |
| R4 | MET | `src/index.ts:199-240` (step name, HTTP status only when a response exists, else "no HTTP response was received", bounded Graph `error.message`, container id on publish-step failure, decimal-id validation) + tests for 4xx, 5xx, malformed JSON, missing/non-string/non-decimal id, timeout, redaction |
| R5 | MET | `src/index.ts:59-92` (operation + `options.driver` + `options.images`/`metadata.images`, all refused before a transport resolves) + `processPublishIO` tests incl. the fake-transport bypass check |
| R6 | MET | `src/index.ts:262-268` `getPublishTransport()` returns `FakeFileCliTransport` under `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake`; offline `processPublishIO` and `kk executor run` probe |
| R7 | MET | `docs/04_DESIGN.md` — `@gobing-ai/threads-pub` package section, `REQUEST_TIMEOUT_MS` row, transport-verdict row |
| AC1 | MET | happy-path test asserting both POSTs, their order, the form bodies and the returned media id |
| AC2 | MET | refusal tests assert `ok: false` **and** zero fetch calls; the plugin has no browser dependency |
| AC3 | MET | failure-reporting suite, including the redaction assertion |
| AC4 | MET | driver/images refusal tests through the transport and `processPublishIO`, and the R11 statement in the message |

##### Acceptance evidence (1135 R1/R2)

Public surface probed end-to-end, throwaway root, no corpus writes:

```console
$ rm -rf /tmp/kk-threads-probe && mkdir -p /tmp/kk-threads-probe
$ printf '%s' '{"title":"Probe","body":"probe text","format":"markdown"}' > /tmp/kk-threads-probe/in.json
$ KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake bun apps/cli/src/index.ts executor run threads-pub \
      --in /tmp/kk-threads-probe/in.json --out /tmp/kk-threads-probe/out.json ; echo rc=$?
rc=0
$ cat /tmp/kk-threads-probe/out.json
{ "ok": true, "target": "fake-file-cli", "url": "https://example.com/published-post",
  "id": "fake-id-123", "message": "Published offline via FakeFileCliTransport" }
```

Changed-path static self-check: `bun run spur-check` PASS at digest `sha256:5ebff915dcac876489963671b58b7200866ee24434ef8d7b23efd702d59ff89d` (2464 pass / 2 skip / 0 fail; `test-pre-check` and `test-post-check` rule presets green).

**Next:** 0245 registers `threads-pub` wherever publish channels are enumerated, and adds its own `no-direct-fetch` entry when `weibo-pub`'s transport lands.

### References

- Feature E94; design `docs/design/weibo-threads-publish-channels.md` §2
- Template: `plugins/publishings/x-pub/src/index.ts:90-162`
- Meta Threads posting: https://developers.facebook.com/docs/threads/posts/ · publishing reference: https://developers.facebook.com/documentation/threads/reference/publishing

- Current first-party API evidence (2026-10-11): https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api and https://www.postman.com/meta/threads/request/m47wqlq/check-container-s-publishing-status . Meta developer links above returned 429/unavailable during this audit.
- Current peer implementation: `XPostApiTransport`, `resolveOperation`, `getPublishTransport`, `processPublishIO` in `plugins/publishings/x-pub/src/index.ts`; `ContentSchema`/`ResultSchema` in `packages/kk-core/src/schemas.ts`.

### History

- 2026-10-12T04:50:39.674Z todo → wip (system)
- 2026-10-12T05:52:38.902Z wip → testing (system)
- 2026-10-12T05:55:17.525Z testing → done (system)

