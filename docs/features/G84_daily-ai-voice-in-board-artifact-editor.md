---
schema_version: 1
id: "G84"
name: "Daily AI Voice in-board artifact editor"
status: active
priority: P2
tags: []
created_at: "2026-11-26T00:25:50.209Z"
updated_at: "2026-11-27T17:04:13.701Z"
---

# G84: Daily AI Voice in-board artifact editor

## Goal

Let the operator correct a Daily AI Voice day's article body or voice script text from the Board before a re-render, through a CLI-owned edit verb that the guarded action plane launches, with a backup and revert for every edit, an audit line, and the safety gate visibly re-armed.

## Scope

**In scope**

- A closed allowlist of two editable day artifacts:
  - `22-article/<day>_06_article-write_body.md`. This is the article prose source. `generate-render` re-derives the article when this file is newer than `_06_article_content.json` (`plugins/kk/scripts/daily-stages.ts:1134-1141`).
  - `24-script/<day>_08_script_voicescript.yaml`. This is the TTS input. It must be valid YAML with a non-empty `segments[].text`.
- A new CLI verb `kk news edit --run-date <day> --artifact article|script --from-file <path|-> --base-sha <sha256>` and `kk news edit --run-date <day> --artifact <a> --revert`. The verb owns the write. Writes are atomic, the previous bytes are backed up to `<day>/edits/`, and a base-hash mismatch is refused. The action plane only launches the verb, so the ADR-035 amendment invariant ("the endpoint only launches existing verbs") holds.
- Two new action kinds on the G83 plane (task 0442):
  - `edit-artifact`. The flow is preview diff, then a single-use token, then spawn with the body on stdin.
  - `revert-artifact`.
  Both reuse the existing envelope: default-off switch, exact origin plus `X-KK-Action`, the `ops-console:<day>` lock, and `actions.jsonl`.
- The day projection marks safety as `stale` when the safety digest no longer matches the current article or script bytes (`plugins/kk/scripts/safety-artifact-check.ts:199-207`). It also adds an `artifact-edited` attention item whose recipes come in render order:
  - article edit: `generate-render`, then safety;
  - script edit: safety, then `generate-voice`.
- A Generation-tab editor. It is a plain textarea plus a server-computed unified diff preview, with no new dependency.

**Out of scope**

- Editing cards, illustrations, social copy, locale files, plans or any other artifact.
- Rich-text or WYSIWYG editing, multi-user merging, and comments.
- Editing once the day's bundle is frozen. That is refused, and the operator starts a fresh run instead.
- Automatically re-rendering or publishing after a save. The recipes stay explicit, one click each.

## Acceptance Criteria

```gherkin
Feature: Daily AI Voice in-board artifact editor

  @core
  Scenario: R1 — The operator edits an allowlisted day artifact through the CLI verb
    # covers: I15
    Given the day 20261125 is not frozen and no run holds its ops-console lock
    When the operator runs kk news edit --run-date 20261125 --artifact article --from-file new.md --base-sha <sha of the current bytes>
    Then 22-article/20261125_06_article-write_body.md holds exactly the new bytes, written atomically
    And the previous bytes are kept under the day's edits directory with a timestamped name
    And the command prints the backup path and the new sha256

  @core
  Scenario: R2 — Every edit can be reverted to the bytes it replaced
    # covers: I15
    Given an edit of the voice script was applied for 20261125
    When the operator runs kk news edit --run-date 20261125 --artifact script --revert
    Then the voice script holds the bytes from before that edit
    And the revert itself is backed up so it can also be undone

  @core
  Scenario: R3 — Unsafe or stale edits are refused and change nothing
    # covers: I15
    Given the day 20261125
    When an edit names an artifact outside the allowlist, a path that escapes the day directory, a base sha that no longer matches, a voice script without non-empty segments text, a body over the size cap, or a day whose bundle is frozen
    Then the command exits nonzero with a reason naming the failed check
    And the artifact bytes on disk are unchanged and no backup is written

  @core
  Scenario: R4 — The Board edits through the guarded action plane
    # covers: I15
    Given board.actions.enabled is true and the operator opens the Generation tab for 20261125
    When the operator changes the article text, previews the diff and confirms with the returned token
    Then the reader launches kk news edit with the body on stdin and records preview and execute lines in actions.jsonl
    And a disabled plane, a bad origin, a reused token or a held lock launches nothing and is audited as a refusal

  @core
  Scenario: R5 — An edit re-arms the safety gate and names the re-render steps
    # covers: I15
    Given the article or voice script of 20261125 changed after its safety verdict
    When the day digest is built
    Then the safety line reads stale rather than its old verdict
    And an artifact-edited attention item lists the re-render and safety recipes in the order they must run

  @edge
  Scenario: R6 — A concurrent change to the artifact is not overwritten
    # covers: I15
    Given the operator loaded the voice script and a generation step rewrote it afterwards
    When the operator confirms an edit carrying the old base sha
    Then the edit is refused as a conflict and the editor offers to reload the current bytes
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0444 | Daily AI Voice kk news edit verb, edit/revert action kinds and safety-stale projection | done |
| 0445 | Daily AI Voice Generation-tab artifact editor and end-to-end evidence | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-11-27T17:04:13.701Z backlog → active (system)

