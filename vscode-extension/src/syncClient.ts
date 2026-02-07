/**
 * @fileoverview SyncClient - WebSocket client for uxrCoder server communication.
 *
 * This module provides:
 * - WebSocket connection management
 * - Real-time instance updates
 * - Change synchronization API
 * - Automatic reconnection
 *
 * @author UXPLIMA
 * @license MIT
 */

import WebSocket from 'ws';
import type { RobloxInstance, SyncMessage, PropertyValue } from './types';

// =============================================================================
// Types
// =============================================================================

/** Callback type for instance updates */
type UpdateCallback = (instances: RobloxInstance[]) => void;

// =============================================================================
// SyncClient Class
// =============================================================================

/**
 * WebSocket client for communicating with the uxrCoder server.
 *
 * Manages the connection lifecycle and provides methods for
 * synchronizing instance state with Roblox Studio.
 *
 * @example
 * ```typescript
 * const client = new SyncClient('ws://127.0.0.1:34872');
 * await client.connect();
 * client.onUpdate(instances => console.log('Updated:', instances));
 * ```
 */
export class SyncClient {
    /** WebSocket connection */
    private ws: WebSocket | null = null;

    /** Current instance state */
    private instances: RobloxInstance[] = [];

    /** Registered update callbacks */
    private callbacks: UpdateCallback[] = [];

    /** Current reconnection attempt count */
    private reconnectAttempts = 0;

    /** Maximum reconnection attempts before giving up */
    private readonly maxReconnectAttempts = 5;

    /** Delay between reconnection attempts (ms) */
    private readonly reconnectDelay = 2000;

    /**
     * Create a new SyncClient.
     *
     * @param serverUrl - WebSocket URL of the sync server
     */
    constructor(private readonly serverUrl: string) { }

    // =========================================================================
    // Connection Management
    // =========================================================================

    /**
     * Connect to the sync server.
     *
     * @returns Promise that resolves when connected
     * @throws Error if connection fails
     */
    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.serverUrl);

                this.ws.on('open', () => {
                    console.log('🟢 Connected to uxrCoder server');
                    this.reconnectAttempts = 0;
                    resolve();
                });

                this.ws.on('message', (data: WebSocket.Data) => {
                    this.handleMessage(data);
                });

                this.ws.on('close', () => {
                    console.log('🔴 Disconnected from server');
                    this.handleDisconnect();
                });

                this.ws.on('error', (error: Error) => {
                    console.error('WebSocket error:', error.message);
                    reject(error);
                });

            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Disconnect from the sync server.
     */
    disconnect(): void {
        this.reconnectAttempts = this.maxReconnectAttempts; // Prevent reconnection
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.instances = [];
    }

    /**
     * Check if the client is connected.
     *
     * @returns True if connected
     */
    isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }

    // =========================================================================
    // Event Handling
    // =========================================================================

    /**
     * Register a callback for instance updates.
     *
     * @param callback - Function to call when instances update
     */
    onUpdate(callback: UpdateCallback): void {
        this.callbacks.push(callback);
    }

    /**
     * Handle incoming WebSocket messages.
     *
     * @param data - Raw message data
     */
    private handleMessage(data: WebSocket.Data): void {
        try {
            const message = JSON.parse(data.toString());

            if (message.type === 'full_sync') {
                // Full state refresh
                this.instances = message.instances || [];
                this.notifyCallbacks();
            } else if (['create', 'update', 'delete'].includes(message.type)) {
                // Incremental change
                this.applyChange(message as SyncMessage);
                this.notifyCallbacks();
            }
        } catch (error) {
            console.error('Failed to parse message:', error);
        }
    }

    /**
     * Handle disconnection and attempt reconnection.
     */
    private handleDisconnect(): void {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`Reconnecting... (attempt ${this.reconnectAttempts})`);

            setTimeout(() => {
                this.connect().catch(() => {
                    // Reconnection failed, will try again
                });
            }, this.reconnectDelay);
        }
    }

    /**
     * Notify all registered callbacks of updates.
     */
    private notifyCallbacks(): void {
        this.callbacks.forEach(cb => cb(this.instances));
    }

    // =========================================================================
    // State Management
    // =========================================================================

    /**
     * Apply an incremental change to the local state.
     *
     * @param message - The sync message to apply
     */
    private applyChange(message: SyncMessage): void {
        switch (message.type) {
            case 'create':
                if (message.instance) {
                    this.insertInstance(message.path, message.instance);
                }
                break;

            case 'update':
                this.updateInstance(message.path, message.property);
                break;

            case 'delete':
                this.removeInstance(message.path);
                break;
        }
    }

    /**
     * Insert a new instance into the tree.
     *
     * @param path - Path where the instance should be inserted
     * @param instance - The instance to insert
     */
    private insertInstance(path: string[], instance: RobloxInstance): void {
        if (path.length === 1) {
            // Root level insertion
            this.instances.push(instance);
            return;
        }

        // Find parent and add as child
        const parent = this.findInstance(path.slice(0, -1));
        if (parent) {
            if (!parent.children) {
                parent.children = [];
            }
            parent.children.push(instance);
        }
    }

    /**
     * Update an instance's property.
     *
     * @param path - Path to the instance
     * @param property - Property to update
     */
    private updateInstance(
        path: string[],
        property?: { name: string; value: PropertyValue }
    ): void {
        const instance = this.findInstance(path);
        if (instance && property) {
            instance.properties[property.name] = property.value;

            // Handle name change specially
            if (property.name === 'Name' && typeof property.value === 'string') {
                instance.name = property.value;
            }
        }
    }

    /**
     * Remove an instance from the tree.
     *
     * @param path - Path to the instance to remove
     */
    private removeInstance(path: string[]): void {
        if (path.length === 1) {
            // Root level removal
            this.instances = this.instances.filter(i => i.name !== path[0]);
            return;
        }

        // Find parent and remove from children
        const parent = this.findInstance(path.slice(0, -1));
        if (parent && parent.children) {
            const targetName = path[path.length - 1];
            parent.children = parent.children.filter(c => c.name !== targetName);
        }
    }

    /**
     * Find an instance by path.
     *
     * @param path - Path to the instance
     * @returns The instance if found, undefined otherwise
     */
    private findInstance(path: string[]): RobloxInstance | undefined {
        let current: RobloxInstance[] = this.instances;
        let found: RobloxInstance | undefined;

        for (const name of path) {
            found = current.find(i => i.name === name);
            if (!found) {
                return undefined;
            }
            current = found.children || [];
        }

        return found;
    }

    // =========================================================================
    // Public API
    // =========================================================================

    /**
     * Get all instances as a tree.
     *
     * @returns Array of root instances
     */
    getAllInstances(): RobloxInstance[] {
        return this.instances;
    }

    /**
     * Get a specific instance by path.
     *
     * @param path - Path to the instance
     * @returns The instance if found
     */
    getInstance(path: string[]): RobloxInstance | undefined {
        return this.findInstance(path);
    }

    /**
     * Create a new instance.
     *
     * @param parentPath - Path to the parent instance
     * @param className - Roblox class name
     * @param name - Instance name
     */
    createInstance(parentPath: string[], className: string, name: string): void {
        const message: SyncMessage = {
            type: 'create',
            timestamp: Date.now(),
            path: [...parentPath, name],
            instance: {
                id: this.generateId(),
                className,
                name,
                parent: parentPath.join('.'),
                properties: {},
                children: [],
            },
        };

        this.send(message);
    }

    /**
     * Delete an instance.
     *
     * @param path - Path to the instance to delete
     */
    deleteInstance(path: string[]): void {
        const message: SyncMessage = {
            type: 'delete',
            timestamp: Date.now(),
            path,
        };

        this.send(message);
    }

    /**
     * Update an instance property.
     *
     * @param path - Path to the instance
     * @param property - Property name
     * @param value - New property value
     */
    updateProperty(path: string[], property: string, value: PropertyValue): void {
        const message: SyncMessage = {
            type: 'update',
            timestamp: Date.now(),
            path,
            property: { name: property, value },
        };

        this.send(message);
    }

    // =========================================================================
    // Utilities
    // =========================================================================

    /**
     * Send a message to the server.
     *
     * @param message - The message to send
     */
    private send(message: SyncMessage): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            console.warn('Cannot send message: not connected');
        }
    }

    /**
     * Generate a unique ID for new instances.
     *
     * @returns A UUID string
     */
    private generateId(): string {
        // Use crypto.randomUUID if available, otherwise fallback
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        // Simple fallback UUID generation
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }
}
