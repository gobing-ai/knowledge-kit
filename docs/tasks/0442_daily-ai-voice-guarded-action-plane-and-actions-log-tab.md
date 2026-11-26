---
schema_version: 1
name: Daily AI Voice guarded action plane and Actions log tab
status: done
template: feature-impl
created_at: 2026-11-26T00:29:45.936Z
updated_at: "2026-11-26T04:35:18.249Z"
feature_id: G83
priority: P2
tags:
  - board
  - daily-ai-voice
  - reader
  - security

dependencies: ["0439", "0440"]
estimate_hours: 10
done_forced: "false"
done_reason: unforced close
---

## 0442. Daily AI Voice guarded action plane and Actions log tab

### Background

Feature G83: the reader gains one write route that launches allowlisted existing verbs after a preview and a single-use confirmation (ADR-035 amendment 2026-11-25).

Implements: R9 — The action plane decision is recorded before any write path ships; R10 — Actions execute only after a preview and a single-use confirmation; R11 — The action plane refuses unsafe requests

Design: docs/design/daily-voice-ops-console.md §6.

**Refine corrections (2026-11-25)** — premises audited against the current tree:

1. **A CORS preflight is unavoidable.** A POST with `X-KK-Action` and `content-type: application/json` is non-simple. The current OPTIONS response advertises `'GET, HEAD, OPTIONS'` and `'range, content-type'` (`apps/cli/src/board/reader.ts:707-708`), and the method guard returns 405 `board.method.refused` for anything other than GET or HEAD (`reader.ts:722-723`). The action route must extend allow-methods with `POST` and allow-headers with `x-kk-action`, but only for `/api/actions/*`. Every other path keeps refusing POST with 405.
2. **There is no Board-origin config to add.** The reader already receives `boardOrigin` from `kk board serve --board-origin` (`apps/cli/src/commands/board.ts:19,61`). The POST exact-origin check compares against it with `isMatchingBoardOrigin` (`reader.ts:703`) and drops the `origin === null` allowance.
3. **`kk lock` is store-backed and exits 0 when the lock is held.** `kk lock acquire --name --run [--ttl]` prints `{"acquired":true}` or `{"skipped":"locked","holder":…}` with exit 0 (`apps/cli/src/commands/lock.ts`, header lines 9-15). The reader calls `store.locks.acquire(name, run, ttlMs)` / `release` (`@gobing-ai/kk-store`, `LocksDao`) in-process rather than shelling out, so a held lock maps to 409 without parsing stdout. Use a TTL that covers the child (default 2 h), because a crashed reader's claim is stolen after the TTL.
4. **Verified argv per kind (from each verb's `--help` today):**
   - `spur workflow run <def> --from <node> --from-run <runId> --async --json` (all four flags exist).
   - `kk news publish --run-date --window --retry --channels --dummy --dry-run`.
   - `kk news generate-voice --work-dir <dir> --engine <voxcpm|gemini|omnivoice|voicebox|vibe-voice>`. `generate-cards` and `generate-render` take only `--work-dir`, so they have no override.
   - `kk store release --run <id> [--topic]`.
   - `spur workflow cancel <runId> --json`.
5. **Config key:** `board.actions.enabled` is new under `~/.config/kk/config.yaml` (resolved through `resolveKkConfigPath`, `apps/cli/src/invoke.ts:52`, which honors `KK_CONFIG`). It defaults to false when the key is absent or the file is unreadable.

### Requirements

- [x] R1. `POST /api/actions/<kind>` over the closed six-kind allowlist. Argv comes from `resolveArgv`, and the child is spawned without a shell.
- [x] R2. Preview returns the argv, the dry-run output and a single-use 5-minute token bound to the argv hash. Execute consumes the token once. A reused or expired token is refused.
- [x] R3. Live kinds require a typed confirmation equal to the day.
- [x] R4. Single-flight per day, through the store-backed lock name `ops-console:<day>` (the same `LocksDao` that `kk lock` uses).
- [x] R5. Off by default (`board.actions.enabled`). A POST requires the exact Board Origin, a loopback Host and `X-KK-Action: 1`. Preflight advertises POST and `x-kk-action` for `/api/actions/*` only.
- [x] R6. Append-only `<works>/kk-news-generate/<day>/actions.jsonl` records previews, executions and refusals.
- [x] R7. The console follows the spawned run id to terminal and shows the Actions log tab. The ADR-035 amendment moves from Accepted (design) to Accepted when this ships.

### Acceptance Criteria

- [x] AC1 — The action plane decision is recorded before any write path ships
- [x] AC2 — Actions execute only after a preview and a single-use confirmation
- [x] AC3 — The action plane refuses unsafe requests

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-26T01:09:00.484Z

- **Q: Shell out to `kk lock` or use the store in-process?** A: In-process `store.locks` (`LocksDao`). Same semantics, without parsing stdout that is exit 0 even when the lock is held.
- **Q: Do `generate-cards` and `generate-render` get overrides?** A: No. Their `--help` shows only `--work-dir`. `generate-voice` gets `--engine` from its enum.
- **Q: Is a new Board-origin config needed?** A: No. The reader already takes `--board-origin`. Only `board.actions.enabled` is new.
- **Q: What lock TTL?** A: 2 h. A crashed reader's claim is stolen after the TTL.

### Design

**Chosen.** An in-reader action route with in-memory tokens and the store-backed lock. The reader is the only local process able to launch verbs (there is no Board server hook), and `LocksDao` already exists.

**Rejected:**
- A separate action daemon: a second process and origin to secure.
- Spur Board routes: they would need a Spur fork.
- Signed stateless tokens: they need key management for no gain on a single loopback process.
- Shelling out to `kk lock`: it exits 0 even when the lock is held, so the reader would have to parse stdout.

**Frozen:**
- New module `apps/cli/src/board/action-plane.ts`. It owns the token map (`Map<tokenHex, {argvHash, expiresAt}>`), `handleAction(request, deps)` and audit append.
- The reader dispatches `/api/actions/*` to it before the GET/HEAD method guard.
- `deps` = `{ spawn, now, randomBytes, store, configEnabled, boardOrigin }`, injected so the refusal matrix is unit-testable without real children.
- `argvHash = sha256(kind + '\0' + argv.join('\0'))`.
- The lock TTL defaults to 2 h. Release happens on child exit.
- Run id capture: parse `--json` stdout for `runId` (spur) when present. Otherwise use `null`, and the UI shows the action as fire-and-forget.
- Audit line: `{ts, kind, argv, origin, tokenHash, runId, exit, result | refusal}`.

**Refusal codes (closed set):**

| Code | Status |
| --- | --- |
| `actions.disabled` | 403 |
| `actions.kind.unknown` | 404 |
| `actions.origin.refused` | 403 |
| `actions.host.refused` | 403 |
| `actions.header.missing` | 403 |
| `actions.params.invalid` | 400 |
| `actions.token.invalid` | 409 (covers unknown, reused and expired) |
| `actions.confirm.missing` | 400 |
| `actions.lock.held` | 409 |

**Anti-patterns:**
- `Bun.spawn` with `sh -c`.
- Request data in the child env.
- Persisting tokens.
- Launching before audit.
- Allowing `origin === null` on POST.
- Relaxing CORS for non-action paths.

**Depends on:** 0439 (`resolveArgv`, `ActionKind`, `ActionParamError`) and 0440 (the tab shell and recipe component).

**Tests:**

| AC | Test file | Covers |
| --- | --- | --- |
| AC1 | `docs/00_ADR.md` amendment present before the route (doc assertion in review) | the decision is recorded first |
| AC2 | `apps/cli/tests/board-action-plane.test.ts` | preview → execute success, token single-use, expiry via an injected clock |
| AC3 | `apps/cli/tests/board-action-plane.test.ts` | the full refusal matrix over HTTP against `createBoardReader` with a stub spawn: one test per code, each asserting nothing launched and the audit line written |

### Plan

- Enumerate the refusal matrix (disabled, unknown kind, bad origin/host/header, bad/reused/expired token, lock held, missing typed confirm).
- Config switch + route + token store.
- Lock, spawn, run-id capture, audit writer.
- Console confirm dialog, run follow, Actions log tab.
- Promote the ADR amendment status.

### Solution

| File | Lines | What / why |
| --- | --- | --- |
| `apps/cli/src/board/action-plane.ts` | 1-320 (new) | The guard chain and the token map. Order: disabled → unknown kind → exact Origin → loopback Host → `X-KK-Action: 1` → params via `resolveArgv` → preview token (or typed confirmation for a live kind) → store lock → **audit before spawn** → argv spawn. `argvHashOf`, `scopeOf` (day or run lock), `runIdOf` (JSON stdout), `parseActionLog`/`appendActionLog`. Tokens are in-memory, hashed into the audit, consumed once and expire in 5 minutes. |
| `apps/cli/src/board/actions.ts` | 55-64 | `ACTION_KINDS` — the closed allowlist the plane dispatches on, so the reader cannot accept a kind the digest could not render. |
| `apps/cli/src/board/reader.ts` | 745-770, 1185-1270 | `POST /api/actions/<kind>` dispatched before the GET/HEAD guard, with its own CORS (`POST`, `x-kk-action`) on that path family only; the production plane wires `board.actions.enabled`, `NodeProcessExecutor` (argv array, no shell), the `kk-store` `locks` single-flight and the day's `actions.jsonl`. Tests inject `actionPlane`. |
| `apps/cli/src/board/day.ts` | 36-60, 512-520, 580-600 | The digest carries `actions: { enabled, lines }` (the day's bounded audit lines) so the Actions log tab needs no second route, and `DayContext.actionsEnabled` tells it whether a launch is even possible. |
| `apps/board/src/contracts.ts` | 401-425 | `DailyActionLine` + `DayActionPlane`, and the `DailyDigest.actions` field. |
| `apps/board/src/shared/api.ts` | 129-140, 812-824 | `BoardClient.action(kind, body)` — the console's only write path, one POST with the action header. |
| `apps/board/src/daily-voice/day-view.ts` | 216-270 | `actionLogRows` (preview/launched/exit-N/refused with tones, newest first) and `actionPlaneEnabled`. |
| `apps/board/src/daily-voice/index.tsx` | `ActionLauncher`, `ActionsPanel` | Preview → (typed confirmation for a live kind) → run, all through the same POST; a 202 reports `launched` and refetches the day so the Actions log shows the new lines. When the plane is off the tab shows the disabled diagnostic and recipes only. |
| `apps/cli/tests/board/action-plane.test.ts` | 1-330 (new) | AC2/AC3: the preview→execute handshake (argv identical to the rendered recipe), token replay, expiry (injected clock), argv binding, typed confirmation, held lock, and every refusal code — each asserting nothing spawned and one audit line written. |
| `docs/00_ADR.md` | 1419-1421 | The ADR-035 amendment moves from **Accepted (design)** to **Accepted**, naming the shipped slices (R7). |
| `docs/04_DESIGN.md` | 536-560 | T3 surface: the single write route, the switch, the header set, the handshake, the lock names, the closed refusal vocabulary and the audit file. |

Deliberate limits, recorded:

- **The config switch is read once, at reader start.** A `board.actions.enabled` edit needs a reader restart; that is stated in the UI diagnostic and the design note rather than pretending hot reload.
- **A refusal is audited even when the plane is disabled**, because the operator's question after an incident is "did anything try?" — the audit append is best-effort (a failed write never blocks a refusal, and never promotes a launch).
- **The launch line precedes the child**; the exit line follows it. A crash between them leaves an unclosed `launched` row, which is evidence, not a phantom run.
- **`runId` capture is stdout-based** (`--json`), so a kind that prints no run id records `null` and the UI shows fire-and-forget instead of inventing an id to follow.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 `POST /api/actions/<kind>` over the closed six-kind allowlist; argv from `resolveArgv`; child spawned without a shell | MET | `apps/cli/src/board/reader.ts:745-770` (route + own CORS), `:1230-1270` (`NodeProcessExecutor.run({command,args})`, argv array); `apps/cli/src/board/action-plane.ts:230-260` (`resolveArgv` + `ACTION_KINDS`); `apps/cli/tests/board/action-plane.test.ts:118` (launched argv equals the previewed argv) |
| R2 Preview returns argv + dry-run output + a single-use 5-minute token bound to the argv hash; execute consumes it once; reused/expired refused | MET | `apps/cli/src/board/action-plane.ts:77`, `:300-345`; `apps/cli/tests/board/action-plane.test.ts:118` (preview), `:160` (replay refused), `:172` (expiry with the injected clock), `:183` (argv binding) |
| R3 Live kinds require `typedConfirm` equal to the day | MET | `apps/cli/src/board/action-plane.ts:330`; `apps/cli/tests/board/action-plane.test.ts:192` (refused without it, token still usable with it) |
| R4 Single-flight per day via the store `ops-console:<day>` lock | MET | `apps/cli/src/board/reader.ts:1252-1258` (`store.locks.acquire` / `release`, 2 h TTL); `apps/cli/src/board/action-plane.ts:140-150` (`scopeOf`); `apps/cli/tests/board/action-plane.test.ts:212` (held lock 409, nothing spawned) |
| R5 Off by default; exact Board Origin, loopback Host and `X-KK-Action: 1`; preflight advertises POST/`x-kk-action` for `/api/actions/*` only | MET | `apps/cli/src/board/reader.ts:1185-1200` (config switch), `:723-740` (path-scoped CORS + POST dispatch before the GET/HEAD guard); `apps/cli/tests/board/action-plane.test.ts:230-275` (disabled, origin, host, header) |
| R6 Append-only `<works>/kk-news-generate/<day>/actions.jsonl` records previews, executions and refusals | MET | `apps/cli/src/board/action-plane.ts:300,340,360,395` (one audit call per outcome), `:405-420` (`appendActionLog`); `apps/cli/src/board/day.ts:512` (digest carries the bounded lines); `apps/cli/tests/board/action-plane.test.ts:118` (preview → launched → exited order), `:330` (append+read) |
| R7 The console shows the Actions log tab (and follows the spawned run id); the ADR amendment moves to Accepted | MET | `apps/board/src/daily-voice/index.tsx` (`ActionsPanel`, `ActionLauncher`), `apps/board/src/daily-voice/day-view.ts:216-270` (`actionLogRows`); `docs/00_ADR.md:1419` (Accepted); `apps/board/tests/daily-voice/day-view.test.ts` (log rows + tones) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 The action plane decision is recorded before any write path ships | MET | test | `apps/cli/tests/board/action-plane.test.ts` — "the recorded decision (AC1, feature R9)" asserts the ADR-035 amendment reads Accepted and the design names the route, the switch and all nine refusal codes; sources: `docs/00_ADR.md:1417` and `docs/04_DESIGN.md:536` |
| AC2 Actions execute only after a preview and a single-use confirmation | MET | test | `apps/cli/tests/board/action-plane.test.ts:118` (handshake, argv equality, audit order), `:160` (replay), `:172` (expiry), `:192` (typed confirmation) |
| AC3 The action plane refuses unsafe requests | MET | test | `apps/cli/tests/board/action-plane.test.ts:228` (disabled), `:237` (unknown kind), `:244` (origin), `:258` (host/header), `:266` (params), `:212` (lock) — every case asserts `spawned === []` and the audit line |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Feature: `docs/features/G83_daily-ai-voice-ops-console-day-centric-digest-debug-tabs-and-guarded-redo-tools.md`
- Design satellite: `docs/design/daily-voice-ops-console.md` (index row `docs/04_DESIGN.md:64`)
- Decision: `docs/00_ADR.md:1417` (ADR-035 amendment 2026-11-25)
- Brainstorm: `docs/plans/2026-11-25-daily-ai-voice-ops-console-brainstorm.md`
- Code anchors: `apps/cli/src/board/reader.ts:666-724`, `apps/cli/src/board/news.ts:40,58-160,254,469`, `apps/cli/src/board/daily-voice.ts:308`, `apps/cli/src/board/capture.ts` (`BOARD_RUNS_REL`), `apps/cli/src/commands/content-launch.ts:525`, `apps/board/src/contracts.ts:11,44,250`
- Follow-ups: G84 (in-board artifact editor), G85 (digest push notification)

### History

- 2026-11-26T04:32:22.230Z todo → wip (system)
- 2026-11-26T04:35:17.033Z wip → testing (system)
- 2026-11-26T04:35:18.240Z testing → done (system)

