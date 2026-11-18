# Board evidence DTO — current news runs and verified voice2 history (0391)

Status: implemented (0391). Companion to `docs/design/daily-ai-news-editorial-delivery.md` §Board.
Declared for task 0390 (the deliverables UI) to consume without re-deriving the shapes.

## Routes

All routes are the Board reader's existing read-only loopback surface: the configured exact Board
origin only, the owning project only, browser-supplied paths never authorized, every byte read
through the contained workspace reader (no traversal, no following symlinks out, 1 MiB text cap).

| route | served since | body |
| --- | --- | --- |
| `GET /api/workflows/<w>/runs/<id>/results` | 0252 | `RunResults` (voice2 history: unchanged; news runs: the news projection below) |
| `GET /api/workflows/<w>/runs/<id>/config` | 0252 | `RunConfig` (unchanged) |
| `GET /api/workflows/<w>/runs/<id>/artifacts/<artifactId>` | 0252 | bytes/preview (news ids added, see manifest) |
| `GET /api/workflows/<w>/runs/<id>/evidence` | **0391** | the `RunEvidence` envelope below |

`<w>` is one of the captured workflows (`kk-news-generate`, `kk-daily-ai-voice2`, `kk-itc`,
`kk-collect`, `kk-article-generate`). Authorization is the Spur run identity + project ownership;
the capture record is required by `results`/`config`/`artifacts` (404 without one) but NOT by
`evidence` — see "Uncaptured attempts".

## `RunEvidence` envelope (`evidence` route)

```jsonc
{
  "schemaVersion": 1,
  "workflow": "kk-news-generate",
  "runId": "kk-news-generate-20261117-1763370000000",
  // null when the attempt has no capture record (launched before binding).
  "capture": {
    "capturedAt": "2026-11-17T09:00:00.000Z",
    "stamp": "20261117",
    "settings": { "skip_review": "true" },
    "definitionDigest": "sha256:…" // optional
  },
  // Authorized Spur state — present for captured AND uncaptured attempts.
  "run": { "id": "…", "status": "done", "startedAt": "…", "completedAt": "…" },
  // The full projection for captured runs; null for uncaptured attempts.
  "results": { "…RunResults…" },
  "diagnostics": [{ "code": "board.…", "message": "…" }]
}
```

### Uncaptured attempts (0391 AC)

An attempt launched before capture binding answers `200` with `capture: null`, `results: null`,
authorized Spur `run` state, and exactly one diagnostic:

```jsonc
{ "code": "board.evidence.uncaptured",
  "message": "Run '…' has no Board capture record; only Spur-authorized run state is available and fixed artifacts stay unknown." }
```

That is the whole answer for such a run: fixed artifacts are `unknown`, never invented. A record
that exists but does not parse is `422 board.capture.invalid` (same as the other routes).

## `RunResults.summary` for `kk-news-generate` (the news DTO)

The envelope and artifact descriptors keep the shipped `RunResults` schema (schemaVersion 1);
`summary` is the news projection:

```jsonc
{
  "status": "done", "startedAt": "…", "completedAt": "…",
  "outcome": "done",               // "no-content" | launcher receipt status | null when unrecorded
  "generation": {
    "outcome": "done",
    "gate": { "status": "PASS" },  // pool-gate.json: "PASS" | "EMPTY" | recorded-but-unknown
    "launch": {                    // schedule-receipt.json, staleness-checked
      "status": "done", "runId": "…", "startedAt": "…", "finishedAt": "…",
      "reason": null, "stale": false
    },
    "engines": [                   // the loud voice chain from recorded DAG action rows
      { "node": "voice",          "state": "failure", "attempts": [{ "status": "failed", "timing": "12s" }] },
      { "node": "voice-fallback", "state": "success", "attempts": [{ "status": "passed", "timing": "40s" }] }
    ],
    "progress": { "…the 0378 status projection (nodes/edgesKnown)…" }
  },
  "publishing": {
    "bundle": {                    // the frozen bundle's identity, never payload digests
      "identity": "20261117-kk-news-generate-…", "runDate": "20261117",
      "parentRunId": "kk-news-generate-…", "title": "每日AI乱炖 · 20261117",
      "variants": ["podcast", "xhs"], "safety": "pass"
    },
    "windows": [
      {
        "window": "after-generate",
        "recordedStatus": "full",  // outcome.<window>.json's own status; null when absent/unbound
        "provenance": {            // identity checks binding plan/receipts to THIS attempt
          "dateMatch": true, "bundleMatch": true, "parentMatch": true, "digestMatch": true
        },
        "targets": [
          {
            "id": "podcast-cn", "tier": 1, "mode": "live", "target": "podcast-cn",
            "status": "succeeded", "effect": "confirmed", "url": "https://…", "guid": "…",
            "finishedAt": "…", "error": null,
            "evidence": { "plan": "4-publish/plan.after-generate.json",
                          "receipt": "4-publish/receipts/podcast-cn.json" }
          },
          { "id": "xhs-cn", "status": "planned", "…": "…no receipt recorded…" },
          { "id": "rss-overseas", "status": "skipped", "error": "mode: off", "evidence": { "plan": "…", "receipt": null } }
        ]
      }
    ]
  },
  "counts": { "artifactsAvailable": 12, "artifactsTotal": 27,
              "targetsSucceeded": 1, "targetsFailed": 0, "targetsUncertain": 0, "targetsPlanned": 1,
              "windowsFull": 1, "windowsPartial": 0, "windowsNone": 0 }
}
```

Scenario contract (each observable, all under `summary`):

| scenario | where it shows |
| --- | --- |
| in-flight attempt | `run.status` running; engines `pending`; windows carry plans only |
| no-content day | `outcome`/`generation.outcome` = `no-content` (the gate's verdict file) |
| failed voice, fallback succeeded | `engines` rows; audio artifacts authorized via the fallback chain |
| missing capture | `capture: null`, `results: null` + `board.evidence.uncaptured` |
| superseded workspace | `availability: "superseded"`, publish bytes withheld, marker diagnostic |
| publish provenance mismatch | `provenance.digestMatch: false` + `board.publish.receipt-mismatch`; the receipt's send facts stay unsurfaced, status `uncertain` |
| malformed recorded file | `board.publish.plan-invalid` / `receipt-invalid` / `outcome-invalid`; contents never surfaced |
| outcome/receipt disagreement | `board.publish.outcome-disagreement`; both files stay surfaced as recorded |

## Honesty rules (binding for 0390)

1. Anything the run did not record is `null`/`unavailable` — never inferred from timestamps,
   directory names, or engine state.
2. Semantic generation outcomes come from recorded result files (`pool-gate.json`,
   `run-report.summary.txt`, `schedule-receipt.json`), never from workflow execution status.
3. Publish facts bind by identity (run id, bundle identity, run date, plan digest); a mismatched
   file is a diagnostic plus a withheld fact, never a rewritten status.
4. Dummy rehearsals never make a window `full` (the matrix's own rule); `recordedStatus` is the
   outcome file's recorded word, and missing receipts read as not succeeded.
5. Diagnostics reference artifacts by id and fixed workspace-relative evidence paths — never a
   client-supplied path.

## News artifact ids (the `artifacts` route)

`pool-gate`, `no-content`, `episode-pool`, `episode-annotated`, `episode-qc-rejections`,
`episode-exclusions`, `episode-candidates`, `episode-floor-refusal`, `episode-plan`,
`episode-curated-exclusions`, `script-plan`, `editorial-verdict`, `script`, `article-body`,
`article-content`, `cover`, `safety-verdict`, `safety-report`, `audio`, `audio-record`,
`episode-duration`, `episode-duration-refusal`, `cards-index`, `cards-content`, `variants-safety`,
`bundle`, `report`. Funnel-shaped ids are sanitized through the shared funnel guard (counts and
bounded rows only); verdict artifacts validate their `confidence` against the shared vocabulary.
