# uxrCoder VS Code Extension

Official VS Code extension for browsing and editing Roblox DataModel state synchronized by uxrCoder.

## Features

- Roblox Explorer tree view in activity bar
- Property editor webview
- Class browser webview
- Script open/edit workflow for mapped Lua files
- Context actions for create, rename, delete, copy path, copy/paste
- Build/export commands (`.rbxlx`, `.rbxmx`)
- Sourcemap regeneration command
- Utility commands for Wally, Selene, StyLua project setup flows

## Commands

Core connection:
- `robloxSync.connect`
- `robloxSync.disconnect`
- `robloxSync.refresh`

Explorer actions:
- `robloxSync.insertObject`
- `robloxSync.rename`
- `robloxSync.delete`
- `robloxSync.copyPath`
- `robloxSync.copyInstance`
- `robloxSync.pasteInstance`
- `robloxSync.openScript`

Runtime/build:
- `robloxSync.play`
- `robloxSync.run`
- `robloxSync.stop`
- `robloxSync.build`
- `robloxSync.exportModel`
- `robloxSync.regenerateSourcemap`

Project tooling:
- `robloxSync.wallyInit`
- `robloxSync.wallyInstall`
- `robloxSync.seleneInit`
- `robloxSync.seleneLint`
- `robloxSync.styluaInit`
- `robloxSync.styluaFormat`
- `robloxSync.generateGitignore`
- `robloxSync.initProject`

## Settings

- `robloxSync.serverUrl` (default `ws://127.0.0.1:34872`)
- `robloxSync.autoConnect` (default `true`)

## Development

```bash
npm install
npm run compile
```

Run extension dev host:
- Open this folder in VS Code
- Press `F5`

Package extension:

```bash
npm run package
```

## Requirements

- uxrCoder server running
- Roblox plugin installed in Studio

## Related Docs

- `../README.md`
- `../docs/INSTALLATION.md`
- `../docs/USAGE.md`
