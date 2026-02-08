import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DATA_EXTENSIONS, FileMapper, SCRIPT_EXTENSIONS } from '../src/fileMapper';
import { SyncEngine } from '../src/syncEngine';
import type { RobloxInstance, SyncMessage } from '../src/types';

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

    for (const { path, instance } of indexed) {
        expect(syncEngine.getPathById(instance.id)).toEqual(path);

        if (path.length === 1) {
            expect(instance.parent ?? null).toBeNull();
            continue;
        }

        const parentPath = path.slice(0, -1);
        expect(syncEngine.getInstance(parentPath)).toBeDefined();
        expect(instance.parent).toBe(parentPath.join('.'));
    }
}

function assertFilesystemConverged(fileMapper: FileMapper, indexed: Array<{ path: string[]; instance: RobloxInstance }>): void {
    for (const { path: instancePath, instance } of indexed) {
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

describe('Convergence Replay Integration', () => {
    let workspaceRoot: string;

    beforeEach(() => {
        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uxr-convergence-replay-'));
    });

    afterEach(() => {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
    });

    it('keeps memory, filesystem, and replayed plugin state converged on collision-heavy flows', () => {
        const syncEngine = new SyncEngine();
        const fileMapper = new FileMapper(workspaceRoot, null);
        fileMapper.setSyncEngine(syncEngine);

        const initial: RobloxInstance[] = [
            {
                id: 'workspace-1',
                className: 'Workspace',
                name: 'Workspace',
                parent: null,
                properties: {},
                children: [
                    {
                        id: 'source',
                        className: 'Folder',
                        name: 'Source',
                        parent: 'Workspace',
                        properties: {},
                        children: [
                            {
                                id: 'source-script-2',
                                className: 'Script',
                                name: 'Script_2',
                                parent: 'Workspace.Source',
                                properties: {
                                    Source: '-- source script',
                                },
                                children: [],
                            },
                        ],
                    },
                    {
                        id: 'dest',
                        className: 'Folder',
                        name: 'Dest',
                        parent: 'Workspace',
                        properties: {},
                        children: [
                            {
                                id: 'dest-script',
                                className: 'Script',
                                name: 'Script',
                                parent: 'Workspace.Dest',
                                properties: {
                                    Source: '-- dest script',
                                },
                                children: [],
                            },
                            {
                                id: 'dest-script-2',
                                className: 'Script',
                                name: 'Script_2',
                                parent: 'Workspace.Dest',
                                properties: {
                                    Source: '-- dest script 2',
                                },
                                children: [],
                            },
                        ],
                    },
                    {
                        id: 'folder-1',
                        className: 'Folder',
                        name: 'Folder',
                        parent: 'Workspace',
                        properties: {},
                        children: [],
                    },
                    {
                        id: 'folder-2',
                        className: 'Folder',
                        name: 'Folder_2',
                        parent: 'Workspace',
                        properties: {},
                        children: [],
                    },
                ],
            },
        ];

        syncEngine.updateFromPlugin(initial);
        fileMapper.syncAllToFiles(syncEngine.getAllInstances());

        const applyEditorChange = (change: SyncMessage): SyncMessage => {
            syncEngine.applyChange(change);
            fileMapper.syncToFiles(change);
            return change;
        };

        const createResult = applyEditorChange({
            type: 'create',
            timestamp: Date.now(),
            path: ['Workspace', 'Folder_2'],
            instance: {
                id: 'folder-3',
                className: 'Folder',
                name: 'Folder_2',
                parent: 'Workspace',
                properties: {},
                children: [],
            },
        });
        expect(createResult.path).toEqual(['Workspace', 'Folder_3']);
        expect(syncEngine.getPathById('folder-3')).toEqual(['Workspace', 'Folder_3']);

        const reparentResult = applyEditorChange({
            type: 'reparent',
            timestamp: Date.now(),
            path: ['Workspace', 'Source', 'Script_2'],
            newParentPath: ['Workspace', 'Dest'],
        });
        expect(syncEngine.getPathById('source-script-2')).toEqual(['Workspace', 'Dest', 'Script_3']);
        if (reparentResult.type === 'reparent') {
            expect(reparentResult.newName).toBe('Script_3');
        }

        applyEditorChange({
            type: 'update',
            timestamp: Date.now(),
            path: ['Workspace', 'Dest', 'Script_3'],
            property: { name: 'Name', value: 'Script_2' },
        });
        expect(syncEngine.getPathById('source-script-2')).toEqual(['Workspace', 'Dest', 'Script_3']);

        const movedScriptPath = path.join(workspaceRoot, 'Workspace', 'Dest', 'Script_3.server.lua');
        const oldScriptPath = path.join(workspaceRoot, 'Workspace', 'Source', 'Script_2.server.lua');
        expect(fs.existsSync(movedScriptPath)).toBe(true);
        expect(fs.existsSync(oldScriptPath)).toBe(false);

        const replaySnapshot = JSON.parse(JSON.stringify(syncEngine.getAllInstances())) as RobloxInstance[];
        const replayChanges = syncEngine.updateFromPlugin(replaySnapshot);
        fileMapper.syncAllToFiles(syncEngine.getAllInstances());
        expect(replayChanges).toHaveLength(0);

        assertConvergedState(syncEngine);
        const indexed = syncEngine.getIndexedInstances();
        assertFilesystemConverged(fileMapper, indexed);

        const chainedSuffixPaths = indexed
            .map(({ path: currentPath }) => currentPath.join('.'))
            .filter(pathKey => /_\d+_\d+(?:_|$)/.test(pathKey));
        expect(chainedSuffixPaths).toEqual([]);
    });
});
