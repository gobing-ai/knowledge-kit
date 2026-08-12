---
template: feature-impl
schema_version: 1
name: "Harvest Qiita publish channel under the E2 transport contract"
description: ""
status: todo
type: task
profile: standard
feature_id: E4
parent_wbs: null
priority: P2
tags: []
dependencies: ["0044"]
ac_numbering: task-local
created_at: "2026-08-12T07:07:36.157Z"
updated_at: "2026-08-12T07:10:25.437Z"
---

## 0045. Harvest Qiita publish channel under the E2 transport contract

### Background

Implements: R1 — A harvested channel implements the shared transport contract; R2 — A harvested channel fails loud on a transport error; R3 — Harvested channels compose with fan-out (Qiita channel; R3 proof lands here).

Second channel in the E Notes build order. Runs after the Zenn harvest — the R3 fan-out proof requires a second harvested channel, so this task's plan ends by running `kk fanout` with both plugins. Same harvest strategy as the Zenn task: absorb as a kk PublishPlugin (plugins/qiita-pub) under the E2 transport abstraction, mirroring plugins/surfdash-pub (E3).

Per the E1 audit (task 0002): Qiita is a token API ("also has a token API — a cleaner path", Low–Med risk) classified under File/CLI by the E2 design ("Two transports: File/CLI (Zenn CLI, Qiita API) vs Browser/Playwright"). Token via env.

Rubric: E6 D1 L1 C0 R1 = 8 -> decompose (child of E4 wave; independent deliverable, own plugin dir + review boundary; carries the pair-composition proof).

### Requirements
- [ ] R1. Render Content as Qiita markdown with target frontmatter (title, tags, private flag, body).
- [ ] R2. Publish via a Qiita token-API transport (`fetch`, token from env) implementing the E2 `PublishTransport` interface (`kind: 'file-cli'` per the E2 File/CLI classification).
- [ ] R3. Write a Result satisfying the shared contract (`ok`/`target`/`url`/`id`/`message`/`error`), same shape as the Surfdash publisher.
- [ ] R4. Fail loud: API/transport failure writes Result with `ok: false` + `error`, logs to stderr, and exits non-zero (spec §2.5).
- [ ] R5. Pass offline harness tests (`FakeFileCliTransport` + mocked `fetch`) covering success, validation failure, and API-error paths with no external effects.
- [ ] R6. After task 0044 lands, prove fan-out composition: `knowledge-kit fanout --content <content.json> --target zenn-pub --target qiita-pub --out <result.json>` yields one per-target entry per channel in the aggregate Result.
### Acceptance Criteria
```gherkin
Scenario: A harvested channel implements the shared transport contract
  Given the Qiita channel harvested as a PublishPlugin under the E2 transport abstraction
  When its publish path runs against the offline test harness
  Then it satisfies the same Result contract as the Surfdash publisher

Scenario: A harvested channel fails loud on a transport error
  Given the Qiita channel whose transport rejects the request
  When publish runs
  Then it exits non-zero rather than reporting success

Scenario: Harvested channels compose with fan-out
  Given two or more harvested channels
  When `kk fanout` dispatches content to them
  Then each channel contributes its own per-target entry to the aggregate Result

Scenario: R1 — Content maps to Qiita markdown with frontmatter
  Given a valid Content payload
  When the mapping runs
  Then it renders title, tags, and private flag into Qiita markdown

Scenario: R2 — publish runs through the Qiita token-API transport
  Given a valid Content payload and a QIITA_TOKEN env var
  When publish executes the API call
  Then it returns a Result from the transport

Scenario: R3 — Result matches the shared contract
  Given a successful publish
  Then the Result carries ok true, target "qiita", url, and message

Scenario: R4 — API failure exits non-zero
  Given an API that rejects the request
  When publish runs
  Then it writes ok false with a diagnostic and exits non-zero

Scenario: R5 — offline harness tests pass
  Given the Qiita plugin and the publish-harness fakes
  When the unit tests run
  Then success, validation-failure, and API-error paths are covered without external effects

Scenario: R6 — fan-out composes the harvested pair
  Given the Zenn and Qiita channels harvested
  When `kk fanout` dispatches one Content to both targets
  Then the aggregate Result contains one per-target entry per channel
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Approach: absorb as a kk plugin — `plugins/qiita-pub` mirroring `plugins/surfdash-pub` (E3): `mapContentToQiitaMarkdown(content)` + `QiitaApiTransport` (`fetch` with Qiita API token from env) + `processPublishIO` + `main()` exit-code contract. Transport kind stays `file-cli` — the E2 design already classifies the Qiita API under File/CLI; no `PublishTransport` contract change.

Rejected: wrap-in-place — a skill cannot be discovered/invoked/composed by the kk CLI. Rejected: browser/Playwright transport — the audited token API is the cleaner path and fits the existing E2 FileCli harness.

Invariants: Result shape identical to E3 Surfdash; token env-only (`process.env.QIITA_TOKEN`), never in `plugin.json` or Result metadata; all unit tests offline (fakes + mocked `fetch`). Do not add a transport kind, core schema, CLI command, HTTP client dependency, or shared mapper; Bun's native `fetch` and target-local mapping cover the task.

Primary targets: `plugins/qiita-pub/plugin.json`, `plugins/qiita-pub/package.json`, `plugins/qiita-pub/tsconfig.json`, `plugins/qiita-pub/src/index.ts`, and `plugins/qiita-pub/tests/qiita-pub.test.ts`. The pair-composition proof may extend `apps/cli/tests/fanout.test.ts`; production fan-out code is already shipped and must not change unless the test exposes a defect.

Dependency/handoff: task 0044 owns `zenn-pub`; this task assumes that manifest and entrypoint are discoverable, then leaves E4 with the real two-target fan-out proof. It must not reimplement or modify the Zenn plugin.

Key signatures: `class QiitaApiTransport implements PublishTransport { readonly kind = 'file-cli'; publish(payload: PublishTransportPayload): Promise<Result> }`; `mapContentToQiitaMarkdown(content: Content): string`; `processPublishIO(inputPath: string, outputPath: string, transport?: PublishTransport): Promise<void>`; `main(): Promise<number>`.
### Plan
1. Audit the local wt-publish-to-qiita skill and current Qiita API adapter; confirm request/response mapping without changing the E2 contract.
2. Add `plugins/qiita-pub` (`plugin.json`, `package.json`, `tsconfig.json`, `src/index.ts`, `tests/qiita-pub.test.ts`) following E3 conventions.
3. Implement `mapContentToQiitaMarkdown`, `QiitaApiTransport`, `processPublishIO`, and `main` with `QIITA_TOKEN` read only from the environment.
4. Add offline tests for success, invalid Content, missing token, and API error using `FakeFileCliTransport` and mocked `fetch`.
5. Run targeted plugin tests, then `bun run lint`, `bun run test`, and `bun run build`.
6. After 0044 lands, run `knowledge-kit fanout --content <content.json> --target zenn-pub --target qiita-pub --out <result.json>` against an isolated plugin root/fake transport setup and assert one aggregate target entry per channel.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature E4
- Task 0002 — source audit and transport classification
- Task 0044 — required Zenn channel predecessor
- `docs/design/publish-plugin-specification.md`
- `docs/design/fan-in-and-fan-out-specification.md`
- `plugins/surfdash-pub/src/index.ts` and `apps/cli/tests/fanout.test.ts` — shipped reference surfaces
- `wt-publish-to-qiita/SKILL.md` and its local scripts — source to audit/adapt
### History
