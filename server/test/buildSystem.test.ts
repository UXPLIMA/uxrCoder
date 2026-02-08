import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { BuildSystem } from '../src/buildSystem';
import type { RobloxInstance } from '../src/types';

function createPartWithOrientation(x: number, y: number, z: number): RobloxInstance {
    return {
        id: 'part-1',
        className: 'Part',
        name: 'Part',
        parent: 'Workspace',
        properties: {
            Name: 'Part',
            CFrame: {
                type: 'CFrame',
                position: { type: 'Vector3', x: 0, y: 0, z: 0 },
                orientation: { type: 'Vector3', x, y, z },
            },
        },
        children: [],
    };
}

async function buildXmlWithOrientation(x: number, y: number, z: number): Promise<string> {
    const workspaceDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'uxr-build-system-'));
    try {
        const buildSystem = new BuildSystem(workspaceDir);
        const outputPath = await buildSystem.buildRbxlx([createPartWithOrientation(x, y, z)], 'test.rbxlx');
        return await fs.promises.readFile(outputPath, 'utf-8');
    } finally {
        await fs.promises.rm(workspaceDir, { recursive: true, force: true });
    }
}

describe('BuildSystem CFrame serialization', () => {
    it('writes identity rotation matrix for zero orientation', async () => {
        const xml = await buildXmlWithOrientation(0, 0, 0);
        expect(xml).toContain('<R00>1</R00>');
        expect(xml).toContain('<R11>1</R11>');
        expect(xml).toContain('<R22>1</R22>');
        expect(xml).toContain('<R01>0</R01>');
        expect(xml).toContain('<R12>0</R12>');
        expect(xml).toContain('<R20>0</R20>');
    });

    it('writes expected matrix for +90deg X orientation', async () => {
        const xml = await buildXmlWithOrientation(90, 0, 0);
        expect(xml).toContain('<R00>1</R00>');
        expect(xml).toContain('<R11>0</R11>');
        expect(xml).toContain('<R12>-1</R12>');
        expect(xml).toContain('<R21>1</R21>');
        expect(xml).toContain('<R22>0</R22>');
    });

    it('writes expected matrix for +90deg Y orientation', async () => {
        const xml = await buildXmlWithOrientation(0, 90, 0);
        expect(xml).toContain('<R00>0</R00>');
        expect(xml).toContain('<R02>1</R02>');
        expect(xml).toContain('<R11>1</R11>');
        expect(xml).toContain('<R20>-1</R20>');
        expect(xml).toContain('<R22>0</R22>');
    });
});
