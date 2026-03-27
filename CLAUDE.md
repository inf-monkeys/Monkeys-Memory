# monkeys-memory

A shared memory layer for coding agents. When working in any allowlisted repository, use the monkeys-memory CLI to retrieve team memory before starting work and to capture new insights after completing tasks.

## Retrieve memory (do this at session start)

When starting a new coding session in an allowlisted repo, retrieve relevant team memory:

```bash
bash "$HOME/.monkeys-memory/bin/monkeys-memory" retrieve --workspace "$(pwd)" --task <task-type>
```

Task types: `bugfix`, `hotfix`, `refactor`, `feature`, `review`

This returns the most relevant compiled rules for the current repo, path, and task. Inject these into your working context.

## Capture memory (do this after completing a meaningful task)

After completing work that produced reusable engineering insight:

```bash
bash "$HOME/.monkeys-memory/bin/monkeys-memory" capture --workspace "$(pwd)" --task <task> --title "<title>" --claim "<claim>"
```

Or use auto mode to extract from the last commit:

```bash
bash "$HOME/.monkeys-memory/bin/monkeys-memory" capture --workspace "$(pwd)" --auto
```

## Check status

```bash
bash "$HOME/.monkeys-memory/bin/monkeys-memory" status
```

## What to capture

- Path-specific development rules
- Stable review guidance
- Hidden module boundaries
- Historical compatibility constraints
- Testing or release caveats
- Valid exceptions to normal rules

## What NOT to capture

- Personal style preferences with no repo value
- One-off workarounds with no reuse value
- Generic coding advice unrelated to this repo

## Rules

- Always retrieve before starting work in an allowlisted repo
- Default to compiled memory, not raw experience files
- Keep claims narrow and scoped to specific paths when possible
- Only capture stable engineering insights, not temporary workarounds
- If the current repo is not in the allowlist, skip silently
