---
schema_version: 1
name: "Move show-notes rendering and episode assembly into podcast-pub"
status: done
template: feature-impl
created_at: 2026-09-06T14:35:05.214Z
updated_at: "2026-09-07T21:29:15.596Z"
feature_id: L1
priority: P1
tags: ["publish", "podcast-pub", "feature-K"]
---

## 0095. Move show-notes rendering and episode assembly into podcast-pub

### Background

kk-daily-ai-voice inlines show-notes rendering (bun -e with surfing.salty.vip URL construction) and publish-prep episode assembly (audio+cover merge) — but podcast-pub/src/show-notes.ts already exists. Feature L1 D4/R6: the plugin owns its mechanics. ADR-007: kk owns steps, workflow owns orchestration.

### Requirements

R1. podcast-pub gains `operation: 'show-notes'`: renders uniform show notes from plan Doc[] (title, source label, links) — absorbs the workflow's inline bun -e logic including the surfing.salty.vip article-URL construction.
R2. podcast-pub publish performs full episode assembly internally: accepts article Content + audio metadata + cover path via options, builds attachment/duration/show-notes itself — absorbs publish-prep's merge for the podcast seam.
R3. Operation routing follows the existing options.operation pattern (resolveOperation); unknown operations fail loud.
R4. Unit tests cover both operations with fake transport (publish-harness).
R5. No workflow-YAML changes in this task — the workflow switch lands in the YAML task.

### Acceptance Criteria

```gherkin
Feature: Move show-notes rendering and episode assembly into podcast-pub

  Scenario: podcast-pub owns show-notes rendering and episode assembly
    Given the r6 real plan fixture and the captured workflow-renderer goldens
    When podcast-pub runs operation show-notes on plan Doc[]
    Then the rendered markdown byte-matches the workflow inline renderer
    And publish with assembly options yields a Result with enclosure + image + duration
    And an unknown operation still fails loud with no network
    And the existing podcast-pub tests stay green
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

WHAT: podcast-pub absorbs the two workflow-inline mechanics that are podcast-specific: (1) show-notes GENERATION from plan Doc[] (currently an inline bun -e in the workflow's show-notes state), (2) episode assembly merge (currently publish-prep's inline bun -e). Both become plugin code; the workflow keeps only orchestration calls.

WHY: ADR-019 D4 — target-specific mechanics belong to the target's plugin (ADR-007: kk owns steps, workflow owns orchestration). NOTE (premise corrected at refine): podcast-pub/src/show-notes.ts is the markdown→HTML sanitizer (`renderShowNotesHtml`, design D6.1) — it is NOT the generator. The generator (plan Doc[] → show-notes markdown: `# title` + `## N. <title>` + sourceLabel + links + article URL) lives ONLY in the workflow inline script today. This task writes that generator as plugin code and reuses the existing sanitizer downstream unchanged.

WHERE (frozen):

- `plugins/publishings/podcast-pub/src/show-notes.ts` — add exported `renderShowNotesMarkdown(docs: Doc[], opts: { title: string; runDate: string; articleBaseUrl?: string }): string`. Port the workflow's logic verbatim: slugify(articleTitle) for the article URL (`<articleBaseUrl>/zh/posts/<runDate>-<slug>`, default base `https://surfing.salty.vip`), sourceLabel (metadata.sourceName → hostname strip <www>. → 来源 fallback), per-item `## N.` sections with link list. Keep `renderShowNotesHtml` untouched.
- `plugins/publishings/podcast-pub/src/index.ts` — extend OPERATIONS with `'show-notes'`: input = plan Doc[] JSON (`--in`), output = markdown file (`--out`); options {title, runDate, articleBaseUrl?}. No microfeed API call in this operation (pure render).
- publish operation: accept additive options {audioFile, coverPath, durationSec} — when present, the plugin assembles the episode itself (absorbing publish-prep's article+audio merge for the podcast seam); absent → today's behavior unchanged.
- `resolveOperation` (index.ts:50) routes both; unknown operations keep failing loud.

Precedence: publish options are additive/optional — the existing Content→episode mapping (map.ts) is the fallback when assembly options are absent.

Anti-patterns: no microfeed calls in show-notes render; no HTML in the markdown generator (sanitizer owns that); no breaking change to existing publish contract; no new config keys.

Handoff: 0097 replaces the workflow's show-notes bun -e with `kk executor run podcast-pub` (operation show-notes) and slims publish-prep. Docs: 04_DESIGN.md podcast-pub operations section.

### Plan

1. Read workflow inline show-notes bun -e (kk-daily-ai-voice.yaml:202-208) + publish-prep (209-215) + existing renderShowNotesHtml + map.ts.
2. Implement renderShowNotesMarkdown in show-notes.ts (verbatim port of the inline logic).
3. Extend OPERATIONS + resolveOperation + PodcastPubOptions for 'show-notes' (pure render, --in plan docs, --out markdown).
4. Extend publish with additive assembly options {audioFile, coverPath, durationSec}.
5. Tests (fake transport via publish-harness): renderShowNotesMarkdown on r6 plan fixture byte-matches the workflow renderer's output (capture current output as golden first); show-notes operation writes file, makes no HTTP calls; publish with/without assembly options; unknown operation fails loud.
6. Sync docs/04_DESIGN.md podcast-pub operations.
7. Verify: bun run lint && bun run test clean. Workflow switch is 0097's job — do not touch YAML here.

### Solution

#### Change map

- `plugins/publishings/podcast-pub/src/show-notes.ts:11` — added `import type { Doc } from '@gobing-ai/kk-core'`. `plugins/publishings/podcast-pub/src/show-notes.ts:64-100` — added `ShowNotesRenderOptions` + `renderShowNotesMarkdown(docs, opts)`: verbatim port of the workflow's inline show-notes bun -e (`plugins/kk/workflows/kk-daily-ai-voice.yaml:208`) — `slugify` (lowercase → strip `[^\w\s-]` → collapse `[\s_]+` → `post` fallback), article URL `<articleBaseUrl|https://surfing.salty.vip>/zh/posts/<runDate>-<slug>`, `sourceLabel` (`metadata.sourceName` trim → hostname strip `www.` → `来源`), `# title` heading, per-item `## N.` sections capped at the first two 。！？ sentences, `[来源：…](sourceUri)` links, `详情见本期完整文章：[ title ](url)` footer. `renderShowNotesHtml` untouched (generator stays markdown-only; sanitizer owns HTML).
- `plugins/publishings/podcast-pub/src/index.ts:13-15` — imports `DocListSchema` + `renderShowNotesMarkdown`. `plugins/publishings/podcast-pub/src/index.ts:23` — `OPERATIONS` gains `'show-notes'`, so `resolveOperation` (`plugins/publishings/podcast-pub/src/index.ts:65-71`) routes both and unknown operations keep failing loud. `plugins/publishings/podcast-pub/src/index.ts:30-45` — `PodcastPubOptions` gains `docs`, `title`, `runDate`, `articleBaseUrl` (show-notes) and `audioFile`, `coverPath`, `durationSec` (assembly), all `unknown` until resolved.
- `plugins/publishings/podcast-pub/src/index.ts:89-151` — show-notes helpers: `resolveOptionString` (payload option → `PODCAST_PUB_TITLE` / `PODCAST_PUB_RUN_DATE` / `PODCAST_PUB_ARTICLE_BASE_URL` env fallback, raw values for byte stability — the dailynews-gen env-option convention, since `kk executor run` passes only `--in`/`--out`), `resolveShowNotesRenderOptions` (fail loud when title/runDate missing), `renderShowNotesFromOptions` (`DocListSchema` validation + pure render).
- `plugins/publishings/podcast-pub/src/index.ts:153-186` — `AssemblyOptions` + `resolveAssemblyOptions`: additive per-key validation (nonempty path strings, finite ≥0 `durationSec`), fail loud before any network.
- `plugins/publishings/podcast-pub/src/index.ts:210-241` — `publishEpisode` takes `options`: when assembly keys are present the plugin owns that channel — `audioFile`→`metadata.audioFile` (retiring `metadata.audioUrl` so map.ts's ambiguity guard is not tripped), `coverPath`→`metadata.coverImage`, `durationSec`→`metadata.durationSeconds`; absent keys leave `mapContentToEpisode` (map.ts) untouched — publish-prep's merge absorbed (R2), today's contract unchanged (design precedence note).
- `plugins/publishings/podcast-pub/src/index.ts:293-304` — transport `publish` handles `'show-notes'` before `resolveClient` (no credentials, no microfeed call) and returns the markdown in `Result.metadata.markdown`. Exhaustive-switch case unnecessary: the early branch narrows the union.
- `plugins/publishings/podcast-pub/src/index.ts:399-413, 421-431` — `renderShowNotesIO` + `processPublishIO` array branch: a bare JSON array `--in` selects show-notes, writes the markdown file to `--out`; failure writes a fail-loud Result and rejects, matching the Content path.
- `plugins/publishings/podcast-pub/tests/podcast-pub.test.ts` — `withEnv` extended with the `PODCAST_PUB_*` keys; new suites: show-notes rendering (golden byte-diffs + base-URL/slug fallback), show-notes operation (transport-level Result without creds/HTTP; fail-loud docs/title/runDate; `processPublishIO` Doc[]→markdown via env, offline, and its failure path), assembly options (enclosure+image+duration Result; precedence over metadata; malformed options fail loud pre-network).
- `plugins/publishings/podcast-pub/tests/fixtures/` — `show-notes-plan.json` + `show-notes-article.json` (edge-covering plan: title/条目 fallback, sourceName trim/hostname-www-strip/来源 fallback, 。！？ sentence cap, empty body) with `show-notes-golden.txt` (969 B) and `show-notes-r6-golden.txt` (14 102 B, real r6-blended plan) captured by executing the workflow's bun -e line verbatim BEFORE implementation (`.txt` so markdown lint cannot rewrite the byte-exact capture).
- `docs/04_DESIGN.md:421-435` — podcast-pub export table: `renderShowNotesMarkdown` row, `show-notes` operation + assembly options on `PodcastPubTransport`/`processPublishIO`.

#### Rationale

ADR-019 D4 / ADR-007: target-specific mechanics belong to the target plugin; the workflow keeps orchestration only (switch lands in 0097 — no YAML touched here). The byte-exact goldens pin the port against the live workflow behavior rather than a paraphrase; env-carried options keep the 0097 call site a pure `--in`/`--out` swap.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | operation 'show-notes' in OPERATIONS (plugins/publishings/podcast-pub/src/index.ts#585B :16); resolveOperation :61-67; renderShowNotesMarkdown (show-notes.ts#AAEB :95-132; title heading :114, slug :104, footer :130, sentence cap :117-120); transport branch :326-333 renders purely before resolveClient; bare-array CLI form :464-466; absorbs the workflow inline bun -e logic incl. surfing.salty.vip article-URL construction |
| R2 | MET | Full episode assembly inside publish: AssemblyOptions :124-128, resolveAssemblyOptions :131-158, publishEpisode additive merge :209-225 (audioFile retires audioUrl; attachment/duration/show-notes built internally) — absorbs publish-prep merge for the podcast seam |
| R3 | MET | Routing via existing options.operation pattern (resolveOperation :61-67); unknown op fails loud — test podcast-pub.test.ts#36BD :751-779 (no network) |
| R4 | MET | Both operations covered with fake transport (publish-harness): show-notes goldens :943-953, publish :1137-1173 (enclosure+image+duration), precedence :1175+; 41/0 fresh |
| R5 | MET | No workflow-YAML changes in this task — the switch landed in the 0097 YAML task |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R6 — podcast-pub owns show-notes rendering and episode assembly | MET | command | bun test plugins/publishings/podcast-pub → 41 pass / 0 fail (this session); live: 3-publish/result.json 2/2 ok/published, episode 06wiZN5N3WN playable (0098 r2) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Scope:** 0095 diff only — `plugins/publishings/podcast-pub/src/{show-notes,index}.ts`, `tests/` + `tests/fixtures/`, `docs/tasks/0095_*.md`, `docs/04_DESIGN.md` podcast-pub section. Excluded per batch split: apps/cli fan-in (0092), episode-plan-gen (0093/0094), 0096–0098, docs/00_ADR.md, docs/design/episode-plan-gen.md, other dirty files.
**Dimensions:** functional (R1–R5), SECUA (S/E/C/U/A), architecture.
**Verdict: PASS** — disposition **approve**. No blocker/major findings; P3/P4 recorded below (non-blocking), two cheap fix items routed to the verify stage.

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P3 | correctness | `plugins/publishings/podcast-pub/src/index.ts:87-91` | Env-fallback precedence (payload option beats `PODCAST_PUB_*` env) is implemented but unpinned: tests cover env-only (`processPublishIO` path) and option-only (transport path) but never both-set-with-different-values. Contract lives only in a doc comment. → verify-stage fix item 1. |
| P3 | architecture | `plugins/publishings/podcast-pub/src/show-notes.ts:95-131` | Documented deviation from pure verbatim port: the workflow uses two title variables — heading `process.argv[5] \|\| articleTitle` but footer text AND article-URL slug always `articleTitle` (`kk-daily-ai-voice.yaml:208`); the plugin merges into one `opts.title` for all three. Behavior-identical today (`vars.title: ""` at `kk-daily-ai-voice.yaml:20`, so effective title == article title) and byte-identical on both goldens, but a 0097 call site passing a custom `vars.title` raw would shift footer+slug vs today's workflow output. → verify-stage fix item 2 (0097 contract note: pass `vars.title \|\| article.title` as `PODCAST_PUB_TITLE`). |
| P4 | usability | `plugins/publishings/podcast-pub/src/index.ts:87-91` | `resolveOptionString` silently ignores non-string option values (e.g. numeric `title`) and falls through to env, then reports "required" instead of "invalid type" — the failure is loud but the message misnames the cause. |
| P4 | correctness | `plugins/publishings/podcast-pub/src/index.ts:326-345` | Assembly-option validation (`resolveAssemblyOptions`, :131-156) runs inside `publishEpisode`, i.e. after `resolveClient` — with missing credentials a malformed `audioFile`/`durationSec` surfaces the credential error first. Still fail-loud and pre-network; diagnostic-ordering nit only. |
| P4 | correctness | `plugins/publishings/podcast-pub/src/index.ts:16` | Comment drift: `OPERATIONS` doc still says "Management operations routed via `options.operation` (design D5)" but now includes the non-management `show-notes` render op. |
| P4 | security | `plugins/publishings/podcast-pub/src/show-notes.ts:105-127` | Markdown link labels/URIs (`sourceUri`, `sourceName`) interpolate into the output unescaped — inherited verbatim from the workflow (fidelity requirement). Not exploitable downstream: `renderShowNotesHtml` escapes all text before the `https?://`-only link regex (`show-notes.ts:20-30`), so no XSS path; a malformed `sourceUri` can at worst garble one markdown link. Accept as-is; do not "fix" (would break the byte-golden). |
| P4 | architecture | `plugins/publishings/podcast-pub/src/index.ts:452-460` | Advisory: the env-var channel (`PODCAST_PUB_TITLE/RUN_DATE/ARTICLE_BASE_URL`) is a hidden parameter surface — the CLI op's real signature is (Doc[], env), contract in doc comments, not the type system. Deliberate (dailynews-gen convention; keeps the 0097 call a pure `--in`/`--out` swap), and option-input is fully supported at the transport seam. Revisit only if a third consumer appears. |

#### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `plugins/publishings/podcast-pub/src/show-notes.ts:95-131` — `renderShowNotesMarkdown(docs, {title, runDate, articleBaseUrl?})`: slugify :96-103 (`post` fallback), article URL :104 (default `https://surfing.salty.vip`), sourceLabel :105-115 (sourceName trim → hostname www-strip → `来源`), per-item `## N.` with 。！？ 2-sentence cap :118-127, footer :130; operation routed at `src/index.ts:16,330-339`; byte-pinned by tests `tests/podcast-pub.test.ts:943,949` + fresh live-workflow cmp (BYTE-MATCH ×4, evidence below) |
| R2 | MET | `src/index.ts:124-156` `AssemblyOptions`+`resolveAssemblyOptions` (per-key fail-loud validation); `src/index.ts:213-224` additive merge — `audioFile`→`metadata.audioFile` retiring `audioUrl` (:220, avoids map.ts ambiguity guard), `coverPath`→`coverImage` (:221), `durationSec`→`durationSeconds` (:222); absent keys leave `map.ts` path untouched (design precedence note honored); tests :1113-1149 (enclosure+image+duration Result), :1151-1177 (options-beat-metadata precedence), :1077-1111 (`durationSec: 0` boundary + hosted branch) |
| R3 | MET | `src/index.ts:16` `OPERATIONS` gains `'show-notes'`; `src/index.ts:61-66` `resolveOperation` unknown → fail loud; tests :751-774 (`options.operation "explode"` through `processPublishIO`, no `MICROFEED_*` env, fetch spy asserts zero network — routing precedes credential resolution) |
| R4 | MET | Both ops under fake transport: `FakeFileCliTransport` (publish-harness) with `getCallLogs().length === 0` for show-notes IO (:1041-1063); fetch-spy offline transport tests (:976-994, :996-1027); fresh run: `bun test plugins/publishings/podcast-pub/tests/podcast-pub.test.ts` → 40 pass / 0 fail |
| R5 | MET | Fresh this turn: `git diff --name-only HEAD -- '*.yaml' '*.yml'` → empty; `git status --porcelain \| grep -E '\.ya?ml$'` → no matches. Workflow switch left to 0097 |

#### Acceptance Criteria Verification

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| show-notes op byte-identical headings vs workflow inline renderer (fixture diff) | MET | command | `cmp` this turn: workflow bun -e (verbatim from yaml:208) vs `show-notes-golden.txt` = BYTE-MATCH; plugin `renderShowNotesMarkdown` vs golden = BYTE-MATCH; workflow vs plugin = BYTE-MATCH; r6 blended plan vs `show-notes-r6-golden.txt` = BYTE-MATCH (plus tests :943-952) |
| publish with assembly options yields Result with enclosure + image + duration | MET | test | `tests/podcast-pub.test.ts:1113-1149` — attachments `duration_in_seconds`, finalize `image` |
| unknown operation fails loud | MET | test | transport `'nuke'` test + `tests/podcast-pub.test.ts:751-774` |
| existing podcast-pub tests green | MET | command | 40 pass / 0 fail (169 expects) this turn; full gate `bun run lint` exit 0 + `bun run test` → 598 pass / 0 fail (2410 expects, 44 files) this turn |

#### Design Conformance

All frozen-WHERE claims DONE: `renderShowNotesMarkdown` signature per design (`show-notes.ts:78-95`); `renderShowNotesHtml` untouched (diff = 1 import + appended block only); `resolveOperation` routing (:61-66); additive publish options (:124-156, :213-224); docs synced (`docs/04_DESIGN.md` podcast-pub export table: `renderShowNotesMarkdown` row, `show-notes` in `processPublishIO` row, assembly options on transport row). One CHANGED claim: title merge (see P3 above) — documented in the task's Solution ("title = the effective episode title, `vars.title || article.title` at the call site") → PASS-acceptable. No scope creep: every diff hunk in scope maps to R1–R4/design items.

#### Architecture (sp-code-improvement lenses)

No blocker/major candidates. `show-notes.ts` co-locates generator + sanitizer behind two deep string→string exports (good locality; 100% stmt / 98.65% branch coverage). `publishEpisode`'s assembly merge reuses the existing `mapContentToEpisode` seam via `metadata` injection instead of forking a second mapping path — right direction, precedence localized (:213-224). Option resolvers are pure and transport-testable. Only advisory-level friction is the env channel (P4 above). `index.ts` (~545 lines) is large but flat; not a this-task regression (was already the module pattern).

#### SECUA

Security: no new secrets handling; env fallback reads only `PODCAST_PUB_*` (never credentials), show-notes branch returns before `resolveClient` (:330-339) — no-network guarantee holds (fetch-spy tests + code order). Injection surface = markdown text only, sanitized downstream (P4 note). Efficiency: pure O(n) render; no added API calls. Correctness: `durationSec` NaN/Infinity/negative rejected (:139-147); `audioUrl: undefined` retirement verified against map.ts guard (test :1151-1177). Usability: error messages name the offending option and env key.

#### Residual Risk

- 0097 must pass the *effective* title (`vars.title || article.title`) as `PODCAST_PUB_TITLE`; passing raw `vars.title` diverges footer/slug from today's workflow when a custom title is set (P3 above).
- `PODCAST_PUB_ARTICLE_BASE_URL` in the environment can retarget the footer link (string interpolation only — no fetch, no SSRF; trusted-env channel already carries `MICROFEED_*` credentials).
- Dual-source window until 0097: workflow inline script and plugin generator coexist; goldens pin the plugin side, so later workflow-side drift would not silently unpin the plugin.

#### Verification Evidence (fresh, this run)

`bun test plugins/publishings/podcast-pub/tests/podcast-pub.test.ts` → 40 pass / 0 fail (169 expect calls); `bunx tsc --noEmit -p plugins/publishings/podcast-pub/tsconfig.json` → exit 0; `bunx biome check plugins/publishings/podcast-pub/src plugins/publishings/podcast-pub/tests` → clean; `bun run lint` → exit 0; `bun run test` → 598 pass / 0 fail; YAML negative check → empty; 4× `cmp` golden byte-match → BYTE-MATCH.

#### Fix items for verify stage (non-blocking)

1. Add a precedence test: `options.title` AND `PODCAST_PUB_TITLE` both set (different values) → option wins (pins `resolveOptionString`, `index.ts:87-91`).
2. Record the 0097 contract note in the 0097 task: `PODCAST_PUB_TITLE` must carry the effective title (`vars.title || article.title`) to preserve footer/slug byte-fidelity.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-06T23:46:56.021Z todo → wip (system)
- 2026-09-07T00:34:16.948Z wip → testing (system)
- 2026-09-07T00:34:17.720Z testing → done (system)
