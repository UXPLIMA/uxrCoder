# Contributing to uxrCoder

Thanks for contributing.

This project prioritizes deterministic sync behavior, agent safety, and reproducible debugging.

## 1. Development Setup

Prerequisites:
- Node.js `18+`
- npm `9+`
- Roblox Studio
- VS Code

Install:

```bash
npm run setup
```

Run:

```bash
npm run dev
```

## 2. Branch and PR Flow

1. Create branch from `main`.
2. Implement scoped changes.
3. Run validation commands.
4. Update docs/changelog when behavior changes.
5. Open PR with clear testing notes.

## 3. Validation Commands

Required before PR:

```bash
npm --prefix server run lint
npm --prefix server test -- --run
npm --prefix server run build
npm --prefix vscode-extension run lint
npm run build
```

Recommended:

```bash
npm --prefix server run profile:large-tree
```

## 4. Coding Guidelines

### TypeScript
- Keep strict typing.
- Prefer pure helpers for critical sync logic.
- Return explicit conflict objects for recoverable failures.
- Add concise comments only where logic is non-obvious.

### Lua (Plugin)
- Keep mutation paths guarded (`pcall`, rollback-aware behavior).
- Avoid silent failures in test/event flows.
- Preserve deterministic naming and path semantics.

## 5. Docs Requirements

If your change affects behavior, update relevant docs:
- `README.md` / `README.tr.md`
- `docs/USAGE.md`
- `docs/AGENT_API.md`
- `docs/agent-test-harness.md`
- `CHANGELOG.md`

## 6. Commit Style

Use Conventional Commits:
- `feat:`
- `fix:`
- `docs:`
- `refactor:`
- `test:`
- `chore:`

Examples:
- `feat(server): add visual baseline assertion for screenshot artifacts`
- `fix(plugin): include attempt metadata in test events`

## 7. Bug Reports

Include:
- reproducible steps
- expected vs actual behavior
- environment (OS, Node, Studio version)
- logs and, if possible, exported debug bundle (`/agent/debug/export`)

## 8. Security

Please follow `SECURITY.md` for vulnerability reporting.
