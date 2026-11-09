---
name: web-automation
description: >-
  Discover, enhance, and automate web tasks with Playwright, kk bot, or agent-browser
  over CDP — "walk this console and record evidence", "figure out this site's
  UI", "automate this web flow", "reuse my cached login on <channel>", "check
  whether my session on <channel> is still valid", "run a browser collection plan",
  "fix this channel's selectors", or when a spur workflow `agent.run` step targets the
  web-automation skill. Coordinates with the kk bot session lifecycle and collection
  substrate. Owns method and evidence; transport stays in kk plugins; orchestration is
  a @gobing-ai/ts-dual-workflow-engine transition-flow (see docs/design/web-automation-engine.md).
requires: [cli:kk, cli:spur, local-fs]
---

# web-automation — discover, enhance, automate with a real browser

## Purpose

Three operational lenses over one unified browser automation architecture: drive a **real Chromium on the named bot's
cached login profile**, record **verifiable evidence** (screenshots, DOM signals, JSON responses),
and never report an outcome that was not observed.

| Operation | When | Tier & Substrate | Output |
| --- | --- | --- | --- |
| **discover** | New/changed site; "figure out this UI", inspect selectors/shadow roots | **Tier 3** (`kk bot open` + CDP/Playwright) | Evidence dir (`frames/`, `signals.json`) + drift list (`docs/design/<channel>-ui-discovery.md`) |
| **enhance** | Selectors drifted; a plugin or collection plan fails on a live console | **Tier 2 / 3** (`kk bot exec`, probe script) | Root-cause fix in plugin + updated discovery doc in same commit |
| **automate** | Repeatable web task (data collection, form fill, draft save, health audit) | **Tier 1 / 2** (`kk bot exec`, `runBotCollection`) | Bounded Result + captured artifacts (draft-safe by default, fail-closed) |

This skill owns **method**. It does not own transport (that belongs to `kind: publish` / `ingestion` plugins) or orchestration
(that is the engine — `spur workflow` running `@gobing-ai/ts-dual-workflow-engine`; see `docs/design/web-automation-engine.md`).

---

## The 3-Tier Web Automation Model

To keep workflows clean, safe, and robust against anti-bot friction, all web automation tasks follow a strict 3-tier hierarchy:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Tier 1: Session & Probe Gateway (kk bot CLI)                                  │
│   • Profile inventory & expiry estimates: kk bot list                        │
│   • Headed login & transactional staging:  kk bot login <channel>            │
│   • Single-request authenticated queries:  kk bot exec <name> <url>          │
│   • Local credential wipe:                 kk bot logout <name>              │
└──────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Tier 2: Declarative Headless Automation (kk bot plan / bot-collection)       │
│   • Canonical CLI runner: kk bot plan <bot> <plan.json> [-o <dir>] [-m <sec>]│
│   • Bounded multi-step JSON plans (navigate, wait, click, scroll, extract)   │
│   • Declarative network response captures (responses: [{pathPrefix}])        │
│   • Single profile lease + single headless context launch                    │
│   • Fail-closed errors: authentication (auth walls) vs empty vs browser      │
│   • Programmatic runner: runBotCollection in @gobing-ai/publish-harness      │
│   • Low-level probe tool: bun packages/publish-harness/scripts/bot-collection-probe.ts │
└──────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Tier 3: Deep Interactive Automation (Playwright / CDP under withProfileLease)│
│   • Headed visual inspection & interaction: kk bot open <name> [--login]     │
│   • File uploads (setInputFiles) & shadow-root coordinate clicks via CDP     │
│   • Live DOM accessibility dumps & interactive selector reverse-engineering  │
│   • Strict lease enforcement: withProfileLease prevents concurrent corruption │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Tier 1: Session & Profile Lifecycle (`kk bot`)

All browser sessions live under the fixed default root:

```text
~/.config/kk/browser-profiles/<name>       # persistent profiles (xhs, infoq, juejin, substack, x, wechatmp, etc.)
~/.config/kk/browser-transactions/         # crash-safe staging and atomic promotion for logins
~/.config/kk/browser-leases/               # shared lease locks preventing concurrent profile corruption
```

### CLI Command Reference

| Command | Purpose | Input / Options | Behavior |
| --- | --- | --- | --- |
| `kk bot list` | Inventory | None | Prints tab-separated columns: `name`, `cached`, `defaultUrl`, `identity`, `lastLogin`, `expires`. Browser-free. |
| `kk bot login <channel>` / `<url> --save <name>` | Fresh authentication | Channel name or URL (`--save <name>`) | Opens headed in isolated staging; saves adapter-verified evidence or waits for operator confirmation; promotes atomically. |
| `kk bot open <name> [--login]` | Inspection | Bot name (`--login` optional) | Opens saved default URL headed until operator closes browser. `--login` re-authenticates first. |
| `kk bot logout <name>` | Wipe credentials | Bot name | Deletes local profile directory behind shared lease. Idempotent. |
| `kk bot exec <name> <url> [opts]` | Authenticated HTTP | `-X`, `-H`, `-d`, `-o`, `-i`, `-L`, `-f`, `-m` | One headless persistent launch; sends request with profile's cached cookies; writes body as raw bytes. |
| `kk bot plan <name> <plan.json> [opts]` | Declarative Collection | `-o, --output <dir>`, `-m, --max-time <sec>` | Headless persistent launch under shared lease; runs declarative plan steps and captures; writes artifacts or prints JSON result. |

### Session Preflight & Health Check

Before triggering automated runs, perform a fast probe. Age-guessing timestamps is banned — probe, don't predict:

```bash
# 1. Check local profile inventory
kk bot list

# 2. Lightweight authenticated query probe (returns status + headers)
kk bot exec <channel> <console-url> -i -m 15 -o /tmp/probe.txt

# 3. If expired or unauthenticated (HTTP 401/403 or redirect to login):
kk bot login <channel>
```

---

## Tier 2: Declarative Headless Automation (`bot-collection`)

For data collection, scraping, site audits, and structured form workflows, **do not write ad-hoc Playwright scripts**.
Use the declarative `@gobing-ai/publish-harness/bot-collection` substrate:

```ts
import { runBotCollection } from '@gobing-ai/publish-harness/bot-collection';

const result = await runBotCollection('wechatmp', {
    steps: [
        { id: 'nav-home', kind: 'navigate', url: 'https://mp.weixin.qq.com/' },
        { id: 'wait-dashboard', kind: 'wait', selector: '.weui-desktop-layout', timeoutMs: 15_000 },
        { id: 'extract-stats', kind: 'extract', selector: '.weui-desktop-mass__item', format: 'text' },
    ],
    responses: [
        { id: 'appmsg-list', pathPrefix: '/cgi-bin/appmsg' },
    ],
    timeoutMs: 30_000,
});
```

### Plan Grammar (`BotCollectionPlan`)

A plan is a frozen JSON object with `steps[]`, optional `responses[]` captures, and an optional whole-run `timeoutMs`:

- **`navigate`**: `{ id, kind: 'navigate', url, waitUntil?: 'load'|'domcontentloaded'|'networkidle'|'commit' }`
- **`wait`**: `{ id, kind: 'wait', selector?, timeoutMs? }`
- **`click`**: `{ id, kind: 'click', selector, timeoutMs? }`
- **`scroll`**: `{ id, kind: 'scroll', deltaY, selector?, timeoutMs? }`
- **`extract`**: `{ id, kind: 'extract', selector, format: 'text'|'html'|'count', timeoutMs? }`
- **`request`**: `{ id, kind: 'request', url, method?: 'GET'|'POST', headers?, data? }`
- **`responses`**: `[{ id, origin?, pathPrefix, optional?: boolean }]`

### Fail-Closed Integrity Rules

- **`authentication`**: Fails immediately when an explicit 401/403 occurs on a request, navigation, or required response, or when the final navigation URL path matches `/login|signin|sign-in|auth|sso/i`. Action: alert operator to run `kk bot login <channel>`.
- **`empty`**: Fails immediately when a declared non-optional capture receives no response, or an `extract`/`request` step yields an empty body. Prevents client-side rendered SPA shells from masquerading as a successful quiet run.
- **`browser`**: Transport faults, timeouts, navigation drops, and DOM exceptions.

### Running Plans via CLI (`kk bot plan`)

Execute a collection plan directly from the terminal or a workflow script:

```bash
# Run plan and stream JSON result to stdout
kk bot plan <channel> <path/to/plan.json> -m 60

# Run plan and write 0600 artifact files + result.json / error.json into output dir
kk bot plan <channel> <path/to/plan.json> -o <path/to/evidence-dir> -m 60
```

Exit codes: `0` = success, `1` = operational failure (`authentication`, `empty`, or `browser`), `2` = usage error (invalid JSON, missing profile, invalid timeout).

Low-level debugging can also use the repository probe script:

```bash
bun packages/publish-harness/scripts/bot-collection-probe.ts \
  --profile <name> \
  --plan <path/to/plan.json> \
  --out <path/to/evidence-dir>
```

---

## Tier 3: Deep Interactive Automation (Playwright / CDP)

When an activity requires capabilities outside Tier 2 — specifically:
1. **Interactive UI discovery** (navigating unknown layouts, recording screenshots).
2. **Shadow-root component piercing** (e.g. XHS creator console shadow boundaries).
3. **File uploads** (attaching images/videos via `page.setInputFiles`).
4. **Canvas / complex coordinate dragging**.

You MUST wrap the run inside the shared profile lease to prevent profile corruption:

```ts
import { chromium } from 'playwright';
import { withProfileLease } from '@gobing-ai/publish-harness';

const profileName = 'xhs';
const profileDir = `${process.env.HOME}/.config/kk/browser-profiles/${profileName}`;
const port = process.env.KK_WEB_CDP ?? '9222';

await withProfileLease(profileName, async () => {
    const ctx = await chromium.launchPersistentContext(profileDir, {
        headless: process.env.KK_WEB_HEADLESS === 'true',
        viewport: null,
        args: [
            `--remote-debugging-port=${port}`,
            '--disable-blink-features=AutomationControlled',
        ],
    });
    try {
        const page = ctx.pages()[0] ?? (await ctx.newPage());
        // Drive page actions, upload files, or attach agent-browser via CDP...
    } finally {
        await ctx.close();
    }
});
```

---

## Playbook: Common Automation Scenarios

### Scenario A: Site Discovery & Reverse-Engineering
1. Check cached session: `kk bot list`.
2. Open target page headed: `kk bot open <channel>`.
3. Inspect DOM, capture layout, dump accessibility tree, take screenshots.
4. Document selectors, shadow roots, and observed signals into `docs/design/<channel>-ui-discovery.md`.
5. Close window; `kk bot open` outputs `<name>\tclosed`.

### Scenario B: Lightweight Authenticated Scraping
1. Send direct authenticated request:
   ```bash
   kk bot exec <channel> "https://target.com/api/data" -H "Accept: application/json" -o data.json
   ```
2. If the endpoint returns client-rendered HTML shell rather than JSON, escalate to **Scenario C**.

### Scenario C: Declarative Headless Data Collection
1. Draft a `plan.json` with required navigation, waits, and response captures.
2. Probe run:
   ```bash
   bun packages/publish-harness/scripts/bot-collection-probe.ts --profile <channel> --plan plan.json --out .spur/run/evidence
   ```
3. Verify `result.json` shows all artifacts captured with non-empty bodies.
4. Wire into ingestion plugin or workflow.

### Scenario D: Broken Selector Repair (`enhance`)
1. Replay failing plan or run `kk bot exec`.
2. Inspect `error.json` / diagnostics (is it `authentication`, `empty`, or `browser`?).
3. If selector changed, launch `kk bot open <channel>`, observe the updated DOM element.
4. Update selector in shared helper, re-verify with probe script, commit alongside discovery doc.

---

## Safety Rails (Non-Negotiable)

- **Draft-Safe by Default**: Never click publish/send/submit/delete unless the task explicitly authorizes live actions.
- **Lease Invariant**: Every browser context touching `~/.config/kk/browser-profiles/<name>` must be acquired through `kk bot`, `runBotCollection`, or `withProfileLease`. Direct un-leased `launchPersistentContext` is banned.
- **Fail Closed on Quiet Failures**: Missing data and auth walls must fail loud (`authentication` or `empty`). Never treat an empty SPA shell or an auth redirect as a normal quiet response.
- **Headed vs Headless**:
  - Headless: Session probes (`kk bot list`), authenticated queries (`kk bot exec`), declarative collection (`runBotCollection`).
  - Headed: First-time logins (`kk bot login`), interactive discovery (`kk bot open`), and bot-walled platforms (XHS).
- **Secrets Invariant**: Zero credentials in repo, code, or logs. All state lives exclusively in `~/.config/kk/` outside Git.
- **Confidence-Verified Verdicts**: Every workflow outcome verdict must declare `confidence: HIGH | MEDIUM | LOW`. Missing or out-of-enum confidence halts execution.
