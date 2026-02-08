import { describe, expect, it } from 'vitest';
import { AgentLockManager } from '../src/agentLockManager';
import { buildConflict } from '../src/agentCommandResponse';
import {
    executeBatchAgentCommandFlow,
    executeSingleAgentCommandFlow,
    type AgentCommandApiDependencies,
} from '../src/agentCommandApi';
import { buildAgentPropertySchema } from '../src/agentPropertySchema';
import { SyncEngine } from '../src/syncEngine';
import { AgentTestManager } from '../src/agentTestManager';
import type { AgentCommand, AgentCommandResult, RobloxInstance, SyncMessage } from '../src/types';

function seededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function pickRandom<T>(items: T[], next: () => number): T {
    return items[Math.floor(next() * items.length)];
}

function isPrefix(prefix: string[], full: string[]): boolean {
    if (prefix.length > full.length) {
        return false;
    }
    for (let i = 0; i < prefix.length; i++) {
        if (prefix[i] !== full[i]) {
            return false;
        }
    }
    return true;
}

function cloneInstances(instances: RobloxInstance[]): RobloxInstance[] {
    return JSON.parse(JSON.stringify(instances)) as RobloxInstance[];
}

function createInitialInstances(): RobloxInstance[] {
    return [
        {
            id: 'workspace-1',
            className: 'Workspace',
            name: 'Workspace',
            parent: null,
            properties: { Name: 'Workspace' },
            children: [
                {
                    id: 'folder-a',
                    className: 'Folder',
                    name: 'FolderA',
                    parent: 'Workspace',
                    properties: { Name: 'FolderA' },
                    children: [
                        {
                            id: 'part-a1',
                            className: 'Part',
                            name: 'PartA1',
                            parent: 'Workspace.FolderA',
                            properties: {
                                Name: 'PartA1',
                                Anchored: false,
                                SourceAssetId: 0,
                            },
                            children: [],
                        },
                    ],
                },
                {
                    id: 'folder-b',
                    className: 'Folder',
                    name: 'FolderB',
                    parent: 'Workspace',
                    properties: { Name: 'FolderB' },
                    children: [],
                },
            ],
        },
    ];
}

function assertConvergedState(syncEngine: SyncEngine): void {
    const indexed = syncEngine.getIndexedInstances();
    const keySet = new Set<string>();

    for (const { path, instance } of indexed) {
        const key = `${path.join('.')}::${instance.id}`;
        expect(keySet.has(key)).toBe(false);
        keySet.add(key);

        expect(syncEngine.getPathById(instance.id)).toEqual(path);
        expect(syncEngine.getInstanceById(instance.id)?.id).toBe(instance.id);
        expect(syncEngine.getInstance(path)?.id).toBe(instance.id);

        if (path.length === 1) {
            expect(instance.parent ?? null).toBeNull();
        } else {
            const parentPath = path.slice(0, -1);
            expect(syncEngine.getInstance(parentPath)).toBeDefined();
            expect(instance.parent).toBe(parentPath.join('.'));
        }
    }
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function resolveTargetPath(syncEngine: SyncEngine, command: AgentCommand): string[] | null {
    const targetId = (command as { targetId?: unknown }).targetId;
    if (typeof targetId === 'string' && targetId.length > 0) {
        return syncEngine.getPathById(targetId) ?? null;
    }

    const targetPath = (command as { targetPath?: unknown }).targetPath;
    if (isStringArray(targetPath)) {
        return syncEngine.getInstance(targetPath) ? targetPath : null;
    }

    return null;
}

function resolveParentPath(syncEngine: SyncEngine, command: AgentCommand): string[] | null {
    const parentId = (command as { parentId?: unknown }).parentId;
    if (typeof parentId === 'string' && parentId.length > 0) {
        return syncEngine.getPathById(parentId) ?? null;
    }

    const parentPath = (command as { parentPath?: unknown }).parentPath;
    if (isStringArray(parentPath)) {
        if (parentPath.length === 0) {
            return [];
        }
        return syncEngine.getInstance(parentPath) ? parentPath : null;
    }

    return null;
}

function resolveNewParentPath(syncEngine: SyncEngine, command: AgentCommand): string[] | null {
    const newParentId = (command as { newParentId?: unknown }).newParentId;
    if (typeof newParentId === 'string' && newParentId.length > 0) {
        return syncEngine.getPathById(newParentId) ?? null;
    }

    const newParentPath = (command as { newParentPath?: unknown }).newParentPath;
    if (isStringArray(newParentPath)) {
        return syncEngine.getInstance(newParentPath) ? newParentPath : null;
    }

    return null;
}

function createSoakDeps(
    syncEngine: SyncEngine,
    lockManager: AgentLockManager,
): AgentCommandApiDependencies {
    let generatedId = 0;

    const executeAgentCommand = (command: AgentCommand, index: number): AgentCommandResult => {
        if (command.op === 'create') {
            const parentPath = resolveParentPath(syncEngine, command);
            if (!parentPath) {
                return {
                    index,
                    op: command.op,
                    success: false,
                    error: 'Parent not found',
                    conflict: buildConflict('not_found', command),
                };
            }
            if (typeof command.className !== 'string' || command.className.trim().length === 0) {
                return {
                    index,
                    op: command.op,
                    success: false,
                    error: 'Missing className',
                    conflict: buildConflict('validation_failed', command),
                };
            }
            if (typeof command.name !== 'string' || command.name.trim().length === 0) {
                return {
                    index,
                    op: command.op,
                    success: false,
                    error: 'Missing name',
                    conflict: buildConflict('validation_failed', command),
                };
            }

            const name = command.name.trim();
            const newId = `soak-${generatedId++}`;
            const instance: RobloxInstance = {
                id: newId,
                className: command.className.trim(),
                name,
                parent: parentPath.length > 0 ? parentPath.join('.') : null,
                properties: {
                    Name: name,
                    ...(command.properties ?? {}),
                },
                children: [],
            };

            const message: SyncMessage = {
                type: 'create',
                timestamp: Date.now(),
                path: [...parentPath, name],
                instance,
            };
            syncEngine.applyChange(message);
            return {
                index,
                op: command.op,
                success: true,
                resolvedId: newId,
                resolvedPath: message.path,
            };
        }

        if (command.op === 'update') {
            const targetPath = resolveTargetPath(syncEngine, command);
            if (!targetPath) {
                return {
                    index,
                    op: command.op,
                    success: false,
                    error: 'Target not found',
                    conflict: buildConflict('not_found', command),
                };
            }
            if (typeof command.property !== 'string' || command.property.trim().length === 0) {
                return {
                    index,
                    op: command.op,
                    success: false,
                    error: 'Missing property',
                    conflict: buildConflict('validation_failed', command),
                };
            }

            syncEngine.applyChange({
                type: 'update',
                timestamp: Date.now(),
                path: targetPath,
                property: {
                    name: command.property.trim(),
                    value: command.value,
                },
            });
            return {
                index,
                op: command.op,
                success: true,
                resolvedPath: targetPath,
            };
        }

        if (command.op === 'rename') {
            const targetPath = resolveTargetPath(syncEngine, command);
            if (!targetPath) {
                return {
                    index,
                    op: command.op,
                    success: false,
                    error: 'Target not found',
                    conflict: buildConflict('not_found', command),
                };
            }
            if (typeof command.name !== 'string' || command.name.trim().length === 0) {
                return {
                    index,
                    op: command.op,
                    success: false,
                    error: 'Missing name',
                    conflict: buildConflict('validation_failed', command),
                };
            }

            const target = syncEngine.getInstance(targetPath);
            const targetId = target?.id;
            syncEngine.applyChange({
                type: 'update',
                timestamp: Date.now(),
                path: targetPath,
                property: {
                    name: 'Name',
                    value: command.name.trim(),
                },
            });

            return {
                index,
                op: command.op,
                success: true,
                resolvedId: targetId,
                resolvedPath: targetId ? syncEngine.getPathById(targetId) ?? undefined : undefined,
            };
        }

        if (command.op === 'delete') {
            const targetPath = resolveTargetPath(syncEngine, command);
            if (!targetPath) {
                return {
                    index,
                    op: command.op,
                    success: false,
                    error: 'Target not found',
                    conflict: buildConflict('not_found', command),
                };
            }
            syncEngine.applyChange({
                type: 'delete',
                timestamp: Date.now(),
                path: targetPath,
            });
            return {
                index,
                op: command.op,
                success: true,
                resolvedPath: targetPath,
            };
        }

        if (command.op === 'reparent') {
            const targetPath = resolveTargetPath(syncEngine, command);
            const newParentPath = resolveNewParentPath(syncEngine, command);
            if (!targetPath || !newParentPath) {
                return {
                    index,
                    op: command.op,
                    success: false,
                    error: 'Target/new parent not found',
                    conflict: buildConflict('not_found', command),
                };
            }
            if (isPrefix(targetPath, newParentPath)) {
                return {
                    index,
                    op: command.op,
                    success: false,
                    error: 'Cannot reparent into descendant',
                    conflict: buildConflict('validation_failed', command),
                };
            }

            const target = syncEngine.getInstance(targetPath);
            const targetId = target?.id;
            syncEngine.applyChange({
                type: 'reparent',
                timestamp: Date.now(),
                path: targetPath,
                newParentPath,
            });

            return {
                index,
                op: command.op,
                success: true,
                resolvedId: targetId,
                resolvedPath: targetId ? syncEngine.getPathById(targetId) ?? undefined : undefined,
            };
        }

        return {
            index,
            op: command.op,
            success: false,
            error: 'Unsupported operation',
            conflict: buildConflict('validation_failed', command),
        };
    };

    return {
        validateBaseRevision: () => ({ ok: true }),
        parseCommand: payload => {
            if (!payload || typeof payload !== 'object') {
                return null;
            }
            const op = (payload as Record<string, unknown>).op;
            if (typeof op !== 'string') {
                return null;
            }
            return payload as AgentCommand;
        },
        createLockOwner: idempotencyKey => `soak:${idempotencyKey ?? 'none'}`,
        collectLockPaths: command => {
            if (command.op === 'create') {
                const parentPath = (command as { parentPath?: string[] }).parentPath;
                if (isStringArray(parentPath) && parentPath.length > 0) {
                    return [[...parentPath], [...parentPath, command.name]];
                }
                return [];
            }

            const targetPath = (command as { targetPath?: string[] }).targetPath;
            if (isStringArray(targetPath) && targetPath.length > 0) {
                if (command.op === 'reparent') {
                    const newParentPath = (command as { newParentPath?: string[] }).newParentPath;
                    if (isStringArray(newParentPath) && newParentPath.length > 0) {
                        return [[...targetPath], [...newParentPath]];
                    }
                }
                return [[...targetPath]];
            }
            return [];
        },
        acquireLock: (owner, paths) => lockManager.acquire(owner, paths),
        releaseLock: owner => lockManager.release(owner),
        executeAgentCommand,
        getRevision: () => syncEngine.getRevision(),
    };
}

function generateCommand(syncEngine: SyncEngine, next: () => number, index: number): AgentCommand {
    const indexed = syncEngine.getIndexedInstances();
    const mutable = indexed.filter(item => item.path.length > 1);
    const names = ['Node', 'Folder', 'Part', 'Script'];
    const classes = ['Folder', 'Part', 'Model', 'Script'];

    let operation = 'create';
    const roll = next();
    if (roll < 0.20) {
        operation = 'delete';
    } else if (roll < 0.45) {
        operation = 'rename';
    } else if (roll < 0.65) {
        operation = 'reparent';
    } else if (roll < 0.85) {
        operation = 'update';
    }

    if (mutable.length === 0 && operation !== 'create') {
        operation = 'create';
    }

    if (operation === 'create') {
        const parent = pickRandom(indexed, next);
        return {
            op: 'create',
            parentPath: parent.path,
            className: pickRandom(classes, next),
            name: `${pickRandom(names, next)}_${index % 10}`,
            properties: {},
        };
    }

    if (operation === 'update') {
        const target = pickRandom(mutable, next);
        const propertyName = next() < 0.5 ? 'Archivable' : 'SourceAssetId';
        const propertyValue = propertyName === 'Archivable'
            ? next() < 0.5
            : Math.floor(next() * 10000);
        return {
            op: 'update',
            targetPath: target.path,
            property: propertyName,
            value: propertyValue,
        };
    }

    if (operation === 'rename') {
        const target = pickRandom(mutable, next);
        return {
            op: 'rename',
            targetPath: target.path,
            name: `${pickRandom(names, next)}_${index % 7}`,
        };
    }

    if (operation === 'reparent') {
        const target = pickRandom(mutable, next);
        const parentCandidates = indexed.filter(candidate =>
            candidate.path.join('.') !== target.path.join('.')
            && !isPrefix(target.path, candidate.path),
        );

        if (parentCandidates.length === 0) {
            return {
                op: 'update',
                targetPath: target.path,
                property: 'Archivable',
                value: true,
            };
        }

        return {
            op: 'reparent',
            targetPath: target.path,
            newParentPath: pickRandom(parentCandidates, next).path,
        };
    }

    const target = pickRandom(mutable, next);
    return {
        op: 'delete',
        targetPath: target.path,
    };
}

describe('Agent System Soak', () => {
    it('remains convergent during long-running command churn and test queue activity', () => {
        const originalStdoutWrite = process.stdout.write.bind(process.stdout);
        const originalConsoleLog = console.log;
        process.stdout.write = (() => true) as typeof process.stdout.write;
        console.log = (() => undefined) as typeof console.log;

        try {
            const syncEngine = new SyncEngine();
            syncEngine.updateFromPlugin(createInitialInstances());

            const lockManager = new AgentLockManager(5000);
            const testManager = new AgentTestManager();
            const deps = createSoakDeps(syncEngine, lockManager);
            const random = seededRandom(0xA11CE55);

            const singleStatuses = new Set<number>();
            const batchStatuses = new Set<number>();

            for (let step = 0; step < 420; step++) {
                if (step % 12 === 0) {
                    const commands: AgentCommand[] = [];
                    for (let i = 0; i < 3; i++) {
                        commands.push(generateCommand(syncEngine, random, step + i));
                    }

                    const outcome = executeBatchAgentCommandFlow({
                        requestBody: {
                            continueOnError: true,
                            transactional: false,
                            commands,
                        },
                        idempotencyKey: `batch-${step}`,
                        deps,
                    });
                    batchStatuses.add(outcome.status);
                    expect([200, 207, 404, 423]).toContain(outcome.status);
                } else {
                    const command = generateCommand(syncEngine, random, step);
                    const outcome = executeSingleAgentCommandFlow({
                        requestBody: { command },
                        idempotencyKey: `single-${step}`,
                        deps,
                    });
                    singleStatuses.add(outcome.status);
                    expect([200, 400, 404, 423]).toContain(outcome.status);
                }

                if (step % 20 === 0) {
                    // Simulate plugin full sync loop.
                    syncEngine.updateFromPlugin(cloneInstances(syncEngine.getAllInstances()));
                }

                if (step % 25 === 0) {
                    const indexed = syncEngine.getIndexedInstances();
                    const schema = buildAgentPropertySchema(
                        indexed.map(item => item.instance),
                        syncEngine.getRevision(),
                    );
                    expect(schema.revision).toBe(syncEngine.getRevision());
                }

                if (step % 30 === 0) {
                    const run = testManager.enqueue({
                        name: `soak-run-${step}`,
                        safety: {
                            maxRetries: 0,
                        },
                    });
                    const dispatching = testManager.markDispatching(run.id);
                    expect(dispatching).toBeTruthy();
                    const running = testManager.markRunning(run.id);
                    expect(running).toBeTruthy();
                    const completed = testManager.complete(run.id, 'passed', 'ok', { step });
                    expect(completed?.status).toBe('passed');
                }

                if (step % 40 === 0) {
                    assertConvergedState(syncEngine);
                }
            }

            assertConvergedState(syncEngine);
            expect(testManager.getActiveRunId()).toBeNull();
            expect(singleStatuses.size).toBeGreaterThan(0);
            expect(batchStatuses.size).toBeGreaterThan(0);
        } finally {
            process.stdout.write = originalStdoutWrite as typeof process.stdout.write;
            console.log = originalConsoleLog;
        }
    });
});
