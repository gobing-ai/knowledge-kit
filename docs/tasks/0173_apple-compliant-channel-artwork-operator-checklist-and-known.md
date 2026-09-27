---
schema_version: 1
name: Apple-compliant channel artwork, operator checklist, and known microfeed gaps
status: done
template: meta
created_at: 2026-09-25T23:01:10.935Z
updated_at: "2026-09-27T05:01:09.046Z"
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

- [x] R1. Produce a square RGB JPEG 1400–3000 px per side, `.jpg` extension, ≤ 512 KB (or a size the operator accepts), from the current channel image via `sips`; store it at `docs/design/assets/podcast-channel-artwork-1400.jpg`.
- [x] R2. Add `## 8. Apple Podcasts compliance` to `docs/design/podcast-pub.md`: what microfeed already satisfies; the channel checklist (description; owner email — `<itunes:owner>` renders only when `itunes:email` is set, `vendors/microfeed/src/server/feed/FeedPublicRssBuilder.ts:176`; author name; category + subcategory, up to three; artwork upload with a correct extension); verification via castfeedvalidator.
- [x] R3. The checklist names both application paths: microfeed admin UI, or `PUT /api/v1/channels/primary` (`apiChannelInputSchema`, `vendors/microfeed/src/shared/ApiSchemas.ts:378`) plus a channel-image presign without `item_id`.
- [x] R4. Record known microfeed-template gaps — item itunes:author and content:encoded (the item builder emits only `description` from `content_html`, `FeedPublicRssBuilder.ts:34`), feed ETag/Last-Modified/Content-Length, the Cloudflare notice, subscribe links — with the upgrade path (microfeed fork / post-approval).
- [x] R5. After the operator applies the settings, the live feed emits channel `description`, `itunes:owner` (email + name), and the new artwork URL.

Out of scope: a kk channel-update operation; forking microfeed; changing the Worker's HTTP headers; subscribe links (post-approval).

### Acceptance Criteria

- [x] AC1 — Channel artwork file meets the Apple artwork spec (req: R1)
- [x] AC2 — Operator checklist covers the channel settings the microfeed API cannot write (req: R2, R3, R5)
- [x] AC3 — Episode author and full description gaps are recorded, not silently dropped (req: R4)

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

Change map (`file:line` per table row; R1–R4 — R5 is operator-gated and has no code path):

| file:line | Change |
| --- | --- |
| `docs/design/assets/podcast-channel-artwork-1400.jpg` (binary asset — no line anchor) | R1: new 1400×1400 RGB JPEG, no alpha, sRGB, 179,427 bytes (cap 512 KB), produced by `sips -s format jpeg -s formatOptions 90 -z 1400 1400` from the live channel image; replaces the 1024² PNG (771,672 bytes) that is served under a `.jpeg` URL |
| `docs/design/podcast-pub.md:172` | R2: new `## 8. Apple Podcasts compliance` heading + framing that channel settings are not automated by kk (no `channel-update` operation, §1 D5) |
| `docs/design/podcast-pub.md:182` | R1: §8.1 artwork spec — asset path, the exact `sips` command, Apple's constraints, and the non-compliant live artwork it replaces |
| `docs/design/podcast-pub.md:204` | R2: §8.2 what microfeed already satisfies, one emitting `file:line` per element |
| `docs/design/podcast-pub.md:215` | R2/R3: §8.3 operator checklist (description, owner email + name, author, categories up to three, artwork upload) with path A = microfeed admin UI and path B = `PUT /api/v1/channels/primary` plus a channel-image presign without `item_id` |
| `docs/design/podcast-pub.md:304` | R2: §8.4 verification after applying the checklist (`curl` the live RSS/JSON for description/owner/artwork; castfeedvalidator) |
| `docs/design/podcast-pub.md:339` | R4: §8.5 known microfeed-template gaps — item `itunes:author`, item `content:encoded`, feed `ETag`/`Last-Modified`/`Content-Length`, Cloudflare fronting, subscribe links — each with its upgrade path, plus the pointer to the E61 Notes residual (2026-09-24 `audio/wav` item) |

Rationale:

- Artwork is a pure resample: `sips` is already used by the pipeline (`plugins/kk/scripts/kk-workflow-stages.ts:975`), so no new tool and no image-gen regeneration (design-rejected: costlier, style drift).
- R3 nuance verified in the vendored source while implementing: `PUT /api/v1/channels/primary` covers `description`, `authors[0].name` (→ channel `publisher`) and `_microfeed["itunes:email"]` (`FeedCrudManager.ts:114-158`; `upsertChannel` shallow-merges at `FeedCrudManager.ts:206`) but cannot carry `categories` — `apiChannelInputSchema` has no such field (`src/shared/ApiSchemas.ts:378`). Categories therefore stay admin-UI-only (§8.3, up to three, `EditChannelApp/index.tsx:247`), so the checklist does not present the API as a complete substitute.
- Doc anchors are `vendors/microfeed/`-relative (declared in §8's lead-in) and every one was re-resolved against the vendored source after this fix (40/40 resolve).
- No secrets: §8.3 names the fields (owner email, key) and never a value.
- R5 not attempted: no live microfeed write, channel update, or artwork upload was made (no `MICROFEED_*` credentials in this environment; channel settings are an operator action). R5 and AC2 stay unticked.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R5 | MET | Re-verified 2026-09-27: docs/design/assets/podcast-channel-artwork-1400.jpg is JPEG (JFIF), 1400x1400, RGB, no alpha, 179427 bytes (< 512 KB) — file + sips this run. Live channel itunes:image serves image/jpeg at exactly 179427 bytes — the same asset, so the operator applied it. |
| R6 | MET | docs/design/podcast-pub.md §8.3 operator checklist (:215) and §8.4 verification script (:304) present; live channel now passes the §8.4 criteria (description CDATA present, itunes:owner email+name present, .jpg artwork). |
| R7 | MET | §8.5 known microfeed-template gaps table present at :357 (anchor drifted from the recorded :339 as the doc grew — P4 note only; content intact: itunes:author, content:encoded, ETag/Last-Modified, Cloudflare fronting, subscribe links rows all present). |
| R5 — Channel artwork file meets the Apple artwork spec | MET | Same row as task R5 (2026-09-27 re-verify): JPEG 1400x1400 RGB no-alpha 179427 B; live channel serves it as image/jpeg. |
| R6 — Operator checklist covers the channel settings the microfeed API cannot write | MET | Same row as task R6 (2026-09-27 re-verify): §8.3 checklist + §8.4 verification script present; live channel passes §8.4 criteria. |
| R7 — Episode author and full description gaps are recorded, not silently dropped | MET | Same row as task R7 (2026-09-27 re-verify): §8.5 gap table intact at :357. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Asset spec: JPEG 1400x1400 RGB no-alpha 179427 B (file/sips, this run). |
| AC2 | MET | test | Live channel artwork content-type image/jpeg, size matches repo asset byte-for-byte. |
| AC3 | MET | test | §8.1–§8.5 headings all present in docs/design/podcast-pub.md (rg, this run). |
| AC4 | MET | test | Live feed channel description + itunes:owner (Robin Min / minlongbing@gmail.com) present (feed parse, this run). |
| AC5 | MET | test | §8.5 gap table records the five known gaps with evidence and upgrade paths. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Read-only confirmation pass on the remediated 0173 state: the bounded `test-fix` (attempt 2) edit to `docs/design/podcast-pub.md` §8, the operator's live apply of §8.3 path B, and the resulting R5/AC2 tick. Nothing was modified by this pass; no microfeed write, channel update, upload, or fork. Anchors were re-resolved against `/Users/robin/xprojects/knowledge-kit/vendors/microfeed@ddcb04c` (`vendors/` is gitignored and absent from this worktree; §8 declares the vendored tree as its authority, §3). Evidence: read-only `curl` of the live `/rss/`, `/json/` and the live artwork URL, the §8.4 fence executed verbatim against the live feed, `stat` / `sips -g all` on the asset, and re-reads of the vendored microfeed source. Working tree: only the task file is dirty (the R5/AC2 tick and this Review section); the doc edit itself is committed in `4d6995bc`.

**Findings**

| Priority | Finding | Location |
| --- | --- | --- |

No open finding. The two rows of the previous pass (P2 admin-UI artwork route, P4 stale change map) are resolved — see below.

**Prior findings — resolution status**

| Prior finding | Status | Evidence |
| --- | --- | --- |
| P2 (major) — §8.3's primary artwork path (admin UI) could not produce compliant artwork | RESOLVED | §8.3 now routes the artwork through path B and says so three times consistently: the §8.3 lead-in (`docs/design/podcast-pub.md:217-221`, "The artwork row is the exception: only the API media upload below can produce it"), the checklist's Artwork row (`:230`, presign `"type":"image/jpeg"` → PUT → returned `media_url` as channel `icon`, "Do **not** use the admin-UI channel image upload", with the PNG re-encode mechanism anchored at `AdminImageUploaderApp/index.tsx:248`, `:291`, `:220-233`, `:72-80` and `src/client/requests.ts:20-25`), and path A (`:243-248`, "it cannot produce a compliant artwork … Use path B's media upload for the artwork"). Re-verified against source: the cropper's `toBlob(..., 'image/png')` forces PNG (`:248`, `:291`), `Requests.upload` posts the blob's `type` (`src/client/requests.ts:22-25`), and the stored key keeps the selected file's extension (`AdminImageUploaderApp/index.tsx:220-233`). No contradiction with §8.1 (the `.jpg` asset + `image/jpeg` content-type pair is exactly what §8.1 requires) or §8.4. Confirmed the doc still marks `categories` admin-only: the categories row (`:229`) routes to the admin UI, path A says "Categories are admin-only: `PUT /api/v1/channels/primary` has no `categories` field (`apiChannelInputSchema`, `src/shared/ApiSchemas.ts:378`) and the public→internal channel mapper copies a fixed field set that excludes categories (`_publicToInternalSchemaForChannel`, `src/server/feed/FeedCrudManager.ts:114`)" (`:249-252`), and path B repeats "`categories` is never mapped … Categories must come from path A" (`:272-273`). Re-verified: `apiChannelInputSchema` (`src/shared/ApiSchemas.ts:378-389`) has no such field; the mapper (`FeedCrudManager.ts:114-158`) has no such branch; `upsertChannel` shallow-merges (`:205-208`). |
| P4 (advisory) — the task's `## Solution` change-map lines were stale after the fix inserted lines inside §8 | RESOLVED | All six `file:line` rows now resolve to the construct each claims: `:172` → `## 8. Apple Podcasts compliance`; `:182` → `### 8.1 Artwork (0173 R1)`; `:204` → `### 8.2 What microfeed already satisfies (no action)`; `:215` → `### 8.3 Operator checklist (channel settings)`; `:304` → `### 8.4 Verification after applying the checklist`; `:339` → `### 8.5 Known microfeed-template gaps (0173 R4)`. The binary-asset row carries no line anchor by design. The in-rationale anchors hold too: `FeedCrudManager.ts:114-158`, `FeedCrudManager.ts:206` (`...this.feedContent.channel,` inside `upsertChannel`), `src/shared/ApiSchemas.ts:378`, `EditChannelApp/index.tsx:247`, `plugins/kk/scripts/kk-workflow-stages.ts:975` (`sips`). |

**Live apply — §8.4 executed verbatim against the live feed**

The ElementTree block prints `channel <description>: OK (34 chars)`, `<itunes:owner> email+name: OK`, `<itunes:image> .jpg: OK`; `curl -sI <icon> | grep -i '^content-type'` prints `content-type: image/jpeg` with `content-length: 179427` — the asset's exact byte size (`stat -f '%z'` = 179427). The live icon URL is `.../images/item-09f82dd83f3a4d6ce2dcd818822cbc6a.jpg`, i.e. the API presign key shape (path B), not the admin uploader's `images/channel-<hex>.<ext>` — the live object corroborates that the prescribed route was the one used. So both of §8.4's artwork assertions (`.jpg` key extension and `content-type: image/jpeg` served) are satisfied by the route §8.3 now prescribes; the `.jpg` + `image/jpeg` pair is internally consistent (extension from `full_local_file_path`, content-type from the presign `type`, `src/server/api/handlers.ts:809-816` and `src/pages/media-upload/[...key].ts:52`). R5 and AC2 are met on live evidence and `spur task check 0173 --as done` passes.

**New-defect hunt (attempt-2 edit scope)**

- §8 carries 40 distinct `file:line` anchors; 40/40 resolve inside `vendors/microfeed@ddcb04c` on the intended construct. Newly added anchors spot-checked at exact text: `AdminImageUploaderApp/index.tsx:72` (`function isInvalidImage()`), `:80` (closing brace), `:220` (`const {name, type} = file;`), `:233` (`cdnFilename: \`images/${newFilename}\``), `:248` (`cropper.getCroppedCanvas().toBlob(...)`), `:291` (`}, 'image/png');`), `src/client/requests.ts:20`/`:25`, `src/shared/ApiSchemas.ts:378`. No stale anchor.
- The pinned upload values are exact, which matters because the presign's `size` becomes a `FixedLengthStream` on the PUT (`src/pages/media-upload/[...key].ts:36-40`): `"size":179427` equals the asset's byte count, and the live object's `content-length: 179427` confirms it. `"full_local_file_path":"podcast-channel-artwork-1400.jpg"` supplies the `.jpg` key extension that §8.4 asserts.
- §3's "Prepare upload" row already lists `type` in the upload body, so the fixed path-B presign now matches §3 rather than diverging; §4.2 (0170) still does not restate the MIME allowlist, so §8.5's `audio/wav` residual does not contradict it.
- Secrets: no API key value and no owner-email value anywhere in §8 or the task file — only `${MICROFEED_BASE_URL}` / `$MICROFEED_API_KEY` env names and `…` placeholders. Holds.
- Every load-bearing sentence in the attempt-2-changed rows carries an anchor, and the three adversarial claims checked hardest (cropper forces PNG; blob `type` → presign; stored key keeps the selected file's extension) all hold in the vendored source. No new defect introduced by the attempt-2 edit.

**Residual risk**

- Advisory, not raised as a finding (out of the attempt-2 edit's scope and no action needed to close 0173): §8's pre-apply live-state snapshots are now historical because the operator's apply changed the state they describe — `docs/design/podcast-pub.md:209` (§8.2 live-value cell "set — holds the non-compliant artwork of §8.1"), `:225` ("live channel content is empty (`/json/` → `\"description\": \"\"`), so the RSS channel element is absent"), `:226` ("the live feed has no `<itunes:owner>`"), `:299-300` ("live proof: today's artwork is served `content-type: image/png` from a `.jpeg` URL"). The prescriptive rows, the mechanism paragraphs, §8.1's "the live artwork this replaces …" framing, and every §8.4 assertion remain correct, and §8.4 is the authoritative live check, so the operator path is not misled; a later doc refresh could past-tense those four spots.
- Anchors resolve against the gitignored vendored checkout at `ddcb04c` (v1.0.8) while the deployed instance reports microfeed 1.0.9; line anchors can drift with the deployed revision.
- castfeedvalidator was not run (no HTTP endpoint, no installable package); §8.4's validator step is certified as documented only. The submission-blocking `audio/wav` item (§8.3's last row, §8.5) is untouched by this apply and still gates submission — by design, out of 0173's scope.

**Disposition: PASS** — both prior findings are genuinely resolved and coherent with §8.1/§8.4 and `apiChannelInputSchema` (`categories` still admin-only); all six `## Solution` change-map rows resolve; §8.4's `.jpg` + `image/jpeg` assertions match the route §8.3 now prescribes and pass against the live feed (34-char description, owner email + name, `image/jpeg`, 179,427 B); no new defect introduced by the attempt-2 edit; R5/AC2 met on live evidence.

### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History

- 2026-09-26T03:16:32.256Z todo → wip (system)
- 2026-09-26T04:06:41.714Z wip → testing (system)
- 2026-09-26T04:07:26.107Z testing → done (system)

