---
schema_version: 1
name: Render the Spur server keepalive as a schedule artifact, not a hand-written plist
status: done
template: issue
created_at: 2026-10-12T21:45:46.473Z
updated_at: "2026-10-14T01:48:37.178Z"
feature_id: G11

ac_altitude: task-local
priority: P1
estimate_hours: 2
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0265-verdict.json
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

- [x] R1. Add a `kk-serve` schedule to `kk schedule render`, launchd only, from a new template `plugins/kk/schedules/kk-serve.launchd.plist.tmpl` bound with the existing `{{repo}}` / `{{home}}` / `{{typesafe_api_key}}` placeholders, so `~/Library/LaunchAgents/ai.gobing.spur-serve.plist` is regenerable from a checkout.
- [x] R2. The rendered plist keeps `Label` = `ai.gobing.spur-serve`, `RunAtLoad` true, `KeepAlive` true, `ThrottleInterval` 10, absolute `Program` = `{{home}}/.bun/bin/spur` (launchd resolves a relative `ProgramArguments[0]` before the job environment exists), argv `spur serve --cwd {{repo}} --host 127.0.0.1 --port 3003 --no-open`, `WorkingDirectory` `{{repo}}`, stdout+stderr `{{repo}}/.works/spur-serve/serve.log`.
- [x] R3. `kk schedule render kk-serve --platform cron` exits 1 with `kk.schedule.render.failed: schedule 'kk-serve' has no cron template (expected launchd)` and prints nothing — cron cannot keep a process alive. `kk-collect` renders for both platforms exactly as today.
- [x] R4. Docs: `plugins/kk/README.md` §Schedule gets the kk-serve install lines (incl. `mkdir -p .works/spur-serve`); `docs/04_DESIGN.md` §1.11 gets the kk-serve artifact row and the "launchd only" rule. Both replace the stale "`spur` has no scheduler" claim with: `spur serve` hosts the `bootstrap.scheduler` jobs, so the server itself is what must be kept alive.
- [x] R5. Operator verification on this host: re-render over the hand plist, `launchctl bootout` + `bootstrap`, then `launchctl print gui/$(id -u)/ai.gobing.spur-serve` shows `state = running` and a fresh `Scheduler entries registered` line appears in `<repo>/.spur/logs/spur.log`.

**Out of scope:** binding `TYPESAFE_BASE_URL` (Q&A D2); a cron/systemd keepalive; kk installing or bootstrapping anything (render stays print-only); making host/port configurable.

### Acceptance Criteria

- [x] AC1 — `kk schedule render kk-serve --platform launchd --repo <checkout>` prints a plist whose `Label`, `Program`, `ProgramArguments`, `WorkingDirectory`, `RunAtLoad`, `KeepAlive` and log paths match R2. (req: R1, R2) — layer: `apps/cli/tests/commands/schedule.test.ts` (parses the printed plist).
- [x] AC2 — The rendered artifact carries `PATH` and `TYPESAFE_API_KEY` (XML-escaped); with the key unset it renders an empty `<string></string>` and still parses. (req: R1) — layer: `schedule.test.ts`.
- [x] AC3 — `--platform cron` for `kk-serve` exits 1 with the R3 message and empty stdout, while `kk-collect --platform cron` is unchanged. (req: R3) — layer: `schedule.test.ts`.
- [x] AC4 — Bootstrapping the rendered artifact yields `state = running` under `launchctl print` and a new `Scheduler entries registered` record in `<repo>/.spur/logs/spur.log` stamped after the bootstrap. (req: R5) — layer: manual host evidence recorded in Testing (plus `plutil -lint` on the rendered file).

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

1. [x] Tests first (AC1–AC3) in `apps/cli/tests/commands/schedule.test.ts`; confirm they fail (unknown schedule).
2. [x] Add `plugins/kk/schedules/kk-serve.launchd.plist.tmpl` (R1, R2).
3. [x] Widen `SCHEDULE_TEMPLATES` to `Partial` per platform, add `kk-serve`, add the missing-platform error (R1, R3).
4. [x] Update README §Schedule + `docs/04_DESIGN.md` §1.11, including the stale "spur has no scheduler" sentence (R4).
5. [x] `bun run lint`, `bun run test` (exit code, per-file 90% coverage), `bun run build:bundle` and confirm the template landed in `apps/cli/plugins/kk/schedules/`.
6. [x] Host verification (R5/AC4): render to a temp file, `plutil -lint`, diff against the hand plist (expect only `TYPESAFE_BASE_URL` gone), install, `launchctl bootout`/`bootstrap`, check `launchctl print` + `.spur/logs/spur.log`. Record evidence in Testing — with the key redacted.

### Root Cause

The scheduler that fires `kk-daily-ai-voice` is hosted by `spur serve` (`.spur/config.yaml:60-66` `bootstrap.scheduler`; registration at spur-new `apps/server/src/serve.ts:1245-1255`), but kk ships no supervision for that server: `SCHEDULE_TEMPLATES` knows only `kk-collect` (`apps/cli/src/commands/schedule.ts:26-28`), and the docs (`docs/04_DESIGN.md` §1.11, `plugins/kk/README.md` §Schedule) still say spur has no scheduler, so nothing tells the operator the server must be kept alive. A killed server therefore loses every scheduled tick until a manual restart.

### Solution

- `apps/cli/src/commands/schedule.ts:29-31` — `SCHEDULE_TEMPLATES` widened to `Record<string, Partial<Record<SchedulePlatform, string>>>` and given `'kk-serve': { launchd: 'kk-serve.launchd.plist.tmpl' }`, so a schedule may be launchd-only (R1); the map's doc comment at `apps/cli/src/commands/schedule.ts:24-27` explains why `Partial` is the shape.
- `apps/cli/src/commands/schedule.ts:111-116` — `renderAction` now throws `schedule '<name>' has no <platform> template (expected <available>)` when a known schedule lacks the requested platform, surfacing through the existing `kk.schedule.render.failed` handler: exit 1, empty stdout (R3).
- `plugins/kk/schedules/kk-serve.launchd.plist.tmpl:1-24` — new template; WHY header (scheduler is server-hosted; env block load-bearing for `/bin/sh -c` jobs and typesafe decisions) plus the operator install block, and the D2 note that `TYPESAFE_BASE_URL` is deliberately not bound.
- `plugins/kk/schedules/kk-serve.launchd.plist.tmpl:26-78` — the R2 keepalive dict: `Label` `ai.gobing.spur-serve`, absolute `Program` `{{home}}/.bun/bin/spur`, argv `spur serve --cwd {{repo}} --host 127.0.0.1 --port 3003 --no-open`, `WorkingDirectory` `{{repo}}`, `EnvironmentVariables` PATH + `{{typesafe_api_key}}`, stdout+stderr `{{repo}}/.works/spur-serve/serve.log`, `RunAtLoad`/`KeepAlive` true, `ThrottleInterval` 10.
- `apps/cli/tests/commands/schedule.test.ts:67-95` — plist test helpers (`plistBooleanValue`, `plistIntegerValue`, `expectWellFormedPlist` — entity/tag-balance checks standing in for a plist parser AC2's "still parses" half).
- `apps/cli/tests/commands/schedule.test.ts:163-198` — AC1/AC2: the kk-serve launchd render parses and matches every R2 field, carries PATH + `TYPESAFE_API_KEY`, omits `TYPESAFE_BASE_URL` (D2).
- `apps/cli/tests/commands/schedule.test.ts:200-220` — AC2: an XML-special key escapes (`&`→`&amp;` etc.) and still parses; unset renders `<string></string>` and still parses.
- `apps/cli/tests/commands/schedule.test.ts:222-232` — AC3: `kk-serve --platform cron` exits 1 with empty stdout and the R3 message; `kk-collect --platform cron` still exits 0.
- `plugins/kk/README.md:33-37` — §Schedule replaces "`spur` has no scheduler" with "`spur serve` hosts the scheduler … the server itself is what must be kept alive" (R4).
- `plugins/kk/README.md:39-47` — §Schedule gains the kk-serve install lines, including `mkdir -p "$PWD/.works/spur-serve"` (R4).
- `plugins/kk/README.md:88-93` — §Schedule tail: Label stays `ai.gobing.spur-serve` so re-render replaces in place (D3); serve.log vs `.spur/logs/spur.log` destinations.
- `docs/04_DESIGN.md:886-899` — §1.11 intro: same stale-claim replacement, `kk-serve` introduced as the keepalive (R4).
- `docs/04_DESIGN.md:905-919` — §1.11 artifact table gains the `kk-serve` row (Schedule|Platform split) and the "launchd only" refusal rule with the exact R3 message (R4).

Verification (narrow, this pass): `bun test apps/cli/tests/commands/schedule.test.ts` → 8 pass / 0 fail, exit 0; `bun test apps/cli/tests/store-docs.test.ts` (04_DESIGN doc contract) → 5 pass / 0 fail, exit 0; `bun run build:bundle` (apps/cli) → exit 0, template confirmed in the gitignored `apps/cli/plugins/kk/schedules/` bundle copy. Public-surface probe (temp dir `/tmp/0265-probe.OYVjzh`, nothing written into the repo): `kk schedule render kk-serve --platform cron` → exit 1, 0 stdout bytes, stderr `kk.schedule.render.failed: schedule 'kk-serve' has no cron template (expected launchd)`; `kk schedule render kk-serve --platform launchd` → exit 0, `plutil -lint` OK, PlistBuddy prints Label `ai.gobing.spur-serve`, Program `/Users/robin/.bun/bin/spur`, RunAtLoad/KeepAlive true, ThrottleInterval 10.

**AC4 host evidence (R5, operator-authorized, run 2026-10-12 20:46–20:47 local / 2026-10-13T03:46–03:47Z).** Key redacted as `***`.

1. Rendered the install copy against the operator checkout (not this worktree): `bun apps/cli/src/index.ts schedule render kk-serve --platform launchd --repo /Users/robin/xprojects/knowledge-kit > "$TMPD/install-kk-serve.plist"` → exit 0; `plutil -lint` → OK; `EnvironmentVariables:TYPESAFE_API_KEY` renders non-empty (107 chars, value `***`).
2. D2 diff: `plutil -convert xml1` normalization of the previous hand plist vs the rendered copy → the ONLY difference is the dropped `TYPESAFE_BASE_URL` key (`<key>TYPESAFE_BASE_URL</key>` + its `<string>https://api.typesafe.ai</string>`).
3. Installed over `~/Library/LaunchAgents/ai.gobing.spur-serve.plist` (4417 bytes); `launchctl bootout gui/$(id -u)/ai.gobing.spur-serve` → exit 0; first `launchctl bootstrap` → exit 5 "Input/output error" (launchd bootout/bootstrap race), retried after 3 s → exit 0.
4. `launchctl print gui/$(id -u)/ai.gobing.spur-serve` → `state = running`.
5. Fresh registration: `/Users/robin/xprojects/knowledge-kit/.spur/logs/spur.log` grew 449745 → 450434 bytes (mtime 20:29:44 → 20:47:21) with a new `{"@timestamp":"2026-10-13T03:47:21.218Z","level":"INFO","message":"Scheduler entries registered","logger":"app.bootstrap","properties":{"jobs":5}}` — stamped after the successful bootstrap; the previous hit was 2026-10-12T21:42:14.174Z.

No rendered plist committed or left inside the repo; render outputs live in `/tmp/0265-probe.OYVjzh` only.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/commands/schedule.ts:29-31` — `SCHEDULE_TEMPLATES` widened to `Record<string, Partial<Record<SchedulePlatform, string>>>` with `'kk-serve': { launchd: 'kk-serve.launchd.plist.tmpl' }` (launchd-only, no cron key); `plugins/kk/schedules/kk-serve.launchd.plist.tmpl:1` — new template bound with the `{{repo}}`/`{{home}}`/`{{typesafe_api_key}}` placeholders |
| R2 | MET | `plugins/kk/schedules/kk-serve.launchd.plist.tmpl:26-77` — `Label` `ai.gobing.spur-serve`, absolute `Program` `{{home}}/.bun/bin/spur`, argv `spur serve --cwd {{repo}} --host 127.0.0.1 --port 3003 --no-open`, `WorkingDirectory` `{{repo}}`, stdout+stderr `{{repo}}/.works/spur-serve/serve.log`, `RunAtLoad`/`KeepAlive` true, `ThrottleInterval` 10; fresh render this run: `plutil -lint` OK and PlistBuddy prints `Program` `/Users/robin/.bun/bin/spur`, `RunAtLoad`/`KeepAlive` true, `ThrottleInterval` 10 — launchd requires an absolute `Program` (a relative `ProgramArguments[0]` resolves via `_PATH_STDPATH` before the job environment exists; `KeepAlive` true keeps the job alive unconditionally; `ThrottleInterval` is seconds) per `man launchd.plist` on this host and https://keith.github.io/xcode-man-pages/launchd.plist.5.html |
| R3 | MET | `apps/cli/src/commands/schedule.ts:112-116` — `renderAction` throws `schedule 'kk-serve' has no cron template (expected launchd)` when the platform has no template; fresh this run: `bun apps/cli/src/index.ts schedule render kk-serve --platform cron` -> exit 1, 0 stdout bytes, stderr `kk.schedule.render.failed: schedule 'kk-serve' has no cron template (expected launchd)`; `kk-collect --platform cron` -> exit 0 (unchanged) |
| R4 | MET | `plugins/kk/README.md:33-47` — §Schedule replaces "spur has no scheduler" with "spur serve hosts the scheduler … the server itself is what must be kept alive" and adds `mkdir -p "$PWD/.works/spur-serve"` + the kk-serve install lines; `plugins/kk/README.md:88-93` — Label stays `ai.gobing.spur-serve` (D3) + serve.log vs spur.log destinations; `docs/04_DESIGN.md:896-919` — §1.11 same stale-claim replacement, `kk-serve` artifact row, and the "launchd only" rule |
| R5 | MET | Host state re-read this run: `launchctl print gui/501/ai.gobing.spur-serve` -> `state = running`, `program = /Users/robin/.bun/bin/spur`, working dir `/Users/robin/xprojects/knowledge-kit`, env PATH + TYPESAFE_API_KEY (no TYPESAFE_BASE_URL); `grep 'Scheduler entries registered' /Users/robin/xprojects/knowledge-kit/.spur/logs/spur.log` -> latest hit `2026-10-13T03:47:21.218Z` (jobs:5) stamped after the `2026-10-13T03:47:01.522Z` SIGTERM shutdown (bootout); previous hit `2026-10-12T21:42:14.174Z` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — `kk schedule render kk-serve --platform launchd --repo <checkout>` prints a plist whose `Label`, `Program`, `ProgramArguments`, `WorkingDirectory`, `RunAtLoad`, `KeepAlive` and log paths match R2. (req: R1, R2) — layer: `apps/cli/tests/commands/schedule.test.ts` (parses the printed plist). | MET | test | `apps/cli/tests/commands/schedule.test.ts:163-198` (8 pass / 0 fail this run); fresh render this run `plutil -lint` OK, PlistBuddy prints `Label` `ai.gobing.spur-serve`, `Program` `/Users/robin/.bun/bin/spur`, `ProgramArguments` spur serve --cwd <repo> --host 127.0.0.1 --port 3003 --no-open, `WorkingDirectory` repo, `RunAtLoad`/`KeepAlive` true, streams `<repo>/.works/spur-serve/serve.log` |
| AC2 — The rendered artifact carries `PATH` and `TYPESAFE_API_KEY` (XML-escaped); with the key unset it renders an empty `<string></string>` and still parses. (req: R1) — layer: `schedule.test.ts`. | MET | test | `apps/cli/tests/commands/schedule.test.ts:200-220` (8 pass / 0 fail this run); fresh this run: `env -u TYPESAFE_API_KEY` render -> `<key>TYPESAFE_API_KEY</key>` + `<string></string>`, `plutil -lint` OK; `TYPESAFE_API_KEY='apikey_a&b<c>d'` render -> `apikey_a&amp;b&lt;c&gt;d`, `plutil -lint` OK |
| AC3 — `--platform cron` for `kk-serve` exits 1 with the R3 message and empty stdout, while `kk-collect --platform cron` is unchanged. (req: R3) — layer: `schedule.test.ts`. | MET | test | `apps/cli/tests/commands/schedule.test.ts:222-231` (8 pass / 0 fail this run); fresh this run: `bun apps/cli/src/index.ts schedule render kk-serve --platform cron` -> exit 1, 0 stdout bytes, `kk.schedule.render.failed: schedule 'kk-serve' has no cron template (expected launchd)`; `kk-collect --platform cron` -> exit 0 |
| AC4 — Bootstrapping the rendered artifact yields `state = running` under `launchctl print` and a new `Scheduler entries registered` record in `<repo>/.spur/logs/spur.log` stamped after the bootstrap. (req: R5) — layer: manual host evidence recorded in Testing (plus `plutil -lint` on the rendered file). | MET | command | `launchctl print gui/501/ai.gobing.spur-serve` -> `state = running` (fresh this run); `grep 'Scheduler entries registered' /Users/robin/xprojects/knowledge-kit/.spur/logs/spur.log` -> `2026-10-13T03:47:21.218Z` (jobs:5) stamped after the `2026-10-13T03:47:01.522Z` SIGTERM bootout; installed plist `plutil -lint` OK and its EnvironmentVariables carries only PATH + TYPESAFE_API_KEY (TYPESAFE_BASE_URL dropped, D2) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0265

**Scope:** branch `sp/runall-g11-74ac` diff `7f107305..HEAD` + working tree — `apps/cli/src/commands/schedule.ts`, `apps/cli/tests/commands/schedule.test.ts`, `plugins/kk/schedules/kk-serve.launchd.plist.tmpl` (new), `plugins/kk/README.md`, `docs/04_DESIGN.md`; the range also carries pre-existing commit `25137d53` on `plugins/kk/tests/decision-catalog.test.ts` (unrelated to 0265).

**Dimensions:** functional, security, efficiency, correctness, usability, architecture

**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | — | No P1–P3 findings: all six changed files reviewed across all six dimensions; R1–R5 traceable to code + tests + docs; 8/8 schedule tests and 5/5 store-docs tests pass this run; fresh CLI render verified (plutil -lint OK; cron refusal exits 1 with empty stdout and the exact R3 message); `apps/cli` typecheck clean | `apps/cli/src/commands/schedule.ts:29-34` | ACCEPTED |
| 2 | P4 (advisory) | architecture | Pre-existing commit `25137d53` (`plugins/kk/tests/decision-catalog.test.ts`, equality→membership) sits inside the `7f107305..HEAD` range but predates this task and maps to no 0265 requirement — benign, out of scope | `plugins/kk/tests/decision-catalog.test.ts:181-183` | ACCEPTED |
| 3 | P4 (advisory) | usability | AC4/R5 host evidence (`launchctl print` `state = running` + fresh `Scheduler entries registered` in `.spur/logs/spur.log`) is recorded in the task's Solution section, not `## Testing` (still empty) — the verify/record stage must transcribe it | `docs/tasks/0265_render-the-spur-server-keepalive-as-a-schedule-artifact-not-.md:112` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `apps/cli/src/commands/schedule.ts:29-34` — `kk-serve` map entry, launchd-only; `plugins/kk/schedules/kk-serve.launchd.plist.tmpl:1` — new template bound with `{{repo}}`/`{{home}}`/`{{typesafe_api_key}}` |
| R2 | MET | `plugins/kk/schedules/kk-serve.launchd.plist.tmpl:26-78` — Label/Program/argv/WorkingDirectory/log paths/RunAtLoad/KeepAlive/ThrottleInterval; asserted in `apps/cli/tests/commands/schedule.test.ts:163-198` |
| R3 | MET | `apps/cli/src/commands/schedule.ts:112-116` — missing-platform throw; verified fresh: `kk schedule render kk-serve --platform cron` → exit 1, 0 stdout bytes, `kk.schedule.render.failed: schedule 'kk-serve' has no cron template (expected launchd)`; test `apps/cli/tests/commands/schedule.test.ts:222-231` |
| R4 | MET | `plugins/kk/README.md:33-47` + `plugins/kk/README.md:88-93` (stale-claim replacement + kk-serve install lines); `docs/04_DESIGN.md:895-919` (§1.11 artifact table row + launchd-only rule) |
| R5 | MET | `docs/tasks/0265_render-the-spur-server-keepalive-as-a-schedule-artifact-not-.md:112-119` — operator run 2026-10-13T03:46Z: re-render, `launchctl bootout`/`bootstrap`, `state = running`, fresh `Scheduler entries registered` (key redacted) |

**Next:** no remediation required; record transcribes the AC4 host evidence into `## Testing`.




**Confidence:** MEDIUM — code seams re-executed this run (narrow tests, live CLI probe, failure-sensitivity experiment); the AC4 host evidence at `docs/tasks/0265_render-the-spur-server-keepalive-as-a-schedule-artifact-not-.md:112` was not verified by a bootstrap in this review.

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-10-13T03:53:03.661Z todo → wip (system)
- 2026-10-13T05:24:31.416Z wip → testing (system)
- 2026-10-13T05:25:05.757Z testing → done (system)

