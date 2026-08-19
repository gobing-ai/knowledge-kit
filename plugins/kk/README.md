# `plugins/kk` — Claude Code capability plugin

This directory is the **only** home for knowledge-kit agent capabilities (ADR-009).
It is a Claude Code / Superskill plugin, **not** a kk-core product plugin.

| Path | Holds |
|------|--------|
| `skills/` | Fat skills (`SKILL.md`) |
| `commands/` | Thin slash-command wrappers |
| `agents/` | Thin subagent wrappers |
| `hooks/` | Hook definitions |
| `rules/` | Agent rules |

`discoverPlugins` skips this directory. Product plugins (`ingestion` / `generator` /
`publish`) live under `plugins/ingestions|generations|publishings/<name>/`.

Install: `superskill install kk`.

Capability files **omit a leading `kk-`**. `superskill install` prefixes the plugin name, so
`skills/judge` installs as `kk:judge` (not `kk:kk-judge`). Same for `topic`, `storm-research`,
`itc-generating`, `/workflow-run`, and the `judge-*` subagents. Product workflow YAML (`kk-storm-research.yaml`)
keeps its existing name — that is a workflow stem, not an installable agent capability.
