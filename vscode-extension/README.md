# uxrCoder VS Code Extension

VS Code extension for browsing and editing Roblox DataModel state synchronized by uxrCoder.

## Features

- Roblox Explorer tree view in the activity bar
- Property Editor webview
- Class Browser webview
- Context actions: insert, rename, delete, copy path, copy/paste instance
- Script open/edit flow for mapped Lua scripts
- Runtime controls: play, run, stop
- Build/export commands (`.rbxlx`, `.rbxmx`)
- Sourcemap regeneration
- Project utilities (Wally, Selene, StyLua, project bootstrap helpers)

## Commands

Connection:
- `robloxSync.connect`
- `robloxSync.disconnect`
- `robloxSync.refresh`

Explorer:
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

Run Extension Development Host:
- open this folder in VS Code
- press `F5`

Package extension:

```bash
npm run package
```

## Requirements

- uxrCoder server running
- Roblox plugin installed in Studio

## Related Docs

- `../README.md`
- `../README.tr.md`
- `../docs/INSTALLATION.md`
- `../docs/USAGE.md`
