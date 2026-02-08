import { describe, it, expect, beforeEach } from 'vitest';
import { SyncEngine } from '../src/syncEngine';
import { RobloxInstance } from '../src/types';

describe('SyncEngine Reparenting', () => {
    let syncEngine: SyncEngine;

    beforeEach(() => {
        syncEngine = new SyncEngine();

        // Setup initial state:
        // Workspace (service, root)
        //   FolderA
        //     Part1
        //   FolderB

        const instances: RobloxInstance[] = [
            {
                id: 'workspace-1',
                className: 'Workspace',
                name: 'Workspace',
                parent: null,
                properties: {},
                children: [
                    {
                        id: 'root-1',
                        className: 'Folder',
                        name: 'FolderA',
                        parent: 'Workspace',
                        properties: {},
                        children: [
                            {
                                id: 'child-1',
                                className: 'Part',
                                name: 'Part1',
                                parent: 'Workspace.FolderA',
                                properties: {},
                                children: []
                            }
                        ]
                    },
                    {
                        id: 'root-2',
                        className: 'Folder',
                        name: 'FolderB',
                        parent: 'Workspace',
                        properties: {},
                        children: []
                    }
                ]
            }
        ];

        syncEngine.updateFromPlugin(instances);
    });

    it('should reparent an instance and update paths correctly', () => {
        // Move Part1 from FolderA to FolderB
        syncEngine.applyChange({
            type: 'reparent',
            timestamp: Date.now(),
            path: ['Workspace', 'FolderA', 'Part1'],
            newParentPath: ['Workspace', 'FolderB']
        });

        // Verify Part1 is now reachable via new path
        const part = syncEngine.getInstance(['Workspace', 'FolderB', 'Part1']);
        expect(part).toBeDefined();
        expect(part?.name).toBe('Part1');

        // Verify it's gone from old path
        const oldPart = syncEngine.getInstance(['Workspace', 'FolderA', 'Part1']);
        expect(oldPart).toBeUndefined();

        // Verify tree structure
        const folderB = syncEngine.getInstance(['Workspace', 'FolderB']);
        expect(folderB?.children?.length).toBe(1);
        expect(folderB?.children?.[0].name).toBe('Part1');

        const folderA = syncEngine.getInstance(['Workspace', 'FolderA']);
        expect(folderA?.children?.length).toBe(0);
    });

    it('should handle nested reparenting and update descendants', () => {
        // Setup nested structure: FolderA -> SubFolder -> Part
        const subFolder: RobloxInstance = {
            id: 'sub-1',
            className: 'Folder',
            name: 'SubFolder',
            parent: 'Workspace.FolderA',
            properties: {},
            children: [
                {
                    id: 'part-deep',
                    className: 'Part',
                    name: 'DeepPart',
                    parent: 'Workspace.FolderA.SubFolder',
                    properties: {},
                    children: []
                }
            ]
        };

        // Manually inject (easier than full mock setup)
        const folderA = syncEngine.getInstance(['Workspace', 'FolderA']);
        if (folderA && folderA.children) {
            folderA.children.push(subFolder);
        }

        // Re-sync to flatten map
        syncEngine.updateFromPlugin(syncEngine.getAllInstances());

        // Move SubFolder to FolderB
        syncEngine.applyChange({
            type: 'reparent',
            timestamp: Date.now(),
            path: ['Workspace', 'FolderA', 'SubFolder'],
            newParentPath: ['Workspace', 'FolderB']
        });

        // Verify SubFolder moved
        expect(syncEngine.getInstance(['Workspace', 'FolderB', 'SubFolder'])).toBeDefined();

        // Verify DeepPart path updated
        expect(syncEngine.getInstance(['Workspace', 'FolderB', 'SubFolder', 'DeepPart'])).toBeDefined();

        // Verify old paths gone
        expect(syncEngine.getInstance(['Workspace', 'FolderA', 'SubFolder', 'DeepPart'])).toBeUndefined();
    });
});
