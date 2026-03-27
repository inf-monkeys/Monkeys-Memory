# monkeys-memory

A shared memory layer for coding agents (Claude Code + Codex).

## Development

- Node 22+ required
- `npm test` to run tests
- `./install.sh` to set up skills and CLI
- `./install.sh --no-hooks` to skip git hooks

## Architecture

- Skills define behavior: `skills/org-memory-use/` and `skills/org-memory-capture/`
- Scripts implement the engine: `scripts/lib/`
- Memory data is private: `.monkeys-memory/` (gitignored)
- Schemas define contracts: `schemas/`

## Key commands

```bash
monkeys-memory compile          # compile experiences → rules
monkeys-memory retrieve         # get relevant rules for current context
monkeys-memory capture          # save a new experience
monkeys-memory capture --auto   # auto-capture from last commit
monkeys-memory status           # show all repos and their state
monkeys-memory init-repo        # set up a new repo
```
