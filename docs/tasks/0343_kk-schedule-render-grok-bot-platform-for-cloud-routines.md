---
schema_version: 1
name: kk schedule render grok-bot platform for cloud routines
status: todo
template: feature-impl
created_at: 2026-11-04T23:00:28.338Z
updated_at: "2026-11-04T23:44:25.245Z"
feature_id: F81

dependencies: ["0341", "0342"]
ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 5
---

## 0343. kk schedule render grok-bot platform for cloud routines

### Background

Task 0343 delivers feature F81 scenario R2: `kk schedule render` gains a `grok-bot` platform, which prints a Grok Bot routine definition for a shipped kk schedule. As with launchd/cron, kk only prints; creating the routine in the Bot is an operator action. No routine-creation API is documented (https://docs.x.ai/grok-bot/skills-routines-and-automations).

Current surface (verified 2026-11-04, `apps/cli/src/commands/schedule.ts`):
- `type SchedulePlatform = 'launchd' | 'cron'`
- `SCHEDULE_TEMPLATES` covers kk-collect (launchd, cron), kk-serve (launchd), and kk-daily-publish3-cn-peak / -overseas (cron).
- `renderAction` hard-codes the `launchd|cron` check. It substitutes `{{repo}}`, `{{home}}` and `{{typesafe_api_key}}`, and fails with `CommanderError(1, 'kk.schedule.render.failed', …)`.
- Tests: `apps/cli/tests/commands/schedule.test.ts`. Templates: `plugins/kk/schedules/`. Surface doc: `docs/04_DESIGN.md:97,126,1120`.

The cloud boundary comes from ADR-044 (task 0341):
- `kk.db` never leaves the Mac. The cloud runs only store-free, browser-free work.
- Output goes to branch `kk-cloud-sync`, path `sync/<schedule>/<stamp>.json`, with stamp `YYYYMMDDTHHMMZ`.
- The Mac imports with `kk store ingest --run cloud-<stamp> --in <file>`.
- Policy: `no-content: <reason>` when empty, 26 h staleness, import once.

kk-collect's cloud-safe prefix is store-free (verified): `kk stage collect-prepare <stamp> <limit> <topic> <horizonHours>` writes only `.works/kk-collect/<stamp>` and `.spur/runs/kk-collect/*`. `kk executor fan-in --source <plugin>:<file> … --out <file>` merges the aihot/last30days/horizon Doc[] (`plugins/kk/workflows/kk-collect.yaml:61,116-121`, defaults `limit=10`, `last30days_topic="AI news"`, `horizon_hours=6`).

Grok Bot limits: routine intervals are ≥5 min, with 200 runs/hour/routine (same docs URL).

**Refine corrections (2026-11-04)**

- F81 R2 says "a live-publish workflow requires explicit approval". Publish3 needs the store, the frozen bundle and browser profiles, all Mac-local under ADR-044. So it is refused on grok-bot, not gated. Amending that feature AC is proposed and not applied here.
- `kk schedule render` has no `--live-channels` flag. Consent is baked into the publish3 cron templates (ADR-022). There is nothing to refuse beyond the publish3 schedules themselves.
- Only kk-collect gets a grok-bot template. kk-serve is a Mac keepalive, which is meaningless in the cloud.

### Requirements

- [ ] R1. Extend `SchedulePlatform` to `'launchd' | 'cron' | 'grok-bot'`. Validate against one `SCHEDULE_PLATFORMS` array, and use the same array in the `unknown platform` message and the `--platform` help text. Add `'grok-bot': 'kk-collect.grok-bot.md.tmpl'` to kk-collect only.
- [ ] R2. Add `plugins/kk/schedules/kk-collect.grok-bot.md.tmpl`, a Markdown routine definition the operator pastes into the Bot. Its fixed headings are:
  - `Owner Bot`: `{{bot}}`
  - `Schedule`: `{{cron}}` in `{{tz}}`
  - `Inputs`: the Bot needs `kk`/`spur` (sp-bot-bootstrap), the three source plugins' credentials as Bot secrets, and push access to `kk-cloud-sync`
  - `Steps`: stamp = `date -u +%Y%m%dT%H%MZ`; `kk stage collect-prepare "$stamp" 10 "AI news" 6`; `kk executor fan-in` with the same three `--source` lines and horizon override as `kk-collect.yaml:116-121`, `--out sync/kk-collect/$stamp.json`; commit and push to `kk-cloud-sync`. An all-sources failure writes `no-content: <reason>` instead.
  - `Expected result`
  - `Approval boundary`: collect only; never store, label, generate or publish
  - `Missing / stale`: the ADR-044 policy
  - `Mac import`: `kk store ingest --run cloud-<stamp> --in <file>`
- [ ] R3. Add grok-bot-only flags `--bot <name>` (required for grok-bot), `--tz <iana>` (default: the rendering host's `Intl.DateTimeFormat().resolvedOptions().timeZone`) and `--cron <expr>` (default `0 4,10,16,22 * * *`, kk-collect's cadence). `--cron` must have 5 fields. Reject it when the minimum circular gap of its minute-field set is under 5 minutes, which rejects `*` and `*/2`. Supply `--bot`/`--tz`/`--cron` with launchd/cron and the render fails with `--bot/--tz/--cron are only valid with --platform grok-bot`.
- [ ] R4. A grok-bot render of a schedule without a grok-bot template fails with exit 1 and appends: `cloud routines run store-free, browser-free work only (ADR-044)`. This covers both publish3 schedules and kk-serve. The existing launchd/cron messages stay byte-identical.
- [ ] R5. The grok-bot render substitutes no credential: the template carries no `{{typesafe_api_key}}`, and even with `TYPESAFE_API_KEY` set the output never contains its value. No placeholder `{{` survives a render.
- [ ] R6. Update `docs/04_DESIGN.md:97,126` and §1.11 (`:1120`) to show `--platform launchd|cron|grok-bot` and the three flags. Add a Grok Bot block to `plugins/kk/README.md` §Schedule with the render line and the "paste into the Bot's routine editor" operator step.
- [ ] R7. Add tests to `apps/cli/tests/commands/schedule.test.ts` covering AC1–AC4, and run `bun run lint` and `bun run spur-check` green.

Out of scope:
- creating routines via an API;
- webhook notification (spur 1293 owns the recipe);
- a cloud publish path;
- Mac-side auto-import of the sync branch.

### Acceptance Criteria

```gherkin
Scenario: AC1 — kk-collect renders a complete grok-bot routine (req: R1, R2, R3)
  Given `kk schedule render kk-collect --platform grok-bot --bot kk-cloud --tz America/Los_Angeles`
  When it runs
  Then it exits 0 and prints the eight fixed headings with Owner Bot `kk-cloud`, Schedule `0 4,10,16,22 * * *` in `America/Los_Angeles`, the fan-in `--out sync/kk-collect/$stamp.json` step, and the `kk store ingest --run cloud-<stamp>` import line, with no `{{` left

Scenario: AC2 — Invalid grok-bot inputs fail loud (req: R3)
  Given a grok-bot render without `--bot`, or with `--cron "*/2 * * * *"`, or with a 4-field `--cron`, or `--bot` passed with `--platform cron`
  When each runs
  Then each exits 1 with a `kk.schedule.render.failed:` message naming the bad input, and prints nothing on stdout

Scenario: AC3 — Store- or browser-bound schedules are refused on grok-bot (req: R4)
  Given kk-daily-publish3-cn-peak, kk-daily-publish3-overseas and kk-serve
  When each is rendered with `--platform grok-bot --bot b`
  Then each exits 1 with the ADR-044 sentence, and the launchd/cron refusals stay byte-identical to today

Scenario: AC4 — No credential leaks into the routine text (req: R5)
  Given `TYPESAFE_API_KEY=apikey_test_leak` in the environment
  When kk-collect is rendered for grok-bot
  Then stdout does not contain `apikey_test_leak`

Scenario: AC5 — Surface docs updated and gates green (req: R6, R7)
  Given the change set
  When `docs/04_DESIGN.md`, `plugins/kk/README.md` §Schedule are read and `bun run lint` + `bun run spur-check` run
  Then both docs show `--platform launchd|cron|grok-bot` with `--bot/--tz/--cron`, the README carries the paste-into-routine step, and both gates pass
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-04T23:44:14.525Z

- **CLOSED — Markdown routine text, not JSON.** The Bot's routine editor takes natural-language instructions, and no import schema is documented. Fixed headings keep the output testable.
- **CLOSED — publish3 is refused, not gated.** ADR-044 keeps the store, bundle and browser profiles on the Mac. A feature AC amendment to F81 R2 is proposed to the operator.
- **CLOSED — 5-minute check on the minute field only.** A conservative minimum circular gap rejects every sub-5-min cadence; hour-field-only cadences are all ≥60 min. Rejecting legal-but-odd expressions is acceptable.
- **CLOSED — `--tz` defaults to the host zone.** The rendered text always states the zone explicitly, so the routine is unambiguous.
- **DEFERRED — webhook notification inside the routine.** Spur 1293 owns that recipe. Revisit if kk needs a kk-specific notify.

### Design

**WHAT/WHERE.**
- `apps/cli/src/commands/schedule.ts`: platform array, template entry, flags, and validation inside `renderAction`. Keep the existing `try … throw new CommanderError(1,'kk.schedule.render.failed', message)` shape.
- `plugins/kk/schedules/kk-collect.grok-bot.md.tmpl` (new).
- `apps/cli/tests/commands/schedule.test.ts`: use the existing `run([...])` helper.
- `docs/04_DESIGN.md`.
- `plugins/kk/README.md`.

**Frozen names.**
- Constants: `SCHEDULE_PLATFORMS = ['launchd','cron','grok-bot'] as const` (`SchedulePlatform` derives from it), `DEFAULT_GROK_CRON = '0 4,10,16,22 * * *'`, `GROK_MIN_INTERVAL_MINUTES = 5`.
- Placeholders: `{{bot}}`, `{{cron}}`, `{{tz}}`.
- Helper: `minuteGap(expr): number`. It expands `*`, `*/n`, `a-b`, `a-b/n` and comma lists over 0–59, and returns the minimum circular gap (60 for a single minute).

**Render path.**
- The grok-bot branch substitutes only `{{bot}}`, `{{cron}}` and `{{tz}}`. The launchd/cron path keeps its existing `{{repo}}`/`{{home}}`/`{{typesafe_api_key}}` substitution unchanged, because the Bot runs in its own checkout.
- `--repo` is accepted and ignored for grok-bot. It defaults to cwd, so it cannot be told apart from an explicit value. The template uses relative paths.
- After substitution, assert no `{{` remains, the same invariant the launchd test checks.

**Invariants.**
- kk never installs: the only side effect is stdout.
- The cloud template never runs `kk store`, `kk store label`, a generator or a publisher.
- The launchd/cron output and error text stay byte-identical.

**Anti-patterns.**
- Adding a grok-bot template for publish3 behind a flag.
- Baking credentials into routine text.
- Inventing a Grok routine API call.
- Copying the fan-in source list without citing `kk-collect.yaml` in a template comment (drift).

**Handoff.** The implementer may tune the routine prose. Headings, step commands, flags and error strings are frozen.

### Plan

- [ ] 1. Add failing tests for AC1–AC4 to `schedule.test.ts` (R7).
- [ ] 2. Add the platform array, template entry, flags and validation in `schedule.ts` (R1, R3, R4, R5).
- [ ] 3. Write `kk-collect.grok-bot.md.tmpl` (R2).
- [ ] 4. Iterate to green, then confirm the existing launchd/cron tests pass unchanged.
- [ ] 5. Update `docs/04_DESIGN.md` and the README §Schedule block (R6).
- [ ] 6. Run `bun run lint` and `bun run spur-check`; check `git status --short` (R7).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: `docs/features/F81_grok-bot-cloud-routines-for-knowledge-kit.md` (R2)
- Depends on: 0341 (ADR-044 cloud boundary), 0342 (requires annotations)
- Source: `apps/cli/src/commands/schedule.ts`, `plugins/kk/workflows/kk-collect.yaml:55-121`
- Grok Bot routines: https://docs.x.ai/grok-bot/skills-routines-and-automations
- Related: spur 1292 (bootstrap), spur 1293 (webhook notify recipe)

### History

- 2026-11-04T23:03:30.711Z feature_id Q → F81 (system)
- 2026-11-04T23:44:25.245Z backlog → todo (system)

