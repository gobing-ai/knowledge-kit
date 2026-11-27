---
kind: design
title: Daily AI Voice ops console
feature: G83
status: shipped
date: 2026-11-25
adr: ADR-035 amendment 2026-11-25
---

# Daily AI Voice ops console

Replaces the run-centric Daily AI Voice Board module (`apps/board/src/daily-voice/`) with a
day-centric console for the operator's daily job: **what happened today, what needs me, show me
the detail, let me redo that step safely.** Decision and reason: `docs/00_ADR.md` ADR-035
amendment 2026-11-25. Brainstorm: `docs/plans/2026-11-25-daily-ai-voice-ops-console-brainstorm.md`.

## 1. Unit of view: the day

- **Day key** = `YYYYMMDD` = the `kk-news-generate` `work_dir` basename
  (`<works>/kk-news-generate/<day>/`). One day = one episode.
- A day joins:
  - every `kk-news-generate` attempt captured for that directory (`.works/.board/runs/*.json`
    with `workspacePath` = the day dir; newest `capturedAt` = current) plus the day's
    `schedule-receipt.json` launch status;
  - the per-window publish evidence in the day dir, grouped by `window` (`after-generate`,
    `cn-peak`, `overseas-rss`): `4-publish/{plan,check,outcome,settlement}.<window>.json` via the
    existing `publishingEvidence` (`apps/cli/src/board/news.ts`), with the window's kk-publish run
    id and launch status from `4-publish/schedule-receipt.<window>.json`. kk-publish Spur runs are
    **not** joined — kk-publish is not a reader `WorkflowName`, and the day dir is authoritative
    (refine 2026-11-25);
  - the safety outcome (the day's `4-safety-variants/*safety-verdict.status` and
    `*_safety-judge_verdict.json`; `ledger.md` / `conclusion.md` live one level up, shared across
    days, and are context only).
- A window with no receipt and no plan is `not-run`; a plan without a launch receipt is `unknown`
  with reason `no-launch-receipt` — never silently dropped or counted as success (R12).

## 2. `projectDay()` — the one projection

`apps/cli/src/board/day.ts`:

```ts
// ctx = the existing reader-helper shape { projectPath, fs } (no ReaderContext type exists)
export function projectDay(ctx: { projectPath: string; fs: FileSystem }, day: string): Promise<DailyDigest | DayNotFound>;
export function listDays(ctx: { projectPath: string; fs: FileSystem }, from: string, until: string): Promise<DaySummary[]>; // bounded: ≤ 31 days
```

It reads only what the per-run routes already authorize (capture records + run-dir artifacts:
`step-timing.json`, `5-report/*.md`, `4-publish/{plan,check,outcome,settlement}.<window>.json`,
`publish-events.jsonl`, `dispatch-ledger.json`, safety files). No new store access.

`DailyDigest` (added to `apps/board/src/contracts.ts`; shape owned by `04` once shipped):

| Field | Content |
| --- | --- |
| `day`, `status` | `ok` \| `attention` \| `failed` \| `running` \| `unknown` (worst-of rule below) |
| `generation` | current run id, status, outcome (episode produced / refused gate), attempt list, voice engine + fallback chain, total + per-node duration |
| `windows[]` | per window: run id or `not-run`, status, outcome, target rows (`target`, `tier`, `mode`, `status`, `effect`, `url`, `error`), provenance checks (date, bundle, parent run, digest) |
| `safety` | verdict, conclusion summary, or `unknown` |
| `attention[]` | `{severity, kind, subject, message, evidence, recipes[]}` ordered by severity then time |
| `sources` | for each figure group, the artifact path or Spur run id that supplied it (R2) |

Truthfulness rules carry over from G8/G82: `Availability` unknown ≠ 0, producer-success gating of
artifacts, bounded diagnostics, receipt/plan paths rendered as text (R6, R12).

**Status (worst-of).** `running` if any current run is live; else `failed` if generation failed or
any window has a target `failed` with `effect: none`; else `attention` if any attention item has
severity ≥ warn (engine fallback, a skipped window past its slot, safety concern); else `ok`.
Missing evidence that blocks the call → `unknown`.

**Attention rules (initial, closed set).** `generation-failed` (node + error), `generation-refused`
(gate + numbers), `engine-fallback` (warn), `window-not-run` (only once the window's slot has
passed), `target-failed` (per target, with effect), `provenance-mismatch`, `safety-flag`. Each rule
emits its recipes (§5). New rules are added to this table, not inferred.

## 3. Surfaces

| Consumer | Surface | Notes |
| --- | --- | --- |
| Board Today / History | `GET /api/days/<YYYYMMDD>` → `DailyDigest`; `GET /api/days?from&until` → `DaySummary[]` | GET-only, same loopback/origin rules as existing routes; query params declared on this route only; range capped at 31 days |
| CLI | `kk news digest --run-date <day> [--json]` | markdown (default) or the same `DailyDigest` JSON; missing day → exit 1 with the looked-up path (R4) |
| Generation / Publishing drill-down | existing `/api/workflows/<w>/runs/<id>/(evidence|results|artifacts/<id>)` | reuses the news evidence DTO; no new per-run route |
| Node duration trend | `listDays()` reads `step-timing.json` per day | no `spur workflow profile` shell-out from the reader (keeps reads file-backed and bounded) |

## 4. Board module

Same module id/route as today (bookmarks survive). Tabs:

1. **Today** — day picker (default: latest day), status banner, generation card, window strip,
   safety line, attention list with recipes; explicit all-clear when empty (R3).
2. **Generation** — run/attempt picker for the day; node timeline (state, attempts, timings from
   `step-timing.json`), engine fallback chain, artifacts with availability reasons, bounded
   diagnostics (R5).
3. **Publishing** — window × target matrix; per-window outcome + provenance checks; receipts as
   text (R6).
4. **History** — N-day strip (status + per-window outcome), per-node duration trend; click a day →
   Today (R7).
5. **Actions log** — reads `actions.jsonl` for the selected day (hidden content when the action
   plane is disabled: shows "actions disabled — recipes only").

Retired: the voice2 fallback layout, `kk-daily-ai-voice2` / `kk-daily-ai-voice` code paths in the
module, the `WorkflowName` members used only by them, and the 2026-10-22 supply-context panel (R1).
`view.ts` / `evidence.ts` helpers that still serve per-run drill-down are kept and moved, not
rewritten.

## 5. Recipes (phase 1) — the action payload (phase 2)

A recipe is data, rendered as a copyable command and later posted as the action body:

```ts
interface Recipe {
    kind: ActionKind;            // closed union, see §6
    label: string;
    params: Record<string, string>; // only keys the kind allowlists
    argv: string[];              // resolved server-side by the same function the action plane uses
    dryRunArgv?: string[];
    live: boolean;               // true → typed confirmation in phase 2
}
```

`resolveArgv(kind, params)` lives in `apps/cli/src/board/actions.ts` and is used both to render
recipes in the digest and to execute actions — one mapping, so a copied recipe and a clicked action
are byte-identical argv. No free-text params; values are validated (`day` = 8 digits and an
existing day dir, `window` ∈ known windows, `node` ∈ the workflow's node ids, `channels` ⊂ the
window plan's targets, `runId` = a run of that day, override values from per-kind enums/ranges).

## 6. Action plane (phase 2)

### Allowlist

| `kind` | argv | live |
| --- | --- | --- |
| `generate-from-node` | `spur workflow run kk-news-generate.yaml --from <node> --from-run <runId> --async --json` | no |
| `publish-retry` | `kk news publish --run-date <day> --window <w> --retry [--channels <csv>]` | yes |
| `publish-window` | `kk news publish --run-date <day> --window <w> [--dummy]` | yes unless `--dummy` |
| `rerender-step` | `kk news generate-{voice,cards,render} --work-dir <day dir>`; only `generate-voice` takes an override (`--engine` ∈ its `--help` enum) | no |
| `cancel-run` | `spur workflow cancel <runId> --json` | no |
| `store-release` | `kk store release --run <runId>` | no |

Exact override flags per `rerender-step` verb are fixed in the implementing task from each verb's
`--help`; anything not in the table is refused.

### Protocol

1. `POST /api/actions/<kind>` `{params}` → reader validates, resolves argv, runs `dryRunArgv` when
   the kind has one (bounded output), returns `{argv, dryRun, token, expiresAt}`. Token = random
   128-bit, stored in-memory bound to `sha256(kind + argv)`, TTL 5 min.
2. `POST /api/actions/<kind>` `{params, token, typedConfirm?}` → token must match the same argv
   hash, unused, unexpired; consumed on first use. Live kinds require `typedConfirm === day`.
3. Reader acquires the store-backed lock (`LocksDao`, the one `kk lock` wraps) name
   `ops-console:<day>`, TTL 2 h; a held lock refuses (409). The CORS preflight for
   `/api/actions/*` (only) advertises `POST` and `x-kk-action`. Spawns argv
   (no shell), captures the run id from `--json` output where the verb emits one, returns
   `{actionId, runId?}`; releases the lock when the child exits.
4. The console follows `runId` via the existing run progress route until terminal; the Today tab
   refetches the digest on completion.

### Safety envelope

- **Off by default:** `board.actions.enabled: false` in `~/.config/kk/config.yaml`; disabled →
  403 with reason, and the UI shows recipes only.
- **Origin/host:** POST requires an `Origin` header that exactly matches the Board origin (the GET
  path's `origin === null` allowance does not apply), a loopback `Host`, and a custom
  `X-KK-Action: 1` header so cross-site simple requests cannot reach it.
- **Single-flight** per day via `kk lock`; **no shell** (argv array to `Bun.spawn`); child env
  inherits the reader's, never request data.
- **Audit:** append-only `<works>/kk-news-generate/<day>/actions.jsonl`, one line per preview,
  execute and refusal: `{ts, kind, argv, origin, token-hash, runId, exit, result|refusal}`; no
  secrets (argv contains none by construction).
- Every refusal (disabled, unknown kind, bad origin/host, bad token, lock held, missing typed
  confirmation) launches nothing and is audited (R11).

## 7. Verification (shipped, task 0443)

- One repeatable E2E: fixture works root with days 20261115–20261125 (one day mirroring the
  2026-11-25 shipinhao `effect: none` failure, one engine-fallback day, one window with a plan but
  no launch receipt),
  reader started against it, Board module driven in a browser; commits screenshots of Today,
  Generation, Publishing, History and one previewed + confirmed `publish-window --dummy` action
  whose child is a stub `kk` on PATH; plus `kk news digest` markdown/JSON equality against the
  Today DTO (R4, R13).
- Action-plane refusal matrix exercised over HTTP against the same reader (R11).

As built: `apps/board/tests/daily-voice-console.e2e.test.ts` (`bun test apps/board/tests/
daily-voice-console.e2e.test.ts`), fixture at `apps/board/tests/fixtures/daily-voice-days/`,
artifacts committed under `apps/board/tests/artifacts/daily-voice-console/`. Two notes the run
settled: the fixture's capture records carry `__PROJECT_ROOT__`/`__WORKS_ROOT__` placeholders
(a capture record names an absolute workspace path, so a committed one cannot be literal), and the
day routes carry `board.actions.enabled` into the digest — without it the console renders
recipes-only even when the plane is on.

## 8. Delivery slices

1. `projectDay()` + `DailyDigest` contract + attention rules + `resolveArgv` (recipes only).
2. Reader `GET /api/days*` routes.
3. `kk news digest` verb + `04` surface.
4. New module shell + Today + History; retire old module and voice2 code.
5. Generation + Publishing detail tabs.
6. Action plane (config switch, token, lock, audit, spawn) + Actions log tab.
7. E2E artifact + docs sync (`04`, `05`, this satellite → shipped).

## 9. Follow-ups

"Refine / fine-tune" (idea inventory I8) is scoped to re-running a step with allowlisted
overrides. Editing script/article text before a re-render is G84 (§10); pushing the digest is
G85 (§11). Both build on the shipped G83 slices and add no new reader route family.

## 10. In-board artifact editor (G84, shipped — 0444 backend, 0445 Board editor)

**Chosen:** a CLI verb owns the write, and the action plane launches it. Reason: this keeps the
ADR-035 amendment invariant "the endpoint only launches existing verbs", and it gives the editor a
copyable recipe identical to the clicked action. **Rejected:** the reader writing the file itself.
That would be a second write path outside the verb layer, with no CLI parity.

- **Allowlist (closed):**
  - `article` → `22-article/<day>_06_article-write_body.md`. `generate-render` re-derives the
    article when this file is newer than `_06_article_content.json`
    (`plugins/kk/scripts/daily-stages.ts:1134-1141`).
  - `script` → `24-script/<day>_08_script_voicescript.yaml`, which must be valid YAML with a
    non-empty `segments[].text`.
- **Verb:** `kk news edit --run-date <day> --artifact article|script (--from-file <path|-> --base-sha <hex> | --revert)`.
  - The new bytes go to a temp file and are renamed into place; the prior bytes go to
    `<day>/edits/<ts>-<artifact>.<ext>`.
  - The verb refuses, exiting nonzero with nothing changed, when:
    - the base sha does not match;
    - the body is over the size cap (256 KiB);
    - the script fails validation;
    - the day's bundle is frozen;
    - the day's `ops-console:<day>` lock is held by another holder.
  - `--revert` restores the newest backup and backs up the bytes it replaces.
- **Action kinds:**
  - `edit-artifact`: params `{day, artifact, baseSha}`. Preview returns the server-computed
    unified diff, and execute spawns the verb with `--from-file -` and the body on stdin.
  - `revert-artifact`: params `{day, artifact}`.
  - Both use the §6 envelope unchanged. The body is size-capped before hashing, and the token binds
    `sha256(kind + argv + body)`.
- **Safety re-arm:**
  - The safety digest binds the article `content.json` plus the voicescript bytes
    (`plugins/kk/scripts/safety-artifact-check.ts:199-207`).
  - `projectDay()` recomputes that digest and reports `safety: stale` on a mismatch.
  - The new attention rule `artifact-edited` (warn) emits recipes in order:
    - article: `rerender-step generate-render`, then `generate-from-node safety`;
    - script: `generate-from-node safety`, then `rerender-step generate-voice`.
- **Settled premise (0444):** the whole-document cache is irrelevant here — the daily voice path
  always runs per-section, each section's cache hash includes its text, and the joined final is reused
  only on an exact `metadata.sectionHashes` match, so an edited `segments[].text` re-synthesizes that
  section with no code change and the script recipe needs no cache-removal line.
- **UI (as built, 0445):** a Generation-tab textarea per artifact with the server-computed diff, no
  editor dependency. The editor loads `GET /api/days/<day>/artifacts/<a>` (bytes, sha, both argv
  recipes), previews and confirms through the plane, refetches the digest exactly once on success,
  and keeps the draft across a `409` with a "reload current bytes" action. Evidence:
  `apps/board/tests/daily-voice/editor.e2e.test.ts` (renders and `actions.jsonl` under
  `docs/tasks/evidence/0445/20261125/`).

## 11. Digest push notification (G85, shipped — task 0446)

**Chosen:** a single generic HTTPS webhook. Reason: one transport covers ntfy, Slack-compatible
and Telegram-bot endpoints with `fetch` alone. **Rejected:**
- SMTP, which needs credentials plus a dependency;
- macOS notifications, which reach no one when the scheduled run is headless;
- an operator-configured shell command, which is an arbitrary-exec surface in config.

- **Surface:** `kk news digest --run-date <day> --push [--trigger generate|after-generate|cn-peak|overseas-rss] [--dry-run]`.
- **Config:** `notify.digest: {enabled: false, url_env: KK_DIGEST_WEBHOOK_URL, body: markdown|json, min_status: ok|attention|failed}`
  in `~/.config/kk/config.yaml`, resolved through `resolveKkConfigPath` (`apps/cli/src/invoke.ts:52`).
  The URL lives only in the named environment variable and is redacted from every output.
- **Receipt:** `<day>/notify-receipt.<trigger>.json` `{ts, trigger, digestStatus, digestSha256, httpStatus|error, update}`.
  An unchanged sha256 skips the push. A changed one pushes with `update: true`.
- **Wiring:**
  - `kk-news-generate` gets a final `notify` node after `freeze`;
  - `kk-publish` gets a final step after `report`.
  - Both wrap the call so that it never changes the run's outcome: the push exit code is logged
    and the node itself exits 0.
- **Timeout:** 10 s, with no retry inside the run. The next trigger, or a manual `--push`, is the
  retry.

**As built (0446).** `apps/cli/src/news-digest-push.ts` owns the transport; `kk news digest --push`
is the operator surface, and the launch supervisor (`apps/cli/src/launch.ts`) calls the same module
after its terminal receipt for every generate and every publish-window launch. Two refinements the
implementation forced: plaintext `http` is accepted **only for a loopback host** (a local stub must be
possible, and those bytes never leave the machine — every other plaintext URL is refused so a token
cannot cross the wire unencrypted), and both the digest body and the receipt sha256 come from the
renderer's own bytes, so a second formatter can never drift. Evidence:
`apps/cli/tests/news-digest-push.test.ts` (loopback `Bun.serve` stub: body equality, skip-on-unchanged,
`update: true`, 500 and timeout paths, redaction) and `apps/cli/tests/launch.test.ts` (the hook on
done/failed both workflows, and a throwing push leaving the receipt byte-identical).
