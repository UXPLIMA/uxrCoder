# Installation Guide

This guide prepares uxrCoder for local development and release validation.

## 1. Prerequisites

Required:
- Node.js `18+`
- npm `9+`
- Roblox Studio
- VS Code `1.85+`

Recommended:
- Git
- curl (for API health checks)

## 2. Clone and Install

```bash
git clone https://github.com/UXPLIMA/uxrCoder.git
cd uxrCoder
npm run setup
```

## 3. Start the Server

```bash
npm run dev
```

Default server config:
- Host: `0.0.0.0`
- Port: `34872`
- Workspace: `./workspace`

## 4. Install Roblox Plugin

Source file:
- `plugin/RobloxSyncPlugin.lua`

Copy into Roblox local plugins directory:
- Windows: `%LOCALAPPDATA%\Roblox\Plugins`
- macOS: `~/Library/Application Support/Roblox/Plugins`

Then restart Roblox Studio.

## 5. Run VS Code Extension Host

1. Open `vscode-extension/` in VS Code.
2. Press `F5`.
3. In the new Extension Development Host window, open your Roblox workspace folder.

## 6. Verify Connectivity

### Server Health

```bash
curl http://127.0.0.1:34872/health
```

Expected:
- `status: "ok"`
- `instanceCount` present after first plugin sync.

### Sync Loop Check

- In Studio, trigger plugin initial sync.
- In VS Code Explorer view, confirm DataModel tree appears.
- Change a script in VS Code, save, verify Studio updates.

## 7. Optional: Build and Tests

Run before publishing:

```bash
npm --prefix server run lint
npm --prefix server test -- --run
npm --prefix server run build
npm --prefix vscode-extension run lint
npm run build
```

## 8. Optional: Profile Large Trees

```bash
npm --prefix server run profile:large-tree
```

Environment overrides:
- `FOLDER_COUNT`
- `PARTS_PER_FOLDER`
- `ITERATIONS`
- `LOOKUP_SAMPLE`
- `PROFILE_OUT`

## 9. Common Setup Issues

### Plugin installed but no sync
- Ensure server is running on `34872`.
- Check Studio Output for plugin HTTP errors.
- Verify local firewall allows loopback Node traffic.

### VS Code tree empty
- Ensure extension is connected to `ws://127.0.0.1:34872`.
- Trigger plugin initial sync again.

### Port conflict
- Set custom port:
```bash
PORT=34873 npm run dev
```
- Update VS Code setting `robloxSync.serverUrl` accordingly.
