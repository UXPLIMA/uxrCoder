import { describe, expect, it } from 'vitest';
import { normalizeAgentTestScenario } from '../src/agentTestScenario';

describe('normalizeAgentTestScenario', () => {
    it('normalizes defaults for valid scenario', () => {
        const result = normalizeAgentTestScenario({
            steps: [
                { type: 'log', message: 'hello' },
            ],
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.scenario.safety.timeoutMs).toBe(120000);
        expect(result.scenario.safety.maxRetries).toBe(0);
        expect(result.scenario.safety.retryDelayMs).toBe(1500);
        expect(result.scenario.safety.retryBackoffFactor).toBe(2);
        expect(result.scenario.safety.maxRetryDelayMs).toBe(30000);
        expect(result.scenario.safety.allowDestructiveActions).toBe(false);
        expect(result.scenario.runtime.mode).toBe('none');
        expect(result.scenario.runtime.stopOnFinish).toBe(true);
        expect(result.scenario.isolation.enabled).toBe(true);
        expect(result.scenario.isolation.suppressSyncChanges).toBe(true);
        expect(result.scenario.isolation.cleanupCreatedInstances).toBe(true);
        expect(result.scenario.isolation.restoreDestroyedInstances).toBe(true);
        expect(result.scenario.isolation.restorePropertyChanges).toBe(true);
        expect(result.scenario.isolation.skipDestroyedRuntimeOwned).toBe(true);
        expect(result.scenario.isolation.allowSnapshotRestoreForNonCloneable).toBe(true);
        expect(result.scenario.isolation.ignoreMissingDestroyedRestoreParent).toBe(true);
        expect(result.scenario.isolation.skipDestroyedRestoreClasses).toEqual([]);
    });

    it('rejects destructive steps when allowDestructiveActions is false', () => {
        const result = normalizeAgentTestScenario({
            steps: [
                { type: 'createInstance', className: 'Folder', path: ['Workspace', 'X'] },
            ],
        });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toContain('allowDestructiveActions=true');
    });

    it('accepts destructive steps when allowDestructiveActions is true', () => {
        const result = normalizeAgentTestScenario({
            steps: [
                { type: 'createInstance', className: 'Folder', path: ['Workspace', 'X'] },
            ],
            safety: {
                allowDestructiveActions: true,
                maxRetries: 2,
                timeoutMs: 7000,
                retryDelayMs: 2500,
                retryBackoffFactor: 3,
                maxRetryDelayMs: 60000,
                maxWaitSecondsPerStep: 7,
            },
            runtime: {
                mode: 'run',
            },
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.scenario.safety.allowDestructiveActions).toBe(true);
        expect(result.scenario.safety.maxRetries).toBe(2);
        expect(result.scenario.safety.timeoutMs).toBe(7000);
        expect(result.scenario.safety.retryDelayMs).toBe(2500);
        expect(result.scenario.safety.retryBackoffFactor).toBe(3);
        expect(result.scenario.safety.maxRetryDelayMs).toBe(60000);
        expect(result.scenario.safety.maxWaitSecondsPerStep).toBe(7);
        expect(result.scenario.runtime.mode).toBe('run');
    });

    it('supports disabling isolation cleanup', () => {
        const result = normalizeAgentTestScenario({
            steps: [
                { type: 'log', message: 'x' },
            ],
            isolation: {
                enabled: false,
            },
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.scenario.isolation.enabled).toBe(false);
        expect(result.scenario.isolation.suppressSyncChanges).toBe(false);
        expect(result.scenario.isolation.cleanupCreatedInstances).toBe(false);
        expect(result.scenario.isolation.restoreDestroyedInstances).toBe(false);
        expect(result.scenario.isolation.restorePropertyChanges).toBe(false);
        expect(result.scenario.isolation.skipDestroyedRuntimeOwned).toBe(false);
        expect(result.scenario.isolation.allowSnapshotRestoreForNonCloneable).toBe(false);
        expect(result.scenario.isolation.ignoreMissingDestroyedRestoreParent).toBe(false);
        expect(result.scenario.isolation.skipDestroyedRestoreClasses).toEqual([]);
    });

    it('enforces max step limit', () => {
        const result = normalizeAgentTestScenario({
            steps: [
                { type: 'log' },
                { type: 'log' },
                { type: 'log' },
            ],
            safety: {
                maxSteps: 2,
            },
        });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toContain('exceeding safety.maxSteps');
    });

    it('requires allowDestructiveActions for destructive harnessAction', () => {
        const result = normalizeAgentTestScenario({
            steps: [
                { type: 'harnessAction', action: 'danger-op', destructive: true },
            ],
        });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toContain('allowDestructiveActions=true');
    });

    it('normalizes isolation edge-case options for destroyed restore', () => {
        const result = normalizeAgentTestScenario({
            steps: [
                { type: 'log', message: 'edge-case' },
            ],
            isolation: {
                skipDestroyedRuntimeOwned: false,
                allowSnapshotRestoreForNonCloneable: false,
                ignoreMissingDestroyedRestoreParent: false,
                skipDestroyedRestoreClasses: ['Player', 'Terrain', 'Player', '', 42, '   '],
            },
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.scenario.isolation.skipDestroyedRuntimeOwned).toBe(false);
        expect(result.scenario.isolation.allowSnapshotRestoreForNonCloneable).toBe(false);
        expect(result.scenario.isolation.ignoreMissingDestroyedRestoreParent).toBe(false);
        expect(result.scenario.isolation.skipDestroyedRestoreClasses).toEqual(['Player', 'Terrain']);
    });

    it('supports legacy skipRestoreClassNames alias', () => {
        const result = normalizeAgentTestScenario({
            steps: [
                { type: 'log', message: 'legacy alias' },
            ],
            isolation: {
                skipRestoreClassNames: ['Humanoid', 'Animator'],
            },
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.scenario.isolation.skipDestroyedRestoreClasses).toEqual(['Humanoid', 'Animator']);
    });
});
