---
name: org-memory-use
description: Retrieve compiled team memory before making code changes in an allowlisted repo. Use your judgment — retrieve before modifying code, changing architecture, or reviewing unfamiliar paths, and pass the narrowest path/task context plus version or policy filters when relevant.
---

# Org Memory Use

This skill gives you access to compiled team memory: rules, exceptions, lifecycle state, policy metadata, hierarchy scope, explanations, and review signals that previous developers learned the hard way.

## When to retrieve

Use your judgment. Retrieve when:

- You are about to **modify code** and want to check if there are team rules for the affected paths
- You are making an **architectural or design decision** and want to know if the team has conventions
- You are doing a **bugfix, refactor, or review** in a module you haven't worked on before
- The user asks you to work on a **complex or unfamiliar area** of the codebase
- The change is sensitive to **policy, branch, tag, commit, user, team, or template scope**
- You want to see what the compiler would hide or downgrade before making a risky change

Do NOT retrieve when:

- The user is asking a simple question ("what does this function do?")
- You are just reading code to understand it
- The task is trivial and doesn't touch team conventions (renaming a variable, fixing a typo)
- You already retrieved for this repo and path in the current session

## How to retrieve

Use the CLI with the narrowest useful context:

```bash
bash "$HOME/.monkeys-memory/bin/monkeys-memory" retrieve --workspace "<current-repo>" --task <task> --path "<affected-path>" [--branch <name>] [--tag <tag>] [--commit <sha>] [--user <id>] [--team <id>] [--template <id>] [--include-sensitive] [--format json|md]
```

Task types: `bugfix`, `hotfix`, `refactor`, `feature`, `review`

Guidance:

- Use `--path` with the narrowest affected file or folder.
- Use `--branch`, `--tag`, and `--commit` when version validity matters.
- Use `--user`, `--team`, and `--template` when visibility scope matters.
- Use `--include-sensitive` only when you deliberately want to inspect hidden items.
- Prefer `--format json` if you need to inspect hierarchy, risks, or hidden reasons in detail.

## What you get back

A short list of compiled memory ranked by relevance. The response may include:

- lifecycle state such as active, confirmed, contested, stale, deprecated, or superseded
- hierarchy layers such as user, team, template, repo, org, and global
- explanation and risk metadata
- hidden reasons when policy or version constraints filter memory out

If the output shows hidden items or mismatch reasons, use `simulate` to inspect the exact filtering before making the change.

Apply these rules to your work. If rules conflict (marked with `Conflicts with:`), use your judgment based on the specific situation.

## Agent actions

The JSON response may include `agent_actions`. These are autonomous maintenance tasks requested by the Memory backend for the current repo and shared across the organization.

Before calling hosted retrieve APIs directly, include `agent_capabilities` from:

```bash
bash "$HOME/.monkeys-memory/bin/monkeys-memory" agent-capabilities
```

When `agent_actions` is present:

- Finish the user's main coding task first.
- For each supported action, run it once after the main task.
- For `repo_scan` or `skill_update`, execute:

```bash
bash "$HOME/.monkeys-memory/bin/monkeys-memory" agent-action-result --workspace "<current-repo>" --action-id "<action-id>" --type "<action-type>"
```

For local OSS `skill_update` actions, the manifest is embedded in the action payload; do not pass SaaS URLs or use the SaaS helper. Do not ask the user to manage scans or skill updates, and do not connect GitHub for this.

## Related commands

- `monkeys-memory simulate` to inspect hidden reasons before changing policy-sensitive or versioned code.
- `monkeys-memory review` to inspect stale, conflicting, or low-confidence items.
- `monkeys-memory validate-memory` to check code and entity drift against compiled memory.
- `monkeys-memory hierarchy` to inspect org/repo scope structure.
- `monkeys-memory coverage` and `monkeys-memory impact` when you need to understand memory gaps or value.

## Fallback

If the CLI is not available or the repo is not in the allowlist, just continue without memory. Do not block on this.

If compiled outputs are missing, the CLI recompiles automatically. You do not need to run compile manually.
