---
name: publish
description: >-
  Thin operator surface for leftover publish channels — "publish this draft to
  Medium", "fan out to Qiita and Medium", "prepare a Juejin draft". Shells
  `kk executor run` / `kk fanout` for file-cli and script channels; sequences
  agent-default CMS channels as workflow `agent.run` steps. Does not own
  transport.
---

# publish — leftover channel operator surface

## Purpose

Drive harvested `kind: publish` plugins after a draft exists. **The plugin owns
transport and Result.** This skill selects the channel, confirms draft vs live,
and shells `kk` — it does not call an LLM from inside a plugin process and does
not add a `kk publish` noun.

## Channels

| Channel | Plugin | Transport | How this skill invokes it |
| --- | --- | --- | --- |
| medium | `medium-pub` | `file-cli` (token API) | `kk executor run medium-pub --in <content.json> --out <result.json>` |
| wechatmp | `wechatmp-pub` | `file-cli` (`draft/add`) | `kk executor run wechatmp-pub` (default operation `draft`) |
| x post | `x-pub` | `file-cli` (`POST /2/tweets`) | `kk executor run x-pub` (`options.operation` omitted / `post`) |
| x article | `x-pub` | `browser` / `agent` | workflow `agent.run` — not `kk fanout` |
| juejin | `juejin-pub` | `browser` / `agent` | workflow `agent.run` |
| infoq | `infoq-pub` | `browser` / `agent` | workflow `agent.run` |
| substack | `substack-pub` | `browser` / `agent` | workflow `agent.run` |
| xhs | `xhs-pub` | `browser` / `script` | `kk executor run xhs-pub --in <content.json> --out <result.json>` — its default `script` driver uploads the ordered card images with Playwright `setInputFiles`; the `agent` driver fails loud for this channel (ADR-024) |

Already-harvested file-cli channels (`qiita-pub`, `zenn-pub`, `surfdash-pub`,
`emdash-pub`, `podcast-pub`) compose the same way.

## XHS profile setup (0177)

`xhs-pub` reuses the signed-in session at `~/.config/kk/browser-profiles/xhs`; kk stores no
credentials. Before the first script-driver run (and after any session expiry), do a one-time
headed login, then verify reuse read-only:

```bash
bun plugins/publishings/xhs-pub/src/profile-check.ts login   # headed; sign in once in the window
bun plugins/publishings/xhs-pub/src/profile-check.ts check   # headless; exit 0 = session verified
```

`check` never signs in — with no saved profile it refuses (exit 1) instead of reporting success.
Overrides: `--profile <dir>`, `--timeout <ms>`; env fallback `XHS_PROFILE_DIR` / `KK_BROWSER_PROFILE_DIR`.

**ADR-025 (2026-09-28, after an XHS warning about automated activity).** Publish now runs this same
check as a **preflight** before opening anything headed — so a missing or expired session is a fast
refusal (`ok: false`) rather than a headed window sitting on the login gate for 120 s — and both
console visits are capped at **one headed publish cycle + one session check per 2 h**
(`~/.config/kk/xhs-automation.json`, override `KK_XHS_AUTOMATION_STATE`; a manual `check` draws on
the same `check` budget). A capped or sessionless publish fails with `ok: false` and a named reason.
`login` is never automated and never capped. Do not schedule XHS publishing: publish deliberately,
by hand, at most once a day, and prefer a draft.

## Do not

- Embed Playwright selectors or reimplement a transport here.
- Spawn an LLM from `kk fanout` (ADR-007 R4). Agent-default channels are
  sequential workflow `agent.run` steps — see
  `plugins/kk/workflows/leftover-publish-fanout-example.yaml`.
- Add a first-layer `kk publish` command.
- Put secrets in `--in` JSON or `plugin.json`. Env only.

## Confirmation

Default Result is **draft / unpublished**. Live publish (`public`, WeChat
`freepublish/submit`, CMS submit) requires an explicit operator confirmation
in this skill before the plugin is invoked with a live status. Under
`KK_NONINTERACTIVE=1`, proceed only when the `--in` payload already carries
the confirmed live status; otherwise fail naming the switch.

## Invocation

```
<channel> [--in <content.json>] [--out <result.json>] [--live]
          [--fanout <channel>,<channel>]
```

1. Resolve `--in` Content (required).
2. If `--fanout` lists two or more **file-cli or script** channels: run
   `kk fanout --in <content.json> --targets <list> --out <aggregate.json>`.
   Each target contributes one `targets[]` Result entry.
3. If the channel's default driver is `agent`: do **not** call `kk fanout`.
   Tell the operator (or the workflow) to run the page against
   `~/.config/kk/browser-profiles/<channel>` then `kk executor run <plugin>`
   so the plugin writes Result. The example workflow sequences that as
   `agent.run`.
4. Otherwise: `kk executor run <plugin> --in … --out …`.
5. Report `--out` `ok`, `target`, `id`/`url`, and `error` verbatim on failure.

## Env (plugin-owned; never echoed)

| Plugin | Required |
| --- | --- |
| medium-pub | `MEDIUM_INTEGRATION_TOKEN` |
| wechatmp-pub | `WECHAT_APP_ID`, `WECHAT_APP_SECRET` |
| x-pub `post` | `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` |

Missing env → plugin exit 1, `Result.ok false`, error names the variable.
