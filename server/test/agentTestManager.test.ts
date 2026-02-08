import { describe, expect, it } from 'vitest';
import { AgentTestManager } from '../src/agentTestManager';

describe('AgentTestManager', () => {
    it('queues runs and exposes queue position', () => {
        const manager = new AgentTestManager();
        const first = manager.enqueue({ name: 'run-1' });
        const second = manager.enqueue({ name: 'run-2' });

        expect(manager.getQueueSize()).toBe(2);
        expect(manager.getQueuedPosition(first.id)).toBe(1);
        expect(manager.getQueuedPosition(second.id)).toBe(2);
        expect(manager.getQueuedRunsInOrder().map(run => run.id)).toEqual([first.id, second.id]);
    });

    it('dispatches and marks running', () => {
        const manager = new AgentTestManager();
        const run = manager.enqueue({ name: 'run' });

        const dispatching = manager.markDispatching(run.id);
        expect(dispatching?.status).toBe('dispatching');
        expect(manager.getActiveRunId()).toBe(run.id);

        const running = manager.markRunning(run.id);
        expect(running?.status).toBe('running');
        expect(running?.startedAt).toBeDefined();
    });

    it('completes and clears active run', () => {
        const manager = new AgentTestManager();
        const run = manager.enqueue({ name: 'run' });
        manager.markDispatching(run.id);
        manager.markRunning(run.id);

        const done = manager.complete(run.id, 'passed', 'ok', { assertions: 3 });
        expect(done?.status).toBe('passed');
        expect(done?.finishedAt).toBeDefined();
        expect(manager.getActiveRunId()).toBeNull();
    });

    it('aborts queued run without dispatch', () => {
        const manager = new AgentTestManager();
        const run = manager.enqueue({ name: 'run' });

        const aborted = manager.abortQueued(run.id, 'cancelled');
        expect(aborted?.status).toBe('aborted');
        expect(manager.getQueuedPosition(run.id)).toBeNull();
    });

    it('queues retry when failed and retries remain', () => {
        const manager = new AgentTestManager();
        const run = manager.enqueue({
            name: 'retry-run',
            safety: {
                maxRetries: 1,
                retryDelayMs: 0,
                maxRetryDelayMs: 0,
            },
        });

        manager.markDispatching(run.id);
        manager.markRunning(run.id);
        expect(manager.canRetry(run.id)).toBe(true);

        const retried = manager.queueRetry(run.id, 'attempt failed');
        expect(retried?.status).toBe('queued');
        expect(retried?.attempt).toBe(1);
        expect(manager.getQueuedPosition(run.id)).toBe(1);

        manager.markDispatching(run.id);
        manager.markRunning(run.id);
        expect(manager.canRetry(run.id)).toBe(false);
    });

    it('applies retry backoff and exposes next queued delay', () => {
        const manager = new AgentTestManager();
        const run = manager.enqueue({
            name: 'retry-delay',
            safety: {
                maxRetries: 2,
                retryDelayMs: 2000,
                retryBackoffFactor: 2,
                maxRetryDelayMs: 10000,
            },
        });

        manager.markDispatching(run.id);
        manager.markRunning(run.id);

        const retried = manager.queueRetry(run.id, 'attempt failed');
        expect(retried?.retryBackoffMs).toBe(2000);
        expect(retried?.nextDispatchAt).toBeDefined();

        const nextAt = retried?.nextDispatchAt ?? 0;
        expect(manager.peekNextQueuedRun(nextAt - 1)).toBeNull();
        expect(manager.getNextQueuedDelayMs(nextAt - 500)).toBe(500);
        expect(manager.peekNextQueuedRun(nextAt)?.id).toBe(run.id);
    });

    it('avoids head-of-line blocking when older retry is delayed', () => {
        const manager = new AgentTestManager();
        const first = manager.enqueue({
            name: 'first',
            safety: {
                maxRetries: 1,
                retryDelayMs: 10000,
            },
        });
        const second = manager.enqueue({ name: 'second' });

        // Dispatch first and convert it to delayed retry.
        manager.markDispatching(first.id);
        manager.markRunning(first.id);
        const queuedRetry = manager.queueRetry(first.id, 'retry later');
        expect(queuedRetry?.nextDispatchAt).toBeDefined();

        // Second run should still dispatch immediately.
        const ready = manager.peekNextQueuedRun();
        expect(ready?.id).toBe(second.id);
        const dispatched = manager.markDispatching(second.id);
        expect(dispatched?.status).toBe('dispatching');

        // First stays queued with delay.
        expect(manager.hasQueuedRuns()).toBe(true);
        expect(manager.getQueuedPosition(first.id)).toBe(1);
    });
});
