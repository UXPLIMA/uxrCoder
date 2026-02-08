import { describe, expect, it } from 'vitest';
import { AgentIdempotencyCache } from '../src/agentIdempotencyCache';
import { executeIdempotentRequest } from '../src/agentIdempotentExecutor';
import { SyncEngine } from '../src/syncEngine';
import type { RobloxInstance, SyncMessage } from '../src/types';

function createSeededSyncEngine(): SyncEngine {
    const syncEngine = new SyncEngine();
    const initial: RobloxInstance[] = [
        {
            id: 'workspace-root',
            className: 'Workspace',
            name: 'Workspace',
            parent: null,
            properties: {},
            children: [],
        },
    ];
    syncEngine.updateFromPlugin(initial);
    return syncEngine;
}

function countPath(syncEngine: SyncEngine, exactPath: string): number {
    return syncEngine
        .getIndexedInstances()
        .filter(item => item.path.join('.') === exactPath)
        .length;
}

describe('Idempotent request executor acceptance', () => {
    it('prevents duplicate create side effects on retry with same key', () => {
        const syncEngine = createSeededSyncEngine();
        const cache = new AgentIdempotencyCache();
        let sideEffects = 0;

        const runCreate = () => executeIdempotentRequest({
            idempotencyKey: 'retry-create-key',
            getCached: key => cache.get(key),
            cache: (key, status, body) => cache.set(key, status, body),
            execute: () => {
                sideEffects += 1;
                const createMessage: SyncMessage = {
                    type: 'create',
                    timestamp: Date.now(),
                    path: ['Workspace', 'RetryCreatedFolder'],
                    instance: {
                        id: 'retry-folder-id',
                        className: 'Folder',
                        name: 'RetryCreatedFolder',
                        parent: 'Workspace',
                        properties: {},
                        children: [],
                    },
                };
                syncEngine.applyChange(createMessage);
                return {
                    status: 200,
                    body: {
                        success: true,
                        revision: syncEngine.getRevision(),
                        path: createMessage.path,
                    },
                };
            },
        });

        const first = runCreate();
        const second = runCreate();

        expect(first.cached).toBe(false);
        expect(second.cached).toBe(true);
        expect(second).toEqual({
            status: first.status,
            body: first.body,
            cached: true,
        });
        expect(sideEffects).toBe(1);
        expect(countPath(syncEngine, 'Workspace.RetryCreatedFolder')).toBe(1);
    });

    it('does not deduplicate when idempotency key is missing', () => {
        const syncEngine = createSeededSyncEngine();
        const cache = new AgentIdempotencyCache();
        let sideEffects = 0;

        const runCreateWithoutKey = () => executeIdempotentRequest({
            idempotencyKey: null,
            getCached: key => cache.get(key),
            cache: (key, status, body) => cache.set(key, status, body),
            execute: () => {
                sideEffects += 1;
                const createMessage: SyncMessage = {
                    type: 'create',
                    timestamp: Date.now(),
                    path: ['Workspace', 'NoKeyFolder'],
                    instance: {
                        id: `nokey-folder-id-${sideEffects}`,
                        className: 'Folder',
                        name: 'NoKeyFolder',
                        parent: 'Workspace',
                        properties: {},
                        children: [],
                    },
                };
                syncEngine.applyChange(createMessage);
                return {
                    status: 200,
                    body: { success: true, revision: syncEngine.getRevision() },
                };
            },
        });

        runCreateWithoutKey();
        runCreateWithoutKey();

        expect(sideEffects).toBe(2);
        expect(countPath(syncEngine, 'Workspace.NoKeyFolder')).toBe(1);
        expect(countPath(syncEngine, 'Workspace.NoKeyFolder_2')).toBe(1);
    });

    it('caches failed responses to avoid repeated failing side effects', () => {
        const cache = new AgentIdempotencyCache();
        let executeCalls = 0;
        const mutationJournal: string[] = [];

        const runFailingRequest = () => executeIdempotentRequest({
            idempotencyKey: 'retry-fail-key',
            getCached: key => cache.get(key),
            cache: (key, status, body) => cache.set(key, status, body),
            execute: () => {
                executeCalls += 1;
                mutationJournal.push(`attempt-${executeCalls}`);
                return {
                    status: 423,
                    body: {
                        success: false,
                        error: 'Operation locked by another active command',
                    },
                };
            },
        });

        const first = runFailingRequest();
        const second = runFailingRequest();

        expect(first.status).toBe(423);
        expect(second.status).toBe(423);
        expect(second.cached).toBe(true);
        expect(executeCalls).toBe(1);
        expect(mutationJournal).toEqual(['attempt-1']);
    });

    it('applies new side effects when idempotency key changes', () => {
        const syncEngine = createSeededSyncEngine();
        const cache = new AgentIdempotencyCache();

        const runWithKey = (key: string, idSuffix: string) => executeIdempotentRequest({
            idempotencyKey: key,
            getCached: requestKey => cache.get(requestKey),
            cache: (requestKey, status, body) => cache.set(requestKey, status, body),
            execute: () => {
                const createMessage: SyncMessage = {
                    type: 'create',
                    timestamp: Date.now(),
                    path: ['Workspace', 'ScopedFolder'],
                    instance: {
                        id: `scoped-folder-${idSuffix}`,
                        className: 'Folder',
                        name: 'ScopedFolder',
                        parent: 'Workspace',
                        properties: {},
                        children: [],
                    },
                };
                syncEngine.applyChange(createMessage);
                return {
                    status: 200,
                    body: { success: true, revision: syncEngine.getRevision() },
                };
            },
        });

        runWithKey('scope-key-a', 'a');
        runWithKey('scope-key-a', 'a-retry');
        runWithKey('scope-key-b', 'b');

        expect(countPath(syncEngine, 'Workspace.ScopedFolder')).toBe(1);
        expect(countPath(syncEngine, 'Workspace.ScopedFolder_2')).toBe(1);
    });
});
