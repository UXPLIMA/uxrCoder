/**
 * @fileoverview TreeView provider for Roblox Explorer in VS Code.
 *
 * This module provides:
 * - Tree data provider for the Roblox instance hierarchy
 * - Tree item class with icons and context menus
 * - Icon mapping for different Roblox class types
 *
 * @author UXPLIMA
 * @license MIT
 */

import * as vscode from 'vscode';
import { SyncClient } from './syncClient';
import type { RobloxInstance } from './types';

// =============================================================================
// Icon Mapping
// =============================================================================

/**
 * Map of Roblox class names to VS Code ThemeIcon names.
 * Uses Codicons for consistent appearance across themes.
 *
 * @see https://code.visualstudio.com/api/references/icons-in-labels
 */
const CLASS_ICONS: Record<string, string> = {
    // Services
    Workspace: 'globe',
    Lighting: 'lightbulb',
    ReplicatedFirst: 'package',
    ReplicatedStorage: 'archive',
    ServerScriptService: 'server-process',
    ServerStorage: 'database',
    StarterGui: 'browser',
    StarterPack: 'briefcase',
    StarterPlayer: 'account',
    StarterPlayerScripts: 'code',
    StarterCharacterScripts: 'person',
    Teams: 'organization',
    SoundService: 'unmute',

    // Scripts
    Script: 'file-code',
    LocalScript: 'file-code',
    ModuleScript: 'file-symlink-file',

    // Core Instances
    Part: 'primitive-square',
    MeshPart: 'symbol-misc',
    Model: 'symbol-class',
    Folder: 'folder',
    Camera: 'device-camera',
    Terrain: 'globe',

    // Physics
    SpawnLocation: 'pinned',
    Seat: 'symbol-event',

    // GUI
    ScreenGui: 'browser',
    Frame: 'symbol-interface',
    TextLabel: 'symbol-text',
    TextButton: 'symbol-key',
    TextBox: 'text-size',
    ImageLabel: 'file-media',
    ImageButton: 'file-media',
    ScrollingFrame: 'list-selection',

    // Effects
    Sky: 'cloud',
    Atmosphere: 'cloud',
    SunRaysEffect: 'lightbulb',
    BloomEffect: 'sparkle',
    DepthOfFieldEffect: 'eye',
    ColorCorrectionEffect: 'color-mode',

    // Communication
    RemoteEvent: 'broadcast',
    RemoteFunction: 'symbol-method',
    BindableEvent: 'zap',
    BindableFunction: 'symbol-function',

    // Values
    StringValue: 'symbol-string',
    NumberValue: 'symbol-number',
    BoolValue: 'symbol-boolean',
    ObjectValue: 'symbol-object',
    IntValue: 'symbol-number',
    Color3Value: 'symbol-color',
    Vector3Value: 'symbol-ruler',
    CFrameValue: 'symbol-ruler',

    // Audio
    Sound: 'unmute',
    SoundGroup: 'folder',

    // Animation
    Animation: 'play',
    AnimationController: 'play-circle',
    Animator: 'play-circle',

    // Default
    default: 'symbol-misc',
};

// =============================================================================
// Tree Item Class
// =============================================================================

/**
 * Represents a single item in the Roblox Explorer tree view.
 * Each tree item corresponds to a Roblox instance.
 */
export class RobloxTreeItem extends vscode.TreeItem {
    /** Full path to this instance (e.g., ["Workspace", "Model", "Part"]) */
    public readonly path: string[];

    /**
     * Create a new tree item for a Roblox instance.
     *
     * @param instance - The Roblox instance data
     * @param collapsibleState - Whether the item can be expanded
     * @param parentPath - Path to the parent instance
     */
    constructor(
        public readonly instance: RobloxInstance,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        parentPath: string[] = []
    ) {
        super(instance.name, collapsibleState);

        // Build full path
        this.path = [...parentPath, instance.name];

        // Configure tooltip
        this.tooltip = this.buildTooltip();

        // Show class name as description
        this.description = instance.className;

        // Set icon based on class type
        this.iconPath = this.getIcon();

        // Set context value for menus
        this.contextValue = this.getContextValue();

        // Configure command for double-click
        this.configureCommand();
    }

    /**
     * Build the tooltip string for this item.
     */
    private buildTooltip(): string {
        const pathStr = this.path.join('.');
        return `${this.instance.className}: ${pathStr}`;
    }

    /**
     * Get the icon for this item based on its class.
     */
    private getIcon(): vscode.ThemeIcon {
        const iconName = CLASS_ICONS[this.instance.className] ?? CLASS_ICONS.default;
        return new vscode.ThemeIcon(iconName);
    }

    /**
     * Get the context value for right-click menus.
     */
    private getContextValue(): string {
        const isScript = ['Script', 'LocalScript', 'ModuleScript'].includes(this.instance.className);
        return isScript ? 'script' : 'instance';
    }

    /**
     * Configure the command executed on double-click.
     */
    private configureCommand(): void {
        const isScript = ['Script', 'LocalScript', 'ModuleScript'].includes(this.instance.className);

        if (isScript) {
            this.command = {
                command: 'robloxSync.openScript',
                title: 'Open Script',
                arguments: [this],
            };
        }
    }
}

// =============================================================================
// Tree Data Provider
// =============================================================================

/**
 * Provides data for the Roblox Explorer tree view.
 * Implements VS Code's TreeDataProvider interface.
 */
export class RobloxExplorerProvider implements vscode.TreeDataProvider<RobloxTreeItem> {
    /** Event emitter for tree data changes */
    private _onDidChangeTreeData = new vscode.EventEmitter<RobloxTreeItem | undefined | null | void>();

    /** Event that fires when tree data changes */
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    /** Cached instances from the sync client */
    private instances: RobloxInstance[] = [];

    /**
     * Create a new explorer provider.
     *
     * @param syncClient - The sync client for getting instance data
     */
    constructor(private syncClient: SyncClient) {
        // Update instances when sync client receives updates
        syncClient.onUpdate((instances: RobloxInstance[]) => {
            this.instances = instances;
            this._onDidChangeTreeData.fire();
        });
    }

    /**
     * Refresh the tree view.
     */
    refresh(): void {
        this.instances = this.syncClient.getAllInstances();
        this._onDidChangeTreeData.fire();
    }

    /**
     * Clear all instances from the tree view.
     */
    clear(): void {
        this.instances = [];
        this._onDidChangeTreeData.fire();
    }

    /**
     * Get a tree item for display.
     *
     * @param element - The tree item to get
     * @returns The tree item
     */
    getTreeItem(element: RobloxTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get the children of a tree item.
     *
     * @param element - The parent element, or undefined for root
     * @returns Array of child tree items
     */
    getChildren(element?: RobloxTreeItem): RobloxTreeItem[] {
        if (!element) {
            // Root level - return top-level services
            return this.instances.map(inst => this.createTreeItem(inst, []));
        }

        // Return children of the element
        const instance = element.instance;
        if (instance.children && instance.children.length > 0) {
            return instance.children.map(child => this.createTreeItem(child, element.path));
        }

        return [];
    }

    /**
     * Get the parent of a tree item.
     *
     * @param element - The child element
     * @returns The parent element, or undefined for root items
     */
    getParent(element: RobloxTreeItem): vscode.ProviderResult<RobloxTreeItem> {
        if (element.path.length <= 1) {
            return undefined;
        }

        // Find parent by path
        const parentPath = element.path.slice(0, -1);
        const parent = this.findInstance(this.instances, parentPath, 0);

        if (parent) {
            return this.createTreeItem(parent, parentPath.slice(0, -1));
        }

        return undefined;
    }

    /**
     * Create a tree item for an instance.
     *
     * @param instance - The instance data
     * @param parentPath - Path to the parent
     * @returns The created tree item
     */
    private createTreeItem(instance: RobloxInstance, parentPath: string[]): RobloxTreeItem {
        const hasChildren = instance.children && instance.children.length > 0;
        const collapsibleState = hasChildren
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;

        return new RobloxTreeItem(instance, collapsibleState, parentPath);
    }

    /**
     * Find an instance by path.
     *
     * @param instances - Array of instances to search
     * @param path - Path to find
     * @param index - Current path index
     * @returns The found instance, or undefined
     */
    private findInstance(
        instances: RobloxInstance[],
        path: string[],
        index: number
    ): RobloxInstance | undefined {
        if (index >= path.length) {
            return undefined;
        }

        const target = instances.find(i => i.name === path[index]);
        if (!target) {
            return undefined;
        }

        if (index === path.length - 1) {
            return target;
        }

        if (target.children) {
            return this.findInstance(target.children, path, index + 1);
        }

        return undefined;
    }
}
