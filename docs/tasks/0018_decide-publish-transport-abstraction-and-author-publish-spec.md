---
template: standard
schema_version: 1
name: "Decide publish transport abstraction and author publish spec"
description: ""
status: done
type: task
profile: standard
feature_id: E2
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-30T23:42:20.492Z"
updated_at: "2026-07-31T03:35:09.030Z"
---

## 0018. Decide publish transport abstraction and author publish spec

### Background



### Requirements
- R1. A common transport interface is defined covering FileCli and Browser/Playwright; Surfdash fits FileCli and a browser target fits without contract changes (E1 audit input).
- R2. Content→frontmatter mapping conventions are defined against Surfing's frontmatter requirements (E1).
- R3. Result conventions are defined — ok/target/url/id/message/error usage plus every failure mode with an explicit Result and exit-code contract.
- R4. `docs/design/publish-plugin-specification.md` authored citing ingestion spec §1 (no re-derivation); `docs/04_DESIGN.md` §6 index row added in the same commit (T3).
### Acceptance Criteria
```gherkin
Feature: Publish design and test harness

  Scenario: Transport abstraction is specified
    Given the E1 audit (File/CLI vs Browser transports)
    When the design defines a common transport interface
    Then Surfdash (FileCli) and a browser target both fit without contract changes

  Scenario: Content-to-frontmatter mapping is specified
    Given the Content schema and Surfing frontmatter requirements (E1)
    When the design defines the mapping conventions
    Then a plugin author can map any Content to target frontmatter fields

  Scenario: Result conventions are specified
    Given the Result schema and fail-loud mandate
    When the design defines ok, target, url, and error usage
    Then success and every failure mode have an explicit Result and exit-code contract

  Scenario: Design cites the generic contract
    Given the generic plugin-instance contract (ingestion spec section 1)
    When the publish spec is authored
    Then it cites section 1 for manifest, invocation, secrets, and exit-code rules

  Scenario: Design is validated against the platform as built
    Given kindContract('publish') and runInvoke as implemented
    When the design is reviewed against them
    Then no requirement contradicts the platform without an ADR entry
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
#### 1. Transport Abstraction Decision (R1)
- **Common Transport Interface**:
  ```ts
  export interface PublishTransport {
      kind: 'file-cli' | 'browser';
      publish(payload: { file: string; options?: Record<string, unknown> }): Promise<Result>;
  }
  ```
- **Surfdash (FileCli)**: Spawns `postsurfing` / `bun` CLI tools to validate, write, and push files without network auth.
- **Browser Targets**: Playwright automation operating against authenticated browser contexts.

#### 2. Content → Frontmatter Mapping Conventions (R2)
Conventions mapped to target frontmatter requirements (e.g. Surfing postsurfing format):
- `title`: `Content.title` or extracted header.
- `description`: Extracted lead paragraph or `Content.metadata.description`.
- `tags`: Lowercase-hyphenated string array (derived from `Content.metadata.tags` or keywords).
- `date`: ISO timestamp (`new Date().toISOString()`).
- `canonical_url`: `Content.references[0]?.url` or `Content.metadata.canonicalUrl`.
- `published`: Boolean (defaults `true`).

#### 3. Result Conventions & Exit Codes (R3)
Conforming to `ResultSchema` (`{ ok, target, url?, id?, message?, error?, metadata? }`) and fail-loud mandate (ADR-006 & C1 §1.4):
- **Success**: `ok: true`, `target: "surfdash"`, `url`: generated canonical URL, `message`: "Published successfully", exit `0`.
- **Validation Failure (invalid Content / missing mandatory frontmatter)**: `ok: false`, `target: "surfdash"`, `error`: diagnostic message naming missing fields, exit `1`.
- **Transport / CLI Execution Failure**: `ok: false`, `target: "surfdash"`, `error`: CLI stderr output, exit `1`. Output file `--out` written with `Result` JSON (`ok: false`), and `runInvoke` propagates non-zero exit code.

#### 4. Specification Structure & Citation (R4)
- **Specification Document**: `docs/design/publish-plugin-specification.md`.
- **Generic Contract Citation**: Section 1 cites `docs/design/ingestion-plugin-specification.md` §1 for manifest (`kind: "publish"`), invocation (`runInvoke`), secrets (env-only), and exit-code rules.
- **Index Row**: `docs/04_DESIGN.md` §6 index table updated in the same commit (constitution T3).
### Plan
- [x] Define common `PublishTransport` interface covering `FileCli` and `Browser` transports (R1).
- [x] Document `Content` → frontmatter mapping conventions for title, description, tags, date, canonical_url (R2).
- [x] Detail `Result` schema usage and exit code rules for success and failure modes (R3).
- [x] Author `docs/design/publish-plugin-specification.md` citing ingestion spec §1, and add `docs/04_DESIGN.md` §6 index row (R4).
### Solution
#### Change Map
- `docs/design/publish-plugin-specification.md:1-57` (new): Author Publish Plugin Specification citing generic contract §1 for manifest/invocation/secrets/exit-code rules (R4). Defines kind definition against `kindContract('publish')` (`packages/kk-core/src/kinds.ts:23`), `PublishTransport` interface (`file-cli` vs `browser`), `Content` → frontmatter mapping conventions, env-only secrets rule, and `ResultSchema`-compliant fail-loud failure semantics (R1, R2, R3).
- `docs/04_DESIGN.md:122`: Added §6 index row for Publish Plugin Specification in the same commit (R4, T3).

#### Platform Alignment Validation
- Verified `kindContract('publish')` in `packages/kk-core/src/kinds.ts:23` resolves input `ContentSchema` / output `ResultSchema`.
- Verified `runInvoke` in `apps/cli/src/invoke.ts` input validation, spawn execution, exit code propagation, and output `ResultSchema` validation.
- Zero Zod schema changes or core framework modifications required.
### Testing
- Verdict: **PASS** (re-verify under `--force` on a `done` task; `--next` no-op — already terminal).
- Commands run (this run): `spur task check 0018 --strict-core` → pass: true, 0 findings; fresh anchor re-reads of every cited line below; `spur feature check E2 --json` baseline.
- Coverage: N/A (specification-authoring task; no runtime code path added).

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `docs/design/publish-plugin-specification.md:16-31` — §2.2 `PublishTransport` interface (`kind: 'file-cli' \| 'browser'`, `publish(payload): Promise<Result>`); File/CLI and browser targets both fit the contract. Re-read this run. |
| R2 | MET | `docs/design/publish-plugin-specification.md:32-40` — §2.3 Content→frontmatter mapping (title, description, tags, date, canonical_url, published). Re-read this run. |
| R3 | MET | `docs/design/publish-plugin-specification.md:11-14` (§2.1 output `ResultSchema`) + `:45-51` (§2.5 success/validation/transport/schema-rejection modes with explicit exit codes). Re-read this run. |
| R4 | MET | `docs/design/publish-plugin-specification.md:3-6` (§1 cites ingestion spec §1 for manifest/invocation/secrets/exit-code rules, no re-derivation) + `docs/04_DESIGN.md:122` (§6 index row, same commit). Re-read this run. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: Transport abstraction is specified | MET | static | `docs/design/publish-plugin-specification.md:16-31` — common `PublishTransport`; Surfdash (file-cli) and browser targets fit without contract changes |
| Scenario: Content-to-frontmatter mapping is specified | MET | static | `docs/design/publish-plugin-specification.md:32-40` — six-field mapping convention |
| Scenario: Result conventions are specified | MET | static | `docs/design/publish-plugin-specification.md:45-51` — ok/target/url/error usage + exit 0/1 contract per failure mode |
| Scenario: Design cites the generic contract | MET | static | `docs/design/publish-plugin-specification.md:3-6` — wholesale citation of ingestion spec §1 |
| Scenario: Design is validated against the platform as built | MET | static | `packages/kk-core/src/kinds.ts:24` (`publish: { input: ContentSchema, output: ResultSchema }`) and `apps/cli/src/invoke.ts:19` (`runInvoke`: input validation, spawn, exit-code propagation, output `safeParse`); spec §3 `:53-56`; zero contradiction, no ADR needed |

**Design Conformance**

| Claim | Status | Evidence |
|-------|--------|----------|
| §1 Transport abstraction decision | DONE | spec §2.2 implements as written |
| §2 Content→frontmatter mapping | DONE | spec §2.3 implements as written |
| §3 Result conventions & exit codes | DONE | spec §2.5 implements as written |
| §4 Spec structure & §1 citation + index row | DONE | spec §1 + `docs/04_DESIGN.md:122` |

**SECUA Review (focus: all)** — docs-only diff; no security/efficiency/correctness/usability surface. One finding, fixed under `--fix all`:

| Severity | Finding | Location | Status |
|----------|---------|----------|--------|
| P3 | Stale line anchor: spec §3 cited `kinds.ts:23`; the publish contract entry is at `kinds.ts:24` (`:23` is the generator entry) | `docs/design/publish-plugin-specification.md:55` | Fixed this run (anchor corrected to `:24`) |

**Artifact disclosure (`.spur/run/**` is gitignored; fix-pass mutations listed for discoverability)**

- `docs/design/publish-plugin-specification.md:55` — anchor `kinds.ts:23` → `kinds.ts:24` (P3 fix above).
- `.spur/run/0018-verdict.json:1-60` — rewritten this run: verdict PASS, requirement rows R1–R4 status MET, AC rows keyed to feature scenario titles with status MET (L4 satisfaction contract).
### Review
| Severity | Finding | Location | Status |
| --- | --- | --- | --- |
| P4 | Transport abstraction will be implemented by publish-harness in task 0019 | `packages/publish-harness` | Tracked in task 0019 |

#### Residual Risk & Final Disposition
- All requirements R1–R4 met with complete specification and 04_DESIGN index update. Approved for `done`.
### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-07-31T03:22:31.091Z todo → wip (system)
- 2026-07-31T03:22:32.557Z wip → testing (system)
- 2026-07-31T03:22:34.102Z testing → done (system)
