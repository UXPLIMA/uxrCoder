<p align="right">
  <a href="./README.md"><strong>English</strong></a> | <a href="./README.tr.md">Türkçe</a>
</p>

<h1 align="center">uxrCoder</h1>

<p align="center">
  Deterministic Roblox Studio ↔ VS Code development platform with live sync,
  schema-aware editing, automation APIs, and reproducible testing workflows.
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-18%2B-green" alt="Node.js"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.3-blue" alt="TypeScript"></a>
  <img src="https://img.shields.io/badge/Release-v1.1.0-orange" alt="Release v1.1.0">
</p>

## Overview

`uxrCoder` keeps Roblox Studio state, local files, and VS Code tooling aligned as a single source of truth.

It is designed for teams that need:
- predictable two-way sync between Studio and local source files,
- safe object/property operations through APIs,
- automated test execution with stored reports and artifacts,
- reproducible diagnostics when runtime behavior diverges.

## Why Teams Use uxrCoder

- Deterministic conflict handling for rename/reparent collisions.
- Stable object targeting with `id`, `path`, and revision-based workflows.
- Property validation before mutation (schema-aware writes).
- Automation-ready API surface for scripted tools and assistants.
- Test orchestration with queueing, retry policy, isolation cleanup, and artifact collection.
- Debug bundle export and profile endpoints for regression triage.

## Core Capabilities

### 1. Live Sync Plane
- Plugin → server sync: `POST /sync`, `POST /sync/delta`
- Server/editor → plugin change queue: `GET /changes`, `POST /changes/confirm`
- File projection + filesystem watcher loop protection
- Deterministic sibling naming and stable `id -> path` resolution

### 2. Automation and Control Plane
- Bootstrap and discovery: `GET /agent/bootstrap`, `GET /agent/capabilities`
- State and schema: `GET /agent/snapshot`, `GET /agent/schema/properties`, `GET /agent/schema/commands`
- Mutations: `POST /agent/command`, `POST /agent/commands`
- Concurrency and safety: lock manager, idempotency keys, base revision checks, structured conflict payloads

### 3. Autonomous Testing Plane
- Scenario execution: `POST /agent/tests/run`
- Run lifecycle: `GET /agent/tests`, `GET /agent/tests/:id`, `POST /agent/tests/:id/abort`
- Event ingestion and persistence: `POST /agent/tests/events`
- Reports and artifacts: `GET /agent/tests/:id/report`, `GET /agent/tests/:id/artifacts`
- Screenshot baseline modes: `assert`, `record`, `assert_or_record`

### 4. Observability and Debugging
- Queue/runtime metrics: `GET /agent/tests/metrics`
- Lock diagnostics: `GET /agent/locks`
- Repro bundle export: `POST /agent/debug/export`
- Hotspot profiling: `GET /agent/debug/profile`

### 5. VS Code Extension Workflow
- Explorer tree, property editor, class browser
- Insert/rename/delete/reparent-friendly editing actions
- Script open/edit flow for mapped Lua files
- Runtime/build commands and sourcemap regeneration

## Quick Start

1. Install dependencies
```bash
npm run setup
```

2. Start the server
```bash
npm run dev
```

3. Install Roblox plugin
- Copy `plugin/RobloxSyncPlugin.lua` into your local Roblox plugin directory.

4. Run VS Code extension host
- Open `vscode-extension/` in VS Code and press `F5`.

5. Verify health
```bash
curl http://127.0.0.1:34872/health
```

## Assistant-Friendly Onboarding

Generate an `AGENTS.md` file for your game workspace:

```bash
npm run agent:init -- --project /path/to/MyGame --force
```

Then start with:

```text
Read AGENTS.md and implement <feature>, then run tests and report run ID + final status.
```

## Documentation

- Turkish README: `README.tr.md`
- Documentation index (EN): `docs/README.md`
- Documentation index (TR): `docs/README.tr.md`
- Installation: `docs/INSTALLATION.md`
- Usage workflows: `docs/USAGE.md`
- Configuration reference: `docs/CONFIGURATION.md`
- Architecture: `docs/ARCHITECTURE.md`
- API reference: `docs/AGENT_API.md`
- Assistant quickstart (EN): `docs/AI_QUICKSTART.md`
- Assistant quickstart (TR): `docs/AI_QUICKSTART.tr.md`
- AGENTS template: `docs/AGENTS_TEMPLATE.md`
- Test harness guide: `docs/agent-test-harness.md`
- End-to-end tutorial (EN): `docs/TUTORIAL.md`
- End-to-end tutorial (TR): `docs/TUTORIAL.tr.md`
- Release checklist: `docs/RELEASE_CHECKLIST.md`

## Project Status

Current release line: `v1.1.0`.

This repository currently includes:
- production-ready sync path for Studio ↔ filesystem ↔ extension,
- automation API set with schema and conflict contracts,
- autonomous test orchestration and artifact persistence,
- diagnostics endpoints and release documentation.

## Contributing and Security

- Contribution guide: `CONTRIBUTING.md`
- Security policy: `SECURITY.md`
- Changelog: `CHANGELOG.md`
- Roadmap: `ROADMAP.md`

## License

MIT. See `LICENSE`.
