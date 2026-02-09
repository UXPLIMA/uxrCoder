# AI Quickstart (End User)

This is the fastest reliable flow to let any AI agent edit and test your Roblox game through uxrCoder.

## 1. Open the Correct Folder

Open your **game workspace root** in the AI tool, not just `server/`.

The agent should see:
- your game files (`workspace/` mapping)
- `AGENTS.md` instructions

## 2. Start uxrCoder

From `uxrCoder` repository root:

```bash
npm run dev
```

In Roblox Studio:
- enable the uxrCoder plugin
- trigger initial sync

Verify server:

```bash
curl http://127.0.0.1:34872/health
```

## 3. Give the Agent a Stable Rule File

Generate `AGENTS.md` automatically:

```bash
npm run agent:init -- --project /path/to/MyGame --force
```

This command:
- detects a reachable server URL (`localhost` or LAN IP),
- injects it into the template,
- writes `/path/to/MyGame/AGENTS.md`.
- The instruction filename must stay exactly `AGENTS.md`.

Then your first chat message can be only:

```text
Read AGENTS.md and implement <your feature>.
```

Example:

```text
Read AGENTS.md and implement a coin pickup system with server-side validation and a smoke test.
```

When running tests, ensure scenario includes:
```json
{
  "runtime": { "mode": "play", "stopOnFinish": true }
}
```

## 4. Why This Works Better

- Agent starts with `GET /agent/bootstrap` so health + capabilities + snapshot + schema can be fetched in one call.
- Agent reads `GET /agent/schema/commands` so command payload shape is explicit.
- Path handling is explicit (`path` array + `pathString` string).
- Test run parsing is robust (`id/status` top-level with `run.*` fallback).
- You avoid long manual prompts for every session.

## 5. Failure Policy (Important)

- If `GET /health` fails, the agent must stop and report the blocker.
- Agent must not switch to direct file edits as fallback for live Studio tasks.
- Agent must not run probe writes (temporary objects) to guess payload shape.
- If play runtime cannot start, agent must report blocked runtime (not silently downgrade to edit-only checks).
- A task is only complete after reporting a test run ID and final status.
