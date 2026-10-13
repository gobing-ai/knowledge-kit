---
schema_version: 1
name: Render the Spur server keepalive as a schedule artifact, not a hand-written plist
status: todo
template: issue
created_at: 2026-10-12T21:45:46.473Z
updated_at: "2026-10-13T02:46:18.377Z"
feature_id: G11

ac_altitude: task-local
priority: P1
estimate_hours: 2
---

## 0265. Render the Spur server keepalive as a schedule artifact, not a hand-written plist

### Background

The supervised Spur server is what makes the daily pipeline fire at all, but its keepalive exists only as a hand-written host file. Established 2026-10-12: the `.spur/config.yaml` `bootstrap.scheduler` job `kk-daily-ai-voice` (cron `30 4 * * *`) is enqueued by the job worker that lives INSIDE `spur serve` for this project. That process was SIGTERM'd at 00:17 local and not restarted until 10:00, so the 04:30 tick never fired and the day produced no episode (no workspace, no ledger row, no spur run record). Nothing supervised it: `crontab -l` is empty, `kk schedule render` only knows `kk-collect`, and the 04:00/10:00 `launchd` collect ticks kept running — which masked the outage.

I installed `~/Library/LaunchAgents/ai.gobing.spur-serve.plist` by hand (RunAtLoad + KeepAlive, `spur serve --cwd <repo> --host 127.0.0.1 --port 3003 --no-open`, `EnvironmentVariables` = PATH + TYPESAFE_API_KEY + TYPESAFE_BASE_URL) and re-bootstrapped it. The env block is load-bearing twice: the job worker runs its commands through `/bin/sh -c` (so bare `spur`/`kk`/`jq`/`bun` must resolve), and `typesafe`-routed decisions need the credential that only the operator's shell has.

The gap: that artifact is not reproducible from the repo. The next `kk schedule render kk-collect` run, a repo move, or a new machine loses it, and the failure mode is silent-for-a-day.

**Refine corrections (2026-10-12)**

- AC3 "the job's log shows `Scheduler entries registered`" → that line is a structured `app.bootstrap` INFO record written to `<repo>/.spur/logs/spur.log` (spur-new `apps/server/src/serve.ts:1254`; 19 hits there today), never to the plist's stdout/stderr file (`.works/spur-serve/serve.log` has 0 hits, 35 lines) → AC3 re-pointed at `.spur/logs/spur.log`.
- R4 "`spur self status` shows the scheduler registering" → `spur self status` reports project/Git/path status only; it has no scheduler view → R4 drops it and uses the spur.log line plus `launchctl print`.
- "reusing `plugins/kk/schedules/*`" → `schedule.ts` maps a schedule name to exactly one template per platform via `SCHEDULE_TEMPLATES: Record<string, Record<SchedulePlatform, string>>` (`apps/cli/src/commands/schedule.ts:26-28`), and the two existing templates are kk-collect-specific (calendar interval, workflow argv) → a new template file is required; the map type must allow a launchd-only schedule.
- `docs/04_DESIGN.md` §1.11 and `plugins/kk/README.md` §Schedule state "`spur` has no scheduler" → false since `spur serve` hosts `bootstrap.scheduler` (`.spur/config.yaml:60-66`) → R3 now corrects that sentence.
- Hand plist binds `TYPESAFE_BASE_URL` → no `{{typesafe_base_url}}` placeholder exists and the shipped kk-collect artifacts carry only the key → not bound here (Q&A D2).

### Requirements

- [ ] R1. Add a `kk-serve` schedule to `kk schedule render`, launchd only, from a new template `plugins/kk/schedules/kk-serve.launchd.plist.tmpl` bound with the existing `{{repo}}` / `{{home}}` / `{{typesafe_api_key}}` placeholders, so `~/Library/LaunchAgents/ai.gobing.spur-serve.plist` is regenerable from a checkout.
- [ ] R2. The rendered plist keeps `Label` = `ai.gobing.spur-serve`, `RunAtLoad` true, `KeepAlive` true, `ThrottleInterval` 10, absolute `Program` = `{{home}}/.bun/bin/spur` (launchd resolves a relative `ProgramArguments[0]` before the job environment exists), argv `spur serve --cwd {{repo}} --host 127.0.0.1 --port 3003 --no-open`, `WorkingDirectory` `{{repo}}`, stdout+stderr `{{repo}}/.works/spur-serve/serve.log`.
- [ ] R3. `kk schedule render kk-serve --platform cron` exits 1 with `kk.schedule.render.failed: schedule 'kk-serve' has no cron template (expected launchd)` and prints nothing — cron cannot keep a process alive. `kk-collect` renders for both platforms exactly as today.
- [ ] R4. Docs: `plugins/kk/README.md` §Schedule gets the kk-serve install lines (incl. `mkdir -p .works/spur-serve`); `docs/04_DESIGN.md` §1.11 gets the kk-serve artifact row and the "launchd only" rule. Both replace the stale "`spur` has no scheduler" claim with: `spur serve` hosts the `bootstrap.scheduler` jobs, so the server itself is what must be kept alive.
- [ ] R5. Operator verification on this host: re-render over the hand plist, `launchctl bootout` + `bootstrap`, then `launchctl print gui/$(id -u)/ai.gobing.spur-serve` shows `state = running` and a fresh `Scheduler entries registered` line appears in `<repo>/.spur/logs/spur.log`.

**Out of scope:** binding `TYPESAFE_BASE_URL` (Q&A D2); a cron/systemd keepalive; kk installing or bootstrapping anything (render stays print-only); making host/port configurable.

### Acceptance Criteria

- [ ] AC1 — `kk schedule render kk-serve --platform launchd --repo <checkout>` prints a plist whose `Label`, `Program`, `ProgramArguments`, `WorkingDirectory`, `RunAtLoad`, `KeepAlive` and log paths match R2. (req: R1, R2) — layer: `apps/cli/tests/commands/schedule.test.ts` (parses the printed plist).
- [ ] AC2 — The rendered artifact carries `PATH` and `TYPESAFE_API_KEY` (XML-escaped); with the key unset it renders an empty `<string></string>` and still parses. (req: R1) — layer: `schedule.test.ts`.
- [ ] AC3 — `--platform cron` for `kk-serve` exits 1 with the R3 message and empty stdout, while `kk-collect --platform cron` is unchanged. (req: R3) — layer: `schedule.test.ts`.
- [ ] AC4 — Bootstrapping the rendered artifact yields `state = running` under `launchctl print` and a new `Scheduler entries registered` record in `<repo>/.spur/logs/spur.log` stamped after the bootstrap. (req: R5) — layer: manual host evidence recorded in Testing (plus `plutil -lint` on the rendered file).

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-13T02:46:13.511Z

- D1 (closed) — Platform scope: launchd only. Cron has no keepalive semantics; an unsupported platform for a known schedule fails loud like an unknown platform does.
- D2 (closed) — `TYPESAFE_BASE_URL` is not bound. No placeholder exists, the shipped kk-collect artifacts carry only the key, and adding one is a new binding nothing has shown to be needed. Revisit if a keyless-URL failure is ever observed.
- D3 (closed) — Label stays `ai.gobing.spur-serve` (the installed hand plist's), so re-rendering replaces it in place rather than running two servers on port 3003.
- D4 (closed) — Host/port are frozen constants in the template (127.0.0.1:3003), not new flags (YAGNI).

### Design

**WHAT.** One new shipped schedule `kk-serve` (launchd only) whose template reproduces the hand-installed `ai.gobing.spur-serve.plist` with placeholders instead of literal paths/credentials.

**WHY.** The daily pipeline's 04:30 tick is enqueued by the scheduler inside `spur serve`; an unsupervised server is a silent missed day. Making the keepalive a rendered artifact puts it under the same regenerate-from-checkout contract as kk-collect.

**WHERE.**
- `plugins/kk/schedules/kk-serve.launchd.plist.tmpl` — new; copy the hand plist's dict (R2), replacing `/Users/robin` → `{{home}}`, the checkout → `{{repo}}`, the key → `{{typesafe_api_key}}`; drop `TYPESAFE_BASE_URL`. Keep a WHY header comment (keepalive is required because the scheduler is server-hosted; env block load-bearing for `/bin/sh -c` jobs and typesafe decisions).
- `apps/cli/src/commands/schedule.ts` — `SCHEDULE_TEMPLATES` becomes `Record<string, Partial<Record<SchedulePlatform, string>>>` with `'kk-serve': { launchd: 'kk-serve.launchd.plist.tmpl' }`. In `renderAction`, after the platform check, `templates[options.platform] === undefined` → throw `schedule '<name>' has no <platform> template (expected <available platforms joined by |>)`. No other change: placeholder substitution and `readTemplate` fallback already cover the new file.
- `apps/cli/tests/commands/schedule.test.ts` — AC1–AC3.
- `plugins/kk/README.md` §Schedule, `docs/04_DESIGN.md` §1.11 (+ the §1 command table row if it lists schedule names) — R4, same commit (T3).

**Frozen names.** schedule `kk-serve`; template `kk-serve.launchd.plist.tmpl`; label `ai.gobing.spur-serve`; log `.works/spur-serve/serve.log`; error text per R3. No new flags, no new placeholders.

**Anti-patterns.** Do not make kk run `launchctl` or write into `~/Library/LaunchAgents` (render is print-only by contract). Do not add a cron variant. Do not generalize templates into a per-schedule directory or a templating engine — one map entry suffices. Do not commit a rendered plist (it carries the credential).

**Packaging.** `apps/cli/plugins/` is a gitignored bundle copy (`.gitignore:167`, `build:bundle` → `scripts/bundle-plugins.ts`); the new template rides the existing whole-dir copy — verify it appears after `bun run build:bundle`, no script change expected.

**Dependencies.** None. No overlap with 0266/0267/0269/0270/0271 files.

### Plan

1. [ ] Tests first (AC1–AC3) in `apps/cli/tests/commands/schedule.test.ts`; confirm they fail (unknown schedule).
2. [ ] Add `plugins/kk/schedules/kk-serve.launchd.plist.tmpl` (R1, R2).
3. [ ] Widen `SCHEDULE_TEMPLATES` to `Partial` per platform, add `kk-serve`, add the missing-platform error (R1, R3).
4. [ ] Update README §Schedule + `docs/04_DESIGN.md` §1.11, including the stale "spur has no scheduler" sentence (R4).
5. [ ] `bun run lint`, `bun run test` (exit code, per-file 90% coverage), `bun run build:bundle` and confirm the template landed in `apps/cli/plugins/kk/schedules/`.
6. [ ] Host verification (R5/AC4): render to a temp file, `plutil -lint`, diff against the hand plist (expect only `TYPESAFE_BASE_URL` gone), install, `launchctl bootout`/`bootstrap`, check `launchctl print` + `.spur/logs/spur.log`. Record evidence in Testing — with the key redacted.

### Root Cause

The scheduler that fires `kk-daily-ai-voice` is hosted by `spur serve` (`.spur/config.yaml:60-66` `bootstrap.scheduler`; registration at spur-new `apps/server/src/serve.ts:1245-1255`), but kk ships no supervision for that server: `SCHEDULE_TEMPLATES` knows only `kk-collect` (`apps/cli/src/commands/schedule.ts:26-28`), and the docs (`docs/04_DESIGN.md` §1.11, `plugins/kk/README.md` §Schedule) still say spur has no scheduler, so nothing tells the operator the server must be kept alive. A killed server therefore loses every scheduled tick until a manual restart.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
