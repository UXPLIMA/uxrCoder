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
    action: 'play' | 'run' | 'stop' | 'test_run' | 'test_abort';
    timestamp: number;
    runId?: string;
    payload?: Record<string, unknown>;
}

export interface LogMessage {
    type: 'log';
    level: 'info' | 'warning' | 'error';
    message: string;
    timestamp: number;
    source?: string;
}

export type DataModelSyncType = 'create' | 'update' | 'delete' | 'full_sync';

export interface ReparentInstanceMessage {
    type: 'reparent';
    timestamp: number;
    path: string[];
    newParentPath: string[];
    newName?: string;
}

export type SyncMessage =
    | { type: DataModelSyncType; timestamp: number; path: string[]; instance?: RobloxInstance; property?: { name: string; value: PropertyValue }; instances?: RobloxInstance[] }
    | CommandMessage
    | LogMessage
    | ReparentInstanceMessage;

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
    agent?: {
        capabilitiesEndpoint: string;
        bootstrapEndpoint?: string;
        snapshotEndpoint: string;
        schemaEndpoint: string;
    };
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

export interface AgentSnapshotInstance {
    id: string;
    className: string;
    name: string;
    path: string[];
    pathString: string;
    parentId: string | null;
    childIds: string[];
    properties: Record<string, PropertyValue>;
}

export interface AgentSnapshotResponse {
    revision: number;
    generatedAt: number;
    instances: AgentSnapshotInstance[];
}

interface AgentTargetById {
    targetId: string;
    targetPath?: never;
}

interface AgentTargetByPath {
    targetPath: string[];
    targetId?: never;
}

type AgentTarget = AgentTargetById | AgentTargetByPath;

interface AgentParentById {
    parentId: string;
    parentPath?: never;
}

interface AgentParentByPath {
    parentPath: string[];
    parentId?: never;
}

type AgentParentRef = AgentParentById | AgentParentByPath;

interface AgentNewParentById {
    newParentId: string;
    newParentPath?: never;
}

interface AgentNewParentByPath {
    newParentPath: string[];
    newParentId?: never;
}

type AgentNewParentRef = AgentNewParentById | AgentNewParentByPath;

export type AgentCommand =
    | ({
        op: 'create';
        className: string;
        name: string;
        properties?: Record<string, PropertyValue>;
    } & AgentParentRef)
    | ({
        op: 'update';
        property: string;
        value: PropertyValue;
    } & AgentTarget)
    | ({
        op: 'rename';
        name: string;
    } & AgentTarget)
    | ({
        op: 'delete';
    } & AgentTarget)
    | ({
        op: 'reparent';
    } & AgentTarget & AgentNewParentRef);

export interface AgentCommandResult {
    index: number;
    op: AgentCommand['op'];
    success: boolean;
    error?: string;
    resolvedPath?: string[];
    resolvedId?: string;
    conflict?: AgentConflictPayload;
}

export interface AgentConflictPayload {
    reason: 'not_found' | 'locked' | 'revision_mismatch' | 'validation_failed';
    expected: Record<string, unknown>;
    actual?: Record<string, unknown>;
}

export type AgentPropertyKind =
    | 'primitive'
    | 'enum'
    | 'struct'
    | 'instanceRef'
    | 'readonly'
    | 'unknown';

export interface AgentNumericConstraint {
    min?: number;
    max?: number;
    integer?: boolean;
    strict: boolean;
    source: 'observed' | 'builtin';
}

export interface AgentStringConstraint {
    minLength?: number;
    maxLength?: number;
    nonEmpty?: boolean;
    pattern?: string;
    strict: boolean;
    source: 'observed' | 'builtin';
}

export interface AgentEnumConstraint {
    allowedNames?: string[];
    allowedValues?: number[];
    strict: boolean;
    source: 'observed' | 'builtin';
}

export interface AgentPropertySchemaEntry {
    name: string;
    kind: AgentPropertyKind;
    kinds: AgentPropertyKind[];
    writable: boolean;
    nullable: boolean;
    valueType: string;
    valueTypes: string[];
    enumType?: string;
    enumTypes?: string[];
    numericConstraint?: AgentNumericConstraint;
    stringConstraint?: AgentStringConstraint;
    enumConstraint?: AgentEnumConstraint;
    serializerHint: string;
    deserializerHint: string;
    observedOn: number;
}

export interface AgentClassPropertySchema {
    className: string;
    instanceCount: number;
    properties: AgentPropertySchemaEntry[];
}

export interface AgentPropertySchemaResponse {
    schemaVersion: 'uxr-agent-property-schema/v1';
    generatedAt: number;
    revision: number;
    classes: AgentClassPropertySchema[];
}
