# Web automation on `@gobing-ai/ts-dual-workflow-engine`

**Status:** proposed design; the `web-automation` skill ships with this commit
(`plugins/kk/skills/web-automation/`). Implementation tasks route through
`/sp:dev-plan`. Engine facts verified against `@gobing-ai/ts-dual-workflow-engine@0.5.16`
(`/Users/robin/xprojects/ts-libs/packages/dual-workflow-engine`).

## 1. Layering (ADR-007 preserved)

| Layer | Owner | Does |
| --- | --- | --- |
| Method | `web-automation` skill | launch recipes, evidence discipline, cached-login contract |
| Transport | kk plugins / scripts | measured selectors, real console actions, Result emission |
| **Orchestration** | **the engine** | node sequence, guards, retries, HITL notes, resume |

`kk` owns steps; the engine owns orchestration — the web-automation pipeline is
just another pipeline, executed one node at a time by the same engine that runs
`spur workflow`. No new runtime, no new orchestrator.

## 2. The workflow (recommended: option A — YAML through `spur workflow`)

A `kind: transition-flow` definition; every node either shells a step or is an
`agent.run` step driving the skill. `startable` nodes (engine ADR-035 fresh-run
entry) let a run re-enter at `drive` after a manual login without re-running
preflight/launch.

```yaml
# .spur/workflows/web-automation.yaml
$schema: "@gobing-ai/ts-dual-workflow-engine/schemas/transition-flow-workflow.schema.json"
kind: transition-flow
name: web-automation
initialNode: preflight
terminalNodes: [done, failed]
vars:
  channel: xhs            # xhs | infoq | juejin | substack | x | wechatmp
  task: discover          # discover | enhance | automate
  auth: cached            # cached | fresh
  headless: "false"
env:
  allow: [HOME]
nodes:
  - id: preflight
    type: gate            # profile exists? session probe passes? else fresh-required
  - id: fresh-login
    startable: true
    onEnter:
      - kind: note        # engine emits workflow.hitl.note → operator attends headed login
        options: { message: "headed login required on ${vars.channel}; complete it, then resume at drive" }
  - id: launch
    type: action          # launchPersistentContext on the cached profile, CDP port out
  - id: drive
    startable: true
    type: action          # discover/enhance/automate per vars.task (shell step or agent.run of kk:web-automation)
  - id: verify
    type: gate            # observed outcome signals present in evidence JSON, else fail loud
  - id: record
    type: action          # evidence dir + drift list + discovery doc touch-up
  - id: done
  - id: failed
edges:
  - { from: preflight, to: launch }
  - { from: preflight, to: fresh-login, condition: { kind: auth-fresh-required } }
  - { from: fresh-login, to: drive, condition: { kind: action-ok } }
  - { from: launch, to: drive, condition: { kind: action-ok } }
  - { from: drive, to: verify, condition: { kind: action-ok } }
  - { from: verify, to: record, condition: { kind: action-ok } }
  - { from: record, to: done }
  - { from: verify, to: failed }
```

Run semantics that matter here:

- **One node at a time.** Action nodes are sequential (kk ADR-007 R4). Engine
  0.5.16 adds structured `parallel` fork-join (`src/transition-flow.ts:150`),
  but multi-channel fan-out still runs kk steps per channel, and browser
  profiles are one-context-per-channel — parallel only across distinct channels.
- **`onError: 'continue'`** on `record`-class nodes so evidence is written even
  when the drive failed — evidence or it didn't happen.
- **Guards** (`auth-fresh-required` and `verify`'s signal check) are pure
  reads: profile dir existence + the skill's read-only session probe. No
  browser side effects in guards.
- Orchestration surface: `spur workflow run` (or a thin `WorkflowService.run`
  caller for tests). The YAML lands with the implementing feature task.

## 3. Cached login credentials as a workflow option

The credential cache **is the persistent profile dir**
(`~/.config/kk/browser-profiles/<channel>` — already shipped for all six
channels; see the skill's `references/browser-launch.md`).

Design rules:

1. **`auth` is a workflow var** (`cached` default | `fresh`), consumed by the
   `preflight` guard — it never reaches transport options or the command line.
2. **Cached path:** guard passes when the dir exists *and* the session probe
   (read-only signed-in-only selector check) passes. Existence alone is
   necessary, not sufficient — probe, don't age-guess.
3. **Fresh path:** `workflow.hitl.note` pauses the run for a **headed,
   operator-attended** login. No script ever types credentials; OAuth gates
   get the stealth args. After login the run resumes at `drive` (startable).
4. **Secrets hygiene:** profiles live under `~/.config` (outside git, outside
   the repo); YAML/vars/logs carry paths and channel names only. `env.allow`
   is minimal (`HOME`).
5. `storageState` JSON is an explicit non-default (loses service workers /
   IndexedDB that OAuth flows notice); if ever needed, export-once from the
   live context, keep it out of git, probe-verify expiry.

## 4. Option B — engine-native `browser.*` action runners (deferred)

Embed a `WorkflowEngineHost` in a kk package and register Playwright action
runners (`browser.launch`, `browser.drive`, guards `auth-cache-valid`) via the
trust-gated `extensions:` block (`allowExtensions` fail-closed), gaining
DB-persisted resumable browser runs (`DbWorkflowPersistenceAdapter`,
atomic `commitTransition`) independent of spur.

**Not recommended now:** adds `@gobing-ai/ts-dual-workflow-engine` as a kk
dependency and re-locates orchestration ownership inside kk (ADR-007/010
boundary; needs an ADR amendment). Switch trigger: browser runs must resume
across machines/processes without spur, or non-`spur` callers need the same
pipeline as a library.

## 5. Shipping checklist

| Item | State |
| --- | --- |
| Skill `plugins/kk/skills/web-automation/` (+ `references/browser-launch.md`) | shipped this commit |
| Design doc (this file) + `docs/04_DESIGN.md` §6 row | shipped this commit |
| Workflow YAML + `auth-fresh-required`/verify guards + drive steps | implementing feature task via `/sp:dev-plan` |
| `superskill install kk` sync of the new skill to target agents | operator-run, on demand |
