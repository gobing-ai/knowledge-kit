# youtube-pub

Publishes a 9:16 vertical video to **YouTube Shorts** through the official YouTube Data API v3
(resumable `videos.insert`) — no browser automation, no `googleapis` SDK.

`private` is the default: a public upload additionally requires a Google-audited API project, which
is out of scope here.

## One-time OAuth2 setup (operator, once)

1. In Google Cloud, create (or reuse) a project and enable **YouTube Data API v3**.
2. Create an **OAuth client of type "Desktop app"**, then run the consent flow once for the channel
   account with scope `https://www.googleapis.com/auth/youtube.upload` and exchange the code for a
   **refresh token** (Google OAuth2 playground or `oauth2l` both work).
3. Write the three values to `~/.config/kk/youtube-oauth.json` and lock it down:

   ```bash
   mkdir -p ~/.config/kk
   cat > ~/.config/kk/youtube-oauth.json <<'JSON'
   { "client_id": "…", "client_secret": "…", "refresh_token": "…" }
   JSON
   chmod 600 ~/.config/kk/youtube-oauth.json
   ```

   Any group/world permission bit makes the file unusable — the plugin refuses it rather than
   reading a world-readable secret.

Environment variables win over the file:
`KK_YOUTUBE_CLIENT_ID`, `KK_YOUTUBE_CLIENT_SECRET`, `KK_YOUTUBE_REFRESH_TOKEN`.

## Invocation

```bash
kk publish --plugin youtube-pub --in 30-variants/video@youtube-pub.content.json --out 4-publish/youtube.json
```

The Content must be `videoGenContentSchema`-valid (`format: "video"`, `metadata.videoPath` pointing at
an MP4, `height > width`, `durationSec <= 180`). `options.privacyStatus` may be `unlisted` or
`public`; anything else is refused.

The Result is `{ ok, target: "youtube-pub", id, url: "https://youtube.com/shorts/<id>" }`.

## Quota

One upload per run. `videos.insert` costs 1600 units of the default 10,000/day quota
(<https://developers.google.com/youtube/v3/determine_quota_cost>); check the current cost before
enabling the preset row. A 403 `quotaExceeded` is reported as-is and never retried.
