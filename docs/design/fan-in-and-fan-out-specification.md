# Fan-In Merge & Fan-Out Publish Specification

This specification defines the CLI surface, data contracts, exit codes, deduplication, and retry semantics for `fanin` (N→1 `Doc[]` merge) and `fanout` (1→N `Content` multi-target publish). It fulfills **Task 0033** (Feature **J**) and feeds target sections in `03_ARCHITECTURE.md` and `04_DESIGN.md`.

---

## 1. CLI Surface & Boundary Justification (R1, R3)

### 1.1 Sibling Commands vs `invoke` Extension

`kk invoke` is explicitly constrained by ADR-006 as a **single-plugin invoker** (`kk invoke <plugin> --in <path> --out <path>`), not a DAG execution engine.

To respect this boundary while providing sequential fan-in/fan-out capabilities:
- **`kk fanin`** and **`kk fanout`** are added as **sibling subcommands** to `invoke`.
- They are pure utility tools owned by `kk` for sequential file aggregation and multi-target dispatch.
- Neither subcommand manages workflow DAG execution or state transitions (which remain owned by `spur workflow`).

```text
knowledge-kit invoke <plugin> --in <f> --out <f>
knowledge-kit fanin --in <f1> [--in <f2> ...] --out <out.json> [--dedupe <rule>]
knowledge-kit fanout --content <content.json> --target <p1> [--target <p2> ...] --out <result.json> [--retry-from <prior-result.json>]
```

### 1.2 `fanin` CLI Specification
| Flag / Arg | Type | Required | Description |
|---|---|---|---|
| `--in <file>` | string (repeatable) | yes (>=1) | Input `Doc[]` JSON files to merge |
| `--out <file>` | string | yes | Output merged `Doc[]` JSON file path |
| `--dedupe <rule>` | enum (`id` \| `uri` \| `none`) | no (default: `id`) | Deduplication rule for merging |

### 1.3 `fanout` CLI Specification
| Flag / Arg | Type | Required | Description |
|---|---|---|---|
| `--content <file>` | string | yes | Source `ContentSchema` JSON file path |
| `--target <plugin>` | string (repeatable) | yes (>=1) | Target publish plugin names to invoke |
| `--out <file>` | string | yes | Aggregate `Result` JSON file path written upon completion |
| `--retry-from <file>` | string | no | Prior `Result` JSON file to skip already-successful targets |

---

## 2. Fan-In Merge Semantics (R2)

`fanin` takes $N$ `Doc[]` JSON files and merges them into a single deduplicated `Doc[]` array.

### 2.1 Deduplication & Identity Rule
- **Primary Key**: `Doc.id`. Ingestion plugins MUST derive `id` deterministically from canonical source identifiers.
- **Duplicate Conflict Resolution**: When two or more documents across inputs share the same `id`:
  1. The **first encountered** `Doc` in CLI `--in` order forms the primary body and top-level fields.
  2. Provenance metadata is merged (see §2.2).
- **Secondary Dedupe (`--dedupe uri`)**: Deduplicates by `sourceUri` if set, using identical merge precedence.

### 2.2 Provenance Field Convention
Merging preserves source origin inside `metadata.sources`:
- Every merged `Doc` receives `metadata.sources: Array<{ file: string, sourceUri?: string, ingestedAt?: string }>`.
- If a document appears in multiple `--in` files, all source entries are appended into `metadata.sources` to retain complete lineage.

### 2.3 Ordering Guarantee
The output array retains stable ordering:
1. Primary ordering follows the sequence of input files passed via `--in`.
2. Secondary ordering within each file preserves the exact document array index.
3. Duplicates removed during deduplication do not alter the sequence of first-seen documents.

---

## 3. Fan-Out & Partial-Success Result Schema (R4)

`fanout` sequentially invokes each named target publish plugin, aggregating outcomes into a unified `Result` schema.

### 3.1 Aggregate Partial-Success `ResultSchema`
The aggregate outcome is written to `--out` conforming to the extended `ResultSchema`:

```ts
export interface TargetOutcome {
    target: string;
    ok: boolean;
    status: 'published' | 'failed' | 'skipped';
    url?: string;
    id?: string;
    error?: string;
    durationMs?: number;
}

export interface AggregateResult {
    ok: boolean;               // true iff ALL targets succeeded
    summary: {
        total: number;
        succeeded: number;
        failed: number;
        skipped: number;
    };
    targets: TargetOutcome[];   // per-target detail records
    metadata?: Record<string, unknown>;
}
```

---

## 4. Exit-Code Contract & Hardening Reconciliation (R5)

`fanout` reconciles partial success with the fail-loud guarantees established in tasks 0023 and 0025:

| Condition | `Result.ok` | `summary` | Exit Code | Rationale |
|---|---|---|---|---|
| **All Succeeded** | `true` | `succeeded == total` | `0` | Clean execution |
| **Partial Success** | `false` | `succeeded > 0 && failed > 0` | `1` | Fail-loud requirement: non-zero signals incomplete pipeline state to `spur workflow` while per-target outcomes record individual successes. |
| **All Failed** | `false` | `succeeded == 0` | `1` | Complete failure |
| **CLI / Input Error** | `false` | N/A | `2` | Malformed flags, invalid `--content` JSON, or unresolvable plugin |

---

## 5. Retry Mechanism (`--retry-from`) (R6)

A subsequent `fanout` execution can resume from a partial-success `Result` JSON file:

```bash
knowledge-kit fanout \
  --content article.json \
  --target surfdash --target medium --target xhs \
  --retry-from prior-result.json \
  --out final-result.json
```

### 5.1 Retry Behavior
1. `fanout` inspects `prior-result.json`.
2. Any target listed with `status: "published"` (or `ok: true`) in `prior-result.json` is **skipped**.
3. Skipped targets are recorded in `final-result.json` with `status: "skipped"` and their prior `url`/`id` preserved.
4. Only failed or un-attempted targets are invoked.
5. Exit code for the retry run reflects the new aggregate result (`0` if all remaining targets succeed).

---

## 6. Worked Example (R7)

### Scenario
One `content.json` published to 5 targets: `surfdash`, `medium`, `juejin`, `qiita`, `devto`.
- `surfdash`, `medium`, `juejin` succeed.
- `qiita` (rate limited) and `devto` (auth failure) fail.

### Result JSON (`--out result.json`)
```json
{
  "ok": false,
  "summary": {
    "total": 5,
    "succeeded": 3,
    "failed": 2,
    "skipped": 0
  },
  "targets": [
    {
      "target": "surfdash",
      "ok": true,
      "status": "published",
      "url": "https://surfdash.io/posts/2026-08-02-fan-in-merge",
      "id": "surf_98213",
      "durationMs": 1420
    },
    {
      "target": "medium",
      "ok": true,
      "status": "published",
      "url": "https://medium.com/@gobing/fan-in-merge-98213",
      "id": "med_4412",
      "durationMs": 2100
    },
    {
      "target": "juejin",
      "ok": true,
      "status": "published",
      "url": "https://juejin.cn/post/73912839128",
      "id": "juejin_73912839128",
      "durationMs": 1850
    },
    {
      "target": "qiita",
      "ok": false,
      "status": "failed",
      "error": "API rate limit exceeded (HTTP 429)",
      "durationMs": 310
    },
    {
      "target": "devto",
      "ok": false,
      "status": "failed",
      "error": "Invalid API key in environment (HTTP 401)",
      "durationMs": 280
    }
  ]
}
```

### Process Exit Code
**`1`** (Non-zero exit code due to partial success; `surfdash`, `medium`, and `juejin` remain published and re-runnable via `--retry-from`).

---

## 7. Target Sections in Documentation (R8)

This specification names its target integration sections for Task 0036:

1. **`docs/03_ARCHITECTURE.md`**:
   - Section: **`## 3. Data flow (command path)`** & **`## 4. Module boundaries`**
   - Content: Document `kk fanin` and `kk fanout` data flow, sequential execution model, deduplication rules, and partial-success result aggregation.

2. **`docs/04_DESIGN.md`**:
   - Section: **`## 1. CLI commands`**
   - Content: Add command specifications for `fanin` and `fanout` (flags, options, exit codes, worked JSON payload example).
