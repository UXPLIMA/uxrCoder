# Configuration

uxrCoder uses a configuration file to determine how Roblox instances are mapped to your local file system.

## Project Configuration (`uxrcoder.project.json`)

Created in the root of your workspace, this file defines the projection rules.

```json
{
  "name": "MyProject",
  "tree": {
    "$className": "DataModel",
    "ReplicatedStorage": {
      "$path": "src/shared"
    },
    "ServerScriptService": {
      "$path": "src/server"
    }
  }
}
```

### Key Fields

| Field | Description |
| :--- | :--- |
| `name` | The name of the project. |
| `tree` | The mapping hierarchy starting from the DataModel. |
| `$className` | Specifies the Roblox class for the current directory level. |
| `$path` | The local file system path where this branch should be synchronized. |

## Server Configuration

The server can be configured via environment variables or CLI arguments (if supported).

- **PORT**: Default is `34872`.
- **HOST**: Default is `127.0.0.1`.
- **WORKSPACE_PATH**: The root directory where your project files reside.

## Extension Settings

In VS Code, you can modify the following settings in your User or Workspace settings:

- `robloxSync.serverUrl`: The URL of the sync server (e.g., `ws://127.0.0.1:34872`).
- `robloxSync.autoConnect`: Automatically connect on startup.
