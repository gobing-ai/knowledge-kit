---
title: kk two-layer CLI nouns (executor + plugin)
date: 2026-08-12
needs_design: true
idea: Reshape the shipped kk command tree to two first-layer nouns — executor (run, fan-in, fan-out) and plugin (status) — replacing mixed-depth invoke/fanin/fanout/plugins list|doctor
---

# Brainstorm: kk two-layer CLI nouns

**Date:** 2026-08-12

## Overview

The shipped `kk` tree is mixed-depth: first-layer verbs (`invoke`, `fanin`, `fanout`, leftover
`add`) sit beside one noun group (`plugins list` / `plugins doctor`). ADR-010 already requires
`commands/<noun>.ts` + `registerXCommand`, but the registered names are still those mixed verbs.

The operator wants a permanent two-layer noun+verb surface with **exactly two first-layer nouns**:

```text
kk executor run     <plugin> --in <path> --out <path> [--plugins-root <dir>]
kk executor fan-in  --in <f>… --out <path>
kk executor fan-out --content <path> --target <p>… --out <path> [--retry-from <path>] [--plugins-root <dir>]
kk plugin status    [--kind <kind>] [--json] [--plugins-root <dir>]
```

This is a **command-tree reshape**, not new engines. `runInvoke` / `runFanin` / `runFanout` and
`discoverPlugins` stay. A2's 2026-08-12 brainstorm (Approach 3) rejected *kind-nouns*
(`ingest`/`generate`/`publish`) because they would invent a new taxonomy and break workflows.
This idea keeps the three pipeline steps and only nests them under `executor`.

`needs_design: true` — new public command contract, ADR-006/010 amendments, unified
`plugin status` JSON, and a compatibility-alias policy another engineer must reason about.

## Decision tree (resolved from the codebase)

### Root: keep noun+verb, two first-layer nouns
- **Resolved:** yes — `executor` and `plugin` only. Globals (`--help`/`--version`/`--verbose`) are
  not nouns. `kk add` is not a third noun; retire it.
- **Rationale:** operator stated the taxonomy; A2 already built the register-per-noun tree that
  this reshape fills.

### Branch: `executor run` ≡ current `kk invoke`
- **Resolved:** yes, same engine and flags.
- **Rationale:** `registerInvokeCommand` is a thin wrapper around `runInvoke({ plugin, inPath,
  outPath, pluginsRoot })`. No extra invoke flags exist.

### Branch: `executor` includes fan-in / fan-out
- **Resolved:** yes — `executor` means "pipeline step runner" (ADR-007: `kk` owns steps), not
  "plugin spawner only." Fan-in is a step that does not spawn a plugin; it still belongs here.
- **Rationale:** putting fan-in under `plugin` would lie; a third noun for merge/dispatch would
  violate "only two nouns."

### Branch: `plugin status` replaces `plugins list` and `plugins doctor`
- **Resolved:** yes, with a refinement — health is a per-plugin attribute **and** discovery still
  emits tree-level diagnostics (`misplaced`, `kind_mismatch`, `malformed`, `duplicate_name`) that
  are not attributes of a registered plugin.
- **Rationale:** current doctor JSON is `{ healthy, diagnostics }`; list JSON is `PluginRecord[]`.
  A naive "one more field on each plugin" would drop tree-level failures.

### Branch: compatibility
- **Resolved:** hidden aliases for one release; docs and the B3 workflow template move to the new
  names in the same commit.
- **Rationale:** `.spur/workflows/kk-ingest-generate-publish.yaml` still shells
  `knowledge-kit invoke`. Package is unpublished (`0.1.0`); `--json` consumers are in-repo tests.

## Approaches

### Approach 1: Two nouns + hidden aliases + unified status ⭐ Recommended

**Description:** Register `executor` (`run`, `fan-in`, `fan-out`) and `plugin` (`status`). Keep
engines in `invoke.ts` / `fanin.ts` / `fanout.ts`. Delete `add`. Hidden Commander aliases:
`invoke` → `executor run`; `fanin`/`fan-in` pair; `fanout`/`fan-out` pair; `plugins` → `plugin`;
`plugins list` / `plugins doctor` → `plugin status`. `status --json` is one object (plugins with
health + leftover tree diagnostics + overall `healthy`). Exit `1` when unhealthy (doctor CI gate).

**Trade-offs:**
- **Pros:**
  - Matches the operator taxonomy and ADR-010's noun-file rule (`commands/executor.ts`,
    `commands/plugin.ts`).
  - Does not rewrite engines or B5/B6 behavior.
  - Hidden aliases keep B3's workflow and muscle memory from breaking the same day.
  - One inspection command; CI can still fail on a dirty plugins tree.
- **Cons:**
  - `kk executor run` is longer than `kk invoke` for the hottest path (workflows).
  - `--json` shape for list/doctor is a breaking change (mitigated: unpublished, tests-only).
  - Must amend ADR-006's named `kk invoke` substrate and A2's "flags and names unchanged" invariant.

**Implementation Notes:**
- Do not keep dual JSON shapes behind the aliases — aliases call the same `status` action.
- `missing_entry` stays a per-plugin diagnostic (doctor adds it today after discovery).
- Same-commit T3: `docs/04_DESIGN.md` §1, `docs/design/kk-cli-surface.md`, fan-in spec wording,
  B3 workflow template, README command table.
- Dated ADR: amend ADR-006 (`kk executor run` is the uniform entrypoint; `invoke` is alias) and
  ADR-010 (nouns are `executor` + `plugin`; `add` retired).

**Confidence:** HIGH
**Sources:**
- `apps/cli/src/cli.ts`, `commands/{invoke,fanin,fanout,plugins,add}.ts` (2026-08-12)
- `docs/00_ADR.md` ADR-006 amdt 2026-07-24, ADR-007 R4, ADR-010 (2026-08-12)
- `docs/04_DESIGN.md` §1 / §1.5 / §1.6 (2026-08-12)
- `packages/kk-core/src/registry.ts` `PluginRecord` / `DiscoveryDiagnostic` (2026-08-12)
- `.spur/workflows/kk-ingest-generate-publish.yaml` (2026-08-12)
- `docs/plans/2026-08-12-kk-cli-surface-brainstorm.md` Approach 3 rejection (2026-08-12)

### Approach 2: Single noun `plugin` for everything

**Description:** `kk plugin run|fan-in|fan-out|status`. One first-layer noun.

**Trade-offs:**
- **Pros:**
  - Shorter help; one group.
  - `plugin run` reads naturally.
- **Cons:**
  - Fan-in does not operate on a plugin. The noun would be a lie for the merge step.
  - Operator explicitly asked for two nouns with `executor` as the step runner.

**Implementation Notes:** Rejected unless the operator withdraws the two-noun constraint.

**Confidence:** HIGH
**Sources:**
- ADR-007 R4 — fan-in/fan-out are `kk` step invocations, not plugin verbs (2026-08-12)
- `apps/cli/src/fanin.ts` — no plugin resolution (2026-08-12)

### Approach 3: First-layer verbs + `plugin status` only

**Description:** Rename in place: `kk run` / `kk fan-in` / `kk fan-out` / `kk plugin status`.
Retire `add`. Mixed depth remains (three verbs + one noun).

**Trade-offs:**
- **Pros:**
  - Hot path stays two tokens (`kk run`).
  - Smaller help-text change.
- **Cons:**
  - Violates "only two first-layer nouns."
  - Next step (`dry-run`, `plan`, …) has no noun to hang on.

**Implementation Notes:** Rejected against the stated taxonomy. Revisit only if workflow
verbosity of `executor run` becomes a measured pain.

**Confidence:** HIGH
**Sources:**
- Operator idea text (this session, 2026-08-12)
- ADR-010 growth rule — new work is a new noun file (2026-08-12)

## Design Summary

**Chosen approach:** Approach 1.

**Operator-facing contract**

| Item | Decision |
|------|----------|
| First-layer nouns | `executor`, `plugin` only |
| Globals (not nouns) | `--help`/`-h`, `--version`/`-V`, `--verbose`/`-v` |
| `executor run` | Current `invoke` engine + flags (`<plugin> --in --out [--plugins-root]`) |
| `executor fan-in` | Current `fanin` engine + flags; canonical hyphen; alias `fanin` |
| `executor fan-out` | Current `fanout` engine + flags; canonical hyphen; alias `fanout` |
| `plugin status` | Inventory + health. `--kind`, `--json`, `--plugins-root` |
| `status --json` | `{ healthy, plugins: PluginRecord & { healthy, diagnostics }[], diagnostics }` |
| `status` exit | `0` healthy, `1` any diagnostic (including tree-level), `2` usage |
| Retired | `kk add` |
| Hidden aliases (one release) | `invoke`; top-level `fanin`/`fanout`; `plugins`; `plugins list`; `plugins doctor` |
| Engines | Unchanged (`runInvoke` / `runFanin` / `runFanout` / `discoverPlugins`) |
| Install/remove | Still out — `superskill install` owns distribution (B4 Scope Out) |

**Module layout**

```
apps/cli/src/commands/executor.ts   # registerExecutorCommand — run, fan-in, fan-out + hidden aliases
apps/cli/src/commands/plugin.ts     # registerPluginCommand — status + plugins/list/doctor aliases
apps/cli/src/commands/add.ts        # DELETE
apps/cli/src/invoke.ts | fanin.ts | fanout.ts   # engines stay
```

**Invariants**

- No new plugin kinds, no DAG runtime, no kind-nouns (`ingest`/`generate`/`publish`).
- Flag names and exit codes of the three pipeline engines stay.
- `--json` stays per-command (ADR-010 R6).
- Same-commit T3 for `docs/04_DESIGN.md` §1.
- Feature parent: **A21** under **A2** (product CLI surface). Not B4 (B4 Goal is list+doctor only,
  and is `done`).

## Recommendations

Ship Approach 1. The destination is a two-noun tree that matches how the product already talks
("kk owns steps; plugins are discovered units"). Approach 2 lies about fan-in. Approach 3 leaves
the mixed-depth problem the operator asked to close.

Confirm on approve: retiring `add`, hidden aliases, and status exit `1` on unhealthy are in
scope — not follow-ups.

## Next Steps

1. Idea-eval taste gate (this report).
2. Create feature **A21** under **A2**.
3. Author R-numbered AC for the two-noun help tree, `executor *` parity, `plugin status` merge,
   aliases, `add` removal, T3/ADR.
4. System-design satellite update (`docs/design/kk-cli-surface.md`) + ADR amendments.
5. One implementation task (cohesive CLI-tree reshape; do not split by command).

## Spec self-review

- No `TODO` / `TBD` / `???` / empty sections.
- Scope creep checked: no install/remove, no kind-nouns, no engine rewrites, no `--dedupe`.
- Tree-level diagnostics called out so status cannot silently drop `misplaced` / `kind_mismatch`.
- Feature parent **A2** (not B4, not a new root).
- `add` retirement is explicit (A2 had left it in).

---

**Generated by:** sp-brainstorm (idea-pipeline discovery)
**Research:** inline against knowledge-kit tree (2026-08-12)
