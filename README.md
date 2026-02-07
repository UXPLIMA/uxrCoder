# uxrCoder

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)

**Real-time two-way synchronization between Roblox Studio and VS Code/Antigravity**

uxrCoder enables seamless development workflow by synchronizing your Roblox DataModel with external code editors in real-time. Edit scripts, inspect properties, and manage instances without switching contexts.

> **Developed by [UXPLIMA](https://uxplima.com)**

<p align="center">
  <img src="docs/images/demo.gif" alt="uxrCoder Demo" width="800">
</p>

## Features

- **Two-Way Sync** - Changes in Roblox Studio instantly reflect in VS Code and vice versa
- **Full DataModel Tree** - View and navigate the complete instance hierarchy
- **Script Editing** - Edit Luau scripts with full VS Code/Antigravity capabilities
- **Property Inspector** - View and modify instance properties from the editor
- **Real-Time Updates** - Sub-100ms synchronization latency
- **AI-Ready** - Designed for seamless AI-assisted development

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) 18.0 or higher
- [Roblox Studio](https://www.roblox.com/create)
- [VS Code](https://code.visualstudio.com/) or [Antigravity](https://antigravity.google/)

### Quick Start

```bash
# Clone the repository
git clone https://github.com/UXPLIMA/uxrCoder.git
cd uxrCoder

# Install dependencies
npm run setup

# Start the sync server
npm run dev
```

### Detailed Setup

#### 1. Server Setup

```bash
cd server
npm install
npm run dev
```

The sync server will start on `http://localhost:34872`.

#### 2. Roblox Studio Plugin

1. Copy `plugin/uxrCoderPlugin.lua` to your Roblox Studio plugins folder:
   - **Windows**: `%LOCALAPPDATA%\Roblox\Plugins`
   - **macOS**: `~/Documents/Roblox/Plugins`
2. Restart Roblox Studio
3. Enable the plugin from the Plugins tab

#### 3. VS Code Extension

```bash
cd vscode-extension
npm install
npm run compile
```

Press **F5** in VS Code to launch the Extension Development Host.

## Usage

### Basic Workflow

1. **Start the Server**: `npm run dev` in the server directory
2. **Open Roblox Studio**: The plugin auto-connects on startup
3. **Open VS Code**: The extension auto-connects to the server
4. **Start Developing**: Changes sync automatically!

### Commands

| Command | Description |
|---------|-------------|
| `uxrCoder: Connect` | Connect to the sync server |
| `uxrCoder: Disconnect` | Disconnect from the server |
| `uxrCoder: Refresh` | Manually refresh the explorer |

### Context Menu Actions

Right-click on any instance in the Roblox Explorer panel:

- **Insert Object** - Create a new child instance
- **Delete** - Remove the instance
- **Rename** - Change the instance name
- **Copy Path** - Copy as `game.Workspace.Model` path

## Architecture

```
┌─────────────────┐     HTTP/REST      ┌─────────────────┐     WebSocket      ┌─────────────────┐
│  Roblox Studio  │◄──────────────────►│   Sync Server   │◄──────────────────►│    VS Code      │
│     Plugin      │    (Port 34872)    │    (Node.js)    │                    │   Extension     │
└─────────────────┘                    └─────────────────┘                    └─────────────────┘
        │                                      │                                      │
        │ HttpService                          │ Express + WS                         │ WebSocket
        │                                      │                                      │
        ▼                                      ▼                                      ▼
   DataModel ────────────────────────► SyncEngine ◄──────────────────────── TreeView
   Serialization                       State Mgmt                          UI Rendering
```

## Project Structure

```
uxrCoder/
├── server/                     # Node.js sync server
│   ├── src/
│   │   ├── server.ts          # Express + WebSocket setup
│   │   ├── syncEngine.ts      # Core synchronization logic
│   │   ├── fileMapper.ts      # File system operations
│   │   └── types.ts           # TypeScript definitions
│   ├── package.json
│   └── tsconfig.json
│
├── plugin/                     # Roblox Studio plugin
│   ├── uxrCoderPlugin.lua     # Main plugin source
│   └── default.project.json   # Rojo build configuration
│
├── vscode-extension/           # VS Code extension
│   ├── src/
│   │   ├── extension.ts       # Extension entry point
│   │   ├── treeView.ts        # Explorer tree provider
│   │   ├── syncClient.ts      # WebSocket client
│   │   ├── propertyEditor.ts  # Property panel
│   │   └── scriptProvider.ts  # Script content provider
│   ├── package.json
│   └── tsconfig.json
│
├── shared/                     # Shared type definitions
│   └── types.ts
│
└── docs/                       # Documentation
```

## Configuration

### Server Configuration

Edit `server/src/server.ts`:

```typescript
const config: ServerConfig = {
    port: 34872,              // Server port
    host: '0.0.0.0',          // Bind address
    syncInterval: 100,        // Sync interval (ms)
    workspacePath: './workspace'
};
```

### Plugin Configuration

Edit `plugin/uxrCoderPlugin.lua`:

```lua
local CONFIG = {
    SERVER_URL = "http://localhost:34872",
    SYNC_INTERVAL = 0.1,  -- 100ms
    ENABLED = true,
    DEBUG = true
}
```

## Development

### Running Tests

```bash
# Server tests
cd server && npm test

# Extension tests
cd vscode-extension && npm test
```

### Building for Production

```bash
# Build all components
npm run build

# Build server only
cd server && npm run build

# Package VS Code extension
cd vscode-extension && npm run package
```

### Code Style

This project uses ESLint and Prettier for code formatting:

```bash
npm run lint      # Check for issues
npm run format    # Auto-format code
```

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Roadmap

- [ ] Full property editing for all instance types
- [ ] Asset management (images, sounds, meshes)
- [ ] Git-friendly file format export
- [ ] Team Create / collaborative editing support
- [ ] Marketplace extension publishing
- [ ] Performance profiling tools

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Inspired by [Rojo](https://rojo.space/) and [Argon](https://argon.wiki/)
- Built with [Express](https://expressjs.com/), [ws](https://github.com/websockets/ws), and VS Code Extension API

---

<p align="center">
  Made by <strong>UXPLIMA</strong> for the Roblox developer community
</p>
