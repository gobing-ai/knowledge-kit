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
kk bot record <bot> [-o <file>] [--include-text]      # headed session → transcript JSON
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
Drop it when `checkVisibility()` is false. Then accept the FIRST tier whose candidate matches exactly
one **visible** node:

1. `[data-testid="v"]`
2. `[name="v"]`
3. `[aria-label="v"]` — exact, never `^=`/`*=`
4. `[role="r"]:text-is("t")` — the Playwright form the rails already use
5. `text="t"`
6. the structural path (tags, `nth-of-type`, and the stable attributes above)

A class name is never read, so hashed `r-*`/`mxtl*` families cannot reach a selector. A tier matching
more than one visible node is emitted as `{ambiguous: true, candidates: […]}` (capped at 5, each a
structural path) — never silently narrowed. The snapshot is built in the page (it needs the live DOM)
and resolved by the pure function on the host, so the ranking exists once.

## Receipt

Codegen arms `page.waitForResponse` **before** the submit click and reads the publish id from the
recorded response body — never from rendered DOM text. The receipt candidate is the last mutating
response recorded after the last click, so an upload response (`pic_id`, `media_id`) is an
intermediate id and never the receipt. The id path is `--receipt-path` or the first string field
named `id` / `*_id` / `rest_id` / `url`. No candidate → an explicit `TODO receipt` plus a stderr
warning; a DOM-text comparison is never emitted.

## Privacy

Typed text is `{redacted: true, length}` unless `--include-text`; the transcript is mode 0600 and
written tmp+rename so a crash loses at most the in-flight step; response bodies are capped at 64 KiB;
response JSON keys matching `/token|secret|password|cookie|session|auth/i` become `"<redacted>"` at
any depth; request/response headers and cookies are never written. `replay`/`codegen` refuse a
transcript whose `redacted` flag is false unless `--allow-unredacted`.

## Replay

Same lease/launch path as the recorder (headed). A transcript with no leading `navigate` step opens its
`startUrl` first (unless the page is already there). Per step: `navigate` → `page.goto`; every other step
waits up to 15 s for a first visible match (a live page renders the next control after the previous
click), then counts visible matches and stops the run when the count is not exactly 1 (`≠1` is a
finding, not a retry). Stops before the submit step unless `--submit`. A redacted `type` step replays as a
placeholder of the recorded length. Evidence is one screenshot per executed step plus
`replay.json`; both are written even when the run stops early.

## Fixtures

`packages/publish-harness/tests/fixtures/bot-record/` holds `x.json` and `threads.json` (converted
from the two 2026-11-16 recordings, redacted, structural paths kept) and `local-post.json` (synthetic,
carrying a submit response). Codegen and privacy tests run on them with no live browser. The x
fixture generates; the threads fixture aborts on its one structural-only step — which is the abort
arm working on real data, not a defect.

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
  `bun run test`. The live replay of x/threads (AC9) on 2026-11-17 rejected both converted fixtures,
  which is correct behavior: x's `tweetTextarea_0` now resolves two visible nodes on `/compose/post`,
  and threads' nav "New thread" control is not visible on the web home (the live rail already uses the
  inline composer). Both fixtures need fresh `kk bot record` sessions; evidence is under
  `.spur/run/dogfood/2026-11-17-bot-replay/`.
- Injection and hosted-captcha pages, cross-origin iframe events and headless recording are out of
  scope by design (ADR-038 amdt).
