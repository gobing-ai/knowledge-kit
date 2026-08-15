---
template: feature-impl
schema_version: 1
name: "Specify the kk config, works workspace, and workflow-install contract"
description: ""
status: done
type: task
profile: standard
feature_id: C4
parent_wbs: null
priority: P1
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-14T07:25:43.924Z"
updated_at: "2026-08-15T02:42:27.432Z"
---

## 0056. Specify the kk config, works workspace, and workflow-install contract

### Background
wayfinder:research — C4 Daily-usable STORM research.

**Question.** What is the v1 product-config, per-topic workspace, prepare-input, and workflow-install contract (so 0059/0060 can implement without guessing paths or topic-id rules)?

**Verified premises (re-checked 2026-08-14 this refine):**
- `docs/04_DESIGN.md` §2 (table row `_(none yet)_`): no product config file exists. Spur config stays `.spur/config.yaml`.
- Only product `KK_*` env today is `KK_PLUGIN_PATH` (`docs/04_DESIGN.md` §3; `packages/kk-core/src/registry.ts` reads it). New `KK_WORKS_DIR` / `KK_WORKFLOWS_DIR` / `KK_CONFIG` are additions this contract names.
- C3 YAML `.spur/workflows/kk-storm-research.yaml`: `work_dir` default `./work`; `fixture: true` hardcoded in prepare `jq`; all vars strings.
- `kk-topic` uses `./<kebab-topic>` with `brief.md` / `2-outline/` / `3-draft/` and excludes research (`plugins/kk/skills/kk-topic/SKILL.md`). Contrast only.
- ADR-011: first-layer `kk` nouns are `executor` + `plugin` only (`docs/00_ADR.md` ADR-011 R1).
- `@gobing-ai/kk-core` is `"private": true` (`packages/kk-core/package.json`). The published CLI ships `plugins/` via `scripts/bundle-plugins.ts` (`apps/cli/package.json` `files` + `prepack`).
- `discoverPlugins` skips the `kk` collection (`plugins/kk/README.md`). Extra dirs `plugins/kk/workflows/` and `plugins/kk/scripts/` are not product-plugin kinds.
- C4 discovery (2026-08-14): thin config; copies in `~/.config/kk/workflows/`; artifacts in `~/.config/kk/works/<topic-id>/`; prepare accepts sentence XOR file.

**Out of this ticket:** implementing a TypeScript config loader; editing the workflow YAML (0059); live Firecrawl (0057); render helper (0058); skill/command files (0060).
### Requirements
- [x] R1. Solution contains eight labeled blocks that an implementer can follow without asking the operator: (1) config schema with the frozen keys `works_dir`, `workflows_dir`, `defaults.maxResults`, `defaults.fixture`; (2) works layout file names; (3) topic-id algorithm as specified in Design; (4) prepare XOR + local-Doc mapping; (5) workflow-install copy rule; (6) fail-loud table; (7) dated citations; (8) handoff keys for 0059 and 0060. Confirm or cite-amend the Design frozen names — do not silently rename them.
- [x] R2. Fail-loud table covers: missing/unreadable `KK_CONFIG`; unreadable `--in` file; XOR violation (topic and input_file both set); topic-id empty after normalize; dest YAML exists with different bytes (no overwrite); source YAML missing. Each row: condition → exit → files written → recovery.
- [x] R3. Solution states missing config is **create-on-first-run** with compiled defaults and never overwrites an existing `config.yaml`.
### Acceptance Criteria
```gherkin
Feature: kk config, works workspace, and workflow-install contract

  Scenario: R1 — Contract is implementable without guessing
    Given DESIGN §2, C3 YAML, kk-topic (contrast), ADR-011, and the C4 Design frozen names
    When the investigation is recorded in Solution
    Then blocks 1–8 name the frozen keys, paths, topic-id algorithm, XOR prepare, copy rule, citations, and 0059/0060 handoff
    And an implementer can build prepare + install/copy without asking the operator

  Scenario: R2 — Fail-loud rows are explicit
    Given a missing config, a bad input file, an XOR violation, or a failed workflow copy
    When the contract is read
    Then each row names exit behavior, whether files are written, and recovery

  Scenario: R3 — Missing config is created, never overwritten
    Given no file at KK_CONFIG (default ~/.config/kk/config.yaml)
    When first-run of /kk-workflow happens
    Then the Solution says create the file with compiled defaults and never overwrite an existing file
```
### Q&A
- **Config keys?** Closed (refine --auto --depth ready, 2026-08-14): `works_dir`, `workflows_dir`, `defaults.maxResults`, `defaults.fixture`. No secrets in the file.
- **Env overrides?** Closed: `KK_CONFIG` (path to yaml, default `~/.config/kk/config.yaml`), `KK_WORKS_DIR`, `KK_WORKFLOWS_DIR`. Precedence: command flag > env > file > compiled default.
- **Topic-id?** Closed: `slug + "-" + sha256(normalized).hex[0:8]` per Design. Same topic reuses the workspace (last write wins). Resume/idempotency policy remains C4 fog.
- **Who computes topic-id?** Closed (refineall cross-task, 2026-08-14): the **invoker** (0060 or the operator), not workflow `prepare`. `work_dir` arrives already resolved as `$works_dir/<topic-id>`. prepare only `mkdir` + writes files into `${vars.work_dir}`.
- **File vs sentence?** Closed: XOR. `input_file` non-empty → file mode; else `topic` required. Both set → fail loud.
- **File → extra Doc?** Closed: yes. `local-doc.json` is a one-element `Doc[]` prepended onto `docs.json` by generate's first shell (0059), not by changing the 0054 `--in` schema.
- **Install/copy owner?** Closed: **both**. Guaranteed path = first-run of `/kk-workflow` (0060). Install source = `plugins/kk/workflows/<name>.yaml` (0059 also keeps repo SSOT at `.spur/workflows/`). `superskill install kk` may copy if convenient; 0060 must not require it.
- **Overwrite user YAML?** Closed: never overwrite an existing dest file. Identical bytes → no-op. Different bytes → warn + leave. `--force` on the command is the only replace.
- **Missing config?** Closed: create-on-first-run with compiled defaults; never overwrite.
- **New kk CLI noun?** Closed: no (ADR-011). This contract is followed by shell in the slash command and by workflow `jq`/shell, not by `kk workflow`.
- **Feature AC match?** Closed: C4 is `wayfinder-map` (no Gherkin). Task AC is `ac_numbering: task-local`. DD-09 subset warnings vs feature AC are expected, not defects (same as 0054/0055 vs C3).
### Design
**WHAT.** A research artifact (this task's Solution), not production code. Solution confirms the frozen names below with citations. 0059/0060 implement against these names.

**WHY.** C4 daily runs write outside the repo and must work from any cwd. Without frozen paths, 0059/0060 invent a second YAML home.

**WHERE.** No new package. The contract is consumed by: `.spur/workflows/kk-storm-research.yaml` (0059), `plugins/kk/workflows/kk-storm-research.yaml` (install source, 0059), `plugins/kk/commands/kk-workflow.md` + `plugins/kk/skills/kk-storm-research/SKILL.md` (0060). T3: when a loader later ships, `docs/04_DESIGN.md` §2/§3 update in that implement commit — not this ticket.

**Frozen names (do not rename in Solution without a cited blocker).**

Compiled defaults:
- `KK_CONFIG` default: `$HOME/.config/kk/config.yaml`
- `works_dir` default: `$HOME/.config/kk/works`
- `workflows_dir` default: `$HOME/.config/kk/workflows`
- `defaults.maxResults`: `8`
- `defaults.fixture`: `false` (real daily). CI/dry-run pass `fixture: "true"` as a workflow var.

Config file shape (YAML):
- `works_dir: <string>`
- `workflows_dir: <string>`
- `defaults.maxResults: <int>`
- `defaults.fixture: <bool>`
- Unknown keys: ignore (forward-compat). Invalid types: fail loud.

Env:
- `KK_CONFIG` — path to the yaml
- `KK_WORKS_DIR` — overrides `works_dir`
- `KK_WORKFLOWS_DIR` — overrides `workflows_dir`
- Secrets stay `FIRECRAWL_API_KEY` (0054). Never a config key.

Precedence: slash-command flag > env > file > compiled default.

Topic-id algorithm (`topicId(raw: string)`):
1. `normalized` = trim, collapse whitespace, lowercase.
2. `slug` = replace `[^a-z0-9]+` with `-`, squeeze dashes, trim dashes, slice to 48 chars, trim dashes again. If empty → `topic`.
3. `hash` = `sha256(normalized).digest('hex').slice(0, 8)`.
4. Return `slug + '-' + hash`.
- Sentence mode: `raw` = the topic string.
- File mode: `raw` = first ATX H1 (`/^#\s+(.+)$/m`) else basename without extension.
- Same `raw` → same id → same workspace. Last write wins. Do not fail on an existing works dir.

Works layout (`$works_dir/<topic-id>/`):
- `topic.json` — ingest `--in` (`topic`, `maxResults`, `fixture`) per 0054.
- `input.md` — written only in file mode (verbatim copy of the operator file).
- `local-doc.json` — written only in file mode; a one-element `Doc[]`.
- `docs.json` — ingest `--out`.
- `content.json` — generate `--out` (machine contract).
- `content.md` — render `--out`.

Prepare XOR:
- `input_file` non-empty → file mode. `topic` var ignored. Query = H1 or basename. Write `input.md` + `local-doc.json` + `topic.json`.
- else `topic` non-empty → sentence mode. Query = topic. Write `topic.json` only.
- both set or both empty → fail loud, no writes.

Local Doc (file mode, prepended by 0059 generate, not by web-search):
- `id` = `sha256('file://' + absPath).hex.slice(0, 16)` (same idea as `computeId` in `plugins/ingestions/web-search/src/index.ts`).
- `body` = file text; `title` = H1 or basename; `sourceUri` = `file://` + absPath; `mediaType` = `text/markdown`.
- `metadata.query` = derived query; `metadata.rank` = `-1`; `metadata.position` = `0`.
- Do **not** widen 0054 `--in`.

Workflow-install:
- Repo SSOT: `.spur/workflows/kk-storm-research.yaml`.
- Install source (ships in the npm `plugins/` tree): `plugins/kk/workflows/kk-storm-research.yaml`. 0059 writes both; they must be byte-identical after 0059.
- User dest: `$workflows_dir/<name>.yaml`.
- Copy if dest missing, from first hit of: `KK_WORKFLOWS_SOURCE` dir, then `plugins/kk/workflows/`, then checkout `.spur/workflows/`.
- Dest exists + same bytes → no-op. Dest exists + different bytes → warn, leave, no overwrite unless command `--force`.
- Guaranteed copier = `/kk-workflow` first-run (0060). `superskill install kk` is optional.

**Handoff — 0059 must consume:** vars `topic`, `input_file`, `maxResults`, `fixture`, `work_dir`, `plugins_path`, `ingestion_plugin`, `generator_plugin`, `render_script` (all strings). `work_dir` is the **resolved** topic directory (`$works_dir/<topic-id>`), computed by the invoker before `spur workflow run`. prepare does not hash. generate prepends `local-doc.json` when present. Also write `plugins/kk/workflows/kk-storm-research.yaml`.

**Handoff — 0060 must consume:** create-on-first-run config; copy rule; XOR args; env names; dest `$workflows_dir/<name>.yaml`; **compute `topicId` and pass `work_dir`**.

**Anti-patterns:** do not implement a config loader package; do not move harness YAML (`task-pipeline.yaml` etc.); do not implement `Brief` in kk-core; do not put `FIRECRAWL_API_KEY` in config or workflow vars; do not add a `kk` first-layer noun; do not change 0054 `--in` keys.

**Leaves for dependents:** 0057 (live HTTP) is independent. 0058 owns render function names. 0059 owns YAML states. 0060 owns skill/command files.
### Plan
1. Re-read DESIGN §2/§3, C3 YAML, kk-topic SKILL.md, ADR-011, `packages/kk-core/package.json` private flag, `scripts/bundle-plugins.ts` (R1 premises).
2. Write Solution blocks 1–5 confirming the Design frozen names; cite or amend with a blocker (R1).
3. Write fail-loud table (R2) and create-on-first-run rule (R3).
4. Write block 8 handoff keys for 0059 (vars + local-doc merge + dual YAML paths) and 0060 (copy + config create).
5. `spur task check 0056 --json` pass. Do not start 0059/0060 until this Solution exists.
### Solution

Research artifact (Design WHAT) — the C4 config/workspace/install contract. Every frozen name below is **confirmed** against the cited source (all citations re-verified 2026-08-14); no renames. 0059/0060 implement against these names verbatim.

**Block 1 — Config schema (frozen keys)**

File at `KK_CONFIG` (default `$HOME/.config/kk/config.yaml`). Shape:

```yaml
works_dir: <string>        # default $HOME/.config/kk/works
workflows_dir: <string>    # default $HOME/.config/kk/workflows
defaults:
  maxResults: <int>        # default 8
  fixture: <bool>          # default false (real daily; CI/dry-run passes fixture: "true" as a workflow var)
```

- Unknown keys: **ignore** (forward-compat). Invalid types (e.g. `maxResults: "eight"`): **fail loud** (Block 6 row 1b).
- No secrets in this file, ever. `FIRECRAWL_API_KEY` stays an env var (0054 contract, `docs/tasks/0054_specify-the-firecrawl-topic-to-doc-ingest-contract.md:83`).
- **Missing file = create-on-first-run (R3):** first run of `/kk-workflow` (0060) with no file at `KK_CONFIG` writes the file with compiled defaults (values above) and proceeds. An **existing** `config.yaml` is **never overwritten** — no merge, no rewrite, no timestamp touch. Only `--force`-style operator action replaces it (none specified in v1).
- Precedence: slash-command flag > env > file > compiled default.
- Env: `KK_CONFIG` (path to yaml), `KK_WORKS_DIR` (overrides `works_dir`), `KK_WORKFLOWS_DIR` (overrides `workflows_dir`). These are new product env names; today the only product `KK_*` env is `KK_PLUGIN_PATH` (`docs/04_DESIGN.md:226`, read at `packages/kk-core/src/registry.ts:37-38`). No product config file exists today — `docs/04_DESIGN.md:224` row `_(none yet)_`. When a loader later ships, `docs/04_DESIGN.md` §2/§3 update in that implement commit (T3), not this ticket.

**Block 2 — Works layout**

Per-topic workspace at `$works_dir/<topic-id>/` (the **resolved** `work_dir`):

| File | Writer | Notes |
|---|---|---|
| `topic.json` | prepare | ingest `--in` per 0054 keys: `topic`, `maxResults`, `fixture` (`docs/tasks/0054_specify-the-firecrawl-topic-to-doc-ingest-contract.md:124-125`) |
| `input.md` | prepare | file mode only; verbatim copy of the operator file |
| `local-doc.json` | prepare | file mode only; one-element `Doc[]` (Block 4) |
| `docs.json` | ingest `--out` | web-search output |
| `content.json` | generate `--out` | machine contract |
| `content.md` | render `--out` | 0058's helper |

Contrast (do not merge): the authoring workspace `kk-topic` uses `./<kebab-case(topic)>` with `brief.md` / `2-outline/` / `3-draft/` and explicitly excludes research (`plugins/kk/skills/kk-topic/SKILL.md:32,48,64-67`). C4 works live under `$works_dir`, outside any repo, reachable from any cwd.

**Block 3 — topicId algorithm**

`topicId(raw: string)` — exactly as Design:

1. `normalized` = trim, collapse whitespace, lowercase.
2. `slug` = replace `[^a-z0-9]+` with `-`, squeeze dashes, trim dashes, slice to 48 chars, trim dashes again. If empty → `topic`.
3. `hash` = `sha256(normalized).digest('hex').slice(0, 8)`.
4. Return `slug + '-' + hash`.

- Sentence mode: `raw` = the topic string. File mode: `raw` = first ATX H1 (`/^#\s+(.+)$/m`) else basename without extension.
- Same `raw` → same id → same workspace; **last write wins**; do **not** fail on an existing works dir (no `--force` needed for re-runs).
- **Computed by the invoker** (0060 command or the operator), never by workflow prepare — `work_dir` arrives already resolved (Q&A, closed 2026-08-14).

**Block 4 — Prepare XOR + local-Doc mapping**

XOR rule (prepare shell in 0059's YAML):

- `input_file` non-empty → **file mode**. The `topic` var is ignored. Query = H1 or basename. Write `input.md` + `local-doc.json` + `topic.json`.
- else `topic` non-empty → **sentence mode**. Query = topic. Write `topic.json` only.
- both set **or** both empty → fail loud, **no writes** (Block 6 row 3).

Local `Doc` (file mode) — prepended onto `docs.json` by **generate's first shell** (0059), not by web-search, not by widening 0054 `--in`:

```jsonc
{
  "id": "<sha256('file://' + absPath).hex.slice(0, 16)>",  // same scheme as computeId, plugins/ingestions/web-search/src/index.ts:44-46
  "body": "<file text>",
  "title": "<H1 or basename>",
  "sourceUri": "file://<absPath>",
  "mediaType": "text/markdown",
  "metadata": { "query": "<derived query>", "rank": -1, "position": 0 }
}
```

**Block 5 — Workflow-install copy rule**

- Repo SSOT: `.spur/workflows/kk-storm-research.yaml` (0059 edits this; today it is the C3 fixture prototype — `work_dir: "./work"` and hardcoded `fixture: true` at `.spur/workflows/kk-storm-research.yaml:26,40`).
- Install source (ships in the npm tree): `plugins/kk/workflows/kk-storm-research.yaml` — **does not exist yet**; 0059 creates it and must keep both byte-identical. Shipping works because `apps/cli/package.json:18` includes `plugins/` via `scripts/bundle-plugins.ts` (`apps/cli/package.json:25`).
- User dest: `$workflows_dir/kk-storm-research.yaml`.
- Copy when dest missing; source = first hit of `KK_WORKFLOWS_SOURCE` dir → `plugins/kk/workflows/` → checkout `.spur/workflows/`.
- Dest exists + identical bytes → no-op. Dest exists + different bytes → warn + leave (Block 6 row 5). `--force` on the command is the only replace.
- **Guaranteed copier = `/kk-workflow` first-run (0060).** `superskill install kk` may copy if convenient; 0060 must not require it (`plugins/kk/README.md:17`).

**Block 6 — Fail-loud table (R2)**

Reconciliation note: a **missing** `KK_CONFIG` is *not* a failure — R3/Q&A close it as create-on-first-run (Block 1). The fail-loud rows are the unreadable/invalid and structural cases:

| # | Condition | Exit | Files written | Recovery |
|---|---|---|---|---|
| 1a | `KK_CONFIG` set but file unreadable (I/O error) | exit 1, stderr names the path + errno | none | Fix permissions / point `KK_CONFIG` at a readable file |
| 1b | `config.yaml` unparseable YAML, or invalid types (`works_dir` non-string, `maxResults` non-int, `fixture` non-bool) | exit 1, stderr names key + expected vs actual type | none (existing file untouched) | Correct the key or delete the file (recreated with defaults next run) |
| 2 | `--in`/`input_file` unreadable (missing, I/O) in file mode | exit 1, stderr names the path | none | Fix path / permissions |
| 3 | XOR violation: `topic` and `input_file` both set, or both empty | exit 1, stderr states the XOR rule | none | Pass exactly one of `topic` / `input_file` |
| 4 | Derived topic-id/query empty after normalize + fallback (file mode: no H1 and basename-without-extension empty, e.g. a file named `.md`) | exit 1, stderr shows the derived value | none | Give the file a real name or add an H1 |
| 5 | Dest `$workflows_dir/<name>.yaml` exists with different bytes | exit 0 with warning (no overwrite) — copy step reports divergence | none (dest untouched) | Re-run with `--force`, or delete the dest file |
| 6 | Source YAML missing from all three candidate roots | exit 1, stderr lists the roots searched in order | none | Ensure `plugins/kk/workflows/` ships (reinstall) or set `KK_WORKFLOWS_SOURCE` |

Rows 2–4 hold even when the workspace dir already exists (re-run on the same topic-id is legal; last write wins — only these structural conditions fail).

**Block 7 — Citations (all re-verified 2026-08-14)**

- No product config file today: `docs/04_DESIGN.md:224` (§2 row `_(none yet)_`).
- Only product `KK_*` env is `KK_PLUGIN_PATH`: `docs/04_DESIGN.md:226` (§3), read at `packages/kk-core/src/registry.ts:37-38`.
- C3 YAML current state: `work_dir: "./work"` and all-string vars at `.spur/workflows/kk-storm-research.yaml:24-30`; `fixture: true` hardcoded in prepare `jq` at `:40`.
- kk-topic authoring workspace (contrast): `plugins/kk/skills/kk-topic/SKILL.md:32` (excludes research), `:48` (`./<kebab-case(topic)>`), `:64-67` (`brief.md` / `2-outline/` / `3-draft/`).
- ADR-011 first-layer kk nouns = `executor` + `plugin` only: `docs/00_ADR.md` ADR-011 ("Amendment — 2026-08-12 (two-layer CLI nouns…)", around `:227-230`). This contract is therefore followed by shell in the slash command and workflow `jq`/shell — no `kk workflow` noun.
- `@gobing-ai/kk-core` private: `packages/kk-core/package.json:4` (`"private": true`) — the npm surface is the CLI only.
- npm ships `plugins/`: `apps/cli/package.json:18` (`files` includes `plugins/`) via `scripts/bundle-plugins.ts` (`apps/cli/package.json:25`).
- Registry skips the `kk` collection: `packages/kk-core/src/registry.ts:60`; `plugins/kk/README.md:4` ("not a kk-core product plugin"). `plugins/kk/workflows/` + `plugins/kk/scripts/` are not product-plugin kinds — adding them changes no registry behavior.
- `computeId` precedent (sha256 hex 16): `plugins/ingestions/web-search/src/index.ts:44-46`.
- 0054 `--in` keys (`topic`/`maxResults`/`fixture`): `docs/tasks/0054_specify-the-firecrawl-topic-to-doc-ingest-contract.md:124-125`.

**Block 8 — Handoff keys**

**0059 consumes:** workflow vars `topic`, `input_file`, `maxResults`, `fixture`, `work_dir`, `plugins_path`, `ingestion_plugin`, `generator_plugin`, `render_script` (all strings). `work_dir` is the **resolved** topic directory (`$works_dir/<topic-id>`), computed by the invoker before `spur workflow run` — prepare only `mkdir` + writes into `${vars.work_dir}`. Generate's first shell prepends `local-doc.json` (when present) onto `docs.json`. Write **both** `.spur/workflows/kk-storm-research.yaml` and `plugins/kk/workflows/kk-storm-research.yaml`, byte-identical.

**0060 consumes:** create-on-first-run config (Block 1); the copy rule (Block 5); the XOR args (Block 4); env names (`KK_CONFIG`, `KK_WORKS_DIR`, `KK_WORKFLOWS_DIR`); dest `$workflows_dir/<name>.yaml`; **compute `topicId` and pass `work_dir`** (the invoker owns hashing — Block 3).
### Testing
**Verdict: PASS** (re-verify `--force` 2026-08-14; research artifact, no runtime coverage)

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `docs/tasks/0056_specify-the-kk-config-works-workspace-and-workflow-install-c.md:157-266` — Solution blocks 1–8: frozen keys `works_dir`/`workflows_dir`/`defaults.maxResults`/`defaults.fixture` (block 1 :159-166); 6-file works layout (block 2 :175-186); `topicId` normalize→slug48→sha256[0:8] (block 3 :190-201); XOR + local-Doc (block 4 :203-221); 3-root copy rule (block 5 :224-231); citations (block 7 :249-260); 0059/0060 handoff (block 8 :262-266). Re-read this run. |
| R2 | MET | Fail-loud table rows 1a/1b/2/3/4/5/6 at `:237-245` — each names condition, exit, files written, recovery. Missing-config is create-on-first-run (not a fail-loud row), documented at `:235`. |
| R3 | MET | Block 1 `:171` — create-on-first-run with compiled defaults; existing `config.yaml` never overwritten. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R1 — Contract is implementable without guessing [docs-only] | MET | static-ref | Solution blocks 1–8 at `:157-266` (re-read this run). Research contract; no runtime path. |
| Scenario: R2 — Fail-loud rows are explicit [docs-only] | MET | static-ref | Table `:237-245` (re-read this run). |
| Scenario: R3 — Missing config is created, never overwritten [docs-only] | MET | static-ref | Block 1 `:171` (re-read this run). |

**SECUA Review**

No production code in this ticket. P4 none.

**design-conformance:** 0056 Design frozen names appear verbatim in Solution. Block 5 historical note about C3 `fixture: true` is the world at research time; 0059 later amended the YAML (documented handoff, not silent drift).

Coverage: N/A (documentation-only change; no runtime code path added).
### Review
Review run 2026-08-14 (three-dimensional: functional traceability + SECUA + architecture; spec-authoring task — deliverable is the `## Solution` contract, no production code diff).

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1–P3 findings; functional verdict PASS (documentation-only deliverable) |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `docs/tasks/0056_specify-the-kk-config-works-workspace-and-workflow-install-c.md:157` Block 1 names all four frozen keys (`works_dir`, `workflows_dir`, `defaults.maxResults`, `defaults.fixture`) verbatim vs Design; `:175` Block 2 works layout (6 file names); `:190` Block 3 topicId algorithm identical to Design (normalize → slug48 → sha256[0:8]); `:203` Block 4 XOR + local-Doc mapping (all Design fields incl. `rank: -1`); `:224` Block 5 copy rule (3-root first-hit, byte-compare, `--force` only); `:233` Block 6 fail-loud table; `:249` Block 7 dated citations; `:262` Block 8 handoff keys for 0059 (9 vars + dual YAML) and 0060. No silent renames of Design frozen names. |
| R2 | MET | `:239-245` Block 6 rows 1a/1b/2/3/4/5/6 — each row condition → exit → files written → recovery. R2's "missing `KK_CONFIG`" is reconciled at `:235`: missing = create-on-first-run per R3 (documented deviation note; R3 refines R2, not a gap); unreadable/invalid split into rows 1a/1b. |
| R3 | MET | `:171` Block 1: missing `KK_CONFIG` → create-on-first-run with compiled defaults; existing `config.yaml` never overwritten ("no merge, no rewrite, no timestamp touch"); only operator `--force`-style action replaces (none in v1). |

Citation anchors re-verified this run (line-anchor rule — each re-read resolves to the cited content): `docs/04_DESIGN.md:224` (§2 `_(none yet)_`), `:226` (§3); `packages/kk-core/src/registry.ts:37-38` (`KK_PLUGIN_PATH`), `:60` (skip `kk`); `.spur/workflows/kk-storm-research.yaml:26` (`work_dir: "./work"`), `:40` (`fixture: true` in prepare `jq`); `plugins/kk/skills/kk-topic/SKILL.md:32,48,64-67`; `docs/00_ADR.md:227` (ADR-011 two-layer nouns amendment); `packages/kk-core/package.json:4` (`private: true`); `apps/cli/package.json:18` (`plugins/` in `files`), `:25` (`bundle-plugins.ts`); `plugins/kk/README.md:4,17`; `plugins/ingestions/web-search/src/index.ts:44-46` (`computeId` sha256/16); `docs/tasks/0054_*.md:83,124-125`. 16/16 resolve.

**SECUA:** no secrets in config (`FIRECRAWL_API_KEY` stays env, 0054:83 cited); invalid types fail loud (row 1b); XOR covers both-set and both-empty; topic-id collision space (sha256×8 hex) ample for daily use. No S/E/C/U findings ≥ P3.

**Architecture:** no blocker/major candidates. Contract honors ADR-011 (no new `kk` noun — shell/jq in command + workflow), defers the loader to a later implement commit (T3 note), adds no package. Seams are explicit (invoker computes topic-id, prepare only mkdir+writes, generate prepends local-doc).

**Advisory (P4, non-blocking):** Block 6 row 5 exits 0 on a byte-divergent dest workflow — the run proceeds with the user's stale YAML. This is the closed Q&A decision ("warn + leave") faithfully recorded; revisit only if daily users report drift confusion.

**Residual risk:** none blocking. Coverage: N/A (documentation-only change; no runtime code path added).

Functional Verdict: PASS
### References
- Feature [C4](../features/C4_daily-usable-storm-research.md)
- Contrast: [C3](../features/C3_storm-topic-research-workflow.md) (done; do not reopen)
- `docs/04_DESIGN.md` §2 (no product config yet) and §3 (`KK_PLUGIN_PATH` only)
- ADR-011 (`docs/00_ADR.md`) — kk nouns: executor + plugin
- `plugins/kk/skills/kk-topic/SKILL.md` (authoring workspace — contrast only)
- `packages/kk-core/package.json` (private) · `scripts/bundle-plugins.ts` (npm ships `plugins/`)
- Ingest `--in` keys: [0054](0054_specify-the-firecrawl-topic-to-doc-ingest-contract.md)
- Downstream: [0059](0059_prototype-the-daily-kk-storm-research-workflow.md), [0060](0060_author-the-kk-storm-research-skill-and-generic-kk-workflow-c.md)
### History
- 2026-08-14T21:34:39.925Z todo → wip (system)
- 2026-08-14T21:51:59.316Z wip → testing (system)
- 2026-08-14T21:51:59.744Z testing → done (system)
