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
import * as crypto from 'crypto';
import type { RobloxInstance, SyncMessage, PropertyValue, CommandMessage, LogMessage } from './types';

// =============================================================================
// Types
// =============================================================================

/** Callback type for instance updates */
type UpdateCallback = (instances: RobloxInstance[]) => void;
type LogCallback = (log: LogMessage) => void;

/** Connection status type */
export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'reconnecting' | 'error';

/** Callback type for status updates */
type StatusCallback = (status: ConnectionStatus, message?: string) => void;

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

    /** Registered log callbacks */
    private logCallbacks: LogCallback[] = [];

    /** Registered status callbacks */
    private statusCallbacks: StatusCallback[] = [];

    /** Current connection status */
    private status: ConnectionStatus = 'disconnected';

    /** Current reconnection attempt count */
    private reconnectAttempts = 0;

    /** Maximum reconnection attempts before giving up */
    private readonly maxReconnectAttempts = 10;

    /** Base delay between reconnection attempts (ms) */
    private readonly baseReconnectDelay = 1000;

    /** Maximum delay between reconnection attempts (ms) */
    private readonly maxReconnectDelay = 30000;

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
        if (this.status === 'connected') return;

        this.updateStatus('connecting');

        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.serverUrl);

                this.ws.on('open', () => {
                    console.log('🟢 Connected to uxrCoder server');
                    this.reconnectAttempts = 0;
                    this.updateStatus('connected');
                    resolve();
                });

                this.ws.on('message', (data: WebSocket.Data) => {
                    this.handleMessage(data);
                });

                this.ws.on('close', () => {
                    console.log('🔴 Disconnected from server');
                    this.updateStatus('disconnected');
                    this.handleDisconnect();
                });

                this.ws.on('error', (error: Error) => {
                    console.error('WebSocket error:', error.message);
                    if (this.status === 'connecting') {
                        this.updateStatus('error', error.message);
                        reject(error);
                    } else {
                        // If already connected, close handler will trigger reconnection
                        // Just log it here
                    }
                });

            } catch (error) {
                this.updateStatus('error', String(error));
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
     * Register a callback for log messages.
     *
     * @param callback - Function to call when a log is received
     */
    onLog(callback: LogCallback): void {
        this.logCallbacks.push(callback);
    }

    /**
     * Register a callback for status updates.
     *
     * @param callback - Function to call when connection status changes
     */
    onStatusChange(callback: StatusCallback): void {
        this.statusCallbacks.push(callback);
    }

    /**
     * Handle incoming WebSocket messages.
     *
     * @param data - Raw message data
     */
    private handleMessage(data: WebSocket.Data): void {
        try {
            const message = JSON.parse(data.toString());
            console.log(`📨 handleMessage: type=${message.type}, path=${message.path?.join('.') || 'N/A'}`);

            if (message.type === 'full_sync') {
                // Full state refresh
                console.log(`📦 full_sync received with ${message.instances?.length || 0} instances`);
                this.instances = message.instances || [];
                this.notifyCallbacks();
            } else if (['create', 'update', 'delete'].includes(message.type)) {
                // Incremental change from server
                console.log(`🔄 Applying ${message.type} for ${message.path?.join('.')}`);
                this.applyChange(message as SyncMessage);
                this.notifyCallbacks();
            } else if (message.type === 'log') {
                this.notifyLogCallbacks(message as LogMessage);
            }
        } catch (error) {
            console.error('Failed to parse message:', error);
        }
    }

    /**
     * Handle disconnection and attempt reconnection.
     */
    /**
     * Handle disconnection and attempt reconnection.
     */
    private handleDisconnect(): void {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;

            // Exponential backoff: base * 2^attempts
            // Example: 1s, 2s, 4s, 8s, 16s...
            // Capped at maxReconnectDelay
            const delay = Math.min(
                this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
                this.maxReconnectDelay
            );

            console.log(`Reconnecting... (attempt ${this.reconnectAttempts}, delay ${delay}ms)`);
            this.updateStatus('reconnecting', `Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

            setTimeout(() => {
                this.connect().catch(() => {
                    // Reconnection failed, will try again via close handler
                    // or if connect() throws immediately for some reason
                    if (this.status !== 'connected' && this.status !== 'reconnecting') {
                        this.handleDisconnect();
                    }
                });
            }, delay);
        } else {
            this.updateStatus('error', 'Max reconnection attempts reached');
        }
    }

    /**
     * Update internal status and notify callbacks.
     */
    private updateStatus(status: ConnectionStatus, message?: string): void {
        this.status = status;
        this.statusCallbacks.forEach(cb => cb(status, message));
    }

    /**
     * Notify all registered callbacks of updates.
     */
    private notifyCallbacks(): void {
        this.callbacks.forEach(cb => cb(this.instances));
    }

    /**
     * Notify all registered log callbacks.
     */
    private notifyLogCallbacks(log: LogMessage): void {
        this.logCallbacks.forEach(cb => cb(log));
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
     * Skips insertion if an instance with the same name already exists at the same level.
     *
     * @param path - Path where the instance should be inserted
     * @param instance - The instance to insert
     */
    private insertInstance(path: string[], instance: RobloxInstance): void {
        // Check if instance already exists at this path
        const existing = this.findInstance(path);
        if (existing) {
            // Check if it's the same instance by ID
            if (existing.id === instance.id) {
                console.log(`🔄 Updating existing instance: ${path.join('.')}`);
                // Update the existing instance
                Object.assign(existing, instance);
                return;
            } else {
                console.log(`⚠️ Path collision: ${path.join('.')} - IDs: ${existing.id} vs ${instance.id}`);
                console.log(`   Skipping duplicate to prevent conflicts`);
                return;
            }
        }

        if (path.length === 1) {
            // Root level insertion - check for duplicate at root
            const existingRoot = this.instances.find(i => i.name === instance.name);
            if (existingRoot && existingRoot.id !== instance.id) {
                console.log(`⚠️ Duplicate name at root: ${instance.name}`);
                return;
            }
            if (!existingRoot) {
                this.instances.push(instance);
            }
            return;
        }

        // Find parent and add as child
        const parent = this.findInstance(path.slice(0, -1));
        if (parent) {
            if (!parent.children) {
                parent.children = [];
            }
            // Check for duplicate child
            const existingChild = parent.children.find(c => c.name === instance.name);
            if (existingChild) {
                if (existingChild.id === instance.id) {
                    // Update existing
                    Object.assign(existingChild, instance);
                } else {
                    console.log(`⚠️ Duplicate child name: ${path.join('.')}`);
                }
                return;
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
        console.log(`🗑️ Removing instance: ${path.join('.')}`);
        
        if (path.length === 1) {
            // Root level removal
            const sizeBefore = this.instances.length;
            this.instances = this.instances.filter(i => i.name !== path[0]);
            console.log(`   Root removal: ${sizeBefore} -> ${this.instances.length}`);
            return;
        }

        // Find parent and remove from children
        const parent = this.findInstance(path.slice(0, -1));
        if (parent && parent.children) {
            const targetName = path[path.length - 1];
            const sizeBefore = parent.children.length;
            parent.children = parent.children.filter(c => c.name !== targetName);
            console.log(`   Child removal from ${path.slice(0, -1).join('.')}: ${sizeBefore} -> ${parent.children.length}`);
        } else {
            console.log(`   ⚠️ Parent not found for path: ${path.slice(0, -1).join('.')}`);
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
        // Initialize properties - add Source for script types
        const properties: Record<string, PropertyValue> = {};
        const scriptTypes = ['Script', 'LocalScript', 'ModuleScript'];

        if (scriptTypes.includes(className)) {
            // Set empty Source for script types so they can be edited
            properties.Source = '';
        }

        const newInstance: RobloxInstance = {
            id: this.generateId(),
            className,
            name,
            parent: parentPath.join('.'),
            properties,
            children: [],
        };

        const message: SyncMessage = {
            type: 'create',
            timestamp: Date.now(),
            path: [...parentPath, name],
            instance: newInstance,
        };

        // Apply locally FIRST so full_sync doesn't overwrite
        this.insertInstance([...parentPath, name], newInstance);
        this.notifyCallbacks();

        // Then send to server
        this.send(message);
    }

    /**
     * Delete an instance.
     *
     * @param path - Path to the instance to delete
     */
    deleteInstance(path: string[]): void {
        // Apply locally FIRST
        this.removeInstance(path);
        this.notifyCallbacks();

        // Then send to server
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
        // Apply locally FIRST
        this.updateInstance(path, { name: property, value });
        this.notifyCallbacks();

        // Then send to server
        const message: SyncMessage = {
            type: 'update',
            timestamp: Date.now(),
            path,
            property: { name: property, value },
        };

        this.send(message);
    }

    /**
     * Send a command to the server (Play/Run/Stop).
     *
     * @param action - The command action
     */
    sendCommand(action: 'play' | 'run' | 'stop'): void {
        const message: CommandMessage = {
            type: 'command',
            action,
            timestamp: Date.now(),
        };
        this.send(message);
    }

    /**
     * Build the project to the specified format.
     * 
     * @param format - Output format (e.g., 'rbxlx')
     * @returns The path to the built file
     */
    async buildProject(format: string = 'rbxlx'): Promise<string> {
        // Convert WS URL to HTTP URL
        const httpUrl = this.serverUrl.replace(/^ws/, 'http');

        try {
            // Use native fetch if available (Node 18+ or VS Code)
            const response = await fetch(`${httpUrl}/build/${format}`, {
                method: 'POST'
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Build failed: ${response.statusText} - ${errorText}`);
            }

            const data = await response.json() as { success: boolean; path: string };
            return data.path;
        } catch (error) {
            console.error('Build request failed:', error);
            throw error;
        }
    }

    /**
     * Export a specific instance to .rbxmx.
     * 
     * @param path - Path to the instance to export
     * @returns The path to the exported file
     */
    async exportInstance(path: string[]): Promise<string> {
        const httpUrl = this.serverUrl.replace(/^ws/, 'http');

        try {
            const response = await fetch(`${httpUrl}/build/rbxmx`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Export failed: ${response.statusText} - ${errorText}`);
            }

            const data = await response.json() as { success: boolean; path: string };
            return data.path;
        } catch (error) {
            console.error('Export request failed:', error);
            throw error;
        }
    }

    /**
     * Request sourcemap regeneration.
     */
    async regenerateSourcemap(): Promise<void> {
        const httpUrl = this.serverUrl.replace(/^ws/, 'http');

        try {
            const response = await fetch(`${httpUrl}/sourcemap/regenerate`, {
                method: 'POST'
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Regeneration failed: ${response.statusText} - ${errorText}`);
            }
        } catch (error) {
            console.error('Regeneration request failed:', error);
            throw error;
        }
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
