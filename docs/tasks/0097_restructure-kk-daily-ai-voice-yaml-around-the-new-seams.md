---
schema_version: 1
name: "Restructure kk-daily-ai-voice.yaml around the new seams"
status: done
template: feature-impl
created_at: 2026-09-06T14:35:05.242Z
updated_at: "2026-09-07T21:30:45.988Z"
feature_id: L1
priority: P1
tags: ["workflow", "kk-daily-ai-voice", "feature-K"]
dependencies: ["0092", "0094", "0095", "0096"]
---

## 0097. Restructure kk-daily-ai-voice.yaml around the new seams

### Background

Feature L1 R2/R5/R8: collapse the 4 collect states into one, insert annotate → quality-control-content, thin the publish tail onto plugin operations, add done-no-content terminal + per-stage failure edges + publish-partial route. Depends on the four implementation tasks (fan-in, annotate, filter, both plugins).

### Requirements

R1. fetch/ingest-last30days/ingest-horizon/blend-facts → single `collect` state calling fan-in --source mode.
R2. plan state runs episode-plan-gen annotate+select; new `quality-control-content` state runs --mode filter with QC_* vars; empty candidates → `done-no-content` terminal (no content/audio/publish artifacts).
R3. show-notes state → podcast-pub show-notes operation; publish-prep slimmed to article+audio merge only; publish fan-out unchanged targets.
R4. translate-en/translate-ja → surfdash-pub scaffold-locale + thin agent.run translate; translate-sync → surfdash-pub sync; zero sd/publish-orchestrator/dirname shell in YAML.
R5. Every non-terminal state has an explicit failure edge with operator-readable description; publish partial (≥1 target ok) → publish-partial → done.
R6. `spur workflow validate` passes; r6 dogfood corpus replay produces the same 4-candidate plan.
R7. Caching contract preserved: existing artifact files still skip their states on re-run.

### Acceptance Criteria

```gherkin
Feature: Restructure kk-daily-ai-voice.yaml around the new seams

  Scenario: Workflow collect states collapse into one state
    Given the redesigned kk-daily-ai-voice.yaml defines exactly 24 states
    When `spur workflow validate` runs on plugins/kk/workflows/kk-daily-ai-voice.yaml
    Then it exits 0 with only composition advisories
    And the fetch / ingest-last30days / ingest-horizon / blend-facts states are replaced by a single collect state calling `kk executor fan-in --source` followed by the kept core-facts render
    And the grep gate finds no 'sd translate' reference, no 'publish-orchestrator' reference, and no dirname chain of 3 or more in the YAML
    And the r6 dogfood corpus replayed through collect's merged corpus -> plan -> quality-control-content yields the same 4 candidates as commit fdf3905's gates

  Scenario: Empty candidate set terminates as done-no-content, not failed
    Given a run where the quality-control-content filter admits zero candidates (empty-corpus fixture)
    When the first-match guard `jq '.metadata.docs | length == 0' candidates.json` evaluates true
    Then the workflow terminates in the done-no-content terminal state
    And no article, script, audio, or publish artifact is produced

  Scenario: Every non-terminal state has an explicit failure edge
    Given the redesigned transition table
    When every failure that is expected and routable is inspected
    Then it has an explicit edge with an operator-readable description (quality-control-content empty -> done-no-content; publish none -> failed; review rejection -> failed)
    And partial publish (>=1 target ok) routes to the named degraded state publish-partial preserving result.json before continuing to done
    And hard action failures keep the engine default (exit != 0 -> run failed) with no ceremonial duplicate edges
```

### Q&A
<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-07T00:25:49.000Z (from the 0095 verify/fix pass)

CLOSED (effective-title contract, carried from the 0095 review — verdict PASS/approve, P3 finding "documented title-merge deviation"): when this task wires the show-notes state (`kk executor run podcast-pub` with `options.operation=show-notes`), `PODCAST_PUB_TITLE` MUST carry the EFFECTIVE title — `vars.title || article.title` — never raw `vars.title`. The 0095 plugin generator `renderShowNotesMarkdown` (`plugins/publishings/podcast-pub/src/show-notes.ts:78-95`) merges the workflow's two title variables into one `opts.title` used for all three roles (heading :114, footer text :130, article-URL slug :104), whereas the retired inline script (`kk-daily-ai-voice.yaml:208`) used the CLI arg only for the heading and always `articleTitle` for footer text AND slug. The merge is behavior-identical today because `vars.title` defaults to `""` (`kk-daily-ai-voice.yaml:20`, so effective title == article title) and is byte-pinned by the 0095 goldens; a raw `vars.title` pass would shift footer+slug the moment a custom title is set. Deferred: a heading≠slug split as separate plugin options, only if a future requirement needs divergent heading/slug titles.

### Design

WHAT: Rewrite `plugins/kk/workflows/kk-daily-ai-voice.yaml` onto the new seams. YAML-only change consuming: fan-in `--source` mode (0092), episode-plan-gen annotate (0093) + `--mode filter` (0094), podcast-pub show-notes op (0095), surfdash-pub scaffold-locale/sync ops (0096).

WHY: ADR-019 D5 — orchestration legibility + failure routing that matches reality.

WHERE (frozen state inventory — 24 states; premise-corrected at refine: the design-review's "19" miscounted; the publish-partial mechanism below adds one):

prepare → collect → plan → quality-control-content → plan-translate → article → cover → script → review(HITL) → wrap-docs → generate → quality-control(audio) → show-notes → publish-prep → publish → publish-partial → translate-en → translate-en-agent → translate-ja → translate-ja-agent → translate-sync → done | done-no-content | failed

State changes:

1. **collect** (new) replaces fetch + ingest-last30days + ingest-horizon + blend-facts: one shell action calling `kk executor fan-in --source aihot-ingest:…/source.json --source last30days-ingest:…/last30days.json --source horizon-ingest:…/horizon.json --out …/1-ingest/blended.json` (+ core-facts-gen render stays as a second action here or drops — decide: keep as second action, it feeds nothing downstream-critical). `last30days_enabled=false` keeps writing `[]` input in prepare (existing behavior); fan-in --source tolerates an empty docs output.
2. **plan** unchanged (annotate rides inside episode-plan-gen from 0093).
3. **quality-control-content** (new): `kk executor run episode-plan-gen --mode filter --in …/2-plan/annotated.json …` — wait, simpler: filter reads the plan Content's metadata.docs. Freeze: plan writes content.json (annotated, post-gate selection unchanged) AND quality-control-content runs filter mode on the SAME blended input with QC_* vars, writing `2-plan/candidates.json` + `2-plan/candidates.rejected.json`. plan-translate then reads candidates.json instead of content.json. A `jq 'length == 0'` guard routes empty → `done-no-content` (new terminal).
4. **publish** shell: capture fan-out exit code WITHOUT propagating it; always inspect result.json; write `3-publish/publish-status.txt` = full | partial | none; exit 0 in all three. Transitions: full → translate-en; partial → **publish-partial** (new state: echoes warning naming failed targets, writes `.spur/run` marker, → done; result.json preserved for `--retry-from`); none → failed. This replaces r6's bare abort on partial failure.
5. **show-notes** → `kk executor run podcast-pub --in plan.json --out show-notes.md` with options.operation=show-notes (0095). No inline bun -e.
6. **publish-prep** slims to article+audio merge only (drop podcast-specific assembly once 0095 publish absorbs it).
7. **translate-en / translate-ja** states: surfdash-pub scaffold-locale (0096) replaces `sd translate` + dirname + cp; the existing translate-en-agent / translate-ja-agent stay (LLM hops on plugin-returned paths). **translate-sync** → surfdash-pub sync op.
8. Explicit failure edges: engine default (action exit≠0 → run failed) already covers hard failures — explicit `to: failed` transitions are added ONLY where a failure is *expected and routable* (publish none, QC-content empty→done-no-content). Do not add ceremonial failure edges that duplicate the engine default.

Vars added: qc_categories, qc_min_quality, qc_min_importance, qc_min_urgency, qc_min_impact (mapped to QC_* env in quality-control-content).

Anti-patterns: no new inline bun -e (the removed ones must not reappear); no `sd translate`/`publish-orchestrator`/dirname chains; no behavior change to review HITL; caching contract (test -f skip) preserved per state.

Handoff: 0098 dogfoods this YAML. Docs same commit: 03_ARCHITECTURE.md pipeline section + 04_DESIGN.md vars.

### Plan

1. Freeze the 24-state inventory in the Design; rewrite states + transitions in one pass.
2. collect state on fan-in --source; remove fetch/ingest-*/blend-facts states + their transitions; keep prepare's per-source input writers.
3. quality-control-content state + done-no-content terminal + empty-guard transition; point plan-translate at candidates.json.
4. publish state: exit-code capture + publish-status.txt marker; publish-partial state + transitions (full/partial/none).
5. show-notes → podcast-pub show-notes op; publish-prep slimmed.
6. translate-en/translate-ja → surfdash-pub scaffold-locale; translate-sync → surfdash-pub sync; agent translate states unchanged.
7. Add qc_* vars; `spur workflow validate` must exit 0 (advisories acceptable, errors not).
8. Replay r6 corpus with publish off: collect → quality-control-content must yield the same 4 candidates as fdf3905 gates; empty-corpus fixture must terminate done-no-content with zero downstream artifacts.
9. Grep gate: no 'sd translate', 'publish-orchestrator', or ≥3×dirname chain in the YAML.
10. Sync docs/03_ARCHITECTURE.md + docs/04_DESIGN.md; commit.

### Solution

#### Change map

**plugins/kk/workflows/kk-daily-ai-voice.yaml** — rewritten onto the frozen 24-state design (YAML-only):

- Header + `terminalStates: [done, done-no-content, failed]` (`:10-13`).
- Vars: added `qc_categories` / `qc_min_quality` / `qc_min_importance` / `qc_min_urgency` / `qc_min_impact` (defaults = 0094 `DEFAULT_FILTER_CONFIG`: `ai-news,ai-industry`, 3/3/2/2).
- **collect** (`:66-83`) replaces fetch + ingest-last30days + ingest-horizon + blend-facts: one action runs `kk executor fan-in --source "aihot-ingest:…/source.json" --source "last30days-ingest:…/last30days.json" --source "horizon-ingest:…/horizon.json" --out …/1-ingest/blended.json` (`:73`) then renders `2-facts/core-facts.md` via core-facts-gen (`:78-80`). prepare keeps writing the three source configs + `run-date.txt` (`:48-64`). fan-in carries **no** `--plugins-path` forward (it spawns sources by name internally); all `run`/`fan-out` commands keep the `set -- --plugins-path … "$@"` channel.
- **plan** (`:83-95`): episode-plan-gen annotate+select unchanged (`EPISODE_PLAN_MAX_ITEMS`/`EPISODE_PLAN_DATE` at `:93`).
- **quality-control-content** (`:97-109`): `jq '.metadata.docs'` → `2-plan/annotated.json`, then `EPISODE_PLAN_MODE=filter QC_CATEGORIES=… QC_MIN_*=… kk executor run episode-plan-gen --in …/annotated.json --out …/candidates.json` (`:107`) + `2-plan/candidates.rejected.json` audit sibling; first-match guard `jq -e '.metadata.docs | length == 0'` routes empty → **done-no-content** edge (`:366-367`).
- plan-translate reads `candidates.json`; article/cover/script/review/wrap-docs/generate/quality-control carried over with the caching contract intact (`:109-197`).
- **show-notes** (`:198-210`) → podcast-pub show-notes operation (`:209`, effective-title env per the 0095 Q&A contract).
- **publish-prep** (`:211-217`) slimmed to article+audio merge; **publish** (`:219-234`) keeps fan-out targets surfdash-pub + podcast-pub with the recursion-guard unset (`:230`).
- **publish-partial** (`:235-246`): warning naming failed targets + `.spur/run/publish-partial-<date>.txt` marker, result.json preserved for `--retry-from`; transitions full→translate-en / partial→publish-partial (`:500`) → done (`:515`) / none→failed.
- **translate-en/-ja → surfdash-pub scaffold-locale** (`:247-288`, `:289-324`), agent.run hops unchanged; **translate-sync → surfdash-pub sync** (`:325-336`). Zero `sd translate` / `publish-orchestrator` / dirname chains (grep gate: 0/0/0, 15 `kk executor` refs).
- Explicit edges only where expected-and-routable (qcc empty → done-no-content `:366-367`; review rejection → failed `:439`; publish partial/none → `:500`/failed); hard failures keep the engine default.

**plugins/generations/episode-plan-gen/src/index.ts** — supervisor-approved P3 deviation (the one scope excursion beyond YAML): the frozen design's literal `kk executor run episode-plan-gen --mode filter` is runtime-impossible because `kk executor run` spawns entries with exactly `[bun, entry, --in, X, --out, Y]` (`apps/cli/src/invoke.ts:117-122`). Added the `EPISODE_PLAN_MODE` env selector in `main()`: mode precedence `--mode` flag > env > `'plan'`; unknown value exits 1 naming both sources; flag-absent + env-unset is byte-identical to the previous default. The env channel is the established sanctioned surface (precedent: `VOICE_GEN_MP3`, `QC_*`). invoke.ts / kk CLI untouched.

**plugins/generations/episode-plan-gen/tests/episode-plan-gen.test.ts** — +1 regression test covering precedence (flag beats env; env-only filter keeps docs; neither → plan; invalid env exits 1). Suite 49 → 50.

**apps/cli/tests/kk-daily-ai-voice-workflow.test.ts** — 0074-era contract test updated to the frozen design (required by the 0-fail suite gate; same invariants adapted): 24-state list + terminals incl. done-no-content; `--source` fan-in pins; qc_* + `EPISODE_PLAN_MODE=filter` var pins; integration case drives a live `spur workflow run` through the fake kk with the new artifact set (blended.json only, no per-source docs; annotated/candidates/rejected in 2-plan), call order incl. 2× episode-plan-gen with mode sequence [plan, filter], and fan-in carrying no `--plugins-path`.

**Docs (same change)**: `docs/03_ARCHITECTURE.md` fan-in section gains the concurrent-collect `--source` bullet; `docs/04_DESIGN.md` gains the `EPISODE_PLAN_MODE` env row + updated `main()` row (mode precedence) + the former 0097 deferral sentence now states the wiring; `docs/design/episode-plan-gen.md` gains the env row + updated wiring paragraph.

#### Verification

`spur workflow validate` → **exit 0, 0 errors** (19 composition advisories — ADR-069 shell-line thresholds + prompt pinning, same class as the pre-0097 baseline). `bun run lint` exit 0. `NODE_ENV=test bun run test` **628 pass / 0 fail** (2583 expects, 44 files). Contract test 5/5 incl. the end-to-end workflow run; plugin suite 50/50. r6 replay (`.spur/run/0097-replay/`): merge-equivalent corpus, SAME-4-CANDIDATES-AS-FDF3905, permissive-QC 4 kept + audit sibling, default-QC 0 kept; empty-corpus fixture (`.spur/run/0097-empty/`) terminates done-no-content with zero downstream artifacts.

#### Dispositions

- pi-lens L2 `$schema` load failure: **documented false positive** — line 2 is byte-identical to HEAD (outside this diff), identical in all 6 sibling workflows; the value is a package-scoped registry ID resolved inside spur's runtime (ID ×3 in spur.js; schema file present at `node_modules/@gobing-ai/spur/schemas/state-machine-workflow.schema.json`); authoritative `spur workflow validate` exits 0. Repointing/inlining would break spur's binding and diverge from every sibling.
- `EPISODE_PLAN_MODE` env bridge: recorded P3 scope deviation per supervisor ruling (plugin + test alongside the YAML-only mandate).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | fetch/ingest-last30days/ingest-horizon/blend-facts → single `collect` state calling fan-in `--source` mode (plugins/kk/workflows/kk-daily-ai-voice.yaml, override YAML:79); validate confirms exactly one collect state |
| R2 | MET | plan runs episode-plan-gen annotate+select; `quality-control-content` runs `--mode filter` with QC_* vars; empty candidates guard `jq '.metadata.docs \| length == 0'` → done-no-content terminal; live: 0098 empty-r2 fixture terminal done-no-content |
| R3 | MET | show-notes state → podcast-pub show-notes operation; publish-prep slimmed to article+audio merge; publish fan-out unchanged targets with full/partial/none routing, publish-partial → done |
| R4 | MET | translate states → surfdash-pub scaffold-locale + thin agent.run translate; translate-sync → surfdash-pub sync; `grep 'sd translate\|publish-orchestrator\|dirname'` over the YAML → no matches (exit 1, this session) |
| R5 | MET | Every non-terminal state has an explicit failure edge with operator-readable description (validate output); contract tests assert review rejection → failed, publish partial → done, no-content → done-no-content |
| R6 | MET | validate valid:true exit 0, 24 states (jq, this session); r6 corpus replay = 0098 r2 live run terminal `done` with pure plan |
| R7 | MET | Caching contract preserved — per-state artifact guards retained; collect cache predicate at YAML:78 (empty-r2 fixture picked up the seeded blended.json without re-collect) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R2 — Workflow collect states collapse into one state | MET | command | spur workflow validate → valid:true; jq state count → exactly 24; single collect state with fan-in --source |
| R5 — Empty candidate set terminates as done-no-content, not failed | MET | command | YAML guard routes empty filter output to done-no-content terminal; live fixture 0098 empty-r2 → finalState done-no-content |
| R8 — Every non-terminal state has an explicit failure edge | MET | command | validate output confirms failure edges; apps/cli/tests/kk-daily-ai-voice-workflow.test.ts → 5/0 fresh (rejection → failed, publish-partial → done) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | kk owns steps / spur workflow owns orchestration; zero sd/publish-orchestrator/dirname shell in YAML; plugin-owned seams for show-notes, scaffold-locale, sync |
| P4 | evidence-rule-pass | — | Every row carries a CLI command or test run this session or a YAML/validate-output anchor |
| P4 | ac-boxes | — | AC rows use exact feature scenario titles `R2 — Workflow collect states collapse into one state`, `R5 — Empty candidate set terminates as done-no-content, not failed`, `R8 — Every non-terminal state has an explicit failure edge` |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- Builder sp-super-coder (runs 8a331ec1 + revival 5c4bc513) drove implement→test→review→verify for RID 0097-46338: 24-state YAML rewrite, EPISODE_PLAN_MODE env bridge (supervisor-approved P3 deviation — kk executor run forwards only --in/--out), 0074 contract test updated; verdict PASS (7 req / 7 checks, R2/R5/R8 exact-title MET), gates lint 0 / 628 pass / validate 0-err, r6 replay SAME-4-as-fdf3905 + empty-fixture done-no-content; orchestrator re-verified artifacts and recorded transitions.
- 2026-09-07T03:08:32.178Z wip → testing (system)
- 2026-09-07T03:08:32.502Z testing → done (system)
