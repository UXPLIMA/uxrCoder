# Agent API Reference

Base URL (default): `http://127.0.0.1:34872`

This reference focuses on endpoints intended for AI agents and automation clients.

## Conventions

- Content-Type: `application/json`
- Idempotency key (optional): header `x-idempotency-key`
- Optimistic concurrency (optional): body field `baseRevision`

Conflict reasons:
- `not_found`
- `locked`
- `revision_mismatch`
- `validation_failed`

## 1. Snapshot and Schema

### `GET /agent/snapshot`
Returns deterministic indexed view of the current DataModel.

Response shape:
- `revision`
- `generatedAt`
- `instances[]` with `{ id, className, name, path, parentId, childIds, properties }`

### `GET /agent/schema/properties`
Returns class/property metadata derived from current snapshot values.

Query:
- `className` (optional)

Response shape:
- `schemaVersion`
- `generatedAt`
- `revision`
- `classes[]` and `properties[]` with writable/type constraints

## 2. Command Execution

### `POST /agent/command`
Execute one command.

### `POST /agent/commands`
Execute command list in order.

#### Supported operations

`create`
```json
{
  "baseRevision": 10,
  "command": {
    "op": "create",
    "parentId": "abc123",
    "className": "Folder",
    "name": "Gameplay",
    "properties": { "Name": "Gameplay" }
  }
}
```

`update`
```json
{
  "command": {
    "op": "update",
    "targetPath": ["Workspace", "Part"],
    "property": "Transparency",
    "value": 0.25
  }
}
```

`rename`
```json
{
  "command": {
    "op": "rename",
    "targetId": "abc123",
    "name": "Gameplay_2"
  }
}
```

`delete`
```json
{
  "command": {
    "op": "delete",
    "targetId": "abc123"
  }
}
```

`reparent`
```json
{
  "command": {
    "op": "reparent",
    "targetId": "abc123",
    "newParentPath": ["ReplicatedStorage"]
  }
}
```

Notes:
- For target and parent refs, `id` and `path` variants are supported.
- Batch endpoint may rollback on configured transactional failure behavior.

## 3. Test Runs

### `POST /agent/tests/run`
Starts an autonomous test run.

Body:
```json
{
  "scenario": {
    "name": "spawn regression",
    "steps": [
      { "type": "assertExists", "path": ["Workspace", "SpawnLocation"] }
    ]
  }
}
```

### `GET /agent/tests`
List recent runs.

### `GET /agent/tests/:id`
Get one run.

### `POST /agent/tests/:id/abort`
Abort queued/running run.

### `GET /agent/tests/:id/report`
Read persisted report.

### `GET /agent/tests/:id/artifacts`
List persisted artifact files.

### `POST /agent/tests/events`
Plugin-side event ingress (internal pathway).

Common events:
- `started`
- `log`
- `artifact`
- `passed`
- `failed`
- `aborted`
- `error`

Attempt hardening:
- event payload can include `attempt`
- stale attempts are ignored/rejected server-side

## 4. Metrics, Locks, and Debug

### `GET /agent/tests/metrics`
Queue/runtime/latency summary.

Query:
- `limit` (optional)

### `GET /agent/locks`
Active lock diagnostics and contention samples.

Query:
- `limit` (optional)
- `includeLocks` (`true`/`false`)

### `POST /agent/debug/export`
Exports reproducible bundle (`snapshot`, `schema`, `metrics`, `locks`).

Body options:
- `persist` (default `true`)
- `includeBundle` (default `true`)
- `includeLocks` (default `true`)
- `includeSchema` (default `true`)
- `limit` (default `100`)
- `label` (optional)

### `GET /agent/debug/profile`
Profiles key operations.

Query options:
- `iterations` (default `3`, max `20`)
- `sampleSize` (default `1000`, max `50000`)
- `includeSchema` (default `true`)
- `includeRaw` (default `false`)
- `useCache` (default `false`)

## 5. Legacy/General Sync Endpoints

Still used by plugin/editor bridge:
- `GET /health`
- `POST /sync`
- `POST /sync/delta`
- `GET /changes`
- `POST /changes/confirm`

Additional utility endpoints:
- `POST /build/:format`
- `POST /build/rbxmx`
- `POST /sourcemap/regenerate`
