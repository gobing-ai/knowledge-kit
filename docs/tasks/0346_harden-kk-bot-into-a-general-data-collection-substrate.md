---
schema_version: 1
name: Harden kk bot into a general data-collection substrate
status: todo
template: feature-impl
created_at: 2026-11-09T06:36:45.705Z
updated_at: "2026-11-09T07:07:18.917Z"
feature_id: G3

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 12
---

## 0346. Harden kk bot into a general data-collection substrate

### Background

`kk bot exec` currently performs exactly one HTTP exchange per process: `execBot` launches a headless persistent context under the shared profile lease and calls `BrowserContext.request.fetch` once (`packages/publish-harness/src/browser.ts:1324-1376`). It does not navigate a page or execute page JavaScript, so a client-rendered source can return a successful SPA shell without exposing its data.

Current-tree facts audited on 2026-11-08:

- `BotExecRequest` / `BotExecResponse` are frozen for the existing curl-shaped CLI (`packages/publish-harness/src/browser.ts:1290-1317`). The existing five-verb CLI and its exact flags are pinned by `apps/cli/tests/commands/bot.test.ts:158-185`; this task must not change them.
- `BrowserSessionDescriptorSchema` already validates `profileName` and optional `homeUrl`, but `PluginManifestSchema` restricts it to `kind: "publish"` and requires `check` (`packages/kk-core/src/manifest.ts:14-48,174-204`). `PluginRecord` exposes the descriptor (`packages/kk-core/src/registry.ts:17-33`).
- Adapter selection is kind-agnostic once discovery admits a record: saved `pluginName` → unique `profileName` → unique `homeUrl` origin, with ambiguity refused (`apps/cli/src/bot-adapter.ts:42-107`). `bindAdapterSession` already forwards the actual plugin kind and scoped lease env (`apps/cli/src/bot-adapter.ts:113-135`).
- Ingestion fan-in already discovers a named ingestion plugin, spawns its entry with `--in/--out`, validates `Doc[]`, and degrades a failed source explicitly (`apps/cli/src/fanin.ts:271-340`). No fan-in change is needed for a plugin child to call a harness library directly.
- The existing launcher supports an owned lease, scoped child delegation, or its own acquisition (`packages/publish-harness/src/browser.ts:269-306`; `packages/publish-harness/src/profile-lease.ts:71-161`). A collection child with no parent lease can therefore acquire once itself; fan-in does not need to become a lease coordinator.
- Existing tests already provide fake launchers and a real local HTTP cookie round trip (`packages/publish-harness/tests/bot-session.test.ts:63-116,800-850,1007-1045`). These are the seams to extend, not a HAR server or response cache.
- `BotError` currently has `usage | not-found | busy | unconfirmed | persistence | browser` (`packages/publish-harness/src/bot.ts:84-99`). Stored `expiresAt` is explicitly an estimate, never readiness evidence (`docs/04_DESIGN.md` §1.12).

Operator-reported motivation from 2026-11-08 (not reproduced during this refinement and not acceptance evidence): raw requests to xhs, Taobao and goofish returned CSR shells, while separate CDP experiments hit anti-automation walls. These observations justify rendered acquisition, not anti-bot bypass, live-site certification, or a claim that one implementation fixes a percentage of sources.

The selected deliverable is a library-only, authentication- and navigation-capable collection runner plus the existing manifest/probe seam that lets an ingestion plugin own a named session. Site-specific selectors, pagination, parsing, politeness, production plugin registration and `kk-collect` changes remain plugin/follow-up work.

Non-goals: new `kk bot` verbs or flags; cookie/storage export or import; direct profile-directory manipulation; a HAR replay server or response cache; a warm browser daemon/pool; a declarative recipe/JSONPath/CSV engine; generic crawling or retry/politeness policy; anti-bot/robots bypass; MCP/agent surfaces; binary/media downloads; adapter special-state emulation beyond what the persistent context already provides; a production bot-backed ingestion plugin.

**Refine corrections (2026-11-08)**

- WBS collision: task `0345` → `0346`; recreated through the Spur CLI, copied all sections through CLI-mediated updates, removed 0345, and refreshed G3's generated roster.
- Requirements R1–R10 contradicted the closed Q&A (new CLI verbs and a recipe engine versus library-only plugin ownership) → the Q&A and ADR boundary are the selected decision → replaced with coherent R1–R6 and one-to-one AC coverage.
- `render`, `check`, `export/import`, `replay`, `serve`, and `extract` were proposed as new bot verbs → existing tests deliberately freeze five verbs and ADR-038 rejects a new export product → removed; the new API is a harness subpath, not CLI.
- Cookie export, foreign-Chromium profile conversion and a speculative newer-version stamp were treated as prerequisites → no reliable current-tree contract supports them and direct profile manipulation caused the reported damage → excluded; reuse the existing profile, lease and adapter boundaries instead.
- HAR replay/cache and a browser pool were presented as required test/throughput infrastructure → fake launchers and a local HTTP E2E already observe the needed behavior, and one launch per collection run is the selected throughput bound → removed.
- `browserSession` was described as an existing ingestion seam → the current schema rejects every non-publish kind → R5 explicitly expands only `publish | ingestion`, still requiring `check`; no `collectSession` key.
- Parent-side fan-in lease delegation was an implied design requirement → fan-in has no such ownership today and a plugin child can acquire the existing lease itself → keep `apps/cli/src/fanin.ts` unchanged and prove the real source-spawn path with a fixture.
- Live target responses, a `_parseSetCookieHeader` crash and an “~80%” improvement claim lacked a repository artifact or current reproduction → demoted live observations to operator-reported motivation and removed the crash/percentage from the fix premise → offline deterministic acceptance plus separately bounded live follow-up.
- Empty success was under-specified → a required capture with no match, an empty declared artifact, and an auth wall must fail even if another step returned content → frozen in R4 and AC4.
- Estimate re-evaluated after dropping invalid scope: **12h → 12h**; the narrower API still requires explicit lifecycle/deadline handling, registry/adapter coverage, a real-browser fan-in fixture and a repeatable probe artifact.

### Requirements

- [ ] R1. Bounded collection runner (P0): expose `runBotCollection(profileName, plan, options?)` from `@gobing-ai/publish-harness/bot-collection`. It executes a JSON-serializable ordered plan containing `request`, `navigate`, `wait`, `click`, `scroll`, and `extract` steps in one headless persistent context, using the named profile's existing session. HTML/text extraction and navigation results include step identity and a credential-free final URL; arbitrary JavaScript callbacks and a pagination/crawl DSL are not part of the API.
- [ ] R2. Request and response capture (P0): request steps reuse the existing authenticated cookie behavior, and declarative `responses[]` entries capture matching page responses by optional exact `origin` plus URL-path prefix. Listeners are installed before any step runs; matched response bodies, request bodies, and HTML/text extractions are returned as typed artifacts with safe IDs, observed status where applicable, and redacted URLs. Every declared capture is required to produce a non-empty artifact, so a missing data XHR cannot silently succeed behind an SPA shell.
- [ ] R3. Validation, deadlines and resource ownership (P0): validate the complete plan before profile/lease/browser side effects; require unique safe IDs and at least one artifact-producing step or response declaration. One invocation performs exactly one lease acquisition and one launch, applies a frozen whole-run deadline plus per-step timeouts, enforces post-read per-artifact and aggregate body caps and an artifact-count cap, awaits successful capture reads, and closes the context and releases ownership on every success/failure/timeout path. The existing profile is never exported, converted, or edited by a helper.
- [ ] R4. Fail-closed, secret-safe diagnostics (P0): retain existing `BotError` behavior and add `authentication` and `empty` codes plus optional step index/ID details. Explicit request/navigation/required-response status 401/403 or a final URL whose path contains a `login | signin | sign-in | auth | sso` segment fails `authentication`; other explicit status ≥400 fails `browser`. A required capture with no match or an empty declared artifact fails `empty`. Stored `expiresAt` alone never fails a run. Errors name the safe step/capture ID and renewal guidance where relevant, but never include cookie values, request-header values, query strings, fragments, response bodies, or raw Playwright URLs.
- [ ] R5. Ingestion session integration and compatibility (P0): allow `browserSession {profileName, homeUrl?}` on `kind: ingestion` as well as `publish`, still requiring a `check` probe that owns `login|check|open`; do not add `collectSession`. Existing adapter selection must bind an ingestion descriptor without special-casing, and a test ingestion plugin must run through the real `kk executor fan-in --source` path and emit schema-valid `Doc[]`. Existing publish descriptors, generic bots, `execBot`, the five `kk bot` verbs, their flags/output/exit mapping, and non-browser ingestion behavior remain compatible; no production source plugin or `kk-collect` edit ships here.
- [ ] R6. Repeatable verification and owning documentation (P1): cover the runner with fake-launcher tests and prove the consumer seam with a real-Chromium local HTTP E2E through fan-in, producing `.spur/run/e2e/0346-bot-collection.json` with zero non-loopback requests. Ship a repository probe script for hand-driving the same JSON plan without adding a `kk` command. In the same implementation change, date an ADR-038 amendment and update `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, `docs/design/kk-noun-verb-bots.md`, and `docs/design/ingestion-plugin-specification.md` with the ingestion descriptor, library boundary, failure/timeout/redaction rules, and verification limitations.

### Acceptance Criteria

```gherkin
Scenario: AC1 — one session executes an ordered rendered collection (req: R1)
  Given a local page that inserts `.note-item` only after JavaScript runs and inserts another after a click
  When a plan navigates, waits for `.note-item`, clicks once, scrolls once, and extracts HTML and body text
  Then both artifacts contain the rendered nodes and identify their steps and credential-free final URL
  And a fake-launcher/lease probe records steps in declaration order, exactly one launch, and exactly one lease acquisition
  And no pagination DSL, arbitrary JavaScript callback, or second context is involved

Scenario: AC2 — authenticated request and XHR artifacts reach an ingestion consumer (req: R2)
  Given a local `/session` response sets a test cookie and `/api/items` requires it
  And a temporary ingestion plugin declares request, navigate/wait/extract steps and a required `/api/items` response capture
  When the plugin runs through the real fan-in source-spawn path using real Chromium
  Then the request and captured JSON response and rendered extraction all reach the plugin
  And fan-in emits schema-valid `Doc[]` with deterministic source IDs
  And the local server observes the session cookie and no request leaves loopback

Scenario: AC3 — invalid or wedged runs are bounded and release every owned resource (req: R3)
  Given an invalid plan, a step that never settles, an over-cap body, and a step failure
  When each plan is executed with fake time/launcher/lease seams
  Then the invalid plan causes zero profile, lease, or launch effects
  And the wedged step stops at the declared whole-run deadline with its step index and safe ID
  And over-cap content and excess artifacts fail without entering the returned result
  And every launched context is closed and every acquired lease is released exactly once

Scenario: AC4 — missing data and authentication failures cannot masquerade as a quiet day (req: R4)
  Given explicit 401, 403 and 404 responses, a login-path redirect, a required capture with no match, and an empty artifact
  When each plan runs with query-bearing URLs, a secret header/cookie, and marker response bodies
  Then the classifications are `authentication`, `authentication`, `browser`, `authentication`, `empty`, and `empty` respectively
  And each failure names only the safe step/capture identity and, for authentication, `kk bot login <url> --save <name>` guidance
  And no diagnostic contains the query, fragment, secret header/cookie value, marker body, or raw Playwright URL
  And a profile whose stored `expiresAt` is past still runs until an observed signal classifies it

Scenario: AC5 — ingestion descriptors join the existing session boundary without CLI drift (req: R5)
  Given an ingestion manifest with `browserSession` and `check`, an ingestion descriptor without `check`, and a generator descriptor
  When manifests are parsed and adapter selection runs
  Then the first resolves and binds normally, the second is rejected naming `check`, and the generator is rejected naming its kind
  And existing publish descriptor and adapter tests still pass
  And the registered bot command remains exactly `list|login|logout|open|exec` with unchanged flags and output/exit tests
  And ordinary non-browser fan-in tests still pass without a browser installed

Scenario: AC6 — the E2E and documents leave repeatable implementation evidence (req: R6)
  Given the focused fake-launcher suites and the local HTTP fixture
  When `bun run gate` and `bun apps/cli/tests/e2e-bot-collection.ts .spur/run/e2e/0346-bot-collection.json` run
  Then the gate exits zero without skipped or suppressed tests
  And the E2E artifact records PASS, rendered and response artifacts, fan-in Doc output, authenticated local observation, and zero external requests
  And the same E2E invokes the repository probe successfully without printing artifact bodies or secrets
  And the ADR-038 amendment and all four owning design/architecture documents describe the shipped boundary and its live-site limitations
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-09T05:20:56.978Z

Closed scope decision: "general data-collection substrate" means an authentication- and navigation-capable browser primitive plus the manifest seam that lets an ingestion plugin drive it — not a declarative crawler and not a per-site recipe engine. Sites differ in selectors, pagination and politeness, and the architecture already assigns that knowledge to plugins (`docs/03_ARCHITECTURE.md` browserSession paragraph, ADR-037/038: harness owns transport and leases, plugins own site readiness and parsing). Rejected: a general-purpose selector-to-output-schema DSL inside the harness (new surface with no consumer yet); a generic crawl engine (politeness policy belongs to whichever plugin needs it).

Closed consumer decision: the substrate ships with a documented plugin seam, but no bot-backed ingestion plugin and no kk-collect edit. Fan-in already accepts any discovered ingestion plugin by name (`apps/cli/src/fanin.ts`), so a real source is one plugin plus one workflow/stage registration; that work needs an operator login and a site-specific recipe. Follow-up owner: feature G3, as a new task citing this one.

Closed launch decision: one launch per collection run with an ordered step list, because every `execBot` call pays a Chromium cold start and an exclusive lease acquire (`browser.ts:1324-1369`, `profile-lease.ts:86`). Rejected: one launch per step (N× cost and N× lease churn); exporting cookies out of the profile to feed a plain fetch (the profile's cookies must stay inside the browser — A23's amendment deliberately keeps `exec` non-exporting).

Closed failure decision: fail on an observed auth wall, never on the stored `expiresAt` estimate (`docs/04_DESIGN.md` §1.12 states it is never a readiness claim). An empty collection is indistinguishable from a quiet day (`plugins/kk/workflows/kk-collect.yaml:114`), so silence is the one outcome the substrate must refuse. Auth-wall rule is deterministic: request step status 401/403, or a page step whose final URL path carries a `login | signin | sign-in | auth | sso` segment.

Closed API decision: extend the existing `browserSession` descriptor rather than add a `collectSession` key — one session concept with one shape, and the `check` probe requirement stays (a session with no probe has no owner for login/check/open). No new `kk bot` verb: the scheduled path is plugin-owned, and an operator debugging a step list by hand can use the probe script this task ships.

Deferred with owner: bot-backed ingestion plugin + kk-collect registration (G3 follow-up); an operator-facing `kk bot collect <name>` verb (only if hand-driving recipes becomes routine); rate/politeness policy (plugin-owned, per site).

#### Q&A entry — 2026-11-08 ready-depth audit

Closed implementation decision: the ordered step list is a small JSON-serializable library plan, not a site recipe format. It has no URL templating, output-schema mapping, CSV/JSONL writer, pagination engine, politeness rules, or arbitrary JavaScript callbacks. A plugin may generate a bounded list of steps in its own code; the harness owns only execution, capture, classification, and cleanup.

Closed lease decision: fan-in remains lease-agnostic. A bot-backed ingestion entry runs in its own plugin child and calls the runner, which acquires one existing profile lease for that collection run. Parent-side delegation would add coupling without removing a launch or lease and is rejected. Existing parent/child delegation remains in use for `kk bot` adapter calls.

Closed test decision: no HAR replay server or response cache. Fake launchers prove orchestration and failure semantics; real Chromium against a loopback server proves JS rendering, cookie reuse, XHR capture, and fan-in consumption. Live anti-bot behavior is explicitly not acceptance evidence.

Closed compatibility decision: `execBot` and all existing bot verbs stay byte-for-byte on their public contract. The collection runner lives in a sibling module/subpath so adding it cannot change existing `BrowserContext.request.fetch` behavior. Shared URL/error/closure helpers are reused rather than copied.

Closed readiness decision: every declared capture is required and every declared artifact must be non-empty. A plugin that legitimately has no items may parse a non-empty successful payload and emit `Doc[] = []`; the harness failure is reserved for missing acquisition/auth data, not a quiet source day.

### Design

**Chosen shape.** Add one deep library module, `packages/publish-harness/src/bot-collection.ts`, exported as `@gobing-ai/publish-harness/bot-collection` through `packages/publish-harness/package.json`. It imports the existing browser/session primitives; `browser.ts` does **not** import or re-export the collection module, so there is no cycle and existing browser consumers do not load the new runner. Leave `execBot` and every CLI registrar unchanged. Export the existing sibling helpers `validateExecUrl`, `execFailureDetail`, `closeBotContext`, `missingBotProfile`, and `openBotPage` from `browser.ts` for reuse rather than duplicating their redaction/closure behavior. This is a workspace-library subpath, not a new package or product command.

**Frozen API.** The plan is data, so the repository probe and ingestion plugins use exactly the same runner:

```ts
export interface BotCollectionPlan {
    steps: BotCollectionStep[];
    responses?: BotResponseCapture[];
    /** Whole invocation; default 120_000, valid 1..600_000. */
    timeoutMs?: number;
}

export type BotCollectionStep =
    | { id: string; type: 'request'; url: string; method?: string; headers?: Record<string, string>;
        data?: string; followRedirects?: boolean; timeoutMs?: number }
    | { id: string; type: 'navigate'; url: string;
        waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'; timeoutMs?: number }
    | { id: string; type: 'wait'; selector: string; timeoutMs?: number }
    | { id: string; type: 'click'; selector: string; timeoutMs?: number }
    | { id: string; type: 'scroll'; deltaY: number; timeoutMs?: number }
    | { id: string; type: 'extract'; format: 'html' | 'text'; selector?: string; timeoutMs?: number };

export interface BotResponseCapture {
    id: string;
    /** Exact scheme/host/port, no path/query/fragment/credentials. */
    origin?: string;
    /** Absolute URL pathname prefix; '?' and '#' are forbidden. */
    pathPrefix: string;
}

export interface BotCollectionArtifact {
    id: string;
    kind: 'request' | 'response' | 'html' | 'text';
    body: string;
    status?: number;
    /** Origin + pathname only; query and fragment are always removed. */
    url?: string;
    stepIndex?: number;
}

export interface BotCollectionStepResult {
    index: number;
    id: string;
    type: BotCollectionStep['type'];
    url?: string;
}

export interface BotCollectionResult {
    steps: BotCollectionStepResult[];
    artifacts: BotCollectionArtifact[];
}
```

`BotCollectionOptions extends BotSessionOptions` with two deterministic test seams: optional `acquireLease` (default `acquireProfileLease`) and `now` (default `Date.now`). `BotCollectionStepResult.index` and `BotError.stepIndex` are the zero-based position in `plan.steps`; the probe prints that same index without translation. Existing `root`, `leaseRoot`, `fileSystem`, and `launcher` injections remain the only root/browser overrides. Request `data` is UTF-8 text and becomes a `Buffer` only at the existing fetch boundary; method defaults to `POST` with data, otherwise `GET`; redirects default to false, matching `execBot`. Binary payloads are explicitly out of scope.

IDs share one namespace across steps and response declarations and match `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`. Every timeout is a positive integer; a per-step timeout may exceed the default but is always clamped to the remaining whole-run budget. URLs use the existing `validateExecUrl`; selectors are non-empty; `deltaY` is a finite non-zero number; `origin` is normalized with `new URL(...).origin`; `pathPrefix` begins `/` and contains no query/fragment. A plan with no request/extract step and no response declaration is `usage`. All validation completes before checking/acquiring the profile.

**Execution and limits.** The runner checks that the named profile already exists, acquires once, launches once headless, and registers all `context.on('response')` listeners before executing steps. `request` uses `context.request.fetch`; `navigate` uses `page.goto` (default `waitUntil: 'load'`); `wait` uses `waitForSelector`; `click` uses the first locator; `scroll` evaluates `window.scrollBy(0, deltaY)`; `extract` returns whole-page HTML/body innerText or the first matching element's outerHTML/innerText. Steps execute sequentially in declaration order.

Defaults/constants are `30_000 ms` per step, `120_000 ms` whole-run (maximum `600_000`), `5 MiB` per artifact, `20 MiB` aggregate returned bodies, and `100` artifacts. Each operation receives the smaller of its step timeout and remaining whole-run budget. Track matched response body promises and their rejections explicitly; on success await them within the same deadline before validating captures and returning. On failure close first to cancel in-flight browser work, drain capture promises with `Promise.allSettled` so no rejection is orphaned, then release. Add `shortcut: Playwright response bodies are buffered before the post-read cap; add streaming only for a real large-download consumer` at the body-read helper. Do not claim the post-read cap bounds upstream buffering.

Every request/extract artifact must be non-empty after trimming. Every response declaration must yield at least one non-empty matching artifact. This makes all declared outputs required; a plugin omits optional declarations rather than weakening the runner's quiet-day guard. `authentication` covers explicit 401/403 and the final-URL path regex `/(?:^|\/)(?:login|signin|sign-in|auth|sso)(?:\/|$)/i`; other explicit statuses ≥400 are `browser`. Required responses with no match and empty declared outputs are `empty`. Unrelated background responses neither match nor fail the plan.

Extend `BotErrorCode` with `authentication | empty` and `BotError` with optional `stepIndex` / `stepId` details. Reuse `execFailureDetail` only for URL-free transport/navigation details, then remove every supplied request-header/data value and cap the result. Status, body-read, capture and extraction failures use static messages rather than raw Playwright/body text; cookie values are never read into diagnostics. Return only origin+pathname in results. Response headers are not returned, `Set-Cookie` is never copied into an artifact, and request headers/data are never included in diagnostics. Existing CLI mapping naturally maps both new codes to operational exit 1 without changing the CLI. Authentication guidance is exactly `run \`kk bot login <url> --save <profileName>\``; no retry or anti-bot bypass is attempted. Stored `expiresAt` is never read by the runner.

**Manifest and consumer flow.** In `packages/kk-core/src/manifest.ts`, change only the `browserSession` refinement and its kind-specific comments to accept `publish | ingestion`, keep the mandatory `check`, and update the diagnostic text. Update the `PluginRecord.browserSession` comment in `registry.ts`. `apps/cli/src/bot-adapter.ts` needs no production edit: its existing candidate selection and `bindAdapterSession` already work once an ingestion record exists; add an ingestion test row. `apps/cli/src/fanin.ts` and `apps/cli/src/invoke.ts` need no production edit: the plugin child calls `runBotCollection`, which acquires/leases the profile in that child for the duration of its one collection run. Existing scoped delegation remains unchanged for bot adapter subprocesses.

The E2E uses a temporary fixture under `apps/cli/tests/fixtures/plugins/ingestions/e2e-bot-collection/` with `plugin.json`, an entry, and a minimal check probe. The fixture passes test-local profile/lease roots from its input config to the library, calls the real runner, maps returned artifacts to deterministic `Doc[]`, and runs through `runFanin`. It is test evidence, not a discovered production plugin.

**Probe and E2E artifact.** Add `packages/publish-harness/scripts/bot-collection-probe.ts`:

```text
bun packages/publish-harness/scripts/bot-collection-probe.ts \
  --profile <name> --plan <plan.json> --out <dir> [--profile-root <dir> --lease-root <dir>]
```

The script validates arguments and reports plan field paths without echoing supplied values; it writes each body to a safe numbered artifact file and writes `result.json` without bodies; files are `0600` and created directories `0700`. Success JSON contains `ok: true`, steps, and artifact metadata/file names. Failure writes `error.json` containing only the typed code/message/step details, exits 2 for `usage` and 1 otherwise, and never prints bodies or query-bearing URLs. It is a repository debugging/E2E script, not an installed `kk` surface, so ADR-037 and the bot command inventory do not change.

Add `apps/cli/tests/e2e-bot-collection.ts` (not a default unit-test file). Its loopback server covers session-cookie setting, a JS-rendered list, authenticated XHR, click interaction, login redirects, and status fixtures. It runs the real fan-in fixture and the repository probe with real Chromium and temporary roots, then writes `.spur/run/e2e/0346-bot-collection.json` containing `pass`, Doc evidence, rendered/captured artifact evidence, launch observations supplied by the fixture, `authenticated: true`, and `externalRequests: 0`. No live xhs/Taobao/goofish run is part of the default gate or acceptance.

**Owning documentation.** The implementation commit adds an ADR-038 amendment: ingestion plugins may declare the same session descriptor; the bounded library runner is transport infrastructure; fan-in and the CLI remain unchanged; cookie export, replay/cache, pools and recipe crawling are rejected. Update the named-browser boundary in `docs/03_ARCHITECTURE.md`, the bot/manifest surface and library contract in `docs/04_DESIGN.md`, the shipped boundary in `docs/design/kk-noun-verb-bots.md`, and ingestion authoring/empty-vs-fatal semantics in `docs/design/ingestion-plugin-specification.md`. Do not rewrite ADR-037 or feature status.

**Rejected alternatives.** (1) Add collection flags/verbs to `kk bot`: rejected by the closed API decision and existing surface tests. (2) Make fan-in coordinate browser leases: unnecessary coupling because the child can own one lease, and concurrent same-profile callers must still fail `busy`. (3) Put `runBotCollection` in `browser.ts`: rejected for further bloating an already large lifecycle module; a one-way sibling import avoids cycles. (4) Accept arbitrary page callbacks: easier for callers initially, but not JSON-serializable, probeable, bounded, or a stable contract. (5) HAR/cache/daemon/recipe infrastructure: no consumer and explicitly out of scope.

**Dependencies and ownership.** No task dependencies, no active WIP tasks/worktrees touching these files, and no new runtime/package dependency. Primary ownership: `packages/publish-harness/src/{bot-collection,browser,bot}.ts`, `packages/publish-harness/package.json`, `packages/publish-harness/tests/bot-collection.test.ts`, the probe/E2E scripts and fixture, `packages/kk-core/src/{manifest,registry}.ts`, `packages/kk-core/tests/registry.test.ts`, `apps/cli/tests/bot-adapter.test.ts`, and the five named docs. Existing `bot-session` and CLI bot suites are regression evidence, not rewrite targets. A G3 follow-up owns a real ingestion plugin and workflow registration; this task leaves no partial production plugin behind.

### Plan

1. **Red-first contract inventory (R1–R6).** Add failing `packages/publish-harness/tests/bot-collection.test.ts` cases for plan validation, ordered steps, one launch/lease, capture timing, auth/empty classification, redaction, deadline/caps, and cleanup. Add failing registry/adapter cases for ingestion descriptors and a loopback E2E script/fixture whose initial run fails because the runner and ingestion descriptor do not exist. Keep existing bot/CLI/fan-in suites unchanged as compatibility controls.
2. **Manifest seam (R5).** Relax only the `browserSession` kind guard to `publish | ingestion`, retain `check`, update `PluginRecord` documentation, and make the registry/adapter tests green without modifying adapter selection, fan-in, invoke, or existing CLI registration.
3. **Runner skeleton and lifecycle (R1, R3).** Add the `bot-collection` export and frozen types; reuse/export the existing browser helpers without moving `execBot`. Implement full pre-side-effect validation, profile existence, one injected lease acquisition, one headless launch, sequential step execution, deadline arithmetic, and `finally` cleanup. Make the validation/order/lifecycle tests green before adding capture behavior.
4. **Artifacts and failure semantics (R1–R4).** Implement request/navigation/wait/click/scroll/extract, pre-registered response capture, safe result shaping, required/non-empty captures, status/auth-wall handling, body/artifact caps, pending-read settlement, and `authentication`/`empty` details. Run the complete fake-launcher matrix plus existing `bot-session` and CLI bot tests.
5. **Probe and consumer E2E (R2, R5, R6).** Implement the repository probe and finish the loopback fan-in fixture/E2E. Run real Chromium twice as needed to prove persisted-session reuse, rendered extraction, authenticated XHR capture, fan-in `Doc[]`, and the probe's body-free `result.json`; emit the required PASS artifact and verify it contains no cookie, query secret, or external URL.
6. **Authority and surface docs (R5, R6).** Add the dated ADR-038 amendment and update the architecture, bot design/surface, and ingestion authoring docs in the same change. Confirm no `kk` command table entry or new package/dependency was introduced and document live-site/special-state/binary limits rather than implying live certification.
7. **Focused and final verification (all).** Run the new/impacted suites first, then `bun run gate`; run `bun apps/cli/tests/e2e-bot-collection.ts .spur/run/e2e/0346-bot-collection.json` as a separate repeatable artifact check. Inspect `git status`/diff for intentional ownership only. No installed `kk` synchronization or scheduled-workflow restart is required because this task adds no production consumer and edits no `kk-collect` path.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent feature: `docs/features/G3_kk-collect.md` (substrate only; production source registration deferred to a G3 follow-up).
- Decisions and boundaries: `docs/00_ADR.md` ADR-037/038 and the A23 `bot exec` amendment; `docs/03_ARCHITECTURE.md` “Named browser-session boundary”; `docs/design/kk-noun-verb-bots.md`.
- Current implementation evidence: `packages/publish-harness/src/browser.ts:1290-1422`; `packages/publish-harness/src/profile-lease.ts:71-161`; `packages/publish-harness/src/bot.ts:84-99`; `packages/kk-core/src/manifest.ts:174-204`; `apps/cli/src/bot-adapter.ts:42-135`; `apps/cli/src/fanin.ts:271-340`.
- Compatibility evidence: `apps/cli/tests/commands/bot.test.ts:158-185`; `packages/publish-harness/tests/bot-session.test.ts:800-1045`; `packages/kk-core/tests/registry.test.ts:692-763`; `apps/cli/tests/bot-adapter.test.ts`.
- Local API authority: installed Playwright `1.55.0`; `node_modules/.bun/playwright-core@1.55.0/node_modules/playwright-core/types/types.d.ts` (`page.goto`, `waitForSelector`, `content`, locator `innerText`, response `body`, `context.on('response')`). Chromium executable `/Users/robin/Library/Caches/ms-playwright/chromium-1187/chrome-mac/Chromium.app/Contents/MacOS/Chromium` was confirmed present on 2026-11-08. No newer Playwright API is assumed.
- Environment/concurrency audit (2026-11-08): one worktree (`/Users/robin/xprojects/knowledge-kit`), no `wip` tasks, no task dependencies, Playwright catalog install `1.55.0`. Only the new 0346 task and the CLI-refreshed G3 roster were dirty before this refinement.
- Live-site observations are operator-reported motivation only; no iradar artifact was found or used as verification. Acceptance is loopback-only and does not certify xhs, Taobao, goofish, anti-bot behavior, or adapter special-state compatibility.

### History

- 2026-11-08 renumbered task 0345 to 0346 through Spur CLI creation and section migration; original readiness rationale is preserved in Background corrections.
- 2026-11-09T07:02:19.892Z backlog → todo (system)

