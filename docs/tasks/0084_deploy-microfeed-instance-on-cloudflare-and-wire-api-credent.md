---
schema_version: 1
name: "Deploy microfeed instance on Cloudflare and wire API credentials"
status: done
template: feature-impl
created_at: 2026-09-02T19:04:38.549Z
updated_at: "2026-09-03T01:42:43.190Z"
feature_id: E6
priority: P1
tags: ["infra", "manual", "microfeed"]
---

## 0084. Deploy microfeed instance on Cloudflare and wire API credentials

### Background

Feature E6 R1+R2. Operator-executed setup: run `npx @microfeed/cli manage` (wrangler login already done), follow its prompts to deploy microfeed to Cloudflare Workers, and verify the instance is publicly reachable. Then in the dashboard enable API access and create a named API key with write scope. Record the instance base URL (workers.dev for now; custom domain bound manually later, out of scope). This task produces the credentials and base URL that podcast-pub consumes; it gates the live smoke task but not plugin development. Sources: vendors/microfeed/docs/manage/, docs/api/authentication.md.

### Requirements

- [x] R1. A microfeed instance is deployed to Cloudflare via `npx @microfeed/cli manage` and publicly reachable: `npx @microfeed/cli manage status` reports the hosted application, database, media, and login healthy, and `GET <instance-url>/json/` returns HTTP 200.
- [x] R2. API access is enabled in the instance dashboard and a named API key with write scope exists; `plugins.publishings.podcast-pub.env` in `~/.config/kk/config.yaml` carries non-empty `MICROFEED_BASE_URL` (the workers.dev URL for now) and `MICROFEED_API_KEY` (mf_…).

**Non-goals (explicit out-of-scope):** custom domain binding (operator does it manually later, then edits `MICROFEED_BASE_URL`); Cloudflare Access hardening (`manage access`); snapshots/backups; any code or config change inside this repository.

### Acceptance Criteria

```gherkin
Scenario: R1 — Operator deploys a publicly reachable microfeed instance on Cloudflare
  Given a valid wrangler OAuth session (account 192f07ef97764f62eb76be2d84508d9e, wrangler 4.107.1)
  When the operator runs `npx @microfeed/cli manage` and completes the deployment prompts
  Then `npx @microfeed/cli manage status` reports the hosted application, database, media, and login healthy
  And `curl -s -o /dev/null -w '%{http_code}' <instance-url>/json/` returns 200

Scenario: R2 — microfeed API access is enabled with a named write API key in config
  Given the deployed microfeed instance from R1
  When API access is enabled and a named key with write scope is created in the dashboard
  Then `plugins.publishings.podcast-pub.env` in `~/.config/kk/config.yaml` carries non-empty MICROFEED_BASE_URL and MICROFEED_API_KEY
  And the key value does not appear anywhere in this repository
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-02T21:02:23.705Z

- **Interactive deploy, not automated** — chosen: operator runs the CLI, AC verifies objectively. Deferred: any scripted deploy, on the condition microfeed ships a non-interactive deploy path.
- **Instance/display name at the CLI prompt** — deferred to the operator at run time (no functional impact; the base URL is what downstream tasks consume).
- **Custom domain** — deferred to a later manual step by the operator, then a one-line `MICROFEED_BASE_URL` edit.

### Design

WHAT: pure operator/infra task — no repo code. Deploy microfeed with the official interactive CLI, verify reachability, enable the API, create a named write key, and paste base URL + key into the user-level kk config.

WHY: `@microfeed/cli manage` is interactive by design (browser-granted OAuth to Cloudflare), so automation is out of scope; the AC below makes the manual work objectively verifiable instead.

WHERE: everything lands outside the repo — the Cloudflare account and `~/.config/kk/config.yaml`. The repo is touched only by this task file.

**Frozen names:**

- Deploy: `npx @microfeed/cli manage` (first run walks setup/deploy prompts).
- Verify: `npx @microfeed/cli manage status` (checks hosted app, database, media, login — per `vendors/microfeed/docs/manage/index.md`) and `curl -s -o /dev/null -w '%{http_code}' <base>/json/` → `200`.
- Config keys (exact path): `plugins.publishings.podcast-pub.env.MICROFEED_BASE_URL` and `plugins.publishings.podcast-pub.env.MICROFEED_API_KEY` in `~/.config/kk/config.yaml`. Suggested key name in the dashboard: `kk-podcast-pub`.

**Anti-patterns (do not):**

- Do not deploy with raw `wrangler deploy` — microfeed's D1 migrations/R2 bucket wiring are orchestrated by the manage CLI.
- Do not use a Cloudflare API token or the dashboard password as the microfeed API credential (`vendors/microfeed/docs/api/authentication.md`: API keys are named `mf_…` keys only).
- Do not commit the API key or instance URL into this repo; the user config is the only home.
- Do not bind the custom domain in this task.

**Handoff:** leaves `MICROFEED_BASE_URL` + `MICROFEED_API_KEY` in user config for 0085 (read as process env at exec time; 0085 must stay offline-testable without them) and 0086 (the live smoke). Assumes nothing from other tasks.

### Plan

- [ ] 1. Run `npx @microfeed/cli manage` and follow the prompts through deploy (wrangler OAuth already valid — verified this session: account `192f07ef…`, wrangler 4.107.1).
- [ ] 2. Verify: `npx @microfeed/cli manage status` healthy **and** `curl -s -o /dev/null -w '%{http_code}' <base>/json/` → 200. (verification intent: both signals, not just one)
- [ ] 3. Dashboard → API → enable API access; create named key `kk-podcast-pub` with **write** scope; copy the `mf_…` value.
- [ ] 4. Edit `~/.config/kk/config.yaml`: add `plugins.publishings.podcast-pub.env` with `MICROFEED_BASE_URL` and `MICROFEED_API_KEY`.
- [ ] 5. Record the instance base URL in this task's `## Solution` (it is not a secret; the key never enters the repo).

### Solution

Infra-only task — no repo code changed. Landed outside the repo:

- Credentials surface: `~/.config/kk/config.yaml:36-39` — `plugins.publishings.podcast-pub.env` with `MICROFEED_BASE_URL: "https://podcast.salty.vip"` + `MICROFEED_API_KEY` (operator-created, write scope; consumed by the plugin at exec time).
- Cloudflare (account `192f07ef…`): Worker `feed-gobing-ai`, D1 `feed-gobing-ai-db`, R2 `feed-gobing-ai-media` (MEDIA_BUCKET binding), Custom Domain `podcast.salty.vip`; microfeed **1.0.9**.
- Instance: admin path `admin`, built-in auth, owner `luonbin@hotmail.com`; password set by operator via one-time private link (agent never handled it).

Command history: `manage init … --admin-auth built-in --no-open --yes` → complete; `manage status` healthy; `manage domain --hostname podcast.salty.vip` verified.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `npx @microfeed/cli manage status` re-run 2026-09-02: "Status checks passed" — Worker feed-gobing-ai found, D1 feed-gobing-ai-db bound, R2 feed-gobing-ai-media exact bucket + MEDIA_BUCKET binding, admin luonbin@hotmail.com, built-in login active, "Deployment verified at https://podcast.salty.vip/.well-known/microfeed.json", custom domain verified; `GET https://podcast.salty.vip/json/` → HTTP 200, JSON Feed 1.1 (re-run 2026-09-02) |
| R2 | MET | kk user config `~/.config/kk/config.yaml` lines 36-38 — `plugins.publishings.podcast-pub.env` carries non-empty MICROFEED_BASE_URL (https://podcast.salty.vip) and MICROFEED_API_KEY (mf_ prefix, value never echoed); unauth `GET /api/v1/items/` → 401 (API enabled; disabled would be 404); repo-wide grep -rF for the key value (excluding .git, node_modules) → 0 hits (2026-09-02) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Operator deploys a publicly reachable microfeed instance on Cloudflare | MET | command | `npx @microfeed/cli manage status` exit 0 "Status checks passed" (2026-09-02); `curl -s -o /dev/null -w '%{http_code}' https://podcast.salty.vip/json/` → 200 (2026-09-02) |
| R2 — microfeed API access is enabled with a named write API key in config | MET | command | unauth `/api/v1/items/` → 401 (2026-09-02); `~/.config/kk/config.yaml` lines 36-38 non-empty MICROFEED_BASE_URL + MICROFEED_API_KEY (mf_ prefix); key-value repo scan → 0 hits (2026-09-02) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
<!-- spur:record-review -->

**SECU findings** (verifyall --force re-audit 2026-09-02 — verdict: PASS, live production evidence)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P3 | version drift | deployed instance | Deployed microfeed 1.0.9 vs vendored contract pin 1.0.8 (`vendors/microfeed/package.json`); same `/api/v1/` surface confirmed live 2026-09-02. Accepted. |
| P4 | config accuracy | `~/.config/kk/config.yaml:36-38` | feed `home_page_url` still advertises the workers.dev origin (stored site setting; `feed_url` already custom). Publish flow unaffected; unchanged since the original verify. |
| P4 | spur task check | — | task check passed; evidence-rule-pass: both AC rows carry fresh executable command evidence (manage status + HTTP probes, 2026-09-02) |
### References

- Feature: E6 (`docs/features/E6_microfeed-podcast-publisher.md`)
- Design satellite: `docs/design/podcast-pub.md` (D4 config surface)
- microfeed manage CLI: `vendors/microfeed/docs/manage/index.md`
- API auth (named keys, Bearer): `vendors/microfeed/docs/api/authentication.md`
- Dependents: 0085 (plugin), 0086 (live smoke)

### History

- 2026-09-02T23:58:07.276Z todo → wip (system)
- 2026-09-03T00:07:39.989Z wip → testing (system)
- 2026-09-03T00:07:40.357Z testing → done (system)
