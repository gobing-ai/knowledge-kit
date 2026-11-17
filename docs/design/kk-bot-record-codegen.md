# kk bot record / codegen / replay — measured rails instead of guessed selectors

Status: shipped (task 0382, A22; ADR-038 amdt 2026-11-17) · Complements: ADR-027, ADR-038, ADR-050.

Selector guessing is the measured failure mode of this repo's social rails. On 2026-11-16 four rails
(x, threads, linkedin, weibo) were repaired by hand; the two that were recorded with an ad-hoc
operator recorder (x, threads) had the right selectors where the guessed ones were wrong — the
Threads "New thread" control, for example, has a hidden duplicate, so a text locator clicked an
invisible node. This surface turns that one-off recorder into three `kk bot` leaves plus one harness
module set.

## Surface

```text
kk bot record <bot> [-o <file>] [--include-text] [--url <url>]  # headed session → transcript JSON
kk bot codegen <transcript> --plugin <name> --operation <op> [--apply]
                                   [--receipt-path <dot.path>] [--allow-unredacted]
kk bot replay <bot> <transcript> [--submit] [-o <dir>] [--submit-text <text>]
                                 [--file <path>] [--allow-unredacted]
```

Exit codes: `0` success · `1` operational failure (unstable/ambiguous step, refused transcript,
replay mismatch, browser) · `2` usage (including a non-slug `--plugin`/`--operation`, or `--apply`
outside a tree holding `plugins/publishings/<name>/plugin.json`) · `130`/`143` interrupted recording
(transcript still written, lease released). The recorder parks the SIGINT listener Playwright installs at
launch — it exits 130 straight after closing the browser, which beat the async flush and leaked the lease
— and the CLI leaf maps the reported signal to the exit code because `main()` returns its own.

## Where it lives

| Piece | Module | Notes |
| --- | --- | --- |
| Transcript schema, IO, privacy, recorder | `packages/publish-harness/src/bot-record.ts` (`@gobing-ai/publish-harness/bot-record`) | atomic 0600 write, `redactJson`, `applyRecordedEvent`, `recordBotSession` |
| Normalizer (pure) | `packages/publish-harness/src/bot-record-normalize.ts` | `normalizeTarget`, `selectorFor`; page-side script in `bot-record.ts` |
| Codegen (pure) | `packages/publish-harness/src/bot-codegen.ts` | `generateRail` |
| Replay | `packages/publish-harness/src/bot-replay.ts` | `replayBotSession` (page-injected), `replayBot` (lease + launcher) |
| Rule | `.spur/rules/structure/rail-transcript-header.yaml` + `scripts/check-rail-transcripts.ts` | tree-level header check |

No new package, dependency or plugin kind. The CLI loads the three sub-paths lazily beside
`browser`/`bot-collection`, so `kk bot --help` never needs a browser binary.

## Transcript schema (v1)

```ts
interface BotTranscript {
    schemaVersion: 1;
    bot: string;
    startUrl: string;      // origin + pathname, query dropped
    recordedAt: string;    // ISO
    redacted: boolean;     // false only with --include-text
    steps: TranscriptStep[];
}
type TranscriptStep =
    | { i; t; kind: 'navigate'; url }
    | { i; t; kind: 'click'; url; target: NormalizedSelector; text?; submit? }
    | { i; t; kind: 'key'; url; target; key }              // non-printable keys only
    | { i; t; kind: 'type'; url; target; text: string | { redacted: true; length } }
    | { i; t; kind: 'file'; url; target; fileName }        // basename only
    | { i; t; kind: 'response'; method: 'POST'|'PUT'|'PATCH'; url; status; body?; truncated? };
type NormalizedSelector =
    | { selector: string; rank: 'testid'|'name'|'aria'|'role-text'|'text'|'path' }
    | { ambiguous: true; candidates: string[] };
```

Printable keystrokes coalesce into one `type` step per focused target (flushed by a click or a
non-printable key) — that is what keeps redacted text a single length marker. `submit` is codegen
input, not recorder output: the operator marks the submit click with `--submit-text`, defaulting to
the last click.

## Normalizer contract (rank order is the contract)

In-page, on the event target walk up to the nearest interactive ancestor
(`button, a, input, textarea, select, [role=button|link|textbox|menuitem], [contenteditable=true]`).
Drop it when `checkVisibility()` is false or it sits under `[aria-hidden="true"]` / `[inert]` (rendered
but unreachable — X keeps its background composer there behind the compose modal). Then accept the
FIRST tier whose candidate matches exactly one **visible** node:

1. `[data-testid="v"]`
2. `[name="v"]`
3. `[aria-label="v"]` — exact, never `^=`/`*=`
4. `role=r[name="t" s]` — Playwright's role engine with an exact accessible name; `:text-is` on the
   role node matches only a direct text child, so span-wrapped labels (Threads) resolved 0
5. `text="t"`
6. the structural path (tags, `nth-of-type`, and the stable attributes above)

A class name is never read, so hashed `r-*`/`mxtl*` families cannot reach a selector. A tier matching
more than one visible node is emitted as `{ambiguous: true, candidates: […]}` (capped at 5, each a
structural path) — never silently narrowed. The snapshot is built in the page (it needs the live DOM)
and resolved by the pure function on the host, so the ranking exists once.

## Receipt

Codegen arms `page.waitForResponse` **before** the submit click and reads the publish id from the
recorded response body — never from rendered DOM text. The receipt candidate is the last mutating
response after the last click whose endpoint (method + pathname) the click introduced — one that did
not already fire before it. An upload response (`pic_id`, `media_id`) is therefore an intermediate id,
and a polled endpoint is never the receipt: live x refreshes `HomeTimeline`/`update_subscriptions`
after `CreateTweet`, and Threads' polled `graphql/query` carries other users' post ids (2026-11-17).
Only when every post-click endpoint was already polling does it fall back to the last response. The id path is `--receipt-path` or the first string field
named `id` / `*_id` / `rest_id` / `url`. No candidate → an explicit `TODO receipt` plus a stderr
warning; a DOM-text comparison is never emitted.

## Privacy

Typed text is `{redacted: true, length}` unless `--include-text`; the transcript is mode 0600 and
written tmp+rename so a crash loses at most the in-flight step; response bodies are capped at 64 KiB (by `content-length` and by the parsed size, since compressed responses omit the header);
response JSON keys matching `/token|secret|password|cookie|session|auth/i` become `"<redacted>"` at
any depth; request/response headers and cookies are never written. `replay`/`codegen` refuse a
transcript whose `redacted` flag is false unless `--allow-unredacted`.

## Replay

Same lease/launch path as the recorder (headed). A transcript with no leading `navigate` step opens its
`startUrl` first (unless the page is already there). Per step: `navigate` → `page.goto`; every other step
polls up to 15 s until a visible match outside `[aria-hidden="true"]` / `[inert]` (the recorder's
rule) exists — a live page renders the next control after the previous click, and waiting on any
visible match returned on x's aria-hidden background composer before the modal mounted — then counts
and stops the run when the count is not exactly 1 (`≠1` is a finding, not a retry); the surviving
node is the one acted on. Stops before the submit step unless `--submit`. A redacted `type` step replays as a
placeholder of the recorded length. Evidence is one screenshot per executed step plus
`replay.json`; both are written even when the run stops early.

## Fixtures

`packages/publish-harness/tests/fixtures/bot-record/` holds `x.json` and `threads.json` (live
`kk bot record` sessions, redacted, run through `bun run format` — the recorder writes plain 2-space
JSON) and `local-post.json` (synthetic, carrying a submit response). Codegen and privacy tests run on
them with no live browser. Both replayed live on 2026-11-17 with every step resolving one node,
stopped before Post (`.spur/run/dogfood/2026-11-17-bot-replay/{x,threads}-rec4/`); x generates a
`CreateTweet` receipt (`data.create_tweet.tweet_results.result.rest_id`), threads a
`configure_text_only_post` one (`media.id`). Record at the browser's default zoom: zoom changes the CSS width, Threads
then swaps in a responsive nav, and a selector from that layout does not resolve at the pinned
1280×720 viewport replay uses.

## Rule

`rail-transcript-header`: every `plugins/publishings/<plugin>/src/*rail*.ts` and `*flow*.ts`
(generated rails excluded) carries `// transcript: <repo path>` or `// transcript: none — <reason>`
within its first 20 lines. A bare `// transcript: none` fails: the reason is the reviewable part.

## Anti-patterns (do not implement)

Class-based or `nth-child`-only selectors · DOM-text receipts · HAR capture or response replay ·
storing headers or cookies · recording inside an adapter child process · auto-promoting generated
code into live rails · auto-removing a stale lease · a second launcher or lease mechanism.

## Known gaps (2026-11-17)

- The recorder (AC1/AC2) and replay (AC6) run against local pages in real headless Chromium in
  `bun run test`. Live replay of x/threads (AC9) on 2026-11-17 surfaced seven defects, all fixed the
  same day — besides the three below, the render wait ended on a visible aria-hidden twin, the
  receipt picked x's trailing `update_subscriptions` poll, every rail without a file step imported
  an unused `uploadFile` (a `noUnusedLocals` failure once promoted; the generated fixtures are now
  type-checked in `bun run test`), and the 64 KiB response-body cap read only `content-length`, so
  x's compressed HomeTimeline (300 KB of other users' posts) reached the fixture — the cap now also
  measures the parsed body, and `x.json` was trimmed to what the fixed recorder writes: X's second `tweetTextarea_0` is the `aria-hidden` background composer (reachability rule
  above); the role-text tier's `:text-is` missed span-wrapped labels (role engine above); and the
  Threads recording's text "New thread" button lives in a nav that is `display:none` at 1280 px — the
  recording was made at a different effective width (default-zoom rule above). Evidence is under
  `.spur/run/dogfood/2026-11-17-bot-replay/`.
- Injection and hosted-captcha pages, cross-origin iframe events and headless recording are out of
  scope by design (ADR-038 amdt).
