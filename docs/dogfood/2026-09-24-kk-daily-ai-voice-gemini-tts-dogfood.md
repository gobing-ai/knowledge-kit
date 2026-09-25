---
run_id: dogfood-daily-gemini-20260924
date: 2026-09-24
status: PASS
testee: plugins/kk/workflows/kk-daily-ai-voice.yaml (voice driver gemini-tts, task 0159/0160)
classification: full-e2e-live
mode: fix (--max-retry 2)
workspace_fingerprint: HEAD @ 2026-09-24 (post gemini-tts integration; fix commit 2aa2ea82)
live_path: .spur/run/dogfood/dogfood-daily-gemini-20260924.md
report_path: docs/dogfood/2026-09-24-kk-daily-ai-voice-gemini-tts-dogfood.md
protocol: sp-dogfood-testing (operator-authorized full publish, skip_review=true)
---

# Dogfood Report — kk-daily-ai-voice × gemini-tts (2026-09-24)

**Verdict: PASS.** The gemini-tts voice driver completed a full live pipeline run —
collect → QC'd plan → article → cover → voicescript → TTS (51.9 MB) → QC (score 100) →
podcast publish → surfdash article → en/ja localization — producing today's real episode.
One MEDIUM defect (F1) was found, root-caused, fixed, and validated under a reproduced
failure condition; the episode was completed via a surgical re-drive of the publish tail.

## Run shape

| Aspect | Value |
| ------ | ----- |
| Run id | `dogfood-daily-gemini-20260924` (`--async`, frozen vars: `vdriver=gemini skip_review=true publish_enabled=true last30days_enabled=true`) |
| Engine | cached fast-forward through script (morning run artifacts reused), then live generate→publish |
| generate | gemini-tts 21.5 min → `content.wav` 51.9 MB + `intro.wav` 52.4 MB (profile `robin-news` → voice `yrfq18e9eep9`, repo src confirmed in ps — project plugin shadowing works live) |
| QC | score **100**, 1064.33 s audio, avg rate 5.15 chars/s across 31 segments (min 4.15 / max 6.88); ASR verify loop exercised, zero regens |
| Podcast | published in 27 s — episode `IdDo7yGVKuP` live with correct article cross-link (verified) |
| Surfdash | zh article live (`/zh/posts/20260924-ai-2026-09-24`), classify **full** (2/2), patch committed + pushed |
| Locales | en/ja scaffolded, translated per the agent contract (draft:false, canonical stripped), synced (`ok:true`); live at `/posts/20260924-ai-2026-09-24` (en = default locale, no prefix) and `/ja/posts/20260924-ai-2026-09-24` |
| Gate | `bun run lint` clean · `bun run test` 1335 pass / 0 fail · fix commit `2aa2ea82` |

## F1 (MEDIUM, fixed) — async digest-env leak breaks nested spur workflows

**Symptom.** `daily-publish-surfdash` failed inside the async run:
`refusing to start — resolved definition digest sha256:5de5bd6e… ≠ expected sha256:4285f29e…`,
classifying the episode `partial` and skipping the locale leg.

**Root cause.** `spur workflow run --async` exports `SPUR_EXPECTED_DEFINITION_DIGEST`
(the parent run's identity binding, spur.js:127435) into the worker env. Every descendant
inherits it — the stage shells `kk executor fan-out surfdash-pub`, which shells postsurfing,
which runs its **own** nested `spur workflow run publishing`. That nested run resolved its
own digest (5de5bd6e…), compared it against the parent's leaked expectation (4285f29e…)
(spur.js:127513, mismatch path 127236–127239), and refused. The stage's existing guard
unset only `SPUR_WORKFLOW_RUN_ACTIVE` (task 0133 era).

**Fix.** `plugins/kk/scripts/kk-workflow-stages.ts`: shared `NESTED_SPUR_UNSET =
['SPUR_WORKFLOW_RUN_ACTIVE', 'SPUR_EXPECTED_DEFINITION_DIGEST']`, wired into
`dailyPublishSurfdash` (replacing the single-var literal) and `dailyTranslateSync`
(surfdash-pub `sync` leg — same boundary, previously unprotected). Source-assertion
tests updated (`kk-daily-ai-voice-workflow.test.ts`).

**Validation.** Re-ran `daily-publish-surfdash` with `SPUR_EXPECTED_DEFINITION_DIGEST`
deliberately poisoned in the env → published clean (`ok:true`, status `published`).
The fix removes the failure mode at the boundary, not the symptom path.

**Upstream (spur, unfixed here).** Env-based identity binding poisons *any* nested
`spur workflow run` in descendant processes. Scope the binding by run-id, or strip it
before spawning worker children. Recommended as a spur-repo issue; kk's stage-side
unset is a boundary-level mitigation, not a replacement for the product fix.

## F2 (LOW, open) — loudness-dip gating has no gemini-tts parity

QC records many `loudnessDip=true` segments in gemini audio, yet no regen was triggered;
the voicebox driver's dip-gate does not gate the gemini-tts path. Separately, seg14's
`repetitionDetected=true` is a script-level repeated transition phrase
(「接着我们把目光转向另一条重要进展」) confounding the detector — not TTS stutter.
Audio quality is acceptable (QC 100, natural pacing); dip-gating parity and repetition
detector tuning are future work items, not today's scope.

## F3 (LOW, open) — stage scripts run from the global kk package

`kk stage` executes `~/.bun/.../@gobing-ai/knowledge-kit/plugins/kk/scripts/kk-workflow-stages.ts`
(global v0.0.23), not repo src. Today global == HEAD so semantics matched, and executor
*plugins* did run repo src via cwd shadowing — but stage-side fixes (like F1's) are only
exercised by the workflow after publishing kk. For surgical re-drives I invoked the repo
stage script directly (`bun plugins/kk/scripts/kk-workflow-stages.ts …`), which is what
validated the fix. Drift risk for future dogfoods: publish kk before staging, or point
`kk` at the repo checkout.

## F4 (INFO) — workflow trace cap

`spur workflow trace` returns ~20 entries even with `--limit 500`; the morning run's
steps were invisible. Cosmetic/diagnostic only.

## F5 (INFO, self-healing) — podcast shownotes ordering

The podcast episode was published while surfdash was still failed, so show-notes were
built from the legacy-fallback article URL. After the F1 re-drive staged the real
article, the live episode's shownotes were verified to carry the correct URL
(`https://surfing.salty.vip/zh/posts/20260924-ai-2026-09-24`). Under normal operation
(surfdash publishing first) the task-0137 ordering contract holds and this gap doesn't
occur.

## What was exercised (coverage)

- gemini-tts plugin live: voice-profile wiring, long-form synthesis (30 segments,
  ~17.7 min audio), WAV assembly, QC/ASR loop integration — all first-live today.
- Pipeline cache semantics across two runs on one work dir (morning partial → evening
  completion): cached stages fast-forwarded, mid-death script artifact regenerated.
- Publish fan-out, partial/full classification, patch-surfdash git automation,
  run-report, translate scaffold→agent→sync, locale frontmatter normalization.
- Nested-spur boundary under async execution (found + fixed).

## Artifacts

- Ledger: `.spur/run/dogfood/dogfood-daily-gemini-20260924.md`
- Log/plan/sessions: `.spur/run/dogfood-daily-gemini-20260924.log`,
  `.spur/run/dogfood-daily-gemini-20260924-workflow-plan.json`,
  `.spur/run/dogfood-daily-gemini-20260924/agent-sessions/`
- Work dir: `.works/kk-daily-ai-voice/20260924/`
- Fix commit: `2aa2ea82` (kk repo) · surfdash commits `eb9a419`, `b2e6a6b`, `2209f81` (pushed)
