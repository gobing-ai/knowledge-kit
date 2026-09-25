---
schema_version: 1
name: dailynews-gen builds the VoiceScript from a validated script plan under a style contract
status: todo
template: feature-impl
created_at: 2026-09-25T03:51:45.346Z
updated_at: "2026-09-25T04:08:30.976Z"
feature_id: F613
priority: P1
tags:
  - dailynews-gen
  - voice
  - F613
estimate_hours: 4

---

## 0161. dailynews-gen builds the VoiceScript from a validated script plan under a style contract

### Background

Implements: R1 — A checked-in style contract defines the daily host voice; R3 — dailynews-gen builds the VoiceScript from a valid script plan; R4 — Script-plan text that breaks the style contract is rejected; R6 — Commentary is grounded in each item instead of keyword buckets; builder side of R5 (fallback + `scriptSource` stamp).

Every spoken line in the kk-daily-ai-voice VoiceScript is a template. The intro is fixed at `plugins/generations/dailynews-gen/src/script-builder.ts:363`, the 首先/接着/最后 leads at `:384-394`, and the outro at `:424-426`. Insights are 6 keyword-bucketed canned lines (`zhInsightFor`, `:174`), so episodes sound the same, and the buckets misfire. In the 2026-09-24 run (`.works/kk-daily-ai-voice/20260924/2-script/20260924_08_script_voicescript.yaml:17`), item `520246ce54c2a6e6` (专家警告：特朗普的对华竞争与「AI 竞赛」错觉可能危及美国) got 「真正被重新定义的，是硬件层承担的安全与算力责任…」. Design satellite: `docs/design/daily-voice-script-plan.md`.

**Refine corrections (2026-09-24)**
- "plan.json has `metadata.docs`" → verified reality: `2-plan/<date>_03_plan_plan.json` is a bare `Doc[]` (9 docs on 20260924; `processGeneratorIO` parses it with `DocListSchema`, `src/index.ts:24`) → resolution: the plan's `items[].id` binds to `Doc.id`; no `metadata.docs` anywhere.
- "Style file at `plugins/generations/dailynews-gen/style/zh-daily.md`" → verified reality: spur workflows have no workflow-dir var, so the script-write prompt could not reach a plugin-internal path; kk already ships per-workflow files as sidecars resolved by `resolveSidecar` (`plugins/kk/scripts/kk-workflow-stages.ts:130`, `$KK_WORKFLOWS_DIR` > package scripts dir > `~/.config/kk/workflows`) → resolution: the contract is the sidecar `plugins/kk/scripts/daily-voice-style.zh.md`; dailynews-gen stays path-agnostic and reads it only via the absolute `DAILYNEWS_STYLE_FILE` (0162 resolves and passes it).
- Plugin processes run with cwd = the plugin package dir (`kk-workflow-stages.ts:1477`) → both new env paths are absolute; a relative path is the caller's bug, not something the plugin resolves.
- `.works/` is gitignored (`.gitignore:170`) → the regression doc is copied (body trimmed) into a checked-in test fixture, not read from `.works`.

### Requirements

- [ ] R1. Add the style contract `plugins/kk/scripts/daily-voice-style.zh.md` with these parts:
  - persona and register: spoken Mandarin, first person, calm and informed, no hype
  - segment roles: intro, lead, insight, outro
  - one fenced `json` block `{"caps":{"intro":120,"outro":120,"lead":60,"insight":160},"banned":[…]}` whose `banned` list includes every current `zhInsightFor` return string, the openers 首先/接着/最后, and the 0133 hedges and scaffold labels (可做角度, 背景, 潜在影响, 读者宜另行核实, 仍待验证)
- [ ] R2. `validateScriptPlan(plan, docs, style)` returns `{ok:true, plan}` or `{ok:false, errors:[{itemId, rule}]}`. Rules:
  - `missing-plan`: the plan file does not exist
  - `schema`: wrong shape or version
  - `unknown-id`: a plan item id that is not a doc
  - `missing-item`: a doc with no plan item
  - `cap:<field>`: a field over its cap
  - `banned:<phrase>`: a field containing a banned phrase
  - `duplicate-insight`
  - For episode-level fields (intro/outro/schema), `itemId` is `episode`.
- [ ] R3. With `DAILYNEWS_SCRIPT_PLAN` and `DAILYNEWS_STYLE_FILE` set (absolute paths), and after the `DAILYNEWS_MAX_ITEMS` cap, a valid plan fills the text slots per Design § Substitution. Segment count and order, `emotion`, `speed`, `gap_ms` and `splitFactText` chunking are identical to the template path for the same docs. The YAML passes `plugins/kk/scripts/validate-voicescript.ts`.
- [ ] R4. `Content.metadata` always carries `scriptSource` (`'plan'` | `'template'`) and `scriptPlanErrors` (`[]` when none). When `DAILYNEWS_SCRIPT_PLAN` is unset the build uses templates with `scriptPlanErrors: []`. A plan file that is absent (`missing-plan`), unreadable, or rejected also falls back to templates:
  - an unreadable style file counts as rejected, with rule `no-style`
  - the template output is byte-identical to today's builder
  - one `echoError` warn line names every `itemId`/`rule`
  - the exit code is still 0
- [ ] R5. Regression test using the fixture doc `520246ce54c2a6e6`, with a plan whose insight is about the talks: the plan insight is spoken, and the substring `硬件层承担的安全与算力责任` is absent. The same doc without a plan still produces that line, which pins the bug the plan fixes.
- Out of scope: en plan path (en always builds from templates), cross-episode similarity, workflow wiring, run-report rendering, and the script-write prompt (all 0162).

### Acceptance Criteria

- [ ] AC1 — A checked-in style contract defines the daily host voice (req: R1)
- [ ] AC2 — dailynews-gen builds the VoiceScript from a valid script plan (req: R3)
- [ ] AC3 — Script-plan text that breaks the style contract is rejected (req: R2)
- [ ] AC4 — Commentary is grounded in each item instead of keyword buckets (req: R5)

Task-only: R4 (fallback metadata and warn) is observed in `tests/script-plan.test.ts` through `processGeneratorIO` on temp files, because the real IO layer carries that behaviour. Every AC is observable in `plugins/generations/dailynews-gen/tests/script-plan.test.ts`.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-25T03:59:23.924Z

- **Q: Where does the style contract live?** A: `plugins/kk/scripts/daily-voice-style.zh.md`, a kk sidecar resolved by `resolveSidecar`. Chosen because the agent prompt needs a reachable path and kk already ships per-workflow files that way. Closed 2026-09-24.
- **Q: Is 【title】 still spoken on the plan path?** A: Yes. `lead` is a bridge that precedes 【title】, keeping the 0139 R1 invariant. Closed.
- **Q: Can a partially valid plan be used?** A: No. It is all or nothing, so a mixed episode can never drift in voice. Closed.
- **Q: Does en get a plan path?** A: No. It is out of scope per F613 Scope; en ignores the plan. Closed.

### Design

**Chosen:** the plan is data substituted into the existing builder. The LLM supplies words; the builder keeps structure, pacing and validation.
**Rejected:**
- LLM-authored YAML: it hands over the 0139/0140 pacing invariants.
- Bigger template bank: still canned, still misfires.
- Style inside the dailynews-gen package: the agent prompt cannot reach a plugin-internal path (see Background corrections).

**Frozen names**
- New module `plugins/generations/dailynews-gen/src/script-plan.ts`, re-exported from `src/index.ts`:
  - `interface ScriptPlan { version: 1; intro: string; outro: string; items: { id: string; lead: string; insight: string }[] }`, parsed with a zod schema (`zod` 4.4.3 is already a direct dependency in `plugins/generations/dailynews-gen/package.json`)
  - `interface StyleContract { caps: { intro: number; outro: number; lead: number; insight: number }; banned: string[] }`
  - `parseStyleContract(markdown: string): StyleContract` reads the first fenced `json` block. A missing or invalid block throws.
  - `validateScriptPlan(plan: unknown, docs: Doc[], style: StyleContract): { ok: true; plan: ScriptPlan } | { ok: false; errors: { itemId: string; rule: string }[] }`
- `ScriptBuilderOptions.scriptPlan?: ScriptPlan`
- Env vars: `DAILYNEWS_SCRIPT_PLAN` and `DAILYNEWS_STYLE_FILE`
- Metadata keys: `scriptSource` and `scriptPlanErrors`

**Substitution** (zh only, and only when `scriptPlan` is set)
- **intro** = the fixed greeting `大家好，今天是${dateStr}，欢迎收听由${hostName}为您带来的今日AI科技漫谈。` + `plan.intro`. This replaces the template's 「今天科技圈有几条…正题。」 tail.
- **lead** = `${item.lead}【${cleanTitle}】。` This keeps the 0139 R1 invariant that 【title】 is spoken exactly once. The lead is a bridge into the title and must not contain it.
- **insight** = `item.insight`. It is always emitted, and `synthesizePersonalUnderstanding` is not called.
- **outro** = `plan.outro` + the fixed sign-off `感谢您的收听，我是${hostName}，祝您拥有充实高效的一天，我们下期节目不见不散！`
- All plan text goes through `normalizeBroadcastText`. Plan items are matched to docs by id, and **doc order wins**; plan item order is ignored.

**Precedence in `processGeneratorIO`**
1. Parse docs, then apply the `DAILYNEWS_MAX_ITEMS` cap.
2. If `DAILYNEWS_SCRIPT_PLAN` is unset, use the template path with `scriptPlanErrors: []`.
3. Otherwise check the plan file exists (absent gives `missing-plan`), read the style (a failure gives `no-style`), read and JSON-parse the plan (a failure gives `schema`), validate, then build.
4. Stamp the metadata on every path.

**Invariants**
- Facts always come from `doc.body`.
- Greeting and sign-off are builder-owned.
- The template path is byte-identical to today, so the existing `tests/dailynews-gen.test.ts` stays green unchanged.
- Fallback is never silent.
- `language === 'en'` ignores the plan and stamps `scriptSource:'template'` with no error.

**Anti-patterns**
- No per-field partial use of a rejected plan; it is all or nothing.
- No retry or LLM call inside the plugin.
- No reading the style file from a relative or cwd path.
- No title in `lead`.
- No new emotion or gap values.

**Handoff to 0162:** 0162 needs the two env names, the absolute-path requirement, the metadata keys, and the style sidecar filename `daily-voice-style.zh.md`. 0162 owns resolving and passing the paths, the script-write prompt, and rendering the report line.

**Budget:** about 4h; single package plus one sidecar markdown file; `requireDiff: true`.

### Plan

- [ ] 1. Write `plugins/kk/scripts/daily-voice-style.zh.md` (R1), with the banned list copied from the current `zhInsightFor` returns (`script-builder.ts:174-194`).
- [ ] 2. Add the fixture `plugins/generations/dailynews-gen/tests/fixtures/20260924-us-china-doc.json`, copied from `.works/kk-daily-ai-voice/20260924/2-plan/20260924_03_plan_plan.json` id `520246ce54c2a6e6` with the body trimmed but still mentioning 出口管制/芯片.
- [ ] 3. Write the tests first in `tests/script-plan.test.ts`:
  - parseStyleContract on the real sidecar
  - each validator rule (R2)
  - plan-path vs template-path segment parity on emotion/speed/gap_ms/count (R3)
  - fallback metadata and warn for unset, missing, bad-JSON, rejected, and no-style plans (R4)
  - the 20260924 regression, positive and negative (R5)
- [ ] 4. Implement `src/script-plan.ts`, add the `scriptPlan` substitution in `buildNewsVoiceScript`, and the env handling and metadata in `processGeneratorIO`.
- [ ] 5. Run `validate-voicescript.ts` on a plan-path YAML inside the test (R3).
- [ ] 6. Update the `docs/design/dailynews-gen.md` inputs table (the two env vars, the metadata keys) in the same commit (T3).
- [ ] 7. Run `bun run lint` and `bun run test`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: `docs/features/F613_daily-voice-script-news-driven-coverage-with-a-fixed-style-contract.md`
- Design: `docs/design/daily-voice-script-plan.md`, `docs/design/dailynews-gen.md`
- Code: `plugins/generations/dailynews-gen/src/script-builder.ts`, `src/index.ts`, `plugins/kk/scripts/kk-workflow-stages.ts:130` (resolveSidecar)
- Dependent: 0162 (workflow wiring + report)
- Evidence: `.works/kk-daily-ai-voice/20260924/` (local, gitignored)

### History
