import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncEngine } from '../src/syncEngine';
import { Watcher } from '../src/watcher';
import type { RobloxInstance, SyncMessage } from '../src/types';

interface WatcherTestPaths {
    scriptAFile: string;
    scriptAMeta: string;
    scriptAChildFile: string;
    scriptBFile: string;
    scriptBMeta: string;
    folderDir: string;
}

interface WatcherHarness {
    syncEngine: SyncEngine;
    watcher: Watcher;
    emitted: SyncMessage[];
    paths: WatcherTestPaths;
}

function flattenTree(
    nodes: RobloxInstance[],
    parentPath: string[] = [],
    output: Array<{ path: string[]; instance: RobloxInstance }> = [],
): Array<{ path: string[]; instance: RobloxInstance }> {
    for (const node of nodes) {
        const nodePath = [...parentPath, node.name];
        output.push({ path: nodePath, instance: node });
        flattenTree(node.children ?? [], nodePath, output);
    }
    return output;
}

function assertConvergedState(syncEngine: SyncEngine): void {
    const indexed = syncEngine.getIndexedInstances();
    const treeFlat = flattenTree(syncEngine.getAllInstances());

    const indexedSet = new Set(indexed.map(({ path, instance }) => `${path.join('.')}::${instance.id}`));
    const treeSet = new Set(treeFlat.map(({ path, instance }) => `${path.join('.')}::${instance.id}`));

    expect(treeSet).toEqual(indexedSet);

    for (const { path, instance } of indexed) {
        expect(syncEngine.getPathById(instance.id)).toEqual(path);

        if (path.length > 1) {
            const parentPath = path.slice(0, -1);
            expect(syncEngine.getInstance(parentPath)).toBeDefined();
            expect(instance.parent).toBe(parentPath.join('.'));
        } else {
            expect(instance.parent ?? null).toBeNull();
        }
    }
}

function createHarness(): WatcherHarness {
    const rootPath = path.resolve('/tmp/uxr-watcher-interleaving');
    const pathMap = new Map<string, string[]>();
    const registerPath = (relativePath: string, robloxPath: string[]): string => {
        const absolute = path.resolve(rootPath, relativePath);
        pathMap.set(absolute, robloxPath);
        return absolute;
    };

    const paths: WatcherTestPaths = {
        scriptAFile: registerPath(
            'Workspace/ServerScriptService/TestScriptA.server.lua',
            ['Workspace', 'ServerScriptService', 'TestScriptA'],
        ),
        scriptAMeta: registerPath(
            'Workspace/ServerScriptService/TestScriptA.meta.json',
            ['Workspace', 'ServerScriptService', 'TestScriptA'],
        ),
        scriptAChildFile: registerPath(
            'Workspace/ServerScriptService/TestScriptA/Child.server.lua',
            ['Workspace', 'ServerScriptService', 'TestScriptA', 'Child'],
        ),
        scriptBFile: registerPath(
            'Workspace/ServerScriptService/TestScriptB.server.lua',
            ['Workspace', 'ServerScriptService', 'TestScriptB'],
        ),
        scriptBMeta: registerPath(
            'Workspace/ServerScriptService/TestScriptB.meta.json',
            ['Workspace', 'ServerScriptService', 'TestScriptB'],
        ),
        folderDir: registerPath(
            'Workspace/ServerScriptService/FolderA',
            ['Workspace', 'ServerScriptService', 'FolderA'],
        ),
    };

    const syncEngine = new SyncEngine();
    syncEngine.updateFromPlugin([
        {
            id: 'workspace-1',
            className: 'Workspace',
            name: 'Workspace',
            parent: null,
            properties: {},
            children: [
                {
                    id: 'sss-1',
                    className: 'Folder',
                    name: 'ServerScriptService',
                    parent: 'Workspace',
                    properties: {},
                    children: [],
                },
                {
                    id: 'rs-1',
                    className: 'Folder',
                    name: 'ReplicatedStorage',
                    parent: 'Workspace',
                    properties: {},
                    children: [],
                },
            ],
        },
    ]);

    const fileMapper = {
        getRobloxPath: (filePath: string): string[] | null => {
            const normalized = path.resolve(filePath);
            return pathMap.get(normalized) ?? null;
        },
    } as unknown as { getRobloxPath: (filePath: string) => string[] | null };

    const watcher = new Watcher(rootPath, syncEngine, fileMapper as any);
    const emitted: SyncMessage[] = [];
    watcher.onChange(change => emitted.push(change));

    return {
        syncEngine,
        watcher,
        emitted,
        paths,
    };
}

describe('Watcher Event Interleaving', () => {
    let readFileSpy: ReturnType<typeof vi.spyOn>;
    let logSpy: ReturnType<typeof vi.spyOn>;
    let warnSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.useFakeTimers();

        let sequence = 0;
        readFileSpy = vi.spyOn(fs.promises, 'readFile').mockImplementation((async (filePath: string) => {
            const resolved = String(filePath);
            if (resolved.endsWith('.meta.json')) {
                return JSON.stringify({
                    properties: {
                        Enabled: sequence % 2 === 0,
                        Sequence: sequence++,
                    },
                });
            }

            return `-- source:${path.basename(resolved)}:${sequence++}`;
        }) as any);

        logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        readFileSpy.mockRestore();
        logSpy.mockRestore();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
        vi.useRealTimers();
    });

    it('suppresses paused and ignored file events, then resumes deterministically', async () => {
        const harness = createHarness();

        harness.watcher.pauseTemporarily(100);
        await (harness.watcher as any).handleFileChange('create', harness.paths.scriptAFile);
        expect(harness.emitted).toHaveLength(0);

        vi.advanceTimersByTime(100);
        harness.watcher.ignore(harness.paths.scriptAFile);

        await (harness.watcher as any).handleFileChange('create', harness.paths.scriptAFile);
        await (harness.watcher as any).handleFileChange('create', harness.paths.scriptBFile);

        expect(harness.syncEngine.getInstance(['Workspace', 'ServerScriptService', 'TestScriptA'])).toBeUndefined();
        expect(harness.syncEngine.getInstance(['Workspace', 'ServerScriptService', 'TestScriptB'])).toBeDefined();
        expect(
            harness.emitted
                .filter(change => change.type === 'create')
                .map(change => change.path.join('.')),
        ).toEqual(['Workspace.ServerScriptService.TestScriptB']);

        vi.advanceTimersByTime(2000);
        await (harness.watcher as any).handleFileChange('create', harness.paths.scriptAFile);

        expect(harness.syncEngine.getInstance(['Workspace', 'ServerScriptService', 'TestScriptA'])).toBeDefined();
        assertConvergedState(harness.syncEngine);
    });

    it('handles out-of-order child events without creating orphan state', async () => {
        const harness = createHarness();

        await (harness.watcher as any).handleFileChange('create', harness.paths.scriptAFile);
        expect(harness.syncEngine.getInstance(['Workspace', 'ServerScriptService', 'TestScriptA'])).toBeDefined();

        const emittedBeforeBlockedChild = harness.emitted.length;
        await (harness.watcher as any).handleFileChange('create', harness.paths.scriptAChildFile);
        expect(harness.emitted.length).toBe(emittedBeforeBlockedChild);
        expect(harness.syncEngine.getInstance(['Workspace', 'ServerScriptService', 'TestScriptA', 'Child'])).toBeUndefined();

        (harness.watcher as any).handleFileDelete(harness.paths.scriptAFile);
        expect(harness.syncEngine.getInstance(['Workspace', 'ServerScriptService', 'TestScriptA'])).toBeUndefined();

        await (harness.watcher as any).handleFileChange('create', harness.paths.scriptAChildFile);
        expect(harness.syncEngine.getInstance(['Workspace', 'ServerScriptService', 'TestScriptA', 'Child'])).toBeUndefined();
        assertConvergedState(harness.syncEngine);
    });

    it('maintains convergence under interleaved watcher event flood', async () => {
        const harness = createHarness();

        await (harness.watcher as any).handleFileChange('create', harness.paths.scriptAFile);
        await (harness.watcher as any).handleFileChange('create', harness.paths.scriptBFile);

        for (let i = 0; i < 120; i++) {
            const useScriptA = i % 2 === 0;
            const scriptFile = useScriptA ? harness.paths.scriptAFile : harness.paths.scriptBFile;
            const scriptMeta = useScriptA ? harness.paths.scriptAMeta : harness.paths.scriptBMeta;

            if (i % 17 === 0) {
                harness.watcher.pauseTemporarily(25);
            }

            if (i % 13 === 0) {
                harness.watcher.ignore(scriptFile);
            }

            if (i % 5 === 0) {
                (harness.watcher as any).handleDirCreate(harness.paths.folderDir);
                if (i % 10 === 0) {
                    (harness.watcher as any).handleDirDelete(harness.paths.folderDir);
                }
            }

            switch (i % 4) {
                case 0:
                    await (harness.watcher as any).handleFileChange('update', scriptFile);
                    break;
                case 1:
                    await (harness.watcher as any).handleFileChange('create', scriptFile);
                    break;
                case 2:
                    (harness.watcher as any).handleFileDelete(scriptFile);
                    break;
                default:
                    await (harness.watcher as any).handleFileChange('create', scriptMeta);
                    break;
            }

            if (i % 9 === 0) {
                await (harness.watcher as any).handleFileChange('create', harness.paths.scriptAChildFile);
            }

            vi.advanceTimersByTime(30);
            assertConvergedState(harness.syncEngine);
        }

        vi.advanceTimersByTime(3000);
        await (harness.watcher as any).handleFileChange('create', harness.paths.scriptAFile);
        await (harness.watcher as any).handleFileChange('create', harness.paths.scriptBFile);

        assertConvergedState(harness.syncEngine);
        expect(harness.emitted.length).toBeGreaterThan(20);
        expect(harness.emitted.every(change => change.path.length > 0)).toBe(true);
    });
});
