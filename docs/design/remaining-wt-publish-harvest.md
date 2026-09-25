# Remaining wt-publish harvest

Feature **E7** (**shipped**; tasks 0141–0147). Harvest the leftover wt publish
channels as `kind: publish` plugins on `@gobing-ai/publish-harness`, with a shared
browser/session layer and a transport policy that prefers official APIs.

> Chosen approach: extend the E2 harness (harvest `@wt/web-automation`, add
> `FakeBrowserTransport` and a `browser` driver). API/CLI channels stay `file-cli`.
> Agent-driven browser is the compatible default when there is no official API;
> Playwright is an optional fast path. No third transport kind. One `x-pub` plugin
> with `post` and `article` operations.

Authority: [publish-plugin-specification.md](publish-plugin-specification.md) §2,
ADR-008 (amdt 2026-09-17). Feature: E7.

---

## 1. Decisions

| ID | Choice | Rejected | Why |
|----|--------|----------|-----|
| D1 | Extend `@gobing-ai/publish-harness` with session helpers + `FakeBrowserTransport` | New `packages/publish-browser`; leave helpers inside each plugin | One seam already exists (E2). A second package fails the deletion test until a non-publish caller appears |
| D2 | `PublishTransport.kind` stays `'file-cli' \| 'browser'`. Browser transports declare `driver: 'script' \| 'agent'` | Third kind `agent`; keep browser deferred | ADR-008 classifies by execution mechanism. Agent vs script is who drives the same browser, not a new mechanism |
| D3 | Plugin process never embeds an LLM. `driver: 'agent'` means the plugin owns mapping, persistent session, and Result; a `plugins/kk` skill (workflow `agent.run`) drives the page | Spawn `spur agent run` from the plugin; hollow plugin that only wraps a skill | ADR-007: `kk` owns steps, `spur workflow` owns orchestration. Plugins stay deterministic spawnables |
| D4 | Transport policy is per-channel evidence, not a global default | Clone every wt Playwright script; agent-only for all leftover channels | Official APIs exist for Medium, WeChat drafts, X posts. CMS editors drift; agent is the compatible default there |
| D5 | One plugin `x-pub` with operations `post` and `article` | Two plugins; keep the wt name `publish-to-x` | Same target/auth/Result. `podcast-pub` already uses `operations`. X Automation Rules (Apr 2026) forbid non-API posting |
| D6 | `wechatmp-pub` operation `draft` via official `draft/add` (`file-cli`); console/browser only when the account cannot API-publish | Playwright-only WeChat; live `freepublish/submit` as the default | Draft API is documented 2026-09-16. Live publish is certification-gated; default is draft |
| D7 | Harvest `~/projects/cc-agents/plugins/wt/scripts/web-automation` (`@wt/web-automation`) into the harness | Rewrite session/profile/selector helpers from scratch; keep a wt dependency | Shared TypeScript already exists; wt config.jsonc is not imported (secrets stay env-only) |
| D8 | Default Result is draft / unpublished. Live publish requires operator HITL | Auto-publish to match wt `--submit` | Fail-loud + reversible. Matches emdash-pub D7 |
| D9 | Secrets env-only. Browser profile dir defaults to `~/.config/kk/browser-profiles/<channel>` | `~/.claude/wt/config.jsonc` tokens | Spec §2.4; kk config root is `~/.config/kk` |
| D10 | `kk fanout` for `file-cli` and `driver: 'script'`. Agent-default channels fan out as sequential workflow `agent.run` steps | `kk fanout` spawning LLMs; a new `kk` noun | Fan-out sequencing is kk's job for deterministic plugins (ADR-007 R4). Agent loops are workflow steps |
| D11 | Dated ADR-008 amendment, not a new ADR | ADR-021 "agent transport"; silent divergence | Drivers refine the existing kind split; they do not reverse it |
| D12 | Thin per-channel (or one coordinator) kk skills for login/preview/confirm | Fat skills that reimplement transport | K pattern: engine in the plugin, skill is the operator surface |
| D13 | Build order: harness → `medium-pub` → `wechatmp-pub` draft → `x-pub` post → `x-pub` article → leftover CMS (`juejin`, `substack`, `infoq`, `xhs`) | One-plugin-per-PR with no foundation; browser channels before API | Foundation first is the wt-gap this feature exists to close |
| D14 | `technical-content-creation` is out of E7 | Generator plugin under `plugins/generations` | F2/F3 already harvested stages 1–4 as skills. Follow-on F41 under F4 |

### Per-channel policy

| Plugin | Default transport | Driver | Evidence |
| ------ | ----------------- | ------ | -------- |
| `medium-pub` | `file-cli` | — | Medium integration-token REST (wt already API; official docs archived but tokens still post) |
| `wechatmp-pub` `draft` | `file-cli` | — | Official `POST /cgi-bin/draft/add` (2026-09-16) |
| `wechatmp-pub` live/console | `browser` | `agent` (script optional) | `freepublish/submit` is certification-gated |
| `x-pub` `post` | `file-cli` | — | Official `POST /2/tweets`. Non-API automation is suspendable |
| `x-pub` `article` | `browser` | `agent` (script optional) | No public Articles API found 2026-09-17 |
| `juejin-pub` | `browser` | `agent` (script optional) | No official public write API |
| `substack-pub` | `browser` | `agent` (script optional) | No official public write API |
| `infoq-pub` | `browser` | `agent` (script optional) | No official public write API |
| `xhs-pub` | `browser` | `agent` (script optional) | No official public write API |

Already harvested, **not** in E7: `qiita-pub`, `zenn-pub`, `surfdash-pub`.

---

## 2. Module layout

```
packages/publish-harness/
  src/index.ts                 # PublishTransport + driver field
  src/fake-file-cli.ts         # existing FakeFileCliTransport
  src/fake-browser.ts          # NEW FakeBrowserTransport
  src/browser-session.ts       # NEW persistent profile, launch, trySelectors
                               # harvested from @wt/web-automation (playwright, selectors, clipboard)

plugins/publishings/medium-pub/
plugins/publishings/wechatmp-pub/
plugins/publishings/x-pub/
plugins/publishings/juejin-pub/
plugins/publishings/substack-pub/
plugins/publishings/infoq-pub/
plugins/publishings/xhs-pub/
  plugin.json                  # kind: publish; operations where needed
  src/index.ts                 # --in/--out, mapper, transport
  tests/*.test.ts              # FakeFileCliTransport or FakeBrowserTransport

plugins/kk/skills/publish/     # thin operator surface (name frozen at implement)
  SKILL.md                     # login / preview / confirm; shells kk executor run or agent.run
```

No new `kk` first-layer noun. No change to `kindContract('publish')`.

---

## 3. Interfaces

```ts
export type BrowserDriver = 'script' | 'agent';

export interface PublishTransport {
    kind: 'file-cli' | 'browser';
    /** Required when kind is `browser`. Omitted for `file-cli`. */
    driver?: BrowserDriver;
    publish(payload: PublishTransportPayload): Promise<Result>;
}

export interface BrowserSessionOptions {
    profileDir: string;
    headless?: boolean;
    loginTimeoutMs?: number;
}

export class FakeBrowserTransport implements PublishTransport {
    readonly kind = 'browser';
    readonly driver: BrowserDriver;
    setNextResult(result: Result): void;
    getCallLogs(): readonly FakeCallLogEntry[];
    reset(): void;
}

export function resolveBrowserProfileDir(channel: string, override?: string): string;
export function launchPersistentBrowser(opts: BrowserSessionOptions): Promise<unknown>;
```

`x-pub` `plugin.json` operations (names frozen):

```json
{
  "name": "x-pub",
  "kind": "publish",
  "entry": "./src/index.ts",
  "operations": {
    "post": { "input": "content", "output": "result" },
    "article": { "input": "content", "output": "result" }
  }
}
```

`wechatmp-pub` operations: `draft` (default, `file-cli`), plus any console operation the account type requires.

### Env (04 owns the names)

| Plugin | Required env | Optional env |
| ------ | ------------ | ------------ |
| `medium-pub` | `MEDIUM_INTEGRATION_TOKEN` | `MEDIUM_PUBLISH_STATUS` (`draft` default) |
| `wechatmp-pub` | `WECHAT_APP_ID`, `WECHAT_APP_SECRET` | `WECHAT_PROFILE_DIR` |
| `x-pub` `post` | `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` | — |
| `x-pub` `article` / CMS browser | — | `KK_BROWSER_PROFILE_DIR` or per-channel `*_PROFILE_DIR` |

Missing required env → exit 1, `Result.ok false`, error names the variable, secret values never appear in Result or `plugin.json`.

---

## 4. Invariants

1. No third `PublishTransport` kind.
2. Plugin processes do not call an LLM.
3. Default publish state is draft; live publish is HITL.
4. Offline tests use harness fakes; CI does not hit publisher sites.
5. Qiita / Zenn / Surfdash plugins are not modified by E7.
6. `technical-content-creation` is not a generator plugin in this feature.

---

## 5. Rejected alternatives

- **1:1 wt skill clone** — wrong kind for TCC; re-harvests Qiita; no shared foundation.
- **Super-publisher skill only** — cannot `kk executor run` / deterministic fan-out.
- **Two X plugins** — same target; operations already exist on publish manifests.
- **Embed Playwright MCP inside `kk fanout`** — mixes orchestration into the executor.

---

## 6. Build sequence (task grain)

1. Harness: driver field, `FakeBrowserTransport`, harvested session helpers, spec + ADR amendment (this satellite).
2. `medium-pub` (`file-cli`) — proves API harvest on the existing fake.
3. `wechatmp-pub` `draft` (`file-cli`).
4. `x-pub` `post` (`file-cli`) — ToS-safe tweets.
5. `x-pub` `article` (`browser` / `agent`) — first agent-driver channel.
6. Leftover CMS: `juejin-pub`, `substack-pub`, `infoq-pub`, `xhs-pub`.
7. Thin kk operator skill(s) + docs `05` status at wrap.
