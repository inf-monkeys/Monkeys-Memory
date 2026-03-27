# monkeys-memory

One engineer teaches an AI once. The whole team benefits forever.

A shared memory layer for coding agents.

`monkeys-memory` turns repo-specific AI know-how into shared team memory. It captures structured engineering experience, compiles it into reusable rules, and injects only the most relevant memory back into future coding sessions.

The engine is open source. Your actual team memory data is private by default.

## Included

This release includes:

- allowlist-based repo activation
- repo-scoped raw experience storage
- compiled memory generation with fuzzy claim merging and conflict detection
- confidence decay for aging experiences
- runtime retrieval by repo, path, and task with task type normalization
- org-level cross-repo rule compilation
- auto-init for new allowlisted repos
- auto-compile after capture
- auto-capture from git history (`--auto` mode)
- post-merge sync for affected repos only
- experience lifecycle management (deprecation)
- first-class Claude Code and Codex integration

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

Install does the following:

1. Links the two Codex skills into `~/.codex/skills/`
2. Installs Claude Code commands into `~/.claude/commands/` (if Claude Code is detected)
3. Installs a stable command entrypoint at `~/.monkeys-memory/bin/monkeys-memory`
4. Runs an initial compile
5. Configures a `post-merge` hook for pull-triggered sync

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

The fastest way to set up a repo:

```bash
monkeys-memory init-repo --workspace /path/to/your-repo
```

This does four things in one command:

1. Adds the repo to the allowlist
2. Installs a `post-commit` hook for automatic experience capture
3. Creates a `CLAUDE.md` in the target repo so Claude Code auto-retrieves memory
4. Runs an initial compile

Options:

- `--no-hooks` — skip the post-commit hook
- `--no-claude` — skip CLAUDE.md creation

### Manual setup

Alternatively, edit the allowlist file directly:

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

## Commands

```bash
# Core workflow
monkeys-memory compile [--repo <repo>]
monkeys-memory retrieve [--workspace <dir>] [--repo <repo>] [--path <path>] [--task <task>] [--format json|md]
monkeys-memory capture --title <title> --claim <claim> [--workspace <dir>] [--repo <repo>] [--path <path>] [--task <task>] [--kind rule|exception]
monkeys-memory capture --auto [--workspace <dir>]
monkeys-memory sync [--no-pull] [--from-ref <ref>] [--to-ref <ref>]

# Management
monkeys-memory status [--repo <repo>]
monkeys-memory list --repo <repo> [--status active|deprecated] [--kind rule|exception] [--path <glob>] [--format json|table]
monkeys-memory init-repo --workspace <path> [--no-hooks] [--no-claude]
monkeys-memory deprecate --repo <repo> --id <experience-id>
```

Or via npm:

```bash
npm run compile
npm run retrieve -- --workspace /path/to/repo --task bugfix
npm run capture -- --workspace /path/to/repo --task bugfix --title "..." --claim "..."
npm run capture -- --auto --workspace /path/to/repo
npm run sync
npm run status
npm run list -- --repo sample-app
npm run deprecate -- --repo sample-app --id exp_2026_03_24_001
npm test
```

## Configuration

`memory.config.json` supports the following options:

| Key | Default | Description |
| --- | --- | --- |
| `org` | `"default-org"` | Organization name |
| `memoryRoot` | `".monkeys-memory"` | Path to memory data directory |
| `onboardingRuleLimit` | `10` | Max rules in onboarding digest |
| `runtimeRuleLimit` | `5` | Max rules returned at runtime |
| `fuzzyMergeThreshold` | `0.7` | Jaccard similarity threshold for merging similar claims (1.0 = disabled) |
| `confidenceDecayStartDays` | `90` | Days before confidence starts decaying |
| `confidenceDecayRatePerMonth` | `0.02` | Confidence reduction per month after decay starts |
| `confidenceDecayMax` | `0.2` | Maximum total confidence reduction from decay |

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

## Key Features

### Fuzzy Claim Merging

When multiple team members capture similar insights with different wording, the compiler merges them using token-level Jaccard similarity. This prevents duplicate rules while preserving unique perspectives. Configure the threshold in `memory.config.json`.

### Confidence Decay

Old experiences gradually lose confidence over time, ensuring that the most recent team knowledge carries more weight. Experiences keep full confidence for 90 days by default, then slowly decay.

### Conflict Detection

When two rules with overlapping scope contain contradictory claims (e.g., "always do X" vs "never do X"), the compiler annotates them with `conflicts_with` references so the AI agent can make informed decisions.

### Auto Capture

Use `capture --auto` to automatically extract experience from the last git commit. It infers title, claim, paths, and task type from the commit message and diff. Auto-captured experiences have lower default confidence (0.5) than manual captures (0.7).

### Org-Level Rules

When the same claim appears in rules compiled from 2+ different repos, the compiler promotes it to an org-level rule. These rules are stored in `.monkeys-memory/org/compiled/org-rules.json` and are included in retrieval results at a lower weight than repo-specific rules. This surfaces cross-repo patterns that individual developers may not be aware of.

### Experience Lifecycle

Mark outdated experiences as deprecated with the `deprecate` command. Deprecated experiences are excluded from future compilations but preserved for historical reference.

## Support Matrix

| Capability | Availability | Notes |
| --- | --- | --- |
| Codex skills | Yes | `install.sh` links `org-memory-use` and `org-memory-capture` into `~/.codex/skills/` |
| Claude Code integration | Yes | `install.sh` installs commands into `~/.claude/commands/` and provides `CLAUDE.md` |
| Allowlist-based activation | Yes | Only approved repos get memory behavior |
| Auto-init for new repos | Yes | Adding a repo to the allowlist is enough |
| Repo-managed compile | Yes | `compile` and `capture` run directly from the memory repo CLI |
| Pull-triggered selective compile | Yes | `post-merge` runs `sync` and recompiles affected repos only |
| Fuzzy claim merging | Yes | Configurable Jaccard threshold |
| Conflict detection | Yes | Annotates contradictory rules |
| Confidence decay | Yes | Configurable decay curve |
| Auto capture | Yes | `capture --auto` extracts from git history |
| Experience deprecation | Yes | `deprecate` command + filtered during compile |
| Central online compiler | Not included | This release works without a hosted control plane |

## Project Layout

```text
monkeys-memory/
  CLAUDE.md
  examples/
  schemas/
  scripts/
  skills/
  templates/
  tests/

Local private data created after install:
  .monkeys-memory/
```

## Troubleshooting

**Retrieve returns no rules**
- Check `monkeys-memory status` to see if the repo is allowlisted and compiled
- Run `monkeys-memory compile` to regenerate compiled outputs
- Verify your experience files are valid JSON with `monkeys-memory list --repo <repo>`

**Compilation fails**
- Check for corrupted JSON files in `.monkeys-memory/repos/<repo>/experiences/`
- Corrupted files are skipped with a warning; look for `[monkeys-memory] warning:` in stderr
- Verify `memory.config.json` has valid values (invalid values are auto-clamped)

**Conflicts detected**
- Run `monkeys-memory retrieve` and look for `Conflicts with:` annotations
- Review the conflicting rules and consider deprecating one: `monkeys-memory deprecate --repo <repo> --id <id>`
- Conflicts often indicate a rule that should be an exception instead

**Auto capture produces low-quality insights**
- Auto-captured experiences have 0.5 confidence (vs 0.7 for manual)
- Review auto-captured items with `monkeys-memory list --repo <repo>` and deprecate unhelpful ones
- Prefer manual capture for nuanced insights

**All commands support `--help`**
- Run any command with `--help` or `-h` for usage info

## Future Directions

- fully automatic experience extraction from real sessions
- hosted compile/control plane
- effect measurement across a real team
- vector-based semantic retrieval for larger knowledge bases

## Internal Notes

Internal architecture and roadmap notes are kept outside the open-source surface.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for development expectations and public repo boundaries.

## License

[MIT](LICENSE)
