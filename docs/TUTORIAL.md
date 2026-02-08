# Tutorial: End-to-End Workflow

This tutorial walks through a complete uxrCoder flow:
1. setup
2. sync verification
3. agent command execution
4. autonomous test run
5. debug bundle export

## Step 1: Setup

From repository root:

```bash
npm run setup
npm run dev
```

In parallel:
- install `plugin/RobloxSyncPlugin.lua` into Roblox local plugins
- launch extension host from `vscode-extension/` via `F5`

## Step 2: Trigger Initial Sync

In Roblox Studio:
- enable plugin
- run initial sync

Check server health:

```bash
curl http://127.0.0.1:34872/health
```

Expected:
- `status: "ok"`
- `instanceCount > 0`

## Step 3: Read Snapshot and Schema

```bash
curl http://127.0.0.1:34872/agent/snapshot
curl "http://127.0.0.1:34872/agent/schema/properties?className=Part"
```

Use snapshot IDs for deterministic target selection.

## Step 4: Create and Update via Agent API

Create a folder under `ReplicatedStorage` (replace parent target by your snapshot data):

```bash
curl -X POST http://127.0.0.1:34872/agent/command \
  -H 'Content-Type: application/json' \
  -H 'x-idempotency-key: tutorial-create-1' \
  -d '{
    "command": {
      "op": "create",
      "parentPath": ["ReplicatedStorage"],
      "className": "Folder",
      "name": "TutorialFolder"
    }
  }'
```

Rename it:

```bash
curl -X POST http://127.0.0.1:34872/agent/command \
  -H 'Content-Type: application/json' \
  -d '{
    "command": {
      "op": "rename",
      "targetPath": ["ReplicatedStorage", "TutorialFolder"],
      "name": "TutorialFolder_Main"
    }
  }'
```

## Step 5: Run Autonomous Test

```bash
curl -X POST http://127.0.0.1:34872/agent/tests/run \
  -H 'Content-Type: application/json' \
  -d '{
    "scenario": {
      "name": "tutorial smoke",
      "safety": {
        "allowDestructiveActions": false,
        "maxRetries": 1
      },
      "steps": [
        { "type": "assertExists", "path": ["ReplicatedStorage", "TutorialFolder_Main"] },
        { "type": "captureArtifact", "name": "tutorial-folder", "path": ["ReplicatedStorage", "TutorialFolder_Main"] }
      ]
    }
  }'
```

Poll latest runs:

```bash
curl http://127.0.0.1:34872/agent/tests
```

## Step 6: Read Report and Artifacts

Replace `<runId>`:

```bash
curl http://127.0.0.1:34872/agent/tests/<runId>/report
curl http://127.0.0.1:34872/agent/tests/<runId>/artifacts
```

## Step 7: Export Debug Bundle

```bash
curl -X POST http://127.0.0.1:34872/agent/debug/export \
  -H 'Content-Type: application/json' \
  -d '{"persist": true, "includeBundle": false, "label": "tutorial"}'
```

Output is persisted under:
- `workspace/.uxr-debug/`

## Step 8: Profile Hotpaths (Optional)

```bash
curl "http://127.0.0.1:34872/agent/debug/profile?iterations=5&sampleSize=5000&includeSchema=true"
```

## Step 9: Local Release Validation

```bash
npm --prefix server test -- --run
npm --prefix server run build
npm run build
```

If all pass, the workspace is ready for release packaging and publication.
