# Agent API Reference

Base URL (default): `http://127.0.0.1:34872`

This reference focuses on endpoints intended for AI agents and automation clients.

## Conventions

- Content-Type: `application/json`
- Idempotency key (optional): header `x-idempotency-key`
- Optimistic concurrency (optional): body field `baseRevision`

Recommended call order for generic agents:
1. `GET /health`
2. `GET /agent/bootstrap`
3. `GET /agent/schema/commands`
4. Fallback: `GET /agent/snapshot` + `GET /agent/schema/properties` (if not included in bootstrap)
5. `POST /agent/commands`
6. `POST /agent/tests/run`
7. `GET /agent/tests/:id` until final status

Conflict reasons:
- `not_found`
- `locked`
- `revision_mismatch`
- `validation_failed`

## 1. Snapshot and Schema

### `GET /agent/bootstrap`
One-shot bootstrap for agents. Returns:
- `health`
- `capabilities`
- `commandSchema`
- `snapshot` (default included)
- `schema` (default included)

Query:
- `includeSnapshot` (`true|false`, default `true`)
- `includeSchema` (`true|false`, default `true`)
- `className` (optional schema filter)

### `GET /agent/capabilities`
Returns compact machine-readable bootstrap metadata for generic agents.

Use this as the first call when an agent does not yet know uxrCoder conventions.

Includes:
- quickstart order
- command ops
- test step types
- response field compatibility for tests endpoints

### `GET /agent/snapshot`
Returns deterministic indexed view of the current DataModel.

Response shape:
- `revision`
- `generatedAt`
- `instances[]` with `{ id, className, name, path, pathString, parentId, childIds, properties }`

Notes:
- `path` is array-form (`["ReplicatedStorage","Folder"]`)
- `pathString` is string-form (`"ReplicatedStorage.Folder"`) for simpler filtering in generic agents

### `GET /agent/schema/properties`
Returns class/property metadata derived from current snapshot values.

Query:
- `className` (optional)

Response shape:
- `schemaVersion`
- `generatedAt`
- `revision`
- `classes[]` and `properties[]` with writable/type constraints

### `GET /agent/schema/commands`
Returns canonical command payload schema, aliases, and examples for `POST /agent/command(s)`.

Use this endpoint instead of trial writes to discover payload shape.

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
- Common aliases are accepted for compatibility:
- `path` -> `targetPath` (update/rename/delete/reparent)
- `parent` -> `parentPath` (create)
- `newName` -> `name` (rename)
- `update` supports both:
- `property` + `value` (single property)
- `properties` object map (multi-property update)
- Batch endpoint may rollback on configured transactional failure behavior.

## 3. Test Runs

### `POST /agent/tests/run`
Starts an autonomous test run.

Body:
```json
{
  "scenario": {
    "name": "spawn regression",
    "runtime": { "mode": "play", "stopOnFinish": true },
    "steps": [
      { "type": "assertExists", "path": ["Workspace", "SpawnLocation"] }
    ]
  }
}
```

Response compatibility:
- `success`
- `id` (top-level run id)
- `status` (top-level run status)
- `run` (full run object)

Notes:
- For real playtesting, set `scenario.runtime.mode = "play"`.
- Legacy alias `scenario.runtime.mode = "server"` is treated as `"run"`.
- If `scenario.runtime` is omitted, server default mode is `play`.
- If requested runtime cannot be started by Studio/plugin, run returns `error` with runtime details.

### `GET /agent/tests`
List recent runs.

Response compatibility:
- `runs` (primary list)
- `items` (alias of `runs` for generic clients)

### `GET /agent/tests/:id`
Get one run.

Response compatibility:
- `success`
- `id` (top-level)
- `status` (top-level)
- `run` (full run object)

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

`GET /health` also includes lightweight agent discovery hints:
- `agent.capabilitiesEndpoint`
- `agent.bootstrapEndpoint`
- `agent.snapshotEndpoint`
- `agent.schemaEndpoint`
- `agent.commandSchemaEndpoint`

Additional utility endpoints:
- `POST /build/:format`
- `POST /build/rbxmx`
- `POST /sourcemap/regenerate`
