import { describe, expect, it, vi } from 'vitest';
import { AgentDerivedCache } from '../src/agentDerivedCache';
import type { AgentPropertySchemaResponse, AgentSnapshotResponse, RobloxInstance } from '../src/types';

function createIndexed(): Array<{ path: string[]; instance: RobloxInstance }> {
    const workspace: RobloxInstance = {
        id: 'workspace-1',
        className: 'Workspace',
        name: 'Workspace',
        parent: null,
        properties: { Name: 'Workspace' },
        children: [],
    };

    const folder: RobloxInstance = {
        id: 'folder-1',
        className: 'Folder',
        name: 'Folder',
        parent: 'Workspace',
        properties: { Name: 'Folder' },
        children: [],
    };

    return [
        { path: ['Workspace'], instance: workspace },
        { path: ['Workspace', 'Folder'], instance: folder },
    ];
}

function makeSnapshot(
    revision: number,
    generatedAt: number,
    indexed: Array<{ path: string[]; instance: RobloxInstance }>,
): AgentSnapshotResponse {
    return {
        revision,
        generatedAt,
        instances: indexed.map(item => ({
            id: item.instance.id,
            className: item.instance.className,
            name: item.instance.name,
            path: item.path,
            parentId: null,
            childIds: [],
            properties: item.instance.properties,
        })),
    };
}

function makeSchema(revision: number): AgentPropertySchemaResponse {
    return {
        schemaVersion: 'uxr-agent-property-schema/v1',
        generatedAt: 111,
        revision,
        classes: [
            {
                className: 'Workspace',
                instanceCount: 1,
                properties: [],
            },
            {
                className: 'Folder',
                instanceCount: 1,
                properties: [],
            },
        ],
    };
}

describe('AgentDerivedCache', () => {
    it('caches indexed and snapshot values per revision', () => {
        let revision = 10;
        const getIndexedInstances = vi.fn(() => createIndexed());
        const buildSnapshot = vi.fn((indexed, currentRevision, generatedAt) =>
            makeSnapshot(currentRevision, generatedAt, indexed as Array<{ path: string[]; instance: RobloxInstance }>),
        );
        const buildSchema = vi.fn((indexed, currentRevision, classNameFilter) =>
            makeSchema(currentRevision),
        );

        const cache = new AgentDerivedCache({
            getRevision: () => revision,
            getIndexedInstances,
            buildSnapshot,
            buildSchema,
            now: () => 123456,
        });

        const indexedA = cache.getIndexedInstances();
        const indexedB = cache.getIndexedInstances();
        expect(indexedB).toBe(indexedA);
        expect(getIndexedInstances).toHaveBeenCalledTimes(1);

        const snapshotA = cache.getSnapshot();
        const snapshotB = cache.getSnapshot();
        expect(snapshotB).toBe(snapshotA);
        expect(buildSnapshot).toHaveBeenCalledTimes(1);
        expect(snapshotA.revision).toBe(10);
        expect(snapshotA.generatedAt).toBe(123456);

        revision = 11;
        const snapshotC = cache.getSnapshot();
        expect(snapshotC).not.toBe(snapshotA);
        expect(snapshotC.revision).toBe(11);
        expect(getIndexedInstances).toHaveBeenCalledTimes(2);
        expect(buildSnapshot).toHaveBeenCalledTimes(2);
    });

    it('caches schema for full and class-filtered requests', () => {
        const getIndexedInstances = vi.fn(() => createIndexed());
        const buildSnapshot = vi.fn((indexed, currentRevision, generatedAt) =>
            makeSnapshot(currentRevision, generatedAt, indexed as Array<{ path: string[]; instance: RobloxInstance }>),
        );
        const buildSchema = vi.fn((indexed, currentRevision, classNameFilter) =>
            makeSchema(currentRevision),
        );

        const cache = new AgentDerivedCache({
            getRevision: () => 5,
            getIndexedInstances,
            buildSnapshot,
            buildSchema,
            now: () => 123,
        });

        const schemaAllA = cache.getSchema();
        const schemaAllB = cache.getSchema();
        expect(schemaAllB).toBe(schemaAllA);
        expect(buildSchema).toHaveBeenCalledTimes(1);

        const folderA = cache.getSchema('Folder');
        const folderB = cache.getSchema('  Folder  ');
        expect(folderB).toBe(folderA);
        expect(folderA.classes).toHaveLength(1);
        expect(folderA.classes[0].className).toBe('Folder');
        expect(buildSchema).toHaveBeenCalledTimes(1);

        const workspace = cache.getSchema('Workspace');
        expect(workspace.classes[0].className).toBe('Workspace');
        expect(buildSchema).toHaveBeenCalledTimes(1);

        // Instances list should be derived once for all schema builds in same revision.
        expect(getIndexedInstances).toHaveBeenCalledTimes(1);
    });
});
