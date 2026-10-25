---
schema_version: 1
name: Move daily channel copy shaping out of daily-stages.ts into a generate-side social-write stage
status: done
template: feature-impl
created_at: 2026-10-22T18:41:33.500Z
updated_at: "2026-10-25T04:35:39.547Z"
feature_id: G15

dependencies: ["0321"]
priority: P2
estimate_hours: 6
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0327-verdict.json
---

## 0327. Move daily channel copy shaping out of daily-stages.ts into a generate-side social-write stage

### Background

Channel payload assembly lives inside the voice2 publish stages of `plugins/kk/scripts/daily-stages.ts`:
- `dailyPublishPrep` :1572
- `dailyPublishSurfdash` :1648
- `dailyPublishWechat` :1684
- `dailyPublishXhs` :1788
- `dailyShowNotes` :2529
- `dailyXhsRender` :2857

So publishing re-assembles content (boundary violation, design §6). voice3 needs the payloads produced on the generate side as bundle variants (0321 bundle contract).

**Refine corrections (2026-10-22)**

- There is no existing social copy for x/weibo/threads: voice2 never published them. `social-write` is new authoring, not a move.
- The real move is extracting the pure *payload builders* out of the four publish functions, which today build and send in one body. voice2 keeps calling the same builders, so its behaviour is unchanged.
- `plugins/kk/scripts/` edits are invisible to `kk stage` until synced to the installed package (AGENTS.md "Editing plugins/kk/scripts/"). Tests run against the checkout; the E2E rehearsal needs the sync step.

### Requirements

- [x] R1. Extract pure builders in `daily-stages.ts`, each returning a `Content` and taking a `links: {articleUrl, podcastUrl}` argument:
  - `buildSurfdashContent`
  - `buildPodcastContent`
  - `buildWechatArticleContent`
  - `buildXhsEpisodeContent`
  - `buildXhsCardsContent`

  The voice2 functions call them with real urls and keep their file names, caching and outputs byte-identical (voice2-dag tests unchanged and green).
- [x] R2. New stage `daily-bundle-variants <workDir> <runDate> <pluginsPath>` calls the builders with `links = {{article_url}} / {{podcast_url}}` placeholders. It writes `30-variants/<variant>.content.json` for `article@surfdash-pub`, `episode@podcast-pub`, `article@wechatmp-pub`, `episode@wechatmp-pub`, `episode@xhs-pub`, `article@xhs-pub` and `cards@xhs-pub`, plus generic `article` and `episode`. A builder whose source artifact is absent (e.g. xhs disabled) skips its variant and logs it.
- [x] R3. New `social-write` agent.run node (inline prompt ≤ 1000 chars, voice2 ADR-115 convention; delivered via the file-write tool per voice2.yaml:290-298 forensics) writes zh copy to `26-social/{x,weibo,threads}.md` within each platform's length limit. `daily-bundle-variants` wraps these into `social:x`, `social:weibo` and `social:threads` Content variants with the cover image attached.
- [x] R4. voice2 YAML is untouched.
- Out of scope: bundle.json (0324); English variants (D3: zh only for now).

### Acceptance Criteria

- [x] AC1 — voice3 generate freezes a bundle publish3 can consume (req: R2, R3)
- [x] AC2 — voice2 publish payloads are unchanged by the builder extraction (req: R1, R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-22T19:09:04.270Z

- **Q: Move builders to a new module?** Closed: no. They stay in `daily-stages.ts` beside their callers (fewest files, smallest diff).
- **Q: One social stage per platform?** Closed: one `social-write` agent.run writing three files, because the copy shares context.

### Design

- Builders sit next to their current callers in `daily-stages.ts`. They take explicit paths and links and do no I/O beyond reading the source artifacts. Each voice2 `dailyPublish*` becomes `build*(…) → existing write/dispatch`.
- The variant file name is the variant key with `:` → `_`, e.g. `social_x.content.json`. The bundle maps key → path.
- Link placeholders appear only in variants. voice2 passes real urls, so its behaviour stays identical.
- `social-write` limits: x 280 weighted chars (CJK counts 2), weibo 2000, threads 500. The prompt enforces them; `daily-bundle-variants` truncates hard as a backstop and logs it.
- Anti-patterns:
  - no copy authoring inside publish plugins or publish3;
  - no new per-channel stage per platform: one variants stage.
- Handoff: 0324 adds the nodes to voice3 and freezes `30-variants/*` into `bundle.json`.

### Plan

1. Failure list: a voice2 output drift (byte diff), a placeholder leaking into a voice2 payload, a disabled channel crashing variants, and over-length social copy. (R1–R3)
2. Extract the builders one function at a time, running `bun test apps/cli/tests/voice2-dag.test.ts apps/cli/tests/kk-workflow-stages.test.ts` after each. (R1, R4)
3. Add the `daily-bundle-variants` stage and its registration. (R2)
4. Add the `social-write` inline prompt (in the 0324 YAML node) and wrap the social copy into variants. (R3)
5. Test `daily-bundle-variants` against a recorded voice2 work-dir fixture: expected variant files exist, placeholders present, Content schema valid. (R2, R3)
6. Run `bun run lint && bun run test`, then sync `plugins/kk/scripts/` to the installed package per AGENTS.md before the 0323 rehearsal.

### Solution

| Change | What / why |
| --- | --- |
| `plugins/kk/scripts/daily-stages.ts:1530` | `PublishLinks` + `PLACEHOLDER_LINKS`: the two public urls every downstream channel links to, as either real values (voice2) or the placeholders `publish-matrix-send` resolves. |
| `plugins/kk/scripts/daily-stages.ts:1561` | `buildWechatArticleContent` — the 公众号 payload, lifted verbatim out of `dailyPublishWechat` (MP enrichment block, brand strings, 原文链接 from `links.articleUrl`, 咸话咸说 outro). |
| `plugins/kk/scripts/daily-stages.ts:1606` | `buildXhsEpisodeContent` — the 发播客 payload; `xhsPodcastNote` now delegates to it. |
| `plugins/kk/scripts/daily-stages.ts:1623` | `buildXhsArticleContent` — the 写长文 payload (article Content + publish status). |
| `plugins/kk/scripts/daily-stages.ts:1634` | `buildXhsCardsContent` — the 上传图文 payload (card series + status + optional follow-ups). |
| `plugins/kk/scripts/daily-stages.ts:1649` | `buildPodcastContent` — publish-prep Content + the episode's show notes. |
| `plugins/kk/scripts/daily-stages.ts:1662` | `buildSurfdashContent` — the article Content unchanged: surfdash is the article's own publisher, so the builder exists for a uniform variant set. |
| `plugins/kk/scripts/daily-stages.ts:1670` | `buildSocialContent` — one channel's short copy as a Content with the cover attached; the per-platform cap truncates as a backstop and records `truncatedFrom`. |
| `plugins/kk/scripts/daily-stages.ts:1708` | `dailyBundleVariants` — the `daily-bundle-variants` stage: writes the whole `30-variants/<key>.content.json` set with placeholder links, skipping any variant whose source artifact is absent and naming each skip. That key → file map is exactly the bundle's `variants` contract from 0321. |
| `plugins/kk/scripts/daily-stages.ts:1530-1700` (rewiring) | `dailyPublishPodcast`, `dailyPublishWechat` and `dailyPublishXhs` now call the builders with the real urls they already resolve, keeping their caching, file names and outputs unchanged (R1, R4). |
| `plugins/kk/scripts/kk-workflow-stages.ts:1750` | `daily-bundle-variants` registered in the stage dispatcher. |
| `apps/cli/tests/kk-workflow-stages.test.ts:2193` | Variant-set test: placeholders present instead of real links, show notes / 发播客 operation carried, cover attached to social copy, absent channels named and not written. |
| `apps/cli/tests/kk-workflow-stages.test.ts:2245` | Truncation backstop: 400 chars of copy becomes a 280-char body with `truncatedFrom: 400`. |
| `docs/04_DESIGN.md:2053` | The builder/variant surface, its key set and the truncation policy (T3). |

**Verification:** `bun run lint` clean; `bun test apps/cli/tests/voice2-dag.test.ts apps/cli/tests/kk-workflow-stages.test.ts apps/cli/tests/kk-daily-ai-voice-workflow.test.ts` → 195 pass, 0 fail (voice2 outputs unchanged, R4: `kk-daily-ai-voice2.yaml` untouched).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | builders `plugins/kk/scripts/daily-stages.ts:1567` buildWechatArticleContent, `plugins/kk/scripts/daily-stages.ts:1619` buildXhsEpisodeContent, `plugins/kk/scripts/daily-stages.ts:1647` buildXhsCardsContent, `plugins/kk/scripts/daily-stages.ts:1662` buildPodcastContent, `plugins/kk/scripts/daily-stages.ts:1684` buildSurfdashContent, `plugins/kk/scripts/daily-stages.ts:1733` buildSocialContent; voice2 callers `plugins/kk/scripts/daily-stages.ts:2008`, `plugins/kk/scripts/daily-stages.ts:2192`, `plugins/kk/scripts/daily-stages.ts:2269`, `plugins/kk/scripts/daily-stages.ts:2305` |
| R2 | MET | `plugins/kk/scripts/daily-stages.ts:1795` dailyBundleVariants with placeholder links; `apps/cli/tests/kk-workflow-stages.test.ts:2197` |
| R3 | MET | `plugins/kk/scripts/daily-stages.ts:1733` buildSocialContent; `plugins/kk/workflows/kk-daily-ai-voice3.yaml:760` social-write; `apps/cli/tests/kk-workflow-stages.test.ts:2197`, `apps/cli/tests/kk-workflow-stages.test.ts:2254`, `apps/cli/tests/kk-workflow-stages.test.ts:2281` |
| R4 | MET | `git show --stat --format= a1c0e1d -- plugins/kk/workflows/kk-daily-ai-voice2.yaml` → empty this run (later commits edit voice2 for unrelated fixes, so the range form no longer applies); voice2 suites 208 pass / 0 fail |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — voice3 generate freezes a bundle publish3 can consume (req: R2, R3) | MET | test | `apps/cli/tests/kk-workflow-stages.test.ts:2197`, `apps/cli/tests/kk-workflow-stages.test.ts:2254` |
| AC2 — voice2 publish payloads are unchanged by the builder extraction (req: R1, R4) | MET | command | `bun test apps/cli/tests/voice2-dag.test.ts apps/cli/tests/commands/daily.test.ts apps/cli/tests/kk-workflow-stages.test.ts` → 208 pass, 0 fail this run; `plugins/kk/scripts/daily-stages.ts:1608` appendOutro default keeps voice2 body (bundle opts out at `plugins/kk/scripts/daily-stages.ts:1851`) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Confidence: HIGH
Verdict: PASS

**Scope:** the builder extraction in `plugins/kk/scripts/daily-stages.ts` (seven builders + `PublishLinks` + `PLACEHOLDER_LINKS`), the new `daily-bundle-variants` stage and its registration, two tests, and the `docs/04_DESIGN.md` surface note. voice2's YAML is untouched by contract (R4).

| Priority | Finding | Disposition |
| --- | --- | --- |
| P3 | `dailyBundleVariants` wrote `episode@wechatmp-pub` through `buildWechatArticleContent`, which appends the 咸话咸说 outro to a body that, for the episode variant, is the episode body — the outro belongs to the article variant only. | Fixed — the 公众号 播客 variant passes the prep Content and the outro stays where the article builder already puts it; the variant is documented as the audio block's carrier (cover + `audioPath`), not a second article. |
| P4 | `buildSurfdashContent` ignores its `links` argument (surfdash *is* the article publisher, so it links nothing). | Accepted with the named `_links` parameter and a doc comment: the uniform signature is what lets the variant stage treat all builders alike. |

**SECUA / architecture**

- **Security** — builders are pure field mapping over already-composed local artifacts; the only values that reach a channel are the placeholder urls, which `publish-matrix-send` resolves from tier-0 receipts rather than from any authored text.
- **Efficiency** — one pass per work dir writes at most ~14 small JSON files; no network, no process spawn (the stage takes `pluginsPath` for signature parity with its siblings and deliberately does not use it).
- **Correctness** — voice2 keeps the real urls, so its four publish stages produce the same payloads they did before the extraction; the three voice2 suites (193 then 195 tests with the new ones) pass unchanged, which is the observable proof of R1/R4. The placeholder variants are the same functions with `PLACEHOLDER_LINKS`, so a generate-side payload cannot silently differ from what publishing would have produced.
- **Usability** — every skipped variant is named (`social:weibo (no 26-social/weibo.md)`, `cards (no rendered card series)`), so a disabled channel is visible rather than a silent gap in the frozen bundle.
- **Architecture** — builders live beside their callers as the task's Q&A decided (no new module), the stage is one `daily-*` entry in the existing dispatcher, and the variant keys are exactly the bundle contract 0321 defined (`${variant}@${plugin}` then `${variant}`), so 0324 can freeze `30-variants/*` without a translation table.

**Residual risk**

- The 公众号 播客 variant reuses the article builder's enrichment (原创/赞赏/合集); whether the platform accepts that shape for an audio-first post is a live-publish question for 0323's rehearsal, not something a unit test can settle.
- Social truncation is a backstop, not a limiter: authored copy over the cap is cut mid-sentence rather than rejected, and `truncatedFrom` records it so 0324's prompt can be tuned from evidence.
- `plugins/kk/scripts/` edits are invisible to `kk stage` until synced into the installed package (AGENTS.md); the rehearsal in 0323 must run the sync step first.

**Verification:** `bun run lint` clean; `bun test` on the voice2, workflow-stage and daily-workflow suites → 195 pass, 0 fail; `spur task gate 0327` PASS on the final tree (4098 tests, 0 fail); `git diff plugins/kk/workflows/kk-daily-ai-voice2.yaml` empty.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-22T18:59:28.584Z feature_id Q → G15 (system)
- 2026-10-22T19:09:51.518Z backlog → todo (system)
- 2026-10-22T22:31:58.726Z todo → wip (system)
- 2026-10-22T23:40:23.445Z wip → testing (system)
- 2026-10-22T23:40:25.327Z testing → done (system)

