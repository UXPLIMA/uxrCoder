import { describe, expect, it, vi } from 'vitest';
import {
    executeBatchAgentCommandFlow,
    executeSingleAgentCommandFlow,
    type AgentCommandApiDependencies,
} from '../src/agentCommandApi';
import type { AgentCommand, AgentCommandResult } from '../src/types';

function createDefaultDeps(): AgentCommandApiDependencies & {
    releaseLockSpy: ReturnType<typeof vi.fn>;
    recordLockContentionSpy: ReturnType<typeof vi.fn>;
    restoreAfterRollbackSpy: ReturnType<typeof vi.fn>;
    validateBaseRevisionSpy: ReturnType<typeof vi.fn>;
    parseCommandSpy: ReturnType<typeof vi.fn>;
    acquireLockSpy: ReturnType<typeof vi.fn>;
    executeAgentCommandSpy: ReturnType<typeof vi.fn>;
    createSnapshotSpy: ReturnType<typeof vi.fn>;
} {
    const releaseLockSpy = vi.fn();
    const recordLockContentionSpy = vi.fn();
    const restoreAfterRollbackSpy = vi.fn();
    const validateBaseRevisionSpy = vi.fn(() => ({ ok: true as const }));
    const parseCommandSpy = vi.fn((payload: unknown) => payload as AgentCommand);
    const acquireLockSpy = vi.fn(() => ({ ok: true as const }));
    const executeAgentCommandSpy = vi.fn((command: AgentCommand, index: number): AgentCommandResult => ({
        index,
        op: command.op,
        success: true,
        resolvedPath: ['Workspace', 'Ok'],
        resolvedId: 'resolved-id',
    }));
    const createSnapshotSpy = vi.fn(() => ({ snapshot: true }));

    return {
        validateBaseRevision: validateBaseRevisionSpy,
        parseCommand: parseCommandSpy,
        createLockOwner: key => `owner:${key ?? 'none'}`,
        collectLockPaths: () => [['Workspace', 'Path']],
        acquireLock: acquireLockSpy,
        releaseLock: releaseLockSpy,
        executeAgentCommand: executeAgentCommandSpy,
        getRevision: () => 42,
        recordLockContention: recordLockContentionSpy,
        createSnapshot: createSnapshotSpy,
        restoreAfterRollback: restoreAfterRollbackSpy,
        releaseLockSpy,
        recordLockContentionSpy,
        restoreAfterRollbackSpy,
        validateBaseRevisionSpy,
        parseCommandSpy,
        acquireLockSpy,
        executeAgentCommandSpy,
        createSnapshotSpy,
    };
}

describe('agentCommandApi runtime conflict simulation', () => {
    it('fails fast on revision mismatch before parsing command', () => {
        const deps = createDefaultDeps();
        deps.validateBaseRevisionSpy.mockReturnValue({
            ok: false,
            status: 409,
            body: {
                success: false,
                conflict: {
                    reason: 'revision_mismatch',
                    expected: { baseRevision: 10 },
                    actual: { currentRevision: 11 },
                },
            },
        });

        const outcome = executeSingleAgentCommandFlow({
            requestBody: {
                command: {
                    op: 'create',
                    parentPath: ['Workspace'],
                    className: 'Folder',
                    name: 'Node',
                },
            },
            idempotencyKey: 'rev-mismatch',
            deps,
        });

        expect(outcome.status).toBe(409);
        expect((outcome.body.conflict as Record<string, unknown>).reason).toBe('revision_mismatch');
        expect(deps.parseCommandSpy).not.toHaveBeenCalled();
        expect(deps.releaseLockSpy).not.toHaveBeenCalled();
    });

    it('returns locked conflict with machine-readable payload for single command', () => {
        const deps = createDefaultDeps();
        deps.acquireLockSpy.mockReturnValue({
            ok: false,
            conflict: {
                path: ['Workspace', 'LockedNode'],
                owner: 'idempotency:other-request',
                expiresAt: 1700000000000,
            },
        });

        const outcome = executeSingleAgentCommandFlow({
            requestBody: {
                command: {
                    op: 'create',
                    parentPath: ['Workspace'],
                    className: 'Folder',
                    name: 'LockedNode',
                },
            },
            idempotencyKey: 'single-locked',
            deps,
        });

        expect(outcome.status).toBe(423);
        expect(outcome.body.success).toBe(false);
        const result = outcome.body.result as Record<string, unknown>;
        const conflict = result.conflict as Record<string, unknown>;
        expect(conflict.reason).toBe('locked');
        expect(conflict.expected).toEqual({
            op: 'create',
            parentPath: ['Workspace'],
            name: 'LockedNode',
        });
        expect(conflict.actual).toEqual({
            lockPath: ['Workspace', 'LockedNode'],
            lockOwner: 'idempotency:other-request',
            lockExpiresAt: 1700000000000,
            currentRevision: 42,
        });
        expect(deps.recordLockContentionSpy).toHaveBeenCalledTimes(1);
        expect(deps.releaseLockSpy).not.toHaveBeenCalled();
    });

    it('maps not_found and validation conflicts to deterministic statuses', () => {
        const deps = createDefaultDeps();
        const runWithResult = (result: AgentCommandResult) => {
            deps.executeAgentCommandSpy.mockReturnValueOnce(result);
            return executeSingleAgentCommandFlow({
                requestBody: {
                    command: {
                        op: 'delete',
                        targetPath: ['Workspace', 'Target'],
                    },
                },
                idempotencyKey: `status-${result.conflict?.reason ?? 'success'}`,
                deps,
            });
        };

        const notFoundOutcome = runWithResult({
            index: 0,
            op: 'delete',
            success: false,
            conflict: {
                reason: 'not_found',
                expected: { op: 'delete', targetPath: ['Workspace', 'Target'] },
                actual: { targetPath: ['Workspace', 'Target'] },
            },
        });
        expect(notFoundOutcome.status).toBe(404);

        const validationOutcome = runWithResult({
            index: 0,
            op: 'update',
            success: false,
            conflict: {
                reason: 'validation_failed',
                expected: { op: 'update', property: 'Anchored' },
                actual: { field: 'value', expectedType: 'boolean' },
            },
        });
        expect(validationOutcome.status).toBe(400);
        expect((validationOutcome.body.result as Record<string, unknown>).conflict).toEqual({
            reason: 'validation_failed',
            expected: { op: 'update', property: 'Anchored' },
            actual: { field: 'value', expectedType: 'boolean' },
        });
        expect(deps.releaseLockSpy).toHaveBeenCalledTimes(2);
    });

    it('keeps locked conflict precedence in non-transactional batch flow', () => {
        const deps = createDefaultDeps();
        let acquireCall = 0;
        deps.acquireLockSpy.mockImplementation(() => {
            acquireCall += 1;
            if (acquireCall === 2) {
                return {
                    ok: false,
                    conflict: {
                        path: ['Workspace', 'Cmd2'],
                        owner: 'owner:other',
                        expiresAt: 1700000001000,
                    },
                };
            }
            return { ok: true };
        });

        deps.executeAgentCommandSpy.mockImplementation((command: AgentCommand, index: number): AgentCommandResult => {
            if (index === 0) {
                return { index, op: command.op, success: true, resolvedPath: ['Workspace', 'Cmd1'] };
            }
            return {
                index,
                op: command.op,
                success: false,
                conflict: {
                    reason: 'not_found',
                    expected: { op: command.op },
                    actual: { targetPath: ['Workspace', 'Cmd3'] },
                },
            };
        });

        const outcome = executeBatchAgentCommandFlow({
            requestBody: {
                continueOnError: true,
                commands: [
                    { op: 'create', parentPath: ['Workspace'], className: 'Folder', name: 'Cmd1' },
                    { op: 'create', parentPath: ['Workspace'], className: 'Folder', name: 'Cmd2' },
                    { op: 'delete', targetPath: ['Workspace', 'Cmd3'] },
                ],
            },
            idempotencyKey: 'batch-mixed',
            deps,
        });

        expect(outcome.status).toBe(423);
        expect(outcome.body.success).toBe(false);
        expect(outcome.body.total).toBe(3);
        expect(outcome.body.successCount).toBe(1);
        expect(outcome.body.failureCount).toBe(2);
        expect(outcome.body.rolledBack).toBe(false);
        expect(deps.recordLockContentionSpy).toHaveBeenCalledTimes(1);
        expect(deps.releaseLockSpy).toHaveBeenCalledTimes(1);
    });

    it('rolls back transactional batch on first failure and returns 409', () => {
        const deps = createDefaultDeps();
        deps.executeAgentCommandSpy.mockImplementation((command: AgentCommand, index: number): AgentCommandResult => {
            if (index === 0) {
                return { index, op: command.op, success: true, resolvedPath: ['Workspace', 'Tx1'] };
            }
            return {
                index,
                op: command.op,
                success: false,
                conflict: {
                    reason: 'validation_failed',
                    expected: { op: command.op, property: 'Name' },
                    actual: { field: 'name' },
                },
            };
        });

        const outcome = executeBatchAgentCommandFlow({
            requestBody: {
                transactional: true,
                commands: [
                    { op: 'create', parentPath: ['Workspace'], className: 'Folder', name: 'Tx1' },
                    { op: 'rename', targetPath: ['Workspace', 'Tx1'], name: '' },
                ],
            },
            idempotencyKey: 'batch-tx',
            deps,
        });

        expect(outcome.status).toBe(409);
        expect(outcome.body.success).toBe(false);
        expect(outcome.body.transactional).toBe(true);
        expect(outcome.body.rolledBack).toBe(true);
        expect(deps.createSnapshotSpy).toHaveBeenCalledTimes(1);
        expect(deps.restoreAfterRollbackSpy).toHaveBeenCalledTimes(1);
    });
});
