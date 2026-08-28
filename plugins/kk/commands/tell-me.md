---
name: tell-me
description: Explain the supplied or current topic with the smallest useful view; use ELI5 only when requested.
argument-hint: "[topic] [--eli5]"
allowed-tools: ["Skill"]
---

# tell-me

Thin wrapper for the `explain-things` skill — all explanation and view-selection logic lives in
the skill. Forward `$ARGUMENTS` unchanged, including empty arguments (the skill owns
conversation-topic fallback).

```text
Skill(skill="kk:explain-things", args="$ARGUMENTS")
```
