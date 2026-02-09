# Usage Guide

This document covers day-to-day workflows for Studio users, VS Code users, and AI agents.

## 1. Core Developer Workflow

1. Start server (`npm run dev`).
2. Start Roblox Studio with plugin enabled.
3. Connect VS Code extension.
4. Perform edits in either Studio or VS Code.
5. Let sync engine converge filesystem + DataModel.

## 2. Explorer Operations (VS Code)

Supported instance operations in the extension:
- Insert object
- Rename
- Delete
- Copy path
- Copy/Paste instance
- Open script
- Build/export commands

Notes:
- Rename/reparent collisions are resolved deterministically with numeric suffixes.
- Script files are mapped by class-specific extension (`.server.lua`, `.client.lua`, `.lua`).

## 3. Property Editing

Property edits are validated by server-side schema before queueing plugin changes.

Use cases:
- Primitive properties (`number`, `string`, `boolean`)
- Struct-like values (`Vector3`, `Color3`, `UDim2`, `CFrame`, etc.)
- Enum payloads

Read schema from:
- `GET /agent/schema/properties`

## 4. Agent Command Workflow

Typical reliable loop for agents:

1. Bootstrap in one call:
```http
GET /agent/bootstrap
```
2. Fallback if bootstrap excludes details:
```http
GET /agent/snapshot
GET /agent/schema/properties
```
3. Submit command(s):
```http
POST /agent/command
POST /agent/commands
```
4. Handle `conflict` payloads (`not_found`, `locked`, `revision_mismatch`, `validation_failed`).
5. Retry with updated revision/snapshot when needed.

Snapshot parsing note:
- `path` is array-form
- `pathString` is dot-separated string-form for easy filtering

## 5. Autonomous Test Workflow

Start run:
```http
POST /agent/tests/run
```

Observe:
- `GET /agent/tests`
- `GET /agent/tests/:id`
- `GET /agent/tests/metrics`

Response parsing note:
- read top-level `id` and `status` first
- fallback to `run.id` and `run.status` for compatibility

Control:
- `POST /agent/tests/:id/abort`

Artifacts/report:
- `GET /agent/tests/:id/artifacts`
- `GET /agent/tests/:id/report`

Event ingestion from plugin:
- `POST /agent/tests/events`

## 6. Visual Baseline Workflow

Use `captureScreenshot` steps with optional baseline controls:
- `baselineKey`
- `baselineMode`: `assert | record | assert_or_record`
- `baselineAllowMissing`

Baseline files are stored in:
- `workspace/.uxr-tests/baselines/`

## 7. Observability and Debug

Key endpoints:
- `GET /agent/tests/metrics`
- `GET /agent/locks`
- `POST /agent/debug/export`
- `GET /agent/debug/profile`

Use debug export when reporting bugs so issues are reproducible.

## 8. Build and Export

- Build place: `POST /build/rbxlx`
- Export model: `POST /build/rbxmx`
- Regenerate sourcemap: `POST /sourcemap/regenerate`

## 9. Troubleshooting Patterns

### Name appears suffixed (`Folder_2`)
This is expected collision resolution for sibling uniqueness.

### Agent update rejected
Inspect `conflict` object and property schema constraints.

### Test run flakiness
- Use isolation settings.
- Enable artifact capture.
- Inspect run report + events.
- Use visual baseline for deterministic camera assertions.
