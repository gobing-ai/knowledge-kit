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
| xhs | `xhs-pub` | `browser` / `agent` | workflow `agent.run` |

Already-harvested file-cli channels (`qiita-pub`, `zenn-pub`, `surfdash-pub`,
`emdash-pub`, `podcast-pub`) compose the same way.

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
