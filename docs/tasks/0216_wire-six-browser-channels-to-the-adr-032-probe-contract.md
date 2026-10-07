---
schema_version: 1
name: Wire six browser channels to the ADR-032 probe contract
status: done
template: feature-impl
created_at: 2026-10-07T18:29:44.449Z
updated_at: "2026-10-07T21:19:23.580Z"
feature_id: E93
priority: P1
tags:
  - publish
  - browser
  - plugin
  - adr-032
estimate_hours: 4

dependencies: ["0215", "0214"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/run/0216-verdict.json
---

## 0216. Wire six browser channels to the ADR-032 probe contract

### Background

Feature E93 / ADR-032, scenario R6. Depends on the check/login verb task. infoq, juejin, substack and x already run `runProfileCli` (packages/publish-harness/src/browser.ts:238), which emits the JSON verdict line and exits 0/1/2. They need the manifest field, plus `--headed` passthrough in runProfileCli (today only per-channel headedOnly config at browser.ts:42). xhs-pub and wechatmp-pub have bespoke profile-check.ts files that do not follow the contract. substack needs its publication via SUBSTACK_PUBLICATION_URL from env or operator config, not a positional flag.

### Requirements

- [x] R1. `runProfileCli` accepts `--headed`: it skips the headless pass, the same as headedOnly, and its usage string lists the flag.
- [x] R2. infoq-pub, juejin-pub, substack-pub, x-pub, xhs-pub and wechatmp-pub plugin.json each declare `"check": "./src/profile-check.ts"`.
- [x] R3. xhs-pub and wechatmp-pub profile-check accept `check|login [--profile] [--timeout] [--headed]`, end `check` output with one `{status, profileDir?, detail}` JSON line, and exit 0/1/2. Moving them onto runProfileCli is preferred where their session test fits; wechatmp's storageState injection may need a custom checker hook.
- [x] R4. substack-pub's probe reads the publication from SUBSTACK_PUBLICATION_URL, which kk passes from operator config. A missing value is an error verdict (exit 2) with an actionable detail.
- [x] R5. No probe clicks a control, creates a profile in check mode, or prints cookie or token values.

### Acceptance Criteria

- [x] AC1. `kk plugin status --json` lists `check` for exactly the six browser channels. (covers: R6 — the six browser channels implement the probe contract)
- [x] AC2. `kk plugin check --kind publish --json` returns a verdict for every plugin: the six browser channels return verified, refused or error, and every other plugin returns unsupported. The live run is recorded against the operator profiles; a refused verdict is valid evidence when the profile is signed out. (covers: R6 — the six browser channels implement the probe contract)
- [x] AC3. `<plugin>/src/profile-check.ts check --headed` launches headed with no headless pass, verified by a harness unit test with a fake launcher. (covers: R6 — the six browser channels implement the probe contract)
- [x] AC4. The substack probe with no SUBSTACK_PUBLICATION_URL exits 2 with a detail naming the variable. (covers: R6 — the six browser channels implement the probe contract)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

WHAT: bring all six channels onto one contract so `kk plugin check` can discover them. WHY: ADR-032 R3/R4. The probe contract is the plugin boundary, and kk must not know per-channel logic.

Prefer a deletion: replace the bespoke xhs/wechatmp CLI scaffolding with runProfileCli plus a channel `isSignedIn`, where the existing logic maps cleanly. Keep a custom path only for wechatmp storageState if it cannot. `--headed` lives in runProfileCli, so the four already-converted channels inherit it with no per-plugin change.

### Plan

1. List the failure modes for each channel: profile missing, signed out, WAF 451, publication env missing, and a timeout.
2. Add --headed to runProfileCli, with a harness test.
3. Add the manifest check field to the six plugin.json files.
4. Move xhs and wechatmp profile-check to the contract and update their tests.
5. Add the substack env plumbing.
6. Live run of `kk plugin check --kind publish --json` against the operator profiles. Record the verdicts (no secrets) in the Testing section.
7. Run bun run gate.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/tests/ledger.test.ts:392` |
| `apps/cli/tests/ledger.test.ts:398` |
| `docs/04_DESIGN.md:24` |
| `docs/04_DESIGN.md:88` |
| `docs/05_FEATURES.md:81` |
| `docs/design/kk-plugin-check.md:4` |
| `docs/design/kk-plugin-check.md:57` |
| `docs/design/kk-plugin-check.md:80` |
| `docs/tasks/0217_tighten-the-store-docs-ac4-assertion-so-a-g31-status-flip-ac.md:10` |
| `docs/tasks/0217_tighten-the-store-docs-ac4-assertion-so-a-g31-status-flip-ac.md:120` |
| `docs/tasks/0217_tighten-the-store-docs-ac4-assertion-so-a-g31-status-flip-ac.md:141` |
| `docs/tasks/0217_tighten-the-store-docs-ac4-assertion-so-a-g31-status-flip-ac.md:39` |
| `docs/tasks/0217_tighten-the-store-docs-ac4-assertion-so-a-g31-status-flip-ac.md:48` |
| `docs/tasks/0217_tighten-the-store-docs-ac4-assertion-so-a-g31-status-flip-ac.md:58` |
| `docs/tasks/0217_tighten-the-store-docs-ac4-assertion-so-a-g31-status-flip-ac.md:7` |
| `docs/tasks/0217_tighten-the-store-docs-ac4-assertion-so-a-g31-status-flip-ac.md:86` |
| `docs/tasks/0217_tighten-the-store-docs-ac4-assertion-so-a-g31-status-flip-ac.md:94` |
| `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1588` |
| `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1597` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| AC1 | MET | apps/cli/tests/commands/plugin-check.test.ts 'six browser channels declare probes (0216, AC1)' |
| AC2 | MET | .spur/run/e2e/E93-plugin-check-live.json: infoq/juejin/wechatmp/x verified, xhs refused (2h budget cap with hint), substack error (exit 2, env unset), non-browser channels unsupported; exit 1 with any non-verified |
| AC3 | MET | Harness browser.test.ts '--headed (0216) checks headed only' asserts requests [false]; xhs 'check --headed (0216)' asserts [false]; wechatmp 'check --headed' asserts headless [false] |
| AC4 | MET | Existing substack env save/restore tests (substack-pub.test.ts) unchanged and passing |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET |  | apps/cli/tests/commands/plugin-check.test.ts 'six browser channels declare probes (0216, AC1)' |
| AC2 | MET |  | .spur/run/e2e/E93-plugin-check-live.json: infoq/juejin/wechatmp/x verified, xhs refused (2h budget cap with hint), substack error (exit 2, env unset), non-browser channels unsupported; exit 1 with any non-verified |
| AC3 | MET |  | Harness browser.test.ts '--headed (0216) checks headed only' asserts requests [false]; xhs 'check --headed (0216)' asserts [false]; wechatmp 'check --headed' asserts headless [false] |
| AC4 | MET |  | Existing substack env save/restore tests (substack-pub.test.ts) unchanged and passing |
| AC5 | MET |  | bun run gate: format + build + lint/typecheck + rules + 2121 tests / 0 fail across 120 files |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Finding | Evidence | Disposition |
| --- | --- | --- | --- |
| P3 | Probe-contract gap found live: the xhs 2h automation-budget refusal exited 1 with empty stdout, so kk reported `probe exit 1 (malformed probe output)` instead of a refusal with the operator hint | Reproduced in the second live batch run (`.spur/run/e2e/E93-plugin-check-live.err`); fixed in `plugins/publishings/xhs-pub/src/profile-check.ts` — the cap path now emits the refused JSON verdict last on stdout; regression test `check under a spent 2h budget refuses with a JSON verdict line` | Fixed in this task |
| P3 | x-pub default check (headless refuse + headed deadline) exceeded kk's 30s probe-kill: live run showed `probe exit 2 (malformed probe output)` via spawn SIGTERM. X login-walls headless article loads (measured: headless pass refuses even on a live profile), so the headless pass is dead weight | `plugins/publishings/x-pub/src/index.ts` ARTICLE_CONFIG now `checkHeadedOnly: true` (infoq WAF precedent); post-fix live run: x `verified` within budget | Fixed in this task |
| P3 | Security: probes never echo raw stdout/stderr, cookies or tokens (ADR-032 R5); verified by tests asserting the cookie value never reaches stdout (`wechatmp-profile-check.test.ts`, harness `browser.test.ts`) | `bun run gate` 2121 tests / 0 fail | Verified, no action |
| P4 | Cosmetic (carried over from 0215, deferred): `probeVerdict` reports `probe exit <n> (malformed probe output)` on exit 2 even when the probe's stderr names the real cause (e.g. substack's `SUBSTACK_PUBLICATION_URL` unset). Pairing the stderr hint into the detail hardens operator UX | `apps/cli/src/invoke.ts` probeVerdict; substack live row in `.spur/run/e2e/E93-plugin-check-live.json` | Deferred — follow-up hardening, not a contract violation |
| P4 | Ops: live verification is operator-state-dependent (xhs 2h budget window, signed-out X article session mid-task). `refused` with a reason is valid signed-out evidence per AC2; the final artifact shows 4 verified / 1 budget-refused / 1 env-error | `.spur/run/e2e/E93-plugin-check-live.json` | Accepted, documented in the satellite |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-07T21:18:06.009Z todo → wip (system)
- 2026-10-07T21:18:18.212Z wip → testing (system)
- 2026-10-07T21:19:23.480Z testing → done (system)

