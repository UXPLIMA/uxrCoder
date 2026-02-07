"use strict";
// RobloxSync Shared Type Definitions
Object.defineProperty(exports, "__esModule", { value: true });
exports.INSTANCE_ICONS = exports.ROBLOX_SERVICES = void 0;
// Roblox Service Names (root level)
exports.ROBLOX_SERVICES = [
    'Workspace',
    'Lighting',
    'MaterialService',
    'ReplicatedFirst',
    'ReplicatedStorage',
    'ServerScriptService',
    'ServerStorage',
    'StarterGui',
    'StarterPack',
    'StarterPlayer',
    'Teams',
    'SoundService',
    'TextChatService',
    'Players',
    'Chat'
];
// Icon mapping for VS Code tree view
exports.INSTANCE_ICONS = {
    // Services
    Workspace: 'workspace',
    Lighting: 'lighting',
    ReplicatedStorage: 'replicated-storage',
    ServerScriptService: 'server-script-service',
    ServerStorage: 'server-storage',
    StarterGui: 'starter-gui',
    StarterPack: 'starter-pack',
    StarterPlayer: 'starter-player',
    Teams: 'teams',
    SoundService: 'sound-service',
    Players: 'players',
    // Common Instances
    Part: 'part',
    MeshPart: 'mesh-part',
    Model: 'model',
    Folder: 'folder',
    Script: 'script',
    LocalScript: 'local-script',
    ModuleScript: 'module-script',
    Camera: 'camera',
    Terrain: 'terrain',
    SpawnLocation: 'spawn-location',
    RemoteEvent: 'remote-event',
    RemoteFunction: 'remote-function',
    BindableEvent: 'bindable-event',
    BindableFunction: 'bindable-function',
    // UI
    ScreenGui: 'screen-gui',
    Frame: 'frame',
    TextLabel: 'text-label',
    TextButton: 'text-button',
    ImageLabel: 'image-label',
    ImageButton: 'image-button',
    // Effects
    Atmosphere: 'atmosphere',
    Sky: 'sky',
    Bloom: 'bloom',
    DepthOfField: 'depth-of-field',
    SunRays: 'sun-rays',
};
