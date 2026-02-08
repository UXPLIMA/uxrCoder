import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
import { AgentTestArtifactStore } from '../src/agentTestArtifactStore';
import type { AgentTestRun } from '../src/agentTestManager';

describe('AgentTestArtifactStore', () => {
    it('writes and reads reports and event artifacts', async () => {
        const workspaceDir = mkdtempSync(path.join(os.tmpdir(), 'uxr-artifacts-'));
        try {
            const store = new AgentTestArtifactStore(workspaceDir);
            const run: AgentTestRun = {
                id: 'run_123',
                status: 'passed',
                scenario: { steps: [{ type: 'log', message: 'hello' }] },
                attempt: 1,
                maxRetries: 0,
                createdAt: 1,
                updatedAt: 2,
                startedAt: 2,
                finishedAt: 3,
                message: 'ok',
                result: { assertions: 1 },
                logs: ['step 1'],
            };

            await store.recordEvent({
                runId: run.id,
                event: 'started',
                timestamp: Date.now(),
                message: 'started',
            });
            await store.recordEvent({
                runId: run.id,
                event: 'passed',
                timestamp: Date.now(),
                result: {
                    assertionsPassed: 1,
                    assertionsFailed: 0,
                    stepsExecuted: 1,
                    durationMs: 55,
                },
            });
            const artifactFileName = await store.writeJsonArtifact(run.id, 'step-summary', {
                step: 1,
                status: 'ok',
            });
            const imageArtifact = await store.writeBinaryArtifact(
                run.id,
                'screen',
                'image/png',
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAgMBgV6XvwAAAABJRU5ErkJggg==',
            );
            await store.writeReport(run);

            const report = await store.readReport(run.id);
            expect(report).toBeTruthy();
            expect(report?.run.id).toBe(run.id);
            expect(report?.run.status).toBe('passed');
            expect(report?.summary.totalLogs).toBe(1);
            expect(report?.summary.maxAttempts).toBe(1);

            const artifacts = await store.listArtifacts(run.id);
            expect(artifacts.map(item => item.name)).toContain('events.jsonl');
            expect(artifacts.map(item => item.name)).toContain('report.json');
            expect(artifacts.map(item => item.name)).toContain(artifactFileName);
            expect(artifacts.map(item => item.name)).toContain(imageArtifact);

            const eventsPath = path.join(workspaceDir, '.uxr-tests', run.id, 'events.jsonl');
            const events = readFileSync(eventsPath, 'utf8').trim().split('\n');
            expect(events.length).toBe(2);
            expect(events[0]).toContain('"event":"started"');
            expect(events[1]).toContain('"event":"passed"');

            expect(store.getRunRelativeDir(run.id)).toBe('.uxr-tests/run_123');
        } finally {
            rmSync(workspaceDir, { recursive: true, force: true });
        }
    });
});
