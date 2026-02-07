/**
 * @fileoverview Script content provider for virtual Roblox script documents.
 *
 * This module provides a TextDocumentContentProvider for the 'roblox-script' URI scheme.
 * It allows VS Code to display Roblox script content in editor tabs without actual files.
 *
 * @author UXPLIMA
 * @license MIT
 */

import * as vscode from 'vscode';
import { SyncClient } from './syncClient';

/**
 * Provides content for virtual Roblox script documents.
 *
 * This provider handles URIs of the form:
 * `roblox-script:/ServerScriptService/MyScript.lua`
 *
 * @example
 * ```typescript
 * const provider = new RobloxScriptProvider(syncClient);
 * context.subscriptions.push(
 *     vscode.workspace.registerTextDocumentContentProvider('roblox-script', provider)
 * );
 * ```
 */
export class RobloxScriptProvider implements vscode.TextDocumentContentProvider {
    /** Event emitter for document content changes */
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();

    /** Event that fires when document content changes */
    readonly onDidChange = this._onDidChange.event;

    /**
     * Create a new script provider.
     *
     * @param syncClient - The sync client for accessing instance data
     */
    constructor(private readonly syncClient: SyncClient) { }

    /**
     * Provide the content for a virtual script document.
     *
     * @param uri - The URI of the document to provide content for
     * @returns The script source code
     */
    provideTextDocumentContent(uri: vscode.Uri): string {
        // Parse path from URI: roblox-script:/ServerScriptService/Script.lua
        const pathStr = uri.path
            .replace(/^\//, '')  // Remove leading slash
            .replace(/\.lua$/, '');  // Remove .lua extension

        const path = pathStr.split('/');

        // Get instance from sync client
        const instance = this.syncClient.getInstance(path);

        if (instance && instance.properties.Source !== undefined) {
            return String(instance.properties.Source);
        }

        // Return error comment if script not found
        return this.generateNotFoundContent(path);
    }

    /**
     * Notify that a document's content has changed.
     * Call this when the sync client receives updated script content.
     *
     * @param uri - The URI of the changed document
     */
    refresh(uri: vscode.Uri): void {
        this._onDidChange.fire(uri);
    }

    /**
     * Refresh all open script documents.
     */
    refreshAll(): void {
        // This would require tracking open documents
        // For now, refresh is called on specific URIs
    }

    /**
     * Generate content for when a script is not found.
     *
     * @param path - The path that was not found
     * @returns Error comment content
     */
    private generateNotFoundContent(path: string[]): string {
        const pathStr = path.join('.');
        return [
            `-- Script not found: ${pathStr}`,
            '--',
            '-- Possible reasons:',
            '--   1. The Roblox Studio plugin is not connected',
            '--   2. The script has been deleted',
            '--   3. The path is incorrect',
            '--',
            '-- Try:',
            '--   1. Make sure Roblox Studio is running with the plugin',
            '--   2. Click "Refresh" in the Roblox Explorer panel',
            '--   3. Reconnect to the sync server',
        ].join('\n');
    }
}
