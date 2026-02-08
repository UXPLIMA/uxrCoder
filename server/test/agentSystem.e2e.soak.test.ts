import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentLockManager } from '../src/agentLockManager';
import { buildConflict } from '../src/agentCommandResponse';
import {
    executeBatchAgentCommandFlow,
    executeSingleAgentCommandFlow,
    type AgentCommandApiDependencies,
} from '../src/agentCommandApi';
import { AgentTestManager } from '../src/agentTestManager';
import { DATA_EXTENSIONS, FileMapper, SCRIPT_EXTENSIONS } from '../src/fileMapper';
import { SyncEngine } from '../src/syncEngine';
import type { AgentCommand, AgentCommandResult, RobloxInstance, SyncMessage } from '../src/types';
import { Watcher } from '../src/watcher';

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

function flattenTree(
    nodes: RobloxInstance[],
    parentPath: string[] = [],
    output: Array<{ path: string[]; instance: RobloxInstance }> = [],
): Array<{ path: string[]; instance: RobloxInstance }> {
    for (const node of nodes) {
        const nodePath = [...parentPath, node.name];
        output.push({ path: nodePath, instance: node });
        flattenTree(node.children ?? [], nodePath, output);
    }
    return output;
}

function assertConvergedState(syncEngine: SyncEngine): void {
    const indexed = syncEngine.getIndexedInstances();
    const treeFlat = flattenTree(syncEngine.getAllInstances());

    const indexedSet = new Set(indexed.map(({ path, instance }) => `${path.join('.')}::${instance.id}`));
    const treeSet = new Set(treeFlat.map(({ path, instance }) => `${path.join('.')}::${instance.id}`));
    expect(treeSet).toEqual(indexedSet);

    for (const { path: instancePath, instance } of indexed) {
        expect(syncEngine.getPathById(instance.id)).toEqual(instancePath);

        if (instancePath.length === 1) {
            expect(instance.parent ?? null).toBeNull();
            continue;
        }

        const parentPath = instancePath.slice(0, -1);
        expect(syncEngine.getInstance(parentPath)).toBeDefined();
        expect(instance.parent).toBe(parentPath.join('.'));
    }
}

function assertFilesystemConverged(
    fileMapper: FileMapper,
    indexed: Array<{ path: string[]; instance: RobloxInstance }>,
): void {
    const pathToClass = new Map<string, string>();
    for (const { path: instancePath, instance } of indexed) {
        pathToClass.set(instancePath.join('.'), instance.className);
    }

    const isScriptClass = (className: string): boolean =>
        className === 'Script' || className === 'LocalScript' || className === 'ModuleScript';

    const hasScriptAncestor = (instancePath: string[]): boolean => {
        for (let i = 1; i < instancePath.length; i++) {
            const ancestorPath = instancePath.slice(0, i).join('.');
            const ancestorClass = pathToClass.get(ancestorPath);
            if (ancestorClass && isScriptClass(ancestorClass)) {
                return true;
            }
        }
        return false;
    };

    for (const { path: instancePath, instance } of indexed) {
        if (hasScriptAncestor(instancePath)) {
            continue;
        }

        const fsPath = fileMapper.getFsPath(instancePath);

        const scriptExt = SCRIPT_EXTENSIONS[instance.className];
        if (scriptExt) {
            expect(fs.existsSync(fsPath + scriptExt)).toBe(true);
            continue;
        }

        const dataExt = DATA_EXTENSIONS[instance.className];
        if (dataExt) {
            expect(fs.existsSync(fsPath + dataExt)).toBe(true);
            continue;
        }

        expect(fs.existsSync(fsPath)).toBe(true);
        expect(fs.existsSync(path.join(fsPath, 'init.meta.json'))).toBe(true);
    }
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
                            id: 'script-a',
                            className: 'Script',
                            name: 'ScriptA',
                            parent: 'Workspace.FolderA',
                            properties: {
                                Name: 'ScriptA',
                                Source: '-- initial A',
                            },
                            children: [],
                        },
                        {
                            id: 'part-a1',
                            className: 'Part',
                            name: 'PartA1',
                            parent: 'Workspace.FolderA',
                            properties: {
                                Name: 'PartA1',
                                Anchored: true,
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
                    children: [
                        {
                            id: 'script-b',
                            className: 'Script',
                            name: 'ScriptB',
                            parent: 'Workspace.FolderB',
                            properties: {
                                Name: 'ScriptB',
                                Source: '-- initial B',
                            },
                            children: [],
                        },
                    ],
                },
            ],
        },
    ];
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

function createE2ESoakDeps(params: {
    syncEngine: SyncEngine;
    lockManager: AgentLockManager;
    applyEditorChange: (change: SyncMessage) => SyncMessage;
}): AgentCommandApiDependencies {
    const { syncEngine, lockManager, applyEditorChange } = params;
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
            const className = command.className.trim();
            const id = `e2e-soak-${generatedId++}`;
            const instance: RobloxInstance = {
                id,
                className,
                name,
                parent: parentPath.length > 0 ? parentPath.join('.') : null,
                properties: {
                    Name: name,
                    ...(command.properties ?? {}),
                },
                children: [],
            };

            if (className === 'Script' || className === 'LocalScript' || className === 'ModuleScript') {
                if (typeof instance.properties.Source !== 'string') {
                    instance.properties.Source = `-- generated ${id}`;
                }
            }

            const message = applyEditorChange({
                type: 'create',
                timestamp: Date.now(),
                path: [...parentPath, name],
                instance,
            });

            return {
                index,
                op: command.op,
                success: true,
                resolvedId: id,
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

            applyEditorChange({
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

            const targetId = syncEngine.getInstance(targetPath)?.id;
            applyEditorChange({
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
            applyEditorChange({
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

            const targetId = syncEngine.getInstance(targetPath)?.id;
            applyEditorChange({
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
        createLockOwner: idempotencyKey => `e2e-soak:${idempotencyKey ?? 'none'}`,
        collectLockPaths: command => {
            if (command.op === 'create') {
                const parentPath = resolveParentPath(syncEngine, command);
                if (parentPath && parentPath.length > 0) {
                    return [[...parentPath], [...parentPath, command.name]];
                }
                return [];
            }

            const targetPath = resolveTargetPath(syncEngine, command);
            if (targetPath && targetPath.length > 0) {
                if (command.op === 'reparent') {
                    const newParentPath = resolveNewParentPath(syncEngine, command);
                    if (newParentPath && newParentPath.length > 0) {
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
    const classes = ['Folder', 'Part', 'Model', 'Script', 'ModuleScript'];

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
        const className = pickRandom(classes, next);
        const name = `${pickRandom(names, next)}_${index % 12}`;
        const properties: Record<string, unknown> = {};
        if (className === 'Script' || className === 'ModuleScript') {
            properties.Source = `-- source ${index}`;
        }
        return {
            op: 'create',
            parentPath: parent.path,
            className,
            name,
            properties,
        };
    }

    if (operation === 'update') {
        const target = pickRandom(mutable, next);
        const isScript = target.instance.className === 'Script'
            || target.instance.className === 'LocalScript'
            || target.instance.className === 'ModuleScript';
        if (isScript && next() < 0.5) {
            return {
                op: 'update',
                targetPath: target.path,
                property: 'Source',
                value: `-- churn ${index}`,
            };
        }
        return {
            op: 'update',
            targetPath: target.path,
            property: 'Archivable',
            value: next() < 0.5,
        };
    }

    if (operation === 'rename') {
        const target = pickRandom(mutable, next);
        return {
            op: 'rename',
            targetPath: target.path,
            name: `${pickRandom(names, next)}_${index % 8}`,
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

describe('Agent System End-to-End Soak', () => {
    let workspaceRoot: string;

    beforeEach(() => {
        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uxr-agent-e2e-soak-'));
    });

    afterEach(() => {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
    });

    it('keeps command flows, filesystem sync, watcher ingestion, and test queue converged under churn', async () => {
        const originalStdoutWrite = process.stdout.write.bind(process.stdout);
        const originalConsoleLog = console.log;
        process.stdout.write = (() => true) as typeof process.stdout.write;
        console.log = (() => undefined) as typeof console.log;

        try {
            const syncEngine = new SyncEngine();
            const fileMapper = new FileMapper(workspaceRoot, null);
            fileMapper.setSyncEngine(syncEngine);
            const watcher = new Watcher(workspaceRoot, syncEngine, fileMapper);
            const lockManager = new AgentLockManager(5000);
            const testManager = new AgentTestManager();
            const random = seededRandom(0xE2E50A);

            syncEngine.updateFromPlugin(createInitialInstances());
            fileMapper.syncAllToFiles(syncEngine.getAllInstances());

            const applyEditorChange = (change: SyncMessage): SyncMessage => {
                syncEngine.applyChange(change);
                fileMapper.syncToFiles(change);
                return change;
            };

            const deps = createE2ESoakDeps({
                syncEngine,
                lockManager,
                applyEditorChange,
            });

            let watcherAppliedUpdates = 0;
            let testRunsCompleted = 0;

            for (let step = 0; step < 260; step++) {
                const roll = random();

                if (roll < 0.65) {
                    if (step % 9 === 0) {
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
                            idempotencyKey: `e2e-batch-${step}`,
                            deps,
                        });
                        expect([200, 207, 404, 423]).toContain(outcome.status);
                    } else {
                        const command = generateCommand(syncEngine, random, step);
                        const outcome = executeSingleAgentCommandFlow({
                            requestBody: { command },
                            idempotencyKey: `e2e-single-${step}`,
                            deps,
                        });
                        expect([200, 400, 404, 423]).toContain(outcome.status);
                    }
                } else if (roll < 0.88) {
                    const scriptNodes = syncEngine
                        .getIndexedInstances()
                        .filter(({ instance }) =>
                            instance.className === 'Script'
                            || instance.className === 'LocalScript'
                            || instance.className === 'ModuleScript',
                        );

                    if (scriptNodes.length > 0) {
                        const target = pickRandom(scriptNodes, random);
                        const ext = SCRIPT_EXTENSIONS[target.instance.className] ?? '.lua';
                        const scriptPath = fileMapper.getFsPath(target.path) + ext;
                        fs.writeFileSync(scriptPath, `-- watcher-update ${step}`, 'utf-8');
                        await (watcher as any).handleFileChange('update', scriptPath);
                        watcherAppliedUpdates += 1;
                    }
                } else {
                    const run = testManager.enqueue({
                        name: `e2e-soak-run-${step}`,
                        safety: {
                            maxRetries: 1,
                            retryDelayMs: 0,
                        },
                    });
                    const dispatching = testManager.markDispatching(run.id);
                    expect(dispatching).toBeTruthy();
                    const running = testManager.markRunning(run.id);
                    expect(running).toBeTruthy();

                    if (step % 5 === 0 && testManager.canRetry(run.id)) {
                        const retried = testManager.queueRetry(run.id, `retry-${step}`);
                        expect(retried?.status).toBe('queued');
                        const dispatchingRetry = testManager.markDispatching(run.id);
                        expect(dispatchingRetry).toBeTruthy();
                        const runningRetry = testManager.markRunning(run.id);
                        expect(runningRetry).toBeTruthy();
                    }

                    const completed = testManager.complete(run.id, 'passed', 'ok', { step });
                    expect(completed?.status).toBe('passed');
                    testRunsCompleted += 1;
                }

                if (step % 20 === 0) {
                    syncEngine.updateFromPlugin(cloneInstances(syncEngine.getAllInstances()));
                    fileMapper.syncAllToFiles(syncEngine.getAllInstances());
                }

                if (step % 30 === 0) {
                    assertConvergedState(syncEngine);
                    assertFilesystemConverged(fileMapper, syncEngine.getIndexedInstances());
                }
            }

            assertConvergedState(syncEngine);
            assertFilesystemConverged(fileMapper, syncEngine.getIndexedInstances());
            expect(watcherAppliedUpdates).toBeGreaterThan(0);
            expect(testRunsCompleted).toBeGreaterThan(0);
            expect(testManager.getActiveRunId()).toBeNull();
        } finally {
            process.stdout.write = originalStdoutWrite as typeof process.stdout.write;
            console.log = originalConsoleLog;
        }
    });
});
