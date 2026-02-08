# Architecture

uxrCoder uses a hub-and-spoke architecture:
- Roblox plugin <-> server over HTTP polling APIs
- VS Code extension <-> server over WebSocket
- server <-> filesystem via mapper + watcher

## 1. High-Level Diagram

```mermaid
graph TD
    subgraph Roblox Studio
      P[RobloxSyncPlugin.lua]
    end

    subgraph Server (Node.js)
      API[Express API]
      WS[WebSocket Gateway]
      SE[SyncEngine]
      FM[FileMapper]
      WT[Watcher]
      AG[Agent Layer]
      TM[Test Manager]

      API --> SE
      API --> AG
      AG --> TM
      SE --> FM
      WT --> SE
      FM --> WT
    end

    subgraph VS Code Extension
      EXT[Extension Host]
      TV[Explorer Tree]
      PE[Property Editor]
      SC[Sync Client]
      EXT --> TV
      EXT --> PE
      EXT --> SC
    end

    P <--> API
    SC <--> WS
    WS --> SE
```

## 2. Core Server Subsystems

### Sync Engine
Responsibilities:
- canonical in-memory instance graph,
- stable `id -> path` lookup,
- deterministic rename/reparent behavior,
- revision tracking and rollback snapshot support.

### File Mapper
Responsibilities:
- map instance tree to filesystem projection,
- sync create/update/delete/reparent,
- class-aware script/data extension handling.

### Watcher
Responsibilities:
- detect filesystem changes,
- prevent loopback echo with ignore/pause guards,
- feed normalized changes back into sync engine.

### Agent Layer
Responsibilities:
- snapshot/schema derivation,
- command execution with lock + revision + idempotency controls,
- conflict payload generation,
- debug profiling and export bundles.

### Test Layer
Responsibilities:
- queueing and retry with backoff,
- plugin test dispatch and timeout controls,
- event persistence, report generation, artifact storage,
- optional visual baseline evaluation.

## 3. Data Consistency Model

uxrCoder converges three states:
- server in-memory state,
- filesystem projection,
- plugin/studio state.

Consistency controls:
- revision increments on mutating operations,
- per-path locks for agent commands,
- idempotency cache for retried requests,
- transactional rollback support for batch commands.

## 4. Agent Safety Model

- Base revision check rejects stale command batches.
- Command locks block conflicting concurrent writers.
- Schema-based property validation prevents invalid payloads.
- Explicit conflict payloads avoid silent divergence.

## 5. Autonomous Test Execution Model

1. test run enqueued
2. server dispatches `test_run`
3. plugin executes steps and sends events/artifacts
4. server finalizes run, retries if allowed
5. report + artifacts persisted under `.uxr-tests/`

Race-hardening details:
- event attempt stamping,
- stale attempt event ignore/reject,
- cleanup outcome included before final pass/fail decision.

## 6. Performance and Scale

- revision-scoped derived cache for indexed/snapshot/schema views,
- cached indexed split in sync engine per revision,
- synthetic `100k+` tree profiling support,
- batch lookup profiling (`id -> path`, `id -> instance`).

## 7. Observability Surface

Primary diagnostics endpoints:
- `/agent/tests/metrics`
- `/agent/locks`
- `/agent/debug/export`
- `/agent/debug/profile`

These endpoints are designed for CI and human triage workflows.
