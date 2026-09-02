---
schema_version: 1
name: "Deploy microfeed instance on Cloudflare and wire API credentials"
status: todo
template: feature-impl
created_at: 2026-09-02T19:04:38.549Z
updated_at: "2026-09-02T21:02:23.863Z"
feature_id: E6
priority: P1
tags: ["infra", "manual", "microfeed"]
---

## 0084. Deploy microfeed instance on Cloudflare and wire API credentials

### Background

Feature E6 R1+R2. Operator-executed setup: run `npx @microfeed/cli manage` (wrangler login already done), follow its prompts to deploy microfeed to Cloudflare Workers, and verify the instance is publicly reachable. Then in the dashboard enable API access and create a named API key with write scope. Record the instance base URL (workers.dev for now; custom domain bound manually later, out of scope). This task produces the credentials and base URL that podcast-pub consumes; it gates the live smoke task but not plugin development. Sources: vendors/microfeed/docs/manage/, docs/api/authentication.md.

### Requirements

- [ ] R1. A microfeed instance is deployed to Cloudflare via `npx @microfeed/cli manage` and publicly reachable: `npx @microfeed/cli manage status` reports the hosted application, database, media, and login healthy, and `GET <instance-url>/json/` returns HTTP 200.
- [ ] R2. API access is enabled in the instance dashboard and a named API key with write scope exists; `plugins.publishings.podcast-pub.env` in `~/.config/kk/config.yaml` carries non-empty `MICROFEED_BASE_URL` (the workers.dev URL for now) and `MICROFEED_API_KEY` (mf_…).

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: E6 (`docs/features/E6_microfeed-podcast-publisher.md`)
- Design satellite: `docs/design/podcast-pub.md` (D4 config surface)
- microfeed manage CLI: `vendors/microfeed/docs/manage/index.md`
- API auth (named keys, Bearer): `vendors/microfeed/docs/api/authentication.md`
- Dependents: 0085 (plugin), 0086 (live smoke)

### History
