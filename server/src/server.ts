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
import path from 'path';
import { SyncEngine } from './syncEngine';
import { FileMapper } from './fileMapper';
import { Watcher } from './watcher';
import { ProjectLoader } from './projectLoader';
import { BuildSystem } from './buildSystem';
import { SourcemapGenerator } from './sourcemap';
import { AgentLockManager, type AgentPathLockConflict } from './agentLockManager';
import { AgentTestManager, type AgentTestRun } from './agentTestManager';
import { AgentTestArtifactStore } from './agentTestArtifactStore';
import { normalizeAgentTestScenario } from './agentTestScenario';
import {
    AgentVisualBaselineStore,
    type VisualBaselineMode,
} from './agentVisualBaselineStore';
import {
    buildAgentPropertySchemaFromIndexed,
    validateAgentPropertyUpdate,
} from './agentPropertySchema';
import { buildAgentSnapshotResponse } from './agentSnapshot';
import { AgentIdempotencyCache, type AgentCachedResponse } from './agentIdempotencyCache';
import { executeIdempotentRequest } from './agentIdempotentExecutor';
import { buildConflict } from './agentCommandResponse';
import { executeBatchAgentCommandFlow, executeSingleAgentCommandFlow } from './agentCommandApi';
import {
    buildAgentStateBundle,
    buildAgentStateBundleFilename,
    persistAgentStateBundle,
    sanitizeBundleLabel,
} from './agentStateBundle';
import { AgentDerivedCache } from './agentDerivedCache';
import type {
    SyncMessage,
    RobloxInstance,
    ServerConfig,
    HealthResponse,
    SyncResponse,
    AgentCommand,
    AgentCommandResult,
    AgentSnapshotResponse,
    PropertyValue,
} from './types';

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
const SERVER_VERSION = '1.1.0';

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
const agentLockManager = new AgentLockManager(15000);
const agentTestManager = new AgentTestManager();
const agentTestArtifactStore = new AgentTestArtifactStore(config.workspacePath);
const agentVisualBaselineStore = new AgentVisualBaselineStore(config.workspacePath);
const testDispatchTimeouts = new Map<string, NodeJS.Timeout>();
const testExecutionTimeouts = new Map<string, NodeJS.Timeout>();
let delayedTestDispatchTimer: NodeJS.Timeout | null = null;

const TEST_DISPATCH_TIMEOUT_MS = 30000;
const DEFAULT_TEST_TIMEOUT_MS = 120000;

// Agent idempotency response cache
const agentIdempotencyCache = new AgentIdempotencyCache(5 * 60 * 1000, 500);
const agentIdempotencyMetrics = {
    cacheHits: 0,
    cacheMisses: 0,
    writes: 0,
};
const agentDerivedCache = new AgentDerivedCache({
    getRevision: () => syncEngine.getRevision(),
    getIndexedInstances: () => syncEngine.getIndexedInstances(),
    buildSnapshot: (indexed, revision, generatedAt) =>
        buildAgentSnapshotResponse(indexed, revision, generatedAt),
    buildSchema: (indexed, revision, classNameFilter) =>
        buildAgentPropertySchemaFromIndexed(indexed, revision, classNameFilter),
    now: () => Date.now(),
});
const AGENT_METRICS_MAX_SAMPLES = 500;

interface AgentSyncMetricsBucket {
    count: number;
    failureCount: number;
    totalPayloadItems: number;
    lastDurationMs: number | null;
    lastAt: number | null;
    durationsMs: number[];
}

interface AgentLockContentionEvent {
    timestamp: number;
    owner: string;
    op: AgentCommand['op'];
    requestedPaths: string[][];
    conflictPath: string[];
    conflictOwner: string;
    conflictExpiresAt: number;
}

interface AgentLockContentionSnapshot extends AgentLockContentionEvent {
    conflictExpiresInMs: number;
}

function createSyncMetricsBucket(): AgentSyncMetricsBucket {
    return {
        count: 0,
        failureCount: 0,
        totalPayloadItems: 0,
        lastDurationMs: null,
        lastAt: null,
        durationsMs: [],
    };
}

const agentSyncMetrics = {
    full: createSyncMetricsBucket(),
    delta: createSyncMetricsBucket(),
};

const agentLockContentionMetrics: { total: number; recent: AgentLockContentionEvent[] } = {
    total: 0,
    recent: [],
};

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

function broadcastFullSync(): void {
    broadcastToClients({
        type: 'full_sync',
        timestamp: Date.now(),
        path: [],
        instances: syncEngine.getAllInstances(),
    } as SyncMessage);
}

function parseBaseRevision(body: unknown): number | null {
    if (!body || typeof body !== 'object') {
        return null;
    }
    const value = (body as Record<string, unknown>).baseRevision;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return Math.floor(value);
    }
    return null;
}

function parseTestAttempt(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
    }
    if (value < 1) {
        return undefined;
    }
    return Math.floor(value);
}

function resolveIdempotencyKey(req: Request): string | null {
    const header = req.header('x-idempotency-key');
    if (typeof header === 'string' && header.trim().length > 0) {
        return header.trim();
    }

    if (req.body && typeof req.body === 'object') {
        const bodyKey = (req.body as Record<string, unknown>).idempotencyKey;
        if (typeof bodyKey === 'string' && bodyKey.trim().length > 0) {
            return bodyKey.trim();
        }
    }

    return null;
}

function getCachedAgentResponse(key: string | null): AgentCachedResponse | null {
    const cached = agentIdempotencyCache.get(key);
    if (key) {
        if (cached) {
            agentIdempotencyMetrics.cacheHits += 1;
        } else {
            agentIdempotencyMetrics.cacheMisses += 1;
        }
    }
    return cached;
}

function cacheAgentResponse(key: string | null, status: number, body: unknown): void {
    if (!key) {
        return;
    }

    agentIdempotencyCache.set(key, status, body);
    agentIdempotencyMetrics.writes += 1;
}

function pushBoundedSample<T>(samples: T[], value: T, maxSize: number): void {
    samples.push(value);
    if (samples.length > maxSize) {
        samples.splice(0, samples.length - maxSize);
    }
}

function summarizeDurationSamples(samples: number[]): {
    samples: number;
    averageMs: number | null;
    p95Ms: number | null;
    maxMs: number | null;
} {
    if (samples.length === 0) {
        return {
            samples: 0,
            averageMs: null,
            p95Ms: null,
            maxMs: null,
        };
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const total = sorted.reduce((sum, value) => sum + value, 0);
    const p95Index = Math.floor((sorted.length - 1) * 0.95);

    return {
        samples: sorted.length,
        averageMs: Math.round(total / sorted.length),
        p95Ms: sorted[p95Index],
        maxMs: sorted[sorted.length - 1],
    };
}

function measureDurationMs<T>(fn: () => T): { durationMs: number; result: T } {
    const startedAt = process.hrtime.bigint();
    const result = fn();
    const endedAt = process.hrtime.bigint();
    const durationMs = Number(endedAt - startedAt) / 1_000_000;
    return { durationMs, result };
}

function summarizeProfileSamples(samples: number[]): {
    runs: number;
    averageMs: number;
    p95Ms: number;
    minMs: number;
    maxMs: number;
} {
    if (samples.length === 0) {
        return {
            runs: 0,
            averageMs: 0,
            p95Ms: 0,
            minMs: 0,
            maxMs: 0,
        };
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const total = sorted.reduce((sum, value) => sum + value, 0);
    const p95Index = Math.floor((sorted.length - 1) * 0.95);
    const precision = (value: number): number => Number(value.toFixed(3));

    return {
        runs: sorted.length,
        averageMs: precision(total / sorted.length),
        p95Ms: precision(sorted[p95Index]),
        minMs: precision(sorted[0]),
        maxMs: precision(sorted[sorted.length - 1]),
    };
}

function recordSyncMetricsSuccess(kind: 'full' | 'delta', durationMs: number, payloadItems: number): void {
    const bucket = kind === 'full' ? agentSyncMetrics.full : agentSyncMetrics.delta;
    const normalizedDuration = Math.max(0, Math.floor(durationMs));
    const normalizedPayloadItems = Number.isFinite(payloadItems) && payloadItems > 0
        ? Math.floor(payloadItems)
        : 0;

    bucket.count += 1;
    bucket.totalPayloadItems += normalizedPayloadItems;
    bucket.lastDurationMs = normalizedDuration;
    bucket.lastAt = Date.now();
    pushBoundedSample(bucket.durationsMs, normalizedDuration, AGENT_METRICS_MAX_SAMPLES);
}

function recordSyncMetricsFailure(kind: 'full' | 'delta'): void {
    const bucket = kind === 'full' ? agentSyncMetrics.full : agentSyncMetrics.delta;
    bucket.failureCount += 1;
}

function buildSyncMetrics(): Record<string, unknown> {
    const fullDuration = summarizeDurationSamples(agentSyncMetrics.full.durationsMs);
    const deltaDuration = summarizeDurationSamples(agentSyncMetrics.delta.durationsMs);

    return {
        fullSync: {
            count: agentSyncMetrics.full.count,
            failureCount: agentSyncMetrics.full.failureCount,
            totalInstances: agentSyncMetrics.full.totalPayloadItems,
            averageInstancesPerSync: agentSyncMetrics.full.count > 0
                ? Number((agentSyncMetrics.full.totalPayloadItems / agentSyncMetrics.full.count).toFixed(2))
                : 0,
            lastDurationMs: agentSyncMetrics.full.lastDurationMs,
            lastAt: agentSyncMetrics.full.lastAt,
            duration: fullDuration,
        },
        deltaSync: {
            count: agentSyncMetrics.delta.count,
            failureCount: agentSyncMetrics.delta.failureCount,
            totalChanges: agentSyncMetrics.delta.totalPayloadItems,
            averageChangesPerSync: agentSyncMetrics.delta.count > 0
                ? Number((agentSyncMetrics.delta.totalPayloadItems / agentSyncMetrics.delta.count).toFixed(2))
                : 0,
            lastDurationMs: agentSyncMetrics.delta.lastDurationMs,
            lastAt: agentSyncMetrics.delta.lastAt,
            duration: deltaDuration,
        },
    };
}

function recordLockContention(
    owner: string,
    command: AgentCommand,
    requestedPaths: string[][],
    conflict: AgentPathLockConflict,
): void {
    const event: AgentLockContentionEvent = {
        timestamp: Date.now(),
        owner,
        op: command.op,
        requestedPaths: requestedPaths.map(path => [...path]),
        conflictPath: [...conflict.path],
        conflictOwner: conflict.owner,
        conflictExpiresAt: conflict.expiresAt,
    };

    agentLockContentionMetrics.total += 1;
    pushBoundedSample(agentLockContentionMetrics.recent, event, AGENT_METRICS_MAX_SAMPLES);
}

function buildLockDiagnostics(
    now: number,
    limit: number,
    includeLocks: boolean,
): {
    stats: ReturnType<AgentLockManager['getLockStats']>;
    locks: ReturnType<AgentLockManager['getActiveLocks']>;
    contention: {
        total: number;
        sampleSize: number;
        uniqueOwners: number;
        uniqueConflictOwners: number;
        recent: AgentLockContentionSnapshot[];
    };
} {
    const clampedLimit = Number.isFinite(limit)
        ? Math.min(Math.max(Math.floor(limit), 1), AGENT_METRICS_MAX_SAMPLES)
        : 100;
    const recent = agentLockContentionMetrics.recent
        .slice(-clampedLimit)
        .reverse()
        .map(event => ({
            ...event,
            conflictExpiresInMs: Math.max(0, event.conflictExpiresAt - now),
        }));
    const uniqueOwners = new Set(recent.map(event => event.owner)).size;
    const uniqueConflictOwners = new Set(recent.map(event => event.conflictOwner)).size;

    return {
        stats: agentLockManager.getLockStats(now),
        locks: includeLocks ? agentLockManager.getActiveLocks(now) : [],
        contention: {
            total: agentLockContentionMetrics.total,
            sampleSize: recent.length,
            uniqueOwners,
            uniqueConflictOwners,
            recent,
        },
    };
}

function validateBaseRevision(req: Request): { ok: true } | { ok: false; status: number; body: Record<string, unknown> } {
    const requestedBaseRevision = parseBaseRevision(req.body);
    if (requestedBaseRevision === null) {
        return { ok: true };
    }

    const currentRevision = syncEngine.getRevision();
    if (requestedBaseRevision !== currentRevision) {
        return {
            ok: false,
            status: 409,
            body: {
                success: false,
                error: 'Revision mismatch',
                expectedRevision: requestedBaseRevision,
                currentRevision,
                conflict: {
                    reason: 'revision_mismatch',
                    expected: { baseRevision: requestedBaseRevision },
                    actual: { currentRevision },
                },
            },
        };
    }

    return { ok: true };
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
    } else if (message.type === 'reparent') {
        process.stdout.write(`[CHANGE] Editor reparent: ${message.path.join('.')} -> ${message.newParentPath.join('.')}\n`);
        syncEngine.applyChange(message);

        // Pause watcher to prevent echo-back from file system events
        watcher.pauseTemporarily(2000);

        // Move files/folders on disk to match the new parent
        fileMapper.reparentFiles(message.path, message.newParentPath, message.newName);

        // Broadcast updated state to all connected VS Code clients
        broadcastFullSync();

        // Regenerate sourcemap for Luau LSP
        scheduleSourcemapGeneration();
    } else {
        process.stdout.write(`[CHANGE] Editor update: ${message.type} @ ${message.path.join('.')}\n`);
        syncEngine.applyChange(message);
        fileMapper.syncToFiles(message);
    }
}

/**
 * Normalize unknown payload to an AgentCommand (best-effort runtime parse).
 */
function asAgentCommand(payload: unknown): AgentCommand | null {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const cmd = payload as Record<string, unknown>;
    if (typeof cmd.op !== 'string') {
        return null;
    }
    const op = cmd.op.trim().toLowerCase();
    if (op !== 'create' && op !== 'update' && op !== 'rename' && op !== 'delete' && op !== 'reparent') {
        return null;
    }

    return {
        ...cmd,
        op,
    } as unknown as AgentCommand;
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function normalizePathReference(value: unknown): string[] | null {
    if (isStringArray(value)) {
        return value;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length === 0) {
            return null;
        }

        const parts = trimmed
            .split('.')
            .map(part => part.trim())
            .filter(part => part.length > 0);
        return parts.length > 0 ? parts : null;
    }

    return null;
}

function resolvePathFromTargetRef(ref: {
    targetId?: string;
    targetPath?: string[];
    path?: unknown;
}): string[] | null {
    if (typeof ref.targetId === 'string' && ref.targetId.length > 0) {
        return syncEngine.getPathById(ref.targetId) ?? null;
    }

    const candidatePath = normalizePathReference(ref.targetPath ?? ref.path);
    if (candidatePath) {
        return syncEngine.getInstance(candidatePath) ? candidatePath : null;
    }

    return null;
}

function resolvePathFromParentRef(ref: {
    parentId?: string;
    parentPath?: string[];
    parent?: unknown;
}): string[] | null {
    if (typeof ref.parentId === 'string' && ref.parentId.length > 0) {
        return syncEngine.getPathById(ref.parentId) ?? null;
    }

    const candidatePath = normalizePathReference(ref.parentPath ?? ref.parent);
    if (candidatePath) {
        if (candidatePath.length === 0) {
            return [];
        }
        return syncEngine.getInstance(candidatePath) ? candidatePath : null;
    }

    return null;
}

function resolvePathFromNewParentRef(ref: {
    newParentId?: string;
    newParentPath?: string[];
    newParent?: unknown;
}): string[] | null {
    if (typeof ref.newParentId === 'string' && ref.newParentId.length > 0) {
        return syncEngine.getPathById(ref.newParentId) ?? null;
    }

    const candidatePath = normalizePathReference(ref.newParentPath ?? ref.newParent);
    if (candidatePath) {
        return syncEngine.getInstance(candidatePath) ? candidatePath : null;
    }

    return null;
}

function collectLockPaths(command: AgentCommand): string[][] {
    const lockPaths: string[][] = [];

    if (command.op === 'create') {
        const parentPath = resolvePathFromParentRef(command);
        if (parentPath && parentPath.length > 0) {
            lockPaths.push(parentPath);
            const requestedName = typeof command.name === 'string' ? command.name.trim() : '';
            if (requestedName.length > 0) {
                lockPaths.push([...parentPath, requestedName]);
            }
        }
    } else if (command.op === 'update' || command.op === 'rename' || command.op === 'delete') {
        const targetPath = resolvePathFromTargetRef(command);
        if (targetPath && targetPath.length > 0) {
            lockPaths.push(targetPath);
        }
    } else if (command.op === 'reparent') {
        const targetPath = resolvePathFromTargetRef(command);
        if (targetPath && targetPath.length > 0) {
            lockPaths.push(targetPath);
        }

        const newParentPath = resolvePathFromNewParentRef(command);
        if (newParentPath && newParentPath.length > 0) {
            lockPaths.push(newParentPath);
            if (targetPath && targetPath.length > 0) {
                const movingName = targetPath[targetPath.length - 1];
                lockPaths.push([...newParentPath, movingName]);
            }
        }
    }

    return lockPaths;
}

function createLockOwner(idempotencyKey: string | null): string {
    if (idempotencyKey && idempotencyKey.length > 0) {
        return `idempotency:${idempotencyKey}`;
    }
    return `request:${crypto.randomUUID()}`;
}

/**
 * Execute an agent command through the same flow used by editor changes.
 * Returns normalized outcome for deterministic automation clients.
 */
function executeAgentCommand(command: AgentCommand, index: number): AgentCommandResult {
    const requestedOp = command.op;

    try {
        if (command.op === 'create') {
            const parentPath = resolvePathFromParentRef(command);
            if (!parentPath) {
                return {
                    index,
                    op: command.op,
                    success: false,
                    error: 'Parent not found (id/path)',
                    conflict: buildConflict('not_found', command, { currentRevision: syncEngine.getRevision() }),
                };
            }

            if (typeof command.className !== 'string' || command.className.trim().length === 0) {
                return {
                    index,
                    op: command.op,
                    success: false,
                    error: 'Missing className',
                    conflict: buildConflict('validation_failed', command, { field: 'className' }),
                };
            }

            if (typeof command.name !== 'string' || command.name.trim().length === 0) {
                return {
                    index,
                    op: command.op,
                    success: false,
                    error: 'Missing name',
                    conflict: buildConflict('validation_failed', command, { field: 'name' }),
                };
            }

            const instance: RobloxInstance = {
                id: crypto.randomUUID(),
                className: command.className,
                name: command.name.trim(),
                parent: parentPath.join('.'),
                properties: command.properties ?? {},
                children: [],
            };

            const message: SyncMessage = {
                type: 'create',
                timestamp: Date.now(),
                path: [...parentPath, instance.name],
                instance,
            };

            handleEditorChange(message);

            const resolvedPath = message.path;
            return {
                index,
                op: command.op,
                success: true,
                resolvedPath,
                resolvedId: instance.id,
            };
        }

        if (command.op === 'update') {
            const targetPath = resolvePathFromTargetRef(command);
            if (!targetPath) {
                return {
                    index,
                    op: command.op,
                    success: false,
                    error: 'Target not found (id/path)',
                    conflict: buildConflict('not_found', command, { currentRevision: syncEngine.getRevision() }),
                };
            }

            const commandRecord = command as unknown as Record<string, unknown>;
            const hasSingleProperty = typeof command.property === 'string' && command.property.trim().length > 0;
            const rawPropertiesMap = commandRecord.properties;
            const hasPropertiesMap = !!rawPropertiesMap && typeof rawPropertiesMap === 'object' && !Array.isArray(rawPropertiesMap);

            if (!hasSingleProperty && !hasPropertiesMap) {
                return {
                    index,
                    op: command.op,
                    success: false,
                    error: 'Missing property update payload',
                    conflict: buildConflict('validation_failed', command, { fields: ['property', 'value', 'properties'] }),
                };
            }

            const target = syncEngine.getInstance(targetPath);
            if (!target) {
                return {
                    index,
                    op: command.op,
                    success: false,
                    error: 'Target not found (id/path)',
                    conflict: buildConflict('not_found', command, { targetPath }),
                };
            }

            const targetId = target?.id;
            const updates: Array<{ property: string; value: PropertyValue }> = [];

            if (hasSingleProperty) {
                updates.push({
                    property: command.property.trim(),
                    value: command.value as PropertyValue,
                });
            } else if (hasPropertiesMap) {
                for (const [propertyName, propertyValue] of Object.entries(rawPropertiesMap as Record<string, unknown>)) {
                    if (typeof propertyName !== 'string' || propertyName.trim().length === 0) {
                        continue;
                    }
                    updates.push({
                        property: propertyName.trim(),
                        value: propertyValue as PropertyValue,
                    });
                }
            }

            if (updates.length === 0) {
                return {
                    index,
                    op: command.op,
                    success: false,
                    error: 'No valid properties to update',
                    conflict: buildConflict('validation_failed', command, { field: 'properties' }),
                };
            }

            for (const updateEntry of updates) {
                const validation = validateAgentPropertyUpdate(
                    target,
                    updateEntry.property,
                    updateEntry.value,
                );
                if (validation.ok === false) {
                    return {
                        index,
                        op: command.op,
                        success: false,
                        error: validation.error,
                        conflict: buildConflict('validation_failed', command, validation.details),
                    };
                }

                const message: SyncMessage = {
                    type: 'update',
                    timestamp: Date.now(),
                    path: targetPath,
                    property: {
                        name: updateEntry.property,
                        value: updateEntry.value,
                    },
                };

                handleEditorChange(message);
            }

            const resolvedPath = targetId ? syncEngine.getPathById(targetId) ?? targetPath : targetPath;
            return {
                index,
                op: command.op,
                success: true,
                resolvedPath,
                resolvedId: targetId,
            };
        }

        if (command.op === 'rename') {
            const targetPath = resolvePathFromTargetRef(command);
            if (!targetPath) {
                return {
                    index,
                    op: command.op,
                    success: false,
                    error: 'Target not found (id/path)',
                    conflict: buildConflict('not_found', command, { currentRevision: syncEngine.getRevision() }),
                };
            }

            const commandRecord = command as unknown as Record<string, unknown>;
            const renameTo = typeof command.name === 'string' && command.name.trim().length > 0
                ? command.name.trim()
                : (
                    typeof commandRecord.newName === 'string'
                    && commandRecord.newName.trim().length > 0
                        ? commandRecord.newName.trim()
                        : ''
                );

            if (renameTo.length === 0) {
                return {
                    index,
                    op: command.op,
                    success: false,
                    error: 'Missing name',
                    conflict: buildConflict('validation_failed', command, { field: 'name' }),
                };
            }

            const target = syncEngine.getInstance(targetPath);
            const targetId = target?.id;
            if (!targetId) {
                return {
                    index,
                    op: command.op,
                    success: false,
                    error: 'Target id missing',
                    conflict: buildConflict('not_found', command, { targetPath }),
                };
            }

            const message: SyncMessage = {
                type: 'update',
                timestamp: Date.now(),
                path: targetPath,
                property: { name: 'Name', value: renameTo },
            };

            handleEditorChange(message);

            const resolvedPath = syncEngine.getPathById(targetId);
            return {
                index,
                op: command.op,
                success: resolvedPath !== undefined,
                error: resolvedPath ? undefined : 'Rename failed to resolve new path',
                resolvedPath,
                resolvedId: targetId,
                conflict: resolvedPath ? undefined : buildConflict('not_found', command, { targetId }),
            };
        }

        if (command.op === 'delete') {
            const targetPath = resolvePathFromTargetRef(command);
            if (!targetPath) {
                return {
                    index,
                    op: command.op,
                    success: false,
                    error: 'Target not found (id/path)',
                    conflict: buildConflict('not_found', command, { currentRevision: syncEngine.getRevision() }),
                };
            }

            const target = syncEngine.getInstance(targetPath);
            const targetId = target?.id;

            const message: SyncMessage = {
                type: 'delete',
                timestamp: Date.now(),
                path: targetPath,
            };

            handleEditorChange(message);

            return {
                index,
                op: command.op,
                success: true,
                resolvedPath: targetPath,
                resolvedId: targetId,
            };
        }

        if (command.op === 'reparent') {
            const targetPath = resolvePathFromTargetRef(command);
            if (!targetPath) {
                return {
                    index,
                    op: command.op,
                    success: false,
                    error: 'Target not found (id/path)',
                    conflict: buildConflict('not_found', command, { currentRevision: syncEngine.getRevision() }),
                };
            }

            const newParentPath = resolvePathFromNewParentRef(command);
            if (!newParentPath) {
                return {
                    index,
                    op: command.op,
                    success: false,
                    error: 'New parent not found (id/path)',
                    conflict: buildConflict('not_found', command, { targetPath }),
                };
            }

            const target = syncEngine.getInstance(targetPath);
            const targetId = target?.id;
            if (!targetId) {
                return {
                    index,
                    op: command.op,
                    success: false,
                    error: 'Target id missing',
                    conflict: buildConflict('not_found', command, { targetPath }),
                };
            }

            const message: SyncMessage = {
                type: 'reparent',
                timestamp: Date.now(),
                path: targetPath,
                newParentPath,
            };

            handleEditorChange(message);

            const resolvedPath = syncEngine.getPathById(targetId);
            return {
                index,
                op: command.op,
                success: resolvedPath !== undefined,
                error: resolvedPath ? undefined : 'Reparent failed to resolve target',
                resolvedPath,
                resolvedId: targetId,
                conflict: resolvedPath ? undefined : buildConflict('not_found', command, { targetId }),
            };
        }

        return {
            index,
            op: requestedOp,
            success: false,
            error: `Unsupported op: ${String((command as Record<string, unknown>).op)}`,
            conflict: buildConflict('validation_failed', command),
        };
    } catch (error) {
        return {
            index,
            op: requestedOp,
            success: false,
            error: String(error),
            conflict: buildConflict('validation_failed', command, { exception: String(error) }),
        };
    }
}

function restoreAfterRollback(snapshot: ReturnType<SyncEngine['createSnapshot']>): void {
    syncEngine.restoreSnapshot(snapshot);

    // Ensure filesystem and clients converge to restored state.
    watcher.pauseTemporarily(2000);
    fileMapper.syncAllToFiles(syncEngine.getAllInstances());
    broadcastFullSync();
    scheduleSourcemapGeneration();
}

function clearTestDispatchTimeout(runId: string): void {
    const timer = testDispatchTimeouts.get(runId);
    if (timer) {
        clearTimeout(timer);
        testDispatchTimeouts.delete(runId);
    }
}

function clearTestExecutionTimeout(runId: string): void {
    const timer = testExecutionTimeouts.get(runId);
    if (timer) {
        clearTimeout(timer);
        testExecutionTimeouts.delete(runId);
    }
}

function clearDelayedTestDispatchTimer(): void {
    if (delayedTestDispatchTimer) {
        clearTimeout(delayedTestDispatchTimer);
        delayedTestDispatchTimer = null;
    }
}

function isFinalTestStatus(status: AgentTestRun['status']): boolean {
    return status === 'passed' || status === 'failed' || status === 'aborted' || status === 'error';
}

function sendPluginTestAbort(runId: string): void {
    const command: SyncMessage = {
        type: 'command',
        action: 'test_abort',
        runId,
        timestamp: Date.now(),
    };
    syncEngine.applyChange(command);
    broadcastToClients(command);
}

function getRunTimeoutMs(run: AgentTestRun): number {
    const safety = (
        run.scenario.safety
        && typeof run.scenario.safety === 'object'
        && !Array.isArray(run.scenario.safety)
    ) ? run.scenario.safety as Record<string, unknown> : null;
    const rawTimeout = safety && typeof safety.timeoutMs === 'number' ? safety.timeoutMs : DEFAULT_TEST_TIMEOUT_MS;
    if (typeof rawTimeout !== 'number' || !Number.isFinite(rawTimeout) || rawTimeout <= 0) {
        return DEFAULT_TEST_TIMEOUT_MS;
    }
    return Math.floor(rawTimeout);
}

function toApiTestRun(
    run: AgentTestRun,
): AgentTestRun & { artifactDir: string; nextDispatchInMs?: number } {
    const nextDispatchInMs = (
        run.status === 'queued'
        && typeof run.nextDispatchAt === 'number'
    )
        ? Math.max(0, run.nextDispatchAt - Date.now())
        : undefined;

    return {
        ...run,
        artifactDir: agentTestArtifactStore.getRunRelativeDir(run.id),
        nextDispatchInMs,
    };
}

function buildTestRunEnvelope(run: ReturnType<typeof toApiTestRun> | null): {
    id: string | null;
    status: string | null;
    run: ReturnType<typeof toApiTestRun> | null;
} {
    return {
        id: run?.id ?? null,
        status: run?.status ?? null,
        run,
    };
}

function parseOptionalBooleanQuery(value: unknown, defaultValue: boolean): boolean {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value !== 'string') {
        return defaultValue;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
        return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
        return false;
    }
    return defaultValue;
}

function resolvePublicBaseUrl(): string {
    const host = config.host === '0.0.0.0' ? '127.0.0.1' : config.host;
    return `http://${host}:${config.port}`;
}

function buildHealthResponse(): HealthResponse {
    const instances = syncEngine.getAllInstances();
    return {
        status: 'ok',
        timestamp: Date.now(),
        version: SERVER_VERSION,
        instanceCount: instances.length,
        agent: {
            capabilitiesEndpoint: '/agent/capabilities',
            bootstrapEndpoint: '/agent/bootstrap',
            snapshotEndpoint: '/agent/snapshot',
            schemaEndpoint: '/agent/schema/properties',
            commandSchemaEndpoint: '/agent/schema/commands',
        },
    };
}

function buildAgentCapabilitiesManifest(): Record<string, unknown> {
    return {
        success: true,
        version: 'uxr-agent-capabilities/v1',
        baseUrl: resolvePublicBaseUrl(),
        bootstrapEndpoint: '/agent/bootstrap',
        bootstrapDefaults: {
            includeSnapshot: true,
            includeSchema: true,
        },
        quickstart: [
            'GET /health',
            'GET /agent/bootstrap',
            'GET /agent/schema/commands',
            'POST /agent/commands',
            'POST /agent/tests/run',
            'GET /agent/tests/:id (poll until final status)',
        ],
        snapshot: {
            pathFormats: ['array', 'string'],
            fields: ['id', 'className', 'name', 'path', 'pathString', 'parentId', 'childIds', 'properties'],
        },
        commands: {
            single: '/agent/command',
            batch: '/agent/commands',
            schemaEndpoint: '/agent/schema/commands',
            ops: ['create', 'update', 'rename', 'delete', 'reparent'],
            transactionalField: 'transactional',
            conflictReasons: ['not_found', 'locked', 'revision_mismatch', 'validation_failed'],
        },
        tests: {
            runEndpoint: '/agent/tests/run',
            readEndpoint: '/agent/tests/:id',
            listEndpoint: '/agent/tests',
            finalStatuses: ['passed', 'failed', 'aborted', 'error'],
            recommendedRuntime: {
                mode: 'play',
                stopOnFinish: true,
            },
            responseFields: {
                run: ['success', 'id', 'status', 'run'],
                read: ['success', 'id', 'status', 'run'],
                list: ['success', 'runs', 'items', 'activeRunId'],
            },
            stepTypes: [
                'wait',
                'assertExists',
                'assertNotExists',
                'assertProperty',
                'setProperty',
                'createInstance',
                'destroyInstance',
                'renameInstance',
                'reparentInstance',
                'harnessAction',
                'captureScreenshot',
                'captureArtifact',
            ],
        },
    };
}

function buildAgentCommandSchema(): Record<string, unknown> {
    return {
        success: true,
        version: 'uxr-agent-command-schema/v1',
        request: {
            singleEndpoint: '/agent/command',
            batchEndpoint: '/agent/commands',
            batchBodyFields: ['commands', 'transactional', 'continueOnError', 'baseRevision'],
            pathRules: {
                canonical: 'string[]',
                aliasesAccepted: ['dot-separated string'],
                examples: [
                    ['Workspace', 'Part'],
                    'Workspace.Part',
                ],
            },
        },
        commands: {
            create: {
                required: ['op', 'className', 'name', 'parentPath|parentId'],
                aliases: ['parent'],
                example: {
                    op: 'create',
                    parentPath: ['Workspace'],
                    className: 'Part',
                    name: 'Lava',
                    properties: {
                        Anchored: true,
                        CanCollide: false,
                    },
                },
            },
            update: {
                required: ['op', 'targetPath|targetId'],
                variants: [
                    { required: ['property', 'value'] },
                    { required: ['properties (object map)'] },
                ],
                aliases: ['path'],
                exampleSingle: {
                    op: 'update',
                    targetPath: ['Workspace', 'Lava'],
                    property: 'Transparency',
                    value: 0.2,
                },
                exampleMulti: {
                    op: 'update',
                    targetPath: ['Workspace', 'Lava'],
                    properties: {
                        Anchored: true,
                        CanCollide: false,
                    },
                },
            },
            rename: {
                required: ['op', 'targetPath|targetId', 'name'],
                aliases: ['path', 'newName'],
                example: {
                    op: 'rename',
                    targetPath: ['Workspace', 'Lava'],
                    name: 'Lava_2',
                },
            },
            delete: {
                required: ['op', 'targetPath|targetId'],
                aliases: ['path'],
                example: {
                    op: 'delete',
                    targetPath: ['Workspace', 'OldPart'],
                },
            },
            reparent: {
                required: ['op', 'targetPath|targetId', 'newParentPath|newParentId'],
                aliases: ['path'],
                example: {
                    op: 'reparent',
                    targetPath: ['Workspace', 'Lava'],
                    newParentPath: ['ReplicatedStorage'],
                },
            },
        },
        notes: [
            'Use array paths as canonical format to avoid ambiguity.',
            'Avoid probe writes (Tmp objects) to discover schema; use this endpoint instead.',
            'Prefer one transactional batch with deterministic target paths.',
        ],
    };
}

function normalizeVisualBaselineMode(value: unknown): VisualBaselineMode {
    if (typeof value !== 'string') {
        return 'assert';
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === 'record') {
        return 'record';
    }
    if (normalized === 'assert_or_record' || normalized === 'auto') {
        return 'assert_or_record';
    }
    return 'assert';
}

async function maybeEvaluateVisualBaseline(
    result: Record<string, unknown> | undefined,
    artifactMimeType: string | undefined,
    artifactBase64: string | undefined,
): Promise<Awaited<ReturnType<AgentVisualBaselineStore['evaluateBase64Artifact']>> | null> {
    if (!result || !artifactMimeType || !artifactBase64) {
        return null;
    }
    if (!artifactMimeType.toLowerCase().startsWith('image/')) {
        return null;
    }

    const baselineKey = typeof result.baselineKey === 'string'
        ? result.baselineKey.trim()
        : '';
    if (baselineKey.length === 0) {
        return null;
    }

    const baselineMode = normalizeVisualBaselineMode(result.baselineMode);
    const allowMissingBaseline = result.baselineAllowMissing === true;

    try {
        return await agentVisualBaselineStore.evaluateBase64Artifact({
            key: baselineKey,
            mode: baselineMode,
            allowMissingBaseline,
            mimeType: artifactMimeType,
            base64Data: artifactBase64,
        });
    } catch (error) {
        const message = `Visual baseline evaluation failed: ${String(error)}`;
        return {
            comparison: {
                key: baselineKey,
                mode: baselineMode,
                baselineFound: false,
                matched: false,
                baselinePath: null,
                artifactHash: '',
                baselineHash: null,
                updatedBaseline: false,
                reason: 'baseline_evaluation_error',
            },
            shouldFail: true,
            failureMessage: message,
        };
    }
}

function buildAgentTestMetrics(limit: number): Record<string, unknown> {
    const now = Date.now();
    const queuedRuns = agentTestManager.getQueuedRunsInOrder();
    const queueSize = queuedRuns.length;
    const delayedQueueSize = queuedRuns.filter(run =>
        typeof run.nextDispatchAt === 'number' && run.nextDispatchAt > now,
    ).length;
    const readyQueueSize = queueSize - delayedQueueSize;
    const nextDispatchDelayMs = agentTestManager.getNextQueuedDelayMs(now);

    const runs = agentTestManager.getRuns(limit);
    const statusCounts: Record<string, number> = {
        queued: 0,
        dispatching: 0,
        running: 0,
        passed: 0,
        failed: 0,
        aborted: 0,
        error: 0,
    };

    let attemptSum = 0;
    let maxAttempt = 0;
    let retriedRuns = 0;
    const durationSamples: number[] = [];

    for (const run of runs) {
        statusCounts[run.status] = (statusCounts[run.status] ?? 0) + 1;
        attemptSum += run.attempt;
        maxAttempt = Math.max(maxAttempt, run.attempt);
        if (run.attempt > 1) {
            retriedRuns += 1;
        }

        let durationMs: number | null = null;
        if (typeof run.startedAt === 'number' && typeof run.finishedAt === 'number') {
            durationMs = Math.max(0, run.finishedAt - run.startedAt);
        } else if (
            run.result
            && typeof run.result === 'object'
            && typeof (run.result as Record<string, unknown>).durationMs === 'number'
        ) {
            durationMs = Math.max(0, Math.floor((run.result as Record<string, unknown>).durationMs as number));
        }
        if (durationMs !== null) {
            durationSamples.push(durationMs);
        }
    }

    let averageDurationMs: number | null = null;
    let p95DurationMs: number | null = null;
    if (durationSamples.length > 0) {
        const total = durationSamples.reduce((sum, value) => sum + value, 0);
        averageDurationMs = Math.round(total / durationSamples.length);
        const sorted = [...durationSamples].sort((a, b) => a - b);
        const p95Index = Math.floor((sorted.length - 1) * 0.95);
        p95DurationMs = sorted[p95Index];
    }

    const lockDiagnostics = buildLockDiagnostics(now, limit, false);
    const idempotencyRequests = agentIdempotencyMetrics.cacheHits + agentIdempotencyMetrics.cacheMisses;
    const idempotencyHitRate = idempotencyRequests > 0
        ? Number((agentIdempotencyMetrics.cacheHits / idempotencyRequests).toFixed(4))
        : 0;

    return {
        generatedAt: now,
        activeRunId: agentTestManager.getActiveRunId(),
        queue: {
            size: queueSize,
            ready: readyQueueSize,
            delayed: delayedQueueSize,
            nextDispatchDelayMs,
            runs: queuedRuns.map((run, index) => ({
                runId: run.id,
                position: index + 1,
                attempt: run.attempt,
                maxRetries: run.maxRetries,
                retryBackoffMs: run.retryBackoffMs ?? 0,
                nextDispatchAt: run.nextDispatchAt ?? null,
                nextDispatchInMs: typeof run.nextDispatchAt === 'number'
                    ? Math.max(0, run.nextDispatchAt - now)
                    : 0,
            })),
        },
        recent: {
            sampleSize: runs.length,
            statusCounts,
            retriedRuns,
            averageAttempt: runs.length > 0 ? Number((attemptSum / runs.length).toFixed(2)) : 0,
            maxAttempt,
            duration: {
                samples: durationSamples.length,
                averageMs: averageDurationMs,
                p95Ms: p95DurationMs,
            },
        },
        locks: {
            active: lockDiagnostics.stats,
            contention: lockDiagnostics.contention,
        },
        idempotency: {
            cacheSize: agentIdempotencyCache.size(now),
            cacheHits: agentIdempotencyMetrics.cacheHits,
            cacheMisses: agentIdempotencyMetrics.cacheMisses,
            writes: agentIdempotencyMetrics.writes,
            hitRate: idempotencyHitRate,
        },
        sync: buildSyncMetrics(),
    };
}

function persistTestEvent(
    runId: string,
    event: string,
    message?: string,
    result?: Record<string, unknown>,
    timestamp?: number,
): void {
    const resolvedTimestamp = (
        typeof timestamp === 'number'
        && Number.isFinite(timestamp)
        && timestamp > 0
    ) ? Math.floor(timestamp) : Date.now();

    void agentTestArtifactStore.recordEvent({
        runId,
        event,
        timestamp: resolvedTimestamp,
        message,
        result,
    }).catch(error => {
        console.error(`[TEST] Failed to persist event for ${runId}:`, error);
    });
}

function persistTestReport(runId: string): void {
    const run = agentTestManager.getRun(runId);
    if (!run) {
        return;
    }

    void agentTestArtifactStore.writeReport(run).catch(error => {
        console.error(`[TEST] Failed to persist report for ${runId}:`, error);
    });
}

function finalizeTestRunFromEvent(
    runId: string,
    status: Extract<AgentTestRun['status'], 'passed' | 'failed' | 'aborted' | 'error'>,
    message?: string,
    result?: Record<string, unknown>,
    timestamp?: number,
): { run: AgentTestRun | null; retried: boolean } {
    clearTestDispatchTimeout(runId);
    clearTestExecutionTimeout(runId);

    const current = agentTestManager.getRun(runId);
    if (!current) {
        return { run: null, retried: false };
    }

    // Duplicate plugin events can arrive after completion; keep endpoint idempotent.
    if (isFinalTestStatus(current.status)) {
        return { run: current, retried: false };
    }

    // Ignore stale events from older attempts once a retry is already queued.
    if (current.status !== 'running' && current.status !== 'dispatching') {
        return { run: current, retried: false };
    }

    persistTestEvent(runId, status, message, result, timestamp);

    if ((status === 'failed' || status === 'error') && agentTestManager.canRetry(runId)) {
        const retryLabel = `Attempt ${current.attempt}/${current.maxRetries + 1} failed; retry queued`;
        const queued = agentTestManager.queueRetry(runId, retryLabel);
        if (queued) {
            const retryMessage = typeof queued.retryBackoffMs === 'number' && queued.retryBackoffMs > 0
                ? `${retryLabel} with ${queued.retryBackoffMs}ms backoff`
                : retryLabel;
            persistTestEvent(runId, 'retry_queued', retryMessage, {
                attempt: queued.attempt,
                maxRetries: queued.maxRetries,
                retryBackoffMs: queued.retryBackoffMs ?? 0,
                nextDispatchAt: queued.nextDispatchAt ?? null,
            });
            persistTestReport(runId);
            dispatchNextAgentTestRun();
            return { run: queued, retried: true };
        }
    }

    const done = agentTestManager.complete(runId, status, message, result);
    if (done) {
        persistTestReport(runId);
        dispatchNextAgentTestRun();
    }
    return { run: done, retried: false };
}

function scheduleTestExecutionTimeout(run: AgentTestRun): void {
    const timeoutMs = getRunTimeoutMs(run);
    clearTestExecutionTimeout(run.id);
    const timer = setTimeout(() => {
        const current = agentTestManager.getRun(run.id);
        if (!current || current.status !== 'running') {
            clearTestExecutionTimeout(run.id);
            return;
        }

        const timeoutMessage = `Test execution timed out after ${timeoutMs}ms`;
        persistTestEvent(run.id, 'timeout', timeoutMessage);
        sendPluginTestAbort(run.id);
        finalizeTestRunFromEvent(
            run.id,
            'error',
            timeoutMessage,
            {
                reason: 'timeout',
                timeoutMs,
                attempt: current.attempt,
            },
        );
    }, timeoutMs);

    testExecutionTimeouts.set(run.id, timer);
}

function scheduleDelayedTestDispatch(): void {
    if (agentTestManager.hasActiveRun()) {
        clearDelayedTestDispatchTimer();
        return;
    }

    const nextDelayMs = agentTestManager.getNextQueuedDelayMs();
    if (nextDelayMs === null) {
        clearDelayedTestDispatchTimer();
        return;
    }

    if (nextDelayMs <= 0) {
        clearDelayedTestDispatchTimer();
        dispatchNextAgentTestRun();
        return;
    }

    clearDelayedTestDispatchTimer();
    delayedTestDispatchTimer = setTimeout(() => {
        delayedTestDispatchTimer = null;
        dispatchNextAgentTestRun();
    }, nextDelayMs);
}

function dispatchNextAgentTestRun(): void {
    if (agentTestManager.hasActiveRun()) {
        return;
    }

    const next = agentTestManager.peekNextQueuedRun();
    if (!next) {
        scheduleDelayedTestDispatch();
        return;
    }
    clearDelayedTestDispatchTimer();

    const dispatching = agentTestManager.markDispatching(next.id);
    if (!dispatching) {
        scheduleDelayedTestDispatch();
        return;
    }
    persistTestEvent(dispatching.id, 'dispatching', 'Dispatching test run to plugin');
    persistTestReport(dispatching.id);

    const command: SyncMessage = {
        type: 'command',
        action: 'test_run',
        runId: dispatching.id,
        payload: {
            scenario: dispatching.scenario,
            attempt: dispatching.attempt,
        },
        timestamp: Date.now(),
    };

    syncEngine.applyChange(command);
    broadcastToClients(command);

    clearTestDispatchTimeout(dispatching.id);
    const timer = setTimeout(() => {
        const current = agentTestManager.getRun(dispatching.id);
        if (current && current.status === 'dispatching') {
            finalizeTestRunFromEvent(
                dispatching.id,
                'error',
                'Test dispatch timed out (plugin did not acknowledge start)',
                {
                    reason: 'dispatch_timeout',
                    timeoutMs: TEST_DISPATCH_TIMEOUT_MS,
                    attempt: current.attempt,
                },
            );
        }
        clearTestDispatchTimeout(dispatching.id);
    }, TEST_DISPATCH_TIMEOUT_MS);
    testDispatchTimeouts.set(dispatching.id, timer);
}

// =============================================================================
// HTTP API Endpoints
// =============================================================================

/**
 * Health check endpoint.
 * Used by clients to verify server availability.
 */
app.get('/health', (_req: Request, res: Response) => {
    res.json(buildHealthResponse());
});

/**
 * Sync endpoint - receives DataModel snapshot from Roblox plugin.
 * This is the main sync path from Roblox Studio to the server.
 */
app.post('/sync', (req: Request, res: Response) => {
    const startedAt = Date.now();
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
        broadcastFullSync();

        const response: SyncResponse = {
            success: true,
            changesApplied: changes.length,
        };
        recordSyncMetricsSuccess('full', Date.now() - startedAt, instances.length);
        res.json(response);
    } catch (error) {
        recordSyncMetricsFailure('full');
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
    const startedAt = Date.now();
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
        recordSyncMetricsSuccess('delta', Date.now() - startedAt, changes.length);
    } catch (error) {
        recordSyncMetricsFailure('delta');
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
 * Agent snapshot endpoint.
 * Returns deterministic indexed view for AI agents.
 */
app.get('/agent/snapshot', (_req: Request, res: Response) => {
    res.json(agentDerivedCache.getSnapshot());
});

/**
 * Agent property schema endpoint.
 * Returns class-level property metadata inferred from current snapshot values.
 */
app.get('/agent/schema/properties', (req: Request, res: Response) => {
    const classNameFilter = typeof req.query.className === 'string'
        ? req.query.className.trim()
        : undefined;

    res.json(agentDerivedCache.getSchema(classNameFilter));
});

/**
 * Agent command schema endpoint.
 * Returns canonical payload rules + aliases so generic agents do not need probe writes.
 */
app.get('/agent/schema/commands', (_req: Request, res: Response) => {
    res.json(buildAgentCommandSchema());
});

/**
 * Machine-readable capabilities manifest for generic agents.
 * This is intentionally compact so agents can bootstrap without scanning long docs.
 */
app.get('/agent/capabilities', (_req: Request, res: Response) => {
    res.json(buildAgentCapabilitiesManifest());
});

/**
 * One-shot bootstrap endpoint for generic agents.
 * Returns health + capabilities and optionally full snapshot/schema in one request.
 */
app.get('/agent/bootstrap', (req: Request, res: Response) => {
    const includeSnapshot = parseOptionalBooleanQuery(req.query.includeSnapshot, true);
    const includeSchema = parseOptionalBooleanQuery(req.query.includeSchema, true);
    const classNameFilter = typeof req.query.className === 'string'
        ? req.query.className.trim()
        : undefined;

    const payload: Record<string, unknown> = {
        success: true,
        version: 'uxr-agent-bootstrap/v1',
        baseUrl: resolvePublicBaseUrl(),
        health: buildHealthResponse(),
        capabilities: buildAgentCapabilitiesManifest(),
        commandSchema: buildAgentCommandSchema(),
        defaults: {
            includeSnapshot: true,
            includeSchema: true,
        },
    };

    if (includeSnapshot) {
        const snapshot = agentDerivedCache.getSnapshot();
        payload.snapshot = snapshot;
        payload.snapshotSummary = {
            revision: snapshot.revision,
            generatedAt: snapshot.generatedAt,
            instanceCount: snapshot.instances.length,
        };
    }

    if (includeSchema) {
        const schema = agentDerivedCache.getSchema(classNameFilter);
        payload.schema = schema;
        payload.schemaSummary = {
            revision: schema.revision,
            generatedAt: schema.generatedAt,
            schemaVersion: schema.schemaVersion,
            classCount: schema.classes.length,
            classNameFilter: classNameFilter ?? null,
        };
    }

    res.json(payload);
});

/**
 * Execute a single agent command.
 */
app.post('/agent/command', (req: Request, res: Response) => {
    const idempotencyKey = resolveIdempotencyKey(req);
    const outcome = executeIdempotentRequest({
        idempotencyKey,
        getCached: getCachedAgentResponse,
        cache: cacheAgentResponse,
        execute: () => executeSingleAgentCommandFlow({
            requestBody: req.body,
            idempotencyKey,
            deps: {
                validateBaseRevision: () => validateBaseRevision(req),
                parseCommand: asAgentCommand,
                createLockOwner,
                collectLockPaths,
                acquireLock: (owner, paths) => agentLockManager.acquire(owner, paths),
                releaseLock: owner => agentLockManager.release(owner),
                executeAgentCommand,
                getRevision: () => syncEngine.getRevision(),
                recordLockContention,
            },
        }),
    });

    res.status(outcome.status).json(outcome.body);
});

/**
 * Execute multiple agent commands in order.
 */
app.post('/agent/commands', (req: Request, res: Response) => {
    const idempotencyKey = resolveIdempotencyKey(req);
    const outcome = executeIdempotentRequest({
        idempotencyKey,
        getCached: getCachedAgentResponse,
        cache: cacheAgentResponse,
        execute: () => executeBatchAgentCommandFlow({
            requestBody: req.body,
            idempotencyKey,
            deps: {
                validateBaseRevision: () => validateBaseRevision(req),
                parseCommand: asAgentCommand,
                createLockOwner,
                collectLockPaths,
                acquireLock: (owner, paths) => agentLockManager.acquire(owner, paths),
                releaseLock: owner => agentLockManager.release(owner),
                executeAgentCommand,
                getRevision: () => syncEngine.getRevision(),
                recordLockContention,
                createSnapshot: () => syncEngine.createSnapshot(),
                restoreAfterRollback: snapshot =>
                    restoreAfterRollback(snapshot as ReturnType<SyncEngine['createSnapshot']>),
            },
        }),
    });

    res.status(outcome.status).json(outcome.body);
});

/**
 * Enqueue and run an autonomous agent test scenario.
 */
app.post('/agent/tests/run', (req: Request, res: Response) => {
    const normalized = normalizeAgentTestScenario(req.body?.scenario);
    if (!normalized.ok) {
        const errorMessage = 'error' in normalized ? normalized.error : 'Invalid scenario';
        res.status(400).json({
            success: false,
            error: errorMessage,
        });
        return;
    }

    const run = agentTestManager.enqueue(normalized.scenario as Record<string, unknown>);
    persistTestEvent(run.id, 'queued', 'Test run queued');
    persistTestReport(run.id);
    dispatchNextAgentTestRun();

    const queuedPosition = agentTestManager.getQueuedPosition(run.id);
    const latestRun = agentTestManager.getRun(run.id) ?? run;
    const apiRun = toApiTestRun(latestRun);

    res.status(202).json({
        success: true,
        ...buildTestRunEnvelope(apiRun),
        safety: normalized.scenario.safety,
        runtime: normalized.scenario.runtime,
        queuedPosition,
        activeRunId: agentTestManager.getActiveRunId(),
    });
});

/**
 * Get test queue/runtime metrics for observability.
 */
app.get('/agent/tests/metrics', (req: Request, res: Response) => {
    const limitRaw = parseInt(String(req.query.limit ?? '100'), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 10), 500) : 100;

    res.json({
        success: true,
        metrics: buildAgentTestMetrics(limit),
    });
});

/**
 * Get active lock diagnostics and recent lock contention events.
 */
app.get('/agent/locks', (req: Request, res: Response) => {
    const limitRaw = parseInt(String(req.query.limit ?? '100'), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;
    const includeLocks = req.query.includeLocks !== 'false';
    const now = Date.now();
    const diagnostics = buildLockDiagnostics(now, limit, includeLocks);

    res.json({
        success: true,
        generatedAt: now,
        ...diagnostics,
    });
});

/**
 * Export reproducible debug bundle with snapshot/schema/metrics/locks.
 */
app.post('/agent/debug/export', (req: Request, res: Response) => {
    const now = Date.now();
    const body = req.body && typeof req.body === 'object'
        ? req.body as Record<string, unknown>
        : {};
    const includeLocks = body.includeLocks !== false;
    const includeSchema = body.includeSchema !== false;
    const includeBundle = body.includeBundle !== false;
    const persistToDisk = body.persist !== false;
    const label = typeof body.label === 'string' ? sanitizeBundleLabel(body.label) : '';
    const limitRaw = parseInt(String(body.limit ?? req.query.limit ?? '100'), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;

    const snapshot = agentDerivedCache.getSnapshot();
    const revision = snapshot.revision;
    const schema = includeSchema
        ? agentDerivedCache.getSchema()
        : {
            schemaVersion: 'uxr-agent-property-schema/v1' as const,
            generatedAt: now,
            revision,
            classes: [],
        };
    const metrics = buildAgentTestMetrics(limit);
    const lockDiagnostics = buildLockDiagnostics(now, limit, includeLocks);
    const pendingChangeCount = syncEngine.getPendingChangesForPlugin().length;

    const bundle = buildAgentStateBundle({
        generatedAt: now,
        revision,
        workspacePath: config.workspacePath,
        snapshot,
        schema,
        pendingChangeCount,
        lockDiagnostics,
        metrics,
    });

    let persisted: ReturnType<typeof persistAgentStateBundle> | null = null;
    if (persistToDisk) {
        const fileName = buildAgentStateBundleFilename(now, label);
        persisted = persistAgentStateBundle({
            outputDir: path.join(config.workspacePath, '.uxr-debug'),
            fileName,
            bundle,
        });
    }

    res.json({
        success: true,
        generatedAt: now,
        bundleVersion: bundle.bundleVersion,
        persisted,
        bundle: includeBundle ? bundle : undefined,
    });
});

/**
 * Profile key server-side agent operations for hotspot tracing.
 */
app.get('/agent/debug/profile', (req: Request, res: Response) => {
    const iterationsRaw = parseInt(String(req.query.iterations ?? '3'), 10);
    const sampleSizeRaw = parseInt(String(req.query.sampleSize ?? '1000'), 10);
    const includeSchema = req.query.includeSchema !== 'false';
    const includeRaw = req.query.includeRaw === 'true';
    const useCache = req.query.useCache === 'true';

    const iterations = Number.isFinite(iterationsRaw)
        ? Math.min(Math.max(iterationsRaw, 1), 20)
        : 3;
    const requestedSampleSize = Number.isFinite(sampleSizeRaw)
        ? Math.min(Math.max(sampleSizeRaw, 10), 50000)
        : 1000;

    const baselineIndexed = syncEngine.getIndexedInstances();
    const instanceCount = baselineIndexed.length;
    const sampleSize = Math.min(requestedSampleSize, Math.max(instanceCount, 0));
    const revision = syncEngine.getRevision();

    const sampledIds: string[] = [];
    if (sampleSize > 0) {
        const step = Math.max(1, Math.floor(instanceCount / sampleSize));
        for (let index = 0; index < instanceCount && sampledIds.length < sampleSize; index += step) {
            sampledIds.push(baselineIndexed[index].instance.id);
        }
    }

    const indexedSamples: number[] = [];
    const snapshotSamples: number[] = [];
    const schemaSamples: number[] = [];
    const lookupPathSamples: number[] = [];
    const lookupInstanceSamples: number[] = [];

    for (let run = 0; run < iterations; run++) {
        const indexedRun = measureDurationMs(() =>
            useCache ? agentDerivedCache.getIndexedInstances() : syncEngine.getIndexedInstances(),
        );
        indexedSamples.push(indexedRun.durationMs);

        const snapshotRun = measureDurationMs(() => (
            useCache
                ? agentDerivedCache.getSnapshot()
                : buildAgentSnapshotResponse(indexedRun.result, revision, Date.now())
        ));
        snapshotSamples.push(snapshotRun.durationMs);

        if (includeSchema) {
            const schemaRun = measureDurationMs(() => (
                useCache
                    ? agentDerivedCache.getSchema()
                    : buildAgentPropertySchemaFromIndexed(indexedRun.result, revision)
            ));
            schemaSamples.push(schemaRun.durationMs);
        }

        const lookupPathRun = measureDurationMs(() => {
            for (const id of sampledIds) {
                syncEngine.getPathById(id);
            }
        });
        lookupPathSamples.push(lookupPathRun.durationMs);

        const lookupInstanceRun = measureDurationMs(() => {
            for (const id of sampledIds) {
                syncEngine.getInstanceById(id);
            }
        });
        lookupInstanceSamples.push(lookupInstanceRun.durationMs);
    }

    const response: Record<string, unknown> = {
        success: true,
        generatedAt: Date.now(),
        revision,
        parameters: {
            iterations,
            sampleSize,
            includeSchema,
            useCache,
        },
        population: {
            instanceCount,
            sampledIds: sampledIds.length,
        },
        profile: {
            getIndexedInstances: summarizeProfileSamples(indexedSamples),
            buildSnapshot: summarizeProfileSamples(snapshotSamples),
            getPathByIdBatch: summarizeProfileSamples(lookupPathSamples),
            getInstanceByIdBatch: summarizeProfileSamples(lookupInstanceSamples),
            buildPropertySchema: includeSchema ? summarizeProfileSamples(schemaSamples) : null,
        },
    };

    if (includeRaw) {
        response.raw = {
            getIndexedInstances: indexedSamples,
            buildSnapshot: snapshotSamples,
            getPathByIdBatch: lookupPathSamples,
            getInstanceByIdBatch: lookupInstanceSamples,
            buildPropertySchema: schemaSamples,
        };
    }

    res.json(response);
});

/**
 * Get single test run status.
 */
app.get('/agent/tests/:id', (req: Request, res: Response) => {
    const run = agentTestManager.getRun(req.params.id);
    if (!run) {
        res.status(404).json({ success: false, error: 'Test run not found' });
        return;
    }

    const apiRun = toApiTestRun(run);
    res.json({
        success: true,
        ...buildTestRunEnvelope(apiRun),
    });
});

/**
 * List recent test runs.
 */
app.get('/agent/tests', (req: Request, res: Response) => {
    const limitRaw = parseInt(String(req.query.limit ?? '50'), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
    const runs = agentTestManager.getRuns(limit);

    const apiRuns = runs.map(toApiTestRun);
    res.json({
        success: true,
        runs: apiRuns,
        items: apiRuns,
        activeRunId: agentTestManager.getActiveRunId(),
    });
});

/**
 * Abort a queued or running test run.
 */
app.post('/agent/tests/:id/abort', (req: Request, res: Response) => {
    const runId = req.params.id;
    const run = agentTestManager.getRun(runId);

    if (!run) {
        res.status(404).json({ success: false, error: 'Test run not found' });
        return;
    }

    if (run.status === 'queued') {
        const aborted = agentTestManager.abortQueued(runId, 'Aborted before dispatch');
        clearTestDispatchTimeout(runId);
        clearTestExecutionTimeout(runId);
        persistTestEvent(runId, 'aborted', 'Aborted before dispatch');
        persistTestReport(runId);
        dispatchNextAgentTestRun();
        const apiRun = aborted ? toApiTestRun(aborted) : null;
        res.json({
            success: true,
            ...buildTestRunEnvelope(apiRun),
        });
        return;
    }

    if (run.status === 'dispatching' || run.status === 'running') {
        sendPluginTestAbort(runId);
        persistTestEvent(runId, 'abort_requested', 'Abort signal sent to plugin');

        res.status(202).json({
            success: true,
            message: 'Abort signal sent to plugin',
            runId,
        });
        return;
    }

    res.status(409).json({
        success: false,
        error: 'Run is already finalized',
        run,
    });
});

/**
 * Receive test execution events from plugin runtime.
 */
app.post('/agent/tests/events', async (req: Request, res: Response) => {
    const runId = typeof req.body?.runId === 'string' ? req.body.runId : '';
    const event = typeof req.body?.event === 'string' ? req.body.event : '';
    const message = typeof req.body?.message === 'string' ? req.body.message : undefined;
    const eventTimestamp = (
        typeof req.body?.timestamp === 'number'
        && Number.isFinite(req.body.timestamp)
        && req.body.timestamp > 0
    ) ? Math.floor(req.body.timestamp) : undefined;
    const result = (req.body?.result && typeof req.body.result === 'object' && !Array.isArray(req.body.result))
        ? req.body.result as Record<string, unknown>
        : undefined;
    const incomingAttempt = parseTestAttempt(req.body?.attempt) ?? parseTestAttempt(result?.attempt);
    const artifactName = typeof req.body?.artifactName === 'string' ? req.body.artifactName : 'artifact';
    const artifactMimeType = typeof req.body?.artifactMimeType === 'string' ? req.body.artifactMimeType : undefined;
    const artifactBase64 = typeof req.body?.artifactBase64 === 'string' ? req.body.artifactBase64 : undefined;
    const artifactPayload = (
        req.body?.artifact
        && typeof req.body.artifact === 'object'
        && !Array.isArray(req.body.artifact)
    ) ? req.body.artifact as Record<string, unknown> : undefined;

    if (!runId || !event) {
        res.status(400).json({ success: false, error: 'Missing runId or event' });
        return;
    }

    const existing = agentTestManager.getRun(runId);
    if (!existing) {
        res.status(404).json({ success: false, error: 'Test run not found' });
        return;
    }

    if (incomingAttempt !== undefined) {
        if (incomingAttempt < existing.attempt) {
            res.status(202).json({
                success: true,
                ignored: true,
                reason: 'stale_attempt_event',
                eventAttempt: incomingAttempt,
                currentAttempt: existing.attempt,
                run: toApiTestRun(existing),
            });
            return;
        }
        if (incomingAttempt > existing.attempt) {
            res.status(409).json({
                success: false,
                error: `Event attempt ${incomingAttempt} exceeds current attempt ${existing.attempt}`,
                eventAttempt: incomingAttempt,
                currentAttempt: existing.attempt,
                run: toApiTestRun(existing),
            });
            return;
        }
    }

    if (event === 'started') {
        if (existing.status !== 'dispatching') {
            res.status(409).json({
                success: false,
                error: `Run is not dispatching (current status: ${existing.status})`,
                run: toApiTestRun(existing),
            });
            return;
        }

        clearTestDispatchTimeout(runId);
        const run = agentTestManager.markRunning(runId);
        if (run) {
            scheduleTestExecutionTimeout(run);
        }
        persistTestEvent(runId, event, message, result, eventTimestamp);
        persistTestReport(runId);
        res.json({ success: true, run: run ? toApiTestRun(run) : null });
        return;
    }

    if (event === 'log') {
        if (existing.status !== 'running' && existing.status !== 'dispatching') {
            res.status(409).json({
                success: false,
                error: `Run does not accept log in status: ${existing.status}`,
                run: toApiTestRun(existing),
            });
            return;
        }

        const run = agentTestManager.addLog(runId, message ?? '');
        persistTestEvent(runId, event, message, result, eventTimestamp);
        persistTestReport(runId);
        res.json({ success: true, run: run ? toApiTestRun(run) : null });
        return;
    }

    if (event === 'artifact') {
        const acceptsArtifact = existing.status === 'running'
            || existing.status === 'dispatching'
            || isFinalTestStatus(existing.status);
        if (!acceptsArtifact) {
            res.status(409).json({
                success: false,
                error: `Run does not accept artifacts in status: ${existing.status}`,
                run: toApiTestRun(existing),
            });
            return;
        }

        let artifactFile: string | null = null;
        if (artifactBase64) {
            try {
                artifactFile = await agentTestArtifactStore.writeBinaryArtifact(
                    runId,
                    artifactName,
                    artifactMimeType ?? 'application/octet-stream',
                    artifactBase64,
                );
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: `Failed to write binary artifact: ${String(error)}`,
                });
                return;
            }
        } else if (artifactPayload) {
            try {
                artifactFile = await agentTestArtifactStore.writeJsonArtifact(runId, artifactName, artifactPayload);
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: `Failed to write artifact: ${String(error)}`,
                });
                return;
            }
        }

        const visualBaseline = await maybeEvaluateVisualBaseline(
            result,
            artifactMimeType,
            artifactBase64,
        );

        const eventResult = {
            ...(result ?? {}),
            artifactFile,
            artifactMimeType: artifactMimeType ?? null,
            visualBaseline: visualBaseline?.comparison ?? null,
        };
        persistTestEvent(runId, event, message, eventResult, eventTimestamp);
        const run = agentTestManager.addLog(
            runId,
            message ?? (artifactFile ? `Artifact captured: ${artifactFile}` : 'Artifact event received'),
        );
        persistTestReport(runId);

        if (visualBaseline?.shouldFail) {
            const failureMessage = visualBaseline.failureMessage
                ?? `Visual baseline assertion failed for '${visualBaseline.comparison.key}'`;
            const finalized = finalizeTestRunFromEvent(
                runId,
                'failed',
                failureMessage,
                {
                    reason: 'visual_baseline_assertion',
                    visualBaseline: visualBaseline.comparison,
                    step: result?.step,
                    stepType: result?.stepType,
                },
                eventTimestamp,
            );
            res.status(200).json({
                success: true,
                run: finalized.run ? toApiTestRun(finalized.run) : null,
                artifactFile,
                visualBaseline: visualBaseline.comparison,
                baselineFailure: true,
            });
            return;
        }

        res.json({
            success: true,
            run: run ? toApiTestRun(run) : null,
            artifactFile,
            visualBaseline: visualBaseline?.comparison ?? null,
        });
        return;
    }

    if (event === 'passed' || event === 'failed' || event === 'aborted' || event === 'error') {
        const finalized = finalizeTestRunFromEvent(runId, event, message, result, eventTimestamp);
        res.json({
            success: true,
            run: finalized.run ? toApiTestRun(finalized.run) : null,
            retried: finalized.retried,
        });
        return;
    }

    res.status(400).json({ success: false, error: `Unsupported event: ${event}` });
});

/**
 * Read persisted report for a test run.
 */
app.get('/agent/tests/:id/report', async (req: Request, res: Response) => {
    const runId = req.params.id;
    const run = agentTestManager.getRun(runId);
    if (!run) {
        res.status(404).json({ success: false, error: 'Test run not found' });
        return;
    }

    try {
        const stored = await agentTestArtifactStore.readReport(runId);
        res.json({
            success: true,
            run: toApiTestRun(run),
            report: stored,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: String(error),
        });
    }
});

/**
 * List persisted artifact files for a test run.
 */
app.get('/agent/tests/:id/artifacts', async (req: Request, res: Response) => {
    const runId = req.params.id;
    const run = agentTestManager.getRun(runId);
    if (!run) {
        res.status(404).json({ success: false, error: 'Test run not found' });
        return;
    }

    try {
        const files = await agentTestArtifactStore.listArtifacts(runId);
        res.json({
            success: true,
            runId,
            artifactDir: agentTestArtifactStore.getRunRelativeDir(runId),
            files,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: String(error),
        });
    }
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
