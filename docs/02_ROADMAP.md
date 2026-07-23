---
name: Roadmap
doc: 02_ROADMAP
owns: WHEN — phases, current vs deferred, sequencing
authority: derived
version: 1.0.0
created_at: 2026-07-22
updated_at: 2026-07-22
derived_from: [00_ADR, 01_PRD]
edit_rules: 99 §6.3
sync: [T5]
---

# Roadmap

> Derived from `01_PRD` (scope) and `00_ADR` (decisions). Edit when phase status changes.

## Phases

| Phase | Status | Items |
|-------|--------|-------|
| Phase 0 — Foundation | ✅ done | Bun workspaces monorepo; `@gobing-ai/knowledge-kit` + `@gobing-ai/utils`; Commander shell; Biome 2.5.5 + tsc/test gates; Spur init |
| Phase 1 — Product surface | ⏳ planned | Grow CLI commands beyond starter `add`; package boundaries as needed; keep `04`/`05` in sync |
| Phase 2 — Hardening | 💤 deferred | Config package, Node-publish bin path, interactive UX — only when a real command requires them |

**Status legend:** ✅ done · 🔶 partial · ⏳ planned · 💤 deferred
