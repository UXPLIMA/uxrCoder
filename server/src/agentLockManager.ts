export interface AgentPathLockConflict {
    path: string[];
    owner: string;
    expiresAt: number;
}

export interface AgentPathLockInfo {
    path: string[];
    owner: string;
    expiresAt: number;
    expiresInMs: number;
}

interface AgentPathLock {
    path: string[];
    owner: string;
    expiresAt: number;
}

export class AgentLockManager {
    private locks: Map<string, AgentPathLock> = new Map();

    constructor(private ttlMs: number = 15000) { }

    acquire(owner: string, paths: string[][]): { ok: true } | { ok: false; conflict: AgentPathLockConflict } {
        this.pruneExpired();

        const normalizedPaths = this.normalizePaths(paths);
        const now = Date.now();

        for (const path of normalizedPaths) {
            for (const existing of this.locks.values()) {
                if (existing.owner === owner) {
                    continue;
                }

                if (this.pathsOverlap(path, existing.path)) {
                    return {
                        ok: false,
                        conflict: {
                            path: existing.path,
                            owner: existing.owner,
                            expiresAt: existing.expiresAt,
                        },
                    };
                }
            }
        }

        const expiresAt = now + this.ttlMs;
        for (const path of normalizedPaths) {
            this.locks.set(this.pathKey(path), { path, owner, expiresAt });
        }

        return { ok: true };
    }

    release(owner: string): void {
        for (const [key, lock] of this.locks.entries()) {
            if (lock.owner === owner) {
                this.locks.delete(key);
            }
        }
    }

    getActiveLocks(now: number = Date.now()): AgentPathLockInfo[] {
        this.pruneExpired(now);

        const locks: AgentPathLockInfo[] = [];
        for (const lock of this.locks.values()) {
            locks.push({
                path: [...lock.path],
                owner: lock.owner,
                expiresAt: lock.expiresAt,
                expiresInMs: Math.max(0, lock.expiresAt - now),
            });
        }

        locks.sort((a, b) => a.path.join('.').localeCompare(b.path.join('.')));
        return locks;
    }

    getLockStats(now: number = Date.now()): {
        totalLocks: number;
        uniqueOwners: number;
        minExpiresInMs: number | null;
        maxExpiresInMs: number | null;
    } {
        const locks = this.getActiveLocks(now);
        const ttlValues = locks.map(lock => lock.expiresInMs);
        const uniqueOwners = new Set(locks.map(lock => lock.owner));

        return {
            totalLocks: locks.length,
            uniqueOwners: uniqueOwners.size,
            minExpiresInMs: ttlValues.length > 0 ? Math.min(...ttlValues) : null,
            maxExpiresInMs: ttlValues.length > 0 ? Math.max(...ttlValues) : null,
        };
    }

    private pruneExpired(now: number = Date.now()): void {
        for (const [key, lock] of this.locks.entries()) {
            if (lock.expiresAt <= now) {
                this.locks.delete(key);
            }
        }
    }

    private normalizePaths(paths: string[][]): string[][] {
        const dedup = new Set<string>();
        const normalized: string[][] = [];

        for (const raw of paths) {
            const clean = raw.filter(segment => typeof segment === 'string' && segment.length > 0);
            if (clean.length === 0) {
                continue;
            }

            const key = this.pathKey(clean);
            if (!dedup.has(key)) {
                dedup.add(key);
                normalized.push(clean);
            }
        }

        normalized.sort((a, b) => a.length - b.length);
        return normalized;
    }

    private pathKey(path: string[]): string {
        return path.join('.');
    }

    private pathsOverlap(a: string[], b: string[]): boolean {
        return this.isPrefix(a, b) || this.isPrefix(b, a);
    }

    private isPrefix(prefix: string[], full: string[]): boolean {
        if (prefix.length > full.length) {
            return false;
        }

        for (let i = 0; i < prefix.length; i++) {
            if (prefix[i] !== full[i]) {
                return false;
            }
        }

        return true;
    }
}
