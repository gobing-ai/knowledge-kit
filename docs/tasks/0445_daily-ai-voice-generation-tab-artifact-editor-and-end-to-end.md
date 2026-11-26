---
schema_version: 1
name: Daily AI Voice Generation-tab artifact editor and end-to-end evidence
status: todo
template: feature-impl
created_at: 2026-11-26T01:24:35.107Z
updated_at: "2026-11-26T01:24:35.256Z"
feature_id: G84
priority: P2
tags:
  - board
  - daily-ai-voice
  - ui
  - e2e
estimate_hours: 6

---

## 0445. Daily AI Voice Generation-tab artifact editor and end-to-end evidence

### Background

Feature G84 (design: docs/design/daily-voice-ops-console.md §10). This task adds the Board side: an editor in the Generation tab that previews a diff and confirms through the guarded action plane, plus the repeatable E2E artifact for the feature.

Depends on the sibling backend task (kk news edit verb + edit-artifact/revert-artifact action kinds + safety-stale projection) and on G83 task 0441 (Generation detail tab) and 0442 (action plane UI flow). Do not start before they are done.

Rubric: E1 D2 L1 C1 R1 = 6 → decompose (UI + browser evidence is its own deliverable boundary from the verb/plane).

**Refine corrections (2026-11-25) — premises read against the current tree:**

1. **0441 and 0442 are authored, not shipped** (`docs/tasks/0441_daily-ai-voice-generation-and-publishing-detail-tabs.md:3` and `docs/tasks/0442_daily-ai-voice-guarded-action-plane-and-actions-log-tab.md:3` are both `status: todo`). There is no action route today: the reader answers every non-GET with 405 (`apps/cli/src/board/reader.ts:722-723`) and its preflight advertises `GET, HEAD, OPTIONS` / `range, content-type` (`reader.ts:707-708`). This task therefore edits files 0441/0442 create — read them first and record the real component, route and prop names in Solution at implement time instead of trusting the names below.
2. **The Board's component set is `@gobing-ai/spur/board/ui` plus local `../shared` modules** (`apps/board/src/daily-voice/index.tsx:1-13`: Badge, Diagnostic, EmptyState, ModuleHeader, ModuleShell, ModuleTabs; `createBoardClient` / `readerOriginFrom` from `apps/board/src/shared/api.ts`). A plain textarea plus a `<pre>` diff needs nothing else, and no editor package is installed (no `codemirror`/`monaco` in any `package.json`).
3. **`board.actions.enabled` has no reader anywhere today** (rg over apps, packages, plugins, 2026-11-25); 0442 R5 introduces it. Read the switch from the digest/health response the tab already fetches — never from a second config read in the browser.
4. **The browser harness exists:** `playwright@1.55.0` (`package.json:21`, `apps/board/package.json:23`) and `apps/board/tests/installed-board.test.ts:1-30` already drives real Chromium, writing screenshots to its `artifactDir()`. Committed evidence has a precedent at `docs/tasks/evidence/0369/20261117/`; follow it for the committed renders and `actions.jsonl` lines.
5. **The G83 fixture works root is 0443's deliverable** (`docs/tasks/0443_daily-ai-voice-console-end-to-end-evidence-and-docs-sync.md` R1, still todo). This task builds the minimum one-day fixture under `apps/board/tests/daily-voice/fixtures/` and 0443 extends it to the ten-day set, so neither task blocks the other.
6. **Docs targets:** G84's status row is `docs/features/INDEX.md:101` (spur-owned — refresh with `spur feature refresh --feature G84`, never hand-edit), and the satellite row is `docs/04_DESIGN.md:64`. `docs/05_FEATURES.md` has no G84 row yet (`rg G84 docs/05_FEATURES.md` → 0 hits; its table carries rows such as `G8` at `docs/05_FEATURES.md:114`), so R6 means adding that row in the same commit as the shipped status.

### Requirements

- [ ] R1. The Generation tab shows Edit for the article body and the voice script when `board.actions.enabled` is true; when disabled it shows the copyable `kk news edit` recipe only (the same argv the plane resolves), and no editable field.
- [ ] R2. Editing loads the current bytes and their sha256, previews the server diff, and confirms with the returned token; success refetches the day digest once and shows the new safety-stale state plus the `artifact-edited` recipes.
- [ ] R3. A 409 conflict offers reload-current-bytes without discarding the operator's draft (it stays in the textarea); every other refusal shows its reason from the response envelope.
- [ ] R4. Revert is offered when a backup exists, through `revert-artifact`, with the same preview/confirm path and the same conflict behaviour.
- [ ] R5. One repeatable E2E on the G83 fixture works root: reader started with actions enabled, browser edit → preview → confirm of the article on one day, then revert; commits screenshots and the resulting `actions.jsonl` lines; plus the HTTP refusal matrix for both kinds.
- [ ] R6. `docs/05_FEATURES.md` G84 status and the satellite §10 status are synced (`docs/05_FEATURES.md` gains its G84 row; `docs/04_DESIGN.md:64` moves off "planned (G84, G85)" for G84, and G84's status comes from `spur feature refresh --feature G84`, not a hand-edit of `docs/features/INDEX.md:101`).

### Acceptance Criteria

- [ ] AC4 — The Board edits through the guarded action plane (req: R1; R2; R4)
- [ ] AC6 — A concurrent change to the artifact is not overwritten (req: R3)

AC4 is carried by the committed browser E2E: it asserts the preview diff, the confirmed write reaching the plane (one preview line and one execute line in `actions.jsonl`, no body text in either), the rendered stale safety state with the ordered recipes after the refetch, and the revert round-trip; the same file's refusal matrix asserts that a disabled plane, a bad origin, a reused token and a held lock launch nothing and are audited. AC6 is the 409 case in the browser: the draft stays in the textarea, reloading replaces the base sha, and a retry with the old sha is refused again. R5's "repeatable" bar means the E2E runs from a clean checkout with one command and its artifacts are committed; R6 is checked by the doc diff plus a non-todo G84 status from the spur refresh.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Chosen: plain textarea + server-computed diff rendered as pre-formatted lines — no editor dependency, matches the Board's existing component set. Rejected: CodeMirror/Monaco — new dependency for two files.

**Frozen:**

- **State.** The editor component holds `{artifactId, loadedBytes, baseSha, draft, preview, status}` in one reducer. `draft` is never derived from a refetch, which is what makes R3's "keep the draft" true by construction. One in-flight request at a time (button disabled), and the server's `ops-console:<day>` lock stays authoritative — the client guard is UX, not safety.
- **Flow.** Load current bytes through the 0441 artifact route → sha256 is whatever the server reported, never computed in the browser → Preview posts `{day, artifact, baseSha}` to `POST /api/actions/edit-artifact` and renders the returned diff lines in a `<pre>` (additions/removals by prefix, no HTML in the string) → Confirm posts `{params, token}` and on success refetches `GET /api/days/<day>` exactly once, then renders `safety: stale` and the ordered recipes through 0441's recipe component.
- **Revert.** A `revert-artifact` preview with the same component; the button renders only when the digest (or the artifact response) reports a backup exists, so the client never invents a backup path.
- **Refusals.** 409 → inline conflict banner + "Reload current bytes" action that replaces `loadedBytes`/`baseSha` only when clicked, leaving `draft` intact; `actions.disabled` / `actions.lock.held` / `actions.token.invalid` / `news.edit.*` → banner with the envelope's message; nothing swallowed.
- **Frozen day.** Edit stays visible for a frozen day: the verb's `news.edit.frozen` refusal is shown as the reason, which teaches the operator to start a fresh run (the alternative — hiding the control — makes the refusal undiscoverable).
- **No typed confirmation** (an edit is not a live send), but the token remains single-use and expiring — a retried confirm without a fresh preview shows the plane's token refusal, not a silent second write.
- **E2E.** `apps/board/tests/daily-voice/editor.e2e.test.ts`, one committed test: a fixture day, the reader from `createBoardReader` with actions enabled, a stub `kk` on PATH (so a spawned verb never touches real artifacts), Chromium through the `installed-board.test.ts` launch pattern. It asserts the rendered diff, the post-confirm stale banner and recipes, the revert round-trip, and then dumps `actions.jsonl`; screenshots and the log are committed under `docs/tasks/evidence/<wbs>/<day>/`. The refusal matrix for both kinds runs against the injected spawn (0442's seam) in the same file, one case per code, each asserting nothing launched.

Rejected: refetching the digest on a timer (the plane already returns the new state; a poll hides a stale UI bug); computing the sha in the browser (a second source of truth); optimistic UI after confirm (the write can still be refused).

**Depends on:** the G84 backend sibling (verb + kinds + stale projection), 0441 (Generation tab, artifact route, recipe component), 0442 (action plane, `board.actions.enabled`, `actions.jsonl`).

### Plan

- Read 0441/0442 as merged; record the real component, route and prop names in Solution before writing UI code.
- Failure list before the editor: plane disabled, 409 conflict, oversize body (> 256 KiB), lock held, frozen day, no backup for revert, expired/reused token.
- Build the editor on the 0441 Generation tab with the shared action component: load → textarea → preview diff → confirm.
- Wire the single digest refetch plus the safety-stale and `artifact-edited` recipe display after success; keep the draft across any refusal.
- Add the revert affordance and its backup-existence gate.
- Build the E2E and the refusal matrix (stub `kk` on PATH, fixture day, screenshots + `actions.jsonl` under `docs/tasks/evidence/<wbs>/<day>/`).
- Sync `docs/05_FEATURES.md` (new G84 row), `docs/04_DESIGN.md:64`, and the satellite §10 status; `spur feature refresh --feature G84`; then `bun run gate` and the Board build.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
