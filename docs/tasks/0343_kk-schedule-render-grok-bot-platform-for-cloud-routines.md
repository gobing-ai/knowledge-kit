---
schema_version: 1
name: kk schedule render grok-bot platform for cloud routines
status: done
template: feature-impl
created_at: 2026-11-04T23:00:28.338Z
updated_at: "2026-11-05T05:09:25.375Z"
feature_id: F81

dependencies: ["0341", "0342"]
ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 5
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0343-verdict.json
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

- [x] R1. Extend `SchedulePlatform` to `'launchd' | 'cron' | 'grok-bot'`. Validate against one `SCHEDULE_PLATFORMS` array, and use the same array in the `unknown platform` message and the `--platform` help text. Add `'grok-bot': 'kk-collect.grok-bot.md.tmpl'` to kk-collect only.
- [x] R2. Add `plugins/kk/schedules/kk-collect.grok-bot.md.tmpl`, a Markdown routine definition the operator pastes into the Bot. Its fixed headings are:
  - `Owner Bot`: `{{bot}}`
  - `Schedule`: `{{cron}}` in `{{tz}}`
  - `Inputs`: the Bot needs `kk`/`spur` (sp-bot-bootstrap), the three source plugins' credentials as Bot secrets, and push access to `kk-cloud-sync`
  - `Steps`: stamp = `date -u +%Y%m%dT%H%MZ`; `kk stage collect-prepare "$stamp" 10 "AI news" 6`; `kk executor fan-in` with the same three `--source` lines and horizon override as `kk-collect.yaml:116-121`, `--out sync/kk-collect/$stamp.json`; commit and push to `kk-cloud-sync`. An all-sources failure writes `no-content: <reason>` instead.
  - `Expected result`
  - `Approval boundary`: collect only; never store, label, generate or publish
  - `Missing / stale`: the ADR-044 policy
  - `Mac import`: `kk store ingest --run cloud-<stamp> --in <file>`
- [x] R3. Add grok-bot-only flags `--bot <name>` (required for grok-bot), `--tz <iana>` (default: the rendering host's `Intl.DateTimeFormat().resolvedOptions().timeZone`) and `--cron <expr>` (default `0 4,10,16,22 * * *`, kk-collect's cadence). `--cron` must have 5 fields. Reject it when the minimum circular gap of its minute-field set is under 5 minutes, which rejects `*` and `*/2`. Supply `--bot`/`--tz`/`--cron` with launchd/cron and the render fails with `--bot/--tz/--cron are only valid with --platform grok-bot`.
- [x] R4. A grok-bot render of a schedule without a grok-bot template fails with exit 1 and appends: `cloud routines run store-free, browser-free work only (ADR-044)`. This covers both publish3 schedules and kk-serve. The existing launchd/cron messages stay byte-identical.
- [x] R5. The grok-bot render substitutes no credential: the template carries no `{{typesafe_api_key}}`, and even with `TYPESAFE_API_KEY` set the output never contains its value. No placeholder `{{` survives a render.
- [x] R6. Update `docs/04_DESIGN.md:97,126` and §1.11 (`:1120`) to show `--platform launchd|cron|grok-bot` and the three flags. Add a Grok Bot block to `plugins/kk/README.md` §Schedule with the render line and the "paste into the Bot's routine editor" operator step.
- [x] R7. Add tests to `apps/cli/tests/commands/schedule.test.ts` covering AC1–AC4, and run `bun run lint` and `bun run spur-check` green.

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

Scenario: R2 — Routine render is complete and consent-preserving (R2)
  Given a shipped kk schedule in the schedule store
  When `kk schedule render --platform grok-bot` prints the routine
  Then the printed routine is complete (schedule, run script, Mac import recipe, required operator inputs) and consent-preserving: kk only prints, creating the routine in the Grok Bot stays an explicit operator action
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

- [x] 1. Add failing tests for AC1–AC4 to `schedule.test.ts` (R7).
- [x] 2. Add the platform array, template entry, flags and validation in `schedule.ts` (R1, R3, R4, R5).
- [x] 3. Write `kk-collect.grok-bot.md.tmpl` (R2).
- [x] 4. Iterate to green, then confirm the existing launchd/cron tests pass unchanged.
- [x] 5. Update `docs/04_DESIGN.md` and the README §Schedule block (R6).
- [x] 6. Run `bun run lint` and `bun run spur-check`; check `git status --short` (R7).

### Solution

New `grok-bot` render platform, tests-first (red→green), print-only like launchd/cron.

- **Platform + template plumbing** — `apps/cli/src/commands/schedule.ts:8-9` (`SCHEDULE_PLATFORMS = ['launchd','cron','grok-bot']` with derived `SchedulePlatform`); `apps/cli/src/commands/schedule.ts:31` adds `kk-collect`'s `'grok-bot'` entry (only schedule with a cloud-safe store-free prefix); `apps/cli/src/commands/schedule.ts:55-58` frozen grok constants (`GROK_MIN_INTERVAL_MINUTES = 5`, `DEFAULT_GROK_CRON = '0 4,10,16,22 * * *'`); `apps/cli/src/commands/schedule.ts:100-127` `minuteGap()` (minute-field-only circular gap; wrap-around fix `58,4` → 6); schedule.ts:52-58 constants; platform help text single source for the platform help text.
- **RenderAction** — `apps/cli/src/commands/schedule.ts:165-190` grok-body vs artifact branch; `apps/cli/src/commands/schedule.ts:173-175` `--bot/--tz/--cron are only valid with --platform grok-bot` (AC2d); `apps/cli/src/commands/schedule.ts:179-186` unknown-template refusal carrying the ADR-044 sentence (`schedule 'kk-serve' has no grok-bot template — cloud routines run store-free, browser-free work only (ADR-044)', AC3) while launchd/cron refusals stay byte-identical; `apps/cli/src/commands/schedule.ts:192-207` substitution split — grok-bot binds ONLY `{{bot}}`/`{{cron}}`/`{{tz}}` (no TYPESAFE_API_KEY substitution — AC4) with the `{{typesafe_api_key}}` plist binding untouched for launchd/cron; leftover-`{{` fail-loud guard `apps/cli/src/commands/schedule.ts:201-203`.
- **Grok body validation** — `apps/cli/src/commands/schedule.ts:216-240` `renderGrokBody()`: `--bot` required (AC2a), 5-field cron syntax check (AC2c), <5-min gaps rejected via `minuteGap` (AC2b), host-zone tz default `apps/cli/src/commands/schedule.ts:197`.
- **Commander options** — `apps/cli/src/commands/schedule.ts:250-256` `--platform` from the array, plus `--bot/--tz/--cron` (R3).
- **Template** — `plugins/kk/schedules/kk-collect.grok-bot.md.tmpl:1-69` (new): ADR-044 preamble, 8 fixed headings (Owner Bot, Schedule, Inputs, Steps, Expected result, Approval boundary, Missing / stale, Mac import), ADR-044 policy table verbatim (`no-content: <reason>` / 26 h staleness / import-once by `cloud-<stamp>` id), `kk store ingest --run cloud-<stamp>` Mac import, operator-paste consent note. Only `{{bot}}`/`{{cron}}`/`{{tz}}` placeholders — R2.
- **Tests** — `apps/cli/tests/commands/schedule.test.ts:259-407` new describe `kk schedule render — grok-bot cloud routine (task 0343)`: AC1 (8 headings + ADR-044 sentences + env-leak check), AC2a–AC2d, AC3 (kk-serve + both publish3 windows refused with the ADR sentence; launchd/cron texts byte-identical), AC4 credential-leak, R3 default cron+tz; R6 registration test extended to 5 options (`apps/cli/tests/commands/schedule.test.ts:112-121`).
- **Docs (R6)** — `docs/04_DESIGN.md:97` command line + §1.9 `schedule render` row (:127), `docs/04_DESIGN.md:1120-1131` §1.11 grok-bot text + policy-table rows for `kk-collect`/`grok-bot` and `kk-serve`/`grok-bot` refusal; `plugins/kk/README.md:51-59` §Schedule Grok Bot block (`--bot kk-cloud`, `pbcopy` paste workflow, refusal note).

Out of scope (task Design): routine-creation API/webhook, cloud publish, Mac auto-import. Grok interval citation: https://docs.x.ai/grok-bot/skills-routines-and-automations.

#

#

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Printed render verified on host: `bun src/index.ts schedule render kk-collect --platform grok-bot --bot kk-cloud` emits all eight fixed headings in order (`## Owner Bot` … `## Mac import`, template plugins/kk/schedules/kk-collect.grok-bot.md.tmpl:11-69), zero `{{` left; complete definition carries schedule, steps, `--out sync/kk-collect/$stamp.json` fan-in, ADR-044 missing/stale table and the `kk store ingest --run cloud-<stamp>` Mac import; consent preserved — kk only prints (`apps/cli/src/commands/schedule.ts:163-207`, `consoleOutput.write` is the sole side effect), template's operator-paste preamble is the consent note |
| R2 | MET | Scenario rows below — routine complete (AC1 test asserts heading order + placeholder-free body, apps/cli/tests/commands/schedule.test.ts:284-310) and consent-preserving (template layout + no creation step; `{{bot}}`/`{{cron}}`/`{{tz}}` substitution only) |
| R3 | MET | ADR-044 store-locality followed, not re-decided: template routes all store work to the Mac (`## Mac import` block) and the Steps section forbids `kk store` in the Bot; the 5-minute floor is validated in code (render refuses `--cron '*/2 * * * *'` naming the floor, apps/cli/src/commands/schedule.ts:229-235) |
| R4 | MET | AC3 test: kk-serve and both publish3 windows refused on grok-bot with the exact ADR-044 sentence (apps/cli/tests/commands/schedule.test.ts:364-384; refusal at apps/cli/src/commands/schedule.ts:179-186); launchd/cron render texts byte-identical (same test) |
| R5 | MET | AC4 test with `TYPESAFE_API_KEY=apikey_test_leak` exported: stdout contains neither the secret nor `{{` (apps/cli/tests/commands/schedule.test.ts:385-395); grok-bot substitution branch binds no credential var (apps/cli/src/commands/schedule.ts:192-199) |
| R6 | MET | docs/04_DESIGN.md:97 command line now carries `--platform launchd |
| R7 | MET | `bun run lint` exit 0; `bun run spur-check` exit 0 — 4477 pass / 0 fail + rule run 2/2 PASS (.spur/run/run-0343-spur-check.log); receipt .spur/run/0343-check-receipt.json (full tier, `spur self exec check`) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — kk-collect renders a complete grok-bot routine (req: R1, R2, R3) | MET | test | `bun test apps/cli/tests/commands/schedule.test.ts` → 16 pass / 0 fail / 240 expects; AC1 test asserts exit 0, the eight headings in order, Owner Bot `kk-cloud`, default cron+tz, fan-in `--out sync/kk-collect/$stamp.json`, `kk store ingest --run cloud-<stamp>`, and no `{{` (apps/cli/tests/commands/schedule.test.ts:284-310) |
| AC2 — Invalid grok-bot inputs fail loud (req: R3) | MET | test | split tests assert exit 1 + `kk.schedule.render.failed:` naming the bad input, empty stdout: no `--bot` (apps/cli/tests/commands/schedule.test.ts:311-327), `*/2 * * * *` sub-5-minutes (:328-337), 4-field cron (:338-346), `--bot` with `--platform cron` (:347-363); validation lives at apps/cli/src/commands/schedule.ts:220-235 and :173-175 |
| AC3 — Store- or browser-bound schedules are refused on grok-bot (req: R4) | MET | test | refusal test hits kk-daily-publish3-cn-peak, kk-daily-publish3-overseas, kk-serve with the verbatim ADR-044 sentence and confirms kk-collect's launchd/cron renders are byte-identical to before the change (apps/cli/tests/commands/schedule.test.ts:364-384) |
| AC4 — No credential leaks into the routine text (req: R5) | MET | test | env-leak test above (apps/cli/tests/commands/schedule.test.ts:385-395) — secret never reaches stdout |
| AC5 — Surface docs updated and gates green (req: R6, R7) | MET | command | docs/04_DESIGN.md:97 + 1120-1131 + README §Schedule carry the new platform/flags; `bun run lint` && `bun run spur-check` exit 0 (4477 pass / 0 fail); gate receipt PASS (.spur/run/0343-check-receipt.json) |
| R2 — Routine render is complete and consent-preserving (R2) | MET | command | feature scenario satisfied by the printed routine: owning Bot, schedule+timezone, inputs (source plugins + Bot secrets + push access), steps, expected result, approval boundary, missing/stale policy all present in the rendered text; creation stays an operator action (template preamble + no API call in the command; the command only writes stdout) |
| R3 — Store locality decision precedes cloud execution (R3) | MET | command | rendered routine is store-free on the Bot (no `kk store` step; `## Mac import` binds publication/import to the Mac) and sub-5-minute cadences are rejected — the ADR-044 locality rule is enforced, not assumed |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

All seven requirements MET with per-AC traceability in the review answer (`.spur/run/ed0f5b34-71ed-46de-9c35-09f47c63d06d-review-answer.txt`), cert at `.spur/run/ed0f5b34-71ed-46de-9c35-09f47c63d06d-review-cert.md`. Full working-tree diff vs base 2054d7e reviewed: 5 modified files + the new grok-bot template; no unrelated drift (`git status --short` shows only the six intended files). Verdict linted: `spur task verdict 0343 --from-answer` → **PASS (7 requirements, 2 checks)** on first capture. No open P1–P3 findings — two P4 advisories (minute-field-only gap validation; template fan-in source-list drift hazard, documented in the template).

Confidence: HIGH

## Sparse Review

#### Coverage — dims: coverage, quality, consistency, security, risk

| Priority | Finding | Disposition |
| -------- | ------- | ----------- |
| P4 | `minuteGap` validates the cron MINUTE field only — hour/day overlap cases are not surfaced; conservative by task Design | accepted: conservative circular-gap floor, stricter than a full cron parser |
| P4 | the template copies the fan-in source list from `plugins/kk/workflows/kk-collect.yaml:116-121` — a workflow source change without re-render drifts the routine | accepted: drift hazard documented in the template's Inputs section |

No open P1–P3 findings (auto-repairs file has no entries; quality gate passed attempts=1). AC1–AC5 all trace to executed tests or verified gate artifacts; the print-only consent contract holds in code (apps/cli/src/commands/schedule.ts:163-207), refusals fail loud with no stdout (existing launchd/cron tests pass unchanged), and no store/ring/credential path is touched. Residual risk: the group snapshot says nothing — feature scenario R3/F81 is covered by the enforced locality rule in the rendered routine.
**Conclusion:** Implementation is complete, tests are meaningful (red-first guard suite covering every refusal branch plus the full-artifact render), consistency with existing launchd/cron surfaces is verified byte-identical where required, and no security or consent regressions were found.

| Req | Status | Evidence | Evidence Type |
| --- | ------ | -------- | ------------- |
| R1 | MET | rendered routine print verified (see review answer R1; apps/cli/src/commands/schedule.ts:163-207) | command |
| R2 | MET | AC1 test + scenario rows in the review answer (apps/cli/tests/commands/schedule.test.ts:284-310) | command |
| R3 | MET | store-free template bodies + 5-minute floor validation (apps/cli/src/commands/schedule.ts:229-235) | command |
| R4 | MET | AC3 refusal test (apps/cli/tests/commands/schedule.test.ts:364-384) | test |
| R5 | MET | AC4 env-leak test (apps/cli/tests/commands/schedule.test.ts:385-395) | test |
| R6 | MET | docs/04_DESIGN.md:97,1120-1131; plugins/kk/README.md:72-79 | static-ref |
| R7 | MET | `bun run lint` exit 0; `bun run spur-check` exit 0 (4477 pass / 0 fail); gate receipt PASS | command |
| AC | Status | Evidence Type | Evidence |
| AC1 | MET | schedule.test.ts AC1 — 16 pass / 0 fail suite (schedule.test.ts:284-310) | test |
| AC2 | MET | AC2a-2d fail-loud tests (schedule.test.ts:311-363) | test |
| AC3 | MET | AC3 refusal + byte-identical test (schedule.test.ts:364-384) | test |
| AC4 | MET | AC4 env-leak test (schedule.test.ts:385-395) | test |
| AC5 | MET | docs + lint/spur-check/gate artifacts (receipt 0343-check-receipt.json) | command |
| R2 — Routine render is complete and consent-preserving (R2) | MET | feature scenario row in the review answer | command |
| R3 — Store locality decision precedes cloud execution (R3) | MET | feature scenario row in the review answer | command |

Verdict: PASS

### References

- Feature: `docs/features/F81_grok-bot-cloud-routines-for-knowledge-kit.md` (R2)
- Depends on: 0341 (ADR-044 cloud boundary), 0342 (requires annotations)
- Source: `apps/cli/src/commands/schedule.ts`, `plugins/kk/workflows/kk-collect.yaml:55-121`
- Grok Bot routines: https://docs.x.ai/grok-bot/skills-routines-and-automations
- Related: spur 1292 (bootstrap), spur 1293 (webhook notify recipe)

### History

- 2026-11-04T23:03:30.711Z feature_id Q → F81 (system)
- 2026-11-04T23:44:25.245Z backlog → todo (system)
- 2026-11-05T04:38:23.862Z todo → wip (system)
- 2026-11-05T05:03:41.742Z wip → testing (system)
- 2026-11-05T05:09:25.362Z testing → done (system)

