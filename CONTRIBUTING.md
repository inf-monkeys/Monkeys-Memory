# Contributing to Monkeys Memory

[简体中文](CONTRIBUTING.zh-CN.md) | English

Thanks for helping build Monkeys Memory. This project is open source,
privacy-sensitive developer infrastructure, so the bar for clarity, tests, and
safe examples is intentionally high.

## Product Principles

- Keep Monkeys Memory usable as a complete open-source product.
- Prefer simple, direct designs over speculative abstractions.
- Keep the lightweight console practical and local-first.
- Keep SaaS-only operations, billing, customer data, proprietary UI, and private
  deployment details out of this repository.
- Never commit real team memory, customer data, or secrets.

## Development Setup

Use Node.js 22+.

```bash
npm --prefix apps/api install
npm run api:build
npm run api:test
npm run compose:config
```

For the full product:

```bash
npm run dev:docker
```

## Pull Request Checklist

- Explain the user-visible change and why it belongs in the open-source
  product.
- Include tests for behavior changes.
- Run the relevant validation commands and list them in the PR.
- Update `README.md`, `README.zh-CN.md`, API docs, console docs, or deployment
  docs when behavior changes.
- Call out migration, configuration, compatibility, or security impact.
- Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) in project discussions.

## Testing Expectations

Choose the smallest validation set that proves the change:

- API or database changes: `npm run api:build` and `npm run api:test`
- Docker or config changes: `npm run compose:config`
- Console JavaScript changes: `node --check apps/console/app.js`

Run broader checks when a change crosses boundaries.

## Public Repo Boundaries

Do not commit:

- private memory data
- database dumps or local volumes
- OAuth credentials, tokens, API keys, or real secrets
- customer data or production domain details
- private operational docs

## Code Style

- Follow the style of the files you edit.
- Keep controllers thin and put API behavior in services/shared modules.
- Keep the console static and lightweight unless a real workflow requires a
  heavier frontend stack.
- Add comments only when they clarify non-obvious behavior.
- Avoid unrelated refactors in feature or bugfix pull requests.

## Security Reports

Do not open public issues with secrets or exploit details. Report sensitive
security issues through a private maintainer channel; see
[SECURITY.md](SECURITY.md).
