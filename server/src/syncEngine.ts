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

import type { RobloxInstance, SyncMessage, PropertyValue, PendingChange } from './types';

/**
 * Core synchronization engine that manages state between Roblox Studio and editors.
 *
 * The SyncEngine maintains two representations of the DataModel:
 * 1. A flat Map for efficient lookups by path
 * 2. A tree structure for hierarchical display
 *
 * @example
 * ```typescript
 * const engine = new SyncEngine();
 * const changes = engine.updateFromPlugin(instances);
 * const allInstances = engine.getAllInstances();
 * ```
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
     *
     * This method compares the incoming state with the current state and
     * returns a list of detected changes (creates, updates, deletes).
     *
     * @param pluginInstances - Array of root instances from the plugin
     * @returns Array of detected changes
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
     * Get changes waiting to be applied by the Roblox plugin.
     * These are changes made in the editor that need to sync to Studio.
     *
     * @returns Array of unconfirmed pending changes
     */
    getPendingChangesForPlugin(): PendingChange[] {
        return this.pendingChanges.filter(c => !c.confirmed);
    }

    /**
     * Mark changes as confirmed (successfully applied by plugin).
     *
     * @param ids - Array of change IDs to confirm
     */
    confirmChanges(ids: string[]): void {
        const idSet = new Set(ids);

        for (const change of this.pendingChanges) {
            if (idSet.has(change.id)) {
                change.confirmed = true;
            }
        }

        // Clean up old confirmed changes (keep for 60 seconds for debugging)
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
     *
     * @param message - The sync message containing the change
     */
    applyChange(message: SyncMessage): void {
        const pathKey = message.path.join('.');

        switch (message.type) {
            case 'create':
                if (message.instance) {
                    this.instances.set(pathKey, message.instance);
                    this.addPendingChange(message);
                }
                break;

            case 'update':
                const inst = this.instances.get(pathKey);
                if (inst && message.property) {
                    inst.properties[message.property.name] = message.property.value;
                    this.addPendingChange(message);
                }
                break;

            case 'delete':
                // Remove instance and all children
                const keysToDelete = Array.from(this.instances.keys()).filter(
                    key => key === pathKey || key.startsWith(pathKey + '.')
                );
                keysToDelete.forEach(key => this.instances.delete(key));
                this.addPendingChange(message);
                break;
        }
    }

    /**
     * Get instance by path.
     *
     * @param path - Array of instance names forming the path
     * @returns The instance if found, undefined otherwise
     */
    getInstance(path: string[]): RobloxInstance | undefined {
        return this.instances.get(path.join('.'));
    }

    /**
     * Get all instances as a tree structure.
     * Used by VS Code extension for tree view display.
     *
     * @returns Array of root instances with children
     */
    getAllInstances(): RobloxInstance[] {
        return this.treeInstances;
    }

    /**
     * Get the timestamp of the last successful sync.
     *
     * @returns Unix timestamp in milliseconds
     */
    getLastSyncTimestamp(): number {
        return this.lastSyncTimestamp;
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    /**
     * Flatten a tree of instances into a Map for efficient lookups.
     *
     * @param instances - Array of instances to flatten
     * @param parentPath - Current path prefix
     * @param output - Map to populate with flattened instances
     */
    private flattenInstances(
        instances: RobloxInstance[],
        parentPath: string[],
        output: Map<string, RobloxInstance>
    ): void {
        for (const inst of instances) {
            const path = [...parentPath, inst.name];
            const pathKey = path.join('.');
            output.set(pathKey, inst);

            if (inst.children && inst.children.length > 0) {
                this.flattenInstances(inst.children, path, output);
            }
        }
    }

    /**
     * Detect property changes between two instances.
     *
     * @param oldInst - Previous instance state
     * @param newInst - Current instance state
     * @param path - Path to the instance
     * @returns Array of update messages for changed properties
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
     * Handles complex types like Vector3, Color3, etc.
     *
     * @param a - First value
     * @param b - Second value
     * @returns True if values are equal
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
     *
     * @param message - The sync message to queue
     */
    private addPendingChange(message: SyncMessage): void {
        this.pendingChanges.push({
            ...message,
            id: crypto.randomUUID(),
            confirmed: false,
        });
    }
}
