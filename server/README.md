# uxrCoder Server

Node.js backend that coordinates Roblox Studio plugin sync, VS Code extension updates, and automation APIs.

## Responsibilities

- Canonical in-memory DataModel state (`SyncEngine`)
- HTTP sync bridge for plugin communication
- WebSocket gateway for extension clients
- Filesystem projection and watch-loop control
- Automation command execution with lock/revision/idempotency safety
- Autonomous test orchestration with reports and artifacts
- Debug export and profiling endpoints

## Development

Install and run:

```bash
npm install
npm run dev
```

Build and start:

```bash
npm run build
npm start
```

Test:

```bash
npm test
```

## Endpoint Surface

### Sync Bridge
- `GET /health`
- `POST /sync`
- `POST /sync/delta`
- `GET /changes`
- `POST /changes/confirm`

### Automation and Discovery
- `GET /agent/bootstrap`
- `GET /agent/capabilities`
- `GET /agent/snapshot`
- `GET /agent/schema/properties`
- `GET /agent/schema/commands`
- `POST /agent/command`
- `POST /agent/commands`

### Test Orchestration
- `POST /agent/tests/run`
- `GET /agent/tests`
- `GET /agent/tests/:id`
- `POST /agent/tests/:id/abort`
- `POST /agent/tests/events`
- `GET /agent/tests/:id/report`
- `GET /agent/tests/:id/artifacts`
- `GET /agent/tests/metrics`

### Diagnostics
- `GET /agent/locks`
- `POST /agent/debug/export`
- `GET /agent/debug/profile`

### Build and Utility
- `POST /build/:format`
- `POST /build/rbxmx`
- `POST /sourcemap/regenerate`

## Environment Variables

- `PORT` (default `34872`)
- `HOST` (default `0.0.0.0`)
- `SYNC_INTERVAL` (default `100`)
- `WORKSPACE_PATH` (default `./workspace`)

## Performance Utility

```bash
npm run profile:large-tree
```

Optional knobs:
- `FOLDER_COUNT`
- `PARTS_PER_FOLDER`
- `ITERATIONS`
- `LOOKUP_SAMPLE`
- `PROFILE_OUT`

## Related Docs

- `../README.md`
- `../docs/AGENT_API.md`
- `../docs/ARCHITECTURE.md`
- `../docs/agent-test-harness.md`
