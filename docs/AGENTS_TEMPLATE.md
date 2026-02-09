# AGENTS.md Template for uxrCoder Game Workspaces

Copy this file into your game project root as `AGENTS.md`.

---

You are connected to a live Roblox Studio session through uxrCoder.

Base URL: `http://127.0.0.1:34872`

If the agent runs in another sandbox/container, replace with LAN URL:
`http://<HOST_LAN_IP>:34872`

## Required Execution Order

1. `GET /health`
2. `GET /agent/bootstrap` (default includes health + capabilities + snapshot + schema)
3. If bootstrap response does not include `snapshot` or `schema`, call:
`GET /agent/snapshot` and `GET /agent/schema/properties`
4. Apply edits with `POST /agent/commands` (`transactional: true` for multi-step edits)
5. Run verification with `POST /agent/tests/run`
6. Poll `GET /agent/tests/:id` until final status: `passed`, `failed`, `aborted`, or `error`
7. If failed, fix the issue and rerun

## Hard Safety Rules (Mandatory)

- If `GET /health` fails or is unreachable, stop immediately.
- If API is unreachable, do not edit local files as fallback.
- Apply all DataModel/game changes only through `POST /agent/command` or `POST /agent/commands`.
- End every task with at least one `POST /agent/tests/run` and poll to final status.
- If a test cannot be started, report the blocker and stop.
- Never claim success without a run ID and final test status.

## Data Format Rules (Do Not Guess)

- `snapshot.instances[].path` is array form: `["ReplicatedStorage", "Folder"]`
- `snapshot.instances[].pathString` is dot form: `"ReplicatedStorage.Folder"`
- For tests API, prefer top-level `id` and `status` when present
- For tests API, fallback to `run.id` and `run.status` if needed
- `GET /agent/tests` may return both `runs` and `items` (alias)

## Command Rules

- Allowed ops: `create`, `update`, `rename`, `delete`, `reparent`
- Use `baseRevision` from latest snapshot for optimistic concurrency
- On `revision_mismatch`, refresh snapshot and retry once
- On `validation_failed`, check `GET /agent/schema/properties` and send valid values
- Do not issue destructive commands unless the task explicitly requires it
- Do not edit project files directly when the task is about live Studio/DataModel changes

## Test Rules

- Always add at least one `assertExists` or `assertProperty` after edits
- Prefer deterministic checks over timing-only checks
- Save run IDs and summarize failures with exact path + property names
- A task is incomplete unless a final test status is reported (`passed`, `failed`, `aborted`, `error`)

## Response Style

- Report what changed
- Report which API calls were used
- Report test run status and run ID
