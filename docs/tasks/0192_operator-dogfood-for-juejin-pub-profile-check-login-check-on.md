---
schema_version: 1
name: "Operator dogfood for juejin-pub: profile-check login -> check -> one draft run; re-measure editor URL/CodeMirror selectors/draft signal"
status: done
template: issue
created_at: 2026-10-05T13:41:38.460Z
updated_at: "2026-10-07T05:53:26.413Z"
feature_id: E91

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0192-verdict.json
---

## 0192. Operator dogfood for juejin-pub: profile-check login -> check -> one draft run; re-measure editor URL/CodeMirror selectors/draft signal

### Background

Captured from the creation title: "Operator dogfood for juejin-pub: profile-check login -> check -> one draft run; re-measure editor URL/CodeMirror selectors/draft signal".

### Requirements

- [x] R1. Dogfood the juejin profile session on the persisted operator profile (`~/.config/kk/browser-profiles/juejin`): `profile-check.ts check` reported `verified` (headless, 2.9 s — session alive since the 0202 walk; no login needed); outcome recorded. **Outcome: verified**.
- [x] R2. Re-measure the live juejin editor contract against `docs/design/juejin-ui-discovery.md` (0202, measured 2026-10-06): editor URL + draft-id rewrite, title selector, CodeMirror body path, 保存成功 toast, draft-id evidence rule all confirmed live by the draft run; one new drift measured — the headless editor readiness is non-deterministic (CLI check verified in 2.9 s, the identical readiness predicate burned 30 s in the publish preflight) — recorded per item in Solution.
- [x] R3. Ran exactly one draft-only publish through the real juejin transport: draft **7693049513121349678** saved (`ok: true`, "juejin draft saved (unpublished)", `/editor/drafts/<id>` rewrite observed); 发布 and 草稿箱 never activated.
- [x] R4. The measured-stale preflight is corrected in the plugin source and pinned by the plugin tests (25 pass / 0 fail after the fix; headless-launch expectations updated to the headed-only contract).

### Acceptance Criteria

```gherkin
`ac_altitude: task-local`
`ac_numbering: task-local`

Scenario: AC1 — profile session dogfood on the persisted juejin profile
Given the persisted operator profile `~/.config/kk/browser-profiles/juejin` (session alive since 0202)
When `bun plugins/publishings/juejin-pub/src/profile-check.ts check` runs against it
Then it exits 0 reporting `status: "verified"` (login leg only if the session expired) (req: R1)

Scenario: AC2 — measured contract confirmed against the 0202 discovery record
Given `docs/design/juejin-ui-discovery.md` records the measured editor contract
When the plugin constants (editor URL + rewrite rule, title/body selectors, 保存成功 toasts, draft evidence) are compared live
Then every constant matches the measured contract or is corrected and pinned in the plugin tests (req: R2, R4)

Scenario: AC3 — one draft-only run through the real transport
Given the verified profile and the plugin source
When `bun plugins/publishings/juejin-pub/src/index.ts --in <content> --out <result>` runs once with draft-only content
Then the result JSON reports `ok: true` with draft evidence (/editor/drafts/<id> rewrite or 保存成功), and no live/publish control is activated (req: R3)
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

- [x] 0. Read `plugins/publishings/juejin-pub/src/index.ts` + `docs/design/juejin-ui-discovery.md`; mapped the plugin constants onto the measured contract — already aligned (editor URL ?v=2 :36, title selectors :46-47, CodeMirror fill, 保存成功 toasts :65, draft-id rule :61).
- [x] 1. `check` the persisted profile: **verified headless in 2.9 s**; no login leg needed (session alive since 0202).
- [x] 2. Plugin suite + full gate: 25 pass / 0 fail (pre-fix); drift found and fixed; 25 pass / 0 fail (post-fix), tsc + format clean.
- [x] 3. One draft-only run through the real transport: **draft 7693049513121349678**, ok:true, 53 s, never a live click.
- [x] 4. Drift corrections recorded (preflight headedOnly + 60 s budget + checkHeadedOnly, mirrors infoq 0191), boxes flipped with outcomes, verify PASS, record, done.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

Change map — measured drift (0192) corrected in `plugins/publishings/juejin-pub/`:

| Change | Requirement | Location |
|--------|-------------|----------|
| `CHECK_TIMEOUT_MS = 60_000` + non-determinism rationale | R2, R4 | plugins/publishings/juejin-pub/src/index.ts:59 |
| `CONFIG.checkHeadedOnly: true` (CLI check stops betting on headless editor loads) | R2, R4 | plugins/publishings/juejin-pub/src/index.ts:87 |
| `checkTimeoutMs` dep + plumb (mirrors infoq 0191 seams) | R4 | plugins/publishings/juejin-pub/src/index.ts:178,185-190 |
| Publish preflight `headedFallback:false` → `headedOnly:true, timeoutMs:this.checkTimeoutMs` + measured rationale | R2, R4 | plugins/publishings/juejin-pub/src/index.ts:211-222 |
| Draft-flow launch-sequence pin `[false, false]` (headed preflight + headed editor visit) | R4 | plugins/publishings/juejin-pub/tests/juejin-pub.test.ts:279-282 |
| Expired-session refusal pin (`headed juejin readiness refused`, single headed request) | R4 | plugins/publishings/juejin-pub/tests/juejin-pub.test.ts:439-446 |
| Mid-run expiry + headless-opt-in pins updated to the headed-only contract | R4 | plugins/publishings/juejin-pub/tests/juejin-pub.test.ts:455-460,463-468 |
| Test helper `checkTimeoutMs` seam (fast-fail in fakes) | R4 | plugins/publishings/juejin-pub/tests/juejin-pub.test.ts:200-203 |

Live-leg evidence: profile check verified (2.9 s, headless); draft **7693049513121349678** saved unpublished via the real transport (`.spur/run/0192-dogfood-result.json`); measured contract of `docs/design/juejin-ui-discovery.md` confirmed live (editor URL, title fill, CodeMirror body, 保存成功 → `/editor/drafts/<id>` rewrite). No live control clicked. Strays: this task creates one extra unpublished draft (7693049513121349678) on the operator account; operator may delete.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Live dogfood this run: `bun plugins/publishings/juejin-pub/src/profile-check.ts check` -> {"status":"verified"} in 2.9 s headlessly against the persisted operator profile (session alive since the 0202 walk); login leg not needed; refusal paths pinned (plugins/publishings/juejin-pub/tests/juejin-pub.test.ts:436-450) |
| R2 | MET | Measured contract of docs/design/juejin-ui-discovery.md confirmed live by the draft run (editor URL /editor/drafts/new?v=2 -> /editor/drafts/<id>, input.title-input, CodeMirror body, 保存成功); one new drift measured and recorded per item in the task Solution (headless editor readiness non-deterministic: CLI check 2.9 s pass, publish preflight 30 s burn on the identical predicate) |
| R3 | MET | Exactly one real draft run executed this run through the real transport: .spur/run/0192-dogfood-result.json -> ok:true, url https://juejin.cn/editor/drafts/7693049513121349678, id 7693049513121349678, "juejin draft saved (unpublished)", publishStatus draft, 53 s; no 发布/草稿箱 activation (draft-only flow pinned plugins/publishings/juejin-pub/tests/juejin-pub.test.ts:267-300) |
| R4 | MET | Measured-stale preflight corrected per change map (plugins/publishings/juejin-pub/src/index.ts:59,87,178,211-222) and pinned in the rebuilt suites (plugins/publishings/juejin-pub/tests/juejin-pub.test.ts:200-203,279-282,436-468); fresh this run: 25 pass / 0 fail, tsc clean |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — profile session dogfood on the persisted juejin profile | MET | command | check ran against the persisted profile and reported verified this run (2.9 s, read-only, run log .spur/memory/runs/runall-e91-8a7d8e-0191.md); no login needed |
| AC2 — measured contract confirmed against the 0202 discovery record | MET | test | Constants compared against the discovery record and exercised live by the R3 draft run; the one drift (headless readiness) corrected in source and pinned in tests; 25 pass / 0 fail |
| AC3 — one draft-only run through the real transport | MET | command | Draft 7693049513121349678 created and saved via the plugin CLI (.spur/run/0192-dogfood-content.json -> .spur/run/0192-dogfood-result.json); draft-only observed end to end (publishStatus draft, /editor/drafts/<id> rewrite, no live click) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-10-07T05:53:16.013Z todo → wip (system)
- 2026-10-07T05:53:16.456Z wip → testing (system)
- 2026-10-07T05:53:26.408Z testing → done (system)

