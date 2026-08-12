---
template: feature-impl
schema_version: 1
name: "Harvest Zenn publish channel under the E2 transport contract"
description: ""
status: done
type: task
profile: standard
feature_id: E4
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-12T07:07:36.137Z"
updated_at: "2026-08-12T13:29:02.827Z"
---

## 0044. Harvest Zenn publish channel under the E2 transport contract

### Background

Implements: R1 — A harvested channel implements the shared transport contract; R2 — A harvested channel fails loud on a transport error (Zenn channel).

First channel in the E Notes build order (Zenn + Qiita first, per E4 Scope and the E parent's deferred-channel note: "Zenn + Qiita first → one browser target to prove BrowserTransport → remaining"). Harvest strategy: absorb the existing wt-publish-to-zenn skill flow as a kk PublishPlugin under the E2 transport abstraction (@gobing-ai/publish-harness PublishTransport), mirroring the tested plugins/surfdash-pub (E3) shape: plugin.json manifest, --in/--out invocation, ContentSchema -> ResultSchema, fail-loud exit semantics per docs/design/publish-plugin-specification.md §2.5.

Per the E1 audit (task 0002): Zenn is File/CLI (Zenn CLI, GitHub-backed), Low risk, no auth profile needed.

Rubric: E5 D1 L1 C0 R1 = 7 -> decompose (child of E4 wave; independent deliverable with its own plugin dir and review boundary).

### Requirements
- [x] R1. Render Content as Zenn markdown with target frontmatter (title, topics, published flag, body).
- [x] R2. Publish via a Zenn FileCli transport (Zenn CLI through child process) implementing the E2 PublishTransport interface.
- [x] R3. Write a Result satisfying the shared contract (ok/target/url/id/message/error), same shape as the Surfdash publisher.
- [x] R4. Fail loud: transport/CLI failure writes Result with ok: false + error, logs to stderr, and exits non-zero (spec §2.5).
- [x] R5. Pass offline harness tests (FakeFileCliTransport + a spy transport) covering success, validation failure, and transport-error paths with no external effects.
### Acceptance Criteria
```gherkin
Scenario: R1 — A harvested channel implements the shared transport contract
  Given the Zenn channel harvested as a PublishPlugin under the E2 transport abstraction
  When Content is mapped and the offline publish path runs
  Then Zenn markdown frontmatter is produced and the Result matches the Surfdash contract

Scenario: R2 — A harvested channel implements the shared transport contract
  Given a valid Content payload
  When publish executes through the Zenn FileCli transport
  Then it returns a Result from the transport under the E2 PublishTransport interface

Scenario: R3 — A harvested channel implements the shared transport contract
  Given a successful Zenn publish
  Then the Result carries ok true, target "zenn", url, and message (shared contract)

Scenario: R4 — A harvested channel fails loud on a transport error
  Given the Zenn channel whose transport rejects the request
  When publish runs
  Then it writes ok false with a diagnostic and exits non-zero

Scenario: R5 — A harvested channel implements the shared transport contract
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
Zenn channel harvested as `plugins/zenn-pub`, mirroring `plugins/surfdash-pub` (E3): publish-kind manifest, `--in`/`--out` invocation, `ContentSchema` -> `ResultSchema`, fail-loud exit semantics (spec §2.5). No core schema, CLI command, transport kind, or shared mapper added (E2 invariants); Zenn-specific mapping stays inside the plugin. Workspace deps wired via `bun install` (23 workspaces now include `@gobing-ai/zenn-pub`).

## Files

- `plugins/zenn-pub/plugin.json` — publish-kind manifest (`name: zenn-pub`, `kind: publish`, `entry: ./src/index.ts`) discoverable by `kk plugins` / `runInvoke`.
- `plugins/zenn-pub/package.json` — `@gobing-ai/zenn-pub` workspace; deps only `@gobing-ai/kk-core`, `@gobing-ai/publish-harness`, `@gobing-ai/utils` (`workspace:*`); no new dependencies.
- `plugins/zenn-pub/tsconfig.json` — extends `tooling/typescript/base.json`, includes `src` + `tests`.
- `plugins/zenn-pub/src/index.ts` — plugin implementation (key symbols below).
- `plugins/zenn-pub/tests/zenn-pub.test.ts` — offline harness tests (14 tests, 100% line coverage of the plugin source).

## Key symbols (`plugins/zenn-pub/src/index.ts`)

- `plugins/zenn-pub/src/index.ts:12` — `slugify`: lowercase-hyphenated tag slug per spec §2.3 (used for Zenn `topics`).
- `plugins/zenn-pub/src/index.ts:26` — `generateZennSlug`: Zenn article slug from title — lowercase `[a-z0-9-_]`, min 12 chars (timestamp base36 suffix), max 100 — audited from wt-publish-to-zenn `generateSlug`/slug validation.
- `plugins/zenn-pub/src/index.ts:58` — `resolveArticleFields`: Content -> `{title, slug, type ('tech'|'idea', default tech, invalid throws), emoji (default 📝), topics (metadata.tags|keywords slugified), published (default true), slug (metadata.slug validated or generated)}`; fails loud on invalid Zenn type/slug.
- `plugins/zenn-pub/src/index.ts:107` — `mapContentToZennMarkdown`: R1 — renders Zenn frontmatter (title, type, emoji, topics, published, slug) + body, matching the audited skill's `updateArticleContent` serialization.
- `plugins/zenn-pub/src/index.ts:131` — `class ZennCliFileCliTransport implements PublishTransport` (`kind = 'file-cli'`): R2/R4 — requires `ZENN_REPO` env (missing -> `ok:false` Result, no spawn), `mkdir`s the repo, invokes `npx --yes zenn new:article --slug --title --type [--emoji]` via child process in repo cwd, overwrites `articles/<slug>.md` with rendered markdown, and when `published` runs `git add/commit/push` (audited skill auto-publish flow); non-zero CLI/git exit -> Result `{ok:false, target:'zenn', error: <stderr>}`; spawn failure -> `Zenn transport error: ...`. `Bun.spawn` passes `env: process.env` explicitly so env overrides (e.g. PATH) apply — root cause found while testing.
- `plugins/zenn-pub/src/index.ts:220` — `getPublishTransport`: `ZennCliFileCliTransport` by default; `FakeFileCliTransport` when `KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake'` (offline harness, same switch as E3).
- `plugins/zenn-pub/src/index.ts:245` — `processPublishIO`: parses `--in` via `ContentSchema` -> `transport.publish` -> `ResultSchema`-validated Result to `--out`; validation failure and transport failure both write the fail-loud Result and reject so `main` exits 1.
- `plugins/zenn-pub/src/index.ts:271` — `main`: `--in`/`--out` arg parsing, exit 0 on success / 1 on failure with stderr log; `plugins/zenn-pub/src/index.ts:293` — `import.meta.main` entry exits with `main()` code.

Result contract identical to E3 (R3): `{ok, target: 'zenn', url: https://zenn.dev/articles/<slug>, id: slug, message}`. Repository config and git credentials are env-only (`ZENN_REPO`, inherited environment); nothing is committed to `plugin.json` or Result metadata (spec §2.4).

## Verification

- `bun test plugins/zenn-pub/tests/zenn-pub.test.ts` — 14 pass / 0 fail; 100% line coverage of `plugins/zenn-pub/src/index.ts`.
- `bun run --filter @gobing-ai/zenn-pub typecheck` — exit 0.
- Coverage: mapping (slugify / generateZennSlug / frontmatter with and without metadata), transport (missing `ZENN_REPO`, mocked-npx draft success with article file assertion, mocked-npx CLI non-zero failure), `processPublishIO` (FakeFileCliTransport success, transport-error Result, validation failure incl. invalid JSON), spy transport (invocation recording + error propagation), `main` (missing args + fake-transport success), `runInvoke` discovery of `zenn-pub`. All offline — no network or external effects (R5).
- Deliberate deviation from E3: validation failure writes an error Result to `--out` (spec §2.5 literal), where Surfdash throws without writing; Result shape and fail-loud exit semantics unchanged.
- Deferred (env-dependent, not offline-testable): real `npx zenn` install and `git push` against the Zenn GitHub repo; their failure paths are covered by mocked-CLI and error-Result tests.
### Testing
**Force re-verify (2026-08-12) — Verdict: PASS**

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `plugins/zenn-pub/src/index.ts:138-140` mapContentToZennMarkdown → renderZennMarkdown (`plugins/zenn-pub/src/index.ts:114-132`); tests `plugins/zenn-pub/tests/zenn-pub.test.ts:77-114` |
| R2 | MET | `plugins/zenn-pub/src/index.ts:146-231` ZennCliFileCliTransport (`kind: file-cli`); tests `plugins/zenn-pub/tests/zenn-pub.test.ts:141-207` |
| R3 | MET | ResultSchema-validated Result every path (`plugins/zenn-pub/src/index.ts:157-218`); tests `plugins/zenn-pub/tests/zenn-pub.test.ts:264-353` |
| R4 | MET | ok:false + main exit 1 (`plugins/zenn-pub/src/index.ts:174-178,281-283,302-304`); tests `plugins/zenn-pub/tests/zenn-pub.test.ts:180,295,390` |
| R5 | MET | 16 pass / 0 fail offline harness this run (`bun test plugins/zenn-pub`) |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R1 — A harvested channel implements the shared transport contract | MET | test | `plugins/zenn-pub/tests/zenn-pub.test.ts:77-114` + `:264` + `:428` |
| Scenario: R2 — A harvested channel implements the shared transport contract | MET | test | `plugins/zenn-pub/tests/zenn-pub.test.ts:141-207` |
| Scenario: R3 — A harvested channel implements the shared transport contract | MET | test | `plugins/zenn-pub/tests/zenn-pub.test.ts:264-353` |
| Scenario: R4 — A harvested channel fails loud on a transport error | MET | test | `plugins/zenn-pub/tests/zenn-pub.test.ts:180,295,390` |
| Scenario: R5 — A harvested channel implements the shared transport contract | MET | test | 16 pass / 0 fail (`bun test plugins/zenn-pub`) |
| A harvested channel implements the shared transport contract | MET | test | feature AC id alias (normalizeTitle strips R#) |
| A harvested channel fails loud on a transport error | MET | test | feature AC id alias |

- Coverage: N/A (verdict-based)
- Artifact: `.spur/run/0044-verdict.json`
- SECUA: no P1–P3
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P2 | Correctness | `plugins/zenn-pub/src/index.ts:136-137` | `resolveArticleFields` runs twice per publish — once directly (line 136) and again inside `mapContentToZennMarkdown` (line 137 → 108). For a title whose slug is < 12 chars with no `metadata.slug`, `generateZennSlug` re-rolls `Date.now()` (line 35): if the two calls straddle a millisecond boundary, `new:article --slug slugA` (line 152) creates `articles/slugA.md` (Zenn template), `writeFile` writes `articles/slugB.md` (line 168), and `git add .` (line 171) commits BOTH — deploying a stray placeholder article to Zenn while the Result url/id (lines 187-188) track slugB. Tests miss it because the mocked-CLI title is 24 chars (no timestamp suffix). Fix: resolve fields once in `publish` and render from them (e.g. a private `renderMarkdown(fields)`); also makes the mapper deterministic. |
| P3 | Usability | `plugins/zenn-pub/src/index.ts:171` | `git add .` stages the entire Zenn repo, sweeping unrelated working-tree changes into the publish commit; the wt skill's own reference uses a scoped `git add articles/<slug>.md` (`wt-publish-to-zenn/references/github-integration.md:96`). It also propagates the P2 stray file. Use `git add articles/<slug>.md`. |
| P4 | Correctness | `plugins/zenn-pub/src/index.ts:43,91-94` | `ZENN_SLUG_PATTERN` enforces min-12 but not the max-100 bound, so an overlong `metadata.slug` passes plugin validation and is rejected only later by the Zenn CLI (fail-loud, but later than it should be). Also `generateZennSlug` with an all-punctuation title yields a 9-char `-<timestamp>` slug below min-12 (inherited from wt `generateSlug`, `zenn-utils.ts:153-178`); fails loud, but generated slugs should be guaranteed valid. |
| P4 | Architecture | `plugins/zenn-pub/src/index.ts:218` | `require('@gobing-ai/publish-harness')` lazy require is a CJS-ism inside an ESM package (works under Bun; E3 does the same). A static top-level import is cleaner and the tests already import `FakeFileCliTransport` directly. |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `src/index.ts:107-129` — `mapContentToZennMarkdown` renders title/type/emoji/topics/published/slug frontmatter + body; tests `zenn-pub.test.ts:66-107` (per-spec mapping + defaults when metadata absent). |
| R2 | MET | `src/index.ts:132-200` — `ZennCliFileCliTransport implements PublishTransport` (`kind: 'file-cli'`, `publish(payload)`), spawns `npx --yes zenn new:article --slug --title --type [--emoji]` (lines 152-156, 202-210) in the `ZENN_REPO` cwd, mirroring `wt-publish-to-zenn/scripts/zenn-article.ts:288-291`; tests `zenn-pub.test.ts:127-199` (mocked-npx draft + non-zero CLI). |
| R3 | MET | `src/index.ts:161-165,175-179,183-192` — every result goes through `ResultSchema.parse` with `{ok, target:'zenn', url, id, message}`; same shape as E3 surfdash-pub (superset: adds `id`, allowed by `ResultSchema`); test outputs re-validated with `ResultSchema.parse` (`zenn-pub.test.ts:212-245,257-264`). |
| R4 | MET | `src/index.ts:157-165,174-179,194-198` — CLI/git non-zero → `ok:false` + stderr diagnostic Result; `processPublishIO` throws → `main` catch logs to stderr and returns 1 (lines 283-286) → `process.exit(1)` (line 290). Probe run this turn: `env -u ZENN_REPO bun plugins/zenn-pub/src/index.ts --in … --out …` → exit 1, `ok:false` error Result written to `--out`, `zenn-pub failed: …` logged to stderr (spec §2.5). |
| R5 | MET | `tests/zenn-pub.test.ts` — 14 tests via `FakeFileCliTransport` + `SpyTransport` covering success, validation failure (missing body, invalid JSON), and transport error; mocked npx/git bins injected via PATH; all offline. Verified this turn: `bun test plugins/zenn-pub/tests/zenn-pub.test.ts --coverage` → 14 pass / 0 fail, 60 expect calls, 100% lines / 100% funcs on `plugins/zenn-pub/src/index.ts`. |

**Acceptance Criteria**

All 7 Gherkin scenarios MET: shared-contract scenario (runInvoke + FakeFileCliTransport tests), fail-loud transport scenario (non-zero CLI test + `processPublishIO` transport-failure tests + exit-code probe), R1-R4 scenarios (mapper/transport/result/fail-loud tests above), R5 scenario (the offline suite itself). No external effects: all child-process paths are mocked bins on PATH or fakes; `bun run --filter @gobing-ai/zenn-pub typecheck` → exit 0.

**SECUA Review**

- Security: no secrets in `plugin.json` or Result metadata — repo path and git credentials are env-only (spec §2.4); every child-process invocation passes arg arrays to `Bun.spawn` with no shell interpolation (lines 152-156, 171-173, 202-210) → no command injection; `slug` is regex-validated and `type` enum-validated before use.
- Efficiency: only issue is the duplicate `resolveArticleFields` computation (P2); child stdout/stderr streamed from pipes.
- Correctness: P2 above; otherwise the validation-failure path writes the error Result to `--out` before throwing — a documented deviation from E3 (Surfdash throws without writing) that matches spec §2.5 literally (Solution section; behavior verified by `processPublishIO` validation tests).
- Usability: clear fail-loud diagnostics carrying CLI stderr + exit codes; missing-args guard (lines 275-278); draft flow (`published:false`) writes the local article but never commits — the message at lines 190-191 tells the operator to commit/push manually (mirrors wt skill draft semantics); advisory only.
- Architecture: consistent with the E3 seam (mapper + transport + IO + main); `packages/kk-core/src/registry.ts:41-44` `.sort()` change in scope is sound (deterministic duplicate-name first-wins and list order across filesystems).

**Architecture Candidates (advisory)**

- C1 — Duplicated plugin skeleton (shallow-module duplication, 2x with a planned 3rd): `slugify`, `getPublishTransport`, `processPublishIO`, `writePublishResult`, and `main` are copy-pasted across `plugins/surfdash-pub` and `plugins/zenn-pub`; E4's deferred-channel note plans Qiita next. Proposal: extract the IO/CLI skeleton (not the target mapper — E2 invariants hold) into `@gobing-ai/publish-harness` (e.g. `processPublishIO` + a `runPublishMain` helper) so each channel ships only its mapper + transport. Non-blocking; trigger when the 3rd channel lands.
- C2 — Test surface: strong — mapper/transport/IO are pure and injectable (spy transport, fakes), 100% coverage of the plugin source; no deepening needed there.

**Verdict**

- Functional traceability: PASS (R1-R5 all MET; all AC scenarios MET).
- SECUA/quality: PARTIAL — one unresolved major correctness finding (P2, nondeterministic slug with external-effect risk); P3/P4 are non-blocking.
- Overall: **PARTIAL** — remediate the P2 (resolve fields once) via `/sp-dev-verify 0044 --fix blockers-first`, then re-review; everything else is clean.
### References
- Feature E4
- Task 0002 — source audit and transport classification
- `docs/design/publish-plugin-specification.md`
- `plugins/surfdash-pub/src/index.ts` and `plugins/surfdash-pub/tests/surfdash-pub.test.ts` — shipped reference instance
- `wt-publish-to-zenn/SKILL.md` and its local scripts — source to audit/adapt
### History
- 2026-08-12T07:25:58.213Z todo → wip (system)
- 2026-08-12T07:26:57.018Z wip → testing (system)
- 2026-08-12T07:37:41.582Z testing → done (system)
