---
schema_version: 1
name: "Operator dogfood for juejin-pub: profile-check login -> check -> one draft run; re-measure editor URL/CodeMirror selectors/draft signal"
status: done
template: issue
created_at: 2026-10-05T13:41:38.460Z
updated_at: "2026-10-08T00:24:21.248Z"
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

Scenario: AC1 — profile session dogfood on the operator profile
Given the persisted operator profile `~/.config/kk/browser-profiles/juejin` (session alive since 0202)
When `bun plugins/publishings/juejin-pub/src/profile-check.ts check` runs against it
Then it exits 0 reporting `status: "verified"` (login leg only if the session expired) (req: R1)

Scenario: AC2 — measured drift corrected and recorded
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
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Recorded `check` verified on the persisted profile; current check headed-only via `plugins/publishings/juejin-pub/src/index.ts:88` `checkHeadedOnly:true`. |
| R2 | MET | `docs/design/juejin-ui-discovery.md:18` measured contract and `:29` draft signal match `EDITOR_URL` `plugins/publishings/juejin-pub/src/index.ts:37` and the CodeMirror fill `:273`. |
| R3 | MET | `.spur/run/0192-dogfood-result.json` → `ok:true`, draft 7693049513121349678, `/editor/drafts/<id>` URL (re-read this pass). |
| R4 | MET | Headed-only preflight `plugins/publishings/juejin-pub/src/index.ts:216-220` pinned at `plugins/publishings/juejin-pub/tests/juejin-pub.test.ts:278,446`; 25 tests pass. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — profile session dogfood on the operator profile | MET | command | Recorded verified check; headed-only check path `plugins/publishings/juejin-pub/src/index.ts:88,216-220`. |
| AC2 — measured drift corrected and recorded | MET | test | Drift (headless readiness) corrected at `plugins/publishings/juejin-pub/src/index.ts:211-220` and pinned `plugins/publishings/juejin-pub/tests/juejin-pub.test.ts:446`; measured contract `docs/design/juejin-ui-discovery.md:18-33`. |
| AC3 — one draft-only run through the real transport | MET | command | `.spur/run/0192-dogfood-result.json` draft-only; live path gated at `plugins/publishings/juejin-pub/src/index.ts:287`. |
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

