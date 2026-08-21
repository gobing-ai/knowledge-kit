# ts-libs logging foundation

Feature **A3** (accepted design; not yet built). Authority: ADR-014 and ADR-015. Architecture and
tradeoffs: `docs/03_ARCHITECTURE.md` (Output and diagnostics foundation).

## 1. Dependency surface

Root `package.json` changes `workspaces` from an array to Bun's object form and defines one catalog:

```jsonc
{
  "workspaces": {
    "packages": [
      "apps/*",
      "packages/*",
      "plugins/ingestions/*",
      "plugins/generations/*",
      "plugins/publishings/*",
    ],
    "catalog": {
      "@gobing-ai/ts-db": "^0.4.39",
      "@gobing-ai/ts-infra": "^0.4.39",
      "@gobing-ai/ts-runtime": "^0.4.39",
      "@gobing-ai/ts-utils": "^0.4.39",
    },
  },
}
```

Consumers use `"catalog:"`; no workspace hardcodes a ts-libs version.

| Consumer              | Dependency                                  | Reason                                                           |
| --------------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| root dev dependencies | `ts-utils`                                  | `plugins/kk/scripts/render-md.ts` executes from the root package |
| `apps/cli`            | `ts-utils`, `ts-infra`                      | command output adapter + process logging bootstrap               |
| `packages/kk-core`    | `ts-utils`                                  | `render-md` executable output                                    |
| plugin workspace      | `ts-utils`                                  | only when its executable emits operator-facing output            |
| plugin workspace      | `ts-infra`                                  | only when its executable emits structured diagnostics            |
| `karakeep-local`      | dependencies above via a new `package.json` | it becomes a normal workspace consumer                           |
| any workspace         | `ts-runtime`, `ts-db`                       | **none in feature A3**                                           |

Removing `@gobing-ai/utils` also removes manifest-only dependencies that have no source import;
they are not replaced.

## 2. Terminal output interface

`apps/cli/src/output.ts` is the CLI-local injectable adapter:

```ts
import { echo, echoError } from "@gobing-ai/ts-utils";

export interface CommandOutput {
  write(message: string): void;
  error(message: string): void;
}

function withoutFinalLineEnding(message: string): string {
  return message.replace(/\r?\n$/, "");
}

export const consoleOutput: CommandOutput = {
  write(message): void {
    echo(withoutFinalLineEnding(message));
  },
  error(message): void {
    echoError(withoutFinalLineEnding(message));
  },
};

export function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
```

- `main(argv, { output })` injects one `CommandOutput`; Commander and command actions use it.
- Product plugins and root scripts import `echo` / `echoError` from ts-utils directly; they never
  import from `apps/cli`.
- `echo` is stdout and `echoError` is stderr. The adapter removes one existing final line ending
  before ts-utils adds one, preserving Commander strings and call sites that already end in `\n`.
- Existing message text, stderr/stdout choice, and exit codes remain unchanged.

## 3. Diagnostics interface

Every executable process that emits structured diagnostics initializes LogTape once before calling
`getLogger`:

```ts
import { getLogger, initializeLogger } from "@gobing-ai/ts-infra";

await initializeLogger({
  console: process.env.NODE_ENV !== "test",
  json: true,
  level: "warn",
});

const log = getLogger("kk.<kind>.<plugin>");
```

Category names are stable and plugin-scoped:

| Process          | Category                     |
| ---------------- | ---------------------------- |
| `kk` CLI         | `kk.cli`                     |
| ingestion plugin | `kk.ingestion.<plugin-name>` |
| generator plugin | `kk.generator.<plugin-name>` |
| publish plugin   | `kk.publish.<plugin-name>`   |
| root script      | `kk.script.<script-name>`    |

Call sites use `getLogger`; they do not call `initializeLogger` or provide a custom sink. Tests call
`setLoggerMuted(true)` in setup and exercise behavior through public output/logging interfaces.

## 4. Migration ownership

| Current owner                                          | Target                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| Commander output and `apps/cli` user-facing errors     | injected `CommandOutput`                                               |
| `packages/kk-core/src/render-md.ts` user-facing errors | ts-utils `echoError`                                                   |
| product-plugin usage/fatal messages                    | ts-utils `echoError`                                                   |
| recoverable operational warnings with context          | ts-infra plugin logger                                                 |
| `plugins/kk/scripts/render-md.ts` usage/fatal messages | ts-utils `echoError`                                                   |
| tests that monkey-patch `@gobing-ai/utils`             | injected `CommandOutput`, ts-utils buffer targets, or `setLoggerMuted` |

`packages/utils` is deleted only after `rg '@gobing-ai/utils' apps packages plugins` returns no
source or manifest references. Its `add`, `z`, and `ZodType` exports have no production consumers
and are removed without a compatibility package or re-export.

## 5. Enforcement surface

`.spur/rules/typescript/output-boundaries.yaml` includes:

```yaml
include:
  - "apps/**/src/**/*.ts"
  - "packages/**/src/**/*.ts"
  - "plugins/**/src/**/*.ts"
  - "plugins/kk/scripts/**/*.ts"
exclude:
  - "**/tests/**"
  - "**/*.test.ts"
  - "**/fixtures/**"
  - "**/node_modules/**"
  - "**/dist/**"
```

The rule forbids `console.(log|error|warn|info|debug|dir|time|trace)` and
`process.(stdout|stderr).write`. The implementation sequence is rule scope → confirm RED against the
pre-migration baseline → migrate → confirm GREEN with zero findings.

## 6. Verification contract

- The catalog contains all four `^0.4.35` constraints; only direct consumers declare `catalog:`.
- `initializeLogger` runs once per diagnostic-emitting executable process; no plugin installs a
  custom sink.
- Production terminal output uses ts-utils; structured diagnostics use ts-infra.
- The output-boundaries rule reports zero production violations and ignores tests/fixtures.
- `packages/utils` and every `@gobing-ai/utils` source/manifest reference are absent.
- `ts-runtime` and `ts-db` have no dependency edge in feature A3.
- `bun run lint`, `bun run test`, and `bun run build` pass.

## 7. Verified source contracts (2026-08-16)

| Contract                                          | Primary source                                                                            |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `echo`, `echoError`, injectable targets           | `/Users/robin/xprojects/ts-libs/packages/utils/src/output.ts` at package version `0.4.35` |
| `initializeLogger`, `getLogger`, `setLoggerMuted` | `/Users/robin/xprojects/ts-libs/packages/infra/src/logger.ts` at package version `0.4.35` |
| Bun catalog shape and `CommandOutput` adapter     | `/Users/robin/xprojects/spur-new/package.json`, `apps/cli/src/output.ts`                  |

Confidence: **HIGH** — signatures and versions were read from local primary source; no behavior is
inferred from package memory.
