# Surfdash candidate validation — `786652f`

Date: 2026-11-02 (America/Los_Angeles)

## Candidate identity

- Worktree: `/tmp/surfdash-candidate-latest-SD1WO5`
- Base: `8d5f794` (`feat: cover + podcast cross-link for 20261102-ai-2026-11-02`)
- SEO/content repair: `21505ad` (`fix: keep digest SEO within locale parity bounds`)
- Astro syntax repair: `786652f` (`fix: restore Astro article route typecheck`)
- Worktree was clean after commit; no push or deployment was performed.

## Gate results

| Command | Result |
| --- | --- |
| `bun install --frozen-lockfile` | PASS; Bun 1.3.14, 1,803 packages |
| `bun run lint` | PASS; Biome + Astro check, 0 errors/warnings/hints |
| `bun run test-pre-check` | PASS; 7 rules |
| `bun run check:all` | PASS; 83 digest posts, 86 body files, 86 SEO files |
| `bun run sd check digest` | PASS; 83 digest posts valid |
| `bun run check:seo --lastmod-base origin/main` | PASS; 86 disk files clean |
| `bun run test --reporter=dot` | PASS; 85 files, 1,380 tests |
| `bun run test-post-check` | PASS; 3 rules |
| `bun run build` | PASS; Astro/Cloudflare server build completed |

The build generated local output under `/tmp/surfdash-candidate-latest-SD1WO5/surfdash/dist/`.
The initial symlinked-dependency build failure was discarded; the passing build used the exact
workflow install (`bun install --frozen-lockfile`).

## Build environment names

The build command supplied these CI public environment variable names with sanitized local values;
no secret value is recorded here:

`PUBLIC_ZITADEL_AUTHORITY`, `PUBLIC_ZITADEL_ORG_ID`, `PUBLIC_ZITADEL_CLIENT_ID`,
`PUBLIC_ZITADEL_REDIRECT_URI`, `PUBLIC_ZITADEL_POST_LOGOUT_URI`, `PUBLIC_ZITADEL_IDP_GOOGLE`,
`PUBLIC_ZITADEL_IDP_GITHUB`, `PUBLIC_ZITADEL_IDP_APPLE`, `PUBLIC_ZITADEL_IDP_MICROSOFT`,
`PUBLIC_TURNSTILE_API_URL`, `PUBLIC_APPLICATION_ID`.

Expected non-failing output: historical digest warnings and one Biome informational
`noUselessStringRaw` notice in the pre-existing `scripts/lib/seo-digest.ts` corpus.
