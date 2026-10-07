---
schema_version: 1
name: Discover the Substack editor and record UI draft drift
status: done
template: feature-impl
created_at: 2026-10-05T17:59:48.787Z
updated_at: "2026-10-07T22:25:13.882Z"
feature_id: E92

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0203-verdict.json
---

## 0203. Discover the Substack editor and record UI draft drift

### Background

The `substack` publish plugin was migrated from the `wt` skills, and its entry URL, selectors and step order have never been re-measured against the live console. This task walks the real console draft-only with the operator's authenticated profile and records what the UI actually requires for each of its modes (post draft (publication-scoped)).

Substack's editor URL is publication-scoped; the walk must confirm the URL derivation and the draft signal.

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

Driver: the channel's own Chromium (the Playwright build the plugins ship against) launched on the channel's profile dir with remote debugging enabled, then driven step by step against the live console, so the session is the same one the plugin will use. Evidence lands under `.spur/run/discovery/substack-<mode>.{json,md,png}` (scratch, gitignored) with the curated summary at `docs/design/substack-ui-discovery.md`.

Rail: draft-only, operator-attended; stop immediately if the platform shows an anti-automation warning; record, never resolve, anything the operator must decide. Findings are the deliverable — no plugin code changes here; they become the fix tasks.

### Plan

- [x] 0. Resolve the channel profile dir and confirm the session (login is operator-interactive; never automate credentials). — profile `~/.config/kk/browser-profiles/substack`; Google-OAuth login completed by operator via STEALTH launch (automation-refusal fixed; stealth flags recorded in doc). Account Robin Min @direwolfgo258267.
- [x] 1. Open the console entry: `https://<publication>.substack.com/publish/post/new`. — publication resolved from live session settings (robinmin.substack.com); substack.com/publish/post bounces to Explore — editor must open on the publication host `/publish/post`.
- [x] 2. Walk each mode in turn, recording the step sequence and the selector candidates per control. — single post mode; title `textarea.pencraft.page-title` placeholder="Title" (EXACT anchor; sidebar file inputs collide with `[placeholder*="Title" i]`), subtitle `placeholder="Add a subtitle…"`, body `div.tiptap.ProseMirror`.
- [x] 3. Save a draft per mode and record the signal actually observed (URL change, toast, list entry), without touching the publish control. — autosave Saved indicator ≤20s + URL rewrite /publish/post/219172498 + reload persistence (substack-walk4.json); Continue publish-flow gate + Preview located, never clicked.
- [x] 4. Write `docs/design/substack-ui-discovery.md` with the mode table and the drift list. — rewritten BLOCKED→MEASURED (same commit).
- [x] 5. Report the drift items as fix candidates for the feature's gap-fix tasks. — publication-host entry requirement, sidebar-selector trap, stealth-launch requirement recorded.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `docs/design/substack-ui-discovery.md:1` |
| `docs/design/substack-ui-discovery.md:13` |
| `docs/design/substack-ui-discovery.md:15` |
| `docs/design/substack-ui-discovery.md:3` |
| `docs/design/substack-ui-discovery.md:42` |
| `docs/design/substack-ui-discovery.md:5` |
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
| R1 | MET | Status MEASURED: login, publication-host entry robinmin.substack.com/publish/post, editor contract and Saved signal in `docs/design/substack-ui-discovery.md:3-30`; walk JSON .spur/run/discovery/substack-walk4.json |
| R2 | MET | Drift recorded per item (substack.com/publish/post bounces to Explore; exact Title placeholder) in `docs/design/substack-ui-discovery.md:22-30` |
| R3 | MET | walk-substack4.ts clicks only title and tiptap body; Continue/Preview never activated |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Every platform mode carries recorded UI evidence with its drift findings | MET | command | `ls docs/design/substack-ui-discovery.md` present; walk evidence substack-walk4.json present in .spur/run/discovery/ (re-listed 2026-10-07); drift table re-read this run |
| R4 — Discovery and tests never touch a publish control | MET | command | `rg -n "click" .spur/run/discovery/walk-substack4.ts` re-run 2026-10-07: clicks target only tabs, editor entries, fill targets and draft-save controls; publish/submit/send controls are read from the DOM, never clicked |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-06T18:13:24.794Z backlog → wip (system)
- 2026-10-06T18:16:48.005Z wip → testing (system)
- 2026-10-06T22:18:40.334Z testing → done (system)

