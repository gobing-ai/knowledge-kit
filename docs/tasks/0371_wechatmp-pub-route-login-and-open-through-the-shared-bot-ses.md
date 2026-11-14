---
schema_version: 1
name: "wechatmp-pub: route login and open through the shared bot session path"
status: todo
template: feature-impl
created_at: 2026-11-13T19:00:06.213Z
updated_at: "2026-11-14T07:38:54.484Z"
feature_id: E9

ac_altitude: task-local
ac_numbering: task-local
dependencies: ["0370"]
---

## 0371. wechatmp-pub: route login and open through the shared bot session path

### Background

Audit 2026-11-13 (with task 0370): `wechatmp-pub` is the only other channel whose session CLI is hand-rolled. `src/profile-check.ts` and `src/index.ts` call the upstream `openPersistentBrowser` directly (`src/index.ts:164`, `:229`), and its bot-mode login verdict is `{status, profileDir, defaultUrl}` without the session facts added in 0305, so `kk bot list` shows `unknown` expiry for it. Thirteen channels get this from the shared `runProfileCli`.

WeChat is not flagged and its publish path (same-origin CGI draft with an exported `storage-state.json`) works; this task only removes the duplicated login/open path. Out of scope: the CGI publish flow, `apps/cli/src/**`, any live WeChat publish.

### Requirements

- [ ] R1. `login` and `open` in `plugins/publishings/wechatmp-pub/src/profile-check.ts` run through the shared `runProfileCli` path with the WeChat readiness predicate; the bot-mode login verdict carries `expiresAt` like the other channels.
- [ ] R2. The `storage-state.json` export after a successful login is preserved byte-for-byte in shape and location (`storageStatePath`), including its atomic temp-file write.
- [ ] R3. `check` behaviour, output and exit codes are unchanged; no existing test assertion is edited.
- [ ] R4. After the change, `rg -n "openPersistentBrowser" plugins/publishings/wechatmp-pub/src` prints only call sites the publish flow itself needs; each remaining one is listed in Solution with the reason.
- [ ] R5. A harness change is allowed only as an additive optional hook (for the storage-state export) and must leave the other channels' tests untouched. `bun run lint`, `bun run test`, `bun run build` exit 0.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Login records session facts and still exports storage state (req: R1, R2)
  Given a recording launcher whose page passes the WeChat readiness predicate and holds one persistent httpOnly cookie
  When `profile-check.ts login --url <console url>` runs
  Then the last stdout line is a JSON verdict with status verified, defaultUrl and expiresAt
  And storage-state.json exists at storageStatePath(profileDir) and no temp file is left beside it

Scenario: AC2 — Check and the publish flow are unchanged (req: R3, R4, R5)
  Given the change is applied
  When `git diff --stat -- plugins/publishings/wechatmp-pub/tests` and `bun run lint && bun run test && bun run build` run
  Then no existing assertion changed and all three commands exit 0
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-13T19:01:13.628Z

- **Tests first.** Write AC1 before the code. Failure modes to cover: the storage-state export runs before the readiness predicate passes; the export is skipped on the shared path; a refused login leaves a partial `storage-state.json`.
- **Why separate from 0370?** Different channel, no account risk, and it can wait; 0370 is urgent.
- **If `runProfileCli` cannot host the export without a non-additive change**, stop and report instead of forking the helper.

### Design

`plugins/publishings/wechatmp-pub/src/profile-check.ts` delegates `login`/`open` to `runProfileCli`; the storage-state export runs on the page the predicate accepted. `src/index.ts` keeps `storageStatePath` and the export function. Reuse the shape 0370 lands for xhs.

### Plan

1. Read `wechatmp-pub/src/profile-check.ts`, `src/index.ts:95-240`, and `runProfileCli` in `packages/publish-harness/src/browser.ts`.
2. Write AC1; confirm it fails.
3. R1–R4. `bun run lint && bun run test && bun run build`. One commit.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Task 0370 (same alignment for xhs), 0305 (session facts), 0277 (bot channel binding). `docs/04_DESIGN.md` §1.12.

### History

- 2026-11-14T07:38:54.484Z backlog → todo (system)

