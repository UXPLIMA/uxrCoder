# Configuration Reference

This document covers project mapping, server runtime variables, and VS Code extension settings.

## 1. Project Mapping File

uxrCoder looks for one of these files in workspace root:
- `uxrcoder.project.json`
- `default.project.json`

### Example

```json
{
  "name": "MyRobloxProject",
  "tree": {
    "$className": "DataModel",
    "ReplicatedStorage": {
      "$className": "ReplicatedStorage",
      "$path": "src/shared"
    },
    "ServerScriptService": {
      "$className": "ServerScriptService",
      "$path": "src/server"
    },
    "StarterPlayer": {
      "$className": "StarterPlayer",
      "StarterPlayerScripts": {
        "$className": "StarterPlayerScripts",
        "$path": "src/client"
      }
    },
    "Workspace": {
      "$className": "Workspace",
      "$path": "src/workspace"
    }
  }
}
```

### Mapping Fields

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Project display name. |
| `tree` | `object` | Root mapping tree from `DataModel`. |
| `$className` | `string` | Expected Roblox class for that node. |
| `$path` | `string` | Filesystem projection path for branch. |
| `$ignoreUnknownInstances` | `boolean` | Optional ignore behavior for unknowns. |

## 2. Server Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `34872` | HTTP/WebSocket server port |
| `HOST` | `0.0.0.0` | Bind host |
| `SYNC_INTERVAL` | `100` | Sync logging threshold interval |
| `WORKSPACE_PATH` | `./workspace` | Root folder for mapped data |

Example:

```bash
PORT=34873 HOST=127.0.0.1 WORKSPACE_PATH=./workspace npm run dev
```

## 3. VS Code Extension Settings

| Setting | Default | Description |
|---|---|---|
| `robloxSync.serverUrl` | `ws://127.0.0.1:34872` | WebSocket endpoint |
| `robloxSync.autoConnect` | `true` | Connect on startup |

## 4. Agent Runtime Configuration

### Command-level
- `baseRevision` for optimistic concurrency.
- `x-idempotency-key` header (or `idempotencyKey` body field) for deduplication.

### Test scenario-level
- `safety` (timeout, retry, destructive guard, step limits)
- `runtime` (`none`, `run`, `play`)
- `isolation` (cleanup and restore policies)

See:
- `docs/AGENT_API.md`
- `docs/agent-test-harness.md`

## 5. Recommended Production Defaults

For stable local usage:
- Keep server bound to loopback unless LAN sync is intentional.
- Keep one authoritative editor session writing to the workspace.
- Keep debug artifacts (`.uxr-tests`, `.uxr-debug`) available during triage.

## 6. Ignored/Generated Paths

Common generated paths:
- `.uxr-tests/`
- `.uxr-debug/`
- `robloxsourcemap.json`

Decide in your repo policy whether to commit or ignore these artifacts.
