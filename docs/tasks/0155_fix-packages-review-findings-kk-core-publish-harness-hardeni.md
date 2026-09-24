---
schema_version: 1
name: "Fix packages/ review findings: kk-core + publish-harness hardening"
status: todo
template: issue
created_at: 2026-09-23T23:14:38.909Z
updated_at: "2026-09-23T23:20:25.008Z"

priority: P3
ac_altitude: task-local
estimate_hours: 4
---

## 0155. Fix packages/ review findings: kk-core + publish-harness hardening

### Background

Source: standalone `/sp:dev-review packages --agent inline --focus all` run on 2026-09-23 against
`main@d4dd562d` (kk-core + publish-harness, ~1.1k src lines). The review found no P1/P2 issues; this task
bundles every P3/P4 finding and architecture candidate so they are fixed (or explicitly dispositioned) in
one surgical pass. Baseline at review time: `packages/kk-core` 62/62 pass, `packages/publish-harness`
13/13 pass.

Finding → requirement map (review numbering kept for traceability):

| Review # | Sev | Area | Anchor (at `d4dd562d`) | Requirement |
| --- | --- | --- | --- | --- |
| #1 | P3 (real bug) | Correctness | `packages/kk-core/src/kinds.ts:42-47` | R1 |
| #2 | P3 | Correctness/Usability | `packages/publish-harness/src/index.ts:58-64,77-79,123-129,142-144` | R2 |
| C1 | advisory | Architecture (duplication) | `packages/publish-harness/src/index.ts:49-170` | R3 |
| #3 | P3 | Correctness | `packages/kk-core/src/render-md.ts:44-66` + `plugins/kk/scripts/render-md.ts:104-111` | R4 |
| #4 | P3 | Security (trust) | `packages/kk-core/src/registry.ts:234-257` | R5 |
| #5 | P3 | Usability/portability | `packages/kk-core/src/registry.ts:149-154` | R6 |
| #6 | P3 | Usability | `packages/publish-harness/src/index.ts:216-226,236-252` | R7 |
| #7 | P4 | Consistency | `packages/kk-core/src/manifest.ts:17-29` | R8 |
| #8 | P4 | Usability (public types) | `packages/kk-core/src/index.ts:19-23`, `manifest.ts:4-14` | R9 |
| C2, C3, C4, #8 (`main` half) | advisory | Architecture | see Q&A | no code change (dispositioned in Q&A) |

Confirmed repro for #1 (run at review time):

```bash
bun -e "import {kindForCollection} from './packages/kk-core/src/kinds'; console.log(kindForCollection('constructor'), kindForCollection('toString')?.name)"
# → [class Object] toString      (expected: undefined undefined)
```

### Requirements

- [ ] R1. `kindForCollection(name)` (`packages/kk-core/src/kinds.ts:42-47`) returns a `PluginKind` only for the own keys of `PLUGIN_COLLECTION_KINDS` (`ingestions`, `generations`, `publishings`) and `undefined` for every other string, including names inherited from `Object.prototype` (`constructor`, `toString`, `__proto__`, `hasOwnProperty`, `valueOf`). Consequence: a directory named `constructor` / `toString` / `__proto__` under a plugins root is no longer treated as a kind collection by `discoverPlugins` (`registry.ts:80` root-as-collection branch and `registry.ts:94` child branch), so it no longer produces spurious `kind_mismatch` diagnostics. A stray `plugin.json` in such a directory must instead get the normal `misplaced` diagnostic from `registry.ts:99-107`.
- [ ] R2. The `setNextResult` JSDoc on both fake transports (`packages/publish-harness/src/index.ts:58-61` and `:123-126`) states the actual, preserved semantics: the configured `Result` is returned by **every** subsequent `publish()` call until `reset()` is called (sticky, not one-shot). Runtime behavior does not change, because four plugin test suites rely on it (`plugins/publishings/qiita-pub/tests/qiita-pub.test.ts:335`, `zenn-pub/tests/zenn-pub.test.ts:297`, `surfdash-pub/tests/surfdash-pub.test.ts:215`, `emdash-pub/tests/emdash-pub.test.ts:666`). The matching `docs/04_DESIGN.md:386-387` rows say "sticky until `reset()`".
- [ ] R3. The duplicated bodies of `FakeFileCliTransport` (`packages/publish-harness/src/index.ts:49-104`) and `FakeBrowserTransport` (`:109-170`) are consolidated into one **non-exported** base class in the same file. The base class owns the call log, `setNextResult`, `publish`, `getCallLogs`, and `reset`, and takes its default `Result` from the subclass. Public API is unchanged: both class names stay exported, `kind` is still the literal `'file-cli'` / `'browser'` (a `readonly` literal, so `PublishTransport` narrowing still works), `FakeBrowserTransport` still takes `constructor(driver: BrowserDriver = 'agent')` and exposes `readonly driver`, and default results are field-for-field identical to today: file-cli `{ ok: true, target: 'fake-file-cli', url: 'https://example.com/published-post', id: 'fake-id-123', message: 'Published offline via FakeFileCliTransport' }`; browser `{ ok: true, target: 'fake-browser', url: 'https://example.com/browser-draft', id: 'fake-browser-id-123', message: 'Published offline via FakeBrowserTransport', metadata: { driver } }`. No new file and no new export.
- [ ] R4. `renderReferenceLabel` escapes link syntax in the `[title](url)` form only (`packages/kk-core/src/render-md.ts:51-52`): in the title, each `\`, `[`, `]` gets a backslash prefix; in the URL, space → `%20`, `(` → `%28`, `)` → `%29`, `<` → `%3C`, `>` → `%3E`. Title-only, url-only, and cite-only labels and the ` (cite)` suffix stay as they are. The byte-identical copy `plugins/kk/scripts/render-md.ts:104-111` gets the same change, so the parity suite (`packages/kk-core/tests/render-md.test.ts:169-199`) stays green. Inputs without these characters produce the same bytes as before.
- [ ] R5. The built-in plugin root search (`resolveBuiltinRoot`, `packages/kk-core/src/registry.ts:241-257`) accepts a candidate `<dir>/plugins` only when `<dir>/package.json` also exists, i.e. the plugins tree sits next to a package manifest. This covers the three legitimate layouts: installed package `<pkg>/{package.json,plugins/}`, bundled monorepo CLI `apps/cli/{package.json,plugins/}` (staged by `scripts/bundle-plugins.ts:21`), and monorepo source repo root `{package.json,plugins/}`. It no longer picks up an unrelated ancestor such as `~/plugins/ingestions` without `~/package.json` as `origin: 'builtin'`. The search logic moves into a testable helper that takes the start directory as a parameter. `resolveBuiltinRoot` calls it with `dirname(fileURLToPath(import.meta.url))`. The injected `packagePluginsRoot` override (`:242-244`) is unchanged.
- [ ] R6. `KK_PLUGIN_PATH` parsing in `resolvePluginRoots` (`packages/kk-core/src/registry.ts:149-154`) splits on `path.delimiter` (`:` on POSIX, `;` on Windows) instead of the literal `':'`. Relative entries in `KK_PLUGIN_PATH` and in `extraPaths` (`:155-159`) resolve against `opts.cwd ?? process.cwd()` before `isDirectory`, and the returned `root` is that resolved absolute path. On POSIX, when `opts.cwd` is omitted (production: `apps/cli/src/invoke.ts:291`, `commands/plugin.ts:56`, `fanout.ts:452`, `fanin.ts:352`), behavior is unchanged except that returned roots are now absolute.
- [ ] R7. `trySelectors` (`packages/publish-harness/src/index.ts:236-264`) forwards the caller's `timeout` to `isVisible` unchanged, and the dead `Math.min(timeout, 2000)` cap (`:252`) is removed. The default becomes `2000`, which was already the effective value. The JSDoc (`:228-235`) and `docs/04_DESIGN.md:390` must **not** describe `timeout` as a wait: in the repo-pinned Playwright 1.55.0, `locator.isVisible()` ignores `timeout` and returns immediately (`@deprecated This option is ignored`, `node_modules/.bun/playwright-core@1.55.0/node_modules/playwright-core/types/types.d.ts:13838-13842`). The docs say the visibility check happens at a single point in time and that `timeout` is only forwarded for compatibility with the structural `SelectorLocator`. Adding a real wait (for example `locator.waitFor`) is out of scope; see Q&A. `resolveBrowserProfileDir` (`:216-226`) always returns an absolute path: a non-`~/` override goes through `path.resolve()`, and `~/` expansion (`:220-222`) plus the default path stay as they are. The JSDoc and `docs/04_DESIGN.md:389-390` match.
- [ ] R8. `PluginManifestSchema` (`packages/kk-core/src/manifest.ts:17-29`) replaces the deprecated Zod 4 `.passthrough()` with `z.looseObject({...})`, consistent with `schemas.ts:51,56`. Unknown manifest keys are still kept, and the inferred `PluginManifest` type still allows extra keys. `docs/04_DESIGN.md:259` says `z.looseObject` instead of `.passthrough()`.
- [ ] R9. `PluginOperation` (derived from the schema via `z.infer` instead of the hand-written copy at `manifest.ts:10-14`), `OperationIO`, and `OperationIOSchema` are exported from the package entry point `packages/kk-core/src/index.ts:19-23`, because they appear on the public `PluginRecord.operations` (`registry.ts:22`) and are not reachable today. This only adds exports. The `docs/04_DESIGN.md:375` manifest row lists them.

### Acceptance Criteria

- [ ] AC1 — Prototype-key names are not kind collections (req: R1). In `packages/kk-core/tests/kinds.test.ts` (the existing `maps kinds to ADR-009 collection directories and back` block, `:62-76`), `kindForCollection(n)` is `undefined` for each of `constructor`, `toString`, `__proto__`, `hasOwnProperty`, `valueOf`. In `packages/kk-core/tests/registry.test.ts`, a temporary plugins root with `constructor/plugin.json` (a valid ingestion manifest) produces **no** `kind_mismatch` diagnostic and exactly one `misplaced` diagnostic whose path ends in `constructor/plugin.json`. Both assertions fail against the `d4dd562d` code.
- [ ] AC2 — Fake transport `setNextResult` is sticky and documented (req: R2). A new test in `packages/publish-harness/tests/harness.test.ts` for each fake calls `setNextResult(r)`, then `publish()` twice, and asserts both calls return `r`. After `reset()`, `publish()` returns the default result. The JSDoc on both `setNextResult` methods and the `docs/04_DESIGN.md` rows for both fakes say "sticky until `reset()`".
- [ ] AC3 — Fake transports share one internal body with an unchanged public surface (req: R3). `rg -n "callLogs.push" packages/publish-harness/src/index.ts` returns exactly **one** match. `rg -n "^export (abstract )?class" packages/publish-harness/src/index.ts` lists only `FakeFileCliTransport` and `FakeBrowserTransport`. Every existing test in `packages/publish-harness/tests/harness.test.ts` passes with **no** edits to those existing assertions, and so do the plugin suites that use the fakes (`bun test plugins/publishings`). `new FakeBrowserTransport().driver === 'agent'` and `new FakeFileCliTransport().kind === 'file-cli'` still hold.
- [ ] AC4 — Reference links escape markdown metacharacters in both render copies (req: R4). A new `renderContentMarkdown` test in `packages/kk-core/tests/render-md.test.ts` renders the reference `{ title: 'A [b] \\ c', url: 'https://x.test/a b(c)<d>' }` and asserts the line `- [A \[b\] \\ c](https://x.test/a%20b%28c%29%3Cd%3E)`. The fixture used by the parity suite (`render-md.test.ts:169-199`) gains that same reference and stays byte-identical between `packages/kk-core/src/render-md.ts` and `plugins/kk/scripts/render-md.ts`. Every existing render-md assertion passes unchanged.
- [ ] AC5 — Built-in root search requires a sibling `package.json` (req: R5). New tests in `packages/kk-core/tests/registry.test.ts` call the extracted start-dir helper against temporary trees and check: (a) `<tmp>/a/b/c` start, with `<tmp>/plugins/ingestions/` present and **no** `<tmp>/package.json` → `undefined`; (b) the same tree plus `<tmp>/package.json` → `<tmp>/plugins`; (c) `<tmp>/pkg/dist` start with `<tmp>/pkg/package.json` and `<tmp>/pkg/plugins/publishings/` → `<tmp>/pkg/plugins`. Existing `discoverAllPlugins` tests using `packagePluginsRoot` (`registry.test.ts:230+`) pass unchanged. The monorepo built-in root still resolves: `bun apps/cli/src/index.ts plugin status` output, run from the repo root before and after the change and saved to scratch files, is byte-identical under `diff`.
- [ ] AC6 — Plugin-path env parsing is portable and cwd-relative (req: R6). A new `resolvePluginRoots` test passes `env: { KK_PLUGIN_PATH: ['relA', 'relB'].join(path.delimiter) }` and `cwd: <tmp>` (with `<tmp>/relA` and `<tmp>/relB` existing, and `homeDir`/`packagePluginsRoot` pointed at empty tmp dirs), plus `extraPaths: ['relC']` with `<tmp>/relC` existing. It asserts the `path`-origin roots are exactly `[<tmp>/relA, <tmp>/relB, <tmp>/relC]` in that order, all absolute. `rg -n "split\\(':'\\)" packages/kk-core/src/registry.ts` returns no match.
- [ ] AC7 — `trySelectors` forwards the caller's timeout uncapped, and profile overrides come back absolute (req: R7). A new `trySelectors` test uses a fake locator that records the `timeout` passed to `isVisible`: with `{ timeout: 7000 }` it records `7000`; with no options it records `2000`. The `trySelectors` JSDoc contains the phrase "point-in-time" and does not say "wait". A new `resolveBrowserProfileDir` test asserts `resolveBrowserProfileDir('x', 'rel/prof') === path.resolve('rel/prof')` and `path.isAbsolute(...)` is true. The existing `~/` and default tests (`harness.test.ts:127-137`) pass unchanged.
- [ ] AC8 — Manifest schema uses `z.looseObject` with unknown keys still kept (req: R8). `rg -n "passthrough" packages/kk-core/src` returns no match. The existing unknown-key test in `packages/kk-core/tests/manifest.test.ts` passes; if none exists, add one: `parsePluginManifest({ name: 'n', kind: 'publish', entry: 'e', extra: 1 })` keeps `extra === 1`. `docs/04_DESIGN.md` no longer says `.passthrough()` for `PluginManifestSchema`.
- [ ] AC9 — Operation types are reachable from the package entry point (req: R9). `packages/kk-core/tests/index.test.ts` imports `OperationIOSchema` from `'../src/index'` and asserts `OperationIOSchema.options` equals `['doc-list', 'markdown']`. A type-only import of `PluginOperation` and `OperationIO` from `@gobing-ai/kk-core` compiles under `bun run lint` (tsc). `manifest.ts` no longer contains a hand-written `interface PluginOperation`.

Task-level gate (covers R1–R9, not a separate AC): `bun run gate` exits 0 (format, build, lint + typecheck, `spur rule run`, tests). Aggregate coverage stays ≥ 90% line and function, no test is skipped, and no `biome-ignore` is added. `git diff --stat` touches only: `packages/kk-core/src/{kinds,registry,render-md,manifest,index}.ts`, `packages/kk-core/tests/{kinds,registry,render-md,manifest,index}.test.ts`, `packages/publish-harness/src/index.ts`, `packages/publish-harness/tests/harness.test.ts`, `plugins/kk/scripts/render-md.ts`, `docs/04_DESIGN.md`, and this task file.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-23T23:18:31.256Z

Triage decisions were made when the task was created (2026-09-23) and are binding for the implementer. Do not re-open them without an operator decision.

- **Q: Should `setNextResult` become one-shot so it matches its name (#2)?** A: **No. Keep it sticky and fix the docs.** Four plugin test suites call it (`qiita-pub.test.ts:335`, `zenn-pub.test.ts:297`, `surfdash-pub.test.ts:215`, `emdash-pub.test.ts:666`), and changing the semantics would be a cross-package behavior change for no product gain. Renaming the method is also out of scope because it would break those callers.
- **Q: Merge the fakes by exporting a base class or a factory (C1)?** A: **Neither is exported.** Use a non-exported base class in the same file, subclassed by the two existing exported classes. A factory would change the public constructor surface, and an exported base class is an extra abstraction nobody consumes.
- **Q: Remove `launchPersistentBrowser` / `trySelectors`, which have no production caller (C2)?** A: **No. Keep them.** They are a documented, shipped E7 surface (`docs/04_DESIGN.md:390-391`; task 0141 R3; planned consumers in task 0145 and `docs/design/remaining-wt-publish-harvest.md:62,111`). Removing them contradicts the design doc and would require a new ADR entry. R7 only fixes `trySelectors`' timeout handling.
- **Q: Deduplicate the two `render-md.ts` copies (C3)?** A: **No.** The copy exists because the shipped plugin script cannot resolve the private `@gobing-ai/kk-core` (`plugins/kk/scripts/render-md.ts:6-16`), and the parity suite (`packages/kk-core/tests/render-md.test.ts:169-199`) already enforces byte-identity. R4 must edit **both** copies in the same commit.
- **Q: Move the render CLI (`main`) out of kk-core, so the package is data contracts only (C4 and the `main` half of #8)?** A: **No.** `main()` is a documented kk-core export (`docs/04_DESIGN.md:378`), and moving it would be refactoring for its own sake. Only the additive type export (R9) is in scope.
- **Q: Close the Windows gap in #5 fully?** A: Only the `path.delimiter` split and cwd-relative resolution (R6). The project targets macOS/Linux; no other Windows work is in scope.
- **Q: In R5, why require a sibling `package.json` rather than stop at the first `package.json`?** A: Stopping at the first `package.json` breaks monorepo source runs. From `packages/kk-core/src/` the first manifest is `packages/kk-core/package.json`, which has no `plugins/` next to it, while the real built-in tree is the repo root `plugins/`. The sibling rule accepts the repo root, `apps/cli`, and installed-package layouts and rejects stray ancestors.
- **Q: R7 changes the `trySelectors` default from 5000 to 2000. Is that a behavior change?** A: No. At `d4dd562d` the effective wait was already `Math.min(5000, 2000) = 2000`. Only callers that pass an explicit `timeout > 2000` see a longer wait, which is what they asked for.
- **Q: Feature linkage?** A: None. This is standalone review debt, so `ac_altitude: task-local`.

#### Q&A entry — 2026-09-23T23:20:24.219Z

Triage decisions were made when the task was created (2026-09-23) and are binding for the implementer. Do not re-open them without an operator decision.

- **Q: Should `setNextResult` become one-shot so it matches its name (#2)?** A: **No. Keep it sticky and fix the docs.** Four plugin test suites call it (`qiita-pub.test.ts:335`, `zenn-pub.test.ts:297`, `surfdash-pub.test.ts:215`, `emdash-pub.test.ts:666`), and changing the semantics would be a cross-package behavior change for no product gain. Renaming the method is also out of scope because it would break those callers.
- **Q: Merge the fakes by exporting a base class or a factory (C1)?** A: **Neither is exported.** Use a non-exported base class in the same file, subclassed by the two existing exported classes. A factory would change the public constructor surface, and an exported base class is an extra abstraction nobody consumes.
- **Q: Remove `launchPersistentBrowser` / `trySelectors`, which have no production caller (C2)?** A: **No. Keep them.** They are a documented, shipped E7 surface (`docs/04_DESIGN.md:390-391`; task 0141 R3; planned consumers in task 0145 and `docs/design/remaining-wt-publish-harvest.md:62,111`). Removing them contradicts the design doc and would require a new ADR entry. R7 only fixes `trySelectors`' timeout handling.
- **Q: Deduplicate the two `render-md.ts` copies (C3)?** A: **No.** The copy exists because the shipped plugin script cannot resolve the private `@gobing-ai/kk-core` (`plugins/kk/scripts/render-md.ts:6-16`), and the parity suite (`packages/kk-core/tests/render-md.test.ts:169-199`) already enforces byte-identity. R4 must edit **both** copies in the same commit.
- **Q: Move the render CLI (`main`) out of kk-core, so the package is data contracts only (C4 and the `main` half of #8)?** A: **No.** `main()` is a documented kk-core export (`docs/04_DESIGN.md:378`), and moving it would be refactoring for its own sake. Only the additive type export (R9) is in scope.
- **Q: Close the Windows gap in #5 fully?** A: Only the `path.delimiter` split and cwd-relative resolution (R6). The project targets macOS/Linux; no other Windows work is in scope.
- **Q: In R5, why require a sibling `package.json` rather than stop at the first `package.json`?** A: Stopping at the first `package.json` breaks monorepo source runs. From `packages/kk-core/src/` the first manifest is `packages/kk-core/package.json`, which has no `plugins/` next to it, while the real built-in tree is the repo root `plugins/`. The sibling rule accepts the repo root, `apps/cli`, and installed-package layouts and rejects stray ancestors.
- **Q: Is the `trySelectors` timeout cap (#6) a real behavior bug?** A: **No. The review over-stated it.** The installed Playwright 1.55.0 ignores `isVisible({ timeout })` (`playwright-core/types/types.d.ts:13838`), so real browsers never waited, with or without the cap. R7 drops the dead cap and corrects the docs so nobody relies on a wait that does not happen. Making `trySelectors` actually wait would need `locator.waitFor({ state: 'visible', timeout })`, which widens the `SelectorLocator` structural type (`:188-191`) and changes timing for 0145 consumers. That is **out of scope**: open a separate task only if a channel needs it. Changing the default from 5000 to 2000 alters nothing, because the effective value was already 2000.
- **Q: Feature linkage?** A: None. This is standalone review debt, so `ac_altitude: task-local`.

### Design

Principles: make surgical fixes where each problem originates, change no public API except R9's additive exports, add no dependencies or files, and keep `docs/04_DESIGN.md` updated in the same commit (T3). ADR-009 and ADR-012 layout semantics stay as they are. R5 tightens how the ADR-012 D2 built-in root is found; it adds no new discovery root.

**R1: own-key check** (`packages/kk-core/src/kinds.ts:42-47`)

```ts
export function kindForCollection(name: string): PluginKind | undefined {
    return Object.hasOwn(PLUGIN_COLLECTION_KINDS, name) ? PLUGIN_COLLECTION_KINDS[name as PluginKindCollection] : undefined;
}
```

`Object.hasOwn` is available: `tooling/typescript/base.json:4-6` sets `lib`/`target` to `ESNext`. Every discovery call site goes through this one function (`registry.ts:80,94`), so no caller changes are needed.

**R2 + R3: one internal base for the fakes** (`packages/publish-harness/src/index.ts:46-170`)

```ts
abstract class FakeTransportBase {
    private callLogs: FakeCallLogEntry[] = [];
    private nextResult?: Result;
    protected abstract defaultResult(): Result;
    /** Result returned by every subsequent publish() until reset() (sticky). */
    public setNextResult(result: Result): void { this.nextResult = result; }
    public async publish(payload: PublishTransportPayload): Promise<Result> {
        this.callLogs.push({ timestamp: new Date().toISOString(), payload });
        return this.nextResult ?? this.defaultResult();
    }
    public getCallLogs(): readonly FakeCallLogEntry[] { return this.callLogs; }
    public reset(): void { this.callLogs = []; this.nextResult = undefined; }
}
export class FakeFileCliTransport extends FakeTransportBase implements PublishTransport {
    public readonly kind = 'file-cli';
    protected override defaultResult(): Result { return { /* exact literal from :81-87 */ }; }
}
export class FakeBrowserTransport extends FakeTransportBase implements PublishTransport {
    public readonly kind = 'browser';
    public readonly driver: BrowserDriver;
    constructor(driver: BrowserDriver = 'agent') { super(); this.driver = driver; }
    protected override defaultResult(): Result { return { /* exact literal from :146-153, metadata: { driver: this.driver } */ }; }
}
```

`nextResult ?? default` has the same effect as the current `if (this.nextResult)`, because a `Result` is always an object and never falsy. Keep `readonly kind` as a literal type; `as const` is unnecessary on a `readonly` class field. Keep JSDoc on the exported classes. `override` is optional here: a probe on 2026-09-23 against `tooling/typescript/base.json` (`noImplicitOverride: true`) showed tsc accepts an abstract-member implementation with or without it. Keep `override` for readability. The explicit `driver` field plus constructor assignment copies the current code at `:111,118-121`; avoid parameter properties.

**R4: link escaping** (both `render-md.ts` copies, identical code)

```ts
const escapeLinkText = (s: string): string => s.replace(/[\\[\]]/g, '\\$&');
const escapeLinkUrl = (s: string): string =>
    s.replace(/[ ()<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
// ...
label = `[${escapeLinkText(titleT)}](${escapeLinkUrl(urlT)})`;
```

Apply the escaping only in the combined title+url branch. The url-only branch stays a bare URL (autolink behavior is unchanged), and title-only stays plain text. Put the two helpers next to `renderReferenceLabel` in each copy, and keep the `SYNC:` header comment in the plugin copy accurate.

**R5: sibling-`package.json` bound** (`packages/kk-core/src/registry.ts:234-270`)

```ts
/** @internal exported for tests — walk up from startDir to the first `<dir>/plugins` tree that sits beside a package.json. */
export function findBuiltinRoot(startDir: string): string | undefined {
    let dir = startDir;
    for (;;) {
        const candidate = join(dir, 'plugins');
        if (existsSync(join(dir, 'package.json')) && isPluginsTree(candidate)) return candidate;
        const parent = dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
}
function resolveBuiltinRoot(injected: string | undefined): string | undefined {
    return injected ?? findBuiltinRoot(dirname(fileURLToPath(import.meta.url)));
}
```

Export `findBuiltinRoot` from `registry.ts` **only**. Do not add it to the `src/index.ts` entry point; tests import from `'../src/registry'`. Update the JSDoc of `resolveBuiltinRoot` (`:234-240`) to state the sibling-manifest rule.

**R6: portable, cwd-relative plugin paths** (`registry.ts:149-159`)

```ts
import { basename, delimiter, dirname, join, resolve } from 'node:path';
const base = opts.cwd ?? process.cwd();
for (const entry of (env.KK_PLUGIN_PATH ?? '').split(delimiter).filter((e) => e !== '')) {
    const abs = resolve(base, entry);
    if (isDirectory(abs)) roots.push({ origin: 'path', root: abs });
}
for (const extra of opts.extraPaths ?? []) {
    if (extra === '') continue;
    const abs = resolve(base, extra);
    if (isDirectory(abs)) roots.push({ origin: 'path', root: abs });
}
```

`resolve(base, absolutePath)` returns `absolutePath` unchanged, so absolute entries keep their behavior. Hoisting `base` is fine: `projectRoot` at `:144` already uses the same expression, so reuse it there too. Update the `DiscoverAllOptions.env` JSDoc (`:39`) from "colon-separated" to "`path.delimiter`-separated", and update `docs/04_DESIGN.md:326` in the same way.

**R7: `trySelectors` timeout and absolute profile override** (`packages/publish-harness/src/index.ts:216-264`)

- `const timeout = options.timeout ?? 2000;` then `locator.isVisible({ timeout })`, removing `Math.min(timeout, 2000)`. JSDoc: "`timeout` is forwarded to `isVisible`; Playwright ignores it (1.55 `@deprecated`), so visibility is a point-in-time check, not a wait."
- `resolveBrowserProfileDir`: `return resolve(trimmed);` for non-`~/` overrides. Import `resolve` from `node:path` alongside `join`.

**R8: `z.looseObject`** (`packages/kk-core/src/manifest.ts:17-29`)

```ts
export const PluginManifestSchema = z.looseObject({ name: ..., kind: ..., entry: ..., version: ..., description: ..., operations: ... });
```

Keep the `operations` comment. Check that `PluginManifest` (inferred) still has an index signature for extra keys; `z.looseObject` infers `{ ...; [k: string]: unknown }`, the same as `.passthrough()`.

**R9: derived operation types**

```ts
const PluginOperationSchema = z.object({ input: OperationIOSchema, output: OperationIOSchema });
export type PluginOperation = z.infer<typeof PluginOperationSchema>;
// operations: z.record(z.string(), PluginOperationSchema).optional()
```

In `src/index.ts`, extend the `./manifest` export block with `type OperationIO`, `OperationIOSchema`, and `type PluginOperation`. Biome sorts the block, so don't hand-order it. `registry.ts:6` keeps importing `type PluginOperation` from `./manifest`.

**Rejected alternatives** (see Q&A): a one-shot `setNextResult`; an exported base class or factory; deleting the unused browser helpers; merging the two render-md copies; moving `main()` out of kk-core; stopping the built-in search at the first `package.json`.

### Plan

Test-first for each item: write the new test first, run it and watch it fail (except R2/R3/R8, which preserve behavior), implement, then watch it pass. Order goes from least to most coupled, and each step is independently green.

0. Baseline: `bun run test` must be green before starting (review baseline: kk-core 62/62, publish-harness 13/13). Save `bun apps/cli/src/index.ts plugin status > <scratch>/plugin-status.before.txt` from the repo root for AC5.
1. **R1** (`kinds.ts`): add prototype-key assertions to `tests/kinds.test.ts:62-76` and a `constructor/plugin.json` case to `tests/registry.test.ts` (AC1), confirm they fail, switch to `Object.hasOwn`, and confirm they pass.
2. **R8 + R9** (`manifest.ts`, `index.ts`): extract `PluginOperationSchema`, derive `PluginOperation`, switch to `z.looseObject`, and export the three symbols from `src/index.ts`. Add the AC8 unknown-key test if missing and the AC9 import test in `tests/index.test.ts`. Run `bun run lint` (typecheck) to prove `registry.ts:6` still compiles.
3. **R6** (`registry.ts:144-159`): add the AC6 test and confirm it fails (relative entries are dropped when the test cwd ≠ `<tmp>`), implement `delimiter` + `resolve(base, …)`, update the JSDoc at `:39`, and confirm it passes.
4. **R5** (`registry.ts:234-257`): add AC5 (a)/(b)/(c), where (a) must fail first, extract `findBuiltinRoot`, add the `package.json` condition, and update the JSDoc. Then save `plugin status` again to `<scratch>/plugin-status.after.txt` and `diff` it against the before file; the diff must be empty.
5. **R4** (both `render-md.ts` copies): add the AC4 unit test and extend the parity fixture (`render-md.test.ts:169-199`), confirm they fail, add `escapeLinkText` / `escapeLinkUrl` to **both** copies with identical code, and confirm they pass, including parity.
6. **R2 + R3** (`publish-harness/src/index.ts:46-170`): add the AC2 sticky tests (they pass before the refactor; they pin behavior), refactor to `FakeTransportBase`, then run `bun test packages/publish-harness plugins/publishings` with no existing test edited, and run the AC3 `rg` checks.
7. **R7** (`publish-harness/src/index.ts:216-264`): add AC7 tests (the timeout-7000 and relative-override tests must fail first), implement, and update the JSDoc.
8. **Docs, same commit (T3)**: `docs/04_DESIGN.md` at `:259` (`z.looseObject`), `:326` (`KK_PLUGIN_PATH` → `path.delimiter`-separated, relative entries resolve against cwd), `:375` (add `OperationIOSchema`, `OperationIO`, `PluginOperation`), `:386-387` (sticky `setNextResult` until `reset()`), `:389` (override resolved to absolute), and `:390` (`trySelectors`: point-in-time visibility; `timeout` forwarded, ignored by Playwright). Re-anchor with `rg` first if the line numbers have drifted.
9. **Gate**: `bun run format`, then `bun run gate`, `spur task check 0155`, and `git status --short`, which must list only the files named in the Acceptance Criteria gate paragraph.
10. **Commit**: one atomic commit, `fix(kk-core,publish-harness): harden kind lookup, builtin root, plugin paths, render links (0155)`, with a body listing R1–R9. No `--no-verify`.

### Root Cause

All anchors are at `main@d4dd562d`.

- **R1:** `packages/kk-core/src/kinds.ts:43` uses `name in PLUGIN_COLLECTION_KINDS`, and the `in` operator walks the prototype chain. `PLUGIN_COLLECTION_KINDS` is a plain object literal (`:24-28`), so `Object.prototype` members count as hits. Verified: `kindForCollection('constructor')` → `[class Object]`, `kindForCollection('toString')` → a function. `discoverPlugins` then treats such a directory as a collection (`registry.ts:94-97`) and `consumeManifest` compares `manifest.kind` against a function, which emits `kind_mismatch` (`registry.ts:357-363`) instead of `misplaced`.
- **R2:** `setNextResult` stores into `this.nextResult` (`publish-harness/src/index.ts:63,128`), and `publish` returns it without clearing it (`:77-79,142-144`). Only `reset()` clears it (`:102,168`). The JSDoc "on the next publish invocation" (`:59,124`) is wrong.
- **R3:** The two fakes were written by copy and paste in task 0141 (`index.ts:49-104` vs `:109-170`). The call-log, `setNextResult`, `getCallLogs`, and `reset` bodies are identical, which is why #2 exists twice.
- **R4:** `renderReferenceLabel` interpolates raw strings into link syntax (`kk-core/src/render-md.ts:52`: `` `[${titleT}](${urlT})` ``; plugin copy `plugins/kk/scripts/render-md.ts:111`). A `]` in the title ends the link text early, and a space or `)` in the URL ends the destination early.
- **R5:** `resolveBuiltinRoot` (`registry.ts:245-256`) walks up to the filesystem root and accepts the first `plugins/` that passes `isPluginsTree` (`:260-270`: any kind-collection subdirectory). Nothing ties the candidate to a package, so a missing staged tree falls through to arbitrary ancestors, and those plugins run as `builtin`.
- **R6:** `registry.ts:150` hard-codes `.split(':')`, and `:151`/`:156` call `isDirectory(entry)` on the raw string, which Node resolves against `process.cwd()` and not the injectable `opts.cwd` used for `projectRoot` at `:144`.
- **R7:** `publish-harness/src/index.ts:241` defaults `timeout` to 5000, and `:252` caps it with `Math.min(timeout, 2000)`. The cap is dead logic and the docs promise a wait, but Playwright 1.55.0 ignores `isVisible`'s `timeout` (`playwright-core/types/types.d.ts:13838-13842`), so real browsers never waited. The defect is misleading docs and dead code, not a lost wait. `:223` returns a non-`~/` override unresolved, which contradicts `BrowserSessionOptions.profileDir`'s "Absolute profile directory" (`:176`).
- **R8:** `manifest.ts:29` still uses `.passthrough()` (deprecated in Zod 4 in favor of `z.looseObject`) from before the Zod 4 migration. `schemas.ts:51,56` already migrated.
- **R9:** `PluginOperation` is a hand-written interface (`manifest.ts:11-14`) that repeats the inline schema at `:27`, and none of `OperationIOSchema` / `OperationIO` / `PluginOperation` is exported from `src/index.ts:19-23`, even though `PluginRecord.operations` exposes the type publicly (`registry.ts:22`).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Origin: `/sp:dev-review packages --agent inline --focus all` session, 2026-09-23, `main@d4dd562d`.
- Prior tasks: 0141 (publish-harness browser drivers + `FakeBrowserTransport`; its Review already flagged `driver?` as optional, a frozen design choice outside this task), 0145 (browser channels that consume the harness helpers), 0058 / C5 (render-md frozen template), 0110 I3 (manifest `operations`).
- ADRs: `docs/00_ADR.md` ADR-009 (kind collections), ADR-012 (multi-root discovery, D2 built-in tree, R3 root order, R6 single-plugin path roots), ADR-008 amdt 2026-09-17 (browser transports).
- Design: `docs/04_DESIGN.md:250-260` (discovery + manifest), `:326` (`KK_PLUGIN_PATH`), `:363-391` (kk-core / publish-harness export tables); `docs/design/remaining-wt-publish-harvest.md`.
- Bundling: `scripts/bundle-plugins.ts:20-21` (repo `plugins/` → `apps/cli/plugins`, which R5 must keep resolving).
- Consumers to keep green: `plugins/publishings/{qiita,zenn,surfdash,emdash}-pub/tests/*` (sticky `setNextResult`), `plugins/publishings/infoq-pub/src/index.ts:9,53` (`resolveBrowserProfileDir`), `apps/cli/src/{invoke.ts:291,commands/plugin.ts:56,fanout.ts:452,fanin.ts:352}` (`discoverAllPlugins`).
- Zod 4 deprecation evidence: @zod 4.4.3 `v4/classic/schemas.d.ts` line 460 — `/** @deprecated Use `z.looseObject()` or `.loose()` instead. */` on `passthrough()` (installed under `node_modules/.bun/zod@4.4.3`).

#### API/library claim sources and confidence (checked 2026-09-23)

| Claim (used by) | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| `in` includes inherited `Object.prototype` keys, while `Object.hasOwn` checks own keys only (R1) | MDN `in`: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/in ; MDN `Object.hasOwn` (ES2022): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/hasOwn | bun probe: `'constructor' in {a:1}` → `true`, `Object.hasOwn(...)` → `false`; `kindForCollection('constructor')` → `[class Object]`; `tooling/typescript/base.json:4-6` sets `lib`/`target` `ESNext` | HIGH |
| `path.delimiter` is `:` on POSIX and `;` on win32 (R6) | Node docs: https://nodejs.org/api/path.html#pathdelimiter | bun probe: `":"` / `";"` | HIGH |
| `path.resolve(base, abs)` returns `abs`, and `resolve(base, rel)` joins onto `base` (R6, R7) | Node docs: https://nodejs.org/api/path.html#pathresolvepaths | bun probe: `/abs/x`, `/base/rel` | HIGH |
| `.passthrough()` is deprecated in favor of `z.looseObject()`, and a loose object keeps and infers extra keys (R8) | Zod 4 objects: https://zod.dev/api#objects | zod 4.4.3 `v4/classic/schemas.d.ts:460` `@deprecated Use z.looseObject() or .loose()`; bun probe: `z.looseObject({name}).parse({name,extra:1})` keeps `extra`, and `z.infer` accepts `extra` | HIGH |
| `z.infer` of the operation schema is structurally identical to the hand-written `PluginOperation` (R9) | Zod type inference: https://zod.dev/basics#inferring-types | Not compiled yet; AC9 `bun run lint` is the proof | MEDIUM (reasoned, gated by AC9) |
| Backslash escapes `\[ \] \\` in link text, and a destination containing a space or unbalanced parens breaks an inline link (R4) | CommonMark 0.31.2 §2.4 backslash escapes: https://spec.commonmark.org/0.31.2/#backslash-escapes ; §6.3 links: https://spec.commonmark.org/0.31.2/#links | markdown-it 14 (installed in the scratchpad only): the escaped form renders `<a href="https://x.test/a%20b%28c%29%3Cd%3E">A [b] \ c</a>`, and the raw form renders as literal text | HIGH |
| Playwright `locator.isVisible({ timeout })` ignores `timeout` and returns immediately (R7) | Playwright API: https://playwright.dev/docs/api/class-locator#locator-is-visible | repo-pinned `playwright-core@1.55.0` `types/types.d.ts:13838-13842` `@deprecated This option is ignored` | HIGH |
| An abstract-member implementation compiles without `override` under `noImplicitOverride: true` (R3 design note) | TS docs: https://www.typescriptlang.org/tsconfig/#noImplicitOverride | `bunx tsc --noEmit` probe with the repo `base.json`: no error | HIGH for the repo's TS version; the keyword is optional either way |
| A sibling `package.json` exists at every legitimate built-in root (R5) | Repo layout, not an external API | `package.json` present at the repo root, `apps/cli/`, and in the published package (`apps/cli` `bin`/`prepack`, ADR-010 R5); staging target `scripts/bundle-plugins.ts:21` | HIGH for the monorepo and bundle; MEDIUM for third-party install layouts (AC5 (c) covers the `<pkg>/dist` shape) |

Retracted during verification: (1) "tsc requires `override`" (probe showed it doesn't); (2) review #6's "the 2000 ms cap makes `timeout` useless", because Playwright ignores the option entirely. R7, Root Cause, and Q&A were rewritten to match.

### History
