/**
 * @fileoverview Shared TypeScript type definitions for uxrCoder.
 * Server-local copy for proper module resolution.
 * @module types
 */

/**
 * Represents a serialized Roblox Instance.
 */
export interface RobloxInstance {
    id: string;
    className: string;
    name: string;
    parent: string | null;
    properties: Record<string, PropertyValue>;
    children?: RobloxInstance[];
}

/**
 * Property value types.
 */
export type PropertyValue =
    | string
    | number
    | boolean
    | null
    | Vector3Value
    | Color3Value
    | UDim2Value
    | Record<string, unknown>;

export interface Vector3Value {
    type: 'Vector3';
    x: number;
    y: number;
    z: number;
}

export interface Color3Value {
    type: 'Color3';
    r: number;
    g: number;
    b: number;
}

export interface UDim2Value {
    type: 'UDim2';
    xScale: number;
    xOffset: number;
    yScale: number;
    yOffset: number;
}

export type SyncMessageType = 'create' | 'update' | 'delete' | 'full_sync';

export interface SyncMessage {
    type: SyncMessageType;
    timestamp: number;
    path: string[];
    instance?: RobloxInstance;
    property?: { name: string; value: PropertyValue };
    instances?: RobloxInstance[];
}

export interface ServerConfig {
    port: number;
    host: string;
    syncInterval: number;
    workspacePath: string;
}

export interface HealthResponse {
    status: 'ok' | 'error';
    timestamp: number;
    version?: string;
}

export interface SyncResponse {
    success: boolean;
    changesApplied: number;
    error?: string;
}

export interface PendingChange extends SyncMessage {
    id: string;
    confirmed: boolean;
}
