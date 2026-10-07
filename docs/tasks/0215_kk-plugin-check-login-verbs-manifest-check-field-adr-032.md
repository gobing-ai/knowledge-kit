---
schema_version: 1
name: kk plugin check / login verbs + manifest check field (ADR-032)
status: todo
template: feature-impl
created_at: 2026-10-07T18:29:44.442Z
updated_at: "2026-10-07T18:30:33.560Z"
feature_id: E93
priority: P1
tags:
  - cli
  - plugin
  - kk-core
  - adr-032
estimate_hours: 5

---

## 0215. kk plugin check / login verbs + manifest check field (ADR-032)

### Background

Feature E93 / ADR-032. Today an operator can only learn whether a browser channel's session is live by running each plugin's src/profile-check.ts by path. ADR-032 adds two verbs that discover probes from plugin.json. `kk plugin status` stays static. Decomposition rubric E2 D1 L2 C1 R1 = 7, so the feature splits in two: this task is the core/CLI seam, and the next task wires the six channels. Covers E93 scenarios R1, R2, R3, R4, R5 and R7.

### Requirements

- [ ] R1. `PluginManifestSchema` (packages/kk-core/src/manifest.ts:20) accepts an optional non-empty `check` string (entry path relative to the plugin dir). `PluginRecord` (packages/kk-core/src/registry.ts:12) carries it resolved to an absolute path.
- [ ] R2. `kk plugin check [<name>…] [--kind <kind>] [--json] [--headed] [--timeout <ms>]` spawns `<check> check [--headed] [--timeout]` per selected plugin through the same execPath + operator-config env path as `pluginEntryCmd` / `pluginEntryEnv` (apps/cli/src/invoke.ts:115-122). It parses the last stdout line as `{status, profileDir?, detail}`.
- [ ] R3. The verdict is `verified` (exit 0), `refused` (exit 1) or `error` (exit 2, another code, a crash, a timeout, or no or malformed final JSON line). A plugin without `check` reports `unsupported` and never fails the run. The command exits 0 only when no plugin is refused or errored.
- [ ] R4. Only `status`, `profileDir` and `detail` are printed. Raw probe stdout and stderr are never echoed, and `--json` emits `{ ok, plugins: [{ name, kind, status, profileDir?, detail }] }`.
- [ ] R5. `kk plugin login <name>` runs `<check> login` with inherited stdio and exits with its code. An unknown plugin or one without `check` is a usage error that names the missing field.
- [ ] R6. `kk plugin status` spawns nothing. Its existing output contract is unchanged apart from listing `check` when present.
- [ ] R7. `docs/04_DESIGN.md` plugin noun section, the manifest field row and the probe contract are updated in the same commit (T3). `docs/05_FEATURES.md` gets the E93 row.

### Acceptance Criteria

- [ ] AC1. Over the fixture tree, `kk plugin check --json` reports verified, refused, error and unsupported for the matching fixtures, and exits nonzero. The E2E artifact .spur/run/e2e/E93-plugin-check.json records each verdict. (covers: R1 — plugin check reports one verdict per plugin that declares a probe; R3 — a broken probe is reported as an error, not as verified)
- [ ] AC2. Selecting only verified and unsupported fixtures exits 0. (covers: R2 — plugins without a probe report unsupported and never fail the run)
- [ ] AC3. A fixture whose probe writes a token-like string to stdout and stderr never shows that string in kk's output, and --headed reaches the probe only when passed. (covers: R4 — check is read-only and secret-free)
- [ ] AC4. `kk plugin login <fixture>` propagates the probe's exit code. `kk plugin login <no-check-plugin>` exits as a usage error naming `check`. (covers: R5 — plugin login runs the plugin's interactive login)
- [ ] AC5. `kk plugin status --json` output for the fixture tree matches the pre-change shape plus `check`, and spawns no probe. (covers: R7 — plugin status stays static)
- [ ] AC6. `bun run gate` passes.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

WHAT: two verbs on the existing `plugin` noun (apps/cli/src/commands/plugin.ts:180) plus one optional manifest field. WHY (ADR-032): status must stay cheap and side-effect-free for CI, and probes launch browsers, so readiness is a separate opt-in verb.

Seam: reuse invoke.ts spawn helpers (export or factor the cmd/env builder rather than duplicating it). Use one sync spawn per plugin with a timeout, run sequentially, because the engine is sequential and browser profiles are single-writer. Parsing: take the last non-empty stdout line and JSON.parse it in a try. A bad line becomes `error` with the exit code in the detail, never the line itself, which could hold page text.

No new dependency. Satellite: docs/design/kk-plugin-check.md.

### Plan

1. Write the failure list first: no check field, probe exit 1, exit 2, crash, timeout, garbage last line, unknown name, --kind filter, secret-looking stderr not echoed.
2. Add a fixture plugin pair under apps/cli/tests/fixtures (a probe printing a scripted verdict, plus one without check).
3. Add the manifest field and registry plumbing.
4. Add the check verb, then the login verb.
5. Add an E2E test that runs the built kk against the fixture tree and writes .spur/run/e2e/E93-plugin-check.json.
6. Update docs 04/05.
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
