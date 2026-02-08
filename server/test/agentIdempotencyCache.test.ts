import { describe, expect, it } from 'vitest';
import { AgentIdempotencyCache } from '../src/agentIdempotencyCache';

describe('AgentIdempotencyCache', () => {
    it('returns null for missing keys', () => {
        const cache = new AgentIdempotencyCache(1000, 10);
        expect(cache.get(null)).toBeNull();
        expect(cache.get('missing')).toBeNull();
    });

    it('stores and returns cached responses', () => {
        const cache = new AgentIdempotencyCache(1000, 10);
        const body = { success: true, value: { nested: 'ok' } };

        cache.set('key-1', 200, body, 100);
        const cached = cache.get('key-1', 150);

        expect(cached).not.toBeNull();
        expect(cached?.status).toBe(200);
        expect(cached?.createdAt).toBe(100);
        expect(cached?.body).toEqual(body);
    });

    it('returns cloned body to prevent mutation leaks', () => {
        const cache = new AgentIdempotencyCache(1000, 10);
        const original = { success: true, payload: { count: 1 } };

        cache.set('key-1', 200, original, 100);
        original.payload.count = 999;

        const firstRead = cache.get('key-1', 150);
        expect((firstRead?.body as { payload: { count: number } }).payload.count).toBe(1);

        (firstRead?.body as { payload: { count: number } }).payload.count = 42;
        const secondRead = cache.get('key-1', 160);
        expect((secondRead?.body as { payload: { count: number } }).payload.count).toBe(1);
    });

    it('expires entries after ttl', () => {
        const cache = new AgentIdempotencyCache(100, 10);

        cache.set('key-1', 200, { ok: true }, 1000);
        expect(cache.get('key-1', 1099)).not.toBeNull();
        expect(cache.get('key-1', 1101)).toBeNull();
        expect(cache.size(1101)).toBe(0);
    });

    it('evicts oldest entries when max capacity is exceeded', () => {
        const cache = new AgentIdempotencyCache(1000, 2);

        cache.set('k1', 200, { n: 1 }, 1);
        cache.set('k2', 200, { n: 2 }, 2);
        cache.set('k3', 200, { n: 3 }, 3);

        expect(cache.size(3)).toBe(2);
        expect(cache.get('k1', 3)).toBeNull();
        expect(cache.get('k2', 3)?.body).toEqual({ n: 2 });
        expect(cache.get('k3', 3)?.body).toEqual({ n: 3 });
    });
});
