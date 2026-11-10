---
schema_version: 1
name: Harden kk bot into a general data-collection substrate
status: done
template: feature-impl
created_at: 2026-11-09T06:36:45.705Z
updated_at: "2026-11-09T22:47:50.359Z"
feature_id: G3

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 12
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0346-verdict.json
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

- [x] R1. Bounded collection runner (P0): expose `runBotCollection(profileName, plan, options?)` from `@gobing-ai/publish-harness/bot-collection`. It executes a JSON-serializable ordered plan containing `request`, `navigate`, `wait`, `click`, `scroll`, and `extract` steps in one headless persistent context, using the named profile's existing session. HTML/text extraction and navigation results include step identity and a credential-free final URL; arbitrary JavaScript callbacks and a pagination/crawl DSL are not part of the API.
- [x] R2. Request and response capture (P0): request steps reuse the existing authenticated cookie behavior, and declarative `responses[]` entries capture matching page responses by optional exact `origin` plus URL-path prefix. Listeners are installed before any step runs; matched response bodies, request bodies, and HTML/text extractions are returned as typed artifacts with safe IDs, observed status where applicable, and redacted URLs. Every declared capture is required to produce a non-empty artifact, so a missing data XHR cannot silently succeed behind an SPA shell.
- [x] R3. Validation, deadlines and resource ownership (P0): validate the complete plan before profile/lease/browser side effects; require unique safe IDs and at least one artifact-producing step or response declaration. One invocation performs exactly one lease acquisition and one launch, applies a frozen whole-run deadline plus per-step timeouts, enforces post-read per-artifact and aggregate body caps and an artifact-count cap, awaits successful capture reads, and closes the context and releases ownership on every success/failure/timeout path. The existing profile is never exported, converted, or edited by a helper.
- [x] R4. Fail-closed, secret-safe diagnostics (P0): retain existing `BotError` behavior and add `authentication` and `empty` codes plus optional step index/ID details. Explicit request/navigation/required-response status 401/403 or a final URL whose path contains a `login | signin | sign-in | auth | sso` segment fails `authentication`; other explicit status ≥400 fails `browser`. A required capture with no match or an empty declared artifact fails `empty`. Stored `expiresAt` alone never fails a run. Errors name the safe step/capture ID and renewal guidance where relevant, but never include cookie values, request-header values, query strings, fragments, response bodies, or raw Playwright URLs.
- [x] R5. Ingestion session integration and compatibility (P0): allow `browserSession {profileName, homeUrl?}` on `kind: ingestion` as well as `publish`, still requiring a `check` probe that owns `login|check|open`; do not add `collectSession`. Existing adapter selection must bind an ingestion descriptor without special-casing, and a test ingestion plugin must run through the real `kk executor fan-in --source` path and emit schema-valid `Doc[]`. Existing publish descriptors, generic bots, `execBot`, the five `kk bot` verbs, their flags/output/exit mapping, and non-browser ingestion behavior remain compatible; no production source plugin or `kk-collect` edit ships here.
- [x] R6. Repeatable verification and owning documentation (P1): cover the runner with fake-launcher tests and prove the consumer seam with a real-Chromium local HTTP E2E through fan-in, producing `.spur/run/e2e/0346-bot-collection.json` with zero non-loopback requests. Ship a repository probe script for hand-driving the same JSON plan without adding a `kk` command. In the same implementation change, date an ADR-038 amendment and update `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, `docs/design/kk-noun-verb-bots.md`, and `docs/design/ingestion-plugin-specification.md` with the ingestion descriptor, library boundary, failure/timeout/redaction rules, and verification limitations.

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
  And the registered bot command keeps `list|login|logout|open|exec` with unchanged flags and output/exit tests (a sixth `plan` verb was added later by the ADR-038 amendment of 2026-11-09; see the Solution correction)
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

Change map (R1–R6), all inside the 0346 ownership surface:

- `packages/publish-harness/src/bot-collection.ts` (new) — the runner, one direction of dependency (`browser.ts` never imports it):
  - `:41-111` frozen, JSON-serializable plan/artifact/result contracts (no callbacks, no recipe DSL).
  - `:290-330` whole-plan validation (ids unique across steps and captures, URL/selector/timeout/deltaY/origin/pathPrefix rules, artifact-source requirement, `timeoutMs` ceiling) runs before the profile lookup, the lease or a launch.
  - `:341-357` `classifyStatus` — 401/403 → `authentication`, other explicit ≥400 → `browser`; `:330-338` the `AUTH_PATH` final-URL rule; `:359-366` `emptyFailure` names step/capture id only.
  - `:384-522` ordered step executor: `request` via `context.request.fetch` (POST default with data, `maxRedirects: 0` unless `followRedirects`), `navigate` via `page.goto`, `wait`/`click`/`scroll`, `extract` (whole page or first matching element), each with the smaller of its own timeout and the remaining run budget.
  - `:368-372` `readBody` with the `shortcut:` note that Playwright buffers before the post-read cap; `:532-556` per-artifact, aggregate and artifact-count caps.
  - `:576-680` `runBotCollection`: safe name → profile must exist (`missingBotProfile`, never created) → one `acquireLease` → one headless launch → listeners registered **before** the first step → sequential steps → capture settlement inside the deadline → `finally` closes the context, drains capture promises and releases the lease on every path. Captures are read at response time and never reject; an unreadable body is fatal only when it leaves that declaration with nothing.
- `packages/publish-harness/src/bot.ts:89-115` — `BotErrorCode` gains `authentication | empty`; `BotError` carries `details {stepIndex?, stepId?}` (existing two-arg callers unchanged).
- `packages/publish-harness/src/browser.ts:1376,1398,1433,1444,1473` — `validateExecUrl`, `execFailureDetail`, `missingBotProfile`, `openBotPage`, `closeBotContext` exported so the runner reuses redaction/closure instead of copying it. `execBot`, `BotExecRequest/Response` and every CLI registrar are byte-for-byte unchanged.
- `packages/publish-harness/package.json:8` — `./bot-collection` sub-path export (workspace library, not a new package).
- `packages/kk-core/src/manifest.ts:190-205` — the `browserSession` refinement accepts `publish | ingestion` and still requires `check`; `packages/kk-core/src/registry.ts:29` documents the same on `PluginRecord`. `apps/cli/src/bot-adapter.ts`, `apps/cli/src/fanin.ts` and `apps/cli/src/invoke.ts` needed no production edit.
- Tests: `packages/publish-harness/tests/bot-collection.test.ts` (fake launcher/lease matrix: validation-before-side-effects, order, one launch/lease, capture timing and multiplicity, auth/empty/browser classification, redaction, deadlines, caps, cleanup, `expiresAt` never read); `packages/kk-core/tests/manifest.test.ts` + `registry.test.ts` (ingestion descriptor accepted, generator still rejected naming its kind, ingestion record propagated); `apps/cli/tests/bot-adapter.test.ts` (ingestion descriptor binds; a probe-less ingestion record still refuses). Existing `bot-session` and CLI bot suites are untouched regression controls.
- Evidence surfaces: `packages/publish-harness/scripts/bot-collection-probe.ts` (hand-driving the same JSON plan; artifact bodies to `0600` files, body-free `result.json`, typed `error.json`, exit 2 only for `usage`); `apps/cli/tests/e2e-bot-collection.ts` + `apps/cli/tests/fixtures/plugins/ingestions/e2e-bot-collection/` (real Chromium through the real `runFanin --source` source-spawn path and through the probe, writing `.spur/run/e2e/0346-bot-collection.json`).
- Docs in the same change: ADR-038 amendment (2026-11-09) in `docs/00_ADR.md`; boundary in `docs/03_ARCHITECTURE.md` ("Named browser-session boundary"); runner contract as `docs/04_DESIGN.md` §1.13 plus the §1.12 descriptor line; `docs/design/kk-noun-verb-bots.md`; `docs/design/ingestion-plugin-specification.md` §2.4/§2.5.

Why this shape: the plan is data, so a plugin and the probe use one runner; the lease is acquired by the collection child itself, so fan-in gained no coordination and concurrent same-profile callers still fail `busy`; and the runner lives in a sibling module so no existing browser consumer loads it. Documented limits (no cookie export, no replay/cache, no pool, no recipe/crawl engine, no anti-bot bypass, no binary payloads, loopback-only verification) are stated in the docs rather than implied away.

**Post-ship correction — 2026-11-09 (ADR-038 amendment "canonical collection execution via kk bot plan").** A later decision (commit d356308, follow-ups 5ddfc3d/bb6c894) added a sixth verb, `kk bot plan`, registered at `apps/cli/src/commands/bot.ts:398`. That supersedes this task's "no new `kk bot` verb" stance in R5/AC5. The compatibility intent that R5/AC5 protected still holds:
- `list|login|logout|open|exec` keep their flags, output and exit mapping. The control at `apps/cli/tests/commands/bot.test.ts:178` now pins six verbs, and the five pre-existing verbs' flag/output/exit tests are unchanged.
- `browser.ts` still neither imports nor re-exports `bot-collection`. The CLI loads the sub-path directly at `apps/cli/src/commands/bot.ts:41`.
- bb6c894 makes the runner take its response captures from the normalized plan (`packages/publish-harness/src/bot-collection.ts:639`) instead of the raw input.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/publish-harness/src/bot-collection.ts:621` runBotCollection; ordered loop at `packages/publish-harness/src/bot-collection.ts:700`; sub-path export `packages/publish-harness/package.json:8`; `packages/publish-harness/tests/bot-collection.test.ts:406` order + identity + redacted URL (211 pass / 0 fail across 7 focused files this run) |
| R2 | MET | `packages/publish-harness/src/bot-collection.ts:657` response listener installed before the first step; `packages/publish-harness/tests/bot-collection.test.ts:523` early capture + unrelated traffic ignored; E2E `apps/cli/tests/e2e-bot-collection.ts:165` real fan-in PASS this run |
| R3 | MET | `packages/publish-harness/src/bot-collection.ts:292` normalizePlan before profile/lease (`packages/publish-harness/src/bot-collection.ts:632-636`); finally close/drain/release `packages/publish-harness/src/bot-collection.ts:761-765`; `packages/publish-harness/tests/bot-collection.test.ts:274` and `packages/publish-harness/tests/bot-collection.test.ts:812` pass this run |
| R4 | MET | `packages/publish-harness/src/bot-collection.ts:347` classifyStatus 401/403 authentication, other >=400 browser; `packages/publish-harness/src/bot-collection.ts:40` AUTH_PATH; `packages/publish-harness/src/bot-collection.ts:371` emptyFailure; codes in `packages/publish-harness/src/bot.ts:100-101`; `packages/publish-harness/tests/bot-collection.test.ts:611` pass this run |
| R5 | MET | `packages/kk-core/src/manifest.ts:194` publish or ingestion, `check` still required; `packages/kk-core/src/registry.ts:30`; `apps/cli/tests/bot-adapter.test.ts:116`; five-verb control `apps/cli/tests/commands/bot.test.ts:177` passes at HEAD |
| R6 | MET | `bun apps/cli/tests/e2e-bot-collection.ts .spur/run/e2e/0346-bot-collection.json` exit 0 this run (pass true, externalRequests 0, authenticated true, 3 docs); probe `packages/publish-harness/scripts/bot-collection-probe.ts`; docs `docs/00_ADR.md:1515`, `docs/03_ARCHITECTURE.md:637`, `docs/04_DESIGN.md:1306`, `docs/design/kk-noun-verb-bots.md:94`, `docs/design/ingestion-plugin-specification.md:73` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — one session executes an ordered rendered collection (req: R1) | MET | test | `packages/publish-harness/tests/bot-collection.test.ts:406` order/one launch/one lease; rendered `.note-item` + click proven by E2E checks oneLaunchPerRun/oneLeasePerRun (pass this run) |
| AC2 — authenticated request and XHR artifacts reach an ingestion consumer (req: R2) | MET | command | `bun apps/cli/tests/e2e-bot-collection.ts .spur/run/e2e/0346-bot-collection.json` this run: real `kk executor fan-in --source` spawn at `apps/cli/tests/e2e-bot-collection.ts:165`, docs 3, authenticated true, externalRequests 0, allArtifactUrlsLoopback true |
| AC3 — invalid or wedged runs are bounded and release every owned resource (req: R3) | MET | test | `packages/publish-harness/tests/bot-collection.test.ts:274` zero side effects on invalid plans; `packages/publish-harness/tests/bot-collection.test.ts:746` wedged steps bounded; `packages/publish-harness/tests/bot-collection.test.ts:828` caps; `packages/publish-harness/tests/bot-collection.test.ts:868` cleanup (pass this run) |
| AC4 — missing data and authentication failures cannot masquerade as a quiet day (req: R4) | MET | test | `packages/publish-harness/tests/bot-collection.test.ts:612` 401/403, `packages/publish-harness/tests/bot-collection.test.ts:622` 404, `packages/publish-harness/tests/bot-collection.test.ts:628` login redirect, `packages/publish-harness/tests/bot-collection.test.ts:558` empty capture, `packages/publish-harness/tests/bot-collection.test.ts:774` empty extract, `packages/publish-harness/tests/bot-collection.test.ts:677` redaction, `packages/publish-harness/tests/bot-collection.test.ts:789` expiresAt ignored (pass this run) |
| AC5 — ingestion descriptors join the existing session boundary without CLI drift (req: R5) | MET | test | `packages/kk-core/tests/manifest.test.ts:88` accepts ingestion, `packages/kk-core/tests/manifest.test.ts:99` rejects missing check, `packages/kk-core/tests/manifest.test.ts:112` rejects generator; `apps/cli/tests/bot-adapter.test.ts:119`; `apps/cli/tests/commands/bot.test.ts:177` five verbs at HEAD |
| AC6 — the E2E and documents leave repeatable implementation evidence (req: R6) | MET | command | `bun run gate` on clean HEAD worktree this run: exit 0, 58 pre-check rules pass, 4799 pass / 0 fail across 243 files, 2 post-check rules pass; E2E artifact `.spur/run/e2e/0346-bot-collection.json` pass true with probe checks probeStdoutHasNoBodies/probeArtifactPermissions true |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS

Confidence: MEDIUM

#### Findings

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 | correctness | `extract` used Playwright calls (`content()`, `evaluate()`, `innerText()` shapes) that take no timeout, so a wedged page could outlive the whole-run deadline and violate R3's per-step bound | packages/publish-harness/src/bot-collection.ts:562 | RESOLVED — `applyTimeout` bounds every extraction and the failure is classified `browser` with the step id; covered by packages/publish-harness/tests/bot-collection.test.ts:677 |
| 2 | P3 | correctness | `safeUrl` turned a never-navigated page (`about:blank`, origin literal `null`) into the URL `nullblank` in extraction artifacts | packages/publish-harness/src/bot-collection.ts:324 | RESOLVED — non-http(s) URLs now yield no `url` at all; covered by packages/publish-harness/tests/bot-collection.test.ts:471 |
| 3 | P4 (advisory) | reliability | A matched response body evicted by a later navigation is dropped rather than failing the run; only a declaration that ends with no usable body fails | packages/publish-harness/src/bot-collection.ts:694 | RESOLVED — deliberate and tested (one eviction among several matches stays green; an empty declaration is a typed failure) at packages/publish-harness/tests/bot-collection.test.ts:554 |
| 4 | P4 (advisory) | security | The post-read body caps bound what is returned, not Playwright's upstream buffering | packages/publish-harness/src/bot-collection.ts:372 | DEFER — stated as a `shortcut:` at the read helper; streaming waits for a real large-download consumer |
| 5 | P4 (advisory) | operations | Cross-launch cookie reuse depends on the site's own cookie lifetime; a session cookie does not survive a browser restart, so a later run reports `authentication` | apps/cli/tests/e2e-bot-collection.ts:46 | DEFER — correct behavior (an observed wall fails closed) with `kk bot login` guidance; live session policy stays operator-owned |
| 6 | P4 (advisory) | documentation | No live-site (xhs/Taobao/goofish) evidence exists for this substrate | docs/04_DESIGN.md:1297 | DEFER — explicitly out of scope; acceptance is loopback-only and the docs say so |

#### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | packages/publish-harness/src/bot-collection.ts:388 |
| R2 | MET | packages/publish-harness/src/bot-collection.ts:633 |
| R3 | MET | packages/publish-harness/src/bot-collection.ts:290 |
| R4 | MET | packages/publish-harness/src/bot-collection.ts:345 |
| R5 | MET | packages/kk-core/src/manifest.ts:198 |
| R6 | MET | apps/cli/tests/e2e-bot-collection.ts:464 |

**Acceptance Criteria**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 — one session executes an ordered rendered collection (req: R1) | MET | test | packages/publish-harness/tests/bot-collection.test.ts:388 |
| AC2 — authenticated request and XHR artifacts reach an ingestion consumer (req: R2) | MET | command | `bun apps/cli/tests/e2e-bot-collection.ts` — `kk executor fan-in --source` spawns apps/cli/tests/fixtures/plugins/ingestions/e2e-bot-collection/entry.ts and yields docs `e2e-bot-collection:rendered|item-0|request` in .spur/run/e2e/0346-bot-collection.json |
| AC3 — invalid or wedged runs are bounded and release every owned resource (req: R3) | MET | test | packages/publish-harness/tests/bot-collection.test.ts:725 |
| AC4 — missing data and authentication failures cannot masquerade as a quiet day (req: R4) | MET | test | packages/publish-harness/tests/bot-collection.test.ts:574 |
| AC5 — ingestion descriptors join the existing session boundary without CLI drift (req: R5) | MET | test | packages/kk-core/tests/manifest.test.ts:88 + apps/cli/tests/bot-adapter.test.ts:116 + untouched apps/cli/tests/commands/bot.test.ts:158 |
| AC6 — the E2E and documents leave repeatable implementation evidence (req: R6) | MET | command | `bun run spur-check` exit 0 (format + lint/typecheck + rules + 4748-test suite + coverage/TSDoc) and `.spur/run/e2e/0346-bot-collection.json` `pass: true`, `externalRequests: 0` |

#### Assessment

Functional: every requirement has a shipped anchor; the manifest widening is one refinement and one comment, and `execBot`, the five `kk bot` verbs, their flags and their tests are untouched, so the compatibility control still passes. The E2E now drives the real `kk executor fan-in --source` CLI verb, not the imported handler, so AC2 is proven on the production spawn path.

SECUA: validation precedes every side effect (profile check, lease, launch), so an invalid plan cannot take a lease; only one lease acquisition and one launch exist per call; the `finally` closes the context, drains capture promises and releases the lease on success, failure and timeout, which the failure-path tests assert. Secrets are excluded by construction — artifacts carry origin+pathname only, response headers/`Set-Cookie` are never returned, and diagnostics are static or URL-stripped, so no query, cookie, header or body can reach a message. No new dependency, no `console.*` in `src`, no browser-daemon or proxy surface.

Architecture: the runner is a sibling module reached through a package sub-path, `browser.ts` never imports it, and the plugin child owns the lease for its own run, so fan-in and invoke stayed untouched and concurrent same-profile callers still fail `busy`. Depth sits behind one narrow entry point (`runBotCollection` + data types) instead of a new CLI verb.

Residual risk: live-site behavior, anti-bot outcomes and adapter special state are unproven and stated as limits, and a matched body evicted by a later navigation is intentionally dropped rather than retried.

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
- 2026-11-09T07:47:52.015Z todo → wip (system)
- 2026-11-09T08:59:21.044Z wip → testing (system)
- 2026-11-09T08:59:22.219Z testing → done (system)

