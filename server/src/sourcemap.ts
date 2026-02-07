/**
 * @fileoverview SourcemapGenerator - Generates Rojo-compatible sourcemaps for Luau LSP.
 *
 * This module scans the project configuration and filesystem to produce
 * a sourcemap.json file that maps filesystem paths to Roblox DataModel paths.
 *
 * @author UXPLIMA
 * @license MIT
 */

import * as fs from 'fs';
import * as path from 'path';
import { ProjectConfig, ProjectTree } from './types';
import { SCRIPT_EXTENSIONS, DATA_EXTENSIONS } from './fileMapper';

interface SourcemapNode {
    name: string;
    className: string;
    filePaths?: string[];
    children?: SourcemapNode[];
}

export class SourcemapGenerator {
    constructor(private readonly workspacePath: string) { }

    /**
     * Generate sourcemap.json for the project.
     * 
     * @param config - The project configuration
     */
    public async generate(config: ProjectConfig): Promise<void> {
        const rootNode = await this.processNode(config.tree, config.name, this.workspacePath);

        // Root node is typically DataModel, but Rojo format expects the top level object
        // to represent the tree root.

        const content = JSON.stringify(rootNode, null, 2);
        const outputPath = path.join(this.workspacePath, 'sourcemap.json');

        await fs.promises.writeFile(outputPath, content, 'utf-8');
        // console.log(`🗺️ Generated sourcemap.json at ${outputPath}`);
    }

    /**
     * Recursive function to process a project tree node.
     */
    private async processNode(tree: ProjectTree, name: string, contextPath: string): Promise<SourcemapNode> {
        let className = tree.$className || 'Folder'; // Default to Folder if not specified
        let currentPath = contextPath;
        const filePaths: string[] = [];
        const children: SourcemapNode[] = [];

        // Resolve $path
        if (tree.$path) {
            currentPath = path.resolve(contextPath, tree.$path);

            // If path exists, add it
            if (fs.existsSync(currentPath)) {
                filePaths.push(currentPath);

                // If it's a directory, we need to scan it for children
                const stats = await fs.promises.stat(currentPath);
                if (stats.isDirectory()) {
                    const scannedChildren = await this.scanDirectory(currentPath);

                    // Merge scanned children. 
                    // Note: explicit children in config take precedence or merge?
                    // Usually explicit config overrides or adds to scanned.

                    // Special handling for init scripts (they define the class of the container)
                    const initScript = this.findInitScript(currentPath);
                    if (initScript) {
                        // Inherit class from init script type
                        // init.server.lua -> Script
                        // init.client.lua -> LocalScript
                        // init.lua -> ModuleScript
                        if (initScript.endsWith('.server.lua')) className = 'Script';
                        else if (initScript.endsWith('.client.lua')) className = 'LocalScript';
                        else if (initScript.endsWith('.lua')) className = 'ModuleScript';

                        // Add init script to filePaths (it effectively IS the instance source)
                        filePaths.push(path.join(currentPath, initScript));
                    }

                    // Check for init.meta.json to override classname
                    const metaPath = path.join(currentPath, 'init.meta.json');
                    if (fs.existsSync(metaPath)) {
                        try {
                            const metaContent = await fs.promises.readFile(metaPath, 'utf-8');
                            const meta = JSON.parse(metaContent);
                            if (meta.className) className = meta.className;
                        } catch (e) {
                            console.warn(`Failed to parse meta file: ${metaPath}`);
                        }
                    }

                    children.push(...scannedChildren);
                }
            } else {
                console.warn(`Sourcemap generation: Path not found: ${currentPath}`);
            }
        }

        // Process explicit children from config
        for (const key of Object.keys(tree)) {
            if (key.startsWith('$')) continue;

            const childValue = tree[key];
            if (typeof childValue === 'object' && childValue !== null) {
                const childNode = await this.processNode(childValue as ProjectTree, key, currentPath);
                children.push(childNode);
            }
        }

        const node: SourcemapNode = {
            name,
            className,
            children: children.length > 0 ? children : undefined
        };

        if (filePaths.length > 0) {
            node.filePaths = filePaths;
        }

        return node;
    }

    /**
     * Scan a directory for Roblox instances (scripts, folders, etc).
     */
    private async scanDirectory(dirPath: string): Promise<SourcemapNode[]> {
        const nodes: SourcemapNode[] = [];
        let entries: string[] = [];

        try {
            entries = await fs.promises.readdir(dirPath);
        } catch (e) {
            return [];
        }

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry);
            const stats = await fs.promises.stat(fullPath);

            // Skip init scripts/meta (handled by parent processing)
            if (entry.startsWith('init.') || entry.endsWith('.meta.json')) continue;

            if (stats.isDirectory()) {
                // Folder implies a child instance (Folder or defined by init)
                // We recursively process it as a generic node
                // But we don't have a config object for it, so we mock one
                const childNode = await this.processNode({ $path: entry }, entry, dirPath);
                nodes.push(childNode);
            } else {
                // File
                const node = await this.processFile(entry, fullPath);
                if (node) {
                    nodes.push(node);
                }
            }
        }

        return nodes;
    }

    private async processFile(fileName: string, fullPath: string): Promise<SourcemapNode | null> {
        // Check for script extensions
        for (const [cls, ext] of Object.entries(SCRIPT_EXTENSIONS)) {
            if (fileName.endsWith(ext)) {
                const name = fileName.substring(0, fileName.length - ext.length);
                return {
                    name,
                    className: cls,
                    filePaths: [fullPath]
                };
            }
        }

        // Check for data extensions
        for (const [cls, ext] of Object.entries(DATA_EXTENSIONS)) {
            if (fileName.endsWith(ext)) {
                const name = fileName.substring(0, fileName.length - ext.length);
                return {
                    name,
                    className: cls,
                    filePaths: [fullPath]
                };
            }
        }

        return null;
    }

    private findInitScript(dirPath: string): string | null {
        if (fs.existsSync(path.join(dirPath, 'init.server.lua'))) return 'init.server.lua';
        if (fs.existsSync(path.join(dirPath, 'init.client.lua'))) return 'init.client.lua';
        if (fs.existsSync(path.join(dirPath, 'init.lua'))) return 'init.lua';
        return null;
    }
}
