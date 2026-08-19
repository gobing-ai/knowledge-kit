# WeChat Official Account playbook (specific-platform study)

Distilled from the STORM study "How to Write and Publish Technical Documents on WeChat Official
Accounts" (works dir `how-to-write-it-technical-documents-for-specific-d158f7c2`, provenance only).
Load this reference when `--playbook wechat`; it shapes the draft for WeChat's reading context and
compliance constraints — never reimplements registration, publishing, or the API.

## Why WeChat

- For Chinese academics, engineers, and technical decision-makers, WeChat Official Accounts
  (微信公众号) are the primary delivery channel — researchers check it almost every waking hour.
- Authority bar: an expert should be able to name at least five public accounts on the topic they
  follow. If your account would not make that list, you are not reaching the expert audience.

## Account type and constraints (the drafting context)

- **Subscription account (订阅号)**: up to 1 push/day, but folded into a "Subscriptions" folder —
  best for high-cadence technical publishing. **Service account (服务号)**: 4 messages/month but
  appears in the main chat list with push — best for low-cadence, high-importance announcements.
- **Enterprise accounts (企业号)** are for internal newsletters (mutual approval, no public reach).
- **Hard limits that shape content**: each message carries up to 8 articles; **published articles
  cannot be deleted** — only modified with a correction notice. Errors are permanent, so
  review-before-publish is mandatory.
- Registration is a Chinese-identity-bound process (QR-scan binding, Chinese ID/phone for admins,
  ICP / Mini Program filings for hosted infrastructure). Foreign entities must work through a
  Chinese partner. API access needs AppID/AppSecret (QR-verified) and an IP whitelist.

## Authoring for the WeChat reader

- **Markdown-first pipeline**: WeChat's rich-text editor cannot interpret Markdown. Write in
  Markdown, convert to WeChat-compatible rich text (MD2WeChat / `lyricat/wechat-format`, or the
  Obsidian `wechat-public-platform` plugin for one-command draft upload), then paste/upload.
  Converters turn external links into footnotes (external links are not allowed in articles).
- **Format for mobile consumption** (articles are read on phones — commuting, mid-meeting):
  short paragraphs, images/GIFs/audio/video (text-only underperforms), text-light images, abstract
  (摘要) under 120 characters, 900×500px cover, Simplified Chinese, short self-explanatory titles
  (truncated after ~26 Chinese characters), h2–h4 headings (leave h1 for larger embedding), 15px
  body text, PingFang on iOS.
- **Language**: Chinese-language articles outperform English even for Chinese academics who read
  English; some international accounts publish multilingual content.
- **What engages**: novelty (new findings/new resources), originality and authenticity, and
  structural rigor — this audience is trained to be critical of a WeChat post.

## Editorial standards for authority

- **Bilingual/translated material**: the CAICT model — long-form Chinese analyses of international
  technical reports, crediting Chinese-institution contributors — is the reference pattern.
- **Worth a "top five" slot**: recurring high-signal formats (standards announcements, seminar
  notices, joint research, translated analyses) plus originality, authenticity, and rigor.
- **Review-before-publish checklist** (forced by the no-deletion rule): preview to your own WeChat
  first; verify title length, abstract, cover, and footnote-converted links; confirm originality
  declaration, tags, and comment settings manually in the draft box; route the broadcast through
  the admin QR-code verification step.

## Applying this in `create`

Load this reference when `--playbook wechat`. It informs the draft's structure (mobile-first
formatting, Chinese-language expectations, title/abstract limits, review rigor) but the deliverable
stays `topic`'s `3-draft/draft-article.md` — this playbook never registers an account, never
publishes, and never touches the WeChat API.
