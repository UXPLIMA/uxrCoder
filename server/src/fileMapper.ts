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
import type { RobloxInstance, SyncMessage } from './types';

/** Roblox classes that contain Luau source code */
const SCRIPT_CLASSES = ['Script', 'LocalScript', 'ModuleScript'] as const;

/** File extension mapping for different script types */
const SCRIPT_EXTENSIONS: Record<string, string> = {
    Script: '.server.lua',
    LocalScript: '.client.lua',
    ModuleScript: '.lua',
};

/**
 * Maps Roblox instances to the filesystem for external editing.
 *
 * The FileMapper creates a directory structure that mirrors the DataModel:
 * - Folders become directories
 * - Scripts become .lua files
 * - Other instances get .meta.json files
 *
 * @example
 * ```typescript
 * const mapper = new FileMapper('./workspace');
 * mapper.syncAllToFiles(instances);
 * ```
 */
export class FileMapper {
    /**
     * Create a new FileMapper instance.
     *
     * @param basePath - Root directory for file output
     */
    constructor(private basePath: string) {
        this.ensureDir(basePath);
    }

    // =========================================================================
    // Public API
    // =========================================================================

    /**
     * Sync all instances to the filesystem.
     * Creates directories and files for the entire DataModel tree.
     *
     * @param instances - Array of root instances to sync
     */
    syncAllToFiles(instances: RobloxInstance[]): void {
        for (const inst of instances) {
            this.syncInstanceRecursive(inst, this.basePath);
        }
    }

    /**
     * Apply a single sync message to the filesystem.
     * Used for incremental updates from the editor.
     *
     * @param message - The sync message to apply
     */
    syncToFiles(message: SyncMessage): void {
        const instancePath = path.join(this.basePath, ...message.path);

        switch (message.type) {
            case 'create':
                this.handleCreate(message, instancePath);
                break;

            case 'update':
                this.handleUpdate(message, instancePath);
                break;

            case 'delete':
                this.handleDelete(instancePath);
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
     * @param parentPath - Parent directory path
     */
    private syncInstanceRecursive(inst: RobloxInstance, parentPath: string): void {
        const instancePath = path.join(parentPath, inst.name);

        if (this.isScriptClass(inst.className)) {
            // Write script file
            this.writeScriptFile(inst, instancePath);
        } else {
            // Create directory for non-script instances
            this.ensureDir(instancePath);
            this.writeMetaFile(inst, instancePath);
        }

        // Process children
        if (inst.children && inst.children.length > 0) {
            const childBasePath = this.isScriptClass(inst.className)
                ? path.dirname(instancePath)
                : instancePath;

            for (const child of inst.children) {
                this.syncInstanceRecursive(child, childBasePath);
            }
        }
    }

    /**
     * Handle create operation from sync message.
     */
    private handleCreate(message: SyncMessage, instancePath: string): void {
        if (!message.instance) return;

        if (this.isScriptClass(message.instance.className)) {
            this.writeScriptFile(message.instance, instancePath);
        } else {
            this.ensureDir(instancePath);
            this.writeMetaFile(message.instance, instancePath);
        }
    }

    /**
     * Handle update operation from sync message.
     */
    private handleUpdate(message: SyncMessage, instancePath: string): void {
        if (!message.property || !message.instance) return;

        if (message.property.name === 'Source') {
            // Update script source
            const ext = this.getScriptExtension(message.instance.className);
            const filePath = instancePath + ext;

            if (fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, String(message.property.value), 'utf-8');
            }
        } else {
            // Update metadata
            this.writeMetaFile(message.instance, instancePath);
        }
    }

    /**
     * Handle delete operation from sync message.
     */
    private handleDelete(instancePath: string): void {
        this.deleteRecursive(instancePath);

        // Also try to delete script file variants
        for (const ext of Object.values(SCRIPT_EXTENSIONS)) {
            const scriptPath = instancePath + ext;
            if (fs.existsSync(scriptPath)) {
                fs.unlinkSync(scriptPath);
            }
        }

        // Delete metadata file
        const metaPath = instancePath + '.meta.json';
        if (fs.existsSync(metaPath)) {
            fs.unlinkSync(metaPath);
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
     *
     * @param className - The Roblox class name
     * @returns File extension including the dot
     */
    private getScriptExtension(className: string): string {
        return SCRIPT_EXTENSIONS[className] ?? '.lua';
    }

    /**
     * Check if a class name is a script type.
     *
     * @param className - The Roblox class name
     * @returns True if the class contains source code
     */
    private isScriptClass(className: string): boolean {
        return SCRIPT_CLASSES.includes(className as typeof SCRIPT_CLASSES[number]);
    }
}
