---
schema_version: 1
name: Record kk bot operator sessions and generate channel rails from them
status: todo
template: feature-impl
created_at: 2026-11-17T04:31:47.321Z
updated_at: "2026-11-17T05:12:58.647Z"
feature_id: A22

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 20
---

## 0382. Record kk bot operator sessions and generate channel rails from them

### Background

On 2026-11-16 four social rails (x, threads, linkedin, weibo) were repaired by hand: selectors were guessed, failed live, and were re-measured. Two of them (x, threads) were measured by an ad-hoc operator recorder — `kkBrowserLauncher` headed plus an injected click/keystroke listener writing `events.jsonl` and screenshots — and the measured selectors were right where the guessed ones were wrong (`.spur/context/memory.md`, 2026-11-16 "social rails" entry). This task turns that one-off recorder into a supported `kk bot` surface: record an operator session, normalize it to stable selectors, replay it without submitting, and generate a rail skeleton whose receipt comes from the platform's own response.

**Refine corrections (2026-11-16)**

- "four hand-measured 2026-11-16 sessions (x, threads, linkedin, weibo)" exist as recordings → only **x** (9 events) and **threads** (33 events) were recorded, under the gitignored `.spur/run/dogfood/2026-11-16-social/show-{x,threads}/events.jsonl`; linkedin and weibo were measured with probe scripts and have no transcript; the recorder source was never committed → R7 fixtures are x + threads (converted, redacted) plus one synthetic local-page session; linkedin/weibo recordings are out of scope (each channel's repair task records its own).
- The existing recordings carry `{t, url, kind: click|key, path, text, disabled}` only — no response bodies, no file-chooser selection, no visibility flag → they can drive normalizer/codegen step tests but not receipt tests; R4/AC3 are proved on the synthetic fixture.
- R4 "the X and weibo rails reported 'not published' … because they compared rendered text" → true for X only. Weibo refused because `picIdScript()` read a non-existent `window.config.pic_id`; it was fixed by intercepting `m.weibo.cn/api/statuses/uploadPic` (`awaitUploadedPicId`, `WEIBO_UPLOAD_PIC_PATH`). `pic_id` is an **upload** id, not a publish id → R4 now distinguishes upload ids (intermediate) from the submit response's publish id.
- "X CreateTweet returns rest_id" → not measured on 2026-11-16 (the X rail's receipt baselines the newest `/status/<id>`); kept as a hypothesis the first X recording confirms or refutes, not a design premise.
- "launches the existing named bot profile … reusing kkBrowserLauncher" → `openBot` (`packages/publish-harness/src/browser.ts:1348`) delegates adapter-bound bots (x-pub, threads-pub declare `browserSession`) to the plugin child process, where nothing can be instrumented → the recorder uses openBot's non-adapter branch (lease + `createKkBrowserLauncher` with borrowed ownership) for every bot.
- Lease leak on SIGINT: confirmed mechanism — ownership is released only on `context.once('close')` (`browser.ts:376`) and in `openBot`'s `finally`; a SIGINT kills the process before either runs, and stale leases are never auto-removed (`profile-lease.ts:12`, `:248`). The 2026-11-16 recorder additionally died with `TargetClosedError` when the operator closed the window (`show-x/session.log`).
- R8 "sp-code-implementation points at it" → that skill ships in the `@gobing-ai/spur` package, not this repo → owned-elsewhere, dropped. kk-web-automation / kk-publish are `plugins/kk/skills/web-automation` / `plugins/kk/skills/publish`.
- R8 "a repo rule requires a rail change to name its transcript" → `spur rule run` evaluates the tree, not a change → reframed as: every rail module carries a `// transcript:` header (path or `none — <reason>`), enforced by an `exit-code` rule.
- New verbs need an ADR-038 amendment first: each previous bot leaf (`exec`, `plan`) landed with a dated ADR-038 amendment, and the 2026-11-09 collection amendment explicitly ruled out new bot verbs before `plan` superseded it → Plan step 0.
- Status was already `todo` (promoted 2026-11-17T04:42 by system); priority/estimate were unset → filled (P2, 20 h).

### Requirements

- [ ] R1. **Recorder verb** — `kk bot record <bot> [-o <file>] [--include-text]` opens the bot's saved page headed under one profile lease (openBot's non-adapter path: `acquireProfileLease` + `createKkBrowserLauncher` with borrowed ownership, so `KK_BROWSER_CHANNEL` and SingletonLock apply) and writes an ordered transcript (schema in Design) of navigations, clicks, key events, file-chooser selections and every POST/PUT/PATCH response (url without query, status, JSON body capped at 64 KiB). Closing the window ends the recording normally (exit 0, transcript flushed). SIGINT/SIGTERM close the context, flush, release the lease and exit 130/143; no lease marker survives any exit path.
- [ ] R2. **Stable-selector normalization** — every recorded click/key target resolves to one selector by the fixed rank `data-testid` > `name` > exact `aria-label` > `role`+exact text > exact text > structural path. Class names never appear in an emitted selector. A target not visible at record time is dropped. A candidate matching more than one visible node is emitted as `{ambiguous: true, candidates: [...]}`, never silently narrowed. Normalization runs in the page at record time (it needs the live DOM) and is a pure function over a DOM snapshot so it is unit-testable.
- [ ] R3. **Codegen verb** — `kk bot codegen <transcript> --plugin <name> --operation <op> [--apply]` emits a rail skeleton: a selector constant table, the ordered steps over the existing harness helpers (`resolveSelector`, `uploadFile`, `expectOutcome` from `@gobing-ai/publish-harness`), and a receipt block (R4). Default writes to stdout; `--apply` writes `plugins/publishings/<plugin>/src/<operation>-rail.generated.ts` and refuses to overwrite an existing file. A step whose selector is ambiguous or structural-only aborts codegen (exit 1) naming the step index. Promoting the skeleton into the live rail is an operator edit.
- [ ] R4. **Receipt from the platform's response** — when the transcript holds a mutating response recorded after the last click on the submit selector, codegen emits a `page.waitForResponse` matcher (method + path) and the JSON path of the publish id/url, picked with `--receipt-path <dot.path>` or, when absent, the first string field named `id`/`*_id`/`rest_id`/`url` in that body. Upload responses before the submit are emitted as intermediate ids, never as the receipt. No receipt response in the transcript → codegen emits a `TODO receipt` stub and exits 0 with a stderr warning; it never emits a DOM-text comparison.
- [ ] R5. **Replay verb** — `kk bot replay <bot> <transcript> [--submit] [-o <dir>]` re-runs the steps headed under one lease, stopping before the submit step unless `--submit`. Per step it writes a screenshot and a state row `{step, url, selectorCount, editorTextLength, ok}` to `<dir>/replay.json`; exit 0 only when every executed step resolved exactly one visible node. Typed text in a redacted transcript replays as a fixed placeholder of the recorded length.
- [ ] R6. **Privacy** — typed text is stored as `{redacted: true, length}` unless `--include-text`; request/response headers and cookies are never written; response JSON fields whose key matches `/token|secret|password|cookie|session|auth/i` are replaced by `"<redacted>"`; the transcript file is mode 0600. `replay` and `codegen` refuse (exit 1) a transcript whose `redacted` header is false unless `--allow-unredacted`.
- [ ] R7. **Fixtures** — `packages/publish-harness/tests/fixtures/bot-record/` holds `x.json` and `threads.json` (converted from the two 2026-11-16 recordings, typed text redacted, structural paths kept so the normalizer's ranking is exercised) and `local-post.json` recorded against a local fixture page that issues a JSON POST. Codegen snapshot tests run on all three with no live browser.
- [ ] R8. **Skill and rule wiring** — `plugins/kk/skills/web-automation/SKILL.md` gains a record → replay → codegen playbook under its **enhance** lens; `plugins/kk/skills/publish/SKILL.md` points at it for rail authoring/repair. A rule `rail-transcript-header` (exit-code evaluator over `scripts/check-rail-transcripts.ts`) requires every `plugins/publishings/*/src/*rail*.ts` and `*flow*.ts` (excluding `.generated.ts`) to carry a `// transcript: <repo path>` or `// transcript: none — <reason>` line.

**Out of scope:** recording linkedin/weibo (and re-recording x/threads) — each channel's rail repair owns that; promoting generated rails into live rails; HAR capture or response replay/caching (rejected in the ADR-038 2026-11-09 amendment); recording inside an adapter child process; headless recording; cross-origin iframe events.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Recorder writes an ordered, redacted transcript and exits cleanly on window close (req: R1, R6)
  Given a local fixture page served by the test and a temporary bot profile and lease root
  When `recordBotSession` runs headless-overridden against it and the test clicks, types, picks a file and the page POSTs JSON, then the context closes
  Then the transcript lists navigate, click, key, file and response steps in order, typed text is `{redacted, length}`, no header/cookie appears, and the file mode is 0600
  (layer: packages/publish-harness/tests/bot-record.test.ts, real Playwright on a local page)

Scenario: AC2 — Interrupting the recorder leaves no lease behind (req: R1)
  Given a recording in progress against the local fixture page
  When the recorder process receives SIGINT
  Then it exits 130, the transcript is flushed, and the lease root holds no owner marker, so an immediate `acquireProfileLease` on the same profile succeeds
  (layer: packages/publish-harness/tests/bot-record.test.ts spawning a child bun process)

Scenario: AC3 — Normalizer ranks stable attributes and rejects classes, hidden nodes and ambiguity (req: R2)
  Given DOM snapshots with a data-testid node, a hashed-class-only node, a hidden duplicate of a visible button and two visible nodes with the same text
  When `normalizeTarget` resolves each
  Then the testid wins, no emitted selector contains a class, the hidden duplicate is skipped, and the duplicate-text target is emitted as ambiguous with both candidates
  (layer: packages/publish-harness/tests/bot-record-normalize.test.ts, pure function)

Scenario: AC4 — Codegen emits a compiling rail skeleton and aborts on an unstable step (req: R3, R7)
  Given the x, threads and local-post fixtures
  When `generateRail` runs on each
  Then the output matches the committed snapshot and type-checks against `@gobing-ai/publish-harness`, and a fixture with an ambiguous step fails naming that step index
  (layer: packages/publish-harness/tests/bot-codegen.test.ts)

Scenario: AC5 — Receipt reads the id from the captured submit response, never the DOM (req: R4)
  Given the local-post fixture whose submit response body carries `{"data":{"id":"p-123"}}` and whose page renders different text
  When codegen runs and the generated receipt block executes against the fixture page
  Then the verdict is published with id p-123 regardless of the rendered text, and an upload response recorded before the submit is not chosen as the receipt
  (layer: packages/publish-harness/tests/bot-codegen.test.ts)

Scenario: AC6 — Replay stops before submit and records per-step evidence (req: R5)
  Given the local-post fixture and the local fixture page
  When `replayBotSession` runs without `--submit`
  Then the page receives no POST, `replay.json` has one ok row and one screenshot per executed step, and a removed button makes the run exit nonzero on that step
  (layer: packages/publish-harness/tests/bot-replay.test.ts)

Scenario: AC7 — Unredacted or secret-bearing transcripts are refused and never committed (req: R6, R7)
  Given a transcript with `redacted: false` and the committed fixtures directory
  When replay or codegen loads it, and the secret scan runs over the fixtures and snapshots
  Then both refuse with exit 1 without `--allow-unredacted`, and no fixture or snapshot contains a cookie, token-like value or unredacted typed text
  (layer: packages/publish-harness/tests/bot-record-privacy.test.ts)

Scenario: AC8 — CLI leaves and the rail rule are wired (req: R1, R3, R5, R8)
  Given the built CLI and the repo rules
  When `kk bot record|codegen|replay --help` run and `spur rule run` executes
  Then each leaf prints its usage with exit 0, usage errors exit 2, and the rule passes on the tree and fails on a rail file missing its `// transcript:` header
  (layer: apps/cli/tests/bot-command.test.ts + scripts/tests/check-rail-transcripts.test.ts)

Scenario: AC9 — Live replay of the two recorded channels (req: R5)
  Given valid x and threads bot sessions and the committed x/threads fixtures
  When the operator runs `kk bot replay <bot> <fixture>` without `--submit`
  Then both runs stop before Post with every executed step ok, and `replay.json` plus screenshots are stored under `.spur/run/dogfood/<date>-bot-replay/` as operator evidence (live; not part of `bun run test`)
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-17T05:12:56.948Z

- **Submit step identification** — closed: codegen/replay take `--submit-text`; default is the last click before the last mutating response. Recorder stays dumb.
- **Fixture set** — closed: x + threads (converted) + one synthetic local-page session. linkedin/weibo recordings deferred to their rail repair tasks (owner: whoever files those repairs).
- **Live evidence** — closed: AC9 is operator-run live evidence, not part of `bun run test`; automated coverage runs on the local fixture page.
- **sp-code-implementation cross-link** — dropped: lives in `@gobing-ai/spur`; request upstream if wanted.
- **Rule shape** — closed: tree-level header check, not per-commit enforcement (spur rules evaluate the tree).

### Design

**WHAT.** Three new `kk bot` leaves over one new harness module. No new package, dependency or plugin kind.

**WHERE (frozen names).**

| Piece | Location | Exports |
| --- | --- | --- |
| Transcript schema + IO + privacy | `packages/publish-harness/src/bot-record.ts` (subpath export `@gobing-ai/publish-harness/bot-record`, mirroring `bot-collection`) | `BotTranscript`, `TranscriptStep`, `readTranscript`, `writeTranscript`, `redactJson` |
| Recorder | same module | `recordBotSession(name, options): Promise<RecordBotResult>` |
| Normalizer (pure) | `packages/publish-harness/src/bot-record-normalize.ts` | `normalizeTarget(snapshot: DomTargetSnapshot): NormalizedSelector`; also serialized into the page via `page.addInitScript` |
| Codegen (pure) | `packages/publish-harness/src/bot-codegen.ts` | `generateRail(transcript, {plugin, operation, receiptPath?}): {source, warnings}` |
| Replay | `packages/publish-harness/src/bot-replay.ts` | `replayBotSession(name, transcript, {submit, outDir}): Promise<ReplayResult>` |
| CLI leaves | `apps/cli/src/commands/bot.ts` (register beside `exec`/`plan`, same exit-2 usage override) | `record`, `codegen`, `replay` |
| Rule | `.spur/rules/structure/rail-transcript-header.yaml` + `scripts/check-rail-transcripts.ts` | — |

**Transcript schema (v1, JSON, 0600).**

```ts
interface BotTranscript {
    schemaVersion: 1;
    bot: string;
    startUrl: string;          // origin + pathname, query dropped
    recordedAt: string;        // ISO
    redacted: boolean;         // false only with --include-text
    steps: TranscriptStep[];
}
type TranscriptStep =
    | { i: number; t: number; kind: 'navigate'; url: string }
    | { i: number; t: number; kind: 'click'; url: string; target: NormalizedSelector; text?: string; submit?: boolean }
    | { i: number; t: number; kind: 'key'; url: string; target: NormalizedSelector; key: string }          // non-printable keys only
    | { i: number; t: number; kind: 'type'; url: string; target: NormalizedSelector; text: string | { redacted: true; length: number } }
    | { i: number; t: number; kind: 'file'; url: string; target: NormalizedSelector; fileName: string }   // basename only
    | { i: number; t: number; kind: 'response'; method: 'POST' | 'PUT' | 'PATCH'; url: string; status: number; body?: unknown; truncated?: boolean };
type NormalizedSelector =
    | { selector: string; rank: 'testid' | 'name' | 'aria' | 'role-text' | 'text' | 'path' }
    | { ambiguous: true; candidates: string[] };
```

Printable keystrokes coalesce into one `type` step per focused target (flushed on blur/click/non-printable key); that is what keeps typed text redactable as one length marker. `submit: true` is set by codegen input, not the recorder: the operator marks the submit click with `--submit-text <text>` on codegen/replay, defaulting to the last click before the last mutating response.

**Normalizer algorithm (R2).** In-page, on the event target walk up to the nearest interactive ancestor (`button, a, input, textarea, [role=button|link|textbox|menuitem], [contenteditable=true]`). Drop if `!checkVisibility()`. Try in rank order, accepting the first candidate whose `document.querySelectorAll` (or text match) count of **visible** nodes is exactly 1: `[data-testid="v"]`, `[name="v"]`, `[aria-label="v"]` (exact, never `^=`/`*=`), `[role="r"]:text-is("t")` (Playwright selector syntax, the form the rails already use), `text="t"`, then a structural path built only from tag names, `nth-of-type` and the stable attributes above. If the best candidate matches >1 visible node, emit `ambiguous` with up to 5 candidates. Classes are never read. The 2026-11-16 threads recording shows why: the nav `div[role="button"]` "New thread" has a hidden duplicate, so the visible-count rule is what picks the right node.

**Recorder lifecycle (R1).** Copy `openBot`'s non-adapter branch: `acquireProfileLease` → `createKkBrowserLauncher(undefined, {lease, physicalProfileDir}, …)` → headed launch → `page.exposeBinding('__kkRecord', …)` + `addInitScript(normalizer + listeners)` on the context (covers new pages/navigations) → `context.on('response')` filtered to mutating methods and `content-type: application/json` → `filechooser` via the injected `change` listener on `input[type=file]` (basename only). Steps append to an in-memory array and the file is rewritten atomically (tmp + rename) after each step, so a crash loses at most one step. Signals: `process.once('SIGINT'|'SIGTERM')` → `closeBotContext` → final write → `lease.release()` → `process.exitCode = 130|143`, same shape as `apps/cli/src/launch.ts:416`. Every awaited page call is guarded so `TargetClosedError` after a window close ends the recording instead of crashing (the 2026-11-16 recorder died exactly there). Adapter-bound bots are recorded through this path too; adapters are not consulted.

**Codegen output (R3/R4).** One TS module: `const SELECTORS = {...} as const` keyed `step<i>_<slug>`; `export async function run<Operation>(page: Page, input: {text: string; filePath?: string}): Promise<RailOutcome>` with `resolveSelector` → click / `page.keyboard.type(input.text)` (Draft.js/ProseMirror editors need real key events, measured on X and LinkedIn) / `uploadFile`; receipt: `const response = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '<path>')` armed **before** the submit click, then `expectOutcome` over the picked JSON path. Header comment: `// transcript: <path>` + `// generated by kk bot codegen — promote by hand`. Output must pass `bun run lint` unchanged (Biome style is emitted directly, single quotes, 4 spaces).

**Replay (R5).** Same lease/launch path as the recorder (headed). For each step: `navigate` → `page.goto`; `click`/`key`/`type`/`file` → count visible matches; `≠1` → row `ok:false`, stop, exit 1; else act. `file` uses a bundled 1×1 PNG from the fixtures when the recorded file is absent. Stop before the submit step unless `--submit`. `response` steps are assertions only under `--submit` (method + path observed).

**Exit codes.** 0 success, 1 operational failure (unstable step, refused transcript, replay mismatch, browser), 2 usage, 130/143 interrupted recording (transcript still written).

**Anti-patterns (do not implement).** Class-based or `nth-child`-only selectors; DOM-text receipts; HAR files or response replay; storing headers/cookies; recording through the adapter child; auto-promoting generated code into live rails; auto-removing a stale lease (the harness rule at `profile-lease.ts:12` stays); a second launcher or a new lease mechanism.

**Rejected alternatives.** Playwright `codegen` — it uses its own browser profile (no bot session/lease) and emits class/nth selectors and no receipt. Extending `runBotCollection` plans with UI steps — that runner is headless and collection-shaped (ADR-038 2026-11-09); replay needs headed stop-before-submit and per-step evidence.

**Concurrency.** Uncommitted operator edits sit in `plugins/publishings/{x-pub,threads-pub}/src/post-rail.ts` (+ untracked `x-pub/tests/post-rail.test.ts`); no wip tasks, one worktree. The rule step adds a header line to those files — do it after that work lands, or include the header in the same edit with the owner's consent.

**Handoff.** No dependent tasks. Channel rail repairs (x mask overlay, threads composer, linkedin trigger, weibo article) consume this surface; they are not part of it.

### Plan

- [ ] 0. ADR-038 amendment (dated) adding `bot record|codegen|replay` leaves, the transcript privacy contract and the no-HAR boundary; `docs/design/kk-bot-record-codegen.md` with the schema + normalizer contract; index row in `docs/04_DESIGN.md`. (R1, R3, R5)
- [ ] 1. `bot-record-normalize.ts` + tests first (AC3): rank order, class rejection, hidden-node drop, ambiguity. (R2)
- [ ] 2. `bot-record.ts`: schema, atomic writer (0600), `redactJson`, type-coalescing, `recordBotSession` with lease/launcher reuse, response capture, signal + TargetClosed handling; local fixture page under `packages/publish-harness/tests/fixtures/bot-record/page/`; AC1, AC2. (R1, R6)
- [ ] 3. Convert `.spur/run/dogfood/2026-11-16-social/show-{x,threads}/events.jsonl` to v1 fixtures (`x.json`, `threads.json`, typed text redacted) via a one-off script kept out of the repo; record `local-post.json` against the fixture page. (R7)
- [ ] 4. `bot-codegen.ts` + snapshot tests on the three fixtures; receipt path picking; abort on unstable step; AC4, AC5. (R3, R4)
- [ ] 5. `bot-replay.ts` + AC6; refuse unredacted transcripts; AC7 secret scan over fixtures/snapshots. (R5, R6)
- [ ] 6. CLI leaves in `apps/cli/src/commands/bot.ts` + `bot-command` tests; `docs/04_DESIGN.md` §1.12 surface in the same commit (T3); AC8. (R1, R3, R5)
- [ ] 7. Skill text: web-automation enhance-lens playbook; publish skill pointer. (R8)
- [ ] 8. Rule `rail-transcript-header` + `scripts/check-rail-transcripts.ts` + test; add `// transcript: none — predates 0382` to existing rail/flow modules (coordinate with the uncommitted x/threads edits); `spur rule run` clean. (R8)
- [ ] 9. Gate: `bun run lint`, `bun run test` (exit 0, per-file 90%), `bun run build`; then AC9 live replay of x and threads (operator sessions required) with evidence under `.spur/run/dogfood/<date>-bot-replay/`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature A22 (`docs/features/` A22), ADR-037/038 and amendments (`docs/00_ADR.md:1527-1562`), `docs/design/kk-noun-verb-bots.md`.
- Seams: `openBot` `packages/publish-harness/src/browser.ts:1348`; `createKkBrowserLauncher` `:253`; `attachOwnershipClose` `:376`; `uploadFile` `:804`; `expectOutcome` `:819`; `resolveSelector` `:1005`; `acquireProfileLease` `packages/publish-harness/src/profile-lease.ts:74`; signal pattern `apps/cli/src/launch.ts:416`; bot leaves `apps/cli/src/commands/bot.ts:355`.
- Evidence: `.spur/context/memory.md` 2026-11-16 social entries; `.spur/run/dogfood/2026-11-16-social/show-{x,threads}/` (gitignored, local only).
- Concurrent: uncommitted `plugins/publishings/{x-pub,threads-pub}/src/post-rail.ts`, untracked `plugins/publishings/x-pub/tests/post-rail.test.ts` (2026-11-16).

### History

- 2026-11-17T04:42:51.190Z backlog → todo (system)

