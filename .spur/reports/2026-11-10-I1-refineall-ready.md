# Refineall — feature I1 (kk wiki vault CLI)

**Run:** 2026-11-10 · **depth:** ready · **profile:** auto · **set:** feature:I1 (frozen at 5 tasks) · **status filter:** backlog+todo → all 5 in scope

**Order:** topo-sorted by `dependencies[]` (Kahn, WBS tie-break): 0355 → 0356 → 0357 → 0358 → 0359.

## Batch verdict: clean

| WBS | Outcome | Corrections | Dropped issues | Status | Failed ids |
| --- | --- | --- | --- | --- | --- |
| 0355 | refined | 6 | 0 | todo → todo | - |
| 0356 | refined | 4 | 0 | todo → todo | - |
| 0357 | refined | 4 | 0 | todo → todo | - |
| 0358 | refined | 4 | 0 | todo → todo | - |
| 0359 | refined | 5 | 0 | todo → todo | - |

## Implement-ready checklist

### 0355

| id | pass | evidence |
| --- | --- | --- |
| requirements | ✅ | 9 R-items; every item names a file area (`packages/kk-wiki`, `apps/cli/src/wiki`) or the markitdown seam; out-of-scope (skill-authored text, plugin `Doc[]` path) stated in Design/Rejected. |
| design | ✅ | Frozen exports (`writeRawSnapshot`, `PageFrontmatterSchema`, `WikiConfig`), env prefix `KK_WIKI_`, exit-code table, config split, 4 anti-patterns, primary files, handoff to 0356-0359. |
| plan | ✅ | 7 ordered steps mappable to R1-R9, including the ADR record (R8) and per-file coverage check (R9). |
| ac | ✅ | AC1-AC5 are byte-exact feature I1 scenario titles (R2,R3,R4,R19,R20); `spur task check --as todo` clean. |
| decisions | ✅ | Config split (project `kk.config.json` vs global `~/.config/kk/config.yaml`) frozen; ADR record is step 5. No YAML library: frontmatter is flat. Nothing open in Q&A. |
| dependencies | ✅ | No dependencies; downstream consumers named (0356 page schema, 0357/0358/0359 `WikiConfig`). |
| premises | ✅ | Verified: `apps/cli/src/cli.ts:29-39` (eleven nouns, no wiki), `package.json:9` (`packages/*`), `packages/kk-core/src/index.ts:71` (`Doc` export; file is 86 lines), `plugins/ingestions/web-search/src/index.ts:59,74` (markitdown runner), `apps/cli/src/itc-config.ts:1-11` (config-block house rule), `bunfig.toml` (90% per-file coverage). |

### 0356

| id | pass | evidence |
| --- | --- | --- |
| requirements | ✅ | 8 R-items; index build, fence-aware link scan, two verbs, guard reuse, coverage. No ambiguous "wire it up". |
| design | ✅ | Frozen names (`buildVaultIndex`, `resolveSlug`, `lintPages`, `fixLinks`, `applyWrite`), 5 finding codes, slug rule, 3 anti-patterns, fixture list, handoff to 0357-0359. |
| plan | ✅ | 6 ordered steps incl. per-finding-code tests and the CLI `main(argv)` assertions. |
| ac | ✅ | AC1-AC4 byte-exact feature titles (R12,R22,R13,R23); `spur task check --as todo` clean. |
| decisions | ✅ | No third-party markdown/YAML parser (grep-verified absence); guard seam owned jointly with 0357 and named once. No open question. |
| dependencies | ✅ | Depends on 0355 (`PageFrontmatterSchema`, `parsePage`); states what 0357/0358/0359 may import and what it leaves to them. |
| premises | ✅ | Verified: no frontmatter parser in `packages/*/src` or `apps/cli/src` (`packages/publish-harness/src/index.ts:9` is a doc comment only); no YAML dependency in root/`apps/cli`/`packages/kk-core` manifests; `docs/design/kk-wiki.md:33-54,56-82` read and still accurate. |

### 0357

| id | pass | evidence |
| --- | --- | --- |
| requirements | ✅ | 8 R-items; both verbs, guard on every write verb, determinism, skill authoring plus its staged copy, coverage. |
| design | ✅ | Frozen `applyWrite`/`summarizePage`/`synthesizePage`, exact guard heading `## AI Updates (YYYY-MM-DD)`, four guard semantics, anti-patterns including "never hand-edit `apps/cli/plugins/kk`". |
| plan | ✅ | 6 steps incl. `bun run build` staging verification and the byte-equality determinism test. |
| ac | ✅ | AC1-AC6 byte-exact feature titles (R5,R6,R7,R8,R9,R21); check clean. |
| decisions | ✅ | Skill home is `plugins/kk/skills/wiki-authoring` (canonical) and the packaged copy is generated; no registry edit needed. No open question. |
| dependencies | ✅ | Depends on 0356 (`applyWrite`); 0358 reuses the same writer; the skill input contract (`--from -`) is what the treasury loop depends on. |
| premises | ✅ | Verified: `apps/cli/plugins/` is gitignored and staged by `scripts/bundle-plugins.ts:1-15`; `plugins/kk/plugin.json` has no skills registry (keys name/description/version); `plugins/kk/skills/content-judge/SKILL.md:1` exists as the layout precedent; `bunfig.toml` coverage per file. |

### 0358

| id | pass | evidence |
| --- | --- | --- |
| requirements | ✅ | 7 R-items; merge + redirect + guarded refusal, idempotent compile, gc scoped to kk-written snapshots with the mirror skip, plan-only default. |
| design | ✅ | Frozen names (`mergePages`, `compileIndex`, `planGc`, `applyGc`), `redirect_to` key, exact compiled filenames, 3 anti-patterns, fixture list. |
| plan | ✅ | 5 ordered steps incl. the byte-identical second compile run and the mirror-skip test. |
| ac | ✅ | AC1-AC3 byte-exact feature titles (R10,R11,R14); check clean. |
| decisions | ✅ | Redirect lives in page frontmatter; `gc` gains a `wiki.mirrors` skip because the treasury vault keeps an rclone-managed tree; estimate re-based 5h -> 6h for that scope. |
| dependencies | ✅ | Depends on 0356; reads `wiki.mirrors` from 0355 (already frozen in its `WikiConfig`) - the coupling is named in Design. |
| premises | ✅ | Verified: `docs/03_ARCHITECTURE.md:38-39` states compile idempotency; `docs/design/kk-wiki.md:56-82` lists `MAP.md`; `~/xprojects/treasury` feature A task 0004 keeps `raw/karakeep/` as an rclone mirror, so the skip is not hypothetical. |

### 0359

| id | pass | evidence |
| --- | --- | --- |
| requirements | ✅ | 8 R-items; publish projection and refusal, sync dry-run + unknown remote, query ranking, context packing, consumer notes, coverage. |
| design | ✅ | Frozen names (`publishVault`, `resolveRemote`, `rankPages`, `packContext`), exact placeholders `{content}`/`{remote}`, frozen scoring weights and tie-break, excerpt rule, 4 anti-patterns. |
| plan | ✅ | 6 steps incl. the published-tree byte comparison and the stub-remote dry run. |
| ac | ✅ | AC1-AC5 byte-exact feature titles (R15,R16,R24,R17,R18); check clean. |
| decisions | ✅ | Ranking stays local because the only repo ranking code is store-bound and ADR-048 forbids the store dependency; publish never deletes target files. No open question. |
| dependencies | ✅ | Depends on 0356; consumes 0355 `WikiConfig.remotes`; treasury tasks 0004/0005 consume these verbs and are named in the handoff. |
| premises | ✅ | Verified: `packages/kk-store/src/dao/*` ranking is `.works/kk.db`-bound; `docs/design/kk-wiki.md:111-124` still holds the publish/consumer shape; `plugins/ingestions/karakeep-local/plugin.json:6` confirms the raw source; `~/xprojects/treasury` exists with feature A. |

## Corrections summary

| WBS | Corrected claim → verified reality |
| --- | --- |
| 0355 | `kk-core:1-40` → `Doc` is at `packages/kk-core/src/index.ts:71` (86-line file); html/pdf/url extraction delegated to the skill → reuses the existing markitdown runner (`web-search/src/index.ts:59,74`); config resolution had no precedent → follows `itc-config.ts:1-11`; project config vs global config split was undefined → now frozen + ADR step; no YAML dep → flat frontmatter |
| 0356 | implied third-party parser → none exists (grep-verified) → own line-based splitter; guard writer was duplicated from 0357 → 0356 owns the minimal form, 0357 extends; finding codes and slug rule frozen |
| 0357 | skill path had no packaging note → `apps/cli/plugins/` is generated (`bundle-plugins.ts:1-15`), author under `plugins/kk/` then build; skill registration assumed → `plugin.json` has no skills list; guard ownership re-pointed at 0356's `applyWrite` |
| 0358 | `gc` deleted any unreferenced `raw/**` → now scoped to `raw/<type>/` + `raw/tmp/` and skips `wiki.mirrors` (treasury keeps an rclone tree there); merge writer → composes `applyWrite`; redirect storage → frontmatter `redirect_to`; estimate 5h → 6h |
| 0359 | `sync` re-read the config file → reads 0355's resolver only; ranking reuse unverified → store-bound ranking confirmed unusable, local scoring frozen with weights; publish projection shape fixed; treasury consumer turned from hypothetical into a named repo |

## Cross-task proposals (no action taken)

- **Shared step, not a merge:** 0356 and 0358 both touch link rewriting. They stay separate — 0358 composes 0356's primitives rather than reimplementing them, and the ordering already enforces it.
- **Contract coupling to keep in sync:** 0355 must ship `WikiConfig.mirrors` (0358 reads it) and `WikiConfig.remotes` (0359 reads it). Both are frozen in 0355's Design; if either is renamed, 0358/0359 need the same change.
- **Cross-repo contract:** treasury feature A tasks 0004/0005 consume `sync`/`context`/`lint`. A rename of those verbs needs those tasks updated in the same change.
- **Features without `feature_id`:** none — all five carry `feature_id: I1`.
- **Merge candidates:** none. The five tasks own disjoint file surfaces (`packages/kk-wiki/src/{page,raw}`, `{graph,lint,link,write}`, `{summarize,synthesize}`, `{merge,compile,gc}`, `{publish,sync,query,context}`).

## Verification

- `spur task check --as todo --json` clean on all five (only advisory `L4.prerequisite-not-done`, correct while dependencies are `todo`).
- `spur feature check I1` passes with zero non-`scenario-unverified` findings.
- AC bullets untouched: byte-exact feature scenario titles (L4.uncovered-task-scenario silent).
- Status: all five remain `todo`; no task moved backwards, none cancelled.

**Next command:** `/sp:dev-runall --feature I1 --auto`
