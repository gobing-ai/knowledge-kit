---
template: feature-impl
schema_version: 1
name: "Publish kk bin and prepack artifact"
description: ""
status: done
type: task
profile: standard
feature_id: A2
parent_wbs: null
priority: P1
tags: ["cli", "npm"]
dependencies: ["0049"]
ac_numbering: task-local
created_at: "2026-08-12T17:19:19.259Z"
updated_at: "2026-08-12T19:45:15.640Z"
---

## 0051. Publish kk bin and prepack artifact

### Background

The code can already say `kk`, but npm still exposes `knowledge-kit` → dist/index.js with no prepack. This deliverable makes `@gobing-ai/knowledge-kit` pack-ready: bin.kk, knowledge-kit alias, prepack build, and the T3 04/AGENTS prefix change.

Implements feature scenarios: R8 — npm bin exposes kk and a knowledge-kit alias; R9 — prepack stages the dist artifact that bin.kk names; R10 — [doc-only] Surface docs and ADR name the kk binary.

Ordering: depends on the program-globals task so help/version already say kk. Can run in parallel with the command-module split.

Rubric: E2 D1 L1 C0 R0 = 4 → own task because pack metadata and 04 T3 are a distinct review surface from the command-tree move. Rejected folding into task 1: bin/prepack is independently demoable via npm pack.

Out of scope: npm Trusted Publisher, GitHub OIDC, .github/workflows/, bun --compile natives.

### Requirements
- [x] R1. apps/cli/package.json `bin.kk` and `bin.knowledge-kit` both point at `./dist/index.js`; package name stays `@gobing-ai/knowledge-kit`.
- [x] R2. `prepack` runs the existing bun build so `dist/index.js` exists before npm pack validates bins.
- [x] R3. docs/04_DESIGN.md §1 documents `kk` as the binary in the same commit, and AGENTS.md product-binary wording matches; ADR-010 already records the package-name invariant.
### Acceptance Criteria
```gherkin
Feature: kk npm bin and prepack

  @core
  Scenario: R1 — npm bin exposes kk and a knowledge-kit alias
    Given apps/cli/package.json
    When the package metadata is read
    Then bin.kk points at the built dist entry
      And bin.knowledge-kit points at the same artifact
      And the package name remains @gobing-ai/knowledge-kit

  @core
  Scenario: R2 — prepack stages the dist artifact that bin.kk names
    Given a clean apps/cli tree without dist/index.js
    When `bun run --filter @gobing-ai/knowledge-kit prepack` (or the documented pack path) runs
    Then dist/index.js exists
      And npm pack can see the kk bin file

  @core
  Scenario: R3 — [doc-only] Surface docs and ADR name the kk binary
    Given the binary is named kk
    When the implementing commit lands
    Then docs/04_DESIGN.md section 1 documents `kk` as the binary in that commit
      And a dated ADR entry records that the package name is unchanged and the operator binary is kk
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Chosen approach: dual bin keys on the same dist/index.js artifact; add `"prepack": "bun run build"` next to the existing build script. Rewrite 04 §1 examples from `knowledge-kit` to `kk` in that commit. Do not add release.yml or Trusted Publisher config.

Reason: `files: ["dist/"]` limits the tarball to dist + package.json, so without prepack the tarball omits `dist/index.js` and consumers silently lose the `kk` bin (npm does not validate bin existence at pack or install time). prepack guarantees the artifact both bins name exists in the tarball; dual bin keeps old `knowledge-kit` invocations working.

Rejected alternatives:
- Only rename bin to kk with no alias: breaks existing knowledge-kit invocations in the same release.
- bun --compile native binaries this feature: out of A2 scope.
- Author .github/workflows for Trusted Publisher: operator-owned, later.

Invariants:
- Package name unchanged.
- No new GitHub workflow files.
- 04 §1 command table flags stay as shipped; only the binary prefix changes.
### Plan
1. Set bin.kk and bin.knowledge-kit to ./dist/index.js; add prepack.
2. Add a test or pack smoke that prepack creates dist/index.js and package.json names both bins.
3. Update docs/04_DESIGN.md §1 to `kk` in the same commit.
4. Update AGENTS.md binary wording.
5. Run apps/cli tests and typecheck.
### Solution
- `apps/cli/package.json:13-14` — `bin` now exposes two keys, `kk` and `knowledge-kit`, both pointing at `./dist/index.js`; `apps/cli/package.json:23` adds `"prepack": "bun run build"` next to the existing `build` script (R1/R2). Package name unchanged.
- `apps/cli/tests/package.test.ts` (new) — static contract test: package name stays `@gobing-ai/knowledge-kit`, both bin keys point at `./dist/index.js`, and `prepack` runs the build (R1/R2).
- `docs/04_DESIGN.md:21` — §1 header now `Binary: kk` (alias `knowledge-kit`); `docs/04_DESIGN.md:24,113,135` rewrite the §1 example blocks and §1.5 `fanin` / §1.6 `fanout` command examples to the `kk` prefix (flags unchanged, per design invariant); `docs/04_DESIGN.md:289` syncs the §4 package-surface row to `bin: kk` (alias `knowledge-kit`) → `dist/index.js` Bun-target bundle staged by `prepack` (R3, T3 same-commit).
- `AGENTS.md:13` — product-binary line names `kk` (package `@gobing-ai/knowledge-kit`); `AGENTS.md:183-184` documents `bin: { kk, knowledge-kit } → ./dist/index.js` with prepack (ADR-010 R5) (R3).
- ADR-010 already records the invariant (package name unchanged, operator binary `kk`, prepack builds dist) — no ADR edit needed.
### Testing
**Force re-verify 2026-08-12** (`/sp-dev-verifyall --feature A2 --force --fix all`).

**Per-requirement**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `apps/cli/package.json:2` name `@gobing-ai/knowledge-kit`; `apps/cli/package.json:13-15` `bin.kk` and `bin.knowledge-kit` both `./dist/index.js`. Test `apps/cli/tests/package.test.ts:14`. |
| R2 | MET | `apps/cli/package.json:23` `"prepack": "bun run build"`. This run: `bun run prepack` in `apps/cli` created `apps/cli/dist/index.js` (644420 B, `#!/usr/bin/env bun`); `npm pack --dry-run` tarball lists `dist/index.js` + `package.json`. Test `apps/cli/tests/package.test.ts:20`. |
| R3 | MET | `docs/04_DESIGN.md:21` `Binary: kk (alias knowledge-kit)`; examples `docs/04_DESIGN.md:24-29`; package-surface `docs/04_DESIGN.md:289`. `AGENTS.md:13` product binary `kk`; `AGENTS.md:183-184` bin + prepack. ADR-010 in `docs/00_ADR.md`. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R1 — npm bin exposes kk and a knowledge-kit alias | MET | test | `apps/cli/tests/package.test.ts:14` asserts name + both bins → `./dist/index.js`. |
| R2 — prepack stages the dist artifact that bin.kk names | MET | command | This run `bun run prepack` then `npm pack --dry-run` includes `dist/index.js`. Test `apps/cli/tests/package.test.ts:20`. |
| [doc-only] R3 — Surface docs and ADR name the kk binary | MET | static-ref | `docs/04_DESIGN.md:21`; `AGENTS.md:13`; `AGENTS.md:183-184`; ADR-010. |

Coverage: N/A (packaging + docs; runtime covered by `apps/cli/tests/package.test.ts` 2 tests this run).
### Review
| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P4 | correctness | `docs/tasks/0051_publish-kk-bin-and-prepack-artifact.md` | Prior review noted npm ≥11 does not fail-loud on missing bins; prepack is still required so the tarball contains `dist/index.js` |
| P4 | — | — | No P1–P3 product findings on 2026-08-12 force re-verify |

Force re-verify SECUA (`--focus all`): metadata-only; this run `prepack` + `npm pack --dry-run` shipped `dist/index.js`. Dual bin + 04/AGENTS/`kk` prefix match ADR-010.
### References

A2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-12T18:25:02.148Z todo → wip (system)
- 2026-08-12T18:32:13.569Z wip → testing (system)
- 2026-08-12T18:32:17.959Z testing → done (system)
