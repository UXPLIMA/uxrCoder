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

// Core services
const syncEngine = new SyncEngine();
const fileMapper = new FileMapper(config.workspacePath);

// Connected VS Code clients
const clients: Set<WebSocket> = new Set();

// =============================================================================
// WebSocket Handlers
// =============================================================================

/**
 * Handle new WebSocket connections from VS Code extensions.
 */
wss.on('connection', (ws: WebSocket) => {
    console.log('📡 VS Code client connected');
    clients.add(ws);

    // Send current state to new client
    const syncMessage = {
        type: 'full_sync',
        timestamp: Date.now(),
        instances: syncEngine.getAllInstances(),
    };
    ws.send(JSON.stringify(syncMessage));

    // Handle incoming messages from VS Code
    ws.on('message', (data: Buffer) => {
        try {
            const message: SyncMessage = JSON.parse(data.toString());
            handleEditorChange(message);
        } catch (error) {
            console.error('❌ Invalid message from client:', error);
        }
    });

    // Handle disconnection
    ws.on('close', () => {
        console.log('📡 VS Code client disconnected');
        clients.delete(ws);
    });

    // Handle errors
    ws.on('error', (error: Error) => {
        console.error('❌ WebSocket error:', error.message);
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
 * Handle changes received from VS Code/Antigravity editor.
 * @param message - The sync message containing the change
 */
function handleEditorChange(message: SyncMessage): void {
    console.log(`📝 Editor change: ${message.type} at ${message.path.join('.')}`);
    syncEngine.applyChange(message);
    fileMapper.syncToFiles(message);
}

// =============================================================================
// HTTP API Endpoints
// =============================================================================

/**
 * Health check endpoint.
 * Used by clients to verify server availability.
 */
app.get('/health', (_req: Request, res: Response) => {
    const response: HealthResponse = {
        status: 'ok',
        timestamp: Date.now(),
        version: '1.0.0',
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
        const changes = syncEngine.updateFromPlugin(instances);

        // Notify VS Code clients about changes
        changes.forEach(change => broadcastToClients(change));

        // Also broadcast full sync for consistency
        if (changes.length > 0) {
            broadcastToClients({
                type: 'full_sync',
                timestamp: Date.now(),
                path: [],
                instances: syncEngine.getAllInstances(),
            });
        }

        // Write to file system
        fileMapper.syncAllToFiles(instances);

        const response: SyncResponse = {
            success: true,
            changesApplied: changes.length,
        };
        res.json(response);
    } catch (error) {
        console.error('❌ Sync error:', error);
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

// =============================================================================
// Error Handling
// =============================================================================

/**
 * Global error handler.
 */
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('❌ Unhandled error:', err);
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

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Shutting down gracefully...');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

export { app, server, wss };
