---
schema_version: 1
name: Migrate KK Board modules to Spur native /api/modules/:id/* backend and retire kk board serve
status: todo
template: feature-impl
created_at: 2026-11-26T18:16:34.458Z
updated_at: "2026-11-26T18:46:53.152Z"

priority: P1
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 6
---

## 0447. Migrate KK Board modules to Spur native /api/modules/:id/* backend and retire kk board serve

### Background

Under ADR-035, `knowledge-kit`'s three native Spur Board modules (`kk-collect`, `kk-daily-ai-voice2`, `kk-itc`) load static frontend bundles from `spur self serve` (`/modules/<id>/*`) while sending all KK-domain API requests (`GET /api/days`, `POST /api/actions/*`, `GET /api/workflows/kk-collect/store/*`, run config/evidence/results/artifacts) to a separate loopback reader (`kk board serve` on `127.0.0.1:4340`).

That two-server split requires an extra background process (`kk board serve --board-origin ...`), duplicates origin/CORS checks, breaks over remote HTTPS gateway access (`https://spur.robinmin.net/knowledge-kit/board/modules/...` cannot call `http://127.0.0.1:4340`), and surfaces `"The reader is not answering"` whenever the second server is not running.

Once Spur ships native module backend handlers (`spur-new` task `1455`: optional `bootstrap.modules[].api` mounted at `/api/modules/:id/*` and proxied by the gateway at `/<project>/api/modules/:id/*`), `knowledge-kit` can bundle its reader logic as a pure Web-Fetch ESM handler (`apps/cli/dist/board/api.js`) and retire `kk board serve`.

**Refine corrections (2026-11-26)**
- Audited all callers across `apps/cli/src/board/reader.ts`, `apps/cli/src/commands/board.ts`, `apps/board/src/shared/api.ts`, `apps/board/src/{collect,daily-voice,itc}/index.tsx`, `apps/board/src/shared/run-selection.ts`, `apps/board/scripts/verify-collect-live.ts`, `scripts/build-board.ts`, and `apps/cli/tests/board/*` + `apps/board/tests/*`.
- Found `boardGet(path)` in `apps/cli/src/board/reader.ts:251-259` calls back to Spur's own `/api/project` and `/api/runs/*` endpoints using `boardOrigin`. Inside Spur's `/api/modules/:id/*` handler, the local Spur server origin comes directly from `new URL(request.url).origin` (always `http://127.0.0.1:<port>` even behind the gateway), eliminating `--board-origin` completely.
- Found `scripts/build-board.ts` only builds `target: 'browser'` bundles today; `apps/cli/dist/board/api.js` requires a `target: 'bun'` ESM build (since `reader.ts` imports `bun:sqlite` via `@gobing-ai/kk-store` and `node:fs`/`node:path`).
- Found gateway prefix handling: browser URLs must derive `boardBasePath` (prefix before `/board/` in `window.location.pathname`) so `<origin><boardBasePath>/api/modules/<id>/...` works both on direct `spur self serve` (`/board/...`) and behind the gateway (`/<project>/board/...`).
- Found `apps/board/src/collect/index.tsx:148-151` had a split `reader` vs `aggregateReader` (`DEFAULT_READER_ORIGIN`) workaround; both collapse into the single same-origin `/api/modules/kk-collect` client.
- Verified `apps/cli/tests/board/{reader,reader-days,daily-voice,itc}.test.ts` all instantiate `createBoardReader({ boardOrigin, port: 0, projectPath })`; exporting a pure `createBoardHandler` factory lets those 4 suites test the handler in-process without TCP sockets.

### Requirements

- [ ] R1. Prerequisite gate: verify installed `@gobing-ai/spur` ships `bootstrap.modules[].api` and `/api/modules/:id/*` (`spur-new` task `1455`) before cutting over.
- [ ] R2. Refactor `apps/cli/src/board/reader.ts` from a standalone `Bun.serve()` HTTP server into a pure Web-Fetch handler (`createBoardHandler` + default export `{ fetch(request, ctx) }` conforming to `BoardModuleApiHandler`), preserving every existing domain route (`/api/health`, `/api/days`, `/api/days/:day`, `/api/actions/:kind`, `/api/workflows/kk-collect/store/*`, `/api/workflows/:wf/runs/:id/{config,evidence,results,artifacts/:aid}`) and deriving `boardGet`'s Spur loopback origin from `new URL(request.url).origin` (with injectable `boardOrigin`/`fetchImpl` for tests).
- [ ] R3. Extend `scripts/build-board.ts` to emit the Bun-targeted ESM backend bundle `apps/cli/dist/board/api.js` (and `apps/board/dist/api.js`, `target: 'bun'`, `format: 'esm'`) alongside the three browser bundles, and configure `api: apps/cli/dist/board/api.js` on all three modules (`kk-collect`, `kk-daily-ai-voice2`, `kk-itc`) in `.spur/config.yaml`.
- [ ] R4. Update `apps/board/src/shared/api.ts` and the three module entrypoints (`apps/board/src/{collect,daily-voice,itc}/index.tsx`) to call same-origin `<origin><boardBasePath>/api/modules/<id>/...` (supporting both direct `/board/...` and gateway `/<project>/board/...` paths); remove `DEFAULT_READER_ORIGIN`, `readerOriginFrom`, `kkApi` query-param handling, `aggregateReaderOrigin`, CORS/Origin boilerplate in `reader.ts`, and the `"The reader is not answering. Start it with kk board serve..."` offline prompt.
- [ ] R5. Retire the `kk board serve` subcommand from `apps/cli/src/commands/board.ts` (and `DEFAULT_BOARD_PORT`), keeping `kk board capture` intact until Spur native run metadata supersedes it; update `apps/cli/tests/main.test.ts` and `apps/cli/tests/commands/board.test.ts`.
- [ ] R6. Update unit and E2E suites (`apps/cli/tests/board/*.test.ts`, `apps/board/tests/shared/api.test.ts`, `apps/board/tests/shared/run-selection.test.ts`, `apps/board/tests/installed-board.test.ts`, `apps/board/scripts/verify-collect-live.ts`) to run directly through `createBoardHandler` / `spur self serve` with no `kk board serve` process, and update `docs/00_ADR.md` (ADR-035 amendment), `docs/03_ARCHITECTURE.md`, and `docs/04_DESIGN.md` in the same commit.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Prerequisite Spur contract is verified before cutover (req: R1)
  Given the installed `@gobing-ai/spur` package in `node_modules/@gobing-ai/spur`
  When `spur-config.schema.json` and `board/index.d.ts` are checked
  Then `bootstrap.modules` (`type: react`) accepts `api` and `@gobing-ai/spur/board` exports `BoardModuleApiHandler`.

Scenario: AC2 — Pure Web-Fetch handler serves all KK Board routes without `Bun.serve` (req: R2)
  Given `createBoardHandler({ projectPath, boardOrigin, fs, fetchImpl })` and the default `{ fetch(req, ctx) }` export
  When requests are dispatched for `/api/health`, `/api/days`, `/api/days/<YYYYMMDD>`, `/api/actions/<kind>`, `/api/workflows/kk-collect/store/*`, and run evidence/config/results/artifacts
  Then each route returns the same status and contract payload as before, with `boardGet` resolving Spur's loopback origin from `new URL(request.url).origin` when `boardOrigin` is not overridden.

Scenario: AC3 — Build script emits `api.js` and `.spur/config.yaml` wires all three modules (req: R3)
  Given `bun scripts/build-board.ts` runs
  Then `apps/cli/dist/board/api.js` and `apps/board/dist/api.js` are emitted as Bun-targeted ESM bundles
  And `.spur/config.yaml` declares `api: apps/cli/dist/board/api.js` on `kk-collect`, `kk-daily-ai-voice2`, and `kk-itc` and passes Spur config validation.

Scenario: AC4 — Browser modules use same-origin `/api/modules/<id>/*` on both direct and gateway URLs (req: R4)
  Given `createBoardClient` in `apps/board/src/shared/api.ts`
  When invoked from `/board/modules/kk-daily-ai-voice2` or `/knowledge-kit/board/modules/kk-daily-ai-voice2`
  Then API requests target `/api/modules/kk-daily-ai-voice2/...` and `/knowledge-kit/api/modules/kk-daily-ai-voice2/...` respectively
  And `DEFAULT_READER_ORIGIN`, `readerOriginFrom`, `kkApi`, and `aggregateReaderOrigin` are removed from production code.

Scenario: AC5 — `kk board serve` is retired while `kk board capture` remains functional (req: R5)
  Given the built `kk` CLI
  When `kk board --help` is inspected
  Then `capture` is listed and `serve` is absent
  And `kk board capture` continues to pass all existing capture tests.

Scenario: AC6 — Installed-board E2E passes with `spur self serve` alone and docs are synced (req: R6)
  Given `apps/board/tests/installed-board.test.ts` and `bun run gate`
  When the test suite runs against `spur self serve` without spawning `kk board serve`
  Then all three modules (`kk-collect`, `kk-daily-ai-voice2`, `kk-itc`) render live data with zero console/page errors
  And `docs/00_ADR.md` (ADR-035 amendment), `docs/03_ARCHITECTURE.md`, and `docs/04_DESIGN.md` document the retired `kk board serve` and native module API boundary.
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Chosen approach**

Replace the standalone `kk board serve` loopback server (`127.0.0.1:4340`) with a single Bun-targeted ESM Web-Fetch handler (`apps/cli/dist/board/api.js`) mounted by `spur self serve` at `/api/modules/:id/*` (shipped by `spur-new` task `1455`).

**Key invariants & tradeoffs**

1. **Pure handler factory (`apps/cli/src/board/reader.ts`):**
   - Extract `createBoardHandler(options)` returning `{ fetch(request: Request): Promise<Response> }` and export a default `BoardModuleApiHandler` (`{ fetch(request, ctx) }`) that caches a handler per `ctx.projectPath`.
   - Drop `Bun.serve()`, `DEFAULT_BOARD_PORT`, `isLoopbackOrigin`, CORS preflight headers, and Host/Origin checks — `spur self serve`'s `mountMiddleware` (host guard + CSRF) and gateway proxy own transport security.
   - `boardGet(path)` resolves Spur's own `/api/project` and `/api/runs/*` against `options.boardOrigin ?? new URL(request.url).origin`, which is always the local `spur self serve` loopback origin even when the browser came through the gateway (`https://spur.robinmin.net/knowledge-kit/...`).
   - Keep `POST /api/actions/<kind>`'s application-level guards (`board.actions.enabled`, preview token, typed confirmation for live publish, store single-flight lock, audit log).
2. **Build output (`scripts/build-board.ts`):**
   - Keep `BOARD_ENTRIES` (`target: 'browser'`, external React + `@gobing-ai/spur/board/ui`) unchanged.
   - Add one Bun-targeted build (`target: 'bun'`, `format: 'esm'`, entry `apps/cli/src/board/api-entry.ts` → `api.js` in `apps/board/dist` and `apps/cli/dist/board`) so `bun:sqlite` and `node:*` imports resolve natively inside `spur self serve`.
3. **Gateway-safe same-origin URLs (`apps/board/src/shared/api.ts`):**
   - Derive `boardBasePath(pathname)`: if `pathname` contains `/board/`, take the prefix before `/board/` (e.g. `""` for `/board/modules/...` or `"/knowledge-kit"` for `/knowledge-kit/board/modules/...`).
   - Module API base becomes `${origin}${basePath}/api/modules/${moduleId}` and Spur Board API base becomes `${origin}${basePath}`.
   - Remove `DEFAULT_READER_ORIGIN`, `readerOriginFrom`, `kkApi`, `aggregateReaderOrigin`, and `isNativeSpur` dual-path branching in Collect.
4. **Why keep `kk board capture` for now:**
   - `kk board capture` is a synchronous CLI write (`.works/.board/runs/<id>.json` + `.kk-board-owner.json`) invoked by workflows (`kk-collect`, `kk daily prepare`, `kk-itc`), not a server. Retiring it requires Spur to store run workspace metadata natively, which is a separate follow-up.

**Impacted surfaces**

- `apps/cli/src/board/reader.ts` + new thin entrypoint `apps/cli/src/board/api-entry.ts`
- `apps/cli/src/commands/board.ts` (retire `serve`; keep `capture`)
- `scripts/build-board.ts` (emit `api.js` alongside browser modules)
- `.spur/config.yaml` (add `api: apps/cli/dist/board/api.js` to all 3 modules)
- `apps/board/src/shared/api.ts`, `apps/board/src/{collect,daily-voice,itc}/index.tsx`, `apps/board/src/shared/run-selection.ts`
- `apps/board/scripts/verify-collect-live.ts`
- Tests: `apps/cli/tests/board/*.test.ts`, `apps/cli/tests/commands/board.test.ts`, `apps/cli/tests/main.test.ts`, `apps/board/tests/shared/{api,run-selection}.test.ts`, `apps/board/tests/installed-board.test.ts`, `scripts/tests/board-package.test.ts`
- Docs: `docs/00_ADR.md` (ADR-035 amendment), `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`

**Out of scope**

- Retiring `kk board capture` (tracked separately if/when Spur adds run-workspace metadata).
- Changing any workflow YAML or `kk news digest` / `projectDay()` domain projections.

### Plan

1. Verify `@gobing-ai/spur` ships `spur-new` task `1455` (`bootstrap.modules[].api` + `/api/modules/:id/*`).
2. Refactor `apps/cli/src/board/reader.ts` to export `createBoardHandler` (pure `fetch(request)`) and add `apps/cli/src/board/api-entry.ts` exporting `BoardModuleApiHandler`; remove `Bun.serve()`, `DEFAULT_BOARD_PORT`, and CORS/Origin boilerplate.
3. Update `scripts/build-board.ts` to emit `api.js` (`target: 'bun'`, `format: 'esm'`) into `apps/board/dist` and `apps/cli/dist/board`, and wire `api: apps/cli/dist/board/api.js` on all 3 modules in `.spur/config.yaml`.
4. Update `apps/board/src/shared/api.ts` and `apps/board/src/{collect,daily-voice,itc}/index.tsx` to use same-origin `<origin><boardBasePath>/api/modules/<id>/...`, removing `DEFAULT_READER_ORIGIN`, `readerOriginFrom`, `kkApi`, `aggregateReaderOrigin`, and the offline `kk board serve` prompt.
5. Remove `kk board serve` from `apps/cli/src/commands/board.ts` and update CLI/board unit tests, `verify-collect-live.ts`, `scripts/tests/board-package.test.ts`, and `apps/board/tests/installed-board.test.ts`.
6. Amend ADR-035 in `docs/00_ADR.md` and update `docs/03_ARCHITECTURE.md` and `docs/04_DESIGN.md`; run `bun run gate` and verify all 90%+ coverage thresholds pass.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Blocking upstream task: `spur-new` WBS `1455` (`Support optional Web-Fetch backend API handlers on native Board modules (/api/modules/:id/*)`)
- Related features: G8 (`Workflow visibility in Spur Board`), G81 (`Collect module redesign`), G83 (`Daily AI Voice Ops Console`)
- Authority docs: `docs/00_ADR.md` (ADR-035), `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`
- Key source files:
  - `apps/cli/src/board/reader.ts`
  - `apps/cli/src/commands/board.ts`
  - `scripts/build-board.ts`
  - `.spur/config.yaml`
  - `apps/board/src/shared/api.ts`
  - `apps/board/src/{collect,daily-voice,itc}/index.tsx`
  - `apps/board/tests/installed-board.test.ts`

### History

- 2026-11-26T18:46:53.152Z backlog → todo (system)

