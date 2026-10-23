# podcast-pub

Publish a podcast episode to a self-hosted microfeed 1.0.13 instance, and repair
SEO fields on episodes that are already there.

Credentials: `MICROFEED_BASE_URL`, `MICROFEED_API_KEY`. Optional
`MICROFEED_TIMEOUT_MS` (default 300000).

## Operations

`options.operation` selects the call. The default is `publish`.

| Operation | What it does |
| --------- | ------------ |
| `publish` | Create or upload an episode. A pattern slug is sent only on the first create. |
| `show-notes` | Render plan `Doc[]` to markdown. No network. A bare JSON array `--in` selects this. |
| `list` / `get` / `update` / `delete` | Feed and item management. |
| `validate` | `POST /api/v1/items/validate`. |
| `backfill-seo` | Fill `_microfeed.seo` and missing iTunes numbers. **Dry-run unless `apply` is set.** |

`backfill-seo` options:

| Key | Default | Effect |
| --- | ------- | ------ |
| `apply` | false | `true` / `"true"` / `"1"` sends the PUTs |
| `since` / `until` | unset | Inclusive `YYYY-MM-DD` window |
| `ids` | unset | Item ids to touch |
| `out` | unset | Write the plan JSON `{ dryRun, items }` |
| `plan` | unset | With `apply`, PUT this reviewed plan instead of recomputing |
| `retitle` | false | Also change the RSS title |
| `rewriteBody` | false | Insert the summary paragraph and move the timeline `<style>` |
| `applySlug` | false | Set `_microfeed.slug` (moves the public URL; a 409 retries as `-2`) |
| `overrides` | unset | `[{ id, title?, titleKeywords?, summaryClauses? }]`. `title` is kept verbatim after sanitising (the 10-06 escape hatch) |

The repair always proposes SEO fields, even when `PODCAST_PUB_SEO=false`.
It does not change `guid`, attachments, `date_published`, `status`, or `url`.

## SEO environment

Item `metadata.podcast.*` wins over these variables. Empty string means unset.
Invalid values fail the run and name the key. The full table and the legacy
combination that reproduces the pre-D9 payload are in `docs/design/podcast-pub.md` (D9).

| Key | Default |
| --- | ------- |
| `PODCAST_PUB_SEO` | `true` |
| `PODCAST_PUB_EPISODE_TITLE_MODE` | `as-is` (`headline` builds `{series} · {date}：{keywords}`) |
| `PODCAST_PUB_EPISODE_TITLE_PATTERN` | `{series} · {date}：{keywords}` |
| `PODCAST_PUB_SERIES_NAME` / `PODCAST_PUB_SHOW_NAME` | `每日AI乱炖` / `咸话咸说` |
| `PODCAST_PUB_TITLE_MAX` / `PODCAST_PUB_TITLE_MAX_KEYWORDS` | `55` / `2` |
| `PODCAST_PUB_SEO_TITLE_SUFFIX` / `PODCAST_PUB_SEO_TITLE_MAX` | `｜咸话咸说` / `60` |
| `PODCAST_PUB_SEO_DESCRIPTION_MIN` / `MAX` / `SOURCE` | `120` / `155` / `plan` |
| `PODCAST_PUB_SUMMARY_PARAGRAPH` | `true` |
| `PODCAST_PUB_TIMELINE_INLINE_STYLE` | `after` (`before` is the old position, `omit` drops the style) |
| `PODCAST_PUB_AUTO_EPISODE_NUMBER` | `true` |
| `PODCAST_PUB_TITLE_SANITIZE` | `normalize` (`reject` fails on `"`, `\`, `<>`, or control characters) |
| `PODCAST_PUB_LINK_FIELD` | `none` (`url` copies `articleUrl` onto the item and warns) |
| `PODCAST_PUB_SLUG` / `PODCAST_PUB_SLUG_PATTERN` | `pattern` / `daily-ai-{date}` |
| `PODCAST_PUB_SOCIAL_IMAGE` | `false` |
| `PODCAST_PUB_ROUND_DURATION` | `true` |

`PODCAST_PUB_TITLE` is the show-notes H1. It is not the episode title pattern.

Do not point this plugin at a live feed from tests. `backfill-seo` against
production is an operator step, after a dry-run plan has been reviewed.
