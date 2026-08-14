---
run_id: 2026-08-13-B7-multi-root-plugin-discovery
status: complete
testee: "kk multi-root discovery + .spur/workflows/kk-ingest-generate-publish.yaml"
classification: cli+workflow
mode: observe
feature_id: B7
task_wbs: "0053"
started_at: 2026-08-13T23:40:00Z
finished_at: 2026-08-13T23:55:00Z
protocol: sp-dogfood-testing@1.1
---

# Dogfood Report — B7 multi-root plugin auto-discovery

## 1. Testee

- **Surface:** `kk plugin status`, `kk executor run|fan-out` (`--plugins-path` / `--plugins-root`),
  and `.spur/workflows/kk-ingest-generate-publish.yaml` (now injects `--plugins-path`)
- **Feature:** B7 (task `0053`)
- **Why dogfood:** Solution edits `.spur/workflows/` (self-referential workflow L4)

## 2. Execution Summary

- **Result:** PASS
- **Gates this run:**
  - `bun run lint` exit 0 (Biome 2.5.5 + typecheck, 84 files)
  - `bun run test` — 266 pass / 0 fail (863 expect); aggregate coverage 99.27% functions / 99.24% lines
  - `spur workflow validate .spur/workflows/kk-ingest-generate-publish.yaml` — `valid: true`
  - `spur task check 0053` — pass
  - `spur feature check B7` — pass (L4.dogfood-missing cleared by this report)

## 3. Steps exercised

| Step | Outcome | Evidence |
|------|---------|----------|
| R1 default discovery | PASS | `kk plugin status --json` (no `--plugins-root`) → 5 plugins, all `origin: builtin`, `healthy: true`; `plugins/kk` absent |
| R4 exclusive `--plugins-root` | PASS | `--plugins-root <isolated-tree>` registers only `isolated-pub`; no package-shipped names |
| R10 additive `--plugins-path` | PASS | `--plugins-path <extra-gen/>` unions `extra-gen` (`origin: path`, kind generator) with the 5 built-ins |
| R11 flag exclusivity | PASS | `--plugins-root` + `--plugins-path` → exit 2, stderr `mutually exclusive (ADR-012 R6)` |
| R3 name resolve | PASS | `kk executor run extra-gen --plugins-path <dir>` finds the plugin (fails later on generator schema — expected stub); without `--plugins-path` → `not found in the merged plugin registry` |
| Help surface | PASS | `plugin status`, `executor run`, `executor fan-out` all list `--plugins-path` (repeatable) and exclusive `--plugins-root` |
| Workflow template | PASS | `vars.plugins_path`; three `kk executor run … --plugins-path ${vars.plugins_path}` shells; no `extensions.actions` / `extensions.guards` |
| Design surface | PASS | `docs/04_DESIGN.md` §1/§3 names merged discovery, `--plugins-path`, `KK_PLUGIN_PATH`, `origin` |

## 4. Issues

None blocking. Residual (out of this repo, not B7 scope):

- ts-libs C1 / task 0062 and spur-new D4 / task 0533 still own workflow YAML `extensions:` load.
- `KK_PLUGIN_PATH` / missing `--plugins-path` dirs stay silent (no diagnostic) — documented gotcha.

## 5. Findings

- Exclusive `--plugins-root` stamps `origin: path` (the isolation override is not a fourth default root). Expected: only that tree is scanned.
- A single-folder `--plugins-path` whose directory contains `plugin.json` is classified as one plugin (kind from the manifest). Confirmed with `extra-gen`.
- Product plugins stay name-resolved via `kk executor run`; the B3 template does not list them under workflow `extensions:`.

## 6. Verdict

B7 dogfood complete: merged discovery, additive `--plugins-path`, exclusive `--plugins-root`, and the B3 workflow template are executable and validated. Safe to mark feature B7 `done`.
