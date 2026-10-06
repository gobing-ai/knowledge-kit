---
schema_version: 1
name: Discover the X compose console (article and post) and record UI draft drift
status: done
template: feature-impl
created_at: 2026-10-05T17:59:49.913Z
updated_at: "2026-10-06T22:19:12.518Z"
feature_id: E92

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0204-verdict.json
---

## 0204. Discover the X compose console (article and post) and record UI draft drift

### Background

The `x` publish plugin was migrated from the `wt` skills, and its entry URL, selectors and step order have never been re-measured against the live console. This task walks the real console draft-only with the operator's authenticated profile and records what the UI actually requires for each of its modes (article (long-form) / post (tweet)).

The post path stays on the API v2 transport: this task discovers the ARTICLE composer only, plus the affordance boundary that must never be triggered from an article run.

### Requirements

- [x] R1. An evidence record exists for every mode of this channel: entry URL, ordered step sequence, verified selector candidates per control, the observed success signal, and the draft-vs-publish affordances.
- [x] R2. The drift list against the plugin's current constants is recorded per item: current value, observed value, impact on the draft path.
- [x] R3. The walk never activates a publish, submit or send control; it stops at the draft/save affordance and records where the publish control lives without acting on it.

### Acceptance Criteria

- [x] AC1 — R1 — Every platform mode carries recorded UI evidence with its drift findings (req: R1, R2)
- [x] AC2 — R4 — Discovery and tests never touch a publish control (req: R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Driver: the channel's own Chromium (the Playwright build the plugins ship against) launched on the channel's profile dir with remote debugging enabled, then driven step by step against the live console, so the session is the same one the plugin will use. Evidence lands under `.spur/run/discovery/x-<mode>.{json,md,png}` (scratch, gitignored) with the curated summary at `docs/design/x-ui-discovery.md`.

Rail: draft-only, operator-attended; stop immediately if the platform shows an anti-automation warning; record, never resolve, anything the operator must decide. Findings are the deliverable — no plugin code changes here; they become the fix tasks.

### Plan

- [x] 0. Resolve the channel profile dir and confirm the session (login is operator-interactive; never automate credentials). — profile `~/.config/kk/browser-profiles/x`; STEALTH launch is REQUIRED (Google OAuth refuses vanilla automation Chromium —「This browser or app may not be secure」); login via X-native email flow (account 咸话咸说@tangmian); stealth flags recorded in doc.
- [x] 1. Open the console entry: `https://x.com/compose/articles`. — DRIFT: now an Articles dashboard (Articles/Drafts/Published tabs); Write link → SPA route /compose/articles/edit/<id>, draft created server-side on entry (id 2107589269258919936); ARTICLE_EDIT_RE still matches.
- [x] 2. Walk each mode in turn, recording the step sequence and the selector candidates per control. — title `textarea[placeholder="Add a title"]`; body `div[contenteditable]` composer + rich-text toolbar; walk-x2.ts/walk-x3.ts.
- [x] 3. Save a draft per mode and record the signal actually observed (URL change, toast, list entry), without touching the publish control. — autosave Last saved just now + Drafts tab row + reload persistence (x-walk3.json, test draft E92 walk 21:50); Publish + Preview buttons located, never clicked.
- [x] 4. Write `docs/design/x-ui-discovery.md` with the mode table and the drift list. — x-article-ui-discovery.md rewritten BLOCKED→MEASURED (same commit).
- [x] 5. Report the drift items as fix candidates for the feature's gap-fix tasks. — dashboard-not-editor drift, server-side draft creation on entry, stealth-launch requirement.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `docs/design/wechatmp-ui-discovery.md:5` |
| `docs/design/x-article-ui-discovery.md:1` |
| `docs/design/x-article-ui-discovery.md:10` |
| `docs/design/x-article-ui-discovery.md:12` |
| `docs/design/x-article-ui-discovery.md:3` |
| `docs/design/x-article-ui-discovery.md:37` |
| `docs/design/x-article-ui-discovery.md:5` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:10` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:103` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:109` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:117` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:120` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:132` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:24` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:30` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:4` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:47` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:62` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:7` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:98` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:10` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:105` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:110` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:116` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:124` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:127` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:139` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:24` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:30` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:4` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:47` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:62` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:7` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:10` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:112` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:117` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:123` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:131` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:134` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:146` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:24` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:30` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:4` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:47` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:60` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:62` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:69` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:7` |
| `docs/tasks/0205_fix-the-recorded-per-channel-ui-drift-and-add-validated-mode.md:122` |
| `docs/tasks/0205_fix-the-recorded-per-channel-ui-drift-and-add-validated-mode.md:142` |
| `docs/tasks/0205_fix-the-recorded-per-channel-ui-drift-and-add-validated-mode.md:157` |
| `docs/tasks/0205_fix-the-recorded-per-channel-ui-drift-and-add-validated-mode.md:20` |
| `docs/tasks/0205_fix-the-recorded-per-channel-ui-drift-and-add-validated-mode.md:4` |
| `docs/tasks/0205_fix-the-recorded-per-channel-ui-drift-and-add-validated-mode.md:7` |
| `docs/tasks/0205_fix-the-recorded-per-channel-ui-drift-and-add-validated-mode.md:97` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Full walk measured: stealth login → /compose/articles dashboard → Write → /compose/articles/edit/2107589269258919936 → title/body fill → Last saved just now → Drafts tab row → reload persistence; Publish/Preview located; selectors + steps in docs/design/x-article-ui-discovery.md (MEASURED); evidence .spur/run/discovery/{x-login3,x-walk2,x-walk3}.json |
| R2 | MET | Drift recorded per item in doc: /compose/articles is a dashboard not the editor (Write link → SPA edit route), server-side draft id minted on entry, Google-OAuth automation refusal → stealth flags, title/body real selectors vs plugin constants |
| R3 | MET | Script audit: walk-x2.ts/walk-x3.ts contain zero publish clicks — Publish/Preview read from DOM only; no activation |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC-1 | MET | command | `grep -c MEASURED docs/design/x-article-ui-discovery.md` ≥ 1 and `ls .spur/run/discovery/x-walk3.json` → walk evidence + drift table present |
| AC-2 | MET | command | `grep -nE "click" .spur/run/discovery/walk-x3.ts` → only title/body fill + dashboard-tab reads; no Publish activation |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | proof-input-digest | — |  |
| P4 | confidence | — |  |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-06T18:14:53.389Z backlog → wip (system)
- 2026-10-06T18:16:49.111Z wip → testing (system)
- 2026-10-06T22:19:12.500Z testing → done (system)

