#!/usr/bin/env bash

# monkeys-memory: auto-capture experience after each commit
# Installed by: monkeys-memory init-repo
# Safe to remove if you no longer want auto-capture

MONKEYS_MEMORY_BIN="${HOME}/.monkeys-memory/bin/monkeys-memory"

if [ ! -f "${MONKEYS_MEMORY_BIN}" ]; then
  exit 0
fi

# Run capture in background so it never slows down commits
(bash "${MONKEYS_MEMORY_BIN}" capture --auto --workspace "$(pwd)" 2>/dev/null || true) &
