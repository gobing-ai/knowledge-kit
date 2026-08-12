# kk product CLI surface

Feature **A2**. Design satellite for the operator-facing `kk` binary, command-module tree, and
npm pack artifact. Status: **Accepted (design)** pending design-approval; implementation
graduates into `apps/cli`.

> Chosen approach: spur-shaped `registerXCommand` tree + `kk` npm bin + lean runtime
> (no spur ApplicationRuntime / DB / banner). Reason: docs already say `kk`; a single
> `cli.ts` cannot grow; the package name stays `@gobing-ai/knowledge-kit` (ADR-007 R2).

---

## 1. Decisions

| ID | Choice | Rejected | Why |
|----|--------|----------|-----|
| D1 | Operator binary `kk`; package `@gobing-ai/knowledge-kit`; `knowledge-kit` bin alias | Package rename; `kk` only with no alias | R2 keeps the package name; alias avoids breaking `knowledge-kit` scripts in the same release |
| D2 | `apps/cli/src/commands/<noun>.ts` + `registerXCommand(program)` | Keep everything in `cli.ts`; kind-noun rewrite (`ingest`/`generate`/`publish`) | Growth without breaking shipped `invoke`/`fanin`/`fanout` |
| D3 | `main(argv) → number`; no `process.exit` in actions | Keep `process.exit` in each action | Testable fail-loud without mocking `process.exit` |
| D4 | Version from `apps/cli/package.json` | Hard-coded `.version('0.0.0')` | `--version` must match the published package |
| D5 | npm ships Bun-target `dist/index.js`; `prepack` builds it | Native `bun --compile` this feature; Trusted Publisher this feature | Operator owns OIDC later; native binaries are a later slice |
| D6 | Globals: `--help`/`-h`, `--version`/`-V`, `--verbose`/`-v`. `--json` stays per-command | Global `--json`; `--cli-verbose` (spur name) | Commander defaults + one diagnostic flag; `--json` already lives on `plugins *` |

Authority: **ADR-010** (Accepted design). Amendments on ADR-002 / ADR-004 / ADR-007 R2.

## 2. Module layout

```
apps/cli/src/
  index.ts                 # #!/usr/bin/env bun; import.meta.main → process.exit(await main())
  main.ts                  # main(argv, options?) → Promise<number>
  config.ts                # CLI_CONFIG { binaryName: 'kk', binaryLabel: 'kk', binaryVersion }
  cli.ts                   # createProgram(): name, version, global opts, register* calls
  commands/add.ts
  commands/invoke.ts
  commands/plugins.ts
  commands/fanin.ts
  commands/fanout.ts
```

`createProgram()` stays the side-effect-free factory (ADR-002, `.spur/rules/surface/check-cli-surface.yaml`).
The surface rule is updated: require `export function createProgram(` in `cli.ts`; require
`export function register` in each `commands/*.ts`; forbid `.parse(` in `cli.ts` and `commands/`.

## 3. Interfaces

```ts
export const CLI_CONFIG: {
    binaryName: 'kk';
    binaryLabel: 'kk';
    binaryVersion: string; // apps/cli/package.json version, e.g. '0.1.0'
};

export interface MainOptions {
    output?: { write(s: string): void; error(s: string): void };
}

export function createProgram(): Command;

export function main(argv?: string[], options?: MainOptions): Promise<number>;

export function registerAddCommand(program: Command): void;
export function registerInvokeCommand(program: Command): void;
export function registerPluginsCommand(program: Command): void;
export function registerFaninCommand(program: Command): void;
export function registerFanoutCommand(program: Command): void;
```

Version load: read `apps/cli/package.json` at module init (or a generated `binaryVersion` constant
updated by release later). Do not hard-code `'0.0.0'`.

Command actions return `void` / `Promise<void>` and set a captured exit code (or throw a
typed error that `main` maps to `1`/`2`). They do **not** call `process.exit`.

## 4. Operator surface (specified)

```text
kk
kk --help | -h | help
kk help <command>
kk --version | -V
kk --verbose | -v <command> …
kk add <a> <b>
kk invoke <plugin> --in <path> --out <path> [--plugins-root <dir>]
kk plugins list [--kind <kind>] [--json] [--plugins-root <dir>]
kk plugins doctor [--json] [--plugins-root <dir>]
kk fanin --in <f>… --out <path>
kk fanout --content <path> --target <p>… --out <path> [--retry-from <path>] [--plugins-root <dir>]
```

Shipped verb flags and exit codes are **unchanged**. `--verbose` may write diagnostics via
`logger.info` to stdout; it must not interleave into a command's `--json` payload (diagnostics
go to stderr, or are suppressed when `--json` is set).

Unknown commands: non-zero exit, stderr names the command (Commander default).

## 5. Package / pack

`apps/cli/package.json`:

```json
{
  "name": "@gobing-ai/knowledge-kit",
  "bin": {
    "kk": "./dist/index.js",
    "knowledge-kit": "./dist/index.js"
  },
  "files": ["dist/", "README.md"],
  "scripts": {
    "build": "bun build src/index.ts --target=bun --outdir=dist",
    "prepack": "bun run build"
  }
}
```

`prepack` exists so `npm pack` / a later `npm publish` see `dist/index.js` (npm ≥ 11 checks bin
existence before lifecycle scripts).

**Out of this satellite:** npm Trusted Publisher, GitHub OIDC, `.github/workflows/`, native
multi-arch `bun --compile` binaries.

## 6. Invariants

1. Package name is `@gobing-ai/knowledge-kit`. Never rename it in this feature.
2. `program.name()` is `kk`. Help text says `kk`.
3. `--version` equals `apps/cli/package.json` `version`.
4. New nouns add a file under `commands/` and one `register*` call. They do not grow
   `cli.ts` with action bodies.
5. Pipeline verbs `invoke` / `fanin` / `fanout` / `plugins` keep flag names and exit codes.
6. Output stays on `@gobing-ai/utils` `logger`.
7. No `process.exit` outside `index.ts`.
8. Same-commit T3: `docs/04_DESIGN.md` §1 binary prefix becomes `kk` with the implementing commit.

## 7. Test plan (design)

- In-process `main(['--help'])` / `main(['--version'])` / `main(['help', 'invoke'])` exit 0.
- `--version` stdout equals `package.json` version and is not `0.0.0`.
- `main(['not-a-command'])` non-zero.
- `main(['--verbose', 'add', '1', '2'])` exit 0.
- `main(['--verbose', 'plugins', 'list', '--json', …])` stdout remains a JSON array.
- Existing invoke / fanin / fanout / plugins tests switch from `process.exit` mocks to
  `main` return codes.
- `package.json` `bin.kk` and `bin.knowledge-kit` point at `./dist/index.js`.

## 8. Doc / rule touch list (implementation)

| File | When |
|------|------|
| `docs/00_ADR.md` ADR-010 + amendments | this design (T1/T2) |
| `docs/03_ARCHITECTURE.md` entry + data flow | this design (T1) |
| `docs/01_PRD.md` A2 in-scope; package-rename non-goal clarified | this design (T6) |
| `docs/02_ROADMAP.md` A2 on Phase 2 | this design (T5) |
| `docs/04_DESIGN.md` §1 prefix `kk` | implementing commit (T3) |
| `AGENTS.md` binary name | implementing commit (T3) |
| `.spur/rules/surface/check-cli-surface.yaml` | implementing commit |

---

**Rejected alternatives (detail).** Patch-in-place leaves `cli.ts` as a dump site. Kind-noun
rewrite breaks B5/B6 workflow shells. Copying spur's `runNodeApplication` / figlet / SQLite
fails the deletion test (one caller, no second adapter).
