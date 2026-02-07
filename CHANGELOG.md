# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-02-07

### Added
- [CORE] Neural Sync Engine for sub-50ms latency.
- [EXPLORER] Full Roblox DataModel Explorer in VS Code.
- [PROPS] Multi-instance property inspector.
- [FS] Bi-directional file system mapping for .lua files.
- [LSP] Built-in sourcemap.json generation for Luau LSP support.
- [BUILD] rbxlx and rbxmx export capabilities.

### Changed
- [DEV] Transitioned from read-only virtual documents to direct workspace file editing.
- [UX] Unified context menu for common studio operations.
- [INFRA] Standardized request logging and service lifecycle management.

### Fixed
- [SYNC] Resolved initial synchronization timing issues where explorer appeared empty.
- [DEDUP] Implemented path-based collision resolution for duplicate instances.
- [PLUGIN] Added heartbeat-based server restart detection and automatic restoration.
- [FS] Corrected path navigation for create operations targeting nested instances.

### Professionalization
- [DOC] Removed all emojis from codebase and documentation.
- [LOG] Standardized terminal output and log tags ([INFO], [WS], [SYNC], etc.).
- [COMMENT] Implemented JSDoc/LDoc standards across the entire repository.
