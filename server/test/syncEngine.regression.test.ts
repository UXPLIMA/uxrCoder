import { beforeEach, describe, expect, it } from 'vitest';
import { SyncEngine } from '../src/syncEngine';
import type { RobloxInstance } from '../src/types';

function flattenTree(
    nodes: RobloxInstance[],
    parentPath: string[] = [],
    output: Array<{ path: string[]; instance: RobloxInstance }> = [],
): Array<{ path: string[]; instance: RobloxInstance }> {
    for (const node of nodes) {
        const path = [...parentPath, node.name];
        output.push({ path, instance: node });
        flattenTree(node.children ?? [], path, output);
    }
    return output;
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

function assertConvergedState(syncEngine: SyncEngine): void {
    const indexed = syncEngine.getIndexedInstances();
    const treeFlat = flattenTree(syncEngine.getAllInstances());

    const indexedKeys = indexed.map(({ path, instance }) => `${path.join('.')}::${instance.id}`);
    const treeKeys = treeFlat.map(({ path, instance }) => `${path.join('.')}::${instance.id}`);

    const indexedSet = new Set(indexedKeys);
    const treeSet = new Set(treeKeys);

    expect(indexedKeys.length).toBe(indexedSet.size);
    expect(treeKeys.length).toBe(treeSet.size);
    expect(treeSet).toEqual(indexedSet);

    for (const { path, instance } of indexed) {
        const resolved = syncEngine.getPathById(instance.id);
        expect(resolved).toEqual(path);

        if (path.length === 1) {
            expect(instance.parent ?? null).toBeNull();
            continue;
        }

        const parentPath = path.slice(0, -1);
        expect(syncEngine.getInstance(parentPath)).toBeDefined();
        expect(instance.parent).toBe(parentPath.join('.'));
    }
}

describe('SyncEngine Regression Coverage', () => {
    let syncEngine: SyncEngine;

    beforeEach(() => {
        syncEngine = new SyncEngine();

        const instances: RobloxInstance[] = [
            {
                id: 'workspace-1',
                className: 'Workspace',
                name: 'Workspace',
                parent: null,
                properties: {},
                children: [
                    {
                        id: 'folder-a',
                        className: 'Folder',
                        name: 'FolderA',
                        parent: 'Workspace',
                        properties: {},
                        children: [
                            {
                                id: 'part-1',
                                className: 'Part',
                                name: 'Part1',
                                parent: 'Workspace.FolderA',
                                properties: { Anchored: false },
                                children: [],
                            },
                        ],
                    },
                ],
            },
        ];

        syncEngine.updateFromPlugin(instances);
    });

    it('re-indexes descendants when Name is updated', () => {
        syncEngine.applyChange({
            type: 'update',
            timestamp: Date.now(),
            path: ['Workspace', 'FolderA'],
            property: { name: 'Name', value: 'FolderRenamed' },
        });

        expect(syncEngine.getInstance(['Workspace', 'FolderA'])).toBeUndefined();
        expect(syncEngine.getInstance(['Workspace', 'FolderRenamed'])).toBeDefined();
        expect(syncEngine.getInstance(['Workspace', 'FolderRenamed', 'Part1'])).toBeDefined();
    });

    it('keeps different property updates as separate pending changes', () => {
        syncEngine.applyChange({
            type: 'update',
            timestamp: Date.now(),
            path: ['Workspace', 'FolderA', 'Part1'],
            property: { name: 'Anchored', value: true },
        });

        syncEngine.applyChange({
            type: 'update',
            timestamp: Date.now(),
            path: ['Workspace', 'FolderA', 'Part1'],
            property: { name: 'Transparency', value: 0.5 },
        });

        const pending = syncEngine.getPendingChangesForPlugin().filter(c => c.type === 'update');
        expect(pending).toHaveLength(2);
    });

    it('coalesces repeated updates for the same property to the latest value', () => {
        syncEngine.applyChange({
            type: 'update',
            timestamp: Date.now(),
            path: ['Workspace', 'FolderA', 'Part1'],
            property: { name: 'Anchored', value: true },
        });

        syncEngine.applyChange({
            type: 'update',
            timestamp: Date.now(),
            path: ['Workspace', 'FolderA', 'Part1'],
            property: { name: 'Anchored', value: false },
        });

        const pending = syncEngine.getPendingChangesForPlugin().filter(c => c.type === 'update');
        expect(pending).toHaveLength(1);
        expect(pending[0].property?.name).toBe('Anchored');
        expect(pending[0].property?.value).toBe(false);
    });

    it('keeps existing instance when create collides on sibling name', () => {
        syncEngine.applyChange({
            type: 'create',
            timestamp: Date.now(),
            path: ['Workspace', 'FolderA', 'Part1'],
            instance: {
                id: 'part-2',
                className: 'Part',
                name: 'Part1',
                parent: 'Workspace.FolderA',
                properties: {},
                children: [],
            },
        });

        const original = syncEngine.getInstance(['Workspace', 'FolderA', 'Part1']);
        const renamed = syncEngine.getInstance(['Workspace', 'FolderA', 'Part1_2']);

        expect(original).toBeDefined();
        expect(original?.id).toBe('part-1');
        expect(renamed).toBeDefined();
        expect(renamed?.id).toBe('part-2');

        const createChange = syncEngine.getPendingChangesForPlugin().find(c => c.type === 'create');
        expect(createChange?.path).toEqual(['Workspace', 'FolderA', 'Part1_2']);
    });

    it('allocates numeric collision suffixes without chaining', () => {
        syncEngine.applyChange({
            type: 'create',
            timestamp: Date.now(),
            path: ['Workspace', 'Node'],
            instance: {
                id: 'node-1',
                className: 'Folder',
                name: 'Node',
                parent: 'Workspace',
                properties: {},
                children: [],
            },
        });

        syncEngine.applyChange({
            type: 'create',
            timestamp: Date.now(),
            path: ['Workspace', 'Node'],
            instance: {
                id: 'node-2',
                className: 'Folder',
                name: 'Node',
                parent: 'Workspace',
                properties: {},
                children: [],
            },
        });

        syncEngine.applyChange({
            type: 'create',
            timestamp: Date.now(),
            path: ['Workspace', 'Node_2'],
            instance: {
                id: 'node-3',
                className: 'Folder',
                name: 'Node_2',
                parent: 'Workspace',
                properties: {},
                children: [],
            },
        });

        expect(syncEngine.getInstance(['Workspace', 'Node'])).toBeDefined();
        expect(syncEngine.getInstance(['Workspace', 'Node_2'])).toBeDefined();
        expect(syncEngine.getInstance(['Workspace', 'Node_3'])).toBeDefined();
        expect(syncEngine.getInstance(['Workspace', 'Node_2_2'])).toBeUndefined();
    });

    it('does not index orphan create when parent path is missing', () => {
        const beforeCount = syncEngine.getIndexedInstances().length;

        syncEngine.applyChange({
            type: 'create',
            timestamp: Date.now(),
            path: ['Workspace', 'MissingFolder', 'OrphanPart'],
            instance: {
                id: 'orphan-1',
                className: 'Part',
                name: 'OrphanPart',
                parent: 'Workspace.MissingFolder',
                properties: {},
                children: [],
            },
        });

        expect(syncEngine.getInstance(['Workspace', 'MissingFolder', 'OrphanPart'])).toBeUndefined();
        expect(syncEngine.getIndexedInstances().length).toBe(beforeCount);
        assertConvergedState(syncEngine);
    });

    it('writes resolved unique name back to pending Name update', () => {
        syncEngine.applyChange({
            type: 'create',
            timestamp: Date.now(),
            path: ['Workspace', 'FolderA', 'Part2'],
            instance: {
                id: 'part-2',
                className: 'Part',
                name: 'Part2',
                parent: 'Workspace.FolderA',
                properties: {},
                children: [],
            },
        });

        syncEngine.applyChange({
            type: 'update',
            timestamp: Date.now(),
            path: ['Workspace', 'FolderA', 'Part2'],
            property: { name: 'Name', value: 'Part1' },
        });

        expect(syncEngine.getInstance(['Workspace', 'FolderA', 'Part1_2'])).toBeDefined();
        expect(syncEngine.getInstance(['Workspace', 'FolderA', 'Part2'])).toBeUndefined();

        const nameUpdate = syncEngine
            .getPendingChangesForPlugin()
            .find(c => c.type === 'update' && c.property?.name === 'Name');

        expect(nameUpdate).toBeDefined();
        expect(nameUpdate?.property?.value).toBe('Part1_2');
    });

    it('resolves updated path by id after rename', () => {
        const before = syncEngine.getInstance(['Workspace', 'FolderA', 'Part1']);
        expect(before).toBeDefined();
        const id = before!.id;

        syncEngine.applyChange({
            type: 'update',
            timestamp: Date.now(),
            path: ['Workspace', 'FolderA', 'Part1'],
            property: { name: 'Name', value: 'PartRenamed' },
        });

        const resolvedPath = syncEngine.getPathById(id);
        expect(resolvedPath).toEqual(['Workspace', 'FolderA', 'PartRenamed']);
        expect(syncEngine.getInstanceById(id)?.name).toBe('PartRenamed');
    });

    it('resolves updated path by id after reparent', () => {
        const before = syncEngine.getInstance(['Workspace', 'FolderA', 'Part1']);
        expect(before).toBeDefined();
        const id = before!.id;

        syncEngine.applyChange({
            type: 'create',
            timestamp: Date.now(),
            path: ['Workspace', 'FolderB'],
            instance: {
                id: 'folder-b',
                className: 'Folder',
                name: 'FolderB',
                parent: 'Workspace',
                properties: {},
                children: [],
            },
        });

        syncEngine.applyChange({
            type: 'reparent',
            timestamp: Date.now(),
            path: ['Workspace', 'FolderA', 'Part1'],
            newParentPath: ['Workspace', 'FolderB'],
        });

        const resolvedPath = syncEngine.getPathById(id);
        expect(resolvedPath).toEqual(['Workspace', 'FolderB', 'Part1']);
        expect(syncEngine.getInstanceById(id)?.parent).toBe('Workspace.FolderB');
    });

    it('removes id lookup entries after delete', () => {
        const before = syncEngine.getInstance(['Workspace', 'FolderA', 'Part1']);
        expect(before).toBeDefined();
        const id = before!.id;

        syncEngine.applyChange({
            type: 'delete',
            timestamp: Date.now(),
            path: ['Workspace', 'FolderA', 'Part1'],
        });

        expect(syncEngine.getPathById(id)).toBeUndefined();
        expect(syncEngine.getInstanceById(id)).toBeUndefined();
    });

    it('uses stable numeric suffixing when reparent destination collides with generated names', () => {
        syncEngine.applyChange({
            type: 'create',
            timestamp: Date.now(),
            path: ['Workspace', 'Dest'],
            instance: {
                id: 'dest',
                className: 'Folder',
                name: 'Dest',
                parent: 'Workspace',
                properties: {},
                children: [],
            },
        });
        syncEngine.applyChange({
            type: 'create',
            timestamp: Date.now(),
            path: ['Workspace', 'Source'],
            instance: {
                id: 'source',
                className: 'Folder',
                name: 'Source',
                parent: 'Workspace',
                properties: {},
                children: [],
            },
        });

        syncEngine.applyChange({
            type: 'create',
            timestamp: Date.now(),
            path: ['Workspace', 'Dest', 'Folder'],
            instance: {
                id: 'dest-folder-1',
                className: 'Folder',
                name: 'Folder',
                parent: 'Workspace.Dest',
                properties: {},
                children: [],
            },
        });
        syncEngine.applyChange({
            type: 'create',
            timestamp: Date.now(),
            path: ['Workspace', 'Dest', 'Folder_2'],
            instance: {
                id: 'dest-folder-2',
                className: 'Folder',
                name: 'Folder_2',
                parent: 'Workspace.Dest',
                properties: {},
                children: [],
            },
        });
        syncEngine.applyChange({
            type: 'create',
            timestamp: Date.now(),
            path: ['Workspace', 'Source', 'Folder_2'],
            instance: {
                id: 'source-folder',
                className: 'Folder',
                name: 'Folder_2',
                parent: 'Workspace.Source',
                properties: {},
                children: [],
            },
        });

        syncEngine.applyChange({
            type: 'reparent',
            timestamp: Date.now(),
            path: ['Workspace', 'Source', 'Folder_2'],
            newParentPath: ['Workspace', 'Dest'],
        });

        expect(syncEngine.getInstance(['Workspace', 'Dest', 'Folder_3'])?.id).toBe('source-folder');
        expect(syncEngine.getInstance(['Workspace', 'Dest', 'Folder_2_2'])).toBeUndefined();

        const reparentChange = syncEngine
            .getPendingChangesForPlugin()
            .find(change => change.type === 'reparent' && change.path.join('.') === 'Workspace.Source.Folder_2');
        expect(reparentChange).toBeDefined();
        if (reparentChange?.type === 'reparent') {
            expect(reparentChange.newName).toBe('Folder_3');
        }
    });

    it('increments revision on applyChange', () => {
        const beforeRevision = syncEngine.getRevision();

        syncEngine.applyChange({
            type: 'update',
            timestamp: Date.now(),
            path: ['Workspace', 'FolderA', 'Part1'],
            property: { name: 'Anchored', value: true },
        });

        expect(syncEngine.getRevision()).toBeGreaterThan(beforeRevision);
    });

    it('reuses indexed cache within a revision and invalidates on mutation', () => {
        const first = syncEngine.getIndexedInstances();
        const second = syncEngine.getIndexedInstances();
        expect(second).toBe(first);

        syncEngine.applyChange({
            type: 'update',
            timestamp: Date.now(),
            path: ['Workspace', 'FolderA', 'Part1'],
            property: { name: 'Anchored', value: true },
        });

        const third = syncEngine.getIndexedInstances();
        expect(third).not.toBe(first);
        assertConvergedState(syncEngine);
    });

    it('rebuilds id lookup index after plugin full sync replaces paths', () => {
        const replacement: RobloxInstance[] = [
            {
                id: 'workspace-1',
                className: 'Workspace',
                name: 'Workspace',
                parent: null,
                properties: {},
                children: [
                    {
                        id: 'folder-a',
                        className: 'Folder',
                        name: 'FolderRenamedByPlugin',
                        parent: 'Workspace',
                        properties: {},
                        children: [
                            {
                                id: 'part-1',
                                className: 'Part',
                                name: 'PartFromPlugin',
                                parent: 'Workspace.FolderRenamedByPlugin',
                                properties: { Anchored: true },
                                children: [],
                            },
                        ],
                    },
                ],
            },
        ];

        syncEngine.updateFromPlugin(replacement);

        expect(syncEngine.getPathById('part-1')).toEqual(['Workspace', 'FolderRenamedByPlugin', 'PartFromPlugin']);
        expect(syncEngine.getInstanceById('part-1')?.name).toBe('PartFromPlugin');
    });

    it('restores state from snapshot after mutations', () => {
        const snapshot = syncEngine.createSnapshot();
        const beforeRevision = syncEngine.getRevision();
        const before = syncEngine.getInstance(['Workspace', 'FolderA', 'Part1']);
        expect(before).toBeDefined();
        const trackedId = before!.id;

        syncEngine.applyChange({
            type: 'update',
            timestamp: Date.now(),
            path: ['Workspace', 'FolderA', 'Part1'],
            property: { name: 'Name', value: 'TempName' },
        });

        expect(syncEngine.getInstance(['Workspace', 'FolderA', 'TempName'])).toBeDefined();
        expect(syncEngine.getRevision()).toBeGreaterThan(beforeRevision);

        syncEngine.restoreSnapshot(snapshot);

        expect(syncEngine.getInstance(['Workspace', 'FolderA', 'Part1'])).toBeDefined();
        expect(syncEngine.getInstance(['Workspace', 'FolderA', 'TempName'])).toBeUndefined();
        expect(syncEngine.getPathById(trackedId)).toEqual(['Workspace', 'FolderA', 'Part1']);
        expect(syncEngine.getRevision()).toBe(beforeRevision);
    });

    it('survives randomized high-churn rename/reparent/create/delete sequences', () => {
        const random = seededRandom(0xC0FFEE);
        const namePool = ['Node', 'Folder', 'Part', 'Script'];
        const classPool = ['Folder', 'Part', 'Model', 'Script'];

        for (let step = 0; step < 250; step++) {
            const indexed = syncEngine.getIndexedInstances();
            const mutable = indexed.filter(item => item.path.length > 1);

            let operation = 'create';
            const roll = random();
            if (roll < 0.20) {
                operation = 'delete';
            } else if (roll < 0.45) {
                operation = 'rename';
            } else if (roll < 0.65) {
                operation = 'reparent';
            } else if (roll < 0.80) {
                operation = 'update';
            } else {
                operation = 'create';
            }

            if (mutable.length === 0 && operation !== 'create') {
                operation = 'create';
            }

            if (operation === 'create') {
                const parent = pickRandom(indexed, random);
                const requestedName = pickRandom(namePool, random);
                const className = pickRandom(classPool, random);
                const id = `stress-${step}-${Math.floor(random() * 1_000_000)}`;

                syncEngine.applyChange({
                    type: 'create',
                    timestamp: Date.now(),
                    path: [...parent.path, requestedName],
                    instance: {
                        id,
                        className,
                        name: requestedName,
                        parent: parent.path.join('.'),
                        properties: {},
                        children: [],
                    },
                });
            } else if (operation === 'delete') {
                const target = pickRandom(mutable, random);
                syncEngine.applyChange({
                    type: 'delete',
                    timestamp: Date.now(),
                    path: target.path,
                });
            } else if (operation === 'rename') {
                const target = pickRandom(mutable, random);
                const requestedName = pickRandom(namePool, random);
                syncEngine.applyChange({
                    type: 'update',
                    timestamp: Date.now(),
                    path: target.path,
                    property: {
                        name: 'Name',
                        value: requestedName,
                    },
                });
            } else if (operation === 'reparent') {
                const target = pickRandom(mutable, random);
                const parentCandidates = indexed.filter(candidate =>
                    candidate.path.join('.') !== target.path.join('.')
                    && !isPrefix(target.path, candidate.path),
                );

                if (parentCandidates.length > 0) {
                    const newParent = pickRandom(parentCandidates, random);
                    syncEngine.applyChange({
                        type: 'reparent',
                        timestamp: Date.now(),
                        path: target.path,
                        newParentPath: newParent.path,
                    });
                }
            } else if (operation === 'update') {
                const target = pickRandom(mutable, random);
                const propertyName = random() < 0.5 ? 'Archivable' : 'SourceAssetId';
                const propertyValue = propertyName === 'Archivable'
                    ? random() < 0.5
                    : Math.floor(random() * 10000);

                syncEngine.applyChange({
                    type: 'update',
                    timestamp: Date.now(),
                    path: target.path,
                    property: {
                        name: propertyName,
                        value: propertyValue,
                    },
                });
            }

            assertConvergedState(syncEngine);
        }
    });
});
