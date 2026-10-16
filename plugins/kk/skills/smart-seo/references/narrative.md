# Smart SEO — the validated narrative contract

The narrative is **optional** and **fully validated**. It selects and orders references into the
materialized `audit.json`; it cannot introduce a measurement, unit, diagnosis or prediction. When
it is absent or rejected the report is still delivered with `narrativeStatus: omitted|rejected`
plus a deterministic summary — an optional agent failure is never an audit failure.

## 1. Schema (schema version 1)

```json
{
  "schemaVersion": 1,
  "runId": "<audit.runId>",
  "auditDigest": "<sha256 of the exact audit.json bytes>",
  "sections": [
    {
      "heading": "summary | priorities | limits",
      "claims": [
        { "template": "fact | action | limit", "evidenceRef": { "artifact": "audit.json", "jsonPointer": "/facts/<key> | /actions/<id> | /limits/<key>" } }
      ]
    }
  ]
}
```

Hard limits and exact shapes — every key below is the *only* accepted key at its level:

| Rule | Value |
| --- | --- |
| Root keys | exactly `schemaVersion`, `runId`, `auditDigest`, `sections` |
| `schemaVersion` | `1` |
| `runId` | must equal the audit's `runId` |
| `auditDigest` | must equal the sha256 of the materialized `audit.json` (stale or unknown digest rejects) |
| `sections[]` keys | exactly `heading`, `claims`; at least one section; `claims` non-empty |
| `heading` | one of `summary`, `priorities`, `limits` |
| `claims[]` keys | exactly `template`, `evidenceRef`; unknown keys anywhere (including a free-prose `text`) reject the whole narrative |
| `template` | one of `fact`, `action`, `limit` |
| `evidenceRef` keys | exactly `artifact`, `jsonPointer`; `artifact` must be `audit.json` |
| `jsonPointer` | exactly two segments: the template's own collection plus one key — `/facts/<key>` for `fact`, `/actions/<actionId>` for `action`, `/limits/<key>` for `limit` |
| Pointer targets | `fact` must address a recorded scalar observed fact (`/facts/pages_visited`, `/facts/requests_made`, `/facts/total_bytes`, …); `action` must address an existing action **by stable id** (never an array index); `limit` must address a recorded limit (`pagesVisited`, `requestsMade`, `totalBytes`, `elapsedSeconds`, `hitLimit`) |
| Bounds | ≤ 32 KiB raw and ≤ 30 claims |

Prototype keys (`__proto__`, `constructor`, `prototype`) and out-of-collection pointers are refused.
Rendering is method-owned: each claim becomes an `**Observed fact**`, `**Planned action**` or
`**Recorded limit**` line with the audit's own value, unit and source, and Markdown-escaped.

## 2. Worked example

Given an audit whose `runId` is `8f2c…`, whose `auditDigest` is the real sha256 of `audit.json`,
and whose actions include `SEO-title_missing-0f115db062b7`:

```json
{
  "schemaVersion": 1,
  "runId": "8f2c1d0e-…",
  "auditDigest": "<sha256 of audit.json>",
  "sections": [
    {
      "heading": "summary",
      "claims": [
        { "template": "fact", "evidenceRef": { "artifact": "audit.json", "jsonPointer": "/facts/pages_visited" } },
        { "template": "fact", "evidenceRef": { "artifact": "audit.json", "jsonPointer": "/facts/requests_made" } }
      ]
    },
    { "heading": "priorities", "claims": [{ "template": "action", "evidenceRef": { "artifact": "audit.json", "jsonPointer": "/actions/SEO-title_missing-0f115db062b7" } }] },
    { "heading": "limits", "claims": [{ "template": "limit", "evidenceRef": { "artifact": "audit.json", "jsonPointer": "/limits/hitLimit" } }] }
  ]
}
```

Renders as (in `report.md`, section 3):

```markdown
### Summary

- **Observed fact** `pages_visited` = `12` count — source: `crawl.json`
- **Observed fact** `requests_made` = `34` count — source: `crawl.json`

### Priorities

- **Planned action** `SEO-title_missing-0f115db062b7` (high, P1) — Fix title missing — 3 affected page(s), effort band 1

### Limits

- **Recorded limit** `hitLimit` = `none`
```

To produce this in a run: read `<work_dir>/audit.json`, compute its sha256 over the exact file
bytes, keep the same `runId`, then write the object to `<work_dir>/narrative.json` **before**
`seo-report` runs (the workflow's `agent.run` step does exactly that, with
`answerFile: <work_dir>/narrative.json`). Replying `{}` is the documented way to decline: the
report then falls back to its deterministic summary.

## 3. Rejection cases (each rejects the entire narrative)

| Case | Diagnostic shape |
| --- | --- |
| Free prose added to a claim (`text: "…"`) or any unknown key | `sections[0].claims[1]: unknown key "text"` |
| Heading outside the allow list (`"Overview"`) | `sections[0]: heading "Overview" is not an allow-listed heading` |
| Template mismatch with the pointer (`fact` + `/limits/…`) | `template "fact" requires a pointer into /facts, got "/limits"` |
| Invented fact or limit key | `unknown fact id "domain_authority"` / `unknown limit id "ranking_position"` |
| Invented or misspelled action id, or an array index (`/actions/0`) | `unknown action id "0"` |
| Pointer deeper or shallower than two segments (`/facts/a/b`) | `jsonPointer "…" must address exactly one record (collection/key)` |
| Stale digest (audit re-scored after the narrative was written) | `narrative auditDigest does not match the materialized audit.json digest (stale or unknown digest)` |
| Wrong run id | `narrative runId "…" does not match the audit runId` |
| Non-object root, non-JSON bytes, empty sections, > 32 KiB, > 30 claims | `narrative root must be a JSON object` / `narrative is not valid JSON: …` / `narrative sections must not be empty` |

On rejection the stage writes `narrative-diagnostics.json` beside the audit, sets
`report.json.narrativeStatus: 'rejected'`, and renders the deterministic summary labeled
`**Narrative rejected**`. Never edit the saved `narrative.json` to force acceptance, and never move
a rejected claim into the deterministic summary by hand: the summary is method-owned.

## 4. Advisory prose lives outside the report

The validated narrative deliberately cannot carry commentary. If the operator asks for
explanation, interpretation or an action plan in prose, that is the **skill's** output: keep it in
conversation (or a separate operator-authored document) and:

- label every statement as measurement, heuristic, model judgment or unknown (see `method.md`);
- cite the artifact plus the field (`report.json` action id, `checks.json` row, `audit.json`
  `/facts/*`) for every number;
- mark specialist advice outside the collected evidence as **consultation**, naming the missing
  evidence and the source that would be needed;
- make no promise about rankings, citations, traffic, revenue or crawler behavior, and propose no
  change that mutates the site — the audit is read-only, and any remediation is an operator action.
