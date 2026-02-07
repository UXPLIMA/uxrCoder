/**
 * @fileoverview uxrCoder VS Code Extension - Main entry point.
 *
 * This extension provides:
 * - Roblox Explorer tree view for navigating the DataModel
 * - Property inspector for viewing/editing instance properties
 * - Real-time synchronization with Roblox Studio via WebSocket
 * - Script editing with virtual document support
 *
 * @author UXPLIMA
 * @license MIT
 */

import * as vscode from 'vscode';
import { RobloxExplorerProvider, RobloxTreeItem } from './treeView';
import { SyncClient } from './syncClient';
import { PropertyEditorProvider } from './propertyEditor';
import { RobloxScriptProvider } from './scriptProvider';

// =============================================================================
// Global State
// =============================================================================

/** WebSocket client for server communication */
let syncClient: SyncClient;

/** Tree view data provider */
let explorerProvider: RobloxExplorerProvider;

/** Script content provider for virtual documents */
let scriptProvider: RobloxScriptProvider;

// =============================================================================
// Extension Lifecycle
// =============================================================================

/**
 * Activates the uxrCoder extension.
 * Called when the extension is first activated.
 *
 * @param context - Extension context for managing subscriptions
 */
export function activate(context: vscode.ExtensionContext): void {
    console.log('uxrCoder extension activated');

    // Initialize the sync client
    const serverUrl = vscode.workspace.getConfiguration('robloxSync').get('serverUrl', 'ws://127.0.0.1:34872');
    syncClient = new SyncClient(serverUrl);

    // Initialize tree view
    explorerProvider = new RobloxExplorerProvider(syncClient);
    const treeView = vscode.window.createTreeView('robloxExplorer', {
        treeDataProvider: explorerProvider,
        showCollapseAll: true,
        canSelectMany: false,
    });

    // Initialize script content provider
    scriptProvider = new RobloxScriptProvider(syncClient);
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider('roblox-script', scriptProvider)
    );

    // Initialize property editor
    const propertyProvider = new PropertyEditorProvider(context.extensionUri, syncClient);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('robloxProperties', propertyProvider)
    );

    // Register all commands
    registerCommands(context, propertyProvider);

    // Handle tree selection changes
    treeView.onDidChangeSelection(event => {
        if (event.selection.length > 0) {
            propertyProvider.showProperties(event.selection[0]);
        }
    });

    // Listen to sync client updates
    syncClient.onUpdate(() => {
        explorerProvider.refresh();
    });

    // Auto-connect on startup
    vscode.commands.executeCommand('robloxSync.connect');

    // Add tree view to subscriptions
    context.subscriptions.push(treeView);
}

/**
 * Deactivates the uxrCoder extension.
 * Called when the extension is deactivated.
 */
export function deactivate(): void {
    if (syncClient) {
        syncClient.disconnect();
    }
    console.log('uxrCoder extension deactivated');
}

// =============================================================================
// Command Registration
// =============================================================================

/**
 * Register all extension commands.
 *
 * @param context - Extension context
 * @param propertyProvider - Property editor provider
 */
function registerCommands(
    context: vscode.ExtensionContext,
    propertyProvider: PropertyEditorProvider
): void {
    // Connection commands
    context.subscriptions.push(
        vscode.commands.registerCommand('robloxSync.connect', handleConnect),
        vscode.commands.registerCommand('robloxSync.disconnect', handleDisconnect),
        vscode.commands.registerCommand('robloxSync.refresh', handleRefresh),

        // Instance manipulation commands
        vscode.commands.registerCommand('robloxSync.insertObject', handleInsertObject),
        vscode.commands.registerCommand('robloxSync.delete', handleDelete),
        vscode.commands.registerCommand('robloxSync.rename', handleRename),
        vscode.commands.registerCommand('robloxSync.copyPath', handleCopyPath),
        vscode.commands.registerCommand('robloxSync.openScript', handleOpenScript)
    );
}

// =============================================================================
// Command Handlers
// =============================================================================

/**
 * Handle the connect command.
 */
async function handleConnect(): Promise<void> {
    try {
        await syncClient.connect();
        vscode.window.showInformationMessage('🟢 Connected to uxrCoder server!');
        explorerProvider.refresh();
    } catch (error) {
        vscode.window.showErrorMessage(`Connection failed: ${error}`);
    }
}

/**
 * Handle the disconnect command.
 */
function handleDisconnect(): void {
    syncClient.disconnect();
    explorerProvider.clear();
    vscode.window.showInformationMessage('🔴 Disconnected from uxrCoder server');
}

/**
 * Handle the refresh command.
 */
function handleRefresh(): void {
    explorerProvider.refresh();
}

/**
 * Handle the insert object command.
 *
 * @param item - The tree item to insert under
 */
async function handleInsertObject(item: RobloxTreeItem): Promise<void> {
    // Show class picker
    const className = await vscode.window.showQuickPick(
        [
            // Common instances
            { label: 'Folder', description: 'Container for organizing instances' },
            { label: 'Model', description: 'Container for 3D objects' },
            { label: 'Part', description: 'Basic 3D primitive' },
            { label: 'MeshPart', description: '3D mesh object' },

            // Scripts
            { label: 'Script', description: 'Server-side script' },
            { label: 'LocalScript', description: 'Client-side script' },
            { label: 'ModuleScript', description: 'Reusable code module' },

            // Events
            { label: 'RemoteEvent', description: 'Client-server communication' },
            { label: 'RemoteFunction', description: 'Client-server RPC' },
            { label: 'BindableEvent', description: 'Same-context event' },
            { label: 'BindableFunction', description: 'Same-context function' },

            // GUI
            { label: 'ScreenGui', description: 'Screen overlay GUI' },
            { label: 'Frame', description: 'GUI container' },
            { label: 'TextLabel', description: 'Text display' },
            { label: 'TextButton', description: 'Clickable text' },
            { label: 'ImageLabel', description: 'Image display' },
            { label: 'ImageButton', description: 'Clickable image' },
        ],
        {
            placeHolder: 'Select instance class to create',
            matchOnDescription: true,
        }
    );

    if (!className) return;

    // Get instance name
    const name = await vscode.window.showInputBox({
        prompt: 'Enter instance name',
        value: className.label,
        validateInput: value => {
            if (!value || value.trim().length === 0) {
                return 'Name cannot be empty';
            }
            return null;
        },
    });

    if (!name) return;

    // Create the instance
    syncClient.createInstance(item.path, className.label, name.trim());
    explorerProvider.refresh();

    vscode.window.showInformationMessage(`Created ${className.label}: ${name}`);
}

/**
 * Handle the delete command.
 *
 * @param item - The tree item to delete
 */
async function handleDelete(item: RobloxTreeItem): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
        `Are you sure you want to delete "${item.label}"?`,
        { modal: true },
        'Delete'
    );

    if (confirm === 'Delete') {
        syncClient.deleteInstance(item.path);
        explorerProvider.refresh();
        vscode.window.showInformationMessage(`Deleted: ${item.label}`);
    }
}

/**
 * Handle the rename command.
 *
 * @param item - The tree item to rename
 */
async function handleRename(item: RobloxTreeItem): Promise<void> {
    const newName = await vscode.window.showInputBox({
        prompt: 'Enter new name',
        value: item.label as string,
        validateInput: value => {
            if (!value || value.trim().length === 0) {
                return 'Name cannot be empty';
            }
            return null;
        },
    });

    if (newName && newName.trim() !== item.label) {
        syncClient.updateProperty(item.path, 'Name', newName.trim());
        explorerProvider.refresh();
    }
}

/**
 * Handle the copy path command.
 *
 * @param item - The tree item to copy path from
 */
function handleCopyPath(item: RobloxTreeItem): void {
    const path = 'game.' + item.path.join('.');
    vscode.env.clipboard.writeText(path);
    vscode.window.showInformationMessage(`Copied: ${path}`);
}

/**
 * Handle the open script command.
 *
 * @param item - The script tree item to open
 */
async function handleOpenScript(item: RobloxTreeItem): Promise<void> {
    const instance = syncClient.getInstance(item.path);

    if (instance && instance.properties.Source !== undefined) {
        // Create virtual document URI
        const uri = vscode.Uri.parse(`roblox-script:/${item.path.join('/')}.lua`);

        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, { preview: false });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open script: ${error}`);
        }
    } else {
        vscode.window.showWarningMessage('This instance does not have a Source property');
    }
}
