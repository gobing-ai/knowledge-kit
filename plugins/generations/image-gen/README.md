# image-gen

Image generation plugin (`kind: generator`): `free`, `cover` and `illustration` jobs over the
`Doc[] → Content` contract. Every image is one **format** (canvas, template, job) composed with one
**style** (visual modifiers); any format pairs with any style.

This page is the preset index: one sample per shipped format × style pair, so you can pick a
combination by eye. Pass the pair as `metadata.imageGen.format` / `metadata.imageGen.style`, or
`--format` / `--style` to the `kk:image-generate` skill. Omitting the style uses the format's
default (★ below).

Samples: provider `minimax`, model `image-01`, downscaled to 640px JPEG. Inputs are fixed per
job — subject “a request flowing through an API gateway to three microservices”; cover title “Building Reliable AI Agents”. Regenerate with
`bun plugins/generations/image-gen/scripts/gen-samples.ts` (see its header for flags).

## Formats

| Format | Job | Aspect | Size | Default style | Description |
| --- | --- | --- | --- | --- | --- |
| [`cover`](#format-cover) | cover | 21:9 | 1344×576 | vibrant | Article cover image template (21:9 ultrawide cinematic aspect ratio) |
| [`daily-news-cover`](#format-daily-news-cover) | cover | 21:9 | 1344×576 | daily-news | Daily AI tech-sharing episode cover — fixed composition and palette; subject is the only per-run input |
| [`daily-news-podcast-cover`](#format-daily-news-podcast-cover) | cover | 21:9 | 1344×576 | quasi-news-podcast | Daily AI quasi-news podcast episode cover — fixed ultrawide composition with lower-third negative space for headline text |
| [`free`](#format-free) | free | 1:1 | 1024×1024 | vibrant | General-purpose image generation template with rich art direction defaults |
| [`illustration`](#format-illustration) | illustration | 4:3 | 1152×864 | technical-diagram | Article illustration template for inline images (4:3 aspect ratio) |
| [`xhs-card`](#format-xhs-card) | free | 3:4 | 1080×1440 | xhs-knowledge | Xiaohongshu (XHS) knowledge card — 3:4 portrait card. Chinese headline and bullets are typeset from Noto Sans SC via headless Chromium; the provider prompt is the illustration only and must not ask for writing. Adapted from baoyu-xhs-images (MIT © Jim Liu); see plugins/kk/skills/xhs-images/references/card-layouts.md. |

## Styles

| Style | Description | Best for |
| --- | --- | --- |
| `clean-webapp-ui` | Clean light-mode web-app interface — neutral near-white surfaces, card grid, restrained steel-blue and warm-tan accents on an ink text base. | productivity-tool interfaces, dashboards, knowledge-base and bookmark apps, clean SaaS pages |
| `cute` | Sweet, playful aesthetic with pastel colors and rounded forms. Kawaii-influenced with soft gradients, gentle curves, and approachable design. Highly engaging on social platforms targeting younger demographics. |  |
| `daily-news` | House style for the kk-daily-ai-voice cover series — flat editorial vector, navy/blue/amber |  |
| `editorial` | Sophisticated, magazine-quality design with strong typography presence and deliberate composition. High-contrast with bold design choices. Communicates authority, expertise, and premium quality. |  |
| `fresh` | Clean, natural aesthetic with bright whites and green-toned accents. Evokes clarity, health, and new beginnings. Light and airy with generous whitespace. |  |
| `minimalist` | Simple, clean aesthetic with plenty of whitespace. Focus on essential elements with subtle colors and elegant composition. Less is more — every element serves a purpose. |  |
| `photorealistic` | Highly detailed, realistic images with professional photography quality. Natural lighting, realistic textures, and cinematic depth create convincing photographic results. |  |
| `quasi-news-podcast` | House style for quasi-news podcast cover — editorial documentary photography, dramatic contrast, deep navy/slate shadows |  |
| `sketch` | Hand-drawn, artistic feel with organic lines and pencil drawing aesthetic. Warm and approachable with natural imperfections that convey authenticity and human touch. |  |
| `technical-diagram` | Clean, technical illustrations with precise lines and professional diagram style. Minimal color palette focused on clarity and technical accuracy. Communicates complexity with visual simplicity. |  |
| `vibrant` | Bold colors and high contrast for eye-catching visuals. Energetic and dynamic composition designed to grab attention. Maximum visual impact with saturated hues and dramatic lighting. |  |
| `warm` | Cozy, friendly aesthetic with warm color temperature and inviting atmosphere. Evokes comfort, trust, and approachability. Popular on lifestyle and social media platforms. |  |
| `xhs-knowledge` | Notion-like knowledge card aesthetic for XHS image-text series — simple light background, clean information layout, soft accent colors, rounded card zones. Adapted from baoyu-xhs-images "knowledge card" style guidance (MIT © Jim Liu); see plugins/kk/skills/xhs-images/references/card-layouts.md. |  |

## Gallery

<a id="format-cover"></a>

### cover

cover job · 21:9 · default style `vibrant`

| | | |
| --- | --- | --- |
| <img src="assets/sample/cover__clean-webapp-ui.jpg" alt="cover × clean-webapp-ui" width="260"><br>`clean-webapp-ui` | <img src="assets/sample/cover__cute.jpg" alt="cover × cute" width="260"><br>`cute` | <img src="assets/sample/cover__daily-news.jpg" alt="cover × daily-news" width="260"><br>`daily-news` |
| <img src="assets/sample/cover__editorial.jpg" alt="cover × editorial" width="260"><br>`editorial` | <img src="assets/sample/cover__fresh.jpg" alt="cover × fresh" width="260"><br>`fresh` | <img src="assets/sample/cover__minimalist.jpg" alt="cover × minimalist" width="260"><br>`minimalist` |
| <img src="assets/sample/cover__photorealistic.jpg" alt="cover × photorealistic" width="260"><br>`photorealistic` | <img src="assets/sample/cover__quasi-news-podcast.jpg" alt="cover × quasi-news-podcast" width="260"><br>`quasi-news-podcast` | <img src="assets/sample/cover__sketch.jpg" alt="cover × sketch" width="260"><br>`sketch` |
| <img src="assets/sample/cover__technical-diagram.jpg" alt="cover × technical-diagram" width="260"><br>`technical-diagram` | <img src="assets/sample/cover__vibrant.jpg" alt="cover × vibrant" width="260"><br>`vibrant` ★ | <img src="assets/sample/cover__warm.jpg" alt="cover × warm" width="260"><br>`warm` |
| <img src="assets/sample/cover__xhs-knowledge.jpg" alt="cover × xhs-knowledge" width="260"><br>`xhs-knowledge` |

<a id="format-daily-news-cover"></a>

### daily-news-cover

cover job · 21:9 · default style `daily-news`

| | | |
| --- | --- | --- |
| <img src="assets/sample/daily-news-cover__clean-webapp-ui.jpg" alt="daily-news-cover × clean-webapp-ui" width="260"><br>`clean-webapp-ui` | <img src="assets/sample/daily-news-cover__cute.jpg" alt="daily-news-cover × cute" width="260"><br>`cute` | <img src="assets/sample/daily-news-cover__daily-news.jpg" alt="daily-news-cover × daily-news" width="260"><br>`daily-news` ★ |
| <img src="assets/sample/daily-news-cover__editorial.jpg" alt="daily-news-cover × editorial" width="260"><br>`editorial` | <img src="assets/sample/daily-news-cover__fresh.jpg" alt="daily-news-cover × fresh" width="260"><br>`fresh` | <img src="assets/sample/daily-news-cover__minimalist.jpg" alt="daily-news-cover × minimalist" width="260"><br>`minimalist` |
| <img src="assets/sample/daily-news-cover__photorealistic.jpg" alt="daily-news-cover × photorealistic" width="260"><br>`photorealistic` | <img src="assets/sample/daily-news-cover__quasi-news-podcast.jpg" alt="daily-news-cover × quasi-news-podcast" width="260"><br>`quasi-news-podcast` | <img src="assets/sample/daily-news-cover__sketch.jpg" alt="daily-news-cover × sketch" width="260"><br>`sketch` |
| <img src="assets/sample/daily-news-cover__technical-diagram.jpg" alt="daily-news-cover × technical-diagram" width="260"><br>`technical-diagram` | <img src="assets/sample/daily-news-cover__vibrant.jpg" alt="daily-news-cover × vibrant" width="260"><br>`vibrant` | <img src="assets/sample/daily-news-cover__warm.jpg" alt="daily-news-cover × warm" width="260"><br>`warm` |
| <img src="assets/sample/daily-news-cover__xhs-knowledge.jpg" alt="daily-news-cover × xhs-knowledge" width="260"><br>`xhs-knowledge` |

<a id="format-daily-news-podcast-cover"></a>

### daily-news-podcast-cover

cover job · 21:9 · default style `quasi-news-podcast`

| | | |
| --- | --- | --- |
| <img src="assets/sample/daily-news-podcast-cover__clean-webapp-ui.jpg" alt="daily-news-podcast-cover × clean-webapp-ui" width="260"><br>`clean-webapp-ui` | <img src="assets/sample/daily-news-podcast-cover__cute.jpg" alt="daily-news-podcast-cover × cute" width="260"><br>`cute` | <img src="assets/sample/daily-news-podcast-cover__daily-news.jpg" alt="daily-news-podcast-cover × daily-news" width="260"><br>`daily-news` |
| <img src="assets/sample/daily-news-podcast-cover__editorial.jpg" alt="daily-news-podcast-cover × editorial" width="260"><br>`editorial` | <img src="assets/sample/daily-news-podcast-cover__fresh.jpg" alt="daily-news-podcast-cover × fresh" width="260"><br>`fresh` | <img src="assets/sample/daily-news-podcast-cover__minimalist.jpg" alt="daily-news-podcast-cover × minimalist" width="260"><br>`minimalist` |
| <img src="assets/sample/daily-news-podcast-cover__photorealistic.jpg" alt="daily-news-podcast-cover × photorealistic" width="260"><br>`photorealistic` | <img src="assets/sample/daily-news-podcast-cover__quasi-news-podcast.jpg" alt="daily-news-podcast-cover × quasi-news-podcast" width="260"><br>`quasi-news-podcast` ★ | <img src="assets/sample/daily-news-podcast-cover__sketch.jpg" alt="daily-news-podcast-cover × sketch" width="260"><br>`sketch` |
| <img src="assets/sample/daily-news-podcast-cover__technical-diagram.jpg" alt="daily-news-podcast-cover × technical-diagram" width="260"><br>`technical-diagram` | <img src="assets/sample/daily-news-podcast-cover__vibrant.jpg" alt="daily-news-podcast-cover × vibrant" width="260"><br>`vibrant` | <img src="assets/sample/daily-news-podcast-cover__warm.jpg" alt="daily-news-podcast-cover × warm" width="260"><br>`warm` |
| <img src="assets/sample/daily-news-podcast-cover__xhs-knowledge.jpg" alt="daily-news-podcast-cover × xhs-knowledge" width="260"><br>`xhs-knowledge` |

<a id="format-free"></a>

### free

free job · 1:1 · default style `vibrant`

| | | |
| --- | --- | --- |
| <img src="assets/sample/free__clean-webapp-ui.jpg" alt="free × clean-webapp-ui" width="260"><br>`clean-webapp-ui` | <img src="assets/sample/free__cute.jpg" alt="free × cute" width="260"><br>`cute` | <img src="assets/sample/free__daily-news.jpg" alt="free × daily-news" width="260"><br>`daily-news` |
| <img src="assets/sample/free__editorial.jpg" alt="free × editorial" width="260"><br>`editorial` | <img src="assets/sample/free__fresh.jpg" alt="free × fresh" width="260"><br>`fresh` | <img src="assets/sample/free__minimalist.jpg" alt="free × minimalist" width="260"><br>`minimalist` |
| <img src="assets/sample/free__photorealistic.jpg" alt="free × photorealistic" width="260"><br>`photorealistic` | <img src="assets/sample/free__quasi-news-podcast.jpg" alt="free × quasi-news-podcast" width="260"><br>`quasi-news-podcast` | <img src="assets/sample/free__sketch.jpg" alt="free × sketch" width="260"><br>`sketch` |
| <img src="assets/sample/free__technical-diagram.jpg" alt="free × technical-diagram" width="260"><br>`technical-diagram` | <img src="assets/sample/free__vibrant.jpg" alt="free × vibrant" width="260"><br>`vibrant` ★ | <img src="assets/sample/free__warm.jpg" alt="free × warm" width="260"><br>`warm` |
| <img src="assets/sample/free__xhs-knowledge.jpg" alt="free × xhs-knowledge" width="260"><br>`xhs-knowledge` |

<a id="format-illustration"></a>

### illustration

illustration job · 4:3 · default style `technical-diagram`

| | | |
| --- | --- | --- |
| <img src="assets/sample/illustration__clean-webapp-ui.jpg" alt="illustration × clean-webapp-ui" width="260"><br>`clean-webapp-ui` | <img src="assets/sample/illustration__cute.jpg" alt="illustration × cute" width="260"><br>`cute` | <img src="assets/sample/illustration__daily-news.jpg" alt="illustration × daily-news" width="260"><br>`daily-news` |
| <img src="assets/sample/illustration__editorial.jpg" alt="illustration × editorial" width="260"><br>`editorial` | <img src="assets/sample/illustration__fresh.jpg" alt="illustration × fresh" width="260"><br>`fresh` | <img src="assets/sample/illustration__minimalist.jpg" alt="illustration × minimalist" width="260"><br>`minimalist` |
| <img src="assets/sample/illustration__photorealistic.jpg" alt="illustration × photorealistic" width="260"><br>`photorealistic` | <img src="assets/sample/illustration__quasi-news-podcast.jpg" alt="illustration × quasi-news-podcast" width="260"><br>`quasi-news-podcast` | <img src="assets/sample/illustration__sketch.jpg" alt="illustration × sketch" width="260"><br>`sketch` |
| <img src="assets/sample/illustration__technical-diagram.jpg" alt="illustration × technical-diagram" width="260"><br>`technical-diagram` ★ | <img src="assets/sample/illustration__vibrant.jpg" alt="illustration × vibrant" width="260"><br>`vibrant` | <img src="assets/sample/illustration__warm.jpg" alt="illustration × warm" width="260"><br>`warm` |
| <img src="assets/sample/illustration__xhs-knowledge.jpg" alt="illustration × xhs-knowledge" width="260"><br>`xhs-knowledge` |

<a id="format-xhs-card"></a>

### xhs-card

free job · 3:4 · default style `xhs-knowledge`

| | | |
| --- | --- | --- |
| <img src="assets/sample/xhs-card__clean-webapp-ui.jpg" alt="xhs-card × clean-webapp-ui" width="260"><br>`clean-webapp-ui` | <img src="assets/sample/xhs-card__cute.jpg" alt="xhs-card × cute" width="260"><br>`cute` | <img src="assets/sample/xhs-card__daily-news.jpg" alt="xhs-card × daily-news" width="260"><br>`daily-news` |
| <img src="assets/sample/xhs-card__editorial.jpg" alt="xhs-card × editorial" width="260"><br>`editorial` | <img src="assets/sample/xhs-card__fresh.jpg" alt="xhs-card × fresh" width="260"><br>`fresh` | <img src="assets/sample/xhs-card__minimalist.jpg" alt="xhs-card × minimalist" width="260"><br>`minimalist` |
| <img src="assets/sample/xhs-card__photorealistic.jpg" alt="xhs-card × photorealistic" width="260"><br>`photorealistic` | <img src="assets/sample/xhs-card__quasi-news-podcast.jpg" alt="xhs-card × quasi-news-podcast" width="260"><br>`quasi-news-podcast` | <img src="assets/sample/xhs-card__sketch.jpg" alt="xhs-card × sketch" width="260"><br>`sketch` |
| <img src="assets/sample/xhs-card__technical-diagram.jpg" alt="xhs-card × technical-diagram" width="260"><br>`technical-diagram` | <img src="assets/sample/xhs-card__vibrant.jpg" alt="xhs-card × vibrant" width="260"><br>`vibrant` | <img src="assets/sample/xhs-card__warm.jpg" alt="xhs-card × warm" width="260"><br>`warm` |
| <img src="assets/sample/xhs-card__xhs-knowledge.jpg" alt="xhs-card × xhs-knowledge" width="260"><br>`xhs-knowledge` ★ |
