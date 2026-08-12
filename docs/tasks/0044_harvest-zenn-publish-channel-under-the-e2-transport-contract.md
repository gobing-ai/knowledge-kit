---
template: feature-impl
schema_version: 1
name: "Harvest Zenn publish channel under the E2 transport contract"
description: ""
status: todo
type: task
profile: standard
feature_id: E4
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-12T07:07:36.137Z"
updated_at: "2026-08-12T07:10:24.869Z"
---

## 0044. Harvest Zenn publish channel under the E2 transport contract

### Background

Implements: R1 — A harvested channel implements the shared transport contract; R2 — A harvested channel fails loud on a transport error (Zenn channel).

First channel in the E Notes build order (Zenn + Qiita first, per E4 Scope and the E parent's deferred-channel note: "Zenn + Qiita first → one browser target to prove BrowserTransport → remaining"). Harvest strategy: absorb the existing wt-publish-to-zenn skill flow as a kk PublishPlugin under the E2 transport abstraction (@gobing-ai/publish-harness PublishTransport), mirroring the tested plugins/surfdash-pub (E3) shape: plugin.json manifest, --in/--out invocation, ContentSchema -> ResultSchema, fail-loud exit semantics per docs/design/publish-plugin-specification.md §2.5.

Per the E1 audit (task 0002): Zenn is File/CLI (Zenn CLI, GitHub-backed), Low risk, no auth profile needed.

Rubric: E5 D1 L1 C0 R1 = 7 -> decompose (child of E4 wave; independent deliverable with its own plugin dir and review boundary).

### Requirements
- [ ] R1. Render Content as Zenn markdown with target frontmatter (title, topics, published flag, body).
- [ ] R2. Publish via a Zenn FileCli transport (Zenn CLI through child process) implementing the E2 PublishTransport interface.
- [ ] R3. Write a Result satisfying the shared contract (ok/target/url/id/message/error), same shape as the Surfdash publisher.
- [ ] R4. Fail loud: transport/CLI failure writes Result with ok: false + error, logs to stderr, and exits non-zero (spec §2.5).
- [ ] R5. Pass offline harness tests (FakeFileCliTransport + a spy transport) covering success, validation failure, and transport-error paths with no external effects.
### Acceptance Criteria
```gherkin
Scenario: A harvested channel implements the shared transport contract
  Given the Zenn channel harvested as a PublishPlugin under the E2 transport abstraction
  When its publish path runs against the offline test harness
  Then it satisfies the same Result contract as the Surfdash publisher

Scenario: A harvested channel fails loud on a transport error
  Given the Zenn channel whose transport rejects the request
  When publish runs
  Then it exits non-zero rather than reporting success

Scenario: R1 — Content maps to Zenn markdown with frontmatter
  Given a valid Content payload
  When the mapping runs
  Then it renders title, topics, and published flag into Zenn markdown

Scenario: R2 — publish runs through the Zenn FileCli transport
  Given a valid Content payload
  When publish executes the Zenn CLI
  Then it returns a Result from the transport

Scenario: R3 — Result matches the shared contract
  Given a successful publish
  Then the Result carries ok true, target "zenn", url, and message

Scenario: R4 — transport failure exits non-zero
  Given a transport that rejects the request
  When publish runs
  Then it writes ok false with a diagnostic and exits non-zero

Scenario: R5 — offline harness tests pass
  Given the Zenn plugin and the publish-harness fakes
  When the unit tests run
  Then success, validation-failure, and transport-error paths are covered without external effects
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Approach: absorb as a kk plugin — `plugins/zenn-pub` mirroring `plugins/surfdash-pub` (E3): `mapContentToZennMarkdown(content)` + `ZennCliFileCliTransport` + `processPublishIO(inputPath, outputPath, transport)` + `main()` exit-code contract. The transport writes the article into the configured Zenn/GitHub repository and invokes the existing CLI workflow; repository/auth configuration stays in environment variables.

Rejected: wrap-in-place — the wt-publish-to-zenn skill is not a plugin; it cannot be discovered by `kk plugins`, invoked via `--in`/`--out`, or composed by `kk fanout`, so it cannot satisfy the feature contract. Rejected: browser/Playwright transport — the audited Zenn CLI/GitHub path is the existing low-risk FileCli route.

Invariants: Result shape identical to E3 Surfdash; secrets and repository credentials are env-only, never in `plugin.json` or Result metadata; all tests are offline via publish-harness fakes. Do not add a transport kind, core schema, CLI command, or shared mapper; target-specific mapping stays inside the plugin.

Primary targets: `plugins/zenn-pub/plugin.json`, `plugins/zenn-pub/package.json`, `plugins/zenn-pub/tsconfig.json`, `plugins/zenn-pub/src/index.ts`, and `plugins/zenn-pub/tests/zenn-pub.test.ts`. Reuse `@gobing-ai/kk-core`, `@gobing-ai/publish-harness`, and `@gobing-ai/utils`; do not add dependencies unless the audited local skill cannot be adapted with Bun APIs.

Key signatures: `class ZennCliFileCliTransport implements PublishTransport { readonly kind = 'file-cli'; publish(payload: PublishTransportPayload): Promise<Result> }`; `mapContentToZennMarkdown(content: Content): string`; `processPublishIO(inputPath: string, outputPath: string, transport?: PublishTransport): Promise<void>`; `main(): Promise<number>`.
### Plan
1. Audit wt-publish-to-zenn skill + publish spec; record Zenn-specific mapping decisions in Design.
2. Scaffold plugins/zenn-pub (plugin.json kind: publish, src/index.ts, tests/, tsconfig per E3).
3. Implement mapContentToZennMarkdown + ZennCliFileCliTransport + processPublishIO/main.
4. Write offline harness tests: success, validation failure, transport error.
5. Wire workspace deps (@gobing-ai/kk-core, @gobing-ai/publish-harness, @gobing-ai/utils); run lint + typecheck + tests.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature E4
- Task 0002 — source audit and transport classification
- `docs/design/publish-plugin-specification.md`
- `plugins/surfdash-pub/src/index.ts` and `plugins/surfdash-pub/tests/surfdash-pub.test.ts` — shipped reference instance
- `wt-publish-to-zenn/SKILL.md` and its local scripts — source to audit/adapt
### History
