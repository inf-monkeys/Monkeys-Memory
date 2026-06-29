# Monkeys Memory

Open-source Monkeys Memory is a database-backed product for coding-agent memory.

## Development

- Node 22+ required
- `npm run api:build` to compile the API
- `npm run api:test` to run API tests
- `npm run compose:config` to validate Docker Compose
- `npm run dev:docker` to run the full local product

## Architecture

- `apps/api/`: Fastify + TypeScript API, workers, TypeORM migrations
- `apps/console/`: lightweight static console served by Nginx
- `compose.yaml`: PostgreSQL, Redis, API, and console
