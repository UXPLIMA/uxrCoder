import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentVisualBaselineStore } from '../src/agentVisualBaselineStore';

function toBase64(text: string): string {
    return Buffer.from(text, 'utf8').toString('base64');
}

describe('AgentVisualBaselineStore', () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        for (const dir of tempDirs) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
        tempDirs.length = 0;
    });

    function createStore(): { store: AgentVisualBaselineStore; workspacePath: string } {
        const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'uxr-visual-baseline-'));
        tempDirs.push(workspacePath);
        return {
            store: new AgentVisualBaselineStore(workspacePath),
            workspacePath,
        };
    }

    it('records missing baseline in assert_or_record mode and then matches in assert mode', async () => {
        const { store } = createStore();

        const first = await store.evaluateBase64Artifact({
            key: 'spawn-check',
            mode: 'assert_or_record',
            allowMissingBaseline: false,
            mimeType: 'image/png',
            base64Data: toBase64('image-a'),
        });

        expect(first.shouldFail).toBe(false);
        expect(first.comparison.updatedBaseline).toBe(true);
        expect(first.comparison.baselineFound).toBe(false);
        expect(first.comparison.reason).toBe('baseline_recorded');
        expect(first.comparison.baselinePath).toBe('.uxr-tests/baselines/spawn-check.png');

        const second = await store.evaluateBase64Artifact({
            key: 'spawn-check',
            mode: 'assert',
            allowMissingBaseline: false,
            mimeType: 'image/png',
            base64Data: toBase64('image-a'),
        });

        expect(second.shouldFail).toBe(false);
        expect(second.comparison.updatedBaseline).toBe(false);
        expect(second.comparison.baselineFound).toBe(true);
        expect(second.comparison.matched).toBe(true);
        expect(second.comparison.reason).toBe('baseline_match');
    });

    it('fails assert mode when screenshot differs from baseline', async () => {
        const { store } = createStore();

        await store.evaluateBase64Artifact({
            key: 'menu-screen',
            mode: 'record',
            allowMissingBaseline: false,
            mimeType: 'image/png',
            base64Data: toBase64('baseline-image'),
        });

        const mismatch = await store.evaluateBase64Artifact({
            key: 'menu-screen',
            mode: 'assert',
            allowMissingBaseline: false,
            mimeType: 'image/png',
            base64Data: toBase64('changed-image'),
        });

        expect(mismatch.shouldFail).toBe(true);
        expect(mismatch.failureMessage).toContain('Visual baseline mismatch');
        expect(mismatch.comparison.matched).toBe(false);
        expect(mismatch.comparison.reason).toBe('baseline_mismatch');
    });

    it('supports missing baseline allowance in assert mode', async () => {
        const { store } = createStore();

        const result = await store.evaluateBase64Artifact({
            key: 'new-flow',
            mode: 'assert',
            allowMissingBaseline: true,
            mimeType: 'image/png',
            base64Data: toBase64('new-image'),
        });

        expect(result.shouldFail).toBe(false);
        expect(result.comparison.baselineFound).toBe(false);
        expect(result.comparison.reason).toBe('baseline_missing_allowed');
    });
});
