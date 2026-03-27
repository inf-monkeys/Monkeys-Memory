---
name: org-memory-use
description: Retrieve team memory before making code changes in an allowlisted repo. Use your judgment — skip for simple questions, retrieve when you are about to modify code or make decisions that could conflict with team conventions.
---

# Org Memory Use

This skill gives you access to compiled team memory — rules, exceptions, and conventions that previous developers learned the hard way.

## When to retrieve

Use your judgment. Retrieve when:

- You are about to **modify code** and want to check if there are team rules for the affected paths
- You are making an **architectural or design decision** and want to know if the team has conventions
- You are doing a **bugfix, refactor, or review** in a module you haven't worked on before
- The user asks you to work on a **complex or unfamiliar area** of the codebase

Do NOT retrieve when:

- The user is asking a simple question ("what does this function do?")
- You are just reading code to understand it
- The task is trivial and doesn't touch team conventions (renaming a variable, fixing a typo)
- You already retrieved for this repo and path in the current session

## How to retrieve

```bash
bash "$HOME/.monkeys-memory/bin/monkeys-memory" retrieve --workspace "<current-repo>" --task <task>
```

Task types: `bugfix`, `hotfix`, `refactor`, `feature`, `review`

The CLI auto-detects the repo from the workspace directory. It returns the most relevant compiled rules for the current context.

## What you get back

A short list of team rules ranked by relevance:

```
1. **Route settlement changes through adapter first.**
   Confidence: high | Sources: 3 | Scope: src/settlement/**

2. **Always verify cache write-back after settlement changes.**
   Confidence: medium | Sources: 1 | Scope: src/settlement/**
```

Apply these rules to your work. If rules conflict (marked with `Conflicts with:`), use your judgment based on the specific situation.

## Fallback

If the CLI is not available or the repo is not in the allowlist, just continue without memory. Do not block on this.

If compiled outputs are missing, the CLI recompiles automatically. You do not need to run compile manually.
