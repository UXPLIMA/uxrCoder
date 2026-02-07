# uxrCoder Extension for Antigravity & Visual Code

The official extension for uxrCoder, enabling real-time synchronization with Roblox Studio.
Designed to be the ultimate companion for AI-assisted Roblox development in **Antigravity** and **Visual Code**.
Designed to be the ultimate companion for AI-assisted Roblox development in Antigravity and Visual Code.

## Features

### 🌲 Roblox Explorer
Browse the DataModel tree directly in your editor.
- **Real-time Sync**: Updates instantly as you make changes in Studio.
- **Context Actions**: Insert, specific, rename, and delete instances.
- **Drag & Drop**: (Coming soon) Move instances around.

### 📝 Script Editing
Edit scripts with full language support and AI assistance.
- **Server Scripts** (`.server.lua`)
- **Local Scripts** (`.client.lua`)
- **Module Scripts** (`.lua`)

### 🎨 Property Editor
Inspect and modify properties with a custom UI.
- **Color Picker**: Visual color selection for `Color3`.
- **Vector Inputs**: Easy editing for `Vector3`, `UDim2`, etc.
- **Live Updates**: Changes reflect immediately in Studio.

### 📦 Asset Management
- **Class Browser**: Search and insert any Roblox class.
- **Export**: Save models as `.rbxmx` or the full place as `.rbxlx`.

### 🛠️ Ecosystem Tools
- **Luau LSP**: Auto-generates `sourcemap.json`.
- **Wally**: Built-in commands for package management.
- **Selene/StyLua**: Linting and formatting support.

## Commands

- `Roblox: Connect` / `Disconnect`: Manage server connection.
- `Roblox: Initialize Project`: Setup a new project with Rojo structure.
- `Roblox: Generate .gitignore`: Create standard ignore file.
- `Roblox: Build to .rbxlx`: Export the entire place.
- `Roblox: Export to .rbxmx`: Export selected instance.
- `Roblox: Regenerate Sourcemap`: Update LSP sourcemap.
- `Wally: Install`: Run `wally install`.
- `Selene: Lint`: Run `selene .`.
- `StyLua: Format`: Run `stylua .`.

## Requirements

- **uxrCoder Sync Server**: Must be running (`npm run dev` in server folder).
- **Roblox Studio Plugin**: Must be installed and enabled.
