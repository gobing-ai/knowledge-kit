---
schema_version: 1
name: Daily AI Voice kk news edit verb, edit/revert action kinds and safety-stale projection
status: todo
template: feature-impl
created_at: 2026-11-26T01:24:35.100Z
updated_at: "2026-11-26T01:33:21.268Z"
feature_id: G84
priority: P2
tags:
  - board
  - daily-ai-voice
  - cli
  - action-plane
estimate_hours: 8

---

## 0444. Daily AI Voice kk news edit verb, edit/revert action kinds and safety-stale projection

### Background

Feature G84 lets the operator correct a day's article body or voice script before a re-render (design: docs/design/daily-voice-ops-console.md §10). This task is the backend: the CLI verb that owns the write, the two action kinds on the G83 action plane, and the day-projection changes that make an edit visible.

Depends on G83 task 0439 (projectDay, DailyDigest, attention rules, resolveArgv) and task 0442 (POST /api/actions/<kind>, token, lock, audit). Do not start before both are done: neither `apps/cli/src/board/day.ts`, `apps/cli/src/board/actions.ts` nor `apps/cli/src/board/action-plane.ts` exists yet, and `board.actions.enabled` has no reader (rg over apps/cli/src, packages/*/src, plugins/kk/scripts, 2026-11-25).

Evidence (2026-11-25): generate-render re-derives the article when 22-article/<day>_06_article-write_body.md is newer than _06_article_content.json (plugins/kk/scripts/daily-stages.ts:1134-1141); the voicescript is cached once written (plugins/kk/scripts/daily-stages.ts:5650-5656); the safety digest binds article content.json + voicescript bytes (plugins/kk/scripts/safety-artifact-check.ts:199-207), so any edit makes the recorded verdict stale.

Rubric: E2 D2 L1 C1 R2 = 8 → decompose (force: R=writes production artifacts that gate publishing). This child owns the verb + plane + projection; the Board editor is the sibling.

**Refine corrections (2026-11-25) — premises read against the current tree:**

1. **Article re-derivation confirmed, but the digest does not cover the body file.** The `article` stage of `generate-render` (`dailyArticle`) re-derives the pair when `22-article/<day>_06_article-write_body.md` is newer than `22-article/<day>_06_article_content.json` (`daily-stages.ts:1134-1141`), while `draftDigest` hashes only `_06_article_content.json` + `_08_script_voicescript.yaml` (`safety-artifact-check.ts:199-207`). Consequence: immediately after an article-body edit the recorded digest still matches, so "digest mismatch" alone would report `fresh` and AC5 would fail. Staleness therefore covers two cases: digest mismatch, and article body newer than content.json.
2. **The voicescript is write-once in the render stage.** `dailyScript` returns as soon as `24-script/<day>_08_script_voicescript.yaml` exists (`daily-stages.ts:5650-5656`), so a re-render never overwrites an edited script — the edit survives, which is the behaviour this feature wants.
3. **The open premise is settled: the whole-document cache does NOT invalidate on a changed voicescript.** `wholeDocCache` (`daily-stages.ts:1570-1581`) accepts `30-audio/<day>_11_generate_content.json` on a matching `metadata.generator`, `qc.passed === true` and a playable audio path; it never reads the script. `dailyGenerate` returns early on that hit at `daily-stages.ts:1713`, before the per-section cache — whose key does include the segment text (`daily-stages.ts:1908`) — is ever consulted. Without a fix, `generate-voice` replays the pre-edit audio and the operator hears the old script. Decision (R8): put the script bytes into the cache identity in the stage body, not an `rm` line in the recipe.
4. **The frozen predicate already exists.** `generate-bundle --stage freeze` refuses when the resolved bundle carries `contentType` (`apps/cli/src/commands/content-generate.ts:1385-1395`), and `resolveBundlePath` prefers `<day>/bundle.json` over `4-publish/bundle.json` (`apps/cli/src/publish-matrix.ts:163-175`). Reuse both; no new marker.
5. **The write order has a precedent.** `commitAlignment` fixes read → validate → lock → CAS → backup → atomic write → receipt (`plugins/kk/scripts/news-editorial-ledger.ts:517`), and the atomic writer (same-directory temp + rename) is private in `apps/cli/src/board/capture.ts:155-160` — copy those five lines beside the verb rather than exporting a board-internal helper.
6. **Lock semantics.** `LocksDao.acquire` returns a boolean and `current(name)` returns the record or `undefined` (`packages/kk-store/src/dao/locks.ts:44,67`); 0442 holds `ops-console:<day>` for the plane, so the verb only reads `current()` and refuses when the holder is not this invocation.
7. **Verb placement is constrained by the surface rule.** Every module under `apps/cli/src/commands/` must export a `register…Command` function (`.spur/rules/surface/check-cli-surface.yaml:31-42`), news-only step verbs register through `verbCommand` (`content-generate.ts:1443,1459-1470`), and the two content nouns register from `registerContentVerbs` (`apps/cli/src/commands/content.ts:509-511`). Also: no `.parse(` at module scope and no `process.exit` in a command module (same rule file, :44-64).
8. **The plane cannot import a stage body.** `apps/cli/src` never imports `plugins/kk/scripts/*` (those are spawned as separate processes; `apps/cli/src/stage.ts:7` only names a path) and the stage files are builtins-only by contract (`plugins/kk/scripts/daily-stages.ts:37-39`). So the digest recomputation in `projectDay()` must be a documented mirror of `draftDigest`, pinned by an executable parity check (Plan), not a shared import.

Install note: R8 edits a stage body under `plugins/kk/scripts/`, so the AGENTS.md install-sync (rsync to the installed package; `bun scripts/bundle-plugins.ts` in a worktree) must run before any scheduled tick — otherwise the edit verb is live while every cron run keeps the stale-blind cache. The action plane's HTTP surface also needs the reader's POST allowance from 0442 (`apps/cli/src/board/reader.ts:703-724`), which this task extends for two more kinds only.


**Refine corrections (2026-11-25, implement-ready pass) — supersede correction 3 and the Install note above:**

1. **R8 is invalid and removed (with everything that existed only for it).** The cache premise was false: the daily voice path always runs per-section (`apps/cli/src/commands/content-generate.ts:713-722` passes section concurrency `'1'`), each section's cache hash includes its text (`plugins/kk/scripts/daily-stages.ts:1908`), and the joined final is reused only when `metadata.sectionHashes` match exactly (`daily-stages.ts:1589-1601`). An edited `segments[].text` therefore re-synthesizes that section on the next `generate-voice` with no code change. Dropped: R8, R5's R8 sentence, the "R8 cache identity" Design bullet, Plan step 1, and the stage-body install-sync. Gap left at R8. Residual risk, recorded but out of scope: while a whole-doc final with passing QC stays cached, the pre-spend floor gate is skipped (`daily-stages.ts:1687`); the post-synthesis duration gate still refuses.
2. **R3's script shape matches the stage's requirement:** `segments` must hold at least 2 entries (opening and closing), each with non-empty `text` (`daily-stages.ts:1757-1760`). "At least one non-empty text" would accept a script that `generate-voice` then refuses.
3. **This task no longer touches `plugins/kk/scripts/`.** `daily-stages.ts` has an uncommitted diff of unknown origin (`SCRIPT_FLOOR_CHAR_RATE`, `git status` 2026-11-25), so leave it alone. The only install step left is copying `apps/cli/dist` (AGENTS.md "Editing apps/cli / packages").
4. **Re-estimate: 10 h → 8 h** (the R8 cache change and its fixture test are gone).

### Requirements

- [ ] R1. `kk news edit --run-date <day> --artifact article|script --from-file <path|-> --base-sha <hex>` replaces exactly the allowlisted file (article → `22-article/<day>_06_article-write_body.md`, script → `24-script/<day>_08_script_voicescript.yaml`) via a same-directory temp file + rename, backs up the prior bytes to `<day>/edits/<ts>-<artifact>.<ext>` before the rename, and prints the backup path and the new sha256.
- [ ] R2. `kk news edit --run-date <day> --artifact <a> --revert` restores the newest backup (lexicographically greatest `<ts>` prefix under `<day>/edits/` for that artifact) and backs up the bytes it replaces, so the revert itself can be undone.
- [ ] R3. The verb refuses (nonzero exit, reason naming the check as a closed code, no write, no backup) on: unknown artifact, a source path that is not readable or is a directory, base-sha mismatch, body > 256 KiB, script not valid YAML or without a `segments` array of at least 2 entries each with non-empty `text` (the shape `daily-stages.ts:1757-1760` requires), frozen bundle, `ops-console:<day>` lock held by another holder. No caller-supplied path is ever used as a destination: the target comes from the closed artifact enum and the day directory resolved from `--run-date`, so no input can escape the day directory or reach another file.
- [ ] R4. Action kinds `edit-artifact` {day, artifact, baseSha} and `revert-artifact` {day, artifact} are added to the closed `ActionKind` union and `resolveArgv`; preview returns a server-computed unified diff; execute spawns the verb with `--from-file -` and the body on stdin; the token binds sha256(kind + argv + body); every preview, execute and refusal is audited in `actions.jsonl` under the existing envelope, and the body itself is never written to it (hash only).
- [ ] R5. `projectDay()` reports safety `stale` when the recorded verdict's digest no longer matches the current bytes (recomputed over article `_06_article_content.json` + `_08_script_voicescript.yaml`, mirroring `safety-artifact-check.ts:199-207`), and also when the article body file is newer than `content.json` (a pending edit the digest cannot see yet); a new `artifact-edited` (warn) attention rule emits ordered recipes: article → rerender-step generate-render, generate-from-node safety; script → generate-from-node safety, rerender-step generate-voice. The script recipe needs no cache-removal line: section cache hashes key on segment text (`daily-stages.ts:1908`, `:1589-1601`), so `generate-voice` re-synthesizes edited segments.
- [ ] R6. A confirmed edit carrying a stale base sha is refused as a 409 conflict from the plane, with the current sha in the response.
- [ ] R7. `docs/04_DESIGN.md` documents `kk news edit` and the two action kinds in the same commit.

### Acceptance Criteria

- [ ] AC1 — The operator edits an allowlisted day artifact through the CLI verb (req: R1)
- [ ] AC2 — Every edit can be reverted to the bytes it replaced (req: R2)
- [ ] AC3 — Unsafe or stale edits are refused and change nothing (req: R3; R6)
- [ ] AC5 — An edit re-arms the safety gate and names the re-render steps (req: R5)
- [ ] AC6 — A concurrent change to the artifact is not overwritten (req: R3; R6)

AC1/AC2/AC3 run against a fixture day directory with the real `kk` binary: the file bytes, the `edits/` backup and the printed `{backup, sha256}` are asserted, and each refusal case asserts an untouched artifact plus no `edits/` entry. AC5 is asserted twice — `projectDay()` returns `safety: stale` with the two recipes in run order for an edited script, and for an edited article body before the re-render (the mtime case) — and the `revision-valid` parity run in Plan pins the digest to the gate's own implementation. AC6 is the plane's 409 carrying the current sha, with the child never spawned. R7 (docs) and R4 (action kinds) are verified by the doc diff and the refusal-matrix tests, which cover both new kinds.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Chosen: CLI verb owns the write; the reader's action plane only launches it (keeps the ADR-035 amendment invariant and gives byte-identical recipe/action argv). Rejected: reader writes the file directly — a second write path with no CLI parity.

**Frozen:**

- **Module.** New `apps/cli/src/commands/content-edit.ts` exporting `registerContentEditCommand(group, noun, defaultType)`; `registerContentVerbs` calls it only for `noun === 'news'` (`commands/content.ts:509-511`). It satisfies the surface rule (`.spur/rules/surface/check-cli-surface.yaml:31-42`), parses nothing at module scope and never calls `process.exit` (fail with the existing `{code,message}` + `CommanderError` shape used at `commands/content-generate.ts:1389-1395`).
- **Order inside the verb** (mirrors `news-editorial-ledger.ts:517`): resolve day dir → artifact enum → read current bytes → size cap (256 KiB, checked before hashing and before reading `-` into memory beyond the cap) → sha compare → script YAML shape (`segments[]` array of at least 2 entries each with non-empty `text`, the shape `daily-stages.ts:1757-1760` requires) → frozen check (`resolveBundlePath` + `contentType`, `commands/content-generate.ts:1385-1395`, `publish-matrix.ts:163-175`) → lock read (`LocksDao.current`, `dao/locks.ts:67`) → backup → atomic write → print `{backup, sha256}`.
- **Closed refusal codes:** `news.edit.artifact.unknown`, `news.edit.base-sha.mismatch`, `news.edit.body.too-large`, `news.edit.script.invalid`, `news.edit.frozen`, `news.edit.lock.held`, `news.edit.no-backup`. The plane maps them (`base-sha.mismatch` → 409 with the current sha, `lock.held` → 409, the rest → 400/422) instead of parsing prose.
- **Backup name.** `<day>/edits/<ts>-<artifact>.<ext>` with `<ts>` = `YYYYMMDDTHHMMSS.mmmZ`-style sortable UTC and `<ext>` `md`|`yaml`; revert picks the greatest `<ts>` for that artifact and writes its own backup first, so revert-of-revert works.
- **Plane.** `ActionKind` gains `edit-artifact` {day, artifact, baseSha} and `revert-artifact` {day, artifact} (the union lands in `apps/cli/src/board/actions.ts`, owned by 0439). Preview for both kinds computes `unifiedDiff(currentBytes, bodyOrNewestBackup, 'a/…', 'b/…')` with one small line-diff helper beside the plane (no diff package is installed — checked 2026-11-25); execute spawns `kk news edit … --from-file -` and writes the body to the child's stdin (`Bun.spawn` `stdin` as bytes), never through a shell. The token hash for these two kinds appends the body bytes: `sha256(kind + '\0' + argv.join('\0') + '\0' + sha256(body))`; 0442's body-less formula stays for the other kinds. Audit lines keep the existing envelope and carry the body hash only.
- **Projection.** `apps/cli/src/board/day.ts` gains a local `currentDraftDigest(workDir, day)` that mirrors `safety-artifact-check.ts:199-207` (article content.json + `\0` + voicescript + `\0`), compares it with the recorded `request.digest` (recorded in `<scope>/<day>_09_safety-review_request.json`, read at `safety-artifact-check.ts:230-239`), and adds the article-mtime case from Background correction 1. `artifact-edited` joins the closed attention set in the design's rule table with severity `warn` and the two ordered recipe lists backed by 0439's `rerender-step` / `generate-from-node` argv (design §6, `docs/design/daily-voice-ops-console.md:132-135`).
- **Parity pin.** Because the digest cannot be imported across the `apps/cli` ↔ `plugins/kk/scripts` boundary (Background 8), one test writes a fixture day, flips the voicescript, and asserts both sides agree: `projectDay()` reports `stale` while `bun plugins/kk/scripts/safety-artifact-check.ts revision-valid <workDir> <day> false ""` exits 1 with the unchanged-digest reason (`safety-artifact-check.ts:233-239`).

Rejected: a recipe that tells the operator to delete `30-audio/...` by hand (internal path, silently skipped, and it fixes only this one entry point); exporting the board's `atomicWrite` (board-internal, `capture.ts:155`); a second lock name (0442 already holds `ops-console:<day>`); a diff dependency.

**Anti-patterns:** free-text path parameters; body echoed into stdout/log/audit; `sh -c`; hashing after spawning; writing before the backup; a revert that skips its own backup; a stale check that only compares digests.

**Depends on:** 0439 (`projectDay`, `DailyDigest`, attention rules, `resolveArgv`), 0442 (`POST /api/actions/<kind>`, token store, `ops-console:<day>` lock, `actions.jsonl` envelope).

### Plan

- Failure list before the verb: each R3 refusal, revert with no backup, revert-of-revert, stale-sha confirm, 256 KiB boundary (exactly at and one byte over).
- Implement `apps/cli/src/commands/content-edit.ts` + registration in `commands/content.ts`; E2E over a fixture day asserting bytes, backup path, printed sha, lock-held refusal and frozen refusal (`bun run test` includes the CLI E2E that spawns the real binary).
- Add `edit-artifact` / `revert-artifact` to `apps/cli/src/board/actions.ts` (`ActionKind`, `resolveArgv`, param validation) and to `action-plane.ts` (body-cap before hashing, body in the token hash, unified diff, stdin spawn); extend the HTTP refusal matrix for both kinds and assert no child is launched on any refusal.
- Extend `projectDay()` with the mirrored digest + article-mtime staleness and the `artifact-edited` rule with ordered recipes; add the parity test against `safety-artifact-check.ts revision-valid` and a digest test for each artifact.
- Unit-test the line diff (empty sides, single-line change, no trailing newline, unchanged input → empty diff).
- Update `docs/04_DESIGN.md` §1.3 (the `kk news edit` surface, after `docs/04_DESIGN.md:1473-1494`) and §6 of the satellite; run `bun run gate` (`bun run lint`, `bun run test`, `bun run build`), `spur rule run` for the surface rules, then copy `apps/cli/dist` into the installed package (AGENTS.md "Editing apps/cli / packages").

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
