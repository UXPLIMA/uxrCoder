import { buildConflict, statusForAgentResult } from './agentCommandResponse';
import type { AgentPathLockConflict } from './agentLockManager';
import type { AgentCommand, AgentCommandResult } from './types';

export type AgentRevisionValidation =
    | { ok: true }
    | { ok: false; status: number; body: Record<string, unknown> };

export interface AgentCommandApiDependencies {
    validateBaseRevision: () => AgentRevisionValidation;
    parseCommand: (payload: unknown) => AgentCommand | null;
    createLockOwner: (idempotencyKey: string | null) => string;
    collectLockPaths: (command: AgentCommand) => string[][];
    acquireLock: (owner: string, paths: string[][]) => { ok: true } | { ok: false; conflict: AgentPathLockConflict };
    releaseLock: (owner: string) => void;
    executeAgentCommand: (command: AgentCommand, index: number) => AgentCommandResult;
    getRevision: () => number;
    recordLockContention?: (
        owner: string,
        command: AgentCommand,
        requestedPaths: string[][],
        conflict: AgentPathLockConflict,
    ) => void;
    createSnapshot?: () => unknown;
    restoreAfterRollback?: (snapshot: unknown) => void;
}

function createLockedResult(
    index: number,
    command: AgentCommand,
    conflict: AgentPathLockConflict,
    currentRevision: number,
): AgentCommandResult {
    return {
        index,
        op: command.op,
        success: false,
        error: 'Operation locked by another active command',
        conflict: buildConflict('locked', command, {
            lockPath: conflict.path,
            lockOwner: conflict.owner,
            lockExpiresAt: conflict.expiresAt,
            currentRevision,
        }),
    };
}

export function executeSingleAgentCommandFlow(params: {
    requestBody: unknown;
    idempotencyKey: string | null;
    deps: AgentCommandApiDependencies;
}): { status: number; body: Record<string, unknown> } {
    const { requestBody, idempotencyKey, deps } = params;
    const bodyRecord = (requestBody && typeof requestBody === 'object')
        ? requestBody as Record<string, unknown>
        : {};

    const revisionValidation = deps.validateBaseRevision();
    if (revisionValidation.ok === false) {
        return { status: revisionValidation.status, body: revisionValidation.body };
    }

    const commandPayload = bodyRecord.command ?? bodyRecord;
    const command = deps.parseCommand(commandPayload);
    if (!command) {
        return {
            status: 400,
            body: { success: false, error: 'Invalid command payload' },
        };
    }

    const lockOwner = deps.createLockOwner(idempotencyKey);
    const lockPaths = deps.collectLockPaths(command);
    const lockAcquire = deps.acquireLock(lockOwner, lockPaths);
    if (lockAcquire.ok === false) {
        deps.recordLockContention?.(lockOwner, command, lockPaths, lockAcquire.conflict);
        const result = createLockedResult(0, command, lockAcquire.conflict, deps.getRevision());
        return {
            status: 423,
            body: { success: false, result, revision: deps.getRevision() },
        };
    }

    let result: AgentCommandResult;
    try {
        result = deps.executeAgentCommand(command, 0);
    } finally {
        deps.releaseLock(lockOwner);
    }

    if (!result.success) {
        return {
            status: statusForAgentResult(result),
            body: { success: false, result, revision: deps.getRevision() },
        };
    }

    return {
        status: 200,
        body: {
            success: true,
            revision: deps.getRevision(),
            result,
        },
    };
}

export function executeBatchAgentCommandFlow(params: {
    requestBody: unknown;
    idempotencyKey: string | null;
    deps: AgentCommandApiDependencies;
}): { status: number; body: Record<string, unknown> } {
    const { requestBody, idempotencyKey, deps } = params;
    const bodyRecord = (requestBody && typeof requestBody === 'object')
        ? requestBody as Record<string, unknown>
        : {};

    const revisionValidation = deps.validateBaseRevision();
    if (revisionValidation.ok === false) {
        return { status: revisionValidation.status, body: revisionValidation.body };
    }

    const rawCommands = bodyRecord.commands;
    const transactional = bodyRecord.transactional === true;
    const continueOnError = transactional ? false : bodyRecord.continueOnError === true;

    if (!Array.isArray(rawCommands)) {
        return {
            status: 400,
            body: { success: false, error: 'Invalid request: commands must be an array' },
        };
    }

    const snapshot = transactional ? deps.createSnapshot?.() ?? null : null;
    const results: AgentCommandResult[] = [];
    const lockOwner = deps.createLockOwner(idempotencyKey);

    try {
        for (let i = 0; i < rawCommands.length; i++) {
            const parsed = deps.parseCommand(rawCommands[i]);
            if (!parsed) {
                results.push({
                    index: i,
                    op: 'update',
                    success: false,
                    error: 'Invalid command at index ' + i,
                });
                if (!continueOnError) {
                    break;
                }
                continue;
            }

            const lockPaths = deps.collectLockPaths(parsed);
            const lockAcquire = deps.acquireLock(lockOwner, lockPaths);
            if (lockAcquire.ok === false) {
                deps.recordLockContention?.(lockOwner, parsed, lockPaths, lockAcquire.conflict);
                const lockResult = createLockedResult(i, parsed, lockAcquire.conflict, deps.getRevision());
                results.push(lockResult);
                if (!continueOnError) {
                    break;
                }
                continue;
            }

            const result = deps.executeAgentCommand(parsed, i);
            results.push(result);

            if (!result.success && !continueOnError) {
                break;
            }
        }
    } finally {
        deps.releaseLock(lockOwner);
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;
    const hasFailures = failureCount > 0;
    let rolledBack = false;

    if (transactional && hasFailures && snapshot && deps.restoreAfterRollback) {
        deps.restoreAfterRollback(snapshot);
        rolledBack = true;
    }

    const success = !hasFailures;
    const hasLockedConflict = results.some(r => r.conflict?.reason === 'locked');
    const hasNotFoundConflict = results.some(r => r.conflict?.reason === 'not_found');
    const status = success
        ? 200
        : transactional
            ? 409
            : hasLockedConflict
                ? 423
                : hasNotFoundConflict
                    ? 404
                    : 207;

    return {
        status,
        body: {
            success,
            revision: deps.getRevision(),
            total: results.length,
            successCount,
            failureCount,
            transactional,
            rolledBack,
            results,
        },
    };
}
