# Browser publish channels on ts-browser-automation

> Feature **E91** (child of E9) · ADR-027 · **shipped** (0183–0188) · supersedes the `agent`-driver default for `infoq-pub`, `juejin-pub`,
> `substack-pub`, and `x-pub` `article` in `remaining-wt-publish-harvest.md` §1 (D13 / per-channel
> policy). Pattern source: `xhs-pub` (0177, ADR-024) and `wechatmp-pub` (ADR-026).

The four browser channels replaced their always-failing `agent`-driver stubs: before this feature
`sessionReady` was never true in production, so every real run returned `login timeout`. They are
now script-driven Playwright flows over `@gobing-ai/ts-browser-automation`, and the plumbing
`xhs-pub` and `wechatmp-pub` each re-implemented is extracted into one browser module in
`@gobing-ai/publish-harness`.

## 1. Per-channel verdict

| Plugin | Transport | Verdict | Reason |
| --- | --- | --- | --- |
| `infoq-pub` | browser · `script` | **Implement** | No public write API; ProseMirror editor at `xie.infoq.cn/write` |
| `juejin-pub` | browser · `script` | **Implement** | No public write API; bytemd editor (CodeMirror, markdown) |
| `substack-pub` | browser · `script` | **Implement** | No public write API; ProseMirror editor, HTML paste |
| `x-pub` `article` | browser · `script` | **Implement** | No Articles API; `x.com/compose/articles`, HTML paste + cover `setInputFiles` |
| `x-pub` `post` | file-cli (API v2, OAuth1) | Keep | Official, deterministic, headless; browser posting invites anti-bot flags |
| `medium-pub` | file-cli (REST, integration token) | Keep | Works for existing token holders; browser path fights Cloudflare. Browser fallback **deferred** until the token path stops accepting posts |
| `qiita-pub` | file-cli (API v2) | Keep | Official API; browser strictly worse |
| `zenn-pub` | file-cli (zenn-cli + git sync) | Keep | Git sync is Zenn's official publishing model |
| `xhs-pub` | browser · `script` | Migrate plumbing | Already on the package; profile resolution, `waitUntil`, and the session check move to the shared module; its guard-wrapped `main()` stays |
| `wechatmp-pub` | browser · `script` | Migrate plumbing (poll only) | Only its poll loops move to `waitUntil`. Login/check stay bespoke (storageState capture + cookie re-injection), profile resolution has no `KK_BROWSER_PROFILE_DIR` tier, body insertion stays innerHTML |

Checked and not browser-relevant: `emdash-pub`, `podcast-pub` (REST), `surfdash-pub` (CLI), all
ingestion and generator plugins.

## 2. Decisions

| # | Decision | Rejected | Why |
| --- | --- | --- | --- |
| E91-D1 | Browser channels default to `driver: 'script'`; `agent` fails fast (`unsupported driver`) as in `xhs-pub` | Keep `agent` default | The `agent` path never had an executor; it is why the channels are stubs |
| E91-D2 | Shared helpers live in `@gobing-ai/publish-harness` under a `./browser` sub-path export | New package; upstream into ts-libs now | Harvest D1 already chose publish-harness; a sub-path keeps API-only plugins from loading browser code. Promote upstream once stable |
| E91-D3 | Site selectors and flows stay in each plugin | Selector registry in the shared module | E9 boundary; selectors drift per site and must be owned where they are tested |
| E91-D4 | Markdown → HTML via `Bun.markdown.html` (Bun 1.3.14 built-in) | Add `marked`; reuse the WeChat converter | Stdlib, zero new dependency. `wechatmp-pub` keeps its styled converter |
| E91-D5 | Draft by default; `content.metadata.publishStatus === 'public'` is the only live path (unknown value → `ok:false`) | Live by default; a new `options.publish` flag | Same rail and same field as `xhs-pub` (`src/index.ts:618`) and `wechatmp-pub` (`src/index.ts:319-321`), ADR-022 / ADR-026 |
| E91-D6 | Success only from an observed browser signal (toast, URL change, draft-list delta) | Assume success after click | xhs/wechatmp rule — never report unseen success |
| E91-D7 | No automation guard for the new channels in this feature | Port ADR-025 cap generically now | No site has warned; draft default + operator-initiated runs are the guard. Port the cap when a warning arrives (X first candidate) |

## 3. Module layout

```
packages/publish-harness/
  src/index.ts              # unchanged public surface (+ re-export nothing browser-specific)
  src/browser.ts            # NEW — shared browser command library (sub-path "./browser")
  tests/browser.test.ts     # NEW — fake Page / fake launcher
plugins/publishings/<channel>-pub/          # infoq, juejin, substack, x (article)
  src/index.ts              # SELECTORS table + flow + transport over withProfilePage
  src/profile-check.ts      # NEW — `runProfileCli(config)` one-liner entry
  tests/<channel>-pub.test.ts
plugins/publishings/xhs-pub/src/{index,profile-check}.ts      # shared resolve / waitUntil / checkChannelSession
plugins/publishings/wechatmp-pub/src/index.ts                  # shared waitUntil only
```

`publish-harness/package.json` gains `"./browser"` in `exports` and
`"@gobing-ai/ts-browser-automation": "catalog:"` under `dependencies` (`playwright` stays a
`catalog:` devDependency; type-only import). The package is a root **catalog** entry
(`package.json` `workspaces.catalog`), not a root dependency, and Bun's isolated store only links
what each workspace declares — so every consumer (publish-harness and each new channel plugin)
declares `catalog:` entries and runs `bun install`. Versions are already locked; no new package
enters the lockfile.

## 4. Interfaces (`@gobing-ai/publish-harness/browser`)

```ts
export interface ChannelBrowserConfig {
    channel: string;                         // 'infoq' → INFOQ_PROFILE_DIR
    homeUrl: string;                         // page opened for login/check
    isAuthenticated: IsAuthenticatedPredicate; // site-owned readiness predicate
    loginTimeoutMs?: number;                 // default 180_000
}

/** --profile > <CHANNEL>_PROFILE_DIR > KK_BROWSER_PROFILE_DIR > resolveBrowserProfileDir(channel). */
export function resolveChannelProfileDir(channel: string, override?: string): string;

/** `login` (headed, loginWithProfile) | `check` (headless, read-only). Exit 0 verified, 1 refused, 2 usage error. */
export function runProfileCli(config: ChannelBrowserConfig, argv?: string[], deps?: { launcher?: BrowserLauncher; stdout?: (line: string) => void }): Promise<number>;

/** Headless probe first; on refusal, one headed retry (mirrors xhs `checkXhsProfileSession`). Missing profile → refused, never created. */
export function checkChannelSession(config: ChannelBrowserConfig, opts: { profileDir: string; launcher?: BrowserLauncher; headedFallback?: boolean }): Promise<ChannelSessionResult>;
export interface ChannelSessionResult { status: 'verified' | 'refused'; profileDir: string; detail: string }

export function waitUntil(predicate: () => Promise<boolean>, timeoutMs: number, pollMs?: number): Promise<boolean>;

/** Synthetic ClipboardEvent with text/html + text/plain — ProseMirror, Draft.js, TipTap. */
export function pasteHtml(page: Page, selector: string, html: string, opts?: { timeoutMs?: number }): Promise<void>;

/** CodeMirror 5/6 document API, falling back to keyboard insertText. */
export function fillCodeMirror(page: Page, selector: string, markdown: string, opts?: { timeoutMs?: number }): Promise<void>;

export function uploadFile(page: Page, selector: string, filePath: string, opts?: { timeoutMs?: number }): Promise<void>;

/** First attached candidate of a selector list, polled to `timeoutMs`; throws naming the label, candidates and deadline. */
export function resolveSelector(page: Page, selectors: readonly string[], opts?: { timeoutMs?: number; label?: string }): Promise<string>;

/** Poll `probe` until it yields evidence (id/URL/toast text) or the deadline passes. */
export function expectOutcome(probe: () => Promise<string | null>, opts: { timeoutMs: number; label: string; pollMs?: number }): Promise<{ ok: true; evidence: string } | { ok: false; error: string }>;

export const markdownToHtml: (markdown: string) => string; // Bun.markdown.html
```

Helpers throw a typed `Error` whose message names the selector and timeout; transports convert
it to `ResultSchema` `{ ok: false, error }`. `Page` is the Playwright type (type-only import).

### Plugin transport shape

```ts
export class InfoqBrowserTransport implements PublishTransport {
    kind = 'browser' as const;
    driver = 'script' as const;
    constructor(private deps: { openPage?: OpenPage; launcher?: BrowserLauncher } = {}) {}
    async publish({ content, options }): Promise<Result> {
        const profileDir = resolveChannelProfileDir(CHANNEL, str(options?.profileDir));
        const session = await checkChannelSession(CONFIG, { profileDir, launcher, headedFallback: false }); // headless preflight
        if (session.status !== 'verified') return fail(`${session.detail} — run: bun …/infoq-pub/src/profile-check.ts login`);
        return withProfilePage({ profileDir, url: EDITOR_URL, isAuthenticated, launcher }, async ({ page }) => {
            // fill title → pasteHtml(body) → save draft → expectOutcome(draft id/URL) → [publish when publishStatus === 'public']
        });
    }
}
```

`KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake` keeps returning `FakeBrowserTransport('script')`.

## 5. Invariants

1. No credential, cookie, or profile content in `Result`, logs, or errors — the profile dir path only.
2. Headless never fabricates a session: absent profile → upstream `BrowserProfileMissingError` → login hint.
3. Every browser context closes on every exit path (`withProfilePage` owns it).
4. A draft run never clicks a publish control (E91-D5); asserted in each channel's fake-page test.
5. `xhs-pub` / `wechatmp-pub` behaviour and profile dirs are unchanged by the migration (existing suites pass untouched).
6. API/CLI plugins (`medium`, `qiita`, `zenn`, `x` post) do not import `./browser`.

## 6. Rejected alternatives

- **Delegate to the `wt:publish-to-*` skills** — outside kk's `Content → Result` contract, no Result JSON, no profile reuse.
- **Browser fallback for Medium now** — speculative while the token API works; recorded as deferred.
- **Generic automation guard now** — no site warning yet (E91-D7).

## 7. Build sequence (task grain)

1. `publish-harness/browser` module + tests (R2, R3, R4) and the verdict/deferral rows in `docs/04_DESIGN.md` (R1, R12).
2. Migrate `xhs-pub` plumbing (resolve, `waitUntil`, session check) + `wechatmp-pub` poll loops (R10).
3. `infoq-pub` flow (R5, R9, R11).
4. `juejin-pub` flow (R6, R9, R11).
5. `substack-pub` flow (R7, R9, R11).
6. `x-pub` `article` flow (R8, R9, R11).

Tasks 3–6 depend on 1 and are independent of each other. Selectors seed from the `wt:publish-to-*`
Playwright scripts and are re-measured against the live site during an operator draft dogfood;
CI stays offline (fake pages / injected launchers).
