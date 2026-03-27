# Team Memory (monkeys-memory)

This repo uses monkeys-memory for shared team knowledge. Follow these rules:

## At session start — ALWAYS retrieve memory first

Before starting any coding task, run:

```bash
bash "$HOME/.monkeys-memory/bin/monkeys-memory" retrieve --workspace "$(pwd)" --task <task-type>
```

Task types: `bugfix`, `hotfix`, `refactor`, `feature`, `review`

Read the output and apply the rules to your work. This is mandatory, not optional.

## After completing a task — capture if you learned something reusable

If the session produced a reusable engineering insight (not a one-off fix), capture it:

```bash
bash "$HOME/.monkeys-memory/bin/monkeys-memory" capture --workspace "$(pwd)" --task <task> --title "<short title>" --claim "<what future developers should know>"
```

## Rules

- Retrieve FIRST, code SECOND
- Pay attention to conflict annotations in retrieved rules
- Keep captured claims narrow and scoped to specific paths
- Do not capture generic advice — only repo-specific insights
