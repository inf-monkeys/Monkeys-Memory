---
name: org-memory-capture
description: Use this skill after code changes, debugging, or review in a repository that uses monkeys-memory. It captures new repo-specific project understanding as structured experiences and then refreshes compiled memory.
---

# Org Memory Capture

This skill is the default write path for team memory.

## When to use

- A coding task has just finished
- A review surfaced a stable project rule or exception
- A debugging session produced a reusable insight
- The session changed how future contributors should approach a module

## Workflow

1. Decide whether the session produced reusable project understanding.
2. Capture only stable engineering knowledge, not temporary phrasing.
3. Capture the experience via the CLI instead of manually writing JSON when possible:

```bash
bash "$HOME/.monkeys-memory/bin/monkeys-memory" capture --workspace "<current-repo>" --task <task> --title "<title>" --claim "<claim>"
```

4. This writes a new JSON file under:

```text
.monkeys-memory/repos/<repo>/experiences/
```

This path is inside the `monkeys-memory` repo, not the project repo being worked on.

5. Follow [`experience.schema.json`](../../schemas/experience.schema.json).
6. Keep the claim narrow and scoped.
7. The capture CLI refreshes compiled memory for the current repo automatically after writing the experience.

## What to capture

- Path-specific development rules
- Stable review guidance
- Hidden module boundaries
- Historical compatibility constraints
- Testing or release caveats
- Valid exceptions to normal rules

## What not to capture

- Personal style preferences with no repo value
- One-off workarounds with no reuse value
- Prompt wording that does not express a real project insight
- Generic coding advice unrelated to this repo

## Repo Scope

- Only capture memory for repos that are present in the central allowlist
- If the current repo is not in the allowlist, skip capture without treating it as an error
