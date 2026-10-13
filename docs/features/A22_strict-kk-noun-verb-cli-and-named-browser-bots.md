---
schema_version: 1
id: "A22"
name: "Strict kk noun-verb CLI and named browser bots"
status: backlog
priority: P2
tags: []
created_at: "2026-10-13T22:21:11.075Z"
updated_at: "2026-10-13T22:39:32.510Z"
---

# A22: Strict kk noun-verb CLI and named browser bots

## Goal

Give operators a consistent kk noun-verb interface and reusable named local browser sessions while preserving every existing command contract.

## Scope

- In: complete registered command inventory; canonical stage run and lock acquire/release; hidden legacy aliases; bot list/login/logout/open; shared launcher reuse; channel-specific session preservation; tests, packaged CLI checks and documentation.
- In: a dependent review of workflows, scripts, skills and browser callers, followed by replacements supported by verified behavior.
- Out: task execution during this planning run; new browser services, plugin kinds, account automation, credential exports, remote session revocation, new publishing actions, runtime upgrades and unrelated domain renames.
- Coordination: A21 remains shipped history; E93 owns plugin readiness and login probes, which remain supported and distinct from bot lifecycle operations.

## Acceptance Criteria

```gherkin
Feature: Strict kk noun-verb CLI and named browser bots

  Scenario: R1 — Canonical operations have exactly two command words
    # covers: I1
    Given the complete visible command tree including all store and workflow operations
    When an operator inspects root and noun help
    Then each executable operation uses kk followed by one noun and one verb
    And stage run and lock acquire and lock release replace the irregular canonical paths
    And existing valid board, daily, executor, ledger, plugin, schedule and store operations retain their names
    And a command-tree test detects a direct noun action or a nested third command word

  Scenario: R2 — Existing command routes preserve their contracts
    # covers: I2
    Given scripts using stage positional arguments, store lock acquire or release, and existing hidden aliases
    When they execute with their original arguments and options
    Then they reach the same action engines with equivalent stdout, stderr, exit codes and side effects
    And aliases are hidden from canonical help without emitting warnings into machine output
    And legacy stage names and canonical stage run dispatch without losing unknown options or positional arguments

  Scenario: R3 — Cached bot inventory is local and truthful
    # covers: I3
    Given an absent or populated ~/.config/kk/browser-profiles directory
    When kk bot list runs
    Then it lists cached regular profile directories including legacy profiles without metadata
    And it returns an empty successful inventory when the root is absent
    And it never launches a browser or claims that a cached profile proves a current login
    And it excludes symlinks and unrelated files without printing credentials

  Scenario: R4 — Interactive login retains a reusable named session
    # covers: I4, I7
    Given a valid HTTP or HTTPS URL and a safe bot name
    When kk bot login URL --save NAME runs and the operator completes authentication
    Then a headed browser explicitly navigates to that supplied URL through the shared launcher
    And a known channel uses its owned authentication and state persistence behavior
    And an unknown site requires explicit interactive confirmation and is labeled operator-confirmed
    And successful completion records a non-secret default URL and reusable authentication artifacts under that bot directory
    And cancellation, timeout or persistence failure never reports authentication success or destroys an existing saved session
    And invalid names, credential-bearing URLs, unsafe schemes and missing interactive input fail with actionable errors

  Scenario: R5 — Logout removes only the selected inactive local profile
    # covers: I5
    Given a named cached bot and sibling profiles
    When kk bot logout NAME runs
    Then it removes that bot's metadata, browser profile and auxiliary authentication state
    And it preserves sibling profiles and refuses traversal, symlink escapes and active profile ownership
    And an absent bot is an idempotent success without creating a directory
    And the result describes local credential removal without claiming server-side session revocation

  Scenario: R6 — Open reuses the saved page and permits explicit reauthentication
    # covers: I6
    Given a saved bot with a default URL and cached browser state
    When kk bot open NAME runs
    Then it opens that page headed with the same profile and remains available for operator interaction until browser closure
    And it preserves channel-specific authentication-state restoration
    And kk bot open NAME --login enters the interactive login path and updates the saved evidence on success
    And missing profiles or unknown legacy default URLs return actionable guidance without opening a fresh profile
    And browser errors, interruption and contention release owned resources without deleting another process's locks

  Scenario: R7 — Shared browser behavior and plugin readiness remain compatible
    # covers: I7, I2
    Given existing WeChat MP, XHS, X, other browser channels and podcast transports
    When named bots and plugin session commands operate on the same supported channel profile
    Then they reuse the existing launcher and documented profile resolution rules
    And plugin status remains static and plugin check retains its site-owned readiness contract
    And plugin login remains supported with its existing plugin-name arguments and options
    And WeChat MP storage-state capture and restoration survive session reuse
    And API-only or incompatible podcast paths remain explicitly classified without forced browser conversion

  Scenario: R8 — Implementation tasks precede evidence-based caller migration
    # covers: I8, I1, I2, I7
    Given the canonical surface design and bot lifecycle implementation tasks
    When the dependent caller review executes after the bot tasks
    Then it inventories workflows, scripts, skills, docs, tests and publisher session entry points
    And it records each candidate as replaceable, shared-helper reuse or retained with a concrete reason
    And compatible operator entry points use canonical commands with regression evidence
    And publishing flows keep their existing session, readiness and error semantics
    And all tasks are linked to this feature with explicit dependencies and verification plans

  Scenario: R9 — Generic named sessions can be saved and reopened
    # covers: I4, I6
    Given an unknown HTTP site and a safe bot name
    When the operator confirms login and later opens that named bot
    Then a headed persistent browser navigates to the supplied login URL and retains reusable state
    And the saved default page reopens until the browser closes
    And authentication evidence remains operator-confirmed rather than site-verified
    And open with --login reauthenticates then opens the saved page for interaction
    And cancellation, contention and failed promotion preserve the previous saved profile
    And browser-free list and help work from the installed CLI without installed browser binaries
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0275 | Normalize kk stage and lock commands with compatible aliases | todo |
| 0276 | Implement named bot list login logout and open lifecycle | todo |
| 0277 | Integrate bot sessions with existing browser channel routines | todo |
| 0278 | Review and migrate compatible CLI and browser session callers | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History
