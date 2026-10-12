---
schema_version: 1
name: Render the Spur server keepalive as a schedule artifact, not a hand-written plist
status: todo
template: issue
created_at: 2026-10-12T21:45:46.473Z
updated_at: "2026-10-12T21:58:57.553Z"
feature_id: G11

ac_altitude: task-local
---

## 0265. Render the Spur server keepalive as a schedule artifact, not a hand-written plist

### Background

The supervised Spur server is what makes the daily pipeline fire at all, but its keepalive exists only as a hand-written host file. Established 2026-10-12: the `.spur/config.yaml` `bootstrap.scheduler` job `kk-daily-ai-voice` (cron `30 4 * * *`) is enqueued by the job worker that lives INSIDE `spur serve` for this project. That process was SIGTERM'd at 00:17 local and not restarted until 10:00, so the 04:30 tick never fired and the day produced no episode (no workspace, no ledger row, no spur run record). Nothing supervised it: `crontab -l` is empty, `kk schedule render` only knows `kk-collect`, and the 04:00/10:00 `launchd` collect ticks kept running — which masked the outage.

I installed `~/Library/LaunchAgents/ai.gobing.spur-serve.plist` by hand (RunAtLoad + KeepAlive, `spur serve --cwd <repo> --host 127.0.0.1 --port 3003 --no-open`, `EnvironmentVariables` = PATH + TYPESAFE_API_KEY + TYPESAFE_BASE_URL) and re-bootstrapped it. The env block is load-bearing twice: the job worker runs its commands through `/bin/sh -c` (so bare `spur`/`kk`/`jq`/`bun` must resolve), and `typesafe`-routed decisions need the credential that only the operator's shell has.

The gap: that artifact is not reproducible from the repo. The next `kk schedule render kk-collect` run, a repo move, or a new machine loses it, and the failure mode is silent-for-a-day.

### Requirements

- [ ] R1. Add a rendered `kk schedule render` schedule for the server keepalive (own name, e.g. `kk-serve`), reusing `plugins/kk/schedules/*` plus the existing `{{repo}}`/`{{home}}`/`{{typesafe_api_key}}` bindings, so the host artifact is regenerable from a checkout.
- [ ] R2. Keep `KeepAlive` + `RunAtLoad` and the absolute `Program` (launchd resolves a relative `ProgramArguments[0]` before the job environment exists).
- [ ] R3. Document the install line in `plugins/kk/README.md` §Schedule and the artifact row in `docs/04_DESIGN.md` §1.11, naming why the keepalive is required (scheduler-hosted jobs).
- [ ] R4. Verify the rendered plist bootstraps under `launchctl` and that `spur self status`/the server log shows the scheduler registering its jobs.

### Acceptance Criteria

- [ ] AC1 — `kk schedule render kk-serve --platform launchd --repo <checkout>` prints a `plutil -lint`-clean plist whose `ProgramArguments` run `spur serve` against that checkout. (req: R1, R2)
- [ ] AC2 — The rendered artifact carries `PATH` and `TYPESAFE_API_KEY`; with the key unset the render still produces a valid plist. (req: R1)
- [ ] AC3 — Bootstrapping the rendered artifact yields a running job whose log shows `Scheduler entries registered`. (req: R4)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
