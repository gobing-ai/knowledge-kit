---
schema_version: 1
name: The 上传图文 note pairs each generated image with its text
status: done
template: feature-impl
created_at: 2026-10-09T06:24:08.232Z
updated_at: "2026-10-10T03:20:21.492Z"
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
- **The deferral is not a PASS.** It is recorded here, in `## Testing`, and in the run's durable verdict record (`.spur/memory/evidence/0235-verdict.json`); the live run id is still owed before anyone may claim the console behaviour observed. The worktree run log `574d1750-….md` was LOST with the worktree's gitignored `.spur` plane on 2026-10-09 (task 0247 R1) — recorded as lost, never reconstructed; the durable verdict record above carries the same run's outcome and proof digest.
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

- `plugins/kk/scripts/daily-stages.ts:1467` `XHS_NOTE_SCOPE_EPISODE` — the one opt-in value (`episode`); anything else keeps today's path (R4).
- `plugins/kk/scripts/daily-stages.ts:1473-1476` `markerFor` — attach-order markers `①…` (U+2460 is contiguous; the note holds ≤ `XHS_MAX_CARDS` + 1 = 11 images, so no bare number is ever needed) (R2).
- `plugins/kk/scripts/daily-stages.ts:1483-1488` `splitNoteBody` — the agent's body splits into the lead paragraph and its trailing hashtag run, so the hashtags can move back to the end (R2).
- `plugins/kk/scripts/daily-stages.ts:1496-1510` `episodeNoteBody` — lead + numbered lines + hashtags, enforcing the 1000-char cap (`XHS_BODY_CAP`, the stage-side twin of `xhs-pub`'s `XHS_NOTE_BODY_MAX`) by trimming only the lead; a body that overflows even without a lead fails loud instead of dropping a line (R2).
- `plugins/kk/scripts/daily-stages.ts:1534-1539` — the 9th argument `note_scope` and the `episode` decision; the cover path is `23-cover/<date>_07_cover_cover.png`.
- `plugins/kk/scripts/daily-stages.ts:1554-1557` — the numbered lines are built from the plan before the render loop, in attach order (each card's `copy` + first `points` entry in plan order, then the cover line when the cover exists), and the episode body is composed — and its cap enforced — before the first card is billed; the loop pushes images in the same plan order and the cover last (`plugins/kk/scripts/daily-stages.ts:1640-1641`), so attach order and body order cannot drift (R2).
- `plugins/kk/scripts/daily-stages.ts:1640-1645` — the episode cover is appended last when it exists (`isFile`, resolved for the publisher); a missing cover logs `xhs render: no episode cover at <path> — the note carries the <N> cards only` and stays a success. The set is ≤ 11 ≤ `XHS_IMAGE_MAX` (18); the image is `daily-cover`'s own artifact — no new image kind, no new renderer (R1).
- `plugins/kk/scripts/daily-stages.ts:1651` — `body`: episode scope composes the deterministic body; any other scope packages `plan.body` verbatim (R4).
- `plugins/kk/scripts/daily-stages.ts:1656-1660` — the success log names images in image order under episode scope, byte-for-byte the old line otherwise.
- `plugins/kk/workflows/kk-daily-ai-voice2.yaml:551` — voice2 passes `"episode"` as the 9th argument; no other workflow does (R1/R4).
- `plugins/kk/workflows/kk-daily-ai-voice2.yaml:527-534` — the `xhs-write` prompt now plans across the episode (card 1 the hook, one content card per plan item up to `xhs_cards − 2`, the last the closing card, `itemId` on each card) and states that the stage appends the numbered lines; the parsed prompt measures **990 chars**, inside the ADR-115 1000-char tier (asserted at `apps/cli/tests/voice2-dag.test.ts:510-515`).
- `apps/cli/tests/kk-workflow-stages.test.ts:1291-1308` — episode scope: `metadata.images` is `[card-01…card-06, 23-cover]`, exactly 7 numbered lines, line *i* carries image *i*'s `copy`/`points[0]` (the cover `本期封面`), lead first and hashtags last, body ≤ 1000 (AC1 evidence 1).
- `apps/cli/tests/kk-workflow-stages.test.ts:1321-1328` — missing cover: cards only, the log line names the missing path, exit 0 (AC1 evidence 3).
- `apps/cli/tests/kk-workflow-stages.test.ts:1344-1349` — a 980-char lead: the body trims the lead only, keeping all 7 lines and the hashtags (R2 cap).
- `apps/cli/tests/kk-workflow-stages.test.ts:1456` — the golden captured from the pre-0235 stage over the same fixture (cover present but ignored): `25-xhs/content.json` is byte-identical, so the opt-in cannot leak into voice1 (AC1 evidence 2, R4).
- `docs/04_DESIGN.md:1186` — the stage row carries the new optional `[<note_scope>]` argument, the declared image order, the deterministic body and the cap rule (T3).

**Rationale**

The pairing has to be checkable, so the body is built from the card fields the plan already carries rather than from a second LLM pass. Ordering is structural: lines and images are pushed in the same loop, and the cover is appended once, last. The whole feature rides on one trailing argument so `kk-daily-ai-voice.yaml` (which passes 8 args) stays byte-identical.

**Run-2 remediation (2026-10-10) — closes the review P3 `review-finding:d3165ae1`.**

- `apps/cli/tests/voice2-dag.test.ts:475-480` — the expected `kk stage daily-xhs-render …` substring now ends with the 9th argument `"${'$'}{vars.xhs_fallback}" "episode"`, and the test is renamed `threads the 0219 xhs_fallback opt-in and the 0235 note scope into the daily-xhs-render call` (no longer "8-arg"). Those two lines are the whole run-2 edit (2 insertions / 2 deletions).
- Negative control — the assertion now bites. With ` "episode"` surgically removed from `plugins/kk/workflows/kk-daily-ai-voice2.yaml:545`, `bun test apps/cli/tests/voice2-dag.test.ts` → 27 pass / **1 fail**, the failure being exactly this test at `apps/cli/tests/voice2-dag.test.ts:478`, `error: expect(received).toContain(expected)` / `Expected to contain: "kk stage daily-xhs-render … \"${vars.xhs_fallback}\" \"episode\""`. Pre-0235 the same revert stayed green — that is the silent regression the finding named.
- Restore is byte-exact. The YAML's sha256 is `9113cc74e61e7508eb4c87a3a53976cd881947449ec82b873954cecce2718834` both before and after the control, `cmp` against the pre-control copy is empty, and `git diff` for that file is byte-identical before and after (diff-of-diffs empty). `bun test apps/cli/tests/voice2-dag.test.ts` on the restored tree → 28 pass / 0 fail, including the renamed test.
- Caveat on the brief's literal restore check: `git diff --exit-code plugins/kk/workflows/kk-daily-ai-voice2.yaml` prints exit **1**, and already printed exit 1 *before* the control — HEAD (`a54c1f6d`) still carries the 8-arg call, so run 1's verified `"episode"` argument is the file's only difference and exit 0 would mean the fix itself had been reverted. Byte-exactness is therefore evidenced by the sha256 / `cmp` / diff-of-diffs identity above rather than by a clean diff against HEAD.
- `bun test <one file>` exits 1 on this tree even when green: bunfig's aggregate `coverageThreshold` (lines 0.9 / functions 0.9) cannot be met by a single file (37.5% funcs / 46.6% lines). Confirmed by temporarily zeroing the threshold — same 28 pass / 0 fail, exit 0; `bunfig.toml` was then restored byte-identically (`shasum -a 256` unchanged, `git diff --exit-code bunfig.toml` → exit 0). The discriminating signal for the control is therefore the pass/fail counts.
- Scope: run 2 touched no stage implementation, no workflow YAML (beyond the temporary revert it undid) and not `docs/04_DESIGN.md`.


**Anchor re-point (forced re-verify, 2026-10-09).** The `daily-stages.ts` anchors above were written before 0236's `dailyPublishXhs`/`xhsPodcastNote` insertions (`plugins/kk/scripts/daily-stages.ts:846-921`) landed in the same commit `90e45811`, shifting every 0235 line by +41; the `docs/04_DESIGN.md` stage row moved from :1184 to :1186. Line numbers re-pointed against HEAD; no code changed.

**Advisory closeout (2026-10-09, operator request "get all of them done").** The four P4 advisories from the review are resolved in the working tree:

- `itemId` is carried, not discarded: `XhsCard.itemId?` (`plugins/kk/scripts/kk-workflow-stages.ts:108`) is parsed when the card carries a non-empty string (`plugins/kk/scripts/kk-workflow-stages.ts:1063`) and recorded on the card's `cards.json` entry (`plugins/kk/scripts/daily-stages.ts:1633`); a card without one (the hook/closing cards, every voice1 card) carries no key, so voice1's `cards.json` is unchanged. Test: `apps/cli/tests/kk-workflow-stages.test.ts:1387-1411`.
- `tail > cap` no longer pays for the cards: the note is composed before the render loop (`plugins/kk/scripts/daily-stages.ts:1554-1557`), so the fail-loud branch (`plugins/kk/scripts/daily-stages.ts:1503-1508`) exits 1 with no provider call, no `cards.json` and no `content.json`. Test: `apps/cli/tests/kk-workflow-stages.test.ts:1353-1384` (six 200-char first points).
- Docs drift: `docs/04_DESIGN.md:1186` already routes voice2 to `docs/design/kk-collect-and-daily-voice2.md` §6, which describes `note_scope: episode`; voice1's `docs/design/kk-daily-ai-voice.md` §7 rightly keeps the lead-item series. The 04 row now also states the pre-render cap failure and the `itemId` record (T3).
- The voice2 prompt cap is asserted on the parsed scalar (`apps/cli/tests/voice2-dag.test.ts:510-515`, 990 ≤ 1000).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Forced re-verify 2026-10-09 against HEAD `4491347d` plus the 2026-10-09 advisory-closeout working tree. Attach order is structural: the numbered lines are built from the plan in plan order with the cover line last only when the cover exists (`plugins/kk/scripts/daily-stages.ts:1554-1556`), the render loop pushes each card's image in the same plan order (`plugins/kk/scripts/daily-stages.ts:1623`), and the cover image is appended once after the loop under the same `withCover` decision (`plugins/kk/scripts/daily-stages.ts:1640-1641`); a missing cover PNG logs `no episode cover at <path> — the note carries the <N> cards only` and stays a success (`plugins/kk/scripts/daily-stages.ts:1642-1645`). Image 1 is the typeset 3:4 card because the plan must open on role `cover` (`plugins/kk/scripts/kk-workflow-stages.ts:1044`), role restricted to cover/content/closing (`plugins/kk/scripts/kk-workflow-stages.ts:96`, `plugins/kk/scripts/kk-workflow-stages.ts:1041-1043`). Set size: `count` is refused above `XHS_MAX_CARDS`=10 (`plugins/kk/scripts/kk-workflow-stages.ts:93`, checked at `plugins/kk/scripts/daily-stages.ts:1544-1545`), so at most 11 images, inside `XHS_IMAGE_MAX`=18 (`plugins/publishings/xhs-pub/src/modes.ts:66`, re-enforced at `plugins/publishings/xhs-pub/src/modes.ts:175-180`). No new image kind: the appended path is `daily-cover`'s own `23-cover/<date>_07_cover_cover.png` (`plugins/kk/scripts/daily-stages.ts:1539`). Executable this run: `bun test apps/cli/tests/kk-workflow-stages.test.ts -t '0235 |
| R2 | MET | One numbered line per attached image, pushed in the same step as its image: `copy` + first `points` entry (`plugins/kk/scripts/daily-stages.ts:1555`); the cover line `每日AI乱炖 <date> 本期封面` (`plugins/kk/scripts/daily-stages.ts:1556`); markers `①…` (`plugins/kk/scripts/daily-stages.ts:1473-1476`); the agent body splits into lead + trailing hashtag run (`plugins/kk/scripts/daily-stages.ts:1483-1488`) and is reassembled lead → lines → hashtags (`plugins/kk/scripts/daily-stages.ts:1496-1510`). `XHS_BODY_CAP`=1000 (`plugins/kk/scripts/kk-workflow-stages.ts:95`) twins the console's `XHS_NOTE_BODY_MAX`=1000 (`plugins/publishings/xhs-pub/src/modes.ts:74`); `plan.body` is already capped at plan time (`plugins/kk/scripts/kk-workflow-stages.ts:1025-1027`). Only the lead is sliced (`plugins/kk/scripts/daily-stages.ts:1500-1501`), and a lead-less tail over the cap exits 1 (`plugins/kk/scripts/daily-stages.ts:1503-1508`); the body is composed before the render loop (`plugins/kk/scripts/daily-stages.ts:1557`), so that exit happens before any card is billed. Executable this run: 7 numbered lines (`apps/cli/tests/kk-workflow-stages.test.ts:1298`), cover line carries `本期封面` (`apps/cli/tests/kk-workflow-stages.test.ts:1303`), body ≤1000 (`apps/cli/tests/kk-workflow-stages.test.ts:1308`), the 980-char lead case keeps every line (`apps/cli/tests/kk-workflow-stages.test.ts:1349`), and the over-cap tail exits 1 with `a line is never dropped` and no provider call (`apps/cli/tests/kk-workflow-stages.test.ts:1379-1381`); 9 pass / 0 fail. |
| R3 | MET | Regression-only. The draft rail is intact: `暂存离开` heads the draft labels (`plugins/publishings/xhs-pub/src/flow.ts:67`); a draft counts only from a delta over the pre-entry baseline (`plugins/publishings/xhs-pub/src/flow.ts:278-284`) and the signal comes only from a scoped toast or that delta (`plugins/publishings/xhs-pub/src/flow.ts:294-299`). 0235 adds no xhs-pub change; the joint commit `90e45811` touches `flow.ts` only for 0236's `leavePodcastModal` comment/error string (`plugins/publishings/xhs-pub/src/flow.ts:428`); the closeout's `index.ts` change only stamps follow-up identity (`plugins/publishings/xhs-pub/src/index.ts:357`). Executable this run: `bun test plugins/publishings/xhs-pub/tests/xhs-pub.test.ts` → 112 pass / 0 fail. Not reproduced: the 2026-10-08 live 上传图文 save (operator-attended, ADR-025). |
| R4 | MET | `git diff --exit-code plugins/kk/workflows/kk-daily-ai-voice.yaml` → exit 0 this run, and `git diff --stat a54c1f6d 90e45811 -- plugins/kk/workflows/kk-daily-ai-voice.yaml` is empty, so the implementation commit never touched it; voice1 still passes 8 args (`plugins/kk/workflows/kk-daily-ai-voice.yaml:476`). The opt-in is one trailing argument: `noteScope` destructured 9th (`plugins/kk/scripts/daily-stages.ts:1525-1535`), the single value `episode` (`plugins/kk/scripts/daily-stages.ts:1467`), the decision at `plugins/kk/scripts/daily-stages.ts:1537`, the non-episode body packaged verbatim (`plugins/kk/scripts/daily-stages.ts:1557`) and the old log line kept (`plugins/kk/scripts/daily-stages.ts:1656-1660`). voice2 alone passes `"episode"` (`plugins/kk/workflows/kk-daily-ai-voice2.yaml:551`), locked by `apps/cli/tests/voice2-dag.test.ts:475-480`; byte-identity of the 8-arg path is pinned by the pre-0235 golden at `apps/cli/tests/kk-workflow-stages.test.ts:1456`. `bun test apps/cli/tests/voice2-dag.test.ts` → 32 pass / 0 fail this run. T3: the stage row carries `[<note_scope>]` at `docs/04_DESIGN.md:1186`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `bun test apps/cli/tests/kk-workflow-stages.test.ts -t '0235 |
| R1 — The 上传图文 note pairs each generated image with its text | MET | test | Feature G12 scenario R1: same executable evidence — `metadata.images` order at `apps/cli/tests/kk-workflow-stages.test.ts:1291` and the 1:1 image/line pairing at `apps/cli/tests/kk-workflow-stages.test.ts:1298-1304`, produced by `plugins/kk/scripts/daily-stages.ts:1554-1557` and `plugins/kk/scripts/daily-stages.ts:1640-1641`; voice2 wiring pinned at `apps/cli/tests/voice2-dag.test.ts:475-480` against `plugins/kk/workflows/kk-daily-ai-voice2.yaml:551`. 9 pass / 0 fail (stages) and 32 pass / 0 fail (voice2-dag) this run. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Independent re-review (native subagent, fresh context, read-only) after run 2's remediation: **Verdict PASS** — run 1's P3 resolved, no P1/P2/P3 outstanding, R1–R4 and AC1 MET on executable evidence. The reviewer's full answer lived in the run-scoped file `574d1750-9e6b-46ac-bff3-d5385cb11d8c-review-answer.txt`; it was LOST with the worktree's gitignored `.spur` plane on 2026-10-09 (task 0247 R1) and is not reconstructed — the durable record carrying the same PASS verdict and proof block is `.spur/memory/evidence/0235-verdict.json`.

| Priority | Finding | Evidence | Disposition |
| --- | --- | --- | --- |
| P1 (blocker) | None. | — | — |
| P2 (major) | None. | — | — |
| P3 (minor) | None. Run 1's P3 (the `voice2-dag` substring assertion tolerating the new 9th argument) is fixed: the assertion now requires `…"${vars.xhs_fallback}" "episode"` and the test is renamed. | `apps/cli/tests/voice2-dag.test.ts:475,479`; `plugins/kk/workflows/kk-daily-ai-voice2.yaml:551` | Resolved in run 2; negative control re-run by the host (revert → 27 pass / 1 fail at the assertion; restore → sha256 `9113cc74…` identical). |
| P4 (advisory) | The agent-emitted `itemId` is discarded, so `cards.json` records no card→plan-item mapping. | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:531`; `plugins/kk/scripts/kk-workflow-stages.ts:108`, `plugins/kk/scripts/kk-workflow-stages.ts:1063`; `plugins/kk/scripts/daily-stages.ts:1633` | FIXED 2026-10-09: `itemId` carried through `xhsPlan` into `cards.json` (absent key when the card has none); test `apps/cli/tests/kk-workflow-stages.test.ts:1387-1411`. |
| P4 (advisory) | The `tail > cap` path exits 1 after every card is paid for, leaving `cards.json` without `content.json`. | `plugins/kk/scripts/daily-stages.ts:1503-1508` | FIXED 2026-10-09: the note is composed before the render loop (`plugins/kk/scripts/daily-stages.ts:1554-1557`), so an over-cap tail exits 1 with nothing rendered; test `apps/cli/tests/kk-workflow-stages.test.ts:1353-1384`. |
| P4 (advisory) | Docs drift one hop out: the referenced design doc still describes the lead-item series. | `docs/design/kk-daily-ai-voice.md:167-174` via `docs/04_DESIGN.md:1186` | RESOLVED 2026-10-09: the 04 row routes voice2 to `docs/design/kk-collect-and-daily-voice2.md` §6 (which documents `note_scope: episode`); voice1's §7 correctly keeps the lead-item series. |
| P4 (advisory) | The voice2 prompt's ADR-115 headroom (~989/1000) is unasserted; the cap test covers voice1 only. | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:528-533`; `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:252-263` | FIXED 2026-10-09: `apps/cli/tests/voice2-dag.test.ts:510-515` asserts the parsed prompt (990 chars) ≤ 1000 and that it asks for `itemId`. |

**Residual risk.** The AC1 live-console clause (one voice2 dry run reading `publishStatus: draft` with `operation: 上传图文`, confirmed in 草稿箱 → 图文笔记 under `~/.config/kk/browser-profiles/xhs`) is an operator-attended step under ADR-025 and is **operator-deferred, recorded 2026-10-09**; it is not claimed as observed.

**Review limitation.** The reviewer context exposes no shell and no write tool: no command was executed by the reviewer (static comparison against a clean base checkout plus the recorded gate log), and this answer artifact was persisted by the host verbatim from the reviewer's report. The host re-ran the targeted tests and the negative control, and confirmed the aggregate gate receipt (`0235-check-receipt.json`, `proofDigest = sha256:98ff06aa…`) belongs to this run — the receipt file itself was LOST with the worktree on 2026-10-09 (task 0247 R1); the digest it named is preserved in the durable verdict record's proof block.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-09T18:15:57.678Z backlog → todo (system)
- 2026-10-10T00:29:55.213Z todo → wip (system)
- 2026-10-10T00:53:04.009Z wip → testing (system)
- 2026-10-10T00:59:31.585Z testing → wip (system)
- 2026-10-10T01:12:22.133Z wip → testing (system)
- 2026-10-10T01:12:34.191Z testing → done (system)

