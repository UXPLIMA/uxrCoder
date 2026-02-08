import { beforeEach, describe, expect, it } from 'vitest';
import { SyncEngine } from '../src/syncEngine';
import type { RobloxInstance } from '../src/types';

describe('SyncEngine Reparent Collision', () => {
    let syncEngine: SyncEngine;

    beforeEach(() => {
        syncEngine = new SyncEngine();

        const instances: RobloxInstance[] = [
            {
                id: 'workspace',
                className: 'Workspace',
                name: 'Workspace',
                parent: null,
                properties: {},
                children: [
                    {
                        id: 'folder-a',
                        className: 'Folder',
                        name: 'GroupA',
                        parent: 'Workspace',
                        properties: {},
                        children: [
                            {
                                id: 'moving-folder',
                                className: 'Folder',
                                name: 'Folder',
                                parent: 'Workspace.GroupA',
                                properties: {},
                                children: [],
                            },
                        ],
                    },
                    {
                        id: 'folder-b',
                        className: 'Folder',
                        name: 'GroupB',
                        parent: 'Workspace',
                        properties: {},
                        children: [
                            {
                                id: 'existing-folder',
                                className: 'Folder',
                                name: 'Folder',
                                parent: 'Workspace.GroupB',
                                properties: {},
                                children: [],
                            },
                        ],
                    },
                ],
            },
        ];

        syncEngine.updateFromPlugin(instances);
    });

    it('renames on destination collision and includes newName in pending reparent change', () => {
        syncEngine.applyChange({
            type: 'reparent',
            timestamp: Date.now(),
            path: ['Workspace', 'GroupA', 'Folder'],
            newParentPath: ['Workspace', 'GroupB'],
        });

        expect(syncEngine.getInstance(['Workspace', 'GroupB', 'Folder'])).toBeDefined();
        expect(syncEngine.getInstance(['Workspace', 'GroupB', 'Folder_2'])).toBeDefined();
        expect(syncEngine.getInstance(['Workspace', 'GroupA', 'Folder'])).toBeUndefined();

        const reparentChange = syncEngine
            .getPendingChangesForPlugin()
            .find((c) => c.type === 'reparent');

        expect(reparentChange).toBeDefined();
        if (reparentChange?.type === 'reparent') {
            expect(reparentChange.newName).toBe('Folder_2');
        }
    });
});
