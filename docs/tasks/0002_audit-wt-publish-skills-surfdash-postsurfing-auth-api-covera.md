---
template: feature-impl
schema_version: 1
name: "Audit wt publish skills (Surfdash postsurfing, auth, API, coverage)"
description: ""
status: done
type: task
profile: standard
feature_id: E1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-23T17:57:45.393Z"
updated_at: "2026-07-23T23:40:08.995Z"
---

## 0002. Audit wt publish skills (Surfdash postsurfing, auth, API, coverage)

### Background
Feature **E** (PublishPlugin: Surfdash) is a **tested rewrite, not reuse**, because the wt publish skills lack unit tests. This gate reverse-engineers those skills — Surfdash first — so the `PublishPlugin` contract + test harness (**E2**) and the Surfdash rewrite (**E3**) are grounded, and the Phase-2 rewrite epic (**G**) has a per-platform map.

MEDIUM-confidence to verify: Surfdash publishes via a `postsurfing` CLI (`wt:publish-to-surfing` description, not source-read).
### Requirements
R1. Audit `wt:publish-to-surfing`: mechanism (postsurfing CLI?), inputs/outputs, auth/secrets model, config, and current test coverage.
R2. Survey the wt `publish-*` family (medium, juejin, qiita, substack, infoq, wechatmp, x, xhs, zenn): common shape vs per-platform specifics, auth patterns, external deps (incl. the 25 Python scripts).
R3. Derive the `PublishPlugin` contract (`publish(Content) → Result`) and reusable test-harness needs (fixtures, mock-at-boundary) from the common shape. Feeds E2.
R4. Produce a per-platform rewrite map for feature G (effort / risk / auth per target).
### Acceptance Criteria
```gherkin
Feature: wt publish audit

  Scenario: Surfdash mechanism and contract grounded
    Given the wt publish skills (Surfdash first) have been read
    When their mechanism, auth, and test coverage are documented
    Then a PublishPlugin contract shape, test-harness needs, and a per-platform rewrite map are recorded in this task
    And features E2/E3 can proceed and feature G is decomposable
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
## Surfdash publish mechanism (source-verified, 2026-07-23)

Surfing = an **Astro static site on Cloudflare Pages**; publishing is **file-based, not API-based**. `publish-to-surfing/scripts/publish.sh` wraps `node <postsurfing.mjs>`:

`postsurfing <file> [--type --lang --dry-run --no-build --no-commit]` → validate → place in `contents/{type}/{lang}/` → build-validate → **git commit + push** → Cloudflare Pages auto-deploys → live.

- **Auth: none** (local git creds only) — the simplest of the 10 targets.
- **Required frontmatter:** title, description, tags (array, lowercase-hyphen), date, published; optional canonical_url, featured_image (absolute URL), author{}.
- **Anti-pattern to drop:** `publish.sh` "always exits 0" (swallows errors) — the rewrite must **fail loud**.

## Publish family — two transport classes

Input is always **markdown + frontmatter**. Scripts are **TypeScript (Playwright, run via bun)** + shell — **no Python** (the 25 py files are all generator/image skills). **No publish skill has unit tests.**

| Transport | Targets | Auth | Testability |
|---|---|---|---|
| **File/CLI** | Surfing (postsurfing→git), Zenn (Zenn CLI/GitHub) | none / git | High — mock fs + child_process |
| **Browser (Playwright)** | X, Substack, WeChatMP, Medium, Juejin, Qiita*, XHS, InfoQ | login/session, Chrome profiles (`~/.claude/wt/config.jsonc`) | Low — mock at the Playwright boundary |

(*Qiita also has a token API — a cleaner path.)

## PublishPlugin contract (feature B2/E2)

`publish(content, target) → PublishResult`; `content = { markdown, frontmatter{title,description,tags[],date,canonical_url?,featured_image?,author?}, assets? }`. The contract must **abstract transport** — a `FileCliTransport` (Surfdash/Zenn) and a `BrowserTransport` (Playwright) — plus a **per-platform frontmatter-mapping** layer (tags array↔CSV, canonical support, image handling).
### Plan
<!-- Ordered research checklist. -->

- [ ] Read `wt:publish-to-surfing` (skill + scripts); confirm postsurfing mechanism, auth, coverage
- [ ] Skim the `publish-*` family for common vs per-platform shape
- [ ] Derive `PublishPlugin` contract + harness needs (E2)
- [ ] Draft per-platform rewrite map (G1–G9)
- [ ] Record findings
### Solution
## Findings → decisions

**E3 (Surfdash) is the ideal reference publisher:** file/CLI-based, **no auth**, fully unit-testable. First cut = a tested TS PublishPlugin that maps Content→Surfing frontmatter and shells out to the proven `postsurfing.mjs` (reuse the CLI; add the tests it lacks). Full reimplementation (place + build-validate + git) optional later.

**E2 (contract + harness):** design the contract with a **transport abstraction** (FileCli vs Browser) so E3 implements FileCli only and feature G implements Browser. Harness: mock `child_process`/fs for FileCli; mock the Playwright page at the boundary for Browser. Shared frontmatter-mapping is separately unit-testable.

## Per-platform rewrite map (feature G — R4)

| Target | Transport | Auth | Effort/risk |
|---|---|---|---|
| Zenn | Zenn CLI (GitHub) | repo | Low — FileCli, like Surfdash |
| Qiita | token API | API token | Low–Med — clean API |
| Medium | API(deprecated)/browser | token/login | Med |
| Juejin | browser/API | login | Med |
| X | Playwright | session | Med–High — char limits / threads |
| Substack | Playwright | login | Med–High |
| InfoQ | browser | login | Med–High |
| WeChatMP | Playwright + Chrome profile | session | High — theme conversion, MP quirks |
| XHS | Playwright | login | High — anti-bot, image-first |

**G build order:** Zenn + Qiita (reuse the E2 FileCli/API harness) → one browser target to prove `BrowserTransport` + mock-at-boundary → remaining browser targets.

**Confidence:** HIGH on Surfdash + the transport split (source-read publish-to-surfing, postsurfing flow, medium/x/wechatmp/substack/zenn SKILLs). MEDIUM on juejin/qiita/xhs/infoq specifics — confirm per-target when G decomposes.
### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review
| Priority | Finding | Disposition |
|----------|---------|-------------|
| P1 (blocker) | None — research ticket; no production code | N/A |
| P2 (major) | wt publish skills have **zero unit tests** — confirms the rewrite-with-tests mandate | Drives E2/E3/G |
| P3 (minor) | `publish.sh` "always exits 0" swallows errors | Do **not** carry into the rewrite (fail-loud) |
| P4 (nit) | juejin/qiita/xhs/infoq specifics unverified | Confirm per-target at G decomposition |

**Residual risk:** Low for E (Surfdash = no-auth file/CLI, fully testable); higher for browser targets in G, mitigated by the transport abstraction.
**Disposition:** E1 answered HIGH confidence. **E2/E3 unblocked; G is mappable.** Approved to close.
### References
- `~/projects/cc-agents/plugins/wt/skills/publish-to-*` and `scripts/` — source under audit
- `~/xprojects/surfdash` — the Surfdash publish target
- Features: E1 (this gate) · E / E2 / E3 · G (rewrite epic)
- Project memory: `wt-plugin-untested`
### History
- 2026-07-23T23:37:19.615Z todo → wip (system)
- 2026-07-23T23:40:08.995Z wip → done (system)
