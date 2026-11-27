---
schema_version: 1
name: Daily AI Voice Generation-tab artifact editor and end-to-end evidence
status: done
template: feature-impl
created_at: 2026-11-26T01:24:35.107Z
updated_at: "2026-11-27T18:11:18.607Z"
feature_id: G84
priority: P2
tags:
  - board
  - daily-ai-voice
  - ui
  - e2e
estimate_hours: 6

done_forced: "false"
done_reason: unforced close
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

- [x] R1. The Generation tab shows Edit for the article body and the voice script when `board.actions.enabled` is true; when disabled it shows the copyable `kk news edit` recipe only (the same argv the plane resolves), and no editable field.
- [x] R2. Editing loads the current bytes and their sha256, previews the server diff, and confirms with the returned token; success refetches the day digest once and shows the new safety-stale state plus the `artifact-edited` recipes.
- [x] R3. A 409 conflict offers reload-current-bytes without discarding the operator's draft (it stays in the textarea); every other refusal shows its reason from the response envelope.
- [x] R4. Revert is offered when a backup exists, through `revert-artifact`, with the same preview/confirm path and the same conflict behaviour.
- [x] R5. One repeatable E2E on the G83 fixture works root: reader started with actions enabled, browser edit → preview → confirm of the article on one day, then revert; commits screenshots and the resulting `actions.jsonl` lines; plus the HTTP refusal matrix for both kinds.
- [x] R6. `docs/05_FEATURES.md` G84 status and the satellite §10 status are synced (`docs/05_FEATURES.md` gains its G84 row; `docs/04_DESIGN.md:64` moves off "planned (G84, G85)" for G84, and G84's status comes from `spur feature refresh --feature G84`, not a hand-edit of `docs/features/INDEX.md:101`).

### Acceptance Criteria

- [x] AC4 — The Board edits through the guarded action plane (req: R1; R2; R4)
- [x] AC6 — A concurrent change to the artifact is not overwritten (req: R3)

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

| File | Lines | What / why |
| --- | --- | --- |
| `apps/cli/src/board/day.ts` | 754-820 | `dayArtifact()`: the editor's read. It resolves the draft through the same day-directory seam as the digest, computes the sha server-side, and returns both argv recipes (`recipeOf`, the one resolver the plane executes). The browser therefore never derives a digest or assembles a command. |
| `apps/cli/src/board/reader.ts` | 737-757, 855-870 | `GET /api/days/<day>/artifacts/<article\|script>`: read-only, no query parameters, `400 board.day.artifact.unknown` / `404 board.day.not-found` matching the day routes' vocabulary. The write stays the action plane. |
| `apps/cli/src/board/action-plane.ts` | 445-520, 605-640 | Edits are awaited instead of acknowledged: a body-bound execution returns `200 {saved}` on exit 0, or the verb's own closed `news.edit.*` code (`409` for a base-sha race, `422` otherwise). A `202` would have hidden `news.edit.frozen`, an invalid script and the race the plane's own pre-check cannot win. `spawnArgv` now carries a body on the child's stdin through `runStreaming` — the buffered runner has no stdin, which is why the first E2E run wrote zero bytes. |
| `apps/cli/src/commands/content-edit.ts` | 43-58, 268-300 | `news.edit.body.empty` joins the closed refusals: an empty body would destroy the draft, and a silent 0-byte write is the one failure mode worse than a refusal. |
| `apps/board/src/contracts.ts` | 457-485 | `DayArtifactDocument`: bytes, sha, both recipes, the newest backup name, and `editable` (mirrors `board.actions.enabled`). |
| `apps/board/src/shared/api.ts` | 139-145, 822-826 | `dayArtifact(day, artifact)` on the Board client. |
| `apps/board/src/daily-voice/index.tsx` | 463-660, 665-700, 1000-1030 | The editor: plain textarea + `<pre>` diff, no dependency. One in-flight request, `draft` never derived from a refetch (so a conflict keeps the operator's text), preview → confirm → exactly one digest refetch, revert gated on a server-reported backup, and recipes-only when the plane is off. `StaleNotice` renders `safety: stale` plus the ordered `artifact-edited` recipes where the operator edited. |
| `apps/board/tests/daily-voice/fixtures/day-20261125/**` | 8 files | The one-day fixture (design §10 wants a self-contained day): article content + body, voicescript, the matching safety review digest, decision, receipt, timings, bundle. Byte-stable: `**/fixtures` is excluded from Biome, because a formatter run changes the bytes the digest binds. |
| `apps/board/tests/daily-voice/editor.e2e.test.ts` | 1-560 | The committed E2E: reader with actions enabled, a `kk` shim onto this checkout's CLI (so the real verb writes inside a throwaway project), Chromium load → edit → preview diff → confirm → stale + recipes → revert, the disabled-plane recipes-only render, the 409-keeps-draft case, and the refusal matrix (foreign origin, missing header, reused token, stale sha/lock). Renders and `actions.jsonl` committed under `docs/tasks/evidence/0445/20261125/`. |
| `apps/cli/tests/board/action-plane-edit.test.ts` | 93-230 | Updated for the awaited edit answer (`200 {saved}`), plus the body-on-stdin assertion. |
| `docs/04_DESIGN.md` | 430-441, 600-615 | The artifact route in the day-route table and the editor's flow in the console paragraph. |
| `docs/05_FEATURES.md` | 116 | The G84 row (new; the feature had no row) → done with 0444/0445. |
| `docs/design/daily-voice-ops-console.md` | 10, 240-250 | §10 marked shipped for both halves; the UI paragraph records the route, the refetch and the conflict behaviour. |
| `docs/features/G84_…md`, `docs/features/INDEX.md` | — | Status via `spur feature refresh --feature G84`, not a hand-edit. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — Edit shown only when `board.actions.enabled`; disabled shows the copyable `kk news edit` recipe and no editable field | MET | `apps/board/src/daily-voice/index.tsx:463-660` (recipes-only branch, `editor-<a>-recipe`); server-computed argv in `apps/cli/src/board/day.ts:765-820`; asserted by `apps/board/tests/daily-voice/editor.e2e.test.ts` "shows the recipes only when the plane is disabled" (textarea count 0, recipe text contains the run-date/artifact argv) |
| R2 — load bytes + sha, preview the server diff, confirm with the token, refetch once, show stale + `artifact-edited` | MET | editor `ask`/`confirm` (`index.tsx:520-575`), one `onChanged()` call; `StaleNotice` (`index.tsx:665-700`); E2E "loads, previews …, then reverts" asserts the diff (`--- a/22-article`), `saved`, then the stale block with `artifact-edited` and the `generate-render` recipe |
| R3 — 409 offers reload-current-bytes without discarding the draft; other refusals show their envelope message | MET | `index.tsx:575-620` (banner + `reload current bytes`, `draft` never derived from the refetch); E2E "keeps the draft across a 409 conflict" (draft intact, reload refills bytes, no overwrite) |
| R4 — revert through `revert-artifact`, offered only when a backup exists, same preview/confirm and conflict behaviour | MET | `index.tsx:620-660` (button gated on `document.revertRecipe`); E2E revert round-trip asserts the restored bytes equal the pre-edit text |
| R5 — one repeatable E2E on the fixture: edit → preview → confirm → revert, screenshots + `actions.jsonl`, plus the refusal matrix for both kinds | MET | `apps/board/tests/daily-voice/editor.e2e.test.ts` (one command: `bun test tests/daily-voice/editor.e2e.test.ts`); artifacts `docs/tasks/evidence/0445/20261125/{editor-loaded,editor-preview-diff,stale-after-edit,reverted,conflict-keeps-draft,disabled-recipes-only}.png` + `actions.jsonl`; matrix test covers foreign origin, missing header, reused token, stale sha/lock and asserts nothing was written |
| R6 — `docs/05_FEATURES.md` G84 row and the satellite §10 status synced; index via `spur feature refresh` | MET | `docs/05_FEATURES.md:116` (new G84 row, done); `docs/design/daily-voice-ops-console.md:10,240-250`; `docs/features/INDEX.md:102` refreshed by `spur feature refresh --feature G84`, not hand-edited |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC4 — the Board edits through the guarded action plane | MET | test | `apps/board/tests/daily-voice/editor.e2e.test.ts` (preview diff, confirmed write, stale + recipes, revert round-trip; `actions.jsonl` records one preview, one launch and one exit per write, with the token hash and no body text) |
| AC6 — a concurrent change is not overwritten | MET | test | the 409 case in the same file: draft preserved, bytes on disk unchanged, reload refills the sha |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-27T17:23:27.718Z todo → wip (system)
- 2026-11-27T18:11:16.189Z wip → testing (system)
- 2026-11-27T18:11:18.600Z testing → done (system)

