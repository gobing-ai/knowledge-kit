---
schema_version: 1
name: Resolve workflows_dir from global installs and default per-workflow workspaces in workflow-run
status: done
template: feature-impl
created_at: 2026-09-14T17:55:18.370Z
updated_at: "2026-09-14T18:19:08.120Z"
feature_id: F8
priority: P2
tags:
  - kk
  - workflow-run
  - config

---

## 0127. Resolve workflows_dir from global installs and default per-workflow workspaces in workflow-run

### Background

Feature F8 extension (docs/features/F8_run-anywhere-workflow-and-script-resolution.md). The only runtime reader of `workflows_dir`/`works_dir` is `plugins/kk/commands/workflow-run.md` (the shell procedure behind `/kk:workflow-run` and the kk-workflow-run skill). Today `workflows_dir` falls back from config to KK_WORKFLOWS_SOURCE to a `command -v kk` package-root walk, and each profile computes work_dir inconsistently (storm: `$works_dir/<topic-id>`, itc: cwd-relative `./<kebab>`, solo-podcast/daily-voice: `$works_dir/kk-solo-podcast/<date>`). Operators who installed kk globally but never wrote a config get a broken or cwd-polluting experience.

Covers feature F8 scenarios: R1 (Empty or missing workflows_dir falls back to global-install locations), R2 (A corrupt config.yaml still fails loud), R3 (Each workflow defaults its work_dir under works_dir/<workflow-name>/), R4 (kk-itc no longer writes into the caller's cwd).

### Requirements

- [x] R1. When `workflows_dir` in `~/.config/kk/config.yaml` is absent, empty, unexpanded, or not a readable directory, the §3 source-resolution chain tries `$(dirname $(bun pm bin -g))/install/global/node_modules/@gobing-ai/knowledge-kit/plugins/kk/workflows` then `$(dirname $(npm root -g))/node_modules/@gobing-ai/knowledge-kit/plugins/kk/workflows` — inserted into the candidate-dir loop after `$KK_WORKFLOWS_SOURCE` and before the existing `command -v kk` package-root walk and checkout default; first readable hit wins.
- [x] R2. Each new probe is guarded (`command -v bun` / `command -v npm` plus `test -d`) so a missing package manager never breaks the chain.
- [x] R3. A corrupt (unparseable) config.yaml still exits 1 — no fallback masks it.
- [x] R4. Per-workflow default work_dir when no explicit `--dir`/`dir` is given: kk-storm-research → `$works_dir/kk-storm-research/<topic-id>`; kk-itc → `$works_dir/kk-itc/<kebab>`; kk-solo-podcast → `$works_dir/kk-solo-podcast/<date>`; kk-daily-ai-voice → `$works_dir/kk-daily-ai-voice/<date>`. The shared §4 solo/daily formula splits into per-profile defaults; §1's stale `--dir` default prose is corrected to match. Explicit `--dir` still wins; kk-itc never writes into the caller's cwd.
- [x] R5. `apps/cli/tests/workflow-run-command.test.ts` (already asserts `workflows_dir:` and `KK_WORKFLOWS_SOURCE` lines) asserts the new chain entries and all four per-profile defaults.

### Acceptance Criteria

```gherkin
Scenario: Empty or missing workflows_dir falls back to global-install locations
  Given a config.yaml with workflows_dir absent or empty and no KK_WORKFLOWS_SOURCE
  When /workflow-run resolves a workflow YAML
  Then the bun global path is tried, then the npm global path, then the package-root walk

Scenario: A corrupt config.yaml still fails loud
  Given ~/.config/kk/config.yaml is not parseable YAML
  When /workflow-run runs
  Then it exits 1 with the config error and no fallback masks it

Scenario: Each workflow defaults its work_dir under works_dir/<workflow-name>/
  Given works_dir resolves and no explicit --dir
  When a profile's workspace is computed
  Then storm uses $works_dir/kk-storm-research/<topic-id>
  And itc uses $works_dir/kk-itc/<kebab>
  And solo-podcast uses $works_dir/kk-solo-podcast/<date>
  And daily-ai-voice uses $works_dir/kk-daily-ai-voice/<date>

Scenario: kk-itc no longer writes into the caller's cwd
  Given no --dir for the kk-itc profile run from /tmp
  When the workspace is computed
  Then the work_dir is $works_dir/kk-itc/<kebab>, never ./<kebab>
```

Task-local checks: a missing `bun` or `npm` binary never breaks the chain (guarded probes); explicit `--dir` wins over every default; `apps/cli/tests/workflow-run-command.test.ts` asserts both global-install fallbacks and all four per-profile defaults.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: extend the resolution prose and shell blocks inside `plugins/kk/commands/workflow-run.md` only (approach A chosen at idea-eval — no new resolver script, no TS). WHY: the command is the sole invoker that computes these paths; centralizing there keeps the diff surgical and the precedence flag > env > config > global-install > package-root > checkout readable in one place. Chain insert position: in the §3 `for d in` loop, between `$KK_WORKFLOWS_SOURCE` and `${pkg:+$pkg/plugins/kk/workflows}` — global installs are the common no-config case; the walk stays as the dev-checkout fallback. §4: replace the shared `work_dir="${DIR:-$works_dir/kk-solo-podcast/$date}"` block with per-profile defaults; storm gains the `kk-storm-research/` segment, itc moves off `./$kebab` to `$works_dir/kk-itc/$kebab` (empty kebab still exits 1), solo/daily keep their `<date>` shape in their own namespaces. Invariants: corrupt config exits 1 before any probe runs; explicit `--dir` beats every default; no behavior change when workflows_dir is valid. Skipped: shared `scripts/kk-runtime-resolve.sh` (approach B) — add when a second invoker appears; TS `kk config resolve` (approach C) — rejected, no TS consumer exists.

### Plan

1. Read `plugins/kk/commands/workflow-run.md` §1 (line ~38 arg defaults), §3 (resolution loop ~95–111), §4 (workspace computation ~133–167), §5.
2. Add the two guarded global-install probes to the §3 candidate list; document the full precedence in the surrounding prose.
3. Rewrite §4 per-profile work_dir defaults per R4 and fix the §1 `--dir` default line.
4. Update `apps/cli/tests/workflow-run-command.test.ts` to assert the new chain lines and the four defaults.
5. `bun run lint` + targeted `bun test apps/cli/tests/workflow-run-command.test.ts`.

### Solution

Approach A (command prose only) as designed (`plugins/kk/commands/workflow-run.md`, `apps/cli/tests/workflow-run-command.test.ts`) — no new resolver script, no TS resolver. Two files changed.

**`plugins/kk/commands/workflow-run.md`**

- §3 header prose (`plugins/kk/commands/workflow-run.md:120`) — resolution order extended from 4 to 6 entries: user override →
  `$KK_WORKFLOWS_SOURCE` → bun global install → npm global install → `$pkg/plugins/kk/workflows`
  → repo checkout. Added the explicit note that the corrupt-config exit-1 happens in §2 *before*
  any probe, so no fallback can mask a config error (R3).
- §3 package-root block (`plugins/kk/commands/workflow-run.md:98`, `:103`) — two guarded probes compute `bun_global_workflows`
  (`$(dirname $(bun pm bin -g))/install/global/node_modules/@gobing-ai/knowledge-kit/plugins/kk/workflows`)
  and `npm_global_workflows`
  (`$(dirname $(npm root -g))/node_modules/@gobing-ai/knowledge-kit/plugins/kk/workflows`).
  Each is wrapped in `command -v bun|npm` plus a `[ -d … ]` test, so a missing package manager
  leaves the variable empty and never breaks the chain (R1, R2).
- §3 candidate loops (`plugins/kk/commands/workflow-run.md:128`, `:136`) — **both** the normal `dest` resolution loop and the `--force` `src` copy
  loop gained `"$bun_global_workflows" "$npm_global_workflows"` between `$KK_WORKFLOWS_SOURCE` and
  `${pkg:+…}`. The `for d in` order *is* the precedence, and the two loops must stay in step or
  `--force` would fail exactly where the normal path succeeds. Both failure messages now name the
  global-install locations.
- §4 (`plugins/kk/commands/workflow-run.md:166`, `:180`, `:188`, `:193`) — per-profile workspace defaults replace the shared solo/daily formula:
  storm `work_dir="${DIR:-$works_dir/kk-storm-research/$topic_id}"`,
  itc `"${DIR:-$works_dir/kk-itc/$kebab}"` (off cwd-relative `./$kebab`),
  solo-podcast `"${DIR:-$works_dir/kk-solo-podcast/$date}"`,
  daily-ai-voice `"${DIR:-$works_dir/kk-daily-ai-voice/$date}"`. The combined
  `kk-solo-podcast / kk-daily-ai-voice` section split in two so each default has one owner; the
  `${DIR:-…}` form keeps an explicit `--dir` winning over every default (R4).
- §1 (`plugins/kk/commands/workflow-run.md:35`, `:38`, `:42`) — `--dir` default prose corrected for all three listed profiles (storm documented no `--dir`;
  itc/solo carried stale cwd-relative or `$works_dir/<kebab>` shapes); the intro names the
  global-install hop.

**`apps/cli/tests/workflow-run-command.test.ts`** — 5 new tests (R5):

- R1 chain order (`apps/cli/tests/workflow-run-command.test.ts:152`) asserted from the real `for d in` line by index order, not by string presence —
  a reordered chain fails even though all five entries are still present.
- R1/R2 probe guards (`apps/cli/tests/workflow-run-command.test.ts:165`): `command -v bun|npm`, `bun pm bin -g`, `npm root -g`, and the
  `[ -d "$bg" ] && bun_global_workflows="$bg"` shape that makes a missing manager harmless.
- R3 (`apps/cli/tests/workflow-run-command.test.ts:177`) the prose that keeps the config failure ahead of every probe.
- R4 all four per-profile defaults (`apps/cli/tests/workflow-run-command.test.ts:182`), asserted by namespace prefix. The assertion builds a `RegExp`
  per profile rather than embedding a literal `${…}` so it stays clear of
  `noTemplateCurlyInString`; the `${DIR:-…}` shape itself is still asserted.
- R4 (`apps/cli/tests/workflow-run-command.test.ts:189`) `--dir` wins and no default is cwd-relative (`not.toMatch(/\$\{DIR:-\.\//)`).

WHY these placements: the command is the sole invoker that computes these paths, so the change
stays surgical and the precedence stays readable in one place. Global installs sit *before* the
package-root walk because a no-config global install is the common operator case, while the walk
remains the dev-checkout fallback. Skipped, as designed: a shared `kk-runtime-resolve.sh` (no second
invoker yet) and a TS resolver (no TS consumer).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Requirement — §3 chain tries `$(dirname $(bun pm bin -g))/install/global/node_modules/@gobing-ai/knowledge-kit/plugins/kk/workflows` then the npm twin, between `$KK_WORKFLOWS_SOURCE` and the `command -v kk` package-root walk, first hit wins. Evidence (`command`) — executed the shipped §3 blocks extracted verbatim from `plugins/kk/commands/workflow-run.md` in a sandbox with fake `bun`/`npm` and planted workflows dirs. A bun-global only gives the bun path; B npm-global only gives the npm path; C both present gives the bun path (first hit); D npm-global beats the package root; E `KK_WORKFLOWS_SOURCE` still beats both globals; the user override still wins. Real-path check on this host: `bun pm bin -g` = `/Users/robin/.bun/bin`, so the probe path `/Users/robin/.bun/install/global/node_modules/@gobing-ai/knowledge-kit/plugins/kk/workflows` matches the real `@gobing-ai` install root, and `npm root -g` = `/opt/homebrew/lib/node_modules` matches npm's global root. |
| R2 | MET | Requirement — each new probe is guarded by `command -v bun` / `command -v npm` plus a directory test. Evidence (`command`) — same sandbox: F a PATH without `bun` still resolves npm-global; G a PATH without `npm` still resolves bun-global; H neither manager present gives rc=1 with `no source workflow for demo (searched …, bun/npm global installs, …)` and stderr contains no `not found` / `No such file`; I a `bun pm bin -g` pointing at a nonexistent root leaves the candidate empty and npm-global resolves. |
| R3 | MET | Requirement — a corrupt (unparseable) `config.yaml` still exits 1 and no fallback masks it. Evidence (`command`) — ordering proof: `plugins/kk/commands/workflow-run.md:69` is the §2 unparseable-exits-1 rule and the new probes are at `:98` and `:103`, strictly downstream; `git diff -U0 HEAD` emits zero hunks in §2's line range (49–77), and the only added line mentioning `config.yaml` is the explanatory note, not a handler. A fallback therefore cannot observe or bypass the config error. SCOPE NOTE — the §2 exit-1 branch is prose with no executable surface anywhere in the repo (no TS/JS reader of these keys exists under `apps packages plugins`, and no test covers it), so this row certifies the invariant this change could have broken rather than an observed exit code. |
| R4 | MET | Requirement — per-workflow default work_dir: storm `kk-storm-research/<topic-id>`, itc `kk-itc/<kebab>`, solo-podcast `kk-solo-podcast/<date>`, daily-ai-voice `kk-daily-ai-voice/<date>`; the shared §4 formula splits per profile; §1's `--dir` prose is corrected; explicit `--dir` still wins; itc never writes into the caller's cwd. Evidence (`command`) — executed the shipped §4 blocks/expressions from `cwd=/tmp`: storm gives `/tmp/kkv/sb/works/kk-storm-research/vector-databases-67d8eee1`, itc gives `<works_dir>/kk-itc/my-topic`, solo-podcast gives `<works_dir>/kk-solo-podcast/2026-09-14`, daily-ai-voice gives `<works_dir>/kk-daily-ai-voice/2026-09-14`; with `DIR=/tmp/explicit-x` all four returned `/tmp/explicit-x`. The itc default is absolute under `works_dir` from `/tmp`, never `./<kebab>`. |
| R5 | MET | Requirement — `apps/cli/tests/workflow-run-command.test.ts` asserts the new chain entries and all four per-profile defaults. Evidence (`command`) — `NODE_ENV=test bun test apps/cli/tests/workflow-run-command.test.ts` gives 14 pass / 0 fail including the five new tests. Non-vacuity checked by mutation against a `/tmp` copy of the doc (tree untouched): reverting the chain order, dropping `command -v bun`, reverting itc to `./$kebab`, and deleting the config-ordering note each made the matching assertion fail (4 fail / 0 pass). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: Empty or missing workflows_dir falls back to global-install locations | MET | command | Sandbox cases A–E: the bun global path is tried, then the npm global path, then the package-root walk, with `KK_WORKFLOWS_SOURCE` and the user override still winning. Additionally `workflows_dir` set to the literal unexpanded `$HOME/.config/kk/workflows` and to the empty string both fell through to the bun global install at rc=0. |
| Scenario: A corrupt config.yaml still fails loud | MET | command | The R3 ordering proof above: `plugins/kk/commands/workflow-run.md:69` versus the probes at `:98`/`:103`, with zero diff hunks in §2's line range. Evidence-class limitation is stated in the R3 row — the exit-1 branch has no runnable surface, so this is certified structurally rather than by observing an exit code. |
| Scenario: Each workflow defaults its work_dir under works_dir/<workflow-name>/ | MET | command | All four profiles executed from `cwd=/tmp`, each landing in its own `$works_dir/<workflow-name>/` namespace and each yielding to an explicit `DIR`. |
| Scenario: kk-itc no longer writes into the caller's cwd | MET | command | itc evaluated with cwd `/tmp` and no `DIR` produced `<works_dir>/kk-itc/my-topic`, and the string `${DIR:-./` no longer occurs anywhere in the document. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**Reviewer findings** — fresh-context review in the `review` stage of run `runall-0127-3aafb2cd`.
Verdict PASS; no P1/P2.

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P3 | correctness / traceability | `plugins/kk/skills/storm-research/SKILL.md:71` | The storm skill still documents the pre-0127 workspace (`$works_dir/<topic-id>`), so an agent following the skill computes a path the command no longer defaults to. Re-homed to **0129** (surface-sync task, same feature and batch) rather than fixed here: a docs-only edit after proof capture would invalidate the certified digest and force a full re-certification. |
| P3 | architecture / tests | `apps/cli/tests/workflow-run-command.test.ts:145` | The chain is now duplicated in both §3 loops, but the test pins only the first (`candidateLoop()` returns the first match), so the `--force` `src` loop's order is unasserted and a one-loop edit would diverge silently. Folded into 0129 with the other surface-sync items. |
| P4 | usability | `plugins/kk/commands/workflow-run.md:4` | The frontmatter `description` still enumerates four sources and omits the bun/npm global installs the body now names; the description is what an agent reads first. Folded into 0129. |
| P4 | efficiency | `plugins/kk/commands/workflow-run.md:96` | Both probes run on every invocation, ahead of the user-override short-circuit, so `bun pm bin -g` / `npm root -g` spawn even when the override wins. No correctness impact — recorded, not actioned. |
| P4 | correctness (pre-existing) | `plugins/kk/commands/workflow-run.md:190` | §4 documents a first-class `kk-daily-ai-voice` default while §1's supported-name list (`:31`) and §5 have no daily entry, so the default is unreachable through the documented dispatch. The diff made the gap explicit rather than creating it; R4 fixes the default, not the profile roster. Out of scope — recorded. |

**SECU and checks** (pipeline verify step — verdict PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | Every behavior-bearing AC row has executable evidence or is explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:db0bc52e742624f8a42600cee7b7e485b06d56b97399b5536de87f77c00a4955 |

**Residual risk**

- The "corrupt `config.yaml` still fails loud" AC is certified **structurally**, not behaviorally: §2's exit-1 branch is prose with no executable surface in this repo (no TS/JS reader of `workflows_dir`/`works_dir`), so no test can observe that exit code. The change cannot mask it — §3's probes are strictly downstream at `:98`/`:103` and the diff has zero hunks in §2's range — but the row rests on ordering, not on a red/green run.
- Moving itc off `./<kebab>` and giving storm its own namespace orphans pre-existing `$works_dir/<topic-id>` workspaces. Accepted by feature F8 R6 (no migration) and assigned to 0129 R4 for documentation.

**Disposition:** PASS. No repairs in this change; the three surface-drift findings are assigned to 0129 and the two advisory items are recorded here and in the batch report.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-14T18:06:51.889Z todo → wip (system)
- 2026-09-14T18:18:36.788Z wip → testing (system)
- 2026-09-14T18:19:08.120Z testing → done (system)

