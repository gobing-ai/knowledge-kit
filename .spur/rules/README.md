# Spur Rules

This directory is the **single source of truth** for Spur's quality-gate ruleset.
It is self-contained and authoritative — `spur rule run` resolves all categories
and presets from local `.spur/rules/**/*.yaml` with no fallback to a global
install or to ts-libs.

## Categories

| Category | Dir | Purpose |
|---|---|---|
| `typescript` | `typescript/` | TypeScript tooling, output boundaries, biome-suppression ban, no `debugger` |
| `strict` | `strict/` | Opt-in strict rules (runtime boundaries, HTTP boundaries, structural) |
| `boundary` | `boundary/` | DB/DAO boundary enforcement |
| `structure` | `structure/` | File layout, protected files, plugin kind-collections (ADR-009), no focused/skipped tests |
| `quality` | `quality/` | Post-test gates (coverage) |
| `surface` | `surface/` | CLI surface consistency (registerXxxCommand wiring, --json serialization) |

## Presets

| Preset | When | Extends |
|---|---|---|
| `recommended-pre-check` | Before tests | `typescript`, `structure`, `boundary`, `surface` |
| `recommended-post-check` | After tests | `quality` |
| `strict-check` | Opt-in | `strict` |

## `include` on an `exit-code` rule is documentation, not scope

The `exit-code` evaluator shells out once and gates on the exit status, so it runs whether or not a
rule's `include` globs match anything — measured 2026-10-12: a copy whose `include` pointed at a
nonexistent path still executed (`✗ 1 warning`, reported against `<workspace>`). Scope for these
rules therefore lives in the checker's own discovery (`--run-dir` / `--workflows` / explicit path
arguments), and the `include` block is a reader's summary of that scope. **Do not narrow an
`exit-code` rule's globs expecting the rule to stop firing** — change the checker. Rules with this
shape here: `structure/verification-confidence-level`, `structure/verdict-confidence-proof`,
`structure/verification-answer-confidence-level`, `structure/verdict-artifact-confidence-level`,
`structure/api-library-claim-citation`, `structure/scratch-citation-existence`,
`strict/rule-files-structural`, `migration/rg-dialect`. (Content-scanning evaluators — `regex`, `rg`,
`forbidden-import`, `secrets-scanner` — are the opposite trap: their globs match in *loose*
substring/suffix mode, so a deep glob like `apps/**/*.ts` collapses to a fragment; see
`structure/protected-files.yaml` for the fragment-scoped idiom.)

## Relationship to ts-libs

Rules originally authored in `ts-libs/.spur/rules/` were **absorbed and adapted**
(here, not copied verbatim). Each absorbed file carries an `Absorbed from
ts-libs/.spur/rules/...` header documenting what was re-scoped, omitted, or
tuned for Spur's app-repo layout. After absorption, ts-libs and spur-new
maintain their rulesets independently.

## Not absorbed (Spur-irrelevant)

- `typescript/esm-build-conventions` — governs ts-libs' library publish/dist
  flow. Spur apps don't publish libraries this way.
- `migration/rg-dialect` — one-time grep→rg migration helper.
- `migration/rg-migration` — one-time grep→rg migration helper.
