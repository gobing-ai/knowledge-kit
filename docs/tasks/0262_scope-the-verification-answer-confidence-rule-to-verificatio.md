---
schema_version: 1
name: Scope the verification-answer confidence rule to verification answers
status: backlog
template: feature-impl
created_at: 2026-10-12T17:00:27.606Z
updated_at: "2026-10-12T17:04:24.924Z"
feature_id: G8

priority: P2
estimate_hours: 1
---

## 0262. Scope the verification-answer confidence rule to verification answers

### Background

Measured 2026-10-12, immediately after the E94 batch landed on `main`: `bun run spur-check` failed in the
pre-check tier on the newly landed rule `verification-answer-carries-confidence-level` (exit 1), and that rule's
own suite failed its `no-artifacts-is-not-a-finding` case. Every offending artifact was a **review** answer:

```
INVALID: .spur/run/0243-e94-0ee12e5a-review-answer.txt: answer asserts a verdict but carries 0 Confidence: HIGH|MEDIUM|LOW line(s) (want exactly 1)
… 0244-…-review-answer.txt, 0245-…-review-answer.txt, 0246-…-review-answer.txt
18 passed, 1 failed   (case: no-artifacts-is-not-a-finding)
```

Annotating those four files with their true level turned both green (`OK: 8 answer artifact(s) judged`,
`19 passed, 0 failed`), but that is a stopgap on disposable run-plane files: the **structural** mismatch
remains, because the two answer types have different contracts.

- The verify answer owns the confidence contract — exactly one `Confidence: HIGH|MEDIUM|LOW` line
  (`plugins/sp/skills/code-verification/references/verdict-schema.md`, "Answer-File Schema Contract").
- The review answer's machine-read line is its verdict only; the review coordinator's output contract
  (`plugins/sp/skills/sp-super-reviewer/SKILL.md`, Output Format) carries no confidence field, and the
  pipeline's review guard reads nothing else.

So any batch that produces review answers trips the rule until it is scoped (or the review contract gains a
level). The rule's cutoff (`2026-10-12T04:00:00Z`) means newer artifacts are judged, which is exactly the batch
case; the 199 pre-cutoff files are reported as debt and are not the target here.

A second false positive of the same class surfaced while filing this task. In the **same rule family**,
`verification-block-carries-confidence-level` (`.sh` check 2) flags any line containing the confidence token
whose value is not the bare enum — so a task or doc that *documents* the contract trips it. This task's own body
tripped it on four lines (`.spur/rules/structure/verification-confidence-level.sh`, the `rg -v` enumeration at
check 2), which had to be reworded to satisfy the gate. Mentions are not claims: the checker should judge
verification records and claimed levels, not quoted grammar.

**Evidence anchor:** `.spur/run/merge-E94-postgate.log` (the red tier),
`.spur/rules/structure/verification-answer-confidence-level.sh --no-since` (file/line list),
`.spur/rules/structure/verification-answer-confidence-level.test.sh` (the failing case),
`sh .spur/rules/structure/verification-confidence-level.sh` (the mention false positive on this task's own body).

**Owner note:** both fixes belong to this repository's rule files under `.spur/rules/structure/`. Changing the
review contract instead would mean editing the `sp` plugin's review skill, which is installed from the
`gobing-ai/spur` marketplace and is not owned by this repo — so the in-repo remedy is the rules' own selection
and matching predicates.

### Requirements

- [ ] R1. `verification-answer-confidence-level` must not judge `*-review-answer.txt` as a verification answer: a run plane whose only recent answer artifact is a review answer carrying its verdict line and no level line must pass. Prefer narrowing the rule's selection to verification answers (`*-verify-answer.txt`), and state the chosen predicate in the rule's comment/description.
- [ ] R2. The rule keeps failing a verification answer that asserts a verdict without exactly one `Confidence: HIGH|MEDIUM|LOW` line, with its current message shape.
- [ ] R3. `verification-answer-confidence-level.test.sh` gains a case for the review-answer artifact (accepted under the narrowed predicate) and keeps every existing case green; the `no-artifacts-is-not-a-finding` case must pass on a plane that contains a review answer.
- [ ] R4. `spur rule run --preset recommended-pre-check --fail-on warning` stays green on the merged tree with a freshly written review answer present in `.spur/run/`.
- [ ] R5. `verification-block-carries-confidence-level` (same script family, check 2) must judge **claimed** levels, not mentions: a task or design doc that quotes the contract's token in prose, or names the enum as a set, must not be flagged; a record that actually claims a level outside `HIGH|MEDIUM|LOW` must still fail. Record the chosen predicate in the rule's comment and cover both directions in `verification-confidence-level.test.sh`.

**Out of scope:** changing the review-coordinator contract in the installed `sp` plugin; re-annotating historical run-plane answers; the 199 pre-cutoff files reported as debt.

### Acceptance Criteria

- [ ] AC1 — a run plane whose only recent answer artifact is a review answer carrying its verdict line and no level line does not fail the rule (req: R1)
- [ ] AC2 — a verification answer that asserts a verdict without exactly one `Confidence: HIGH|MEDIUM|LOW` line still fails with the existing message shape (req: R2)
- [ ] AC3 — `sh .spur/rules/structure/verification-answer-confidence-level.test.sh` passes, including the new review-answer case and the `no-artifacts-is-not-a-finding` case on a plane containing a review answer (req: R3)
- [ ] AC4 — this task's own body, and a doc quoting the contract's token in prose, pass `verification-confidence-level.sh` while a record claiming a level outside the enum still fails it (req: R5)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- **Approach:** scope the rule's artifact selection instead of widening the review contract. The rule already walks the run plane and filters by filename; restrict that filter to verification answers and record why in the rule's description, so the next reader does not re-derive the mismatch.
- **Where:** `.spur/rules/structure/verification-answer-confidence-level.sh` (selection predicate), `.spur/rules/structure/verification-answer-confidence-level.yaml` (description/args if the predicate is declared there), `.spur/rules/structure/verification-answer-confidence-level.test.sh` (new case).
- **Reproduce first:** write a review answer carrying its verdict line and no level line into a scratch run plane, run the rule, and observe the current false positive; then apply the predicate and re-run.
- **Anti-patterns:** do not widen the rule to *require* a level on review answers (that would contradict the review contract and force a contract change in a plugin this repo does not own); do not silence the rule with a path exclusion that also drops verification answers; do not re-annotate historical artifacts.
- **Evidence for the fix:** the rule's suite output before/after and a `spur rule run --preset recommended-pre-check` run on a plane containing a review answer.

### Plan

- [ ] 1. Reproduce both false positives: a scratch review answer plus `sh .spur/rules/structure/verification-answer-confidence-level.sh`, and this task's own body plus `sh .spur/rules/structure/verification-confidence-level.sh`; record both outputs (req: R1, R5).
- [ ] 2. Narrow the answer rule's selection predicate and update its description; make check 2 judge claimed levels rather than mentions, and update that rule's description (req: R1, R2, R5).
- [ ] 3. Add the review-answer case to the answer rule's test script, and both mention/claim directions to `verification-confidence-level.test.sh`; keep every existing case (req: R3, R5).
- [ ] 4. Run both rule suites plus `spur rule run --preset recommended-pre-check --fail-on warning` with a fresh review answer present and this task's body unchanged; verify the failure paths by hand (req: R2, R3, R4).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
