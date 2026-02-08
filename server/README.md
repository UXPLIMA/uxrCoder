# uxrCoder Server

Node.js backend for Roblox Studio, VS Code extension, and AI agent orchestration.

## Responsibilities

- In-memory canonical DataModel state (`SyncEngine`)
- HTTP APIs for plugin sync and agent operations
- WebSocket broadcast channel for editor clients
- Filesystem projection and watcher integration
- Autonomous test queue and artifact persistence
- Debug/profile/export tooling for reproducible triage

## Run

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
npm start
```

Tests:

```bash
npm test
```

## Core Endpoints

Sync bridge:
- `GET /health`
- `POST /sync`
- `POST /sync/delta`
- `GET /changes`
- `POST /changes/confirm`

Agent plane:
- `GET /agent/snapshot`
- `GET /agent/schema/properties`
- `POST /agent/command`
- `POST /agent/commands`

Autonomous tests:
- `POST /agent/tests/run`
- `GET /agent/tests`
- `GET /agent/tests/:id`
- `POST /agent/tests/:id/abort`
- `POST /agent/tests/events`
- `GET /agent/tests/:id/report`
- `GET /agent/tests/:id/artifacts`
- `GET /agent/tests/metrics`

Observability:
- `GET /agent/locks`
- `POST /agent/debug/export`
- `GET /agent/debug/profile`

Build/export:
- `POST /build/:format`
- `POST /build/rbxmx`
- `POST /sourcemap/regenerate`

## Environment Variables

- `PORT` (default `34872`)
- `HOST` (default `0.0.0.0`)
- `SYNC_INTERVAL` (default `100`)
- `WORKSPACE_PATH` (default `./workspace`)

## Performance Utilities

Large-tree synthetic profile:

```bash
npm run profile:large-tree
```

Optional env knobs:
- `FOLDER_COUNT`
- `PARTS_PER_FOLDER`
- `ITERATIONS`
- `LOOKUP_SAMPLE`
- `PROFILE_OUT`

## Related Docs

- `../docs/ARCHITECTURE.md`
- `../docs/AGENT_API.md`
- `../docs/agent-test-harness.md`
