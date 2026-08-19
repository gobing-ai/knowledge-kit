# `plugins/kk` — Claude Code capability plugin

This directory is the **only** home for knowledge-kit agent capabilities (ADR-009).
It is a Claude Code / Superskill plugin, **not** a kk-core product plugin.

| Path | Holds |
|------|--------|
| `skills/` | Fat skills (`SKILL.md`) |
| `commands/` | Thin slash-command wrappers |
| `agents/` | Thin subagent wrappers (currently empty — see below) |
| `hooks/` | Hook definitions |
| `rules/` | Agent rules |
| `workflows/` | Product workflow YAML SSOT (ADR-009 amendment) |

`agents/` is reserved for thin wrappers of fat skills. It is empty: `judge-tech` /
`judge-tone` / `judge-compliance` were retired (2026-08-19). Rubric selection lives on
`content-judge` (`agent.run` prompt or `--judge` on `itc-generating`). Do not re-add a
persona wrapper unless a new skill owns a distinct run procedure.

`discoverPlugins` skips this directory. Product plugins (`ingestion` / `generator` /
`publish`) live under `plugins/ingestions|generations|publishings/<name>/`.

Install: `superskill install kk`.

Capability files **omit a leading `kk-`**. `superskill install` prefixes the plugin name, so
`skills/content-judge` installs as `kk:content-judge` (not `kk:kk-content-judge`). Same for `topic`,
`storm-research`, `itc-generating`, and `/workflow-run`. Product workflow YAML (`kk-storm-research.yaml`)
keeps its existing name — that is a workflow stem, not an installable agent capability.
