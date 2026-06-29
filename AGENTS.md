# Repository Guidelines

## Product Boundary

This repository is the open-source Monkeys Memory product. It includes the
database-backed API, workers, lightweight console, and Docker Compose
deployment. It must remain useful without a hosted Monkeys Memory account.

Keep the open-source product distinct from the commercial SaaS distribution:

- OSS product behavior belongs here.
- Hosted operations, billing, production-only admin flows, proprietary SaaS UI,
  private deployment details, and customer data stay out of this repository.
- The SaaS frontend is not the OSS console. The OSS UI should stay lightweight,
  practical, and free of hosted-product hardcoding.

## Project Structure & Module Organization

- `apps/api/`: open-source database-backed API, workers, TypeORM migrations, and
  Dockerfile.
- `apps/console/`: lightweight static web UI for local administration and CLI
  authorization.
- `compose.yaml`: one-command local deployment with PostgreSQL, Redis, API,
  workers, and console.

Private runtime memory, database volumes, secrets, and tokens must stay
gitignored.

## Build, Test, and Install Commands

Use Node.js 22+.

- `docker compose up --build`: run PostgreSQL, Redis, API, workers, and console.
- `npm run dev:docker`: same as above through npm.
- `npm --prefix apps/api install`: install API dependencies.
- `npm run api:build`: compile the API.
- `npm run api:test`: run API tests.
- `npm test`: run the default test suite.
- `npm run compose:config`: validate Compose configuration.
- `cd apps/api && npm run migration:run`: apply local migrations.

## Coding Style & Constraints

Follow the style of the area being edited:

- `apps/api/`: strict TypeScript, ES modules, 2-space indentation, kebab-case
  files, thin controllers, service logic in services/shared modules.
- `apps/console/`: simple static HTML/CSS/JS unless a heavier frontend stack
  becomes necessary for a real user workflow.

Prefer the simplest deployable local path. Do not introduce SaaS-only
dependencies when a local PostgreSQL/Redis/API/console deployment can solve the
problem directly. If a concept exists in both OSS and the SaaS distribution,
update the OSS implementation deliberately instead of copying hosted-only UI or
operations code wholesale.

## Security

Do not commit local memory data, database dumps, secrets, tokens, customer data,
OAuth credentials, production domain details, or environment-specific paths.
Local Docker defaults may use development credentials only when clearly scoped
to local quickstart flows.
