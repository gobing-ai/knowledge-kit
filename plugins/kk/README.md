# `plugins/kk` — Claude Code capability plugin

This directory is the **only** home for knowledge-kit agent capabilities (ADR-009).
It is a Claude Code / Superskill plugin, **not** a kk-core product plugin.

| Path | Holds |
| ------ | -------- |
| `skills/` | Fat skills (`SKILL.md`) |
| `commands/` | Thin slash-command wrappers |
| `agents/` | Thin subagent wrappers (currently empty — see below) |
| `hooks/` | Hook definitions |
| `rules/` | Agent rules |
| `workflows/` | Design-time product YAML SSOT (ADR-009). Runtime dest is `$HOME/.config/kk/workflows` via `/workflow-run` |
| `schedules/` | launchd/cron **templates** for the shipped workflows (`kk schedule render` prints them) |

`agents/` is reserved for thin wrappers of fat skills. It is empty: `judge-tech` /
`judge-tone` / `judge-compliance` were retired (2026-08-19). Rubric selection lives on
`content-judge` (`agent.run` prompt or `--judge` on `itc-generating`). Do not re-add a
persona wrapper unless a new skill owns a distinct run procedure.

`discoverPlugins` skips this directory. Product plugins (`ingestion` / `generator` /
`publish`) live under `plugins/ingestions|generations|publishings/<name>/`.

Install: `superskill install kk`.

Capability files **omit a leading `kk-`**. `superskill install` prefixes the plugin name, so
`skills/content-judge` installs as `kk:content-judge` (not `kk:kk-content-judge`). Same for `topic`,
`storm-research`, `itc-generating`, `explain-things` (via `/tell-me`), and `/workflow-run`. Product workflow YAML (`kk-storm-research.yaml`)
keeps its existing name — that is a workflow stem, not an installable agent capability.

### Grok Bot

Install: `superskill install kk --targets grok-bot --bot-provides cli:kk --bot-provides local-fs`.
Add `--bot-provides cli:spur` when the Bot ran the spur bootstrap.

Each skill and command declares a `requires:` list (`hooks`, `subagents`, `local-fs`, `cli:<name>`)
so the install ships only entries the Bot can run; the guard test is
`plugins/kk/tests/runtime-requires.test.ts`. Which kk work may actually run in the cloud is decided
by ADR-044 (`docs/00_ADR.md`): cloud Grok Bot routines are store-free and browser-free —
anything touching `kk.db` or a browser profile stays Mac-side.

## Schedule

`spur serve` **hosts the scheduler**: the `.spur/config.yaml` `bootstrap.scheduler` jobs (the daily
`kk-daily-ai-voice` tick) are enqueued by the job worker that lives inside the server, so the server
itself is what must be kept alive. kk ships the templates and `kk schedule render` prints the
artifact for the platform — **installing it is an operator action** (kk never writes a crontab or a
`LaunchAgents` plist):

```bash
# kk-serve: keep the spur server — and therefore the scheduler that fires the daily pipeline —
# running whenever you are logged in. kk-serve is launchd-only (cron cannot restart a dead
# server): `--platform cron` exits 1 instead of printing a line that cannot do the job.
mkdir -p "$PWD/.works/spur-serve"
kk schedule render kk-serve --platform launchd --repo "$PWD" \
  > ~/Library/LaunchAgents/ai.gobing.spur-serve.plist
launchctl bootout gui/$(id -u)/ai.gobing.spur-serve 2>/dev/null || :
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.gobing.spur-serve.plist

# launchd (macOS): every 6 h at 04:00/10:00/16:00/22:00 local (StartCalendarInterval), one shared log
# 1. the log directory must exist — launchd opens StandardOutPath but never creates its parent
mkdir -p "$PWD/.works/kk-collect"
# 2. render + bootstrap (the plist carries the PATH launchd's default lacks)
kk schedule render kk-collect --platform launchd --repo "$PWD" \
  > ~/Library/LaunchAgents/ai.gobing.kk-collect.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.gobing.kk-collect.plist

# cron: the same 6-hourly cadence (the rendered line carries its own mkdir + PATH).
# Merge, never replace: `| crontab -` discards every other job in the operator's crontab.
crontab -l > /tmp/kk-collect.cron 2>/dev/null || :
kk schedule render kk-collect --platform cron --repo "$PWD" >> /tmp/kk-collect.cron
crontab /tmp/kk-collect.cron

# Grok Bot cloud routine (ADR-044): prints a routine definition for the store-free kk-collect
# prefix — the Bot owns preparation, the Mac owns the kk store. Paste the printed text into the
# Bot's routine editor (creating the routine there is the operator action; kk never calls an API).
# kk-serve and the publish3 windows are refused on grok-bot: they are store- or browser-bound.
kk schedule render kk-collect --platform grok-bot --bot kk-cloud --tz "$TZ" \
  | pbcopy   # then paste into the Bot's routine editor
```

Both rendered artifacts set `PATH` themselves (`{{home}}/.bun/bin`, `/opt/homebrew/bin`,
`/usr/local/bin`, then the system dirs). That is what the workflow's **children** need — `kk`, `jq` and
the plugins are all `#!/usr/bin/env bun` or PATH-resolved, and `launchd`/`cron` start with a minimal
`PATH`. It is **not** what resolves the scheduler's own command: launchd looks up a *relative*
`ProgramArguments[0]` with its fixed `_PATH_STDPATH` before the job environment exists, so the plist
also carries an absolute `Program` (`{{home}}/.bun/bin/spur`) while keeping `ProgramArguments` as the
frozen argv. Set both to wherever `spur`/`bun` actually live, and `mkdir -p` the log directory first
(cron's `>>` aborts before the command runs when its directory is missing).

Both artifacts **also bind `TYPESAFE_API_KEY` from the environment `kk schedule render` runs in**, so
render from a shell that has it. `kk store label` consults the `typesafe` decision maker for
`kk-item-china-politics`/`-sensitivity`/`-audience`, spur keeps that credential env-only, and a
scheduled job inherits nothing from your shell: without the key those labels degrade to their
fail-closed defaults (`china-politics` = 3), the `ai-news` extract profile's `lte: 1` gate drops the
whole day, and the daily run closes as no-content. A render without the key is still valid — the
value is simply empty, which spur reads as "not set". The rendered artifact carries a live
credential: keep it in `~/Library/LaunchAgents` (or your crontab), never in a committed file.

`kk-collect` collects every ingestion source into the kk store and never publishes. Two ticks that
overlap are **one** collection: the first state takes `kk store lock acquire --name collect` and a
tick that finds the claim inside its TTL exits 0 (`skipped`) without collecting. Before relying on
the schedule, check the store is reachable from the scheduled checkout (`kk store migrate`), and
`tail -f "$PWD/.works/kk-collect/launchd.log"` after the first launch.

The `kk-serve` plist keeps the same `Label` (`ai.gobing.spur-serve`) as the hand-installed one, so
re-rendering replaces it in place instead of starting a second server on port 3003. It carries the
same PATH + `TYPESAFE_API_KEY` block, plus `RunAtLoad`, `KeepAlive` and `ThrottleInterval` 10 — its
`spur serve --cwd <repo> --host 127.0.0.1 --port 3003 --no-open` stdout/stderr goes to
`$PWD/.works/spur-serve/serve.log`, and the scheduler's registration line lands in
`$PWD/.spur/logs/spur.log` (never in `serve.log`).
