# gemini-tts operator runbook

One-time setup for the replicated `robin-news` voice, and the yearly renewal. The daily workflow
stays on `vdriver: voicebox` until you opt in with `vdriver: gemini`.

The API key stays in the environment or in `~/.config/kk/config.yaml`. This runbook never asks you
to paste it into the repo. Source and consent clips are biometric data: keep them out of git.
Operator-run copies belong in a scratch directory outside the checkout.

## Consent statement

The same speaker as the source clip reads this verbatim, in zh-CN:

> 我是此声音的拥有者并授权谷歌使用此声音创建语音合成模型

## Export the Voicebox sample

The consent clip lives in Voicebox as a cloned-voice profile named `gemini-consent-clip`, not as a
history entry (`GET /history` 500s on the current build). Default origin: `http://127.0.0.1:17493`.

1. `GET /profiles` and match `name == gemini-consent-clip`.
2. `GET /profiles/{id}/samples` and take that profile's sample id.
3. `GET /samples/{sample_id}` — the body is `audio/wav`.

Write that body to a scratch file, for example `$T/consent.wav`.

The source clip is already in the repo and already 24 kHz mono 16-bit PCM, about 28 s:

`plugins/generations/omni-voice-gen/voices/robin-news.wav`

## Convert a clip that is not already 24 kHz mono s16

Skip this when `ffprobe` already reports `24000 Hz`, `1` channel, `pcm_s16le`.

```sh
ffmpeg -i consent.m4a -ar 24000 -ac 1 -sample_fmt s16 consent.wav
```

`voice-create` rejects anything else. A source clip must also be 10–30 seconds. The error names the
measured rate, channels, bit depth, and duration.

## Create the stored voice

`--store` defaults to `true`. An unstored `voicekey_…` id expires in 7 days and is the wrong choice
for the daily workflow. Create with `gemini-3.8-flash-tts` (or omit `--model`). `gemini-3.8-flash-lite-tts`
does not replicate: the API returns HTTP 400 telling you to omit `voice.model`. A stored voice can
then be synthesized with either TTS model.

```sh
T=$(mktemp -d)
# fetch the consent sample into "$T/consent.wav" (see above)
GEMINI_API_KEY="$GEMINI_API_KEY" bun plugins/generations/gemini-tts/src/voice-create.ts \
  --source plugins/generations/omni-voice-gen/voices/robin-news.wav \
  --consent "$T/consent.wav" \
  --name robin-news
rm -rf "$T"
```

Stdout is the `voice_…` id. A non-zero exit prints the HTTP status and API message and does not
print the key. HTTP 500 `Error translating server response to JSON` is a Gemini-side API defect on the
clip pair (observed 2026-09-24 for `robin-news.wav` plus the Voicebox consent sample, including a
12s and a 16s re-encode). When `POST /v1beta/voices` fails with 500, use Google AI Studio's interactive
voice replication UI as a fallback: upload the two clips, create the stored voice, and copy the returned
`voice_…` id into the profile map below. Re-record the source and consent in one session and retry if
needed; do not commit the clips.

## Wire the id

Write the operator-private map `~/.config/kk/gemini-tts-profiles.json`:

```json
{ "robin-news": { "voice": "voice_…" } }
```

Point the plugin at it. Under `plugins.generations.gemini-tts.env` in `~/.config/kk/config.yaml`:

```yaml
GEMINI_TTS_PROFILES: /Users/<you>/.config/kk/gemini-tts-profiles.json
```

The committed `profiles.json` stays on `voice_REPLACE_ME`. That placeholder fails closed with a
pointer back to this file.

Then render once per model (`gemini-3.8-flash-tts` and `gemini-3.8-flash-lite-tts`). If flash-lite
rejects the stored voice, keep `GEMINI_TTS_MODEL` on the creation model. Create a second voice only
when you explicitly want a lite-specific id.

Run the daily workflow with `--vars '{"vdriver":"gemini"}'`. The default `vdriver` remains
`voicebox`.

## Renewal

A stored voice lasts 1 year (200 stored voices per project, shared with prompted voices). Before
`expire_time`, repeat export → create → replace the id in the operator map. Delete the scratch
clips when the new id is wired. Do not commit the wavs or the voice id.
