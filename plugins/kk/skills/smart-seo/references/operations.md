# Smart SEO — operations

Setup, run, progress, and failure handling for the `kk-smart-seo` audit. The workflow is the
orchestrator; `kk` owns every step (ADR-007). Nothing here mutates a site.

## 1. Resolve the KK package root

Both the stages and the decision catalogs live in the **installed** package, not in a checkout:

```bash
# The real path of the executable that is actually running (follows symlinks):
readlink -f "$(command -v kk)"          # -> <pkg>/dist/index.js
PKG_ROOT="$(dirname "$(dirname "$(readlink -f "$(command -v kk)")")")"
```

`kk stage run` resolves `plugins/kk/scripts/kk-workflow-stages.ts` next to its own entry: a real
checkout uses the checked-in runner, an installed entry always uses its own package copy. An
unrelated ancestor `plugins/` directory is never selected, so a run from an unrelated cwd is safe.

## 2. Register the SEO decision catalogs (required for the integrated workflow)

`decisions.paths` in the consumer project config (`.spur/config.yaml`) is the whole search path.
**Append** one entry — never replace the list:

```yaml
decisions:
  paths:
    - <existing entry>                     # keep every existing entry
    - <PKG_ROOT>/plugins/kk/decisions       # appended: the 4 SEO catalogs, 22 decisions
  maker: <existing maker>                   # keep the maker and makers: mapping untouched
```

`seo-preflight` with `require_decisions=true` (the workflow's own call) fails with this pointer
when the catalogs are not served:

```text
seo-preflight: SEO decision catalogs are not served — missing catalog file(s): kk-seo-site.yaml, ...
Registration fix: append `<kk-package-root>/plugins/kk/decisions` to the project config `decisions.paths`
(.spur/config.yaml), preserving every existing entry and maker setting, then re-run preflight.
```

Verify without dispatching a maker (configuration evidence, never model health):

```bash
spur decision list --json     # must serve the 22 kk-seo-* ids
spur decision show kk-seo-page-type --json   # -> catalog, layer, effective maker + source
spur decision status --json   # -> load errors, duplicate ids, per-decision effective maker
```

Collection-only stage use (`require_decisions=false`) and the explicit offline fixture mode need
no catalogs. Do not run an audit that silently writes user-global configuration; the append above
is a one-time operator setup, and it is repeated only when an upgrade changes the resolved
package root.

**The catalogs' declared schema must resolve from where they live.** Each shipped SEO catalog
declares `$schema: "@gobing-ai/spur/schemas/decision-catalog.schema.json"`, and Spur resolves that
schema through the module tree above the catalog's own directory. A global install satisfies this
by construction (both packages are siblings in the global tree); with a project-local KK install,
keep `spur` resolvable from the installed package's location or `decision status --json` reports
the catalogs as `loadErrors` (`Cannot resolve package schema …`) and preflight fails. A load error
is a setup defect to fix, never a reason to fall back to a maker default silently.

## 3. Options file

Write a UTF-8 JSON object (≤ 64 KiB, strict schema — unknown keys are refused) and pass its path
as data, never as shell source:

```json
{
  "url": "https://example.com",
  "locale": "en-US",
  "business_context": "",
  "max_pages": 60,
  "max_depth": 5,
  "max_requests": 200,
  "deadline_seconds": 600,
  "semantic_pages": 20,
  "max_pairs": 10,
  "max_keywords": 10,
  "max_decision_calls": 320,
  "performance": false,
  "visibility_file": "",
  "fixture": ""
}
```

| Field | Meaning and bounds |
| --- | --- |
| `url` | Required HTTP(S) URL or bare domain (bare becomes HTTPS). Userinfo, nonstandard ports, local/reserved addresses and malformed hostnames are refused. |
| `locale` | BCP-47; describes the report audience and the imported query market. It never assumes the site's language. |
| `business_context` | Optional operator context ≤ 2,000 UTF-16 units. It is context, not website evidence. |
| `max_pages` / `max_depth` | 60 / 5 by default; maxima 200 / 10. The page quota counts every attempt, including blocked, redirect and error records. |
| `max_requests` / `deadline_seconds` | 200 / 600 by default; maxima 500 / 1800. One shared quota and deadline covers robots, sitemaps, pages, probes and link targets. |
| `semantic_pages` / `max_pairs` / `max_keywords` | 20 / 10 / 10 by default; maxima 60 / 40 / 30. Selection is deterministic (homepage, observed depth/inlinks, URL tie break). |
| `max_decision_calls` | 320 by default, maximum 1000. Every attempt consumes one; there is no retry on an unknown-charge call. Exhaustion is an explicitly partial assessment. |
| `performance` | `false` by default. `true` requests PSI mobile/desktop and CrUX for at most 3 selected pages; the stage shares a 300 s deadline and a 12-call cap. |
| `visibility_file` | Optional normalized local JSON snapshot (§4). Never an arbitrary provider dump. |
| `fixture` | Explicit offline fixture **directory**. With a fixture, network access and real maker dispatch are forbidden. Production never falls back to fixture data. |

## 4. Audit scope — the submitted host plus its exact `www` toggle

Scope is the normalized submitted hostname with **one** leading `www.` removed when present, or
added when absent — nothing else. `shop.example.com` admits `shop.example.com` and
`www.shop.example.com` only: no registrable apex, no sibling subdomains, and default ports stay
origin-specific. Off-scope redirects and links are recorded, never followed; `www`/non-`www` and
HTTP/HTTPS transitions are observations, not defects. There is no browser rendering and no outbound
external-link fetching in this version: state that assessment as **not collected** rather than
assuming a result.

## 5. Imported visibility snapshot
```json
{
  "schemaVersion": 1,
  "siteOrigin": "https://example.com",
  "locale": "en-US",
  "source": "search-console-export|analytics-export|manual",
  "collectedAt": "2026-10-01T00:00:00Z",
  "measurementKind": "measured",
  "rows": [{ "query": "example query", "url": "https://example.com/a", "clicks": 4, "impressions": 120, "position": 8.5, "citations": 2, "sampleCount": 500, "platform": "chatgpt" }]
}
```

Maximum 1 MiB / 500 rows; strings bounded; counts are finite nonnegative numbers; `position` ≥ 1;
`citations` ≤ `sampleCount` with `platform` required; any `url` must belong to the audit scope.
Unknown properties, a conflicting locale or site identity, a future timestamp, or evidence older
than 90 days fails validation before use. Keywords come from this data — never invented volumes.

## 6. Run the workflow

```bash
spur workflow run <PKG_ROOT>/plugins/kk/workflows/kk-smart-seo.yaml \
  --vars '{"options_file":"/abs/path/options.json"}' --quiet
```

Leave `work_dir` empty: `seo-preflight` allocates `.works/kk-smart-seo/<UTC-stamp>-<runId>` with
create-new semantics (an existing non-empty directory is refused) and writes the resolved absolute
path to `.spur/run/<runId>-seo-work-dir.txt`, which the workflow reads back into `work_dir` before
collection. A fixed `work_dir` must name an absent or empty directory.

Stages: `preflight → collect → check → enrich → judge → score → narrative → report`, terminal
`done | partial | failed`. `done` means every requested stage assessed its eligible evidence — not
that the site has no SEO issues. `partial` is successful artifact delivery with missing requested
evidence (an unavailable optional PSI/CrUX/typed-decision input is never a failure). `failed` is the
sole failure state.

Individual stages stay independently callable for review and re-scoring:

```bash
kk stage run seo-preflight <work_dir> <options_file> [run_id] [require_decisions]
kk stage run seo-collect <work_dir>
kk stage run seo-check <work_dir>
kk stage run seo-enrich <work_dir>
kk stage run seo-judge <work_dir>
kk stage run seo-score <work_dir> [new_revision_dir]
kk stage run seo-report <work_dir>
```

## 7. Progress

- `spur workflow trace <run-id>` — the action trace; the state id tells you which stage is running.
- `.spur/run/<runId>-seo-work-dir.txt` — the run-bound workspace path (never guess it).
- `.spur/memory/runs/<run-id>.md` — the two-file run record.
- Stage progress goes to stderr and is captured in the run record; long collection stages are
  bounded by `max_requests`/`deadline_seconds`, so a run always terminates.

Artifacts under the work dir, one run id shared by all of them: `options.json`, `manifest.json`,
`crawl.json`, `checks.json`, `judgments.json`, `performance.json`, `visibility.json`, `audit.json`,
`digest.md`, `narrative.json` (optional), `report.json`, `report.md`. Every JSON object carries
`schemaVersion`, `methodVersion`, `runId`, `createdAt`, `inputDigest` and predecessor digests;
wrong run, version or digest is a hard error. Writes are sibling temp file + rename, so a reader
never sees a partially written value. The saved audit is durable under `.works/`, not volatile
`.spur/run/`.

## 8. Failure handling

| Symptom | Handling |
| --- | --- |
| Missing/unserved SEO catalogs | Apply §2, re-run. Preflight failure text names the missing files/ids. |
| Invalid options | Fix the named field; the file is validated before any collection. |
| `work_dir` already populated | Use the run's own bound directory, or a new empty one. Never clear a directory from a previous run — preflight never deletes it. |
| Network policy refusal (local/reserved address, peer mismatch, redirect off-scope) | The collected observation is recorded as unavailable/blocked. Do not work around it: an off-scope or non-public target is out of the audit's trust boundary. |
| Budget exhaustion (`limits.hitLimit`) | Report it as a limit. Never present an exhausted crawl as a complete one. |
| Optional evidence unavailable (no PSI/CrUX key, insufficient sample, 429, timeout) | Recorded as an availability outcome; the report is `partial`, never failed and never a zero score. |
| Maker fallback / low confidence | The judgment stays `unknown`/`review`. It is not a site defect and not a measurement. |
| Malformed predecessor artifact | Hard error, nonzero exit — malformed input is never reinterpreted as an empty result. |
| Narrative absent or rejected | The report is still delivered with `narrativeStatus: omitted|rejected` and a deterministic summary; an optional agent failure is not an audit failure. |
| Cancellation | Active sockets and decision children are aborted, completed artifacts are preserved with a cancellation marker, and no new requests or decisions start. |

## 9. Offline rescoring

Score a saved audit again without touching the network or the source run:

```bash
kk stage run seo-score <saved-work_dir> <new-revision_dir>   # revision dir must be absent/empty
kk stage run seo-report <new-revision_dir>
```

The revision copies the validated bounded inputs (`options.json`, `manifest.json`, `crawl.json`,
`checks.json`) beside a fresh `audit.json`, keeps the original `runId` and adds a new `revisionId`.
Source artifacts stay immutable, so a comparison between revisions reads two durable directories.
Do not compare scores across runs with different coverage: `coverage` records the denominators,
and the score is undefined (`null`) when no row of that category is applicable.
