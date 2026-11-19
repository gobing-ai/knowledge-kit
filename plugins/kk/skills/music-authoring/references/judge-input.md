# `4-judge-input.md` — the judge bundle contract

The `review` operation writes **one** file and the judge step is given **one** path. Everything the
judge needs is in it, verbatim, so the judge cannot re-derive a measurement, re-read the instance or
"remember" a number it was never shown.

Written by: `review` (this skill). Read by: `kk:content-judge` with `rubric: music-quality`
(`plugins/kk/skills/content-judge/references/music-quality-rubric.md`).

## Required sections (in this order, these ids)

| Section id | Heading | Content | Source file |
| --- | --- | --- | --- |
| `brief` | `## 1. brief` | the `MusicBrief` YAML of the judged take, **verbatim**, in a `yaml` fence | `1-brief/brief-<nn>.yaml` |
| `prompt` | `## 2. prompt` | the kk-rendered prompt text the model received, **verbatim**, in a `text` fence | `1-brief/brief-<nn>.prompt.txt` |
| `lyrics` | `## 3. lyrics` | the lyric text with its section tags, **verbatim**, in a `text` fence, plus the brief's `language`; when the brief is instrumental say `instrumental brief — no lyric text is sent`; when the model wrote its own, say `model-authored lyrics are not in the bundle` | `2-lyrics.md`, brief `language` |
| `analysis` | `## 4. analysis` | the instance analysis object for this take, **verbatim**, in a `json` fence | `3-takes/analysis-<instanceId>.json` |
| `checks` | `## 5. checks` | `<take>.checks.json`, **verbatim**, in a `json` fence — every row with `id`, `measured`, `threshold`, `unit`, `source`, `result` | `<take>.checks.json` |
| `provenance` | `## 6. provenance` | take path (`content_ref`), `<take>.take.json` digest, instance id, model, unit price spent, run id, and the checks-file path | `<take>.take.json` |

Rules:

- **Verbatim means pasted.** No summarising, no re-typing, no "≈", no unit conversion, no rounding.
  If a file is missing, the bundle is not written: `review` stops naming the missing path.
- **One take per bundle.** The judged take is the one the select gate picked; other takes stay on disk
  as evidence but do not enter the bundle — a judge that has to pick cannot also be the picker.
- **`checks` is the measurement authority.** A finding that cites duration, silence, BPM, key, section
  count or delivery loudness quotes the row from section 5 with its `unit` and `source`.
- **Never hand-edited.** The bundle is generated from the files, so the only way to change it is to
  change an input and rebuild.

## Template

````markdown
# Music judge input — <title> / brief <nn>

Judged take: <take path>            → content_ref
Rubric: music-quality
Verdict path: 4-verdict-music.json

Every number in this bundle comes from section 5 (`checks.json`) with the `unit` and `source` it was
recorded with. The take's audio is not attached: nothing here may be graded by ear.

## 1. brief
```yaml
<1-brief/brief-<nn>.yaml verbatim>
```

## 2. prompt
```text
<1-brief/brief-<nn>.prompt.txt verbatim>
```

## 3. lyrics
Language: <language>
```text
<2-lyrics.md verbatim | instrumental brief — no lyric text is sent | model-authored lyrics are not in the bundle>
```

## 4. analysis
```json
<3-takes/analysis-<instanceId>.json verbatim>
```

## 5. checks
```json
<<take>.checks.json verbatim>
```

## 6. provenance
- content_ref: `<take path>`
- checks: `<take>.checks.json`
- sidecar: `<take>.take.json`
- digest: `<sha256 from the sidecar>`
- instanceId: `<id>`
- model: `pro | clip`
- unitPrice: `<from the sidecar>`
- runId: `<run id, when the sidecar carries one>`
````

## Assembly

```bash
nn=01; take=3-takes/<slug>-<model>-<instanceId>.wav; id=<instanceId>
{
  printf '# Music judge input — %s / brief %s\n\n' "$(sed -n 's/^title: //p' 1-brief/brief-$nn.yaml)" "$nn"
  printf 'Judged take: %s\nRubric: music-quality\nVerdict path: 4-verdict-music.json\n\n' "$take"
  printf '## 1. brief\n\n```yaml\n'; cat 1-brief/brief-$nn.yaml; printf '```\n\n'
  printf '## 2. prompt\n\n```text\n'; cat 1-brief/brief-$nn.prompt.txt; printf '```\n\n'
  printf '## 3. lyrics\n\nLanguage: %s\n\n```text\n' "$(sed -n 's/^language: //p' 1-brief/brief-$nn.yaml)"
  cat 2-lyrics.md 2>/dev/null || printf 'instrumental brief — no lyric text is sent\n'; printf '```\n\n'
  printf '## 4. analysis\n\n```json\n'; cat 3-takes/analysis-$id.json; printf '```\n\n'
  printf '## 5. checks\n\n```json\n'; cat "$take.checks.json"; printf '```\n\n'
  printf '## 6. provenance\n\n'; grep -E '"(digest|instanceId|model|unitPrice|runId)"' "$take.take.json"
} > 4-judge-input.md
```

The same assembly is a `kk-music` state once 0403 wires it; the skill owns the contract either way, so
an operator and the workflow produce the same file. When 0403 lands, run its state rather than the
script above — and check that the file it writes still carries sections 1–6.

## Hand-off to the judge

```
Skill(skill="kk:content-judge")
  rubric:       music-quality
  content_path: <run_dir>/4-judge-input.md
  content_ref:  <run_dir>/<take path>
  verdict_path: <run_dir>/4-verdict-music.json
```

The `agent.run` prompt in 0403 passes `judge-input.md`'s path and nothing else; a prompt that also
pastes the brief or the rows is a second, drifting copy of the bundle.

Exit rules for the consuming gate (unchanged contract, `plugins/kk/workflows/judge-gated-publish-example.yaml`):
`PASS` with `confidence` in `HIGH|MEDIUM|LOW` may proceed; `PASS` without one is refused; `FAIL` and
`NEEDS_REVISION` block `master` (the latter may spend one `iterate` round when the budget allows).
