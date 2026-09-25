# Daily voice script plan — news-driven coverage with a fixed style contract

Feature **F613** (parent F61). Status: proposed 2026-09-24.

## Problem

`dailynews-gen` builds the `kk-daily-ai-voice` VoiceScript entirely from templates:

- The intro, the item leads 首先/接着/最后, and the outro are fixed strings (`plugins/generations/dailynews-gen/src/script-builder.ts:364-426`).
- The "personal insight" lines come from 6 canned lines picked by keyword bucket (`zhInsightFor`, `:174-194`).

As a result, episodes sound almost the same every day, and the keyword buckets misfire. On 2026-09-24 the US–China AI-safety-talks item got the chip/hardware line.

## Shape

```
article → [cover] → script-write (agent.run, onError: continue) → script (kk stage daily-script) → wrap-docs …
                     writes 2-script/<date>_08_script-write_plan.json      reads it if valid, else templates
```

Ownership:

- **The LLM owns the words.** It writes the intro, the outro, and one lead plus one insight per item.
- **The builder owns everything that keeps the style steady:**
  - segment order
  - `emotion` / `speed` / `gap_ms` tokens
  - text normalization
  - fact chunking (`MAX_FACT_SEGMENT_CHARS`)
  - `validate-voicescript`

The LLM never writes YAML. This keeps the pacing invariants from tasks 0139 and 0140 intact.

### 1. Style contract (R1)

The contract is the kk sidecar `plugins/kk/scripts/daily-voice-style.zh.md`, resolved by `resolveSidecar` like the other shipped sidecars. Spur workflows have no workflow-dir variable, so `kk stage daily-script-style` snapshots it to `2-script/<date>_08_script-write_style.md`, and the prompt reads that snapshot. It defines:

- **Host persona and register:** spoken Mandarin, first person, calm and informed, no hype.
- **Fixed greeting and sign-off:** the builder always emits these. The plan's intro and outro go *between* them, so the show's identity never drifts.
- **Segment roles:**
  - `lead` is a one-sentence spoken bridge into the item. It does not repeat the title.
  - `insight` is 1–2 sentences on why this item matters, grounded in the item's own facts.
- **Banned phrases:** every current `zhInsightFor` line, 「首先/接着/最后」 as openers, and the 0133 hedges and scaffold labels.
- **Char caps:** intro ≤ 120, outro ≤ 120, lead ≤ 60, insight ≤ 160.

The caps and banned list are machine-readable in a fenced `json` block inside the same file. The prompt and the validator therefore read one source.

### 2. `script-write` state (R2)

This is a new state in `kk-daily-ai-voice.yaml`. It uses the same `agent.run` pattern as `article-write`:

- `role: scribe`
- `agent: ${vars.agent}`
- prompt ≤ 1000 chars (ADR-115)
- `expectFile`
- `allowAppend: false`
- `onError: continue`

It reads `2-plan/<date>_03_plan_plan.json` (a bare `Doc[]`), the same items, order, and titles that the show notes are rendered from. It also reads the style file. It writes:

```json
{
  "version": 1,
  "intro": "…today's themes…",
  "outro": "…",
  "items": [{ "id": "<Doc.id>", "lead": "…", "insight": "…" }]
}
```

Rewiring: `article → script` and `cover → script` gain a preceding `→ script-write` edge (guarded: enabled, zh, and neither today's plan nor YAML exists), and a new `script-write → script` edge is added with `always`. A new var `script_write_enabled` (default `"true"`) guards the state. When it is false, the article/cover edges go straight to `script`, mirroring `article_write_enabled`.

### 3. Builder consumes the plan (R3, R4)

`dailyScript` always passes `DAILYNEWS_SCRIPT_PLAN=<abs path>` and `DAILYNEWS_STYLE_FILE=<abs path>`. A plan file that does not exist is reported as `missing-plan`. `processGeneratorIO` loads the plan, and `validateScriptPlan(plan, docs, style)` returns either `{ ok: true, plan }` or `{ ok: false, errors: [{ itemId, rule }] }`. The rules are:

- `missing-plan` / `no-style` / `schema`: the plan file is absent, the style file cannot be read, or the plan has the wrong shape.

- `unknown-id`: a plan item id that does not match any doc.
- `missing-item`: a doc with no plan item.
- `cap:<field>`: a field over its char cap.
- `banned:<phrase>`: a field containing a banned phrase.
- `duplicate-insight`: the same insight text on two items in one episode.

When validation passes, `buildNewsVoiceScript(docs, { ...options, scriptPlan })` substitutes the plan text into the same segment slots. It does not change the order, the tokens, or the chunking. The facts still come from the docs. `synthesizePersonalUnderstanding` is used only on the template path.

### 4. Explicit fallback (R5)

The builder falls back to templates when the plan is missing, is not parseable, or fails validation. In that case it:

1. Builds from the templates.
2. Logs `warn` with the rule list.
3. Stamps `Content.metadata.scriptSource: 'plan' | 'template'` and `scriptPlanErrors` on the output. These are always present, so the run report can tell which path ran.

`dailyRunReport` adds `NEWS_REPORT_SCRIPT_FILE` (the `_08_script_content.json`). `news-report-gen` renders one line, 脚本来源, and lists any rejection reasons. The fallback is visible in the run report and never silent.

### 5. Regression (R6)

A fixture test uses the 2026-09-24 US–China item together with a hand-written plan. It asserts that the plan's insight is spoken and that the hardware canned line is absent.

## Not changed

- Voice drivers, QC, show notes, article, and publish.
- The English (`en`) template path. en styling is out of scope, and the plan is zh-only. An en run skips `script-write` through a guard on `language`.
- No cross-episode similarity check. The per-episode uniqueness rule plus banned phrases is the first rung.

## Decision notes

- **No new ADR.** This is additive inside existing seams: an `agent.run` state and a generator input env var. ADR-007 ("kk owns steps; spur orchestrates") holds.
- **Why a plan instead of a full YAML:** see the idea evaluation. Letting the LLM write YAML would hand it the pacing and validation invariants.
- **Why reading plan.json instead of the show notes:** the show notes render after audio, from this same plan.json.
