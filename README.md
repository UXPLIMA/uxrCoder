<p align="right">
  <a href="./README.md"><strong>English</strong></a> | <a href="./README.tr.md">Türkçe</a>
</p>

<h1 align="center">uxrCoder</h1>

<p align="center">
  Production-ready Roblox Studio ↔ VS Code/AI sync platform with deterministic state control,
  agent command APIs, autonomous playtesting, and reproducible debug tooling.
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-18%2B-green" alt="Node.js"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.3-blue" alt="TypeScript"></a>
  <img src="https://img.shields.io/badge/Release-v1.1.0-orange" alt="Release v1.1.0">
</p>

## What uxrCoder Solves

uxrCoder keeps Roblox Studio, your local filesystem, VS Code, and AI agents in sync as one deterministic project state.

It is designed for:
- daily script/property iteration in VS Code,
- reliable Explorer-like operations from AI agents,
- autonomous test loops with artifacts,
- reproducible debugging when conflicts happen.

## Key Capabilities

### 1) Deterministic Two-Way Sync
- Studio plugin to server sync (`/sync`, `/sync/delta`).
- Editor/server to plugin pending change queue (`/changes`, `/changes/confirm`).
- Collision-safe sibling naming (`Folder`, `Folder_2`, `Folder_3`, ...).
- Reparent/rename consistency with stable `id -> path` indexing.

### 2) Agent Control Plane
- Capabilities bootstrap API: `GET /agent/capabilities`.
- Snapshot API: `GET /agent/snapshot`.
- Property schema API: `GET /agent/schema/properties`.
- Command APIs: `POST /agent/command`, `POST /agent/commands`.
- Locking, revision checks, idempotency cache, conflict payloads.
- Validation-first property updates before plugin queueing.

### 3) Autonomous Playtesting
- Test orchestration endpoints (`/agent/tests/*`).
- Plugin-side step runner for assertions and mutations.
- Harness integrations (`BindableFunction`, `BindableEvent`, `ModuleScript`).
- Isolation cleanup (created/destroyed/property rollback best-effort).
- Visual artifacts and optional screenshot baseline assertion/record workflow.

### 4) Debugging and Observability
- Metrics endpoint: `GET /agent/tests/metrics`.
- Lock diagnostics: `GET /agent/locks`.
- Repro bundle export: `POST /agent/debug/export`.
- Hotspot profiling: `GET /agent/debug/profile`.
- Synthetic large-tree profiling script (`100k+` instances).

### 5) Developer Tooling
- VS Code Roblox Explorer + Property Editor + Class Browser.
- Build/export endpoints for `.rbxlx` and `.rbxmx`.
- Sourcemap regeneration endpoint for Luau tooling.

## Quick Start

1. Install dependencies
```bash
npm run setup
```

2. Start the sync server
```bash
npm run dev
```

3. Install Roblox plugin
- Copy `plugin/RobloxSyncPlugin.lua` into your Roblox local plugins folder.

4. Run VS Code extension host
- Open `vscode-extension/` in VS Code and press `F5`.

5. Verify health
```bash
curl http://127.0.0.1:34872/health
```

## AI Agent Onboarding (Fastest Path)

1. Generate `AGENTS.md` for your game root:
```bash
npm run agent:init -- --project /path/to/MyGame --force
```

2. In your AI chat, start with:
```text
Read AGENTS.md and execute exactly that workflow.
```

Notes:
- The template starts with `GET /agent/bootstrap` for one-shot discovery.
- The template requires `GET /agent/schema/commands` to avoid trial-and-error payload probing.
- This removes guesswork around `path` format and test response fields.

## Documentation

- Installation: `docs/INSTALLATION.md`
- Usage and workflows: `docs/USAGE.md`
- Configuration reference: `docs/CONFIGURATION.md`
- Architecture: `docs/ARCHITECTURE.md`
- Agent API reference: `docs/AGENT_API.md`
- AI quickstart (EN): `docs/AI_QUICKSTART.md`
- AI quickstart (TR): `docs/AI_QUICKSTART.tr.md`
- AGENTS template: `docs/AGENTS_TEMPLATE.md`
- Agent test harness guide: `docs/agent-test-harness.md`
- End-to-end tutorial (EN): `docs/TUTORIAL.md`
- End-to-end tutorial (TR): `docs/TUTORIAL.tr.md`
- Release checklist: `docs/RELEASE_CHECKLIST.md`

## Release Status

This repository is prepared for `v1.1.0` release:
- server tests passing,
- server + extension build passing,
- updated release docs and multilingual README,
- roadmap updated for release completion.

## Contributing and Security

- Contribution guide: `CONTRIBUTING.md`
- Security policy: `SECURITY.md`
- Changelog: `CHANGELOG.md`
- Roadmap: `ROADMAP.md`

## License

MIT License. See `LICENSE`.
