/**
 * @fileoverview uxrCoder Server - Main entry point.
 *
 * This server acts as a bridge between Roblox Studio and VS Code/Antigravity.
 * It provides:
 * - HTTP REST API for Roblox plugin communication
 * - WebSocket server for real-time VS Code extension updates
 *
 * @author UXPLIMA
 * @license MIT
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer, Server } from 'http';
import { SyncEngine } from './syncEngine';
import { FileMapper } from './fileMapper';
import { Watcher } from './watcher';
import { ProjectLoader } from './projectLoader';
import { BuildSystem } from './buildSystem';
import { SourcemapGenerator } from './sourcemap';
import type { SyncMessage, RobloxInstance, ServerConfig, HealthResponse, SyncResponse } from './types';

// =============================================================================
// Configuration
// =============================================================================

/**
 * Server configuration.
 * Can be overridden via environment variables.
 */
const config: ServerConfig = {
    port: parseInt(process.env.PORT || '34872', 10),
    host: process.env.HOST || '0.0.0.0',
    syncInterval: parseInt(process.env.SYNC_INTERVAL || '100', 10),
    workspacePath: process.env.WORKSPACE_PATH || process.cwd() + '/workspace',
};

// =============================================================================
// Server Setup
// =============================================================================

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Request logging middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
    if (config.syncInterval > 0) {
        // Only log non-frequent endpoints
        if (!req.path.includes('/sync') && !req.path.includes('/changes')) {
            console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
        }
    }
    next();
});

// Create HTTP server and WebSocket server
const server: Server = createServer(app);
const wss = new WebSocketServer({ server });

// Load project config
const projectConfig = ProjectLoader.load(config.workspacePath);

// Core services
const syncEngine = new SyncEngine();
const fileMapper = new FileMapper(config.workspacePath, projectConfig);
const watcher = new Watcher(config.workspacePath, syncEngine, fileMapper);
const buildSystem = new BuildSystem(config.workspacePath);
const sourcemapGenerator = new SourcemapGenerator(config.workspacePath);

// Link fileMapper to syncEngine for instance lookups
fileMapper.setSyncEngine(syncEngine);

// Debounce sourcemap generation
let sourcemapTimeout: NodeJS.Timeout | null = null;
const scheduleSourcemapGeneration = () => {
    if (sourcemapTimeout) clearTimeout(sourcemapTimeout);
    sourcemapTimeout = setTimeout(() => {
        if (projectConfig) {
            // console.log('🗺️ Regenerating sourcemap.json...');
            sourcemapGenerator.generate(projectConfig).catch(err => {
                console.error('❌ Failed to regenerate sourcemap:', err);
            });
        }
    }, 1000);
};

// Connection to FileMapper for ignoring loopback events
fileMapper.onWrite((path) => watcher.ignore(path));

// Signal propagation for file system events
watcher.onChange((change) => {
    broadcastToClients(change);
    scheduleSourcemapGeneration();
});

// Start watching for file changes
watcher.start();

// Initial sourcemap generation
scheduleSourcemapGeneration();

// Connected VS Code clients
const clients: Set<WebSocket> = new Set();

// =============================================================================
// WebSocket Handlers
// =============================================================================

/**
 * Handle new WebSocket connections from VS Code extensions.
 */
wss.on('connection', (ws: WebSocket) => {
    console.log('[WS] Client connected');
    clients.add(ws);

    // Synchronize initial state with the new client
    const instances = syncEngine.getAllInstances();
    console.log(`[SYNC] Dispatching ${instances.length} instances to client`);

    const syncMessage = {
        type: 'full_sync',
        timestamp: Date.now(),
        instances: instances,
    };
    ws.send(JSON.stringify(syncMessage));

    // Handle incoming messages from VS Code
    ws.on('message', (data: Buffer) => {
        try {
            const message: SyncMessage = JSON.parse(data.toString());
            console.log(`[INBOUND] Received message: ${message.type}${'path' in message ? ' @ ' + message.path.join('.') : ''}`);
            handleEditorChange(message);
        } catch (error) {
            console.error('[ERROR] Malformed message received:', error);
        }
    });

    // Event listener for client termination
    ws.on('close', () => {
        console.log('[WS] Client disconnected');
        clients.delete(ws);
    });

    // Event listener for connection errors
    ws.on('error', (error: Error) => {
        console.error('[ERROR] WebSocket error:', error.message);
        clients.delete(ws);
    });
});

/**
 * Broadcast a message to all connected VS Code clients.
 * @param message - The sync message to broadcast
 */
function broadcastToClients(message: SyncMessage): void {
    const data = JSON.stringify(message);
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

/**
 * Process synchronization messages received from the VS Code/Antigravity editor.
 * 
 * @param message - The synchronization message to process.
 */
function handleEditorChange(message: SyncMessage): void {
    if (message.type === 'command') {
        process.stdout.write(`[CMD] Execution signal received: ${message.action}\n`);
        syncEngine.applyChange(message);
    } else if (message.type === 'log') {
        process.stdout.write(`[REMOTE_LOG] Editor broadcast: ${message.message}\n`);
    } else if (message.type === 'delete') {
        // Persistent file system synchronization before state removal
        process.stdout.write(`[CHANGE] Editor deletion: ${message.path.join('.')}\n`);
        fileMapper.syncToFiles(message);
        syncEngine.applyChange(message);
    } else {
        process.stdout.write(`[CHANGE] Editor update: ${message.type} @ ${message.path.join('.')}\n`);
        syncEngine.applyChange(message);
        fileMapper.syncToFiles(message);
    }
}

// =============================================================================
// HTTP API Endpoints
// =============================================================================

/**
 * Health check endpoint.
 * Used by clients to verify server availability.
 */
app.get('/health', (_req: Request, res: Response) => {
    const instances = syncEngine.getAllInstances();
    const response: HealthResponse = {
        status: 'ok',
        timestamp: Date.now(),
        version: '1.0.0',
        instanceCount: instances.length,  // Add instance count for plugin resync detection
    };
    res.json(response);
});

/**
 * Sync endpoint - receives DataModel snapshot from Roblox plugin.
 * This is the main sync path from Roblox Studio to the server.
 */
app.post('/sync', (req: Request, res: Response) => {
    try {
        const instances: RobloxInstance[] = req.body.instances;

        if (!Array.isArray(instances)) {
            res.status(400).json({ error: 'Invalid request: instances must be an array' });
            return;
        }

        // Process the sync and get detected changes
        // If it's an initial sync, we might want to reset state or trust it completely
        const isInitial = req.body.isInitial === true;

        let changes: SyncMessage[];
        if (isInitial) {
            // Initial synchronization: Synchronize full state from plugin
            changes = syncEngine.updateFromPlugin(instances);
            console.log(`[SYNC] Initial synchronization: ${instances.length} root instances received`);
        } else {
            changes = syncEngine.updateFromPlugin(instances);
        }

        // Temporarily pause watcher to prevent sync loops
        watcher.pauseTemporarily(2000);

        // Write to file system FIRST
        fileMapper.syncAllToFiles(instances);

        // Then notify VS Code clients about the updated state
        // Only send full_sync to avoid duplicates from individual changes
        broadcastToClients({
            type: 'full_sync',
            timestamp: Date.now(),
            path: [],
            instances: syncEngine.getAllInstances(),
        } as SyncMessage);

        const response: SyncResponse = {
            success: true,
            changesApplied: changes.length,
        };
        res.json(response);
    } catch (error) {
        console.error('[ERROR] Synchronization failure:', error);
        res.status(500).json({
            success: false,
            changesApplied: 0,
            error: String(error),
        });
    }
});

/**
 * Delta Sync endpoint - receives batched changes from Roblox plugin.
 */
app.post('/sync/delta', (req: Request, res: Response) => {
    try {
        const changes: SyncMessage[] = req.body.changes;

        if (!Array.isArray(changes)) {
            res.status(400).json({ error: 'Invalid request: changes must be an array' });
            return;
        }

        // Apply changes to server state
        syncEngine.applyDeltaChanges(changes);

        // Notify VS Code clients
        changes.forEach(change => broadcastToClients(change));

        // Write to file system
        changes.forEach(change => fileMapper.syncToFiles(change));

        res.json({
            success: true,
            changesApplied: changes.length,
        });
    } catch (error) {
        console.error('[ERROR] Delta synchronization failure:', error);
        res.status(500).json({
            success: false,
            changesApplied: 0,
            error: String(error),
        });
    }
});

/**
 * Get pending changes for Roblox plugin to apply.
 * The plugin polls this endpoint to receive editor changes.
 */
app.get('/changes', (_req: Request, res: Response) => {
    const changes = syncEngine.getPendingChangesForPlugin();
    if (changes.length > 0) {
        console.log(`[OUTBOUND] Dispatching ${changes.length} pending changes to plugin`);
    }
    res.json({ changes });
});

/**
 * Confirm that changes were applied by the plugin.
 * This removes them from the pending queue.
 */
app.post('/changes/confirm', (req: Request, res: Response) => {
    const { ids } = req.body;

    if (!Array.isArray(ids)) {
        res.status(400).json({ error: 'Invalid request: ids must be an array' });
        return;
    }

    syncEngine.confirmChanges(ids);
    res.json({ success: true });
});

/**
 * Get a specific instance by path.
 */
app.get('/instance/:path', (req: Request, res: Response) => {
    const path = req.params.path.split('.');
    const instance = syncEngine.getInstance(path);

    if (instance) {
        res.json(instance);
    } else {
        res.status(404).json({ error: 'Instance not found' });
    }
});

/**
 * Create a new instance.
 */
app.post('/instance', (req: Request, res: Response) => {
    const { parentPath, className, name } = req.body;

    if (!parentPath || !className || !name) {
        res.status(400).json({ error: 'Missing required fields: parentPath, className, name' });
        return;
    }

    const message: SyncMessage = {
        type: 'create',
        timestamp: Date.now(),
        path: [...parentPath, name],
        instance: {
            id: crypto.randomUUID(),
            className,
            name,
            parent: parentPath.join('.'),
            properties: {},
            children: [],
        },
    };

    syncEngine.applyChange(message);
    broadcastToClients(message);
    res.json({ success: true, instance: message.instance });
});

/**
 * Delete an instance by path.
 */
app.delete('/instance/:path', (req: Request, res: Response) => {
    const path = req.params.path.split('.');
    const message: SyncMessage = {
        type: 'delete',
        timestamp: Date.now(),
        path,
    };

    syncEngine.applyChange(message);
    broadcastToClients(message);
    res.json({ success: true });
});

/**
 * Update an instance property.
 */
app.patch('/instance/:path', (req: Request, res: Response) => {
    const path = req.params.path.split('.');
    const { property, value } = req.body;

    if (!property) {
        res.status(400).json({ error: 'Missing required field: property' });
        return;
    }

    const message: SyncMessage = {
        type: 'update',
        timestamp: Date.now(),
        path,
        property: { name: property, value },
    };

    syncEngine.applyChange(message);
    broadcastToClients(message);
    res.json({ success: true });
});

/**
 * Build the project to a file.
 */
app.post('/build/:format', async (req: Request, res: Response) => {
    const format = req.params.format;

    if (format !== 'rbxlx') {
        res.status(400).json({ error: 'Unsupported format. Currently only rbxlx is supported.' });
        return;
    }

    try {
        const instances = syncEngine.getAllInstances();
        const outputPath = await buildSystem.buildRbxlx(instances);

        console.log(`[BUILD] Project successfully built to: ${outputPath}`);
        res.json({ success: true, path: outputPath });
    } catch (error) {
        console.error('[ERROR] Build failure:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Export a specific instance to .rbxmx.
 */
app.post('/build/rbxmx', async (req: Request, res: Response) => {
    const { path: instancePath } = req.body;

    if (!instancePath || !Array.isArray(instancePath)) {
        res.status(400).json({ error: 'Missing required field: path (array of strings)' });
        return;
    }

    try {
        const instance = syncEngine.getInstance(instancePath);
        if (!instance) {
            res.status(404).json({ error: 'Instance not found' });
            return;
        }

        const outputPath = await buildSystem.buildRbxmx(instance);

        console.log(`[EXPORT] Exported ${instance.name} to: ${outputPath}`);
        res.json({ success: true, path: outputPath });
    } catch (error) {
        console.error('[ERROR] Export failure:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Regenerate sourcemap command.
 */
app.post('/sourcemap/regenerate', async (req: Request, res: Response) => {
    if (!projectConfig) {
        res.status(400).json({ error: 'No project configuration loaded' });
        return;
    }

    try {
        await sourcemapGenerator.generate(projectConfig);
        console.log('[LSP] sourcemap.json regenerated successfully');
        res.json({ success: true });
    } catch (error) {
        console.error('[ERROR] Sourcemap generation failure:', error);
        res.status(500).json({ error: String(error) });
    }
});

// =============================================================================
// Error Handling
// =============================================================================

/**
 * Global application error handler.
 */
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[CRITICAL] Unhandled application error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// =============================================================================
// Server Startup
// =============================================================================

server.listen(config.port, config.host, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   uxrCoder Server v1.0.0                             ║
║                                                           ║
║   HTTP:      http://${config.host}:${config.port}                       ║
║   WebSocket: ws://${config.host}:${config.port}                         ║
║   Workspace: ${config.workspacePath.substring(0, 30)}...                ║
║                                                           ║
║   Waiting for connections...                              ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`);
});

// Signal handling for graceful termination
process.on('SIGTERM', () => {
    console.log('[SYSTEM] SIGTERM received. Initiating graceful shutdown...');
    server.close(() => {
        console.log('[SYSTEM] All services terminated.');
        process.exit(0);
    });
});

export { app, server, wss };
