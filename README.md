# Monkeys Memory

[简体中文](README.zh-CN.md) | English

Monkeys Memory gives coding agents a shared memory for a codebase.

Run it next to the repositories you work on. Agents can capture lessons from
real changes, compile them into reusable rules, and retrieve the few that matter
before the next task. The point is simple: when a team has already learned
something about a codebase, the next agent session should not have to learn it
from scratch.

This repository contains the complete open-source product: a Fastify API,
background workers, PostgreSQL, Redis, a small web console, and Docker Compose.
It starts with a local owner workspace, so you can try the full flow without
setting up users first.

## What's Included

- Database-backed memory capture, retrieval, review, feedback, policy, audit
  logs, and agent actions
- Workers for compilation, audit processing, and consistency jobs
- A small console for managing local organizations and repositories, plus quick
  capture/retrieve checks
- Deterministic local embeddings by default, with external embedding providers
  available through configuration
- One-command Docker Compose setup for PostgreSQL, Redis, API, workers, and
  console
- A CLI-compatible API for the open-source `monkeys-memory` command

## Quickstart

You need Docker and Docker Compose.

Start everything:

```bash
git clone https://github.com/inf-monkeys/Monkeys-Memory.git
cd Monkeys-Memory
docker compose up --build
```

Open the console:

```text
http://localhost:8080
```

The API is available at:

```text
http://localhost:3000
```

Use the console to create or select a local organization, add a repository, and
try capture/retrieve. The default setup is meant for local use and ships with
development credentials only.

## CLI Setup

The Monkeys Memory CLI is open source too:
[Ruiruiz30/Monkeys-Memory-Cli](https://github.com/Ruiruiz30/Monkeys-Memory-Cli).
It is the command-line entry point agents use for repository scanning,
agent-friendly JSON commands, and official agent skill installation.

Install it, point it at your local API, and use a local placeholder token:

```bash
npm install -g @inf-monkeys-tech/monkeys-memory-cli
monkeys-memory config set api-url http://localhost:3000
export MONKEYS_MEMORY_TOKEN=local
monkeys-memory retrieve --repo my-repo --path src/index.ts --task feature
monkeys-memory capture --repo my-repo --title "Adapter rule" --claim "Always validate through the adapter." --path "src/adapter/**" --task feature
monkeys-memory memory-evaluate --repo my-repo --rule-id rule_1 --outcome outdated --adopted false --correct-claim "Use the new adapter boundary." --correct-path "src/adapter/**"
```

In local mode, API requests are mapped to the local owner workspace. You do not
need a browser setup flow or a cloud token.

When an agent reports a retrieved memory item as `outdated` or `failed`, the
local API retires the old source memory from runtime retrieval. If the report
includes a correction, Monkeys Memory captures the corrected memory and marks
the old source as superseded.

## Project Layout

```text
apps/
  api/       Fastify + TypeScript API, TypeORM migrations, and workers
  console/   Lightweight static console served by Nginx
compose.yaml One-command local deployment with PostgreSQL, Redis, API, and console
```

Services started by Compose:

- `postgres`: PostgreSQL 16
- `redis`: Redis 7
- `api`: Monkeys Memory API, migrations, compile worker, audit worker
- `console`: static console plus same-origin proxy to `/api` and `/health`

## Configuration

The API reads its config from:

```text
apps/api/config.yaml.example
```

The Compose file mounts this example as `/etc/monkeys-memory/config.yaml` and
overrides Docker connection values with environment variables.

For a real deployment, copy the example to your own config file and adjust
database, Redis, CORS, and embedding settings for your environment.

Defaults worth knowing:

- `deployment.mode: local`
- `embeddings.provider: local-hash`
- `database.name: monkeys_memory`

Use HTTPS, private network controls, and non-default database credentials before
exposing a deployment beyond localhost.

## Development

Use Node.js 22+.

```bash
npm run api:build
npm run api:test
npm test
npm run compose:config
```

Useful commands:

- `npm run dev:docker`: run the full product with Docker Compose
- `npm run api:build`: compile the API
- `npm run api:test`: run API tests
- `npm test`: run the default test suite
- `npm run compose:config`: validate Compose configuration

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) or
[CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md) before opening a pull request.

## Security

Do not commit local memory data, database volumes, tokens, customer data, or
real secrets. The Docker quickstart credentials are only for local development.
See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## License

[MIT](LICENSE)
