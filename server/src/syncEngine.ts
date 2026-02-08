/**
 * @fileoverview SyncEngine - Core synchronization logic for uxrCoder.
 *
 * This module handles:
 * - Tracking the current state of the DataModel
 * - Detecting changes between sync cycles
 * - Managing pending changes for the Roblox plugin
 *
 * @author UXPLIMA
 * @license MIT
 */

import type { RobloxInstance, SyncMessage, PropertyValue, PendingChange, CommandMessage, LogMessage, ReparentInstanceMessage } from './types';
import { randomUUID } from 'crypto';

export interface SyncEngineSnapshot {
    instances: Array<[string, RobloxInstance]>;
    idToPath: Array<[string, string]>;
    treeInstances: RobloxInstance[];
    pendingChanges: PendingChange[];
    lastSyncTimestamp: number;
    revision: number;
}

/**
 * Core synchronization engine that manages state between Roblox Studio and editors.
 */
export class SyncEngine {
    /** Flat map of instances by path string (e.g., "Workspace.Model.Part") */
    private instances: Map<string, RobloxInstance> = new Map();

    /** Stable id -> path index for O(1) id lookups */
    private idToPath: Map<string, string> = new Map();

    /** Original tree structure from plugin for hierarchical display */
    private treeInstances: RobloxInstance[] = [];

    /** Cached sorted indexed view for the current revision */
    private indexedInstancesCache: Array<{ path: string[]; instance: RobloxInstance }> | null = null;

    /** Queue of changes waiting to be applied by the Roblox plugin */
    private pendingChanges: PendingChange[] = [];

    /** Timestamp of the last successful sync */
    private lastSyncTimestamp: number = 0;

    /** Monotonic revision counter for optimistic concurrency checks */
    private revision: number = 0;

    // =========================================================================
    // Public API - Plugin Communication
    // =========================================================================

    /**
     * Update internal state from Roblox plugin's DataModel snapshot.
     */
    updateFromPlugin(pluginInstances: RobloxInstance[]): SyncMessage[] {
        const changes: SyncMessage[] = [];
        const newInstanceMap = new Map<string, RobloxInstance>();

        // Flatten the instance tree for efficient comparison
        this.flattenInstances(pluginInstances, [], newInstanceMap);
        const nextIdToPath = this.buildIdToPathIndex(newInstanceMap);

        // Detect new and updated instances
        newInstanceMap.forEach((newInst, pathKey) => {
            const existing = this.instances.get(pathKey);
            const path = pathKey.split('.');

            if (!existing) {
                // New instance created
                changes.push({
                    type: 'create',
                    timestamp: Date.now(),
                    path,
                    instance: newInst,
                });
            } else {
                // Check for property changes
                const propChanges = this.detectPropertyChanges(existing, newInst, path);
                changes.push(...propChanges);
            }
        });

        // Detect deleted instances
        this.instances.forEach((_oldInst, pathKey) => {
            if (!newInstanceMap.has(pathKey)) {
                changes.push({
                    type: 'delete',
                    timestamp: Date.now(),
                    path: pathKey.split('.'),
                });
            }
        });

        // Update internal state
        this.instances = newInstanceMap;
        this.idToPath = nextIdToPath;
        this.treeInstances = pluginInstances;
        this.bumpRevision();

        return changes;
    }

    /**
     * Apply a batch of delta changes from the plugin.
     *
     * @param changes - Array of changes to apply
     */
    applyDeltaChanges(changes: SyncMessage[]): void {
        for (const change of changes) {
            this.applyChangeInternal(change);
        }
        if (changes.length > 0) {
            this.bumpRevision();
        }
    }

    /**
     * Get changes waiting to be applied by the Roblox plugin.
     */
    getPendingChangesForPlugin(): PendingChange[] {
        return this.pendingChanges.filter(c => !c.confirmed);
    }

    /**
     * Mark changes as confirmed (successfully applied by plugin).
     */
    confirmChanges(ids: string[]): void {
        const idSet = new Set(ids);

        for (const change of this.pendingChanges) {
            if (idSet.has(change.id)) {
                change.confirmed = true;
            }
        }

        // Evict confirmed changes after a stabilization period (60 seconds)
        const cutoff = Date.now() - 60000;
        this.pendingChanges = this.pendingChanges.filter(
            c => !c.confirmed || c.timestamp > cutoff
        );
    }

    // =========================================================================
    // Public API - Editor Communication
    // =========================================================================

    /**
     * Apply a change from VS Code/Antigravity editor.
     */
    applyChange(message: SyncMessage): void {
        this.applyChangeInternal(message);
        this.addPendingChange(message);
        this.bumpRevision();
    }

    /**
     * Get instance by path.
     */
    getInstance(path: string[]): RobloxInstance | undefined {
        return this.instances.get(path.join('.'));
    }

    /**
     * Get instance by stable id.
     */
    getInstanceById(id: string): RobloxInstance | undefined {
        if (!id) {
            return undefined;
        }

        const pathKey = this.idToPath.get(id);
        if (!pathKey) {
            return undefined;
        }

        const instance = this.instances.get(pathKey);
        if (!instance) {
            this.idToPath.delete(id);
            return undefined;
        }

        return instance;
    }

    /**
     * Resolve current path by stable id.
     */
    getPathById(id: string): string[] | undefined {
        if (!id) {
            return undefined;
        }

        const pathKey = this.idToPath.get(id);
        if (!pathKey) {
            return undefined;
        }

        if (!this.instances.has(pathKey)) {
            this.idToPath.delete(id);
            return undefined;
        }

        return pathKey.split('.');
    }

    /**
     * Get all instances as a tree structure.
     */
    getAllInstances(): RobloxInstance[] {
        return this.treeInstances;
    }

    /**
     * Get all indexed instances with their resolved paths.
     * Sorted by path for deterministic consumers (e.g., agents).
     */
    getIndexedInstances(): Array<{ path: string[]; instance: RobloxInstance }> {
        if (this.indexedInstancesCache) {
            return this.indexedInstancesCache;
        }

        const entries = Array.from(this.instances.entries());
        entries.sort(([a], [b]) => a.localeCompare(b));

        const indexed = new Array<{ path: string[]; instance: RobloxInstance }>(entries.length);
        for (let i = 0; i < entries.length; i++) {
            const [pathKey, instance] = entries[i];
            indexed[i] = {
                path: pathKey.split('.'),
                instance,
            };
        }

        this.indexedInstancesCache = indexed;
        return indexed;
    }

    /**
     * Get the timestamp of the last successful sync.
     */
    getLastSyncTimestamp(): number {
        return this.lastSyncTimestamp;
    }

    /**
     * Get current optimistic-concurrency revision.
     */
    getRevision(): number {
        return this.revision;
    }

    /**
     * Capture current engine state for transactional rollback.
     */
    createSnapshot(): SyncEngineSnapshot {
        return {
            instances: this.deepClone(Array.from(this.instances.entries())),
            idToPath: this.deepClone(Array.from(this.idToPath.entries())),
            treeInstances: this.deepClone(this.treeInstances),
            pendingChanges: this.deepClone(this.pendingChanges),
            lastSyncTimestamp: this.lastSyncTimestamp,
            revision: this.revision,
        };
    }

    /**
     * Restore previously captured state snapshot.
     */
    restoreSnapshot(snapshot: SyncEngineSnapshot): void {
        this.instances = new Map(this.deepClone(snapshot.instances));
        this.idToPath = snapshot.idToPath
            ? new Map(this.deepClone(snapshot.idToPath))
            : this.buildIdToPathIndex(this.instances);
        this.treeInstances = this.deepClone(snapshot.treeInstances);
        this.indexedInstancesCache = null;
        this.pendingChanges = this.deepClone(snapshot.pendingChanges);
        this.lastSyncTimestamp = snapshot.lastSyncTimestamp;
        this.revision = snapshot.revision;
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    /**
     * Internal method to apply a single change to the state.
     */
    private applyChangeInternal(change: SyncMessage): void {
        if (change.type === 'command' || change.type === 'log') {
            return;
        }

        const pathKey = change.path.join('.');

        switch (change.type) {
            case 'create':
                // Narrowing: TypeScript knows 'create' has 'instance'
                if (change.type === 'create' && change.instance) {
                    const originalName = change.path[change.path.length - 1];
                    const parentPath = change.path.slice(0, -1);
                    const hasParent = parentPath.length === 0
                        || this.instances.has(parentPath.join('.'));

                    if (!hasParent) {
                        console.warn(
                            `[SYNC] Skipping create for missing parent: ${change.path.join('.')} (missing ${parentPath.join('.')})`,
                        );
                        break;
                    }

                    // Update tree first; this may normalize the instance name on collisions.
                    this.addToTree(change.path, change.instance);
                    this.indexSubtree(change.instance, parentPath);

                    if (change.instance.name !== originalName) {
                        change.path = [...change.path.slice(0, -1), change.instance.name];
                    }
                }
                break;

            case 'update':
                const inst = this.instances.get(pathKey);
                if (inst && change.type === 'update' && change.property) {
                    if (change.property.name === 'Name' && typeof change.property.value === 'string') {
                        const resolvedName = this.renameInstance(change.path, change.property.value);
                        if (resolvedName) {
                            change.property.value = resolvedName;
                        }
                        break;
                    }

                    inst.properties[change.property.name] = change.property.value;
                    // Tree update is implicit via object reference
                }
                break;

            case 'delete':
                const toDelete = this.instances.get(pathKey);
                // Remove instance and all children from map
                const keysToDelete = Array.from(this.instances.keys()).filter(
                    key => key === pathKey || key.startsWith(pathKey + '.')
                );
                this.removeIndexedKeys(keysToDelete);

                // Remove from tree
                this.removeFromTree(change.path, toDelete?.id);
                break;

            case 'reparent':
                const reparentResult = this.reparentInstance(change.path, change.newParentPath);
                if (reparentResult && reparentResult.renamedTo) {
                    change.newName = reparentResult.renamedTo;
                }
                break;
        }
    }

    /**
     * Reparent an instance and update all descendant paths.
     */
    private reparentInstance(
        oldPath: string[],
        newParentPath: string[]
    ): { renamedTo?: string } | null {
        const oldPathKey = oldPath.join('.');
        const instance = this.instances.get(oldPathKey);
        const newParentKey = newParentPath.join('.');
        const newParent = this.instances.get(newParentKey);

        if (!instance) {
            console.error(`[SYNC] Reparent failed: Instance not found: ${oldPathKey}`);
            return null;
        }

        if (!newParent) {
            console.error(`[SYNC] Reparent failed: New parent not found: ${newParentKey}`);
            return null;
        }

        // 1. Remove from old parent in Tree
        this.removeFromTree(oldPath, instance.id);

        // 2. Resolve sibling collisions at destination before reindexing
        const originalName = instance.name;
        const uniqueName = this.getUniqueSiblingName(newParentPath, originalName, instance.id);
        const wasRenamed = uniqueName !== originalName;
        if (uniqueName !== originalName) {
            process.stdout.write(`[SYNC] Reparent name collision: ${oldPathKey} -> ${[...newParentPath, uniqueName].join('.')}\n`);
        }
        instance.name = uniqueName;
        instance.properties.Name = uniqueName;

        // 3. Insert into new parent in Tree
        const targetPath = [...newParentPath, instance.name];
        this.addToTree(targetPath, instance);

        // 4. Re-index the subtree in the map with new paths
        const newActualPath = [...newParentPath, instance.name];
        const newActualPathKey = newActualPath.join('.');

        // Remove old keys
        const keysToRemove = Array.from(this.instances.keys()).filter(
            key => key === oldPathKey || key.startsWith(oldPathKey + '.')
        );
        this.removeIndexedKeys(keysToRemove);

        // Re-add self and descendants with new keys and refreshed parent pointers
        const mapCount = this.indexSubtree(instance, newParentPath);

        console.log(`[SYNC] Reparented ${oldPathKey} -> ${newActualPathKey} (${mapCount} instances updated)`);
        return wasRenamed ? { renamedTo: uniqueName } : {};
    }

    /**
     * Add an instance to the hierarchical tree structure.
     * Checks for existing instances by ID to handle duplicates properly.
     * Checks for existing instances by ID to handle duplicates properly.
     * Automatically renames instances with duplicate names to avoid path collisions.
     */
    private addToTree(path: string[], instance: RobloxInstance): void {
        const instanceName = path[path.length - 1];

        if (path.length === 1) {
            // Root level (Service) - check by ID not name
            const existingIndex = this.treeInstances.findIndex(i => i.id === instance.id);
            if (existingIndex >= 0) {
                // Update existing instance
                this.treeInstances[existingIndex] = instance;
            } else {
                const uniqueName = this.getUniqueSiblingName([], instanceName, instance.id);

                if (uniqueName !== instanceName) {
                    console.log(`🔄 Auto-renamed "${instanceName}" to "${uniqueName}" at root to avoid path collision`);
                    instance.name = uniqueName;
                    instance.properties.Name = uniqueName;
                }

                this.treeInstances.push(instance);
            }
            return;
        }

        const parentPath = path.slice(0, -1);
        const parent = this.instances.get(parentPath.join('.'));

        if (parent) {
            if (!parent.children) parent.children = [];

            // Check if child already exists by ID
            const existingIndex = parent.children.findIndex(c => c.id === instance.id);
            if (existingIndex >= 0) {
                // Update existing child
                parent.children[existingIndex] = instance;
            } else {
                const uniqueName = this.getUniqueSiblingName(parentPath, instanceName, instance.id);

                if (uniqueName !== instanceName) {
                    console.log(`🔄 Auto-renamed "${path.join('.')}" to "${[...parentPath, uniqueName].join('.')}" to avoid path collision`);
                    instance.name = uniqueName;
                    instance.properties.Name = uniqueName;
                }

                parent.children.push(instance);
            }
        }
    }

    /**
     * Remove an instance from the hierarchical tree structure.
     */
    private removeFromTree(path: string[], instanceId?: string): void {
        if (path.length === 1) {
            this.treeInstances = this.treeInstances.filter(i => {
                if (instanceId) {
                    return i.id !== instanceId;
                }
                return i.name !== path[0];
            });
            return;
        }

        const parentPath = path.slice(0, -1);
        const parent = this.instances.get(parentPath.join('.'));
        const targetName = path[path.length - 1];

        if (parent && parent.children) {
            parent.children = parent.children.filter(c => {
                if (instanceId) {
                    return c.id !== instanceId;
                }
                return c.name !== targetName;
            });
        }
    }

    /**
     * Re-index a subtree in the flat instance map and refresh parent pointers.
     *
     * @returns Number of indexed instances
     */
    private indexSubtree(instance: RobloxInstance, parentPath: string[]): number {
        const currentPath = [...parentPath, instance.name];
        const currentPathKey = currentPath.join('.');
        instance.parent = parentPath.length > 0 ? parentPath.join('.') : null;
        this.instances.set(currentPathKey, instance);
        this.idToPath.set(instance.id, currentPathKey);

        let count = 1;
        if (instance.children && instance.children.length > 0) {
            for (const child of instance.children) {
                count += this.indexSubtree(child, currentPath);
            }
        }
        return count;
    }

    /**
     * Remove flat-map keys and associated id index entries.
     */
    private removeIndexedKeys(pathKeys: string[]): void {
        for (const pathKey of pathKeys) {
            const instance = this.instances.get(pathKey);
            if (instance) {
                this.idToPath.delete(instance.id);
            }
            this.instances.delete(pathKey);
        }
    }

    /**
     * Build id->path index from a path-indexed map.
     */
    private buildIdToPathIndex(instances: Map<string, RobloxInstance>): Map<string, string> {
        const index = new Map<string, string>();
        for (const [pathKey, instance] of instances.entries()) {
            index.set(instance.id, pathKey);
        }
        return index;
    }

    /**
     * Resolve a unique sibling name under a parent path.
     */
    private getUniqueSiblingName(parentPath: string[], desiredName: string, excludeId?: string): string {
        const siblingNames = new Set<string>();

        if (parentPath.length === 0) {
            for (const root of this.treeInstances) {
                if (!excludeId || root.id !== excludeId) {
                    siblingNames.add(root.name);
                }
            }
        } else {
            const parent = this.instances.get(parentPath.join('.'));
            if (parent?.children) {
                for (const child of parent.children) {
                    if (!excludeId || child.id !== excludeId) {
                        siblingNames.add(child.name);
                    }
                }
            }
        }

        return this.allocateUniqueSiblingName(desiredName, siblingNames);
    }

    /**
     * Allocate a unique sibling name while preventing unstable `_2_2_2` suffix chains.
     */
    private allocateUniqueSiblingName(desiredName: string, siblingNames: Set<string>): string {
        if (!siblingNames.has(desiredName)) {
            return desiredName;
        }

        const { baseName, startSuffix } = this.deriveCollisionBase(desiredName, siblingNames);
        let suffix = Math.max(2, startSuffix);
        let candidate = `${baseName}_${suffix}`;

        while (siblingNames.has(candidate)) {
            suffix += 1;
            candidate = `${baseName}_${suffix}`;
        }

        return candidate;
    }

    /**
     * Collapse generated numeric suffixes (`Name_2`) when base siblings already exist.
     */
    private deriveCollisionBase(desiredName: string, siblingNames: Set<string>): { baseName: string; startSuffix: number } {
        let baseName = desiredName;
        let startSuffix = 2;

        while (true) {
            const match = baseName.match(/^(.*)_(\d+)$/);
            if (!match) {
                break;
            }

            const candidateBase = match[1];
            const parsedSuffix = Number.parseInt(match[2], 10);
            if (
                candidateBase.length === 0
                || !Number.isFinite(parsedSuffix)
                || parsedSuffix < 2
                || !siblingNames.has(candidateBase)
            ) {
                break;
            }

            baseName = candidateBase;
            startSuffix = Math.max(startSuffix, parsedSuffix + 1);
        }

        return { baseName, startSuffix };
    }

    /**
     * Rename an instance and re-index its subtree paths.
     */
    private renameInstance(path: string[], requestedName: string): string | null {
        const oldPathKey = path.join('.');
        const instance = this.instances.get(oldPathKey);
        if (!instance) {
            return null;
        }

        const parentPath = path.slice(0, -1);
        const uniqueName = this.getUniqueSiblingName(parentPath, requestedName, instance.id);
        const oldName = instance.name;
        if (oldName === uniqueName) {
            instance.properties.Name = uniqueName;
            return uniqueName;
        }

        const oldPrefix = `${oldPathKey}.`;
        const oldKeys = Array.from(this.instances.keys()).filter(
            key => key === oldPathKey || key.startsWith(oldPrefix)
        );
        this.removeIndexedKeys(oldKeys);

        instance.name = uniqueName;
        instance.properties.Name = uniqueName;

        this.indexSubtree(instance, parentPath);
        process.stdout.write(`[SYNC] Renamed ${oldPathKey} -> ${[...parentPath, uniqueName].join('.')}\n`);
        return uniqueName;
    }

    /**
     * Flatten a tree of instances into a Map for efficient lookups.
     * Handles duplicate names by auto-renaming to prevent path collisions.
     */
    private flattenInstances(
        instances: RobloxInstance[],
        parentPath: string[],
        output: Map<string, RobloxInstance>
    ): void {
        for (const inst of instances) {
            const path = [...parentPath, inst.name];
            const pathKey = path.join('.');

            // Check for duplicate path
            if (output.has(pathKey)) {
                const existing = output.get(pathKey);
                if (existing && existing.id !== inst.id) {
                    const siblingNames = this.collectSiblingNamesFromOutput(output, parentPath, inst.id);
                    const uniqueName = this.allocateUniqueSiblingName(inst.name, siblingNames);
                    const uniquePath = [...parentPath, uniqueName];
                    const uniquePathKey = uniquePath.join('.');

                    process.stdout.write(`[RESOLVE] Auto-renamed collision: ${pathKey} -> ${uniquePathKey}\n`);
                    inst.name = uniqueName;
                    inst.properties.Name = uniqueName;
                    output.set(uniquePathKey, inst);

                    if (inst.children && inst.children.length > 0) {
                        this.flattenInstances(inst.children, uniquePath, output);
                    }
                    continue;
                }
            }

            output.set(pathKey, inst);

            if (inst.children && inst.children.length > 0) {
                this.flattenInstances(inst.children, path, output);
            }
        }
    }

    /**
     * Collect sibling names under a parent path from an indexed path map.
     */
    private collectSiblingNamesFromOutput(
        output: Map<string, RobloxInstance>,
        parentPath: string[],
        excludeId?: string,
    ): Set<string> {
        const siblingNames = new Set<string>();
        const parentPathKey = parentPath.join('.');

        for (const [pathKey, instance] of output.entries()) {
            if (excludeId && instance.id === excludeId) {
                continue;
            }

            const parts = pathKey.split('.');
            if (parts.length !== parentPath.length + 1) {
                continue;
            }

            const candidateParent = parts.slice(0, -1).join('.');
            if (candidateParent !== parentPathKey) {
                continue;
            }

            siblingNames.add(parts[parts.length - 1]);
        }

        return siblingNames;
    }

    /**
     * Detect property changes between two instances.
     */
    private detectPropertyChanges(
        oldInst: RobloxInstance,
        newInst: RobloxInstance,
        path: string[]
    ): SyncMessage[] {
        const changes: SyncMessage[] = [];

        // Check for changed or new properties
        for (const [key, value] of Object.entries(newInst.properties)) {
            const oldValue = oldInst.properties[key];
            if (!this.valuesEqual(oldValue, value)) {
                changes.push({
                    type: 'update',
                    timestamp: Date.now(),
                    path,
                    property: { name: key, value },
                });
            }
        }

        // Check for removed properties
        for (const key of Object.keys(oldInst.properties)) {
            if (!(key in newInst.properties)) {
                changes.push({
                    type: 'update',
                    timestamp: Date.now(),
                    path,
                    property: { name: key, value: null },
                });
            }
        }

        return changes;
    }

    /**
     * Compare two property values for equality.
     */
    private valuesEqual(a: PropertyValue | undefined, b: PropertyValue | undefined): boolean {
        if (a === b) return true;
        if (a === undefined || b === undefined) return false;
        if (a === null || b === null) return a === b;

        if (typeof a === 'object' && typeof b === 'object') {
            return JSON.stringify(a) === JSON.stringify(b);
        }

        return a === b;
    }

    /**
     * Add a change to the pending queue for the plugin.
     * Coalesces duplicate keys so latest state is delivered.
     */
    private addPendingChange(message: SyncMessage): void {
        // Skip if this is a command or log message (no path)
        if (message.type === 'command' || message.type === 'log') {
            this.pendingChanges.push({
                ...message,
                id: randomUUID(),
                confirmed: false,
            });
            return;
        }

        const dedupKey = this.getPendingDedupKey(message);
        if (!dedupKey) {
            this.pendingChanges.push({
                ...message,
                id: randomUUID(),
                confirmed: false,
            });
            return;
        }

        const existingIndex = this.pendingChanges.findIndex(
            (change) => !change.confirmed && this.getPendingDedupKey(change) === dedupKey
        );

        if (existingIndex >= 0) {
            const existingId = this.pendingChanges[existingIndex].id;
            this.pendingChanges[existingIndex] = {
                ...message,
                id: existingId,
                confirmed: false,
            };
            return;
        }

        this.pendingChanges.push({
            ...message,
            id: randomUUID(),
            confirmed: false,
        });
    }

    /**
     * Build a stable deduplication key for pending changes.
     */
    private getPendingDedupKey(message: SyncMessage): string | null {
        if (message.type === 'command' || message.type === 'log') {
            return null;
        }

        if (message.type === 'update' && message.property) {
            return `${message.type}:${message.path.join('.')}:${message.property.name}`;
        }

        if (message.type === 'reparent') {
            return `${message.type}:${message.path.join('.')}->${message.newParentPath.join('.')}:${message.newName ?? ''}`;
        }

        return `${message.type}:${message.path.join('.')}`;
    }

    private bumpRevision(): void {
        this.lastSyncTimestamp = Date.now();
        this.revision += 1;
        this.indexedInstancesCache = null;
    }

    private deepClone<T>(value: T): T {
        const maybeStructuredClone = (globalThis as { structuredClone?: <K>(input: K) => K }).structuredClone;
        if (typeof maybeStructuredClone === 'function') {
            return maybeStructuredClone(value);
        }
        return JSON.parse(JSON.stringify(value)) as T;
    }
}
