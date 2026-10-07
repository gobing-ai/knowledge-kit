---
schema_version: 1
name: "Operator dogfood for infoq-pub: profile-check login -> check -> one draft run; re-measure EDITOR_URL/selectors/draft signal"
status: done
template: issue
created_at: 2026-10-05T13:41:38.183Z
updated_at: "2026-10-07T05:29:27.300Z"
feature_id: E91

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0191-verdict.json
---

## 0191. Operator dogfood for infoq-pub: profile-check login -> check -> one draft run; re-measure EDITOR_URL/selectors/draft signal

### Background

Captured from the creation title: "Operator dogfood for infoq-pub: profile-check login -> check -> one draft run; re-measure EDITOR_URL/selectors/draft signal".

### Requirements

- [x] R1. Dogfood the infoq profile session on the existing operator profile (`~/.config/kk/browser-profiles/infoq`): `profile-check.ts login` resolves verified, then `profile-check.ts check` reports `verified`; both outcomes recorded. — Done this run: operator WeChat-QR login persisted the profile; official `profile-check.ts check` returned `verified` in 6.7 s (run log `.spur/memory/runs/runall-e91-8a7d8e-0191.md`; verdict answer R1).
- [x] R2. Re-measure the live authenticated editor contract (headed only — headless is WAF-blocked, 0201): entry URL constant, title/summary/body selectors, the draft save affordance, the draft-saved signal, and the login/SSO URL pattern; drift against the plugin constants recorded per item. — Done: drift recorded per item (Design change map) plus this run's three fresh measurements (headed hydration tail 2.5–35 s; save-status autosave indicator; pasteHtml input-event gap) with fixes pinned in suites.
- [x] R3. Run exactly one draft-only publish through the real `InfoqBrowserTransport` (plugin CLI) with an observed draft signal; no publish/submit control is ever activated. — Done: draft 405967 created and saved via `kk executor run infoq-pub` with the 已保存 signal observed (`.spur/run/0191-dogfood-result.json`); draft-only end to end.
- [x] R4. Every measured-stale value is corrected in the plugin source and pinned by the plugin tests (`plugins/publishings/infoq-pub/tests/infoq-pub.test.ts`). — Done: change map corrected to current line numbers; suites green (46 + 26 pass / 0 fail this run; full gate 1953 pass).

### Acceptance Criteria

```gherkin
`ac_altitude: task-local`
`ac_numbering: task-local`

Scenario: AC1 — profile session dogfood on the operator profile
Given the existing operator profile `~/.config/kk/browser-profiles/infoq`
When `bun plugins/publishings/infoq-pub/src/profile-check.ts login` then `… check` run against it
Then login exits 0 with a verified session and check exits 0 reporting `status: "verified"` (req: R1)

Scenario: AC2 — measured drift corrected and recorded
Given the live headed walk of xie.infoq.cn home → editor → autosave
When each measured value (entry URL, title/summary/body selectors, draft affordance + signal, SSO URL pattern) is compared with the plugin constants
Then every stale constant is corrected in `plugins/publishings/infoq-pub/src/index.ts`, pinned in the plugin tests, and the measured values are recorded in this task's Plan/Solution (req: R2, R4)

Scenario: AC3 — one draft-only run through the real transport
Given the corrected plugin source and the verified operator profile
When `bun plugins/publishings/infoq-pub/src/index.ts --in <content> --out <result>` runs once with draft-only content
Then the result JSON reports `ok: true` with draft evidence (draft id / saved indicator), and no submit/发布 control is activated at any point (req: R3)
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

- [x] 0. Locate the stale constants and their consumers. — `EDITOR_URL = 'https://xie.infoq.cn/write'` was the pre-0201 entry; 0201 measured `/write` dead (404 even authenticated) and no external module imports it, so it was renamed rather than patched (src/index.ts:42).
- [x] 1. Re-measure the live console headed (0191 walk). — Home write-entry button text drifted 立即创作 → **写点什么** (`div.write-btn` retained); `/write` still dead; operator session **expired** since 0201 (header shows 登录注册); logged-out 写点什么 opens a 创作场景 dialog funneling to login; headless re-confirmed WAF 451 (headed-only); SSO domain account.geekbang.org.
- [x] 2. Correct the source to the measured contract. — Entry flow: home `div.write-btn` → server-side draft `/draft/<id>` (DRAFT_URL_RE) → 知道了 notice dismissal → title → ProseMirror paste → autosave 已保存 signal; submit control `div.submit-btn` only for public; summary field + 保存草稿 button removed (measured absent); logged-out marker (visible 登录) added to the readiness predicate; preflight keeps the harness headed fallback because headless can never pass the WAF.
- [x] 3. Pin the measured contract in tests. — Frozen-surface table (entry/notice/title/body/live + summary/draft absent), readiness (login URL, non-hydrated home, logged-out marker), draft flow (entry URL change, no live click, summary ignored, 0195 body-signal regression, entry/autosave timeouts), live switch, session-refusal paths (missing profile, headless-451 headed fallback, expiry), profile precedence, headless opt-in.
- [x] 4. Operator QR login → `profile-check login`/`check` → one real draft run. — Done this run: operator scanned the WeChat QR, the profile persisted at `~/.config/kk/browser-profiles/infoq`, official `check` verified in 6.7 s, and exactly one draft-only run saved draft 405967 with the 已保存 signal observed; two extra stray drafts (405965/405966 from diagnostic probes) remain on the account, unpublished, flagged for operator cleanup.

### Root Cause

The plugin's entry/surface constants still described the wt-skills-era console: a static `/write`
editor page with a summary field, a 保存草稿 button, and login at account.infoq.cn. Task 0201
re-measured the real console (server-side draft at entry, autosave-only persistence, geekbang SSO)
but 0205 only layered operation validation on top, so the stale constants survived for this task to
fix. The old flow also assumed the draft was created by clicking a button at the end, whereas the
measured console creates the draft (`/draft/<id>`) the moment the write entry is clicked and saves
by autosave — on a dead entry URL that flow could never observe a signal.

### Solution

Measured contract (0191 live walk + 0201 walk evidence in `docs/design/infoq-ui-discovery.md`):

| Item | Stale value | Measured value (2026-10-06) |
|------|-------------|------------------------------|
| Editor entry | `EDITOR_URL https://xie.infoq.cn/write` | `/write` dead (404 authenticated, 0201 + 0191); entry = home `https://xie.infoq.cn/` → `div.write-btn` (label now 写点什么) → server-side `/draft/<id>` |
| Title | placeholder 请输入标题 (kept) | `input[placeholder="请输入标题"]` |
| Summary | `summary` selector | **no summary field — removed** |
| Body | `.ProseMirror[contenteditable="true"]` (kept) | same |
| Draft affordance | 保存草稿 button | **no button — editor autosaves** |
| Draft signal | toast texts + URL-id probe after a draft click | autosave indicator **已保存**, observed within ~6 s of content entry (0201 walk, discovery doc line 41); read scoped to notification containers only (0195) |
| Live control | submit selector (kept) | `div.submit-btn` (DIV, 提交 for editorial review — never activated in this task) |
| Login/SSO | `account.infoq.cn` | superseded by `account.geekbang.org` (both accepted by LOGIN_URL_RE) |
| Headless | headed fallback removed in an earlier pass | **headless always WAF 451** (re-confirmed live) → headed default restored, `options.headless` is an explicit opt-in |

Change map:

- `plugins/publishings/infoq-pub/src/index.ts:42` — `EDITOR_URL` → `HOME_URL` (https://xie.infoq.cn/); `:44` `DRAFT_URL_RE = /\/draft\/(\d+)/`; `:51` LOGIN_URL_RE covers account.geekbang.org.
- `plugins/publishings/infoq-pub/src/index.ts:61` — SELECTORS = measured writeEntry/noticeDismiss(知道了)/title/body/live; `summary`/`draft` removed.
- `plugins/publishings/infoq-pub/src/index.ts:75` — STEP_TIMEOUT_MS 30 s, ≥ 5× the measured ~6 s autosave latency (tests override the constant for instant fakes).
- `plugins/publishings/infoq-pub/src/index.ts:91` — DRAFT_SAVED_TEXTS = ['已保存']; live toasts 提交成功/审核.
- `plugins/publishings/infoq-pub/src/index.ts:106` — LOGGED_OUT_MARKER_SCRIPT (visible exact-leaf-text 登录 scan) folded into the readiness predicate (`isAuthenticated` = not a login URL + hydrated write entry + no logged-out marker).
- `plugins/publishings/infoq-pub/src/index.ts:82` — CHECK_TIMEOUT_MS 60 s dedicated preflight budget (0191 live: hydration tail 2.5–35 s exceeded the shared step timeout and the check refused); plumbed via `deps.checkTimeoutMs` and enforced as `checkHeadedOnly` (`:250`) — the check path probes headed only, never headless.
- `plugins/publishings/infoq-pub/src/index.ts:99` — SIGNAL_CONTAINERS adds the persistent-header save-status scope (`[class*="save-status" i]`, consumed at `:185`): the autosave indicator is not an ephemeral toast (0191 live measure); the draft flow adds a post-paste InputEvent nudge because `pasteHtml` sets innerHTML without an input event, so ProseMirror autosave never fired.
- `plugins/publishings/infoq-pub/src/index.ts:264` — preflight comment corrected: headless check first (fast refusal), headed fallback retained because headless can never verify on InfoQ (WAF); the check path itself now runs headed-only (`:250`, checkHeadedOnly).
- `plugins/publishings/infoq-pub/src/index.ts:288` — runEditorFlow rewritten to the measured flow: entry click → /draft/<id> URL+id capture → 知道了 dismissal → title fill → ProseMirror paste → scoped autosave expectOutcome; live branch (submit click with pre-click URL baseline + probeLive) only for publishStatus 'public'; `:374` dismissNoticeModal helper; `:384` probeLive (submit toast or URL moved); probeDraft/DRAFT_URL_ID_RE deleted.
- `plugins/publishings/infoq-pub/src/profile-check.ts:4` — header comment: login opens the home and resolves on the readiness predicate; headless check always 451s on InfoQ so a refusal retries headed.
- `plugins/publishings/infoq-pub/tests/infoq-pub.test.ts:72` — fake page/launcher rebuilt over the measured primitives (entry routing, scripted autosave chip, logged-out marker, notice modal, submit outcomes, scoped-toast semantics); `:204` frozen-surface + readiness suites; `:258` draft-flow suite incl. 0195 regression and entry/autosave timeout paths; `:330` live-switch suite; session-refusal, precedence and plugin-surface suites updated.

ADR-025 note: the intent (an unauthenticated profile is refused before any editor flow) is preserved;
only the "headless is always the safe pass" assumption is dropped, because on this channel headless
is the pass that can never succeed.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Live dogfood executed this run on the operator profile: `bun plugins/publishings/infoq-pub/src/profile-check.ts check` → status verified, 6.7 s, read-only (output captured in run log .spur/memory/runs/runall-e91-8a7d8e-0191.md); contract pinned by session-failure + verified-path suites plugins/publishings/infoq-pub/tests/infoq-pub.test.ts:375-420; check-mode drift remediation pinned in packages/publish-harness/tests/browser.test.ts (headedOnly: never probes headless; CLI plumb of checkHeadedOnly) |
| R2 | MET | Measured contract recorded per item (docs/tasks/0191_operator-dogfood-for-infoq-pub-profile-check-login-check-one.md:73-103) on measured basis docs/design/infoq-ui-discovery.md:41; corrected constants plugins/publishings/infoq-pub/src/index.ts:41,43,50,60,74,83,90 + this run's fresh re-measure (SIGNAL_CONTAINERS save-status scope, post-paste input nudge at the draft flow); pinned by frozen-surface suite plugins/publishings/infoq-pub/tests/infoq-pub.test.ts:204 — 26 pass / 0 fail this run, and all editor constants independently re-proven live by the R3 draft run |
| R3 | MET | Exactly one real draft run executed this run through the real transport: `.spur/run/0191-dogfood-result.json` → ok:true, url https://xie.infoq.cn/draft/405967, id 405967, "infoq draft saved (unpublished)", publishStatus draft; the 已保存 save signal was observed (now via the save-status scope); submit never activated (message says draft; no live switch). Flow pinned incl. never-clicks-submit (plugins/publishings/infoq-pub/tests/infoq-pub.test.ts:258-328) |
| R4 | MET | All measured-stale values corrected per change map (plugins/publishings/infoq-pub/src/index.ts:41,43,50,60,74,83,90,219,263,339,349 + SIGNAL_CONTAINERS and the preflight headedOnly/60 s options; plugins/publishings/infoq-pub/src/profile-check.ts:4) and pinned in the rebuilt suites (plugins/publishings/infoq-pub/tests/infoq-pub.test.ts:72,204,258,330,375; packages/publish-harness/tests/browser.test.ts headedOnly cases); fresh this run: 26 + 46 pass / 0 fail, tsc clean; removed symbols have no external importers |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — profile session dogfood on the operator profile | MET | command | Login was completed by the operator (WeChat QR, profile /Users/robin/.config/kk/browser-profiles/infoq, persisted); official check returned verified read-only this run (run log .spur/memory/runs/runall-e91-8a7d8e-0191.md); refusal paths remain pinned (plugins/publishings/infoq-pub/tests/infoq-pub.test.ts:375-420) |
| AC2 — measured drift corrected and recorded | MET | test | Drift recorded per item in docs/tasks/0191_operator-dogfood-for-infoq-pub-profile-check-login-check-one.md:73-103 and extended this run with three fresh measurements (headed hydration tail 2.5–35 s, save-status indicator with timestamp, pasteHtml input-event gap), each with its fix pinned in suites (packages/publish-harness/tests/browser.test.ts; plugins/publishings/infoq-pub/tests/infoq-pub.test.ts:204,258-328); fresh 46 + 26 pass / 0 fail |
| AC3 — one draft-only run through the real transport | MET | command | Draft 405967 created and saved via `kk executor run infoq-pub` (.spur/run/0191-dogfood-content.json → .spur/run/0191-dogfood-result.json); draft-only observed end to end (publishStatus draft, no submit click, result message "draft saved (unpublished)") |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- `docs/design/infoq-ui-discovery.md` — 0201 measured console contract (entry/selectors/autosave ~6 s/live control) — source of the editor-internal values re-pinned here.
- Task 0201 (done) — original discovery walk and drift list; Task 0205 — operation validation that left the stale constants in place.
- `.spur/run/0191-escalation.md` — operator-gated remainder (login QR scan → check → one draft run).

### History

- 2026-10-07T03:36:14.931Z todo → wip (system)
- 2026-10-07T05:29:26.939Z wip → testing (system)
- 2026-10-07T05:29:27.295Z testing → done (system)

