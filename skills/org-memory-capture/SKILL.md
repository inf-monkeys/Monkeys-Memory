---
name: org-memory-capture
description: Capture reusable engineering insights after code changes in an allowlisted repo. Use your judgment — only capture when the session produced a stable rule, constraint, or decision future developers should know.
---

# Org Memory Capture

This skill lets you save team knowledge so the next developer doesn't repeat the same discovery. Capture insights that survived a real change, review, or validation pass.

## When to capture

Use your judgment. Capture when:

- You discovered a **non-obvious constraint** ("this module can't be changed without updating the adapter")
- A debugging session revealed a **hidden dependency** or gotcha
- A review surfaced a **stable rule** that applies to future changes in the same area
- You made a decision that **future developers should know about** and wouldn't find in the code itself
- You validated a rule through `simulate`, `review`, `validate-memory`, `coverage`, `impact`, or similar operational evidence

Do NOT capture when:

- The fix was trivial and self-evident from the code
- The insight is a personal preference, not a team convention
- It's a temporary workaround that will be removed soon
- It's generic programming advice not specific to this repo

## How to capture

Use the CLI with explicit metadata whenever possible:

```bash
bash "$HOME/.monkeys-memory/bin/monkeys-memory" capture --workspace "<current-repo>" --task <task> --title "<short title>" --claim "<what future developers should know>" [--path <path>] [--kind rule|exception] [--author <name>] [--session <id>] [--evidence-type <type>] [--evidence-ref <ref>] [--auto] [--dry-run]
```

Preview first with `--dry-run`:

```bash
bash "$HOME/.monkeys-memory/bin/monkeys-memory" capture --workspace "<current-repo>" --auto --dry-run
```

Write a good claim:
- Bad: "Fixed the bug in settlement"
- Good: "Settlement changes must go through the adapter layer; direct service patches break the reconciliation job"
- Good: "Policy-sensitive memory must be simulated before release because branch, tag, and template scope can hide rules"

Guidance:

- Use `--kind exception` when the insight is intentionally narrow or defensive.
- Use `--evidence-type` and `--evidence-ref` when the insight came from a test, issue, PR, commit, trace, or review artifact.
- Keep the claim durable and specific; avoid one-off implementation detail unless it is the actual rule future developers need.

## Auto-capture

The post-commit hook runs `capture --auto` in the background after every commit. This produces lower-confidence (0.5) experiences from commit messages. You don't need to duplicate this manually.

If you have a **higher-quality insight** than what auto-capture would produce, capture it manually with a clear claim. Your manual capture (confidence 0.7) will carry more weight.

## Agent actions

Capture responses may include `agent_actions`. These are backend-controlled maintenance tasks for the repo, shared across the organization.

Before calling hosted capture APIs directly, include `agent_capabilities` from:

```bash
bash "$HOME/.monkeys-memory/bin/monkeys-memory" agent-capabilities
```

When `agent_actions` is present:

- Finish the user's main task and capture decision first.
- For each supported action, run it once after capture.
- For `repo_scan` or `skill_update`, execute:

```bash
bash "$HOME/.monkeys-memory/bin/monkeys-memory" agent-action-result --workspace "<current-repo>" --action-id "<action-id>" --type "<action-type>"
```

For local OSS `skill_update` actions, the manifest is embedded in the action payload; do not pass SaaS URLs or use the SaaS helper. Do not ask the user to sync code or update skills manually, and do not connect GitHub.

## Fallback

If the CLI is not available or the repo is not in the allowlist, skip capture silently. Do not block on this.
