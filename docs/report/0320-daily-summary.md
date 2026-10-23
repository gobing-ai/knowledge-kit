# 0320 — Daily Summary episode funnel + supply context

Verification artifact for task 0320 (`Daily AI Voice Summary tab: render the real channel yield and
the episode funnel`). Frozen design: the task file's Design; ADR-035 amendment 2026-10-22 (G82).

## What shipped

- ADR-035 amendment (2026-10-22, G82): Daily may consume exactly ONE store aggregate — the 0319
  channels route — for supply CONTEXT on its Summary tab. Everything else stays artifacts-only;
  IT Content untouched.
- Contract: `DailyEpisodeFunnel` + `DailyFunnelExclusion` under `RunResults.summary.funnel`
  (`apps/board/src/contracts.ts:123`), schemaVersion stays 1.
- Manifest: `DAILY_VOICE_ARTIFACTS` grew to 28 specs (`apps/cli/src/board/manifest.ts:164`) — the
  eight funnel stage files plus floor/ceiling fallbacks; the four refusal specs share ONE duration
  file with distinct producer nodes (duration / generate / generate-fallback / generate-fallback2),
  so shape decides the gate and producer authorization decides who may write it.
- Projection: `projectFunnel` (`apps/cli/src/board/daily-voice.ts:511`) — counts from the run's own
  artifacts only, `evidence` ids are the fixed manifest ids (or `captured-settings`), gate precedence
  for a no-content run is measured duration refusal → script refusal → QC floor → empty pool →
  qc-empty → unknown; a content outcome has gate `null` (a refusal beside it is a
  `board.daily.funnel.contradictory` diagnostic, never a rewrite); refusal-cleared candidates stay
  unknown, never 0; pool-vs-annotated disagreement keeps BOTH numbers plus
  `board.daily.funnel.mismatch`; 100 rows / 200 chars bounds with `board.daily.funnel.truncated`.
- Reader: funnel artifact ids download as sanitized projections (`sanitizeFunnelArtifact`,
  `apps/cli/src/board/daily-voice.ts:676`; served at `apps/cli/src/board/reader.ts:520`) — counts and
  bounded rule/matched/refusal numbers only; parse failures degrade to `{note: 'malformed'}`; scraped
  doc bodies never leave the reader.
- Module: `SummaryPanel` renders `<FunnelPanel>` + `<SupplyPanel>` (`apps/board/src/daily-voice/
  index.tsx:442`); `funnelView` narrows and labels every gate (`apps/board/src/daily-voice/view.ts:350`,
  GATE_NAMES per precedence row); `parseWindowMs` + `supplyContextOf` (`view.ts:406/431`) build the
  half-open `[startedAt − captured window, startedAt)` interval — labeled CONFIGURED context because
  the extract ladder bounds are not persisted. The store query goes through the shared
  `BoardClient.storeChannels` on its own loopback `aggregateReaderOrigin`, reusing 0319's
  `ChannelYieldTable`/`PluginRunTable`; unknown input renders unknown and issues NO query; offline
  degrades the panel only (`storeOffline`); a run switch mid-flight discards the stale response.

## Fixture expectations (real artifacts, real DAOs, real Chromium)

`apps/cli/tests/board/daily-voice.test.ts` (39 tests) — pure `projectFunnel`: the real 2026-10-22
refusal (`8.9` measured vs `15`/`25`) resolves `episode-duration`; `audio-record 1075.296167` s
rounds to 17.9 minutes ONCE; every no-content gate from its own evidence; mismatch keeps both
values; truncation bounds; malformed inputs degrade; a content outcome beside a refusal is
contradictory-only. Reader surface: sanitized downloads (no `SECRET-BODY`), a script refusal is
accepted only from the run's own generate nodes, no producers → 404, oversized artifacts refused.

`apps/board/tests/installed-board.test.ts` — six new tests under
`Daily episode funnel and supply context (G82/0320)`: AC1/AC2 the supply interval matches the
board's own run row exactly (d-funnel `startedAt−2h` items counted, day boundary excluded);
AC3/AC4 evidence links, minutes, and the measured-refusal gate; the mismatch run keeps 4/7/6 side by
side with `not applicable — a content run has no gate`; every gate row appears exactly once across
d-funnel/d-script/d-floor/d-empty/d-qce/d-unk; AC5 store offline degrades only the supply panel and
a malformed pool shows unavailable; AC6 a run switch mid-flight (6 s reader delay) never shows the
previous run's funnel.

## Commands and evidence

| Command | Result |
| --- | --- |
| `bun run lint` (biome + full typecheck) | exit 0 |
| `bun run test` (full suite) | 4115 pass / 3 skip / 0 fail (exit 0) |
| `bun run build` (all workspaces) | exit 0 |
| `bun test apps/cli/tests/board/daily-voice.test.ts` | 39 pass, 0 fail |
| `bun test apps/cli/tests/board/manifest.test.ts` | 8 pass, 0 fail; manifest.ts coverage 100 % funcs / 100 % lines |
| `bun test apps/board/tests/daily-voice/view.test.ts` | 16 pass, 0 fail; view.ts coverage 100 % funcs / 100 % lines |
| `bun test apps/board/tests/installed-board.test.ts` (real Chromium, real reader, real packed install) | 30 pass, 0 fail |

Chromium was available in this environment (`chromium-1194`), so the installed-package acceptance
ran for real; no assertion was weakened or skipped.
