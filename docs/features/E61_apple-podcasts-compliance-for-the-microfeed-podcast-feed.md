---
schema_version: 1
id: "E61"
name: "Apple Podcasts compliance for the microfeed podcast feed"
status: done
priority: P2
tags: []
created_at: "2026-09-25T22:41:30.242Z"
updated_at: "2026-09-27T03:22:13.974Z"
---

# E61: Apple Podcasts compliance for the microfeed podcast feed

## Goal

Make the 咸话咸说 microfeed feed (`https://podcast.salty.vip/rss/`) acceptable to Apple Podcasts: every episode kk publishes carries a standard, Apple-playable audio enclosure (MP3 with ID3 tags, never WAV), and the channel-level metadata Apple requires (artwork 1400–3000 px, description, owner, complete categories) is supplied — by kk where the microfeed API allows it, and by a documented operator step where it does not.

## Scope

**In scope**

- `kk-daily-ai-voice` publishes MP3 by default (`transcode_mp3` default flipped; existing voice-gen / omni-voice-gen ffmpeg transcode reused).
- `podcast-pub` refuses audio whose MIME type is not Apple-compatible (e.g. `audio/wav`) before any network call — fail loud, no silent transcode.
- Minimal ID3 tags (title, artist, album, date) written into the published MP3.
- Publish the 2026-09-25 episode through the fixed path as the first compliant enclosure (supersedes the 2026-09-24 republish, dropped by operator decision 2026-09-25).
- A compliant channel artwork file (square, 1400–3000 px, correct extension, ≤ 512 KB target) produced from the current cover.
- An operator checklist for microfeed-admin channel settings Apple requires (description, owner name/email, categories + subcategory, artwork upload) — kk does not automate these (one-off settings); they apply via the microfeed admin UI or `PUT /api/v1/channels/primary`, and `<itunes:owner>` only renders when `itunes:email` is set.

**Out of scope**

- Feed HTTP caching headers (ETag, Last-Modified, Content-Length) and the Cloudflare warning — served by the microfeed Worker, outside this repo.
- Per-item `<itunes:author>` / `<content:encoded>` tags microfeed's RSS template does not emit — requires a microfeed fork.
- Subscribe links on the website — post-approval, once the Apple Podcasts URL exists.
- A `kk` feed-lint command — castfeedvalidator covers this until a second show exists.
- Transcoding inside `podcast-pub` (design anti-pattern: the plugin never probes or transcodes audio).
- Repairing the existing 2026-09-24 item (`IdDo7yGVKuP`, `audio/wav`) — recorded as a known residual in Notes, not repaired by this feature.

## Acceptance Criteria

```gherkin
Feature: Apple Podcasts compliance for the microfeed podcast feed

  @core
  # covers: I1, I2
  Scenario: R1 — Daily voice runs publish an MP3 enclosure by default
    Given a kk-daily-ai-voice run with no transcode_mp3 override
    When the publish-prep stage assembles the podcast payload
    Then options.audioFile points at the .mp3 sibling, not the .wav
    And the episode is uploaded to microfeed with mime_type audio/mpeg

  @core
  # covers: I1, I2
  Scenario: R2 — podcast-pub refuses non-Apple-compatible audio before any network call
    Given a publish payload whose resolved audio MIME type is audio/wav or another type outside the Apple-accepted set (audio/mpeg, audio/x-m4a, audio/mp4, video/mp4, video/quicktime, video/x-m4v)
    When podcast-pub runs the publish or update operation
    Then it fails naming the offending MIME type and the accepted set
    And no microfeed request, presign, or upload is made

  @core
  # covers: I3
  Scenario: R3 — Published MP3 carries ID3 tags
    Given a daily run that produces the final episode MP3, with or without the intro sting
    When publish-prep hands the MP3 to podcast-pub
    Then the file carries ID3 title, artist, album, and date tags derived from the episode title, show name, and run date

  @core
  # covers: I14
  Scenario: R4 — The 2026-09-25 episode is published with a compliant enclosure
    Given the daily AI-voice run for 2026-09-25 publishes through the fixed path
    When kk-daily-ai-voice publishes the episode to microfeed
    Then the live RSS item enclosure for 2026-09-25 has type audio/mpeg and a .mp3 URL
    And castfeedvalidator reports no FATAL media error for the feed

  @core
  # covers: I4, I5
  Scenario: R5 — Channel artwork file meets the Apple artwork spec
    Given the current 1024x1024 channel cover
    When the compliant artwork is produced
    Then it is a square RGB PNG or JPEG between 1400 and 3000 px per side
    And its file extension matches its content type and it is at most 512 KB, or the operator accepts the size in the checklist

  @core
  # covers: I6, I7, I8, I15
  Scenario: R6 — Operator checklist covers the channel settings the microfeed API cannot write
    Given kk does not automate channel settings (admin UI or PUT /api/v1/channels/primary apply them)
    When the operator follows the Apple Podcasts channel checklist in docs/design/podcast-pub.md
    Then it lists description, owner name and itunes:email (required for itunes:owner), a category with subcategory (up to three), artwork upload, and which requirements microfeed already satisfies
    And after applying it the live feed emits channel description, itunes:owner, and the new artwork URL

  @edge
  # covers: I9, I10
  Scenario: R7 — Episode author and full description gaps are recorded, not silently dropped
    Given microfeed's RSS template does not emit item-level itunes:author or content:encoded
    When the feature closes
    Then docs/design/podcast-pub.md records both as known microfeed-template gaps with the upgrade path (microfeed fork)
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0170 | podcast-pub: reject non-Apple-compatible audio MIME before any network call | done |
| 0172 | Republish the 2026-09-24 episode with an MP3 enclosure | done |
| 0171 | kk-daily-ai-voice: publish MP3 by default with ID3 tags | done |
| 0173 | Apple-compliant channel artwork, operator checklist, and known microfeed gaps | done |
| 0176 | daily-intro merges from mp3Path so the concat output collides with its input | done |
<!-- END AUTO-GENERATED -->

## Notes

- **2026-09-25 residual — the 2026-09-24 item.** microfeed item `IdDo7yGVKuP`
  (https://podcast.salty.vip/i/ai-2026-09-24-IdDo7yGVKuP/) still serves a 52 MB `audio/wav`
  enclosure. The 2026-09-25 operator decision redirected the compliance deliverable to the
  2026-09-25 episode (task 0172), so this item was **not** repaired. Apple requires every episode
  to be playable, so this remains a known feed gap; the upgrade path is the superseded 0172 design
  (transcode the cached `20260924` intro WAV → MP3, republish via podcast-pub, delete the WAV item)
  if the feed is submitted to Apple.

## History

- 2026-09-27T03:17:10.864Z backlog → active (system)
- 2026-09-27T03:22:13.560Z active → verifying (system)
- 2026-09-27T03:22:13.974Z verifying → done (system)

