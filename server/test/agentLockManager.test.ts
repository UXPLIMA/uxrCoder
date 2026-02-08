import { describe, expect, it, vi } from 'vitest';
import { AgentLockManager } from '../src/agentLockManager';

describe('AgentLockManager', () => {
    it('allows non-overlapping locks for different owners', () => {
        const lockManager = new AgentLockManager(5000);

        const first = lockManager.acquire('agent-a', [['Workspace', 'FolderA']]);
        const second = lockManager.acquire('agent-b', [['Workspace', 'FolderB']]);

        expect(first.ok).toBe(true);
        expect(second.ok).toBe(true);
    });

    it('rejects overlapping locks for different owners', () => {
        const lockManager = new AgentLockManager(5000);

        lockManager.acquire('agent-a', [['Workspace', 'FolderA']]);
        const second = lockManager.acquire('agent-b', [['Workspace', 'FolderA', 'Part']]);

        expect(second.ok).toBe(false);
        if (!second.ok) {
            expect(second.conflict.path).toEqual(['Workspace', 'FolderA']);
            expect(second.conflict.owner).toBe('agent-a');
        }
    });

    it('allows lock reuse by same owner', () => {
        const lockManager = new AgentLockManager(5000);

        const first = lockManager.acquire('agent-a', [['Workspace', 'FolderA']]);
        const second = lockManager.acquire('agent-a', [['Workspace', 'FolderA', 'Part']]);

        expect(first.ok).toBe(true);
        expect(second.ok).toBe(true);
    });

    it('releases locks by owner', () => {
        const lockManager = new AgentLockManager(5000);

        lockManager.acquire('agent-a', [['Workspace', 'FolderA']]);
        lockManager.release('agent-a');

        const second = lockManager.acquire('agent-b', [['Workspace', 'FolderA']]);
        expect(second.ok).toBe(true);
    });

    it('expires locks after ttl', () => {
        vi.useFakeTimers();
        try {
            const lockManager = new AgentLockManager(1000);

            lockManager.acquire('agent-a', [['Workspace', 'FolderA']]);
            vi.advanceTimersByTime(1500);

            const second = lockManager.acquire('agent-b', [['Workspace', 'FolderA']]);
            expect(second.ok).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('returns sorted active lock diagnostics with ttl info', () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-02-08T10:00:00.000Z'));
            const lockManager = new AgentLockManager(5000);

            lockManager.acquire('agent-b', [['Workspace', 'FolderB']]);
            lockManager.acquire('agent-a', [['Workspace', 'FolderA']]);
            vi.advanceTimersByTime(1200);

            const active = lockManager.getActiveLocks();
            expect(active.length).toBe(2);
            expect(active.map(lock => lock.path.join('.'))).toEqual([
                'Workspace.FolderA',
                'Workspace.FolderB',
            ]);
            expect(active[0].expiresInMs).toBe(3800);
            expect(active[1].expiresInMs).toBe(3800);
        } finally {
            vi.useRealTimers();
        }
    });

    it('computes lock stats and prunes expired locks on read', () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-02-08T10:00:00.000Z'));
            const lockManager = new AgentLockManager(1000);

            lockManager.acquire('agent-a', [['Workspace', 'FolderA']]);
            lockManager.acquire('agent-b', [['Workspace', 'FolderB']]);

            let stats = lockManager.getLockStats();
            expect(stats.totalLocks).toBe(2);
            expect(stats.uniqueOwners).toBe(2);
            expect(stats.minExpiresInMs).toBe(1000);
            expect(stats.maxExpiresInMs).toBe(1000);

            vi.advanceTimersByTime(1001);
            stats = lockManager.getLockStats();
            expect(stats.totalLocks).toBe(0);
            expect(stats.uniqueOwners).toBe(0);
            expect(stats.minExpiresInMs).toBeNull();
            expect(stats.maxExpiresInMs).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps a single winner under overlapping lock flood', () => {
        const lockManager = new AgentLockManager(5000);

        const first = lockManager.acquire('agent-0', [['Workspace', 'Shared']]);
        expect(first.ok).toBe(true);

        let successfulContenders = 0;
        for (let i = 1; i <= 200; i++) {
            const contender = lockManager.acquire(`agent-${i}`, [['Workspace', 'Shared', 'Node']]);
            if (contender.ok) {
                successfulContenders += 1;
            } else {
                expect(contender.conflict.owner).toBe('agent-0');
                expect(contender.conflict.path).toEqual(['Workspace', 'Shared']);
            }
        }

        expect(successfulContenders).toBe(0);
        const locks = lockManager.getActiveLocks();
        expect(locks.length).toBe(1);
        expect(locks[0].owner).toBe('agent-0');
        expect(locks[0].path).toEqual(['Workspace', 'Shared']);
    });

    it('supports large non-overlapping lock sets', () => {
        const lockManager = new AgentLockManager(5000);

        for (let i = 0; i < 300; i++) {
            const result = lockManager.acquire(`agent-${i}`, [['Workspace', `Folder${i}`]]);
            expect(result.ok).toBe(true);
        }

        const stats = lockManager.getLockStats();
        expect(stats.totalLocks).toBe(300);
        expect(stats.uniqueOwners).toBe(300);
    });
});
