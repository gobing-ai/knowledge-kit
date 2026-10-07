---
schema_version: 1
name: Discover the xhs publish console per mode and record UI drift
status: done
template: feature-impl
created_at: 2026-10-05T17:59:44.252Z
updated_at: "2026-10-07T22:25:09.341Z"
feature_id: E92

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0199-verdict.json
---

## 0199. Discover the xhs publish console per mode and record UI drift

### Background

The `xhs` publish plugin was migrated from the `wt` skills, and its entry URL, selectors and step order have never been re-measured against the live console. This task walks the real console draft-only with the operator's authenticated profile and records what the UI actually requires for each of its modes (上传视频 / 上传图文 / 写长文 / 发播客).

xhs is automation-capped by ADR-025: one `check` and one publish cycle per 2 h, and the operator was warned by the platform — the walk is ONE attended cycle, draft-only.

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

Driver: the channel's own Chromium (the Playwright build the plugins ship against) launched on the channel's profile dir with remote debugging enabled, then driven step by step against the live console, so the session is the same one the plugin will use. Evidence lands under `.spur/run/discovery/xhs-<mode>.{json,md,png}` (scratch, gitignored) with the curated summary at `docs/design/xhs-ui-discovery.md`.

Rail: draft-only, operator-attended; stop immediately if the platform shows an anti-automation warning; record, never resolve, anything the operator must decide. Findings are the deliverable — no plugin code changes here; they become the fix tasks.

### Plan

- [x] 0. Resolve the channel profile dir and confirm the session (login is operator-interactive; never automate credentials).
- [x] 1. Open the console entry: `https://creator.xiaohongshu.com/publish/publish`.
- [x] 2. Walk each mode in turn, recording the step sequence and the selector candidates per control.
- [x] 3. Stop at the draft/save affordance per mode and record where it lives, without touching the publish control (R3). Draft-save itself was NOT executed; the observed save-signal capture is an attended item for 0205's pre-work (docs/design/xhs-ui-discovery.md §Limits & attended items).
- [x] 4. Write `docs/design/xhs-ui-discovery.md` with the mode table and the drift list.
- [x] 5. Report the drift items as fix candidates for the feature's gap-fix tasks (7 drift items + 2 attended items registered for 0205).

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `docs/design/xhs-ui-discovery.md:1` |
| `docs/design/xhs-ui-discovery.md:10` |
| `docs/design/xhs-ui-discovery.md:21` |
| `docs/design/xhs-ui-discovery.md:23` |
| `docs/design/xhs-ui-discovery.md:25` |
| `docs/design/xhs-ui-discovery.md:3` |
| `docs/design/xhs-ui-discovery.md:30` |
| `docs/design/xhs-ui-discovery.md:33` |
| `docs/design/xhs-ui-discovery.md:35` |
| `docs/design/xhs-ui-discovery.md:37` |
| `docs/design/xhs-ui-discovery.md:42` |
| `docs/design/xhs-ui-discovery.md:44` |
| `docs/design/xhs-ui-discovery.md:54` |
| `docs/design/xhs-ui-discovery.md:56` |
| `docs/design/xhs-ui-discovery.md:8` |
| `docs/features/E92_publish-channel-ui-fidelity-per-mode-discovery-and-gap-fixes.md:104` |
| `docs/features/E92_publish-channel-ui-fidelity-per-mode-discovery-and-gap-fixes.md:5` |
| `docs/features/E92_publish-channel-ui-fidelity-per-mode-discovery-and-gap-fixes.md:9` |
| `docs/features/E92_publish-channel-ui-fidelity-per-mode-discovery-and-gap-fixes.md:90` |
| `docs/features/INDEX.md:43` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Four modes (上传图文/上传视频/写长文/发播客) each with pierce JSON + PNG in .spur/run/discovery/; entry URL, step order, selectors, signals and draft-vs-publish affordances tabulated in `docs/design/xhs-ui-discovery.md:1-41` |
| R2 | MET | Drift list per item (current constant / observed / draft-path impact) at `docs/design/xhs-ui-discovery.md:42-52`; drift #7 and the first-cycle limits now carry their 0205 resolutions at `docs/design/xhs-ui-discovery.md:54-70` (fix pass 2026-10-07) |
| R3 | MET | xhs-walk.ts clicks only mode tabs, entry controls (新的创作/上传音频) and the later 暂存离开 draft-save probe; 发布 is collected by text match and never clicked |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Every platform mode carries recorded UI evidence with its drift findings | MET | command | `ls docs/design/xhs-ui-discovery.md` present; walk evidence xhs-{上传图文,上传视频,写长文,发播客}-pierce.json + PNGs present in .spur/run/discovery/ (re-listed 2026-10-07); drift table re-read this run |
| R4 — Discovery and tests never touch a publish control | MET | command | `rg -n "click" .spur/run/discovery/xhs-walk.ts` re-run 2026-10-07: clicks target only tabs, editor entries, fill targets and draft-save controls; publish/submit/send controls are read from the DOM, never clicked |
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

- 2026-10-06T17:18:02.896Z backlog → wip (system)
- 2026-10-06T17:27:59.626Z wip → testing (system)
- 2026-10-06T17:31:25.783Z testing → done (system)

