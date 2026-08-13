---
run_id: 2026-08-12-A21-two-layer-cli
status: complete
testee: "kk executor/plugin surface + .spur/workflows/kk-ingest-generate-publish.yaml"
classification: cli+workflow
mode: observe
feature_id: A21
task_wbs: "0052"
started_at: 2026-08-13T03:50:00Z
finished_at: 2026-08-13T03:55:00Z
protocol: sp-dogfood-testing@1.1
---

# Dogfood Report — A21 two-layer CLI nouns

## 1. Testee

- **Surface:** `kk executor run|fan-in|fan-out`, `kk plugin status`, hidden aliases, and
  `.spur/workflows/kk-ingest-generate-publish.yaml` (now shells `kk executor run`)
- **Feature:** A21 (task `0052`)
- **Why dogfood:** Solution edits `.spur/workflows/` (self-referential workflow L4)

## 2. Execution Summary

- **Result:** PASS
- **Gates this run:**
  - `bun run lint` exit 0
  - `bun run test` — 240 pass / 0 fail
  - `bun run build` — `@gobing-ai/knowledge-kit` exit 0
  - `spur workflow validate .spur/workflows/kk-ingest-generate-publish.yaml` — `valid: true`
  - `spur task check 0052` — pass
  - `spur feature check A21 --strict` — pass (before verifying→done hop)

## 3. Steps exercised

| Step | Outcome | Evidence |
|------|---------|----------|
| R1 help tree | PASS | `kk --help` lists `executor`, `plugin`, `help` only |
| R5 plugin status JSON | PASS | `kk plugin status --json --plugins-root ./plugins` exit 0, `healthy: true`, 5 plugins |
| Hidden aliases | PASS | `kk invoke` / `fanin` / `fanout` / `plugins list|doctor --help` exit 0 |
| Add retired | PASS | `kk add 1 2` exit 1 `unknown command 'add'` |
| Workflow template | PASS | three `kk executor run` shell steps; validate clean |
| Design surface | PASS | `docs/04_DESIGN.md` §1 names the two-noun tree |

## 4. Issues

None blocking. Residual P4 (declaration duplication; fan-in/fan-out argv rebuild) stay advisory
follow-ups, not A21 scope.

## 5. Findings

- **P2 (resolved this feature):** Commander 15 renders group `.alias('plugins')` in `kk --help`.
  Fixed with a hidden top-level `plugins` command (`apps/cli/src/commands/plugin.ts`).
- **P4** — option declarations duplicated on hidden aliases; argv rebuild into engines kept
  so engine signatures stay unchanged.

## 6. Verdict

A21 dogfood complete: two-noun CLI and the B3 workflow template are executable and validated.
Safe to mark feature A21 `done`.
