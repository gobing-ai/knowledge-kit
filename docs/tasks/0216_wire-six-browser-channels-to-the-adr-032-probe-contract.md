---
schema_version: 1
name: Wire six browser channels to the ADR-032 probe contract
status: done
template: feature-impl
created_at: 2026-10-07T18:29:44.449Z
updated_at: "2026-10-07T23:04:51.928Z"
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

- **`--headed` in the shared CLI:** `runProfileCli` parses it (`packages/publish-harness/src/browser.ts:262`) and skips the headless pass (`packages/publish-harness/src/browser.ts:306`), so infoq, juejin, substack and x inherit it with no per-plugin change.
- **Manifests:** all six browser channels declare `"check": "./src/profile-check.ts"` (`plugins/publishings/*/plugin.json:5`); the exact set is asserted in `apps/cli/tests/commands/plugin-check.test.ts:181`.
- **xhs / wechatmp:** kept as bespoke CLIs rather than moved onto `runProfileCli` (Design allowed this): xhs draws on the ADR-025 automation budget and wechatmp checks its own console session. Both accept `check|login [--profile] [--timeout] [--headed]`, exit 0/1/2, and end with one JSON verdict line, including the budget refusal (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1588`) and the exit-2 usage path (`plugins/publishings/xhs-pub/src/profile-check.ts:69`, `plugins/publishings/wechatmp-pub/src/profile-check.ts:56`, E93 re-verify).
- **x:** `checkHeadedOnly: true` (`plugins/publishings/x-pub/src/index.ts:215`), because X login-walls headless article loads and the dead headless pass blew kk's 30s probe-kill.
- **substack:** the publication comes from `SUBSTACK_PUBLICATION_URL` (operator config via kk); when unset, the probe ends with an `error` verdict naming the variable (`plugins/publishings/substack-pub/src/profile-check.ts:67`), which kk shows as `probe exit 2: …`.
- **Live evidence:** `.spur/run/e2e/E93-plugin-check-live.json` (4 verified, xhs budget-refused, substack env-error) and `.spur/run/e2e/E93-substack-recheck.json`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | runProfileCli parses --headed at `packages/publish-harness/src/browser.ts:262` and skips the headless pass at `packages/publish-harness/src/browser.ts:306`; usage lists the flag at `packages/publish-harness/src/browser.ts:249`; tests `packages/publish-harness/tests/browser.test.ts:245`, `packages/publish-harness/tests/browser.test.ts:254` |
| R2 | MET | check entry declared at line 5 of each manifest: `plugins/publishings/infoq-pub/plugin.json:5`, `plugins/publishings/juejin-pub/plugin.json:5`, `plugins/publishings/substack-pub/plugin.json:5`, `plugins/publishings/x-pub/plugin.json:5`, `plugins/publishings/xhs-pub/plugin.json:5`, `plugins/publishings/wechatmp-pub/plugin.json:5`; exact set asserted by `apps/cli/tests/commands/plugin-check.test.ts:181` |
| R3 | MET | xhs and wechatmp keep bespoke CLIs that follow the contract: --headed tests `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1569`, `plugins/publishings/wechatmp-pub/tests/wechatmp-profile-check.test.ts:138`; budget refusal ends with a JSON line (`plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1588`); exit-2 usage now ends with an error JSON line (fixed this run) at `plugins/publishings/xhs-pub/src/profile-check.ts:69-75` and `plugins/publishings/wechatmp-pub/src/profile-check.ts:56`, tests `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1551`, `plugins/publishings/wechatmp-pub/tests/wechatmp-profile-check.test.ts:70` |
| R4 | MET | Fixed this run: the unset publication path now ends with an error JSON verdict naming the variable at `plugins/publishings/substack-pub/src/profile-check.ts:67`, and kk carries that detail at `apps/cli/src/invoke.ts:253`; tests `plugins/publishings/substack-pub/tests/substack-pub.test.ts:551`, `apps/cli/tests/commands/plugin-check.test.ts:196`; live recheck .spur/run/e2e/E93-substack-recheck.json reports probe exit 2 naming SUBSTACK_PUBLICATION_URL |
| R5 | MET | Headless launch refuses a missing profile and check never clicks (`packages/publish-harness/tests/browser.test.ts:174`); cookie value never printed (`plugins/publishings/wechatmp-pub/tests/wechatmp-profile-check.test.ts:114`); kk surfaces only the parsed fields (`apps/cli/tests/commands/plugin-check.test.ts:108`) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R6 — the six browser channels implement the probe contract | MET | test | Manifests asserted by `apps/cli/tests/commands/plugin-check.test.ts:181`; --headed headed-only by `packages/publish-harness/tests/browser.test.ts:245`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1569`, `plugins/publishings/wechatmp-pub/tests/wechatmp-profile-check.test.ts:138`; exit-2 JSON verdict line by `packages/publish-harness/tests/browser.test.ts:276`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1551`, `plugins/publishings/wechatmp-pub/tests/wechatmp-profile-check.test.ts:70`, `plugins/publishings/substack-pub/tests/substack-pub.test.ts:551`; kk-level substack error names the variable by `apps/cli/tests/commands/plugin-check.test.ts:196`; live run .spur/run/e2e/E93-plugin-check-live.json plus .spur/run/e2e/E93-substack-recheck.json |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Finding | Evidence | Disposition |
| --- | --- | --- | --- |
| P2 | AC4 was certified on unrelated evidence: with SUBSTACK_PUBLICATION_URL unset the substack probe printed plain text, so kk reported `probe exit 2 (malformed probe output)` instead of a detail naming the variable | `plugins/publishings/substack-pub/src/profile-check.ts:67` now ends with an error JSON verdict; kk carries it (`apps/cli/src/invoke.ts:253`); E2E `apps/cli/tests/commands/plugin-check.test.ts:196`; live `.spur/run/e2e/E93-substack-recheck.json` | Fixed in the E93 re-verify (2026-10-07) |
| P3 | Exit-2 usage paths in runProfileCli, xhs-pub and wechatmp-pub printed no final JSON verdict line, breaking the R3 contract | `packages/publish-harness/src/browser.ts:279`, `plugins/publishings/xhs-pub/src/profile-check.ts:69`, `plugins/publishings/wechatmp-pub/src/profile-check.ts:56`; tests `packages/publish-harness/tests/browser.test.ts:276`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1551`, `plugins/publishings/wechatmp-pub/tests/wechatmp-profile-check.test.ts:70` | Fixed in the E93 re-verify (2026-10-07) |
| P3 | Satellite and the 05_FEATURES E93 row claimed xhs and wechatmp moved onto runProfileCli; both keep bespoke contract-conformant CLIs | `docs/design/kk-plugin-check.md:59`, `docs/05_FEATURES.md:81` | Fixed in the E93 re-verify (2026-10-07) |
| P3 | Probe-contract gap found live: the xhs 2h automation-budget refusal exited 1 with empty stdout, so kk reported malformed output instead of a refusal with the operator hint | Cap path emits the refused JSON verdict last; regression test `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1588` | Fixed in this task |
| P3 | x-pub headless refuse plus headed deadline exceeded kk's 30s probe-kill; X login-walls headless article loads | ARTICLE_CONFIG `checkHeadedOnly: true` at `plugins/publishings/x-pub/src/index.ts:215`; post-fix live run x `verified` | Fixed in this task |
| P4 | Cosmetic (from 0215): probeVerdict hid the probe's stated cause on exit 2 | Superseded by the P2 fix: a well-formed error verdict's detail is now shown (`apps/cli/tests/invoke.test.ts:908`) | Resolved in the E93 re-verify |
| P4 | Ops: live verification is operator-state-dependent (xhs 2h budget window, X article session). `refused` with a reason is valid signed-out evidence per AC2 | `.spur/run/e2e/E93-plugin-check-live.json` (4 verified, 1 budget-refused, 1 env-error) | Accepted, documented in the satellite |

Security: probes never echo raw stdout/stderr, cookies or tokens (ADR-032 R5) — `plugins/publishings/wechatmp-pub/tests/wechatmp-profile-check.test.ts:114`, `apps/cli/tests/commands/plugin-check.test.ts:108`. No finding.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-07T21:18:06.009Z todo → wip (system)
- 2026-10-07T21:18:18.212Z wip → testing (system)
- 2026-10-07T21:19:23.480Z testing → done (system)

