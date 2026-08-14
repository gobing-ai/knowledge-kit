---
template: feature-impl
schema_version: 1
name: "Prototype the STORM research workflow dry-run"
description: ""
status: done
type: task
profile: standard
feature_id: C3
parent_wbs: null
priority: P1
tags: ["wayfinder:prototype"]
dependencies: ["0054"]
ac_numbering: task-local
created_at: "2026-08-14T03:34:53.481Z"
updated_at: "2026-08-14T05:57:18.303Z"
---

## 0055. Prototype the STORM research workflow dry-run

### Background
wayfinder:prototype — C3 STORM topic-research workflow. Blocked on 0054.

**Question.** Can we prove the orchestration shape: a state-machine at `.spur/workflows/kk-storm-research.yaml` that materializes `topic` `--vars` into the ingest `--in` JSON (keys from 0054), runs `web-search`, then `content-gen`, and dry-runs to a Content-written terminal — no publish?

**Verified premises (2026-08-14):**
- B3 template: `.spur/workflows/kk-ingest-generate-publish.yaml` — `kk executor run ${vars.*_plugin} --in … --out … --plugins-path ${vars.plugins_path}`.
- Canonical invoke is `kk executor run` (`docs/04_DESIGN.md`; `kk invoke` is a hidden alias — do not author it).
- Discovery: `kk plugin status --kind ingestion --json`.
- D4 `content-gen` is unchanged; empty `Doc[]` → Notice Content.
- `--in` keys start as `{ topic, maxResults?, fixture? }` per 0054 Design; **0054 Solution wins** if it amends keys.

**Out of this ticket:** live Firecrawl HTTP client; billed search; publish states; D4 edits; `~/.config/kk/` migration; `kk` sugar command.
### Requirements
- [x] R1. Author `.spur/workflows/kk-storm-research.yaml` as a state-machine (clone `kk-ingest-generate-publish`, no publish). It materializes `${vars.topic}` into the 0054 `--in` JSON under `${vars.work_dir}`, then `kk executor run` ingest + generate. `spur workflow validate` and `spur workflow run --dry-run --json` reach `status: done` with terminal state the Content-written success state. Record YAML path, vars, and production gaps in Solution.
- [x] R2. Scaffold `plugins/ingestions/web-search` so registry discovery + `kk executor run` accept `--in`/`--out`. Fixture `Doc[]` is the v1 entry (no live Firecrawl key). `kk plugin status --kind ingestion` lists `web-search`.
### Acceptance Criteria
```gherkin
Feature: STORM research workflow prototype

  Scenario: R1 — Dry-run walks topic to Content terminal
    Given the ingest contract from the research ticket
    When spur workflow validate and run --dry-run execute kk-storm-research.yaml
    Then status is done and the terminal state is the Content-written success state
    And no publish state exists

  Scenario: R2 — Ingest plugin is discoverable
    Given plugins/ingestions/web-search/plugin.json
    When kk plugin status or registry discovery runs against the repo plugins root
    Then web-search is listed as kind ingestion
```
### Q&A
- **Live Firecrawl in the prototype?** Closed: no. Fixture `Doc[]` only. Live client is later fog.
- **How does topic reach `--in`?** Closed: `prepare` writes `${vars.work_dir}/topic.json` with `jq` from string vars. Not a new invoke flag.
- **`kk invoke` vs `executor run`?** Closed: author `kk executor run` (`docs/04_DESIGN.md`).
- **Workspace package?** Closed: yes, copy content-gen `package.json`/`tsconfig` so typecheck includes the new ingest plugin. Do not copy C2's no-package.json layout.
- **`--in` keys if 0054 is unfinished?** Closed: implement against 0054 Design starting keys; 0054 Solution overrides when present. State the assumption in Solution.
- **Feature Gherkin match?** Closed: C3 is a wayfinder-map; task AC is `ac_numbering: task-local`.
- **Judge / content.md?** Closed: out of this ticket (C3 open questions).
### Design
**WHAT.** A dry-run-proven workflow YAML plus a discoverable fixture ingest plugin. Not a production Firecrawl client.

**WHY.** C3 destination is topic → D4 Content via compose-plugins. B3 already proved `kk executor run` chaining. This ticket copies that shape, drops publish, and adds topic→JSON materialization.

**WHERE (create / copy):**
- `.spur/workflows/kk-storm-research.yaml` (new; clone `.spur/workflows/kk-ingest-generate-publish.yaml`)
- `plugins/ingestions/web-search/plugin.json`
- `plugins/ingestions/web-search/src/index.ts` (`--in`/`--out` entry)
- `plugins/ingestions/web-search/tests/web-search.test.ts`
- Workspace member like `plugins/generations/content-gen`: `package.json` (`@gobing-ai/web-search` or `@gobing-ai/kk-web-search`), `tsconfig.json` extending `tooling/typescript/base.json`, so `bun run typecheck` includes it. Do **not** copy C2's missing-package.json gap.

**Assumes from 0054 (do not re-own):**
- `--in` JSON keys, env name, Doc mapping, fail-loud table live in 0054 Solution.
- If 0054 is still `todo` when this is implemented, use 0054 Design starting keys (`topic` required; `maxResults` default 8; `fixture` boolean) and note the assumption in Solution.

**Frozen names:**
- Workflow `name`: `kk-storm-research`
- `$schema`: `"@gobing-ai/spur/schemas/state-machine-workflow.schema.json"` (quoted)
- `kind`: `state-machine`
- `initialState`: `prepare`
- `terminalStates`: `done`, `failed`
- Plugin `plugin.json.name`: `web-search`; `kind`: `ingestion`; `entry`: `./src/index.ts`
- Vars (all strings, as `spur workflow --vars` requires):

| var | default | role |
| --- | --- | --- |
| `topic` | (required at run) | operator topic |
| `maxResults` | `"8"` | written into `--in` JSON |
| `work_dir` | `"./work"` | artifact dir |
| `plugins_path` | `"./plugins"` | `--plugins-path` |
| `ingestion_plugin` | `"web-search"` | executor name |
| `generator_plugin` | `"content-gen"` | executor name |

- Artifact paths: `${vars.work_dir}/topic.json`, `docs.json`, `content.json`
- Invoke (not `kk invoke`):
  - ingest: `kk executor run ${vars.ingestion_plugin} --in ${vars.work_dir}/topic.json --out ${vars.work_dir}/docs.json --plugins-path ${vars.plugins_path}`
  - generate: `kk executor run ${vars.generator_plugin} --in ${vars.work_dir}/docs.json --out ${vars.work_dir}/content.json --plugins-path ${vars.plugins_path}`

**State machine:**
- `prepare` — `mkdir -p` work_dir; write topic.json via `jq` (`--arg topic`, `--arg maxResults`; add `"fixture": true` so the stub never bills). Guard `action-ok` → ingest, else failed.
- `ingest` — executor run web-search. Guard `action-ok` → generate, else failed.
- `generate` — executor run content-gen. Guard `action-ok` → done, else failed.
- `done` / `failed` — terminals. **No publish state, no publish var.**

**Fixture plugin behavior (this ticket only):**
- Parse `--in` JSON. Missing `topic` → stderr + exit 1.
- Always emit fixture `Doc[]` (≥2 items) with stable ids, `sourceUri`, `title`, markdown `body` — enough for D4 citations. Do not call Firecrawl.
- If 0054 reserved `fixture: true`, honor it; the workflow always sets it in this prototype.
- Write `--out` as `DocListSchema` JSON; exit 0.

**Tests / verify:**
- Unit: fixture `--in`/`--out` writes schema-valid `Doc[]`; ids stable across two runs (karakeep-local test shape).
- Discovery: `kk plugin status --kind ingestion --plugins-path ./plugins --json` includes `name: web-search`.
- Workflow: `spur workflow validate .spur/workflows/kk-storm-research.yaml --json`; `spur workflow run … --dry-run --run-id <throwaway> --json` → `status: done`.

**Anti-patterns:**
- Do not add a Firecrawl client, SDK, or network call.
- Do not edit `content-gen` / D4.
- Do not author `kk invoke` or a `kk` sugar command.
- Do not put `FIRECRAWL_API_KEY` in YAML vars.
- Do not add publish / judge / `content.md` extract (C3 open questions).
- Do not migrate YAML to `~/.config/kk/`.
- Do not implement query expansion.

**Handoff after this ticket:** live Firecrawl client + contract tests + one dogfood topic stay in C3 fog (graduate later).
### Plan
1. Read 0054 Solution (or Design starting keys if Solution is still empty) and lock the topic.json shape (R1).
2. Write `kk-storm-research.yaml`: prepare → ingest → generate → done/failed; quote `$schema`; no publish (R1).
3. Scaffold `plugins/ingestions/web-search` (plugin.json, workspace package.json, tsconfig, fixture `src/index.ts`) (R2).
4. Add `tests/web-search.test.ts`: fixture IO + stable ids + discoverable via `plugin status` / `runInvoke` (R2).
5. `spur workflow validate` + `run --dry-run --json`; `kk plugin status --kind ingestion --plugins-path ./plugins --json` (R1, R2).
6. Record YAML path, var list, and remaining production gaps (live client, dogfood) in Solution.
### Solution
**Implemented: STORM research workflow dry-run prototype (R1 + R2).** Working tree `knowledge-kit`, task 0055 (WBS 0055), feature C3.

**R1 — `.spur/workflows/kk-storm-research.yaml`** (new, 78 lines): state-machine clone of `.spur/workflows/kk-ingest-generate-publish.yaml` minus publish. Frozen names per Design: `name: kk-storm-research`, `$schema` quoted `"@gobing-ai/spur/schemas/state-machine-workflow.schema.json"`, `kind: state-machine`, `initialState: prepare`, `terminalStates: [done, failed]`. States `prepare → ingest → generate → done/failed`; no publish state, no publish var. Vars (all strings): `topic` (required at run, default `""`), `maxResults: "8"`, `work_dir: "./work"`, `plugins_path: "./plugins"`, `ingestion_plugin: "web-search"`, `generator_plugin: "content-gen"` (`.spur/workflows/kk-storm-research.yaml:13-24`).
- `prepare` (`:28-37`): `mkdir -p ${vars.work_dir}` then `jq -n --arg topic "${vars.topic}" --arg maxResults "${vars.maxResults}" '{topic: $topic, maxResults: ($maxResults | tonumber), fixture: true}' > ${vars.work_dir}/topic.json` — materializes `topic`/`maxResults` into the 0054 `--in` JSON and always sets `fixture: true` so the stub never bills (Q&A "How does topic reach --in?": jq from string vars, per Design).
- `ingest` (`:39-44`) and `generate` (`:46-51`): exact frozen invokes — `kk executor run ${vars.ingestion_plugin} --in ${vars.work_dir}/topic.json --out ${vars.work_dir}/docs.json --plugins-path ${vars.plugins_path}` and `kk executor run ${vars.generator_plugin} --in ${vars.work_dir}/docs.json --out ${vars.work_dir}/content.json --plugins-path ${vars.plugins_path}`.
- Transitions (`:59-90`): success edges use `guard: { kind: always }` — **deviation from Design's "action-ok" wording, deliberate and repo-conventional**: the engine evaluates `action-ok` as `lastActionResult?.ok === true`, and in `--dry-run` no actions execute (engine `EMPTY_OUTCOME` onEnter/onExit in dry-run mode), so `action-ok` always denies and the walk falls to the unguarded `failed` edge — proven empirically: `spur workflow run kk-ingest-generate-publish.yaml --dry-run --json` → `finalState: failed` (B3 uses action-ok). The repo's own walkable pipelines use `always` on linear success edges (`.spur/workflows/task-pipeline.yaml:232,237,254`). Real-run safety is unchanged: under the engine's default onError=fail policy a failed shell action returns outcome `fail`, which finalizes the run at the failing state before transitions are consulted, so the `always` edge only fires after the action actually succeeded. Failure edges stay unguarded, so the AC's dry-run walks `prepare→ingest→generate→done` with terminal state the Content-written success state (`done`), and `done` is not in `failureStates` so it finalizes as success.
- Production gaps recorded (Design "Handoff after this ticket"): no live Firecrawl client (fixture-only v1), no query expansion, no dogfood topic run, no publish/judge/content.md — all remain in C3 fog. `FIRECRAWL_API_KEY` is deliberately absent from YAML vars (anti-pattern).

**R2 — `plugins/ingestions/web-search/`** (new workspace member, `@gobing-ai/web-search`; root workspaces glob `plugins/ingestions/*` already covers it, `package.json:22` — no root edit needed):
- `plugin.json` (`:1-7`): frozen names — `name: web-search`, `kind: ingestion`, `entry: ./src/index.ts`, version/description set (manifest schema `packages/kk-core/src/manifest.ts:8-17`).
- `src/index.ts` (`:1-128`): `--in`/`--out` entry. `parseInput` (`:69-93`) honors the 0054 keys — `topic` required non-empty string (missing → stderr + return 1, no `--out`; fail-loud row 1), `maxResults` optional positive int default 8, `fixture` optional boolean. `buildFixtureDocs` (`:52-66`) emits ≥2 canned `Doc[]` per the 0054 Doc mapping: `id = sha256(sourceUri).hex.slice(0,16)` (`:45-47`, same idea as `plugins/ingestions/karakeep-local/src/index.ts:15-16`), `body` markdown required, `title`/`sourceUri` SHOULD, `mediaType: text/markdown`, `metadata {query, rank, position, scraped_at}` — every Doc survives D4's `assertKnownEvidence` citation gate (`plugins/generations/content-gen/src/storm.ts:325-330`). No network/Firecrawl call anywhere (anti-pattern); when `fixture` is false/absent (live mode requested), a stderr warning notes v1 is fixture-only and fixture docs are emitted (Design: "Always emit fixture Doc[]"). `main` (`:95-124`) writes `DocListSchema.parse(docs)` JSON to `--out` (mkdir -p parent), exit 0; validation errors → stderr + exit 1. `import.meta.main` guard so tests can import `main` (content-gen pattern, `plugins/generations/content-gen/src/index.ts:47-49`).
- `tests/web-search.test.ts` (`:1-90`): karakeep-local test shape (`plugins/ingestions/karakeep-local/tests/karakeep-local.test.ts`) — fixture `--in`/`--out` writes schema-valid `Doc[]` (ids `[0-9a-f]{16}`, body/title/sourceUri/mediaType/metadata.query assertions), ids stable across two runs, `maxResults` caps the list, `runInvoke` invocation via the sanctioned executor path (`apps/cli/src/invoke.ts`), missing-topic → exit 1 with no `--out`, `buildFixtureDocs` citation-survival unit check. Tmp dir cleanup in `afterEach` mirrors karakeep-local (`:25-27`).
- `package.json` (`:1-16`) and `tsconfig.json` (`:1-4`): copied from `plugins/generations/content-gen/` (Design: workspace member so `bun run typecheck` includes it; do NOT copy C2's no-package.json gap). Deps: `@gobing-ai/kk-core` workspace only; `@types/bun` dev — no new runtime deps.

**Assumption stated (per Design Q&A):** implemented against the 0054 Solution (done, authoritative) — its Block 8 handoff keys `topic`/`maxResults`/`fixture` match the Design's starting keys exactly, so no conflict.

**Verification performed in this stage (pipeline re-verifies; `spur workflow run`/tests/lint left to verify):**
- `spur workflow validate .spur/workflows/kk-storm-research.yaml --json` → `ok: true, valid: true` (schema: state-machine, states, transitions, all-string vars).
- Chain smoke test with the repo CLI (`bun apps/cli/src/index.ts`): `executor run web-search --in topic.json --out docs.json --plugins-path ./plugins` → exit 0, docs.json = 3 schema-valid Docs with stable ids; the jq materialization command verified verbatim (topic string, `maxResults` as integer, `fixture: true`). (`content-gen` generate step intentionally not run to completion here — it makes live STORM model calls; unchanged D4.)
- Discovery: `kk plugin status --kind ingestion --plugins-path ./plugins --json` → lists `web-search (ingestion)` alongside `karakeep-local`.
- Note: the global `kk` bin on PATH is a stale 0.0.4 build (`add`/`invoke`/`fanin`/`fanout`/`plugins` — no `executor`); the workflow's `kk executor run` surface is the repo CLI (`apps/cli`, registered in `apps/cli/src/commands/executor.ts`), verified from source. Pipeline/verify should run the repo CLI.
**Verify remediation (2026-08-14, stage: verify, --fix all).** Closed the review's P3 and recorded the two P4 dispositions, all in `plugins/ingestions/web-search/src/index.ts`:

- **P3 fixed (live-mode fail-soft).** `main()` now fails loud when `--in` omits or `false`s `fixture` — the 0054 live-Firecrawl path v1 does not implement — with stderr `web-search failed: live Firecrawl not implemented in v1 (pass "fixture": true to use the fixture stub)` and exit 1, no `--out` written (0054 Block 5 row-2 semantics; `plugins/ingestions/web-search/src/index.ts:121-126`). Verified via repo CLI: `executor run web-search --in {fixture:false} --out docs.json` → exit 1, no docs.json; `fixture: true` → exit 0. Tests updated to pass `fixture: true` on fixture-path inputs; added `live mode (fixture absent or false) exits 1 and writes no --out` (12 pass).
- **P4 recorded (maxResults:1 single-Doc).** Deliberate: `maxResults` caps per 0054 (Block 1, positive int → Firecrawl `limit`); `maxResults: 1` yields exactly one Doc, conformant with cap semantics; the Design's "always ≥2" wording applies to the default path. Commented at `plugins/ingestions/web-search/src/index.ts:53-55`; no behavior change.
- **P4 recorded (scraped_at non-determinism).** Informational: per-run timestamp is conformant with 0054 Block 4 (determinism required only for `id`); the determinism test asserts ids only. Commented at `plugins/ingestions/web-search/src/index.ts:66`; no behavior change.
- **P4 kept (success-edge `always` guard).** Re-verified correct against engine source (dry-run `EMPTY_OUTCOME` denies `action-ok`; real-run failure short-circuits at the state under default onError=fail) — not re-litigated, kept.
### Testing
**verifyall --force 2026-08-14 (this run).** Prototype re-audit.

**Per-Requirement Traceability**

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | command: `spur workflow validate .spur/workflows/kk-storm-research.yaml --json` → ok:true, valid:true. `spur workflow run .spur/workflows/kk-storm-research.yaml --dry-run --run-id verifyall-c3-0055 --vars '{"topic":"STORM topic research"}' --json` → status:done, finalState:done, transitionsTaken:3. No publish state in YAML. |
| R2 | MET | command: `bun apps/cli/src/index.ts plugin status --kind ingestion --plugins-path ./plugins --json` → healthy:true, `web-search` listed (kind ingestion, entry ./src/index.ts). `bun test plugins/ingestions/web-search/tests/web-search.test.ts` → 12 pass, 0 fail (including live-mode exit 1 when fixture is false). |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R1 — Dry-run walks topic to Content terminal | MET | command | validate ok:true; dry-run run-id verifyall-c3-0055 status:done finalState:done; `.spur/workflows/kk-storm-research.yaml:56-87` has no publish state |
| R2 — Ingest plugin is discoverable | MET | command | plugin status lists web-search; 12/12 tests pass at `plugins/ingestions/web-search/tests/web-search.test.ts` |

**SECUA (this run):** prior P3 (live-mode fail-soft) is closed — `plugins/ingestions/web-search/src/index.ts:118-125` exits 1 when `fixture` is not true; covered by test "live mode (fixture absent or false) exits 1". No new P1–P3.

**design-conformance:** success-edge `always` vs Design `action-ok` is CHANGED with Solution note (dry-run EMPTY_OUTCOME). Fixture plugin + YAML states DONE.

**Fix this run:** Requirements checkboxes `[x]`; live-mode fail-loud already in tree. Artifact: `.spur/run/0055-verdict.json`.

Coverage: N/A for workflow YAML; plugin tests 12/12 pass (single-file bun test coverage % is not the workspace gate).
### Review
**Review (2026-08-14, stage: review-only).** Three-dimensional review of task 0055 artifacts (`.spur/workflows/kk-storm-research.yaml`, `plugins/ingestions/web-search/`) against R1/R2 + task-local AC, with SECUA and architecture-depth passes.

**Guard-deviation verification (the scrutinized risk).** Success edges use `guard: { kind: always }` instead of the Design's `action-ok` wording. Verified against the workflow engine source (`@gobing-ai/spur@0.3.47`, `spur.js`): (1) in `--dry-run` every onEnter/onExit action sequence is replaced by `EMPTY_OUTCOME = { outcome: "completed", result: undefined }`, so `lastActionResult` stays `undefined` and the builtin `action-ok` guard (`context.lastActionResult?.ok === true`) always denies — the walk then falls to the unguarded `failed` edge and dry-runs to `failed` (this is exactly why the B3 `action-ok` template dry-runs to `failed`, matching the implementer's empirical claim); (2) on a real run, a failed shell action returns outcome `fail` under the default onError policy (`resolveOnErrorPolicy` defaults to `"fail"`), and the machine fails at the state *before* transitions are evaluated — the `always` success edge can never fire after a failed action. `always` on linear success edges is repo-conventional (`.spur/workflows/task-pipeline.yaml:232,237,254`). The deviation is correct, necessary for the dry-run AC (`status: done`, Content-written terminal), and safe on real runs; it is documented in the YAML header and Solution. No change required.

**Functional traceability (R1/R2).** R1 met — state-machine clone of `kk-ingest-generate-publish` minus publish: `prepare → ingest → generate → done/failed`; frozen names (`$schema` quoted, `name: kk-storm-research`, `kind: state-machine`, `initialState: prepare`, `terminalStates: [done, failed]`); all vars strings; `prepare` materializes `topic`/`maxResults`/`fixture: true` via `jq` into `${vars.work_dir}/topic.json`; exact frozen `kk executor run` invokes for ingest + generate; no publish state, no publish var. R2 met — `plugins/ingestions/web-search/` (plugin.json frozen names, `kind: ingestion`, `entry: ./src/index.ts`) is discoverable under the repo plugins root (`--plugins-path ./plugins` kind-collection scan) and the collection root; `kk executor run` → `runInvoke` (`apps/cli/src/invoke.ts:45`) resolves it via the merged registry. Fixture Doc mapping matches 0054 Block 4 exactly: `id = sha256(sourceUri).hex.slice(0,16)` (tested `^[0-9a-f]{16}$`, stable across runs), `body` required markdown, `title`/`sourceUri` SHOULD, `mediaType: text/markdown`, `metadata {query, rank (0-based), position (1-based), scraped_at ISO}` — all DocSchema-valid (`packages/kk-core/src/schemas.ts:4-11`, metadata `z.record`), and every Doc survives D4's `assertKnownEvidence` citation gate (id + sourceUri + title present). Fail-loud: missing/blank topic → stderr + exit 1 + no `--out` (unit-tested; workflow-level: jq writes the empty topic, web-search exits 1, real-run machine lands in `failed`). Workspace wiring complete: `bun.lock` carries the `@gobing-ai/web-search` workspace entry; tsconfig extends `tooling/typescript/base.json`; root workspaces glob `plugins/ingestions/*` and the typecheck filter cover it. Anti-patterns checked: no fetch/spawn/network in the plugin (fixture sourceUris are inert strings), no publish state, no `FIRECRAWL_API_KEY` in vars.

**SECUA.** Security — no secret material in YAML/plugin.json/`--in`; no network surface in v1. Efficiency — single-file entry; no runtime deps beyond workspace `@gobing-ai/kk-core`. Correctness — output gated by `DocListSchema.parse`; fail-loud row 1 honored; contract fields verified against 0054 Block 4. Usability — AC-scope paths fully walkable; dry-run reaches `done`. Architecture — thin plugin boundary per C1/ADR-006 (sole sanctioned spawn via `invoke.ts`); deviates from the Design's guard wording with a verified, documented justification.

| Severity | Finding | Evidence |
|---|---|---|
| P1 | None | — |
| P2 | None | — |
| P3 | Live-mode fail-soft: when `--in` omits or `false`s `fixture`, the plugin prints a stderr warning but still emits fixture `Doc[]` and exits 0. 0054 Block 1 defines `fixture: false` (the default) as the live Firecrawl path, and Block 5 row 2 makes an unauthenticated live run exit 1 with no `--out`. v1 has no live path, so any caller outside the workflow (which always sets `fixture: true`) receives fabricated research docs as success — a surprising recovery (AGENTS.md: "an obvious failure beats a surprising recovery") that can feed fake citations into content-gen with only a swallowed stderr warning. Recommend exit 1 ("live Firecrawl not implemented in v1") when `fixture !== true`, or make the stub default to fixture mode explicitly. Does not block this ticket's ACs (protected workflow path always sets `fixture: true`), but should be closed before the plugin is invoked without it. | `plugins/ingestions/web-search/src/index.ts:95-97` (warning branch then emits); 0054 Block 1 / Block 5 row 2 |
| P4 | Success-edge guard deviation from the Design's `action-ok` wording (`always`). Verified correct and necessary against engine source (dry-run `EMPTY_OUTCOME` denies `action-ok`; real-run failure fails the machine at the state before transitions under default onError=fail) — recorded here for traceability; keep as-is. | `.spur/workflows/kk-storm-research.yaml:5-12,59-90`; `@gobing-ai/spur@0.3.47` state-machine loop + guard registry + `resolveOnErrorPolicy` |
| P4 | `maxResults` cap can violate the Design's "Always emit fixture Doc[] (≥2 items)": `maxResults: 1` yields a single-Doc output (`FIXTURE_ENTRIES.slice(0, min(3, maxResults))`). Cap semantics conform to 0054 (maxResults caps items), so only the literal "≥2" wording is affected; tests assert ≥2 on the default path only. Note or guard; no rework needed. | `plugins/ingestions/web-search/src/index.ts:52-55`; task Design fixture-behavior block |
| P4 | `scraped_at` is captured per run (`new Date().toISOString()`), so full Doc JSON differs between runs even though ids are stable. Conformant with 0054 Block 4 (determinism is required only for `id`); the "deterministic across two runs" test correctly asserts ids only. Informational. | `plugins/ingestions/web-search/src/index.ts:63`; 0054 Block 4; `tests/web-search.test.ts` ids-only assertion |

**Verdict: PASS.** R1/R2 fully satisfied; the guard deviation (the main scrutinized risk) verified correct against engine source; fixture Doc mapping matches 0054 Block 4 exactly; fail-loud missing-topic works at plugin and workflow level; no network/publish/secret anti-patterns; workspace wiring complete. 0 P1, 0 P2, 1 P3, 3 P4. Residual risk: low — the P3 (live-mode fail-soft) is outside the protected workflow path but should be closed before any caller runs `web-search` without `fixture: true`.
### References
- Feature: [C3 STORM topic-research workflow](docs/features/C3_storm-topic-research-workflow.md)
- Upstream contract: 0054 Specify the Firecrawl topic-to-Doc ingest contract
- Template: `.spur/workflows/kk-ingest-generate-publish.yaml`
- CLI surface: `docs/04_DESIGN.md` (`executor run`, `plugin status`)
- C1: [ingestion-plugin-specification.md](docs/design/ingestion-plugin-specification.md)
- Generator (do not edit): `plugins/generations/content-gen/`
- Layout to copy: `plugins/generations/content-gen/package.json`, `tsconfig.json`
- Test shape to copy: `plugins/ingestions/karakeep-local/tests/karakeep-local.test.ts`
### History
- 2026-08-14T04:56:41.259Z todo → wip (system)
- 2026-08-14T05:07:26.227Z wip → testing (system)
- 2026-08-14T05:07:35.484Z testing → done (system)
