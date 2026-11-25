---
schema_version: 1
name: LinkedIn post rail cannot open the composer from a signed-in profile
status: done
template: issue
created_at: 2026-11-25T06:53:01.883Z
updated_at: "2026-11-25T22:52:15.683Z"
feature_id: L3

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 5
done_forced: "false"
done_reason: unforced close
---

## 0437. LinkedIn post rail cannot open the composer from a signed-in profile

### Background

2026-11-24 dogfood, the last blocker on the LinkedIn promo row. With a freshly signed-in profile the
publish preflight now verifies (after the headed-preflight and 90 s budget fixes), and the send gets all
the way to the composer step, where it fails:

```
{"status":"uncertain","effect":"unknown",
 "error":"linkedin composer did not open after the share box, twice (selector drift) — run: bun plugins/publishings/linkedin-pub/src/profile-check.ts login"}
```

`.works/kk-news-generate/20261124/4-publish/receipts/linkedin-pub.post.json` (attemptId `retry-1`).

This is the same "trigger click does not reliably open the composer" note from 2026-11-16, never fixed:
the 2026-11-16 redesign left the share trigger as a classless div whose text is `Start a post`, the share
surface is NOT a `[role="dialog"]`, and the editor is a tiptap/ProseMirror `div[role="textbox"]` that
needs real key events. `runPostFlow` clicks the trigger, waits for the composer, retries once, then fails
with this message — so either the click misses the actual trigger element, or the composer appears in a
container the rail does not look in.

Fixing it needs one focused headed session with the same recording method used for the 2026-11-16 social
rails (`kkBrowserLauncher` headed + click/keystroke recorder + screenshots); the operator can sign in, and
each failed attempt clears `li_at`, so the recon must run inside one session.

**Refine corrections (2026-11-25)**

- "the 2026-11-16 note … never fixed" → after 2026-11-16, commits `c354c7d6`/`540e37c3` (2026-11-20) changed the trigger list to the `:has-text` forms, and `20457d63` (2026-11-21) added the shorter first wait plus one re-resolved retry click. That commit records a live success: `'linkedin post published live … (success-toast receipt)'`. `98e7a4fc`/`72a5bfc7` (2026-11-21/22) then added the cover upload and the link-preview wait → this is a **regression after a working state**, not a defect that was never fixed. The recon diffs the live DOM against the 2026-11-20/21 shape recorded in `plugins/publishings/linkedin-pub/src/index.ts:80-119`.
- "2026-11-24 dogfood" → the composer failure is `publish-events.jsonl` 2026-11-25T06:35:08Z (2026-11-24 evening PT), the first attempt after `77b3f56b` (headed 90 s preflight) let the preflight pass. The earlier 2026-11-24/25 attempts were preflight refusals (`headless/headed linkedin readiness refused … 18000ms`), not composer failures. The receipt path and `attemptId: retry-1` are confirmed.
- New, same failure: the receipt says `status: uncertain, effect: unknown` for a refusal at the `composer` stage, **before any Post click**. `stageFail` (`index.ts:157-164`) never emits `metadata.itcDelivery.effect: 'none'`, so `publish-core.ts:626-636` defaults every linkedin pre-submit refusal to `unknown`. Each one then blocks resend until an operator passes `--confirm-none` (`publish-core.ts:490-506`). weibo-pub, wechatmp-pub, medium-pub and shipinhao-pub already emit `effect: 'none'` for pre-submit refusals. Added as R4.
- Code facts confirmed in the current tree: `resolveSelector` (`packages/publish-harness/src/browser.ts:1051-1072`) resolves **attached** nodes (`visible: false`), and `runPostFlow` clicks `.first()` of whichever trigger selector resolved (`index.ts:469-483`). A hidden or duplicate first `:has-text("Start a post")` match is therefore clickable-in-principle but opens nothing. The first click is not wrapped in try/catch, so a click that threw would have surfaced a Playwright error, not this message. That means a click landed and no composer candidate (attached, any visibility) appeared within 15 s + 10 s + the step timeout.

### Requirements

- [x] R1. With an authenticated profile, clicking the feed's share trigger must open the composer and the post must complete: `linkedin-pub.post` reaches `succeeded/confirmed`.
- [x] R2. The composer wait must name the surface it looked for and what it actually found (element counts/URL) instead of a generic "did not open", so the next drift is diagnosable without a live session.
- [x] R3. A test pins the composer-open step against the measured DOM shape (recorded fixture), so a selector change fails the suite rather than the daily run.
- [x] R4. Every linkedin-pub refusal raised before the Post click (`share-trigger`, `composer`, `text-readback`, media/upload stages before submit) carries `metadata.itcDelivery: { schemaVersion: 1, effect: 'none' }`, so its receipt is `failed/none` and `--retry` resends it without `--confirm-none`. Refusals at or after the Post click keep `effect: unknown`.

Out of scope: the session/login preflight (0431, `77b3f56b`), the X/Threads rails, the link-preview and cover-upload stages unless the recon shows they changed with the same redesign, and any change to `resolveSelector` in `publish-harness` (shared by every rail).

### Acceptance Criteria

```gherkin
Scenario: AC1 — the promo post completes from an authenticated profile (req: R1)
Given a signed-in LinkedIn profile
When `kk news publish-send` dispatches the `linkedin-pub.post` row
Then the receipt is `succeeded/confirmed` with a fresh post link

Scenario: AC2 — a composer that never opens explains itself (req: R2)
Given a share trigger that opens nothing
Then the refusal names the trigger selector, the composer candidates and their observed counts

Scenario: AC3 — the recorded DOM opens the composer through the production flow (req: R3)
Given the real-Chromium fixture runner serving the recorded LinkedIn feed + composer DOM on https://www.linkedin.com with every other request aborted
When the production `runPostFlow` clicks the share trigger
Then the composer resolves and the flow reaches the text-readback stage
And swapping the fixture's trigger for the pre-recon shape makes the test fail at stage `composer`

Scenario: AC4 — a pre-submit refusal is retryable (req: R4)
Given the fake launcher with `composerNeverOpens: true`
When the transport publishes
Then the Result carries `metadata.stage: 'composer'` and `metadata.itcDelivery.effect: 'none'`
And a refusal after the Post click (`sendNeverEnabled` or an unobserved outcome) carries no `effect: 'none'`
```

Test layers: AC1 is a live operator-run check (needs the operator's signed-in profile and the explicit go-ahead for a public post). AC2 and AC4 are `plugins/publishings/linkedin-pub/tests/linkedin-pub.test.ts` (fake page; extend the existing `composerNeverOpens` case at `:585`). AC3 is a new `plugins/publishings/linkedin-pub/tests/linkedin-pub-dom.test.ts` + `tests/fixtures/linkedin-pub-dom-runner.ts`, following the bilibili/cnblogs runner pattern (`plugins/publishings/bilibili-pub/tests/fixtures/bilibili-pub-dom-runner.ts`). The fake-page test cannot observe R3: it answers every selector in the list with 1.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-11-25T21:37:26.733Z

- **Q: Fix the selectors from code reading alone, or recon first?** Closed: recon first. The 2026-11-21 selectors posted live, so the failing shape is new and cannot be read from the tree. Hypotheses to settle, cheapest first: (H1) the first attached `:has-text("Start a post")` match is a hidden or duplicate node, because `resolveSelector` does not require visibility (the same trap Threads hit: `memory.md` 2026-11-16, hidden duplicate "New thread"); (H2) the composer now mounts in a container the composer list cannot reach (iframe or shadow root) or with a new editor shape; (H3) both clicks still land before hydration.
- **Q: Fold the `effect: none` classification (R4) into this task?** Closed: yes. It is the same rail and the same failure, it reuses the existing `itcDelivery` mechanism, and no other task owns it (searched `docs/tasks` for linkedin + itcDelivery: none).
- **Q: Who runs AC1?** Closed: the operator. The check makes a public post (an external publish) and needs the operator's sign-in; each failed attempt clears `li_at`, so recon and AC1 share one headed session. The implementer prepares everything else offline and asks before the live post.

#### Q&A entry — 2026-11-25T22:51:37.625Z

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-11-25T21:37:26.733Z

- **Q: Fix the selectors from code reading alone, or recon first?** Closed: recon first. The 2026-11-21 selectors posted live, so the failing shape is new and cannot be read from the tree. Hypotheses to settle, cheapest first: (H1) the first attached `:has-text("Start a post")` match is a hidden or duplicate node, because `resolveSelector` does not require visibility (the same trap Threads hit: `memory.md` 2026-11-16, hidden duplicate "New thread"); (H2) the composer now mounts in a container the composer list cannot reach (iframe or shadow root) or with a new editor shape; (H3) both clicks still land before hydration.
- **Q: Fold the `effect: none` classification (R4) into this task?** Closed: yes. It is the same rail and the same failure, it reuses the existing `itcDelivery` mechanism, and no other task owns it (searched `docs/tasks` for linkedin + itcDelivery: none).
- **Q: Who runs AC1?** Closed: the operator. The check makes a public post (an external publish) and needs the operator's sign-in; each failed attempt clears `li_at`, so recon and AC1 share one headed session. The implementer prepares everything else offline and asks before the live post.


#### Q&A entry — 2026-11-25 (close-out)

- **Q: Close 0437 without the AC1 live public post?** Closed by the operator: yes ("At least we should update task 0437 as done"). AC1 is recorded N/A (operator-deferred) and is not claimed MET. The live proof falls to the next real `kk news publish-send` of a `linkedin-pub.post` row. If it refuses at `composer`, the refusal now carries `composerProbe` counts, a screenshot at `/tmp/kk-linkedin-composer-latest.png` and `effect: none`, so `--retry` resends it without `--confirm-none`.

### Design

**WHAT.** Re-measure the share-trigger → composer transition on today's LinkedIn feed. Update `LINKEDIN_POST_SELECTORS.shareTrigger` / `.composer` (and how the trigger is clicked) to the measured shape. Make the composer refusal diagnostic, pin the step with a recorded-DOM fixture, and classify pre-submit refusals as `effect: none`.

**WHY.** The rail posted live on 2026-11-21 and fails at the composer on 2026-11-25. A selector list that matches attached-but-hidden nodes, plus a refusal that names nothing it observed, made the drift invisible until the daily run. The `unknown` effect turns each such pre-submit refusal into an operator `--confirm-none` chore.

**WHERE (primary targets).**
- `plugins/publishings/linkedin-pub/src/index.ts`: `LINKEDIN_POST_SELECTORS` (`:80-119`), `runPostFlow` share/composer block (`:466-515`), `stageFail` (`:157-164`).
- `plugins/publishings/linkedin-pub/tests/linkedin-pub.test.ts`: composer refusal case (`:585-592`) and new effect assertions.
- New: `plugins/publishings/linkedin-pub/tests/linkedin-pub-dom.test.ts` and `tests/fixtures/linkedin-pub-dom-runner.ts`.
- Recon artifacts: `.spur/run/dogfood/2026-11-25-linkedin/` (events.jsonl, screenshots, a sanitized DOM excerpt of the trigger and the opened composer). No cookies, `li_at` or profile data ever enter the excerpt or the fixture.

**Frozen names.**
- Stage ids stay `share-trigger` / `composer`. The refusal message keeps the prefix `linkedin composer did not open after the share box` (existing test `:591` and operators grep for it), then appends `— trigger <selector> (matches N, visible M); composer candidates <selector>=<count>, …; url <url>; frames <n>`, bounded by `boundedDetail` (300 chars, so put the counts before the login hint).
- A screenshot on composer refusal goes to `/tmp/kk-linkedin-composer-latest.png`, mirroring the existing send-stage `/tmp/kk-linkedin-send-latest.png` (`:595`).
- R4: a local helper (e.g. `preSubmitFail`) that wraps `stageFail` and adds `itcDelivery: { schemaVersion: 1, effect: 'none' }`, the same metadata shape as `plugins/publishings/weibo-pub/src/index.ts:146`. The plugin result contract is unchanged; no new API.

**Algorithm (trigger click).** Prefer a **visible** trigger: resolve, then click `locator(sel).filter({ visible: true }).first()` or the role/text engine, whichever the recon proves opens the composer. Do not change `resolveSelector` in `publish-harness`: every rail shares it. Keep the one retry. If the recon shows an iframe/shadow composer, scope the composer lookup to that frame and record the measured path in the selector comment with its date.

**Anti-patterns.**
- No selector edits without a recorded headed observation; every changed entry carries a `Measured 2026-11-2x:` comment like its neighbours.
- No blanket `force: true` clicks: they hide the hidden-duplicate bug instead of fixing it.
- No longer sleeps or more retries as the fix. Timing (H3) is accepted only if the recon reproduces it.
- Never classify a refusal raised after the Post click as `effect: none`.
- No DOM dump, cookie or token in a Result or a fixture (`boundedDetail` stays).

**Dependencies / handoffs.** None in `dependencies[]`. Assumes 0431/`77b3f56b` (headed 90 s preflight) as shipped. After landing, follow the AGENTS.md rule for plugin edits: plugins resolve from the checkout, so no install re-sync is needed for `plugins/publishings/*`. The scheduled run picks the change up through the project root.

### Plan

0. Preconditions: `proto trust .prototools`; `bunx playwright install chromium` is present (the DOM runner needs it); `git worktree list` / `spur task list --status wip` show no other edit to `plugins/publishings/linkedin-pub/` (clean on 2026-11-25).
1. **R4 first (offline, test-first).** Add the AC4 assertions to `linkedin-pub.test.ts` and watch them fail, then route every pre-Post `stageFail` through the `effect: 'none'` helper. Confirm with the fake launcher that `sendNeverEnabled` and the unobserved-outcome cases still carry no `effect: none`.
2. **R2 (offline, test-first).** Extend the `composerNeverOpens` test to expect the trigger selector, the per-candidate counts and the URL in the error. Then implement a bounded `page.evaluate` probe that counts the trigger matches (total/visible), each composer candidate, iframes and the URL, plus the screenshot.
3. **Recon (operator, one headed session).** Launch `kkBrowserLauncher` headed on `~/.config/kk/browser-profiles/linkedin` with the click/keystroke recorder used for the 2026-11-16 rails. The operator signs in if needed. Record: every element matching each `shareTrigger` entry (visible?, tag, role, aria-label), what the operator actually clicks, and the opened composer's container/editor/Post path (frame? shadow?). Save events, screenshots and a sanitized DOM excerpt under `.spur/run/dogfood/2026-11-25-linkedin/`. Write the confirmed hypothesis (H1/H2/H3) into `### Root Cause` with `file:line` evidence.
4. **R1 fix.** Update `shareTrigger`/`composer` and the click to the measured shape, with dated comments.
5. **R3.** Build the DOM fixture runner from the sanitized excerpt (route interception on https://www.linkedin.com, catch-all abort, no live writes). Assert that the production `runPostFlow` opens the composer and reaches readback. Then assert that the pre-recon trigger shape fails at `composer` (fail-first evidence recorded in `### Testing`).
6. **AC1 (operator go-ahead required: public post).** In the same session as step 3 if possible, run `kk news publish-send` for the `linkedin-pub.post` row (`--retry`; after R4, no `--confirm-none` is needed for an `effect: none` prior). Record the receipt `succeeded/confirmed` and the post URL.
7. Gates: `bun test plugins/publishings/linkedin-pub` (judge single-file runs by pass/fail), then `bun run lint`, `bun run test`, `bun run build`. Record a `.spur/context/memory.md` entry with the measured shape.

### Root Cause

**Measured 2026-11-25 (headed recon, freshly signed-in profile; sanitized artifacts in `.spur/run/dogfood/2026-11-25-linkedin/`).**

The 06:35Z refusal does not reproduce with a valid session:
- `button:has-text("Start a post")` now matches 0 nodes.
- The one visible trigger is `div[role=button][aria-label="Start a post"]`, which the list's `div[role="button"]:has-text(...)` entry already reached.
- Its click mounts a tiptap `div[role=textbox][contenteditable=true].tiptap.ProseMirror` outside any `[role=dialog]`. Four composer candidates each matched 1 visible node. No iframe or shadow-root editor (H2 rejected). Hydration was not a factor in the recon (H3 not observed).

The 06:35Z failure is therefore attributed to the degraded session that day: anti-bot frames were present, and each failed attempt cleared `li_at`. This cannot be re-measured after the fact.

H1 is real but latent: `resolveSelector` resolves attached nodes, so a hidden duplicate trigger wins and the click hangs 30 s with no stage. The real-DOM fixture reproduces it against HEAD `29a2fc21`; the fix (visible-only clicks, measured aria trigger first) removes it.

### Solution

**R1–R4 landed offline (2026-11-25); AC1 (live public post) waits on the operator's go-ahead.**

**Root cause.** A headed recon in the freshly signed-in profile (`.spur/run/dogfood/2026-11-25-linkedin/`; sanitized structure only, no text, cookie or token) did not reproduce the 2026-11-25T06:35Z refusal:
- `button:has-text("Start a post")` (list `[0]`) now matches **0** nodes.
- `div[role="button"]:has-text(...)` matches the one visible trigger, `div[role=button][aria-label="Start a post"]`.
- Its click mounts a tiptap `div[role=textbox][contenteditable=true].tiptap.ProseMirror`, outside any `[role=dialog]`; four composer candidates each found 1 visible node.

So the 06:35Z run's selectors were valid. Its failure is consistent with the degraded session the same day (anti-bot frames present; each failed attempt cleared `li_at`), which cannot be measured after the fact. The defect R1 removes is H1, demonstrated in the fixture: `resolveSelector` resolves **attached** nodes, so a hidden duplicate trigger resolves first and the click hangs 30 s, then fails with no stage and `effect: unknown`.

**Changes (`plugins/publishings/linkedin-pub/src/index.ts`):**
- R1: the measured `div[role="button"][aria-label="Start a post"]` leads the trigger list (`:91`, dated comment). Both trigger clicks use `.filter({ visible: true }).first()` (`:526`, retry `:546`). The duplicate composer selector is removed. `resolveSelector` in publish-harness is unchanged.
- R2: `probeComposer` adds the trigger match/visible counts, per-candidate counts, the url and the frame count to the composer refusal. It writes `/tmp/kk-linkedin-composer-latest.png` and fills `metadata.composerProbe`.
- R4: `preSubmitFail` covers share-trigger, composer, text-readback and image-upload (`effect: none`). Stages at or after the Post click keep `unknown`.

**Tests:**
- `tests/linkedin-pub.test.ts`: AC2 and AC4 (fake page, which gains an identity `filter`).
- `tests/linkedin-pub-dom.test.ts` + `tests/fixtures/linkedin-pub-dom-runner.ts` (AC3): real Chromium, route-intercepted https://www.linkedin.com, catch-all abort.
  - `recorded` → ok, fresh activity URL.
  - `hidden-duplicate` → ok.
  - `pre-recon` → `stage: composer`, `effect: none`, probe counts.
  - Missing Chromium fails loud.
- Fail-first against HEAD `29a2fc21`: `hidden-duplicate` failed (`click: Timeout 30000ms exceeded … button:has-text("Start a post")`, no stage); `recorded` passed on both, since the live DOM works with a valid session.

**Gates:** `bun test plugins/publishings/linkedin-pub` 56/56; `bun run lint` 0; `bun run test` 0 (5928 pass, 0 fail; `index.ts` 90.24 % lines / 95.15 % funcs); `bun run build` 0; rule pre-check 60/60, post-check 3/3. Install sync is not needed: `plugins/publishings/*` resolve from the checkout.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | The trigger list leads with the measured `div[role="button"][aria-label="Start a post"]` (`plugins/publishings/linkedin-pub/src/index.ts:91`), and both clicks are visible-only (`plugins/publishings/linkedin-pub/src/index.ts:526`, `plugins/publishings/linkedin-pub/src/index.ts:546`). The production transport posts end to end on the measured DOM (`plugins/publishings/linkedin-pub/tests/linkedin-pub-dom.test.ts:40`), including with a hidden duplicate trigger (`plugins/publishings/linkedin-pub/tests/linkedin-pub-dom.test.ts:45`). The 2026-11-25 headed recon opened the composer from the signed-in profile (`.spur/run/dogfood/2026-11-25-linkedin/02-after-click.png`). The live receipt is operator-deferred (see AC1). |
| R2 | MET | `probeComposer` (`plugins/publishings/linkedin-pub/src/index.ts:183`) feeds the composer refusal with the trigger, match/visible counts, per-candidate counts, url and frame count (`plugins/publishings/linkedin-pub/src/index.ts:565`). Asserted by `plugins/publishings/linkedin-pub/tests/linkedin-pub.test.ts:607`. |
| R3 | MET | Real-Chromium fixture `plugins/publishings/linkedin-pub/tests/fixtures/linkedin-pub-dom-runner.ts:1` and guard test `plugins/publishings/linkedin-pub/tests/linkedin-pub-dom.test.ts:49`. The hidden-duplicate scenario failed against HEAD 29a2fc21 (`click: Timeout 30000ms exceeded`) and passes now. |
| R4 | MET | `preSubmitFail` sets `itcDelivery: { schemaVersion: 1, effect: 'none' }` (`plugins/publishings/linkedin-pub/src/index.ts:174`) on share-trigger, composer, text-readback and image-upload refusals. Post-click stages stay plain. Asserted by `plugins/publishings/linkedin-pub/tests/linkedin-pub.test.ts:780`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — the promo post completes from an authenticated profile (req: R1) | N/A | manual-review | Operator-deferred on 2026-11-25: the operator chose to close without the public post (task Q&A close-out entry). Not claimed MET. The next real `kk news publish-send` of `linkedin-pub.post` is the live proof. The offline equivalent passes at `plugins/publishings/linkedin-pub/tests/linkedin-pub-dom.test.ts:40`. |
| Scenario: AC2 — a composer that never opens explains itself (req: R2) | MET | test | `plugins/publishings/linkedin-pub/tests/linkedin-pub.test.ts:607` |
| Scenario: AC3 — the recorded DOM opens the composer through the production flow (req: R3) | MET | test | `plugins/publishings/linkedin-pub/tests/linkedin-pub-dom.test.ts:40` (recorded → ok); `plugins/publishings/linkedin-pub/tests/linkedin-pub-dom.test.ts:49` (pre-recon → stage composer, effect none); `plugins/publishings/linkedin-pub/tests/linkedin-pub-dom.test.ts:34` (missing Chromium fails loud) |
| Scenario: AC4 — a pre-submit refusal is retryable (req: R4) | MET | test | `plugins/publishings/linkedin-pub/tests/linkedin-pub.test.ts:780` (four pre-submit stages carry effect none; send-enabled and confirmation carry none) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Receipt: `.works/kk-news-generate/20261124/4-publish/receipts/linkedin-pub.post.json` (`attemptId: retry-1`). Aggregate: `.works/kk-news-generate/20261124/4-publish/fanout-result.linkedin-pub.post.retry.json`. Event timeline: `.works/kk-news-generate/20261124/4-publish/publish-events.jsonl` (composer failure at 2026-11-25T06:35:08Z)
- Flow: `plugins/publishings/linkedin-pub/src/index.ts` → `LINKEDIN_POST_SELECTORS` `:80-119`, `runPostFlow` `:459-515`, `stageFail` `:157-164`
- Selector resolution: `packages/publish-harness/src/browser.ts:1051-1072` (`resolveSelector`, attached-only)
- Effect derivation: `apps/cli/src/publish-core.ts:621-650`; resend guard `:490-506`; precedent `plugins/publishings/weibo-pub/src/index.ts:146`
- Working-state commits: `c354c7d6`, `540e37c3` (2026-11-20), `20457d63` (2026-11-21, live success), `98e7a4fc`, `72a5bfc7`; preflight `456357bc`, `77b3f56b`
- Prior measurement: `.spur/context/memory.md` 2026-11-16 social-rails entry (LinkedIn redesign + the Threads hidden-duplicate trap); task `0431` (session checks)
- DOM-fixture pattern: `plugins/publishings/bilibili-pub/tests/fixtures/bilibili-pub-dom-runner.ts`, `plugins/publishings/cnblogs-pub/tests/cnblogs-pub-dom.test.ts`
- Same class of defect fixed for the other rails with a recorded headed recon (`docs/design/weibo-ui-discovery.md` pattern)

### History

- 2026-11-25T22:29:06.588Z todo → wip (system)
- 2026-11-25T22:52:09.783Z wip → testing (system)
- 2026-11-25T22:52:15.554Z testing → done (system)

