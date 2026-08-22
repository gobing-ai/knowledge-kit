# aihot-ingest Plugin Design

## 1. Purpose

`aihot-ingest` (`plugins/ingestions/aihot-ingest`) is a knowledge-kit ingestion plugin that fetches curated AI news items from `aihot.virxact.com` and emits a normalized `Doc[]` JSON array per ADR-007, ADR-009, and the Ingestion Plugin Specification.

## 2. CLI Surface

```bash
kk executor run aihot-ingest --in <config.json> --out <docs.json>
```

`config.json`:

| Field | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `limit` | No | 10 | Maximum items, integer 1–100 |
| `cursor` | No | - | Incremental-sync cursor |
| `stateFile` | No | - | JSON cursor-state path |

The directly executable plugin entry additionally accepts `--limit`, `--cursor`, and `--state-file`;
direct flags override `--in` config. `kk executor run` keeps the generic plugin contract and forwards
only `--in` / `--out`.

## 3. Endpoints & Sync Logic

1. **Snapshot Mode (No cursor):**
   - Queries `GET /api/v1/selected/snapshot?limit=<limit>&fields=default`
   - Returns latest curated news snapshot and initial `cursor`.
2. **Incremental Changes Mode (With cursor or state-file):**
   - Queries `GET /api/v1/selected/changes?cursor=<cursor>&limit=<limit>`
   - Maps `upsert.item` records and ignores `remove` records in the run's daily-news output.
3. **State Persistence:**
   - Reads `{ cursor }` before fetch and atomically persists the returned cursor only after output succeeds.
   - Missing state starts a snapshot; malformed state fails loud rather than silently resetting the cursor.
4. **Partial Item Failure:**
   - Invalid snapshot items or change records emit a bounded warning and are skipped without discarding valid records.

Response validation follows the official [Aihot OpenAPI v1 contract](https://aihot.virxact.com/openapi-v1.json).

## 4. Doc Mapping

| Aihot Item Field | Doc Output Field | Notes |
| :--- | :--- | :--- |
| `id` | `id` | Falls back to a sha256 hash of the canonical source URI if empty |
| `title` | `title` | Article headline |
| `links.original` \| `links.aihot` | `sourceUri` | Canonical source link |
| `summary` \| `title` | `body` | News summary text |
| `text/markdown` | `mediaType` | Standard text media type |
| `source.name`, `publishedAt`, `category`, `attribution`, etc. | `metadata` | Structured article attribution and provenance |

## 5. Seams & Boundaries

- All HTTP requests go through `AihotDeps` with `fetch: FetchLike` (defaulting to `globalThis.fetch` in production); tests may inject `warn` to capture partial-record diagnostics.
- Tests inject custom `fetch` stubs to ensure 100% offline verification with zero global state mutations.
- The user agent identifies `aihot-ingest`; it does not embed a shared actor UUID. Aihot documents actor IDs as optional analytics in its [agent guide](https://aihot.virxact.com/agent).
