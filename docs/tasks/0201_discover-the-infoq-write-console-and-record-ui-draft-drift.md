---
schema_version: 1
name: Discover the InfoQ write console and record UI draft drift
status: done
template: feature-impl
created_at: 2026-10-05T17:59:46.523Z
updated_at: "2026-10-07T22:25:12.202Z"
feature_id: E92

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0201-verdict.json
---

## 0201. Discover the InfoQ write console and record UI draft drift

### Background

The `infoq` publish plugin was migrated from the `wt` skills, and its entry URL, selectors and step order have never been re-measured against the live console. This task walks the real console draft-only with the operator's authenticated profile and records what the UI actually requires for each of its modes (write → draft (提交 for editorial review)).

InfoQ has no self-publish: the live control submits for editorial review, so the draft walk must stop before 提交.

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

Driver: the channel's own Chromium (the Playwright build the plugins ship against) launched on the channel's profile dir with remote debugging enabled, then driven step by step against the live console, so the session is the same one the plugin will use. Evidence lands under `.spur/run/discovery/infoq-<mode>.{json,md,png}` (scratch, gitignored) with the curated summary at `docs/design/infoq-ui-discovery.md`.

Rail: draft-only, operator-attended; stop immediately if the platform shows an anti-automation warning; record, never resolve, anything the operator must decide. Findings are the deliverable — no plugin code changes here; they become the fix tasks.

### Plan

- [x] 0. Resolve the channel profile dir and confirm the session (login is operator-interactive; never automate credentials). — profile `~/.config/kk/browser-profiles/infoq`; login completed by operator via account.geekbang.org/infoq/login WeChat QR (login-infoq3.ts, auth predicate = hydration + avatar + !登录).
- [x] 1. Open the console entry: `https://xie.infoq.cn/write`. — DEAD: /write 404s even authenticated; real entry = home 立即创作 (`div.write-btn`) → server-side draft `/draft/<id>` (editor-entry.json: /draft/405943).
- [x] 2. Walk each mode in turn, recording the step sequence and the selector candidates per control. — single article mode; title `input[placeholder="请输入标题"]`, body `.ProseMirror`, publish `div.submit-btn`/preview `div.preview-btn` (DIVs), probe-infoq-editor2.ts.
- [x] 3. Save a draft per mode and record the signal actually observed (URL change, toast, list entry), without touching the publish control. — 已保存 autosave + reload persistence (walk-infoq3.ts → infoq-walk3.json); publish control located, never clicked; 30/day quota recorded.
- [x] 4. Write `docs/design/infoq-ui-discovery.md` with the mode table and the drift list. — rewritten BLOCKED→MEASURED (same commit).
- [x] 5. Report the drift items as fix candidates for the feature's gap-fix tasks. — dead selectors 保存草稿/提交//write/account.infoq.cn; LOGIN_URL_RE drift to geekbang domain; headless 451 WAF block recorded.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `docs/design/infoq-ui-discovery.md:1` |
| `docs/design/infoq-ui-discovery.md:11` |
| `docs/design/infoq-ui-discovery.md:13` |
| `docs/design/infoq-ui-discovery.md:3` |
| `docs/design/infoq-ui-discovery.md:46` |
| `docs/design/infoq-ui-discovery.md:6` |
| `docs/design/juejin-ui-discovery.md:1` |
| `docs/design/juejin-ui-discovery.md:11` |
| `docs/design/juejin-ui-discovery.md:3` |
| `docs/design/juejin-ui-discovery.md:36` |
| `docs/design/juejin-ui-discovery.md:6` |
| `docs/design/juejin-ui-discovery.md:9` |
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
| R1 | MET | Status MEASURED: login (WeChat QR), 立即创作 → server-side /draft/<id>, editor contract and 已保存 signal in `docs/design/infoq-ui-discovery.md`; walk JSON .spur/run/discovery/infoq-walk3.json |
| R2 | MET | Drift recorded per item in `docs/design/infoq-ui-discovery.md` (/write 404, 保存草稿/提交 buttons absent, entry moved to geekbang) |
| R3 | MET | walk-infoq3.ts clicks only 知道了 dismissal, title and ProseMirror body; 提交 never activated |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Every platform mode carries recorded UI evidence with its drift findings | MET | command | `ls docs/design/infoq-ui-discovery.md` present; walk evidence infoq-walk3.json present in .spur/run/discovery/ (re-listed 2026-10-07); drift table re-read this run |
| R4 — Discovery and tests never touch a publish control | MET | command | `rg -n "click" .spur/run/discovery/walk-infoq3.ts` re-run 2026-10-07: clicks target only tabs, editor entries, fill targets and draft-save controls; publish/submit/send controls are read from the DOM, never clicked |
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

- 2026-10-06T18:04:40.960Z backlog → wip (system)
- 2026-10-06T18:09:37.270Z wip → testing (system)
- 2026-10-06T22:15:40.136Z testing → done (system)

