# monkeys-memory

One engineer teaches an AI once. The whole team benefits forever.

A shared memory layer for coding agents.

`monkeys-memory` turns repo-specific AI know-how into shared team memory. It captures structured engineering experience, compiles it into reusable rules, and injects only the most relevant memory back into future coding sessions.

The engine is open source. Your actual team memory data is private by default.

## Included

This release includes:

- allowlist-based repo activation
- repo-scoped raw experience storage
- compiled memory generation
- runtime retrieval by repo, path, and task
- auto-init for new allowlisted repos
- auto-compile after capture
- post-merge sync for affected repos only

## Why

Teams already teach Claude Code and Codex the same repo rules again and again:

- do not patch this module directly
- always go through this adapter
- this test passing is not enough for release

Those instructions usually die inside private chats.

`monkeys-memory` turns that repeated, hidden project understanding into:

- `Raw Experiences`
- `Compiled Memory`
- `Runtime Context`

The result is a shared memory layer that grows with the team instead of resetting every session.

## How It Works

1. A developer finishes a task and captures a structured repo-specific experience.
2. The system compiles raw experiences into repo-level rules, onboarding notes, and path indexes.
3. Another developer starts work in the same repo.
4. The coding agent retrieves only the most relevant compiled memory for that repo, path, and task.

## Quickstart

Prerequisites:

- Git
- Bash
- Node 22+

```bash
git clone https://github.com/inf-monkeys/Monkeys-Memory.git ~/monkeys-memory
cd ~/monkeys-memory
./install.sh
```

Install does four things:

1. Links the two Codex skills into `~/.codex/skills/`
2. Installs a stable command entrypoint at `~/.monkeys-memory/bin/monkeys-memory`
3. Runs an initial compile
4. Configures a `post-merge` hook for pull-triggered sync

When installed from a git checkout, hooks are enabled by default for the `monkeys-memory` repo itself, and the installer prints that explicitly.

If you do not want that hook setup:

```bash
./install.sh --no-hooks
```

It also initializes a local private memory directory at:

```text
.monkeys-memory/
```

This directory is gitignored and intended to stay private.

## Enable Your Repos

After install, edit the local allowlist file inside your `monkeys-memory` clone:

```text
<monkeys-memory>/.monkeys-memory/org/repo-allowlist.json
```

Add the directory names of the repos where memory should activate:

```json
{
  "version": 1,
  "org": "default-org",
  "repos": ["sample-app", "sample-agent-server"]
}
```

Rules:

- repo names must match the git repo directory name, for example `sample-app`
- adding a repo to the allowlist is enough; memory auto-initializes on first `compile`, `retrieve`, or `capture`
- repos outside the allowlist are ignored cleanly

See the synthetic sample layout under [`examples/sample-memory/`](examples/sample-memory/) for a safe public example.

After that, the main commands are:

```bash
bash "$HOME/.monkeys-memory/bin/monkeys-memory" compile
bash "$HOME/.monkeys-memory/bin/monkeys-memory" retrieve --workspace /path/to/repo --task bugfix
bash "$HOME/.monkeys-memory/bin/monkeys-memory" capture --workspace /path/to/repo --task bugfix --title "..." --claim "..."
bash "$HOME/.monkeys-memory/bin/monkeys-memory" sync
```

## Repo Allowlist

Memory is enabled centrally through:

- `<monkeys-memory>/.monkeys-memory/org/repo-allowlist.json`
- sample reference: [`examples/sample-memory/org/repo-allowlist.json`](examples/sample-memory/org/repo-allowlist.json)

Behavior:

- if a repo is in the allowlist, memory activates automatically
- if a repo is not in the allowlist, `retrieve` and `capture` skip cleanly
- if a new repo is added to the allowlist, it auto-initializes on first `compile`, `retrieve`, or `capture`

## Private Data

The real `.monkeys-memory/` directory is private team data and should not be committed.

What stays private:

- real repo names
- real raw experiences
- compiled memory generated from internal work
- org-specific review rules and patterns

What the repo includes instead:

- schemas
- scripts
- skills
- templates
- a safe synthetic example under [`examples/sample-memory/`](examples/sample-memory/)

## Compile Triggers

Compile runs at four moments:

- after install
- after `capture` for the current repo
- after `git pull` on the memory repo, via `post-merge`, for affected repos only
- during `retrieve` only if compiled outputs are missing or stale

## Support Matrix

| Capability | Availability | Notes |
| --- | --- | --- |
| Codex skills | Yes | `install.sh` links `org-memory-use` and `org-memory-capture` into `~/.codex/skills/` |
| Claude Code integration | CLI-compatible | Claude Code can use the same CLI flow; a dedicated install path is not bundled in this repo |
| Allowlist-based activation | Yes | Only approved repos get memory behavior |
| Auto-init for new repos | Yes | Adding a repo to the allowlist is enough |
| Repo-managed compile | Yes | `compile` and `capture` run directly from the memory repo CLI |
| Pull-triggered selective compile | Yes | `post-merge` runs `sync` and recompiles affected repos only |
| Central online compiler | Not included | This release works without a hosted control plane |

## Project Layout

```text
monkeys-memory/
  examples/
  schemas/
  scripts/
  skills/
  templates/
  tests/

Local private data created after install:
  .monkeys-memory/
```

## Commands

```bash
./install.sh
./install.sh --no-hooks
npm run compile
npm run retrieve -- --workspace /path/to/repo --task bugfix
npm run capture -- --workspace /path/to/repo --task bugfix --title "..." --claim "..."
npm run sync
npm test
```

## Future Directions

- fully automatic experience extraction from real sessions
- first-class Claude Code install path
- hosted compile/control plane
- effect measurement across a real team

## Internal Notes

Internal architecture and roadmap notes are kept outside the open-source surface.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for development expectations and public repo boundaries.

## License

[MIT](LICENSE)
