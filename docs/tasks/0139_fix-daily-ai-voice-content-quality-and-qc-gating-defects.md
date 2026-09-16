---
schema_version: 1
name: Fix daily-ai-voice content quality and QC gating defects
status: todo
template: issue
created_at: 2026-09-16T15:27:18.401Z
updated_at: "2026-09-16T16:50:55.960Z"

dependencies: ["0138"]
---

## 0139. Fix daily-ai-voice content quality and QC gating defects

### Background

Script/voice-level defects from the 2026-09-16 kk-daily-ai-voice dogfood (run `dogfood-daily-031816`, workspace `.works/kk-daily-ai-voice/2026-09-16/`), root causes verified against the current tree during ready-depth refine. Sibling task 0138 covers plan/article/report-level defects from the same run (dependency declared — land 0138 first; it changes plan bodies upstream of the script stage).

**V1 — `【标题】。标题` duplication in every item segment.**
`buildNewsVoiceScript` (`plugins/generations/dailynews-gen/src/script-builder.ts:263-296`) sets `factText = lead + body`, where lead ends `【${cleanTitle}】。` (:270-273) and the translated plan body opens by restating the title (plan-translate derives titles from bodies). All 7 item segments in `_08_script_voicescript.yaml` carry the duplication; QC flagged `repetition_detected` on the rendered audio (seg 1).

**V2 — Commentary filler: duplicates + topic mismatch.**
`synthesizePersonalUnderstanding` (:147-176) is first-match regex buckets over `title+body` with a single default fallback — no per-episode uniqueness. Run evidence: the 电力/能源 line fired after the Nvidia-regulation item AND the Apple Secure Enclave item (bucket regex includes bare `芯片|硬件|工厂`); the 内容创作门槛 (sora) line fired after the Meta item AND a Gemini item (`生成` matches generative-AI bodies); the default fallback `这项新动态反映出…` appeared twice (one instance hand-fixed at the HITL gate).

**V3 — Plan metadata markers leak into spoken text.**
Segment texts contained `标签，…` tails, `背景`/`潜在影响`/`可做角度` label prefixes, and `wss://` mangled to `wss，//` (translation colon damage) — all hand-fixed at the HITL gate this run. 0138's plan-translate prompt contract + article strip reduce this upstream, but nothing deterministic guards the voicescript: `plugins/kk/scripts/validate-voicescript.ts` (`validateVoiceScript:121`) validates schema/caps only and is **wired nowhere** in the daily workflow (no reference in `kk-daily-ai-voice.yaml`).

**V4 — Overlong segments.**
One segment is emitted per item regardless of body length (:289-294): factText = lead+body with bodies up to 1082 chars → rendered audio segments of 141–223s (observed zh speech rates 3.4–6.1 chars/s in `_11_generate_content.json` audits). Consequences measured this run: whisper transcription fidelity collapses to 0.25–0.41 on long segments, loudness scan returns `loudness_dip:unknown` ×6, 9/16 segments burned verify-retries (most ×2), and generate took ~118 min vs the 79-min 09-12 baseline.

**V5 — QC verdict never gates anything that matters.**
omni-voice-gen's verify loop (`pipeline.py:_render_verified:136`) retries on transcription-fidelity floor and loudness dips only — **repetition is not a verify trigger** — and the final attempt is always accepted. The QC audit flags `repetition_detected` (seg 9's transcription showed a ~40× repeated outro loop) and sets `passed:false`, but publish proceeded to verdict `full`; the only consumer of `qc.passed` is the generate-stage cache check (`kk-workflow-stages.ts:784-786`). Result: an episode with a repetition loop is live on podcast.salty.vip.

### Requirements

- [ ] R1. **No title echo in fact segments.** `buildNewsVoiceScript` strips a leading title restatement from the item body before joining it to the 【title】 lead, so each title is spoken once per item. Punctuation variants (translator inserting `，`) are handled.

- [ ] R2. **Commentary uniqueness + topic fit.** Within one episode the same filler line is never emitted twice (a colliding item gets no commentary segment, not a repeat), and the energy/infra line requires energy-side keywords (算力|吉瓦|电力|能源|数据中心|基础设施) — bare 芯片/硬件/工厂 no longer selects it. The 2026-09-16 misfires (Nvidia-regulation, Apple, Meta, Gemini items) are the regression fixtures.

- [ ] R3. **Deterministic voicescript content gate, wired into the workflow.** `validateVoiceScript` gains content checks: intra-segment 【X】 title echo, duplicate segment texts, scaffold labels (`背景`/`潜在影响`/`可做角度`/`为什么现在值得注意`/`社区讨论` leading labels, `标签，` tails), and URL colon mangling (`，//`, `。//`). The validator runs (a) at the end of the script stage's fresh-write path and (b) in wrap-docs before doc packaging (covers HITL-edited YAML and the cache path). Failure = stage exit 1 with segment index + reason; recovery = operator edits YAML, `spur workflow continue`.

- [ ] R4. **Fact segments split to ≤300 chars.** Item factText is split at sentence boundaries (。！？…) into chunks of at most `MAX_FACT_SEGMENT_CHARS = 300` (observed rates 3.4–6.1 chars/s ⇒ ~49–88s per chunk); concatenation of an item's chunks is byte-identical to the unsplit text; a single sentence >300 chars stays whole. No segment exceeds ~90s expected audio.

- [ ] R5. **Repetition hard-fail + QC visibility.** (a) After the QC audit, if any segment carries `repetition_detected` (transcription-side — text-side is already blocked by R3), omni-voice-gen still writes content.json for inspection but exits non-zero naming the segment indexes, failing the run before publish. (b) news-report-gen renders a QC block (score, passed, per-issue counts) from `_11_generate_content.json` metadata.qc in the run report. (c) Whether `qc.passed:false` should additionally *block publish* is an operator policy decision — recorded in Q&A; default behavior stays warn-only.

### Acceptance Criteria

AC1 (R1): Unit test in `plugins/generations/dailynews-gen/tests/`: a body opening with the title restatement (Nvidia fixture from the run, including the `，`-inserted punctuation variant) produces a factText where the title text occurs exactly once; a body NOT opening with the title is unchanged.

AC2 (R2): Fixture test over the 7 translated plan items from `20260916_03_plan_plan.json`: no filler line repeats in the episode; the Nvidia-regulation and Apple items receive no energy/infra line; the Meta and Gemini items receive no sora/创作门槛 line; episode with 2+ default-bucket items emits the default line at most once (later items get no commentary segment).

AC3 (R3): Validator tests (kk scripts + the voice-gen SYNC twin): each content check (title echo, duplicate segment text, each scaffold-label pattern, `标签，` tail, `，//`) fails with segment index + reason; the cleaned 2026-09-16 voicescript passes; `apps/cli/tests/validate-voicescript.test.ts` substring assertions stay green without modification.

AC4 (R3): Stage-level assertion: `dailyScript` exits non-zero when the generated voicescript contains a `标签，` tail; `dailyWrapDocs` exits non-zero on a HITL-edited YAML with a duplicate segment; after YAML repair, wrap-docs proceeds and generate consumes the file.

AC5 (R4): Unit test: a 1082-char body (run fixture) splits into ≤300-char chunks at sentence boundaries; `chunks.join('') === factText`; a 320-char single-sentence body stays one segment; item of 92 chars unchanged.

AC6 (R5a): pytest in `plugins/generations/omni-voice-gen/tests/`: a segment audit with `repetition_detected` causes a non-zero exit naming the segment index on stderr; content.json is still written; clean audits exit 0.

AC7 (R5b): Unit test in `plugins/generations/news-report-gen/tests/`: report rendering includes the QC block (score/passed/issue counts) read from a fixture `_11_generate_content.json` with `passed:false`.

AC8 (R5c): The publish-gating policy decision is recorded in Q&A with the operator's answer; behavior matches the recorded decision (default warn-only).

AC9: `bun run lint && bun run test && bun run build` green; `make lint && make test` in `plugins/generations/omni-voice-gen` green.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-16T16:50:55.758Z

1. **OPEN — publish gating policy (owner: Robin).** When generate completes with `qc.passed:false`, should the publish state block (status `none`, translations/report continue unpublished) or stay warn-only (current + the R5b QC block for visibility)? Default implemented: warn-only, because R5a already hard-fails the run on the worst defect (repetition). Flipping to block later is a one-guard change in the publish stage. **Answer needed before AC8 can PASS.**
2. Validator placement: wired at script-stage end + wrap-docs rather than the review-state guard — stage wiring has well-defined failure semantics (exit 1 → resume after edit) and covers both fresh writes and HITL-edited YAML; guard-failure semantics on HITL states are less certain.
3. Repetition hard-fail ships without an override knob: a false positive (whisper hallucination on clean audio) costs one re-run; publishing a loop costs credibility. Fail loud; recovery is HITL YAML inspection + rerun. Add an env override only if a false positive actually occurs.
4. R4 cap = 300 chars from observed rates 3.4–6.1 chars/s (49–88s/chunk); not 400 (would reach ~117s at the slowest observed rate).
5. Filler collision ⇒ no commentary segment (not a second-choice line): a wrong-topic filler is worse than none; segment cadence is not load-bearing downstream (verified: consumers read the segments list only).
6. Dependency edge to 0138 set via `spur task deps 0139 add 0138` (2026-09-16): 0138's prompt contract + plan.json dedup change script-stage inputs; this task's validator is the deterministic backstop, not a substitute.

### Design

All fixes deterministic, local, no new LLM calls, no network. Locations refine-verified 2026-09-16. Depends on **0138** (land first): its plan-translate prompt contract + plan.json dedup change script-stage inputs; V3's label leak is expected to shrink after 0138, with R3's validator as the deterministic backstop for the remainder.

**1. R1 — title-echo strip (`plugins/generations/dailynews-gen/src/script-builder.ts`, before `:281`).**
New helper `stripLeadingTitleEcho(body: string, title: string): string`: normalize both sides by stripping `[，。、\s「」]`, and when the normalized body starts with the normalized title, drop the body's first sentence (through the first `。`). Applied to `cleanBody` ahead of `normalizeBroadcastText`. WHY prefix-sentence drop and not fuzzy match: plan-translate derives titles from the body's first sentence, so the echo is always a prefix with at most punctuation drift (run-verified on all 7 items).

**2. R2 — filler uniqueness + bucket split (`synthesizePersonalUnderstanding:147`).**
Signature gains `used: Set<string>`; `buildNewsVoiceScript` owns one set per episode. On bucket-line collision, the item emits NO insight segment (skip the second push at :294) — never a repeat. Split the infra bucket: energy line requires `/算力|吉瓦|电力|能源|数据中心|基础设施|基建/`; new hardware/chip bucket `/芯片|硬件|处理器|enclave/i` with its own line. Comment cites the 2026-09-16 misfires (Nvidia/Apple → energy, Meta/Gemini → sora).

**3. R3 — validator content checks + wiring (`plugins/kk/scripts/validate-voicescript.ts` + SYNC twin `plugins/generations/voice-gen/src/voicescript.ts`).**
New per-segment checks inside `validateVoiceScript`: (a) title echo — text matches `【(.{4,80})】[，。、\s]*\1`-style reappearance of the bracketed content; (b) duplicate segment text (exact, after trim); (c) scaffold labels — leading `背景`/`潜在影响`/`可做角度`/`为什么现在值得注意`/`社区讨论` label patterns or `标签，` anywhere; (d) URL mangling — `，//` or `。//`. New error messages use a new prefix (`content check failed`) — existing substrings untouched (`apps/cli/tests/validate-voicescript.test.ts` pins them). Wiring via the existing sidecar mechanism (`requireSidecar`/`delegate`, kk-workflow-stages.ts:1137): (i) end of `dailyScript` fresh-write branch (:750-756), (ii) `dailyWrapDocs` (:759) before doc packaging — the wrap-docs call covers HITL-edited YAML and the script-stage cache path.

**4. R4 — fact-segment splitting (`script-builder.ts:285-294`).**
`const MAX_FACT_SEGMENT_CHARS = 300; // ponytail: run rates 3.4–6.1 zh chars/s ⇒ 49–88s/chunk; raise only with measured evidence`. Split `factText` after sentence-final punctuation (。！？…, and `；` when a chunk would otherwise exceed the cap) into ≤300-char chunks; each chunk becomes its own segment with the same emotion/gap pattern as today's fact segment. Concatenation invariant: `chunks.join('') === factText`. Single sentence > cap → unsplit (comment).

**5. R5a — repetition hard-fail (`plugins/generations/omni-voice-gen/src/omni_voice_gen/pipeline.py`, after the audit in `_render`).**
If any `SegmentQualityAudit.issues` contains `repetition_detected`, write content.json as today, then `sys.exit(1)` with stderr listing the failing segment indexes. The verify loop itself is unchanged (fidelity/dip triggers stay; the final attempt is still accepted) — the hard-fail is a post-audit gate, not a new retry trigger.

**6. R5b — QC block in run report (`plugins/generations/news-report-gen`).**
Report builder reads `${run_date}_11_generate_content.json` when present (best-effort, absent → section omitted) and renders overall score, passed, and per-issue-type counts.

**Frozen contracts:** VoiceScript YAML schema + existing validator error substrings; plugin `--in/--out` IO; artifact paths/names; workflow state ids; segment gap_ms/emotion pattern for split chunks; no new env vars.

**Anti-patterns to avoid:** no fuzzy/LLM similarity for the title echo (deterministic prefix rule only); no filler rotation state machine (collision ⇒ no commentary, not a rewrite); no silent scaffold *stripping* in the script path (0138 owns upstream prevention; this gate fails loudly — deterministic over implicit); no retry-trigger change for repetition (post-audit gate instead); no new validator message substrings that collide with pinned ones; no validator checks that require network or audio.

### Plan

1. **dailynews-gen (R1, R2, R4 — one file, one test run):** `stripLeadingTitleEcho` + filler uniqueness/bucket split + fact-segment splitting in `script-builder.ts`; tests AC1, AC2, AC5.
2. **Validator + wiring (R3):** content checks in `validate-voicescript.ts`, mirror to the `voice-gen` SYNC twin, wire into `dailyScript` + `dailyWrapDocs`; tests AC3, AC4.
3. **omni-voice-gen (R5a):** post-audit repetition hard-fail in `pipeline.py`; pytest AC6 (`make lint && make test`).
4. **news-report-gen (R5b):** QC block in the run report; test AC7.
5. **Integration:** re-run the daily workflow over a copy of the 2026-09-16 blend (fixture/stub for Horizon if needed): voicescript passes the new validator unedited, no title echo, no filler repeat, segments ≤300 chars, generate completes, run-report carries the QC block.
6. **Verify:** full gates (AC9); confirm 0138 landed first (dependency).

Steps 1–2 both touch the script path — do them in order in one working session; 3–4 are independent packages.

### Root Cause

Verified 2026-09-16 against the current tree:
- V1: `plugins/generations/dailynews-gen/src/script-builder.ts:270-273,285` — lead `【title】。` + body that restates the title (plan-translate derives titles from bodies) are concatenated unfiltered.
- V2: `script-builder.ts:147-176` — first-match regex buckets, no per-episode uniqueness; energy bucket regex contains bare `芯片|硬件|工厂`, sora bucket contains bare `生成`.
- V3: `plugins/kk/scripts/validate-voicescript.ts:121` validates schema/caps only; no reference to it in `plugins/kk/workflows/kk-daily-ai-voice.yaml` (validator unwired in the daily flow).
- V4: `script-builder.ts:289-294` — one segment per item, no length bound; `_11_generate_content.json` audits show 141–223s segments at 3.4–6.1 chars/s.
- V5: `plugins/generations/omni-voice-gen/src/omni_voice_gen/pipeline.py:_render_verified` — verify triggers are fidelity floor + loudness dip only; final attempt always accepted; `qc.passed` consumed only by the generate-stage cache check (`plugins/kk/scripts/kk-workflow-stages.ts:784-786`), never by publish.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Dependency: **0138** (plan/article/report-level defects, same run — land first; edge in frontmatter).
- Run evidence: `.works/kk-daily-ai-voice/2026-09-16/` (run `dogfood-daily-031816`) — `_03_plan_plan.json`, `_08_script_voicescript.yaml` (HITL-corrected copy), `_11_generate_content.json` (QC audits: rates, retries, dips, repetition), `_17_publish_publish-status.txt` (`full` despite `passed:false`).
- Validator SYNC contract: `plugins/kk/scripts/validate-voicescript.ts` header — mirror changes to `plugins/generations/voice-gen/src/voicescript.ts`; error substrings pinned by `apps/cli/tests/validate-voicescript.test.ts`.
- Related landed fix: `f650fd9` — omni-voice-gen QC inverted duration ceiling removed (false-positive source already gone; R5 issues remaining are repetition/dips).
- Baseline: 09-12 run step-timing — generate 79 min vs this run's ~118 min (V4 cost evidence).

### History
