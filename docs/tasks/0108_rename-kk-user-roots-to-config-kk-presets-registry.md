---
schema_version: 1
name: Rename kk user roots to ~/.config/kk (presets + registry)
status: cancelled
template: feature-impl
created_at: 2026-09-10T06:32:23.516Z
updated_at: "2026-09-10T06:42:14.139Z"
feature_id: M

---

## 0108. Rename kk user roots to ~/.config/kk (presets + registry)

### Background

Feature M (kk-user-config-roots). kk's user-level roots predate the XDG layout that
`apps/cli/src/invoke.ts:45` already uses for config (`~/.config/kk/config.yaml`). Two
home-level roots still live under `~/.kk/`:

- image-preset user root: `plugins/generations/image-gen/src/presets.ts:261` — `~/.kk/image-presets`
- plugin user-discovery root: `packages/kk-core/src/registry.ts:137` — `~/.kk/plugins`

This task renames both to `~/.config/kk/…`, amends ADR-012 with a dated entry, syncs the
living docs, and migrates the operator machine's existing `~/.kk/image-presets` content.
Project-level roots (`<KNOWLEDGE_KIT_PROJECT_ROOT>/.kk/image-presets`, `<cwd>/plugins`) and
the low→high root priority order are unchanged. Predefined presets keep resolving in place
from the installed kk package; the user root starts empty except migrated operator files —
no bulk seeding (feature M Notes, decision 2026-09-10).

### Requirements

- [ ] R1. `resolvePresetRoots()` (`plugins/generations/image-gen/src/presets.ts`) resolves the user root as `<HOME>/.config/kk/image-presets` — still via `process.env.HOME ?? homedir()` (Bun snapshots `os.homedir()` at startup), still only when the directory exists. Project root and `KK_IMAGE_PRESET_PATH` handling unchanged.
- [ ] R2. `resolvePluginRoots()` (`packages/kk-core/src/registry.ts`) resolves the user root as `<homeDir>/.config/kk/plugins` — still via `opts.homeDir ?? homedir()`, still only when present. The `user` origin label, its priority position (above builtin, below project), and every other root unchanged.
- [ ] R3. Clean cutover: after the change neither resolver reads `~/.kk/…` — no fallback, no dual-root read, no deprecation alias.
- [ ] R4. Tests track the rename: home-directory fixtures in `plugins/generations/image-gen/tests/presets.test.ts` and `packages/kk-core/tests/registry.test.ts` point at `.config/kk/…`; project-root fixtures untouched; `bun run lint` and `bun run test` pass with the coverage gates (line/function ≥ 90%) intact.
- [ ] R5. `docs/00_ADR.md` ADR-012 gains a dated amendment: user roots move under XDG-conforming `~/.config/kk/`; presets SSOT stays with the product plugin; no bulk seeding; no `~/.kk` fallback.
- [ ] R6. Living docs updated in place: `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, `docs/design/multi-root-plugin-discovery.md`, `plugins/kk/skills/image-authoring/SKILL.md`, `plugins/kk/skills/image-authoring/references/style-extraction.md`, `plugins/kk/skills/image-authoring/references/migrating-from-wt.md`. Both `config.example.yaml` files verified mention-free (no edit).
- [ ] R7. Operator migration on this machine: `~/.kk/image-presets` content moved to `~/.config/kk/image-presets`, dropping files byte-identical to the shipped builtins; `~/.kk` removed once empty. (`~/.kk/plugins` does not exist on this machine — zero plugin migration.)

### Acceptance Criteria

```gherkin
Feature: Rename kk user roots to ~/.config/kk (presets + registry)

  Scenario: R1 — the user image-preset root resolves under ~/.config/kk
    Given a style preset at $HOME/.config/kk/image-presets/styles/custom.yaml
    And no $HOME/.kk/image-presets directory
    When loadPresets() runs
    Then styles contains "custom"
    And its winning path is under .config/kk/image-presets

  Scenario: R2 — the user plugin root resolves under ~/.config/kk
    Given a valid plugin.json plugin under $HOME/.config/kk/plugins/publishings/my-pub/
    When discoverAllPlugins runs without --plugins-root
    Then my-pub is registered with origin "user"

  Scenario: R3 — legacy ~/.kk roots are no longer read
    Given a style preset only under $HOME/.kk/image-presets/styles/
    And a valid plugin only under $HOME/.kk/plugins/
    When loadPresets() and discoverAllPlugins() run
    Then neither the preset nor the plugin is registered

  Scenario: R4 — a user preset still shadows the builtin of the same name
    Given a builtin presets/styles/editorial.yaml
    And $HOME/.config/kk/image-presets/styles/editorial.yaml with different modifiers
    When loadPresets() runs
    Then styles.get("editorial").modifiers is the user file's value
    And diagnostics contains one "shadowed" entry naming the builtin path

  Scenario: R5 — project roots and priority order are unchanged
    Given $KNOWLEDGE_KIT_PROJECT_ROOT/.kk/image-presets/styles/editorial.yaml
    And a valid plugin under <cwd>/plugins
    When loadPresets() and discoverAllPlugins() run
    Then the project preset still ranks above the user root
    And the project plugin is registered with origin "project"

  Scenario: R6 — operator migration preserves tuning and drops duplicates
    Given ~/.kk/image-presets/styles holds acceptance-demo, clean-webapp-ui, editorial, flat-teal-cream
    When the migration step runs
    Then ~/.config/kk/image-presets/styles holds every file not byte-identical to a shipped builtin
    And byte-identical duplicates are dropped
    And ~/.kk is removed once empty
```

### Q&A

**Q: Are the project-level roots renamed too?**
No. Feature M's Scope names the two home-level user roots only:
`<KNOWLEDGE_KIT_PROJECT_ROOT>/.kk/image-presets` and `<cwd>/plugins` keep their paths and
their ranks above the user root (AC R5). **Closed.**

**Q: Backward-compat fallback that also reads `~/.kk`?**
Rejected — clean cutover (R3). `~/.kk/plugins` never existed on operator machines (feature M
Notes: empty everywhere, zero migration cost), and preset content is migrated explicitly
(R7). A silent dual read would make the rename unverifiable. **Closed.**

**Q: Move the presets SSOT or bulk-seed the user root?**
Rejected 2026-09-10 (feature M Notes, after superskill source review): predefined presets
resolve in place from the installed kk package; the user root starts empty; fine-tuning =
copy one preset file into the user root. **Closed.**

**Q: Edit ADR-012 in place or amend?**
Append a dated amendment (same convention as the 2026-08-13 amendment); the original R3 and
2026-08-13 texts stay as history. Derived living docs (`03`, `04`,
`design/multi-root-plugin-discovery.md`, the image-authoring skill files) are edited in
place — authority first, then derived docs. **Closed.**

**Q: `config.example.yaml` edits?**
Both `plugins/kk/config.example.yaml` and `plugins/generations/image-gen/config.example.yaml`
were grepped: zero `.kk` / `image-presets` mentions → no edit, despite the feature Scope
listing them. **Closed.**

**Q: Historical mentions in done task files (0102/0105/0106), feature B7, `docs/plans/`,
`.spur/memory/learnings.md`?**
Left untouched — frozen records and session memory, not living docs. **Closed.**

**Q: Feature M's AC is a placeholder ("Basic acceptance") — which AC governs?**
This task's AC, derived from the feature Goal/Scope/Notes, is the operative gate for
implementation. Regenerating the feature file's AC belongs to a feature-level refine, not
this task. **Closed.**

### Design

Approach: two one-line resolver edits plus fixture moves — the loaders, priority order,
diagnostics, and origin labels do not change. Docs and the operator migration carry the rest
of the task.

#### Frozen edits (production code)

1. `plugins/generations/image-gen/src/presets.ts:261` — user preset root:
   `join(process.env.HOME ?? homedir(), '.kk', 'image-presets')` →
   `join(process.env.HOME ?? homedir(), '.config', 'kk', 'image-presets')`.
   Keep the `process.env.HOME ?? homedir()` form and its comment (Bun snapshots
   `os.homedir()` at startup; tests override `$HOME` at runtime). Line 265 (project root)
   is untouched.
2. `packages/kk-core/src/registry.ts:137` — user plugin root:
   `join(opts.homeDir ?? homedir(), '.kk', 'plugins')` →
   `join(opts.homeDir ?? homedir(), '.config', 'kk', 'plugins')`.
   Update the two doc comments that name the old path: `registry.ts:39`
   (`homeDir` option) and `registry.ts:117` (resolver list).

#### Frozen edits (tests — fixtures move, assertions unchanged)

- `plugins/generations/image-gen/tests/presets.test.ts:253` and `:268` —
  `join(home, '.kk', 'image-presets')` → `join(home, '.config', 'kk', 'image-presets')`;
  comment at `:61` re-worded to the new path. Project-root fixtures (`:207`, `:225`, `:247`)
  keep `.kk/image-presets`.
- `packages/kk-core/tests/registry.test.ts:249`, `:290`, `:313`, `:396`, `:473` —
  `join(home, '.kk', 'plugins')` → `join(home, '.config', 'kk', 'plugins')`.

#### ADR-012 amendment (docs/00_ADR.md)

Append `### Amendment — 2026-09-09 (user roots move to XDG-conforming ~/.config/kk/)` under
ADR-012, stating: (1) the user plugin root becomes `~/.config/kk/plugins` and the user
image-preset root `~/.config/kk/image-presets`, matching the existing
`~/.config/kk/config.yaml`; (2) presets SSOT stays with the product plugin — predefined
presets resolve in place from the installed package, no bulk seeding; (3) clean cutover,
no `~/.kk` fallback; (4) project roots and priority order unchanged.

#### Living docs (in-place path swaps, `~/.kk/` → `~/.config/kk/` for user roots only)

`docs/03_ARCHITECTURE.md:295,304`; `docs/04_DESIGN.md:108,224`;
`docs/design/multi-root-plugin-discovery.md:81,97,121` (the ADR-012 design table — derived
doc, follows the amended authority);
`plugins/kk/skills/image-authoring/SKILL.md:87,95`;
`plugins/kk/skills/image-authoring/references/style-extraction.md:20` (its `:23`
project-root mention stays);
`plugins/kk/skills/image-authoring/references/migrating-from-wt.md:9`.
The feature Scope's doc list is treated as non-exhaustive per its Goal ("every living
doc") — that is why `03_ARCHITECTURE.md` and `docs/design/multi-root-plugin-discovery.md`
are in.

#### Operator migration (this machine, outside the repo)

`~/.kk/image-presets/styles/` holds four files: `acceptance-demo.yaml`,
`clean-webapp-ui.yaml`, `editorial.yaml`, `flat-teal-cream.yaml`. For each, `cmp` against
the same-named builtin under `plugins/generations/image-gen/presets/styles/`; move the
non-identical ones to `~/.config/kk/image-presets/styles/`, drop the identical ones
(`clean-webapp-ui.yaml` was committed as a builtin by 0105 — expect it to drop).
Remove `~/.kk` once empty. `~/.kk/plugins` does not exist — nothing to migrate.

#### Invariants

- Root priority low→high is unchanged: builtin → user → project → env/flag paths; a later
  root still shadows by name with a `shadowed` diagnostic naming the losing path.
- User roots are still conditional on the directory existing (no eager creation).
- No test touches the real `$HOME` (both suites already inject home/tmp dirs — keep it).
- File IO in `presets.ts` stays behind the `@gobing-ai/ts-runtime` seam
  (rule `no-direct-fs-io`) — this change alters a join, not IO.

#### Anti-patterns (do not)

- Do NOT add a fallback read of `~/.kk` — R3 forbids it; it makes the cutover unverifiable.
- Do NOT rename project roots or reorder priority.
- Do NOT edit historical task/feature/plan files or `.spur/memory/`.
- Do NOT seed presets into the user root.
- Do NOT hand-edit corpus files — task/feature writes go through `spur task/feature update`.

### Plan

1. **presets.ts user root** — apply frozen edit 1 (`plugins/generations/image-gen/src/presets.ts:261`). (R1)
2. **registry.ts user root** — apply frozen edit 2 (`packages/kk-core/src/registry.ts:137`) plus doc comments at `:39` and `:117`. (R2)
3. **presets.test.ts fixtures** — move home fixtures (`:253`, `:268`) to `.config/kk/image-presets`; re-word the `:61` comment. Leave project fixtures. (R4)
4. **registry.test.ts fixtures** — move home fixtures (`:249`, `:290`, `:313`, `:396`, `:473`) to `.config/kk/plugins`. (R4)
5. **Verify the cutover is total** — grep the two `src/` trees for `'.kk'`: only the project-root join in `presets.ts` may remain. (R3)
6. **ADR-012 amendment** — append the dated amendment per the Design. (R5)
7. **Living docs** — apply the in-place swaps per the Design's doc list; re-grep each file for `~/.kk` to confirm only project-root mentions survive (SKILL.md `:96`, style-extraction.md `:23`). (R6)
8. **Gate** — `bun run lint` clean; `bun run test` passes with coverage gates intact. (R4)
9. **Operator migration** — per the Design: `cmp` each of the four `~/.kk/image-presets/styles/*.yaml` against the same-named builtin, move non-identical files to `~/.config/kk/image-presets/styles/`, drop identical ones, remove `~/.kk` when empty. (R7)
10. **Smoke** — `KK_IMAGE_DRY_RUN=1` `kk executor run image-gen` cover job with `style: editorial`: exit 0, composed prompt carries the migrated user file's `modifiers`, one `shadowed` diagnostic names the builtin path. Proves R1+R4 end to end against the real new root. (R1, R4, R7)
11. **Build + hygiene** — `bun run build` succeeds; `git status` shows only the intended files.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `docs/features/M_kk-user-config-roots.md` — parent feature (Goal, Scope, 2026-09-10 decision in Notes)
- `docs/00_ADR.md` — ADR-012 (multi-root plugin discovery; amendment target)
- `docs/design/multi-root-plugin-discovery.md` — ADR-012's resolution table (derived doc)
- `plugins/generations/image-gen/src/presets.ts` — `resolvePresetRoots()` / `loadPresets()`
- `packages/kk-core/src/registry.ts` — `resolvePluginRoots()` / `discoverAllPlugins()`
- `apps/cli/src/invoke.ts:45` — existing `~/.config/kk/config.yaml` precedent
- Task 0102 — preset schema + four-root resolution contract this task's R1/R4 build on
- Task 0053 — merged multi-root registry this task's R2 builds on

### History

- 2026-09-10T06:42:14.139Z backlog → cancelled (system)

