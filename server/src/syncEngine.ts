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

import type { RobloxInstance, SyncMessage, PropertyValue, PendingChange, CommandMessage, LogMessage } from './types';
import { randomUUID } from 'crypto';

/**
 * Core synchronization engine that manages state between Roblox Studio and editors.
 */
export class SyncEngine {
    /** Flat map of instances by path string (e.g., "Workspace.Model.Part") */
    private instances: Map<string, RobloxInstance> = new Map();

    /** Original tree structure from plugin for hierarchical display */
    private treeInstances: RobloxInstance[] = [];

    /** Queue of changes waiting to be applied by the Roblox plugin */
    private pendingChanges: PendingChange[] = [];

    /** Timestamp of the last successful sync */
    private lastSyncTimestamp: number = 0;

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
        this.treeInstances = pluginInstances;
        this.lastSyncTimestamp = Date.now();

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
        this.lastSyncTimestamp = Date.now();
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
    }

    /**
     * Get instance by path.
     */
    getInstance(path: string[]): RobloxInstance | undefined {
        return this.instances.get(path.join('.'));
    }

    /**
     * Get all instances as a tree structure.
     */
    getAllInstances(): RobloxInstance[] {
        return this.treeInstances;
    }

    /**
     * Get the timestamp of the last successful sync.
     */
    getLastSyncTimestamp(): number {
        return this.lastSyncTimestamp;
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
                    this.instances.set(pathKey, change.instance);
                    // Also update tree structure
                    this.addToTree(change.path, change.instance);
                }
                break;

            case 'update':
                const inst = this.instances.get(pathKey);
                if (inst && change.type === 'update' && change.property) {
                    inst.properties[change.property.name] = change.property.value;
                    // Tree update is implicit via object reference
                }
                break;

            case 'delete':
                // Remove instance and all children from map
                const keysToDelete = Array.from(this.instances.keys()).filter(
                    key => key === pathKey || key.startsWith(pathKey + '.')
                );
                keysToDelete.forEach(key => this.instances.delete(key));

                // Remove from tree
                this.removeFromTree(change.path);
                break;
        }
    }

    /**
     * Add an instance to the hierarchical tree structure.
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
                // Check if same name exists - make it unique
                let uniqueName = instanceName;
                let counter = 2;

                while (this.treeInstances.some(i => i.name === uniqueName)) {
                    uniqueName = `${instanceName}_${counter}`;
                    counter++;
                }

                if (uniqueName !== instanceName) {
                    console.log(`🔄 Auto-renamed "${instanceName}" to "${uniqueName}" at root to avoid path collision`);
                    instance.name = uniqueName;
                    // Update the path in the flat map too
                    const oldPathKey = path.join('.');
                    const newPath = [...path.slice(0, -1), uniqueName];
                    const newPathKey = newPath.join('.');
                    this.instances.delete(oldPathKey);
                    this.instances.set(newPathKey, instance);
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
                // Check if same name exists - make it unique
                let uniqueName = instanceName;
                let counter = 2;

                while (parent.children.some(c => c.name === uniqueName)) {
                    uniqueName = `${instanceName}_${counter}`;
                    counter++;
                }

                if (uniqueName !== instanceName) {
                    console.log(`🔄 Auto-renamed "${path.join('.')}" to "${[...parentPath, uniqueName].join('.')}" to avoid path collision`);
                    instance.name = uniqueName;
                    // Update the path in the flat map too
                    const oldPathKey = path.join('.');
                    const newPath = [...parentPath, uniqueName];
                    const newPathKey = newPath.join('.');
                    this.instances.delete(oldPathKey);
                    this.instances.set(newPathKey, instance);
                }

                parent.children.push(instance);
            }
        }
    }

    /**
     * Remove an instance from the hierarchical tree structure.
     */
    private removeFromTree(path: string[]): void {
        if (path.length === 1) {
            this.treeInstances = this.treeInstances.filter(i => i.name !== path[0]);
            return;
        }

        const parentPath = path.slice(0, -1);
        const parent = this.instances.get(parentPath.join('.'));
        const targetName = path[path.length - 1];

        if (parent && parent.children) {
            parent.children = parent.children.filter(c => c.name !== targetName);
        }
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
                    // Different instance with same name - rename the new one
                    let uniqueName = inst.name;
                    let counter = 2;
                    let uniquePath = [...parentPath, uniqueName];
                    let uniquePathKey = uniquePath.join('.');

                    while (output.has(uniquePathKey)) {
                        uniqueName = `${inst.name}_${counter}`;
                        uniquePath = [...parentPath, uniqueName];
                        uniquePathKey = uniquePath.join('.');
                        counter++;
                    }

                    process.stdout.write(`[RESOLVE] Auto-renamed collision: ${pathKey} -> ${uniquePathKey}\n`);
                    inst.name = uniqueName;
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
     * Deduplicates based on path and type within a short time window.
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

        const pathKey = message.path.join('.');
        const now = Date.now();
        const DEDUP_WINDOW_MS = 1000; // 1 second deduplication window

        // Check for duplicate within the time window
        const isDuplicate = this.pendingChanges.some(
            c => !c.confirmed &&
                'path' in c &&
                c.path.join('.') === pathKey &&
                c.type === message.type &&
                now - c.timestamp < DEDUP_WINDOW_MS
        );

        if (isDuplicate) {
            process.stdout.write(`[SYNC] Suppressing redundant pending change: ${message.type}:${pathKey}\n`);
            return;
        }

        this.pendingChanges.push({
            ...message,
            id: randomUUID(),
            confirmed: false,
        });
    }
}
