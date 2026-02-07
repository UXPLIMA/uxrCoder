# uxrCoder Sync Server

The backend server for uxrCoder that bridges Roblox Studio with your editor (Antigravity / Visual Code).

## Overview

The server runs on Node.js and manages:
1.  **WebSocket Server**: Communicates with the editor extension.
2.  **HTTP API**: Communicates with the Roblox Studio plugin.
3.  **File Watcher**: Monitors the filesystem for changes.
4.  **Sync Engine**: Handles conflict resolution and delta updates.
5.  **Build System**: Serializes instances to `.rbxlx` and `.rbxmx`.
6.  **Sourcemap Generator**: Creates `sourcemap.json` for Luau LSP.

## API Endpoints

### Sync
- `GET /health`: Check server status.
- `GET /changes`: Get pending changes for Roblox Studio (long-polling).
- `POST /sync`: Push changes from Roblox Studio to Server.

### Build
- `GET /build/rbxlx`: Download the entire project as a place file.
- `POST /build/rbxmx`: Download specific instances as a model file.

### Ecosystem
- `POST /sourcemap/regenerate`: Trigger sourcemap regeneration.

## Configuration

The server can be configured via `config.json` or environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 34872 | Server port |
| `HOST` | 0.0.0.0 | Bind address |
| `SYNC_INTERVAL` | 100 | Polling interval (ms) |
| `WORKSPACE_PATH` | ./workspace | Root directory for sync |

## Usage

```bash
# Install dependencies
npm install

# Start server
npm run dev

# Run tests
npm test
```
