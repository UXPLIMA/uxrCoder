<h1 align="center">uxrCoder</h1>

<p align="center">
  <strong>The Ultimate Pro-Grade Interface between Roblox Studio and Visual Studio Code.</strong><br>
  Built for high-performance development, AI-assisted coding, and seamless DataModel synchronization.
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-18%2B-green" alt="Node.js"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.3-blue" alt="TypeScript"></a>
  <a href="https://github.com/UXPLIMA/uxrCoder/releases"><img src="https://img.shields.io/badge/Release-v1.0.0-orange" alt="Release"></a>
  <a href="https://uxplima.com"><img src="https://img.shields.io/badge/Developed%20by-UXPLIMA-purple" alt="UXPLIMA"></a>
</p>

---

## Why uxrCoder?

Roblox development shouldn't be confined to a singular environment. **uxrCoder** bridges the gap between the powerful Roblox DataModel and the industry-standard developer experience of VS Code and AI tools like **Antigravity**.

Designed by [UXPLIMA](https://uxplima.com), uxrCoder is engineered for low latency, high reliability, and an "it just works" experience that scales from solo developers to professional teams.

---

## Core Features

- **High-Fidelity Two-Way Synchronization**: Real-time mirroring with sub-50ms latency.
- **Advanced File Projection**: Intelligent mapping of Roblox instances to the physical file system.
- **Roblox DataModel Explorer**: Native tree view integrated directly into the VS Code Activity Bar.
- **World-Class Scripting Experience**: Edit code using your favorite IDE features with full Luau LSP support.
- **Integrated Property Inspector**: Live property editing without leaving VS Code.

[Learn more about the technical details in our Architecture Guide.](docs/ARCHITECTURE.md)

---

## Documentation (Wiki)

Explore our comprehensive guides for setup, configuration, and advanced usage:

- [**Installation & Setup**](docs/INSTALLATION.md): Quick start guide to get running in minutes.
- [**Technical Architecture**](docs/ARCHITECTURE.md): In-depth look at the hub-and-spoke system.
- [**Configuration Reference**](docs/CONFIGURATION.md): Master the `uxrcoder.project.json` mapping.
- [**Usage & Workflows**](docs/USAGE.md): Pro-tips and common development patterns.

---

## Quick Start

1. **Install Dependencies**
   ```bash
   npm run setup
   ```
2. **Start the Sync Hub**
   ```bash
   npm run dev
   ```
3. **Install the Plugin**
   - Copy `plugin/RobloxSyncPlugin.lua` to your Roblox Local Plugins folder.
4. **Launch VS Code Extension**
   - Press `F5` in VS Code to start the extension development host.

---

## Contributing

We welcome contributions from the community! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

---

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.

---

<p align="center">
  <strong>Built by <a href="https://uxplima.com">UXPLIMA</a></strong><br>
  <em>Innovating the future of Roblox Development.</em>
</p>
