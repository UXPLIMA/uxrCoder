import fs from 'fs';
import path from 'path';
import type { AgentPropertySchemaResponse, AgentSnapshotResponse } from './types';

export interface AgentStateBundle {
    bundleVersion: 'uxr-agent-state-bundle/v1';
    generatedAt: number;
    revision: number;
    workspacePath: string;
    snapshot: AgentSnapshotResponse;
    schema: AgentPropertySchemaResponse;
    diagnostics: {
        pendingChangeCount: number;
        lockDiagnostics: Record<string, unknown>;
        metrics: Record<string, unknown>;
    };
}

export interface PersistedAgentStateBundle {
    filePath: string;
    fileName: string;
    bytes: number;
}

interface BuildAgentStateBundleParams {
    generatedAt: number;
    revision: number;
    workspacePath: string;
    snapshot: AgentSnapshotResponse;
    schema: AgentPropertySchemaResponse;
    pendingChangeCount: number;
    lockDiagnostics: Record<string, unknown>;
    metrics: Record<string, unknown>;
}

export function sanitizeBundleLabel(label: string): string {
    return label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
}

export function buildAgentStateBundleFilename(generatedAt: number, label?: string): string {
    const date = new Date(generatedAt);
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const min = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');
    const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
    const normalizedLabel = typeof label === 'string' ? sanitizeBundleLabel(label) : '';
    const suffix = normalizedLabel.length > 0 ? `-${normalizedLabel}` : '';

    return `agent-state-${yyyy}${mm}${dd}-${hh}${min}${ss}${ms}${suffix}.json`;
}

export function buildAgentStateBundle(params: BuildAgentStateBundleParams): AgentStateBundle {
    return {
        bundleVersion: 'uxr-agent-state-bundle/v1',
        generatedAt: params.generatedAt,
        revision: params.revision,
        workspacePath: params.workspacePath,
        snapshot: params.snapshot,
        schema: params.schema,
        diagnostics: {
            pendingChangeCount: params.pendingChangeCount,
            lockDiagnostics: params.lockDiagnostics,
            metrics: params.metrics,
        },
    };
}

export function persistAgentStateBundle(params: {
    outputDir: string;
    fileName: string;
    bundle: AgentStateBundle;
}): PersistedAgentStateBundle {
    fs.mkdirSync(params.outputDir, { recursive: true });

    const filePath = path.join(params.outputDir, params.fileName);
    const raw = JSON.stringify(params.bundle, null, 2);
    fs.writeFileSync(filePath, raw, 'utf-8');

    return {
        filePath,
        fileName: params.fileName,
        bytes: Buffer.byteLength(raw, 'utf-8'),
    };
}
