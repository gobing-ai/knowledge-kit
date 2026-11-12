## 2026-10-19 — task 0317 (decision makers) pitfalls
- `spur workflow commit-guard stage` treats every `.spur/` path as bookkeeping and refuses it as "unchanged since base" — a tracked config edit (e.g. `.spur/config.yaml` comments) must be staged separately with an explicit `git add <path>` inside the worktree, or it dies with the tree.
- `spur task update --section Q&A --from-file` APPENDS a fresh `#### Q&A entry` heading; it cannot replace or remove an entry. Passing a body that already contains entry headings multiplies them. Pass one complete body per write, or collapse duplicates with a single targeted edit and then re-verify with `spur task check`.
- The review answer lint wants bare requirement IDs (`| R1 |`) but the FULL scenario title in AC rows, including the `(req: R1)` suffix — a shortened title fails as "matches no task AC checklist label".
- `spur task residual <wbs> review-gate` requires a `Confidence:` line inside the task's `## Review` and recomputes it from the FINDINGS, while `spur task verdict --from-answer` derives it from AC-row evidence; an N/A AC row (unmet upstream precondition) makes them disagree (MEDIUM vs HIGH). State both levels with the reason rather than contorting one to satisfy the other.
- A `--worktree` run's branch can fall behind `main` when another session commits mid-run: FF-merge then fails. Rebase the branch inside the worktree (`GIT_EDITOR=true git rebase main`), resolve conflicts, re-run the gate, then `git merge --ff-only --no-edit`. Board/browser suites failing on a rebase are usually the OTHER session's in-flight work — reproduce them on `main` before treating them as regressions.

## 2026-09-22 — F41 batch (0149–0154) pitfalls
- Digest exclusion regex fragility: 0149's proof-digest v1 stripped `/^## Review/,$d` but the task file used `### Review` — the canonical review block leaked into the digest and verify-entry compared unequal despite zero real proof-input change. Match heading level (or use `^#+ Review`) before declaring a digest mismatch a tamper signal.
- Per-file coverage perfectionism inside the implement budget kills the attempt: 0150 died mid-way writing in-process coverage-branch tests chasing ~80% function coverage on one file while the actual gate is AGGREGATE >=90% line+function (bunfig.toml). Chase the aggregate, never per-file 100%.
- Verifier under-citation is the commonest post-verify correction (0151 AC1/AC7): an honest verifier writes prose-but-no-evidenceType and the evidence rule rejects the answer file; budget for a mechanical AC-table completion + digest re-stamp after verify.
- fanin/runInvoke wall-time asserts flake under full-suite parallel load (0152): a failing `apps/cli/tests/fanin.test.ts` in the full run is not automatically a regression — run it isolated; if 27/27 green, log as load flake and move on instead of "fixing" timing asserts.
- Continuation briefs must correct the predecessor's stale claims explicitly: 0151's attempt-1 last words claimed 2 lint errors were "pre-existing 0149 debt" when the tree was lint-green at 0150 done; the continuation brief called this out and forced a root-cause fix instead of suppression.
## 2026-10-02 kk-daily-ai-voice
- (CORRECTED 2026-10-02 14:00) The earlier "script-write prompt-only compliance fails 3/3" entry was WRONG: mtime + state-table forensics show script-write only ran ONCE today (06:00 cron, OLD contract, deepseek). Both post-noon "non-compliance" observations were the F613 resume guard replaying the morning's stale `08_script-write_plan.json`/`voicescript.yaml` (guard: `test ! -f` both files; fallback edge `-> script` always wins when they exist). The new excluded contract has ZERO E2E trials; its compliance is UNPROVEN either way. Real defect: gate-FAIL leaves rejected artifacts in place, so same-day re-runs re-judge stale content forever. Rejected script artifacts must be quarantined (or the fail path must clear downstream artifacts) before any re-run.
- LLM prompt-compliance risk for per-doc transcription stages (script-write) is a HYPOTHESIS, not an observed failure: only 1 old-contract trial exists. Verify with a clean re-run before building the deterministic pre-filter.
- spur agent escalation on resource-exhaustion climbs TIERS (standard→capable-1), never sideways within a tier; capable-1 starts at agy-gemini which has no headless spawn attestation and auto-denies command permissions — it survives only when it happens to use file tools. Volc (pi-dsv4.1-flash-volc) exhausted ~12:00 PDT daily; cron LLM stages after noon ride agy-gemini.
- `spur agent usage` hangs minutes on provider capture; use `spur agent doctor <name> --json` (fast) for usability checks.

## 2026-10-05 — publishing-channel dogfood pitfalls
- Do NOT route the channel drafts off a non-publishing run. `publish_enabled=false` is an invariant-covered terminal: `quality-control` -> `done`, exactly two non-failed edges, no publish-plugin call — asserted at apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:729-736 (0140 Branch A). A `quality-control -> xhs-write` draft edge (attempted 2026-10-05) breaks that assertion and silently adds image generation + channel publishing to every default daily run; it was reverted. The supported way to get channel drafts is `publish_enabled=true` with `xhs_live=false` / `wechat_live=false`.
- The MP 草稿箱 cards are on the console HOME (`cgi-bin/home?t=home/index`) as `div.weui-desktop-card.weui-desktop-publish` under `div.publish_card_container`; the route the 草稿箱 entry links to (`t=media/appmsg_list&action=list_card`) renders NO draft rows, and the console has no iframes at all (authenticated probe 2026-10-05). Read the signal on home. An unauthenticated probe is blind — mp.weixin.qq.com grant cookies die on restart, so replay the state's cookies AND its localStorage or you are testing a login page (see the 19:34 wechatmp-drafts.png of nothing).
- `kk stage` and packaged `kk executor run` load `apps/cli/plugins/**`, not `plugins/**`: run `bun scripts/bundle-plugins.ts` after every `plugins/**` edit or you dogfood stale code.
- Both channels' `一键排版` applies the layout directly — one button, not an option menu. Requiring an option (保留源格式/匹配目标格式/仅保留文本) fails real drafts on both channels.
- MP session state needs BOTH halves: cookies AND the state's `origins` localStorage. Replaying only cookies lands on a login page, which reads as a hang rather than an auth failure.

## 2026-10-07 — operator logins for browser channels (0193/0194)
- Google OAuth ("This browser or app may not be secure") refuses vanilla Playwright Chromium. Any operator-login script MUST use the stealth launch: `args: ['--disable-blink-features=AutomationControlled']`, `ignoreDefaultArgs: ['--enable-automation']`, and `ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }))` (docs/design/x-article-ui-discovery.md:12-15, substack-ui-discovery.md:15-18). Working scripts: `.spur/run/discovery/login-x3.ts` (X, verified 2026-10-07), `.spur/run/discovery/login-substack-0193.ts` (Substack, stealth added 2026-10-07).
- The plugins' own `profile-check.ts login` CANNOT pass Google OAuth: `@gobing-ai/ts-browser-automation@0.5.15` `src/launcher.ts:114` calls `launchPersistentContext(profileDir, { headless })` with no launch options. Until that library takes launch options, do operator logins with the stealth scripts above, then verify with the plugin's `profile-check.ts check`.
- A successful raw login does not mean the plugin's `check` passes. On 2026-10-07 both x and substack `check` refused right after an authenticated login on the same profile, so the plugin's readiness predicate and URLs have drifted (substack `editorUrl()` `/publish/post/new` → 404; the live editor is `/publish/post`). Fix that drift in 0193/0194 R2 rather than repeating the login.
- Substack publication URL is the root `https://robinmin.substack.com`; the Dashboard URL `…/publish/home` is rejected by `resolvePublicationUrl`.
- Substack + Google OAuth still refused under the stealth launch on 2026-10-07, while X + Google passed with the same flags. Substack's sign-in page offers email/password and email-link login, which avoid Google entirely. Last resort: `login-substack-0193.ts --chrome` (installed Chrome via `channel: 'chrome'`; Playwright's `--use-mock-keychain` keeps its cookies readable by bundled Chromium, unverified).
- (CORRECTION 2026-10-07 11:00, ROOT CAUSE) The "plugin check refuses right after a successful login" failures on x and substack are NOT mainly selector drift. Playwright 1.55 runs HEADED on `chromium-1187` and HEADLESS on `chromium_headless_shell-1187`, and neither can read cookies the other wrote. Opening a profile in the other mode loses them: the substack Cookies DB went to 0 rows. Repro on a throwaway profile, `.spur/run/discovery/cookie-persist-repro2.ts`: headed→headed and headless→headless keep the cookie, headed→headless and headless→headed lose it. With `channel: 'chromium'` (full binary in new-headless mode) both cross directions keep it (`cookie-persist-repro3.ts`). So an operator's headed login is erased by any headless `check`/preflight. infoq works only because it is headed-only. The earlier "45 s flush" hypothesis was falsified. Fix seam: publish-harness `BrowserLauncher` / `createPersistentLauncher({ loadPlaywright })` in `@gobing-ai/ts-browser-automation`; inject `channel: 'chromium'` plus the stealth args there.
- (2026-10-07, FIXED by 0214) The plugin login and check now go through `kkBrowserLauncher` (`@gobing-ai/publish-harness/browser`): `channel: 'chromium'` plus stealth, so headed login → headless check shares cookies and Google OAuth works. Set `KK_BROWSER_CHANNEL=chrome` to use installed Chrome. The discovery login scripts are no longer needed; use each plugin's `profile-check.ts login`. Regression: `cd packages/publish-harness && bun run e2e:launcher`. Profiles touched by mismatched-mode reopens (substack, x) need one fresh login.
- (2026-10-07, FIXED) `kk` ran stale stage/skill code all day: the `~/.bun/bin/kk` bin symlink pointed at a plain-copy install `~/node_modules/@gobing-ai/knowledge-kit` (0.0.32, own `plugins/` copy), while `~/.bun/install/global/node_modules/@gobing-ai/knowledge-kit` was correctly bun-linked to the repo. `resolveStagesScript` prefers `fromPkg` (argv1's package root) over the checkout unless the entry is the repo's own apps/cli — so repo edits to `plugins/kk/scripts|skills` never reach the installed binary until refreshed. Symptom: the narrowed daily-safety-gate classified `escalate` at 13:11 while unit tests proved `exclude`. Fix: `bun link` in `apps/cli` (the binary's own INSTALL_GUIDANCE) — then checkoutEntry engages and stages load from live checkout source. Verify with `readlink -f $(which kk)` → must resolve under the checkout, plus a scratch-copy gate probe. Any claim that "kk loads repo edits live" is only true under the checkout-linked entry.

## 2026-10-07 — task 0217 run
- **Per-tree provenance**: a `--worktree` pipeline run's provenance DB lives in the worktree; `--persist-out` copies only `.spur/run/*` artifacts, NOT `.spur/memory/runs/*.state.json`. Deleting the worktree orphans the run — re-link from the invoking tree with `spur task run-link <wbs> --run-id <id>` BEFORE it's needed by a done-gate.
- **BSD sed has no `\U`**: `$(echo $s | sed 's/^./\U&/')` emits the lowercase letter unchanged → `spur task update --section solution` fails silently when stdout is swallowed. Spell section names out.
- **Parallel-session collisions**: main can absorb the same task's substance while your run executes (here: 4 commits incl. an equivalent-or-superset store-docs fix). Cheap detector: `git merge --ff-only` refusal + `git merge-tree <base> main <branch> | grep -c '<<<<<<<'`. When main holds the superset, drop the branch — never merge a subset over it.
## 2026-10-08 · task 0212
- Do NOT rely on the `/tmp` PATH shim across sessions (tmp cleanup purged it) — global `kk` resolves to the main repo build; recreate the shim or run stages via the source entry.
- Engine PIDs killed via `kill` leave orphaned `kk stage` bun processes holding the voicebox single-job slot (0224). Kill the stage child PIDs too, then `spur workflow clean --json`.
- Foreground `timeout=3000` killed the engine mid-run once (orphan e9ad943d) — always launch long workflows detached (nohup + disown) and poll.
- Gemini TTS probe passes then the first real segment 429s on the weekly quota (~21h horizon) — probe is not admission proof (0223).

## 2026-10-13 — the full gate is load-sensitive (task 0274)

- The intermittent `bun test apps` red-on-unchanged-tree incidents were timing-test design, not a
  proven module-store race: no concurrent writer into `node_modules/.bun` was ever established (the
  ts-utils dependency path stayed a regular file), so do not cite the "shared-store writer" theory.
- Shipped workaround (commit `741a0cb5`, current shape): stage AC4 no longer runs `Bun.build`
  in-process — `apps/cli/tests/commands/stage.test.ts` builds in a fresh child. Do not re-add an
  in-process `Bun.build` there.
- Remaining hazard class: wall-clock assertions that only fail under full-suite load (the fanin
  elapsed ceiling; an override test racing a fast sibling inside a tight global budget — same class
  as the fanout pair `fefd9808` hardened). Task 0274 replaced the fanin policy cases with
  dispatch/budget assertions at `spyOn(invoke, 'spawnPluginEntryAsync')` and kept the real-spawn
  ingestion and stuck-source kill tests. Verify with `bun test --dots --timeout 20000
  apps/cli/tests/fanin.test.ts apps/cli/tests/commands/stage.test.ts` (42 pass, 0 fail, exit 0 on
  Bun 1.4.3 after the 0274 rework; a partial-run exit 1 is coverage, not an assertion failure).
  Limitation: a green isolated run does not prove a full-suite flake is eliminated — behavior
  assertions plus the normal full gate, not repeated-run rituals, are the evidence.
- Before blaming your own change for a red gate, run the failing file alone. If it passes alone,
  you are looking at this class, not at a regression.

## 2026-10-13 — `history-refresh` deadline kills (root cause; NOT a DB/CLI version skew)

- **The schema-version mismatch theory is false.** `__spur_cli_migrations` holds all 54 migrations
  through `0053_spur_cli_inbox_messages_read_at`, and `importer_schema@0.5.24` matches the installed
  bundle's `HISTORY_IMPORT_SCHEMA_VERSION = "0.5.24"`. The 320 `History schema version mismatch`
  failures are historical (2026-09-12…10-09) and already self-healed. `spur --version` printing 0.4.3
  while the bundle carries 0.5.24 is a stale `version` in the published `package.json` — cosmetic.
- **Every current failure is the 600 s default job budget exceeded.** In 489 failures the recorded
  duration is 601–642 s and the error is always `timed out after 600000ms`. Measured 2026-10-13 on
  this corpus: `history import` 68 s (no-op tick) → 310 s (backlog), `history analyze` 60 s with
  `--since 1h` vs **1124 s** over all history. The history-wide part of analyze is what grows with
  the corpus (3.4 M messages, 8.4 GiB DB), so a 10-min tick no longer fits a 600 s cap. Fix applied:
  `cron: "*/30 7-23 * * *"` + `timeoutMs: 3600000` (raised from a first attempt at 2400000 after
  the 16:30 tick overran it under load 32), and `history-daily-report` `timeoutMs: 7200000`
  (all 33 of its runs had died inside the first stage).
- **A tick longer than the cron period is not just slow** — the following tick is silently
  suppressed (the `queue_jobs_history_refresh_active_unique` index and/or the in-process duplicate
  guard; no event is emitted either way): 8 jobs ran for 12 ticks between 13:40 and 16:10. Cadence must exceed the measured chain, not the intended one.
- **Scheduler jobs register at `spur serve` boot.** A `.spur/config.yaml` scheduler edit does
  nothing until the server restarts; `Scheduler entries registered` in `.spur/logs/spur.log` is the
  only proof it took effect.
- **A per-source budget equal to the chain budget aborts the chain.** `--source-timeout` also
  defaults to 600000, and on a source timeout `history import` throws
  `remaining sources not started` — one slow source ends the run, it is not isolated.
- **Do not run `history import` next to the scheduled tick.** Two overlapping imports collide in
  `history_import_ledger` (its batch INSERT lacked `ON CONFLICT(record_hash) DO NOTHING`); the loser
  drops the whole `pi` source (2967 MB) with `UNIQUE constraint failed` and exits 2. Patched in
  `@gobing-ai/ts-llm-jsonl-importer` (`src/jsonl-importer-dao.ts` `ledgerInsertOp` + `insertLedger`)
  plus two regression tests in `tests/jsonl-importer-dao.test.ts`.
- **Retention has not run since 2026-09-07.** `runRetention` (queue_jobs 30 d, ledger 180 d,
  rule_eval_runs 90 d, 7-day-gated VACUUM) is reachable only from `HistoryService.daily`, but both
  cron chains call `history import` + `history analyze` explicitly, so `spur_retention_meta.compaction`
  is frozen and `.spur/spur.db` (8.4 GiB, 4.3 M ledger rows) grows unbounded.
- Open upstream defect: `history analyze` cost scales with total history because the rollup
  derivations include full-corpus re-derivations (`recomputeRankedSteps` → `topStepsByTokens`
  /`topStepsByDuration`/`topCacheWasteSteps` over `ALL_HISTORY`, spur `history-board-rollup.ts:2040`)
  and the un-watermarked analyzer queries (`sessionWatermarks`, `sourceSummary`, `pairingSummary`,
  `bySession`). `refreshHistoryRollups` also runs twice per tick (import tail + analyze tail).

### Confidence verification (2026-10-13, same session)

- **[HIGH] The schema-skew theory is dead, not merely unlikely.** `spur --no-logo self migrate --json`
  → `{"ok":true,"applied":0}`: no pending migration. `__spur_cli_migrations` holds 79 rows through
  `0053_spur_cli_inbox_messages_read_at`, and `importer_schema@0.5.24` equals the installed bundle's
  `HISTORY_IMPORT_SCHEMA_VERSION` (`spur.js:44599`).
- **[HIGH] Every Oct 12–13 failure is the job deadline.** All 489 `failed` rows' error text on those
  days is `timed out after 600000ms`, durations 601–642 s; the 320 earlier `History schema version
  mismatch` and 25 `spur: command not found` failures are Sept 12 – Oct 9 only.
- **[HIGH] The measured stage costs.** Own timed runs: `history import` 68 s (no-op) / 310 s
  (backlog) / ~1080 s (load 32); `history analyze` 60 s with `--since 1h` vs 1124 s over all history.
- **[HIGH] The cost sits in analyze's history-wide portion** — the only difference between the 60 s
  and 1124 s runs was the selector, and the source confirms un-watermarked queries plus
  `recomputeRankedSteps` over `ALL_HISTORY` (`spur-new/packages/domain/src/analytics/history-board-rollup.ts:2040`).
- **[LOW] WHICH query dominates is unresolved.** My own sqlite3 timings for `sessionWatermarks`
  (10 s) and `sourceSummary` (1 s) are fast enough to contradict the naive blame on those two; no
  per-query isolation was done. Do not patch these by guesswork.
- **[HIGH] `refreshHistoryRollups` runs twice per tick**: `history-service.ts:1042` (inside `analyze`)
  and `:1165` (tail of `importAll`); the import JSON reports 20–25 s per call.
- **[HIGH] The importer commits one transaction per JSONL line**: `await options.db.batch(ops)` sits
  inside the per-line loop (`ts-libs/packages/llm-jsonl-importer/src/importer.ts:637`).
- **[MEDIUM] That per-line commit is what made the loaded import 18 min long.** Consistent with
  ~2700 rows / ~1080 s ≈ 0.4 s per commit under load 32, but no commit/fsync counter was measured —
  I/O contention from the parallel agent batches is an equally good explanation.
- **[HIGH observable / MEDIUM mechanism] Ticks are dropped while one is in flight.** The 14:20, 14:50,
  15:10, 15:30 and 15:50 ticks have no `queue_jobs` row while the preceding job was still running.
  The partial unique index exists, and the in-process duplicate handler *should* emit a
  `scheduler.job.executed` event — but **zero** such events carry `skipped`/`duplicate`/`exclusive`
  text, so no log proves which suppression path fired. That gap is worth reporting upstream too.
- **[HIGH] The ledger `ON CONFLICT` defect drops a whole source.** Reproduced live: `pi: failed`,
  `source-failed: UNIQUE constraint failed: history_import_ledger.record_hash`, exit 2; the two
  regression tests fail before the fix and pass after (23/23 in that file, 403/403 in the package).
- **[HIGH] Row-purge retention is reachable only from `HistoryService.daily`** — `runRetention` has
  exactly one call site, `history-service.ts:1236` inside `daily()` — and has not run since
  2026-09-07 14:14 (`spur_retention_meta` holds only `compaction`). The weekly
  `database-weekly-maintenance` VACUUM is a separate path and does still run.
- **[HIGH] `history-daily-report` has never succeeded** (33/33 `failed`).
- **[HIGH] The fix works**: the 17:30 tick is `completed` at 518.6 s, wrote its artifact at 17:38, and
  advanced the rollup watermark to `2026-10-14T00:32:41Z`. Re-verified 19:49: **5 consecutive
  completed ticks** (17:30→19:30, 333–519 s, ~9–14% of the 3600 s budget), 0 failures since.
- **[LOW] The nightly job's new 2 h budget is sufficient** — it cannot be exercised before 05:03, and
  its workflow stage has never executed from that job.
- **[MEDIUM] Concurrent load is the variance driver.** 518.6 s at load 8.4 vs >2400 s at load 32, one
  uncontrolled observation each; the quiet-machine baseline (300–480 s) comes from the 12:40–14:30
  successful ticks.
## A22 batch (0275–0278), 2026-10-14

- **Do not diagnose an executor-shaped test failure as a code regression before checking the executor
  table.** `resolveExecutor` refuses a bare agent name that matches a *disabled* executor profile
  (`agent.executors.<name>.disabled`) **before** PATH resolution, so a test that stubs an agent as
  `claude` fails the moment a quota guard disables that profile globally. Reproduce on the clean base tree
  (stash the task's diff) to separate environment from regression — that stashed run is what proved task
  0277 was innocent.
- **Provider availability changes mid-batch.** In one session `claude` (quota guard), `openai` (OAuth
  `invalid_grant`), `opencode` (no subscription), `zai` (5-hour cap), `zai-cn` (plan expired) and
  `openai-codex` (usage limit) all became unusable. Check `~/.config/spur/config.yaml` disabled entries,
  `~/.config/spur/agent-usage.json` (`resetsAt`) and the model registry before burning dispatches; a
  rejected subagent model returns the valid choices, and models-store ids are not all routable
  (OpenRouter 404s on store-only slugs).
- **`rg` no-match exits 1** and a compound `echo … && rg …` chain whose last command exits nonzero is
  reported by the subagent harness as a *mutating tool failure*; repeats escalate to an "attention"
  event. Append `|| true` to audit sweeps and keep them short.
- **`inline-run-setup.mjs --file` wants the workflow DEFINITION** (`task-pipeline.yaml`), never the task
  markdown — passing a task file dies with `Source contains multiple documents`.
- **`.gitignore` anchors ignore rules at the repo root**, so `-g` exclusions in `rg` are more reliable than
  assuming a gitignored path (e.g. `apps/cli/plugins/`) is skipped.
- **Headless agy can NEVER write the workspace via shell — only via file tools.** With
  `enableTerminalSandbox: true` (set by agy's own v2 migration), `permissions.allow` `command(x)`
  rules are promptless-but-SANDBOXED; legacy `unsandboxed(x)` rules are dead syntax (unmatched →
  soft-deny "headless mode cannot prompt"). A producer that assembles output via
  `python3`/`cp` passes all its checks then dies at the workspace write (EPERM /
  SANDBOX_COMMAND_BLOCKED) and exits 0 with zero output — the 20261015 04:30 kk-daily-ai-voice
  failure. /tmp writes are allowed; workspace writes are not. Settings-side fixes are exhausted;
  prompt-side ("Deliver with your file-write tool") plus an engine-side JSON-validity condition
  gate (array + length == candidates docs + all objects) is the durable shape — see
  kk-daily-ai-voice2.yaml plan-translate (0238 R2 extended from existence to validity).
- **`allowAppend: false` does not stop an executor's staged-write hack.** A pi token-cap
  "single write exceeded the output cap" produced `[...4 items, "@@SPLIT-1@@"]` in the plan file —
  executor-side write policies don't enforce JSON shape, so only a condition-level validity gate
  catches contract-violating producer output (20261015 recovery run c71f8c8b, killed mid-flight).
- **`dailyScript` caches on file existence** (`if (isFile(yamlOut))` → skip), and the budget fitter only
  trims (it returns early when the script is under budget, never expands). Changing `vdriver` therefore
  does not rewrite an existing `24-script/<date>_08_script_voicescript.yaml`, and a resume after a driver
  or rate change silently reuses the old text — wipe the artifact when a genuine rebuild is required.
- **Failed engine runs keep holding their store selections.** The next `kk daily prepare` then fails with
  `kk.daily.prepare.unreleased-run` for every dead run (the engine only surfaces "exited with 1"), so the
  workflow cannot start again until each one is freed with `kk store release --run <id>`.
- **Stage scripts execute from the installed package, not the checkout.** `kk stage` loads
  `plugins/kk/scripts/daily-stages.ts` relative to the running `kk` (the bun-global package under
  `~/node_modules/@gobing-ai/knowledge-kit/`); editing only the repo copy leaves the live run on the old
  code. Copy the file after every change.
- **A per-request random speaker reads as "unstable quality", not as a config bug.** Removing a
  voice identity never fails loudly: the render succeeds, QC passes (loudness only), the duration
  gate passes, and every publish reports success — the defect is only audible. Any change to a voice
  profile's `mode` or registry must be followed by the F0-spread audit before the episode ships.

## 2026-10-16 — seo-judge decision-parameter contract
- **An undeclared `--param` is an input rejection, and the judge stage logged it as a fallback.** Spur's
  catalog loader makes every declared parameter without a `default` required (`normalizeParam`:
  `required: !hasDefault`) and refuses unknown names before any maker runs. The four SEO catalogs declare only
  `subject_id` + `locale` (+ `candidates` on `kk-seo-keyword-page`), but `seo-decisions.ts` forwarded the page
  URL as a fourth `url` parameter on every page-level and pair-level call — so all 13 page judgments per page and
  every pair judgment degraded to `source: fallback` while the stage still exited 0. Only `decision_logs`
  (`unknown --param "url"`, outcome `rejected`) showed it; `judgments.json` did not. Display metadata now travels
  in `options.subjectUrl`, and `plugins/kk/tests/smart-seo-decisions.test.ts` pins the contract with a shim that
  enforces spur's allow-list. Whenever a decision gains a field, diff every `--param` call site against the
  catalog's `parameters:` block.
- **KK's sufficiency gate must agree with spur's own level banding.** Spur serves `confidenceLevel` as
  HIGH >= 0.8 / MEDIUM >= 0.5 / else LOW, and bands a null, non-finite OR out-of-range confidence as LOW.
  `validateAndNormalizeDecisionResult` only checked `Number.isFinite`, so a maker payload of `confidence: 1.5`
  passed the `>= 0.8` gate and entered the "sufficient confidence" aggregate as a HIGH-band judgment while spur
  called the same value LOW. Verification (and the fix: out-of-range becomes null, per design §7 "null or finite
  0–1") lives in `plugins/kk/tests/smart-seo-decisions.test.ts` → `Confidence level (HIGH/MEDIUM/LOW)
  verification`, repeatable artifact at `.spur/run/seo-confidence/summary.json`. Re-check any new level/threshold
  rule against spur's `confidenceLevel()` rather than restating the constant.

- **A non-FF base ref is the normal end state of a long batch**: `main` advanced 13 commits during the
  G81 batch, so the `--worktree` FF-merge could not run. `git merge-tree --write-tree <base> <branch>`
  is the cheap pre-check (rc 0 + zero markers = clean, sanctioned `--no-ff` merge commit); the driver
  must not rebase (task evidence cites the branch SHAs) and must ask the operator before landing on a
  divergent base.
- **Reviewers invent `Confidence:` blocks**: one wrote `##### Confidence in this verdict (added on
  operator request)` with `Confidence: HIGH` and cited no evidence — F511/task 1207 retired that field,
  and the workspace rule `review-record-carries-confidence-level` then blocked the gate mid-batch. Say
  "no confidence level" in every review dispatch; the fix is a re-record by the review coordinator, not
  a hand edit.
- **`openStore({migrate:false})` is a read-write connection**: SQLite can checkpoint the WAL into the
  main file on last-connection close, so a "read-only" reader changes `-wal`/size bytes and a digest
  guard reports it as concurrent drift. Observed live (G81 0309): a spurious exit 1, never a false
  PASS. Guard on `sqlite_master` + row counts, and treat content-sha drift with the WAL check in mind.
- **Orphaned `sh -c … feature sync …` guards hold `docs/features/.<id>.lock`**: a pipeline precheck's
  `|| feature sync` fallback can outlive the run, and every later sync then blocks until the PIDs are
  killed and the stale lock removed.
- **Two sessions, one tree → feature-verification digest races (observed 2026-10-18)**: the
  feature-verification pass digests the working tree before/after its ~10-min suite; a concurrent
  session's edits or commits inside that window fail the pass with zero test failures. Five passes
  were lost this way in one day. When co-existing is mandated, retry on digest-only FAILs (check the
  log for `0 fail` first) and batch all feature passes into one quiet window.
- **A cancelled task's WBS is reused**: `spur task update <wbs> cancelled` frees the number; a later
  `task create` reuses it with a new slug and the cancelled file disappears uncommitted. Never cite a
  cancelled WBS from code comments or test names — cite the owning task/requirement instead
  (fixed: `(0317)` → `(0311 R3)` in `apps/cli/src/itc-publish.ts` + its test).
- **Quote task sections containing `&`**: `spur task update <wbs> --section Q&A …` unquoted splits at
  the ampersand (`A: command not found`) and the update silently does not run. Always
  `--section 'Q&A'`.

## 2026-10-19 — board modules + plugin bundling pitfalls
- **Bare `Bundle failed` from `bun run build` is a missing-install symptom, not a broken plugin**: Bun's
  `Bun.build` rejects with an `AggregateError` whose own `message` is only `Bundle failed`; the reason
  (`Could not resolve "@gobing-ai/kk-core"`) lives in `errors[]`. `scripts/bundle-plugins.ts`
  `describeBuildFailure` now prints every sub-error with `file:line`, so a wiped `node_modules` names
  itself instead of blaming `aihot-ingest`.
- **A `bootstrap.modules` entry declared `enabled: true` against a gitignored directory is a
  server-start landmine**: the host resolves `directory` against the project root, requires it inside
  that root, and exits 1 before listening when it is absent — a bare `git clean -xdf` then breaks
  `spur serve` for every checkout. Fixed by making the assets an install-time product (root `prepare`
  runs `bun scripts/build-board.ts`), not by documenting a manual flip. Note `--ignore-scripts`
  installs (CI) skip `prepare` and must build explicitly.

## 2026-10-19 — daily voice2: pool supply + XHS card compose
- **A "no-content" day is usually supply, not code**: the 04:30 job closes `done` in ~16 s when
  `kk store extract` hands the floor gate fewer than ~6 qualifying items (see
  `.works/kk-daily-ai-voice2/<date>/21-plan/*_floor-refusal.json`). Qualifying supply is ~3–13
  items/day (profile `ai-news` + quality≥2 + importance≥2 + china≤1) against an episode demand of
  6–12, so a published episode starves the next morning. Check the published-pool drawdown
  (12→8→8→6→3 on 10-15…10-19) before looking for a bug.
- **`kk-item-quality` is a body-length rubric** (`plugins/kk/decisions/kk-items.yaml`): 500–690 char
  youtube/rss `summary` stubs score 1 and never enter an `ai-news` pool. Fixing supply means fixing
  the ingest body, not the profile.
- **`kk stage <name>` resolves the runner from the *installed* package, not the checkout** (only an
  entry whose package root is `apps/cli` uses `plugins/kk/scripts`). Editing a stage in this repo
  does nothing for `kk stage` until the installed copy's `plugins/kk/scripts/*` is refreshed. Product
  *plugins* (`kk executor run <plugin>`) are the opposite: the project root shadows the install.
- **The XHS card composer's headline fit measured a wrapping element**, so `scrollWidth` never
  exceeded the safe width and the font never stepped down: a 10-char cover headline wrapped to two
  lines, pushed `points[1..n]` past the safe bottom, and every retry failed (only points are
  rewritable) — a cosmetic card killed the whole episode via DAG fail-fast. The fit loop now
  measures with `white-space: nowrap` and restores wrapping after. Reproduce any card refusal
  without spending provider credit by composing with `illustration: undefined` (blank band).
- Don't trust the binary name in Bun's `posix_spawn 'x'` ENOENT — for `spawnSync` it means the **cwd**
  doesn't exist; verify the dir, not the interpreter. And never provision a pipeline binary via a
  shell-only PATH entry (e.g. `~/.local/bin`): scheduled runs get the launchd plist PATH only, so
  brew everything onto `/opt/homebrew/bin`.

## 2026-10-24 — daily voice2: nothing published, and the safety gate hid why

- **A quota-disabled executor climbs the ladder into a dead write path.** With every `agy-*` profile
  disabled (`disabled: {owner: quota}` — written back into `~/.config/spur/config.yaml` at 21:00), the
  `scribe` rung resolves to `opencode`, whose free-tier key answered `Invalid credential`. The `-retry`
  sibling then resolved `${vars.agent_retry}` → `inline` → `agy-gemini`, and headless agy's terminal
  sandbox denies workspace writes, so BOTH attempts exited without an artifact. Probe a candidate rung
  with a write-then-read round trip before trusting it: `claude -p "<prompt>" --permission-mode acceptEdits
  --allowedTools Write Edit --add-dir <workdir>` passed on 2026-10-24 while `agy --mode accept-edits`
  did not. A `-retry` sibling that lands on an unusable rung is not a retry.
- **A retry sibling only helps the states that HAVE one.** `kk-daily-safety` declared no retry for
  `review`/`judge`/`revise` and those states have no back-edge, so one failed executor produced zero
  artifacts and `daily-safety-gate` scored `block` — the run failed "closed" on a review that never
  happened. The gate is right to fail closed on a missing report; the gap was upstream. Every agent
  step in that machine now carries a capable-tier sibling sharing its prompt via a YAML anchor.
- **`revise` silently spends budget on unchanged bytes.** A failed revise still runs
  `daily-safety-revise`, which spends one unit and re-opens the review over the same drafts, so two
  executor failures exhaust `safety_max_revise` and land on `exclude`/`block` with nothing remediated.
- **`translate` is `onError: continue` with no sibling**, so a failed locale translation left both
  en/ja scaffolds at `draft: true`, `translate-sync` synced nothing, and `publish-classify` still wrote
  `full`. `daily-publish-completeness` records `locales=failed` in its own artifact — read that file,
  never `publish-status.txt` alone, when asking "did the day publish everything".
- **A failed run holds its store selections; the next run then extracts an EMPTY pool.** Releasing
  only the newest dead run is not enough: `kk store extract` ran `count:0` until every failed run of
  the day was released (`kk store release --run <id>` each). The DAG treats an empty pool as a
  legitimate `no-content` close and exits `done` in ~11 s, which reads as "nothing to do" instead of
  "you forgot to release".
- **Do not `git stash pop` into a moved surfdash checkout.** Popping a stash taken before a pull left
  85 files with conflict markers in the shared surfdash tree; the plugin's `refine` step then died on
  `Expected identifier but found "<<"` at `scripts/lib/seo-digest.ts`, which surfaced only as
  "surfdash-pub exited 1". `surfdash` publishes with `git merge --ff-only origin/main` and refuses a
  diverged checkout, so keep that tree clean rather than stashing its unrelated edits.
- **Don't key pipeline verdict Req rows with `(covers: R<n>)` refs** — `spur task verdict` demands the Req-row ID equal a task requirement ID exactly; feature-scenario crediting belongs on AC-table rows keyed by the feature scenario title. Also: a hand-authored review answer needs its `Verdict:`/`Confidence:` lines INSIDE the task doc's Review section too, or the residual gate blocks with `review-contract:*`.
- **Don't assume a gate receipt survives doc edits**: receipts bind to the git tree, but via `git write-tree` — unstaged edits don't change it (receipt reuses), staged/committed ones do (gate re-runs). Archive FAIL receipts (`.bak`) before recheck, or the no-progress guard auto-skips at the same tree.
- **kk publish-matrix-send can replay a stale failing transcript on tier-0 resend** (2026-11-06): three consecutive tier-0 resends printed byte-identical errors including the OLD spur run id (`d8268a40-…`) with `sync_cms/shell (0s)` timing, while a direct `bun kk executor fan-out --content …/payloads/content.surfdash-pub.post.json --target surfdash-pub` (with `EMDASH_API_TOKEN`/`SURFDASH_URL` exported) succeeded in 31s and the nested `bun scripts/surfdash.ts publish` with exported env succeeded end-to-end. Bypass: run the direct fan-out, verify live state, write the evidence-backed receipt (with a `reconciled` note), then continue with the remaining tiers. Record the untraced root cause (likely a cached nested-spur transcript) before trusting receipts from a resend whose wall time is ~0s.
- **Nested postsurfing publish needs the kk env at the shell level**: `surfdash-pub`'s plugin process gets `EMDASH_API_TOKEN`/`SURFDASH_URL` from kk config, but the embedded postsurfing→spur→sync_cms chain failed without them when driven manually. Manual recovery: `SURFDASH_URL=… EMDASH_API_TOKEN=… bun scripts/surfdash.ts publish <zh index.md>` from the surfdash root.

## 2026-11-07 — history-daily-report enrich timeout + validate verdict loop
- The scheduler captures each `scheduler.custom` job's `command` AND `timeoutMs` from the config object at serve BOOTSTRAP (spur.js registerSchedulerEntries ~175150) — a `.spur/config.yaml` scheduler edit is inert until `launchctl kickstart -k gui/$(id -u)/ai.gobing.spur-serve`, even though `--vars` on a workflow invocation parses at runtime.
- A staged timeout kill (exit 3, empty output at exactly step timeoutMs) does NOT trigger the agent tier-ladder failover; executor repair alone never fixes a budget kill.
- `__executor.<role>` vars pin an agent.run role to a named executor (spur.js 104954; e.g. pin the reviewer role to `agy-gemini`, capable-1). The var value must be a JSON string that parses to `{"name": "<executor>"}` — exactly ONE escape layer: inside the outer --vars JSON write `{\"name\":\"agy-gemini\"}`. An extra escape layer (`{\\"name\\"...}` in sh-quoted YAML) makes parseExecutorPin silently return undefined and the run proceeds on the role ladder with NO error — the only observable sign is the run's `agent-sessions/` dir named for the default agent instead of the pin, plus the session's model field. Always confirm the pin actually consumed (dir + model) before trusting the outcome.
- Verified live 2026-11-07 with the correct pin (run f527aa66…): enrich 10m29s on antigravity / gemini-3.8-flash-high (vs 13m43s floor + 60m timeout-kill ceiling on pi-dsv4.1-flash-volc), structure-gate PASS, validate verdict PASS on the FIRST attempt (0 FAIL lines), no correct loop, published `docs/report/2026-11-06-history-anatomy.md` in ~33 min wall. The same window on deepseek-flash (run f91131fa) had FAILED validate twice and exhausted retries (enrich 13m43s, correct 19m34s + 9m49s) — the verdict churn was model competence, not budget.
- A dry-run of history-anatomy always dies at `structure-gate — iteration-bound-exceeded` (no real artifacts); don't read it as a vars regression.
- Report quality: date-window judgment stages (enrich/validate/correct all `role: reviewer`) on deepseek-flash produced validate FAIL -> correct x2 -> still FAIL -> retry-exhausted on run f91131fa. Pin the review-class stages to agy-gemini (capable-1) per the vars pin above; if review quality still clips, escalate to `agy-gemini-4` (capable-2).

## 2026-11-09 — 0346 host-executor run: gate budget, host receipts, review confidence lanes
- **The pipeline gate's 900 s budget is now SMALLER than this repo's full gate.** `task-pipeline.yaml` ships `gateTimeoutMs: "900000"` and a hit is BLOCKED (exit 2), never a red gate. The suite measured 985–990 s twice on 2026-11-09, so every default-vars run reports `gate timeout after 900000ms` and routes to failed. Launch with `--vars '{"wbs":"…","profile":"auto","executor":"host","gateTimeoutMs":"2100000"}'`; do NOT narrow `qualityGateCmd` to fit the budget.
- **`spur workflow continue --answer-text` takes a receipt FILE PATH, not prose.** A host-executor pause on a work item needs `{runId, state, executor:"host", outcome:"done", startedAt, finishedAt, files[]}` written to disk; free text fails with `work-item receipt could not be read (missing or malformed)`. Re-report the SAME `state` the pause names, and rewrite the receipt whenever a new run id is created.
- **Two confidence lanes, two levels.** The captured answer (`<runId>-review-cert.md`, the `spur task verdict --from-answer` input) wants the verify-lane level (`deriveVerifyConfidence`, e.g. HIGH when every anchored claim resolves); the task doc's `## Review` section wants `deriveReviewConfidence`, which drops to MEDIUM as soon as any P4/DEFER row is carried. Copying the cert into the section verbatim leaves `review-contract:*` blocking and the run lands in `remediate`.
- **A review re-entry deletes the captured answer.** `review` re-visit expects `<runId>-review-answer.txt` to exist again; if the fold removes it, `continue` refuses with `expected file(s) missing` — rewrite the answer (cert bytes) before resuming.
- `spur feature sync <id> --json` against this tree's `.spur/spur.db` (9.7 GB) blocks for minutes even on a NOOP; the docs-only roster refresh is `spur feature refresh --feature <id>` (seconds) and is what updates a feature's `## Tasks` status column after a task closes.
- **wechatmp profile SIGTRAP on headed launch (2026-11-09).** `~/.config/kk/browser-profiles/wechatmp` intermittently crash-launches (EXC_BREAKPOINT, ChromeMain) headed-only — headless works, fresh profile works. A single *healthy* launch heals it permanently (the run regenerates `Local State`/`Preferences`); deleting GPU caches does not. Recovery: empty `Default/` for one launch (login state replays from root `storage-state.json`), let it boot, then restore the full `Default/` — subsequent launches stay green.

## 2026-11-10 (20261109 daily repair)
- `publish-matrix-send` throws on receipt reconciliation INSIDE the tier loop — a tier-0 stale binding aborts tiers 1–3 before any dispatch. Recovery: tier-scoped sends (`--tier 1`, `--tier 2`, `--tier 3`) skip tier-0 rows entirely; row order within a tier means earlier rows still dispatch before a later row's reconciliation throw.
- After ANY generate-side artifact rebuild (bundle-variants + safety + freeze), all succeeded receipts bind stale payload digests → every rerun degrades to reconciliation errors. Plan the rebuild BEFORE the first send, not after.
- xhs-pub `publish` operation cap = one per 2h per profile (KK_XHS_AUTOMATION_STATE): 发播客 + 上传图文 in one day must be scheduled ≥2h apart or the second hits `automation cap` (fast-fail, uncertain receipt).
- surfing.salty.vi locales: en is the default locale → `/posts/<slug>`; zh/ja → `/{locale}/posts/<slug>`. `/en/posts/<slug>` serves a soft-404 (HTTP 200, "Page not found", hero og:image) — probe the right URL before diagnosing CDN/render issues.
## 2026-11-10 — runall 0347-0349
- `spur feature sync/update <id>` can hang indefinitely on corpus-lock contention with a concurrent session — run it nohup+background and check the log; lifecycle update from `active` is denied (legal path via sync's derived hops). Task `done` statuses are authoritative; feature-table/INDEX projections lag until the lock frees.
- `bunx biome check --write` used ad-hoc can use a different binary than the pinned one (`bun run lint`/`bun run format`) — fixes landed on disk once but the committed tree still carried violations; always re-run `bun run lint` after the write and before `git write-tree`.
- `spur workflow run` mis-keying the pipeline var (`taskId` instead of `wbs`) produces a failed run with `0000-*` artifacts — check the precheck log for "defaulting" hints before assuming the run started.

## 2026-11-10 xhs draft image previews dead from overseas egress (XHS CDN, not our data)
- Symptom: after a verified xhs upload+save, reopening the draft shows image tiles
  with `naturalWidth===0` from a US egress — looks like data loss, isn't.
- Mechanism: draft editor tiles load `sns-creator-preview.xhscdn.com/spectrum/<file_id>`
  signed URLs. XHS re-signs per editor open via `web_api/sns/v5/creator/file/encryption`
  (`file_id` is the durable server-side key). That host geo-splits DNS: CN clients get
  `sched.vplego-dk.tdnsvod4.cn` (working), overseas clients get
  `ovslegovideo.sched.apdcdn.com` (43.146.x) which has NO `/spectrum/` route and answers
  `400 text/html` from `alb` → Chrome `net::ERR_BLOCKED_BY_ORB` → dead tile.
- Verification recipe (no CN egress needed): query Tencent/Ali DoH with
  `edns_client_subnet=<CN ip>` to get the CN edge IP, then
  `curl --resolve sns-creator-preview.xhscdn.com:443:<cn-edge-ip> "<signed url>"`.
  200 image/png = bytes intact server-side.
- Corollary: `naturalWidth` is NOT a validity signal for xhs draft previews cross-region
  (also the reason confirmThumbnails keys on src scheme, not naturalWidth).

## 2026-11-20 · dev-run 0350 · pipeline verdict gates (fc9e752d)
- Verdict replay only extracts BACKTICKED, repo-root-relative `path:line` anchors; bare or worktree-relative test citations become `missing` replay findings → verdict PASS downgrades to PARTIAL. Plugin test files resolve to workspace "." → skipped via root bunfig coverageThreshold guard, so root-relative cites replay clean.
- After review, the task `### Review` section needs: a P1–P4 findings table with ≥1 populated row (hasPopulatedPriorityTable), a `Confidence:` line, and a `Verdict:` line — else residual review-contract blocks AND the L3 done-gate check fails.
- The review approval token is folded from review.status at hitl.confirm time; after fixing evidence, re-answer the review work item so the token recomputes — a stale DENIED token routes review→remediate.
- Any task-file/docs commit after a gate run invalidates the receipt (stale). Batch doc commits BEFORE the final gate run.
- An engine run that fails its `done/command.gate` is terminal-failed and NOT resumable; recover via `spur task record <wbs> --transition done --no-lifecycle` after fixing, then persist-out + merge manually.
- Raw `playwright.chromium.launchPersistentContext` headless probes on a kk profile use the `chromium_headless_shell` binary, whose cookie store cannot read what headed full-Chromium (kkBrowserLauncher `channel: 'chromium'`) wrote and clobbers the Cookies DB on open (publish-harness browser.ts:144-147 documents the channel flag). Symptom 2026-11-11: shipinhao QR session looked "dead across contexts" for hours — every raw headless probe wiped/misread the store while the production paths (profile-check/preflight/flow via kkBrowserLauncher) were correctly wired (flow.ts:754). All ad-hoc browser probes MUST go through kkBrowserLauncher; post-login cookie flush is also async (lands seconds after context.close()) — a quiet window matters before the next open.
