# Security Policy

Monkeys Memory handles developer knowledge that may contain sensitive project
context. Please report security issues privately.

## Supported Versions

The `main` branch is the active open-source development line. Security fixes are
made there first unless maintainers explicitly announce release branches.

## Reporting a Vulnerability

Do not open a public issue with exploit details, secrets, tokens, private memory
data, or customer information.

Please contact the maintainers through a private channel and include:

- Affected version or commit.
- Clear reproduction steps.
- Impact and affected component.
- Safe proof-of-concept details that do not expose private data.

We will acknowledge the report, investigate, and coordinate disclosure once a
fix is available.

## Handling Sensitive Data

- Do not commit runtime data, database dumps, API tokens, OAuth credentials, or
  real customer/team memory.
- Replace Docker quickstart secrets before exposing the API beyond private local
  development.
