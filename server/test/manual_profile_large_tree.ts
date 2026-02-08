import fs from 'fs';
import path from 'path';
import { SyncEngine } from '../src/syncEngine';
import { buildAgentPropertySchemaFromIndexed } from '../src/agentPropertySchema';
import { buildAgentSnapshotResponse } from '../src/agentSnapshot';
import type { RobloxInstance } from '../src/types';

interface BenchConfig {
    folderCount: number;
    partsPerFolder: number;
    iterations: number;
    lookupSampleSize: number;
    outputFile: string | null;
}

interface BenchMetric {
    runs: number;
    averageMs: number;
    p95Ms: number;
    minMs: number;
    maxMs: number;
}

function readEnvInt(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) {
        return fallback;
    }
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
}

function loadConfig(): BenchConfig {
    const outputFileRaw = process.env.PROFILE_OUT?.trim() ?? '';
    const outputFile = outputFileRaw.length > 0
        ? path.resolve(outputFileRaw)
        : null;

    return {
        folderCount: readEnvInt('FOLDER_COUNT', 1000),
        partsPerFolder: readEnvInt('PARTS_PER_FOLDER', 100),
        iterations: Math.min(readEnvInt('ITERATIONS', 5), 25),
        lookupSampleSize: readEnvInt('LOOKUP_SAMPLE', 5000),
        outputFile,
    };
}

function measureMs<T>(fn: () => T): { durationMs: number; result: T } {
    const startedAt = process.hrtime.bigint();
    const result = fn();
    const endedAt = process.hrtime.bigint();
    return {
        durationMs: Number(endedAt - startedAt) / 1_000_000,
        result,
    };
}

function summarize(samples: number[]): BenchMetric {
    const sorted = [...samples].sort((a, b) => a - b);
    const total = sorted.reduce((sum, value) => sum + value, 0);
    const p95Index = Math.floor((sorted.length - 1) * 0.95);
    const round = (value: number): number => Number(value.toFixed(3));

    return {
        runs: sorted.length,
        averageMs: round(total / sorted.length),
        p95Ms: round(sorted[p95Index]),
        minMs: round(sorted[0]),
        maxMs: round(sorted[sorted.length - 1]),
    };
}

function formatMetric(label: string, metric: BenchMetric): string {
    return `${label.padEnd(24)} avg=${metric.averageMs}ms p95=${metric.p95Ms}ms min=${metric.minMs}ms max=${metric.maxMs}ms runs=${metric.runs}`;
}

function createLargeDataModel(folderCount: number, partsPerFolder: number): RobloxInstance[] {
    const workspace: RobloxInstance = {
        id: 'workspace-root',
        className: 'Workspace',
        name: 'Workspace',
        parent: null,
        properties: {
            Name: 'Workspace',
        },
        children: [],
    };

    for (let folderIndex = 0; folderIndex < folderCount; folderIndex++) {
        const folderName = `Folder_${folderIndex}`;
        const folderPath = `Workspace.${folderName}`;
        const folder: RobloxInstance = {
            id: `folder-${folderIndex}`,
            className: 'Folder',
            name: folderName,
            parent: 'Workspace',
            properties: {
                Name: folderName,
            },
            children: [],
        };

        for (let partIndex = 0; partIndex < partsPerFolder; partIndex++) {
            const partName = `Part_${partIndex}`;
            folder.children!.push({
                id: `part-${folderIndex}-${partIndex}`,
                className: 'Part',
                name: partName,
                parent: folderPath,
                properties: {
                    Name: partName,
                    Anchored: true,
                    Transparency: 0,
                    Material: {
                        type: 'Enum',
                        enumType: 'Material',
                        value: 256,
                        name: 'Plastic',
                    },
                    Position: {
                        type: 'Vector3',
                        x: folderIndex,
                        y: partIndex,
                        z: 0,
                    },
                },
                children: [],
            });
        }

        workspace.children!.push(folder);
    }

    return [workspace];
}

function pickSampleIds(ids: string[], sampleSize: number): string[] {
    if (ids.length === 0 || sampleSize <= 0) {
        return [];
    }

    const size = Math.min(sampleSize, ids.length);
    const step = Math.max(1, Math.floor(ids.length / size));
    const sampled: string[] = [];
    for (let i = 0; i < ids.length && sampled.length < size; i += step) {
        sampled.push(ids[i]);
    }
    return sampled;
}

function writeOutputIfNeeded(outputPath: string | null, text: string): void {
    if (!outputPath) {
        return;
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, text, 'utf-8');
}

function main(): void {
    const config = loadConfig();
    const totalInstances = 1 + config.folderCount + (config.folderCount * config.partsPerFolder);

    const lines: string[] = [];
    lines.push('=== uxrCoder Large Tree Profile ===');
    lines.push(`folderCount=${config.folderCount}`);
    lines.push(`partsPerFolder=${config.partsPerFolder}`);
    lines.push(`estimatedInstances=${totalInstances}`);
    lines.push(`iterations=${config.iterations}`);
    lines.push(`lookupSampleSize=${config.lookupSampleSize}`);
    lines.push('');

    const generation = measureMs(() =>
        createLargeDataModel(config.folderCount, config.partsPerFolder),
    );
    lines.push(`generateDataModel            ${generation.durationMs.toFixed(3)}ms`);

    const syncEngine = new SyncEngine();
    const fullSync = measureMs(() => syncEngine.updateFromPlugin(generation.result));
    lines.push(`updateFromPlugin(initial)    ${fullSync.durationMs.toFixed(3)}ms (changes=${fullSync.result.length})`);
    lines.push('');

    const indexedBaseline = syncEngine.getIndexedInstances();
    const allIds = indexedBaseline.map(item => item.instance.id);
    const sampleIds = pickSampleIds(allIds, config.lookupSampleSize);

    const indexedSamples: number[] = [];
    const pathLookupSamples: number[] = [];
    const instanceLookupSamples: number[] = [];
    const snapshotSamples: number[] = [];
    const schemaSamples: number[] = [];

    for (let i = 0; i < config.iterations; i++) {
        const indexedRun = measureMs(() => syncEngine.getIndexedInstances());
        indexedSamples.push(indexedRun.durationMs);

        const snapshotRun = measureMs(() => {
            return buildAgentSnapshotResponse(
                indexedRun.result,
                syncEngine.getRevision(),
                Date.now(),
            );
        });
        snapshotSamples.push(snapshotRun.durationMs);

        const schemaRun = measureMs(() =>
            buildAgentPropertySchemaFromIndexed(indexedRun.result, syncEngine.getRevision()),
        );
        schemaSamples.push(schemaRun.durationMs);

        const pathLookupRun = measureMs(() => {
            for (const id of sampleIds) {
                syncEngine.getPathById(id);
            }
        });
        pathLookupSamples.push(pathLookupRun.durationMs);

        const instanceLookupRun = measureMs(() => {
            for (const id of sampleIds) {
                syncEngine.getInstanceById(id);
            }
        });
        instanceLookupSamples.push(instanceLookupRun.durationMs);
    }

    lines.push(`actualInstances=${indexedBaseline.length}`);
    lines.push(`sampledIds=${sampleIds.length}`);
    lines.push('');
    lines.push(formatMetric('getIndexedInstances', summarize(indexedSamples)));
    lines.push(formatMetric('buildSnapshotLike', summarize(snapshotSamples)));
    lines.push(formatMetric('buildPropertySchema', summarize(schemaSamples)));
    lines.push(formatMetric('getPathByIdBatch', summarize(pathLookupSamples)));
    lines.push(formatMetric('getInstanceByIdBatch', summarize(instanceLookupSamples)));

    const output = `${lines.join('\n')}\n`;
    process.stdout.write(output);
    writeOutputIfNeeded(config.outputFile, output);
}

main();
