# Surfdash live deployment verification — 2026-11-02

## Source and CI

- Live checkout HEAD: `786652fc42f2681c90328a1ab136a6698a9cc0e8`
- Remote `main`: `786652fc42f2681c90328a1ab136a6698a9cc0e8`
- GitHub Deploy run: [41592575717](https://github.com/robinmin/surfdash/actions/runs/41592575717)
- Result: PASS in 2m08s — Setup, Gate, Build, Cloudflare Deploy, and cache purge all passed.
- Warm-cache step was intentionally skipped because the repository variable was not enabled.

## Public HTTP checks

All checks were read-only `curl -L` requests after deployment:

| Resource | HTTP | Content type |
| --- | ---: | --- |
| `https://surfing.salty.vip/posts/20261102-ai-2026-11-02` | 200 | `text/html` |
| `https://surfing.salty.vip/zh/posts/20261102-ai-2026-11-02` | 200 | `text/html` |
| `https://surfing.salty.vip/ja/posts/20261102-ai-2026-11-02` | 200 | `text/html` |
| `https://surfing.salty.vip/content-posts/articles/en/20261102-ai-2026-11-02/assets/cover.png` | 200 | `image/png` |
| `https://surfing.salty.vip/content-posts/articles/zh/20261102-ai-2026-11-02/assets/cover.png` | 200 | `image/png` |
| `https://surfing.salty.vip/content-posts/articles/ja/20261102-ai-2026-11-02/assets/cover.png` | 200 | `image/png` |

Each page contained its locale-specific canonical URL and
`https://podcast.salty.vip/i/daily-ai-2026-11-02/` episode link. The deployed pages expose the
podcast media image in `og:image`/`twitter:image`; the article cover assets above are independently
reachable with HTTP 200.

## Live checkout preservation

- Fast-forwarded from `8d5f794` to `786652f` without force.
- Owned four dirty SEO source/test files matched candidate blobs before fast-forward and are now
  represented by the committed history; they were not reapplied.
- Pre-fast-forward patch: `/tmp/surfdash-owned-seo-before-ff-20261102.patch`
- Backup stash: `stash@{0}` (`backup approved SEO files before 786652f fast-forward`)
- Only unrelated pre-existing untracked paths remain: `.claude/`, `scripts/db-mirror-remote.ts`,
  `scripts/fix-site-identity.ts`, `scripts/fix-uat-d1.py`, and `scripts/generate-cheatsheet-pdfs.ts`.
- No CMS repost, podcast resend, workflow edit, environment/dependency edit, or force push.
