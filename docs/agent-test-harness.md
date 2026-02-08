# Agent Test Harness Guide

This document describes plugin-side autonomous test execution and harness integration.

## 1. Harness Resolution Order

For `harnessAction` steps, plugin resolves runner in this order:
1. `step.runnerPath` (full DataModel path)
2. `ReplicatedStorage.uxrAgentTestRunner`
3. `ReplicatedStorage.uxrCoder.uxrAgentTestRunner`
4. Built-in fallback actions when `allowBuiltin ~= false`

## 2. Supported Harness Types

- `BindableFunction`: `Invoke(action, payload, context)`
- `BindableEvent`: `Fire(action, payload, context)`
- `ModuleScript`:
  - table with `ExecuteAction` / `Execute` / `Run`
  - function module returning callable action handler

## 3. Step Example

```json
{
  "type": "harnessAction",
  "action": "teleportToSpawn",
  "payload": {
    "spawnPath": ["Workspace", "SpawnLocation"]
  }
}
```

## 4. Built-in Fallback Actions

If no harness instance is found (or `allowBuiltin` is enabled):
- `teleportPlayerToPath`
- `teleportPlayerToCFrame`
- `setHumanoidWalkSpeed`
- `moveToPath`

## 5. Built-in Assertion Steps

Available without custom harness code:
- `assertCharacterReady`
- `assertCharacterNearPath`
- `assertHumanoidState`
- `assertHumanoidWalkSpeed`
- `assertExists`
- `assertNotExists`
- `assertProperty`

## 6. Isolation and Cleanup

Default isolation is enabled (best-effort rollback).

```json
{
  "isolation": {
    "enabled": true,
    "suppressSyncChanges": true,
    "cleanupCreatedInstances": true,
    "restoreDestroyedInstances": true,
    "restorePropertyChanges": true,
    "skipDestroyedRuntimeOwned": true,
    "allowSnapshotRestoreForNonCloneable": true,
    "ignoreMissingDestroyedRestoreParent": true,
    "skipDestroyedRestoreClasses": ["Player", "Terrain"]
  }
}
```

Notes:
- `suppressSyncChanges: true` prevents test mutations from entering normal sync queue.
- Cleanup handlers can be returned from harness response via `cleanup`/`Cleanup` function.
- Declarative cleanup is supported via `cleanupSteps`/`CleanupSteps`.

Supported `cleanupSteps`:
- `log`
- `wait`
- `destroyInstance`
- `setProperty`
- `renameInstance`
- `reparentInstance`

## 7. Retry Policy

```json
{
  "safety": {
    "maxRetries": 2,
    "retryDelayMs": 1500,
    "retryBackoffFactor": 2,
    "maxRetryDelayMs": 30000
  }
}
```

## 8. Visual Artifacts

`captureScreenshot` attempts capture via `ThumbnailGenerator`.

Success path:
- sends binary artifact (`artifactBase64`, `artifactMimeType`) to `/agent/tests/events`.

Failure path:
- sends JSON fallback artifact with error context.
- if `required: true`, step fails.

Example:

```json
{
  "type": "captureScreenshot",
  "name": "spawn-check",
  "width": 1280,
  "height": 720,
  "required": false
}
```

## 9. Visual Baseline Options

Optional screenshot baseline flow:
- `baselineKey`
- `baselineMode`: `assert | record | assert_or_record | auto`
- `baselineAllowMissing`

Behavior:
- `assert`: compare against existing baseline hash, fail on mismatch.
- `record`: overwrite baseline with latest screenshot.
- `assert_or_record`/`auto`: record if missing, otherwise assert.

Baselines stored in:
- `workspace/.uxr-tests/baselines/`

## 10. Metrics and Debugging

- `GET /agent/tests/metrics`
- `GET /agent/locks`
- `POST /agent/debug/export`
- `GET /agent/debug/profile`

These endpoints expose queue state, retry/backoff, lock contention, sync latency, and profiling summaries.
