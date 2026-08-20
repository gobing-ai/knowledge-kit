# Solo-podcast workflow (voice-gen dogfood)

Feature **F5** (shipped). Product state-machine at
`plugins/kk/workflows/kk-solo-podcast.yaml` that turns given text plus a target
duration into Voicebox WAV by authoring a kk VoiceScript and invoking shipped
D5 `voice-gen`.

> Chosen approach: F4-shaped YAML + `agent.run` + builtins-only `validateVoiceScript`
> helper + `kk executor run voice-gen`. `/workflow-run kk-solo-podcast` copies
> design-time `plugins/kk/workflows/` into `$HOME/.config/kk/workflows` and runs that
> dest. Rejected: fat `solo-podcast` skill (no method to distill yet); plain-text Doc
> shortcut (does not exercise VoiceScript); duration flag on `voice-gen` (D5 §7 records
> duration only); `agent.run` loading `docs/design/*` (not in the npm tarball).

Authority: **ADR-009** (product YAML home, `kk-*.yaml` stem), **ADR-011** (no new
`kk` noun), **F4** HITL grain, **D5** VoiceScript + WAV. No new ADR — extends
those conventions; two-way door (delete the YAML).

---

## 1. Decisions

| ID | Choice | Rejected | Why |
|----|--------|----------|-----|
| D1 | Filename `kk-solo-podcast.yaml` under `plugins/kk/workflows/` | `solo-podcast.yaml`; `.spur/workflows/` copy | F4 / ADR-009 stem. YAML is not an installable skill, so the `kk-` prefix is correct. |
| D2 | Feature **F5** under **F** | Reopen D5; new letter | F owns `plugins/kk`. D5 is the generator instance and stays done. |
| D3 | `agent.run` (scribe) for understand / outline / script | Fat `solo-podcast` skill in v1 | Craft is VoiceScript format + a WPM budget, not a writing method. Extract a skill only if dogfood shows prompt rot. |
| D4 | `hitl.select` a\|b\|c for outlines; `hitl.confirm` + bounded `hitl.input` for the script | Outline-only `hitl.confirm`; new `hitl.*` kind | House pattern (kk-itc). TTS is slow/expensive — gate the script before generate. |
| D5 | Audio is the sibling **WAV** D5 already writes | MP3 / ffmpeg | Voicebox `GET /audio/{id}` is WAV; concat is PCM WAV. Transcode is a later publish concern. |
| D6 | Target length = script budget + post-check | Duration field on `voice-gen` | D5 §7: output duration is recorded, not requested. |
| D7 | Self-contained helper `plugins/kk/workflows/validate-voicescript.ts`, copied to `$HOME/.config/kk/workflows/` | `plugins/kk/lib/` importing voice-gen; `plugins/kk/scripts/` | Runtime dest cannot import `../../generations`. Checker is builtins-only; `/workflow-run` copies YAML + sidecar. |
| D8 | `/workflow-run kk-solo-podcast` installs into `$HOME/.config/kk/workflows` and runs `$dest` | Checkout-only `spur workflow run plugins/kk/workflows/…` | Design-time SSOT is the package tree; runtime dest is `~/.config/kk/workflows`. |
| D9 | Require outline-option-a.md and -b.md; c optional | Always three; only one outline | Matches kk-itc. |
| D10 | Duration fail-loud outside 0.5×–2× of target seconds | ±20% fail; warn-only | Coarse band absorbs WPM vs Voicebox rate. Auto-regenerate is out (GPU cost). |
| D11 | No ADR | ADR for “podcast as a workflow” | Extends F4 + D5. Reversible. |

---

## 2. Module layout

```
plugins/kk/workflows/kk-solo-podcast.yaml      # design-time SSOT (copied to ~/.config/kk/workflows)
plugins/kk/workflows/validate-voicescript.ts   # design-time checker (copied beside the YAML)
apps/cli/tests/kk-solo-podcast-workflow.test.ts
docs/design/kk-solo-podcast.md                 # maintainer satellite — not loaded at runtime
```

No new Bun workspace. No change to `apps/cli` command tree. No change to
`plugins/generations/voice-gen` contract. No new `plugins/kk/skills/` directory.

**Deletion test:** remove the YAML + helper + test; D5, F4, `/workflow-run`, and
kk-itc still work. The only lost capability is “text → HITL → VoiceScript → WAV”.

---

## 3. State machine

`kind: state-machine`. `initialState: prepare`. `terminalStates: [done, failed]`.
Success edges: `guard: { kind: always }` so `--dry-run` walks (kk-itc / storm
convention). Action failure uses default `onError: fail`.

Frozen state ids:

```
prepare
  → understand            # agent.run → 1-briefing/briefing.md
  → outline-write         # agent.run → 2-outline/outline-option-{a,b}.md (+ optional c)
  → outline-select        # pause, hitl.select a|b|c   (skip when vars.outline set)
  → outline-commit        # cp selected → outline-approved.md
  → script-write          # agent.run → 3-script/voicescript.yaml
  → script-validate       # bun ${validate_script} --in voicescript.yaml
  → script-review         # pause, hitl.confirm
  → script-revise         # pause, hitl.input; cap 3 via .spur/run/${__runId}-solo-revise-count
  → wrap-docs             # jq Doc[] → 4-audio/docs.json
  → generate              # kk executor run voice-gen
  → duration-check        # jq metadata.duration vs target
  → done | failed
```

Transitions of note (same grain as kk-itc):

| from | to | guard |
| ---- | -- | ----- |
| outline-write | outline-select | `test -z "${vars.outline}"` |
| outline-write | outline-commit | `test -n "${vars.outline}"` |
| script-validate | wrap-docs | `test "${vars.script_approved}" = "true"` |
| script-validate | script-review | always (fallback) |
| script-review | wrap-docs | hitl yes or empty |
| script-review | script-revise | hitl no AND revise-count < 3 |
| script-review | failed | hitl no AND revise-count ≥ 3 |
| script-revise | script-write | always (feedback in `vars.__hitlInput`) |
| duration-check | done | duration in `[0.5, 2] × target_s` |
| duration-check | failed | otherwise |

`understand` is not optional: the operator asked for a review of the source
material, and outline HITL is richer with a briefing artifact.

---

## 4. Vars

All strings (workflow engine contract).

| Var | Default | Role |
| --- | --- | --- |
| `topic` | `""` | Sentence-mode source (XOR with `input_file`) |
| `input_file` | `""` | Markdown path (XOR with `topic`) |
| `work_dir` | required | Resolved works directory (invoker computes) |
| `force` | `"false"` | Overwrite existing `brief.md` |
| `outline` | `""` | Pre-select `a`/`b`/`c`; empty → HITL |
| `script_approved` | `""` | `"true"` skips `script-review` (CI / `--dry-run` walk to `done`) |
| `target_duration_min` | `"8"` | Target episode length in minutes |
| `words_per_min` | `"150"` | Space-delimited spoken budget |
| `cjk_chars_per_min` | `"220"` | CJK spoken budget |
| `voice_profile` | `""` | Voicebox profile name/id; empty → `VOICEBOX_DEFAULT_PROFILE` |
| `language` | `"en"` | VoiceScript `language` (Voicebox enum) |
| `plugins_path` | `""` | empty → ADR-012 default discovery; checkout may set `./plugins` |
| `validate_script` | `""` | empty → `$KK_WORKFLOWS_DIR/validate-voicescript.ts` (default `$HOME/.config/kk/workflows`) |
| `agent` | `""` | `agent.run` executor |
| `__runId` | injected | Revise-count file key |
| `__hitlAnswer` / `__hitlInput` | engine | HITL |

XOR: exactly one of `topic` / `input_file` non-empty. `work_dir` empty → fail
naming `work_dir`. `voice_profile` empty AND `VOICEBOX_DEFAULT_PROFILE` unset
→ prepare fails naming both.

---

## 5. Works layout

```
${work_dir}/
  brief.md
  1-briefing/briefing.md
  2-outline/outline-option-a.md
  2-outline/outline-option-b.md
  2-outline/outline-option-c.md      # optional
  2-outline/outline-approved.md
  3-script/voicescript.yaml
  4-audio/docs.json
  4-audio/content.json
  4-audio/content.wav                # sibling of --out stem
```

prepare: `mkdir -p` those dirs; XOR; write `brief.md`; refuse overwrite unless
`force=true` (kk-itc grain, named recovery).

---

## 6. Duration policy

**Script-write budget** (prompt contract, not a plugin flag):

- If `language` is `zh`, `ja`, or `ko`:
  `target_chars = target_duration_min * cjk_chars_per_min`
- Else:
  `target_words = target_duration_min * words_per_min`

Instruct the scribe to land inside ±20% of that count, spoken prose (contractions,
short sentences, no markdown tables), one speaker, segments ≈ 30–90 s with
`gap_ms` between beats. Per-segment `text` still ≤ 50,000 (D5).

**Post-generate check** (shell/jq):

```
target_s = target_duration_min * 60
dur = jq -r '.metadata.duration' content.json
fail if dur is null/non-numeric
fail if dur < 0.5 * target_s OR dur > 2 * target_s
```

`--out` to `4-audio/content.json` ⇒ D5 writes `4-audio/content.wav`.
`metadata.audioPath` is absolute (D5 §6).

---

## 7. VoiceScript + Doc wrapping

Script-write emits YAML matching D5 §3 (`segments` required; `default_profile`
from `voice_profile` / env; optional `title`, `language`, `gap_ms`, `instruct`).
Solo v1: one speaker via `default_profile`; a `speakers` map is allowed but not
required. Multi-host interview is out.

`script-validate`:

```
vs="${vars.validate_script}"
if [ -z "$vs" ]; then
  if [ -n "$KK_WORKFLOWS_DIR" ]; then vs="$KK_WORKFLOWS_DIR/validate-voicescript.ts"
  else vs="$HOME/.config/kk/workflows/validate-voicescript.ts"; fi
fi
bun "$vs" --in "${vars.work_dir}/3-script/voicescript.yaml"
```

Helper is **builtins-only** (no `@gobing-ai/*`, no relative import into `voice-gen` —
those paths do not exist next to the runtime copy). A SYNC comment points maintainers
at `plugins/generations/voice-gen/src/voicescript.ts`. Exit 1 prints the validator’s
message; no generate.

`wrap-docs` writes `DocListSchema` JSON (`id` + `body` required):

```json
[{
  "id": "<sha256(sourceUri) hex 16>",
  "title": "<VoiceScript title or briefing H1>",
  "sourceUri": "file://<abs>/3-script/voicescript.yaml",
  "body": "<file contents>",
  "mediaType": "application/yaml",
  "metadata": { "voiceProfile": "<resolved profile>" }
}]
```

`generate`:

```
kk executor run voice-gen \
  --in  "${vars.work_dir}/4-audio/docs.json" \
  --out "${vars.work_dir}/4-audio/content.json"
```

`--plugins-path` only when `plugins_path` is non-empty (checkout). Default is ADR-012
discovery from the installed package (`plugins/` in the npm tarball).

---

## 8. agent.run prompt contract

No `skill:` / `prompt:` keys (F4 test). Each `agent.run` has `role: scribe` and
`input:` that names paths. `expectFile` on briefing.md, outline-option-a.md,
voicescript.yaml.

- **understand** — read `brief.md`; write `1-briefing/briefing.md` (audience,
  claims, tone, duration fit, what to cut).
- **outline-write** — two structural options (e.g. narrative vs explainer);
  optional c. Spoken-podcast outlines, not article outlines. Load briefing.
- **script-write** — VoiceScript contract **inlined in `input:`** (never `docs/design/*`;
  that tree is not in the npm tarball). Emit only YAML; honor `__hitlInput` on revise.

---

## 9. Helper signature

```ts
// Runtime: $HOME/.config/kk/workflows/validate-voicescript.ts
// Design-time SSOT: plugins/kk/workflows/validate-voicescript.ts
// bun <this> --in <yaml-or-json>
// exit 0 — validateVoiceScript passed
// exit 1 — named error on stderr
```

`--in` required. Missing/unreadable file → exit 1 naming the path. Does not wrap
`Doc[]` (that is `wrap-docs` jq). Unit tests next to it or in
`apps/cli/tests/validate-voicescript.test.ts` using invalid/valid fixtures; no
Voicebox.

---

## 10. Tests and dogfood

| Layer | What |
| --- | --- |
| Static | `apps/cli/tests/kk-solo-podcast-workflow.test.ts`: frozen ids, HITL kinds, no `docs/design` in YAML, runtime `$HOME/.config/kk/workflows`, no `plugins/kk/skills/solo-podcast` |
| Helper | valid VoiceScript exits 0; empty segments / 50k+ text / unknown engine exit 1 |
| Engine | `spur workflow validate plugins/kk/workflows/kk-solo-podcast.yaml` |
| Dry-run | `spur workflow run … --dry-run` reaches `done` |
| Live | dogfood against local Voicebox; not CI |

---

## 11. Invoke (v1)

Invoker (operator or a later runner profile) computes `work_dir` and passes vars:

```bash
spur workflow run "$HOME/.config/kk/workflows/kk-solo-podcast.yaml" --vars '{
  "topic": "Why HNSW search degrades at 1B rows",
  "work_dir": "$HOME/.config/kk/works/solo-hnsw",
  "target_duration_min": "8",
  "voice_profile": "Robin",
  "language": "en"
}'
```

File mode: `input_file` set, `topic` empty.

---

## 12. Invariants

- `kk` owns generate; the workflow owns orchestration.
- Existing HITL kinds only. Existing `voice-gen` contract only.
- No fat skill. No MP3. No publish. `/workflow-run kk-solo-podcast` copies YAML+helper into `$HOME/.config/kk/workflows` and runs that dest.
- `agent.run` never loads `docs/design/*` (not in the npm tarball).
- No `@gobing-ai/kk-core` schema change. No `apps/cli` noun change.
- Live Voicebox is dogfood; CI is static + dry-run.
- `vendors/voicebox` is not imported.

---

## 13. 03 / 04 / 01 / 05 sync

- `04` §0 index row: this satellite, status **draft (F5)** now; **shipped (F5)** at implement (T9).
- `03` module list: add the YAML path **when it ships** (constitution: current architecture only).
- `01` / `05`: at ship (T4 / T6). F5 row in `05` when the feature file exists (planning).
- No ADR.
