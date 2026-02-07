export interface RobloxInstance {
    id: string;
    className: string;
    name: string;
    parent: string | null;
    properties: Record<string, PropertyValue>;
    children: RobloxInstance[];
}
export type PropertyValue = string | number | boolean | Vector3 | Color3 | CFrame | UDim2 | null;
export interface Vector3 {
    type: 'Vector3';
    x: number;
    y: number;
    z: number;
}
export interface Color3 {
    type: 'Color3';
    r: number;
    g: number;
    b: number;
}
export interface CFrame {
    type: 'CFrame';
    position: Vector3;
    rotation: [number, number, number, number, number, number, number, number, number];
}
export interface UDim2 {
    type: 'UDim2';
    xScale: number;
    xOffset: number;
    yScale: number;
    yOffset: number;
}
export interface SyncMessage {
    type: 'create' | 'update' | 'delete' | 'full_sync';
    timestamp: number;
    path: string[];
    instance?: RobloxInstance;
    property?: {
        name: string;
        value: PropertyValue;
    };
}
export interface SyncState {
    placeId: string;
    placeName: string;
    lastSync: number;
    instances: Map<string, RobloxInstance>;
}
export interface ServerConfig {
    port: number;
    host: string;
    syncInterval: number;
    workspacePath: string;
}
export declare const ROBLOX_SERVICES: readonly ["Workspace", "Lighting", "MaterialService", "ReplicatedFirst", "ReplicatedStorage", "ServerScriptService", "ServerStorage", "StarterGui", "StarterPack", "StarterPlayer", "Teams", "SoundService", "TextChatService", "Players", "Chat"];
export type RobloxService = typeof ROBLOX_SERVICES[number];
export declare const INSTANCE_ICONS: Record<string, string>;
