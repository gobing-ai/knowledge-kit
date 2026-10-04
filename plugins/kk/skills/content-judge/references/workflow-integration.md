# Workflow integration — content-judge in a spur workflow

Spur's workflow engine executes one node at a time (`type: parallel` is an inert schema field —
see `docs/03_ARCHITECTURE.md`). The judge step is therefore a single `agent.run` node followed
by a `shell` node that guards the transition to `publish`.

## Step shape

```yaml
- kind: agent.run
  options:
    role: reviewer
    input: |
      Evaluate the generated content against the {{rubric}} rubric.
      Content: {{content_path}}
      Write the verdict to {{verdict_path}}.
      Load plugins/kk/skills/content-judge/SKILL.md.
    expectFile: "{{verdict_path}}"
```

- `agent.run` spawns an agent that loads the `content-judge` skill, performs the evaluation, and writes
  the verdict JSON to `{{verdict_path}}` (typically `.spur/run/verdict-judge.json`).
- The verdict file is the only durable artifact. The agent's prose output is not the contract.

## Shell/`jq` guard

The guard runs as a `shell` step after `judge`. It reads the verdict and gates the transition.

```sh
#!/usr/bin/env sh
verdict_path="{{verdict_path}}"
if [ ! -f "$verdict_path" ]; then
  echo "judge: verdict file not found at $verdict_path"
  exit 1
fi
# Confidence-aware read: a PASS without a HIGH|MEDIUM|LOW confidence becomes `PASS!`, which no
# accept guard matches and the catch-all below rejects. Keep this filter byte-identical wherever a
# guard reads a judge verdict (`plugins/kk/tests/verdict-confidence.test.ts` enforces that).
verdict=$(jq -r 'if (.verdict // "") == "PASS" then (.verdict + (if ((.confidence // "") | test("^(HIGH|MEDIUM|LOW)$")) then "" else "!" end)) else (.verdict // "") end' "$verdict_path")
case "$verdict" in
  PASS)
    echo "judge: PASS"
    exit 0
    ;;
  FAIL|NEEDS_REVISION)
    echo "judge: $verdict — see $verdict_path for findings"
    jq -r '.findings[]? | select(.status=="fail") | "  FAIL: \(.criterion): \(.detail)"' "$verdict_path"
    exit 1
    ;;
  *)
    echo "judge: unrecognized verdict or a PASS without a valid confidence ('$verdict') in $verdict_path"
    exit 1
    ;;
esac
```

### Guard rules

1. **Missing file → block.** The guard never assumes PASS. A missing verdict is a failure.
2. **Unrecognized value → block.** Only `PASS` unblocks; anything else exits 1.
3. **`FAIL` and `NEEDS_REVISION` both block** — the distinction is for the feedback loop, not the
   gate. The workflow topology decides whether to retry (NEEDS_REVISION) or halt (FAIL).
4. **A `PASS` without a `HIGH | MEDIUM | LOW` confidence is not a verdict.** The confidence-aware
   read above makes it arrive as `PASS!`, so it fails rule 2 like any other out-of-contract value.
5. **Leave a catch-all.** A guard set with no matching transition deadlocks the machine; every
   judge state needs a terminal `*`/catch-all edge for verdicts outside the contract.

## Retry topology (NEEDS_REVISION)

For a bounded regenerate-retry loop, wire the workflow so that a `NEEDS_REVISION` verdict routes
back to the `generate` step with the verdict's `feedback` as additional input. Cap retries (the
example workflow uses 2). This is workflow-level orchestration — `content-judge` itself is stateless
and re-runnable.

```
generate ──▶ judge ──PASS──▶ publish
              ▲    │
              │    └─NEEDS_REVISION──▶ (retry ≤ N, feedback from verdict)
              │
            (loop back)
```

## Workflow YAML location

The runnable example lives at `plugins/kk/workflows/judge-gated-publish-example.yaml`. It demonstrates
`generate → judge → guard → publish` with a 2-retry NEEDS_REVISION loop.
