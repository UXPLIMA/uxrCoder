# AGENTS.md Template for uxrCoder Game Workspaces

Copy this file into your game project root as `AGENTS.md`.

File contract:
- The filename must be exactly `AGENTS.md`.
- Do not fallback to `AGENT.md` or any other instruction file.
- If `AGENTS.md` is missing, stop and report the blocker.

---

You are connected to a live Roblox Studio session through uxrCoder.

Base URL: `http://127.0.0.1:34872`

If the agent runs in another sandbox/container, replace with LAN URL:
`http://<HOST_LAN_IP>:34872`

## Required Execution Order

1. `GET /health`
2. `GET /agent/bootstrap` (default includes health + capabilities + snapshot + schema)
3. Read `commandSchema` from bootstrap; if missing call `GET /agent/schema/commands`
4. If bootstrap response does not include `snapshot` or `schema`, call:
`GET /agent/snapshot` and `GET /agent/schema/properties`
5. Apply edits with `POST /agent/commands` (`transactional: true` for multi-step edits)
6. Run verification with `POST /agent/tests/run` and include:
`"runtime": { "mode": "play", "stopOnFinish": true }`
7. Poll `GET /agent/tests/:id` until final status: `passed`, `failed`, `aborted`, or `error`
8. If failed, fix the issue and rerun

## Hard Safety Rules (Mandatory)

- If `GET /health` fails or is unreachable, stop immediately.
- If API is unreachable, do not edit local files as fallback.
- Apply all DataModel/game changes only through `POST /agent/command` or `POST /agent/commands`.
- End every task with at least one `POST /agent/tests/run` and poll to final status.
- If a test cannot be started, report the blocker and stop.
- Never claim success without a run ID and final test status.
- Do not run probe writes to learn payload shape (no `Tmp*` objects, no trial mutations).
- Do not invent endpoints like `/agent/health`; use exact documented endpoints only.
- If runtime/play start fails, treat task as blocked (do not silently switch to edit-only validation).

## Data Format Rules (Do Not Guess)

- `snapshot.instances[].path` is array form: `["ReplicatedStorage", "Folder"]`
- `snapshot.instances[].pathString` is dot form: `"ReplicatedStorage.Folder"`
- For tests API, prefer top-level `id` and `status` when present
- For tests API, fallback to `run.id` and `run.status` if needed
- `GET /agent/tests` may return both `runs` and `items` (alias)

## Command Rules

- Allowed ops: `create`, `update`, `rename`, `delete`, `reparent`
- For `update`, both forms are valid:
- single: `{ "property": "<Name>", "value": ... }`
- multiple: `{ "properties": { "<Name>": ..., "<Name2>": ... } }`
- Use `baseRevision` from latest snapshot for optimistic concurrency
- On `revision_mismatch`, refresh snapshot and retry once
- On `validation_failed`, read `GET /agent/schema/commands` and `GET /agent/schema/properties`, then retry with corrected payload
- Do not issue destructive commands unless the task explicitly requires it
- Do not edit project files directly when the task is about live Studio/DataModel changes
- Use canonical array paths (for example `["Workspace","Part"]`) instead of string paths
- Prefer `targetPath`/`parentPath`/`newParentPath` canonical fields

## Test Rules

- Always add at least one `assertExists` or `assertProperty` after edits
- Prefer deterministic checks over timing-only checks
- Save run IDs and summarize failures with exact path + property names
- Default to runtime playtests: `scenario.runtime.mode = "play"` unless task explicitly needs edit-mode checks
- A task is incomplete unless a final test status is reported (`passed`, `failed`, `aborted`, `error`)

## GUI Rules

- If user asks for GUI/UI, create real UI instances (`ScreenGui`, `Frame`, `TextLabel`, `TextButton`, etc.) in `StarterGui` or `PlayerGui`.
- Do not satisfy a GUI request with only server-side scripts unless explicitly requested.
- GUI should be functional and readable: clear hierarchy, usable sizes/positions, and data bound to game state values/events.

## Engineering Quality Rules

- Write production-quality code: readable names, predictable flow, and clear separation of concerns.
- Prefer small focused scripts/modules over one large monolithic script.
- Keep server authority on game-critical logic; use client scripts for presentation/UI only.
- Avoid magic constants when possible; define tunable config values at top-level.
- Make changes extensible: design so new rounds/maps/modes can be added without full rewrite.
- Preserve maintainability: avoid duplicated logic and keep side effects explicit.
- Include short implementation rationale and tradeoffs in final report.

## Response Style

- Report what changed
- Report which API calls were used
- Report test run status and run ID
