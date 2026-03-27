---
name: org-memory-use
description: Use this skill when starting or switching a coding task in a repository that uses monkeys-memory. It retrieves repo-specific compiled memory for the current repo, path, and task, and injects only the most relevant team experience instead of dumping all raw memory.
---

# Org Memory Use

This skill is the default read path for team memory.

## When to use

- A new coding session starts
- The user moves into a new module or directory
- The task changes between bugfix, refactor, feature work, or review
- The current repo is expected to be covered by a shared `monkeys-memory` allowlist

## Workflow

1. Determine the current workspace and infer repo, path, and task type from the current repo state and user request.
2. Prefer using the retrieval CLI first with auto-detection:

```bash
bash "$HOME/.monkeys-memory/bin/monkeys-memory" retrieve --workspace "<current-repo>" --task <task>
```

3. If direct file inspection is needed, inspect compiled outputs inside the `monkeys-memory` repo rather than the current work repo:
   - `.monkeys-memory/repos/<repo>/compiled/rules.json`
   - `.monkeys-memory/repos/<repo>/compiled/onboarding.md`
   - `.monkeys-memory/repos/<repo>/compiled/path-index.json`
4. Inject only the top 3 to 5 relevant rules into the working context.
5. Do not load all raw experiences by default.
6. Only inspect raw experiences if:
   - compiled rules conflict
   - confidence is low
   - the user explicitly asks for evidence or source history

## Retrieval Priority

The retriever scores rules using multiple signals:

1. Repo-level compiled rules (primary source)
2. Org-level cross-repo rules (lower weight, appears when patterns repeat across repos)
3. Path specificity (more specific path matches score higher)
4. Task type matching (rules tagged for the current task score higher)
5. Confidence score (higher confidence scores higher)

Global rules (scope `**`) always receive a base score even without a specific path context.

## Rules

- Default to `Compiled Memory`, not `Raw Experiences`
- Keep runtime context small
- Preserve exceptions when they are relevant
- Pay attention to `conflicts_with` annotations — they indicate contradictory rules with overlapping scope
- If the current repo is not in the allowlist, do nothing and continue without memory
- The `retrieve` CLI recompiles missing or stale compiled outputs automatically
- Only suggest a manual compile if retrieval fails and the compiled state still needs to be refreshed:

```bash
bash "$HOME/.monkeys-memory/bin/monkeys-memory" compile
```

- Check project status with:

```bash
bash "$HOME/.monkeys-memory/bin/monkeys-memory" status
```
