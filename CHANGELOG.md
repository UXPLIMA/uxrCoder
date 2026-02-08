# Changelog

All notable changes to this project are documented in this file.

Format:
- [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
- [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

## [1.1.0] - 2026-02-08

### Added
- Agent visual baseline subsystem for screenshot assertions and recording.
- Baseline controls in screenshot test steps: `baselineKey`, `baselineMode`, `baselineAllowMissing`.
- Attempt-stamped plugin test events and stale-attempt rejection in server test event pipeline.
- Dedicated docs for agent API, release checklist, and end-to-end tutorials (EN/TR).
- Multilingual repository entrypoint via `README.md` (EN) and `README.tr.md` (TR).

### Changed
- Property schema build path optimized to work directly from indexed instances.
- Derived cache schema generation now avoids unnecessary instance remapping allocations.
- Autonomous test run finalization now includes isolation cleanup outcome before final pass/fail event.
- Root/server/extension versions advanced to `1.1.0`.
- Core documentation set rewritten for release readiness and endpoint parity.
- CI quality gates expanded to run server lint/test/build and extension lint/compile on each PR/push.
- Server npm test script now runs in non-watch mode by default (`vitest --run`).

### Fixed
- Reduced risk of runtime lifecycle race conditions during test retries.
- Improved deterministic handling of delayed/stale plugin test events.
- Updated extension/server docs to remove stale or duplicate statements.
- Plugin enum serialization now tolerates enum-type objects in addition to enum items.
- Root test pipeline no longer fails when VS Code extension test harness output is absent.

## [1.0.0] - 2026-02-07

### Added
- Real-time Roblox Studio <-> VS Code synchronization platform.
- DataModel explorer and property editing in extension.
- Script/file projection and sourcemap generation flow.
- Build/export endpoints for Roblox place/model artifacts.

### Fixed
- Initial synchronization stability and duplicate naming behavior.
- Plugin reconnect and server restart recovery paths.
