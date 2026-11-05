---
name: web-automation
description: >-
  Discover, enhance, and automate web tasks with Playwright (or agent-browser
  over CDP) — "walk this console and record evidence", "figure out this site's
  UI", "automate this web flow", "reuse my cached login on <channel>", "check
  whether my session on <channel> is still valid", "fix this channel's
  selectors", or when a spur workflow `agent.run` step targets the
  web-automation skill. Owns method and evidence; transport stays in kk
  plugins; orchestration is a @gobing-ai/ts-dual-workflow-engine
  transition-flow (see docs/design/web-automation-engine.md).
requires: [cli:spur, local-fs]
---

# web-automation — discover, enhance, automate with a real browser

## Purpose

Three operations over one method: drive a **real Chromium on the channel's
cached login profile**, record **evidence** (screenshots, DOM signals, JSON),
and never report an outcome that was not observed.

| Operation | When | Output |
| --- | --- | --- |
| **discover** | new/changed site; "figure out this UI" | evidence dir + drift list (`docs/design/<channel>-ui-discovery.md` convention) |
| **enhance** | selectors/signals drifted; a plugin or workflow fails on a live console | fixed selectors/signals in the owning plugin + updated discovery doc, same commit |
| **automate** | a repeatable web task (login-gated save/draft/fill/read) | workflow-driven run with per-step Result/evidence; draft-safe by default |

This skill owns **method**. It does not own transport (that is the
`kind: publish`/`ingestion` plugins) or orchestration (that is the engine —
`spur workflow` runs `@gobing-ai/ts-dual-workflow-engine`; see
`docs/design/web-automation-engine.md` for the layering and the YAML).

## Cached login (`auth: cached` — the default)

Login state is cached **per channel** as a persistent Playwright profile dir —
cookies, localStorage, and session live on disk outside git:

```
~/.config/kk/browser-profiles/<channel>   # xhs, infoq, juejin, substack, x, wechatmp
```

| `auth` | Behavior |
| --- | --- |
| `cached` (default) | Preflight the profile; reuse it read-only. Launch with `launchPersistentContext` (see `references/browser-launch.md`). No credentials are typed, read, or stored by any script. |
| `fresh` | Profile missing/expired → **headed** launch, operator completes login by hand (QR/OAuth/password), then the profile is the cache again. Never auto-type credentials; OAuth gates need the stealth args. |

Preflight before any drive — cheap and headless:

```bash
test -d ~/.config/kk/browser-profiles/<channel> && echo cached || echo fresh-required
```

A profile dir existing is necessary, not sufficient: before `automate` runs,
do a read-only session probe (open the console URL, check a signed-in-only
selector) and route to `fresh` on failure. Age-guessing timestamps is banned —
probe, don't predict.

## Method

1. **Launch** — `chromium.launchPersistentContext(profileDir, { headless, args: [CDP port, stealth] })`.
   Decision table and the exact snippet: `references/browser-launch.md`.
2. **Discover** — screenshot first, then read DOM (selectors, shadow roots,
   iframes, counts) with small throwaway scripts; save frames + a signals JSON
   into the run's evidence dir; write/refresh the channel's
   `docs/design/<channel>-ui-discovery.md` (selectors, drift list, date).
3. **Enhance** — diff observed DOM against the plugin's encoded
   selectors/signals; fix the plugin (root cause — one shared helper, not
   every caller), re-walk to prove it, update the discovery doc in the same
   commit.
4. **Automate** — encode the flow as engine workflow nodes (preflight →
   launch → drive → verify → record); `drive` steps run the measured
   selectors and **assert an observed outcome signal** (toast, counter delta,
   URL change). An unobserved outcome is reported as failure, never success.
5. **Confidence-verified verdicts** — every outcome verdict carries
   `confidence: HIGH | MEDIUM | LOW` (HIGH = measured signal observed;
   MEDIUM = indirect signal, e.g. counter delta without toast; LOW = partial
   evidence, one check passed). **Missing or out-of-enum confidence is itself
   a failure** — the verify gate blocks it, mirroring the safety-verdict
   convention (`kk-daily-ai-voice.md`, 20261003).

## Safety rails (non-negotiable)

- **Never click publish/send/submit/delete** unless the task explicitly
  authorizes live publishing. Default target: draft/save/暂存.
- Bot-walled channels (xhs) and fresh logins stay **headed**; headless only
  after the session is proven.
- Every reported success cites observed evidence (signal, screenshot, JSON).
  No evidence → it is a failure with the reason — and every verdict states
  its `HIGH | MEDIUM | LOW` confidence; a verdict without a valid level
  fails the gate like a missing verdict.
- Secrets stay out of repo, YAML, and vars. Login state lives only in the
  profile dir under `~/.config` (outside git); scripts print paths, never tokens.
- One browser per channel/profile at a time; close contexts you launched.

## Engine invocation (summary)

Orchestration is a `kind: transition-flow` workflow; `startable` nodes let a
run re-enter at `drive` after a manual login without redoing earlier nodes.
Full YAML, node contract, and the option-B (in-process runners) design:
`docs/design/web-automation-engine.md`.
