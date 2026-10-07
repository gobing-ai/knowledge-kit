---
schema_version: 1
name: kk plugin check / login verbs + manifest check field (ADR-032)
status: done
template: feature-impl
created_at: 2026-10-07T18:29:44.442Z
updated_at: "2026-10-07T23:04:49.912Z"
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

- **Manifest field:** optional non-empty `check` in `PluginManifestSchema` (`packages/kk-core/src/manifest.ts:27`), carried on `PluginRecord` resolved to an absolute path (`packages/kk-core/src/registry.ts:17`, `packages/kk-core/src/registry.ts:398`).
- **Spawn seam:** `pluginProbeCmd` / `spawnPluginProbe` / `spawnPluginLogin` in `apps/cli/src/invoke.ts:158-200` reuse the `executor run` execPath + operator-config env; the probe runs synchronously with a timeout (signal → exit 2, `apps/cli/src/invoke.ts:190`), sequentially because browser profiles are single-writer.
- **Verdict parsing:** `probeVerdict` (`apps/cli/src/invoke.ts:224`) trusts `verified`/`refused` only on exit 0/1; anything else is `error`. A malformed last line yields `probe exit <n> (malformed probe output)` and never echoes the line; a well-formed `error` verdict's probe-authored detail is shown (`apps/cli/src/invoke.ts:253`, added in the E93 re-verify).
- **Verbs:** `plugin check` (`apps/cli/src/commands/plugin.ts:196-229`) and `plugin login` (`apps/cli/src/commands/plugin.ts:281`) on the existing noun; `plugin status` (`apps/cli/src/commands/plugin.ts:320`) still spawns nothing and only lists `check`.
- **Fixtures + E2E:** `apps/cli/tests/fixtures/plugins/**/e2e-*` (verified, refused, broken, slow, secret, unsupported); `apps/cli/tests/commands/plugin-check.test.ts` writes `.spur/run/e2e/E93-plugin-check.json`.
- **Docs (T3):** `docs/04_DESIGN.md` plugin check/login sections + manifest row; `docs/05_FEATURES.md` E93 row; satellite `docs/design/kk-plugin-check.md`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Optional non-empty check field at `packages/kk-core/src/manifest.ts:27`; PluginRecord carries it at `packages/kk-core/src/registry.ts:17`, resolved absolute at `packages/kk-core/src/registry.ts:398` |
| R2 | MET | Verb options at `apps/cli/src/commands/plugin.ts:353-356`; per-record probe at `apps/cli/src/commands/plugin.ts:196`; argv built by pluginProbeCmd at `apps/cli/src/invoke.ts:158`, spawned with operator-config env at `apps/cli/src/invoke.ts:176`; last stdout line parsed at `apps/cli/src/invoke.ts:224` |
| R3 | MET | Exit 0/1 trust rule and error collapse at `apps/cli/src/invoke.ts:224-255`; timeout signal mapped to exit 2 at `apps/cli/src/invoke.ts:190`; run exit decided at `apps/cli/src/commands/plugin.ts:229`; tests `apps/cli/tests/commands/plugin-check.test.ts:48`, `apps/cli/tests/commands/plugin-check.test.ts:70`, `apps/cli/tests/invoke.test.ts:913` |
| R4 | MET | Only status, profileDir and detail leave probeVerdict at `apps/cli/src/invoke.ts:224-255`; a malformed line never reaches the detail (`apps/cli/tests/invoke.test.ts:918`); a probe-authored error detail is carried (`apps/cli/src/invoke.ts:253`, `apps/cli/tests/invoke.test.ts:908`); token test `apps/cli/tests/commands/plugin-check.test.ts:108` |
| R5 | MET | Inherited-stdio login at `apps/cli/src/invoke.ts:200`; usage errors naming check at `apps/cli/src/commands/plugin.ts:281-293`; test `apps/cli/tests/commands/plugin-check.test.ts:119` |
| R6 | MET | Status verb registered at `apps/cli/src/commands/plugin.ts:320` spawns nothing; shape test `apps/cli/tests/commands/plugin-check.test.ts:159` |
| R7 | MET | Probe contract in `docs/04_DESIGN.md:186-196` (updated this run for the error-detail rule); satellite `docs/design/kk-plugin-check.md:48-70`; E93 row in `docs/05_FEATURES.md:81` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — plugin check reports one verdict per plugin that declares a probe | MET | test | `apps/cli/tests/commands/plugin-check.test.ts:48` reports verified, refused, error and unsupported over the fixture tree; artifact written by `apps/cli/tests/commands/plugin-check.test.ts:76` to .spur/run/e2e/E93-plugin-check.json (re-run this turn) |
| R2 — plugins without a probe report unsupported and never fail the run | MET | test | `apps/cli/tests/commands/plugin-check.test.ts:102` selecting only verified and unsupported fixtures exits 0 |
| R3 — a broken probe is reported as an error, not as verified | MET | test | `apps/cli/tests/commands/plugin-check.test.ts:48` (exit 2 malformed fixture), `apps/cli/tests/commands/plugin-check.test.ts:70` (timeout), `apps/cli/tests/commands/plugin-check.test.ts:224` (missing entry), `apps/cli/tests/invoke.test.ts:913` (status/exit mismatch stays error) |
| R4 — check is read-only and secret-free | MET | test | `apps/cli/tests/commands/plugin-check.test.ts:108` token absent from kk stdout and stderr, --headed forwarded only when passed; `apps/cli/tests/invoke.test.ts:918` line text never becomes the detail |
| R5 — plugin login runs the plugin's interactive login | MET | test | `apps/cli/tests/commands/plugin-check.test.ts:119` probe exit 7 propagated; plugin without check is a usage error naming check |
| R7 — plugin status stays static | MET | test | `apps/cli/tests/commands/plugin-check.test.ts:159` status --json keeps the pre-change shape plus check and spawns no probe |
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

