---
schema_version: 1
name: "Daily AI Voice digest push: kk news digest --push webhook, receipts and workflow wiring"
status: done
template: feature-impl
created_at: 2026-11-26T01:24:35.109Z
updated_at: "2026-11-27T20:25:48.682Z"
feature_id: G85
priority: P2
tags:
  - daily-ai-voice
  - cli
  - notification
  - workflow
estimate_hours: 5

done_forced: "false"
done_reason: unforced close
---

## 0446. Daily AI Voice digest push: kk news digest --push webhook, receipts and workflow wiring

### Background

Feature G85 pushes the day digest outside the Board (design: docs/design/daily-voice-ops-console.md §11). No notification mechanism exists in the repo today (rg for osascript|smtp|sendmail|webhook across apps, packages, plugins and scripts returned no hits, 2026-11-25), so this adds one transport: an HTTPS webhook via fetch.

Depends on G83 task 0439 (`kk news digest` and DailyDigest). Do not start before it is done.

Wiring sites: kk-news-generate `freeze` node (plugins/kk/workflows/kk-news-generate.yaml:541) and kk-publish `report` node (plugins/kk/workflows/kk-publish.yaml:223). kk-news-generate.yaml carries unrelated uncommitted edits as of 2026-11-25 — preserve them. After editing stage bodies or workflows, follow the AGENTS.md install-sync procedure (rsync to the installed package, bun scripts/bundle-plugins.ts in a worktree) before any scheduled tick.

Rubric: E1 D1 L1 C1 R1 = 5 → kept as one task: the only candidate split (workflow wiring) scores ≤2 on its own and merges as a Plan step.

**Refine corrections (2026-11-25) — premises read against the current tree:**

1. **No transport exists, but the call shape has a precedent.** The only outbound HTTP in the CLI is `fetch(url, { signal: AbortSignal.timeout(30_000) })` in `apps/cli/src/publish-matrix.ts:2294`; mirror it with a 10 s bound instead of adding a client.
2. **`kk news digest` is not shipped yet** (0439; the news verb list today is `apps/cli/src/commands/content-generate.ts:5-6,1443-1470` and has no `digest`). `--push`, `--trigger` and `--dry-run` are additive flags on that verb, so implement them where 0439 put it.
3. **Both wiring targets are the last node of their workflow.** `freeze` is the final node of `kk-news-generate.yaml` (id at :541, file ends :558) and `report` the final node of `kk-publish.yaml` (id at :223, file ends :239). `freeze` is gated on the pool gate and `report` deliberately exits 1 when a required row failed (`kk-publish.yaml:225-236`), and a failed or skipped node takes its successors with it (`kk-publish.yaml:57`, the all-deps-skipped rule). So a node declared *after* those two can never push a refused day's or a failed window's digest — exactly the digest worth sending. Placement is corrected in the Plan: depend on the node before, keep declaration order after, and let the digest read the outcome files that already exist.
4. **"Always exit 0" has a platform idiom:** `onError: continue` on a shell action (`plugins/kk/workflows/kk-collect.yaml:54`, and `settle` in `kk-publish.yaml:216`), which keeps the run's outcome while the failure still shows as an action error in the trace. Prefer it to a `|| echo` wrapper.
5. **Config readers.** `resolveConfigPath` (`apps/cli/src/publish-core.ts:296-300`, documented as the ONE kk config path convention, reached via `configPath()` at `apps/cli/src/commands/content.ts:66`) and `resolveKkConfigPath` (`apps/cli/src/invoke.ts:52`) both honour `KK_CONFIG`; the content-noun path reads through `readConfig` (`commands/content.ts:71-82`). Read `notify.digest` through that loader — one YAML reader, no second.
6. **`kk-news-generate.yaml` is dirty in the working tree** (`git status`, 2026-11-25): add the node without reformatting or reordering the file, and re-read it before editing.
7. **DAG tests enumerate node ids** — `apps/cli/tests/kk-news-generate-dag.test.ts:62-80` (list ends at `freeze`) and `apps/cli/tests/kk-publish-dag.test.ts` — so both need the new node, and the first also asserts one `kk news <verb>` call per shell node (:214) and the freeze pair rule (:217-221).
8. **`KK_CONFIG` is the established test seam** (`apps/cli/tests/content-nouns.e2e.test.ts:108-165` sets it to a temp file and restores it), so the push tests never touch `~/.config/kk`.

Install note: this task edits a workflow YAML (not a stage body), so the run must still end with `bun scripts/bundle-plugins.ts` in a worktree — `apps/cli/plugins/` is a gitignored copy and the launch preflight refuses every `kk … generate` while it drifts.


**Refine corrections (2026-11-25, implement-ready pass) — supersede corrections 3, 4, 6 and 7, the "Wiring sites" paragraph and the Install note above:**

1. **A workflow node can't deliver R5; the push moves to the launcher.** In the installed engine, spur's DAG loop evaluates a node's `condition` only inside `executeNode`, after dependency gating. `condition: {kind: always}` therefore can't revive a node whose dependency was skipped: with policy `all`, a node whose dependencies were all skipped is skipped too (`~/.bun/install/global/node_modules/@gobing-ai/spur/spur.js:67641-67650`). A failed node (a shell action without `onError: continue`) also sets `stopAdmission`, and no further node is admitted (`spur.js:67728-67733`, `:67753-67756`). So the planned kk-news-generate `notify` node (`dependsOn: [safety-variants]`) would be skipped on an empty-pool day, because `safety-variants` sits behind the pool gate. It would never run when any earlier node fails. kk-publish's `plan`, `check`, `send-confirm` and `repair` have no `onError: continue` (`kk-publish.yaml` `onError` lines: 61, 120, 166, 218 only). The node design pushes only on days that need no push.
2. **The supervisor already has a hook that runs on every terminal status.** `kk news generate` and `kk news publish` both end in `launchWorkflow` (`apps/cli/src/commands/content-launch.ts:416`). Its cleanup runs after the child exits on done, no-content, failed, timeout, interrupted and paused, and isolates each step with try/catch so one failure can't skip the next (`apps/cli/src/launch.ts:725-762`). The push goes there: after `writeReceipt`, so the digest sees the terminal launch receipt, and best-effort, so a push error never changes `status` or `exitCode`. The trigger comes from the launch itself: generate → `generate`, `kk-publish` → `options.window`.
3. **No workflow YAML changes, no DAG test changes, no `bundle-plugins` step.** The CLI change still needs the `apps/cli/dist` copy into the installed package before scheduled jobs see it (AGENTS.md "Editing apps/cli / packages").
4. **`apps/cli/src/launch.ts` is dirty in the working tree** (an uncommitted `pausedAt` HITL-pause branch, `git diff`, 2026-11-25). Add the hook without disturbing that edit, and re-read the file before editing.
5. **Estimate unchanged at 5 h.** Two YAML nodes and their DAG-test updates are swapped for one launcher hook and its `launch.test.ts` cases.

### Requirements

- [x] R1. `kk news digest --run-date <day> --push [--trigger generate|after-generate|cn-peak|overseas-rss]` POSTs the digest (markdown by default, JSON when `notify.digest.body: json`) with status, attention count and a Board deep link first, to the URL read from the env var named by `notify.digest.url_env`; 10 s timeout, no in-run retry.
- [x] R2. Config `notify.digest {enabled (default false), url_env, body, min_status}` is read through `resolveKkConfigPath` / `configPath()` (both honour `KK_CONFIG`; `apps/cli/src/invoke.ts:52`, `apps/cli/src/publish-core.ts:296-300`) via the existing `readConfig` loader; disabled, missing key or unset env var → nothing sent, nonzero exit naming the missing setting; a digest below `min_status` is skipped with exit 0 and a log line.
- [x] R3. `<day>/notify-receipt.<trigger>.json` records {ts, trigger, digestStatus, digestSha256, httpStatus|error, update}; an unchanged sha256 skips the POST and reports the earlier receipt; a changed one posts with `update: true`.
- [x] R4. The URL (and any token in it) never appears in stdout, stderr, receipt, logs or config.yaml; `--dry-run` prints the body and the target host only and writes nothing.
- [x] R5. The launch supervisor (`launchWorkflow`, `apps/cli/src/launch.ts`) pushes the digest best-effort after writing its terminal receipt for every kk-news-generate launch (trigger `generate`) and every kk-publish window launch (trigger = the window). This covers done, no-content, failed, timeout and interrupted runs, so refused days and failed windows still push. A push error or refusal is logged and never changes the launch status, exit code or receipt.
- [x] R6. docs/04_DESIGN.md documents `--push`, `--trigger`, `--dry-run` and the `notify.digest` key in the same commit.

### Acceptance Criteria

- [x] AC1 — The digest is pushed to the configured webhook (req: R1)
- [x] AC2 — Pushing is off by default and keeps the URL out of config and the repo (req: R2; R4)
- [x] AC3 — A failed push never fails the run (req: R5)
- [x] AC4 — Each trigger pushes at most once per unchanged digest (req: R3)
- [x] AC5 — The push is wired after generation and after each publish window (req: R5)
- [x] AC6 — A dry run shows the exact body without sending (req: R4)

AC1/AC4/AC6 run against a `Bun.serve` stub: the received bytes equal the digest renderer's output, a second run with the same digest sends nothing and reports the first receipt, a changed digest sends with `update: true`, and `--dry-run` prints the body and host with nothing sent and no receipt written. AC2 asserts the default-off path, each missing-setting exit, and that the URL string appears in no stdout, stderr, receipt or config fixture. AC3/AC5 are `launch.test.ts` assertions through the existing `LaunchDeps` seams. A generate launch and a kk-publish launch each invoke the injected push with the right trigger (`generate`; the window name) on the done, failed, no-content and timeout paths. A push that throws, or whose stub returns 500, leaves the launch receipt's `status` and `exitCode` byte-identical to the no-push run. R6 is the doc diff in the same commit as the flags.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Chosen: one generic HTTPS webhook via fetch — covers ntfy, Slack-compatible and Telegram-bot endpoints with no dependency. Rejected: SMTP (credentials + dependency), macOS notification (headless scheduled runs reach no one), operator-configured shell command (arbitrary-exec surface in config).

**Frozen:**

- **Module.** `apps/cli/src/news-digest-push.ts` exports `pushDigest(options)` with injected `{fs, env, config, fetch, now}` so the stub server and the clock are test seams, plus `receiptPath(workDir, trigger)`. The digest body comes from 0439's renderer — no second formatter. The deep link is whatever 0439's digest already emits; if it emits none, the prefix carries status and attention count only rather than a hardcoded host.
- **`--trigger`** defaults to `generate` when a manual `--push` omits it (the receipt is per trigger, so a manual push after a window should pass that window's name and not share the generate receipt).
- **Refusal / outcome codes:** `notify.digest.disabled`, `notify.digest.url-env.missing`, `notify.digest.url-env.unset`, `notify.digest.url.not-https`, `notify.digest.min-status.skipped` (exit 0), `notify.digest.http` (carries status), `notify.digest.timeout`. Non-HTTPS is refused outright so a plaintext token cannot leak.
- **Order:** render → threshold (`ok < attention < failed`, so `min_status` is a floor) → receipt read → sha256 over the exact posted bytes → skip-if-equal → POST (`AbortSignal.timeout(10_000)`) → receipt write (atomic, same-directory temp + rename as `apps/cli/src/board/capture.ts:155-160`).
- **Redaction.** Only `new URL(url).host` is ever printed; the env var *name* may be logged, never its value; the receipt records the HTTP status or the error message with any URL stripped. `--dry-run` prints the body and host and writes no receipt.
- **Trigger site — the launch supervisor (Background refine 2026-11-25 #1–2).** `LaunchDeps` gains `pushDigest(input: {workflow, workDir, runDate, trigger}) => Promise<void>`, wired to `news-digest-push.ts` in the default deps. `launchWorkflow` calls it after `writeReceipt(...)` and before returning, inside its own try/catch. A throw or refusal goes to stderr as one line (code + host only) and to the notify receipt, never into the launch receipt, `status` or `exitCode`. Trigger: `options.workflow === PUBLISH_WORKFLOW ? options.window : 'generate'`. A launch with `enabled: false` returns at the config read with no log noise. No workflow node is added: a DAG node is skipped or never admitted on exactly the refused and failed days R5 targets (`spur.js:67641-67650`, `:67728-67733`).
- **Tests.** `Bun.serve` stub endpoint asserting method, headers, exact body bytes and the receipt file; a second stub returning 500 and a third that never answers (timeout path with an injected short timeout); `launch.test.ts` cases for the hook on done / failed / no-content / timeout, for both workflows, including a throwing `pushDigest` that leaves the receipt unchanged.

Rejected: retrying inside the run (the next window or a manual `--push` is the retry, and a retry loop can outlive the node); per-day global dedupe instead of per-trigger (a window push must not suppress the next window's); storing the URL in config; a second digest formatter.

**Anti-patterns:** URL or token in argv, logs, receipt or error text; pushing before the receipt check; writing a receipt for a dry run; a push that can change the launch status or exit code; a push before the launch receipt is written.

**Depends on:** 0439 (`kk news digest`, `DailyDigest`, the Board deep link).

### Plan

- Failure list before code: disabled, missing key, unset env var, non-HTTPS URL, timeout, 4xx, 5xx, unchanged digest, below `min_status`, dry run, receipt write failure, push throwing inside the launcher.
- Implement `apps/cli/src/news-digest-push.ts` and the three flags on 0439's `kk news digest`; E2E against a `Bun.serve` stub asserting body, receipt, skip-on-unchanged and update-on-changed, plus a redaction assertion that the URL never appears in stdout/stderr/receipt.
- Prove the config seam with `KK_CONFIG` pointing at a temp file (`apps/cli/tests/content-nouns.e2e.test.ts:108-165` pattern); no test writes `~/.config/kk`.
- Add the `pushDigest` seam to `LaunchDeps` and the post-`writeReceipt` call in `launchWorkflow` (`apps/cli/src/launch.ts`), preserving the working tree's uncommitted `pausedAt` edit; extend `apps/cli/tests/launch.test.ts` for both workflows, the four exit paths and the throwing-push case.
- Document `--push`/`--trigger`/`--dry-run` and the `notify.digest` block in `docs/04_DESIGN.md` (news verb surface near :1473-1494), note the launcher hook in satellite §11 and update its status.
- `bun run gate`, then copy `apps/cli/dist/index.js` into the installed package (AGENTS.md "Editing apps/cli / packages") before any scheduled tick.

### Solution

| File | Lines | What / why |
| --- | --- | --- |
| `apps/cli/src/news-digest-push.ts` | 1-345 | The transport: `pushDigest` (render → enabled → URL variable → scheme → floor → receipt read → sha256 → skip-if-equal → POST with a 10 s `AbortSignal.timeout` → atomic receipt), `digestPushBody` (the renderer's own bytes behind a status/attention prefix — the digest emits no Board link, so no host is hardcoded), the closed code vocabulary, and `digestPushForLaunch` as the launcher's binding. Only `new URL(url).host` is ever printed; an error message is redacted of both the URL and its host before it reaches a receipt. |
| `apps/cli/src/news-digest-push.ts` (scheme rule) | 226-238 | Plaintext `http` is accepted **only for a loopback host**. A blanket https-only rule made the transport untestable (no stub can hold a certificate), and loopback bytes never leave the machine, so the token guarantee holds while the stub stays possible. Every other plaintext URL is refused. |
| `apps/cli/src/commands/content.ts` | 493-505, 597-640 | `--push`, `--trigger`, `--dry-run` on `kk news digest`, plus `pushAction`: the digest prints first, then one line reports the outcome (code + host only). `--dry-run` prints the body and the host and writes nothing. |
| `apps/cli/src/launch.ts` | 133-141, 776-800, 470-480 | `LaunchDeps.pushDigest` and the call after `writeReceipt` for every outcome, inside its own try/catch: a throw becomes one stderr line and can never change `status`, `exitCode` or the receipt. Trigger is the window for `kk-publish`, `generate` otherwise. |
| `apps/cli/tests/news-digest-push.test.ts` | 1-420 | The loopback `Bun.serve` stub: body equality with the renderer, JSON body, skip-on-unchanged with the earlier receipt, `update: true` on a changed digest, disabled/unset/non-loopback-plaintext refusals, floor skip, dry run writing nothing, 500 and timeout paths, redaction of the token from receipt/line/outcome, and the launch binding on both workflows. |
| `apps/cli/tests/launch.test.ts` | 53-70, 175-200, 226-300 | The hook through the existing `LaunchDeps` seam: one push after the receipt with the `generate` trigger, the window name for `kk-publish`, a failed run still pushing, and a throwing push leaving the receipt byte-identical. |
| `docs/04_DESIGN.md` | 1535-1537, 1590-1613 | The three flags in the verb surface and the full `notify.digest` contract: order, floor semantics, receipt fields, closed codes, redaction, dry run, and the launcher hook. |
| `docs/05_FEATURES.md` | 118 | The G85 row (new) → done. |
| `docs/design/daily-voice-ops-console.md` | 10, 268-285 | §11 marked shipped; the two refinements the implementation forced (loopback-only plaintext, renderer-derived body and sha) plus the evidence paths. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/tests/news-digest-push.test.ts:132` verifies both loopback POST formats, status, attention and the relative Board link. |
| R2 | MET | `apps/cli/tests/news-digest-push.test.ts:261` covers disabled, missing config, unset URL and status floor. |
| R3 | MET | `apps/cli/tests/news-digest-push.test.ts:112` proves concurrent identical deliveries result in one POST. Receipt and changed-content cases at `apps/cli/tests/news-digest-push.test.ts:187`. |
| R4 | MET | `apps/cli/tests/news-digest-push.test.ts:358` proves URL fragments stay out of receipts and redirects are refused. Dry run asserts no receipt or network send at `apps/cli/tests/news-digest-push.test.ts:400`. |
| R5 | MET | `apps/cli/tests/launch.test.ts:249` checks generate and publish-window triggers after the receipt and unchanged launch outcomes on push failure. |
| R6 | MET | `docs/04_DESIGN.md:1600` records configuration, webhook layout and delivery options. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — The digest is pushed to the configured webhook | MET | test | `apps/cli/tests/news-digest-push.test.ts:132` verifies the exact POST body against a loopback endpoint. |
| R2 — Pushing is off by default and keeps the URL out of config and the repo | MET | test | `apps/cli/tests/news-digest-push.test.ts:261` and `apps/cli/tests/news-digest-push.test.ts:358` verify configuration and error handling. |
| R3 — A failed push never fails the run | MET | test | `apps/cli/tests/launch.test.ts:302` checks the launch result and receipt across a failed push. |
| R4 — Each trigger pushes at most once per unchanged digest | MET | test | `apps/cli/tests/news-digest-push.test.ts:112` and `apps/cli/tests/news-digest-push.test.ts:187` verify concurrent and sequential deduplication. |
| R5 — The push is wired after generation and after each publish window | MET | test | `apps/cli/tests/launch.test.ts:249` checks both triggers after the launch receipt. |
| R6 — A dry run shows the exact body without sending | MET | test | `apps/cli/tests/news-digest-push.test.ts:400` exercises the dry-run body, transport seam and receipt. |
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

- 2026-11-27T18:18:22.889Z todo → wip (system)
- 2026-11-27T18:24:04.459Z wip → testing (system)
- 2026-11-27T18:24:06.699Z testing → done (system)

