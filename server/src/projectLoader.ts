/**
 * @fileoverview ProjectLoader - Loads and validates project configuration.
 *
 * This module handles:
 * - Loading `uxrcoder.project.json`
 * - Validating the configuration structure
 * - Providing default configuration if missing
 *
 * @author UXPLIMA
 * @license MIT
 */

import * as fs from 'fs';
import * as path from 'path';
import { ProjectConfig } from './types';

export class ProjectLoader {
    /**
     * Load project configuration from the workspace.
     * Looks for `uxrcoder.project.json` or `default.project.json`.
     *
     * @param workspacePath - Root path of the workspace
     * @returns The loaded configuration or null if not found
     */
    static load(workspacePath: string): ProjectConfig | null {
        const configFiles = ['uxrcoder.project.json', 'default.project.json'];

        for (const file of configFiles) {
            const configPath = path.join(workspacePath, file);
            if (fs.existsSync(configPath)) {
                try {
                    const content = fs.readFileSync(configPath, 'utf-8');
                    const config = JSON.parse(content);
                    console.log(`✅ Loaded project config from ${file}`);
                    return config;
                } catch (error) {
                    console.error(`❌ Failed to parse ${file}:`, error);
                }
            }
        }

        return null;
    }

    /**
     * Create a default project configuration.
     */
    static createDefault(name: string): ProjectConfig {
        return {
            name,
            tree: {
                $className: 'DataModel',

                // Default mapping for standard services
                ReplicatedStorage: {
                    $className: 'ReplicatedStorage',
                    $path: 'src/shared'
                },
                ServerScriptService: {
                    $className: 'ServerScriptService',
                    $path: 'src/server'
                },
                StarterPlayer: {
                    $className: 'StarterPlayer',
                    StarterPlayerScripts: {
                        $className: 'StarterPlayerScripts',
                        $path: 'src/client'
                    }
                },
                Workspace: {
                    $className: 'Workspace',
                    $path: 'src/workspace'
                }
            }
        };
    }
}
