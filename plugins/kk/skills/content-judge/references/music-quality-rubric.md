# music-quality — music take evaluation rubric

Rubric id: **`music-quality`**. Loaded by `kk:content-judge` when the `kk-music` workflow (0403) or the
`kk:music-authoring` `review` operation judges a generated take. It is one more rubric section for the
existing verdict contract — **not** a second judge and not a second verdict shape.

The judge is reading a **bundle** (`4-judge-input.md`, written by `kk:music-authoring`): the brief, the
kk-rendered prompt text, the lyrics, the instance analysis and `checks.json` verbatim. It is not
listening to the take, and it must not pretend to.

## Scoring

| Criterion | Weight | Must-pass |
| --- | --- | --- |
| `checks.clean` — `<take>.checks.json` exists for the take and contains no row with `result: fail` | 0.20 | yes |
| `brief-adherence` — genre, instrumentation, tempo, key, vocal character and language match the brief's technical direction | 0.25 | no |
| `arrangement` — the take's section layout agrees with the brief's declared `structure` | 0.20 | no |
| `lyric-intelligibility` — the authored lyric text is singable in the declared `language` and carries the intended syllables | 0.15 | no |
| `hook` — a repeated, identifiable hook exists where the structure declares it | 0.10 | no |
| `production-artefacts` — no dead air, click, dropout or clipping artefact is recorded against the take | 0.10 | no |

Thresholds: `pass_threshold = 0.75`

Same scoring model as every other rubric (`rubrics.md` §Scoring model): `pass` = full weight,
`warn` = half, `fail` = zero; a must-pass `fail` is `FAIL` regardless of score.

`checks.clean` is the **only** must-pass criterion. Craft criteria are never must-pass, because a
craft judgement made without hearing the take cannot be a blocking violation: the worst it can do is
pull the score under 0.75 and produce `NEEDS_REVISION` with actionable feedback.

## Measurement discipline (applies to every criterion)

1. **Measured facts come from `checks.json`, cited, never re-derived.** Duration, silence, BPM, key,
   section count and delivery loudness exist as rows with `id`, `measured`, `threshold`, `unit`,
   `source` and `result`. A finding that cites any of them quotes the value **with its unit and its
   `source`**, and names the file — e.g. `duration.target: measured 34.2 s, threshold "20–40", unit s,
   source ffprobe 8.1.2 (3-takes/…wav.checks.json)`. Never write "about 30 seconds"; either quote the
   row or do not cite a number.
2. **Never score a criterion from the prompt text.** The prompt is an instruction, not evidence of what
   the model produced. "The brief asked for gated snare, so `brief-adherence` passes" is a
   fabrication — grade it `warn` with "the bundle carries no evidence for this element".
3. **Never score by ear.** The judge has no audio. Anything only audible (mix balance, timbre,
   artefacts not recorded as rows) is `warn` with detail "not observable from the bundle".
4. **`source` is the authority, so name it.** `ffprobe <version>` (duration), `ffmpeg <version>
   silencedetect` (silence), `ffmpeg <version>` (delivery loudness/true peak), `lyria instance
   analysis` (BPM/key/sections — a **model estimate**, which is why those rows are `warn`-only).
5. **A `warn` row never becomes a `fail` finding.** BPM/key/section disagreement is a craft input
   (toward `NEEDS_REVISION`), not a violation; only the measured `fail` rows in `checks.json` can fail
   the take, and they do so through `checks.clean`.

## Criterion guidance

### `checks.clean` (must-pass, weight 0.20)

Read `<take>.checks.json` from the bundle. It **must exist** — an absent file is a `fail` of this
criterion, not a caveat. Then:

- any row with `result: "fail"` → this criterion is `fail` → the verdict is `FAIL`, and the finding
  quotes that row (`id`, `measured`, `threshold`, `unit`, `source`, and its `note` when present);
- every row `pass` or `warn` → `pass`, quoting the row count and the `warn` ids.

Rows that typically fail and what they mean: `duration.target`/`duration.clip` (the take missed the
duration band — re-brief the length and iterate), `silence.leading`/`silence.trailing` (dead air at an
edge), `analysis.present` (the analyze step's result has not reached the check, so the take is
unmeasured in the sense this rubric needs — stop and fix the input, do not judge around it),
`delivery.*` (only present after `master`; a true-peak or loudness miss blocks delivery).

### `brief-adherence` (weight 0.25)

Compare the brief's `style` (technical direction: genre, BPM, key, instrumentation, production) and
`language` against what the bundle can actually attest:

- the instance analysis' BPM and key (`analysis.bpm`, `analysis.key` rows) — agreement is `pass`,
  disagreement is `warn` quoting both the measured value and the brief's band;
- instrumentation, vocal character and production texture — attestable only if the analysis object or
  the take metadata names them; otherwise `warn`, "not observable from the bundle".

### `arrangement` (weight 0.20)

Compare the brief's `structure[]` (`at`, `section`, `note`) against the analysis' section list
(`analysis.sections` row: measured count vs the brief's count) and any section detail in the analysis
object. A count mismatch is `warn` (the analysis is an estimate) with the measured value quoted. A
structure the brief declares but the analysis cannot see is `warn`, never `pass`: absence of evidence
is not agreement.

### `lyric-intelligibility` (weight 0.15)

- `instrumental: true` brief → `pass`, detail "instrumental brief; no lyric text is sent", weight
  intact: the criterion is satisfied by construction, not waived.
- lyrics present in the bundle → grade the **text**: tags match the structure's sections, the
  language matches the brief's `language`, lines are singable (syllable counts consistent inside a
  section, no prose sentences standing in for a hook line). Mix-level intelligibility stays
  unobservable → say so in the detail.
- lyrics absent because the model wrote its own → `warn`, detail "model-authored lyrics are not in the
  bundle". Never invent them.

### `hook` (weight 0.10)

The hook must be locatable from the bundle: a repeated line in the lyric text, or a declared hook
section in `structure`. If the bundle can neither show nor exclude a hook, `warn`. Do not claim the
take "has a catchy chorus"; claim only what the text and the declared structure show.

### `production-artefacts` (weight 0.10)

Cite the `silence.*` rows (dead air at either edge) and, when the take has been mastered, the
`delivery.*` rows. `pass` when those rows are `pass` and no artefact is recorded; `warn` when a row is
`warn`, or when an artefact class (clipping, dropout, clicks, unnatural vocal timbre) is only audible
and therefore unattested; `fail` only if `checks.json` itself carries the failing row — in which case
`checks.clean` already failed and this criterion simply corroborates it.

## Verdict mapping

| Situation | Verdict |
| --- | --- |
| Any `checks.json` row with `result: "fail"`, or a missing `checks.json` | `FAIL` (via `checks.clean`) |
| No must-pass failure, `score >= 0.75` | `PASS` |
| No must-pass failure, `score < 0.75` | `NEEDS_REVISION` (feedback names the directive for one `iterate` round) |

`confidence` is self-assessed per the contract: `HIGH` when every criterion was grounded in a bundle
artifact and every number quoted from a row, `MEDIUM` when some element was attestable only through
the model's own analysis, `LOW` when the bundle is incomplete enough that the craft score could flip
(the verdict is still emitted, with the gap named).

## Emit the existing contract

Write **one** verdict file (`verdict_path` from the review step), with the fields the
`content-judge` contract already defines — nothing added, nothing renamed:

```json
{
  "verdict": "PASS | FAIL | NEEDS_REVISION",
  "confidence": "HIGH | MEDIUM | LOW",
  "rubric": "music-quality",
  "score": 0.0,
  "summary": "<one paragraph, every claim traceable to the bundle>",
  "findings": [{ "criterion": "checks.clean | brief-adherence | arrangement | lyric-intelligibility | hook | production-artefacts", "status": "pass | fail | warn", "detail": "<quoted row or bundle evidence>" }],
  "feedback": ["<one directive for the next brief>"],
  "content_ref": "<the take path>",
  "evaluated_at": "<ISO-8601>"
}
```

`findings[].criterion` values come from the table above and nowhere else. `content_ref` is the take
(`3-takes/<slug>-<model>-<instanceId>.<ext>`), not the bundle path. Do not write a
`music-verdict.json`, do not add a measured-values field, do not add a per-criterion score field: if
you want the numbers in the record, quote them inside `detail`, where the contract already puts
evidence.
