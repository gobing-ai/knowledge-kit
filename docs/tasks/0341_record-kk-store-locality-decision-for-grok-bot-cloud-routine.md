---
schema_version: 1
name: Record kk store-locality decision for Grok Bot cloud routines
status: done
template: feature-impl
created_at: 2026-11-04T23:00:27.340Z
updated_at: "2026-11-05T03:29:36.298Z"
feature_id: F81

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 2
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0341-verdict.json
---

## 0341. Record kk store-locality decision for Grok Bot cloud routines

### Background

Task 0341 delivers feature F81 scenario R3 (`docs/features/F81_grok-bot-cloud-routines-for-knowledge-kit.md`). It records, before any cloud execution code lands (0343), where the kk store lives when a Grok Bot routine runs with the laptop closed.

Facts (verified 2026-11-04):

- **Store.** `kk.db` is a WAL SQLite file at `store.db_path` (default `<works_dir>/kk.db`). It is the single durable exception in the works root (`docs/00_ADR.md` ADR-030 :1200, ADR-042 :1563).
- **Browser channels.** Their login profiles live in `~/.config/kk/browser-profiles/`. They are Keychain-bound and "do not survive a machine move reliably" (ADR-042 migration note). Publishing through them is therefore Mac-only.
- **Bot computers.** They keep a durable disk, but member-installed packages are removed on recreate (https://docs.x.ai/grok-bot/computers). Routines run on schedules ≥5 min apart, 200 runs/hour/routine, 300/hour total, or on webhooks (https://docs.x.ai/grok-bot/skills-routines-and-automations). No API to create routines is documented, so routines are created by chat.
- **SQLite on synced or network storage.** SQLite warns that its locking is unreliable on network filesystems and that copying a live WAL database risks corruption (https://www.sqlite.org/useovernet.html, https://www.sqlite.org/howtocorrupt.html §1.2).
- **Store-free collection.** `kk executor fan-in --source … --out <Doc[].json>` collects without the store (`plugins/kk/workflows/kk-collect.yaml:96-102`). `kk store ingest --run <id> --in <Doc[].json>` upserts such a file later (`kk store ingest --help`). Collection can therefore be split at an existing file seam with no new verb.
- **Publish workflows** (`kk-daily-publish3`) read the Mac-local frozen bundle (ADR-043) and call `kk store mark-published`. They depend on the store and on browser profiles.

**Refine corrections (2026-11-04)**

- The feature leaves the choice open ("synced input vs moving the store"). This refinement freezes the recommended choice, **cloud prepares, Mac owns the store**, so 0343 can be implemented. The operator can still overturn it at review, and the ADR records the rejected option and the condition for revisiting it.
- The deliverable is an ADR (next free number, ADR-044, after ADR-043 :1580) plus a design section. It is not code, so `mutationPolicy: none` applies to source.

### Requirements

- [x] R1. Append `## ADR-044: Grok Bot cloud routines prepare inputs; the Mac owns the kk store` to `docs/00_ADR.md`, with Status (Accepted · 2026-11-04 · feature F81 · task 0341), Decision, Why, Rejected, Revisit-when and Detail. The decision has four points:
  - (1) `kk.db` never moves to, syncs to, or is opened from a Bot computer.
  - (2) A cloud routine may run only store-free, browser-free work. Its output is a file artifact delivered through a git branch the Bot pushes via its GitHub connector. The frozen branch is `kk-cloud-sync` and the path is `sync/<schedule>/<stamp>.json`.
  - (3) The Mac imports that artifact with existing verbs: `kk store ingest --run cloud-<stamp> --in <file>` for collect output.
  - (4) Publishing and anything reading the store, the frozen bundle or browser profiles stays Mac-local, and ADR-022 is unchanged.

- [x] R2. The ADR names a missing/stale-input policy that every cloud render must carry:
  - The routine reports `no-content: <reason>` and exits without side effects when its inputs or credentials are missing.
  - The Mac import ignores (and logs) artifacts older than 26 h, matching the horizon digest fallback in `kk-collect.yaml:110`.
  - An artifact is imported at most once (idempotent by `--run cloud-<stamp>`).

- [x] R3. "Rejected" records the store-on-Bot option with its reasons: SQLite over sync/network storage, browser profiles being Keychain-bound, member packages being removed on recreate, and the 300 runs/hour shared cap. It also records sync of `kk.db` via git/iCloud.

  "Revisit-when" is either a documented Grok Bot storage/API that guarantees single-writer POSIX locking, or kk adopting a server store.

- [x] R4. Add a "Grok Bot cloud routines" subsection to the owning design doc. To find the owner, run `rg -l "kk-collect" docs/design`; the expected owner is `docs/design/kk-collect-and-daily-voice2.md`. Pick the doc that owns collect/schedule and do not create a new one. The subsection holds the seam diagram (Bot `kk executor fan-in` → `kk-cloud-sync` → Mac `kk store ingest`) and the policy table from R2. Also add one line to `docs/03_ARCHITECTURE.md` at the schedule/collect mechanism pointing to ADR-044.

- [x] R5. Gates: `bun run lint` and `bun run spur-check` pass (doc-only; the link-check and rule gates cover the docs).

Out of scope:
- any code;
- the render (0343);
- the Mac-side import automation (an operator cron runs `kk store ingest`; a recipe line goes in 0343's rendered text);
- choosing a sync mechanism other than git;
- amending ADR-022.

### Acceptance Criteria

```gherkin
Scenario: AC1 — ADR-044 records the decision completely (req: R1, R3)
  Given docs/00_ADR.md
  When ADR-044 is read
  Then it states the four decision points, the frozen branch `kk-cloud-sync` and path `sync/<schedule>/<stamp>.json`, the rejected store-on-Bot option with its reasons, and a revisit condition

Scenario: AC2 — Missing/stale policy is explicit (req: R2)
  Given ADR-044 and the design subsection
  When the policy table is read
  Then it defines `no-content: <reason>` exit, the 26 h staleness bound, and once-only import by `cloud-<stamp>` run id

Scenario: AC3 — Design and architecture point to the decision (req: R4)
  Given the owning collect design doc and docs/03_ARCHITECTURE.md
  When they are read
  Then the design has the Grok Bot subsection with the seam and policy, and 03 references ADR-044

Scenario: AC4 — Gates pass (req: R5)
  Given the doc change
  When lint and spur-check run
  Then both pass

Scenario: R3 — Store locality decision precedes cloud execution (R3)
  Given ADR-044, the design's Grok Bot subsection, and the pending `kk schedule render grok-bot` platform (0343)
  When the recorded store-locality decision, its rejected alternative, and the no-content/staleness policy are reviewed side by side with 0343's rendered routine
  Then the decision precedes cloud execution: the rendered routine never assumes a reachable Mac-side store, once-only import and consent gates come from the recorded policy, and no cloud execution code ships before ADR-044 exists
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-04T23:40:59.277Z

- **CLOSED — cloud prepares, Mac owns the store.** The evidence is in Background. SQLite locking is unsafe over sync/network storage, browser profiles cannot move, and Bot packages can vanish on recreate. The file seam (`fan-in --out` → `store ingest --in`) already exists, so the cost is zero new verbs.
- **CLOSED — git branch as the sync channel.** The Bot has a GitHub connector and the Mac already has the checkout. A branch keeps artifacts auditable and avoids new credentials on the Mac.
- **CLOSED — 26 h staleness.** This matches the existing horizon fallback window, so the two policies cannot drift apart.
- **DEFERRED — source credentials on the Bot.** The fan-in sources may need API keys in the Bot environment. 0343's render lists them as routine inputs; provisioning them is an operator action.
- **DEFERRED — operator override.** If the operator prefers store-on-Bot at review, 0343's Design changes accordingly. The ADR's "Rejected" section is where that argument goes.

### Design

**WHAT.** A documentation-only decision: one ADR, one design subsection, one architecture pointer. `mutationPolicy: none` for source.

**WHERE.**
- `docs/00_ADR.md` (append ADR-044 after ADR-043).
- The owning collect/schedule design doc (verify the owner with `rg -l "kk-collect" docs/design`).
- `docs/03_ARCHITECTURE.md` (one pointer line).

**Frozen names** (0343 consumes these):

| Name | Value |
| --- | --- |
| ADR | `ADR-044` |
| sync branch | `kk-cloud-sync` |
| artifact path | `sync/<schedule>/<stamp>.json`, where `<stamp>` is `YYYYMMDDTHHMMZ`, the same format as kk-collect |
| import run id | `cloud-<stamp>` |
| no-content line | `no-content: <reason>` |
| staleness | 26 h |

**Seam.**
`Bot routine: kk executor fan-in --out sync/kk-collect/<stamp>.json` → `git push kk-cloud-sync` → `Mac (cron): git fetch && kk store ingest --run cloud-<stamp> --in <file>`.

**Invariants.**
- No cloud path opens `kk.db`.
- No cloud path publishes.
- ADR-022 is untouched.

**Anti-patterns.**
- Syncing `kk.db` or its WAL.
- Adding a `kk sync` verb.
- Rewording ADR-022 or ADR-030 instead of cross-referencing them.

**Handoff.** 0343 renders routine text that encodes this table verbatim and refuses grok-bot for store- or browser-bound schedules, citing ADR-044.

### Plan

- [x] 1. Confirm the owning design doc and the ADR numbering (`grep -n "^## ADR-04" docs/00_ADR.md`).
- [x] 2. Write ADR-044 per R1–R3 (R1, R2, R3).
- [x] 3. Add the design subsection and the 03 pointer (R4).
- [x] 4. Run `bun run lint` and `bun run spur-check`; check `git status --short` (R5).

### Solution

- `docs/00_ADR.md` — appended `## ADR-044: Grok Bot cloud routines prepare inputs; the Mac owns the kk store` after ADR-043: Status (Accepted · 2026-11-04 · F81 · task 0341), four decision points, the missing/stale-input policy table (`no-content: <reason>` / 26 h staleness / once-only import by `cloud-<stamp>`), Rejected (store-on-Bot: SQLite-over-network, Keychain-bound browser profiles, ephemeral member packages, shared 300/h cap; and store sync via git/iCloud), Revisit-when, and the Detail cross-references.
- `docs/design/kk-collect-and-daily-voice2.md` — new `## 10. Grok Bot cloud routines (ADR-044, design — F81)`: seam diagram (Bot `kk executor fan-in` → `kk-cloud-sync` → Mac `kk store ingest`), the policy table, the chat-only routine-creation note and the render-refusal contract for 0343.
- `docs/03_ARCHITECTURE.md` — one pointer (three lines) at the Pipeline model DAG paragraph: store handoff follows the file-seam pattern, everything store/browser-bound stays Mac-side, cross-references ADR-044 and design §10.

Rationale: documentation-only decision (mutationPolicy: none). The seam reuses the existing fan-in/ingest file contract at `plugins/kk/workflows/kk-collect.yaml:96-102` — zero new verbs, per the task's frozen Design.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | docs/00_ADR.md:1602 ADR-044 heading; :1606-1613 decision points 1-4 incl. branch `kk-cloud-sync` and `sync/<schedule>/<stamp>.json`; :1613 ADR-022 unchanged |
| R2 | MET | docs/00_ADR.md:1615-1619 policy table: `no-content: <reason>` no-side-effect exit; >26 h ignored matching kk-collect.yaml:110; once-only import by `--run cloud-<stamp>` |
| R3 | MET | docs/00_ADR.md:1621-1628 Rejected store-on-Bot (SQLite over network, Keychain-bound profiles, ephemeral member packages, shared 300/h cap) plus kk.db sync via git/iCloud; :1629 Revisit-when condition |
| R4 | MET | docs/design/kk-collect-and-daily-voice2.md:359 design section 10 with seam diagram + policy table; docs/03_ARCHITECTURE.md:147 Pipeline-model pointer to ADR-044 and design section 10 |
| R5 | MET | command: `bun run lint` exit 0; `spur task gate 0341 run` quality gate PASS receipt .spur/run/0341-check-receipt.json tree 736ebb9563f0c3ac3e8a536defa5b12e0a614cc6; `spur task gate 0341 status` → {"reuse":true,"reason":"ok"} |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — ADR-044 records the decision completely (req: R1, R3) | MET | command | command `grep -n "kk-cloud-sync" docs/00_ADR.md` → hits at docs/00_ADR.md:1609 (branch + path + stamp format) and :1621-1629 (Rejected + Revisit-when present; see also :1602 heading) |
| AC2 — Missing/stale policy is explicit (req: R2) | MET | command | command `grep -nE "no-content: <reason>" docs/00_ADR.md` → docs/00_ADR.md:1617; `grep -n "26 h"` → :1618 (26 h bound); `grep -nE "cloud-<stamp>"` → :1619 (once-only import) |
| AC3 — Design and architecture point to the decision (req: R4) | MET | command | command `grep -n "ADR-044" docs/03_ARCHITECTURE.md` → docs/03_ARCHITECTURE.md:147; `grep -n "^## 10\. Grok Bot cloud routines" docs/design/kk-collect-and-daily-voice2.md` → docs/design/kk-collect-and-daily-voice2.md:359 |
| AC4 — Gates pass (req: R5) | MET | command | `spur task gate 0341 run` PASS at tree 736ebb95 (receipt reuse confirmed via status) |
| R3 — Store locality decision precedes cloud execution (R3) | MET | command | ADR dated 2026-11-04 accepted before task 0343; command `grep -n "0343" docs/00_ADR.md` → docs/00_ADR.md:1631 Detail render-refusal contract; design section 10 refusal clause (docs/design/kk-collect-and-daily-voice2.md:388) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- Review of run 22ff1d8f (host driver, review lane): full diff review + `spur task verdict 0341 --from-answer`. -->

Confidence: HIGH

| Priority | Finding | Disposition |
| -------- | ------- | ----------- |
| P4 | Policy-table numbers (26 h horizon, 300/h cap) rest on task Background facts verified 2026-11-04 — re-verify verbatim text when 0343 encodes them into `kk schedule render` | closed: covered by task 0343 Detail render-refusal contract |

No open P1–P3 findings (docs-only change: ADR-044 at docs/00_ADR.md:1602-1631, design §10 at docs/design/kk-collect-and-daily-voice2.md:359, architecture pointer at docs/03_ARCHITECTURE.md:147). Residual risk: none — no source, runtime, or config behavior touched.

Verdict: PASS

### References

- Feature: `docs/features/F81_grok-bot-cloud-routines-for-knowledge-kit.md` (R3)
- `docs/00_ADR.md` ADR-022 :964, ADR-030 :1200, ADR-042 :1563, ADR-043 :1580
- https://docs.x.ai/grok-bot/computers · https://docs.x.ai/grok-bot/skills-routines-and-automations
- https://www.sqlite.org/useovernet.html · https://www.sqlite.org/howtocorrupt.html
- `plugins/kk/workflows/kk-collect.yaml:96-102` (fan-in seam)
- Downstream: 0343

### History

- 2026-11-04T23:03:30.711Z feature_id Q → F81 (system)
- 2026-11-04T23:41:01.778Z backlog → todo (system)
- 2026-11-05T00:57:42.306Z todo → wip (system)
- 2026-11-05T03:29:28.635Z wip → testing (system)
- 2026-11-05T03:29:36.288Z testing → done (system)

