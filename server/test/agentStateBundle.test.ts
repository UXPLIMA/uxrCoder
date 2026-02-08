import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
    buildAgentStateBundle,
    buildAgentStateBundleFilename,
    persistAgentStateBundle,
    sanitizeBundleLabel,
} from '../src/agentStateBundle';
import type { AgentPropertySchemaResponse, AgentSnapshotResponse } from '../src/types';

function createSampleSnapshot(revision: number): AgentSnapshotResponse {
    return {
        revision,
        generatedAt: 1700000000000,
        instances: [
            {
                id: 'part-1',
                className: 'Part',
                name: 'Part',
                path: ['Workspace', 'Part'],
                parentId: null,
                childIds: [],
                properties: {
                    Name: 'Part',
                    Transparency: 0.5,
                },
            },
        ],
    };
}

function createSampleSchema(revision: number): AgentPropertySchemaResponse {
    return {
        schemaVersion: 'uxr-agent-property-schema/v1',
        generatedAt: 1700000000000,
        revision,
        classes: [
            {
                className: 'Part',
                instanceCount: 1,
                properties: [
                    {
                        name: 'Transparency',
                        kind: 'primitive',
                        kinds: ['primitive'],
                        writable: true,
                        nullable: false,
                        valueType: 'number',
                        valueTypes: ['number'],
                        numericConstraint: {
                            min: 0,
                            max: 1,
                            strict: true,
                            source: 'builtin',
                        },
                        serializerHint: 'Use JSON primitive value (number)',
                        deserializerHint: 'Deserialized directly as Lua primitive',
                        observedOn: 1,
                    },
                ],
            },
        ],
    };
}

describe('agentStateBundle', () => {
    it('sanitizes labels for portable filenames', () => {
        expect(sanitizeBundleLabel('  Boss Fight / Regression #1  ')).toBe('boss-fight-regression-1');
        expect(sanitizeBundleLabel('___keep___')).toBe('___keep___');
    });

    it('builds deterministic filename with optional label', () => {
        const filename = buildAgentStateBundleFilename(1700000000123, 'Boss Fight');
        expect(filename).toBe('agent-state-20231114-221320123-boss-fight.json');
    });

    it('persists a state bundle as JSON artifact', () => {
        const revision = 42;
        const snapshot = createSampleSnapshot(revision);
        const schema = createSampleSchema(revision);
        const bundle = buildAgentStateBundle({
            generatedAt: 1700000000123,
            revision,
            workspacePath: '/workspace',
            snapshot,
            schema,
            pendingChangeCount: 3,
            lockDiagnostics: { stats: { activeLocks: 1 } },
            metrics: { queue: { size: 2 } },
        });

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uxr-agent-bundle-'));
        try {
            const fileName = buildAgentStateBundleFilename(bundle.generatedAt, 'smoke');
            const persisted = persistAgentStateBundle({
                outputDir: tempDir,
                fileName,
                bundle,
            });

            expect(persisted.fileName).toBe(fileName);
            expect(fs.existsSync(persisted.filePath)).toBe(true);
            expect(persisted.bytes).toBeGreaterThan(0);

            const parsed = JSON.parse(fs.readFileSync(persisted.filePath, 'utf-8')) as {
                bundleVersion: string;
                revision: number;
                diagnostics?: { pendingChangeCount?: number };
            };
            expect(parsed.bundleVersion).toBe('uxr-agent-state-bundle/v1');
            expect(parsed.revision).toBe(revision);
            expect(parsed.diagnostics?.pendingChangeCount).toBe(3);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
