---
schema_version: 1
name: Add the kk music CLI noun over the music-gen plugin
status: backlog
template: feature-impl
created_at: 2026-11-18T22:16:15.981Z
updated_at: "2026-11-19T00:14:06.546Z"
feature_id: D8

ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 8
---

## 0388. Add the kk music CLI noun over the music-gen plugin

### Background

Implements: R1 — noun/verb surface; R2 — config resolution incl. prices and delivery profiles; R3 — free verbs stay offline; R4 — machine output; R5 — help and plugin-check parity.

The CLI is the platform's step owner ("`kk` owns steps; `spur workflow` owns orchestration") and it has already been reshaped into a two-layer executor + plugin noun surface with typed noun/verb registration (features A21/A22, task 0052). Music needs the same treatment so a workflow state, an agent skill and a human share one command surface instead of three ad-hoc scripts.

Config resolution has an established shape too: user config roots with environment overrides (feature M), so an endpoint belongs in config, never in code — which matters here because the instance address is machine-specific and, once tunnelled, may move behind Cloudflare Access.

### Requirements

- [ ] R1. Register a `music` noun with verbs `render`, `gen`, `library`, `analyze`, `check`, `master`, `presets` on the existing two-layer CLI surface. Each verb delegates to the plugin functions that own the behaviour: render/presets → 0384/0386, gen/analyze/library → 0385 behind the 0387 spend guard, check/master → 0394. No logic is duplicated in the CLI or the YAML.
- [ ] R2. Resolve plugin configuration from a `music:` block in the user config root with `KK_MUSIC_*` environment overrides and documented defaults: `baseUrl`, `timeoutMs`, `defaultModel`, `takesCap` (≤ 4), `prices.{pro,clip,analyze}`, `delivery.<profile>`. Fail with a one-line remediation naming the config key when the endpoint is unreachable.
- [ ] R3. Keep `render`, `presets list`, `check` and `master` free of instance traffic (prompt/preset inspection and local ffmpeg only), so a brief can be reviewed and diffed before any spend and a take can be re-checked or re-mastered without re-paying.
- [ ] R4. Emit `--json` for every verb with a stable shape (artifact paths, instance ids, digests, `paid`, spend, measurements, check results) for workflow and skill consumption, and human-readable output otherwise.
- [ ] R5. Make `kk music --help` and `kk plugins check` agree: every verb documents its paid/free nature (`gen` and `analyze` paid; the rest free), and the plugin's declared requirements (including `ffmpeg`/`ffprobe` for `check`/`master`) match the imports and binaries it actually uses.

### Acceptance Criteria

```gherkin
Scenario: AC1 — The noun is registered on the shared surface (req: R1)
  Given the CLI registration
  When kk music --help runs
  Then render, gen, library, analyze, check, master and presets are listed with their arguments
  And gen and analyze refuse without --yes through the 0387 guard

Scenario: AC2 — Config comes from the user root with an env override (req: R2)
  Given a user config with a base URL and an environment override for the same key
  When any networked verb resolves its endpoint
  Then the environment value wins and is reported in verbose output
  And with no config and no override the documented default is used
  And an unreachable endpoint yields a one-line remediation naming the config key
  And takesCap above 4 is rejected at load

Scenario: AC3 — Free verbs never reach the instance (req: R3)
  Given render, presets list, check and master on an existing take
  When they run with the instance unreachable
  Then all four succeed
  And none attempts a connection to the instance

Scenario: AC4 — JSON output is stable and complete (req: R4)
  Given completed gen, analyze, check and master runs in dry-run mode
  When each verb is invoked with --json
  Then each payload carries artifact path, instance id, digest, paid and spend, plus measurements and check results where applicable
  And a snapshot test pins each shape

Scenario: AC5 — Help and plugin check agree (req: R5)
  Given the registered verbs and the plugin code
  When kk music --help and kk plugins check run
  Then gen and analyze are marked paid and the rest free
  And declared runtime requirements, including ffmpeg and ffprobe, match actual usage
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- **Register, do not re-implement.** Workflow states call `kk music <verb>`, and the verbs call the plugin's `src/` functions, so a behaviour change lands once.
- **Paid-verb marking.** Help text and the JSON payload both carry `paid: true|false`. Agent skills and humans read it, and the workflow's confirmation gate keys off it.
- **Config keys.** `music.{baseUrl,timeoutMs,defaultModel,takesCap,prices,delivery}` with `KK_MUSIC_*` overrides. Nothing machine-specific is committed, which keeps the plugin portable across the operator's machines. `lufsTarget` from the first draft is replaced by named delivery profiles (0394 R5).
- **Dependency.** Blocked by 0385, 0386, 0387 and 0394 (the verbs wrap their functions).
- **Estimate.** 8h: seven verbs, config block, JSON shapes and snapshots, help text, tests.

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-19T00:14:06.546Z feature_id Q → D8 (system)

