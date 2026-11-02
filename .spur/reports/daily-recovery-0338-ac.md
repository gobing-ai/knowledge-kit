Scenario: AC1 — successful primary review survives an unavailable retry (req: R1)
Given a primary safety reviewer wrote a valid report and a judge wrote a valid verdict
When the configured fallback is unavailable
Then the fallback is skipped and the unchanged reviewed drafts remain admissible

Scenario: AC2 — invalid review output stays blocked after bounded recovery (req: R1)
Given neither review attempt produces valid evidence
When the bounded safety workflow finishes
Then publication remains blocked with a recorded failure

Scenario: AC3 — changed supply or floor recovers no-content planning (req: R2)
Given a prior candidate cache was emptied by a duration-floor refusal
When decisive planning or QC inputs change
Then the next stage invocation recomputes rather than replaying the refusal

Scenario: AC4 — missing or duplicate primary receipts never establish full publication (req: R3)
Given primary publication has missing failed duplicate or unrelated receipts
When classification and store settlement run
Then actual successes remain visible and incomplete publication never promotes selections

Scenario: AC5 — recovery evidence records actual checks and activation state (req: R4, R5)
Given historical runs are inspected without replaying publication
When automated checks and an isolated rehearsal complete
Then a durable report records outcomes remaining authentication blockers and the exact active schedule
