---
schema_version: 1
name: Wire script-write agent step into kk-daily-ai-voice and report the script source
status: done
template: feature-impl
created_at: 2026-09-25T03:51:45.351Z
updated_at: "2026-09-25T05:57:26.518Z"
feature_id: F613
priority: P1
tags:
  - kk-daily-ai-voice
  - workflow
  - F613
estimate_hours: 3

dependencies: ["0161"]
---

## 0162. Wire script-write agent step into kk-daily-ai-voice and report the script source

### Background

Implements: R2 — script-write authors a per-item script plan from the show-notes plan source; R5 — A missing or rejected script plan falls back to templates and is reported (workflow and report side).

Depends on 0161, which provides the plan consumer, the `DAILYNEWS_SCRIPT_PLAN` / `DAILYNEWS_STYLE_FILE` env contract, the `scriptSource` / `scriptPlanErrors` metadata, and the style sidecar `plugins/kk/scripts/daily-voice-style.zh.md`. The show notes render after audio from `2-plan/<date>_03_plan_plan.json`, so script-write reads that same file (same items, order, and titles). `script` currently runs straight after `article`/`cover` (`plugins/kk/workflows/kk-daily-ai-voice.yaml:419-429`). `dailyScript` passes only language, title, and profile env (`plugins/kk/scripts/kk-workflow-stages.ts:918-932`). Design satellite: `docs/design/daily-voice-script-plan.md` §2 and §4.

**Refine corrections (2026-09-24)**
- "script-write reads plan.json `metadata.docs`" → verified reality: plan.json is a bare `Doc[]` (`.works/kk-daily-ai-voice/20260924/2-plan/20260924_03_plan_plan.json`, 9 docs with `id/title/body/sourceUri`) → resolution: the prompt says "a JSON array of docs; use each `id`".
- "Prompt reads the style file" → verified reality: spur has no workflow-dir var (only `__runId` / `__hitl*`), so no prompt can name a shipped path → resolution: a first `shell` action, `kk stage daily-script-style`, snapshots the sidecar (via `requireSidecar`, `kk-workflow-stages.ts:147`) into the work dir, and the prompt reads the snapshot.
- "`agent.run` fallback needs a new mechanism" → verified reality: spur `agent.run` supports `onError: continue` (`@gobing-ai/spur/config/workflows/wrapup-pipeline.yaml:183`) → resolution: reuse it; no repair edge.
- Resume cost: `agent.run` re-runs on every resume → resolution: the entry guards skip script-write when today's plan or VoiceScript YAML already exists.

### Requirements

- [x] R1. Add stage `kk stage daily-script-style <work_dir> <run_date>`. It copies `requireSidecar('', 'daily-voice-style.zh.md', …)` to `2-script/<run_date>_08_script-write_style.md`, is idempotent (skips if the file exists), and fails loud when the sidecar is missing.
- [x] R2. Add state `script-write` to `plugins/kk/workflows/kk-daily-ai-voice.yaml`, with these onEnter actions:
  1. `shell`: `kk stage daily-script-style`.
  2. `agent.run` with `role: scribe`, `agent: ${vars.agent}`, and `onError: continue`. The prompt is ≤1000 chars (ADR-115). It reads the plan.json `Doc[]` and the style snapshot, and writes `${vars.work_dir}/2-script/${vars.run_date}_08_script-write_plan.json` as `{version:1,intro,outro,items:[{id,lead,insight}]}` with one item per doc id. It uses `expectFile` on that path and `allowAppend: false`.
- [x] R3. Add var `script_write_enabled: "true"`. Transitions, first match wins:
  - `article → cover`: unchanged.
  - `article → script-write` and `cover → script-write` when all of these hold:
    - `script_write_enabled == "true"`
    - `language == "zh"`
    - neither `_08_script-write_plan.json` nor `_08_script_voicescript.yaml` exists yet
  - `article → script` and `cover → script`: `always`.
  - `script-write → script`: `always`.
- [x] R4. `dailyScript` also passes these env vars to dailynews-gen:
  - `DAILYNEWS_SCRIPT_PLAN = resolve(<work_dir>/2-script/<run_date>_08_script-write_plan.json)`
  - `DAILYNEWS_STYLE_FILE = resolve(resolveSidecar('', 'daily-voice-style.zh.md'))`
  - Both are always passed as absolute paths.
- [x] R5. `dailyRunReport` passes `NEWS_REPORT_SCRIPT_FILE = <abs work_dir>/2-script/<run_date>_08_script_content.json`. news-report-gen reads it best-effort (the same shape as `readQcSummary`, `plugins/generations/news-report-gen/src/index.ts:167`) and renders a `脚本来源` line: `plan`, or `template` plus each `itemId: rule`. An absent file or missing metadata omits the line.
- [x] R6. Update `docs/design/kk-daily-ai-voice.md` (state list and vars) (and flip `docs/design/daily-voice-script-plan.md` status proposed → shipped), and the `docs/04_DESIGN.md` row in the same commit (T3).
- Out of scope: the builder, validator, and style content (0161); en plan path; changes to article/cover/voice/QC/publish.

### Acceptance Criteria

- [x] AC1 — script-write authors a per-item script plan from the show-notes plan source (req: R2)
- [x] AC2 — A missing or rejected script plan falls back to templates and is reported (req: R5)

Task-only:
- The transitions from R3 and the env passthrough from R4 are observed in `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts` and `apps/cli/tests/kk-workflow-stages.test.ts`.
- The workflow must pass `spur workflow validate`.
- LLM output quality is not unit-observable. The dogfood run is the check for it.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-25T04:00:41.936Z

- **Q: How does the prompt reach the style file?** A: Through the `daily-script-style` snapshot in the work dir, since spur has no workflow-dir var. It also freezes the style that was used, per run, for audit. Closed 2026-09-24.
- **Q: Should script-write re-run on resume?** A: No. The guards skip it when the plan or the YAML already exists. To force it, delete the plan. Closed.
- **Q: What if the style sidecar is missing?** A: `daily-script-style` fails loud, because that is a broken install, not a content problem, matching `requireSidecar` for the other sidecars. Closed.

### Design

**Chosen:** `agent.run` with `onError: continue`. A failed or missing plan never halts the unattended daily run, and plan-versus-template is decided in exactly one place, the 0161 builder, from the file itself.
**Rejected:**
- Guard-routed repair edge: an extra state with no value, since the builder already validates.
- Fail-loud: the operator chose fallback at idea-eval.
- Passing `DAILYNEWS_SCRIPT_PLAN` only when the file exists: a disabled or failed script-write would then leave no trace in the report. Always passing it yields `missing-plan`.

**Frozen names**
- stage verb `daily-script-style`, handler `dailyScriptStyle(args)` in `plugins/kk/scripts/kk-workflow-stages.ts`, dispatched beside `daily-script` (`:1668`)
- snapshot `2-script/<run_date>_08_script-write_style.md`
- plan `2-script/<run_date>_08_script-write_plan.json`
- var `script_write_enabled`
- env `NEWS_REPORT_SCRIPT_FILE`
- report label `脚本来源`
- news-report-gen export `readScriptSource(path): Promise<{ source: 'plan' | 'template'; errors: { itemId: string; rule: string }[] } | null>`

**Prompt skeleton** (≤1000 chars, zh output):
- Read the docs array `${work_dir}/2-plan/${run_date}_03_plan_plan.json` (don't edit it) and the style contract `…_08_script-write_style.md`.
- For each doc, write a `lead` (a bridge that leads into the title, not containing it) and an `insight` grounded only in that doc's facts.
- Write an `intro` hooking today's actual themes and an `outro`, with no greeting or sign-off (the builder adds both).
- Obey the caps and banned list.
- Output only the JSON.

**Invariants**
- script-write never edits plan.json.
- The `script` stage's `isFile(yamlOut)` cache still short-circuits resumes.
- Report reads stay best-effort.
- The guard order leaves `article → cover` first, so the cover still generates before script-write.
- The en path is byte-identical to today.

**Anti-patterns**
- No `--plan` CLI flag on dailynews-gen; env only, matching the existing `DAILYNEWS_*`.
- No second copy of the caps or banned list in the prompt; it references the snapshot.
- No `type: parallel`.

**Assumes from 0161:** the env names, absolute paths, the metadata keys, and rules including `missing-plan` and `no-style`.

**Budget:** about 3h across workflow YAML, the stages script, news-report-gen and docs; `requireDiff: true`.

### Plan

- [x] 0. Precondition: 0161 is merged (env contract, metadata, sidecar file).
- [x] 1. Tests first:
  - `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts`: the state list includes `script-write`; the transitions and guards from R3; the prompt length is ≤1000; `onError: continue`; `expectFile`.
  - `apps/cli/tests/kk-workflow-stages.test.ts`: `daily-script-style` snapshot and idempotency (R1); `daily-script` env passthrough of the absolute plan and style paths (R4); `daily-run-report` passing `NEWS_REPORT_SCRIPT_FILE` (R5).
- [x] 2. Implement `dailyScriptStyle` plus its dispatch, and the extra env in `dailyScript` and `dailyRunReport`.
- [x] 3. Add the YAML var, state and transitions (R2, R3); run `spur workflow validate plugins/kk/workflows/kk-daily-ai-voice.yaml`.
- [x] 4. news-report-gen: `readScriptSource` plus the `脚本来源` line, with a test in `plugins/generations/news-report-gen/tests/news-report-gen.test.ts` covering plan, template+errors, and absent (R5).
- [x] 5. Update the docs (R6).
- [x] 6. Run `bun run lint` and `bun run test`. Optional dogfood: one zh run and one run with `script_write_enabled=false`, with `脚本来源` checked in both reports.

### Solution

Wired the `script-write` step end to end; per-file change map:

- plugins/kk/workflows/kk-daily-ai-voice.yaml:41 — var `script_write_enabled: "true"` (R3; `"false"` routes article/cover straight to `script`).
- plugins/kk/workflows/kk-daily-ai-voice.yaml:184 — new state `script-write` between `cover` and `script`: shell action `kk stage daily-script-style "${vars.work_dir}" "${vars.run_date}"`, then `agent.run` (`role: scribe`, `agent: ${vars.agent}`, `onError: continue`, 795-char zh prompt reading plan.json + the style snapshot and writing the per-item plan JSON, `expectFile` on the `_08_script-write_plan.json` path, `allowAppend: false`).
- plugins/kk/workflows/kk-daily-ai-voice.yaml:446 — transitions, first-match order preserved: `article → cover` stays first; guarded `article → script-write` and `cover → script-write` (`script_write_enabled=="true" && language=="zh" && ! -f plan.json && ! -f voicescript.yaml` — resume-safe); `article/cover → script` stay `always`; new `script-write → script` `always`.
- plugins/kk/scripts/kk-workflow-stages.ts:66 — `STYLE_SIDECAR` const (`daily-voice-style.zh.md`).
- plugins/kk/scripts/kk-workflow-stages.ts:928 — `dailyScriptStyle` (R1): idempotent — an existing `_08_script-write_style.md` snapshot is kept; otherwise `requireSidecar('', STYLE_SIDECAR, 'daily-voice-style')` fails loud naming the remediation on a broken install; mkdir `2-script`, copy.
- plugins/kk/scripts/kk-workflow-stages.ts:960 — `dailyScript` (R4) always passes `DAILYNEWS_SCRIPT_PLAN=resolve(work_dir/2-script/<date>_08_script-write_plan.json)` and `DAILYNEWS_STYLE_FILE=resolve(resolveSidecar(...))`, both absolute (spawn cwd is the plugin dir).
- plugins/kk/scripts/kk-workflow-stages.ts:1534 — `dailyRunReport` (R5) passes `NEWS_REPORT_SCRIPT_FILE=<abs work_dir>/2-script/<date>_08_script_content.json`.
- plugins/kk/scripts/kk-workflow-stages.ts:1703 — dispatch case `daily-script-style`.
- plugins/generations/news-report-gen/src/index.ts:204 — `ScriptSource` interface; plugins/generations/news-report-gen/src/index.ts:217 — exported `readScriptSource(path)`, best-effort like `readQcSummary`: absent/unreadable/malformed/metadata-less returns `null`, line omitted (R5).
- plugins/generations/news-report-gen/src/index.ts:364 — renders `**脚本来源**: plan` or `**脚本来源**: template（itemId:rule, …）` (parenthetical only when errors exist).
- plugins/generations/news-report-gen/src/index.ts:522 — `processGeneratorIO` reads `NEWS_REPORT_SCRIPT_FILE`.
- plugins/generations/dailynews-gen/src/index.ts:100 — carry-over 0161-review P2: `processGeneratorIO` skips `resolveScriptPlan` for non-zh (the builder template-builds en), so en stamps `scriptSource: 'template'` with empty `scriptPlanErrors` instead of a false `'plan'`.
- Docs (R6/T3): docs/design/kk-daily-ai-voice.md (purpose, mermaid, new artifacts + scriptSource note), docs/design/daily-voice-script-plan.md (status proposed → **shipped 2026-09-25**), docs/04_DESIGN.md (Daily-voice-script-plan row → shipped).

Judgment calls:
- `requireSidecar` label `daily-voice-style` (remediation: "install or refresh the kk package"), matching the other sidecar labels' style.
- Snapshot idempotency keeps an existing snapshot byte-for-byte — it is the audit record for a plan already written against it.
- Report detail uses `itemId:rule` joined with `, ` inside fullwidth parens, matching dailynews-gen's warn-line vocabulary.
- `spur workflow validate` passes (exit 0; warn-tier only: 736-char script-write prompt, 4-command guards — same warn class as the pre-existing plan-translate/QC edges).
- Integration path: the en integration run is unaffected by design (the guard skips script-write on `language: en`), so no fake-kk changes were needed; script-write coverage is static (state/transitions/guards/prompt cap) + runner-level (snapshot, env passthrough).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | plugins/kk/scripts/kk-workflow-stages.ts:928-941,1703-1705; apps/cli/tests/kk-workflow-stages.test.ts F613 block |
| R2 | MET | plugins/kk/workflows/kk-daily-ai-voice.yaml:184-209; apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:244-279 |
| R3 | MET | kk-daily-ai-voice.yaml:41,441-484; workflow test :244-279 |
| R4 | MET | kk-workflow-stages.ts:960-961; kk-workflow-stages.test.ts (absolute env stub test) |
| R5 | MET | kk-workflow-stages.ts:1534,1512; news-report-gen/src/index.ts:204,217,364,522; news-report-gen.test.ts F613 suite |
| R6 | MET | docs/design/kk-daily-ai-voice.md:4,18-28,68-69; docs/design/daily-voice-script-plan.md:3,93; docs/04_DESIGN.md:648 (T3, same diff) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | kk-daily-ai-voice.yaml:193-209; workflow test 0162 block; kk-workflow-stages.test.ts snapshot tests; LLM output quality deferred to dogfood zh run (task-only) |
| AC2 | MET | test | kk-daily-ai-voice.yaml:198 onError continue; dailynews-gen/src/index.ts:97-103 (en stamps template) + script-plan.test.ts en test; news-report-gen/src/index.ts:364 render tests |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

- Feature: `docs/features/F613_daily-voice-script-news-driven-coverage-with-a-fixed-style-contract.md`
- Design: `docs/design/daily-voice-script-plan.md`, `docs/design/kk-daily-ai-voice.md`
- Upstream: 0161
- Code: `plugins/kk/workflows/kk-daily-ai-voice.yaml`, `plugins/kk/scripts/kk-workflow-stages.ts`, `plugins/generations/news-report-gen/src/index.ts`
- Pattern: the `article-write` state (`kk-daily-ai-voice.yaml:138`), `onError: continue` (spur `wrapup-pipeline.yaml:183`)

### History

- 2026-09-25T05:38:29.087Z todo → wip (system)
- 2026-09-25T05:54:09.871Z wip → testing (system)
- 2026-09-25T05:57:26.518Z testing → done (system)

