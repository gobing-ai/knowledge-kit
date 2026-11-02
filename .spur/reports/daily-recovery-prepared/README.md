# Daily recovery prepared patch

These files are review-only copies. The active workflows under `plugins/kk/workflows/` were not
changed.

The `deployment/` subdirectory contains promotion-ready copies whose self-check and nested-workflow
references already point at `plugins/kk/workflows/...`; promote those files to the active names only
after approval. The top-level copies remain self-contained for unattended regression tests.

Promotion targets (not executed):

```text
deployment/kk-daily-safety.yaml   -> plugins/kk/workflows/kk-daily-safety.yaml
deployment/kk-daily-ai-voice2.yaml -> plugins/kk/workflows/kk-daily-ai-voice2.yaml
```

Prepared changes:

- `kk-daily-safety.yaml` splits primary and retry producers into guarded states. JSON contract
  checks preserve valid report/verdict artifacts, invalid outputs take one bounded retry, and the
  gate remains fail-closed. Remediation uses the safety request digest instead of Spur's Git-tree
  `requireDiff`, because daily drafts live below ignored `.works`; after a no-op retry it still
  runs `daily-safety-revise` to validate/restore structure and spend the budget, preserving the
  legacy admission-only `exclude` outcome rather than manufacturing a block by deleting evidence.
  Judge validation now requires the full `compliance` verdict contract (rubric, score, summary,
  four criterion findings with detail, feedback, content reference and ISO timestamp). The final
  publish-valid guard rejects a real safety `escalate` in unattended mode while preserving the
  attended caller pause; catalog fallback `escalate` remains acceptable when the gate status is
  `pass` or `exclude`.
- `kk-daily-ai-voice2.yaml` forwards `agent_retry`, assigns the nested safety run id
  `${vars.__runId}-safety`, bounds every agent action at `600000` ms, uses the staged safety path,
  passes the explicit `--work-dir` prepare anchor, and only settles selections when the current
  publish-status marker is exactly `full`.
- Safety review/judge primary and retry calls have `1200000` ms deadlines in both copies;
  `deployment/kk-daily-ai-voice2.yaml` keeps generation/publishing agents at `600000` ms and
  replaces review-only nested paths with active workflow paths.
- `plugins/kk/scripts/safety-artifact-check.ts` supplies the guarded report, verdict and revision
  predicates using Bun/Node built-ins only.

Verification:

```text
spur workflow run .spur/reports/daily-recovery-prepared/kk-daily-ai-voice2.yaml \
  --dry-run --quiet --json --run-id voice2-staged-dry-run
status=done

KK_SAFETY_WORKFLOW="$PWD/.spur/reports/daily-recovery-prepared/kk-daily-safety.yaml" \
  bun test plugins/kk/tests/safety-retry-preserves-artifacts.test.ts
8 pass, 0 fail

bun test plugins/kk/tests/mark-published-guard.test.ts
1 pass, 0 fail

./node_modules/.bin/biome check \
  plugins/kk/scripts/safety-artifact-check.ts \
  plugins/kk/tests/safety-retry-preserves-artifacts.test.ts \
  plugins/kk/tests/mark-published-guard.test.ts
PASS
```

Combined staged regression: `9 pass, 0 fail` across the two prepared-workflow test files. This covers
malformed primary report, minimal-PASS and contradictory-PASS verdict artifacts repaired by their
retries, no-op remediation that spends one unit before admitting an admission-only exclusion, and
attended/unattended real escalation routing.

Legacy coverage remains green: `bun test plugins/kk/tests/safety-reviewer-failure.test.ts` is `16 pass,
0 fail` against the active workflow, and the same file with `KK_SAFETY_WORKFLOW` set to the prepared
copy is `16 pass, 0 fail` against the split-state contract.

The safety test defaults to the active workflow, so it remains a red baseline until the staged
workflow is explicitly approved and promoted.
