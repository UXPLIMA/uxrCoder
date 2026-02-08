export interface AgentCachedResponse {
    status: number;
    body: unknown;
    createdAt: number;
}

export class AgentIdempotencyCache {
    private entries: Map<string, AgentCachedResponse> = new Map();

    constructor(
        private ttlMs: number = 5 * 60 * 1000,
        private maxEntries: number = 500,
    ) { }

    get(key: string | null, now: number = Date.now()): AgentCachedResponse | null {
        if (!key) {
            return null;
        }

        this.prune(now);
        const cached = this.entries.get(key);
        if (!cached) {
            return null;
        }

        return {
            status: cached.status,
            body: this.clone(cached.body),
            createdAt: cached.createdAt,
        };
    }

    set(key: string | null, status: number, body: unknown, now: number = Date.now()): void {
        if (!key) {
            return;
        }

        this.prune(now);
        this.entries.set(key, {
            status,
            body: this.clone(body),
            createdAt: now,
        });
        this.prune(now);
    }

    size(now: number = Date.now()): number {
        this.prune(now);
        return this.entries.size;
    }

    private prune(now: number): void {
        for (const [key, value] of this.entries.entries()) {
            if (now - value.createdAt > this.ttlMs) {
                this.entries.delete(key);
            }
        }

        if (this.entries.size <= this.maxEntries) {
            return;
        }

        const entriesByAge = Array.from(this.entries.entries())
            .sort((a, b) => a[1].createdAt - b[1].createdAt);
        const overflow = this.entries.size - this.maxEntries;
        for (let i = 0; i < overflow; i++) {
            this.entries.delete(entriesByAge[i][0]);
        }
    }

    private clone<T>(value: T): T {
        const maybeStructuredClone = (globalThis as { structuredClone?: <K>(input: K) => K }).structuredClone;
        if (typeof maybeStructuredClone === 'function') {
            return maybeStructuredClone(value);
        }

        return JSON.parse(JSON.stringify(value)) as T;
    }
}
