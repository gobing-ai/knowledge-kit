---
schema_version: 1
name: Synthesize voice2 episode sections and join them for the duration check
status: todo
template: feature-impl
created_at: 2026-10-09T07:35:29.460Z
updated_at: "2026-10-09T07:35:29.465Z"
feature_id: G13
priority: P0
tags:
  - voice2
  - audio
estimate_hours: 8

---

## 0237. Synthesize voice2 episode sections and join them for the duration check

### Background

Implements: R1 — Selected items become an opening, one section each, and a closing; R2 — Each section keeps its own audio file across a retry; R3 — Joined speech plus the intro sting is the episode the duration check reads; R4 — Everyday synthesis converts one section at a time; R5 — An over-long episode re-synthesizes only changed sections; R6 — An account-level provider refusal stops and keeps finished sections.

- Rubric: E2 D1 L1 C1 R1 = 6. Cohesion keeps one task: every scenario lands in `dailyGenerate` plus the existing intro and duration readers. A second task would edit the same function.
- Rejected split: one task per scenario. Rejected split: a separate recovery task. Both would share `plugins/kk/scripts/daily-stages.ts`.
- Pre-batch quiz auto-skipped because profile=auto.
- Deferred: inventory I9, synthesizing more than one section at a time.

### Requirements

- [ ] R1. Six selected items become one opening, six item sections, and one closing. Fact chunks stay inside their item.
- [ ] R2. A section whose audio file exists and whose spoken text is unchanged is not synthesized again. A section with no audio file, or whose spoken text changed, is synthesized to its own file.
- [ ] R3. Section speech is joined in order, the existing intro sting is applied after that speech, and the duration check reads that one file. An episode outside 15 to 20 minutes is refused. The voice1 workflow file stays byte-identical.
- [ ] R4. With the everyday concurrency count of 1, one section is converted at a time. A concurrency count above 1 is refused in this delivery.
- [ ] R5. After the spoken text of the long sections is shortened, only those changed sections are synthesized again. Unchanged sections keep their audio files.
- [ ] R6. An account-level provider refusal stops the run and keeps the finished section files. The run does not switch driver in the middle of the episode.

### Acceptance Criteria

```gherkin
- [ ] AC1 — Selected items become an opening, one section each, and a closing
- [ ] AC2 — Each section keeps its own audio file across a retry
- [ ] AC3 — Joined speech plus the intro sting is the episode the duration check reads
- [ ] AC4 — Everyday synthesis converts one section at a time
- [ ] AC5 — An over-long episode re-synthesizes only changed sections
- [ ] AC6 — An account-level provider refusal stops and keeps finished sections

Scenario: AC1 — Selected items become an opening, one section each, and a closing (req: R1)
Scenario: AC2 — Each section keeps its own audio file across a retry (req: R2)
Scenario: AC3 — Joined speech plus the intro sting is the episode the duration check reads (req: R3)
Scenario: AC4 — Everyday synthesis converts one section at a time (req: R4)
Scenario: AC5 — An over-long episode re-synthesizes only changed sections (req: R5)
Scenario: AC6 — An account-level provider refusal stops and keeps finished sections (req: R6)
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: optional sixth argument `section_concurrency` on `dailyGenerate`. Voice2 passes `1`. An absent argument keeps today's one-request job, so the voice1 command and its behavior stay.

Why: the paid unit matches the section an operator rewrites.

Rejected:
- One request per 300-character fact chunk. That is finer than the rewrite unit. Use it only inside a section that still exceeds one request.
- A new workflow node, or a spur parallel node. Fan-out stays inside `kk`.
- Editing `script-builder.ts`. That would change voice1 script bytes.

Invariants:
- Sections are opening + one per spoken item + closing.
- Cache key is sha256 of section text, voice profile id, and resolved driver id.
- Resume is missing audio or a hash mismatch.
- Joined speech, then the existing intro sting. Duration stays 15–20 minutes.
- A character-rate estimate over 20 minutes spends nothing and names the longest sections. The stage does not rewrite the script.
- Account-window refusal stops the run. The Gemini probe fallback applies only when no section request has been sent yet.
- Shortening section text changes the VoiceScript yaml, so the safety stamp must be issued again. An unchanged section does not.

Signatures: `dailyGenerate(args: string[]): void` with an optional sixth argument. Satellite: `docs/design/segmented-episode-speech.md`. Decision: ADR-034.

### Plan

1. Rubric: E2 D1 L1 C1 R1 = 6, kept as one task by cohesion. Pre-batch quiz auto-skipped because profile=auto.
2. Add a voice2-only grouper that reads the written VoiceScript and checks the item count against the script plan.
3. Synthesize one section at a time, with the per-section hash cache, and refuse concurrency above 1.
4. Join section audio, clear the intro marker when speech changed, and leave intro, duration, and publish-prep on their current files.
5. Stop on an account-window refusal without switching driver. Keep the probe fallback for a failure that happens first.
6. Estimate duration from the documented character rates and refuse a predicted overrun without spending a request.
7. Add stage tests for grouping, cache reuse, partial resynthesis, the duration file, voice1 byte identity, and account-window stop. Same change updates the voice2 workflow argument and the `04` stage row (T3). Do not edit `kk-daily-ai-voice.yaml` or `script-builder.ts`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
