# kk plugin check / login — live channel readiness probe

> Feature **E93** · Decision **ADR-032** (amends ADR-011 R3) · Tasks **0215** (verbs + manifest), **0216** (six channels)
> Status: shipped — verbs + manifest (0215), all six browser channels on the contract (0216)

## Problem

`kk plugin status` answers "is this plugin installed and loadable?". It does not answer "can this channel publish right
now?". For browser channels that means a signed-in profile that survives a headless reopen. Today the only way to find out
is to run each plugin's `src/profile-check.ts` by path.

## Surface

```text
kk plugin check [<name>…] [--kind <kind>] [--json] [--headed] [--timeout <ms>]
kk plugin login <name>
```

| Verdict       | Probe outcome                                                        | Fails the run |
| ------------- | -------------------------------------------------------------------- | ------------- |
| `verified`    | exit 0 and a final JSON line with `status: "verified"`               | no            |
| `refused`     | exit 1 (signed out, profile missing, login wall)                     | yes           |
| `error`       | exit 2, another code, crash, timeout, or no/malformed final JSON line | yes           |
| `unsupported` | the manifest has no `check` field                                    | no            |

`--json` output: `{ ok, plugins: [{ name, kind, status, profileDir?, detail }] }`. `login` runs with inherited stdio
and exits with the probe's code. A plugin without `check` is a usage error.

`status` is unchanged: no probe is spawned (ADR-032 R2). It only lists `check` when present.

## Manifest field

```json
{ "name": "x-pub", "kind": "publish", "entry": "./src/index.ts", "check": "./src/profile-check.ts" }
```

The field is optional and holds a path relative to the plugin dir. It is validated by `PluginManifestSchema`
(`packages/kk-core/src/manifest.ts:20`) and resolved to an absolute path on `PluginRecord`
(`packages/kk-core/src/registry.ts:12`).

## Probe contract (ADR-032 R4)

```text
<check> check [--headed] [--timeout <ms>]
<check> login
```

Shipped in 0215 as above: `check` forwards the operator's `--headed`/`--timeout` only; `login` takes no flags and
inherits stdio. (Planned-stage prose listed `--profile`; the shipped contract keeps profile discovery inside the
probe — kk never chooses the profile dir.)

- Exit codes: 0 means verified, 1 means refused, 2 means error.
- The last non-empty stdout line is `{ "status": "...", "profileDir"?: "...", "detail": "..." }`.
- kk spawns the probe with `process.execPath` and the same operator-config env as `kk executor run`
  (`pluginEntryCmd` / `pluginEntryEnv`, `apps/cli/src/invoke.ts:115-122`). Channel settings such as
  `SUBSTACK_PUBLICATION_URL` therefore reach the probe without new flags.
- `runProfileCli` (`packages/publish-harness/src/browser.ts:238`) implements this contract, including the
  0216 `--headed` flag. 0216 moved xhs-pub and wechatmp-pub onto it (previously bespoke scripts), gave all
  six channels a manifest `check` entry, and set `checkHeadedOnly: true` for x-pub (X login-walls headless
  article loads, so the headless pass is dead weight that blew kk's 30s probe-kill).

## Safety (ADR-032 R5)

- `check` never clicks a control and never creates a profile, because a headless launch refuses a missing profile
  (`ensureProfileDir`, 0214).
- kk echoes only `status`, `profileDir` and `detail`. Raw probe stdout and stderr, cookies and tokens are never printed.
  A malformed final line becomes `error` with the exit code, not the line text.
- Headless is the default; `--headed` is opt-in. Probes run sequentially because browser profiles are single-writer.

## Out of scope

- Credential probes for API channels. They can opt in later with the same field.
- A workflow preflight that gates on `check --json`.
- Channel selector drift, which belongs to 0193/0194.

## Verification

- 0215: an E2E run over fixture plugins (verified, refused, error and unsupported probes) writes
  `.spur/run/e2e/E93-plugin-check.json`.
- 0216: a live `kk plugin check --kind publish --json` run against the operator profiles recorded
  `.spur/run/e2e/E93-plugin-check-live.json`: infoq/juejin/wechatmp/x `verified`, xhs `refused` by the 2h
  automation budget (with the operator hint), substack `error` (exit 2 — `SUBSTACK_PUBLICATION_URL` unset),
  non-browser channels `unsupported`. No secrets in the artifact.
