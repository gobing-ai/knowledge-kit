---
name: Features
doc: 05_FEATURES
owns: STATUS — feature decomposition + state
authority: derived
version: 1.1.0
created_at: 2026-07-22
updated_at: 2026-07-22
derived_from: [01_PRD, 02_ROADMAP]
edit_rules: 99 §6.6
sync: [T4]
---

# Features

> Derived. Feature status roll-up. Edit when a feature's status changes.

## Status legend

✅ done · 🔶 partial · ⏳ planned · 💤 deferred

## Feature tree

| ID | Feature | Status | Parent | Notes |
|----|---------|--------|--------|-------|
| F1 | CLI monorepo foundation | ✅ done | — | apps/cli + packages/utils + Biome/tsc/test gates |
| F2 | Starter `add` command | ✅ done | F1 | Example subcommand proving Commander + utils wiring |
| F3 | Spur harness bootstrap | ✅ done | F1 | `.spur/` config, rules, workflows; name `knowledge-kit` |
| F4 | `@gobing-ai/*` package scope | ✅ done | F1 | `@gobing-ai/knowledge-kit` + `@gobing-ai/utils` |
| F5 | Biome pin (latest at init) | ✅ done | F1 | Root devDependency + `.prototools` + schema (2.5.5) |
| F6 | Product command surface growth | ⏳ planned | F1 | Real domain commands replace/extend the starter |
| F7 | Product config package | 💤 deferred | F1 | When persistent config is required |
