/**
 * @fileoverview Shared TypeScript type definitions for uxrCoder.
 * These types are used across the server and VS Code extension.
 * @module types
 */

/**
 * Represents a serialized Roblox Instance.
 * This structure mirrors the Roblox DataModel hierarchy.
 */
export interface RobloxInstance {
    /** Unique identifier for the instance (from Roblox GetDebugId) */
    id: string;

    /** The Roblox ClassName (e.g., "Part", "Script", "Folder") */
    className: string;

    /** The Name property of the instance */
    name: string;

    /** Full path to parent instance (e.g., "Workspace.Models") */
    parent: string | null;

    /** Instance properties as key-value pairs */
    properties: Record<string, PropertyValue>;

    /** Child instances */
    children?: RobloxInstance[];
}

/**
 * Represents a property value that can be sent over the wire.
 * Complex Roblox types are serialized to JSON-compatible formats.
 */
export type PropertyValue =
    | string
    | number
    | boolean
    | null
    | Vector3Value
    | Color3Value
    | UDim2Value
    | CFrameValue
    | Record<string, unknown>;

/**
 * Serialized Vector3 value.
 */
export interface Vector3Value {
    type: 'Vector3';
    x: number;
    y: number;
    z: number;
}

/**
 * Serialized Color3 value.
 */
export interface Color3Value {
    type: 'Color3';
    r: number;
    g: number;
    b: number;
}

/**
 * Serialized UDim2 value for GUI elements.
 */
export interface UDim2Value {
    type: 'UDim2';
    xScale: number;
    xOffset: number;
    yScale: number;
    yOffset: number;
}

/**
 * Serialized CFrame value for positioning and rotation.
 */
export interface CFrameValue {
    type: 'CFrame';
    position: Vector3Value;
    rotation: number[];
}

/**
 * Message types for synchronization events.
 */
export type SyncMessageType = 'create' | 'update' | 'delete' | 'full_sync';

/**
 * Represents a synchronization message between components.
 * Used for both plugin→server and server→extension communication.
 */
export interface SyncMessage {
    /** Type of synchronization operation */
    type: SyncMessageType;

    /** Unix timestamp when the message was created */
    timestamp: number;

    /** Path to the affected instance (e.g., ["Workspace", "Model", "Part"]) */
    path: string[];

    /** The instance data (for create operations) */
    instance?: RobloxInstance;

    /** Property change (for update operations) */
    property?: {
        name: string;
        value: PropertyValue;
    };

    /** Full instance tree (for full_sync operations) */
    instances?: RobloxInstance[];
}

/**
 * Server configuration options.
 */
export interface ServerConfig {
    /** Port number for HTTP and WebSocket server */
    port: number;

    /** Host address to bind to */
    host: string;

    /** Sync interval in milliseconds */
    syncInterval: number;

    /** Path to workspace directory for file mapping */
    workspacePath: string;
}

/**
 * Connection status for monitoring.
 */
export interface ConnectionStatus {
    /** Whether the connection is active */
    connected: boolean;

    /** Last successful sync timestamp */
    lastSync: number;

    /** Number of pending changes */
    pendingChanges: number;

    /** Error message if any */
    error?: string;
}

/**
 * API response for health check endpoint.
 */
export interface HealthResponse {
    status: 'ok' | 'error';
    timestamp: number;
    version?: string;
    instanceCount?: number;
    agent?: {
        capabilitiesEndpoint: string;
        bootstrapEndpoint?: string;
        snapshotEndpoint: string;
        schemaEndpoint: string;
    };
}

/**
 * API response for sync endpoint.
 */
export interface SyncResponse {
    success: boolean;
    changesApplied: number;
    error?: string;
}

/**
 * API response for changes endpoint.
 */
export interface ChangesResponse {
    changes: PendingChange[];
}

/**
 * Pending change waiting to be applied by the plugin.
 */
export interface PendingChange extends SyncMessage {
    /** Unique identifier for this change */
    id: string;

    /** Whether the change has been confirmed by the plugin */
    confirmed: boolean;
}
