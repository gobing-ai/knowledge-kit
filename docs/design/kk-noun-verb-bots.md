---
name: Strict kk noun-verb CLI and named browser bots
kind: design
status: shipped
feature_id: A22
created_at: 2026-10-13
updated_at: 2026-11-04
---

# Strict CLI operations and named browser sessions

This is the design for A22, shipped by tasks 0275–0278 (surface: `docs/04_DESIGN.md` §1.8/§1.12). ADR-037/038 own the decisions.
**Shipped so far:** task 0275 landed ADR-037's two normalization seams — canonical `kk stage run`
(with `kk stage <stage>` normalized in `main()` before Commander parses) and the top-level
`kk lock acquire|release` (with `kk store lock …` retained as a hidden route over the same
registrar/engines). Task 0276 landed the generic bot lifecycle: `kk bot list|login|logout|open`
over the fixed profile root, the shared per-profile lease with parent/child-scoped delegation, the
staged login/save transaction with atomic promotion and crash-safe journal, idempotent
containment-checked logout, and the packaging closure (the harness declares the playwright catalog
dependency; the CLI build passes `--external playwright`; installed help/list/status need no
browser binaries). Channel descriptor integration and site-verified evidence remain unshipped
(task 0277), as does the caller/recipe migration review (task 0278). The review reads the
registered source tree, its flags, hidden aliases, action handlers, callers and session
implementations; root help alone is insufficient.

## Canonical command inventory

| Noun | Verbs | Disposition |
| --- | --- | --- |
| board | serve, capture | Keep |
| daily | prepare, publish-classify, run-report | Keep; compound verbs still occupy one command word |
| executor | run, fan-in, fan-out | Keep; plugin names are data arguments |
| ledger | append, sync, cutover-check | Keep |
| plugin | status, check, login | Keep; plugin identity differs from profile identity |
| schedule | render | Keep; installed schedules remain operator-owned |
| stage | run | Add canonical verb; the stage name is data, not another Commander command |
| store | migrate, ingest, backfill-facts, label, extract, pool-count, select, mark-published, release | Keep; store release releases selections, not a lock |
| lock | acquire, release | Lift from store lock; preserve SQLite ownership and --db behavior |
| bot | list, login, logout, open | New local-session operations |

A visible root group is a noun, never an executable default; stage compatibility is argv normalization in main rather than a default action on the visible group. No third-level product commands. `help [command]`, --help, --version and --verbose are framework/global facilities. The program currently has 27 visible executable leaves: 24 conform and 3 require normalization. The final visible tree will have 31 leaves. Do not introduce item, selection, session, auth, browser or workflow command groups merely for symmetry. Spur owns workflow execution.

## Compatibility map

| Shipped path | Canonical destination | Required behavior |
| --- | --- | --- |
| stage <stage> [args...] | stage run <stage> [args...] | Preserve variadic order, unknown-option pass-through and child exit status |
| store lock acquire/release | lock acquire/release | Same action, defaults, JSON and database side effects |
| invoke | executor run | Retain current hidden alias |
| fanin/fanout | executor fan-in/fan-out | Retain current hidden aliases |
| executor fanin/fanout | executor fan-in/fan-out | Retain accepted spellings; hide compatibility names in help |
| plugin list/doctor | plugin status | Retain current hidden aliases |
| plugins status/list/doctor | plugin status | Retain current hidden group and routes |
| plugin login <plugin-name> | unchanged | Remains a plugin operation, not an alias to URL-based bot login |

The current stage dispatcher has no identifier `run`; reserve it as canonical syntax. Normalize valid legacy stage identifiers in main before Commander parsing, inserting the new verb while preserving globals, separators and original data/unknown-option order. `stage run` with no stage is a canonical usage error; `stage run --help` is canonical help. No compatibility branch for a hypothetical future stage is needed. Enumerate current identifiers and test both main parsing routes. Reuse the same handler/registrar rather than launching another kk process. Compatibility routes never print deprecation text into stdout/stderr.

## Bot command contract

- `kk bot list`: enumerate direct non-symlink profile directories under the fixed default root. Include legacy directories without metadata, marked cached/unknown rather than authenticated. Missing root yields an empty success. Do not inspect cookie databases or launch a browser.
- `kk bot login <url> --save <bot-name>`: validate URL/name before filesystem or browser effects; launch headed, navigate explicitly to the supplied URL, wait for site-specific evidence when a descriptor matches, otherwise require explicit terminal confirmation. Noninteractive unknown-site login fails with guidance. Cancellation and timeout are failures, never saved success.
- `kk bot logout <bot-name>`: delete only the inactive contained bot directory and all auxiliary auth artifacts. Missing name is usage failure; missing directory is idempotent success. Never kill browsers, follow symlinks, erase siblings, or claim server revocation.
- `kk bot open <bot-name> [--login]`: reuse saved default URL and profile headed; stay available until the browser context closes. --login completes the same login/save transaction and then reopens the saved page for interaction; the upstream login helper alone would close immediately after verification. Plain open never treats a redirect or successful navigation as proof of authentication. A cached session may be expired; the operator can use --login. Missing profile fails without creating one.

Names match `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`. Refuse separators, dot segments, absolute names, symlink entries and any resolved escape. URLs accept http/https only, reject embedded username/password and strip fragments from saved metadata. Generic sessions store only origin+pathname as the default page: never persist supplied query parameters or fragments, which can contain grants/tokens. Known adapters save their plugin-owned canonical home/editor URL; a fixed non-secret navigation query such as Juejin v=2 comes from plugin code, never the supplied/auth redirect URL. The supplied URL, including query if present, is navigation input only and is not logged. Generic success records the original input origin+pathname; known success records the plugin-owned canonical page. Never record an OAuth callback URL. A unique fixed plugin home page may be used for legacy profiles; publication-scoped legacy profiles need login URL guidance.

Use owner-only directories (0700) and metadata/state files (0600); never print state values, page bodies, grant-bearing URLs or cookie contents. Minimal metadata `bot.json`: schemaVersion=1, defaultUrl, optional pluginName, authenticationEvidence=`site-verified|operator-confirmed`, and (A23, still schemaVersion 1) optional lastLoginAt, expiresAt and identity. Metadata records historical evidence, not current readiness. Re-login updates it atomically after successful persistence. Existing profiles without metadata are listed; open resolves a uniquely declared channel default or explains `bot login URL --save NAME`. Corrupt metadata fails actionable, without replacing/deleting the profile.

Login works on an isolated transaction staging profile at ~/.config/kk/browser-transactions/<name>-<uuid>/stage while holding the logical bot lease: start clean for a new bot; for an existing inactive profile copy its contents without Chromium singleton artifacts. Close the browser and flush special state before promotion. Replace via same-filesystem rename with rollback; keep old saved artifacts intact until promotion succeeds. Transaction journal phases prepared/old-moved/new-moved and backup paths survive a crash; unresolved rollback blocks later mutation and preserves recovery evidence. Refuse copied symlinks rather than follow them. Delete only staging owned by this invocation on failure. Test copy, close, rename and rollback failures; never replace an active profile. This adds no new backup/export product feature.

## Shared ownership and boundaries

CLI registration/arguments/output live in apps/cli. Browser lifecycle and containment live under the existing publish-harness browser subpath; ts-browser-automation owns its current launcher interface. Add the CLI publish-harness workspace dependency, declare the existing Playwright catalog as a CLI runtime dependency and pass --external playwright in its build. Add the existing ts-runtime catalog dependency to the harness for ordinary filesystem IO; isolate only unsupported low-level primitives in bot-fs.ts with a narrowly justified rule exception. Keep browser loading lazy so --help, bot list, plugin status and API-only execution need no installed browser. Do not add a package or runtime dependency for a few filesystem checks.

Use a shared per-profile exclusive lease at ~/.config/kk/browser-leases/<sha256(canonical logical path)> for all kkBrowserLauncher sessions and bot mutations. Freeze parent/child scoped delegation and holder cleanup per task 0276; a child never deletes its parent lease. Owned contexts/children stop before release. Invalid/stale ownership is refused with recovery guidance, never silently removed. Operations on a logical bot acquire the same lease even while its browser uses a staging path; avoid double acquisition by threading ownership internally. Chromium's native singleton lock remains a second refusal signal. Logout refuses existing Chromium singleton ownership even when the lease is free; never delete a foreign/stale lock as a shortcut. Containment checks include root and final entry; test preexisting symlinks and concurrent acquisition. Lease keys derive from canonical root+profile identity. Publishers that bypass kkBrowserLauncher are classified during review and brought through the shared seam only where semantics are preserved.

Current bot commands target the fixed default root; do not let ambient KK_BROWSER_PROFILE_DIR or channel env overrides redirect list/logout. Existing channel resolver precedence stays unchanged for plugin commands. Named bot adapter calls pass an explicit profile path, overriding env. This preserves external legacy profile locations without accidentally deleting them.

## Plugin integration

Extend the existing optional manifest check-script seam with an optional `browserSession` descriptor `{profileName, homeUrl?}`. It requires `check`, uses the safe-name/HTTP URL rules and is validated during discovery. It is session metadata on a publish plugin, never a new plugin kind. Resolved records expose it without importing channel code into the CLI. Selection is saved pluginName, then unique declared profileName equal to bot name, then unique literal homeUrl origin. Ambiguity or a missing saved adapter refuses rather than silently falling back. Substack omits homeUrl because its publication is configured; its named/saved adapter derives publication origin from bot URL and validates it through the existing resolver. A custom-name custom-domain Substack bot stays generic unless already bound. A metadata-free Substack profile needs login URL guidance; never invent a default publication. An arbitrary bot name remains supported; save pluginName in its metadata when a known adapter is used.

For opted-in browser plugins extend the check script with `open --profile <dir> --url <url>` and login's optional --url. Existing login/check argv and verdicts remain compatible. The CLI uses argv-array subprocess invocation through the existing check runner, not shell interpolation. Session commands inherit stdio and scoped KK_BOT_LEASE_PATH/KK_BOT_LEASE_TOKEN values from the parent; validate delegated ownership in the shared launcher and propagate real child status. Tokens are private transport, not public configuration. URL login exit 0 requires observed site readiness, persisted special state and successful context closure. Both commands must navigate to the supplied URL, restore special state first and preserve plugin-owned readiness. Unknown custom browser plugins without descriptors use the generic operator-confirmed path, not invented selectors.

Start with the seven existing check-enabled browser channels: WeChat MP, XHS, X, InfoQ, Juejin, Substack and Weibo. Reuse their readiness routines. Preserve XHS check/publish accounting; new open is uncapped operator interaction like existing login, and does not fabricate a check or publish visit. WeChat MP must preserve storage-state.json capture after settling and reinjection on reopen. A generic persistent profile alone is insufficient there. The current podcast-pub uses MicrofeedClient with API credentials; X post uses API while X article uses the browser. There is no Xiaoyuzhou browser publisher in the current tree. Generic Xiaoyuzhou URL login is supported, but this feature does not add a publisher connector or convert API transports. Unsupported integration remains documented rather than pretending all cached sessions are interchangeable.

`plugin status` remains static. `plugin check` remains the current read-only readiness protocol. `plugin login` retains plugin-name semantics; bot adapters and plugin login share the channel routine. Never make plugin login a bare syntactic alias to a different signature.

## Rendered collection substrate — 2026-11-09 (0346, ADR-038 amendment)

The bot command inventory is unchanged: still exactly `list | login | logout | open | exec`, with the same flags, output and exit mapping. Rendered acquisition is a **library**, not a verb, because the scheduled caller is an ingestion plugin child and the operator's hand-driving surface is a repository script.

- **Descriptor widening.** `browserSession {profileName, homeUrl?}` is now legal on `kind: ingestion` as well as `publish`, and `check` stays mandatory — a session with no probe has no owner for login/check/open. Adapter selection is untouched and kind-agnostic (saved pluginName → unique profileName → unique homeUrl origin; ambiguity refuses), so no production adapter, fan-in or invoke edit was needed for an ingestion descriptor to bind.
- **Runner.** `runBotCollection(profileName, plan, options?)` from `@gobing-ai/publish-harness/bot-collection` executes one JSON-serializable ordered plan (`request | navigate | wait | click | scroll | extract`) plus declarative response captures in a single headless persistent context, under one profile lease and one launch. Steps, artifact kinds, defaults/caps, validation ordering, failure codes (`authentication | empty | browser` + `stepIndex`/`stepId`), redaction rules and the probe script are specified in `docs/04_DESIGN.md` §1.13.
- **Ownership.** The plugin owns selectors, pagination, politeness and `Doc[]` mapping; the harness owns execution, capture, classification and cleanup. A collection child acquires the profile lease itself, so fan-in gained no lease coordination and concurrent same-profile callers still fail `busy`. `browser.ts` does not import the collection module (one-way dependency).
- **Contract stability.** `execBot`, `BotExecRequest`/`BotExecResponse`, the five verbs and their flag/output/exit tests are untouched; the runner lives in a sibling module and only consumes exported helpers (`validateExecUrl`, `execFailureDetail`, `closeBotContext`, `missingBotProfile`, `openBotPage`).
- **Documented limits.** No cookie/storage export or import, no HAR replay or response cache, no warm browser pool or daemon, no declarative recipe engine, no generic crawling or retry/politeness policy, no anti-bot/robots bypass, no binary/media payloads, no adapter special-state emulation. Verification is loopback-only (`apps/cli/tests/e2e-bot-collection.ts`); nothing here certifies xhs, Taobao, goofish or any live anti-automation behavior.

## Post-implementation caller review

The dependent review covers CLI registration/tests, package exports/dependency closure, bundled plugin scripts, workflow YAML, stage scripts, all publisher launch sites, operator docs and agent skills/commands. Record a file-level matrix: replaceable CLI entry, shared-helper reuse, or retained specialized path with reason. Migrate compatible operator recipes and workflow stage/lock spellings; never replace a long-lived in-process publish context with an interactive bot open subprocess. Keep all aliases and no automatic publishing side effects. Capability content changes use Superskill validation; workflow/corpus changes use Spur. No edits to .github/workflows are authorized.

## Verification and rollout

Each implementation task includes its own behavior tests. CLI normalization tests compare parsed arguments, stdout/stderr, exit status and store effects across canonical/legacy routes; recursive command-tree tests prohibit future shape drift while explicitly allowlisting hidden legacy routes. Bot tests use isolated temporary profile roots and fake launchers, including legacy/corrupt metadata, auth cancellation, unsafe names/URLs, busy profiles, interruptions, failed persistence and deletion containment. Channel tests preserve WeChat special state and XHS visit guards; package-smoke tests run outside the checkout with no browser needed for help/list/status. A small local HTTP test site demonstrates login-save-close-open reuse and local logout without touching real accounts.

Run bun run lint, bun run test, bun run build and affected Spur constraints for implementation completion. Live site dogfood is operator-driven and separate from offline test evidence. Never certify live login from mocks. Session-state limitations follow site behavior; sessionStorage is not automatically persisted by Playwright storageState. No promise to cache every conceivable credential mechanism.

Planning completes at task handoff. Four deliverables: canonical CLI/aliases, generic bot lifecycle, channel integration, then caller review and safe migration. Each task carries source premises and AC; the last depends on the first three. Feature/task checks validate planning now; production tests run during implementation.

## Sources

Verified 2026-10-13: apps/cli/src/cli.ts; apps/cli/src/commands/{stage,store,plugin,executor}.ts; apps/cli/src/invoke.ts; packages/publish-harness/src/{browser,profile-dir,index}.ts; plugins/publishings/wechatmp-pub/src/index.ts; plugins/publishings/xhs-pub/src/profile-check.ts; packages/kk-core/src/{manifest,registry}.ts.

[Playwright authentication](https://playwright.dev/docs/auth) documents saving state after an observed login and the sessionStorage limitation. [Persistent contexts](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context) documents persistent profiles and exclusive user-data-directory use. These are primary references; the installed Playwright version remains pinned at 1.55.0, so implementation checks its local types before using any newer documented API.


## Ready-depth refinement — 2026-10-13

Tasks 0275–0278 freeze the implementation entry points, file ownership, parser/transaction/lease algorithms, subprocess protocol, error/output contract and test layers. Feature R9 isolates generic session save/open acceptance; R4/R6 remain owned by channel integration, so task 0276 is independently verifiable. Feature R1–R8 titles remain unchanged. Task AC now use Gherkin with requirement bindings, rather than unchecked title-only claims.

The shared lease supports cooperating KK launchers plus Chromium native singleton refusal; it does not claim control over arbitrary same-user software. Incomplete transaction/ownership recovery is refused conservatively. Normal filesystem operations use ts-runtime; missing no-follow/exclusive-create/permission/binary-copy primitives belong in the exact private bot-fs adapter. No global boundary exemption or new product flags.

Another worktree contains earlier channel work. Current source must be re-read at implementation start, especially WeChat session handling; unrelated probe files and historical task/ADR evidence are not migration targets. Each task includes a dated correction record, closed decisions, dependency handoff, observable tests and baseline limitations.

Generic in-process bot operations borrow their already-held logical lease through an optional ownership argument to createKkBrowserLauncher; they do not reacquire it. Existing loader-only callers keep their interface. The parent closes the borrowed context before releasing ownership; subprocess adapters use scoped delegation instead. Both paths share the browser-launch implementation.
