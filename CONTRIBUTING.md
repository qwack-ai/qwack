# Contributing to Qwack

Thanks for your interest in contributing to Qwack! 🦆

## Prerequisites

- [Bun](https://bun.sh) v1+
- Git

## Setup

```bash
git clone https://github.com/qwack-ai/qwack.git
cd qwack
bun install
```

## Project Structure

```
packages/
├── opencode/           # TUI (fork of OpenCode with native collaboration)
├── qwack-server/       # Collaboration relay server (Hono + WebSocket)
├── qwack-plugin/       # OpenCode plugin (agent-awareness hooks)
├── qwack-shared/       # Shared types, schemas, Yjs CRDT
├── qwack-web/          # Landing page (SolidJS)
├── qwack-sdk/          # Client SDK
└── docs/               # Documentation site (Astro/Starlight)
```

## Running Locally

```bash
# Start the server (SQLite, no AWS needed)
bun run src/index.ts --cwd packages/qwack-server

# Run the TUI
bun run bin/opencode --cwd packages/opencode
```

## Tests

```bash
# Server tests
QWACK_DEV=true bun test --cwd packages/qwack-server

# Plugin tests
bun test --cwd packages/qwack-plugin

# Shared tests
bun test --cwd packages/qwack-shared
```

## Building Binaries

```bash
OPENCODE_VERSION=0.1.0-alpha bun run script/build.ts --cwd packages/opencode
# Outputs to packages/opencode/dist/
```

## Building Static Sites

```bash
# Landing page
bun run build --cwd packages/qwack-web

# Docs
bun run build --cwd packages/docs
```

## Pull Requests

- Fork the repo and create a branch from `main`
- Add tests for new functionality
- Make sure all existing tests pass
- Keep PRs focused — one feature or fix per PR

## Code Style

- TypeScript, no `any`
- Bun runtime, not Node.js
- Hono for HTTP, Drizzle for SQLite, `@aws-sdk/lib-dynamodb` for DynamoDB
- Co-locate tests: `foo.ts` → `foo.test.ts`
- Comments above variables, not inline

## License

By contributing, you agree that your contributions will be licensed under the project's existing licenses (MIT for TUI/plugin/SDK, AGPL-3.0 for server).
