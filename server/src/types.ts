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
    | Vector2Value
    | Vector3Value
    | CFrameValue
    | Color3Value
    | UDimValue
    | UDim2Value
    | BrickColorValue
    | NumberRangeValue
    | RectValue
    | EnumValue
    | Record<string, unknown>;

export interface Vector2Value {
    type: 'Vector2';
    x: number;
    y: number;
}

export interface Vector3Value {
    type: 'Vector3';
    x: number;
    y: number;
    z: number;
}

export interface CFrameValue {
    type: 'CFrame';
    position: Vector3Value;
    orientation: Vector3Value; // Euler angles
}

export interface Color3Value {
    type: 'Color3';
    r: number;
    g: number;
    b: number;
}

export interface UDimValue {
    type: 'UDim';
    scale: number;
    offset: number;
}

export interface UDim2Value {
    type: 'UDim2';
    x: UDimValue;
    y: UDimValue;
}

export interface BrickColorValue {
    type: 'BrickColor';
    number: number;
    name: string;
}

export interface NumberRangeValue {
    type: 'NumberRange';
    min: number;
    max: number;
}

export interface RectValue {
    type: 'Rect';
    min: Vector2Value;
    max: Vector2Value;
}

export interface EnumValue {
    type: 'Enum';
    enumType: string;
    value: number;
    name: string;
}

export interface CommandMessage {
    type: 'command';
    action: 'play' | 'run' | 'stop';
    timestamp: number;
}

export interface LogMessage {
    type: 'log';
    level: 'info' | 'warning' | 'error';
    message: string;
    timestamp: number;
    source?: string;
}

export type DataModelSyncType = 'create' | 'update' | 'delete' | 'full_sync';

export type SyncMessage =
    | { type: DataModelSyncType; timestamp: number; path: string[]; instance?: RobloxInstance; property?: { name: string; value: PropertyValue }; instances?: RobloxInstance[] }
    | CommandMessage
    | LogMessage;

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
    instanceCount?: number;  // Number of instances server has - plugin uses to detect if resync needed
}

export interface SyncResponse {
    success: boolean;
    changesApplied: number;
    error?: string;
}

export type PendingChange = SyncMessage & {
    id: string;
    confirmed: boolean;
};

export interface ProjectTree {
    $className?: string;
    $path?: string;
    $ignoreUnknownInstances?: boolean;
    [key: string]: ProjectTree | string | boolean | undefined;
}

export interface ProjectConfig {
    name: string;
    tree: ProjectTree;
    servePlaceIds?: number[];
    servePlaces?: string[];
}
