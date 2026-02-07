# Installation & Setup

Follow these steps to set up uxrCoder for your project.

## Prerequisites
- **Node.js**: Version 18.x or later.
- **Roblox Studio**: Access to a development environment.
- **Visual Studio Code**: Recommended for the best experience.

## Quick Start (Manual Setup)

### 1. Clone & Install Dependencies
First, clone the repository and install the necessary npm packages for both the server and the extension.
```bash
git clone https://github.com/UXPLIMA/uxrCoder.git
cd uxrCoder
npm run setup
```

### 2. Start the Sync Hub
Launch the local Node.js server. This server must be running for communication to happen.
```bash
npm run dev
```

### 3. Install the Roblox Plugin
The plugin acts as the bridge inside Studio.
1. Locate `plugin/RobloxSyncPlugin.lua` in the repository.
2. Copy this file into your Roblox **Local Plugins** folder:
   - **Windows**: `%LOCALAPPDATA%\Roblox\Plugins`
   - **MacOS**: `~/Library/Application Support/Roblox/Plugins`
3. Restart Roblox Studio or re-activate the plugin in the Manage Plugins window.

### 4. Activate the VS Code Extension
1. Open the `uxrCoder/vscode-extension` folder in VS Code.
2. Press `F5` to open a new "Extension Development Host" window.
3. In the new window, open your project folder (where `uxrcoder.project.json` is located).

## Configuration Check
Ensure the following ports are available on your machine:
- **Port 34872**: Used by the Sync Server (default).
- **Firewall**: Ensure local connections are allowed for Node.js.
