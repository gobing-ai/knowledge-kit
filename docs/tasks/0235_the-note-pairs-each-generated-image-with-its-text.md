---
schema_version: 1
name: The 上传图文 note pairs each generated image with its text
status: todo
template: feature-impl
created_at: 2026-10-09T06:24:08.232Z
updated_at: "2026-10-09T18:15:57.678Z"
feature_id: G12

priority: P2
---

## 0235. The 上传图文 note pairs each generated image with its text

### Background

Feature G12 scenario R1. On 2026-10-09 the operator emptied the Xiaohongshu creator draft box because the saved drafts were wrong. 每日AI乱炖 still needs an 上传图文 note, and that note has to spend the images this episode already generates, each with text that matches the image.

Creator drafts are stored in the browser profile `~/.config/kk/browser-profiles/xhs`. The phone app and any other browser show an empty box. The console itself says the drafts are deleted when that browser's data is cleared. Review the result in this profile.

F616 (done) typesets card copy with real type. Do not add a second text renderer. Important, not urgent: leave `xhs_live` false.

**Verified against code and the 2026-10-08 run (refine 2026-10-09).**

- R3 is already delivered: `xhs-pub` saves via `暂存离开` and claims `draft` only from a draft-counter/row delta (`plugins/publishings/xhs-pub/src/flow.ts:64-67,273-314`). The 2026-10-08 result reads `publishStatus: draft … via '暂存离开' (上传图文)` (`.works/kk-daily-ai-voice2/20261008/31-publish/20261008_19_publish-xhs_result.json`). Keep it as a regression check, not new work. HIGH.
- The gap is image selection and pairing. `25-xhs/content.json` attached exactly 4 typeset card PNGs, all from the **lead item only** (`xhs-write` prompt, `kk-daily-ai-voice2.yaml:527-531`). The episode cover `23-cover/<date>_07_cover_cover.png` (ultrawide and text-free) was never attached. The note body (477 chars) is a free LLM paragraph with no per-image correspondence. HIGH.
- Each card PNG is already the F616 composite of the text-free illustration JPG plus typeset copy (`dailyXhsRender`, `daily-stages.ts:1420-1535`, `illustrationPath`). The JPGs are intermediates and are not attached separately.
- voice1 (`kk-daily-ai-voice.yaml:467,476,485`) calls the same `daily-xhs-render` and `daily-publish-xhs` stages, so any behaviour change must be opt-in from voice2. HIGH.

### Requirements

- [ ] R1. **Episode image set, declared order.** For voice2, the 上传图文 note attaches, in this order:
  1. card 1, the typeset 3:4 cover card. It sets the grid ratio.
  2. One typeset content card per episode item, taken in `21-plan/<date>_03_plan_plan.json` order, up to `xhs_cards − 2`.
  3. The typeset closing card.
  4. The episode cover `23-cover/<date>_07_cover_cover.png`, when it exists; it goes last because it is ultrawide.

  The set must not exceed `XHS_IMAGE_MAX` (18, `xhs-pub/src/modes.ts:66`). Generate no new kind of image.
- [ ] R2. **Every image has matching text, built deterministically.**
  - The note body carries one numbered line per attached image, in attach order.
  - A card's line is built from that card's `copy` and first `points` entry.
  - The cover's line names the episode (`每日AI乱炖 <date> 本期封面`).
  - The LLM `body` is kept only as the lead paragraph above the list; hashtags stay last.
  - The body stays ≤ `XHS_NOTE_BODY_MAX` (1000). When over, trim the lead paragraph first and never drop a numbered line.
  - The cover and illustrations stay text-free, so their words live in the body or on the card (F616), never in the picture.
- [ ] R3. **Draft rail (already delivered — regression only).** With `xhs_live` unset or false, `xhs-pub` saves via 上传图文 + `暂存离开` and reports `publishStatus: draft` only after the console's save signal; it never clicks 发布.
- [ ] R4. **voice1 unchanged.**
  - `kk-daily-ai-voice.yaml` stays byte-identical.
  - The new behaviour is opt-in through one new trailing argument, `note_scope` (`episode`), on `kk stage daily-xhs-render`, and only voice2 passes it.
  - Without that argument, today's lead-item series and body come out byte-for-byte.
  - The `docs/04_DESIGN.md` stage row is updated in the same change (T3).

### Acceptance Criteria

- [ ] AC1 — The 上传图文 note pairs each generated image with its text
  - Evidence (stage test, `apps/cli/tests/kk-workflow-stages.test.ts`, image-gen PATH shim): with `note_scope=episode`, a 6-item plan, `xhs_cards=6` and an existing cover PNG, `25-xhs/content.json` `metadata.images` is `[card-01, card-02…card-05, card-06, 23-cover]` in that order. The body holds exactly 7 numbered lines, line *i* contains image *i*'s `copy` (cards) or `本期封面` (cover), and the body is ≤1000 chars (R1, R2).
  - Evidence: without `note_scope`, the packaged `content.json` is byte-identical to a fixture captured before the change, and `git diff --exit-code plugins/kk/workflows/kk-daily-ai-voice.yaml` is clean (R4).
  - Evidence: when the cover PNG is missing, the episode set is the cards only and a log line names the missing cover; there is no failure (R1).
  - Evidence (live, operator profile): one voice2 dry run's result json reads `publishStatus: draft` with `operation: 上传图文`, and 草稿箱 → 图文笔记 in `~/.config/kk/browser-profiles/xhs` shows the note with the images in order (R3). The run id is recorded in Testing.

### Q&A

#### Q&A entry — 2026-10-09

- **Which images.** Use the cover and the XHS card series this episode already generates. Add or regenerate an image only when one of those cannot carry its role.
- **Lead-item series.** F615's lead-item-only plan is the old contract. This note covers the episode's images.
- **Live post.** Out of scope. `xhs_live` stays false.
- **Deleted drafts.** Do not recreate the notes the operator deleted on 2026-10-09.

#### Q&A entry — 2026-10-09 (refine)

- **Is R3 new work?** No. It was delivered and observed on 2026-10-08 (`暂存离开`, `publishStatus: draft`). It is kept as a regression check.
- **Where does the ultrawide cover go?** Last. Image 1 sets the note's grid ratio, so a 3:4 typeset card leads.
- **Why build the body deterministically?** The pairing has to be checkable. A list built from card fields is a fixed line-per-image mapping; an LLM paragraph is not.
- **Ready for todo?** Yes. The seams are verified and every AC has command evidence. 0237 and 0238 are independent of this task.

### Design

**Seam.** Two changes, no change to `xhs-pub`.

1. **`xhs-write` prompt** (`kk-daily-ai-voice2.yaml:525-534`, voice2 only) plans across the episode instead of the lead item.
   - Card 1 is the episode hook.
   - Cards 2…N−1 take one plan item each, in plan order, and add an `"itemId"`.
   - Card N is the closing card.
   - `sourcePoint` comes from that card's own item.
   - The prompt stays ≤1000 chars (ADR-115).
2. **`dailyXhsRender`** (`plugins/kk/scripts/daily-stages.ts:1420`) gets an optional 9th argument, `note_scope`. When it is `episode`:
   - after the cards, append `23-cover/<date>_07_cover_cover.png` when `isFile`;
   - build the body as the lead paragraph (`plan.body` minus hashtags), then numbered `①…` lines, then the hashtags;
   - enforce the 1000-char cap by trimming the lead paragraph.

   Absent or other values: today's code path.

`dailyPublishXhs` needs no change, because it forwards `content.json`.

**Rejected.**
- Attaching the illustration JPGs alongside the PNGs: duplicate pictures with no text.
- Leading with the ultrawide cover: XHS sets the grid ratio from image 1, so a 3:4 card is the right first image.
- An LLM-written per-image body: pairing has to be verifiable, so the body is built from card fields.
- A new renderer: F616 owns card type.

### Plan

1. Tests first (AC1 evidence 1–3): capture today's `content.json` from the existing render test fixture as the voice1 golden; add the episode-scope case and the missing-cover case. Run them; they fail. Run tests from a worktree until 0242 R6 lands.
2. `dailyXhsRender`: `note_scope` arg; cover append; deterministic body builder with the 1000-char cap.
3. voice2 `xhs-render` node: pass `"episode"` as the 9th arg. `xhs-write` prompt: episode-spanning plan with `itemId` (≤1000 chars).
4. `docs/04_DESIGN.md` stage row (T3); F615/F616 notes in `docs/05_FEATURES.md` if their wording claims lead-item-only for voice2.
5. `bun run gate`. Then one voice2 dry run with `xhs_enabled=true`, `xhs_live` unset; check the result json and the 草稿箱 in the kk profile (not the phone app). Record the run id.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-09T18:15:57.678Z backlog → todo (system)

