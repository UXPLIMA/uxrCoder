/**
 * @fileoverview FileMapper - Maps Roblox instances to filesystem.
 *
 * This module handles:
 * - Creating directory structure for instances
 * - Writing script files (.lua, .server.lua, .client.lua)
 * - Managing metadata files (.meta.json)
 *
 * @author UXPLIMA
 * @license MIT
 */

import * as fs from 'fs';
import * as path from 'path';
import type { RobloxInstance, SyncMessage, ProjectConfig, ProjectTree } from './types';

/** Roblox classes that contain Luau source code */
export const SCRIPT_CLASSES = ['Script', 'LocalScript', 'ModuleScript'] as const;

/** File extension mapping for different script types */
export const SCRIPT_EXTENSIONS: Record<string, string> = {
    Script: '.server.lua',
    LocalScript: '.client.lua',
    ModuleScript: '.lua',
};

/** File extension mapping for data types */
export const DATA_EXTENSIONS: Record<string, string> = {
    StringValue: '.txt',
    LocalizationTable: '.csv'
};

/**
 * Maps Roblox instances to the filesystem for external editing.
 * Support for project configuration mapping.
 */
export class FileMapper {
    /** Callback to notify when a file is written */
    private onWriteCallback: ((path: string) => void) | null = null;

    /** Reference to sync engine for looking up instances */
    private syncEngineRef: any = null;

    /**
     * Create a new FileMapper instance.
     *
     * @param basePath - Root directory for file output
     * @param config - Optional project configuration
     */
    constructor(private basePath: string, private config: ProjectConfig | null = null) {
        this.ensureDir(basePath);
    }

    /**
     * Register a callback to be invoked when a file is written.
     */
    public onWrite(callback: (path: string) => void): void {
        this.onWriteCallback = callback;
    }

    /**
     * Set reference to sync engine for instance lookups.
     */
    public setSyncEngine(syncEngine: any): void {
        this.syncEngineRef = syncEngine;
    }

    /**
     * Get instance by path from sync engine.
     */
    private getInstanceByPath(path: string[]): RobloxInstance | undefined {
        if (!this.syncEngineRef) return undefined;
        return this.syncEngineRef.getInstance(path);
    }

    /**
     * Notify listeners that a file was written.
     */
    private notifyWrite(filePath: string): void {
        if (this.onWriteCallback) {
            this.onWriteCallback(filePath);
        }
    }

    /**
     * Check if any ancestor in the path is a script class.
     * Scripts are leaf nodes and cannot have children in the file system.
     */
    private hasScriptAncestor(path: string[]): boolean {
        // Check each ancestor in the path
        for (let i = 1; i < path.length; i++) {
            const ancestorPath = path.slice(0, i);
            const ancestor = this.getInstanceByPath(ancestorPath);

            if (ancestor && this.isScriptClass(ancestor.className)) {
                return true;
            }
        }
        return false;
    }

    // =========================================================================
    // Public API
    // =========================================================================

    /**
     * Resolve Roblox path to File System path.
     */
    public getFsPath(robloxPath: string[]): string {
        if (!this.config) {
            return path.join(this.basePath, ...robloxPath);
        }

        let currentTree: ProjectTree | undefined = this.config.tree;
        let mappedPath = this.basePath;
        let remainingPath = [...robloxPath];

        // Find the deepest matching path in the project tree
        for (let i = 0; i < robloxPath.length; i++) {
            const segment = robloxPath[i];

            // Check if current tree node has a child matching the segment
            const childNode = currentTree?.[segment];

            if (typeof childNode === 'object' && childNode !== null) {
                currentTree = childNode as ProjectTree;
                if (currentTree.$path) {
                    mappedPath = path.join(this.basePath, currentTree.$path);
                    remainingPath = robloxPath.slice(i + 1);
                }
            } else {
                break;
            }
        }

        return path.join(mappedPath, ...remainingPath);
    }

    /**
     * Resolve File System path to Roblox path.
     * Returns null if the file is not part of the project.
     */
    public getRobloxPath(filePath: string): string[] | null {
        // Resolve absolute path
        const absPath = path.resolve(filePath);

        if (!this.config) {
            const rel = path.relative(this.basePath, absPath);
            if (rel.startsWith('..')) return null;
            return this.fileToRobloxPath(rel.split(path.sep));
        }

        // Cache this flattening if performance becomes an issue
        const mappings = this.getMappings(this.config.tree, [], this.basePath);

        // Sort by fsPath length descending to find most specific match first
        mappings.sort((a, b) => b.fsPath.length - a.fsPath.length);

        for (const mapping of mappings) {
            if (absPath.startsWith(mapping.fsPath)) {
                const rel = path.relative(mapping.fsPath, absPath);
                // If file is exactly the mapped folder, rel is empty string
                const parts = rel ? rel.split(path.sep) : [];

                const robloxParts = this.fileToRobloxPath(parts);
                return [...mapping.robloxPath, ...robloxParts];
            }
        }

        return null;
    }

    private getMappings(tree: ProjectTree, currentRobloxPath: string[], parentFsPath: string): { robloxPath: string[], fsPath: string }[] {
        let results: { robloxPath: string[], fsPath: string }[] = [];

        // If this node has a path, use it as the new base
        let currentFsPath = parentFsPath;
        if (tree.$path) {
            currentFsPath = path.resolve(this.basePath, tree.$path);
            results.push({ robloxPath: currentRobloxPath, fsPath: currentFsPath });
        }

        for (const key in tree) {
            if (key.startsWith('$')) continue;
            const childUserVal = tree[key];

            if (typeof childUserVal === 'object' && childUserVal !== null) {
                results = results.concat(this.getMappings(childUserVal as ProjectTree, [...currentRobloxPath, key], currentFsPath));
            }
        }
        return results;
    }

    private fileToRobloxPath(parts: string[]): string[] {
        if (parts.length === 0) return [];

        const lastPart = parts[parts.length - 1];
        let name = lastPart;
        let isInit = false;

        // Handle init files (init.server.lua -> parent folder)
        if (name === 'init.lua' || name === 'init.server.lua' || name === 'init.client.lua' || name === 'init.meta.json') {
            isInit = true;
        }

        // Remove extensions
        for (const ext of Object.values(SCRIPT_EXTENSIONS)) {
            if (name.endsWith(ext)) {
                name = name.slice(0, -ext.length);
                break;
            }
        }
        if (name === lastPart) { // Only check data extensions if script check didn't match
            for (const ext of Object.values(DATA_EXTENSIONS)) {
                if (name.endsWith(ext)) {
                    name = name.slice(0, -ext.length);
                    break;
                }
            }
        }

        if (name.endsWith('.meta.json')) {
            name = name.slice(0, -'.meta.json'.length);
        }

        const result = parts.slice(0, -1);
        if (!isInit) {
            result.push(name);
        }
        return result;
    }

    /**
     * Sync all instances to the filesystem.
     * Creates directories and files for the entire DataModel tree.
     *
     * @param instances - Array of root instances to sync
     */
    syncAllToFiles(instances: RobloxInstance[]): void {
        for (const inst of instances) {
            this.syncInstanceRecursive(inst, []);
        }
    }

    /**
     * Apply a single sync message to the filesystem.
     * Used for incremental updates from the editor.
     *
     * @param message - The sync message to apply
     */
    syncToFiles(message: SyncMessage): void {
        // Calculate the FS path based on the parent path + name (if create) or full path (update)
        // For create, we need to know the parent's FS path and append the instance name?
        // Actually, resolveFsPath works on the full Roblox path.

        if (message.type === 'command' || message.type === 'log') {
            return;
        }

        const robloxPath = message.path;
        const fsPath = this.getFsPath(robloxPath);

        switch (message.type) {
            case 'create':
                this.handleCreate(message, fsPath);
                break;

            case 'update':
                this.handleUpdate(message, fsPath);
                break;

            case 'delete':
                this.handleDelete(message, fsPath);
                break;
        }
    }

    // =========================================================================
    // Private Methods - Sync Operations
    // =========================================================================

    /**
     * Recursively sync an instance and its children to the filesystem.
     *
     * @param inst - The instance to sync
     * @param parentRobloxPath - Roblox path to parent
     */
    private syncInstanceRecursive(inst: RobloxInstance, parentRobloxPath: string[]): void {
        const robloxPath = [...parentRobloxPath, inst.name];
        const instancePath = this.getFsPath(robloxPath);

        if (this.isScriptClass(inst.className)) {
            // Write script file
            this.writeScriptFile(inst, instancePath);

            // Scripts are leaf nodes - they should NOT have children in the file system
            // If they do have children, log a warning and skip them
            if (inst.children && inst.children.length > 0) {
                process.stdout.write(`[WARNING] Script node "${inst.name}" contains ${inst.children.length} children. File system mapping suppressed for script children.\n`);
            }
            return; // Don't process children for scripts
        } else if (this.isDataClass(inst.className)) {
            // Write data file (.txt, .csv)
            this.writeDataFile(inst, instancePath);
            return; // Data files are also leaf nodes
        } else {
            // Create directory for non-script instances
            this.ensureDir(instancePath);
            this.writeMetaFile(inst, instancePath);
        }

        // Process children only for non-leaf nodes (folders, models, etc.)
        if (inst.children && inst.children.length > 0) {
            for (const child of inst.children) {
                this.syncInstanceRecursive(child, robloxPath);
            }
        }
    }

    /**
     * Handle create operation from sync message.
     */
    private handleCreate(message: SyncMessage, instancePath: string): void {
        if (message.type !== 'create' || !message.instance) return;

        // Check if any ancestor is a script - scripts cannot have children in file system
        if (this.hasScriptAncestor(message.path)) {
            process.stdout.write(`[SKIP] Creation suppressed for "${message.path.join('.')}" due to script ancestor restriction.\n`);
            return;
        }

        if (this.isScriptClass(message.instance.className)) {
            this.writeScriptFile(message.instance, instancePath);
        } else if (this.isDataClass(message.instance.className)) {
            this.writeDataFile(message.instance, instancePath);
        } else {
            this.ensureDir(instancePath);
            this.writeMetaFile(message.instance, instancePath);
        }
    }

    /**
     * Handle update operation from sync message.
     */
    private handleUpdate(message: SyncMessage, instancePath: string): void {
        if (message.type !== 'update' || !message.property) return;

        // Get the instance from syncEngine to check its className
        // (Update messages don't include the full instance)
        const instance = this.getInstanceByPath(message.path);
        if (!instance) return;

        // Check if any ancestor is a script - scripts' children don't have files
        if (this.hasScriptAncestor(message.path)) {
            process.stdout.write(`[SKIP] Update suppressed for "${message.path.join('.')}" due to script ancestor restriction.\n`);
            return;
        }

        if (message.property.name === 'Source' && this.isScriptClass(instance.className)) {
            // Update script source
            const ext = this.getScriptExtension(instance.className);
            const filePath = instancePath + ext;

            if (fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, String(message.property.value), 'utf-8');
                this.notifyWrite(filePath);
            }
        } else if (this.isDataProperty(instance.className, message.property.name)) {
            // Update data file content
            const ext = this.getDataExtension(instance.className);
            const filePath = instancePath + ext;

            if (fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, String(message.property.value), 'utf-8');
                this.notifyWrite(filePath);
            }
        } else {
            // Update metadata - need to update the entire instance's metadata
            // We'll need to get the full instance for this
            this.writeMetaFile(instance, instancePath);
        }
    }

    /**
     * Handle delete operation from sync message.
     */
    private handleDelete(message: SyncMessage, instancePath: string): void {
        // Check if any ancestor is a script - scripts' children don't have files
        if (message.type === 'delete' && this.hasScriptAncestor(message.path)) {
            process.stdout.write(`[SKIP] Deletion suppressed for "${message.path.join('.')}" due to script ancestor restriction.\n`);
            return;
        }

        // Get instance info before it's deleted (if still available)
        const instance = message.type === 'delete' ? this.getInstanceByPath(message.path) : undefined;

        if (instance) {
            // Delete based on instance type
            if (this.isScriptClass(instance.className)) {
                const ext = this.getScriptExtension(instance.className);
                const scriptPath = instancePath + ext;
                if (fs.existsSync(scriptPath)) {
                    fs.unlinkSync(scriptPath);
                    this.notifyWrite(scriptPath);
                }

                // Also delete metadata if exists
                const metaPath = instancePath + '.meta.json';
                if (fs.existsSync(metaPath)) {
                    fs.unlinkSync(metaPath);
                    this.notifyWrite(metaPath);
                }
            } else if (this.isDataClass(instance.className)) {
                const ext = this.getDataExtension(instance.className);
                const dataPath = instancePath + ext;
                if (fs.existsSync(dataPath)) {
                    fs.unlinkSync(dataPath);
                    this.notifyWrite(dataPath);
                }

                // Also delete metadata if exists
                const metaPath = instancePath + '.meta.json';
                if (fs.existsSync(metaPath)) {
                    fs.unlinkSync(metaPath);
                    this.notifyWrite(metaPath);
                }
            } else {
                // It's a folder/container
                this.deleteRecursive(instancePath);
            }
        } else {
            // Instance info not available, try to delete whatever exists
            // This handles cases where instance was already removed from state
            this.deleteRecursive(instancePath);
        }
    }

    // =========================================================================
    // Private Methods - File Operations
    // =========================================================================

    /**
     * Write a script instance to a .lua file.
     *
     * @param inst - The script instance
     * @param basePath - Base path (without extension)
     */
    private writeScriptFile(inst: RobloxInstance, basePath: string): void {
        const ext = this.getScriptExtension(inst.className);
        const filePath = basePath + ext;

        this.ensureDir(path.dirname(filePath));

        // Write script source
        const source = inst.properties.Source ?? '';
        fs.writeFileSync(filePath, String(source), 'utf-8');
        this.notifyWrite(filePath);

        // Write metadata (excluding Source property)
        const metaProps = { ...inst.properties };
        delete metaProps.Source;

        if (Object.keys(metaProps).length > 0) {
            const metaPath = basePath + '.meta.json';
            const metadata = {
                className: inst.className,
                properties: metaProps,
            };
            fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
            this.notifyWrite(metaPath);
        }
    }

    /**
     * Write a data instance to a .txt or .csv file.
     *
     * @param inst - The instance
     * @param basePath - Base path (without extension)
     */
    private writeDataFile(inst: RobloxInstance, basePath: string): void {
        const ext = this.getDataExtension(inst.className);
        const filePath = basePath + ext;

        this.ensureDir(path.dirname(filePath));

        // Get content property based on class
        let content = '';
        if (inst.className === 'StringValue') {
            content = String(inst.properties.Value ?? '');
        } else if (inst.className === 'LocalizationTable') {
            content = String(inst.properties.Contents ?? '');
        }

        fs.writeFileSync(filePath, content, 'utf-8');
        this.notifyWrite(filePath);

        // Write metadata (excluding content property)
        const metaProps = { ...inst.properties };
        if (inst.className === 'StringValue') delete metaProps.Value;
        if (inst.className === 'LocalizationTable') delete metaProps.Contents;

        if (Object.keys(metaProps).length > 0) {
            const metaPath = basePath + '.meta.json';
            const metadata = {
                className: inst.className,
                properties: metaProps,
            };
            fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
            this.notifyWrite(metaPath);
        }
    }

    /**
     * Write instance metadata to a .meta.json file.
     *
     * @param inst - The instance
     * @param dirPath - Directory path for the instance
     */
    private writeMetaFile(inst: RobloxInstance, dirPath: string): void {
        const metaPath = path.join(dirPath, 'init.meta.json');
        const metadata = {
            className: inst.className,
            properties: inst.properties,
        };

        this.ensureDir(dirPath);
        fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
        this.notifyWrite(metaPath);
    }

    /**
     * Recursively delete a file or directory.
     *
     * @param targetPath - Path to delete
     */
    private deleteRecursive(targetPath: string): void {
        if (!fs.existsSync(targetPath)) return;

        const stat = fs.statSync(targetPath);

        if (stat.isDirectory()) {
            // Delete contents first
            const entries = fs.readdirSync(targetPath);
            for (const entry of entries) {
                this.deleteRecursive(path.join(targetPath, entry));
            }
            // Then delete the directory
            fs.rmdirSync(targetPath);
        } else {
            fs.unlinkSync(targetPath);
        }
    }

    // =========================================================================
    // Private Methods - Utilities
    // =========================================================================

    /**
     * Ensure a directory exists, creating it if necessary.
     *
     * @param dirPath - Directory path to ensure
     */
    private ensureDir(dirPath: string): void {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    }

    /**
     * Get the file extension for a script class.
     */
    private getScriptExtension(className: string): string {
        return SCRIPT_EXTENSIONS[className] ?? '.lua';
    }

    /**
     * Get the file extension for a data class.
     */
    private getDataExtension(className: string): string {
        return DATA_EXTENSIONS[className] ?? '.txt';
    }

    /**
     * Check if a class name is a script type.
     */
    private isScriptClass(className: string): boolean {
        return SCRIPT_CLASSES.includes(className as typeof SCRIPT_CLASSES[number]);
    }

    /**
     * Check if a class name is a data type (StringValue, LocalizationTable).
     */
    private isDataClass(className: string): boolean {
        return className in DATA_EXTENSIONS;
    }

    /**
     * Check if an instance should be treated as a leaf node (file) rather than a directory.
     * Scripts and Data types are leaf nodes.
     */
    private isLeafNode(className: string): boolean {
        return this.isScriptClass(className) || this.isDataClass(className);
    }

    /**
     * Check if a property update targets the main content of a data file.
     */
    private isDataProperty(className: string, propertyName: string): boolean {
        if (className === 'StringValue' && propertyName === 'Value') return true;
        if (className === 'LocalizationTable' && propertyName === 'Contents') return true;
        return false;
    }
}
