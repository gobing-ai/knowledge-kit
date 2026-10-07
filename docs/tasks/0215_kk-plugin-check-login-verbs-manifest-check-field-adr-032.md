---
schema_version: 1
name: kk plugin check / login verbs + manifest check field (ADR-032)
status: done
template: feature-impl
created_at: 2026-10-07T18:29:44.442Z
updated_at: "2026-10-07T20:07:16.491Z"
feature_id: E93
priority: P1
tags:
  - cli
  - plugin
  - kk-core
  - adr-032
estimate_hours: 5

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/run/0215-verdict.json
---

## 0215. kk plugin check / login verbs + manifest check field (ADR-032)

### Background

Feature E93 / ADR-032. Today an operator can only learn whether a browser channel's session is live by running each plugin's src/profile-check.ts by path. ADR-032 adds two verbs that discover probes from plugin.json. `kk plugin status` stays static. Decomposition rubric E2 D1 L2 C1 R1 = 7, so the feature splits in two: this task is the core/CLI seam, and the next task wires the six channels. Covers E93 scenarios R1, R2, R3, R4, R5 and R7.

### Requirements

- [x] R1. `PluginManifestSchema` (packages/kk-core/src/manifest.ts:20) accepts an optional non-empty `check` string (entry path relative to the plugin dir). `PluginRecord` (packages/kk-core/src/registry.ts:12) carries it resolved to an absolute path.
- [x] R2. `kk plugin check [<name>…] [--kind <kind>] [--json] [--headed] [--timeout <ms>]` spawns `<check> check [--headed] [--timeout]` per selected plugin through the same execPath + operator-config env path as `pluginEntryCmd` / `pluginEntryEnv` (apps/cli/src/invoke.ts:115-122). It parses the last stdout line as `{status, profileDir?, detail}`.
- [x] R3. The verdict is `verified` (exit 0), `refused` (exit 1) or `error` (exit 2, another code, a crash, a timeout, or no or malformed final JSON line). A plugin without `check` reports `unsupported` and never fails the run. The command exits 0 only when no plugin is refused or errored.
- [x] R4. Only `status`, `profileDir` and `detail` are printed. Raw probe stdout and stderr are never echoed, and `--json` emits `{ ok, plugins: [{ name, kind, status, profileDir?, detail }] }`.
- [x] R5. `kk plugin login <name>` runs `<check> login` with inherited stdio and exits with its code. An unknown plugin or one without `check` is a usage error that names the missing field.
- [x] R6. `kk plugin status` spawns nothing. Its existing output contract is unchanged apart from listing `check` when present.
- [x] R7. `docs/04_DESIGN.md` plugin noun section, the manifest field row and the probe contract are updated in the same commit (T3). `docs/05_FEATURES.md` gets the E93 row.

### Acceptance Criteria

- [x] AC1. Over the fixture tree, `kk plugin check --json` reports verified, refused, error and unsupported for the matching fixtures, and exits nonzero. The E2E artifact .spur/run/e2e/E93-plugin-check.json records each verdict. (covers: R1 — plugin check reports one verdict per plugin that declares a probe; R3 — a broken probe is reported as an error, not as verified)
- [x] AC2. Selecting only verified and unsupported fixtures exits 0. (covers: R2 — plugins without a probe report unsupported and never fail the run)
- [x] AC3. A fixture whose probe writes a token-like string to stdout and stderr never shows that string in kk's output, and --headed reaches the probe only when passed. (covers: R4 — check is read-only and secret-free)
- [x] AC4. `kk plugin login <fixture>` propagates the probe's exit code. `kk plugin login <no-check-plugin>` exits as a usage error naming `check`. (covers: R5 — plugin login runs the plugin's interactive login)
- [x] AC5. `kk plugin status --json` output for the fixture tree matches the pre-change shape plus `check`, and spawns no probe. (covers: R7 — plugin status stays static)

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

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/plugin.ts:12` |
| `apps/cli/src/commands/plugin.ts:147` |
| `apps/cli/src/commands/plugin.ts:158` |
| `apps/cli/src/commands/plugin.ts:347` |
| `apps/cli/src/invoke.ts:122` |
| `apps/cli/src/invoke.ts:139` |
| `docs/04_DESIGN.md:152` |
| `docs/04_DESIGN.md:24` |
| `docs/04_DESIGN.md:331` |
| `docs/04_DESIGN.md:66` |
| `docs/04_DESIGN.md:77` |
| `docs/05_FEATURES.md:81` |
| `docs/design/kk-plugin-check.md:4` |
| `docs/design/kk-plugin-check.md:44` |
| `docs/design/kk-plugin-check.md:48` |
| `packages/kk-core/src/manifest.ts:24` |
| `packages/kk-core/src/registry.ts:16` |
| `packages/kk-core/src/registry.ts:398` |
| `apps/cli/tests/commands/plugin-check.test.ts:1` |
| `apps/cli/tests/fixtures/plugins/generations/e2e-unsupported/entry.ts:1` |
| `apps/cli/tests/fixtures/plugins/generations/e2e-unsupported/plugin.json:1` |
| `apps/cli/tests/fixtures/plugins/publishings/e2e-broken/check.ts:1` |
| `apps/cli/tests/fixtures/plugins/publishings/e2e-broken/entry.ts:1` |
| `apps/cli/tests/fixtures/plugins/publishings/e2e-broken/plugin.json:1` |
| `apps/cli/tests/fixtures/plugins/publishings/e2e-refused/check.ts:1` |
| `apps/cli/tests/fixtures/plugins/publishings/e2e-refused/entry.ts:1` |
| `apps/cli/tests/fixtures/plugins/publishings/e2e-refused/plugin.json:1` |
| `apps/cli/tests/fixtures/plugins/publishings/e2e-secret/check.ts:1` |
| `apps/cli/tests/fixtures/plugins/publishings/e2e-secret/entry.ts:1` |
| `apps/cli/tests/fixtures/plugins/publishings/e2e-secret/plugin.json:1` |
| `apps/cli/tests/fixtures/plugins/publishings/e2e-slow/check.ts:1` |
| `apps/cli/tests/fixtures/plugins/publishings/e2e-slow/entry.ts:1` |
| `apps/cli/tests/fixtures/plugins/publishings/e2e-slow/plugin.json:1` |
| `apps/cli/tests/fixtures/plugins/publishings/e2e-verified/check.ts:1` |
| `apps/cli/tests/fixtures/plugins/publishings/e2e-verified/entry.ts:1` |
| `apps/cli/tests/fixtures/plugins/publishings/e2e-verified/plugin.json:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | packages/kk-core/src/manifest.ts:27 `check: z.string().min(1).optional()`; packages/kk-core/src/registry.ts:17 `check?: string` and :398 push `...(manifest.check !== undefined ? { check: resolve(dirPath, manifest.check) } : {})` |
| R2 | MET | apps/cli/src/invoke.ts:158 pluginProbeCmd builds `[execPath, entry, 'check', --headed?, --timeout?]`; :176 spawnPluginProbe pipes stdio with Bun `timeout`; :224 probeVerdict parses the last non-empty stdout line; apps/cli/src/commands/plugin.ts:196 checkOne drives it per selected record |
| R3 | MET | invoke.ts:224-260 probeVerdict: verified/refused trusted only on exit 0/1; crash/timeout/unknown status/malformed line → error with `probe exit N (malformed probe output)`; timeout surfaces as exit 2 via signalCode mapping (invoke.ts:190); plugin.ts:228 checkAction exits 1 on any refused/error; unsupported never fails |
| R4 | MET | probeVerdict returns only {status, profileDir?, detail?}; raw lines never leave invoke.ts:224; check --json shape asserted by apps/cli/tests/commands/plugin-check.test.ts AC1 test; E2E artifact .spur/run/e2e/E93-plugin-check.json carries no probe stdout/stderr |
| R5 | MET | invoke.ts:200 spawnPluginLogin inherits stdio and returns proc.exitCode ?? 1; plugin.ts:280 loginAction — unknown/no-check → usage error naming `check` (exit 2, echoError first); probe code propagates (test: 'login propagates the probe exit code', fixture exit 7) |
| R6 | MET | plugin.ts registerStatusVerb unchanged in shape; status report appends `check: <abs path>` only when present (AC5 test: 'status --json matches the pre-change shape plus check, spawning no probe') |
| R7 | MET | Same-change docs: docs/04_DESIGN.md §1 CLI block + command table + new `### plugin check` / `### plugin login` sections + §1.7 manifest `check` row + §0 satellite status; docs/05_FEATURES.md E93 row (partial: 0215 done, 0216 pending); docs/design/kk-plugin-check.md status + shipped probe contract |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | bun test apps/cli/tests/commands/plugin-check.test.ts -t 'reports verified' PASS; E2E artifact .spur/run/e2e/E93-plugin-check.json lists e2e-verified=verified, e2e-refused=refused, e2e-broken=error, e2e-unsupported=unsupported, exitCode 1 |
| AC2 | MET | command | bun test -t 'selecting only verified and unsupported fixtures exits 0' PASS |
| AC3 | MET | command | bun test -t 'never echoes probe stdout/stderr tokens and forwards --headed only when passed' PASS (fixture e2e-secret token absent from captured out/err; --headed forwarded only when the flag is passed) |
| AC4 | MET | command | bun test -t 'login propagates the probe exit code; missing check names the field' PASS (exit 7 propagated; no-check plugin → usage error naming check) |
| AC5 | MET | command | bun test -t 'status --json matches the pre-change shape plus check' PASS (no probe spawned; check listed as absolute path when present) |
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

- 2026-10-07T20:05:53.469Z todo → wip (system)
- 2026-10-07T20:05:54.209Z wip → testing (system)
- 2026-10-07T20:07:16.484Z testing → done (system)

