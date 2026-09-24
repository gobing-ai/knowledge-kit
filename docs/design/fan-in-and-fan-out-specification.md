# Fan-In Merge & Fan-Out Publish Specification

This specification defines the CLI surface, data contracts, exit codes, deduplication, and retry semantics for `fanin` (N→1 `Doc[]` merge) and `fanout` (1→N `Content` multi-target publish). It fulfills **Task 0033** (Feature **J**) and feeds target sections in `03_ARCHITECTURE.md` and `04_DESIGN.md`.

> **Dated correction (2026-08-11).** Feature **B6** (tasks 0042/0043) implemented this spec — `kk
> fanin` and `kk fanout` are shipped in `apps/cli`. Shipped-surface deltas vs the text below:
>
> 1. **`--dedupe <id|uri|none>` (§1.2) is not shipped.** Task 0042 deferred it: id dedupe (default)
>    is the only implemented rule; add the flag if a `uri`-dedupe consumer appears. `04_DESIGN`
>    §1.5 carries the deferral.
> 2. **`fanout` ships `--plugins-root <dir>` (default `./plugins`)** — added during implementation
>    (task 0043), consistent with every sibling plugin-aware command; §1.3's table below predates it.
> 3. **Exit-code contract (§4) shipped as specified**, including CLI/input error → `2` (usage
>    errors, invalid `--content`, unresolvable target, `--out` write failure). Retry semantics (§5)
>    shipped as specified.
> 4. **§7's "Task 0036" reference is historical** — the target sections were applied to
>    `03`/`04` by tasks 0042/0043 (B6), not 0036.
>
> **Dated correction (2026-08-12).** ADR-011 (feature A21) made the canonical paths
> `kk executor fan-in` / `kk executor fan-out` / `kk executor run`; `kk fanin` / `kk fanout` /
> `kk invoke` are hidden one-release aliases. §1.1–§1.3, §5, and §7 below now use the canonical
> names; flags, exit codes, and retry semantics are unchanged.
>
> **Dated correction (2026-08-13).** ADR-012 (feature B7, task 0053) replaced the
> single-root default: `fan-out` resolves targets through the **merged multi-root registry**
> (`discoverAllPlugins`). Correction 2 (2026-08-11) is superseded — `--plugins-root` no longer
> defaults to `./plugins`; it is the exclusive single-root override (isolation/tests only, no
> union). Repeatable `--plugins-path <dir>` unions extra roots (tree, kind collection, or single
> `plugin.json` directory) with the defaults. Combining `--plugins-root` with `--plugins-path`
> is a usage error → exit `2` (extends §4's CLI/Input Error row). Retry semantics unchanged.
>
> **Dated correction (2026-09-24).** `fan-in` gains the same root flags for `--source` discovery:
> `--plugins-root <dir>` (exclusive single root) and `--plugins-path <dir>` (repeatable union with
> the defaults), with the same mutual-exclusion usage error → exit `2`. Previously fan-in always
> used the default merged registry, so a pipeline could not isolate its ingestion sources.

---

## 1. CLI Surface & Boundary Justification (R1, R3)

### 1.1 Sibling Commands vs `invoke` Extension

`kk executor run` is the uniform single-plugin step (ADR-011; former `kk invoke`, which remains a
hidden one-release alias), constrained by ADR-006 as a **single-plugin invoker**
(`kk executor run <plugin> --in <path> --out <path>`), not a DAG execution engine.

To respect this boundary while providing sequential fan-in/fan-out capabilities:
- **`kk executor fan-in`** and **`kk executor fan-out`** are siblings of `executor run` (ADR-011);
  `kk fanin` / `kk fanout` are hidden one-release aliases.
- They are pure utility tools owned by `kk` for sequential file aggregation and multi-target dispatch.
- Neither subcommand manages workflow DAG execution or state transitions (which remain owned by `spur workflow`).

```text
kk executor run <plugin> --in <f> --out <f>
kk executor fan-in --in <f1> [--in <f2> ...] --out <out.json> [--dedupe <rule>]
kk executor fan-out --content <content.json> --target <p1> [--target <p2> ...] --out <result.json> [--retry-from <prior-result.json>]
```

### 1.2 `executor fan-in` CLI Specification
| Flag / Arg | Type | Required | Description |
|---|---|---|---|
| `--in <file>` | string (repeatable) | yes (>=1) | Input `Doc[]` JSON files to merge |
| `--out <file>` | string | yes | Output merged `Doc[]` JSON file path |
| `--dedupe <rule>` | enum (`id` \| `uri` \| `none`) | no (default: `id`) | Deduplication rule for merging |

### 1.3 `executor fan-out` CLI Specification
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
kk executor fan-out \
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

**2026-09-10 clarification (shipped — task 0110 I4/I7).** The ADR-007 retry-state
amendment is enforced: validated per-target `metadata` round-trips alongside `url`/`id` (a
primitive `metadata` value in a prior ledger is a named input error, exit 2), and prior failed
targets excluded from the selected retry subset are carried into the aggregate as `failed`, so
remaining failures keep the aggregate unsuccessful (exit 1). Eligibility wording is reconciled:
item 4 stands — only prior failed targets are retried by default, and an explicit `--target`
selection narrows that set (deduped); previously unattempted names in an explicit selection
remain eligible and are dispatched fresh. The aggregate always carries every outstanding
outcome. No new flags.

**2026-09-24 clarification (shipped — task 0157 R2).** Repeated `--target` names are deduped on
fresh runs too, not only when `--retry-from` supplies the set: each distinct target is dispatched
once and appears once in the aggregate.

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
   - Content: Document `kk executor fan-in` and `kk executor fan-out` data flow, sequential execution model, deduplication rules, and partial-success result aggregation.

2. **`docs/04_DESIGN.md`**:
   - Section: **`## 1. CLI commands`**
   - Content: Add command specifications for `executor fan-in` and `executor fan-out` (flags, options, exit codes, worked JSON payload example).
