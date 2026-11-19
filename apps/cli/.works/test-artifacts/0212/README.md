# Task 0212 cutover-check fixtures

Repeatable artifact: the green fixture ledger this test suite drives through
`kk ledger cutover-check --runs 5` (candidate = baseline copy). Re-run:

```
bun test apps/cli/tests/cutover.test.ts
bun apps/cli/src/index.ts ledger cutover-check \
  --candidate w2 --baseline w --runs 5 --works-dir <a dir holding these ledgers>
```

Ledger heading format reference: `# w ledger`.
