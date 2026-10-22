---
schema_version: 1
name: Move daily channel copy shaping out of daily-stages.ts into a generate-side social-write stage
status: todo
template: feature-impl
created_at: 2026-10-22T18:41:33.500Z
updated_at: "2026-10-22T19:09:51.518Z"
feature_id: G15

dependencies: ["0321"]
priority: P2
estimate_hours: 6
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

- [ ] R1. Extract pure builders in `daily-stages.ts`, each returning a `Content` and taking a `links: {articleUrl, podcastUrl}` argument:
  - `buildSurfdashContent`
  - `buildPodcastContent`
  - `buildWechatArticleContent`
  - `buildXhsEpisodeContent`
  - `buildXhsCardsContent`

  The voice2 functions call them with real urls and keep their file names, caching and outputs byte-identical (voice2-dag tests unchanged and green).
- [ ] R2. New stage `daily-bundle-variants <workDir> <runDate> <pluginsPath>` calls the builders with `links = {{article_url}} / {{podcast_url}}` placeholders. It writes `30-variants/<variant>.content.json` for `article@surfdash-pub`, `episode@podcast-pub`, `article@wechatmp-pub`, `episode@wechatmp-pub`, `episode@xhs-pub`, `article@xhs-pub` and `cards@xhs-pub`, plus generic `article` and `episode`. A builder whose source artifact is absent (e.g. xhs disabled) skips its variant and logs it.
- [ ] R3. New `social-write` agent.run node (inline prompt ≤ 1000 chars, voice2 ADR-115 convention; delivered via the file-write tool per voice2.yaml:290-298 forensics) writes zh copy to `26-social/{x,weibo,threads}.md` within each platform's length limit. `daily-bundle-variants` wraps these into `social:x`, `social:weibo` and `social:threads` Content variants with the cover image attached.
- [ ] R4. voice2 YAML is untouched.
- Out of scope: bundle.json (0324); English variants (D3: zh only for now).

### Acceptance Criteria

- [ ] AC1 — voice3 generate freezes a bundle publish3 can consume (req: R2, R3)
- [ ] AC2 — voice2 publish payloads are unchanged by the builder extraction (req: R1, R4)

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-22T18:59:28.584Z feature_id Q → G15 (system)
- 2026-10-22T19:09:51.518Z backlog → todo (system)

