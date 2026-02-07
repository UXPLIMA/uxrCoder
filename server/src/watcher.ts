/**
 * @fileoverview Watcher - Monitors filesystem for changes and syncs to Roblox.
 *
 * This module handles:
 * - Watching the workspace directory
 * - Converting file events to SyncMessages
 * - Handling two-way sync (Filesystem -> Roblox)
 *
 * @author UXPLIMA
 * @license MIT
 */

import chokidar from 'chokidar';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { SyncEngine } from './syncEngine';
import { SyncMessage, RobloxInstance } from './types';
import { SCRIPT_EXTENSIONS, DATA_EXTENSIONS, FileMapper } from './fileMapper';

export class Watcher {
    private watcher: chokidar.FSWatcher | null = null;
    private ignoredPaths: Set<string> = new Set();
    private isReady: boolean = false;
    private isPaused: boolean = false;
    private onChangeCallback: ((change: SyncMessage) => void) | null = null;

    constructor(
        private rootPath: string,
        private syncEngine: SyncEngine,
        private fileMapper: FileMapper
    ) { }

    /**
     * Check if any ancestor in the Roblox path is a script.
     * Scripts cannot have file children.
     */
    private hasScriptAncestor(robloxPath: string[]): boolean {
        const scriptTypes = ['Script', 'LocalScript', 'ModuleScript'];
        
        // Check each ancestor in the path
        for (let i = 1; i < robloxPath.length; i++) {
            const ancestorPath = robloxPath.slice(0, i);
            const ancestor = this.syncEngine.getInstance(ancestorPath);
            
            if (ancestor && scriptTypes.includes(ancestor.className)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Start watching for changes.
     */
    start(): void {
        this.watcher = chokidar.watch(this.rootPath, {
            ignored: /(^|[\/\\])\../, // ignore dotfiles
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 100,
                pollInterval: 100
            }
        });

        this.watcher
            .on('add', filePath => this.handleFileChange('create', filePath))
            .on('change', filePath => this.handleFileChange('update', filePath))
            .on('unlink', filePath => this.handleFileDelete(filePath))
            .on('addDir', filePath => this.handleDirCreate(filePath))
            .on('unlinkDir', filePath => this.handleDirDelete(filePath))
            .on('ready', () => {
                this.isReady = true;
                console.log(`👀 Watching for changes in ${this.rootPath}`);
            })
            .on('error', error => console.error(`❌ Watcher error: ${error}`));
    }

    /**
     * Temporarily ignore changes for a specific file.
     * Used when the server writes to files to prevent infinite loops.
     */
    ignore(filePath: string): void {
        this.ignoredPaths.add(filePath);
        // Remove from ignore list after 2 seconds
        setTimeout(() => this.ignoredPaths.delete(filePath), 2000);
    }

    /**
     * Temporarily pause ALL file watching.
     * Used during bulk sync operations to prevent loops.
     */
    pauseTemporarily(duration: number): void {
        console.log(`⏸️ Pausing watcher for ${duration}ms`);
        this.isPaused = true;
        setTimeout(() => {
            this.isPaused = false;
            console.log('▶️ Watcher resumed');
        }, duration);
    }

    /**
     * Register a callback to be invoked when a change is detected.
     */
    public onChange(callback: (change: SyncMessage) => void): void {
        this.onChangeCallback = callback;
    }

    /**
     * Notify listeners of a change.
     */
    private notifyChange(change: SyncMessage): void {
        if (this.onChangeCallback) {
            this.onChangeCallback(change);
        }
    }

    /**
     * Handle file creation or update.
     */
    private async handleFileChange(type: 'create' | 'update', filePath: string): Promise<void> {
        if (this.isPaused || this.ignoredPaths.has(filePath)) return;

        const robloxPath = this.fileMapper.getRobloxPath(filePath);
        if (!robloxPath) return;

        // Check if any ancestor is a script - scripts cannot have file children
        if (this.hasScriptAncestor(robloxPath)) {
            console.log(`⚠️ Ignoring file "${filePath}" - has script ancestor`);
            console.log(`   Scripts are leaf nodes and cannot have children`);
            return;
        }

        const fileName = path.basename(filePath);
        const name = robloxPath[robloxPath.length - 1];
        const parentPath = robloxPath.slice(0, -1);

        // 1. Handle Meta Files
        if (fileName.endsWith('.meta.json')) {
            this.handleMetaFile(filePath, fileName, robloxPath);
            return;
        }

        // 2. Determine Class Name
        let className: string | null = null;
        let isScript = false;
        let isData = false;

        for (const [cls, ext] of Object.entries(SCRIPT_EXTENSIONS)) {
            if (fileName.endsWith(ext)) {
                className = cls;
                isScript = true;
                break;
            }
        }

        if (!className) {
            for (const [cls, ext] of Object.entries(DATA_EXTENSIONS)) {
                if (fileName.endsWith(ext)) {
                    className = cls;
                    isData = true;
                    break;
                }
            }
        }

        if (!className) return;

        // 3. Process Change
        if (isScript) {
            if (type === 'create') {
                try {
                    const source = await fs.promises.readFile(filePath, 'utf-8');
                    const instance: RobloxInstance = {
                        id: randomUUID(),
                        className,
                        name,
                        parent: parentPath.join('.'),
                        properties: { Source: source },
                        children: []
                    };

                    const message: SyncMessage = {
                        type: 'create',
                        timestamp: Date.now(),
                        path: robloxPath,
                        instance
                    };
                    this.syncEngine.applyChange(message);
                    this.notifyChange(message);
                } catch (err) {
                    console.error(`Error reading script file ${filePath}:`, err);
                }
            } else {
                try {
                    const source = await fs.promises.readFile(filePath, 'utf-8');
                    const message: SyncMessage = {
                        type: 'update',
                        timestamp: Date.now(),
                        path: robloxPath,
                        property: { name: 'Source', value: source }
                    };
                    this.syncEngine.applyChange(message);
                    this.notifyChange(message);
                } catch (err) {
                    console.error(`Error reading script file ${filePath}:`, err);
                }
            }
        } else if (isData) {
            try {
                const content = await fs.promises.readFile(filePath, 'utf-8');
                const propName = className === 'StringValue' ? 'Value' : 'Contents';

                if (type === 'create') {
                    const instance: RobloxInstance = {
                        id: randomUUID(),
                        className,
                        name,
                        parent: parentPath.join('.'),
                        properties: { [propName]: content },
                        children: []
                    };

                    const message: SyncMessage = {
                        type: 'create',
                        timestamp: Date.now(),
                        path: robloxPath,
                        instance
                    };
                    this.syncEngine.applyChange(message);
                    this.notifyChange(message);
                } else {
                    const message: SyncMessage = {
                        type: 'update',
                        timestamp: Date.now(),
                        path: robloxPath,
                        property: { name: propName, value: content }
                    };
                    this.syncEngine.applyChange(message);
                    this.notifyChange(message);
                }
            } catch (err) {
                console.error(`Error reading data file ${filePath}:`, err);
            }
        }
    }

    /**
     * Handle file deletion.
     */
    private handleFileDelete(filePath: string): void {
        if (this.isPaused || this.ignoredPaths.has(filePath)) return;

        const robloxPath = this.fileMapper.getRobloxPath(filePath);
        if (!robloxPath) return;

        // Metadata deleted -> ignored for now, or maybe reset properties?
        if (filePath.endsWith('.meta.json')) return;

        // Check if any ancestor is a script - scripts' children don't sync
        if (this.hasScriptAncestor(robloxPath)) {
            console.log(`⏭️ Ignoring file deletion "${filePath}" - has script ancestor`);
            return;
        }

        const message: SyncMessage = {
            type: 'delete',
            timestamp: Date.now(),
            path: robloxPath
        };
        this.syncEngine.applyChange(message);
        this.notifyChange(message);
    }

    /**
     * Handle directory creation.
     */
    private handleDirCreate(dirPath: string): void {
        if (this.isPaused || this.ignoredPaths.has(dirPath)) return;

        const robloxPath = this.fileMapper.getRobloxPath(dirPath);
        if (!robloxPath) return;

        // Check if any ancestor is a script - scripts cannot have children
        if (this.hasScriptAncestor(robloxPath)) {
            console.log(`⚠️ Ignoring directory "${dirPath}" - has script ancestor`);
            return;
        }

        const name = robloxPath[robloxPath.length - 1];
        const parentPath = robloxPath.slice(0, -1);

        const instance: RobloxInstance = {
            id: randomUUID(),
            className: 'Folder',
            name,
            parent: parentPath.join('.'),
            properties: {},
            children: []
        };

        const message: SyncMessage = {
            type: 'create',
            timestamp: Date.now(),
            path: robloxPath,
            instance
        };
        this.syncEngine.applyChange(message);
        this.notifyChange(message);
    }

    /**
     * Handle directory deletion.
     */
    private handleDirDelete(dirPath: string): void {
        if (this.isPaused || this.ignoredPaths.has(dirPath)) return;

        const robloxPath = this.fileMapper.getRobloxPath(dirPath);
        if (!robloxPath) return;

        // Check if any ancestor is a script
        if (this.hasScriptAncestor(robloxPath)) {
            console.log(`⏭️ Ignoring directory deletion "${dirPath}" - has script ancestor`);
            return;
        }

        const message: SyncMessage = {
            type: 'delete',
            timestamp: Date.now(),
            path: robloxPath
        };
        this.syncEngine.applyChange(message);
        this.notifyChange(message);
    }

    /**
     * Handle metadata file changes.
     */
    private async handleMetaFile(filePath: string, fileName: string, robloxPath: string[]): Promise<void> {
        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const metadata = JSON.parse(content);
            const properties = metadata.properties || {};

            // Iterate over properties and update
            for (const [key, value] of Object.entries(properties)) {
                const message: SyncMessage = {
                    type: 'update',
                    timestamp: Date.now(),
                    path: robloxPath,
                    property: { name: key, value: value as any }
                };
                this.syncEngine.applyChange(message);
                this.notifyChange(message);
            }
        } catch (error) {
            console.error(`Error processing meta file ${fileName}:`, error);
        }
    }
}
