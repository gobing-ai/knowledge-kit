---
schema_version: 1
name: Record kk bot operator sessions and generate channel rails from them
status: backlog
template: feature-impl
created_at: 2026-11-17T04:31:47.321Z
updated_at: "2026-11-17T04:31:56.446Z"
feature_id: A22

---

## 0382. Record kk bot operator sessions and generate channel rails from them

### Background

Captured from the creation title: "Record kk bot operator sessions and generate channel rails from them".

### Requirements

- [ ] R1. **Recorder verb** — `kk bot record --name <bot> [--out <path>] [--include-text] [--redact]` launches the existing named bot profile headed (reusing kkBrowserLauncher so KK_BROWSER_CHANNEL, browser leases and SingletonLock all apply) and writes an ordered JSON transcript of the operator's session: navigation, clicks, key events, file-chooser selections, and every POST/PUT/PATCH response (url, status, bounded JSON body). It always releases the browser lease on exit, including SIGINT, because a leaked lease blocks the next channel preflight (measured 2026-11-16: two preflights refused with 'held by pid N').

- [ ] R2. **Stable-selector normalization** — every recorded click resolves to a selector by a fixed rank: data-testid > name > exact aria-label > role+text > exact text > structural path. Hashed or CSS-in-JS class names are never emitted (r-, css-, and the reshuffled mxtl*/mxta* families observed on LinkedIn and X). Nodes that were not visible at record time are excluded, because the DOM carries hidden duplicates (the Threads 'New thread' control has one, which is why a text locator clicked an invisible node). A candidate matching more than one node is written as 'ambiguous' with its siblings instead of being silently narrowed.

- [ ] R3. **Codegen verb** — `kk bot codegen --transcript <f> --plugin <name> --operation <op> [--apply]` emits a rail skeleton: a selector constant table, the ordered steps expressed with the existing harness helpers (resolveSelector, uploadFile, expectOutcome), and a receipt block derived from the captured submit response (a waitForResponse matcher plus the JSON path carrying the id/url). Without --apply it writes to stdout; with --apply it writes a sibling .generated.ts. Promoting the generated rail into the live rail stays an operator edit. A step with no stable selector aborts the codegen naming that step index.

- [ ] R4. **Receipt from the platform's own response** — the generated receipt must read the publish id from the recorded submit/upload response, never from a DOM text comparison. Measured 2026-11-16: the X and weibo rails reported 'not published' for posts that had published, because they compared rendered text; the id was in the response all along (weibo uploadPic returns pic_id; X CreateTweet returns rest_id).

- [ ] R5. **Replay verb** — `kk bot replay --transcript <f> [--no-submit]` re-runs the recorded steps against the live site, defaulting to stopping before the submit click, and compares pre-submit state with the recording: per-step screenshot plus a state diff (url, resolved selector count, editor text length). A transcript that cannot replay is not usable for codegen, and the replay result is the acceptance evidence for whichever task adds a channel.

- [ ] R6. **Privacy and safety** — typed text is redacted to a length marker unless --include-text is passed; cookies, headers, tokens and response fields matching secret patterns are never written. Replay refuses a transcript that holds unredacted secrets.

- [ ] R7. **Golden fixtures** — the four hand-measured 2026-11-16 sessions (x, threads, linkedin, weibo) are committed as redacted transcripts under the plugin test trees and drive offline codegen snapshot tests, so the normalizer and codegen are covered with no live browser.

- [ ] R8. **Skill and process wiring** — kk-web-automation gains the record → replay → codegen playbook (it already owns 'method and evidence; transport stays in kk plugins'), kk-publish and sp-code-implementation point at it when a rail must be authored or repaired, and a repo rule requires a rail change to name its transcript (or state why no recording exists) so selector guessing cannot quietly return.

AC1. A recorded channel flow yields a transcript whose every step has a stable selector or an explicit ambiguous marker, and codegen emits compiling TypeScript a reviewer can diff against the recording.
AC2. `kk bot replay --no-submit` passes on at least two of the four 2026-11-16 sessions, storing per-step screenshots as evidence.
AC3. The generated receipt reads the id from the captured response; a test proves a DOM-text mismatch cannot change the verdict.
AC4. Interrupting the recorder leaves no browser lease behind (test: start and interrupt a recording against a local fixture).
AC5. Offline tests cover normalization (hash rejection, hidden-node rejection, ambiguity) and codegen snapshots for the four fixtures; bun run lint and bun run test pass.
AC6. No transcript or generated file contains a cookie, token or unredacted typed text (secret-scanning test).

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Do not leave placeholder AC here. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

- [ ] 1. Recorder core: `kk bot record` reuses kkBrowserLauncher + leases, records clicks/keys/file-choices/navigation and POST-PUT-PATCH responses into an ordered transcript; lease released on SIGINT.
- [ ] 2. Normalizer: rank data-testid > name > aria-label > role+text > text > path; reject hashed classes; drop invisible nodes; mark ambiguity with siblings; deterministic unit tests for each rule.
- [ ] 3. Response capture as receipt source: store bounded JSON per mutating call and expose a `pick` path (e.g. `pic_id`, `data.create_tweet.tweet_results.result.rest_id`).
- [ ] 4. `kk bot codegen`: transcript → selector constants + ordered steps over the harness helpers + receipt block; stdout by default, `.generated.ts` with `--apply`; abort on an unstable step.
- [ ] 5. `kk bot replay [--no-submit]`: re-run steps, per-step screenshot + state diff, PASS/FAIL; refuse unredacted secrets.
- [ ] 6. Offline fixtures: redact and commit the four 2026-11-16 sessions (x, threads, linkedin, weibo) plus codegen snapshot tests; interrupt test proves no lease leak.
- [ ] 7. Skills: extend `kk-web-automation` with the record → replay → codegen playbook; cross-link from `kk-publish` and `sp-code-implementation`.
- [ ] 8. Rule: a channel-rail change must name its transcript (or justify its absence); add the constraint rule and run `spur rule run`.
- [ ] 9. Docs: `docs/04_DESIGN.md` surface for the three verbs and `docs/design/kk-bot-record-codegen.md` for the transcript schema and normalization contract.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
