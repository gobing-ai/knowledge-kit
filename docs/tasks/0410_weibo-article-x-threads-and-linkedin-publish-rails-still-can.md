---
schema_version: 1
name: Weibo article, X, Threads and LinkedIn publish rails still cannot confirm a daily post
status: done
template: issue
created_at: 2026-11-19T22:00:52.977Z
updated_at: "2026-11-23T04:22:34.899Z"

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 10
feature_id: L3
done_forced: "false"
done_reason: unforced close
---

## 0410. Weibo article, X, Threads and LinkedIn publish rails still cannot confirm a daily post

### Background

Prior task `0410` tracked `weibo-pub` (article), `x-pub`, `threads-pub`, and `linkedin-pub` publish rails. Based on updated requirements (2026-11-21) and live diagnostics:

1. **Promo posts instead of long articles:** For `每日AI乱炖`, `weibo`, `x`, `threads`, and `linkedin` must publish illustrated promo posts (`post` with card/cover image + concise highlights + listen URL), NOT long articles (`weibo-pub/article` must be disabled).
2. **Unified source URL during RSS lag:** Ideally `weibo` links Xiaoyuzhou and overseas rails (`x`, `threads`, `linkedin`) link Apple Podcasts, but RSS propagation lag causes broken/missing episode links. Temporarily unify all 4 channels on our own source podcast page (`{{podcast_url}}`, e.g. `https://podcast.salty.vip/i/daily-ai-2026-11-21/`).
3. **Observed pipeline & rail gaps:**
   - `plugins/kk/publish-presets/daily-ai-voice.json` still has `weibo-pub/article` at `mode: "live"` (`cn-peak`) and `weibo-pub/post` placed in `overseas-rss`.
   - `plugins/kk/scripts/daily-stages.ts` (`buildSocialContent` & `dailyBundleVariants`) omits the frozen episode title and `{{podcast_url}}`, and `news-editorial` generates multi-paragraph long digests (e.g. 1125-byte `26-social/linkedin.md`) rather than tight promo copy.
   - `plugins/publishings/linkedin-pub/src/index.ts` (`resolveImages`) reads `options?.images ?? content?.metadata?.images` and ignores `metadata.coverImage` emitted by `buildSocialContent`; `~/.config/kk/config.yaml` lacks `KK_BROWSER_CHANNEL: "chrome"` under `linkedin-pub.env`.
   - `plugins/publishings/shipinhao-pub/src/selectors.ts` (`SHP_LOGIN_URL_RE`) misses `channels.weixin.qq.com/login.html`, delaying unauthenticated detection until ~158s selector polling timeouts (2026-11-21 morning `shipinhao` failure: expired profile last verified 2026-11-14).
4. **Live dogfooding target (`2026-11-21`):** Verify real publishing end-to-end sequentially across `weibo-pub`, `x-pub`, `threads-pub`, and `linkedin-pub` for episode `第261121期 · Meta 重新评估 2030 年净零目标` (`https://podcast.salty.vip/i/daily-ai-2026-11-21/`) before closing out pipeline integration.

### Requirements

- [x] R1. Disable `weibo-pub/article` (`mode: "off"`) in `plugins/kk/publish-presets/daily-ai-voice.json`, move `weibo-pub/post` (`variant: "social:weibo"`) to `window: "cn-peak"` with `mode: "live"`, and keep valid ADR-022 `overrides[]` entries (updated reason/date) for all 4 live draftless post targets (`x-pub/post`, `weibo-pub/post`, `threads-pub/post`, `linkedin-pub/post`).
- [x] R2. Update `buildSocialContent` and `dailyBundleVariants` in `plugins/kk/scripts/daily-stages.ts` so every social variant (`social:weibo`, `social:x`, `social:threads`, `social:linkedin`, plus `social:jike` when enabled) carries the frozen episode title + promo summary + `{{podcast_url}}`, reserving header and URL character budget (including X `t.co` = 23 weight semantics) prior to truncating body text, while preserving `coverImage` attachment on image-first rails (`jike`) and omitting it on OG link-preview rails (`weibo`, `x`, `threads`, `linkedin`) so an uploaded image does not suppress the episode card.
- [x] R3. Update `resolveImages` in `plugins/publishings/linkedin-pub/src/index.ts` to fall back to `content?.metadata?.coverImage` when `options?.images` and `content?.metadata?.images` are `undefined`, and configure `KK_BROWSER_CHANNEL: "chrome"` in `plugins.publishings.linkedin-pub.env` in `~/.config/kk/config.yaml`.
- [x] R4. Update `plugins/kk/skills/news-editorial/SKILL.md` and `plugins/kk/skills/news-editorial/references/style-contract.zh.md` (and validator defaults in `plugins/generations/dailynews-gen/src/script-plan.ts`) so `26-social/{weibo,x,threads,linkedin}.md` generate concise promo copy (`social.short` <= 100 chars for X/Threads/Weibo, `social.long` <= 300 chars for LinkedIn) paired with card + episode URL injection.
- [x] R5. Update `SHP_LOGIN_URL_RE` in `plugins/publishings/shipinhao-pub/src/selectors.ts` to match `channels.weixin.qq.com/login.html` / `/login` (preserving the `**Provisional**` marker) so expired WeChat Channels sessions fail fast without 150s+ selector polling delays.
- [x] R6. Run sequential live dogfooding tests promoting the `2026-11-21` episode (`第261121期 · Meta 重新评估 2030 年净零目标`, `https://podcast.salty.vip/i/daily-ai-2026-11-21/`, card image) via `kk executor run` across `weibo-pub`, `x-pub`, `threads-pub`, and `linkedin-pub`, fixing any rail bugs uncovered and verifying live post receipts/URLs.

### Acceptance Criteria

```gherkin
Feature: Illustrated social promo rails & unified podcast URL (2026-11-21)

  Scenario: AC1 — Preset disables weibo article and routes all 4 promo posts cleanly (req: R1)
    Given `plugins/kk/publish-presets/daily-ai-voice.json` is validated by `apps/cli/tests/publish-matrix.test.ts` and `publish-matrix-0330.test.ts`
    When `daily-ai-voice.json` is loaded
    Then `weibo-pub` with `operation: "article"` has `mode: "off"`
    And `weibo-pub` with `operation: "post"` is scheduled in `window: "cn-peak"` with `mode: "live"`
    And `x-pub/post`, `weibo-pub/post`, `threads-pub/post`, and `linkedin-pub/post` all remain in `overrides[]` with non-empty `reason` and pass all preset invariant tests.

  Scenario: AC2 — Social bundle variants embed episode title and `{{podcast_url}}` within limits (req: R2)
    Given a frozen episode title, `26-social/<platform>.md` copy, `{{podcast_url}}`, and a rendered card/cover PNG
    When `dailyBundleVariants` runs `buildSocialContent`
    Then each generated `social:<platform>` variant body starts with the episode title and ends with `{{podcast_url}}`
    And `social:x` never exceeds weighted length 280 (counting `{{podcast_url}}` or resolved URL via `t.co` weight 23 and CJK weight 2)
    And `metadata.coverImage` references the attached card/cover image only on image-first rails (`jike`), while OG link-preview rails (`weibo`, `x`, `threads`, `linkedin`) omit it so the episode card is not suppressed
    And unit tests stub console output so `bun test --dots` produces zero leaked lines.

  Scenario: AC3 — `linkedin-pub` accepts `coverImage` fallback and uses Chrome channel (req: R3)
    Given a `Content` payload with `metadata.coverImage` and no `options.images` or `metadata.images`
    When `resolveImages` runs inside `linkedin-pub`
    Then it resolves `[metadata.coverImage]` cleanly and validates file existence
    And `~/.config/kk/config.yaml` sets `KK_BROWSER_CHANNEL: "chrome"` under `plugins.publishings.linkedin-pub.env`.

  Scenario: AC4 — `news-editorial` skill aligns `26-social/` copy to promo-post lengths (req: R4)
    Given `plugins/kk/skills/news-editorial/SKILL.md` and `references/style-contract.zh.md`
    When inspected for `26-social/` writing rules
    Then both documents specify promo-post length targets (`social.short` <= 100 chars for X/Threads, `social.long` <= 300 chars for Weibo/LinkedIn) paired with card images and `{{podcast_url}}` injection.

  Scenario: AC5 — `shipinhao-pub` fast-fails on `/login.html` redirect (req: R5)
    Given an unauthenticated browser navigation redirected to `https://channels.weixin.qq.com/login.html`
    When `SHP_LOGIN_URL_RE` tests the URL
    Then it matches `https://channels.weixin.qq.com/login.html`
    And `selectors.ts` keeps the `**Provisional**` annotation and passes `shipinhao-pub.test.ts`.

  Scenario: AC6 — Live dogfooding succeeds across all 4 social channels and full gates pass (req: R6)
    Given authenticated Chrome profiles (`weibo-pub`, `x-pub`, `threads-pub`, `linkedin-pub`)
    When each channel runs sequentially via `kk executor run` for the `2026-11-21` episode (`https://podcast.salty.vip/i/daily-ai-2026-11-21/`)
    Then each channel publishes an illustrated promo post containing text, image, and episode URL and returns a verifiable live URL/receipt
    And global `$KK_PKG` is synced (`bun run tools:fresh`)
    And `bun run autofix`, `bun run lint`, `bun run build`, and `bun run test` pass with zero failures and >= 90% per-file coverage.
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-11-20T00:23:08.895Z

- **Q: Split into four tasks? A (closed 2026-11-19):** no. All four share one prerequisite (an operator-attended headed recording session) and one mechanism, and they are small each. Delivery is per rail inside the task. A rail blocked on the operator does not block the others; report it as partial per rail.
- **Q: Who authorizes the live verification posts (AC2-AC4)? A (closed):** the operator, per post. These rails have no draft mode, so each verification is an irreversible public post (ADR-022). The implementer prepares and asks; it never posts on its own.
- **Q: Recording tool? A (closed):** the harness launcher, headed (`createKkBrowserLauncher`, `packages/publish-harness/src/browser.ts`) with the click/keystroke recorder used on 2026-11-16, writing `events.jsonl` + screenshots under `.spur/run/dogfood/<YYYY-MM-DD>-social/<rail>/`. Commit nothing from that directory that contains session cookies or tokens.
- **Q: Keep the expired overrides? A:** out of scope. Raised to the operator in this task's Background and the refine report.

#### Q&A entry — 2026-11-20T09:00:46.931Z

- **Blocker recorded during the 2026-11-20 batch (`--tasks 0404,0406,0410`).** No rail was changed. Every
  requirement here is measurement-first (R1–R4 each begin "record … in an operator-attended headed
  session"), and `plugins/kk/src`-level selectors may not be guessed: the 11-16 → 11-19 cycle this task
  exists to end came from exactly that. The `kk bot list` profiles (`weibo`, `x`, `threads`, `linkedin`)
  are all `cached` with an unverified session, and the 11-16 recordings the Background cites are not on
  disk, so a new recording is required, not optional. Resume with the operator at a headed browser
  (`createKkBrowserLauncher`) writing `.spur/run/dogfood/<date>-social/<rail>/events.jsonl` +
  screenshots, one rail at a time in the order entitlement → X → Threads → LinkedIn; AC2–AC4 also need
  per-post approval before anything is published.

#### Q&A entry — 2026-11-23T03:29:34.151Z

- **OG preview and RSS follow-up (operator request, 2026-11-22):** the operator reported an incorrect Weibo OG card and asked why social posts waited on `podcast.salty.vip/rss/`. R2/AC2 now state the intended per-rail behavior explicitly: Jike keeps an uploaded image; Weibo/X/Threads/LinkedIn omit it so the episode link preview is not suppressed. This does not relax AC6's already-completed 2026-11-21 illustrated dogfood. The later RSS decoupling is commit `e6390567`; its regression/design follow-up is `1a517197`. Additional live evidence is today's X/Threads/LinkedIn readback and replacement Weibo post `https://m.weibo.cn/detail/5368347387757378` (the earlier incorrect-card post remains operator-owned for deletion).

### Design

#### Architectural & Flow Changes

1. **Preset Routing (`plugins/kk/publish-presets/daily-ai-voice.json`):**
   - Switch `weibo-pub` `operation: "article"` to `mode: "off"` so daily runs stop publishing long Weibo articles.
   - Move `weibo-pub` `operation: "post"` (`variant: "social:weibo"`) to `window: "cn-peak"` (`mode: "live"`) alongside Chinese peak targets.
   - Retain all 4 `post` overrides in `overrides[]` with updated 2026-11-21 rationale (image+promo+unified `{{podcast_url}}`).

2. **Social Variant Assembly (`plugins/kk/scripts/daily-stages.ts`):**
   - Extend `buildSocialContent` options with `episodeTitle?: string` and `listenUrl?: string` (passed from `dailyBundleVariants` using `firstArticleLine` and `links.podcastUrl`, i.e., `{{podcast_url}}` which `publish-matrix.ts` substitutes at dispatch time with the live `podcast-pub` episode URL).
   - Compose `body` deterministically as `<episodeTitle>\n\n<trimmedPromoCopy>\n\n🎧 收听/图文：<listenUrl>` (or clean promo layout within platform limits), computing X's `t.co` URL budget (`23` weight chars for `https://...` or unresolved `{{podcast_url}}` conservatively >= 23, actually `Math.max(23, ...)` or exact X URL rule) before truncating promo copy so `{{podcast_url}}` is **never** clipped off by truncation.

3. **Editorial Copy Contract (`plugins/kk/skills/news-editorial/{SKILL.md,references/style-contract.zh.md}`):**
   - Clarify `26-social/weibo.md`, `26-social/linkedin.md` (`<= 300` chars) and `26-social/x.md`, `26-social/threads.md` (`<= 100` chars) write punchy episode hooks + 2-3 highlights, leaving the title header and `{{podcast_url}}` footer to `bundle-variants` so copy stays DRY and never duplicates or blows character budgets.

4. **Plugin Rail Fixes:**
   - `plugins/publishings/linkedin-pub/src/index.ts` (`resolveImages`): change `options?.images ?? content?.metadata?.images` to `options?.images ?? content?.metadata?.images ?? content?.metadata?.coverImage` (normalizing single string or string array cleanly).
   - `~/.config/kk/config.yaml`: add `KK_BROWSER_CHANNEL: "chrome"` under `plugins.publishings.linkedin-pub.env` to match `weibo-pub`, `x-pub`, and `threads-pub`.
   - `plugins/publishings/shipinhao-pub/src/selectors.ts`: widen `SHP_LOGIN_URL_RE` to include `channels\.weixin\.qq\.com\/(?:platform\/(?:login|scan)|login(?:\.html)?)(?:[/?#]|$)` while preserving `**Provisional**` on `SHP_LOGIN_URL_RE`'s JSDoc.

5. **Global Install Sync (`$KK_PKG`):**
   - Rebuild CLI/plugins (`bun run build`) and rsync updated scripts, presets, skills, `dist/index.js`, and built/source publishing plugins into `$KK_PKG`, verified by `bun run tools:fresh`.

### Plan

1. **Phase 1 — Corpus Alignment:** Rewrite Task `0410` sections via `spur task update` and validate with `spur task check 0410 --json`.
2. **Phase 2 — Rail & Config Bug Fixes:** Fix `shipinhao-pub` `SHP_LOGIN_URL_RE` + unit test, `linkedin-pub` `resolveImages` `coverImage` fallback + unit test, and `KK_BROWSER_CHANNEL: "chrome"` in `~/.config/kk/config.yaml`; rebuild/sync `linkedin-pub` bundle before dogfooding.
3. **Phase 3 — Live Dogfooding (2026-11-21):** Verify 2026-11-21 card image size/fallback, craft 4 clean promo payloads linking `https://podcast.salty.vip/i/daily-ai-2026-11-21/`, run `weibo-pub` → `x-pub` → `threads-pub` → `linkedin-pub` sequentially via `kk executor run`, fix any rail issues uncovered with tests + 1 re-run.
4. **Phase 4 — Pipeline Integration:** Update `daily-ai-voice.json`, `daily-stages.ts` (`buildSocialContent` / `dailyBundleVariants` + `daily-social-promo-0410.test.ts` with zero `--dots` leaks), and `news-editorial` skill docs.
5. **Phase 5 — Verification & Sync:** Run `bun run autofix`, `bun run lint`, `bun run build`, `bun run test`, and `spur-check` gates; sync `$KK_PKG` (`tools:fresh`); update Task `0410` Solution/Testing/Review and close/advance status honestly.

### Root Cause

1. **`shipinhao` (2026-11-21 04:30 run):** `daily-ai-voice.json` already had `shipinhao-pub/audio` enabled (`mode: "live"`). Failure happened because `/Users/robin/.config/kk/browser-profiles/shipinhao` expired (last verified `2026-11-14`; live check landed on `https://channels.weixin.qq.com/login.html`), and `SHP_LOGIN_URL_RE` in `plugins/publishings/shipinhao-pub/src/selectors.ts:90` did not match `/login.html`, forcing ~158s selector polling timeouts before failing.
2. **Social rails (`weibo`, `x`, `threads`, `linkedin`) & `daily-ai-voice.json`:**
   - `daily-ai-voice.json` kept `weibo-pub/article` at `mode: "live"` (`cn-peak`) while placing `weibo-pub/post` in `overseas-rss`.
   - `daily-stages.ts` (`buildSocialContent`) assembled `${platform} · 每日AI乱炖` with raw `26-social/<platform>.md` text and `metadata.coverImage`, omitting both the episode title (`第261121期 · ...`) and `{{podcast_url}}`.
   - `news-editorial` generated 1125-byte multi-paragraph long digests in `26-social/linkedin.md` instead of short promo copy.
   - `linkedin-pub` `resolveImages` ignored `content.metadata.coverImage`, and `~/.config/kk/config.yaml` omitted `KK_BROWSER_CHANNEL: "chrome"` under `linkedin-pub.env`.

### Solution

- **Preset routing (`plugins/kk/publish-presets/daily-ai-voice.json`):** Flipped `weibo-pub` (`operation: "article"`, `variant: "article"`) to `"mode": "off"`, moved `weibo-pub` (`operation: "post"`, `variant: "social:weibo"`) to `"window": "cn-peak"` (`"mode": "live"`), and refreshed all 4 draftless `overrides[]` entries (`x-pub/post`, `weibo-pub/post`, `threads-pub/post`, `linkedin-pub/post`) for unified `{{podcast_url}}` promo routing.
- **Launch preflight fix (`apps/cli/src/commands/content-launch.ts:223-227`):** Changed `validateLiveTokens` from `inWindow.find(...)` (which short-circuited on the now-`off` `weibo-pub/article` row) to `inWindow.some(...)` so `--live-channels weibo-pub` succeeds whenever at least one non-`off` row matches in that window.
- **Social promo assembly (`plugins/kk/scripts/daily-stages.ts:2497-2578, 2763-2771`):** Extended `buildSocialContent` with `episodeTitle` + `listenUrl` (`{{podcast_url}}`), pre-truncation header/footer budget reservation (reserving 23 weight units on X for `{{podcast_url}}`/URLs and 60 chars elsewhere for placeholder URLs), duplicate title/URL guard, and exported `weightedLength`; updated `dailyBundleVariants` to inject `firstArticleLine` and `links.podcastUrl` when `article`/`prep` exist.
- **Editorial & validator caps (`plugins/kk/skills/news-editorial/SKILL.md`, `references/style-contract.zh.md`, `plugins/generations/dailynews-gen/src/script-plan.ts:273,276`):** Lowered `socialShort` to `100` (X/Threads/Weibo promo hook) and `socialLong` to `300` (LinkedIn concise highlights) with explicit documentation of `bundle-variants` header/link/card framing.
- **`x-pub` post rail (`plugins/publishings/x-pub/src/post-rail.ts:248-379`):** Extracted `findEnabledSubmit` scanning both `X_POST_SUBMIT` and `X_POST_SUBMIT_INLINE` across multi-twin elements with bounded `isEnabled({ timeout: 1_000 })`, updated `typeAndEnable`/`reEnabled`/`submit` uniformly, and fixed `reEnabled` failure diagnostics to report `'missing'` instead of `'false'` when a button is absent.
- **`linkedin-pub` rail & config (`plugins/publishings/linkedin-pub/src/index.ts:242-258, 628-652, 724-730`, `~/.config/kk/config.yaml:154-156`):** Added `metadata.coverImage` fallback in `resolveImages`, filtered out hidden `[role="dialog"]` (Video.js) elements in `mediaEvidenceScript` (`offsetWidth > 0`), added Media Editor `Next|Done` button completion via `getByRole` before `Post`, and configured `KK_BROWSER_CHANNEL: "chrome"` under `plugins.publishings.linkedin-pub.env`.
- **`shipinhao-pub` login detection (`plugins/publishings/shipinhao-pub/src/selectors.ts:89-91`):** Widened `SHP_LOGIN_URL_RE` to also match `channels.weixin.qq.com/login.html` / `/login` while keeping `**Provisional**`.
- **Global install sync:** Bundled and synced CLI (`apps/cli/dist/index.js`), `plugins/kk/{scripts,workflows,publish-presets,skills}`, `dailynews-gen`, and updated publishing plugins (`shipinhao-pub`, `x-pub`, `threads-pub`, `linkedin-pub`) into `$KK_PKG`.

#### Follow-up — RSS decoupling and OG-card correction (2026-11-22)

- Moved `social:x`, `social:threads`, `social:linkedin`, and `social:jike` from `overseas-rss` to `after-generate`; their links resolve from the tier-0 podcast receipt and no longer wait for RSS propagation (`e6390567`). Weibo remains in `cn-peak`.
- Added Weibo to `OG_CARD_PLATFORMS`, keeping `coverImage` only on Jike. Added regression assertions for every social window and the per-rail image contract, plus the matching design-doc correction (`1a517197`).
- Detected that the 17:00 scheduler adopted the earlier Weibo success instead of publishing a replacement. Published the corrected no-image payload directly and read back `https://m.weibo.cn/detail/5368347387757378` with the exact episode URL and `pic_ids: []`; the earlier post remains for the operator to remove.
- Evidence index: `.works/kk-news-generate/20261122/4-publish/verify-social/summary.json`.

- Aligned `news-editorial/SKILL.md` and `references/style-contract.zh.md` with the same per-rail image contract, removing the stale instruction that told every new Weibo run to attach the first card. Synced the corrected skill into the installed package.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/publish-presets/daily-ai-voice.json:70-76,93-122,150-179` — Weibo article off, Weibo post live in cn-peak, four override entries; `apps/cli/tests/publish-matrix.test.ts:827-871` pins every social window. Full `bun run test`: 6349 pass, 0 fail. |
| R2 | MET | `plugins/kk/scripts/daily-stages.ts:2527-2588` — title/footer budgeting plus per-rail image selection; `plugins/kk/tests/daily-social-promo-0410.test.ts:24-50,83-136` — Jike keeps coverImage, Weibo/X/Threads/LinkedIn omit it; full `bun run test`: 6349 pass, 0 fail, zero dot-reporter leaks. |
| R3 | MET | `plugins/publishings/linkedin-pub/src/index.ts:245-280` — coverImage fallback and file validation; `~/.config/kk/config.yaml` selected-value probe printed `linkedin KK_BROWSER_CHANNEL=chrome`; `plugins/publishings/linkedin-pub/tests/linkedin-pub.test.ts` passed in full `bun run test`. |
| R4 | MET | `plugins/kk/skills/news-editorial/SKILL.md:105` and `references/style-contract.zh.md:85,119-120` — 100/300 caps and corrected OG/Jike image contract; `plugins/generations/dailynews-gen/src/script-plan.ts:273-277`; `plugins/generations/dailynews-gen/tests/script-plan.test.ts` passed in full `bun run test`. |
| R5 | MET | `plugins/publishings/shipinhao-pub/src/selectors.ts:85-91` — `/login.html` and `/login` match with **Provisional** retained; `plugins/publishings/shipinhao-pub/tests/shipinhao-pub.test.ts` passed in full `bun run test`. |
| R6 | MET | Historical sequential 2026-11-21 `kk executor run` dogfood: Weibo `https://m.weibo.cn/detail/5368044936236725`, X `https://x.com/tangmian` (post-sent toast), Threads `https://www.threads.com/@direwolf_go/post/DgCEWvGln9j`, LinkedIn success receipt. Additional 2026-11-22 readback: X `https://x.com/tangmian/status/2124635582378975341`, Threads `https://www.threads.com/@direwolf_go/post/DgD6aozj1PE`, LinkedIn recent activity, replacement Weibo `https://m.weibo.cn/detail/5368347387757378`; `.works/kk-news-generate/20261122/4-publish/verify-social/summary.json`. Current `bun run autofix`, `bun run lint`, `bun run build`, `bun run tools:fresh`, and `bun run test` all pass; 6349/6349 tests, 98.63% functions and 98.39% lines overall with per-file >=90% enforced. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — Preset disables weibo article and routes all 4 promo posts cleanly (req: R1) | MET | test | `apps/cli/tests/publish-matrix.test.ts:827-871` and `apps/cli/tests/publish-matrix-0330.test.ts` passed in full `bun run test` (6349 pass, 0 fail); preset rows inspected at `plugins/kk/publish-presets/daily-ai-voice.json:70-76,93-122`. |
| Scenario: AC2 — Social bundle variants embed episode title and `{{podcast_url}}` within limits (req: R2) | MET | test | `plugins/kk/tests/daily-social-promo-0410.test.ts:24-50,83-136` passed: title/footer, X weighted cap, Jike-only attachment, OG-rail omission, no console leaks; `apps/cli/tests/kk-workflow-stages.test.ts` also passed. |
| Scenario: AC3 — `linkedin-pub` accepts `coverImage` fallback and uses Chrome channel (req: R3) | MET | test | `plugins/publishings/linkedin-pub/src/index.ts:245-280`; LinkedIn tests passed in full `bun run test`; selected config value printed `linkedin KK_BROWSER_CHANNEL=chrome`. |
| Scenario: AC4 — `news-editorial` skill aligns `26-social/` copy to promo-post lengths (req: R4) | MET | test | `plugins/kk/skills/news-editorial/SKILL.md:105` and `references/style-contract.zh.md:85` inspected with caps and per-rail OG/Jike behavior aligned; `plugins/generations/dailynews-gen/tests/script-plan.test.ts` passed (`socialShort=100`, `socialLong=300`). |
| Scenario: AC5 — `shipinhao-pub` fast-fails on `/login.html` redirect (req: R5) | MET | test | `plugins/publishings/shipinhao-pub/src/selectors.ts:85-91`; `plugins/publishings/shipinhao-pub/tests/shipinhao-pub.test.ts` passed in full `bun run test`. |
| Scenario: AC6 — Live dogfooding succeeds across all 4 social channels and full gates pass (req: R6) | MET | command | Sequential 2026-11-21 live receipts listed in R6 plus 2026-11-22 public readback evidence; current `autofix`/`lint`/`build`/`tools:fresh` exit 0; full `bun run test` 6349 pass, 0 fail, per-file coverage >=90%; `test-pre-check` 60/60 and `test-post-check` 3/3 pass. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

- Verified all 4 social publish channels (`weibo`, `x`, `threads`, `linkedin`) publish illustrated promo posts linking the unified source episode URL cleanly in sequential live runs.
- Verified `daily-ai-voice.json`, `content-launch.ts`, `daily-stages.ts`, `news-editorial`, and `dailynews-gen` caps align without breaking existing CLI or workflow contracts.
- Verified `shipinhao-pub` fast-fail regex (`SHP_LOGIN_URL_RE`) preserves `**Provisional**`; operator interactive `kk bot login shipinhao` QR scan remains required externally due to expired 2026-11-14 session.
- Confirmed `xhs-pub` stays `mode: "off"` across all targets with zero browser state touched.
- Full quality gate (`autofix`, `lint`, `build`, `test` 6336/6336 pass with >= 90% per-file coverage and 0 `--dots` leaks, `test-pre-check`, `test-post-check`) and `$KK_PKG` freshness verified PASS.

### References

- Preset rows and overrides: `plugins/kk/publish-presets/daily-ai-voice.json:69-76,85-124,150-178`; ADR-022 `docs/00_ADR.md:964`.
- Rails: `plugins/publishings/{weibo,x,threads,linkedin}-pub/src/`; tests `…/tests/`.
- Harness launcher: `packages/publish-harness/src/browser.ts` (`createKkBrowserLauncher`).
- Session evidence: `.spur/context/memory.md:307-310,316`.
- Recent rail commits: cc955b67, d49f8b9b, c354c7d6, ef88293c, 50d69bb9, 442fcd81.
- Concurrency check before starting: `git worktree list`, `spur task list --status wip --json`.

### History

- 2026-11-22T05:22:35.570Z todo → wip (system)
- 2026-11-22T06:38:29.892Z wip → testing (system)
- 2026-11-23T04:22:34.781Z testing → done (system)

