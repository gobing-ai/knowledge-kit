# 2026-11-17: first complete scheduled kk news day (task 0376)

Filed 2026-11-17 ~19:30 PST from the production scheduler's own records. No manual, dry or dummy run
counts toward R1 to R3. The hand-run reruns later the same day are listed only so they are not mistaken
for the scheduled run.

## Environment

| Field | Value |
| --- | --- |
| Host | `HomeServer.local` (`LocalHostName HomeServer`), macOS 27.0.1, arm64 |
| Installed build during all three ticks | `kk` 0.1.19 (upgraded to 0.1.20 at 19:02 PST, after the 17:00 tick) |
| Scheduler | `spur self serve` on this host. `.spur/config.yaml` sets no timezone, so cron uses the host's local time, `America/Los_Angeles` (PST). The 04:30 queue row was created at 12:30Z, which matches. |
| Effective works root | `/Users/robin/xprojects/knowledge-kit/.works` (`~/.config/kk/config.yaml` `works_dir`) |

## The three ticks (`queue-jobs.json`)

| Tick (PST) | Queue row | Command issued | Spur run | Settled as |
| --- | --- | --- | --- | --- |
| 04:30 `kk-daily-ai-voice` | `6bd1e329…` completed 04:31:56 | `kk news generate --publish --skip-review --agent pi-dsv4.1-flash-cc` | `kk-news-generate-20261117-1794918601004` done | **no-content**: the floor gate found 8 candidates worth an estimated 13.1 min, under the 15 min floor (`trace-0430-generate.txt`) |
| 07:00 `kk-daily-publish3` | `7b92d716…` completed 07:01:14 | `kk news publish --window overseas-rss --unattended --agent pi-dsv4.1-flash-cc` | `kk-publish-20261116-1794927600552` done, exit 0 | window `partial`, 1 of 4 published, for the previous day (20261116) |
| 17:00 `kk-daily-publish3-cn-peak` | `7793e7df…` completed 17:02:39 | `kk news publish --window cn-peak --unattended --agent pi-dsv4.1-flash-cc` | `kk-publish-20261117-1794963601012` done, exit 0 | window `none`, 0 of 1 published |

All three payloads name a `kk news` verb that exists in 0.1.19. None mentions `scripts/daily-ai-news.ts`
and none has a `last_error` (R2).

## Receipts (R3)

- `receipt-0700-overseas-rss.json` and `receipt-1700-cn-peak.json`: copied unchanged from the run
  directories. Neither contains secrets.
- **The 04:30 generate receipt is gone (operator accepted the stand-in on 2026-11-17).** `.works/kk-news-generate/20261117/schedule-receipt.json` was
  overwritten by the hand-run `kk-news-generate-20261117-1794941164368`, started at 10:46 PST. That
  run's floor-refusal file and `pool-gate.json` replaced the scheduled run's copies in the same way. The
  scheduled run is preserved only in its queue row and its Spur trace (`trace-0430-generate.txt`). This
  is a reconstruction, not the receipt.

## Status outputs

- `status-20261117.json`: `kk news status --run-date 20261117`, captured after the day. `generate`,
  `gate` and `progress` describe the final hand-run, because every run writes into the same run directory.
- `status-20261116.json` and `status-20261116-overseas-rss.json`: the previous day's status, overall
  and for the overseas window alone.
- **Previous-day overseas selection:** 20261116, the episode from hand-run
  `kk-news-generate-20261116-1794852605948`. The 04:30 tick on 2026-11-16 was refused with exit 5 when
  the checkout no longer matched the installed `kk`.

## Failures, named (R4)

| Window / row | Outcome | Cause |
| --- | --- | --- |
| 04:30 generate | no-content | The floor gate worked as designed: 13.1 min estimated against a 15 min floor. This is not a fault. |
| overseas-rss `linkedin-pub.post` | failed, effect unknown | `linkedin composer did not open after the share box (selector drift)`. The plugin asks for `profile-check.ts login`. |
| overseas-rss `x-pub.post`, `threads-pub.post` | uncertain | `planned` with no `sent` or `failed` event in this run (`publish-events.jsonl` 15:00:14Z). Their only results are from the 2026-11-16 16:47 hand-runs. |
| overseas-rss `jike-pub.post` | omitted | `bundle has no variant 'social:jike'` |
| cn-peak `weibo-pub.article` | failed, effect none | First try: `cover attachment: no outcome observed within 60000ms`. Retry: `'下一步' button: no outcome observed within 30000ms`. |
| xhs | `mode off` in both windows | xhs stayed off as R1 requires. No gate was bypassed. |
