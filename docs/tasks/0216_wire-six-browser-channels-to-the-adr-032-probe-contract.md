---
schema_version: 1
name: Wire six browser channels to the ADR-032 probe contract
status: todo
template: feature-impl
created_at: 2026-10-07T18:29:44.449Z
updated_at: "2026-10-07T18:30:35.071Z"
feature_id: E93
priority: P1
tags:
  - publish
  - browser
  - plugin
  - adr-032
estimate_hours: 4

dependencies: ["0215", "0214"]
---

## 0216. Wire six browser channels to the ADR-032 probe contract

### Background

Feature E93 / ADR-032, scenario R6. Depends on the check/login verb task. infoq, juejin, substack and x already run `runProfileCli` (packages/publish-harness/src/browser.ts:238), which emits the JSON verdict line and exits 0/1/2. They need the manifest field, plus `--headed` passthrough in runProfileCli (today only per-channel headedOnly config at browser.ts:42). xhs-pub and wechatmp-pub have bespoke profile-check.ts files that do not follow the contract. substack needs its publication via SUBSTACK_PUBLICATION_URL from env or operator config, not a positional flag.

### Requirements

- [ ] R1. `runProfileCli` accepts `--headed`: it skips the headless pass, the same as headedOnly, and its usage string lists the flag.
- [ ] R2. infoq-pub, juejin-pub, substack-pub, x-pub, xhs-pub and wechatmp-pub plugin.json each declare `"check": "./src/profile-check.ts"`.
- [ ] R3. xhs-pub and wechatmp-pub profile-check accept `check|login [--profile] [--timeout] [--headed]`, end `check` output with one `{status, profileDir?, detail}` JSON line, and exit 0/1/2. Moving them onto runProfileCli is preferred where their session test fits; wechatmp's storageState injection may need a custom checker hook.
- [ ] R4. substack-pub's probe reads the publication from SUBSTACK_PUBLICATION_URL, which kk passes from operator config. A missing value is an error verdict (exit 2) with an actionable detail.
- [ ] R5. No probe clicks a control, creates a profile in check mode, or prints cookie or token values.

### Acceptance Criteria

- [ ] AC1. `kk plugin status --json` lists `check` for exactly the six browser channels. (covers: R6 — the six browser channels implement the probe contract)
- [ ] AC2. `kk plugin check --kind publish --json` returns a verdict for every plugin: the six browser channels return verified, refused or error, and every other plugin returns unsupported. The live run is recorded against the operator profiles; a refused verdict is valid evidence when the profile is signed out. (covers: R6 — the six browser channels implement the probe contract)
- [ ] AC3. `<plugin>/src/profile-check.ts check --headed` launches headed with no headless pass, verified by a harness unit test with a fake launcher.
- [ ] AC4. The substack probe with no SUBSTACK_PUBLICATION_URL exits 2 with a detail naming the variable.
- [ ] AC5. `bun run gate` passes.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
