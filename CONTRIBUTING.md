# Contributing

`monkeys-memory` is an open-source, privacy-sensitive project. Public contributions should improve the engine, schemas, skills, tests, and synthetic examples without exposing real team memory.

## Development

- Use Node 22+.
- Run `./install.sh --no-hooks` if you want the full local setup without enabling the repo hook.
- Run `npm test` before opening a pull request.

## Public Repo Boundaries

- Do not commit real `.monkeys-memory/` data.
- Do not commit `internal-docs/`.
- Keep examples synthetic. Use [`examples/sample-memory/`](examples/sample-memory/) as the pattern for safe public fixtures.
- If behavior changes, keep [`README.md`](README.md), [`install.sh`](install.sh), and the skill docs under [`skills/`](skills/) aligned.

## Pull Requests

- Explain the user-visible change.
- Call out install, migration, or compatibility impact.
- Include the commands you used to validate the change.
