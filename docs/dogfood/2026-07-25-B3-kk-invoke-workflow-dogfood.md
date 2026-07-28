---
run_id: 2026-07-25-B3-kk-invoke-workflow
status: complete
testee: "knowledge-kit invoke + .spur/workflows/kk-ingest-generate-publish.yaml"
classification: cli+workflow
mode: observe
feature_id: B3
task_wbs: "0005"
started_at: 2026-07-25T17:00:00Z
finished_at: 2026-07-25T17:30:00Z
protocol: sp-dogfood-testing@1.1
---

# Dogfood Report — B3 Spur workflow integration

## 1. Testee

- **Surface:** `knowledge-kit invoke <plugin> --in --out [--plugins-root]` and spur template `.spur/workflows/kk-ingest-generate-publish.yaml`
- **Feature:** B3 (task `0005`)
- **Why dogfood:** Solution references `.spur/workflows/` (self-referential workflow infrastructure L4)

## 2. Execution Summary

- **Result:** PASS
- **Gates this run:**
  - `bun run autofix` exit 0
  - `bun run spur-check` exit 0 (36 tests, rules clean)
  - `bun run test` — 36 pass / 0 fail; aggregate funcs 100%, lines 98.35%
  - `spur workflow validate .spur/workflows/kk-ingest-generate-publish.yaml` — valid
  - `spur task check 0005` — pass:true

## 3. Steps exercised

| Step | Outcome | Evidence |
|------|---------|----------|
| R1 invoke happy path | PASS | `apps/cli/tests/invoke.test.ts` R1 — generator entry writes Content |
| R2 input schema gate | PASS | R2 test — bad Doc fails before spawn (marker never written) |
| R4 fail loud | PASS | R4 test — entry exit 2 → invoke exit 2 |
| Ingestion opaque source | PASS | ingestion fixture test with source dir |
| Workflow template validate | PASS | `kk-ingest-generate-publish` state-machine chains three `knowledge-kit invoke` shell steps |
| Design surface | PASS | `docs/04_DESIGN.md` documents invoke CLI |

## 4. Issues

None blocking. Residual: platform feature B scenarios R1–R3 (full e2e with real plugins) remain for vertical composition once sample plugins exist; B3 delivers the invoker + template only.

## 5. Findings

- **P4** — Local `Bun.spawnSync` only; remote execution out of scope (ADR-006).
- **P3** — Biome info-only `useTemplate` on legacy `add` command path (unrelated to B3).

## 6. Verdict

B3 dogfood complete: invoke entrypoint and workflow template are executable and validated. Safe to mark feature B3 `done` and re-parent delivery task `0005` to parent **B** (L4.feature-terminal).
