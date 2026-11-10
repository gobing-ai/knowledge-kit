---
schema_version: 1
name: "xhs-pub: adopt vendor-proven patterns (outcome verification, counter limits, draft verify) and close composePodcast gap"
status: backlog
template: standard
created_at: 2026-11-10T22:48:43.838Z
updated_at: "2026-11-10T22:49:54.126Z"

---

## 0350. xhs-pub: adopt vendor-proven patterns (outcome verification, counter limits, draft verify) and close composePodcast gap

### Background

The 2026-11-09/10 dogfood cycle surfaced four xhs-pub gaps: (1) save success was judged by
client-side counters, not server responses; (2) title/body limits were pre-counted instead of
read from XHS's own counters (podcast editor `0/1000`); (3) broken drafts persisted silently —
nothing re-verified a draft after save; (4) `composePodcast` never types title/body/合集,
so every daily podcast draft needed a manual repair pass.

Robin supplied an external reference implementation at `vendors/xiaohongshu-skills`
(Python + CDP + extension bridge). Study shows convergent discoveries (same closed-shadow
`<xhs-publish-btn>` host, dispatchEvent trigger) that validate our approach, plus clearly
better patterns worth porting into our architecture. Our direction is unchanged: kk plugin
transport, flow.ts stages, durable-src waits, ADR-022 launch-only. This task ports the vendor's
stronger verification/limit patterns into that direction and closes the podcast compose gap.

### Requirements

- [ ] R1. Save/publish outcome verification: replace counter/stamp-only confirmation with server-response capture — inject layered response observation (XHR + fetch + console + DOM toast, content-signature matching for note_id / HTTPBizError / -913x risk codes), map codes to typed errors (PublishError, AccountRiskControlError), keep sentinel-string evaluate contracts (kk-* sentinels) so fakes cannot false-positive.
- [ ] R2. Platform-counter-based limit validation: read XHS's own counters as ground truth — title `div.title-container div.max_suffix` (UTF-16-aware cap 20: 2 half-width chars = 1) and body length error/counter elements (podcast editor 0/1000) — raise typed TitleTooLongError / ContentTooLongError before any save, instead of pre-counting client-side.
- [ ] R3. verifyDraft post-save stage: reopen the saved draft and assert observable persistence — expected slot count, all img srcs durable (`https:` scheme; never naturalWidth), title/body length, 合集 badge — egress-independent; loud typed failure naming the violated assertion.
- [ ] R4. composePodcast completeness: type title, mechanically derive podcast-note body ≤1000 chars (intro + `·` headlines + closing, counter-verified via R2), and select 合集 (咸话咸说之每日AI乱炖) — no manual repair pass needed for daily podcast drafts.
- [ ] R5. Architecture preservation (constraint, not work): keep Playwright + kkBrowserLauncher + persistent profile transport, closed-shadow host-method save (`invokeHostSave` first, click fallback), and durable-src thumbnail wait — vendor's Python/CDP/extension-bridge transport is reference only; its count-based upload wait is explicitly NOT adopted (weaker than the 2026-11-10 fix).

### Acceptance Criteria

- [ ] AC1 — a draft save whose server response carries a business error code (incl. -913x risk control) fails with the mapped typed error, and a note_id-bearing success is confirmed from the observed response, not client-side counters only `(req: R1)`
- [ ] AC2 — a title/body exceeding the platform counter limit is rejected before save with a typed error quoting the counter text observed in the DOM `(req: R2)`
- [ ] AC3 — verifyDraft reopens a just-saved draft and fails loudly when any slot lacks a durable `https:` src or expected metadata is absent; it passes against the repaired 2026-11-09 drafts' shape (7 durable slots / podcast title+body+合集) `(req: R3)`
- [ ] AC4 — composePodcast output carries non-empty title, a counter-verified ≤1000-char body, and the collection selection, so a generated podcast draft needs no manual repair `(req: R4)`
- [ ] AC5 — regression suite covers the new paths; existing `thumbnail count:` error prefix and host-save (`_onSave` / `shadow-host-method`) contracts stay green `(req: R1, R2, R3, R4)`

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Vendor reference map — `vendors/xiaohongshu-skills` (Python + CDP + extension bridge).
Keep our direction (kk plugin, Playwright transport, flow.ts stages, spur workflow orchestration,
ADR-022 launch-only). Adopt patterns; reject transports.

- **Adopt — publish outcome capture (R1).** `scripts/xhs/publish.py` `click_publish_button` (~:117–260): XHS wraps publish/save in `<xhs-publish-btn>` closed shadow DOM and fires a `publish` CustomEvent on the host — the same host we invoke `_onSave` on (convergent discovery, validates `invokeHostSave`). Their outcome verification is strictly stronger than ours: inject layered response observation — (1) XHR `loadend` hook, (2) fetch wrapper, (3) console.error hook, (4) DOM toast observer — matching on response body content signatures (`"note_id"` success, `HTTPBizError`, `-913x` risk codes, 禁止发笔记) rather than URL patterns (XHS nests its own interceptors; URL patterns are unreliable). First-wins capture into a single window var; poll after dispatch. Port to flow.ts save/publish steps: dispatch host method → poll captured outcome → typed error or `{ok, noteId, code}` receipt. Keep sentinel-string evaluate contracts so the test fake cannot false-positive (`XhsLocator.evaluate` is expression-string only, page.ts:74).
- **Adopt — platform counters as ground truth (R2).** `scripts/xhs/selectors.py` publish-page block + `_check_title_max_length` (:616) / `_check_content_max_length`: read `div.title-container div.max_suffix` ("5/20") and the body `length-error` element after typing instead of pre-counting client-side. Title cap is UTF-16-aware 20 units (2 half-width chars = 1; documented in `skills/xhs-publish/SKILL.md`). This directly serves composePodcast (podcast editor counter `0/1000`): type the derived body, then read the counter — the platform, not our arithmetic, decides pass/fail.
- **Adopt — verifyDraft (R3) — ours, informed by theirs.** Their verify is response-capture-only; a draft pipeline needs reopen-and-assert persistence (the 2026-11-09 incident shipped drafts that "saved" client-side but carried broken states). Post-save: 草稿箱 → draft → 编辑 → assert slots, durable srcs, title/body, 合集; fail loud with the violated assertion. Egress-independent by design (src scheme; naturalWidth is geo-broken — see pitfalls 2026-11-10).
- **Keep (already ≥ vendor) — do NOT regress.** Durable-src thumbnail wait (their `_wait_for_upload_complete` :477 is count-based `IMAGE_PREVIEW` count ≥ expected — exactly the bug class we fixed on 2026-11-10). Host-method save first with coordinate-click fallback. Playwright + persistent profile + kk bot session lifecycle (their extension WebSocket bridge / direct-CDP dual transport is an alternative, not an upgrade).
- **Reference only — different threat model.** `scripts/xhs/human.py` (humanized delays/scroll), `risk_analyzer.py` + `extension/netlogger.js` (NetLog risk-control forensics, `-9136` = 账号风控). Useful evidence if a daily run ever trips risk control; not adopted now (one run/day, low frequency). Long-article mode, scheduled publish, visibility, original declaration, tags input (`_input_tags` Quill `#`-trigger flow, :639), video publish, explore/interact — catalogued as future capability surface; out of scope for this task.
- **Wiring.** Script side: flow.ts (`plugins/publishings/xhs-pub/src/flow.ts`) — capture layers, typed errors, counter checks, verifyDraft, composePodcast body/title/合集; tests extend the existing FakeState / fake-evaluate harness (sentinel handlers). Workflow side: daily-publish3 / voice3 xhs tier gains verifyDraft after send (post-save reopen) so broken drafts fail the tier instead of surfacing in the console days later. Skill side: `kk-publish` note update — draft → verify → launch sequence mirrors the vendor's fill → confirm → publish two-step, which is the same gate as ADR-022.

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
