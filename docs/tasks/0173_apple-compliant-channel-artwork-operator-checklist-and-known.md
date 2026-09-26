---
schema_version: 1
name: Apple-compliant channel artwork, operator checklist, and known microfeed gaps
status: todo
template: meta
created_at: 2026-09-25T23:01:10.935Z
updated_at: "2026-09-25T23:10:40.511Z"
feature_id: E61
priority: P1
tags:
  - podcast-pub
  - apple-podcasts
  - docs
estimate_hours: 2

---

## 0173. Apple-compliant channel artwork, operator checklist, and known microfeed gaps

### Background

Implements: R5 — Channel artwork file meets the Apple artwork spec; R6 — Operator checklist covers the channel settings the microfeed API cannot write; R7 — Episode author and full description gaps are recorded, not silently dropped.

The live feed has no channel `<description>`, no `<itunes:owner>`, one category, and a 1024² PNG artwork served under a `.jpeg` name (771 KB). kk's client (`podcast-pub/src/microfeed-client.ts`) covers items, media uploads, and feed read; microfeed itself also exposes `PUT /api/v1/channels/primary` (`vendors/microfeed/src/pages/api/v1/channels/[channelId]/index.ts:1`), so channel settings can be applied via admin UI or that API — kk does not automate them (one-off). `<itunes:owner>` renders only when `_microfeed["itunes:email"]` is set (`vendors/microfeed/src/server/feed/FeedPublicRssBuilder.ts:176`).

**Refine corrections (2026-09-25)**

- "microfeed API cannot write channel settings" (design D4 / E61 R6 wording) → false: `PUT /api/v1/channels/primary` exists (`vendors/microfeed/src/pages/api/v1/channels/[channelId]/index.ts:1`, schema `src/shared/ApiSchemas.ts:378`) → kept the operator checklist, documented the API as an alternative (E61 R6 title kept as identity key).
- "owner name missing" → root cause: `<itunes:owner>` only renders when `_microfeed["itunes:email"]` is set (`FeedPublicRssBuilder.ts:176`) → checklist requires the email.
- Verified: categories come from `_microfeed.categories` (`FeedPublicRssBuilder.ts:196`); items emit only `description` from `content_html` (`:34`); `sips` already used (`plugins/kk/scripts/kk-workflow-stages.ts:975`); the presign schema has optional `item_id` (`ApiSchemas.ts:399`).

### Requirements

- [ ] R1. Produce a square RGB JPEG 1400–3000 px per side, `.jpg` extension, ≤ 512 KB (or a size the operator accepts), from the current channel image via `sips`; store it at `docs/design/assets/podcast-channel-artwork-1400.jpg`.
- [ ] R2. Add `## 8. Apple Podcasts compliance` to `docs/design/podcast-pub.md`: what microfeed already satisfies; the channel checklist (description; owner email — `<itunes:owner>` renders only when `itunes:email` is set, `vendors/microfeed/src/server/feed/FeedPublicRssBuilder.ts:176`; author name; category + subcategory, up to three; artwork upload with a correct extension); verification via castfeedvalidator.
- [ ] R3. The checklist names both application paths: microfeed admin UI, or `PUT /api/v1/channels/primary` (`apiChannelInputSchema`, `vendors/microfeed/src/shared/ApiSchemas.ts:378`) plus a channel-image presign without `item_id`.
- [ ] R4. Record known microfeed-template gaps — item itunes:author and content:encoded (the item builder emits only `description` from `content_html`, `FeedPublicRssBuilder.ts:34`), feed ETag/Last-Modified/Content-Length, the Cloudflare notice, subscribe links — with the upgrade path (microfeed fork / post-approval).
- [ ] R5. After the operator applies the settings, the live feed emits channel `description`, `itunes:owner` (email + name), and the new artwork URL.

Out of scope: a kk channel-update operation; forking microfeed; changing the Worker's HTTP headers; subscribe links (post-approval).

### Acceptance Criteria

- [ ] AC1 — Channel artwork file meets the Apple artwork spec (req: R1)
- [ ] AC2 — Operator checklist covers the channel settings the microfeed API cannot write (req: R2, R3, R5)
- [ ] AC3 — Episode author and full description gaps are recorded, not silently dropped (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-25T23:03:58.235Z

- Q: Does microfeed have a channel write API? A: Yes — `PUT /api/v1/channels/primary` (verified in vendored source after design approval). Kept the operator checklist as primary path; API documented as alternative; no kk automation (one-off).
- Q: Why no itunes:owner today? A: microfeed emits it only when `_microfeed["itunes:email"]` is set — the checklist must include the email.
- Q: Artwork size target? A: 1400² RGB JPEG ≤ 512 KB via sips; regenerate at 3000² only if the upscale looks soft.

#### Q&A entry — 2026-09-25T23:10:33.428Z

- Q: Where does the artwork asset live? A: `docs/design/assets/podcast-channel-artwork-1400.jpg` (closed).

### Design

Chosen: `sips -s format jpeg -s formatOptions <q> -z 1400 1400` resample of the current channel image (no new tool; sips is already used at `plugins/kk/scripts/kk-workflow-stages.ts:975`), plus a new § 8 in `docs/design/podcast-pub.md`. The operator applies artwork + channel settings via the microfeed admin UI, or one `PUT /api/v1/channels/primary` call (optional, documented in the checklist).
Frozen names: asset `docs/design/assets/podcast-channel-artwork-1400.jpg`; section `## 8. Apple Podcasts compliance`.
Rejected: native 3000² regeneration via image-gen (costlier, style drift; revisit if the upscale looks soft); a kk/podcast-pub `channel-update` operation (one-off settings; add if a second show needs it); a microfeed fork (maintenance burden).
Invariants: no secrets (API key, owner email value) in docs; the checklist names the fields, not the values.
Dependencies: none; independent of 0170–0172.

### Plan

1. Fetch the current channel image (URL from the live RSS `itunes:image`); resample to a 1400² RGB JPEG, tuning quality to ≤ 512 KB; verify with `sips -g all` (R1).
2. Write § 8 in `docs/design/podcast-pub.md`: what microfeed satisfies, the checklist with both paths, known gaps (R2, R3, R4).
3. Hand the checklist to the operator; after they apply it, `curl` the live RSS for channel description / itunes:owner / artwork and run castfeedvalidator (no ERROR/FATAL) → Testing (R5).

### Root Cause

<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History
