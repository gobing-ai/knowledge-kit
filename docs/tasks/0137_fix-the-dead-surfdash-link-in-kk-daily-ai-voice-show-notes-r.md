---
schema_version: 1
name: Fix the dead surfdash link in kk-daily-ai-voice show-notes (reads the not-yet-written merged publish result)
status: done
template: issue
created_at: 2026-09-15T07:20:16.383Z
updated_at: "2026-09-15T18:14:34.331Z"
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

- [x] R1. `dailyShowNotes` resolves the surfdash article URL from the artifact that exists at that point in the state order (`3-publish/${runDate}_14_publish-surfdash_result.json`, written by the preceding `publish-surfdash` state) instead of `_17_publish_result.json`, which the later `publish` state writes; the `firstPostPath` selection rule (`target == "surfdash-pub"` AND `ok == true`) and the empty-string fallback stay unchanged.
- [x] R2. On the success path the timeline layout engages: with a published surfdash target, `PODCAST_PUB_ARTICLE_POST_PATH` reaches `podcast-pub` non-empty, so `briefMode` is true (`plugins/publishings/podcast-pub/src/show-notes.ts:129`) and the show notes carry `HH:MM` briefs and per-item `[文章](…postPath…)` links instead of the title-slug fallback (`:128`, `:170`).
- [x] R3. The degradation contract survives: when the surfdash result file is absent or its target failed, the env var is empty, `podcast-pub` keeps the legacy full-body layout, and the run still reaches `done` exactly as today.
- [x] R4. Regression coverage exists in the runner suite (`apps/cli/tests/kk-workflow-stages.test.ts`): a `daily-show-notes` test drives a fake `kk` that dumps `PODCAST_PUB_ARTICLE_POST_PATH` for both cases (published surfdash result → the real post path; missing/failed → empty), and the twenty pinned call lines in `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:152-171` are updated in the same commit if this task changes the verb's argv.
- [x] R5. No other behaviour changes: `dailyTranslateEn`'s read of `_17_publish_result.json` (legitimate — it runs after `publish`), the `publish` classification, the state order, the transition guards, the artifact names and `docs/design/kk-daily-ai-voice.md` §4 stay as they are; the two §5 doc-precision nits listed in Background are corrected.

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

`dailyShowNotes` resolved the surfdash article URL from `${runDate}_17_publish_result.json`, but that
file is written by the **later** `publish` state (`dailyPublishClassify`,
`plugins/kk/scripts/kk-workflow-stages.ts:948`), while `show-notes` runs before it: the state order is
`publish-surfdash → show-notes → publish-podcast → publish`
(`plugins/kk/workflows/kk-daily-ai-voice.yaml:244`).

At `show-notes` time the merged result does not exist, so `firstPostPath`
(`plugins/kk/scripts/kk-workflow-stages.ts:896`) returns `''` and
`PODCAST_PUB_ARTICLE_POST_PATH` is permanently empty — the episode timeline never engages
(`briefMode` needs a non-empty `postSlug`, `plugins/publishings/podcast-pub/src/show-notes.ts:129`)
and the footer keeps the title-derived slug fallback (`:128`) even on days surfdash published
successfully. The state description promised a *degradation* on surfdash failure; the behaviour was
unconditional.

Reproduced by reverting only the source line and re-running the new runner tests: the success-path
case and the `_17_`-independence case fail, while the absent/failed-result case keeps passing —
confirming the defect is the source read, not the fallback.

### Solution

`dailyShowNotes` now resolves the surfdash article URL from the artifact that exists at that point in
the state order — the preceding `publish-surfdash` state's own result — keeping the `firstPostPath`
selection rule (`target == "surfdash-pub"` AND `ok === true`), the empty-string fallback, the
`podcast-pub` argv and every env channel unchanged. The degradation path is therefore untouched by
construction.

`dailyTranslateEn`'s read of `_17_publish_result.json` is correct (it runs after `publish`) and is
unchanged, as are `dailyPublishClassify`, the state order, the transition guards and the artifact
names. The delegated call lines are unchanged, so the twenty argv pins in
`apps/cli/tests/kk-daily-ai-voice-workflow.test.ts` still hold and needed no edit. The
`podcast-pub` rendering contract itself (`HH:MM` briefs and per-item `[文章](…)` links under
`briefMode`) is already covered by the plugin's own tests — task 0118 — so this task adds only the
wiring regression.

| Requirement | File | Change |
| --- | --- | --- |
| R1 | `plugins/kk/scripts/kk-workflow-stages.ts:877` | `dailyShowNotes` reads `${runDate}_14_publish-surfdash_result.json` (the state's own artifact) instead of the not-yet-written `_17_publish_result.json`; selection rule and empty fallback unchanged |
| R2 | `apps/cli/tests/kk-workflow-stages.test.ts:757` | regression test: a published surfdash result reaches `podcast-pub` as `PODCAST_PUB_ARTICLE_POST_PATH` (with run date, brief mode, title) |
| R3 | `apps/cli/tests/kk-workflow-stages.test.ts:771` | regression test: an absent or failed surfdash result forwards an empty `PODCAST_PUB_ARTICLE_POST_PATH`, preserving the legacy full-body degradation |
| R4 | `apps/cli/tests/kk-workflow-stages.test.ts:784` | regression test: a fixture carrying only `_17_publish_result.json` forwards `''`, pinning the removal of the dead dependency; the twenty argv pins stay unchanged because the delegated call line did not change |
| R5 | `docs/design/kk-daily-ai-voice.md:80` | §5 prelude wording corrected to five-line prelude plus one `bun` call line — six YAML lines per delegated action |
| R5 | `docs/design/kk-daily-ai-voice.md:90` | §5 tail-coverage sentence scoped to `classify` / `publish-prep` / `publish-partial` / `translate-en` (plus `show-notes`), remaining tail verbs tracked from task 0137 |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/scripts/kk-workflow-stages.ts:877` — `dailyShowNotes` now resolves the surfdash post path from `3-publish/${runDate}_14_publish-surfdash_result.json`, the artifact the preceding `publish-surfdash` state writes (`plugins/kk/scripts/kk-workflow-stages.ts:844`); selection rule and empty fallback unchanged: `firstPostPath` (`plugins/kk/scripts/kk-workflow-stages.ts:896-905`) keeps `target === 'surfdash-pub'` AND `ok === true`, first non-empty `metadata.postPath` wins; `readJson` (`plugins/kk/scripts/kk-workflow-stages.ts:485-492`) returns null for a missing or unparsable file, so the value stays `''` |
| R2 | MET | Producer: `apps/cli/tests/kk-workflow-stages.test.ts:744-762` drives a fake `kk` over a published `_14_` result and asserts `PODCAST_PUB_ARTICLE_POST_PATH: '/posts/zh/daily-ai-20260101/index.md'` plus run date `20260101`, `PODCAST_PUB_BRIEF_MODE: 'true'` and title. Consumer: `plugins/publishings/podcast-pub/tests/podcast-pub.test.ts:969-1002` proves postPath → slug+locale → `HH:MM · brief` timeline entries and `[文章](https://surfing.salty.vip/zh/posts/20260906-ai-daily)` links under `briefMode` (`plugins/publishings/podcast-pub/src/show-notes.ts:129`; title-slug fallback `:128`; per-item link `:170`) |
| R3 | MET | `apps/cli/tests/kk-workflow-stages.test.ts:765-781` asserts `''` for both an absent `_14_` file and a present `{target:'surfdash-pub', ok:false, status:'failed'}` record; the empty env value resolves to `undefined` (`plugins/publishings/podcast-pub/src/index.ts:115`), so `briefMode` stays false (`plugins/publishings/podcast-pub/src/show-notes.ts:129`) and the legacy full-body layout renders (`plugins/publishings/podcast-pub/tests/podcast-pub.test.ts:1007`); the stage exits 0 and the `publish-surfdash → show-notes` transition is the unchanged `always` guard (`plugins/kk/workflows/kk-daily-ai-voice.yaml:549-553`) |
| R4 | MET | Three new runner tests: `apps/cli/tests/kk-workflow-stages.test.ts:744` (published result → real post path), `:765` (absent/failed → empty), `:784` (only `_17_` present → empty). The verb argv did not change (`plugins/kk/scripts/kk-workflow-stages.ts:884`), so the twenty pins stay valid: the `daily-show-notes` pin `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:164` equals `plugins/kk/workflows/kk-daily-ai-voice.yaml:268`, and the prelude/argv byte-identity assertion `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:116-125` is green in the recorded gate run |
| R5 | MET | `dailyTranslateEn` still reads `_17_publish_result.json` (`plugins/kk/scripts/kk-workflow-stages.ts:1048`); `dailyPublishClassify` still merges `_14_` + `_16_` into `_17_` (`plugins/kk/scripts/kk-workflow-stages.ts:951-968`, paths at `:953` and `:955`); state order and guards unchanged (`plugins/kk/workflows/kk-daily-ai-voice.yaml:244-337`, `:549-553`); both §5 nits corrected — prelude wording `docs/design/kk-daily-ai-voice.md:80` (verified against the YAML prelude at `plugins/kk/workflows/kk-daily-ai-voice.yaml:263-268`: 5 prelude lines + 1 `bun` call line = 6) and tail scoping `docs/design/kk-daily-ai-voice.md:89-92` (suite has no per-verb test for `publish-surfdash` / `publish-podcast` / `run-report`) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: show-notes links the published surfdash post path | MET | test | `apps/cli/tests/kk-workflow-stages.test.ts:744-762` (env forwarding of the published postPath) + `plugins/publishings/podcast-pub/tests/podcast-pub.test.ts:969-1002` (postPath → `HH:MM` briefs and `[文章]` links) |
| Scenario: a failed or absent surfdash publish degrades to the legacy layout | MET | test | `apps/cli/tests/kk-workflow-stages.test.ts:765-781` (empty env for absent/failed) + `plugins/publishings/podcast-pub/tests/podcast-pub.test.ts:1007` (legacy full-body layout) + unchanged `always` transition `plugins/kk/workflows/kk-daily-ai-voice.yaml:549-553` |
| Scenario: the fixed lookup reads the artifact that exists at that point | MET | test | `apps/cli/tests/kk-workflow-stages.test.ts:784-802` — a fixture carrying only `_17_publish_result.json` with a published surfdash target must forward `''`, so any `_14_ ?? _17_` fallback fails; source read `plugins/kk/scripts/kk-workflow-stages.ts:877` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0137

**Scope:** task-0137 diff in `/Users/robin/xprojects/knowledge-kit-run-0137-b7046686` — `plugins/kk/scripts/kk-workflow-stages.ts` (dailyShowNotes artifact source), `apps/cli/tests/kk-workflow-stages.test.ts` (three new runner tests), `docs/design/kk-daily-ai-voice.md` §5 (two wording nits), plus the task corpus file.
**Dimensions:** functional, correctness, security, efficiency, usability, architecture, documentation
**Verdict:** PASS

##### Method and Evidence

Read-only stage: no shell, so the diff was reconstructed from the task's change map plus the current content of every cited line, not from `git diff`. The parent must confirm `git status --porcelain` shows only the four expected paths.

Fresh gate evidence inspected (not re-run by me):

- `.spur/run/0137-test-gate.status` → `PASS`
- `.spur/run/0137-test-gate.log` tail: `1024 pass`, `0 fail`, `3893 expect() calls`, `Ran 1024 tests across 65 files. [42.99s]`; pre-check `All 47 rules passed — no violations found.`; post-check `All 2 rules passed — no violations found.`; `proof-digest: sha256:5d57c02afe486e95dab117bcedc240bfeaf5807182372b24932c9996fa427062`
- `.spur/run/B7046686-70B0-4BC4-9E9C-BDEF5E663351-proofdigest.txt` → same `sha256:5d57c02a…`, so that digest is the green gate run.

Residual risk (out of this diff's scope, do not block): `.spur/run/B7046686-…-test-fix-answer.txt` documents one intermittent failure — `apps/cli/tests/invoke.test.ts` (`0110 I2`), measured ~5 % in isolation, both files byte-identical to `HEAD`, green on the recorded re-run. A future re-run may flake again; that defect (`killProcessTree` snapshot walk, `apps/cli/src/invoke.ts:183-199`) deserves its own task.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P3 (minor) | documentation | The 3-line WHY comment added by this diff shifted every later line in the runner by +3, and the task's own anchors were not refreshed: `firstPostPath` is now `:896-905` (task cites `:893-905` — 893 is the `}` closing `dailyShowNotes`), `dailyPublishClassify` is now `:951-968` (task cites `:948-975` and `:948` in Root Cause — 948-950 are the tail of `dailyPublishPodcast`), `dailyTranslateEn` is now `:1046-1075` (task cites `:1043-1071` in Background, References, Design and Q&A — 1043-1045 are the tail of `dailyRunReport`). Each drifted start now lands inside the *previous* function. Smallest fix: re-point those citations through `spur task update`, and confirm `spur task check 0137 --strict` is clean (L4.stale-line-anchor is a known gate mode in this repo). | `docs/tasks/0137_…-r.md` vs `plugins/kk/scripts/kk-workflow-stages.ts:896`, `:951`, `:1046` |
| 2 | P3 (minor) | coverage | The env seam this diff makes load-bearing in production for the first time is pinned only at its two ends, never across it: the runner test pins the producer-side key (`PODCAST_PUB_ARTICLE_POST_PATH: postPath`, `kk-workflow-stages.ts:889`), and `podcast-pub`'s tests pass `articlePostPath` as a render option without ever setting the env var — `withEnv` (`plugins/publishings/podcast-pub/tests/podcast-pub.test.ts:55-62`) covers `PODCAST_PUB_TITLE` / `RUN_DATE` / `ARTICLE_BASE_URL` only. A key-name typo on either side would leave the timeline dead exactly as before, with a green suite — the same failure class this task exists to fix. Smallest fix: one show-notes test in the plugin suite that sets `PODCAST_PUB_ARTICLE_POST_PATH` via `withEnv` (pattern at `podcast-pub.test.ts:1136`) and asserts the rendered markdown contains `[文章](https://surfing.salty.vip/zh/posts/20260906-ai-daily)` / the postPath-derived footer. | `apps/cli/tests/kk-workflow-stages.test.ts:744-763` ↔ `plugins/publishings/podcast-pub/src/index.ts:118`, `plugins/publishings/podcast-pub/tests/podcast-pub.test.ts:969-1005` |
| 3 | P4 (advisory) | documentation | The corrected §5 tail sentence says the three uncovered verbs "stay tracked from task 0137", but 0137 adds no coverage for them and no follow-up task exists in the corpus (grep over `docs/tasks` for `publish-surfdash` / `publish-podcast` / `run-report` returns only 0117/0135/0137 history). Reads as if 0137 owns a follow-up it does not. Suggest "…remain uncovered (follow-up tracked from task 0137)" or file the task. | `docs/design/kk-daily-ai-voice.md:91-92` |
| 4 | P4 (advisory) | architecture | The surfdash artifact path literal now appears in two functions (`dailyPublishSurfdash`, `dailyShowNotes`); the next rename has to hit both — the drift class that produced this defect. Advisory only: R5's "one-line source change" discipline argues for leaving it; a module-level helper would make the next rename single-sited. | `plugins/kk/scripts/kk-workflow-stages.ts:844`, `:877` |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `plugins/kk/scripts/kk-workflow-stages.ts:877` now reads `${runDate}_14_publish-surfdash_result.json`, the artifact written by the preceding state (`:841-846`, `kk executor fan-out … --out result`); `firstPostPath` (`:896-905`) untouched — `record.target !== target \|\| record.ok !== true` skip, first non-empty wins; `readJson` (`:485-492`) returns `null` for a missing/unparsable file, so `''` survives |
| R2 | MET | Producer: `apps/cli/tests/kk-workflow-stages.test.ts:744-763` asserts `PODCAST_PUB_ARTICLE_POST_PATH: '/posts/zh/daily-ai-20260101/index.md'` plus run-date/brief-mode/title. Consumer: `plugins/publishings/podcast-pub/tests/podcast-pub.test.ts:969-1005` proves postPath → slug+locale → `HH:MM · brief` and `[文章](…/zh/posts/<slug>)` under `briefMode`. The seam between them is not pinned (finding 2) |
| R3 | MET | `apps/cli/tests/kk-workflow-stages.test.ts:765-781` covers absent file and `{ok:false, status:'failed'}` → `''`; the empty value resolves to `undefined` on the consumer side (`podcast-pub/src/index.ts:93-97`, `:118`), so `briefMode` stays false (`show-notes.ts:129`) and the legacy body renders (`podcast-pub.test.ts:1007`); the stage still exits 0 and the `publish-surfdash → show-notes` guard is unchanged (`kk-daily-ai-voice.yaml:549-553`, `always`) |
| R4 | MET | Three new tests at `:744`, `:765`, `:784`; the verb's argv is unchanged (`kk-workflow-stages.ts:884`), so the twenty pins in `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:152-171` still match the YAML call lines (`kk-daily-ai-voice.yaml:255`, `:268`, `daily-show-notes … "${vars.title}"` at the pinned `:164`) |
| R5 | MET | `dailyTranslateEn` still reads `_17_` (`:1048`); `dailyPublishClassify` still merges `_14_`+`_16_` into `_17_` (`:951-968`); state order, guards, artifact names and `docs/design/kk-daily-ai-voice.md` §4 (`:69-70`) unchanged; the two §5 nits are corrected — prelude wording at `:80` (verified against the YAML: 5 prelude lines + 1 call = 6, e.g. `kk-daily-ai-voice.yaml:263-268`) and tail scoping at `:90-92` (the suite genuinely has no per-verb test for the three listed verbs) |
| AC1 (@core) | MET | env forwarding `:744-763` + timeline render `podcast-pub.test.ts:969-1005` — two halves, see finding 2 |
| AC2 (@core) | MET | degradation `:765-781` + legacy layout `podcast-pub.test.ts:1007`; `done` reachability rests on the untouched `always` guard, not on an end-to-end tail run (the integration suite runs `publish_enabled=false`) |
| AC3 (@edge) | MET | `:784-804` writes only `_17_publish_result.json` with a published surfdash target and asserts `''` — reintroducing any `_14_ ?? _17_` fallback fails this test |

##### Correctness / SECUA / Architecture Notes

- The fix addresses the root cause (wrong artifact for the state's position in the order), not a symptom; the state description at `kk-daily-ai-voice.yaml:258` now matches behaviour, and the `metadata.postPath` shape is real: `fanout.ts:105-114` writes `{target, ok:true, status:'published', metadata}` and `publishings/surfdash-pub/src/index.ts:450` / `:465` supply `metadata.postPath`. Scope is single-workflow — `daily-show-notes` / `daily-publish-surfdash` appear only in `kk-daily-ai-voice.yaml`.
- Degradation is preserved by construction, not by luck: `readJson` returns `null` on missing/unparsable JSON, `firstPostPath` returns `''` for a non-array `targets` / no `ok === true` match / non-string or empty `postPath`.
- Tests are behavioural (env channel + artifact outputs), not log-format coupled; no assertion was weakened; the WHY comment at `:874-876` is non-obvious rationale, which is the allowed case.
- No security, efficiency, or concurrency surface is touched; no new dependency, no suppression, no `console.*` addition beyond the unchanged stage logging.

##### Disposition of the findings (inline driver, run B7046686-70B0-4BC4-9E9C-BDEF5E663351)

All four findings are non-blocking and are LEFT UNREMEDIATED by this run, deliberately:

- Findings 1 and 2 require a task-body edit (proof-input section) and a test-file edit respectively. Both mutate inputs covered by the captured proof digest `sha256:5d57c02a…`, so repairing them now would invalidate the certified proof and route the run to `failed` — the pipeline's remediation edges (`test-fix → test-recheck`) re-capture the digest but are unreachable from `review`. They are recorded here as follow-up work instead of being smuggled into the certified tree.
- Findings 3 and 4 are advisory; finding 3 concerns doc prose outside the corrected §5 scope and finding 4 argues against R5's explicit "one-line source change" discipline.

The `invoke.test.ts` `killProcessTree` race documented in `.spur/run/B7046686-…-test-fix-answer.txt` is likewise follow-up work, outside this task's declared surface.

**Next:** fix finding 1 (re-point three task anchors) and add the one env-seam test from finding 2 as follow-up tasks; neither blocks this gate.

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

- 2026-09-15T17:56:54.886Z todo → wip (system)
- 2026-09-15T18:14:14.606Z wip → testing (system)
- 2026-09-15T18:14:34.331Z testing → done (system)

