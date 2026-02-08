import { randomUUID } from 'crypto';

export type AgentTestStatus =
    | 'queued'
    | 'dispatching'
    | 'running'
    | 'passed'
    | 'failed'
    | 'aborted'
    | 'error';

export interface AgentTestRun {
    id: string;
    status: AgentTestStatus;
    scenario: Record<string, unknown>;
    attempt: number;
    maxRetries: number;
    createdAt: number;
    updatedAt: number;
    startedAt?: number;
    finishedAt?: number;
    message?: string;
    result?: Record<string, unknown>;
    logs: string[];
    nextDispatchAt?: number;
    retryBackoffMs?: number;
}

export class AgentTestManager {
    private runs = new Map<string, AgentTestRun>();
    private queue: string[] = [];
    private activeRunId: string | null = null;

    enqueue(scenario: Record<string, unknown>): AgentTestRun {
        const now = Date.now();
        const safety = (
            scenario.safety
            && typeof scenario.safety === 'object'
            && !Array.isArray(scenario.safety)
        ) ? scenario.safety as Record<string, unknown> : null;
        const rawMaxRetries = safety && typeof safety.maxRetries === 'number'
            ? safety.maxRetries
            : 0;
        const maxRetries = Number.isFinite(rawMaxRetries)
            ? Math.min(Math.max(Math.floor(rawMaxRetries), 0), 10)
            : 0;

        const run: AgentTestRun = {
            id: randomUUID(),
            status: 'queued',
            scenario,
            attempt: 0,
            maxRetries,
            createdAt: now,
            updatedAt: now,
            logs: [],
            nextDispatchAt: now,
        };

        this.runs.set(run.id, run);
        this.queue.push(run.id);
        return this.clone(run);
    }

    getRun(runId: string): AgentTestRun | undefined {
        const run = this.runs.get(runId);
        return run ? this.clone(run) : undefined;
    }

    getRuns(limit: number = 100): AgentTestRun[] {
        const all = Array.from(this.runs.values())
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, Math.max(1, limit));
        return all.map(run => this.clone(run));
    }

    getQueuedPosition(runId: string): number | null {
        this.pruneQueue();
        const index = this.queue.indexOf(runId);
        if (index < 0) {
            return null;
        }
        return index + 1;
    }

    hasActiveRun(): boolean {
        return this.activeRunId !== null;
    }

    getActiveRunId(): string | null {
        return this.activeRunId;
    }

    hasQueuedRuns(): boolean {
        this.pruneQueue();
        return this.queue.length > 0;
    }

    getQueueSize(): number {
        this.pruneQueue();
        return this.queue.length;
    }

    getQueuedRunsInOrder(): AgentTestRun[] {
        this.pruneQueue();
        const runs: AgentTestRun[] = [];
        for (const runId of this.queue) {
            const run = this.runs.get(runId);
            if (run) {
                runs.push(this.clone(run));
            }
        }
        return runs;
    }

    getNextQueuedDelayMs(now: number = Date.now()): number | null {
        this.pruneQueue();

        let minDelay: number | null = null;
        for (const runId of this.queue) {
            const run = this.runs.get(runId);
            if (!run) {
                continue;
            }

            const nextDispatchAt = typeof run.nextDispatchAt === 'number'
                ? run.nextDispatchAt
                : now;
            const delay = Math.max(0, nextDispatchAt - now);
            if (delay <= 0) {
                return 0;
            }

            if (minDelay === null || delay < minDelay) {
                minDelay = delay;
            }
        }

        return minDelay;
    }

    peekNextQueuedRun(now: number = Date.now()): AgentTestRun | null {
        this.pruneQueue();

        for (const runId of this.queue) {
            const run = this.runs.get(runId);
            if (!run) {
                continue;
            }

            const nextDispatchAt = typeof run.nextDispatchAt === 'number'
                ? run.nextDispatchAt
                : now;
            if (nextDispatchAt <= now) {
                return this.clone(run);
            }
        }

        return null;
    }

    markDispatching(runId: string): AgentTestRun | null {
        if (this.activeRunId && this.activeRunId !== runId) {
            return null;
        }

        const run = this.runs.get(runId);
        if (!run) {
            return null;
        }
        if (run.status !== 'queued') {
            return null;
        }

        const now = Date.now();
        if (typeof run.nextDispatchAt === 'number' && run.nextDispatchAt > now) {
            return null;
        }

        // Ensure queue head consistency.
        if (this.queue[0] !== runId) {
            const idx = this.queue.indexOf(runId);
            if (idx >= 0) {
                this.queue.splice(idx, 1);
            }
            this.queue.unshift(runId);
        }
        this.queue.shift();

        this.activeRunId = runId;
        run.status = 'dispatching';
        run.attempt = Math.max(1, run.attempt + 1);
        run.nextDispatchAt = undefined;
        run.retryBackoffMs = undefined;
        run.updatedAt = now;
        return this.clone(run);
    }

    markRunning(runId: string): AgentTestRun | null {
        const run = this.runs.get(runId);
        if (!run) {
            return null;
        }

        this.activeRunId = runId;
        run.status = 'running';
        const now = Date.now();
        run.startedAt = run.startedAt ?? now;
        run.updatedAt = now;
        return this.clone(run);
    }

    addLog(runId: string, message: string): AgentTestRun | null {
        const run = this.runs.get(runId);
        if (!run) {
            return null;
        }

        run.logs.push(message);
        run.updatedAt = Date.now();
        return this.clone(run);
    }

    canRetry(runId: string): boolean {
        const run = this.runs.get(runId);
        if (!run) {
            return false;
        }

        return run.attempt <= run.maxRetries;
    }

    queueRetry(runId: string, message?: string): AgentTestRun | null {
        const run = this.runs.get(runId);
        if (!run) {
            return null;
        }

        if (run.status !== 'running' && run.status !== 'dispatching') {
            return null;
        }

        const now = Date.now();
        const retryBackoffMs = this.computeRetryBackoffMs(run);

        run.status = 'queued';
        run.retryBackoffMs = retryBackoffMs;
        run.nextDispatchAt = now + retryBackoffMs;
        run.updatedAt = now;
        if (message) {
            run.logs.push(message);
            run.message = message;
        } else {
            run.message = retryBackoffMs > 0
                ? `Retry queued with ${retryBackoffMs}ms backoff`
                : 'Retry queued';
        }
        run.result = undefined;
        run.finishedAt = undefined;

        if (this.activeRunId === runId) {
            this.activeRunId = null;
        }

        const existingIdx = this.queue.indexOf(runId);
        if (existingIdx >= 0) {
            this.queue.splice(existingIdx, 1);
        }
        this.queue.push(runId);

        return this.clone(run);
    }

    complete(
        runId: string,
        status: Extract<AgentTestStatus, 'passed' | 'failed' | 'aborted' | 'error'>,
        message?: string,
        result?: Record<string, unknown>
    ): AgentTestRun | null {
        const run = this.runs.get(runId);
        if (!run) {
            return null;
        }

        run.status = status;
        const now = Date.now();
        run.updatedAt = now;
        run.finishedAt = now;
        if (message) {
            run.message = message;
        }
        if (result) {
            run.result = result;
        }
        run.nextDispatchAt = undefined;
        run.retryBackoffMs = undefined;

        if (this.activeRunId === runId) {
            this.activeRunId = null;
        }

        return this.clone(run);
    }

    abortQueued(runId: string, message?: string): AgentTestRun | null {
        const run = this.runs.get(runId);
        if (!run) {
            return null;
        }

        const queueIndex = this.queue.indexOf(runId);
        if (queueIndex >= 0) {
            this.queue.splice(queueIndex, 1);
        }

        return this.complete(runId, 'aborted', message);
    }

    private clone(run: AgentTestRun): AgentTestRun {
        return {
            ...run,
            scenario: JSON.parse(JSON.stringify(run.scenario)),
            result: run.result ? JSON.parse(JSON.stringify(run.result)) : undefined,
            logs: [...run.logs],
        };
    }

    private pruneQueue(): void {
        const nextQueue: string[] = [];
        for (const runId of this.queue) {
            const run = this.runs.get(runId);
            if (run && run.status === 'queued') {
                nextQueue.push(runId);
            }
        }
        this.queue = nextQueue;
    }

    private computeRetryBackoffMs(run: AgentTestRun): number {
        const safety = (
            run.scenario.safety
            && typeof run.scenario.safety === 'object'
            && !Array.isArray(run.scenario.safety)
        ) ? run.scenario.safety as Record<string, unknown> : null;

        const rawRetryDelayMs = safety && typeof safety.retryDelayMs === 'number'
            ? safety.retryDelayMs
            : 1500;
        const rawRetryBackoffFactor = safety && typeof safety.retryBackoffFactor === 'number'
            ? safety.retryBackoffFactor
            : 2;
        const rawMaxRetryDelayMs = safety && typeof safety.maxRetryDelayMs === 'number'
            ? safety.maxRetryDelayMs
            : 30000;

        const retryDelayMs = Number.isFinite(rawRetryDelayMs)
            ? Math.min(Math.max(Math.floor(rawRetryDelayMs), 0), 600000)
            : 1500;
        const retryBackoffFactor = Number.isFinite(rawRetryBackoffFactor)
            ? Math.min(Math.max(rawRetryBackoffFactor, 1), 8)
            : 2;
        const maxRetryDelayMs = Number.isFinite(rawMaxRetryDelayMs)
            ? Math.min(Math.max(Math.floor(rawMaxRetryDelayMs), 0), 3600000)
            : 30000;

        if (retryDelayMs <= 0 || maxRetryDelayMs <= 0) {
            return 0;
        }

        const exponent = Math.max(0, run.attempt - 1);
        const computed = Math.floor(retryDelayMs * Math.pow(retryBackoffFactor, exponent));
        return Math.min(computed, maxRetryDelayMs);
    }
}
