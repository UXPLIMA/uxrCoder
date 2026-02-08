# uxrCoder Roadmap

## Release Status

Current release target: **v1.1.0**

Project state: **Release-ready**
- Core sync plane complete
- Agent control plane complete
- Autonomous test plane complete
- Observability/debug plane complete
- Documentation and multilingual onboarding complete

## Completed Tracks

### Track A: Core Sync Reliability
- Deterministic create/update/delete/reparent handling
- Stable `id -> path` indexing
- Collision-safe sibling naming strategy
- Filesystem + Studio + server convergence safeguards

### Track B: Agent Control Plane
- `/agent/snapshot`
- `/agent/schema/properties`
- `/agent/command`
- `/agent/commands`
- Revision checks, lock management, idempotency cache
- Conflict payload model (`not_found`, `locked`, `revision_mismatch`, `validation_failed`)

### Track C: Property Intelligence
- Schema derivation from observed state
- Writable/read-only distinction
- Type and constraint validation before queueing plugin changes
- Shared schema usage across API and property editor

### Track D: Autonomous Playtesting
- Queueing + retry with backoff
- Plugin step runner (assertion/mutation/harness)
- Isolation cleanup and rollback policies
- Run report/artifact persistence
- Visual screenshot baseline assert/record workflow
- Attempt-aware event hardening to avoid stale retry races

### Track E: Observability and Scale
- `/agent/tests/metrics`
- `/agent/locks`
- `/agent/debug/export`
- `/agent/debug/profile`
- 100k+ synthetic profiling harness
- Snapshot/schema/indexed view caching improvements

### Track F: Release Documentation
- Multilingual repository entrypoint (`README.md`, `README.tr.md`)
- Installation, usage, configuration, architecture docs refreshed
- Agent API reference added
- EN/TR tutorial docs added
- Release checklist added

## Post-Release Backlog (Future)

These are future improvements, not release blockers:

1. Advanced harness rollback hooks for highly custom side effects.
2. Plugin-in-the-loop long-duration soak automation in CI.
3. Additional localization beyond EN/TR.
4. Broader extension UX refinements after sync/agent stability remains steady over multiple releases.
