---
schema_version: 1
name: Fix the dead surfdash link in kk-daily-ai-voice show-notes (reads the not-yet-written merged publish result)
status: todo
template: issue
created_at: 2026-09-15T07:20:16.383Z
updated_at: "2026-09-15T17:25:13.253Z"
feature_id: F8

ac_altitude: task-local
priority: P2
---

## 0137. Fix the dead surfdash link in kk-daily-ai-voice show-notes (reads the not-yet-written merged publish result)

### Background

Pre-existing defect found by the 0133 verification pass. It is **not** introduced by the ADR-115
port: the pre-port body (`git show 8a5ead69:plugins/kk/workflows/kk-daily-ai-voice.yaml`, `show-notes`
state) resolves the same path with the same jq selector and the same empty fallback, and the ported
`dailyShowNotes` reproduces it faithfully — that is why 0133 left it alone.

**The defect.** `dailyShowNotes` (`plugins/kk/scripts/kk-workflow-stages.ts:871-891`) builds the
surfdash post path from

```ts
const result = join(workDir, '3-publish', `${runDate}_17_publish_result.json`);
const postPath = firstPostPath(readJson(result), 'surfdash-pub');   // → '' when the file is absent
```

but `${runDate}_17_publish_result.json` is written by the **later** `publish` state
(`dailyPublishClassify`, `:948-975`, which merges `_14_` + `_16_`). The state order is
`publish-surfdash → show-notes → publish-podcast → publish → run-report → translate-en → …`
(`plugins/kk/workflows/kk-daily-ai-voice.yaml:244-337`), so at `show-notes` time that file does not
exist and `PODCAST_PUB_ARTICLE_POST_PATH` is **always empty** — including on days when surfdash
published successfully. The state description promises "article URL from the surfdash result postPath
— surfdash failure degrades to legacy full-body layout", so the feature is silently dead, not
degraded.

**What the operator actually sees.** `plugins/publishings/podcast-pub/src/show-notes.ts:129` gates the
timeline layout on `briefMode = opts.briefMode === true && postSlug.length > 0`, and `:128` falls back
to `${baseUrl}/zh/posts/${opts.runDate}-${slugify(opts.title)}` for the footer link (`:170` renders the
per-item `[文章](${articleUrl})` links). With an empty postPath the show notes lose the timeline
(`HH:MM` briefs and per-item article links) and the footer carries a title-derived slug guess rather
than the authoritative published post path.

**What is available at that point.** The preceding state writes
`3-publish/${runDate}_14_publish-surfdash_result.json` (`dailyPublishSurfdash`, runner `:841-869`) with
the same `.targets[] | select(.target == "surfdash-pub" and .ok == true) | .metadata.postPath` shape,
so the fix is a one-line source change plus tests. `firstPostPath` (`:893-905`) is already shared with
`dailyTranslateEn` (`:1043-1071`), whose read of `_17_` **is** legitimate (translate-en runs after
`publish`) and must not change.

**Repro.** Drive `daily-show-notes` with a fake `kk` that dumps `PODCAST_PUB_ARTICLE_POST_PATH`:
- fixture with `3-publish/<date>_14_publish-surfdash_result.json` carrying
  `{target:"surfdash-pub", ok:true, status:"published", metadata:{postPath:"/posts/zh/<slug>/index.md"}}`
  → today the env var is empty (defect), after the fix it must be that path;
- fixture without the file (surfdash failed / never ran) → the env var must stay empty and the legacy
  full-body layout must remain, i.e. the degradation contract survives.

`bun test apps/cli/tests/kk-daily-ai-voice-workflow.test.ts` pins all twenty delegated call lines
(`:152-171`) — the `daily-show-notes … "${vars.title}"` argv among them (`:164`) — so any argv change
in this task must update that pin in the same commit.

**Evidence caveat.** `.spur/runs/kk-daily-ai-voice/2026-09-12/3-publish/` is *not* a success-case
repro: its `result-surfdash.json` reads `{ok:false, status:"failed", postPath:null}`, so that day's
empty postPath was correct and its `show-notes.md` (footer
`…/zh/posts/20260912-ai-2026-09-12`, no `HH:MM` briefs) merely documents the degraded output shape.
A real repro needs a run whose surfdash target published, or the synthetic fixture above.

**Also rolled into this task (from the 0133 review, doc-only).** `docs/design/kk-daily-ai-voice.md` §5
carries two precision fixes: the tail-coverage sentence (it should scope the integration test's
coverage to `classify` / `publish-prep` / `publish-partial` / `translate-en` and point the remaining
verbs at this task) and the prelude line-count wording ("five-line prelude plus one `bun` call line —
six YAML lines per delegated action").

### Requirements

- [ ] R1. `dailyShowNotes` resolves the surfdash article URL from the artifact that exists at that point in the state order (`3-publish/${runDate}_14_publish-surfdash_result.json`, written by the preceding `publish-surfdash` state) instead of `_17_publish_result.json`, which the later `publish` state writes; the `firstPostPath` selection rule (`target == "surfdash-pub"` AND `ok == true`) and the empty-string fallback stay unchanged.
- [ ] R2. On the success path the timeline layout engages: with a published surfdash target, `PODCAST_PUB_ARTICLE_POST_PATH` reaches `podcast-pub` non-empty, so `briefMode` is true (`plugins/publishings/podcast-pub/src/show-notes.ts:129`) and the show notes carry `HH:MM` briefs and per-item `[文章](…postPath…)` links instead of the title-slug fallback (`:128`, `:170`).
- [ ] R3. The degradation contract survives: when the surfdash result file is absent or its target failed, the env var is empty, `podcast-pub` keeps the legacy full-body layout, and the run still reaches `done` exactly as today.
- [ ] R4. Regression coverage exists in the runner suite: a `daily-show-notes` test drives a fake `kk` that dumps `PODCAST_PUB_ARTICLE_POST_PATH` for both cases (published surfdash result → the real post path; missing/failed → empty), and the twenty pinned call lines in `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:152-171` are updated in the same commit if this task changes the verb's argv.
- [ ] R5. No other behaviour changes: `dailyTranslateEn`'s read of `_17_publish_result.json` (legitimate — it runs after `publish`), the `publish` classification, the state order, the transition guards, the artifact names and `docs/design/kk-daily-ai-voice.md` §4 stay as they are; the two §5 doc-precision nits listed in Background are corrected.

### Acceptance Criteria

```gherkin
@core
Scenario: show-notes links the published surfdash post path
  Given a run whose publish-surfdash state succeeded and wrote its result with a postPath
  When the show-notes state renders the episode show notes
  Then podcast-pub receives that postPath in PODCAST_PUB_ARTICLE_POST_PATH
  And the rendered notes carry the timeline briefs and per-item article links for that post

@core
Scenario: a failed or absent surfdash publish degrades to the legacy layout
  Given a run whose surfdash target failed or whose result file is missing
  When the show-notes state renders the episode show notes
  Then podcast-pub receives an empty article post path
  And the notes keep the legacy full-body layout and the workflow still reaches done

@edge
Scenario: the fixed lookup reads the artifact that exists at that point
  Given the state order publish-surfdash -> show-notes -> publish-podcast -> publish
  When show-notes resolves the article URL
  Then it reads the _14_publish-surfdash_result.json written by the preceding state
  And it never depends on _17_publish_result.json, which publish writes later
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-15T17:25:13.253Z

- 2026-09-15 ready-depth refine (`--depth ready --auto`, inline): premise-verified every load-bearing
  claim against the current tree — defect mechanism, state order, plugin gates, pre-port proof,
  degradation contract, and both `docs/design/kk-daily-ai-voice.md` §5 nits all confirmed still live;
  re-pointed four drifted citations to ground truth (`dailyPublishSurfdash` `:841-869`, state order
  `kk-daily-ai-voice.yaml:244-337`, the twenty-line call pin `kk-daily-ai-voice-workflow.test.ts:152-171`
  with `daily-show-notes` at `:164`, `dailyTranslateEn` `:1043-1071`). No design change.

### Design

**Fix.** In `dailyShowNotes` (`plugins/kk/scripts/kk-workflow-stages.ts:871-891`) change the result
source to the surfdash state's own artifact:

```ts
const result = join(workDir, '3-publish', `${runDate}_14_publish-surfdash_result.json`);
const postPath = firstPostPath(readJson(result), 'surfdash-pub');   // unchanged helper, unchanged rule
```

`firstPostPath` already implements the required selection (`target == "surfdash-pub"`, `ok === true`,
`metadata.postPath`, first non-empty wins) and returns `''` when the file is missing or unparsable, so
the degradation path is untouched by construction.

**Why not the alternatives.**

- *Move `show-notes` after `publish`*: changes the state graph and the fan-out order (`publish-podcast`
  must re-read the prep content that the classification step does not produce), i.e. a much larger blast
  radius than the defect warrants, and it would invert the documented "show notes are attached before
  the podcast publish" ordering.
- *Have `publish` write the article URL back into the prep content / a sidecar*: adds an artifact plus a
  second writer for a value the surfdash result already carries.
- *Fix `podcast-pub` to re-resolve the slug itself*: pushes workflow artifact discovery into a publish
  plugin that only receives `--content`/`--out`, breaking the plugin contract (ADR-009) for a
  workflow-side wiring bug.
- *Fall back to `_17_` when `_14_` is absent*: keeps the dead dependency and hides regressions; the
  surfdash result is the authority for "did surfdash publish, and where".

**Boundaries (do not touch).**

- `dailyTranslateEn` (`:1043-1071`) keeps reading `_17_publish_result.json`: `translate-en` runs after
  `publish` in the state order, so that read is correct.
- `dailyPublishClassify` keeps merging `_14_` + `_16_` into `_17_`; `publish-partial` keeps reading it.
- No transition, state id, artifact name, env-var name or `docs/design/kk-daily-ai-voice.md` §4 entry
  changes. If the verb's argv changes at all, update the twenty-line pin in
  `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:152-171` in the same commit.
- Keep the delegated action inside the ADR-115 composition budget (10 logical commands / 800 chars)
  and the prelude byte-identical across the kk workflows: the daily suite asserts that block 20× and
  the prompt caps, so a drift fails the suite rather than validate.

### Plan

1. Point `dailyShowNotes` at `${runDate}_14_publish-surfdash_result.json`; keep `firstPostPath` and the
   empty fallback.
2. Add the runner-suite regression test: fake `kk` dumps `PODCAST_PUB_ARTICLE_POST_PATH` for (a) a
   published surfdash result and (b) a missing/failed one, asserting the path and the empty string.
3. Re-check the twenty pinned call lines (`kk-daily-ai-voice-workflow.test.ts:152-171`) and update them
   only if the argv changed; keep the prelude identity assertion green.
4. Correct the two `docs/design/kk-daily-ai-voice.md` §5 wording nits listed in Background.
5. Verify: the daily workflow suite + the runner suite green, the fake-`kk` integration test still
   reaching `done`, and the repo quality gate (`bun run spur-check`) passing with
   `spur workflow validate plugins/kk/workflows/kk-daily-ai-voice.yaml --json` at exit 0.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Runner seams: `plugins/kk/scripts/kk-workflow-stages.ts:871-891` (`dailyShowNotes` + today's `_17_`
  read), `:893-905` (`firstPostPath`), `:841-869` (`dailyPublishSurfdash`, writes `_14_`), `:948-975`
  (`dailyPublishClassify`, writes `_17_`), `:1043-1071` (`dailyTranslateEn`, legitimate `_17_` read).
- Workflow: `plugins/kk/workflows/kk-daily-ai-voice.yaml` — `show-notes` state (description promises the
  surfdash postPath), the `publish-surfdash → show-notes → publish-podcast → publish → run-report →
  translate-en` order (`:244-337`).
- Plugin: `plugins/publishings/podcast-pub/src/show-notes.ts:128` (title-slug fallback URL), `:129`
  (`briefMode` gate on a non-empty `postSlug`), `:170` (per-item `[文章](…)` link);
  `plugins/publishings/podcast-pub/src/index.ts:115` (`PODCAST_PUB_ARTICLE_POST_PATH` → `articlePostPath`).
- Pre-port body (proof the defect is not a 0133 regression):
  `git show 8a5ead69:plugins/kk/workflows/kk-daily-ai-voice.yaml` → the `show-notes` `onEnter` body
  contains `RESULT="${vars.work_dir}/3-publish/${vars.run_date}_17_publish_result.json";` followed by
  `POST_PATH="$(jq -r '[(.targets // [])[] | select(.target == "surfdash-pub" and .ok == true) |
  .metadata.postPath // empty] | first // ""' "$RESULT" 2>/dev/null || true)"`.
- Degraded-output sample (NOT a success-case repro — that day's surfdash target failed,
  `result-surfdash.json` = `{ok:false, status:"failed", postPath:null}`):
  `.spur/runs/kk-daily-ai-voice/2026-09-12/3-publish/show-notes.md`, footer
  `详情见本期完整文章：[ 每日 AI 资讯 — 2026-09-12 ](https://surfing.salty.vip/zh/posts/20260912-ai-2026-09-12)`
  (title-derived fallback), no `HH:MM` briefs.
- Task lineage: 0133 (the port that surfaced it) — Requirements R4 there forbade behaviour changes
  inside the port, which is why this is a separate task.

### History
