# Assistant Quickstart

This is the fastest reliable flow to let an assistant operate uxrCoder safely.

## 1. Open the Correct Folder

Open your game workspace root in the assistant tool (not only `server/`).

The assistant should see:
- game files and mapping root
- `AGENTS.md` instruction file

## 2. Start uxrCoder

From repository root:

```bash
npm run dev
```

In Roblox Studio:
- enable the uxrCoder plugin
- trigger initial sync

Verify:

```bash
curl http://127.0.0.1:34872/health
```

## 3. Generate a Stable Rule File

```bash
npm run agent:init -- --project /path/to/MyGame --force
```

This command:
- discovers a reachable server URL (`localhost` or LAN IP),
- injects it into the template,
- writes `/path/to/MyGame/AGENTS.md`.

Filename requirement:
- the instruction file must stay exactly `AGENTS.md`.

## 4. Start Prompt

```text
Read AGENTS.md and implement <feature>, then run tests and report run ID + final status.
```

Example:

```text
Read AGENTS.md and implement a coin pickup system with server-side validation, then run a smoke test.
```

When running tests, include runtime mode:

```json
{
  "runtime": { "mode": "play", "stopOnFinish": true }
}
```

## 5. Why This Flow Works

- `GET /agent/bootstrap` provides health + capabilities + optional snapshot/schema in one call.
- `GET /agent/schema/commands` removes payload guesswork.
- `path` (array) and `pathString` (string) are explicit for robust targeting.
- Test responses are compatible at both top-level (`id`, `status`) and fallback (`run.*`).

## 6. Failure Policy

- If `GET /health` fails, stop and report blocker.
- Do not fall back to direct local-file edits for live Studio tasks.
- Do not use probe writes to guess payload format.
- If runtime play mode cannot start, report blocked runtime.
- A task is complete only after reporting run ID and final status.
