# Browser launch & cached-login recipes

Everything here is measured on the kk channels (E92 discovery, 2026-10).
The launcher is the proven pattern from `.spur/run/discovery/xhs-launch.ts` /
`walk-wechatmp*.ts`; the profile matrix is the live
`~/.config/kk/browser-profiles/` tree.

## The launcher (persistent context + CDP + stealth)

```ts
import { chromium } from 'playwright';

const profileDir = process.env.KK_WEB_PROFILE ?? `${process.env.HOME}/.config/kk/browser-profiles/<channel>`;
const port = process.env.KK_WEB_CDP ?? '9222';

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
```

- The **profile dir is the credential cache** — cookies + storage survive runs;
  nothing else is persisted, no tokens are printed.
- `agent-browser` (or any CDP client) attaches to the printed port; plain
  Playwright scripts can also import the same process's `page`.
- One context per channel. Two concurrent launches on one profile corrupt it.

## Headless vs headed

| Situation | Mode | Why |
| --- | --- | --- |
| Session probe / preflight | headless OK | read-only, cheap |
| Automated drive on a proven session | headless OK | measured: infoq/juejin/substack/x/wechatmp drives work headless post-login |
| `auth: fresh` login | **headed** | operator completes QR/OAuth by hand |
| xhs any operation | **headed** | bot-walls headless loads (measured); shadow-root clicks need CDP anyway |
| Any step that might trip a bot wall first time | **headed** | watch it once, record, then automate |

## Profile matrix (as shipped)

| Channel | Profile dir | Notes |
| --- | --- | --- |
| xhs | `browser-profiles/xhs` | headed always; shadow-root controls via CDP box models |
| infoq | `browser-profiles/infoq` | draft save = `/draft/<id>` URL |
| juejin | `browser-profiles/juejin` | draft id from post-save URL |
| substack | `browser-profiles/substack` | robinmin.substack.com; post id in `/publish/post/<id>` |
| x | `browser-profiles/x` | article edit URL carries draft id |
| wechatmp | `browser-profiles/wechatmp` | QR login; draft id from draft/add response + editor URL |

New channel ⇒ one-time headed `fresh` login on that dir, then it becomes the cache.

## Session probe (cached-auth validity)

Don't age-guess — probe a signed-in-only selector on the channel's console URL:

```ts
const ok = await page.locator('<signed-in-only selector>').first().isVisible({ timeout: 10_000 });
if (!ok) throw new Error('auth=expired: fresh login required');
```

Per-channel selectors live in the channel's `docs/design/<channel>-ui-discovery.md`.

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
