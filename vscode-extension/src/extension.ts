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
import * as path from 'path';
import type { LogMessage } from './types';
import { RobloxExplorerProvider, RobloxTreeItem } from './treeView';
import { SyncClient } from './syncClient';
import { PropertyEditorProvider } from './propertyEditor';
import { RobloxScriptProvider } from './scriptProvider';
import { RobloxClassBrowserProvider } from './classBrowser';
import { ConnectionStatusBar } from './statusBar';

// =============================================================================
// Global State
// =============================================================================

/** WebSocket client for server communication */
let syncClient: SyncClient;

/** Tree view data provider */
let explorerProvider: RobloxExplorerProvider;

/** Script content provider for virtual documents */
let scriptProvider: RobloxScriptProvider;

/** Status bar item */
let statusBar: ConnectionStatusBar;

/** Output channel for Roblox logs */
let robloxOutputChannel: vscode.OutputChannel;

/** Current selection in the tree view */
let currentSelection: RobloxTreeItem | undefined;

/** File system watcher for lua scripts */
let fileWatcher: vscode.FileSystemWatcher | undefined;

/** Map to track files being synced from server to avoid loops */
const syncingFromServer = new Map<string, boolean>();

/** Clipboard for copy-paste operations */
let clipboard: RobloxTreeItem[] = [];

/** Roblox services that cannot be deleted or reparented */
const PROTECTED_SERVICES = [
    'Workspace', 'Lighting', 'ReplicatedFirst', 'ReplicatedStorage',
    'ServerScriptService', 'ServerStorage', 'StarterGui', 'StarterPack',
    'StarterPlayer', 'Teams', 'SoundService', 'LogService'
];

const LUA_PATH_SUFFIX = /(\.server|\.client)?\.lua$/;

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
        dragAndDropController: explorerProvider,
        showCollapseAll: true,
        canSelectMany: true,
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

    // Initialize class browser
    const classBrowserProvider = new RobloxClassBrowserProvider(context.extensionUri, syncClient);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('robloxClassBrowser', classBrowserProvider)
    );

    // Initialize status bar
    statusBar = new ConnectionStatusBar(context);

    // Listen to connection status changes
    syncClient.onStatusChange((status, message) => {
        statusBar.update(status, message);
        if (status === 'connected') {
            explorerProvider.refresh();
        }
    });

    // Register all commands
    registerCommands(context, propertyProvider);

    // Handle tree selection changes
    treeView.onDidChangeSelection((event: vscode.TreeViewSelectionChangeEvent<RobloxTreeItem>) => {
        if (event.selection.length > 0) {
            currentSelection = event.selection[0];
            propertyProvider.showProperties(event.selection as RobloxTreeItem[]);
        } else {
            currentSelection = undefined;
        }
    });

    // Listen to sync client updates
    syncClient.onUpdate(() => {
        explorerProvider.refresh();
        updateOpenScriptDocuments();
    });

    // Set up file system watcher for .lua files
    setupFileWatcher(context);

    // Auto-connect on startup
    vscode.commands.executeCommand('robloxSync.connect');

    // Add tree view to subscriptions
    context.subscriptions.push(treeView);

    // Initialize output channel
    robloxOutputChannel = vscode.window.createOutputChannel('Roblox Output');
    context.subscriptions.push(robloxOutputChannel);

    // Event listener for incoming logs from Roblox Studio
    syncClient.onLog((log: LogMessage) => {
        const timestamp = new Date(log.timestamp * 1000).toLocaleTimeString();
        const levelTag = log.level.toUpperCase();
        robloxOutputChannel.appendLine(`[${timestamp}] [${levelTag}] ${log.message}`);

        // Auto-show output channel on error? Maybe configurable.
        if (log.level === 'error') {
            robloxOutputChannel.show(true);
        }
    });
}

/**
 * Deactivates the uxrCoder extension.
 * Called when the extension is deactivated.
 */
export function deactivate(): void {
    if (syncClient) {
        syncClient.disconnect();
    }
    if (statusBar) {
        statusBar.dispose();
    }
    if (fileWatcher) {
        fileWatcher.dispose();
    }
    console.log('uxrCoder extension deactivated');
}

// =============================================================================
// File Synchronization
// =============================================================================

/**
 * Set up file system watcher for .lua files to sync changes to Studio.
 *
 * @param context - Extension context
 */
function setupFileWatcher(context: vscode.ExtensionContext): void {
    // Watch all .lua files in the workspace
    fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.lua');

    // Handle file changes
    fileWatcher.onDidChange(async (uri) => {
        // Skip if this change came from server or reparent is in progress
        if (syncingFromServer.get(uri.fsPath) || syncClient.isReparenting) {
            return;
        }

        console.log(`📝 File changed: ${uri.fsPath}`);

        // Get the path from the file URI
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;

        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const instancePath = filePathToInstancePath(uri.fsPath, workspaceRoot);
        if (!instancePath) return;

        // Read the file content
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            const newSource = document.getText();

            // Update the Source property
            syncClient.updateProperty(instancePath, 'Source', newSource);
            console.log(`✅ Synced ${instancePath.join('.')} to Studio`);
        } catch (error) {
            console.error(`Failed to sync file: ${error}`);
        }
    });

    // Handle file deletion
    fileWatcher.onDidDelete((uri) => {
        if (syncingFromServer.get(uri.fsPath) || syncClient.isReparenting) {
            return;
        }

        console.log(`🗑️ File deleted: ${uri.fsPath}`);

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;

        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const instancePath = filePathToInstancePath(uri.fsPath, workspaceRoot);
        if (!instancePath) return;

        syncClient.deleteInstance(instancePath);
        console.log(`✅ Deleted ${instancePath.join('.')} from Studio`);
    });

    context.subscriptions.push(fileWatcher);
}

/**
 * Update open script documents when server sends updates.
 * This ensures that if you edit a script in Studio, the open file in VS Code gets updated.
 */
async function updateOpenScriptDocuments(): Promise<void> {
    const fs = await import('fs');

    // Get workspace root
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    const workspaceRoot = workspaceFolders[0].uri.fsPath;

    // Check all open text documents
    for (const doc of vscode.workspace.textDocuments) {
        // Only process .lua files in the workspace
        if (!doc.uri.fsPath.endsWith('.lua') || !doc.uri.fsPath.startsWith(workspaceRoot)) {
            continue;
        }

        // Get the instance path from file path
        const instancePath = filePathToInstancePath(doc.uri.fsPath, workspaceRoot);
        if (!instancePath) {
            continue;
        }

        // Get the instance from sync client
        const instance = syncClient.getInstance(instancePath);
        if (!instance || instance.properties.Source === undefined) {
            continue;
        }

        // Check if content is different
        const currentContent = doc.getText();
        const serverContent = String(instance.properties.Source);

        if (currentContent !== serverContent) {
            console.log(`🔄 Updating open document: ${instancePath.join('.')}`);

            // Mark as syncing from server to avoid triggering file watcher
            syncingFromServer.set(doc.uri.fsPath, true);

            try {
                // Write the updated content to disk
                fs.writeFileSync(doc.uri.fsPath, serverContent, 'utf8');

                // Clear the flag after a short delay
                setTimeout(() => {
                    syncingFromServer.delete(doc.uri.fsPath);
                }, 100);
            } catch (error) {
                console.error(`Failed to update document: ${error}`);
                syncingFromServer.delete(doc.uri.fsPath);
            }
        }
    }
}

/**
 * Convert a workspace-local Lua file path to Roblox instance path.
 */
function filePathToInstancePath(filePath: string, workspaceRoot: string): string[] | null {
    const relative = path.relative(workspaceRoot, filePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        return null;
    }

    const normalized = relative.split(path.sep).join('/');
    if (!LUA_PATH_SUFFIX.test(normalized)) {
        return null;
    }

    const withoutLuaExt = normalized.replace(LUA_PATH_SUFFIX, '');
    const segments = withoutLuaExt.split('/').filter(Boolean);
    return segments.length > 0 ? segments : null;
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
        vscode.commands.registerCommand('robloxSync.copyInstance', handleCopyInstance),
        vscode.commands.registerCommand('robloxSync.pasteInstance', handlePasteInstance),
        vscode.commands.registerCommand('robloxSync.openScript', handleOpenScript),

        // Debugging commands
        vscode.commands.registerCommand('robloxSync.play', handlePlay),
        vscode.commands.registerCommand('robloxSync.run', handleRun),
        vscode.commands.registerCommand('robloxSync.stop', handleStop),

        // Build commands
        vscode.commands.registerCommand('robloxSync.build', handleBuild),
        vscode.commands.registerCommand('robloxSync.exportModel', handleExportModel),
        vscode.commands.registerCommand('robloxSync.regenerateSourcemap', handleRegenerateSourcemap),

        // Wally commands
        vscode.commands.registerCommand('robloxSync.wallyInit', handleWallyInit),
        vscode.commands.registerCommand('robloxSync.wallyInstall', handleWallyInstall),

        // Linting & Formatting commands
        vscode.commands.registerCommand('robloxSync.seleneInit', handleSeleneInit),
        vscode.commands.registerCommand('robloxSync.seleneLint', handleSeleneLint),
        vscode.commands.registerCommand('robloxSync.styluaInit', handleStyLuaInit),
        vscode.commands.registerCommand('robloxSync.styluaFormat', handleStyLuaFormat),

        // Version Control commands
        vscode.commands.registerCommand('robloxSync.generateGitignore', handleGenerateGitignore),

        // Project commands
        vscode.commands.registerCommand('robloxSync.initProject', handleInitProject)
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
        // Status bar handles the success UI
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
    // Status bar handles the disconnect UI
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
 * @param predefinedClassName - Optional class name to skip selection
 */
async function handleInsertObject(item?: RobloxTreeItem, predefinedClassName?: string): Promise<void> {
    // If called from ClassBrowser, item might be undefined if no tree selection.
    // In that case, we should try to use the selected item from the tree view if possible.
    // But explorerProvider doesn't expose selection.
    // We will just let it happen on root or handle it inside.

    // if (!item && !predefinedClassName) return; // Allow if we have a class name?
    // Actually we need a parent.
    if (!item) {
        if (currentSelection) {
            item = currentSelection;
        } else {
            // Try to get selection from tree view?
            // VS Code API doesn't allow getting tree view selection easily from outside unless we track it.
            // We track selection in treeView.onDidChangeSelection but strictly for property editor.
            vscode.window.showErrorMessage('Please select a parent instance in the explorer first.');
            return;
        }
    }

    // Show class picker
    const className = predefinedClassName || await vscode.window.showQuickPick(
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

    const label = typeof className === 'string' ? className : className?.label;
    if (!label) return;

    // Get instance name
    const initialName = label;
    const name = await vscode.window.showInputBox({
        prompt: 'Enter instance name',
        value: initialName,
        validateInput: (value: string) => {
            if (!value || value.trim().length === 0) {
                return 'Name cannot be empty';
            }
            return null;
        },
    });

    if (!name) return;

    // Check if instance with same name already exists and make it unique
    const parentInstance = item ? syncClient.getInstance(item.path) : null;
    const siblings = parentInstance?.children || syncClient.getAllInstances();

    let uniqueName = name.trim();
    let counter = 2;

    while (siblings.some(child => child.name === uniqueName)) {
        uniqueName = `${name.trim()}_${counter}`;
        counter++;
    }

    // Notify user if name was changed
    if (uniqueName !== name.trim()) {
        vscode.window.showInformationMessage(
            `Instance renamed to "${uniqueName}" to avoid name collision`
        );
    }

    // Create the instance
    const targetPath = item ? item.path : [];
    // If no item selected, maybe default to Workspace if possible?
    // Actually createInstance with empty path might put it in workspace or fail?
    // SyncClient.createInstance expects parentPath.
    // If targetPath is empty, it puts it in root (DataModel), which is usually allowed for Services.
    // But usually we want to put parts in Workspace.

    syncClient.createInstance(targetPath, label, uniqueName);
    explorerProvider.refresh();

    vscode.window.showInformationMessage(`Created ${label}: ${uniqueName}`);
}

/**
 * Handle the delete command.
 * Supports multi-select: VS Code passes (clickedItem, selectedItems) when canSelectMany is true.
 *
 * @param item - The clicked tree item
 * @param selectedItems - All selected tree items (provided by VS Code when multi-select)
 */
async function handleDelete(item?: RobloxTreeItem, selectedItems?: RobloxTreeItem[]): Promise<void> {
    // Use selectedItems if available (multi-select), otherwise fall back to single item
    const items = selectedItems && selectedItems.length > 0 ? selectedItems : (item ? [item] : []);
    if (items.length === 0) return;

    // Filter out protected services
    const protectedItems = items.filter(i => i.path.length === 1 && PROTECTED_SERVICES.includes(i.path[0]));
    const deletableItems = items.filter(i => !(i.path.length === 1 && PROTECTED_SERVICES.includes(i.path[0])));

    if (protectedItems.length > 0) {
        const names = protectedItems.map(i => i.instance.name).join(', ');
        vscode.window.showWarningMessage(`Cannot delete services: ${names}. Services are protected in Roblox.`);
    }

    if (deletableItems.length === 0) return;

    // Confirmation
    const message = deletableItems.length === 1
        ? `Are you sure you want to delete "${deletableItems[0].instance.name}"?`
        : `Are you sure you want to delete ${deletableItems.length} instances?`;

    const confirm = await vscode.window.showWarningMessage(
        message,
        { modal: true },
        'Delete'
    );

    if (confirm === 'Delete') {
        for (const delItem of deletableItems) {
            syncClient.deleteInstance(delItem.path);
        }
        explorerProvider.refresh();

        const resultMsg = deletableItems.length === 1
            ? `Deleted: ${deletableItems[0].instance.name}`
            : `Deleted ${deletableItems.length} instances`;
        vscode.window.showInformationMessage(resultMsg);
    }
}

/**
 * Handle the copy instance command.
 * Copies selected instances to the internal clipboard for paste.
 *
 * @param item - The clicked tree item
 * @param selectedItems - All selected tree items
 */
function handleCopyInstance(item?: RobloxTreeItem, selectedItems?: RobloxTreeItem[]): void {
    const items = selectedItems && selectedItems.length > 0 ? selectedItems : (item ? [item] : []);
    if (items.length === 0) return;

    clipboard = [...items];
    const names = items.map(i => i.instance.name).join(', ');
    vscode.window.showInformationMessage(`Copied ${items.length === 1 ? `"${names}"` : `${items.length} instances`} to clipboard`);
}

/**
 * Handle the paste instance command.
 * Pastes copied instances under the target item.
 *
 * @param item - The target tree item to paste under
 */
async function handlePasteInstance(item?: RobloxTreeItem): Promise<void> {
    if (!item) {
        if (currentSelection) {
            item = currentSelection;
        } else {
            vscode.window.showErrorMessage('Please select a target instance in the explorer to paste into.');
            return;
        }
    }

    if (clipboard.length === 0) {
        vscode.window.showWarningMessage('Clipboard is empty. Copy instances first.');
        return;
    }

    const targetPath = item.path;
    let pastedCount = 0;

    for (const clipItem of clipboard) {
        const instance = syncClient.getInstance(clipItem.path);
        if (!instance) continue;

        // Generate unique name in target
        const targetInstance = syncClient.getInstance(targetPath);
        const siblings = targetInstance?.children || [];
        let uniqueName = instance.name;
        let counter = 2;
        while (siblings.some(c => c.name === uniqueName)) {
            uniqueName = `${instance.name}_${counter}`;
            counter++;
        }

        syncClient.createInstance(targetPath, instance.className, uniqueName);

        // If instance has Source property (script), also copy it
        if (instance.properties.Source !== undefined) {
            const newPath = [...targetPath, uniqueName];
            // Small delay to ensure creation is processed before property update
            setTimeout(() => {
                syncClient.updateProperty(newPath, 'Source', instance.properties.Source);
            }, 200);
        }
        pastedCount++;
    }

    explorerProvider.refresh();
    if (pastedCount > 0) {
        vscode.window.showInformationMessage(
            pastedCount === 1
                ? `Pasted "${clipboard[0].instance.name}" into "${item.instance.name}"`
                : `Pasted ${pastedCount} instances into "${item.instance.name}"`
        );
    }
}

/**
 * Handle the rename command.
 *
 * @param item - The tree item to rename
 */
async function handleRename(item?: RobloxTreeItem): Promise<void> {
    if (!item) return;

    const newName = await vscode.window.showInputBox({
        prompt: 'Enter new name',
        value: item.instance.name,
        validateInput: (value: string) => {
            if (!value || value.trim().length === 0) {
                return 'Name cannot be empty';
            }
            return null;
        },
    });

    if (newName && newName.trim() !== item.instance.name) {
        syncClient.updateProperty(item.path, 'Name', newName.trim());
        explorerProvider.refresh();
    }
}

/**
 * Handle the copy path command.
 *
 * @param item - The tree item to copy path from
 */
function handleCopyPath(item?: RobloxTreeItem): void {
    if (!item) return;
    const path = 'game.' + item.path.join('.');
    vscode.env.clipboard.writeText(path);
    vscode.window.showInformationMessage(`Copied: ${path}`);
}

/**
 * Handle opening a script for editing.
 * Creates/opens a real file in the workspace folder for editing.
 *
 * @param item - The tree item representing the script
 */
async function handleOpenScript(item?: RobloxTreeItem): Promise<void> {
    if (!item) return;

    const instance = syncClient.getInstance(item.path);

    if (instance && instance.properties.Source !== undefined) {
        // Import modules upfront
        const fs = await import('fs');
        const nodePath = await import('path');

        // Get workspace folders
        let workspaceRoot: string;
        const workspaceFolders = vscode.workspace.workspaceFolders;

        if (!workspaceFolders || workspaceFolders.length === 0) {
            // Try to use the project's server/workspace folder as fallback
            const projectRoot = nodePath.dirname(nodePath.dirname(__dirname));
            const serverWorkspace = nodePath.join(projectRoot, 'server', 'workspace');

            if (fs.existsSync(serverWorkspace)) {
                workspaceRoot = serverWorkspace;
            } else {
                // Show warning and offer to open a folder
                const action = await vscode.window.showWarningMessage(
                    'No workspace folder is open. Please open a workspace folder to edit scripts.',
                    'Open Folder'
                );

                if (action === 'Open Folder') {
                    await vscode.commands.executeCommand('vscode.openFolder');
                }
                return;
            }
        } else {
            workspaceRoot = workspaceFolders[0].uri.fsPath;
        }

        // Determine correct file extension based on script type
        let extension = '.lua';
        if (instance.className === 'Script') {
            extension = '.server.lua';
        } else if (instance.className === 'LocalScript') {
            extension = '.client.lua';
        }
        // ModuleScript uses .lua (default)

        // Create path for the script file
        // Example: ServerScriptService/MyScript -> ServerScriptService/MyScript.server.lua
        const relativePath = item.path.join('/') + extension;
        const filePath = vscode.Uri.file(`${workspaceRoot}/${relativePath}`);

        try {
            // Create directory structure if needed
            const dir = nodePath.dirname(filePath.fsPath);

            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Write the script source to file
            const source = String(instance.properties.Source);
            fs.writeFileSync(filePath.fsPath, source, 'utf8');

            // Open the file for editing
            const doc = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(doc, { preview: false });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open script: ${error}`);
        }
    } else {
        vscode.window.showWarningMessage('This instance does not have a Source property');
    }
}

/**
 * Handle the play command.
 */
function handlePlay(): void {
    if (!syncClient.isConnected()) {
        vscode.window.showErrorMessage('Not connected to Roblox Studio');
        return;
    }
    syncClient.sendCommand('play');
    vscode.window.showInformationMessage('Starting Play Solo...');
    robloxOutputChannel.show(true);
}

/**
 * Handle the run command.
 */
function handleRun(): void {
    if (!syncClient.isConnected()) {
        vscode.window.showErrorMessage('Not connected to Roblox Studio');
        return;
    }
    syncClient.sendCommand('run');
    vscode.window.showInformationMessage('Starting Run...');
    robloxOutputChannel.show(true);
}

/**
 * Handle the stop command.
 */
function handleStop(): void {
    if (!syncClient.isConnected()) {
        vscode.window.showErrorMessage('Not connected to Roblox Studio');
        return;
    }
    syncClient.sendCommand('stop');
    vscode.window.showInformationMessage('Stopping simulation...');
}

/**
 * Handle the build command.
 */
async function handleBuild(): Promise<void> {
    try {
        const path = await syncClient.buildProject('rbxlx');
        vscode.window.showInformationMessage(`Project built to: ${path}`);
    } catch (error) {
        vscode.window.showErrorMessage(`Build failed: ${error}`);
    }
}

/**
 * Handle the export model command.
 * 
 * @param item - The tree item to export
 */
async function handleExportModel(item?: RobloxTreeItem): Promise<void> {
    if (!item) return;

    try {
        const path = await syncClient.exportInstance(item.path);
        vscode.window.showInformationMessage(`Exported ${item.instance.name} to: ${path}`);
    } catch (error) {
        vscode.window.showErrorMessage(`Export failed: ${error}`);
    }
}

/**
 * Handle the regenerate sourcemap command.
 */
async function handleRegenerateSourcemap(): Promise<void> {
    try {
        await syncClient.regenerateSourcemap();
        vscode.window.showInformationMessage('Sourcemap regenerated successfully');
    } catch (error) {
        vscode.window.showErrorMessage(`Sourcemap regeneration failed: ${error}`);
    }
}

/**
 * Handle the Wally Init command.
 */
function handleWallyInit(): void {
    const terminal = vscode.window.createTerminal('Wally');
    terminal.show();
    terminal.sendText('wally init');
}

/**
 * Handle the Wally Install command.
 * 
 * @param uri - Optional URI from context menu
 */
function handleWallyInstall(uri?: vscode.Uri): void {
    const terminal = vscode.window.createTerminal('Wally');
    terminal.show();

    // If triggered from context menu on wally.toml, we might want to cd to that directory?
    // Usually wally install is run from project root.
    // If uri is provided, we could verify it's wally.toml or use its folder.

    if (uri && uri.scheme === 'file') {
        // If the file is specifically wally.toml, use its directory
        // const dir = uri.fsPath.endsWith('wally.toml') ? path.dirname(uri.fsPath) : uri.fsPath;
        // terminal.sendText(`cd "${dir}"`); 
        // But creating a terminal usually starts at workspace root anyway.
        // Let's just run wally install.
    }

    terminal.sendText('wally install');
}

/**
 * Handle Selene Init command.
 */
async function handleSeleneInit(): Promise<void> {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders) {
        vscode.window.showErrorMessage('No workspace open');
        return;
    }

    const configPath = vscode.Uri.joinPath(wsFolders[0].uri, 'selene.toml');
    const defaultConfig = `std = "roblox"

[lints]
unused_variable = "allow"
shadowing = "allow"
`;

    try {
        await vscode.workspace.fs.writeFile(configPath, Buffer.from(defaultConfig, 'utf8'));
        vscode.window.showInformationMessage('Created selene.toml');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to create selene.toml: ${error}`);
    }
}

/**
 * Handle Selene Lint command.
 */
function handleSeleneLint(): void {
    const terminal = vscode.window.createTerminal('Selene');
    terminal.show();
    terminal.sendText('selene .');
}

/**
 * Handle StyLua Init command.
 */
async function handleStyLuaInit(): Promise<void> {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders) {
        vscode.window.showErrorMessage('No workspace open');
        return;
    }

    const configPath = vscode.Uri.joinPath(wsFolders[0].uri, 'stylua.toml');
    const defaultConfig = `column_width = 120
indent_type = "Tabs"
indent_width = 4
quote_style = "AutoPreferDouble"
call_parentheses = "Always"
`;

    try {
        await vscode.workspace.fs.writeFile(configPath, Buffer.from(defaultConfig, 'utf8'));
        vscode.window.showInformationMessage('Created stylua.toml');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to create stylua.toml: ${error}`);
    }
}

/**
 * Handle StyLua Format command.
 */
function handleStyLuaFormat(): void {
    const terminal = vscode.window.createTerminal('StyLua');
    terminal.show();
    terminal.sendText('stylua .');
}

/**
 * Handle Generate .gitignore command.
 */
async function handleGenerateGitignore(): Promise<void> {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders) {
        vscode.window.showErrorMessage('No workspace open');
        return;
    }

    const configPath = vscode.Uri.joinPath(wsFolders[0].uri, '.gitignore');
    const content = `# Roblox
*.rbxl
*.rbxlx
*.rbxm
*.rbxmx
*.tmp

# Rojo
/_index
/sourcemap.json

# Wally
/Packages
/_wally

# VS Code
.vscode/*
!.vscode/settings.json
!.vscode/tasks.json
!.vscode/launch.json
!.vscode/extensions.json

# OS
.DS_Store
Thumbs.db
`;

    try {
        // Check if exists
        try {
            await vscode.workspace.fs.stat(configPath);
            const answer = await vscode.window.showWarningMessage(
                '.gitignore already exists. Overwrite?',
                'Yes', 'No'
            );
            if (answer !== 'Yes') return;
        } catch {
            // Does not exist, proceed
        }

        await vscode.workspace.fs.writeFile(configPath, Buffer.from(content, 'utf8'));
        vscode.window.showInformationMessage('Created .gitignore');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to create .gitignore: ${error}`);
    }
}

/**
 * Handle Initialize Project command.
 */
async function handleInitProject(): Promise<void> {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders) {
        vscode.window.showErrorMessage('No workspace open');
        return;
    }

    const rootUri = wsFolders[0].uri;

    // Check if project already exists
    const projectFile = vscode.Uri.joinPath(rootUri, 'default.project.json');
    try {
        await vscode.workspace.fs.stat(projectFile);
        const answer = await vscode.window.showWarningMessage(
            'default.project.json already exists. Initialize anyway?',
            'Yes', 'No'
        );
        if (answer !== 'Yes') return;
    } catch {
        // Proceed
    }

    try {
        // Create directories
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(rootUri, 'src', 'server'));
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(rootUri, 'src', 'client'));
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(rootUri, 'src', 'shared'));

        // Create default.project.json
        const projectConfig = {
            name: "MyRobloxProject",
            tree: {
                "$className": "DataModel",
                "ReplicatedStorage": {
                    "$path": "src/shared"
                },
                "ServerScriptService": {
                    "$path": "src/server"
                },
                "StarterPlayer": {
                    "StarterPlayerScripts": {
                        "$path": "src/client"
                    }
                }
            }
        };
        await vscode.workspace.fs.writeFile(
            projectFile,
            Buffer.from(JSON.stringify(projectConfig, null, 2), 'utf8')
        );

        // Create README.md
        const readme = `# My Roblox Project

This project was initialized with uxrCoder.

## Structure

- \`src/server\`: Server-side scripts (ServerScriptService)
- \`src/client\`: Client-side scripts (StarterPlayerScripts)
- \`src/shared\`: Shared modules (ReplicatedStorage)

## Getting Started

1. Connect uxrCoder plugin in Roblox Studio.
2. Start syncing!
`;
        await vscode.workspace.fs.writeFile(
            vscode.Uri.joinPath(rootUri, 'README.md'),
            Buffer.from(readme, 'utf8')
        );

        // Generate .gitignore if it doesn't exist
        await handleGenerateGitignore();

        vscode.window.showInformationMessage('Project initialized successfully! 🎉');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to initialize project: ${error}`);
    }
}
