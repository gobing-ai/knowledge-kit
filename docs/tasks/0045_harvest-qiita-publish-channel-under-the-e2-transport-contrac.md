---
template: feature-impl
schema_version: 1
name: "Harvest Qiita publish channel under the E2 transport contract"
description: ""
status: done
type: task
profile: standard
feature_id: E4
parent_wbs: null
priority: P2
tags: []
dependencies: ["0044"]
ac_numbering: task-local
created_at: "2026-08-12T07:07:36.157Z"
updated_at: "2026-08-12T13:29:03.104Z"
---

## 0045. Harvest Qiita publish channel under the E2 transport contract

### Background

Implements: R1 — A harvested channel implements the shared transport contract; R2 — A harvested channel fails loud on a transport error; R3 — Harvested channels compose with fan-out (Qiita channel; R3 proof lands here).

Second channel in the E Notes build order. Runs after the Zenn harvest — the R3 fan-out proof requires a second harvested channel, so this task's plan ends by running `kk fanout` with both plugins. Same harvest strategy as the Zenn task: absorb as a kk PublishPlugin (plugins/qiita-pub) under the E2 transport abstraction, mirroring plugins/surfdash-pub (E3).

Per the E1 audit (task 0002): Qiita is a token API ("also has a token API — a cleaner path", Low–Med risk) classified under File/CLI by the E2 design ("Two transports: File/CLI (Zenn CLI, Qiita API) vs Browser/Playwright"). Token via env.

Rubric: E6 D1 L1 C0 R1 = 8 -> decompose (child of E4 wave; independent deliverable, own plugin dir + review boundary; carries the pair-composition proof).

### Requirements
- [x] R1. Render Content as Qiita markdown with target frontmatter (title, tags, private flag, body).
- [x] R2. Publish via a Qiita token-API transport (`fetch`, token from env) implementing the E2 `PublishTransport` interface (`kind: 'file-cli'` per the E2 File/CLI classification).
- [x] R3. Write a Result satisfying the shared contract (`ok`/`target`/`url`/`id`/`message`/`error`), same shape as the Surfdash publisher.
- [x] R4. Fail loud: API/transport failure writes Result with `ok: false` + `error`, logs to stderr, and exits non-zero (spec §2.5).
- [x] R5. Pass offline harness tests (`FakeFileCliTransport` + mocked `fetch`) covering success, validation failure, and API-error paths with no external effects.
- [x] R6. After task 0044 lands, prove fan-out composition: `knowledge-kit fanout --content <content.json> --target zenn-pub --target qiita-pub --out <result.json>` yields one per-target entry per channel in the aggregate Result.
### Acceptance Criteria
```gherkin
Scenario: R1 — A harvested channel implements the shared transport contract
  Given the Qiita channel harvested as a PublishPlugin under the E2 transport abstraction
  When Content is mapped and the offline publish path runs
  Then Qiita markdown frontmatter is produced and the Result matches the Surfdash contract

Scenario: R2 — A harvested channel implements the shared transport contract
  Given a valid Content payload and QIITA_TOKEN
  When publish executes through the Qiita token-API transport
  Then it returns a Result from the transport under the E2 PublishTransport interface

Scenario: R3 — A harvested channel implements the shared transport contract
  Given a successful Qiita publish
  Then the Result carries ok true, target "qiita", url, and message (shared contract)

Scenario: R4 — A harvested channel fails loud on a transport error
  Given the Qiita channel whose transport rejects the request
  When publish runs
  Then it writes ok false with a diagnostic and exits non-zero

Scenario: R5 — A harvested channel implements the shared transport contract
  Given the Qiita plugin and the publish-harness fakes
  When the unit tests run
  Then success, validation-failure, and API-error paths are covered without external effects

Scenario: R6 — Harvested channels compose with fan-out
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
Qiita channel harvested as `plugins/qiita-pub`, mirroring `plugins/surfdash-pub` (E3) and `plugins/zenn-pub` (E4 predecessor): publish-kind manifest, `--in`/`--out` invocation, `ContentSchema` -> `ResultSchema`, fail-loud exit semantics (spec §2.5). Transport is the Qiita API v2 token transport (`fetch`, token env-only) per the E2 File/CLI classification (task 0002 audit); transport `kind` stays `file-cli` — no `PublishTransport` contract change. No core schema, CLI command, HTTP client dependency, or shared mapper added (E2 invariants). Workspace deps wired via `bun install` (24 workspaces now include `@gobing-ai/qiita-pub`).

## Files

- `plugins/qiita-pub/plugin.json` — publish-kind manifest (`name: qiita-pub`, `kind: publish`, `entry: ./src/index.ts`) discoverable by `kk plugins` / `runInvoke`.
- `plugins/qiita-pub/package.json` — `@gobing-ai/qiita-pub` workspace; deps only `@gobing-ai/kk-core`, `@gobing-ai/publish-harness`, `@gobing-ai/utils` (`workspace:*`); no new dependencies.
- `plugins/qiita-pub/tsconfig.json` — extends `tooling/typescript/base.json`, includes `src` + `tests`.
- `plugins/qiita-pub/src/index.ts` — plugin implementation (key symbols below).
- `plugins/qiita-pub/tests/qiita-pub.test.ts` — offline harness tests (20 tests, 100% line coverage of the plugin source).
- `apps/cli/tests/fanout.test.ts` — R6 pair-composition proof appended to the existing `runFanout` suite (production fan-out code untouched).

## Key symbols (`plugins/qiita-pub/src/index.ts`)

- `plugins/qiita-pub/src/index.ts:9` — `QIITA_ITEMS_URL`: `POST https://qiita.com/api/v2/items`, audited from wt-publish-to-qiita `qiita-utils` (`QIITA_URLS.items`).
- `plugins/qiita-pub/src/index.ts:16` — `slugify`: lowercase-hyphenated tag slug per spec §2.3 — the slugified form is always Qiita-API-acceptable (alphanumeric/hyphen/underscore only).
- `plugins/qiita-pub/src/index.ts:37` — `resolveQiitaFields`: Content -> `{title (Content.title | first H1 | 'Untitled Post'), tags (metadata.tags|keywords slugified, deduped, empty slug -> clear validation error), private}`; `private` defaults `false`, honors `metadata.private`, and falls back to `!metadata.published` so the shared E2 `published` flag composes (E3/E4 convention).
- `plugins/qiita-pub/src/index.ts:82` — `renderQiitaMarkdown`: Qiita CLI-style frontmatter (title, block-style tags, private) + body; split from the mapper so `publish` resolves fields once and the rendered article agrees with the API payload.
- `plugins/qiita-pub/src/index.ts:93` — `mapContentToQiitaMarkdown`: R1 — renders the Qiita markdown with target frontmatter (title, tags, private flag) and body.
- `plugins/qiita-pub/src/index.ts:103` — `class QiitaApiTransport implements PublishTransport` (`kind = 'file-cli'`): R2/R4 — reads `QIITA_TOKEN` from env only (missing -> `ok:false` Result, no fetch; spec §2.4); unmappable tags -> `{ok:false, target:'qiita', error: 'Invalid Content: Invalid tag ...'}` before any fetch; `POST /api/v2/items` with `Authorization: Bearer <token>` and payload `{title, body, tags: [{name}], private}` via Bun native `fetch` (audited `buildApiHeaders`/`buildApiPayload`); non-2xx -> `{ok:false, target:'qiita', error: 'Qiita API request failed (HTTP <status> <statusText>): <body capped at 1000 chars>'}`; response missing `id`/`url` -> error Result; fetch rejection -> `Qiita transport error: ...`.
- `plugins/qiita-pub/src/index.ts:182` — `getPublishTransport`: `QiitaApiTransport` by default; `FakeFileCliTransport` when `KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake'` (offline harness, same switch as E3/E4).
- `plugins/qiita-pub/src/index.ts:192` — `writePublishResult`: Result JSON to `--out` with dir creation.
- `plugins/qiita-pub/src/index.ts:206` — `processPublishIO`: parses `--in` via `ContentSchema` -> `transport.publish` -> `ResultSchema`-validated Result to `--out`; validation failure and transport failure both write the fail-loud Result and reject so `main` exits 1 (spec §2.5, same as E4 Zenn).
- `plugins/qiita-pub/src/index.ts:232` — `main`: `--in`/`--out` arg parsing (invalid flags -> logged error + exit 1, no unhandled rejection), exit 0 on success / 1 on failure with stderr log; `plugins/qiita-pub/src/index.ts:260` — `import.meta.main` entry exits with `main()` code.

Result contract identical to E3/E4 (R3): `{ok, target: 'qiita', url: <Qiita item url>, id: <item id>, message}` on success; `{ok:false, target:'qiita', error}` on failure. Token is env-only (`QIITA_TOKEN`); never in `plugin.json` or Result metadata (spec §2.4).

## R6 fan-out proof

`apps/cli/tests/fanout.test.ts` — `runFanout` test `R6 — fan-out composes the harvested zenn-pub and qiita-pub pair under the fake transport`: dispatches one Content to `--target zenn-pub --target qiita-pub` through the real plugin entries (spawnPluginEntry) against the repo `plugins/` root with `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake`; asserts exit 0 and an aggregate Result with exactly one per-target entry per channel (`targets == ['zenn-pub', 'qiita-pub']`, each `status: 'published'`, summary `{total:2, succeeded:2}`). Production fan-out code (`apps/cli/src/fanout.ts`) unchanged.

## Verification

- `bun test plugins/qiita-pub/tests/qiita-pub.test.ts` — 20 pass / 0 fail; 100% line coverage of `plugins/qiita-pub/src/index.ts`.
- `bun run --filter @gobing-ai/qiita-pub typecheck` — exit 0.
- `bun test apps/cli/tests/fanout.test.ts` — 32 pass / 0 fail (incl. new R6 test); `bun run --filter @gobing-ai/knowledge-kit typecheck` — exit 0 (changed CLI test surface).
- Coverage: mapping (slugify / frontmatter with and without metadata / private + published-fallback flags / unmappable-tag validation error), transport (missing `QIITA_TOKEN`, mocked-fetch success with request-shape assertions + tag dedupe, HTTP 403 rejection, fetch network rejection, unmappable tag -> error Result without fetch), `processPublishIO` (FakeFileCliTransport success, transport-error Result, validation failure incl. invalid JSON), spy transport (invocation recording + error propagation), `main` (missing args, invalid flags -> exit 1, fake-transport success -> exit 0, failing publish -> exit 1 + error Result), `runInvoke` discovery of `qiita-pub`. All offline — mocked fetch / fakes only, no network or external effects (R5).
- Deferred (env-dependent, not offline-testable): a real `POST /api/v2/items` against Qiita; success and all failure paths are covered by mocked-fetch and error-Result tests.
### Testing
**Force re-verify (2026-08-12) — Verdict: PASS**

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `plugins/qiita-pub/src/index.ts:93-95` mapContentToQiitaMarkdown; tests `plugins/qiita-pub/tests/qiita-pub.test.ts:52-111` |
| R2 | MET | `plugins/qiita-pub/src/index.ts:103-177` QiitaApiTransport kind file-cli; tests `plugins/qiita-pub/tests/qiita-pub.test.ts:139-195` |
| R3 | MET | success Result (`plugins/qiita-pub/src/index.ts:162-168`); tests `plugins/qiita-pub/tests/qiita-pub.test.ts:139-204` |
| R4 | MET | ok:false + main exit 1 (`plugins/qiita-pub/src/index.ts:120-174,254-256`); tests `plugins/qiita-pub/tests/qiita-pub.test.ts:124,197,255,479` |
| R5 | MET | 20 pass / 0 fail offline harness (`bun test plugins/qiita-pub`) |
| R6 | MET | `apps/cli/tests/fanout.test.ts:764` zenn-pub + qiita-pub fanout under fake transport |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R1 — A harvested channel implements the shared transport contract | MET | test | `plugins/qiita-pub/tests/qiita-pub.test.ts:52-111,302,514` |
| Scenario: R2 — A harvested channel implements the shared transport contract | MET | test | `plugins/qiita-pub/tests/qiita-pub.test.ts:139-195` |
| Scenario: R3 — A harvested channel implements the shared transport contract | MET | test | `plugins/qiita-pub/tests/qiita-pub.test.ts:139-204` |
| Scenario: R4 — A harvested channel fails loud on a transport error | MET | test | `plugins/qiita-pub/tests/qiita-pub.test.ts:197,255,479` |
| Scenario: R5 — A harvested channel implements the shared transport contract | MET | test | 20 pass / 0 fail (`bun test plugins/qiita-pub`) |
| Scenario: R6 — Harvested channels compose with fan-out | MET | test | `apps/cli/tests/fanout.test.ts:764` |
| A harvested channel implements the shared transport contract | MET | test | feature AC id alias |
| A harvested channel fails loud on a transport error | MET | test | feature AC id alias |
| Harvested channels compose with fan-out | MET | test | feature AC id alias |

- Coverage: N/A (verdict-based)
- Artifact: `.spur/run/0045-verdict.json`
- SECUA: no P1–P3
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P3 | Docs/Correctness | `docs/tasks/0045_...md` ## Solution | All 11 Solution line anchors are stale by exactly +4 vs the current file (e.g. QIITA_ITEMS_URL cited :13, actual `plugins/qiita-pub/src/index.ts:9`; `import.meta.main` cited :236, actual :232). Anti-stale-citation rule: anchors resolve to adjacent comments/blank lines, not the named symbols. Re-anchor on a later pass. |
| P3 | Architecture | `plugins/qiita-pub/src/index.ts:80` | R1 mapper `mapContentToQiitaMarkdown` is exported and tested but never consumed by the runtime path — `QiitaApiTransport.publish` (:93-118) sends `payload.content.body` + resolved fields straight to the API. Correct behavior (frontmatter embedded in the API body would render literally in the article), but unlike E3/E4 transports, which consume their mappers' output, this mapper is a tested-but-orphaned R1 surface. Document it as the Qiita-CLI-facing surface or drop the "rendered article and API payload agree" rationale. |
| P3 | Correctness | `plugins/qiita-pub/src/index.ts:16-22` | `slugify` uses `\w` without the `u` flag (ASCII-only): a non-ASCII tag (e.g. Japanese "日本語" — plausible for Qiita) or punctuation-only tag collapses to an empty slug → API payload `tags: [{name: ""}]` → HTTP 400. Fails loud, but the diagnostic is opaque. Consider collapsing empty slugs into a clear mapping-time validation error. |
| P4 | Usability | `plugins/qiita-pub/src/index.ts:211-216` | `parseArgs` sits outside `main`'s try/catch: unknown/duplicate flags throw an unhandled rejection (non-zero exit, stack-trace noise). Same convention as E3/E4 — consistency noted, not a regression. |
| P4 | Correctness | `plugins/qiita-pub/src/index.ts:48-50` | Duplicate tags after slugification (e.g. `['Web Dev','web-dev']` → two `web-dev`) → API 400, fails loud. No dedupe; Qiita rejects duplicate tag names. |
| P4 | Efficiency | `plugins/qiita-pub/src/index.ts:121` | `response.text()` reads the full error body unbounded and embeds it in the error Result. Fine for diagnostics; cap if Qiita ever returns large error bodies. |
| P4 | Testing | `plugins/qiita-pub/tests/qiita-pub.test.ts:360-397` | `main`'s catch → return 1 (`index.ts:226-229`) is line-covered per the coverage run but not directly asserted — only missing-args → 1 and fake-success → 0 are pinned at the `main` level. A dedicated main-level failing-publish test would pin the exit-code contract. |

**Overall Verdict: PASS** — functional traceability 6/6 MET; SECUA has no P1/P2 findings (P3/P4 advisories only); architecture advisory-only (no blockers/majors). `approve` gate clear.

**Functional Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `plugins/qiita-pub/src/index.ts:80` — `mapContentToQiitaMarkdown` → `renderQiitaMarkdown` (:69-73) renders title/tags/private frontmatter + body; tests `tests/qiita-pub.test.ts:52-102` (frontmatter with/without metadata, private + published-fallback flags) |
| R2 | MET | `plugins/qiita-pub/src/index.ts:90` — `QiitaApiTransport implements PublishTransport`, `kind = 'file-cli'` (:91); `fetch` POST /api/v2/items (:106-118) with `Authorization: Bearer <token>`; token read env-only (:96-103); audited against wt-publish-to-qiita `QIITA_URLS.items` + `buildApiHeaders`/`buildApiPayload` (skill scripts/qiita-utils.ts, qiita-api.ts) |
| R3 | MET | `plugins/qiita-pub/src/index.ts:140-146` — success Result `{ok:true, target:'qiita', url, id, message}`; identical shape to surfdash-pub, `ResultSchema`-validated; asserted at `tests/qiita-pub.test.ts:139-152` |
| R4 | MET | `plugins/qiita-pub/src/index.ts:120-129` non-2xx → `{ok:false, target:'qiita', error}`; :132-138 missing id/url; :147-153 fetch rejection; :206 throw → `main` :227-228 `logger.error` + return 1; tests `:114-127` (missing token), `:187-211` (HTTP 403), `:213-232` (network rejection) |
| R5 | MET | Fresh run this turn: `bun test plugins/qiita-pub/tests/qiita-pub.test.ts` → 15 pass / 0 fail, 65 expects; 100% line coverage of `plugins/qiita-pub/src/index.ts`; all offline (mocked `fetch` + `FakeFileCliTransport` + spy) |
| R6 | MET | `apps/cli/tests/fanout.test.ts:764` — R6 test dispatches one Content to `--target zenn-pub --target qiita-pub` through real plugin entries with `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake`; asserts `targets == ['zenn-pub','qiita-pub']`, each `status:'published'`, `summary {total:2, succeeded:2}`. Fresh runs this turn: full suite 32 pass / 0 fail; isolated `-t "R6"` 1 pass / 10 expects. |

**Design Conformance** — pass: 5/5 approach claims DONE (plugin mirroring E3; wrap-in-place and browser transports rejected as documented); all E2 invariants honored — no new transport kind, no core schema change, no CLI command, no HTTP-client dependency (Bun native `fetch`), no shared mapper; key signatures match `### Design` exactly. `packages/kk-core/src/registry.ts` sort (readdir determinism) is a small related change in the diff scope; correct, no finding.

**Acceptance Criteria** — all 8 scenarios MET by the evidence above (AC1-3 by R2/R4/R6 evidence; AC4-8 by R1-R5 evidence). Exit-code contract: success 0 / failure 1 pinned at `main` (`index.ts:210-234`) and via `runInvoke` discovery test (`tests/qiita-pub.test.ts:398`).

**SECUA Review** — S: token env-only, never in `plugin.json`/Result metadata (grep confirmed no committed `QIITA_TOKEN`); no shell interpolation, no injection surface. E: no avoidable allocation/copy; fields resolved once and shared. C: missing-token, non-2xx, malformed-response, network-failure, validation-failure, and invalid-JSON paths all fail loud with a written `ok:false` Result; the P3 slugify edge is the only correctness gap (fails loud, opaque message). U: clear arg errors, scoped diagnostic in the missing-token message; P4 parseArgs noise noted. A: cohesive single-module plugin, strong test surface (pure mapper + injectable transport boundary).

**Architecture Candidates (advisory, non-blocking)** — C1: `slugify` now verbatim ×3 (surfdash-pub, zenn-pub, qiita-pub) — extract to `@gobing-ai/kk-core` or `publish-harness` as a future cross-cutting task (per-task "no shared mapper" invariant honored). C2: publish-plugin scaffolding (`processPublishIO`/`writePublishResult`/`main`/`getPublishTransport`, ~90 lines) near-verbatim ×3 — a `createPublishPlugin({targetName, makeTransport, mapContent})` factory in publish-harness is the top deepening candidate for the next harvest; deliberately deferred by E2 invariants. C3: `kind:'file-cli'` on a network token transport is semantically loose but explicitly classified by E2 (task 0002 audit) — informational.

**Residual Risk** — a real `POST /api/v2/items` against Qiita is env-dependent and deferred; success and all failure paths are covered by mocked-fetch and error-Result tests, so R5's offline contract holds. No live-network verification was performed in this review.
### References
- Feature E4
- Task 0002 — source audit and transport classification
- Task 0044 — required Zenn channel predecessor
- `docs/design/publish-plugin-specification.md`
- `docs/design/fan-in-and-fan-out-specification.md`
- `plugins/surfdash-pub/src/index.ts` and `apps/cli/tests/fanout.test.ts` — shipped reference surfaces
- `wt-publish-to-qiita/SKILL.md` and its local scripts — source to audit/adapt
### History
- 2026-08-12T07:44:23.130Z todo → wip (system)
- 2026-08-12T07:59:21.095Z wip → testing (system)
- 2026-08-12T07:59:25.511Z testing → done (system)
