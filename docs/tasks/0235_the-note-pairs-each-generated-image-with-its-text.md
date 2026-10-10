---
schema_version: 1
name: The 上传图文 note pairs each generated image with its text
status: done
template: feature-impl
created_at: 2026-10-09T06:24:08.232Z
updated_at: "2026-10-10T01:56:17.454Z"
feature_id: G12

priority: P2
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0235-verdict.json
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

- [x] R1. **Episode image set, declared order.** For voice2, the 上传图文 note attaches, in this order:
  1. card 1, the typeset 3:4 cover card. It sets the grid ratio.
  2. One typeset content card per episode item, taken in `21-plan/<date>_03_plan_plan.json` order, up to `xhs_cards − 2`.
  3. The typeset closing card.
  4. The episode cover `23-cover/<date>_07_cover_cover.png`, when it exists; it goes last because it is ultrawide.

  The set must not exceed `XHS_IMAGE_MAX` (18, `xhs-pub/src/modes.ts:66`). Generate no new kind of image.
- [x] R2. **Every image has matching text, built deterministically.**
  - The note body carries one numbered line per attached image, in attach order.
  - A card's line is built from that card's `copy` and first `points` entry.
  - The cover's line names the episode (`每日AI乱炖 <date> 本期封面`).
  - The LLM `body` is kept only as the lead paragraph above the list; hashtags stay last.
  - The body stays ≤ `XHS_NOTE_BODY_MAX` (1000). When over, trim the lead paragraph first and never drop a numbered line.
  - The cover and illustrations stay text-free, so their words live in the body or on the card (F616), never in the picture.
- [x] R3. **Draft rail (already delivered — regression only).** With `xhs_live` unset or false, `xhs-pub` saves via 上传图文 + `暂存离开` and reports `publishStatus: draft` only after the console's save signal; it never clicks 发布.
- [x] R4. **voice1 unchanged.**
  - `kk-daily-ai-voice.yaml` stays byte-identical.
  - The new behaviour is opt-in through one new trailing argument, `note_scope` (`episode`), on `kk stage daily-xhs-render`, and only voice2 passes it.
  - Without that argument, today's lead-item series and body come out byte-for-byte.
  - The `docs/04_DESIGN.md` stage row is updated in the same change (T3).

### Acceptance Criteria

- [x] AC1 — The 上传图文 note pairs each generated image with its text
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

#### Q&A entry — 2026-10-09 (operator decision: live evidence deferred)

- **AC1's live-console bullet (one voice2 dry run reading `publishStatus: draft` with `operation: 上传图文`, confirmed in 草稿箱 → 图文笔记 under `~/.config/kk/browser-profiles/xhs`) is operator-deferred.** It requires an operator-attended headed run under ADR-025 and cannot be produced headlessly. AC1 is certified on its three code-level bullets (episode image order + one numbered line per image ≤1000 chars; byte-identity without `note_scope` plus a clean `git diff --exit-code` on `kk-daily-ai-voice.yaml`; the missing-cover case), each with executable evidence.
- **The deferral is not a PASS.** It is recorded here, in `## Testing`, in the run log (`.spur/memory/runs/574d1750-…md`) and in the verdict artifact; the live run id is still owed before anyone may claim the console behaviour observed.
- **Follow-up:** schedule the attended dry run, record the run id and the 草稿箱 check in `## Testing`.

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

R1–R4 landed as one opt-in trailing argument; voice1's path and its workflow file are untouched.

**Change map**

- `plugins/kk/scripts/daily-stages.ts:1415` `XHS_NOTE_SCOPE_EPISODE` — the one opt-in value (`episode`); anything else keeps today's path (R4).
- `plugins/kk/scripts/daily-stages.ts:1421-1424` `markerFor` — attach-order markers `①…` (U+2460 is contiguous; the note holds ≤ `XHS_MAX_CARDS` + 1 = 11 images, so no bare number is ever needed) (R2).
- `plugins/kk/scripts/daily-stages.ts:1431-1438` `splitNoteBody` — the agent's body splits into the lead paragraph and its trailing hashtag run, so the hashtags can move back to the end (R2).
- `plugins/kk/scripts/daily-stages.ts:1444-1457` `episodeNoteBody` — lead + numbered lines + hashtags, enforcing the 1000-char cap (`XHS_BODY_CAP`, the stage-side twin of `xhs-pub`'s `XHS_NOTE_BODY_MAX`) by trimming only the lead; a body that overflows even without a lead fails loud instead of dropping a line (R2).
- `plugins/kk/scripts/daily-stages.ts:1482-1487` — the 9th argument `note_scope` and the `episode` decision; the cover path is `23-cover/<date>_07_cover_cover.png`.
- `plugins/kk/scripts/daily-stages.ts:1579-1580` — a card's numbered line is pushed in the same step as its image (`copy` + first `points` entry), so attach order and body order cannot drift (R2).
- `plugins/kk/scripts/daily-stages.ts:1581-1593` — the episode cover is appended last when it exists (`isFile`, resolved for the publisher); a missing cover logs `xhs render: no episode cover at <path> — the note carries the <N> cards only` and stays a success. The set is ≤ 11 ≤ `XHS_IMAGE_MAX` (18); the image is `daily-cover`'s own artifact — no new image kind, no new renderer (R1).
- `plugins/kk/scripts/daily-stages.ts:1599` — `body`: episode scope composes the deterministic body; any other scope packages `plan.body` verbatim (R4).
- `plugins/kk/scripts/daily-stages.ts:1604-1608` — the success log names images in image order under episode scope, byte-for-byte the old line otherwise.
- `plugins/kk/workflows/kk-daily-ai-voice2.yaml:545` — voice2 passes `"episode"` as the 9th argument; no other workflow does (R1/R4).
- `plugins/kk/workflows/kk-daily-ai-voice2.yaml:527-534` — the `xhs-write` prompt now plans across the episode (card 1 the hook, one content card per plan item up to `xhs_cards − 2`, the last the closing card, `itemId` on each card) and states that the stage appends the numbered lines; the prompt measures **989 chars**, inside the ADR-115 1000-char tier.
- `apps/cli/tests/kk-workflow-stages.test.ts:1291-1308` — episode scope: `metadata.images` is `[card-01…card-06, 23-cover]`, exactly 7 numbered lines, line *i* carries image *i*'s `copy`/`points[0]` (the cover `本期封面`), lead first and hashtags last, body ≤ 1000 (AC1 evidence 1).
- `apps/cli/tests/kk-workflow-stages.test.ts:1321-1328` — missing cover: cards only, the log line names the missing path, exit 0 (AC1 evidence 3).
- `apps/cli/tests/kk-workflow-stages.test.ts:1344-1349` — a 980-char lead: the body trims the lead only, keeping all 7 lines and the hashtags (R2 cap).
- `apps/cli/tests/kk-workflow-stages.test.ts:1394` — the golden captured from the pre-0235 stage over the same fixture (cover present but ignored): `25-xhs/content.json` is byte-identical, so the opt-in cannot leak into voice1 (AC1 evidence 2, R4).
- `docs/04_DESIGN.md:1184` — the stage row carries the new optional `[<note_scope>]` argument, the declared image order, the deterministic body and the cap rule (T3).

**Rationale**

The pairing has to be checkable, so the body is built from the card fields the plan already carries rather than from a second LLM pass. Ordering is structural: lines and images are pushed in the same loop, and the cover is appended once, last. The whole feature rides on one trailing argument so `kk-daily-ai-voice.yaml` (which passes 8 args) stays byte-identical.

**Run-2 remediation (2026-10-10) — closes the review P3 `review-finding:d3165ae1`.**

- `apps/cli/tests/voice2-dag.test.ts:475-480` — the expected `kk stage daily-xhs-render …` substring now ends with the 9th argument `"${'$'}{vars.xhs_fallback}" "episode"`, and the test is renamed `threads the 0219 xhs_fallback opt-in and the 0235 note scope into the daily-xhs-render call` (no longer "8-arg"). Those two lines are the whole run-2 edit (2 insertions / 2 deletions).
- Negative control — the assertion now bites. With ` "episode"` surgically removed from `plugins/kk/workflows/kk-daily-ai-voice2.yaml:545`, `bun test apps/cli/tests/voice2-dag.test.ts` → 27 pass / **1 fail**, the failure being exactly this test at `apps/cli/tests/voice2-dag.test.ts:478`, `error: expect(received).toContain(expected)` / `Expected to contain: "kk stage daily-xhs-render … \"${vars.xhs_fallback}\" \"episode\""`. Pre-0235 the same revert stayed green — that is the silent regression the finding named.
- Restore is byte-exact. The YAML's sha256 is `9113cc74e61e7508eb4c87a3a53976cd881947449ec82b873954cecce2718834` both before and after the control, `cmp` against the pre-control copy is empty, and `git diff` for that file is byte-identical before and after (diff-of-diffs empty). `bun test apps/cli/tests/voice2-dag.test.ts` on the restored tree → 28 pass / 0 fail, including the renamed test.
- Caveat on the brief's literal restore check: `git diff --exit-code plugins/kk/workflows/kk-daily-ai-voice2.yaml` prints exit **1**, and already printed exit 1 *before* the control — HEAD (`a54c1f6d`) still carries the 8-arg call, so run 1's verified `"episode"` argument is the file's only difference and exit 0 would mean the fix itself had been reverted. Byte-exactness is therefore evidenced by the sha256 / `cmp` / diff-of-diffs identity above rather than by a clean diff against HEAD.
- `bun test <one file>` exits 1 on this tree even when green: bunfig's aggregate `coverageThreshold` (lines 0.9 / functions 0.9) cannot be met by a single file (37.5% funcs / 46.6% lines). Confirmed by temporarily zeroing the threshold — same 28 pass / 0 fail, exit 0; `bunfig.toml` was then restored byte-identically (`shasum -a 256` unchanged, `git diff --exit-code bunfig.toml` → exit 0). The discriminating signal for the control is therefore the pass/fail counts.
- Scope: run 2 touched no stage implementation, no workflow YAML (beyond the temporary revert it undid) and not `docs/04_DESIGN.md`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Attach order is structural, not prompt-declared: each plan card pushes its image and its numbered line in the same loop body (`plugins/kk/scripts/daily-stages.ts:1579-1580`), and the episode-cover append is one step after that loop, inside the `episode` branch only (`plugins/kk/scripts/daily-stages.ts:1585-1594`); a missing cover PNG logs `no episode cover at <path> — the note carries the <N> cards only` and stays a success (`plugins/kk/scripts/daily-stages.ts:1590-1592`). Image 1 is the typeset 3:4 card because the plan must open on role `cover` (`plugins/kk/scripts/kk-workflow-stages.ts:1044`) with role in cover/content/closing (`plugins/kk/scripts/kk-workflow-stages.ts:96,1041-1043`). Set size is bounded: `count` is refused above `XHS_MAX_CARDS`=10 (`plugins/kk/scripts/kk-workflow-stages.ts:93`, checked `plugins/kk/scripts/daily-stages.ts:1492-1494`), so at most 11 images, inside `XHS_IMAGE_MAX`=18 (`plugins/publishings/xhs-pub/src/modes.ts:66`, re-enforced at `plugins/publishings/xhs-pub/src/modes.ts:175-180`). No new image kind or renderer: the appended path is `23-cover/<date>_07_cover_cover.png`, `daily-cover`'s own artifact (`plugins/kk/scripts/daily-stages.ts:1487`). Executable: `bun test apps/cli/tests/kk-workflow-stages.test.ts -t '0235'` → 4 pass / 0 fail (raw exit 0, 36 expect() calls); order asserted at `apps/cli/tests/kk-workflow-stages.test.ts:1291`, cards-only set when the cover is absent at `apps/cli/tests/kk-workflow-stages.test.ts:1328`, missing-cover log at `:1321`. Not stage-asserted: the one-content-card-per-plan-item split is prompt-enforced (`plugins/kk/workflows/kk-daily-ai-voice2.yaml:531`) — the stage enforces count, cover-first and role, not item coverage. |
| R2 | MET | One numbered line per attached image, built from card fields and pushed in the same step as its image: `copy` + first `points` entry (`plugins/kk/scripts/daily-stages.ts:1579-1580`); cover line `每日AI乱炖 <date> 本期封面` (`plugins/kk/scripts/daily-stages.ts:1588`); the agent body is split into lead paragraph + trailing hashtag run (`plugins/kk/scripts/daily-stages.ts:1431-1438`) and re-assembled lead → lines → hashtags (`plugins/kk/scripts/daily-stages.ts:1444-1457`). `XHS_BODY_CAP`=1000 (`plugins/kk/scripts/kk-workflow-stages.ts:95`) is the stage twin of the console's `XHS_NOTE_BODY_MAX`=1000 (`plugins/publishings/xhs-pub/src/modes.ts:74`), and `plan.body` is already ≤1000 at plan time (`plugins/kk/scripts/kk-workflow-stages.ts:1025-1027`). The body cannot exceed 1000 and no numbered line can be dropped: only `head` is sliced (`plugins/kk/scripts/daily-stages.ts:1449-1450`), and a lead-less tail over the cap exits 1 (`plugins/kk/scripts/daily-stages.ts:1451-1456`) before `content.json` is written. Executable: 7 numbered lines with line i carrying image i's `copy` and `points[0]` (`apps/cli/tests/kk-workflow-stages.test.ts:1298-1302`), cover line carrying `本期封面`+date (`:1303-1304`), lead first and hashtags last (`:1306-1307`), body ≤1000 (`:1308`); the 980-char lead is trimmed while all 7 lines and the hashtags survive (`apps/cli/tests/kk-workflow-stages.test.ts:1344-1349`); `bun test apps/cli/tests/kk-workflow-stages.test.ts -t '0235'` → 4 pass / 0 fail. Residual: the `tail > cap` fail-loud branch (`plugins/kk/scripts/daily-stages.ts:1451-1456`) is unexercised — my judgement of it is a static read, not a test. |
| R3 | MET | Regression-only and the plugin is untouched: `git status --porcelain plugins/publishings/` is empty (no `xhs-pub` / `publish-harness` byte changed). The rail is present as required: `暂存离开` heads the label list newest-first (`plugins/publishings/xhs-pub/src/flow.ts:67`); a draft counts only from a delta over the pre-entry baseline — a moved counter or a save stamp that was not already there (`plugins/publishings/xhs-pub/src/flow.ts:278-284`); the draft signal comes only from a scoped toast or that delta (`plugins/publishings/xhs-pub/src/flow.ts:294-299`). Executable: `bun test plugins/publishings/xhs-pub/tests/xhs-pub.test.ts` → 107 pass / 0 fail (raw exit 1: bunfig's 0.9/0.9 aggregate coverage threshold is unreachable from one file). NOT verified by me: the 2026-10-08 live result json is absent from this tree (`.works/kk-daily-ai-voice2/` does not exist), so the historical `publishStatus: draft … via '暂存离开' (上传图文)` observation was not reproduced; this row certifies the shipped rail plus its regression suite, not a fresh live save. |
| R4 | MET | `git diff --exit-code plugins/kk/workflows/kk-daily-ai-voice.yaml; echo $?` → 0 (byte-identical). The opt-in is one trailing argument: `note_scope` destructured 9th (`plugins/kk/scripts/daily-stages.ts:1473-1483`), the single value `episode` (`plugins/kk/scripts/daily-stages.ts:1415`), the decision at `plugins/kk/scripts/daily-stages.ts:1485`, and the non-episode `body` packaged verbatim from `plan.body` (`plugins/kk/scripts/daily-stages.ts:1599`). Repo-wide call sites (grep + YAML parse): `plugins/kk/workflows/kk-daily-ai-voice2.yaml:545` passes 9 args with the tail `"${vars.xhs_fallback}" "episode"`; `plugins/kk/workflows/kk-daily-ai-voice.yaml:476` passes 8 args and no 9th. Byte-identity of the non-episode path was proved independently, not by trusting the golden: I re-ran the modified test file against pre-0235 source (detached HEAD `a54c1f6d`, where a grep for any of the three 0235 identifiers (`note_scope`, `XHS_NOTE_SCOPE_EPISODE`, `episodeNoteBody`) returns 0 hits) in a throwaway /tmp worktree → `daily-xhs-render without note_scope packages the pre-0235 content.json byte-for-byte` 1 pass / 0 fail, so the golden at `apps/cli/tests/kk-workflow-stages.test.ts:1394` is authentic pre-0235 output and today's 8-arg path reproduces it exactly. Diff shape: `plugins/kk/scripts/daily-stages.ts` is 79 insertions / 2 deletions, the two deletions being exactly the guarded `body` and success-log replacements, so the 8-arg path is additive-only. T3: `docs/04_DESIGN.md:1184` carries the new `[<note_scope>]` argument in the same uncommitted change. Run-2 remediation bites: with ` "episode"` surgically removed from `plugins/kk/workflows/kk-daily-ai-voice2.yaml:545`, the same test file run against that 8-arg YAML in the /tmp worktree → 1 fail / 27 filtered out at exactly `apps/cli/tests/voice2-dag.test.ts:478` (`expect(received).toContain(expected)`); on this tree `bun test apps/cli/tests/voice2-dag.test.ts` → 28 pass / 0 fail (raw exit 1, coverage threshold only). Step-6 check performed without touching this tree. Prompt cap: the YAML-parsed `xhs-write` input measures 990 chars ≤1000 (`plugins/kk/workflows/kk-daily-ai-voice2.yaml:527-533`); the Solution's stated 989 is off by one — immaterial, both inside ADR-115's 1000-char tier. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `bun test apps/cli/tests/kk-workflow-stages.test.ts -t '0235'` → 4 pass / 0 fail, 0 fail overall, raw exit 0 (the four named 0235 cases: episode scope, missing cover, 980-char lead trim, pre-0235 golden). Bullet 1 (R1+R2): with `note_scope=episode`, a 6-item plan, `xhs_cards=6` and an existing cover PNG, `metadata.images` equals [card-01 … card-06, `23-cover/20260101_07_cover_cover.png`] in that order (`apps/cli/tests/kk-workflow-stages.test.ts:1291`, `metadata.publishStatus: draft` at `:1292`), the body holds exactly 7 numbered lines (`:1298`) with line i containing image i's `copy` and first `points` entry (`:1299-1302`), line 7 containing `本期封面`+date (`:1303-1304`), the lead first (`:1306`), hashtags last (`:1307`) and the body ≤1000 chars (`:1308`). Bullet 2 (R4): without `note_scope` the 8-arg call's packaged `25-xhs/content.json` is byte-identical to the pre-0235 golden (`apps/cli/tests/kk-workflow-stages.test.ts:1394`) — golden authenticity independently confirmed by re-running that test against pre-0235 source (1 pass / 0 fail) — and `git diff --exit-code plugins/kk/workflows/kk-daily-ai-voice.yaml; echo $?` → 0. Bullet 3 (R1): with the cover PNG omitted the set is the 6 cards only and exit is 0 with the log line `xhs render: no episode cover at <path> — the note carries the 6 cards only` (`apps/cli/tests/kk-workflow-stages.test.ts:1319-1321`, `:1328`). Bullet 4 is OPERATOR-DEFERRED, recorded 2026-10-09: the one operator-attended live voice2 dry run against the XHS profile (`publishStatus: draft`, `operation: 上传图文`, 草稿箱 → 图文笔记 under `~/.config/kk/browser-profiles/xhs`) requires a headed, operator-attended run under ADR-025 and cannot be produced headlessly. It did NOT happen in this run and is NOT claimed as observed here; it is excluded from this certification, which rests on bullets 1-3 above. Other items I could not verify: the `tail > cap` fail-loud branch is untested (`plugins/kk/scripts/daily-stages.ts:1451-1456`), and per-item card coverage is prompt-enforced (`plugins/kk/workflows/kk-daily-ai-voice2.yaml:531`), not stage-asserted. |
| R1 — The 上传图文 note pairs each generated image with its text | MET | test | Feature G12 scenario R1 (`docs/tasks/0235_the-note-pairs-each-generated-image-with-its-text.md` Acceptance Criteria; `docs/features/G12_xhs-notes-for-ai-and-single-episode.md`): MET on the same executable evidence — `bun test apps/cli/tests/kk-workflow-stages.test.ts -t '0235'` → 4 pass / 0 fail, with `metadata.images` = [card-01 … card-06, 23-cover] at `apps/cli/tests/kk-workflow-stages.test.ts:1291` and the 7-line 1:1 image/text pairing at `apps/cli/tests/kk-workflow-stages.test.ts:1298-1304`. The voice2 wiring that turns the scenario on is locked test-first at `apps/cli/tests/voice2-dag.test.ts:475-480`, which asserts the exact 9-arg command string ending `"${vars.xhs_fallback}" "episode"` against `plugins/kk/workflows/kk-daily-ai-voice2.yaml:545` — and that assertion provably bites: with ` "episode"` removed from `:545` the file fails at `apps/cli/tests/voice2-dag.test.ts:478`. On this tree `bun test apps/cli/tests/voice2-dag.test.ts` → 28 pass / 0 fail (349 expect() calls; raw exit 1 is bunfig's single-file coverage threshold, as the brief allows). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Independent re-review (native subagent, fresh context, read-only) after run 2's remediation: **Verdict PASS** — run 1's P3 resolved, no P1/P2/P3 outstanding, R1–R4 and AC1 MET on executable evidence. Full report: `.spur/run/574d1750-9e6b-46ac-bff3-d5385cb11d8c-review-answer.txt`.

| Priority | Finding | Evidence | Disposition |
| --- | --- | --- | --- |
| P1 (blocker) | None. | — | — |
| P2 (major) | None. | — | — |
| P3 (minor) | None. Run 1's P3 (the `voice2-dag` substring assertion tolerating the new 9th argument) is fixed: the assertion now requires `…"${vars.xhs_fallback}" "episode"` and the test is renamed. | `apps/cli/tests/voice2-dag.test.ts:475,479`; `plugins/kk/workflows/kk-daily-ai-voice2.yaml:545` | Resolved in run 2; negative control re-run by the host (revert → 27 pass / 1 fail at the assertion; restore → sha256 `9113cc74…` identical). |
| P4 (advisory) | The agent-emitted `itemId` is discarded, so `cards.json` records no card→plan-item mapping. | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:531`; `plugins/kk/scripts/kk-workflow-stages.ts:99-108`, `:1018-1060` | Recorded; carry `itemId` through `xhsPlan`/`cards.json` or drop the clause. |
| P4 (advisory) | The `tail > cap` path exits 1 after every card is paid for, leaving `cards.json` without `content.json`. | `plugins/kk/scripts/daily-stages.ts:1451-1456` | Recorded; low reachability at `xhs_cards=4`; consider a per-line cap in `xhsPlan`. |
| P4 (advisory) | Docs drift one hop out: the referenced design doc still describes the lead-item series. | `docs/design/kk-daily-ai-voice.md:167-174` via `docs/04_DESIGN.md:1184` | Recorded; §7 update is a follow-up. |
| P4 (advisory) | The voice2 prompt's ADR-115 headroom (~989/1000) is unasserted; the cap test covers voice1 only. | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:528-533`; `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:252-263` | Recorded; add a voice2 prompt-cap assertion. |

**Residual risk.** The AC1 live-console clause (one voice2 dry run reading `publishStatus: draft` with `operation: 上传图文`, confirmed in 草稿箱 → 图文笔记 under `~/.config/kk/browser-profiles/xhs`) is an operator-attended step under ADR-025 and is **operator-deferred, recorded 2026-10-09**; it is not claimed as observed.

**Review limitation.** The reviewer context exposes no shell and no write tool: no command was executed by the reviewer (static comparison against a clean base checkout plus the recorded gate log), and this answer artifact was persisted by the host verbatim from the reviewer's report. The host re-ran the targeted tests and the negative control, and confirmed the aggregate gate receipt (`0235-check-receipt.json`, `proofDigest = sha256:98ff06aa…`) belongs to this run.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-09T18:15:57.678Z backlog → todo (system)
- 2026-10-10T00:29:55.213Z todo → wip (system)
- 2026-10-10T00:53:04.009Z wip → testing (system)
- 2026-10-10T00:59:31.585Z testing → wip (system)
- 2026-10-10T01:12:22.133Z wip → testing (system)
- 2026-10-10T01:12:34.191Z testing → done (system)

