---
name: org-memory-capture
description: Capture reusable engineering insights after code changes in an allowlisted repo. Use your judgment — only capture when the session produced knowledge that would save a future developer time or prevent a mistake.
---

# Org Memory Capture

This skill lets you save team knowledge so the next developer doesn't repeat the same discovery.

## When to capture

Use your judgment. Capture when:

- You discovered a **non-obvious constraint** ("this module can't be changed without updating the adapter")
- A debugging session revealed a **hidden dependency** or gotcha
- A review surfaced a **stable rule** that applies to future changes in the same area
- You made a decision that **future developers should know about** and wouldn't find in the code itself

Do NOT capture when:

- The fix was trivial and self-evident from the code
- The insight is a personal preference, not a team convention
- It's a temporary workaround that will be removed soon
- It's generic programming advice not specific to this repo

## How to capture

```bash
bash "$HOME/.monkeys-memory/bin/monkeys-memory" capture --workspace "<current-repo>" --task <task> --title "<short title>" --claim "<what future developers should know>"
```

Preview first with `--dry-run`:

```bash
bash "$HOME/.monkeys-memory/bin/monkeys-memory" capture --workspace "<current-repo>" --auto --dry-run
```

Write a good claim:
- Bad: "Fixed the bug in settlement"
- Good: "Settlement changes must go through the adapter layer; direct service patches break the reconciliation job"

## Auto-capture

The post-commit hook runs `capture --auto` in the background after every commit. This produces lower-confidence (0.5) experiences from commit messages. You don't need to duplicate this manually.

If you have a **higher-quality insight** than what auto-capture would produce, capture it manually with a clear claim. Your manual capture (confidence 0.7) will carry more weight.

## Fallback

If the CLI is not available or the repo is not in the allowlist, skip capture silently. Do not block on this.
