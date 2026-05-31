# Repository Guidelines

## Product Boundary
This repository is the standalone open-source Monkeys Memory project. It is a
local-first OSS engine with its own CLI, Skills, schemas, install script, and
file-based memory compiler/retriever/capture workflow.

This repository is completely independent from the commercial SaaS product.
Do not add SaaS account flows, hosted API dependencies, browser login, billing,
organizations, quotas, PATs, CLI token storage, server persistence, or
multi-tenant behavior here.

The SaaS product lives in separate private repositories:

- `monkeys-memory-server/`: private hosted backend.
- `monkeys-memory-web/`: private hosted frontend.
- `Monkeys-Memory-Nginx/`: private SaaS edge/proxy routing.

The SaaS CLI lives in `monkeys-memory-cli/` and is the only open-source part of
the SaaS product. It is published as
`@inf-monkeys-tech/monkeys-memory-cli`, uses browser login, talks to the hosted
API, and owns the bundled SaaS Skills for agent usage. Do not copy SaaS CLI
behavior into this OSS repo.

## Project Structure & Module Organization
- `bin/monkeys-memory`: local CLI entrypoint.
- `scripts/`: CLI command implementations and local memory engine.
- `scripts/lib/`: shared compiler, retriever, sync, allowlist, and utility
  modules.
- `skills/`: OSS Codex and Claude Code Skills.
- `schemas/`: JSON schema contracts for experiences and compiled memory.
- `templates/`: local hook and capture templates.
- `examples/`: safe public sample memory data.
- `tests/`: Node test suite.

Private runtime memory lives under `.monkeys-memory/` and should stay
gitignored.

## Build, Test, and Install Commands
Use Node.js 22+.

- `npm test`: run the full Node test suite.
- `./install.sh`: install the local OSS CLI and Skills.
- `./install.sh --no-hooks`: install without configuring git hooks.
- `monkeys-memory compile`: compile local experiences into memory rules.
- `monkeys-memory retrieve`: retrieve relevant local memory for a task.
- `monkeys-memory capture`: capture a local experience.
- `monkeys-memory init-repo --workspace <path>`: enable a local repo.

## Coding Style & Constraints
Follow the existing JavaScript module style: ESM `.mjs` files, 2-space
indentation, small helpers, and direct local file operations. Prefer simple
local behavior over SaaS-style abstractions.

Keep this repository useful when cloned from GitHub with no hosted Monkeys
Memory account. If a feature requires the SaaS API, it belongs in the SaaS CLI,
server, or web repositories instead.

## Skills Ownership
The Skills in this repository are OSS Skills for the local open-source engine.
They are separate from the SaaS Skills bundled by `monkeys-memory-cli/`.

Do not point these Skills at the SaaS API, and do not assume the SaaS CLI should
consume these files. If a Skill concept exists in both products, update each
repository deliberately while preserving their independence.

## Security
Do not commit local memory data, secrets, tokens, customer data, or
environment-specific paths. Keep examples synthetic and safe for public release.
