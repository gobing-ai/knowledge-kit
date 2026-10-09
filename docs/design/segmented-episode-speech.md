# Voice2 segmented episode speech

**Status:** proposed (feature G13, ADR-034). Not implemented.

Voice2 turns one VoiceScript into one episode file by synthesizing **sections**, not by sending the whole script in one request. Voice1 keeps today's one-request generate.

## 1. Section

A section is the opening, one spoken news item, or the closing. Six selected items produce eight sections. The VoiceScript already contains more segments than that: `buildNewsVoiceScript` chunks each item's facts at `MAX_FACT_SEGMENT_CHARS` (300) inside one script (`plugins/generations/dailynews-gen/src/script-builder.ts`). Those chunks stay inside their item section. The YAML is not required to contain N+2 segments.

Grouping reads the already-written `24-script/<date>_08_script_voicescript.yaml`. It does not change the builder.

- The first segment is the opening. The builder pushes one opening (`script-builder.ts` opening segment).
- The last segment is the closing. The builder pushes one outro.
- Each middle item runs from the next fact chunk through the insight segment whose `gap_ms` is the inter-item breath (1200 today). Fact chunks (`gap_ms` 500) stay in that item.
- The item-section count must equal `items.length` in `24-script/<date>_08_script-write_plan.json` when that file exists. A mismatch fails the stage before any request.

A section whose text still exceeds one driver request may be split into internal pieces. Those pieces may cache on their own text. The rewrite unit reported to the operator remains the section: a change to the section text invalidates that section.

## 2. Where it runs

`dailyGenerate` (`plugins/kk/scripts/daily-stages.ts`) owns grouping, per-section requests, the section cache, and the speech join. No new workflow node. `kk-daily-ai-voice2.yaml` passes a sixth argument, `section_concurrency`. Absent or empty, the five-argument command stays today's one-shot job, which is what `kk-daily-ai-voice.yaml` calls. That file is not edited.

`dailyIntro` still prepends `.works/kk-daily-ai-voice/AI每日资讯_8秒播客片头.mp3` (the `intro_music` var) after speech exists. The sting is not a section and is not sent to a voice driver. `dailyEpisodeDuration` still reads `30-audio/<date>_11_generate_content.json` `metadata.duration` and refuses an episode outside 15–20 minutes. Publish-prep still reads `metadata.mp3Path ?? audioPath`.

## 3. Cache and resume

Section files live at `30-audio/sections/<date>/<index>-<role>.wav` with a sidecar `<index>-<role>.json`.

The cache key is sha256 of the section's spoken text, the voice profile id, and the resolved driver id (`gemini-tts`, `voice-gen`, or `omni-voice-gen`), separated by NUL.

A section is reused when the sidecar hash matches and the wav exists. Resume is that set: missing audio, or a hash mismatch. It is not "the latest index."

The episode content json is rewritten when any section was synthesized again or the joined speech file is missing. `metadata.qc.passed` on the previous episode file does not skip that work. A rewritten speech file clears `introMerged` so the intro step runs again.

## 4. Join

Section wavs join in index order. The boundary uses the section's own trailing `gap_ms` as silence, and the join matches the sample rate and mono s16 normalization `dailyIntro` already applies. The intro step then prepends the sting and extends `metadata.duration`.

## 5. Over-long episodes

Before any new request, estimate seconds as section characters divided by the driver's rate in `plugins/kk/scripts/daily-voice-style.zh.md` (gemini ≈ 3.3 字/秒, Voicebox robin-news ≈ 6.3 字/秒), plus the 8-second sting. If that estimate is already over 20 minutes, the stage exits nonzero and names the longest sections. It does not rewrite the script.

When an operator shortens a section's spoken text, the next run synthesizes only the sections whose hash changed. Unchanged section files stay. A measured duration still outside 15–20 minutes fails at `dailyEpisodeDuration`, as today. Caps stay: insight 380, intro/outro 150, lead 80, and the 15–20 minute window.

## 6. Concurrency

`section_concurrency` defaults to 1 when voice2 sets it. This delivery converts one section at a time. A value above 1 fails loud. Scheduling more than one request at a time is deferred (inventory I9): each extra request spends the Gemini daily quota (gemini-3.8-flash-tts Tier 1 is 100 requests/day), and a spur `type: parallel` node does not fan out (ADR-019, ADR-031).

## 7. Account refusal and the Gemini probe

The existing probe stays. If the Gemini probe fails **before any section request of this episode**, the run falls back to voicebox for the whole episode. The cache key includes the driver, so Gemini files are not played as voicebox speech.

If the probe succeeded and a later request is an account-window refusal (quota / 429), the run stops. It does not request the remaining sections and it does not switch driver mid-episode. Finished section files stay. The next run on the same driver resumes the missing sections.

A refusal of the whole account is not fixed by starting at the next section.

## 8. Safety stamp

`safetyDigest` (`plugins/kk/scripts/kk-workflow-stages.ts`) is sha256 of the article content json, NUL, and the VoiceScript yaml. Shortening a section edits that yaml, so the stamp no longer matches and publish-prep refuses until the stamp is issued again. Synthesizing an unchanged section again does not change those bytes, so the stamp stays valid.

## 9. Rejected

| Option | Why rejected |
| --- | --- |
| One request per 300-character chunk | More requests than the rewrite unit. Use it only inside a section that still exceeds one request. |
| A checkpoint inside one whole-file render | The driver does not resume a failed job. The episode is still one spend. |
| Raise the 15–20 minute window or the script caps | Duration stays the authority. |
| Change `script-builder.ts` so both workflows emit sections | That changes voice1's script bytes. Grouping stays on the voice2 generate side. |
| A spur parallel node for sections | The engine does not fan out that way. Concurrency belongs inside `dailyGenerate`, and above 1 is deferred. |
