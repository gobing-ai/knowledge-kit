# Browser launch & cached-login recipes

Everything here is measured on the kk channels (E92 discovery, A22 named bots, and 0346 collection runner).
The canonical tool for named session management is `kk bot`; the underlying libraries are `@gobing-ai/publish-harness`
and `@gobing-ai/publish-harness/bot-collection`.

## Named bot CLI suite (`kk bot`)

The profile root `~/.config/kk/browser-profiles/<name>` is managed safely with transactional staging and leases:

```bash
kk bot list                        # List cached profiles, last login, and estimated expiry
kk bot login <channel>             # Headed interactive login (delegates to matched channel adapter)
kk bot login <url> --save <name>   # Generic headed login (operator terminal confirmation before save)
kk bot open <name> [--login]       # Open saved page headed until window closes (--login re-authenticates)
kk bot logout <name>               # Delete local profile directory behind the shared lease
kk bot exec <name> <url> [opts]    # Single authenticated HTTP request with cached cookies (curl subset)
kk bot plan <name> <plan.json> [opts] # Execute declarative collection plan under lease (-o, -m)
```

## Rendered collection runner substrate (task 0346)

For automated structured web data collection without raw browser scripting, use `@gobing-ai/publish-harness/bot-collection`.
It executes a declarative JSON plan under a single profile lease and a single headless persistent context:

```ts
import { runBotCollection } from '@gobing-ai/publish-harness/bot-collection';

const result = await runBotCollection('xhs', {
    steps: [
        { id: 'home', kind: 'navigate', url: 'https://creator.xiaohongshu.com/' },
        { id: 'wait-nav', kind: 'wait', selector: '.creator-menu' },
        { id: 'click-menu', kind: 'click', selector: '.creator-menu >> text="Publish"' },
        { id: 'extract-data', kind: 'extract', selector: '.data-card', format: 'text' },
    ],
    responses: [
        { id: 'creator-info', pathPrefix: '/api/galaxy/creator/info' },
    ],
    timeoutMs: 45_000,
});
```

### Plan step grammar (`BotCollectionStep`)

- `{ id, kind: 'navigate', url, waitUntil?: 'load'|'domcontentloaded'|'networkidle'|'commit' }`
- `{ id, kind: 'wait', selector?, timeoutMs? }`
- `{ id, kind: 'click', selector, timeoutMs? }`
- `{ id, kind: 'scroll', deltaY, selector?, timeoutMs? }`
- `{ id, kind: 'extract', selector, format: 'text'|'html'|'count', timeoutMs? }`
- `{ id, kind: 'request', url, method?: 'GET'|'POST', headers?, data? }`
- Capture: `responses: [{ id, origin?, pathPrefix, optional?: boolean }]`

### Fail-closed error contract

- `authentication`: Explicit 401/403 (request, navigation, or required response) or final navigation URL matching `/login|signin|sign-in|auth|sso/i`.
- `empty`: A declared non-optional capture matched no response, or an extract/request step yielded an empty body. Prevents client-side rendered SPA shells from masquerading as a quiet day.
- `browser`: Network/transport error, timeout, or uncaught DOM exception.

### CLI Execution (`kk bot plan`) and Probe Script

Run collection plans directly with the CLI:

```bash
# Output JSON result to stdout
kk bot plan <channel> <plan.json> -m 60

# Write individual 0600 artifacts and result.json / error.json into directory
kk bot plan <channel> <plan.json> -o <output-dir> -m 60
```

Low-level debugging can also use `bot-collection-probe.ts`:

```bash
bun packages/publish-harness/scripts/bot-collection-probe.ts \
  --profile <name> \
  --plan <plan.json> \
  --out <output-dir>
```

Outputs artifact files with 0600 permissions, `result.json` (metadata without bodies), or `error.json` on failure.

## Direct Playwright launcher (persistent context + lease + CDP + stealth)

When interactive discovery or custom CDP scripts are needed, always wrap execution with the profile lease:

```ts
import { chromium } from 'playwright';
import { withProfileLease } from '@gobing-ai/publish-harness';

const profileName = process.env.KK_WEB_BOT ?? '<channel>';
const profileDir = `${process.env.HOME}/.config/kk/browser-profiles/${profileName}`;
const port = process.env.KK_WEB_CDP ?? '9222';

await withProfileLease(profileName, async () => {
    const ctx = await chromium.launchPersistentContext(profileDir, {
        headless: process.env.KK_WEB_HEADLESS === 'true', // default headed
        viewport: null,
        args: [
            `--remote-debugging-port=${port}`,              // agent-browser / external CDP clients attach here
            '--disable-blink-features=AutomationControlled', // required at OAuth/bot-wall gates
        ],
    });
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    console.log(JSON.stringify({ cdpPort: port, profile: profileDir, url: page.url() }));
    process.on('SIGTERM', async () => { await ctx.close(); process.exit(0); });
    await new Promise(() => {}); // stay up for CDP drivers
});
```

- The **profile dir is the credential cache** — cookies + storage survive runs;
  nothing else is persisted, no tokens are printed.
- `agent-browser` (or any CDP client) attaches to the printed port; plain
  Playwright scripts can also import the same process's `page`.
- **Profile lease required**: `withProfileLease` ensures single-process access.
  Two concurrent launches on one profile corrupt it.

## Headless vs headed

| Situation | Mode | Why |
| --- | --- | --- |
| Session probe / preflight (`kk bot list`, `check`) | headless OK | read-only, cheap |
| `kk bot exec` single-request fetch | headless | persistent context attaches cookies automatically |
| `runBotCollection` automated collection | headless | bounded steps and required response captures |
| Automated drive on a proven session | headless OK | measured: infoq/juejin/substack/x/wechatmp drives work headless post-login |
| `kk bot login` / fresh authentication | **headed** | operator completes QR/OAuth/password by hand |
| `kk bot open` inspection | **headed** | operator views page and DOM |
| xhs any publish/drive | **headed** | bot-walls headless loads (measured); shadow-root clicks need CDP anyway |
| Any step that might trip a bot wall first time | **headed** | watch it once, record, then automate |

## Profile matrix (as shipped)

| Channel | Profile dir | Login command | Notes |
| --- | --- | --- | --- |
| xhs | `browser-profiles/xhs` | `kk bot login xhs` | headed always; shadow-root controls via CDP box models |
| infoq | `browser-profiles/infoq` | `kk bot login infoq` | draft save = `/draft/<id>` URL |
| juejin | `browser-profiles/juejin` | `kk bot login juejin` | draft id from post-save URL |
| substack | `browser-profiles/substack` | `kk bot login substack` | robinmin.substack.com; post id in `/publish/post/<id>` |
| x | `browser-profiles/x` | `kk bot login x` | article edit URL carries draft id |
| wechatmp | `browser-profiles/wechatmp` | `kk bot login wechatmp` | QR login; draft id from draft/add response + editor URL |
| weibo | `browser-profiles/weibo` | `kk bot login weibo` | 头条文章 editor |

New channel ⇒ one-time headed `kk bot login <url> --save <name>` or `kk bot login <channel>`, then it becomes the cache.

## Session probe (cached-auth validity)

Don't age-guess — probe a signed-in-only selector or run the plugin's probe:

```bash
# Fast metadata check
kk bot list

# Lightweight authenticated request test
kk bot exec <name> <console-url>

# Reopen or re-authenticate
kk bot open <name> --login
```

## storageState vs profile dir

Prefer the **profile dir** (this is what every shipped plugin uses): it caches
service workers, IndexedDB, and cookie chaos that JSON `storageState` loses and
that OAuth flows notice. Reach for `storageState` only when a tool requires a
portable JSON snapshot — export once from the live context, mark it
time-sensitive, keep it out of git, and treat expiry as probe-verified, never
assumed.

## Failure semantics

- No observed outcome signal (toast / counter delta / URL change) ⇒ report
  **failure with the reason**; never infer success from "no exception".
- Save actions assert the channel's measured signal within its measured
  timeout (e.g. wechatmp `.weui-desktop-toast` ≤ 15 s) — loud on miss.
- Always `ctx.close()` on SIGTERM/exit paths; orphaned Chromiums hold the
  profile lock and the next run fails confusingly.
- In collection plans (`runBotCollection`), differentiate `authentication` (action: run `kk bot login`),
  `empty` (action: check site selector/API path drift), and `browser` (action: investigate transport/timeout).
