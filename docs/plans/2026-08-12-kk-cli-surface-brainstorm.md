---
title: kk product CLI surface
date: 2026-08-12
needs_design: true
idea: Make the kk CLI a publishable product surface (help/version/verbose + command tree + kk bin)
---

# Brainstorm: kk product CLI surface

**Date:** 2026-08-12

## Overview

`@gobing-ai/knowledge-kit` is already the product CLI workspace (`apps/cli`), and every
authority doc talks about the operator binary as `kk`. The shipped program does not match
that contract.

Today `createProgram()` lives in a single file (`apps/cli/src/cli.ts`), names itself
`knowledge-kit`, hard-codes `.version('0.0.0')` while `package.json` is `0.1.0`, registers
`add` / `invoke` / `fanin` / `fanout` / `plugins` inline, and several actions call
`process.exit` directly. The npm `bin` field is `knowledge-kit → ./dist/index.js`. There is
no global `--verbose`, no `main(argv) → exitCode` test seam like spur-new, and no
per-command registration tree for the next noun.

The idea is not a package rename (ADR-007 R2 keeps `@gobing-ai/knowledge-kit`). It is to
make the **operator-facing binary `kk`**, give it the normal Commander baseline (`help`,
`--help`, `--version`, `--verbose`), and convert the existing commands into a structure that
can grow. npm Trusted Publisher / GitHub OIDC is **out of scope** (operator later).

Reference implementation: `/Users/robin/xprojects/spur-new/apps/cli` — `registerXCommand`
per noun, `CLI_CONFIG.binaryName/binaryVersion`, `main(argv, options) → number`,
`bin: { spur: "spur.js" }`, `prepack` stages the artifact. Do **not** copy spur's
ApplicationRuntime, SQLite, figlet banner, or noun/verb corpus surface.

## Approaches

### Approach 1: Spur-shaped command tree, `kk` npm bin, lean runtime ⭐ Recommended

**Description:** Keep Commander (ADR-002) and `createProgram()`. Split each existing
command into `apps/cli/src/commands/<noun>.ts` with a `registerXCommand(program)` function.
Introduce a small `CLI_CONFIG` (`binaryName: 'kk'`, version sourced from
`apps/cli/package.json`). Add a `main(argv) → number` entry that uses `exitOverride` and
does not call `process.exit` inside command actions. Set
`bin: { kk: "./dist/index.js" }` (optional `knowledge-kit` alias). Stage the bundle on
`prepack` so `npm pack` / later `npm publish` see a real file. Global flags: Commander
`--help`/`-h`, `--version`/`-V`, plus `--verbose`/`-v`. Existing verbs stay:
`add`, `invoke`, `plugins list|doctor`, `fanin`, `fanout`.

**Trade-offs:**
- **Pros:**
  - Matches how docs, PRD, and workflows already say `kk`.
  - Same growth pattern as spur without importing spur's runtime.
  - Fixes the version lie (`0.0.0` vs `0.1.0`) and the `process.exit` test smell.
  - Publish-ready package shape without touching Trusted Publisher.
- **Cons:**
  - Requires an ADR note: operator binary becomes `kk`; package name is unchanged.
  - Moves files; existing tests that parse `knowledge-kit` / mock `process.exit` must update.
  - `check-cli-surface.yaml` currently assumes a single `cli.ts` factory — must be updated.

**Implementation Notes:**
- Keep `logger` from `@gobing-ai/utils` (ADR-004). `--verbose` gates `logger.info` diagnostics;
  command results stay on `logger.out` / errors on `logger.error`.
- Do not introduce `@commander-js/extra-typings` unless typed options become painful —
  current dep is `commander@15.0.0`.
- Compile for npm = `bun build src/index.ts --target=bun --outdir=dist` (already the
  `build` script). Native `bun --compile` multi-arch binaries (spur `build-binaries`) are
  a later slice, not this feature.
- Surface change lands with `docs/04_DESIGN.md` §1 in the same commit (T3).
- Retire nothing silently: keep `add` as a registered smoke command unless a later task
  explicitly deletes it.

**Confidence:** HIGH
**Sources:**
- `apps/cli/src/cli.ts`, `apps/cli/package.json` (this repo, 2026-08-12)
- `/Users/robin/xprojects/spur-new/apps/cli/src/index.ts` + `package.json` + `src/commands/` (2026-08-12)
- `docs/00_ADR.md` ADR-002 / ADR-004 / ADR-007 R2 (2026-08-12)
- `.spur/rules/surface/check-cli-surface.yaml` (2026-08-12)

### Approach 2: Patch in place — rename + flags, keep one `cli.ts`

**Description:** Change `program.name('kk')`, wire `.version()` from `package.json`, add
`--verbose`, update `bin` to `kk`, leave every command registered in `cli.ts`.

**Trade-offs:**
- **Pros:**
  - Smallest diff; ships `kk --help` / `--version` quickly.
  - No test-harness redesign.
- **Cons:**
  - Does not satisfy “well-designed structure so we can add more going forward.”
  - `cli.ts` is already the dump site for invoke + plugins + fanin + fanout.
  - `process.exit` in actions stays.
  - Next noun still requires editing the factory file.

**Implementation Notes:**
- Acceptable only if the operator wants a one-PR cosmetic rename. Conflicts with the
  stated growth requirement.

**Confidence:** HIGH
**Sources:**
- Current `apps/cli/src/cli.ts` size and command count (2026-08-12)

### Approach 3: Reshape into kind-nouns (`kk ingest` / `kk generate` / `kk publish`)

**Description:** Replace `invoke` / `fanin` / `fanout` with a spur-like noun/verb tree
aligned to plugin kinds, plus a full ApplicationContext.

**Trade-offs:**
- **Pros:**
  - Pretty long-term taxonomy.
- **Cons:**
  - Breaks every shipped workflow that shells `kk invoke` / `kk fanin` / `kk fanout`
    (B5, B6, ADR-006/007).
  - Speculative — no consumer asked for kind-nouns.
  - Copies more of spur than this product needs.

**Implementation Notes:**
- Rejected for this feature. If kind-nouns appear later, they add *beside* the existing
  verbs, they do not replace them.

**Confidence:** HIGH
**Sources:**
- `docs/04_DESIGN.md` §1 shipped command table (2026-08-12)
- `docs/00_ADR.md` ADR-006 `kk invoke` substrate (2026-08-12)

## Design Summary

**Chosen approach:** Approach 1.

**Operator-facing contract**

| Item | Decision |
|------|----------|
| npm package | `@gobing-ai/knowledge-kit` (unchanged) |
| Binary name | `kk` (`program.name('kk')`, `bin.kk`) |
| Compatibility alias | Keep `bin.knowledge-kit` pointing at the same artifact so existing docs/scripts do not break in the same release |
| Version | Single source: `apps/cli/package.json` `version` (today `0.1.0`); Commander `--version`/`-V` must print it, not `0.0.0` |
| Help | Commander default: `kk`, `kk --help`, `kk -h`, `kk help`, `kk help <cmd>`, `kk <cmd> --help` |
| Verbose | Global `--verbose` / `-v` for diagnostics; does not change machine `--json` shapes |
| `--json` | Stays **per-command** (already on `plugins list`/`doctor`); not a global flag |
| Existing verbs | `add`, `invoke`, `plugins list`, `plugins doctor`, `fanin`, `fanout` — same flags and exit codes |
| New verbs | None in this feature |
| npm Trusted Publisher / GitHub OIDC | **Out of scope** (operator later; same approach as spur) |
| Native compiled binaries | **Out of scope** this feature; npm ships the Bun-target bundle |

**Module layout** (new files under `apps/cli/src/`)

```
index.ts                 # shebang; import.meta.main → process.exit(await main())
main.ts                  # main(argv, options?) → number; exitOverride; no process.exit in actions
config.ts                # CLI_CONFIG { binaryName, binaryVersion, binaryLabel }
cli.ts                   # createProgram(): name/version/global opts + register* calls
commands/add.ts
commands/invoke.ts
commands/plugins.ts
commands/fanin.ts
commands/fanout.ts
```

`createProgram()` remains the side-effect-free factory (ADR-002 + `check-cli-surface`).
The surface rule is updated to allow `commands/*.ts` `register*Command` files and to
forbid `.parse(` in those files too.

**Runtime rules**

1. Command actions return or set an exit code; only `index.ts` / `main` may `process.exit`.
2. Output stays on `logger` (`out` / `info` / `error`). `--verbose` enables extra `info`.
3. Help and version write through Commander’s output (configure to `logger` if tests require it).
4. `bun run build` remains the publish artifact. `prepack` runs `build` so `npm pack` sees
   `dist/index.js` (npm ≥ 11 checks bin existence before lifecycle scripts — spur lesson).
5. Same-commit T3: `docs/04_DESIGN.md` §1 binary name becomes `kk`; command table unchanged
   except the prefix.
6. Dated ADR amendment: clarify ADR-004/007 — **package** name retained; **operator binary**
   is `kk` with optional `knowledge-kit` alias. This is not a package rename.

**Invariants**

- No new plugin kinds, no new pipeline verbs, no DAG runtime.
- Do not copy spur’s DB/app bootstrap, banner, or `--cli-verbose` naming; use `--verbose`.
- Do not author `.github/workflows/` or npm Trusted Publisher config.

## Recommendations

Ship Approach 1. The destination is a real `kk` binary that behaves like a normal CLI and
can grow by adding a file under `commands/`, not by stuffing `cli.ts`. Approach 2 fails the
growth requirement. Approach 3 breaks shipped `kk invoke`/`fanin`/`fanout` contracts.

`needs_design: true` — new command-module convention, binary-name ADR amendment, npm pack
surface, and a global-flag contract another engineer must reason about.

## Next Steps

1. Idea-eval taste gate (this report).
2. Create feature **A2** under **A** (CLI foundation owns the Commander shell / product package).
3. Author R-numbered AC for help/version/verbose, command-tree registration, `kk` bin +
   `knowledge-kit` alias, version source, exit-code seam, pack artifact, T3 docs, ADR note.
4. System design satellite `docs/design/kk-cli-surface.md` + ADR amendment.
5. Decompose into a small task batch (config/bin, program skeleton + flags, per-command
   moves, tests, docs/ADR).

## Spec self-review

- No `TODO` / `TBD` / `???` / empty sections.
- Scope creep checked: Trusted Publisher and native `--compile` binaries explicitly out.
- `add` kept (no silent delete). Compatibility `knowledge-kit` bin alias decided.
- Feature parent **A** (not B4: B4 is done and owns only `plugins list`/`doctor`).
- Command flag contracts unchanged — only structure, globals, and package/bin metadata.

---

**Generated by:** sp-brainstorm (idea-pipeline discovery)
**Research:** inline against knowledge-kit + spur-new trees (2026-08-12)
