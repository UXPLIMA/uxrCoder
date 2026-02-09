import { describe, expect, it } from 'vitest';
import { buildAgentSnapshotResponse, type IndexedInstanceEntry } from '../src/agentSnapshot';
import type { RobloxInstance } from '../src/types';

function createInstance(params: {
    id: string;
    className: string;
    name: string;
    parent: string | null;
    children?: RobloxInstance[];
}): RobloxInstance {
    return {
        id: params.id,
        className: params.className,
        name: params.name,
        parent: params.parent,
        properties: {
            Name: params.name,
        },
        children: params.children ?? [],
    };
}

describe('buildAgentSnapshotResponse', () => {
    it('resolves parent and child ids deterministically', () => {
        const part = createInstance({
            id: 'part-1',
            className: 'Part',
            name: 'Part1',
            parent: 'Workspace.FolderA',
        });
        const folder = createInstance({
            id: 'folder-a',
            className: 'Folder',
            name: 'FolderA',
            parent: 'Workspace',
            children: [part],
        });
        const workspace = createInstance({
            id: 'workspace-1',
            className: 'Workspace',
            name: 'Workspace',
            parent: null,
            children: [folder],
        });

        const indexed: IndexedInstanceEntry[] = [
            { path: ['Workspace', 'FolderA', 'Part1'], instance: part },
            { path: ['Workspace'], instance: workspace },
            { path: ['Workspace', 'FolderA'], instance: folder },
        ];

        const snapshot = buildAgentSnapshotResponse(indexed, 42, 123456);
        expect(snapshot.revision).toBe(42);
        expect(snapshot.generatedAt).toBe(123456);
        expect(snapshot.instances).toHaveLength(3);

        const byId = new Map(snapshot.instances.map(instance => [instance.id, instance]));
        expect(byId.get('workspace-1')?.parentId).toBeNull();
        expect(byId.get('workspace-1')?.childIds).toEqual(['folder-a']);
        expect(byId.get('workspace-1')?.pathString).toBe('Workspace');

        expect(byId.get('folder-a')?.parentId).toBe('workspace-1');
        expect(byId.get('folder-a')?.childIds).toEqual(['part-1']);
        expect(byId.get('folder-a')?.pathString).toBe('Workspace.FolderA');

        expect(byId.get('part-1')?.parentId).toBe('folder-a');
        expect(byId.get('part-1')?.childIds).toEqual([]);
        expect(byId.get('part-1')?.pathString).toBe('Workspace.FolderA.Part1');
    });

    it('sets parentId to null when parent path is missing from indexed set', () => {
        const orphan = createInstance({
            id: 'orphan',
            className: 'Part',
            name: 'Orphan',
            parent: 'Workspace.Missing',
        });

        const snapshot = buildAgentSnapshotResponse(
            [{ path: ['Workspace', 'Missing', 'Orphan'], instance: orphan }],
            1,
            1,
        );

        expect(snapshot.instances).toHaveLength(1);
        expect(snapshot.instances[0].id).toBe('orphan');
        expect(snapshot.instances[0].parentId).toBeNull();
        expect(snapshot.instances[0].pathString).toBe('Workspace.Missing.Orphan');
    });
});
