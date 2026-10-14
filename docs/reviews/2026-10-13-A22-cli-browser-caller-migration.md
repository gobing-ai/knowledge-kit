# A22 CLI/browser-session caller migration review

Date: 2026-10-13. Task 0278 (R8 — evidence-based caller migration after 0275/0276/0277).

**Outcome: one scoped migration (3 lock invocations + doc sync), everything else retained with a
concrete reason.** No live publish, no real `~/.config/kk` profile touch, no `.github/workflows`
edits. Inventory counts measured at execution time with `rg` (ripgrep 15.1.0), never copied from
planning numbers.

## Measured inventory (Deliverable A)

Roots scanned: `apps/cli`, `apps/board`, `packages`, `plugins/kk/{workflows,scripts,skills,commands}`,
`plugins/publishings`, `docs/design`, and project-local `.spur/workflows/*` (a symlink to
`plugins/kk/workflows`, so the `.spur/workflows/kk-*.yaml` hits are the same committed product
files — no separate ignored operator copies exist in this worktree).

Commands (exact):

```
rg -n --no-heading 'resolveBrowserProfileDir|resolveChannelProfileDir|kkBrowserLauncher|openPersistentBrowser|loginWithProfile|withProfilePage|profile-check' apps/cli apps/board packages plugins/kk/workflows plugins/kk/scripts plugins/kk/skills plugins/kk/commands plugins/publishings docs/design
rg -n --no-heading 'kk stage|kk store lock|kk lock' apps/cli apps/board packages plugins/kk/workflows plugins/kk/scripts plugins/kk/skills plugins/kk/commands plugins/publishings docs/design .spur/workflows
rg -n --no-heading 'kk invoke|kk fanin|kk fanout|executor fanin|executor fanout|kk plugin list|kk plugin doctor|plugins status|plugins list|plugins doctor' apps/cli plugins/kk/workflows plugins/kk/scripts plugins/kk/skills plugins/kk/commands plugins/publishings docs/design
```

Counts:

- **Files scanned:** 4 CLI source dirs + 11 workflow YAML + 6 kk scripts/skills/commands dirs +
  14 publisher plugins + `docs/design` (483 files pass `biome check`; markdown/YAML are not linted).
Each row below is the verbatim output of the command in it, so any count can be re-audited
(`SEAM` below is the `resolveBrowserProfileDir|resolveChannelProfileDir|kkBrowserLauncher|`
`openPersistentBrowser|loginWithProfile|withProfilePage|profile-check` alternation).

| Metric | Command | Measured |
| --- | --- | --- |
| Browser/session seam occurrences, all roots | `rg -n --no-heading "$SEAM" <roots>` | 217 matched lines |
| Same, product source only (no tests, no `dist/`, no build staging) | same + `-g '!**/tests/**' -g '!*.test.ts' -g '!**/dist/**' -g '!apps/cli/plugins/**'` | 148 lines across 38 files |
| Publisher-plugin occurrences (non-test) | `rg -n --no-heading -g '!**/tests/**' "$SEAM" plugins/publishings` | 84 lines across 21 files |
| `profile-check` references in doc/recipe surfaces (`docs/design`, `plugins/kk/{skills,commands,workflows,scripts}`) | `rg -n --no-heading 'profile-check' <surfaces>` | 21 lines across 10 files, 10 of which spell a `profile-check … login\|check` recipe |
| `kk stage <stage>` legacy invocations, committed product workflows | `rg -c 'kk stage ' plugins/kk/workflows/*.yaml` | 65 (kk-daily-ai-voice 31, kk-daily-ai-voice2 21, kk-itc 8, kk-daily-safety 3, kk-collect 2) |
| `kk store lock acquire\|release` invocations | `rg -n 'kk store lock' plugins/kk/workflows .spur/workflows` | 0 remaining — the 3 found (kk-collect.yaml:79,176,187) are **migrated** |

`apps/cli/plugins/` is a gitignored copy of `plugins/` that the CLI build stages for packaging; it
must stay excluded (as above) or every plugin count doubles. Markdown and YAML are not linted by
Biome, so the "483 files" figure covers the TypeScript/JSON surface only.

- **Hidden alias spellings (0275)**: `kk invoke`, `kk fanin`/`kk fanout`, `executor fanin/fanout`,
  `plugin list|doctor`, `plugins status|list|doctor` — no active product *pipeline* uses them. They
  survive as compatibility routes, in historical design docs, and in the two example workflows:
  `judge-gated-publish-example.yaml:21,46` name them in prose while
  `leftover-publish-fanout-example.yaml:26` runs one for real (`kk fanout --in ${vars.contentFile}`)
  — both stay on the retained route by ADR-037 (no alias sunset).

## Supported transports per channel (measured, not assumed)

| Channel | Transport | Browser? | Notes |
| --- | --- | --- | --- |
| wechatmp-pub | browser (console) | yes | `storage-state.json` capture + reinjection required (`src/index.ts:73,108,123,152`) |
| xhs-pub | browser | yes | ADR-025 check/publish visit accounting + 2 h cap (`src/index.ts:234,310-328`) |
| x-pub | post = API v2 (`file-cli`); article = browser | split | `XApiTransport` (`:105`) vs `XArticleBrowserTransport` (`:261`) |
| infoq-pub | browser | yes | WAF 451 → headed-only check (`:223,240,259`) |
| juejin-pub | browser | yes | canonical editor-version query from plugin code (`:186,209,229`) |
| substack-pub | browser | yes | publication-scoped, no fixed `homeUrl` (`:179,201,217`) |
| weibo-pub | browser | yes | (`:270,309,326`) |
| podcast-pub | microfeed API (`file-cli`) | no | `MicrofeedClient` Bearer `/api/v1/` (`src/index.ts`) |
| qiita / medium / emdash / surfdash / zenn | API (`file-cli`) | no | no browser path |
| threads-pub | Threads Graph API (`file-cli`) | no | text-only, no browser path (`src/index.ts:137`) |
| xiaoyuzhou | — | — | **no publisher connector exists**; generic URL login only, never a transport |

## Migration matrix (Deliverable B)

| file:line | current call/transport | category | selected replacement or retained reason | regression evidence | action status |
| --- | --- | --- | --- | --- | --- |
| plugins/kk/workflows/kk-collect.yaml:79 | `kk store lock acquire --name collect …` | replaceable CLI entry | → `kk lock acquire` (canonical top-level; shared registrar + SQLite engines) | `lock.test.ts`, `kk-collect.test.ts` E2E | **migrated** |
| plugins/kk/workflows/kk-collect.yaml:176 | `kk store lock release --name collect …` | replaceable CLI entry | → `kk lock release` | same | **migrated** |
| plugins/kk/workflows/kk-collect.yaml:187 | `kk store lock release --name collect …` (failed-run path) | replaceable CLI entry | → `kk lock release` | same | **migrated** |
| docs/04_DESIGN.md:1518 | kk-collect workflow description (`kk store lock acquire/release`) | — | T3 doc sync to `kk lock acquire/release` | `store-docs.test.ts` (still asserts `store lock` substring, still present) | **migrated (doc sync)** |
| plugins/kk/workflows/kk-daily-ai-voice.yaml:160,185,193,… (31) | `kk stage daily-*` | replaceable CLI entry | retained — behavior-identical via `normalizeStageArgs`; permanent hidden route (ADR-037 "no alias sunset"); ~40 workflow-shape assertions pin the legacy spelling; cosmetic-only churn | `main.test.ts:270`, `commands/stage.test.ts:169` prove both spellings share engine/output/exit | **retained (deferred)** |
| plugins/kk/workflows/kk-daily-ai-voice2.yaml (21) | `kk stage daily-*` | replaceable CLI entry | same as above | same | **retained (deferred)** |
| plugins/kk/workflows/kk-itc.yaml:106,225,… (8) | `kk stage itc-*` | replaceable CLI entry | same as above | `kk-itc-workflow.test.ts`, `itc-stages.test.ts` | **retained (deferred)** |
| plugins/kk/workflows/kk-daily-safety.yaml:49,95,124 | `kk stage daily-safety-*` | replaceable CLI entry | same as above | `kk-daily-ai-voice-workflow.test.ts:405` | **retained (deferred)** |
| plugins/kk/workflows/kk-collect.yaml:62,126 | `kk stage collect-prepare` / `daily-collect-facts` | replaceable CLI entry | same as above | `kk-collect.test.ts` E2E | **retained (deferred)** |
| plugins/publishings/infoq-pub/src/index.ts:223,240,259 | `kkBrowserLauncher` + `resolveChannelProfileDir` + `withProfilePage` (publish) | retained specialized path | in-process publish context; never replace with interactive `kk bot open` subprocess | `infoq-pub.test.ts` | retained |
| plugins/publishings/juejin-pub/src/index.ts:186,209,229 | same | retained specialized path | same | `juejin-pub.test.ts` | retained |
| plugins/publishings/substack-pub/src/index.ts:179,201,217 | same | retained specialized path | same; publication-scoped profile (no fixed homeUrl) | `substack-pub.test.ts` | retained |
| plugins/publishings/weibo-pub/src/index.ts:270,309,326 | same | retained specialized path | same | `weibo-pub` tests | retained |
| plugins/publishings/xhs-pub/src/index.ts:165,315 + profile-check accounting (:234,310-328) | browser publish + check/publish visit cap | retained specialized path | ADR-025 2 h visit cap + accounting; `bot open` is uncapped operator interaction, not a publish helper | `xhs-pub` tests | retained |
| plugins/publishings/x-pub/src/index.ts:268,286,302 | article browser transport | retained specialized path | in-process article composer flow | `x-pub.test.ts` | retained |
| plugins/publishings/wechatmp-pub/src/index.ts:108,152,271 | `openPersistentBrowser` + `storage-state.json` + `WECHATMP_PROFILE_DIR` env override | retained specialized path | special state capture/reinjection + custom env profile location; never migrate to fixed bot path without explicit equivalence | `wechatmp-pub.test.ts`, `wechatmp-default-launcher.test.ts` | retained |
| plugins/publishings/podcast-pub/src/index.ts (MicrofeedClient) | microfeed API | retained specialized path | API transport, no browser session | `podcast-pub` tests | retained |
| plugins/publishings/x-pub/src/index.ts:105 (XApiTransport) | X API v2 post | retained specialized path | API transport, no browser session | `x-pub.test.ts` | retained |
| qiita/medium/emdash/surfdash/threads/zenn `index.ts` | API/file-cli transports | retained specialized path | API transports; no browser session to migrate | respective plugin tests | retained |
| plugins/publishings/*/src/profile-check.ts + `plugin.json` `check` | `login|check|open` channel CLI | retained specialized path | channel readiness + special state (WeChat storage-state, XHS accounting); `plugin login` stays plugin-name semantics; bot adapters delegate through this seam | `wechatmp-profile-check.test.ts`, `substack-pub.test.ts:692`, `x-pub` profile tests | retained |
| apps/cli/src/bot-adapter.ts, commands/bot.ts, packages/publish-harness/src/browser.ts | new bot lifecycle + descriptor seam | — | consumed upstream 0276/0277 contracts; not migration targets | `bot-adapter.test.ts`, `browser.test.ts` | consumed (not a candidate) |
| docs/design/* (kk-collect-and-daily-voice2.md:66,188,192; kk-cli-surface.md; kk-noun-verb-bots.md), docs/00_ADR.md ADR-037/038 | historical design/ADR/verdict evidence | — | EVIDENCE, not recipes — retained unchanged per hard rule | — | retained (evidence) |

## Verification (Deliverable C)

- `spur workflow validate plugins/kk/workflows/kk-collect.yaml --json` → `{"ok":true,"valid":true}`.
- `spur workflow show plugins/kk/workflows/kk-collect.yaml` → renders `kk lock release` in the
  `release`/`release-failed` states.
- `bun test apps/cli/tests/commands/lock.test.ts apps/cli/tests/store-docs.test.ts` → 13 pass / 0 fail.
- `bun test apps/cli/tests/kk-collect.test.ts` → 6 pass / 0 fail (E2E runs the migrated workflow
  through the real `kk` source shim; lock acquire/release/skipped all exercised).
- `bun run lint` → exit 0 (biome 483 files clean; typecheck all workspaces clean).
- `bun run build` → exit 0.
- `spur rule run --preset recommended-pre-check --fail-on warning --no-logo` → 59 rules pass.

## Report-only vs migration decision

Only the 3 `kk store lock` → `kk lock` workflow invocations were migrated (behavior-equivalent,
proven by the shared registrar + the kk-collect E2E). The 65 `kk stage <stage>` workflow
invocations are behavior-equivalent through `normalizeStageArgs` but were **retained (deferred)**:
the legacy spelling is a permanent hidden compatibility route with no sunset (ADR-037), and ~40
workflow-shape test assertions across `kk-daily-ai-voice-workflow.test.ts`, `voice2-dag.test.ts`
and `kk-itc-workflow.test.ts` pin the legacy spelling — rewriting them is cosmetic-only churn with
zero behavior change. Every publisher browser/API path is a retained specialized path per the hard
rules (never replace an in-process publish context with `bot open`; keep API transports, WeChat
storage-state, XHS accounting, and custom profile env overrides).
