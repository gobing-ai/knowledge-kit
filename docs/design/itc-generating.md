# ITC generating skill

Feature **F3** (2026-08-19). One fat agent skill that encodes the four STORM studies on
writing IT technical documents and orchestrates existing `plugins/kk` skills. Not a
runtime plugin, not a `kk` CLI verb, not a slash command.

> Chosen approach: new skill `plugins/kk/skills/itc-generating` (Approach 1). Rejected:
> slash wrapper (bare forwarder; `topic` has none); new `kk` noun (ADR-011); folding the
> method into `topic` (breaks F2 scope and the SKILL.md size budget).

Authority: existing **ADR-009** (`plugins/kk` is the only home for agent capabilities) and
**ADR-011** (first-layer nouns stay `executor` + `plugin`). No new ADR — this feature
extends those conventions; it does not set a new cross-cutting one.

---

## 1. Decisions

| ID | Choice | Rejected | Why |
|----|--------|----------|-----|
| D1 | New fat skill `itc-generating` under `plugins/kk/skills/` | Extend `topic`; harvest WT 7-stage | `topic` is frozen topic-core (F2). WT image/adapt/publish stay deferred PRD F-children. Method + orchestration is a new capability. |
| D2 | Skill only — no slash, no `kk` verb | `/itc` wrapper; `kk itc …` | Slash is justified only when it owns a run procedure (`/workflow-run`). CLI needs an ADR-011 amendment. Skill() after `superskill install kk` is the invoke. |
| D3 | Directory / `name:` is `itc-generating` | Requested `itc-gnerating` | Skill `name` must match the parent directory; a typo freezes `kk:itc-gnerating`. |
| D4 | Distill the four works-dir studies into `references/` (one level deep) | Vendor full `content.md`; leave studies only in `~/.config/kk/works/` | Progressive disclosure (agent-skill study). Works dirs remain provenance, not installable craft. |
| D5 | Reuse `topic` artifact paths (`brief.md`, `2-outline/`, `3-draft-draft-article.md`) | New 7-stage workspace | One authoring layout. `itc-generating` does not invent a parallel tree. |
| D6 | Delegate research → `storm-research`, authoring gates → `topic`, optional quality → `content-judge` | Reimplement outline/draft/research inside this skill | Existing skills already own those contracts (C4 / F2 / F1). This skill owns *when* and *which playbook*. |
| D7 | Default operation is `create`; no re-export of `topic` init/outline/draft | Duplicate topic's four operations | Users who want a single topic-core step call `topic`. This skill's job is the method + orchestration. |

## 2. Module shape

```text
plugins/kk/skills/itc-generating/
  SKILL.md                         # lean: purpose, when/not, invocation, ops, fail-loud, pointers
  references/
    generic-craft.md               # five disciplines (generic IT docs study)
    platform-english.md            # X / Medium / Substack playbook
    platform-wechat.md             # WeChat Official Account + specific-platform playbook
    skill-authoring.md             # how this skill itself stays lean (self-discipline)
```

Provenance (not shipped in the skill body):

- `~/.config/kk/works/how-to-write-the-best-generic-it-technical-docum-0a71c5a7`
- `~/.config/kk/works/how-to-write-it-technical-documents-for-english-a6a76477`
- `~/.config/kk/works/how-to-write-it-technical-documents-for-specific-d158f7c2`
- `~/.config/kk/works/how-to-write-the-best-technical-document-with-ex-2c52b35c`

Install id: `kk:itc-generating` (`superskill install kk` prefixes the plugin name).

**Deletion test:** if this directory is removed, `topic` / `storm-research` / `content-judge` still
work. The only lost capability is "apply the distilled IT-writing method and pick the
playbook." That is a real module.

## 3. Invocation contract

```
[create] <topic-or-brief> [--dir <target>] [--brief <path>]
         [--playbook generic|english|wechat]
         [--research] [--judge]
         [--outline <a|b|c>] [--revise <feedback>] [--force]
```

| Token | Meaning | Default |
| --- | --- | --- |
| `create` | only operation; may be omitted | `create` |
| `<topic-or-brief>` | quoted topic, or `--brief <path>` | required — empty fails loud |
| `--dir` | workspace directory | `./<kebab-case(topic)>` |
| `--playbook` | which reference to load as the writing method | `generic` |
| `--research` | if the workspace has no evidence, run `storm-research` first | off |
| `--judge` | after an approved draft, run `content-judge` (`tech-accuracy`) | off |
| `--outline` / `--revise` / `--force` | passed through to `topic` | same as `topic` |

`create` sequence:

1. Load `references/generic-craft.md` always; load the selected playbook if not `generic`.
2. If `--research` and no reusable evidence → invoke `storm-research` (XOR topic / `--in`).
3. Run `topic create` against `--dir` with the same artifact contract and gates (R3 resume,
   no overwrite without `--force`).
4. Apply the loaded method while drafting (one goal, value proposition, POLA, show-don't-tell;
   platform constraints from the playbook).
5. If `--judge` → invoke `content-judge` on `3-draft-draft-article.md`. A non-`PASS` verdict is
   reported; it does not auto-publish or auto-revise past `topic`'s 3-round bound.
6. Print artifact paths and stop.

Unknown operation, empty topic, missing `--brief` path, or existing target without `--force`
fail loud with the recovery line (same table family as `topic` R5).

## 4. What this skill does not do

- Live publish (E / publish plugins).
- Image generation (deferred F child).
- Change `topic`, `storm-research`, or `content-judge` contracts.
- Add `plugins/kk/commands/itc*.md`.
- Add a `kk` first-layer noun or verb.
- Become a `kind: generator` plugin or accept `GeneratorInput`.

## 5. Verification

- `superskill` validate + install `--dry-run` discovers `itc-generating`; dry-run writes
  nothing.
- Dogfood: `create` on a throwaway dir writes `topic` paths; `--force` absent does not
  overwrite; missing topic fails loud.
- Static: no new file under `plugins/kk/commands/` matching `itc*`; `kk --help` still
  lists only `executor` and `plugin`.
