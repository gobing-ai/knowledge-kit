---
kind: design
title: Native workflow visibility modules for Spur Board
status: accepted
created_at: 2026-10-11
updated_at: 2026-10-12
related: [G8, ADR-035]
tags: [board, workflows, observability]
---

# Workflow visibility in Spur Board

## 1. Outcome and scope

Three native modules give the local operator a consistent way to inspect collection,
daily voice production, and IT content authoring. This is an accepted design, not shipped UI.
Feature G8 owns the behavioral contract; ADR-035 owns the boundary decision.

| Module ID | Sidebar name | Workflow definition | Kind |
|---|---|---|---|
| kk-collect | Collect | plugins/kk/workflows/kk-collect.yaml | state-machine |
| kk-daily-ai-voice2 | Daily AI Voice | plugins/kk/workflows/kk-daily-ai-voice2.yaml | dag |
| kk-itc | IT Content | plugins/kk/workflows/kk-itc.yaml | state-machine |

Four tabs ship: **Summary**, **Results**, **Execution progress**, **Workflow Config Summary**.
History belongs in the shared run selector; diagnostics stay beside the evidence they qualify.
Do not add empty History, Logs, Analytics, or Settings tabs. No execution or editing controls,
paid generation, publishing, answering pauses, scheduler changes, remote hosting or upstream fork.

## 2. Operator flow

Each module has a header with workflow name, selected run ID, time, status, and refresh control.
The first visit selects the newest recorded run. A saved `?run=<id>&tab=<summary|results|progress|config>`
selects that exact run; unknown or mismatched IDs produce a diagnostic, never silent fallback.
Keep selection stable across polling, new runs, tabs and browser back/forward. The selector uses
Spur keyset pagination (25 rows/page), status filtering and run-ID search within loaded results;
label the search scope rather than claiming a global full-text search. Show local timestamps with
timezone and a UTC detail. The no-run state links to Settings → Workflows for current configuration.

Summary shows execution status and semantic result outcome separately, start/end/elapsed time,
available counts, failed/paused work, result availability and evidence timestamps. A skipped lock,
empty content pool, partial publish and hard failure are distinct outcomes; unknown stays unknown.
A completed engine run is not proof every publishing target succeeded.

| Results | Initial useful content |
|---|---|
| Collect | per-source counts, inserted/updated counts, label counts/confidence/fallback, source degradation, core facts preview, allowlisted JSON/text downloads |
| Daily AI Voice | article/show notes, cover, script, segmented/final audio when present, quality/safety evidence, report, per-channel draft/live/skipped/error results and validated public links |
| IT Content | outline alternatives and selected outline, draft, judge verdict/feedback/revision count, cover/images when enabled, per-channel results, final report |

Results stay usable during partial execution and after failure. Show missing, pending, invalid,
oversized, superseded and unavailable separately. No placeholder success values or invented zeros.
Render Markdown as safe text or a sanitizer-backed existing renderer; never raw HTML. Restrict
external links to HTTP(S), and use safe new-tab attributes. Do not expose raw commands, prompts,
cookies, environment blocks, provider configuration or unsanitized result blobs.

Tabs use labeled keyboard controls, visible focus, a logical heading order, text status alongside
color, and a narrow-viewport layout with bounded local overflow. Preview/download/play controls
identify the artifact. Errors remain within the relevant panel or contribution.

Settings → Workflows (`/board/settings/workflows`) owns the workflow dropdown, current definition
metadata, YAML/copy and static Mermaid graph. Reuse that tab; do not duplicate these controls or
add a current-definition reader endpoint. Workflow Config Summary shows only sanitized recorded
run settings, capture provenance and explicit unknowns, with an “Open Settings → Workflows” link
and the workflow name to select there. The existing tab has no workflow-selection URL contract.
Execution progress remains run-specific; static definition inspection belongs in Settings.

## 3. Ownership and smallest architecture

| Owner | Responsibility |
|---|---|
| apps/board, package @gobing-ai/kk-board | one browser workspace, shared layout/run selection/data hooks and three ESM entries; no createRoot and no private Spur context imports |
| apps/cli/src/board and commands/board.ts | loopback read-only reader, validated projection/asset access, local capture command and lifecycle |
| existing KK preparation paths | bind future run ID to canonical workspace and a sanitized config snapshot before generating outputs |
| Spur Board | sidebar/router, module asset delivery, host React, run history/detail/progress APIs, execution authority |
| scripts/build/package paths | build browser contributions and include them with the CLI distribution |

Build with the existing Bun browser ESM build; add compatible React development/types dependencies
only where required. Externalize react, react/jsx-runtime and react/jsx-dev-runtime; use only
subpaths the installed host manifest advertises. Bundle private dependencies, scope CSS, and avoid
a new bundler or UI framework. Three small entries export `webModule = { apiVersion: 1, component }`
using the type-only `@gobing-ai/spur/board` declaration. Share real repeated UI rather than a generic
plugin framework. No new product plugin kind or database.

Rejected alternatives: iframe-only requires creating a separate dashboard shell with weaker native
integration; static exports require an extra refresh/export process and media copies; upstream
server injection is unsupported by the shipped contribution contract.

## 4. Integration and proposed surface

The installed host was inspected at `/Users/robin/node_modules/@gobing-ai/spur`:
`board/index.d.ts` and `web/board-runtime.json` advertise contributionApiVersion 1, React 19.2.1,
React DOM 19.2.1 and React Router 7.11.0. These are evidence for this planning run, not future fixed
compatibility promises. Validate the actual installation when building/testing. Module declarations
are strict and flat; backend configuration does not belong inside bootstrap.modules. The declaration
is enforced (`.strict()`): a module contributes `id`, `name`, `icon`, optionally
`sidebarLabel`/`description`/`order`, and for `type: react` a `directory` plus `entry` and optional
`styles`. A duplicate id, or one colliding with a reserved host identity, is refused at config load,
and the host derives each module's route as `/modules/<id>`.

Proposed checkout declarations (enable each only after its assets exist):

```yaml
bootstrap:
  modules:
    - id: kk-collect
      name: Collect
      icon: "📥"
      type: react
      directory: apps/board/dist/collect
      entry: index.js
      styles: [index.css]
    - id: kk-daily-ai-voice2
      name: Daily AI Voice
      icon: "🎙️"
      type: react
      directory: apps/board/dist/daily-voice
      entry: index.js
      styles: [index.css]
    - id: kk-itc
      name: IT Content
      icon: "✍️"
      type: react
      directory: apps/board/dist/itc
      entry: index.js
      styles: [index.css]
```

Installed users point directory at their installed package's shipped `dist/board/<entry>` tree;
resolve absolute installation paths during setup and document portability/restart requirements.
Do not rely on the current author's home directory or edit files under node_modules at runtime.

Proposed command: `kk board serve --board-origin <exact-http-loopback-origin> [--port <n>]`.
Bind 127.0.0.1, default port 4340; reject non-loopback origins/invalid ports and fail clearly on
collision. The foreground process stops on termination and has no scheduler or automatic daemon.
Frontend defaults to http://127.0.0.1:4340; a validated `kkApi` query parameter permits the chosen
loopback port and is retained in saved URLs. Never accept non-loopback reader URLs. Validate reader
project identity against the currently selected Board project before accepting data; same-named
workflows in another project cannot match. Obtain Board project identity from same-origin `GET /api/project` (`{ name, path }`); compare
its canonical path to the reader project identity. The installed setup proof must validate this response.
If identity cannot be established, stop artifact reads with a useful diagnostic, keep Spur tabs.

Reader GET endpoints (schemaVersion 1):
- `/api/health`: local project identity and reader protocol version.
- `/api/workflows/<name>/runs/<run-id>/results`: run identity, evidence availability, normalized
  domain summary, artifact descriptors and diagnostics.
- `/api/workflows/<name>/runs/<run-id>/config`: captured allowed values, provenance, capture time,
  definition digest when actually captured, and explicit unavailable fields.
- `/api/workflows/<name>/runs/<run-id>/artifacts/<opaque-id>`: allowlisted content/media/download.

The reader supports GET/HEAD and the necessary OPTIONS; no mutating HTTP routes or shell command
execution. Restrict Origin to the supplied exact Board origin; check Host/loopback, reject DNS
rebinding, and never wildcard CORS. No cookie credentials. Media requests must use CORS mode.
Return only projected allowed fields. Query IDs/opaque artifact IDs never become arbitrary paths.
Canonical containment and symlink checks apply on each read, including user-supplied ITC workspaces
outside the project only when a trusted capture record bound that exact directory. Do not allow
roots such as `/` or a home/config tree. Prevent read/owner-check races from leaking a successor run.
Text/JSON previews cap at 1 MiB, with explicit truncation or invalid-state diagnostics; use streaming
and byte-range responses for audio, with MIME types and attachment names. Serve only allowlisted
image/audio/text types; no arbitrary HTML/SVG/script delivery. Reading never migrates or writes the
KK store. Use collect artifacts first; store DAO values may supplement only when run-bound and
opened through a genuinely read-only path.

Browser uses same-origin supported Spur routes:
`GET /api/runs?workflow=<name>&limit=25&cursor=...`, `/api/runs/<id>`, and
`/api/runs/<id>/progress`. The list route also accepts `status` and `since`, and
`/api/runs/by-wbs/<wbs>` resolves a run from a task WBS; a malformed cursor or `since` answers 400
with a named code rather than an empty page. Settings already consumes `GET /api/project/workflows` for definitions;
reuse its UI rather than rebuilding that catalog. Validate payloads, selection and workflow binding. No private React
contexts, raw SQLite reads, CLI spawns on each browser refresh, or raw trace payload exposure.

#### API/library claim sources and confidence

| Claim (used by) | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| The contribution ABI is `apiVersion: 1`, the entry exports `webModule`, and the component renders inside the host's own React tree without `createRoot` (R1, R14) | `@gobing-ai/spur` declaration-only export `./board` (`board/index.d.ts`), listed in the installed `package.json` `exports` | Read `node_modules/@gobing-ai/spur/board/index.d.ts:21,24,27,38` in the installed 0.4.2: `readonly apiVersion: 1`, `component: ComponentType`, `mounted … must not call createRoot`, `export declare const webModule` | HIGH |
| The host advertises the facade specifiers `react`, `react/jsx-runtime`, `react/jsx-dev-runtime` (plus `react-dom`, `react-dom/client`, `react-router`, `react-router/dom`) at React 19.2.1, ReactDOM 19.2.1, React Router 7.11.0 (R14, section 3 build) | Installed `web/board-runtime.json` (`manifestVersion` 1, `contributionApiVersion` 1, `imports`) | Read `node_modules/@gobing-ai/spur/web/board-runtime.json:4-11`; all seven `web/_astro/board-facade-*.js` files the manifest names exist on disk (7/7) | HIGH |
| `bootstrap.modules` is the supported declaration surface: a discriminated `react`\|`iframe` union, `.strict()`, `id` matching `^[a-z][a-z0-9-]*$`, `name`, `icon`, optional `sidebarLabel`/`description`/`order`, and `type: react` requiring `directory` + `entry` with optional `styles` (R1, section 4) | Installed runtime config schema: `bootstrapSectionSchema` and `boardModuleDeclarationSchema` in the shipped bundle | Read the emitted zod shapes in installed `spur.js` (search `boardModuleDeclarationSchema =`); the shipped `schemas/spur-config.schema.json` `bootstrap` block lists only logging/telemetry/database/scheduler, so declaration validation is runtime-only, not schema-level | HIGH |
| A declared module's route is `/modules/<id>`; a duplicate id or one colliding with a reserved host identity is refused at config load (R1, R14) | Installed `BOARD_MODULE_ROUTE_PREFIX = "/modules/"` with `validateBoardModuleDeclarations`, and `reservedModules` in `web/board-runtime.json` | Read both in installed `@gobing-ai/spur` 0.4.2; `kk-collect`, `kk-daily-ai-voice2` and `kk-itc` match the id pattern and collide with no reserved id (`observability, history, plans, designs, features, tasks, projects, settings`) | HIGH |
| Settings → Workflows is the real route `/board/settings/workflows`, its tab set is `general`\|`agents`\|`workflows`, and its definition view already renders `rawYaml` plus a Mermaid diagram (R9, R15) | Installed Board web bundle `web/_astro/BoardApp.*.js` (`selectTab` composing `/board/settings/${id}`; the tab array) | Read the route composition and tab array; the `/project/workflows` payload carries `rawYaml` + `mermaidDiagram` | HIGH |
| The runs API is `/api/runs` accepting `workflow, limit, cursor, status, since`, plus `/api/runs/:runId`, `/api/runs/:runId/progress` and `/api/runs/by-wbs/:wbs`; `/api/project` answers `{name, path}` (R2, R3, R7, R12) | Installed `spur.js` route registrations | Read the four `app.get` handlers; `/api/project` returns `{ name: basename(cwd), path: normalizeProjectPath(cwd) }`; `RunStoreBadCursorError` and a malformed `since` answer 400 with named codes | HIGH |
| `/api/runs/:runId/progress` answers 404 `RUN_NOT_FOUND` instead of a diagnostics payload as soon as the projection carries an `orphan-row` diagnostic, so a DAG run can lose its entire progress projection and the R8 fallback must read `/api/runs/:runId` action rows (R8) | Installed `spur.js` progress handler guard | Read the guard (`projection.diagnostics.some(d => d.code === "orphan-row")` → 404 with `code: "RUN_NOT_FOUND"`); the run-detail route has no equivalent guard — this corrects section 6's "returned … orphan-action-row diagnostics for DAG actions" | HIGH |
| Module assets are served from the installed package's `web/` tree, so `directory` must resolve inside the installed package rather than a source checkout (R14, section 8) | Installed `package.json` `files` (`board`, `web`, `schemas`, `plugins`) plus the manifest asset URLs | `files` includes `board` and `web`; every facade path under `web/_astro/` resolves | MEDIUM — the serving path from an installed (packed) install is inferred from `files` + the manifest URLs, not exercised here; task 0255 exercises it |

## 5. Run provenance and config truth

Future runs capture a small immutable record under `.works/.board/runs/<run-id>.json` and an atomic
workspace ownership marker before output generation. Record schemaVersion, project identity,
workflow/run ID, canonical workspace, timestamp, allowed effective params and definition snapshot
or digest only when captured from the executed definition. Capture through a KK-owned helper/
`kk board capture` command, with explicit allowlisted values supplied by workflow preparation;
never infer launch overrides from today's YAML. Add declared __runId to ITC if required and preserve
all existing preparation guards. Capture must not initiate content work and must not make normal
CLI-only workflow operation depend on the reader being alive. Revoke old ownership before result overwrites; inability to persist revocation stops preparation
before those writes. After successful revocation, a capture error warns and disables Board
artifact access without aborting production. A new owner cannot claim pre-existing outputs until
the selected run records success of their producer (section 9). Files contain no credentials/raw prompts; keep `.works` ignored.

The capture does not claim archived content: when another run claims the same workspace, older
run results become superseded/unavailable. Keep their captured config and Spur execution history.
No audio copying or new archive database. Legacy runs may expose metadata and already trustworthy
recorded artifact references; do not derive ownership solely from latest anchors, date folders or
mtimes. When ownership cannot be proven, offer no content preview/download and explain why.

Keep current definitions/defaults in Settings → Workflows. Show captured run values and only
actually captured scheduler overrides in the module, labeled by their recorded source. Group source/window/limit, content/QC, voice/cover and publishing settings by workflow.
Allowlist safe keys and redact sensitive values at the reader boundary regardless of key spelling;
raw shell commands and arbitrary vars never enter the response. Missing historical config stays
unknown; current values do not substitute for it. A comparison, when supported by recorded
digests and the existing catalog, labels drift without copying the definition viewer. New captures provide exact safe values; no retroactive reconstruction.

## 6. Execution progress and refresh

For state machines, consume Spur's shared progress projection: visits, per-action attempts,
timings/provenance, transitions, pending/skipped/failed states and recorded diagnostics. Derive
operator-wait labels only from recorded pause/definition evidence. No answer or resume action.

Daily voice is a DAG. The installed 0.4.2 exposes a state-oriented progress projection, and its
progress route answers 404 `RUN_NOT_FOUND` rather than a diagnostics payload as soon as that
projection carries an `orphan-row` diagnostic — a DAG run can therefore lose the whole projection.
Use a deterministic DAG regression fixture to
preserve that observed limitation. For this incomplete projection, use the supported run-detail action rows for executed-node status/attempts and a
captured DAG definition for run dependency edges; when absent, link to the existing Settings
static graph and mark historical dependencies unavailable. Never interpret a missing action row as definitely skipped; show unknown unless recorded
run evidence establishes pending/skipped. Preserve retry siblings, parallel branches and partial
channels. For nested safety work, link only an explicitly recorded child run ID; otherwise show
child linkage unavailable. This requires no upstream Spur modification.

Poll selected active run every 5 seconds and run history every 30 seconds while visible; stop on
unmount/hidden document, abort obsolete selection requests, and prevent overlaps. On terminal runs
fetch once and use manual refresh. Record per-source last-success time; on outage retain and label
stale data, then retry with capped 30-second backoff. Reader outage affects result/config panels,
not Spur run history/progress. A new run does not steal selection. No invented ETA or completion
percentage for conditional/looping work.

## 7. Workflow discovery compatibility

`plugins/kk/workflows/` is the canonical directory for repository-owned YAML, including
`feature-verification.yaml`. `.spur/workflows -> ../plugins/kk/workflows` preserves legacy paths
and exposes the directory through Spur project discovery. Existing shared discovery paths remain. Remove the redundant registered `plugins/kk/workflows` path now that the
project layer aliases it, so the CLI does not list definitions twice. Do not create physical copies. Verify the Settings catalog endpoint contains each
of the three target workflows once and validates the legacy feature-verification path.

## 8. Delivery and verification

Deliver four dependency-ordered slices: Collect plus the common native/reader/provenance foundation;
Daily AI Voice; IT Content; installed-package and cross-workflow acceptance hardening. Estimate
12 + 8 + 6 + 4 hours, reassess after the first installed native/reader proof. Every slice owns its
fixtures and source/config documentation; the final slice cannot substitute for their tests.

Use deterministic fixtures rather than real collection, LLM/image/audio generation or publishing.
Cover no runs, active, paused, failed, skipped, partial targets, retries, malformed/missing output,
legacy provenance, same-folder reruns, hostile paths/symlinks/origins, stale refresh, config secrets,
DAG unknown statuses and broken contributions. Browser proof uses the actual installed Board, all
three native entries, shared React hooks, deep links, media ranges, keyboard/narrow screen and
built-in navigation after a module fails. A separately packed install must resolve the browser
assets and reader without source checkout or sibling Spur sources. Verify build and package file
lists and keep contribution declarations disabled until their build assets exist.

Required execution gates: targeted tests plus repository lint, unit suite, workspace build and
rule presets; do not edit GitHub workflows. Planning ends with validated tasks; no feature is
implemented or marked shipped by this document.

## 9. Implement-ready contract (2026-10-11 audit)

This section freezes the cross-task seam for 0252 → 0253/0254 → 0255. The earlier sections describe
behavior; the concrete names and precedence below govern implementation. These APIs are proposed,
not shipped. No changes to the installed Spur package or sibling Spur checkout are part of G8.

### Files, build and public commands

0252 owns `apps/board/src/shared/`, `apps/board/src/collect/index.tsx`,
`apps/board/src/contracts.ts`, `apps/cli/src/board/{capture,reader,collect}.ts`, `apps/cli/src/commands/board.ts`,
`scripts/build-board.ts`, and common tests. 0253 owns the daily-voice entry/projection; 0254 owns
the itc entry/projection. Both consume the shared types and capture function; they do not clone
servers, polling, selectors or configuration viewers. Registration is through
`apps/cli/src/cli.ts:createProgram`.

Browser workspace `@gobing-ai/kk-board` uses DOM/DOM.Iterable libraries, `jsx: react-jsx`, the
existing TypeScript base and a typecheck script. `scripts/build-board.ts` uses Bun.build to emit
the existing entry sources as standalone browser ESM directories (`collect` in 0252, then
`daily-voice`/`itc` in 0253/0254), each with `index.js`
and `index.css`, under both `apps/board/dist` and `apps/cli/dist/board`. Bundle no React runtime;
externalize the three React facade imports listed in section 3. Pin React development dependencies
to the inspected 19.2.1 host and compatible React 19 types when implementing. The root build and
CLI `build:bundle`/prepack each invoke this script after the CLI/workspace builds, before packaging;
plugin staging alone does not build browser contributions. Do not register a future module until
its entry exists. Installed assets resolve from KK's own package directory, never sibling sources.

Commands:
- `kk board serve --board-origin <origin> [--port <integer>]` as section 4.
- `kk board capture --workflow <name> --run <id> --work-dir <directory> --stamp <stamp>
  [--definition-digest <sha256:digest>] [--setting <key=value>]...`.

RunCaptureInput is `{workflow, runId, workDir, stamp, settings, definitionDigest?}`; settings are
a validated string map. Project path and capture time are computed locally, never supplied by the browser.
Capture is local preparation, not an HTTP mutation. Validate name against the three fixed workflows;
run IDs are single safe path segments; stamps accept only alphanumeric, dash, underscore and T/Z.
Settings arrive as repeatable strings and are parsed/validated against each workflow's allowlist;
Collect captures `limit` and `horizon_hours` as nonnegative integers. Daily captures `window`
(duration), `language` (en/zh/ja), `vdriver` (voicebox/ominivoice/gemini/voxcpm), boolean keys
`skip_review,transcode_mp3,cover_enabled,xhs_enabled,xhs_live,wechat_enabled,wechat_live,
plan_translate_enabled,article_write_enabled,script_write_enabled,publish_enabled`, and numeric
keys `xhs_cards,plan_max_items,safety_max_revise,qc_min_quality,qc_min_importance,qc_min_urgency,
qc_min_impact,qc_min_episode_items,episode_min_minutes,episode_max_minutes` (finite nonnegative
values; integer counts). ITC captures booleans `research,judge,auto,unslop,force,publish_live,
cover_enabled,inline_images`, integer `max_revisions`, and `source_locale` (en/zh/ja).
Other keys, including free-text topics/titles, provider/model blocks, profile identifiers,
publish target strings, prompts, file paths and unknown future keys, are unavailable/redacted;
never stringify them into API diagnostics. Settings still owns current definition inspection.
never shell-interpolate raw JSON, prompts or arbitrary free text. The callable common preparation
seam is `captureRun(input: RunCaptureInput)`. The CLI delegates to it. Direct daily/stage callers
without run identity keep their current CLI behavior and do not invent captures.

### Data contracts and reader authority

`apps/board/src/contracts.ts` owns `WorkflowName`, `RunCaptureInput`, `RunCapture`, `BoardHealth`, `RunConfig`,
`RunResults`, `ArtifactDescriptor`, `BoardDiagnostic` and `Availability` (exported type-only
as `@gobing-ai/kk-board/contracts`; the CLI declares this workspace as a development dependency
and imports types through that export, never a deep sibling path). `Availability` is `available | pending | missing | invalid | oversized |
superseded | unverified`; no fabricated empty values. JSON response `schemaVersion` is 1.

`RunCapture` contains `schemaVersion`, `projectPath`, `workflow`, `runId`, `workspacePath`,
`stamp`, `capturedAt`, `settings` (validated string values), and optional `definitionDigest` and
`topology: { nodes: string[], edges: { from: string, to: string }[] }`. No raw definition text,
commands, prompts or environment. Immutable file: `.works/.board/runs/<id>.json`.
Workspace marker: `.kk-board-owner.json` with `{schemaVersion:1, projectPath, workflow, runId}`.
Use atomic writes; existing identical captures are idempotent, conflicting identities are refused.

`BoardHealth` is `{schemaVersion, projectPath}`. `RunConfig` is
`{schemaVersion, workflow, runId, capturedAt, settings, unavailableKeys, definitionDigest?, diagnostics}`;
nullable capture time and empty settings explicitly mean uncaptured, not current defaults.
`RunResults` is `{schemaVersion, workflow, runId, availability, summary, artifacts, diagnostics}`.
`summary` uses workflow-specific typed projections (counts/outcome/targets) implemented by its
owning task. `ArtifactDescriptor` has `id`, `label`, `kind` (text/json/image/audio), `availability`,
`producerNode`, optional `producerActionKey` for a state action, and optional `mime`/`bytes`; its id resolves only through the fixed workflow manifest,
not a path supplied by the client. `BoardDiagnostic` is `{code,message}` with bounded safe text.
Bad identity/query inputs return 400, forbidden origin/paths 403, unknown capture/artifact 404,
malformed stored evidence 422, unsatisfiable audio ranges 416, and unavailable Board authority 503.
Unavailable individual evidence is a normal 200 projection with diagnostics; never leak raw errors.

The reader fetches project/run detail/progress from the configured exact loopback Board origin;
it does not shell out or query SQLite. Use section 4's public routes. Authorize project path and
`detail.run.workflowName`/`detail.run.id` before reads. Browser validation is additional, not the
reader's only identity check. Frozen installed list shape:
`{runs:[{id,workflowName,status,mode,agent,startedAt,completedAt}],count,nextCursor,hasMore}`.
Detail shape is `{run,phases,transitions,actions}`; action identity is `id`, node is `node`, and
recorded evidence includes `status`, `ok`, `startedAt`, `completedAt`, `durationMs`, `resultSummary`.
Retain separate action IDs as attempts; do not promise an attempt counter absent from this API.

Use artifacts only; no optional store/DAO reader in this delivery. Collect `store-result.json`
provides inserted/updated/unchanged; `label-result.txt` provides aggregate labeled/model/fallback
and verdict/confidence, not a per-label histogram. Source counts may be derived from the captured
blended Doc[] using the existing source-count rule. Missing per-label/source failure detail is
explicitly unavailable unless the run's recorded producer output actually provides it.

### Capture timing, ownership and execution topology

Declare `__definitionDigest` on the three workflows; ITC also declares the currently absent
`__runId`. Use engine-injected values, not a date-derived run ID. At capture time only, use the
public `spur workflow list --json` catalog to compare the injected digest with the named definition;
read and sanitize topology only on exact digest agreement, otherwise omit it with a diagnostic.
No digest reimplementation and no current-definition endpoint. Missing topology links to the
existing Settings static graph and leaves historical dependencies unknown.

Collect capture is inside the successful lock-holder path after `lock acquire` and before
collection output; a skipped lock contender must never claim/revoke the holder's workspace. Keep
lock release/failure paths intact. Ignore mutable preparation source configs as result artifacts.
Daily capture is in `daily.ts:prepareAction` after the directory is resolved and before result
mutation, with run/digest/settings forwarded from the existing prepare node. The default directory
may be outside the repo under the configured works root: accept only its explicitly captured
canonical child workspace, never the home/config root itself. Voice1 callers pass no Board flags
and keep their current behavior. ITC performs its existing XOR/force validation and captures only
after successful preparation before authoring; do not change solo-podcast behavior through their
shared preparation helper. Preparation counters/briefs are not Board result artifacts. Derive displayed revision counts
from recorded revise/auto-revise visits, never mutable counter files that a new prepare may reset.

Invalidate the old marker before result writes. After invalidation, optional capture failure may
warn and continue with previews disabled. If revocation fails, refuse result mutation. During each
read, verify marker identity before opening and after bounded reads; use no-follow file opens,
canonical containment and an open descriptor, then discard on owner/identity change. Range responses
must enforce the same checks per bounded chunk; never serve an unchecked entire-file stream.

Each workflow's artifact manifest maps fixed relative patterns to producer node/state IDs. A file
is unavailable/pending until that selected run has a successful recorded producer attempt; the
new marker alone cannot make previous-run files valid. Cache hits count only when the current run's
producer records success, and are labeled reused when recorded. For state machines use the
public progress actionKey/attempt evidence rather than another successful shell in the same state:
Collect blended docs use `collect:onEnter:0`, facts use `collect:onEnter:1`, store counts use
`store:onEnter:0` and label counts use `label:onEnter:0`. Accept only non-estimated recorded attempts
bound to the captured definition; mismatch is unverified. This preserves completed ingestion
when a later facts action fails. DAG artifacts use their distinct producer node IDs from the
captured topology and the public action rows. Missing/failed producer evidence
never authorizes stale content. Same-run parallel branches can expose their independently finished
outputs. On terminal runs, reread evidence once to pick up final committed artifacts.

### Claim discipline (all four tasks)

Every API/library claim this sequence adds — the installed Board contract, the Bun build and
packaging behaviour, the Playwright pin — goes into a cited `#### API/library claim sources and
confidence` block in the document that asserts it, in the repo's 4-column row form. Presence is a
task deliverable here because the repo rule `api-library-claim-cites-source-and-confidence` judges
only blocks that already exist: it refuses a row whose confidence falls outside `HIGH|MEDIUM|LOW`,
or whose level is unearned (a `HIGH` with no URL, `path:line` or repo path; a `MEDIUM`/`LOW` that
neither cites nor names its gap). A claim is recorded where it is made, not retro-fitted at review.

### Test ownership and handoff

0252: `apps/cli/tests/board/{capture,reader,collect}.test.ts`,
`apps/board/tests/{run-selection,refresh,collect}.test.ts`,
`scripts/tests/board-package.test.ts`. Real temporary files and real Bun HTTP servers observe the
reader/capture boundary; hostile symlinks, ownership changes, new owner with stale files, revoked
capture failures and lock contenders must be tested without mocking the behavior under test.
Browser selection/polling tests use supported HTTP fixtures and the installed Board.

0253: `apps/cli/tests/board/daily-voice.test.ts`, `apps/board/tests/daily-voice.test.ts`,
plus existing `apps/cli/tests/voice2-dag.test.ts` and `commands/daily.test.ts` regressions. Fixtures
include failed primary + successful retry siblings, no-content, partial channels, nested safety
with/without recorded child identity, current-only topology and historical unknowns. Names of
future section-audio files are discovered from recorded allowlisted output descriptors; no assumed
implementation of ADR-034 is required to show today's final audio.

0254: `apps/cli/tests/board/itc.test.ts`, `apps/board/tests/itc.test.ts`, plus
`apps/cli/tests/kk-itc-workflow.test.ts` and `stage.test.ts` regressions. Real preparations cover
external allowed child workspaces, XOR/force refusal, revision counters, optional illustrations,
judge feedback and per-target results. 0252's containment and capture policies are consumed intact.

0255: `apps/board/tests/installed-board.test.ts` and `scripts/tests/board-package.test.ts` are
executable Playwright/Bun integration checks, using available Playwright tooling rather than a new
browser framework; declare `playwright: catalog:` as a browser-workspace development dependency
using the existing 1.55.0 catalog. The integration test setup requires its Chromium binary and
reports a missing runtime as a failed setup, never a silent skip. Build then pack/install a temporary KK package with no checkout imports. Drive
all three native routes and Settings Workflows, deep links/back navigation, keyboard/narrow view,
reader outage, ranges and broken contribution isolation. Keep synthetic fixtures and named test
files durable. The earlier workflow relocation is already complete; this task verifies it rather
than moving/copying files again. Passing integration produces evidence/docs; source edits are only
required for demonstrated defects, not to manufacture a production diff.
