import type { AgentSnapshotInstance, AgentSnapshotResponse, RobloxInstance } from './types';

export interface IndexedInstanceEntry {
    path: string[];
    instance: RobloxInstance;
}

export function buildAgentSnapshotResponse(
    indexed: IndexedInstanceEntry[],
    revision: number,
    generatedAt: number,
): AgentSnapshotResponse {
    const total = indexed.length;
    const pathToId = new Map<string, string>();

    for (let i = 0; i < total; i++) {
        const item = indexed[i];
        const pathKey = item.path.join('.');
        pathToId.set(pathKey, item.instance.id);
    }

    const instances = new Array<AgentSnapshotInstance>(total);
    for (let i = 0; i < total; i++) {
        const { path, instance } = indexed[i];
        const parentPathKey = typeof instance.parent === 'string' ? instance.parent : null;
        const parentId = parentPathKey ? pathToId.get(parentPathKey) ?? null : null;

        const children = instance.children;
        let childIds: string[] = [];
        if (children && children.length > 0) {
            childIds = new Array<string>(children.length);
            for (let j = 0; j < children.length; j++) {
                childIds[j] = children[j].id;
            }
        }

        instances[i] = {
            id: instance.id,
            className: instance.className,
            name: instance.name,
            path,
            parentId,
            childIds,
            properties: instance.properties,
        };
    }

    return {
        revision,
        generatedAt,
        instances,
    };
}
